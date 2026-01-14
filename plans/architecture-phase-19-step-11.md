# Step 11: Observability - Implementation Plan

## Overview

**Exit Criteria:** `explain()` defaults to logical+optimized+DecodePlan summary (physical off by default), and `explain_analyze(...)` provides observed stats when requested.

**Goal**: `explain()` must reliably expose pushdowns and plan rewrites by showing the **logical**, **optimized**, and **physical** pipeline, plus the **chosen DecodePlan**. It should also optionally show estimated and/or observed costs/stats.

**Key Concepts**:
- **Logical plan**: the plan DAG as constructed by the public API (before rewrites)
- **Optimized plan**: after rule-based and/or cost-based rewrites (filter fusion, limit pushdown, TopK fusion, etc.)
- **Physical plan**: execution strategy (operator selection, index representation, batch-grouping/buffering)
- **DecodePlan**: the final pool projection chosen for execution (projection pruning/pushdown)
- **Costs/Stats**:
  - **Estimated**: heuristic cost model outputs (from Step 8)
  - **Observed**: requires execution (`explain_analyze(...)` runs the query and reports stats)

---

## Current State Analysis

### What Exists (Post-Step 8)

| Component | Status | Location |
|-----------|--------|----------|
| `ExplainOptions` | Partial - only `costs: bool` | `crates/arbors/src/handle.rs:237` |
| `explain()` | Basic implementation | `crates/arbors/src/handle.rs:1712` |
| `explain_with(options)` | Implemented | `crates/arbors/src/handle.rs:1762` |
| `CostEstimate` | Complete | `crates/arbors-pipeline/src/optimize/cost.rs` |
| `CostModel` | Complete | `crates/arbors-pipeline/src/optimize/cost.rs` |
| `DecodePlanSummary` | Complete | `crates/arbors-pipeline/src/optimize/analysis.rs` |
| `ArborStoreStats` | Complete | `crates/arbors-base/src/lib.rs:1478` |
| `arborbase_stats()` | Complete | `crates/arbors-base/src/lib.rs:1537` |
| `reset_arborbase_stats()` | Complete | `crates/arbors-base/src/lib.rs:1552` |
| Python `explain(costs=bool)` | Implemented | `python/src/lib.rs:3449` |
| Python type stubs | **Out of sync** - declares `def explain(self) -> str` only | `python/arbors/_arbors.pyi` |

### FIXMEs Referencing Step 11

| File | Line | Description |
|------|------|-------------|
| `handle.rs:248` | REFACTOR FIXME(Step 11) | Add `analyze: bool` to ExplainOptions |
| `handle.rs:1711` | REFACTOR FIXME(Step 11) | Finalize explain/explain_analyze API surface |
| `handle.rs:1761` | REFACTOR FIXME(Step 11) | Add explain_analyze() for observed stats |

### Current explain() Output Structure

The current `explain_with()` output includes:
1. Logical Plan (always)
2. Optimized Plan (always)
3. DecodePlan Summary (always)
4. Early Termination hints (always)
5. Estimated Costs (when `options.costs = true`)

**Missing**:
- Physical plan section (operator selection, index strategy)
- Observed stats section (`explain_analyze()`)
- Granular control over sections (logical, optimized, physical, decode_plan flags)

### ArborStoreStats Fields Available

From `crates/arbors-base/src/lib.rs`:
```rust
pub struct ArborStoreStats {
    pub zero_copy_hits: u64,
    pub copy_fallback_hits: u64,
    pub batches_decoded: u64,
    pub materialize_calls: u64,
    pub early_exit_batches_skipped: u64,
    pub pools_decoded: u64,
    pub pools_skipped: u64,
}
```

---

## Design Decisions

**IMPORTANT:** This library has ZERO external users. No backward compatibility required. Design the API correctly.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| API shape | Parameterized `ExplainOptions` with section flags | Explicit control, extensible |
| Default sections | Logical + Optimized + DecodePlan (physical OFF, costs OFF) | Physical adds noise; costs are opt-in |
| Physical plan | Off by default, opt-in via flag | Predicted strategy, not actual execution |
| `explain_analyze()` | Bounded via `AnalyzeOptions` | User controls how much execution to observe |
| Bounds semantics | Limit **emission**, not upstream work | sort/shuffle/group still do full work before first tree |
| Stats source | ArborStore delta (best-effort) | Global counters documented as noisy in concurrent scenarios |
| Python API | Keyword args delegating to Rust | Thin-layer principle |
| `max_batches` | **Deferred** | Requires executor hooks; use `max_trees` instead |
| `trees_scanned` | **Deferred** | Requires per-execution executor stats |
| Test serialization | Use `#[serial]` for counter-based tests | Global counters shared across parallel tests |
| GIL for `explain_analyze()` | **Keep under GIL** | Debugging API; simplest approach; thread-affinity enforced anyway |
| Python stub drift | Step 11 corrects existing drift | Current stubs are out of sync with runtime |

### explain() Sections

| Section | Default | Description |
|---------|---------|-------------|
| Logical Plan | ON | Plan as constructed |
| Optimized Plan | ON | Plan after optimization |
| Physical Plan | **OFF** | Execution strategy details (predicted, not actual) |
| DecodePlan Summary + Early Termination | ON | Pool projection chosen + limit hints |
| Estimated Costs | OFF | Cost model heuristics (Step 8) |

### explain_analyze() Execution Bounds

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `max_trees` | `Option<usize>` | `None` (unlimited) | Stop after N trees (**strict**) |
| `time_budget_ms` | `Option<u64>` | `None` (unlimited) | Stop after N milliseconds (**best-effort**, may overshoot slightly) |

**Note:** `max_batches` is **deferred** to future work. Enforcing batch limits requires deeper executor integration that is out of scope for Step 11.

---

## Implementation Sub-Steps

### Sub-Step 11.1: Extend ExplainOptions with Section Flags

**Goal:** Add granular control over which sections appear in explain output.

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`

**Code Changes:**

```rust
// crates/arbors/src/handle.rs

