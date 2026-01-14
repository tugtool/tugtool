# Step 8: Cost Model Optimizer - Implementation Plan

## Overview

**Exit Criteria:** Cost model is integrated and surfaced via `explain(ExplainOptions { costs: true })`, with Gate B remaining green.

**Goal**: Simple heuristic-based cost model for better plan selection.

**Scope**: This step introduces cost estimation (NOT statistics collection). The cost model uses heuristics to estimate:
- Cardinality (selectivity) of predicates
- I/O cost for source access
- CPU cost for different execution strategies

**Key Decisions Enabled**:
- Filter ordering (push selective filters first)
- Vectorized vs interpreted execution selection
- When to materialize intermediate results

---

## Policy Decisions

These policy decisions were made during plan review:

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Error semantics** | Optimizer rewrites CAN change which error is observed | Allows FilterSelectivityOrder without "safe predicate" analysis; users accept that AND reordering may change error behavior |
| **Cost model usage** | Optimizer-guiding during execution | Costs are used for rule application and execution strategy selection, not just explain() visibility |
| **Explain API shape** | Extend Rust `explain(options)`, expose to Python | Clean parameterized API for future extensions (Step 11: explain_analyze) |
| **Unknown metadata handling** | Print "unknown" in explain, use conservative defaults internally | No magic fallback numbers like 1000 trees / 10 batches; be explicit about what we don't know |

---

## Current State Analysis

### What Exists (Post-Step 7)

| Component | Status | Location |
|-----------|--------|----------|
| `LogicalPlan` enum | Complete | `arbors-pipeline/src/logical_plan.rs` |
| `optimize_logical_plan()` | Complete | `arbors-pipeline/src/optimize/logical_plan.rs` |
| 5 optimization rules | Complete | FilterFusion, PredicatePushdown, LimitPushdown, LimitFusion, TopKFusion |
| `DecodePlanSummary` | Complete | `arbors-pipeline/src/optimize/analysis.rs` |
| `explain()` method | Complete | `arbors/src/handle.rs` |
| `PhysicalResult` / `IndexSet` | Complete | `arbors-pipeline/src/physical.rs` |
| Sort/TopK/GroupBy/IndexBy | Complete | `arbors-pipeline/src/physical.rs` |

### FIXMEs Referencing Step 8

| File | FIXME | Description |
|------|-------|-------------|
| `handle.rs:1465` | Cost estimation for sort_by | Add estimated cost in explain() |
| `handle.rs:1474` | DecodePlan optimization | Include sort key fields only |
| `physical.rs:691` | Path-based DecodePlan pruning | Minimize decoding for sort keys |
| `physical.rs:1002` | Optimize to key field only | DecodePlan for TopK |
| `physical.rs:1107` | Optimize to key field only | DecodePlan for IndexBy |
| `analysis.rs:14-16` | Cost estimation helpers | Add to analysis module |
| `analysis.rs:42` | Cost model integration | Integrate with DecodePlanSummary |
| `logical_plan.rs:875` | Thread limit through vectorized | Consider vectorized early termination |
| `executor.rs:148` | Thread limit through vectorized | Limit in vectorized path |
| `executor.rs:193` | Step 8 vectorized limit | Sequential vs vectorized decision |

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cost model location | `arbors-pipeline/src/optimize/cost.rs` | Keep with other optimizer code |
| Cardinality estimation | Heuristic-based (no statistics) | Simple first; statistics in future step |
| Cost unit | Abstract "cost units" (not time/bytes) | Relative comparison, not absolute |
| Integration point | Applied at optimization + execution strategy selection | See "Cost Integration Points" below |
| Explain integration | Parameterized `explain(ExplainOptions)` | Extensible for future explain_analyze |
| Unknown metadata | Display "unknown", use conservative internal defaults | Explicit about uncertainty vs magic numbers |

### Cost Integration Points (Step 8 Scope)

The cost model is used in two contexts:

1. **Optimization (rule application):**
   - `FilterSelectivityOrder` uses `estimate_selectivity()` to reorder AND predicates
   - Future rules may use cost estimates to decide whether to apply transformations

2. **Execution strategy selection (Step 8 scope):**
   - `should_use_vectorized()` in executor uses `predicate_complexity()` to decide vectorized vs interpreted
   - **Deferred to future steps:** materialization decisions, streaming vs batch selection

This is the extent of "optimizer-guiding during execution" for Step 8. Additional cost-driven execution decisions (e.g., when to materialize, streaming budget thresholds) are future work.

---

## Implementation Sub-Steps

### Sub-Step 8.1: Create CostModel Infrastructure

**Goal:** Define `CostModel` struct and core estimation functions in a new module.

**Files:**
- NEW: `crates/arbors-pipeline/src/optimize/cost.rs`
- MODIFY: `crates/arbors-pipeline/src/optimize/mod.rs` (add mod + exports)

**Code Sketch:**

