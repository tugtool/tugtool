# Arbors Architecture Plan: Phase 8+9 – Expression System & Query Engine

**Goal:** Build a Polars-inspired expression system as the foundation for all query operations, capable of constructing and transforming rich tree-shaped data, not just filtering and picking leaves.

**Design principle:** Expressions are first-class citizens and can describe new trees, not just point to existing values.

---

## Immutable + Copy-on-Write (COW) Contract

- **Immutable-first:** All operations return new Arbor instances (or new trees/results) without mutating inputs.
- **Shared storage:** Columnar nodes, Arrow-backed pools, and interners should be reference-counted so derived arbors reuse buffers until a write is required.
- **Copy-on-write triggers:** Only copy columns/pools when a transformation would overwrite data; pure selects/filters/reads must share.
- **Scope:** Applies to Rust and Python APIs, expression evaluation, query ops (`filter`, `select`, `with_column`, `agg`), and any lazy plan materialization.
- **Testing note:** Add checks that input arbors remain unchanged after transformations and that fast paths reuse storage (when observable).

---

### COW Application Points

- `filter`/`select`/`with_column`/`agg` and tree-level variants: return new arbors; share nodes/pools unless data is rewritten.
- Expression evaluator: materialize results without mutating source arbor; reuse pools when extracting Arrow/JSON.
- Arrow export (`to_record_batch`/`to_parquet`): zero-copy where possible; do not mutate pools.
- Builders/parsers: produce owned columnar nodes/pools; downstream transforms must treat them as read-only inputs.
- Lazy/later phases: plan nodes carry shared references; copy only when an operation demands mutation of buffers.

---

## How to Read This Document

This document is organized into three parts:

- **Part I (Sections A–L):** Conceptual foundation. Read this to understand *why* the system works the way it does.
- **Part II (Phases 8.1–9):** Implementation plan. Read this to understand *what* to build and in what order.
- **Part III (Sections M–Q):** Design decisions and reference material.

Each implementation phase includes **Key Concepts** and **Reference** annotations pointing back to the conceptual sections.

### Quick Reference Table

| Concept | Section |
|---------|---------|
| Expr enum | F.1 |
| PathExpr | F.2 |
| Shape / Cardinality | B.3 |
| Logical Plan (DAG) | G |
| Filter rules | E |
| Tree-building expressions | H |
| Query operations | I |
| Expression algebra | J |
| Evaluation pipeline | K |
| Concrete example | L |
| Acceptance tests | Q |

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Expression System Flow                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   User API                                                                  │
│   ────────                                                                  │
│   path("a[*].b").sum()  ───┐                                                │
│   struct_(name=..., ...)   │                                                │
│   arbor.filter(expr)       │                                                │
│                            ▼                                                │
│   ┌──────────┐     ┌──────────────┐     ┌───────────┐     ┌─────────────┐   │
│   │   Expr   │────▶│ LogicalPlan  │────▶│ Evaluator │────▶│ ExprResult  │   │
│   │   AST    │     │    (DAG)     │     │           │     │             │   │
│   └──────────┘     └──────────────┘     └───────────┘     └─────────────┘   │
│        │                  │                   │                  │          │
│        ▼                  ▼                   ▼                  ▼          │
│   PathExpr          Type/shape          Path traversal     Query results    │
│   parsing           inference           NodeId → Value     (Arbor/Tree)     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

# Part I: Conceptual Foundation

---

## A. Why We're Reframing Phase 8 and 9

The original Phase 8+9 split was:
- Phase 8: basic filter / select with simple predicates
- Phase 9: add expressions

That's backwards. In Polars:

```python
df.filter(pl.col("age") > 21)
df.select(pl.col("name"), pl.col("age") * 2)
```

Expressions are the core abstraction and all operations are built on them.

For Arbors, we now go further:
- Expressions must be able to navigate trees,
- Compute on values,
- And **build new tree structures**.

`filter`, `select`, `with_column`, `agg` become thin layers over a powerful expression engine.

---

## B. Key Insight: Trees vs DataFrames

### B.1 Polars Model (Vector over Rows)

Polars expressions operate over columns:
- `pl.col("age")` → all values in the age column
- Operations broadcast over rows
- Results are columns or scalars

The model is: **one value per row per column**.

### B.2 Arbors Model (Paths over Trees)

Arbors has two levels:
- **Arbor**: collection of trees (like JSONL rows)
- **Tree**: one JSON document with nested objects/arrays

```python
arbor = aq.read_jsonl('''
{"user": {"name": "Alice", "age": 30}, "items": [{"price": 10}, {"price": 20}]}
{"user": {"name": "Bob", "age": 25},   "items": [{"price": 15}]}
{"user": {"name": "Charlie", "age": 35}, "items": []}
''')
```

Paths navigate INTO trees:

```python
path("user.age")   # per-tree scalar: [30, 25, 35]
path("user.name")  # per-tree scalar: ["Alice", "Bob", "Charlie"]
```

Wildcards yield MULTIPLE values from ONE tree:

```python
path("items[*].price")

# Tree 0: [10, 20]
# Tree 1: [15]
# Tree 2: []
```

A single path can produce 0, 1, or many values per tree. And those values may themselves be objects/arrays.

### B.3 Cardinality and Shape: The Central Concepts

Every expression evaluated against a tree has:
1. **Cardinality** – scalar vs vector
2. **Shape** – scalar, list, struct (possibly nested)

We introduce a conceptual result model:

```
ExprResult =
    Scalar(Value)              # one value (or null)
  | List(Vec<ExprResult>)      # ordered list, per tree
  | Struct(Map<String, ExprResult>)  # object-like result
  | Null                       # no value
```

*(In practice we will not literally allocate this structure for performance; see implementation notes.)*

**Cardinality (per tree):**

| Cardinality | Meaning | Examples |
|-------------|---------|----------|
| **Scalar** | 0–1 values | `path("user.age")`, `path("items[*].price").sum()` |
| **Vector** | 0–N values (list) | `path("items[*].price")`, `path("departments[*].name")` |

**Shape:**
- `Scalar(Value)` – basic primitive or leaf (string, number, bool, null)
- `List(...)` – list of ExprResults
- `Struct(...)` – object with named fields, each an ExprResult
- Shapes can nest arbitrarily.

**Cardinality propagation (simplified):**

| Operation | Input → Output |
|-----------|----------------|
| Aggregations (`sum`, `mean`, `any`, `all`, `count`, `min`, `max`) | vector → scalar |
| Arithmetic/comparison (scalar op scalar) | scalar → scalar |
| Arithmetic/comparison (vector op scalar) | vector (broadcast) |
| Arithmetic/comparison (vector op vector) | vector (elementwise; list result) |
| `list(exprs...)` | list (vector) |
| `struct(fields...)` | struct |

---

## C. The Fractal Scope Rule

Trees are self-similar. We define:

> **Fractal Scope Rule**
>
> - Arbor operations see each **tree** as its "row".
> - Tree operations see that tree's **descendants** as their scope.
> - No operation consults or mutates outside the subtree of the receiver.

**Implications:**
- `arbor.filter(expr)` makes keep/drop decisions at tree granularity.
- `tree.filter("items", expr)` makes keep/drop decisions at array element granularity (within that tree).
- `@` is always "the current element" in array filters, never "the current tree".

---

## D. Evaluation Contexts

Expressions are evaluated in one of three contexts:

**1. Per-tree context (Arbor-level)**
- Evaluate `expr` for each tree in the Arbor.
- Result: one `ExprResult` per tree.
- Used by: `arbor.filter`, `arbor.select`, `arbor.with_column`, `arbor.agg`.

**2. Per-subtree context (Tree-level)**
- Evaluate `expr` over a single tree's contents.
- Result: one `ExprResult`.
- Used by: `tree.eval(expr)`, `tree.select`.

**3. Per-element context (array filtering)**
- When evaluating `Filter(Box<Expr>)` or `tree.filter("items", expr)`.
- `@` binds to the current array element.
- `expr` must yield a scalar bool for each element.
- Used by: `tree.filter`, path filters `items[?@.active]`.

---

## E. Filter Semantics (Non-Negotiable Rules)

**Rule:** `filter()` always expects a scalar boolean in its context.

### E.1 Arbor.filter(expr)

For each tree, evaluate `expr` in per-tree context. If result is:
- **scalar bool** → used as is
- **null** → treated as false (or configurable, but fixed)
- **anything else** (vector, struct, scalar non-bool) → **error**

**Examples:**

```python
# OK: scalar bool per tree
adults = arbor.filter(path("user.age") > 21)

# WRONG: vector of bools; will error
arbor.filter(path("items[*].price") > 100)

# OK: explicitly reduce vector to scalar
arbor.filter((path("items[*].price") > 100).any())
arbor.filter((path("items[*].price") > 100).all())
```

### E.2 Tree.filter(path, expr)

- Finds array at `path` inside the tree.
- Evaluates `expr` in per-element context with `@` bound to each array element.
- `expr` must yield scalar bool; other shapes produce errors.

```python
tree.filter("items", path("@.price") > 10)
# Keeps only elements from items where price > 10
```

---

## F. Expression Design

### F.1 Core Expr Enum

We extend `Expr` so it can **construct** structured results, not just consume them.

```rust
/// A logical expression describing tree computations.
/// Lazy, composable, and shape-aware.
pub enum Expr {
    // === References ===
    Path(PathExpr),                 // path("user.name"), path("items[*].price")
    Literal(Value),                 // lit(42), lit("Alice")

    // === Arithmetic ===
    Add(Box<Expr>, Box<Expr>),
    Sub(Box<Expr>, Box<Expr>),
    Mul(Box<Expr>, Box<Expr>),
    Div(Box<Expr>, Box<Expr>),
    Neg(Box<Expr>),

    // === Comparison (bool) ===
    Eq(Box<Expr>, Box<Expr>),
    Ne(Box<Expr>, Box<Expr>),
    Lt(Box<Expr>, Box<Expr>),
    Le(Box<Expr>, Box<Expr>),
    Gt(Box<Expr>, Box<Expr>),
    Ge(Box<Expr>, Box<Expr>),

    // === Logical (bool) ===
    And(Box<Expr>, Box<Expr>),
    Or(Box<Expr>, Box<Expr>),
    Not(Box<Expr>),

    // === String Ops ===
    Contains(Box<Expr>, Box<Expr>),
    StartsWith(Box<Expr>, Box<Expr>),
    EndsWith(Box<Expr>, Box<Expr>),
    ToLower(Box<Expr>),
    ToUpper(Box<Expr>),

    // === Null Handling ===
    IsNull(Box<Expr>),
    IsNotNull(Box<Expr>),
    Coalesce(Vec<Expr>),

    // === Aggregations (vector -> scalar) ===
    Sum(Box<Expr>),
    Count(Box<Expr>),
    Mean(Box<Expr>),
    Min(Box<Expr>),
    Max(Box<Expr>),
    Any(Box<Expr>),     // for bool vectors
    All(Box<Expr>),

    // === Collection / Shape Ops ===
    Len(Box<Expr>),     // length of list/object

    // === Conditional ===
    When {
        condition: Box<Expr>,
        then_expr: Box<Expr>,
        else_expr: Box<Expr>,
    },

    // === Type Ops ===
    Cast(Box<Expr>, ArborsType),
    TypeOf(Box<Expr>),

    // === Constructors (NEW) ===
    /// Build a list from expressions: list(expr1, expr2, ...)
    List(Vec<Expr>),

    /// Build a struct/object: struct("name" => expr1, "age" => expr2)
    Struct(Vec<(String, Expr)>),
}
```

### F.2 Path Expressions

Unchanged in spirit, but we explicitly support filter segments:

```rust
pub struct PathExpr {
    segments: Vec<PathSegment>,
}

pub enum PathSegment {
    Field(String),            // .name (missing → Null)
    Index(i32),               // [0], [-1] (strict: out-of-range → IndexError)
    Wildcard,                 // [*] (0-N values, empty is valid)
    Filter(Box<Expr>),        // [?expr], with @ as current element
}
```

---

## G. Logical Expression Plan (DAG)

To support Polars-level computation and optimization, we need expressions as a **logical plan**, not eager visitors.

### G.1 LogicalExpr Node

Internally we represent expressions as DAG nodes:

```rust
/// ID for a node in the logical expression DAG
#[derive(Clone, Copy, Debug, Hash, Eq, PartialEq)]
pub struct ExprId(u32);

pub struct LogicalExpr {
    id: ExprId,
    kind: Expr,                // the Expr enum
    children: Vec<ExprId>,     // dependencies
    // Inferred properties:
    ty: Option<ArborsType>,   // result type
    shape: Option<Shape>,      // scalar / list / struct(+nested)
    cardinality: Option<Cardinality>,  // scalar / vector
}
```

We maintain a `LogicalPlan` for an operation (e.g., `arbor.select([...])`) that includes:
- **Roots**: the `ExprId`s for top-level expressions
- **Node map**: `ExprId` → `LogicalExpr`

### G.2 Shape + Cardinality Inference

Before executing, we run an inference pass:
- For each node, infer:
  - result type (e.g., `Int64`, `Utf8`, `Struct{name: Utf8, stats: Struct{…}}`)
  - result cardinality (scalar vs vector)
  - shape kind (scalar / list / struct)

This allows:
- Early type error detection
- Ensuring `filter()` receives scalar bool
- Ensuring we don't accidentally create invalid nested results
- Previewing the result "schema" for select, with_column, agg

**Implementation note:** Phase 8 can do a straightforward topological inference (no heavy optimizer). Phase 10+ can add constant folding, common subexpression elimination, and pushdown.

---

## H. Tree-Building Expressions

Now that `Expr` can build lists and structs, we can compose new tree structures, not just pluck existing ones.

### H.1 struct() and list() in Python

```python
from arbors import path, lit, struct, list_

# Combine fields into a struct
user_summary = struct(
    name = path("user.name"),
    age = path("user.age"),
    item_count = path("items").len(),
    total_spent = path("items[*].price").sum(),
)

# Build a nested result tree
rich = struct(
    user = struct(
        id = path("user.id"),
        name = path("user.name"),
    ),
    stats = struct(
        avg_price = path("items[*].price").mean(),
        expensive_items = (path("items[*].price") > 100).any(),
    ),
)
```

### H.2 select() with struct/list expressions

```python
# Re-map each tree into a new structure:
result = arbor.select([
    struct(
        user = path("user"),
        metrics = struct(
            item_count = path("items").len(),
            total_spent = path("items[*].price").sum(),
        ),
    ).alias("summary")
])
```

This produces an Arbor where each tree looks like:

```json
{
  "summary": {
    "user": { "...original user..." },
    "metrics": {
      "item_count": 3,
      "total_spent": 120.5
    }
  }
}
```

**This is the capability that was missing: expressions that build new trees, not just point at old ones.**

---

## I. Query Operations Built on Expressions

### I.1 Arbor.filter(expr)

Already defined above: scalar bool per tree. (See Section E.1)

### I.2 Arbor.select(exprs)

`select` now accepts arbitrary expressions, which may yield:
- scalars
- lists
- structs
- nested combinations thereof

**Semantics:**
- Evaluate each `expr` per tree (in per-tree context).
- Combine their results into a resulting tree according to:
  - alias / field name on each expr
  - expression shape

**Example:**

```python
result = arbor.select([
    path("user.name").alias("name"),
    path("user.age").alias("age"),
    struct(
        count = path("items").len(),
        total = path("items[*].price").sum(),
    ).alias("stats"),
])
```

Result tree shape per row:

```json
{
  "name": "Alice",
  "age": 30,
  "stats": {
    "count": 2,
    "total": 30
  }
}
```

### I.3 Arbor.with_column(name, expr)

Adds or replaces a top-level field per tree with the result of `expr`.

```python
enriched = (
    arbor
        .with_column("total_price", path("items[*].price").sum())
        .with_column("summary", struct(
            has_expensive = (path("items[*].price") > 100).any(),
            avg_price = path("items[*].price").mean(),
        ))
)
```

### I.4 Arbor.agg(exprs)

Aggregates across all trees in the Arbor:
- Evaluates each expr across all trees
- Result is a single Tree whose fields come from expressions.

**Example:**

```python
summary = arbor.agg([
    path("user.age").mean().alias("avg_age"),
    path("items[*].price").sum().alias("total_revenue"),
    path("user.id").count().alias("user_count"),
])

# summary tree:
# {"avg_age": 34.5, "total_revenue": 12345.67, "user_count": 100}
```

Internally, some agg expressions will:
- collapse per-tree results into scalars
- treat Arbor as a "super-array of trees"

---

## J. Expression Algebra: Laws and Invariants

Expressions form an algebra with predictable laws. These invariants guide implementation and ensure composability.

### J.1 Core Algebraic Laws

**Identity:**
```
expr + lit(0) = expr
expr * lit(1) = expr
expr.and(lit(true)) = expr
expr.or(lit(false)) = expr
```

**Annihilator:**
```
expr * lit(0) = lit(0)
expr.and(lit(false)) = lit(false)
expr.or(lit(true)) = lit(true)
```

**Commutativity (where applicable):**
```
a + b = b + a
a * b = b * a
a.and(b) = b.and(a)
a.or(b) = b.or(a)
a == b ⟺ b == a
```

**Associativity:**
```
(a + b) + c = a + (b + c)
(a.and(b)).and(c) = a.and(b.and(c))
```

**Distributivity:**
```
a.and(b.or(c)) = a.and(b).or(a.and(c))
```

**De Morgan's Laws:**
```
not(a.and(b)) = not(a).or(not(b))
not(a.or(b)) = not(a).and(not(b))
```

**Double negation:**
```
not(not(a)) = a
```

### J.2 Null Propagation Laws

**Null absorption:** Most operations absorb null:
```
null + x = null
null * x = null
null > x = null
null.and(x) = null (or false? — see design decision below)
```

**Coalesce semantics:**
```
coalesce(null, x) = x
coalesce(x, y) = x  (if x is not null)
```

**Null-safe comparisons:**
```
is_null(null) = true
is_null(x) = false  (for non-null x)
is_not_null(x) = not(is_null(x))
```

**Design decision: null in boolean context**

Option A (SQL-like): `null.and(x) = null`, `null.or(x) = null`
Option B (Short-circuit): `null.and(x) = null`, `true.or(null) = true`
Option C (Strict): Any null in boolean expression → error

**Current choice:** Option A (SQL-like three-valued logic). This is familiar and consistent. `filter()` treats null as false.

### J.3 Shape Invariants

**Cardinality preservation:**
```
scalar op scalar → scalar
vector op scalar → vector
vector op vector → vector (elementwise, same length)
aggregation(vector) → scalar
```

**Shape compatibility:**
```
list(...) → List shape
struct(...) → Struct shape
Nested combinations compose as expected
```

**Aggregation collapse:**
```
path("items[*].price").sum() : vector → scalar
path("items[*].price").mean() : vector → scalar
```

### J.4 Type Invariants

**Arithmetic requires numeric:**
```
int + int → int
float + float → float
int + float → float (promotion)
string + int → ERROR
```

**Comparison requires compatible types:**
```
int > int → bool
string > string → bool (lexicographic)
int > string → ERROR
```

**Boolean operations require bool:**
```
bool.and(bool) → bool
int.and(int) → ERROR
```

### J.5 Path Invariants

**Field access on object → scalar (one field per tree)**
```
path("user.name") : Scalar
```

**Wildcard on array → vector (many elements)**
```
path("items[*]") : Vector
```

**Wildcard composition:**
```
path("items[*].price") = path("items[*]").then(path("price"))
```

**Filter composition:**
```
path("items[?@.active]") ⊆ path("items[*]")
```

**Index access (strict, Python-like):**
```
path("items[0]") : Scalar (first element, or IndexError if empty)
path("items[-1]") : Scalar (last element, computed as items[len-1])
path("items[-k]") : Scalar (computed as items[len-k], IndexError if out of range)
```

**Critical distinction:**
- `items[k]` (fixed index) → Scalar **or IndexError** (never Null)
- `items[*]` (wildcard) → Vector (0–N values, empty is valid, not an error)

---

## K. Internal Evaluation Pipeline

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌────────────┐
│   Parse     │────▶│ Logical Plan │────▶│ Optimized Plan  │────▶│  Evaluate  │
│ (Expr AST)  │     │   (DAG)      │     │   (optional)    │     │  (Execute) │
└─────────────┘     └──────────────┘     └─────────────────┘     └────────────┘
       │                   │                     │                      │
       ▼                   ▼                     ▼                      ▼
  path("a.b")         ExprId nodes         Constant fold          ExprResult
  .sum()              Type inference       CSE                    per tree
                      Shape inference      Pushdown hints
```

### K.1 Stage 1: Parse → Expr AST

**Input:** User expression (Python builder or string parsing)
**Output:** `Expr` enum tree

```python
# User writes:
path("items[*].price").sum()

# Becomes:
Expr::Sum(
    Box::new(Expr::Path(PathExpr {
        segments: [
            Field("items"),
            Wildcard,
            Field("price"),
        ]
    }))
)
```

**Responsibilities:**
- Parse path strings into `PathExpr`
- Build `Expr` tree from builder method calls
- No type checking yet

### K.2 Stage 2: Logical Plan (DAG)

**Input:** `Expr` tree
**Output:** `LogicalPlan` with `ExprId`-indexed nodes

```rust
struct LogicalPlan {
    nodes: HashMap<ExprId, LogicalExpr>,
    roots: Vec<ExprId>,  // top-level expressions
}

struct LogicalExpr {
    id: ExprId,
    kind: Expr,
    children: Vec<ExprId>,
    // Inferred properties:
    ty: Option<ArborsType>,
    shape: Option<Shape>,
    cardinality: Option<Cardinality>,
}
```

**Inference pass (topological order):**

1. Walk nodes bottom-up
2. For each node, infer `ty`, `shape`, `cardinality` from children
3. Detect errors early (type mismatch, cardinality violation for filter)

**Example inference:**

```
path("items[*].price")
  → ty: Float64
  → shape: List
  → cardinality: Vector

path("items[*].price").sum()
  → ty: Float64
  → shape: Scalar
  → cardinality: Scalar