/// Options for explain() output.
///
/// Controls which sections are included in the explain output.
/// Use `ExplainOptions::default()` for sensible defaults, or create
/// a custom configuration.
///
/// # Default Sections
///
/// - `logical`: true (shows plan as constructed)
/// - `optimized`: true (shows plan after optimization)
/// - `physical`: false (execution strategy is off by default)
/// - `decode_plan`: true (shows pool projection)
/// - `costs`: false (cost estimates are off by default)
///
/// # Example
///
/// ```rust,ignore
/// use arbors::ExplainOptions;
///
/// // Default: logical + optimized + decode_plan
/// let output = arbor.explain();
///
/// // With costs
/// let output = arbor.explain_with(ExplainOptions::with_costs());
///
/// // Full output including physical plan
/// let output = arbor.explain_with(ExplainOptions::full());
///
/// // Custom configuration
/// let options = ExplainOptions {
///     logical: true,
///     optimized: true,
///     physical: true,
///     decode_plan: true,
///     costs: true,
/// };
/// let output = arbor.explain_with(options);
/// ```
#[derive(Debug, Clone)]
pub struct ExplainOptions {
    /// Include logical plan section.
    pub logical: bool,
    /// Include optimized plan section.
    pub optimized: bool,
    /// Include physical plan section (execution strategy).
    pub physical: bool,
    /// Include DecodePlan summary section.
    pub decode_plan: bool,
    /// Include estimated costs section.
    pub costs: bool,
}

impl Default for ExplainOptions {
    fn default() -> Self {
        Self {
            logical: true,
            optimized: true,
            physical: false,  // Off by default per spec
            decode_plan: true,
            costs: false,
        }
    }
}

impl ExplainOptions {
    /// Create options with costs enabled.
    pub fn with_costs() -> Self {
        Self {
            costs: true,
            ..Self::default()
        }
    }

    /// Create options with all sections enabled.
    pub fn full() -> Self {
        Self {
            logical: true,
            optimized: true,
            physical: true,
            decode_plan: true,
            costs: true,
        }
    }

    /// Create options with physical plan enabled.
    pub fn with_physical() -> Self {
        Self {
            physical: true,
            ..Self::default()
        }
    }
}
```

**Checklist:**
- [ ] Update `ExplainOptions` struct with section flags
- [ ] Implement `Default` with correct defaults (physical off)
- [ ] Add `full()`, `with_physical()` constructors
- [ ] Update `explain_with()` to respect all section flags
- [ ] Update any affected tests to use new API
- [ ] Verify: `cargo build -p arbors`
- [ ] Verify: `cargo test -p arbors explain`

**Gate B Impact:** May require test updates (no external users, so breaking changes are fine)

---

### Sub-Step 11.2: Add Physical Plan Formatting

**Goal:** Create physical plan representation showing execution strategy details.

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`
- POSSIBLY NEW: `crates/arbors-pipeline/src/physical_explain.rs`

**Design Notes:**

Physical plan details include:
- Index representation (Range, Sparse, Permuted)
- Operator selection (vectorized vs interpreted)
- Batch grouping strategy
- Restore-order behavior (for sort observation)

**Code Sketch:**

```rust
// In handle.rs or a new physical_explain.rs module

/// Format physical execution plan for explain output.
///
/// Shows execution strategy details that are normally hidden:
/// - Index representation choice (Range/Sparse/Permuted)
/// - Operator selection (vectorized vs interpreted)
/// - Batch grouping and restore-order behavior
fn format_physical_plan(
    optimized: &LogicalPlan,
    schema: Option<&SchemaRegistry>,
    source_cardinality: Option<usize>,
    output: &mut String,
) {
    output.push_str("Physical Plan:\n");

    // Index representation
    let index_repr = infer_index_representation(optimized);
    output.push_str(&format!("  Index representation: {}\n", index_repr));

    // Operator selection
    if let Some(has_filter) = has_filter_operation(optimized) {
        let vectorized = would_use_vectorized(
            source_cardinality.unwrap_or(1000),
            schema,
            &has_filter.predicate,
        );
        output.push_str(&format!(
            "  Filter execution: {}\n",
            if vectorized { "vectorized" } else { "interpreted" }
        ));
    }

    // Batch grouping for sort operations
    if has_sort_operation(optimized) {
        output.push_str("  Sort strategy: full-scan with restore-order\n");
    }

    // TopK optimization
    if let Some(k) = has_topk_operation(optimized) {
        output.push_str(&format!("  TopK optimization: heap-based (k={})\n", k));
    }
}

/// Infer index representation from plan structure.
fn infer_index_representation(plan: &LogicalPlan) -> &'static str {
    match plan {
        LogicalPlan::Head { .. } | LogicalPlan::Tail { .. } => "Range",
        LogicalPlan::Take { indices, .. } if is_contiguous(indices) => "Range",
        LogicalPlan::Take { .. } => "Sparse",
        LogicalPlan::Sort { .. } | LogicalPlan::Shuffle { .. } => "Permuted",
        LogicalPlan::TopK { .. } => "Sparse (heap result)",
        LogicalPlan::Filter { .. } => "Sparse (matching indices)",
        _ => "Full",
    }
}
```

**Checklist:**
- [ ] Add `format_physical_plan()` function
- [ ] Add helper functions for plan introspection
- [ ] Update `explain_with()` to include physical section when `options.physical`
- [ ] Add unit tests for physical plan formatting
- [ ] Verify: `cargo test -p arbors physical`

**Gate B Impact:** Addition only - no impact on existing behavior

---

### Sub-Step 11.3: Create AnalyzeOptions and ExecutionStats Structures

**Goal:** Define the data structures for `explain_analyze()` execution bounds and observed stats.

