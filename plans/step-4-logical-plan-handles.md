# Step 4: Logical Plan Handles - Detailed Implementation Plan

## Overview

**Goal**: Make `Arbor` a logical plan handle, not a materialized-data wrapper.

**Exit Criteria**: Public `Arbor` becomes a logical-plan handle (no backing nesting), and Gate B remains green.

**Key Transformation**: Replace the recursive `ArborBacking` enum with a flat `LogicalPlan` DAG that separates plan structure from execution binding.

---

## Design Analysis

### Current State (After Step 3)

```
Arbor
  └── backing: ArborBacking
        ├── InMemory(Arc<InMemoryArbor>)
        ├── Stored { session, name, meta }     // DEPRECATED (Step 12)
        ├── Scoped { scope, name, meta }       // New in Step 3
        └── Filtered { source: Box<ArborBacking>, state, pinned_generation }
```

**Problems with Current Design**:
1. **Recursive nesting**: `filter().filter().filter()` creates deeply nested `Box<ArborBacking>`
2. **Mixed concerns**: Backing conflates source identification with execution context
3. **No optimization surface**: Nested boxes are hard to rewrite/fuse
4. **Scope coupling**: `Scoped` variant tightly couples scope to plan structure

### Target State

```
Arbor (user-facing handle in `arbors` crate)
  ├── plan: Arc<LogicalPlan>     // Scope-free plan structure
  └── scope: ArborScope          // Execution binding (scope for Stored, None for InMemory)

LogicalPlan (owned by `arbors-pipeline` crate)
  ├── InMemory { arbor: Arc<InMemoryArbor> }
  ├── Stored { name: String }    // Scope-free! Resolved at execution time
  ├── Filter { source: Arc<LogicalPlan>, predicate, mode }
  ├── Head { source: Arc<LogicalPlan>, n }
  ├── Tail { source: Arc<LogicalPlan>, n }
  ├── Take { source: Arc<LogicalPlan>, indices }
  └── ... other transforms
```

**Key Insight**: `LogicalPlan` is **scope-free**. The `Stored { name }` variant does not hold a `ReadScope`; snapshot binding happens at execution time via `ExecContext`.

---

## Critical Design Decisions

### 1. LogicalPlan Location

**Decision**: `LogicalPlan` lives in `arbors-pipeline`.

**Rationale**:
- Pipeline owns execution engine; plan is the input to execution
- Avoids crate cycles (arbors-base <- arbors-pipeline <- arbors)
- Enables optimizer/cost model to live alongside plan

### 2. Scope Binding Model

**Decision**: User-facing `Arbor` holds `ArborScope` (enum: `Scoped(Arc<ReadScope>)` | `InMemory`).

```rust
// crates/arbors/src/handle.rs
pub enum ArborScope {
    /// In-memory data, no scope needed
    InMemory,
    /// Stored data, bound to a ReadScope
    Scoped(Arc<ReadScope>),
}

pub struct Arbor {
    plan: Arc<LogicalPlan>,
    scope: ArborScope,
}
```

**Execution Binding Contract**:
- When executing a `LogicalPlan`, the executor receives an `ExecContext` containing `Option<&OwnedReadTxn>`
- For `LogicalPlan::Stored { name }`, executor uses `ctx.txn().get_batched(name)?`
- For `LogicalPlan::InMemory { arbor }`, executor uses the arbor directly
- This keeps `LogicalPlan` scope-free while enabling execution

### 3. FilterState Handling

**Decision**: Lazy filter state moves into `LogicalPlan::Filter` as a `mode` field.

```rust
pub enum FilterMode {
    Immediate,
    Lazy,
}

pub enum LogicalPlan {
    Filter {
        source: Arc<LogicalPlan>,
        predicate: Expr,
        mode: FilterMode,  // Replaces FilterState distinction
    },
    // ...
}
```

**Cached indices** are an execution concern, not a plan concern. The executor manages caching during iteration.

### 4. Relationship to Existing QueryPlan

**Decision**: `LogicalPlan` replaces `QueryPlan` for the unified handle path.

The existing `QueryPlan` in `arbors-pipeline/src/plan.rs`:
- Works only with `Arc<InMemoryArbor>` as source
- Is used by `LazyArbor` for in-memory query chains
- Will be unified with `LogicalPlan` in Step 5

For Step 4, we add `LogicalPlan` as a **parallel structure**. Step 5 will unify execution across both, and Step 12 will delete `QueryPlan`.

---

## Implementation Sub-Steps

### Sub-Step 4.1: Define LogicalPlan Type

**Goal**: Add `LogicalPlan` enum to `arbors-pipeline`.

**Files**:
- NEW: `crates/arbors-pipeline/src/logical_plan.rs`
- MODIFY: `crates/arbors-pipeline/src/lib.rs` (add mod + re-export)