```

### K.3 Stage 3: Optimized Plan (Optional)

**Input:** `LogicalPlan`
**Output:** Optimized `LogicalPlan`

**Phase 8:** Skip this stage entirely (identity transform)

**Phase 10+:**
- Constant folding: `lit(1) + lit(2)` → `lit(3)`
- Common subexpression elimination
- Predicate pushdown hints
- Path coalescing

### K.4 Stage 4: Evaluate

**Input:** `LogicalPlan` + `Arbor` (or single `Tree`)
**Output:** `ExprResult` per tree (or single result)

**Evaluation strategy (Phase 8 — simple, correct):**

```rust
fn eval_expr(plan: &LogicalPlan, expr_id: ExprId, tree: &Tree) -> ExprResult {
    let node = &plan.nodes[&expr_id];
    match &node.kind {
        Expr::Path(path) => eval_path(tree, path),
        Expr::Literal(v) => ExprResult::Scalar(v.clone()),
        Expr::Add(l, r) => {
            let left = eval_expr(plan, *l, tree);
            let right = eval_expr(plan, *r, tree);
            add_results(left, right)
        }
        Expr::Sum(inner) => {
            let vals = eval_expr(plan, *inner, tree);
            sum_result(vals)
        }
        // ... etc
    }
}
```

**Phase 10+ evaluation (columnar):**
- Batch evaluation across all trees
- Arrow-backed intermediate results
- ColumnarNodes-aware path traversal

---

## L. Concrete Example: `path("a[*].b").sum()`

Let's trace this expression through the entire pipeline.

### L.1 Input Data

```python
arbor = aq.read_jsonl('''
{"a": [{"b": 10}, {"b": 20}, {"b": 30}]}
{"a": [{"b": 5}]}
{"a": []}
''')
```

Three trees:
- Tree 0: `a` has 3 elements, `b` values are `[10, 20, 30]`
- Tree 1: `a` has 1 element, `b` value is `[5]`
- Tree 2: `a` has 0 elements, `b` values are `[]`

### L.2 Stage 1: Parse

```python
expr = path("a[*].b").sum()
```

Produces AST:

```rust
Expr::Sum(
    Box::new(Expr::Path(PathExpr {
        segments: [
            PathSegment::Field("a"),
            PathSegment::Wildcard,
            PathSegment::Field("b"),
        ]
    }))
)
```

### L.3 Stage 2: Logical Plan

Build DAG and infer properties:

```
ExprId(0): Path("a[*].b")
  → ty: Int64 (inferred from data or schema)
  → cardinality: Vector (Wildcard present)
  → shape: List

ExprId(1): Sum(ExprId(0))
  → ty: Int64
  → cardinality: Scalar (aggregation reduces Vector → Scalar)
  → shape: Scalar
```

LogicalPlan:
```rust
LogicalPlan {
    nodes: {
        ExprId(0) => LogicalExpr { kind: Path(...), ty: Int64, cardinality: Vector, ... },
        ExprId(1) => LogicalExpr { kind: Sum(ExprId(0)), ty: Int64, cardinality: Scalar, ... },
    },
    roots: [ExprId(1)],
}
```

### L.4 Stage 3: Optimize

For Phase 8: pass-through (no optimization).

### L.5 Stage 4: Evaluate

**Per-tree evaluation:**

**Tree 0:**
```
eval(ExprId(1), tree0)
  → eval_sum(eval(ExprId(0), tree0))
  → eval_sum(eval_path("a[*].b", tree0))
  → eval_sum([10, 20, 30])  // path yields Multiple([10, 20, 30])
  → Single(60)
```

**Tree 1:**
```
eval(ExprId(1), tree1)
  → eval_sum([5])
  → Single(5)
```

**Tree 2:**
```
eval(ExprId(1), tree2)
  → eval_sum([])
  → Single(0) or Null (design choice: sum([]) = 0)
```

### L.6 Path Evaluation Detail

For `path("a[*].b")` on Tree 0:

```
1. Start at root node
2. Field("a") → navigate to "a" field → node pointing to array
3. Wildcard → expand to all 3 array elements → [node0, node1, node2]
4. Field("b") → for each element, navigate to "b" → [10, 20, 30]
5. Return Multiple([10, 20, 30])
```

**Implementation in ColumnarNodes:**

```rust
fn eval_path(tree: &Tree, path: &PathExpr) -> ExprResult {
    let mut current: Vec<NodeId> = vec![tree.root()];

    for segment in &path.segments {
        current = match segment {
            Field(name) => {
                // For each node, find child with key `name`
                current.iter()
                    .filter_map(|n| tree.get_child_by_key(*n, name))
                    .collect()
            }
            Wildcard => {
                // For each node (must be array), expand to all children
                current.iter()
                    .flat_map(|n| tree.children(*n))
                    .collect()
            }
            Index(i) => {
                // For each node (array), get element at index i
                current.iter()
                    .filter_map(|n| tree.get_child_by_index(*n, *i))
                    .collect()
            }
            Filter(pred) => {
                // For each element, evaluate pred; keep if true
                current.into_iter()
                    .filter(|n| {
                        let sub_tree = tree.subtree(*n);
                        matches!(eval_expr(pred, &sub_tree), ExprResult::Scalar(Value::Bool(true)))
                    })
                    .collect()
            }
        };
    }

    // Convert NodeIds to values
    if current.len() == 1 {
        ExprResult::Scalar(tree.value(current[0]))
    } else if current.is_empty() {
        ExprResult::Null
    } else {
        ExprResult::List(current.iter().map(|n| tree.value(*n)).collect())
    }
}
```

### L.7 Result

If used in `with_column`:

```python
result = arbor.with_column("total_b", path("a[*].b").sum())
```

Produces:

```json
{"a": [{"b": 10}, {"b": 20}, {"b": 30}], "total_b": 60}
{"a": [{"b": 5}], "total_b": 5}
{"a": [], "total_b": 0}
```

---

# Part II: Implementation Plan

This section provides actionable checklists for each phase. Tasks are ordered for top-to-bottom implementation.

---

## Codebase Context (from exploration)

**Existing Infrastructure:**
- `arbors-core`: `NodeType` (11 variants), `NodeId(u32)`, `InternId` (24-bit), `Node` (16-byte)
- `arbors-storage`: `Arbor`, `ColumnarNodes` (SoA), `FinishedPools` (Arrow-backed), `StringInterner`
- `arbors-storage`: **Path navigation exists**: `Arbor.get_path(root, path)` with `"foo.bar[0]"` syntax
- `arbors-arrow`: Schema discovery, `to_record_batch()`, Python `to_arrow()`
- `python/src/lib.rs`: `PyArbor`, `PyTree`, `PyNode` with `.path()` method

**What Phase 8 Must Build:**
- New crate `arbors-expr` for expression definitions (NO storage dependency)
- New crate `arbors-query` for evaluation over Arbor/Tree
- Extended `PathExpr` with wildcards `[*]` and filters `[?expr]`
- `Expr` enum, `LogicalPlan`, shape/type inference
- `ExprResult` with nested shapes
- Query operations: `filter()`, `select()`, `with_column()`, `agg()`
- Python expression API with operator overloading

---

## Crate Dependency Structure (Critical)

**Avoiding Dependency Cycles:**

The expression system must be split into two crates to avoid circular dependencies:

```
arbors-core          (low-level types: NodeType, NodeId, InternId, ArborsType)
    ↓
arbors-storage       (Arbor, Tree, ColumnarNodes, pools)
    ↓
arbors-expr          (Expr, PathExpr, Value, ExprResult, LogicalPlan, inference)
    │                  └── depends on: arbors-core ONLY (not storage!)
    ↓
arbors-query         (EvalContext, eval_expr, Arbor query methods)
    │                  └── depends on: arbors-core, arbors-storage, arbors-expr
    ↓
arbors-arrow         (Arrow export)
    ↓
arbors               (top-level re-exports)
    ↓
python bindings
```

**Why this matters:**
- `arbors-expr` defines the expression language (AST, types, inference)
- `arbors-query` executes expressions over actual Arbor/Tree data
- If `arbors-expr` depended on `arbors-storage`, and query methods on Arbor took `Expr`, we'd have a cycle

**Separation of concerns:**

| Crate | Contains | Depends On |
|-------|----------|------------|
| `arbors-expr` | `Value`, `Expr`, `PathExpr`, `ExprResult`, `Shape`, `Cardinality`, `LogicalPlan`, inference, validation | `arbors-core` only |
| `arbors-query` | `EvalContext`, `eval_expr()`, `eval_path()`, `Arbor::filter/select/with_column/agg` helpers | `arbors-core`, `arbors-storage`, `arbors-expr` |

**Path Migration:**

The existing `Arbor.get_path(root, path)` with `"foo.bar[0]"` syntax will be **migrated** to delegate to `PathExpr`:
- `PathExpr::parse()` becomes the canonical path parser
- Existing `get_path()` calls `PathExpr::parse()` internally and evaluates
- No two subtly different path semantics

**Implementation Note: Phase 10+ Performance**

The Phase 8 evaluator uses `ExprResult` + `Value` built from `ColumnarNodes` via `extract_value()`. This is a **materializing evaluator** — simple, correct, but not optimal.

Phase 10+ will likely introduce:
- Arrow-backed intermediate results (no materialization to `Value`)
- Pool-backed evaluation that stays within `ColumnarNodes`
- Vectorized operations across all trees simultaneously

The Phase 8 implementation is the "correct but not ultimate" reference evaluator.

---

## Phase 8.1 – Expression Core (Rust)

**Goal:** Implement the `Expr` enum, `PathExpr`, and basic evaluation for single trees.

**Key Concepts:** Section F (Expression Design), Section F.1 (Expr Enum), Section F.2 (Path Expressions)

### 8.1.1 Create `arbors-expr` Crate

- [x] Create `crates/arbors-expr/Cargo.toml`
  - Dependencies: `arbors-core`, `thiserror`, `indexmap`
  - Optional: `serde` for expression serialization
  - **NO dependency on `arbors-storage`** (critical for avoiding cycles)
- [x] Create `crates/arbors-expr/src/lib.rs` with module structure:
  ```
  mod expr;       // Expr enum
  mod path;       // PathExpr and PathSegment
  mod value;      // Value enum (JSON-like values)
  mod result;     // ExprResult type
  mod shape;      // Shape, Cardinality
  mod plan;       // LogicalPlan, LogicalExpr, ExprId
  mod infer;      // Type/shape/cardinality inference
  mod validate;   // Filter validation, error checking
  mod error;      // ExprError type
  ```
- [x] Add `arbors-expr` to workspace in root `Cargo.toml`
- [x] Add `arbors-expr` as dependency of `arbors` (re-export crate)

**Note:** Evaluation (`eval_expr`) lives in `arbors-query`, not here. This crate defines the expression language only.

### 8.1.2 Define Value Type

File: `crates/arbors-expr/src/value.rs`

**Reference:** Section B.3 (ExprResult conceptual model)

- [x] Define `Value` enum (JSON-like values for expression evaluation):
  ```rust
  pub enum Value {
      Null,
      Bool(bool),
      Int64(i64),
      Float64(f64),
      String(String),
      Date(i32),           // days since epoch
      DateTime(i64),       // microseconds since epoch
      Duration(i64),       // microseconds
      Binary(Vec<u8>),
  }
  ```
- [x] Implement `From<T>` for all primitive types
- [x] Implement type-safe accessors: `as_bool()`, `as_i64()`, `as_f64()`, `as_str()`, etc.
- [x] Implement `PartialEq`, `PartialOrd` for comparisons
- [x] Implement `Display` for debug output

### 8.1.3 Define ExprResult Type

File: `crates/arbors-expr/src/result.rs`

**Reference:** Section B.3 (Cardinality and Shape)

- [x] Define `ExprResult` enum:
  ```rust
  pub enum ExprResult {
      Scalar(Value),
      List(Vec<ExprResult>),
      Struct(IndexMap<String, ExprResult>),  // preserves insertion order
      Null,
  }
  ```
- [x] Implement helper methods:
  - `is_scalar() -> bool`
  - `is_list() -> bool`
  - `is_struct() -> bool`
  - `is_null() -> bool`
  - `as_scalar() -> Option<&Value>`
  - `as_list() -> Option<&[ExprResult]>`
  - `as_struct() -> Option<&IndexMap<String, ExprResult>>`
  - `into_scalar() -> Option<Value>`
  - `len() -> usize` (for lists)
- [x] Implement `From<Value>` for `ExprResult`

### 8.1.4 Define PathExpr

File: `crates/arbors-expr/src/path.rs`

**Reference:** Section F.2 (Path Expressions), Section J.5 (Path Invariants), Design Decision M.5 (Index Semantics)

- [x] Define `PathSegment` enum:
  ```rust
  pub enum PathSegment {
      Field(String),        // .fieldname (missing field → Null)
      Index(i32),           // [0], [-1] (strict: out-of-range → IndexError)
      Wildcard,             // [*] (yields 0-N values, empty is valid)
      Filter(Box<Expr>),    // [?expr] (yields 0-N values)
      Current,              // @ (current element reference in filters)
  }
  ```
- [x] Define `PathExpr` struct:
  ```rust
  pub struct PathExpr {
      pub segments: Vec<PathSegment>,
      pub is_absolute: bool,  // starts from root vs relative to current
  }
  ```
- [x] Implement `PathExpr::parse(s: &str) -> Result<Self, PathParseError>`:
  - Parse `"foo.bar.baz"` → `[Field("foo"), Field("bar"), Field("baz")]`
  - Parse `"items[0]"` → `[Field("items"), Index(0)]`
  - Parse `"items[-1]"` → `[Field("items"), Index(-1)]`
  - Parse `"items[*]"` → `[Field("items"), Wildcard]`
  - Parse `"items[*].price"` → `[Field("items"), Wildcard, Field("price")]`
  - Parse `"@.price"` → `[Current, Field("price")]`
  - Defer `[?expr]` parsing to later (requires Expr to be defined first)
- [x] Implement `Display` for path serialization
- [x] Unit tests for all parsing cases

### 8.1.5 Define Expr Enum

File: `crates/arbors-expr/src/expr.rs`

**Reference:** Section F.1 (Core Expr Enum)

- [x] Define `Expr` enum (all variants from Section F.1):
  ```rust
  pub enum Expr {
      // References
      Path(PathExpr),
      Literal(Value),

      // Arithmetic
      Add(Box<Expr>, Box<Expr>),
      Sub(Box<Expr>, Box<Expr>),
      Mul(Box<Expr>, Box<Expr>),
      Div(Box<Expr>, Box<Expr>),
      Neg(Box<Expr>),

      // Comparison
      Eq(Box<Expr>, Box<Expr>),
      Ne(Box<Expr>, Box<Expr>),
      Lt(Box<Expr>, Box<Expr>),
      Le(Box<Expr>, Box<Expr>),
      Gt(Box<Expr>, Box<Expr>),
      Ge(Box<Expr>, Box<Expr>),

      // Logical
      And(Box<Expr>, Box<Expr>),
      Or(Box<Expr>, Box<Expr>),
      Not(Box<Expr>),

      // String
      Contains(Box<Expr>, Box<Expr>),
      StartsWith(Box<Expr>, Box<Expr>),
      EndsWith(Box<Expr>, Box<Expr>),
      ToLower(Box<Expr>),
      ToUpper(Box<Expr>),

      // Null handling
      IsNull(Box<Expr>),
      IsNotNull(Box<Expr>),
      Coalesce(Vec<Expr>),

      // Aggregations
      Sum(Box<Expr>),
      Count(Box<Expr>),
      Mean(Box<Expr>),
      Min(Box<Expr>),
      Max(Box<Expr>),
      Any(Box<Expr>),
      All(Box<Expr>),
      First(Box<Expr>),
      Last(Box<Expr>),

      // Collection
      Len(Box<Expr>),

      // Conditional
      When { condition: Box<Expr>, then_expr: Box<Expr>, else_expr: Box<Expr> },

      // Type
      Cast(Box<Expr>, ArborsType),
      TypeOf(Box<Expr>),

      // Constructors
      List(Vec<Expr>),
      Struct(Vec<(String, Expr)>),

      // Aliasing (for select/agg output naming)
      Alias { expr: Box<Expr>, name: String },
  }
  ```
- [x] Implement builder functions:
  ```rust
  pub fn path(s: &str) -> Expr { Expr::Path(PathExpr::parse(s).unwrap()) }
  pub fn lit<V: Into<Value>>(v: V) -> Expr { Expr::Literal(v.into()) }
  pub fn list(exprs: Vec<Expr>) -> Expr { Expr::List(exprs) }
  pub fn struct_(fields: Vec<(&str, Expr)>) -> Expr { ... }
  ```
- [x] Implement method-chaining builders on `Expr`:
  ```rust
  impl Expr {
      pub fn add(self, other: Expr) -> Expr { Expr::Add(Box::new(self), Box::new(other)) }
      pub fn gt(self, other: Expr) -> Expr { Expr::Gt(Box::new(self), Box::new(other)) }
      pub fn sum(self) -> Expr { Expr::Sum(Box::new(self)) }
      pub fn alias(self, name: &str) -> Expr { Expr::Alias { expr: Box::new(self), name: name.to_string() } }
      // ... all other methods
  }
  ```
- [ ] Update `PathSegment::Filter` parsing now that `Expr` exists (deferred: filter expressions stored as unparsed strings for now)

### 8.1.6 Define Error Types

File: `crates/arbors-expr/src/error.rs`

**Reference:** Section E (Filter Semantics), Design Decision M.5 (Index Semantics)

- [x] Define `ExprError` enum:
  ```rust
  #[derive(Debug, thiserror::Error)]
  pub enum ExprError {
      #[error("path parse error: {0}")]
      PathParse(String),

      #[error("type mismatch: expected {expected}, got {got}")]
      TypeMismatch { expected: String, got: String },

      #[error("cardinality error: filter requires scalar bool, got {got}")]
      CardinalityError { got: String },

      #[error("index out of range: index {index} on array of length {len}")]
      IndexOutOfRange { index: i32, len: usize },

      #[error("null in arithmetic expression")]
      NullArithmetic,

      #[error("division by zero")]
      DivisionByZero,

      #[error("invalid operation: {0}")]
      InvalidOperation(String),

      #[error("path not found: {0}")]
      PathNotFound(String),
  }
  ```

### 8.1.7 Tests for Phase 8.1 (arbors-expr only)

File: `crates/arbors-expr/src/` (inline module tests)

- [x] `path.rs`: All path syntax variants (26 tests)
- [x] `expr.rs`: Expr construction via builders (22 tests)
- [x] `value.rs`: Value enum, From impls, comparisons (6 tests)
- [x] `result.rs`: ExprResult construction and accessors (10 tests)
- [x] `arbors_type.rs`: ArborsType tests (6 tests)

**Phase 8.1 Deliverables:**
- [x] `arbors-expr` crate compiles (NO storage dependency)
- [x] All expression types defined
- [x] Path parsing complete (including wildcards)
- [x] Value and ExprResult types complete
- [x] 61 unit tests pass (exceeds 30+ requirement)

---

## Phase 8.1b – Query Crate & Evaluation (Rust)

**Goal:** Create `arbors-query` crate with expression evaluation over Arbor/Tree.

**Key Concepts:** Section K (Evaluation Pipeline), Section D (Evaluation Contexts), Section L (Concrete Example)

### 8.1b.1 Create `arbors-query` Crate

- [x] Create `crates/arbors-query/Cargo.toml`
  - Dependencies: `arbors-core`, `arbors-storage`, `arbors-expr`, `thiserror`
- [x] Create `crates/arbors-query/src/lib.rs` with module structure:
  ```
  mod context;    // EvalContext
  mod eval;       // eval_expr, eval_path
  mod ops;        // filter, select, with_column, agg implementations
  mod tree_ops;   // Tree-level operations
  ```
- [x] Add `arbors-query` to workspace in root `Cargo.toml`
- [x] Add `arbors-query` as dependency of `arbors` (re-export crate)

### 8.1b.2 Implement Expression Evaluator

File: `crates/arbors-query/src/context.rs`

**Reference:** Section D (Evaluation Contexts)

- [x] Define `EvalContext` struct:
  ```rust
  pub struct EvalContext<'a> {
      arbor: &'a Arbor,
      root: NodeId,           // current tree root
      current: Option<NodeId>, // for @ reference in filters
  }
  ```

File: `crates/arbors-query/src/eval.rs`

**Reference:** Section K.4 (Stage 4: Evaluate), Section L.6 (Path Evaluation Detail)

- [x] Implement `eval_expr(expr: &Expr, ctx: &EvalContext) -> Result<ExprResult, ExprError>`:
  - **Path evaluation**: Use existing `Arbor.get_field()` and `Arbor.child_at()` methods
  - **Wildcard handling**: Collect all children, return `ExprResult::List`
  - **Literal**: Return `ExprResult::Scalar(value)`
  - **Arithmetic**: Extract scalars, compute, handle null propagation (Section J.2)
  - **Comparison**: Return scalar bool
  - **Logical**: AND/OR/NOT on bools (Section J.1)
  - **Aggregations**: Reduce list to scalar (Section J.3)
  - **Constructors**: Build nested ExprResult (Section H)
- [x] Helper: `eval_path(path: &PathExpr, ctx: &EvalContext) -> Result<ExprResult, ExprError>`
  - Walk path segments
  - Handle `Wildcard` → collect all children into list (Section J.5)
  - Handle `Filter` → evaluate predicate, keep matching elements
  - Handle `Current` → use `ctx.current` (Section D, context 3)
- [x] Helper: `extract_value(arbor: &Arbor, node: NodeId) -> Value`
  - Map NodeType → Value using existing pool accessors

### 8.1b.3 Migrate Existing Path Code

File: `crates/arbors-storage/src/lib.rs`

- [x] Update `Arbor::get_path()` to use `PathExpr::parse()` internally
- [x] Deprecate string-based path parsing in storage (delegate to expr)
- [x] Ensure backward compatibility for existing callers

### 8.1b.4 Tests for Phase 8.1b

File: `crates/arbors-query/tests/`

**Reference:** Section L (Concrete Example) for test patterns

- [x] `integration.rs`: Combined test file covering all cases below
  - [x] Literal, path, arithmetic, comparison (basic evaluation)
  - [x] sum, count, mean, min, max, any, all, first, last (aggregations - Section J.3)
  - [x] `[*]` expansion, cardinality checks (wildcards - Section J.5)
  - [x] list(), struct() building (constructors - Section H)
  - [x] Null propagation, coalesce, is_null (null handling - Section J.2)
  - [x] `[?expr]` path filters with `@` (filters - Section D, context 3)
  - [x] Index semantics (strict, Python-like) (Design Decision M.5)
    - Positive indices: `[0]`, `[1]`, `[n-1]`
    - Negative indices: `[-1]`, `[-2]`
    - Out-of-range positive: `[10]` on 3-element array → `IndexOutOfRange`
    - Out-of-range negative: `[-5]` on 3-element array → `IndexOutOfRange`
    - Empty array: `[0]` → `IndexOutOfRange`, `[*]` → empty list (valid)

**Phase 8.1b Deliverables:**
- [x] `arbors-query` crate compiles
- [x] Single-tree evaluation works for all expression types
- [x] Path migration complete (PathExpr is canonical)
- [x] Index semantics are strict (out-of-range → error, not Null)
- [x] 57 unit tests pass (23 in crate + 34 integration tests)

---

## Phase 8.2 – Logical Plan & Inference (Rust)

**Goal:** Build the DAG representation and shape/type inference layer.

**Key Concepts:** Section G (Logical Expression Plan), Section B.3 (Cardinality and Shape), Section J (Expression Algebra)

### 8.2.1 Define Shape and Cardinality Types

File: `crates/arbors-expr/src/shape.rs`

**Reference:** Section B.3 (Cardinality and Shape)

- [x] Define `Cardinality` enum:
  ```rust
  #[derive(Debug, Clone, Copy, PartialEq, Eq)]
  pub enum Cardinality {
      Scalar,   // 0-1 values
      Vector,   // 0-N values
  }
  ```
- [x] Define `Shape` enum:
  ```rust
  #[derive(Debug, Clone, PartialEq)]
  pub enum Shape {
      Scalar(ArborsType),
      List(Box<Shape>),
      Struct(Vec<(String, Shape)>),
      Unknown,  // when type cannot be inferred
  }
  ```
- [x] Implement `Shape::is_bool() -> bool`
- [x] Implement `Shape::element_type() -> Option<&Shape>` (for lists)

### 8.2.2 Define LogicalPlan Types

File: `crates/arbors-expr/src/plan.rs`

**Reference:** Section G.1 (LogicalExpr Node), Section K.2 (Stage 2: Logical Plan)

- [x] Define `ExprId`:
  ```rust
  #[derive(Debug, Clone, Copy, Hash, Eq, PartialEq)]
  pub struct ExprId(pub u32);
  ```
- [x] Define `LogicalExpr`:
  ```rust
  pub struct LogicalExpr {
      pub id: ExprId,
      pub kind: Expr,
      pub children: Vec<ExprId>,
      pub ty: Option<ArborsType>,
      pub shape: Option<Shape>,
      pub cardinality: Option<Cardinality>,
  }
  ```
- [x] Define `LogicalPlan`:
  ```rust
  pub struct LogicalPlan {
      nodes: HashMap<ExprId, LogicalExpr>,
      roots: Vec<ExprId>,
      next_id: u32,
  }
  ```
- [x] Implement `LogicalPlan::new() -> Self`
- [x] Implement `LogicalPlan::add_expr(expr: Expr) -> ExprId`:
  - Recursively add children first
  - Assign `ExprId`, store in map
  - Return root id
- [x] Implement `LogicalPlan::get(&self, id: ExprId) -> Option<&LogicalExpr>`

### 8.2.3 Implement Shape Inference

File: `crates/arbors-expr/src/infer.rs`

**Reference:** Section G.2 (Shape + Cardinality Inference), Section B.3 (Cardinality propagation table)

- [x] Implement `infer_shapes(plan: &mut LogicalPlan) -> Result<(), ExprError>`:
  - Topological sort of expression DAG
  - For each node (bottom-up), infer shape from children:
    - `Path` without wildcard → Scalar (Section J.5)
    - `Path` with wildcard → Vector (Section J.5)
    - `Literal` → Scalar
    - `Add/Sub/Mul/Div` → match children cardinality (Section J.4)
    - `Comparison` → preserve cardinality, type = Bool
    - `Sum/Mean/Min/Max` → Scalar (reduces vector) (Section J.3)
    - `Count` → Scalar Int64
    - `Any/All` → Scalar Bool
    - `List` → always Vector
    - `Struct` → Struct shape
- [x] Implement cardinality propagation rules from Section B.3
- [x] Detect and error on invalid combinations (Section J.4)

### 8.2.4 Implement Filter Validation

File: `crates/arbors-expr/src/validate.rs`

**Reference:** Section E (Filter Semantics)

- [x] Implement `validate_filter_expr(plan: &LogicalPlan, expr_id: ExprId) -> Result<(), ExprError>`:
  - Check that result shape is `Scalar(Bool)`
  - Error if Vector or non-bool
  - Provide clear error message suggesting `.any()` or `.all()` (Section E.1)

### 8.2.5 Tests for Phase 8.2

- [x] `plan_building.rs`: DAG construction (Section G) - implemented as inline tests in plan.rs
- [x] `infer_shapes.rs`: Shape inference for all expression types (Section G.2) - implemented as inline tests in infer.rs
- [x] `infer_cardinality.rs`: Cardinality propagation (Section B.3) - implemented as inline tests in shape.rs and infer.rs
- [x] `validate_filter.rs`: Filter validation with good error messages (Section E) - implemented as inline tests in validate.rs

**Phase 8.2 Deliverables:**
- [x] `LogicalPlan` type complete
- [x] Shape inference works for all expression types
- [x] Filter validation catches cardinality errors
- [x] 65+ additional tests pass (shape: 12, plan: 15, infer: 24, validate: 17)

---

## Phase 8.3 – Python Expression API

**Goal:** Expose expressions to Python with Polars-like ergonomics.

**Key Concepts:** Section F (Expression Design), Section H (Tree-Building Expressions)

### 8.3.1 Python Expr Class

File: `python/src/lib.rs` (add to existing)

**Reference:** Section F.1 (Expr variants define what methods to expose)

- [x] Define `PyExpr` wrapper:
  ```rust
  #[pyclass(name = "Expr")]
  pub struct PyExpr {
      inner: Expr,
  }
  ```
- [x] Implement `#[new]` (private, users use builders)
- [x] Implement arithmetic operators (Section F.1, Arithmetic):
  ```rust
  #[pymethods]
  impl PyExpr {
      fn __add__(&self, other: &PyExpr) -> PyExpr { ... }
      fn __sub__(&self, other: &PyExpr) -> PyExpr { ... }
      fn __mul__(&self, other: &PyExpr) -> PyExpr { ... }
      fn __truediv__(&self, other: &PyExpr) -> PyExpr { ... }
      fn __neg__(&self) -> PyExpr { ... }
  }
  ```
