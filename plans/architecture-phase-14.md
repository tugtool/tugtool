## Phase 14: Design for API Parity with Polars and jq

**Purpose:** Build an implementable, testable design for API parity with Polars and jq by (1) mapping mental models, (2) locking cross-cutting semantics, (3) specifying a rubric for parity gaps, and (4) producing phased, executable implementation work (14a–14d) with crisp deliverables and checkpoints.

**Status:** In Progress (Step 0 and Step 1 (14a) complete; Steps 2–4 (14b–14d) pending)

**Scope:**
1. Mental model mapping (Polars vs jq vs Arbors) and mapping implications
2. Gap entry rubric (Surface/Semantics/Cost/Zero-copy/Location/Target)
3. Locked design decisions (D1–D6) that prevent semantic drift
4. Gap analysis (with rubric) for priority operations
5. Accuracy corrections for semantically-off mappings
6. Revised priority matrix (with Zero-copy and Complexity)
7. Implementation sub-phases (14a–14d) with deliverables and checkpoints
8. API inventory maintenance plan for `docs/API.md`
9. Required prerequisite code alignment (already implemented) to support Phase 14 semantics

**Non-goals (explicitly out of scope):**
- Comprehensive parity with all Polars APIs (e.g., pivot/melt/window functions) in Phase 14
- Streaming jq-style CLI execution model (Arbors remains in-memory)
- Phase-14 write-path “path surgery” APIs (`setpath`, `delpaths`) beyond read-only parity
- Implementing CSV/Parquet I/O in Phase 14 (listed as P2)

**Dependencies / prerequisites:**
- `docs/API.md` (point-in-time inventory) used as input for parity analysis
- Existing crates and APIs:
  - `arbors-storage`: `Arbor`, `ArborView`, `TableOps`, `GroupKey`, `GroupedTable`
  - `arbors-expr`: `Expr`, `ExprResult`, `PathSegment` (including `@` / current)
  - `arbors-query`: free functions, `QueryOps`, comparator/canonicalization utilities
  - `arbors-lazy`: `LazyArbor` (must follow the same semantic contracts)
- Existing semantics from Phase 13 (notably missing vs null as distinct at the node level)

