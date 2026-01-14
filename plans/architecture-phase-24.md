# Phase 24: API Surface Expansion - String Matching, DataFrame Parity, Expression Parity, Tree Operations, Embeddings

## Executive Summary

Phase 24 expands Arbors' API surface area with seven components designed to make Arbors competitive with and superior to Polars/pandas for JSON data processing, while adding tree-native capabilities that go beyond what tabular frameworks can offer:

1. **Unified String Matching API** - A single `match()` entry point that subsumes exact, contains, regex, fuzzy, and lenient matching with clean mode parameters
2. **DataFrame-style Operations** - Systematic expansion of Arbor-level operations inspired by Polars DataFrame API, adapted for hierarchical JSON data
3. **Expression Operations Parity** - Comprehensive expression-level operations covering string, list, temporal, and struct namespaces
4. **ArborPath Foundation** - Unified path type for single-value navigation, replacing duplicate PathSegment types across the codebase
5. **Walking & Traversal** - jq-style walk/recurse with unified walker implementation
6. **Diffing, Merging, and Patching** - Semantic tree diffing, three-way merge, and RFC 6902-compatible patching
7. **Embeddings & Vector Search** - Native embedding type with similarity operations (cosine, euclidean, dot product) enabling semantic search where matching on embeddings brings the whole tree along - flipping the vector database paradigm on its head

### Key Design Principle: Single Entry Points

