//! Type tracker for Levels 1-2 type inference.
//!
//! This module implements type tracking per the Python Type Inference Roadmap
//! (26.0.2, Levels 1-2). It tracks:
//!
//! Level 1 (Assignment-based):
//! - Constructor calls: `x = MyClass()` → x has type MyClass
//! - Variable propagation: `y = x` → y has same type as x
//! - Chained assignments: `a = b = MyClass()` → both have type MyClass
//!
//! Level 2 (Annotation-based):
//! - Function parameters: `def foo(x: int)` → x has type int
//! - Return types: `def foo() -> int`
//! - Variable annotations: `x: int = 5`
//! - Class attributes: `class Foo: x: int`
//! - Implicit self/cls: methods get self/cls typed to their class
//!
//! Annotated types take precedence over inferred types. Types are scoped to
//! their defining scope, and nested scopes inherit from outer scopes.
//!
//! The type tracker integrates with the analyzer to populate TypeInfo in the
//! FactsStore, enabling method resolution on typed variables.

use crate::facts::{FactsStore, SymbolId, TypeInfo, TypeSource};
use crate::patch::{FileId, Span};
use crate::python::worker::{AnnotationInfo, AssignmentInfo, WorkerHandle};
use std::collections::HashMap;
use thiserror::Error;

// ============================================================================
// Error Types
// ============================================================================

/// Errors during type tracking.
#[derive(Debug, Error)]
pub enum TypeTrackerError {
    /// Worker error during assignment extraction.
    #[error("worker error: {0}")]
    Worker(#[from] crate::python::worker::WorkerError),
}

/// Result type for type tracker operations.
pub type TypeTrackerResult<T> = Result<T, TypeTrackerError>;

// ============================================================================
// Type Tracker
// ============================================================================

/// Tracks type information from assignments and annotations within a single file.
///
/// The TypeTracker processes assignment and annotation information from the
/// LibCST worker and builds a scope-aware type map. Types are resolved through:
///
/// 1. Explicit annotations (Level 2): `x: int` → x has type int
/// 2. Direct constructor calls (Level 1): `x = MyClass()` → x has type MyClass
/// 3. Variable propagation: `y = x` → y inherits x's type
/// 4. Return type propagation (Level 3): `x = get_handler()` where `get_handler() -> Handler`
/// 5. Scope chaining: inner scopes can access outer scope types
///
/// Annotated types take precedence over inferred types.
#[derive(Debug)]
pub struct TypeTracker {
    /// Map from (scope_path, variable_name) to inferred type name (Level 1).
    /// The scope_path is a tuple like ("<module>", "ClassName", "method_name").
    inferred_types: HashMap<(Vec<String>, String), String>,

    /// Map from (scope_path, variable_name) to annotated type name (Level 2).
    /// Takes precedence over inferred_types.
    annotated_types: HashMap<(Vec<String>, String), String>,

    /// Map from (scope_path, function_name) to return type (Level 3).
    /// Built from `__return__` annotations on functions.
    return_types: HashMap<(Vec<String>, String), String>,

    /// Map from scope_path to list of assignments in that scope.
    /// Used for ordering-aware type propagation.
    assignments_by_scope: HashMap<Vec<String>, Vec<TrackedAssignment>>,
}

/// An assignment tracked for type inference.
#[derive(Debug, Clone)]
#[allow(dead_code)] // Fields stored for potential future use
struct TrackedAssignment {
    /// Target variable name.
    target: String,
    /// Inferred type (if directly known from constructor).
    inferred_type: Option<String>,
    /// RHS variable name (for propagation).
    rhs_name: Option<String>,
    /// Callee name for function calls (for return type propagation).
    callee_name: Option<String>,
    /// Byte span of target.
    span: Option<Span>,
    /// Line number.
    line: Option<u32>,
}

impl TypeTracker {
    /// Create a new type tracker.
    pub fn new() -> Self {
        TypeTracker {
            inferred_types: HashMap::new(),
            annotated_types: HashMap::new(),
            return_types: HashMap::new(),
            assignments_by_scope: HashMap::new(),
        }
    }

    /// Process assignment information from the worker (Level 1 + Level 3).
    ///
    /// This populates the internal type map with constructor-based types
    /// and prepares for type propagation. Also handles return type propagation
    /// for function calls when the return type is known.
    pub fn process_assignments(&mut self, assignments: &[AssignmentInfo]) {
        for assignment in assignments {
            let tracked = TrackedAssignment {
                target: assignment.target.clone(),
                inferred_type: assignment.inferred_type.clone(),
                rhs_name: assignment.rhs_name.clone(),
                callee_name: assignment.callee_name.clone(),
                span: assignment
                    .span
                    .as_ref()
                    .map(|s| Span::new(s.start as u64, s.end as u64)),
                line: assignment.line,
            };

            // Store assignment for this scope
            self.assignments_by_scope
                .entry(assignment.scope_path.clone())
                .or_default()
                .push(tracked.clone());

            // If we have a direct type from constructor, record it
            if let Some(ref type_name) = assignment.inferred_type {
                let key = (assignment.scope_path.clone(), assignment.target.clone());
                self.inferred_types.insert(key, type_name.clone());
            }
        }
    }

    /// Process annotation information from the worker (Level 2 + Level 3).
    ///
    /// This populates the annotated type map with types from:
    /// - Function parameters: `def foo(x: int)`
    /// - Return types: `def foo() -> int` (stored in return_types for propagation)
    /// - Variable annotations: `x: int = 5`
    /// - Class attributes: `class Foo: x: int`
    /// - Implicit self/cls in methods
    ///
    /// Annotated types take precedence over inferred types.
    pub fn process_annotations(&mut self, annotations: &[AnnotationInfo]) {
        for ann in annotations {
            // Handle return types separately for Level 3 propagation
            if ann.name == "__return__" {
                // Store return type keyed by (parent_scope, function_name)
                // The scope_path already includes the function name, e.g. ["<module>", "get_handler"]
                // We need to extract the function name from the scope_path
                if !ann.scope_path.is_empty() {
                    // Last element of scope_path is the function name
                    let func_name = ann.scope_path.last().unwrap().clone();
                    // Parent scope is everything except the last element
                    let parent_scope: Vec<String> =
                        ann.scope_path.iter().take(ann.scope_path.len() - 1).cloned().collect();
                    let key = (parent_scope, func_name);
                    self.return_types.insert(key, ann.type_str.clone());
                }
                continue;
            }

            let key = (ann.scope_path.clone(), ann.name.clone());
            self.annotated_types.insert(key, ann.type_str.clone());
        }
    }