**Changes**:

Create `crates/arbors-pipeline/src/logical_plan.rs`:

```rust
//! LogicalPlan: Scope-free logical query representation.
//!
//! LogicalPlan represents query operations as a DAG without binding to
//! any specific ReadScope. Scope binding happens at execution time.
//!
//! This design enables:
//! - Plan optimization without I/O handles
//! - Plan sharing across scopes
//! - Clean separation between plan structure and execution context

use std::sync::Arc;

use arbors_expr::Expr;
use arbors_storage::InMemoryArbor;

/// Mode for filter operations in a logical plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LogicalFilterMode {
    /// Compute matching indices immediately during execution.
    #[default]
    Immediate,
    /// Defer index computation until first access during iteration.
    Lazy,
}

/// Logical query plan node.
///
/// Each variant represents a logical operation. Plans form a DAG where
/// transforms reference their source via `Arc<LogicalPlan>`.
///
/// **Critical**: Stored sources are scope-free. The `name` identifies the
/// arbor; the actual `ReadScope` is provided at execution time.
#[derive(Debug, Clone)]
pub enum LogicalPlan {
    // =========================================================================
    // Leaf Nodes (Sources)
    // =========================================================================

    /// In-memory arbor source.
    ///
    /// The arbor data is already loaded; no scope needed.
    InMemory {
        arbor: Arc<InMemoryArbor>,
    },

    /// Stored arbor source (scope-free).
    ///
    /// The `name` identifies the arbor in storage. The actual `ReadScope`
    /// is bound at execution time via `ExecContext`.
    Stored {
        name: String,
    },

    // =========================================================================
    // Transform Nodes
    // =========================================================================

    /// Filter trees by predicate.
    Filter {
        source: Arc<LogicalPlan>,
        predicate: Expr,
        mode: LogicalFilterMode,
    },

    /// Take first N trees.
    Head {
        source: Arc<LogicalPlan>,
        n: usize,
    },

    /// Take last N trees.
    Tail {
        source: Arc<LogicalPlan>,
        n: usize,
    },

    /// Take trees at specific indices.
    Take {
        source: Arc<LogicalPlan>,
        indices: Vec<usize>,
    },

    /// Random sample of N trees.
    Sample {
        source: Arc<LogicalPlan>,
        n: usize,
        seed: Option<u64>,
    },

    /// Shuffle tree order.
    Shuffle {
        source: Arc<LogicalPlan>,
        seed: Option<u64>,
    },
}

impl LogicalPlan {
    // =========================================================================
    // Constructors
    // =========================================================================

    /// Create an in-memory source plan.
    pub fn inmemory(arbor: Arc<InMemoryArbor>) -> Arc<Self> {
        Arc::new(Self::InMemory { arbor })
    }

    /// Create a stored source plan (scope-free).
    pub fn stored(name: impl Into<String>) -> Arc<Self> {
        Arc::new(Self::Stored { name: name.into() })
    }

    // =========================================================================
    // Plan Building (returns new Arc<LogicalPlan>)
    // =========================================================================

    /// Add a filter operation.
    pub fn filter(self: &Arc<Self>, predicate: Expr, mode: LogicalFilterMode) -> Arc<Self> {
        Arc::new(Self::Filter {
            source: Arc::clone(self),
            predicate,
            mode,
        })
    }

    /// Add a head operation.
    pub fn head(self: &Arc<Self>, n: usize) -> Arc<Self> {
        Arc::new(Self::Head {
            source: Arc::clone(self),
            n,
        })
    }

    /// Add a tail operation.
    pub fn tail(self: &Arc<Self>, n: usize) -> Arc<Self> {
        Arc::new(Self::Tail {
            source: Arc::clone(self),
            n,
        })
    }

    /// Add a take operation.
    pub fn take(self: &Arc<Self>, indices: Vec<usize>) -> Arc<Self> {
        Arc::new(Self::Take {
            source: Arc::clone(self),
            indices,
        })
    }

    /// Add a sample operation.
    pub fn sample(self: &Arc<Self>, n: usize, seed: Option<u64>) -> Arc<Self> {
        Arc::new(Self::Sample {
            source: Arc::clone(self),
            n,
            seed,
        })
    }

    /// Add a shuffle operation.
    pub fn shuffle(self: &Arc<Self>, seed: Option<u64>) -> Arc<Self> {
        Arc::new(Self::Shuffle {
            source: Arc::clone(self),
            seed,
        })
    }

    // =========================================================================
    // Plan Inspection
    // =========================================================================

    /// Check if this is a leaf (source) node.
    pub fn is_source(&self) -> bool {
        matches!(self, Self::InMemory { .. } | Self::Stored { .. })
    }

    /// Check if this plan requires a scope for execution.
    ///
    /// Returns true if the plan (or any ancestor) contains a Stored source.
    pub fn requires_scope(&self) -> bool {
        match self {
            Self::InMemory { .. } => false,
            Self::Stored { .. } => true,
            Self::Filter { source, .. }
            | Self::Head { source, .. }
            | Self::Tail { source, .. }
            | Self::Take { source, .. }
            | Self::Sample { source, .. }
            | Self::Shuffle { source, .. } => source.requires_scope(),
        }
    }

    /// Get the source plan (for transforms) or None (for sources).
    pub fn source(&self) -> Option<&Arc<LogicalPlan>> {
        match self {
            Self::InMemory { .. } | Self::Stored { .. } => None,
            Self::Filter { source, .. }
            | Self::Head { source, .. }
            | Self::Tail { source, .. }
            | Self::Take { source, .. }
            | Self::Sample { source, .. }
            | Self::Shuffle { source, .. } => Some(source),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use arbors_expr::lit;

    #[test]
    fn test_inmemory_source() {
        let plan = LogicalPlan::inmemory(Arc::new(InMemoryArbor::new()));
        assert!(plan.is_source());
        assert!(!plan.requires_scope());
    }

    #[test]
    fn test_stored_source() {
        let plan = LogicalPlan::stored("my_arbor");
        assert!(plan.is_source());
        assert!(plan.requires_scope());
    }

    #[test]
    fn test_filter_chain() {
        let source = LogicalPlan::stored("data");
        let filtered = source
            .filter(lit(true), LogicalFilterMode::Immediate)
            .filter(lit(false), LogicalFilterMode::Lazy);

        assert!(!filtered.is_source());
        assert!(filtered.requires_scope());
    }

    #[test]
    fn test_head_tail_chain() {
        let source = LogicalPlan::inmemory(Arc::new(InMemoryArbor::new()));
        let plan = source.head(10).tail(5);

        assert!(!plan.is_source());
        assert!(!plan.requires_scope());
    }

    // Compile-time assertions
    fn assert_send_sync<T: Send + Sync>() {}

    #[test]
    fn test_logical_plan_is_send_sync() {
        assert_send_sync::<LogicalPlan>();
        assert_send_sync::<Arc<LogicalPlan>>();
    }
}
```

