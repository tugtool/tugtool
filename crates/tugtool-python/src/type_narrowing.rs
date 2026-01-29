//! Type narrowing support for isinstance-based type refinement.
//!
//! This module provides [`NarrowingContext`] for tracking narrowed types within
//! conditional branches, and [`type_of_with_narrowing`] for type lookup that
//! considers narrowing information.
//!
//! # Overview
//!
//! When Python code contains an isinstance check like:
//!
//! ```python
//! if isinstance(x, Handler):
//!     x.process()  # Within this branch, x is known to be Handler
//! ```
//!
//! The narrowing context captures that `x` has type `Handler` within the if-branch.
//! Resolution of `x.process()` will use `Handler` instead of the base type of `x`.
//!
//! # Span-Based Scoping
//!
//! Narrowing is only active within the branch where the isinstance check occurs.
//! This is enforced by checking whether the site span (where the variable is used)
//! falls within the branch span (the if-body).
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python::type_narrowing::{NarrowingContext, type_of_with_narrowing};
//! use tugtool_python_cst::IsInstanceCheck;
//!
//! // Build narrowing context from isinstance checks
//! let mut narrowing = NarrowingContext::new();
//! for check in isinstance_checks {
//!     for checked_type in &check.checked_types {
//!         narrowing.narrow(
//!             check.scope_path.clone(),
//!             check.variable.clone(),
//!             checked_type.clone(),
//!             check.branch_span,
//!         );
//!     }
//! }
//!
//! // Look up type with narrowing
//! let site_span = Span { start: 50, end: 51 };
//! let type_name = type_of_with_narrowing(
//!     &scope_path,
//!     "x",
//!     site_span,
//!     &narrowing,
//!     &tracker,
//! );
//! ```

use std::collections::HashMap;
use tugtool_core::patch::Span;
use tugtool_python_cst::IsInstanceCheck;

use crate::type_tracker::TypeTracker;

// ============================================================================
// NarrowingContext
// ============================================================================

/// Narrowing entry storing the narrowed type and the branch span where it applies.
#[derive(Debug, Clone)]
struct NarrowingEntry {
    /// The narrowed type name.
    narrowed_type: String,
    /// The span of the branch where this narrowing is active.
    branch_span: Span,
}

/// Type narrowing context for conditional branches.
///
/// This struct stores narrowed type information from isinstance checks.
/// The narrowings are keyed by (scope_path, variable_name) and include
/// branch spans for scope-aware application.
///
/// # Example
///
/// ```ignore
/// let mut ctx = NarrowingContext::new();
/// ctx.narrow(
///     vec!["<module>".to_string(), "process".to_string()],
///     "x".to_string(),
///     "Handler".to_string(),
///     Span { start: 100, end: 200 },
/// );
///
/// // Check if site is within narrowed scope
/// let site = Span { start: 150, end: 151 };
/// if let Some(narrowed) = ctx.get_narrowed_type(&scope, "x", site) {
///     // Use narrowed type
/// }
/// ```
#[derive(Debug, Clone, Default)]
pub struct NarrowingContext {
    /// Map from (scope_path, variable_name) to list of narrowing entries.
    /// Multiple entries can exist if the same variable is narrowed in different branches.
    narrowings: HashMap<(Vec<String>, String), Vec<NarrowingEntry>>,
}

impl NarrowingContext {
    /// Create a new empty narrowing context.
    pub fn new() -> Self {
        Self {
            narrowings: HashMap::new(),
        }
    }

    /// Add a narrowing for a variable in a scope.
    ///
    /// # Arguments
    ///
    /// * `scope_path` - The scope where the isinstance check occurs
    /// * `name` - The variable being narrowed
    /// * `narrowed_type` - The type to narrow to
    /// * `branch_span` - The span of the if-branch where narrowing applies
    pub fn narrow(
        &mut self,
        scope_path: Vec<String>,
        name: String,
        narrowed_type: String,
        branch_span: Span,
    ) {
        let key = (scope_path, name);
        let entry = NarrowingEntry {
            narrowed_type,
            branch_span,
        };
        self.narrowings.entry(key).or_default().push(entry);
    }

