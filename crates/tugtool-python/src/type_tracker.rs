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

use tugtool_core::facts::{FactsStore, SymbolId, TypeInfo, TypeNode, TypeSource};
use tugtool_core::patch::{FileId, Span};

use crate::types::{AnnotationInfo, AssignmentInfo, AttributeTypeInfo};
use std::collections::HashMap;
use thiserror::Error;
use tugtool_python_cst::SignatureInfo;

// ============================================================================
// Error Types
// ============================================================================

/// Errors during type tracking.
#[derive(Debug, Error)]
pub enum TypeTrackerError {
    /// IO error.
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Result type for type tracker operations.
pub type TypeTrackerResult<T> = Result<T, TypeTrackerError>;

// ============================================================================
// Type Tracker
// ============================================================================

/// Type and optional TypeNode pair for annotated types.
///
/// Stores both the string representation (for backward compatibility)
/// and the structured `TypeNode` (when available from CST collection).
#[derive(Debug, Clone)]
pub struct AnnotatedType {
    /// The type as a string (e.g., "int", "List[str]").
    pub type_str: String,
    /// Structured type representation, if available.
    pub type_node: Option<TypeNode>,
}

/// Tracks type information from assignments and annotations within a single file.
///
/// The TypeTracker processes assignment and annotation information from the
/// CST analysis and builds a scope-aware type map. Types are resolved through:
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
    /// The scope_path is a tuple like (`"<module>"`, `"ClassName"`, `"method_name"`).
    inferred_types: HashMap<(Vec<String>, String), String>,

    /// Map from (scope_path, variable_name) to annotated type (Level 2).
    /// Stores both the type string and optional TypeNode.
    /// Takes precedence over inferred_types.
    annotated_types: HashMap<(Vec<String>, String), AnnotatedType>,

    /// Map from (scope_path, function_name) to return type (Level 3).
    /// Built from `__return__` annotations on functions.
    /// Stores both the type string and optional TypeNode.
    return_types: HashMap<(Vec<String>, String), AnnotatedType>,

    /// Map from scope_path to list of assignments in that scope.
    /// Used for ordering-aware type propagation.
    assignments_by_scope: HashMap<Vec<String>, Vec<TrackedAssignment>>,

    /// Map from (class_name, attribute_name) to attribute type info.
    /// Stores both string and optional TypeNode for callable return extraction.
    /// Populated from class-level annotations and `self.attr = ...` in __init__.
    attribute_types: HashMap<(String, String), AttributeTypeInfo>,

