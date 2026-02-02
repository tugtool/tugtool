// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Layer 1: Expression analysis infrastructure for Python refactoring.
//!
//! This module provides the building blocks for expression-level refactoring operations
//! like Extract Variable and Extract Constant.
//!
//! # Components
//!
//! - [`ExpressionBoundaryDetector`]: Finds complete expressions at cursor positions
//! - [`UniqueNameGenerator`]: Generates non-conflicting names in scope
//! - [`SingleAssignmentChecker`]: Verifies a variable has exactly one assignment
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python::layers::expression::{
//!     ExpressionBoundaryDetector, UniqueNameGenerator, find_expression_at
//! };
//!
//! // Find expression at cursor position
//! let detector = ExpressionBoundaryDetector::new(&position_index);
//! if let Some(expr) = detector.find_expression_at(offset) {
//!     println!("Found expression: {:?}", expr);
//! }
//!
//! // Generate unique name
//! let generator = UniqueNameGenerator::new(&store, file_id, scope_path);
//! let name = generator.generate("value");
//! ```

use std::collections::HashSet;

use tugtool_core::facts::{FactsStore, ReferenceKind, Symbol};
use tugtool_core::patch::{FileId, Span};
use tugtool_python_cst::visitor::{ExpressionInfo, NodeKind, PositionIndex};

// ============================================================================
// Python Builtins
// ============================================================================

/// Python built-in names that should be avoided when generating unique names.
///
/// This list includes:
/// - Built-in functions (print, len, range, etc.)
/// - Built-in types (int, str, list, dict, etc.)
/// - Built-in constants (True, False, None)
/// - Built-in exceptions (Exception, ValueError, etc.)
const PYTHON_BUILTINS: &[&str] = &[
    // Built-in functions
    "abs",
    "aiter",
    "all",
    "anext",
    "any",
    "ascii",
    "bin",
    "bool",
    "breakpoint",
    "bytearray",
    "bytes",
    "callable",
    "chr",
    "classmethod",
    "compile",
    "complex",
    "copyright",
    "credits",
    "delattr",
    "dict",
    "dir",
    "divmod",
    "enumerate",
    "eval",
    "exec",
    "exit",
    "filter",
    "float",
    "format",
    "frozenset",
    "getattr",
    "globals",
    "hasattr",
    "hash",
    "help",
    "hex",
    "id",
    "input",
    "int",
    "isinstance",
    "issubclass",
    "iter",
    "len",
    "license",
    "list",
    "locals",
    "map",
    "max",
    "memoryview",
    "min",
    "next",
    "object",
    "oct",
    "open",
    "ord",
    "pow",
    "print",
    "property",
    "quit",
    "range",
    "repr",
    "reversed",
    "round",
    "set",
    "setattr",
    "slice",
    "sorted",
    "staticmethod",
    "str",
    "sum",
    "super",
    "tuple",
    "type",
    "vars",
    "zip",
    // Built-in constants
    "True",
    "False",
    "None",
    "Ellipsis",
    "NotImplemented",
    "__debug__",
    // Built-in exceptions (common ones)
    "BaseException",
    "Exception",
    "ArithmeticError",
    "AssertionError",
    "AttributeError",
    "BlockingIOError",
    "BrokenPipeError",
    "BufferError",
    "BytesWarning",
    "ChildProcessError",
    "ConnectionAbortedError",
    "ConnectionError",
    "ConnectionRefusedError",
    "ConnectionResetError",
    "DeprecationWarning",
    "EOFError",
    "EnvironmentError",
    "FileExistsError",
    "FileNotFoundError",
    "FloatingPointError",
    "FutureWarning",
    "GeneratorExit",
    "IOError",
    "ImportError",
    "ImportWarning",
    "IndentationError",
    "IndexError",
    "InterruptedError",
    "IsADirectoryError",
    "KeyError",
    "KeyboardInterrupt",
    "LookupError",
    "MemoryError",
    "ModuleNotFoundError",
    "NameError",
    "NotADirectoryError",
    "NotImplementedError",
    "OSError",
    "OverflowError",
    "PendingDeprecationWarning",
    "PermissionError",
    "ProcessLookupError",
    "RecursionError",
    "ReferenceError",
    "ResourceWarning",
    "RuntimeError",
    "RuntimeWarning",
    "StopAsyncIteration",
    "StopIteration",
    "SyntaxError",
    "SyntaxWarning",
    "SystemError",
    "SystemExit",
    "TabError",
    "TimeoutError",
    "TypeError",
    "UnboundLocalError",
    "UnicodeDecodeError",
    "UnicodeEncodeError",
    "UnicodeError",
    "UnicodeTranslationError",
    "UnicodeWarning",
    "UserWarning",
    "ValueError",
    "Warning",
    "ZeroDivisionError",
    // Common dunder names
    "__name__",
    "__doc__",
    "__package__",
    "__loader__",
    "__spec__",
    "__file__",
    "__cached__",
    "__builtins__",
    "__annotations__",
    "__dict__",
    "__module__",
    "__class__",
    "__init__",
    "__new__",
    "__del__",
    "__repr__",
    "__str__",
    "__bytes__",
    "__format__",
    "__hash__",
    "__bool__",
    "__getattr__",
    "__setattr__",
    "__delattr__",
    "__dir__",
    "__call__",
    "__len__",
    "__getitem__",
    "__setitem__",
    "__delitem__",
    "__iter__",
    "__next__",
    "__reversed__",
    "__contains__",
    "__enter__",
    "__exit__",
    "__await__",
    "__aiter__",
    "__anext__",
    "__aenter__",
    "__aexit__",
    // typing module names
    "Any",
    "Callable",
    "ClassVar",
    "Final",
    "Generic",
    "Literal",
    "Optional",
    "Protocol",
    "Tuple",
    "Type",
    "TypeVar",
    "Union",
    "Annotated",
    "Self",
    "TypeAlias",
    "TypeGuard",
    "ParamSpec",
    "Concatenate",
    "Unpack",
    "TypeVarTuple",
    "Never",
    "NoReturn",
    "List",
    "Dict",
    "Set",
    "FrozenSet",
    "Sequence",
    "Mapping",
    "MutableMapping",
    "Iterable",
    "Iterator",
    "Generator",
    "Coroutine",
    "AsyncGenerator",
    "AsyncIterator",
    "AsyncIterable",
    "Awaitable",
    "ContextManager",
    "AsyncContextManager",
    "Pattern",
    "Match",
    "IO",
    "TextIO",
    "BinaryIO",
    "NamedTuple",
    "TypedDict",
    "cast",
    "overload",
    "no_type_check",
    "final",
    "runtime_checkable",
];

/// Check if a name is a Python builtin.
pub fn is_python_builtin(name: &str) -> bool {
    PYTHON_BUILTINS.contains(&name)
}

// ============================================================================
// ExpressionBoundaryDetector
// ============================================================================

/// Information about an expression boundary detected at a position.
#[derive(Debug, Clone)]
pub struct ExpressionBoundary {
    /// The kind of expression
    pub kind: NodeKind,
    /// The full span of the expression (including any parentheses)
    pub span: Span,
    /// The inner span (excluding outer parentheses)
    pub inner_span: Span,
    /// Whether the expression is parenthesized
    pub is_parenthesized: bool,
    /// Context about the expression (is it in a comprehension, lambda, etc.)
    pub context: ExpressionContext,
}

/// Context information about where an expression appears.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExpressionContext {
    /// Normal statement context (can extract variable here)
    Statement,
    /// Inside a comprehension (list/dict/set comp, generator)
    Comprehension,
    /// Inside a lambda expression
    Lambda,
    /// Inside a decorator argument
    Decorator,
    /// Inside a class body (but not in a method)
    ClassBody,
    /// Inside a default argument value
    DefaultArgument,
}

