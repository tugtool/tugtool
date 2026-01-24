//! Value-level alias tracking for Python analysis.
//!
//! This module provides types and utilities for tracking value-level aliases
//! within Python code. An alias is created when a simple assignment copies
//! a reference: `b = bar` creates an alias where `b` aliases `bar`.
//!
//! # Design Decisions
//!
//! - **Informational only** (D06): Impact analysis will SHOW potential aliases
//!   but NOT automatically rename them.
//! - **Single-file scope** (D07): Alias tracking operates per-file.
//! - **Uses existing data** (D08): Built from `AssignmentInfo` produced by
//!   `TypeInferenceCollector`, not a new CST visitor.
//!
//! # Tracked Patterns
//!
//! | Pattern | Tracked? |
//! |---------|----------|
//! | `b = bar` (simple) | Yes |
//! | `c = b = bar` (chained) | Yes |
//! | `b = bar; c = b` (sequential) | Yes |
//! | `a = b = c = x` (multi) | Yes |
//! | `a, b = foo, bar` (tuple) | No |
//! | `b: Type = bar` (annotated) | No |
//! | `b := bar` (walrus) | No |
//! | `b += bar` (augmented) | No |
//! | `self.x = y` (attribute) | No |
//!
//! # Example
//!
//! ```ignore
//! use tugtool_python::alias::AliasGraph;
//! use tugtool_python::types::AssignmentInfo;
//! use std::collections::HashSet;
//!
//! let assignments = vec![/* ... */];
//! let imports = HashSet::new();
//! let graph = AliasGraph::from_analysis(&assignments, &imports);
//!
//! // Find direct aliases for "bar"
//! let aliases = graph.direct_aliases("bar");
//!
//! // Find transitive aliases (follows chain)
//! let all_aliases = graph.transitive_aliases("bar", None, None);
//! ```

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tugtool_core::patch::Span;

use crate::types::AssignmentInfo;

// ============================================================================
// AliasInfo
// ============================================================================

/// Information about a value-level alias relationship.
///
/// Represents an assignment like `b = bar` where:
/// - `alias_name` is "b" (the LHS, the new binding)
/// - `source_name` is "bar" (the RHS, what it aliases)
///
/// Per Spec S04 in phase-10.md.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AliasInfo {
    /// The new binding name (LHS of assignment).
    ///
    /// Example: In `b = bar`, alias_name is "b".
    pub alias_name: String,

    /// The source being aliased (RHS of assignment).
    ///
    /// Example: In `b = bar`, source_name is "bar".
    pub source_name: String,

    /// Scope path where the alias is defined.
    ///
    /// Example: `["<module>", "function:process"]`
    pub scope_path: Vec<String>,

    /// Byte span of the alias target (LHS).
    ///
    /// Used for location display in impact analysis.
    pub alias_span: Option<Span>,

    /// Whether the source is an imported name.
    ///
    /// True for patterns like `from module import bar; b = bar`.
    pub source_is_import: bool,

    /// Confidence level for the alias relationship.
    ///
    /// - 1.0 for simple assignments (`b = bar`)
    /// - Could be lower for complex patterns (future)
    pub confidence: f32,
}

impl AliasInfo {
    /// Create a new AliasInfo from an assignment.
    ///
    /// Sets confidence to 1.0 for simple assignments.
    pub fn from_assignment(
        alias_name: String,
        source_name: String,
        scope_path: Vec<String>,
        alias_span: Option<Span>,
        source_is_import: bool,
    ) -> Self {
        AliasInfo {
            alias_name,
            source_name,
            scope_path,
            alias_span,
            source_is_import,
            confidence: 1.0, // Simple assignment = full confidence
        }
    }
}

// ============================================================================
// AliasGraph
// ============================================================================

/// Graph for tracking value-level aliases within a single file.
///
/// The graph supports both forward lookups (source -> aliases) and
/// reverse lookups (alias -> sources). It is scope-aware but stores
/// all scopes together, with filtering applied at query time.
///
/// Per Spec S04 and [D07] in phase-10.md.
#[derive(Debug, Default)]
pub struct AliasGraph {
    /// Forward map: source_name -> list of AliasInfo.
    ///
    /// Multiple aliases can share the same source.
    forward: HashMap<String, Vec<AliasInfo>>,