    /// Resolve all types through propagation.
    ///
    /// This performs multiple passes to propagate types from variables
    /// to their dependents. For example:
    ///
    /// ```python
    /// x = MyClass()   # x has type MyClass
    /// y = x           # y gets type MyClass (propagated)
    /// z = y           # z gets type MyClass (propagated)
    ///
    /// # Level 3: Return type propagation
    /// def get_handler() -> Handler:
    ///     return Handler()
    /// h = get_handler()  # h gets type Handler (from return type)
    /// ```
    ///
    /// Types are propagated within the same scope and from outer scopes
    /// to inner scopes (following Python's scope chain).
    ///
    /// Note: Annotated types are not propagated (they're explicit).
    pub fn resolve_types(&mut self) {
        // Keep propagating until no changes
        let mut changed = true;
        let mut iterations = 0;
        const MAX_ITERATIONS: u32 = 100; // Safety limit

        while changed && iterations < MAX_ITERATIONS {
            changed = false;
            iterations += 1;

            // Collect all assignments that need type propagation
            let scope_paths: Vec<_> = self.assignments_by_scope.keys().cloned().collect();

            for scope_path in scope_paths {
                if let Some(assignments) = self.assignments_by_scope.get(&scope_path) {
                    for assignment in assignments.iter() {
                        // Skip if already has a type (annotated or inferred)
                        let key = (scope_path.clone(), assignment.target.clone());
                        if self.annotated_types.contains_key(&key)
                            || self.inferred_types.contains_key(&key)
                        {
                            continue;
                        }

                        // Try to propagate from RHS variable
                        if let Some(ref rhs_name) = assignment.rhs_name {
                            if let Some(rhs_type) =
                                self.lookup_type_in_scope_chain(&scope_path, rhs_name)
                            {
                                self.inferred_types.insert(key, rhs_type);
                                changed = true;
                                continue;
                            }
                        }

                        // Level 3: Try to propagate from function call's return type
                        if let Some(ref callee_name) = assignment.callee_name {
                            if let Some(return_type) =
                                self.lookup_return_type_in_scope_chain(&scope_path, callee_name)
                            {
                                self.inferred_types.insert(key, return_type);
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
    }

    /// Look up the return type of a function in the scope chain.
    ///
    /// Searches for the function's return type starting from the given scope
    /// and walking up to outer scopes.
    fn lookup_return_type_in_scope_chain(
        &self,
        scope_path: &[String],
        func_name: &str,
    ) -> Option<String> {
        // Try the current scope
        let key = (scope_path.to_vec(), func_name.to_string());
        if let Some(return_type) = self.return_types.get(&key) {
            return Some(return_type.clone());
        }

        // Walk up the scope chain
        let mut current_path = scope_path.to_vec();
        while !current_path.is_empty() {
            current_path.pop();
            let key = (current_path.clone(), func_name.to_string());
            if let Some(return_type) = self.return_types.get(&key) {
                return Some(return_type.clone());
            }
        }

        None
    }

    /// Look up a type in the scope chain.
    ///
    /// Searches for the variable's type starting from the given scope
    /// and walking up to outer scopes. This implements Python's LEGB
    /// lookup for type information.
    ///
    /// Annotated types take precedence over inferred types.
    fn lookup_type_in_scope_chain(&self, scope_path: &[String], name: &str) -> Option<String> {
        // Try the current scope - annotated first, then inferred
        let key = (scope_path.to_vec(), name.to_string());
        if let Some(type_name) = self.annotated_types.get(&key) {
            return Some(type_name.clone());
        }
        if let Some(type_name) = self.inferred_types.get(&key) {
            return Some(type_name.clone());
        }

        // Walk up the scope chain
        let mut current_path = scope_path.to_vec();
        while !current_path.is_empty() {
            current_path.pop();
            let key = (current_path.clone(), name.to_string());
            // Annotated takes precedence
            if let Some(type_name) = self.annotated_types.get(&key) {
                return Some(type_name.clone());
            }
            if let Some(type_name) = self.inferred_types.get(&key) {
                return Some(type_name.clone());
            }
        }

        None
    }

    /// Get the type of a variable in a specific scope.
    ///
    /// Returns the type name if known, or None if the variable's type
    /// cannot be inferred. Annotated types take precedence over inferred types.
    pub fn type_of(&self, scope_path: &[String], name: &str) -> Option<&str> {
        // First try exact scope - annotated first
        let key = (scope_path.to_vec(), name.to_string());
        if let Some(type_name) = self.annotated_types.get(&key) {
            return Some(type_name.as_str());
        }
        if let Some(type_name) = self.inferred_types.get(&key) {
            return Some(type_name.as_str());
        }

        // Walk up scope chain
        let mut current_path = scope_path.to_vec();
        while !current_path.is_empty() {
            current_path.pop();
            let key = (current_path.clone(), name.to_string());
            // Annotated takes precedence
            if let Some(type_name) = self.annotated_types.get(&key) {
                return Some(type_name.as_str());
            }
            if let Some(type_name) = self.inferred_types.get(&key) {
                return Some(type_name.as_str());
            }
        }

        None
    }

    /// Get the type of a variable along with its source.
    ///
    /// Returns `(type_name, source)` if known, or None if the variable's type
    /// cannot be determined. Annotated types take precedence over inferred types.
    pub fn type_of_with_source(
        &self,
        scope_path: &[String],
        name: &str,
    ) -> Option<(&str, TypeSource)> {
        // First try exact scope - annotated first
        let key = (scope_path.to_vec(), name.to_string());
        if let Some(type_name) = self.annotated_types.get(&key) {
            return Some((type_name.as_str(), TypeSource::Annotated));
        }
        if let Some(type_name) = self.inferred_types.get(&key) {
            return Some((type_name.as_str(), TypeSource::Inferred));
        }

        // Walk up scope chain
        let mut current_path = scope_path.to_vec();
        while !current_path.is_empty() {
            current_path.pop();
            let key = (current_path.clone(), name.to_string());
            // Annotated takes precedence
            if let Some(type_name) = self.annotated_types.get(&key) {
                return Some((type_name.as_str(), TypeSource::Annotated));
            }
            if let Some(type_name) = self.inferred_types.get(&key) {
                return Some((type_name.as_str(), TypeSource::Inferred));
            }
        }

        None
    }

    /// Get all tracked types as a flat list.
    ///
    /// Returns (scope_path, variable_name, type_name) tuples.
    /// Includes both annotated and inferred types.
    pub fn all_types(&self) -> Vec<(&[String], &str, &str)> {
        let mut result: Vec<_> = self
            .annotated_types
            .iter()
            .map(|((scope, name), type_name)| {
                (scope.as_slice(), name.as_str(), type_name.as_str())
            })
            .collect();

        // Add inferred types that aren't already covered by annotations
        for ((scope, name), type_name) in &self.inferred_types {
            let key = (scope.clone(), name.clone());
            if !self.annotated_types.contains_key(&key) {
                result.push((scope.as_slice(), name.as_str(), type_name.as_str()));
            }
        }

        result
    }

    /// Get the number of tracked types.
    ///
    /// Counts unique (scope, name) pairs across both annotated and inferred types.
    pub fn type_count(&self) -> usize {
        let mut count = self.annotated_types.len();
        // Add inferred types that aren't already covered by annotations
        for key in self.inferred_types.keys() {
            if !self.annotated_types.contains_key(key) {
                count += 1;
            }
        }
        count
    }

    /// Get the number of annotated types only.
    pub fn annotated_count(&self) -> usize {
        self.annotated_types.len()
    }

    /// Get the number of inferred types only.
    pub fn inferred_count(&self) -> usize {
        self.inferred_types.len()
    }
}

impl Default for TypeTracker {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Integration with Analyzer
// ============================================================================

/// Analyze a file for type information and populate the type tracker.
///
/// This is the main entry point for type tracking. It:
/// 1. Gets assignment info from the worker (Level 1)
/// 2. Gets annotation info from the worker (Level 2)
/// 3. Processes assignments to extract direct types
/// 4. Processes annotations to extract explicit types
/// 5. Resolves types through propagation
///
/// Annotated types take precedence over inferred types.
pub fn analyze_types(
    worker: &mut WorkerHandle,
    cst_id: &str,
) -> TypeTrackerResult<TypeTracker> {
    // Get assignments from worker (Level 1)
    let assignments = worker.get_assignments(cst_id)?;

    // Get annotations from worker (Level 2)
    let annotations = worker.get_annotations(cst_id)?;

    // Process and resolve types
    let mut tracker = TypeTracker::new();
    tracker.process_assignments(&assignments);
    tracker.process_annotations(&annotations);
    tracker.resolve_types();

    Ok(tracker)
}

/// Analyze a file for type information using combined analysis result.
///
/// This is an optimized version that uses the `get_analysis` combined result
/// to avoid multiple IPC round-trips.
pub fn analyze_types_from_analysis(
    assignments: &[AssignmentInfo],
    annotations: &[AnnotationInfo],
) -> TypeTracker {
    let mut tracker = TypeTracker::new();
    tracker.process_assignments(assignments);
    tracker.process_annotations(annotations);
    tracker.resolve_types();
    tracker
}

// ============================================================================
// Method Resolution
// ============================================================================

/// Result of resolving a method call on a typed variable.
#[derive(Debug, Clone)]
pub struct MethodResolution {
    /// The class that defines the method.
    pub class_name: String,
    /// The method name.
    pub method_name: String,
    /// Whether the resolution is certain (true) or heuristic (false).
    pub certain: bool,
}

/// Resolve a method call on a variable to its defining class.
///
/// Given `obj.method()`, if `obj` has a known type `MyClass`, this resolves
/// the call to `MyClass.method`.
///
/// # Arguments
/// - `tracker`: The type tracker with variable types
/// - `store`: The facts store with symbol information
/// - `scope_path`: The scope where the call occurs
/// - `variable_name`: The variable being called on (e.g., "obj")
/// - `method_name`: The method being called (e.g., "method")
///
/// # Returns
/// - `Some(MethodResolution)` if the type is known and the method exists
/// - `None` if the type cannot be resolved
pub fn resolve_method_call(
    tracker: &TypeTracker,
    store: &FactsStore,
    scope_path: &[String],
    variable_name: &str,
    method_name: &str,
) -> Option<MethodResolution> {
    // Get the variable's type
    let type_name = tracker.type_of(scope_path, variable_name)?;

    // Look up the class in the facts store
    let class_symbols = store.symbols_named(type_name);
    let class_symbol = class_symbols
        .iter()
        .find(|s| s.kind == crate::facts::SymbolKind::Class)?;

    // Look for the method in the class
    let method_symbols = store.symbols_named(method_name);
    let method_in_class = method_symbols.iter().any(|s| {
        (s.kind == crate::facts::SymbolKind::Method || s.kind == crate::facts::SymbolKind::Function)
            && s.container_symbol_id == Some(class_symbol.symbol_id)
    });

    if method_in_class {
        Some(MethodResolution {
            class_name: type_name.to_string(),
            method_name: method_name.to_string(),
            certain: true,
        })
    } else {
        // Method not found in class, but we still know the type
        // Return with certain=false to indicate we couldn't verify
        Some(MethodResolution {
            class_name: type_name.to_string(),
            method_name: method_name.to_string(),
            certain: false,
        })
    }
}

// ============================================================================
// Method Reference Collection
// ============================================================================

use crate::python::worker::MethodCallInfo;

/// A method reference resolved through type inference.
#[derive(Debug, Clone)]
pub struct ResolvedMethodReference {
    /// The class that defines the method.
    pub class_name: String,
    /// The method name.
    pub method_name: String,
    /// Byte span of the method name in the call (for renaming).
    pub span: Span,
    /// Scope path where the call occurs.
    pub scope_path: Vec<String>,
}

/// Find method references that should be renamed when a class method is renamed.
///
/// Given:
/// - `class_name`: The class defining the method (e.g., "MyHandler")
/// - `method_name`: The method being renamed (e.g., "process")
/// - `tracker`: Type information for variables
/// - `method_calls`: Method call patterns from the file
///
/// Returns spans where `obj.method()` should be renamed because `obj` has type `class_name`.
pub fn find_typed_method_references(
    class_name: &str,
    method_name: &str,
    tracker: &TypeTracker,
    method_calls: &[MethodCallInfo],
) -> Vec<ResolvedMethodReference> {
    let mut references = Vec::new();

    for call in method_calls {
        // Check if this call is for the method we're renaming
        if call.method != method_name {
            continue;
        }

        // Check if the receiver has the type we're looking for
        if let Some(receiver_type) = tracker.type_of(&call.scope_path, &call.receiver) {
            if receiver_type == class_name {
                // Found a match - the receiver is of the class type
                if let Some(ref method_span) = call.method_span {
                    references.push(ResolvedMethodReference {
                        class_name: class_name.to_string(),
                        method_name: method_name.to_string(),
                        span: Span::new(method_span.start as u64, method_span.end as u64),
                        scope_path: call.scope_path.clone(),
                    });
                }
            }
        }
    }

    references
}

// ============================================================================
// FactsStore Integration
// ============================================================================

/// Populate TypeInfo entries in the FactsStore from type tracking.
///
/// This integrates the type tracker's types with the FactsStore,
/// creating TypeInfo entries for symbols whose types are known.
/// Annotated types are marked as such; inferred types are marked as inferred.
pub fn populate_type_info(tracker: &TypeTracker, store: &mut FactsStore, file_id: FileId) {
    // Collect type info to insert (to avoid borrow issues)
    // (symbol_id, type_name, is_annotated)
    let mut to_insert: Vec<(SymbolId, String, bool)> = Vec::new();

    // First process annotated types (they take precedence)
    for ((_scope_path, var_name), type_name) in &tracker.annotated_types {
        // Find the symbol for this variable
        let symbols = store.symbols_named(var_name);
        for symbol in symbols {
            // Check if this symbol is in the right file
            if symbol.decl_file_id != file_id {
                continue;
            }

            // Check if we already have type info for this symbol
            if store.type_of_symbol(symbol.symbol_id).is_some() {
                continue;
            }

            // Queue for insertion (annotated)
            to_insert.push((symbol.symbol_id, type_name.clone(), true));
        }
    }

    // Then process inferred types (skip if already has annotated type)
    for ((_scope_path, var_name), type_name) in &tracker.inferred_types {
        // Find the symbol for this variable
        let symbols = store.symbols_named(var_name);
        for symbol in symbols {
            // Check if this symbol is in the right file
            if symbol.decl_file_id != file_id {
                continue;
            }

            // Check if we already have type info for this symbol
            if store.type_of_symbol(symbol.symbol_id).is_some() {
                continue;
            }

            // Check if we already queued an annotated type
            if to_insert
                .iter()
                .any(|(sid, _, _)| *sid == symbol.symbol_id)
            {
                continue;
            }

            // Queue for insertion (inferred)
            to_insert.push((symbol.symbol_id, type_name.clone(), false));
        }
    }

    // Insert all collected type info
    for (symbol_id, type_name, is_annotated) in to_insert {
        let type_info = if is_annotated {
            TypeInfo::annotated(symbol_id, type_name)
        } else {
            TypeInfo::inferred(symbol_id, type_name)
        };
        store.insert_type(type_info);
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod type_tracker_tests {
        use super::*;

        fn make_assignment(
            target: &str,
            scope_path: Vec<&str>,
            inferred_type: Option<&str>,
            rhs_name: Option<&str>,
        ) -> AssignmentInfo {
            make_assignment_full(target, scope_path, inferred_type, rhs_name, None)
        }

        fn make_assignment_full(
            target: &str,
            scope_path: Vec<&str>,
            inferred_type: Option<&str>,
            rhs_name: Option<&str>,
            callee_name: Option<&str>,
        ) -> AssignmentInfo {
            use crate::python::worker::SpanInfo;
            AssignmentInfo {
                target: target.to_string(),
                scope_path: scope_path.into_iter().map(String::from).collect(),
                type_source: if inferred_type.is_some() {
                    "constructor".to_string()
                } else if rhs_name.is_some() {
                    "variable".to_string()
                } else if callee_name.is_some() {
                    "function_call".to_string()
                } else {
                    "unknown".to_string()
                },
                inferred_type: inferred_type.map(String::from),
                rhs_name: rhs_name.map(String::from),
                callee_name: callee_name.map(String::from),
                span: Some(SpanInfo { start: 0, end: 1 }),
                line: Some(1),
                col: Some(1),
            }
        }

        #[test]
        fn constructor_type_inference() {
            let mut tracker = TypeTracker::new();

            let assignments = vec![make_assignment(
                "handler",
                vec!["<module>"],
                Some("MyHandler"),
                None,
            )];

            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "handler"),
                Some("MyHandler")
            );
        }

        #[test]
        fn variable_propagation() {
            let mut tracker = TypeTracker::new();

            let assignments = vec![
                make_assignment("x", vec!["<module>"], Some("MyClass"), None),
                make_assignment("y", vec!["<module>"], None, Some("x")),
            ];

            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "x"),
                Some("MyClass")
            );
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "y"),
                Some("MyClass")
            );
        }

        #[test]
        fn chained_propagation() {
            let mut tracker = TypeTracker::new();

            let assignments = vec![
                make_assignment("x", vec!["<module>"], Some("MyClass"), None),
                make_assignment("y", vec!["<module>"], None, Some("x")),
                make_assignment("z", vec!["<module>"], None, Some("y")),
            ];

            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "x"),
                Some("MyClass")
            );
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "y"),
                Some("MyClass")
            );
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "z"),
                Some("MyClass")
            );
        }

        #[test]
        fn scope_aware_type_tracking() {
            let mut tracker = TypeTracker::new();

            let assignments = vec![
                // x = MyClass() at module level
                make_assignment("x", vec!["<module>"], Some("MyClass"), None),
                // y = x inside function (should inherit from outer scope)
                make_assignment("y", vec!["<module>", "func"], None, Some("x")),
            ];

            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            // x is in module scope
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "x"),
                Some("MyClass")
            );
            // y is in func scope but gets x's type from outer scope
            assert_eq!(
                tracker.type_of(&["<module>".to_string(), "func".to_string()], "y"),
                Some("MyClass")
            );
        }

        #[test]
        fn scope_shadowing() {
            let mut tracker = TypeTracker::new();

            let assignments = vec![
                // x = MyClass() at module level
                make_assignment("x", vec!["<module>"], Some("MyClass"), None),
                // x = OtherClass() inside function (shadows outer)
                make_assignment("x", vec!["<module>", "func"], Some("OtherClass"), None),
            ];

            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            // Module scope x is MyClass
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "x"),
                Some("MyClass")
            );
            // Function scope x is OtherClass (shadowed)
            assert_eq!(
                tracker.type_of(&["<module>".to_string(), "func".to_string()], "x"),
                Some("OtherClass")
            );
        }

        #[test]
        fn chained_assignment_all_targets() {
            // a = b = MyClass() should give both a and b type MyClass
            let mut tracker = TypeTracker::new();

            // The Python worker sends separate assignments for each target
            let assignments = vec![
                make_assignment("a", vec!["<module>"], Some("MyClass"), None),
                make_assignment("b", vec!["<module>"], Some("MyClass"), None),
            ];

            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "a"),
                Some("MyClass")
            );
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "b"),
                Some("MyClass")
            );
        }

        #[test]
        fn unknown_type() {
            let mut tracker = TypeTracker::new();

            let assignments = vec![make_assignment("x", vec!["<module>"], None, None)];

            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            // Unknown type source means no type
            assert_eq!(tracker.type_of(&["<module>".to_string()], "x"), None);
        }

        #[test]
        fn type_count() {
            let mut tracker = TypeTracker::new();

            let assignments = vec![
                make_assignment("x", vec!["<module>"], Some("MyClass"), None),
                make_assignment("y", vec!["<module>"], None, Some("x")),
            ];

            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            assert_eq!(tracker.type_count(), 2);
        }

        #[test]
        fn all_types() {
            let mut tracker = TypeTracker::new();

            let assignments = vec![
                make_assignment("x", vec!["<module>"], Some("MyClass"), None),
                make_assignment("y", vec!["<module>", "func"], Some("OtherClass"), None),
            ];

            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            let all = tracker.all_types();
            assert_eq!(all.len(), 2);
        }

        #[test]
        fn deeply_nested_scope_propagation() {
            let mut tracker = TypeTracker::new();

            let assignments = vec![
                // x = MyClass() at module level
                make_assignment("x", vec!["<module>"], Some("MyClass"), None),
                // y = x in outer function
                make_assignment("y", vec!["<module>", "outer"], None, Some("x")),
                // z = y in inner function
                make_assignment("z", vec!["<module>", "outer", "inner"], None, Some("y")),
            ];

            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "x"),
                Some("MyClass")
            );
            assert_eq!(
                tracker.type_of(&["<module>".to_string(), "outer".to_string()], "y"),
                Some("MyClass")
            );
            assert_eq!(
                tracker.type_of(
                    &["<module>".to_string(), "outer".to_string(), "inner".to_string()],
                    "z"
                ),
                Some("MyClass")
            );
        }

        #[test]
        fn class_method_scope() {
            let mut tracker = TypeTracker::new();

            let assignments = vec![
                // self.handler = MyHandler() in __init__ (tracked as local variable)
                make_assignment(
                    "handler",
                    vec!["<module>", "MyClass", "__init__"],
                    Some("MyHandler"),
                    None,
                ),
            ];

            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            assert_eq!(
                tracker.type_of(
                    &[
                        "<module>".to_string(),
                        "MyClass".to_string(),
                        "__init__".to_string()
                    ],
                    "handler"
                ),
                Some("MyHandler")
            );
        }

        #[test]
        fn propagation_from_outer_class_scope() {
            let mut tracker = TypeTracker::new();

            let assignments = vec![
                // class_attr = MyClass() at class body level
                make_assignment("class_attr", vec!["<module>", "MyClass"], Some("MyClass"), None),
                // local = class_attr in method - should NOT propagate (Python quirk)
                // Actually in Python, class scope doesn't form closure, so this wouldn't work
                // But for simplicity, our type tracker does allow it
                make_assignment(
                    "local",
                    vec!["<module>", "MyClass", "method"],
                    None,
                    Some("class_attr"),
                ),
            ];

            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            // Class attr has type
            assert_eq!(
                tracker.type_of(&["<module>".to_string(), "MyClass".to_string()], "class_attr"),
                Some("MyClass")
            );
            // Local gets propagated type (our tracker allows this)
            assert_eq!(
                tracker.type_of(
                    &[
                        "<module>".to_string(),
                        "MyClass".to_string(),
                        "method".to_string()
                    ],
                    "local"
                ),
                Some("MyClass")
            );
        }

        #[test]
        fn return_type_propagation_basic() {
            // Test: def get_handler() -> Handler
            //       h = get_handler()  # h should have type Handler
            let mut tracker = TypeTracker::new();
            use crate::python::worker::AnnotationInfo;

            // First, process the return type annotation for get_handler
            let annotations = vec![AnnotationInfo {
                name: "__return__".to_string(),
                type_str: "Handler".to_string(),
                annotation_kind: "simple".to_string(),
                source_kind: "return".to_string(),
                scope_path: vec!["<module>".to_string(), "get_handler".to_string()],
                span: None,
                line: Some(1),
                col: Some(1),
            }];
            tracker.process_annotations(&annotations);

            // Now process the assignment: h = get_handler()
            let assignments = vec![make_assignment_full(
                "h",
                vec!["<module>"],
                None,                     // no direct inferred type
                None,                     // no rhs_name
                Some("get_handler"),      // callee_name
            )];
            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            // h should have type Handler from the return type
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "h"),
                Some("Handler")
            );
        }

        #[test]
        fn return_type_propagation_nested_scope() {
            // Test: def get_handler() -> Handler
            //       def use_handler():
            //           h = get_handler()  # h should have type Handler
            let mut tracker = TypeTracker::new();
            use crate::python::worker::AnnotationInfo;

            // Return type annotation for get_handler at module scope
            let annotations = vec![AnnotationInfo {
                name: "__return__".to_string(),
                type_str: "Handler".to_string(),
                annotation_kind: "simple".to_string(),
                source_kind: "return".to_string(),
                scope_path: vec!["<module>".to_string(), "get_handler".to_string()],
                span: None,
                line: Some(1),
                col: Some(1),
            }];
            tracker.process_annotations(&annotations);

            // Assignment inside use_handler function
            let assignments = vec![make_assignment_full(
                "h",
                vec!["<module>", "use_handler"],
                None,
                None,
                Some("get_handler"),
            )];
            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            // h in use_handler should have type Handler (found by scope chain lookup)
            assert_eq!(
                tracker.type_of(&["<module>".to_string(), "use_handler".to_string()], "h"),
                Some("Handler")
            );
        }

        #[test]
        fn return_type_propagation_chained() {
            // Test: def get_handler() -> Handler
            //       h = get_handler()
            //       h2 = h  # h2 should also have type Handler
            let mut tracker = TypeTracker::new();
            use crate::python::worker::AnnotationInfo;

            // Return type annotation
            let annotations = vec![AnnotationInfo {
                name: "__return__".to_string(),
                type_str: "Handler".to_string(),
                annotation_kind: "simple".to_string(),
                source_kind: "return".to_string(),
                scope_path: vec!["<module>".to_string(), "get_handler".to_string()],
                span: None,
                line: Some(1),
                col: Some(1),
            }];
            tracker.process_annotations(&annotations);

            // h = get_handler()
            // h2 = h
            let assignments = vec![
                make_assignment_full("h", vec!["<module>"], None, None, Some("get_handler")),
                make_assignment("h2", vec!["<module>"], None, Some("h")),
            ];
            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            // h should have type Handler
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "h"),
                Some("Handler")
            );
            // h2 should also have type Handler (propagated from h)
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "h2"),
                Some("Handler")
            );
        }

        #[test]
        fn return_type_propagation_method() {
            // Test: class Factory:
            //         def create(self) -> Product
            //       factory = Factory()
            //       p = factory.create()  # This won't work with just callee_name "create"
            //       # But direct: p = create() with def create() -> Product should work
            let mut tracker = TypeTracker::new();
            use crate::python::worker::AnnotationInfo;

            // Return type for a module-level factory function
            let annotations = vec![AnnotationInfo {
                name: "__return__".to_string(),
                type_str: "Product".to_string(),
                annotation_kind: "simple".to_string(),
                source_kind: "return".to_string(),
                scope_path: vec!["<module>".to_string(), "create_product".to_string()],
                span: None,
                line: Some(1),
                col: Some(1),
            }];
            tracker.process_annotations(&annotations);

            let assignments = vec![make_assignment_full(
                "product",
                vec!["<module>"],
                None,
                None,
                Some("create_product"),
            )];
            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "product"),
                Some("Product")
            );
        }
    }

    mod annotation_tests {
        use super::*;
        use crate::python::worker::AnnotationInfo;

        fn make_annotation(
            name: &str,
            type_str: &str,
            scope_path: Vec<&str>,
            source_kind: &str,
        ) -> AnnotationInfo {
            use crate::python::worker::SpanInfo;
            AnnotationInfo {
                name: name.to_string(),
                type_str: type_str.to_string(),
                annotation_kind: "simple".to_string(),
                source_kind: source_kind.to_string(),
                scope_path: scope_path.into_iter().map(String::from).collect(),
                span: Some(SpanInfo { start: 0, end: 1 }),
                line: Some(1),
                col: Some(1),
            }
        }

        fn make_assignment(
            target: &str,
            scope_path: Vec<&str>,
            inferred_type: Option<&str>,
        ) -> AssignmentInfo {
            use crate::python::worker::SpanInfo;
            AssignmentInfo {
                target: target.to_string(),
                scope_path: scope_path.into_iter().map(String::from).collect(),
                type_source: if inferred_type.is_some() {
                    "constructor".to_string()
                } else {
                    "unknown".to_string()
                },
                inferred_type: inferred_type.map(String::from),
                rhs_name: None,
                callee_name: None,
                span: Some(SpanInfo { start: 0, end: 1 }),
                line: Some(1),
                col: Some(1),
            }
        }

        #[test]
        fn simple_type_annotation() {
            let mut tracker = TypeTracker::new();

            let annotations = vec![make_annotation("x", "int", vec!["<module>"], "variable")];

            tracker.process_annotations(&annotations);
            tracker.resolve_types();

            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "x"),
                Some("int")
            );
        }

        #[test]
        fn function_parameter_annotation() {
            let mut tracker = TypeTracker::new();

            // def foo(handler: MyHandler)
            let annotations = vec![make_annotation(
                "handler",
                "MyHandler",
                vec!["<module>", "foo"],
                "parameter",
            )];

            tracker.process_annotations(&annotations);
            tracker.resolve_types();

            assert_eq!(
                tracker.type_of(&["<module>".to_string(), "foo".to_string()], "handler"),
                Some("MyHandler")
            );
        }

        #[test]
        fn class_attribute_annotation() {
            let mut tracker = TypeTracker::new();

            // class Foo: x: int
            let annotations = vec![make_annotation("x", "int", vec!["<module>", "Foo"], "attribute")];

            tracker.process_annotations(&annotations);
            tracker.resolve_types();

            assert_eq!(
                tracker.type_of(&["<module>".to_string(), "Foo".to_string()], "x"),
                Some("int")
            );
        }

        #[test]
        fn generic_type_annotation() {
            let mut tracker = TypeTracker::new();

            let annotations = vec![
                make_annotation("items", "List[int]", vec!["<module>"], "variable"),
                make_annotation("mapping", "Dict[str, int]", vec!["<module>"], "variable"),
            ];

            tracker.process_annotations(&annotations);
            tracker.resolve_types();

            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "items"),
                Some("List[int]")
            );
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "mapping"),
                Some("Dict[str, int]")
            );
        }

        #[test]
        fn annotated_type_precedence_over_inferred() {
            let mut tracker = TypeTracker::new();

            // x: MyClass = something()  -- annotation should take precedence
            let assignments = vec![make_assignment("x", vec!["<module>"], Some("SomethingElse"))];
            let annotations = vec![make_annotation("x", "MyClass", vec!["<module>"], "variable")];

            tracker.process_assignments(&assignments);
            tracker.process_annotations(&annotations);
            tracker.resolve_types();

            // Annotated type should take precedence
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "x"),
                Some("MyClass")
            );
        }

        #[test]
        fn type_of_with_source_annotated() {
            let mut tracker = TypeTracker::new();

            let annotations = vec![make_annotation("x", "int", vec!["<module>"], "variable")];

            tracker.process_annotations(&annotations);
            tracker.resolve_types();

            let result = tracker.type_of_with_source(&["<module>".to_string()], "x");
            assert!(result.is_some());
            let (type_name, source) = result.unwrap();
            assert_eq!(type_name, "int");
            assert_eq!(source, TypeSource::Annotated);
        }

        #[test]
        fn type_of_with_source_inferred() {
            let mut tracker = TypeTracker::new();

            let assignments = vec![make_assignment("x", vec!["<module>"], Some("MyClass"))];

            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            let result = tracker.type_of_with_source(&["<module>".to_string()], "x");
            assert!(result.is_some());
            let (type_name, source) = result.unwrap();
            assert_eq!(type_name, "MyClass");
            assert_eq!(source, TypeSource::Inferred);
        }

        #[test]
        fn self_parameter_type() {
            let mut tracker = TypeTracker::new();

            // class MyClass:
            //     def method(self):  -- self should have type MyClass (implicit)
            let annotations = vec![make_annotation(
                "self",
                "MyClass",
                vec!["<module>", "MyClass", "method"],
                "parameter",
            )];

            tracker.process_annotations(&annotations);
            tracker.resolve_types();

            assert_eq!(
                tracker.type_of(
                    &[
                        "<module>".to_string(),
                        "MyClass".to_string(),
                        "method".to_string()
                    ],
                    "self"
                ),
                Some("MyClass")
            );
        }

        #[test]
        fn annotated_count() {
            let mut tracker = TypeTracker::new();

            let assignments = vec![make_assignment("x", vec!["<module>"], Some("MyClass"))];
            let annotations = vec![
                make_annotation("y", "int", vec!["<module>"], "variable"),
                make_annotation("z", "str", vec!["<module>"], "variable"),
            ];

            tracker.process_assignments(&assignments);
            tracker.process_annotations(&annotations);
            tracker.resolve_types();

            assert_eq!(tracker.annotated_count(), 2);
            assert_eq!(tracker.inferred_count(), 1);
            assert_eq!(tracker.type_count(), 3);
        }

        #[test]
        fn annotated_and_inferred_same_variable() {
            let mut tracker = TypeTracker::new();

            // Both annotated and inferred for same variable
            let assignments = vec![make_assignment("x", vec!["<module>"], Some("InferredType"))];
            let annotations = vec![make_annotation("x", "AnnotatedType", vec!["<module>"], "variable")];

            tracker.process_assignments(&assignments);
            tracker.process_annotations(&annotations);
            tracker.resolve_types();

            // Annotated should be preferred
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "x"),
                Some("AnnotatedType")
            );
            // But both are stored
            assert_eq!(tracker.annotated_count(), 1);
            assert_eq!(tracker.inferred_count(), 1);
            // type_count de-duplicates
            assert_eq!(tracker.type_count(), 1);
        }

        #[test]
        fn scope_chain_with_annotations() {
            let mut tracker = TypeTracker::new();

            // Annotated in outer scope, referenced in inner
            let annotations = vec![make_annotation("x", "Handler", vec!["<module>"], "variable")];

            tracker.process_annotations(&annotations);
            tracker.resolve_types();

            // Should be visible from inner scope
            assert_eq!(
                tracker.type_of(&["<module>".to_string(), "func".to_string()], "x"),
                Some("Handler")
            );
        }
    }

    mod integration_tests {
        use super::*;
        use crate::python::test_helpers::require_python_with_libcst;
        use crate::python::worker::spawn_worker;
        use tempfile::TempDir;

        #[test]
        fn analyze_types_integration() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();

            let content = r#"
class MyHandler:
    def process(self):
        pass

handler = MyHandler()
handler.process()
"#;

            let parse_response = worker.parse("test.py", content).unwrap();
            let tracker = analyze_types(&mut worker, &parse_response.cst_id).unwrap();

            // handler should have type MyHandler
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "handler"),
                Some("MyHandler")
            );
        }

        #[test]
        fn analyze_types_with_propagation() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();

            let content = r#"
