## Phase 11: Architectural Improvements to FactsStore {#phase-11}

**Purpose:** Evolve FactsStore from a Python-centric design to a language-agnostic architecture that can support Rust (and future languages) with a future-first schema and APIs.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | N/A |
| Last updated | 2026-01-24 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

FactsStore (`crates/tugtool-core/src/facts/mod.rs`) is the central semantic data model for tug refactoring operations. While the core tables (File, Module, Symbol, Reference, Import, ScopeInfo) are largely language-neutral, several aspects are Python-specific:

- `Export` type is explicitly designed for Python's `__all__` string literals
- `ScopeKind` enum includes Python-specific `Comprehension` and `Lambda` variants
- `ModuleKind` comments reference `__init__.py`
- `Import` structure (with `is_star` field) matches Python's import model

Additionally, the current design lacks features needed for multi-language support:
- No visibility/access control on `Symbol` (pub/private/protected)
- No trait/impl/interface modeling (only class inheritance via `InheritanceInfo`)
- `TypeInfo.type_repr` is just a string, with no structured type representation
- No language-agnostic export model

This phase establishes the architectural foundation for Rust support and future languages without constraining the schema to current Python assumptions.

#### Strategy {#strategy}

- **Future-first schema**: Optimize the data model for multi-language support, even if it requires changes to current Python-facing types
- **Visibility as a first-class concept**: Introduce a `Visibility` enum that generalizes across languages
- **Export generalization**: Create a language-agnostic export model that becomes the single source of truth
- **Adapter pattern**: Define a `LanguageAdapter` trait for language-specific analysis
- **Rust visibility mapping**: Use Rust's `pub`/`pub(crate)`/`pub(super)`/private as the stepping stone for the visibility model
- **Allow breaking changes**: Remove or replace Python-specific structures when a general model exists
- **No language-specific assumptions in FactsStore**: All language-specific logic belongs in language adapters (tugtool-python), not tugtool-core

#### Stakeholders / Primary Customers {#stakeholders}

1. Claude Code agent (primary consumer of tug refactoring)
2. Future Rust language support implementation
3. Plugin authors who may add new language support

#### Success Criteria (Measurable) {#success-criteria}

- `Symbol` struct includes `visibility` with a language-agnostic meaning
- `PublicExport` replaces legacy export modeling
- `ExportTarget` explicitly classifies export intent
- `ScopeKind` is extended (not replaced) for Rust scopes
- Documentation explains the visibility model and export generalization
- Golden tests verify the new schema (not legacy schema stability)
- Python analyzer implements `LanguageAdapter` trait
- Optional visibility inference for Python naming conventions (`_name`, `__name`) works correctly
- Structured type representation available via `TypeNode`
- FactsStore serialization includes `schema_version = 11`

#### Scope {#scope}

**Core schema changes:**
1. `Visibility` enum + `Symbol.visibility` field
2. `PublicExport` + `ExportKind` + `ExportTarget` (replaces legacy `Export`)
3. `ScopeKind` extended with Rust variants
4. `TypeNode` structured type representation
5. `FACTS_SCHEMA_VERSION = 11`

**Infrastructure:**
6. `LanguageAdapter` trait definition
7. `PythonAdapter` implementing `LanguageAdapter`
8. Python visibility inference (opt-in)
9. Python type annotation → `TypeNode` conversion

**Cleanup:**
10. Remove legacy `Export` type and all associated queries

#### Non-goals (Explicitly out of scope) {#non-goals}

- Full Rust analyzer implementation (deferred to future phase)
- Maintaining or preserving legacy export types or schemas
- Trait/impl modeling (deferred to Rust implementation phase)

#### Dependencies / Prerequisites {#dependencies}

- Phase 10 complete (cross-file alias tracking)
- Understanding of Rust's visibility model
- Review of rust-analyzer's semantic model (for future alignment)

#### Constraints {#constraints}

- No constraints on breaking changes to public API
- JSON serialization may change as needed for the new schema
- Performance: No regression in analysis speed
- **Critical**: No language-specific assumptions in FactsStore. Any language-specific logic belongs in tugtool-python, not tugtool-core.

#### Assumptions {#assumptions}