**Verification**:
```bash
cargo build -p arbors-pipeline
cargo test -p arbors-pipeline logical_plan
```

**Gate B impact**: None (additive)

---

### Sub-Step 4.2: Add ArborScope Type to arbors Crate

**Goal**: Define scope binding enum for user-facing Arbor.

**Files**:
- MODIFY: `crates/arbors/src/handle.rs`

**Changes**:

Add near the top of handle.rs (after imports):

```rust
/// Scope binding for an Arbor handle.
///
/// Determines how stored data is accessed during execution.
#[derive(Clone, Debug)]
pub enum ArborScope {
    /// In-memory data, no scope needed.
    InMemory,
    /// Stored data, bound to a ReadScope for MVCC isolation.
    Scoped(Arc<ReadScope>),
}

impl ArborScope {
    /// Check if this is an in-memory scope.
    pub fn is_inmemory(&self) -> bool {
        matches!(self, Self::InMemory)
    }

    /// Get the ReadScope if this is a Scoped binding.
    pub fn as_scope(&self) -> Option<&Arc<ReadScope>> {
        match self {
            Self::Scoped(s) => Some(s),
            Self::InMemory => None,
        }
    }
}
```

**Verification**:
```bash
cargo build -p arbors
```

**Gate B impact**: None (additive)

---

### Sub-Step 4.3: Create New Arbor Structure (Parallel Path)

**Goal**: Add new `Arbor` fields (`plan`, `scope`) alongside existing `backing`.

**Critical**: This sub-step creates a **parallel path**. The old `backing` field remains functional. We add the new fields but don't use them yet, keeping Gate B green.

**Files**:
- MODIFY: `crates/arbors/src/handle.rs`

**Changes**:

Update the `Arbor` struct:

```rust
/// Unified handle for arbor data across all backing types.
///
/// # Two Implementation Paths (Step 4 Transition)
///
/// During Step 4 transition, Arbor maintains two paths:
/// - **Legacy path**: `backing` field (ArborBacking enum)
/// - **New path**: `plan` + `scope` fields (LogicalPlan-based)
///
/// The `plan` field is `Some` for newly created handles using the LogicalPlan
/// path. Legacy handles have `plan = None` and use `backing` exclusively.
///
/// Step 12 will delete the legacy path.
#[derive(Clone)]
pub struct Arbor {
    /// Legacy backing (Step 12: DELETE).
    backing: ArborBacking,

    /// NEW: Logical plan for this arbor (scope-free).
    ///
    /// When `Some`, this arbor uses the LogicalPlan execution path.
    /// When `None`, falls back to legacy `backing` path.
    plan: Option<Arc<LogicalPlan>>,

    /// NEW: Scope binding for stored data access.
    ///
    /// Only meaningful when `plan.is_some()` and plan requires scope.
    scope: ArborScope,
}
```