class MyClass:
    pass

x = MyClass()
y = x
z = y
"#;

            let parse_response = worker.parse("test.py", content).unwrap();
            let tracker = analyze_types(&mut worker, &parse_response.cst_id).unwrap();

            // All should have type MyClass
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "x"),
                Some("MyClass")
            );
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "y"),
                Some("MyClass")
            );
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "z"),
                Some("MyClass")
            );
        }

        #[test]
        fn analyze_types_in_function() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();

            let content = r#"
class Handler:
    def do_thing(self):
        pass

def process():
    h = Handler()
    h.do_thing()
"#;

            let parse_response = worker.parse("test.py", content).unwrap();
            let tracker = analyze_types(&mut worker, &parse_response.cst_id).unwrap();

            // h should have type Handler in the function scope
            assert_eq!(
                tracker.type_of(&["<module>".to_string(), "process".to_string()], "h"),
                Some("Handler")
            );
        }

        #[test]
        fn method_resolution_test() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();

            let content = r#"
class MyHandler:
    def process(self):
        pass

handler = MyHandler()
handler.process()
"#;

            // Parse and get type info
            let parse_response = worker.parse("test.py", content).unwrap();
            let tracker = analyze_types(&mut worker, &parse_response.cst_id).unwrap();

            // Build facts store
            let mut store = FactsStore::new();
            let adapter = crate::python::analyzer::PythonAdapter::new(temp.path().to_str().unwrap());
            adapter
                .analyze_files(
                    &mut worker,
                    &[("test.py".to_string(), content.to_string())],
                    &mut store,
                )
                .unwrap();

            // Resolve method call
            let resolution = resolve_method_call(
                &tracker,
                &store,
                &["<module>".to_string()],
                "handler",
                "process",
            );

            assert!(resolution.is_some());
            let res = resolution.unwrap();
            assert_eq!(res.class_name, "MyHandler");
            assert_eq!(res.method_name, "process");
            assert!(res.certain);
        }

        #[test]
        fn find_typed_method_references_integration() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();

            let content = r#"