```rust
// crates/arbors-pipeline/src/optimize/cost.rs

//! Cost model for query optimization.
//!
//! This module provides heuristic-based cost estimation for LogicalPlan nodes.
//! The cost model enables:
//! - Filter ordering by selectivity (most selective first)
//! - Vectorized vs interpreted execution selection
//!
//! # Design Principles
//!
//! 1. **Heuristic-based**: No runtime statistics collection (yet)
//! 2. **Relative costs**: Units are abstract, used for comparison only
//! 3. **Conservative defaults**: Prefer safe estimates over aggressive guesses
//! 4. **Explicit unknowns**: Unknown metadata shown as "unknown", not magic defaults
//!
//! # Cost Components
//!
//! - **Cardinality**: Estimated number of rows/trees passing through
//! - **IO Cost**: Cost of loading data from storage
//! - **CPU Cost**: Cost of computation (filter evaluation, sorting, etc.)
//!
//! # Error Semantics Note
//!
//! Optimizer rewrites (e.g., FilterSelectivityOrder reordering AND predicates)
//! may change which error is observed for fallible expressions. This is accepted
//! behavior; users should not rely on specific error ordering from ANDed predicates.

use std::sync::Arc;
use arbors_expr::Expr;
use crate::LogicalPlan;

/// Cost estimation result for a plan node.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CostEstimate {
    /// Estimated number of rows/trees at this node.
    /// `None` means cardinality is unknown.
    pub cardinality: Option<f64>,
    /// Estimated I/O cost (batch loads, etc.).
    /// `None` means I/O cost is unknown.
    pub io_cost: Option<f64>,
    /// Estimated CPU cost (filter evaluation, sorting, etc.).
    pub cpu_cost: f64,
}

impl CostEstimate {
    /// Create a new cost estimate with known values.
    pub fn new(cardinality: f64, io_cost: f64, cpu_cost: f64) -> Self {
        Self {
            cardinality: Some(cardinality),
            io_cost: Some(io_cost),
            cpu_cost,
        }
    }

    /// Create a cost estimate with unknown cardinality and IO.
    pub fn unknown_source(cpu_cost: f64) -> Self {
        Self {
            cardinality: None,
            io_cost: None,
            cpu_cost,
        }
    }

    /// Zero cost (for in-memory sources with no computation).
    pub const ZERO: Self = Self {
        cardinality: Some(0.0),
        io_cost: Some(0.0),
        cpu_cost: 0.0,
    };

    /// Total estimated cost (IO + CPU, weighted).
    ///
    /// Returns `None` if IO cost is unknown.
    /// IO cost is typically weighted higher because it involves disk/memory access.
    pub fn total(&self) -> Option<f64> {
        self.io_cost.map(|io| io * IO_WEIGHT + self.cpu_cost * CPU_WEIGHT)
    }

    /// Format for display, showing "unknown" for missing values.
    pub fn display_cardinality(&self) -> String {
        match self.cardinality {
            Some(c) => format!("{:.1}", c),
            None => "unknown".to_string(),
        }
    }

    /// Format IO cost for display.
    pub fn display_io_cost(&self) -> String {
        match self.io_cost {
            Some(c) => format!("{:.1}", c),
            None => "unknown".to_string(),
        }
    }
}

// NOTE: No Default impl - require explicit construction to avoid
// accidentally creating "0 rows, 0 io" when "unknown" was intended.
// Use CostEstimate::new() or CostEstimate::unknown_source() explicitly.

// Cost constants (tunable)
const IO_WEIGHT: f64 = 10.0;      // IO is expensive relative to CPU
const CPU_WEIGHT: f64 = 1.0;      // CPU is relatively cheap
const BATCH_READ_COST: f64 = 1.0; // Cost per batch read
const VECTORIZED_MULTIPLIER: f64 = 0.1; // Vectorized ops are ~10x faster

// Conservative defaults when metadata is unavailable (internal use only).
// IMPORTANT: These defaults are ONLY for internal cost comparisons (e.g., deciding
// vectorized vs interpreted). They must NEVER leak into explain() display - unknown
// metadata must display as "unknown", not these placeholder values.
const DEFAULT_CARDINALITY: f64 = 1000.0;
const DEFAULT_BATCH_COUNT: f64 = 10.0;

/// Heuristic-based cost model for LogicalPlan optimization.
///
/// The cost model provides estimates without runtime statistics.
/// All estimates are heuristic and should be used for relative
/// comparisons, not absolute predictions.
#[derive(Debug, Clone, Default)]
pub struct CostModel {
    /// Optional source cardinality hint (from metadata).
    pub source_cardinality: Option<usize>,
    /// Optional batch count hint (from metadata).
    pub batch_count: Option<usize>,
    /// Whether schema is available (enables vectorized execution).
    pub has_schema: bool,
}

impl CostModel {
    /// Create a new cost model with optional metadata hints.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a cost model with source metadata.
    pub fn with_source_info(
        cardinality: Option<usize>,
        batch_count: Option<usize>,
        has_schema: bool,
    ) -> Self {
        Self {
            source_cardinality: cardinality,
            batch_count,
            has_schema,
        }
    }

    /// Check if source metadata is available.
    pub fn has_source_metadata(&self) -> bool {
        self.source_cardinality.is_some()
    }

    /// Estimate selectivity of a predicate.
    ///
    /// Returns a value in [0.0, 1.0] representing the fraction of rows
    /// expected to pass the predicate.
    ///
    /// # Heuristics
    ///
    /// | Predicate Type | Selectivity |
    /// |----------------|-------------|
    /// | Equality (=)   | 0.1 (10%)   |
    /// | Range (<, >, etc.) | 0.3 (30%) |
    /// | IsNull/IsNotNull | 0.1 (10%) |
    /// | AND            | product of operands |
    /// | OR             | sum - product (union) |
    /// | NOT            | 1 - selectivity |
    /// | Default        | 0.5 (50%)   |
    pub fn estimate_selectivity(&self, predicate: &Expr) -> f64 {
        estimate_selectivity_recursive(predicate)
    }

    /// Estimate cardinality after applying a predicate.
    ///
    /// Returns `None` if input cardinality is unknown.
    /// Note: Result can be 0.0 for always-false predicates.
    pub fn estimate_filter_cardinality(&self, input_cardinality: Option<f64>, predicate: &Expr) -> Option<f64> {
        input_cardinality.map(|card| {
            let selectivity = self.estimate_selectivity(predicate);
            (card * selectivity).max(0.0) // Can be 0 for always-false
        })
    }

    /// Get cardinality for internal cost calculations.
    /// Uses conservative default when unknown.
    fn internal_cardinality(&self) -> f64 {
        self.source_cardinality.map(|c| c as f64).unwrap_or(DEFAULT_CARDINALITY)
    }

    /// Get batch count for internal cost calculations.
    /// Uses conservative default when unknown.
    fn internal_batch_count(&self) -> f64 {
        self.batch_count.map(|b| b as f64).unwrap_or(DEFAULT_BATCH_COUNT)
    }

    /// Estimate I/O cost for a source node.
    ///
    /// - InMemory: 0.0 (already in memory)
    /// - Stored: batch_count * BATCH_READ_COST (None if batch_count unknown)
    pub fn io_cost(&self, plan: &LogicalPlan) -> Option<f64> {
        match plan {
            LogicalPlan::InMemory { .. } => Some(0.0),
            LogicalPlan::Stored { .. } => {
                self.batch_count.map(|b| b as f64 * BATCH_READ_COST)
            }
            _ => Some(0.0), // Non-source nodes don't have direct IO cost
        }
    }

    /// Estimate CPU cost for filter evaluation.
    ///
    /// Cost depends on:
    /// - Cardinality of input
    /// - Complexity of predicate
    /// - Whether vectorized execution is available
    pub fn cpu_cost_filter(&self, input_cardinality: f64, predicate: &Expr) -> f64 {
        let base_cost = input_cardinality * predicate_complexity(predicate);
        if self.has_schema {
            base_cost * VECTORIZED_MULTIPLIER
        } else {
            base_cost
        }
    }

    /// Estimate CPU cost for sorting.
    ///
    /// O(n log n) for full sort.
    pub fn cpu_cost_sort(&self, cardinality: f64, key_count: usize) -> f64 {
        if cardinality <= 1.0 {
            return 0.0;
        }
        // O(n log n) * number of keys
        cardinality * cardinality.log2() * key_count as f64
    }

    /// Estimate CPU cost for TopK.
    ///
    /// O(n log k) using heap-based algorithm.
    pub fn cpu_cost_topk(&self, cardinality: f64, k: usize, key_count: usize) -> f64 {
        if cardinality <= 1.0 || k == 0 {
            return 0.0;
        }
        let k_f64 = (k as f64).max(1.0);
        // O(n log k) * number of keys
        cardinality * k_f64.log2() * key_count as f64
    }

    /// Estimate total cost for a LogicalPlan node.
    ///
    /// This recursively estimates costs for the entire plan tree.
    pub fn estimate_plan_cost(&self, plan: &Arc<LogicalPlan>) -> CostEstimate {
        estimate_plan_cost_recursive(self, plan)
    }
}

/// Recursively estimate selectivity for a predicate expression.
fn estimate_selectivity_recursive(expr: &Expr) -> f64 {
    match expr {
        // Equality predicates: 10% selectivity
        Expr::Eq(_, _) => 0.1,
        Expr::Ne(_, _) => 0.9, // Inverse of Eq

        // Range predicates: 30% selectivity
        Expr::Gt(_, _) | Expr::Ge(_, _) | Expr::Lt(_, _) | Expr::Le(_, _) => 0.3,

        // Null checks: 10% selectivity (most data is non-null)
        Expr::IsNull(_) => 0.1,
        Expr::IsNotNull(_) => 0.9,

        // Boolean operators
        Expr::And(lhs, rhs) => {
            let l = estimate_selectivity_recursive(lhs);
            let r = estimate_selectivity_recursive(rhs);
            l * r // Intersection
        }
        Expr::Or(lhs, rhs) => {
            let l = estimate_selectivity_recursive(lhs);
            let r = estimate_selectivity_recursive(rhs);
            (l + r - l * r).min(1.0) // Union
        }
        Expr::Not(inner) => {
            1.0 - estimate_selectivity_recursive(inner)
        }

        // String predicates: moderate selectivity
        Expr::StrContains(_, _) | Expr::StartsWith(_, _) | Expr::EndsWith(_, _) => 0.2,

        // Type checks: 50% default
        Expr::IsBool(_) | Expr::IsInt(_) | Expr::IsFloat(_) | Expr::IsString(_) |
        Expr::IsArray(_) | Expr::IsObject(_) | Expr::IsNumeric(_) |
        Expr::IsDate(_) | Expr::IsDateTime(_) | Expr::IsDuration(_) => 0.5,

        // Literals: always pass (true) or never pass (false)
        Expr::Literal(lit) => {
            match lit.as_bool() {
                Some(true) => 1.0,
                Some(false) => 0.0,
                None => 0.5,
            }
        }

        // Default: 50% selectivity for unknown expressions
        _ => 0.5,
    }
}

/// Estimate complexity of a predicate (number of operations).
/// Exported for use by executor's vectorized decision.
pub fn predicate_complexity(expr: &Expr) -> f64 {
    match expr {
        // Literals: minimal cost
        Expr::Literal(_) => 0.1,

        // Path access: moderate cost
        Expr::Path(_) => 0.5,

        // Binary operations: sum of operands + operation cost
        Expr::And(lhs, rhs) | Expr::Or(lhs, rhs) |
        Expr::Eq(lhs, rhs) | Expr::Ne(lhs, rhs) |
        Expr::Gt(lhs, rhs) | Expr::Ge(lhs, rhs) |
        Expr::Lt(lhs, rhs) | Expr::Le(lhs, rhs) |
        Expr::Add(lhs, rhs) | Expr::Sub(lhs, rhs) |
        Expr::Mul(lhs, rhs) | Expr::Div(lhs, rhs) => {
            1.0 + predicate_complexity(lhs) + predicate_complexity(rhs)
        }

        // Unary operations
        Expr::Not(inner) | Expr::Neg(inner) |
        Expr::IsNull(inner) | Expr::IsNotNull(inner) => {
            1.0 + predicate_complexity(inner)
        }

        // String operations: higher cost
        Expr::StrContains(lhs, rhs) | Expr::StartsWith(lhs, rhs) |
        Expr::EndsWith(lhs, rhs) => {
            3.0 + predicate_complexity(lhs) + predicate_complexity(rhs)
        }

        // Default: moderate complexity
        _ => 1.0,
    }
}

/// Recursively estimate cost for a LogicalPlan tree.
fn estimate_plan_cost_recursive(model: &CostModel, plan: &Arc<LogicalPlan>) -> CostEstimate {
    match plan.as_ref() {
        // Source nodes
        LogicalPlan::InMemory { arbor } => {
            let cardinality = arbor.num_trees() as f64;
            CostEstimate::new(cardinality, 0.0, 0.0)
        }
        LogicalPlan::Stored { .. } => {
            // Use Option to preserve "unknown" status for display
            let cardinality = model.source_cardinality.map(|c| c as f64);
            let io = model.io_cost(plan.as_ref());
            CostEstimate {
                cardinality,
                io_cost: io,
                cpu_cost: 0.0,
            }
        }

        // Filter: apply selectivity to cardinality
        LogicalPlan::Filter { source, predicate, .. } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let output_cardinality = model.estimate_filter_cardinality(
                source_cost.cardinality, predicate
            );
            // Use internal cardinality for CPU cost calculation
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            let cpu = model.cpu_cost_filter(input_card, predicate);
            CostEstimate {
                cardinality: output_cardinality,
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + cpu,
            }
        }

        // Head: cap cardinality at n
        LogicalPlan::Head { source, n } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let output_cardinality = source_cost.cardinality.map(|c| c.min(*n as f64));
            CostEstimate {
                cardinality: output_cardinality,
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost,
            }
        }

        // Tail: cap cardinality at n
        LogicalPlan::Tail { source, n } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let output_cardinality = source_cost.cardinality.map(|c| c.min(*n as f64));
            CostEstimate {
                cardinality: output_cardinality,
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost,
            }
        }

        // Sort: O(n log n) CPU cost
        LogicalPlan::Sort { source, keys } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            let cpu = model.cpu_cost_sort(input_card, keys.len());
            CostEstimate {
                cardinality: source_cost.cardinality,
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + cpu,
            }
        }

        // TopK: O(n log k) CPU cost
        LogicalPlan::TopK { source, keys, k } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            let cpu = model.cpu_cost_topk(input_card, *k, keys.len());
            CostEstimate {
                cardinality: source_cost.cardinality.map(|c| (*k as f64).min(c)),
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + cpu,
            }
        }

        // Pass-through transforms: cardinality unchanged or capped
        LogicalPlan::Take { source, indices } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            CostEstimate {
                cardinality: source_cost.cardinality.map(|c| (indices.len() as f64).min(c)),
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost,
            }
        }

        LogicalPlan::Sample { source, n, .. } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            CostEstimate {
                cardinality: source_cost.cardinality.map(|c| (*n as f64).min(c)),
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost,
            }
        }

        LogicalPlan::Shuffle { source, .. } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            // Shuffle has O(n) CPU cost for permutation
            CostEstimate {
                cardinality: source_cost.cardinality,
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + input_card,
            }
        }

        // Projection transforms
        LogicalPlan::Select { source, exprs } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            let cpu = input_card * exprs.len() as f64;
            CostEstimate {
                cardinality: source_cost.cardinality,
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + cpu,
            }
        }

        LogicalPlan::AddFields { source, fields } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            let cpu = input_card * fields.len() as f64;
            CostEstimate {
                cardinality: source_cost.cardinality,
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + cpu,
            }
        }

        LogicalPlan::Aggregate { source, exprs } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            let cpu = input_card * exprs.len() as f64;
            CostEstimate {
                cardinality: Some(1.0), // Aggregate produces single result
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + cpu,
            }
        }

        // Grouping operations
        LogicalPlan::GroupBy { source, .. } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            // Estimate ~10% of rows as distinct groups (heuristic)
            let groups = (input_card * 0.1).max(1.0);
            // GroupBy has sort cost + group detection
            let cpu = model.cpu_cost_sort(input_card, 1);
            CostEstimate {
                cardinality: Some(groups),
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + cpu,
            }
        }

        LogicalPlan::IndexBy { source, .. } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            // IndexBy has O(n) cost to build HashMap
            let cpu = input_card * 2.0; // Hash + insert
            CostEstimate {
                cardinality: source_cost.cardinality,
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + cpu,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use arbors_expr::{lit, path};
    use arbors_storage::InMemoryArbor;

    #[test]
    fn test_selectivity_equality() {
        let model = CostModel::new();
        let pred = path("x").eq(lit(42));
        assert!((model.estimate_selectivity(&pred) - 0.1).abs() < 0.001);
    }

    #[test]
    fn test_selectivity_range() {
        let model = CostModel::new();
        let pred = path("x").gt(lit(10));
        assert!((model.estimate_selectivity(&pred) - 0.3).abs() < 0.001);
    }

    #[test]
    fn test_selectivity_and() {
        let model = CostModel::new();
        // 0.1 * 0.3 = 0.03
        let pred = path("x").eq(lit(42)).and(path("y").gt(lit(10)));
        assert!((model.estimate_selectivity(&pred) - 0.03).abs() < 0.001);
    }

    #[test]
    fn test_selectivity_or() {
        let model = CostModel::new();
        // 0.1 + 0.3 - 0.1*0.3 = 0.37
        let pred = path("x").eq(lit(42)).or(path("y").gt(lit(10)));
        assert!((model.estimate_selectivity(&pred) - 0.37).abs() < 0.001);
    }

    #[test]
    fn test_cost_inmemory_source() {
        let arbor = Arc::new(InMemoryArbor::new());
        let plan = LogicalPlan::inmemory(arbor);
        let model = CostModel::new();

        let cost = model.estimate_plan_cost(&plan);
        assert_eq!(cost.io_cost, Some(0.0));
        assert_eq!(cost.cpu_cost, 0.0);
    }

    #[test]
    fn test_cost_stored_source_unknown() {
        let plan = LogicalPlan::stored("test");
        let model = CostModel::new(); // No metadata

        let cost = model.estimate_plan_cost(&plan);
        assert_eq!(cost.cardinality, None); // Unknown
        assert_eq!(cost.io_cost, None); // Unknown
        assert_eq!(cost.display_cardinality(), "unknown");
    }

    #[test]
    fn test_cost_stored_source_known() {
        let plan = LogicalPlan::stored("test");
        let model = CostModel::with_source_info(Some(1000), Some(10), true);

        let cost = model.estimate_plan_cost(&plan);
        assert_eq!(cost.cardinality, Some(1000.0));
        assert!(cost.io_cost.unwrap() > 0.0);
    }

    #[test]
    fn test_filter_cardinality_can_be_zero() {
        let model = CostModel::new();
        // Literal false has 0.0 selectivity
        let pred = arbors_expr::lit(false);
        let result = model.estimate_filter_cardinality(Some(100.0), &pred);
        assert_eq!(result, Some(0.0));
    }

    #[test]
    fn test_sort_vs_topk_cost() {
        let model = CostModel::with_source_info(Some(10000), Some(100), true);

        let sort_cpu = model.cpu_cost_sort(10000.0, 1);
        let topk_cpu = model.cpu_cost_topk(10000.0, 10, 1);

        // TopK should be significantly cheaper than full sort
        assert!(topk_cpu < sort_cpu);
    }
}
```