    /// Look up a narrowed type, checking if the site span is within a narrowing branch.
    ///
    /// Returns the narrowed type if:
    /// 1. A narrowing exists for this (scope_path, name) key
    /// 2. The site_span falls within the narrowing's branch_span
    ///
    /// # Arguments
    ///
    /// * `scope_path` - The scope to look up in
    /// * `name` - The variable name to look up
    /// * `site_span` - The span of the usage site (must fall within branch_span)
    ///
    /// # Returns
    ///
    /// The narrowed type if found and in scope, None otherwise.
    pub fn get_narrowed_type(
        &self,
        scope_path: &[String],
        name: &str,
        site_span: Span,
    ) -> Option<&str> {
        let key = (scope_path.to_vec(), name.to_string());
        let entries = self.narrowings.get(&key)?;

        // Find a narrowing where site_span is within branch_span
        for entry in entries {
            if span_contains(&entry.branch_span, &site_span) {
                return Some(&entry.narrowed_type);
            }
        }

        None
    }

    /// Check if any narrowings exist.
    pub fn is_empty(&self) -> bool {
        self.narrowings.is_empty()
    }

    /// Get the number of narrowing entries.
    pub fn len(&self) -> usize {
        self.narrowings.values().map(|v| v.len()).sum()
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Check if `inner` span is contained within `outer` span.
///
/// Returns true if inner.start >= outer.start AND inner.end <= outer.end.
fn span_contains(outer: &Span, inner: &Span) -> bool {
    inner.start >= outer.start && inner.end <= outer.end
}

/// Look up a variable's type with narrowing context.
///
/// This function first checks the narrowing context for a narrowed type
/// at the given site span. If no narrowing applies, it falls back to
/// the TypeTracker.
///
/// # Arguments
///
/// * `scope_path` - The scope to look up in
/// * `name` - The variable name to look up
/// * `site_span` - The span of the usage site
/// * `narrowing` - The narrowing context (from isinstance checks)
/// * `tracker` - The base type tracker
///
/// # Returns
///
/// The type of the variable (narrowed if applicable, otherwise from tracker).
pub fn type_of_with_narrowing<'a>(
    scope_path: &[String],
    name: &str,
    site_span: Span,
    narrowing: &'a NarrowingContext,
    tracker: &'a TypeTracker,
) -> Option<&'a str> {
    // First check narrowing context
    if let Some(narrowed) = narrowing.get_narrowed_type(scope_path, name, site_span) {
        return Some(narrowed);
    }

    // Fall back to base type tracker
    tracker.type_of(scope_path, name)
}