class MyHandler:
    def process(self):
        pass

handler = MyHandler()
handler.process()
"#;

            // Parse and analyze
            let parse_response = worker.parse("test.py", content).unwrap();
            let tracker = analyze_types(&mut worker, &parse_response.cst_id).unwrap();
            let method_calls = worker.get_method_calls(&parse_response.cst_id).unwrap();

            // Find typed method references
            let refs = find_typed_method_references("MyHandler", "process", &tracker, &method_calls);

            // Should find handler.process() as a reference
            assert_eq!(refs.len(), 1);
            assert_eq!(refs[0].class_name, "MyHandler");
            assert_eq!(refs[0].method_name, "process");
        }

        #[test]
        fn find_multiple_typed_method_references() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();

            let content = r#"
class MyHandler:
    def process(self):
        pass

h1 = MyHandler()
h2 = MyHandler()
h3 = h1

h1.process()
h2.process()
h3.process()
"#;

            let parse_response = worker.parse("test.py", content).unwrap();
            let tracker = analyze_types(&mut worker, &parse_response.cst_id).unwrap();
            let method_calls = worker.get_method_calls(&parse_response.cst_id).unwrap();

            let refs = find_typed_method_references("MyHandler", "process", &tracker, &method_calls);

            // Should find all three calls: h1.process(), h2.process(), h3.process()
            assert_eq!(refs.len(), 3);
        }

        #[test]
        fn method_reference_only_matches_correct_type() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();

            let content = r#"