**Note:** `max_batches` is **deferred** to future work. Only `max_trees` (strict) and `time_budget_ms` (best-effort) are implemented.

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`

**Code Sketch:**

```rust
/// Options for explain_analyze() execution bounds.
///
/// Controls how much of the query is executed to collect statistics.
/// If all bounds are `None`, the full query is executed.
///
/// # Bounded Execution
///
/// Use bounds to limit execution for large datasets:
///
/// ```rust,ignore
/// let options = AnalyzeOptions {
///     max_trees: Some(1000),   // Stop after 1000 trees (strict)
///     time_budget_ms: Some(500), // Stop after 500ms (best-effort)
/// };
/// let output = arbor.explain_analyze_with(explain_opts, options);
/// ```
///
/// The output will indicate whether stats are partial or complete.
///
/// # Bound Semantics
///
/// - `max_trees`: **Strict** - stops exactly after N trees are emitted
/// - `time_budget_ms`: **Best-effort** - checked between yielded trees, may slightly overshoot.
///   **For plans with global pre-pass (sort_by, shuffle, group_by), `time_budget_ms` may not
///   be observed until after that pre-pass completes.**
///
/// # Important: Bounds Limit Emission, Not Upstream Work
///
/// Bounds control how many trees are **yielded**, not how much work the plan does
/// before yielding. Plans with global operations (sort_by, shuffle, group_by) may
/// still perform substantial work before the first tree is emitted:
///
/// - `sort_by()` must build the full permutation before yielding tree #1
/// - `group_by()` may need to scan all data to group by key
///
/// So `explain_analyze(max_trees=10)` on a sorted arbor is NOT necessarily cheap -
/// it still does the full sort, then yields only 10 trees.
///
/// # Future Work
///
/// `max_batches` is not yet supported. Enforcing batch limits requires deeper
/// executor integration. For now, use `max_trees` as the primary bound.
#[derive(Debug, Clone, Default)]
pub struct AnalyzeOptions {
    /// Maximum number of trees to process (strict bound).
    pub max_trees: Option<usize>,
    /// Maximum execution time in milliseconds (best-effort, may overshoot).
    pub time_budget_ms: Option<u64>,
}

impl AnalyzeOptions {
    /// Unbounded execution (process all data).
    pub fn unbounded() -> Self {
        Self::default()
    }

    /// Limit to first N trees (strict).
    pub fn first_trees(n: usize) -> Self {
        Self {
            max_trees: Some(n),
            ..Self::default()
        }
    }

    /// Limit execution to N milliseconds (best-effort).
    pub fn with_time_budget(ms: u64) -> Self {
        Self {
            time_budget_ms: Some(ms),
            ..Self::default()
        }
    }
}

/// Observed execution statistics from explain_analyze().
///
/// These stats are collected during actual query execution via ArborStoreStats
/// delta measurement. When bounds are applied, `is_partial` will be true.
///
/// # Best-Effort Stats
///
/// Stats come from global counters. In concurrent scenarios, other work may
/// affect measurements. Use for debugging, not precise measurement.
///
/// # Future Work
///
/// `trees_scanned` (evaluated against predicates) requires per-execution
/// executor stats, which is deferred. Currently we only track `trees_returned`.
#[derive(Debug, Clone)]
pub struct ExecutionStats {
    /// Whether these stats represent partial execution.
    pub is_partial: bool,
    /// Number of batches decoded during execution.
    pub batches_decoded: u64,
    /// Number of trees returned in the result.
    pub trees_returned: u64,
    /// Number of batches skipped due to early exit.
    pub early_exit_batches_skipped: u64,
    /// Number of pools decoded (projection pushdown metric).
    pub pools_decoded: u64,
    /// Number of pools skipped due to projection pushdown.
    pub pools_skipped: u64,
    /// Number of materialize() calls.
    pub materialize_calls: u64,
    /// Execution time in milliseconds.
    pub execution_time_ms: u64,
}

impl ExecutionStats {
    /// Create stats from ArborStoreStats delta.
    fn from_delta(
        before: ArborStoreStats,
        after: ArborStoreStats,
        trees_returned: usize,
        is_partial: bool,
        execution_time_ms: u64,
    ) -> Self {
        Self {
            is_partial,
            batches_decoded: after.batches_decoded.saturating_sub(before.batches_decoded),
            trees_returned: trees_returned as u64,
            early_exit_batches_skipped: after.early_exit_batches_skipped
                .saturating_sub(before.early_exit_batches_skipped),
            pools_decoded: after.pools_decoded.saturating_sub(before.pools_decoded),
            pools_skipped: after.pools_skipped.saturating_sub(before.pools_skipped),
            materialize_calls: after.materialize_calls.saturating_sub(before.materialize_calls),
            execution_time_ms,
        }
    }

    /// Format for display in explain output.
    pub fn format(&self, output: &mut String) {
        output.push_str("Observed Stats:\n");
        if self.is_partial {
            output.push_str("  (PARTIAL - execution was bounded)\n");
        }
        output.push_str(&format!("  batches_decoded: {}\n", self.batches_decoded));
        output.push_str(&format!("  trees_returned: {}\n", self.trees_returned));
        output.push_str(&format!("  early_exit_batches_skipped: {}\n", self.early_exit_batches_skipped));
        output.push_str(&format!("  pools_decoded: {}\n", self.pools_decoded));
        output.push_str(&format!("  pools_skipped: {}\n", self.pools_skipped));
        output.push_str(&format!("  materialize_calls: {}\n", self.materialize_calls));
        output.push_str(&format!("  execution_time_ms: {}\n", self.execution_time_ms));
    }
}
```

**Checklist:**
- [ ] Add `AnalyzeOptions` struct with bounds
- [ ] Add `ExecutionStats` struct with observed metrics
- [ ] Add `from_delta()` constructor for ArborStoreStats conversion
- [ ] Add `format()` method for explain output
- [ ] Verify: `cargo build -p arbors`

**Gate B Impact:** Addition only

---

### Sub-Step 11.4: Implement explain_analyze() in Rust

**Goal:** Add `explain_analyze()` and `explain_analyze_with()` methods that execute the query and collect stats.

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`

**Code Sketch:**

