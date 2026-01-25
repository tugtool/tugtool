# Step 9: AliasGraph Module - Detailed Implementation Spec

**Parent Plan:** phase-10.md
**Status:** pending
**Commit Message:** `feat(python): add AliasGraph for value-level alias tracking`

---

## Overview

This step creates the AliasGraph module for value-level alias tracking. The goal is to track patterns like `b = bar` so that when renaming `bar`, impact analysis can inform the user about potential aliases.

**Key Decisions from Phase 10:**
- [D06] Value-Alias Tracking is Informational Only: Impact analysis will SHOW potential aliases but NOT automatically rename them
- [D07] Alias Graph is Single-File Scope: Value-level alias tracking operates per-file for Phase 10
- [D08] Use Existing TypeInferenceCollector Data: Build alias graph from existing `AssignmentInfo` data rather than new CST visitor

---

## Codebase Analysis

### AssignmentInfo Source

The `AssignmentInfo` type exists in two locations:

1. **CST Layer** (`tugtool-python-cst/src/visitor/type_inference.rs`):
   - Produced by `TypeInferenceCollector::collect()`
   - Contains `type_source: TypeSource` enum with variants: `Constructor`, `Variable`, `FunctionCall`, `Unknown`
   - Has `rhs_name: Option<String>` for variable aliases
   - Has `scope_path: Vec<String>` for scope tracking
   - Has `span: Option<Span>` for location

2. **Types Layer** (`tugtool-python/src/types.rs`):
   - Serializable version with `type_source: String`
   - Same fields as CST version but string-based

**Alias-relevant fields:**
- `type_source == "variable"` indicates a variable alias (`y = x`)
- `rhs_name` is the source being aliased
- `target` is the new alias name

### Scope Path Format

Scope paths are `Vec<String>` using these patterns:
- Module: `["<module>"]`
- Function: `["<module>", "function_name"]`
- Class: `["<module>", "ClassName"]`
- Method: `["<module>", "ClassName", "method_name"]`
- Nested: `["<module>", "outer", "inner"]`

### Existing Integration Point

In `cst_bridge.rs`:
```rust
let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);
```

In `analyzer.rs` (around line 967-1005):
```rust
let cst_assignments: Vec<crate::types::AssignmentInfo> = native_result
    .assignments
    .iter()
    .map(|a| crate::types::AssignmentInfo { ... })
    .collect();

tracker.process_assignments(&cst_assignments);
```

---

## Type Definitions

### AliasInfo

```rust
// File: crates/tugtool-python/src/alias.rs

use tugtool_core::patch::Span;
use serde::{Deserialize, Serialize};

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
    /// Example: In `b = bar`, alias_name is "b".
    pub alias_name: String,

    /// The source being aliased (RHS of assignment).
    /// Example: In `b = bar`, source_name is "bar".
    pub source_name: String,

    /// Scope path where the alias is defined.
    /// Example: `["<module>", "function:process"]`
    pub scope_path: Vec<String>,

    /// Byte span of the alias target (LHS).
    /// Used for location display in impact analysis.
    pub alias_span: Option<Span>,

    /// Whether the source is an imported name.
    /// True for `from module import bar; b = bar`.
    pub source_is_import: bool,

    /// Confidence level for the alias relationship.
    /// - 1.0 for simple assignments (`b = bar`)
    /// - Could be lower for complex patterns (future)
    pub confidence: f32,
}

impl AliasInfo {
    /// Create a new AliasInfo from an assignment.
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
```

### AliasGraph