**Checklist:**
- [ ] Create `crates/arbors-pipeline/src/optimize/cost.rs`
- [ ] Add `CostEstimate` struct with Option fields for unknown handling
- [ ] Add `CostModel` struct with estimation methods
- [ ] Implement `estimate_selectivity()` with heuristics
- [ ] Export `predicate_complexity()` for executor use
- [ ] Implement `estimate_plan_cost()` for all LogicalPlan variants
- [ ] Add unit tests including unknown/zero cases
- [ ] Verify: `cargo build -p arbors-pipeline`
- [ ] Verify: `cargo test -p arbors-pipeline cost`

**Gate B Impact:** None (no integration yet)

---

### Sub-Step 8.2: Update optimize/mod.rs Exports

**Goal:** Export cost model types from the optimize module.

**Files:**
- MODIFY: `crates/arbors-pipeline/src/optimize/mod.rs`

**Code Changes:**

```rust
// Add to mod.rs
mod cost;

// Add to existing re-exports
pub use cost::{CostEstimate, CostModel, predicate_complexity};
```

**Checklist:**
- [ ] Add `mod cost;` to optimize/mod.rs
- [ ] Add `pub use cost::{CostEstimate, CostModel, predicate_complexity};`
- [ ] Verify: `cargo build -p arbors-pipeline`

