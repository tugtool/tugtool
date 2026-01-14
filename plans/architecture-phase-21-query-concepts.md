If you want “rigor” and “optimization” to stop being vibes and start being engineering, the most useful mental model is:

You are designing a logical algebra over trees, plus a rewrite system (equivalences) and a costed physical planner.

People sometimes say “calculus,” but query optimizers in practice are much closer to algebra + term rewriting + cost models than to a calculus in the math sense.

1) The “right” foundation: a logical algebra (and laws)

Relational systems (SQL/Polars)

They formalize queries in something like relational algebra:
	•	operators: Scan, Filter, Project, Join, Aggregate, Sort, Limit, Union…
	•	equivalence laws: push filters down, reorder joins, eliminate unused columns, combine projections, etc.

That algebra gives you:
	1.	a canonical way to represent queries (an IR),
	2.	a library of proven-correct rewrite rules,
	3.	a clean boundary between logical and physical planning.

Tree/JSON systems (jq / JSONPath / XPath / SQL++)

For tree-shaped data, the “relational algebra” analogue is usually one of:
	•	Nested Relational Algebra (NRA): relations whose attributes can be arrays/objects (i.e., nested).
	•	Unnesting / Flattening algebras: explicit Unnest / Explode operators.
	•	Path / navigation algebras: GetField, GetIndex, Descend, Wildcard, RecursiveDescent, etc.
	•	Comprehension / monadic view (jq-ish): map/filter/fold over sequences (very “list monad”).

In your world (“polars meets jq meets sqlite”), you’ll likely want a hybrid algebra with:
	•	tabular operators (project/filter/group/join),
	•	tree navigation operators (path steps),
	•	sequence operators (map/filter/flatmap/zip),
	•	explicit unnest boundaries (because that’s where cardinality blows up).

Key design choice: make “turning a tree into a stream of rows” explicit in the algebra. If you don’t, optimization becomes guessy.

2) The optimizer’s job in one sentence

Rewrite the user’s query into a different but equivalent plan that is cheaper under your execution/storage model.

That breaks down into three layers:

A. Logical rewrites (rule-based, correctness-focused)

These do not depend on hardware details much.
Common families:
	•	Predicate pushdown: filter as early as possible.
	•	Projection pruning: only compute fields actually needed.
	•	Operator fusion: combine adjacent maps/filters, collapse path steps, avoid materialization.
	•	Common subexpression elimination: compute once, reuse.
	•	Reorder independent operations: commute operations when safe.
	•	Rewrite expensive navigation: e.g., replace recursive descent with indexed path lookup when semantics match.

For trees, you’ll add laws like:
	•	pushing a Filter through Unnest only when the predicate is on pre-unnest data (or when you can rewrite it to post-unnest form).
	•	commuting GetField with Project/Map.
	•	simplifying paths: GetField("a") ∘ GetField("b") ↔ GetPath(["a","b"]).

B. Physical planning (choose algorithms)

Same logical plan can run in different ways:
	•	scans: full scan vs indexed scan vs prefix/path scan
	•	joins: hash join vs sort-merge vs index nested-loop
	•	groupby: hash aggregate vs sort aggregate
	•	sorting: external vs in-memory; top-k shortcuts
	•	materialization: streaming vs buffer vs spill

For trees, physical planning often hinges on:
	•	whether navigation is interpreted step-by-step vs compiled into tight code,
	•	whether you can skip subtrees early (structural pruning),
	•	whether you can operate columnar on extracted fields instead of walking full trees.

C. Cost model + statistics (choose the “best”)

You need approximate answers to:
	•	How many rows after this unnest?
	•	What fraction passes this filter?
	•	How expensive is this path step?
	•	What’s the selectivity of field == "x"?
	•	How big is the intermediate?

Relational systems use histograms, NDV, sketches, sampling.
Tree systems often need stats per path (e.g. distribution of lengths, existence rates, value distributions) and per structure (depth/branching).