```rust
use std::collections::{HashMap, HashSet};
use crate::types::AssignmentInfo;

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
    /// Multiple aliases can share the same source.
    forward: HashMap<String, Vec<AliasInfo>>,

    /// Reverse map: alias_name -> list of source_names.
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
    /// * `assignments` - AssignmentInfo list from CST analysis
    /// * `imports` - Set of imported names (for source_is_import flag)
    pub fn from_analysis(
        assignments: &[AssignmentInfo],
        imports: &HashSet<String>,
    ) -> Self {
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
            let alias_span = assignment.span.as_ref().map(|s| {
                Span::new(s.start as u64, s.end as u64)
            });

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
            graph.forward
                .entry(source_name.clone())
                .or_default()
                .push(info);

            // Insert into reverse map
            graph.reverse
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
    pub fn direct_aliases(&self, source_name: &str) -> &[AliasInfo] {
        self.forward
            .get(source_name)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// Get direct aliases for a source name filtered by exact scope.
    ///
    /// Per Spec S04: "Exact match only. An alias at ["module", "function:foo"]
    /// does NOT match a target at ["module", "function:foo", "function:inner"]."
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
    /// * `source_name` - The source to find aliases for
    /// * `scope_path` - Optional scope filter (None = all scopes)
    /// * `max_depth` - Maximum chain depth to follow (default: 10)
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

        // Check for cycles
        if !visited.insert(source_name.to_string()) {
            return;
        }

        // Get direct aliases
        let aliases = match scope_path {
            Some(path) => self.direct_aliases_in_scope(source_name, path)
                .into_iter()
                .cloned()
                .collect::<Vec<_>>(),
            None => self.direct_aliases(source_name).to_vec(),
        };

        for alias in aliases {
            // Add to result
            let alias_name = alias.alias_name.clone();
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
```

---

## File Location

Create new file: `crates/tugtool-python/src/alias.rs`

Update `crates/tugtool-python/src/lib.rs` to add:
```rust
pub mod alias;
```

---

## Implementation Tasks

### Task 1: Create alias.rs with type definitions
- [ ] Create `crates/tugtool-python/src/alias.rs`
- [ ] Define `AliasInfo` struct with all fields from Spec S04
- [ ] Implement `AliasInfo::from_assignment()` constructor
- [ ] Define `AliasGraph` struct with forward and reverse maps

### Task 2: Implement AliasGraph::from_analysis
- [ ] Implement filtering for `type_source == "variable"`
- [ ] Skip self-assignments (`x = x`)
- [ ] Populate forward map (source -> aliases)
- [ ] Populate reverse map (alias -> sources)
- [ ] Set `source_is_import` based on imports set

### Task 3: Implement query methods
- [ ] Implement `direct_aliases()` - all scopes
- [ ] Implement `direct_aliases_in_scope()` - exact scope match
- [ ] Implement `reverse_lookup()` for reverse map access

### Task 4: Implement transitive_aliases
- [ ] Add `visited: HashSet<String>` for cycle detection
- [ ] Add `max_depth` parameter with default 10
- [ ] Implement recursive traversal following alias chain
- [ ] Return early on cycle or depth limit

### Task 5: Add utility methods
- [ ] Implement `is_empty()`
- [ ] Implement `source_count()`
- [ ] Implement `alias_count()`
- [ ] Implement `Default` trait

### Task 6: Update lib.rs
- [ ] Add `pub mod alias;` to module list
- [ ] Add module to docstring

---

## Test Plan

### Table T09: AliasGraph Unit Test Cases (from phase-10.md)

| ID | Test Name | Type | Description |
|----|-----------|------|-------------|
| AG-01 | `test_alias_direct_simple` | unit | VA-01: `b = bar` -> forward["bar"] has b |
| AG-02 | `test_alias_chained_assignment` | unit | VA-02: `c = b = bar` -> both alias bar |
| AG-03 | `test_alias_transitive` | unit | VA-03: `b = bar; c = b` -> transitive |
| AG-04 | `test_alias_self_assignment` | unit | VA-04: `x = x` not tracked |
| AG-05 | `test_alias_cycle_no_infinite_loop` | unit | VA-05: `a = b; b = a` terminates |
| AG-06 | `test_alias_reverse_lookup` | unit | reverse["b"] -> ["bar"] |
| AG-07 | `test_alias_scope_filtering` | unit | Filter by scope_path |
| AG-08 | `test_alias_confidence_simple` | unit | Simple assignment -> confidence 1.0 |
| AG-09 | `test_alias_from_analysis_empty` | unit | No assignments -> empty graph |
| AG-10 | `test_alias_transitive_depth_limit` | unit | Deep chain doesn't explode |