**Gate B Impact:** None (exports only)

---

### Sub-Step 8.3: Implement Cost-Based Filter Ordering

**Goal:** Create a new optimization rule that reorders ANDed filter predicates by selectivity.

**Files:**
- MODIFY: `crates/arbors-pipeline/src/optimize/logical_plan.rs`

**Design Notes:**
- When a Filter has an AND predicate, evaluate the more selective clause first
- This enables short-circuit evaluation to skip more work
- Only applies to fused filters (from FilterFusion)
- **Error Semantics:** This reordering MAY change which error is observed for fallible expressions. This is accepted behavior per policy decision.

**Code Sketch:**

```rust
// Add new rule to logical_plan.rs

/// Reorders AND predicates by estimated selectivity (most selective first).
///
/// # Pattern
///
/// Filter(p1 AND p2) where selectivity(p2) < selectivity(p1)
/// -> Filter(p2 AND p1)
///
/// # Benefits
///
/// - Short-circuit evaluation skips more work
/// - More selective predicates eliminate rows earlier
///
/// # Error Semantics
///
/// **WARNING:** This reordering may change which error is observed for
/// fallible expressions. For example, if p1 errors and p2 is selective,
/// reordering to (p2 AND p1) may cause fewer rows to reach p1's evaluation.
/// This is accepted behavior; users should not rely on specific error
/// ordering from ANDed predicates.
///
/// # Limitations
///
/// - Only reorders top-level ANDs (does not recursively restructure)
/// - Requires FilterFusion to have run first
#[derive(Debug, Clone, Copy)]
pub struct FilterSelectivityOrder;

impl LogicalOptimizationRule for FilterSelectivityOrder {
    fn apply(&self, plan: &Arc<LogicalPlan>) -> Option<Arc<LogicalPlan>> {
        apply_filter_selectivity_order(plan)
    }

    fn name(&self) -> &'static str {
        "FilterSelectivityOrder"
    }
}

fn apply_filter_selectivity_order(plan: &Arc<LogicalPlan>) -> Option<Arc<LogicalPlan>> {
    use crate::optimize::CostModel;

    match plan.as_ref() {
        LogicalPlan::Filter {
            source,
            predicate,
            mode,
            limit,
        } => {
            // Check if predicate is an AND that could benefit from reordering
            if let Expr::And(lhs, rhs) = predicate {
                let model = CostModel::new();
                let sel_lhs = model.estimate_selectivity(lhs);
                let sel_rhs = model.estimate_selectivity(rhs);

                // If rhs is more selective, swap order
                if sel_rhs < sel_lhs {
                    let reordered = rhs.clone().and(lhs.as_ref().clone());
                    return Some(Arc::new(LogicalPlan::Filter {
                        source: Arc::clone(source),
                        predicate: reordered,
                        mode: *mode,
                        limit: *limit,
                    }));
                }
            }

            // Try recursively in source
            let optimized_source = apply_filter_selectivity_order(source)?;
            Some(Arc::new(LogicalPlan::Filter {
                source: optimized_source,
                predicate: predicate.clone(),
                mode: *mode,
                limit: *limit,
            }))
        }

        // Recurse into other node types
        // ... (similar pattern to other rules)
        _ => recurse_for_filter_selectivity(plan),
    }
}

fn recurse_for_filter_selectivity(plan: &Arc<LogicalPlan>) -> Option<Arc<LogicalPlan>> {
    match plan.as_ref() {
        LogicalPlan::Head { source, n } => {
            apply_filter_selectivity_order(source).map(|optimized| {
                Arc::new(LogicalPlan::Head { source: optimized, n: *n })
            })
        }
        // ... other node types (follow pattern from existing rules)
        LogicalPlan::InMemory { .. } | LogicalPlan::Stored { .. } => None,
        _ => None, // Simplified - implement full recursion
    }
}
```