```rust
impl Arbor {
    /// Explain the query plan with observed execution statistics.
    ///
    /// This method EXECUTES the query (or a bounded portion of it) to collect
    /// actual performance metrics. Use `explain()` for static plan inspection.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let output = arbor.filter(&pred, mode)?.head(10)?.explain_analyze();
    /// // Output includes:
    /// // - Logical/Optimized plans (as explain())
    /// // - Observed Stats: batches_decoded, trees_returned, etc.
    /// ```
    ///
    /// # Note on Global Counters
    ///
    /// Observed stats use `arborbase_stats()` delta measurement. In concurrent
    /// scenarios, other work may affect the counters. The stats are best-effort.
    pub fn explain_analyze(&self) -> String {
        self.explain_analyze_with(ExplainOptions::default(), AnalyzeOptions::default())
    }

    /// Explain with observed statistics and custom options.
    ///
    /// # Arguments
    ///
    /// * `explain_opts` - Controls which sections appear in output
    /// * `analyze_opts` - Bounds for execution (max_batches, max_trees, etc.)
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let explain_opts = ExplainOptions::full();
    /// let analyze_opts = AnalyzeOptions::first_trees(100);
    /// let output = arbor.explain_analyze_with(explain_opts, analyze_opts);
    /// // Shows full plan info + stats from first 100 trees
    /// ```
    pub fn explain_analyze_with(
        &self,
        explain_opts: ExplainOptions,
        analyze_opts: AnalyzeOptions,
    ) -> String {
        use std::time::Instant;

        // First, get the static plan output
        let mut output = self.explain_with(explain_opts);

        // Snapshot stats before execution
        let stats_before = arbors_base::arborbase_stats();
        let start_time = Instant::now();

        // Execute the query with bounds
        let (trees_returned, is_partial) = self.execute_with_bounds(&analyze_opts);

        // Snapshot stats after execution
        let stats_after = arbors_base::arborbase_stats();
        let execution_time_ms = start_time.elapsed().as_millis() as u64;

        // Compute delta and format
        let exec_stats = ExecutionStats::from_delta(
            stats_before,
            stats_after,
            trees_returned,
            is_partial,
            execution_time_ms,
        );

        output.push('\n');
        exec_stats.format(&mut output);

        output
    }

    /// Execute the query with optional bounds, returning (trees_returned, is_partial).
    ///
    /// Bounds:
    /// - `max_trees`: strict - stops exactly after N trees
    /// - `time_budget_ms`: best-effort - checks after each tree, may slightly overshoot
    fn execute_with_bounds(&self, opts: &AnalyzeOptions) -> (usize, bool) {
        let mut count = 0;
        let start_time = std::time::Instant::now();

        for tree in self.iter() {
            match tree {
                Ok(_) => count += 1,
                Err(_) => break,
            }

            // Check tree limit (strict)
            if let Some(max) = opts.max_trees {
                if count >= max {
                    return (count, true);
                }
            }

            // Check time limit (best-effort - may overshoot slightly)
            if let Some(budget_ms) = opts.time_budget_ms {
                if start_time.elapsed().as_millis() as u64 >= budget_ms {
                    return (count, true);
                }
            }
        }

        (count, false)
    }
}
```

**Checklist:**
- [ ] Add `explain_analyze()` method
- [ ] Add `explain_analyze_with()` method with options
- [ ] Add `execute_with_bounds()` helper
- [ ] Handle ArborStoreStats delta measurement
- [ ] Add timing measurement
- [ ] Document best-effort nature of global counters
- [ ] Add unit tests for explain_analyze
- [ ] Verify: `cargo test -p arbors explain_analyze`

**Gate B Impact:** Addition only - new API

---

### Sub-Step 11.5: Update explain_with() Section Handling

**Goal:** Update `explain_with()` to respect all section flags.

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`

**Code Changes:**

```rust
impl Arbor {
    pub fn explain_with(&self, options: ExplainOptions) -> String {
        let optimized = optimize_logical_plan(&self.plan);

        // Extract schema and metadata from plan
        let schema = get_schema_from_plan(&self.plan);
        let (source_cardinality, batch_count) = get_source_metadata(&self.plan, &self.scope);

        // Compute DecodePlan summary with cost estimation
        let decode_summary = analyze_with_cost(
            &optimized,
            schema,
            source_cardinality,
            batch_count,
        );

        let mut output = String::new();

        // Logical plan section (if requested)
        if options.logical {
            output.push_str("Logical Plan:\n");
            format_plan(&self.plan, 1, &mut output);
            output.push('\n');
        }

        // Optimized plan section (if requested)
        if options.optimized {
            output.push_str("Optimized Plan:\n");
            format_plan(&optimized, 1, &mut output);
            output.push('\n');
        }

        // Physical plan section (if requested - OFF by default)
        if options.physical {
            format_physical_plan(&optimized, schema, source_cardinality, &mut output);
            output.push('\n');
        }

        // DecodePlan summary section (if requested)
        if options.decode_plan {
            output.push_str("DecodePlan Summary:\n");
            format_decode_summary(&decode_summary, &mut output);
            output.push('\n');

            // Early termination hints (part of decode plan context)
            let limit_hints = collect_limit_hints(&optimized);
            output.push_str("Early Termination:\n");
            if limit_hints.is_empty() {
                output.push_str("  (none)\n");
            } else {
                for hint in &limit_hints {
                    output.push_str(&format!("  Filter with limit={}\n", hint));
                }
            }
        }

        // Estimated costs section (if requested)
        if options.costs {
            output.push('\n');
            output.push_str("Estimated Costs:\n");
            if let Some(cost) = &decode_summary.estimated_cost {
                output.push_str(&format!("  cardinality: {}\n", cost.display_cardinality()));
                output.push_str(&format!("  io_cost: {}\n", cost.display_io_cost()));
                output.push_str(&format!("  cpu_cost: {:.1}\n", cost.cpu_cost));
                match cost.total() {
                    Some(t) => output.push_str(&format!("  total_cost: {:.1}\n", t)),
                    None => output.push_str("  total_cost: unknown\n"),
                }
            } else {
                output.push_str("  (not available)\n");
            }
        }

        output
    }
}
```