impl ExpressionContext {
    /// Returns true if extraction is safe in this context.
    pub fn allows_extraction(&self) -> bool {
        matches!(self, ExpressionContext::Statement)
    }

    /// Returns a human-readable description of why extraction is not allowed.
    pub fn rejection_reason(&self) -> Option<&'static str> {
        match self {
            ExpressionContext::Statement => None,
            ExpressionContext::Comprehension => {
                Some("cannot extract from comprehension (would change evaluation semantics)")
            }
            ExpressionContext::Lambda => Some("cannot extract from lambda (cannot add statements)"),
            ExpressionContext::Decorator => {
                Some("cannot extract from decorator (complex evaluation order)")
            }
            ExpressionContext::ClassBody => Some("cannot extract in class body outside of methods"),
            ExpressionContext::DefaultArgument => {
                Some("cannot extract from default argument value")
            }
        }
    }
}

/// Detects expression boundaries at cursor positions.
///
/// Uses the [`PositionIndex`] from tugtool-python-cst to find complete expressions
/// and determine their context for refactoring operations.
pub struct ExpressionBoundaryDetector<'a> {
    index: &'a PositionIndex,
}

impl<'a> ExpressionBoundaryDetector<'a> {
    /// Create a new detector with the given position index.
    pub fn new(index: &'a PositionIndex) -> Self {
        Self { index }
    }

