## Phase 11: Architectural Improvements to FactsStore {#phase-11}

**Purpose:** Evolve FactsStore from a Python-centric design to a language-agnostic architecture that can support Rust (and future languages) with a future-first schema and APIs.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | approved |
| Target branch | main |
| Tracking issue/PR | N/A |
| Last updated | 2026-01-25 |

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
- Import shape is Python-centric (`is_star`) and cannot represent richer models
- ModuleKind is Python-biased and cannot express directory-based modules cleanly

This phase establishes the architectural foundation for Rust support and future languages without constraining the schema to current Python assumptions.

#### Strategy {#strategy}

- **Future-first schema**: Optimize the data model for multi-language support, even if it requires changes to current Python-facing types
- **Visibility as a first-class concept**: Introduce a `Visibility` enum that generalizes across languages
- **Export generalization**: Create a language-agnostic export model that becomes the single source of truth
- **Export richness for refactors**: Store precise spans and metadata to support refactors beyond rename (move-class, move-module, etc.)
- **Export intent/origin**: Track declared vs effective exports and re-export chains
- **Adapter pattern**: Define a `LanguageAdapter` trait for language-specific analysis
- **Rust visibility mapping**: Use Rust's `pub`/`pub(crate)`/`pub(super)`/private as the stepping stone for the visibility model
- **Generalize imports and modules now**: Replace Python-only import/module assumptions in core schema
- **Extensible type model**: Make `TypeNode` extensible without core rewrites
- **Allow breaking changes**: Remove or replace Python-specific structures when a general model exists
- **No language-specific assumptions in FactsStore**: All language-specific logic belongs in language adapters (tugtool-python), not tugtool-core

#### Stakeholders / Primary Customers {#stakeholders}

1. Claude Code agent (primary consumer of tug refactoring)
2. Future Rust language support implementation
3. Plugin authors who may add new language support

#### Success Criteria (Measurable) {#success-criteria}

- `Symbol` struct includes `visibility` with a language-agnostic meaning
- `PublicExport` replaces legacy export modeling with precise spans and export intent/origin
- `ExportTarget` explicitly classifies export intent
- `ScopeKind` is extended (not replaced) for Rust scopes
- Documentation explains the visibility model and export generalization
- Golden tests verify the new schema (not legacy schema stability)
- Python analyzer implements `LanguageAdapter` trait
- Optional visibility inference for Python naming conventions (`_name`, `__name`) works correctly
- Structured type representation available via `TypeNode`
- Import model is generalized (`ImportKind`), and `ModuleKind` is no longer Python-biased
- PublicExport can represent both declared exports and effective public API
- FactsStore serialization includes `schema_version = 11`
- Adapter reference kinds preserve definitions and deletes
- `Module` includes an optional declaration span (inline module support)
- Attribute access and call-site facts are captured for refactoring fidelity
- Alias edges are persisted in FactsStore
- Symbols expose qualified names and modifiers
- Module resolution map supports namespace packages
- Signature and type parameter facts are represented

#### Scope {#scope}

**Core schema changes:**
1. `Visibility` enum + `Symbol.visibility` field
2. `PublicExport` + `ExportKind` + `ExportTarget` + `ExportIntent` + `ExportOrigin` (replaces legacy `Export`)
3. `PublicExport` spans for precise edits (decl span + name spans)
4. `ImportKind` + generalized `Import` (replaces `is_star`)
5. `ModuleKind` generalized for directory-based modules
6. `Module.decl_span` optional field (inline module support)
7. `ReferenceKind` includes `Delete` (adapter + FactsStore mapping)
8. Attribute access facts (`AttributeAccess`)
9. Call site facts (`CallSite`, `CallArg`)
10. Alias edges (`AliasEdge`)
11. Qualified names for symbols (`QualifiedName`)
12. Module resolution map (`ModuleResolution`)
13. Signature facts (`Signature`, `Parameter`)
14. Type parameter facts (`TypeParam`)
15. Symbol modifiers (`Modifier`)
16. `ScopeKind` extended with Rust variants
17. `TypeNode` structured type representation (extensible)
18. `FACTS_SCHEMA_VERSION = 11`

**Infrastructure:**
19. `LanguageAdapter` trait definition (clarify ID ownership and FactsStore mutation)
20. `PythonAdapter` implementing `LanguageAdapter`
21. Python visibility inference (opt-in)
22. Python type annotation → `TypeNode` conversion
23. Adapter output includes attribute access, call sites, alias edges, signatures, modifiers, type params

**Cleanup:**
24. Remove legacy `Export` type and all associated queries

#### Non-goals (Explicitly out of scope) {#non-goals}

- Full Rust analyzer implementation (deferred to future phase)
- Maintaining or preserving legacy export types or schemas
- Trait/impl modeling (deferred to Rust implementation phase)

#### Dependencies / Prerequisites {#dependencies}

- Phase 10 complete (cross-file alias tracking)
- Understanding of Rust's visibility model
- Review of rust-analyzer's semantic model (for future alignment)
- Audit downstream schema consumers (output + docs + golden files)

#### Downstream Schema Consumers (Audit Results) {#downstream-consumers}

**Will be updated in this phase:**
- `crates/tugtool-python/src/analyzer.rs` (exports, imports, ModuleKind, adapter)
- `crates/tugtool-python/src/ops/rename.rs` (export edits and queries)
- `crates/tugtool/tests/temporale_integration.rs` (export-driven assertions)
- `crates/tugtool/tests/fixtures/golden/python/**` (FactsStore schema golden files)