**Checklist:**
- [ ] Add `FilterSelectivityOrder` rule to logical_plan.rs
- [ ] Add rule to `optimize_logical_plan()` rule list (after FilterFusion)
- [ ] Document error semantics warning in rustdoc
- [ ] Add unit tests for selectivity ordering
- [ ] Verify: `cargo test -p arbors-pipeline filter_selectivity`

**Gate B Impact:** None (optimization preserves boolean semantics, error behavior may differ)

---

### Sub-Step 8.4: Add Cost Information to DecodePlanSummary

**Goal:** Extend `DecodePlanSummary` with cost estimates for explain() output.

**Files:**
- MODIFY: `crates/arbors-pipeline/src/optimize/analysis.rs`

**Code Changes:**

```rust
// Add to DecodePlanSummary struct
#[derive(Debug, Clone, PartialEq)]
pub struct DecodePlanSummary {
    // ... existing fields ...

    /// Estimated cost for the entire plan.
    ///
    /// This is computed by the cost model and represents the relative
    /// expense of executing the plan.
    ///
    /// Added in Step 8 for cost-based optimization visibility.
    pub estimated_cost: Option<CostEstimate>,
}

impl DecodePlanSummary {
    /// Create an empty summary (no pools required).
    pub const fn empty() -> Self {
        Self {
            predicate_plan: DecodePlan::NONE,
            projection_plan: DecodePlan::NONE,
            materialization_plan: DecodePlan::NONE,
            estimated_cost: None,
        }
    }

    /// Create a summary requiring all pools.
    pub const fn all() -> Self {
        Self {
            predicate_plan: DecodePlan::ALL,
            projection_plan: DecodePlan::ALL,
            materialization_plan: DecodePlan::ALL,
            estimated_cost: None,
        }
    }

    // ... existing methods ...
}

// Add new function
/// Analyze decode requirements and estimate costs for a logical plan.
///
/// This is an extended version of `analyze_decode_requirements` that also
/// computes cost estimates using the cost model.
///
/// # Unknown Metadata
///
/// When source metadata is unavailable (e.g., stored source without scope),
/// cost estimates will show "unknown" for cardinality and IO cost rather
/// than using magic default values.
pub fn analyze_with_cost(
    plan: &LogicalPlan,
    schema: Option<&SchemaRegistry>,
    source_cardinality: Option<usize>,
    batch_count: Option<usize>,
) -> DecodePlanSummary {
    let mut summary = analyze_decode_requirements(plan, schema);

    // Add cost estimation
    let model = CostModel::with_source_info(
        source_cardinality,
        batch_count,
        schema.is_some(),
    );

    // Wrap in Arc for cost estimation
    let plan_arc = Arc::new(plan.clone());
    summary.estimated_cost = Some(model.estimate_plan_cost(&plan_arc));

    summary
}
```

