// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Visitor and transformer trait definitions for CST traversal.

use crate::nodes::{
    // Module
    Module,
    // Statements
    Statement, CompoundStatement, Suite, IndentedBlock, SimpleStatementLine, SimpleStatementSuite,
    SmallStatement, FunctionDef, ClassDef, If, For, While, Try, TryStar, With, Match,
    // Simple statements
    Pass, Break, Continue, Return, Raise, Assert, Del, Global, Nonlocal, Import, ImportFrom,
    ImportAlias, ImportNames, AsName, Assign, AnnAssign, AugAssign, Expr, Decorator,
    // Exception handling
    ExceptHandler, ExceptStarHandler, Else, Finally, OrElse, WithItem,
    // Match statements
    MatchCase, MatchPattern, MatchAs, MatchOr, MatchOrElement, MatchValue, MatchSingleton,
    MatchSequence, MatchSequenceElement, StarrableMatchSequenceElement, MatchStar, MatchMapping,
    MatchMappingElement, MatchClass, MatchKeywordElement, MatchList, MatchTuple,
    // Type parameters
    TypeAlias, TypeParameters, TypeParam, TypeVar, TypeVarTuple, TypeVarLike,
    // Expressions
    Expression, Name, Attribute, Call, Subscript, BinaryOperation, UnaryOperation,
    BooleanOperation, Comparison, ComparisonTarget, IfExp, Lambda, NamedExpr,
    Tuple, List, Set, Dict, DictElement, StarredDictElement, Element, StarredElement,
    // Comprehensions
    GeneratorExp, ListComp, SetComp, DictComp, CompFor, CompIf,
    // Strings
    SimpleString, ConcatenatedString, FormattedString, FormattedStringContent,
    FormattedStringExpression, FormattedStringText, TemplatedString, TemplatedStringContent,
    TemplatedStringExpression, TemplatedStringText,
    // Literals
    Integer, Float, Imaginary, Ellipsis,
    // Function-related
    Parameters, Param, ParamStar, ParamSlash, Arg, StarArg,
    // Slicing
    BaseSlice, Index, Slice, SubscriptElement,
    // Async - note: "From" is renamed to avoid conflict with std::convert::From
    Await, Yield, YieldValue, From as YieldFrom, Asynchronous,
    // Annotation
    Annotation, AssignTarget, AssignTargetExpression, DelTargetExpression, NameItem,
    // Parentheses and brackets
    LeftParen, RightParen, LeftSquareBracket, RightSquareBracket, LeftCurlyBrace, RightCurlyBrace,
    // Operators
    AssignEqual, AugOp, BinaryOp, BooleanOp, CompOp, UnaryOp, BitOr,
    Colon, Comma, Dot, Semicolon, ImportStar, NameOrAttribute,
    // Whitespace
    Comment, EmptyLine, Newline, ParenthesizableWhitespace, ParenthesizedWhitespace,
    SimpleWhitespace, TrailingWhitespace,
};

/// Result of visiting a node - controls traversal behavior.
///
/// When a visitor method returns a `VisitResult`, it controls how the walker
/// proceeds with traversal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum VisitResult {
    /// Continue traversal into children.
    ///
    /// After visiting children, `leave_*` will be called for this node.
    Continue,

    /// Skip children, continue with siblings.
    ///
    /// The walker will not descend into this node's children, but `leave_*`
    /// will still be called for this node.
    SkipChildren,

    /// Stop traversal entirely.
    ///
    /// No further `visit_*` or `leave_*` methods will be called. The walk
    /// function will return immediately.
    Stop,
}

impl Default for VisitResult {
    fn default() -> Self {
        Self::Continue
    }
}

/// Generic transform result for list-like contexts.
///
/// When transforming nodes that appear in lists (e.g., statements in a block),
/// this enum allows removing nodes or flattening sequences.
#[derive(Debug, Clone)]
pub enum Transform<T> {
    /// Keep the transformed node.
    Keep(T),
    /// Remove the node from the list.
    Remove,
    /// Replace the node with multiple nodes.
    Flatten(Vec<T>),
}

impl<T> Transform<T> {
    /// Returns true if this is a `Keep` variant.
    pub fn is_keep(&self) -> bool {
        matches!(self, Self::Keep(_))
    }