### Additional Test Cases (beyond Table T09)

| ID | Test Name | Type | Description |
|----|-----------|------|-------------|
| AG-11 | `test_alias_multi_target_same_source` | unit | `a = x; b = x` -> both in forward["x"] |
| AG-12 | `test_alias_nested_scope_separate` | unit | Same name in different scopes tracked separately |
| AG-13 | `test_alias_import_flag_set` | unit | Imported source has `source_is_import: true` |
| AG-14 | `test_alias_span_populated` | unit | alias_span contains correct byte offsets |
| AG-15 | `test_alias_constructor_ignored` | unit | `x = MyClass()` not tracked as alias |
| AG-16 | `test_alias_function_call_ignored` | unit | `x = get_data()` not tracked as alias |

### Test Implementation Outline

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{AssignmentInfo, SpanInfo};
    use std::collections::HashSet;

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

    #[test]
    fn test_alias_direct_simple() {
        // VA-01: b = bar -> forward["bar"] has b
        let assignments = vec![make_variable_assignment("b", "bar", vec!["<module>"])];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        let aliases = graph.direct_aliases("bar");
        assert_eq!(aliases.len(), 1);
        assert_eq!(aliases[0].alias_name, "b");
        assert_eq!(aliases[0].source_name, "bar");
    }

    #[test]
    fn test_alias_chained_assignment() {
        // VA-02: c = b = bar -> both b and c alias bar
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
        // VA-03: b = bar; c = b -> transitive_aliases("bar") = [b, c]
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
        // VA-04: x = x not tracked
        let assignments = vec![make_variable_assignment("x", "x", vec!["<module>"])];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        assert!(graph.is_empty());
    }

    #[test]
    fn test_alias_cycle_no_infinite_loop() {
        // VA-05: a = b; b = a terminates
        let assignments = vec![
            make_variable_assignment("a", "b", vec!["<module>"]),
            make_variable_assignment("b", "a", vec!["<module>"]),
        ];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        // Should complete without hanging
        let transitive = graph.transitive_aliases("a", None, None);
        // a -> b, and cycle detected
        assert_eq!(transitive.len(), 1);
        assert_eq!(transitive[0].alias_name, "b");
    }

    #[test]
    fn test_alias_reverse_lookup() {
        // reverse["b"] -> ["bar"]
        let assignments = vec![make_variable_assignment("b", "bar", vec!["<module>"])];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        let sources = graph.reverse_lookup("b");
        assert_eq!(sources, &["bar"]);
    }

    #[test]
    fn test_alias_scope_filtering() {
        // Same alias name in different scopes
        let assignments = vec![
            make_variable_assignment("b", "bar", vec!["<module>"]),
            make_variable_assignment("b", "baz", vec!["<module>", "func"]),
        ];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        // At module scope, b aliases bar
        let module_aliases = graph.direct_aliases_in_scope("bar", &["<module>".to_string()]);
        assert_eq!(module_aliases.len(), 1);
        assert_eq!(module_aliases[0].alias_name, "b");

        // At func scope, bar has no aliases
        let func_aliases = graph.direct_aliases_in_scope(
            "bar",
            &["<module>".to_string(), "func".to_string()],
        );
        assert!(func_aliases.is_empty());
    }

    #[test]
    fn test_alias_confidence_simple() {
        let assignments = vec![make_variable_assignment("b", "bar", vec!["<module>"])];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        let aliases = graph.direct_aliases("bar");
        assert_eq!(aliases[0].confidence, 1.0);
    }

    #[test]
    fn test_alias_from_analysis_empty() {
        let graph = AliasGraph::from_analysis(&[], &HashSet::new());
        assert!(graph.is_empty());
        assert_eq!(graph.source_count(), 0);
        assert_eq!(graph.alias_count(), 0);
    }

    #[test]
    fn test_alias_transitive_depth_limit() {
        // Deep chain: a -> b -> c -> d -> e -> f -> g -> h -> i -> j -> k
        let assignments: Vec<_> = (0..15)
            .map(|i| {
                let target = format!("v{}", i + 1);
                let source = if i == 0 { "source".to_string() } else { format!("v{}", i) };
                make_variable_assignment(&target, &source, vec!["<module>"])
            })
            .collect();
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());

        // With default max_depth of 10, should stop at v10
        let transitive = graph.transitive_aliases("source", None, None);
        assert!(transitive.len() <= 10);
    }

    #[test]
    fn test_alias_constructor_ignored() {
        let assignments = vec![make_constructor_assignment("x", vec!["<module>"])];
        let graph = AliasGraph::from_analysis(&assignments, &HashSet::new());
        assert!(graph.is_empty());
    }

    #[test]
    fn test_alias_import_flag_set() {
        let assignments = vec![make_variable_assignment("b", "bar", vec!["<module>"])];
        let imports: HashSet<String> = ["bar".to_string()].into_iter().collect();
        let graph = AliasGraph::from_analysis(&assignments, &imports);

        let aliases = graph.direct_aliases("bar");
        assert!(aliases[0].source_is_import);
    }
}
```

---

## Checkpoint

```bash
cargo nextest run -p tugtool-python alias
```

All 16 tests should pass.

---

## Integration Notes for Subsequent Steps

### Step 10: Integrate AliasGraph into Analyzer

The analyzer will need to:
1. Build `AliasGraph` from `NativeAnalysisResult.assignments` in `analyze_file()`
2. Extract import names to pass to `from_analysis()`
3. Store graph in `FileAnalysis` struct

### Step 11: Alias Output Types

Output types in `tugtool-core/src/output.rs` will need:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AliasOutput {
    pub alias_name: String,
    pub source_name: String,
    pub file: String,
    pub line: u32,
    pub col: u32,
    pub scope: Vec<String>,
    pub is_import_alias: bool,
    pub confidence: f32,
}
```