**Checklist:**
- [ ] Add `estimated_cost: Option<CostEstimate>` field to `DecodePlanSummary`
- [ ] Update `empty()` and `all()` constructors
- [ ] Add `analyze_with_cost()` function
- [ ] Update existing tests to handle new field
- [ ] Verify: `cargo test -p arbors-pipeline analysis`

**Gate B Impact:** None (addition only, existing API unchanged)

---

### Sub-Step 8.5: Extend explain() with Options and Cost Information

**Goal:** Add parameterized `explain(ExplainOptions)` with cost output.

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`

**Code Changes:**

```rust
/// Options for explain() output.
#[derive(Debug, Clone, Default)]
pub struct ExplainOptions {
    /// Include estimated costs section.
    pub costs: bool,
    // Future: analyze: bool (Step 11)
}

impl ExplainOptions {
    /// Create options with costs enabled.
    pub fn with_costs() -> Self {
        Self { costs: true }
    }
}

// Update explain() implementation
impl Arbor {
    /// Explain the query plan with default options.
    ///
    /// Equivalent to `explain_with(ExplainOptions::default())`.
    pub fn explain(&self) -> String {
        self.explain_with(ExplainOptions::default())
    }

    /// Explain the query plan with options.
    ///
    /// Returns a human-readable string showing:
    /// - Logical plan (as constructed)
    /// - Optimized plan (after rule-based optimization)
    /// - DecodePlan summary (pools required for execution)
    /// - Early termination hints (filters with limit hints)
    /// - Estimated costs (if `options.costs` is true)
    ///
    /// # Cost Estimation
    ///
    /// When `options.costs` is true, shows:
    /// - Cardinality: Estimated number of trees (or "unknown")
    /// - IO Cost: Estimated cost of loading data (or "unknown")
    /// - CPU Cost: Estimated cost of computation
    /// - Total: Weighted sum of IO + CPU costs (or "unknown")
    ///
    /// These are heuristic estimates for comparison purposes.
    /// Use `explain_analyze()` (Step 11) for observed statistics.
    ///
    /// # Example Output
    ///
    /// ```text
    /// Logical Plan:
    ///   Filter(pred=...)
    ///     Stored("users")
    ///
    /// Optimized Plan:
    ///   Filter(pred=..., limit=10)
    ///     Stored("users")
    ///
    /// DecodePlan Summary:
    ///   predicate_plan: Selective([Int64s])
    ///   projection_plan: NONE
    ///   materialization_plan: ALL
    ///
    /// Early Termination:
    ///   Filter with limit=10
    ///
    /// Estimated Costs:
    ///   cardinality: unknown
    ///   io_cost: unknown
    ///   cpu_cost: 15.0
    ///   total_cost: unknown
    /// ```
    // FIXME(Step 11): Add explain_analyze() for observed stats
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

        // Collect early termination hints
        let limit_hints = collect_limit_hints(&optimized);

        let mut output = String::new();

        // Logical plan section
        output.push_str("Logical Plan:\n");
        format_plan(&self.plan, 1, &mut output);
        output.push('\n');

        // Optimized plan section
        output.push_str("Optimized Plan:\n");
        format_plan(&optimized, 1, &mut output);
        output.push('\n');

        // DecodePlan summary section
        output.push_str("DecodePlan Summary:\n");
        format_decode_summary(&decode_summary, &mut output);
        output.push('\n');

        // Early termination hints section
        output.push_str("Early Termination:\n");
        if limit_hints.is_empty() {
            output.push_str("  (none)\n");
        } else {
            for hint in &limit_hints {
                output.push_str(&format!("  Filter with limit={}\n", hint));
            }
        }

