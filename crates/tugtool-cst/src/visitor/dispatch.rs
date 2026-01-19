// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Walk functions for CST traversal.
//!
//! This module contains walk functions that traverse CST nodes and call visitor methods.
//! The traversal order follows Python LibCST's visitor pattern:
//!
//! - **Pre-order**: `visit_*` is called before descending into children
//! - **Post-order**: `leave_*` is called after all children have been visited
//! - **Source order**: Children are visited left-to-right, top-to-bottom
//!
//! # Control Flow
//!
//! - `VisitResult::Continue` - traverse into children
//! - `VisitResult::SkipChildren` - skip children but still call `leave_*`
//! - `VisitResult::Stop` - halt traversal immediately (no `leave_*` called)

use super::traits::{VisitResult, Visitor};
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
    TemplatedStringExpression,
    // Literals
    Integer, Float, Imaginary, Ellipsis,
    // Function-related
    Parameters, Param, ParamStar, ParamSlash, Arg, StarArg,
    // Slicing
    BaseSlice, Index, Slice, SubscriptElement,
    // Async
    Await, Yield, YieldValue, From as YieldFrom,
    // Annotation
    Annotation, AssignTarget, AssignTargetExpression, DelTargetExpression, NameItem,
    // Operators
    NameOrAttribute,
    // Templated string text
    TemplatedStringText,
};

// ============================================================================
// Module walk
// ============================================================================

