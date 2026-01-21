// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Visitor and transformer infrastructure for CST traversal.
//!
//! This module provides traits and utilities for traversing and transforming
//! Python Concrete Syntax Trees (CSTs). The design follows a hybrid approach:
//! macro-generated trait method signatures with manual walk implementations
//! for complex nodes.
//!
//! # Traversal Order
//!
//! - **Depth-first, pre-order** for `visit_*` methods
//! - **Post-order** for `leave_*` methods
//! - Children are visited in source order (left-to-right, top-to-bottom)
//!
//! # Visitor Pattern
//!
//! The [`Visitor`] trait provides read-only traversal:
//!
//! ```ignore
//! use tugtool_python_cst::visitor::{Visitor, VisitResult};
//!
//! struct NameCounter {
//!     count: usize,
//! }
//!
//! impl<'a> Visitor<'a> for NameCounter {
//!     fn visit_name(&mut self, _node: &Name<'a>) -> VisitResult {
//!         self.count += 1;
//!         VisitResult::Continue
//!     }
//! }
//! ```
//!
//! # Transformer Pattern
//!
//! The [`Transformer`] trait provides mutable transformation:
//!
//! ```ignore
//! use tugtool_python_cst::visitor::{Transformer, Transform};
//!
//! struct Renamer {
//!     old_name: String,
//!     new_name: String,
//! }
//!
//! impl<'a> Transformer<'a> for Renamer {
//!     fn transform_name(&mut self, node: Name<'a>) -> Name<'a> {
//!         if node.value == self.old_name {
//!             // Create new Name with new_name
//!         }
//!         node
//!     }
//! }
//! ```

// P0 visitors (core functionality)
mod binding;
mod dispatch;
mod exports;
mod reference;
mod rename;
mod scope;
mod span_collector;
mod traits;

// P1 visitors (extended analysis)
mod annotation;
mod import;
mod inheritance;
mod method_call;
mod type_inference;

// P2 visitors (dynamic pattern detection)
mod dynamic;

// P0 exports
pub use binding::{BindingCollector, BindingInfo, BindingKind};
pub use dispatch::*;
pub use exports::{ExportCollector, ExportInfo, ExportKind};
pub use reference::{ReferenceCollector, ReferenceInfo, ReferenceKind};
pub use rename::{
    sort_requests_by_start, sort_requests_by_start_reverse, spans_overlap, RenameError,
    RenameRequest, RenameResult, RenameTransformer,
};
pub use scope::{ScopeCollector, ScopeInfo, ScopeKind};
pub use span_collector::SpanCollector;
pub use traits::{Transform, Transformer, VisitResult, Visitor};

// P1 exports
pub use annotation::{AnnotationCollector, AnnotationInfo, AnnotationKind, AnnotationSourceKind};
pub use import::{ImportCollector, ImportInfo, ImportKind, ImportedName};
pub use inheritance::{ClassInheritanceInfo, InheritanceCollector};
pub use method_call::{MethodCallCollector, MethodCallInfo};
pub use type_inference::{AssignmentInfo, TypeInferenceCollector, TypeSource};

// P2 exports
pub use dynamic::{DynamicPatternDetector, DynamicPatternInfo, DynamicPatternKind};
