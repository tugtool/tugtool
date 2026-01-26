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
use tugtool_python_cst::{BaseSlice, BinaryOp, Element, Expression, SubscriptElement};

use crate::types::{AnnotationInfo, AssignmentInfo};
use std::collections::HashMap;
use thiserror::Error;

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
                    let parent_scope: Vec<String> = ann
                        .scope_path
                        .iter()
                        .take(ann.scope_path.len() - 1)
                        .cloned()
                        .collect();
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
            .map(|((scope, name), type_name)| (scope.as_slice(), name.as_str(), type_name.as_str()))
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
// TypeNode Building from CST Expressions
// ============================================================================

/// Build a `TypeNode` from a Python type annotation CST expression.
///
/// This function converts Python type annotation expressions into structured
/// `TypeNode` representations for use in the FactsStore.
///
/// # V1 Scope
///
/// The following CST node types are handled:
/// - `Name` - simple types (`int`, `str`, `MyClass`)
/// - `Attribute` - qualified types (`typing.List`, `module.Type`)
/// - `Subscript` - generic types (`List[int]`, `Dict[str, int]`)
/// - `BinaryOperation` with `|` - PEP 604 unions (`str | int`)
///
/// The following special patterns in subscripts are recognized:
/// - `Optional[T]` -> `TypeNode::Optional`
/// - `Union[A, B, ...]` -> `TypeNode::Union`
/// - `Callable[[...], R]` -> `TypeNode::Callable`
/// - `Tuple[A, B, C]` -> `TypeNode::Tuple`
///
/// # Out of Scope (returns None)
///
/// - `typing.Annotated[T, ...]` - metadata annotations
/// - `typing.Literal[...]` - literal types
/// - `typing.TypeVar` bounds and constraints
/// - Forward references as strings (`"MyClass"`)
/// - Complex expressions (lambdas, conditionals in annotations)
///
/// # Arguments
///
/// * `annotation_expr` - The CST expression representing the type annotation
///
/// # Returns
///
/// `Some(TypeNode)` if the annotation can be converted, `None` otherwise.
pub fn build_typenode_from_annotation(annotation_expr: &Expression<'_>) -> Option<TypeNode> {
    match annotation_expr {
        // Name: simple types like `int`, `str`, `MyClass`
        Expression::Name(name) => Some(TypeNode::named(name.value)),

        // Attribute: qualified types like `typing.List`, `module.Type`
        Expression::Attribute(_attr) => {
            let qualified_name = build_qualified_name(annotation_expr);
            Some(TypeNode::named(qualified_name))
        }

        // Subscript: generic types like `List[int]`, `Dict[str, int]`
        Expression::Subscript(sub) => build_typenode_from_subscript(sub),

        // BinaryOperation: PEP 604 union syntax `str | int`
        Expression::BinaryOperation(bin_op) => {
            // Only handle BitOr (|) for union types
            if matches!(&bin_op.operator, BinaryOp::BitOr { .. }) {
                let mut members = Vec::new();
                collect_union_members(&bin_op.left, &mut members);
                collect_union_members(&bin_op.right, &mut members);

                if members.is_empty() {
                    None
                } else {
                    Some(TypeNode::Union { members })
                }
            } else {
                None
            }
        }

        // Tuple: for cases like bare tuple annotation `(int, str)`
        // This is rare in annotations but can appear
        Expression::Tuple(tuple) => {
            let elements: Vec<TypeNode> = tuple
                .elements
                .iter()
                .filter_map(|elem| match elem {
                    Element::Simple { value, .. } => build_typenode_from_annotation(value),
                    _ => None,
                })
                .collect();

            if elements.is_empty() {
                None
            } else {
                Some(TypeNode::Tuple { elements })
            }
        }

        // Out of scope: string annotations (forward references), complex expressions
        _ => None,
    }
}

/// Build a `TypeNode` for a constructor call (inferred type).
///
/// This handles simple constructor calls like `MyClass()` to produce
/// `TypeNode::Named { name: "MyClass", args: [] }`.
///
/// # Arguments
///
/// * `type_name` - The inferred type name from constructor analysis
///
/// # Returns
///
/// `Some(TypeNode)` for valid type names, always succeeds for non-empty names.
pub fn build_typenode_for_inferred_type(type_name: &str) -> Option<TypeNode> {
    if type_name.is_empty() {
        None
    } else {
        Some(TypeNode::named(type_name))
    }
}