class Handler1:
    def process(self):
        pass

class Handler2:
    def process(self):
        pass

h1 = Handler1()
h2 = Handler2()

h1.process()
h2.process()
"#;

            let parse_response = worker.parse("test.py", content).unwrap();
            let tracker = analyze_types(&mut worker, &parse_response.cst_id).unwrap();
            let method_calls = worker.get_method_calls(&parse_response.cst_id).unwrap();

            // Looking for Handler1.process should only find h1.process()
            let refs1 = find_typed_method_references("Handler1", "process", &tracker, &method_calls);
            assert_eq!(refs1.len(), 1);

            // Looking for Handler2.process should only find h2.process()
            let refs2 = find_typed_method_references("Handler2", "process", &tracker, &method_calls);
            assert_eq!(refs2.len(), 1);
        }

        #[test]
        fn method_reference_in_function_scope() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();

            let content = r#"
class Service:
    def execute(self):
        pass

def use_service():
    svc = Service()
    svc.execute()
"#;

            let parse_response = worker.parse("test.py", content).unwrap();
            let tracker = analyze_types(&mut worker, &parse_response.cst_id).unwrap();
            let method_calls = worker.get_method_calls(&parse_response.cst_id).unwrap();

            let refs = find_typed_method_references("Service", "execute", &tracker, &method_calls);

            assert_eq!(refs.len(), 1);
            assert_eq!(refs[0].scope_path, vec!["<module>", "use_service"]);
        }

        #[test]
        fn method_reference_with_variable_propagation() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();

            let content = r#"