- [x] Implement comparison operators (Section F.1, Comparison):
  ```rust
  fn __eq__(&self, other: &PyExpr) -> PyExpr { ... }  // Note: returns Expr, not bool
  fn __ne__(&self, other: &PyExpr) -> PyExpr { ... }
  fn __lt__(&self, other: &PyExpr) -> PyExpr { ... }
  fn __le__(&self, other: &PyExpr) -> PyExpr { ... }
  fn __gt__(&self, other: &PyExpr) -> PyExpr { ... }
  fn __ge__(&self, other: &PyExpr) -> PyExpr { ... }
  ```
- [x] Implement logical operators (Section F.1, Logical):
  ```rust
  fn __and__(&self, other: &PyExpr) -> PyExpr { ... }  // Python uses & for bitwise, but we use for logical
  fn __or__(&self, other: &PyExpr) -> PyExpr { ... }
  fn __invert__(&self) -> PyExpr { ... }  // ~expr for NOT
  ```
- [x] Implement aggregation methods (Section F.1, Aggregations):
  ```rust
  fn sum(&self) -> PyExpr { ... }
  fn count(&self) -> PyExpr { ... }
  fn mean(&self) -> PyExpr { ... }
  fn min(&self) -> PyExpr { ... }
  fn max(&self) -> PyExpr { ... }
  fn any(&self) -> PyExpr { ... }
  fn all(&self) -> PyExpr { ... }
  fn first(&self) -> PyExpr { ... }
  fn last(&self) -> PyExpr { ... }
  ```
- [x] Implement utility methods:
  ```rust
  fn len(&self) -> PyExpr { ... }
  fn is_null(&self) -> PyExpr { ... }
  fn is_not_null(&self) -> PyExpr { ... }
  fn alias(&self, name: &str) -> PyExpr { ... }
  ```
- [x] Implement string accessor via `PyExprStrAccessor` (Section F.1, String Ops):
  ```rust
  #[pyclass]
  pub struct PyExprStrAccessor { expr: Expr }

  #[pymethods]
  impl PyExprStrAccessor {
      fn contains(&self, pattern: &str) -> PyExpr { ... }
      fn starts_with(&self, prefix: &str) -> PyExpr { ... }
      fn ends_with(&self, suffix: &str) -> PyExpr { ... }
      fn to_lower(&self) -> PyExpr { ... }
      fn to_upper(&self) -> PyExpr { ... }
  }

  impl PyExpr {
      #[getter]
      fn str(&self) -> PyExprStrAccessor { ... }
  }
  ```

### 8.3.2 Python Builder Functions

File: `python/src/lib.rs` and `python/arbors/__init__.py`

**Reference:** Section H.1 (struct() and list() in Python)

- [x] Add module-level functions:
  ```rust
  #[pyfunction]
  fn path(path_str: &str) -> PyResult<PyExpr> { ... }

  #[pyfunction]
  fn lit(value: PyObject) -> PyResult<PyExpr> { ... }  // Handle Python int/float/str/bool/None

  #[pyfunction]
  fn list_(exprs: Vec<PyExpr>) -> PyExpr { ... }  // list_ to avoid Python keyword

  #[pyfunction]
  fn struct_(kwargs: HashMap<String, PyExpr>) -> PyExpr { ... }

  #[pyfunction]
  fn when(condition: PyExpr) -> PyWhenBuilder { ... }
  ```
- [x] Implement `PyWhenBuilder` for chained conditionals (Section F.1, Conditional):
  ```rust
  #[pyclass]
  pub struct PyWhenBuilder { condition: Expr, then_expr: Option<Expr> }

  #[pymethods]
  impl PyWhenBuilder {
      fn then(&mut self, value: PyExpr) -> PyWhenBuilder { ... }
      fn otherwise(&self, value: PyExpr) -> PyExpr { ... }
  }
  ```
- [x] Export from `python/arbors/__init__.py`:
  ```python
  from ._arbors import path, lit, list_, struct_, when, Expr
  ```

### 8.3.3 Coercion for Python Primitives

File: `python/src/lib.rs`

- [x] Implement `impl IntoPyExpr for various types`:
  - Allow `path("age") > 21` (int coerced to `lit(21)`)
  - Allow `path("name") == "Alice"` (str coerced to `lit("Alice")`)
  - Use PyO3's `FromPyObject` trait for automatic coercion
- [x] Handle right-hand comparisons:
  - `__radd__`, `__rsub__`, `__rmul__`, `__rtruediv__`
  - `__req__`, `__rne__`, `__rlt__`, `__rle__`, `__rgt__`, `__rge__`

### 8.3.4 Update Type Stubs

File: `python/arbors/_arbors.pyi`

- [x] Add `Expr` class with all methods
- [x] Add `path()`, `lit()`, `list_()`, `struct_()`, `when()` functions
- [x] Document return types and parameters
- [x] Add examples in docstrings

### 8.3.5 Python Tests for Expressions

File: `python/tests/test_expr.py`

**Reference:** Section H.1 for struct/list examples

- [x] Test expression building:
  ```python
  def test_path_expr():
      e = path("user.name")
      assert e is not None

  def test_arithmetic():
      e = path("a") + path("b")
      e = path("x") * 2

  def test_comparison():
      e = path("age") > 21
      e = path("name") == "Alice"

  def test_logical():
      e = (path("age") > 21) & (path("active") == True)

  def test_aggregations():
      e = path("items[*].price").sum()
      e = path("scores[*]").mean()

  def test_struct_building():
      e = struct_(name=path("user.name"), total=path("items[*].price").sum())
  ```

**Phase 8.3 Deliverables:**
- [x] `PyExpr` class with all operators
- [x] Builder functions: `path()`, `lit()`, `list_()`, `struct_()`, `when()`
- [x] Automatic coercion of Python primitives
- [x] Updated type stubs
- [x] 40+ Python expression tests pass (132 tests)

---

## Phase 8.4 – Query Operations

**Goal:** Implement `filter()`, `select()`, `with_column()`, `agg()` on Arbor and Tree.

**Key Concepts:** Section I (Query Operations), Section E (Filter Semantics), Section C (Fractal Scope Rule)

**Note:** All query operations live in `arbors-query` crate, not `arbors-storage`.

### 8.4.1 Arbor.filter() (Rust)

File: `crates/arbors-query/src/ops.rs`

**Reference:** Section E.1 (Arbor.filter semantics), Section I.1

- [x] Add `filter(arbor: &Arbor, expr: &Expr) -> Result<Arbor, ExprError>`:
  ```rust
  pub fn filter(arbor: &Arbor, expr: &Expr) -> Result<Arbor, ExprError> {
      // 1. Build LogicalPlan, run inference (Section G)
      // 2. Validate: must be scalar bool (Section E.1)
      // 3. For each tree, evaluate expr (Section K.4)
      // 4. Keep trees where result is Scalar(Bool(true))
      // 5. Build new Arbor with filtered trees
  }
  ```
- [x] Handle null → false (documented behavior, Section E.1)
- [x] Return clear error if expression yields vector (Section E.1)

### 8.4.2 Arbor.select() (Rust)

File: `crates/arbors-query/src/ops.rs`

**Reference:** Section I.2 (Arbor.select semantics), Section H.2 (select with struct/list)

- [x] Add `select(arbor: &Arbor, exprs: &[Expr]) -> Result<Arbor, ExprError>`:
  ```rust
  pub fn select(arbor: &Arbor, exprs: &[Expr]) -> Result<Arbor, ExprError> {
      // 1. Build LogicalPlan for all exprs (Section G)
      // 2. For each tree:
      //    a. Evaluate each expr (Section K.4)
      //    b. Build new tree from ExprResults (Section H)
      //    c. Use alias names as field names
      // 3. Return new Arbor with transformed trees
  }
  ```
- [x] Helper: `expr_result_to_tree(result: &ExprResult, alias: &str) -> Tree`

### 8.4.3 Arbor.with_column() (Rust)

File: `crates/arbors-query/src/ops.rs`

**Reference:** Section I.3 (Arbor.with_column semantics)

- [x] Add `with_column(arbor: &Arbor, name: &str, expr: &Expr) -> Result<Arbor, ExprError>`:
  ```rust
  pub fn with_column(arbor: &Arbor, name: &str, expr: &Expr) -> Result<Arbor, ExprError> {
      // 1. Evaluate expr for each tree (Section K.4)
      // 2. Add/replace field `name` with result
      // 3. Return new Arbor
  }
  ```

### 8.4.4 Arbor.agg() (Rust)

File: `crates/arbors-query/src/ops.rs`

**Reference:** Section I.4 (Arbor.agg semantics)

- [x] Add `agg(arbor: &Arbor, exprs: &[Expr]) -> Result<Tree, ExprError>`:
  ```rust
  pub fn agg(arbor: &Arbor, exprs: &[Expr]) -> Result<Tree, ExprError> {
      // 1. For each expr:
      //    a. Evaluate across ALL trees (not per-tree)
      //    b. Collect all values, then aggregate
      // 2. Build single result tree with alias names as fields
  }
  ```

**Agg Semantics (Clarified):**

`Arbor.agg()` differs from per-tree evaluation. It conceptually **flattens** values across all trees before aggregating:

```
arbor = [
    {"scores": [10, 20]},     // tree 0
    {"scores": [30]},         // tree 1
    {"scores": [40, 50, 60]}  // tree 2
]

# path("scores[*]").sum() in agg context:
# 1. Gather ALL scores from ALL trees: [10, 20, 30, 40, 50, 60]
# 2. Sum them: 210

# path("scores[*]").mean() in agg context:
# 1. Gather ALL scores: [10, 20, 30, 40, 50, 60]
# 2. Mean: 35.0

# path("scores[*]").count() in agg context:
# 1. Count all non-null scores across all trees: 6
```

**Implementation options:**
- **Option A (Eager):** Evaluate per tree, pool results in Rust, then reduce
- **Option B (Global):** Treat as special evaluation mode with "global context"

Either approach works. Phase 8 will use Option A (simpler). Phase 10+ may optimize.

- [x] Aggregation semantics (Section J.3, Design Decision M.3):
  - `sum` → sum all values from all trees
  - `count` → count all non-null values across all trees
  - `mean` → mean across all trees (sum / count)
  - `min` → min across all trees
  - `max` → max across all trees
  - `any` → any true across all trees
  - `all` → all true across all trees

### 8.4.5 Tree.filter() (Rust)

File: `crates/arbors-query/src/tree_ops.rs`

**Reference:** Section E.2 (Tree.filter semantics), Section C (Fractal Scope Rule), Section D context 3

- [x] Add `tree_filter(arbor: &Arbor, tree_idx: usize, array_path: &str, expr: &Expr) -> Result<Tree, ExprError>`:
  ```rust
  pub fn tree_filter(arbor: &Arbor, tree_idx: usize, array_path: &str, expr: &Expr) -> Result<Tree, ExprError> {
      // 1. Navigate to array at array_path within tree
      // 2. For each element, evaluate expr with @ bound to element (Section D, context 3)
      // 3. Keep elements where result is Scalar(Bool(true))
      // 4. Return new tree with filtered array
  }
  ```
- [x] Implement per-element evaluation context (set `ctx.current` to array element NodeId)

### 8.4.6 Python Query Methods

File: `python/src/lib.rs`

**Reference:** Section I (Query Operations)

- [x] Add to `PyArbor`:
  ```rust
  fn filter(&self, expr: &PyExpr) -> PyResult<PyArbor> { ... }
  fn select(&self, exprs: Vec<PyExpr>) -> PyResult<PyArbor> { ... }
  fn with_column(&self, name: &str, expr: &PyExpr) -> PyResult<PyArbor> { ... }
  fn agg(&self, exprs: Vec<PyExpr>) -> PyResult<PyTree> { ... }
  ```
- [x] Add to `PyTree`:
  ```rust
  fn filter(&self, array_path: &str, expr: &PyExpr) -> PyResult<PyTree> { ... }
  fn select(&self, exprs: Vec<PyExpr>) -> PyResult<PyTree> { ... }
  fn eval(&self, expr: &PyExpr) -> PyResult<PyObject> { ... }  // Return Python value
  ```

### 8.4.7 Update Type Stubs

File: `python/arbors/_arbors.pyi`

- [x] Add methods to `Arbor` class:
  ```python
  def filter(self, expr: Expr) -> Arbor: ...
  def select(self, exprs: list[Expr]) -> Arbor: ...
  def with_column(self, name: str, expr: Expr) -> Arbor: ...
  def agg(self, exprs: list[Expr]) -> Tree: ...
  ```
- [x] Add methods to `Tree` class:
  ```python
  def filter(self, array_path: str, expr: Expr) -> Tree: ...
  def select(self, exprs: list[Expr]) -> Tree: ...
  def eval(self, expr: Expr) -> Any: ...
  ```

### 8.4.8 Integration Tests

File: `python/tests/test_query.py`

**Reference:** Section E (Filter Semantics), Section I (Query Operations), Section H.2 (select examples)

- [x] Test filter (Section E.1):
  ```python
  def test_filter_basic():
      arbor = aq.read_jsonl('{"age": 30}\n{"age": 20}\n{"age": 25}')
      result = arbor.filter(path("age") > 21)
      assert len(result) == 2

  def test_filter_with_any():
      arbor = aq.read_jsonl('{"items": [{"price": 10}, {"price": 200}]}')
      result = arbor.filter((path("items[*].price") > 100).any())
      assert len(result) == 1
  ```
- [x] Test select (Section I.2, Section H.2):
  ```python
  def test_select_basic():
      arbor = aq.read_jsonl('{"user": {"name": "Alice", "age": 30}}')
      result = arbor.select([path("user.name").alias("name")])
      # result[0] should be {"name": "Alice"}

  def test_select_with_struct():
      result = arbor.select([
          struct_(name=path("user.name"), total=path("items[*].price").sum())
      ])
  ```
- [x] Test with_column (Section I.3):
  ```python
  def test_with_column():
      arbor = aq.read_jsonl('{"items": [{"price": 10}, {"price": 20}]}')
      result = arbor.with_column("total", path("items[*].price").sum())
      assert result[0].path("total").value == 30
  ```
- [x] Test agg (Section I.4):
  ```python
  def test_agg():
      arbor = aq.read_jsonl('{"age": 30}\n{"age": 20}\n{"age": 25}')
      result = arbor.agg([path("age").mean().alias("avg_age")])
      assert result.path("avg_age").value == 25.0
  ```
- [x] Test Tree.filter (Section E.2):
  ```python
  def test_tree_filter():
      arbor = aq.read_jsonl('{"items": [{"price": 10}, {"price": 200}]}')
      tree = arbor[0]
      filtered = tree.filter("items", path("@.price") > 50)
      # filtered should have only the {price: 200} item
  ```

**Phase 8.4 Deliverables:**
- [x] `Arbor.filter()`, `select()`, `with_column()`, `agg()` work
- [x] `Tree.filter()` works with `@` reference
- [x] Python methods exposed
- [x] Type stubs updated
- [x] 50+ integration tests pass

---

## Phase 8.5 – Error Handling & Polish

**Goal:** Production-quality error messages and edge case handling.

**Key Concepts:** Section J (Expression Algebra for edge cases), Section E (Filter Semantics for error messages)

### 8.5.1 Error Messages

**Reference:** Section E.1 (filter error example suggesting `.any()`)

- [x] All errors include:
  - Path to the problematic expression
  - Expected vs actual type/cardinality
  - Suggestion for fix (e.g., "use `.any()` to reduce to scalar")
- [x] Create custom exception types in Python:
  - `ArborsError` (base)
  - `TypeMismatchError`
  - `CardinalityError`
  - `PathNotFoundError`

### 8.5.2 Edge Cases

**Reference:** Design Decision M.3 (empty aggregations), Section J.2 (null propagation)

- [x] Empty arbor → empty result for filter/select, null for agg
- [x] Empty array in path → empty list result (Section J.5)
- [x] Missing field → Null propagation (Design Decision M.2)
- [x] Division by zero → Error (ValueError in Python)
- [x] Type coercion edge cases (int + float → float) (Section J.4)

### 8.5.3 Documentation

- [x] Docstrings for all Python methods
- [x] Update README with expression examples
- [x] Add `examples/expressions.py` with common patterns

**Phase 8.5 Deliverables:**
- [x] Clear, actionable error messages
- [x] All edge cases handled
- [x] Documentation complete

---

## Phase 8.5.4 – Backfill: Missing Pieces (Audit Recovery)

**Goal:** Address gaps discovered during post-Phase-8 audit.

**Background:** During review, the following items were found incomplete:

### 8.5.4.1 Python Acceptance Tests (Section Q)

**Reference:** Section Q (Example Programs)

The Python acceptance tests in `python/tests/test_expr_acceptance.py` are all marked with `@pytest.mark.skip(reason="expression system not yet implemented")`. The expression system IS now implemented, but these tests were never enabled.

- [x] Remove `@pytest.mark.skip` decorators from all 31 tests
- [x] Update tests to use current API (`read_jsonl(data)` with file reading, not `read_jsonl_file(path)`)
- [x] Verify all Q.1-Q.10 test cases pass (31 passed, 1 skipped for Phase 9)
- [x] Handle any API differences between spec and implementation:
  - `filter()` returns `QueryResult` with `.indices` property, not an Arbor
  - `with_column()` returns `list[dict]`, not chainable Arbor
  - `struct_()` inside `agg()` evaluates per-tree, not as cross-tree aggregate

**Note:** The Section Q spec shows `aq.read_jsonl_file(path)` but the actual API is `aq.read_jsonl(data: str | bytes)`. Tests should read files manually, then call `read_jsonl()`.