**Not updated in this phase (see [CQ1](#cq1-schema-version-independence), [CQ2](#cq2-visibility-output)):**
- `crates/tugtool-core/src/output.rs` - No agent-facing output changes
- `crates/tugtool-core/src/types.rs` - Visibility not exposed in SymbolInfo
- `docs/AGENT_API.md` - No output schema changes
- `crates/tugtool/tests/golden/output_schema/*.json` - Output schema unchanged
- `crates/tugtool/src/main.rs` - Output `SCHEMA_VERSION` unchanged

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

#### [Q05] What is the adapter ownership boundary for IDs and FactsStore mutation? (DECIDED) {#q05-adapter-boundary}

**Question:** Should language adapters directly mutate `FactsStore`, or should they return intermediate data that the caller inserts?

**Why it matters:** This determines ID ownership, layering, and testability. If adapters mutate `FactsStore`, they must understand ID allocation and storage invariants. If they return data, an integration layer can centralize ID allocation and keep adapters simpler.

**Options:**
- Option A: **Pure adapters** - Adapters return data (`FileAnalysisResult`/`AnalysisBundle`) with local indices; caller assigns IDs and inserts into `FactsStore`.
- Option B: **Mutating adapters** - Adapters receive `&mut FactsStore` and insert records directly (owning ID allocation).
- Option C: **Hybrid** - Adapters return data but also read `FactsStore` for cross-file resolution (read-only).

**Plan to resolve:** Design spike in Step 0. Document the chosen contract and enforce it in the trait signature and docs.

**Resolution:** DECIDED - Option C. Adapters return data; `FactsStore` is read-only input for cross-file resolution. ID allocation and insertion are centralized in the integration layer.

---

### Clarifying Questions Summary {#cq-summary}

This section documents clarifying questions raised during plan review and their resolutions.

#### [CQ1] Schema Version Independence (DECIDED) {#cq1-schema-version-independence}

**Question:** Should `SCHEMA_VERSION` (output.rs) and `FACTS_SCHEMA_VERSION` (facts/mod.rs) be aligned?

**Resolution:** Keep independent. They have different cadences and consumers:
- `SCHEMA_VERSION` in `output.rs` tracks agent-facing output format
- `FACTS_SCHEMA_VERSION` in `facts/mod.rs` tracks internal FactsStore schema

Update them independently as needed.

#### [CQ2] Visibility in Agent-Facing SymbolInfo (DECIDED) {#cq2-visibility-output}

**Question:** Should `Symbol.visibility` be exposed in the agent-facing `SymbolInfo` output type?

**Resolution:** Defer to future phase. For Phase 11, visibility remains in FactsStore only. Output schema (`output.rs`, `types.rs`) is not modified to add visibility fields.

#### [CQ3] AliasOutput vs PublicExport Relationship (DECIDED) {#cq3-alias-vs-export}

**Question:** How does `AliasOutput` relate to `PublicExport`?

**Resolution:** Orthogonal concepts:
- `AliasOutput` tracks value-level aliases within files (variables assigned to other symbols)
- `PublicExport` tracks module boundary exports (`__all__`, `pub use`, etc.)

No integration needed; they serve different purposes.

#### [CQ4] Adapter Schema Version Method (DECIDED) {#cq4-adapter-schema-version}

**Question:** Should `LanguageAdapter` have a `schema_version()` method?

**Resolution:** Not needed for Phase 11. Adapters compile against core types; version mismatch is a compile-time error. Defer runtime version checking to future phases if needed.

#### [CQ5] Cross-File Resolution with Read-Only FactsStore (DECIDED) {#cq5-cross-file-resolution}

**Question:** How should cross-file resolution work when adapters receive a read-only `&FactsStore`?

**Resolution:** Model A for Phase 11:
- Adapters treat `FactsStore` as **read-only context**
- For Phase 11, assume `FactsStore` is empty; adapters build all multi-file state internally
- Adapters return analysis data; the integration layer allocates IDs and inserts into `FactsStore`
- Model B (pre-populated store for incremental analysis) can be a future extension
- Model C (mutable store) is explicitly rejected

#### [CQ6] TypeInfo in Adapter Pattern (DECIDED) {#cq6-typeinfo-in-adapter}

**Question:** Should `FileAnalysisResult` include type information, or does type collection remain separate?

**Resolution:** Type collection should be part of adapter output. Add bundle-level `types: Vec<TypeInfoData>` to `AnalysisBundle` rather than per-file. The integration layer converts and inserts into `FactsStore`.

#### [CQ7] AliasEdge vs AliasOutput Relationship (DECIDED) {#cq7-aliasedge-vs-aliasoutput}

**Question:** What is the relationship between the new `AliasEdge` (FactsStore) and existing `AliasOutput` (output.rs)?

**Resolution:** Different layers, same semantic concept:
- `AliasEdge` → FactsStore storage, uses `SymbolId` for both alias and target
- `AliasOutput` → Agent-facing JSON output, uses string names with file/line/col

The conversion path is:
1. Python CST collectors produce `AliasInfo` (ephemeral, strings)
2. Adapter converts to `AliasEdgeData` (index-based references)
3. Integration layer converts to `AliasEdge` (SymbolId-based, persisted)
4. Query time: `AliasEdge` → `AliasOutput` for JSON serialization

**Implication:** Add `aliases_from_edges()` query method to convert `AliasEdge` to `AliasOutput`.

#### [CQ8] Python Analyzer Capability for New Facts (DECIDED) {#cq8-python-analyzer-capability}

**Question:** Does the Python analyzer currently support attribute access, call sites, signatures, and aliases?

**Resolution:** Based on code-architect analysis:

| Capability | Status | Gap |
|------------|--------|-----|
| **Alias tracking** | ✅ Complete | Add `AliasKind` enum, convert to symbol IDs |
| **Signatures** | ⚠️ Infrastructure exists | Create `SignatureCollector`, extract `ParamKind` |
| **Call sites** | ⚠️ Partial | Extend `MethodCallCollector` with argument walking |
| **Attribute access** | ⚠️ Partial | Add `AttributeAccessKind` (Read/Write/Call) detection |

**Key infrastructure exists:**
- `crates/tugtool-python-cst/src/visitor/reference.rs` - `ReferenceKind::Attribute`
- `crates/tugtool-python-cst/src/visitor/method_call.rs` - `MethodCallCollector`
- `crates/tugtool-python-cst/src/nodes/expression.rs` - `Parameters`, `Param`, `Arg` CST nodes
- `crates/tugtool-python/src/alias.rs` - `AliasGraph`, `AliasInfo`

**Work required:** Extend existing collectors, not build from scratch.

#### [CQ9] Confidence Field in AliasEdge (DECIDED) {#cq9-confidence-field}

**Question:** Is `AliasEdge.confidence: Option<f32>` Python-specific or language-agnostic?

**Resolution:** Language-agnostic, but optional. Change to `confidence: Option<f32>`:
- Python: `Some(0.0..1.0)` based on alias certainty (assignment vs conditional)
- Rust: `Some(1.0)` for `let x = y` (always certain)
- Languages with uncertain aliasing: Use graduated confidence
- Languages with no aliasing concept: `None`

This avoids fake values while supporting languages that need confidence scoring.

#### [CQ10] ParamKind Generality (DECIDED) {#cq10-paramkind-generality}

**Question:** The `ParamKind` enum has Python-specific variants. How does it generalize?

**Resolution:** Use `#[non_exhaustive]` and language-tagged variants:

```rust
#[non_exhaustive]
#[serde(rename_all = "snake_case")]
pub enum ParamKind {
    // Language-agnostic
    Regular,           // Default: standard named parameter

    // Python-specific
    PositionalOnly,    // Before / separator
    KeywordOnly,       // After * separator
    VarArgs,           // *args
    KwArgs,            // **kwargs

    // Rust-specific (future)
    SelfValue,         // self
    SelfRef,           // &self
    SelfMutRef,        // &mut self
}
```

Languages set only the variants they need:
- Python: All Python variants
- Rust: `Regular`, `SelfValue`, `SelfRef`, `SelfMutRef`
- Simple languages: Just `Regular`

`#[non_exhaustive]` allows adding language-specific variants without breaking existing code.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Visibility model doesn't fit future languages | med | low | Research TypeScript/Go/Java visibility before finalizing | When adding 3rd language |
| Export generalization breaks Python rename | high | med | Update Python analyzer + rename ops to new model | Any export-related test failure |
| ScopeKind additions cause match exhaustiveness issues | low | med | Add `#[non_exhaustive]` or wildcard patterns | Clippy warnings in dependents |
| TypeNode adds complexity without immediate benefit | med | low | Keep type_repr as primary, TypeNode as optional | Structured types unused after 6 months |
| Import/Module generalization regresses Python analysis | med | med | Update analyzer + tests, add import-specific regression tests | Import tests fail |
| Declared vs effective exports cause ambiguity | med | low | Document intent/origin semantics; add query helpers | Confusing export queries |
| ReferenceKind additions break exhaustive matches | low | med | Update matches and add tests | Clippy warnings |
| Origin module path unresolved | low | low | Log warning, leave origin_module_id None | Missing module mappings |
| Semantic facts add significant scope | med | med | Split into sub-steps (2.7a-e, 7a-d); verify CST capability per [CQ8] | Any sub-step takes >2 days |
| SignatureCollector requires new CST visitor | med | med | CST infrastructure exists ([CQ8]); just need extraction logic | Signature extraction blocked |
| Attribute read/write/call context detection | med | med | Extend ReferenceCollector with context tracking | Attribute facts incomplete |

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
    /// Byte span of the entire export declaration.
    pub decl_span: Span,
    /// Byte span of the exported name (alias or __all__ string content).
    /// None for glob/implicit exports where no explicit name exists.
    pub exported_name_span: Option<Span>,
    /// Byte span of the source/original name in the declaration.
    /// None for implicit exports or when source name is not present.
    pub source_name_span: Option<Span>,
    /// Whether this is a declared export or an effective/export-surface entry.
    pub export_intent: ExportIntent,
    /// Where this export originates (local vs re-export vs implicit).
    pub export_origin: ExportOrigin,
    /// Module that originated the export (re-export chain support).
    pub origin_module_id: Option<ModuleId>,
    /// Optional pointer to a prior export in the chain (when available).
    pub origin_export_id: Option<PublicExportId>,
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
pub enum ExportIntent {
    /// Explicit declaration site (e.g., __all__, pub use, export statement).
    Declared,
    /// Effective public API entry (includes derived/re-exported visibility).
    Effective,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportOrigin {
    /// Exported from the same module where it is defined.
    Local,
    /// Exported via re-export from another module.
    ReExport,
    /// Exported implicitly (e.g., Go uppercase, Rust pub items).
    Implicit,
    /// Unknown or unresolved origin.
    Unknown,
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

| Export Type | `exported_name` | `source_name` | `symbol_id` | `export_kind` | `export_target` | `export_intent` | `export_origin` |
|-------------|-----------------|---------------|-------------|---------------|-----------------|-----------------|-----------------|
| Python `__all__ = ["foo"]` | `Some("foo")` | `Some("foo")` | resolved | `PythonAll` | `Single` | `Declared` | `Local` |
| Rust `pub use foo::Bar;` | `Some("Bar")` | `Some("Bar")` | resolved | `RustPubUse` | `Single` | `Declared` | `ReExport` |
| Rust `pub use foo::Bar as Baz;` | `Some("Baz")` | `Some("Bar")` | resolved | `RustPubUse` | `Single` | `Declared` | `ReExport` |
| Rust `pub use foo::*;` | `None` | `None` | `None` | `RustPubUseGlob` | `Glob` | `Declared` | `ReExport` |
| Rust `pub mod bar;` | `Some("bar")` | `Some("bar")` | module | `RustPubMod` | `Module` | `Declared` | `Local` |
| Go `func Foo()` | `Some("Foo")` | `None` | resolved | `GoExported` | `Implicit` | `Effective` | `Implicit` |

**Rationale:**
- Unifies "what is publicly exported" across languages
- Keeps language-specific details in `ExportKind`
- `symbol_id` links to the actual symbol for type-aware operations
- `source_name` vs `exported_name` handles aliased exports (Python: `__all__ = ["new_name"]` where original is `old_name`)
- `export_intent` allows storing both declared exports and effective public API entries
- `export_origin` + optional origin fields support re-export chain reasoning
- `exported_name_span`/`source_name_span` enable precise edits for rename, move, and future refactors
- `Option` fields handle glob exports and implicit exports where names are not individually enumerable

**Span semantics:**
- `decl_span` always covers the full declaration
- `exported_name_span` points at the alias/name being exported (or __all__ string content)
- `source_name_span` points at the original source name when present
- `export_target` disambiguates intent for consumers

**Python `__all__` Span Semantics (Critical for Rename):**
For `__all__ = ["foo", "bar"]`:
```
               decl_span (full string literal with quotes)
               ├─────────┤
__all__ = ["foo", "bar"]
            │   │
            exported_name_span (content only, no quotes)
```
- `decl_span` covers `"foo"` (bytes 12-17, including quotes)
- `exported_name_span` covers `foo` (bytes 13-16, string content only)
- This matches the legacy `content_span` semantics
- Rename operations use `exported_name_span` for replacement (safe, preserves quotes)

**Implications:**
- Python analyzer will emit `PublicExport` directly for `__all__`
- Rename operations should use `PublicExport` as the single export source
- Effective exports can be computed and stored alongside declared exports for move-module operations
- Legacy `Export` is removed or deprecated internally
 - For Python `__all__`, `exported_name_span` points at the string content (replacement-safe)

#### [D04] Import and Module Generalization (DECIDED) {#d04-import-module-generalization}

**Decision:** Generalize the import model and module kinds to remove Python-specific assumptions.

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportKind {
    /// `import module` (Python), `use module` (Rust), `import * as` (TS)
    Module,
    /// `from module import name`
    Named,
    /// `import module as alias` or `from module import name as alias`
    Alias,
    /// `from module import *` / glob import
    Glob,
    /// Re-export (e.g., Rust `pub use`, TypeScript `export { ... } from`)
    ReExport,
    /// Default import (JavaScript/TypeScript)
    Default,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ModuleKind {
    /// Single-file module (e.g., `foo.rs`, `foo.py`).
    #[default]
    File,
    /// Directory-based module/package (Rust mod.rs, Go package, Python package).
    Directory,
    /// Inline module defined within another file (Rust `mod foo { ... }`).
    Inline,
    /// Namespace module (no concrete file, language-defined).
    Namespace,
}
```

**Import Builder Pattern:**

```rust
impl Import {
    /// Create a new import. Defaults to `ImportKind::Module` (bare `import foo`).
    pub fn new(module_path: &str) -> Self {
        Self { kind: ImportKind::Module, module_path: module_path.to_string(), ... }
    }

    /// Set imported name. Auto-sets kind to `Named`.
    pub fn with_imported_name(mut self, name: &str) -> Self {
        self.imported_name = Some(name.to_string());
        self.kind = ImportKind::Named;
        self
    }

    /// Set alias. Auto-sets kind to `Alias`.
    pub fn with_alias(mut self, alias: &str) -> Self {
        self.alias = Some(alias.to_string());
        self.kind = ImportKind::Alias;
        self
    }

    /// Set glob import. Sets kind to `Glob`.
    pub fn with_glob(mut self) -> Self {
        self.kind = ImportKind::Glob;
        self
    }

    /// Explicit kind override (for ReExport, Default, etc.).
    pub fn with_kind(mut self, kind: ImportKind) -> Self {
        self.kind = kind;
        self
    }
}
```

**Builder Precedence (Order-Independent):**
- If `with_kind(...)` is called, it **overrides** all auto-derived kinds.
- Else, kind is derived from fields in this order:
  1. `Glob` (if `with_glob()` called)
  2. `Alias` (if `alias` is set)
  3. `Named` (if `imported_name` is set)
  4. `Module` (default)

This makes `with_imported_name().with_alias()` and `with_alias().with_imported_name()` behave identically.

**Rationale:**
- `Import.is_star` is too narrow; different languages need richer import/re-export semantics.
- `ModuleKind::Package` is Python-biased; `Directory` is language-agnostic.
- `ModuleKind::Inline` needed for Rust `mod foo { ... }` blocks within a file.
- Explicit `ImportKind` supports future refactors (move-module, re-export rewrites).
- Builder pattern auto-sets `ImportKind` from context, reducing errors.
- Inline modules need a declaration span for precise edits.

**Implications:**
- Replace `Import.is_star` with `Import.kind: ImportKind`
- `Import::new()` defaults to `ImportKind::Module` (bare import)
- `with_imported_name()` auto-sets `ImportKind::Named`
- `with_alias()` auto-sets `ImportKind::Alias`
- `with_glob()` replaces `with_star()` and sets `ImportKind::Glob`
- Remove `with_star()` method entirely
- Update Python analyzer to use new builder pattern
- Builder precedence is order-independent (explicit `with_kind` overrides auto-derived kinds)
- Add `Module.decl_span: Option<Span>` to capture inline module declarations
- Inline modules set `file_id` to the containing file and `decl_span` to the module declaration
- Update module docs to avoid `__init__.py`-specific language
- Update any logic assuming `ModuleKind::Package`

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

**Decision:** Define a `LanguageAdapter` trait in `tugtool-core` that language-specific crates implement. Adapters return intermediate data; ID allocation and insertion into `FactsStore` is owned by the integration layer (CLI or caller). Adapters may read from `FactsStore` for cross-file resolution but do not mutate it.

**Cross-File Resolution Model (Model A):**
For Phase 11, adapters use **Model A**:
1. `FactsStore` passed to `analyze_files` is **read-only context** (typically empty for fresh analysis)
2. Adapters build all multi-file state **internally** (e.g., Python's multi-pass resolution)
3. Adapters return `AnalysisBundle` with all analysis data
4. The **integration layer** (CLI/caller) allocates IDs and inserts into `FactsStore`

This matches the current Python analyzer design where multi-file resolution happens internally across passes. See [CQ5](#cq5-cross-file-resolution) for rationale.

**Future extension (Model B):** For incremental analysis, the integration layer may pass a pre-populated `FactsStore` as context. The adapter reads existing data but still returns new analysis data for the caller to insert.

```rust
/// Trait for language-specific analysis adapters.
///
/// Each supported language implements this trait to provide:
/// - Single-file analysis (scopes, symbols, references)
/// - Multi-file analysis with cross-file resolution
/// - Symbol lookup at positions
/// - Export collection
///
/// **ID Ownership:** Adapters do NOT allocate any IDs (FileId, SymbolId, etc.).
/// All cross-references within adapter data use indices:
/// - `scope_index`: Index into `FileAnalysisResult.scopes`
/// - `symbol_index`: Index into `FileAnalysisResult.symbols`
/// - `file_index`: Index into `AnalysisBundle.file_results`
///
/// The integration layer allocates IDs and converts adapter data to FactsStore types.
///
/// **FactsStore Usage:** The `store` parameter is read-only context.
/// For Phase 11, it is typically empty. Adapters must not assume it
/// contains prior data.
pub trait LanguageAdapter {
    /// The error type for this adapter.
    type Error: std::error::Error;

    /// Analyze a single file and return local analysis results.
    ///
    /// **No FileId parameter:** Adapters do not need or allocate IDs.
    /// The integration layer assigns FileId after receiving results.
    fn analyze_file(
        &self,
        path: &str,
        content: &str,
    ) -> Result<FileAnalysisResult, Self::Error>;

    /// Analyze multiple files with cross-file resolution.
    ///
    /// The `store` is read-only context. For Phase 11, assume it is empty
    /// and build all cross-file state internally.
    fn analyze_files(
        &self,
        files: &[(String, String)],
        store: &FactsStore,
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
- Centralizing ID allocation preserves invariants and keeps adapters lightweight
- Read-only `FactsStore` keeps adapters simple and testable

**Implications:**
- `tugtool-python` will implement `LanguageAdapter`
- `tugtool-rust` will implement `LanguageAdapter` when developed
- CLI can dispatch to appropriate adapter based on file type
- Integration layer is responsible for ID allocation and FactsStore insertion

#### [D07] TypeInfo Evolves with Optional Structured Types (DECIDED) {#d07-type-info-structured}

**Decision:** Add optional `TypeNode` to `TypeInfo` while keeping `type_repr` as the primary representation. `TypeNode` is `#[non_exhaustive]` and includes an `Extension` variant for forward compatibility.

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
- Forward-compatible with Rust-specific constructs via `Extension`

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
#[non_exhaustive]
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
    /// Language-specific extension node.
    ///
    /// Reserved for future Rust/other-language constructs (reference, pointer,
    /// slice, array, trait objects, impl traits, never type, lifetimes).
    Extension {
        /// Extension name (e.g., "reference", "lifetime").
        name: String,
        /// Nested type arguments, if any.
        #[serde(skip_serializing_if = "Vec::is_empty", default)]
        args: Vec<TypeNode>,
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
- `#[non_exhaustive]` + `Extension` preserve forward compatibility for Rust-specific type constructs

**Reserved extension names (not implemented in Phase 11):**
- `reference`, `pointer`, `slice`, `array`, `trait_object`, `impl_trait`, `never`, `lifetime`

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

**Decision:** Add `schema_version: u32` to the top-level FactsStore serialization output. This is `FACTS_SCHEMA_VERSION` in `facts/mod.rs`.

**Two-Schema-Version Model:**
- `FACTS_SCHEMA_VERSION` in `facts/mod.rs`: Internal FactsStore schema version (set to 11 in this phase)
- `SCHEMA_VERSION` in `output.rs`: Agent-facing output format version (unchanged by this phase)

These versions are **independent** with different cadences and consumers. Update them separately as needed. See [CQ1](#cq1-schema-version-independence) for rationale.

**Rationale:**
- Makes breaking schema changes explicit and machine-checkable
- Keeps versioning centralized at the root of the serialized facts
- Avoids duplicating version fields in nested structs
- Separating internal and output schema versions allows independent evolution

**Implications:**
- All JSON output that includes serialized FactsStore must include `schema_version`
- Golden tests should assert the version value
- Set `FACTS_SCHEMA_VERSION = 11` for this phase; increment on future breaking schema changes
- `SCHEMA_VERSION` in `output.rs` is not modified in this phase

#### [D12] Re-export Modeling Rule (DECIDED) {#d12-reexport-rule}

**Decision:** A re-export creates **both** an `Import` and a `PublicExport` record.

```rust
// For Rust `pub use foo::Bar;`:
Import {
    kind: ImportKind::ReExport,
    module_path: "foo",
    imported_name: Some("Bar"),
    ...
}
PublicExport {
    export_origin: ExportOrigin::ReExport,
    exported_name: Some("Bar"),
    origin_module_id: Some(foo_module_id),
    ...
}

// For TypeScript `export { foo } from './bar';`:
Import { kind: ImportKind::ReExport, ... }
PublicExport { export_origin: ExportOrigin::ReExport, ... }
```

**Why both records:**
- The `Import` answers "what does this module depend on?" (provenance)
- The `PublicExport` answers "what does this module expose?" (visibility)
- Move-module refactors need both: update the import path AND update consumers of the export

**Language-specific notes:**
| Language | Re-export Syntax | Records Created |
|----------|-----------------|-----------------|
| **Rust** | `pub use foo::Bar;` | `Import(ReExport)` + `PublicExport(ReExport)` |
| **TypeScript** | `export { foo } from './bar';` | `Import(ReExport)` + `PublicExport(ReExport)` |
| **Python** | (no re-export syntax) | If name in `__all__` is imported: `Import(Named)` + `PublicExport(Local)` |

For Python, `origin_module_id` on `PublicExport` can point to where the symbol was originally defined to track re-export chains.

**Rationale:**
- Consistent representation across languages
- Supports move-module and re-export rewrite refactors
- Avoids duplicating logic to compute dependencies vs exports

**Implications:**
- Rust analyzer will create both records for `pub use`
- TypeScript analyzer will create both records for `export from`
- Python `__all__` with imported names creates `PublicExport(Local)` not `ReExport`

#### [D13] Python Effective Exports Deferred (DECIDED) {#d13-python-effective-exports}

**Decision:** For Phase 11, Python only emits `ExportIntent::Declared` for explicit `__all__` entries. `ExportIntent::Effective` computation is deferred to a future phase.

**Rationale:**
Python's "effective public API" when `__all__` is absent requires a second pass after all symbols are collected. It's orthogonal to the schema work and adds implementation complexity.

**Deferred effective export rule (documented for future implementation):**
```
If __all__ exists:
  effective_exports = declared_exports = __all__ entries

If __all__ absent:
  effective_exports = {
    module-level symbols where:
      - name doesn't start with "_", OR
      - name is "__dunder__"
    AND
      - symbol is defined in this file (not imported)
  }
```

**Phase 11 behavior:**
- Python analyzer emits `ExportIntent::Declared` for `__all__` entries only
- `ExportIntent::Effective` is reserved for languages like Go where public/private is implicit (uppercase)
- No effective export computation for Python in this phase

**Future phase:**
- Add `PythonAnalyzerOptions.compute_effective_exports: bool`
- When enabled, emit `ExportIntent::Effective` entries for module-level public symbols

#### [D14] ReferenceKind Generalization (DECIDED) {#d14-referencekind-generalization}

**Decision:** Preserve full reference semantics across adapter and FactsStore by:
- Adding `Definition` and `Delete` to adapter `ReferenceKind`
- Adding `Delete` to `facts::ReferenceKind`
- Mapping adapter kinds directly to FactsStore kinds in the integration layer

**Rationale:**
- Definitions are critical for rename and symbol reasoning
- Deletes are write-like but semantically distinct; future refactors need this fidelity
- Keeping adapter kinds explicit avoids collapsing semantics too early

**Mapping Rules (Adapter → FactsStore):**
| Adapter `ReferenceKind` | FactsStore `ReferenceKind` | Output Kind |
|-------------------------|----------------------------|-------------|
| Definition | Definition | definition |
| Read | Reference | reference |
| Write | Write | reference |
| Call | Call | call |
| Import | Import | import |
| Attribute | Attribute | attribute |
| TypeAnnotation | TypeAnnotation | reference |
| Delete | Delete | reference |

**Output Note:** The JSON output schema does not include "delete"; `Delete` maps to `"reference"` for output compatibility.

#### [D15] Deterministic Adapter Ordering (DECIDED) {#d15-deterministic-adapter-order}

**Decision:** Adapter output order is deterministic and index-based:
- `AnalysisBundle.file_results` **must preserve input order**
- `file_index` references that order
- Integration layer must not reorder without remapping indices

**Flexibility:** If a caller needs sorted output, it can sort the input file list before calling the adapter. This keeps indices stable while allowing deterministic ordering.

#### [D16] Attribute Access Facts (DECIDED) {#d16-attribute-access}

**Decision:** Store attribute access as first-class facts.

**Rationale:** Attribute access is foundational for method resolution, property refactors, and safe member renames.

**Model (language-agnostic):**
- `AttributeAccess { base_symbol_id: Option<SymbolId>, name: String, span: Span, kind: AttributeAccessKind }`
- `AttributeAccessKind`: Read, Write, Call

#### [D17] Call Site Facts (DECIDED) {#d17-call-sites}

**Decision:** Store call sites with argument structure and spans.

**Rationale:** Enables parameter rename, API migrations, and call‑site rewrites.

**Model:**
- `CallSite { callee_symbol_id: Option<SymbolId>, span: Span, args: Vec<CallArg> }`
- `CallArg { name: Option<String>, span: Span }`

#### [D18] Alias Edges in FactsStore (DECIDED) {#d18-alias-edges}

**Decision:** Persist alias relationships as FactsStore tables.

**Rationale:** Alias chains are critical for safe refactors and analysis; do not keep them only in output.

**Model:**
- `AliasEdge { alias_symbol_id, target_symbol_id, kind: AliasKind, confidence: Option<f32>, span }`
- `AliasKind`: Assignment, Import, ReExport, Unknown

#### [D19] Qualified Names and Modifiers (DECIDED) {#d19-qualified-names-modifiers}

**Decision:** Store qualified names and modifiers for symbols.

**Rationale:** Qualified names enable stable cross‑module identification; modifiers capture semantic attributes (async, static, classmethod, property, etc.) in a language‑agnostic way.

**Model:**
- `QualifiedName { symbol_id, path: String }`
- `Modifier`: Async, Static, ClassMethod, Property, Abstract, Final, Override, Generator

#### [D20] Module Resolution Map (DECIDED) {#d20-module-resolution}

**Decision:** Add a module resolution table mapping module path → file/module IDs.

**Rationale:** Supports namespace packages, multi‑file module resolution, and re‑export tracing.

**Model:**
- `ModuleResolution { module_path: String, module_ids: Vec<ModuleId> }`

#### [D21] Signature + Type Parameter Facts (DECIDED) {#d21-signatures-typeparams}

**Decision:** Store signatures and type parameters as first-class facts.

**Rationale:** Enables parameter rename, API migration, and generic type reasoning without language‑specific hacks.

**Model:**
- `Signature { symbol_id, params: Vec<Parameter>, returns: Option<TypeNode> }`
- `Parameter { name: String, kind: ParamKind, default_span: Option<Span>, annotation: Option<TypeNode> }`
- `ParamKind`: Regular, PositionalOnly, KeywordOnly, VarArgs, KwArgs, SelfValue, SelfRef, SelfMutRef
- `TypeParam { name: String, bounds: Vec<TypeNode>, default: Option<TypeNode> }`

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

**Declared vs Effective Exports:**
- **Declared**: Explicit export statements or lists (e.g., `__all__`, `pub use`, `export { ... }`).
- **Effective**: The resulting public API surface after language rules and re-exports are applied.

`PublicExport` supports both; it records intent (`ExportIntent`) and origin (`ExportOrigin`) so tools can differentiate use cases.

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
- There are precise spans for editing (declaration + name spans)
- There's a mechanism (`ExportKind`) for language-specific handling
- `ExportIntent` distinguishes declared exports from effective public API entries
- `ExportOrigin` enables re-export chain reasoning

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

### 11.0.4 Deep Dive: Import and Module Generalization {#import-generalization}

This section defines the generalized import and module model for multi-language support.

**Concept C03: Why ImportKind?**
- Python’s `from x import *` maps to a glob import, but other languages have default imports, re-exports, and module imports.
- `ImportKind` makes intent explicit and avoids Python-specific flags like `is_star`.

**Concept C04: ModuleKind as a Directory Model**
- Many languages model modules as directories: Rust (`mod.rs`), Go packages, Python packages.
- `ModuleKind::Directory` is a language-agnostic replacement for `Package` semantics.
- `ModuleKind::Namespace` captures virtual modules with no concrete file.

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
  - `PublicExport` type and related storage (intent/origin + precise spans)
  - Extended `ScopeKind` enum
  - Generalized `Import` (`ImportKind`)
  - Generalized `ModuleKind`
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
- `ExportIntent` and `ExportOrigin` for declared vs effective exports
- Precise export spans (declaration + name spans)
- Extended `ScopeKind` with Rust variants (Impl, Trait, Closure, Unsafe, MatchArm)
- `ImportKind` and generalized `Import` model
- Generalized `ModuleKind` (directory-based modules)
- `Module.decl_span` for inline module declarations
- `LanguageAdapter` trait definition
- Python adapter implementing `LanguageAdapter`
- Optional visibility inference for Python naming conventions
- `TypeNode` for structured type representation
- `ExportTarget` for explicit export classification
- `schema_version` included in FactsStore serialization
- `TypeNode` is `#[non_exhaustive]` with `Extension` for future constructs
- `ReferenceKind::Delete` in FactsStore + adapter `ReferenceKind::Definition`
- Attribute access facts (`AttributeAccess`)
- Call site facts (`CallSite`)
- Alias edges (`AliasEdge`)
- Qualified names (`QualifiedName`)
- Module resolution map (`ModuleResolution`)
- Signatures and parameters (`Signature`, `Parameter`, `ParamKind`)
- Type parameters (`TypeParam`)
- Symbol modifiers (`Modifier`)

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
// ModuleKind (generalized)
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ModuleKind {
    /// Single-file module (e.g., `foo.rs`, `foo.py`).
    #[default]
    File,
    /// Directory-based module/package (Rust mod.rs, Go package, Python package).
    Directory,
    /// Inline module defined within another file (Rust `mod foo { ... }`).
    Inline,
    /// Namespace module (no concrete file, language-defined).
    Namespace,
}

// ============================================================================
// Updated Module
// ============================================================================

pub struct Module {
    pub module_id: ModuleId,
    pub path: String,
    pub kind: ModuleKind,
    pub parent_module_id: Option<ModuleId>,
    pub file_id: Option<FileId>,
    /// Declaration span for inline modules (None for file/directory modules).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decl_span: Option<Span>,
}

// ============================================================================
// AttributeAccess
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct AttributeAccessId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttributeAccessKind {
    Read,
    Write,
    Call,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttributeAccess {
    pub access_id: AttributeAccessId,
    pub file_id: FileId,
    pub span: Span,
    pub base_symbol_id: Option<SymbolId>,
    pub name: String,
    pub kind: AttributeAccessKind,
}

// ============================================================================
// CallSite
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct CallSiteId(pub u32);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallArg {
    /// Argument name for keyword args, None for positional.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallSite {
    pub call_id: CallSiteId,
    pub file_id: FileId,
    pub span: Span,
    pub callee_symbol_id: Option<SymbolId>,
    pub args: Vec<CallArg>,
}

// ============================================================================
// AliasEdge
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct AliasEdgeId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AliasKind {
    Assignment,
    Import,
    ReExport,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AliasEdge {
    pub alias_id: AliasEdgeId,
    pub file_id: FileId,
    pub span: Span,
    pub alias_symbol_id: SymbolId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_symbol_id: Option<SymbolId>,
    pub kind: AliasKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
}

// ============================================================================
// QualifiedName + Modifiers
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QualifiedName {
    pub symbol_id: SymbolId,
    pub path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Modifier {
    Async,
    Static,
    ClassMethod,
    Property,
    Abstract,
    Final,
    Override,
    Generator,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SymbolModifiers {
    pub symbol_id: SymbolId,
    pub modifiers: Vec<Modifier>,
}

// ============================================================================
// ModuleResolution
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModuleResolution {
    pub module_path: String,
    pub module_ids: Vec<ModuleId>,
}

// ============================================================================
// Signature + TypeParam
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum ParamKind {
    Regular,
    PositionalOnly,
    KeywordOnly,
    VarArgs,
    KwArgs,
    SelfValue,
    SelfRef,
    SelfMutRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Parameter {
    pub name: String,
    pub kind: ParamKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_span: Option<Span>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotation: Option<TypeNode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Signature {
    pub symbol_id: SymbolId,
    pub params: Vec<Parameter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub returns: Option<TypeNode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TypeParam {
    pub name: String,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub bounds: Vec<TypeNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<TypeNode>,
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
    /// Span of the entire export declaration.
    pub decl_span: Span,
    /// Span of exported name (alias or __all__ string content).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exported_name_span: Option<Span>,
    /// Span of source/original name in the declaration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_name_span: Option<Span>,
    /// Declared vs effective export entry.
    pub export_intent: ExportIntent,
    /// Origin classification (local vs re-export vs implicit).
    pub export_origin: ExportOrigin,
    /// Origin module for re-export chains (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_module_id: Option<ModuleId>,
    /// Origin export for re-export chains (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_export_id: Option<PublicExportId>,
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

/// Declared vs effective export entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportIntent {
    Declared,
    Effective,
}

/// Origin classification for exports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportOrigin {
    Local,
    ReExport,
    Implicit,
    Unknown,
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
// ImportKind + generalized Import
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportKind {
    Module,
    Named,
    Alias,
    Glob,
    ReExport,
    Default,
}

/// An import statement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Import {
    pub import_id: ImportId,
    pub file_id: FileId,
    pub span: Span,
    pub module_path: String,
    pub imported_name: Option<String>,
    pub alias: Option<String>,
    pub kind: ImportKind,
}

// ============================================================================
// TypeNode
// ============================================================================

/// Structured representation of a type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[non_exhaustive]
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
    Extension {
        name: String,
        #[serde(skip_serializing_if = "Vec::is_empty", default)]
        args: Vec<TypeNode>,
    },
    Unknown,
}

// ============================================================================
// Updated ReferenceKind
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReferenceKind {
    Definition,
    Call,
    Reference,
    Import,
    Attribute,
    TypeAnnotation,
    Write,
    /// Delete expression (e.g., Python `del`).
    Delete,
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
use crate::facts::{ExportIntent, ExportOrigin, FactsStore, FileId, ImportKind, Language};
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
// - FactsStore passed to adapters is read-only (for cross-file resolution)

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

/// Reference kind for adapter output.
///
/// Mirrors `facts::ReferenceKind` but defined separately to keep adapters
/// independent of FactsStore internals. The integration layer maps between them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReferenceKind {
    Definition,
    Read,
    Write,
    Call,
    Import,
    Attribute,
    TypeAnnotation,
    Delete,  // Python del
}

/// Reference information from single-file analysis.
pub struct ReferenceData {
    /// Name being referenced
    pub name: String,
    /// Byte span of the reference
    pub span: Span,
    /// Index of containing scope in the file's scope list
    pub scope_index: usize,
    /// Kind of reference (read, write, call, etc.)
    pub kind: ReferenceKind,
}

/// Attribute access from single-file analysis.
pub struct AttributeAccessData {
    /// Index of base symbol in the file's symbol list (if resolved)
    pub base_symbol_index: Option<usize>,
    /// Attribute name
    pub name: String,
    /// Byte span of the attribute name
    pub span: Span,
    /// Attribute access kind
    pub kind: AttributeAccessKind,
}

/// Call site from single-file analysis.
pub struct CallSiteData {
    /// Index of callee symbol in the file's symbol list (if resolved)
    pub callee_symbol_index: Option<usize>,
    /// Byte span of the call expression
    pub span: Span,
    /// Call arguments
    pub args: Vec<CallArgData>,
}

/// Call argument from single-file analysis.
pub struct CallArgData {
    /// Argument name for keyword args, None for positional
    pub name: Option<String>,
    /// Byte span of the argument expression
    pub span: Span,
}

/// Alias edge from single-file analysis.
pub struct AliasEdgeData {
    /// Index of alias symbol in the file's symbol list
    pub alias_symbol_index: usize,
    /// Index of target symbol in the file's symbol list (if resolved)
    pub target_symbol_index: Option<usize>,
    /// Byte span of the aliasing expression
    pub span: Span,
    /// Alias kind
    pub kind: AliasKind,
    /// Confidence score (0.0-1.0), if available
    pub confidence: Option<f32>,
}

/// Qualified name from single-file analysis.
pub struct QualifiedNameData {
    /// Index of symbol in the file's symbol list
    pub symbol_index: usize,
    /// Fully-qualified name
    pub path: String,
}

/// Signature from single-file analysis.
pub struct SignatureData {
    /// Index of symbol in the file's symbol list
    pub symbol_index: usize,
    /// Parameters
    pub params: Vec<ParameterData>,
    /// Optional return type
    pub returns: Option<TypeNode>,
}

/// Parameter from single-file analysis.
pub struct ParameterData {
    pub name: String,
    pub kind: ParamKind,
    pub default_span: Option<Span>,
    pub annotation: Option<TypeNode>,
}

/// Type parameter from single-file analysis.
pub struct TypeParamData {
    pub name: String,
    pub bounds: Vec<TypeNode>,
    pub default: Option<TypeNode>,
}

/// Modifiers from single-file analysis.
pub struct ModifierData {
    /// Index of symbol in the file's symbol list
    pub symbol_index: usize,
    pub modifiers: Vec<Modifier>,
}

/// Import information from single-file analysis.
pub struct ImportData {
    /// The module path being imported (e.g., "os.path")
    pub module_path: String,
    /// Imported name (None for `import module`)
    pub imported_name: Option<String>,
    /// Local alias (e.g., `as alias`)
    pub alias: Option<String>,
    /// Import kind classification
    pub kind: ImportKind,
    /// Byte span of the import statement
    pub span: Span,
}

/// Export information from single-file analysis.
pub struct ExportData {
    /// Exported name (None for glob exports)
    pub exported_name: Option<String>,
    /// Source name (None for glob exports or implicit)
    pub source_name: Option<String>,
    /// Span of the export declaration
    pub decl_span: Span,
    /// Span of exported name (alias or __all__ string content)
    pub exported_name_span: Option<Span>,
    /// Span of source/original name
    pub source_name_span: Option<Span>,
    /// Export mechanism
    pub export_kind: ExportKind,
    /// Export target classification
    pub export_target: ExportTarget,
    /// Declared vs effective export
    pub export_intent: ExportIntent,
    /// Origin classification
    pub export_origin: ExportOrigin,
    /// Origin module path (optional, for re-export chains)
    pub origin_module_path: Option<String>,
}

/// Type information from analysis.
///
/// Collected at the bundle level rather than per-file because type resolution
/// may require cross-file context.
///
/// **Index Semantics:**
/// - `file_index`: Index into `AnalysisBundle.file_results` array
/// - `symbol_index`: Index into `FileAnalysisResult.symbols` for that file
///
/// The integration layer uses these indices to resolve actual IDs after
/// allocating FileId/SymbolId for each entry.
///
/// **Invalid Index Handling:**
/// If `file_index` or `symbol_index` is out of bounds during integration:
/// - Log a warning with the invalid index and type_repr for debugging
/// - Skip the TypeInfoData entry (do not insert into FactsStore)
/// - Continue processing remaining entries
/// This graceful degradation ensures partial analysis results are still usable.
pub struct TypeInfoData {
    /// Index into `AnalysisBundle.file_results` for the file containing this symbol.
    pub file_index: usize,
    /// Index into that file's `symbols` array for the symbol this type applies to.
    pub symbol_index: usize,
    /// String representation of the type.
    pub type_repr: String,
    /// Source of type information.
    pub source: TypeSource,
    /// Optional structured type representation.
    pub structured: Option<TypeNode>,
}

/// Module resolution info from analysis.
///
/// **Invalid Index Handling:**
/// If any `file_indices` entry is out of bounds during integration:
/// - Log a warning with the module_path and invalid index
/// - Drop the invalid index and continue
pub struct ModuleResolutionData {
    /// Module path (e.g., "pkg.sub")
    pub module_path: String,
    /// File indices that implement this module
    pub file_indices: Vec<usize>,
}

/// Result of single-file analysis.
///
/// **No FileId:** Adapters do not allocate IDs. The integration layer assigns
/// FileId after receiving results. Use the index into `AnalysisBundle.file_results`
/// as the file identifier within adapter data.
pub struct FileAnalysisResult {
    /// Path to the analyzed file (used for ID allocation and error reporting).
    pub path: String,
    pub scopes: Vec<ScopeData>,
    pub symbols: Vec<SymbolData>,
    pub references: Vec<ReferenceData>,
    pub attributes: Vec<AttributeAccessData>,
    pub calls: Vec<CallSiteData>,
    pub aliases: Vec<AliasEdgeData>,
    pub qualified_names: Vec<QualifiedNameData>,
    pub signatures: Vec<SignatureData>,
    pub type_params: Vec<TypeParamData>,
    pub modifiers: Vec<ModifierData>,
    pub imports: Vec<ImportData>,
    pub exports: Vec<ExportData>,
}

/// Bundle of multi-file analysis results.
pub struct AnalysisBundle {
    pub file_results: Vec<FileAnalysisResult>,
    pub failed_files: Vec<(String, String)>, // (path, error)
    /// Module resolution map across files.
    pub modules: Vec<ModuleResolutionData>,
    /// Type information collected across all files.
    ///
    /// Stored at bundle level because type resolution may require cross-file
    /// context. The integration layer converts these to `TypeInfo` entries
    /// in `FactsStore`.
    pub types: Vec<TypeInfoData>,
}

/// Trait for language-specific analyzers.
///
/// **ID Ownership:** Adapters do NOT allocate any IDs (FileId, SymbolId, etc.).
/// All cross-references within adapter data use indices:
/// - `scope_index`: Index into `FileAnalysisResult.scopes`
/// - `symbol_index`: Index into `FileAnalysisResult.symbols`
/// - `file_index`: Index into `AnalysisBundle.file_results`
///
/// The integration layer allocates IDs and converts adapter data to FactsStore types.
///
/// **Ordering:** `file_results` preserves the input order passed to the adapter.
/// If a caller reorders `file_results`, it must remap all index-based references.
pub trait LanguageAdapter {
    type Error: std::error::Error + Send + Sync + 'static;

    /// Analyze a single file and return local analysis results.
    ///
    /// **No FileId parameter:** The adapter does not need to know the FileId.
    /// The integration layer will assign IDs after receiving results.
    fn analyze_file(
        &self,
        path: &str,
        content: &str,
    ) -> Result<FileAnalysisResult, Self::Error>;

    /// Analyze multiple files with cross-file resolution.
    ///
    /// The `store` is read-only context. For Phase 11, assume it is empty
    /// and build all cross-file state internally.
    fn analyze_files(
        &self,
        files: &[(String, String)],
        store: &FactsStore,
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
| `crates/tugtool-core/src/facts/mod.rs` | Add `Visibility`, `PublicExport`, `ImportKind`, `TypeNode`, extend `ScopeKind`, update `Symbol`, update `TypeInfo`, generalize `ModuleKind`, add `FACTS_SCHEMA_VERSION` |
| `crates/tugtool-core/src/lib.rs` | Re-export `adapter` module |
| `crates/tugtool-python/src/analyzer.rs` | Implement `LanguageAdapter`, add visibility inference option |
| `crates/tugtool-python/src/lib.rs` | Export `PythonAdapter` type |
| `crates/tugtool-python/src/type_tracker.rs` | Add `TypeNode` building from annotations |
| `crates/tugtool-python/src/ops/rename.rs` | Migrate to `PublicExport` with name spans |
| `crates/tugtool/tests/temporale_integration.rs` | Adjust export-related assertions |
| `crates/tugtool/tests/golden/**` | Update golden output for schema changes |

**Not modified in this phase (deferred):**
| File | Reason |
|------|--------|
| `crates/tugtool-core/src/types.rs` | Visibility not exposed in agent-facing `SymbolInfo` (see [CQ2](#cq2-visibility-output)) |
| `crates/tugtool-core/src/output.rs` | No output schema changes; `SCHEMA_VERSION` unchanged (see [CQ1](#cq1-schema-version-independence)) |
| `docs/AGENT_API.md` | No agent-facing output changes in this phase |

#### 11.2.3 Symbols to add {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `Visibility` | enum | `facts/mod.rs` | 5 variants: Public, Crate, Module, Private, Protected |
| `PublicExportId` | struct | `facts/mod.rs` | Newtype for u32 |
| `PublicExport` | struct | `facts/mod.rs` | Language-agnostic export |
| `ExportKind` | enum | `facts/mod.rs` | 6 variants: PythonAll, RustPubUse, RustPubUseGlob, RustPubMod, JsExport, GoExported |
| `ExportTarget` | enum | `facts/mod.rs` | 4 variants: Single, Glob, Module, Implicit |
| `ExportIntent` | enum | `facts/mod.rs` | Declared vs Effective export entries |
| `ExportOrigin` | enum | `facts/mod.rs` | Local, ReExport, Implicit, Unknown |
| `ImportKind` | enum | `facts/mod.rs` | Module, Named, Alias, Glob, ReExport, Default |
| `ModuleKind::Directory` | variant | `facts/mod.rs` | Generalized directory-based module |
| `ModuleKind::Inline` | variant | `facts/mod.rs` | Rust inline module (`mod foo { ... }`) |
| `ModuleKind::Namespace` | variant | `facts/mod.rs` | Virtual module with no concrete file |
| `Module::decl_span` | field | `facts/mod.rs` | Optional span for inline module declarations |
| `AttributeAccessId` | struct | `facts/mod.rs` | Newtype for u32 |
| `AttributeAccess` | struct | `facts/mod.rs` | Attribute reads/writes/calls |
| `AttributeAccessKind` | enum | `facts/mod.rs` | Read, Write, Call |
| `CallSiteId` | struct | `facts/mod.rs` | Newtype for u32 |
| `CallSite` | struct | `facts/mod.rs` | Call site facts |
| `CallArg` | struct | `facts/mod.rs` | Call argument (pos/kw) |
| `AliasEdgeId` | struct | `facts/mod.rs` | Newtype for u32 |
| `AliasEdge` | struct | `facts/mod.rs` | Alias relationships |
| `AliasKind` | enum | `facts/mod.rs` | Assignment, Import, ReExport |
| `QualifiedName` | struct | `facts/mod.rs` | Fully-qualified symbol name |
| `Modifier` | enum | `facts/mod.rs` | Async, Static, Property, etc. |
| `SymbolModifiers` | struct | `facts/mod.rs` | Modifiers per symbol |
| `ModuleResolution` | struct | `facts/mod.rs` | Module path to module IDs |
| `Signature` | struct | `facts/mod.rs` | Function/class signature |
| `Parameter` | struct | `facts/mod.rs` | Signature parameter |
| `ParamKind` | enum | `facts/mod.rs` | Positional/Keyword/VarArgs/etc. |
| `TypeParam` | struct | `facts/mod.rs` | Generic type parameters |
| `TypeNode` | enum | `facts/mod.rs` | Structured types + `Extension` variant |
| `FACTS_SCHEMA_VERSION` | const | `facts/mod.rs` | `u32 = 11` schema version |
| `ScopeKind::Impl` | variant | `facts/mod.rs` | Rust impl block |
| `ScopeKind::Trait` | variant | `facts/mod.rs` | Rust trait definition |
| `ScopeKind::Closure` | variant | `facts/mod.rs` | Rust closure |
| `ScopeKind::Unsafe` | variant | `facts/mod.rs` | Rust unsafe block |
| `ScopeKind::MatchArm` | variant | `facts/mod.rs` | Rust match arm |
| `Symbol::visibility` | field | `facts/mod.rs` | `Option<Visibility>` |
| `TypeInfo::structured` | field | `facts/mod.rs` | `Option<TypeNode>` |
| `ReferenceKind::Delete` | variant | `facts/mod.rs` | Delete reference semantics |
| `LanguageAdapter` | trait | `adapter.rs` | Analyzer interface |
| `FileAnalysisResult` | struct | `adapter.rs` | Single-file result |
| `AnalysisBundle` | struct | `adapter.rs` | Multi-file result |
| `TypeInfoData` | struct | `adapter.rs` | Type info for adapter output |
| `ModuleResolutionData` | struct | `adapter.rs` | Module path to file indices |
| `ScopeData` | struct | `adapter.rs` | Scope info for adapter output |
| `SymbolData` | struct | `adapter.rs` | Symbol info for adapter output |
| `ReferenceData` | struct | `adapter.rs` | Reference info for adapter output |
| `ReferenceKind` (adapter) | enum | `adapter.rs` | Definition, Read, Write, Call, Import, Attribute, TypeAnnotation, Delete |
| `AttributeAccessData` | struct | `adapter.rs` | Attribute access facts |
| `CallSiteData` | struct | `adapter.rs` | Call site facts |
| `CallArgData` | struct | `adapter.rs` | Call argument facts |
| `AliasEdgeData` | struct | `adapter.rs` | Alias relationships |
| `QualifiedNameData` | struct | `adapter.rs` | Fully-qualified name |
| `SignatureData` | struct | `adapter.rs` | Signature facts |
| `ParameterData` | struct | `adapter.rs` | Signature parameter |
| `TypeParamData` | struct | `adapter.rs` | Generic type parameter |
| `ModifierData` | struct | `adapter.rs` | Modifiers per symbol |
| `ImportData` | struct | `adapter.rs` | Import info for adapter output |
| `ExportData` | struct | `adapter.rs` | Export info for adapter output |
| `PythonAdapter` | struct | `tugtool-python/analyzer.rs` | Implements LanguageAdapter |
| `PythonAnalyzerOptions` | struct | `tugtool-python/analyzer.rs` | Analysis configuration |

---

#### 11.2.4 FactsStore Tables Summary {#factsstore-tables-summary}

Compact reference of new/expanded FactsStore tables introduced in Phase 11:

| Table / Type | Purpose | Key fields |
|-------------|---------|------------|
| `PublicExport` | Canonical exports across languages | `export_kind`, `export_intent`, spans |
| `AttributeAccess` | Member read/write/call facts | `access_id`, `base_symbol_id`, `name`, `kind` |
| `CallSite` | Call sites with args | `call_id`, `callee_symbol_id`, `args`, `span` |
| `AliasEdge` | Alias chains and provenance | `alias_id`, `alias_symbol_id`, `target_symbol_id`, `kind` |
| `QualifiedName` | Fully-qualified symbol IDs | `symbol_id`, `path` |
| `SymbolModifiers` | Semantic modifiers | `symbol_id`, `modifiers` |
| `ModuleResolution` | Module path → module IDs | `module_path`, `module_ids` |
| `Signature` | Function/class signatures | `params`, `returns` |
| `TypeParam` | Generic type parameters | `name`, `bounds`, `default` |
| `Module` (updated) | Inline module span support | `decl_span` |
| `ReferenceKind` (updated) | Delete semantics | `Delete` variant |

Adapter outputs mirror these via `*Data` structs in `adapter.rs`.

---

### 11.3 Documentation Plan {#documentation-plan}

- [ ] Update CLAUDE.md with new types and their purpose (no legacy compatibility notes)
- [ ] Add rustdoc for all new public types
- [ ] Document visibility mapping table in module docs
- [ ] Add examples showing Python (visibility=None) vs Rust (visibility set)
- [ ] Document TypeNode structure and usage
- [ ] Document PythonAdapter and options
- [ ] Update `docs/AGENT_API.md` if output schema or agent guidance changes
- [ ] Note FactsStore schema changes in internal docs where referenced
- [ ] Document adapter index semantics and deterministic ordering
- [ ] Document ReferenceKind mapping (Definition/Delete → output kind)
- [ ] Document ModuleKind::Inline and Module.decl_span semantics
- [ ] Document Import builder precedence and order-independence
- [ ] Document attribute access, call sites, alias edges, signatures, modifiers, and qualified names

---

### 11.4 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test enum serialization, default values | Visibility, ExportKind, ExportTarget, ExportIntent, ExportOrigin, ImportKind, ModuleKind, TypeNode, ReferenceKind (adapter + facts) |
| **Golden** | Verify new schema format correctness | JSON output for Symbol, PublicExport (incl. spans), TypeNode, schema_version |
| **Integration** | Verify Python analyzer works with new types | End-to-end rename using new schema |
| **Adapter** | Verify LanguageAdapter produces correct output | PythonAdapter results match expectations, index-based references |

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

**PublicExport span fields (precise edits):**
```rust
#[test]
fn public_export_spans_serialized() {
    let export = PublicExport {
        // ... ids ...
        exported_name: Some("Foo".to_string()),
        source_name: Some("Bar".to_string()),
        decl_span: Span::new(10, 30),
        exported_name_span: Some(Span::new(24, 27)),
        source_name_span: Some(Span::new(20, 23)),
        export_intent: ExportIntent::Declared,
        export_origin: ExportOrigin::ReExport,
        origin_module_id: None,
        origin_export_id: None,
        export_kind: ExportKind::RustPubUse,
        export_target: ExportTarget::Single,
        // ... remaining fields ...
    };
    let json = serde_json::to_string(&export).unwrap();
    assert!(json.contains("\"decl_span\""));
    assert!(json.contains("\"exported_name_span\""));
    assert!(json.contains("\"source_name_span\""));
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

**ExportIntent/Origin Serialization:**
```rust
#[test]
fn export_intent_serialization() {
    assert_eq!(serde_json::to_string(&ExportIntent::Declared).unwrap(), "\"declared\"");
    assert_eq!(serde_json::to_string(&ExportIntent::Effective).unwrap(), "\"effective\"");
}

#[test]
fn export_origin_serialization() {
    assert_eq!(serde_json::to_string(&ExportOrigin::Local).unwrap(), "\"local\"");
    assert_eq!(serde_json::to_string(&ExportOrigin::ReExport).unwrap(), "\"re_export\"");
}
```

**ImportKind/ModuleKind Serialization:**
```rust
#[test]
fn import_kind_serialization() {
    assert_eq!(serde_json::to_string(&ImportKind::Glob).unwrap(), "\"glob\"");
    assert_eq!(serde_json::to_string(&ImportKind::Module).unwrap(), "\"module\"");
}

#[test]
fn module_kind_serialization() {
    assert_eq!(serde_json::to_string(&ModuleKind::Directory).unwrap(), "\"directory\"");
    assert_eq!(serde_json::to_string(&ModuleKind::Inline).unwrap(), "\"inline\"");
    assert_eq!(serde_json::to_string(&ModuleKind::Namespace).unwrap(), "\"namespace\"");
}
```

**Attribute/Call/Alias/Signature Enums:**
```rust
#[test]
fn attribute_access_kind_serialization() {
    assert_eq!(serde_json::to_string(&AttributeAccessKind::Read).unwrap(), "\"read\"");
}

#[test]
fn alias_kind_serialization() {
    assert_eq!(serde_json::to_string(&AliasKind::Assignment).unwrap(), "\"assignment\"");
}

#[test]
fn param_kind_serialization() {
    assert_eq!(serde_json::to_string(&ParamKind::Regular).unwrap(), "\"regular\"");
}

#[test]
fn modifier_serialization() {
    assert_eq!(serde_json::to_string(&Modifier::Async).unwrap(), "\"async\"");
}
```

**Adapter ReferenceKind:**
```rust
#[test]
fn adapter_reference_kind() {
    // Adapter ReferenceKind is separate from facts::ReferenceKind
    // but the integration layer maps between them
    use tugtool_core::adapter::ReferenceKind;

    let kinds = [
        ReferenceKind::Definition,
        ReferenceKind::Read,
        ReferenceKind::Write,
        ReferenceKind::Call,
        ReferenceKind::Import,
        ReferenceKind::Attribute,
        ReferenceKind::TypeAnnotation,
        ReferenceKind::Delete,
    ];
    assert_eq!(kinds.len(), 8);
}
```

**Facts ReferenceKind (Delete):**
```rust
#[test]
fn facts_reference_kind_delete_serializes() {
    use tugtool_core::facts::ReferenceKind;
    assert_eq!(
        serde_json::to_string(&ReferenceKind::Delete).unwrap(),
        "\"delete\""
    );
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
- [x] Review rust-analyzer's visibility model for alignment
- [x] Confirm `#[non_exhaustive]` approach for ScopeKind
- [x] Confirm adapter contract (read-only FactsStore, ID ownership)
- [x] Confirm ImportKind/ModuleKind generalization approach
- [x] Verify serde serialization for new enums
- [x] Confirm `FACTS_SCHEMA_VERSION = 11` and defaulting in `FactsStore::new()`

**Tests:**
- N/A (design step)

**Checkpoint:**
- [x] Plan reviewed and approved
- [x] No blocking questions remain

**Rollback:**
- Revert plan changes

**Commit after all checkpoints pass.**

---

#### Step 1: Add Visibility Enum, Update Symbol, and Schema Version {#step-1}

**Commit:** `feat(facts): add Visibility enum, Symbol.visibility field, and FACTS_SCHEMA_VERSION`

**References:** [D01] Visibility Enum Design, [D02] Symbol Visibility Optional, [D11] Schema Version Placement, Table T01, (#visibility-mapping)

**Artifacts:**
- `Visibility` enum in `facts/mod.rs`
- `Symbol.visibility: Option<Visibility>` field
- Updated `Symbol::new()` to default visibility to `None`
- `FACTS_SCHEMA_VERSION = 11` constant
- `FactsStore.schema_version` field

**Tasks:**
- [x] Add `FACTS_SCHEMA_VERSION: u32 = 11` constant to `facts/mod.rs`
- [x] Add `schema_version: u32` field to `FactsStore` struct
- [x] Update `FactsStore::new()` to set `schema_version: FACTS_SCHEMA_VERSION`
- [x] Add `Visibility` enum with 5 variants
- [x] Add `visibility: Option<Visibility>` to `Symbol` struct
- [x] Add `#[serde(skip_serializing_if = "Option::is_none")]` for clean JSON
- [x] Add `Symbol::with_visibility(self, v: Visibility) -> Self` builder method
- [x] Update all `Symbol::new()` calls to not break (field is Option, defaults to None)

**Tests:**
- [x] Unit: `Visibility` serialization roundtrip
- [x] Unit: `Symbol` with `visibility: None` serializes correctly
- [x] Unit: `Symbol` with `visibility: Some(Public)` serializes correctly
- [x] Unit: `FACTS_SCHEMA_VERSION == 11`
- [x] Unit: `FactsStore::new()` sets `schema_version` to `FACTS_SCHEMA_VERSION`
- [x] Golden: Symbol schema matches new format

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core visibility`
- [x] `cargo nextest run -p tugtool-core schema_version`
- [x] `cargo nextest run -p tugtool-python`

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
- [x] Add `#[non_exhaustive]` attribute to `ScopeKind`
- [x] Add `Impl` variant
- [x] Add `Trait` variant
- [x] Add `Closure` variant
- [x] Add `Unsafe` variant
- [x] Add `MatchArm` variant
- [x] Update any exhaustive matches in `tugtool-core` to use wildcards
- [x] Update `ScopeKind` serialization (serde rename_all handles it)

**Tests:**
- [x] Unit: New variant serialization
- [x] Unit: Deserialization of existing variants still works
- [x] Integration: Python analyzer still works

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core scope`
- [x] `cargo nextest run -p tugtool-python`
- [x] `cargo clippy --workspace` (no exhaustiveness warnings)

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 2.1: Consolidate ScopeKind {#step-2-1}

**Commit:** `refactor(python): use core ScopeKind directly`

**References:** Step 2 (ScopeKind extension), [D05] ScopeKind Extension Strategy

**Motivation:** The Python analyzer defines a local `ScopeKind` enum that duplicates 5 variants from `tugtool_core::facts::ScopeKind`. With `#[non_exhaustive]` now on the core enum, this duplication is unnecessary and creates maintenance burden.

**Artifacts:**
- Remove `tugtool_python::analyzer::ScopeKind` local enum
- Use `tugtool_core::facts::ScopeKind` directly throughout Python analyzer
- Remove `Scope::to_core_kind()` conversion method

**Tasks:**
- [x] Remove local `ScopeKind` enum from `analyzer.rs`
- [x] Import `tugtool_core::facts::ScopeKind` (can alias if needed)
- [x] Update `From<&str>` impl to return core `ScopeKind` with `_ => ScopeKind::Module` fallback
- [x] Remove `Scope::to_core_kind()` method (no longer needed)
- [x] Update all `ScopeKind` usages in `analyzer.rs` to use core type
- [x] Update `ops/rename.rs` to import from core instead of analyzer
- [x] Add wildcard arm to any match statements: `_ => unreachable!("Python analyzer never produces Rust scope kinds")`

**Tests:**
- [x] Unit: Existing scope tests still pass
- [x] Integration: Python analyzer produces correct scope kinds
- [x] Integration: Rename operations still work

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python`
- [x] `cargo clippy --workspace`

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 2.5: Generalize Import and ModuleKind {#step-2-5}

**Commit:** `feat(facts): generalize imports and modules`

**References:** [D04] Import and Module Generalization, Concept C03, Concept C04, (#import-generalization)

**Artifacts:**
- `ImportKind` enum
- `Import.kind` replacing `is_star`
- Builder pattern with auto-setting `ImportKind`
- Generalized `ModuleKind` (Directory, Inline, Namespace)
- `Module.decl_span` for inline module declarations
- Updated docs for module/import semantics

**Tasks:**
- [x] Add `ImportKind` enum to `facts/mod.rs`
- [x] Replace `Import.is_star: bool` with `Import.kind: ImportKind`
- [x] Update `Import::new()` to set `ImportKind::Module` by default (bare `import foo`)
- [x] Add `Import::with_imported_name()` - auto-sets `ImportKind::Named`
- [x] Add `Import::with_alias()` - auto-sets `ImportKind::Alias`
- [x] Add `Import::with_glob()` - sets `ImportKind::Glob` (replaces `with_star()`)
- [x] Add `Import::with_kind()` - explicit override for `ReExport`, `Default`, etc.
- [x] Implement order-independent builder precedence (Alias overrides Named; Glob overrides Alias; `with_kind` overrides all)
- [x] **Migration:** Replace all `Import::with_star()` calls with `Import::with_glob()`
- [x] Remove `Import::with_star()` builder method entirely
- [x] **Migration:** Rename `ModuleKind::Package` to `ModuleKind::Directory`
- [x] Add `ModuleKind::Inline` variant (for Rust `mod foo { ... }`)
- [x] Add `ModuleKind::Namespace` variant
- [x] Add `Module.decl_span: Option<Span>` for inline module declarations
- [x] Add `Module::with_decl_span(span: Span) -> Self` builder
- [x] Update `ModuleKind` docs to remove `__init__.py` references
- [x] Update Python analyzer to use new builder pattern:
  - `import foo` → `Import::new("foo")` (kind = Module by default)
  - `from foo import bar` → `Import::new("foo").with_imported_name("bar")` (auto-sets Named)
  - `from foo import bar as baz` → `Import::new("foo").with_imported_name("bar").with_alias("baz")` (auto-sets Alias)
  - `from foo import *` → `Import::new("foo").with_glob()` (sets Glob)
- [x] **Migration:** Update all callers that check `is_star` to check `kind == ImportKind::Glob`
- [x] Update any core queries/tests that rely on `is_star` or `ModuleKind::Package`
- [x] Update module creation to set `decl_span` for inline modules when available

**Python Note:** For Python modules, `Module.decl_span` is always `None` since Python does not support inline module definitions (unlike Rust's `mod foo { ... }`).

**Tests:**
- [x] Unit: `ImportKind` serialization (all variants)
- [x] Unit: `ModuleKind` serialization (all variants including `Inline`)
- [x] Unit: `Import::with_imported_name` auto-sets `ImportKind::Named`
- [x] Unit: `Import::with_alias` auto-sets `ImportKind::Alias`
- [x] Unit: `Import::with_glob` sets `ImportKind::Glob`
- [x] Unit: `Import` builder precedence is order-independent
- [x] Unit: `Module::with_decl_span` sets `decl_span`
- [x] Integration: Python analyzer emits `ImportKind::Module` for `import foo`
- [x] Integration: Python analyzer emits `ImportKind::Named` for `from foo import bar`
- [x] Integration: Python analyzer emits `ImportKind::Alias` for `from foo import bar as baz`
- [x] Integration: Python analyzer emits `ImportKind::Glob` for `from foo import *`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core import`
- [x] `cargo nextest run -p tugtool-core module`
- [x] `cargo nextest run -p tugtool-python import`
- [x] `cargo clippy --workspace` (no unused code warnings for removed methods)

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 2.6: Generalize ReferenceKind {#step-2-6}

**Commit:** `feat(facts): add Delete to ReferenceKind`

**References:** [D14] ReferenceKind Generalization

**Artifacts:**
- `ReferenceKind::Delete` in FactsStore
- Output mapping for Delete

**Tasks:**
- [x] Add `Delete` variant to `facts::ReferenceKind`
- [x] Update `ReferenceKind::to_output_kind()` to map `Delete` → `"reference"`
- [x] Update any exhaustive `ReferenceKind` matches in core code
- [x] Add/Update tests for ReferenceKind serialization and output mapping

**Tests:**
- [x] Unit: `ReferenceKind::Delete` serialization
- [x] Unit: `ReferenceKind::Delete` maps to output kind `"reference"`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core reference_kind`

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 2.7: Add Foundational Semantic Facts (Overview) {#step-2-7}

> **SEQUENTIAL EXECUTION:** Steps 2.7a through 2.7e should be executed in order.
> Each step adds a distinct fact system to FactsStore.

**References:** [D16]-[D21], [CQ7]-[CQ10]

This step is split into 5 sub-steps for manageable commits:
- **Step 2.7a:** Alias edges (builds on Phase 10 infrastructure)
- **Step 2.7b:** Signatures and type parameters
- **Step 2.7c:** Attribute access and call sites
- **Step 2.7d:** Qualified names and symbol modifiers
- **Step 2.7e:** Module resolution map

---

#### Step 2.7a: Add Alias Edges to FactsStore {#step-2-7a}

**Commit:** `feat(facts): add AliasEdge for persisted alias tracking`

**References:** [D18] Alias Edges, [CQ7] AliasEdge vs AliasOutput, [CQ9] Confidence Field

**Rationale:** Alias tracking from Phase 10 is ephemeral (built at query time). Persisting aliases enables efficient cross-file refactors and alias chain reasoning.

**Artifacts:**
- `AliasEdge` struct in FactsStore
- `AliasKind` enum
- Storage tables and indexes
- `aliases_from_edges()` query for AliasOutput conversion

**Tasks:**
- [x] Add `AliasKind` enum: `Assignment`, `Import`, `ReExport`, `Unknown`
- [x] Add `AliasEdgeId` newtype
- [x] Add `AliasEdge` struct with fields:
  - `alias_id: AliasEdgeId`
  - `file_id: FileId`
  - `span: Span`
  - `alias_symbol_id: SymbolId`
  - `target_symbol_id: Option<SymbolId>`
  - `kind: AliasKind`
  - `confidence: Option<f32>` (per [CQ9])
- [x] Add `alias_edges: BTreeMap<AliasEdgeId, AliasEdge>` to FactsStore
- [x] Add `alias_edges_by_file: HashMap<FileId, Vec<AliasEdgeId>>` index
- [x] Add `alias_edges_by_alias: HashMap<SymbolId, Vec<AliasEdgeId>>` index
- [x] Add `alias_edges_by_target: HashMap<SymbolId, Vec<AliasEdgeId>>` index
- [x] Add `next_alias_edge_id()`, `insert_alias_edge()`, `alias_edge()` methods
- [x] Add `alias_edges_for_symbol()` query (forward lookup)
- [x] Add `alias_sources_for_target()` query (reverse lookup)
- [x] Add `aliases_from_edges()` to convert `AliasEdge` → `AliasOutput` for JSON

**Tests:**
- [x] Unit: `AliasKind` serialization (all variants)
- [x] Unit: `AliasEdge` with `confidence: None` serializes without field
- [x] Unit: `AliasEdge` with `confidence: Some(0.8)` serializes correctly
- [x] Unit: Insert/query roundtrip for `AliasEdge`
- [x] Unit: Forward and reverse lookups work correctly
- [x] Unit: `aliases_from_edges()` produces valid `AliasOutput`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core alias`

**Rollback:** Revert commit

**Commit after all checkpoints pass.**

---

#### Step 2.7b: Add Signatures and Type Parameters {#step-2-7b}

**Commit:** `feat(facts): add Signature and TypeParam for function modeling`

**References:** [D21] Signature + Type Parameter Facts, [CQ10] ParamKind Generality

**Rationale:** Signatures enable parameter rename, API migration, and function documentation. Type parameters support generic type reasoning.

**Artifacts:**
- `Signature`, `Parameter`, `ParamKind` in FactsStore
- `TypeParam` in FactsStore
- Storage and queries

**Tasks:**
- [x] Add `ParamKind` enum with `#[non_exhaustive]`:
  - `Regular` (default)
  - `PositionalOnly` (Python)
  - `KeywordOnly` (Python)
  - `VarArgs` (Python `*args`)
  - `KwArgs` (Python `**kwargs`)
  - `SelfValue`, `SelfRef`, `SelfMutRef` (Rust, future)
- [x] Add `Parameter` struct:
  - `name: String`
  - `kind: ParamKind`
  - `default_span: Option<Span>`
  - `annotation: Option<TypeNode>`
- [x] Add `Signature` struct:
  - `symbol_id: SymbolId`
  - `params: Vec<Parameter>`
  - `returns: Option<TypeNode>`
- [x] Add `TypeParam` struct:
  - `name: String`
  - `bounds: Vec<TypeNode>`
  - `default: Option<TypeNode>`
- [x] Add `signatures: BTreeMap<SymbolId, Signature>` to FactsStore
- [x] Add `type_params: BTreeMap<SymbolId, Vec<TypeParam>>` to FactsStore
- [x] Add `insert_signature()`, `signature()`, `signatures()` methods
- [x] Add `insert_type_params()`, `type_params_for()` methods

**Tests:**
- [x] Unit: `ParamKind` serialization (all variants)
- [x] Unit: `Parameter` with and without annotation
- [x] Unit: `Signature` with multiple params and return type
- [x] Unit: `TypeParam` with bounds and default
- [x] Unit: Insert/query roundtrip for signatures
- [x] Unit: Multiple type params per symbol

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core signature`
- [x] `cargo nextest run -p tugtool-core type_param`

**Rollback:** Revert commit

**Commit after all checkpoints pass.**

---

#### Step 2.7c: Add Attribute Access and Call Sites {#step-2-7c}

**Commit:** `feat(facts): add AttributeAccess and CallSite for access patterns`

**References:** [D16] Attribute Access Facts, [D17] Call Site Facts

**Rationale:** Attribute access enables method resolution and property refactors. Call sites enable parameter rename and API migration.

**Artifacts:**
- `AttributeAccess`, `AttributeAccessKind` in FactsStore
- `CallSite`, `CallArg` in FactsStore
- Storage and indexes

**Tasks:**
- [x] Add `AttributeAccessKind` enum: `Read`, `Write`, `Call`
- [x] Add `AttributeAccessId` newtype
- [x] Add `AttributeAccess` struct:
  - `access_id: AttributeAccessId`
  - `file_id: FileId`
  - `span: Span`
  - `base_symbol_id: Option<SymbolId>` (resolved base, if known)
  - `name: String` (attribute name)
  - `kind: AttributeAccessKind`
- [x] Add `CallArg` struct:
  - `name: Option<String>` (keyword arg name, None for positional)
  - `span: Span`
- [x] Add `CallSiteId` newtype
- [x] Add `CallSite` struct:
  - `call_id: CallSiteId`
  - `file_id: FileId`
  - `span: Span`
  - `callee_symbol_id: Option<SymbolId>` (resolved callee, if known)
  - `args: Vec<CallArg>`
- [x] Add `attribute_accesses: BTreeMap<AttributeAccessId, AttributeAccess>` to FactsStore
- [x] Add `attribute_accesses_by_file: HashMap<FileId, Vec<AttributeAccessId>>` index
- [x] Add `attribute_accesses_by_name: HashMap<String, Vec<AttributeAccessId>>` index
- [x] Add `call_sites: BTreeMap<CallSiteId, CallSite>` to FactsStore
- [x] Add `call_sites_by_file: HashMap<FileId, Vec<CallSiteId>>` index
- [x] Add `call_sites_by_callee: HashMap<SymbolId, Vec<CallSiteId>>` index
- [x] Add `next_attribute_access_id()` and `next_call_site_id()` generators
- [x] Add insert/query methods for both tables

**Tests:**
- [x] Unit: `AttributeAccessKind` serialization
- [x] Unit: `AttributeAccess` with resolved and unresolved base
- [x] Unit: `CallArg` with and without keyword name
- [x] Unit: `CallSite` with positional and keyword args
- [x] Unit: Insert/query roundtrip for attribute accesses
- [x] Unit: Insert/query roundtrip for call sites
- [x] Unit: Query by attribute name
- [x] Unit: Query by callee symbol

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core attribute`
- [x] `cargo nextest run -p tugtool-core call_site`

**Rollback:** Revert commit

**Commit after all checkpoints pass.**

---

#### Step 2.7d: Add Qualified Names and Symbol Modifiers {#step-2-7d}

**Commit:** `feat(facts): add QualifiedName and Modifier for symbol metadata`

**References:** [D19] Qualified Names and Modifiers

**Rationale:** Qualified names enable stable cross-module identification. Modifiers capture semantic attributes (async, static, property) in a language-agnostic way.

**Artifacts:**
- `QualifiedName` in FactsStore
- `Modifier` enum and `SymbolModifiers` in FactsStore
- Storage and queries

**Tasks:**
- [x] Add `Modifier` enum with `#[non_exhaustive]`:
  - `Async`, `Static`, `ClassMethod`, `Property`
  - `Abstract`, `Final`, `Override`, `Generator`
- [x] Add `QualifiedName` struct:
  - `symbol_id: SymbolId`
  - `path: String` (e.g., `"pkg.mod.Class.method"`)
- [x] Add `SymbolModifiers` struct:
  - `symbol_id: SymbolId`
  - `modifiers: Vec<Modifier>`
- [x] Add `qualified_names: BTreeMap<SymbolId, QualifiedName>` to FactsStore
- [x] Add `qualified_names_by_path: HashMap<String, SymbolId>` reverse index
- [x] Add `symbol_modifiers: BTreeMap<SymbolId, SymbolModifiers>` to FactsStore
- [x] Add insert/query methods:
  - `insert_qualified_name()`, `qualified_name()`, `symbol_by_qualified_name()`
  - `insert_modifiers()`, `modifiers_for()`
- [x] Add `has_modifier(symbol_id, modifier)` convenience query

**Tests:**
- [x] Unit: `Modifier` serialization (all variants)
- [x] Unit: `QualifiedName` roundtrip
- [x] Unit: Reverse lookup by path
- [x] Unit: `SymbolModifiers` with multiple modifiers
- [x] Unit: `has_modifier()` query

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core qualified`
- [x] `cargo nextest run -p tugtool-core modifier`

**Rollback:** Revert commit

**Commit after all checkpoints pass.**

---

#### Step 2.7e: Add Module Resolution Map {#step-2-7e}

**Commit:** `feat(facts): add ModuleResolution for import path mapping`

**References:** [D20] Module Resolution Map

**Rationale:** Module resolution supports namespace packages (multiple files for one module path), import resolution, and re-export tracing.

**Artifacts:**
- `ModuleResolution` in FactsStore
- Storage and queries

**Tasks:**
- [x] Add `ModuleResolution` struct:
  - `module_path: String` (e.g., `"pkg.sub"`)
  - `module_ids: Vec<ModuleId>` (supports namespace packages)
- [x] Add `module_resolutions: BTreeMap<String, ModuleResolution>` to FactsStore
- [x] Add `module_ids_by_path: HashMap<String, Vec<ModuleId>>` convenience index
- [x] Add insert/query methods:
  - `insert_module_resolution()` (merges module_ids if path exists)
  - `resolve_module_path()` → `Option<&ModuleResolution>`
  - `module_ids_for_path()` → `&[ModuleId]`
- [x] Handle namespace package merging: if path exists, append module_ids
- [x] Add `all_module_paths()` iterator

**Tests:**
- [x] Unit: `ModuleResolution` serialization
- [x] Unit: Single module per path
- [x] Unit: Namespace package (multiple modules per path)
- [x] Unit: Merge behavior on duplicate insert
- [x] Unit: `module_ids_for_path()` returns empty slice for unknown path

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core module_resolution`

**Rollback:** Revert commit

**Commit after all checkpoints pass.**

---

#### Step 3: Add PublicExport Type {#step-3}

> **SEQUENTIAL EXECUTION REQUIRED:** Steps 3, 3a, 3b, and 3c MUST be executed in order.
> Each step depends on the previous step's completion. Do not parallelize these steps.

**Commit:** `feat(facts): add PublicExport type as canonical export model`

**References:** [D03] PublicExport for Language-Agnostic Exports, [D10] ExportTarget, Concept C01, (#export-generalization)

**Artifacts:**
- `PublicExportId` newtype
- `PublicExport` struct
- `ExportKind` enum
- `ExportTarget` enum
- FactsStore storage and queries for PublicExport

**Tasks:**
- [x] Add `PublicExportId` newtype with Display impl
- [x] Add `ExportKind` enum (PythonAll, RustPubUse, RustPubUseGlob, RustPubMod, JsExport, GoExported)
- [x] Add `ExportTarget` enum (Single, Glob, Module, Implicit)
- [x] Add `ExportIntent` enum (Declared, Effective)
- [x] Add `ExportOrigin` enum (Local, ReExport, Implicit, Unknown)
- [x] Add `PublicExport` struct with precise spans and origin/intent fields
- [x] Add `public_exports: BTreeMap<PublicExportId, PublicExport>` to FactsStore
- [x] Add `public_exports_by_file: HashMap<FileId, Vec<PublicExportId>>` index
- [x] Add `public_exports_by_name: HashMap<String, Vec<PublicExportId>>` index (only for non-glob exports)
- [x] Add `public_exports_by_intent: HashMap<ExportIntent, Vec<PublicExportId>>` index
- [x] Add `next_public_export_id()` generator
- [x] Add `insert_public_export()` method
- [x] Add `public_export()` lookup by ID
- [x] Add `public_exports_in_file()` query
- [x] Add `public_exports_named()` query
- [x] Add `public_exports_with_intent()` query
- [x] Add `public_exports()` iterator

**Tests:**
- [x] Unit: PublicExport CRUD operations
- [x] Unit: ExportKind serialization
- [x] Unit: ExportTarget serialization
- [x] Unit: ExportIntent serialization
- [x] Unit: ExportOrigin serialization
- [x] Unit: Query by name returns correct exports

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core public_export`
- [x] `cargo build -p tugtool-python` (compiles, legacy Export still exists)

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 3a: Update Python Analyzer to Emit PublicExport {#step-3a}

**Commit:** `feat(python): emit PublicExport for __all__ exports`

**References:** [D03] PublicExport for Language-Agnostic Exports, Concept C01, (#export-generalization)

> **Sequencing Note:** This step adds PublicExport support BEFORE removing legacy Export.
> Both export types coexist temporarily. This ensures each commit is buildable.

**Artifacts:**
- Python analyzer emits `PublicExport` in addition to legacy `Export`
- Export spans populated correctly for rename operations

**Tasks:**
- [x] Update Python analyzer to emit `PublicExport` for each `__all__` entry
- [x] Keep legacy `Export` emission temporarily (removed in Step 3c)
- [x] Populate `export_kind: ExportKind::PythonAll` for `__all__` entries
- [x] Populate `export_target: ExportTarget::Single` for individual `__all__` entries
- [x] Populate `export_intent: ExportIntent::Declared` for explicit `__all__` declarations
- [x] Populate `export_origin: ExportOrigin::Local` for locally-defined exports
- [x] Populate `exported_name` and `source_name` (same for non-aliased Python exports)
- [x] Populate `exported_name_span` pointing at string content only (excluding quotes)
- [x] Populate `decl_span` covering the full string literal including quotes
- [x] Resolve `symbol_id` when the exported name matches a defined symbol
- [x] If no matching symbol exists, set `symbol_id = None` and keep the export (no error)
- [x] If `__all__` is empty, emit zero `PublicExport` entries

**Span Semantics for Python `__all__`:**
For `__all__ = ["foo", "bar"]`:
- `decl_span` covers `"foo"` (full string literal with quotes, e.g., bytes 12-17)
- `exported_name_span` covers `foo` (string content only, e.g., bytes 13-16)
- This matches the legacy `content_span` semantics for rename-safe replacements

**Tests:**
- [x] Unit: Python `__all__` parsing produces correct `PublicExport` fields
- [x] Unit: `exported_name_span` excludes quote characters
- [x] Unit: `decl_span` includes quote characters
- [x] Integration: Python analyzer correctly resolves `symbol_id` for exported names
- [x] Integration: `__all__` entries without matching symbols produce `symbol_id = None`
- [x] Integration: Empty `__all__` yields zero PublicExport entries
- [x] Integration: Both legacy Export and PublicExport are populated (temporary)

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python export`
- [x] `cargo nextest run -p tugtool-python`

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 3b: Update Rename Operations for PublicExport {#step-3b}

**Commit:** `refactor(python): use PublicExport in rename operations`

**References:** [D03] PublicExport for Language-Agnostic Exports, (#export-generalization)

**Artifacts:**
- Rename operations use `PublicExport` queries and name spans
- Export edits use `exported_name_span` for precise replacement

**Tasks:**
- [x] Update `ops/rename.rs` to query `public_exports_named()` instead of legacy `exports_named()`
- [x] Update export edit generation to use `PublicExport.exported_name_span` for replacement span
- [x] Verify rename correctly replaces string content without affecting quotes
- [x] Update any other rename-related code that references legacy export types

**Tests:**
- [x] Integration: Rename updates `__all__` string content correctly
- [x] Integration: Quotes are preserved after rename
- [x] Integration: Multi-file rename with exports works correctly
- [x] Golden: PublicExport serialization matches expected format

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python rename`
- [x] `cargo nextest run -p tugtool` (CLI integration tests)

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 3c: Remove Legacy Export Type {#step-3c}

**Commit:** `refactor(facts): remove legacy Export type and ExportId`

**References:** [D03] PublicExport for Language-Agnostic Exports, (#export-generalization)

> **Sequencing Note:** This step removes legacy Export AFTER PublicExport is fully working
> and rename operations have been migrated.

**Artifacts:**
- Legacy `Export` type removed from FactsStore
- Legacy `ExportId` newtype removed
- Legacy export storage and queries removed
- Python analyzer no longer emits legacy `Export`

**Tasks:**
- [x] **Remove legacy `ExportId` newtype** from FactsStore
- [x] **Remove legacy `Export` type** from FactsStore
- [x] **Remove legacy export storage**: `exports`, `exports_by_file`, `exports_by_name`
- [x] **Remove legacy export queries**: `export()`, `exports_in_file()`, `exports_named()`, `exports()`
- [x] **Remove `next_export_id()` generator**
- [x] Remove legacy `Export` emission from Python analyzer (added temporarily in Step 3a)
- [x] Update any code that references legacy `Export` or `ExportId`

**Tests:**
- [x] Unit: Legacy types no longer exist (compile check)
- [x] Unit: PublicExport types still work correctly
- [x] Integration: Python analyzer only emits PublicExport

**Checkpoint:**
- [x] `cargo build -p tugtool-core` (compiles without legacy types)
- [x] `cargo nextest run -p tugtool-core public_export`
- [x] `cargo nextest run -p tugtool-python`

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 3 Summary {#step-3-summary}

**Execution Order:** Step 3 → Step 3a → Step 3b → Step 3c

Each step is a buildable commit:
1. **Step 3:** Add `PublicExport` type to FactsStore (new type exists alongside legacy)
2. **Step 3a:** Update Python analyzer to emit `PublicExport` (both types emitted temporarily)
3. **Step 3b:** Update rename operations to use `PublicExport` queries
4. **Step 3c:** Remove legacy `Export` and `ExportId` (clean break, only `PublicExport` remains)

After completing all steps, you will have:
- `PublicExport` as the canonical export model in FactsStore
- Legacy `Export` and `ExportId` types completely removed
- Python analyzer emitting `PublicExport` with correct spans and metadata
- Rename operations using `PublicExport` for precise export edits

**Final Step 3 Checkpoint:**
- [x] `cargo nextest run --workspace` (all export-related tests pass)

---

#### Step 4: Define LanguageAdapter Trait {#step-4}

**Commit:** `feat(core): add LanguageAdapter trait for pluggable language support`

**References:** [D06] LanguageAdapter Trait Design, (#language-adapter)

**Artifacts:**
- New `crates/tugtool-core/src/adapter.rs` module
- `LanguageAdapter` trait
- Supporting types (`FileAnalysisResult`, `AnalysisBundle`)

**Tasks:**
- [x] Create `crates/tugtool-core/src/adapter.rs`
- [x] Define `ScopeData`, `SymbolData`, `ReferenceData`, `ImportData`, `ExportData` intermediate types
- [x] Define adapter `ReferenceKind` enum (Definition, Read, Write, Call, Import, Attribute, TypeAnnotation, Delete)
- [x] Define `FileAnalysisResult` struct
- [x] Define `TypeInfoData` struct and add `types: Vec<TypeInfoData>` to `AnalysisBundle`
- [x] Define `ModuleResolutionData` and add `modules: Vec<ModuleResolutionData>` to `AnalysisBundle`
- [x] Define `AnalysisBundle` struct
- [x] Define `LanguageAdapter` trait with associated Error type
- [x] Use read-only `&FactsStore` in `analyze_files` for cross-file resolution
- [x] Add `pub mod adapter;` to `lib.rs`
- [x] Re-export adapter types from `tugtool_core`
- [x] Add documentation for the trait
- [x] Document deterministic ordering (adapter preserves input order for file_results)

**Tests:**
- [x] Unit: Trait compiles (trait definition test)
- [x] Unit: `file_results` preserves input order (deterministic ordering per [D15](#d15-deterministic-adapter-order))
- [x] Documentation: Example in rustdoc compiles

**Deterministic Ordering Test Fixture:**
```rust
#[test]
fn file_results_preserves_input_order() {
    let files = vec![
        ("b.py".to_string(), "x = 1".to_string()),
        ("a.py".to_string(), "y = 2".to_string()),
        ("c.py".to_string(), "z = 3".to_string()),
    ];
    let store = FactsStore::new();
    let bundle = adapter.analyze_files(&files, &store).unwrap();

    // Order must match input, not sorted alphabetically
    assert_eq!(bundle.file_results[0].path, "b.py");
    assert_eq!(bundle.file_results[1].path, "a.py");
    assert_eq!(bundle.file_results[2].path, "c.py");
}
```

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core adapter`
- [x] `cargo doc -p tugtool-core --open` (adapter docs render)

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
- [x] Add module-level docs to `facts/mod.rs` explaining visibility model
- [x] Add examples in `Visibility` rustdoc
- [x] Add examples in `PublicExport` rustdoc
- [x] Document `LanguageAdapter` usage pattern
- [x] Review and update CLAUDE.md if schema changes affect agents
- [x] Update `docs/AGENT_API.md` if output schema changes

**Tests:**
- [x] `cargo doc --workspace` succeeds
- [x] Doc tests pass

**Checkpoint:**
- [x] `cargo test --doc -p tugtool-core`

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 6: Golden Test Validation {#step-6}

**Commit:** `test: add golden tests for Phase 11 schema additions`

**References:** [D11] Schema Version Placement, (#test-plan-concepts)

**Artifacts:**
- New golden test files for schema validation

**Tasks:**
- [x] Add golden test for Symbol with visibility
- [x] Add golden test for PublicExport (incl. spans + intent/origin)
- [x] Verify updated golden tests pass
- [x] Verify schema version is present in FactsStore serialization (added in Step 1)

**Tests:**
- [x] Golden: New types serialize correctly (Symbol with visibility, PublicExport, TypeNode)
- [x] Golden: Schema version field present and correct (`schema_version = 11`)

**Checkpoint:**
- [x] `cargo nextest run -p tugtool golden`
- [x] `TUG_UPDATE_GOLDEN=1 cargo nextest run -p tugtool golden` (if intentional changes)

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 7: Implement LanguageAdapter for Python (Overview) {#step-7}

> **SEQUENTIAL EXECUTION:** Steps 7a through 7d should be executed in order.
> Each step builds on the previous, incrementally adding semantic fact emission.

**References:** [D06], [CQ5], [CQ6], [CQ8]

**Integration Layer Responsibilities:**
The integration layer (in `crates/tugtool-python/src/analyzer.rs`) is responsible for:
1. Calling `adapter.analyze_files()` to get `AnalysisBundle`
2. Allocating IDs via `FactsStore::next_*_id()` methods
3. Converting adapter data types to FactsStore types
4. Inserting into `FactsStore` via `insert_*()` methods
5. Preserving `file_results` order (or remapping indices if order changes)

This step is split into 4 sub-steps:
- **Step 7a:** Core PythonAdapter + LanguageAdapter implementation
- **Step 7b:** Emit alias edges (smallest gap per [CQ8])
- **Step 7c:** Emit signatures and modifiers
- **Step 7d:** Emit attribute access, call sites, and module resolution

---

#### Step 7a: Core PythonAdapter Implementation {#step-7a}

**Commit:** `feat(python): implement LanguageAdapter trait`

**References:** [D06] LanguageAdapter Trait Design, [CQ5] Cross-File Resolution, [CQ6] TypeInfo in Adapter

**Rationale:** Establish the adapter pattern before adding semantic fact emission. This ensures the basic infrastructure works before layering on complexity.

**Artifacts:**
- `PythonAdapter` struct implementing `LanguageAdapter`
- `PythonAnalyzerOptions` for configuration
- Basic conversion from `FileAnalysis` to `FileAnalysisResult`

**Tasks:**
- [x] Create `PythonAdapter` struct in `analyzer.rs`
- [x] Create `PythonAnalyzerOptions` struct with defaults
- [x] Implement `LanguageAdapter::analyze_file` by wrapping existing `analyze_file` function
- [x] Implement `LanguageAdapter::analyze_files` by wrapping existing `analyze_files` function
  - Build all cross-file state internally (multi-pass resolution)
  - Treat `store` parameter as empty read-only context
- [x] Implement `LanguageAdapter::language` returning `Language::Python`
- [x] Implement `LanguageAdapter::can_handle` checking for `.py` extension
- [x] Add `PythonAdapter::new()` constructor
- [x] Add `PythonAdapter::with_options(options: PythonAnalyzerOptions)` constructor
- [x] Export `PythonAdapter` from `tugtool_python`
- [x] Add basic conversion from `FileAnalysis` to `FileAnalysisResult`:
  - Scopes → `ScopeData`
  - Symbols → `SymbolData`
  - References → `ReferenceData`
  - Imports → `ImportData`
  - Exports → `ExportData`
- [x] Add conversion from `FileAnalysisBundle` to `AnalysisBundle`
- [x] Update adapter conversion to include `ImportKind` and new export fields
- [x] Emit `ExportIntent::Declared` for explicit `__all__` exports
- [x] Do **not** emit `ExportIntent::Effective` for Python (deferred per [D13])
- [x] Map native reference kinds to adapter `ReferenceKind`
- [x] **Integration layer:** Map adapter `ReferenceKind` to `facts::ReferenceKind`
- [x] **Integration layer:** Handle invalid `TypeInfoData` indices (log warning, skip entry, continue)
- [x] **Integration layer:** Verify existing ID allocation code works with adapter output

**Tests:**
- [x] Unit: `PythonAdapter::can_handle` returns true for `.py` files
- [x] Unit: `PythonAdapter::can_handle` returns false for `.rs` files
- [x] Unit: `PythonAdapter::language` returns `Language::Python`
- [x] Unit: `AnalysisBundle.types` is populated with type information
- [x] Unit: Adapter `ReferenceKind::Definition` maps to FactsStore `ReferenceKind::Definition`
- [x] Integration: `PythonAdapter::analyze_files` produces same results as direct function call
- [x] Integration: Integration layer correctly allocates IDs and populates FactsStore
- [x] Integration: Existing rename tests pass with adapter
- [x] Unit: Invalid `TypeInfoData` index logs warning and is skipped (not panic)

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python adapter`
- [x] `cargo nextest run -p tugtool-python rename`

**Rollback:** Revert commit

**Commit after all checkpoints pass.**

---

#### Step 7b: Emit Alias Edges {#step-7b}

**Commit:** `feat(python): emit alias edges in adapter output`

**References:** [D18] Alias Edges, [CQ7] AliasEdge vs AliasOutput, [CQ8] Python Analyzer Capability

**Rationale:** Alias tracking has the smallest gap - infrastructure exists from Phase 10. Just need to add `AliasKind` and convert to adapter types.

**Existing Infrastructure (per [CQ8]):**
- `crates/tugtool-python/src/alias.rs` - `AliasGraph`, `AliasInfo` complete
- `AliasInfo` has: `alias_name`, `source_name`, `scope_path`, `alias_span`, `source_is_import`, `confidence`

**Work Required:**
- Add `AliasKind` classification (Assignment vs Import vs ReExport)
- Convert `AliasInfo` to `AliasEdgeData` with symbol index resolution

**AliasGraph Transition Decision:**
`AliasGraph` (in `alias.rs`) and `AliasEdge` (in FactsStore) **coexist** with different roles:

| Layer | Type | Lifetime | Purpose |
|-------|------|----------|---------|
| CST/Analysis | `AliasGraph`, `AliasInfo` | Per-analysis (ephemeral) | In-memory graph for alias resolution during analysis |
| FactsStore | `AliasEdge` | Persisted | Serializable alias facts for queries and output |

**Coexistence rationale:**
- `AliasGraph` provides efficient transitive closure computation needed during analysis
- `AliasEdge` provides persistence and cross-file visibility after analysis
- Converting at the boundary keeps each representation optimized for its use case

**Conversion flow:**
1. Python analyzer builds `AliasGraph` during multi-file analysis (Phase 10 infrastructure)
2. At adapter boundary, convert `AliasInfo` entries to `AliasEdgeData`
3. Integration layer converts `AliasEdgeData` to `AliasEdge` with SymbolId resolution

**No removal:** `AliasGraph` is NOT deprecated or removed. It remains the in-memory representation for analysis passes.

**Tasks:**
- [x] Extend `AliasInfo` (or create wrapper) to include `AliasKind`
- [x] Classify aliases during `AliasGraph::from_analysis`:
  - `source_is_import == true` → `AliasKind::Import`
  - `source_is_import == false` → `AliasKind::Assignment`
  - (ReExport detected via `__all__` membership → `AliasKind::ReExport`)
- [x] Add `aliases: Vec<AliasEdgeData>` to `FileAnalysisResult`
- [x] Convert `AliasInfo` to `AliasEdgeData`:
  - Resolve `alias_name` → `alias_symbol_index` via symbol lookup
  - Resolve `source_name` → `target_symbol_index` (may be `None` if unresolved)
  - Map `confidence` directly
- [x] **Integration layer:** Convert `AliasEdgeData` to `AliasEdge` with SymbolId resolution
- [x] **Integration layer:** Add `aliases_from_edges()` query to convert for JSON output

**Tests:**
- [x] Unit: Assignment alias classified as `AliasKind::Assignment`
- [x] Unit: Import alias classified as `AliasKind::Import`
- [x] Unit: `confidence` preserved through conversion
- [x] Integration: Alias edges populated in FactsStore
- [x] Integration: `aliases_from_edges()` produces valid `AliasOutput`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python alias`
- [x] `cargo nextest run -p tugtool-core alias`

**Rollback:** Revert commit

**Commit after all checkpoints pass.**

---

#### Step 7c: Emit Signatures and Modifiers {#step-7c}

**Commit:** `feat(python): emit signatures, modifiers, and qualified names`

**References:** [D19] Qualified Names/Modifiers, [D21] Signatures/TypeParams, [CQ8], [CQ10]

**Rationale:** Signature infrastructure exists in CST but needs dedicated collection. This step creates `SignatureCollector` and wires it up.

**Existing Infrastructure (per [CQ8]):**
- `crates/tugtool-python-cst/src/nodes/expression.rs` - `Parameters`, `Param` CST nodes
- `crates/tugtool-python-cst/src/visitor/annotation.rs` - Type annotations collected

**Work Required:**
- Create `SignatureCollector` visitor
- Classify `ParamKind` from position in `Parameters` struct
- Extract modifiers from decorators and async/def keywords

**SignatureCollector Implementation Notes:**
The `SignatureCollector` follows the existing visitor pattern in `tugtool-python-cst/src/visitor/`. Key reference implementations:
- `ReferenceCollector` in `reference.rs` - similar traversal pattern
- `MethodCallCollector` in `method_call.rs` - function node handling

The collector extracts from `FunctionDef`/`AsyncFunctionDef` nodes:
1. **Parameters** - The `Parameters` CST node contains `posonly_params`, `params`, `star_kwonly`, `kwonly_params`, `star_arg`, `kwarg`
2. **ParamKind classification** - Determined by which field the param appears in:
   - `posonly_params` → `PositionalOnly` (before `/` separator)
   - `kwonly_params` → `KeywordOnly` (after `*` separator)
   - `star_arg` → `VarArgs`
   - `kwarg` → `KwArgs`
   - `params` → `Regular`
3. **Default spans** - From `Param.default` field
4. **Annotations** - From `Param.annotation` and `FunctionDef.returns`

**Risk Note:** This is a new collector but follows established patterns. Expect 2-3 iterations to handle edge cases (nested defaults, complex annotations). The `Parameters` struct documentation in `expression.rs` is authoritative.

**Tasks:**
- [x] Create `SignatureCollector` visitor in `tugtool-python-cst`:
  - Visit `FunctionDef` and `AsyncFunctionDef` nodes
  - Extract `Parameters` structure
  - Classify each param by kind based on position
  - Capture default value spans from `param.default`
  - Capture return annotation from `node.returns`
- [x] Add `signatures: Vec<SignatureData>` to `FileAnalysisResult`
- [x] Add `modifiers: Vec<ModifierData>` to `FileAnalysisResult`
- [x] Detect modifiers from:
  - `async def` → `Modifier::Async`
  - `@staticmethod` → `Modifier::Static`
  - `@classmethod` → `Modifier::ClassMethod`
  - `@property` → `Modifier::Property`
  - `@abstractmethod` → `Modifier::Abstract`
- [x] Add `qualified_names: Vec<QualifiedNameData>` to `FileAnalysisResult`
- [x] Compute qualified names as `module_path.scope_path.symbol_name`
- [x] Add `type_params: Vec<TypeParamData>` to `FileAnalysisResult` (for generic functions)

**QualifiedName Computation Ownership:**
The **adapter** computes qualified name paths. This is the correct ownership because:
1. Adapters already track scope hierarchy during analysis (needed for symbol resolution)
2. Module path is known from the file being analyzed
3. Scope path is built during traversal (class names, nested function names)

**Computation algorithm (in adapter):**
```
qualified_name = module_path + "." + scope_chain.join(".") + "." + symbol_name
```

**Examples:**
- `pkg/mod.py`, top-level `def foo()` → `"pkg.mod.foo"`
- `pkg/mod.py`, `class Bar`, method `baz()` → `"pkg.mod.Bar.baz"`
- `pkg/__init__.py`, `class X` → `"pkg.X"`

**Note:** The integration layer does NOT recompute paths. It passes them through directly from `QualifiedNameData` to `QualifiedName`.
- [x] **Integration layer:** Convert to FactsStore types

**Tests:**
- [x] Unit: `ParamKind::PositionalOnly` for params before `/`
- [x] Unit: `ParamKind::KeywordOnly` for params after `*`
- [x] Unit: `ParamKind::VarArgs` for `*args`
- [x] Unit: `ParamKind::KwArgs` for `**kwargs`
- [x] Unit: `Modifier::Async` detected for async functions
- [x] Unit: `Modifier::Property` detected for `@property`
- [x] Integration: Signatures populated in FactsStore
- [x] Integration: Modifiers populated for decorated functions
- [x] Integration: Qualified names computed correctly

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python signature`
- [x] `cargo nextest run -p tugtool-python modifier`

**Rollback:** Revert commit

**Commit after all checkpoints pass.**

---

#### Step 7d: Emit Attribute Access, Call Sites, and Module Resolution {#step-7d}

**Commit:** `feat(python): emit attribute access, call sites, and module resolution`

**References:** [D16] Attribute Access, [D17] Call Sites, [D20] Module Resolution, [CQ8]

**Rationale:** Attribute access and call sites require the most CST work - extending collectors with read/write/call context detection and argument walking.

**Existing Infrastructure (per [CQ8]):**
- `crates/tugtool-python-cst/src/visitor/reference.rs` - `ReferenceKind::Attribute`
- `crates/tugtool-python-cst/src/visitor/method_call.rs` - `MethodCallCollector`
- `crates/tugtool-python-cst/src/nodes/expression.rs` - `Arg` CST node

**Work Required:**
- Add `AttributeAccessKind` (Read/Write/Call) detection
- Extend `MethodCallCollector` with argument walking
- Build module resolution map from file paths

**Attribute Context Detection Implementation Notes:**
This is the most complex part of Phase 11 semantic facts. Detecting Read/Write/Call requires tracking the AST context in which an attribute access appears:

1. **Read context** (default): `obj.attr` used in an expression position (load)
   - Right side of assignment: `x = obj.attr`
   - Function argument: `f(obj.attr)`
   - Return value: `return obj.attr`

2. **Write context**: `obj.attr` is the target of an assignment or augmented assignment
   - Assignment target: `obj.attr = value`
   - Augmented assignment: `obj.attr += value`
   - Tuple unpacking target: `obj.a, obj.b = values`

3. **Call context**: `obj.attr` followed immediately by a call
   - Method call: `obj.attr()`
   - Method call with args: `obj.attr(x, y)`

**Implementation approach:**
- Extend `ReferenceCollector` to pass context from parent nodes
- Track assignment targets during `visit_assign` and `visit_aug_assign`
- Check if the attribute's parent expression is a `Call` node
- Use a context stack or parent pointer pattern (similar to how scope tracking works)

**Reference patterns:**
- `crates/tugtool-python-cst/src/visitor/reference.rs:visit_attribute` - current attribute handling
- Python CST: `Assign.targets`, `AugAssign.target`, `Call.func` fields

**Risk Note:** Context detection may require 2-3 iterations. Start with simple cases (direct assignment, direct call) and add complex cases (chained assignments, nested calls) incrementally.

**Tasks:**
- [x] Create `AttributeAccessCollector` or extend `ReferenceCollector`:
  - Track `obj.attr` patterns with base expression context
  - Detect `AttributeAccessKind::Read` for load context
  - Detect `AttributeAccessKind::Write` for store context (`obj.attr = x`)
  - Detect `AttributeAccessKind::Call` for call context (`obj.attr()`)
- [x] Add `attributes: Vec<AttributeAccessData>` to `FileAnalysisResult`
- [x] Extend `MethodCallCollector` or create `CallSiteCollector`:
  - Walk `Call.args` to extract argument info
  - `arg.keyword` is `Some` for keyword args, `None` for positional
  - Capture spans for each argument
- [x] Add `calls: Vec<CallSiteData>` to `FileAnalysisResult`
- [x] Build module resolution map in `AnalysisBundle`:
  - Map module paths to file indices
  - Support namespace packages (multiple files per path)
- [x] Add `modules: Vec<ModuleResolutionData>` to `AnalysisBundle`
- [x] **Integration layer:** Convert to FactsStore types
- [x] **Integration layer:** Convert `ExportData.origin_module_path` to `origin_module_id`
- [x] **Integration layer:** Build `ModuleResolution` from `AnalysisBundle.modules`
- [x] **Integration layer:** Drop invalid module file indices (log warning, continue)
- [x] **Integration layer:** If `origin_module_path` unresolvable, log warning, leave `origin_module_id = None`

**Tests:**
- [x] Unit: `AttributeAccessKind::Read` for `obj.x` in load context
- [x] Unit: `AttributeAccessKind::Write` for `obj.x = 1`
- [x] Unit: `AttributeAccessKind::Call` for `obj.x()`
- [x] Unit: `CallArg` with keyword name for `f(x=1)`
- [x] Unit: `CallArg` without name for `f(1)`
- [x] Unit: Module resolution maps path to file
- [x] Unit: Namespace package maps path to multiple files
- [x] Unit: Unresolvable `origin_module_path` logs warning and leaves `origin_module_id = None`
- [x] Unit: Invalid `ModuleResolutionData.file_indices` are dropped with warning
- [x] Integration: AttributeAccess facts populated in FactsStore
- [x] Integration: CallSite facts populated in FactsStore
- [x] Integration: ModuleResolution populated in FactsStore

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python attribute`
- [x] `cargo nextest run -p tugtool-python call`
- [x] `cargo nextest run -p tugtool-python module_resolution`
- [x] `cargo nextest run --workspace`

**Rollback:** Revert commit

**Commit after all checkpoints pass.**

---

#### Step 7 Summary {#step-7-summary}

**Execution Order:** Step 7a → Step 7b → Step 7c → Step 7d

Each step is a buildable commit:
1. **Step 7a:** Core PythonAdapter (basic adapter infrastructure)
2. **Step 7b:** Alias edges (smallest gap, builds on Phase 10)
3. **Step 7c:** Signatures + modifiers + qualified names (new collector)
4. **Step 7d:** Attribute access + call sites + module resolution (most CST work)

After completing all steps, you will have:
- `PythonAdapter` implementing `LanguageAdapter`
- All semantic fact types emitted by the adapter
- Integration layer converting adapter output to FactsStore

**Final Step 7 Checkpoint:**
- [x] `cargo nextest run -p tugtool-python`
- [x] `cargo nextest run --workspace`

---

#### Step 8: Python Visibility Inference from Naming Conventions {#step-8}

**Commit:** `feat(python): add optional visibility inference from naming conventions`

**References:** [D09] Python Visibility Inference Strategy, Table T01 (Python section), (#visibility-mapping)

**Artifacts:**
- `infer_visibility` option in `PythonAnalyzerOptions`
- Visibility inference logic in symbol registration
- Updated Symbol population with visibility

**Tasks:**
- [x] Add `infer_visibility: bool` field to `PythonAnalyzerOptions` (default: false)
- [x] Create `infer_python_visibility(name: &str) -> Option<Visibility>` helper function:
  - `__name__` (dunders) -> `Some(Visibility::Public)`
  - `__name` (name mangling) -> `Some(Visibility::Private)`
  - `_name` (single underscore) -> `Some(Visibility::Private)`
  - `name` (no prefix) -> `None` (unknown)
- [x] Update symbol registration in `analyze_files` Pass 2:
  - If `options.infer_visibility` is true, call `infer_python_visibility`
  - Set `Symbol.visibility` based on result
- [x] Ensure visibility is propagated through `with_visibility` builder

**Tests:**
- [x] Unit: `infer_python_visibility("_private")` returns `Some(Private)`
- [x] Unit: `infer_python_visibility("__mangled")` returns `Some(Private)`
- [x] Unit: `infer_python_visibility("__init__")` returns `Some(Public)`
- [x] Unit: `infer_python_visibility("public_func")` returns `None`
- [x] Integration: With `infer_visibility: false`, all symbols have `visibility: None`
- [x] Integration: With `infer_visibility: true`, `_helper` has `visibility: Some(Private)`
- [x] Integration: With `infer_visibility: true`, `__init__` has `visibility: Some(Public)`
- [x] Integration: Existing tests pass with default options

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python visibility`
- [x] `cargo nextest run -p tugtool-python`

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
  - `Extension { name: String, args: Vec<TypeNode> }`
  - `Unknown`
- [ ] Add `#[serde(tag = "kind", rename_all = "snake_case")]` for clean JSON
- [ ] Add `#[non_exhaustive]` to `TypeNode`
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
- Rust-specific constructs and `TypeNode::Extension` generation

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
- [ ] Update output schema docs/golden files if SymbolInfo or outputs changed

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
- [ ] `PublicExport` includes precise spans and export intent/origin
- [ ] `ImportKind` replaces `Import.is_star`
- [ ] `ModuleKind` generalized for directory-based modules
- [ ] `Module.decl_span` captured for inline modules when present
- [ ] `ScopeKind` extended with Rust variants, `#[non_exhaustive]`
- [ ] `LanguageAdapter` trait defined in `tugtool-core`
- [ ] `PythonAdapter` implements `LanguageAdapter` in `tugtool-python`
- [ ] Python visibility inference works with `infer_visibility` option
- [ ] `TypeNode` provides structured type representation
- [ ] `TypeNode` is `#[non_exhaustive]` with `Extension`
- [ ] `ReferenceKind::Delete` supported and adapter kinds mapped
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
- [ ] Steps 1-2, 2.1 complete
- [ ] Symbol can have visibility
- [ ] ScopeKind ready for Rust
- [ ] ScopeKind consolidated (no duplicate enum in Python analyzer)

**Milestone M01b: Import/Module Generalization** {#m01b-import-module}
- [ ] Step 2.5 complete
- [ ] ImportKind in place, ModuleKind generalized
- [ ] Module decl_span available for inline modules

**Milestone M01c: ReferenceKind Generalization** {#m01c-referencekind}
- [ ] Step 2.6 complete
- [ ] FactsStore ReferenceKind supports Delete
- [ ] Adapter ReferenceKind includes Definition/Delete

**Milestone M01d: Semantic Facts Foundation** {#m01d-semantic-facts}
- [ ] Steps 2.7a-2.7e complete
- [ ] Alias edges persisted in FactsStore (Step 2.7a)
- [ ] Signatures and type parameters available (Step 2.7b)
- [ ] Attribute access and call sites captured (Step 2.7c)
- [ ] Qualified names and modifiers available (Step 2.7d)
- [ ] Module resolution map populated (Step 2.7e)

**Milestone M02: Export Generalization** {#m02-export}
- [ ] Steps 3, 3a, 3b, 3c complete
- [ ] PublicExport type available with precise spans
- [ ] Legacy Export and ExportId removed
- [ ] Python analyzer emits PublicExport
- [ ] Rename operations use PublicExport

**Milestone M03: Language Adapter Ready** {#m03-adapter}
- [ ] Step 4 complete
- [ ] LanguageAdapter trait defined

**Milestone M04: Python Adapter Complete** {#m04-python-adapter}
- [ ] Steps 7a-7d complete
- [ ] Core PythonAdapter implements LanguageAdapter (Step 7a)
- [ ] Alias edges emitted (Step 7b)
- [ ] Signatures, modifiers, qualified names emitted (Step 7c)
- [ ] Attribute access, call sites, module resolution emitted (Step 7d)
- [ ] Step 8 complete (visibility inference)
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