Update the existing constructors to set `plan: None, scope: ArborScope::InMemory`:

```rust
impl Arbor {
    /// Create an Arbor from an in-memory arbor value.
    pub fn from_inmemory(arbor: InMemoryArbor) -> Self {
        Self {
            backing: ArborBacking::InMemory(Arc::new(arbor)),
            plan: None,  // NEW
            scope: ArborScope::InMemory,  // NEW
        }
    }

    /// Create an Arbor from an Arc-wrapped in-memory arbor.
    pub fn from_inmemory_arc(arbor: Arc<InMemoryArbor>) -> Self {
        Self {
            backing: ArborBacking::InMemory(arbor),
            plan: None,  // NEW
            scope: ArborScope::InMemory,  // NEW
        }
    }

    /// Create an Arbor from a read scope (legacy path, uses ArborBacking::Scoped).
    pub fn from_scope(scope: Arc<ReadScope>, name: String, meta: ArborMeta) -> Self {
        Self {
            backing: ArborBacking::Scoped {
                scope: Arc::clone(&scope),
                name,
                meta,
            },
            plan: None,  // Legacy path
            scope: ArborScope::Scoped(scope),  // Store scope separately too
        }
    }

    /// Create an Arbor from a pre-constructed Filtered backing.
    #[doc(hidden)]
    pub fn from_filtered(
        source: Box<ArborBacking>,
        state: FilterState,
        pinned_generation: Option<u64>,
    ) -> Self {
        Self {
            backing: ArborBacking::Filtered {
                source,
                state,
                pinned_generation,
            },
            plan: None,  // Legacy path
            scope: ArborScope::InMemory,  // Will be set properly when we trace source
        }
    }

    // ... existing methods unchanged ...
}
```

**Verification**:
```bash
cargo build -p arbors
cargo test -p arbors
```

**Gate B impact**: All existing tests pass (legacy path unchanged)

---

### Sub-Step 4.4: Add LogicalPlan-Based Constructors

**Goal**: Add new constructors that use `LogicalPlan` instead of `ArborBacking`.

**Files**:
- MODIFY: `crates/arbors/src/handle.rs`
- MODIFY: `crates/arbors/src/lib.rs` (add re-exports)

**Changes**:

Add new constructors to `Arbor`:

```rust
impl Arbor {
    // ========================================================================
    // LogicalPlan-Based Constructors (Step 4 NEW PATH)
    // ========================================================================

    /// Create an Arbor from a logical plan and scope.
    ///
    /// This is the preferred constructor for the new LogicalPlan path.
    pub fn from_plan(plan: Arc<LogicalPlan>, scope: ArborScope) -> Self {
        // Create a minimal backing for compatibility during transition.
        // The backing is derived from the plan structure.
        let backing = derive_backing_from_plan(&plan, &scope);

        Self {
            backing,
            plan: Some(plan),
            scope,
        }
    }

    /// Create an in-memory Arbor using LogicalPlan.
    pub fn from_plan_inmemory(arbor: Arc<InMemoryArbor>) -> Self {
        let plan = LogicalPlan::inmemory(Arc::clone(&arbor));
        Self::from_plan(plan, ArborScope::InMemory)
    }

    /// Create a stored Arbor using LogicalPlan.
    ///
    /// The scope provides MVCC snapshot isolation for stored data access.
    pub fn from_plan_stored(scope: Arc<ReadScope>, name: impl Into<String>) -> Self {
        let plan = LogicalPlan::stored(name);
        Self::from_plan(plan, ArborScope::Scoped(scope))
    }

    // ========================================================================
    // Plan Access
    // ========================================================================

    /// Get the logical plan if using the new path.
    pub fn logical_plan(&self) -> Option<&Arc<LogicalPlan>> {
        self.plan.as_ref()
    }

    /// Check if this arbor uses the LogicalPlan path.
    pub fn uses_logical_plan(&self) -> bool {
        self.plan.is_some()
    }

    /// Get the scope binding.
    pub fn scope(&self) -> &ArborScope {
        &self.scope
    }
}

/// Derive a minimal ArborBacking from a LogicalPlan for compatibility.
///
/// This is a transitional helper that creates a backing structure matching
/// the plan. Step 12 will remove this when backing is deleted.
fn derive_backing_from_plan(plan: &Arc<LogicalPlan>, scope: &ArborScope) -> ArborBacking {
    match plan.as_ref() {
        LogicalPlan::InMemory { arbor } => {
            ArborBacking::InMemory(Arc::clone(arbor))
        }
        LogicalPlan::Stored { name } => {
            match scope {
                ArborScope::Scoped(s) => {
                    // Get metadata from scope
                    let meta = s.get_meta(name)
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| ArborMeta {
                            tree_count: 0,
                            batch_count: 0,
                            generation: 0,
                            schema_json: None,
                        });
                    ArborBacking::Scoped {
                        scope: Arc::clone(s),
                        name: name.clone(),
                        meta,
                    }
                }
                ArborScope::InMemory => {
                    // This shouldn't happen (Stored requires scope), but handle gracefully
                    panic!("Stored plan requires ArborScope::Scoped, got InMemory");
                }
            }
        }
        LogicalPlan::Filter { source, predicate, mode } => {
            let source_backing = derive_backing_from_plan(source, scope);
            let state = match mode {
                LogicalFilterMode::Immediate => {
                    // For compatibility, compute indices via legacy path
                    let indices = compute_indices_for_backing(&source_backing, predicate)
                        .unwrap_or_default();
                    FilterState::Immediate(indices)
                }
                LogicalFilterMode::Lazy => FilterState::Lazy {
                    predicate: predicate.clone(),
                    cached_indices: Arc::new(OnceLock::new()),
                },
            };
            let pinned_generation = match &source_backing {
                ArborBacking::Stored { meta, .. } => Some(meta.generation),
                ArborBacking::Scoped { .. } => None,
                ArborBacking::Filtered { pinned_generation, .. } => *pinned_generation,
                ArborBacking::InMemory(_) => None,
            };
            ArborBacking::Filtered {
                source: Box::new(source_backing),
                state,
                pinned_generation,
            }
        }
        LogicalPlan::Head { source, n } => {
            // Head is a filtered view with range indices
            let source_backing = derive_backing_from_plan(source, scope);
            let len = match &source_backing {
                ArborBacking::InMemory(a) => a.num_trees(),
                ArborBacking::Stored { meta, .. } | ArborBacking::Scoped { meta, .. } => {
                    meta.tree_count as usize
                }
                ArborBacking::Filtered { source, state, .. } => {
                    state.get_indices(source).map(|i| i.len()).unwrap_or(0)
                }
            };
            let count = std::cmp::min(*n, len);
            let indices: Vec<usize> = (0..count).collect();
            let pinned_generation = match &source_backing {
                ArborBacking::Stored { meta, .. } => Some(meta.generation),
                ArborBacking::Scoped { .. } => None,
                ArborBacking::Filtered { pinned_generation, .. } => *pinned_generation,
                ArborBacking::InMemory(_) => None,
            };
            ArborBacking::Filtered {
                source: Box::new(source_backing),
                state: FilterState::Immediate(indices),
                pinned_generation,
            }
        }
        LogicalPlan::Tail { source, n } => {
            let source_backing = derive_backing_from_plan(source, scope);
            let len = match &source_backing {
                ArborBacking::InMemory(a) => a.num_trees(),
                ArborBacking::Stored { meta, .. } | ArborBacking::Scoped { meta, .. } => {
                    meta.tree_count as usize
                }
                ArborBacking::Filtered { source, state, .. } => {
                    state.get_indices(source).map(|i| i.len()).unwrap_or(0)
                }
            };
            let start = len.saturating_sub(*n);
            let indices: Vec<usize> = (start..len).collect();
            let pinned_generation = match &source_backing {
                ArborBacking::Stored { meta, .. } => Some(meta.generation),
                ArborBacking::Scoped { .. } => None,
                ArborBacking::Filtered { pinned_generation, .. } => *pinned_generation,
                ArborBacking::InMemory(_) => None,
            };
            ArborBacking::Filtered {
                source: Box::new(source_backing),
                state: FilterState::Immediate(indices),
                pinned_generation,
            }
        }
        LogicalPlan::Take { source, indices } => {
            let source_backing = derive_backing_from_plan(source, scope);
            let pinned_generation = match &source_backing {
                ArborBacking::Stored { meta, .. } => Some(meta.generation),
                ArborBacking::Scoped { .. } => None,
                ArborBacking::Filtered { pinned_generation, .. } => *pinned_generation,
                ArborBacking::InMemory(_) => None,
            };
            ArborBacking::Filtered {
                source: Box::new(source_backing),
                state: FilterState::Immediate(indices.clone()),
                pinned_generation,
            }
        }
        LogicalPlan::Sample { source, n, seed } => {
            // Delegate to existing sample logic
            let source_arbor = Arbor {
                backing: derive_backing_from_plan(source, scope),
                plan: None,
                scope: scope.clone(),
            };
            source_arbor.sample(*n, *seed)
                .map(|a| a.backing)
                .unwrap_or_else(|_| derive_backing_from_plan(source, scope))
        }
        LogicalPlan::Shuffle { source, seed } => {
            let source_arbor = Arbor {
                backing: derive_backing_from_plan(source, scope),
                plan: None,
                scope: scope.clone(),
            };
            source_arbor.shuffle(*seed)
                .map(|a| a.backing)
                .unwrap_or_else(|_| derive_backing_from_plan(source, scope))
        }
    }
}
```