/// Build a qualified name from an attribute access chain.
///
/// For `typing.List` this returns `"typing.List"`.
/// For `a.b.c.Type` this returns `"a.b.c.Type"`.
fn build_qualified_name(expr: &Expression<'_>) -> String {
    match expr {
        Expression::Name(name) => name.value.to_string(),
        Expression::Attribute(attr) => {
            let base = build_qualified_name(&attr.value);
            format!("{}.{}", base, attr.attr.value)
        }
        _ => "<unknown>".to_string(),
    }
}

/// Collect union members from a binary expression tree.
///
/// This handles chained unions like `int | str | bool` by recursively
/// walking the BinaryOperation tree and collecting all leaf types.
fn collect_union_members(expr: &Expression<'_>, members: &mut Vec<TypeNode>) {
    match expr {
        Expression::BinaryOperation(bin_op) if matches!(&bin_op.operator, BinaryOp::BitOr { .. }) => {
            // Recursively collect from both sides
            collect_union_members(&bin_op.left, members);
            collect_union_members(&bin_op.right, members);
        }
        _ => {
            // Leaf node - try to convert to TypeNode
            if let Some(node) = build_typenode_from_annotation(expr) {
                members.push(node);
            }
        }
    }
}

/// Build a TypeNode from a subscript expression.
///
/// This handles generic types and special patterns:
/// - `Optional[T]` -> `TypeNode::Optional { inner: T }`
/// - `Union[A, B]` -> `TypeNode::Union { members: [A, B] }`
/// - `Callable[[A, B], R]` -> `TypeNode::Callable { params: [A, B], returns: R }`
/// - `Tuple[A, B, C]` -> `TypeNode::Tuple { elements: [A, B, C] }`
/// - Other generics -> `TypeNode::Named { name, args }`
fn build_typenode_from_subscript(sub: &tugtool_python_cst::Subscript<'_>) -> Option<TypeNode> {
    // Get the base type name
    let base_name = match sub.value.as_ref() {
        Expression::Name(name) => name.value,
        Expression::Attribute(_attr) => {
            // Check for special qualified names like `typing.Optional`
            let qualified = build_qualified_name(sub.value.as_ref());
            return build_typenode_from_qualified_subscript(&qualified, &sub.slice);
        }
        _ => return None,
    };

    // Handle special patterns
    match base_name {
        "Optional" => build_optional_typenode(&sub.slice),
        "Union" => build_union_typenode(&sub.slice),
        "Callable" => build_callable_typenode(&sub.slice),
        "Tuple" => build_tuple_typenode(&sub.slice),
        // Check for out-of-scope types that should return None
        "Annotated" | "Literal" | "TypeVar" => None,
        // Generic type with type arguments
        _ => {
            let args = extract_type_args(&sub.slice);
            Some(TypeNode::Named {
                name: base_name.to_string(),
                args,
            })
        }
    }
}