### 8.5.4.2 Rust Acceptance Tests

**Reference:** Section Q (Example Programs)

- [x] Rust acceptance tests in `crates/arbors/tests/expr_acceptance.rs` were placeholder stubs
- [x] Implemented all Q.1-Q.10 tests with actual API calls
- [x] 22 tests pass, 2 ignored (filter path syntax `[?expr]` is Phase 9)

### 8.5.4.3 PathSegment::Filter Parsing (Deferred to Phase 9)

**Reference:** Section F.2 (Path Expressions), Phase 8.1.5 checkbox

`PathSegment::Filter` currently stores `String` (the unparsed filter expression) rather than `Box<Expr>`. This was explicitly deferred in Phase 8.1.5.

- [ ] (Phase 9) Parse filter expressions in paths like `items[?@.active]`
- [ ] (Phase 9) Support `Box<Expr>` in `PathSegment::Filter`

**Current behavior:** Filter path syntax `[?expr]` parses but stores the expression as a string. Evaluation of filter paths works via string-based expression parsing at eval time.

**Phase 8.5.4 Deliverables:**
- [x] Python acceptance tests enabled and passing (31 passed, 1 skipped for Phase 9)
- [x] Rust acceptance tests implemented and passing (22 passed, 2 ignored for Phase 9)
- [x] Audit complete, gaps documented

---

## Phase 9 – Extended Expression Library

**Goal:** Expand expression capabilities for production use.

**Key Concepts:** Section F (Expression Design – extending the Expr enum), Section H (Tree-Building Expressions)

### 9.1 Date/Time Operations

- [x] `Expr::Year(Box<Expr>)`, `Month`, `Day`, `Hour`, `Minute`, `Second`
- [x] `Expr::DateTrunc(Box<Expr>, TimeUnit)` (day, week, month, year)
- [x] `Expr::DateAdd(Box<Expr>, Box<Expr>, TimeUnit)` *(note: changed from `i64` to `Box<Expr>` for runtime expression support)*
- [x] `Expr::DateDiff(Box<Expr>, Box<Expr>)` → Duration
- [x] Python: `.dt` accessor (like Polars)

---

### 9.1.5 Date/Time Audit and Cleanup

**Goal:** Audit the Phase 9.1 implementation, document the proper design, and clean up any issues.

**Background:** The initial Phase 9.1 implementation encountered numerous issues:
- Type storage mismatches between `Value` enum and wrapper types
- API name confusion between different temporal type methods
- Missing dependencies in Cargo.toml
- Non-exhaustive pattern matches in inference and plan modules

This section documents the **intended design** for date/time operations.

#### 9.1.5.1 Temporal Type Architecture

Arbors has a layered temporal type system:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Python Layer                                │
│  datetime.date  ←→  datetime.datetime  ←→  datetime.timedelta   │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                     Expression Layer (arbors-expr)              │
│  Value::Date(i32)   Value::DateTime(i64)   Value::Duration(i64) │
│  (days since epoch) (micros since epoch)   (microseconds)       │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────────────────────┐
│                     Wrapper Types (arbors-schema/temporal.rs)             │
│  Date { days: i32 }   DateTime { micros: i64 }   Duration { micros: i64 } │
│  • ISO 8601 parsing/formatting                                            │
│  • Component extraction (year, month, day, etc.)                          │
│  • Chrono integration                                                     │
└───────────────────────────────────────────────────────────────────────────┘
```

**Key Principle:** `Value::Date/DateTime/Duration` store **raw numeric values** only. The wrapper types in `arbors-schema::temporal` provide parsing, formatting, and component extraction.

#### 9.1.5.2 Value Type Storage

| Value Variant | Storage | Meaning |
|--------------|---------|---------|
| `Value::Date(i32)` | i32 | Days since Unix epoch (1970-01-01) |
| `Value::DateTime(i64)` | i64 | Microseconds since Unix epoch (UTC) |
| `Value::Duration(i64)` | i64 | Microseconds (signed, can be negative) |

These match Arrow's temporal types:
- `Date32`: i32 days
- `Timestamp(Microsecond, UTC)`: i64 microseconds
- `Duration(Microsecond)`: i64 microseconds

#### 9.1.5.3 Wrapper Type API

The `arbors-schema::temporal` module provides:

```rust
// Date (days since epoch)
Date::from_days_since_epoch(days: i32) -> Date
Date::days_since_epoch(&self) -> i32
Date::from_iso(s: &str) -> Result<Date, TemporalError>
Date::to_iso(&self) -> String
Date::year(&self) -> i32
Date::month(&self) -> u32
Date::day(&self) -> u32

// DateTime (microseconds since epoch, UTC)
DateTime::from_micros_since_epoch(micros: i64) -> DateTime
DateTime::micros_since_epoch(&self) -> i64
DateTime::from_iso(s: &str) -> Result<DateTime, TemporalError>
DateTime::to_iso(&self) -> String
DateTime::year(&self) -> i32
DateTime::month(&self) -> u32
DateTime::day(&self) -> u32
DateTime::hour(&self) -> u32
DateTime::minute(&self) -> u32
DateTime::second(&self) -> u32

// Duration (microseconds)
Duration::from_micros(micros: i64) -> Duration
Duration::total_micros(&self) -> i64
Duration::from_iso(s: &str) -> Result<Duration, TemporalError>  // PT format only
Duration::to_iso(&self) -> String
Duration::hours(&self) -> i64
Duration::minutes(&self) -> i64
Duration::seconds(&self) -> i64
```

#### 9.1.5.4 Evaluation Pattern

When evaluating date/time expressions, the pattern is:

```rust
// In eval.rs - extracting a component
fn extract_year(value: &Value) -> Result<Value, ExprError> {
    match value {
        Value::Date(days) => {
            // Convert raw value to wrapper type for component access
            let d = Date::from_days_since_epoch(*days);
            Ok(Value::Int64(d.year() as i64))
        }
        Value::DateTime(micros) => {
            let dt = DateTime::from_micros_since_epoch(*micros);
            Ok(Value::Int64(dt.year() as i64))
        }
        Value::Null => Ok(Value::Null),
        _ => Err(ExprError::TypeMismatch { ... })
    }
}
```

**Critical:** Never assume `Value::Date` contains a `Date` struct. It contains `i32` (raw days).

#### 9.1.5.5 DateAdd Signature Change

The original spec said `Expr::DateAdd(Box<Expr>, i64, TimeUnit)`, but we implemented:

```rust
Expr::DateAdd(Box<Expr>, Box<Expr>, TimeUnit)
//           ^date/time  ^amount     ^unit
```

This allows the amount to be a runtime expression, not just a compile-time constant:

```python
# Both of these work:
path("timestamp").dt.add(lit(7), TimeUnit.Day)       # Add 7 days (literal)
path("timestamp").dt.add(path("offset"), TimeUnit.Day)  # Add dynamic offset
```

#### 9.1.5.6 DateAdd/DateTrunc Approximations

For `Year` and `Month` units, calendar arithmetic is approximate:

| Unit | DateAdd Approximation | DateTrunc Behavior |
|------|----------------------|-------------------|
| Year | 365.25 days (accounts for leap years) | Start of calendar year |
| Month | 30.44 days (average month length) | Start of calendar month |
| Week | 7 days exactly | Start of ISO week (Monday) |
| Day | 24 hours exactly | Midnight UTC |
| Hour/Minute/Second | Exact | Truncate to unit boundary |

For precise calendar arithmetic (accounting for actual month lengths, leap years), a future enhancement could use chrono's `Months` and `Years` duration types.

#### 9.1.5.7 Python `.dt` Accessor

The Python binding exposes date/time operations via a `.dt` accessor:

```python
from arbors import path, lit, TimeUnit

# Component extraction
path("created_at").dt.year()      # → Int64
path("created_at").dt.month()     # → Int64 (1-12)
path("created_at").dt.day()       # → Int64 (1-31)
path("created_at").dt.hour()      # → Int64 (0-23)
path("created_at").dt.minute()    # → Int64 (0-59)
path("created_at").dt.second()    # → Int64 (0-59)

# Truncation
path("timestamp").dt.truncate(TimeUnit.Day)    # → DateTime at midnight
path("timestamp").dt.truncate(TimeUnit.Month)  # → DateTime at start of month

# Arithmetic
path("timestamp").dt.add(lit(7), TimeUnit.Day)   # → DateTime + 7 days
path("timestamp").dt.add(lit(-1), TimeUnit.Hour) # → DateTime - 1 hour