/// Walk a [`Module`] node and its children.
///
/// Traversal order:
/// 1. `visit_module`
/// 2. Walk each statement in `body` (in source order)
/// 3. `leave_module`
pub fn walk_module<'a, V: Visitor<'a>>(visitor: &mut V, node: &Module<'a>) -> VisitResult {
    let result = visitor.visit_module(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for stmt in &node.body {
                if walk_statement(visitor, stmt) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_module(node);
    VisitResult::Continue
}

// ============================================================================
// Statement walks
// ============================================================================

/// Walk a [`Statement`] node.
///
/// Dispatches to either simple or compound statement walk.
pub fn walk_statement<'a, V: Visitor<'a>>(visitor: &mut V, node: &Statement<'a>) -> VisitResult {
    let result = visitor.visit_statement(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                Statement::Simple(s) => walk_simple_statement_line(visitor, s),
                Statement::Compound(c) => walk_compound_statement(visitor, c),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_statement(node);
    VisitResult::Continue
}

/// Walk a [`CompoundStatement`] node.
///
/// Dispatches to specific compound statement walks.
pub fn walk_compound_statement<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &CompoundStatement<'a>,
) -> VisitResult {
    let result = visitor.visit_compound_statement(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                CompoundStatement::FunctionDef(f) => walk_function_def(visitor, f),
                CompoundStatement::ClassDef(c) => walk_class_def(visitor, c),
                CompoundStatement::If(i) => walk_if(visitor, i),
                CompoundStatement::For(f) => walk_for(visitor, f),
                CompoundStatement::While(w) => walk_while(visitor, w),
                CompoundStatement::Try(t) => walk_try(visitor, t),
                CompoundStatement::TryStar(t) => walk_try_star(visitor, t),
                CompoundStatement::With(w) => walk_with(visitor, w),
                CompoundStatement::Match(m) => walk_match(visitor, m),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_compound_statement(node);
    VisitResult::Continue
}

/// Walk a [`Suite`] node.
pub fn walk_suite<'a, V: Visitor<'a>>(visitor: &mut V, node: &Suite<'a>) -> VisitResult {
    let result = visitor.visit_suite(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                Suite::IndentedBlock(b) => walk_indented_block(visitor, b),
                Suite::SimpleStatementSuite(s) => walk_simple_statement_suite(visitor, s),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_suite(node);
    VisitResult::Continue
}

/// Walk an [`IndentedBlock`] node.
pub fn walk_indented_block<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &IndentedBlock<'a>,
) -> VisitResult {
    let result = visitor.visit_indented_block(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for stmt in &node.body {
                if walk_statement(visitor, stmt) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_indented_block(node);
    VisitResult::Continue
}

/// Walk a [`SimpleStatementLine`] node.
pub fn walk_simple_statement_line<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &SimpleStatementLine<'a>,
) -> VisitResult {
    let result = visitor.visit_simple_statement_line(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for stmt in &node.body {
                if walk_small_statement(visitor, stmt) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_simple_statement_line(node);
    VisitResult::Continue
}

/// Walk a [`SimpleStatementSuite`] node.
pub fn walk_simple_statement_suite<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &SimpleStatementSuite<'a>,
) -> VisitResult {
    let result = visitor.visit_simple_statement_suite(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for stmt in &node.body {
                if walk_small_statement(visitor, stmt) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_simple_statement_suite(node);
    VisitResult::Continue
}

/// Walk a [`SmallStatement`] node.
pub fn walk_small_statement<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &SmallStatement<'a>,
) -> VisitResult {
    let result = visitor.visit_small_statement(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                SmallStatement::Pass(p) => walk_pass(visitor, p),
                SmallStatement::Break(b) => walk_break(visitor, b),
                SmallStatement::Continue(c) => walk_continue(visitor, c),
                SmallStatement::Return(r) => walk_return(visitor, r),
                SmallStatement::Expr(e) => walk_expr_stmt(visitor, e),
                SmallStatement::Assert(a) => walk_assert(visitor, a),
                SmallStatement::Import(i) => walk_import(visitor, i),
                SmallStatement::ImportFrom(i) => walk_import_from(visitor, i),
                SmallStatement::Assign(a) => walk_assign(visitor, a),
                SmallStatement::AnnAssign(a) => walk_ann_assign(visitor, a),
                SmallStatement::Raise(r) => walk_raise(visitor, r),
                SmallStatement::Global(g) => walk_global(visitor, g),
                SmallStatement::Nonlocal(n) => walk_nonlocal(visitor, n),
                SmallStatement::AugAssign(a) => walk_aug_assign(visitor, a),
                SmallStatement::Del(d) => walk_del(visitor, d),
                SmallStatement::TypeAlias(t) => walk_type_alias(visitor, t),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_small_statement(node);
    VisitResult::Continue
}

// ============================================================================
// Compound statement walks
// ============================================================================

/// Walk a [`FunctionDef`] node.
///
/// Traversal order:
/// 1. `visit_function_def`
/// 2. Walk decorators
/// 3. Walk name
/// 4. Walk type_parameters (if present)
/// 5. Walk params
/// 6. Walk returns annotation (if present)
/// 7. Walk body
/// 8. `leave_function_def`
pub fn walk_function_def<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &FunctionDef<'a>,
) -> VisitResult {
    let result = visitor.visit_function_def(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // Walk decorators first
            for dec in &node.decorators {
                if walk_decorator(visitor, dec) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk function name
            if walk_name(visitor, &node.name) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk type parameters
            if let Some(tp) = &node.type_parameters {
                if walk_type_parameters(visitor, tp) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk parameters
            if walk_parameters(visitor, &node.params) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk return annotation
            if let Some(returns) = &node.returns {
                if walk_annotation(visitor, returns) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk body
            if walk_suite(visitor, &node.body) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_function_def(node);
    VisitResult::Continue
}

/// Walk a [`ClassDef`] node.
pub fn walk_class_def<'a, V: Visitor<'a>>(visitor: &mut V, node: &ClassDef<'a>) -> VisitResult {
    let result = visitor.visit_class_def(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // Walk decorators
            for dec in &node.decorators {
                if walk_decorator(visitor, dec) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk class name
            if walk_name(visitor, &node.name) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk type parameters
            if let Some(tp) = &node.type_parameters {
                if walk_type_parameters(visitor, tp) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk base classes
            for base in &node.bases {
                if walk_arg(visitor, base) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk keyword arguments
            for kw in &node.keywords {
                if walk_arg(visitor, kw) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk body
            if walk_suite(visitor, &node.body) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_class_def(node);
    VisitResult::Continue
}

/// Walk an [`If`] node.
pub fn walk_if<'a, V: Visitor<'a>>(visitor: &mut V, node: &If<'a>) -> VisitResult {
    let result = visitor.visit_if_stmt(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // Walk test expression
            if walk_expression(visitor, &node.test) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk body
            if walk_suite(visitor, &node.body) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk orelse (elif or else)
            if let Some(orelse) = &node.orelse {
                if walk_or_else(visitor, orelse) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_if_stmt(node);
    VisitResult::Continue
}

/// Walk an [`OrElse`] node.
pub fn walk_or_else<'a, V: Visitor<'a>>(visitor: &mut V, node: &OrElse<'a>) -> VisitResult {
    let result = visitor.visit_or_else(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                OrElse::Elif(elif) => walk_if(visitor, elif),
                OrElse::Else(else_clause) => walk_else(visitor, else_clause),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_or_else(node);
    VisitResult::Continue
}

/// Walk an [`Else`] node.
pub fn walk_else<'a, V: Visitor<'a>>(visitor: &mut V, node: &Else<'a>) -> VisitResult {
    let result = visitor.visit_else_clause(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_suite(visitor, &node.body) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_else_clause(node);
    VisitResult::Continue
}

/// Walk a [`For`] node.
pub fn walk_for<'a, V: Visitor<'a>>(visitor: &mut V, node: &For<'a>) -> VisitResult {
    let result = visitor.visit_for_stmt(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // Walk target
            if walk_assign_target_expression(visitor, &node.target) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk iter expression
            if walk_expression(visitor, &node.iter) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk body
            if walk_suite(visitor, &node.body) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk else clause
            if let Some(orelse) = &node.orelse {
                if walk_else(visitor, orelse) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_for_stmt(node);
    VisitResult::Continue
}

/// Walk a [`While`] node.
pub fn walk_while<'a, V: Visitor<'a>>(visitor: &mut V, node: &While<'a>) -> VisitResult {
    let result = visitor.visit_while_stmt(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // Walk test expression
            if walk_expression(visitor, &node.test) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk body
            if walk_suite(visitor, &node.body) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk else clause
            if let Some(orelse) = &node.orelse {
                if walk_else(visitor, orelse) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_while_stmt(node);
    VisitResult::Continue
}

/// Walk a [`Try`] node.
pub fn walk_try<'a, V: Visitor<'a>>(visitor: &mut V, node: &Try<'a>) -> VisitResult {
    let result = visitor.visit_try_stmt(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // Walk body
            if walk_suite(visitor, &node.body) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk handlers
            for handler in &node.handlers {
                if walk_except_handler(visitor, handler) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk else clause
            if let Some(orelse) = &node.orelse {
                if walk_else(visitor, orelse) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk finally clause
            if let Some(finalbody) = &node.finalbody {
                if walk_finally(visitor, finalbody) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_try_stmt(node);
    VisitResult::Continue
}

/// Walk a [`TryStar`] node.
pub fn walk_try_star<'a, V: Visitor<'a>>(visitor: &mut V, node: &TryStar<'a>) -> VisitResult {
    let result = visitor.visit_try_star(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // Walk body
            if walk_suite(visitor, &node.body) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk handlers
            for handler in &node.handlers {
                if walk_except_star_handler(visitor, handler) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk else clause
            if let Some(orelse) = &node.orelse {
                if walk_else(visitor, orelse) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk finally clause
            if let Some(finalbody) = &node.finalbody {
                if walk_finally(visitor, finalbody) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_try_star(node);
    VisitResult::Continue
}

/// Walk an [`ExceptHandler`] node.
pub fn walk_except_handler<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &ExceptHandler<'a>,
) -> VisitResult {
    let result = visitor.visit_except_handler(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // Walk exception type
            if let Some(t) = &node.r#type {
                if walk_expression(visitor, t) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk name binding
            if let Some(name) = &node.name {
                if walk_as_name(visitor, name) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk body
            if walk_suite(visitor, &node.body) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_except_handler(node);
    VisitResult::Continue
}

/// Walk an [`ExceptStarHandler`] node.
pub fn walk_except_star_handler<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &ExceptStarHandler<'a>,
) -> VisitResult {
    let result = visitor.visit_except_star_handler(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // Walk exception type
            if walk_expression(visitor, &node.r#type) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk name binding
            if let Some(name) = &node.name {
                if walk_as_name(visitor, name) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk body
            if walk_suite(visitor, &node.body) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_except_star_handler(node);
    VisitResult::Continue
}

/// Walk a [`Finally`] node.
pub fn walk_finally<'a, V: Visitor<'a>>(visitor: &mut V, node: &Finally<'a>) -> VisitResult {
    let result = visitor.visit_finally_clause(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_suite(visitor, &node.body) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_finally_clause(node);
    VisitResult::Continue
}

/// Walk a [`With`] node.
pub fn walk_with<'a, V: Visitor<'a>>(visitor: &mut V, node: &With<'a>) -> VisitResult {
    let result = visitor.visit_with_stmt(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // Walk with items
            for item in &node.items {
                if walk_with_item(visitor, item) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk body
            if walk_suite(visitor, &node.body) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_with_stmt(node);
    VisitResult::Continue
}

/// Walk a [`WithItem`] node.
pub fn walk_with_item<'a, V: Visitor<'a>>(visitor: &mut V, node: &WithItem<'a>) -> VisitResult {
    let result = visitor.visit_with_item(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // Walk context expression
            if walk_expression(visitor, &node.item) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk as name
            if let Some(asname) = &node.asname {
                if walk_as_name(visitor, asname) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_with_item(node);
    VisitResult::Continue
}

/// Walk a [`Match`] node.
pub fn walk_match<'a, V: Visitor<'a>>(visitor: &mut V, node: &Match<'a>) -> VisitResult {
    let result = visitor.visit_match_stmt(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // Walk subject expression
            if walk_expression(visitor, &node.subject) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk cases
            for case in &node.cases {
                if walk_match_case(visitor, case) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_match_stmt(node);
    VisitResult::Continue
}

/// Walk a [`MatchCase`] node.
pub fn walk_match_case<'a, V: Visitor<'a>>(visitor: &mut V, node: &MatchCase<'a>) -> VisitResult {
    let result = visitor.visit_match_case(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // Walk pattern
            if walk_match_pattern(visitor, &node.pattern) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk guard
            if let Some(guard) = &node.guard {
                if walk_expression(visitor, guard) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk body
            if walk_suite(visitor, &node.body) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_match_case(node);
    VisitResult::Continue
}

/// Walk a [`MatchPattern`] node.
pub fn walk_match_pattern<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &MatchPattern<'a>,
) -> VisitResult {
    let result = visitor.visit_match_pattern(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                MatchPattern::Value(v) => walk_match_value(visitor, v),
                MatchPattern::Singleton(s) => walk_match_singleton(visitor, s),
                MatchPattern::Sequence(s) => walk_match_sequence(visitor, s),
                MatchPattern::Mapping(m) => walk_match_mapping(visitor, m),
                MatchPattern::Class(c) => walk_match_class(visitor, c),
                MatchPattern::As(a) => walk_match_as(visitor, a),
                MatchPattern::Or(o) => walk_match_or(visitor, o),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_match_pattern(node);
    VisitResult::Continue
}

/// Walk a [`MatchValue`] node.
pub fn walk_match_value<'a, V: Visitor<'a>>(visitor: &mut V, node: &MatchValue<'a>) -> VisitResult {
    let result = visitor.visit_match_value(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.value) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_match_value(node);
    VisitResult::Continue
}

/// Walk a [`MatchSingleton`] node.
pub fn walk_match_singleton<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &MatchSingleton<'a>,
) -> VisitResult {
    let result = visitor.visit_match_singleton(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_name(visitor, &node.value) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_match_singleton(node);
    VisitResult::Continue
}

/// Walk a [`MatchSequence`] node.
///
/// MatchSequence is an enum with MatchList and MatchTuple variants.
pub fn walk_match_sequence<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &MatchSequence<'a>,
) -> VisitResult {
    let result = visitor.visit_match_sequence(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                MatchSequence::MatchList(l) => walk_match_list(visitor, l),
                MatchSequence::MatchTuple(t) => walk_match_tuple(visitor, t),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_match_sequence(node);
    VisitResult::Continue
}

/// Walk a [`StarrableMatchSequenceElement`] node.
pub fn walk_starrable_match_sequence_element<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &StarrableMatchSequenceElement<'a>,
) -> VisitResult {
    let result = visitor.visit_starrable_match_sequence_element(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                StarrableMatchSequenceElement::Simple(e) => walk_match_sequence_element(visitor, e),
                StarrableMatchSequenceElement::Starred(s) => walk_match_star(visitor, s),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_starrable_match_sequence_element(node);
    VisitResult::Continue
}

/// Walk a [`MatchSequenceElement`] node.
pub fn walk_match_sequence_element<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &MatchSequenceElement<'a>,
) -> VisitResult {
    let result = visitor.visit_match_sequence_element(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_match_pattern(visitor, &node.value) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_match_sequence_element(node);
    VisitResult::Continue
}

/// Walk a [`MatchStar`] node.
pub fn walk_match_star<'a, V: Visitor<'a>>(visitor: &mut V, node: &MatchStar<'a>) -> VisitResult {
    let result = visitor.visit_match_star(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if let Some(name) = &node.name {
                if walk_name(visitor, name) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_match_star(node);
    VisitResult::Continue
}

/// Walk a [`MatchMapping`] node.
pub fn walk_match_mapping<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &MatchMapping<'a>,
) -> VisitResult {
    let result = visitor.visit_match_mapping(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for elem in &node.elements {
                if walk_match_mapping_element(visitor, elem) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            if let Some(rest) = &node.rest {
                if walk_name(visitor, rest) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_match_mapping(node);
    VisitResult::Continue
}

/// Walk a [`MatchMappingElement`] node.
pub fn walk_match_mapping_element<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &MatchMappingElement<'a>,
) -> VisitResult {
    let result = visitor.visit_match_mapping_element(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.key) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_match_pattern(visitor, &node.pattern) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_match_mapping_element(node);
    VisitResult::Continue
}

/// Walk a [`MatchClass`] node.
pub fn walk_match_class<'a, V: Visitor<'a>>(visitor: &mut V, node: &MatchClass<'a>) -> VisitResult {
    let result = visitor.visit_match_class(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // Walk class name
            if walk_name_or_attribute(visitor, &node.cls) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            // Walk positional patterns
            for pattern in &node.patterns {
                if walk_match_sequence_element(visitor, pattern) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk keyword patterns
            for kw in &node.kwds {
                if walk_match_keyword_element(visitor, kw) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_match_class(node);
    VisitResult::Continue
}

/// Walk a [`MatchKeywordElement`] node.
pub fn walk_match_keyword_element<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &MatchKeywordElement<'a>,
) -> VisitResult {
    let result = visitor.visit_match_keyword_element(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_name(visitor, &node.key) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_match_pattern(visitor, &node.pattern) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_match_keyword_element(node);
    VisitResult::Continue
}

/// Walk a [`MatchAs`] node.
pub fn walk_match_as<'a, V: Visitor<'a>>(visitor: &mut V, node: &MatchAs<'a>) -> VisitResult {
    let result = visitor.visit_match_as(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if let Some(pattern) = &node.pattern {
                if walk_match_pattern(visitor, pattern) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            if let Some(name) = &node.name {
                if walk_name(visitor, name) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_match_as(node);
    VisitResult::Continue
}

/// Walk a [`MatchOr`] node.
pub fn walk_match_or<'a, V: Visitor<'a>>(visitor: &mut V, node: &MatchOr<'a>) -> VisitResult {
    let result = visitor.visit_match_or(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for pattern in &node.patterns {
                if walk_match_or_element(visitor, pattern) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_match_or(node);
    VisitResult::Continue
}

/// Walk a [`MatchOrElement`] node.
pub fn walk_match_or_element<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &MatchOrElement<'a>,
) -> VisitResult {
    let result = visitor.visit_match_or_element(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_match_pattern(visitor, &node.pattern) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_match_or_element(node);
    VisitResult::Continue
}

/// Walk a [`MatchList`] node.
pub fn walk_match_list<'a, V: Visitor<'a>>(visitor: &mut V, node: &MatchList<'a>) -> VisitResult {
    let result = visitor.visit_match_list(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for pattern in &node.patterns {
                if walk_starrable_match_sequence_element(visitor, pattern) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_match_list(node);
    VisitResult::Continue
}

/// Walk a [`MatchTuple`] node.
pub fn walk_match_tuple<'a, V: Visitor<'a>>(visitor: &mut V, node: &MatchTuple<'a>) -> VisitResult {
    let result = visitor.visit_match_tuple(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for pattern in &node.patterns {
                if walk_starrable_match_sequence_element(visitor, pattern) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_match_tuple(node);
    VisitResult::Continue
}

// ============================================================================
// Simple statement walks
// ============================================================================

/// Walk a [`Pass`] node (leaf node, no children).
pub fn walk_pass<'a, V: Visitor<'a>>(visitor: &mut V, node: &Pass<'a>) -> VisitResult {
    let result = visitor.visit_pass_stmt(node);
    if result == VisitResult::Stop {
        return VisitResult::Stop;
    }
    visitor.leave_pass_stmt(node);
    VisitResult::Continue
}

/// Walk a [`Break`] node (leaf node, no children).
pub fn walk_break<'a, V: Visitor<'a>>(visitor: &mut V, node: &Break<'a>) -> VisitResult {
    let result = visitor.visit_break_stmt(node);
    if result == VisitResult::Stop {
        return VisitResult::Stop;
    }
    visitor.leave_break_stmt(node);
    VisitResult::Continue
}

/// Walk a [`Continue`] node (leaf node, no children).
pub fn walk_continue<'a, V: Visitor<'a>>(visitor: &mut V, node: &Continue<'a>) -> VisitResult {
    let result = visitor.visit_continue_stmt(node);
    if result == VisitResult::Stop {
        return VisitResult::Stop;
    }
    visitor.leave_continue_stmt(node);
    VisitResult::Continue
}

/// Walk a [`Return`] node.
pub fn walk_return<'a, V: Visitor<'a>>(visitor: &mut V, node: &Return<'a>) -> VisitResult {
    let result = visitor.visit_return_stmt(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if let Some(value) = &node.value {
                if walk_expression(visitor, value) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_return_stmt(node);
    VisitResult::Continue
}

/// Walk an [`Expr`] statement node.
pub fn walk_expr_stmt<'a, V: Visitor<'a>>(visitor: &mut V, node: &Expr<'a>) -> VisitResult {
    let result = visitor.visit_expr(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.value) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_expr(node);
    VisitResult::Continue
}

/// Walk an [`Assert`] node.
pub fn walk_assert<'a, V: Visitor<'a>>(visitor: &mut V, node: &Assert<'a>) -> VisitResult {
    let result = visitor.visit_assert_stmt(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.test) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if let Some(msg) = &node.msg {
                if walk_expression(visitor, msg) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_assert_stmt(node);
    VisitResult::Continue
}

/// Walk an [`Import`] node.
pub fn walk_import<'a, V: Visitor<'a>>(visitor: &mut V, node: &Import<'a>) -> VisitResult {
    let result = visitor.visit_import_stmt(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for alias in &node.names {
                if walk_import_alias(visitor, alias) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_import_stmt(node);
    VisitResult::Continue
}

/// Walk an [`ImportFrom`] node.
pub fn walk_import_from<'a, V: Visitor<'a>>(visitor: &mut V, node: &ImportFrom<'a>) -> VisitResult {
    let result = visitor.visit_import_from(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // Walk module name
            if let Some(module) = &node.module {
                if walk_name_or_attribute(visitor, module) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk imported names
            if walk_import_names(visitor, &node.names) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_import_from(node);
    VisitResult::Continue
}

/// Walk an [`ImportNames`] node.
pub fn walk_import_names<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &ImportNames<'a>,
) -> VisitResult {
    let result = visitor.visit_import_names(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            match node {
                ImportNames::Star(_) => {
                    // Import star has no children to walk
                }
                ImportNames::Aliases(aliases) => {
                    for alias in aliases {
                        if walk_import_alias(visitor, alias) == VisitResult::Stop {
                            return VisitResult::Stop;
                        }
                    }
                }
            }
        }
    }
    visitor.leave_import_names(node);
    VisitResult::Continue
}

/// Walk an [`ImportAlias`] node.
pub fn walk_import_alias<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &ImportAlias<'a>,
) -> VisitResult {
    let result = visitor.visit_import_alias(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_name_or_attribute(visitor, &node.name) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if let Some(asname) = &node.asname {
                if walk_as_name(visitor, asname) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_import_alias(node);
    VisitResult::Continue
}

/// Walk an [`AsName`] node.
pub fn walk_as_name<'a, V: Visitor<'a>>(visitor: &mut V, node: &AsName<'a>) -> VisitResult {
    let result = visitor.visit_as_name(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_assign_target_expression(visitor, &node.name) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_as_name(node);
    VisitResult::Continue
}

/// Walk an [`Assign`] node.
pub fn walk_assign<'a, V: Visitor<'a>>(visitor: &mut V, node: &Assign<'a>) -> VisitResult {
    let result = visitor.visit_assign(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for target in &node.targets {
                if walk_assign_target(visitor, target) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            if walk_expression(visitor, &node.value) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_assign(node);
    VisitResult::Continue
}

/// Walk an [`AssignTarget`] node.
pub fn walk_assign_target<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &AssignTarget<'a>,
) -> VisitResult {
    let result = visitor.visit_assign_target(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_assign_target_expression(visitor, &node.target) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_assign_target(node);
    VisitResult::Continue
}

/// Walk an [`AssignTargetExpression`] node.
pub fn walk_assign_target_expression<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &AssignTargetExpression<'a>,
) -> VisitResult {
    let result = visitor.visit_assign_target_expression(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                AssignTargetExpression::Name(n) => walk_name(visitor, n),
                AssignTargetExpression::Attribute(a) => walk_attribute(visitor, a),
                AssignTargetExpression::StarredElement(s) => walk_starred_element(visitor, s),
                AssignTargetExpression::Tuple(t) => walk_tuple(visitor, t),
                AssignTargetExpression::List(l) => walk_list(visitor, l),
                AssignTargetExpression::Subscript(s) => walk_subscript(visitor, s),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_assign_target_expression(node);
    VisitResult::Continue
}

/// Walk an [`AnnAssign`] node.
pub fn walk_ann_assign<'a, V: Visitor<'a>>(visitor: &mut V, node: &AnnAssign<'a>) -> VisitResult {
    let result = visitor.visit_ann_assign(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_assign_target_expression(visitor, &node.target) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_annotation(visitor, &node.annotation) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if let Some(value) = &node.value {
                if walk_expression(visitor, value) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_ann_assign(node);
    VisitResult::Continue
}

/// Walk a [`Raise`] node.
pub fn walk_raise<'a, V: Visitor<'a>>(visitor: &mut V, node: &Raise<'a>) -> VisitResult {
    let result = visitor.visit_raise_stmt(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if let Some(exc) = &node.exc {
                if walk_expression(visitor, exc) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            if let Some(cause) = &node.cause {
                if walk_yield_from(visitor, cause) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_raise_stmt(node);
    VisitResult::Continue
}

/// Walk a [`Global`] node.
pub fn walk_global<'a, V: Visitor<'a>>(visitor: &mut V, node: &Global<'a>) -> VisitResult {
    let result = visitor.visit_global_stmt(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for item in &node.names {
                if walk_name_item(visitor, item) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_global_stmt(node);
    VisitResult::Continue
}

/// Walk a [`Nonlocal`] node.
pub fn walk_nonlocal<'a, V: Visitor<'a>>(visitor: &mut V, node: &Nonlocal<'a>) -> VisitResult {
    let result = visitor.visit_nonlocal_stmt(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for item in &node.names {
                if walk_name_item(visitor, item) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_nonlocal_stmt(node);
    VisitResult::Continue
}

/// Walk a [`NameItem`] node.
pub fn walk_name_item<'a, V: Visitor<'a>>(visitor: &mut V, node: &NameItem<'a>) -> VisitResult {
    let result = visitor.visit_name_item(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_name(visitor, &node.name) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_name_item(node);
    VisitResult::Continue
}

/// Walk an [`AugAssign`] node.
pub fn walk_aug_assign<'a, V: Visitor<'a>>(visitor: &mut V, node: &AugAssign<'a>) -> VisitResult {
    let result = visitor.visit_aug_assign(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_assign_target_expression(visitor, &node.target) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_expression(visitor, &node.value) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_aug_assign(node);
    VisitResult::Continue
}

/// Walk a [`Del`] node.
pub fn walk_del<'a, V: Visitor<'a>>(visitor: &mut V, node: &Del<'a>) -> VisitResult {
    let result = visitor.visit_del_stmt(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_del_target_expression(visitor, &node.target) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_del_stmt(node);
    VisitResult::Continue
}

/// Walk a [`DelTargetExpression`] node.
pub fn walk_del_target_expression<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &DelTargetExpression<'a>,
) -> VisitResult {
    let result = visitor.visit_del_target_expression(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                DelTargetExpression::Name(n) => walk_name(visitor, n),
                DelTargetExpression::Attribute(a) => walk_attribute(visitor, a),
                DelTargetExpression::Tuple(t) => walk_tuple(visitor, t),
                DelTargetExpression::List(l) => walk_list(visitor, l),
                DelTargetExpression::Subscript(s) => walk_subscript(visitor, s),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_del_target_expression(node);
    VisitResult::Continue
}

/// Walk a [`TypeAlias`] node.
pub fn walk_type_alias<'a, V: Visitor<'a>>(visitor: &mut V, node: &TypeAlias<'a>) -> VisitResult {
    let result = visitor.visit_type_alias(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_name(visitor, &node.name) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if let Some(tp) = &node.type_parameters {
                if walk_type_parameters(visitor, tp) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            if walk_expression(visitor, &node.value) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_type_alias(node);
    VisitResult::Continue
}

/// Walk a [`Decorator`] node.
pub fn walk_decorator<'a, V: Visitor<'a>>(visitor: &mut V, node: &Decorator<'a>) -> VisitResult {
    let result = visitor.visit_decorator(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.decorator) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_decorator(node);
    VisitResult::Continue
}

// ============================================================================
// Type parameter walks
// ============================================================================

/// Walk a [`TypeParameters`] node.
pub fn walk_type_parameters<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &TypeParameters<'a>,
) -> VisitResult {
    let result = visitor.visit_type_parameters(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for param in &node.params {
                if walk_type_param(visitor, param) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_type_parameters(node);
    VisitResult::Continue
}

/// Walk a [`TypeParam`] node.
pub fn walk_type_param<'a, V: Visitor<'a>>(visitor: &mut V, node: &TypeParam<'a>) -> VisitResult {
    let result = visitor.visit_type_param(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match &node.param {
                TypeVarLike::TypeVar(tv) => walk_type_var(visitor, tv),
                TypeVarLike::TypeVarTuple(tvt) => walk_type_var_tuple(visitor, tvt),
                TypeVarLike::ParamSpec(ps) => {
                    // ParamSpec just has a name
                    walk_name(visitor, &ps.name)
                }
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_type_param(node);
    VisitResult::Continue
}

/// Walk a [`TypeVar`] node.
pub fn walk_type_var<'a, V: Visitor<'a>>(visitor: &mut V, node: &TypeVar<'a>) -> VisitResult {
    let result = visitor.visit_type_var(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_name(visitor, &node.name) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if let Some(bound) = &node.bound {
                if walk_expression(visitor, bound) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_type_var(node);
    VisitResult::Continue
}

/// Walk a [`TypeVarTuple`] node.
pub fn walk_type_var_tuple<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &TypeVarTuple<'a>,
) -> VisitResult {
    let result = visitor.visit_type_var_tuple(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_name(visitor, &node.name) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_type_var_tuple(node);
    VisitResult::Continue
}

// ============================================================================
// Expression walks
// ============================================================================

/// Walk an [`Expression`] node.
///
/// Dispatches to specific expression walks based on variant.
pub fn walk_expression<'a, V: Visitor<'a>>(visitor: &mut V, node: &Expression<'a>) -> VisitResult {
    let result = visitor.visit_expression(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                Expression::Name(n) => walk_name(visitor, n),
                Expression::Ellipsis(e) => walk_ellipsis(visitor, e),
                Expression::Integer(i) => walk_integer(visitor, i),
                Expression::Float(f) => walk_float(visitor, f),
                Expression::Imaginary(i) => walk_imaginary(visitor, i),
                Expression::Comparison(c) => walk_comparison(visitor, c),
                Expression::UnaryOperation(u) => walk_unary_operation(visitor, u),
                Expression::BinaryOperation(b) => walk_binary_operation(visitor, b),
                Expression::BooleanOperation(b) => walk_boolean_operation(visitor, b),
                Expression::Attribute(a) => walk_attribute(visitor, a),
                Expression::Tuple(t) => walk_tuple(visitor, t),
                Expression::Call(c) => walk_call(visitor, c),
                Expression::GeneratorExp(g) => walk_generator_exp(visitor, g),
                Expression::ListComp(l) => walk_list_comp(visitor, l),
                Expression::SetComp(s) => walk_set_comp(visitor, s),
                Expression::DictComp(d) => walk_dict_comp(visitor, d),
                Expression::List(l) => walk_list(visitor, l),
                Expression::Set(s) => walk_set(visitor, s),
                Expression::Dict(d) => walk_dict(visitor, d),
                Expression::Subscript(s) => walk_subscript(visitor, s),
                Expression::StarredElement(s) => walk_starred_element(visitor, s),
                Expression::IfExp(i) => walk_if_exp(visitor, i),
                Expression::Lambda(l) => walk_lambda(visitor, l),
                Expression::Yield(y) => walk_yield(visitor, y),
                Expression::Await(a) => walk_await(visitor, a),
                Expression::SimpleString(s) => walk_simple_string(visitor, s),
                Expression::ConcatenatedString(c) => walk_concatenated_string(visitor, c),
                Expression::FormattedString(f) => walk_formatted_string(visitor, f),
                Expression::TemplatedString(t) => walk_templated_string(visitor, t),
                Expression::NamedExpr(n) => walk_named_expr(visitor, n),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_expression(node);
    VisitResult::Continue
}

/// Walk a [`Name`] node (leaf node).
pub fn walk_name<'a, V: Visitor<'a>>(visitor: &mut V, node: &Name<'a>) -> VisitResult {
    let result = visitor.visit_name(node);
    if result == VisitResult::Stop {
        return VisitResult::Stop;
    }
    visitor.leave_name(node);
    VisitResult::Continue
}

/// Walk an [`Ellipsis`] node (leaf node).
pub fn walk_ellipsis<'a, V: Visitor<'a>>(visitor: &mut V, node: &Ellipsis<'a>) -> VisitResult {
    let result = visitor.visit_ellipsis(node);
    if result == VisitResult::Stop {
        return VisitResult::Stop;
    }
    visitor.leave_ellipsis(node);
    VisitResult::Continue
}

/// Walk an [`Integer`] node (leaf node).
pub fn walk_integer<'a, V: Visitor<'a>>(visitor: &mut V, node: &Integer<'a>) -> VisitResult {
    let result = visitor.visit_integer(node);
    if result == VisitResult::Stop {
        return VisitResult::Stop;
    }
    visitor.leave_integer(node);
    VisitResult::Continue
}

/// Walk a [`Float`] node (leaf node).
pub fn walk_float<'a, V: Visitor<'a>>(visitor: &mut V, node: &Float<'a>) -> VisitResult {
    let result = visitor.visit_float_literal(node);
    if result == VisitResult::Stop {
        return VisitResult::Stop;
    }
    visitor.leave_float_literal(node);
    VisitResult::Continue
}

/// Walk an [`Imaginary`] node (leaf node).
pub fn walk_imaginary<'a, V: Visitor<'a>>(visitor: &mut V, node: &Imaginary<'a>) -> VisitResult {
    let result = visitor.visit_imaginary(node);
    if result == VisitResult::Stop {
        return VisitResult::Stop;
    }
    visitor.leave_imaginary(node);
    VisitResult::Continue
}

/// Walk a [`Comparison`] node.
pub fn walk_comparison<'a, V: Visitor<'a>>(visitor: &mut V, node: &Comparison<'a>) -> VisitResult {
    let result = visitor.visit_comparison(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.left) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            for target in &node.comparisons {
                if walk_comparison_target(visitor, target) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_comparison(node);
    VisitResult::Continue
}

/// Walk a [`ComparisonTarget`] node.
pub fn walk_comparison_target<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &ComparisonTarget<'a>,
) -> VisitResult {
    let result = visitor.visit_comparison_target(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.comparator) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_comparison_target(node);
    VisitResult::Continue
}

/// Walk a [`UnaryOperation`] node.
pub fn walk_unary_operation<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &UnaryOperation<'a>,
) -> VisitResult {
    let result = visitor.visit_unary_operation(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.expression) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_unary_operation(node);
    VisitResult::Continue
}

/// Walk a [`BinaryOperation`] node.
pub fn walk_binary_operation<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &BinaryOperation<'a>,
) -> VisitResult {
    let result = visitor.visit_binary_operation(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.left) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_expression(visitor, &node.right) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_binary_operation(node);
    VisitResult::Continue
}

/// Walk a [`BooleanOperation`] node.
pub fn walk_boolean_operation<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &BooleanOperation<'a>,
) -> VisitResult {
    let result = visitor.visit_boolean_operation(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.left) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_expression(visitor, &node.right) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_boolean_operation(node);
    VisitResult::Continue
}

/// Walk an [`Attribute`] node.
pub fn walk_attribute<'a, V: Visitor<'a>>(visitor: &mut V, node: &Attribute<'a>) -> VisitResult {
    let result = visitor.visit_attribute(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.value) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_name(visitor, &node.attr) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_attribute(node);
    VisitResult::Continue
}

/// Walk a [`NameOrAttribute`] node.
pub fn walk_name_or_attribute<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &NameOrAttribute<'a>,
) -> VisitResult {
    let result = visitor.visit_name_or_attribute(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                NameOrAttribute::N(n) => walk_name(visitor, n),
                NameOrAttribute::A(a) => walk_attribute(visitor, a),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_name_or_attribute(node);
    VisitResult::Continue
}

/// Walk a [`Tuple`] node.
pub fn walk_tuple<'a, V: Visitor<'a>>(visitor: &mut V, node: &Tuple<'a>) -> VisitResult {
    let result = visitor.visit_tuple(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for elem in &node.elements {
                if walk_element(visitor, elem) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_tuple(node);
    VisitResult::Continue
}

/// Walk a [`List`] node.
pub fn walk_list<'a, V: Visitor<'a>>(visitor: &mut V, node: &List<'a>) -> VisitResult {
    let result = visitor.visit_list(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for elem in &node.elements {
                if walk_element(visitor, elem) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_list(node);
    VisitResult::Continue
}

/// Walk a [`Set`] node.
pub fn walk_set<'a, V: Visitor<'a>>(visitor: &mut V, node: &Set<'a>) -> VisitResult {
    let result = visitor.visit_set(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for elem in &node.elements {
                if walk_element(visitor, elem) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_set(node);
    VisitResult::Continue
}

/// Walk an [`Element`] node.
pub fn walk_element<'a, V: Visitor<'a>>(visitor: &mut V, node: &Element<'a>) -> VisitResult {
    let result = visitor.visit_element(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                Element::Simple { value, .. } => walk_expression(visitor, value),
                Element::Starred(s) => walk_starred_element(visitor, s),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_element(node);
    VisitResult::Continue
}

/// Walk a [`StarredElement`] node.
pub fn walk_starred_element<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &StarredElement<'a>,
) -> VisitResult {
    let result = visitor.visit_starred_element(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.value) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_starred_element(node);
    VisitResult::Continue
}

/// Walk a [`Dict`] node.
pub fn walk_dict<'a, V: Visitor<'a>>(visitor: &mut V, node: &Dict<'a>) -> VisitResult {
    let result = visitor.visit_dict(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for elem in &node.elements {
                if walk_dict_element(visitor, elem) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_dict(node);
    VisitResult::Continue
}

/// Walk a [`DictElement`] node.
pub fn walk_dict_element<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &DictElement<'a>,
) -> VisitResult {
    let result = visitor.visit_dict_element(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                DictElement::Simple { key, value, .. } => {
                    if walk_expression(visitor, key) == VisitResult::Stop {
                        return VisitResult::Stop;
                    }
                    walk_expression(visitor, value)
                }
                DictElement::Starred(s) => walk_starred_dict_element(visitor, s),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_dict_element(node);
    VisitResult::Continue
}

/// Walk a [`StarredDictElement`] node.
pub fn walk_starred_dict_element<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &StarredDictElement<'a>,
) -> VisitResult {
    let result = visitor.visit_starred_dict_element(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.value) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_starred_dict_element(node);
    VisitResult::Continue
}

/// Walk a [`Call`] node.
pub fn walk_call<'a, V: Visitor<'a>>(visitor: &mut V, node: &Call<'a>) -> VisitResult {
    let result = visitor.visit_call(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.func) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            for arg in &node.args {
                if walk_arg(visitor, arg) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_call(node);
    VisitResult::Continue
}

/// Walk an [`Arg`] node.
pub fn walk_arg<'a, V: Visitor<'a>>(visitor: &mut V, node: &Arg<'a>) -> VisitResult {
    let result = visitor.visit_arg(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if let Some(kw) = &node.keyword {
                if walk_name(visitor, kw) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            if walk_expression(visitor, &node.value) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_arg(node);
    VisitResult::Continue
}

/// Walk a [`Subscript`] node.
pub fn walk_subscript<'a, V: Visitor<'a>>(visitor: &mut V, node: &Subscript<'a>) -> VisitResult {
    let result = visitor.visit_subscript(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.value) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            for elem in &node.slice {
                if walk_subscript_element(visitor, elem) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_subscript(node);
    VisitResult::Continue
}

/// Walk a [`SubscriptElement`] node.
pub fn walk_subscript_element<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &SubscriptElement<'a>,
) -> VisitResult {
    let result = visitor.visit_subscript_element(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_base_slice(visitor, &node.slice) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_subscript_element(node);
    VisitResult::Continue
}

/// Walk a [`BaseSlice`] node.
pub fn walk_base_slice<'a, V: Visitor<'a>>(visitor: &mut V, node: &BaseSlice<'a>) -> VisitResult {
    let result = visitor.visit_base_slice(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                BaseSlice::Index(i) => walk_index(visitor, i),
                BaseSlice::Slice(s) => walk_slice(visitor, s),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_base_slice(node);
    VisitResult::Continue
}

/// Walk an [`Index`] node.
pub fn walk_index<'a, V: Visitor<'a>>(visitor: &mut V, node: &Index<'a>) -> VisitResult {
    let result = visitor.visit_index(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.value) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_index(node);
    VisitResult::Continue
}

/// Walk a [`Slice`] node.
pub fn walk_slice<'a, V: Visitor<'a>>(visitor: &mut V, node: &Slice<'a>) -> VisitResult {
    let result = visitor.visit_slice(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if let Some(lower) = &node.lower {
                if walk_expression(visitor, lower) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            if let Some(upper) = &node.upper {
                if walk_expression(visitor, upper) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            if let Some(step) = &node.step {
                if walk_expression(visitor, step) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_slice(node);
    VisitResult::Continue
}

/// Walk an [`IfExp`] node.
pub fn walk_if_exp<'a, V: Visitor<'a>>(visitor: &mut V, node: &IfExp<'a>) -> VisitResult {
    let result = visitor.visit_if_exp(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.body) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_expression(visitor, &node.test) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_expression(visitor, &node.orelse) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_if_exp(node);
    VisitResult::Continue
}

/// Walk a [`Lambda`] node.
pub fn walk_lambda<'a, V: Visitor<'a>>(visitor: &mut V, node: &Lambda<'a>) -> VisitResult {
    let result = visitor.visit_lambda(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_parameters(visitor, &node.params) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_expression(visitor, &node.body) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_lambda(node);
    VisitResult::Continue
}

/// Walk a [`NamedExpr`] node (walrus operator `:=`).
pub fn walk_named_expr<'a, V: Visitor<'a>>(visitor: &mut V, node: &NamedExpr<'a>) -> VisitResult {
    let result = visitor.visit_named_expr(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // target is Box<Expression> (typically a Name)
            if walk_expression(visitor, &node.target) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_expression(visitor, &node.value) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_named_expr(node);
    VisitResult::Continue
}

// ============================================================================
// Comprehension walks
// ============================================================================

/// Walk a [`GeneratorExp`] node.
pub fn walk_generator_exp<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &GeneratorExp<'a>,
) -> VisitResult {
    let result = visitor.visit_generator_exp(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.elt) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_comp_for(visitor, &node.for_in) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_generator_exp(node);
    VisitResult::Continue
}

/// Walk a [`ListComp`] node.
pub fn walk_list_comp<'a, V: Visitor<'a>>(visitor: &mut V, node: &ListComp<'a>) -> VisitResult {
    let result = visitor.visit_list_comp(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.elt) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_comp_for(visitor, &node.for_in) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_list_comp(node);
    VisitResult::Continue
}

/// Walk a [`SetComp`] node.
pub fn walk_set_comp<'a, V: Visitor<'a>>(visitor: &mut V, node: &SetComp<'a>) -> VisitResult {
    let result = visitor.visit_set_comp(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.elt) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_comp_for(visitor, &node.for_in) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_set_comp(node);
    VisitResult::Continue
}

/// Walk a [`DictComp`] node.
pub fn walk_dict_comp<'a, V: Visitor<'a>>(visitor: &mut V, node: &DictComp<'a>) -> VisitResult {
    let result = visitor.visit_dict_comp(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.key) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_expression(visitor, &node.value) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_comp_for(visitor, &node.for_in) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_dict_comp(node);
    VisitResult::Continue
}

/// Walk a [`CompFor`] node.
pub fn walk_comp_for<'a, V: Visitor<'a>>(visitor: &mut V, node: &CompFor<'a>) -> VisitResult {
    let result = visitor.visit_comp_for(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_assign_target_expression(visitor, &node.target) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if walk_expression(visitor, &node.iter) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            for if_clause in &node.ifs {
                if walk_comp_if(visitor, if_clause) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            if let Some(inner) = &node.inner_for_in {
                if walk_comp_for(visitor, inner) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_comp_for(node);
    VisitResult::Continue
}

/// Walk a [`CompIf`] node.
pub fn walk_comp_if<'a, V: Visitor<'a>>(visitor: &mut V, node: &CompIf<'a>) -> VisitResult {
    let result = visitor.visit_comp_if(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.test) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_comp_if(node);
    VisitResult::Continue
}

// ============================================================================
// Async expression walks
// ============================================================================

/// Walk a [`Yield`] node.
pub fn walk_yield<'a, V: Visitor<'a>>(visitor: &mut V, node: &Yield<'a>) -> VisitResult {
    let result = visitor.visit_yield_expr(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if let Some(value) = &node.value {
                if walk_yield_value(visitor, value) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_yield_expr(node);
    VisitResult::Continue
}

/// Walk a [`YieldValue`] node.
pub fn walk_yield_value<'a, V: Visitor<'a>>(visitor: &mut V, node: &YieldValue<'a>) -> VisitResult {
    let result = visitor.visit_yield_value(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                YieldValue::Expression(e) => walk_expression(visitor, e),
                YieldValue::From(f) => walk_yield_from(visitor, f),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_yield_value(node);
    VisitResult::Continue
}

/// Walk a [`YieldFrom`] (From) node.
pub fn walk_yield_from<'a, V: Visitor<'a>>(visitor: &mut V, node: &YieldFrom<'a>) -> VisitResult {
    let result = visitor.visit_yield_from(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.item) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_yield_from(node);
    VisitResult::Continue
}

/// Walk an [`Await`] node.
pub fn walk_await<'a, V: Visitor<'a>>(visitor: &mut V, node: &Await<'a>) -> VisitResult {
    let result = visitor.visit_await_expr(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.expression) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_await_expr(node);
    VisitResult::Continue
}

// ============================================================================
// String expression walks
// ============================================================================

/// Walk a [`SimpleString`] node (leaf node).
pub fn walk_simple_string<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &SimpleString<'a>,
) -> VisitResult {
    let result = visitor.visit_simple_string(node);
    if result == VisitResult::Stop {
        return VisitResult::Stop;
    }
    visitor.leave_simple_string(node);
    VisitResult::Continue
}

/// Walk a [`ConcatenatedString`] node.
pub fn walk_concatenated_string<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &ConcatenatedString<'a>,
) -> VisitResult {
    let result = visitor.visit_concatenated_string(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // ConcatenatedString has parts that are strings
            // The left and right are the string parts
            // For simplicity, we don't recursively walk the parts here
            // as they would just be SimpleString or FormattedString
        }
    }
    visitor.leave_concatenated_string(node);
    VisitResult::Continue
}

/// Walk a [`FormattedString`] node.
pub fn walk_formatted_string<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &FormattedString<'a>,
) -> VisitResult {
    let result = visitor.visit_formatted_string(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for part in &node.parts {
                if walk_formatted_string_content(visitor, part) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_formatted_string(node);
    VisitResult::Continue
}

/// Walk a [`FormattedStringContent`] node.
pub fn walk_formatted_string_content<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &FormattedStringContent<'a>,
) -> VisitResult {
    let result = visitor.visit_formatted_string_content(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                FormattedStringContent::Text(t) => walk_formatted_string_text(visitor, t),
                FormattedStringContent::Expression(e) => {
                    walk_formatted_string_expression(visitor, e)
                }
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_formatted_string_content(node);
    VisitResult::Continue
}

/// Walk a [`FormattedStringText`] node (leaf node).
pub fn walk_formatted_string_text<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &FormattedStringText<'a>,
) -> VisitResult {
    let result = visitor.visit_formatted_string_text(node);
    if result == VisitResult::Stop {
        return VisitResult::Stop;
    }
    visitor.leave_formatted_string_text(node);
    VisitResult::Continue
}

/// Walk a [`FormattedStringExpression`] node.
pub fn walk_formatted_string_expression<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &FormattedStringExpression<'a>,
) -> VisitResult {
    let result = visitor.visit_formatted_string_expression(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.expression) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_formatted_string_expression(node);
    VisitResult::Continue
}

/// Walk a [`TemplatedString`] node.
pub fn walk_templated_string<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &TemplatedString<'a>,
) -> VisitResult {
    let result = visitor.visit_templated_string(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            for part in &node.parts {
                if walk_templated_string_content(visitor, part) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_templated_string(node);
    VisitResult::Continue
}

/// Walk a [`TemplatedStringContent`] node.
pub fn walk_templated_string_content<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &TemplatedStringContent<'a>,
) -> VisitResult {
    let result = visitor.visit_templated_string_content(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                TemplatedStringContent::Text(t) => walk_templated_string_text(visitor, t),
                TemplatedStringContent::Expression(e) => {
                    walk_templated_string_expression(visitor, e)
                }
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_templated_string_content(node);
    VisitResult::Continue
}

/// Walk a [`TemplatedStringExpression`] node.
pub fn walk_templated_string_expression<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &TemplatedStringExpression<'a>,
) -> VisitResult {
    let result = visitor.visit_templated_string_expression(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.expression) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_templated_string_expression(node);
    VisitResult::Continue
}

/// Walk a [`TemplatedStringText`] node.
///
/// This is a leaf node containing just the text portion of a templated string.
pub fn walk_templated_string_text<'a, V: Visitor<'a>>(
    visitor: &mut V,
    node: &TemplatedStringText<'a>,
) -> VisitResult {
    let result = visitor.visit_templated_string_text(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren | VisitResult::Continue => {}
    }
    visitor.leave_templated_string_text(node);
    VisitResult::Continue
}

// ============================================================================
// Function-related walks
// ============================================================================

/// Walk a [`Parameters`] node.
pub fn walk_parameters<'a, V: Visitor<'a>>(visitor: &mut V, node: &Parameters<'a>) -> VisitResult {
    let result = visitor.visit_parameters(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            // Walk positional-only params
            for param in &node.posonly_params {
                if walk_param(visitor, param) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk positional-only indicator
            if let Some(ind) = &node.posonly_ind {
                if walk_param_slash(visitor, ind) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk regular params
            for param in &node.params {
                if walk_param(visitor, param) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk star arg
            if let Some(star_arg) = &node.star_arg {
                if walk_star_arg(visitor, star_arg) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk keyword-only params
            for param in &node.kwonly_params {
                if walk_param(visitor, param) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            // Walk star kwarg
            if let Some(star_kwarg) = &node.star_kwarg {
                if walk_param(visitor, star_kwarg) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_parameters(node);
    VisitResult::Continue
}

/// Walk a [`Param`] node.
pub fn walk_param<'a, V: Visitor<'a>>(visitor: &mut V, node: &Param<'a>) -> VisitResult {
    let result = visitor.visit_param(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_name(visitor, &node.name) == VisitResult::Stop {
                return VisitResult::Stop;
            }
            if let Some(ann) = &node.annotation {
                if walk_annotation(visitor, ann) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
            if let Some(default) = &node.default {
                if walk_expression(visitor, default) == VisitResult::Stop {
                    return VisitResult::Stop;
                }
            }
        }
    }
    visitor.leave_param(node);
    VisitResult::Continue
}

/// Walk a [`ParamStar`] node.
pub fn walk_param_star<'a, V: Visitor<'a>>(visitor: &mut V, node: &ParamStar<'a>) -> VisitResult {
    let result = visitor.visit_param_star(node);
    if result == VisitResult::Stop {
        return VisitResult::Stop;
    }
    visitor.leave_param_star(node);
    VisitResult::Continue
}

/// Walk a [`ParamSlash`] node.
pub fn walk_param_slash<'a, V: Visitor<'a>>(visitor: &mut V, node: &ParamSlash<'a>) -> VisitResult {
    let result = visitor.visit_param_slash(node);
    if result == VisitResult::Stop {
        return VisitResult::Stop;
    }
    visitor.leave_param_slash(node);
    VisitResult::Continue
}

/// Walk a [`StarArg`] node.
pub fn walk_star_arg<'a, V: Visitor<'a>>(visitor: &mut V, node: &StarArg<'a>) -> VisitResult {
    let result = visitor.visit_star_arg(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            let inner_result = match node {
                StarArg::Star(s) => walk_param_star(visitor, s),
                StarArg::Param(p) => walk_param(visitor, p),
            };
            if inner_result == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_star_arg(node);
    VisitResult::Continue
}

/// Walk an [`Annotation`] node.
pub fn walk_annotation<'a, V: Visitor<'a>>(visitor: &mut V, node: &Annotation<'a>) -> VisitResult {
    let result = visitor.visit_annotation(node);
    match result {
        VisitResult::Stop => return VisitResult::Stop,
        VisitResult::SkipChildren => {}
        VisitResult::Continue => {
            if walk_expression(visitor, &node.annotation) == VisitResult::Stop {
                return VisitResult::Stop;
            }
        }
    }
    visitor.leave_annotation(node);
    VisitResult::Continue
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module;

    /// A visitor that counts specific node types.
    struct NodeCounter {
        names: usize,
        functions: usize,
        classes: usize,
        calls: usize,
    }

    impl NodeCounter {
        fn new() -> Self {
            Self {
                names: 0,
                functions: 0,
                classes: 0,
                calls: 0,
            }
        }
    }

    impl<'a> Visitor<'a> for NodeCounter {
        fn visit_name(&mut self, _node: &Name<'a>) -> VisitResult {
            self.names += 1;
            VisitResult::Continue
        }

        fn visit_function_def(&mut self, _node: &FunctionDef<'a>) -> VisitResult {
            self.functions += 1;
            VisitResult::Continue
        }

        fn visit_class_def(&mut self, _node: &ClassDef<'a>) -> VisitResult {
            self.classes += 1;
            VisitResult::Continue
        }

        fn visit_call(&mut self, _node: &Call<'a>) -> VisitResult {
            self.calls += 1;
            VisitResult::Continue
        }
    }

    #[test]
    fn test_walk_simple_assignment() {
        let source = "x = 1";
        let module = parse_module(source, None).expect("parse error");
        let mut counter = NodeCounter::new();
        walk_module(&mut counter, &module);
        assert_eq!(counter.names, 1); // x
    }

    #[test]
    fn test_walk_function_def() {
        let source = "def foo(x, y):\n    return x + y";
        let module = parse_module(source, None).expect("parse error");
        let mut counter = NodeCounter::new();
        walk_module(&mut counter, &module);
        assert_eq!(counter.functions, 1);
        assert_eq!(counter.names, 5); // foo, x, y, x, y
    }

    #[test]
    fn test_walk_class_def() {
        let source = "class MyClass:\n    def method(self):\n        pass";
        let module = parse_module(source, None).expect("parse error");
        let mut counter = NodeCounter::new();
        walk_module(&mut counter, &module);
        assert_eq!(counter.classes, 1);
        assert_eq!(counter.functions, 1);
        assert_eq!(counter.names, 3); // MyClass, method, self
    }

    #[test]
    fn test_walk_call() {
        let source = "print(foo(x))";
        let module = parse_module(source, None).expect("parse error");
        let mut counter = NodeCounter::new();
        walk_module(&mut counter, &module);
        assert_eq!(counter.calls, 2); // print(...), foo(...)
        assert_eq!(counter.names, 3); // print, foo, x
    }

    #[test]
    fn test_walk_skip_children() {
        struct SkipFunctions;

        impl<'a> Visitor<'a> for SkipFunctions {
            fn visit_function_def(&mut self, _node: &FunctionDef<'a>) -> VisitResult {
                VisitResult::SkipChildren
            }
        }

        let source = "def foo():\n    x = 1";
        let module = parse_module(source, None).expect("parse error");
        let mut visitor = SkipFunctions;
        let result = walk_module(&mut visitor, &module);
        assert_eq!(result, VisitResult::Continue);
    }

    #[test]
    fn test_walk_stop() {
        struct StopAtName;

        impl<'a> Visitor<'a> for StopAtName {
            fn visit_name(&mut self, _node: &Name<'a>) -> VisitResult {
                VisitResult::Stop
            }
        }

        let source = "x = y";
        let module = parse_module(source, None).expect("parse error");
        let mut visitor = StopAtName;
        let result = walk_module(&mut visitor, &module);
        assert_eq!(result, VisitResult::Stop);
    }

    #[test]
    fn test_walk_visit_leave_order() {
        struct OrderTracker {
            events: Vec<String>,
        }

        impl<'a> Visitor<'a> for OrderTracker {
            fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
                self.events.push(format!("visit:{}", node.name.value));
                VisitResult::Continue
            }

            fn leave_function_def(&mut self, node: &FunctionDef<'a>) {
                self.events.push(format!("leave:{}", node.name.value));
            }

            fn visit_name(&mut self, node: &Name<'a>) -> VisitResult {
                self.events.push(format!("visit_name:{}", node.value));
                VisitResult::Continue
            }

            fn leave_name(&mut self, node: &Name<'a>) {
                self.events.push(format!("leave_name:{}", node.value));
            }
        }

        let source = "def foo():\n    pass";
        let module = parse_module(source, None).expect("parse error");
        let mut tracker = OrderTracker { events: vec![] };
        walk_module(&mut tracker, &module);

        // Verify pre-order and post-order
        assert!(tracker.events.contains(&"visit:foo".to_string()));
        assert!(tracker.events.contains(&"leave:foo".to_string()));

        // visit should come before leave
        let visit_idx = tracker
            .events
            .iter()
            .position(|e| e == "visit:foo")
            .unwrap();
        let leave_idx = tracker
            .events
            .iter()
            .position(|e| e == "leave:foo")
            .unwrap();
        assert!(visit_idx < leave_idx);
    }

    #[test]
    fn test_walk_comprehension() {
        let source = "[x for x in range(10) if x > 5]";
        let module = parse_module(source, None).expect("parse error");
        let mut counter = NodeCounter::new();
        walk_module(&mut counter, &module);
        // x (output), x (target), range, 10 (Integer not counted), x, 5 (Integer not counted)
        // Names: x, x, range, x = 4 names
        assert_eq!(counter.names, 4);
        assert_eq!(counter.calls, 1); // range(...)
    }

    #[test]
    fn test_walk_import() {
        let source = "from os.path import join as pjoin";
        let module = parse_module(source, None).expect("parse error");
        let mut counter = NodeCounter::new();
        walk_module(&mut counter, &module);
        // os, path, join, pjoin
        assert!(counter.names >= 3);
    }
}