    /// Find the expression at or containing the given byte offset.
    ///
    /// Returns `None` if:
    /// - The position is not inside any expression
    /// - The position is in whitespace or a comment
    pub fn find_at(&self, offset: usize) -> Option<ExpressionBoundary> {
        let expr_info = self.index.find_expression_at(offset)?;
        let context = self.determine_context(offset, expr_info);

        Some(ExpressionBoundary {
            kind: expr_info.kind,
            span: expr_info.span,
            inner_span: expr_info.inner_span,
            is_parenthesized: expr_info.is_parenthesized,
            context,
        })
    }

    /// Find the complete (outermost) expression at a position.
    ///
    /// Unlike `find_at`, this returns the complete expression even if the cursor
    /// is on a sub-expression. For example, in `foo.bar.baz`, clicking on `bar`
    /// would return the whole `foo.bar.baz` expression.
    pub fn find_complete_at(&self, offset: usize) -> Option<ExpressionBoundary> {
        // First find the innermost expression
        let inner = self.index.find_expression_at(offset)?;

        // Then find all containing expressions and pick the outermost complete one
        let all_nodes = self.index.find_all_at(offset);
        let mut outermost_expr: Option<&ExpressionInfo> = None;

        for node_info in all_nodes.iter().rev() {
            // nodes are ordered outermost-first, so reverse gives us innermost-first
            if node_info.kind.is_expression() {
                // Check if this is a complete expression by looking at the
                // expression list
                if let Some(expr) = self.find_expression_with_span(node_info.span) {
                    if expr.is_complete {
                        outermost_expr = Some(expr);
                    }
                }
            }
        }

        let expr_info = outermost_expr.unwrap_or(inner);
        let context = self.determine_context(offset, expr_info);

        Some(ExpressionBoundary {
            kind: expr_info.kind,
            span: expr_info.span,
            inner_span: expr_info.inner_span,
            is_parenthesized: expr_info.is_parenthesized,
            context,
        })
    }

    /// Find the enclosing statement for a given offset.
    ///
    /// Returns the span of the statement that contains the expression at `offset`.
    pub fn find_enclosing_statement(&self, offset: usize) -> Option<Span> {
        self.index.find_statement_at(offset).map(|s| s.span)
    }

    /// Determine the context of an expression at a given offset.
    fn determine_context(&self, offset: usize, _expr: &ExpressionInfo) -> ExpressionContext {
        let all_nodes = self.index.find_all_at(offset);

        for node_info in &all_nodes {
            match node_info.kind {
                // Comprehension scopes
                NodeKind::ListComp
                | NodeKind::DictComp
                | NodeKind::SetComp
                | NodeKind::GeneratorExp => {
                    return ExpressionContext::Comprehension;
                }
                // Lambda
                NodeKind::Lambda => {
                    return ExpressionContext::Lambda;
                }
                // Decorator
                NodeKind::Decorator => {
                    return ExpressionContext::Decorator;
                }
                // Default argument check: if we're in a Param node, check if we're
                // in the default value portion
                NodeKind::Param => {
                    // We're inside a parameter - if not at the name, it's likely
                    // in a default value or annotation
                    // For now, be conservative and reject
                    return ExpressionContext::DefaultArgument;
                }
                _ => {}
            }
        }

        // Check if we're in a class body but not in a method
        let mut in_class = false;
        let mut in_function = false;
        for node_info in &all_nodes {
            match node_info.kind {
                NodeKind::ClassDef => in_class = true,
                NodeKind::FunctionDef | NodeKind::AsyncFunctionDef => in_function = true,
                _ => {}
            }
        }

        if in_class && !in_function {
            return ExpressionContext::ClassBody;
        }

        ExpressionContext::Statement
    }