**Verification**:
```bash
cargo build -p arbors
cargo test -p arbors
```

**Gate B impact**: None (existing tests use legacy constructors)

---

### Sub-Step 4.5: Update Operations to Build LogicalPlan

**Goal**: Modify `filter()`, `head()`, `tail()`, etc. to build plan nodes when using the new path.

**Files**:
- MODIFY: `crates/arbors/src/handle.rs`

**Changes**:

Update each operation method to check for `plan` and build plan nodes:

```rust
impl Arbor {
    /// Filter trees matching a predicate.
    pub fn filter(&self, predicate: &Expr, mode: FilterMode) -> Result<Self, PipelineError> {
        validate_not_stale(&self.backing)?;

        // If using LogicalPlan path, build new plan node
        if let Some(ref plan) = self.plan {
            let logical_mode = match mode {
                FilterMode::Immediate => LogicalFilterMode::Immediate,
                FilterMode::Lazy => LogicalFilterMode::Lazy,
            };
            let new_plan = plan.filter(predicate.clone(), logical_mode);
            return Ok(Self::from_plan(new_plan, self.scope.clone()));
        }

        // Legacy path (unchanged)
        let state = match mode {
            FilterMode::Immediate => {
                let indices = compute_indices_for_backing(&self.backing, predicate)?;
                FilterState::Immediate(indices)
            }
            FilterMode::Lazy => FilterState::Lazy {
                predicate: predicate.clone(),
                cached_indices: Arc::new(OnceLock::new()),
            },
        };

        let pinned_generation = match &self.backing {
            ArborBacking::Stored { meta, .. } => Some(meta.generation),
            ArborBacking::Scoped { .. } => None,
            ArborBacking::Filtered { pinned_generation, .. } => *pinned_generation,
            ArborBacking::InMemory(_) => None,
        };

        Ok(Self {
            backing: ArborBacking::Filtered {
                source: Box::new(self.backing.clone()),
                state,
                pinned_generation,
            },
            plan: None,
            scope: self.scope.clone(),
        })
    }

    /// Get the first N trees as a new arbor view.
    pub fn head(&self, n: usize) -> Result<Self, PipelineError> {
        validate_not_stale(&self.backing)?;

        // If using LogicalPlan path, build new plan node
        if let Some(ref plan) = self.plan {
            let new_plan = plan.head(n);
            return Ok(Self::from_plan(new_plan, self.scope.clone()));
        }

        // Legacy path (unchanged)
        // ... existing implementation ...
    }

    /// Get the last N trees as a new arbor view.
    pub fn tail(&self, n: usize) -> Result<Self, PipelineError> {
        validate_not_stale(&self.backing)?;

        // If using LogicalPlan path, build new plan node
        if let Some(ref plan) = self.plan {
            let new_plan = plan.tail(n);
            return Ok(Self::from_plan(new_plan, self.scope.clone()));
        }

        // Legacy path (unchanged)
        // ... existing implementation ...
    }

    /// Take trees at specific indices.
    pub fn take(&self, indices: &[usize]) -> Result<Self, PipelineError> {
        validate_not_stale(&self.backing)?;
        let len = self.len()?;

        // Validate indices
        for &idx in indices {
            if idx >= len {
                return Err(PipelineError::IndexOutOfBounds { index: idx, count: len });
            }
        }

        // If using LogicalPlan path, build new plan node
        if let Some(ref plan) = self.plan {
            let new_plan = plan.take(indices.to_vec());
            return Ok(Self::from_plan(new_plan, self.scope.clone()));
        }

        // Legacy path (unchanged)
        // ... existing implementation ...
    }

    // Similar updates for sample() and shuffle()...
}
```

**Verification**:
```bash
cargo build -p arbors
cargo test -p arbors
```

**Gate B impact**: None (legacy path still default)

---

### Sub-Step 4.6: Add Integration Tests for LogicalPlan Path

**Goal**: Verify the new LogicalPlan path works correctly.

**Files**:
- NEW: `crates/arbors/tests/logical_plan_tests.rs`

**Changes**:

Create test file:

```rust
//! Integration tests for LogicalPlan-based Arbor handles.

use std::sync::Arc;

use arbors::{Arbor, ArborScope, FilterMode, ReadScope, Session};
use arbors_pipeline::{LogicalPlan, LogicalFilterMode};
use arbors_expr::{lit, path};

/// Test in-memory arbor via LogicalPlan path.
#[test]
fn test_inmemory_via_logical_plan() {
    let arbor_data = arbors_io::read_jsonl(
        br#"{"id": 1, "name": "Alice"}
{"id": 2, "name": "Bob"}
{"id": 3, "name": "Carol"}"#,
        None,
    ).unwrap();

    let arbor = Arbor::from_plan_inmemory(Arc::new(arbor_data));
    assert!(arbor.uses_logical_plan());

    assert_eq!(arbor.len().unwrap(), 3);

    // Filter via LogicalPlan
    let filtered = arbor.filter(&path("id").gt(lit(1)), FilterMode::Immediate).unwrap();
    assert!(filtered.uses_logical_plan());
    assert_eq!(filtered.len().unwrap(), 2);

    // Head/tail via LogicalPlan
    let first_two = arbor.head(2).unwrap();
    assert!(first_two.uses_logical_plan());
    assert_eq!(first_two.len().unwrap(), 2);

    let last_one = arbor.tail(1).unwrap();
    assert!(last_one.uses_logical_plan());
    assert_eq!(last_one.len().unwrap(), 1);
}

/// Test stored arbor via LogicalPlan path.
#[test]
fn test_stored_via_logical_plan() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("test.arbors");

    let session = Arc::new(Session::open(&path).unwrap());

    // Write some data
    {
        let mut write = session.write().unwrap();
        let data = arbors_io::read_jsonl(
            br#"{"id": 1}
{"id": 2}
{"id": 3}"#,
            None,
        ).unwrap();
        write.put("test", &data, None).unwrap();
        write.commit().unwrap();
    }

    // Create via LogicalPlan path
    let scope = session.read().unwrap();
    let arbor = Arbor::from_plan_stored(Arc::clone(&scope), "test");
    assert!(arbor.uses_logical_plan());
    assert_eq!(arbor.len().unwrap(), 3);

    // Operations build plan nodes
    let filtered = arbor.filter(&path("id").gt(lit(1)), FilterMode::Lazy).unwrap();
    assert!(filtered.uses_logical_plan());
    assert_eq!(filtered.len().unwrap(), 2);
}

/// Test that filter chains build flat plan structures.
#[test]
fn test_filter_chain_is_flat() {
    let arbor_data = arbors_io::read_jsonl(
        br#"{"a": 1, "b": 2}
{"a": 2, "b": 3}
{"a": 3, "b": 4}"#,
        None,
    ).unwrap();

    let arbor = Arbor::from_plan_inmemory(Arc::new(arbor_data));

    // Chain multiple filters
    let result = arbor
        .filter(&path("a").gt(lit(0)), FilterMode::Immediate).unwrap()
        .filter(&path("b").lt(lit(4)), FilterMode::Immediate).unwrap()
        .filter(&path("a").gt(lit(1)), FilterMode::Immediate).unwrap();

    // All operations should use LogicalPlan
    assert!(result.uses_logical_plan());

    // Verify result is correct
    assert_eq!(result.len().unwrap(), 1); // Only {a: 2, b: 3} matches all
}

/// Verify MVCC isolation with LogicalPlan path.
#[test]
fn test_mvcc_isolation_via_logical_plan() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("test.arbors");

    let session = Arc::new(Session::open(&path).unwrap());

    // Initial write
    {
        let mut write = session.write().unwrap();
        let data = arbors_io::read_jsonl(b"{\"id\": 1}", None).unwrap();
        write.put("data", &data, None).unwrap();
        write.commit().unwrap();
    }

    // Create arbor via LogicalPlan BEFORE second write
    let scope1 = session.read().unwrap();
    let arbor1 = Arbor::from_plan_stored(Arc::clone(&scope1), "data");

    // Second write
    {
        let mut write = session.write().unwrap();
        let data = arbors_io::read_jsonl(b"{\"id\": 1}\n{\"id\": 2}", None).unwrap();
        write.put("data", &data, None).unwrap();
        write.commit().unwrap();
    }

    // Create arbor via LogicalPlan AFTER second write
    session.refresh().unwrap();
    let scope2 = session.read().unwrap();
    let arbor2 = Arbor::from_plan_stored(Arc::clone(&scope2), "data");

    // arbor1 should still see old data (MVCC isolation)
    assert_eq!(arbor1.len().unwrap(), 1);

    // arbor2 should see new data
    assert_eq!(arbor2.len().unwrap(), 2);
}
```

**Verification**:
```bash
cargo test -p arbors logical_plan_tests
```

---

### Sub-Step 4.7: Verify All Gates

**Goal**: Ensure Gates A and B remain green.

**Verification**:
```bash
# Gate A - Invariants
cargo test -p arbors --test invariants

# Gate B - Full test suites
cargo test
make python && .venv/bin/pytest python/tests -v
```