class Database:
    def connect(self):
        pass

db = Database()
connection = db
connection.connect()
"#;

            let parse_response = worker.parse("test.py", content).unwrap();
            let tracker = analyze_types(&mut worker, &parse_response.cst_id).unwrap();
            let method_calls = worker.get_method_calls(&parse_response.cst_id).unwrap();

            // connection inherits type from db, so connection.connect() should resolve
            let refs = find_typed_method_references("Database", "connect", &tracker, &method_calls);

            assert_eq!(refs.len(), 1);
        }

        #[test]
        fn analyze_types_with_annotations() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();

            let content = r#"
x: int = 5
y: str = "hello"

def process(handler: Handler) -> str:
    return handler.name
"#;

            let parse_response = worker.parse("test.py", content).unwrap();
            let tracker = analyze_types(&mut worker, &parse_response.cst_id).unwrap();

            // Variable annotations
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "x"),
                Some("int")
            );
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "y"),
                Some("str")
            );

            // Parameter annotation
            assert_eq!(
                tracker.type_of(&["<module>".to_string(), "process".to_string()], "handler"),
                Some("Handler")
            );
        }

        #[test]
        fn annotated_method_resolution() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();

            let content = r#"
class Handler:
    def process(self):
        pass

def use_handler(h: Handler):
    h.process()