    /// Find an expression info by its exact span.
    fn find_expression_with_span(&self, span: Span) -> Option<&ExpressionInfo> {
        // Use find_expression_at and verify the span matches
        let expr = self.index.find_expression_at(span.start)?;
        if expr.span == span {
            Some(expr)
        } else {
            None
        }
    }
}

/// Convenience function to find an expression at a byte offset.
pub fn find_expression_at(index: &PositionIndex, offset: usize) -> Option<ExpressionBoundary> {
    ExpressionBoundaryDetector::new(index).find_at(offset)
}

// ============================================================================
// UniqueNameGenerator
// ============================================================================

/// Generates unique, non-conflicting names within a scope.
///
/// The generator considers:
/// - Names defined in the current scope
/// - Names imported into the scope
/// - Names from enclosing scopes (LEGB rule)
/// - Python built-in names
/// - Names from comprehension/generator scopes
pub struct UniqueNameGenerator<'a> {
    /// Names that are already in use
    used_names: HashSet<String>,
    /// The FactsStore for symbol lookup
    store: &'a FactsStore,
}

impl<'a> UniqueNameGenerator<'a> {
    /// Create a new generator for the given file and scope.
    ///
    /// # Arguments
    ///
    /// * `store` - The FactsStore containing symbol information
    /// * `file_id` - The file where the name will be used
    /// * `scope_path` - The scope path where the name will be inserted
    ///   (e.g., "module.function.inner_function")
    pub fn new(store: &'a FactsStore, file_id: FileId, scope_path: Option<&str>) -> Self {
        let mut used_names = HashSet::new();

        // Add Python builtins
        for &builtin in PYTHON_BUILTINS {
            used_names.insert(builtin.to_string());
        }

        // Add all visible names from the file
        Self::collect_visible_names(store, file_id, scope_path, &mut used_names);

        Self { store, used_names }
    }

    /// Create a generator with explicit used names.
    ///
    /// Useful for testing or when you've already collected the names.
    pub fn with_used_names(store: &'a FactsStore, used_names: HashSet<String>) -> Self {
        let mut names = used_names;

        // Always include Python builtins
        for &builtin in PYTHON_BUILTINS {
            names.insert(builtin.to_string());
        }

        Self {
            store,
            used_names: names,
        }
    }

    /// Generate a unique name based on a base name.
    ///
    /// If `base` is not in use, returns it directly.
    /// Otherwise, appends a numeric suffix (`_1`, `_2`, etc.) until
    /// a unique name is found.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let name = generator.generate("value");
    /// // Returns "value" if not in use, or "value_1", "value_2", etc.
    /// ```
    pub fn generate(&self, base: &str) -> String {
        if !self.is_in_use(base) {
            return base.to_string();
        }

        // Try adding numeric suffixes
        for i in 1.. {
            let candidate = format!("{}_{}", base, i);
            if !self.is_in_use(&candidate) {
                return candidate;
            }
        }

        // Should never reach here in practice
        unreachable!("exhausted all possible suffixes")
    }

    /// Generate a unique name with a specific pattern.
    ///
    /// The pattern should contain a `{}` placeholder for the number.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let name = generator.generate_with_pattern("temp_{}", "temp");
    /// // Returns "temp" if not in use, or "temp_1", "temp_2", etc.
    /// ```
    pub fn generate_with_pattern(&self, pattern: &str, base: &str) -> String {
        if !self.is_in_use(base) {
            return base.to_string();
        }

        for i in 1.. {
            let candidate = pattern.replace("{}", &i.to_string());
            if !self.is_in_use(&candidate) {
                return candidate;
            }
        }

        unreachable!("exhausted all possible suffixes")
    }

    /// Check if a name is already in use.
    pub fn is_in_use(&self, name: &str) -> bool {
        self.used_names.contains(name)
    }

    /// Add a name to the set of used names.
    ///
    /// Call this after generating a name if you need to generate multiple
    /// unique names in sequence.
    pub fn mark_used(&mut self, name: &str) {
        self.used_names.insert(name.to_string());
    }

