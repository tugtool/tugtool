// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Infrastructure layers for Python refactoring operations.
//!
//! This module provides the building blocks for complex refactoring operations
//! that require coordinated changes across multiple files.
//!
//! # Layers
//!
//! - **Layer 1 (Expression):** Expression analysis for Extract Variable/Constant
//! - **Layer 3 (Imports):** Import manipulation for Move operations

pub mod expression;
pub mod imports;
pub mod stdlib_modules;

// Layer 1: Expression analysis
pub use expression::{
    find_comprehension_scopes, find_expression_at, generate_unique_name, is_in_comprehension,
    is_in_generator, is_literal_at, is_python_builtin, AssignmentDetail, AssignmentKind,
    ComprehensionKind, ComprehensionScope, ExpressionBoundary, ExpressionBoundaryDetector,
    ExpressionContext, LiteralKind, SingleAssignmentChecker, SingleAssignmentResult,
    UniqueNameGenerator,
};

// Layer 3: Import manipulation
pub use imports::{
    ImportAnalysis, ImportClassifier, ImportClassifierConfig, ImportGroupKind, ImportInfo,
    ImportInsertMode, ImportInserter, ImportManipulationError, ImportManipulationResult,
    ImportRemover, ImportStatement, ImportUpdater, ImportedName, ImportedNameSpan, TextEdit,
};
pub use stdlib_modules::{is_stdlib_module, PythonVersion};