"#;

            let parse_response = worker.parse("test.py", content).unwrap();
            let tracker = analyze_types(&mut worker, &parse_response.cst_id).unwrap();
            let method_calls = worker.get_method_calls(&parse_response.cst_id).unwrap();

            // h has type Handler from annotation, so h.process() should resolve
            let refs = find_typed_method_references("Handler", "process", &tracker, &method_calls);

            assert_eq!(refs.len(), 1);
        }

        #[test]
        fn self_parameter_from_class() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();

            let content = r#"
class MyClass:
    def method(self):
        pass
"#;

            let parse_response = worker.parse("test.py", content).unwrap();
            let tracker = analyze_types(&mut worker, &parse_response.cst_id).unwrap();

            // self should have type MyClass (implicitly)
            assert_eq!(
                tracker.type_of(
                    &[
                        "<module>".to_string(),
                        "MyClass".to_string(),
                        "method".to_string()
                    ],
                    "self"
                ),
                Some("MyClass")
            );
        }

        #[test]
        fn annotation_precedence_integration() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();

            // Annotation should take precedence over constructor inference
            let content = r#"
class Handler:
    pass

class SubHandler(Handler):
    pass

# Annotation says Handler, constructor says SubHandler
x: Handler = SubHandler()
"#;

            let parse_response = worker.parse("test.py", content).unwrap();
            let tracker = analyze_types(&mut worker, &parse_response.cst_id).unwrap();

            // Annotation takes precedence
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "x"),
                Some("Handler")
            );
        }

        #[test]
        fn generic_annotation_integration() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();

            let content = r#"