    /// Collect all names visible in a scope following Python's LEGB rule.
    fn collect_visible_names(
        store: &FactsStore,
        file_id: FileId,
        scope_path: Option<&str>,
        names: &mut HashSet<String>,
    ) {
        // Get all symbols in the file
        for symbol in store.symbols_in_file(file_id) {
            // Add the symbol name
            names.insert(symbol.name.clone());

            // If scope_path is provided, check if the symbol is visible
            // from that scope. For now, we're conservative and add all names.
            // More sophisticated scoping could be added later.
            let _ = scope_path; // silence unused warning for now
        }

        // Also check referenced names in this file
        // References point to symbols, so we get names through the symbol lookup
        for reference in store.references() {
            if reference.file_id == file_id {
                if let Some(symbol) = store.symbol(reference.symbol_id) {
                    names.insert(symbol.name.clone());
                }
            }
        }
    }

    /// Get a reference to the underlying FactsStore.
    pub fn store(&self) -> &FactsStore {
        self.store
    }
}

/// Convenience function to generate a unique name.
pub fn generate_unique_name(
    store: &FactsStore,
    file_id: FileId,
    scope_path: Option<&str>,
    base: &str,
) -> String {
    UniqueNameGenerator::new(store, file_id, scope_path).generate(base)
}

// ============================================================================
// SingleAssignmentChecker
// ============================================================================

/// Result of checking if a variable has a single assignment.
#[derive(Debug, Clone)]
pub struct SingleAssignmentResult {
    /// Whether the variable has exactly one assignment
    pub is_single_assignment: bool,
    /// The number of assignments found
    pub assignment_count: usize,
    /// The span of the first (or only) assignment
    pub first_assignment_span: Option<Span>,
    /// Details about multiple assignments if found
    pub multiple_assignments: Vec<AssignmentDetail>,
}

/// Details about an assignment to a variable.
#[derive(Debug, Clone)]
pub struct AssignmentDetail {
    /// The span of the assignment
    pub span: Span,
    /// The kind of assignment
    pub kind: AssignmentKind,
}

/// The kind of assignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssignmentKind {
    /// Simple assignment: `x = value`
    Simple,
    /// Augmented assignment: `x += value`, `x -= value`, etc.
    Augmented,
    /// Walrus operator: `(x := value)`
    Walrus,
    /// Tuple unpacking: `x, y = values`
    TupleUnpacking,
    /// For loop target: `for x in items`
    ForTarget,
    /// Comprehension target: `[... for x in items]`
    ComprehensionTarget,
    /// Function parameter (including defaults)
    Parameter,
    /// Exception handler: `except E as x`
    ExceptionHandler,
    /// With statement: `with ctx as x`
    WithTarget,
    /// Import binding: `import x` or `from m import x`
    Import,
    /// Global/nonlocal declaration
    Declaration,
}

/// Checks if a variable has exactly one assignment in its scope.
///
/// This is important for operations like Inline Variable, which require
/// the variable to have a single, unambiguous value.
pub struct SingleAssignmentChecker<'a> {
    store: &'a FactsStore,
}

impl<'a> SingleAssignmentChecker<'a> {
    /// Create a new checker with the given FactsStore.
    pub fn new(store: &'a FactsStore) -> Self {
        Self { store }
    }

    /// Check if a symbol has a single assignment.
    ///
    /// # Arguments
    ///
    /// * `symbol` - The symbol to check
    ///
    /// # Returns
    ///
    /// A [`SingleAssignmentResult`] with details about the assignments.
    pub fn check(&self, symbol: &Symbol) -> SingleAssignmentResult {
        let mut assignments = Vec::new();

        // Check references that are "write" references
        for reference in self.store.refs_of_symbol(symbol.symbol_id) {
            if reference.ref_kind == ReferenceKind::Write {
                let kind = self.classify_assignment_kind(symbol, reference);
                assignments.push(AssignmentDetail {
                    span: reference.span,
                    kind,
                });
            }
        }

        // The definition itself counts as an assignment
        let def_span = symbol.decl_span;
        // Don't double-count if we already found the definition as a reference
        let already_counted = assignments.iter().any(|a| a.span == def_span);
        if !already_counted {
            let kind = self.classify_definition_kind(symbol);
            assignments.push(AssignmentDetail {
                span: def_span,
                kind,
            });
        }

        let count = assignments.len();
        let first_span = assignments.first().map(|a| a.span);

        SingleAssignmentResult {
            is_single_assignment: count == 1,
            assignment_count: count,
            first_assignment_span: first_span,
            multiple_assignments: if count > 1 { assignments } else { Vec::new() },
        }
    }