**Checklist:**
- [ ] Update `explain_with()` to check all section flags
- [ ] Move early termination hints under decode_plan section
- [ ] Add tests for each section flag combination
- [ ] Update any affected tests
- [ ] Verify: `cargo test -p arbors explain`

**Gate B Impact:** May require test updates

---

### Sub-Step 11.6: Add Python explain() Keyword Arguments

**Goal:** Extend Python `explain()` to support all section flags.

**Files:**
- MODIFY: `python/src/lib.rs`

**Code Changes:**

```rust
// In python/src/lib.rs, update the Arbor impl

/// Explain the query plan.
///
/// Shows the logical plan, optimized plan, and execution details.
/// Use keyword arguments to control which sections appear.
///
/// Args:
///     logical: Include logical plan section (default: True)
///     optimized: Include optimized plan section (default: True)
///     physical: Include physical plan section (default: False)
///     decode_plan: Include DecodePlan summary (default: True)
///     costs: Include estimated costs section (default: False)
///
/// Returns:
///     Human-readable string showing the query plan
///
/// Example:
///     >>> arbor.filter(path("age") > lit(30)).head(10).explain()
///     Logical Plan:
///       Head(10)
///         Filter(pred=..., mode=Immediate)
///           InMemory
///     ...
///
///     >>> # Include cost estimates
///     >>> print(top10.explain(costs=True))
///     ...
///     Estimated Costs:
///       cardinality: 100.0
///       io_cost: 0.0
///       cpu_cost: 15.0
///       total_cost: 15.0
///
///     >>> # Include physical plan
///     >>> print(top10.explain(physical=True))
///     ...
///     Physical Plan:
///       Index representation: Sparse
///       Filter execution: vectorized
#[pyo3(signature = (*, logical=true, optimized=true, physical=false, decode_plan=true, costs=false))]
fn explain(
    &self,
    logical: bool,
    optimized: bool,
    physical: bool,
    decode_plan: bool,
    costs: bool,
) -> String {
    let options = ExplainOptions {
        logical,
        optimized,
        physical,
        decode_plan,
        costs,
    };
    self.inner.explain_with(options)
}
```

**Checklist:**
- [ ] Update Python `explain()` signature with all kwargs
- [ ] Map kwargs to `ExplainOptions` struct
- [ ] Update docstring with examples
- [ ] Update `.pyi` type stubs
- [ ] Add Python test for each kwarg
- [ ] Update any affected tests
- [ ] Verify: `make python && .venv/bin/pytest python/tests -v -k explain`

**Gate B Impact:** May require test updates

---

### Sub-Step 11.7: Add Python explain_analyze()

**Goal:** Expose `explain_analyze()` to Python with bounded execution support.

**Files:**
- MODIFY: `python/src/lib.rs`

**Code Changes:**

```rust
/// Explain the query plan with observed execution statistics.
///
/// This method EXECUTES the query (or a bounded portion) to collect
/// actual performance metrics. Use `explain()` for static plan inspection.
///
/// Args:
///     logical: Include logical plan section (default: True)
///     optimized: Include optimized plan section (default: True)
///     physical: Include physical plan section (default: False)
///     decode_plan: Include DecodePlan summary (default: True)
///     costs: Include estimated costs section (default: False)
///     max_trees: Maximum trees to process (None = unlimited, strict)
///     time_budget_ms: Maximum execution time in ms (None = unlimited, best-effort)
///
/// Returns:
///     Human-readable string showing plan and observed statistics
///
/// Example:
///     >>> arbor.filter(pred).head(100).explain_analyze()
///     Logical Plan:
///       ...
///     Observed Stats:
///       batches_decoded: 3
///       trees_returned: 100
///       ...
///
///     >>> # Bounded execution
///     >>> arbor.explain_analyze(max_trees=50)
///     ...
///     Observed Stats:
///       (PARTIAL - execution was bounded)
///       trees_returned: 50
///       ...
///
/// Note:
///     Observed stats use global counter deltas. In concurrent scenarios,
///     other work may affect the measurements. Stats are best-effort.
#[pyo3(signature = (
    *,
    logical=true,
    optimized=true,
    physical=false,
    decode_plan=true,
    costs=false,
    max_trees=None,
    time_budget_ms=None
))]
fn explain_analyze(
    &self,
    logical: bool,
    optimized: bool,
    physical: bool,
    decode_plan: bool,
    costs: bool,
    max_trees: Option<usize>,
    time_budget_ms: Option<u64>,
) -> String {
    let explain_opts = ExplainOptions {
        logical,
        optimized,
        physical,
        decode_plan,
        costs,
    };
    let analyze_opts = AnalyzeOptions {
        max_trees,
        time_budget_ms,
    };
    self.inner.explain_analyze_with(explain_opts, analyze_opts)
}
```

**Checklist:**
- [ ] Add `explain_analyze()` method to Python Arbor
- [ ] Map all kwargs to Rust options structs
- [ ] Document bounded execution and partial stats
- [ ] Document best-effort nature of global counters
- [ ] Update `.pyi` type stubs
- [ ] Add Python tests for explain_analyze
- [ ] Add Python test for bounded execution
- [ ] Verify: `make python && .venv/bin/pytest python/tests -v -k explain_analyze`

**Gate B Impact:** Addition only - new API

---

### Sub-Step 11.8: Export Types from arbors Crate

**Goal:** Export `ExplainOptions`, `AnalyzeOptions`, and `ExecutionStats` from the public API.

**Files:**
- MODIFY: `crates/arbors/src/lib.rs`

**Code Changes:**

```rust
// Add to existing pub use handle block
pub use handle::{
    Arbor, ArborIter, ExplainOptions, AnalyzeOptions, ExecutionStats,
    FilterMode, GroupedArbor, IndexedArbor, OwnedArborIter,
    PlanBasedIter, SortKeySpec,
};
```

**Checklist:**
- [ ] Export `AnalyzeOptions` from `handle.rs`
- [ ] Export `ExecutionStats` from `handle.rs`
- [ ] Verify exports compile: `cargo build -p arbors`
- [ ] Verify documentation: `cargo doc -p arbors`