    /// Returns true if this is a `Remove` variant.
    pub fn is_remove(&self) -> bool {
        matches!(self, Self::Remove)
    }

    /// Returns true if this is a `Flatten` variant.
    pub fn is_flatten(&self) -> bool {
        matches!(self, Self::Flatten(_))
    }

    /// Maps the inner value using the provided function.
    ///
    /// - For `Keep(t)`, applies `f` to `t` and returns `Keep(f(t))`
    /// - For `Remove`, returns `Remove`
    /// - For `Flatten(v)`, applies `f` to each element and returns `Flatten`
    pub fn map<U, F: FnMut(T) -> U>(self, mut f: F) -> Transform<U> {
        match self {
            Transform::Keep(t) => Transform::Keep(f(t)),
            Transform::Remove => Transform::Remove,
            Transform::Flatten(v) => Transform::Flatten(v.into_iter().map(f).collect()),
        }
    }
}

impl<T> From<T> for Transform<T> {
    fn from(value: T) -> Self {
        Transform::Keep(value)
    }
}

/// Macro to generate visitor trait method signatures.
///
/// This macro generates pairs of `visit_*` and `leave_*` methods with default
/// implementations that return `VisitResult::Continue` and do nothing, respectively.
///
/// # Usage
///
/// ```ignore
/// visitor_methods! {
///     // Generates visit_name and leave_name for Name<'a>
///     name: Name,
///     // Generates visit_call and leave_call for Call<'a>
///     call: Call,
/// }
/// ```
macro_rules! visitor_methods {
    (
        $(
            $(#[$meta:meta])*
            $base_name:ident : $node_type:ty
        ),* $(,)?
    ) => {
        paste::paste! {
            $(
                $(#[$meta])*
                #[doc = concat!("Visit a [`", stringify!($node_type), "`] node.")]
                #[doc = ""]
                #[doc = "Called before descending into children. Return `VisitResult` to control traversal."]
                #[allow(unused_variables)]
                fn [<visit_ $base_name>](&mut self, node: &$node_type) -> VisitResult {
                    VisitResult::Continue
                }

                $(#[$meta])*
                #[doc = concat!("Leave a [`", stringify!($node_type), "`] node.")]
                #[doc = ""]
                #[doc = "Called after all children have been visited. Called even if `SkipChildren` was returned."]
                #[allow(unused_variables)]
                fn [<leave_ $base_name>](&mut self, node: &$node_type) {}
            )*
        }
    };
}

/// Macro to generate transformer trait method signatures.
///
/// This macro generates `transform_*` methods with default implementations
/// that return the node unchanged.
macro_rules! transformer_methods {
    (
        $(
            $(#[$meta:meta])*
            $base_name:ident : $node_type:ty
        ),* $(,)?
    ) => {
        paste::paste! {
            $(
                $(#[$meta])*
                #[doc = concat!("Transform a [`", stringify!($node_type), "`] node.")]
                #[doc = ""]
                #[doc = "Called to transform this node. Return the modified node."]
                #[allow(unused_variables)]
                fn [<transform_ $base_name>](&mut self, node: $node_type) -> $node_type {
                    node
                }
            )*
        }
    };
}

/// Macro to generate transformer methods that return Transform<T> for list contexts.
macro_rules! transformer_list_methods {
    (
        $(
            $(#[$meta:meta])*
            $base_name:ident : $node_type:ty
        ),* $(,)?
    ) => {
        paste::paste! {
            $(
                $(#[$meta])*
                #[doc = concat!("Transform a [`", stringify!($node_type), "`] node in a list context.")]
                #[doc = ""]
                #[doc = "Returns `Transform::Keep` by default. Can also return `Remove` or `Flatten`."]
                #[allow(unused_variables)]
                fn [<transform_ $base_name>](&mut self, node: $node_type) -> Transform<$node_type> {
                    Transform::Keep(node)
                }
            )*
        }
    };
}

/// Immutable visitor for CST traversal.
///
/// Implement this trait to traverse a CST without modifying it. Each node type
/// has a corresponding `visit_*` and `leave_*` method pair.
///
/// # Traversal Order
///
/// - `visit_*` is called in **pre-order** (before children)
/// - `leave_*` is called in **post-order** (after children)
/// - Children are visited in source order (left-to-right, top-to-bottom)
///
/// # Control Flow
///
/// - Return `VisitResult::Continue` to traverse into children
/// - Return `VisitResult::SkipChildren` to skip children (but `leave_*` still called)
/// - Return `VisitResult::Stop` to halt traversal immediately
///
/// # Example
///
/// ```ignore
/// use tugtool_python_cst::visitor::{Visitor, VisitResult};
/// use tugtool_python_cst::Name;
///
/// struct NameCollector {
///     names: Vec<String>,
/// }
///
/// impl<'a> Visitor<'a> for NameCollector {
///     fn visit_name(&mut self, node: &Name<'a>) -> VisitResult {
///         self.names.push(node.value.to_string());
///         VisitResult::Continue
///     }
/// }
/// ```
pub trait Visitor<'a> {
    // Module
    visitor_methods! {
        module: Module<'a>,
    }

    // Statements
    visitor_methods! {
        statement: Statement<'a>,
        compound_statement: CompoundStatement<'a>,
        simple_statement_line: SimpleStatementLine<'a>,
        simple_statement_suite: SimpleStatementSuite<'a>,
        small_statement: SmallStatement<'a>,
        suite: Suite<'a>,
        indented_block: IndentedBlock<'a>,
    }

    // Compound statements
    visitor_methods! {
        function_def: FunctionDef<'a>,
        class_def: ClassDef<'a>,
        if_stmt: If<'a>,
        for_stmt: For<'a>,
        while_stmt: While<'a>,
        try_stmt: Try<'a>,
        try_star: TryStar<'a>,
        with_stmt: With<'a>,
        match_stmt: Match<'a>,
    }

    // Simple statements
    visitor_methods! {
        pass_stmt: Pass<'a>,
        break_stmt: Break<'a>,
        continue_stmt: Continue<'a>,
        return_stmt: Return<'a>,
        raise_stmt: Raise<'a>,
        assert_stmt: Assert<'a>,
        del_stmt: Del<'a>,
        global_stmt: Global<'a>,
        nonlocal_stmt: Nonlocal<'a>,
        import_stmt: Import<'a>,
        import_from: ImportFrom<'a>,
        import_alias: ImportAlias<'a>,
        import_names: ImportNames<'a>,
        as_name: AsName<'a>,
        assign: Assign<'a>,
        ann_assign: AnnAssign<'a>,
        aug_assign: AugAssign<'a>,
        expr: Expr<'a>,
        decorator: Decorator<'a>,
        type_alias: TypeAlias<'a>,
    }

    // Exception handling
    visitor_methods! {
        except_handler: ExceptHandler<'a>,
        except_star_handler: ExceptStarHandler<'a>,
        else_clause: Else<'a>,
        finally_clause: Finally<'a>,
        or_else: OrElse<'a>,
        with_item: WithItem<'a>,
    }

    // Match statement components
    visitor_methods! {
        match_case: MatchCase<'a>,
        match_pattern: MatchPattern<'a>,
        match_as: MatchAs<'a>,
        match_or: MatchOr<'a>,
        match_or_element: MatchOrElement<'a>,
        match_value: MatchValue<'a>,
        match_singleton: MatchSingleton<'a>,
        match_sequence: MatchSequence<'a>,
        match_sequence_element: MatchSequenceElement<'a>,
        starrable_match_sequence_element: StarrableMatchSequenceElement<'a>,
        match_star: MatchStar<'a>,
        match_mapping: MatchMapping<'a>,
        match_mapping_element: MatchMappingElement<'a>,
        match_class: MatchClass<'a>,
        match_keyword_element: MatchKeywordElement<'a>,
        match_list: MatchList<'a>,
        match_tuple: MatchTuple<'a>,
    }

    // Type parameters
    visitor_methods! {
        type_parameters: TypeParameters<'a>,
        type_param: TypeParam<'a>,
        type_var: TypeVar<'a>,
        type_var_tuple: TypeVarTuple<'a>,
        type_var_like: TypeVarLike<'a>,
    }

    // Expressions
    visitor_methods! {
        expression: Expression<'a>,
        name: Name<'a>,
        attribute: Attribute<'a>,
        call: Call<'a>,
        subscript: Subscript<'a>,
        binary_operation: BinaryOperation<'a>,
        unary_operation: UnaryOperation<'a>,
        boolean_operation: BooleanOperation<'a>,
        comparison: Comparison<'a>,
        comparison_target: ComparisonTarget<'a>,
        if_exp: IfExp<'a>,
        lambda: Lambda<'a>,
        named_expr: NamedExpr<'a>,
    }

    // Collection expressions
    visitor_methods! {
        tuple: Tuple<'a>,
        list: List<'a>,
        set: Set<'a>,
        dict: Dict<'a>,
        dict_element: DictElement<'a>,
        starred_dict_element: StarredDictElement<'a>,
        element: Element<'a>,
        starred_element: StarredElement<'a>,
    }

    // Comprehensions
    visitor_methods! {
        generator_exp: GeneratorExp<'a>,
        list_comp: ListComp<'a>,
        set_comp: SetComp<'a>,
        dict_comp: DictComp<'a>,
        comp_for: CompFor<'a>,
        comp_if: CompIf<'a>,
    }

    // String literals
    visitor_methods! {
        simple_string: SimpleString<'a>,
        concatenated_string: ConcatenatedString<'a>,
        formatted_string: FormattedString<'a>,
        formatted_string_content: FormattedStringContent<'a>,
        formatted_string_expression: FormattedStringExpression<'a>,
        formatted_string_text: FormattedStringText<'a>,
        templated_string: TemplatedString<'a>,
        templated_string_content: TemplatedStringContent<'a>,
        templated_string_expression: TemplatedStringExpression<'a>,
        templated_string_text: TemplatedStringText<'a>,
    }

    // Numeric literals
    visitor_methods! {
        integer: Integer<'a>,
        float_literal: Float<'a>,
        imaginary: Imaginary<'a>,
        ellipsis: Ellipsis<'a>,
    }

    // Function-related
    visitor_methods! {
        parameters: Parameters<'a>,
        param: Param<'a>,
        param_star: ParamStar<'a>,
        param_slash: ParamSlash<'a>,
        star_arg: StarArg<'a>,
        arg: Arg<'a>,
    }

    // Slicing
    visitor_methods! {
        base_slice: BaseSlice<'a>,
        index: Index<'a>,
        slice: Slice<'a>,
        subscript_element: SubscriptElement<'a>,
    }

    // Async
    visitor_methods! {
        await_expr: Await<'a>,
        yield_expr: Yield<'a>,
        yield_value: YieldValue<'a>,
        yield_from: YieldFrom<'a>,
        asynchronous: Asynchronous<'a>,
    }

    // Annotations and targets
    visitor_methods! {
        annotation: Annotation<'a>,
        assign_target: AssignTarget<'a>,
        assign_target_expression: AssignTargetExpression<'a>,
        del_target_expression: DelTargetExpression<'a>,
        name_item: NameItem<'a>,
    }

    // Parentheses and brackets
    visitor_methods! {
        left_paren: LeftParen<'a>,
        right_paren: RightParen<'a>,
        left_square_bracket: LeftSquareBracket<'a>,
        right_square_bracket: RightSquareBracket<'a>,
        left_curly_brace: LeftCurlyBrace<'a>,
        right_curly_brace: RightCurlyBrace<'a>,
    }

    // Operators
    visitor_methods! {
        assign_equal: AssignEqual<'a>,
        aug_op: AugOp<'a>,
        binary_op: BinaryOp<'a>,
        boolean_op: BooleanOp<'a>,
        comp_op: CompOp<'a>,
        unary_op: UnaryOp<'a>,
        bit_or: BitOr<'a>,
        colon: Colon<'a>,
        comma: Comma<'a>,
        dot: Dot<'a>,
        semicolon: Semicolon<'a>,
        import_star: ImportStar,
        name_or_attribute: NameOrAttribute<'a>,
    }

    // Whitespace
    visitor_methods! {
        comment: Comment<'a>,
        empty_line: EmptyLine<'a>,
        newline: Newline<'a>,
        parenthesizable_whitespace: ParenthesizableWhitespace<'a>,
        parenthesized_whitespace: ParenthesizedWhitespace<'a>,
        simple_whitespace: SimpleWhitespace<'a>,
        trailing_whitespace: TrailingWhitespace<'a>,
    }
}

/// Transformer for modifying CST nodes.
///
/// Implement this trait to traverse and transform a CST. Each node type has
/// a corresponding `transform_*` method that receives owned nodes and returns
/// modified nodes.
///
/// # List Contexts
///
/// Some methods return [`Transform<T>`] instead of `T` directly, allowing nodes
/// to be removed or replaced with multiple nodes in list contexts (like statement
/// lists).
///
/// # Example
///
/// ```ignore
/// use tugtool_python_cst::visitor::{Transformer, Transform};
/// use tugtool_python_cst::Name;
///
/// struct Renamer<'a> {
///     from: &'a str,
///     to: &'a str,
/// }
///
/// impl<'a> Transformer<'a> for Renamer<'a> {
///     fn transform_name(&mut self, mut node: Name<'a>) -> Name<'a> {
///         if node.value == self.from {
///             // In a real implementation, you'd create a new Name
///         }
///         node
///     }
/// }
/// ```
pub trait Transformer<'a> {
    // Module
    transformer_methods! {
        module: Module<'a>,
    }

    // Statements (list context - can be removed/flattened)
    transformer_list_methods! {
        statement: Statement<'a>,
    }

    // Statements (non-list context)
    transformer_methods! {
        compound_statement: CompoundStatement<'a>,
        simple_statement_line: SimpleStatementLine<'a>,
        simple_statement_suite: SimpleStatementSuite<'a>,
        suite: Suite<'a>,
        indented_block: IndentedBlock<'a>,
    }

    // Small statements (list context)
    transformer_list_methods! {
        small_statement: SmallStatement<'a>,
    }

    // Compound statements
    transformer_methods! {
        function_def: FunctionDef<'a>,
        class_def: ClassDef<'a>,
        if_stmt: If<'a>,
        for_stmt: For<'a>,
        while_stmt: While<'a>,
        try_stmt: Try<'a>,
        try_star: TryStar<'a>,
        with_stmt: With<'a>,
        match_stmt: Match<'a>,
    }

    // Simple statements
    transformer_methods! {
        pass_stmt: Pass<'a>,
        break_stmt: Break<'a>,
        continue_stmt: Continue<'a>,
        return_stmt: Return<'a>,
        raise_stmt: Raise<'a>,
        assert_stmt: Assert<'a>,
        del_stmt: Del<'a>,
        global_stmt: Global<'a>,
        nonlocal_stmt: Nonlocal<'a>,
        import_stmt: Import<'a>,
        import_from: ImportFrom<'a>,
        import_alias: ImportAlias<'a>,
        import_names: ImportNames<'a>,
        as_name: AsName<'a>,
        assign: Assign<'a>,
        ann_assign: AnnAssign<'a>,
        aug_assign: AugAssign<'a>,
        expr: Expr<'a>,
        decorator: Decorator<'a>,
        type_alias: TypeAlias<'a>,
    }

    // Exception handling
    transformer_methods! {
        except_handler: ExceptHandler<'a>,
        except_star_handler: ExceptStarHandler<'a>,
        else_clause: Else<'a>,
        finally_clause: Finally<'a>,
        or_else: OrElse<'a>,
        with_item: WithItem<'a>,
    }

    // Match statement components
    transformer_methods! {
        match_case: MatchCase<'a>,
        match_pattern: MatchPattern<'a>,
        match_as: MatchAs<'a>,
        match_or: MatchOr<'a>,
        match_or_element: MatchOrElement<'a>,
        match_value: MatchValue<'a>,
        match_singleton: MatchSingleton<'a>,
        match_sequence: MatchSequence<'a>,
        match_sequence_element: MatchSequenceElement<'a>,
        starrable_match_sequence_element: StarrableMatchSequenceElement<'a>,
        match_star: MatchStar<'a>,
        match_mapping: MatchMapping<'a>,
        match_mapping_element: MatchMappingElement<'a>,
        match_class: MatchClass<'a>,
        match_keyword_element: MatchKeywordElement<'a>,
        match_list: MatchList<'a>,
        match_tuple: MatchTuple<'a>,
    }

    // Type parameters
    transformer_methods! {
        type_parameters: TypeParameters<'a>,
        type_param: TypeParam<'a>,
        type_var: TypeVar<'a>,
        type_var_tuple: TypeVarTuple<'a>,
        type_var_like: TypeVarLike<'a>,
    }

    // Expressions
    transformer_methods! {
        expression: Expression<'a>,
        name: Name<'a>,
        attribute: Attribute<'a>,
        call: Call<'a>,
        subscript: Subscript<'a>,
        binary_operation: BinaryOperation<'a>,
        unary_operation: UnaryOperation<'a>,
        boolean_operation: BooleanOperation<'a>,
        comparison: Comparison<'a>,
        comparison_target: ComparisonTarget<'a>,
        if_exp: IfExp<'a>,
        lambda: Lambda<'a>,
        named_expr: NamedExpr<'a>,
    }

    // Collection expressions
    transformer_methods! {
        tuple: Tuple<'a>,
        list: List<'a>,
        set: Set<'a>,
        dict: Dict<'a>,
        dict_element: DictElement<'a>,
        starred_dict_element: StarredDictElement<'a>,
        element: Element<'a>,
        starred_element: StarredElement<'a>,
    }

    // Comprehensions
    transformer_methods! {
        generator_exp: GeneratorExp<'a>,
        list_comp: ListComp<'a>,
        set_comp: SetComp<'a>,
        dict_comp: DictComp<'a>,
        comp_for: CompFor<'a>,
        comp_if: CompIf<'a>,
    }

    // String literals
    transformer_methods! {
        simple_string: SimpleString<'a>,
        concatenated_string: ConcatenatedString<'a>,
        formatted_string: FormattedString<'a>,
        formatted_string_content: FormattedStringContent<'a>,
        formatted_string_expression: FormattedStringExpression<'a>,
        formatted_string_text: FormattedStringText<'a>,
        templated_string: TemplatedString<'a>,
        templated_string_content: TemplatedStringContent<'a>,
        templated_string_expression: TemplatedStringExpression<'a>,
        templated_string_text: TemplatedStringText<'a>,
    }

    // Numeric literals
    transformer_methods! {
        integer: Integer<'a>,
        float_literal: Float<'a>,
        imaginary: Imaginary<'a>,
        ellipsis: Ellipsis<'a>,
    }

    // Function-related
    transformer_methods! {
        parameters: Parameters<'a>,
        param: Param<'a>,
        param_star: ParamStar<'a>,
        param_slash: ParamSlash<'a>,
        star_arg: StarArg<'a>,
        arg: Arg<'a>,
    }

    // Slicing
    transformer_methods! {
        base_slice: BaseSlice<'a>,
        index: Index<'a>,
        slice: Slice<'a>,
        subscript_element: SubscriptElement<'a>,
    }

    // Async
    transformer_methods! {
        await_expr: Await<'a>,
        yield_expr: Yield<'a>,
        yield_value: YieldValue<'a>,
        yield_from: YieldFrom<'a>,
        asynchronous: Asynchronous<'a>,
    }

    // Annotations and targets
    transformer_methods! {
        annotation: Annotation<'a>,
        assign_target: AssignTarget<'a>,
        assign_target_expression: AssignTargetExpression<'a>,
        del_target_expression: DelTargetExpression<'a>,
        name_item: NameItem<'a>,
    }

    // Parentheses and brackets
    transformer_methods! {
        left_paren: LeftParen<'a>,
        right_paren: RightParen<'a>,
        left_square_bracket: LeftSquareBracket<'a>,
        right_square_bracket: RightSquareBracket<'a>,
        left_curly_brace: LeftCurlyBrace<'a>,
        right_curly_brace: RightCurlyBrace<'a>,
    }

    // Operators
    transformer_methods! {
        assign_equal: AssignEqual<'a>,
        aug_op: AugOp<'a>,
        binary_op: BinaryOp<'a>,
        boolean_op: BooleanOp<'a>,
        comp_op: CompOp<'a>,
        unary_op: UnaryOp<'a>,
        bit_or: BitOr<'a>,
        colon: Colon<'a>,
        comma: Comma<'a>,
        dot: Dot<'a>,
        semicolon: Semicolon<'a>,
        import_star: ImportStar,
        name_or_attribute: NameOrAttribute<'a>,
    }

    // Whitespace
    transformer_methods! {
        comment: Comment<'a>,
        empty_line: EmptyLine<'a>,
        newline: Newline<'a>,
        parenthesizable_whitespace: ParenthesizableWhitespace<'a>,
        parenthesized_whitespace: ParenthesizedWhitespace<'a>,
        simple_whitespace: SimpleWhitespace<'a>,
        trailing_whitespace: TrailingWhitespace<'a>,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module;

    // Example visitor implementations to verify the trait can be implemented.
    // These are placeholders that will be used with walk functions in Step 3.2.

    /// A simple visitor that counts Name nodes.
    #[allow(dead_code)]
    struct NameCounter {
        count: usize,
    }

    impl<'a> Visitor<'a> for NameCounter {
        fn visit_name(&mut self, _node: &Name<'a>) -> VisitResult {
            self.count += 1;
            VisitResult::Continue
        }
    }

    /// A visitor that stops after finding a specific name.
    #[allow(dead_code)]
    struct NameFinder<'a> {
        target: &'a str,
        found: bool,
    }

    impl<'a> Visitor<'a> for NameFinder<'a> {
        fn visit_name(&mut self, node: &Name<'a>) -> VisitResult {
            if node.value == self.target {
                self.found = true;
                VisitResult::Stop
            } else {
                VisitResult::Continue
            }
        }
    }

    /// A visitor that tracks visit/leave call order.
    #[allow(dead_code)]
    struct OrderTracker {
        events: Vec<String>,
    }

    impl<'a> Visitor<'a> for OrderTracker {
        fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
            self.events.push(format!("function_def:{}", node.name.value));
            VisitResult::Continue
        }

        fn leave_function_def(&mut self, node: &FunctionDef<'a>) {
            self.events.push(format!("leave_function_def:{}", node.name.value));
        }

        fn visit_name(&mut self, node: &Name<'a>) -> VisitResult {
            self.events.push(format!("name:{}", node.value));
            VisitResult::Continue
        }

        fn leave_name(&mut self, node: &Name<'a>) {
            self.events.push(format!("leave_name:{}", node.value));
        }
    }

    #[test]
    fn test_visit_result_default() {
        assert_eq!(VisitResult::default(), VisitResult::Continue);
    }

    #[test]
    fn test_transform_variants() {
        let keep: Transform<i32> = Transform::Keep(42);
        assert!(keep.is_keep());
        assert!(!keep.is_remove());
        assert!(!keep.is_flatten());

        let remove: Transform<i32> = Transform::Remove;
        assert!(!remove.is_keep());
        assert!(remove.is_remove());
        assert!(!remove.is_flatten());

        let flatten: Transform<i32> = Transform::Flatten(vec![1, 2, 3]);
        assert!(!flatten.is_keep());
        assert!(!flatten.is_remove());
        assert!(flatten.is_flatten());
    }

    #[test]
    fn test_transform_map() {
        let keep: Transform<i32> = Transform::Keep(42);
        let mapped = keep.map(|x| x * 2);
        match mapped {
            Transform::Keep(v) => assert_eq!(v, 84),
            _ => panic!("Expected Keep"),
        }

        let remove: Transform<i32> = Transform::Remove;
        let mapped = remove.map(|x| x * 2);
        assert!(mapped.is_remove());

        let flatten: Transform<i32> = Transform::Flatten(vec![1, 2, 3]);
        let mapped = flatten.map(|x| x * 2);
        match mapped {
            Transform::Flatten(v) => assert_eq!(v, vec![2, 4, 6]),
            _ => panic!("Expected Flatten"),
        }
    }

    #[test]
    fn test_transform_from() {
        let t: Transform<i32> = 42.into();
        match t {
            Transform::Keep(v) => assert_eq!(v, 42),
            _ => panic!("Expected Keep"),
        }
    }

    #[test]
    fn test_visitor_trait_compiles() {
        // This test verifies that the Visitor trait can be implemented
        // and the default implementations work.
        struct EmptyVisitor;

        impl<'a> Visitor<'a> for EmptyVisitor {}

        let _v = EmptyVisitor;
    }

    #[test]
    fn test_transformer_trait_compiles() {
        // This test verifies that the Transformer trait can be implemented
        // and the default implementations work.
        struct EmptyTransformer;

        impl<'a> Transformer<'a> for EmptyTransformer {}

        let _t = EmptyTransformer;
    }

    #[test]
    fn test_visitor_default_implementations() {
        // Verify that default implementations return expected values
        struct TestVisitor;
        impl<'a> Visitor<'a> for TestVisitor {}

        let mut visitor = TestVisitor;
        let source = "x = 1";
        let module = parse_module(source, None).expect("parse error");

        // Default visit_module should return Continue
        let result = visitor.visit_module(&module);
        assert_eq!(result, VisitResult::Continue);
    }
}