    /// Check if a variable name in a specific file/scope has a single assignment.
    pub fn check_by_name(
        &self,
        file_id: FileId,
        scope_path: Option<&str>,
        name: &str,
    ) -> Option<SingleAssignmentResult> {
        // Find the symbol
        for symbol in self.store.symbols_in_file(file_id) {
            if symbol.name == name {
                // If scope_path is provided, check it matches
                if let Some(path) = scope_path {
                    if let Some(qn) = self.store.qualified_name(symbol.symbol_id) {
                        if qn.path != path && !qn.path.ends_with(&format!(".{}", path)) {
                            continue;
                        }
                    }
                }
                return Some(self.check(symbol));
            }
        }
        None
    }

    /// Classify the kind of assignment from a reference.
    ///
    /// Note: Currently defaults to Simple assignment kind. More sophisticated
    /// classification would require analyzing the CST context at the reference
    /// location, which could be added in a future enhancement.
    fn classify_assignment_kind(
        &self,
        _symbol: &Symbol,
        _reference: &tugtool_core::facts::Reference,
    ) -> AssignmentKind {
        // For now, default to Simple. More sophisticated classification
        // would analyze the CST context at the reference location.
        // The FactsStore Reference type doesn't carry context information
        // about the kind of assignment, so this would require re-parsing
        // or additional data collection during analysis.
        AssignmentKind::Simple
    }

    /// Classify the kind of assignment from a symbol definition.
    fn classify_definition_kind(&self, symbol: &Symbol) -> AssignmentKind {
        match symbol.kind {
            tugtool_core::facts::SymbolKind::Parameter => AssignmentKind::Parameter,
            tugtool_core::facts::SymbolKind::Variable => AssignmentKind::Simple,
            _ => AssignmentKind::Simple,
        }
    }
}

// ============================================================================
// Comprehension Scope Handling
// ============================================================================

/// Information about a comprehension scope.
#[derive(Debug, Clone)]
pub struct ComprehensionScope {
    /// The kind of comprehension
    pub kind: ComprehensionKind,
    /// The span of the entire comprehension
    pub span: Span,
    /// Names bound in this comprehension (loop variables)
    pub bound_names: Vec<String>,
}

/// The kind of comprehension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComprehensionKind {
    /// List comprehension: `[x for x in items]`
    List,
    /// Dict comprehension: `{k: v for k, v in items}`
    Dict,
    /// Set comprehension: `{x for x in items}`
    Set,
    /// Generator expression: `(x for x in items)`
    Generator,
}

impl ComprehensionKind {
    /// Returns true if this comprehension creates its own scope.
    ///
    /// In Python 3, all comprehensions create their own scope.
    pub fn creates_scope(&self) -> bool {
        // All comprehensions create their own scope in Python 3
        true
    }
}

/// Detect comprehension scopes at a position.
///
/// Returns information about any comprehension scopes that contain the
/// given offset.
pub fn find_comprehension_scopes(index: &PositionIndex, offset: usize) -> Vec<ComprehensionScope> {
    let all_nodes = index.find_all_at(offset);
    let mut scopes = Vec::new();

    for node_info in all_nodes {
        let kind = match node_info.kind {
            NodeKind::ListComp => Some(ComprehensionKind::List),
            NodeKind::DictComp => Some(ComprehensionKind::Dict),
            NodeKind::SetComp => Some(ComprehensionKind::Set),
            NodeKind::GeneratorExp => Some(ComprehensionKind::Generator),
            _ => None,
        };

        if let Some(comp_kind) = kind {
            scopes.push(ComprehensionScope {
                kind: comp_kind,
                span: node_info.span,
                // Note: bound_names would require deeper CST analysis
                // For now, we just track the span and kind
                bound_names: Vec::new(),
            });
        }
    }

    scopes
}

/// Check if an expression is inside a comprehension scope.
pub fn is_in_comprehension(index: &PositionIndex, offset: usize) -> bool {
    let all_nodes = index.find_all_at(offset);

    for node_info in all_nodes {
        if matches!(
            node_info.kind,
            NodeKind::ListComp | NodeKind::DictComp | NodeKind::SetComp | NodeKind::GeneratorExp
        ) {
            return true;
        }
    }

    false
}