    /// Reverse map: alias_name -> list of source_names.
    ///
    /// An alias can potentially alias multiple sources (in different scopes).
    reverse: HashMap<String, Vec<String>>,
}

impl AliasGraph {
    /// Create an empty AliasGraph.
    pub fn new() -> Self {
        Self::default()
    }

    /// Build an AliasGraph from analysis assignments.
    ///
    /// Filters to only `type_source == "variable"` assignments and
    /// excludes self-assignments (`x = x`).
    ///
    /// # Arguments
    ///
    /// * `assignments` - AssignmentInfo list from CST analysis
    /// * `imports` - Set of imported names (for source_is_import flag)
    ///
    /// # Example
    ///
    /// ```ignore
    /// use tugtool_python::alias::AliasGraph;
    /// use std::collections::HashSet;
    ///
    /// let graph = AliasGraph::from_analysis(&assignments, &imports);
    /// ```
    pub fn from_analysis(assignments: &[AssignmentInfo], imports: &HashSet<String>) -> Self {
        let mut graph = AliasGraph::new();

        for assignment in assignments {
            // Only process variable aliases (not constructors, function calls, etc.)
            if assignment.type_source != "variable" {
                continue;
            }

            // Get the RHS name (the source being aliased)
            let source_name = match &assignment.rhs_name {
                Some(name) => name,
                None => continue,
            };

            // Skip self-assignments (x = x)
            if assignment.target == *source_name {
                continue;
            }

            // Build the span from assignment data
            let alias_span = assignment
                .span
                .as_ref()
                .map(|s| Span::new(s.start as u64, s.end as u64));

            // Check if source is an import
            let source_is_import = imports.contains(source_name);

            let info = AliasInfo::from_assignment(
                assignment.target.clone(),
                source_name.clone(),
                assignment.scope_path.clone(),
                alias_span,
                source_is_import,
            );

            // Insert into forward map
            graph
                .forward
                .entry(source_name.clone())
                .or_default()
                .push(info);

            // Insert into reverse map
            graph
                .reverse
                .entry(assignment.target.clone())
                .or_default()
                .push(source_name.clone());
        }

        graph
    }