        // Estimated costs section (only if requested)
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

/// Extract source metadata for cost estimation.
///
/// Uses the Arbor's cached metadata when available (for scoped backings),
/// or queries via `scope.txn().get_meta()` for stored sources.
fn get_source_metadata(plan: &Arc<LogicalPlan>, scope: &ArborScope) -> (Option<usize>, Option<usize>) {
    match plan.root_source() {
        LogicalPlan::InMemory { arbor } => {
            (Some(arbor.num_trees()), Some(1)) // Single batch for in-memory
        }
        LogicalPlan::Stored { name } => {
            // Try to get metadata from scope via txn API
            if let Some(read_scope) = scope.as_scope() {
                if let Ok(Some(meta)) = read_scope.txn().get_meta(name) {
                    return (Some(meta.num_trees), meta.batch_count);
                }
            }
            (None, None) // Unknown - will display as "unknown"
        }
        _ => (None, None),
    }
}
```

**Checklist:**
- [ ] Add `ExplainOptions` struct
- [ ] Add `explain_with(options)` method
- [ ] Update existing `explain()` to delegate to `explain_with(default)`
- [ ] Add `get_source_metadata()` helper function
- [ ] Import `analyze_with_cost` from arbors_pipeline
- [ ] Use `display_cardinality()` / `display_io_cost()` for "unknown" handling
- [ ] Add test for explain() with and without costs option
- [ ] Verify: `cargo test -p arbors explain`

**Gate B Impact:** Addition only - must pass

---

### Sub-Step 8.6: Add Vectorized vs Interpreted Decision

**Goal:** Use cost model to decide between vectorized and interpreted execution paths.

**Files:**
- MODIFY: `crates/arbors-pipeline/src/executor.rs`

**Design Notes:**
- Vectorized execution is faster but requires schema
- The cost model can estimate the benefit of vectorized execution
- Add a threshold check before choosing execution strategy

**Code Sketch:**

```rust
// Add to executor.rs

use crate::optimize::predicate_complexity;

/// Decide whether to use vectorized or interpreted execution.
///
/// Vectorized execution is ~10x faster but requires schema.
/// This function uses the cost model to make the decision.
fn should_use_vectorized(
    cardinality: usize,
    schema: Option<&SchemaRegistry>,
    predicate: &Expr,
) -> bool {
    // Must have schema for vectorized
    if schema.is_none() {
        return false;
    }

    // For small datasets, overhead of vectorization may not be worth it
    const VECTORIZATION_THRESHOLD: usize = 100;
    if cardinality < VECTORIZATION_THRESHOLD {
        return false;
    }

    // Check predicate complexity - simple predicates benefit more
    let complexity = predicate_complexity(predicate);
    complexity < 10.0 // Use vectorized for simpler predicates
}

// Update filter method to use decision function
impl<'a, S: TreeSource> PipelineExecutor<'a, S> {
    pub fn filter(
        &self,
        predicate: &Expr,
        limit: Option<usize>,
    ) -> Result<Vec<usize>, PipelineError> {
        // TreeSource uses tree_count(), not len()
        let cardinality = self.source.tree_count();

        // Cost-based decision: vectorized vs interpreted
        if should_use_vectorized(cardinality, self.source.schema(), predicate) && limit.is_none() {
            self.filter_vectorized(predicate)
        } else if let Some(n) = limit {
            self.filter_sequential_with_limit(predicate, n)
        } else {
            self.filter_parallel(predicate)
        }
    }
}
```

**Checklist:**
- [ ] Import `predicate_complexity` from cost module
- [ ] Add `should_use_vectorized()` decision function
- [ ] Update filter execution to use cost-based decision
- [ ] Add test verifying vectorized is chosen for large datasets with schema
- [ ] Add test verifying interpreted is chosen for small datasets
- [ ] Verify: `cargo test -p arbors-pipeline executor`
- [ ] Resolve FIXME(Step 8) in executor.rs:148 and :193

**Gate B Impact:** Must preserve correctness - only changes performance

---

### Sub-Step 8.7: Add Sort Key DecodePlan Optimization

**Goal:** Implement path-based DecodePlan pruning for sort keys (resolve FIXMEs).

**Files:**
- MODIFY: `crates/arbors-pipeline/src/physical.rs`
- MODIFY: `crates/arbors-pipeline/src/optimize/analysis.rs`

**Code Changes:**

```rust
// In physical.rs, update analyze_sort_key_decode_plan()

/// Analyze decode requirements for sort keys.
///
/// Returns a DecodePlan that includes only the pools needed to evaluate
/// the sort key expressions. This minimizes decoding during sort.
fn analyze_sort_key_decode_plan(
    keys: &[SortKey],
    schema: Option<&SchemaRegistry>,
) -> DecodePlan {
    let schema = match schema {
        Some(s) => s,
        None => return DecodePlan::ALL, // Conservative fallback
    };

    // Collect expressions from all sort keys
    let exprs: Vec<&Expr> = keys.iter().map(|k| &k.expr).collect();

    // Use existing projection analysis
    analyze_required_pools_multi(&exprs, Some(schema))
}

// Update physical_sort to use the optimized decode plan
pub fn physical_sort<S: TreeSource>(
    source: &S,
    keys: &[SortKey],
    input_indices: &IndexSet,
    streaming_budget: &StreamingBudget,
) -> Result<IndexSet, PipelineError> {
    // ... existing code ...

    // Use optimized decode plan for key extraction
    let plan = analyze_sort_key_decode_plan(keys, source.schema());

    // ... rest of implementation uses `plan` ...
}
```

**Checklist:**
- [ ] Update `analyze_sort_key_decode_plan()` to use projection analysis
- [ ] Update `physical_sort()` to use optimized decode plan
- [ ] Update `physical_topk()` to use optimized decode plan
- [ ] Update `physical_index_by()` to use optimized decode plan
- [ ] Resolve FIXMEs at physical.rs:691, :1002, :1107
- [ ] Add tests verifying minimal pool decoding for sort
- [ ] Verify: `cargo test -p arbors-pipeline physical`

**Gate B Impact:** Must preserve correctness - only improves efficiency

---

### Sub-Step 8.8: Add Python explain() Options Support

**Goal:** Expose `ExplainOptions` to Python.

**Files:**
- MODIFY: `python/src/arbor.rs` (or wherever PyArbor.explain is)

**Code Changes:**

```rust
// In Python bindings

/// Explain the query plan.
///
/// Args:
///     costs: If True, include estimated costs section (default: False)
///
/// Returns:
///     Human-readable string showing the query plan
#[pyo3(signature = (*, costs=false))]
fn explain(&self, costs: bool) -> PyResult<String> {
    let options = ExplainOptions { costs };
    Ok(self.inner.explain_with(options))
}
```

**Checklist:**
- [ ] Update Python `explain()` to accept `costs` keyword argument
- [ ] Verify Python explain() output includes "Estimated Costs" when `costs=True`
- [ ] Add Python test for explain() output with costs
- [ ] Verify: `make python && .venv/bin/pytest python/tests -v -k explain`

**Gate B Impact:** None (output format change only)

---

### Sub-Step 8.9: Add Integration Tests

**Goal:** Verify cost model integration works correctly.

**Files:**
- NEW: `crates/arbors-pipeline/tests/cost_model_tests.rs`

**Test Categories:**

```rust
//! Integration tests for cost model.

use arbors_expr::{lit, path};
use arbors_pipeline::{
    CostModel, CostEstimate,
    LogicalPlan, LogicalFilterMode,
    optimize_logical_plan,
};
use arbors_storage::InMemoryArbor;
use std::sync::Arc;

/// Test that filter ordering improves selectivity
#[test]
fn test_filter_selectivity_ordering() {
    let arbor = Arc::new(InMemoryArbor::new());

    // Less selective first (30%), more selective second (10%)
    let plan = LogicalPlan::inmemory(arbor)
        .filter(path("x").gt(lit(10)), LogicalFilterMode::Immediate) // 30%
        .filter(path("y").eq(lit(42)), LogicalFilterMode::Immediate); // 10%

    let optimized = optimize_logical_plan(&plan);

    // After optimization, fused filter should have AND predicate
    // with more selective clause first
    match optimized.as_ref() {
        LogicalPlan::Filter { predicate, .. } => {
            if let arbors_expr::Expr::And(lhs, _rhs) = predicate {
                // LHS should be the more selective predicate (Eq)
                assert!(matches!(lhs.as_ref(), arbors_expr::Expr::Eq(_, _)));
            }
        }
        _ => panic!("Expected Filter"),
    }
}

/// Test TopK cost is lower than Sort + Head
#[test]
fn test_topk_cost_lower_than_sort() {
    let model = CostModel::with_source_info(Some(10000), Some(100), true);

    // Full sort cost
    let sort_cpu = model.cpu_cost_sort(10000.0, 1);

    // TopK cost (k=10)
    let topk_cpu = model.cpu_cost_topk(10000.0, 10, 1);

    // TopK should be significantly cheaper
    assert!(topk_cpu < sort_cpu / 10.0,
        "TopK ({}) should be <10% of sort cost ({})",
        topk_cpu, sort_cpu);
}

/// Test cost estimation is consistent across plan transformations
#[test]
fn test_cost_consistency() {
    let arbor = Arc::new(InMemoryArbor::new());
    let model = CostModel::with_source_info(Some(1000), Some(10), true);

    let plan = LogicalPlan::inmemory(arbor)
        .filter(path("x").gt(lit(10)), LogicalFilterMode::Immediate)
        .head(100);

    let original_cost = model.estimate_plan_cost(&plan);

    let optimized = optimize_logical_plan(&plan);
    let optimized_cost = model.estimate_plan_cost(&optimized);

    // Optimized should have same or lower cost
    assert!(optimized_cost.total() <= original_cost.total().map(|t| t * 1.1),
        "Optimized ({:?}) should not be much more expensive than original ({:?})",
        optimized_cost.total(), original_cost.total());
}

/// Test unknown metadata produces "unknown" display
#[test]
fn test_unknown_metadata_display() {
    let plan = LogicalPlan::stored("test");
    let model = CostModel::new(); // No metadata

    let cost = model.estimate_plan_cost(&plan);
    assert_eq!(cost.display_cardinality(), "unknown");
    assert_eq!(cost.display_io_cost(), "unknown");
}
```

**Checklist:**
- [ ] Create `cost_model_tests.rs`
- [ ] Add selectivity ordering test
- [ ] Add TopK vs Sort cost comparison test
- [ ] Add cost consistency test
- [ ] Add unknown metadata display test
- [ ] Verify: `cargo test -p arbors-pipeline --test cost_model_tests`

**Gate B Impact:** Tests only - no production code

---

### Sub-Step 8.10: Documentation and FIXME Updates

**Goal:** Document cost model, update/resolve FIXMEs.

**Files:**
- MODIFY: `crates/arbors-pipeline/src/optimize/cost.rs` (module docs)
- MODIFY: Various files with Step 8 FIXMEs

**FIXME Resolution Table:**

| File | Line | Action |
|------|------|--------|
| `handle.rs:1465` | RESOLVED | Cost estimation added to explain() |
| `handle.rs:1474` | RESOLVED | analyze_with_cost() uses source metadata |
| `physical.rs:691` | RESOLVED | analyze_sort_key_decode_plan() implemented |
| `physical.rs:1002` | RESOLVED | TopK uses optimized decode plan |
| `physical.rs:1107` | RESOLVED | IndexBy uses optimized decode plan |
| `analysis.rs:14-16` | RESOLVED | CostModel added in cost.rs |
| `analysis.rs:42` | RESOLVED | analyze_with_cost() integrates cost |
| `logical_plan.rs:875` | DEFERRED | Vectorized limit - future enhancement |
| `executor.rs:148` | PARTIAL | Cost-based decision added, limit threading deferred |
| `executor.rs:193` | PARTIAL | Cost-based decision added, limit threading deferred |

**New FIXMEs to Add:**

```rust
// In cost.rs header
//! # Future Enhancements (Statistics Collection)
//!
//! The current cost model uses heuristics. Future work could add:
//! - Histogram-based selectivity estimation
//! - Runtime statistics collection
//! - Adaptive cost calibration
//!
//! REFACTOR FIXME: Add statistics-based selectivity estimation.
```

**Checklist:**
- [ ] Add comprehensive module documentation to cost.rs
- [ ] Resolve FIXMEs listed in table (update comments)
- [ ] Add new FIXMEs for future enhancements
- [ ] Verify: `cargo doc -p arbors-pipeline`

---

### Sub-Step 8.11: Verify All Gates

**Goal:** Ensure all tests pass.

**Commands:**
```bash
cargo test -p arbors --test invariants   # Gate A
cargo test                                # Rust Gate B
make python && .venv/bin/pytest python/tests -v  # Python Gate B
```

**Checklist:**
- [ ] Gate A: `cargo test -p arbors --test invariants` passes
- [ ] Rust Gate B: `cargo test` passes
- [ ] Python Gate B: `.venv/bin/pytest python/tests -v` passes
- [ ] Commit with message: "Step 8: Cost model optimizer - heuristic-based cost estimation"

---

## Summary of Changes

### New Files
| File | Description |
|------|-------------|
| `crates/arbors-pipeline/src/optimize/cost.rs` | Cost model implementation |
| `crates/arbors-pipeline/tests/cost_model_tests.rs` | Integration tests |

### Modified Files
| File | Changes |
|------|---------|
| `crates/arbors-pipeline/src/optimize/mod.rs` | Export cost module |
| `crates/arbors-pipeline/src/optimize/logical_plan.rs` | Add FilterSelectivityOrder rule |
| `crates/arbors-pipeline/src/optimize/analysis.rs` | Add estimated_cost to summary |
| `crates/arbors-pipeline/src/physical.rs` | Optimize sort key decode plans |
| `crates/arbors-pipeline/src/executor.rs` | Cost-based vectorized decision |
| `crates/arbors/src/handle.rs` | Add ExplainOptions, explain_with() |
| `python/src/arbor.rs` | Add costs parameter to explain() |

### Atomic Pairs
These changes must land together:
1. **cost.rs + mod.rs**: Cost module and exports
2. **analysis.rs + handle.rs**: CostEstimate field and explain() update
3. **physical.rs + analysis.rs**: Sort key decode optimization

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Cost estimates too inaccurate | Use conservative defaults, document as heuristics |
| Performance regression from cost calculation | Cost calculation is O(plan_size), no allocation-heavy cloning |
| Breaking change to explain() output | Addition only - existing sections unchanged, costs opt-in |
| Filter reordering changes error behavior | **Accepted per policy** - documented that error ordering may change |
| Unknown metadata shown as defaults | Fixed - now shows "unknown" explicitly |

---

## Verification Checklist (Final)

- [ ] All Step 8 FIXMEs resolved or documented as deferred
- [ ] Cost model documented with heuristic values explained
- [ ] Error semantics documented for FilterSelectivityOrder
- [ ] Unknown metadata displays as "unknown" not magic numbers
- [ ] explain(costs=True) shows Estimated Costs section
- [ ] explain() without costs omits the section (backward compatible)
- [ ] Filter selectivity ordering applied in optimizer
- [ ] Sort/TopK/IndexBy use minimal decode plans
- [ ] Vectorized vs interpreted decision is cost-based
- [ ] All tests pass (Gate A + Gate B)
- [ ] No performance regressions in existing tests