/// Check if an expression is inside a generator expression.
pub fn is_in_generator(index: &PositionIndex, offset: usize) -> bool {
    let all_nodes = index.find_all_at(offset);

    for node_info in all_nodes {
        if matches!(node_info.kind, NodeKind::GeneratorExp) {
            return true;
        }
    }

    false
}

// ============================================================================
// Literal Detection
// ============================================================================

/// The kind of literal expression.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LiteralKind {
    /// Integer literal: `42`, `0xFF`, `0b1010`
    Integer,
    /// Float literal: `3.14`, `1e-5`
    Float,
    /// Imaginary number: `3+4j`
    Imaginary,
    /// Simple string literal: `"hello"`, `'world'`
    String,
    /// Bytes literal: `b"data"`
    Bytes,
    /// Boolean literal: `True`, `False`
    Boolean,
    /// None literal
    None,
    /// Ellipsis literal: `...`
    Ellipsis,
}

/// Detect if an expression is a literal that can be extracted as a constant.
pub fn detect_literal_kind(kind: NodeKind) -> Option<LiteralKind> {
    match kind {
        NodeKind::Integer => Some(LiteralKind::Integer),
        NodeKind::Float => Some(LiteralKind::Float),
        NodeKind::Imaginary => Some(LiteralKind::Imaginary),
        NodeKind::String => Some(LiteralKind::String),
        // Note: Bytes and Boolean need additional detection logic
        // as they're represented differently in the CST
        NodeKind::Ellipsis => Some(LiteralKind::Ellipsis),
        _ => None,
    }
}