### Step 12: Wire to Impact Analysis

Impact analysis will:
1. Query `alias_graph.transitive_aliases(symbol_name, Some(scope_path), None)`
2. Convert `AliasInfo` to `AliasOutput` with file/line/col
3. Include in `AnalyzeImpactResponse` (requires schema update)

---

## Alias Tracking Coverage (Phase 10)

From Spec S04 Table:

| Pattern | Tracked? | Notes |
|---------|----------|-------|
| `b = bar` (simple) | Yes | |
| `c = b = bar` (chained) | Yes | Both b and c alias bar |
| `b = bar; c = b` (sequential) | Yes | Transitive: c -> b -> bar |
| `a = b = c = x` (multi-assignment) | Yes | All alias x |
| `a, b = foo, bar` (tuple unpacking) | No | |
| `b: Type = bar` (annotated) | No | |
| `if (b := bar):` (walrus) | No | |
| `b += bar` (augmented) | No | |
| `self.x = y` (attribute assignment) | No | Attribute targets not tracked |
| `for x in items` (loop target) | No | Loop variables not tracked as aliases |
| `obj = module` (attribute alias) | No | |
| `b = bar if cond else baz` (conditional) | No | |

---

## Verification Checklist

Before completing this step:
- [ ] All tests in Table T09 pass
- [ ] Additional tests (AG-11 through AG-16) pass
- [ ] `cargo clippy --workspace -- -D warnings` passes
- [ ] `cargo fmt --all` has no changes
- [ ] Checkpoint command succeeds: `cargo nextest run -p tugtool-python alias`