    /// Map from (class_name, method_name) to return type string.
    /// Populated from signatures where `is_method` is true and return type is present.
    /// Used for method call resolution in dotted paths like `self.handler.process()`.
    method_return_types: HashMap<(String, String), String>,
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
            attribute_types: HashMap::new(),
            method_return_types: HashMap::new(),
        }
    }

    /// Process assignment information from the CST analysis (Level 1 + Level 3).
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
                span: assignment.span.as_ref().map(|s| Span::new(s.start, s.end)),
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

    /// Process annotation information from the CST analysis (Level 2 + Level 3).
    ///
    /// This populates the annotated type map with types from:
    /// - Function parameters: `def foo(x: int)`
    /// - Return types: `def foo() -> int` (stored in return_types for propagation)
    /// - Variable annotations: `x: int = 5`
    /// - Class attributes: `class Foo: x: int` (also stored in attribute_types)
    /// - Implicit self/cls in methods
    ///
    /// Annotated types take precedence over inferred types.
    /// The structured `TypeNode` is preserved from CST collection time.
    pub fn process_annotations(&mut self, annotations: &[AnnotationInfo]) {
        for ann in annotations {
            let annotated_type = AnnotatedType {
                type_str: ann.type_str.clone(),
                type_node: ann.type_node.clone(),
            };

            // Handle return types separately for Level 3 propagation
            if ann.name == "__return__" {
                // Store return type keyed by (parent_scope, function_name)
                // The scope_path already includes the function name, e.g. ["<module>", "get_handler"]
                // We need to extract the function name from the scope_path
                if !ann.scope_path.is_empty() {
                    // Last element of scope_path is the function name
                    let func_name = ann.scope_path.last().unwrap().clone();
                    // Parent scope is everything except the last element
                    let parent_scope: Vec<String> = ann
                        .scope_path
                        .iter()
                        .take(ann.scope_path.len() - 1)
                        .cloned()
                        .collect();
                    let key = (parent_scope, func_name);
                    self.return_types.insert(key, annotated_type);
                }
                continue;
            }

            // Handle class-level attribute annotations: class C: attr: Type
            // These are stored in attribute_types for receiver resolution.
            // The annotation takes precedence over inferred types (inserted first).
            if ann.source_kind == "attribute" {
                // Extract the class name from scope_path.
                // For `class C: attr: Handler`, scope_path is ["<module>", "C"]
                // The last element is the class name.
                if !ann.scope_path.is_empty() {
                    let class_name = ann.scope_path.last().unwrap().clone();
                    let attr_name = ann.name.clone();
                    let key = (class_name, attr_name);

                    // Annotations have highest precedence, so we always insert.
                    // Later inferred types (from __init__) should NOT override this.
                    let attr_info = AttributeTypeInfo {
                        type_str: ann.type_str.clone(),
                        type_node: ann.type_node.clone(),
                    };
                    self.attribute_types.insert(key, attr_info);
                }
            }

            let key = (ann.scope_path.clone(), ann.name.clone());
            self.annotated_types.insert(key, annotated_type);
        }
    }

    /// Process instance attribute assignments from `__init__` methods.
    ///
    /// This collects attribute types from `self.attr = ...` patterns in `__init__`
    /// and populates the `attribute_types` map. The collection rules are:
    ///
    /// 1. **Class-level annotation**: Already handled by `process_annotations`
    /// 2. **Instance annotation**: `self.attr: Type = ...` (has annotation)
    /// 3. **Constructor assignment**: `self.attr = TypeName()` in `__init__`
    /// 4. **Assignment propagation**: `self.attr = other_var` in `__init__`
    ///
    /// Annotations have highest precedence - if an attribute already has an
    /// annotation-based type from `process_annotations`, we do NOT override it.
    ///
    /// # Arguments
    /// - `assignments`: Assignment information from CST analysis
    pub fn process_instance_attributes(&mut self, assignments: &[AssignmentInfo]) {
        for assignment in assignments {
            // Only process self-attribute assignments
            if !assignment.is_self_attribute {
                continue;
            }

            let attr_name = match &assignment.attribute_name {
                Some(name) => name.clone(),
                None => continue, // Should not happen if is_self_attribute is true
            };

            // Extract class name from scope_path.
            // For `__init__` methods, scope_path is like ["<module>", "MyClass", "__init__"]
            // The class name is the element before `__init__`.
            // For methods outside `__init__`, we still want to track if there's an annotation.
            let scope_path = &assignment.scope_path;
            if scope_path.len() < 2 {
                continue; // Need at least ["<module>", "ClassName"] or more
            }

            // Check if we're in __init__ context (for constructor/propagation inference)
            let in_init = scope_path.last().map(|s| s == "__init__").unwrap_or(false);

            // Get class name - it's the second-to-last element if in __init__,
            // or we need to find it based on context
            let class_name = if in_init && scope_path.len() >= 2 {
                // ["<module>", "MyClass", "__init__"] -> "MyClass"
                scope_path.get(scope_path.len() - 2).cloned()
            } else if scope_path.len() >= 2 {
                // For non-__init__ methods like ["<module>", "MyClass", "other_method"]
                // The class name is still second-to-last
                scope_path.get(scope_path.len() - 2).cloned()
            } else {
                None
            };

            let class_name = match class_name {
                Some(name) => name,
                None => continue,
            };

            let key = (class_name.clone(), attr_name);

            // Check if this attribute already has a type from annotations.
            // Annotations have highest precedence - don't override them.
            if self.attribute_types.contains_key(&key) {
                continue;
            }

            // Only infer types from __init__ assignments (constructor or propagation)
            if !in_init {
                // Outside __init__, we only record if there's an annotation (already handled above)
                // or if this assignment has an explicit inferred_type from constructor pattern
                if let Some(ref type_name) = assignment.inferred_type {
                    // Constructor pattern: self.handler = Handler()
                    let attr_info = AttributeTypeInfo {
                        type_str: type_name.clone(),
                        type_node: None, // No TypeNode for inferred types
                    };
                    self.attribute_types.insert(key, attr_info);
                }
                continue;
            }

            // In __init__, try to infer type from the assignment
            let inferred_type = if let Some(ref type_name) = assignment.inferred_type {
                // Constructor pattern: self.handler = Handler()
                Some(type_name.clone())
            } else if let Some(ref rhs_name) = assignment.rhs_name {
                // Propagation pattern: self.data = other_var
                // Look up the type of other_var in the current scope
                self.lookup_type_in_scope_chain(&assignment.scope_path, rhs_name)
            } else {
                // Unknown type source - can't infer
                None
            };

            if let Some(type_str) = inferred_type {
                let attr_info = AttributeTypeInfo {
                    type_str,
                    type_node: None, // No TypeNode for inferred types
                };
                self.attribute_types.insert(key, attr_info);
            }
        }
    }

    /// Process function/method signatures to extract method return types.
    ///
    /// This populates the `method_return_types` map for methods with return type
    /// annotations. The map is keyed by `(class_name, method_name)` and stores
    /// the return type string.
    ///
    /// # Arguments
    /// - `signatures`: Signature information from CST analysis
    ///
    /// # Note
    /// Only signatures where `is_method` is true are processed. Top-level function
    /// return types are already handled by `process_annotations` via `__return__`
    /// annotations and stored in `return_types`.
    pub fn process_signatures(&mut self, signatures: &[SignatureInfo]) {
        for sig in signatures {
            // Only process methods (functions defined inside classes)
            if !sig.is_method {
                continue;
            }

            // Only process if there's a return type annotation
            let return_type = match &sig.returns {
                Some(ret) => ret.clone(),
                None => continue,
            };

            // Extract class name from scope_path.
            // For methods, scope_path is like ["<module>", "MyClass"]
            // The method name is in sig.name, class name is the last element of scope_path.
            let class_name = match sig.scope_path.last() {
                Some(name) => name.clone(),
                None => continue,
            };

            let key = (class_name, sig.name.clone());

            // Don't override if already present (first wins, matching other precedence patterns)
            self.method_return_types.entry(key).or_insert(return_type);
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

        // Collect scope paths once - they don't change during resolution
        // This avoids cloning all keys on every iteration of the while loop
        let scope_paths: Vec<Vec<String>> = self.assignments_by_scope.keys().cloned().collect();

        while changed && iterations < MAX_ITERATIONS {
            changed = false;
            iterations += 1;

            for scope_path in &scope_paths {
                if let Some(assignments) = self.assignments_by_scope.get(scope_path) {
                    for assignment in assignments.iter() {
                        // Build key once for all lookups/inserts
                        let key = (scope_path.clone(), assignment.target.clone());

                        // Skip if already has a type (annotated or inferred)
                        if self.annotated_types.contains_key(&key)
                            || self.inferred_types.contains_key(&key)
                        {
                            continue;
                        }

                        // Try to propagate from RHS variable
                        if let Some(ref rhs_name) = assignment.rhs_name {
                            if let Some(rhs_type) =
                                self.lookup_type_in_scope_chain(scope_path, rhs_name)
                            {
                                self.inferred_types.insert(key, rhs_type);
                                changed = true;
                                continue;
                            }
                        }

                        // Level 3: Try to propagate from function call's return type
                        if let Some(ref callee_name) = assignment.callee_name {
                            if let Some(return_type) =
                                self.lookup_return_type_in_scope_chain(scope_path, callee_name)
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
            return Some(return_type.type_str.clone());
        }

        // Walk up the scope chain
        let mut current_path = scope_path.to_vec();
        while !current_path.is_empty() {
            current_path.pop();
            let key = (current_path.clone(), func_name.to_string());
            if let Some(return_type) = self.return_types.get(&key) {
                return Some(return_type.type_str.clone());
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
        if let Some(annotated) = self.annotated_types.get(&key) {
            return Some(annotated.type_str.clone());
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
            if let Some(annotated) = self.annotated_types.get(&key) {
                return Some(annotated.type_str.clone());
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
        if let Some(annotated) = self.annotated_types.get(&key) {
            return Some(annotated.type_str.as_str());
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
            if let Some(annotated) = self.annotated_types.get(&key) {
                return Some(annotated.type_str.as_str());
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
        if let Some(annotated) = self.annotated_types.get(&key) {
            return Some((annotated.type_str.as_str(), TypeSource::Annotated));
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
            if let Some(annotated) = self.annotated_types.get(&key) {
                return Some((annotated.type_str.as_str(), TypeSource::Annotated));
            }
            if let Some(type_name) = self.inferred_types.get(&key) {
                return Some((type_name.as_str(), TypeSource::Inferred));
            }
        }

        None
    }

    /// Get the annotated type info for a variable, including the TypeNode if available.
    ///
    /// Returns the full `AnnotatedType` if the variable has an explicit annotation.
    /// This is used by `populate_type_info` to set `TypeInfo.structured`.
    pub fn annotated_type_of(&self, scope_path: &[String], name: &str) -> Option<&AnnotatedType> {
        // First try exact scope
        let key = (scope_path.to_vec(), name.to_string());
        if let Some(annotated) = self.annotated_types.get(&key) {
            return Some(annotated);
        }

        // Walk up scope chain
        let mut current_path = scope_path.to_vec();
        while !current_path.is_empty() {
            current_path.pop();
            let key = (current_path.clone(), name.to_string());
            if let Some(annotated) = self.annotated_types.get(&key) {
                return Some(annotated);
            }
        }

        None
    }

    /// Get the type of a class attribute.
    ///
    /// Looks up the type of an attribute on a class, populated from
    /// class-level annotations and `self.attr = ...` in `__init__`.
    ///
    /// # Arguments
    /// - `class_name`: The name of the class (e.g., "Service")
    /// - `attr_name`: The name of the attribute (e.g., "handler")
    ///
    /// # Returns
    /// - `Some(&AttributeTypeInfo)` if the attribute type is known
    /// - `None` if the attribute type is not tracked
    pub fn attribute_type_of(
        &self,
        class_name: &str,
        attr_name: &str,
    ) -> Option<&AttributeTypeInfo> {
        let key = (class_name.to_string(), attr_name.to_string());
        self.attribute_types.get(&key)
    }

    /// Get the return type of a method on a class.
    ///
    /// Looks up the return type of a method on a class, populated from
    /// function signatures where `is_method` is true.
    ///
    /// # Arguments
    /// - `class_name`: The name of the class (e.g., "Handler")
    /// - `method_name`: The name of the method (e.g., "process")
    ///
    /// # Returns
    /// - `Some(&str)` with the return type string if the method has a return type annotation
    /// - `None` if the method has no return type or is not tracked
    ///
    /// # Note
    /// This is distinct from `return_type_of`, which handles top-level functions.
    /// Method return types are keyed by (class_name, method_name), while function
    /// return types are keyed by (scope_path, function_name).
    pub fn method_return_type_of(&self, class_name: &str, method_name: &str) -> Option<&str> {
        let key = (class_name.to_string(), method_name.to_string());
        self.method_return_types.get(&key).map(|s| s.as_str())
    }

    /// Get the return type of a top-level function.
    ///
    /// Looks up the return type of a function by searching the scope chain,
    /// starting from the given scope and walking up to outer scopes.
    ///
    /// # Arguments
    /// - `scope_path`: The current scope path where the function is called
    /// - `func_name`: The name of the function
    ///
    /// # Returns
    /// - `Some(&str)` with the return type string if the function has a return type annotation
    /// - `None` if the function has no return type or is not found
    ///
    /// # Note
    /// This is for top-level functions. For methods, use `method_return_type_of`.
    pub fn return_type_of(&self, scope_path: &[String], func_name: &str) -> Option<&str> {
        // Try the current scope first
        let key = (scope_path.to_vec(), func_name.to_string());
        if let Some(return_type) = self.return_types.get(&key) {
            return Some(return_type.type_str.as_str());
        }

        // Walk up the scope chain
        let mut current_path = scope_path.to_vec();
        while !current_path.is_empty() {
            current_path.pop();
            let key = (current_path.clone(), func_name.to_string());
            if let Some(return_type) = self.return_types.get(&key) {
                return Some(return_type.type_str.as_str());
            }
        }

        None
    }

    /// Extract the return type from a Callable type annotation.
    ///
    /// When an attribute is annotated as `Callable[..., T]`, this method extracts `T`
    /// as the return type. This enables resolution of callable attribute invocations
    /// like `self.handler_factory().process()`.
    ///
    /// # Arguments
    /// - `type_info`: The attribute type information containing the Callable annotation
    ///
    /// # Returns
    /// - `Some(return_type)` if the type is `Callable[..., T]` and T can be extracted
    /// - `None` if the type is not Callable or the return type cannot be extracted
    ///
    /// # Supported Patterns
    /// - `Callable[[], Handler]` → `Some("Handler")`
    /// - `Callable[[int, str], Handler]` → `Some("Handler")`
    /// - `Callable[..., Handler]` → `Some("Handler")`
    ///
    /// # Limitations
    /// - Complex return types like `Union[A, B]` or `List[T]` return `None` when
    ///   extracted from string parsing (TypeNode may provide better support)
    /// - Only simple named return types are reliably extracted from string annotations
    pub fn callable_return_type_of(type_info: &AttributeTypeInfo) -> Option<String> {
        // Prefer TypeNode if available (most precise)
        if let Some(TypeNode::Callable { returns, .. }) = &type_info.type_node {
            // Extract the type name from the returns TypeNode
            return Self::extract_type_name(returns);
        }

        // Fall back to parsing type_str for "Callable[..., ReturnType]" pattern
        // This is a conservative parse - return None if uncertain
        let type_str = &type_info.type_str;
        if type_str.starts_with("Callable[") && type_str.ends_with(']') {
            // Find the last comma that separates params from return type
            // Handle nested brackets: Callable[[int, str], Handler]
            let inner = &type_str[9..type_str.len() - 1]; // Strip "Callable[" and "]"
            if let Some(last_comma) = find_top_level_comma(inner) {
                let return_part = inner[last_comma + 1..].trim();
                if !return_part.is_empty() && return_part != "None" {
                    return Some(return_part.to_string());
                }
            }
        }

        None // Conservative: return None if we can't extract return type
    }

    /// Extract a type name string from a TypeNode.
    ///
    /// Returns the full type representation including type arguments.
    /// For example: `Named { name: "List", args: [Named { name: "Item", ... }] }` → `"List[Item]"`
    fn extract_type_name(type_node: &TypeNode) -> Option<String> {
        match type_node {
            TypeNode::Named { name, args } if args.is_empty() => Some(name.clone()),
            TypeNode::Named { name, args } => {
                // Build full representation like "List[Item]" or "Dict[str, int]"
                let arg_strs: Vec<String> =
                    args.iter().filter_map(Self::extract_type_name).collect();
                if arg_strs.is_empty() {
                    Some(name.clone())
                } else {
                    Some(format!("{}[{}]", name, arg_strs.join(", ")))
                }
            }
            _ => None,
        }
    }

    /// Get all tracked types as a flat list.
    ///
    /// Returns (scope_path, variable_name, type_name) tuples.
    /// Includes both annotated and inferred types.
    pub fn all_types(&self) -> Vec<(&[String], &str, &str)> {
        let mut result: Vec<_> = self
            .annotated_types
            .iter()
            .map(|((scope, name), annotated)| {
                (scope.as_slice(), name.as_str(), annotated.type_str.as_str())
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

/// Find the last comma at the top level (not inside brackets) in a string.
///
/// Used for parsing `Callable[..., ReturnType]` annotations where we need to
/// find the comma separating the parameter types from the return type.
///
/// # Arguments
/// - `s`: The string to search (should be the inner part of `Callable[...]`)
///
/// # Returns
/// - `Some(index)` of the last top-level comma
/// - `None` if no top-level comma is found
///
/// # Examples
/// - `"[], Handler"` → `Some(2)` (the comma after `[]`)
/// - `"[int, str], Handler"` → `Some(11)` (the comma after `]`)
/// - `"Handler"` → `None` (no comma)
fn find_top_level_comma(s: &str) -> Option<usize> {
    let mut depth: usize = 0;
    let mut last_comma = None;

    for (i, c) in s.char_indices() {
        match c {
            '[' | '(' | '{' => depth += 1,
            ']' | ')' | '}' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => last_comma = Some(i),
            _ => {}
        }
    }

    last_comma
}

impl Default for TypeTracker {
    fn default() -> Self {
        Self::new()
    }
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
        .find(|s| s.kind == tugtool_core::facts::SymbolKind::Class)?;

    // Look for the method in the class
    let method_symbols = store.symbols_named(method_name);
    let method_in_class = method_symbols.iter().any(|s| {
        (s.kind == tugtool_core::facts::SymbolKind::Method
            || s.kind == tugtool_core::facts::SymbolKind::Function)
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

use crate::types::MethodCallInfo;

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
                        span: Span::new(method_span.start, method_span.end),
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

/// Collected type info for insertion into FactsStore.
struct TypeInfoToInsert {
    symbol_id: SymbolId,
    type_str: String,
    type_node: Option<TypeNode>,
    is_annotated: bool,
}

/// Populate TypeInfo entries in the FactsStore from type tracking.
///
/// This integrates the type tracker's types with the FactsStore,
/// creating TypeInfo entries for symbols whose types are known.
/// Annotated types are marked as such; inferred types are marked as inferred.
///
/// When a structured `TypeNode` is available from CST collection, it is
/// included in the TypeInfo via `TypeInfo::with_structured()`.
pub fn populate_type_info(tracker: &TypeTracker, store: &mut FactsStore, file_id: FileId) {
    // Collect type info to insert (to avoid borrow issues)
    let mut to_insert: Vec<TypeInfoToInsert> = Vec::new();

    // First process annotated types (they take precedence)
    for ((_scope_path, var_name), annotated_type) in &tracker.annotated_types {
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

            // Queue for insertion (annotated with optional TypeNode)
            to_insert.push(TypeInfoToInsert {
                symbol_id: symbol.symbol_id,
                type_str: annotated_type.type_str.clone(),
                type_node: annotated_type.type_node.clone(),
                is_annotated: true,
            });
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
                .any(|info| info.symbol_id == symbol.symbol_id)
            {
                continue;
            }

            // Queue for insertion (inferred - no TypeNode available)
            to_insert.push(TypeInfoToInsert {
                symbol_id: symbol.symbol_id,
                type_str: type_name.clone(),
                type_node: None,
                is_annotated: false,
            });
        }
    }

    // Insert all collected type info
    for info in to_insert {
        let type_info = if info.is_annotated {
            let mut ti = TypeInfo::annotated(info.symbol_id, info.type_str);
            // Add structured TypeNode if available
            if let Some(node) = info.type_node {
                ti = ti.with_structured(node);
            }
            ti
        } else {
            TypeInfo::inferred(info.symbol_id, info.type_str)
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
            use crate::types::SpanInfo;
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
                is_self_attribute: false,
                attribute_name: None,
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

            // The CST analysis sends separate assignments for each target
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
                    &[
                        "<module>".to_string(),
                        "outer".to_string(),
                        "inner".to_string()
                    ],
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
                make_assignment(
                    "class_attr",
                    vec!["<module>", "MyClass"],
                    Some("MyClass"),
                    None,
                ),
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
                tracker.type_of(
                    &["<module>".to_string(), "MyClass".to_string()],
                    "class_attr"
                ),
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
            use crate::types::AnnotationInfo;

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
                type_node: None,
            }];
            tracker.process_annotations(&annotations);

            // Now process the assignment: h = get_handler()
            let assignments = vec![make_assignment_full(
                "h",
                vec!["<module>"],
                None,                // no direct inferred type
                None,                // no rhs_name
                Some("get_handler"), // callee_name
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
            use crate::types::AnnotationInfo;

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
                type_node: None,
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
            use crate::types::AnnotationInfo;

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
                type_node: None,
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
            use crate::types::AnnotationInfo;

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
                type_node: None,
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
        use crate::types::AnnotationInfo;

        fn make_annotation(
            name: &str,
            type_str: &str,
            scope_path: Vec<&str>,
            source_kind: &str,
        ) -> AnnotationInfo {
            use crate::types::SpanInfo;
            AnnotationInfo {
                name: name.to_string(),
                type_str: type_str.to_string(),
                annotation_kind: "simple".to_string(),
                source_kind: source_kind.to_string(),
                scope_path: scope_path.into_iter().map(String::from).collect(),
                span: Some(SpanInfo { start: 0, end: 1 }),
                line: Some(1),
                col: Some(1),
                type_node: None,
            }
        }

        fn make_assignment(
            target: &str,
            scope_path: Vec<&str>,
            inferred_type: Option<&str>,
        ) -> AssignmentInfo {
            use crate::types::SpanInfo;
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
                is_self_attribute: false,
                attribute_name: None,
            }
        }

        #[test]
        fn simple_type_annotation() {
            let mut tracker = TypeTracker::new();

            let annotations = vec![make_annotation("x", "int", vec!["<module>"], "variable")];

            tracker.process_annotations(&annotations);
            tracker.resolve_types();

            assert_eq!(tracker.type_of(&["<module>".to_string()], "x"), Some("int"));
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
            let annotations = vec![make_annotation(
                "x",
                "int",
                vec!["<module>", "Foo"],
                "attribute",
            )];

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
            let assignments = vec![make_assignment(
                "x",
                vec!["<module>"],
                Some("SomethingElse"),
            )];
            let annotations = vec![make_annotation(
                "x",
                "MyClass",
                vec!["<module>"],
                "variable",
            )];

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
            let annotations = vec![make_annotation(
                "x",
                "AnnotatedType",
                vec!["<module>"],
                "variable",
            )];

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
            let annotations = vec![make_annotation(
                "x",
                "Handler",
                vec!["<module>"],
                "variable",
            )];

            tracker.process_annotations(&annotations);
            tracker.resolve_types();

            // Should be visible from inner scope
            assert_eq!(
                tracker.type_of(&["<module>".to_string(), "func".to_string()], "x"),
                Some("Handler")
            );
        }
    }

    mod attribute_type_tests {
        use super::*;
        use crate::types::AttributeTypeInfo;

        #[test]
        fn attribute_type_of_returns_none_for_unknown_attribute() {
            let tracker = TypeTracker::new();

            // No attributes have been added, so lookup should return None
            assert!(tracker.attribute_type_of("Service", "handler").is_none());
            assert!(tracker.attribute_type_of("UnknownClass", "attr").is_none());
        }

        #[test]
        fn attribute_type_of_returns_type_when_manually_inserted() {
            let mut tracker = TypeTracker::new();

            // Manually insert an attribute type
            let attr_info = AttributeTypeInfo {
                type_str: "Handler".to_string(),
                type_node: None,
            };
            tracker
                .attribute_types
                .insert(("Service".to_string(), "handler".to_string()), attr_info);

            // Now lookup should succeed
            let result = tracker.attribute_type_of("Service", "handler");
            assert!(result.is_some());
            assert_eq!(result.unwrap().type_str, "Handler");
        }

        #[test]
        fn attribute_type_of_distinguishes_different_classes() {
            let mut tracker = TypeTracker::new();

            // Insert attribute types for two different classes
            tracker.attribute_types.insert(
                ("Service".to_string(), "handler".to_string()),
                AttributeTypeInfo {
                    type_str: "Handler".to_string(),
                    type_node: None,
                },
            );
            tracker.attribute_types.insert(
                ("Controller".to_string(), "handler".to_string()),
                AttributeTypeInfo {
                    type_str: "OtherHandler".to_string(),
                    type_node: None,
                },
            );

            // Each class should have its own attribute type
            assert_eq!(
                tracker
                    .attribute_type_of("Service", "handler")
                    .unwrap()
                    .type_str,
                "Handler"
            );
            assert_eq!(
                tracker
                    .attribute_type_of("Controller", "handler")
                    .unwrap()
                    .type_str,
                "OtherHandler"
            );
        }

        #[test]
        fn attribute_type_of_distinguishes_different_attributes() {
            let mut tracker = TypeTracker::new();

            // Insert two different attributes on the same class
            tracker.attribute_types.insert(
                ("Service".to_string(), "handler".to_string()),
                AttributeTypeInfo {
                    type_str: "Handler".to_string(),
                    type_node: None,
                },
            );
            tracker.attribute_types.insert(
                ("Service".to_string(), "logger".to_string()),
                AttributeTypeInfo {
                    type_str: "Logger".to_string(),
                    type_node: None,
                },
            );

            // Each attribute should have its own type
            assert_eq!(
                tracker
                    .attribute_type_of("Service", "handler")
                    .unwrap()
                    .type_str,
                "Handler"
            );
            assert_eq!(
                tracker
                    .attribute_type_of("Service", "logger")
                    .unwrap()
                    .type_str,
                "Logger"
            );

            // Unknown attribute on known class returns None
            assert!(tracker.attribute_type_of("Service", "unknown").is_none());
        }

        #[test]
        fn class_level_annotation_populates_attribute_types() {
            // Test: class C: attr: Handler -> attribute_type_of("C", "attr").type_str == "Handler"
            use crate::types::AnnotationInfo;

            let mut tracker = TypeTracker::new();

            // Simulate a class-level attribute annotation: class C: attr: Handler
            let annotations = vec![AnnotationInfo {
                name: "attr".to_string(),
                type_str: "Handler".to_string(),
                annotation_kind: "simple".to_string(),
                source_kind: "attribute".to_string(), // This is the key: "attribute"
                scope_path: vec!["<module>".to_string(), "C".to_string()],
                span: None,
                line: Some(2),
                col: Some(5),
                type_node: None,
            }];

            tracker.process_annotations(&annotations);

            // The attribute_types map should now have the entry
            let result = tracker.attribute_type_of("C", "attr");
            assert!(
                result.is_some(),
                "attribute_type_of should find the attribute"
            );
            assert_eq!(result.unwrap().type_str, "Handler");
        }

        #[test]
        fn annotation_overrides_manual_insertion() {
            // Test: Both annotation and inference present -> annotation wins
            use crate::types::AnnotationInfo;

            let mut tracker = TypeTracker::new();

            // First, manually insert an "inferred" type (simulating what Step 1c will do)
            tracker.attribute_types.insert(
                ("C".to_string(), "attr".to_string()),
                AttributeTypeInfo {
                    type_str: "InferredType".to_string(),
                    type_node: None,
                },
            );

            // Now process an annotation that should override it
            let annotations = vec![AnnotationInfo {
                name: "attr".to_string(),
                type_str: "AnnotatedType".to_string(),
                annotation_kind: "simple".to_string(),
                source_kind: "attribute".to_string(),
                scope_path: vec!["<module>".to_string(), "C".to_string()],
                span: None,
                line: Some(2),
                col: Some(5),
                type_node: None,
            }];

            tracker.process_annotations(&annotations);

            // The annotation should have overwritten the inferred type
            let result = tracker.attribute_type_of("C", "attr");
            assert!(result.is_some());
            assert_eq!(
                result.unwrap().type_str,
                "AnnotatedType",
                "annotation should override inferred type"
            );
        }

        #[test]
        fn annotation_preserves_type_node() {
            // Test: TypeNode is preserved when available
            use crate::types::AnnotationInfo;
            use tugtool_core::facts::TypeNode;

            let mut tracker = TypeTracker::new();

            // Create annotation with a TypeNode
            let annotations = vec![AnnotationInfo {
                name: "handler".to_string(),
                type_str: "Handler".to_string(),
                annotation_kind: "simple".to_string(),
                source_kind: "attribute".to_string(),
                scope_path: vec!["<module>".to_string(), "Service".to_string()],
                span: None,
                line: Some(2),
                col: Some(5),
                type_node: Some(TypeNode::Named {
                    name: "Handler".to_string(),
                    args: vec![],
                }),
            }];

            tracker.process_annotations(&annotations);

            let result = tracker.attribute_type_of("Service", "handler");
            assert!(result.is_some());
            let attr_info = result.unwrap();
            assert_eq!(attr_info.type_str, "Handler");
            assert!(
                attr_info.type_node.is_some(),
                "TypeNode should be preserved"
            );
            if let Some(TypeNode::Named { name, .. }) = &attr_info.type_node {
                assert_eq!(name, "Handler");
            } else {
                panic!("Expected TypeNode::Named");
            }
        }
    }

    mod instance_attribute_tests {
        use super::*;
        use crate::types::{AnnotationInfo, SpanInfo};

        /// Helper to create a self-attribute assignment for testing.
        fn make_self_attr_assignment(
            attr_name: &str,
            scope_path: Vec<&str>,
            inferred_type: Option<&str>,
            rhs_name: Option<&str>,
        ) -> AssignmentInfo {
            AssignmentInfo {
                target: format!("self.{}", attr_name),
                scope_path: scope_path.into_iter().map(String::from).collect(),
                type_source: if inferred_type.is_some() {
                    "constructor".to_string()
                } else if rhs_name.is_some() {
                    "variable".to_string()
                } else {
                    "unknown".to_string()
                },
                inferred_type: inferred_type.map(String::from),
                rhs_name: rhs_name.map(String::from),
                callee_name: None,
                span: Some(SpanInfo { start: 0, end: 1 }),
                line: Some(1),
                col: Some(1),
                is_self_attribute: true,
                attribute_name: Some(attr_name.to_string()),
            }
        }

        /// Helper to create a regular assignment (not self.attr).
        fn make_assignment(
            target: &str,
            scope_path: Vec<&str>,
            inferred_type: Option<&str>,
        ) -> AssignmentInfo {
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
                is_self_attribute: false,
                attribute_name: None,
            }
        }

        #[test]
        fn self_handler_equals_handler_in_init() {
            // Test: self.handler = Handler() in __init__ -> attribute type_str is "Handler"
            let mut tracker = TypeTracker::new();

            let assignments = vec![make_self_attr_assignment(
                "handler",
                vec!["<module>", "Service", "__init__"],
                Some("Handler"), // inferred_type from constructor
                None,
            )];

            tracker.process_instance_attributes(&assignments);

            let result = tracker.attribute_type_of("Service", "handler");
            assert!(
                result.is_some(),
                "attribute_type_of should find the attribute"
            );
            assert_eq!(result.unwrap().type_str, "Handler");
        }

        #[test]
        fn annotation_takes_precedence_over_inferred() {
            // Test: self.handler: Handler = create() -> annotation takes precedence
            let mut tracker = TypeTracker::new();

            // First, add the class-level annotation (this would be done by process_annotations)
            let annotations = vec![AnnotationInfo {
                name: "handler".to_string(),
                type_str: "Handler".to_string(),
                annotation_kind: "simple".to_string(),
                source_kind: "attribute".to_string(),
                scope_path: vec!["<module>".to_string(), "Service".to_string()],
                span: None,
                line: Some(2),
                col: Some(5),
                type_node: None,
            }];
            tracker.process_annotations(&annotations);

            // Now process an __init__ assignment that would infer a different type
            // (e.g., from a function call that returns "SomeOtherType")
            let assignments = vec![make_self_attr_assignment(
                "handler",
                vec!["<module>", "Service", "__init__"],
                Some("SomeOtherType"), // Different type from annotation
                None,
            )];

            tracker.process_instance_attributes(&assignments);

            // Annotation should win
            let result = tracker.attribute_type_of("Service", "handler");
            assert!(result.is_some());
            assert_eq!(
                result.unwrap().type_str,
                "Handler",
                "annotation should take precedence over inferred type"
            );
        }

        #[test]
        fn self_data_equals_other_var_propagates_type() {
            // Test: self.data = other_var propagates type_str of other_var
            let mut tracker = TypeTracker::new();

            // First, set up the type of other_var (would be done by process_annotations/assignments)
            let annotations = vec![AnnotationInfo {
                name: "source".to_string(),
                type_str: "DataSource".to_string(),
                annotation_kind: "simple".to_string(),
                source_kind: "parameter".to_string(),
                scope_path: vec![
                    "<module>".to_string(),
                    "Service".to_string(),
                    "__init__".to_string(),
                ],
                span: None,
                line: Some(3),
                col: Some(5),
                type_node: None,
            }];
            tracker.process_annotations(&annotations);

            // Now process the self.data = source assignment
            let assignments = vec![make_self_attr_assignment(
                "data",
                vec!["<module>", "Service", "__init__"],
                None,           // No direct inferred type
                Some("source"), // RHS is the variable 'source'
            )];

            tracker.process_instance_attributes(&assignments);

            // The type should be propagated from 'source'
            let result = tracker.attribute_type_of("Service", "data");
            assert!(
                result.is_some(),
                "attribute_type_of should find the attribute"
            );
            assert_eq!(
                result.unwrap().type_str,
                "DataSource",
                "type should be propagated from source variable"
            );
        }

        #[test]
        fn non_init_self_assignment_with_inferred_type_recorded() {
            // Test: Non-__init__ self assignments with inferred_type still recorded
            // When we have self.attr = SomeClass() outside of __init__ but still have
            // a direct constructor call, it should be recorded.
            let mut tracker = TypeTracker::new();

            let assignments = vec![make_self_attr_assignment(
                "lazy_handler",
                vec!["<module>", "Service", "get_handler"], // Not in __init__
                Some("LazyHandler"),                        // Has inferred type from constructor
                None,
            )];

            tracker.process_instance_attributes(&assignments);

            // Should be recorded because it has an explicit inferred_type
            let result = tracker.attribute_type_of("Service", "lazy_handler");
            assert!(
                result.is_some(),
                "non-__init__ self assignment with inferred_type should be recorded"
            );
            assert_eq!(result.unwrap().type_str, "LazyHandler");
        }

        #[test]
        fn non_init_self_assignment_without_type_not_recorded() {
            // When self.attr = something() outside of __init__ and no inferred_type,
            // the attribute should NOT be recorded (we only infer in __init__).
            let mut tracker = TypeTracker::new();

            let assignments = vec![make_self_attr_assignment(
                "dynamic_data",
                vec!["<module>", "Service", "some_method"], // Not in __init__
                None,                                       // No inferred type
                Some("unknown_var"),                        // RHS is a variable
            )];

            tracker.process_instance_attributes(&assignments);

            // Should NOT be recorded because we're not in __init__ and no direct inferred_type
            let result = tracker.attribute_type_of("Service", "dynamic_data");
            assert!(
                result.is_none(),
                "non-__init__ self assignment without inferred_type should not be recorded"
            );
        }

        #[test]
        fn multiple_attributes_on_same_class() {
            // Test that we can track multiple attributes on the same class
            let mut tracker = TypeTracker::new();

            let assignments = vec![
                make_self_attr_assignment(
                    "handler",
                    vec!["<module>", "Service", "__init__"],
                    Some("Handler"),
                    None,
                ),
                make_self_attr_assignment(
                    "logger",
                    vec!["<module>", "Service", "__init__"],
                    Some("Logger"),
                    None,
                ),
            ];

            tracker.process_instance_attributes(&assignments);

            assert_eq!(
                tracker
                    .attribute_type_of("Service", "handler")
                    .unwrap()
                    .type_str,
                "Handler"
            );
            assert_eq!(
                tracker
                    .attribute_type_of("Service", "logger")
                    .unwrap()
                    .type_str,
                "Logger"
            );
        }

        #[test]
        fn same_attribute_on_different_classes() {
            // Test that attributes with the same name on different classes are tracked separately
            let mut tracker = TypeTracker::new();

            let assignments = vec![
                make_self_attr_assignment(
                    "handler",
                    vec!["<module>", "ServiceA", "__init__"],
                    Some("HandlerA"),
                    None,
                ),
                make_self_attr_assignment(
                    "handler",
                    vec!["<module>", "ServiceB", "__init__"],
                    Some("HandlerB"),
                    None,
                ),
            ];

            tracker.process_instance_attributes(&assignments);

            assert_eq!(
                tracker
                    .attribute_type_of("ServiceA", "handler")
                    .unwrap()
                    .type_str,
                "HandlerA"
            );
            assert_eq!(
                tracker
                    .attribute_type_of("ServiceB", "handler")
                    .unwrap()
                    .type_str,
                "HandlerB"
            );
        }

        #[test]
        fn non_self_attribute_assignment_ignored() {
            // Test that regular assignments (not self.attr) are ignored
            let mut tracker = TypeTracker::new();

            let assignments = vec![make_assignment(
                "local_var",
                vec!["<module>", "Service", "__init__"],
                Some("SomeType"),
            )];

            tracker.process_instance_attributes(&assignments);

            // No attribute should be recorded (this was not a self.attr assignment)
            assert!(tracker.attribute_type_of("Service", "local_var").is_none());
        }

        #[test]
        fn integration_full_analysis_produces_correct_attribute_types() {
            // Integration test: Tests the complete pipeline with correct call order
            // Tests: annotations + instance attributes + propagation
            //
            // Note: The REAL code path uses analyze_files() in analyzer.rs, which
            // calls TypeTracker methods in this same order. This unit test verifies
            // the TypeTracker methods work correctly when called in the right order.

            // Simulate the data that would come from CST analysis for:
            //
            // class Handler:
            //     def process(self): pass
            //
            // class Service:
            //     handler: Handler  # Class-level annotation
            //
            //     def __init__(self, logger):
            //         self.handler = Handler()  # Constructor assignment
            //         self.logger = logger      # Propagation from parameter
            //
            //     def run(self):
            //         self.handler.process()

            let annotations = vec![
                // Class-level annotation: handler: Handler
                AnnotationInfo {
                    name: "handler".to_string(),
                    type_str: "Handler".to_string(),
                    annotation_kind: "simple".to_string(),
                    source_kind: "attribute".to_string(),
                    scope_path: vec!["<module>".to_string(), "Service".to_string()],
                    span: None,
                    line: Some(5),
                    col: Some(5),
                    type_node: None,
                },
                // Parameter annotation for logger (to test propagation)
                AnnotationInfo {
                    name: "logger".to_string(),
                    type_str: "Logger".to_string(),
                    annotation_kind: "simple".to_string(),
                    source_kind: "parameter".to_string(),
                    scope_path: vec![
                        "<module>".to_string(),
                        "Service".to_string(),
                        "__init__".to_string(),
                    ],
                    span: None,
                    line: Some(7),
                    col: Some(20),
                    type_node: None,
                },
            ];

            let assignments = vec![
                // self.handler = Handler() in __init__
                make_self_attr_assignment(
                    "handler",
                    vec!["<module>", "Service", "__init__"],
                    Some("Handler"), // Inferred from constructor
                    None,
                ),
                // self.logger = logger in __init__ (propagation)
                make_self_attr_assignment(
                    "logger",
                    vec!["<module>", "Service", "__init__"],
                    None,
                    Some("logger"), // RHS is the parameter
                ),
            ];

            // Run the full analysis pipeline in correct order:
            // 1. Annotations (highest priority)
            // 2. Instance attributes
            // 3. Assignments
            // 4. Resolve types
            let mut tracker = TypeTracker::new();
            tracker.process_annotations(&annotations);
            tracker.process_instance_attributes(&assignments);
            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            // Check that class-level annotation worked
            let handler_type = tracker.attribute_type_of("Service", "handler");
            assert!(
                handler_type.is_some(),
                "handler attribute should be tracked"
            );
            assert_eq!(
                handler_type.unwrap().type_str,
                "Handler",
                "handler should have type Handler from annotation"
            );

            // Check that propagation worked for logger
            let logger_type = tracker.attribute_type_of("Service", "logger");
            assert!(logger_type.is_some(), "logger attribute should be tracked");
            assert_eq!(
                logger_type.unwrap().type_str,
                "Logger",
                "logger should have type Logger propagated from parameter"
            );
        }
    }

    mod method_call_unit_tests {
        use super::*;
        use crate::types::SpanInfo;

        fn make_method_call(receiver: &str, method: &str, scope_path: Vec<&str>) -> MethodCallInfo {
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
            use crate::types::SpanInfo;
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
                is_self_attribute: false,
                attribute_name: None,
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
            let refs =
                find_typed_method_references("OtherClass", "process", &tracker, &method_calls);
            assert!(refs.is_empty());
        }

        #[test]
        fn no_match_for_different_method() {
            let mut tracker = TypeTracker::new();
            tracker.process_assignments(&[make_assignment("h", vec!["<module>"], Some("Handler"))]);
            tracker.resolve_types();

            let method_calls = vec![make_method_call("h", "process", vec!["<module>"])];

            // Looking for Handler.other_method should not match
            let refs =
                find_typed_method_references("Handler", "other_method", &tracker, &method_calls);
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
            let refs1 =
                find_typed_method_references("GlobalHandler", "process", &tracker, &method_calls);
            assert_eq!(refs1.len(), 1);
            assert_eq!(refs1[0].scope_path, vec!["<module>"]);

            // Function scope h is LocalHandler
            let refs2 =
                find_typed_method_references("LocalHandler", "process", &tracker, &method_calls);
            assert_eq!(refs2.len(), 1);
            assert_eq!(refs2[0].scope_path, vec!["<module>", "func"]);
        }
    }

    mod method_return_type_tests {
        use super::*;
        use tugtool_python_cst::SignatureInfo;

        fn make_signature(
            name: &str,
            scope_path: Vec<&str>,
            is_method: bool,
            returns: Option<&str>,
        ) -> SignatureInfo {
            SignatureInfo {
                name: name.to_string(),
                scope_path: scope_path.into_iter().map(String::from).collect(),
                is_method,
                returns: returns.map(String::from),
                params: vec![],
                returns_node: None,
                modifiers: vec![],
                type_params: vec![],
                span: None,
            }
        }

        #[test]
        fn method_return_type_of_basic() {
            // Test: class Handler: def process(self) -> Result
            // method_return_type_of("Handler", "process") == Some("Result")
            let mut tracker = TypeTracker::new();

            let signatures = vec![make_signature(
                "process",
                vec!["<module>", "Handler"],
                true, // is_method
                Some("Result"),
            )];

            tracker.process_signatures(&signatures);

            assert_eq!(
                tracker.method_return_type_of("Handler", "process"),
                Some("Result")
            );
        }

        #[test]
        fn method_return_type_of_unknown_class() {
            // method_return_type_of for unknown class returns None
            let tracker = TypeTracker::new();

            assert!(tracker
                .method_return_type_of("UnknownClass", "method")
                .is_none());
        }

        #[test]
        fn method_return_type_of_unknown_method() {
            // method_return_type_of for unknown method on known class returns None
            let mut tracker = TypeTracker::new();

            let signatures = vec![make_signature(
                "process",
                vec!["<module>", "Handler"],
                true,
                Some("Result"),
            )];

            tracker.process_signatures(&signatures);

            // Known class, unknown method
            assert!(tracker
                .method_return_type_of("Handler", "unknown_method")
                .is_none());
        }

        #[test]
        fn method_return_type_of_no_return_annotation() {
            // Method without return annotation is not stored
            let mut tracker = TypeTracker::new();

            let signatures = vec![make_signature(
                "process",
                vec!["<module>", "Handler"],
                true,
                None, // No return annotation
            )];

            tracker.process_signatures(&signatures);

            // Should not be stored since there's no return type
            assert!(tracker
                .method_return_type_of("Handler", "process")
                .is_none());
        }

        #[test]
        fn method_return_type_of_function_not_stored() {
            // Functions (is_method=false) should not be stored in method_return_types
            let mut tracker = TypeTracker::new();

            let signatures = vec![make_signature(
                "get_handler",
                vec!["<module>"],
                false, // is_method = false (it's a function)
                Some("Handler"),
            )];

            tracker.process_signatures(&signatures);

            // Should not be stored since it's not a method
            // Note: "module" would be the "class name" if we incorrectly stored it
            assert!(tracker
                .method_return_type_of("<module>", "get_handler")
                .is_none());
        }

        #[test]
        fn method_return_type_of_multiple_methods_same_class() {
            // Multiple methods on same class
            let mut tracker = TypeTracker::new();

            let signatures = vec![
                make_signature("process", vec!["<module>", "Handler"], true, Some("Result")),
                make_signature("validate", vec!["<module>", "Handler"], true, Some("bool")),
            ];

            tracker.process_signatures(&signatures);

            assert_eq!(
                tracker.method_return_type_of("Handler", "process"),
                Some("Result")
            );
            assert_eq!(
                tracker.method_return_type_of("Handler", "validate"),
                Some("bool")
            );
        }

        #[test]
        fn method_return_type_of_same_method_different_classes() {
            // Same method name on different classes
            let mut tracker = TypeTracker::new();

            let signatures = vec![
                make_signature(
                    "process",
                    vec!["<module>", "HandlerA"],
                    true,
                    Some("ResultA"),
                ),
                make_signature(
                    "process",
                    vec!["<module>", "HandlerB"],
                    true,
                    Some("ResultB"),
                ),
            ];

            tracker.process_signatures(&signatures);

            assert_eq!(
                tracker.method_return_type_of("HandlerA", "process"),
                Some("ResultA")
            );
            assert_eq!(
                tracker.method_return_type_of("HandlerB", "process"),
                Some("ResultB")
            );
        }

        #[test]
        fn method_return_type_of_first_wins() {
            // If same method appears twice, first one wins (shouldn't happen in practice)
            let mut tracker = TypeTracker::new();

            let signatures = vec![
                make_signature(
                    "process",
                    vec!["<module>", "Handler"],
                    true,
                    Some("FirstResult"),
                ),
                make_signature(
                    "process",
                    vec!["<module>", "Handler"],
                    true,
                    Some("SecondResult"),
                ),
            ];

            tracker.process_signatures(&signatures);

            // First one wins
            assert_eq!(
                tracker.method_return_type_of("Handler", "process"),
                Some("FirstResult")
            );
        }

        #[test]
        fn method_return_type_of_nested_class() {
            // Nested class: class Outer: class Inner: def method(self) -> T
            let mut tracker = TypeTracker::new();

            let signatures = vec![make_signature(
                "method",
                vec!["<module>", "Outer", "Inner"],
                true,
                Some("InnerResult"),
            )];

            tracker.process_signatures(&signatures);

            // The class name is the last element of scope_path (Inner)
            assert_eq!(
                tracker.method_return_type_of("Inner", "method"),
                Some("InnerResult")
            );
            // Outer doesn't have this method
            assert!(tracker.method_return_type_of("Outer", "method").is_none());
        }

        #[test]
        fn method_return_type_of_generic_return() {
            // Generic return type: def items(self) -> List[Item]
            let mut tracker = TypeTracker::new();

            let signatures = vec![make_signature(
                "items",
                vec!["<module>", "Container"],
                true,
                Some("List[Item]"),
            )];

            tracker.process_signatures(&signatures);

            assert_eq!(
                tracker.method_return_type_of("Container", "items"),
                Some("List[Item]")
            );
        }
    }

    mod callable_return_type_tests {
        use super::*;
        use crate::types::AttributeTypeInfo;
        use tugtool_core::facts::TypeNode;

        #[test]
        fn callable_return_type_of_simple() {
            // Callable[[], Handler] -> return type is "Handler"
            let attr_info = AttributeTypeInfo {
                type_str: "Callable[[], Handler]".to_string(),
                type_node: Some(TypeNode::Callable {
                    params: vec![],
                    returns: Box::new(TypeNode::Named {
                        name: "Handler".to_string(),
                        args: vec![],
                    }),
                }),
            };

            let result = TypeTracker::callable_return_type_of(&attr_info);
            assert_eq!(result, Some("Handler".to_string()));
        }

        #[test]
        fn callable_return_type_of_with_params() {
            // Callable[[int, str], Result] -> return type is "Result"
            let attr_info = AttributeTypeInfo {
                type_str: "Callable[[int, str], Result]".to_string(),
                type_node: Some(TypeNode::Callable {
                    params: vec![
                        TypeNode::Named {
                            name: "int".to_string(),
                            args: vec![],
                        },
                        TypeNode::Named {
                            name: "str".to_string(),
                            args: vec![],
                        },
                    ],
                    returns: Box::new(TypeNode::Named {
                        name: "Result".to_string(),
                        args: vec![],
                    }),
                }),
            };

            let result = TypeTracker::callable_return_type_of(&attr_info);
            assert_eq!(result, Some("Result".to_string()));
        }

        #[test]
        fn callable_return_type_of_generic_return() {
            // Callable[[], List[Item]] -> return type is "List[Item]"
            let attr_info = AttributeTypeInfo {
                type_str: "Callable[[], List[Item]]".to_string(),
                type_node: Some(TypeNode::Callable {
                    params: vec![],
                    returns: Box::new(TypeNode::Named {
                        name: "List".to_string(),
                        args: vec![TypeNode::Named {
                            name: "Item".to_string(),
                            args: vec![],
                        }],
                    }),
                }),
            };

            let result = TypeTracker::callable_return_type_of(&attr_info);
            assert_eq!(result, Some("List[Item]".to_string()));
        }

        #[test]
        fn callable_return_type_of_non_callable() {
            // Non-Callable type returns None
            let attr_info = AttributeTypeInfo {
                type_str: "Handler".to_string(),
                type_node: Some(TypeNode::Named {
                    name: "Handler".to_string(),
                    args: vec![],
                }),
            };

            let result = TypeTracker::callable_return_type_of(&attr_info);
            assert!(result.is_none());
        }

        #[test]
        fn callable_return_type_of_fallback_to_type_str() {
            // No TypeNode, fallback to parsing type_str
            let attr_info = AttributeTypeInfo {
                type_str: "Callable[[int], Handler]".to_string(),
                type_node: None,
            };

            let result = TypeTracker::callable_return_type_of(&attr_info);
            assert_eq!(result, Some("Handler".to_string()));
        }

        #[test]
        fn callable_return_type_of_fallback_empty_params() {
            // No TypeNode, fallback to parsing type_str with empty params
            let attr_info = AttributeTypeInfo {
                type_str: "Callable[[], Result]".to_string(),
                type_node: None,
            };

            let result = TypeTracker::callable_return_type_of(&attr_info);
            assert_eq!(result, Some("Result".to_string()));
        }

        #[test]
        fn callable_return_type_of_fallback_nested() {
            // No TypeNode, fallback parsing with nested brackets
            let attr_info = AttributeTypeInfo {
                type_str: "Callable[[List[int]], Dict[str, int]]".to_string(),
                type_node: None,
            };

            let result = TypeTracker::callable_return_type_of(&attr_info);
            assert_eq!(result, Some("Dict[str, int]".to_string()));
        }

        #[test]
        fn callable_return_type_of_non_callable_string() {
            // Non-Callable type_str, no TypeNode
            let attr_info = AttributeTypeInfo {
                type_str: "Handler".to_string(),
                type_node: None,
            };

            let result = TypeTracker::callable_return_type_of(&attr_info);
            assert!(result.is_none());
        }
    }
}
