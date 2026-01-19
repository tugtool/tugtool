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
//! use tugtool_cst::visitor::{Visitor, VisitResult};
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
//! use tugtool_cst::visitor::{Transformer, Transform};
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

mod dispatch;
mod span_collector;
mod traits;

pub use dispatch::*;
pub use span_collector::SpanCollector;
pub use traits::{Transform, Transformer, VisitResult, Visitor};