from typing import List, Dict, Optional

items: List[int] = []
mapping: Dict[str, int] = {}
maybe: Optional[str] = None
"#;

            let parse_response = worker.parse("test.py", content).unwrap();
            let tracker = analyze_types(&mut worker, &parse_response.cst_id).unwrap();

            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "items"),
                Some("List[int]")
            );
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "mapping"),
                Some("Dict[str, int]")
            );
            assert_eq!(
                tracker.type_of(&["<module>".to_string()], "maybe"),
                Some("Optional[str]")
            );
        }
    }

    mod method_call_unit_tests {
        use super::*;
        use crate::python::worker::SpanInfo;

        fn make_method_call(
            receiver: &str,
            method: &str,
            scope_path: Vec<&str>,
        ) -> MethodCallInfo {
            MethodCallInfo {
                receiver: receiver.to_string(),
                method: method.to_string(),
                scope_path: scope_path.into_iter().map(String::from).collect(),
                method_span: Some(SpanInfo { start: 0, end: 10 }),
                line: Some(1),
                col: Some(1),
            }
        }

        fn make_assignment(
            target: &str,
            scope_path: Vec<&str>,
            inferred_type: Option<&str>,
        ) -> AssignmentInfo {
            use crate::python::worker::SpanInfo;
            AssignmentInfo {
                target: target.to_string(),
                scope_path: scope_path.into_iter().map(String::from).collect(),
                type_source: if inferred_type.is_some() {
                    "constructor".to_string()
                } else {
                    "unknown".to_string()
                },
                inferred_type: inferred_type.map(String::from),
                rhs_name: None,
                callee_name: None,
                span: Some(SpanInfo { start: 0, end: 1 }),
                line: Some(1),
                col: Some(1),
            }
        }

        #[test]
        fn find_matching_method_reference() {
            let mut tracker = TypeTracker::new();
            tracker.process_assignments(&[make_assignment("h", vec!["<module>"], Some("Handler"))]);
            tracker.resolve_types();

            let method_calls = vec![make_method_call("h", "process", vec!["<module>"])];

            let refs = find_typed_method_references("Handler", "process", &tracker, &method_calls);
            assert_eq!(refs.len(), 1);
        }

        #[test]
        fn no_match_for_different_type() {
            let mut tracker = TypeTracker::new();
            tracker.process_assignments(&[make_assignment("h", vec!["<module>"], Some("Handler"))]);
            tracker.resolve_types();

            let method_calls = vec![make_method_call("h", "process", vec!["<module>"])];

            // Looking for OtherClass.process should not match
            let refs = find_typed_method_references("OtherClass", "process", &tracker, &method_calls);
            assert!(refs.is_empty());
        }

        #[test]
        fn no_match_for_different_method() {
            let mut tracker = TypeTracker::new();
            tracker.process_assignments(&[make_assignment("h", vec!["<module>"], Some("Handler"))]);
            tracker.resolve_types();

            let method_calls = vec![make_method_call("h", "process", vec!["<module>"])];

            // Looking for Handler.other_method should not match
            let refs = find_typed_method_references("Handler", "other_method", &tracker, &method_calls);
            assert!(refs.is_empty());
        }

        #[test]
        fn no_match_for_unknown_receiver_type() {
            let tracker = TypeTracker::new(); // Empty - no type info

            let method_calls = vec![make_method_call("h", "process", vec!["<module>"])];

            let refs = find_typed_method_references("Handler", "process", &tracker, &method_calls);
            assert!(refs.is_empty());
        }

        #[test]
        fn multiple_method_calls_same_receiver() {
            let mut tracker = TypeTracker::new();
            tracker.process_assignments(&[make_assignment("h", vec!["<module>"], Some("Handler"))]);
            tracker.resolve_types();

            let method_calls = vec![
                make_method_call("h", "process", vec!["<module>"]),
                make_method_call("h", "process", vec!["<module>"]),
            ];

            let refs = find_typed_method_references("Handler", "process", &tracker, &method_calls);
            assert_eq!(refs.len(), 2);
        }

        #[test]
        fn scope_aware_matching() {
            let mut tracker = TypeTracker::new();
            tracker.process_assignments(&[
                make_assignment("h", vec!["<module>"], Some("GlobalHandler")),
                make_assignment("h", vec!["<module>", "func"], Some("LocalHandler")),
            ]);
            tracker.resolve_types();

            let method_calls = vec![
                make_method_call("h", "process", vec!["<module>"]),
                make_method_call("h", "process", vec!["<module>", "func"]),
            ];

            // Global scope h is GlobalHandler
            let refs1 = find_typed_method_references("GlobalHandler", "process", &tracker, &method_calls);
            assert_eq!(refs1.len(), 1);
            assert_eq!(refs1[0].scope_path, vec!["<module>"]);

            // Function scope h is LocalHandler
            let refs2 = find_typed_method_references("LocalHandler", "process", &tracker, &method_calls);
            assert_eq!(refs2.len(), 1);
            assert_eq!(refs2[0].scope_path, vec!["<module>", "func"]);
        }
    }
}