- Rust will be the next language supported after Python
- The visibility model can be generalized across C-family languages
- A single canonical export model is preferable to legacy coexistence

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Should Visibility be required or optional on Symbol? (DECIDED) {#q01-visibility-required}

**Question:** Should every Symbol have a visibility, or should it be optional?

**Why it matters:** Python has no visibility concept; forcing a value creates noise. But optional fields complicate queries.

**Options:**
- Option A: `visibility: Option<Visibility>` - None for Python symbols
- Option B: `visibility: Visibility` with `Visibility::Unspecified` variant

**Plan to resolve:** Design spike in Step 0

**Resolution:** DECIDED - Option A (optional). Python symbols have `None`, Rust symbols have explicit visibility. This matches reality and avoids "fake" values.

#### [Q02] How to handle Rust's pub(in path) visibility? (OPEN) {#q02-pub-in-path}

**Question:** Rust's `pub(in path)` allows arbitrary path restrictions. How to model this?

**Why it matters:** `pub(in crate::foo)` is more complex than our enum can capture.

**Options:**
- Option A: `Visibility::RestrictedTo(String)` with path as string
- Option B: `Visibility::Module` (catch-all for non-trivial restrictions)
- Option C: Defer to Rust analyzer phase

**Plan to resolve:** Research rust-analyzer's internal model

**Resolution:** DEFERRED to Rust implementation phase. For now, `Visibility::Module` can serve as the catch-all.

#### [Q03] Should LanguageAdapter be in tugtool-core or a separate crate? (DECIDED) {#q03-adapter-location}

**Question:** Where should the `LanguageAdapter` trait live?

**Why it matters:** Affects crate dependency graph and compile times.

**Options:**
- Option A: `tugtool-core::adapter` - simple, central location
- Option B: New `tugtool-lang` crate - isolates language-specific abstractions

**Plan to resolve:** Evaluate dependency impact

**Resolution:** DECIDED - Option A. The trait is small and core to the system. A separate crate adds complexity without benefit at this scale.

#### [Q04] Should TypeNode be recursive or flattened? (DECIDED) {#q04-typenode-structure}

**Question:** Should `TypeNode` use recursive structure (nested nodes) or flattened representation (arena-style)?

**Why it matters:** Affects serialization, memory layout, and API ergonomics.

**Options:**
- Option A: Recursive `Box<TypeNode>` - simple, natural tree structure
- Option B: Arena/ID-based - more efficient for large type graphs, harder to use
- Option C: String representation only (current `type_repr`) - defer structured types

**Plan to resolve:** Design spike in Step 8

**Resolution:** DECIDED - Option A (recursive). Start simple with boxed recursive structure. Can migrate to arena if performance becomes an issue.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Visibility model doesn't fit future languages | med | low | Research TypeScript/Go/Java visibility before finalizing | When adding 3rd language |
| Export generalization breaks Python rename | high | med | Update Python analyzer + rename ops to new model | Any export-related test failure |
| ScopeKind additions cause match exhaustiveness issues | low | med | Add `#[non_exhaustive]` or wildcard patterns | Clippy warnings in dependents |
| TypeNode adds complexity without immediate benefit | med | low | Keep type_repr as primary, TypeNode as optional | Structured types unused after 6 months |

**Risk R01: Schema Versioning Complexity** {#r01-schema-versioning}

- **Risk:** Schema changes will break any internal tooling that assumes the old shapes
- **Mitigation:** Update all internal consumers in this phase; add a `schema_version` to make future changes explicit
- **Residual risk:** Breakage in untracked internal tools

---

### 11.0 Design Decisions {#design-decisions}

#### [D01] Visibility Enum Design (DECIDED) {#d01-visibility-enum}

**Decision:** Create a `Visibility` enum with five variants covering common visibility levels across languages.

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Visibility {
    /// Accessible from anywhere (Python default, Rust `pub`)
    Public,
    /// Accessible within the crate/package (Rust `pub(crate)`)
    Crate,
    /// Accessible within the module and descendants (Rust `pub(super)`)
    Module,
    /// Accessible only within the defining scope (Rust private, Python `_name`)
    Private,
    /// Accessible within the class hierarchy (Java/C++ protected)
    Protected,
}
```

**Rationale:**
- Covers Rust: `pub` -> Public, `pub(crate)` -> Crate, `pub(super)` -> Module, private -> Private
- Covers Python conventions: public -> Public, `_name` -> Private, `__name` -> Private
- Covers Java/C++: public/private/protected map directly
- TypeScript/Go can also map to these variants

**Implications:**
- Python analyzer can optionally set visibility based on naming conventions (leading underscore)
- Rust analyzer will set visibility from syntax
- Query API can filter by visibility

#### [D02] Symbol Visibility is Optional (DECIDED) {#d02-symbol-visibility-optional}

**Decision:** Add `visibility: Option<Visibility>` to `Symbol` struct. Use `None` only when visibility is truly unknown.

```rust
pub struct Symbol {
    // ... existing fields ...
    /// Visibility/access control for this symbol.
    /// None for languages without visibility semantics (Python default).
    pub visibility: Option<Visibility>,
}
```

**Rationale:**
- Python has no formal visibility; forcing a value creates false precision
- `None` clearly means "visibility not applicable or not analyzed"
- Queries can filter `visibility.is_some()` for visibility-aware languages

**Implications:**
- Python analyzer must choose whether to set `None` or an explicit visibility based on naming conventions
- Rust analyzer will always set visibility
- Serialization can be explicit without preserving legacy shapes

#### [D03] PublicExport for Language-Agnostic Exports (DECIDED) {#d03-public-export}

**Decision:** Create `PublicExport` as the canonical export model across languages.

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicExport {
    /// Unique identifier for this export.
    pub export_id: PublicExportId,
    /// The symbol being exported (if resolved). None for glob exports.
    pub symbol_id: Option<SymbolId>,
    /// File containing this export declaration.
    pub file_id: FileId,
    /// Name as exported (may differ from symbol name due to aliasing).
    /// None for glob exports (`pub use foo::*;`).
    pub exported_name: Option<String>,
    /// Original name in source (for rename operations).
    /// None for glob exports or implicit exports (Go uppercase).
    pub source_name: Option<String>,
    /// Byte span of the export declaration (for edits).
    pub span: Span,
    /// Kind of export mechanism.
    pub export_kind: ExportKind,
    /// Target classification (single, glob, module, implicit).
    pub export_target: ExportTarget,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportKind {
    /// Python __all__ string literal
    PythonAll,
    /// Rust pub use re-export (named)
    RustPubUse,
    /// Rust pub use glob re-export (`pub use foo::*;`)
    RustPubUseGlob,
    /// Rust pub mod (module re-export)
    RustPubMod,
    /// JavaScript/TypeScript export statement
    JsExport,
    /// Go exported identifier (uppercase)
    GoExported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportTarget {
    Single,
    Glob,
    Module,
    Implicit,
}
```

**Handling Special Export Cases:**

| Export Type | `exported_name` | `source_name` | `symbol_id` | `export_kind` | `export_target` |
|-------------|-----------------|---------------|-------------|---------------|-----------------|
| Python `__all__ = ["foo"]` | `Some("foo")` | `Some("foo")` | resolved | `PythonAll` | `Single` |
| Rust `pub use foo::Bar;` | `Some("Bar")` | `Some("Bar")` | resolved | `RustPubUse` | `Single` |
| Rust `pub use foo::Bar as Baz;` | `Some("Baz")` | `Some("Bar")` | resolved | `RustPubUse` | `Single` |
| Rust `pub use foo::*;` | `None` | `None` | `None` | `RustPubUseGlob` | `Glob` |
| Rust `pub mod bar;` | `Some("bar")` | `Some("bar")` | module | `RustPubMod` | `Module` |
| Go `func Foo()` | `Some("Foo")` | `None` | resolved | `GoExported` | `Implicit` |

**Rationale:**
- Unifies "what is publicly exported" across languages
- Keeps language-specific details in `ExportKind`
- `symbol_id` links to the actual symbol for type-aware operations
- `source_name` vs `exported_name` handles aliased exports (Python: `__all__ = ["new_name"]` where original is `old_name`)
- `Option` fields handle glob exports and implicit exports where names are not individually enumerable
- `export_target` disambiguates intent for consumers

**Implications:**
- Python analyzer will emit `PublicExport` directly for `__all__`
- Rename operations should use `PublicExport` as the single export source
- Legacy `Export` is removed or deprecated internally

#### [D05] ScopeKind Extension Strategy (DECIDED) {#d05-scope-kind-extension}

**Decision:** Add Rust-specific `ScopeKind` variants without removing Python ones. Consider adding `#[non_exhaustive]` for future-proofing.

Current Python-oriented variants:
```rust
pub enum ScopeKind {
    Module,       // Works for both Python and Rust
    Class,        // Python class, Rust struct/enum (conceptually)
    Function,     // Works for both
    Comprehension, // Python-specific
    Lambda,       // Python-specific (Rust closures are different)
}
```

New Rust-relevant variants:
```rust
pub enum ScopeKind {
    // ... existing ...
    /// Rust impl block scope
    Impl,
    /// Rust trait definition scope
    Trait,
    /// Rust closure scope (different from Python lambda)
    Closure,
    /// Rust unsafe block
    Unsafe,
    /// Rust match arm scope
    MatchArm,
}
```

**Rationale:**
- Rust has fundamentally different scope concepts (impl, trait, unsafe blocks)
- Match arms create scopes in pattern matching
- Closures in Rust are different from Python lambdas (capture semantics)

**Implications:**
- Python code with `match` on `ScopeKind` needs wildcard or ignore new variants
- Consider `#[non_exhaustive]` attribute
- Documentation must clarify which variants apply to which languages

#### [D06] LanguageAdapter Trait Design (DECIDED) {#d06-language-adapter}

**Decision:** Define a `LanguageAdapter` trait in `tugtool-core` that language-specific crates implement.

```rust
/// Trait for language-specific analysis adapters.
///
/// Each supported language implements this trait to provide:
/// - Single-file analysis (scopes, symbols, references)
/// - Multi-file analysis with cross-file resolution
/// - Symbol lookup at positions
/// - Export collection
pub trait LanguageAdapter {
    /// The error type for this adapter.
    type Error: std::error::Error;

    /// Analyze a single file and return local analysis results.
    fn analyze_file(
        &self,
        file_id: FileId,
        path: &str,
        content: &str,
    ) -> Result<FileAnalysisResult, Self::Error>;

    /// Analyze multiple files with cross-file resolution.
    fn analyze_files(
        &self,
        files: &[(String, String)],
        store: &mut FactsStore,
    ) -> Result<AnalysisBundle, Self::Error>;

    /// Get the language this adapter supports.
    fn language(&self) -> Language;

    /// Check if this adapter can handle a file (by extension, content, etc.).
    fn can_handle(&self, path: &str) -> bool;
}
```

**Rationale:**
- Provides a common interface for language-agnostic tooling
- `can_handle` enables automatic language detection
- Associated error type allows language-specific error handling
- `FactsStore` remains the single source of truth

**Implications:**
- `tugtool-python` will implement `LanguageAdapter`
- `tugtool-rust` will implement `LanguageAdapter` when developed
- CLI can dispatch to appropriate adapter based on file type

#### [D07] TypeInfo Evolves with Optional Structured Types (DECIDED) {#d07-type-info-structured}

**Decision:** Add optional `TypeNode` to `TypeInfo` while keeping `type_repr` as the primary representation.

```rust
pub struct TypeInfo {
    pub symbol_id: SymbolId,
    /// String representation of the type (e.g., "MyClass", "List[int]").
    pub type_repr: String,
    /// Source of this type information.
    pub source: TypeSource,
    /// Optional structured type representation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured: Option<TypeNode>,
}
```

**Rationale:**
- Backward compatible: `type_repr` remains the primary representation
- Structured types enable type-aware operations without parsing strings
- Optional field means no overhead for simple cases
- Can be populated incrementally as type inference improves

**Implications:**
- Python analyzer can populate `structured` for common patterns (instantiation, annotation)
- Type queries can use either `type_repr` (simple) or `structured` (precise)
- Future Rust analyzer will populate both

#### [D08] TypeNode Design (DECIDED) {#d08-typenode-design}

**Decision:** Create a `TypeNode` enum for structured type representation.

```rust
/// Structured representation of a type.
///
/// This provides machine-readable type information beyond string representations.
/// Used for type-aware refactoring operations like method resolution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TypeNode {
    /// A named type (class, struct, primitive).
    Named {
        /// The fully-qualified type name.
        name: String,
        /// Generic type arguments, if any.
        #[serde(skip_serializing_if = "Vec::is_empty", default)]
        args: Vec<TypeNode>,
    },
    /// A union of types (Python Union, TypeScript |).
    Union {
        /// The member types.
        members: Vec<TypeNode>,
    },
    /// An optional type (Python Optional, Rust Option).
    Optional {
        /// The inner type.
        inner: Box<TypeNode>,
    },
    /// A function/callable type.
    Callable {
        /// Parameter types.
        params: Vec<TypeNode>,
        /// Return type.
        returns: Box<TypeNode>,
    },
    /// A tuple type.
    Tuple {
        /// Element types.
        elements: Vec<TypeNode>,
    },
    /// Unknown/unresolved type.
    Unknown,
}
```

**Rationale:**
- Covers common type patterns across Python, Rust, TypeScript
- Tagged enum serializes nicely to JSON for agent consumption
- `Unknown` variant for graceful degradation when type cannot be determined
- Recursive structure via `Box<TypeNode>` is simple and natural

**Implications:**
- Python analyzer can build `TypeNode` from type annotations
- Method resolution can use structured types for precision
- JSON output includes machine-readable types

#### [D09] Python Visibility Inference Strategy (DECIDED) {#d09-python-visibility}

**Decision:** Implement visibility inference for Python based on naming conventions, controlled by an option.

```rust
/// Options for Python analysis.
pub struct PythonAnalyzerOptions {
    /// Infer visibility from Python naming conventions.
    ///
    /// When enabled:
    /// - `_name` -> Private (single underscore convention)
    /// - `__name` -> Private (name mangling)
    /// - `__name__` -> Public (dunder methods are public API)
    /// - `name` -> None (no convention, visibility unknown)
    ///
    /// Default: false (all symbols have visibility = None)
    pub infer_visibility: bool,
}
```

**Rationale:**
- Python has no formal visibility, but naming conventions are widely followed
- Making it optional respects that conventions aren't enforced
- Dunder methods (`__init__`, `__str__`) are explicitly public API
- Name-mangled (`__name`) and internal (`_name`) are conventionally private

**Implications:**
- Default behavior unchanged (visibility = None)
- Agents can opt-in to visibility inference for more precise analysis
- Does not affect rename behavior (just informational)

**Limitations:**
- This is informational only and does not affect rename behavior or scope resolution
- Module-level dunders (`__all__`, `__version__`, `__author__`) are treated as public (technically correct, as they are part of module metadata API)
- Some edge cases may produce unexpected results:
  - `__slots__` is treated as public (dunder pattern), though it's internal implementation
  - Class-private name mangling (`__name`) in subclasses follows the pattern, not Python's actual mangling rules
- Future work could add more sophisticated heuristics (e.g., checking `__all__` membership, analyzing actual usage patterns)

#### [D10] ExportTarget Classification (DECIDED) {#d10-export-target}

**Decision:** Add an `ExportTarget` enum to make export intent explicit (single symbol vs glob vs module vs implicit).

```rust
/// What kind of target this export represents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportTarget {
    /// A single named symbol (e.g., `pub use foo::Bar;`, `__all__ = ["foo"]`).
    Single,
    /// A glob export (e.g., `pub use foo::*;`).
    Glob,
    /// A module export (e.g., `pub mod bar;`).
    Module,
    /// Implicit export by naming convention (e.g., Go uppercase).
    Implicit,
}
```

**Rationale:**
- Removes ambiguity when `exported_name`/`source_name` are `None`
- Lets consumers decide resolution strategies without inspecting language-specific syntax
- Keeps `export_kind` focused on mechanism while `ExportTarget` conveys intent

**Implications:**
- `PublicExport` includes `export_target: ExportTarget`
- Queries can filter by `ExportTarget`
- Glob and implicit exports are explicitly represented

#### [D11] Schema Version Placement (DECIDED) {#d11-schema-version}

**Decision:** Add `schema_version: u32` to the top-level FactsStore serialization output.

**Rationale:**
- Makes breaking schema changes explicit and machine-checkable
- Keeps versioning centralized at the root of the serialized facts
- Avoids duplicating version fields in nested structs

**Implications:**
- All JSON output that includes serialized FactsStore must include `schema_version`
- Golden tests should assert the version value
- Set `schema_version = 11` for this phase; increment on future breaking schema changes

---

### 11.0.1 Deep Dive: Visibility Model Mapping {#visibility-mapping}

This section details how visibility maps across languages.

**Table T01: Visibility Mapping Across Languages** {#t01-visibility-mapping}

| Language | Public | Crate | Module | Private | Protected |
|----------|--------|-------|--------|---------|-----------|
| **Rust** | `pub` | `pub(crate)` | `pub(super)`, `pub(in path)` | (default) | N/A |
| **Python** | (default) | N/A | N/A | `_name`, `__name` | N/A |
| **Java** | `public` | `package` (default) | N/A | `private` | `protected` |
| **TypeScript** | `export` (default) | N/A | N/A | `private` | `protected` |
| **Go** | Uppercase | (default lowercase) | N/A | lowercase | N/A |
| **C++** | `public` | N/A | N/A | `private` | `protected` |

**Rust Visibility Details:**

| Rust Syntax | Maps to `Visibility` | Notes |
|-------------|---------------------|-------|
| `pub` | `Public` | Accessible from anywhere |
| `pub(crate)` | `Crate` | Accessible within current crate |
| `pub(super)` | `Module` | Accessible in parent module |
| `pub(self)` | `Private` | Same as no visibility |
| `pub(in path)` | `Module` | Arbitrary path restriction, approximate |
| (none) | `Private` | Default is private |

**Python Visibility Conventions:**

| Python Pattern | Maps to `Visibility` | Notes |
|----------------|---------------------|-------|
| `name` | `None` or `Public` | No convention, or explicitly public |
| `_name` | `Private` | Convention: internal use |
| `__name` | `Private` | Name mangling, strongly private |
| `__name__` | `Public` | Dunder methods are public API |

**Note:** Python visibility mapping is optional. The Python analyzer may:
1. Leave `visibility = None` (current behavior, default)
2. Set `visibility` based on naming conventions (opt-in via `infer_visibility`)

---

### 11.0.2 Deep Dive: Export Model Generalization {#export-generalization}

This section explains how exports work across languages and how `PublicExport` generalizes them.

**Concept C01: What is an "Export"?** {#c01-export-definition}

An export is a declaration that makes a symbol accessible from outside its defining scope. Different languages have different mechanisms:

| Language | Export Mechanism | Example |
|----------|-----------------|---------|
| Python | `__all__` list | `__all__ = ["foo", "bar"]` |
| Rust | `pub use` | `pub use crate::internal::Foo;` |
| TypeScript | `export` keyword | `export { foo, bar };` |
| Go | Uppercase name | `func Foo()` vs `func foo()` |

**Python's `__all__` Specifics:**

- String literals in a list: `__all__ = ["name1", "name2"]`
- Can be augmented: `__all__ += ["extra"]`
- Affects `from module import *` behavior
- Rename operation must update the string content

The current `Export` type in FactsStore models this (to be **removed** and replaced by `PublicExport`):
```rust
// LEGACY - Will be removed in this phase
pub struct Export {
    pub export_id: ExportId,
    pub file_id: FileId,
    pub span: Span,        // Entire string literal including quotes
    pub content_span: Span, // Just the string content (for replacement)
    pub name: String,      // The exported name
}
```

**Note:** The legacy `Export` type and all associated queries (`exports`, `exports_in_file`, etc.) will be removed from FactsStore. `PublicExport` becomes the single source of truth for exports across all languages.

**Rust's `pub use` Specifics:**

- Re-exports items from other modules: `pub use foo::Bar;`
- Can alias: `pub use foo::Bar as Baz;`
- Can glob: `pub use foo::*;`
- Affects what's visible from the module

**Generalized `PublicExport`:**

The new `PublicExport` type captures the commonality:
- Something is being made publicly accessible
- There's a source name and an exported name (for aliasing)
- There's a span for editing
- There's a mechanism (`ExportKind`) for language-specific handling

---

### 11.0.3 Deep Dive: Structured Type Representation {#structured-types}

This section explains the `TypeNode` design and how it integrates with existing infrastructure.

**Concept C02: Why Structured Types?** {#c02-structured-types}

The current `TypeInfo.type_repr` is a string like `"List[int]"` or `"MyClass"`. While human-readable, it requires parsing to answer questions like:
- What is the base type? (List)
- What are the type arguments? (int)
- Is this type callable? What are its parameters?

**TypeNode** provides machine-readable answers:
```json
{
  "kind": "named",
  "name": "List",
  "args": [{"kind": "named", "name": "int", "args": []}]
}
```

**Table T02: TypeNode Coverage** {#t02-typenode-coverage}

| Python Type | TypeNode Representation |
|-------------|------------------------|
| `int` | `Named { name: "int", args: [] }` |
| `List[str]` | `Named { name: "List", args: [Named { name: "str" }] }` |
| `Dict[str, int]` | `Named { name: "Dict", args: [Named { name: "str" }, Named { name: "int" }] }` |
| `Optional[T]` | `Optional { inner: T }` |
| `Union[A, B]` | `Union { members: [A, B] }` |
| `Callable[[A], B]` | `Callable { params: [A], returns: B }` |
| `Tuple[A, B, C]` | `Tuple { elements: [A, B, C] }` |
| Unknown | `Unknown` |

**Integration with Existing Type Tracker:**

The Python `type_tracker.rs` already collects type information from:
- Assignments: `x = MyClass()` -> inferred type "MyClass"
- Annotations: `x: List[int]` -> annotated type "List[int]"

Step 9 will extend this to optionally build `TypeNode` when parsing type annotations.

---

### 11.1 Specification {#specification}

#### 11.1.1 Inputs and Outputs (Data Model) {#inputs-outputs}

**Inputs:**
- Source files (Python .py, Rust .rs)
- FactsStore populated by language analyzer

**Outputs:**
- New FactsStore schema with:
  - `Visibility` enum
  - `Symbol.visibility` field (optional)
  - `PublicExport` type and related storage
  - Extended `ScopeKind` enum
  - `TypeNode` structured type representation
  - `schema_version` at the root of FactsStore output
- `LanguageAdapter` trait definition
- Python adapter implementing the trait

**Key invariants:**
- Python behavior updated to use the new canonical types
- All new types are serializable with serde
- Deterministic ordering maintained for all collections
- No language-specific logic in FactsStore

#### 11.1.2 Terminology and Naming {#terminology}

- **Visibility**: Access control level of a symbol (public, private, etc.)
- **Export**: Declaration that makes a symbol part of the public API
- **PublicExport**: Language-agnostic export representation
- **LanguageAdapter**: Trait for language-specific analysis plugins
- **TypeNode**: Structured representation of a type

#### 11.1.3 Supported Features (Exhaustive) {#supported-features}

**Supported:**
- `Visibility` enum with 5 variants (Public, Crate, Module, Private, Protected)
- Optional visibility on `Symbol`
- `PublicExport` as the canonical export model
- Extended `ScopeKind` with Rust variants (Impl, Trait, Closure, Unsafe, MatchArm)
- `LanguageAdapter` trait definition
- Python adapter implementing `LanguageAdapter`
- Optional visibility inference for Python naming conventions
- `TypeNode` for structured type representation
- `ExportTarget` for explicit export classification
- `schema_version` included in FactsStore serialization

**Explicitly not supported:**
- `pub(in path)` as first-class concept (mapped to Module)
- Legacy `Export` type and compatibility shims
- Full Rust analyzer implementation

**Behavior when unsupported is encountered:**
- Unknown visibility -> `None` (not analyzed)
- Complex Rust visibility -> `Module` (conservative approximation)
- Unparseable type annotation -> `TypeNode::Unknown`

#### 11.1.4 Public API Surface {#public-api}

**New Types in `tugtool_core::facts`:**

```rust
// ============================================================================
// Visibility
// ============================================================================

/// Access control level for a symbol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Visibility {
    Public,
    Crate,
    Module,
    Private,
    Protected,
}

// ============================================================================
// PublicExport
// ============================================================================

/// Unique identifier for a public export.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct PublicExportId(pub u32);

/// Language-agnostic representation of a public export.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicExport {
    pub export_id: PublicExportId,
    /// The symbol being exported (if resolved). None for glob exports.
    pub symbol_id: Option<SymbolId>,
    pub file_id: FileId,
    /// Name as exported. None for glob exports (`pub use foo::*;`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exported_name: Option<String>,
    /// Original name in source. None for glob exports or implicit exports.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_name: Option<String>,
    pub span: Span,
    pub export_kind: ExportKind,
    pub export_target: ExportTarget,
}

/// The mechanism used to export a symbol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportKind {
    PythonAll,
    RustPubUse,
    RustPubUseGlob,
    RustPubMod,
    JsExport,
    GoExported,
}

/// What kind of target this export represents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportTarget {
    Single,
    Glob,
    Module,
    Implicit,
}

// ============================================================================
// Extended ScopeKind
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
#[non_exhaustive]
pub enum ScopeKind {
    // Existing variants
    #[default]
    Module,
    Class,
    Function,
    Comprehension,
    Lambda,
    // New Rust variants
    Impl,
    Trait,
    Closure,
    Unsafe,
    MatchArm,
}

// ============================================================================
// TypeNode
// ============================================================================

/// Structured representation of a type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TypeNode {
    Named {
        name: String,
        #[serde(skip_serializing_if = "Vec::is_empty", default)]
        args: Vec<TypeNode>,
    },
    Union {
        members: Vec<TypeNode>,
    },
    Optional {
        inner: Box<TypeNode>,
    },
    Callable {
        params: Vec<TypeNode>,
        returns: Box<TypeNode>,
    },
    Tuple {
        elements: Vec<TypeNode>,
    },
    Unknown,
}

// ============================================================================
// Updated Symbol
// ============================================================================

pub struct Symbol {
    pub symbol_id: SymbolId,
    pub kind: SymbolKind,
    pub name: String,
    pub decl_file_id: FileId,
    pub decl_span: Span,
    pub container_symbol_id: Option<SymbolId>,
    pub module_id: Option<ModuleId>,
    // Optional visibility; None means "not analyzed"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<Visibility>,
}

// ============================================================================
// Updated TypeInfo
// ============================================================================

pub struct TypeInfo {
    pub symbol_id: SymbolId,
    pub type_repr: String,
    pub source: TypeSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured: Option<TypeNode>,
}

// ============================================================================
// Updated FactsStore
// ============================================================================

pub const FACTS_SCHEMA_VERSION: u32 = 11;

pub struct FactsStore {
    /// Schema version for serialized output compatibility checks.
    pub schema_version: u32,
    // ... existing fields ...
}

impl FactsStore {
    pub fn new() -> Self {
        Self {
            schema_version: FACTS_SCHEMA_VERSION,
            // ... existing fields ...
        }
    }
}
```

**LanguageAdapter Trait in `tugtool_core::adapter`:**

```rust
use crate::facts::{FactsStore, FileId, Language};
use crate::patch::Span;

// ============================================================================
// Adapter Data Types
// ============================================================================
// These are simplified/flattened representations for passing data from
// language adapters to FactsStore.
//
// **ID Assignment Ownership:**
// - Adapters do NOT allocate SymbolId, ScopeId, ReferenceId, etc.
// - Adapters use local indices (usize) for parent/scope references within a file
// - FactsStore owns all ID generation via next_*_id() methods
// - The CLI (or whoever calls the adapter) is responsible for:
//   1. Calling adapter.analyze_files() to get adapter data types
//   2. Converting adapter data types to FactsStore types (allocating IDs)
//   3. Inserting into FactsStore via insert_*() methods

/// Scope information from single-file analysis.
pub struct ScopeData {
    /// Scope kind (Module, Function, Class, etc.)
    pub kind: ScopeKind,
    /// Byte span of the entire scope
    pub span: Span,
    /// Parent scope index in the file's scope list (None for module scope)
    pub parent_index: Option<usize>,
    /// Name of the scope (function name, class name, None for module)
    pub name: Option<String>,
}

/// Symbol information from single-file analysis.
pub struct SymbolData {
    /// Symbol kind (Variable, Function, Class, etc.)
    pub kind: SymbolKind,
    /// Symbol name
    pub name: String,
    /// Declaration span
    pub decl_span: Span,
    /// Index of containing scope in the file's scope list
    pub scope_index: usize,
    /// Inferred visibility (if applicable)
    pub visibility: Option<Visibility>,
}

/// Reference information from single-file analysis.
pub struct ReferenceData {
    /// Name being referenced
    pub name: String,
    /// Byte span of the reference
    pub span: Span,
    /// Index of containing scope in the file's scope list
    pub scope_index: usize,
    /// Whether this is a write (assignment target) or read
    pub is_write: bool,
}

/// Import information from single-file analysis.
pub struct ImportData {
    /// The module path being imported (e.g., "os.path")
    pub module_path: String,
    /// Imported name (None for `import module`)
    pub imported_name: Option<String>,
    /// Local alias (e.g., `as alias`)
    pub alias: Option<String>,
    /// Whether this is a star import
    pub is_star: bool,
    /// Byte span of the import statement
    pub span: Span,
}

/// Export information from single-file analysis.
pub struct ExportData {
    /// Exported name (None for glob exports)
    pub exported_name: Option<String>,
    /// Source name (None for glob exports or implicit)
    pub source_name: Option<String>,
    /// Byte span of the export declaration
    pub span: Span,
    /// Export mechanism
    pub export_kind: ExportKind,
    /// Export target classification
    pub export_target: ExportTarget,
}

/// Result of single-file analysis.
pub struct FileAnalysisResult {
    pub file_id: FileId,
    pub path: String,
    pub scopes: Vec<ScopeData>,
    pub symbols: Vec<SymbolData>,
    pub references: Vec<ReferenceData>,
    pub imports: Vec<ImportData>,
    pub exports: Vec<ExportData>,
}

/// Bundle of multi-file analysis results.
pub struct AnalysisBundle {
    pub file_results: Vec<FileAnalysisResult>,
    pub failed_files: Vec<(String, String)>, // (path, error)
}

/// Trait for language-specific analyzers.
pub trait LanguageAdapter {
    type Error: std::error::Error + Send + Sync + 'static;

    fn analyze_file(
        &self,
        file_id: FileId,
        path: &str,
        content: &str,
    ) -> Result<FileAnalysisResult, Self::Error>;

    fn analyze_files(
        &self,
        files: &[(String, String)],
        store: &mut FactsStore,
    ) -> Result<AnalysisBundle, Self::Error>;

    fn language(&self) -> Language;

    fn can_handle(&self, path: &str) -> bool;
}
```

---

### 11.2 Definitive Symbol Inventory {#symbol-inventory}

#### 11.2.1 New files {#new-files}

| File | Purpose |
|------|---------|
| `crates/tugtool-core/src/adapter.rs` | `LanguageAdapter` trait and related types |

#### 11.2.2 Modified files {#modified-files}

| File | Changes |
|------|---------|
| `crates/tugtool-core/src/facts/mod.rs` | Add `Visibility`, `PublicExport`, `TypeNode`, extend `ScopeKind`, update `Symbol`, update `TypeInfo` |
| `crates/tugtool-core/src/lib.rs` | Re-export `adapter` module |
| `crates/tugtool-python/src/analyzer.rs` | Implement `LanguageAdapter`, add visibility inference option |
| `crates/tugtool-python/src/lib.rs` | Export `PythonAdapter` type |
| `crates/tugtool-python/src/type_tracker.rs` | Add `TypeNode` building from annotations |

#### 11.2.3 Symbols to add {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `Visibility` | enum | `facts/mod.rs` | 5 variants: Public, Crate, Module, Private, Protected |
| `PublicExportId` | struct | `facts/mod.rs` | Newtype for u32 |
| `PublicExport` | struct | `facts/mod.rs` | Language-agnostic export |
| `ExportKind` | enum | `facts/mod.rs` | 6 variants: PythonAll, RustPubUse, RustPubUseGlob, RustPubMod, JsExport, GoExported |
| `ExportTarget` | enum | `facts/mod.rs` | 4 variants: Single, Glob, Module, Implicit |
| `TypeNode` | enum | `facts/mod.rs` | 6 variants for structured types |
| `FACTS_SCHEMA_VERSION` | const | `facts/mod.rs` | `u32 = 11` schema version |
| `ScopeKind::Impl` | variant | `facts/mod.rs` | Rust impl block |
| `ScopeKind::Trait` | variant | `facts/mod.rs` | Rust trait definition |
| `ScopeKind::Closure` | variant | `facts/mod.rs` | Rust closure |
| `ScopeKind::Unsafe` | variant | `facts/mod.rs` | Rust unsafe block |
| `ScopeKind::MatchArm` | variant | `facts/mod.rs` | Rust match arm |
| `Symbol::visibility` | field | `facts/mod.rs` | `Option<Visibility>` |
| `TypeInfo::structured` | field | `facts/mod.rs` | `Option<TypeNode>` |
| `LanguageAdapter` | trait | `adapter.rs` | Analyzer interface |
| `FileAnalysisResult` | struct | `adapter.rs` | Single-file result |
| `AnalysisBundle` | struct | `adapter.rs` | Multi-file result |
| `PythonAdapter` | struct | `tugtool-python/analyzer.rs` | Implements LanguageAdapter |
| `PythonAnalyzerOptions` | struct | `tugtool-python/analyzer.rs` | Analysis configuration |

---

### 11.3 Documentation Plan {#documentation-plan}

- [ ] Update CLAUDE.md with new types and their purpose (no legacy compatibility notes)
- [ ] Add rustdoc for all new public types
- [ ] Document visibility mapping table in module docs
- [ ] Add examples showing Python (visibility=None) vs Rust (visibility set)
- [ ] Document TypeNode structure and usage
- [ ] Document PythonAdapter and options

---

### 11.4 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test enum serialization, default values | Visibility, ExportKind, ExportTarget, TypeNode |
| **Golden** | Verify new schema format correctness | JSON output for Symbol, PublicExport, TypeNode, schema_version |
| **Integration** | Verify Python analyzer works with new types | End-to-end rename using new schema |
| **Adapter** | Verify LanguageAdapter produces correct output | PythonAdapter results match expectations |

#### Test Fixtures {#test-fixtures}

**Visibility Serialization:**
```rust
#[test]
fn visibility_serialization() {
    assert_eq!(serde_json::to_string(&Visibility::Public).unwrap(), "\"public\"");
    assert_eq!(serde_json::to_string(&Visibility::Crate).unwrap(), "\"crate\"");
}
```

**Symbol with None visibility (Python):**
```rust
#[test]
fn symbol_without_visibility_serializes_correctly() {
    let symbol = Symbol { ..., visibility: None };
    let json = serde_json::to_string(&symbol).unwrap();
    assert!(!json.contains("visibility")); // skip_serializing_if
}
```

**Symbol with visibility (Rust):**
```rust
#[test]
fn symbol_with_visibility_serializes_correctly() {
    let symbol = Symbol { ..., visibility: Some(Visibility::Public) };
    let json = serde_json::to_string(&symbol).unwrap();
    assert!(json.contains("\"visibility\":\"public\""));
}
```

**TypeNode Serialization:**
```rust
#[test]
fn typenode_named_serializes_correctly() {
    let node = TypeNode::Named { name: "List".to_string(), args: vec![
        TypeNode::Named { name: "int".to_string(), args: vec![] }
    ]};
    let json = serde_json::to_string(&node).unwrap();
    assert!(json.contains("\"kind\":\"named\""));
    assert!(json.contains("\"name\":\"List\""));
}
```

**ExportTarget Serialization:**
```rust
#[test]
fn export_target_serialization() {
    assert_eq!(serde_json::to_string(&ExportTarget::Single).unwrap(), "\"single\"");
    assert_eq!(serde_json::to_string(&ExportTarget::Glob).unwrap(), "\"glob\"");
}
```

**Schema Version Default:**
```rust
#[test]
fn facts_store_default_schema_version() {
    let store = FactsStore::new();
    assert_eq!(store.schema_version, FACTS_SCHEMA_VERSION);
    assert_eq!(FACTS_SCHEMA_VERSION, 11);
}
```

**Python Visibility Inference:**
```rust
#[test]
fn visibility_inference_private_underscore() {
    let options = PythonAnalyzerOptions { infer_visibility: true };
    let adapter = PythonAdapter::with_options(options);
    // Analyze file with _private_func
    // Assert visibility == Some(Private)
}

#[test]
fn visibility_inference_public_dunder() {
    let options = PythonAnalyzerOptions { infer_visibility: true };
    let adapter = PythonAdapter::with_options(options);
    // Analyze file with __init__ method
    // Assert visibility == Some(Public)
}
```

---

### 11.5 Execution Steps {#execution-steps}

#### Step 0: Preparation and Design Validation {#step-0}

**Commit:** `chore: prepare Phase 11 infrastructure`

**References:** [D01] Visibility Enum Design, [D02] Symbol Visibility Optional, (#context, #strategy)

**Artifacts:**
- Updated plan with resolved Q01

**Tasks:**
- [ ] Review rust-analyzer's visibility model for alignment
- [ ] Confirm `#[non_exhaustive]` approach for ScopeKind
- [ ] Verify serde serialization for new enums
- [ ] Confirm `FACTS_SCHEMA_VERSION = 11` and defaulting in `FactsStore::new()`

**Tests:**
- N/A (design step)

**Checkpoint:**
- [ ] Plan reviewed and approved
- [ ] No blocking questions remain

**Rollback:**
- Revert plan changes

**Commit after all checkpoints pass.**

---

#### Step 1: Add Visibility Enum and Update Symbol {#step-1}

**Commit:** `feat(facts): add Visibility enum and Symbol.visibility field`

**References:** [D01] Visibility Enum Design, [D02] Symbol Visibility Optional, Table T01, (#visibility-mapping)

**Artifacts:**
- `Visibility` enum in `facts/mod.rs`
- `Symbol.visibility: Option<Visibility>` field
- Updated `Symbol::new()` to default visibility to `None`

**Tasks:**
- [ ] Add `Visibility` enum with 5 variants
- [ ] Add `visibility: Option<Visibility>` to `Symbol` struct
- [ ] Add `#[serde(skip_serializing_if = "Option::is_none")]` for clean JSON
- [ ] Add `Symbol::with_visibility(self, v: Visibility) -> Self` builder method
- [ ] Update all `Symbol::new()` calls to not break (field is Option, defaults to None)

**Tests:**
- [ ] Unit: `Visibility` serialization roundtrip
- [ ] Unit: `Symbol` with `visibility: None` serializes correctly
- [ ] Unit: `Symbol` with `visibility: Some(Public)` serializes correctly
- [ ] Golden: Symbol schema matches new format

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-core visibility`
- [ ] `cargo nextest run -p tugtool-python`

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 2: Extend ScopeKind for Rust Support {#step-2}

**Commit:** `feat(facts): extend ScopeKind with Rust-specific variants`

**References:** [D05] ScopeKind Extension Strategy, (#scope-kind-extension)

**Artifacts:**
- Extended `ScopeKind` enum with Impl, Trait, Closure, Unsafe, MatchArm
- `#[non_exhaustive]` attribute on ScopeKind

**Tasks:**
- [ ] Add `#[non_exhaustive]` attribute to `ScopeKind`
- [ ] Add `Impl` variant
- [ ] Add `Trait` variant
- [ ] Add `Closure` variant
- [ ] Add `Unsafe` variant
- [ ] Add `MatchArm` variant
- [ ] Update any exhaustive matches in `tugtool-core` to use wildcards
- [ ] Update `ScopeKind` serialization (serde rename_all handles it)

**Tests:**
- [ ] Unit: New variant serialization
- [ ] Unit: Deserialization of existing variants still works
- [ ] Integration: Python analyzer still works

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-core scope`
- [ ] `cargo nextest run -p tugtool-python`
- [ ] `cargo clippy --workspace` (no exhaustiveness warnings)

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 3: Add PublicExport Type {#step-3}

**Commit:** `feat(facts): add PublicExport type as canonical export model`

**References:** [D03] PublicExport for Language-Agnostic Exports, [D10] ExportTarget, Concept C01, (#export-generalization)

**Artifacts:**
- `PublicExportId` newtype
- `PublicExport` struct
- `ExportKind` enum
- `ExportTarget` enum
- FactsStore storage and queries for PublicExport

**Tasks:**
- [ ] Add `PublicExportId` newtype with Display impl
- [ ] Add `ExportKind` enum (PythonAll, RustPubUse, RustPubUseGlob, RustPubMod, JsExport, GoExported)
- [ ] Add `ExportTarget` enum (Single, Glob, Module, Implicit)
- [ ] Add `PublicExport` struct with `Option<String>` for `exported_name` and `source_name`
- [ ] Add `public_exports: BTreeMap<PublicExportId, PublicExport>` to FactsStore
- [ ] Add `public_exports_by_file: HashMap<FileId, Vec<PublicExportId>>` index
- [ ] Add `public_exports_by_name: HashMap<String, Vec<PublicExportId>>` index (only for non-glob exports)
- [ ] Add `next_public_export_id()` generator
- [ ] Add `insert_public_export()` method
- [ ] Add `public_export()` lookup by ID
- [ ] Add `public_exports_in_file()` query
- [ ] Add `public_exports_named()` query
- [ ] Add `public_exports()` iterator

**Tests:**
- [ ] Unit: PublicExport CRUD operations
- [ ] Unit: ExportKind serialization
- [ ] Unit: ExportTarget serialization
- [ ] Unit: Query by name returns correct exports

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-core public_export`
- [ ] `cargo build -p tugtool-python` (compiles, legacy Export still exists)

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 3a: Remove Legacy Export and Migrate Python {#step-3a}

**Commit:** `refactor(facts): remove legacy Export, migrate Python to PublicExport`

**References:** [D03] PublicExport for Language-Agnostic Exports, (#export-generalization)

**Artifacts:**
- Legacy `Export` type removed
- Python analyzer emits `PublicExport`
- Rename operations use `PublicExport` queries

**Tasks:**
- [ ] **Remove legacy `Export` type** from FactsStore
- [ ] **Remove legacy export storage**: `exports`, `exports_by_file`, `exports_by_name`
- [ ] **Remove legacy export queries**: `export()`, `exports_in_file()`, `exports_named()`, `exports()`
- [ ] Update Python analyzer to emit `PublicExport` instead of legacy `Export`
- [ ] Update rename operations (`ops/rename.rs`) to use `PublicExport` queries
- [ ] Update any other code that references legacy `Export`

**Tests:**
- [ ] Integration: Python rename tests pass with new export model
- [ ] Golden: PublicExport serialization matches expected format

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-core`
- [ ] `cargo nextest run -p tugtool-python`
- [ ] `cargo nextest run -p tugtool` (CLI integration tests)

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 4: Define LanguageAdapter Trait {#step-4}

**Commit:** `feat(core): add LanguageAdapter trait for pluggable language support`

**References:** [D06] LanguageAdapter Trait Design, (#language-adapter)

**Artifacts:**
- New `crates/tugtool-core/src/adapter.rs` module
- `LanguageAdapter` trait
- Supporting types (`FileAnalysisResult`, `AnalysisBundle`)

**Tasks:**
- [ ] Create `crates/tugtool-core/src/adapter.rs`
- [ ] Define `ScopeData`, `SymbolData`, `ReferenceData`, `ImportData`, `ExportData` intermediate types
- [ ] Define `FileAnalysisResult` struct
- [ ] Define `AnalysisBundle` struct
- [ ] Define `LanguageAdapter` trait with associated Error type
- [ ] Add `pub mod adapter;` to `lib.rs`
- [ ] Re-export adapter types from `tugtool_core`
- [ ] Add documentation for the trait

**Tests:**
- [ ] Unit: Trait compiles (trait definition test)
- [ ] Documentation: Example in rustdoc compiles

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-core adapter`
- [ ] `cargo doc -p tugtool-core --open` (adapter docs render)

**Rollback:**
- Revert commit, delete adapter.rs

**Commit after all checkpoints pass.**

---

#### Step 5: Update Documentation and Examples {#step-5}

**Commit:** `docs: add Phase 11 documentation for visibility and exports`

**References:** All decisions, Table T01, Concept C01

**Artifacts:**
- Updated rustdoc
- Updated CLAUDE.md (if needed)
- Example code in docs

**Tasks:**
- [ ] Add module-level docs to `facts/mod.rs` explaining visibility model
- [ ] Add examples in `Visibility` rustdoc
- [ ] Add examples in `PublicExport` rustdoc
- [ ] Document `LanguageAdapter` usage pattern
- [ ] Review and update CLAUDE.md if schema changes affect agents

**Tests:**
- [ ] `cargo doc --workspace` succeeds
- [ ] Doc tests pass

**Checkpoint:**
- [ ] `cargo test --doc -p tugtool-core`

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 6: Golden Test Validation {#step-6}

**Commit:** `test: add golden tests for Phase 11 schema additions`

**References:** (#test-plan-concepts)

**Artifacts:**
- New golden test files for schema validation
- Schema version check

**Tasks:**
- [ ] Add golden test for Symbol with visibility
- [ ] Add golden test for PublicExport
- [ ] Verify updated golden tests pass
- [ ] Add schema version awareness if not present
- [ ] Add `FACTS_SCHEMA_VERSION = 11` in `facts/mod.rs`
- [ ] Set `FactsStore::new()` to use `FACTS_SCHEMA_VERSION`

**Tests:**
- [ ] Golden: New types serialize correctly (Symbol with visibility, PublicExport, TypeNode)
- [ ] Golden: Schema version field present and correct (`schema_version = 11`)

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool golden`
- [ ] `TUG_UPDATE_GOLDEN=1 cargo nextest run -p tugtool golden` (if intentional changes)

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 7: Implement LanguageAdapter for Python {#step-7}

**Commit:** `feat(python): implement LanguageAdapter trait for Python analyzer`

**References:** [D06] LanguageAdapter Trait Design, (#language-adapter)

**Artifacts:**
- `PythonAdapter` struct implementing `LanguageAdapter`
- `PythonAnalyzerOptions` for configuration
- Refactored `analyze_files` to use adapter internally

**Tasks:**
- [ ] Create `PythonAdapter` struct in `analyzer.rs`
- [ ] Create `PythonAnalyzerOptions` struct with defaults
- [ ] Implement `LanguageAdapter::analyze_file` by wrapping existing `analyze_file` function
- [ ] Implement `LanguageAdapter::analyze_files` by wrapping existing `analyze_files` function
- [ ] Implement `LanguageAdapter::language` returning `Language::Python`
- [ ] Implement `LanguageAdapter::can_handle` checking for `.py` extension
- [ ] Add `PythonAdapter::new()` constructor
- [ ] Add `PythonAdapter::with_options(options: PythonAnalyzerOptions)` constructor
- [ ] Export `PythonAdapter` from `tugtool_python`
- [ ] Add conversion from `FileAnalysis` to `FileAnalysisResult`
- [ ] Add conversion from `FileAnalysisBundle` to `AnalysisBundle`

**Tests:**
- [ ] Unit: `PythonAdapter::can_handle` returns true for `.py` files
- [ ] Unit: `PythonAdapter::can_handle` returns false for `.rs` files
- [ ] Unit: `PythonAdapter::language` returns `Language::Python`
- [ ] Integration: `PythonAdapter::analyze_files` produces same results as direct function call
- [ ] Integration: Existing rename tests pass with adapter

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python adapter`
- [ ] `cargo nextest run -p tugtool-python rename`
- [ ] `cargo nextest run --workspace`

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 8: Python Visibility Inference from Naming Conventions {#step-8}

**Commit:** `feat(python): add optional visibility inference from naming conventions`

**References:** [D09] Python Visibility Inference Strategy, Table T01 (Python section), (#visibility-mapping)

**Artifacts:**
- `infer_visibility` option in `PythonAnalyzerOptions`
- Visibility inference logic in symbol registration
- Updated Symbol population with visibility

**Tasks:**
- [ ] Add `infer_visibility: bool` field to `PythonAnalyzerOptions` (default: false)
- [ ] Create `infer_python_visibility(name: &str) -> Option<Visibility>` helper function:
  - `__name__` (dunders) -> `Some(Visibility::Public)`
  - `__name` (name mangling) -> `Some(Visibility::Private)`
  - `_name` (single underscore) -> `Some(Visibility::Private)`
  - `name` (no prefix) -> `None` (unknown)
- [ ] Update symbol registration in `analyze_files` Pass 2:
  - If `options.infer_visibility` is true, call `infer_python_visibility`
  - Set `Symbol.visibility` based on result
- [ ] Ensure visibility is propagated through `with_visibility` builder

**Tests:**
- [ ] Unit: `infer_python_visibility("_private")` returns `Some(Private)`
- [ ] Unit: `infer_python_visibility("__mangled")` returns `Some(Private)`
- [ ] Unit: `infer_python_visibility("__init__")` returns `Some(Public)`
- [ ] Unit: `infer_python_visibility("public_func")` returns `None`
- [ ] Integration: With `infer_visibility: false`, all symbols have `visibility: None`
- [ ] Integration: With `infer_visibility: true`, `_helper` has `visibility: Some(Private)`
- [ ] Integration: With `infer_visibility: true`, `__init__` has `visibility: Some(Public)`
- [ ] Integration: Existing tests pass with default options

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python visibility`
- [ ] `cargo nextest run -p tugtool-python`

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 9: Structured Type Representation {#step-9}

**Commit:** `feat(facts): add TypeNode for structured type representation`

**References:** [D07] TypeInfo Evolves with Optional Structured Types, [D08] TypeNode Design, Concept C02, Table T02, (#structured-types)

**Artifacts:**
- `TypeNode` enum in `facts/mod.rs`
- `TypeInfo.structured` field
- Type annotation parser in `type_tracker.rs`

**Tasks:**
- [ ] Add `TypeNode` enum to `facts/mod.rs` with variants:
  - `Named { name: String, args: Vec<TypeNode> }`
  - `Union { members: Vec<TypeNode> }`
  - `Optional { inner: Box<TypeNode> }`
  - `Callable { params: Vec<TypeNode>, returns: Box<TypeNode> }`
  - `Tuple { elements: Vec<TypeNode> }`
  - `Unknown`
- [ ] Add `#[serde(tag = "kind", rename_all = "snake_case")]` for clean JSON
- [ ] Add `structured: Option<TypeNode>` to `TypeInfo` struct
- [ ] Add `#[serde(skip_serializing_if = "Option::is_none")]` for clean JSON
- [ ] Add `TypeInfo::with_structured(self, node: TypeNode) -> Self` builder
- [ ] Update FactsStore to handle `TypeInfo.structured`

**Tests:**
- [ ] Unit: `TypeNode::Named` serialization roundtrip
- [ ] Unit: `TypeNode::Union` serialization roundtrip
- [ ] Unit: `TypeNode::Optional` serialization roundtrip
- [ ] Unit: `TypeNode::Callable` serialization roundtrip
- [ ] Unit: `TypeNode::Tuple` serialization roundtrip
- [ ] Unit: `TypeNode::Unknown` serialization roundtrip
- [ ] Unit: `TypeInfo` with `structured: None` serializes without field
- [ ] Unit: `TypeInfo` with `structured: Some(...)` includes field
- [ ] Golden: TypeInfo with structured types

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-core typenode`
- [ ] `cargo nextest run -p tugtool-core type_info`

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 10: Python Type Annotation to TypeNode Conversion {#step-10}

**Commit:** `feat(python): build TypeNode from type annotations`

**References:** [D08] TypeNode Design, Table T02, (#structured-types)

**Artifacts:**
- CST-based TypeNode builder in `type_tracker.rs`
- Updated type inference to populate `TypeInfo.structured`

**V1 Scope (Required for Phase Close):**
The following CST node types MUST be handled:
- `Name` - simple types (`int`, `str`, `MyClass`)
- `Attribute` - qualified types (`typing.List`, `module.Type`)
- `Subscript` - generic types (`List[int]`, `Dict[str, int]`)
- `BinOp` with `|` - PEP 604 unions (`str | int`)

The following special patterns in subscripts MUST be recognized:
- `Optional[T]`, `Union[A, B]`, `Callable[[...], R]`, `Tuple[...]`

**Explicitly Out of V1 Scope (return `None`):**
- `typing.Annotated[T, ...]` - metadata annotations
- `typing.Literal[...]` - literal types
- `typing.TypeVar` bounds and constraints
- Forward references as strings (`"MyClass"`)
- Complex expressions (lambdas, conditionals in annotations)

**Tasks:**
- [ ] Add `build_typenode_from_annotation(annotation_expr: &Expression) -> Option<TypeNode>` function to `type_tracker.rs`
  - Work with CST expression nodes directly (not string parsing)
  - Use existing infrastructure in `tugtool-python-cst` for expression traversal
- [ ] Handle CST node types for type annotations:
  - `Name` node -> `Named { name, args: [] }` (simple types like `int`, `str`)
  - `Attribute` node -> `Named { name: "module.Type", args: [] }` (qualified types)
  - `Subscript` node -> Generic types (extract base and slice for type args)
  - `BinOp` with `|` operator -> `Union { members: [...] }` (PEP 604 union syntax)
- [ ] Handle special generic patterns in subscript slices:
  - `Optional[T]` -> `Optional { inner: T }`
  - `Union[A, B, ...]` -> `Union { members: [A, B, ...] }`
  - `Callable[[A, B], R]` -> `Callable { params: [A, B], returns: R }`
  - `Tuple[A, B, C]` -> `Tuple { elements: [A, B, C] }`
  - Other generics -> `Named { name, args: [...] }`
- [ ] Return `None` for unparseable or complex annotations (graceful fallback to `type_repr` only)
- [ ] Update `analyze_types_from_analysis` to call `build_typenode_from_annotation` when annotation CST is available
- [ ] Add `build_typenode_for_inferred_type` for constructor calls (e.g., `x = MyClass()` -> `Named { name: "MyClass", args: [] }`)

**Tests:**
- [ ] Unit: CST `Name("int")` -> correct `Named { name: "int", args: [] }`
- [ ] Unit: CST `Subscript(Name("List"), Name("str"))` -> correct nested `Named`
- [ ] Unit: CST for `Dict[str, int]` -> correct multi-arg `Named`
- [ ] Unit: CST for `Optional[int]` -> correct `Optional`
- [ ] Unit: CST for `Union[str, int]` -> correct `Union`
- [ ] Unit: CST for `str | int` (BinOp) -> correct `Union`
- [ ] Unit: CST for `Callable[[int], str]` -> correct `Callable`
- [ ] Unit: CST for `Tuple[int, str, bool]` -> correct `Tuple`
- [ ] Unit: Complex/malformed CST -> returns `None`
- [ ] Integration: Annotated variable has `structured` populated
- [ ] Integration: Inferred type from constructor has `structured` populated

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python type`
- [ ] `cargo nextest run -p tugtool-python`

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 11: Final Integration and Cleanup {#step-11}

**Commit:** `chore: Phase 11 final integration and cleanup`

**References:** All decisions, (#exit-criteria)

**Artifacts:**
- All features integrated
- Documentation complete
- Tests passing

**Tasks:**
- [ ] Run full test suite
- [ ] Review and update CLAUDE.md with new capabilities
- [ ] Ensure all new public types are documented
- [ ] Verify JSON output matches expected schema
- [ ] Update any CLI help text if needed
- [ ] Remove any TODO comments from Phase 11 work

**Tests:**
- [ ] Full: `cargo nextest run --workspace`
- [ ] Clippy: `cargo clippy --workspace -- -D warnings`
- [ ] Docs: `cargo doc --workspace`

**Checkpoint:**
- [ ] `cargo nextest run --workspace`
- [ ] `cargo clippy --workspace -- -D warnings`
- [ ] `cargo doc --workspace`
- [ ] All exit criteria met

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

### 11.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** FactsStore rebuilt around a future-first visibility model, canonical PublicExport + ExportTarget, LanguageAdapter trait, structured type representation, and schema versioning, with Python adapter implementing the new architecture.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `Visibility` enum added with 5 variants
- [ ] `Symbol.visibility` is `Option<Visibility>` with explicit semantics
- [ ] `PublicExport` type added with storage and queries as the canonical export model
- [ ] `ScopeKind` extended with Rust variants, `#[non_exhaustive]`
- [ ] `LanguageAdapter` trait defined in `tugtool-core`
- [ ] `PythonAdapter` implements `LanguageAdapter` in `tugtool-python`
- [ ] Python visibility inference works with `infer_visibility` option
- [ ] `TypeNode` provides structured type representation
- [ ] Python type annotations convert to `TypeNode`
- [ ] FactsStore serialization includes `schema_version`
- [ ] Python tests pass after updating to the new schema
- [ ] Golden tests verify the new schema
- [ ] Documentation complete

**Acceptance tests:**
- [ ] `cargo nextest run --workspace` (all tests pass)
- [ ] `cargo clippy --workspace -- -D warnings` (no warnings)
- [ ] `cargo doc --workspace` (docs build)
- [ ] Golden tests assert `schema_version = 11`

#### Milestones (Within Phase) {#milestones}

**Milestone M01: Visibility Infrastructure** {#m01-visibility}
- [ ] Steps 1-2 complete
- [ ] Symbol can have visibility
- [ ] ScopeKind ready for Rust

**Milestone M02: Export Generalization** {#m02-export}
- [ ] Steps 3 + 3a complete
- [ ] PublicExport type available
- [ ] Legacy Export removed

**Milestone M03: Language Adapter Ready** {#m03-adapter}
- [ ] Step 4 complete
- [ ] LanguageAdapter trait defined

**Milestone M04: Python Adapter Complete** {#m04-python-adapter}
- [ ] Steps 7-8 complete
- [ ] PythonAdapter implements LanguageAdapter
- [ ] Python visibility inference available

**Milestone M05: Structured Types** {#m05-structured-types}
- [ ] Steps 9-10 complete
- [ ] TypeNode available
- [ ] Python type annotations convert to TypeNode

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Implement Rust analyzer with `LanguageAdapter` (future phase)
- [ ] Add more `ExportKind` variants as new languages are supported
- [ ] Type algebra operations on `TypeNode` (subtyping, intersection)
- [ ] Performance optimization: arena-based TypeNode if needed

| Checkpoint | Verification |
|------------|--------------|
| All tests pass | `cargo nextest run --workspace` |
| No clippy warnings | `cargo clippy --workspace -- -D warnings` |
| Docs build | `cargo doc --workspace` |
| Schema stable | Golden tests pass |

**Commit after all checkpoints pass.**