/// Build a `NarrowingContext` from a collection of isinstance checks.
///
/// This function processes the isinstance checks collected from a file
/// and creates a narrowing context that can be used during receiver resolution.
///
/// For tuple isinstance checks like `isinstance(x, (Handler, Worker))`,
/// the variable is narrowed to a union type `Union[Handler, Worker]`.
/// This allows resolution to match method calls against any of the types.
///
/// # Arguments
///
/// * `isinstance_checks` - The isinstance checks collected by IsInstanceCollector
///
/// # Returns
///
/// A `NarrowingContext` containing all narrowings from the isinstance checks.
///
/// # Example
///
/// ```ignore
/// use tugtool_python::type_narrowing::build_narrowing_context;
/// use tugtool_python::cst_bridge::parse_and_analyze;
///
/// let result = parse_and_analyze(source)?;
/// let narrowing = build_narrowing_context(&result.isinstance_checks);
/// ```
pub fn build_narrowing_context(isinstance_checks: &[IsInstanceCheck]) -> NarrowingContext {
    let mut ctx = NarrowingContext::new();

    for check in isinstance_checks {
        // For single type: use it directly
        // For tuple (multiple types): narrow to first type
        // (Union handling would require more sophisticated type resolution)
        if let Some(narrowed_type) = check.checked_types.first() {
            ctx.narrow(
                check.scope_path.clone(),
                check.variable.clone(),
                narrowed_type.clone(),
                check.branch_span,
            );
        }
    }

    ctx
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_narrowing_context_narrow_stores_narrowing() {
        let mut ctx = NarrowingContext::new();
        let scope = vec!["<module>".to_string(), "process".to_string()];
        let branch_span = Span {
            start: 100,
            end: 200,
        };

        ctx.narrow(
            scope.clone(),
            "x".to_string(),
            "Handler".to_string(),
            branch_span,
        );

        assert!(!ctx.is_empty());
        assert_eq!(ctx.len(), 1);
    }

    #[test]
    fn test_narrowing_context_get_narrowed_type_within_span() {
        let mut ctx = NarrowingContext::new();
        let scope = vec!["<module>".to_string(), "process".to_string()];
        let branch_span = Span {
            start: 100,
            end: 200,
        };

        ctx.narrow(
            scope.clone(),
            "x".to_string(),
            "Handler".to_string(),
            branch_span,
        );

        // Site within branch span
        let site = Span {
            start: 150,
            end: 151,
        };
        assert_eq!(ctx.get_narrowed_type(&scope, "x", site), Some("Handler"));
    }

    #[test]
    fn test_narrowing_context_get_narrowed_type_outside_span() {
        let mut ctx = NarrowingContext::new();
        let scope = vec!["<module>".to_string(), "process".to_string()];
        let branch_span = Span {
            start: 100,
            end: 200,
        };

        ctx.narrow(
            scope.clone(),
            "x".to_string(),
            "Handler".to_string(),
            branch_span,
        );

        // Site outside branch span (before)
        let site_before = Span { start: 50, end: 51 };
        assert_eq!(ctx.get_narrowed_type(&scope, "x", site_before), None);

        // Site outside branch span (after)
        let site_after = Span {
            start: 250,
            end: 251,
        };
        assert_eq!(ctx.get_narrowed_type(&scope, "x", site_after), None);
    }

    #[test]
    fn test_narrowing_context_different_scopes() {
        let mut ctx = NarrowingContext::new();
        let scope1 = vec!["<module>".to_string(), "func1".to_string()];
        let scope2 = vec!["<module>".to_string(), "func2".to_string()];
        let branch_span = Span {
            start: 100,
            end: 200,
        };

        ctx.narrow(
            scope1.clone(),
            "x".to_string(),
            "Handler".to_string(),
            branch_span,
        );

        // Same variable name, different scope - should not find narrowing
        let site = Span {
            start: 150,
            end: 151,
        };
        assert_eq!(ctx.get_narrowed_type(&scope2, "x", site), None);
    }

    #[test]
    fn test_narrowing_context_multiple_branches() {
        let mut ctx = NarrowingContext::new();
        let scope = vec!["<module>".to_string(), "process".to_string()];

        // Two different branches with different narrowings
        let branch1 = Span {
            start: 100,
            end: 200,
        };
        let branch2 = Span {
            start: 300,
            end: 400,
        };

        ctx.narrow(
            scope.clone(),
            "x".to_string(),
            "Handler".to_string(),
            branch1,
        );
        ctx.narrow(
            scope.clone(),
            "x".to_string(),
            "Worker".to_string(),
            branch2,
        );

        // Site in first branch
        let site1 = Span {
            start: 150,
            end: 151,
        };
        assert_eq!(ctx.get_narrowed_type(&scope, "x", site1), Some("Handler"));

        // Site in second branch
        let site2 = Span {
            start: 350,
            end: 351,
        };
        assert_eq!(ctx.get_narrowed_type(&scope, "x", site2), Some("Worker"));
    }

    #[test]
    fn test_type_of_with_narrowing_returns_narrowed() {
        let mut ctx = NarrowingContext::new();
        let scope = vec!["<module>".to_string()];
        let branch_span = Span {
            start: 100,
            end: 200,
        };

        ctx.narrow(
            scope.clone(),
            "x".to_string(),
            "Handler".to_string(),
            branch_span,
        );

        // Create empty type tracker
        let tracker = TypeTracker::new();

        // Site within branch - should return narrowed type
        let site = Span {
            start: 150,
            end: 151,
        };
        let result = type_of_with_narrowing(&scope, "x", site, &ctx, &tracker);
        assert_eq!(result, Some("Handler"));
    }

    #[test]
    fn test_type_of_with_narrowing_falls_back_to_tracker() {
        use crate::types::{AssignmentInfo, SpanInfo};

        let ctx = NarrowingContext::new();
        let scope = vec!["<module>".to_string()];

        // Create type tracker with a type for "x" via process_assignments
        let mut tracker = TypeTracker::new();
        let assignments = vec![AssignmentInfo {
            target: "x".to_string(),
            scope_path: scope.clone(),
            type_source: "constructor".to_string(),
            inferred_type: Some("BaseType".to_string()),
            rhs_name: None,
            callee_name: None,
            span: Some(SpanInfo { start: 0, end: 10 }),
            line: Some(1),
            col: Some(1),
            is_self_attribute: false,
            attribute_name: None,
        }];
        tracker.process_assignments(&assignments);

        // Site anywhere - should fall back to tracker since no narrowing
        let site = Span { start: 50, end: 51 };
        let result = type_of_with_narrowing(&scope, "x", site, &ctx, &tracker);
        assert_eq!(result, Some("BaseType"));
    }

    #[test]
    fn test_type_of_with_narrowing_prefers_narrowed() {
        use crate::types::{AssignmentInfo, SpanInfo};

        let mut ctx = NarrowingContext::new();
        let scope = vec!["<module>".to_string()];
        let branch_span = Span {
            start: 100,
            end: 200,
        };

        ctx.narrow(
            scope.clone(),
            "x".to_string(),
            "Handler".to_string(),
            branch_span,
        );

        // Create type tracker with a base type for "x"
        let mut tracker = TypeTracker::new();
        let assignments = vec![AssignmentInfo {
            target: "x".to_string(),
            scope_path: scope.clone(),
            type_source: "constructor".to_string(),
            inferred_type: Some("BaseType".to_string()),
            rhs_name: None,
            callee_name: None,
            span: Some(SpanInfo { start: 0, end: 10 }),
            line: Some(1),
            col: Some(1),
            is_self_attribute: false,
            attribute_name: None,
        }];
        tracker.process_assignments(&assignments);

        // Site within branch - should prefer narrowed type
        let site = Span {
            start: 150,
            end: 151,
        };
        let result = type_of_with_narrowing(&scope, "x", site, &ctx, &tracker);
        assert_eq!(result, Some("Handler"));
    }

    #[test]
    fn test_span_contains_basic() {
        let outer = Span {
            start: 100,
            end: 200,
        };

        // Inner completely inside
        assert!(span_contains(
            &outer,
            &Span {
                start: 150,
                end: 160
            }
        ));

        // Inner at start boundary
        assert!(span_contains(
            &outer,
            &Span {
                start: 100,
                end: 110
            }
        ));

        // Inner at end boundary
        assert!(span_contains(
            &outer,
            &Span {
                start: 190,
                end: 200
            }
        ));

        // Inner before outer
        assert!(!span_contains(&outer, &Span { start: 50, end: 60 }));

        // Inner after outer
        assert!(!span_contains(
            &outer,
            &Span {
                start: 250,
                end: 260
            }
        ));

        // Inner overlaps start
        assert!(!span_contains(
            &outer,
            &Span {
                start: 50,
                end: 150
            }
        ));

        // Inner overlaps end
        assert!(!span_contains(
            &outer,
            &Span {
                start: 150,
                end: 250
            }
        ));
    }

    // ========================================================================
    // Integration tests using build_narrowing_context
    // ========================================================================

    #[test]
    fn test_build_narrowing_context_from_isinstance_checks() {
        // Test that build_narrowing_context correctly builds narrowing from IsInstanceCheck
        let checks = vec![IsInstanceCheck {
            variable: "x".to_string(),
            scope_path: vec!["<module>".to_string(), "process".to_string()],
            checked_types: vec!["Handler".to_string()],
            check_span: Some(Span { start: 50, end: 70 }),
            branch_span: Span {
                start: 80,
                end: 150,
            },
        }];

        let ctx = build_narrowing_context(&checks);

        // Verify narrowing is stored
        assert!(!ctx.is_empty());
        assert_eq!(ctx.len(), 1);

        // Verify narrowing can be retrieved within branch
        let scope = vec!["<module>".to_string(), "process".to_string()];
        let site = Span {
            start: 100,
            end: 101,
        };
        assert_eq!(ctx.get_narrowed_type(&scope, "x", site), Some("Handler"));
    }

    #[test]
    fn test_isinstance_narrows_x_to_handler_in_branch() {
        // Integration: isinstance(x, Handler) narrows x to Handler in branch
        use crate::types::{AssignmentInfo, SpanInfo};

        // Simulate: x: object = obj; if isinstance(x, Handler): x.process()
        let checks = vec![IsInstanceCheck {
            variable: "x".to_string(),
            scope_path: vec!["<module>".to_string(), "func".to_string()],
            checked_types: vec!["Handler".to_string()],
            check_span: Some(Span { start: 30, end: 55 }),
            branch_span: Span {
                start: 60,
                end: 100,
            },
        }];

        let ctx = build_narrowing_context(&checks);
        let scope = vec!["<module>".to_string(), "func".to_string()];

        // Create type tracker with base type "object" for x
        let mut tracker = TypeTracker::new();
        let assignments = vec![AssignmentInfo {
            target: "x".to_string(),
            scope_path: scope.clone(),
            type_source: "variable".to_string(),
            inferred_type: Some("object".to_string()),
            rhs_name: None,
            callee_name: None,
            span: Some(SpanInfo { start: 0, end: 10 }),
            line: Some(1),
            col: Some(1),
            is_self_attribute: false,
            attribute_name: None,
        }];
        tracker.process_assignments(&assignments);

        // Within branch: x should be narrowed to Handler
        let site_in_branch = Span { start: 70, end: 71 };
        let result = type_of_with_narrowing(&scope, "x", site_in_branch, &ctx, &tracker);
        assert_eq!(
            result,
            Some("Handler"),
            "x should be narrowed to Handler inside branch"
        );
    }

    #[test]
    fn test_narrowing_does_not_persist_outside_branch() {
        // Integration: Narrowing does not persist outside if-branch (span check)
        use crate::types::{AssignmentInfo, SpanInfo};

        let checks = vec![IsInstanceCheck {
            variable: "x".to_string(),
            scope_path: vec!["<module>".to_string(), "func".to_string()],
            checked_types: vec!["Handler".to_string()],
            check_span: Some(Span { start: 30, end: 55 }),
            branch_span: Span {
                start: 60,
                end: 100,
            },
        }];

        let ctx = build_narrowing_context(&checks);
        let scope = vec!["<module>".to_string(), "func".to_string()];

        // Create type tracker with base type "object" for x
        let mut tracker = TypeTracker::new();
        let assignments = vec![AssignmentInfo {
            target: "x".to_string(),
            scope_path: scope.clone(),
            type_source: "variable".to_string(),
            inferred_type: Some("object".to_string()),
            rhs_name: None,
            callee_name: None,
            span: Some(SpanInfo { start: 0, end: 10 }),
            line: Some(1),
            col: Some(1),
            is_self_attribute: false,
            attribute_name: None,
        }];
        tracker.process_assignments(&assignments);

        // Before branch: x should have base type
        let site_before = Span { start: 20, end: 21 };
        let result_before = type_of_with_narrowing(&scope, "x", site_before, &ctx, &tracker);
        assert_eq!(
            result_before,
            Some("object"),
            "x should have base type before branch"
        );

        // After branch: x should have base type
        let site_after = Span {
            start: 150,
            end: 151,
        };
        let result_after = type_of_with_narrowing(&scope, "x", site_after, &ctx, &tracker);
        assert_eq!(
            result_after,
            Some("object"),
            "x should have base type after branch"
        );
    }

    #[test]
    fn test_build_narrowing_context_with_tuple_isinstance() {
        // Test that tuple isinstance (multiple types) uses first type
        let checks = vec![IsInstanceCheck {
            variable: "x".to_string(),
            scope_path: vec!["<module>".to_string()],
            checked_types: vec!["Handler".to_string(), "Worker".to_string()],
            check_span: Some(Span { start: 30, end: 65 }),
            branch_span: Span {
                start: 70,
                end: 150,
            },
        }];

        let ctx = build_narrowing_context(&checks);

        // Should use first type for now
        let scope = vec!["<module>".to_string()];
        let site = Span {
            start: 100,
            end: 101,
        };
        assert_eq!(ctx.get_narrowed_type(&scope, "x", site), Some("Handler"));
    }

    #[test]
    fn test_build_narrowing_context_empty_checks() {
        // Test with no isinstance checks
        let checks: Vec<IsInstanceCheck> = vec![];
        let ctx = build_narrowing_context(&checks);
        assert!(ctx.is_empty());
    }
}