    /// Get direct aliases for a source name (all scopes).
    ///
    /// Returns all AliasInfo entries where source_name matches.
    /// Caller should filter by scope_path if needed.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let aliases = graph.direct_aliases("bar");
    /// for alias in aliases {
    ///     println!("{} aliases bar", alias.alias_name);
    /// }
    /// ```
    pub fn direct_aliases(&self, source_name: &str) -> &[AliasInfo] {
        self.forward
            .get(source_name)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// Get direct aliases for a source name filtered by exact scope.
    ///
    /// Per Spec S04: "Exact match only. An alias at `["module", "function:foo"]`
    /// does NOT match a target at `["module", "function:foo", "function:inner"]`."
    ///
    /// # Arguments
    ///
    /// * `source_name` - The source to find aliases for
    /// * `scope_path` - The exact scope path to match
    pub fn direct_aliases_in_scope(
        &self,
        source_name: &str,
        scope_path: &[String],
    ) -> Vec<&AliasInfo> {
        self.direct_aliases(source_name)
            .iter()
            .filter(|info| info.scope_path == scope_path)
            .collect()
    }

    /// Get transitive aliases for a source name.
    ///
    /// Follows the alias chain: if bar -> b -> c, then
    /// transitive_aliases("bar") returns [b, c].
    ///
    /// Uses a visited set to handle cycles (per Spec S04).
    ///
    /// # Arguments
    ///
    /// * `source_name` - The source to find aliases for
    /// * `scope_path` - Optional scope filter (None = all scopes)
    /// * `max_depth` - Maximum chain depth to follow (default: 10)
    ///
    /// # Example
    ///
    /// ```ignore
    /// // For: b = bar; c = b; d = c
    /// let aliases = graph.transitive_aliases("bar", None, None);
    /// // Returns [b, c, d]
    /// ```
    pub fn transitive_aliases(
        &self,
        source_name: &str,
        scope_path: Option<&[String]>,
        max_depth: Option<usize>,
    ) -> Vec<AliasInfo> {
        let max_depth = max_depth.unwrap_or(10);
        let mut visited: HashSet<String> = HashSet::new();
        let mut result: Vec<AliasInfo> = Vec::new();

        self.transitive_aliases_inner(
            source_name,
            scope_path,
            &mut visited,
            &mut result,
            0,
            max_depth,
        );

        result
    }

    /// Internal recursive helper for transitive alias traversal.
    fn transitive_aliases_inner(
        &self,
        source_name: &str,
        scope_path: Option<&[String]>,
        visited: &mut HashSet<String>,
        result: &mut Vec<AliasInfo>,
        depth: usize,
        max_depth: usize,
    ) {
        // Check depth limit
        if depth >= max_depth {
            return;
        }

        // Check for cycles - if already visited, don't recurse
        if !visited.insert(source_name.to_string()) {
            return;
        }

        // Get direct aliases
        let aliases = match scope_path {
            Some(path) => self
                .direct_aliases_in_scope(source_name, path)
                .into_iter()
                .cloned()
                .collect::<Vec<_>>(),
            None => self.direct_aliases(source_name).to_vec(),
        };

        for alias in aliases {
            let alias_name = alias.alias_name.clone();

            // Skip if this alias was already visited (handles cycles)
            if visited.contains(&alias_name) {
                continue;
            }

            // Add to result
            result.push(alias);

            // Recursively follow this alias
            self.transitive_aliases_inner(
                &alias_name,
                scope_path,
                visited,
                result,
                depth + 1,
                max_depth,
            );
        }
    }

    /// Get sources that a name aliases (reverse lookup).
    ///
    /// For `b = bar`, reverse_lookup("b") returns ["bar"].
    ///
    /// # Example
    ///
    /// ```ignore
    /// let sources = graph.reverse_lookup("b");
    /// // Returns ["bar"] if b = bar exists
    /// ```
    pub fn reverse_lookup(&self, alias_name: &str) -> &[String] {
        self.reverse
            .get(alias_name)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// Check if the graph is empty.
    pub fn is_empty(&self) -> bool {
        self.forward.is_empty()
    }

    /// Get the number of source names tracked.
    pub fn source_count(&self) -> usize {
        self.forward.len()
    }

    /// Get the total number of alias relationships.
    pub fn alias_count(&self) -> usize {
        self.forward.values().map(|v| v.len()).sum()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SpanInfo;

    /// Helper to create a variable assignment for testing.
    fn make_variable_assignment(
        target: &str,
        rhs_name: &str,
        scope_path: Vec<&str>,
    ) -> AssignmentInfo {
        AssignmentInfo {
            target: target.to_string(),
            scope_path: scope_path.into_iter().map(String::from).collect(),
            type_source: "variable".to_string(),
            inferred_type: None,
            rhs_name: Some(rhs_name.to_string()),
            callee_name: None,
            span: Some(SpanInfo { start: 0, end: 1 }),
            line: Some(1),
            col: Some(1),
        }
    }

    /// Helper to create a variable assignment with specific span for testing.
    fn make_variable_assignment_with_span(
        target: &str,
        rhs_name: &str,
        scope_path: Vec<&str>,
        start: usize,
        end: usize,
    ) -> AssignmentInfo {
        AssignmentInfo {
            target: target.to_string(),
            scope_path: scope_path.into_iter().map(String::from).collect(),
            type_source: "variable".to_string(),
            inferred_type: None,
            rhs_name: Some(rhs_name.to_string()),
            callee_name: None,
            span: Some(SpanInfo { start, end }),
            line: Some(1),
            col: Some(1),
        }
    }

    /// Helper to create a constructor assignment for testing.
    fn make_constructor_assignment(target: &str, scope_path: Vec<&str>) -> AssignmentInfo {
        AssignmentInfo {
            target: target.to_string(),
            scope_path: scope_path.into_iter().map(String::from).collect(),
            type_source: "constructor".to_string(),
            inferred_type: Some("MyClass".to_string()),
            rhs_name: None,
            callee_name: None,
            span: Some(SpanInfo { start: 0, end: 1 }),
            line: Some(1),
            col: Some(1),
        }
    }

    /// Helper to create a function call assignment for testing.
    fn make_function_call_assignment(target: &str, scope_path: Vec<&str>) -> AssignmentInfo {
        AssignmentInfo {
            target: target.to_string(),
            scope_path: scope_path.into_iter().map(String::from).collect(),
            type_source: "function_call".to_string(),
            inferred_type: None,
            rhs_name: None,
            callee_name: Some("get_data".to_string()),
            span: Some(SpanInfo { start: 0, end: 1 }),
            line: Some(1),
            col: Some(1),
        }
    }

    // ========================================================================
    // Table T09 Tests (AG-01 through AG-10)
    // ========================================================================

    #[test]
    fn test_alias_direct_simple() {
        // AG-01, VA-01: b = bar -> forward["bar"] has b
        let assignments = vec![make_variable_assignment("b", "bar", vec!["<module>"])];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        let aliases = graph.direct_aliases("bar");
        assert_eq!(aliases.len(), 1);
        assert_eq!(aliases[0].alias_name, "b");
        assert_eq!(aliases[0].source_name, "bar");
    }

    #[test]
    fn test_alias_chained_assignment() {
        // AG-02, VA-02: c = b = bar -> both b and c alias bar
        // CST produces separate assignments for each target
        let assignments = vec![
            make_variable_assignment("b", "bar", vec!["<module>"]),
            make_variable_assignment("c", "bar", vec!["<module>"]),
        ];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        let aliases = graph.direct_aliases("bar");
        assert_eq!(aliases.len(), 2);
        let names: Vec<_> = aliases.iter().map(|a| a.alias_name.as_str()).collect();
        assert!(names.contains(&"b"));
        assert!(names.contains(&"c"));
    }

    #[test]
    fn test_alias_transitive() {
        // AG-03, VA-03: b = bar; c = b -> transitive_aliases("bar") = [b, c]
        let assignments = vec![
            make_variable_assignment("b", "bar", vec!["<module>"]),
            make_variable_assignment("c", "b", vec!["<module>"]),
        ];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        let transitive = graph.transitive_aliases("bar", None, None);
        assert_eq!(transitive.len(), 2);
        let names: Vec<_> = transitive.iter().map(|a| a.alias_name.as_str()).collect();
        assert!(names.contains(&"b"));
        assert!(names.contains(&"c"));
    }

    #[test]
    fn test_alias_self_assignment() {
        // AG-04, VA-04: x = x not tracked
        let assignments = vec![make_variable_assignment("x", "x", vec!["<module>"])];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        assert!(graph.is_empty());
    }

    #[test]
    fn test_alias_cycle_no_infinite_loop() {
        // AG-05, VA-05: a = b; b = a terminates
        let assignments = vec![
            make_variable_assignment("a", "b", vec!["<module>"]),
            make_variable_assignment("b", "a", vec!["<module>"]),
        ];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        // Should complete without hanging
        let transitive = graph.transitive_aliases("a", None, None);
        // a -> b (b is added), then b -> a but a already visited, so we stop
        assert_eq!(transitive.len(), 1);
        assert_eq!(transitive[0].alias_name, "b");
    }

    #[test]
    fn test_alias_reverse_lookup() {
        // AG-06: reverse["b"] -> ["bar"]
        let assignments = vec![make_variable_assignment("b", "bar", vec!["<module>"])];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        let sources = graph.reverse_lookup("b");
        assert_eq!(sources, &["bar"]);
    }

    #[test]
    fn test_alias_scope_filtering() {
        // AG-07: Same alias name in different scopes
        let assignments = vec![
            make_variable_assignment("b", "bar", vec!["<module>"]),
            make_variable_assignment("b", "baz", vec!["<module>", "func"]),
        ];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        // At module scope, b aliases bar
        let module_aliases = graph.direct_aliases_in_scope("bar", &["<module>".to_string()]);
        assert_eq!(module_aliases.len(), 1);
        assert_eq!(module_aliases[0].alias_name, "b");

        // At func scope, bar has no aliases (baz is aliased there, not bar)
        let func_aliases =
            graph.direct_aliases_in_scope("bar", &["<module>".to_string(), "func".to_string()]);
        assert!(func_aliases.is_empty());
    }

    #[test]
    fn test_alias_confidence_simple() {
        // AG-08: Simple assignment has confidence 1.0
        let assignments = vec![make_variable_assignment("b", "bar", vec!["<module>"])];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        let aliases = graph.direct_aliases("bar");
        assert_eq!(aliases[0].confidence, 1.0);
    }

    #[test]
    fn test_alias_from_analysis_empty() {
        // AG-09: No assignments -> empty graph
        let graph = AliasGraph::from_analysis(&[], &HashSet::new());
        assert!(graph.is_empty());
        assert_eq!(graph.source_count(), 0);
        assert_eq!(graph.alias_count(), 0);
    }

    #[test]
    fn test_alias_transitive_depth_limit() {
        // AG-10: Deep chain (15 levels) stops at max_depth
        let assignments: Vec<_> = (0..15)
            .map(|i| {
                let target = format!("v{}", i + 1);
                let source = if i == 0 {
                    "source".to_string()
                } else {
                    format!("v{}", i)
                };
                make_variable_assignment(&target, &source, vec!["<module>"])
            })
            .collect();
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        // With default max_depth of 10, should stop at v10
        let transitive = graph.transitive_aliases("source", None, None);
        assert!(transitive.len() <= 10);
    }

    // ========================================================================
    // Additional Tests (AG-11 through AG-16)
    // ========================================================================

    #[test]
    fn test_alias_multi_target_same_source() {
        // AG-11: a = x; b = x -> both in forward["x"]
        let assignments = vec![
            make_variable_assignment("a", "x", vec!["<module>"]),
            make_variable_assignment("b", "x", vec!["<module>"]),
        ];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        let aliases = graph.direct_aliases("x");
        assert_eq!(aliases.len(), 2);
        let names: Vec<_> = aliases.iter().map(|a| a.alias_name.as_str()).collect();
        assert!(names.contains(&"a"));
        assert!(names.contains(&"b"));
    }

    #[test]
    fn test_alias_nested_scope_separate() {
        // AG-12: Same name in different scopes tracked separately
        let assignments = vec![
            make_variable_assignment("b", "bar", vec!["<module>"]),
            make_variable_assignment("b", "bar", vec!["<module>", "func"]),
        ];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        // Both tracked
        let all_aliases = graph.direct_aliases("bar");
        assert_eq!(all_aliases.len(), 2);

        // Filtered by scope
        let module_aliases = graph.direct_aliases_in_scope("bar", &["<module>".to_string()]);
        assert_eq!(module_aliases.len(), 1);

        let func_aliases =
            graph.direct_aliases_in_scope("bar", &["<module>".to_string(), "func".to_string()]);
        assert_eq!(func_aliases.len(), 1);
    }

    #[test]
    fn test_alias_import_flag_set() {
        // AG-13: Imported source has source_is_import: true
        let assignments = vec![make_variable_assignment("b", "bar", vec!["<module>"])];
        let imports: HashSet<String> = ["bar".to_string()].into_iter().collect();
        let graph = AliasGraph::from_analysis(&assignments, &imports);

        let aliases = graph.direct_aliases("bar");
        assert!(aliases[0].source_is_import);
    }

    #[test]
    fn test_alias_span_populated() {
        // AG-14: alias_span contains correct byte offsets
        let assignments = vec![make_variable_assignment_with_span(
            "b",
            "bar",
            vec!["<module>"],
            10,
            20,
        )];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        let aliases = graph.direct_aliases("bar");
        assert!(aliases[0].alias_span.is_some());
        let span = aliases[0].alias_span.unwrap();
        assert_eq!(span.start, 10);
        assert_eq!(span.end, 20);
    }

    #[test]
    fn test_alias_constructor_ignored() {
        // AG-15: x = MyClass() not tracked as alias
        let assignments = vec![make_constructor_assignment("x", vec!["<module>"])];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());
        assert!(graph.is_empty());
    }

    #[test]
    fn test_alias_function_call_ignored() {
        // AG-16: x = get_data() not tracked as alias
        let assignments = vec![make_function_call_assignment("x", vec!["<module>"])];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());
        assert!(graph.is_empty());
    }
}