You can start with a crude cost model and improve it later, as long as your IR + rewrite framework is solid.

3) The “architecture pattern” most query systems converge on

Representation
	•	Parse → build an AST (close to user syntax)
	•	Lower to a Logical Plan IR (algebraic operators, typed)
	•	Apply rewrite rules to produce equivalent logical plans
	•	Choose a Physical Plan (algorithms, indexes, execution strategy)
	•	Execute via a runtime (vectorized / streaming / pipelined)

Optimization engines people copy (because they work)
	•	Volcano/Iterator model (simple, composable; can be slower if not vectorized)
	•	Vectorized execution (Polars/DuckDB style; fewer function calls)
	•	Cascades-style optimizer (memoize equivalent subplans + cost-based search)
	•	This is the “grown-up” way to do nontrivial plan search without writing a million ad-hoc passes.

If you want rigor + extensibility, a Cascades-ish memo + rule system is a great north star, even if you implement a smaller version first.

4) Indexes and “result set” optimization: what’s normal

Query systems optimize “result sets” mostly indirectly by:
	•	avoiding computing columns not returned,
	•	avoiding producing rows that will be filtered out later,
	•	exploiting limit/top-k early,
	•	using indexes to avoid scanning,
	•	choosing join/group algorithms that minimize intermediate size.

Index families relevant to tree/JSON:
	•	Path/value indexes: (path, value) -> locations (B-tree-ish or hash-ish)
	•	Inverted indexes: text/search semantics
	•	Structural indexes: accelerate descendant/ancestor queries (XPath world)
	•	Columnar extracted-field indexes: pre-extract common paths into columns with min/max, bloom filters, etc.
	•	Existence/shape indexes: “does this path exist?” fast checks

The big conceptual win is: treat “path extraction” like “computed columns” that can be:
	•	computed on the fly,
	•	cached/materialized,
	•	indexed.

5) How to decide a path for arbors (a practical framing)

Here’s a clean way to think about your design work:

Step 1: Define your core semantic domains
	•	What is a “row” in arbors? A node? A document? A sequence of nodes?
	•	When do you have set semantics vs sequence/order semantics?
	•	jq cares about order a lot; SQL often treats results as unordered until ORDER BY.
	•	What are null/missing/error semantics for path access?

Write these down. Optimization correctness depends on them.

Step 2: Pick (or invent) the minimal logical algebra that matches your product

Aim for a small, orthogonal operator set. Example buckets:
	•	Source: Scan(tree_array | tree_object | files | …)
	•	Navigation: GetField, GetIndex, GetPath, Descend, RecursiveDescend
	•	Shaping: Project, ConstructObject, ConstructArray
	•	Filtering: Filter(predicate)
	•	Iteration: Unnest/Explode, Map, FlatMap
	•	Relational: Join, GroupBy, Aggregate, Sort, Limit

Step 3: Specify equivalence rules (laws) with side conditions

This is where the rigor lives. Each rule states:
	•	pattern → replacement
	•	preconditions (order, null semantics, duplicates, errors, determinism)
	•	what metadata it preserves (schema, cardinality bounds, ordering)

Step 4: Build a rewrite engine that can scale

Even a simple e-graph or memo table gives you:
	•	many rewrites without exponential blowup,
	•	a place to attach costs,
	•	the ability to add rules without breaking everything.

Step 5: Start with a simple cost model + a few killer rules

Early “killer” optimizations in tree systems are usually:
	•	projection pruning of path extraction,
	•	predicate pushdown before unnest,
	•	unnest + filter fusion,
	•	using an index for path == constant predicates,
	•	limit/top-k pushdown.

6) A litmus test: can you explain every optimization as a law?

A good discipline is:

If an optimization can’t be expressed as an equivalence (or safe implication) over the logical algebra, it’s probably smuggling semantics or relying on accidents.

The moment you can state your rules precisely, you’ll feel the system “snap into place.”