/// Build a TypeNode from a qualified subscript like `typing.Optional[T]`.
fn build_typenode_from_qualified_subscript(
    qualified_name: &str,
    slice: &[SubscriptElement<'_>],
) -> Option<TypeNode> {
    // Check for typing module special forms
    match qualified_name {
        "typing.Optional" => build_optional_typenode(slice),
        "typing.Union" => build_union_typenode(slice),
        "typing.Callable" => build_callable_typenode(slice),
        "typing.Tuple" => build_tuple_typenode(slice),
        "typing.Annotated" | "typing.Literal" | "typing.TypeVar" => None,
        // Other qualified generics
        _ => {
            let args = extract_type_args(slice);
            Some(TypeNode::Named {
                name: qualified_name.to_string(),
                args,
            })
        }
    }
}

/// Build an Optional TypeNode from subscript slice.
fn build_optional_typenode(slice: &[SubscriptElement<'_>]) -> Option<TypeNode> {
    // Optional[T] has exactly one type argument
    if slice.len() != 1 {
        return None;
    }

    let inner = extract_single_type_arg(&slice[0])?;
    Some(TypeNode::Optional {
        inner: Box::new(inner),
    })
}

/// Build a Union TypeNode from subscript slice.
fn build_union_typenode(slice: &[SubscriptElement<'_>]) -> Option<TypeNode> {
    let members = extract_type_args(slice);
    if members.is_empty() {
        None
    } else {
        Some(TypeNode::Union { members })
    }
}

/// Build a Callable TypeNode from subscript slice.
///
/// Callable[[Param1, Param2], ReturnType]
fn build_callable_typenode(slice: &[SubscriptElement<'_>]) -> Option<TypeNode> {
    // Callable[[...], R] has two elements: params list and return type
    if slice.len() != 2 {
        return None;
    }

    // First element is the parameter types (as a list)
    let params = match &slice[0].slice {
        BaseSlice::Index(idx) => match &idx.value {
            // Parameters are in a list: [[int, str], R]
            Expression::List(list) => list
                .elements
                .iter()
                .filter_map(|elem| match elem {
                    Element::Simple { value, .. } => build_typenode_from_annotation(value),
                    _ => None,
                })
                .collect(),
            // Single parameter without list: [int, R] - less common
            _ => {
                if let Some(node) = build_typenode_from_annotation(&idx.value) {
                    vec![node]
                } else {
                    Vec::new()
                }
            }
        },
        _ => return None,
    };

    // Second element is the return type
    let returns = extract_single_type_arg(&slice[1])?;

    Some(TypeNode::Callable {
        params,
        returns: Box::new(returns),
    })
}

/// Build a Tuple TypeNode from subscript slice.
fn build_tuple_typenode(slice: &[SubscriptElement<'_>]) -> Option<TypeNode> {
    let elements = extract_type_args(slice);
    // Tuple can have zero elements (empty tuple type)
    Some(TypeNode::Tuple { elements })
}

/// Extract type arguments from a subscript slice.
fn extract_type_args(slice: &[SubscriptElement<'_>]) -> Vec<TypeNode> {
    slice.iter().filter_map(extract_single_type_arg).collect()
}

/// Extract a single type argument from a SubscriptElement.
fn extract_single_type_arg(elem: &SubscriptElement<'_>) -> Option<TypeNode> {
    match &elem.slice {
        BaseSlice::Index(idx) => build_typenode_from_annotation(&idx.value),
        BaseSlice::Slice(_) => None, // Slices are not type annotations
    }
}

// ============================================================================
// Integration with Analyzer
// ============================================================================

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
            if to_insert.iter().any(|(sid, _, _)| *sid == symbol.symbol_id) {
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

    /// Tests for TypeNode building from CST expressions.
    mod typenode_building_tests {
        use super::*;
        use tugtool_python_cst::parse_module_with_positions;

        /// Helper to extract the annotation expression from a simple annotated assignment.
        /// Parses `x: <type_annotation>` and returns the expression AST node.
        fn get_annotation_expr(source: &str) -> Option<tugtool_python_cst::Expression<'_>> {
            // Parse and extract - this is a bit tricky because we need to navigate the CST
            // For testing, we'll use a simpler approach: parse "x: Type" and extract the annotation
            let parsed = parse_module_with_positions(source, None).ok()?;
            // The module body should have one statement - AnnAssign
            let body = parsed.module.body.clone();
            for stmt in body {
                if let tugtool_python_cst::Statement::Simple(simple) = stmt {
                    if let Some(small) = simple.body.first() {
                        if let tugtool_python_cst::SmallStatement::AnnAssign(ann) = small {
                            return Some(ann.annotation.annotation.clone());
                        }
                    }
                }
            }
            None
        }

        #[test]
        fn typenode_name_simple_int() {
            // CST Name("int") -> Named { name: "int", args: [] }
            if let Some(expr) = get_annotation_expr("x: int") {
                let node = build_typenode_from_annotation(&expr);
                assert!(node.is_some());
                let node = node.unwrap();
                match node {
                    TypeNode::Named { name, args } => {
                        assert_eq!(name, "int");
                        assert!(args.is_empty());
                    }
                    _ => panic!("Expected TypeNode::Named, got {:?}", node),
                }
            } else {
                panic!("Failed to parse annotation");
            }
        }

        #[test]
        fn typenode_name_simple_str() {
            if let Some(expr) = get_annotation_expr("x: str") {
                let node = build_typenode_from_annotation(&expr).unwrap();
                match node {
                    TypeNode::Named { name, args } => {
                        assert_eq!(name, "str");
                        assert!(args.is_empty());
                    }
                    _ => panic!("Expected TypeNode::Named"),
                }
            }
        }

        #[test]
        fn typenode_name_simple_myclass() {
            if let Some(expr) = get_annotation_expr("x: MyClass") {
                let node = build_typenode_from_annotation(&expr).unwrap();
                match node {
                    TypeNode::Named { name, args } => {
                        assert_eq!(name, "MyClass");
                        assert!(args.is_empty());
                    }
                    _ => panic!("Expected TypeNode::Named"),
                }
            }
        }

        #[test]
        fn typenode_subscript_list_str() {
            // CST Subscript(Name("List"), Name("str")) -> Named with nested arg
            if let Some(expr) = get_annotation_expr("x: List[str]") {
                let node = build_typenode_from_annotation(&expr).unwrap();
                match node {
                    TypeNode::Named { name, args } => {
                        assert_eq!(name, "List");
                        assert_eq!(args.len(), 1);
                        match &args[0] {
                            TypeNode::Named {
                                name: inner_name,
                                args: inner_args,
                            } => {
                                assert_eq!(inner_name, "str");
                                assert!(inner_args.is_empty());
                            }
                            _ => panic!("Expected inner Named"),
                        }
                    }
                    _ => panic!("Expected TypeNode::Named"),
                }
            }
        }

        #[test]
        fn typenode_dict_str_int() {
            // CST for Dict[str, int] -> Named with two args
            if let Some(expr) = get_annotation_expr("x: Dict[str, int]") {
                let node = build_typenode_from_annotation(&expr).unwrap();
                match node {
                    TypeNode::Named { name, args } => {
                        assert_eq!(name, "Dict");
                        assert_eq!(args.len(), 2);
                        // First arg: str
                        match &args[0] {
                            TypeNode::Named { name, .. } => assert_eq!(name, "str"),
                            _ => panic!("Expected Named for first arg"),
                        }
                        // Second arg: int
                        match &args[1] {
                            TypeNode::Named { name, .. } => assert_eq!(name, "int"),
                            _ => panic!("Expected Named for second arg"),
                        }
                    }
                    _ => panic!("Expected TypeNode::Named"),
                }
            }
        }

        #[test]
        fn typenode_optional_int() {
            // CST for Optional[int] -> Optional { inner: Named("int") }
            if let Some(expr) = get_annotation_expr("x: Optional[int]") {
                let node = build_typenode_from_annotation(&expr).unwrap();
                match node {
                    TypeNode::Optional { inner } => match inner.as_ref() {
                        TypeNode::Named { name, .. } => assert_eq!(name, "int"),
                        _ => panic!("Expected inner Named"),
                    },
                    _ => panic!("Expected TypeNode::Optional, got {:?}", node),
                }
            }
        }

        #[test]
        fn typenode_union_str_int() {
            // CST for Union[str, int] -> Union { members: [str, int] }
            if let Some(expr) = get_annotation_expr("x: Union[str, int]") {
                let node = build_typenode_from_annotation(&expr).unwrap();
                match node {
                    TypeNode::Union { members } => {
                        assert_eq!(members.len(), 2);
                        match &members[0] {
                            TypeNode::Named { name, .. } => assert_eq!(name, "str"),
                            _ => panic!("Expected Named"),
                        }
                        match &members[1] {
                            TypeNode::Named { name, .. } => assert_eq!(name, "int"),
                            _ => panic!("Expected Named"),
                        }
                    }
                    _ => panic!("Expected TypeNode::Union, got {:?}", node),
                }
            }
        }

        #[test]
        fn typenode_pep604_union_str_int() {
            // CST for str | int (BinOp) -> Union { members: [str, int] }
            if let Some(expr) = get_annotation_expr("x: str | int") {
                let node = build_typenode_from_annotation(&expr).unwrap();
                match node {
                    TypeNode::Union { members } => {
                        assert_eq!(members.len(), 2);
                        match &members[0] {
                            TypeNode::Named { name, .. } => assert_eq!(name, "str"),
                            _ => panic!("Expected Named"),
                        }
                        match &members[1] {
                            TypeNode::Named { name, .. } => assert_eq!(name, "int"),
                            _ => panic!("Expected Named"),
                        }
                    }
                    _ => panic!("Expected TypeNode::Union, got {:?}", node),
                }
            }
        }

        #[test]
        fn typenode_callable_int_str() {
            // CST for Callable[[int], str] -> Callable { params: [int], returns: str }
            if let Some(expr) = get_annotation_expr("x: Callable[[int], str]") {
                let node = build_typenode_from_annotation(&expr).unwrap();
                match node {
                    TypeNode::Callable { params, returns } => {
                        assert_eq!(params.len(), 1);
                        match &params[0] {
                            TypeNode::Named { name, .. } => assert_eq!(name, "int"),
                            _ => panic!("Expected Named for param"),
                        }
                        match returns.as_ref() {
                            TypeNode::Named { name, .. } => assert_eq!(name, "str"),
                            _ => panic!("Expected Named for return"),
                        }
                    }
                    _ => panic!("Expected TypeNode::Callable, got {:?}", node),
                }
            }
        }

        #[test]
        fn typenode_tuple_int_str_bool() {
            // CST for Tuple[int, str, bool] -> Tuple { elements: [int, str, bool] }
            if let Some(expr) = get_annotation_expr("x: Tuple[int, str, bool]") {
                let node = build_typenode_from_annotation(&expr).unwrap();
                match node {
                    TypeNode::Tuple { elements } => {
                        assert_eq!(elements.len(), 3);
                        match &elements[0] {
                            TypeNode::Named { name, .. } => assert_eq!(name, "int"),
                            _ => panic!("Expected Named"),
                        }
                        match &elements[1] {
                            TypeNode::Named { name, .. } => assert_eq!(name, "str"),
                            _ => panic!("Expected Named"),
                        }
                        match &elements[2] {
                            TypeNode::Named { name, .. } => assert_eq!(name, "bool"),
                            _ => panic!("Expected Named"),
                        }
                    }
                    _ => panic!("Expected TypeNode::Tuple, got {:?}", node),
                }
            }
        }

        #[test]
        fn typenode_complex_returns_none() {
            // Complex/malformed expressions should return None
            // String forward reference - out of scope
            if let Some(expr) = get_annotation_expr("x: \"ForwardRef\"") {
                let node = build_typenode_from_annotation(&expr);
                assert!(node.is_none());
            }
        }

        #[test]
        fn typenode_inferred_type_simple() {
            // build_typenode_for_inferred_type for simple constructor call
            let node = build_typenode_for_inferred_type("MyClass");
            assert!(node.is_some());
            match node.unwrap() {
                TypeNode::Named { name, args } => {
                    assert_eq!(name, "MyClass");
                    assert!(args.is_empty());
                }
                _ => panic!("Expected TypeNode::Named"),
            }
        }

        #[test]
        fn typenode_inferred_type_empty() {
            // Empty type name should return None
            let node = build_typenode_for_inferred_type("");
            assert!(node.is_none());
        }

        #[test]
        fn typenode_qualified_attribute_type() {
            // typing.List -> Named { name: "typing.List", args: [] }
            if let Some(expr) = get_annotation_expr("x: typing.List") {
                let node = build_typenode_from_annotation(&expr).unwrap();
                match node {
                    TypeNode::Named { name, args } => {
                        assert_eq!(name, "typing.List");
                        assert!(args.is_empty());
                    }
                    _ => panic!("Expected TypeNode::Named"),
                }
            }
        }

        #[test]
        fn typenode_typing_optional() {
            // typing.Optional[int] -> Optional { inner: int }
            if let Some(expr) = get_annotation_expr("x: typing.Optional[int]") {
                let node = build_typenode_from_annotation(&expr).unwrap();
                match node {
                    TypeNode::Optional { inner } => match inner.as_ref() {
                        TypeNode::Named { name, .. } => assert_eq!(name, "int"),
                        _ => panic!("Expected inner Named"),
                    },
                    _ => panic!("Expected TypeNode::Optional, got {:?}", node),
                }
            }
        }

        #[test]
        fn typenode_annotated_returns_none() {
            // typing.Annotated[...] is out of scope and should return None
            if let Some(expr) = get_annotation_expr("x: Annotated[int, \"metadata\"]") {
                let node = build_typenode_from_annotation(&expr);
                assert!(node.is_none(), "Annotated should return None");
            }
        }

        #[test]
        fn typenode_literal_returns_none() {
            // typing.Literal[...] is out of scope and should return None
            if let Some(expr) = get_annotation_expr("x: Literal[\"value\"]") {
                let node = build_typenode_from_annotation(&expr);
                assert!(node.is_none(), "Literal should return None");
            }
        }

        #[test]
        fn typenode_chained_union() {
            // int | str | bool -> Union with 3 members
            if let Some(expr) = get_annotation_expr("x: int | str | bool") {
                let node = build_typenode_from_annotation(&expr).unwrap();
                match node {
                    TypeNode::Union { members } => {
                        assert_eq!(members.len(), 3);
                    }
                    _ => panic!("Expected TypeNode::Union, got {:?}", node),
                }
            }
        }

        #[test]
        fn typenode_nested_generic() {
            // List[Dict[str, int]] -> nested Named structures
            if let Some(expr) = get_annotation_expr("x: List[Dict[str, int]]") {
                let node = build_typenode_from_annotation(&expr).unwrap();
                match node {
                    TypeNode::Named { name, args } => {
                        assert_eq!(name, "List");
                        assert_eq!(args.len(), 1);
                        match &args[0] {
                            TypeNode::Named {
                                name: inner_name,
                                args: inner_args,
                            } => {
                                assert_eq!(inner_name, "Dict");
                                assert_eq!(inner_args.len(), 2);
                            }
                            _ => panic!("Expected inner Named"),
                        }
                    }
                    _ => panic!("Expected TypeNode::Named"),
                }
            }
        }
    }
}