**Gate B Impact:** Addition only

---

### Sub-Step 11.9: Add Integration Tests

**Goal:** Verify observability features work correctly across scenarios.

**Files:**
- NEW: `crates/arbors/tests/integration/observability_tests.rs`
- MODIFY: `crates/arbors/tests/main.rs` (add module)

**Test Categories:**

```rust
//! Observability tests for explain() and explain_analyze().
//!
//! These tests verify:
//! 1. explain() section flags work correctly
//! 2. explain_analyze() collects observed stats
//! 3. Bounded execution respects limits
//! 4. Output format matches specification

use arbors::{Arbor, ExplainOptions, AnalyzeOptions, FilterMode};
use arbors::expr::{lit, path};
use arbors_base::ArborStoreOptions;

// ============================================================================
// explain() Section Tests
// ============================================================================

#[test]
fn test_explain_default_sections() {
    let data = br#"{"id": 1, "age": 25}"#;
    let inmemory = arbors::read_jsonl(data, None).unwrap();
    let arbor = Arbor::from_inmemory(inmemory);

    let output = arbor.explain();

    // Default: logical + optimized + decode_plan
    assert!(output.contains("Logical Plan:"), "Should include logical plan");
    assert!(output.contains("Optimized Plan:"), "Should include optimized plan");
    assert!(output.contains("DecodePlan Summary:"), "Should include decode plan");

    // Off by default: physical, costs
    assert!(!output.contains("Physical Plan:"), "Should NOT include physical by default");
    assert!(!output.contains("Estimated Costs:"), "Should NOT include costs by default");
}

#[test]
fn test_explain_with_physical() {
    let data = br#"{"id": 1}"#;
    let inmemory = arbors::read_jsonl(data, None).unwrap();
    let arbor = Arbor::from_inmemory(inmemory);

    let output = arbor.explain_with(ExplainOptions::with_physical());

    assert!(output.contains("Physical Plan:"), "Should include physical plan");
    assert!(output.contains("Index representation:"), "Should show index type");
}

#[test]
fn test_explain_full() {
    let data = br#"{"id": 1}"#;
    let inmemory = arbors::read_jsonl(data, None).unwrap();
    let arbor = Arbor::from_inmemory(inmemory);

    let output = arbor.explain_with(ExplainOptions::full());

    // All sections should be present
    assert!(output.contains("Logical Plan:"));
    assert!(output.contains("Optimized Plan:"));
    assert!(output.contains("Physical Plan:"));
    assert!(output.contains("DecodePlan Summary:"));
    assert!(output.contains("Estimated Costs:"));
}

#[test]
fn test_explain_custom_sections() {
    let data = br#"{"id": 1}"#;
    let inmemory = arbors::read_jsonl(data, None).unwrap();
    let arbor = Arbor::from_inmemory(inmemory);

    // Only logical
    let opts = ExplainOptions {
        logical: true,
        optimized: false,
        physical: false,
        decode_plan: false,
        costs: false,
    };
    let output = arbor.explain_with(opts);

    assert!(output.contains("Logical Plan:"));
    assert!(!output.contains("Optimized Plan:"));
    assert!(!output.contains("DecodePlan Summary:"));
}

// ============================================================================
// explain_analyze() Tests
// ============================================================================

#[test]
fn test_explain_analyze_includes_stats() {
    let data = br#"{"id": 1}
{"id": 2}
{"id": 3}"#;
    let inmemory = arbors::read_jsonl(data, None).unwrap();
    let arbor = Arbor::from_inmemory(inmemory);

    let output = arbor.explain_analyze();

    assert!(output.contains("Observed Stats:"), "Should include observed stats");
    assert!(output.contains("trees_returned:"), "Should show trees returned");
    assert!(output.contains("execution_time_ms:"), "Should show execution time");
}

#[test]
fn test_explain_analyze_bounded() {
    let data = br#"{"id": 1}
{"id": 2}
{"id": 3}
{"id": 4}
{"id": 5}"#;
    let inmemory = arbors::read_jsonl(data, None).unwrap();
    let arbor = Arbor::from_inmemory(inmemory);

    let output = arbor.explain_analyze_with(
        ExplainOptions::default(),
        AnalyzeOptions::first_trees(2),
    );

    assert!(output.contains("(PARTIAL"), "Should indicate partial execution");
    assert!(output.contains("trees_returned: 2"), "Should return only 2 trees");
}

// ============================================================================
// Stored Arbor Tests (with batches)
// ============================================================================

use serial_test::serial;

/// Test explain_analyze on stored arbor tracks batches.
///
/// Uses `#[serial]` because ArborStoreStats are global counters.
/// Only asserts format presence, not exact values (concurrent tests could affect counts).
#[test]
#[serial]
fn test_explain_analyze_stored_batches() {
    use arbors::Session;
    use std::sync::Arc;
    use tempfile::tempdir;

    let dir = tempdir().unwrap();
    let path = dir.path().join("test.arbors");

    // Create multi-batch stored arbor
    let data = (0..100).map(|i| format!(r#"{{"id": {}}}"#, i)).collect::<Vec<_>>().join("\n");
    let inmemory = arbors::read_jsonl(data.as_bytes(), None).unwrap();

    // Use Session API (correct for this codebase)
    let session = Arc::new(Session::open(&path).unwrap());
    {
        let mut scope = session.write().unwrap();
        scope.put("test", &inmemory, None).unwrap();
        scope.commit().unwrap();
    }

    session.refresh().unwrap();
    let stored = session.arbor("test").unwrap();

    let output = stored.explain_analyze();

    // Only assert format presence, not exact values
    assert!(output.contains("batches_decoded:"), "Should show batches_decoded field");
    assert!(output.contains("trees_returned:"), "Should show trees_returned field");
}
```

**Checklist:**
- [ ] Create `observability_tests.rs`
- [ ] Add to `main.rs` module declarations
- [ ] Add section flag tests
- [ ] Add explain_analyze tests
- [ ] Add bounded execution tests
- [ ] Add stored arbor tests with batch tracking
- [ ] Verify: `cargo test -p arbors observability`

**Gate B Impact:** Tests only

---

### Sub-Step 11.10: Add Python Integration Tests

**Goal:** Verify Python observability API works correctly.

**Files:**
- NEW: `python/tests/test_observability.py`

**Test File:**

```python
"""Tests for explain() and explain_analyze() observability features."""

import arbors
from arbors import path, lit
import tempfile
import os


class TestExplainSections:
    """Test explain() section control."""

    def test_explain_default(self):
        """Default explain() includes logical, optimized, decode_plan."""
        data = b'{"id": 1, "age": 25}'
        arbor = arbors.read_jsonl(data)

        output = arbor.explain()

        assert "Logical Plan:" in output
        assert "Optimized Plan:" in output
        assert "DecodePlan Summary:" in output
        assert "Physical Plan:" not in output  # Off by default
        assert "Estimated Costs:" not in output  # Off by default

    def test_explain_with_costs(self):
        """explain(costs=True) includes cost estimates."""
        data = b'{"id": 1}'
        arbor = arbors.read_jsonl(data)

        output = arbor.explain(costs=True)

        assert "Estimated Costs:" in output
        assert "cardinality:" in output

    def test_explain_with_physical(self):
        """explain(physical=True) includes physical plan."""
        data = b'{"id": 1}'
        arbor = arbors.read_jsonl(data)

        output = arbor.explain(physical=True)

        assert "Physical Plan:" in output
        assert "Index representation:" in output

    def test_explain_custom_sections(self):
        """Custom section flags work correctly."""
        data = b'{"id": 1}'
        arbor = arbors.read_jsonl(data)

        # Only logical
        output = arbor.explain(logical=True, optimized=False, decode_plan=False)

        assert "Logical Plan:" in output
        assert "Optimized Plan:" not in output
        assert "DecodePlan Summary:" not in output


class TestExplainAnalyze:
    """Test explain_analyze() observed statistics."""

    def test_explain_analyze_includes_stats(self):
        """explain_analyze() includes observed stats."""
        data = b'{"id": 1}\n{"id": 2}\n{"id": 3}'
        arbor = arbors.read_jsonl(data)

        output = arbor.explain_analyze()

        assert "Observed Stats:" in output
        assert "trees_returned:" in output
        assert "execution_time_ms:" in output

    def test_explain_analyze_bounded_trees(self):
        """explain_analyze(max_trees=N) limits execution."""
        data = "\n".join([f'{{"id": {i}}}' for i in range(10)]).encode()
        arbor = arbors.read_jsonl(data)

        output = arbor.explain_analyze(max_trees=3)

        assert "(PARTIAL" in output
        assert "trees_returned: 3" in output

    def test_explain_analyze_with_filter(self):
        """explain_analyze() on filtered arbor shows stats."""
        data = "\n".join([f'{{"id": {i}, "age": {20 + i}}}' for i in range(10)]).encode()
        arbor = arbors.read_jsonl(data)

        filtered = arbor.filter(path("age") > lit(25))
        output = filtered.explain_analyze()

        assert "Observed Stats:" in output
        assert "trees_returned:" in output


class TestExplainAnalyzeStored:
    """Test explain_analyze() with stored arbors."""

    def test_explain_analyze_stored_batches(self):
        """explain_analyze() on stored arbor tracks batches."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path_db = os.path.join(tmpdir, "test.arbors")

            # Create multi-batch stored arbor
            data = "\n".join([f'{{"id": {i}}}' for i in range(100)]).encode()
            inmemory = arbors.read_jsonl(data)

            # Use ArborStore.open() - the correct Python API
            db = arbors.ArborStore.open(path_db)
            with db.write() as tx:
                tx.put("test", inmemory)
                tx.commit()

            db.refresh()
            stored = db["test"]

            output = stored.explain_analyze()

            # Only assert format, not exact values (global counters)
            assert "batches_decoded:" in output
            assert "trees_returned:" in output

    def test_explain_analyze_stored_bounded(self):
        """Bounded explain_analyze() on stored arbor."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path_db = os.path.join(tmpdir, "test.arbors")

            data = "\n".join([f'{{"id": {i}}}' for i in range(100)]).encode()
            inmemory = arbors.read_jsonl(data)

            db = arbors.ArborStore.open(path_db)
            with db.write() as tx:
                tx.put("test", inmemory)
                tx.commit()

            db.refresh()
            stored = db["test"]

            output = stored.explain_analyze(max_trees=10)

            assert "(PARTIAL" in output
            assert "trees_returned: 10" in output
```

**Checklist:**
- [ ] Create `python/tests/test_observability.py`
- [ ] Add section flag tests
- [ ] Add explain_analyze tests
- [ ] Add bounded execution tests
- [ ] Add stored arbor tests
- [ ] Verify: `make python && .venv/bin/pytest python/tests/test_observability.py -v`

**Gate B Impact:** Tests only

---

### Sub-Step 11.11: Update Type Stubs

**Goal:** Update Python type stubs for new observability API.

**Files:**
- MODIFY: `python/arbors/_arbors.pyi`

**Code Changes:**

```python
# Add to Arbor class in _arbors.pyi

def explain(
    self,
    *,
    logical: bool = True,
    optimized: bool = True,
    physical: bool = False,
    decode_plan: bool = True,
    costs: bool = False,
) -> str:
    """Explain the query plan.

    Args:
        logical: Include logical plan section
        optimized: Include optimized plan section
        physical: Include physical plan section
        decode_plan: Include DecodePlan summary
        costs: Include estimated costs section

    Returns:
        Human-readable string showing the query plan
    """
    ...

def explain_analyze(
    self,
    *,
    logical: bool = True,
    optimized: bool = True,
    physical: bool = False,
    decode_plan: bool = True,
    costs: bool = False,
    max_trees: int | None = None,
    time_budget_ms: int | None = None,
) -> str:
    """Explain the query plan with observed execution statistics.

    This method EXECUTES the query to collect performance metrics.

    Args:
        logical: Include logical plan section
        optimized: Include optimized plan section
        physical: Include physical plan section
        decode_plan: Include DecodePlan summary
        costs: Include estimated costs section
        max_trees: Maximum trees to process (None = unlimited, strict)
        time_budget_ms: Maximum execution time in ms (None = unlimited, best-effort)

    Returns:
        Human-readable string with plan and observed statistics
    """
    ...
```

**Checklist:**
- [ ] Update `explain()` signature in `.pyi`
- [ ] Add `explain_analyze()` to `.pyi`
- [ ] Run mypy check if available
- [ ] Verify: `make python`

**Gate B Impact:** None (type hints only)

---

### Sub-Step 11.12: Documentation and FIXME Resolution

**Goal:** Resolve Step 11 FIXMEs and add documentation.

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`

**FIXME Resolution Table:**

| File | Line | Current | Resolution |
|------|------|---------|------------|
| `handle.rs:248` | REFACTOR FIXME(Step 11) | Add analyze: bool | RESOLVED - full ExplainOptions with section flags |
| `handle.rs:1711` | REFACTOR FIXME(Step 11) | Finalize API surface | RESOLVED - explain/explain_analyze implemented |
| `handle.rs:1761` | REFACTOR FIXME(Step 11) | Add explain_analyze() | RESOLVED - implemented with AnalyzeOptions |

**Documentation to Add:**

```rust
// Module-level documentation for observability API

/// # Query Plan Observability
///
/// The arbors API provides two methods for understanding query execution:
///
/// ## `explain()` - Static Plan Inspection
///
/// Shows the query plan without executing it:
/// - **Logical Plan**: Plan as constructed by API calls
/// - **Optimized Plan**: Plan after optimization rules (fusion, pushdown)
/// - **Physical Plan** (optional): Execution strategy details
/// - **DecodePlan Summary**: Pool projection for efficient decoding
/// - **Estimated Costs** (optional): Heuristic cost model estimates
///
/// ```rust,ignore
/// // Default output
/// let output = arbor.filter(&pred, mode)?.head(10)?.explain();
///
/// // With all sections
/// let output = arbor.explain_with(ExplainOptions::full());
/// ```
///
/// ## `explain_analyze()` - Observed Statistics
///
/// Executes the query and reports actual performance metrics:
/// - Batches decoded
/// - Trees returned
/// - Early-exit effectiveness
/// - Execution time
///
/// ```rust,ignore
/// // Full execution
/// let output = arbor.explain_analyze();
///
/// // Bounded execution (first 10 trees)
/// let output = arbor.explain_analyze_with(
///     ExplainOptions::default(),
///     AnalyzeOptions::first_trees(10),
/// );
/// ```
///
/// ## Best-Effort Global Counters
///
/// Observed stats use `arborbase_stats()` delta measurement. In concurrent
/// scenarios, other work may affect the counters. The stats are best-effort
/// and should be used for debugging, not precise measurement.
```

**Checklist:**
- [ ] Remove FIXME comments
- [ ] Add module-level documentation
- [ ] Add rustdoc examples to `explain()` and `explain_analyze()`
- [ ] Verify: `cargo doc -p arbors`

---

### Sub-Step 11.13: Final Verification

**Goal:** Ensure all tests pass and exit criteria are met.

**Commands:**
```bash
cargo test -p arbors --test invariants   # Gate A
cargo test                                # Rust Gate B
make python && .venv/bin/pytest python/tests -v  # Python Gate B
```

**Exit Criteria Checklist:**

- [ ] `explain()` defaults include logical + optimized + DecodePlan (physical OFF)
- [ ] `explain_with(ExplainOptions)` respects all section flags
- [ ] `explain_analyze()` executes and reports observed stats
- [ ] `explain_analyze_with(options, bounds)` supports bounded execution
- [ ] Partial execution clearly indicated in output
- [ ] Python API matches Rust API (thin-layer delegation)
- [ ] Gate A passes (invariants)
- [ ] Rust Gate B passes (full test suite)
- [ ] Python Gate B passes (Python test suite)

**Final Commit:**
```bash
git add -A
git commit -m "Step 11: Observability - parameterized explain() with explain_analyze() for observed stats"
```

---

## Summary of Changes

### New Files

| File | Description |
|------|-------------|
| `crates/arbors/tests/integration/observability_tests.rs` | Rust integration tests |
| `python/tests/test_observability.py` | Python integration tests |

### Modified Files

| File | Changes |
|------|---------|
| `crates/arbors/src/handle.rs` | Extended ExplainOptions, added AnalyzeOptions, ExecutionStats, explain_analyze() |
| `crates/arbors/src/lib.rs` | Export new types |
| `python/src/lib.rs` | Extended explain() kwargs, added explain_analyze() |
| `python/arbors/_arbors.pyi` | Updated type stubs |

### Atomic Pairs

These changes must land together:

1. **ExplainOptions + explain_with()**: Section flags and handling
2. **AnalyzeOptions + ExecutionStats + explain_analyze()**: Observed stats infrastructure
3. **Python explain() + explain_analyze()**: Python API additions

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Global counter noise in concurrent scenarios | Document as best-effort; use `#[serial]` for counter tests |
| Performance overhead from stats collection | Stats collection is O(1) per operation |
| Bounded execution terminates mid-tree | Acceptable; stats indicate partial execution |
| `max_batches` deferred | Use `max_trees` as primary bound; document limitation |

**Note:** No backward compatibility risks - zero external users.

---

## Exit Criteria Verification

| Criterion | How Verified |
|-----------|--------------|
| `explain()` defaults to logical+optimized+DecodePlan | `test_explain_default_sections` |
| Physical plan off by default | Assert "Physical Plan:" not in default output |
| `explain_analyze()` provides observed stats | `test_explain_analyze_includes_stats` |
| Bounded execution works | `test_explain_analyze_bounded` |
| Python API matches Rust | `test_observability.py` mirrors Rust tests |
| Gate A green | `cargo test -p arbors --test invariants` |
| Gate B green | `cargo test` + `pytest` |