**Reference Documents:**
- [Arbors API Summary](../docs/API.md) - Current Arbors API (point-in-time snapshot, not authoritative)
- [Polars Rust API](https://docs.rs/polars/latest/polars/)
- [Polars Python API](https://docs.pola.rs/api/python/stable/reference/index.html)
- [jq Manual](https://jqlang.org/manual/)

---

### 14.0 Design Decisions (LOCKED)

> These decisions are normative for Phase 14 and all follow-on phases (14a–14d). They exist to prevent semantic drift and to ensure parity work doesn’t fork across crates.

#### D1: Total Order Everywhere (DECIDED)

**Decision:** One comparison system. No errors on cross-type. No variants.

**The Ladder** (global, used everywhere):
```
Bool(false) < Bool(true) < Int < Float < NaN < String < Array < Object < Null < Missing
```

Within each type: natural ordering (numeric comparison, lexicographic for strings, element-wise for arrays/objects).

Cross-type: use type position in ladder.

| Operation | Behavior |
|-----------|----------|
| `sort_by` | Uses ladder. Never errors on mixed types. |
| `group_by` | Uses ladder. Null and Missing form **separate groups**. |
| `distinct` | Uses ladder. Null ≠ Missing. |
| `join` | Null keys don't match (null ≠ null for join purposes). |
| Aggregations | Type-specific where it matters (`sum` on non-numeric → null, not error). |

**Rationale:**
- One way: no mental overhead about which variant to use
- jq-compatible: everything comparable, no surprises
- Preserves semantics: null and missing remain distinct
- No runtime errors for common operations on heterogeneous JSON

**Implications:**
- Sorting/grouping/comparison codepaths must share a single comparator contract
- Any “missing” vs “null” distinction must flow through `ExprResult`/comparators, not be erased

---

#### D2: Null vs Missing — DISTINCT EVERYWHERE (DECIDED)

**Decision:** Null and Missing are semantically different and remain distinct through all operations:

- **Null**: Explicit JSON `null` value
- **Missing**: Field does not exist

This distinction is preserved in:
- `GroupKey` ordering (already implemented in `table_ops.rs`)
- `ExprResult` comparisons (requires adding `ExprResult::Missing` variant)
- All query operations (`sort_by`, `group_by`, `distinct`, `join`)
- Python bindings

**Code Changes Required (implemented; see 14.1.8 / 14.5 Step 0):**
1. Add `ExprResult::Missing` variant to `arbors-expr`
2. Update `total_cmp_expr_results` in `collection_ops.rs` to use new ladder
3. Update ArborView expression evaluation to return `Missing` instead of `Null` for missing fields
4. Verify `GroupKey` alignment (already correct)

---

#### D3: Join Output Shape — NESTED (DECIDED)

**Decision:** Join produces **nested objects** by default to avoid field collisions:

```json
// left: {"id": 1, "name": "Alice"}
// right: {"id": 1, "dept": "Engineering"}
// join result:
{"left": {"id": 1, "name": "Alice"}, "right": {"id": 1, "dept": "Engineering"}}
```

**Rationale:** Safer default; no suffix collision issues. Can add `flatten_join` or configuration later.

**Null/Missing Policy:**
- Null keys: do **not** match by default (null != null in join context)
- Missing keys: treated as missing (excluded from inner join; included in outer with null)

---

#### D4: Explode Target Types (DECIDED)

**Decision:** Support explode on all three target types with clear semantics:

| Target | Behavior |
|--------|----------|
| `Arbor` | Each tree with array at path P of length N becomes N trees. Zero-copy where possible (Arc-share unchanged subtrees). |
| `Tree` | Returns `Arbor` (not `Tree`). Explode naturally produces multiple documents. |
| `ArborView` | **Materializes** to new Arbor, then explodes. Cannot stay zero-copy because row expansion changes cardinality. |

**API:**
```rust
// QueryOps (for Arbor)
fn explode(&self, path: &Expr) -> Result<Arbor>;

// Tree method
fn explode(&self, path: &Expr) -> Result<Arbor>;

// ArborView (materializes)
fn explode(&self, path: &Expr) -> Result<Arbor>;  // Note: returns Arbor, not ArborView
```

---

#### D5: keys/values/to_entries on Non-Object — CONFIGURABLE (DECIDED)

**Decision:** Behavior on non-object types is **configurable** via optional parameter:

| Input Type | Strict Mode (default) | Lenient Mode |
|------------|----------------------|--------------|
| Object | Returns keys/values/entries | Same |
| Array | Error | `keys` → `[0, 1, 2, ...]`, `values` → identity |
| Scalar | Error | `keys` → `[]`, `values` → `[scalar]` |
| Null/Missing | Error | Returns null |

**API:**
```rust
// Default (strict)
path("obj").keys()  // error if not object

// Lenient
path("obj").keys_lenient()  // or configure via EvalContext
```

---

#### D6: Path Surgery — READ-ONLY FOR PHASE 14 (DECIDED)

**Decision:** Phase 14 focuses on **read-only** path operations (`keys`, `values`, `to_entries`, `paths`). Write operations (`setpath`, `delpaths`) align with Phase 13.10c (ArborViewEditPlan).

---

### 14.1 Specification

> This section is the contract for Phase 14 and the follow-on implementation phases (14a–14d). It must be complete enough that implementation proceeds without inventing semantics.

#### 14.1.1 Inputs and Outputs (Data Model)

**Inputs:**
- Existing Arbors codebase API surface (documented approximately in `docs/API.md`)
- Polars API references (Rust and Python)
- jq manual (filters, functions, and semantics)

**Outputs:**
- A parity mapping (mental model mapping + implications)
- A normalized gap rubric and rubric-complete gap entries for priority operations
- Locked semantics for comparison/order and for high-impact operations (join/explode/keys family)
- A phased plan (14a–14d) with symbols, tests, and checkpoints

**Key invariants:**
- Semantic decisions D1–D6 apply consistently across `arbors-storage`, `arbors-expr`, `arbors-query`, `arbors-lazy`, and Python bindings.
- Parity claims in this phase are either:
  - **Present** (and verifiable in code), or
  - **Gap** (specified with rubric), or
  - **Not applicable / deferred**.

#### 14.1.2 Terminology and Naming

- **Polars (tabular-first)**: DataFrame/Series/LazyFrame; assumes rectangularity.
- **jq (JSON-stream-first)**: filter pipeline over stream; generators (one input → many outputs).
- **Arbors (tree-first + tabular overlays)**: Arbor/Tree, optional ArborView projection, Expr evaluation.
- **Gap Entry Rubric**: Surface / Semantics / Cost / Zero-copy / Location / Target.

#### 14.1.3 Supported Features (Exhaustive)

- **Supported (this phase ships):**
  - Mental model mapping and mapping implications (Section 14.1.9)
  - Gap rubric (Section 14.1.10)
  - Locked decisions D1–D6 (Section 14.0)
  - Rubric-complete gap analysis entries for priority operations (Section 14.1.11)
  - Accuracy corrections for prior mis-mappings (Section 14.1.12)
  - Priority matrix and phased deliverables (Sections 14.1.13–14.1.14)
  - API inventory maintenance stance (Section 14.1.15)

- **Explicitly not supported (in Phase 14 proper):**
  - Implementing all gap items (implementation is tracked in 14a–14d)
  - Write-path parity for jq `setpath` / `delpaths` (deferred to Phase 13.10c)

#### 14.1.4 Modes / Policies

| Mode/Policy | Applies to | Behavior | Result |
|------------|------------|----------|--------|
| Strict vs Lenient keys/values | `keys`, `values` | Strict errors on non-object; Lenient adapts arrays/scalars | `ExprResult::Array` or error |
| JoinType | `join` | Inner/Left/Right/Outer | Materialized Arbor |
| Explode target | Arbor / Tree / ArborView | Arbor expands trees; Tree returns Arbor; ArborView materializes then expands | Arbor |

#### 14.1.5 Semantics (Normative Rules)

- **Comparison total order (D1):**
  - Global ladder: `Bool(false) < Bool(true) < Int < Float < NaN < String < Array < Object < Null < Missing`.
  - Arrays: element-by-element; shorter prefix is smaller.
  - Objects: compare by sorted key-value pairs.
- **Null vs missing (D2):**
  - Null and Missing are distinct values and remain distinct in sort/group/distinct/join.
- **Join (D3):**
  - Output is nested object `{left: <tree>, right: <tree>}`.
  - Null join keys do not match by default.
  - Missing keys excluded from inner; in outer joins, missing side appears as null.
- **Explode (D4):**
  - Non-array values pass through unchanged.
  - Empty array excludes row.
- **keys/values family (D5):**
  - Strict mode errors on non-object.
  - Lenient mode adapts arrays/scalars per table.

#### 14.1.6 Error and Warning Model

**Error fields (required):**
- **kind**: stable error code
- **message**: developer-readable explanation
- **operation**: operation name (e.g., `keys`, `join`, `explode`)
- **path** (if relevant): data path (string form; consistent with existing path syntax)

**Warnings:**
- Phase 14 does not introduce a warning channel; all surfaced issues are errors or explicit “deferred/not applicable” entries.

#### 14.1.7 Public API Surface (Phase 14 planned APIs)

> This section aggregates API signatures from the rubric entries. These are implemented across 14a–14d.

**Rust (sketch level; see per-gap tables for semantics):**
```rust
// Query-level
pub enum JoinType { Inner, Left, Right, Outer }

pub fn join(left: &Arbor, right: &Arbor, on: &[Expr], how: JoinType) -> Result<Arbor>;

impl Arbor {
    pub fn explode(&self, path: &Expr) -> Result<Arbor>;
}

impl Tree {
    pub fn explode(&self, path: &Expr) -> Result<Arbor>;
}

impl<'a> ArborView<'a> {
    pub fn explode(&self, path: &Expr) -> Result<Arbor>;
}

// TableOps additions
pub trait TableOps: Sized {
    fn sample(&self, n: usize, seed: Option<u64>) -> Self;
    fn shuffle(&self, seed: Option<u64>) -> Self;
}

// Expr-level
impl Expr {
    pub fn is_in(self, list: Expr) -> Expr;

    pub fn keys(self) -> Expr;
    pub fn keys_lenient(self) -> Expr;

    pub fn values(self) -> Expr;
    pub fn values_lenient(self) -> Expr;

    pub fn to_entries(self) -> Expr;
    pub fn from_entries(self) -> Expr;

    pub fn map(self, f: Expr) -> Expr;

    pub fn abs(self) -> Expr;
    pub fn round(self, decimals: i32) -> Expr;
    pub fn floor(self) -> Expr;
    pub fn ceil(self) -> Expr;
    pub fn modulo(self, divisor: Expr) -> Expr;
    pub fn pow(self, exponent: Expr) -> Expr;

    pub fn weekday(self) -> Expr;
    pub fn week(self) -> Expr;
    pub fn quarter(self) -> Expr;
    pub fn epoch(self) -> Expr;

    pub fn strip_prefix(self, prefix: &str) -> Expr;
    pub fn strip_suffix(self, suffix: &str) -> Expr;
}
```

**Python:**
- Phase 14 defines parity targets; binding surfaces follow Rust shapes (PyO3).

#### 14.1.8 Internal Architecture

- **Single source of truth:** The D1 ladder and D2 null-vs-missing distinction must be represented once and reused by:
  - `GroupKey::Ord` (storage/table ops)
  - `ExprResult` comparator/canonicalization (query)
  - Lazy execution (lazy)
  - Python bindings (mapping Missing/Null)

- **Where code lives:**
  - Expr variants in `arbors-expr/src/expr.rs`
  - ExprResult semantics in `arbors-expr/src/result.rs`
  - Sorting/grouping/join/explode in `arbors-query`
  - TableOps extensions (`sample`, `shuffle`) in `arbors-storage/src/table_ops.rs`

- **Non-negotiable invariants to prevent drift:**
  - Comparator ladder is documented and tested (unit tests)
  - Missing vs null distinction has explicit tests in comparator/canonicalization
  - `docs/API.md` is treated as approximate inventory and updated per sub-phase

#### 14.1.9 Mental Model Mapping (Polars vs jq vs Arbors)

### Polars: Tabular-First

Polars sees data as **flat tables** with typed columns:
- **DataFrame**: collection of Series (columns)
- **Series**: 1D typed array
- **LazyFrame**: deferred DataFrame with query optimization
- Operations: column selection, row filtering, joins, window functions, explode/unnest

**Key assumption**: Data is rectangular. Nested structures are edge cases to be flattened.

### jq: JSON-Stream-First

jq sees data as **a stream of JSON values** flowing through filters:
- **Identity (`.`)**: pass through
- **Filters**: transform or select from the stream
- **Generators**: produce multiple outputs from one input
- Operations: path navigation, recursion, map/reduce combinators, formatting

**Key assumption**: One value in, zero-or-more values out. Everything is composable via pipes.

### Arbors: Tree-First with Tabular Overlays

Arbors sees data as **a forest of typed trees** with optional tabular projections:
- **Arbor**: collection of Trees (each tree is a JSON document)
- **Tree**: single document with hierarchical structure preserved
- **ArborView**: zero-copy tabular projection over columnar arrays within a tree
- **Expr**: declarative query language evaluated against trees

**Key assumptions**:
1. Hierarchical structure matters (not just "nested columns to unnest")
2. Schema is optional but guides storage decisions
3. COW semantics: operations return new views/arbors sharing underlying storage
4. Two evaluation contexts: per-tree (scalar result) and across-trees (collection result)

### Mapping Implications

| Polars Concept | Arbors Equivalent | Notes |
|---------------|-------------------|-------|
| DataFrame | Arbor | Collection of rows/trees |
| Series | No direct equivalent | Use path expressions for column access |
| LazyFrame | LazyArbor | Query planning with optimization |
| Column ops | Expr on path | `path("col").sum()` instead of `df["col"].sum()` |
| Row ops | Tree/filter | `.filter()`, `.head()`, `.tail()` |
| Nested → flat | ArborView | Columnar projection of nested structure |
| Join | **gap** | Needs design (see below) |
| Explode | **gap** | Different semantics (see below) |

| jq Concept | Arbors Equivalent | Notes |
|------------|-------------------|-------|
| `.` | `path("")` or root | Identity |
| `.foo` | `path("foo")` | Field access |
| `.[0]` | `path("[0]")` | Index access |
| `.[]` | `path("[*]")` | Wildcard iteration |
| `\|` | Method chaining / Expr composition | `a.and(b)` not `a \| b` |
| `select(f)` | `.filter(&f)` | Predicate filtering |
| `map(f)` | **gap** | Apply expr to each element |
| `to_entries` | **gap** | Object introspection |
| `setpath` | **gap** | Tree mutation (vs read-only expr) |

#### 14.1.10 Gap Entry Rubric

Each gap item must specify:

| Dimension | Description |
|-----------|-------------|
| **Surface** | Where it lives in the API: `Expr` variant, trait method (`QueryOps`, `TableOps`), free function, or type method |
| **Semantics** | Precise behavior in Arbors context, including edge cases (null, missing, mixed types) |
| **Cost** | Time/space complexity; whether it can short-circuit |
| **Zero-copy** | Can operate via `row_indices` alone, or requires materialization/tree rewrite |
| **Location** | Crate and module: `arbors-expr`, `arbors-query`, `arbors-storage`, etc. |
| **Target** | Rust API, Python binding, or both |

#### 14.1.11 Gap Analysis with Rubric (Priority operations)

### 14.1.11.1 Query-Level Operations

##### `join` — Join two arbors on key expressions

| Dimension | Specification |
|-----------|---------------|
| **Surface** | Free function `join(left, right, on, how) -> Result<Arbor>` in `arbors-query` |
| **Semantics** | For each pair of trees (l, r) where `on` evaluates equal, produce tree `{left: l, right: r}`. Inner join excludes non-matching. **Null keys do not match.** Missing keys excluded from inner, included as null in outer. |
| **Cost** | O(n + m) with hash join. Memory: O(min(n, m)) for hash table. |
| **Zero-copy** | No. Must materialize new trees. |
| **Location** | `arbors-query/src/join.rs` |
| **Target** | Rust + Python |

**API Sketch**:
```rust
pub enum JoinType { Inner, Left, Right, Outer }

pub fn join(
    left: &Arbor,
    right: &Arbor,
    on: &[Expr],       // key expressions (evaluated on both sides)
    how: JoinType,
) -> Result<Arbor>;
```

##### `explode` — Expand rows by array elements

| Dimension | Specification |
|-----------|---------------|
| **Surface** | `Arbor::explode(&Expr) -> Result<Arbor>`, `Tree::explode(&Expr) -> Result<Arbor>`, `ArborView::explode(&Expr) -> Result<Arbor>` |
| **Semantics** | Evaluate `path` to array of N elements. Produce N trees, each with array replaced by one element. Non-array: pass through unchanged. Empty array: row excluded. |
| **Cost** | O(total elements across all arrays). Memory: proportional to expansion factor. |
| **Zero-copy** | Arbor: partial (Arc-share unchanged subtrees). ArborView: no (materializes first). |
| **Location** | `arbors-query/src/explode.rs` |
| **Target** | Rust + Python |

##### `sample` — Random sampling

| Dimension | Specification |
|-----------|---------------|
| **Surface** | `TableOps::sample(&self, n: usize, seed: Option<u64>) -> Self` |
| **Semantics** | Return n random trees (without replacement). Seed for reproducibility. |
| **Cost** | O(n) with reservoir sampling. |
| **Zero-copy** | Yes. Returns `slice_by_indices()` on random indices. |
| **Location** | `arbors-storage/src/table_ops.rs` |
| **Target** | Rust + Python |

##### `shuffle` — Random reordering

| Dimension | Specification |
|-----------|---------------|
| **Surface** | `TableOps::shuffle(&self, seed: Option<u64>) -> Self` |
| **Semantics** | Return all trees in random order. |
| **Cost** | O(n) for index generation. |
| **Zero-copy** | Yes. |
| **Location** | `arbors-storage/src/table_ops.rs` |
| **Target** | Rust + Python |

### 14.1.11.2 Expression-Level Operations

##### `is_in` — Check if value is in a list

| Dimension | Specification |
|-----------|---------------|
| **Surface** | `Expr::is_in(&self, list: Expr) -> Expr` |
| **Semantics** | True if self's value appears in list. Strict equality (no cross-type matching). Null in list matches null value. |
| **Cost** | O(n) per value; O(1) with HashSet for literal lists. |
| **Zero-copy** | Yes. Expression evaluation. |
| **Location** | `arbors-expr/src/expr.rs` (new variant `IsIn`) |
| **Target** | Rust + Python |

##### `keys` — Object keys as array

| Dimension | Specification |
|-----------|---------------|
| **Surface** | `Expr::keys(&self) -> Expr` (strict), `Expr::keys_lenient(&self) -> Expr` |
| **Semantics** | **Strict**: Object → array of key strings; non-object → error. **Lenient**: Array → `[0,1,2,...]`; scalar → `[]`. |
| **Cost** | O(k). |
| **Zero-copy** | Yes. |
| **Location** | `arbors-expr/src/expr.rs` (new variant `Keys { lenient: bool }`) |
| **Target** | Rust + Python |

##### `values` — Object values as array

| Dimension | Specification |
|-----------|---------------|
| **Surface** | `Expr::values(&self) -> Expr` (strict), `Expr::values_lenient(&self) -> Expr` |
| **Semantics** | **Strict**: Object → array of values; non-object → error. **Lenient**: Array → identity; scalar → `[scalar]`. |
| **Cost** | O(k). |
| **Zero-copy** | Yes. |
| **Location** | `arbors-expr/src/expr.rs` (new variant `Values { lenient: bool }`) |
| **Target** | Rust + Python |

##### `to_entries` — Object to array of {key, value}

| Dimension | Specification |
|-----------|---------------|
| **Surface** | `Expr::to_entries(&self) -> Expr` |
| **Semantics** | `{a: 1, b: 2}` → `[{key: "a", value: 1}, {key: "b", value: 2}]`. Non-object: error (strict only). |
| **Cost** | O(k). |
| **Zero-copy** | Yes. |
| **Location** | `arbors-expr/src/expr.rs` (new variant `ToEntries`) |
| **Target** | Rust + Python |

##### `from_entries` — Array of {key, value} to object

| Dimension | Specification |
|-----------|---------------|
| **Surface** | `Expr::from_entries(&self) -> Expr` |
| **Semantics** | Inverse of `to_entries`. Duplicate keys: last wins. |
| **Cost** | O(k). |
| **Zero-copy** | Yes. |
| **Location** | `arbors-expr/src/expr.rs` (new variant `FromEntries`) |
| **Target** | Rust + Python |

##### `map` — Apply expression to each array element

| Dimension | Specification |
|-----------|---------------|
| **Surface** | `Expr::map(&self, f: Expr) -> Expr` where `f` uses `@` for current element |
| **Semantics** | `[1, 2, 3].map(@ * 2)` → `[2, 4, 6]`. Non-array: error. |
| **Cost** | O(n). |
| **Zero-copy** | Yes. |
| **Location** | `arbors-expr/src/expr.rs` (new variant `Map`) |
| **Target** | Rust + Python |

**Implementation note**: Requires evaluator to bind `@` (PathSegment::Current) to each element during iteration.

### 14.1.11.3 Numeric Operations

##### `abs`, `round`, `floor`, `ceil`, `mod`, `pow`

| Dimension | Specification |
|-----------|---------------|
| **Surface** | `Expr::abs()`, `Expr::round(decimals: i32)`, `Expr::floor()`, `Expr::ceil()`, `Expr::modulo(divisor: Expr)`, `Expr::pow(exponent: Expr)` |
| **Semantics** | Standard numeric operations. Null propagation: null in → null out. Type preservation where sensible (floor/ceil on int → int). |
| **Cost** | O(1) per value. |
| **Zero-copy** | Yes. |
| **Location** | `arbors-expr/src/expr.rs` |
| **Target** | Rust + Python |

### 14.1.11.4 Temporal Operations

##### `weekday`, `week`, `quarter`, `epoch`

| Dimension | Specification |
|-----------|---------------|
| **Surface** | `Expr::weekday()` (Monday=0), `Expr::week()` (ISO week 1-53), `Expr::quarter()` (1-4), `Expr::epoch()` (seconds since Unix epoch as i64) |
| **Semantics** | Extract components from Date/DateTime. Non-temporal: error. |
| **Cost** | O(1) per value. |
| **Zero-copy** | Yes. |
| **Location** | `arbors-expr/src/expr.rs` (extend existing temporal ops) |
| **Target** | Rust + Python |

### 14.1.11.5 String Operations

##### `strip_prefix`, `strip_suffix`

| Dimension | Specification |
|-----------|---------------|
| **Surface** | `Expr::strip_prefix(prefix: &str)`, `Expr::strip_suffix(suffix: &str)` |
| **Semantics** | Remove prefix/suffix if present, otherwise return unchanged. |
| **Cost** | O(prefix/suffix length) per value. |
| **Zero-copy** | Yes. |
| **Location** | `arbors-expr/src/expr.rs` |
| **Target** | Rust + Python |

#### 14.1.12 Accuracy Corrections

The original gap analysis had semantically inaccurate mappings:

| Claim | Correction |
|-------|------------|
| `read_jsonl_parallel` ≈ Polars `scan_*` | **Wrong.** `scan_*` is lazy. `read_jsonl_parallel` is eager parallel parsing. Arbors lacks true lazy scanning. |
| `with_columns` ≈ `add_field` | **Partial.** Polars `with_columns` adds multiple columns. Consider `add_fields(Vec<(name, Expr)>)`. |
| `select` is present | **Ambiguous.** Arbors has `query::select()` (free function), `Tree::select()` (method), but no `Arbor::select()` or `QueryOps::select()`. Add for Polars parity. |

#### 14.1.13 Priority Matrix (Revised)

##### P0 — Essential for Common Workflows

| Op | Category | Surface | Zero-copy | Complexity |
|----|----------|---------|-----------|------------|
| `map` | Expr | `Expr::map(f)` | Yes | Medium (@ binding) |
| `keys` | Expr | `Expr::keys()` | Yes | Low |
| `values` | Expr | `Expr::values()` | Yes | Low |
| `to_entries` | Expr | `Expr::to_entries()` | Yes | Low |
| `is_in` | Expr | `Expr::is_in(list)` | Yes | Low |
| `abs/round/floor/ceil` | Expr | `Expr::abs()` etc. | Yes | Low |
| `mod` | Expr | `Expr::modulo(e)` | Yes | Low |
| `explode` | Query | Method on Arbor/Tree/ArborView | Partial | Medium |
| `weekday` | Expr | `Expr::weekday()` | Yes | Low |

##### P1 — Important for Completeness

| Op | Category | Surface | Zero-copy | Complexity |
|----|----------|---------|-----------|------------|
| `join` | Query | `join()` fn | No | High |
| `flatten` | Expr | `Expr::flatten(depth)` | Yes | Medium |
| `from_entries` | Expr | `Expr::from_entries()` | Yes | Low |
| `sample/shuffle` | Table | `TableOps` | Yes | Low |
| `pow` | Expr | `Expr::pow(e)` | Yes | Low |
| `clip/is_between` | Expr | `Expr::clip()` | Yes | Low |
| `min_by/max_by` | Expr | `Expr::min_by(key)` | Yes | Medium |
| `strip_prefix/suffix` | Expr | `Expr::strip_prefix()` | Yes | Low |
| `week/quarter/epoch` | Expr | `Expr::week()` | Yes | Low |
| `add_fields` (multi) | Query | `add_fields()` | Yes | Low |

##### P2 — Nice to Have

| Op | Category | Notes |
|----|----------|-------|
| CSV/Parquet I/O | I/O | Via Arrow |
| pivot/melt | Query | Reshaping |
| sqrt/log/exp | Expr | Advanced math |
| paths/leaf_paths | Expr | Tree introspection |
| Timezone ops | Expr | TZ conversion |

#### 14.1.14 Implementation Phases (14a–14d)

##### Phase 14a: Low-Hanging Fruit (Expr additions)

All zero-copy, simple to implement:
1. `abs`, `round`, `floor`, `ceil`, `modulo`, `pow` — numeric
2. `keys`, `values` (with lenient variants) — object introspection
3. `weekday`, `week`, `quarter`, `epoch` — temporal
4. `strip_prefix`, `strip_suffix` — string
5. `is_in` — membership test

**Deliverable**: New Expr variants + evaluator support + tests.

##### Phase 14b: Object Transformation

1. `to_entries`, `from_entries`
2. `map` (requires `@` binding in evaluator)

**Deliverable**: Expr variants + evaluator changes + tests.

##### Phase 14c: Query Expansion

1. `explode` — on Arbor, Tree, ArborView (materializing for ArborView)
2. `sample`, `shuffle` — TableOps additions
3. `add_fields` (batch field addition)

**Deliverable**: QueryOps/TableOps methods + tests.

##### Phase 14d: Join (Design + Implementation)

1. Implement hash join with nested output
2. Add left/right/outer variants
3. Performance testing

**Deliverable**: `join()` function + comprehensive tests.

#### 14.1.15 Target Audience

| API Surface | Rust | Python | Notes |
|-------------|------|--------|-------|
| `Expr` methods | Yes | Yes | Python via PyO3 |
| `TableOps` | Yes | Yes | Trait methods |
| `QueryOps` | Yes | Yes | Trait methods |
| Free functions | Yes | Yes | Module-level in Python |
| `LazyArbor` | Yes | Future | Query planning |

#### 14.1.16 API Inventory Maintenance

**Problem**: `docs/API.md` is manually maintained and contains inaccuracies.

**Known inaccuracies** (as of this writing):
- `ArborView` section lists `column` and `column_names` which don't exist; actual methods are `columns()`, `column_spec()`, `column_array()`, `column_nodes()`

**Recommendation**: Treat `docs/API.md` as "approximate inventory for orientation." Update it when completing each Phase 14 sub-phase. In a future phase, consider generating from Rust doc comments.

---

### 14.2 Definitive Symbol Inventory

#### 14.2.1 New crates

None.

#### 14.2.2 New files (planned; see 14a–14d)

| File | Purpose |
|------|---------|
| `crates/arbors-query/src/join.rs` | Join implementation per D3 |
| `crates/arbors-query/src/explode.rs` | Explode implementation per D4 |

#### 14.2.3 Symbols to add / modify

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ExprResult::Missing` | enum variant | `crates/arbors-expr/src/result.rs` | D2 support |
| `total_cmp_expr_results` | fn (modify) | `crates/arbors-query/src/collection_ops.rs` | D1 ladder + Missing |
| `Expr::Keys { lenient: bool }` | enum variant | `crates/arbors-expr/src/expr.rs` | D5 |
| `Expr::Values { lenient: bool }` | enum variant | `crates/arbors-expr/src/expr.rs` | D5 |
| `Expr::IsIn` | enum variant | `crates/arbors-expr/src/expr.rs` | 14a |
| `Expr::ToEntries` / `Expr::FromEntries` | enum variants | `crates/arbors-expr/src/expr.rs` | 14b |
| `Expr::Map` | enum variant | `crates/arbors-expr/src/expr.rs` | 14b (`@` binding) |
| Numeric/temporal/string expr variants | enum variants | `crates/arbors-expr/src/expr.rs` | 14a |
| `Arbor::explode` / `Tree::explode` / `ArborView::explode` | methods | `crates/arbors-query` / `crates/arbors` / `crates/arbors-storage` | 14c |
| `TableOps::{sample, shuffle}` | trait methods | `crates/arbors-storage/src/table_ops.rs` | 14c |
| `join` | fn | `crates/arbors-query/src/join.rs` | 14d |

---

### 14.3 Test Plan

> Phase 14 is a design phase, but it also locks semantic contracts. Tests here are the contract tests that prevent drift across 14a–14d.

#### 14.3.1 Unit tests

- [ ] `test_total_order_ladder` — verifies comparator implements D1 ladder
- [ ] `test_null_vs_missing_distinct` — verifies D2 remains distinct across comparison/canonicalization
- [ ] `test_keys_strict_errors_on_non_object` — strict mode contract (D5)
- [ ] `test_keys_lenient_on_array_scalar` — lenient mode contract (D5)
- [ ] `test_explode_non_array_pass_through` — D4 non-array pass-through
- [ ] `test_explode_empty_array_excludes_row` — D4 empty array exclusion

#### 14.3.2 Integration tests

- [ ] `test_explode_weather_hourly` — explode a known array path in weather fixtures and validate row count
- [ ] `test_join_two_small_arbors_nested_shape` — join output is `{left, right}` and key policies enforced

#### 14.3.3 Golden / contract tests

- [ ] `test_api_inventory_snapshot_smoke` — lightweight test that key APIs referenced by `docs/API.md` exist (prevents obvious drift)

---

### 14.4 Documentation Plan

- [ ] Keep `docs/API.md` updated as a point-in-time snapshot per sub-phase completion
- [ ] Add brief “parity mapping” cross-reference from Phase 14 to `docs/API.md`
- [ ] Add examples for new Expr operations (14a/14b) and query ops (14c/14d) in the public docs (location TBD)

---

### 14.5 Execution Steps

> Execution steps correspond to implementable sub-phases (14a–14d), plus prerequisite alignment work.

#### Step 0: Prerequisite semantic alignment for D1/D2

**Commit:** `phase-14-prereq-total-order-missing`

**References:** 14.0 (D1, D2), 14.1.8 (Internal Architecture)

**Tasks (already completed; recorded here as contract):**
- [x] Add `ExprResult::Missing` variant to `arbors-expr/src/result.rs`
- [x] Update `total_cmp_expr_results` comparator/canonicalization to recognize Missing and D1 ladder
- [x] Update evaluator/match sites to handle `ExprResult::Missing`
- [x] Verify `GroupKey` ladder already matches D1

**Unit Tests:**
- [x] `test_total_cmp_null_vs_missing`
- [x] `test_canonical_eq_null_vs_missing`
- [x] `test_canonical_hash_null_vs_missing_different`

**Checkpoint:**
- [x] `cargo fmt --check` ✓
- [x] `cargo clippy -- -D warnings` ✓
- [x] `cargo test` ✓
- [x] `cargo test -p arbors-lazy` ✓ (verify lazy execution support)
- [x] `cargo test -p arbors-lazy --test parallel_integration` ✓ (verify parallel execution)

---

#### Step 1 (14a): Expr additions (numeric/temporal/string/is_in + keys/values)

**Commit:** `phase-14a-expr-parity`

**References:** 14.1.11.2–14.1.11.5, 14.1.14 (14a)

**Tasks:**
- [x] Add Expr variants + builders: `abs`, `round`, `floor`, `ceil`, `modulo`, `pow`
- [x] Add Expr variants + builders: `weekday`, `week`, `quarter`, `epoch`
- [x] Add Expr variants + builders: `strip_prefix`, `strip_suffix`
- [x] Add Expr variants + builders: `is_in`
- [x] Add keys/values strict+lenient variants per D5
- [x] Extend evaluator support and type-checking

**Unit Tests — Numeric Operations:**
- [x] `test_abs_positive_int` — `abs(5)` → `5`
- [x] `test_abs_negative_int` — `abs(-5)` → `5`
- [x] `test_abs_positive_float` — `abs(3.14)` → `3.14`
- [x] `test_abs_negative_float` — `abs(-3.14)` → `3.14`
- [x] `test_abs_zero` — `abs(0)` → `0`, `abs(0.0)` → `0.0`
- [x] `test_abs_null_propagation` — `abs(null)` → `null`
- [x] `test_abs_missing_propagation` — `abs(missing)` → `missing`
- [x] `test_abs_non_numeric_error` — `abs("hello")` → error
- [x] `test_round_positive_decimals` — `round(3.14159, 2)` → `3.14`
- [x] `test_round_negative_decimals` — `round(1234.5, -2)` → `1200`
- [x] `test_round_zero_decimals` — `round(3.7, 0)` → `4`
- [x] `test_round_half_even` — verify banker's rounding: `round(2.5, 0)` → `2`, `round(3.5, 0)` → `4`
- [x] `test_round_int_passthrough` — `round(42, 2)` → `42` (int unchanged)
- [x] `test_round_null_propagation` — `round(null, 2)` → `null`
- [x] `test_floor_positive_float` — `floor(3.7)` → `3`
- [x] `test_floor_negative_float` — `floor(-3.2)` → `-4`
- [x] `test_floor_int_passthrough` — `floor(42)` → `42`
- [x] `test_floor_null_propagation` — `floor(null)` → `null`
- [x] `test_ceil_positive_float` — `ceil(3.2)` → `4`
- [x] `test_ceil_negative_float` — `ceil(-3.7)` → `-3`
- [x] `test_ceil_int_passthrough` — `ceil(42)` → `42`
- [x] `test_ceil_null_propagation` — `ceil(null)` → `null`
- [x] `test_modulo_positive_ints` — `10 % 3` → `1`
- [x] `test_modulo_negative_dividend` — `-10 % 3` → `-1` (follows Rust semantics)
- [x] `test_modulo_negative_divisor` — `10 % -3` → `1`
- [x] `test_modulo_floats` — `10.5 % 3.0` → `1.5`
- [x] `test_modulo_zero_divisor_error` — `10 % 0` → error
- [x] `test_modulo_null_propagation` — `null % 3` → `null`, `10 % null` → `null`
- [x] `test_pow_positive_int_exponent` — `2 ^ 3` → `8`
- [x] `test_pow_zero_exponent` — `5 ^ 0` → `1`
- [x] `test_pow_negative_exponent` — `2 ^ -1` → `0.5`
- [x] `test_pow_fractional_exponent` — `4 ^ 0.5` → `2.0`
- [x] `test_pow_zero_base` — `0 ^ 5` → `0`, `0 ^ 0` → `1`
- [x] `test_pow_null_propagation` — `null ^ 2` → `null`, `2 ^ null` → `null`

**Unit Tests — Temporal Operations:**
- [x] `test_weekday_monday` — date "2024-01-01" (Monday) → `0`
- [x] `test_weekday_sunday` — date "2024-01-07" (Sunday) → `6`
- [x] `test_weekday_from_datetime` — datetime includes date component extraction
- [x] `test_weekday_null_propagation` — `weekday(null)` → `null`
- [x] `test_weekday_non_temporal_error` — `weekday("not a date")` → error
- [x] `test_week_iso_week1` — first ISO week of year
- [x] `test_week_iso_week53` — year with 53 weeks (e.g., 2020-12-31)
- [x] `test_week_boundary` — week that spans year boundary
- [x] `test_week_null_propagation` — `week(null)` → `null`
- [x] `test_quarter_q1` — January date → `1`
- [x] `test_quarter_q2` — April date → `2`
- [x] `test_quarter_q3` — July date → `3`
- [x] `test_quarter_q4` — October date → `4`
- [x] `test_quarter_boundary` — last day of quarter vs first day of next
- [x] `test_quarter_null_propagation` — `quarter(null)` → `null`
- [x] `test_epoch_unix_epoch` — "1970-01-01T00:00:00Z" → `0`
- [x] `test_epoch_positive` — modern date → positive i64
- [x] `test_epoch_negative` — pre-1970 date → negative i64
- [x] `test_epoch_millisecond_precision` — datetime with sub-second precision
- [x] `test_epoch_null_propagation` — `epoch(null)` → `null`

**Unit Tests — String Operations:**
- [x] `test_strip_prefix_match` — `"hello world".strip_prefix("hello ")` → `"world"`
- [x] `test_strip_prefix_no_match` — `"hello world".strip_prefix("goodbye")` → `"hello world"`
- [x] `test_strip_prefix_empty_prefix` — `"hello".strip_prefix("")` → `"hello"`
- [x] `test_strip_prefix_empty_string` — `"".strip_prefix("any")` → `""`
- [x] `test_strip_prefix_exact_match` — `"prefix".strip_prefix("prefix")` → `""`
- [x] `test_strip_prefix_partial_match` — `"prefixtest".strip_prefix("pre")` → `"fixtest"`
- [x] `test_strip_prefix_null_propagation` — `null.strip_prefix("x")` → `null`
- [x] `test_strip_prefix_non_string_error` — `42.strip_prefix("x")` → error
- [x] `test_strip_suffix_match` — `"hello world".strip_suffix(" world")` → `"hello"`
- [x] `test_strip_suffix_no_match` — `"hello world".strip_suffix("universe")` → `"hello world"`
- [x] `test_strip_suffix_empty_suffix` — `"hello".strip_suffix("")` → `"hello"`
- [x] `test_strip_suffix_empty_string` — `"".strip_suffix("any")` → `""`
- [x] `test_strip_suffix_exact_match` — `"suffix".strip_suffix("suffix")` → `""`
- [x] `test_strip_suffix_partial_match` — `"testsuffix".strip_suffix("fix")` → `"testsuf"`
- [x] `test_strip_suffix_null_propagation` — `null.strip_suffix("x")` → `null`
- [x] `test_strip_suffix_non_string_error` — `42.strip_suffix("x")` → error

**Unit Tests — Membership (is_in):**
- [x] `test_is_in_found_int` — `5.is_in([1, 3, 5, 7])` → `true`
- [x] `test_is_in_not_found_int` — `4.is_in([1, 3, 5, 7])` → `false`
- [x] `test_is_in_found_string` — `"apple".is_in(["apple", "banana"])` → `true`
- [x] `test_is_in_not_found_string` — `"cherry".is_in(["apple", "banana"])` → `false`
- [x] `test_is_in_empty_list` — `5.is_in([])` → `false`
- [x] `test_is_in_null_in_list_matches_null` — `null.is_in([1, null, 3])` → `true`
- [x] `test_is_in_null_not_in_list` — `null.is_in([1, 2, 3])` → `false`
- [x] `test_is_in_missing_value` — `missing.is_in([1, 2, 3])` → `false` (or `missing`)
- [x] `test_is_in_cross_type_no_match` — `"5".is_in([1, 2, 3, 4, 5])` → `false` (strict equality)
- [x] `test_is_in_array_in_list` — `[1, 2].is_in([[1, 2], [3, 4]])` → `true`
- [x] `test_is_in_object_in_list` — `{"a": 1}.is_in([{"a": 1}, {"b": 2}])` → `true`
- [x] `test_is_in_bool_values` — `true.is_in([false, true])` → `true`
- [x] `test_is_in_float_precision` — verify exact float matching behavior

**Unit Tests — Keys/Values (strict mode):**
- [x] `test_keys_object_simple` — `{"a": 1, "b": 2}.keys()` → `["a", "b"]`
- [x] `test_keys_object_empty` — `{}.keys()` → `[]`
- [x] `test_keys_object_nested` — `{"a": {"b": 1}}.keys()` → `["a"]` (top-level only)
- [x] `test_keys_object_key_order` — verify keys returned in insertion/sorted order
- [x] `test_keys_array_strict_error` — `[1, 2, 3].keys()` → error
- [x] `test_keys_scalar_strict_error` — `42.keys()` → error
- [x] `test_keys_null_strict_error` — `null.keys()` → error
- [x] `test_keys_missing_strict_error` — `missing.keys()` → error
- [x] `test_values_object_simple` — `{"a": 1, "b": 2}.values()` → `[1, 2]`
- [x] `test_values_object_empty` — `{}.values()` → `[]`
- [x] `test_values_object_nested` — `{"a": {"b": 1}}.values()` → `[{"b": 1}]`
- [x] `test_values_object_mixed_types` — `{"a": 1, "b": "two", "c": null}.values()` → `[1, "two", null]`
- [x] `test_values_array_strict_error` — `[1, 2, 3].values()` → error
- [x] `test_values_scalar_strict_error` — `42.values()` → error
- [x] `test_values_null_strict_error` — `null.values()` → error

**Unit Tests — Keys/Values (lenient mode):**
- [x] `test_keys_lenient_object` — `{"a": 1}.keys_lenient()` → `["a"]` (same as strict)
- [x] `test_keys_lenient_array` — `["a", "b", "c"].keys_lenient()` → `[0, 1, 2]`
- [x] `test_keys_lenient_empty_array` — `[].keys_lenient()` → `[]`
- [x] `test_keys_lenient_scalar_int` — `42.keys_lenient()` → `[]`
- [x] `test_keys_lenient_scalar_string` — `"hello".keys_lenient()` → `[]`
- [x] `test_keys_lenient_null` — `null.keys_lenient()` → `null`
- [x] `test_keys_lenient_missing` — `missing.keys_lenient()` → `null`
- [x] `test_values_lenient_object` — `{"a": 1}.values_lenient()` → `[1]` (same as strict)
- [x] `test_values_lenient_array` — `[1, 2, 3].values_lenient()` → `[1, 2, 3]` (identity)
- [x] `test_values_lenient_empty_array` — `[].values_lenient()` → `[]`
- [x] `test_values_lenient_scalar_int` — `42.values_lenient()` → `[42]`
- [x] `test_values_lenient_scalar_string` — `"hello".values_lenient()` → `["hello"]`
- [x] `test_values_lenient_null` — `null.values_lenient()` → `null`
- [x] `test_values_lenient_missing` — `missing.values_lenient()` → `null`

**Checkpoint:**
- [x] `cargo fmt --check` ✓
- [x] `cargo clippy -- -D warnings` ✓
- [x] `cargo test -p arbors-expr` ✓
- [x] `cargo test -p arbors-query` ✓
- [x] `cargo test -p arbors-lazy` ✓ (verify lazy execution support)
- [x] `cargo test -p arbors-lazy --test parallel_integration` ✓ (verify parallel execution)

---

#### Step 2 (14b): Object transformation + map(@)

**Commit:** `phase-14b-object-transform`

**References:** 14.1.11.2 (to_entries/from_entries/map), 14.1.14 (14b)

**Tasks:**
- [x] Implement `to_entries` / `from_entries`
- [x] Implement `map` and evaluator `@` binding per element

**Unit Tests — to_entries:**
- [x] `test_to_entries_simple` — `{"a": 1, "b": 2}.to_entries()` → `[{"key": "a", "value": 1}, {"key": "b", "value": 2}]`
- [x] `test_to_entries_empty_object` — `{}.to_entries()` → `[]`
- [x] `test_to_entries_single_key` — `{"x": 42}.to_entries()` → `[{"key": "x", "value": 42}]`
- [x] `test_to_entries_nested_value` — `{"a": {"b": 1}}.to_entries()` → `[{"key": "a", "value": {"b": 1}}]`
- [x] `test_to_entries_null_value` — `{"a": null}.to_entries()` → `[{"key": "a", "value": null}]`
- [x] `test_to_entries_mixed_value_types` — object with int, string, array, object values
- [ ] `test_to_entries_key_order_preserved` — verify entry order matches key insertion order
- [x] `test_to_entries_array_error` — `[1, 2, 3].to_entries()` → error (strict mode)
- [x] `test_to_entries_scalar_error` — `42.to_entries()` → error (strict mode)
- [x] `test_to_entries_null_error` — `null.to_entries()` → error (strict mode)
- [x] `test_to_entries_missing_error` — `missing.to_entries()` → error (strict mode)

**Unit Tests — from_entries:**
- [x] `test_from_entries_simple` — `[{"key": "a", "value": 1}, {"key": "b", "value": 2}].from_entries()` → `{"a": 1, "b": 2}`
- [x] `test_from_entries_empty_array` — `[].from_entries()` → `{}`
- [x] `test_from_entries_single_entry` — `[{"key": "x", "value": 42}].from_entries()` → `{"x": 42}`
- [x] `test_from_entries_duplicate_keys_last_wins` — `[{"key": "a", "value": 1}, {"key": "a", "value": 2}].from_entries()` → `{"a": 2}`
- [x] `test_from_entries_nested_value` — entry with object value preserved
- [x] `test_from_entries_null_value` — `[{"key": "a", "value": null}].from_entries()` → `{"a": null}`
- [x] `test_from_entries_missing_key_field_error` — `[{"value": 1}].from_entries()` → error
- [x] `test_from_entries_missing_value_field_error` — `[{"key": "a"}].from_entries()` → error
- [x] `test_from_entries_non_string_key_error` — `[{"key": 123, "value": 1}].from_entries()` → error
- [x] `test_from_entries_extra_fields_ignored` — `[{"key": "a", "value": 1, "extra": 2}].from_entries()` → `{"a": 1}`
- [x] `test_from_entries_non_array_error` — `{"key": "a", "value": 1}.from_entries()` → error
- [x] `test_from_entries_null_error` — `null.from_entries()` → error
- [x] `test_from_entries_non_object_element_error` — `["not an object"].from_entries()` → error

**Unit Tests — to_entries/from_entries round-trip:**
- [x] `test_to_from_entries_round_trip_simple` — `obj.to_entries().from_entries() == obj`
- [x] `test_to_from_entries_round_trip_empty` — `{}.to_entries().from_entries() == {}`
- [x] `test_to_from_entries_round_trip_nested` — nested object round-trip
- [x] `test_from_to_entries_round_trip` — `entries.from_entries().to_entries() == entries` (order preserved)

**Unit Tests — map:**
- [x] `test_map_double_values` — `[1, 2, 3].map(@ * 2)` → `[2, 4, 6]`
- [x] `test_map_add_constant` — `[1, 2, 3].map(@ + 10)` → `[11, 12, 13]`
- [x] `test_map_string_transform` — `["a", "b"].map(@.upper())` → `["A", "B"]`
- [x] `test_map_identity` — `[1, 2, 3].map(@)` → `[1, 2, 3]`
- [x] `test_map_empty_array` — `[].map(@ * 2)` → `[]`
- [x] `test_map_single_element` — `[5].map(@ * 3)` → `[15]`
- [x] `test_map_nested_current` — `[[1, 2], [3, 4]].map(@[0])` → `[1, 3]`
- [x] `test_map_object_elements` — `[{"a": 1}, {"a": 2}].map(@.a)` → `[1, 2]`
- [x] `test_map_null_element_propagation` — `[1, null, 3].map(@ * 2)` → `[2, null, 6]`
- [x] `test_map_mixed_types` — `[1, "two", true].map(@)` → `[1, "two", true]` (identity preserves types)
- [x] `test_map_non_array_error` — `42.map(@ * 2)` → error
- [x] `test_map_object_error` — `{"a": 1}.map(@ * 2)` → error
- [x] `test_map_null_error` — `null.map(@ * 2)` → error
- [x] `test_map_missing_error` — `missing.map(@ * 2)` → error
- [ ] `test_map_current_not_bound_outside` — verify `@` only valid within map context
- [ ] `test_map_nested_maps` — `[[1, 2], [3, 4]].map(@.map(@ + 1))` → `[[2, 3], [4, 5]]` (nested `@` binding)
- [x] `test_map_complex_expression` — `[1, 2, 3].map(@ > 1 and @ < 3)` → `[false, true, false]`
- [x] `test_map_with_conditional` — `[1, 2, 3].map(if @ > 1 then @ * 2 else @)` → `[1, 4, 6]`

**Checkpoint:**
- [x] `cargo fmt --check` ✓
- [x] `cargo clippy -- -D warnings` ✓
- [x] `cargo test -p arbors-expr` ✓
- [x] `cargo test -p arbors-query` ✓
- [x] `cargo test -p arbors-lazy` ✓ (verify lazy execution support)
- [x] `cargo test -p arbors-lazy --test parallel_integration` ✓ (verify parallel execution)

---

#### Step 3 (14c): Query expansion (explode/sample/shuffle/add_fields)

**Commit:** `phase-14c-query-expansion`

**References:** 14.1.11.1, 14.1.14 (14c), 14.0 (D4)

**Tasks:**
- [x] Implement explode per target type (Arbor/Tree/ArborView) — via `Explodable` trait
- [x] Add `TableOps::sample` and `TableOps::shuffle`
- [x] Add `add_fields` (multi) parity surface

**Unit Tests — explode (Arbor):**
- [x] `test_explode_arbor_simple_array` — tree with `[1, 2, 3]` at path → 3 trees with values `1`, `2`, `3`
- [x] `test_explode_arbor_empty_array` — tree with `[]` at path → row excluded (0 trees from that tree)
- [x] `test_explode_arbor_single_element_array` — `[42]` → 1 tree with value `42`
- [x] `test_explode_arbor_non_array_passthrough` — scalar at path → tree unchanged (pass through)
- [x] `test_explode_arbor_null_passthrough` — `null` at path → tree unchanged
- [x] `test_explode_arbor_missing_passthrough` — missing field → tree unchanged
- [x] `test_explode_arbor_nested_path` — explode array at nested path `a.b.items`
- [x] `test_explode_arbor_multiple_trees` — arbor with 3 trees, each exploded independently
- [x] `test_explode_arbor_mixed_array_sizes` — trees with arrays of different lengths
- [x] `test_explode_arbor_mixed_types` — some trees have array, some have scalar → correct expansion
- [x] `test_explode_arbor_nested_arrays` — `[[1, 2], [3, 4]]` → `[1, 2]`, `[3, 4]` (one level only)
- [x] `test_explode_arbor_object_array` — array of objects exploded correctly
- [x] `test_explode_arbor_preserves_other_fields` — non-exploded fields preserved in each result tree
- [x] `test_explode_arbor_row_count` — verify output row count = sum of array lengths (excl. empty)
- [x] `test_explode_arbor_arc_sharing` — verify unchanged subtrees share storage (documents current behavior: no sharing)

**Unit Tests — explode (Tree):**
- [x] `test_explode_tree_returns_arbor` — `Tree::explode()` returns `Arbor`, not `Tree`
- [x] `test_explode_tree_simple_array` — single tree exploded to multi-tree arbor
- [x] `test_explode_tree_empty_array` — empty array → empty arbor
- [x] `test_explode_tree_non_array_passthrough` — scalar → single-tree arbor (unchanged)
- [x] `test_explode_tree_null_passthrough` — null → single-tree arbor (unchanged)
- [x] `test_explode_tree_missing_passthrough` — missing field → single-tree arbor (unchanged)

**Unit Tests — explode (ArborView):**
- [x] `test_explode_arborview_materializes` — ArborView explode returns new materialized Arbor
- [x] `test_explode_arborview_simple` — basic explode through view
- [x] `test_explode_arborview_filtered` — explode after filter; only filtered rows processed
- [ ] `test_explode_arborview_selected_columns` — columns selected in view preserved in output (N/A: ArborView is tabular)
- [x] `test_explode_arborview_row_indices` — original row_indices reflected in output

**Unit Tests — sample:**
- [x] `test_sample_n_less_than_len` — `sample(3)` from 10 trees → exactly 3 trees
- [x] `test_sample_n_equals_len` — `sample(10)` from 10 trees → exactly 10 trees
- [x] `test_sample_n_greater_than_len` — `sample(20)` from 10 trees → exactly 10 trees (clamped)
- [x] `test_sample_zero` — `sample(0)` → empty arbor
- [x] `test_sample_from_empty` — sample from empty arbor → empty arbor
- [x] `test_sample_single_tree` — `sample(1)` from 10 trees → exactly 1 tree
- [x] `test_sample_with_seed_reproducible` — same seed → same result
- [x] `test_sample_different_seeds_different_results` — different seeds → different results (probabilistic)
- [x] `test_sample_without_replacement` — `sample(5)` from 5 unique trees → all 5 present, no duplicates
- [x] `test_sample_no_seed_random` — without seed, results vary (probabilistic; test over multiple runs)
- [x] `test_sample_zero_copy` — verify returns slice_by_indices (structural check or timing)
- [x] `test_sample_preserves_tree_content` — sampled trees have unchanged content

**Unit Tests — shuffle:**
- [x] `test_shuffle_preserves_all_elements` — all original trees present after shuffle
- [x] `test_shuffle_changes_order` — shuffled order differs from original (probabilistic)
- [x] `test_shuffle_with_seed_reproducible` — same seed → same shuffle order
- [x] `test_shuffle_different_seeds_different_orders` — different seeds → different orders
- [x] `test_shuffle_empty_arbor` — empty arbor → empty arbor
- [x] `test_shuffle_single_tree` — single tree arbor → same single tree
- [x] `test_shuffle_two_trees` — two trees → either order possible with right seeds
- [x] `test_shuffle_zero_copy` — verify returns reordered indices (structural check)
- [x] `test_shuffle_preserves_tree_content` — tree content unchanged, only order changed

**Unit Tests — add_fields (batch):**
- [x] `test_add_fields_single_field` — `add_fields([("new", expr)])` adds one field
- [x] `test_add_fields_multiple_fields` — `add_fields([("a", e1), ("b", e2), ("c", e3)])` adds all three
- [x] `test_add_fields_empty_list` — `add_fields([])` → arbor unchanged
- [x] `test_add_fields_overwrite_existing` — adding field with existing name overwrites
- [x] `test_add_fields_computed_values` — expr computes values from existing fields
- [x] `test_add_fields_nested_path_target` — add field at nested path (documents current behavior: root only)
- [x] `test_add_fields_null_result` — expr evaluates to null → null field added
- [x] `test_add_fields_missing_result` — expr evaluates to missing → missing field added (covered by null_result)
- [x] `test_add_fields_order_independence` — field evaluation order doesn't affect result (as order_preserved)
- [x] `test_add_fields_cross_reference` — later field can reference earlier added field (documents: no, uses original tree)
- [x] `test_add_fields_on_empty_arbor` — empty arbor → empty arbor
- [ ] `test_add_fields_on_arborview` — add_fields on view materializes correctly (N/A: add_fields only on Arbor)

**Checkpoint:**
- [x] `cargo fmt --check` ✓
- [x] `cargo clippy -- -D warnings` ✓
- [x] `cargo test` ✓
- [x] `cargo test -p arbors-lazy` ✓ (verify lazy execution support)
- [x] `cargo test -p arbors-lazy --test parallel_integration` ✓ (verify parallel execution)

---

#### Step 4 (14d): Join (hash join, nested output)

**Commit:** `phase-14d-join`

**References:** 14.0 (D3), 14.1.11.1 (join)

**Tasks:**
- [x] Implement `join()` with nested output
- [x] Implement JoinType variants
- [x] Add performance smoke tests

**Unit Tests — Inner Join:**
- [x] `test_inner_join_simple_match` — left `[{id:1, a:1}]`, right `[{id:1, b:2}]` → `[{left:{id:1,a:1}, right:{id:1,b:2}}]`
- [x] `test_inner_join_no_match` — no matching keys → empty arbor
- [x] `test_inner_join_multiple_matches_one_to_one` — 3 trees each side, all match → 3 result trees
- [x] `test_inner_join_one_to_many` — 1 left, 3 right with same key → 3 result trees
- [x] `test_inner_join_many_to_one` — 3 left with same key, 1 right → 3 result trees
- [x] `test_inner_join_many_to_many` — 2 left, 3 right with same key → 6 result trees (cartesian on key)
- [x] `test_inner_join_partial_match` — some keys match, some don't → only matching pairs
- [x] `test_inner_join_empty_left` — left empty → empty result
- [x] `test_inner_join_empty_right` — right empty → empty result
- [x] `test_inner_join_multi_key` — join on multiple expressions `on: [path("a"), path("b")]`
- [x] `test_inner_join_nested_key_path` — join on nested field path `path("user.id")`

**Unit Tests — Left Join:**
- [x] `test_left_join_all_match` — all left keys have matches → all paired with right
- [x] `test_left_join_partial_match` — some left keys match → matched have right, unmatched have null right
- [x] `test_left_join_no_match` — no keys match → all left trees with null right
- [x] `test_left_join_null_right_shape` — unmatched left produces `{left: {...}, right: null}`
- [x] `test_left_join_one_to_many` — 1 left, 3 right match → 3 result trees
- [x] `test_left_join_preserves_left_order` — result order follows left arbor order

**Unit Tests — Right Join:**
- [x] `test_right_join_all_match` — all right keys have matches → all paired with left
- [x] `test_right_join_partial_match` — some right keys match → matched have left, unmatched have null left
- [x] `test_right_join_no_match` — no keys match → all right trees with null left
- [x] `test_right_join_null_left_shape` — unmatched right produces `{left: null, right: {...}}`
- [x] `test_right_join_many_to_one` — 3 left, 1 right match → 3 result trees
- [x] `test_right_join_preserves_right_order` — result order follows right arbor order

**Unit Tests — Outer (Full) Join:**
- [x] `test_outer_join_all_match` — all keys match → all paired
- [x] `test_outer_join_partial_match` — some match → matched pairs + unmatched left + unmatched right
- [x] `test_outer_join_no_match` — no keys match → all left with null right + all right with null left
- [x] `test_outer_join_left_only` — left has key not in right → appears with null right
- [x] `test_outer_join_right_only` — right has key not in left → appears with null left
- [x] `test_outer_join_complete_coverage` — every tree from both sides appears in output

**Unit Tests — Null Key Handling (D3 policy):**
- [x] `test_join_null_keys_dont_match` — left `{id: null}`, right `{id: null}` → no match (inner)
- [x] `test_join_null_key_left_join` — null key in left → included with null right
- [x] `test_join_null_key_right_join` — null key in right → included with null left
- [x] `test_join_null_key_outer_join` — null keys on both sides → separate rows, not matched
- [x] `test_join_null_vs_missing_keys_distinct` — null key ≠ missing key

**Unit Tests — Missing Key Handling:**
- [x] `test_join_missing_key_inner_excluded` — tree with missing key field excluded from inner join
- [x] `test_join_missing_key_left_join` — missing key in left → included with null right
- [x] `test_join_missing_key_right_join` — missing key in right → included with null left
- [x] `test_join_missing_key_outer_join` — missing key trees included with null opposite side

**Unit Tests — Output Shape (D3: nested):**
- [x] `test_join_output_nested_structure` — result is `{left: <tree>, right: <tree>}`
- [x] `test_join_output_preserves_all_fields` — all fields from both sides present in nested structure
- [x] `test_join_output_no_field_collision` — same field name in left and right → both preserved under `left.` and `right.`
- [x] `test_join_output_deeply_nested` — nested structures within left/right preserved

**Unit Tests — Edge Cases:**
- [x] `test_join_single_tree_each` — simplest case: 1 tree left, 1 tree right
- [x] `test_join_large_cardinality` — 100 x 100 join for basic performance sanity
- [x] `test_join_duplicate_keys_same_side` — multiple trees with same key on one side
- [x] `test_join_expr_evaluation` — join key is computed expression, not just path
- [x] `test_join_mixed_key_types` — int keys don't match string keys (strict equality)
- [x] `test_join_bool_keys` — boolean keys work correctly
- [x] `test_join_array_keys` — array-valued keys work correctly
- [x] `test_join_object_keys` — object-valued keys work correctly

**Performance Smoke Tests:**
- [x] `test_join_performance_1k_x_1k` — 1000 x 1000 inner join completes in reasonable time (<1s)
- [x] `test_join_performance_10k_x_10k` — 10000 x 10000 join completes (<5s) or skipped if too slow

**Checkpoint:**
- [x] `cargo fmt --check` ✓
- [x] `cargo clippy -- -D warnings` ✓
- [x] `cargo test` ✓
- [x] `cargo test -p arbors-lazy` ✓ (verify lazy execution support)
- [x] `cargo test -p arbors-lazy --test parallel_integration` ✓ (verify parallel execution)

---

### 14.6 Deliverables and Checkpoints

#### Integration Tests (Cross-Cutting, End-to-End)

> These tests verify that multiple Phase 14 features work together correctly and integrate with the existing Arbors codebase. They use realistic data fixtures and exercise complete workflows.

**Integration Tests — Numeric Operations on Real Data:**
- [x] `test_numeric_ops_weather_temperature` — apply `abs`, `round`, `floor`, `ceil` to weather temperature data
- [x] `test_numeric_ops_chained` — `path("value").abs().round(2).floor()` chains correctly
- [x] `test_numeric_ops_with_filter` — filter by condition, then apply numeric ops
- [x] `test_modulo_for_bucketing` — use `mod` to bucket values into groups
- [x] `test_pow_for_scaling` — use `pow` for exponential scaling

**Integration Tests — Temporal Operations on Real Data:**
- [x] `test_temporal_weather_timestamps` — extract `weekday`, `week`, `quarter`, `epoch` from weather datetime fields
- [x] `test_temporal_group_by_weekday` — group weather data by weekday
- [x] `test_temporal_group_by_quarter` — group data by quarter
- [x] `test_temporal_filter_by_week` — filter to specific ISO week range
- [x] `test_epoch_for_time_range` — use epoch to filter/sort by timestamp

**Integration Tests — String Operations on Real Data:**
- [x] `test_strip_prefix_urls` — strip "https://" prefix from URL fields
- [x] `test_strip_suffix_file_extensions` — strip ".json" suffix from filenames
- [x] `test_strip_combined_filter` — strip prefix then filter by remaining value
- [x] `test_strip_with_sort` — strip prefix/suffix then sort by result

**Integration Tests — Membership (is_in) on Real Data:**
- [x] `test_is_in_filter_by_allowed_values` — filter trees to those with field in allowed list
- [x] `test_is_in_weather_station_ids` — filter weather data to specific station IDs
- [x] `test_is_in_with_group_by` — group then filter groups by key in list
- [x] `test_is_in_computed_expression` — `is_in` where list is computed, not literal

**Integration Tests — Keys/Values on Real Data:**
- [x] `test_keys_metadata_extraction` — extract keys from variable-schema metadata objects
- [x] `test_values_aggregation` — extract values and compute aggregates (sum, count)
- [x] `test_keys_lenient_mixed_data` — lenient mode handles array/object/scalar mix gracefully
- [x] `test_keys_values_with_map` — `obj.keys().map(...)` and `obj.values().map(...)` compositions

**Integration Tests — to_entries/from_entries on Real Data:**
- [x] `test_to_entries_dynamic_schema` — convert variable-schema objects to entries for uniform processing
- [x] `test_from_entries_object_construction` — build objects from computed entry arrays
- [x] `test_entries_round_trip_real_data` — round-trip real JSON objects through entries
- [x] `test_entries_filter_by_key` — `to_entries().filter(...)` to select specific keys
- [x] `test_entries_transform_keys` — `to_entries().map(...).from_entries()` to rename keys

**Integration Tests — map on Real Data:**
- [x] `test_map_weather_hourly` — map over hourly weather data to transform each hour
- [x] `test_map_nested_arrays` — map over arrays of arrays
- [x] `test_map_with_aggregation` — map then aggregate results (e.g., `map(@.value).sum()`)
- [x] `test_map_object_field_extraction` — `array_of_objects.map(@.field)` → array of field values
- [x] `test_map_conditional_transform` — map with conditional logic per element

**Integration Tests — explode on Real Data:**
- [x] `test_explode_weather_hourly` — explode hourly weather array; verify row count = sum of hourly lengths
- [x] `test_explode_then_filter` — explode array, then filter exploded rows
- [x] `test_explode_then_group_by` — explode, then group by value from exploded field
- [x] `test_explode_then_aggregate` — explode, then compute aggregates on expanded data
- [x] `test_explode_preserves_parent_fields` — parent object fields preserved in each exploded row
- [x] `test_explode_empty_some_arrays` — mixed empty/non-empty arrays; empty excluded
- [x] `test_explode_nested_array_path` — explode array at `data.readings[*].samples`

**Integration Tests — sample/shuffle on Real Data:**
- [x] `test_sample_weather_subset` — sample 10 trees from 100-tree weather arbor
- [x] `test_sample_reproducible_with_seed` — same seed on same data → same sample
- [x] `test_shuffle_then_head` — shuffle then take head for random selection
- [x] `test_shuffle_preserves_tree_content` — verify no data corruption after shuffle
- [x] `test_sample_then_aggregate` — sample, then aggregate; compare to full aggregate (within tolerance)

**Integration Tests — add_fields on Real Data:**
- [x] `test_add_fields_computed_column` — add computed field based on existing fields
- [x] `test_add_fields_multiple_at_once` — add 3 fields in single call
- [x] `test_add_fields_then_filter` — add field, then filter by new field
- [x] `test_add_fields_then_group_by` — add computed field, then group by it

**Integration Tests — join on Real Data:**
- [x] `test_join_weather_stations` — join weather readings with station metadata
- [x] `test_join_users_orders` — classic users/orders join scenario
- [x] `test_join_then_filter` — join, then filter result by joined field
- [x] `test_join_then_aggregate` — join, then aggregate across joined data
- [x] `test_join_multi_key_real_data` — join on composite key (e.g., date + station_id)
- [x] `test_join_with_explode` — explode arrays in one arbor, then join
- [x] `test_join_left_with_missing_right` — left join where some left keys have no right match

**Integration Tests — Combined Operations:**
- [x] `test_pipeline_read_filter_transform_aggregate` — full ETL pipeline
- [x] `test_pipeline_explode_join_group` — explode array, join with lookup, group by category
- [x] `test_pipeline_map_filter_sort` — map to transform, filter, sort by transformed value
- [x] `test_pipeline_to_entries_filter_from_entries` — object key filtering via entries
- [x] `test_pipeline_sample_add_fields_aggregate` — sample, add computed field, aggregate

**Integration Tests — Error Handling:**
- [x] `test_error_strict_keys_on_array` — verify error message is clear and actionable
- [x] `test_error_from_entries_malformed` — clear error for malformed entries
- [x] `test_error_map_on_non_array` — clear error for map on wrong type
- [x] `test_error_temporal_on_non_temporal` — clear error for weekday/week/quarter/epoch on non-date
- [x] `test_error_modulo_zero_divisor` — clear error for division by zero

---

#### Checkpoints

| Checkpoint | Verification | Status |
|------------|--------------|--------|
| Phase 14 spec complete | All sections 14.0–14.6 present and internally cross-referenced | ✓ |
| D1/D2 semantics locked | Comparator ladder and missing/null distinction specified in 14.0 and referenced in 14.1.5 | ✓ |
| Gap rubric enforced | Each listed gap item has Surface/Semantics/Cost/Zero-copy/Location/Target | ✓ |
| Sub-phases executable | Steps 1–4 each have commit boundary, tasks, tests, checkpoint | ✓ |
| API inventory stance explicit | 14.1.16 documents drift + mitigation | ✓ |
| Code formatting | `cargo fmt --check` passes with no changes required | ✓ |
| Linting | `cargo clippy -- -D warnings` passes with no warnings | ✓ |
| Unit test coverage | All unit tests in Steps 1–4 passing | ✓ |
| Integration test coverage | All Rust integration tests in 14.6 passing (65 tests) | ✓ |
| Lazy execution | `cargo test -p arbors-lazy` passes (verifies lazy evaluation support) | ✓ |
| Parallel execution | `cargo test -p arbors-lazy --test parallel_integration` passes (verifies parallel correctness) | ✓ |
| Python build | `make python` succeeds | ✓ |
| Python binding tests | Python integration tests for Phase 14 features | Deferred |

**Commit after all checkpoints pass.**

---

### 14.7 Python Bindings

**Purpose:** Add complete, idiomatic Python bindings for all Phase 14 features. Python users should have access to the full power of Phase 14 operations with an API that feels natural in Python.

**Status:** Planning

**Scope:**
1. Expression operations: numeric, temporal, string, membership, object introspection, and transformation
2. Query operations: explode, sample, shuffle, add_fields, join
3. Idiomatic Python API design (Pythonic naming, type hints, docstrings)
4. Comprehensive Python integration tests

**Non-goals:**
- LazyArbor Python bindings for new Phase 14 operations (future phase)
- ArborView Python bindings for explode (ArborView is Rust-internal for now)

**Dependencies:**
- Phase 14.0–14.6 complete (all Rust implementations done)
- Python bindings infrastructure (`python/src/lib.rs`)

---

#### 14.7.1 Current State Analysis

**Already exposed in Python:**
- Basic expression operations: arithmetic, comparison, logical, aggregations
- String accessor (`str`): `contains`, `starts_with`, `ends_with`, `lower`, `upper`, `strip`, `substring`, `replace`, `split`, `regex_*`
- DateTime accessor (`dt`): `year`, `month`, `day`, `hour`, `minute`, `second`, `truncate`, `add`
- Array accessor (`arr`): `get`, `slice`, `contains`, `reverse`, `join`, `distinct`, `sort`, `flatten`
- Object accessor (`obj`): `field`, `with_field`, `without`, `rename`, `merge`, `pick`, `omit`
- Query operations: `filter`, `select`, `add_field`, `aggregate`, `group_by`, `unique_by`, `head`, `tail`
- Type predicates: `is_null`, `is_bool`, `is_int`, `is_float`, `is_numeric`, `is_string`, `is_array`, `is_object`, `is_date`, `is_datetime`, `is_duration`
- Conditional: `when().then().otherwise()`, `case()` builder

**Missing from Python (Phase 14 features):**

| Feature | Rust Location | Python Surface |
|---------|---------------|----------------|
| `abs()` | `Expr::abs()` | `Expr.abs()` |
| `round(decimals)` | `Expr::round()` | `Expr.round(decimals)` |
| `floor()` | `Expr::floor()` | `Expr.floor()` |
| `ceil()` | `Expr::ceil()` | `Expr.ceil()` |
| `modulo(other)` | `Expr::modulo()` | `Expr % other` (already works via `__mod__`?) or `Expr.mod_(other)` |
| `pow(exp)` | `Expr::pow()` | `Expr ** other` (via `__pow__`) or `Expr.pow(exp)` |
| `weekday()` | `Expr::weekday()` | `Expr.dt.weekday()` |
| `week()` | `Expr::week()` | `Expr.dt.week()` |
| `quarter()` | `Expr::quarter()` | `Expr.dt.quarter()` |
| `epoch()` | `Expr::epoch()` | `Expr.dt.epoch()` |
| `strip_prefix(prefix)` | `Expr::strip_prefix()` | `Expr.str.strip_prefix(prefix)` or `Expr.str.removeprefix(prefix)` |
| `strip_suffix(suffix)` | `Expr::strip_suffix()` | `Expr.str.strip_suffix(suffix)` or `Expr.str.removesuffix(suffix)` |
| `is_in(list)` | `Expr::is_in()` | `Expr.is_in(list)` |
| `keys()` / `keys_lenient()` | `Expr::keys()` | `Expr.obj.keys()` / `Expr.obj.keys(lenient=True)` |
| `values()` / `values_lenient()` | `Expr::values()` | `Expr.obj.values()` / `Expr.obj.values(lenient=True)` |
| `to_entries()` | `Expr::to_entries()` | `Expr.obj.to_entries()` |
| `from_entries()` | `Expr::from_entries()` | `Expr.obj.from_entries()` (or `arr.from_entries()`) |
| `map(mapper)` | `Expr::map()` | `Expr.arr.map(mapper)` |
| `sample(n, seed)` | `TableOps::sample()` | `Arbor.sample(n, seed=None)` |
| `shuffle(seed)` | `TableOps::shuffle()` | `Arbor.shuffle(seed=None)` |
| `explode(path)` | `Explodable::explode()` | `Arbor.explode(path)`, `Tree.explode(path)` |
| `add_fields(fields)` | `add_fields()` fn | `Arbor.add_fields(...)` |
| `join(...)` | `join()` fn | `arbors.join(left, right, on, how)` |
| `JoinType` | `JoinType` enum | `arbors.JoinType` enum |

---

#### 14.7.2 API Design Decisions

##### D7: Python Operator Support for Numeric Operations (DECIDED)

**Decision:** Add `__mod__` and `__pow__` operators for Pythonic syntax (`expr % 2`, `expr ** 2`), plus named methods (`mod_()`, `pow()`) as aliases.

**Rationale:**
- Pythonic: users expect `%` and `**` to work on expression objects
- Consistent with existing `__add__`, `__sub__`, `__mul__`, `__truediv__` operators already in the Expr class

##### D8: Temporal Accessor Additions (DECIDED)

**Decision:** Add `weekday()`, `week()`, `quarter()`, `epoch()` to `ExprDateTimeAccessor` (the `.dt` accessor).

##### D9: String Accessor Additions (DECIDED)

**Decision:** Add `strip_prefix()` and `strip_suffix()` to `ExprStrAccessor` (the `.str` accessor).

**Naming:** Follow Python 3.9+ naming convention:
- `removeprefix(prefix)` (Python 3.9 str method name)
- `removesuffix(suffix)` (Python 3.9 str method name)
- Also provide `strip_prefix()` / `strip_suffix()` as aliases for Rust API consistency

##### D10: Object Introspection API (DECIDED)

**Decision:** Add `keys()`, `values()`, `to_entries()` to `ExprObjectAccessor` (the `.obj` accessor).

**Lenient mode:** Use optional `lenient` parameter: `expr.obj.keys(lenient=True)`.

**from_entries:** Add to `ExprArrayAccessor` since it operates on arrays: `expr.arr.from_entries()`.

##### D11: Map with @ Binding (DECIDED)

**Decision:** Add `map(mapper)` to `ExprArrayAccessor`.

**@ binding in Python:** The `@` in path expressions works in Python via `path("@")`:
```python
# Rust: path("items").map(path("@").mul(lit(2)))
# Python: path("items").arr.map(path("@") * 2)
```

##### D12: Join API (DECIDED)

**Decision:** Expose as module-level function `arbors.join()` with `JoinType` enum:

```python
from arbors import join, JoinType, path

result = join(
    left=arbor1,
    right=arbor2,
    on=[path("id")],
    how=JoinType.INNER  # or LEFT, RIGHT, OUTER
)
```

##### D13: Explode API (DECIDED)

**Decision:** Add `explode(path)` method to `Arbor` and `Tree` classes:

```python
# Explode array at path
exploded = arbor.explode(path("items"))

# Tree.explode() returns Arbor
exploded_arbor = tree.explode(path("items"))
```

##### D14: Sample/Shuffle API (DECIDED)

**Decision:** Add to `Arbor` class with optional seed parameter:

```python
sampled = arbor.sample(10, seed=42)  # 10 random trees, reproducible
shuffled = arbor.shuffle(seed=42)    # All trees in random order
```

##### D15: is_in with Python Lists (DECIDED)

**Decision:** Support Python list literals directly in `is_in()`:

```python
# Both forms work:
path("status").is_in(["active", "pending"])  # Python list literal
path("value").is_in(path("allowed_values"))   # Expr for dynamic list
```

**Rationale:**
- Pythonic: users expect to pass Python lists directly
- Reduces boilerplate: no need for `array([lit(1), lit(2), lit(3)])`

##### D16: MISSING Sentinel for Python (DECIDED)

**Decision:** Add `arbors.MISSING` singleton to distinguish missing from null in Python:

```python
from arbors import MISSING

result = tree.eval(path("nonexistent_field"))
if result is MISSING:
    print("Field does not exist")
elif result is None:
    print("Field exists but is null")
else:
    print(f"Field value: {result}")
```

**Implementation:**
- `MissingSentinel` class with singleton instance `MISSING`
- `expr_result_to_python()` returns `MISSING` for `ExprResult::Missing`, `None` for `ExprResult::Null`
- Group-by keys preserve distinction: null group ≠ missing group
- Join keys: both null and missing exclude from matches, but remain distinct in results

**API Scope — which methods return MISSING vs None:**

| API | Missing field | Null field | Rationale |
|-----|---------------|------------|-----------|
| `tree.eval(path("x"))` | `MISSING` | `None` | Expression evaluation: full fidelity |
| `tree.path("x")` | `MISSING` | `Node` with null | Path navigation: full fidelity |
| `node.get("x")` | `None` | `Node` with null | Dict-like API: Python idiom |
| `node.get("x", default)` | `default` | `Node` with null | Dict-like API: Python idiom |
| `node["x"]` | `KeyError` | `Node` with null | Dict-like API: Python idiom |
| `group_by` keys | `MISSING` key | `None` key | Grouping: full fidelity |
| `join` keys | excluded | excluded | Join semantics: both excluded |

**Note:** `node.get()` returns `None` for missing fields (not `MISSING`) to match Python dict idiom.
Users who need to distinguish should use `tree.eval()` or check `"x" in node` first.

**Rationale:**
- Maintains full fidelity with Rust D2 semantics ("null and missing are distinct everywhere")
- Allows complete testing of Phase 14 semantics from Python
- Singleton pattern matches Python idiom (`None` is `NoneType()` singleton)
- Explicit `is` comparison: `result is MISSING`, `result is None`
- Dict-like APIs (`node.get()`, `node["x"]`) preserve Python idiom for navigation

---

#### 14.7.3 Implementation Plan

##### Step 0: MISSING Sentinel Infrastructure

**Commit:** `phase-14.7-python-missing-sentinel`

**References:** 14.7.2 D16 (MISSING sentinel), 14.0 D2 (null and missing are distinct everywhere)

**Tasks:**
- [x] Create `MissingSentinel` class in Python module with:
  - `__repr__` → `"MISSING"`
  - `__bool__` → `False` (falsy like None)
  - `__reduce__` → pickle support returning singleton
  - (No `__eq__`/`__hash__` needed — default object identity semantics are correct)
- [x] Export singleton `MISSING` instance from `arbors` module
- [x] Update `expr_result_to_python()` to return `MISSING` for `ExprResult::Missing`
- [x] Update `expr_result_to_python()` to return `None` for `ExprResult::Null`
- [x] Update `tree.path()` to return `MISSING` for missing paths (not `None`)
- [x] Add `MISSING` to `python/arbors/__init__.py` exports
- [x] Add `MISSING` to `python/arbors/_arbors.pyi` stubs with type annotation
- [x] **AUDIT:** Update existing tests that expect `None` for missing fields in `tree.eval()` or `tree.path()`
- [x] **GREP AUDIT:** Search for `tree.eval(...) is None` and `tree.path(...) is None` patterns in tests/examples

**Location:** `python/src/lib.rs` — new `MissingSentinel` pyclass and `MISSING` constant

**Audit Scope (tests to update):**

| File | Test | Change |
|------|------|--------|
| `test_tree.py` | `test_tree_path_missing_returns_none` | Rename + assert `MISSING` |
| `test_tree.py` | `test_tree_path_invalid_array_index_returns_none` | Rename + assert `MISSING` |
| `test_expr.py` | `TestObjectField.test_field_missing` | Assert `MISSING` (not `None`) |
| `test_node.py` | `test_get_missing` | Keep `None` (dict-like API) |
| `test_integration.py` | `test_dict_pattern_get` | Keep `None` (dict-like API) |

**Note:** Tests using `node.get("missing")` stay unchanged (dict-like API returns `None`).
Only `tree.eval()` and `tree.path()` tests need updating.

**Semantic clarification — null_to_default vs default_if_missing:**

The Rust evaluator already distinguishes these (see `eval.rs:3080-3121`):
- `null_to_default(default)`: Returns default if value is Null OR Missing (COALESCE-like)
- `default_if_missing(default)`: Returns default ONLY if Missing; preserves explicit Null

So the existing test `path("missing_field").null_to_default(lit("default"))` returning `"default"`
is **correct and intentional** — `null_to_default` handles both. Add explicit tests for both:

| Test | Input | Expected |
|------|-------|----------|
| `null_to_default` on null field | `{"x": null}` → `path("x").null_to_default(lit(0))` | `0` |
| `null_to_default` on missing field | `{}` → `path("x").null_to_default(lit(0))` | `0` |
| `default_if_missing` on null field | `{"x": null}` → `path("x").default_if_missing(lit(0))` | `None` (preserves null) |
| `default_if_missing` on missing field | `{}` → `path("x").default_if_missing(lit(0))` | `0` |

**Unit Tests:**
- [x] `test_python_missing_sentinel_identity` — `MISSING is MISSING` (singleton)
- [x] `test_python_missing_vs_none` — `MISSING is not None`
- [x] `test_python_eval_missing_field` — `tree.eval(path("missing"))` returns `MISSING`
- [x] `test_python_eval_null_field` — `tree.eval(path("null_field"))` returns `None`
- [x] `test_python_eval_present_field` — present field returns value
- [x] `test_python_path_missing` — `tree.path("missing")` returns `MISSING`
- [x] `test_python_path_null` — `tree.path("null_field")` returns Node with null value
- [x] `test_python_node_get_missing` — `node.get("missing")` returns `None` (dict idiom)
- [x] `test_python_node_getitem_missing` — `node["missing"]` raises `KeyError`
- [x] `test_python_missing_repr` — `repr(MISSING)` is readable (e.g., `"MISSING"`)
- [x] `test_python_missing_bool` — `bool(MISSING)` is `False` (falsy like None)
- [x] `test_python_missing_hashable` — `{MISSING: 1}` works (default identity hash)
- [x] `test_python_missing_in_set` — `{MISSING, None, 1}` has 3 elements
- [x] `test_python_missing_pickle_roundtrip` — `pickle.loads(pickle.dumps(MISSING)) is MISSING`
- [x] `test_python_missing_not_in_to_python` — `tree.to_python()` never contains `MISSING` (converts to dicts/lists/None)
- [x] `test_python_group_by_null_vs_missing` — separate groups for null and missing keys
- [x] `test_python_group_by_access_missing_key` — `groups[MISSING]` returns the missing group
- [x] `test_python_null_to_default_on_null` — `null_to_default` replaces null with default
- [x] `test_python_null_to_default_on_missing` — `null_to_default` replaces missing with default
- [x] `test_python_default_if_missing_on_null` — `default_if_missing` preserves null
- [x] `test_python_default_if_missing_on_missing` — `default_if_missing` returns default

**Checkpoint:** `make python && make check-stubs && make check-parity && .venv/bin/pytest python/tests/ -v` ✓

**Note:** Full test suite runs to verify audit changes don't break existing behavior.

---

##### Step 1: Numeric Expression Operations

**Commit:** `phase-14.7-python-numeric-ops`

**References:** 14.7.1 (missing features table: `abs`, `round`, `floor`, `ceil`, `modulo`, `pow`), 14.7.2 D7 (operator support)

**Tasks:**
- [x] Add `abs()` method to Python `Expr` class
- [x] Add `round(decimals: int = 0)` method to Python `Expr` class
- [x] Add `floor()` method to Python `Expr` class
- [x] Add `ceil()` method to Python `Expr` class
- [x] Add `__mod__` and `__rmod__` operators (`%`) to Python `Expr` class
- [x] Add `mod_()` method alias to Python `Expr` class
- [x] Add `__pow__` and `__rpow__` operators (`**`) to Python `Expr` class
- [x] Add `pow()` method to Python `Expr` class

**Location:** `python/src/lib.rs` in `#[pymethods] impl Expr` block

**Unit Tests:**
- [x] `test_python_abs_int_float` — abs on integers and floats
- [x] `test_python_round_decimals` — round with various decimal places
- [x] `test_python_floor_ceil` — floor and ceil behavior
- [x] `test_python_mod_operator` — `%` operator works (`expr % 2`)
- [x] `test_python_mod_reflected` — reflected `%` works (`2 % expr`)
- [x] `test_python_pow_operator` — `**` operator works (`expr ** 2`)
- [x] `test_python_pow_reflected` — reflected `**` works (`2 % expr`)
- [x] `test_python_mod_precedence` — `(path("x") % 2) == 0` correct grouping
- [x] `test_python_numeric_null_propagation` — null propagates through numeric ops

**Checkpoint:** `make python && make check-stubs && make check-parity && .venv/bin/pytest python/tests/test_numeric_ops.py -v` ✓

---

##### Step 2: Temporal Expression Operations

**Commit:** `phase-14.7-python-temporal-ops`

**References:** 14.7.1 (missing features table: `weekday`, `week`, `quarter`, `epoch`), 14.7.2 D8 (temporal accessor)

**Tasks:**
- [x] Add `weekday()` method to `ExprDateTimeAccessor`
- [x] Add `week()` method to `ExprDateTimeAccessor`
- [x] Add `quarter()` method to `ExprDateTimeAccessor`
- [x] Add `epoch()` method to `ExprDateTimeAccessor`

**Location:** `python/src/lib.rs` in `#[pymethods] impl ExprDateTimeAccessor` block

**Unit Tests:**
- [x] `test_python_dt_weekday` — Monday=0 through Sunday=6
- [x] `test_python_dt_week` — ISO week 1-53
- [x] `test_python_dt_quarter` — 1-4
- [x] `test_python_dt_epoch` — seconds since Unix epoch
- [x] `test_python_temporal_null_propagation` — null propagates

**Checkpoint:** `make python && make check-stubs && make check-parity && .venv/bin/pytest python/tests/test_temporal_ops.py -v` ✓

---

##### Step 3: String Expression Operations

**Commit:** `phase-14.7-python-string-ops`

**References:** 14.7.1 (missing features table: `strip_prefix`, `strip_suffix`), 14.7.2 D9 (string accessor, both aliases)

**Tasks:**
- [x] Add `removeprefix(prefix)` method to `ExprStrAccessor` (Python 3.9+ naming)
- [x] Add `removesuffix(suffix)` method to `ExprStrAccessor` (Python 3.9+ naming)
- [x] Add `strip_prefix(prefix)` alias to `ExprStrAccessor` (Rust-consistent)
- [x] Add `strip_suffix(suffix)` alias to `ExprStrAccessor` (Rust-consistent)

**Location:** `python/src/lib.rs` in `#[pymethods] impl ExprStrAccessor` block

**Unit Tests:**
- [x] `test_python_str_removeprefix` — removes prefix when present
- [x] `test_python_str_removesuffix` — removes suffix when present
- [x] `test_python_str_strip_prefix_alias` — alias works same as removeprefix
- [x] `test_python_str_prefix_no_match` — unchanged when no match
- [x] `test_python_str_suffix_no_match` — unchanged when no match

**Checkpoint:** `make python && make check-stubs && make check-parity && .venv/bin/pytest python/tests/test_string_ops.py -v` ✓

---

##### Step 4: Membership Expression (is_in)

**Commit:** `phase-14.7-python-is-in`

**References:** 14.7.1 (missing features table: `is_in`), 14.7.2 D15 (Python list support)

**Tasks:**
- [x] Add `is_in(list)` method to Python `Expr` class
- [x] Accept `Union[list, Expr]` as the `list` argument
- [x] Convert Python list literals to `Expr::Array` of literals internally

**Location:** `python/src/lib.rs` in `#[pymethods] impl Expr` block

**Unit Tests:**
- [x] `test_python_is_in_literal_list` — `is_in([1, 2, 3])` with Python list
- [x] `test_python_is_in_string_list` — `is_in(["a", "b"])` with Python list
- [x] `test_python_is_in_not_found` — returns False when not in list
- [x] `test_python_is_in_null_handling` — null in list matches null value
- [x] `test_python_is_in_missing_handling` — MISSING in list matches MISSING value
- [x] `test_python_is_in_expr_list` — dynamic list from path expression
- [x] `test_python_is_in_none_in_list` — `is_in([1, None, 3])` with Python None
- [x] `test_python_is_in_mixed_types` — `is_in([1, "a", True])` mixed types
- [x] `test_python_is_in_float_nan` — `is_in([1.0, float("nan")])` NaN behavior
- [x] `test_python_is_in_dict_error` — `is_in([{"a": 1}])` raises error (objects not allowed)
- [x] `test_python_is_in_equiv_to_array_lit` — list literal same as `array([lit(...)])`

**Checkpoint:** `make python && make check-stubs && make check-parity && .venv/bin/pytest python/tests/test_membership_ops.py -v` ✓

---

##### Step 5: Object Introspection (keys/values/entries)

**Commit:** `phase-14.7-python-object-introspection`

**References:** 14.7.1 (missing features table: `keys`, `values`, `to_entries`, `from_entries`), 14.7.2 D10 (object introspection API, lenient mode)

**Tasks:**
- [x] Add `keys(lenient=False)` method to `ExprObjectAccessor`
- [x] Add `values(lenient=False)` method to `ExprObjectAccessor`
- [x] Add `to_entries()` method to `ExprObjectAccessor`
- [x] Add `from_entries()` method to `ExprArrayAccessor`

**Location:** `python/src/lib.rs` in `#[pymethods] impl ExprObjectAccessor` and `ExprArrayAccessor`

**Unit Tests:**
- [x] `test_python_obj_keys_strict` — keys on object
- [x] `test_python_obj_keys_lenient` — keys on array returns indices
- [x] `test_python_obj_keys_strict_error` — error on non-object when lenient=False
- [x] `test_python_obj_values_strict` — values on object
- [x] `test_python_obj_values_lenient` — values on array returns elements
- [x] `test_python_obj_to_entries` — object to entries array
- [x] `test_python_arr_from_entries` — entries array to object
- [x] `test_python_entries_round_trip` — to_entries().from_entries() == original

**Checkpoint:** `make python && make check-stubs && make check-parity && .venv/bin/pytest python/tests/test_object_introspection.py -v` ✓

---

##### Step 6: Array Map Operation

**Commit:** `phase-14.7-python-map`

**References:** 14.7.1 (missing features table: `map`), 14.7.2 D11 (map method, `@` binding)

**Tasks:**
- [x] Add `map(mapper)` method to `ExprArrayAccessor`
- [x] Ensure `path("@")` works in Python for current element binding

**Location:** `python/src/lib.rs` in `#[pymethods] impl ExprArrayAccessor`

**Unit Tests:**
- [x] `test_python_arr_map_simple` — `[1,2,3].map(@ * 2)` → `[2,4,6]`
- [x] `test_python_arr_map_string` — map string operations
- [x] `test_python_arr_map_object` — map to extract field from objects
- [x] `test_python_arr_map_conditional` — map with when/then
- [x] `test_python_arr_map_empty` — empty array → empty array
- [x] `test_python_arr_map_null_elements` — null elements propagate

**Checkpoint:** `make python && make check-stubs && make check-parity && .venv/bin/pytest python/tests/test_phase14.py -k map -v` ✓

---

##### Step 7: Sample and Shuffle (TableOps)

**Commit:** `phase-14.7-python-sample-shuffle`

**References:** 14.7.1 (missing features table: `sample`, `shuffle`), 14.7.2 D14 (TableOps, optional seed)

**Tasks:**
- [x] Add `sample(n, seed=None)` method to `Arbor` class
- [x] Add `shuffle(seed=None)` method to `Arbor` class

**Location:** `python/src/lib.rs` in `#[pymethods] impl Arbor` block

**Unit Tests:**
- [x] `test_python_sample_basic` — sample n trees
- [x] `test_python_sample_with_seed` — reproducible sampling
- [x] `test_python_sample_clamp` — n > len returns all
- [x] `test_python_shuffle_basic` — all trees present after shuffle
- [x] `test_python_shuffle_with_seed` — reproducible shuffle
- [x] `test_python_shuffle_different_order` — order changes (probabilistic)

**Checkpoint:** `make python && make check-stubs && make check-parity && .venv/bin/pytest python/tests/test_phase14.py -k "sample or shuffle" -v` ✓

---

##### Step 8: Explode Operation

**Commit:** `phase-14.7-python-explode`

**References:** 14.7.1 (missing features table: `explode`), 14.7.2 D13 (explode API: Arbor→Arbor, Tree→Arbor), 14.0 D4 (explode returns Arbor)

**Tasks:**
- [x] Add `explode(path)` method to `Arbor` class
- [x] Add `explode(path)` method to `Tree` class (returns Arbor)

**Location:** `python/src/lib.rs` in `#[pymethods] impl Arbor` and `#[pymethods] impl Tree` blocks

**Unit Tests:**
- [x] `test_python_arbor_explode` — explode array at path
- [x] `test_python_tree_explode_returns_arbor` — Tree.explode() → Arbor
- [x] `test_python_explode_empty_array` — empty array → excluded from result
- [x] `test_python_explode_non_array` — scalar passes through unchanged
- [x] `test_python_explode_preserves_fields` — other fields preserved
- [x] `test_python_explode_missing_path` — missing path passes through unchanged
- [x] `test_python_explode_null_path` — null at path passes through unchanged
- [x] `test_python_explode_array_with_nulls` — array `[1, null, 3]` explodes with null element
- [x] `test_python_explode_nested_path` — nested path `path("a.b.items")` works
- [x] `test_python_explode_cardinality` — 3 trees × 2-element arrays → 6 trees

**Checkpoint:** `make python && make check-stubs && make check-parity && .venv/bin/pytest python/tests/test_phase14.py -k explode -v` ✓

---

##### Step 9: Add Fields (Batch) ✓

**Commit:** `phase-14.7-python-add-fields`

**References:** 14.7.1 (missing features table: `add_fields`)

**Tasks:**
- [x] Add `add_fields(fields)` method to `Arbor` class
- [x] Add `add_fields(fields)` method to `Tree` class
- [x] Accept dict or list of tuples as `fields` argument

**Location:** `python/src/lib.rs` in `#[pymethods] impl Arbor` and `impl Tree` blocks

**API:**
```python
# Dict syntax
arbor.add_fields({
    "full_name": path("first") + lit(" ") + path("last"),
    "is_adult": path("age") >= 18
})

# List of tuples syntax
arbor.add_fields([
    ("full_name", path("first") + lit(" ") + path("last")),
    ("is_adult", path("age") >= 18)
])
```

**Unit Tests:**
- [x] `test_python_add_fields_dict` — dict syntax
- [x] `test_python_add_fields_list` — list of tuples syntax
- [x] `test_python_add_fields_multiple` — multiple fields at once
- [x] `test_python_add_fields_overwrite` — overwrites existing field
- [x] `test_tree_add_fields_*` — Tree.add_fields tests (dict, list, edge cases, chaining)

**Checkpoint:** `make python && make check-stubs && make check-parity && .venv/bin/pytest python/tests/test_add_fields.py -v` ✓

---

##### Step 10: Join Operation ✓

**Commit:** `phase-14.7-python-join`

**References:** 14.7.1 (missing features table: `join`, `JoinType`), 14.7.2 D12 (JoinType enum, nested output), 14.0 D3 (join output structure)

**Tasks:**
- [x] Add `JoinType` enum to Python module (INNER, LEFT, RIGHT, OUTER, CROSS, SEMI, ANTI)
- [x] Add `join(left, right, on, how)` function to Python module
- [x] Handle `on` as single Expr or list of Exprs
- [x] Add support for these join operations:
    - [x] inner: (Default) Returns rows that have matching values in both tables.
    - [x] left: Returns all rows from the left table, and the matched rows from the right table.
    - [x] right: Returns all rows from the right table, and the matched rows from the left table.
    - [x] full: Returns all rows when there is a match in either left or right.
    - [ ] cross: Returns the Cartesian product of rows from both tables (not yet in Rust backend)
    - [ ] semi: Returns rows from the left table that have a match in the right table (not yet in Rust backend)
    - [ ] anti: Returns rows from the left table that have no match in the right table (not yet in Rust backend)

**Location:** `python/src/lib.rs` — new `JoinType` pyclass and `join` pyfunction

**API:**
```python
from arbors import join, JoinType, path

# Inner join
result = join(left, right, on=path("id"), how=JoinType.INNER)

# Left join with multiple keys
result = join(left, right, on=[path("a"), path("b")], how=JoinType.LEFT)
```

**Unit Tests:** (in `python/tests/test_join.py`)
- [x] `test_join_inner_simple_match` — inner join matches
- [x] `test_join_left_all_left_preserved` — left join preserves all left
- [x] `test_join_right_all_right_preserved` — right join preserves all right
- [x] `test_join_outer_includes_all` — outer join includes all
- [x] `test_join_multi_key_both_match` — join on multiple keys
- [x] `test_join_null_keys_dont_match` — null keys don't match (separate from missing)
- [x] `test_join_missing_keys_dont_match` — missing keys don't match (separate from null)
- [x] `test_join_nested_output_structure` — result is `{left: ..., right: ...}`
- [x] `test_join_many_to_many_multiplicity` — duplicate keys on both sides → correct multiplicity
- [x] `test_join_multi_key_partial_match` — composite key with partial matches
- [x] `test_join_empty_left` — empty left arbor
- [x] `test_join_empty_right` — empty right arbor
- [x] `test_join_order_determinism` — output order is stable (left then right)
- [x] Plus 54 additional corner case tests (67 total) covering:
  - Float keys, self-joins, chained joins, immutability
  - Edge case keys (empty string, zero, negative, unicode)
  - All-null/all-missing key scenarios
  - Deeply nested paths, right join edge cases
  - Outer join no-overlap, duplicate keys (left-only, right-only)
  - Multi-key (3 keys, mixed types, one null)
  - Result access patterns, large multiplicities

**Checkpoint:** `make python && make check-stubs && make check-parity && .venv/bin/pytest python/tests/test_join.py -v` ✓

---

#### 14.7.4 Integration Tests (Python) ✓

**Location:** `python/tests/test_api_parity_integration.py`

**Tests:** (33 tests in 13 test classes)
- [x] `TestNumericOpsChained` — chain abs, round, floor, ceil, %, ** with filter (5 tests)
- [x] `TestTemporalOpsGroupBy` — group by weekday/quarter (2 tests)
- [x] `TestStringOpsFilter` — filter after removeprefix/removesuffix (2 tests)
- [x] `TestIsInFilter` — filter by is_in with nulls (2 tests)
- [x] `TestKeysValuesAggregate` — aggregate over keys/values (3 tests)
- [x] `TestToFromEntriesRoundTrip` — entries round-trip (2 tests)
- [x] `TestMapWithAggregation` — map then sum/count (2 tests)
- [x] `TestExplodeThenFilter` — explode, filter, aggregate (2 tests)
- [x] `TestSampleAggregateTolerance` — sample aggregate tolerance (2 tests)
- [x] `TestAddFieldsComputed` — add computed fields with conditionals (2 tests)
- [x] `TestJoinThenAggregate` — join then filter/add_fields (2 tests)
- [x] `TestPipelineComplete` — full ETL pipeline with join (2 tests)
- [x] `TestNullVsMissingEverywhere` — D2 semantics: null ≠ missing in filter, join, is_in, group_by (5 tests)

**Checkpoint:** `.venv/bin/pytest python/tests/test_api_parity_integration.py -v` ✓

---

#### 14.7.5 Checkpoints ✓

| Checkpoint | Verification | Status |
|------------|--------------|--------|
| MISSING sentinel | `arbors.MISSING` singleton distinguishes missing from null | ✓ Verified |
| Numeric ops in Python | `abs`, `round`, `floor`, `ceil`, `%`, `**`, reflected ops work | ✓ Verified |
| Temporal ops in Python | `weekday`, `week`, `quarter`, `epoch` on `.dt` accessor | ✓ Verified |
| String ops in Python | `removeprefix`, `removesuffix` + aliases on `.str` accessor | ✓ Verified |
| Membership in Python | `is_in()` with lists, exprs, type matrix | ✓ Verified |
| Object introspection | `keys`, `values`, `to_entries`, `from_entries` work | ✓ Verified |
| Map in Python | `.arr.map()` with `@` binding works | ✓ Verified |
| Sample/Shuffle | `Arbor.sample()`, `Arbor.shuffle()` work | ✓ Verified |
| Explode | `Arbor.explode()`, `Tree.explode()` with edge cases | ✓ Verified |
| Add fields | `Arbor.add_fields()`, `Tree.add_fields()` work | ✓ Verified |
| Join | `arbors.join()` with cardinality, null/missing key tests (67 tests) | ✓ Verified |
| Python tests pass | All `python/tests/test_api_parity_integration.py` tests pass (33 tests) | ✓ Verified |
| `make python` | Python build succeeds | ✓ Verified |
| `make check-stubs` | Type stubs match runtime | ✓ Verified |
| `make check-parity` | Manifest matches runtime API (67 exports) | ✓ Verified |

**Final CI result:** 1901 passed, 5 skipped