# Difference
path("end_time").dt.diff(path("start_time"))  # → Duration (microseconds)
```

#### 9.1.5.8 Cleanup Checklist

- [x] Audit: Verify all date/time tests pass with correct semantics
- [x] Audit: Verify Value::Date/DateTime/Duration store raw values only
- [x] Audit: Verify wrapper types are only used for computation, not storage
- [x] Audit: Document any remaining approximations in DateAdd
- [x] Audit: Ensure Python datetime/date/timedelta conversion is correct
- [x] Audit: Review type inference for date/time expressions

**Phase 9.1.5 Deliverables:**
- [x] This design document completed and reviewed
- [x] All existing tests continue to pass
- [x] Any identified issues fixed

---

### 9.2 String Operations (Extended)

**Goal:** Extend the existing string operations with substring extraction, replacement, splitting/joining, and regex support.

**Reference:** Section F.1 (String Ops section)

#### 9.2.1 Current State

The following string operations are already implemented:

| Operation | Expr Variant | Python API | Status |
|-----------|--------------|------------|--------|
| Contains | `Contains(Box<Expr>, Box<Expr>)` | `path("x").str.contains("y")` | ✓ Done |
| Starts With | `StartsWith(Box<Expr>, Box<Expr>)` | `path("x").str.starts_with("y")` | ✓ Done |
| Ends With | `EndsWith(Box<Expr>, Box<Expr>)` | `path("x").str.ends_with("y")` | ✓ Done |
| To Lower | `ToLower(Box<Expr>)` | `path("x").str.lower()` | ✓ Done |
| To Upper | `ToUpper(Box<Expr>)` | `path("x").str.upper()` | ✓ Done |
| Trim | `Trim(Box<Expr>)` | `path("x").str.strip()` | ✓ Done |
| Trim Start | `TrimStart(Box<Expr>)` | `path("x").str.lstrip()` | ✓ Done |
| Trim End | `TrimEnd(Box<Expr>)` | `path("x").str.rstrip()` | ✓ Done |
| String Length | `Len(Box<Expr>)` | `path("x").str.len()` | ✓ Done |

#### 9.2.2 New Expr Variants

File: `crates/arbors-expr/src/expr.rs`

- [ ] Add `Substring` variant:
  ```rust
  /// Extract substring from start index with optional length
  /// Indices are 0-based, negative indices count from end (Python-like)
  Substring {
      string: Box<Expr>,
      start: Box<Expr>,      // i64, negative allowed
      length: Option<Box<Expr>>,  // None means "to end"
  },
  ```
- [ ] Add `Replace` variant:
  ```rust
  /// Replace all occurrences of pattern with replacement
  Replace {
      string: Box<Expr>,
      pattern: Box<Expr>,
      replacement: Box<Expr>,
  },
  ```
- [ ] Add `Split` variant:
  ```rust
  /// Split string by delimiter into list of strings
  Split {
      string: Box<Expr>,
      delimiter: Box<Expr>,
  },
  ```
- [ ] Add `Join` variant:
  ```rust
  /// Join list of strings with delimiter
  Join {
      list: Box<Expr>,
      delimiter: Box<Expr>,
  },
  ```
- [ ] Add `RegexMatch` variant:
  ```rust
  /// Check if string matches regex pattern (returns bool)
  RegexMatch {
      string: Box<Expr>,
      pattern: String,  // Compile-time pattern for efficiency
  },
  ```
- [ ] Add `RegexExtract` variant:
  ```rust
  /// Extract capture group from regex match (returns string or null)
  RegexExtract {
      string: Box<Expr>,
      pattern: String,
      group: usize,  // 0 = entire match, 1+ = capture groups
  },
  ```
- [ ] Add `RegexReplace` variant:
  ```rust
  /// Replace regex matches with replacement string
  RegexReplace {
      string: Box<Expr>,
      pattern: String,
      replacement: Box<Expr>,
  },
  ```

#### 9.2.3 Expr Builder Methods

File: `crates/arbors-expr/src/expr.rs`

- [ ] Add builder methods to `impl Expr`:
  ```rust
  /// Extract substring starting at `start` with optional `length`
  pub fn substring(self, start: Expr, length: Option<Expr>) -> Expr {
      Expr::Substring {
          string: Box::new(self),
          start: Box::new(start),
          length: length.map(Box::new),
      }
  }

  /// Replace all occurrences of pattern with replacement
  pub fn replace(self, pattern: Expr, replacement: Expr) -> Expr {
      Expr::Replace {
          string: Box::new(self),
          pattern: Box::new(pattern),
          replacement: Box::new(replacement),
      }
  }

  /// Split string by delimiter
  pub fn split(self, delimiter: Expr) -> Expr {
      Expr::Split {
          string: Box::new(self),
          delimiter: Box::new(delimiter),
      }
  }

  /// Join list elements with delimiter
  pub fn join(self, delimiter: Expr) -> Expr {
      Expr::Join {
          list: Box::new(self),
          delimiter: Box::new(delimiter),
      }
  }

  /// Check if string matches regex pattern
  pub fn regex_match(self, pattern: &str) -> Expr {
      Expr::RegexMatch {
          string: Box::new(self),
          pattern: pattern.to_string(),
      }
  }

  /// Extract regex capture group
  pub fn regex_extract(self, pattern: &str, group: usize) -> Expr {
      Expr::RegexExtract {
          string: Box::new(self),
          pattern: pattern.to_string(),
          group,
      }
  }

  /// Replace regex matches
  pub fn regex_replace(self, pattern: &str, replacement: Expr) -> Expr {
      Expr::RegexReplace {
          string: Box::new(self),
          pattern: pattern.to_string(),
          replacement: Box::new(replacement),
      }
  }
  ```

#### 9.2.4 Shape and Type Inference

File: `crates/arbors-expr/src/infer.rs`

- [ ] Add inference rules for new variants:

| Expression | Input Type | Output Type | Cardinality |
|------------|------------|-------------|-------------|
| `Substring` | String | String | Preserves input |
| `Replace` | String | String | Preserves input |
| `Split` | String | List(String) | Scalar → Vector |
| `Join` | List(String) | String | Vector → Scalar |
| `RegexMatch` | String | Bool | Preserves input |
| `RegexExtract` | String | String (nullable) | Preserves input |
| `RegexReplace` | String | String | Preserves input |

- [ ] Update `infer_type()` for each new variant
- [ ] Update `infer_cardinality()` - note `Split` produces vector, `Join` produces scalar

#### 9.2.5 LogicalPlan Integration

File: `crates/arbors-expr/src/plan.rs`

- [ ] Update `add_expr()` to handle new variants
- [ ] Ensure children are properly registered for each variant

#### 9.2.6 Evaluation Implementation

File: `crates/arbors-query/src/eval.rs`

- [ ] Implement `eval_substring()`:
  ```rust
  fn eval_substring(
      string: &Expr,
      start: &Expr,
      length: &Option<Box<Expr>>,
      ctx: &EvalContext,
  ) -> Result<ExprResult, ExprError> {
      let s = eval_expr(string, ctx)?.as_string()?;
      let start_idx = eval_expr(start, ctx)?.as_i64()?;

      // Handle negative indices (Python-like)
      let len = s.chars().count() as i64;
      let actual_start = if start_idx < 0 {
          (len + start_idx).max(0) as usize
      } else {
          start_idx.min(len) as usize
      };

      let result = match length {
          Some(len_expr) => {
              let take = eval_expr(len_expr, ctx)?.as_i64()?.max(0) as usize;
              s.chars().skip(actual_start).take(take).collect()
          }
          None => s.chars().skip(actual_start).collect(),
      };

      Ok(ExprResult::Scalar(Value::String(result)))
  }
  ```
- [ ] Implement `eval_replace()`:
  ```rust
  fn eval_replace(
      string: &Expr,
      pattern: &Expr,
      replacement: &Expr,
      ctx: &EvalContext,
  ) -> Result<ExprResult, ExprError> {
      let s = eval_expr(string, ctx)?.as_string()?;
      let pat = eval_expr(pattern, ctx)?.as_string()?;
      let rep = eval_expr(replacement, ctx)?.as_string()?;

      Ok(ExprResult::Scalar(Value::String(s.replace(&pat, &rep))))
  }
  ```
- [ ] Implement `eval_split()`:
  ```rust
  fn eval_split(
      string: &Expr,
      delimiter: &Expr,
      ctx: &EvalContext,
  ) -> Result<ExprResult, ExprError> {
      let s = eval_expr(string, ctx)?.as_string()?;
      let delim = eval_expr(delimiter, ctx)?.as_string()?;

      let parts: Vec<ExprResult> = s
          .split(&delim)
          .map(|part| ExprResult::Scalar(Value::String(part.to_string())))
          .collect();

      Ok(ExprResult::List(parts))
  }
  ```
- [ ] Implement `eval_join()`:
  ```rust
  fn eval_join(
      list: &Expr,
      delimiter: &Expr,
      ctx: &EvalContext,
  ) -> Result<ExprResult, ExprError> {
      let list_result = eval_expr(list, ctx)?;
      let delim = eval_expr(delimiter, ctx)?.as_string()?;

      let strings: Result<Vec<String>, _> = match list_result {
          ExprResult::List(items) => items
              .into_iter()
              .map(|item| item.as_string().map(|s| s.to_string()))
              .collect(),
          _ => Err(ExprError::TypeMismatch { ... }),
      };

      Ok(ExprResult::Scalar(Value::String(strings?.join(&delim))))
  }
  ```
- [ ] Implement regex operations (requires `regex` crate):
  ```rust
  fn eval_regex_match(
      string: &Expr,
      pattern: &str,
      ctx: &EvalContext,
  ) -> Result<ExprResult, ExprError> {
      let s = eval_expr(string, ctx)?.as_string()?;
      let re = Regex::new(pattern)
          .map_err(|e| ExprError::InvalidOperation(format!("invalid regex: {}", e)))?;

      Ok(ExprResult::Scalar(Value::Bool(re.is_match(&s))))
  }

  fn eval_regex_extract(
      string: &Expr,
      pattern: &str,
      group: usize,
      ctx: &EvalContext,
  ) -> Result<ExprResult, ExprError> {
      let s = eval_expr(string, ctx)?.as_string()?;
      let re = Regex::new(pattern)
          .map_err(|e| ExprError::InvalidOperation(format!("invalid regex: {}", e)))?;

      match re.captures(&s) {
          Some(caps) => match caps.get(group) {
              Some(m) => Ok(ExprResult::Scalar(Value::String(m.as_str().to_string()))),
              None => Ok(ExprResult::Null),
          },
          None => Ok(ExprResult::Null),
      }
  }

  fn eval_regex_replace(
      string: &Expr,
      pattern: &str,
      replacement: &Expr,
      ctx: &EvalContext,
  ) -> Result<ExprResult, ExprError> {
      let s = eval_expr(string, ctx)?.as_string()?;
      let rep = eval_expr(replacement, ctx)?.as_string()?;
      let re = Regex::new(pattern)
          .map_err(|e| ExprError::InvalidOperation(format!("invalid regex: {}", e)))?;

      Ok(ExprResult::Scalar(Value::String(re.replace_all(&s, rep.as_str()).to_string())))
  }
  ```

#### 9.2.7 Dependencies

File: `crates/arbors-query/Cargo.toml`

- [ ] Add `regex` dependency:
  ```toml
  [dependencies]
  regex = "1"
  ```

#### 9.2.8 Python String Accessor Extensions

File: `python/src/lib.rs`

- [ ] Extend `ExprStrAccessor` with new methods:
  ```rust
  #[pymethods]
  impl ExprStrAccessor {
      // ... existing methods ...

      /// Extract substring: str.slice(start, length)
      /// Supports negative indices (Python-like)
      #[pyo3(signature = (start, length=None))]
      fn slice(&self, start: ExprOrValue<'_>, length: Option<ExprOrValue<'_>>) -> Expr {
          Expr::new(self.expr.clone().substring(
              start.into_expr(),
              length.map(|l| l.into_expr()),
          ))
      }

      /// Replace all occurrences of pattern with replacement
      fn replace(&self, pattern: ExprOrValue<'_>, replacement: ExprOrValue<'_>) -> Expr {
          Expr::new(self.expr.clone().replace(
              pattern.into_expr(),
              replacement.into_expr(),
          ))
      }

      /// Split string by delimiter into list
      fn split(&self, delimiter: ExprOrValue<'_>) -> Expr {
          Expr::new(self.expr.clone().split(delimiter.into_expr()))
      }

      /// Join list elements with delimiter (on list expressions)
      fn join(&self, delimiter: ExprOrValue<'_>) -> Expr {
          Expr::new(self.expr.clone().join(delimiter.into_expr()))
      }

      /// Check if string matches regex pattern
      fn match_(&self, pattern: &str) -> Expr {
          Expr::new(self.expr.clone().regex_match(pattern))
      }

      /// Extract capture group from regex match
      #[pyo3(signature = (pattern, group=0))]
      fn extract(&self, pattern: &str, group: usize) -> Expr {
          Expr::new(self.expr.clone().regex_extract(pattern, group))
      }

      /// Replace regex matches with replacement
      fn replace_regex(&self, pattern: &str, replacement: ExprOrValue<'_>) -> Expr {
          Expr::new(self.expr.clone().regex_replace(pattern, replacement.into_expr()))
      }
  }
  ```

#### 9.2.9 Type Stubs

File: `python/arbors/_arbors.pyi`

- [ ] Update `ExprStrAccessor` stubs:
  ```python
  class ExprStrAccessor:
      # Existing methods
      def contains(self, pattern: str | Expr) -> Expr: ...
      def starts_with(self, prefix: str | Expr) -> Expr: ...
      def ends_with(self, suffix: str | Expr) -> Expr: ...
      def lower(self) -> Expr: ...
      def upper(self) -> Expr: ...
      def strip(self) -> Expr: ...
      def lstrip(self) -> Expr: ...
      def rstrip(self) -> Expr: ...
      def len(self) -> Expr: ...

      # New methods
      def slice(self, start: int | Expr, length: int | Expr | None = None) -> Expr:
          """Extract substring from start index with optional length.

          Supports negative indices (Python-like):
          - path("name").str.slice(0, 3)     # First 3 chars
          - path("name").str.slice(-3)        # Last 3 chars
          - path("name").str.slice(1, -1)     # Skip first, take until last
          """
          ...

      def replace(self, pattern: str | Expr, replacement: str | Expr) -> Expr:
          """Replace all occurrences of pattern with replacement."""
          ...

      def split(self, delimiter: str | Expr) -> Expr:
          """Split string by delimiter into list of strings.

          Example:
              path("tags").str.split(",")  # "a,b,c" → ["a", "b", "c"]
          """
          ...

      def join(self, delimiter: str | Expr) -> Expr:
          """Join list elements with delimiter.

          Example:
              path("parts").str.join("-")  # ["a", "b", "c"] → "a-b-c"
          """
          ...

      def match_(self, pattern: str) -> Expr:
          """Check if string matches regex pattern (returns bool).

          Example:
              path("email").str.match_(r"^[\\w.-]+@[\\w.-]+$")
          """
          ...

      def extract(self, pattern: str, group: int = 0) -> Expr:
          """Extract capture group from regex match.

          Args:
              pattern: Regex pattern with capture groups
              group: 0 for entire match, 1+ for capture groups

          Example:
              path("text").str.extract(r"(\\d+)-(\\d+)", 1)  # First group
          """
          ...

      def replace_regex(self, pattern: str, replacement: str | Expr) -> Expr:
          """Replace regex matches with replacement string.

          Example:
              path("text").str.replace_regex(r"\\s+", " ")  # Collapse whitespace
          """
          ...
  ```

#### 9.2.10 Rust Tests

File: `crates/arbors-expr/src/expr.rs` (inline tests)

- [ ] Test expression construction:
  ```rust
  #[test]
  fn test_substring_expr() {
      let e = path("name").substring(lit(0), Some(lit(3)));
      assert!(matches!(e, Expr::Substring { .. }));
  }

  #[test]
  fn test_replace_expr() {
      let e = path("text").replace(lit("foo"), lit("bar"));
      assert!(matches!(e, Expr::Replace { .. }));
  }

  #[test]
  fn test_split_expr() {
      let e = path("csv").split(lit(","));
      assert!(matches!(e, Expr::Split { .. }));
  }

  #[test]
  fn test_join_expr() {
      let e = path("parts").join(lit("-"));
      assert!(matches!(e, Expr::Join { .. }));
  }

  #[test]
  fn test_regex_match_expr() {
      let e = path("email").regex_match(r"^\w+@\w+\.\w+$");
      assert!(matches!(e, Expr::RegexMatch { .. }));
  }

  #[test]
  fn test_regex_extract_expr() {
      let e = path("text").regex_extract(r"(\d+)", 1);
      assert!(matches!(e, Expr::RegexExtract { .. }));
  }
  ```

File: `crates/arbors-query/tests/integration.rs`

- [ ] Test evaluation:
  ```rust
  #[test]
  fn test_eval_substring() {
      let arbor = read_json(r#"{"name": "Alice"}"#);
      let ctx = EvalContext::new(&arbor, arbor.root(0));

      // Basic substring
      let result = eval_expr(&path("name").substring(lit(0), Some(lit(3))), &ctx)?;
      assert_eq!(result, ExprResult::Scalar(Value::String("Ali".to_string())));

      // Negative index (last 3 chars)
      let result = eval_expr(&path("name").substring(lit(-3), None), &ctx)?;
      assert_eq!(result, ExprResult::Scalar(Value::String("ice".to_string())));
  }

  #[test]
  fn test_eval_replace() {
      let arbor = read_json(r#"{"text": "hello world"}"#);
      let ctx = EvalContext::new(&arbor, arbor.root(0));

      let result = eval_expr(&path("text").replace(lit("world"), lit("rust")), &ctx)?;
      assert_eq!(result, ExprResult::Scalar(Value::String("hello rust".to_string())));
  }

  #[test]
  fn test_eval_split() {
      let arbor = read_json(r#"{"csv": "a,b,c"}"#);
      let ctx = EvalContext::new(&arbor, arbor.root(0));

      let result = eval_expr(&path("csv").split(lit(",")), &ctx)?;
      assert!(matches!(result, ExprResult::List(_)));
      // Check contents...
  }

  #[test]
  fn test_eval_join() {
      // Requires list value in data, or use with Split result
      let arbor = read_json(r#"{"parts": ["a", "b", "c"]}"#);
      let ctx = EvalContext::new(&arbor, arbor.root(0));

      let result = eval_expr(&path("parts").join(lit("-")), &ctx)?;
      assert_eq!(result, ExprResult::Scalar(Value::String("a-b-c".to_string())));
  }

  #[test]
  fn test_eval_regex_match() {
      let arbor = read_json(r#"{"email": "test@example.com"}"#);
      let ctx = EvalContext::new(&arbor, arbor.root(0));

      let result = eval_expr(&path("email").regex_match(r"^\w+@\w+\.\w+$"), &ctx)?;
      assert_eq!(result, ExprResult::Scalar(Value::Bool(true)));
  }

  #[test]
  fn test_eval_regex_extract() {
      let arbor = read_json(r#"{"text": "Order #12345"}"#);
      let ctx = EvalContext::new(&arbor, arbor.root(0));

      let result = eval_expr(&path("text").regex_extract(r"#(\d+)", 1), &ctx)?;
      assert_eq!(result, ExprResult::Scalar(Value::String("12345".to_string())));
  }
  ```

#### 9.2.11 Python Tests

File: `python/tests/test_expr.py`

- [ ] Add tests for new string operations:
  ```python
  class TestStringOperationsExtended:
      def test_str_slice_basic(self):
          """Extract substring with start and length."""
          result = path("name").str.slice(0, 3)
          assert result is not None

      def test_str_slice_negative(self):
          """Negative index slicing."""
          result = path("name").str.slice(-3)
          assert result is not None

      def test_str_replace(self):
          """Replace pattern with replacement."""
          result = path("text").str.replace("foo", "bar")
          assert result is not None

      def test_str_split(self):
          """Split string by delimiter."""
          result = path("csv").str.split(",")
          assert result is not None

      def test_str_join(self):
          """Join list with delimiter."""
          result = path("parts").str.join("-")
          assert result is not None

      def test_str_regex_match(self):
          """Regex pattern matching."""
          result = path("email").str.match_(r"^\w+@\w+\.\w+$")
          assert result is not None

      def test_str_regex_extract(self):
          """Regex capture group extraction."""
          result = path("text").str.extract(r"#(\d+)", 1)
          assert result is not None

      def test_str_regex_replace(self):
          """Regex replacement."""
          result = path("text").str.replace_regex(r"\s+", " ")
          assert result is not None
  ```

File: `python/tests/test_expr_acceptance.py`

- [ ] Add acceptance tests with actual data evaluation:
  ```python
  def test_string_slice_evaluation():
      arbor = aq.read_json('{"name": "Alice"}')
      result = arbor.select([path("name").str.slice(0, 3).alias("short")])
      assert result[0]["short"].value == "Ali"

  def test_string_split_join_roundtrip():
      arbor = aq.read_json('{"csv": "a,b,c"}')
      # Split then join should give back original (with same delimiter)
      result = arbor.select([
          path("csv").str.split(",").str.join(",").alias("result")
      ])
      assert result[0]["result"].value == "a,b,c"

  def test_string_regex_extract():
      arbor = aq.read_json('{"text": "Order #12345 placed"}')
      result = arbor.select([
          path("text").str.extract(r"#(\d+)", 1).alias("order_id")
      ])
      assert result[0]["order_id"].value == "12345"
  ```

#### 9.2.12 Edge Cases and Error Handling

- [ ] Document and test edge cases:

| Scenario | Expected Behavior |
|----------|-------------------|
| `substring` on null | Returns null |
| `substring` with start > length | Returns empty string |
| `substring` with negative start beyond length | Clamps to 0 |
| `split` on empty string | Returns list with one empty string |
| `split` with delimiter not found | Returns list with original string |
| `join` on empty list | Returns empty string |
| `join` on non-string elements | Type error |
| `regex_match` with invalid pattern | Returns error (not panic) |
| `regex_extract` with no match | Returns null |
| `regex_extract` with invalid group | Returns null |

**Phase 9.2 Deliverables:**
- [x] 7 new Expr variants (Substring, Replace, Split, Join, RegexMatch, RegexExtract, RegexReplace)
- [x] Evaluation implementation for all variants
- [x] Type inference for all variants
- [x] Python `.str` accessor extensions
- [x] Updated type stubs with documentation
- [x] 20+ Rust tests (22 tests added)
- [x] 15+ Python tests (31 tests added)
- [x] Edge case documentation

---

### 9.3 List Operations

**Goal:** Provide operations for manipulating lists/arrays beyond simple aggregation. These complement the `list()` constructor from Phase 8.4.

**Reference:** Section H (Tree-Building – list operations complement list construction)

#### 9.3.1 Current State

List-related functionality already implemented:
- `list()` constructor for building lists from expressions
- `Len(Box<Expr>)` for getting list/array length
- `First(Box<Expr>)`, `Last(Box<Expr>)` for getting first/last elements
- Wildcard paths `items[*]` produce vectors that can be aggregated

What's missing: Element access, slicing, searching, sorting, and concatenation.

#### 9.3.2 New Expr Variants

File: `crates/arbors-expr/src/expr.rs`

- [x] Add `ListGet` variant:
  ```rust
  /// Get element at index from list (supports negative indices)
  ListGet {
      list: Box<Expr>,
      index: Box<Expr>,  // i64, negative allowed (Python-like)
  },
  ```

- [x] Add `ListSlice` variant:
  ```rust
  /// Extract a slice from list [start:end) (Python-like slicing)
  ListSlice {
      list: Box<Expr>,
      start: Option<Box<Expr>>,  // None = from beginning
      end: Option<Box<Expr>>,    // None = to end
  },
  ```

- [x] Add `ListContains` variant:
  ```rust
  /// Check if list contains a value (returns bool)
  ListContains {
      list: Box<Expr>,
      value: Box<Expr>,
  },
  ```

- [x] Add `ListUnique` variant:
  ```rust
  /// Remove duplicates from list (preserves first occurrence order)
  ListUnique {
      list: Box<Expr>,
  },
  ```

- [x] Add `ListSort` variant:
  ```rust
  /// Sort list elements
  ListSort {
      list: Box<Expr>,
      descending: bool,
  },
  ```

- [x] Add `ListReverse` variant:
  ```rust
  /// Reverse list order
  ListReverse {
      list: Box<Expr>,
  },
  ```

- [x] Add `ListConcat` variant:
  ```rust
  /// Concatenate multiple lists into one
  ListConcat {
      lists: Vec<Expr>,
  },
  ```

#### 9.3.3 Expr Builder Methods

File: `crates/arbors-expr/src/expr.rs`

- [x] Add builder methods to `impl Expr`:
  ```rust
  /// Get element at index (supports negative indices)
  pub fn list_get(self, index: Expr) -> Expr {
      Expr::ListGet {
          list: Box::new(self),
          index: Box::new(index),
      }
  }

  /// Extract slice [start:end)
  pub fn list_slice(self, start: Option<Expr>, end: Option<Expr>) -> Expr {
      Expr::ListSlice {
          list: Box::new(self),
          start: start.map(Box::new),
          end: end.map(Box::new),
      }
  }

  /// Check if list contains value
  pub fn list_contains(self, value: Expr) -> Expr {
      Expr::ListContains {
          list: Box::new(self),
          value: Box::new(value),
      }
  }

  /// Remove duplicates from list
  pub fn list_unique(self) -> Expr {
      Expr::ListUnique {
          list: Box::new(self),
      }
  }

  /// Sort list elements
  pub fn list_sort(self, descending: bool) -> Expr {
      Expr::ListSort {
          list: Box::new(self),
          descending,
      }
  }

  /// Reverse list order
  pub fn list_reverse(self) -> Expr {
      Expr::ListReverse {
          list: Box::new(self),
      }
  }
  ```

- [x] Add top-level function:
  ```rust
  /// Concatenate multiple lists
  pub fn list_concat(lists: Vec<Expr>) -> Expr {
      Expr::ListConcat { lists }
  }
  ```

#### 9.3.4 Shape and Type Inference

File: `crates/arbors-expr/src/infer.rs`

- [x] Add inference rules for new variants:

| Expression | Input Type | Output Type | Cardinality |
|------------|------------|-------------|-------------|
| `ListGet` | List(T) | T | Vector → Scalar |
| `ListSlice` | List(T) | List(T) | Preserves vector |
| `ListContains` | List(T), T | Bool | Vector → Scalar |
| `ListUnique` | List(T) | List(T) | Preserves vector |
| `ListSort` | List(T) | List(T) | Preserves vector |
| `ListReverse` | List(T) | List(T) | Preserves vector |
| `ListConcat` | List(T), ... | List(T) | Preserves vector |

- [x] Update `infer_type()` for each new variant
- [x] Update `infer_cardinality()` - note `ListGet` and `ListContains` reduce vector → scalar

#### 9.3.5 LogicalPlan Integration

File: `crates/arbors-expr/src/plan.rs`

- [x] Update `add_children()` to handle new variants
- [x] Ensure children are properly registered for each variant

#### 9.3.6 Evaluation Implementation

File: `crates/arbors-query/src/eval.rs`

- [x] Implement `eval_list_get()`:
  - Handle negative indices (Python-like: -1 = last, -2 = second-to-last)
  - Out-of-bounds returns error (per M.5 design decision)
  - Null propagation

- [x] Implement `eval_list_slice()`:
  - Python-like slicing semantics
  - None start = 0, None end = len
  - Negative indices supported
  - Out-of-bounds clamped (not error)

- [x] Implement `eval_list_contains()`:
  - Value equality check
  - Returns Bool scalar
  - Null in list: never matches (unless searching for null?)

- [x] Implement `eval_list_unique()`:
  - Preserve first occurrence order
  - Value equality for deduplication

- [x] Implement `eval_list_sort()`:
  - Natural ordering for primitives
  - Null handling: nulls last (or first?)
  - Mixed types: error

- [x] Implement `eval_list_reverse()`:
  - Simple reverse
  - Preserve element types

- [x] Implement `eval_list_concat()`:
  - Concatenate all lists in order
  - Empty lists are no-ops

#### 9.3.7 Python ExprListAccessor

File: `python/src/lib.rs`

- [x] Create `ExprListAccessor` struct:
  ```rust
  #[pyclass(name = "ExprListAccessor")]
  pub struct ExprListAccessor {
      expr: RustExpr,
  }

  #[pymethods]
  impl ExprListAccessor {
      fn get(&self, index: ExprOrValue<'_>) -> Expr { ... }
      #[pyo3(signature = (start=None, end=None))]
      fn slice(&self, start: Option<ExprOrValue<'_>>, end: Option<ExprOrValue<'_>>) -> Expr { ... }
      fn contains(&self, value: ExprOrValue<'_>) -> Expr { ... }
      fn unique(&self) -> Expr { ... }
      #[pyo3(signature = (descending=false))]
      fn sort(&self, descending: bool) -> Expr { ... }
      fn reverse(&self) -> Expr { ... }
      fn __repr__(&self) -> &'static str { "ExprListAccessor" }
  }
  ```

- [x] Add `.list` property to `Expr`:
  ```rust
  #[getter]
  fn list(&self) -> ExprListAccessor {
      ExprListAccessor { expr: self.inner.clone() }
  }
  ```

- [x] Add `list_concat()` top-level function:
  ```rust
  #[pyfunction]
  #[pyo3(name = "list_concat")]
  fn expr_list_concat(lists: Vec<PyRef<'_, Expr>>) -> Expr { ... }
  ```

- [x] Register new class and function in module

#### 9.3.8 Type Stubs

File: `python/arbors/_arbors.pyi`

- [x] Add `ExprListAccessor` class with all methods
- [x] Add `.list` property to `Expr` class
- [x] Add `list_concat()` function signature

#### 9.3.9 Python __init__.py Updates

File: `python/arbors/__init__.py`

- [x] Import and export `ExprListAccessor`
- [x] Import and export `list_concat`
- [x] Add to `__all__`

#### 9.3.10 Edge Cases and Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| `list_get` with index out of bounds | Error (per M.5) |
| `list_get` with negative index beyond list | Error |
| `list_slice` with out-of-bounds indices | Clamp to valid range |
| `list_contains` with null value | Returns false (null never equals anything) |
| `list_contains` on list with nulls | Nulls don't match |
| `list_sort` with mixed types | Error |
| `list_sort` with nulls | Nulls sort last |
| `list_unique` with nulls | Treat null as distinct value |
| `list_concat` with empty lists | No-op (skip empty) |
| Any operation on null list | Returns null |

#### 9.3.11 Rust Tests

File: `crates/arbors-query/tests/integration.rs`

- [x] `test_list_get` - basic positive/negative indexing
- [x] `test_list_get_out_of_bounds` - error cases
- [x] `test_list_get_null_propagation`
- [x] `test_list_slice` - various start/end combinations
- [x] `test_list_slice_negative_indices`
- [x] `test_list_slice_null_propagation`
- [x] `test_list_contains` - found/not found cases
- [x] `test_list_contains_null_handling`
- [x] `test_list_unique` - deduplication
- [x] `test_list_unique_preserves_order`
- [x] `test_list_sort` - ascending/descending
- [x] `test_list_sort_with_nulls`
- [x] `test_list_reverse`
- [x] `test_list_concat` - multiple lists
- [x] `test_list_concat_empty`

#### 9.3.12 Python Tests

File: `python/tests/test_expr.py`

- [x] `TestExprListAccessor` - accessor existence and type
- [x] `TestListGet` - expression construction
- [x] `TestListSlice` - expression construction
- [x] `TestListContains` - expression construction
- [x] `TestListUnique` - expression construction
- [x] `TestListSort` - expression construction
- [x] `TestListReverse` - expression construction
- [x] `TestListConcat` - function usage
- [x] `TestListOperationsEval` - evaluation tests matching Rust tests

**Phase 9.3 Deliverables:**
- [x] 7 new Expr variants (ListGet, ListSlice, ListContains, ListUnique, ListSort, ListReverse, ListConcat)
- [x] Evaluation implementation for all variants
- [x] Type inference for all variants
- [x] Python `.list` accessor with all methods
- [x] `list_concat()` top-level function
- [x] Updated type stubs with documentation
- [x] 15+ Rust tests
- [x] 15+ Python tests
- [x] Edge case documentation

---

### 9.4 Struct Operations

**Goal:** Provide operations for manipulating structs/objects beyond simple construction. These complement the `struct_()` constructor from Phase 8.4.

**Reference:** Section H (Tree-Building – struct operations complement struct construction)

#### 9.4.1 Current State

Struct-related functionality already implemented:
- `struct_()` constructor for building structs from named field expressions
- `Struct(Vec<(String, Expr)>)` variant in Expr enum
- Path expressions can navigate into struct fields (e.g., `path("user.name")`)

What's missing: Field extraction by name, field renaming, field addition/update, and field removal.

#### 9.4.2 New Expr Variants

File: `crates/arbors-expr/src/expr.rs`

- [x] Add `StructField` variant:
  ```rust
  /// Extract a field from a struct by name
  StructField {
      expr: Box<Expr>,
      field: String,
  },
  ```

- [x] Add `StructRename` variant:
  ```rust
  /// Rename a field in a struct
  StructRename {
      expr: Box<Expr>,
      old_name: String,
      new_name: String,
  },
  ```

- [x] Add `StructWith` variant:
  ```rust
  /// Add or update a field in a struct
  StructWith {
      expr: Box<Expr>,
      field: String,
      value: Box<Expr>,
  },
  ```

- [x] Add `StructWithout` variant:
  ```rust
  /// Remove a field from a struct
  StructWithout {
      expr: Box<Expr>,
      field: String,
  },
  ```

#### 9.4.3 Expr Builder Methods

File: `crates/arbors-expr/src/expr.rs`

- [x] Add builder methods to `impl Expr`:
  ```rust
  /// Extract a field from a struct by name
  pub fn struct_field(self, field: &str) -> Expr {
      Expr::StructField {
          expr: Box::new(self),
          field: field.to_string(),
      }
  }

  /// Rename a field in a struct
  pub fn struct_rename(self, old_name: &str, new_name: &str) -> Expr {
      Expr::StructRename {
          expr: Box::new(self),
          old_name: old_name.to_string(),
          new_name: new_name.to_string(),
      }
  }

  /// Add or update a field in a struct
  pub fn struct_with(self, field: &str, value: Expr) -> Expr {
      Expr::StructWith {
          expr: Box::new(self),
          field: field.to_string(),
          value: Box::new(value),
      }
  }

  /// Remove a field from a struct
  pub fn struct_without(self, field: &str) -> Expr {
      Expr::StructWithout {
          expr: Box::new(self),
          field: field.to_string(),
      }
  }
  ```

#### 9.4.4 Shape and Type Inference

File: `crates/arbors-expr/src/infer.rs`

- [x] Add inference rules for new variants:

| Expression | Input Type | Output Type | Cardinality |
|------------|------------|-------------|-------------|
| `StructField` | Struct | field's type | Preserves |
| `StructRename` | Struct | Struct | Preserves |
| `StructWith` | Struct | Struct | Preserves |
| `StructWithout` | Struct | Struct | Preserves |

- [x] Update `infer_type()` for each new variant
- [x] Update `infer_cardinality()` - all preserve existing cardinality

#### 9.4.5 LogicalPlan Integration

File: `crates/arbors-expr/src/plan.rs`

- [x] Update `add_children()` to handle new variants
- [x] Ensure children are properly registered for each variant

#### 9.4.6 Evaluation Implementation

File: `crates/arbors-query/src/eval.rs`

- [x] Implement `eval_struct_field()`:
  - Extract field from ExprResult::Struct
  - Return null if field doesn't exist
  - Null propagation for null struct

- [x] Implement `eval_struct_rename()`:
  - Create new struct with renamed field
  - Preserve field order
  - Error if old field doesn't exist

- [x] Implement `eval_struct_with()`:
  - Add new field or update existing
  - If field exists, replace value
  - If field doesn't exist, append

- [x] Implement `eval_struct_without()`:
  - Remove field if present
  - No error if field doesn't exist (idempotent)
  - Null propagation for null struct

#### 9.4.7 Python ExprStructAccessor

File: `python/src/lib.rs`

- [x] Create `ExprStructAccessor` struct:
  ```rust
  #[pyclass(name = "ExprStructAccessor")]
  pub struct ExprStructAccessor {
      expr: RustExpr,
  }

  #[pymethods]
  impl ExprStructAccessor {
      /// Extract a field by name
      fn field(&self, name: &str) -> Expr { ... }

      /// Rename a field
      fn rename(&self, old_name: &str, new_name: &str) -> Expr { ... }

      /// Add or update a field
      fn with_field(&self, name: &str, value: ExprOrValue<'_>) -> Expr { ... }

      /// Remove a field
      fn without(&self, name: &str) -> Expr { ... }

      fn __repr__(&self) -> &'static str { "ExprStructAccessor" }
  }
  ```

- [x] Add `.struct_` property to `Expr`:
  ```rust
  #[getter]
  fn struct_(&self) -> ExprStructAccessor {
      ExprStructAccessor { expr: self.inner.clone() }
  }
  ```

- [x] Register new class in module

#### 9.4.8 Type Stubs

File: `python/arbors/_arbors.pyi`

- [x] Add `ExprStructAccessor` class with all methods:
  ```python
  class ExprStructAccessor:
      """Accessor for struct/object operations on expressions."""

      def field(self, name: str) -> Expr:
          """Extract a field from a struct by name.

          Args:
              name: The field name to extract

          Returns:
              Expression representing the field value

          Example:
              >>> path("user").struct.field("name")
          """
          ...

      def rename(self, old_name: str, new_name: str) -> Expr:
          """Rename a field in a struct.

          Args:
              old_name: Current field name
              new_name: New field name

          Returns:
              Expression with renamed field

          Example:
              >>> path("data").struct.rename("old_key", "new_key")
          """
          ...

      def with_field(self, name: str, value: Expr | int | float | str | bool | None) -> Expr:
          """Add or update a field in a struct.

          Args:
              name: Field name to add or update
              value: Value expression for the field

          Returns:
              Expression with added/updated field

          Example:
              >>> path("user").struct.with_field("active", lit(True))
          """
          ...

      def without(self, name: str) -> Expr:
          """Remove a field from a struct.

          Args:
              name: Field name to remove

          Returns:
              Expression without the specified field

          Example:
              >>> path("user").struct.without("password")
          """
          ...
  ```

- [x] Add `.struct_` property to `Expr` class

#### 9.4.9 Python __init__.py Updates

File: `python/arbors/__init__.py`

- [x] Import and export `ExprStructAccessor`
- [x] Add to `__all__`

#### 9.4.10 Edge Cases and Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| `struct_field` on missing field | Returns null |
| `struct_field` on null struct | Returns null |
| `struct_rename` on missing field | Error |
| `struct_rename` to existing field name | Error (duplicate field) |
| `struct_with` on null struct | Returns null |
| `struct_with` updates existing field | Replaces value |
| `struct_with` adds new field | Appends to struct |
| `struct_without` on missing field | No-op (returns unchanged struct) |
| `struct_without` on null struct | Returns null |
| Any operation on non-struct | Error (type mismatch) |

#### 9.4.11 Rust Tests

File: `crates/arbors-query/tests/integration.rs`

- [x] `test_struct_field` - basic field extraction
- [x] `test_struct_field_missing` - missing field returns null
- [x] `test_struct_field_null_propagation`
- [x] `test_struct_rename` - basic rename
- [x] `test_struct_rename_preserves_order` - field order preservation
- [x] `test_struct_rename_missing_field_error` - error case
- [x] `test_struct_rename_collision_error` - error case
- [x] `test_struct_rename_null_propagation`
- [x] `test_struct_with` - adding new field
- [x] `test_struct_with_update_existing` - updating existing field
- [x] `test_struct_with_null_propagation`
- [x] `test_struct_without` - removing field
- [x] `test_struct_without_nonexistent` - idempotent behavior
- [x] `test_struct_without_null_propagation`
- [x] `test_struct_operations_chaining` - chaining multiple operations
- [x] `test_struct_field_on_tree_data` - tree data (not constructed)

#### 9.4.12 Python Tests

File: `python/tests/test_expr.py`

- [x] `TestExprStructAccessor` - accessor existence and type
- [x] `TestStructField` - expression construction and evaluation
- [x] `TestStructRename` - expression construction and evaluation
- [x] `TestStructWith` - expression construction and evaluation
- [x] `TestStructWithout` - expression construction and evaluation
- [x] `TestStructOperationsChaining` - chaining multiple operations
- [x] `TestStructOperationsOnTreeData` - operations on parsed JSON data

**Phase 9.4 Deliverables:**
- [x] 4 new Expr variants (StructField, StructRename, StructWith, StructWithout)
- [x] Evaluation implementation for all variants
- [x] Type inference for all variants
- [x] Python `.struct_` accessor with all methods
- [x] Updated type stubs with documentation
- [x] 16 Rust tests (exceeds 13+ requirement)
- [x] 7 Python test classes (exceeds 6+ requirement)
- [x] Edge case documentation

---

### 9.5 Conditional Expressions (Extended)

**Goal:** Extend the conditional expression system with SQL-style CASE and null-handling conveniences.

**Reference:** Section F.1 (Conditional section, extending it)

#### 9.5.1 Current State

Conditional functionality already implemented:
- `When { condition, then_expr, else_expr }` - single if-then-else
- `when(condition).then(value).otherwise(default)` - builder pattern
- `Coalesce(Vec<Expr>)` - first non-null value
- `IsNull(Box<Expr>)`, `IsNotNull(Box<Expr>)` - null checks

What's missing:
- Chained conditionals (SQL CASE WHEN ... WHEN ... ELSE)
- `NullIf` for conditional null replacement
- Chained `when().when()...` builder pattern

#### 9.5.2 New Expr Variants

File: `crates/arbors-expr/src/expr.rs`

- [ ] Add `Case` variant:
  ```rust
  /// SQL-style CASE expression with multiple branches
  ///
  /// Evaluates conditions in order; returns first matching branch's value.
  /// If no condition matches, returns else_expr (or null if None).
  ///
  /// # SQL Equivalent
  /// ```sql
  /// CASE
  ///   WHEN cond1 THEN val1
  ///   WHEN cond2 THEN val2
  ///   ELSE default
  /// END
  /// ```
  Case {
      /// (condition, then_value) pairs, evaluated in order
      branches: Vec<(Expr, Expr)>,
      /// Value if no condition matches (None = null)
      else_expr: Option<Box<Expr>>,
  },
  ```

- [ ] Add `NullIf` variant:
  ```rust
  /// Returns null if the two expressions are equal, otherwise returns first expression
  ///
  /// # SQL Equivalent
  /// ```sql
  /// NULLIF(expr, value)  -- Returns NULL if expr = value, else expr
  /// ```
  ///
  /// # Use Case
  /// Convert sentinel values to null:
  /// `null_if(path("status"), lit(-1))` - treat -1 as missing
  NullIf {
      expr: Box<Expr>,
      null_value: Box<Expr>,
  },
  ```

**Note:** `IfNull` is intentionally NOT added as a separate variant. `coalesce([expr, default])` provides identical semantics with more flexibility. Instead, we add an `if_null()` convenience method that wraps `Coalesce`.

#### 9.5.3 Expr Builder Methods

File: `crates/arbors-expr/src/expr.rs`

- [ ] Add `null_if` method to `impl Expr`:
  ```rust
  /// Returns null if self equals the given value, otherwise returns self
  ///
  /// # Example
  /// ```
  /// // Treat -1 as missing
  /// let expr = path("status").null_if(lit(-1));
  /// ```
  pub fn null_if(self, null_value: Expr) -> Expr {
      Expr::NullIf {
          expr: Box::new(self),
          null_value: Box::new(null_value),
      }
  }
  ```

- [ ] Add `if_null` convenience method to `impl Expr`:
  ```rust
  /// Returns self if not null, otherwise returns default
  ///
  /// This is a convenience wrapper around `coalesce([self, default])`.
  ///
  /// # Example
  /// ```
  /// // Provide default for missing age
  /// let expr = path("age").if_null(lit(0));
  /// ```
  pub fn if_null(self, default: Expr) -> Expr {
      Expr::Coalesce(vec![self, default])
  }
  ```

- [ ] Add top-level `case` function and builder:
  ```rust
  /// Builder for SQL-style CASE expressions
  pub struct CaseBuilder {
      branches: Vec<(Expr, Expr)>,
  }

  impl CaseBuilder {
      /// Add a WHEN branch
      ///
      /// # Example
      /// ```
      /// case()
      ///     .when(path("age") < 13, lit("child"))
      ///     .when(path("age") < 20, lit("teen"))
      ///     .otherwise(lit("adult"))
      /// ```
      pub fn when(mut self, condition: Expr, value: Expr) -> Self {
          self.branches.push((condition, value));
          self
      }

      /// Specify the ELSE value and build the expression
      pub fn otherwise(self, value: Expr) -> Expr {
          Expr::Case {
              branches: self.branches,
              else_expr: Some(Box::new(value)),
          }
      }

      /// Build the expression with null as the default
      pub fn end(self) -> Expr {
          Expr::Case {
              branches: self.branches,
              else_expr: None,
          }
      }
  }

  /// Start building a CASE expression
  ///
  /// # Example
  /// ```
  /// use arbors::expr::{case, path, lit};
  ///
  /// let grade = case()
  ///     .when(path("score") >= 90, lit("A"))
  ///     .when(path("score") >= 80, lit("B"))
  ///     .when(path("score") >= 70, lit("C"))
  ///     .otherwise(lit("F"));
  /// ```
  pub fn case() -> CaseBuilder {
      CaseBuilder { branches: vec![] }
  }
  ```

- [ ] Extend `WhenBuilder` for chaining:
  ```rust
  impl WhenBuilder {
      // Existing: fn then(self, value: Expr) -> WhenBuilderThen

      /// Chain another condition (creates a Case expression internally)
      ///
      /// # Example
      /// ```
      /// when(path("age") < 13)
      ///     .then(lit("child"))
      ///     .when(path("age") < 20)  // Chain!
      ///     .then(lit("teen"))
      ///     .otherwise(lit("adult"))
      /// ```
      pub fn when(self, condition: Expr) -> CaseBuilder {
          let mut builder = CaseBuilder { branches: vec![] };
          // First branch from the original when().then()
          if let Some(then_expr) = self.then_expr {
              builder.branches.push((self.condition, then_expr));
          }
          // Start the next branch
          CaseBuilder {
              branches: builder.branches,
              pending_condition: Some(condition),
          }
      }
  }
  ```

  **Note:** This extends the existing `when()` builder to support chaining. The implementation may need a `WhenBuilderThen` intermediate that has a `when()` method.

#### 9.5.4 Shape and Type Inference

File: `crates/arbors-expr/src/infer.rs`

- [ ] Add inference rules for new variants:

| Expression | Condition Type | Output Type | Cardinality |
|------------|----------------|-------------|-------------|
| `Case` | Bool per branch | Union of branch types | Same as branches |
| `NullIf` | N/A | Same as input expr | Same as input |

- [ ] Update `infer_type()` for `Case`:
  - All conditions must be Bool
  - All branch values must have compatible types
  - Result type is union/promoted type of all branches
  - If else_expr is None, result is nullable

- [ ] Update `infer_type()` for `NullIf`:
  - Result type is same as input expr
  - Result is always nullable (might return null)

- [ ] Update `infer_cardinality()`:
  - `Case`: cardinality of branches (must be consistent)
  - `NullIf`: same as input expr

#### 9.5.5 LogicalPlan Integration

File: `crates/arbors-expr/src/plan.rs`

- [ ] Update `add_children()` to handle new variants:
  ```rust
  Expr::Case { branches, else_expr } => {
      for (cond, val) in branches {
          self.add_expr(cond.clone());
          self.add_expr(val.clone());
      }
      if let Some(e) = else_expr {
          self.add_expr(*e.clone());
      }
  }
  Expr::NullIf { expr, null_value } => {
      self.add_expr(*expr.clone());
      self.add_expr(*null_value.clone());
  }
  ```

#### 9.5.6 Evaluation Implementation

File: `crates/arbors-query/src/eval.rs`

- [ ] Implement `eval_case()`:
  ```rust
  fn eval_case(
      branches: &[(Expr, Expr)],
      else_expr: &Option<Box<Expr>>,
      ctx: &EvalContext,
  ) -> Result<ExprResult, ExprError> {
      // Evaluate conditions in order
      for (condition, value) in branches {
          let cond_result = eval_expr(condition, ctx)?;
          match cond_result {
              ExprResult::Scalar(Value::Bool(true)) => {
                  return eval_expr(value, ctx);
              }
              ExprResult::Scalar(Value::Bool(false)) |
              ExprResult::Scalar(Value::Null) |
              ExprResult::Null => {
                  // Condition not met, try next branch
                  continue;
              }
              _ => {
                  return Err(ExprError::TypeMismatch {
                      expected: "Bool".to_string(),
                      got: format!("{:?}", cond_result),
                  });
              }
          }
      }
      // No condition matched, return else or null
      match else_expr {
          Some(e) => eval_expr(e, ctx),
          None => Ok(ExprResult::Null),
      }
  }
  ```

- [ ] Implement `eval_null_if()`:
  ```rust
  fn eval_null_if(
      expr: &Expr,
      null_value: &Expr,
      ctx: &EvalContext,
  ) -> Result<ExprResult, ExprError> {
      let expr_result = eval_expr(expr, ctx)?;
      let null_val_result = eval_expr(null_value, ctx)?;

      // If equal, return null; otherwise return expr
      if values_equal(&expr_result, &null_val_result) {
          Ok(ExprResult::Null)
      } else {
          Ok(expr_result)
      }
  }
  ```

- [ ] Add case to main `eval_expr` match:
  ```rust
  Expr::Case { branches, else_expr } => eval_case(branches, else_expr, ctx),
  Expr::NullIf { expr, null_value } => eval_null_if(expr, null_value, ctx),
  ```

#### 9.5.7 Python Bindings

File: `python/src/lib.rs`

- [ ] Add `CaseBuilder` class:
  ```rust
  /// Builder for SQL-style CASE expressions.
  ///
  /// Created via the `case()` function:
  ///
  ///     result = case().when(cond1, val1).when(cond2, val2).otherwise(default)
  #[pyclass(name = "CaseBuilder")]
  pub struct CaseBuilder {
      branches: Vec<(RustExpr, RustExpr)>,
  }

  #[pymethods]
  impl CaseBuilder {
      /// Add a WHEN branch with condition and value.
      fn when(&mut self, condition: PyRef<'_, Expr>, value: ExprOrValue<'_>) -> PyCaseBuilder {
          let mut new_branches = self.branches.clone();
          new_branches.push((condition.inner.clone(), value.into_expr()));
          PyCaseBuilder { branches: new_branches }
      }

      /// Specify the ELSE value and build the expression.
      fn otherwise(&self, value: ExprOrValue<'_>) -> Expr {
          Expr::new(RustExpr::Case {
              branches: self.branches.clone(),
              else_expr: Some(Box::new(value.into_expr())),
          })
      }

      /// Build the expression with null as the default.
      fn end(&self) -> Expr {
          Expr::new(RustExpr::Case {
              branches: self.branches.clone(),
              else_expr: None,
          })
      }

      fn __repr__(&self) -> String {
          format!("CaseBuilder({} branches)", self.branches.len())
      }
  }
  ```

- [ ] Add `case()` function:
  ```rust
  /// Start building a SQL-style CASE expression.
  ///
  /// # Args:
  ///     None
  ///
  /// # Returns:
  ///     CaseBuilder for chaining .when(condition, value).otherwise(default)
  ///
  /// # Example:
  ///     >>> grade = case() \
  ///     ...     .when(path("score") >= 90, lit("A")) \
  ///     ...     .when(path("score") >= 80, lit("B")) \
  ///     ...     .otherwise(lit("F"))
  #[pyfunction]
  #[pyo3(name = "case")]
  fn expr_case() -> CaseBuilder {
      CaseBuilder { branches: vec![] }
  }
  ```

- [ ] Add `null_if()` function:
  ```rust
  /// Returns null if expression equals the given value, otherwise returns the expression.
  ///
  /// Useful for converting sentinel values (like -1 or "") to null.
  ///
  /// # Args:
  ///     expr: Expression to evaluate
  ///     null_value: Value that should be treated as null
  ///
  /// # Returns:
  ///     Expr that returns null if expr equals null_value
  ///
  /// # Example:
  ///     >>> null_if(path("status"), lit(-1))  # Treat -1 as missing
  ///     >>> null_if(path("name"), lit(""))    # Treat empty string as null
  #[pyfunction]
  #[pyo3(name = "null_if")]
  fn expr_null_if(expr: PyRef<'_, Expr>, null_value: ExprOrValue<'_>) -> Expr {
      Expr::new(RustExpr::NullIf {
          expr: Box::new(expr.inner.clone()),
          null_value: Box::new(null_value.into_expr()),
      })
  }
  ```

- [ ] Add `if_null()` method to `Expr`:
  ```rust
  /// Returns self if not null, otherwise returns default.
  ///
  /// Equivalent to `coalesce([self, default])`.
  ///
  /// # Args:
  ///     default: Value to use if self is null
  ///
  /// # Returns:
  ///     Expr that returns self or default
  ///
  /// # Example:
  ///     >>> path("age").if_null(lit(0))
  fn if_null(&self, default: ExprOrValue<'_>) -> Expr {
      Expr::new(RustExpr::Coalesce(vec![
          self.inner.clone(),
          default.into_expr(),
      ]))
  }

  /// Returns null if self equals value, otherwise returns self.
  ///
  /// # Args:
  ///     value: Value that should be treated as null
  ///
  /// # Returns:
  ///     Expr that returns null if equal to value
  ///
  /// # Example:
  ///     >>> path("status").null_if(lit(-1))
  fn null_if(&self, value: ExprOrValue<'_>) -> Expr {
      Expr::new(RustExpr::NullIf {
          expr: Box::new(self.inner.clone()),
          null_value: Box::new(value.into_expr()),
      })
  }
  ```

- [ ] Extend `WhenBuilderThen` to support chaining:
  ```rust
  impl WhenBuilderThen {
      // Existing: fn otherwise(...)

      /// Chain another condition to create a multi-branch CASE.
      ///
      /// # Example:
      ///     >>> when(cond1).then(val1).when(cond2).then(val2).otherwise(default)
      fn when(&self, condition: PyRef<'_, Expr>) -> CaseBuilder {
          CaseBuilder {
              branches: vec![(self.condition.clone(), self.then_expr.clone())],
              pending_condition: Some(condition.inner.clone()),
          }
      }
  }
  ```

- [ ] Register new classes and functions in module:
  ```rust
  m.add_class::<CaseBuilder>()?;
  m.add_function(wrap_pyfunction!(expr_case, m)?)?;
  m.add_function(wrap_pyfunction!(expr_null_if, m)?)?;
  ```

#### 9.5.8 Update Type Stubs

File: `python/arbors/_arbors.pyi`

- [ ] Add `CaseBuilder` class:
  ```python
  class CaseBuilder:
      """Builder for SQL-style CASE expressions.

      Created via the `case()` function. Chain `.when(condition, value)` calls
      and terminate with `.otherwise(default)` or `.end()`.

      Example:
          >>> grade = case() \\
          ...     .when(path("score") >= 90, lit("A")) \\
          ...     .when(path("score") >= 80, lit("B")) \\
          ...     .when(path("score") >= 70, lit("C")) \\
          ...     .otherwise(lit("F"))
      """

      def when(self, condition: Expr, value: ExprInput) -> CaseBuilder:
          """Add a WHEN branch.

          Args:
              condition: Boolean expression for this branch
              value: Value to return if condition is true

          Returns:
              CaseBuilder for chaining more branches
          """
          ...

      def otherwise(self, value: ExprInput) -> Expr:
          """Specify the ELSE value and build the expression.

          Args:
              value: Default value if no condition matches

          Returns:
              Completed CASE expression
          """
          ...

      def end(self) -> Expr:
          """Build the expression with null as the default.

          Returns:
              Completed CASE expression (returns null if no match)
          """
          ...
  ```

- [ ] Add `case()` function:
  ```python
  def case() -> CaseBuilder:
      """Start building a SQL-style CASE expression.

      Returns:
          CaseBuilder for chaining .when(condition, value) calls

      Example:
          >>> from arbors import case, path, lit
          >>> grade = case() \\
          ...     .when(path("score") >= 90, lit("A")) \\
          ...     .when(path("score") >= 80, lit("B")) \\
          ...     .otherwise(lit("F"))
      """
      ...
  ```

- [ ] Add `null_if()` function:
  ```python
  def null_if(expr: Expr, value: ExprInput) -> Expr:
      """Return null if expression equals value, otherwise return expression.

      Useful for converting sentinel values to null.

      Args:
          expr: Expression to evaluate
          value: Value that should be treated as null

      Returns:
          Expr that returns null if expr equals value

      Example:
          >>> from arbors import null_if, path, lit
          >>> null_if(path("status"), lit(-1))  # Treat -1 as missing
          >>> null_if(path("name"), lit(""))    # Treat empty string as null
      """
      ...
  ```

- [ ] Add methods to `Expr` class:
  ```python
  def if_null(self, default: ExprInput) -> Expr:
      """Return self if not null, otherwise return default.

      Equivalent to `coalesce([self, default])`.

      Args:
          default: Value to use if self is null

      Returns:
          Expr that returns self or default

      Example:
          >>> path("age").if_null(lit(0))
          >>> path("name").if_null(lit("Unknown"))
      """
      ...

  def null_if(self, value: ExprInput) -> Expr:
      """Return null if self equals value, otherwise return self.

      Args:
          value: Value that should be treated as null

      Returns:
          Expr that returns null if equal to value

      Example:
          >>> path("status").null_if(lit(-1))  # -1 becomes null
          >>> path("name").null_if(lit("N/A"))  # "N/A" becomes null
      """
      ...
  ```

- [ ] Update `WhenBuilderThen` for chaining:
  ```python
  class WhenBuilderThen:
      """Intermediate builder after .then() has been called."""

      def otherwise(self, value: ExprInput) -> Expr:
          """Specify the value when condition is false."""
          ...

      def when(self, condition: Expr) -> CaseBuilder:
          """Chain another condition to create a multi-branch CASE.

          Example:
              >>> when(cond1).then(val1).when(cond2).then(val2).otherwise(default)
          """
          ...
  ```

- [ ] Update `__init__.py` exports:
  ```python
  from arbors._arbors import (
      # ... existing ...
      case,
      null_if,
      CaseBuilder,
  )
  ```

#### 9.5.9 Rust Tests

File: `crates/arbors-expr/src/expr.rs` (inline tests)

- [ ] Test `Case` expression construction:
  ```rust
  #[test]
  fn test_case_construction() {
      let expr = case()
          .when(path("score").ge(lit(90)), lit("A"))
          .when(path("score").ge(lit(80)), lit("B"))
          .otherwise(lit("F"));
      assert!(matches!(expr, Expr::Case { .. }));
  }

  #[test]
  fn test_case_with_end() {
      let expr = case()
          .when(path("active"), lit("yes"))
          .end();
      if let Expr::Case { else_expr, .. } = expr {
          assert!(else_expr.is_none());
      } else {
          panic!("Expected Case");
      }
  }
  ```

- [ ] Test `NullIf` expression construction:
  ```rust
  #[test]
  fn test_null_if_construction() {
      let expr = path("status").null_if(lit(-1));
      assert!(matches!(expr, Expr::NullIf { .. }));
  }
  ```

- [ ] Test `if_null` convenience method:
  ```rust
  #[test]
  fn test_if_null_is_coalesce() {
      let expr = path("age").if_null(lit(0));
      assert!(matches!(expr, Expr::Coalesce(_)));
      if let Expr::Coalesce(exprs) = expr {
          assert_eq!(exprs.len(), 2);
      }
  }
  ```

File: `crates/arbors-query/tests/integration.rs`

- [ ] Test `Case` evaluation:
  ```rust
  #[test]
  fn test_case_first_match() {
      let arbor = read_json(r#"{"score": 85}"#);
      let expr = case()
          .when(path("score").ge(lit(90)), lit("A"))
          .when(path("score").ge(lit(80)), lit("B"))
          .otherwise(lit("F"));
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::String("B".to_string())));
  }

  #[test]
  fn test_case_else() {
      let arbor = read_json(r#"{"score": 50}"#);
      let expr = case()
          .when(path("score").ge(lit(90)), lit("A"))
          .otherwise(lit("F"));
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::String("F".to_string())));
  }

  #[test]
  fn test_case_null_default() {
      let arbor = read_json(r#"{"score": 50}"#);
      let expr = case()
          .when(path("score").ge(lit(90)), lit("A"))
          .end();
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Null);
  }

  #[test]
  fn test_case_null_condition_skipped() {
      // If condition is null, it's treated as false
      let arbor = read_json(r#"{"score": null}"#);
      let expr = case()
          .when(path("score").ge(lit(90)), lit("A"))
          .otherwise(lit("F"));
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::String("F".to_string())));
  }
  ```

- [ ] Test `NullIf` evaluation:
  ```rust
  #[test]
  fn test_null_if_matches() {
      let arbor = read_json(r#"{"status": -1}"#);
      let expr = path("status").null_if(lit(-1));
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Null);
  }

  #[test]
  fn test_null_if_no_match() {
      let arbor = read_json(r#"{"status": 42}"#);
      let expr = path("status").null_if(lit(-1));
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::Int64(42)));
  }

  #[test]
  fn test_null_if_string() {
      let arbor = read_json(r#"{"name": "N/A"}"#);
      let expr = path("name").null_if(lit("N/A"));
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Null);
  }
  ```

- [ ] Test `if_null` evaluation:
  ```rust
  #[test]
  fn test_if_null_not_null() {
      let arbor = read_json(r#"{"age": 30}"#);
      let expr = path("age").if_null(lit(0));
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::Int64(30)));
  }

  #[test]
  fn test_if_null_is_null() {
      let arbor = read_json(r#"{"age": null}"#);
      let expr = path("age").if_null(lit(0));
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::Int64(0)));
  }
  ```

#### 9.5.10 Python Tests

File: `python/tests/test_expr.py`

- [ ] Add test class for `case()`:
  ```python
  class TestCaseExpression:
      """Tests for case() expression builder."""

      def test_case_builder_creation(self):
          """Case builder is created."""
          from arbors import case, CaseBuilder
          builder = case()
          assert isinstance(builder, CaseBuilder)

      def test_case_with_when(self):
          """Case builder supports when()."""
          from arbors import case, path, lit, Expr
          expr = case().when(path("x") > 0, lit("positive")).otherwise(lit("non-positive"))
          assert isinstance(expr, Expr)

      def test_case_multiple_branches(self):
          """Case supports multiple when branches."""
          from arbors import case, path, lit, Expr
          expr = case() \
              .when(path("score") >= 90, lit("A")) \
              .when(path("score") >= 80, lit("B")) \
              .when(path("score") >= 70, lit("C")) \
              .otherwise(lit("F"))
          assert isinstance(expr, Expr)

      def test_case_with_end(self):
          """Case can end without otherwise (null default)."""
          from arbors import case, path, lit, Expr
          expr = case().when(path("active"), lit("yes")).end()
          assert isinstance(expr, Expr)

      def test_case_builder_repr(self):
          """Case builder has repr."""
          from arbors import case, path, lit
          builder = case().when(path("x") > 0, lit("pos"))
          assert "CaseBuilder" in repr(builder)
  ```

- [ ] Add test class for `null_if()`:
  ```python
  class TestNullIf:
      """Tests for null_if() function and method."""

      def test_null_if_function(self):
          """null_if() function creates expression."""
          from arbors import null_if, path, lit, Expr
          expr = null_if(path("status"), lit(-1))
          assert isinstance(expr, Expr)

      def test_null_if_method(self):
          """Expr.null_if() method creates expression."""
          from arbors import path, lit, Expr
          expr = path("status").null_if(lit(-1))
          assert isinstance(expr, Expr)

      def test_null_if_with_string(self):
          """null_if works with string values."""
          from arbors import path, lit, Expr
          expr = path("name").null_if(lit("N/A"))
          assert isinstance(expr, Expr)
  ```

- [ ] Add test class for `if_null()`:
  ```python
  class TestIfNull:
      """Tests for if_null() method."""

      def test_if_null_method(self):
          """Expr.if_null() method creates expression."""
          from arbors import path, lit, Expr
          expr = path("age").if_null(lit(0))
          assert isinstance(expr, Expr)

      def test_if_null_with_string(self):
          """if_null works with string default."""
          from arbors import path, lit, Expr
          expr = path("name").if_null(lit("Unknown"))
          assert isinstance(expr, Expr)
  ```

- [ ] Add test for `when()` chaining:
  ```python
  class TestWhenChaining:
      """Tests for chained when().then().when() syntax."""

      def test_when_then_when_chaining(self):
          """when().then().when() creates Case expression."""
          from arbors import when, path, lit, Expr
          expr = when(path("age") < 13).then(lit("child")) \
              .when(path("age") < 20).then(lit("teen")) \
              .otherwise(lit("adult"))
          assert isinstance(expr, Expr)
  ```

File: `python/tests/test_expr_acceptance.py`

- [ ] Add acceptance tests for `case()`:
  ```python
  def test_case_first_match():
      """Case returns first matching branch."""
      arbor = aq.read_json('{"score": 85}')
      result = arbor.select([
          case()
              .when(path("score") >= 90, lit("A"))
              .when(path("score") >= 80, lit("B"))
              .otherwise(lit("F"))
              .alias("grade")
      ])
      assert result[0]["grade"].value == "B"

  def test_case_else_value():
      """Case returns else when no match."""
      arbor = aq.read_json('{"score": 50}')
      result = arbor.select([
          case()
              .when(path("score") >= 60, lit("pass"))
              .otherwise(lit("fail"))
              .alias("result")
      ])
      assert result[0]["result"].value == "fail"

  def test_case_null_default():
      """Case returns null when no match and no else."""
      arbor = aq.read_json('{"score": 50}')
      result = arbor.select([
          case()
              .when(path("score") >= 90, lit("A"))
              .end()
              .alias("grade")
      ])
      assert result[0]["grade"].value is None
  ```

- [ ] Add acceptance tests for `null_if()`:
  ```python
  def test_null_if_matches():
      """null_if returns null when values match."""
      arbor = aq.read_json('{"status": -1}')
      result = arbor.select([path("status").null_if(lit(-1)).alias("status")])
      assert result[0]["status"].value is None

  def test_null_if_no_match():
      """null_if returns value when no match."""
      arbor = aq.read_json('{"status": 42}')
      result = arbor.select([path("status").null_if(lit(-1)).alias("status")])
      assert result[0]["status"].value == 42

  def test_null_if_empty_string():
      """null_if can convert empty strings to null."""
      arbor = aq.read_json('{"name": ""}')
      result = arbor.select([path("name").null_if(lit("")).alias("name")])
      assert result[0]["name"].value is None
  ```

- [ ] Add acceptance tests for `if_null()`:
  ```python
  def test_if_null_not_null():
      """if_null returns value when not null."""
      arbor = aq.read_json('{"age": 30}')
      result = arbor.select([path("age").if_null(lit(0)).alias("age")])
      assert result[0]["age"].value == 30

  def test_if_null_is_null():
      """if_null returns default when null."""
      arbor = aq.read_json('{"age": null}')
      result = arbor.select([path("age").if_null(lit(0)).alias("age")])
      assert result[0]["age"].value == 0

  def test_if_null_missing_field():
      """if_null returns default when field missing."""
      arbor = aq.read_json('{"name": "Alice"}')
      result = arbor.select([path("age").if_null(lit(-1)).alias("age")])
      assert result[0]["age"].value == -1
  ```

#### 9.5.11 Edge Cases and Error Handling

- [ ] Document and test edge cases:

| Scenario | Expected Behavior |
|----------|-------------------|
| `case()` with no branches + `end()` | Returns null |
| `case()` with no branches + `otherwise()` | Returns else value |
| `case()` condition not bool | Type error |
| `case()` branch types differ | Promoted/union type |
| `null_if(null, x)` | Returns null |
| `null_if(x, null)` | Returns x (null != value) |
| `if_null(null, null)` | Returns null (both null) |
| `when().then().when()` missing `then()` | Builder error at compile time |

**Phase 9.5 Deliverables:**
- [x] 2 new Expr variants (`Case`, `NullIf`)
- [x] `CaseBuilder` for SQL-style CASE expressions
- [x] `case()`, `null_if()` functions
- [x] `if_null()`, `null_if()` methods on Expr
- [x] `when().then().when()` chaining support
- [x] Evaluation implementation for all variants
- [x] Type inference for all variants
- [x] Python bindings with `CaseBuilder` class
- [x] Updated type stubs with documentation
- [x] 8 Rust tests (case_basic, case_with_end, when_chain_to_case, null_if_converts_sentinel, null_if_preserves_non_matching, if_null_provides_default, case_first_match_wins, null_condition_treated_as_false)
- [x] 10 Python tests (test_case_returns_builder, test_case_when_value_builds_expr, test_case_chained_when, test_case_end_no_else, test_when_then_when_chain, test_null_if_method, test_if_null_method, test_null_if_with_path, test_if_null_with_expression)
- [x] Edge case documentation (in edge case table above)

---

### 9.6 Type Introspection

**Goal:** Add type-checking predicates and enhanced type introspection for runtime type queries on JSON values.

**Reference:** Section F.1 (Type Ops), Section J.4 (Type Invariants)

**Use Cases:**
- Filter records by value type: `arbor.filter(path("value").is_string())`
- Handle heterogeneous data: `when(path("x").is_int()).then(...).otherwise(...)`
- Debugging and data quality checks: `path("field").type_of()`
- Array element type inspection: `path("items[*]").is_array()` for nested arrays

#### 9.6.1 Add Type-Checking Expr Variants

File: `crates/arbors-expr/src/expr.rs`

- [x] Add type-checking variants to `Expr` enum:
  ```rust
  // === Type Predicates ===
  /// Returns true if the value is null
  IsNull(Box<Expr>),        // Already exists
  /// Returns true if the value is not null
  IsNotNull(Box<Expr>),     // Already exists
  /// Returns true if the value is a boolean
  IsBool(Box<Expr>),
  /// Returns true if the value is an integer (Int64)
  IsInt(Box<Expr>),
  /// Returns true if the value is a float (Float64)
  IsFloat(Box<Expr>),
  /// Returns true if the value is numeric (Int64 or Float64)
  IsNumeric(Box<Expr>),
  /// Returns true if the value is a string
  IsString(Box<Expr>),
  /// Returns true if the value is an array (JSON array)
  IsArray(Box<Expr>),
  /// Returns true if the value is an object (JSON object)
  IsObject(Box<Expr>),
  /// Returns true if the value is a Date
  IsDate(Box<Expr>),
  /// Returns true if the value is a DateTime
  IsDateTime(Box<Expr>),
  /// Returns true if the value is a Duration
  IsDuration(Box<Expr>),
  ```

- [x] Add builder methods on `Expr`:
  ```rust
  impl Expr {
      /// Returns true if this expression evaluates to a boolean.
      pub fn is_bool(self) -> Expr {
          Expr::IsBool(Box::new(self))
      }

      /// Returns true if this expression evaluates to an integer.
      pub fn is_int(self) -> Expr {
          Expr::IsInt(Box::new(self))
      }

      /// Returns true if this expression evaluates to a float.
      pub fn is_float(self) -> Expr {
          Expr::IsFloat(Box::new(self))
      }

      /// Returns true if this expression evaluates to a number (int or float).
      pub fn is_numeric(self) -> Expr {
          Expr::IsNumeric(Box::new(self))
      }

      /// Returns true if this expression evaluates to a string.
      pub fn is_string(self) -> Expr {
          Expr::IsString(Box::new(self))
      }

      /// Returns true if this expression evaluates to an array.
      pub fn is_array(self) -> Expr {
          Expr::IsArray(Box::new(self))
      }

      /// Returns true if this expression evaluates to an object.
      pub fn is_object(self) -> Expr {
          Expr::IsObject(Box::new(self))
      }

      /// Returns true if this expression evaluates to a Date.
      pub fn is_date(self) -> Expr {
          Expr::IsDate(Box::new(self))
      }

      /// Returns true if this expression evaluates to a DateTime.
      pub fn is_datetime(self) -> Expr {
          Expr::IsDateTime(Box::new(self))
      }

      /// Returns true if this expression evaluates to a Duration.
      pub fn is_duration(self) -> Expr {
          Expr::IsDuration(Box::new(self))
      }
  }
  ```

#### 9.6.2 Update Exports

File: `crates/arbors-expr/src/lib.rs`

- [x] Ensure new variants are exported (they're part of the Expr enum, so automatic)

#### 9.6.3 Update LogicalPlan for New Variants

File: `crates/arbors-expr/src/plan.rs`

- [x] Add children handling for type predicate variants:
  ```rust
  // Type predicates: single child
  Expr::IsBool(inner) | Expr::IsInt(inner) | Expr::IsFloat(inner) |
  Expr::IsNumeric(inner) | Expr::IsString(inner) | Expr::IsArray(inner) |
  Expr::IsObject(inner) | Expr::IsDate(inner) | Expr::IsDateTime(inner) |
  Expr::IsDuration(inner) => {
      let id = self.add_expr(*inner);
      (vec![id], Expr::IsBool(Box::new(Expr::Literal(Value::Null))))  // placeholder
  }
  ```

#### 9.6.4 Update Type Inference for New Variants

File: `crates/arbors-expr/src/infer.rs`

- [x] Add inference rules for type predicates (all return Bool):
  ```rust
  Expr::IsBool(_) | Expr::IsInt(_) | Expr::IsFloat(_) | Expr::IsNumeric(_) |
  Expr::IsString(_) | Expr::IsArray(_) | Expr::IsObject(_) |
  Expr::IsDate(_) | Expr::IsDateTime(_) | Expr::IsDuration(_) => {
      // All type predicates return bool
      let ty = ArborsType::Bool;
      let shape = Shape::scalar(ty.clone());
      let cardinality = child_cardinalities.first().copied().unwrap_or(Cardinality::Scalar);
      (ty, shape, cardinality)
  }
  ```

#### 9.6.5 Implement Evaluation for Type Predicates

File: `crates/arbors-query/src/eval.rs`

- [x] Add evaluation logic for type predicates:
  ```rust
  Expr::IsBool(inner) => {
      let result = eval_expr(inner, ctx)?;
      let is_bool = matches!(result, ExprResult::Scalar(Value::Bool(_)));
      Ok(ExprResult::Scalar(Value::Bool(is_bool)))
  }

  Expr::IsInt(inner) => {
      let result = eval_expr(inner, ctx)?;
      let is_int = matches!(result, ExprResult::Scalar(Value::Int64(_)));
      Ok(ExprResult::Scalar(Value::Bool(is_int)))
  }

  Expr::IsFloat(inner) => {
      let result = eval_expr(inner, ctx)?;
      let is_float = matches!(result, ExprResult::Scalar(Value::Float64(_)));
      Ok(ExprResult::Scalar(Value::Bool(is_float)))
  }

  Expr::IsNumeric(inner) => {
      let result = eval_expr(inner, ctx)?;
      let is_numeric = matches!(result,
          ExprResult::Scalar(Value::Int64(_)) | ExprResult::Scalar(Value::Float64(_)));
      Ok(ExprResult::Scalar(Value::Bool(is_numeric)))
  }

  Expr::IsString(inner) => {
      let result = eval_expr(inner, ctx)?;
      let is_string = matches!(result, ExprResult::Scalar(Value::String(_)));
      Ok(ExprResult::Scalar(Value::Bool(is_string)))
  }

  Expr::IsArray(inner) => {
      let result = eval_expr(inner, ctx)?;
      let is_array = matches!(result, ExprResult::List(_));
      Ok(ExprResult::Scalar(Value::Bool(is_array)))
  }

  Expr::IsObject(inner) => {
      let result = eval_expr(inner, ctx)?;
      let is_object = matches!(result, ExprResult::Struct(_));
      Ok(ExprResult::Scalar(Value::Bool(is_object)))
  }

  Expr::IsDate(inner) => {
      let result = eval_expr(inner, ctx)?;
      let is_date = matches!(result, ExprResult::Scalar(Value::Date(_)));
      Ok(ExprResult::Scalar(Value::Bool(is_date)))
  }

  Expr::IsDateTime(inner) => {
      let result = eval_expr(inner, ctx)?;
      let is_datetime = matches!(result, ExprResult::Scalar(Value::DateTime(_)));
      Ok(ExprResult::Scalar(Value::Bool(is_datetime)))
  }

  Expr::IsDuration(inner) => {
      let result = eval_expr(inner, ctx)?;
      let is_duration = matches!(result, ExprResult::Scalar(Value::Duration(_)));
      Ok(ExprResult::Scalar(Value::Bool(is_duration)))
  }
  ```

- [x] Handle null inputs (null is not any type):
  ```rust
  // For all type predicates, null returns false (null is not int, string, etc.)
  // Exception: is_null() returns true for null (already implemented)
  ```

#### 9.6.6 Enhanced TypeOf with Detailed Type Info

File: `crates/arbors-query/src/eval.rs`

- [x] Enhance existing `TypeOf` evaluation for containers:
  ```rust
  Expr::TypeOf(inner) => {
      let result = eval_expr(inner, ctx)?;
      let type_name = match &result {
          ExprResult::Scalar(v) => match v {
              Value::Null => "null",
              Value::Bool(_) => "bool",
              Value::Int64(_) => "int",
              Value::Float64(_) => "float",
              Value::String(_) => "string",
              Value::Date(_) => "date",
              Value::DateTime(_) => "datetime",
              Value::Duration(_) => "duration",
              Value::Binary(_) => "binary",
          }.to_string(),
          ExprResult::List(items) => {
              if items.is_empty() {
                  "array<unknown>".to_string()
              } else {
                  // Infer element type from first non-null element
                  let elem_type = items.iter()
                      .find_map(|item| match item {
                          ExprResult::Scalar(v) if !matches!(v, Value::Null) =>
                              Some(type_name_for_value(v)),
                          ExprResult::List(_) => Some("array"),
                          ExprResult::Struct(_) => Some("object"),
                          _ => None,
                      })
                      .unwrap_or("unknown");
                  format!("array<{}>", elem_type)
              }
          }
          ExprResult::Struct(fields) => {
              if fields.is_empty() {
                  "object{}".to_string()
              } else {
                  // Show field names (but not nested types to avoid huge strings)
                  let field_names: Vec<_> = fields.keys().take(5).collect();
                  if fields.len() > 5 {
                      format!("object{{{}, ...}}", field_names.join(", "))
                  } else {
                      format!("object{{{}}}", field_names.join(", "))
                  }
              }
          }
          ExprResult::Null => "null".to_string(),
      };
      Ok(ExprResult::Scalar(Value::String(type_name)))
  }
  ```

- [x] Add helper function for type names:
  ```rust
  fn type_name_for_value(v: &Value) -> &'static str {
      match v {
          Value::Null => "null",
          Value::Bool(_) => "bool",
          Value::Int64(_) => "int",
          Value::Float64(_) => "float",
          Value::String(_) => "string",
          Value::Date(_) => "date",
          Value::DateTime(_) => "datetime",
          Value::Duration(_) => "duration",
          Value::Binary(_) => "binary",
      }
  }
  ```

#### 9.6.7 Add Python Bindings

File: `python/src/lib.rs`

- [x] Add type predicate methods to `Expr` class:
  ```rust
  #[pymethods]
  impl PyExpr {
      /// Returns true if value is a boolean.
      fn is_bool(&self) -> PyExpr {
          PyExpr { inner: self.inner.clone().is_bool() }
      }

      /// Returns true if value is an integer.
      fn is_int(&self) -> PyExpr {
          PyExpr { inner: self.inner.clone().is_int() }
      }

      /// Returns true if value is a float.
      fn is_float(&self) -> PyExpr {
          PyExpr { inner: self.inner.clone().is_float() }
      }

      /// Returns true if value is numeric (int or float).
      fn is_numeric(&self) -> PyExpr {
          PyExpr { inner: self.inner.clone().is_numeric() }
      }

      /// Returns true if value is a string.
      fn is_string(&self) -> PyExpr {
          PyExpr { inner: self.inner.clone().is_string() }
      }

      /// Returns true if value is an array.
      fn is_array(&self) -> PyExpr {
          PyExpr { inner: self.inner.clone().is_array() }
      }

      /// Returns true if value is an object.
      fn is_object(&self) -> PyExpr {
          PyExpr { inner: self.inner.clone().is_object() }
      }

      /// Returns true if value is a Date.
      fn is_date(&self) -> PyExpr {
          PyExpr { inner: self.inner.clone().is_date() }
      }

      /// Returns true if value is a DateTime.
      fn is_datetime(&self) -> PyExpr {
          PyExpr { inner: self.inner.clone().is_datetime() }
      }

      /// Returns true if value is a Duration.
      fn is_duration(&self) -> PyExpr {
          PyExpr { inner: self.inner.clone().is_duration() }
      }
  }
  ```

#### 9.6.8 Update Type Stubs

File: `python/arbors/_arbors.pyi`

- [x] Add type predicate methods to `Expr` class:
  ```python
  class Expr:
      # ... existing methods ...

      # Type predicates
      def is_bool(self) -> Expr:
          """Returns true if the value is a boolean."""
          ...

      def is_int(self) -> Expr:
          """Returns true if the value is an integer."""
          ...

      def is_float(self) -> Expr:
          """Returns true if the value is a float."""
          ...

      def is_numeric(self) -> Expr:
          """Returns true if the value is numeric (int or float)."""
          ...

      def is_string(self) -> Expr:
          """Returns true if the value is a string."""
          ...

      def is_array(self) -> Expr:
          """Returns true if the value is an array (JSON array)."""
          ...

      def is_object(self) -> Expr:
          """Returns true if the value is an object (JSON object)."""
          ...

      def is_date(self) -> Expr:
          """Returns true if the value is a Date."""
          ...

      def is_datetime(self) -> Expr:
          """Returns true if the value is a DateTime."""
          ...

      def is_duration(self) -> Expr:
          """Returns true if the value is a Duration."""
          ...
  ```

#### 9.6.9 Add Rust Tests

File: `crates/arbors/tests/expr_acceptance.rs`

- [x] Test type predicates on primitive values:
  ```rust
  #[test]
  fn test_is_bool_true() {
      let arbor = read_json(r#"{"active": true}"#);
      let expr = path("active").is_bool();
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::Bool(true)));
  }

  #[test]
  fn test_is_bool_false_for_int() {
      let arbor = read_json(r#"{"value": 42}"#);
      let expr = path("value").is_bool();
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::Bool(false)));
  }

  #[test]
  fn test_is_int_true() {
      let arbor = read_json(r#"{"count": 42}"#);
      let expr = path("count").is_int();
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::Bool(true)));
  }

  #[test]
  fn test_is_float_true() {
      let arbor = read_json(r#"{"price": 19.99}"#);
      let expr = path("price").is_float();
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::Bool(true)));
  }

  #[test]
  fn test_is_numeric_for_int() {
      let arbor = read_json(r#"{"value": 42}"#);
      let expr = path("value").is_numeric();
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::Bool(true)));
  }

  #[test]
  fn test_is_numeric_for_float() {
      let arbor = read_json(r#"{"value": 3.14}"#);
      let expr = path("value").is_numeric();
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::Bool(true)));
  }

  #[test]
  fn test_is_string_true() {
      let arbor = read_json(r#"{"name": "Alice"}"#);
      let expr = path("name").is_string();
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::Bool(true)));
  }

  #[test]
  fn test_is_array_true() {
      let arbor = read_json(r#"{"items": [1, 2, 3]}"#);
      let expr = path("items").is_array();
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::Bool(true)));
  }

  #[test]
  fn test_is_object_true() {
      let arbor = read_json(r#"{"user": {"name": "Alice"}}"#);
      let expr = path("user").is_object();
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::Bool(true)));
  }

  #[test]
  fn test_is_null_false_for_value() {
      let arbor = read_json(r#"{"value": 42}"#);
      let expr = path("value").is_null();
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::Bool(false)));
  }

  #[test]
  fn test_type_predicates_on_null() {
      // All type predicates return false for null (except is_null)
      let arbor = read_json(r#"{"value": null}"#);

      assert_eq!(eval(&arbor, 0, &path("value").is_bool()).unwrap(),
          ExprResult::Scalar(Value::Bool(false)));
      assert_eq!(eval(&arbor, 0, &path("value").is_int()).unwrap(),
          ExprResult::Scalar(Value::Bool(false)));
      assert_eq!(eval(&arbor, 0, &path("value").is_string()).unwrap(),
          ExprResult::Scalar(Value::Bool(false)));
      assert_eq!(eval(&arbor, 0, &path("value").is_null()).unwrap(),
          ExprResult::Scalar(Value::Bool(true)));
  }
  ```

- [x] Test enhanced `TypeOf`:
  ```rust
  #[test]
  fn test_typeof_int() {
      let arbor = read_json(r#"{"value": 42}"#);
      let expr = path("value").type_of();
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::String("int".to_string())));
  }

  #[test]
  fn test_typeof_array() {
      let arbor = read_json(r#"{"items": [1, 2, 3]}"#);
      let expr = path("items").type_of();
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::String("array<int>".to_string())));
  }

  #[test]
  fn test_typeof_empty_array() {
      let arbor = read_json(r#"{"items": []}"#);
      let expr = path("items").type_of();
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::String("array<unknown>".to_string())));
  }

  #[test]
  fn test_typeof_object() {
      let arbor = read_json(r#"{"user": {"name": "Alice", "age": 30}}"#);
      let expr = path("user").type_of();
      let result = eval(&arbor, 0, &expr).unwrap();
      // Should contain field names
      let type_str = result.as_scalar().unwrap().as_str().unwrap();
      assert!(type_str.starts_with("object{"));
      assert!(type_str.contains("name"));
      assert!(type_str.contains("age"));
  }
  ```

- [x] Test type predicates with conditionals:
  ```rust
  #[test]
  fn test_type_check_in_when() {
      let arbor = read_json(r#"{"value": "hello"}"#);
      let expr = when(path("value").is_string())
          .then(path("value").str().to_upper())
          .otherwise(lit("N/A"));
      let result = eval(&arbor, 0, &expr).unwrap();
      assert_eq!(result, ExprResult::Scalar(Value::String("HELLO".to_string())));
  }

  #[test]
  fn test_filter_by_type() {
      let arbor = read_jsonl(r#"{"x": 42}
{"x": "hello"}
{"x": 3.14}"#);
      let matching = filter(&arbor, &path("x").is_int()).unwrap();
      assert_eq!(matching.len(), 1);
  }
  ```

#### 9.6.10 Add Python Tests

File: `python/tests/test_expr.py`

- [ ] Add test class for type predicates:
  ```python
  class TestTypePredicates:
      """Tests for type-checking predicates."""

      def test_is_bool(self):
          """is_bool returns Expr."""
          expr = path("active").is_bool()
          assert isinstance(expr, Expr)

      def test_is_int(self):
          """is_int returns Expr."""
          expr = path("count").is_int()
          assert isinstance(expr, Expr)

      def test_is_float(self):
          """is_float returns Expr."""
          expr = path("price").is_float()
          assert isinstance(expr, Expr)

      def test_is_numeric(self):
          """is_numeric returns Expr."""
          expr = path("value").is_numeric()
          assert isinstance(expr, Expr)

      def test_is_string(self):
          """is_string returns Expr."""
          expr = path("name").is_string()
          assert isinstance(expr, Expr)

      def test_is_array(self):
          """is_array returns Expr."""
          expr = path("items").is_array()
          assert isinstance(expr, Expr)

      def test_is_object(self):
          """is_object returns Expr."""
          expr = path("user").is_object()
          assert isinstance(expr, Expr)

      def test_is_date(self):
          """is_date returns Expr."""
          expr = path("created").is_date()
          assert isinstance(expr, Expr)

      def test_is_datetime(self):
          """is_datetime returns Expr."""
          expr = path("timestamp").is_datetime()
          assert isinstance(expr, Expr)

      def test_is_duration(self):
          """is_duration returns Expr."""
          expr = path("elapsed").is_duration()
          assert isinstance(expr, Expr)

      def test_type_predicate_in_filter(self):
          """Type predicates work in filter context."""
          expr = path("value").is_string()
          # Should be usable in filter (returns bool)
          assert isinstance(expr, Expr)

      def test_type_predicate_in_when(self):
          """Type predicates work in when condition."""
          expr = when(path("x").is_int()).then(lit("number")).otherwise(lit("other"))
          assert isinstance(expr, Expr)
  ```

#### 9.6.11 Edge Cases and Error Handling

- [ ] Document and test edge cases:

| Scenario | Expected Behavior |
|----------|-------------------|
| `is_int(null)` | Returns `false` (null is not int) |
| `is_string(null)` | Returns `false` (null is not string) |
| `is_null(null)` | Returns `true` (already implemented) |
| `is_array([])` | Returns `true` (empty array is still array) |
| `is_object({})` | Returns `true` (empty object is still object) |
| `type_of(null)` | Returns `"null"` |
| `type_of([1,2,3])` | Returns `"array<int>"` |
| `type_of([])` | Returns `"array<unknown>"` |
| `type_of({"a":1})` | Returns `"object{a}"` |
| `type_of({})` | Returns `"object{}"` |
| `is_numeric(int)` | Returns `true` |
| `is_numeric(float)` | Returns `true` |
| `is_numeric(string)` | Returns `false` |
| Vector input `path("items[*]").is_int()` | Returns vector of bools |

**Phase 9.6 Deliverables:**
- [x] 10 new Expr variants (`IsBool`, `IsInt`, `IsFloat`, `IsNumeric`, `IsString`, `IsArray`, `IsObject`, `IsDate`, `IsDateTime`, `IsDuration`)
- [x] 10 builder methods on Expr
- [x] LogicalPlan children handling for all variants
- [x] Type inference rules (all return Bool)
- [x] Evaluation implementation for all predicates
- [x] Enhanced `TypeOf` with container type info (`array<int>`, `object{...}`)
- [x] Python bindings for all predicates
- [x] Updated type stubs with documentation
- [x] 15+ Rust tests (16 tests added)
- [x] 12+ Python tests (19 tests added)
- [x] Edge case documentation

---

**Phase 9 Deliverables:**
- [ ] Date/time, string, list, struct operations
- [ ] Python accessors (`.dt`, `.list`, `.struct`)
- [ ] Extended conditional expressions
- [ ] 100+ additional tests

---

# Part III: Design Decisions & Reference

---

## M. Design Decisions (Resolved)

### M.1: Wildcard Semantics ✓

**Decision:** Wildcard paths return **vectors**. Users must explicitly reduce with `.any()` or `.all()`.

**Rationale:**
- Preserves cardinality information
- No hidden magic or implicit coercion
- Matches Polars' explicit philosophy
- `filter()` requires scalar bool, so the error message is clear if you forget `.any()`

**See also:** Section E.1, Section J.5

### M.2: Missing Path Behavior ✓

**Decision:** Missing paths return **Null** (lenient). Type mismatches return **Error** (strict).

**Rationale:**
- JSON data is often sparse; missing fields are normal
- Null propagates through expressions (`null + 1 = null`)
- Use `is_null()` or `coalesce()` to handle missing data explicitly
- Type errors (e.g., `"hello" + 5`) are bugs and should fail fast

**See also:** Section J.2, Section J.4

### M.3: Empty Aggregation Results ✓

**Decision:** `sum([]) = 0`, `count([]) = 0`, `mean([]) = Null`, `min([]) = Null`, `max([]) = Null`

**Rationale:**
- `sum` and `count` have natural identity elements (0)
- `mean`, `min`, `max` are undefined on empty sets → Null

**See also:** Section J.3

### M.4: Nested ExprResult Shapes ✓

**Decision:** `ExprResult` supports nested shapes: `Scalar`, `List(Vec<ExprResult>)`, `Struct(Map)`.

**Rationale:**
- Enables tree-building expressions
- Matches Arrow's nested types (ListArray, StructArray)
- Opens path to Polars-level richness

**See also:** Section B.3, Section H

### M.5: Index Semantics (Python-like, Strict) ✓

**Decision:** Array indexing follows Python semantics exactly. Out-of-bounds indices produce **errors**, not Null.

**Positive indices:**
- `items[0]` through `items[n-1]` return the element at that position
- Out-of-range (e.g., `items[5]` on a 3-element array) → `IndexError`

**Negative indices:**
- `items[-1]` refers to last element (computed as `items[len - 1]`)
- `items[-k]` refers to `items[len - k]`
- If computed index is out of range → `IndexError`

**Wildcards and filters (`[*]` and `[?expr]`):**
- Can yield 0, 1, or many results
- **Zero results is valid**, not an index error
- This preserves shape inference:
  - `items[3]` → Scalar **or error**
  - `items[*]` → Vector (0–N values)

**Rationale:**
- Predictable, strict, correct semantics matching Python
- Prevents silent data loss from out-of-bounds access
- Shape inference remains simple: fixed indices always produce Scalar or error
- Avoids surprises where incorrect paths silently produce Null
- Enables constant folding and optimization without silent nulls
- Type/cardinality inference can assume no silent index errors

**Example behavior:**
```python
items = [10, 20, 30]

path("items[0]")   # → 10
path("items[2]")   # → 30
path("items[-1]")  # → 30 (last element)
path("items[-3]")  # → 10 (first element)
path("items[3]")   # → IndexError (out of range)
path("items[-4]") # → IndexError (out of range)
path("items[*]")   # → [10, 20, 30] (vector, always succeeds)
```

**See also:** Section F.2, Section J.5

### M.6: API Terminology ✓

**Decision:** Use JSON terminology (`array`, `object`) as the canonical naming, with `list` and `struct` available as deprecated aliases for backward compatibility.

**Rationale:**
- Arbors is fundamentally a JSON/tree processing library
- JSON uses `array` and `object` as standard terminology
- Users familiar with JSON will find `array`/`object` more intuitive
- Non-breaking change: deprecated aliases still work, just emit messaging

**API Changes:**
```python
# Preferred:
path("items").array.get(0)
path("user").object.field("name")
array_([lit(1), lit(2)])
object_(name=path("user.name"))

# Deprecated (still functional):
path("items").list.get(0)      # Works, but .array is preferred
path("user").struct_.field()   # Works, but .object is preferred
list_([lit(1), lit(2)])        # Works, but array_() is preferred
struct_(name=...)              # Works, but object_() is preferred
```

**Type factory functions (for schema definitions):**
```python
# Preferred:
Object(name=String, age=Int64)

# Deprecated:
Struct(name=String, age=Int64)
```

**See also:** Phase 9.3 (Array Operations), Phase 9.4 (Object Operations)

### M.7: JSON Ergonomics Behavioral Options (Future Consideration)

**Question:** Should certain operations have more lenient JSON-friendly behavior?

**Options under consideration:**

**1. Out-of-bounds `array.get()`:**
- Current (strict): `array.get(index)` errors on out-of-bounds
- Alternative (lenient): `array.get(index)` returns `null` on out-of-bounds
  - Matches JavaScript behavior (`arr[100]` → `undefined`)
  - More forgiving for sparse data
  - Trade-off: silent data loss vs. explicit errors

**2. `array.contains()` with null:**
- Current: `[1, null, 3].contains(null)` → `null` (three-valued logic)
- Alternative: `[1, null, 3].contains(null)` → `true` (JavaScript-like)
  - Matches JavaScript `arr.includes(null)` behavior
  - More intuitive for JSON users
  - Trade-off: consistency with SQL semantics vs. JavaScript semantics

**3. Missing field behavior:**
- Current: Missing fields return `null` (already lenient)
- No change needed—this is already JSON-friendly

**Status:** These are documented as future behavioral options. The current implementation uses strict semantics matching Python/SQL. A future release may offer configuration flags or alternative method variants (e.g., `array.get_or_null()`).

---

## N. Open Questions

### N.1: Schema vs Schemaless

**Question:** How much do we rely on schemas for type checking and optimization?

**Options:**
- With schema: Full type checking at expression-build time, query optimization
- Without schema: Runtime type checking, less optimization possible

**Current thinking:** Support both. Schema enables more optimization but isn't required. Phase 8 can start schemaless; Phase 10+ adds schema-aware optimization.

### N.2: Group By

**Question:** How does grouping work for trees?

**Options:**
- Group trees by a path value (like SQL GROUP BY)
- Group within a single tree (aggregate nested arrays by key)

**Current thinking:** Defer to Phase 10. The basic expression system doesn't need grouping.

### N.3: Null Boolean Semantics

**Question:** How does `null` behave in boolean context?

**Options:**
- A: SQL-like three-valued logic (`null AND x = null`)
- B: Short-circuit (`true OR null = true`)
- C: Strict (null in boolean → error)

**Current choice:** Option A, with `filter()` treating null as false.

**See also:** Section J.2

---

## O. Assessment: Path to Polars-Level Richness

With these changes:

1. **Nested Shapes**
   Expressions can yield arbitrarily nested lists and structs → we can represent list columns, struct columns, list-of-structs, etc. But in a tree-native way.

2. **Tree-Building Expressions**
   `struct()` and `list()` allow the user to reshape trees, not just pick leaf values.

3. **Logical Plan (DAG)**
   Expressions are compositional and analyzable:
   - we can infer types and shapes
   - we can enforce `filter()` constraints
   - we can later push computation into ColumnarNodes/Arrow.

From here, everything you see in Polars' expression docs has a natural analog:
- Column expressions → path expressions
- Struct/list expressions → struct/list constructors
- Aggregations → same as Polars, but per-tree and cross-tree
- Lazy evaluation & optimization → logical plan / Phase 10

**You are no longer boxed into "fancy load/store."** This design is structurally capable of supporting a Polars-level API, but for hierarchical JSON/Tree workloads.

---

## P. Success Criteria

1. Expressions can construct nested trees, not just reference existing values (Section H)
2. Logical plan layer enables type/shape inference before execution (Section G)
3. All operations (filter, select, with_column, agg) use expressions (Section I)
4. Python API feels natural with operator overloading (Phase 8.3)
5. Path expressions handle arrays, nesting, and wildcards correctly (Section F.2, Section J.5)
6. Type/shape errors are detected early and are clear (Section E, Phase 8.5)
7. Performance is competitive with hand-written loops (Phase 8) and columnar (Phase 10)

---

## Q. Example Programs

These programs MUST work before Phase 8+9 is considered complete. They exercise the core expression system against real testdata.

**Test files:**
- Rust: `crates/arbors/tests/expr_acceptance.rs`
- Python: `python/tests/test_expr_acceptance.py`

### Q.1 Filter: Scalar Boolean (users.jsonl)

Filter JSONL rows by a simple scalar comparison.

```python
# Python
arbor = aq.read_jsonl_file("testdata/basic-jsonl/users.jsonl")
adults = arbor.filter(path("age") >= 30)
# Expected: 3 trees (Alice:30, Charlie:35, Eve:32)

active_adults = arbor.filter((path("age") >= 30) & (path("active") == True))
# Expected: 2 trees (Alice, Charlie)
```

```rust
// Rust
let arbor = read_jsonl_file("testdata/basic-jsonl/users.jsonl")?;
let adults = filter(&arbor, &path("age").ge(lit(30)))?;
assert_eq!(adults.num_trees(), 3);
```

### Q.2 Filter: Wildcard with any/all (news.jsonl)

Filter trees based on aggregating over nested arrays.

```python
# Python
arbor = aq.read_jsonl_file("testdata/basic-jsonl/news.jsonl")

# Trees where ANY entity has presence_score > 90
high_presence = arbor.filter((path("entities[*].presence_score") > 90).any())
# Expected: trees with Taylor Swift (95.1), Tesla (94.2), TikTok (96.2), etc.

# Trees where ALL entities have presence_score > 40
all_prominent = arbor.filter((path("entities[*].presence_score") > 40).all())
# Expected: subset where every entity is prominent
```

### Q.3 Select: Reshape Trees (stock-quotes.json)

Project and reshape tree structure using struct().

```python
# Python
arbor = aq.read_json_file("testdata/financial/stock-quotes.json")

# Extract summary of each quote
summary = arbor.select([
    struct_(
        ticker = path("quotes[*].symbol"),
        prices = struct_(
            current = path("quotes[*].price"),
            high = path("quotes[*].week52High"),
            low = path("quotes[*].week52Low"),
        ),
        volume = path("quotes[*].volume"),
    ).alias("stocks")
])
```

### Q.4 with_column: Add Computed Fields (news.jsonl)

Add new fields computed from existing data.

```python
# Python
arbor = aq.read_jsonl_file("testdata/basic-jsonl/news.jsonl")

enriched = (
    arbor
    .with_column("max_presence", path("entities[*].presence_score").max())
    .with_column("avg_presence", path("entities[*].presence_score").mean())
    .with_column("has_person", (path("entities[*].type") == "PERSON").any())
)

# Each tree now has max_presence, avg_presence, has_person fields
```

### Q.5 agg: Cross-Tree Aggregation (users.jsonl)

Aggregate values across all trees in an arbor.

```python
# Python
arbor = aq.read_jsonl_file("testdata/basic-jsonl/users.jsonl")

stats = arbor.agg([
    path("age").mean().alias("avg_age"),
    path("age").min().alias("min_age"),
    path("age").max().alias("max_age"),
    path("id").count().alias("user_count"),
    path("active").any().alias("any_active"),
    path("active").all().alias("all_active"),
])
# Expected: {"avg_age": 30.0, "min_age": 25, "max_age": 35, "user_count": 5, "any_active": true, "all_active": false}
```

### Q.6 Tree.filter: Per-Element Filtering (news.jsonl)

Filter array elements within a single tree using @.

```python
# Python
arbor = aq.read_jsonl_file("testdata/basic-jsonl/news.jsonl")
tree = arbor[0]  # First news article

# Keep only entities with high presence
high_presence_entities = tree.filter("entities", path("@.presence_score") > 50)
# Returns tree with entities array filtered

# Keep only ORG-type entities
orgs_only = tree.filter("entities", path("@.type") == "ORG")
```

### Q.7 Wildcard Path Traversal (earthquake GeoJSON)

Navigate nested structures with wildcards.

```python
# Python
arbor = aq.read_json_file("testdata/earthquake/usgs-earthquakes-sample.geojson")

# Extract all magnitudes
mags = arbor.select([
    path("features[*].properties.mag").alias("magnitudes"),
    path("features[*].properties.mag").max().alias("max_magnitude"),
    path("features[*].properties.mag").mean().alias("avg_magnitude"),
])

# Filter to significant earthquakes only
significant = arbor.select([
    struct_(
        quakes = path("features[?@.properties.mag > 5.0]"),
        count = path("features[?@.properties.mag > 5.0]").len(),
    ).alias("significant")
])
```

### Q.8 Nested struct() Construction (users.jsonl)

Build complex nested output structures.

```python
# Python
arbor = aq.read_jsonl_file("testdata/basic-jsonl/users.jsonl")

report = arbor.agg([
    struct_(
        demographics = struct_(
            avg_age = path("age").mean(),
            age_range = struct_(
                min = path("age").min(),
                max = path("age").max(),
            ),
        ),
        engagement = struct_(
            total_users = path("id").count(),
            active_users = path("active").sum(),  # true = 1, false = 0
            active_pct = path("active").mean(),   # proportion
        ),
    ).alias("summary")
])
```

### Q.9 Error Cases (Validation)

These MUST produce clear error messages:

```python
# Python
arbor = aq.read_jsonl_file("testdata/basic-jsonl/users.jsonl")

# ERROR: Vector bool in filter (must use .any() or .all())
try:
    arbor.filter(path("entities[*].presence_score") > 50)
except CardinalityError as e:
    assert ".any()" in str(e) or ".all()" in str(e)

# ERROR: Type mismatch (string + int)
try:
    arbor.select([path("name") + 5])
except TypeMismatchError:
    pass

# ERROR: Index out of range
try:
    arbor.select([path("nonexistent_array[10]")])
except IndexError:
    pass
```

### Q.10 Integration: Full Pipeline (news.jsonl)

End-to-end demonstration combining multiple operations.

```python
# Python
arbor = aq.read_jsonl_file("testdata/basic-jsonl/news.jsonl")

# Full analysis pipeline
result = (
    arbor
    # Filter to articles with high-presence entities
    .filter((path("entities[*].presence_score") > 80).any())
    # Add computed columns
    .with_column("top_entity", path("entities[0].text"))
    .with_column("entity_types", path("entities[*].type"))
    .with_column("max_presence", path("entities[*].presence_score").max())
    # Reshape to summary
    .select([
        path("headline").alias("headline"),
        path("top_entity").alias("top_entity"),
        path("max_presence").alias("max_presence"),
        path("entity_count").alias("num_entities"),
    ])
)

# Verify results
assert len(result) > 0
for tree in result:
    assert tree.path("max_presence").value > 80
```

---

## R. References

- [Polars Expression API](https://docs.pola.rs/api/python/stable/reference/expressions/index.html)
- [DuckDB Expressions](https://duckdb.org/docs/sql/expressions/overview.html)
- [JSONPath Specification](https://goessner.net/articles/JsonPath/)
- [JMESPath](https://jmespath.org/) (JSON query language)
- [Apache Arrow Nested Types](https://arrow.apache.org/docs/format/Columnar.html#nested-types)