Rather than proliferating methods (like Polars' many separate string methods), Phase 24 prioritizes **unified entry points with mode parameters**. This approach:
- Reduces API surface cognitive load
- Makes discovery easier (one method to learn)
- Enables consistent parameter patterns across modes
- Simplifies documentation and migration

---

## Key Decisions Table

| Decision | Choice | Rationale |
|----------|--------|-----------|
| String matching entry point | Single `match()` with `mode` parameter | User requirement - avoid method proliferation |
| Lenient mode behavior | Auto case-insensitive + auto wildcards | Simplest user experience - just pass needle |
| Fuzzy matching algorithm | Edit distance (Levenshtein) | Industry standard, predictable behavior |
| String accessor pattern | `.str` namespace accessor | Consistent with Polars, groups related ops |
| List/array accessor pattern | `.arr` namespace accessor | Codebase-native naming; arrays are the correct Arbors term |
| Temporal accessor pattern | `.dt` namespace (already exists) | Extend existing pattern |
| Struct/object accessor pattern | `.obj` namespace accessor | Codebase-native naming; objects are the correct Arbors term |
| DataFrame ops scope | Subset adapted for hierarchical data | Skip operations that assume flat tables |
| Tree traversal API | Visitor pattern with mode parameter | Single `traverse()` entry point |
| Tree diff algorithm | Semantic diff with edit operations | Inspired by Graphtage, produces minimal edits |
| Tree merge strategy | Three-way merge with conflict detection | JSON Merge Patch (RFC 7386) compatible |
| Tree patch format | JSON Patch (RFC 6902) | Standard format, interoperable |
| Embedding type | Array of f64 + `LogicalType::Embedding` | Codebase-native: logical types already exist; storage is list-of-f64 in v1 |
| Embedding similarity | Single `similar()` with metric parameter | Consistent with single-entry-point philosophy |
| Embedding normalization | Optional, user-controlled | Some models emit normalized, some don't |
| Vector search scope | KNN within arbor, no external index | Keep it simple, defer ANN indexing |
| Implementation order | Component 1 first (most user-visible) | Deliver immediate value, validate patterns |

---

## Dependencies

1. **Regex crate** - Already in dependencies
2. **Edit distance** - Need to add algorithm implementation or crate (e.g., `triple_accel` or `strsim`)
3. **LCS algorithm** - For array diffing (can implement or use `lcs-diff` crate)
4. **JSON Pointer** - For RFC 6901 path parsing (can implement or use `jsonptr` crate)
5. **SIMD intrinsics** - For embedding distance computation (std::arch, optional `packed_simd` or `simdeez`)

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| String operations are hot path | Vectorization strategy, benchmark early |
| Edit distance can be O(n*m) | Limit max string length, early termination |
| API surface area growth | Accessor pattern groups related operations |
| Python binding complexity | Follow existing patterns |
| Tree diff exponential worst case | Use heuristics, limit depth, early termination |
| Merge conflict complexity | Clear conflict representation, sensible defaults |
| Zipper memory for large trees | Lazy reconstruction, COW where possible |
| RFC compliance testing | Use official test suites for RFC 6902/7386 |
| Embedding dimension mismatch | Runtime validation, clear error messages |
| KNN O(n) for large arbors | Document recommendation to filter first, defer ANN indexing |
| SIMD portability | Provide fallback scalar implementations |
| Float precision in similarity | Use f32 (industry standard), document precision characteristics |

## Research Sources

Component 4 was designed using research from:
- [jq Manual](https://jqlang.org/manual/) - walk, recurse, path operations
- [Graphtage](https://github.com/trailofbits/graphtage) - Semantic tree diffing
- [treediff crate](https://lib.rs/crates/treediff) - Rust tree diff/merge
- [Huet's Zipper](https://en.wikipedia.org/wiki/Zipper_(data_structure)) - Functional tree navigation
- [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902) - JSON Patch
- [RFC 7386](https://www.rfc-editor.org/rfc/rfc7386) - JSON Merge Patch
- [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901) - JSON Pointer
- [Clojure Zippers](https://clojure.org/reference/other_libraries) - Practical zipper API design
- [JSONata](https://docs.jsonata.org/path-operators) - Path operator patterns

Component 5 was designed using research from:
- [Pinecone Vector Similarity](https://www.pinecone.io/learn/vector-similarity/) - Distance metric semantics
- [Zilliz Similarity Metrics](https://zilliz.com/blog/similarity-metrics-for-vector-search) - Choosing metrics for use cases
- [Google Cloud Spanner Vector](https://cloud.google.com/spanner/docs/choose-vector-distance-function) - Distance function API design
- [Zilliz Embedding Normalization](https://zilliz.com/ai-faq/what-is-the-proper-way-to-normalize-embeddings) - L2 normalization best practices
- [Redis Vector Sets](https://redis.io/blog/vector-similarity/) - KNN vs ANN trade-offs
- [SQL Server 2025 Vector](https://www.mssqltips.com/sqlservertip/8299/vector-search-in-sql-server/) - Vector search in relational context

---

## Component 1: Unified String Matching API

### 1.1 Design Philosophy

The user explicitly requested a **single entry point** rather than separate methods. This design delivers:

```python
# SINGLE entry point - all matching modes via parameter
# NOTE: Accessor pattern removed - methods are now directly on Expr
path("name").match_("john", mode="lenient")        # Auto *needle* + case-insensitive
path("name").match_("John", mode="exact")          # Exact case-sensitive
path("name").match_("john", mode="contains")       # Substring (like str_contains)
path("name").match_(".*john.*", mode="regex")      # Full regex
path("name").match_("johm", mode="fuzzy", max_distance=1)  # Edit distance
```

**Lenient mode is the key innovation**: it should be the simplest possible way to do a "fuzzy" search for typical use cases. Just pass the needle - no wildcards, no case flags.

**Implementation contract:** This component is the *user-facing design*. The authoritative implementation plan (semantics, caching, vectorization rules) is **Sections 1.6–1.7** below.

### 1.2 Match Mode Semantics

| Mode | Behavior | Parameters | Example |
|------|----------|------------|---------|
| `exact` | Case-sensitive equality | `case_insensitive: bool = False` | `"John" == "John"` |
| `contains` | Substring match | `case_insensitive: bool = False` | `"John Smith" contains "John"` |
| `starts_with` | Prefix match | `case_insensitive: bool = False` | `"John Smith" starts with "Jo"` |
| `ends_with` | Suffix match | `case_insensitive: bool = False` | `"John Smith" ends with "ith"` |
| `regex` | Full regex matching | (pattern is regex; **literal-only**) | `"John" matches "J.*n"` |
| `fuzzy` | Edit distance | `max_distance: int = 1` | `"Johm"` within 1 edit of `"John"` |
| `lenient` | **Auto wildcards + case-insensitive** | (none - simplest mode) | `"john"` matches `"JOHN SMITH"` |

### 1.2.1 Null and Missing semantics (normative)

These rules are **required** for predictable filtering behavior and must match Section **1.6.1**:

- If either operand is **Missing** ⇒ result is **Missing**
- Else if either operand is **Null** ⇒ result is **Null**
- Else both operands must be strings; non-string operands ⇒ **TypeMismatch**

Filters treat Missing/Null as falsey (drop row), so missing fields “just don’t match” without errors.

### 1.2.2 Regex mode notes (normative)

- **Literal-only patterns**: regex mode requires a literal pattern string (enables vectorization and per-execution caching). Enforced at **expression construction time**; non-literal patterns error immediately.
- **Regex language limitations**: uses Rust `regex` crate (no look-around, no backrefs). Must be documented in Python docstrings; error messages for unsupported syntax should mention "Rust regex crate limitations".
- **No per-row compilation**: regex must be compiled once per pattern per execution (Section **1.6.2** cache + vectorized kernel).

### 1.2.3 Fuzzy mode notes (v1)

- **Distance unit**: Levenshtein over Unicode scalar values (`chars()`), not bytes.
- **Bounded execution**: must early-exit when distance exceeds `max_distance` (fast for small thresholds).
- **No normalization in v1**: no NFC/case-folding beyond the selected mode; keep behavior predictable and dependency-free.
- **Max string length**: default 1000 characters. Strings exceeding this limit return `null` (not an error).
- **No vectorization**: fuzzy mode is O(n*m) per comparison and is intentionally excluded from vectorization; always uses interpreter path.

### 1.3 Lenient Mode Specification

**Lenient mode is intentionally opinionated** to be the "it just works" option:

1. **Case-insensitive by default** - No flag needed; the `case_insensitive` parameter is **ignored** for lenient mode
2. **Implicit wildcards at start and end** - `needle` becomes `*needle*`
3. **Whitespace normalization** - Multiple spaces treated as single (uses Rust's `char::is_whitespace()`)
4. **No user-visible mini-syntax** - Just pass the search term

```python
# User writes:
path("title").match_("machine learning", mode="lenient")

# Internally becomes:
# - Unicode lowercase both sides
# - Whitespace normalization:
#   - map all Unicode whitespace to ASCII space
#   - collapse runs of spaces to a single space
#   - trim
# - Match semantics: substring contains (implicit wildcards)
# - Matches: "Introduction to Machine Learning", "MACHINE LEARNING 101", etc.
```

### 1.4 API surface (Rust + Python)

**Python**

`path("x").match_(...)` is primary; convenience wrappers route through it:

```python
path("name").match_("john", mode="lenient")
path("name").str_contains("john", case_insensitive=True)
path("name").equals("John")  # exact
path("email").regex(r".*@company\.com$")
path("name").fuzzy("johm", max_distance=1)
```

**Rust**

Rust uses `match_` (keyword) directly on Expr:

```rust
use arbors_expr::{path, lit, StringMatchMode};

let q = path("name").match_(lit("john"), StringMatchMode::Lenient);
let q = path("name").str_contains(lit("john"), true);
```

### 1.5 Vectorization Strategy (real, codebase-native)

String matching must **auto-vectorize when possible** (schema present), and otherwise fall back to interpreter evaluation.

**Vectorize when:**

- haystack projects to a string column, and
- pattern is a **literal string** (required for regex; recommended for other modes), and
- mode is one of: exact / contains / starts_with / ends_with / lenient / regex

**Otherwise:** fall back to interpreter evaluation (still correct; just slower).

> Implementation details (kernels, caching, literal-pattern checks) are specified in **Sections 1.6–1.7** and should not be duplicated here.

---

### 1.6 String Matching Foundation

**Goal:** Implement a unified **string matching entry point** that is:

- **Ergonomic**: `path("name").match_("john", mode="lenient")`
- **Correct**: consistent Null/Missing semantics across all string predicates
- **Fast**: auto-vectorizes when possible; regex never compiles per-row
- **Codebase-native**: keep existing `.arr` / `.obj` naming; add only what’s missing

**Cross-References:**
- **Component 1: Unified String Matching API** - Full design rationale, mode semantics
- **Section 1.2: Match Mode Semantics** - Table of all modes with behavior specifications
- **Section 1.3: Lenient Mode Specification** - Detailed lenient mode behavior

#### 1.6.0 API Surface (No drift)

**Important:**

- **Accessor pattern removed** - methods are now directly on `Expr` (see Component 3.7 addendum).
- `.match_(...)` becomes the **primary** API for string matching; convenience methods call into it.

**Python API:**

```python
path("name").match_("john", mode="lenient")
path("name").str_contains("john", case_insensitive=True)
path("name").equals("John")  # exact
path("email").regex(r".*@company\.com$")
path("name").fuzzy("johm", max_distance=1)
```

**Rust API:**

```rust
use arbors_expr::{path, lit};

let q = path("name").match_(lit("john"), StringMatchMode::Lenient);
let q = path("name").str_contains(lit("john"), true);
```

Notes:
- Rust method is named `match_` (keyword).
- `Expr::StrMatch` is a **new** variant. Existing `StartsWith`/`EndsWith` remain as-is; `StrContains` becomes an alias for `StrMatch` with `mode=Contains`.

#### 1.6.1 Semantics (Proposal; optimize for “it just works”)

**Null and Missing**

- If either operand is **Missing** ⇒ result is **Missing**
- Else if either operand is **Null** ⇒ result is **Null**
- Else operate on strings; non-string operands ⇒ **TypeMismatch**

This ensures filters behave intuitively: filters treat Null/Missing as false, so missing fields simply do not match (without errors).

**Case-insensitive**

- Use Unicode `to_lowercase()` for v1 (simple, predictable; no extra dependencies).

**Lenient mode (clarified)**

Lenient is a *super-simple search* that users shouldn't have to think about:

- Unicode lowercase both sides
- **Whitespace normalization** (uses `char::is_whitespace()`):
  - map all Unicode whitespace to ASCII space
  - collapse runs of spaces to a single space
  - trim
- Match semantics: substring contains (implicit wildcards)
- Do **not** strip punctuation in v1 (surprising, language-dependent)
- The `case_insensitive` parameter is **ignored** for lenient mode (always case-insensitive)

#### 1.6.2 Performance: regex must not compile per-row

Two complementary mechanisms:

- **Interpreter path (no schema / non-vectorized)**: add a per-execution **regex cache** and plumb it through `EvalContext`, so `regex_match`, `regex_extract`, and `regex_replace` compile once per distinct pattern string per query execution. The cache is shared across all regex operations.
- **Vectorized path (schema present)**: compile once per expression evaluation and run a single-pass kernel over the projected string column.

#### 1.6.3 Vectorization rules: auto-vectorize when possible

Add `Expr::StrMatch` to vectorized execution when:

- the haystack expression projects to a string column, and
- the pattern is a **literal string** (required for regex; recommended for best performance), and
- the mode is one of: exact / contains / starts_with / ends_with / lenient / regex

Otherwise, fall back to interpreter execution.

| Step | Task | Files | Notes |
|------|------|-------|-------|
| 1 | Add `StringMatchMode` enum | `crates/arbors-expr/src/expr.rs` | Exact, Contains, StartsWith, EndsWith, Regex, Fuzzy, Lenient |
| 2 | Add `StrMatch` Expr variant | `crates/arbors-expr/src/expr.rs` | Fields: string, pattern, mode, case_insensitive, max_distance |
| 3 | Add `match_()` method directly to `Expr` (Rust) | `crates/arbors-expr/src/expr.rs` | Accessor pattern removed - methods are direct on Expr |
| 4 | Create `string_utils.rs` | `crates/arbors-query/src/string_utils.rs` (new) | Levenshtein + lenient normalization helpers |
| 5 | Fix Missing propagation for existing string predicates | `crates/arbors-query/src/eval.rs` | `str_contains/starts_with/ends_with/regex_match/regex_extract/regex_replace` consistent rules |
| 6 | Implement `eval_str_match` | `crates/arbors-query/src/eval.rs` | All modes, **Missing/Null rules**, type checks (follows pattern from Step 5) |
| 7 | Add regex caching (no per-row compile) | `crates/arbors-query/src/context.rs` + `crates/arbors-query/src/regex_cache.rs` (new) | Cache compiled `Regex` by pattern; shared by `regex_match/extract/replace` |
| 8 | Vectorize `StrMatch` where possible | `crates/arbors-query/src/vectorized.rs` | Literal-pattern fast paths + regex kernel |
| 9 | Python: expose `match_()` + convenience methods directly on Expr | `python/src/lib.rs` | `.str_contains()/.equals()/.regex()/.fuzzy()/.lenient()` call through |
| 10 | Python type stubs | `python/arbors/_arbors.pyi` | Add `match()` + convenience signatures |
| 11 | Unit tests (modes + edge cases) | `crates/arbors-query/tests/` | Include Missing/Null behavior |
| 12 | Unit tests: regex cache correctness | `crates/arbors-query/tests/` | Assert compile happens once per pattern per run |
| 13 | Unit tests: vectorization triggers | `crates/arbors-query/tests/` | Schema + literal pattern vectorizes; dynamic pattern falls back |
| 14 | Unit tests: dynamic pattern fallback | `crates/arbors-query/tests/` | `path("name").match_(path("pattern_field"), mode="contains")` works via interpreter |
| 15 | Integration tests | `crates/arbors/tests/integration/` + `python/tests/` | `filter()` with `match_()` end-to-end |

**Tests:**

| Test Category | Command | Expected Result |
|--------------|---------|-----------------|
| Unit: all modes | `cargo nextest run -p arbors-query str_match_` | All modes behave per spec |
| Unit: missing/null | `cargo nextest run -p arbors-query str_match_missing` | Missing/Null rules correct (no TypeMismatch for Missing) |
| Unit: regex cache | `cargo nextest run -p arbors-query regex_cache` | Regex cache hit rate is 100% when same pattern is used across rows |
| Unit: vectorization | `cargo nextest run -p arbors-query vectorized_str_match` | Literal patterns vectorize; dynamic patterns fall back |
| Unit: dynamic fallback | `cargo nextest run -p arbors-query str_match_dynamic` | Dynamic pattern expressions work correctly via interpreter |
| Integration | `cargo nextest run -p arbors str_match` | `filter()` with `match_()` works |
| Python | `just python-test -- -k test_str_match` | Python `match_()` works |

**Checkpoint:**

- [ ] `StringMatchMode` enum added with all 7 variants
- [ ] `Expr::StrMatch` variant added with: string, pattern, mode, case_insensitive, max_distance
- [ ] Rust `match_()` method exists directly on `Expr`; convenience methods route through it
- [ ] Missing/Null semantics are consistent across **all** string predicates (including existing `str_contains/starts_with/ends_with/regex_*`)
- [ ] Lenient mode implements lowercase + whitespace normalization (`char::is_whitespace()`) + contains
- [ ] Regex cache hit rate is 100% when same pattern is used across rows (no per-row compilation)
- [ ] Vectorization triggers automatically when schema + literal patterns allow it
- [ ] Dynamic pattern expressions (e.g., `path("pattern_field")`) fall back to interpreter and produce correct results
- [ ] Python `path("x").match_(...)` works; convenience methods (`.str_contains()`, `.equals()`, etc.) call through `match_()`
- [ ] All targeted unit tests pass
- [ ] All integration tests pass

---

### 1.7 String Operations Extension

**Goal:** Complete the `.str` namespace by adding missing ops, while hardening correctness and performance.

#### 1.7.0 Scope and policy (v1)

- Unicode semantics: string indices operate on Unicode scalar values (`chars()`), not bytes.
- Add `len_bytes()` for byte-length when needed.
- Regex patterns remain literal-only (same as today).
- Prefer **minimal churn**: implement new ops as Expr variants + evaluator arms + Python bindings.

| Step | Task | Files | Notes |
|------|------|-------|-------|
| 1 | Add new Expr variants | `crates/arbors-expr/src/expr.rs` | title/capitalize/pad_start/pad_end/zfill/head/tail/extract_all/len_bytes/replace_first |
| 2 | Add Rust convenience methods directly to `Expr` | `crates/arbors-expr/src/expr.rs` | All new methods directly on Expr (accessor pattern removed) |
| 3 | Implement evaluators | `crates/arbors-query/src/eval.rs` | Correct Missing/Null behavior; reuse regex cache |
| 4 | Extend vectorized execution (optional but recommended) | `crates/arbors-query/src/vectorized.rs` | `regex_match(literal)` kernel; keep literal-only |
| 5 | Python bindings | `python/src/lib.rs` | Add new `.str` methods; keep `.arr/.obj` unchanged |
| 6 | Update Python type stubs | `python/arbors/_arbors.pyi` | Mirror new methods |
| 7 | Unit tests per op + unicode | `crates/arbors-query/tests/` | Include byte/char distinctions |
| 8 | Integration tests | `crates/arbors/tests/integration/` + `python/tests/` | `.str` ops work in pipelines |

**Tests:**

| Test Category | Command | Expected Result |
|--------------|---------|-----------------|
| Unit: ops | `cargo nextest run -p arbors-query str_` | All new string ops work |
| Unit: unicode/bytes | `cargo nextest run -p arbors-query str_unicode` | char vs byte behavior correct |
| Integration | `cargo nextest run -p arbors str_ops` | String ops in pipelines |
| Python | `just python-test -- -k test_str_ops` | Python string methods work |

**Checkpoint:**

- [ ] All planned string ops exist as Expr variants + Rust methods directly on Expr + Python bindings
- [ ] All evaluators implement consistent Missing/Null behavior (no surprises in filters)
- [ ] `len_bytes` vs `len` behavior is tested and documented
- [ ] `extract_all` uses regex cache and never compiles per-row
- [ ] Optional: vectorized `regex_match(literal)` kernel exists (schemaful fast path)
- [ ] All targeted unit + integration + Python tests pass

---

## Component 2: DataFrame-style Operations Parity

### 2.1 Operation Categorization

#### 2.1.1 Already Implemented

| Polars Operation | Arbors Equivalent | Notes |
|------------------|-------------------|-------|
| `filter()` | `filter()` | Full parity |
| `select()` | `select()` | Full parity |
| `head()` | `head()` | Full parity |
| `tail()` | `tail()` | Full parity |
| `sort()` | `sort_by()` | Full parity |
| `unique()` | `unique_by()` | Full parity |
| `sample()` | `sample()` | Full parity |
| `slice()` | `take()` | Via index list |
| `count()` | `len()` | Full parity |
| `group_by()` | `group_by()` | Full parity |
| `to_arrow()` | `to_arrow()` | Full parity |
| `explode()` | `explode()` | Full parity |

#### 2.1.2 Should Implement (Priority Order)

| Operation | Priority | Description | Arbors Adaptation |
|-----------|----------|-------------|-------------------|
| `with_columns()` | **HIGH** | Add/modify columns | `add_fields()` extended |
| `rename()` | **HIGH** | Rename fields | Tree-level operation |
| `drop()` | **HIGH** | Remove fields | Tree-level operation |
| `reverse()` | **HIGH** | Reverse order | Simple operation |
| `join()` | **MEDIUM** | Combine arbors | `nest()` is the JSON-native approach |
| `concat()` | **MEDIUM** | Vertical concatenation | `append()` exists, add static method |
| `fill_null()` | **MEDIUM** | Replace nulls | Expression-level exists |
| `drop_nulls()` | **MEDIUM** | Filter out nulls | Filter expression |
| `top_k()` / `bottom_k()` | **MEDIUM** | Efficient partial sorts | Heap-based selection |
| `null_count()` | **LOW** | Diagnostic operation | Aggregation |
| `pivot()` | **LOW** | Reshape wide to long | Limited applicability |
| `melt()/unpivot()` | **LOW** | Reshape long to wide | Limited applicability |
| `partition_by()` | **LOW** | Split by groups | Iterator-based |
| `rolling()` | **LOW** | Window functions | Complex, defer |

#### 2.1.3 Skip (Not Applicable)

| Operation | Reason |
|-----------|--------|
| `hstack()` | Column-oriented, not applicable to hierarchical data |
| `transpose()` | Assumes rectangular data |
| `corr()` | Statistical, not JSON-native |
| `write_csv()` | Flattening required, low priority |
| `item()` | Single-value extraction, use `[0]` indexing |

### 2.2 High-Priority Implementations

#### 2.2.1 `rename()` - Rename Fields

```python
def rename(self, mapping: dict[str, str]) -> Arbor:
    """Rename fields in all trees.

    Args:
        mapping: Dict of old_name -> new_name

    Returns:
        New Arbor with renamed fields

    Example:
        >>> renamed = arbor.rename({"user_name": "name", "user_age": "age"})
    """
```

```rust
impl Arbor {
    pub fn rename(&self, mapping: &[(&str, &str)]) -> Result<Self, PipelineError> {
        let exprs: Vec<Expr> = self.fields()
            .map(|field| {
                let new_name = mapping.iter()
                    .find(|(old, _)| *old == field)
                    .map(|(_, new)| *new)
                    .unwrap_or(field);
                path(field).alias(new_name)
            })
            .collect();
        self.select(&exprs)
    }
}
```

#### 2.2.2 `drop()` - Remove Fields

```python
def drop(self, fields: str | list[str]) -> Arbor:
    """Remove specified fields from all trees.

    Args:
        fields: Field name(s) to remove

    Returns:
        New Arbor without the specified fields

    Example:
        >>> cleaned = arbor.drop(["password", "internal_id"])
    """
```

#### 2.2.3 `reverse()` - Reverse Order

```python
def reverse(self) -> Arbor:
    """Reverse the order of trees.

    Returns:
        New Arbor with trees in reverse order
    """
```

#### 2.2.4 `concat()` - Static Concatenation

```python
@staticmethod
def concat(arbors: list[Arbor]) -> Arbor:
    """Concatenate multiple arbors vertically.

    Args:
        arbors: List of arbors to concatenate

    Returns:
        New Arbor containing all trees from all input arbors

    Example:
        >>> combined = Arbor.concat([arbor1, arbor2, arbor3])
    """
```

#### 2.2.5 `fill_null()` at Arbor Level

```python
def fill_null(
    self,
    value: Any = None,
    *,
    field: str | None = None,
    strategy: Literal["value", "forward", "backward"] = "value",
) -> Arbor:
    """Fill null values in trees.

    Args:
        value: Value to use for filling (when strategy="value")
        field: Specific field to fill (None = all fields)
        strategy: Filling strategy
    """
```

### 2.3 Medium-Priority Implementations

#### 2.3.1 `top_k()` / `bottom_k()`

```python
def top_k(self, k: int, by: Expr | str) -> Arbor:
    """Get top k trees by expression value.

    More efficient than sort_by().head() for large arbors
    as it uses heap-based selection.
    """

def bottom_k(self, k: int, by: Expr | str) -> Arbor:
    """Get bottom k trees by expression value."""
```

### 2.4 DataFrame Operations (Implementation Plan)

**Goal:** Add DataFrame-style operations for arbors (**codebase-native**), avoiding redundant work and aligning with Arbors’ execution model:

- **Handle methods are eager by default** (materialize/execute).
- The **plan chain is lazy** (build `LogicalPlan` nodes; execute on iteration/collect).
- Prefer **sugar over new primitives** when the planner already optimizes (e.g. sort+head → TopK).

#### 2.4.0 Reality check (what already exists today)

- **TopK exists in the planner**: `Sort + Head` is fused into `LogicalPlan::TopK` (heap-based O(n log k)). No new “TopK plan variant” is required; it’s already there.
- **Concat exists**, but `Arbor::concat(&other)` currently **materializes the RHS** and delegates to `append` (v1.5 semantics; true lazy concat would require binary-node support).
- **Reverse exists at the storage layer** (e.g., `InMemoryArbor::reverse()`), but there is **no handle-level `Arbor::reverse()` view op** yet.

#### 2.4.1 API surface (proposal; minimal churn)

**Rename / drop_fields**

- Add as handle methods with eager semantics by default.
- Provide plan-chain variants (lazy) via `ArborPlan` methods.
- Implementation strategy depends on schema availability:
  - If schema/top-level field list is known: implement as `Select` rewrite (fast, avoids per-tree scanning).
  - If schema is unknown: either (a) require schema/inference first, or (b) materialize and rewrite tree roots (slower). Decide per product preference; v1 recommendation: **require schema** for DataFrame-style column ops.

**Reverse**

- Add `Arbor::reverse()` as a **view op** (lazy plan node), implemented as index reversal (no materialization).

**Concat**

- Add `Arbor::concat_all(arbors: &[Arbor]) -> Result<Arbor>` as an eager convenience that materializes inputs and uses `InMemoryArbor::try_concat`.
- Keep existing `concat(&other)` semantics (RHS materialized) unless/until planner supports binary nodes.

**top_k / bottom_k**

- Add handle convenience methods only (optional):
  - `top_k(k, by)` := `sort_by_desc(by).head(k)` (planner fuses to TopK when adjacent)
  - `bottom_k(k, by)` := `sort_by(by).head(k)`
- No new planner work needed; this is API sugar.

| Step | Task | Files | Notes |
|------|------|-------|-------|
| 1 | Add `rename()` (handle + plan) | `crates/arbors/src/handle/transform.rs` + `crates/arbors/src/plan.rs` | Prefer schema-driven Select rewrite |
| 2 | Add `drop_fields()` (handle + plan) | `crates/arbors/src/handle/transform.rs` + `crates/arbors/src/plan.rs` | Prefer schema-driven Select rewrite |
| 3 | Add `fill_null()` (handle + plan) | `crates/arbors/src/handle/transform.rs` + planner | Define scope: top-level only vs deep walk (v1: top-level fields) |
| 4 | Add `reverse()` view op | `crates/arbors/src/handle/slice.rs` + planner | New `LogicalPlan::Reverse` that flips indices |
| 5 | Add `concat_all()` eager convenience | `crates/arbors/src/handle/mutation.rs` (or `handle/mod.rs`) | Materialize inputs; call `InMemoryArbor::try_concat` |
| 6 | Optional: add `top_k()/bottom_k()` sugar | `crates/arbors/src/handle/sort.rs` | Implement as sort + head; rely on existing TopK fusion |
| 7 | Python bindings + stubs | `python/src/lib.rs` + `python/arbors/_arbors.pyi` | Mirror Rust surface |
| 8 | Unit + integration tests | `crates/arbors/tests/integration/` + `python/tests/` | Verify eager + plan-chain behavior |

**Tests:**

| Test Category | Command | Expected Result |
|--------------|---------|-----------------|
| Unit: rename | `cargo nextest run -p arbors rename` | Renames columns (schema-driven) |
| Unit: drop_fields | `cargo nextest run -p arbors drop_fields` | Drops columns (schema-driven) |
| Unit: reverse | `cargo nextest run -p arbors reverse` | Reverse view op works (no materialization) |
| Unit: concat_all | `cargo nextest run -p arbors concat_all` | Concatenates multiple arbors eagerly |
| Unit: fill_null | `cargo nextest run -p arbors fill_null` | Fill semantics correct |
| Unit: top_k fusion | `cargo nextest run -p arbors topk_fusion` | `sort_by(...).head(k)` fuses (no full sort) |
| Integration | `cargo nextest run -p arbors dataframe_ops` | Combined operations |
| Python | `just python-test -- -k test_dataframe` | Python parity |

**Checkpoint:**

- [ ] `rename()` and `drop_fields()` exist on handle and plan chain, and do not require scanning all trees in the common case (schema-driven)
- [ ] `reverse()` exists as a lazy view op (plan node) and is cheap
- [ ] `concat_all()` exists as an eager convenience (materializes inputs)
- [ ] `fill_null()` semantics are specified and implemented (v1: top-level fields)
- [ ] No redundant TopK work: planner fusion is used; optional `top_k()/bottom_k()` are sugar only
- [ ] Python methods mirror Rust API
- [ ] All targeted unit + integration + Python tests pass

---

## Component 3: Expression Operations Parity

### 3.1 Expression Categorization

#### 3.1.1 Already Implemented

| Category | Operations |
|----------|------------|
| **Arithmetic** | add, sub, mul, div, neg, abs, round, floor, ceil, modulo, pow, clip |
| **Comparison** | eq, ne, lt, le, gt, ge, is_in, is_between |
| **Logical** | and, or, not |
| **String** | str_contains, starts_with, ends_with, to_lower, to_upper, trim, substring, replace, split, join, regex_match, regex_extract, regex_replace, str_len |
| **Null** | is_null, is_not_null, coalesce, if_null, null_to_default, default_if_missing |
| **Type** | cast, type_of, is_bool, is_int, is_float, is_numeric, is_string, is_array, is_object |
| **Aggregation** | sum, count, mean, min, max, any, all, first, last, min_by, max_by |
| **Array** | get, slice, array_contains, unique, sort, reverse, concat, map, filter_with, flatten |
| **Object** | field, keys, values, rename, with_field, without, to_entries, from_entries |
| **Temporal** | year, month, day, hour, minute, second, weekday, week, quarter, epoch, date_trunc, date_add, date_diff |
| **Conditional** | when/then/otherwise, case |

#### 3.1.2 Should Implement (Priority Order)

| Category | Operation | Priority | Description |
|----------|-----------|----------|-------------|
| **String** | `title()` | HIGH | Title case conversion |
| **String** | `capitalize()` | HIGH | First char uppercase |
| **String** | `pad_start/pad_end` | MEDIUM | String padding |
| **Numeric** | `sqrt()` | HIGH | Square root |
| **Numeric** | `log()` / `ln()` | MEDIUM | Logarithms |
| **Numeric** | `sign()` | MEDIUM | Sign of number |
| **List** | `head()` / `tail()` | HIGH | First/last n elements |
| **List** | `arg_min()` / `arg_max()` | MEDIUM | Index of min/max |
| **List** | `sample()` | MEDIUM | Random sample from list |
| **Statistical** | `median()` | HIGH | Median value |
| **Statistical** | `std()` / `var()` | MEDIUM | Standard deviation, variance |
| **Statistical** | `quantile()` | MEDIUM | Percentile values |
| **Cumulative** | `cum_sum` | MEDIUM | Cumulative sum |

### 3.2 Namespace Accessor Pattern

**UPDATE:** The accessor pattern has been removed (see Section 3.7). Methods are now directly on `Expr`. The `.dt` accessor remains for temporal operations.

```python
path("name").to_lower()           # String operations (direct method)
path("items").head(5)             # Array operations (direct method)
path("user").field("id")          # Object operations (direct method)
path("created").dt.year()         # Temporal operations (dt accessor remains)
```

### 3.3 Array Operations (Implementation Plan)

**Goal:** Complete array operations at the expression level.

**Important:**

- Arrays are the correct Arbors term.
- **Accessor pattern removed** - methods are directly on `Expr` (see Section 3.7).
- Prefer minimal churn: the codebase already has array Expr ops (`get`, `slice`, `arr_contains`, `unique`, `sort`, `reverse`, `concat`, `map`, `filter_with`, `flatten`).
- Constructors are `array([...])` and `object([...])` (not "struct/list").

**API examples:**

```python
path("items").get(0)
path("items").slice(0, 5)
path("roles").arr_contains("admin")
path("scores").sort(descending=True)
path("items").reverse()
path("items").arr_len()
path("items").head(3)     # sugar for slice(0, 3)
path("items").tail(3)     # sugar for slice(-3, None)
```

```rust
use arbors_expr::{path, lit};

let first = path("items").get(lit(0));
let top3 = path("items").head(3);
```

| Step | Task | Files | Notes |
|------|------|-------|-------|
| 1 | Add array methods directly to `Expr` (Rust) | `crates/arbors-expr/src/expr.rs` | Accessor pattern removed - methods are direct on Expr |
| 2 | Implement array methods (Rust) | `crates/arbors-expr/src/expr.rs` | Route to existing Expr methods; keep allocation-free where possible |
| 3 | Ensure array methods exist in Python | `python/src/lib.rs` | Add methods directly to Expr (accessor pattern removed) |
| 4 | Update Python stubs | `python/arbors/_arbors.pyi` | Add methods to Expr class |
| 5 | Add/adjust evaluators only if needed | `crates/arbors-query/src/eval.rs` | Prefer compiling sugar to existing variants (e.g. head/tail → slice) |
| 6 | Unit tests for array methods | `crates/arbors-query/tests/` + `python/tests/` | Include Missing/Null behavior |
| 7 | Integration tests | `crates/arbors/tests/integration/` | Array ops in pipelines |

### 3.4 Object Operations (Implementation Plan)

**Goal:** Complete object operations at the expression level.

**Important:**

- Objects are the correct Arbors term.
- **Accessor pattern removed** - methods are directly on `Expr` (see Section 3.7).
- The codebase already has object Expr ops (`field`, `keys`, `values`, `rename`, `with_field`, `without`, `to_entries`, `from_entries`).
- Constructors are `object([...])` and `array([...])`.

**API examples:**

```python
path("user").field("id")
path("data").rename("old", "new")
path("user").with_field("active", True)
path("user").without("password")
path("user").keys()
path("user").values()
```

```rust
use arbors_expr::{path, lit};

let id = path("user").field("id");
let renamed = path("data").rename("old", "new");
let with = path("user").with_field("active", lit(true));
```

| Step | Task | Files | Notes |
|------|------|-------|-------|
| 1 | Add object methods directly to `Expr` (Rust) | `crates/arbors-expr/src/expr.rs` | Accessor pattern removed - methods are direct on Expr |
| 2 | Implement object methods (Rust) | `crates/arbors-expr/src/expr.rs` | Route to existing Expr operations |
| 3 | Ensure object methods exist in Python | `python/src/lib.rs` | Add methods directly to Expr (accessor pattern removed) |
| 4 | Update Python stubs | `python/arbors/_arbors.pyi` | Add methods to Expr class |
| 5 | Add/adjust evaluators only if needed | `crates/arbors-query/src/eval.rs` | Ensure Missing/Null semantics consistent |
| 6 | Unit tests | `crates/arbors-query/tests/` + `python/tests/` | field/rename/with_field/without/keys/values/to_entries/from_entries |
| 7 | Integration tests | `crates/arbors/tests/integration/` | Object ops in pipelines |

### 3.5 Statistical & Numeric Operations (Implementation Plan)

**Goal:** Add statistical and numeric **expression** operations that are:

- **Predictable**: explicit Missing/Null/domain semantics
- **Consistent** with existing aggregation helpers (e.g. `mean([]) = null`)
- **Codebase-native**: fits `Expr` + `eval_expr` + optional vectorized fast paths

**Semantics (proposal; JSON-friendly, filter-friendly)**

- Missing input ⇒ Missing output
- Null input ⇒ Null output
- Domain errors ⇒ null (not panic, not per-row errors)
- For list aggregations (median/quantile/std/var): ignore non-numeric/null/missing elements; if no numeric values ⇒ null

| Step | Task | Files | Notes |
|------|------|-------|-------|
| 1 | Add new Expr variants + builders | `crates/arbors-expr/src/expr.rs` | `sqrt`, `sign`, `ln/log10/log`, `median`, `quantile`, `var`, `std` |
| 2 | Implement evaluators | `crates/arbors-query/src/eval.rs` | Enforce Missing/Null/domain rules; reuse numeric collectors |
| 3 | Optional: vectorize unary numeric ops | `crates/arbors-query/src/vectorized.rs` | Add `sqrt/sign/ln/log10` kernels for schemaful fast path |
| 4 | Python bindings + stubs | `python/src/lib.rs` + `python/arbors/_arbors.pyi` | Mirror the new API surface |
| 5 | Unit + edge tests | `crates/arbors-query/tests/` + `python/tests/` | Domain errors, empty inputs, q bounds |

### 3.6 Implementation Notes & Decisions

#### 3.6.1 Semantic Decisions (Resolved)

**Accessor pattern**: **REMOVED** - Methods are now directly on `Expr`. Only `.dt()` accessor remains for temporal operations (see Section 3.7).

**`.head(n)` / `.tail(n)` semantics** (array operations):
- Non-array input → `null` (lenient, not TypeMismatch)
- `Missing` → `Missing`, `Null` → `Null`
- `n < 0` → treat as 0 (empty array result)

**Domain errors for numeric ops**: Return `null` (filter-friendly):
- `sqrt(-1)` → `null`
- `ln(0)` → `null`
- `log10(-5)` → `null`

**Booleans in list stats**: Do NOT treat as 0/1. Skip them like other non-numeric values.

**Quantile/median formula and output type**:
- Use **linear interpolation** (NumPy `method='linear'`, Polars default).
- Canonical formula: given sorted numeric values `v[0..n]` and quantile `q`:
  - `index = q * (n - 1)`
  - `lower = floor(index)`, `upper = ceil(index)`, `frac = index - lower`
  - `result = v[lower] * (1 - frac) + v[upper] * frac`
- **Output type is always `Float64`**, even for integer-only inputs. This prevents surprising type changes based on data.
- Edge cases:
  - Empty list (no numeric values) → `null`
  - Single element → that element (as Float64) for any valid quantile
  - `q < 0` or `q > 1` → `null` (domain error)
- `median` is sugar for `quantile(0.5)`.

**NaN handling in list stats**: Treat `NaN` like other non-numeric values—**skip it**. Do not propagate `NaN` through the result. Rationale: JSON doesn't have native NaN; when it appears (via float parsing edge cases), treating it as "not a usable number" is consistent with the lenient philosophy.

**Statistical ops are list aggregations**: `median(path("scores"))` operates on array values within a single tree, NOT across rows/trees. Dataset aggregations use `aggregate()`.

**`.sample(n)` semantics** (array operations):
- **Without replacement** (each element selected at most once)
- **Preserve original order** (sampled elements appear in their original array order)
- **Optional seed parameter** for deterministic results: `.sample(n, seed=42)`
- If `n >= array.len()`, return the full array (no error)
- Non-array input → `null` (lenient)

**`cum_sum` semantics**:
- Operates on numeric arrays only; non-array input → `null`
- For each position, output is cumulative sum of all preceding numeric values
- **Non-numeric/null/missing elements**: skip them (do not contribute to sum), but **emit `null` at that position**
- Example: `[1, "x", 3, null, 5]` → `[1, null, 4, null, 9]`
- Rationale: preserves array length and position correspondence while clearly marking non-numeric positions

**Lenient non-array/non-object behavior (design note)**:
- Returning `null` for type mismatches (e.g., `.head()` on a string) is filter-friendly but can mask bugs
- **Future consideration**: optional "strict mode" or separate strict methods if users need it
- **v1 decision**: lenient only, consistent with existing string and temporal behavior

#### 3.6.2 Identified Holes (Additional Work Required)

| Hole | Description | Estimate |
|------|-------------|----------|
| **ArrayLen missing** | No `Expr::ArrayLen` variant exists. Must add expr variant + evaluator. | ~50 lines |
| **Unary numeric ops missing** | `Sqrt`, `Sign`, `Ln`, `Log10` don't exist as Expr variants. Each needs expr + evaluator + binding. | ~30 lines each |
| **List stats complexity** | `median/quantile/std/var` are non-trivial: heterogeneous array extraction, numerical stability (Welford's for variance), sorting for quantile. | ~100 lines each |
| **Flatten verification** | Verify `Expr::Flatten` exists and is evaluatable; plan assumes it does. | Audit only |

#### 3.6.3 Per-Operation Checklist (Prevent Drift)

**CRITICAL**: Methods must be added to both Rust and Python. Use this checklist for EVERY new operation:

| Step | File | What to verify |
|------|------|----------------|
| 1 | `crates/arbors-expr/src/expr.rs` | Expr variant exists (if new) |
| 2 | `crates/arbors-expr/src/expr.rs` | Builder method on `Expr` (e.g., `.sqrt()`) |
| 3 | `crates/arbors-query/src/eval.rs` | Evaluator match arm implemented |
| 4 | `python/src/lib.rs` | PyO3 binding for `Expr` method |
| 5 | `python/arbors/_arbors.pyi` | Stub signature matches Rust |
| 6 | `crates/arbors-expr/src/infer.rs` | Type inference rule (if applicable) |
| 7 | `crates/arbors-expr/src/analysis.rs` | Add to `free_vars`, `path_roots`, etc. (if new variant) |
| 8 | `crates/arbors-expr/src/rewrite.rs` | Add to `substitute`, `rewrite_binding_paths` (if new variant) |

**Note:** Accessor pattern has been removed (see Section 3.7). Methods are directly on `Expr` in both Rust and Python.

#### 3.6.4 Recommended Implementation Order

1. **Array operations** - Add methods directly to Expr for existing ops (get, slice, arr_contains, sort, reverse, concat, filter_with, flatten, unique)
2. **ArrayLen** - New Expr variant + evaluator (needed for `.arr_len()`)
3. **head/tail sugar** - Implement as slice wrappers
4. **Object operations** - Add methods directly to Expr for existing ops (field, keys, values, rename, with_field, without, to_entries, from_entries)
5. **Unary numeric ops** - sqrt, sign, ln, log10 (one at a time, with tests)
6. **List stats** - median first (simplest), then std/var (need Welford's), then quantile (most complex)

**Rationale**: Foundation ops first (ArrayLen), then array/object operations, then numeric/stats (higher complexity). Note: Accessor pattern has been removed (see Section 3.7).

### 3.7 Addendum: Accessor Pattern Removal (COMPLETED)

**Status:** ✅ **COMPLETED** - The accessor pattern has been removed from both Rust and Python APIs.

**What Changed:**
- Removed `.str()`, `.arr()`, `.obj()` accessor structs from Rust (`StringAccessor`, `ArrayAccessor`, `ObjectAccessor`)
- Removed `.str`, `.arr`, `.obj` accessor properties from Python (`ExprStrAccessor`, `ExprArrayAccessor`, `ExprObjectAccessor`)
- Added all accessor-only methods directly to `Expr` in both Rust and Python
- Updated all call sites to use direct methods instead of accessors

**Current API Pattern:**
- **Before:** `path("name").str().match_(...)` or `path("name").str.match(...)`
- **After:** `path("name").match_(...)` or `path("name").str_match(...)` (Python)

**Method Naming:**
- Methods that conflicted were prefixed: `str_contains`, `arr_contains`, `str_len`, `arr_len`
- All other methods kept their original names: `head`, `tail`, `equals`, `field`, etc.

**Impact on This Plan:**
- Sections 3.2-3.4 describing accessor implementation are **obsolete** (accessors no longer exist)
- Component 1 references to `.str.match()` should be updated to direct method calls
- Component 5 references to `.emb` accessor pattern should follow the new direct-method approach
- The checklist in Section 3.6.3 is no longer applicable (no accessor structs to maintain)

**Reference:** See `/Users/kocienda/.claude/plans/synchronous-greeting-newell.md` for the complete removal plan and implementation details.

---

## Component 4: ArborPath Foundation

**This component must be implemented BEFORE Components 5-6.** ArborPath is the foundational type for single-value path navigation throughout Arbors.

**Context:** Components 4-6 provide tree-native operations that go beyond what Polars can offer. While Components 1-3 achieve parity with DataFrame libraries, Components 4-6 provide capabilities that are impossible in flat tabular systems. Inspired by [jq](https://jqlang.org/manual/), [Graphtage](https://github.com/trailofbits/graphtage), [Huet's Zipper](https://en.wikipedia.org/wiki/Zipper_(data_structure)), and RFC standards for JSON operations.

### 4.1 Problem: Four Duplicate PathSegment Types

The codebase currently has four separate `PathSegment` types that represent similar concepts:

| Location | Type | Index Type | Purpose |
|----------|------|------------|---------|
| `arbors-schema/navigation.rs` | `PathSegment { Field(String), Index(usize) }` | `usize` | Schema navigation |
| `arbors-io/builder.rs` | `PathSegment { Field(String), Index(usize) }` | `usize` | Parse context tracking |
| `arbors-io/tree_ops.rs` | `PathSegment { Field(String), Index(i64) }` | `i64` | Tree operations |
| `arbors-expr/path.rs` | `PathSegment { Field, Index(i32), Wildcard, Filter, Current }` | `i32` | Expression paths (multi-value) |

The first three are semantically identical—they represent **single-value navigation paths**. The fourth (`PathExpr`) is fundamentally different: it's for expressions that can match multiple values via wildcards and filters.

Additionally, `ValidationError.data_path` and `SchemaDiff` use `String` for path reporting, losing type safety.

### 4.2 Solution: Unified ArborPath Type

`ArborPath` and `ArborPathSegment` unify all single-value path representations across the codebase.

### 4.3 Crate Placement: `arbors-types`

**Decision:** ArborPath lives in `arbors-types`.

Rationale:
1. `arbors-types` is the foundation crate with minimal dependencies
2. All crates that need ArborPath already depend on `arbors-types`
3. ArborPath is a fundamental data structure, not an expression or schema concept
4. Placing it here avoids circular dependencies
5. No new dependencies required (only `thiserror` and `serde` which are already present)

### 4.4 Index Type: `i32`

**Decision:** Use `i32` for indices.

Rationale:
- Supports negative indices semantically (`-1` = last, `-2` = second-to-last)
- Matches `PathExpr::Index(i32)` for easy conversion
- 32 bits is sufficient (no JSON array has 2 billion elements)
- Resolution of negative to concrete index happens at runtime, not in the path type

### 4.5 Core Types

```rust
// In arbors-types/src/path.rs

/// A single segment in an ArborPath.
///
/// ArborPathSegment represents one step in navigating a tree structure.
/// Unlike expression path segments, these cannot contain wildcards or filters.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ArborPathSegment {
    /// Field access by name (e.g., "user" in "user.name")
    Field(String),

    /// Array index access (e.g., 0 in "items[0]" or -1 in "items[-1]")
    ///
    /// Negative indices count from the end:
    /// - `-1` = last element
    /// - `-2` = second-to-last element
    ///
    /// Resolution to concrete index happens at navigation time.
    Index(i32),
}

/// A concrete path through a JSON-like tree structure.
///
/// ArborPath represents a single-value navigation path that always resolves
/// to exactly zero or one node. This is distinct from expression paths
/// (`PathExpr`) which can contain wildcards and filters that match multiple values.
///
/// # Type Safety
///
/// ArborPath is guaranteed at the type level to not contain:
/// - Wildcards (`[*]`)
/// - Filters (`[?@.active]`)
/// - Relative references (`@`)
///
/// # Examples
///
/// ```
/// use arbors_types::ArborPath;
///
/// let path = ArborPath::parse("users[0].name").unwrap();
/// assert_eq!(path.len(), 3);
///
/// let path = ArborPath::parse("items[-1]").unwrap(); // Last element
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default)]
pub struct ArborPath {
    segments: Vec<ArborPathSegment>,
}
```

### 4.6 Error Type

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArborPathError {
    pub position: usize,
    pub message: String,
    pub kind: ArborPathErrorKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArborPathErrorKind {
    ParseError,
    WildcardNotAllowed,
    FilterNotAllowed,
    RelativeNotAllowed,
    IndexOverflow,
    EmptySegment,
    NegativeIndexInPointer,   // to_json_pointer() with negative index
    InvalidAppendToken,        // from_json_pointer() with "-" token
    InvalidControlChar,        // Unescaped control character in quoted string
    InvalidSurrogate,          // Unpaired surrogate in \uXXXX escape
}
```

### 4.7 Path String Grammar

```text
path        = "" | segment ("." segment)*  # Empty string is root
segment     = identifier | bracket
identifier  = [a-zA-Z_$][a-zA-Z0-9_$-]*    # Simple field name
bracket     = "[" (index | quoted) "]"
index       = "-"? [0-9]+                   # Array index (negative allowed)
quoted      = '"' string_char* '"'          # Quoted field name (double quotes only)
string_char = escape | safe_char
safe_char   = [^"\\\x00-\x1F]              # Any char except ", \, and control chars
escape      = "\\" escape_char
escape_char = '"' | '\' | 'n' | 'r' | 't' | 'u' hex{4}
hex         = [0-9a-fA-F]
```

**Root path:** The empty string `""` is the canonical representation of the root path (zero segments). `ArborPath::parse("")` succeeds and returns an empty path. `ArborPath::empty().to_string()` returns `""`.

**Escape sequences (inside double quotes):**
| Escape | Meaning |
|--------|---------|
| `\"` | Literal double quote |
| `\\` | Literal backslash |
| `\n` | Newline (U+000A) |
| `\r` | Carriage return (U+000D) |
| `\t` | Tab (U+0009) |
| `\uXXXX` | Unicode codepoint (4 hex digits) |

**Control characters (U+0000..U+001F):** Must be escaped. Unescaped control characters in quoted strings are a parse error. This matches JSON string rules.

**Surrogate pairs:** `\uXXXX` sequences are decoded to Unicode scalar values. For characters outside BMP (> U+FFFF), use surrogate pairs: `\uD83D\uDE00` decodes to U+1F600 (😀). Unpaired surrogates are a parse error (not valid Unicode).

**Design decision:** Single quotes are NOT supported. Double quotes are the canonical quoting style. This simplifies parsing and matches JSON string syntax.

**Examples:**
| Path String | Segments |
|-------------|----------|
| `user.name` | `[Field("user"), Field("name")]` |
| `items[0].price` | `[Field("items"), Index(0), Field("price")]` |
| `items[-1]` | `[Field("items"), Index(-1)]` |
| `data["field.with.dots"]` | `[Field("data"), Field("field.with.dots")]` |
| `obj["a\"b"]` | `[Field("obj"), Field("a\"b")]` |
| `data["line1\\nline2"]` | `[Field("data"), Field("line1\nline2")]` |

**`to_string()` behavior:**
- Fields matching `^[a-zA-Z_$][a-zA-Z0-9_$-]*$` → dot notation: `.name`
- All other fields → quoted bracket notation with proper escaping: `["weird\"key"]`
- First segment omits leading dot
- Characters requiring escaping: `"`, `\`, control characters (U+0000..U+001F)

### 4.8 Core API

```rust
impl ArborPath {
    // === Construction ===
    pub const fn empty() -> Self;
    pub fn field(name: impl Into<String>) -> Self;
    pub fn index(idx: i32) -> Self;
    pub fn parse(s: &str) -> Result<Self, ArborPathError>;

    // === JSON Pointer (RFC 6901) ===
    // Note: Conversions are fallible because ArborPath allows negative indices,
    // which have no meaning in RFC 6901/6902.
    pub fn from_json_pointer(s: &str) -> Result<Self, ArborPathError>;
    pub fn to_json_pointer(&self) -> Result<String, ArborPathError>;

    // === URI Fragment (JSON Schema) ===
    pub fn from_uri_fragment(s: &str) -> Result<Self, ArborPathError>;
    pub fn to_uri_fragment(&self) -> Result<String, ArborPathError>;

    // === Accessors ===
    pub fn segments(&self) -> &[ArborPathSegment];
    pub fn len(&self) -> usize;
    pub fn is_empty(&self) -> bool;
    pub fn first(&self) -> Option<&ArborPathSegment>;
    pub fn last(&self) -> Option<&ArborPathSegment>;

    // === Modification ===
    pub fn push(&mut self, segment: ArborPathSegment);
    pub fn push_field(&mut self, name: impl Into<String>);
    pub fn push_index(&mut self, idx: i32);
    pub fn pop(&mut self) -> Option<ArborPathSegment>;
    pub fn split_last(&self) -> Option<(ArborPath, &ArborPathSegment)>;

    // === Builder pattern ===
    #[must_use]
    pub fn with(self, segment: ArborPathSegment) -> Self;
    #[must_use]
    pub fn with_field(self, name: impl Into<String>) -> Self;
    #[must_use]
    pub fn with_index(self, idx: i32) -> Self;
}
```

### 4.9 JSON Pointer Support (RFC 6901)

ArborPath supports bidirectional conversion with RFC 6901 JSON Pointer format for interoperability.

**JSON Pointer vs URI Fragment Identifier:**

| Format | Example | Used In |
|--------|---------|---------|
| JSON Pointer | `/users/0/name` | RFC 6902 JSON Patch, error messages |
| URI Fragment | `#/users/0/name` | JSON Schema `$ref`, `$id` |

**API design:** Separate methods for each format, no guessing. Conversions are **fallible** because ArborPath allows negative indices which RFC 6901 does not:

```rust
impl ArborPath {
    /// Parse RFC 6901 JSON Pointer (must start with "/" or be empty)
    /// Rejects: negative indices, "-" token
    pub fn from_json_pointer(s: &str) -> Result<Self, ArborPathError>;

    /// Parse URI fragment identifier (must start with "#/" or be "#")
    /// Rejects: negative indices, "-" token
    pub fn from_uri_fragment(s: &str) -> Result<Self, ArborPathError>;

    /// Generate RFC 6901 JSON Pointer (starts with "/" or is empty for root)
    /// Fails if path contains negative indices
    pub fn to_json_pointer(&self) -> Result<String, ArborPathError>;

    /// Generate URI fragment identifier (starts with "#/")
    /// Fails if path contains negative indices
    pub fn to_uri_fragment(&self) -> Result<String, ArborPathError>;
}
```

**Negative index handling:**
- `ArborPath` allows negative indices globally (e.g., `items[-1]` for last element)
- RFC 6901/6902 do NOT define negative indices
- **`to_json_pointer()` and `to_uri_fragment()` return `Err` if path contains negative indices**
- Use `path.to_string()` (Arbors format) when negative indices are present

**RFC 6902 "-" token (append-to-array):**
- JSON Patch uses `/.../array/-` to mean "append to end of array"
- **ArborPath does NOT support the `-` token**
- `from_json_pointer("/items/-")` returns `Err(ArborPathError { kind: InvalidAppendToken, ... })`
- Patch append semantics belong in the patch layer (Component 6), not in general path representation

**Examples:**

```rust
// JSON Pointer → ArborPath
let path = ArborPath::from_json_pointer("/users/0/name").unwrap();
assert_eq!(path.to_string(), "users[0].name");

// ArborPath → JSON Pointer (non-negative indices only)
let path = ArborPath::parse("users[0].name").unwrap();
assert_eq!(path.to_json_pointer().unwrap(), "/users/0/name");

// Negative indices FAIL pointer conversion
let path = ArborPath::parse("items[-1]").unwrap();
assert!(path.to_json_pointer().is_err()); // Use path.to_string() instead

// "-" token is rejected
assert!(ArborPath::from_json_pointer("/items/-").is_err());

// URI Fragment (for JSON Schema)
let path = ArborPath::from_uri_fragment("#/definitions/User").unwrap();
assert_eq!(path.to_uri_fragment().unwrap(), "#/definitions/User");

// Escaping: ~0 = ~, ~1 = /
let path = ArborPath::from_json_pointer("/a~1b/c~0d").unwrap();
// Represents fields "a/b" and "c~d"

// Root pointer
let empty = ArborPath::from_json_pointer("").unwrap();
assert!(empty.is_empty());
```

**ValidationError display:** `ValidationError.data_path` is stored as `ArborPath`. Display uses the Arbors-style string by default (`path.to_string()`). For tools that expect RFC 6901 format, use `.to_json_pointer()` (which will always succeed for validation errors since they don't contain negative indices).

This enables:
- Reading JSON Pointer format from error messages and external systems
- JSON Schema `$ref` resolution via `from_uri_fragment`
- RFC 6902 JSON Patch compatibility (Component 6)

### 4.10 PathExpr Conversions

These conversions live in `arbors-expr` (not `arbors-types`) to avoid adding a dependency.

```rust
// In arbors-expr/src/path.rs

// Fallible: rejects wildcards, filters, relative references
impl TryFrom<&PathExpr> for ArborPath {
    type Error = ArborPathError;

    fn try_from(expr: &PathExpr) -> Result<Self, Self::Error> {
        if expr.is_relative {
            return Err(ArborPathError { kind: RelativeNotAllowed, ... });
        }
        for seg in &expr.segments {
            match seg {
                PathSegment::Wildcard => return Err(...),
                PathSegment::Filter(_) => return Err(...),
                PathSegment::Current => return Err(...),
                _ => {}
            }
        }
        // Convert valid segments
        Ok(...)
    }
}

// Infallible: ArborPath is always a valid PathExpr
impl From<ArborPath> for PathExpr {
    fn from(path: ArborPath) -> Self {
        // Direct conversion of Field/Index segments
    }
}
```

### 4.11 Trait Implementations

```rust
impl fmt::Display for ArborPath { ... }  // Arbors-style: "user.name", "items[0]"
impl FromStr for ArborPath { ... }       // Calls parse()
impl IntoIterator for ArborPath { ... }
impl From<Vec<ArborPathSegment>> for ArborPath { ... }
impl serde::Serialize for ArborPath { ... }    // Serializes as string
impl serde::Deserialize for ArborPath { ... }  // Parses from string
```

### 4.12 Migration Plan

**No deprecation needed:** This is a brand new library with zero external users. All changes are clean breaks.

**Comprehensive scope:** This migration replaces ALL path abstractions in the codebase:
- 4 duplicate `PathSegment` types
- 4 `String`-based path fields (`FieldChange.path`, `TypeChange.path`, `ValidationError.data_path`, `ValidationError.schema_path`)
- 3 ad-hoc JSON Pointer helper functions
- 2 private path parsing functions

#### Phase 1: Add ArborPath to arbors-types

**Files:** `crates/arbors-types/src/path.rs` (new), `lib.rs`

- Add `ArborPath` and `ArborPathSegment` types
- Add `ArborPathError` and `ArborPathErrorKind` types
- Implement parser with quoted field support and escape sequences
- Implement JSON Pointer and URI Fragment conversions
- Implement `Display`, `FromStr`, serde, trait impls
- Export from `arbors-types::lib`

#### Phase 2: Add conversions in arbors-expr

**Files:** `crates/arbors-expr/src/path.rs`

- Add `impl TryFrom<&PathExpr> for ArborPath` (rejects wildcards/filters)
- Add `impl From<ArborPath> for PathExpr` (infallible)

#### Phase 3: Migrate arbors-schema

**Files:** `crates/arbors-schema/src/navigation.rs`, `lib.rs`

**Replace types:**
- Delete `pub enum PathSegment { Field(String), Index(usize) }`
- Replace with `pub use arbors_types::{ArborPath, ArborPathSegment};`

**Update `parse_path` function:**
- Change signature: `pub fn parse_path(path: &str) -> Result<ArborPath, ArborPathError>`
- Implementation: delegate to `ArborPath::parse(path)`

**Update `SchemaDiff` types:**
- `FieldChange.path: String` → `ArborPath`
- `TypeChange.path: String` → `ArborPath`
- Update all construction sites to use `ArborPath::parse()` or builder methods

**Update call sites:**
- All consumers of `parse_path()` now receive `ArborPath` instead of `Vec<PathSegment>`
- Schema navigation functions (`navigate_to_field`, etc.) take `&ArborPath` instead of `&[PathSegment]`

#### Phase 4: Migrate arbors-io

**Files:** `crates/arbors-io/src/builder.rs`, `tree_ops.rs`

**builder.rs:**
- Delete `enum PathSegment { Field(String), Index(usize) }`
- Replace `ParseContext.data_path: Vec<PathSegment>` → `ArborPath`
- Update push/pop operations to use `ArborPath::push_field()` / `ArborPath::push_index()`
- Update path display to use `path.to_string()` or `path.to_json_pointer()`

**tree_ops.rs:**
- Delete `enum PathSegment { Field(String), Index(i64) }`
- Delete `fn parse_path_segments(path: &str) -> Result<Vec<PathSegment>>`
- Replace with `use arbors_types::ArborPath;`
- Update `get_at_path`, `set_at_path`, etc. to accept `&ArborPath` or `&str` (parsing internally)

#### Phase 5: Migrate arbors-validate

**Files:** `crates/arbors-validate/src/error.rs`, `tree_validator.rs`

**error.rs:**
- `ValidationError.data_path: String` → `ArborPath`
- `ValidationError.schema_path: String` → `ArborPath`
- Update all `ValidationError::new()` construction sites to use `ArborPath` instead of `String`
- Update `Display` impl to use `path.to_string()` (Arbors format) or provide `.to_json_pointer()` method

**tree_validator.rs:**
- **Delete** JSON Pointer helper functions:
  - `fn escape_json_pointer(s: &str) -> String`
  - `fn append_key_to_path(path: &str, key: &str) -> String`
  - `fn append_index_to_path(path: &str, index: usize) -> String`
- Replace with `ArborPath` builder methods:
  - Use `ArborPath::empty()` for root
  - Use `path.with_field(key)` instead of `append_key_to_path`
  - Use `path.with_index(idx as i32)` instead of `append_index_to_path`
  - Use `path.to_json_pointer()` when JSON Pointer format is needed
- Update validator traversal to track `ArborPath` instead of building strings

### 4.13 Tests

- **Parsing:** valid paths, empty string (root), reject wildcards/filters, quoted fields, escape sequences, negative indices
- **Escape sequences:** `\"`, `\\`, `\n`, `\r`, `\t`, `\uXXXX`, surrogate pairs, reject unescaped control chars, reject unpaired surrogates
- **Display:** round-trip, quoted fields when needed, escape sequences, negative indices, empty path → `""`
- **JSON Pointer:**
  - `from_json_pointer`: valid paths, RFC 6901 escaping (`~0`, `~1`), empty pointer (root), **reject `-` token**
  - `to_json_pointer`: non-negative paths succeed, **negative indices fail with `NegativeIndexInPointer`**
- **URI Fragment:**
  - `from_uri_fragment`: `#/` prefix, `#` for root, **reject `-` token**
  - `to_uri_fragment`: non-negative paths succeed, **negative indices fail**
- **Conversions:** `TryFrom<PathExpr>` success/failure, `From<ArborPath> for PathExpr`
- **Serde:** serialize/deserialize round-trip
- **Builder:** `with_field`, `with_index`, chaining

### 4.14 Checkpoint

**Core ArborPath implementation:**
- [ ] `ArborPath` + `ArborPathSegment` exist in `arbors-types`
- [ ] Index type is `i32` (supports negative indices)
- [ ] Empty string `""` parses to root path; `empty().to_string()` returns `""`
- [ ] Parser handles: dot notation, bracket indices, negative indices, quoted fields with escaping
- [ ] Escape sequences: `\"`, `\\`, `\n`, `\r`, `\t`, `\uXXXX` with surrogate pair support
- [ ] Parser rejects: wildcards, filters, relative references, unescaped control chars, unpaired surrogates
- [ ] `from_json_pointer`/`from_uri_fragment`: work with RFC 6901 escaping; **reject `-` token**
- [ ] `to_json_pointer`/`to_uri_fragment`: return `Result`; **fail on negative indices**
- [ ] `TryFrom<PathExpr>` and `From<ArborPath>` conversions exist in `arbors-expr`
- [ ] Serde serialization as string works

**Migration complete:**
- [ ] All 4 duplicate `PathSegment` types replaced with `ArborPathSegment`
- [ ] `arbors-schema::parse_path()` returns `ArborPath` (not `Vec<PathSegment>`)
- [ ] `SchemaDiff::FieldChange.path` uses `ArborPath` (not `String`)
- [ ] `SchemaDiff::TypeChange.path` uses `ArborPath` (not `String`)
- [ ] `ValidationError.data_path` uses `ArborPath` (not `String`)
- [ ] `ValidationError.schema_path` uses `ArborPath` (not `String`)
- [ ] JSON Pointer helper functions removed from `tree_validator.rs` (use `ArborPath` methods instead)
- [ ] `ParseContext.data_path` in `builder.rs` uses `ArborPath`
- [ ] `parse_path_segments()` removed from `tree_ops.rs` (use `ArborPath::parse()` instead)

**Tests:**
- [ ] All ArborPath unit tests pass
- [ ] All integration tests pass with ArborPath types
- [ ] Validation errors display correctly with ArborPath
- [ ] Schema diff reports use ArborPath correctly

### 4.15 Stepwise Implementation Plan (Incremental, Check-as-you-go)

**Goal:** Implement Component 4 in small steps you can land one at a time, verifying each step before moving on.

**Rule:** Do not proceed to the next step until the “Verify” checklist for the current step is green.

#### Step 1 — Add the new type surface in `arbors-types` (no parser yet)

**Code changes:**
- Create `crates/arbors-types/src/path.rs` with:
  - `ArborPathSegment` per **4.5** (`Field(String)`, `Index(i32)`)
  - `ArborPath` per **4.5** (private `segments: Vec<ArborPathSegment>`, `Default` is empty)
  - `ArborPathError` + `ArborPathErrorKind` per **4.6** (include all listed kinds, even if unused yet)
  - `impl ArborPath` with **signatures only** per **4.8**/**4.9** (return `Err(ArborPathError { kind: ParseError, .. })` / `todo!()` as appropriate)
- Export from `crates/arbors-types/src/lib.rs`.

**Verify:**
- [ ] `cargo test -p arbors-types` compiles (tests can be empty for now).
- [ ] `cargo test -p arbors-expr` still compiles (it already depends on `arbors-types`).

#### Step 2 — Implement `Display`/`to_string()` for Arbors-style paths (including root)

**Implement exactly (from 4.7):**
- Root path is `""` (empty string); `ArborPath::empty().to_string()` returns `""`.
- Field formatting:
  - If field matches `^[a-zA-Z_$][a-zA-Z0-9_$-]*$`, use dot notation (`user.name`), with the **first segment omitting the leading dot**.
  - Otherwise, use bracket notation with **double quotes** and proper escaping: `data["weird\"key"]`.
- Escaping rules inside quotes (from **4.7**):
  - Must escape: `"` and `\`, plus control chars U+0000..U+001F.
  - Support escapes: `\"`, `\\`, `\n`, `\r`, `\t`, `\uXXXX` (see **4.7** and **4.13** tests).

**Verify (unit tests in `arbors-types`):**
- [ ] Empty path prints as `""`.
- [ ] Identifier-safe fields use dot notation; non-identifier-safe use `["..."]`.
- [ ] Escapes are emitted for `"` and `\` and control chars.

#### Step 3 — Implement `ArborPath::parse()` (Arbors grammar) with full escaping + unicode rules

**Implement exactly the grammar in 4.7:**
- `path = "" | segment ("." segment)*`
- `segment = identifier | bracket`
- `identifier` = `[a-zA-Z_$][a-zA-Z0-9_$-]*`
- `bracket = "[" (index | quoted) "]"`
- `index = "-"? [0-9]+` parsed into `i32` (error kind `IndexOverflow` if out of range)
- `quoted` is double-quoted only; **single quotes not supported** (**4.7** design decision)

**Escape and correctness rules (from 4.7):**
- Reject unescaped control characters in quoted strings (`InvalidControlChar`).
- Decode `\uXXXX`, including surrogate pairs into scalar values; reject unpaired surrogates (`InvalidSurrogate`).

**Verify (unit tests in `arbors-types`, per 4.13):**
- [ ] Parsing: valid paths, empty string root, indices (including negative), quoted fields, escape sequences.
- [ ] Reject: wildcards (`[*]`), filters (`[?...]`), relative references (`@`) (these should be `ParseError`/specific kinds as you choose, but must reject).
- [ ] Reject: unescaped control chars; reject unpaired surrogates; accept valid surrogate pairs.
- [ ] Round-trip: `parse(s).unwrap().to_string()` is stable for representative inputs.

#### Step 4 — Implement JSON Pointer and URI Fragment parsing (`from_json_pointer`, `from_uri_fragment`)

**Implement exactly (4.9):**
- `from_json_pointer`:
  - Accepts `""` as root.
  - Otherwise must start with `/`.
  - Apply RFC 6901 unescaping (`~1` → `/`, `~0` → `~`).
  - Reject `-` token (`InvalidAppendToken`).
  - Parse indices as **non-negative** integers into `Index(i32)`; reject negatives (parse error) and overflow (`IndexOverflow`).
- `from_uri_fragment`:
  - Accepts `"#"` as root.
  - Otherwise must start with `"#/"`.
  - Then behaves like JSON Pointer parsing on the portion after `#`.
  - Reject `-` token.

**Verify (unit tests in `arbors-types`, per 4.13):**
- [ ] JSON Pointer: `~0/~1` escaping works, empty pointer works, rejects `-`.
- [ ] URI Fragment: `#/` prefix works, `#` root works, rejects `-`.

#### Step 5 — Implement pointer/fragment generation (`to_json_pointer`, `to_uri_fragment`) as fallible

**Implement exactly (4.8/4.9):**
- `to_json_pointer(&self) -> Result<String, ArborPathError>`:
  - Root becomes `""`.
  - Field segments become pointer tokens with RFC 6901 escaping (`~` → `~0`, `/` → `~1`).
  - Index segments must be **non-negative**. If any are negative, return `Err` with kind `NegativeIndexInPointer`.
- `to_uri_fragment(&self) -> Result<String, ArborPathError>`:
  - Root becomes `"#"`.
  - Otherwise `"#"` + `to_json_pointer()` with a leading `/` (i.e., `"#/..."`).
  - Same negative index rule (fail).

**Verify (unit tests in `arbors-types`, per 4.13):**
- [ ] Non-negative paths round-trip through pointer/fragment.
- [ ] Negative indices fail pointer/fragment generation.

#### Step 6 — Implement the rest of the core API + trait impls (serde-as-string)

**Implement per 4.8 and 4.11:**
- Accessors: `segments()`, `len()`, `is_empty()`, `first()`, `last()`
- Mutation: `push`, `push_field`, `push_index`, `pop`, `split_last`
- Builder: `with`, `with_field`, `with_index` (all `#[must_use]`)
- Traits:
  - `Display` (already done in Step 2)
  - `FromStr` (calls `parse`)
  - `IntoIterator` for owned iteration
  - `From<Vec<ArborPathSegment>> for ArborPath`
  - `serde::Serialize` / `serde::Deserialize` as string (parse on deserialize)

**Verify (unit tests in `arbors-types`, per 4.13):**
- [ ] Serde round-trip.
- [ ] Builder chaining works.
- [ ] `split_last` behaves as expected.

#### Step 7 — Add conversions in `arbors-expr` (PathExpr ↔ ArborPath)

**Implement per 4.10 (in `crates/arbors-expr/src/path.rs`):**
- `impl TryFrom<&PathExpr> for ArborPath`:
  - Reject: `expr.is_relative`, `Wildcard`, `Filter`, `Current`.
  - Convert `Field(String)` and `Index(i32)` to `ArborPathSegment::{Field, Index}`.
- `impl From<ArborPath> for PathExpr` (infallible):
  - Convert segments to `PathExpr` segments; `is_relative = false`.

**Verify:**
- [ ] `cargo test -p arbors-expr` passes.
- [ ] Conversion tests cover accept/reject behavior (per 4.13 “Conversions”).

#### Step 8 — Migrate `arbors-schema` to ArborPath

**Implement per Phase 3 in 4.12:**
- Remove `crates/arbors-schema/src/navigation.rs` local `PathSegment`.
- `pub use arbors_types::{ArborPath, ArborPathSegment};`
- Change `parse_path(path: &str) -> Result<ArborPath, ArborPathError>` delegating to `ArborPath::parse`.
- Update schema navigation functions to accept `&ArborPath` instead of `&[PathSegment]`.
- Update `SchemaDiff`:
  - `FieldChange.path: String` → `ArborPath`
  - `TypeChange.path: String` → `ArborPath`
  - Update construction sites to use `ArborPath` parsing/builders.

**Verify:**
- [ ] `cargo test -p arbors-schema` passes.
- [ ] Any schema diff output formats are still meaningful (paths printed via `Display`).

#### Step 9 — Migrate `arbors-io` to ArborPath (builder + tree_ops)

**Implement per Phase 4 in 4.12:**
- `builder.rs`:
  - Remove local `PathSegment`.
  - `ParseContext.data_path: Vec<PathSegment>` → `ArborPath`
  - Replace push/pop with `push_field` / `push_index` / `pop`.
  - Update path display: use `to_string()` (Arbors) or `to_json_pointer()` where needed.
- `tree_ops.rs`:
  - Remove local `PathSegment` and `parse_path_segments()`.
  - Replace parsing with `ArborPath::parse()`.
  - Update `get_at_path`, `set_at_path`, etc. to accept `&ArborPath` or `&str` (parse internally).

**Verify:**
- [ ] `cargo test -p arbors-io` passes.
- [ ] Integration tests that parse data still report correct paths.

#### Step 10 — Migrate `arbors-validate` to ArborPath + remove JSON Pointer helpers

**Implement per Phase 5 in 4.12:**
- `crates/arbors-validate/src/error.rs`:
  - `ValidationError.data_path: String` → `ArborPath`
  - `ValidationError.schema_path: String` → `ArborPath`
  - Display defaults to Arbors format (`path.to_string()`), but `.to_json_pointer()` available (see **4.9**).
- `tree_validator.rs`:
  - Delete helper functions:
    - `escape_json_pointer`
    - `append_key_to_path`
    - `append_index_to_path`
  - Track `ArborPath` during validation and build paths using:
    - `ArborPath::empty()`
    - `with_field`
    - `with_index(idx as i32)`
  - Use `to_json_pointer()` only when a JSON Pointer is explicitly required.

**Verify:**
- [ ] `cargo test -p arbors-validate` passes.
- [ ] Integration tests under `crates/arbors/tests/integration/validate/` updated to match new default display (Arbors format).

#### Step 11 — Finish the “comprehensive scope” sweep + final checkpoint

**Finish all remaining items in 4.12 “Comprehensive scope”:**
- Replace all 4 duplicate `PathSegment` types.
- Replace all 4 String-based path fields:
  - `FieldChange.path`
  - `TypeChange.path`
  - `ValidationError.data_path`
  - `ValidationError.schema_path`
- Remove any remaining ad-hoc JSON Pointer helpers and private path parsers.

**Verify (matches 4.14):**
- [ ] All unit tests described in **4.13** pass.
- [ ] All integration tests pass repo-wide.
- [ ] Validation errors display correctly with `ArborPath`.
- [ ] Schema diff reports use `ArborPath` correctly.

---

## Component 5: Walking & Traversal

**Prerequisite:** Component 4 (ArborPath Foundation) must be completed first.

### 5.1 Recommendation: jq-style walker (one engine)

We implement the **jq-style walk/recurse/apply** model on top of a single internal **Walker** engine. This gives us:

- **One traversal core** with order modes (pre/post/bfs/leaves)
- jq-style **transform** (`walk`) and **selection** (`recurse`) as *thin wrappers*
- Clean composition with Arbors `Expr` (e.g., `apply_where(predicate, transform)`)

**Deferral:** Zipper-style navigation is a separate editing model. It can be added later if we see concrete needs.

### 5.2 Path Policy

**See Component 4 for the complete ArborPath specification.**

All tree operation APIs (Components 5-6) use **ArborPath** for single-value navigation:
- `"user.name"` - field access
- `"users[0].email"` - index access
- `"items[-1]"` - negative index (from end)

ArborPath is guaranteed at the type level to contain only Field/Index segments—no wildcards or filters.

### 5.3 Walk Orders

```rust
pub enum WalkOrder {
    /// Parent before children (depth-first pre-order)
    Pre,
    /// Children before parent (depth-first post-order)
    Post,
    /// Level by level (breadth-first)
    Bfs,
    /// Only leaf nodes, in pre-order (Pre traversal filtered to leaves)
    Leaves,
}
```

**`Leaves` definition:** A node is a "leaf" if it has no children:
- Primitives: `null`, `bool`, `number`, `string`
- Empty array: `[]`
- Empty object: `{}`

Non-empty arrays and objects are **not** leaves.

**`Leaves` order definition:** `Leaves` uses **depth-first pre-order** traversal and yields only nodes that satisfy the leaf definition above. (In other words, `Leaves` is not a distinct traversal algorithm; it is `Pre` with a leaf filter.)

**API clarification:** `InMemoryArbor::leaves_primitive()` yields only primitive leaves (excludes empty containers). `WalkOrder::Leaves` includes empty containers `[]`/`{}` as leaves per this definition.

### 5.4 Unified Walker API (Rust)

Rust exposes exactly one walker that yields `(path, node_id)` in the requested order; everything else is implemented in terms of it.

```rust
pub struct WalkItem {
    pub path: ArborPath,
    pub node_id: NodeId,
}

impl Tree {
    /// Iterate all nodes in this tree in the specified order.
    pub fn walk_items(&self, order: WalkOrder) -> impl Iterator<Item = WalkItem> + '_ {
        // Single implementation handles all orders.
        // Uses iterative algorithm with explicit stack to avoid stack overflow on deep trees.
    }
}
```

**Deterministic object order:** Object children are traversed in **InternId order** (the current storage-native order), not insertion order.

**Path building efficiency:** For depth-first traversals (`Pre`, `Post`, and `Leaves`), the walker maintains a mutable path stack during traversal, cloning only when yielding items. This avoids O(n²) path construction.

**BFS note:** For `Bfs`, a single mutable path stack is not sufficient; BFS must carry per-item path state (or parent pointers with reconstruction). BFS with paths is expected to allocate more (e.g., clone paths per queued node). This is acceptable; BFS is primarily for ergonomics and predictable level-order iteration.

### 5.5 Python Walker API

```python
def iter_nodes(
    self,
    *,
    order: Literal["pre", "post", "bfs", "leaves"] = "pre",
    paths: bool = False,
) -> Iterator[Node] | Iterator[tuple[str, Node]]:
    """Iterate nodes in the tree.

    Args:
        order: Traversal order
            - "pre": Parent before children (default)
            - "post": Children before parent
            - "bfs": Level by level
            - "leaves": Only leaf nodes (primitives + empty containers)
        paths: If True, yields (path_str, node). Otherwise yields node.
               Path strings use Arbors dot+bracket syntax.

    Early termination is supported (just stop iterating).
    """
```

### 5.6 walk(transform) Semantics

The `walk` function applies a transform to every node in **post-order** (children processed before parent). This matches jq's `walk` semantics.

```python
def walk(self, transform: Callable[[Any], Any]) -> Tree:
    """Apply transform to every node, bottom-up (post-order).

    The transform receives the **Python value** of each node (after its children
    have already been transformed):
    - For primitives: the primitive value (None, bool, int, float, str)
    - For arrays: a list containing already-transformed children
    - For objects: a dict containing already-transformed children

    The transform returns a new Python value, which becomes the new node.
    The original tree is not modified; a new tree is returned.

    Example:
        # Double all numbers in a tree
        def double_numbers(node):
            if isinstance(node, (int, float)):
                return node * 2
            return node

        tree = Tree({"a": 1, "b": [2, 3], "c": {"d": 4}})
        result = tree.walk(double_numbers)
        # result: {"a": 2, "b": [4, 6], "c": {"d": 8}}

    Note: Transform sees children AFTER they've been transformed, not before.
    This is what makes walk() compositional (like jq's walk).
    """
```

**Rust implementation sketch:**

```rust
impl Tree {
    pub fn walk<F>(&self, transform: F) -> Tree
    where
        F: Fn(Value) -> Value,
    {
        fn walk_node<F>(tree: &Tree, node_id: NodeId, transform: &F) -> Value
        where
            F: Fn(Value) -> Value,
        {
            let node = tree.get(node_id);
            let transformed_children = match node.node_type() {
                NodeType::Array => {
                    let children: Vec<Value> = node.children()
                        .map(|child_id| walk_node(tree, child_id, transform))
                        .collect();
                    Value::Array(children)
                }
                NodeType::Object => {
                    let fields: Map<String, Value> = node.field_iter()
                        .map(|(key, child_id)| (key.to_string(), walk_node(tree, child_id, transform)))
                        .collect();
                    Value::Object(fields)
                }
                _ => node.to_value(), // primitive
            };
            transform(transformed_children) // apply transform AFTER children
        }

        let root_value = walk_node(self, self.root(), &transform);
        Tree::from_value(root_value)
    }
}
```

#### 5.6.1 Deep Tree Safety

The recursive sketch above is for clarity. **Real implementation must be iterative** (explicit stack) to avoid stack overflow on deep trees. The walker already uses iterative traversal; `walk()` should follow the same pattern.

Alternatively, if recursion is used, enforce a **maximum depth limit** (e.g., 1000 levels) and return an error for deeper trees.

#### 5.6.2 Cost Model

`walk(transform)` is a **Python-focused feature** with significant overhead:

1. **Materialization**: Entire subtrees are converted to Python values (dicts/lists)
2. **Transform calls**: One Python function call per node
3. **Reconstruction**: Result is rebuilt into a new Tree

This is intentional—it prioritizes **ergonomics over performance**. For performance-critical tree transformations, users should use:
- `apply_at()` for targeted changes (no full materialization)
- `apply_where()` with selective predicates
- Rust-level operations (future) for bulk transforms

**Rust-side `Tree::walk`**: Operates on `serde_json::Value`, not Python objects. The Python binding wraps this, handling the Python↔Value conversion at the boundary.

**Order note:** `walk()` does **not** guarantee preservation of object key order in the returned tree. (This is acceptable; callers should not rely on key order.)

### 5.7 apply_at Behavior

```python
def apply_at(self, path: str, transform: Callable[[Any], Any]) -> Tree:
    """Apply transform at exactly one path location.

    Args:
        path: Arbors-style path (single-value only, no wildcards/filters)
        transform: Function receiving the current value, returning new value

    Returns:
        New tree with the transform applied at the path location.

    Raises:
        PathError: If path contains wildcards or filters
        KeyError: If path does not exist in the tree

    Example:
        tree = Tree({"user": {"name": "Alice", "age": 30}})
        result = tree.apply_at("user.age", lambda x: x + 1)
        # result: {"user": {"name": "Alice", "age": 31}}

        # Non-existent path raises KeyError
        tree.apply_at("user.email", lambda x: x)  # raises KeyError
    """
```

**Design decision:** `apply_at` raises `KeyError` for non-existent paths rather than:
- Returning unchanged (silent failure is surprising)
- Creating the path (requires knowing what intermediate structure to create)

If users want "set or create" semantics, they should use `set_path` (Component 6) which explicitly handles creation.

**Negative indices on empty arrays:** `apply_at("items[-1]", ...)` on an empty array is an `IndexOutOfRange` error (Python: `IndexError`). Negative indices are normalized as `len + index` and must still be within bounds.

### 5.8 apply_where and Selector Evaluation

```python
def apply_where(self, predicate: Expr, transform: Callable[[Any], Any]) -> Tree:
    """Apply transform to all nodes where predicate matches.

    The predicate is evaluated with each node as the root context.
    Use path("") to refer to the current node.

    Args:
        predicate: Expression that evaluates to boolean for each node
        transform: Function to apply where predicate is true

    Example:
        # Uppercase all string values
        tree.apply_where(
            path("").is_string(),
            lambda s: s.upper()
        )

        # Double numbers greater than 10
        tree.apply_where(
            path("").is_number() & (path("") > 10),
            lambda n: n * 2
        )
    """

def recurse(self, selector: Expr | None = None) -> Iterator[Any]:
    """Yield nodes in pre-order; if selector provided, yield only matches.

    The selector is evaluated with each node as the root context.

    Args:
        selector: Optional expression to filter nodes. If None, yields all nodes.

    Example:
        # All nodes
        list(tree.recurse())

        # Only objects with a "name" field
        list(tree.recurse(path("name").is_not_null()))

        # Only numbers
        list(tree.recurse(path("").is_number()))
    """

def recurse_paths(self, selector: Expr | None = None) -> Iterator[tuple[str, Any]]:
    """Like recurse() but yields (path_str, node)."""
```

**Selector evaluation context:** When evaluating `selector` or `predicate` at a node:
- The node becomes the "root" for path evaluation
- `path("")` refers to the current node itself
- `path("foo")` refers to field `foo` of the current node (if it's an object)

This is consistent with how jq's `select()` works within a recursive descent.

**Selector error policy:**
- **Invalid expressions** (parse/compile/typecheck errors) are errors and should propagate to the caller.
- **Per-node runtime navigation/type errors** while evaluating a selector/predicate (e.g., missing field, type mismatch, out-of-range index on heterogeneous data) are treated as **non-match** for that node (i.e., selector is false for that node).

**apply_where ordering policy:** When multiple nodes match, transforms are applied in **post-order** (deepest-first). This avoids parent transforms observing partially-updated descendants and matches the compositional “bottom-up” model used by `walk()`.

**Why both iter_nodes() and recurse(None)?**
- `iter_nodes()` is the storage-layer traversal API: no expression evaluation, yields nodes (optionally with paths) efficiently.
- `recurse(selector)` is the query-layer traversal API: adds selector evaluation and jq-style “recursive descent” ergonomics.
- `recurse(None)` is intentionally equivalent (same nodes, same pre-order) to `iter_nodes(order="pre")` but is included for symmetry with `recurse(selector)` and to keep query-oriented code consistent.

#### 5.8.1 Selector Evaluation Implementation

**Dependency constraint:** `arbors-query` already depends on `arbors-storage`. We CANNOT have `arbors-storage` depend on `arbors-query` (would create a cycle).

**Layering decision:**

| Method | Crate | Reason |
|--------|-------|--------|
| `Tree::walk_items()` | `arbors-storage` | No expr dependency |
| `Tree::iter_nodes()` | `arbors-storage` | No expr dependency |
| `Tree::walk(transform)` | `arbors-storage` | No expr dependency (operates on Value) |
| `Tree::apply_at(path, transform)` | `arbors-storage` | No expr dependency |
| `Tree::recurse(selector)` | **`arbors-query`** | Needs expr evaluation |
| `Tree::recurse_paths(selector)` | **`arbors-query`** | Needs expr evaluation |
| `Tree::apply_where(predicate, transform)` | **`arbors-query`** | Needs expr evaluation |
| `eval_expr_at_node()` (optional helper) | **`arbors-query`** | Thin wrapper around existing eval context |

**Implementation:**

```rust
// In arbors-query/src/tree_ext.rs (new file)

use arbors_storage::Tree;
use arbors_expr::Expr;

/// Evaluate an expression with a specific node as the root context.
pub fn eval_expr_at_node(
    tree: &Tree,
    node_id: NodeId,
    expr: &Expr,
) -> Result<Value, EvalError> {
    // Create an EvalContext rooted at node_id (no "virtual tree" needed).
    // Evaluate expr against this context:
    // - path("") resolves to the node itself
    // - path("foo") resolves to node's field "foo"
}

/// Extension trait for Tree that requires expression evaluation.
pub trait TreeQueryExt {
    fn recurse(&self, selector: Option<&Expr>) -> impl Iterator<Item = Value>;
    fn recurse_paths(&self, selector: Option<&Expr>) -> impl Iterator<Item = (ArborPath, Value)>;
    fn apply_where<F>(&self, predicate: &Expr, transform: F) -> Tree
    where
        F: Fn(Value) -> Value;
}

impl TreeQueryExt for Tree {
    // Implementation uses walk_items() from storage + eval_expr_at_node
}
```

**Python bindings:** The Python `Tree` class has all methods (`walk`, `iter_nodes`, `recurse`, `apply_at`, `apply_where`). Under the hood:
- `walk`, `iter_nodes`, `apply_at` → call into `arbors-storage`
- `recurse`, `apply_where` → call into `arbors-query`

The Python user doesn't see this split; it's all on `Tree`.

**`path("")` semantics:** The empty path `""` is already valid in `PathExpr` and means "the root". In selector context, the current node *is* the root, so `path("")` naturally refers to it.

### 5.9 Implementation Plan

**Prerequisite:** Complete Component 4 (ArborPath Foundation) first.

| Area | Task | Files | Notes |
|------|------|-------|-------|
| Path | (See Component 4) `ArborPath` + `ArborPathSegment` | `crates/arbors-types/src/path.rs` | Foundation for Component 5 |
| Path | Add `PathNavigationError` enum | `crates/arbors-types/src/path.rs` | Maps to Python KeyError/TypeError/IndexError (see below) |
| Walker | Implement unified walker (pre/post/bfs/leaves) | `crates/arbors-storage/src/traversal.rs` | Iterative; **InternId order** for objects; BFS carries per-item path state |
| Walk | Implement `walk(transform)` | `crates/arbors-storage/src/walk.rs` (new) | Iterative post-order; Value-based |
| Apply | Implement `apply_at(path, transform)` | `crates/arbors-storage/src/apply.rs` (new) | Uses `PathNavigationError` |
| Selector | Add `eval_expr_at_node()` (optional helper) | `crates/arbors-query/src/tree_ext.rs` (new) | Thin wrapper around `EvalContext::for_node(...)` + eval |
| Recurse | Implement `TreeQueryExt::recurse/recurse_paths` | `crates/arbors-query/src/tree_ext.rs` | Extension trait; uses walker + eval |
| ApplyWhere | Implement `TreeQueryExt::apply_where` | `crates/arbors-query/src/tree_ext.rs` | Extension trait; uses walker + eval |
| Python | Bindings + stubs for `iter/walk/recurse/apply_*` | `python/src/lib.rs` + stubs | Map errors to Python exceptions |

**`PathNavigationError` (recommended):**

```rust
pub enum PathNavigationError {
    /// Tried to access a field that does not exist on an object.
    FieldNotFound { path: ArborPath, field: String },
    /// Tried to access an index that is out of bounds for an array.
    /// `index` is the index requested by the user (may be negative).
    IndexOutOfRange { path: ArborPath, index: i32, len: usize },
    /// Tried to apply a segment to a node of an incompatible type.
    TypeMismatch { path: ArborPath, expected: &'static str, got: NodeType },
}
```

**Mapping to Python:**
- `FieldNotFound` → `KeyError`
- `IndexOutOfRange` → `IndexError`
- `TypeMismatch` → `TypeError`

### 5.10 Tests

- **Rust** (`crates/arbors-types/tests/` for ArborPath; `crates/arbors-storage/tests/` for walker/walk/apply)
  - (See Component 4) ArborPath tests are in arbors-types
  - `PathNavigationError`: correct variant for each failure mode
  - Walker: order correctness (pre/post/bfs/leaves), path correctness, **InternId order** for objects
  - Walker: empty containers `[]`/`{}` are leaves
  - Walker: BFS path correctness (explicitly allow extra allocation)
  - `walk`: post-order semantics (children transformed before parent), iterative (no stack overflow)
  - `apply_at`: success, `FieldNotFound`, `IndexOutOfRange`, `TypeMismatch`
  - `apply_where`: selector evaluation, multiple matches, `path("")` refers to current node
  - `eval_expr_at_node`: empty path, nested paths, type predicates
- **Python** (`python/tests/`)
  - Generator behavior + early stop
  - `walk` transform receives transformed children (dicts/lists)
  - Error mapping: `KeyError`, `IndexError`, `TypeError`, `PathError`
  - Selector evaluation with `path("")`, `path("field")`
  - Selector runtime navigation/type errors are treated as non-match (skip node)

### 5.11 Checkpoint

- [ ] (See Component 4) `ArborPath` + `ArborPathSegment` types exist in `arbors-types`
- [ ] `PathNavigationError` maps to Python `KeyError`/`IndexError`/`TypeError`
- [ ] Unified walker (iterative) is the only traversal implementation
- [ ] Object traversal uses **InternId order** (storage-native deterministic order)
- [ ] `walk()` is iterative (depth-safe), operates on `Value`
- [ ] `eval_expr_at_node()` exists in `arbors-query`
- [ ] `iter/walk/recurse/recurse_paths/apply_at/apply_where` implemented and tested
- [ ] All tests pass for error taxonomy edge cases

---

## DEFERRED: Component 6: Diffing, Merging, and Patching

**Prerequisite:** Component 4 (ArborPath Foundation) must be completed first.

### 6.1 Path requirement: Arbors-style paths (no JSON Pointer)

Diff/merge/patch must use **Arbors-style paths** (dot + bracket), not RFC 6901 JSON Pointer.

Paths in these APIs are always **single-value paths** (Field/Index only).

### 6.2 Tree Diffing

Semantic tree diffing that produces minimal edit operations, inspired by [Graphtage](https://blog.trailofbits.com/2020/08/28/graphtage/) and the [treediff](https://lib.rs/crates/treediff) crate.

#### 6.2.1 Diff Operations

```rust
/// Types of edit operations in a diff
#[derive(Debug, Clone, PartialEq)]
pub enum DiffOp {
    /// Value unchanged
    Match { path: ArborPath },
    /// Value added
    Insert { path: ArborPath, value: Value },
    /// Value removed
    Remove { path: ArborPath, value: Value },
    /// Value replaced
    Replace { path: ArborPath, old: Value, new: Value },
    /// Array element moved
    Move { from: ArborPath, to: ArborPath },
}

/// A complete diff between two trees
pub struct TreeDiff {
    pub operations: Vec<DiffOp>,
    pub edit_distance: usize,
}
```

#### 6.2.2 Diff API

```python
def diff(self, other: Tree) -> TreeDiff:
    """Compute semantic diff between two trees.

    Returns a TreeDiff containing the minimal set of operations
    to transform self into other.

    Examples:
        >>> old = Tree({"name": "John", "age": 30})
        >>> new = Tree({"name": "John", "age": 31, "city": "NYC"})
        >>> diff = old.diff(new)
        >>> print(diff)
        Replace: age: 30 -> 31
        Insert: city: "NYC"
    """

def diff_summary(self, other: Tree) -> str:
    """Human-readable diff summary."""

def diff_to_patch(self, other: Tree) -> JsonPatch:
    """Generate a Patch (RFC 6902-style ops, using Arbors paths)."""
```

#### 6.2.3 Rust Diff Implementation

```rust
// crates/arbors-storage/src/diff.rs

impl Tree {
    pub fn diff(&self, other: &Tree) -> TreeDiff {
        let mut ops = Vec::new();
        self.diff_impl(other, self.root(), other.root(), ArborPath::root(), &mut ops);
        TreeDiff {
            edit_distance: ops.len(),
            operations: ops,
        }
    }

    fn diff_impl(
        &self,
        other: &Tree,
        self_id: NodeId,
        other_id: NodeId,
        path: ArborPath,
        ops: &mut Vec<DiffOp>,
    ) {
        let self_node = self.get_node(self_id);
        let other_node = other.get_node(other_id);

        match (self_node.node_type(), other_node.node_type()) {
            // Same type - compare values or recurse
            (NodeType::Object, NodeType::Object) => {
                self.diff_objects(other, self_id, other_id, &path, ops);
            }
            (NodeType::Array, NodeType::Array) => {
                self.diff_arrays(other, self_id, other_id, &path, ops);
            }
            _ if self_node.value() == other_node.value() => {
                ops.push(DiffOp::Match { path });
            }
            _ => {
                ops.push(DiffOp::Replace {
                    path,
                    old: self_node.to_value(),
                    new: other_node.to_value(),
                });
            }
        }
    }

    fn diff_arrays(
        &self,
        other: &Tree,
        self_id: NodeId,
        other_id: NodeId,
        path: &ArborPath,
        ops: &mut Vec<DiffOp>,
    ) {
        // Use Levenshtein-style algorithm for array diffing
        // Detect moves, insertions, deletions
        let self_children: Vec<_> = self.children(self_id).collect();
        let other_children: Vec<_> = other.children(other_id).collect();

        // Compute LCS and derive operations
        // ... (implementation details)
    }
}
```

### 6.3 Tree Merging

Three-way merge with conflict detection, supporting both JSON Merge Patch (RFC 7386) and custom merge strategies.

#### 6.3.1 Merge Strategies

```rust
/// Strategy for handling merge conflicts
#[derive(Debug, Clone, Copy)]
pub enum MergeStrategy {
    /// Take value from "ours" (self)
    Ours,
    /// Take value from "theirs" (other)
    Theirs,
    /// Fail on conflict
    Strict,
    /// Use custom resolver function
    Custom,
}

/// Result of a merge operation
pub struct MergeResult {
    pub merged: Tree,
    pub conflicts: Vec<MergeConflict>,
}

pub struct MergeConflict {
    pub path: ArborPath,
    pub base: Option<Value>,
    pub ours: Option<Value>,
    pub theirs: Option<Value>,
}
```

#### 6.3.2 Merge API

```python
def merge(
    self,
    other: Tree,
    *,
    strategy: Literal["ours", "theirs", "strict"] = "theirs",
) -> Tree:
    """Two-way merge: merge other into self.

    For objects: combines fields (other overwrites on conflict based on strategy)
    For arrays: concatenates by default, or replaces based on strategy
    For primitives: uses strategy to resolve

    Examples:
        >>> base = Tree({"a": 1, "b": 2})
        >>> update = Tree({"b": 3, "c": 4})
        >>> base.merge(update)  # {"a": 1, "b": 3, "c": 4}
    """

def merge3(
    self,
    base: Tree,
    other: Tree,
    *,
    strategy: Literal["ours", "theirs", "strict"] = "strict",
) -> MergeResult:
    """Three-way merge with common ancestor.

    Uses base to determine which side made changes.
    Returns MergeResult with merged tree and any conflicts.

    Examples:
        >>> # Git-style merge
        >>> result = ours.merge3(base, theirs)
        >>> if result.conflicts:
        ...     print("Conflicts:", result.conflicts)
        >>> else:
        ...     final = result.merged
    """

def merge_patch(self, patch: dict) -> Tree:
    """Apply RFC 7386 JSON Merge Patch.

    - null values remove fields
    - Objects are merged recursively
    - Other values replace

    Examples:
        >>> tree = Tree({"a": 1, "b": {"c": 2}})
        >>> tree.merge_patch({"b": {"d": 3}, "a": None})
        # Result: {"b": {"c": 2, "d": 3}}
    """
```

#### 6.3.3 Rust Merge Implementation

```rust
// crates/arbors-storage/src/merge.rs

impl Tree {
    pub fn merge(&self, other: &Tree, strategy: MergeStrategy) -> Result<Tree, Error> {
        self.merge_impl(other, self.root(), other.root(), strategy)
    }

    fn merge_impl(
        &self,
        other: &Tree,
        self_id: NodeId,
        other_id: NodeId,
        strategy: MergeStrategy,
    ) -> Result<Tree, Error> {
        let self_node = self.get_node(self_id);
        let other_node = other.get_node(other_id);

        match (self_node.node_type(), other_node.node_type()) {
            (NodeType::Object, NodeType::Object) => {
                // Merge objects field by field
                let mut fields = IndexMap::new();

                // Add all fields from self
                for (key, child_id) in self.object_fields(self_id) {
                    fields.insert(key.clone(), self.subtree(child_id)?);
                }

                // Merge/overwrite with fields from other
                for (key, child_id) in other.object_fields(other_id) {
                    if let Some(existing) = fields.get(&key) {
                        // Recursive merge
                        let merged = existing.merge_impl(other, ...)?;
                        fields.insert(key.clone(), merged);
                    } else {
                        fields.insert(key.clone(), other.subtree(child_id)?);
                    }
                }

                Tree::from_object(fields)
            }
            _ => {
                // Non-object: use strategy
                match strategy {
                    MergeStrategy::Ours => Ok(self.clone()),
                    MergeStrategy::Theirs => Ok(other.clone()),
                    MergeStrategy::Strict => Err(Error::MergeConflict),
                    MergeStrategy::Custom => unreachable!(),
                }
            }
        }
    }
}
```

### 6.4 Tree Patching (RFC 6902-style ops, Arbors paths)

Full support for RFC 6902 operation semantics, but paths are Arbors-style (dot + bracket).

#### 6.4.1 Patch Operations

```rust
/// RFC 6902 JSON Patch operation
#[derive(Debug, Clone, PartialEq)]
pub enum PatchOp {
    /// Add value at path
    Add { path: ArborPath, value: Value },
    /// Remove value at path
    Remove { path: ArborPath },
    /// Replace value at path
    Replace { path: ArborPath, value: Value },
    /// Move value from one path to another
    Move { from: ArborPath, path: ArborPath },
    /// Copy value from one path to another
    Copy { from: ArborPath, path: ArborPath },
    /// Test that value at path equals expected
    Test { path: ArborPath, value: Value },
}

/// A complete Patch document
pub struct Patch {
    pub operations: Vec<PatchOp>,
}
```

#### 6.4.2 Patch API

```python
def patch(self, operations: list[dict] | Patch) -> Tree:
    """Apply patch operations (RFC 6902-style semantics, Arbors paths).

    Args:
        operations: List of patch operations or JsonPatch object

    Examples:
        >>> tree = Tree({"foo": "bar"})
        >>> tree.patch([
        ...     {"op": "add", "path": "baz", "value": "qux"},
        ...     {"op": "replace", "path": "foo", "value": "boo"},
        ... ])
        # Result: {"foo": "boo", "baz": "qux"}
    """

def patch_test(self, operations: list[dict]) -> tuple[Tree, list[bool]]:
    """Apply patch and return test results.

    Returns tuple of (patched_tree, test_results) where test_results
    contains True/False for each 'test' operation.
    """

@staticmethod
def create_patch(old: Tree, new: Tree) -> JsonPatch:
    """Create RFC 6902 patch that transforms old into new."""
```

### 6.5 Path Operations and Getters/Setters

Functional path-based access and mutation (immutable - returns new trees).

#### 6.5.1 Path Operations

```python
def get_path(self, path: str) -> Node | None:
    """Get value at Arbors path.

    Examples:
        >>> tree.get_path("users[0].name")
        >>> tree.get_path("deeply.nested.value")
    """

def set_path(self, path: str, value: Any) -> Tree:
    """Set value at path, returning new tree.

    Creates intermediate objects/arrays as needed.

    Examples:
        >>> tree.set_path("user.address.city", "NYC")
    """

def del_path(self, path: str) -> Tree:
    """Delete value at path, returning new tree."""

def paths(self) -> Iterator[tuple[str, Node]]:
    """Iterate all paths in the tree.

    Examples:
        >>> for path, value in tree.paths():
        ...     print(f"{path}: {value}")
        name: "John"
        age: 30
        address.city: "NYC"
    """
```

### 6.6 Implementation Plan

| Area | Task | Files | Notes |
|------|------|-------|-------|
| Diff | Deterministic diff | `crates/arbors-storage/src/diff.rs` (new) | arrays use LCS; moves optional |
| Merge | merge/merge3/merge_patch | `crates/arbors-storage/src/merge.rs` (new) | conflicts include `ArborPath` |
| Patch | Patch apply + patch_test | `crates/arbors-storage/src/patch.rs` (new) | atomic apply |
| Python | Bindings for diff/merge/patch + Patch type | `python/src/lib.rs` + stubs | paths are Arbors strings |
| Tests | Storage + Python tests | `crates/arbors-storage/tests/` + `python/tests/` | correctness + edge cases |

### 6.7 Tests

- Rust:
  - `diff()` stable + deterministic output (golden tests)
  - diff correctness on nested objects/arrays; moves optional/explicit
  - merge conflict paths reported as Arbors paths
  - patch apply + patch_test semantics; invalid-path behavior
- Python:
  - patch dict format uses Arbors paths
  - parity checks for visible behaviors

### 6.8 Checkpoint

- [ ] diff/merge/patch APIs use Arbors paths (no JSON Pointer)
- [ ] `Patch` exists and is round-trippable via Python dicts
- [ ] Deterministic diff output, merge conflict reporting, and patch apply are tested

### Removed Section

This section has been superseded by the individual component checkpoints:
- Component 4 checkpoint: See Section 4.14
- Component 5 checkpoint: See Section 5.11
- Component 6 checkpoint: See Section 6.8

**Deferred (post-v1):**
- [ ] Zipper-style navigation (if needed)

---

## DEFERRED: Component 7: Embeddings & Vector Search

**This flips the vector database paradigm on its head.** In typical vector databases, embeddings are the primary data and metadata is secondary (a "sidecar"). In Arbors, the tree is primary and embeddings are just another queryable field - but matching on embeddings brings the **whole tree** along for the ride.

Arbors takes **no part** in computing embeddings. Developers must produce embeddings elsewhere (OpenAI, sentence-transformers, CLIP, etc.) and store them as fields in their JSON documents.

### 7.1 Design Philosophy

The key insight: semantic search becomes a filter operation that returns complete hierarchical documents, not just IDs or flat rows. Combined with Arbors' other query capabilities (filter, group, aggregate), this enables powerful hybrid queries.

```python
# Find similar documents AND filter by metadata
results = arbor.filter(
    path("embedding").similar(query_embedding, metric="cosine", threshold=0.8)
    & (path("category") == "research")
    & (path("date") > "2024-01-01")
).sort_by_desc(
    path("embedding").similarity(query_embedding, metric="cosine")
).head(10)

# Each result is a COMPLETE tree with all its nested data
for tree in results:
    print(tree["title"], tree["authors"], tree["sections"])
```

### 7.2 Embedding Type

#### 7.2.1 Schema Definition

Embeddings are JSON-native arrays with an attached **logical type** (this already exists in `arbors-schema` as `LogicalType::Embedding(EmbeddingParams)`).

```json
{
  "type": "object",
  "properties": {
    "embedding": {
      "type": "array",
      "items": { "type": "number" },
      "logicalType": "embedding",
      "x-embedding-dim": 384
    }
  }
}
```

Notes:
- v1 treats embeddings as arrays of numbers plus `LogicalType::Embedding` metadata; do **not** introduce `SchemaType::Embedding`.
- Dimension validation is enforced when `x-embedding-dim` is present.

#### 7.2.2 Storage (v1)

- v1 uses **List<Float64>** (codebase-native: storage has Float64 primitives today).
- Optional future optimization: export as `FixedSizeList<Float64>` when dimension is known.

### 7.3 Similarity Metrics

#### 7.3.1 Supported Metrics

| Metric | Formula | Range | Best For |
|--------|---------|-------|----------|
| `cosine` | `1 - (a·b)/(|a||b|)` | [0, 2] | Text similarity, semantic search |
| `dot` | `a·b` | (-∞, +∞) | Normalized embeddings, recommendations |
| `euclidean` | `√Σ(aᵢ-bᵢ)²` | [0, +∞) | Spatial data, clustering |
| `euclidean_squared` | `Σ(aᵢ-bᵢ)²` | [0, +∞) | Same ranking as euclidean, faster |
| `manhattan` | `Σ|aᵢ-bᵢ|` | [0, +∞) | Sparse vectors |

#### 5.3.2 Implementation Notes (codebase-native)

- Metrics live in **`arbors-query`** and operate over **`&[f64]`** (embeddings are list-of-f64 in v1).
- Provide:
  - `distance(metric, a: &[f64], b: &[f64]) -> Result<f64, DistanceError>`
  - `similarity(metric, a: &[f64], b: &[f64]) -> Result<f64, DistanceError>`
- Dimension mismatch is an error.
- Cosine zero vectors: similarity 0.0, distance 1.0 (avoid NaN).
- Optional Arrow fast path: query vector vs `List<Float64>` column for schemaful execution.

### 7.4 Expression Operations

#### 7.4.1 Embedding Accessor

Following the direct method pattern (accessor pattern removed - see Component 3.7):

```python
# Embedding operations are directly on Expr (accessor pattern removed)
# Methods: similar(), similarity(), distance(), normalize(), magnitude(), dimensions()

# Embedding methods are directly on Expr:
# path("embedding").similar(query, metric="cosine", threshold=0.8)
# path("embedding").similarity(query, metric="cosine")
# path("embedding").distance(query, metric="euclidean")
# path("embedding").normalize()
# path("embedding").magnitude()
# path("embedding").dimensions()
```

#### 5.4.2 Expr Variants

```rust
// crates/arbors-expr/src/expr.rs

pub enum Expr {
    // ... existing variants ...

    /// Compute similarity between embedding and query
    EmbeddingSimilarity {
        embedding: Box<Expr>,
        query: Embedding,
        metric: DistanceMetric,
    },

    /// Compute distance between embedding and query
    EmbeddingDistance {
        embedding: Box<Expr>,
        query: Embedding,
        metric: DistanceMetric,
    },

    /// Check if similarity exceeds threshold
    EmbeddingSimilarityThreshold {
        embedding: Box<Expr>,
        query: Embedding,
        metric: DistanceMetric,
        threshold: f32,
    },

    /// L2 normalize an embedding
    EmbeddingNormalize {
        embedding: Box<Expr>,
    },

    /// Get magnitude (L2 norm) of embedding
    EmbeddingMagnitude {
        embedding: Box<Expr>,
    },

    /// Get dimensions of embedding
    EmbeddingDimensions {
        embedding: Box<Expr>,
    },
}
```

### 7.5 Arbor-Level Operations

#### 7.5.1 Nearest Neighbor Search

```python
def nearest(
    self,
    field: str | Expr,
    query: list[float] | Embedding,
    k: int,
    *,
    metric: Literal["cosine", "dot", "euclidean", "manhattan"] = "cosine",
) -> Arbor:
    """Find k nearest neighbors by embedding similarity.

    This is KNN (exact nearest neighbor) search. For large arbors,
    consider filtering first to reduce search space.

    Args:
        field: Path to embedding field
        query: Query embedding
        k: Number of neighbors to return
        metric: Distance metric

    Returns:
        New Arbor with k trees, sorted by similarity (most similar first)

    Examples:
        >>> # Find 10 most similar documents
        >>> similar = arbor.nearest("embedding", query_vec, k=10)

        >>> # Hybrid search: filter first, then find nearest
        >>> recent_similar = (
        ...     arbor
        ...     .filter(path("date") > "2024-01-01")
        ...     .nearest("embedding", query_vec, k=10)
        ... )
    """

def within_distance(
    self,
    field: str | Expr,
    query: list[float] | Embedding,
    max_distance: float,
    *,
    metric: Literal["cosine", "dot", "euclidean", "manhattan"] = "cosine",
) -> Arbor:
    """Find all trees within distance threshold.

    Args:
        field: Path to embedding field
        query: Query embedding
        max_distance: Maximum distance (metric-dependent)
        metric: Distance metric

    Returns:
        New Arbor with all trees within threshold, sorted by distance
    """
```

#### 5.5.2 Rust Implementation

```rust
// crates/arbors/src/handle/embedding.rs

impl Arbor {
    pub fn nearest(
        &self,
        field: impl Into<Expr>,
        query: &Embedding,
        k: usize,
        metric: DistanceMetric,
    ) -> Result<Self, PipelineError> {
        let field_expr = field.into();

        // Compute distances for all trees
        let mut scored: Vec<(usize, f32)> = self.iter()
            .enumerate()
            .filter_map(|(idx, tree)| {
                let tree = tree.ok()?;
                let embedding = eval_expr(&field_expr, &tree.into_context())
                    .ok()
                    .and_then(|r| r.as_embedding())?;
                let distance = metric.distance(&embedding, query);
                Some((idx, distance))
            })
            .collect();

        // Partial sort for top-k (more efficient than full sort)
        scored.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(Ordering::Equal));
        scored.truncate(k);

        // Collect indices and build result
        let indices: Vec<usize> = scored.into_iter().map(|(idx, _)| idx).collect();
        self.take(&indices)
    }

    pub fn within_distance(
        &self,
        field: impl Into<Expr>,
        query: &Embedding,
        max_distance: f32,
        metric: DistanceMetric,
    ) -> Result<Self, PipelineError> {
        let field_expr = field.into();

        // Filter and sort by distance
        let mut scored: Vec<(usize, f32)> = self.iter()
            .enumerate()
            .filter_map(|(idx, tree)| {
                let tree = tree.ok()?;
                let embedding = eval_expr(&field_expr, &tree.into_context())
                    .ok()
                    .and_then(|r| r.as_embedding())?;
                let distance = metric.distance(&embedding, query);
                if distance <= max_distance {
                    Some((idx, distance))
                } else {
                    None
                }
            })
            .collect();

        scored.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(Ordering::Equal));

        let indices: Vec<usize> = scored.into_iter().map(|(idx, _)| idx).collect();
        self.take(&indices)
    }
}
```

### 7.6 SIMD Optimization

For performance-critical similarity computation, use SIMD intrinsics:

```rust
// crates/arbors-query/src/embedding_simd.rs

#[cfg(target_arch = "x86_64")]
use std::arch::x86_64::*;

/// SIMD-accelerated dot product for f32 vectors
#[cfg(all(target_arch = "x86_64", target_feature = "avx2"))]
pub fn dot_product_simd(a: &[f32], b: &[f32]) -> f32 {
    assert_eq!(a.len(), b.len());
    let len = a.len();
    let chunks = len / 8;
    let remainder = len % 8;

    let mut sum = unsafe { _mm256_setzero_ps() };

    for i in 0..chunks {
        let offset = i * 8;
        unsafe {
            let va = _mm256_loadu_ps(a.as_ptr().add(offset));
            let vb = _mm256_loadu_ps(b.as_ptr().add(offset));
            sum = _mm256_fmadd_ps(va, vb, sum);
        }
    }

    // Horizontal sum
    let mut result = unsafe {
        let low = _mm256_extractf128_ps(sum, 0);
        let high = _mm256_extractf128_ps(sum, 1);
        let sum128 = _mm_add_ps(low, high);
        let sum64 = _mm_add_ps(sum128, _mm_movehl_ps(sum128, sum128));
        let sum32 = _mm_add_ss(sum64, _mm_shuffle_ps(sum64, sum64, 1));
        _mm_cvtss_f32(sum32)
    };

    // Handle remainder
    for i in (chunks * 8)..len {
        result += a[i] * b[i];
    }

    result
}

/// Fallback for non-AVX2 platforms
#[cfg(not(all(target_arch = "x86_64", target_feature = "avx2")))]
pub fn dot_product_simd(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}
```

### 7.7 Python API

```python
from arbors import path, Embedding

# Create embedding from list
emb = Embedding([0.1, 0.2, 0.3, ...])

# Or from numpy array (zero-copy when possible)
import numpy as np
arr = np.array([0.1, 0.2, 0.3], dtype=np.float32)
emb = Embedding.from_numpy(arr)

# Embedding operations
emb.normalize()           # L2 normalize in place
normalized = emb.normalized()  # Return normalized copy
emb.magnitude()           # L2 norm
emb.dimensions            # Dimension count

# Create arbor with embeddings
arbor = arbors.read_jsonl('''
    {"id": 1, "text": "hello world", "embedding": [0.1, 0.2, ...]}
    {"id": 2, "text": "goodbye", "embedding": [0.3, 0.4, ...]}
''')

# Expression-based similarity
similar = arbor.filter(
    path("embedding").similar(query_emb, metric="cosine", threshold=0.8)
)

# Sort by similarity
ranked = arbor.sort_by_desc(
    path("embedding").similarity(query_emb)
)

# KNN search
nearest = arbor.nearest("embedding", query_emb, k=10, metric="cosine")

# Hybrid search: combine semantic + metadata filters
results = (
    arbor
    .filter(path("category") == "science")
    .filter(path("date") > "2024-01-01")
    .nearest("embedding", query_emb, k=5)
)
```

### 7.8 Implementation Order

| Step | Task | Priority |
|------|------|----------|
| 1 | Embedding schema + validation | HIGH |
|  | - Use `LogicalType::Embedding(EmbeddingParams)` (already exists) |  |
|  | - Enforce `x-embedding-dim` where present |  |
| 2 | Distance metrics (slice kernels + optional Arrow) | HIGH |
|  | - `DistanceMetric` + `distance/similarity` over `&[f64]` |  |
|  | - Optional Arrow kernel: query vec vs `List<Float64>` column |  |
| 3 | Expression operations (embedding methods) | HIGH |
|  | - Add embedding methods directly to Expr + Expr variants for distance/similarity/threshold |  |
|  | - Vectorize automatically when schema + List<Float64> allow |  |
| 4 | Arbor-level vector search (API sugar) | MEDIUM |
|  | - `nearest()` / `within_distance()` as plan composition (sort/head/filter) |  |
|  | - Leverage existing TopK fusion |  |

### 7.9 Files to Modify

| File | Changes |
|------|---------|
| `crates/arbors-schema/src/logical_types.rs` | Embedding logical type params (already exists; extend only if needed) |
| `crates/arbors-schema/src/arbors_extension.rs` | Parse `logicalType: "embedding"` + `x-embedding-dim` |
| `crates/arbors-validate/src/logical_types.rs` | Embedding validation (already exists; ensure used end-to-end) |
| `crates/arbors-query/src/embedding_metric.rs` | NEW: DistanceMetric + slice kernels |
| `crates/arbors-query/src/embedding_metric_arrow.rs` | NEW (optional): Arrow kernels for List<Float64> |
| `crates/arbors-expr/src/expr.rs` | Add embedding methods directly to Expr + Expr variants |
| `crates/arbors-query/src/eval.rs` | Evaluators for embedding expressions |
| `crates/arbors/src/handle/` | Add `nearest/within_distance` as plan composition (no new plan nodes) |
| `python/src/lib.rs` | Python embedding methods directly on Expr + `arbor.nearest/within_distance` |

### 7.10 Success Criteria

- [ ] Embeddings represented as arrays of Float64 with `LogicalType::Embedding` metadata
- [ ] Dimension validation enforced when `x-embedding-dim` is present
- [ ] All distance metrics working: cosine, dot, euclidean, euclidean_squared, manhattan
- [ ] Embedding methods directly on Expr: similarity()/distance()/similar(threshold)
- [ ] `nearest()` / `within_distance()` work as API sugar (sort/head/filter) and benefit from TopK fusion
- [ ] Hybrid queries combining embedding search with regular filters
- [ ] Optional Arrow vectorization works when schema provides List<Float64> embedding column

---