---

### Sub-Step 4.8: Documentation and Cleanup

**Goal**: Add documentation, mark legacy code for deletion.

**Files**:
- MODIFY: `crates/arbors/src/handle.rs` (add REFACTOR FIXME comments)
- MODIFY: `crates/arbors-pipeline/src/logical_plan.rs` (documentation)

**Changes**:

Add REFACTOR FIXME comments to legacy code:

```rust
/// REFACTOR FIXME(Step 12): Delete this enum when LogicalPlan migration is complete.
/// All arbor operations should go through LogicalPlan by then.
#[derive(Clone)]
pub enum ArborBacking {
    // ...
}

/// REFACTOR FIXME(Step 12): Delete this enum when LogicalPlan migration is complete.
#[derive(Clone)]
pub enum FilterState {
    // ...
}

/// REFACTOR FIXME(Step 12): Delete this function when backing is removed.
fn compute_indices_for_backing(...) { ... }
```

---

### Sub-Step 4.9: Commit Step 4

**Goal**: Commit all Step 4 changes.

**Commit message**:
```
feat: Step 4 - Logical Plan Handles

- Add LogicalPlan enum to arbors-pipeline (scope-free plan DAG)
- Add ArborScope enum for execution binding
- Add parallel LogicalPlan path to Arbor struct
- Operations build plan nodes when using new path
- Derive backing from plan for compatibility during transition
- Add integration tests for LogicalPlan path

LogicalPlan is scope-free; Stored sources bind to ReadScope at
execution time. This enables plan optimization without I/O handles.

Legacy ArborBacking path remains functional. Step 12 will delete it.
```

---

## Summary

| Sub-Step | Description | Risk | Gate B |
|----------|-------------|------|--------|
| 4.1 | Define LogicalPlan type | Low | Unchanged |
| 4.2 | Add ArborScope type | Low | Unchanged |
| 4.3 | Add new Arbor fields (parallel path) | Medium | Must pass |
| 4.4 | Add LogicalPlan-based constructors | Medium | Must pass |
| 4.5 | Update operations to build plan nodes | Medium | Must pass |
| 4.6 | Add integration tests | Low | Validates |
| 4.7 | Verify all gates | Low | Must pass |
| 4.8 | Documentation and cleanup | Low | Unchanged |
| 4.9 | Commit | Low | N/A |

**No atomic pairs**: Each sub-step is independently verifiable and leaves the codebase in a valid state.

---

## Files Summary

| File | Action |
|------|--------|
| `crates/arbors-pipeline/src/logical_plan.rs` | NEW |
| `crates/arbors-pipeline/src/lib.rs` | MODIFY (add mod + export) |
| `crates/arbors/src/handle.rs` | MODIFY (ArborScope, new Arbor fields, plan-based ops) |
| `crates/arbors/src/lib.rs` | MODIFY (re-exports) |
| `crates/arbors/tests/logical_plan_tests.rs` | NEW |

---

## Key Questions Addressed

### 1. Where should LogicalPlan live?

**Answer**: `arbors-pipeline`. This is confirmed by the architecture plan and makes sense because:
- Pipeline owns the execution engine
- Plan is input to execution
- Optimizer and cost model will live alongside plan
- Avoids crate cycles

### 2. How does ArborBacking relate to LogicalPlan?

**Answer**: They are **parallel structures during transition**:
- `ArborBacking` is the legacy recursive enum (nested boxes)
- `LogicalPlan` is the new flat DAG (Arc-based references)
- During Step 4, both exist; `derive_backing_from_plan()` creates backing from plan for compatibility
- Step 12 will delete `ArborBacking` entirely

### 3. What's the execution binding contract?

**Answer**:
- `LogicalPlan` is **scope-free** (no `ReadScope` in the plan)
- `Arbor` holds `ArborScope` (either `InMemory` or `Scoped(Arc<ReadScope>)`)
- At execution time, `Arbor` provides scope to executor via `ExecContext`
- `LogicalPlan::Stored { name }` resolves to `ctx.txn().get_batched(name)`

### 4. What operations need to change?

**Answer**: `filter()`, `head()`, `tail()`, `take()`, `sample()`, `shuffle()` need to:
- Check if `self.plan.is_some()`
- If yes, build a new plan node and return `Arbor::from_plan(...)`
- If no, use the legacy backing path (unchanged)

### 5. How do we keep Gate B green?

**Answer**: By maintaining the **parallel path strategy**:
- Add new fields (`plan`, `scope`) to `Arbor` without removing `backing`
- Existing constructors set `plan: None`, keeping legacy path active
- New constructors (`from_plan_inmemory`, `from_plan_stored`) activate new path
- `derive_backing_from_plan()` creates compatible backing for legacy operations
- All existing tests continue using legacy constructors and pass unchanged