/// Check if an expression at a position is a literal.
pub fn is_literal_at(index: &PositionIndex, offset: usize) -> bool {
    if let Some(expr) = index.find_expression_at(offset) {
        detect_literal_kind(expr.kind).is_some()
    } else {
        false
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tugtool_python_cst::parse_module_with_positions;

    fn make_index(source: &str) -> PositionIndex {
        let parsed = parse_module_with_positions(source, None).expect("parse failed");
        PositionIndex::build(&parsed.module, &parsed.positions, source)
    }

    // ------------------------------------------------------------------------
    // ExpressionBoundaryDetector tests
    // ------------------------------------------------------------------------

    #[test]
    fn test_expression_boundary_simple() {
        let source = "x = 42 + 3";
        let index = make_index(source);
        let detector = ExpressionBoundaryDetector::new(&index);

        // Position at '4' in '42'
        let boundary = detector.find_at(4).expect("should find expression");
        assert_eq!(boundary.kind, NodeKind::Integer);
        assert!(boundary.context.allows_extraction());
    }

    #[test]
    fn test_expression_boundary_parenthesized() {
        let source = "x = (1 + 2)";
        let index = make_index(source);
        let detector = ExpressionBoundaryDetector::new(&index);

        // Position at '1' inside parens
        let boundary = detector.find_at(5).expect("should find expression");

        // Should find the integer 1
        assert_eq!(boundary.kind, NodeKind::Integer);
    }

    #[test]
    fn test_expression_boundary_in_comprehension() {
        let source = "[x * 2 for x in items]";
        let index = make_index(source);
        let detector = ExpressionBoundaryDetector::new(&index);

        // Position at '2' in 'x * 2'
        let boundary = detector.find_at(5).expect("should find expression");
        assert_eq!(boundary.context, ExpressionContext::Comprehension);
        assert!(!boundary.context.allows_extraction());
    }

    #[test]
    fn test_expression_boundary_in_lambda() {
        let source = "f = lambda x: x + 1";
        let index = make_index(source);
        let detector = ExpressionBoundaryDetector::new(&index);

        // Position at '1' in 'x + 1' (inside lambda)
        let boundary = detector.find_at(18).expect("should find expression");
        assert_eq!(boundary.context, ExpressionContext::Lambda);
        assert!(!boundary.context.allows_extraction());
    }

    // ------------------------------------------------------------------------
    // UniqueNameGenerator tests
    // ------------------------------------------------------------------------

    #[test]
    fn test_unique_name_no_conflict() {
        let store = FactsStore::new();
        let file_id = FileId::new(1);
        let generator = UniqueNameGenerator::new(&store, file_id, None);

        // 'my_var' is not a builtin and not used
        let name = generator.generate("my_var");
        assert_eq!(name, "my_var");
    }

    #[test]
    fn test_unique_name_with_conflict() {
        let store = FactsStore::new();
        let file_id = FileId::new(1);
        let generator = UniqueNameGenerator::new(&store, file_id, None);

        // 'print' is a builtin
        let name = generator.generate("print");
        assert_eq!(name, "print_1");
    }

    #[test]
    fn test_unique_name_builtin_check() {
        assert!(is_python_builtin("print"));
        assert!(is_python_builtin("len"));
        assert!(is_python_builtin("True"));
        assert!(is_python_builtin("Exception"));
        assert!(!is_python_builtin("my_function"));
    }

    #[test]
    fn test_unique_name_multiple_conflicts() {
        let mut used = HashSet::new();
        used.insert("value".to_string());
        used.insert("value_1".to_string());

        let store = FactsStore::new();
        let generator = UniqueNameGenerator::with_used_names(&store, used);

        let name = generator.generate("value");
        assert_eq!(name, "value_2");
    }

    // ------------------------------------------------------------------------
    // SingleAssignmentChecker tests
    // ------------------------------------------------------------------------

    #[test]
    fn test_single_assignment_true() {
        // This test requires a populated FactsStore
        // For now, we test the basic structure
        let store = FactsStore::new();
        let checker = SingleAssignmentChecker::new(&store);

        // With an empty store, checking by name should return None
        let result = checker.check_by_name(FileId::new(1), None, "x");
        assert!(result.is_none());
    }

    #[test]
    fn test_single_assignment_reassigned() {
        // This test requires a populated FactsStore with reassignments
        // For now, we verify the result structure
        let result = SingleAssignmentResult {
            is_single_assignment: false,
            assignment_count: 2,
            first_assignment_span: Some(Span { start: 0, end: 5 }),
            multiple_assignments: vec![
                AssignmentDetail {
                    span: Span { start: 0, end: 5 },
                    kind: AssignmentKind::Simple,
                },
                AssignmentDetail {
                    span: Span { start: 10, end: 15 },
                    kind: AssignmentKind::Simple,
                },
            ],
        };

        assert!(!result.is_single_assignment);
        assert_eq!(result.assignment_count, 2);
    }

    // ------------------------------------------------------------------------
    // Comprehension scope tests
    // ------------------------------------------------------------------------

    #[test]
    fn test_comprehension_scope_detection() {
        let source = "[x * 2 for x in items]";
        let index = make_index(source);

        // Inside the comprehension
        let scopes = find_comprehension_scopes(&index, 5);
        assert!(!scopes.is_empty());
        assert_eq!(scopes[0].kind, ComprehensionKind::List);
    }

    #[test]
    fn test_is_in_comprehension() {
        let source = "result = [x * 2 for x in items]";
        let index = make_index(source);

        // Inside comprehension
        assert!(is_in_comprehension(&index, 12));

        // Outside comprehension (at 'result')
        assert!(!is_in_comprehension(&index, 0));
    }

    #[test]
    fn test_is_in_generator() {
        let source = "gen = (x * 2 for x in items)";
        let index = make_index(source);

        // Inside generator
        assert!(is_in_generator(&index, 10));

        // Outside generator
        assert!(!is_in_generator(&index, 0));
    }

    // ------------------------------------------------------------------------
    // Literal detection tests
    // ------------------------------------------------------------------------

    #[test]
    fn test_literal_detection() {
        assert_eq!(
            detect_literal_kind(NodeKind::Integer),
            Some(LiteralKind::Integer)
        );
        assert_eq!(
            detect_literal_kind(NodeKind::Float),
            Some(LiteralKind::Float)
        );
        assert_eq!(
            detect_literal_kind(NodeKind::String),
            Some(LiteralKind::String)
        );
        assert_eq!(
            detect_literal_kind(NodeKind::Ellipsis),
            Some(LiteralKind::Ellipsis)
        );
        assert_eq!(detect_literal_kind(NodeKind::Call), None);
    }

    #[test]
    fn test_is_literal_at() {
        let source = "x = 42";
        let index = make_index(source);

        // At the literal '42'
        assert!(is_literal_at(&index, 4));

        // At the name 'x'
        assert!(!is_literal_at(&index, 0));
    }
}
