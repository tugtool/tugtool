# Phase 13: API Design Focus on Trees

**Goal:** Rework the current API to be an excellent tree-focused offering that treats JSON documents as first-class trees while maintaining powerful cross-tree operations.

**Status:** Planning

---

## Vision

Arbors aims to be what `jq` would be if it were a full programming library rather than a command-line tool. The guiding principle from jq: *"transform JSON in various ways, by selecting, iterating, reducing and otherwise mangling JSON documents"* — but with complete programmatic rigor, type safety, and performance.

### Design Principles

1. **Verb-based API**: Methods are actions, not descriptions. `add_field()` not `with_column()`.
2. **Tree-first, collection-capable**: Every tree is a document to navigate and transform. Collections of trees support filtering, aggregation, and selection.
3. **Exact Python parity**: Rust and Python APIs use identical method names and semantics.
4. **Clean break**: No backward compatibility burden. No deprecation warnings. Fresh start.
5. **Future-ready**: Lay groundwork for arbors-native file format (flatbuffers-style fast serialization).

### No Migration Required

**IMPORTANT:** This is a brand new library with ZERO external users. There is no need for:
- Deprecation warnings
- Legacy API shims
- Migration guides for external consumers
- Backward compatibility

We can make breaking changes freely. The "migration guide" mentioned elsewhere is purely internal documentation for our own reference.

### Typical Workflow

```
JSONL input → parse → filter trees → select/aggregate → transform individual trees → output
             ↑                                          ↑
        Collection ops                            Document ops
        (cross-tree)                              (per-tree)
```

---

## Decisions Made

All open questions have been resolved:

| Question | Decision | Rationale | Section |
|----------|----------|-----------|---------|
| `struct_()` vs `object()` | **`object()`** | JSON terminology alignment | 13.0 |
| `list_()` vs `array()` | **`array()`** | JSON terminology alignment | 13.0 |
| `select()` rename | **Keep `select()`** | Reverted from `project()` - "select" is clearer, matches jq, `project` is database jargon | 13.1 |
| Path creation | **Strict by default** | Fail-fast catches typos; `create_path=True` for convenience | 13.4 |
| Fluent chaining | **Via `LazyTree`** | Leverages lazy infrastructure for operation fusion | 13.7 |

---

## References

- [jq Manual](https://jqlang.github.io/jq/manual/) - Inspiration for tree manipulation semantics
- [JSONPath Specification](https://goessner.net/articles/JsonPath/) - Path syntax reference
- [Polars Expression System](https://docs.pola.rs/user-guide/expressions/) - Expression design patterns
- [FlatBuffers](https://flatbuffers.dev/) - Inspiration for future file format

---

## Phase 13.1 API Audit and Renaming

**Purpose:** Rename DataFrame-esque methods to verb-based, tree-focused alternatives.

**Status:** Complete

### 13.1.1 Compatibility Stance

**HARD BREAK - NO BACKWARD COMPATIBILITY**

This is brand new code with zero external users. There is no need for:
- Deprecation warnings
- Legacy API shims or aliases
- Migration guides for external consumers
- Backward compatibility of any kind

We make breaking changes freely.

---

### 13.1.2 Scope

This phase focuses ONLY on renaming existing methods. New operations are in later phases.

**In Scope:**
- Keep `select()` as-is (reverted from `project()` - see Decisions Made)
- Rename `agg()` → `aggregate()`
- Rename `with_column()` → `add_field()`
- Remove `num_rows()` alias (keep only `num_trees()`)
- Remove `root_node()` alias (keep only `root()`)

**Out of Scope (later phases):**
- New field operations (`remove_field`, `rename_field`, `move_field`)
- New array operations (`append_to_array`, etc.)
- New collection operations (`sort_by`, `group_by`, `unique_by`)

---

### 13.1.3 Definitive Symbol Inventory

**Enum Variants to Rename (in `crates/arbors-lazy/src/plan.rs`):**

| Current | New | Occurrences |
|---------|-----|-------------|
| `QueryOp::Select { exprs }` | **Keep as-is** | (reverted from Project) |
| `QueryOp::Agg { exprs }` | `QueryOp::Aggregate { exprs }` | plan.rs, lazy.rs, execute.rs, optimize.rs |
| `QueryOp::WithColumn { name, expr }` | `QueryOp::AddField { name, expr }` | plan.rs, lazy.rs, execute.rs, optimize.rs |

**Display/Debug Output to Update (in `crates/arbors-lazy/src/plan.rs:113-120`):**
- `"Select"` → **Keep as-is**
- `"Agg"` → `"Aggregate"`
- `"WithColumn"` → `"AddField"`

**Functions to Rename:**

| Current | New | File |
|---------|-----|------|
| `pub fn select(...)` | **Keep as-is** | (reverted) |
| `pub fn agg(...)` | `pub fn aggregate(...)` | `crates/arbors-query/src/ops.rs:284` |
| `pub fn with_column(...)` | `pub fn add_field(...)` | `crates/arbors-query/src/ops.rs:184` |
| `pub fn apply_with_column(...)` | `pub fn apply_add_field(...)` | `crates/arbors-query/src/ops.rs:210` |
| `execute_select(...)` | **Keep as-is** | (reverted) |
| `execute_agg(...)` | `execute_aggregate(...)` | `crates/arbors-lazy/src/execute.rs` |
| `execute_with_column(...)` | `execute_add_field(...)` | `crates/arbors-lazy/src/execute.rs` |

**Methods to Rename (LazyArbor in `crates/arbors-lazy/src/lazy.rs`):**

| Current | New | Line |
|---------|-----|------|
| `pub fn select(...)` | **Keep as-is** | (reverted) |
| `pub fn with_column(...)` | `pub fn add_field(...)` | 112 |
| `pub fn agg(...)` | `pub fn aggregate(...)` | 151 |

**Aliases to DELETE (no replacement):**

| Symbol | File | Line |
|--------|------|------|
| `pub fn num_rows(&self)` | `crates/arbors-storage/src/lib.rs` | ~302 |
| `pub fn root_node(&self, row_idx)` | `crates/arbors-storage/src/lib.rs` | ~312 |
| `fn num_rows(&self)` | `python/src/lib.rs` | ~1615 |
| `def num_rows(self)` | `python/arbors/_arbors.pyi` | ~543 |

---

### 13.1.4 Search Surfaces Checklist

All locations that may contain old API names:

| Surface | Path | Status |
|---------|------|--------|
| Rust core crates | `crates/arbors-*/src/*.rs` | Must update |
| Rust tests | `crates/arbors-*/tests/*.rs` | Must update |
| Rust benches | `crates/arbors-lazy/benches/*.rs` | Must update |
| Python bindings | `python/src/lib.rs` | Must update |
| Python stubs | `python/arbors/_arbors.pyi` | Must update |
| Python exports | `python/arbors/__init__.py` (`__all__`) | Verify (methods not in `__all__`) |
| API manifest | `python/api_manifest.toml` | Must update |
| Python tests | `python/tests/*.py` | Must update |
| Python examples | `python/examples/*.py` | Must update |
| Python benchmarks | `python/benchmarks/*.py` | Must update |
| Root examples | `examples/*.py` | Must update |
| README | `README.md` | Must update if contains API |
| docs/ | `docs/*.md` | Must update if contains API |

**NOT updated (historical/reference only):**
- `plans/*.md` - Planning documents
- `chats/*.md` - Chat logs

---

### 13.1.5 Method Renaming Strategy

| Current Name | New Name | Rationale |
|--------------|----------|-----------|
| `select([exprs])` | **Keep as-is** | Reverted from `project()` - clearer, matches jq terminology |
| `agg([exprs])` | `aggregate([exprs])` | Full verb, clear action |
| `with_column(name, expr)` | `add_field(name, expr)` | Verb-based, tree terminology |
| `num_rows()` | REMOVE | Alias for `num_trees()`, unnecessary duplication |
| `root_node(row_idx)` | REMOVE | Alias for `root()`, unnecessary duplication |

---

### 13.1.6 Execution Steps

**Strategy:** Use the compiler as the refactoring tool. Rename definition → compiler shows all errors → fix each one → verify → commit.

**Ordering:** Rust core/lazy first → Python bindings/stubs → tests/examples → global verification.

---

#### Step 1: Remove Row Terminology Aliases

**Commit:** `refactor(storage): remove num_rows and root_node aliases`

**Delete these symbols entirely:**

| File | Symbol | Line |
|------|--------|------|
| `crates/arbors-storage/src/lib.rs` | `pub fn num_rows(&self)` | ~302 |
| `crates/arbors-storage/src/lib.rs` | `pub fn root_node(&self, row_idx)` | ~312 |
| `python/src/lib.rs` | `fn num_rows(&self)` | ~1615 |
| `python/arbors/_arbors.pyi` | `def num_rows(self)` | ~543 |

**Tasks:**
- [x] Delete `num_rows()` from Rust storage
- [x] Delete `root_node()` from Rust storage
- [x] Delete `num_rows()` from Python bindings
- [x] Delete `num_rows` from Python stubs
- [x] Update `api_manifest.toml` to remove `num_rows`
- [x] Update any tests that use these aliases → use `num_trees()` / `root()`

**Checkpoint:** `cargo build && cargo test` ✓

---

#### Step 2: ~~Rename select() → project()~~ REVERTED - Keep select()

**Status:** REVERTED - `select()` is clearer than `project()`, matches jq terminology, `project` is database jargon.

**No action required** - `select()` remains the method name throughout the codebase.

---

#### Step 3: Rename agg() → aggregate() in Rust Core

**Commit:** `refactor(query): rename agg() to aggregate()`

**Renames:**

| File | Current | New |
|------|---------|-----|
| `crates/arbors-query/src/ops.rs` | `pub fn agg(...)` | `pub fn aggregate(...)` |
| `crates/arbors-lazy/src/lazy.rs:151` | `pub fn agg(...)` | `pub fn aggregate(...)` |
| `crates/arbors-lazy/src/plan.rs` | `QueryOp::Agg { exprs }` | `QueryOp::Aggregate { exprs }` |
| `crates/arbors-lazy/src/plan.rs:117` | `"Agg"` (description) | `"Aggregate"` |
| `crates/arbors-lazy/src/plan.rs:417` | `"Agg({} exprs)"` (display) | `"Aggregate({} exprs)"` |
| `crates/arbors-lazy/src/execute.rs` | `execute_agg(...)`, `execute_agg_parallel(...)` | `execute_aggregate(...)`, `execute_aggregate_parallel(...)` |
| `crates/arbors-lazy/src/execute.rs` | All `QueryOp::Agg` match arms | `QueryOp::Aggregate` |
| `crates/arbors-lazy/src/optimize.rs` | All `QueryOp::Agg` references | `QueryOp::Aggregate` |

**Tasks:**
- [x] Rename function in ops.rs
- [x] Rename method in lazy.rs
- [x] Rename `QueryOp::Agg` → `QueryOp::Aggregate` enum variant
- [x] Update description() and display strings
- [x] Rename execute_agg → execute_aggregate (and parallel variant)
- [x] Fix all match arms in execute.rs (~4 locations)
- [x] Fix all match arms in optimize.rs (~2 locations)
- [x] Fix all match arms in plan.rs tests (~3 locations)
- [x] Update docstrings
- [x] Update re-exports in lib.rs (arbors-query, arbors)
- [x] Update integration tests (lazy_integration.rs)
- [x] Update acceptance tests (expr_acceptance.rs)

**Checkpoint:** `cargo build && cargo test` ✓

---

#### Step 4: Rename with_column() → add_field() in Rust Core

**Commit:** `refactor(query): rename with_column() to add_field()`

**Renames:**

| File | Current | New |
|------|---------|-----|
| `crates/arbors-query/src/ops.rs` | `pub fn with_column(...)` | `pub fn add_field(...)` |
| `crates/arbors-query/src/ops.rs` | `pub fn apply_with_column(...)` | `pub fn apply_add_field(...)` |
| `crates/arbors-lazy/src/lazy.rs:112` | `pub fn with_column(...)` | `pub fn add_field(...)` |
| `crates/arbors-lazy/src/plan.rs` | `QueryOp::WithColumn { name, expr }` | `QueryOp::AddField { name, expr }` |
| `crates/arbors-lazy/src/plan.rs:116` | `"WithColumn"` (description) | `"AddField"` |
| `crates/arbors-lazy/src/plan.rs:416` | `"WithColumn(\"{}\")` (display) | `"AddField(\"{}\")` |
| `crates/arbors-lazy/src/execute.rs` | `execute_with_column(...)`, parallel variant | `execute_add_field(...)`, parallel variant |
| `crates/arbors-lazy/src/execute.rs` | All `QueryOp::WithColumn` match arms | `QueryOp::AddField` |
| `crates/arbors-lazy/src/optimize.rs` | All `QueryOp::WithColumn` references | `QueryOp::AddField` |

**Docstring Updates:**
- "Add or replace a column" → "Add or replace a field"
- "column expression" → "field expression"

**Tasks:**
- [x] Rename functions in ops.rs (both with_column and apply_with_column)
- [x] Rename method in lazy.rs
- [x] Rename `QueryOp::WithColumn` → `QueryOp::AddField` enum variant
- [x] Update description() and display strings
- [x] Rename execute_with_column → execute_add_field (and parallel variant)
- [x] Fix all match arms in execute.rs (~4 locations)
- [x] Fix all match arms in optimize.rs (~4 locations)
- [x] Update docstrings

**Checkpoint:** `cargo build && cargo test` ✓

---

#### Step 5: Update Python Bindings

**Commit:** `refactor(python): update bindings with renamed methods`

**Naming Convention:** Rust function names MUST match PyO3-exposed names to prevent drift.

**Renames:**

| Class | Current Rust fn | New Rust fn | PyO3 exposed name |
|-------|-----------------|-------------|-------------------|
| Arbor | `fn select(...)` | **Keep as-is** | `select` |
| Arbor | `fn with_column(...)` | `fn add_field(...)` | `add_field` |
| Arbor | `fn agg(...)` | `fn aggregate(...)` | `aggregate` |
| LazyArbor | `fn select(...)` | **Keep as-is** | `select` |
| LazyArbor | `fn with_column(...)` | `fn add_field(...)` | `add_field` |
| LazyArbor | `fn agg(...)` | `fn aggregate(...)` | `aggregate` |
| Tree | `fn select(...)` | **Keep as-is** | `select` |

**Tasks:**
- [x] Keep all `select` methods as-is (reverted from project)
- [x] Rename all `with_column` → `add_field` methods
- [x] Rename all `agg` → `aggregate` methods
- [x] Update docstrings in Python bindings
- [x] Verify no `#[pyo3(name = "...")]` needed (Rust name = Python name)

**Checkpoint:** `make python` ✓

---

#### Step 6: Update Python Stubs, Manifest, and Exports

**Commit:** `refactor(python): update stubs, manifest, and exports`

**Files to Update:**

| File | Changes |
|------|---------|
| `python/arbors/_arbors.pyi` | Rename all method signatures |
| `python/arbors/__init__.py` | Verify `__all__` (methods are not exported, only classes) |
| `python/api_manifest.toml` | Update method entries for Arbor, LazyArbor, Tree |

**Stub Renames (in `python/arbors/_arbors.pyi`):**

| Class | Current | New |
|-------|---------|-----|
| Arbor | `def select(...)` | **Keep as-is** |
| Arbor | `def with_column(...)` | `def add_field(...)` |
| Arbor | `def agg(...)` | `def aggregate(...)` |
| LazyArbor | `def select(...)` | **Keep as-is** |
| LazyArbor | `def with_column(...)` | `def add_field(...)` |
| LazyArbor | `def agg(...)` | `def aggregate(...)` |
| Tree | `def select(...)` | **Keep as-is** |

**Tasks:**
- [x] Update `_arbors.pyi` with all renames (select kept as-is)
- [x] Update `api_manifest.toml` method entries (not needed - manifest only contains classes/functions)
- [x] Verify `__init__.py` `__all__` is unchanged (methods not in `__all__`)
- [x] Run `make check-parity` - fix any failures
- [x] Run `make check-stubs` - fix any failures

**Checkpoint:** `make check-parity && make check-stubs` ✓

---

#### Step 7: Update All Tests

**Commit:** `test: update all tests for renamed methods`

**Python Tests:**

| File | Changes |
|------|---------|
| `python/tests/test_expr.py` | `.agg()` → `.aggregate()` |
| `python/tests/test_query.py` | All query method calls |
| `python/tests/test_lazy.py` | All lazy method calls |
| `python/tests/test_edge_cases.py` | Any affected method calls |
| `python/tests/test_integration.py` | Any affected method calls |
| `python/tests/test_expr_acceptance.py` | Any affected method calls |

**Rust Tests:**

| File | Changes |
|------|---------|
| `crates/arbors-lazy/tests/lazy_integration.rs` | All method calls |
| `crates/arbors-lazy/tests/optimize_integration.rs` | All method calls |
| `crates/arbors-lazy/tests/parallel_integration.rs` | All method calls |
| `crates/arbors-query/tests/integration.rs` | All method calls |

**Tasks:**
- [x] Update all `.with_column()` → `.add_field()` in Python tests
- [x] Update all `.agg()` → `.aggregate()` in Python tests
- [x] Update all `.num_rows()` → `.num_trees()` in Python tests (none found)
- [x] Keep `select()` as-is in Rust tests (reverted from project)
- [x] Update all `with_column()` → `add_field()` in Rust tests (done in Steps 3-4)
- [x] Update all `agg()` → `aggregate()` in Rust tests (done in Steps 3-4)
- [x] Update test names and docstrings if they reference old names

**Checkpoint:** `cargo test && make test` ✓

---

#### Step 8: Update Benchmarks

**Commit:** `bench: update benchmarks for renamed methods`

**Rust Benchmarks:**

| File | Changes |
|------|---------|
| `crates/arbors-lazy/benches/parallel_bench.rs` | All method calls |

**Python Benchmarks:**

| File | Changes |
|------|---------|
| `python/benchmarks/compare_json_libs.py` | All method calls |
| `python/benchmarks/run_benchmarks.py` | All method calls |

**Tasks:**
- [x] Update Rust benchmarks (none needed - already use add_field)
- [x] Update Python benchmarks (compare_json_libs.py)

**Checkpoint:** Benchmarks compile/run without error ✓

---

#### Step 9: Update Examples and Documentation

**Commit:** `docs: update examples and documentation for renamed methods`

**Examples:**

| File | Changes |
|------|---------|
| `examples/expressions.py` | Method name updates |
| `python/examples/expressions.py` | Method name updates |
| `python/examples/lazy_queries.py` | Method name updates |

**Documentation:**

| File | Changes |
|------|---------|
| `README.md` | Any API examples |
| `docs/ARCHITECTURE.md` | Any API examples |
| `docs/BENCHMARKS.md` | Any API examples |

**Tasks:**
- [x] Update all example scripts (done in Step 8)
- [x] Update README.md if it contains API examples
- [x] Update docs/*.md if they contain API examples (none found)

**Checkpoint:** All examples run successfully ✓

---

#### Step 10: Final Verification

**Verification Greps (must return ZERO matches):**

```bash
# Check all code surfaces (excluding plans/, chats/)
# NOTE: .select() is KEPT, so it should NOT be in this list
grep -rn "\.with_column\(" crates/ python/src/ python/tests/ python/examples/ python/benchmarks/ examples/ --include="*.rs" --include="*.py"
grep -rn "\.agg\(" crates/ python/src/ python/tests/ python/examples/ python/benchmarks/ examples/ --include="*.rs" --include="*.py"
grep -rn "num_rows\(" crates/ python/src/ python/tests/ python/examples/ python/benchmarks/ examples/ --include="*.rs" --include="*.py"
grep -rn "root_node\(" crates/ python/src/ python/tests/ python/examples/ python/benchmarks/ examples/ --include="*.rs" --include="*.py"

# Check enum variants (Select is KEPT, Agg and WithColumn should be gone)
grep -rn "QueryOp::Agg\|QueryOp::WithColumn" crates/ --include="*.rs"

# Check docs
grep -rn "\.with_column\(\|\.agg\(" docs/ README.md --include="*.md"
```

**Smoke Tests (new names work end-to-end):**

Add brief tests to confirm the new API works:
- [x] `select()` returns expected results in eager and lazy modes (KEPT - not renamed)
- [x] `add_field()` returns expected results in eager and lazy modes
- [x] `aggregate()` returns expected results in eager and lazy modes
- [x] Old names `with_column()`, `agg()` raise `AttributeError`

**Tasks:**
- [x] Run all verification greps - must return zero matches
- [x] Run full test suite: `cargo test && make test`
- [x] Run parity/stubs checks: `make check-parity && make check-stubs`
- [x] Verify smoke tests pass

---

### 13.1.7 Future Tree-Focused Operations (Reference Only)

These are documented here for context but will be implemented in later phases:

**Field operations (per-tree, at path) - Phase 13.4:**
- `remove_field(path)` - Remove a field
- `rename_field(old_path, new_name)` - Rename a field
- `move_field(from_path, to_path)` - Move a field to new location

**Array operations (per-tree, at path) - Phase 13.4:**
- `append_to_array(path, value_or_expr)` - Add element to end of array
- `prepend_to_array(path, value_or_expr)` - Add element to start of array
- `insert_in_array(path, index, value_or_expr)` - Insert at position
- `remove_from_array(path, index_or_predicate)` - Remove element(s)
- `filter_array(path, predicate)` - Filter array elements in place

**Collection operations (cross-tree) - Phase 13.6:**
- `sort_by(expr)` - Sort trees by expression result
- `group_by(expr)` - Group trees by expression result
- `unique_by(expr)` - Deduplicate trees

---

### 13.1.8 Deliverables and Checkpoints

**Deliverable:** DataFrame-esque names replaced with verb-based tree-focused names. Zero old terminology remains.

| Checkpoint | Verification |
|------------|--------------|
| Rust compiles | `cargo build` |
| Rust tests pass | `cargo test` |
| Python builds | `make python` |
| Python tests pass | `make test` |
| API parity | `make check-parity` |
| Stubs correct | `make check-stubs` |
| No old terminology | All grep checks return zero matches |
| New API works | Smoke tests pass |

**Commit after all checkpoints pass.**

---

## Phase 13.2 Expression System Refinement

**Purpose:** Ensure expression system aligns with tree-focused design.

### 13.2.0 Decisions (locked)
- `coerce`: best-effort, returns `null` on failure (no hard errors for incompatible inputs).
- `cast`: expand to element-wise for arrays/objects (apply to contained scalars, preserve shape; still errors on unsupported types).
- `is_number`: keep existing `is_numeric`; do not add `is_number` (avoid alias proliferation).
- Python: snake_case names matching Rust (`null_to_default`, `default_if_missing`, `exists`, `missing`, `coerce`, `cast`).

### 13.2.1 Expression Naming Review

Review all expression functions for verb-based naming:
- `lit()` → keep (short, clear)
- `path()` → keep (noun is fine for selector)
- `struct_()` → `object()` (DECIDED in 13.0 - JSON alignment)
- `list_()` → `array()` (DECIDED in 13.0 - JSON alignment)
- Predicates: prefer existing `is_numeric`, keep `is_string`/`is_array`/`is_object`/`is_null`.

### 13.2.2 New Expression Capabilities

```rust
// Type coercion expressions
cast(expr, target_type)      // strict, now element-wise for arrays/objects
coerce(expr)                 // best-effort, returns null on failure, element-wise

// Null handling
null_to_default(expr, default)      // null → default, else value
default_if_missing(path, default)   // missing path → default, else value

// Path existence check
exists(path) -> bool   // true if path resolves to any value
missing(path) -> bool  // inverse of exists

// Type predicates (return bool)
is_null(expr)
is_string(expr)
is_numeric(expr)  // keep existing name; no is_number
is_array(expr)
is_object(expr)
```

### 13.2.2a Missing vs Null Semantics (Implemented)

**Key Distinction:** Arbors distinguishes between "missing" (path doesn't resolve) and "null" (path resolves to explicit null value).

**Implementation:**
- `ExprResult::Null` = path was missing (didn't resolve)
- `ExprResult::Scalar(Value::Null)` = path resolved to explicit null value

**Behavior Matrix:**

| Expression | Missing Path | Explicit Null | Has Value |
|------------|--------------|---------------|-----------|
| `exists()` | false | true | true |
| `missing()` | true | false | false |
| `null_to_default(d)` | d | d | value |
| `default_if_missing(d)` | d | null | value |
| `if_null(d)` / `coalesce` | d | d | value |

**Use Cases:**
- `exists()` / `missing()`: Check if a field is present in the JSON document
- `default_if_missing()`: Provide default only for absent fields, preserve explicit null
- `null_to_default()`: Replace any null-ish value with default (same as `if_null()`)

**Naming Conventions:**
- Rust: `null_to_default`, `default_if_missing`, `exists`, `missing`, `coerce`
- Python: Same snake_case names for exact parity
- `TryCoerce` is the internal Rust enum variant name (to avoid confusion with `Coalesce`)

### 13.2.3 Execution Steps (Rust)

#### Step 1: Surface and naming audit
- [x] Audit all expression builders/variants for verb-based naming; ensure `is_numeric` (no `is_number`).
- [x] Update docs/comments in `crates/arbors-expr/src/expr.rs` to reflect the finalized surface.

#### Step 2: Expression enum/builders
- [x] Add/extend Expr variants/builders for `Coerce`, `NullToDefault`, `DefaultIfMissing`, `Exists`/`Missing` (or a single predicate with invert), and container-aware `Cast`/`Coerce`.
- [x] Update formatting/visitor matches (`Display`, equality, any optimizers).

#### Step 3: Type inference
- [x] Extend `crates/arbors-expr/src/infer.rs` for new variants, including container-aware cast/coerce rules and nullability propagation.
- [x] Define coercion lattice (int ↔ float widening, string/bool parsing) and document null-on-failure for `coerce`.

#### Step 4: Evaluation semantics
- [x] Implement evaluators in `crates/arbors-query/src/eval.rs`:
  - `cast`: apply to scalars; if array/object, map element-wise (preserve shape, null passthrough, TypeMismatch on unsupported inner types).
  - `coerce`: best-effort mirror of cast but returns null on incompatible inner values instead of error.
  - `null_to_default`: null → default, else value.
  - `default_if_missing`: uses missing-tracking path evaluation (see below).
  - `exists`/`missing`: bool predicates based on missing-tracking path resolution.
- [x] Path missing proposal: introduce a missing flag in path evaluation so paths can distinguish "missing" vs explicit `null`. Field not found, out-of-range index, or wrong container type for index/wildcard sets missing=true instead of error for these ops (parse errors still error). Value can be `Null` with missing=false.
- [x] Exists/missing proposal: for wildcard/filter paths, `exists` is true if any element resolves with missing=false; false if all are missing. Out-of-range index or non-array for index yields missing=true (so exists=false).
- [x] Update lazy/optimizer (`crates/arbors-lazy/src/optimize.rs`) and any shared helpers touched by new variants.

#### Step 5: Python bindings
- [x] Expose new builders/accessors in `python/src/lib.rs` with snake_case names; update `_arbors.pyi` and `python/api_manifest.toml`.
- [x] Ensure parity for container-aware cast/coerce behavior and existence predicates.

**Checkpoint:** `cargo test && make test` ✓

### 13.2.4 Tests
- Rust (`crates/arbors/tests`, `crates/arbors-query/tests`):
  - [x] Cast/coerce: scalars, arrays/objects element-wise, null passthrough, type mismatch vs null-on-failure split.
  - [x] Null handling: `null_to_default` vs `if_null` vs `null_if`.
  - [x] Missing handling: `default_if_missing` on absent field, present field, explicit null; wildcard/filter cases; out-of-range index returns default.
  - [x] Exists/missing: fields, indices, wildcards/filters; wrong container type treated as missing.
  - [x] Predicates: `is_null`, `is_string`, `is_numeric`, `is_array`, `is_object` on mixed data.
- Python (`python/tests/test_expr.py` and related):
  - [x] Mirror Rust coverage for new expressions and container-aware cast/coerce.

**Checkpoint:** All tests pass ✓

### 13.2.5 Docs
- [x] Update Rust docstrings (`crates/arbors-expr/src/expr.rs`, `crates/arbors-query/src/eval.rs`) with semantics/edge cases.
- [x] Update Python docstrings/examples (`python/src/lib.rs`, `python/examples/`) to show new expressions.
- [x] Document naming conventions and missing vs null behavior in this plan section (see 13.2.2a above).

**Checkpoint:** Documentation complete ✓

### 13.2.6 Deliverables and Checkpoints

**Deliverable:** Expression system enhanced with coercion, null handling, and existence/missing awareness, with container-aware cast/coerce.

| Checkpoint | Verification | Status |
|------------|--------------|--------|
| Rust tests pass | `cargo test` succeeds | ✓ |
| Python tests pass | `make test` succeeds | ✓ |
| Parity maintained | `make check-parity` succeeds | ✓ |
| Stubs correct | `make check-stubs` succeeds | ✓ |

**All checkpoints pass. Phase 13.2 complete.**

---

## Phase 13.3 Tree Traversal Operations

**Purpose:** Add operations to walk and query tree structure beyond path-based access.

**Status:** Not started

---

### 13.3.0 Design Decisions

#### Where to Implement

Traversal operations operate on a single tree within an Arbor. The implementation layers:

1. **Core traversal algorithms** → `crates/arbors-storage/src/traversal.rs` (new file)
   - Works with `Arbor` + `NodeId` (root)
   - Returns iterators yielding `NodeId`
   - No Python dependencies

2. **High-level Tree methods** → `python/src/lib.rs` (Tree struct)
   - Delegates to core algorithms
   - Returns Python-friendly types (Node objects, lists)

3. **Optional Arbor methods** → `crates/arbors-storage/src/lib.rs`
   - `arbor.traverse_tree(tree_idx, order)` for Rust-side tree traversal

#### Iterator Return Type (DECIDED)

**Decision:** Use an **enum of concrete iterator types** for zero-cost abstraction.

```rust
pub enum TraversalIter<'a> {
    DepthFirst(DepthFirstIterator<'a>),
    DepthFirstPost(DepthFirstPostIterator<'a>),
    BreadthFirst(BreadthFirstIterator<'a>),
}

impl<'a> Iterator for TraversalIter<'a> {
    type Item = NodeId;
    fn next(&mut self) -> Option<Self::Item> {
        match self {
            Self::DepthFirst(it) => it.next(),
            Self::DepthFirstPost(it) => it.next(),
            Self::BreadthFirst(it) => it.next(),
        }
    }
}
```

**Rationale:** Avoids allocation and dynamic dispatch overhead of `Box<dyn Iterator>`. Clear typing and better performance for large trees.

#### Iterator vs Collected Results

- **Rust:** Return `TraversalIter` enum (or concrete iterator types) for lazy evaluation
- **Python:** Collect to `list[Node]` for convenience (iterators are awkward in Python)
- **Future:** Consider Python iterator/generator variant for large trees if memory becomes an issue

#### Predicate Design for find/find_all (DECIDED)

**Decision:** Start with **simple type-based helpers**, add Expr-based `find/find_all` only if Expr evaluation is already optimized.

**Phase 1 (this phase):**
- `nodes_of_type(NodeType)` - filter by node type (simple, zero Expr overhead)
- `leaves()` - filter by child count = 0 (simple predicate)

**Phase 2 (deferred unless Expr is cheap):**
- `find(predicate: Expr)` - expression-based, uses existing Expr infrastructure
- `find_all(predicate: Expr)` - expression-based

**Rationale:** Per-node Expr evaluation can be expensive. Simple type-based helpers cover common use cases without overhead. Expr-based find can be added once we verify Expr evaluation is fast enough (or precompiled).

#### Semantic Clarifications

1. **Leaf definition:** A leaf is a **non-container node** (not Array or Object). Empty arrays and empty objects are still containers and are NOT leaves. This matches the structural definition, not the "has no children" definition.

2. **Object key uniqueness:** Objects cannot have duplicate keys (enforced by JSON spec and parsing). Path strings are unambiguous.

3. **Invalid root_id handling:**
   - `traverse()`, `leaves()`, `nodes_of_type()`: Return empty iterator if `root_id` is invalid
   - `path_to()`: Return `None` if `root_id` is invalid

4. **Membership validation for path_to():**
   - Climb parent links from `node_id` until reaching `root_id` or `NodeId::NONE`
   - If `root_id` is reached: node is in tree, return path
   - If `NodeId::NONE` is reached without hitting `root_id`: node is not in tree, return `None`

5. **Python string parameters:**
   - `order` parameter: **case-sensitive**, must be exactly `"depth_first"`, `"depth_first_post"`, or `"breadth_first"`
   - `type_name` parameter: **case-sensitive**, must be exactly one of `"null"`, `"bool"`, `"int64"`, `"float64"`, `"string"`, `"date"`, `"datetime"`, `"duration"`, `"binary"`, `"array"`, `"object"`
   - Invalid values raise `ValueError` with descriptive message

#### Performance Considerations

1. **`path_to()` array index calculation:** Since children are contiguous, compute index as `node_id.0 - children_start.0` (O(1) offset calculation). No sibling scanning needed.

2. **BreadthFirst memory:** Uses `VecDeque` which grows with tree width. Document expected usage for wide trees.

3. **Detached nodes:** Traversal only visits nodes reachable from `root_id` via children links. Nodes not in the tree are never encountered.

---

### 13.3.1 API Design

#### Rust API (in `arbors-storage`)

```rust
/// Traversal order for tree walking
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TraversalOrder {
    /// Pre-order: visit parent before children (root first)
    DepthFirst,
    /// Post-order: visit children before parent (leaves first)
    DepthFirstPost,
    /// Level-order: visit all nodes at depth N before depth N+1
    BreadthFirst,
}

/// Enum-based iterator for zero-cost traversal
pub enum TraversalIter<'a> {
    DepthFirst(DepthFirstIterator<'a>),
    DepthFirstPost(DepthFirstPostIterator<'a>),
    BreadthFirst(BreadthFirstIterator<'a>),
}

impl Arbor {
    /// Traverse all nodes in a tree rooted at `root_id`.
    ///
    /// Returns an iterator yielding NodeIds in the specified order.
    pub fn traverse(&self, root_id: NodeId, order: TraversalOrder) -> TraversalIter<'_>

    /// Get all leaf nodes (nodes with no children) in a tree.
    ///
    /// Leaves are nodes that are not containers (not Array or Object).
    pub fn leaves(&self, root_id: NodeId) -> impl Iterator<Item = NodeId> + '_

    /// Get all nodes of a specific type in a tree.
    pub fn nodes_of_type(&self, root_id: NodeId, node_type: NodeType) -> impl Iterator<Item = NodeId> + '_

    /// Get the path from root to a specific node.
    ///
    /// Returns a vector of PathSegments representing the navigation path.
    /// Returns None if node_id is not in the tree rooted at root_id.
    pub fn path_to(&self, root_id: NodeId, node_id: NodeId) -> Option<Vec<PathSegment>>

    /// Get the depth of a node (distance from root, 0 for root itself).
    pub fn depth(&self, node_id: NodeId) -> usize
}
```

**Note:** `find()` and `find_all()` with Expr predicates are deferred to a future phase pending Expr evaluation performance validation.

#### Python API (Tree class)

```python
class Tree:
    # === Traversal Methods ===

    def traverse(self, order: str = "depth_first") -> list[Node]:
        """Traverse all nodes in the tree.

        Args:
            order: Traversal order - one of:
                - "depth_first" (default): parent before children
                - "depth_first_post": children before parent
                - "breadth_first": level by level

        Returns:
            List of all nodes in traversal order
        """

    def leaves(self) -> list[Node]:
        """Get all leaf nodes (nodes with no children).

        Leaves are non-container nodes (not arrays or objects).
        """

    def nodes_of_type(self, type_name: str) -> list[Node]:
        """Get all nodes of a specific type.

        Args:
            type_name: One of "null", "bool", "int64", "float64", "string",
                       "date", "datetime", "duration", "binary", "array", "object"

        Raises:
            ValueError: If type_name is not a valid node type
        """

    def path_to(self, node: Node) -> str | None:
        """Get the path string from root to a specific node.

        Returns:
            Path string like "user.addresses[0].city", or None if node not in tree
        """

    def depth(self, node: Node) -> int:
        """Get the depth of a node (0 for root)."""
```

**Note:** `find()` and `find_all()` with Expr predicates are deferred to a future phase.

---

### 13.3.2 Definitive Symbol Inventory

#### New Files to Create

| File | Purpose |
|------|---------|
| `crates/arbors-storage/src/traversal.rs` | Core traversal algorithms |

#### Symbols to Add

**In `crates/arbors-storage/src/traversal.rs` (new):**

| Symbol | Type | Description |
|--------|------|-------------|
| `TraversalOrder` | enum | DepthFirst, DepthFirstPost, BreadthFirst |
| `TraversalIter` | enum | Wrapper enum for zero-cost iterator dispatch |
| `DepthFirstIterator` | struct | Iterator for pre-order traversal |
| `DepthFirstPostIterator` | struct | Iterator for post-order traversal |
| `BreadthFirstIterator` | struct | Iterator for level-order traversal |

**In `crates/arbors-storage/src/lib.rs` (Arbor impl):**

| Symbol | Type | Description |
|--------|------|-------------|
| `traverse()` | method | Walk all nodes in specified order, returns `TraversalIter` |
| `leaves()` | method | Get leaf nodes (non-containers) |
| `nodes_of_type()` | method | Filter by NodeType |
| `path_to()` | method | Get path from root to node as `Vec<PathSegment>` |
| `depth()` | method | Get node depth (0 for root) |

**In `python/src/lib.rs` (Tree impl):**

| Symbol | Type | PyO3 name | Description |
|--------|------|-----------|-------------|
| `traverse()` | method | `traverse` | Walk all nodes, returns `list[Node]` |
| `leaves()` | method | `leaves` | Get leaf nodes |
| `nodes_of_type()` | method | `nodes_of_type` | Filter by type name string |
| `path_to()` | method | `path_to` | Get path string |
| `depth()` | method | `depth` | Get node depth |

**In `python/arbors/_arbors.pyi` (Tree class):**

| Symbol | Type | Description |
|--------|------|-------------|
| `traverse(order: str = "depth_first") -> list[Node]` | method | |
| `leaves() -> list[Node]` | method | |
| `nodes_of_type(type_name: str) -> list[Node]` | method | |
| `path_to(node: Node) -> str \| None` | method | |
| `depth(node: Node) -> int` | method | |

**Deferred to future phase:**
- `find(predicate: Expr) -> Node | None`
- `find_all(predicate: Expr) -> list[Node]`

---

### 13.3.3 Execution Steps

**Strategy:** Build from core algorithms up. Implement Rust first, then Python bindings.

---

#### Step 1: Create traversal module with iterator types

**Commit:** `feat(storage): add tree traversal module with iterator types`

**Create `crates/arbors-storage/src/traversal.rs`:**

```rust
//! Tree traversal algorithms
//!
//! Provides iterators for walking tree structures in various orders.
//! Uses enum-based iterator dispatch for zero-cost abstraction.

use std::collections::VecDeque;
use arbors_core::NodeId;
use crate::Arbor;

/// Order of tree traversal
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TraversalOrder {
    /// Pre-order: parent before children
    DepthFirst,
    /// Post-order: children before parent
    DepthFirstPost,
    /// Level-order: breadth-first
    BreadthFirst,
}

/// Enum-based iterator for zero-cost dispatch
pub enum TraversalIter<'a> {
    DepthFirst(DepthFirstIterator<'a>),
    DepthFirstPost(DepthFirstPostIterator<'a>),
    BreadthFirst(BreadthFirstIterator<'a>),
}

impl<'a> Iterator for TraversalIter<'a> {
    type Item = NodeId;
    fn next(&mut self) -> Option<Self::Item> {
        match self {
            Self::DepthFirst(it) => it.next(),
            Self::DepthFirstPost(it) => it.next(),
            Self::BreadthFirst(it) => it.next(),
        }
    }
}

/// Iterator for depth-first (pre-order) traversal
pub struct DepthFirstIterator<'a> {
    arbor: &'a Arbor,
    stack: Vec<NodeId>,
}

/// Iterator for depth-first post-order traversal
pub struct DepthFirstPostIterator<'a> {
    arbor: &'a Arbor,
    stack: Vec<(NodeId, bool)>,  // (node, visited_children)
}

/// Iterator for breadth-first traversal
pub struct BreadthFirstIterator<'a> {
    arbor: &'a Arbor,
    queue: VecDeque<NodeId>,
}
```

**Tasks:**
- [x] Create `crates/arbors-storage/src/traversal.rs`
- [x] Define `TraversalOrder` enum
- [x] Define `TraversalIter` enum with Iterator impl
- [x] Define `DepthFirstIterator` struct and impl `Iterator`
- [x] Define `DepthFirstPostIterator` struct and impl `Iterator`
- [x] Define `BreadthFirstIterator` struct and impl `Iterator`
- [x] Add `pub mod traversal;` to `crates/arbors-storage/src/lib.rs`
- [x] Re-export `TraversalOrder` and `TraversalIter` from lib.rs

**Checkpoint:** `cargo build -p arbors-storage` ✓

---

#### Step 2: Implement traverse() on Arbor

**Commit:** `feat(storage): implement Arbor::traverse() method`

**Add to `crates/arbors-storage/src/lib.rs`:**

```rust
impl Arbor {
    /// Traverse all nodes in a tree starting from root_id.
    ///
    /// # Arguments
    /// * `root_id` - The root node of the tree to traverse
    /// * `order` - The traversal order (DepthFirst, DepthFirstPost, BreadthFirst)
    ///
    /// # Returns
    /// An iterator yielding NodeIds in the specified order.
    ///
    /// # Example
    /// ```ignore
    /// for node_id in arbor.traverse(root, TraversalOrder::DepthFirst) {
    ///     println!("{:?}", arbor.node_type(node_id));
    /// }
    /// ```
    pub fn traverse(&self, root_id: NodeId, order: TraversalOrder) -> TraversalIter<'_>
}
```

**Tasks:**
- [x] Implement `Arbor::traverse()` method
- [x] Return appropriate `TraversalIter` variant based on order parameter
- [x] Handle edge cases: invalid root_id returns empty iterator

**Checkpoint:** `cargo test -p arbors-storage` ✓

---

#### Step 3: Implement leaves() and nodes_of_type()

**Commit:** `feat(storage): implement leaves() and nodes_of_type() methods`

**Tasks:**
- [x] Implement `Arbor::leaves()` - filter traverse for non-container nodes
- [x] Implement `Arbor::nodes_of_type()` - filter traverse by NodeType

**Checkpoint:** `cargo test -p arbors-storage` ✓

---

#### Step 4: Implement path_to() and depth()

**Commit:** `feat(storage): implement path_to() and depth() methods`

**path_to() algorithm:**
1. Walk from node_id up to root via parent links
2. Collect path segments in reverse
3. For object children: get key name via interner
4. For array children: calculate index from position in parent's children range
5. Reverse and return as `Vec<PathSegment>`

**depth() algorithm:**
1. Count parent hops from node_id to root (parent == NodeId::NONE)
2. Return 0 for root node

**Tasks:**
- [x] Implement `Arbor::path_to()` - build path from node to root
- [x] Implement `Arbor::depth()` - count parent hops to root
- [x] Validate node_id is in tree rooted at root_id (for path_to)

**Checkpoint:** `cargo test -p arbors-storage` ✓

---

#### Step 5: Add Rust tests

**Commit:** `test(storage): add traversal tests`

**Test file:** `crates/arbors-storage/tests/traversal_tests.rs`

**Test cases:**
- [x] `test_traverse_depth_first` - verify pre-order
- [x] `test_traverse_depth_first_post` - verify post-order
- [x] `test_traverse_breadth_first` - verify level-order
- [x] `test_traverse_empty_tree` - single root node
- [x] `test_traverse_invalid_root` - returns empty iterator
- [x] `test_leaves_returns_non_containers` - only leaf nodes
- [x] `test_leaves_empty_containers_not_leaves` - empty array/object are NOT leaves
- [x] `test_leaves_nested_structure` - deep nesting
- [x] `test_nodes_of_type_string` - filter strings
- [x] `test_nodes_of_type_object` - filter objects
- [x] `test_nodes_of_type_mixed` - mixed tree
- [x] `test_path_to_direct_child` - single segment
- [x] `test_path_to_nested` - multiple segments
- [x] `test_path_to_array_element` - includes index, uses O(1) offset
- [x] `test_path_to_invalid_node` - returns None
- [x] `test_path_to_node_not_in_tree` - membership validation
- [x] `test_depth_root` - depth 0 for root
- [x] `test_depth_nested` - correct depth values

**Checkpoint:** `cargo test` ✓

---

#### Step 6: Python bindings for Tree

**Commit:** `feat(python): add traversal methods to Tree`

**Add to Tree impl in `python/src/lib.rs`:**

```rust
#[pymethods]
impl Tree {
    /// Traverse all nodes in the tree.
    #[pyo3(signature = (order = "depth_first"))]
    fn traverse(&self, py: Python<'_>, order: &str) -> PyResult<Vec<Node>> { ... }

    /// Get all leaf nodes.
    fn leaves(&self, py: Python<'_>) -> PyResult<Vec<Node>> { ... }

    /// Get all nodes of a specific type.
    fn nodes_of_type(&self, py: Python<'_>, type_name: &str) -> PyResult<Vec<Node>> { ... }

    /// Get the path string from root to a node.
    fn path_to(&self, py: Python<'_>, node: &Node) -> PyResult<Option<String>> { ... }

    /// Get the depth of a node.
    fn depth(&self, py: Python<'_>, node: &Node) -> PyResult<usize> { ... }
}
```

**Tasks:**
- [x] Implement `traverse()` with order string parameter
- [x] Implement `leaves()` returning list of Node
- [x] Implement `nodes_of_type()` with type name string (validate type name)
- [x] Implement `path_to()` returning path string
- [x] Implement `depth()` returning integer

**Checkpoint:** `make python` ✓

---

#### Step 7: Update Python stubs

**Commit:** `docs(python): add traversal method stubs`

**Update `python/arbors/_arbors.pyi`:**

**Tasks:**
- [x] Add `traverse()` method signature with docstring
- [x] Add `leaves()` method signature with docstring
- [x] Add `nodes_of_type()` method signature with docstring
- [x] Add `path_to()` method signature with docstring
- [x] Add `depth()` method signature with docstring

**Checkpoint:** `make check-stubs` ✓

---

#### Step 8: Python tests

**Commit:** `test(python): add traversal tests`

**Add to `python/tests/test_tree.py` or new `python/tests/test_traversal.py`:**

**Test cases:**
- [x] `test_traverse_depth_first` - verify pre-order
- [x] `test_traverse_depth_first_post` - verify post-order
- [x] `test_traverse_breadth_first` - verify level-order
- [x] `test_traverse_invalid_order` - raises ValueError (case-sensitive)
- [x] `test_leaves` - only non-container nodes
- [x] `test_leaves_empty_containers_not_leaves` - empty array/object are NOT leaves
- [x] `test_nodes_of_type_string` - filter strings
- [x] `test_nodes_of_type_object` - filter objects
- [x] `test_nodes_of_type_invalid` - raises ValueError (case-sensitive)
- [x] `test_path_to_nested` - path string format
- [x] `test_path_to_array_element` - includes index
- [x] `test_path_to_not_in_tree` - returns None
- [x] `test_depth_root` - depth 0 for root
- [x] `test_depth_nested` - correct depth values

**Checkpoint:** `make test` ✓

---

#### Step 9: Final verification

**Commit:** `docs(traversal): finalize Phase 13.3`

**Tasks:**
- [x] Run full test suite: `cargo test && make test`
- [x] Run parity check: `make check-parity`
- [x] Run stubs check: `make check-stubs`
- [x] Update Phase 13.3 task checkboxes in this plan

---

### 13.3.4 XPath-like Extended Path Syntax (Deferred)

The following extended path features are **deferred to a later phase**:

| Syntax | Description | Status |
|--------|-------------|--------|
| `//name` | Recursive descent | Deferred - requires path parser changes |
| `user/*` | All children | Deferred - overlaps with existing `user[*]` |
| `items[last()]` | Last element | Deferred - already have `items[-1]` |
| `items[position() < 3]` | Positional predicates | Deferred - complex to implement |
| `*[type() == 'string']` | Type predicates | Covered by `nodes_of_type()` |

**Rationale:** The traversal methods (`traverse`, `find_all`, `nodes_of_type`) provide the core functionality. Extended path syntax can be added incrementally in a future phase without blocking this work.

---

### 13.3.5 Semantic Specification

#### Traversal Orders

| Order | Description | Example Output (for `{a: {b: 1, c: 2}, d: 3}`) |
|-------|-------------|------------------------------------------------|
| DepthFirst | Parent before children (pre-order) | root, a, b, c, d |
| DepthFirstPost | Children before parent (post-order) | b, c, a, d, root |
| BreadthFirst | Level by level | root, a, d, b, c |

#### path_to() Output Format

- Field access: `user.name`
- Array index: `items[0]`
- Mixed: `users[0].addresses[1].city`
- Root node returns empty string

#### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Invalid root_id | Empty iterator / None |
| node_id not in tree | path_to returns None |
| Empty tree (just root) | traverse yields root only |
| Root is leaf | leaves() yields root |

---

### 13.3.6 Deliverables and Checkpoints

**Deliverable:** Tree traversal API with traverse, leaves, nodes_of_type, path_to, depth.

| Checkpoint | Verification |
|------------|--------------|
| Traversal module created | `crates/arbors-storage/src/traversal.rs` exists |
| All three traversal orders work | Tests verify DepthFirst, DepthFirstPost, BreadthFirst |
| Filter methods work | leaves() and nodes_of_type() tests pass |
| Path methods work | path_to() and depth() tests pass |
| Rust tests pass | `cargo test` succeeds |
| Python builds | `make python` succeeds |
| Python tests pass | `make test` succeeds |
| API parity | `make check-parity` succeeds |
| Stubs correct | `make check-stubs` succeeds |

**Deferred:** `find()` and `find_all()` with Expr predicates pending performance validation.

**Commit after all checkpoints pass.**

---

## Phase 13.4 Subtree Extraction and Manipulation

**Purpose:** Extract, replace, and manipulate subtrees.

**Status:** Complete

---

### 13.4.0 Design Decisions

#### Implementation Strategy

Arbors uses **immutable-first** architecture with COW (copy-on-write) semantics. All subtree operations return **new** trees/arbors rather than mutating in place. This matches the existing design:

- `Arbor` uses `Arc<ColumnarNodes>`, `Arc<StringInterner>`, `Arc<FinishedPools>` for shared storage
- Filter/head/tail operations create new Arbors sharing underlying storage
- Python `Tree` is a lightweight reference (arbor + root_id) - doesn't own data

#### Where to Implement

1. **Core tree reconstruction** → `crates/arbors-io/src/tree_ops.rs` (new file)
   - Tree manipulation algorithms that build new Arbors via ArborBuilder
   - Requires access to parsing infrastructure (ArborBuilder, pools, interner)

2. **Python Tree methods** → `python/src/lib.rs` (Tree impl)
   - Thin wrappers calling core algorithms
   - Returns new Tree objects backed by new Arbors

#### Return Type Semantics

**DECIDED:** Operations return new `Tree` objects backed by new `Arbor` instances.

```python
# Extract returns a new independent Tree
extracted = tree.extract("user.address")  # New Tree with new Arbor

# Mutation operations return new Trees (original unchanged)
new_tree = tree.delete_subtree("temp")  # tree unchanged, new_tree is modified
```

**Rationale:** Consistent with immutable-first design. Allows efficient sharing when no mutations occur.

#### Path Resolution for Operations

All operations use the existing path syntax from the expression system:
- Field access: `user.name`
- Array index: `items[0]`
- Mixed: `users[0].address.city`

Path resolution delegates to existing `arbors-expr::PathSegment` parsing.

#### Error Handling

| Scenario | Rust Error | Python Exception |
|----------|------------|------------------|
| Path doesn't exist | `Error::PathNotFound` | `KeyError` |
| Invalid path syntax | `Error::InvalidPath` | `ValueError` |
| Type mismatch (e.g., index on object) | `Error::TypeMismatch` | `TypeError` |
| Out-of-bounds array index | `Error::PathNotFound` | `KeyError` |
| Delete/move root path (`""`) | `Error::InvalidPath` | `ValueError` |
| `to_path` inside `from_path` (copy/move) | `Error::InvalidPath` | `ValueError` |
| Destination parent doesn't exist | `Error::PathNotFound` | `KeyError` |
| Destination exists (copy/replace) | — | — (replaces silently) |

**Note:** `extract()` returns `Option<Arbor>` (None for missing path), not `Result`.

#### Destination Parent Existence (DECIDED)

**STRICT:** The parent of `to_path` must already exist. No auto-creation.

```python
# Parent must exist - fails if x.y doesn't exist
tree.copy_subtree("a", "x.y.z")  # KeyError

# Use ensure_path explicitly if needed
tree.ensure_path("x.y").copy_subtree("a", "x.y.z")  # OK
```

**Rationale:** Consistent with fail-fast philosophy. Explicit `ensure_path()` makes intent clear.

#### Schema Handling (DECIDED)

**Drop schema** for extracted/rebuilt Arbors. Carrying or subsetting the original schema is complex and risks invalid schemas after structural changes. Users can re-infer schema if needed.

#### Interner/Pool Remapping

When combining Arbors (e.g., `replace_subtree` with a replacement from another Arbor):
- String keys from replacement must be re-interned into the new Arbor's interner
- Pool indices must be remapped as values are copied
- This is handled during the recursive copy phase in `TreeBuilder`

#### Root Path Behavior

| Operation | Root path (`""`) | Behavior |
|-----------|------------------|----------|
| `extract("")` | Allowed | Returns copy of entire tree |
| `delete_subtree("")` | **Disallowed** | Raises `ValueError` |
| `replace_subtree("")` | Allowed | Replaces entire tree content |
| `copy_subtree("", to)` | Allowed | Copies entire tree to destination |
| `copy_subtree(from, "")` | **Disallowed** | Raises `ValueError` (would replace root) |
| `move_subtree` with `""` | **Disallowed** | Raises `ValueError` |

#### Self-Nesting Prevention

For `copy_subtree(from, to)` and `move_subtree(from, to)`:
- If `to_path` starts with `from_path` + separator, raise `ValueError`
- Example: `copy_subtree("a", "a.b")` → Error (would nest `a` inside itself)
- Example: `copy_subtree("a.b", "a")` → OK (replaces parent with child's copy)

---

### 13.4.1 API Design

#### Rust API (in `arbors-io`)

```rust
/// Tree manipulation operations module
/// Located in crates/arbors-io/src/tree_ops.rs

use arbors_storage::Arbor;
use arbors_core::{NodeId, Error, Result};

/// Extract a subtree at the given path, creating a new independent Arbor.
///
/// Returns None if path doesn't resolve. Empty path "" extracts entire tree.
/// The returned Arbor has no schema (schema is dropped).
pub fn extract_subtree(arbor: &Arbor, root: NodeId, path: &str) -> Option<Arbor>

/// Delete a subtree at the given path, returning a new Arbor without that subtree.
///
/// Returns Err if path doesn't exist (KeyError in Python).
/// Returns Err if path is "" (cannot delete root).
/// For objects: removes the field
/// For arrays: removes the element (shifts subsequent elements)
pub fn delete_subtree(arbor: &Arbor, root: NodeId, path: &str) -> Result<Arbor>

/// Replace a subtree at the given path with a new value.
///
/// The replacement can come from another Arbor or be constructed.
/// Returns Err if path doesn't exist (KeyError in Python).
/// If destination exists, replaces silently (assignment semantics).
/// Handles interner/pool remapping for cross-Arbor replacement.
pub fn replace_subtree(
    arbor: &Arbor,
    root: NodeId,
    path: &str,
    replacement: &Arbor,
    replacement_root: NodeId,
) -> Result<Arbor>

/// Copy a subtree from one location to another within the same tree.
///
/// Returns Err if from_path doesn't exist.
/// Returns Err if to_path is inside from_path (self-nesting).
/// Returns Err if to_path is "" (cannot replace root via copy).
/// If destination exists, replaces silently (assignment semantics).
pub fn copy_subtree(
    arbor: &Arbor,
    root: NodeId,
    from_path: &str,
    to_path: &str,
) -> Result<Arbor>

/// Move a subtree from one location to another (copy + delete source).
///
/// Returns Err if from_path doesn't exist.
/// Returns Err if from_path or to_path is "" (cannot move root).
/// Returns Err if to_path is inside from_path (self-nesting).
pub fn move_subtree(
    arbor: &Arbor,
    root: NodeId,
    from_path: &str,
    to_path: &str,
) -> Result<Arbor>

/// Ensure intermediate objects exist for a path.
///
/// Creates empty objects as needed to make the path valid.
/// Returns the new Arbor with path guaranteed to exist.
/// Returns Err if path requires creating array elements (only objects created).
pub fn ensure_path(arbor: &Arbor, root: NodeId, path: &str) -> Result<Arbor>
```

#### Python API (Tree class)

```python
class Tree:
    # === Subtree Extraction ===

    def extract(self, path: str) -> Tree | None:
        """Extract a subtree at path as a new independent Tree.

        The extracted Tree has its own Arbor - it's fully independent.

        Args:
            path: Path to the subtree (e.g., "user.address", "items[0]")

        Returns:
            New Tree containing just the subtree, or None if path doesn't exist

        Example:
            >>> tree = read_json('{"user": {"name": "Alice", "age": 30}}')
            >>> name_tree = tree.extract("user.name")
            >>> name_tree.to_json()
            '"Alice"'
        """

    # === Subtree Deletion ===

    def delete_subtree(self, path: str) -> Tree:
        """Delete a subtree at path, returning a new Tree without it.

        The original Tree is unchanged (immutable operation).

        Args:
            path: Path to delete

        Returns:
            New Tree with the subtree removed

        Raises:
            KeyError: If path doesn't exist

        Example:
            >>> tree = read_json('{"name": "Alice", "temp": 123}')
            >>> new_tree = tree.delete_subtree("temp")
            >>> "temp" in new_tree
            False
            >>> "temp" in tree  # Original unchanged
            True
        """

    # === Subtree Replacement ===

    def replace_subtree(self, path: str, replacement: Tree) -> Tree:
        """Replace a subtree at path with another Tree.

        Args:
            path: Path to replace
            replacement: Tree to insert at that location

        Returns:
            New Tree with the replacement

        Raises:
            KeyError: If path doesn't exist

        Example:
            >>> tree = read_json('{"user": {"name": "Alice"}}')
            >>> new_name = read_json('"Bob"')
            >>> new_tree = tree.replace_subtree("user.name", new_name)
        """

    # === Subtree Copy/Move ===

    def copy_subtree(self, from_path: str, to_path: str) -> Tree:
        """Copy a subtree from one location to another.

        Args:
            from_path: Source path
            to_path: Destination path (parent must exist or be creatable)

        Returns:
            New Tree with the subtree copied

        Raises:
            KeyError: If from_path doesn't exist
            ValueError: If to_path is invalid

        Example:
            >>> tree = read_json('{"primary": {"name": "Alice"}}')
            >>> new_tree = tree.copy_subtree("primary", "backup")
        """

    def move_subtree(self, from_path: str, to_path: str) -> Tree:
        """Move a subtree from one location to another.

        Equivalent to copy + delete.

        Args:
            from_path: Source path (will be removed)
            to_path: Destination path

        Returns:
            New Tree with the subtree moved
        """

    # === Path Creation ===

    def ensure_path(self, path: str) -> Tree:
        """Ensure intermediate objects exist for a path.

        Creates empty objects as needed to make the path valid.
        Does nothing if path already exists.

        Args:
            path: Path to ensure exists

        Returns:
            New Tree with path guaranteed to exist (possibly with empty objects)

        Example:
            >>> tree = read_json('{}')
            >>> new_tree = tree.ensure_path("a.b.c")
            >>> new_tree.to_json()
            '{"a":{"b":{}}}'  # "c" not created - that's the field to add
        """
```

---

### 13.4.2 Path Creation Semantics

**DECIDED:** Default to strict mode (fail if path doesn't exist), with `create_path=True` option.

```python
# Strict mode (default) - error if parent path doesn't exist
tree.replace_subtree("a.b.c", value)  # KeyError if a.b doesn't exist

# Or use ensure_path first
new_tree = tree.ensure_path("a.b").replace_subtree("a.b.c", value)
```

**Rationale:** Fail-fast catches typos (e.g., "user.adress" vs "user.address"). Use `ensure_path()` for explicit path creation when needed.

**ensure_path() Semantics:**
- Creates intermediate **objects** only (not arrays)
- Path `"a.b.c"` ensures `a` and `a.b` exist as objects; `c` is NOT created (that's the field to add)
- Path `"items[0].name"` requires `items` to exist as array with element 0; `name` is NOT created
- Returns new Tree; original unchanged

---

### 13.4.3 Definitive Symbol Inventory

#### New Files to Create

| File | Purpose |
|------|---------|
| `crates/arbors-io/src/tree_ops.rs` | Core tree manipulation algorithms |

#### Symbols to Add

**In `crates/arbors-io/src/tree_ops.rs` (new):**

| Symbol | Type | Description |
|--------|------|-------------|
| `extract_subtree()` | function | Extract subtree to new Arbor |
| `delete_subtree()` | function | Delete subtree, return new Arbor |
| `replace_subtree()` | function | Replace subtree with another |
| `copy_subtree()` | function | Copy subtree within same tree |
| `move_subtree()` | function | Move subtree (copy + delete) |
| `ensure_path()` | function | Create intermediate objects |
| `TreeBuilder` | struct | Helper for reconstructing trees |

**In `crates/arbors-io/src/lib.rs`:**

| Symbol | Type | Description |
|--------|------|-------------|
| `pub mod tree_ops` | module | Re-export tree operations |

**In `python/src/lib.rs` (Tree impl):**

| Symbol | Type | PyO3 name | Description |
|--------|------|-----------|-------------|
| `extract()` | method | `extract` | Extract subtree |
| `delete_subtree()` | method | `delete_subtree` | Delete subtree |
| `replace_subtree()` | method | `replace_subtree` | Replace subtree |
| `copy_subtree()` | method | `copy_subtree` | Copy subtree |
| `move_subtree()` | method | `move_subtree` | Move subtree |
| `ensure_path()` | method | `ensure_path` | Create path |

**In `python/arbors/_arbors.pyi` (Tree class):**

| Symbol | Signature |
|--------|-----------|
| `extract(path: str) -> Tree \| None` | |
| `delete_subtree(path: str) -> Tree` | |
| `replace_subtree(path: str, replacement: Tree) -> Tree` | |
| `copy_subtree(from_path: str, to_path: str) -> Tree` | |
| `move_subtree(from_path: str, to_path: str) -> Tree` | |
| `ensure_path(path: str) -> Tree` | |

---

### 13.4.4 Execution Steps

**Strategy:** Build from core algorithms up. Start with extract (simplest), then delete, then replace/copy/move.

---

#### Step 1: Create tree_ops module with extract_subtree

**Commit:** `feat(io): add tree_ops module with extract_subtree`

**Algorithm for extract_subtree:**
1. Parse path using `arbors_expr::parse_path()`
2. Resolve path from root to find target node
3. If not found, return None
4. Create new ArborBuilder
5. Recursively copy target node and all descendants to builder
6. Call `builder.finish()` to create new Arbor
7. Return Some(new_arbor)

**Tasks:**
- [x] Create `crates/arbors-io/src/tree_ops.rs`
- [x] Add `pub mod tree_ops;` to `crates/arbors-io/src/lib.rs`
- [x] Implement path resolution helper using existing path parsing
- [x] Implement recursive node copying to ArborBuilder
- [x] Implement `extract_subtree()` function
- [x] Add unit tests

**Checkpoint:** `cargo test -p arbors-io` ✓

---

#### Step 2: Implement delete_subtree

**Commit:** `feat(io): implement delete_subtree`

**Algorithm for delete_subtree:**
1. Parse path to get target location
2. If path doesn't exist, return None
3. Create new ArborBuilder
4. Copy entire tree EXCEPT the node at path:
   - For object parent: skip the field
   - For array parent: skip the element (indices shift)
5. Return new Arbor

**Tasks:**
- [x] Implement tree reconstruction helper that can skip specific paths
- [x] Implement `delete_subtree()` function
- [x] Handle array index shifting when element deleted
- [x] Add unit tests for object fields and array elements

**Checkpoint:** `cargo test -p arbors-io` ✓

---

#### Step 3: Implement replace_subtree

**Commit:** `feat(io): implement replace_subtree`

**Algorithm for replace_subtree:**
1. Parse path to get target location
2. If path doesn't exist, return None
3. Create new ArborBuilder
4. Copy tree, but at target location, insert replacement subtree instead
5. Handle interner merging (replacement may have different string IDs)
6. Return new Arbor

**Tasks:**
- [x] Implement subtree insertion during reconstruction
- [x] Handle interner ID remapping for replacement tree
- [x] Implement `replace_subtree()` function
- [x] Add unit tests

**Checkpoint:** `cargo test -p arbors-io` ✓

---

#### Step 4: Implement copy_subtree and move_subtree

**Commit:** `feat(io): implement copy_subtree and move_subtree`

**Algorithm for copy_subtree:**
1. Extract subtree at from_path
2. If not found, return None
3. Insert extracted subtree at to_path
4. Return new Arbor with both original and copy

**Algorithm for move_subtree:**
1. Copy from_path to to_path
2. Delete from_path from result
3. Return new Arbor

**Tasks:**
- [x] Implement `copy_subtree()` using extract + replace logic
- [x] Implement `move_subtree()` as copy + delete
- [x] Add unit tests for various copy/move scenarios

**Checkpoint:** `cargo test -p arbors-io` ✓

---

#### Step 5: Implement ensure_path

**Commit:** `feat(io): implement ensure_path`

**Algorithm for ensure_path:**
1. Parse path into segments
2. For each segment except the last:
   - If segment exists, continue
   - If segment missing and parent is object, create empty object
   - If segment missing and parent is array, error (can't create array elements)
3. Return new Arbor with path ensured

**Tasks:**
- [x] Implement `ensure_path()` with intermediate object creation
- [x] Handle error cases (array parent, type mismatches)
- [x] Add unit tests

**Checkpoint:** `cargo test -p arbors-io` ✓

---

#### Step 6: Add Rust tests

**Commit:** `test(io): add comprehensive tree_ops tests`

**Test file:** `crates/arbors-io/tests/tree_ops_tests.rs`

**Test cases:**
- [x] `test_extract_simple_field` - extract object field
- [x] `test_extract_nested_path` - extract deep path
- [x] `test_extract_array_element` - extract array[i]
- [x] `test_extract_missing_path` - returns None
- [x] `test_extract_entire_tree` - extract at root path ""
- [x] `test_extract_schema_dropped` - extracted tree has no schema
- [x] `test_delete_object_field` - delete field from object
- [x] `test_delete_array_element` - delete element, indices shift
- [x] `test_delete_nested` - delete deep path
- [x] `test_delete_missing` - returns Err
- [x] `test_delete_root_error` - delete "" returns Err
- [x] `test_replace_object_field` - replace field value
- [x] `test_replace_array_element` - replace element
- [x] `test_replace_with_different_type` - replace string with object
- [x] `test_replace_missing` - returns Err
- [x] `test_replace_root` - replace "" replaces entire tree
- [x] `test_replace_cross_arbor_interner` - interner remapping works
- [x] `test_copy_within_object` - copy field to new location
- [x] `test_copy_to_nested_path` - copy to deep path
- [x] `test_copy_overwrites_existing` - destination replaced silently
- [x] `test_copy_self_nesting_error` - copy "a" to "a.b" errors
- [x] `test_copy_to_root_error` - copy to "" errors
- [x] `test_copy_parent_missing_error` - copy to "x.y.z" when x.y missing errors
- [x] `test_move_field` - move removes source
- [x] `test_move_root_error` - move "" or to "" errors
- [x] `test_move_self_nesting_error` - move "a" to "a.b" errors
- [x] `test_move_parent_missing_error` - move to "x.y.z" when x.y missing errors
- [x] `test_ensure_path_creates_objects` - creates intermediate objects
- [x] `test_ensure_path_existing` - no-op if exists
- [x] `test_ensure_path_array_error` - error if array intermediate needed
- [x] `test_ensure_path_type_mismatch` - error if intermediate is not object

**Checkpoint:** `cargo test` ✓

---

#### Step 7: Python bindings for Tree

**Commit:** `feat(python): add subtree manipulation methods to Tree`

**Add to Tree impl in `python/src/lib.rs`:**

**Tasks:**
- [x] Implement `extract()` method
- [x] Implement `delete_subtree()` method
- [x] Implement `replace_subtree()` method
- [x] Implement `copy_subtree()` method
- [x] Implement `move_subtree()` method
- [x] Implement `ensure_path()` method
- [x] Add proper error handling (KeyError, ValueError, TypeError)

**Checkpoint:** `make python` ✓

---

#### Step 8: Update Python stubs

**Commit:** `docs(python): add subtree method stubs`

**Update `python/arbors/_arbors.pyi`:**

**Tasks:**
- [x] Add `extract()` method signature with docstring
- [x] Add `delete_subtree()` method signature with docstring
- [x] Add `replace_subtree()` method signature with docstring
- [x] Add `copy_subtree()` method signature with docstring
- [x] Add `move_subtree()` method signature with docstring
- [x] Add `ensure_path()` method signature with docstring

**Checkpoint:** `make check-stubs` ✓

---

#### Step 9: Python tests

**Commit:** `test(python): add subtree manipulation tests`

**Add to `python/tests/test_tree.py` or new `python/tests/test_subtree.py`:**

**Test cases:**
- [x] `test_extract_simple_field` - extract and verify independent
- [x] `test_extract_nested` - extract deep path
- [x] `test_extract_array_element` - extract items[0]
- [x] `test_extract_missing_returns_none` - None for missing
- [x] `test_extract_root_path` - extract "" copies entire tree
- [x] `test_extract_independence` - extracted tree is independent of original
- [x] `test_extract_no_schema` - extracted tree has no schema
- [x] `test_delete_field` - delete from object
- [x] `test_delete_array_element` - delete and verify shift
- [x] `test_delete_missing_raises` - KeyError
- [x] `test_delete_root_raises` - ValueError for ""
- [x] `test_delete_original_unchanged` - immutability
- [x] `test_replace_field` - replace value
- [x] `test_replace_with_tree` - replace with another tree
- [x] `test_replace_missing_raises` - KeyError
- [x] `test_replace_root` - replace "" replaces entire tree
- [x] `test_replace_overwrites` - existing value replaced silently
- [x] `test_copy_field` - copy to new location
- [x] `test_copy_nested` - copy deep path
- [x] `test_copy_overwrites_existing` - destination replaced
- [x] `test_copy_self_nesting_raises` - ValueError for "a" to "a.b"
- [x] `test_copy_to_root_raises` - ValueError for to=""
- [x] `test_copy_parent_missing_raises` - KeyError for to="x.y.z" when x.y missing
- [x] `test_move_field` - move removes source
- [x] `test_move_root_raises` - ValueError for from="" or to=""
- [x] `test_move_self_nesting_raises` - ValueError for "a" to "a.b"
- [x] `test_move_parent_missing_raises` - KeyError for to="x.y.z" when x.y missing
- [x] `test_ensure_path_creates` - creates intermediates
- [x] `test_ensure_path_existing` - no-op
- [x] `test_ensure_path_array_raises` - ValueError for array index
- [x] `test_ensure_path_type_mismatch_raises` - ValueError if non-object in path
- [x] `test_ensure_path_preserves_original` - immutability

**Checkpoint:** `make test` ✓

---

#### Step 10: Final verification

**Commit:** `docs(subtree): finalize Phase 13.4`

**Tasks:**
- [x] Run full test suite: `cargo test && make test`
- [x] Run parity check: `make check-parity`
- [x] Run stubs check: `make check-stubs`
- [x] Update Phase 13.4 task checkboxes in this plan

---

### 13.4.5 Semantic Specification

#### extract() Behavior

| Input | Output |
|-------|--------|
| `tree.extract("field")` | New Tree with just field's value |
| `tree.extract("a.b.c")` | New Tree with just c's value |
| `tree.extract("items[0]")` | New Tree with first element |
| `tree.extract("missing")` | None |
| `tree.extract("")` | New Tree (copy of entire tree) |

#### delete_subtree() Behavior

| Input | Output |
|-------|--------|
| `{"a": 1, "b": 2}.delete_subtree("a")` | `{"b": 2}` |
| `[1, 2, 3].delete_subtree("[1]")` | `[1, 3]` (indices shift) |
| `tree.delete_subtree("missing")` | KeyError |
| `tree.delete_subtree("")` | ValueError (cannot delete root) |

#### replace_subtree() Behavior

| Input | Output |
|-------|--------|
| `{"a": 1}.replace_subtree("a", Tree("hello"))` | `{"a": "hello"}` |
| `[1, 2].replace_subtree("[0]", Tree(99))` | `[99, 2]` |
| `tree.replace_subtree("", Tree(...))` | New tree with replacement as root |
| `tree.replace_subtree("missing", ...)` | KeyError |

#### copy_subtree() / move_subtree() Behavior

| Operation | Input | Output |
|-----------|-------|--------|
| copy | `{"a": 1}.copy_subtree("a", "b")` | `{"a": 1, "b": 1}` |
| copy | `{"a": {"x": 1}}.copy_subtree("a", "b")` | `{"a": {"x": 1}, "b": {"x": 1}}` |
| copy | `{"a": 1, "b": 2}.copy_subtree("a", "b")` | `{"a": 1, "b": 1}` (replaces existing) |
| move | `{"a": 1, "b": 2}.move_subtree("a", "c")` | `{"b": 2, "c": 1}` |
| copy | `tree.copy_subtree("a", "a.b")` | ValueError (self-nesting) |
| move | `tree.move_subtree("", "backup")` | ValueError (cannot move root) |
| copy | `tree.copy_subtree("a", "")` | ValueError (cannot replace root via copy) |

#### ensure_path() Behavior

| Input | Output | Notes |
|-------|--------|-------|
| `{}.ensure_path("a.b")` | `{"a": {}}` | Creates "a" as empty object |
| `{"a": {}}.ensure_path("a.b")` | `{"a": {}}` | Already valid, no change |
| `{}.ensure_path("a[0]")` | ValueError | Can't create array index |
| `{"a": 1}.ensure_path("a.b")` | ValueError | "a" is not an object |

#### Performance Note

Each operation rebuilds the tree, creating a new Arbor. For chains of operations on large trees, use `LazyTree` (Phase 13.7) to batch mutations and minimize intermediate allocations.

---

### 13.4.6 Deliverables and Checkpoints

**Deliverable:** Subtree manipulation API (extract, replace, copy, move, delete, ensure_path).

| Checkpoint | Verification |
|------------|--------------|
| tree_ops module created | `crates/arbors-io/src/tree_ops.rs` exists |
| extract works | Tests verify subtree extraction |
| delete works | Tests verify deletion with immutability |
| replace works | Tests verify replacement |
| copy/move work | Tests verify copy and move operations |
| ensure_path works | Tests verify path creation |
| Rust tests pass | `cargo test` succeeds |
| Python builds | `make python` succeeds |
| Python tests pass | `make test` succeeds |
| API parity | `make check-parity` succeeds |
| Stubs correct | `make check-stubs` succeeds |

**Commit after all checkpoints pass.**

---

## Phase 13.5 Enhanced Tree Construction

**Purpose:** Fluent builders for constructing trees programmatically.

**Status:** Complete

---

### 13.5.0 Design Decisions

#### Always an Arbor

**DECIDED:** All construction methods produce an `Arbor`. There is no standalone `Tree` type that exists independently. The `Tree` type remains a lightweight reference (arbor + root_id) into an Arbor.

```python
# Python: from_dict produces Arbor containing one Tree
arbor = arbors.from_dict({"name": "Alice"})
tree = arbor[0]  # Access the Tree
```

#### Builder Root Types

**DECIDED:** The builder supports object, array, and primitive roots. Three factory methods:

```rust
// Object root (most common)
TreeBuilder::object()
    .add_string("name", "Alice")
    .build() -> Arbor

// Array root
TreeBuilder::array()
    .add_int(1)
    .add_string("two")
    .build() -> Arbor

// Primitive root
TreeBuilder::scalar("hello").build() -> Arbor
TreeBuilder::scalar(42i64).build() -> Arbor
TreeBuilder::scalar(3.14f64).build() -> Arbor
TreeBuilder::scalar(true).build() -> Arbor
TreeBuilder::null().build() -> Arbor
```

#### TreeBuilder vs Expression-Based Construction

**DECIDED:** These are **alternatives** - users pick one approach. Both produce the same result (Arbor).

- **TreeBuilder**: Fluent, ergonomic, good for hand-written construction
- **Expression-based** (`object()`, `array()`, `lit()`): Better for computed/dynamic structures

No strong reason to layer one on top of the other.

#### Python Type Coercion

**DECIDED:** `from_dict()` does deep conversion with automatic type coercion:

| Python Type | Arbors Type |
|-------------|-------------|
| `None` | `Null` |
| `bool` | `Bool` |
| `int` | `Int64` |
| `float` | `Float64` |
| `str` | `String` |
| `list` | `Array` (recursively converted) |
| `dict` | `Object` (recursively converted) |

**Note on `None` vs missing keys:** When a dict contains `{"key": None}`, the resulting tree has a `key` field with Null value. If the key is simply not present in the dict, the field doesn't exist in the tree. This is consistent with existing JSON parsing semantics.

#### Where to Implement

**DECIDED:** `TreeBuilder` lives in `arbors-io` alongside `ArborBuilder`. TreeBuilder will delegate to ArborBuilder's infrastructure (interner, pools, node reservation).

#### Schema Handling

**DECIDED:** TreeBuilder creates schemaless Arbors. Schema inference can be done separately if needed.

**Future path:** Schema-aware construction (`TreeBuilder::with_schema(schema)`) is out of scope for Phase 13.5 but could be added in a future phase.

#### Duplicate Object Keys

**DECIDED:** **Last-wins** (silent overwrite). Consistent with existing JSON parsing in ArborBuilder which uses sonic-rs last-value-wins semantics. No error is raised.

```rust
TreeBuilder::object()
    .add_string("name", "Alice")
    .add_string("name", "Bob")  // Overwrites "Alice"
    .build()  // Result: {"name": "Bob"}
```

#### Float Special Values (NaN/±inf)

**DECIDED:** **Reject with error.** JSON doesn't support NaN/±inf. Since TreeBuilder produces JSON-compatible structures, `add_float()` and `scalar_float()` return `Result` and fail with `Error::InvalidFloat` for NaN/±inf.

```rust
TreeBuilder::object()
    .add_float("value", f64::NAN)?  // Returns Err(Error::InvalidFloat)
```

In Python, this raises `ValueError("Float value NaN is not JSON-compatible")`.

#### Integer Overflow (Python)

**DECIDED:** **Raise `OverflowError`** for Python integers outside i64 range. Explicit failure is better than silent data corruption. Users can convert to string or float themselves if they need big integers.

```python
from_dict({"big": 2**64})  # Raises OverflowError
```

#### Builder Ownership and Consumption

**DECIDED:** Builder methods take **`self` by value** (consuming) for Rust fluent pattern. This naturally prevents reuse after `build()`.

```rust
let builder = TreeBuilder::object();
let arbor = builder.build()?;  // builder consumed
// builder.add_string(...) would be compile error
```

In Python, builders track consumption state and raise `ValueError("Builder already consumed")` if methods are called after `build()`.

#### Build Returns Result

**DECIDED:** `build()` returns `Result<Arbor>` to surface:
- Float validation errors (NaN/±inf)
- Allocation failures
- Unclosed nested builders (Python)

#### Unclosed Python Builders

**DECIDED:** In Python, `build()` raises `ValueError` if there are unclosed nested builders:

```python
# ERROR: Missing end_object()
TreeBuilder.object().add_object("nested").add_string("x", "y").build()
# Raises ValueError("Unclosed nested object builder at 'nested'")
```

#### Key Ordering

**DECIDED:** Object keys are stored in **sorted order** (Arbor invariant). User insertion order is NOT preserved. This is called out explicitly to avoid surprises:

```python
tree = TreeBuilder.object().add_int("z", 1).add_int("a", 2).build()
tree[0].to_json()  # '{"a":2,"z":1}' - sorted, not insertion order
```

---

### 13.5.1 API Design

#### Rust API (in `arbors-io`)

```rust
/// Fluent builder for constructing trees programmatically.
///
/// TreeBuilder provides a fluent interface for building JSON-like tree
/// structures without writing JSON strings. It supports object, array,
/// and scalar roots.
///
/// All builder methods consume `self` (take ownership) enabling fluent chaining.
/// After `build()` is called, the builder cannot be reused.
///
/// # Example
///
/// ```
/// // Simple case (no floats) - pure fluent chain
/// let arbor = TreeBuilder::object()
///     .add_string("name", "Alice")
///     .add_int("age", 30)
///     .add_object("address", |b| {
///         b.add_string("city", "NYC")
///     })
///     .build()?;
///
/// // With floats - requires ? for add_float (validates NaN/±inf)
/// let arbor = TreeBuilder::object()
///     .add_string("name", "Alice")
///     .add_float("score", 95.5)?  // Returns Result<Self>
///     .add_float("rating", 4.2)?
///     .build()?;
/// ```
pub struct TreeBuilder { /* ... */ }

impl TreeBuilder {
    // === Factory Methods ===

    /// Create a builder for an object root.
    pub fn object() -> ObjectBuilder;

    /// Create a builder for an array root.
    pub fn array() -> ArrayBuilder;

    /// Create a builder for a scalar root (string).
    pub fn scalar_string(value: impl Into<String>) -> ScalarBuilder;

    /// Create a builder for a scalar root (i64).
    pub fn scalar_int(value: i64) -> ScalarBuilder;

    /// Create a builder for a scalar root (f64).
    ///
    /// Returns Err(Error::InvalidFloat) if value is NaN or ±infinity.
    pub fn scalar_float(value: f64) -> Result<ScalarBuilder>;

    /// Create a builder for a scalar root (bool).
    pub fn scalar_bool(value: bool) -> ScalarBuilder;

    /// Create a builder for a null root.
    pub fn null() -> ScalarBuilder;
}

/// Builder for constructing object trees.
///
/// Methods consume `self` and return `Self` for fluent chaining.
/// Duplicate keys use last-wins semantics (later values overwrite earlier).
/// Keys are stored in sorted order regardless of insertion order.
pub struct ObjectBuilder { /* ... */ }

impl ObjectBuilder {
    // === Add Scalar Fields ===

    /// Add a string field.
    pub fn add_string(self, key: &str, value: impl Into<String>) -> Self;

    /// Add an integer field.
    pub fn add_int(self, key: &str, value: i64) -> Self;

    /// Add a float field.
    ///
    /// Returns Err(Error::InvalidFloat) if value is NaN or ±infinity.
    pub fn add_float(self, key: &str, value: f64) -> Result<Self>;

    /// Add a boolean field.
    pub fn add_bool(self, key: &str, value: bool) -> Self;

    /// Add a null field.
    pub fn add_null(self, key: &str) -> Self;

    // === Add Nested Containers ===

    /// Add a nested object field.
    ///
    /// The closure receives an ObjectBuilder for the nested object.
    pub fn add_object<F>(self, key: &str, f: F) -> Self
    where
        F: FnOnce(ObjectBuilder) -> ObjectBuilder;

    /// Add a nested array field.
    ///
    /// The closure receives an ArrayBuilder for the nested array.
    pub fn add_array<F>(self, key: &str, f: F) -> Self
    where
        F: FnOnce(ArrayBuilder) -> ArrayBuilder;

    // === Build ===

    /// Build the Arbor from this object.
    ///
    /// Returns Err if any float values were invalid (should not happen if
    /// add_float errors were handled, but protects against future changes).
    pub fn build(self) -> Result<Arbor>;
}

/// Builder for constructing array trees.
///
/// Methods consume `self` and return `Self` for fluent chaining.
pub struct ArrayBuilder { /* ... */ }

impl ArrayBuilder {
    // === Add Scalar Elements ===

    /// Add a string element.
    pub fn add_string(self, value: impl Into<String>) -> Self;

    /// Add an integer element.
    pub fn add_int(self, value: i64) -> Self;

    /// Add a float element.
    ///
    /// Returns Err(Error::InvalidFloat) if value is NaN or ±infinity.
    pub fn add_float(self, value: f64) -> Result<Self>;

    /// Add a boolean element.
    pub fn add_bool(self, value: bool) -> Self;

    /// Add a null element.
    pub fn add_null(self) -> Self;

    // === Add Nested Containers ===

    /// Add a nested object element.
    pub fn add_object<F>(self, f: F) -> Self
    where
        F: FnOnce(ObjectBuilder) -> ObjectBuilder;

    /// Add a nested array element.
    pub fn add_array<F>(self, f: F) -> Self
    where
        F: FnOnce(ArrayBuilder) -> ArrayBuilder;

    // === Build ===

    /// Build the Arbor from this array.
    pub fn build(self) -> Result<Arbor>;
}

/// Builder for constructing scalar trees.
///
/// Created via TreeBuilder::scalar_* methods.
pub struct ScalarBuilder { /* ... */ }

impl ScalarBuilder {
    /// Build the Arbor from this scalar.
    ///
    /// For float scalars, this was already validated at creation time.
    pub fn build(self) -> Result<Arbor>;
}
```

#### Python API

```python
# === Module-level functions ===

def from_dict(data: dict | list | str | int | float | bool | None) -> Arbor:
    """Create an Arbor from a Python dict, list, or scalar.

    Performs deep conversion of nested structures:
    - dict → Object
    - list → Array
    - str → String
    - int → Int64 (raises OverflowError if outside i64 range)
    - float → Float64 (raises ValueError if NaN/±inf)
    - bool → Bool
    - None → Null

    Args:
        data: Python data structure to convert

    Returns:
        Arbor containing one tree with the converted data

    Raises:
        TypeError: If data contains unsupported types
        OverflowError: If an integer is outside i64 range
        ValueError: If a float is NaN or ±infinity

    Example:
        >>> arbor = arbors.from_dict({"name": "Alice", "scores": [95, 87]})
        >>> tree = arbor[0]
        >>> tree["name"].value
        "Alice"
    """

# === TreeBuilder class ===

class TreeBuilder:
    """Fluent builder for constructing trees programmatically.

    All builder methods return `self` for fluent chaining.
    After build() is called, the builder is consumed and cannot be reused.

    Example:
        >>> arbor = (TreeBuilder.object()
        ...     .add_string("name", "Alice")
        ...     .add_int("age", 30)
        ...     .build())
    """

    @staticmethod
    def object() -> ObjectBuilder:
        """Create a builder for an object root."""

    @staticmethod
    def array() -> ArrayBuilder:
        """Create a builder for an array root."""

    @staticmethod
    def scalar(value: str | int | float | bool | None) -> ScalarBuilder:
        """Create a builder for a scalar root.

        Raises:
            OverflowError: If int is outside i64 range
            ValueError: If float is NaN or ±infinity
        """

class ObjectBuilder:
    """Builder for constructing object trees.

    Duplicate keys use last-wins semantics.
    Keys are stored in sorted order regardless of insertion order.
    Builder is consumed after build() and cannot be reused.
    """

    def add_string(self, key: str, value: str) -> ObjectBuilder: ...
    def add_int(self, key: str, value: int) -> ObjectBuilder:
        """Raises OverflowError if value outside i64 range."""
    def add_float(self, key: str, value: float) -> ObjectBuilder:
        """Raises ValueError if value is NaN or ±infinity."""
    def add_bool(self, key: str, value: bool) -> ObjectBuilder: ...
    def add_null(self, key: str) -> ObjectBuilder: ...
    def add_object(self, key: str) -> ObjectBuilder:
        """Start a nested object. Call end_object() when done.

        Returns a new ObjectBuilder for the nested object.
        The returned builder shares state with the parent.
        """
    def end_object(self) -> ObjectBuilder | ArrayBuilder:
        """End the current nested object and return to parent builder.

        Returns the parent builder instance (ObjectBuilder or ArrayBuilder)
        to enable continued chaining on the parent.

        Raises:
            ValueError: If this is a root builder (not inside a nested object)
        """
    def add_array(self, key: str) -> ArrayBuilder:
        """Start a nested array. Call end_array() when done.

        Returns an ArrayBuilder for the nested array.
        """
    def build(self) -> Arbor:
        """Build the Arbor from this object.

        Raises:
            ValueError: If builder already consumed
            ValueError: If there are unclosed nested builders
        """

class ArrayBuilder:
    """Builder for constructing array trees.

    Builder is consumed after build() and cannot be reused.
    """

    def add_string(self, value: str) -> ArrayBuilder: ...
    def add_int(self, value: int) -> ArrayBuilder:
        """Raises OverflowError if value outside i64 range."""
    def add_float(self, value: float) -> ArrayBuilder:
        """Raises ValueError if value is NaN or ±infinity."""
    def add_bool(self, value: bool) -> ArrayBuilder: ...
    def add_null(self) -> ArrayBuilder: ...
    def add_object(self) -> ObjectBuilder:
        """Start a nested object element. Call end_object() when done.

        Returns an ObjectBuilder for the nested object.
        """
    def add_array(self) -> ArrayBuilder:
        """Start a nested array element. Call end_array() when done.

        Returns a new ArrayBuilder for the nested array.
        """
    def end_array(self) -> ObjectBuilder | ArrayBuilder:
        """End the current nested array and return to parent builder.

        Returns the parent builder instance (ObjectBuilder or ArrayBuilder)
        to enable continued chaining on the parent.

        Raises:
            ValueError: If this is a root builder (not inside a nested array)
        """
    def build(self) -> Arbor:
        """Build the Arbor from this array.

        Raises:
            ValueError: If builder already consumed
            ValueError: If there are unclosed nested builders
        """

class ScalarBuilder:
    """Builder for constructing scalar trees.

    Builder is consumed after build() and cannot be reused.
    """

    def build(self) -> Arbor:
        """Build the Arbor from this scalar.

        Raises:
            ValueError: If builder already consumed
        """
```

**Note on Python Nested Builders:** Python doesn't have Rust's closure syntax, so nested construction uses `add_object()`/`end_object()` pairs instead of closures:

```python
# Python style
arbor = (TreeBuilder.object()
    .add_string("name", "Alice")
    .add_object("address")
        .add_string("city", "NYC")
        .end_object()
    .build())

# vs Rust style with closures
let arbor = TreeBuilder::object()
    .add_string("name", "Alice")
    .add_object("address", |b| b.add_string("city", "NYC"))
    .build()?;
```

---

### 13.5.1a Python Builder Implementation Design (NEW)

**Problem Statement:**
The Rust API uses closures for nested construction (`add_object("key", |b| ...)`), but Python doesn't have this pattern. Python uses `add_object("key")` which returns a child builder, then `end_object()` to return to the parent. This requires tracking the full nesting hierarchy so `end_object()` can correctly return control to the parent at any nesting depth.

**First Implementation Attempt (FAILED):**
Each builder tracked its immediate parent context. When `end_object()` was called, it merged the current builder's fields into the parent and returned a new builder pointing to the parent. **Problem:** The returned builder lost the grandparent context. For deep nesting (root → level1 → level2), calling `end_object()` on level2 returned a level1 builder, but that builder thought it was a root (no grandparent knowledge), so calling `end_object()` on level1 incorrectly raised "Not inside a nested object".

**Correct Design: Stack-Based Shared State**

All builders share a **single mutable state** containing a **stack of frames**. This naturally tracks the full nesting hierarchy:

```
SharedBuilderState {
    stack: Vec<BuilderFrame>,  // Bottom = root, Top = current
    consumed: bool,
}

BuilderFrame = Object { fields: IndexMap<String, Value>, parent_key: Option<String> }
            | Array  { elements: Vec<Value>, parent_key: Option<String> }
```

**Operations:**

1. `TreeBuilder.object()` → Creates shared state with one Object frame on stack
2. `TreeBuilder.array()` → Creates shared state with one Array frame on stack
3. `add_string("key", "value")` → Inserts into top frame (must be Object)
4. `add_string("value")` → Pushes to top frame (must be Array)
5. `add_object("key")` → Pushes new Object frame onto stack with `parent_key=Some("key")`
6. `add_object()` (in array) → Pushes new Object frame with `parent_key=None`
7. `end_object()`:
   - Pop top frame (must be Object)
   - Convert to PendingValue::Object
   - If parent_key is Some(key): insert into parent Object frame with that key
   - If parent_key is None: push onto parent Array frame
   - Return builder (same shared state, now pointing to parent which is new top of stack)
8. `end_array()` → Similar to end_object() but for Array frames
9. `build()`:
   - Verify stack has exactly 1 frame (else "unclosed builder" error)
   - Convert root frame to ExprResult
   - Build Arbor via ArborBuilder

**Key Insight:** The builder type (ObjectBuilder vs ArrayBuilder) is just a **view** into the shared state. It knows "I operate on the top frame of the stack". When `end_object()` is called, it returns an ObjectBuilder or ArrayBuilder based on the new top frame's type.

**Python Type Returned by end_object()/end_array():**

Since the parent could be either Object or Array, these methods return a **union type**:
- `end_object() -> ObjectBuilder | ArrayBuilder`
- `end_array() -> ObjectBuilder | ArrayBuilder`

In PyO3, this is `PyObject` (or `Py<PyAny>`), dynamically returning the appropriate type.

**Thread Safety (unsendable):**

`Rc<RefCell<SharedBuilderState>>` is not `Send` or `Sync`. Use `#[pyclass(unsendable)]` to tell PyO3 these builders are single-threaded only. This is appropriate since fluent builders are inherently sequential.

**Example Deep Nesting:**

```python
arbor = (TreeBuilder.object()                    # stack: [Object{}]
    .add_string("name", "Alice")                 # stack: [Object{name:"Alice"}]
    .add_object("level1")                        # stack: [Object{name:"Alice"}, Object{}(key="level1")]
        .add_object("level2")                    # stack: [..., Object{}, Object{}(key="level2")]
            .add_string("value", "deep")         # stack: [..., Object{}, Object{value:"deep"}]
            .end_object()                        # pop level2, insert into level1 → stack: [..., Object{level2:{value:"deep"}}]
                                                 # returns ObjectBuilder (level1 is Object)
        .end_object()                            # pop level1, insert into root → stack: [Object{name:"Alice", level1:{...}}]
                                                 # returns ObjectBuilder (root is Object)
    .build())                                    # verify stack.len()==1, build
```

---

### 13.5.2 Definitive Symbol Inventory

#### New Files to Create

| File | Purpose |
|------|---------|
| `crates/arbors-io/src/tree_builder.rs` | TreeBuilder, ObjectBuilder, ArrayBuilder, ScalarBuilder |

#### Symbols to Add

**In `crates/arbors-io/src/tree_builder.rs` (new):**

| Symbol | Type | Description |
|--------|------|-------------|
| `TreeBuilder` | struct | Entry point with factory methods |
| `ObjectBuilder` | struct | Builder for object trees |
| `ArrayBuilder` | struct | Builder for array trees |
| `ScalarBuilder` | struct | Builder for scalar trees |

**In `crates/arbors-io/src/lib.rs`:**

| Symbol | Type | Description |
|--------|------|-------------|
| `pub mod tree_builder` | module | Export tree builder |
| Re-exports | - | `TreeBuilder`, `ObjectBuilder`, `ArrayBuilder`, `ScalarBuilder` |

**In `python/src/lib.rs`:**

| Symbol | Type | PyO3 name | Description |
|--------|------|-----------|-------------|
| `from_dict()` | function | `from_dict` | Convert Python data to Arbor |
| `TreeBuilder` | class | `TreeBuilder` | Entry point |
| `ObjectBuilder` | class | `ObjectBuilder` | Object builder |
| `ArrayBuilder` | class | `ArrayBuilder` | Array builder |
| `ScalarBuilder` | class | `ScalarBuilder` | Scalar builder |

**In `python/arbors/_arbors.pyi`:**

| Symbol | Signature |
|--------|-----------|
| `def from_dict(data: dict \| list \| str \| int \| float \| bool \| None) -> Arbor` | |
| `class TreeBuilder` | with `object()`, `array()`, `scalar()` methods |
| `class ObjectBuilder` | with `add_*`, `end_object()`, `build()` methods |
| `class ArrayBuilder` | with `add_*`, `end_array()`, `build()` methods |
| `class ScalarBuilder` | with `build()` method |

**In `python/arbors/__init__.py`:**

| Symbol | Description |
|--------|-------------|
| `from_dict` | Add to `__all__` |
| `TreeBuilder` | Add to `__all__` |
| `ObjectBuilder` | Add to `__all__` |
| `ArrayBuilder` | Add to `__all__` |
| `ScalarBuilder` | Add to `__all__` |

---

### 13.5.3 Execution Steps

**Strategy:** Build from core Rust implementation up. TreeBuilder delegates to ArborBuilder infrastructure.

---

#### Step 1: Create tree_builder module with core types

**Commit:** `feat(io): add tree_builder module with core types`

**Tasks:**
- [x] Create `crates/arbors-io/src/tree_builder.rs`
- [x] Define `TreeBuilder` struct with factory methods
- [x] Define `ObjectBuilder` struct with internal state (tracks pending fields)
- [x] Define `ArrayBuilder` struct with internal state (tracks pending elements)
- [x] Define `ScalarBuilder` struct
- [x] Add `pub mod tree_builder;` to `crates/arbors-io/src/lib.rs`
- [x] Re-export builders from lib.rs

**Checkpoint:** `cargo build -p arbors-io` ✓

---

#### Step 2: Implement ObjectBuilder

**Commit:** `feat(io): implement ObjectBuilder fluent API`

**Algorithm:**
1. Track pending fields as `Vec<(String, PendingValue)>` where PendingValue is enum
2. Each `add_*` method pushes to the pending list
3. `add_object` creates nested ObjectBuilder, captures result on return
4. `build()` converts pending fields to ArborBuilder calls

**Tasks:**
- [x] Implement `add_string()`, `add_int()`, `add_float()`, `add_bool()`, `add_null()`
- [x] Implement `add_object()` with closure pattern
- [x] Implement `add_array()` with closure pattern
- [x] Implement `build()` that creates Arbor via ArborBuilder

**Checkpoint:** `cargo test -p arbors-io` ✓

---

#### Step 3: Implement ArrayBuilder

**Commit:** `feat(io): implement ArrayBuilder fluent API`

**Algorithm:**
1. Track pending elements as `Vec<PendingValue>`
2. Each `add_*` method pushes to the pending list
3. `build()` converts to ArborBuilder calls

**Tasks:**
- [x] Implement `add_string()`, `add_int()`, `add_float()`, `add_bool()`, `add_null()`
- [x] Implement `add_object()` with closure pattern
- [x] Implement `add_array()` with closure pattern
- [x] Implement `build()` that creates Arbor via ArborBuilder

**Checkpoint:** `cargo test -p arbors-io` ✓

---

#### Step 4: Implement ScalarBuilder

**Commit:** `feat(io): implement ScalarBuilder`

**Tasks:**
- [x] Implement `build()` for each scalar type
- [x] Use ArborBuilder.add_expr_result() with ExprResult::Scalar

**Checkpoint:** `cargo test -p arbors-io` ✓

---

#### Step 5: Add Rust tests

**Commit:** `test(io): add TreeBuilder tests`

**Test file:** `crates/arbors-io/tests/tree_builder_tests.rs`

**Test cases:**
- [x] `test_object_empty` - empty object builds correctly
- [x] `test_object_string_field` - object with string field
- [x] `test_object_int_field` - object with int field
- [x] `test_object_float_field` - object with float field
- [x] `test_object_bool_field` - object with bool field
- [x] `test_object_null_field` - object with null field
- [x] `test_object_multiple_fields` - object with multiple fields
- [x] `test_object_duplicate_keys_last_wins` - duplicate keys use last value
- [x] `test_object_keys_sorted` - keys stored in sorted order
- [x] `test_object_nested_object` - nested object
- [x] `test_object_nested_array` - object containing array
- [x] `test_object_deep_nesting` - deeply nested structure
- [x] `test_array_empty` - empty array builds correctly
- [x] `test_array_homogeneous_ints` - array of ints
- [x] `test_array_heterogeneous` - mixed types in array
- [x] `test_array_nested_objects` - array of objects
- [x] `test_array_nested_arrays` - array of arrays
- [x] `test_scalar_string` - string root
- [x] `test_scalar_int` - int root
- [x] `test_scalar_float` - float root
- [x] `test_scalar_float_nan_error` - NaN returns Error::InvalidFloat
- [x] `test_scalar_float_inf_error` - ±infinity returns Error::InvalidFloat
- [x] `test_add_float_nan_error` - add_float with NaN returns error
- [x] `test_add_float_inf_error` - add_float with ±infinity returns error
- [x] `test_scalar_bool_true` - true root
- [x] `test_scalar_bool_false` - false root
- [x] `test_null` - null root
- [x] `test_roundtrip_to_json` - built tree serializes correctly
- [x] `test_mixed_deep_nesting_with_empty` - nested objects/arrays with empty containers

**Checkpoint:** `cargo test` ✓

---

#### Step 6: Python bindings - from_dict

**Commit:** `feat(python): implement from_dict() function`

**Algorithm:**
1. Accept `PyAny` and determine Python type
2. Recursively convert:
   - `dict` → build object with recursive calls for values
   - `list` → build array with recursive calls for elements
   - `str` → String scalar
   - `int` → Int64 scalar
   - `float` → Float64 scalar
   - `bool` → Bool scalar
   - `None` → Null scalar
3. Use ArborBuilder internally

**Tasks:**
- [x] Add `from_dict()` function to `python/src/lib.rs`
- [x] Implement recursive Python-to-Arbor conversion
- [x] Handle type errors gracefully (TypeError for unsupported types)
- [x] Register in module

**Checkpoint:** `make python` ✓

---

#### Step 7: Python bindings - TreeBuilder classes

**Commit:** `feat(python): implement TreeBuilder classes`

**Note:** Python builders use `add_object()`/`end_object()` pattern instead of Rust closures. See section 13.5.1a for the stack-based shared state design.

---

##### 7.1 Current State Analysis

The code in `python/src/lib.rs` lines 4590-5426 is in a **partially broken state**:

**CORRECT (keep as-is):**
- Lines 4598-4613: `BuilderFrame` enum with `Object` and `Array` variants
- Lines 4619-4625: `SharedBuilderState` struct with `stack` and `consumed`
- Lines 4628-4661: `PendingPyValue` enum and `to_expr_result()` method
- Lines 4664-4679: `validate_py_float()` helper function
- Lines 4691-4813: `PyTreeBuilder` with `object()`, `array()`, `scalar()` factory methods
- Lines 4829-4834: `PyObjectBuilder` struct definition (has `state: Rc<RefCell<SharedBuilderState>>`)
- Lines 4836-4858: `PyObjectBuilder` impl block with `check_consumed()` and `add_to_current_object()`
- Lines 5390-5426: `PyScalarBuilder` struct and `build()` method

**BROKEN (must rewrite):**
- Lines 4860-5111: `#[pymethods] impl PyObjectBuilder` - references nonexistent `self.fields` and `BuilderContext`
- Lines 5126-5135: `PyArrayBuilder` struct - uses old design with `elements`, `context`, `consumed` fields
- Lines 5137-5145: `PyArrayBuilder` impl block - uses `self.consumed` instead of `self.state`
- Lines 5147-5380: `#[pymethods] impl PyArrayBuilder` - references nonexistent `self.elements` and `BuilderContext`

---

##### 7.2 Fix Strategy

**Step 7.2.1: Fix PyArrayBuilder struct definition (lines 5126-5135)**

Replace old struct with stack-based design:

```rust
#[pyclass(name = "ArrayBuilder", unsendable)]
#[derive(Clone)]
struct PyArrayBuilder {
    /// Shared state with the entire builder tree.
    state: Rc<RefCell<SharedBuilderState>>,
}
```

**Step 7.2.2: Fix PyArrayBuilder impl block (lines 5137-5145)**

Replace with:

```rust
impl PyArrayBuilder {
    /// Check if builder is consumed and raise error if so.
    fn check_consumed(&self) -> PyResult<()> {
        if self.state.borrow().consumed {
            return Err(PyValueError::new_err("Builder already consumed"));
        }
        Ok(())
    }

    /// Add a value to the current array frame.
    fn add_to_current_array(&self, value: PendingPyValue) -> PyResult<()> {
        let mut state = self.state.borrow_mut();
        match state.stack.last_mut() {
            Some(BuilderFrame::Array { elements, .. }) => {
                elements.push(value);
                Ok(())
            }
            _ => Err(PyValueError::new_err(
                "Internal error: not in array context",
            )),
        }
    }
}
```

**Step 7.2.3: Rewrite PyObjectBuilder #[pymethods] (lines 4860-5111)**

All `add_*` methods should use `self.add_to_current_object()`:

```rust
fn add_string(slf: Py<Self>, py: Python<'_>, key: &str, value: &str) -> PyResult<Py<Self>> {
    let this = slf.borrow(py);
    this.check_consumed()?;
    this.add_to_current_object(key, PendingPyValue::String(value.to_string()))?;
    drop(this);
    Ok(slf)
}
```

`add_object(key)` should push frame and return new builder:

```rust
fn add_object(&self, key: &str) -> PyResult<PyObjectBuilder> {
    self.check_consumed()?;
    self.state.borrow_mut().stack.push(BuilderFrame::Object {
        fields: indexmap::IndexMap::new(),
        parent_key: Some(key.to_string()),
    });
    Ok(PyObjectBuilder { state: Rc::clone(&self.state) })
}
```

`end_object()` should pop, merge, and return parent builder:

```rust
fn end_object(&self, py: Python<'_>) -> PyResult<PyObject> {
    self.check_consumed()?;
    let mut state = self.state.borrow_mut();

    // Must have at least 2 frames (current + parent)
    if state.stack.len() < 2 {
        return Err(PyValueError::new_err("Not inside a nested object"));
    }

    // Pop current frame
    let current = state.stack.pop().unwrap();
    let (fields, parent_key) = match current {
        BuilderFrame::Object { fields, parent_key } => (fields, parent_key),
        _ => return Err(PyValueError::new_err("Not inside a nested object")),
    };

    // Convert to PendingPyValue
    let value = PendingPyValue::Object(fields);

    // Merge into parent based on parent_key
    match state.stack.last_mut() {
        Some(BuilderFrame::Object { fields: parent_fields, .. }) => {
            let key = parent_key.ok_or_else(|| {
                PyValueError::new_err("Internal error: object in object without key")
            })?;
            parent_fields.insert(key, value);
            drop(state);
            Ok(PyObjectBuilder { state: Rc::clone(&self.state) }
                .into_pyobject(py)?.into_any().unbind())
        }
        Some(BuilderFrame::Array { elements, .. }) => {
            elements.push(value);
            drop(state);
            Ok(PyArrayBuilder { state: Rc::clone(&self.state) }
                .into_pyobject(py)?.into_any().unbind())
        }
        None => Err(PyValueError::new_err("Internal error: no parent frame")),
    }
}
```

`build()` should check stack length:

```rust
fn build(&self) -> PyResult<Arbor> {
    self.check_consumed()?;
    let mut state = self.state.borrow_mut();

    // Check for unclosed builders
    if state.stack.len() != 1 {
        return Err(PyValueError::new_err(format!(
            "Unclosed nested builder - stack has {} frames, expected 1",
            state.stack.len()
        )));
    }

    // Mark as consumed
    state.consumed = true;

    // Get root frame
    let root = state.stack.pop().unwrap();
    let fields = match root {
        BuilderFrame::Object { fields, .. } => fields,
        _ => return Err(PyValueError::new_err("Internal error: expected object root")),
    };

    // Convert to ExprResult and build
    let result = PendingPyValue::Object(fields).to_expr_result();
    drop(state);

    let mut builder = arbors_io::ArborBuilder::new_schemaless();
    builder.add_expr_result(&result).map_err(to_py_err)?;
    let arbor = builder.finish();

    Ok(Arbor { inner: arbor, schema: None })
}
```

**Step 7.2.4: Rewrite PyArrayBuilder #[pymethods] (lines 5147-5380)**

Similar pattern to PyObjectBuilder but for array operations.

---

##### 7.3 Tasks

**Phase A: Fix struct definitions and helper methods**
- [x] Fix `PyArrayBuilder` struct to use `state: Rc<RefCell<SharedBuilderState>>`
- [x] Fix `PyArrayBuilder` impl block with `check_consumed()` and `add_to_current_array()`

**Phase B: Rewrite PyObjectBuilder #[pymethods]**
- [x] Rewrite `add_string()` to use `add_to_current_object()`
- [x] Rewrite `add_int()` to use `add_to_current_object()`
- [x] Rewrite `add_float()` to use `add_to_current_object()`
- [x] Rewrite `add_bool()` to use `add_to_current_object()`
- [x] Rewrite `add_null()` to use `add_to_current_object()`
- [x] Rewrite `add_object()` to push frame and return new PyObjectBuilder
- [x] Rewrite `add_array()` to push frame and return PyArrayBuilder
- [x] Rewrite `end_object()` to pop frame, merge to parent, return appropriate builder
- [x] Rewrite `build()` to check stack length == 1, then build

**Phase C: Rewrite PyArrayBuilder #[pymethods]**
- [x] Rewrite `add_string()` to use `add_to_current_array()`
- [x] Rewrite `add_int()` to use `add_to_current_array()`
- [x] Rewrite `add_float()` to use `add_to_current_array()`
- [x] Rewrite `add_bool()` to use `add_to_current_array()`
- [x] Rewrite `add_null()` to use `add_to_current_array()`
- [x] Rewrite `add_object()` to push frame and return PyObjectBuilder
- [x] Rewrite `add_array()` to push frame and return new PyArrayBuilder
- [x] Rewrite `end_array()` to pop frame, merge to parent, return appropriate builder
- [x] Rewrite `build()` to check stack length == 1, then build

**Phase D: Verify**
- [x] Verify `python/arbors/__init__.py` exports are correct
- [x] Run `make python` to verify compilation

**Checkpoint:** `make python` ✓

---

#### Step 8: Update Python stubs and exports

**Commit:** `docs(python): add tree builder stubs and exports`

**Tasks:**
- [x] Add `from_dict()` signature to `python/arbors/_arbors.pyi`
- [x] Add `TreeBuilder`, `ObjectBuilder`, `ArrayBuilder`, `ScalarBuilder` classes to stubs
- [x] Add all new symbols to `python/arbors/__init__.py` `__all__`
- [x] Update `python/api_manifest.toml` with new classes/functions

**Checkpoint:** `make check-stubs && make check-parity` ✓

---

#### Step 9: Python tests

**Commit:** `test(python): add tree construction tests`

**Test file:** `python/tests/test_tree_builder.py`

**Test cases:**
- [x] `test_from_dict_simple_object` - dict with scalars
- [x] `test_from_dict_nested_object` - nested dicts
- [x] `test_from_dict_with_array` - dict containing list
- [x] `test_from_dict_array_root` - list as root
- [x] `test_from_dict_scalar_string` - string as root
- [x] `test_from_dict_scalar_int` - int as root
- [x] `test_from_dict_scalar_float` - float as root
- [x] `test_from_dict_scalar_bool` - bool as root
- [x] `test_from_dict_null` - None as root
- [x] `test_from_dict_deep_nesting` - deeply nested structure
- [x] `test_from_dict_empty_dict` - empty dict
- [x] `test_from_dict_empty_list` - empty list
- [x] `test_from_dict_none_value` - {"key": None} creates null field
- [x] `test_from_dict_type_error` - unsupported type raises TypeError
- [x] `test_from_dict_int_overflow` - int outside i64 range raises OverflowError
- [x] `test_from_dict_float_nan` - NaN raises ValueError
- [x] `test_from_dict_float_inf` - ±infinity raises ValueError
- [x] `test_from_dict_mixed_deep_nesting` - mixed dict/list with empty containers
- [x] `test_builder_object_simple` - TreeBuilder.object() basic usage
- [x] `test_builder_object_nested` - nested object with end_object()
- [x] `test_builder_object_duplicate_keys` - last-wins semantics
- [x] `test_builder_array_simple` - TreeBuilder.array() basic usage
- [x] `test_builder_array_nested` - nested array with end_array()
- [x] `test_builder_scalar_string` - TreeBuilder.scalar("hello")
- [x] `test_builder_scalar_int` - TreeBuilder.scalar(42)
- [x] `test_builder_scalar_float_nan` - NaN raises ValueError
- [x] `test_builder_scalar_float_inf` - ±infinity raises ValueError
- [x] `test_builder_consumed_error` - using builder after build() raises ValueError
- [x] `test_builder_unclosed_object_error` - missing end_object() raises ValueError
- [x] `test_builder_unclosed_array_error` - missing end_array() raises ValueError
- [x] `test_builder_mismatched_end_error` - end_object() in array context raises ValueError (adapted: tests root end calls)
- [x] `test_builder_roundtrip` - built tree to_json matches expected

**Checkpoint:** `make test` ✓

---

#### Step 10: Final verification

**Commit:** `docs(tree_builder): finalize Phase 13.5`

**Tasks:**
- [x] Run full test suite: `cargo test && make test`
- [x] Run parity check: `make check-parity`
- [x] Run stubs check: `make check-stubs`
- [x] Update Phase 13.5 task checkboxes in this plan
- [x] Update status to "Complete"

---

### 13.5.4 Semantic Specification

#### from_dict() Type Mapping

| Python Type | Arbors Type | Notes |
|-------------|-------------|-------|
| `dict` | `Object` | Keys must be strings |
| `list` | `Array` | Elements recursively converted |
| `str` | `String` | UTF-8 encoded |
| `int` | `Int64` | OverflowError if outside i64 range |
| `float` | `Float64` | ValueError if NaN/±inf |
| `bool` | `Bool` | True/False |
| `None` | `Null` | JSON null |
| Other | `TypeError` | Unsupported type |

#### None vs Missing Key

| Python Input | Tree Result |
|--------------|-------------|
| `{"a": None}` | Object with field "a" = Null |
| `{"b": 1}` | Object with field "b" = 1, no "a" field |

#### Duplicate Object Keys

| Scenario | Behavior |
|----------|----------|
| Builder: `add_string("x", "a").add_string("x", "b")` | Result: `{"x": "b"}` (last-wins) |
| from_dict: `{"x": 1, "x": 2}` | Result: `{"x": 2}` (last-wins, per Python dict semantics) |

#### Float Special Values

| Value | Behavior |
|-------|----------|
| Normal float | Accepted |
| NaN | Error: `Error::InvalidFloat` (Rust), `ValueError` (Python) |
| +infinity | Error: `Error::InvalidFloat` (Rust), `ValueError` (Python) |
| -infinity | Error: `Error::InvalidFloat` (Rust), `ValueError` (Python) |

#### Integer Range

| Language | Range | Out-of-range behavior |
|----------|-------|----------------------|
| Rust | i64 (type system enforced) | Compile error |
| Python | i64 range (-2^63 to 2^63-1) | `OverflowError` |

#### Builder Field Ordering

Object fields are stored in **sorted key order** (Arbor invariant), regardless of the order they were added to the builder.

```python
tree = TreeBuilder.object().add_int("z", 1).add_int("a", 2).build()
tree[0].to_json()  # '{"a":2,"z":1}' - sorted, NOT insertion order
```

#### Empty Containers

| Builder Call | Result |
|--------------|--------|
| `TreeBuilder.object().build()` | `{}` |
| `TreeBuilder.array().build()` | `[]` |

#### Builder Consumption (Python)

| Scenario | Behavior |
|----------|----------|
| Call `build()` | Builder marked as consumed |
| Call any method after `build()` | `ValueError("Builder already consumed")` |
| Call `build()` twice | `ValueError("Builder already consumed")` |

#### Unclosed Nested Builders (Python)

| Scenario | Behavior |
|----------|----------|
| `add_object("x").build()` without `end_object()` | `ValueError("Unclosed nested object builder at 'x'")` |
| `add_array("x").build()` without `end_array()` | `ValueError("Unclosed nested array builder at 'x'")` |
| `end_object()` when not in nested object | `ValueError("Not inside a nested object")` |
| `end_array()` when not in nested array | `ValueError("Not inside a nested array")` |

---

### 13.5.5 Deliverables and Checkpoints

**Deliverable:** TreeBuilder API and `from_dict()` function for programmatic tree construction.

| Checkpoint | Verification |
|------------|--------------|
| tree_builder module created | `crates/arbors-io/src/tree_builder.rs` exists |
| ObjectBuilder works | Tests verify object construction with nesting |
| ArrayBuilder works | Tests verify array construction with nesting |
| ScalarBuilder works | Tests verify scalar roots |
| from_dict works | Tests verify Python dict/list/scalar conversion |
| Rust tests pass | `cargo test` succeeds |
| Python builds | `make python` succeeds |
| Python tests pass | `make test` succeeds |
| API parity | `make check-parity` succeeds |
| Stubs correct | `make check-stubs` succeeds |

**Commit after all checkpoints pass.**

---

## Phase 13.6 Collection Operations Enhancement

**Purpose:** Strengthen cross-tree operations as first-class features.

**Status:** Complete

**Scope:** Core operations first (sort_by, unique_by, group_by). Defer sample, partition, take_while, skip_while, and aggregation enhancements to Phase 13.6b.

---

### 13.6.0 Design Decisions

#### Scope Prioritization (DECIDED)

**Core first:** Focus on the most commonly needed collection operations:
1. `sort_by()` - Sort trees by expression result
2. `unique_by()` - Deduplicate trees (first occurrence)
3. `group_by()` - Group trees by expression result

**Deferred to Phase 13.6b:**
- `partition()`, `take_while()`, `skip_while()` - Less common
- `sample()`, `sample_fraction()` - Nice-to-have
- `count_where()`, `distinct_values()`, `value_counts()`, `describe()` - Aggregation helpers

#### Total Order for Comparisons (DECIDED)

**All ExprResult values are totally ordered** for sort, unique, and group operations. This ensures deterministic, reproducible results.

**Type ordering (from lowest to highest):**
1. Null (explicit null and Scalar(Value::Null) treated as equal)
2. Bool (false < true)
3. Int64 and Float64 (compared numerically; see numeric equality below)
4. String (lexicographic)
5. Date, DateTime, Duration (numeric comparison of underlying value)
6. Binary (lexicographic on bytes)
7. Array (element-by-element comparison)
8. Object (compared by sorted key-value pairs)

**Mixed-type comparison:** Values of different types compare by type order above. No error is raised; this enables sorting mixed-type data deterministically.

**NaN handling:** `Float64(NaN)` sorts after all other Float64 values (positive infinity < NaN). This provides a total order without special-casing errors.

**Example:**
```
Sort order: null < false < true < -1 < 0 < 1.0 < 2 < NaN < "a" < "b"
```

#### Numeric Equality for Hashing (DECIDED)

**`1` and `1.0` are treated as the same key** for `unique_by()` and `group_by()`.

**Implementation:** Canonicalize numeric values before hashing/equality:

1. **Small integers (|i| ≤ 2^53):** Both `Int64(i)` and `Float64(i as f64)` hash as `i as f64`.to_bits(). This covers JSON's safe integer range where f64 can exactly represent the integer.

2. **Large integers (|i| > 2^53):** `Int64(i)` hashes as the integer directly (discriminant + i64 bits). These cannot be exactly represented as f64, so they hash differently from any Float64.

3. **Non-integer floats:** `Float64(f)` hashes as `f.to_bits()` (discriminant + f64 bits).

4. **NaN:** All NaN values normalize to a single canonical bit pattern before hashing.

**Equality follows the same rules:** Two values are equal iff they hash the same.

**Rationale:** Users expect `1` and `1.0` to group together. Large integers that can't round-trip through f64 remain distinct from floats, avoiding precision loss surprises.

**Example:**
```rust
// These group together (same canonical key)
{id: 1}
{id: 1.0}

// These are separate groups
{id: 1}
{id: 1.5}
{id: "1"}  // String "1" is different type

// Large integers stay distinct
{id: 9007199254740993}  // 2^53 + 1, can't be exactly represented as f64
{id: 9007199254740993.0}  // Different group (rounds to 9007199254740992.0)
```

#### Composite Types Hashing (DECIDED)

**Arrays and objects use deep canonical hashing** to match the total order comparison:

1. **Arrays:** Hash element-by-element using canonical hashing for each element.

2. **Objects:** Sort keys lexicographically, then hash each (key, value) pair in sorted order. Values use canonical hashing recursively.

**This ensures:** If `total_cmp(a, b) == Equal`, then `canonical_hash(a) == canonical_hash(b)` and `canonical_eq(a, b) == true`.

**Performance note:** Deep comparison/hashing of large nested arrays/objects can be expensive. For large payloads, consider using a scalar key (like an ID field) rather than grouping by entire objects.

#### Argument Validation (DECIDED)

**Strict validation with clear errors:**

| Condition | Behavior |
|-----------|----------|
| `by` is empty | `ValueError`: "sort_by/unique_by requires at least one expression" |
| `descending` length != `by` length | `ValueError`: "descending length must match by length" |
| Single `descending: bool` for multi-key | Allowed (broadcast to all keys) |
| Expression evaluation fails | `ArborsError` with path/type info |
| Path not found | `PathNotFoundError` |
| Type mismatch in expression | `TypeMismatchError` |

**Python convenience:** When `by` is a single `Expr`, it's automatically wrapped as `[by]`. When `descending` is a single `bool`, it's broadcast to all keys.

#### Where to Implement

1. **Core operations** → `crates/arbors-query/src/collection_ops.rs` (new file)
   - Evaluates sort keys, builds index mappings
   - Works with `Arbor` + expression evaluation
   - Returns permuted/grouped results

2. **Lazy operations** → `crates/arbors-lazy/src/lazy.rs` and `plan.rs`
   - Add `QueryOp` variants for new operations
   - Implement execution in `execute.rs`

3. **Python bindings** → `python/src/lib.rs`
   - Expose on both `Arbor` and `LazyArbor` classes
   - `GroupedArbor` class for group_by results

#### group_by Return Type (DECIDED)

**GroupedArbor class** - Custom class with ergonomic methods. More discoverable than a raw dict, preserves insertion order.

```python
class GroupedArbor:
    """Result of group_by() operation.

    Groups are stored in the order they were first encountered.
    """

    def keys(self) -> list[Any]:
        """Get all group keys in encounter order."""

    def get_group(self, key: Any) -> Arbor:
        """Get the Arbor for a specific group key.

        Raises KeyError if key doesn't exist.
        """

    def __getitem__(self, key: Any) -> Arbor:
        """Alias for get_group()."""

    def __iter__(self) -> Iterator[tuple[Any, Arbor]]:
        """Iterate over (key, arbor) pairs in encounter order."""

    def __len__(self) -> int:
        """Number of groups."""

    def __contains__(self, key: Any) -> bool:
        """Check if a key exists."""
```

#### sort_by Semantics (DECIDED)

**Stable sort:** When sort keys are equal, original order is preserved. This matches Python's `sorted()` behavior and enables reproducible results.

**Multiple sort keys:** Support a list of expressions with corresponding descending flags:
```rust
arbor.sort_by(&[age_expr, name_expr], &[false, true])  // Age ascending, name descending
```

**Null handling:** Nulls follow the sort direction:
- **Ascending:** Nulls sort first (smallest)
- **Descending:** Nulls sort first (appear at top since they're "smallest" and we're reversing)

This matches the type order where null is the "smallest" value. Nulls are always grouped together at one end.

**Stability with incomparable values:** Since we define a total order (see above), all values are comparable. The stable sort guarantee holds for all inputs.

#### unique_by Semantics (DECIDED)

**First occurrence:** When multiple trees have the same key, keep the first one encountered.

```rust
// Input: [{id: 1, name: "A"}, {id: 2, name: "B"}, {id: 1, name: "C"}]
arbor.unique_by(path("id"))
// Output: [{id: 1, name: "A"}, {id: 2, name: "B"}]  // "C" dropped (duplicate id)
```

**Null handling:** Null is treated as a distinct key (one null-keyed tree kept).

**Numeric equality:** `1` and `1.0` are considered the same key (see Numeric Equality for Hashing above).

**NaN handling:** All NaN values are considered equal (one NaN-keyed tree kept).

#### Eager vs Lazy Consistency

`sort_by` and `unique_by` work both eagerly (`Arbor` methods) and lazily (`LazyArbor` methods):

```python
# Eager
sorted_arbor = arbor.sort_by(path("age"))

# Lazy
sorted_arbor = arbor.lazy().sort_by(path("age")).collect()
```

The existing `QueryOp::Sort` stub will be implemented in this phase.

**group_by is EAGER ONLY:** `group_by()` must materialize immediately because it returns multiple Arbors (one per group). It cannot be part of a lazy plan.

```python
# This is eager - executes immediately
groups = arbor.group_by(path("category"))  # Returns GroupedArbor

# LazyArbor does NOT have group_by()
# lazy.group_by(...)  # NOT AVAILABLE
```

**Rationale:** Lazy evaluation produces a single Arbor. Grouping produces multiple Arbors, which fundamentally doesn't fit the lazy model. Users who want lazy-then-group should `collect()` first.

#### Memory Characteristics

**Performance note:** All collection operations evaluate expressions for each tree and may store intermediate data:
- `sort_by`: Stores sort keys for all trees (O(n) memory where n = num_trees)
- `unique_by`: Stores one key per unique group (O(k) memory where k = unique keys)
- `group_by`: Stores all tree indices grouped by key (O(n) memory)

For very large arbors, consider filtering first to reduce the working set.

---

### 13.6.1 API Design

#### Rust API (in `arbors-query`)

```rust
/// Collection operations for Arbor.
/// Located in crates/arbors-query/src/collection_ops.rs

use arbors_expr::{Expr, ExprError};
use arbors_storage::Arbor;
use indexmap::IndexMap;

/// Sort trees by expression results.
///
/// Uses stable sort - equal elements maintain original relative order.
/// Null is the "smallest" value in the type order.
///
/// # Arguments
/// * `arbor` - The arbor to sort
/// * `by` - Expressions to sort by (evaluated for each tree)
/// * `descending` - Whether each key should be sorted descending
///
/// # Returns
/// A new Arbor with trees in sorted order.
///
/// # Type Order
/// Values are compared by type order: null < bool < number < string < date/datetime/duration < binary < array < object.
/// Within numbers, Int64 and Float64 are compared numerically (1 == 1.0).
/// NaN sorts after all other float values.
///
/// # Null Handling
/// Nulls follow sort direction (ascending: nulls first; descending: nulls first after reversal).
///
/// # Errors
/// - Returns error if `by` is empty
/// - Returns error if `descending.len() != by.len()`
/// - Returns error if expression evaluation fails
pub fn sort_by(
    arbor: &Arbor,
    by: &[Expr],
    descending: &[bool],
) -> Result<Arbor, ExprError>;

/// Deduplicate trees by expression result.
///
/// Keeps the first occurrence of each unique key.
///
/// # Arguments
/// * `arbor` - The arbor to deduplicate
/// * `by` - Expression to determine uniqueness
///
/// # Returns
/// A new Arbor with duplicate trees removed.
///
/// # Key Equality
/// Keys use canonical equality: 1 and 1.0 are the same key.
/// NaN values are all considered equal (one NaN-keyed tree kept).
/// Null is a distinct key (one null-keyed tree kept).
pub fn unique_by(arbor: &Arbor, by: &Expr) -> Result<Arbor, ExprError>;

/// Group trees by expression result.
///
/// Returns groups in the order keys were first encountered.
/// This is an EAGER operation - it executes immediately (not lazy).
///
/// # Arguments
/// * `arbor` - The arbor to group
/// * `by` - Expression to determine group key
///
/// # Returns
/// An IndexMap mapping keys to Arbors (preserves encounter order).
///
/// # Key Equality
/// Keys use canonical equality: 1 and 1.0 group together.
/// NaN values all group together.
/// Null is a distinct key (trees with null keys form one group).
pub fn group_by(
    arbor: &Arbor,
    by: &Expr,
) -> Result<IndexMap<ExprResult, Arbor>, ExprError>;
```

#### Python API (Arbor class additions)

```python
class Arbor:
    # === New Collection Operations ===

    def sort_by(
        self,
        by: Expr | list[Expr],
        descending: bool | list[bool] = False,
    ) -> Arbor:
        """Sort trees by expression result(s).

        Uses stable sort - equal elements maintain original relative order.

        Type order: null < bool < number < string < date/datetime < binary < array < object.
        Numbers compare numerically (1 == 1.0). NaN sorts after all other floats.
        Nulls are smallest, so ascending puts nulls first; descending puts nulls last.

        Args:
            by: Expression(s) to sort by. If a list, sorts by first key,
                then by second key for ties, etc. Must not be empty.
            descending: Whether to sort descending. If a bool, applies to
                all keys. If a list, must match length of `by`.

        Returns:
            New Arbor with trees in sorted order

        Raises:
            ValueError: If `by` is empty or `descending` length doesn't match `by`
            ArborsError: If expression evaluation fails

        Example:
            >>> # Sort by age ascending (nulls first)
            >>> sorted_arbor = arbor.sort_by(path("age"))

            >>> # Sort by age descending (nulls last)
            >>> sorted_arbor = arbor.sort_by(path("age"), descending=True)

            >>> # Multi-key sort: age ascending, then name descending
            >>> sorted_arbor = arbor.sort_by(
            ...     [path("age"), path("name")],
            ...     [False, True]
            ... )
        """
        ...

    def unique_by(self, by: Expr) -> Arbor:
        """Deduplicate trees by expression result.

        Keeps the first occurrence of each unique key.

        Key equality: 1 and 1.0 are the same key (numeric canonicalization).
        NaN values are all considered equal.
        Null is a distinct key (one null-keyed tree kept).

        Args:
            by: Expression to determine uniqueness

        Returns:
            New Arbor with duplicate trees removed

        Raises:
            ArborsError: If expression evaluation fails

        Example:
            >>> # Keep one tree per unique id
            >>> unique = arbor.unique_by(path("id"))

            >>> # Deduplicate by computed key
            >>> unique = arbor.unique_by(path("user.email").str.lower())

            >>> # 1 and 1.0 are the same key
            >>> # [{id: 1}, {id: 1.0}].unique_by(path("id")) -> [{id: 1}]
        """
        ...

    def group_by(self, by: Expr) -> GroupedArbor:
        """Group trees by expression result.

        Returns groups in the order keys were first encountered.
        This is an EAGER operation - executes immediately (not available on LazyArbor).

        Key equality: 1 and 1.0 group together (numeric canonicalization).
        NaN values all group together.
        Null is a distinct key (trees with null keys form one group).

        Args:
            by: Expression to determine group key

        Returns:
            GroupedArbor containing the groups

        Raises:
            ArborsError: If expression evaluation fails

        Example:
            >>> groups = arbor.group_by(path("category"))
            >>> for key, group_arbor in groups:
            ...     print(f"{key}: {len(group_arbor)} trees")

            >>> # Access specific group
            >>> electronics = groups["electronics"]

            >>> # For lazy workflows, collect first then group
            >>> groups = arbor.lazy().filter(active).collect().group_by(path("cat"))
        """
        ...
```

#### Python API (LazyArbor additions)

```python
class LazyArbor:
    # === New Lazy Collection Operations ===

    def sort_by(
        self,
        by: Expr | list[Expr],
        descending: bool | list[bool] = False,
    ) -> LazyArbor:
        """Add a sort operation to the plan.

        Uses stable sort. Nulls are smallest (ascending: first; descending: last).

        Args:
            by: Expression(s) to sort by. Must not be empty.
            descending: Whether to sort descending. If a bool, applies to all keys.
                If a list, must match length of `by`.

        Returns:
            LazyArbor with sort operation added

        Raises:
            ValueError: If `by` is empty or `descending` length doesn't match `by`

        Example:
            >>> result = arbor.lazy().filter(path("active")).sort_by(path("age")).collect()
        """
        ...

    def unique_by(self, by: Expr) -> LazyArbor:
        """Add a unique_by operation to the plan.

        Keeps first occurrence of each unique key.

        Args:
            by: Expression to determine uniqueness

        Returns:
            LazyArbor with unique_by operation added
        """
        ...

    # Note: group_by is NOT lazy - it must materialize groups immediately
```

#### Python API (GroupedArbor class)

```python
@final
class GroupedArbor:
    """Result of group_by() operation.

    Groups are stored in the order keys were first encountered.
    Provides dict-like access to individual groups.

    Example:
        >>> groups = arbor.group_by(path("category"))
        >>> len(groups)  # Number of groups
        3
        >>> groups.keys()  # All group keys
        ['electronics', 'clothing', 'food']
        >>> groups["electronics"]  # Get specific group
        <Arbor: 42 trees>
        >>> for key, arbor in groups:
        ...     print(f"{key}: {len(arbor)} trees")
    """

    def keys(self) -> list[Any]:
        """Get all group keys in encounter order.

        Returns:
            List of group keys (may include None for null-keyed trees)
        """
        ...

    def get_group(self, key: Any) -> Arbor:
        """Get the Arbor for a specific group key.

        Args:
            key: The group key

        Returns:
            Arbor containing trees in that group

        Raises:
            KeyError: If key doesn't exist
        """
        ...

    def __getitem__(self, key: Any) -> Arbor:
        """Get the Arbor for a specific group key.

        Same as get_group(key).

        Raises:
            KeyError: If key doesn't exist
        """
        ...

    def __iter__(self) -> Iterator[tuple[Any, Arbor]]:
        """Iterate over (key, arbor) pairs in encounter order."""
        ...

    def __len__(self) -> int:
        """Return the number of groups."""
        ...

    def __contains__(self, key: Any) -> bool:
        """Check if a key exists in the groups."""
        ...

    def __repr__(self) -> str:
        """Return string representation."""
        ...
```

---

### 13.6.2 Definitive Symbol Inventory

#### New Files to Create

| File | Purpose |
|------|---------|
| `crates/arbors-query/src/collection_ops.rs` | Core collection operation implementations |

#### Symbols to Add

**In `crates/arbors-query/src/collection_ops.rs` (new):**

| Symbol | Type | Description |
|--------|------|-------------|
| `sort_by()` | function | Sort trees by expression results |
| `unique_by()` | function | Deduplicate trees by expression |
| `group_by()` | function | Group trees by expression |
| `SortKey` | struct | Wrapper for sortable expression results |

**In `crates/arbors-query/src/lib.rs`:**

| Symbol | Type | Description |
|--------|------|-------------|
| `pub mod collection_ops` | module | Re-export collection operations |
| `pub use collection_ops::*` | re-export | Public API |

**In `crates/arbors-lazy/src/plan.rs` (modify existing):**

| Symbol | Type | Description |
|--------|------|-------------|
| `QueryOp::UniqueBy { by: Expr }` | enum variant | Deduplicate operation |

**Note:** `QueryOp::Sort` already exists but is not implemented. We'll implement it.

**In `crates/arbors-lazy/src/lazy.rs` (modify existing):**

| Symbol | Type | Description |
|--------|------|-------------|
| `sort_by()` | method | Add sort to lazy plan |
| `unique_by()` | method | Add unique_by to lazy plan |

**In `python/src/lib.rs`:**

| Symbol | Type | PyO3 name | Description |
|--------|------|-----------|-------------|
| `GroupedArbor` | struct | `GroupedArbor` | Group result container |
| `Arbor::sort_by()` | method | `sort_by` | Eager sort |
| `Arbor::unique_by()` | method | `unique_by` | Eager deduplicate |
| `Arbor::group_by()` | method | `group_by` | Eager group |
| `LazyArbor::sort_by()` | method | `sort_by` | Lazy sort |
| `LazyArbor::unique_by()` | method | `unique_by` | Lazy deduplicate |

**In `python/arbors/_arbors.pyi`:**

| Symbol | Type | Description |
|--------|------|-------------|
| `GroupedArbor` class | class | Type stub for grouped result |
| `Arbor.sort_by()` | method | |
| `Arbor.unique_by()` | method | |
| `Arbor.group_by()` | method | |
| `LazyArbor.sort_by()` | method | |
| `LazyArbor.unique_by()` | method | |

**In `python/api_manifest.toml`:**

| Symbol | Category | Description |
|--------|----------|-------------|
| `GroupedArbor` | class | Grouped arbor result |

---

### 13.6.3 Execution Steps

**Strategy:** Build from core algorithms up. Implement Rust first, then lazy variants, then Python bindings.

---

#### Step 1: Create collection_ops module with sort_by

**Commit:** `feat(query): add collection_ops module with sort_by`

**Algorithm for sort_by:**
1. Validate: `by` not empty, `descending.len() == by.len()`
2. Evaluate sort expressions for each tree
3. Create vector of `(tree_index, sort_keys)` tuples
4. Use stable sort with total order comparator
5. Use `Arbor::filter_by_indices()` to create result with new order

```rust
/// Sortable key wrapper with total ordering
struct SortKey {
    values: Vec<ExprResult>,
    descending: Vec<bool>,
}

impl Ord for SortKey {
    fn cmp(&self, other: &Self) -> Ordering {
        for (i, (a, b)) in self.values.iter().zip(&other.values).enumerate() {
            let ord = total_cmp_expr_results(a, b);
            if ord != Ordering::Equal {
                return if self.descending[i] { ord.reverse() } else { ord };
            }
        }
        Ordering::Equal
    }
}

/// Total order comparison for ExprResults.
/// Type order: Null < Bool < Int64/Float64 < String < Date < DateTime < Duration < Binary < Array < Object
/// Numbers compare numerically (1 == 1.0). NaN > all other floats.
fn total_cmp_expr_results(a: &ExprResult, b: &ExprResult) -> Ordering {
    let type_ord_a = type_order(a);
    let type_ord_b = type_order(b);

    if type_ord_a != type_ord_b {
        return type_ord_a.cmp(&type_ord_b);
    }

    // Same type category - compare values
    match (a, b) {
        (ExprResult::Null, ExprResult::Null) => Ordering::Equal,
        (ExprResult::Scalar(Value::Null), ExprResult::Scalar(Value::Null)) => Ordering::Equal,
        (ExprResult::Scalar(Value::Bool(x)), ExprResult::Scalar(Value::Bool(y))) => x.cmp(y),
        // Numeric comparison with NaN handling
        (ExprResult::Scalar(va), ExprResult::Scalar(vb)) if is_numeric(va) && is_numeric(vb) => {
            total_cmp_numeric(va, vb)
        }
        // ... other type-specific comparisons
        _ => Ordering::Equal, // Fallback for complex types
    }
}

/// Returns 0-8 for type ordering
fn type_order(e: &ExprResult) -> u8 { ... }

/// Numeric comparison: converts to f64, handles NaN
fn total_cmp_numeric(a: &Value, b: &Value) -> Ordering {
    let fa = to_f64(a);
    let fb = to_f64(b);
    // NaN sorts after all other values
    match (fa.is_nan(), fb.is_nan()) {
        (true, true) => Ordering::Equal,
        (true, false) => Ordering::Greater,
        (false, true) => Ordering::Less,
        (false, false) => fa.partial_cmp(&fb).unwrap_or(Ordering::Equal),
    }
}
```

**Tasks:**
- [x] Create `crates/arbors-query/src/collection_ops.rs`
- [x] Add `pub mod collection_ops;` to `crates/arbors-query/src/lib.rs`
- [x] Implement `type_order()` helper for type ranking
- [x] Implement `total_cmp_numeric()` with NaN handling
- [x] Implement `total_cmp_expr_results()` for full total order
- [x] Implement `SortKey` struct with `Ord` trait
- [x] Implement `sort_by()` function with validation
- [x] Add unit tests for sort_by

**Checkpoint:** `cargo test -p arbors-query` ✓

---

#### Step 2: Implement unique_by

**Commit:** `feat(query): implement unique_by`

**Algorithm for unique_by:**
1. Evaluate expression for each tree
2. Wrap keys in `CanonicalKey` for proper equality (1 == 1.0, NaN == NaN)
3. Build `IndexMap<CanonicalKey, usize>` (key → first tree index)
4. Collect indices in encounter order
5. Use `Arbor::filter_by_indices()` to create result

```rust
/// Wrapper for ExprResult with canonical equality and hashing.
/// - Int64 and Float64 with same numeric value are equal (1 == 1.0)
/// - All NaN values are equal
/// - Null variants are equal
#[derive(Clone)]
struct CanonicalKey(ExprResult);

impl PartialEq for CanonicalKey {
    fn eq(&self, other: &Self) -> bool {
        canonical_eq(&self.0, &other.0)
    }
}
impl Eq for CanonicalKey {}

impl Hash for CanonicalKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        canonical_hash(&self.0, state);
    }
}

/// Canonical equality: 1 == 1.0, NaN == NaN
fn canonical_eq(a: &ExprResult, b: &ExprResult) -> bool {
    match (a, b) {
        (ExprResult::Scalar(va), ExprResult::Scalar(vb)) if is_numeric(va) && is_numeric(vb) => {
            let fa = to_f64(va);
            let fb = to_f64(vb);
            if fa.is_nan() && fb.is_nan() { return true; }
            fa == fb
        }
        // ... other cases use structural equality
        _ => a == b,
    }
}

/// Canonical hash: small integers and equivalent floats hash the same
fn canonical_hash<H: Hasher>(e: &ExprResult, state: &mut H) {
    match e {
        ExprResult::Scalar(Value::Int64(i)) => {
            let abs_i = i.unsigned_abs();
            if abs_i <= (1u64 << 53) {
                // Small int: hash as f64 bits (matches equivalent Float64)
                0u8.hash(state); // numeric discriminant
                (*i as f64).to_bits().hash(state);
            } else {
                // Large int: hash as int (can't round-trip through f64)
                1u8.hash(state); // large-int discriminant
                i.hash(state);
            }
        }
        ExprResult::Scalar(Value::Float64(f)) => {
            0u8.hash(state); // numeric discriminant
            if f.is_nan() {
                u64::MAX.hash(state); // canonical NaN bits
            } else {
                f.to_bits().hash(state);
            }
        }
        ExprResult::Array(arr) => {
            2u8.hash(state);
            arr.len().hash(state);
            for elem in arr {
                canonical_hash(elem, state);
            }
        }
        ExprResult::Object(obj) => {
            3u8.hash(state);
            obj.len().hash(state);
            // Sort keys for consistent hashing
            let mut keys: Vec<_> = obj.keys().collect();
            keys.sort();
            for key in keys {
                key.hash(state);
                canonical_hash(&obj[key], state);
            }
        }
        // ... other cases (Null, String, etc.)
        _ => e.hash(state),
    }
}

pub fn unique_by(arbor: &Arbor, by: &Expr) -> Result<Arbor, ExprError> {
    let mut seen: IndexMap<CanonicalKey, usize> = IndexMap::new();

    for tree_idx in 0..arbor.num_trees() {
        let ctx = EvalContext::for_tree(arbor, tree_idx);
        let key = CanonicalKey(eval_expr(by, &ctx)?);
        seen.entry(key).or_insert(tree_idx);
    }

    let indices: Vec<usize> = seen.into_values().collect();
    Ok(arbor.filter_by_indices(&indices))
}
```

**Tasks:**
- [x] Implement `CanonicalKey` wrapper with `Eq` and `Hash`
- [x] Implement `canonical_eq()` for numeric equality
- [x] Implement `canonical_hash()` for numeric hashing
- [x] Implement `unique_by()` function
- [x] Add unit tests for unique_by
- [x] Test null key handling
- [x] Test first-occurrence semantics
- [x] Test 1 == 1.0 behavior
- [x] Test NaN == NaN behavior

**Checkpoint:** `cargo test -p arbors-query` ✓

---

#### Step 3: Implement group_by

**Commit:** `feat(query): implement group_by`

**Algorithm for group_by:**
1. Evaluate expression for each tree
2. Wrap keys in `CanonicalKey` for proper equality (1 == 1.0, NaN == NaN)
3. Build `IndexMap<CanonicalKey, (ExprResult, Vec<usize>)>` (stores original key for output)
4. Convert each group's indices to an Arbor via `filter_by_indices()`
5. Return `IndexMap<ExprResult, Arbor>` preserving encounter order

```rust
pub fn group_by(
    arbor: &Arbor,
    by: &Expr,
) -> Result<IndexMap<ExprResult, Arbor>, ExprError> {
    // Use CanonicalKey for proper grouping, but store original ExprResult for output
    let mut groups: IndexMap<CanonicalKey, (ExprResult, Vec<usize>)> = IndexMap::new();

    for tree_idx in 0..arbor.num_trees() {
        let ctx = EvalContext::for_tree(arbor, tree_idx);
        let key = eval_expr(by, &ctx)?;
        let canonical = CanonicalKey(key.clone());

        groups
            .entry(canonical)
            .or_insert_with(|| (key, Vec::new()))
            .1
            .push(tree_idx);
    }

    // Convert to output format, preserving encounter order
    let result: IndexMap<ExprResult, Arbor> = groups
        .into_values()
        .map(|(key, indices)| (key, arbor.filter_by_indices(&indices)))
        .collect();

    Ok(result)
}
```

**Note:** `group_by` uses `CanonicalKey` internally for grouping but returns `ExprResult` keys. The first-encountered key value is used for each group (e.g., if `1` is seen before `1.0`, the group key is `1`).

**Tasks:**
- [x] Implement `group_by()` function using `CanonicalKey`
- [x] Add unit tests for group_by
- [x] Test null key grouping
- [x] Test encounter order preservation
- [x] Test 1 and 1.0 group together
- [x] Test NaN values group together

**Note:** The return type is `Vec<(ExprResult, Arbor)>` rather than `IndexMap<ExprResult, Arbor>` because `ExprResult` doesn't implement `Hash` or `Eq` (due to containing `f64` which has NaN). The Vec preserves encounter order and allows lookup via linear scan.

**Checkpoint:** `cargo test -p arbors-query` ✓

---

#### Step 4: Add Rust tests

**Commit:** `test(query): add collection_ops tests`

**Test file:** Tests added to `crates/arbors-query/tests/integration.rs` (consolidated with existing tests)

**Test cases:**

**sort_by tests:**
- [x] `test_sort_by_single_key` - sort by one expression
- [x] `test_sort_by_descending` - descending sort
- [x] `test_sort_by_multiple_keys` - multi-key sort
- [x] `test_sort_by_stable` - equal keys maintain original order
- [x] `test_sort_by_nulls_first_ascending` - null values sort first when ascending
- [x] `test_sort_by_nulls_last_descending` - null values sort last when descending
- [x] `test_sort_by_empty_arbor` - empty arbor returns empty
- [x] `test_sort_by_single_tree` - one tree unchanged
- [x] `test_sort_by_mixed_types` - different types sort by type order
- [x] `test_sort_by_nan_after_floats` - NaN sorts after all other floats
- [x] `test_sort_by_numeric_equality` - 1 and 1.0 compare equal (stable tie)
- [x] `test_sort_by_empty_by_error` - error if `by` is empty
- [x] `test_sort_by_length_mismatch_error` - error if `descending.len() != by.len()`

**unique_by tests:**
- [x] `test_unique_by_simple` - basic deduplication
- [x] `test_unique_by_first_occurrence` - first occurrence kept
- [x] `test_unique_by_null_key` - null treated as distinct key
- [x] `test_unique_by_all_unique` - no changes if all unique
- [x] `test_unique_by_all_same` - all same key → one tree
- [x] `test_unique_by_empty_arbor` - empty returns empty
- [x] `test_unique_by_int_float_equal` - 1 and 1.0 are same key
- [x] `test_unique_by_nan_equal` - all NaN values are same key
- [x] `test_unique_by_mixed_types` - different types are different keys
- [x] `test_unique_by_large_int_distinct` - large int (>2^53) distinct from float

**group_by tests:**
- [x] `test_group_by_simple` - basic grouping
- [x] `test_group_by_encounter_order` - encounter order preserved
- [x] `test_group_by_null_key` - null-keyed trees grouped together
- [x] `test_group_by_single_group` - all trees same key
- [x] `test_group_by_all_unique` - each tree its own group
- [x] `test_group_by_empty_arbor` - empty returns empty groups
- [x] `test_group_by_int_float_equal` - 1 and 1.0 group together
- [x] `test_group_by_nan_equal` - all NaN values group together
- [x] `test_group_by_first_key_value` - group key is first-encountered value
- [x] `test_group_by_large_int_distinct` - large int (>2^53) separate from float
- [x] `test_group_by_array_deep_equal` - arrays with same elements group together
- [x] `test_group_by_object_deep_equal` - objects with same fields group together

**Checkpoint:** `cargo test` ✓

---

#### Step 5: Implement lazy Sort execution

**Commit:** `feat(lazy): implement Sort execution`

**The `QueryOp::Sort` variant already exists in plan.rs but returns "not implemented" error. Implement it.**

**Modify `crates/arbors-lazy/src/execute.rs`:**

```rust
QueryOp::Sort { by, descending } => {
    collection_ops::sort_by(arbor, by, descending)
}
```

**Tasks:**
- [x] Update execute.rs to call `collection_ops::sort_by()`
- [x] Add `use arbors_query::collection_ops;` import (not needed - used full path `arbors_query::sort_by`)
- [x] Remove "not implemented" error for Sort
- [x] Test lazy sort execution

**Checkpoint:** `cargo test -p arbors-lazy` ✓

---

#### Step 6: Add UniqueBy to lazy plan

**Commit:** `feat(lazy): add UniqueBy operation`

**Modify `crates/arbors-lazy/src/plan.rs`:**
- Add `QueryOp::UniqueBy { by: Expr }` variant
- Add exec_context (Global - must see all trees)
- Add description and display

**Modify `crates/arbors-lazy/src/lazy.rs`:**
- Add `unique_by()` method

**Modify `crates/arbors-lazy/src/execute.rs`:**
- Add execution for UniqueBy

**Tasks:**
- [x] Add `QueryOp::UniqueBy` enum variant
- [x] Implement `exec_context()` for UniqueBy (Global)
- [x] Implement `description()` for UniqueBy
- [x] Implement `Display` for UniqueBy
- [x] Add `LazyArbor::unique_by()` method
- [x] Implement `execute_unique_by()` in execute.rs
- [x] Add lazy unique_by tests

**Checkpoint:** `cargo test -p arbors-lazy` ✓

---

#### Step 7: Python bindings for Arbor

**Commit:** `feat(python): add collection operations to Arbor`

**Add to `python/src/lib.rs` (Arbor impl):**

**Tasks:**
- [x] Implement `Arbor::sort_by()` method
- [x] Implement `Arbor::unique_by()` method
- [x] Implement `Arbor::group_by()` method
- [x] Handle Python list/bool arguments for sort_by
- [x] Add proper error handling

**Checkpoint:** `make python` ✓

---

#### Step 8: Python GroupedArbor class

**Commit:** `feat(python): add GroupedArbor class`

**Create `GroupedArbor` struct in `python/src/lib.rs`:**

```rust
#[pyclass]
pub struct GroupedArbor {
    // Store CanonicalKey for lookups, ExprResult for display, Arbor for data
    groups: IndexMap<CanonicalKey, (ExprResult, Py<Arbor>)>,
}

#[pymethods]
impl GroupedArbor {
    fn keys(&self, py: Python<'_>) -> PyResult<Vec<PyObject>> { ... }
    fn get_group(&self, py: Python<'_>, key: PyObject) -> PyResult<Py<Arbor>> { ... }
    fn __getitem__(&self, py: Python<'_>, key: PyObject) -> PyResult<Py<Arbor>> { ... }
    fn __iter__(slf: PyRef<'_, Self>) -> PyResult<GroupedArborIter> { ... }
    fn __len__(&self) -> usize { ... }
    fn __contains__(&self, py: Python<'_>, key: PyObject) -> PyResult<bool> { ... }
    fn __repr__(&self) -> String { ... }
}
```

**Python Key Conversion:**

To ensure dict-like access works with canonical equality (e.g., `groups[1]` finds `groups[1.0]`):

1. **ExprResult → PyObject:** Convert to Python types (int, float, str, None, list, dict).
   - `Int64(i)` → Python `int`
   - `Float64(f)` → Python `float` (NaN → `float('nan')`)
   - `Null` → Python `None`

2. **PyObject → CanonicalKey (for lookups):** When user calls `groups[key]`:
   - Python `int` → `CanonicalKey(ExprResult::Scalar(Value::Int64(i)))`
   - Python `float` → `CanonicalKey(ExprResult::Scalar(Value::Float64(f)))`
   - The canonical lookup matches how keys were stored

3. **Canonical matching:** `groups[1]` and `groups[1.0]` both find the same group because both convert to equivalent `CanonicalKey`.

**Tasks:**
- [x] Create `GroupedArbor` struct with `CanonicalKey` for lookups
- [x] Implement `expr_result_to_pyobject()` conversion
- [x] Implement `pyobject_to_canonical_key()` conversion for lookups
- [x] Implement `keys()` method (returns original ExprResult as PyObject)
- [x] Implement `get_group()` method with canonical lookup
- [x] Implement `__getitem__()` method with canonical lookup
- [x] Implement `__iter__()` with `GroupedArborIter`
- [x] Implement `__len__()` method
- [x] Implement `__contains__()` method with canonical lookup
- [x] Implement `__repr__()` method
- [x] Register `GroupedArbor` in module
- [x] Test that `groups[1]` == `groups[1.0]`

**Checkpoint:** `make python` ✓

---

#### Step 9: Python bindings for LazyArbor

**Commit:** `feat(python): add collection operations to LazyArbor`

**Add to `python/src/lib.rs` (LazyArbor impl):**

**Tasks:**
- [x] Implement `LazyArbor::sort_by()` method
- [x] Implement `LazyArbor::unique_by()` method
- [x] Handle Python list/bool arguments for sort_by

**Note:** `group_by` is NOT lazy - it must materialize immediately.

**Checkpoint:** `make python` ✓

---

#### Step 10: Update Python stubs

**Commit:** `docs(python): add collection operation stubs`

**Update `python/arbors/_arbors.pyi`:**

**Tasks:**
- [x] Add `GroupedArbor` class with all methods
- [x] Add `Arbor.sort_by()` method signature
- [x] Add `Arbor.unique_by()` method signature
- [x] Add `Arbor.group_by()` method signature
- [x] Add `LazyArbor.sort_by()` method signature
- [x] Add `LazyArbor.unique_by()` method signature

**Update `python/api_manifest.toml`:**

**Tasks:**
- [x] Add `GroupedArbor = "class"`

**Checkpoint:** `make check-stubs && make check-parity` ✓

---

#### Step 11: Python tests

**Commit:** `test(python): add collection operation tests`

**Add to `python/tests/test_collection_ops.py` (new):**

**Test cases:**

**sort_by tests:**
- [x] `test_sort_by_single_key` - sort by one expression
- [x] `test_sort_by_descending` - descending sort
- [x] `test_sort_by_multiple_keys` - multi-key sort
- [x] `test_sort_by_stable` - equal keys maintain original order
- [x] `test_sort_by_nulls_first_ascending` - nulls first when ascending
- [x] `test_sort_by_nulls_last_descending` - nulls last when descending
- [x] `test_sort_by_empty` - empty arbor returns empty
- [x] `test_sort_by_list_convenience` - passing list of exprs
- [x] `test_sort_by_bool_broadcast` - single bool descending for multi-key
- [x] `test_sort_by_mixed_types` - different types sort by type order
- [x] `test_sort_by_nan_after_floats` - NaN sorts after other floats (skipped - NaN not JSON-compatible, tested at Rust level)
- [x] `test_sort_by_numeric_equality` - 1 and 1.0 compare equal
- [x] `test_sort_by_empty_by_error` - ValueError if by is empty
- [x] `test_sort_by_length_mismatch_error` - ValueError if lengths differ

**unique_by tests:**
- [x] `test_unique_by_simple` - basic deduplication
- [x] `test_unique_by_first_occurrence` - first occurrence kept
- [x] `test_unique_by_null_key` - null treated as distinct key
- [x] `test_unique_by_empty` - empty returns empty
- [x] `test_unique_by_int_float_equal` - 1 and 1.0 are same key
- [x] `test_unique_by_nan_equal` - all NaN values are same key (skipped - NaN not JSON-compatible, tested at Rust level)

**group_by tests:**
- [x] `test_group_by_simple` - basic grouping
- [x] `test_group_by_order` - encounter order preserved
- [x] `test_group_by_null_key` - null-keyed trees grouped
- [x] `test_group_by_iteration` - iter over groups
- [x] `test_group_by_keys` - keys() method
- [x] `test_group_by_getitem` - __getitem__ access
- [x] `test_group_by_contains` - __contains__ check
- [x] `test_group_by_len` - __len__ count
- [x] `test_group_by_missing_key` - KeyError for missing key
- [x] `test_group_by_int_float_equal` - 1 and 1.0 group together
- [x] `test_group_by_nan_equal` - all NaN values group together (skipped - NaN not JSON-compatible, tested at Rust level)
- [x] `test_group_by_first_key_value` - group key is first-encountered value
- [x] `test_group_by_not_on_lazy` - LazyArbor has no group_by
- [x] `test_group_by_lookup_int_finds_float` - groups[1] finds group with key 1.0
- [x] `test_group_by_lookup_float_finds_int` - groups[1.0] finds group with key 1

**lazy tests:**
- [x] `test_lazy_sort_by` - lazy sort execution
- [x] `test_lazy_unique_by` - lazy unique_by execution
- [x] `test_lazy_sort_then_filter` - chained operations
- [x] `test_lazy_filter_then_sort` - filter then sort

**Checkpoint:** `make test` ✓

---

#### Step 12: Final verification

**Commit:** `docs(collection_ops): finalize Phase 13.6`

**Tasks:**
- [x] Run full test suite: `cargo test && make test`
- [x] Run parity check: `make check-parity`
- [x] Run stubs check: `make check-stubs`
- [x] Update Phase 13.6 task checkboxes in this plan
- [x] Update status to "Complete"

---

### 13.6.4 Semantic Specification

#### sort_by() Behavior

| Input | Output |
|-------|--------|
| `arbor.sort_by(path("age"))` | Trees sorted by age ascending (nulls first) |
| `arbor.sort_by(path("age"), descending=True)` | Trees sorted by age descending (nulls last) |
| `arbor.sort_by([path("dept"), path("name")], [False, True])` | By dept asc, then name desc |
| `arbor.sort_by([], ...)` | ValueError: empty `by` |
| Empty arbor | Empty arbor |
| Single tree | Single tree (unchanged) |
| All null keys | Original order preserved (all equal) |
| Mixed types: `[1, "a", null, true]` | `[null, true, 1, "a"]` (type order) |
| Numbers: `[2, 1.0, 1, NaN]` | `[1.0, 1, 2, NaN]` (numeric order, 1==1.0 stable) |

**Type order:** null < bool < number < string < date/datetime/duration < binary < array < object

**Null handling:** Nulls are smallest, so ascending puts nulls first; descending puts nulls last.

#### unique_by() Behavior

| Input | Output |
|-------|--------|
| `[{id:1}, {id:2}, {id:1}].unique_by(path("id"))` | `[{id:1}, {id:2}]` (first id:1 kept) |
| `[{id:1}, {id:1.0}].unique_by(path("id"))` | `[{id:1}]` (1 == 1.0) |
| `[{id:NaN}, {id:NaN}].unique_by(path("id"))` | `[{id:NaN}]` (NaN == NaN) |
| All unique keys | All trees kept |
| All same key | First tree only |
| Empty arbor | Empty arbor |
| Null keys | One null-keyed tree kept (first encountered) |

**Key equality:** 1 and 1.0 are the same key. All NaN values are the same key.

#### group_by() Behavior

| Input | Output |
|-------|--------|
| `[{cat:"A"}, {cat:"B"}, {cat:"A"}].group_by(path("cat"))` | `{"A": [{cat:"A"}, {cat:"A"}], "B": [{cat:"B"}]}` |
| `[{id:1}, {id:1.0}].group_by(path("id"))` | `{1: [{id:1}, {id:1.0}]}` (1 == 1.0, first key used) |
| All same key | One group with all trees |
| All different keys | Each tree in its own group |
| Empty arbor | Empty GroupedArbor |
| Null keys | One group with key `None` |

**Key equality:** 1 and 1.0 group together. All NaN values group together. First-encountered key value is used.

**Order:** Groups are returned in the order their keys were first encountered.

**Eager only:** `group_by()` is not available on `LazyArbor`. Use `lazy.collect().group_by(...)` for lazy-then-group workflows.

---

### 13.6.5 Deliverables and Checkpoints

**Deliverable:** Core collection operations (sort_by, unique_by, group_by) for Arbor and LazyArbor.

| Checkpoint | Verification |
|------------|--------------|
| collection_ops module created | `crates/arbors-query/src/collection_ops.rs` exists |
| Total order defined | Tests verify type ordering and NaN handling |
| sort_by is stable | Tests verify equal keys maintain original order |
| sort_by nulls follow direction | Tests verify nulls first ascending, last descending |
| Numeric equality works | Tests verify 1 == 1.0 for sort/unique/group |
| NaN equality works | Tests verify NaN == NaN for unique/group |
| unique_by first occurrence | Tests verify first occurrence kept |
| group_by order preserved | Tests verify encounter order |
| group_by eager only | Tests verify LazyArbor has no group_by |
| Argument validation | Tests verify errors for empty by, length mismatch |
| GroupedArbor works | Tests verify dict-like access |
| Rust tests pass | `cargo test` succeeds |
| Python builds | `make python` succeeds |
| Python tests pass | `make test` succeeds |
| API parity | `make check-parity` succeeds |
| Stubs correct | `make check-stubs` succeeds |

**Commit after all checkpoints pass.**

---

### 13.6.6 Deferred Operations (Phase 13.6b)

The following operations are deferred to a future phase:

**Collection operations:**
- `partition(predicate)` → `(Arbor, Arbor)` - Split by predicate
- `take_while(predicate)` → `Arbor` - Take while true
- `skip_while(predicate)` → `Arbor` - Skip while true
- `sample(n, seed=None)` → `Arbor` - Random sample
- `sample_fraction(fraction, seed=None)` → `Arbor` - Fractional sample

**Aggregation helpers:**
- `count_where(predicate)` → `int` - Count matching trees
- `distinct_values(path)` → `list` - Unique values at path
- `value_counts(path)` → `dict` - Value frequency counts
- `describe(path)` → `Statistics` - Statistical summary

---

## Phase 13.7 Lazy Evaluation Alignment

**Purpose:** Ensure lazy evaluation works seamlessly with new tree-focused API, enabling fluent chaining with good efficiency.

**Status:** Complete

**Scope:**
1. Verify LazyArbor collection operation parity (audit)
2. Add missing `remove_field()` operation to Tree (gap identified)
3. Implement `LazyTree` type for per-tree mutation batching
4. Optimization passes for operation fusion and dead work elimination

---

### 13.7.0 Design Decisions

#### LazyArbor vs LazyTree - Separation of Concerns (DECIDED)

These are **distinct abstractions** for different levels of operation:

| Aspect | LazyArbor | LazyTree |
|--------|-----------|----------|
| Operates on | Collection of trees | Single tree |
| Example ops | filter, sort_by, unique_by, aggregate | add_field, delete_subtree, replace_subtree |
| Returns | Arbor (collection) | Tree (single) |
| File location | `crates/arbors-lazy/` | `crates/arbors-lazy/src/lazy_tree.rs` (new) |

#### LazyTree Architecture (DECIDED: Option A - Separate TreeOp system)

LazyTree uses a **dedicated TreeOp plan** rather than reusing LazyArbor's QueryPlan:

```rust
/// An operation in a lazy tree plan
#[derive(Debug, Clone)]
pub enum TreeOp {
    /// Source tree (starting point)
    Source,

    /// Add or replace a field at root level with expression result
    AddField { name: String, expr: Expr },

    /// Remove a field at root level
    RemoveField { name: String },

    /// Delete a subtree at a path
    DeleteSubtree { path: String },

    /// Replace a subtree at a path with another tree
    /// Uses Arc<Arbor> + NodeId for explicit ownership semantics
    ReplaceSubtree { path: String, replacement: Arc<Arbor>, replacement_root: NodeId },

    /// Copy a subtree from one path to another
    CopySubtree { from_path: String, to_path: String },

    /// Move a subtree from one path to another
    MoveSubtree { from_path: String, to_path: String },

    /// Ensure intermediate objects exist for a path
    EnsurePath { path: String },
}
```

**Rationale:** LazyArbor's QueryOp is designed for collection-level operations with ExecContext (PerTree, Global). TreeOp is purely sequential single-tree transformations. Separate types avoid confusion and enable tree-specific optimizations.

#### ReplaceSubtree Signature (DECIDED)

**Rust:** `ReplaceSubtree { path: String, replacement: Arc<Arbor>, replacement_root: NodeId }`
**Python:** `replace_subtree(path: str, replacement: Tree) -> LazyTree`

The Python binding extracts the `Arc<Arbor>` and `NodeId` from the `Tree` object internally. This matches how eager `replace_subtree()` already works and avoids exposing low-level ownership details to Python users.

#### Thread Safety (DECIDED)

**LazyTree must be Send + Sync.**

All components are thread-safe:
- `Arc<Arbor>` is Send + Sync
- `TreeOp` variants contain only String, Expr, Arc<Arbor>, NodeId—all Send + Sync
- `Vec<TreeOp>` is Send + Sync

This allows building a LazyTree in one thread and collecting in another (useful for async contexts).

#### remove_field() vs delete_subtree() (DECIDED)

**Add `remove_field(name)` as a distinct operation:**

```rust
// remove_field - root-level field removal (simple, common case)
tree.remove_field("temp")  // Removes root["temp"]

// delete_subtree - path-based removal (nested paths)
tree.delete_subtree("user.address.city")  // Removes nested value
```

**Behavior:**
- `remove_field("name")` only operates on root-level fields
- `remove_field()` on a non-object tree raises `TypeError`
- `remove_field()` on a missing field raises `KeyError`

This mirrors the asymmetry between `add_field()` (root-level) and `replace_subtree()` (path-based).

#### Optimization Passes (DECIDED)

Optimizations are **internal execution details**—users never see or construct batch ops. The optimizer transforms the public TreeOp list into an internal execution plan.

**Pass 1: FieldOpFusion** - Combine adjacent field operations into single tree rebuild:
```rust
// User builds:     AddField("a", 1) → AddField("b", 2) → AddField("c", 3)
// Internal exec:   Single tree reconstruction applying all three fields
// Result:          One O(n) pass instead of three
```

**Pass 2: DeadFieldElimination** - Remove operations that cancel out:
```rust
// User builds:     AddField("temp", 1) → RemoveField("temp")
// Internal exec:   Skip both operations entirely
// Result:          Zero work for cancelled ops

// User builds:     RemoveField("x") → AddField("x", 1)
// Internal exec:   Single field replacement (if "x" existed) or add (if not)
// Result:          One O(n) pass instead of two
```

**Pass 3: SubtreeOpFusion** - Combine subtree operations into single tree walk:
```rust
// User builds:     DeleteSubtree("a.b") → DeleteSubtree("a.c")
// Internal exec:   Single tree reconstruction skipping both paths
// Result:          One O(n) pass instead of two
```

**Note:** There are NO public batch variants of TreeOp. The optimization is transparent to users.

#### Execution Strategy (DECIDED)

`collect()` **always runs optimizations**. There is no `collect_unoptimized()` variant.

**Rationale:** Optimization is the entire value proposition of LazyTree. For debugging:
- `describe_plan()` shows the user-facing operation list (pre-optimization)
- **Deferred (non-goal):** `describe_optimized_plan()` is explicitly out of scope for Phase 13.7. If needed for debugging, it can be added in a future phase as a diagnostic aid.

**Execution flow:**
1. Optimize the operation list (fuse, eliminate dead work)
2. Execute optimized plan with minimal intermediate allocations
3. Return final (Arbor, NodeId) pair

The key insight: **tree reconstruction is O(n)** where n = tree size. Batching avoids multiple O(n) passes.

#### Expression Evaluation Strategy (DECIDED)

Expressions in `add_field()` are evaluated against **intermediate tree states**.

**Implementation approach:** Sequential execution with intermediate trees:
```rust
// For: tree.lazy().add_field("a", lit(1)).add_field("b", path("a").add(lit(1))).collect()
//
// 1. Start with source tree
// 2. Apply add_field("a", lit(1)) → intermediate tree T1
// 3. Evaluate path("a").add(lit(1)) against T1 → value 2
// 4. Apply add_field("b", lit(2)) → final tree T2
// 5. Return T2
```

**Performance implication:** Fusion cannot combine `add_field` ops where later ops reference earlier-added fields. The optimizer detects such dependencies and falls back to sequential execution for those segments.

```rust
// CAN fuse (no dependencies):
add_field("a", lit(1)) → add_field("b", lit(2)) → add_field("c", lit(3))

// CANNOT fuse (b depends on a):
add_field("a", lit(1)) → add_field("b", path("a").add(lit(1)))
```

#### Fusion Dependency Detection Rule (DECIDED)

The optimizer uses a simple, predictable rule for detecting expression dependencies:

**Rule:** An `AddField` operation **cannot be fused** with earlier `AddField` operations in the same fusion window if its expression contains any `path()` whose first segment matches a field name added by an earlier operation in the window.

```rust
// Detection algorithm (pseudo-code):
fn can_fuse(window: &[TreeOp]) -> bool {
    let mut added_fields: HashSet<String> = HashSet::new();

    for op in window {
        if let TreeOp::AddField { name, expr } = op {
            // Check if expr references any previously-added field
            let referenced_paths = expr.collect_root_paths();  // e.g., ["a", "b.c.d"] → ["a", "b"]
            if referenced_paths.iter().any(|p| added_fields.contains(p)) {
                return false;  // Dependency detected, cannot fuse
            }
            added_fields.insert(name.clone());
        }
    }
    true
}
```

**Examples:**
```rust
// Fusable: no path references earlier-added fields
add_field("a", lit(1))
add_field("b", path("x.y").add(lit(2)))  // "x" not in {"a"}
add_field("c", lit(3))
// → Single fused batch

// Not fusable: "b" references "a" which was just added
add_field("a", lit(1))
add_field("b", path("a").add(lit(1)))  // "a" in {"a"}
// → Two separate batches: [a], then [b]

// Partial fusion: ops 1-2 fuse, op 3 depends on op 2
add_field("a", lit(1))                   // Group 1
add_field("b", path("x"))                // Group 1 (no dependency)
add_field("c", path("b").add(lit(1)))    // Group 2 (depends on b)
// → Two batches: [a, b], then [c]
```

**Edge cases:**
- `path("a.b.c")` only checks root segment `"a"`, not nested segments
- `RemoveField` does not create dependencies (nothing to reference)
- `lit()` expressions never have dependencies

#### Python API Consistency (DECIDED)

Python's `LazyTree` matches `LazyArbor` patterns:
```python
# Entry point
lazy_tree = tree.lazy()  # Returns LazyTree

# Chainable operations
lazy_tree = lazy_tree.add_field("x", lit(1))
lazy_tree = lazy_tree.remove_field("temp")
lazy_tree = lazy_tree.delete_subtree("nested.path")

# Execute
result_tree = lazy_tree.collect()
```

#### extract() Not Included in LazyTree (DECIDED)

`extract()` is **not included** in LazyTree because:
1. **Different semantic model**: All other LazyTree operations are *mutations* that transform the current tree. `extract()` is a *query* that returns a different tree.
2. **Return type mismatch**: LazyTree methods return `LazyTree` for chaining. `extract()` would need to return something else, breaking the chain.
3. **No optimization benefit**: The value of LazyTree is batching multiple mutations into one tree rebuild. `extract()` is a single-pass operation with no benefit from batching.

**Use case workaround:**
```python
# Extract first, then chain modifications
subtree = tree.extract("user")
result = subtree.lazy().add_field("x", lit(1)).collect()

# Or collect intermediate result
intermediate = tree.lazy().add_field("x", lit(1)).collect()
extracted = intermediate.extract("user")
```

#### Error Mapping (DECIDED)

Rust errors map to Python exceptions as follows:

| Rust Error | Python Exception | When Raised |
|------------|------------------|-------------|
| `Error::TypeMismatch` | `TypeError` | Root is not an object for `remove_field()`, `add_field()` |
| `Error::PathNotFound` | `KeyError` | Field/path doesn't exist |
| `Error::InvalidPath` | `ValueError` | Empty path for delete, self-nesting, invalid syntax |
| `Error::StorageError` | `RuntimeError` | Internal errors (should not occur) |

**Error timing:** All errors are raised at `collect()` time, not when operations are added to the plan. This allows building plans that might be valid depending on runtime tree state.

#### ensure_path Behavior (DECIDED)

`ensure_path()` creates intermediate **objects only**. It errors on non-object segments.

```python
# Given: {}
tree.ensure_path("a.b.c")  # Creates {"a": {"b": {}}}
# Note: "c" is NOT created - that's the field to add later

# Given: {"a": [1, 2, 3]}
tree.ensure_path("a.b")  # ValueError: "a" is an array, cannot create field "b"

# Given: {"a": 123}
tree.ensure_path("a.b")  # ValueError: "a" is a scalar, cannot create field "b"

# Given: {"a": {"b": {"c": 1}}}
tree.ensure_path("a.b.c")  # No-op, path already exists (even if "c" is not an object)
```

This matches the existing eager `ensure_path()` behavior from Phase 13.4. No implicit type conversion—that would be surprising and data-destructive.

#### Path Validation Rules (DECIDED)

All path-based operations follow these rules:

| Rule | Example | Result |
|------|---------|--------|
| Empty path for delete | `delete_subtree("")` | `ValueError`: cannot delete root |
| Empty path for replace | `replace_subtree("")` | OK: replaces entire tree |
| Self-nesting in copy | `copy_subtree("a", "a.b")` | `ValueError`: destination inside source |
| Self-nesting in move | `move_subtree("a", "a.b")` | `ValueError`: destination inside source |
| Root as move source | `move_subtree("", "backup")` | `ValueError`: cannot move root |
| Root as copy dest | `copy_subtree("a", "")` | `ValueError`: cannot replace root via copy |

**Path normalization:** Paths are NOT normalized. `"a..b"` and `"a.b"` are different (the former is invalid). Trailing dots are invalid.

---

### 13.7.1 LazyArbor Method Parity Audit

**Purpose:** Verify all collection operations work correctly in lazy mode.

**Status:** Complete (22 parity tests in `test_lazy_parity.py` pass)

**Operations to verify:**

| Operation | Eager (Arbor) | Lazy (LazyArbor) | Status |
|-----------|---------------|------------------|--------|
| `filter()` | ✓ | ✓ | Existing |
| `select()` | ✓ | ✓ | Existing |
| `add_field()` | ✓ | ✓ | Existing |
| `head()` | ✓ | ✓ | Existing |
| `tail()` | ✓ | ✓ | Existing |
| `aggregate()` | ✓ | ✓ | Existing |
| `sort_by()` | ✓ (13.6) | ✓ (13.6) | Verify |
| `unique_by()` | ✓ (13.6) | ✓ (13.6) | Verify |
| `group_by()` | ✓ (13.6) | N/A (eager only) | Documented |

**Testing Strategy:**

The parity tests use **deterministic golden fixtures** rather than property-based testing:

1. **Golden input fixtures:** A fixed set of test arbors covering edge cases:
   - Empty arbor (0 trees)
   - Single-tree arbor
   - Multi-tree arbor (10+ trees)
   - Trees with nulls, nested objects, arrays
   - Numeric edge cases (negative numbers, floats)

2. **Comparison approach:** For each operation:
   ```python
   eager_result = arbor.sort_by(path("x"))
   lazy_result = arbor.lazy().sort_by(path("x")).collect()
   assert eager_result.to_json_list() == lazy_result.to_json_list()
   ```

3. **Property verified:** Identical JSON output proves semantic equivalence. No need for structural comparison since JSON is the canonical representation.

4. **Location:** Tests live in `python/tests/test_lazy_parity.py` alongside existing lazy tests.

**Tasks:**
- [x] Verify `sort_by()` lazy execution produces same results as eager
- [x] Verify `unique_by()` lazy execution produces same results as eager
- [x] Document that `group_by()` is eager-only (returns GroupedArbor)
- [x] Add integration tests for lazy collection operations in `test_lazy_parity.py`

---

### 13.7.2 Add remove_field() to Tree

**Purpose:** Add the missing `remove_field()` operation for root-level field removal.

#### API Design

**Rust API (in `arbors-io/src/tree_ops.rs`):**

```rust
/// Remove a field at the root level of the tree.
///
/// The original Arbor is unchanged (immutable operation).
///
/// # Arguments
///
/// * `arbor` - The source Arbor containing the tree
/// * `root` - The root node (must be an object)
/// * `name` - Field name to remove
///
/// # Returns
///
/// * `Ok(Arbor)` - A new Arbor with the field removed
/// * `Err(TypeMismatch)` - If root is not an object
/// * `Err(PathNotFound)` - If field doesn't exist
///
/// # Example
///
/// ```text
/// // Given: {"name": "Alice", "temp": 123}
/// let result = remove_field(&arbor, root, "temp")?;
/// // Result: Arbor with {"name": "Alice"}
/// ```
pub fn remove_field(arbor: &Arbor, root: NodeId, name: &str) -> Result<Arbor>;
```

**Python API (Tree class):**

```python
def remove_field(self, name: str) -> Tree:
    """Remove a field at the root level of this tree.

    The original Tree is unchanged (immutable operation).

    Args:
        name: Field name to remove (root-level only)

    Returns:
        New Tree with the field removed

    Raises:
        TypeError: If root is not an object
        KeyError: If field doesn't exist

    Example:
        >>> tree = arbors.from_dict({"name": "Alice", "temp": 123})[0]
        >>> new_tree = tree.remove_field("temp")
        >>> "temp" in new_tree
        False
    """
```

#### Tasks

- [x] Implement `remove_field()` in `crates/arbors-io/src/tree_ops.rs`
- [x] Add Python binding in `python/src/lib.rs` (Tree impl)
- [x] Add stub to `python/arbors/_arbors.pyi`
- [x] Add Rust tests
- [ ] Add Python tests

**Checkpoint:** `cargo test && make test` ✓

---

### 13.7.3 Definitive Symbol Inventory

#### New Files to Create

| File | Purpose |
|------|---------|
| `crates/arbors-lazy/src/lazy_tree.rs` | LazyTree type and TreeOp enum |
| `crates/arbors-lazy/src/tree_optimize.rs` | Tree-specific optimization passes |

#### Symbols to Add

**In `crates/arbors-lazy/src/lazy_tree.rs` (new):**

| Symbol | Type | Description |
|--------|------|-------------|
| `TreeOp` | enum | Operations for tree modification |
| `TreePlan` | struct | Plan containing source tree and operations |
| `LazyTree` | struct | Lazy evaluation container for tree operations |

**In `crates/arbors-lazy/src/tree_optimize.rs` (new):**

| Symbol | Type | Description |
|--------|------|-------------|
| `TreeOptimizationRule` | trait | Rule interface for tree optimizations |
| `FieldOpFusion` | struct | Fuse adjacent field operations |
| `DeadFieldElimination` | struct | Eliminate canceling operations |
| `optimize_tree_plan()` | function | Apply all optimization rules |

**In `crates/arbors-lazy/src/lib.rs`:**

| Symbol | Type | Description |
|--------|------|-------------|
| `pub mod lazy_tree` | module | Export LazyTree |
| `pub mod tree_optimize` | module | Export tree optimizations |
| Re-exports | - | `LazyTree`, `TreeOp` |

**In `python/src/lib.rs`:**

| Symbol | Type | PyO3 name | Description |
|--------|------|-----------|-------------|
| `LazyTree` | class | `LazyTree` | Python lazy tree container |

**In `python/arbors/_arbors.pyi`:**

| Symbol | Signature |
|--------|-----------|
| `class LazyTree` | Lazy tree container |
| `Tree.lazy() -> LazyTree` | Entry point |
| `LazyTree.add_field(name, expr) -> LazyTree` | Add field |
| `LazyTree.remove_field(name) -> LazyTree` | Remove field |
| `LazyTree.delete_subtree(path) -> LazyTree` | Delete subtree |
| `LazyTree.replace_subtree(path, replacement) -> LazyTree` | Replace subtree |
| `LazyTree.copy_subtree(from_path, to_path) -> LazyTree` | Copy subtree |
| `LazyTree.move_subtree(from_path, to_path) -> LazyTree` | Move subtree |
| `LazyTree.ensure_path(path) -> LazyTree` | Ensure path |
| `LazyTree.collect() -> Tree` | Execute plan |
| `LazyTree.describe_plan() -> str` | Describe plan |

---

### 13.7.4 API Design

#### Rust API

```rust
/// An operation in a lazy tree plan
#[derive(Debug, Clone)]
pub enum TreeOp {
    /// Source tree (starting point)
    Source,

    /// Add or replace a field at root level
    AddField { name: String, expr: Expr },

    /// Remove a field at root level
    RemoveField { name: String },

    /// Delete a subtree at a path
    DeleteSubtree { path: String },

    /// Replace a subtree at a path
    ReplaceSubtree { path: String, replacement: Arc<Arbor>, replacement_root: NodeId },

    /// Copy a subtree from one path to another
    CopySubtree { from_path: String, to_path: String },

    /// Move a subtree from one path to another
    MoveSubtree { from_path: String, to_path: String },

    /// Ensure intermediate objects exist for a path
    EnsurePath { path: String },
}

/// A plan for lazy tree operations
pub struct TreePlan {
    /// The source tree's arbor
    source: Arc<Arbor>,
    /// The source tree's root node ID
    source_root: NodeId,
    /// Operations to apply
    ops: Vec<TreeOp>,
}

/// A lazy evaluation container for tree operations
///
/// `LazyTree` builds a plan without executing it.
/// Operations are only performed when `collect()` is called.
///
/// # Example
///
/// ```text
/// let result = tree.lazy()
///     .add_field("a", lit(1))
///     .add_field("b", lit(2))
///     .remove_field("temp")
///     .collect()?;
/// // Single tree reconstruction with all modifications
/// ```
pub struct LazyTree {
    plan: TreePlan,
}

impl LazyTree {
    /// Create a lazy tree from an eager tree
    pub fn new(arbor: Arc<Arbor>, root: NodeId) -> Self;

    /// Add or replace a field at root level
    pub fn add_field(mut self, name: &str, expr: Expr) -> Self;

    /// Remove a field at root level
    pub fn remove_field(mut self, name: &str) -> Self;

    /// Delete a subtree at a path
    pub fn delete_subtree(mut self, path: &str) -> Self;

    /// Replace a subtree at a path
    /// Note: In Rust, Tree is a (Arc<Arbor>, NodeId) pair. The method extracts these internally.
    pub fn replace_subtree(mut self, path: &str, replacement_arbor: Arc<Arbor>, replacement_root: NodeId) -> Self;

    /// Copy a subtree from one path to another
    pub fn copy_subtree(mut self, from_path: &str, to_path: &str) -> Self;

    /// Move a subtree from one path to another
    pub fn move_subtree(mut self, from_path: &str, to_path: &str) -> Self;

    /// Ensure intermediate objects exist for a path
    pub fn ensure_path(mut self, path: &str) -> Self;

    /// Execute the plan and return the result tree
    ///
    /// This is where all the work happens. The plan is:
    /// 1. Optimized (field fusion, dead elimination)
    /// 2. Executed with minimal intermediate allocations
    /// 3. Result materialized as new tree
    pub fn collect(self) -> Result<(Arbor, NodeId), ExprError>;

    /// Get a description of the current plan
    pub fn describe_plan(&self) -> String;

    /// Get the number of operations in the plan
    pub fn plan_len(&self) -> usize;
}
```

#### Python API

```python
@final
class LazyTree:
    """A lazy evaluation container for tree operations.

    LazyTree builds a plan without executing it. Operations are only
    performed when collect() is called, allowing optimizations like
    operation fusion and dead work elimination.

    Example:
        >>> lazy = tree.lazy()
        >>> lazy = lazy.add_field("a", lit(1))
        >>> lazy = lazy.add_field("b", lit(2))
        >>> lazy = lazy.remove_field("temp")
        >>> result = lazy.collect()  # Single tree reconstruction
    """

    def add_field(self, name: str, expr: Expr) -> LazyTree:
        """Add or replace a field at root level.

        The expression is evaluated against the current tree state.

        Args:
            name: Field name
            expr: Expression to evaluate for the field value

        Returns:
            LazyTree with the operation added to the plan
        """
        ...

    def remove_field(self, name: str) -> LazyTree:
        """Remove a field at root level.

        Args:
            name: Field name to remove

        Returns:
            LazyTree with the operation added to the plan

        Note:
            Errors (field not found, not an object) are raised at collect() time.
        """
        ...

    def delete_subtree(self, path: str) -> LazyTree:
        """Delete a subtree at a path.

        Args:
            path: Path to the subtree to delete

        Returns:
            LazyTree with the operation added to the plan
        """
        ...

    def replace_subtree(self, path: str, replacement: Tree) -> LazyTree:
        """Replace a subtree at a path with another tree.

        Args:
            path: Path to replace
            replacement: Tree to insert

        Returns:
            LazyTree with the operation added to the plan
        """
        ...

    def copy_subtree(self, from_path: str, to_path: str) -> LazyTree:
        """Copy a subtree from one path to another.

        Args:
            from_path: Source path
            to_path: Destination path

        Returns:
            LazyTree with the operation added to the plan
        """
        ...

    def move_subtree(self, from_path: str, to_path: str) -> LazyTree:
        """Move a subtree from one path to another.

        Args:
            from_path: Source path (will be removed)
            to_path: Destination path

        Returns:
            LazyTree with the operation added to the plan
        """
        ...

    def ensure_path(self, path: str) -> LazyTree:
        """Ensure intermediate objects exist for a path.

        Args:
            path: Path to ensure exists

        Returns:
            LazyTree with the operation added to the plan
        """
        ...

    def collect(self) -> Tree:
        """Execute the plan and return the result.

        This is where all the work happens:
        1. Plan is optimized (field fusion, dead elimination)
        2. Operations are executed with minimal allocations
        3. Result is materialized as new Tree

        Returns:
            New Tree with all operations applied

        Raises:
            TypeError: If an operation requires wrong type (e.g., remove_field on array)
            KeyError: If a path doesn't exist
            ValueError: If an operation is invalid (e.g., delete root)
        """
        ...

    def describe_plan(self) -> str:
        """Get a human-readable description of the plan.

        Useful for debugging and understanding the operations.

        Returns:
            Multi-line string describing the plan
        """
        ...

    def __len__(self) -> int:
        """Number of operations in the plan (excluding Source)."""
        ...

    def __repr__(self) -> str:
        """String representation showing plan summary."""
        ...
```

---

### 13.7.5 Execution Steps

**Strategy:** Build from core types up. Implement TreeOp/TreePlan first, then LazyTree, then optimizations, then Python bindings.

---

#### Step 1: Add remove_field() to tree_ops

**Commit:** `feat(io): add remove_field() for root-level field removal`

**Tasks:**
- [x] Implement `remove_field()` in `crates/arbors-io/src/tree_ops.rs`
- [x] Add to public exports in `crates/arbors-io/src/lib.rs` (already public via `pub mod tree_ops`)
- [x] Add Rust unit tests (9 tests added)

**Checkpoint:** `cargo test -p arbors-io` ✓

---

#### Step 2: Create lazy_tree module with TreeOp and TreePlan

**Commit:** `feat(lazy): add lazy_tree module with TreeOp and TreePlan`

**Tasks:**
- [x] Create `crates/arbors-lazy/src/lazy_tree.rs`
- [x] Define `TreeOp` enum with all variants
- [x] Define `TreePlan` struct
- [x] Add `pub mod lazy_tree;` to `crates/arbors-lazy/src/lib.rs`
- [x] Re-export `TreeOp`, `TreePlan` from lib.rs

**Checkpoint:** `cargo build -p arbors-lazy` ✓

---

#### Step 3: Implement LazyTree with all operations

**Commit:** `feat(lazy): implement LazyTree with chainable operations`

**Tasks:**
- [x] Implement `LazyTree::new()`
- [x] Implement `add_field()`, `remove_field()`
- [x] Implement `delete_subtree()`, `replace_subtree()`
- [x] Implement `copy_subtree()`, `move_subtree()`
- [x] Implement `ensure_path()`
- [x] Implement `describe_plan()`, `plan_len()`
- [x] Add re-export of `LazyTree` from lib.rs

**Checkpoint:** `cargo build -p arbors-lazy` ✓

---

#### Step 4: Implement LazyTree::collect() execution

**Commit:** `feat(lazy): implement LazyTree::collect() execution`

**Algorithm:**
1. For each operation in plan order:
   - Apply operation using existing `tree_ops` functions
   - Track current (arbor, root) pair
2. Return final (arbor, root)

Note: This is the unoptimized "sequential" execution. Optimizations come in Step 5.

**Tasks:**
- [x] Implement `collect()` using sequential execution
- [x] Add error handling for all operation types
- [x] Add unit tests for collect

**Checkpoint:** `cargo test -p arbors-lazy` ✓

---

#### Step 5: Implement tree_optimize module

**Commit:** `feat(lazy): add tree optimization passes`

**Tasks:**
- [x] Create `crates/arbors-lazy/src/tree_optimize.rs`
- [x] Define `TreeOptimizationRule` trait
- [x] Implement `FieldOpFusion` - fuse adjacent AddField/RemoveField
- [x] Implement `DeadFieldElimination` - remove canceling pairs
- [x] Implement `optimize_tree_plan()` function
- [x] Integrate optimization into `collect()`
- [x] Add optimization unit tests

**Checkpoint:** `cargo test -p arbors-lazy` ✓

---

#### Step 6: Add Rust integration tests

**Commit:** `test(lazy): add LazyTree integration tests`

**Test file:** `crates/arbors-lazy/tests/lazy_tree_integration.rs`

**Test cases:**
- [x] `test_lazy_tree_add_field_single` - single add_field
- [x] `test_lazy_tree_add_field_chain` - multiple add_field chained
- [x] `test_lazy_tree_remove_field` - remove a field
- [x] `test_lazy_tree_delete_subtree` - delete nested path
- [x] `test_lazy_tree_replace_subtree` - replace with another tree
- [x] `test_lazy_tree_copy_subtree` - copy within tree
- [x] `test_lazy_tree_move_subtree` - move within tree
- [x] `test_lazy_tree_ensure_path` - create intermediate objects
- [x] `test_lazy_tree_mixed_ops` - multiple different operations
- [x] `test_lazy_tree_equals_eager` - lazy.collect() == eager sequence
- [x] `test_lazy_tree_optimization_fusion` - verify operations fused
- [x] `test_lazy_tree_optimization_dead_elim` - verify dead ops removed
- [x] `test_lazy_tree_error_remove_missing` - error on missing field
- [x] `test_lazy_tree_error_delete_root` - error on delete root
- [x] `test_lazy_tree_describe_plan` - plan description format
- [x] `test_lazy_tree_error_copy_self_nesting` - error on self-nesting copy
- [x] `test_lazy_tree_error_move_root` - error on move root
- [x] `test_lazy_tree_plan_len` - verify plan length
- [x] `test_lazy_tree_num_modifications` - verify num_modifications count
- [x] `test_lazy_tree_add_field_with_expression` - add field with expression evaluation
- [x] `test_lazy_tree_add_field_references_earlier_add` - expression references earlier-added field
- [x] `test_lazy_tree_source_unchanged` - verify source tree immutability
- [x] `test_lazy_tree_optimization_double_add` - double add same field

**Checkpoint:** `cargo test` ✓

---

#### Step 7: Python bindings for remove_field()

**Commit:** `feat(python): add remove_field() to Tree`

**Tasks:**
- [x] Add `remove_field()` method to PyTree in `python/src/lib.rs`
- [x] Add stub to `python/arbors/_arbors.pyi`

**Checkpoint:** `make python` ✓

---

#### Step 8: Python bindings for LazyTree

**Commit:** `feat(python): add LazyTree class`

**Tasks:**
- [x] Add `PyLazyTree` struct to `python/src/lib.rs`
- [x] Implement all methods (add_field, remove_field, etc.)
- [x] Add `Tree.lazy()` method that returns LazyTree
- [x] Add `LazyTree.collect()` that returns Tree
- [x] Register PyLazyTree in module

**Checkpoint:** `make python` ✓

---

#### Step 9: Update Python stubs and exports

**Commit:** `docs(python): add LazyTree stubs and exports`

**Tasks:**
- [x] Add `LazyTree` class to `python/arbors/_arbors.pyi`
- [x] Add `Tree.lazy()` method signature to stubs
- [x] Add `LazyTree` to `python/arbors/__init__.py` imports and `__all__`
- [x] Add `LazyTree` to `python/api_manifest.toml`

**Checkpoint:** `make check-stubs && make check-parity` ✓

---

#### Step 10: Python tests

**Commit:** `test(python): add LazyTree tests`

**Test file:** `python/tests/test_lazy_tree.py`

**Test cases:**
- [x] `test_lazy_tree_add_field_single` - single add_field
- [x] `test_lazy_tree_add_field_chain` - multiple add_field chained
- [x] `test_lazy_tree_remove_field` - remove a field
- [x] `test_lazy_tree_remove_field_error` - ArborsError on missing
- [x] `test_lazy_tree_delete_subtree` - delete nested path
- [x] `test_lazy_tree_replace_subtree` - replace with another tree
- [x] `test_lazy_tree_copy_subtree` - copy within tree
- [x] `test_lazy_tree_move_subtree` - move within tree
- [x] `test_lazy_tree_ensure_path` - create intermediate objects
- [x] `test_lazy_tree_mixed_ops` - multiple different operations
- [x] `test_lazy_tree_equals_eager` - lazy.collect() == eager sequence
- [x] `test_lazy_tree_describe_plan` - plan description
- [x] `test_lazy_tree_len` - operation count
- [x] `test_lazy_tree_repr` - string representation
- [x] `test_lazy_tree_immutable` - original tree unchanged

**Checkpoint:** `make test` ✓

---

#### Step 11: LazyArbor parity verification

**Commit:** `test(lazy): verify LazyArbor collection operation parity`

**Tasks:**
- [x] Add tests verifying `lazy.sort_by().collect()` == `arbor.sort_by()`
- [x] Add tests verifying `lazy.unique_by().collect()` == `arbor.unique_by()`
- [x] Document `group_by()` as eager-only in docstrings
- [x] Add integration test for lazy chaining with new collection ops

**Checkpoint:** `cargo test && make test` ✓

---

#### Step 12: Final verification

**Commit:** `docs(lazy_tree): finalize Phase 13.7`

**Tasks:**
- [x] Run full test suite: `cargo test && make test`
- [x] Run parity check: `make check-parity`
- [x] Run stubs check: `make check-stubs`
- [x] Update Phase 13.7 task checkboxes in this plan
- [x] Update status to "Complete"

---

### 13.7.6 Semantic Specification

#### LazyTree Operation Order

Operations are recorded in the order they're called and executed in that order (after optimization):

```python
tree.lazy()
    .add_field("a", lit(1))      # Op 1
    .remove_field("b")           # Op 2
    .add_field("c", path("a"))   # Op 3 - can reference "a" added in Op 1
    .collect()
```

#### Expression Evaluation Context

Expressions in `add_field()` are evaluated against the tree state **at that point in the plan**:

```python
# This works - "a" exists when add_field("b", ...) is evaluated
tree.lazy()
    .add_field("a", lit(1))
    .add_field("b", path("a").add(lit(1)))  # b = a + 1 = 2
    .collect()

# This also works - remove then re-add
tree.lazy()
    .remove_field("x")
    .add_field("x", lit(99))  # x is now 99
    .collect()
```

#### Optimization Behavior

| Pattern | Before | After |
|---------|--------|-------|
| Adjacent AddField | `AddField("a",1), AddField("b",2)` | `AddFieldBatch([("a",1),("b",2)])` |
| Add then Remove same | `AddField("x",1), RemoveField("x")` | (removed) |
| Remove then Add same | `RemoveField("x"), AddField("x",1)` | `ReplaceField("x",1)` |
| Delete then Add same | `DeleteSubtree("a.b"), AddField("a.b", ...)` | (kept separate - path semantics differ) |

#### Error Timing

Errors are raised at `collect()` time, not when operations are added:

| Error | When Raised |
|-------|-------------|
| `remove_field()` on missing field | At `collect()` |
| `remove_field()` on non-object | At `collect()` |
| `delete_subtree("")` | At `collect()` |
| Path not found | At `collect()` |
| Self-nesting in copy/move | At `collect()` |

---

### 13.7.7 Deliverables and Checkpoints

**Deliverable:** LazyTree for fluent tree modification chaining with operation fusion.

| Checkpoint | Verification |
|------------|--------------|
| remove_field() exists | `tree.remove_field("x")` works |
| LazyTree chains operations | `tree.lazy().add_field().remove_field().collect()` works |
| Lazy == Eager equivalence | For each operation, `lazy.collect()` equals eager result |
| Operation fusion works | Adjacent add_field calls fused (verify via describe_plan) |
| Dead work eliminated | Add then remove same field → no-op (verify via describe_plan) |
| LazyArbor parity | `lazy.sort_by().collect()` equals `arbor.sort_by()` |
| Rust tests pass | `cargo test` succeeds |
| Python builds | `make python` succeeds |
| Python tests pass | `make test` succeeds |
| API parity | `make check-parity` succeeds |
| Stubs correct | `make check-stubs` succeeds |

**Commit after all checkpoints pass.**

---

## Phase 13.7b API Consistency Audit

**Purpose:** Audit and fix API inconsistencies across Arbor, Tree, LazyArbor, and LazyTree.

**Status:** Not started

---

### 13.7b.0 Problem Statement

The evolution of the codebase has produced inconsistent return types and API patterns across the four main types:

| Type | Purpose |
|------|---------|
| **Arbor** | Collection of N trees |
| **Tree** | Single tree (reference into an Arbor) |
| **LazyArbor** | Lazy evaluation for collection operations |
| **LazyTree** | Lazy evaluation for tree operations |

**Key inconsistencies identified:**

1. **Arbor eager methods return wrong types:**
   - `filter()` → `QueryResult` (not `Arbor`)
   - `select()` → `list[dict]` (not `Arbor`)
   - `add_field()` → `list[dict]` (not `Arbor`)
   - `sort_by()` → `Arbor` ✓
   - `unique_by()` → `Arbor` ✓
   - `group_by()` → `GroupedArbor` ✓

2. **Tree eager methods have mixed patterns:**
   - `select()` → `dict` (not `Tree`)
   - `filter()` → `QueryResult` (filters array elements, not trees)
   - Subtree ops (`delete_subtree`, `copy_subtree`, etc.) → `Tree` ✓

3. **"Always an Arbor" rule is confusing:**
   - `read_json('{"a":1}')` returns `Arbor` containing one Tree
   - Users must write `arbor[0]` to get the Tree
   - Conceptually: a single JSON doc is a Tree, JSONL is an Arbor

4. **QueryResult is an unnecessary indirection:**
   - `arbor.filter(predicate)` returns indices, not filtered trees
   - Users must iterate QueryResult to access Trees
   - This is an artifact of an older design

---

### 13.7b.1 Proposed Fixes

#### Fix 1: Consistent Arbor Method Return Types

All Arbor methods that produce a collection of trees should return `Arbor`:

| Method | Current Return | Proposed Return |
|--------|----------------|-----------------|
| `filter(expr)` | `QueryResult` | `Arbor` |
| `select(exprs)` | `list[dict]` | `Arbor` |
| `add_field(name, expr)` | `list[dict]` | `Arbor` |
| `sort_by(expr)` | `Arbor` | `Arbor` ✓ |
| `unique_by(expr)` | `Arbor` | `Arbor` ✓ |
| `group_by(expr)` | `GroupedArbor` | `GroupedArbor` ✓ |
| `aggregate(exprs)` | `dict` | `dict` ✓ (single result, not collection) |

**Rationale:** An Arbor IS a list of Trees. Operations that produce Trees should return an Arbor, enabling fluent chaining.

#### Fix 2: Consistent Tree Method Return Types

Tree operations that produce a transformed Tree should return `Tree`:

| Method | Current Return | Proposed Return |
|--------|----------------|-----------------|
| `select(exprs)` | `dict` | `Tree` |
| `filter(path, pred)` | `QueryResult` | RECONSIDER (see below) |
| `delete_subtree(path)` | `Tree` | `Tree` ✓ |
| `copy_subtree(from, to)` | `Tree` | `Tree` ✓ |
| `extract(path)` | `Tree \| None` | `Tree \| None` ✓ |

**Tree.filter() complexity:** Currently filters array elements within a tree. Should it:
- Return a new Tree with filtered array? (structural transformation)
- Return indices? (current behavior)
- Be renamed to `filter_array()`?

**Proposed:** Rename to `filter_array()` and add new `select()` that returns `Tree`.

#### Fix 3: Relax "Always an Arbor" Rule

**Proposal:** `read_json()` returns `Tree`, `read_jsonl()` returns `Arbor`.

| Function | Current Return | Proposed Return |
|----------|----------------|-----------------|
| `read_json(data)` | `Arbor` | `Tree` |
| `read_jsonl(data)` | `Arbor` | `Arbor` ✓ |
| `from_dict(data)` | `Arbor` | `Tree` |

**Rationale:**
- A single JSON document is semantically a Tree
- JSONL (multiple docs) is semantically an Arbor (collection of Trees)
- Eliminates the awkward `arbor[0]` access pattern
- More intuitive: `tree = read_json(...)` vs `tree = read_json(...)[0]`

**Migration:**
- Code using `read_json(...)[0]` → `read_json(...)`
- Code using `len(read_json(...))` (expecting 1) → no longer needed

#### Fix 4: Deprecate QueryResult

**Proposal:** Remove `QueryResult` as a public type. Filter operations return their natural types.

| Operation | Current | Proposed |
|-----------|---------|----------|
| `arbor.filter(pred)` | `QueryResult` | `Arbor` |
| `tree.filter(path, pred)` | `QueryResult` | Rename to `tree.filter_array(path, pred) → Tree` |

**QueryResult removal:**
- `Arbor.filter()` directly returns filtered `Arbor`
- `Tree.filter_array()` returns new `Tree` with filtered array in place
- Indices access (if needed) via explicit method: `arbor.matching_indices(pred) → list[int]`

---

### 13.7b.2 API Design Summary

#### Arbor (collection of Trees)

```python
class Arbor:
    # Navigation
    def __len__(self) -> int: ...
    def __getitem__(self, idx: int) -> Tree: ...
    def __iter__(self) -> Iterator[Tree]: ...

    # Query operations - all return Arbor for chaining
    def filter(self, expr: Expr) -> Arbor: ...
    def select(self, exprs: list[Expr]) -> Arbor: ...
    def add_field(self, name: str, expr: Expr) -> Arbor: ...

    # Collection operations - return Arbor
    def sort_by(self, by: Expr, descending: bool = False) -> Arbor: ...
    def unique_by(self, by: Expr) -> Arbor: ...
    def head(self, n: int) -> Arbor: ...
    def tail(self, n: int) -> Arbor: ...

    # Grouping - special return type
    def group_by(self, by: Expr) -> GroupedArbor: ...

    # Aggregation - single result
    def aggregate(self, exprs: list[Expr]) -> dict: ...

    # Lazy entry point
    def lazy(self) -> LazyArbor: ...
```

#### Tree (single document)

```python
class Tree:
    # Navigation
    def __getitem__(self, key: str) -> Node: ...
    def path(self, path: str) -> Node | None: ...

    # Query operations - return Tree
    def select(self, exprs: list[Expr]) -> Tree: ...
    def add_field(self, name: str, expr: Expr) -> Tree: ...  # NEW

    # Array filtering (renamed from filter)
    def filter_array(self, array_path: str, predicate: Expr) -> Tree: ...

    # Subtree operations - return Tree
    def extract(self, path: str) -> Tree | None: ...
    def delete_subtree(self, path: str) -> Tree: ...
    def replace_subtree(self, path: str, replacement: Tree) -> Tree: ...
    def copy_subtree(self, from_path: str, to_path: str) -> Tree: ...
    def move_subtree(self, from_path: str, to_path: str) -> Tree: ...
    def ensure_path(self, path: str) -> Tree: ...
    def remove_field(self, name: str) -> Tree: ...

    # Expression evaluation - return values
    def eval(self, expr: Expr) -> Any: ...

    # Lazy entry point
    def lazy(self) -> LazyTree: ...
```

#### LazyArbor (lazy collection operations)

```python
class LazyArbor:
    # All operations return LazyArbor for chaining
    def filter(self, expr: Expr) -> LazyArbor: ...
    def select(self, exprs: list[Expr]) -> LazyArbor: ...
    def add_field(self, name: str, expr: Expr) -> LazyArbor: ...
    def sort_by(self, by: Expr, descending: bool = False) -> LazyArbor: ...
    def unique_by(self, by: Expr) -> LazyArbor: ...
    def head(self, n: int) -> LazyArbor: ...
    def tail(self, n: int) -> LazyArbor: ...
    def aggregate(self, exprs: list[Expr]) -> LazyArbor: ...

    # Materialize
    def collect(self) -> Arbor: ...
```

#### LazyTree (lazy tree operations)

```python
class LazyTree:
    # All operations return LazyTree for chaining
    def add_field(self, name: str, expr: Expr) -> LazyTree: ...
    def remove_field(self, name: str) -> LazyTree: ...
    def delete_subtree(self, path: str) -> LazyTree: ...
    def replace_subtree(self, path: str, replacement: Tree) -> LazyTree: ...
    def copy_subtree(self, from_path: str, to_path: str) -> LazyTree: ...
    def move_subtree(self, from_path: str, to_path: str) -> LazyTree: ...
    def ensure_path(self, path: str) -> LazyTree: ...

    # Materialize
    def collect(self) -> Tree: ...
```

#### Construction functions

```python
def read_json(data: str | bytes) -> Tree: ...  # Changed from Arbor
def read_jsonl(data: str | bytes) -> Arbor: ...
def from_dict(data: dict | list | ...) -> Tree: ...  # Changed from Arbor
```

---

### 13.7b.3 Breaking Changes

This is a **BREAKING CHANGE** phase. Since we have zero external users (per 13.1.1), this is acceptable.

| Change | Migration |
|--------|-----------|
| `read_json()` returns `Tree` | Remove `[0]` indexing |
| `from_dict()` returns `Tree` | Remove `[0]` indexing |
| `arbor.filter()` returns `Arbor` | Remove `QueryResult` iteration |
| `arbor.select()` returns `Arbor` | Access trees via indexing |
| `arbor.add_field()` returns `Arbor` | Access trees via indexing |
| `tree.filter()` renamed | Use `tree.filter_array()` |
| `tree.select()` returns `Tree` | Direct use, no dict conversion |
| `QueryResult` removed | Use Arbor methods directly |

---

### 13.7b.4 Implementation Strategy

**Phase 1: Add new methods alongside old**
- Add `Tree.add_field()` (new)
- Add methods that return correct types with new names (e.g., `filter_to_arbor`)
- Mark old methods for removal

**Phase 2: Change return types**
- `read_json()` → returns `Tree`
- `from_dict()` → returns `Tree`
- `Arbor.filter()` → returns `Arbor`
- `Arbor.select()` → returns `Arbor`
- `Arbor.add_field()` → returns `Arbor`
- `Tree.select()` → returns `Tree`

**Phase 3: Remove deprecated**
- Remove `QueryResult` from public API
- Rename `Tree.filter()` to `Tree.filter_array()`
- Remove old method aliases

---

### 13.7b.5 Definitive Symbol Inventory

#### Methods to Change Return Type

| Class | Method | Current Return | New Return |
|-------|--------|----------------|------------|
| `Arbor` | `filter(expr)` | `QueryResult` | `Arbor` |
| `Arbor` | `select(exprs)` | `list[dict]` | `Arbor` |
| `Arbor` | `add_field(name, expr)` | `list[dict]` | `Arbor` |
| `Tree` | `select(exprs)` | `dict` | `Tree` |
| `Tree` | `filter(path, pred)` | `QueryResult` | `Tree` (renamed to `filter_array`) |

#### Methods to Add

| Class | Method | Signature | Notes |
|-------|--------|-----------|-------|
| `Arbor` | `matching_indices(expr)` | `-> list[int]` | QueryResult replacement |
| `Arbor` | `from_trees(trees)` | `@classmethod -> Arbor` | Programmatic construction |
| `Arbor` | `storage_id()` | `-> int` | Structural sharing verification |
| `Tree` | `add_field(name, expr)` | `-> Tree` | Parity with Arbor |
| `Tree` | `filter_array(path, pred)` | `-> Tree` | Renamed from filter |
| `LazyTree` | `select(exprs)` | `-> LazyTree` | Lazy parity |
| `LazyTree` | `filter_array(path, pred)` | `-> LazyTree` | Lazy parity |
| `LazyArbor` | `collect_scalar()` | `-> dict` | Shorthand for aggregate collect |

#### Methods to Rename

| Class | Current | New | Return Type |
|-------|---------|-----|-------------|
| `Tree` | `filter(path, pred)` | `filter_array(path, pred)` | `Tree` (was `QueryResult`) |

#### Functions to Change Return Type

| Function | Current Return | New Return |
|----------|----------------|------------|
| `read_json()` | `Arbor` | `Tree` |
| `read_json_infer_schema()` | `Arbor` | `Tree` |
| `from_dict()` | `Arbor` | `Tree` |

#### Types to Remove

| Type | Reason | Replacement |
|------|--------|-------------|
| `QueryResult` | Replaced by direct `Arbor` returns | `Arbor` + `matching_indices()` |

---

### 13.7b.6 Execution Steps

**Strategy:** Proceed in order of dependencies. Tree methods first, then Arbor methods, then read functions, then cleanup.

---

#### Step 1: Add Tree.add_field() and Tree.filter_array()

**Commit:** `feat(tree): add Tree.add_field() and Tree.filter_array() methods`

**Design refs:** C3 (LazyTree parity table), C4 (immutable with structural sharing)

Add eager methods to Tree that return new Trees:

**Tasks:**
- [x] Implement `Tree::add_field()` in Rust (likely in `python/src/lib.rs`)
- [x] Implement `Tree::filter_array()` returning Tree with filtered array
- [x] Both methods return new Tree, original unchanged (per C4)
- [x] Add Python bindings
- [x] Update stubs
- [x] Add tests for both methods

**Checkpoint:** `make test` ✓

---

#### Step 2: Add Arbor.matching_indices(), Arbor.from_trees(), and Arbor.storage_id()

**Commit:** `feat(arbor): add matching_indices(), from_trees(), and storage_id() methods`

**Design refs:** C1 (from_trees for programmatic construction), C2 (matching_indices replaces QueryResult.indices), C5b (storage_id for sharing tests), N1 (storage_id visibility), N3 (from_trees edge cases), N4 (matching_indices semantics)

**Tasks:**
- [x] Implement `Arbor::matching_indices()` returning `list[int]` (same expr/null/error handling as filter per N4)
- [x] Implement `Arbor::from_trees()` class method (empty→empty Arbor, mixed schema→union per N3)
- [x] Implement `Arbor::storage_id()` returning `int` (diagnostic, non-stable per N1)
- [x] Add `Arbor::head()` and `Arbor::tail()` to Python (API consistency fix - existed in Rust, missing in Python)
- [x] Add Python bindings for all methods
- [x] Update stubs
- [x] Add tests for matching_indices and from_trees (include empty input, mixed schema per N3)
- [x] Add performance test for matching_indices with 10k+ trees (per N4)
- [x] Add structural sharing tests (per C5b)

**Checkpoint:** `cargo test && make test` ✓

---

#### Step 3: Change Arbor query methods to return Arbor

**Commit:** `refactor(arbor): query methods return Arbor instead of lists/QueryResult`

**Design refs:** C4 (structural sharing table: filter=view, select/add_field=new storage), C5b (verify sharing with storage_id tests)

**Tasks:**
- [x] Change `Arbor::filter()` to return `Arbor` (not `QueryResult`)
- [x] Change `Arbor::select()` to return `Arbor` (not `list[dict]`)
- [x] Change `Arbor::add_field()` to return `Arbor` (not `list[dict]`)
- [x] Ensure structural sharing for filter (view, shares storage_id per C4)
- [x] Ensure select/add_field create new storage (different storage_id per C4)
- [x] Update Python bindings
- [x] Update stubs
- [x] Update all tests that use these methods
- [x] Verify C5b structural sharing tests pass

**Checkpoint:** `cargo test && make test` ✓

---

#### Step 4: Change Tree.select() to return Tree

**Commit:** `refactor(tree): Tree.select() returns Tree`

**Design refs:** C4 (select creates new storage)

**Tasks:**
- [x] Change `Tree::select()` to return `Tree` (not `dict`)
- [x] New storage created, original unchanged (per C4)
- [x] Update Python bindings
- [x] Update stubs
- [x] Update tests

**Checkpoint:** `cargo test && make test` ✓

---

#### Step 5: Add LazyTree.select() and LazyTree.filter_array()

**Commit:** `feat(lazy): add LazyTree.select() and filter_array() for lazy parity`

**Design refs:** C3 (LazyTree parity table, lazy aggregate examples, collect_scalar behavior), N2 (collect_scalar negative test)

**Tasks:**
- [x] Implement `LazyTree::select()` returning `LazyTree` (per C3 parity table)
- [x] Implement `LazyTree::filter_array()` returning `LazyTree` (per C3 parity table)
- [x] Add `LazyArbor::collect_scalar()` for aggregate convenience (per C3 examples)
- [x] collect_scalar raises ArborsError if plan doesn't end with aggregate (per N2)
- [x] Update stubs
- [x] Add tests including negative test for collect_scalar on non-aggregate plan (per N2)

**Checkpoint:** `cargo test && make test` ✓

---

#### Step 6: Change read_json() to return Tree

**Commit:** `feat(api): read_json() returns Tree, read_jsonl() returns Arbor`

**Design refs:** C1 (array-root semantics table), C7 (all read/infer variants), N5 (breaking change documentation with examples)

This is the biggest breaking change. All code using `read_json(...)[0]` must be updated.

**Tasks:**
- [ ] Change `read_json()` to return `Tree`
- [ ] Change `read_json_infer_schema()` to return `Tree`
- [ ] Change `from_dict()` to return `Tree` (array-root input → single Tree per C1)
- [ ] Keep `read_jsonl()` returning `Arbor` (verify unchanged per C7)
- [ ] Keep `read_jsonl_infer_schema()` returning `Arbor` (verify unchanged per C7)
- [ ] Update Python bindings
- [ ] Update stubs
- [ ] Update ALL tests (search for `read_json.*\[0\]` pattern)
- [ ] Update ALL examples
- [ ] Add tests for array-root inputs per C1 table (e.g., `read_json('[1,2,3]')` → array-rooted Tree)

**Checkpoint:** `cargo test && make test` ✓

---

#### Step 7: Remove QueryResult and old Tree.filter()

**Commit:** `refactor(api): remove QueryResult and rename Tree.filter`

**Design refs:** C2 (QueryResult replacement via matching_indices)

**Tasks:**
- [x] Remove `QueryResult` from `python/api_manifest.toml`
- [x] Remove `QueryResult` from `python/arbors/__init__.py`
- [x] Remove `QueryResult` class from stubs
- [x] Remove old `Tree.filter()` (now `filter_array()`)
- [x] Update any remaining tests using Tree.filter() (migrate to filter_array())

**Checkpoint:** `make check-parity && make check-stubs` ✓

---

#### Step 8: Update examples and documentation

**Commit:** `docs(api): update all examples for new API`

**Design refs:** C5 (documentation surfaces list), C6 (GroupedArbor example), N5 (breaking change documentation)

**Tasks:**
- [x] Update `python/examples/*.py` (per C5 surface list)
- [x] Update `examples/*.py` (per C5 surface list)
- [x] Update `python/benchmarks/*.py` (per C5 surface list)
- [x] Update `README.md` with breaking change callout (per N5 example)
- [x] Update Rust docstrings with new examples (per C5 surface list) — CLI is minimal placeholder, no changes needed
- [x] Check CLI for any API usage (per C5 surface list) — CLI is minimal placeholder, no affected APIs
- [x] Add GroupedArbor.aggregate() example showing expected output shape (per C6) — implemented method + example
- [x] Document escape hatches: `read_jsonl()` and `Arbor.from_trees()` for multi-doc (per N5)

**Checkpoint:** All examples run without error ✓

---

#### Step 9: Final verification and cleanup

**Commit:** `docs(api): finalize Phase 13.7b API consistency`

**Design refs:** C4 (structural sharing verification), C5b (storage_id tests), all implementation notes (N1-N5)

**Verification Checks:**
```bash
# All query operations on Arbor return Arbor
grep -rn "def filter\|def select\|def add_field" python/arbors/_arbors.pyi

# read_json returns Tree
grep -rn "def read_json" python/arbors/_arbors.pyi

# No QueryResult in public API
grep -rn "QueryResult" python/arbors/__init__.py

# No [0] indexing after read_json
grep -rn "read_json.*\[0\]" python/ examples/ --include="*.py"

# Structural sharing for filter/sort/head/tail
# Verified by C5b tests using storage_id()
```

**Tasks:**
- [x] Run full test suite: `cargo test && make test`
- [x] Run parity check: `make check-parity`
- [x] Run stubs check: `make check-stubs`
- [x] Verify C5b structural sharing tests pass (storage_id checks per C4)
- [x] Verify all implementation notes addressed (N1-N5)
- [x] Update this plan with completed checkboxes

---

### 13.7b.7 Semantic Specification

#### Arbor.filter() New Behavior

```python
# Old (returns QueryResult)
result = arbor.filter(path("age") > 21)
for tree in result:  # iterate QueryResult
    print(tree.to_json())

# New (returns Arbor directly)
filtered = arbor.filter(path("age") > 21)
for tree in filtered:  # iterate Arbor directly
    print(tree.to_json())
```

#### Arbor.select() New Behavior

```python
# Old (returns list[dict])
dicts = arbor.select([path("name").alias("n")])
for d in dicts:
    print(d["n"])

# New (returns Arbor)
selected = arbor.select([path("name").alias("n")])
for tree in selected:
    print(tree["n"].value)
```

#### Tree.filter_array() Behavior

```python
# Old (filter returns QueryResult with indices)
result = tree.filter("items", path("@.price") > 50)
indices = result.indices

# New (filter_array returns new Tree with filtered array)
new_tree = tree.filter_array("items", path("@.price") > 50)
# new_tree["items"] contains only elements where price > 50
```

#### read_json() New Behavior

```python
# Old
arbor = read_json('{"name": "Alice"}')
tree = arbor[0]  # Required indexing

# New
tree = read_json('{"name": "Alice"}')  # Direct Tree
```

---

### 13.7b.8 Design Clarifications

These clarifications address review feedback to ensure the design is complete before implementation.

#### C1: Array-Root and List-of-Dicts Input Semantics

**Question:** For JSON with a top-level array or `from_dict` given a list of dicts, should we produce an Arbor or treat the array as a single Tree root?

**Decision:** A single JSON document is always a single Tree, regardless of root type.

| Input | Return Type | Result |
|-------|-------------|--------|
| `read_json('{"a":1}')` | `Tree` | Object-rooted Tree |
| `read_json('[1,2,3]')` | `Tree` | Array-rooted Tree |
| `read_json('"hello"')` | `Tree` | String-rooted Tree |
| `from_dict({"a":1})` | `Tree` | Object-rooted Tree |
| `from_dict([1,2,3])` | `Tree` | Array-rooted Tree |
| `from_dict([{"a":1}, {"b":2}])` | `Tree` | Array-rooted Tree (array of 2 objects) |
| `read_jsonl('{"a":1}\n{"b":2}')` | `Arbor` | 2 Trees, each object-rooted |

**Rationale:** JSON semantics. A JSON document has exactly one root value. `[{...}, {...}]` is one document with an array root, not two documents. JSONL explicitly separates documents by newlines.

**If you want an Arbor from a list:**
```python
# Option 1: Use JSONL format
arbor = read_jsonl('{"a":1}\n{"b":2}')

# Option 2: Use Arbor.from_trees() (new method)
trees = [from_dict(d) for d in [{"a":1}, {"b":2}]]
arbor = Arbor.from_trees(trees)
```

---

#### C2: QueryResult Replacement and Indices Access

**Question:** Removing QueryResult loses an efficient "indices only" path. What replaces it?

**Decision:** Add `matching_indices()` as an explicit alternative when indices are needed.

```python
class Arbor:
    def filter(self, expr: Expr) -> Arbor:
        """Filter trees, returning new Arbor with matching trees."""
        ...

    def matching_indices(self, expr: Expr) -> list[int]:
        """Get indices of trees matching predicate (no materialization).

        More efficient than filter() when you only need positions.
        Equivalent to old QueryResult.indices.
        """
        ...
```

**Performance characteristics:**

| Method | Memory | Use Case |
|--------|--------|----------|
| `filter()` | Creates new Arbor (view or copy, see C4) | When you need the trees |
| `matching_indices()` | Returns `list[int]` only | When you only need positions |

**Migration:**
```python
# Old
result = arbor.filter(pred)
indices = result.indices

# New - if you need trees
filtered = arbor.filter(pred)

# New - if you only need indices
indices = arbor.matching_indices(pred)
```

---

#### C3: Lazy API Parity

**Question:** LazyArbor shows `aggregate` returning `LazyArbor` - should it be a lazy scalar? And should LazyTree have `select`/`filter_array`?

**Decision:** Maintain consistent lazy patterns with clear collect semantics.

**LazyArbor.aggregate():**
```python
class LazyArbor:
    def aggregate(self, exprs: list[Expr]) -> LazyArbor:
        """Add aggregation to plan. Result is single-tree Arbor.

        After collect(), returns Arbor with one Tree containing
        the aggregation results (same as eager aggregate() wrapped in Arbor).
        """
        ...

    def collect(self) -> Arbor:
        """Execute plan and return Arbor.

        For aggregation plans, returns single-tree Arbor.
        """
        ...

    def collect_scalar(self) -> dict:
        """Execute plan and return scalar result (for aggregation).

        Shorthand for collect()[0].to_dict() when plan ends with aggregate.
        Raises if plan doesn't end with aggregate.
        """
        ...
```

**LazyTree operations:**

| Eager Tree | LazyTree | Notes |
|------------|----------|-------|
| `select(exprs) -> Tree` | `select(exprs) -> LazyTree` | **ADD** - transforms tree structure |
| `add_field(name, expr) -> Tree` | `add_field(name, expr) -> LazyTree` | Already exists |
| `filter_array(path, pred) -> Tree` | `filter_array(path, pred) -> LazyTree` | **ADD** - filters array in place |
| `remove_field(name) -> Tree` | `remove_field(name) -> LazyTree` | Already exists |
| `delete_subtree(path) -> Tree` | `delete_subtree(path) -> LazyTree` | Already exists |
| `copy_subtree(...) -> Tree` | `copy_subtree(...) -> LazyTree` | Already exists |
| `move_subtree(...) -> Tree` | `move_subtree(...) -> LazyTree` | Already exists |
| `replace_subtree(...) -> Tree` | `replace_subtree(...) -> LazyTree` | Already exists |
| `ensure_path(path) -> Tree` | `ensure_path(path) -> LazyTree` | Already exists |

**Updated LazyTree API:**
```python
class LazyTree:
    # Structure transformation (NEW)
    def select(self, exprs: list[Expr]) -> LazyTree: ...
    def filter_array(self, array_path: str, predicate: Expr) -> LazyTree: ...

    # Field operations
    def add_field(self, name: str, expr: Expr) -> LazyTree: ...
    def remove_field(self, name: str) -> LazyTree: ...

    # Subtree operations
    def delete_subtree(self, path: str) -> LazyTree: ...
    def replace_subtree(self, path: str, replacement: Tree) -> LazyTree: ...
    def copy_subtree(self, from_path: str, to_path: str) -> LazyTree: ...
    def move_subtree(self, from_path: str, to_path: str) -> LazyTree: ...
    def ensure_path(self, path: str) -> LazyTree: ...

    # Materialize
    def collect(self) -> Tree: ...
```

**Lazy aggregate examples:**

```python
# LazyArbor.aggregate() returns LazyArbor, collect() yields single-tree Arbor
lazy_agg = arbor.lazy().filter(path("active") == True).aggregate([
    path("price").sum().alias("total"),
    path("price").avg().alias("average"),
    path("*").count().alias("count")
])

# Option 1: collect() returns Arbor with one Tree
result_arbor = lazy_agg.collect()
agg_tree = result_arbor[0]
print(agg_tree["total"].value)  # 1500.0
print(agg_tree["average"].value)  # 75.0

# Option 2: collect_scalar() for convenience (raises if plan doesn't end with aggregate)
result_dict = lazy_agg.collect_scalar()
print(result_dict["total"])  # 1500.0
print(result_dict["average"])  # 75.0
print(result_dict["count"])  # 20

# Using aggregate in a chain before collect
total = arbor.lazy().filter(path("category") == "A").aggregate([
    path("amount").sum().alias("total")
]).collect_scalar()["total"]
```

**collect_scalar() behavior:**
- Returns `dict` directly (equivalent to `collect()[0].to_dict()`)
- Raises `ArborsError` if the plan doesn't end with an aggregate operation
- Convenience method for common "filter → aggregate → get scalar result" patterns

---

#### C4: Mutability and Copy Semantics

**Question:** Do Arbor/Tree-returning operations create copies or views?

**Decision:** **Immutable with structural sharing** (copy-on-write semantics).

**Semantics:**
- All operations return **new** Arbor/Tree instances
- Original is **never modified**
- Underlying storage uses `Arc` for efficient sharing where possible
- No visible mutation - safe for concurrent access

**Implementation details:**

| Operation | Sharing Behavior | Notes |
|-----------|------------------|-------|
| `filter()` | View - shares underlying nodes | Only tree indices differ |
| `head(n)` / `tail(n)` | View - shares underlying nodes | Slice of tree indices |
| `sort_by()` | View - shares underlying nodes | Reordered tree indices |
| `unique_by()` | View - shares underlying nodes | Subset of tree indices |
| `select()` | New storage | Transforms structure |
| `add_field()` | New storage | Modifies structure |
| Tree subtree ops | New Arbor | Rebuilds tree |

**Performance documentation to add:**
```python
# Cheap operations (views, O(n) where n = filtered count):
filtered = arbor.filter(pred)      # Shares storage
sorted_arb = arbor.sort_by(expr)   # Shares storage

# Expensive operations (rebuild, O(n) where n = node count):
projected = arbor.select(exprs)    # New storage per tree
with_field = arbor.add_field(...)  # New storage per tree
```

---

#### C5: Documentation and Example Surfaces

**Question:** What surfaces beyond code/tests/stubs need updating?

**Comprehensive update list:**

| Surface | Path | Action |
|---------|------|--------|
| Python stubs | `python/arbors/_arbors.pyi` | Update signatures |
| API manifest | `python/api_manifest.toml` | Remove QueryResult |
| Python `__init__.py` | `python/arbors/__init__.py` | Update `__all__` |
| Python examples | `python/examples/*.py` | Update API usage |
| Root examples | `examples/*.py` | Update API usage |
| README | `README.md` | Update examples |
| Benchmarks | `python/benchmarks/*.py` | Update API usage |
| Rust docstrings | `crates/*/src/*.rs` | Update examples in docs |
| CLI help | `crates/arbors-cli/src/*.rs` | If uses affected APIs |

**NOT updated (historical):**
- `plans/*.md` - Planning documents
- `chats/*.md` - Chat logs

---

#### C5b: Structural Sharing Confirmation Tests

**Question:** How do we verify structural sharing works correctly across the FFI boundary?

**Decision:** Add explicit tests that verify storage is shared for view operations.

**Test specification:**

```python
# test_structural_sharing.py

class TestStructuralSharing:
    """Tests verifying structural sharing for view operations."""

    def test_filter_shares_storage(self, multi_tree_arbor):
        """filter() shares underlying storage (doesn't copy nodes)."""
        original = multi_tree_arbor
        filtered = original.filter(path("value") > 20)

        # Verify storage_id() matches (same underlying Arbor storage)
        assert original.storage_id() == filtered.storage_id()

        # Verify different tree counts
        assert len(filtered) < len(original)

    def test_sort_by_shares_storage(self, multi_tree_arbor):
        """sort_by() shares underlying storage (just reorders indices)."""
        original = multi_tree_arbor
        sorted_arb = original.sort_by(path("value"))

        assert original.storage_id() == sorted_arb.storage_id()

    def test_head_shares_storage(self, multi_tree_arbor):
        """head() shares underlying storage."""
        original = multi_tree_arbor
        head_arb = original.head(2)

        assert original.storage_id() == head_arb.storage_id()

    def test_tail_shares_storage(self, multi_tree_arbor):
        """tail() shares underlying storage."""
        original = multi_tree_arbor
        tail_arb = original.tail(2)

        assert original.storage_id() == tail_arb.storage_id()

    def test_unique_by_shares_storage(self, arbor_with_duplicates):
        """unique_by() shares underlying storage."""
        original = arbor_with_duplicates
        unique_arb = original.unique_by(path("group"))

        assert original.storage_id() == unique_arb.storage_id()

    def test_select_creates_new_storage(self, multi_tree_arbor):
        """select() creates new storage (transforms structure)."""
        original = multi_tree_arbor
        selected = original.select([path("id").alias("x")])

        # Storage IDs should differ (new Arbor created)
        assert original.storage_id() != selected.storage_id()

    def test_add_field_creates_new_storage(self, multi_tree_arbor):
        """add_field() creates new storage (modifies structure)."""
        original = multi_tree_arbor
        with_field = original.add_field("doubled", path("value") * 2)

        assert original.storage_id() != with_field.storage_id()
```

**Implementation requirement:** Add `Arbor.storage_id() -> int` method that returns a unique identifier for the underlying storage (e.g., pointer address or internal ID). This enables tests to verify sharing without exposing internal storage details.

**Add to Step 2 tasks:** Implement `Arbor.storage_id()` for sharing verification.

---

#### C6: GroupedArbor Semantics

**Question:** What does `GroupedArbor.collect()` or `aggregate()` return post-change?

**Decision:** GroupedArbor remains as-is, but clarify its relationship to the new API.

```python
class GroupedArbor:
    """Result of group_by(). Contains groups of Trees keyed by expression result."""

    def __len__(self) -> int:
        """Number of groups."""
        ...

    def __iter__(self) -> Iterator[tuple[Any, Arbor]]:
        """Iterate over (key, group_arbor) pairs."""
        ...

    def __getitem__(self, key: Any) -> Arbor:
        """Get Arbor for a specific group key."""
        ...

    def keys(self) -> list[Any]:
        """Get all group keys."""
        ...

    def aggregate(self, exprs: list[Expr]) -> Arbor:
        """Aggregate each group, returning Arbor with one Tree per group.

        Each result Tree contains the group key and aggregation results.
        """
        ...
```

**Note:** `GroupedArbor` is eager-only (no lazy variant). For lazy workflows:
```python
# Eager grouping after lazy filtering
groups = arbor.lazy().filter(pred).collect().group_by(expr)
```

**GroupedArbor.aggregate() example:**
```python
# Input arbor
arbor = read_jsonl('''
{"category": "A", "price": 100, "qty": 2}
{"category": "B", "price": 200, "qty": 1}
{"category": "A", "price": 150, "qty": 3}
{"category": "B", "price": 50, "qty": 4}
''')

# Group and aggregate
groups = arbor.group_by(path("category"))
result = groups.aggregate([
    path("category").alias("category"),  # Group key preserved
    path("price").sum().alias("total_price"),
    path("qty").sum().alias("total_qty")
])

# result is Arbor with 2 Trees (one per group)
for tree in result:
    print(tree.to_json())
# {"category": "A", "total_price": 250, "total_qty": 5}
# {"category": "B", "total_price": 250, "total_qty": 5}
```

**Expected shape:** Each result Tree contains the group key field(s) plus all aggregation aliases. Order of groups is deterministic (sorted by key).

---

#### C7: read_json_infer_schema and read_jsonl_infer_schema Handling

**Question:** Confirm `read_json_infer_schema` and `read_jsonl_infer_schema` exist and how they interact with Tree/Arbor split.

**Decision:** Same pattern - single document returns Tree, multi-document returns Arbor.

| Function | Return Type | Notes |
|----------|-------------|-------|
| `read_json(data)` | `Tree` | Single document |
| `read_json_infer_schema(data)` | `Tree` | Single document with inferred schema |
| `read_jsonl(data)` | `Arbor` | Multi-document |
| `read_jsonl_infer_schema(data)` | `Arbor` | Multi-document with inferred schema |

The inferred schema is attached to the Tree's/Arbor's backing storage and accessible via `.schema`.

**Both `_infer_schema` variants are explicitly included in execution steps (Step 6) and checkpoints.**

---

### 13.7b.9 Open Questions (Resolved)

All open questions from the original plan and review feedback have been addressed in section 13.7b.8.

| Question | Resolution | Section |
|----------|------------|---------|
| Array-root input semantics | Single doc = single Tree | C1 |
| QueryResult replacement | Add `matching_indices()` | C2 |
| Lazy parity gaps | Add LazyTree.select/filter_array, clarify aggregate | C3 |
| Mutability/ownership | Immutable with structural sharing | C4 |
| Documentation surfaces | Comprehensive list provided | C5 |
| GroupedArbor semantics | Remains eager-only, returns Arbor from aggregate | C6 |
| read_json_infer_schema | Returns Tree (same pattern) | C7 |
| Arbor.from_trees | Add for programmatic construction | C1 |
| Tree.filter rename | Rename to filter_array, return Tree | C3 |

---

### 13.7b.10 Implementation Notes

These notes capture decisions to keep in mind during implementation:

**N1: Arbor.storage_id() visibility**
- Mark as diagnostic/non-stable in docstring
- Document: "Returns internal storage identifier. Useful for debugging and verifying structural sharing. The specific value is not stable across versions."
- Alternatively: make it test-only via `_storage_id()` prefix, but public seems fine with disclaimer

**N2: collect_scalar() negative test**
- Add test that verifies `ArborsError` is raised when calling `collect_scalar()` on a plan that doesn't end with `aggregate()`
- Error message should be clear: "collect_scalar() requires plan to end with aggregate()"

**N3: Arbor.from_trees() edge cases**
- Empty input: return empty Arbor (len == 0)
- Mixed-schema trees: accept as-is (union semantics, schema becomes `Unknown` or inferred from combined)
- Document: "Trees may come from different Arbors; a new unified storage is created"

**N4: matching_indices() semantics**
- Same expression language as `filter()`
- Same null handling (null predicate result → not matched)
- Same error handling (expr errors propagate)
- Add performance test with 10k+ trees to verify no regression vs old QueryResult path

**N5: Breaking change documentation**
- In README/migration guide, explicitly call out:
  - `from_dict([{...}, {...}])` now returns single array-rooted Tree, not Arbor
  - Escape hatches: use `read_jsonl()` for multi-doc, or `Arbor.from_trees()` for programmatic construction
- Add example showing the difference:
  ```python
  # Old behavior (pre-13.7b)
  arbor = from_dict([{"a": 1}, {"b": 2}])  # Arbor with 2 trees

  # New behavior (13.7b+)
  tree = from_dict([{"a": 1}, {"b": 2}])   # Single tree with array root

  # To get Arbor from list of dicts:
  arbor = Arbor.from_trees([from_dict(d) for d in [{"a": 1}, {"b": 2}]])
  # or
  arbor = read_jsonl('{"a": 1}\n{"b": 2}')
  ```

---

### 13.7b.11 Deliverables and Checkpoints

**Deliverable:** Consistent API where collection operations return Arbor, tree operations return Tree, and construction is intuitive.

| Checkpoint | Verification |
|------------|--------------|
| Tree.add_field() exists | `tree.add_field("x", lit(1))` works |
| Arbor.filter() returns Arbor | `arbor.filter(pred)` is Arbor, not QueryResult |
| Arbor.matching_indices() exists | `arbor.matching_indices(pred)` returns list[int] |
| Arbor.storage_id() exists | `arbor.storage_id()` returns int |
| Arbor.select() returns Arbor | `arbor.select(exprs)` is Arbor, not list |
| Arbor.add_field() returns Arbor | `arbor.add_field(...)` is Arbor, not list |
| Tree.select() returns Tree | `tree.select(exprs)` is Tree, not dict |
| Tree.filter_array() exists | `tree.filter_array(path, pred)` returns Tree |
| LazyTree.select() exists | Lazy parity with Tree.select() |
| LazyTree.filter_array() exists | Lazy parity with Tree.filter_array() |
| LazyArbor.collect_scalar() exists | Raises if plan doesn't end with aggregate |
| Arbor.from_trees() exists | `Arbor.from_trees([t1, t2])` works |
| read_json() returns Tree | `read_json(data)` is Tree directly |
| read_json_infer_schema() returns Tree | Same pattern |
| read_jsonl() returns Arbor | Unchanged, verify still works |
| read_jsonl_infer_schema() returns Arbor | Unchanged, verify still works |
| from_dict() returns Tree | `from_dict(data)` is Tree directly |
| QueryResult removed | Not in public API |
| Structural sharing verified | C5b tests pass (filter/sort/head/tail share storage_id) |
| Rust tests pass | `cargo test` succeeds |
| Python tests pass | `make test` succeeds |
| API parity | `make check-parity` succeeds |
| Stubs correct | `make check-stubs` succeeds |
| Examples updated | All examples use new API |

**Commit after all checkpoints pass.**

---

### 13.7b.12 Rust API Parity (Completed)

Cross-language parity achieved. The following Rust APIs were added:

**Entry Points (consistent `read_*` naming):**
| API | Returns | Description |
|-----|---------|-------------|
| `read_json()` | `Tree` | Single JSON document |
| `read_json_with_schema()` | `Tree` | Single document with schema |
| `read_json_infer_schema()` | `Tree` | Single document with inferred schema |
| `read_jsonl()` | `Arbor` | Multiple documents (JSONL) |
| `read_jsonl_infer_schema()` | `Arbor` | Multiple documents with inferred schema |

**Helper Functions:**
| API | Description |
|-----|-------------|
| `from_trees()` | Create Arbor from multiple trees (errors on invalid index) |
| `matching_indices()` | Get indices of trees matching a predicate |

**Tree Type & Extension Trait:**
| API | Description |
|-----|-------------|
| `Tree` type | Ergonomic wrapper for single-tree access |
| `ArborTreeExt::tree(&self)` | Get Tree from Arbor (clones, arbor remains usable) |
| `ArborTreeExt::into_tree(self)` | Consume Arbor to get Tree (more efficient) |
| `Tree::tree_index()` | Get the tree index within the underlying Arbor |
| `Tree::storage_id()` | Unique identifier for underlying storage |

**Tree Transformation Methods (Parity with Python Tree):**
| API | Description |
|-----|-------------|
| `Tree::select(&[Expr])` | Project tree to selected expressions, returns new Tree |
| `Tree::add_field(name, &Expr)` | Add computed field at root, returns new Tree |
| `Tree::filter_array(path, &Expr)` | Filter array elements, returns new Tree |

**Arbor Storage:**
| API | Description |
|-----|-------------|
| `Arbor::storage_id()` | Unique identifier for underlying storage |

**Design Notes:**
- `Tree` stores `tree_idx` to correctly identify its position in the Arbor
- Transformation methods (`select`, `filter_array`) use `self.tree_idx` for correct operation
- `ArborTreeExt::tree()` borrows (cheap Arc clone) instead of consuming the Arbor
- `from_trees()` returns error on invalid tree index (no silent skipping)
- Tree transformation methods use `ArborBuilder` internally to produce new Trees

**Rust usage:**
```rust
use arbors::ArborTreeExt;
use arbors::expr::{path, lit};

// Single document → Tree
let tree = arbors::read_json(r#"{"name": "Alice", "age": 30}"#.as_bytes())?;
let name = tree.get_string(tree.get_field(tree.root(), "name").unwrap());

// Tree transformations
let projected = tree.select(&[path("name"), path("age")])?;
let enriched = tree.add_field("adult", &path("age").ge(lit(18)))?;

// JSONL → Arbor, then get Trees
let arbor = arbors::read_jsonl(data, None)?;
let tree0 = arbor.tree(0).unwrap();
let tree1 = arbor.tree(1).unwrap();
```

---

## Phase 13.8 Schema Specification and Tree/Collection Validation

**Purpose:** Define a schema dialect we can live with long-term (extensible types, pragmatic JSON Schema support), and implement validation against that schema with detailed, actionable errors at both **Tree** and **collection (JSONL/Arbor)** levels.

**Status:** Complete

**Scope:**
1. Define Arbors Schema dialect (JSON Schema subset + extensions)
2. Create new `arbors-validate` crate for validation logic
3. Implement Tree validation with rich error reporting
4. Implement Collection validation with three policies (absolute, strict, lax)
5. Add sized integer types and initial logical types (embedding, int range)
6. Python bindings with full parity

---

### 13.8.0 Design Decisions

#### Two Validation Modes (DECIDED)

Arbors supports **two schema/validation modes**:

| Mode | Description | Use Case |
|------|-------------|----------|
| **JSON Schema Mode** | Curated subset of JSON Schema | Interoperability with existing tooling |
| **Arbors Schema Mode** | JSON Schema subset + Arbors extensions | Richer types, storage hints, logical types |

**Key distinction:** In JSON Schema mode, the `arbors` extension block is ignored. In Arbors Schema mode, it's processed.

#### Validation Location (DECIDED: New Crate)

**Decision:** Create a new crate `arbors-validate` for validation logic.

**Rationale:**
- Clean separation of concerns (schema compilation vs validation)
- Can depend on `arbors-schema`, `arbors-storage`, `arbors-io`
- Avoids circular dependencies
- Validation is conceptually distinct from parsing/storage

#### Parse-time vs Post-hoc Validation (DECIDED: Both)

**Decision:** Keep both parse-time schema enforcement AND add post-hoc validation.

**Rationale:**
- Parse-time guidance enables storage optimizations (typed arrays, interning)
- Post-hoc validation enables validating data that was parsed without a schema
- Post-hoc validation enables validating against multiple schemas

```python
# Parse-time (existing) - guides storage layout
arbor = arbors.read_jsonl(data, schema=my_schema)

# Post-hoc (new) - validates already-parsed data
result = arbor.validate(schema, policy="strict")
if result.is_valid:
    valid_arbor = result.valid_arbor
```

#### Repair Policy (DEFERRED)

**Decision:** The `repair` policy is **deferred to a future phase** due to complexity.

The three policies for Phase 13.8 are:
- **absolute** - Stop on first error
- **strict** - Collect all errors, return valid subset
- **lax** - Warn only, all data passes

A future `repair` policy would auto-fix invalid data, but the semantics (drop escalation, validity contracts, nested required chains) are complex enough to warrant separate design work.

#### Sized Integer Types (DECIDED: Phase 13.8)

**Decision:** Add sized integer type validation in this phase.

**Types to support:**
- Signed: `i8`, `i16`, `i32`, `i64`
- Unsigned: `u8`, `u16`, `u32`, `u64`
- Floating: `float32`, `float64`

**Validation behavior:** Check bounds at validation time. Store in existing `Int64`/`Float64` pools (native sized storage is a future phase).

```json
{"type": "integer", "arbors": {"sizedType": "u8"}}
// Validates: 0-255 range
// Storage: Int64 pool (for now)
```

#### Initial Logical Types (DECIDED: Subset)

**Decision:** Implement two logical types to vet the design:

1. **`embedding`** - Fixed-length numeric array for vector embeddings
2. **`intRange`** - Integer range with bounds validation

These cover critical AI/ML use cases and test the extension mechanism without overcommitting.

```json
// Embedding (e.g., OpenAI ada-002 is 1536 dims)
{
  "type": "array",
  "arbors": {
    "logicalType": "embedding",
    "dimensions": 1536,
    "elemType": "float32"
  }
}

// Integer range
{
  "type": "object",
  "arbors": {
    "logicalType": "intRange",
    "itemType": "i32",
    "closedStart": true,
    "closedEnd": false
  }
}
```

#### Error Reporting (DECIDED: Rich Errors)

**Decision:** Errors include ALL of:
- **Data path:** JSON Pointer to the invalid value (e.g., `"/users/0/email"`)
- **Schema path:** JSON Pointer to the schema constraint that failed (e.g., `"#/properties/users/items/properties/email/format"`)
- Schema constraint that failed (e.g., `"format: email"`)
- Expected vs actual type
- Tree/document index (for collection validation)

**JSON Pointer encoding (RFC 6901):** Object keys containing `~` or `/` must be escaped:
- `~` → `~0`
- `/` → `~1`
- Example: key `"a/b"` → path `"/a~1b"`

**Rationale:** Error messages are the developer UI. Rich errors are essential for debugging large datasets. Dual paths (data + schema) align with `arbors_core::Error` patterns.

```rust
struct ValidationError {
    /// JSON Pointer to the value that failed validation (RFC 6901)
    data_path: String,
    /// JSON Pointer to the schema node that defines the constraint
    schema_path: String,
    /// Index of the tree in a collection (None for single tree)
    tree_index: Option<usize>,
    /// The kind of validation failure
    kind: ValidationErrorKind,
    /// Human-readable message
    message: String,
    /// Expected type/constraint (from schema)
    expected: String,
    /// Actual value description (from data)
    actual: String,
}
```

#### Schema Presets (DECIDED: Document Only)

**Decision:** Document common schemas as examples, don't ship built-in presets.

**Documented schemas:**
- OpenAI Chat Messages (fine-tuning format)
- OpenAI Tool Calls (function calling format)
- OpenAI Structured Output (response format)

**Rationale:** Schemas evolve. Built-in presets become stale. Documentation + examples let users adapt.

#### Schema vs Options Precedence (DECIDED: Schema Wins)

**Decision:** Schema constraints always take precedence over `ValidationOptions` settings.

| Option | Schema Keyword | Precedence |
|--------|---------------|------------|
| `allow_extra_fields=true` | `additionalProperties: false` | **Schema wins** - extra fields are errors |
| `allow_extra_fields=false` | `additionalProperties: true` | **Schema wins** - extra fields allowed |
| `coerce_types=true` | `type: "integer"` | **Option enables coercion** - but coerced value must satisfy schema |
| `coerce_types=false` | — | No coercion attempted |

**Rationale:** Options control *behavior* (coerce or not, stop early or not), but the schema is the source of truth for *validity*. An option cannot make invalid data valid; it can only enable transformations that produce valid data.

**Coercion availability:** Type coercion is available in both JSON Schema and Arbors Schema modes when `coerce_types=true`. The coerced result must still satisfy all schema constraints.

#### Unified Schema Compiler (DECIDED: Single Source of Truth)

**Problem:** The current `SchemaRegistry` / `StorageSchema` carries type/layout information but not validation constraints (`minLength`, `pattern`, `minimum`, etc.). Validation needs this data. Having two separate compilers (one for ingestion, one for validation) risks drift and user confusion.

**Solution:** A single `ValidatorSchema` wrapper that holds both storage layout and constraints, compiled in **one pass**:

```rust
/// Unified compiled schema for both ingestion and validation
/// Single source of truth - prevents drift between parse-time and validation
#[derive(Debug, Clone)]
pub struct ValidatorSchema {
    /// Storage layout for ingestion (existing SchemaRegistry functionality)
    pub registry: SchemaRegistry,
    /// Constraint tree for validation
    pub constraints: CompiledConstraints,
    /// Shared $ref resolution (same for both)
    pub refs: RefResolver,
}

impl ValidatorSchema {
    /// Compile from JSON Schema - single entry point
    pub fn compile(schema_json: &Value) -> Result<Self, SchemaError>;

    /// Access registry for ingestion
    pub fn registry(&self) -> &SchemaRegistry;

    /// Access constraints for validation
    pub fn constraints(&self) -> &CompiledConstraints;
}
```

**Key invariant:** If a JSON Schema is accepted for ingestion, it is accepted identically for validation. If it's rejected, the error is identical.

**Keyword-level `schema_path` rule:** When a constraint violation occurs, the error's `schema_path` points to the **specific failing keyword**, not just the node:
- `minLength` violation → `"{node.schema_path}/minLength"`
- `pattern` violation → `"{node.schema_path}/pattern"`
- `format` violation → `"{node.schema_path}/format"`
- `minimum` violation → `"{node.schema_path}/minimum"`
- Type mismatch → `"{node.schema_path}/type"`
- Required field missing → `"{node.schema_path}/required"` (field name in `ValidationErrorKind::MissingRequired { field }`)
- Unknown field (additionalProperties=false) → `"{obj.schema_path}/additionalProperties"`
- Field fails additionalProperties schema → `"{obj.schema_path}/additionalProperties{subpath}"` (subpath within the schema)

**`additionalProperties` handling:**
- `additionalProperties: true` or absent → allow all extra fields
- `additionalProperties: false` → deny extra fields; error schema_path = `.../additionalProperties`
- `additionalProperties: { schema }` → validate extra fields against schema; error schema_path follows the schema's internal keyword (e.g., `.../additionalProperties/minLength` if the extra field fails the nested schema's `minLength`)

**Unknown `format` handling:** Unknown format strings (not in the recognized set) are **ignored** (no-op). They do not cause errors in any policy. This follows JSON Schema's recommendation that unknown formats should not cause validation to fail.

```rust
/// Compiled constraints for a schema node
#[derive(Debug, Clone)]
pub struct CompiledConstraints {
    /// Type constraint (if any)
    pub type_constraint: Option<TypeConstraint>,
    /// String constraints
    pub string: Option<StringConstraints>,
    /// Number constraints
    pub number: Option<NumberConstraints>,
    /// Array constraints
    pub array: Option<ArrayConstraints>,
    /// Object constraints
    pub object: Option<ObjectConstraints>,
    /// Enum/const constraints
    pub enum_values: Option<Vec<serde_json::Value>>,
    pub const_value: Option<serde_json::Value>,
    /// Arbors extensions
    pub sized_type: Option<SizedType>,
    pub logical_type: Option<LogicalType>,
    /// Schema path to this node (e.g., "#/properties/email")
    pub schema_path: String,
}

#[derive(Debug, Clone)]
pub struct StringConstraints {
    pub min_length: Option<usize>,
    pub max_length: Option<usize>,
    pub pattern: Option<regex::Regex>,
    pub format: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NumberConstraints {
    pub minimum: Option<f64>,
    pub maximum: Option<f64>,
    pub exclusive_minimum: Option<f64>,
    pub exclusive_maximum: Option<f64>,
    pub multiple_of: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct ArrayConstraints {
    pub min_items: Option<usize>,
    pub max_items: Option<usize>,
    pub items_schema: Option<Box<CompiledConstraints>>,
    pub prefix_items: Option<Vec<CompiledConstraints>>,
}

#[derive(Debug, Clone)]
pub struct ObjectConstraints {
    pub required: Vec<String>,
    pub properties: HashMap<String, CompiledConstraints>,
    pub additional_properties: AdditionalProperties,
}

#[derive(Debug, Clone)]
pub enum AdditionalProperties {
    Allow,
    Deny,
    Schema(Box<CompiledConstraints>),
}
```

**Supported keywords (single source of truth):** Define `SUPPORTED_KEYWORDS` once in `arbors-schema`. Both ingestion and validation reference this list. Unsupported keywords are handled per policy (error in strict, warn in lax).

**Location:** `ValidatorSchema` and `CompiledConstraints` live in `crates/arbors-schema`. The validator in `arbors-validate` accepts `&ValidatorSchema`, not raw JSON Schema.

---

### 13.8.1 Schema Dialects

#### JSON Schema Mode (Subset)

Accept a curated subset of JSON Schema for interoperability:

**Supported keywords:**
- **Core structure:** `type`, `properties`, `required`, `additionalProperties` *(boolean or schema)*
- **Arrays:** `items` (single schema), `prefixItems` (tuples), `minItems`, `maxItems`
- **Scalars:** `enum`, `const`
- **Strings:** `minLength`, `maxLength`, `pattern`, `format` (recognized set)
- **Numbers:** `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`
- **Definitions/refs:** `$defs`, `$ref` (local refs only; no network fetching)
- **Boolean schemas:** `true` (accept any), `false` (reject all)
- **Metadata:** `title`, `description`, `default`

**Recognized `format` values:**
- `date`, `date-time`, `duration` (ISO 8601 - parsed and typed)
- `time` (ISO 8601 - validation-only for now, no dedicated storage type)
- `email`, `uri`, `uuid` (validation-only, no storage impact)
- `byte`, `binary` (both accepted for base64 - `binary` is alias for `byte`)

**Explicitly NOT supported:**
- Combinators: `oneOf`, `anyOf`, `allOf`, `not`
- Conditionals: `if`/`then`/`else`
- Regex-driven: `patternProperties`, `propertyNames`
- Complex: `unevaluatedProperties`, `contains`, `dependentSchemas`, `dependentRequired`, `dynamicRef`
- Remote `$ref` / URL fetching

**Behavior for unsupported keywords:**
- With `policy="absolute"` or `policy="strict"`: return an error listing unsupported keywords
- With `policy="lax"`: warn and ignore unsupported keywords

#### Arbors Schema Mode (JSON Schema + Extensions)

Start from JSON Schema subset, add Arbors extensions:

**Extension container:** Reserved keyword `arbors` (object) on any schema node.

```json
{
  "type": "string",
  "arbors": {
    "logicalType": "datetime",
    "unit": "micros",
    "tz": "UTC"
  }
}
```

**Versioning:** Arbors Schema documents SHOULD carry a version marker:
```json
{
  "$schema": "https://arbors.dev/schema/v1",
  "arborsSchemaVersion": 1,
  "type": "object",
  "properties": { ... }
}
```

**Extension keywords:**

| Keyword | Type | Description |
|---------|------|-------------|
| `logicalType` | string | Logical type name (embedding, intRange, etc.) |
| `sizedType` | string | Sized numeric type (u8, i16, float32, etc.) |
| `dimensions` | integer | For embedding: required vector length |
| `elemType` | string | For embedding: element type (float32, float64) |
| `itemType` | string | For range: element type |
| `closedStart` | boolean | For range: inclusive start |
| `closedEnd` | boolean | For range: inclusive end |
| `intern` | boolean | Hint: intern string values |
| `nullable` | boolean | Explicit nullable hint (overrides inference) |

---

### 13.8.2 Type System

#### Physical Types (Existing)

| Type | JSON | Arrow Storage |
|------|------|---------------|
| `null` | `null` | Null bitmap |
| `boolean` | `true`/`false` | BooleanArray |
| `integer` | JSON number | Int64Array |
| `number` | JSON number | Float64Array |
| `string` | JSON string | StringArray / interned |
| `binary` | base64 string | BinaryArray |
| `date` | ISO date string | Date32Array |
| `datetime` | ISO datetime string | TimestampMicrosArray |
| `duration` | ISO duration string | DurationMicrosArray |
| `object` | JSON object | Struct |
| `array` | JSON array | List |

#### Sized Integer Types (Phase 13.8)

| Type | Range | JSON Representation |
|------|-------|---------------------|
| `u8` | 0 to 255 | integer |
| `u16` | 0 to 65,535 | integer |
| `u32` | 0 to 4,294,967,295 | integer |
| `u64` | 0 to 18,446,744,073,709,551,615 | integer |
| `i8` | -128 to 127 | integer |
| `i16` | -32,768 to 32,767 | integer |
| `i32` | -2,147,483,648 to 2,147,483,647 | integer |
| `i64` | full i64 range | integer |
| `float32` | IEEE 754 single | number |
| `float64` | IEEE 754 double | number |

**Validation:** Bounds checking at validation time.
**Storage:** Int64/Float64 pools (native sized arrays in future phase).

**Important limitation (current ingestion):** JSON numbers that parse as `u64` but do not fit in `i64` are currently stored as `Float64` during ingestion, which is only exactly representable up to \(2^{53}\).
Phase 13.8 validation must define exactness rules for `sizedType: "u64"`:
- If the stored value is `Int64` and \(\ge 0\), it can be validated exactly within `i64::MAX`.
- If the stored value is `Float64`, treat it as an integer only when it is integer-valued **and** \(\le 2^{53}\); otherwise it must fail validation in `absolute/strict` and become a warning in `lax`.

**Required tests for u64 exactness:**
- `test_u64_validation_int64_positive` - positive Int64 validates as u64
- `test_u64_validation_int64_negative_fails` - negative Int64 fails u64 validation
- `test_u64_validation_float64_exact` - Float64 with integer value ≤ 2^53 validates
- `test_u64_validation_float64_non_integer_fails` - Float64 like 1.5 fails
- `test_u64_validation_float64_large_fails` - Float64 > 2^53 fails (not exact)
- `test_u64_validation_lax_warns` - lax policy warns instead of errors for above cases

#### Logical Types (Phase 13.8 Subset)

**1. Embedding**

Fixed-length numeric array for vector embeddings (ML models, search, etc.).

```json
{
  "type": "array",
  "items": {"type": "number"},
  "arbors": {
    "logicalType": "embedding",
    "dimensions": 1536,
    "elemType": "float32"
  }
}
```

**Validation:**
- Array length must equal `dimensions`
- All elements must be valid numbers
- Elements must fit in `elemType` range

**Use case:** OpenAI embeddings, Cohere embeddings, sentence transformers.

**2. Integer Range**

A range with start and end bounds, useful for intervals.

```json
{
  "type": "object",
  "properties": {
    "start": {"type": "integer"},
    "end": {"type": "integer"}
  },
  "required": ["start", "end"],
  "arbors": {
    "logicalType": "intRange",
    "itemType": "i32",
    "closedStart": true,
    "closedEnd": false
  }
}
```

**Validation:**
- Must have `start` and `end` fields
- Both must be valid integers within `itemType` bounds
- `start <= end` (optionally strict based on closed flags)

---

### 13.8.3 Validation Policies

#### Policy Semantics

| Policy | Single Tree | Collection (JSONL/Arbor) | Error Handling |
|--------|-------------|--------------------------|----------------|
| `absolute` | Accept/reject entire tree | Accept/reject entire collection | First error fails all |
| `strict` | Accept/reject entire tree | Reject invalid trees, keep valid | Errors per tree, collection succeeds if any valid |
| `lax` | Allow all, collect warnings | Allow all, collect warnings | Warnings only, no failures |

#### Absolute Policy

- Any validation error rejects the entire input
- For collections: one bad tree = entire collection rejected
- Use case: Data quality gates, CI/CD pipelines

#### Strict Policy

- For single tree: same as absolute
- For collections: each tree validated independently
  - Valid trees kept, invalid trees rejected
  - Returns lists of accepted/rejected indices
  - **Job succeeds if at least one tree is valid**
  - **Job fails if zero trees are valid** (all rejected)
- Use case: Batch processing with error isolation

**Success criteria:** `len(accepted_indices) >= 1`. A collection where every tree fails validation is itself a failure, even in strict mode.

#### Lax Policy

- Allow non-conforming data through unchanged
- Collect warnings for all violations
- No data transformation
- Use case: Exploratory analysis, debugging schemas

---

### 13.8.4 API Design

#### Rust API

```rust
// ============================================================================
// Core Types (in arbors-validate)
// ============================================================================

/// Validation mode: JSON Schema subset or Arbors Schema with extensions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ValidationMode {
    #[default]
    JsonSchema,
    ArborsSchema,
}

/// Validation policy controlling failure behavior
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ValidationPolicy {
    #[default]
    Absolute,
    Strict,
    Lax,
}

/// How to handle unknown logical types in Arbors Schema mode
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum UnknownLogicalTypePolicy {
    Error,
    #[default]
    Warn,
    Ignore,
}

/// Options for validation
#[derive(Debug, Clone)]
pub struct ValidationOptions {
    /// Validation mode
    pub mode: ValidationMode,
    /// Failure policy
    pub policy: ValidationPolicy,
    /// Allow fields not in schema (default: true for open objects)
    pub allow_extra_fields: bool,
    /// Attempt type coercion (string→int, int→float)
    pub coerce_types: bool,
    /// Maximum errors to collect before stopping (None = unlimited)
    pub max_errors: Option<usize>,
    /// How to handle unknown logical types
    pub unknown_logical_types: UnknownLogicalTypePolicy,
}

impl Default for ValidationOptions {
    fn default() -> Self {
        Self {
            mode: ValidationMode::JsonSchema,
            policy: ValidationPolicy::Absolute,
            allow_extra_fields: true,
            coerce_types: false,
            max_errors: None,
            unknown_logical_types: UnknownLogicalTypePolicy::Warn,
        }
    }
}

// ============================================================================
// Error Types
// ============================================================================

/// Kind of validation error
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidationErrorKind {
    /// Type mismatch (expected X, got Y)
    TypeMismatch { expected: String, actual: String },
    /// Required field missing
    MissingRequired { field: String },
    /// Value outside allowed range
    OutOfRange { constraint: String, value: String },
    /// String doesn't match pattern
    PatternMismatch { pattern: String, value: String },
    /// String doesn't match format
    FormatMismatch { format: String, value: String },
    /// Array length violation
    ArrayLength { expected: String, actual: usize },
    /// Enum value not in allowed set
    InvalidEnum { allowed: Vec<String>, actual: String },
    /// Unknown field in closed object
    UnknownField { field: String },
    /// Logical type validation failed
    LogicalTypeError { logical_type: String, details: String },
    /// Sized type bounds exceeded
    SizedTypeBounds { sized_type: String, value: String },
    /// Schema error (unsupported keyword, invalid schema)
    SchemaError { details: String },
}

/// A single validation error
#[derive(Debug, Clone)]
pub struct ValidationError {
    /// JSON Pointer path to the invalid value (RFC 6901)
    pub data_path: String,
    /// JSON Pointer path to the schema constraint that failed
    pub schema_path: String,
    /// Tree index in collection (None for single tree)
    pub tree_index: Option<usize>,
    /// Error kind
    pub kind: ValidationErrorKind,
    /// Human-readable message
    pub message: String,
    /// Expected type/constraint (from schema)
    pub expected: String,
    /// Actual value description (from data)
    pub actual: String,
}

/// A validation warning (for lax mode)
#[derive(Debug, Clone)]
pub struct ValidationWarning {
    /// JSON Pointer path to the data
    pub data_path: String,
    /// JSON Pointer path to the schema constraint
    pub schema_path: String,
    /// Tree index in collection
    pub tree_index: Option<usize>,
    /// Warning message
    pub message: String,
}

// ============================================================================
// Result Types
// ============================================================================

/// Result of validating a single tree
#[derive(Debug, Clone)]
pub struct TreeValidationResult {
    /// Is the tree valid?
    pub is_valid: bool,
    /// Validation errors (empty if valid)
    pub errors: Vec<ValidationError>,
    /// Validation warnings (lax mode)
    pub warnings: Vec<ValidationWarning>,
}

/// Result of validating a collection
#[derive(Debug, Clone)]
pub struct CollectionValidationResult {
    /// Policy used
    pub policy: ValidationPolicy,
    /// Total trees in collection
    pub total_trees: usize,
    /// Indices of accepted trees (strict mode: valid trees; absolute: all or none; lax: all)
    pub accepted_indices: Vec<usize>,
    /// Indices of rejected trees (strict mode: invalid trees; absolute: all on failure; lax: none)
    pub rejected_indices: Vec<usize>,
    /// All errors (with tree_index populated)
    pub errors: Vec<ValidationError>,
    /// All warnings (lax mode)
    pub warnings: Vec<ValidationWarning>,
    /// Collection of accepted trees only (convenience for strict mode)
    pub valid_arbor: Option<Arbor>,
}

// ============================================================================
// Validator Trait and Implementation
// ============================================================================

/// Tree validator
pub struct TreeValidator<'a> {
    schema: &'a ValidatorSchema,
    options: ValidationOptions,
}

impl<'a> TreeValidator<'a> {
    pub fn new(schema: &'a ValidatorSchema, options: ValidationOptions) -> Self;

    /// Validate a tree
    pub fn validate(&self, arbor: &Arbor, root: NodeId) -> TreeValidationResult;

    /// Validate a specific path within a tree
    pub fn validate_path(
        &self,
        arbor: &Arbor,
        root: NodeId,
        path: &str,
    ) -> TreeValidationResult;
}

/// Collection validator
pub struct CollectionValidator<'a> {
    schema: &'a ValidatorSchema,
    options: ValidationOptions,
}

impl<'a> CollectionValidator<'a> {
    pub fn new(schema: &'a ValidatorSchema, options: ValidationOptions) -> Self;

    /// Validate all trees in an arbor
    pub fn validate(&self, arbor: &Arbor) -> CollectionValidationResult;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/// Validate a tree with default options
pub fn validate_tree(
    arbor: &Arbor,
    root: NodeId,
    schema: &SchemaRegistry,
) -> TreeValidationResult;

/// Validate a tree with options
pub fn validate_tree_with_options(
    arbor: &Arbor,
    root: NodeId,
    schema: &SchemaRegistry,
    options: ValidationOptions,
) -> TreeValidationResult;

/// Validate a collection with default options
pub fn validate_collection(
    arbor: &Arbor,
    schema: &SchemaRegistry,
) -> CollectionValidationResult;

/// Validate a collection with options
pub fn validate_collection_with_options(
    arbor: &Arbor,
    schema: &SchemaRegistry,
    options: ValidationOptions,
) -> CollectionValidationResult;
```

#### Python API

```python
# ============================================================================
# Enums
# ============================================================================

class ValidationMode(Enum):
    """Validation mode."""
    JSON_SCHEMA = "json_schema"
    ARBORS_SCHEMA = "arbors_schema"

class ValidationPolicy(Enum):
    """Validation policy controlling failure behavior."""
    ABSOLUTE = "absolute"  # Fail on first error
    STRICT = "strict"      # Reject invalid trees, keep valid
    LAX = "lax"            # Allow all, collect warnings

# ============================================================================
# Options
# ============================================================================

@dataclass
class ValidationOptions:
    """Options for validation."""
    mode: ValidationMode = ValidationMode.JSON_SCHEMA
    policy: ValidationPolicy = ValidationPolicy.ABSOLUTE
    allow_extra_fields: bool = True
    coerce_types: bool = False
    max_errors: int | None = None

# ============================================================================
# Error Types
# ============================================================================

@dataclass
class ValidationError:
    """A validation error."""
    data_path: str          # JSON Pointer to invalid value
    schema_path: str        # JSON Pointer to schema constraint
    tree_index: int | None
    kind: str               # TypeMismatch, MissingRequired, etc.
    message: str
    expected: str           # From schema
    actual: str             # From data

@dataclass
class ValidationWarning:
    """A validation warning."""
    data_path: str
    schema_path: str
    tree_index: int | None
    message: str

# ============================================================================
# Result Types
# ============================================================================

@dataclass
class TreeValidationResult:
    """Result of validating a single tree."""
    is_valid: bool
    errors: list[ValidationError]
    warnings: list[ValidationWarning]

@dataclass
class CollectionValidationResult:
    """Result of validating a collection."""
    policy: ValidationPolicy
    total_trees: int
    accepted_indices: list[int]
    rejected_indices: list[int]
    errors: list[ValidationError]
    warnings: list[ValidationWarning]
    valid_arbor: Arbor | None  # Collection of accepted trees (strict mode)

# ============================================================================
# Tree Methods
# ============================================================================

class Tree:
    def validate(
        self,
        schema: Schema,
        *,
        mode: str = "json_schema",
        policy: str = "absolute",
        allow_extra_fields: bool = True,
        coerce_types: bool = False,
        max_errors: int | None = None,
    ) -> TreeValidationResult:
        """Validate this tree against a schema.

        Args:
            schema: Schema to validate against
            mode: "json_schema" or "arbors_schema"
            policy: "absolute", "strict", or "lax"
            allow_extra_fields: Allow fields not in schema
            coerce_types: Attempt type coercion
            max_errors: Maximum errors to collect

        Returns:
            TreeValidationResult with is_valid, errors, and warnings

        Example:
            >>> tree = arbors.read_json('{"name": "Alice", "age": "30"}')
            >>> schema = arbors.Schema(name=arbors.String, age=arbors.Int64)
            >>> result = tree.validate(schema, coerce_types=True)
            >>> result.is_valid  # True if coercion succeeded
            True
        """
        ...

# ============================================================================
# Arbor Methods
# ============================================================================

class Arbor:
    def validate(
        self,
        schema: Schema,
        *,
        mode: str = "json_schema",
        policy: str = "absolute",
        allow_extra_fields: bool = True,
        coerce_types: bool = False,
        max_errors: int | None = None,
    ) -> CollectionValidationResult:
        """Validate all trees in this arbor against a schema.

        Args:
            schema: Schema to validate against
            mode: "json_schema" or "arbors_schema"
            policy: "absolute", "strict", or "lax"
            allow_extra_fields: Allow fields not in schema
            coerce_types: Attempt type coercion
            max_errors: Maximum errors to collect

        Returns:
            CollectionValidationResult with per-tree results

        Example:
            >>> arbor = arbors.read_jsonl('{"id": 1}\\n{"id": "bad"}\\n{"id": 3}')
            >>> schema = arbors.Schema(id=arbors.Int64)
            >>> result = arbor.validate(schema, policy="strict")
            >>> result.accepted_indices
            [0, 2]
            >>> result.rejected_indices
            [1]
            >>> result.valid_arbor  # Arbor with only valid trees
        """
        ...
```

---

### 13.8.5 Definitive Symbol Inventory

#### New Crate to Create

| Crate | Purpose |
|-------|---------|
| `crates/arbors-validate` | Tree and collection validation against schemas |

#### New Files to Create

**In `crates/arbors-schema` (unified compiler):**

| File | Purpose |
|------|---------|
| `crates/arbors-schema/src/constraints.rs` | CompiledConstraints, StringConstraints, NumberConstraints, etc. |
| `crates/arbors-schema/src/validator_schema.rs` | ValidatorSchema (unified wrapper) |
| `crates/arbors-schema/src/keywords.rs` | SUPPORTED_KEYWORDS (single source of truth) |

**In `crates/arbors-validate` (validators):**

| File | Purpose |
|------|---------|
| `crates/arbors-validate/Cargo.toml` | Crate manifest |
| `crates/arbors-validate/src/lib.rs` | Main module, re-exports |
| `crates/arbors-validate/src/error.rs` | Error types (ValidationError, ValidationWarning) |
| `crates/arbors-validate/src/options.rs` | ValidationMode, ValidationPolicy, ValidationOptions |
| `crates/arbors-validate/src/result.rs` | TreeValidationResult, CollectionValidationResult |
| `crates/arbors-validate/src/tree_validator.rs` | TreeValidator implementation |
| `crates/arbors-validate/src/collection_validator.rs` | CollectionValidator implementation |
| `crates/arbors-validate/src/coerce.rs` | Type coercion logic |
| `crates/arbors-validate/src/logical_types.rs` | Logical type validators (embedding, intRange) |
| `crates/arbors-validate/src/sized_types.rs` | Sized integer type validation |

#### Symbols to Add

**In `crates/arbors-validate/src/lib.rs`:**

| Symbol | Type | Description |
|--------|------|-------------|
| `ValidationMode` | enum | JsonSchema, ArborsSchema |
| `ValidationPolicy` | enum | Absolute, Strict, Lax |
| `ValidationOptions` | struct | All validation options |
| `ValidationErrorKind` | enum | TypeMismatch, MissingRequired, UnknownField, OutOfRange, etc. |
| `ValidationError` | struct | Error with data_path, schema_path, expected, actual |
| `ValidationWarning` | struct | Warning with data_path, schema_path, message |
| `TreeValidationResult` | struct | Single tree result (is_valid, errors, warnings) |
| `CollectionValidationResult` | struct | Collection result (accepted_indices, rejected_indices, errors, warnings, valid_arbor) |
| `TreeValidator` | struct | Tree validation engine |
| `CollectionValidator` | struct | Collection validation engine |
| `validate_tree()` | function | Convenience function |
| `validate_tree_with_options()` | function | With options |
| `validate_collection()` | function | Convenience function |
| `validate_collection_with_options()` | function | With options |

**In `crates/arbors-schema/src/lib.rs` (unified compiler):**

| Symbol | Type | Description |
|--------|------|-------------|
| `ValidatorSchema` | struct | Unified schema: registry + constraints + refs |
| `CompiledConstraints` | struct | Constraint tree node with schema_path |
| `StringConstraints` | struct | minLength, maxLength, pattern, format |
| `NumberConstraints` | struct | minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf |
| `ArrayConstraints` | struct | minItems, maxItems, items_schema, prefix_items |
| `ObjectConstraints` | struct | required, properties, additionalProperties |
| `AdditionalProperties` | enum | Allow, Deny, Schema |
| `TypeConstraint` | enum | String, Integer, Number, Boolean, Array, Object, Null |
| `RefResolver` | struct | Shared $ref resolution |
| `SUPPORTED_KEYWORDS` | const | Single source of truth for accepted keywords |
| `SizedType` | enum | u8, u16, u32, u64, i8, i16, i32, i64, float32, float64 |
| `LogicalType` | enum | Embedding, IntRange (extensible) |
| `ArborsExtension` | struct | Parsed `arbors` block |

**In `python/src/lib.rs`:**

| Symbol | Type | PyO3 name | Description |
|--------|------|-----------|-------------|
| `PyValidationMode` | enum | `ValidationMode` | Mode enum |
| `PyValidationPolicy` | enum | `ValidationPolicy` | Policy enum |
| `PyValidationOptions` | class | `ValidationOptions` | Options |
| `PyValidationError` | class | `ValidationError` | Error |
| `PyValidationWarning` | class | `ValidationWarning` | Warning |
| `PyTreeValidationResult` | class | `TreeValidationResult` | Tree result |
| `PyCollectionValidationResult` | class | `CollectionValidationResult` | Collection result |

**In `python/arbors/_arbors.pyi`:**

| Symbol | Signature |
|--------|-----------|
| `class ValidationMode` | Enum: JsonSchema, ArborsSchema |
| `class ValidationPolicy` | Enum: Absolute, Strict, Lax |
| `class ValidationOptions` | Dataclass-like with mode, policy, coerce_types, etc. |
| `class ValidationError` | Error with data_path, schema_path, expected, actual |
| `class ValidationWarning` | Warning with data_path, schema_path, message |
| `class TreeValidationResult` | Result with is_valid, errors, warnings |
| `class CollectionValidationResult` | Result with accepted_indices, rejected_indices, errors, warnings, valid_arbor |
| `Tree.validate(schema, ...) -> TreeValidationResult` | Tree validation method |
| `Arbor.validate(schema, ...) -> CollectionValidationResult` | Arbor validation method |

---

### 13.8.6 Execution Steps

**Strategy:** Build from core types up. Constraint data model first, then error types, then tree validator, then collection validator, then Python bindings.

---

#### Step 1: Create arbors-validate crate scaffold

**Commit:** `feat(validate): create arbors-validate crate scaffold`

**Tasks:**
- [x] Create `crates/arbors-validate/Cargo.toml`
- [x] Add to workspace `Cargo.toml`
- [x] Create `crates/arbors-validate/src/lib.rs` with module structure
- [x] Add dependencies: arbors-core, arbors-schema, arbors-storage, arbors-io, thiserror
- [x] Create empty module files (error.rs, options.rs, result.rs, etc.)

**Checkpoint:** `cargo build -p arbors-validate` ✓

---

#### Step 2: Implement unified ValidatorSchema in arbors-schema

**Commit:** `feat(schema): implement unified ValidatorSchema with constraints`

**Tasks:**
- [x] Create `crates/arbors-schema/src/keywords.rs` with `SUPPORTED_KEYWORDS` constant
- [x] Create `crates/arbors-schema/src/constraints.rs`:
  - `CompiledConstraints` struct with schema_path field
  - `StringConstraints` struct (minLength, maxLength, pattern, format)
  - `NumberConstraints` struct (minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf)
  - `ArrayConstraints` struct (minItems, maxItems, items_schema, prefix_items)
  - `ObjectConstraints` struct (required, properties, additional_properties)
  - `AdditionalProperties` enum (Allow, Deny, Schema)
  - `TypeConstraint` enum
- [x] Create `crates/arbors-schema/src/validator_schema.rs`:
  - `ValidatorSchema` struct (registry + constraints + refs)
  - `ValidatorSchema::compile(schema_json: &Value) -> Result<Self>` - single entry point
  - `ValidatorSchema::registry(&self)` - access for ingestion
  - `ValidatorSchema::constraints(&self)` - access for validation
- [x] Update existing `SchemaCompiler` to produce `ValidatorSchema` instead of just `SchemaRegistry`
- [x] Ensure `$ref` resolution is shared between registry and constraints
- [x] Add golden tests: compile schema, verify ingestion/validation accept identically
- [x] Add round-trip tests: compile → validate bad data → verify `schema_path` points to keyword (e.g., `.../minLength`)

**Checkpoint:** `cargo test -p arbors-schema` ✓

---

#### Step 3: Define error and result types

**Commit:** `feat(validate): define error, warning, and result types`

**Tasks:**
- [x] Implement `ValidationErrorKind` enum in `error.rs`
- [x] Implement `ValidationError` struct with data_path, schema_path, tree_index, kind, message, expected, actual
- [x] Implement `ValidationWarning` struct with data_path, schema_path, tree_index, message
- [x] Implement `TreeValidationResult` in `result.rs` (is_valid, errors, warnings)
- [x] Implement `CollectionValidationResult` (policy, total_trees, accepted/rejected_indices, errors, warnings, valid_arbor)
- [x] Add Display impls for user-friendly error messages
- [x] Add unit tests for error formatting

**Checkpoint:** `cargo test -p arbors-validate` ✓

---

#### Step 4: Define options and enums

**Commit:** `feat(validate): define validation options and enums`

**Tasks:**
- [x] Implement `ValidationMode` enum in `options.rs`
- [x] Implement `ValidationPolicy` enum (Absolute, Strict, Lax)
- [x] Implement `UnknownLogicalTypePolicy` enum
- [x] Implement `ValidationOptions` struct with Default
- [x] Add builder pattern for ergonomic option construction
- [x] Re-export from lib.rs

**Checkpoint:** `cargo build -p arbors-validate` ✓

---

#### Step 5: Add sized integer types to arbors-schema

**Commit:** `feat(schema): add sized integer type support`

**Tasks:**
- [x] Define `SizedType` enum in `crates/arbors-schema/src/sized_types.rs`
- [x] Implement bounds constants for each sized type
- [x] Add `ArborsExtension` struct to parse `arbors` block
- [x] Extend `StorageSchema` to include optional `ArborsExtension`
- [x] Update `SchemaCompiler` to parse `arbors.sizedType`
- [x] Add unit tests for sized type parsing

**Checkpoint:** `cargo test -p arbors-schema` ✓ (473 unit tests + 26 doc tests pass)

---

#### Step 6: Add initial logical types to arbors-schema

**Commit:** `feat(schema): add embedding and intRange logical types`

**Tasks:**
- [x] Define `LogicalType` enum (Embedding, IntRange)
- [x] Define `EmbeddingParams` struct (dimensions, elemType)
- [x] Define `IntRangeParams` struct (itemType, closedStart, closedEnd)
- [x] Update `ArborsExtension` to include logicalType parsing
- [x] Update `SchemaCompiler` to parse logical types
- [x] Add unit tests for logical type parsing

**Checkpoint:** `cargo test -p arbors-schema` ✓ (519 unit tests + 26 doc tests pass)

---

#### Step 7: Implement sized type validation

**Commit:** `feat(validate): implement sized integer type validation`

**Tasks:**
- [x] Create `crates/arbors-validate/src/sized_types.rs`
- [x] Implement `validate_sized_int(value: i64, sized_type: SizedType) -> Result<(), ValidationError>`
- [x] Implement `validate_sized_float(value: f64, sized_type: SizedType) -> Result<(), ValidationError>`
- [x] Add comprehensive bounds checking tests

**Checkpoint:** `cargo test -p arbors-validate` ✓ (115 unit tests + 4 doc tests pass)

---

#### Step 8: Implement logical type validation

**Commit:** `feat(validate): implement embedding and intRange validation`

**Tasks:**
- [x] Create `crates/arbors-validate/src/logical_types.rs`
- [x] Implement `validate_embedding(arbor, node, params) -> Result<(), ValidationError>`
  - Check array length == dimensions
  - Check all elements are numbers
  - Check element bounds for elemType
- [x] Implement `validate_int_range(arbor, node, params) -> Result<(), ValidationError>`
  - Check start/end fields exist
  - Check types are integers
  - Check bounds for itemType
  - Check start <= end
- [x] Add comprehensive tests

**Checkpoint:** `cargo test -p arbors-validate` ✓ (143 unit tests + 4 doc tests pass)

---

#### Step 9: Implement type coercion

**Commit:** `feat(validate): implement type coercion`

**Tasks:**
- [x] Create `crates/arbors-validate/src/coerce.rs`
- [x] Implement string-to-int coercion
- [x] Implement string-to-float coercion
- [x] Implement int-to-float widening
- [x] Implement string-to-temporal (date, datetime, duration)
- [x] Return coerced value or error with suggestion
- [x] Add comprehensive tests

**Coercion matrix:**
| From | To | Action |
|------|----|--------|
| String `"123"` | Int | Parse if valid |
| String `"12.5"` | Float | Parse if valid |
| Int | Float | Widen |
| String ISO date | Date | Parse if valid |
| String ISO datetime | DateTime | Parse if valid |
| String base64 | Binary | Decode if valid |

**Checkpoint:** `cargo test -p arbors-validate` ✓ (216 unit tests + 4 doc tests pass)

---

#### Step 10: Implement core TreeValidator

**Commit:** `feat(validate): implement TreeValidator core`

**Tasks:**
- [x] Create `crates/arbors-validate/src/tree_validator.rs`
- [x] Implement `TreeValidator::new(schema, options)`
- [x] Implement recursive validation:
  - `validate_node(arbor, node, constraints, data_path, errors)` - main dispatch
  - `validate_scalar(arbor, node, constraints, data_path, errors)`
  - `validate_object(arbor, node, constraints, data_path, errors)`
  - `validate_array(arbor, node, constraints, data_path, errors)`
  - `validate_tuple(arbor, node, constraints, data_path, errors)`
- [x] Implement JSON Pointer path building (RFC 6901)
- [x] Implement max_errors short-circuit
- [x] Implement `validate()` returning `TreeValidationResult`
- [x] Add unit tests for each node type

**Checkpoint:** `cargo test -p arbors-validate` ✓ (245 unit tests + 4 doc tests pass)

---

#### Step 11: Implement constraint validation

**Commit:** `feat(validate): implement JSON Schema constraint validation`

**Tasks:**
- [x] Extend compiled schema representation to retain constraint metadata (min/max, length, pattern, format, enum/const, additionalProperties) and ensure `schema_path` can point to the specific failing keyword (e.g., `.../format`, `.../minimum`)
- [x] Implement string constraints: minLength, maxLength, pattern, format
- [x] Implement number constraints: minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf
- [x] Implement array constraints: minItems, maxItems
- [x] Implement enum/const validation
- [x] Implement required field checking
- [x] Implement additionalProperties checking
- [x] Add comprehensive constraint tests

**Checkpoint:** `cargo test -p arbors-validate` ✓ (271 unit tests + 4 doc tests pass)

---

#### Step 12: Implement CollectionValidator

**Commit:** `feat(validate): implement CollectionValidator`

**Tasks:**
- [x] Create `crates/arbors-validate/src/collection_validator.rs`
- [x] Implement `CollectionValidator::new(schema, options)`
- [x] Implement policy-specific logic:
  - Absolute: fail on first error, reject entire collection
  - Strict: validate all, track accepted/rejected, build valid_arbor
  - Lax: validate all, collect warnings only, accept all
- [x] Ensure strict mode fails if zero trees are valid
- [x] Implement `validate()` returning `CollectionValidationResult`
- [x] Add comprehensive tests for each policy

**Checkpoint:** `cargo test -p arbors-validate` ✓ (287 unit tests + 4 doc tests pass)

---

#### Step 13: Add Rust integration tests

**Commit:** `test(validate): add comprehensive integration tests`

**Test file:** `crates/arbors-validate/tests/validation_integration.rs`

**Test cases (core validation):**
- [x] `test_validate_simple_object` - basic object validation
- [x] `test_validate_nested_object` - nested path validation
- [x] `test_validate_array_items` - array item validation
- [x] `test_validate_tuple` - prefixItems validation
- [x] `test_validate_required_fields` - missing required
- [x] `test_validate_type_mismatch` - wrong types
- [x] `test_validate_string_constraints` - minLength, maxLength, pattern
- [x] `test_validate_number_constraints` - min, max, multipleOf
- [x] `test_validate_enum` - enum values
- [x] `test_validate_const` - const values
- [x] `test_validate_sized_int_u8` - u8 bounds
- [x] `test_validate_sized_int_i32` - i32 bounds
- [x] `test_validate_embedding` - vector embedding
- [x] `test_validate_int_range` - range validation

**Test cases (policies):**
- [x] `test_policy_absolute` - fails on first error
- [x] `test_policy_strict` - accepts/rejects per tree
- [x] `test_policy_strict_zero_valid_fails` - strict with 0 valid trees fails
- [x] `test_policy_strict_valid_arbor` - strict builds valid_arbor
- [x] `test_policy_lax` - collects warnings only
- [x] `test_tree_validator_with_lax_policy` - single tree lax returns warnings

**Test cases (coercion):**
- [x] `test_coercion_string_to_int` - type coercion
- [x] `test_coercion_int_to_float` - widening

**Test cases (u64 exactness - per 13.8.2):**
- [x] `test_u64_validation_int64_positive` - positive Int64 validates as u64
- [x] `test_u64_validation_int64_negative_fails` - negative Int64 fails u64
- [x] `test_u64_validation_float64_exact` - Float64 integer ≤ 2^53 validates
- [x] `test_u64_validation_float64_non_integer_fails` - Float64 like 1.5 fails
- [x] `test_u64_validation_float64_large_fails` - Float64 > 2^53 fails (not exact)
- [x] `test_u64_validation_lax_warns` - lax policy warns instead of errors

**Test cases (additionalProperties - per 13.8.0):**
- [x] `test_additional_properties_false` - deny extra fields
- [x] `test_additional_properties_schema` - validate extra fields against schema
- [x] `test_additional_properties_true` - allow all extra fields

**Test cases (JSON Pointer RFC 6901 - per 13.8.0):**
- [x] `test_json_pointer_encoding_slash` - "/" encoded as "~1"
- [x] `test_json_pointer_encoding_tilde` - "~" encoded as "~0"

**Test cases (format validation - per 13.8.1):**
- [x] `test_format_email` - email validation
- [x] `test_format_date` - ISO date validation
- [x] `test_format_datetime` - ISO datetime validation
- [x] `test_format_uuid` - UUID validation
- [x] `test_format_unknown_ignored` - unknown formats are no-op

**Test cases (boolean schemas - per 13.8.1):**
- [x] `test_boolean_schema_true` - accepts any value
- [x] `test_boolean_schema_false` - rejects all values

**Test cases ($ref/$defs - per 13.8.1):**
- [x] `test_ref_defs_basic` - basic $ref to $defs
- [x] `test_ref_defs_nested` - nested $ref usage
- [x] `test_ref_array_items` - $ref in array items

**Test cases (error reporting):**
- [x] `test_max_errors` - stops at limit
- [x] `test_error_data_path_format` - JSON Pointer format for data
- [x] `test_error_schema_path_format` - JSON Pointer format for schema
- [x] `test_error_message_quality` - rich error messages with expected/actual

**Test cases (edge cases):**
- [x] `test_nullable_type` - nullable type validation
- [x] `test_empty_arbor_validation` - empty arbor handling

**Checkpoint:** `cargo test` ✓ — 49 integration tests pass

**Implementation fixes made during test development:**
- Fixed `additionalProperties: false` to always reject extra fields (schema takes precedence over options per 13.8.0)
- Added `reject_all` flag to `CompiledConstraints` for boolean schema `false` support
- Added `is_reject()` method to check for boolean schema `false`

---

#### Step 14: Python bindings for result types

**Commit:** `feat(python): add validation result types`

**Tasks:**
- [x] Define `PyValidationError` class in `python/src/lib.rs`
- [x] Define `PyValidationWarning` class
- [x] Define `PyTreeValidationResult` class
- [x] Define `PyCollectionValidationResult` class
- [x] Implement conversion from Rust types
- [x] Register all classes in module

**Checkpoint:** `make python` ✓

**Implementation notes:**
- Added `ValidationError`, `ValidationWarning`, `TreeValidationResult`, `CollectionValidationResult` classes
- All classes are frozen (immutable) with proper getters
- `__repr__`, `__str__`, and `__bool__` methods implemented for all result types
- `CollectionValidationResult` stores inner Rust `Arbor` to avoid Clone requirement on Python wrapper
- Error `kind` field extracts enum variant name from Rust `ValidationErrorKind`

---

#### Step 15: Python bindings for validation methods

**Commit:** `feat(python): add Tree.validate() and Arbor.validate()`

**Tasks:**
- [x] Add `validate()` method to PyTree
- [x] Add `validate()` method to PyArbor
- [x] Accept keyword arguments for options
- [x] Convert policy/mode strings to enums
- [x] Return appropriate result type
- [x] Add error handling for invalid options

**Checkpoint:** `make python` ✓

---

#### Step 16: Update Python stubs and exports

**Commit:** `docs(python): add validation stubs and exports`

**Tasks:**
- [x] Add all validation classes to `python/arbors/_arbors.pyi`
- [x] Add `Tree.validate()` method signature with full docstring
- [x] Add `Arbor.validate()` method signature with full docstring
- [x] Add validation classes to `python/arbors/__init__.py` imports
- [x] Add to `__all__` list
- [x] Update `python/api_manifest.toml`

**Checkpoint:** `make check-stubs && make check-parity` ✓

---

#### Step 17: Python tests

**Commit:** `test(python): add validation tests`

**Test file:** `python/tests/test_validation.py`

**Test cases:**
- [x] `test_tree_validate_simple` - basic validation
- [x] `test_tree_validate_errors` - error collection
- [x] `test_tree_validate_coercion` - type coercion
- [x] `test_arbor_validate_absolute` - absolute policy
- [x] `test_arbor_validate_strict` - strict policy
- [x] `test_arbor_validate_strict_valid_arbor` - strict returns valid_arbor
- [x] `test_arbor_validate_strict_zero_fails` - strict with 0 valid fails
- [x] `test_arbor_validate_lax` - lax policy
- [x] `test_validation_error_fields` - error has data_path, schema_path, expected, actual
- [x] `test_sized_type_validation` - sized int types
- [x] `test_embedding_validation` - embedding logical type
- [x] `test_int_range_validation` - range logical type
- [x] `test_error_data_path_format` - JSON Pointer paths for data
- [x] `test_error_schema_path_format` - JSON Pointer paths for schema

**Checkpoint:** `make test` ✓

---

#### Step 18: Documentation and examples

**Commit:** `docs(validate): add validation documentation and examples`

**Tasks:**
- [x] Add module docstring to `crates/arbors-validate/src/lib.rs`
- [x] Add docstrings to all public types
- [x] Create example schema files in `docs/examples/schemas/`
  - OpenAI chat messages format
  - OpenAI tool calls format
  - Embedding dataset format
- [x] Update README if it mentions validation (N/A - README doesn't mention validation)

**Checkpoint:** Examples run successfully ✓

---

#### Step 19: Add *Actually* Pragmatic JSON Schema Support

**Commit:** `feat(schema): add comprehensive JSON Schema Draft-07 validation support`

**Problem Statement:**

During Step 18, we attempted to create example schemas for real-world use cases (OpenAI Chat API, embeddings). We immediately hit multiple limitations that required dumbing down the schemas. This proves our "pragmatic subset" is not actually pragmatic for real-world use.

**Issues Encountered:**

| Feature | Error | Real-World Use Case |
|---------|-------|---------------------|
| `["string", "null"]` | "multi-type unions not supported" | Nullable fields everywhere |
| `oneOf` | "Unsupported keyword" | Union types: content can be string OR array |
| `const` | Parsed but not validated | Discriminator fields: `"type": "function"` |
| `pattern` | Silently ignored | ID formats: `^call_[a-zA-Z0-9]+$` |
| `format` | Silently ignored for non-temporal | `"format": "uri"`, `"format": "email"` |
| `examples` | Silently ignored (OK) | Documentation only |
| `default` | Silently ignored (OK) | Documentation only |
| `uniqueItems` | Silently ignored | Unique array elements |
| `additionalProperties: true` | May error | Explicitly allowing extra fields |

**Root Cause Analysis:**

1. **Storage compiler vs Validator compiler divergence**: The storage compiler (`compiler.rs`) rejects schemas that the validator compiler (`validator_schema.rs`) can handle
2. **Single-element type arrays**: `["string"]` throws "multi-type unions" error even though it's not a union
3. **Validation-only keywords not enforced**: `pattern`, `format`, `const` are in SUPPORTED_KEYWORDS but validation is incomplete
4. **No `oneOf`/`anyOf` support**: These are essential for real schemas

**Design Decisions:**

1. **Support `oneOf`/`anyOf` for validation, infer storage from first match**: When compiling for storage, use the first variant's type. When validating, try each variant.

2. **Support all type array patterns**: `["string"]` (single), `["string", "null"]` (nullable), `["string", "integer"]` (union - validate against any match)

3. **Enforce all constraint keywords**: If we parse it, we validate it. No more silent ignoring.

4. **Annotation-only keywords are OK to ignore**: `examples`, `default`, `title`, `description` - these don't affect validation

5. **`allOf` support**: Schema composition - all constraints must pass

---

##### Step 19.1: Fix type array handling

**Commit:** `fix(schema): handle all type array patterns correctly`

**Tasks:**
- [x] Fix `["string"]` single-element arrays to work (not error)
- [x] Ensure `["string", "null"]` continues to work for nullable
- [x] Add validation-time support for `["string", "integer"]` unions (match any)
- [x] Add tests for all type array patterns

**Checkpoint:** `cargo test -p arbors-schema type_array` passes ✓

---

##### Step 19.2: Add `const` validation

**Commit:** `feat(schema): validate const constraint`

**Tasks:**
- [x] Add `const_value: Option<Value>` to `CompiledConstraints`
- [x] Extract `const` during constraint compilation
- [x] Validate exact equality in `TreeValidator`
- [x] Add tests: string const, number const, boolean const, null const, object const

**Checkpoint:** `cargo test -p arbors-validate const_validation` passes ✓

---

##### Step 19.3: Add `pattern` validation

**Commit:** `feat(schema): validate pattern constraint`

**Tasks:**
- [x] Ensure `pattern` is already in `StringConstraints` (verify)
- [x] Validate regex match in `TreeValidator`
- [x] Handle regex compilation errors gracefully
- [x] Add tests: simple patterns, anchored patterns, unicode, invalid regex

**Checkpoint:** `cargo test -p arbors-validate pattern_validation` passes ✓

---

##### Step 19.4: Add `format` validation

**Commit:** `feat(schema): validate format constraint`

**Tasks:**
- [x] Validate temporal formats: `date`, `date-time`, `time`, `duration`
- [x] Validate `email` format (RFC 5322 simplified)
- [x] Validate `uri` format (RFC 3986)
- [x] Validate `uuid` format (RFC 4122)
- [x] Validate `ipv4` and `ipv6` formats
- [x] Unknown formats: warn but don't fail (per JSON Schema spec)
- [x] Add tests for each format

**Checkpoint:** `cargo test -p arbors-validate format_validation` passes ✓

---

##### Step 19.5: Add `uniqueItems` validation

**Commit:** `feat(schema): validate uniqueItems constraint`

**Tasks:**
- [x] Add `unique_items: bool` to `ArrayConstraints`
- [x] Extract during constraint compilation
- [x] Validate uniqueness in `TreeValidator` (compare JSON values)
- [x] Add tests: primitive arrays, object arrays, nested arrays

**Checkpoint:** `cargo test -p arbors-validate unique_items` passes ✓

---

##### Step 19.6: Add `oneOf` support

**Commit:** `feat(schema): support oneOf schema combinator`

**Tasks:**
- [x] Remove `oneOf` from `UNSUPPORTED_KEYWORDS`
- [x] Add `one_of: Option<Vec<CompiledConstraints>>` to constraints
- [x] Storage compiler: use first variant's type for storage layout
- [x] Validator: validate that exactly one variant matches
- [x] Add tests: type unions, discriminated unions, nested oneOf

**Checkpoint:** `cargo test -p arbors-schema oneOf` passes ✓

---

##### Step 19.7: Add `anyOf` support

**Commit:** `feat(schema): support anyOf schema combinator`

**Tasks:**
- [x] Remove `anyOf` from `UNSUPPORTED_KEYWORDS`
- [x] Add `any_of: Option<Vec<CompiledConstraints>>` to constraints
- [x] Storage compiler: use first variant's type for storage layout
- [x] Validator: validate that at least one variant matches
- [x] Add tests: type unions, optional constraints

**Checkpoint:** `cargo test -p arbors-schema anyOf` passes ✓

---

##### Step 19.8: Add `allOf` support

**Commit:** `feat(schema): support allOf schema combinator`

**Tasks:**
- [x] Remove `allOf` from `UNSUPPORTED_KEYWORDS`
- [x] Add `all_of: Option<Vec<CompiledConstraints>>` to constraints
- [x] Storage compiler: merge all schemas (properties combine)
- [x] Validator: validate that all constraints pass
- [x] Add tests: schema composition, extending base schemas

**Checkpoint:** `cargo test -p arbors-schema allOf` passes ✓

---

##### Step 19.9: Add `additionalProperties` schema support

**Commit:** `feat(schema): support additionalProperties as schema`

**Tasks:**
- [x] Handle `additionalProperties: true` (allow any)
- [x] Handle `additionalProperties: false` (reject extras)
- [x] Handle `additionalProperties: { "type": "string" }` (validate extras against schema)
- [x] Add tests for all three patterns

**Checkpoint:** `cargo test -p arbors-validate additional_properties` passes ✓

---

##### Step 19.10: Update README and documentation

**Commit:** `docs(schema): update JSON Schema support documentation`

**Tasks:**
- [x] Update README "JSON Schema Support" section with accurate list
- [x] Document what IS supported (exhaustive list)
- [x] Document what is NOT supported (with reasons)
- [x] Remove lies about current capabilities

**Checkpoint:** README accurately reflects capabilities ✓

---

##### Step 19.11: Re-test example schemas

**Commit:** `test(validate): verify real-world schemas work`

**Tasks:**
- [x] Restore full OpenAI Chat Messages schema (with `oneOf`, nullable arrays)
- [x] Restore full OpenAI Tool Calls schema (with `const`, `pattern`)
- [x] Restore full Embedding Dataset schema (with `format`, `pattern`)
- [x] All three schemas compile without error
- [x] Validation produces correct results

**Checkpoint:** All example schemas work correctly ✓

---

##### Step 19.12: Python bindings and tests

**Commit:** `feat(python): expose new schema features`

**Tasks:**
- [x] Ensure Schema.from_json_schema handles new keywords
- [x] Add Python tests for `oneOf`, `anyOf`, `allOf`
- [x] Add Python tests for `pattern`, `format`, `const`
- [x] Run `make check-stubs && make check-parity`

**Checkpoint:** `make test && make check-stubs && make check-parity` passes ✓

---

**Final Checkpoint for Step 19:**

```bash
# All tests pass
cargo test
make test

# Parity maintained
make check-stubs
make check-parity

# Example schemas work without modification
python3 -c "
import arbors as ab
import json

# Full schemas, not dumbed-down versions
for schema_file in ['openai_chat_messages.json', 'openai_tool_calls.json', 'embedding_dataset.json']:
    with open(f'docs/examples/schemas/{schema_file}') as f:
        schema = ab.Schema.from_json_schema(json.load(f))
    print(f'{schema_file}: OK')
"
```

---

#### Step 20: Final verification

**Commit:** `docs(validate): finalize Phase 13.8`

**Tasks:**
- [x] Run full test suite: `cargo test && make test`
- [x] Run parity check: `make check-parity`
- [x] Run stubs check: `make check-stubs`
- [x] Update Phase 13.8 task checkboxes in this plan
- [x] Update status to "Complete"

---

### 13.8.7 Semantic Specification

#### Error Path Format

All errors include two paths in JSON Pointer format (RFC 6901):

| Field | Example | Meaning |
|-------|---------|---------|
| `data_path` | `"/users/0/email"` | Location in the data that failed |
| `schema_path` | `"#/properties/users/items/properties/email/format"` | Location in schema defining the failing constraint (keyword-level when applicable) |

**Data path examples:**

| Path | Meaning |
|------|---------|
| `""` | Root |
| `"/name"` | Field "name" at root |
| `"/users/0"` | First element of "users" array |
| `"/users/0/email"` | Email field of first user |
| `"/a~1b"` | Field "a/b" (escaped) |
| `"/a~0b"` | Field "a~b" (escaped) |

**Schema path examples:**

| Path | Meaning |
|------|---------|
| `"#"` | Root schema |
| `"#/properties/name"` | Schema for "name" field |
| `"#/properties/users/items"` | Schema for array items |
| `"#/$defs/Address"` | Referenced definition |

#### Validation Traversal Order

Validation uses depth-first traversal:
1. Validate current node type
2. If object: validate required fields, then each field's value
3. If array: validate length constraints, then each element
4. If tuple: validate each position against prefixItems

#### Coercion Order

When `coerce_types: true`:
1. Try exact type match first
2. Try widening (int → float)
3. Try parsing (string → int/float/date)
4. Fail with type mismatch error

Coercion is available in both JSON Schema and Arbors Schema modes.

#### Collection Policy Behavior

| Policy | On First Error | On Subsequent Errors | Final Result |
|--------|----------------|----------------------|--------------|
| Absolute | Stop immediately | N/A | Error |
| Strict | Continue to next tree | Continue | Partial success (fail if 0 valid) |
| Lax | Record warning, continue | Record warnings | Full success (warnings only) |

---

### 13.8.8 Deliverables and Checkpoints

**Deliverable:** Schema specification + tree/collection validation APIs with three policies (absolute, strict, lax).

| Checkpoint | Verification |
|------------|--------------|
| arbors-validate crate created | `cargo build -p arbors-validate` succeeds |
| Unified ValidatorSchema works | `ValidatorSchema::compile()` produces registry + constraints |
| Ingestion/validation match | Golden tests: same schema accepted/rejected identically |
| schema_path is keyword-level | Round-trip tests: `.../minLength`, `.../format`, etc. |
| SUPPORTED_KEYWORDS defined | Single source of truth in `keywords.rs` |
| Error types defined | Tests verify data_path, schema_path, expected, actual |
| Sized types work | u8, i32, etc. bounds checking passes |
| Logical types work | embedding, intRange validation passes |
| Tree validation works | All constraint types validated |
| Collection validation works | All 3 policies work correctly |
| Strict policy semantics | Fails if 0 valid, returns valid_arbor |
| Coercion works | string→int, int→float, string→date |
| Rich errors | data_path, schema_path, expected, actual populated |
| max_errors respected | Stops after limit |
| u64 exactness tests pass | All 6 u64/Float64 tests pass |
| Rust tests pass | `cargo test` succeeds |
| Python builds | `make python` succeeds |
| Python tests pass | `make test` succeeds |
| API parity | `make check-parity` succeeds |
| Stubs correct | `make check-stubs` succeeds |

**Commit after all checkpoints pass.**

---

## Phase 13.9 Python Bindings Update

**Purpose:** Achieve exact parity between Rust and Python APIs.

**Status:** Complete

### 13.9.1 Binding Strategy

- Same method names in Rust and Python
- Same argument names and order
- Same return types (mapped to Python equivalents)
- Same error types (mapped to Python exceptions)

### 13.9.2 Pythonic Conveniences (Additions Only)

Keep `__getitem__` and similar for ergonomics, but as *additions* not replacements:
```python
# Both work:
tree.get_field("name")  # Explicit method (parity with Rust)
tree["name"]            # Pythonic shortcut (Python only)
```

### 13.9.3 Verification Results

- [x] API renames complete (`aggregate()`, `add_field()`, `num_trees()`)
- [x] Pythonic conveniences implemented (Tree, Node, Arbor all have `__getitem__`, `__iter__`, `__len__`, etc.)
- [x] Type stubs updated (`_arbors.pyi`)
- [x] API manifest updated (63 exports)
- [x] `make check-parity` passes
- [x] `make check-stubs` passes
- [x] `make test` passes (1386 tests)
- [x] LazyArbor parity verified (22 tests in `test_lazy_parity.py`)

### 13.9.4 Deliverables and Checkpoints

**Deliverable:** Python bindings with exact Rust API parity.

| Checkpoint | Verification |
|------------|--------------|
| All methods bound | ✅ Every public Rust method has Python equivalent |
| Same signatures | ✅ Argument names and order match |
| Type stubs correct | ✅ `make check-stubs` succeeds |
| Parity verified | ✅ `make check-parity` succeeds (63 exports) |
| Python tests pass | ✅ `make test` succeeds (1386 tests) |

**Phase complete.**

---

## Phase 13.10 Arbor View Developer Ergonomics

**Purpose:** Ship a view abstraction (`ArborView`/`TreeView`) and a read-only `ArborView` over columnar JSON that delivers AoS ergonomics on SoA storage, including schema flip and column-level compute access. Writes/reshaping are defined but delivered in a follow-up sub-phase.

**Status:** Planned

**Scope (13.10a):**
1. View abstraction + `ArborView` (read-only)
2. Schema flip attached to the view
3. Column-level compute access (Arrow-friendly)
4. Nested columnar discovery helper

**Scope (13.10b, next):**
1. `ArborViewEditPlan` (writes: scalar/null cells, add/remove columns, append/delete rows)
2. COW-aware application that keeps outputs columnar

**Scope (13.10c, planned):**
1. `TableOps` trait parity for `Arbor` and `ArborView` (head/tail/take/filter/sort/group/select)
2. Expr-based filter/sort/group semantics (stable ordering, Missing vs Null vs NaN policy)
3. Concrete `GroupedTable` result type

**Non-goals (explicit):**
- No AoS materialization (no new trees, no duplicated pools).
- No global auto-detect; views are opt-in at a chosen object node.
- No ingestion changes; parsing remains faithful to JSON.

**Dependencies / prerequisites:**
- Existing SoA storage (`ColumnarNodes`, `FinishedPools`)
- Arrow arrays already in pools

---

### 13.10.0 Design Decisions (DECIDED)

#### View abstraction + concrete ArborView (DECIDED)
**Decision:** Introduce `ArborView`/`TreeView` as the extensible view layer; first concrete view is `ArborView` (AoS ergonomics over columnar JSON).
**Rationale:** Future-proof for other views (filtered, projected, windowed, schema-coerced).
**Implications:** All row ergonomics live in `ArborView`; view-local metadata (flipped schema, validation) attaches here.
→ **Step 1** (view scaffolding)

#### Default columns (DECIDED)
**Decision:** Default to **all array-valued fields** as columns; allow `.only_columns(...)` / `.exclude_columns(...)`.
**Implications:** Builder must auto-select array fields; strict/ragged validation applies to the selected set.
→ **Step 1** (column discovery in ArborViewBuilder)

#### Writes split to 13.10b (DECIDED)
**Decision:** 13.10a is read-only; 13.10b delivers `ArborViewEditPlan` with **scalar/null** cell edits (nested values deferred).
**Implications:** No mutation API ships in 13.10a; tests for writes move to 13.10b.
→ **Deferred** (13.10b)

#### Column-level compute access (DECIDED)
**Decision:** Expose `column_array()` on `ArborView` for homogeneous primitive columns, returning pool + indices + type-erased `to_arrow() -> ArrayRef`. Caller does not specify type parameter; the view knows the column type and dispatches internally.
**Implications:** Great ergonomics with automatic efficiency; no generic `<T>` required; typed convenience methods (`as_i64_array()`, etc.) available for callers who know the type.
→ **Step 3** (column compute access)

#### Non-primitive column access (DECIDED)
**Decision:** `column_array()` errors on non-primitive columns. Provide separate `column_nodes()` API that returns `&[NodeId]` for any column type.
**Implications:** Explicit APIs with no silent performance cliffs. Primitive columns use `column_array()` for Arrow compute; non-primitive columns use `column_nodes()` for manual traversal. No hidden fallbacks.
→ **Step 3** (column_nodes implementation)

#### Row materialization (DECIDED)
**Decision:** Provide `materialize()` API to convert logical rows into actual AoS Arbor (one tree per row). This is the explicit escape hatch when you need real row objects.
**Implications:** Creates new nodes and pool entries (not zero-copy). Use when: serializing rows as JSON objects, passing to row-oriented APIs, or exporting AoS format. Avoid when: iterating/computing over large datasets (use view instead).
→ **Step 5** (row materialization)

#### Schema flip is view-local (DECIDED)
**Decision:** Derive a row schema view from object-of-lists; do not rewrite `SchemaRegistry`.
**Implications:** `row_schema()` is optional; error on non-homogeneous columns.
→ **Step 2** (row_schema implementation)

#### Strict vs Ragged policies (DECIDED)
**Decision:** Strict = equal lengths else error; Ragged = missing when out-of-range (distinct from null).
**Implications:** Validation on build; semantics for missing vs null are explicit.
→ **Step 1** (strict/ragged validation)

---

### 13.10.1 Specification (13.10a: Read-only + Compute)

#### 13.10.1.1 Inputs and Outputs
**Inputs:** An `Arbor` and an object `NodeId` whose fields include arrays (columnar JSON); optional schema.
**Outputs:** An `ArborView` exposing row iteration, typed access, column-level compute access, and optional row schema view.
**Key invariants:**
- No new nodes/pools; view is zero-copy.
- Row count is well-defined (strict: all equal; ragged: max length, missing past end).
- Missing vs null preserved.

#### 13.10.1.2 Terminology and Naming
- **ArborView:** Row-oriented view over a columnar object. → **Step 2**
- **RowRef:** Per-row handle with O(1) cell access. → **Step 2**
- **ColumnArray:** Column compute handle exposing pool + indices + `to_arrow()` (primitive/homogeneous only). → **Step 3**
- **column_nodes():** Returns `&[NodeId]` for any column type; use for non-primitive columns. → **Step 3**
- **materialize():** Convert logical rows to actual AoS Arbor (one tree per row). Creates new nodes/pools. → **Step 5**
- **Flipped schema (row schema):** Derived schema mapping `List<T>` → `T` (nullable if item nullable). → **Step 2**

#### 13.10.1.3 Supported Features (13.10a)
- **Supported:**
  - Auto column selection (all array fields), optional include/exclude filters → **Step 1**
  - Strict and Ragged modes → **Step 1**
  - Row iteration with O(1) cell access; per-row typed getters → **Step 2**
  - Column compute access for homogeneous primitive columns (`column_array()` + `to_arrow()`) → **Step 3**
  - Column node access for any column type (`column_nodes()`) → **Step 3**
  - Row materialization (`materialize()`) — explicit AoS conversion when needed → **Step 5**
  - Row schema view (if Arbor has schema; error on heterogeneous column types) → **Step 2**
  - Nested columnar discovery helper (opt-in) → **Step 4**
- **Not supported (13.10a):**
  - Mutations/reshaping (deferred to 13.10b)
  - Column compute for non-primitive or heterogeneous columns (use `column_nodes()` instead)
  - Global auto-detect/wrapping
- **Behavior for unsupported:**
  - Heterogeneous column for `column_array()` → error; row access and `column_nodes()` still work
  - Non-primitive column for `column_array()` → error; use `column_nodes()` for explicit node access

#### 13.10.1.4 Modes / Policies → **Step 1**
| Mode   | Applies to            | Behavior                                   | Result                 |
|--------|-----------------------|--------------------------------------------|------------------------|
| Strict | ArborView validation  | All selected columns must match length     | Ok or error            |
| Ragged | ArborView validation  | Row count = max len; out-of-range = missing| Ok; missing not null   |

#### 13.10.1.5 Semantics (Normative)
- **Row count:** Strict = common length; Ragged = max column length. → **Step 1**
- **Missing vs null:** Missing = no node (ragged or absent column); Null = node exists and `NodeType::Null`. → **Step 1**
- **Ordering:** Column lists keep original order; rows iterate 0..row_count-1. → **Step 2**
- **Row iteration performance:** O(1) per cell. Children are contiguous; `ArborView` caches `children_start` for each column on build. Cell access is arithmetic: `NodeId(column_start + row_index)`. Both row iteration and column compute are efficient—no tradeoff. → **Step 2**
- **Column compute:** `column_array(field)` returns pool indices + type-erased `to_arrow() -> ArrayRef`. Caller does not specify type; view dispatches internally. → **Step 3**
  - Indices may be non-contiguous; treat them as a gather map (no dense slice assumption).
  - Errors on non-primitive or heterogeneous columns; use `column_nodes()` instead.
- **Column nodes:** `column_nodes(field)` returns `&[NodeId]` for any column type. Use for non-primitive columns or when NodeIds are needed directly. → **Step 3**
- **Materialize:** `materialize()` produces a new Arbor with one tree per row. Each tree is an object with selected columns as fields. Creates new nodes and copies primitive values to new pools. Output Arbor has `row_count()` trees and can be serialized as JSONL. Optional: `materialize_row(i)` for single row, `materialize_rows(&[...])` for subset. → **Step 5**
- **Schema flip:** For each column `List<T>` → `T` (nullable if item nullable). Error if column items are heterogeneous. → **Step 2**
- **Nested discovery:** Qualify object nodes where most fields are arrays (configurable threshold) and may allow a small set of scalar metadata fields; return candidates; no auto-wrapping. → **Step 4**

#### 13.10.1.6 Error Model → **Steps 1, 3**
- **Errors include:** path to object, field name, mode (strict/ragged), reason (length mismatch, non-array column selected, heterogeneous column for compute).
- **Paths:** data path uses JSON Pointer; escaping per RFC 6901.

#### 13.10.1.7 Public API Surface (Rust; Python mirrors after)
```rust
// Builders → Step 1, updated in Step 7 (clean break)
impl Arbor {
    pub fn arbor_view(&self, object_id: NodeId) -> ArborViewBuilder<'_>;
}
// Note: TreeViewBuilder and create_view() removed in Step 7 (clean break)
pub struct ArborViewBuilder<'a> { /* ... */ }
impl<'a> ArborViewBuilder<'a> {
    pub fn strict(self) -> Self;
    pub fn ragged(self) -> Self;
    pub fn columns_all_arrays(self) -> Self;
    pub fn only_columns(self, names: &[&str]) -> Self;
    pub fn exclude_columns(self, names: &[&str]) -> Self;
    pub fn row_count_auto(self) -> Self;
    pub fn row_count(self, n: usize) -> Self;
    pub fn build(self) -> Result<ArborView<'a>>;
}

// View → Step 2
pub struct ArborView<'a> { /* ... */ }
impl<'a> ArborView<'a> {
    pub fn row_count(&self) -> usize;
    pub fn columns(&self) -> impl Iterator<Item = ColumnSpec> + '_;
    pub fn row(&self, i: usize) -> Option<RowRef<'a>>;
    pub fn get(&self, i: usize, field: &str) -> Option<NodeId>;
    pub fn row_schema(&self) -> Option<ArborViewSchema>;  // → Step 2
    // Column access (compute path for primitives) → Step 3
    pub fn column_array(&self, field: &str) -> Result<ColumnArray<'a>>;
    // Column access (any column type, returns NodeIds) → Step 3
    pub fn column_nodes(&self, field: &str) -> Option<&[NodeId]>;
    // Materialize to AoS (creates new Arbor with one tree per row) → Step 5
    pub fn materialize(&self) -> Result<Arbor>;
    pub fn materialize_row(&self, i: usize) -> Result<Arbor>;
    pub fn materialize_rows(&self, indices: &[usize]) -> Result<Arbor>;
}

// RowRef → Step 2
pub struct RowRef<'a> { /* ... */ }
impl<'a> RowRef<'a> {
    pub fn get(&self, field: &str) -> Option<NodeId>;
    pub fn get_i64(&self, field: &str) -> Option<i64>;
    pub fn get_f64(&self, field: &str) -> Option<f64>;
    pub fn get_string(&self, field: &str) -> Option<&'a str>;
    // etc. for supported primitives
}

// ColumnArray → Step 3
pub struct ColumnArray<'a> {
    pub fn len(&self) -> usize;
    pub fn value_indices(&self) -> &[u32];
    pub fn pool(&self) -> &'a FinishedPools;
    // Type-erased Arrow array (no generic parameter required)
    pub fn to_arrow(&self) -> Result<ArrayRef>;
    // Typed convenience methods for callers who know the type
    pub fn as_i64_array(&self) -> Result<Int64Array>;
    pub fn as_f64_array(&self) -> Result<Float64Array>;
    pub fn as_string_array(&self) -> Result<StringArray>;
    pub fn as_bool_array(&self) -> Result<BooleanArray>;
}
```
*(Python bindings follow once Rust stabilizes.)*

#### 13.10.1.8 Internal Architecture
- **Single source of truth:** Column selection and validation live in ArborViewBuilder; schema flip logic shared with row_schema(). → **Steps 1, 2**
- **Where code lives:** Prefer `arbors-storage` for types/APIs; compute helper may live alongside storage to avoid new crate. → **All steps**
- **Row access:** Cache `children_start` per column on build. Cell access is `NodeId(column_start + row_index)` — O(1) arithmetic. → **Step 2**
- **Compute path:** `column_array` returns indices + pool + column type. `to_arrow()` dispatches on type to build Arrow array via gather. No generic `<T>` required by caller. → **Step 3**
- **Node path:** `column_nodes` returns cached `&[NodeId]` slice for any column. Works for non-primitive columns. → **Step 3**
- **Non-negotiable:** Zero-copy for read-only path; no new nodes/pools. Both row iteration and column compute are efficient. → **Steps 1–4** (Step 5 creates new Arbor)

---

### 13.10.2 Definitive Symbol Inventory (13.10a)
| Symbol | Kind | Location | Notes | Step |
|--------|------|----------|-------|------|
| `TreeViewBuilder` | struct | `arbors-storage` | *removed in Step 7* | 1, 7 |
| `ArborViewBuilder` | struct | `arbors-storage` | config + validation; direct return from `arbor_view()` | 1, 7 |
| `ArborView` | struct | `arbors-storage` | read-only row view; has `column_array()` and `column_nodes()` | 2 |
| `RowRef` | struct | `arbors-storage` | per-row handle; O(1) cell access | 2 |
| `ColumnSpec` | struct | `arbors-storage` | name, node id, len, type hint | 1 |
| `ColumnArray` | struct | `arbors-storage` | compute handle; `to_arrow()` + typed convenience methods | 3 |
| `ArborViewOptions` | struct | `arbors-storage` | strict/ragged, columns, row_count | 1 |
| `ArborViewSchema` | struct | `arbors-storage` | flipped schema view | 2 |

### 13.10.3 Test Plan (13.10a)
- [ ] Hourly columnar: row count >= 48; row 0 `validTimeLocal` contains `2025-12-07`; `windGust[0]` is null → **Step 6**
- [ ] Tides nested: row count == 10; row 0 `tideType == "H"` → **Step 6**
- [ ] Strict length mismatch → error → **Step 1, 6**
- [ ] Ragged: out-of-range yields missing (not null) → **Step 1, 6**
- [ ] Schema flip: `List<T>` → `T`, nullable preserved; heterogeneous column → error → **Step 2, 6**
- [ ] Column compute: `column_array("temperature").to_arrow()` sum matches per-row sum → **Step 3, 6**
- [ ] Column nodes: `column_nodes()` works for any column; returns correct NodeIds → **Step 3, 6**
- [ ] Non-primitive column: `column_array()` errors; `column_nodes()` succeeds → **Step 3, 6**
- [ ] Materialize all: `materialize()` produces Arbor with `row_count()` trees; values match view → **Step 5, 6**
- [ ] Materialize single: `materialize_row(0)` produces Arbor with 1 tree; fields match row 0 → **Step 5, 6**
- [ ] Materialize subset: `materialize_rows(&[0, 2, 4])` produces Arbor with 3 trees in order → **Step 5, 6**
- [ ] Nested discovery helper finds `tidalForecast` in tides fixture → **Step 4, 6**

### 13.10.4 Documentation Plan → **Step 6**
- [x] Add ArborView overview + examples (row iteration, column compute, column_nodes, materialize)
- [x] Document strict vs ragged semantics and missing vs null
- [x] Document `column_array()` vs `column_nodes()` — when to use each
- [x] Document `materialize()` — when to use, performance implications (creates new Arbor)
- [x] Document schema flip behavior and limitations (homogeneous required)
- [x] Document nested columnar discovery helper
**Documentation added to `docs/ARCHITECTURE.md`**

### 13.10.5 Execution Steps (13.10a)

#### Step 1: Introduce view scaffolding
**Commit:** `add-arbor-view-builders`
**References:**
- Decisions: View abstraction (13.10.0), Default columns (13.10.0), Strict vs Ragged (13.10.0)
- Spec: Inputs/Outputs (13.10.1.1), Modes/Policies (13.10.1.4), Row count & Missing vs null semantics (13.10.1.5)
- API: Builders block (13.10.1.7)
- Symbols: `ArborViewBuilder`, `ColumnSpec`, `ArborViewOptions` (13.10.2) — `TreeViewBuilder` removed in Step 7
**Tasks:**
- [x] Add `ArborViewBuilder`, options, defaults (all arrays) — `TreeViewBuilder` removed in Step 7
- [x] Implement strict/ragged validation and column discovery
**Unit Tests (in `crates/arbors-storage/tests/view_tests.rs`):**
- [x] `test_validation_mode_default` — ValidationMode defaults to Strict
- [x] `test_arbor_view_options_default` — ArborViewOptions has correct defaults
- [x] `test_builder_method_chaining` — fluent API compiles and chains correctly
- [x] `test_builder_ragged_mode` — `.ragged()` sets mode correctly
- [x] `test_builder_columns_all_arrays` — `.columns_all_arrays()` is default behavior
- [x] `test_strict_mode_equal_lengths` — strict mode accepts equal-length columns
- [x] `test_strict_mode_unequal_lengths_error` — strict mode errors on length mismatch
- [x] `test_ragged_mode_unequal_lengths` — ragged mode accepts unequal lengths, row_count = max
- [x] `test_ragged_mode_out_of_range_missing` — ragged mode returns None for out-of-range cells
- [x] `test_columns_all_arrays_default` — auto-discovers array fields, ignores scalars
- [x] `test_only_columns_filter` — `.only_columns()` restricts to specified columns
- [x] `test_exclude_columns_filter` — `.exclude_columns()` removes specified columns
- [x] `test_only_columns_nonexistent_field_error` — error when requested column doesn't exist
- [x] `test_only_columns_non_array_field_error` — error when requested column isn't an array
- [x] `test_no_arrays_error` — error when object has no array fields
- [x] `test_view_on_non_object_error` — error when target node isn't an Object
- [x] `test_create_view_on_empty_arbor` — error on empty arbor
- [x] `test_create_view_invalid_node_id` — error on invalid NodeId
- [x] `test_explicit_row_count` — `.row_count(n)` overrides computed row count
- [x] `test_column_spec_info` — ColumnSpec has correct name, len, element_type
- [x] `test_column_spec_empty_array` — empty array has len=0, element_type=None
- [x] `test_cell_access_by_field` — `view.get(row, field)` returns correct NodeId
- [x] `test_cell_access_out_of_bounds` — out-of-bounds row returns None
- [x] `test_cell_access_null_values` — null cells return Some(NodeId) where is_null() is true
- [x] `test_column_iteration` — `view.columns()` iterates all columns
- [x] `test_arbor_accessor` — `view.arbor()` and `view.object_id()` return correct references
**Checkpoint:** `cargo test -p arbors-storage` ✓

---

#### Step 2: Row access + schema flip
**Commit:** `implement-arbor-view-access`
**References:**
- Decisions: Schema flip is view-local (13.10.0)
- Spec: Terminology—ArborView, RowRef, Flipped schema (13.10.1.2), Ordering & Row iteration performance & Schema flip semantics (13.10.1.5)
- API: View block, RowRef block (13.10.1.7)
- Architecture: Row access caching (13.10.1.8)
- Symbols: `ArborView`, `RowRef`, `ArborViewSchema` (13.10.2)
**Tasks:**
- [x] Implement `ArborView::row(i)` returning `RowRef`
- [x] Implement `RowRef` typed getters (get_i64, get_f64, get_string, get_bool, etc.)
- [x] Verify O(1) cell access via `children_start` caching
- [x] Implement `row_schema()` (flip `List<T>` → `T`, error on heterogeneous)
**Unit Tests:**
- [x] `test_row_returns_row_ref` — `view.row(i)` returns Some(RowRef) for valid index
- [x] `test_row_out_of_bounds` — `view.row(i)` returns None for i >= row_count
- [x] `test_row_ref_get_node_id` — `row.get(field)` returns correct NodeId
- [x] `test_row_ref_get_i64` — `row.get_i64(field)` returns correct i64 value
- [x] `test_row_ref_get_f64` — `row.get_f64(field)` returns correct f64 value
- [x] `test_row_ref_get_string` — `row.get_string(field)` returns correct &str
- [x] `test_row_ref_get_bool` — `row.get_bool(field)` returns correct bool
- [x] `test_row_ref_get_wrong_type` — typed getter returns None for wrong type
- [x] `test_row_ref_get_null` — typed getter returns None for null values
- [x] `test_row_ref_get_missing_field` — `row.get(nonexistent)` returns None
- [x] `test_row_ref_ragged_missing` — ragged mode: row beyond column length returns None
- [x] `test_row_iteration_all_rows` — iterate all rows via `for i in 0..view.row_count()`
- [ ] `test_row_schema_exists` — `row_schema()` returns Some for schema-backed arbor
- [x] `test_row_schema_none_schemaless` — `row_schema()` returns None for schemaless arbor
- [ ] `test_row_schema_flip_list_to_item` — `List<Int64>` becomes `Int64`
- [ ] `test_row_schema_flip_preserves_nullable` — nullable flag preserved through flip
- [ ] `test_row_schema_heterogeneous_error` — error when column items have different types
- [ ] `test_row_schema_field_names` — flipped schema has correct field names
- [x] `test_cell_access_o1_performance` — verify no lookup per cell (inspect impl or time)
**Checkpoint:** `cargo test -p arbors-storage` ✓

---

#### Step 3: Column access (compute + nodes)
**Commit:** `add-column-access`
**References:**
- Decisions: Column-level compute access (13.10.0), Non-primitive column access (13.10.0)
- Spec: Terminology—ColumnArray, column_nodes (13.10.1.2), Column compute & Column nodes semantics (13.10.1.5), Error model (13.10.1.6)
- API: ColumnArray block, column_array/column_nodes methods (13.10.1.7)
- Architecture: Compute path, Node path (13.10.1.8)
- Symbols: `ColumnArray` (13.10.2)
**Tasks:**
- [x] Implement `ColumnArray` struct with pool reference, indices, column type
- [x] Implement `to_arrow()` — type-erased `ArrayRef` return (dispatches internally)
- [x] Implement typed convenience methods: `as_i64_array()`, `as_f64_array()`, `as_string_array()`, `as_bool_array()`
- [x] Implement `column_nodes()` returning `&[NodeId]` for any column type
- [x] Enforce homogeneous primitive constraint on `column_array()`; error otherwise
**Unit Tests:**
- [x] `test_column_array_i64` — `column_array()` works for Int64 columns
- [x] `test_column_array_f64` — `column_array()` works for Float64 columns
- [x] `test_column_array_string` — `column_array()` works for String columns
- [x] `test_column_array_bool` — `column_array()` works for Bool columns
- [x] `test_column_array_to_arrow_i64` — `to_arrow()` returns Int64Array
- [x] `test_column_array_to_arrow_f64` — `to_arrow()` returns Float64Array
- [x] `test_column_array_to_arrow_string` — `to_arrow()` returns StringArray
- [x] `test_column_array_to_arrow_bool` — `to_arrow()` returns BooleanArray
- [x] `test_column_array_as_i64_array` — typed convenience method returns correct array
- [x] `test_column_array_as_wrong_type_error` — `as_f64_array()` on Int64 column errors
- [x] `test_column_array_len` — `len()` matches column length
- [x] `test_column_array_value_indices` — `value_indices()` returns correct pool indices
- [x] `test_column_array_with_nulls` — nulls handled correctly in Arrow array
- [x] `test_column_array_non_primitive_error` — `column_array()` errors on Array column
- [x] `test_column_array_object_column_error` — `column_array()` errors on Object column
- [x] `test_column_array_heterogeneous_error` — `column_array()` errors when items have mixed types
- [x] `test_column_array_nonexistent_field` — `column_array(nonexistent)` returns error
- [x] `test_column_nodes_primitive` — `column_nodes()` works for primitive columns
- [x] `test_column_nodes_array_column` — `column_nodes()` works for Array-of-Arrays
- [x] `test_column_nodes_object_column` — `column_nodes()` works for Array-of-Objects
- [x] `test_column_nodes_correct_ids` — returned NodeIds match direct children access
- [x] `test_column_nodes_nonexistent_field` — `column_nodes(nonexistent)` returns None
- [x] `test_arrow_sum_matches_row_sum` — sum via Arrow array == sum via row iteration
**Checkpoint:** `cargo test -p arbors-storage` ✓

---

#### Step 4: Nested columnar discovery helper
**Commit:** `add-columnar-discovery-helper`
**References:**
- Spec: Supported features—Nested columnar discovery (13.10.1.3), Nested discovery semantics (13.10.1.5)
- Fixture: `testdata/weather/weather-tides.json` (tidalForecast object)
**Tasks:**
- [x] Implement `discover_columnar_objects()` or similar helper
- [x] Configurable threshold for "most fields are arrays"
- [x] Allow specified scalar metadata fields to be ignored
- [x] Return list of candidate NodeIds (no auto-wrapping)
**Unit Tests:**
- [x] `test_discover_all_arrays` — object where all fields are arrays is discovered
- [x] `test_discover_threshold_50` — object with >50% array fields is discovered (default)
- [x] `test_discover_threshold_custom` — custom threshold works correctly
- [x] `test_discover_no_arrays` — object with no arrays returns empty
- [x] `test_discover_allows_scalar_metadata` — specified scalar fields don't disqualify
- [x] `test_discover_nested_objects` — recursively finds nested columnar objects
- [x] `test_discover_tides_finds_tidal_forecast` — tides fixture: finds `tidalForecast`
- [x] `test_discover_returns_node_ids` — returns NodeIds, not views
- [x] `test_discover_empty_object` — empty object returns empty
- [x] `test_discover_deep_nesting` — works at arbitrary depth
**Checkpoint:** `cargo test -p arbors-storage` ✓

---

#### Step 5: Row materialization
**Commit:** `add-row-materialization`
**References:**
- Decisions: Row materialization (13.10.0)
- Spec: Terminology—materialize (13.10.1.2), Materialize semantics (13.10.1.5)
- API: materialize/materialize_row/materialize_rows methods (13.10.1.7)
**Implementation Note:** Functions implemented in `arbors-io` as standalone functions (`materialize_view`, `materialize_view_row`, `materialize_view_rows`) to avoid circular dependency with `arbors-storage`.
**Tasks:**
- [x] Implement `materialize()` — creates new Arbor with one tree per row
- [x] Implement `materialize_row(i)` — single row convenience
- [x] Implement `materialize_rows(&[...])` — subset of rows
- [x] Use ArborBuilder internally; copy primitives to new pools
**Unit Tests:**
- [x] `test_materialize_row_count` — `materialize()` creates Arbor with `row_count()` trees
- [x] `test_materialize_independent_storage` — output Arbor doesn't share storage with input
- [x] `test_materialize_values_match` — values in materialized trees match original view
- [x] `test_materialize_tree_structure` — each tree is an object with selected columns as fields
- [x] `test_materialize_i64_values` — Int64 values materialized correctly
- [x] `test_materialize_f64_values` — Float64 values materialized correctly
- [x] `test_materialize_string_values` — String values materialized correctly
- [x] `test_materialize_bool_values` — Bool values materialized correctly
- [x] `test_materialize_null_values` — null values materialized as Null nodes
- [x] `test_materialize_ragged_missing` — ragged columns: missing cells become absent fields
- [x] `test_materialize_row_single` — `materialize_row(i)` creates Arbor with 1 tree
- [x] `test_materialize_row_values` — single row values match view row i
- [x] `test_materialize_row_out_of_bounds` — `materialize_row(999)` returns error
- [x] `test_materialize_rows_subset` — `materialize_rows(&[0, 2, 4])` creates 3 trees
- [x] `test_materialize_rows_order` — output trees in same order as indices
- [x] `test_materialize_rows_duplicates` — duplicate indices create duplicate trees
- [x] `test_materialize_rows_empty` — `materialize_rows(&[])` creates empty Arbor
- [x] `test_materialize_rows_out_of_bounds` — out-of-bounds index in list returns error
- [x] `test_materialize_empty_view` — empty view materializes to empty Arbor
- [x] `test_materialize_to_json` — materialized Arbor serializes to valid JSON
- [x] `test_materialize_to_jsonl` — materialized Arbor serializes to valid JSONL
**Checkpoint:** `cargo test -p arbors-storage` ✓ (materialize tests in arbors-io)

---

#### Step 6: Integration tests (fixtures) + docs
**Commit:** `row-view-fixture-tests`
**References:**
- Docs: All items in 13.10.4 Documentation Plan
- Fixtures: `testdata/weather/weather-2-day-hourly.json`, `testdata/weather/weather-tides.json`
**Tasks:**
- [x] Add weather hourly + tides integration tests
- [x] Add compute smoke test (Arrow sum via column_array)
- [x] Add materialize end-to-end tests
- [x] Update docs/examples
**Integration Tests (in `crates/arbors-storage/tests/view_integration_tests.rs`):**
- [x] `test_weather_hourly_row_count` — weather hourly has >= 48 rows
- [x] `test_weather_hourly_cell_access` — access specific cells by row/field
- [x] `test_weather_hourly_valid_time_local` — row 0 validTimeLocal contains expected date
- [x] `test_weather_hourly_null_handling` — windGust[0] is null, correctly handled
- [x] `test_weather_hourly_column_array` — column_array works on temperature
- [x] `test_weather_hourly_arrow_sum` — Arrow sum matches manual sum
- [x] `test_weather_tides_nested` — create view over nested tidalForecast object
- [x] `test_weather_tides_row_count` — tides has 10 rows
- [x] `test_weather_tides_tide_type` — row 0 tideType == "H"
- [x] `test_weather_tides_discovery` — discovery helper finds tidalForecast
- [x] `test_end_to_end_view_materialize_serialize` — parse → view → materialize → serialize
- [x] `test_view_then_materialize_then_view` — round-trip: view → materialize → new view → compare
- [x] `test_large_row_count_performance` — basic perf check with larger dataset
**Checkpoint:** `cargo test` ✓

---

#### Step 7: Rename RowView to ArborView
**Commit:** `rename-row-view-to-arbor-view`

**Motivation:**
The abstraction we've built behaves like an Arbor — same operations (head, tail, filter, sort, group_by, etc.), same semantic contract. The name "ArborView" makes this relationship explicit: it's a view that presents columnar data AS an Arbor. Users immediately understand they can use the same operations.

**Renames:**

| Current | New |
|---------|-----|
| `RowView` | `ArborView` |
| `RowViewBuilder` | `ArborViewBuilder` |
| `RowViewOptions` | `ArborViewOptions` |
| `RowSchemaView` | `ArborViewSchema` |
| `RowSchemaField` | `ArborViewSchemaField` |
| `TreeViewBuilder` | *removed* |
| `RowRef` | `RowRef` (keep — still accessing a logical row) |

**API Simplification:**
```rust
// Before:
let view = arbor.create_view(node_id).row_view().build()?;

// After:
let view = arbor.arbor_view(node_id).build()?;
```

**Design Decisions (clean break):**
- Remove `TreeViewBuilder` entirely — `arbor_view()` returns `ArborViewBuilder` directly
- Remove old `row_view()` path entirely — no aliases, no deprecation warnings
- Old names must fail to compile — verify this in tests

**Tasks:**
- [x] Rename `RowView` → `ArborView` in `view.rs`
- [x] Rename `RowViewBuilder` → `ArborViewBuilder`
- [x] Rename `RowViewOptions` → `ArborViewOptions`
- [x] Rename `RowSchemaView` → `ArborViewSchema`
- [x] Rename `RowSchemaField` → `ArborViewSchemaField`
- [x] Remove `TreeViewBuilder` struct entirely
- [x] Remove `create_view()` method from Arbor
- [x] Add `arbor.arbor_view(node_id)` method returning `ArborViewBuilder` directly
- [x] Update module-level documentation in `view.rs` (lines 1-25)
- [x] Update code examples in docstrings throughout `view.rs`
- [x] Update all exports in `lib.rs`
- [x] Update all tests to use new names
- [x] Update `materialize_view` functions in arbors-io to use new names
- [x] Update documentation in `docs/ARCHITECTURE.md`

**Unit Tests:**
- [x] `test_arbor_view_convenience_method` — `arbor.arbor_view(node_id)` works
- [x] `test_arbor_view_builder_methods` — all builder methods work with new names
- [x] Verify old names fail to compile (manual check: `RowView`, `create_view`, `row_view` should not exist)

**Checkpoint:** `cargo test` ✅

---

### 13.10.6 Deliverables and Checkpoints (13.10a)
**Deliverable:** Read-only `ArborView` with schema flip, column-level compute access (`to_arrow()`), `column_nodes()` for any column, row materialization, and nested columnar discovery.

**Final Integration Test Suite (in `crates/arbors/tests/arbor_view_acceptance.rs`):**
- [x] `acceptance_view_basic` — create view, access rows, verify values
- [x] `acceptance_view_strict_mode` — strict mode validation works
- [x] `acceptance_view_ragged_mode` — ragged mode validation works
- [x] `acceptance_row_iteration` — iterate all rows, verify O(1) access pattern
- [x] `acceptance_row_ref_typed_access` — RowRef typed getters return correct values
- [x] `acceptance_column_array_arrow` — column_array → to_arrow → verify array contents
- [x] `acceptance_column_nodes_traversal` — column_nodes → traverse each node → verify values
- [x] `acceptance_schema_flip` — row_schema returns correctly flipped schema
- [x] `acceptance_materialize_all` — materialize all rows, verify Arbor structure
- [x] `acceptance_materialize_subset` — materialize row subset, verify structure
- [x] `acceptance_materialize_serialize` — materialize → serialize to JSON → verify output
- [x] `acceptance_nested_discovery` — discover nested columnar objects in complex JSON
- [x] `acceptance_weather_hourly_full` — full workflow with weather hourly fixture
- [x] `acceptance_weather_tides_full` — full workflow with weather tides fixture
- [x] `acceptance_cross_validation` — view values match direct Arbor access for all cells

| Checkpoint | Verification | Status |
|------------|--------------|--------|
| View abstraction exists | `ArborViewBuilder` compiles and is public; `arbor.arbor_view()` returns it | ✅ |
| Row iteration O(1) | Cell access uses arithmetic; no node lookup per cell | ✅ |
| Strict/Ragged | length mismatch error; ragged yields missing, not null | ✅ |
| Column compute access | `column_array().to_arrow()` returns type-erased Arrow array; sum smoke test passes | ✅ |
| Column nodes access | `column_nodes()` works for any column type | ✅ |
| Non-primitive columns | `column_array()` errors; `column_nodes()` succeeds | ✅ |
| Row materialization | `materialize()` produces AoS Arbor; `materialize_row()`/`materialize_rows()` work | ✅ |
| Weather hourly | fixture tests pass | ✅ |
| Weather tides | fixture tests pass | ✅ |
| Schema flip | `List<T>` → `T` tests (nullable, heterogeneous error) pass | ✅ |
| Nested discovery | helper finds `tidalForecast`-like objects | ✅ |
| Unit tests | `cargo test -p arbors-storage` succeeds (all step tests) | ✅ |
| Integration tests | `cargo test -p arbors` succeeds (acceptance tests) | ✅ |
| Full suite | `cargo test` succeeds | ✅ |

**All checkpoints verified.** CI tests pass: `cargo test`, `make check-stubs`, `make check-parity`

---

### 13.10b: TableOps + Expr parity + grouping semantics
**Commit (planned):** `add-table-ops-trait`
**References:**
- Existing Arbor operations: `head`, `tail`, `filter_by_indices` in `crates/arbors-storage/src/lib.rs`
- Query operations: `filter`, `select`, `sort_by`, `group_by` in `crates/arbors-query/src/ops.rs`
- LazyArbor operations: `crates/arbors-lazy/src/lazy.rs`

**Scope:** Move tabular ergonomics into a shared trait for both `Arbor` and `ArborView`: `head`, `tail`, `take`, `filter`, `sort_by`, `group_by`, `select` (projection), `limit/offset`. This sub-phase also defines stable sort/group semantics and the `GroupedTable` concrete type. Expr parity is required (Expr-based filter/sort/group).

**Motivation:**
ArborView should support the same operations as Arbor. A unified `TableOps` trait ensures both types stay in sync — adding a method to the trait produces compiler errors until both implementations exist, and gives developers the same ergonomic surface regardless of backing (Arbor vs ArborView).

**Design Decisions:**

1. **Return Type and Ownership Model: Zero-Copy Throughout**
   - All `TableOps` methods return `Self` with **no materialization**
   - **Arbor**: Returns new Arbor with Arc-cloned storage (zero-copy, shared backing)
   - **ArborView**: Returns new ArborView with `row_indices` into same underlying storage (zero-copy)
   - **Cost Model**:
     - `head`/`tail`/`slice`: O(k) where k = result size (allocating indices only)
     - `filter`: O(n) scan + O(k) allocation for result indices
     - `sort_by`: O(n) scan + O(n log n) comparison sort + O(k) allocation
     - `group_by`: O(n) scan + O(k) per group for indices

2. **ArborView Internal Change:** Add `row_indices: Option<Vec<usize>>` field
   - `None` = natural order (0..row_count), no allocation
   - `Some(indices)` = reordered/filtered view
   - All row access goes through this indirection

3. **Error Handling:**
   - **Error type**: All methods use `arbors_core::Error`. New variants added:
     - `Error::IndexOutOfRange { index: usize, len: usize }` — for out-of-range indices
     - `Error::CrossTypeComparison { lhs_type: NodeType, rhs_type: NodeType }` — for mixed-type sorts
     - `Error::DescendingLengthMismatch { expected: usize, got: usize }` — for mismatched descending array
   - **Out-of-range indices**: `slice_by_indices` returns **error** if any index >= len() (not skip). Rationale: silent skip hides bugs.
   - **Cross-type comparison**: Returns **error**. Sorting a column with mixed strings and ints is a schema bug. This also applies to mixed element types within arrays/objects being compared. Callers must ensure columns are homogeneously typed; use expressions to coerce if needed.
   - **Mismatched `descending` length**: Returns error if `descending.len() != by.len()`
   - **Schemaless Expr usage**: Allowed; type errors detected at eval time

4. **Expr-based Operations:** Full parity with Arbor
   - `filter(expr)` — filter by Expr predicate
   - `sort_by(exprs, descending)` — sort by Expr keys
   - `group_by(...)` — group by Expr keys
   - `join(...)` — added to trait when Arbor gets it

5. **Sorting/Grouping Semantics (normative, stable)**

   **Ordering Rules (Rust Ord semantics with minimal JSON extension):**
   - **Same-type comparisons**: Use Rust's `Ord` semantics
   - **Floats**: Use `f64::total_cmp` (handles NaN, -0.0 correctly per IEEE 754 total order)
   - **Cross-type comparisons**: **Error** (e.g., comparing string to int is a schema bug)
   - **Null**: Sorts **last** (after all non-null values)
   - **Missing**: Sorts **last** (after null values) — distinct from null, both sort after all present values
   - **NaN**: All NaNs compare equal; they group together; `total_cmp` places them after +∞
   - **Sort order summary** (ascending): values < NaN < null < missing

   **Array/Object Comparison (same-type only):**
   - **Prefix ordering**: Shorter-first (lexicographic)
   - **Arrays**: Compare elements left-to-right; shorter array is less if all elements match
   - **Objects**: Compare by **sorted field names**; for each field name in sorted order, compare values; fewer fields is less if all matching fields are equal; if one object has a field the other lacks, the object with fewer fields is less (consistent with shorter-first)

   **Multi-Key Sorting:**
   - Evaluate keys left-to-right
   - **Per-key inversion**: When `descending[i]` is true, invert the comparison result (Less ↔ Greater) for that key only; the ordering rules stay constant
   - Tie-break with next key; final tie uses stability (preserve input order)

   **Stability:**
   - All sorts are **stable**; comparator ties preserve input order

   **Grouping:**
   - NaN keys compare equal and group together
   - **Null and missing are separate groups** (consistent with sort ordering: null group before missing group)
   - Group emission order = **first-seen key order** (stable, deterministic)
   - Within-group row order follows the stable sort/filter pipeline (respects `row_indices` order)
   - Preserve string case; booleans use their value

**TableOps Trait Definition:**
```rust
/// Unified operations for tabular data access.
///
/// This trait ensures Arbor and ArborView support the same core operations,
/// keeping them in sync as the API evolves. Adding a method to this trait
/// will produce compiler errors until both implementations exist.
///
/// All operations are zero-copy: Arbor returns Arc-cloned storage, ArborView
/// returns views with row_indices into the same underlying storage.
pub trait TableOps: Sized {
    /// Number of rows (trees for Arbor, logical rows for ArborView).
    fn len(&self) -> usize;

    /// Returns true if empty.
    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Return first `n` rows. If n > len(), returns all rows.
    fn head(&self, n: usize) -> Self;

    /// Return last `n` rows. If n > len(), returns all rows.
    fn tail(&self, n: usize) -> Self;

    /// Return rows at the specified indices (order preserved, duplicates allowed).
    ///
    /// # Errors
    /// Returns error if any index >= len().
    ///
    /// # Contract
    /// Implementations MUST return `Ok` for all indices in range `0..self.len()`.
    /// The `slice()` default impl relies on this guarantee after clamping.
    fn slice_by_indices(&self, indices: &[usize]) -> Result<Self, Error>;

    /// Return rows in the range [start, end). Clamps to valid range.
    fn slice(&self, start: usize, end: usize) -> Self {
        let clamped_end = end.min(self.len());
        let clamped_start = start.min(clamped_end);
        let indices: Vec<usize> = (clamped_start..clamped_end).collect();
        // Safe: clamping guarantees all indices are in range
        self.slice_by_indices(&indices)
            .expect("slice_by_indices cannot fail on clamped indices")
    }

    /// Reverse row order.
    fn reverse(&self) -> Self;

    /// Filter rows by expression predicate.
    fn filter(&self, predicate: &Expr) -> Result<Self, Error>;

    /// Sort rows by expression keys.
    ///
    /// # Errors
    /// - Returns error if `descending.len() != by.len()`
    /// - Returns error on cross-type comparison (e.g., string vs int)
    fn sort_by(&self, by: &[Expr], descending: &[bool]) -> Result<Self, Error>;

    /// Group rows by expression keys.
    ///
    /// Groups are returned in first-seen key order (stable, deterministic).
    /// Each group is a zero-copy view sharing the underlying storage.
    ///
    /// # Errors
    /// - Returns error on cross-type key comparison
    fn group_by(&self, keys: &[Expr]) -> Result<GroupedTable<Self>, Error>;
}
```

**GroupedTable type (zero-copy groups, first-seen order):**
```rust
/// Result of a group_by over tabular data.
///
/// Groups are returned in first-seen key order. Each group is a zero-copy
/// view: ArborView groups have `row_indices` pointing into the original
/// storage; Arbor groups have Arc-cloned storage.
pub struct GroupedTable<T> {
    /// Canonical keys, one per group, in first-seen order.
    /// Null and Missing are separate groups (distinct keys).
    pub keys: Vec<GroupKey>,
    /// Groups in first-seen order, sharing backing storage (zero-copy).
    pub groups: Vec<T>,
}

/// Canonical key used for grouping comparisons.
///
/// Null and Missing are distinct keys (separate groups).
/// Sort order (ascending): values < NaN < Null < Missing.
pub enum GroupKey {
    Null,                    // explicit null value
    Missing,                 // field not present (distinct from null)
    NaN,                     // all NaN values (compare equal, group together)
    Bool(bool),
    Int(i64),
    Float(OrdFloat),         // wrapper using total_cmp for Ord
    String(String),
    Array(Vec<GroupKey>),
    Object(BTreeMap<String, GroupKey>),
}

/// f64 wrapper that implements Ord using total_cmp.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OrdFloat(pub f64);

impl Eq for OrdFloat {}

impl Ord for OrdFloat {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.0.total_cmp(&other.0)
    }
}

impl PartialOrd for OrdFloat {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
```

**Closure-based Convenience Methods (ArborView only):**

These methods use Rust's `Ord` semantics directly and do **NOT** apply the Expr ordering
ladder (no special null/missing handling, no cross-type errors). They are "best effort"
helpers for simple cases:
- The key type `K` must implement `Ord`; for floats, use `OrdFloat` wrapper
- Null/missing values will compare based on whatever the closure returns (e.g., `Option::None`)
- For full Expr-style ordering with null/missing sort-last semantics, use `sort_by(&[Expr], &[bool])`

```rust
impl<'a> ArborView<'a> {
    /// Filter rows by predicate closure (convenience, no Expr needed).
    pub fn filter_by<F>(&self, predicate: F) -> Self
    where
        F: Fn(&RowRef<'_, '_>) -> bool;

    /// Sort rows by key extractor (convenience, no Expr needed).
    /// Uses Rust Ord semantics; sort is stable.
    ///
    /// # Panics
    /// Panics if `K` is `f64` and any value is NaN (f64 doesn't implement Ord).
    /// For float sorting, use `OrdFloat` wrapper:
    /// `sort_by_key(|r| OrdFloat(r.get_f64("temp").unwrap_or(0.0)))`
    pub fn sort_by_key<K, F>(&self, key_fn: F) -> Self
    where
        K: Ord,
        F: Fn(&RowRef<'_, '_>) -> K;

    /// Sort rows by key extractor, descending.
    /// Uses Rust Ord semantics; sort is stable.
    ///
    /// # Panics
    /// Panics if `K` is `f64` and any value is NaN (f64 doesn't implement Ord).
    /// For float sorting, use `OrdFloat` wrapper.
    pub fn sort_by_key_desc<K, F>(&self, key_fn: F) -> Self
    where
        K: Ord,
        F: Fn(&RowRef<'_, '_>) -> K;

    /// Sort rows by comparator function.
    /// Sort is stable; comparator ties preserve input order.
    pub fn sort_by_cmp<F>(&self, comparator: F) -> Self
    where
        F: Fn(&RowRef<'_, '_>, &RowRef<'_, '_>) -> std::cmp::Ordering;
}
```

**Tasks:**
- [x] Add new error variants to `arbors_core::Error`: `IndexOutOfRange`, `CrossTypeComparison`, `DescendingLengthMismatch`
- [x] Create `TableOps` trait with all methods
- [x] Add `row_indices: Option<Vec<usize>>` field to ArborView
- [x] Update ArborView row access to use row_indices indirection
- [x] Implement `TableOps` for `Arbor` (delegate to existing methods where possible)
- [x] Implement `TableOps` for `ArborView`
- [x] Add closure-based convenience methods to ArborView
- [x] Rename Arbor's `filter_by_indices` to `slice_by_indices` for consistency
- [x] Update `column_array()` to respect row_indices
- [x] Update `materialize_view()` to respect row_indices
- [x] Export `TableOps` trait, `GroupedTable`, `GroupKey`, `OrdFloat`

**Unit Tests (in `crates/arbors-storage/tests/table_ops_tests.rs`):**

*TableOps trait tests (test both Arbor and ArborView):*
- [x] `test_arbor_len` — Arbor.len() returns num_trees
- [x] `test_arbor_view_len` — ArborView.len() returns row_count
- [x] `test_arbor_head` — Arbor.head(n) returns first n trees (includes n > len edge case)
- [x] `test_arbor_view_head` — ArborView.head(n) returns first n rows
- [x] `test_arbor_tail` — Arbor.tail(n) returns last n trees (includes n > len edge case)
- [x] `test_arbor_view_tail` — ArborView.tail(n) returns last n rows
- [x] `test_arbor_slice_by_indices` — Arbor.slice_by_indices preserves order
- [x] `test_arbor_view_slice_by_indices` — ArborView.slice_by_indices preserves order
- [x] `test_arbor_slice` — Arbor.slice(start, end) works correctly (includes out-of-bounds clamping)
- [x] `test_arbor_view_slice` — ArborView.slice(start, end) works correctly
- [x] `test_arbor_reverse` — Arbor.reverse() reverses tree order
- [x] `test_arbor_view_reverse` — ArborView.reverse() reverses row order
- [x] `test_arbor_slice_by_indices_error` — out-of-range index returns error
- [x] `test_arbor_view_slice_by_indices_error` — out-of-range index returns error

*Expr-based operation tests (in arbors-query, not TableOps scope):*
Note: Expr-based operations (filter, sort_by, group_by with Expr) remain as free functions in arbors-query per design decision. These tests exist in arbors-query test suites.

*OrdFloat and GroupKey ordering tests:*
- [x] `test_ord_float_ordering` — OrdFloat total ordering (NaN > infinity, -0 < +0)
- [x] `test_ord_float_nan_equality` — NaN == NaN for grouping
- [x] `test_group_key_null_missing_distinct` — GroupKey::Null != GroupKey::Missing
- [x] `test_group_key_ordering` — values < NaN < Null < Missing

*Closure-based operation tests (ArborView only):*
- [x] `test_arbor_view_filter_by` — filter_by with predicate (covers some match, preserves order)
- [x] `test_arbor_view_sort_by_key` — sort by i64 field ascending
- [x] `test_arbor_view_sort_by_key_desc` — sort by i64 field descending
- [x] `test_arbor_view_sort_by_key_string` — sort by string field (`test_arbor_view_sort_by_string`)
- [x] `test_arbor_view_sort_by_cmp` — sort by custom comparator
- [x] `test_arbor_view_filter_then_sort` — chained operations work
- [x] `test_arbor_view_chained_operations` — head/tail/slice chaining

*Row indices indirection tests:*
- [x] `test_arbor_view_column_array_respects_row_indices` — column_array uses row_indices
- [x] `test_arbor_view_column_array_reversed` — column_array after reverse
- [x] `test_materialize_view_respects_row_indices` — materialize uses row_indices
- [x] `test_materialize_view_filtered` — materialize after filter

**Checkpoint:** `cargo test` ✅ (486 tests pass, including 29 new TableOps tests)

**Future: When Arbor gets `join`:**
- Add `join` method to `TableOps` trait
- Compiler will enforce implementation for both Arbor and ArborView

---

### 13.10b2: QueryOps Extension Trait for Method Syntax

**Scope:** Create `QueryOps` extension trait in arbors-query that provides Expr-based operations as methods on Arbor and ArborView, enabling idiomatic `arbor.filter(expr)` syntax.

**Motivation:** Currently, Expr-based operations are free functions in arbors-query due to crate boundaries (Arbor in arbors-storage, Expr in arbors-expr). The idiomatic Rust solution is an extension trait — the same pattern used by Iterator extensions in std.

**Deliverable:** `QueryOps` trait with filter/sort_by/group_by/distinct methods, implemented for both Arbor and ArborView, re-exported through arbors prelude.

**Design:**

```rust
// In crates/arbors-query/src/query_ops.rs

use arbors_core::Result;
use arbors_expr::Expr;
use arbors_storage::{Arbor, ArborView, GroupedTable, TableOps};

/// Extension trait providing Expr-based query operations as methods.
///
/// This trait extends `TableOps` with operations that require expression evaluation.
/// Import this trait to use method syntax for filter, sort, group, and distinct.
///
/// # Example
/// ```
/// use arbors::prelude::*;
///
/// let filtered = arbor.filter(&path("age").gt(lit(21)))?;
/// let sorted = arbor.sort_by(&[path("name")], &[false])?;
/// let groups = arbor.group_by(&[path("department")])?;
/// ```
pub trait QueryOps: TableOps + Sized {
    /// Filter to rows where expression evaluates to true.
    ///
    /// Returns a new collection containing only rows where the predicate
    /// expression evaluates to a scalar boolean `true`. Rows where the
    /// expression evaluates to `false`, `null`, or `missing` are excluded.
    ///
    /// # Errors
    /// - `TypeMismatch` if expression doesn't yield scalar boolean per row
    fn filter(&self, predicate: &Expr) -> Result<Self>;

    /// Sort rows by one or more expressions.
    ///
    /// Rows are sorted by the first expression, with ties broken by subsequent
    /// expressions. The `descending` slice must match `by.len()` — each element
    /// controls sort direction for the corresponding expression.
    ///
    /// Ordering follows Expr semantics:
    /// - values < NaN < null < missing
    /// - NaN uses IEEE 754 total_cmp (NaN > +∞)
    /// - Descending inverts comparison per-key, not the type ladder
    ///
    /// # Errors
    /// - `DescendingLengthMismatch` if `descending.len() != by.len()`
    /// - `CrossTypeComparison` if a sort key has mixed types across rows
    fn sort_by(&self, by: &[Expr], descending: &[bool]) -> Result<Self>;

    /// Group rows by one or more key expressions.
    ///
    /// Returns groups in first-seen key order. Within each group, rows maintain
    /// their original pipeline order.
    ///
    /// Grouping semantics:
    /// - NaN == NaN (groups together, unlike IEEE equality)
    /// - null and missing are distinct groups (both sort last)
    ///
    /// # Errors
    /// - `CrossTypeComparison` if a grouping key has mixed types across rows
    fn group_by(&self, by: &[Expr]) -> Result<GroupedTable<Self>>;

    /// Remove duplicate rows based on key expressions.
    ///
    /// Keeps the first occurrence of each unique key combination.
    /// Order of remaining rows matches their first appearance in input.
    ///
    /// # Errors
    /// - `CrossTypeComparison` if a key has mixed types across rows
    fn distinct(&self, by: &[Expr]) -> Result<Self>;
}
```

**Implementation Strategy:**

For `Arbor`:
- Delegate to existing free functions in arbors-query
- `filter`: call `filter()` to get indices, then `slice_by_indices()`
- `sort_by`: call existing `sort_by()` which returns reordered Arbor
- `group_by`: call existing `group_by()`, wrap result in `GroupedTable`
- `distinct`: call existing `distinct()`

For `ArborView`:
- Create new ArborView with `row_indices` set (zero-copy filtering/reordering)
- `filter`: evaluate predicate per row, collect passing indices
- `sort_by`: evaluate keys, argsort, set `row_indices`
- `group_by`: evaluate keys, partition indices into groups
- `distinct`: evaluate keys, keep first occurrence indices

**Tasks:**
- [x] Create `crates/arbors-query/src/query_ops.rs` with `QueryOps` trait definition
- [x] Implement `QueryOps` for `Arbor` (delegate to existing free functions)
- [x] Implement `QueryOps` for `ArborView` (use row_indices for zero-copy)
- [x] Add `filter_indices()` helper for ArborView (returns Vec<usize> of matching rows)
- [x] Export `QueryOps` from `arbors-query/src/lib.rs`
- [x] Re-export `QueryOps` in `arbors/src/lib.rs` prelude
- [x] Update arbors prelude to include QueryOps for seamless method syntax
- [x] Keep free functions

**Unit Tests (in `crates/arbors-query/tests/query_ops_tests.rs`):**

*Arbor QueryOps tests:*
- [x] `test_filter_on_arbor` — `arbor.filter(expr)` returns filtered Arbor
- [x] `test_filter_with_null_treated_as_false` — null values treated as false in filter
- [x] `test_filter_empty_arbor` — filter on empty arbor returns empty
- [x] `test_filter_none_match` — filter with no matches returns empty
- [x] `test_filter_all_match` — filter with all matches returns all
- [x] `test_sort_by_single_key` — `arbor.sort_by(exprs, desc)` returns sorted Arbor
- [x] `test_sort_by_multi_key_tiebreaker` — multi-key sort with tiebreaker
- [x] `test_sort_by_descending` — descending sort order
- [x] `test_sort_by_empty_arbor` — sort on empty arbor returns empty
- [x] `test_group_by_single_key` — `arbor.group_by(exprs)` returns GroupedTable<Arbor>
- [x] `test_group_by_multi_key` — multi-key grouping
- [x] `test_group_by_maintains_order` — groups in first-seen key order
- [x] `test_group_by_empty_arbor` — group_by on empty arbor returns empty
- [x] `test_distinct_on_arbor` — `arbor.distinct(exprs)` returns deduplicated Arbor
- [x] `test_distinct_multi_key` — distinct with multiple keys
- [x] `test_distinct_empty_arbor` — distinct on empty arbor returns empty
- [x] `test_distinct_all_unique` — distinct with all unique values

*ArborView QueryOps tests:*
- [x] `test_filter_on_arbor_view` — `view.filter(expr)` returns filtered ArborView
- [x] `test_sort_by_on_arbor_view` — `view.sort_by(exprs, desc)` returns sorted ArborView
- [x] `test_group_by_on_arbor_view` — `view.group_by(exprs)` returns GroupedTable<ArborView>
- [x] `test_distinct_on_arbor_view` — `view.distinct(exprs)` returns deduplicated ArborView

*Null and NaN handling:*
- [x] `test_group_by_with_null` — null values form their own group
- [x] `test_sort_by_with_null` — null sorts first in ascending order
- [x] `test_sort_by_with_nan` — mixed types sort without panicking
- [x] `test_group_by_nan_groups_together` — NaN values group together

*Error handling:*
- [x] `test_sort_by_descending_length_mismatch` — wrong descending length returns error
- [x] `test_filter_type_mismatch` — non-boolean filter predicate returns error
- [x] `test_empty_expressions_error` — empty expressions in sort_by/group_by/distinct return error

**Checkpoint:** `cargo test` ✓

**Implementation Notes:**
- Zero-copy verification is implicit via ArborView's row_indices design
- Method chaining works via QueryOps returning Self (which requires TableOps + Sized)
- Prelude provides QueryOps through arbors/src/lib.rs re-export

---

### 13.10c: Writes/Reshaping via ArborViewEditPlan
**Scope:** scalar/null cell edits, add/remove columns, append/delete rows; COW with maximal sharing; outputs remain columnar.
**Deliverable:** `ArborViewEditPlan` that applies edits to produce a new Arbor, sharing unchanged columns.
**Checkpoints:** mutation plan compiles; cell edit/append/delete tests; COW sharing verified; `cargo test` succeeds.
**Note:** Nested values for edits are deferred beyond 13.10b.

---

