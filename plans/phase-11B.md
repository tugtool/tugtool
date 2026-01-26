## Phase 11B: Address Phase 11 Implementation Gaps {#phase-11b}

**Purpose:** Fix implementation gaps discovered during Phase 11 review, focusing on missing span handling, symbol resolution for attribute accesses and method calls, effective export inference, and incremental analysis preparation.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | N/A |
| Last updated | 2026-01-26 |
| Prior phase | Phase 11 (FactsStore Architectural Improvements) |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phase 11 successfully implemented the FactsStore architectural improvements, including the new export model, visibility system, adapter trait, and semantic facts. However, a post-implementation review identified five deficiencies that reduce refactoring fidelity and block future capabilities:

1. **Finding 1 (MEDIUM):** `PythonAdapter::analyze_files` ignores the pre-populated `FactsStore` parameter, always creating a fresh store. This blocks cross-file resolution and incremental analysis (Model B from Phase 11 [CQ5]).

2. **Finding 2 (MEDIUM):** Attribute access and method call facts have `None` for symbol resolution fields (`base_symbol_index`, `callee_symbol_index`). TypeTracker exists but is not integrated.

3. **Finding 3 (HIGH):** 15+ locations normalize missing spans to `Span::new(0, 0)`. This hides missing data and can cause silent failures in edit operations.

4. **Finding 4 (MEDIUM):** Exports are only emitted for explicit `__all__`. No effective export inference for modules without `__all__` (Phase 11 [D13] deferred this).

5. **Finding 5 (LOW):** Attribute receiver strings use placeholders (`<expr>`, `<call>`) instead of extracting callee names from complex expressions.

#### Strategy {#strategy}

- **Fail-early for missing spans**: Replace silent `Span::new(0, 0)` with explicit `Option<Span>` propagation and fail/warn at call sites
- **Integrate TypeTracker for symbol resolution**: Wire existing type inference into attribute access and call site conversion
- **Incremental analysis groundwork**: Use pre-populated FactsStore for cross-file symbol lookup
- **Effective exports as opt-in**: Add `PythonAnalyzerOptions.compute_effective_exports` flag
- **Receiver extraction improvement**: Handle `Call` expressions by extracting callee name

#### Stakeholders / Primary Customers {#stakeholders}

1. Claude Code agent (primary consumer of tug refactoring)
2. Tugtool developers extending analysis capabilities
3. Users depending on reliable rename operations

#### Success Criteria (Measurable) {#success-criteria}

- [ ] No `Span::new(0, 0)` patterns remain in analyzer.rs conversion functions for required fields
- [ ] Adapter data types use `Option<Span>` where spans may be absent
- [ ] Integration layer logs warnings and skips entries with missing required spans
- [ ] `base_symbol_index` is populated for attribute accesses when receiver type is known
- [ ] `callee_symbol_index` is populated for method calls when receiver type is known
- [ ] `PythonAnalyzerOptions.compute_effective_exports` exists and works
- [ ] `Span::new(0, 0)` in call argument conversion is replaced with explicit handling
- [ ] Receiver extraction handles `Call` expressions by extracting callee name
- [ ] Tests verify symbol resolution for typed method calls
- [ ] `store` parameter in `analyze_files` is used for cross-file resolution (not ignored)
- [ ] `CrossFileSymbolMap::from_store()` exists and builds lookup maps
- [ ] Cross-file type resolution works when store has prior analysis

#### Scope {#scope}

**Finding 3 (HIGH) - Missing Spans:**
1. Audit all `Span::new(0, 0)` usages in conversion functions
2. Propagate `Option<Span>` through adapter data types where appropriate
3. Add validation at integration layer to skip/warn on missing spans
4. Update tests to verify proper span handling

**Finding 2 (MEDIUM) - Symbol Resolution:**
5. Integrate TypeTracker with attribute access conversion
6. Integrate TypeTracker with call site conversion
7. Build receiver-to-symbol resolution using existing infrastructure
8. Add tests for typed method call resolution

**Finding 4 (MEDIUM) - Effective Exports:**
9. Add `compute_effective_exports` option to `PythonAnalyzerOptions`
10. Implement effective export inference for modules without `__all__`
11. Emit `ExportIntent::Effective` entries
12. Add tests for effective export computation

**Finding 5 (LOW) - Receiver Placeholders:**
13. Extend `get_receiver_string` to extract callee name from `Call` expressions
14. Add tests for complex receiver extraction

**Finding 1 (MEDIUM) - Cross-File Resolution:**
15. Implement `CrossFileSymbolMap::from_store()` constructor
16. Remove underscore from `_store` parameter and wire it through
17. Use store for cross-file symbol lookup during conversion
18. Add integration tests for cross-file resolution

#### Non-goals (Explicitly out of scope) {#non-goals}

- Full incremental analysis with cache invalidation
- Cross-file type inference beyond current TypeTracker capabilities
- Rust or other language adapter implementations
- Breaking changes to adapter trait signature

#### Dependencies / Prerequisites {#dependencies}

- Phase 11 complete
- TypeTracker infrastructure operational
- Current test suite passing

#### Constraints {#constraints}

- **Breaking changes allowed** (no external users; no compatibility required)
- Performance: No significant regression in analysis speed
- Backward compatibility with existing JSON output format

#### Assumptions {#assumptions}

- TypeTracker's scope-aware type resolution is correct and complete for simple cases
- Existing span collection in CST visitors is mostly complete
- Effective export rules follow Python's documented behavior

---

### Open Questions {#open-questions}

#### [Q01] Should missing spans be errors or warnings? (DECIDE) {#q01-missing-spans}

**Question:** When a span is required for an operation (e.g., rename edit) but is missing, should the system error or warn?

**Why it matters:** Errors stop processing early; warnings allow partial results but may hide bugs.

**Options:**
- Option A: **Error** - Fail immediately when required span is missing
- Option B: **Warn + Skip** - Log warning, skip the entry, continue processing
- Option C: **Context-dependent** - Error for critical paths (edits), warn for informational paths (analysis)

**Plan to resolve:** Review call sites where spans are used. Categorize as critical vs informational.

**Recommendation:** Option C. Rename operations that would produce invalid edits should error. Analysis output that is purely informational can warn and skip.

#### [Q02] How deep should receiver extraction go? (DECIDE) {#q02-receiver-depth}

**Question:** For `get_obj().method()`, should we extract `"get_obj"` or keep `"<call>"`?

**Why it matters:** Extracting the callee name enables potential future resolution via return type.

**Options:**
- Option A: Extract callee name from `Call` expressions (e.g., `"get_obj"`)
- Option B: Keep `<call>` placeholder for all non-trivial receivers
- Option C: Extract to arbitrary depth with structured representation

**Plan to resolve:** Analyze benefit vs complexity.

**Recommendation:** Option A. Extract callee name for simple `Call` expressions as groundwork for future return-type-based resolution.

---

### Clarifying Questions Summary {#cq-summary}

#### [CQ1] What is the TypeTracker integration point? (RESOLVED) {#cq1-typetracker-integration}

**Question:** Where does TypeTracker get built and how is it passed to conversion functions?

**Resolution:** TypeTracker is built during `analyze_file` from assignments and annotations. It should be passed to `convert_file_analysis` and used to resolve receiver types for attribute accesses and method calls.

#### [CQ2] What is the effective export rule for Python? (RESOLVED) {#cq2-effective-export-rule}

**Question:** What symbols constitute the "effective public API" when `__all__` is absent?

**Resolution:** From Phase 11 [D13]:
```
If __all__ absent:
  effective_exports = {
    module-level symbols where:
      - name doesn't start with "_", OR
      - name is "__dunder__"
    AND
      - symbol is defined in this file (not imported)
  }
```

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Span propagation breaks existing tests | high | med | Run full test suite after each step; update golden files | Any test failure |
| TypeTracker resolution incomplete | med | low | Fall back to `None` when type is unknown | Resolution rate below 50% on typed code |
| Effective export logic incorrect | med | low | Test against well-known Python packages | Mismatch with `dir(module)` output |
| Performance regression from extra lookups | low | low | Profile before/after; cache lookups if needed | >10% slowdown on Temporale |

---

### 11B.0 Design Decisions {#design-decisions}

#### [D01] Span Validation Strategy (DECIDED) {#d01-span-validation}

**Decision:** Replace `unwrap_or_else(|| Span::new(0, 0))` with explicit span handling. The approach differs based on whether the data is derived/computed or syntactic:

**Category 1: Derived/computed data** - spans may genuinely be absent
- `CallArgData`, `AttributeAccessData`, `AliasEdgeData`
- **Action:** Change type to `Option<Span>`, propagate through

```rust
// Derived data types use Option<Span>:
pub struct CallArgData {
    pub name: Option<String>,
    pub span: Option<Span>,  // May be absent
}

// Conversion propagates Option directly:
CallArgData {
    name: arg.name.clone(),
    span: arg.span,  // Pass through Option<Span>
}
```

**Category 2: Syntactic data** - represents actual syntax nodes that must have positions
- `SymbolData`, `ReferenceData`, `ExportData`, `CallSiteData`
- **Action:** Keep as `Span`, but **filter out entries without spans at conversion time**

```rust
// Syntactic data types keep required Span:
pub struct SymbolData {
    pub decl_span: Span,  // Required - a symbol IS its declaration
}

// Conversion filters entries without spans:
let Some(span) = symbol.span else {
    // Skip entries that lack spans - they can't be edit targets
    continue;
};
result.symbols.push(SymbolData {
    decl_span: span,
    ...
});
```

**Rationale:**
- `Span::new(0, 0)` is indistinguishable from a valid span at position 0
- Derived data (args, attributes, aliases) may lack spans due to inference or error recovery
- Syntactic data (symbols, references, exports, calls) represents actual code locations
- A symbol without a declaration span is not a valid symbol for rename operations
- Filtering at conversion prevents garbage data from propagating

**Implications:**
- Update `CallArgData`, `AttributeAccessData`, `AliasEdgeData` to use `Option<Span>`
- Keep `SymbolData`, `ReferenceData`, `ExportData`, `CallSiteData` with required `Span`
- Add filtering in conversion functions to skip syntactic entries without spans
- Add filtering in FactsStore population to skip entries without spans

#### [D02] TypeTracker Integration for Symbol Resolution (DECIDED) {#d02-typetracker-integration}

**Decision:** Pass TypeTracker to conversion functions and use it to resolve receiver types.

```rust
impl PythonAdapter {
    fn convert_file_analysis(
        &self,
        analysis: &FileAnalysis,
        type_tracker: &TypeTracker,  // Add parameter
    ) -> FileAnalysisResult {
        // ...

        // For attribute accesses:
        for attr in &analysis.attribute_accesses {
            // Try to resolve receiver to a symbol via type inference
            let base_symbol_index = self.resolve_receiver_to_symbol(
                &attr.receiver,
                &attr.scope_path,
                type_tracker,
                &symbol_name_to_index,
            );
            // ...
        }
    }

    fn resolve_receiver_to_symbol(
        &self,
        receiver: &str,
        scope_path: &[String],
        tracker: &TypeTracker,
        symbol_map: &HashMap<&str, usize>,
    ) -> Option<usize> {
        // If receiver is a simple name, look up its type
        // If type is known, resolve to a symbol using local map first,
        // then fall back to cross-file lookup from FactsStore.
        let receiver_type = tracker.type_of(scope_path, receiver)?;
        symbol_map
            .get(receiver_type)
            .copied()
            .or_else(|| self.lookup_symbol_in_store(receiver_type))
    }
}
```

**Rationale:**
- TypeTracker already has the type information
- Symbol lookup maps already exist in conversion functions
- This enables downstream refactors to know what class a method belongs to

**Implications:**
- Pass TypeTracker through to conversion functions
- Add helper methods for receiver-to-symbol resolution and cross-file lookup
- `base_symbol_index` will be `Some(_)` when receiver type is known (local or cross-file)

#### [D03] Effective Export Computation (DECIDED) {#d03-effective-exports}

**Decision:** Add opt-in effective export computation via analyzer options.

```rust
pub struct PythonAnalyzerOptions {
    pub infer_visibility: bool,
    /// Compute effective exports for modules without __all__.
    ///
    /// When enabled and a module lacks __all__, emit ExportIntent::Effective
    /// entries for module-level symbols that don't start with "_" (except dunders).
    pub compute_effective_exports: bool,
}

impl Default for PythonAnalyzerOptions {
    fn default() -> Self {
        Self {
            infer_visibility: false,
            compute_effective_exports: false,
        }
    }
}
```

**Effective export rule:**
```rust
fn compute_effective_exports(analysis: &FileAnalysis) -> Vec<ExportData> {
    // Only compute if no explicit __all__
    if analysis.has_explicit_all() {
        return vec![];
    }

    analysis.symbols.iter()
        .filter(|s| is_module_level(s))
        .filter(|s| is_effectively_public(&s.name))
        .filter(|s| is_defined_here(s, analysis))  // Not imported
        .map(|s| ExportData {
            exported_name: Some(s.name.clone()),
            source_name: Some(s.name.clone()),
            decl_span: s.span.unwrap_or(Span::new(0, 0)),  // Symbol span
            exported_name_span: None,  // No explicit export syntax
            source_name_span: None,
            export_kind: ExportKind::PythonAll,  // Treat as implicit __all__
            export_target: ExportTarget::Implicit,
            export_intent: ExportIntent::Effective,
            export_origin: ExportOrigin::Implicit,
            origin_module_path: None,
        })
        .collect()
}

fn is_effectively_public(name: &str) -> bool {
    // Dunders are public
    if name.starts_with("__") && name.ends_with("__") && name.len() > 4 {
        return true;
    }
    // Names starting with _ are private
    !name.starts_with('_')
}

fn is_defined_here(symbol: &Symbol, analysis: &FileAnalysis) -> bool {
    // A symbol is defined here if it is a binding with a local definition
    // and does not originate from an import statement in this file.
    //
    // Implementation guideline:
    // - If the symbol's declaration span is present and within this file,
    //   treat it as defined here unless it is known to be imported.
    // - Use import data to exclude imported names (aliases included).
    let imported_names = analysis
        .imports
        .iter()
        .flat_map(|import| import.bound_names())
        .collect::<std::collections::HashSet<_>>();

    !imported_names.contains(symbol.name.as_str())
}
```

**Rationale:**
- Opt-in avoids overhead for callers who don't need it
- Matches Python's documented import behavior
- Enables move-module and API surface analysis

**Implications:**
- Add option to `PythonAnalyzerOptions`
- Add effective export computation in adapter
- Emit `ExportIntent::Effective` entries

#### [D04] Enhanced Receiver Extraction (DECIDED) {#d04-receiver-extraction}

**Decision:** Extract callee name from `Call` expressions.

```rust
fn get_receiver_string(expr: &Expression<'_>) -> String {
    match expr {
        Expression::Name(name) => name.value.to_string(),
        Expression::Attribute(attr) => {
            let base = Self::get_receiver_string(&attr.value);
            format!("{}.{}", base, attr.attr.value)
        }
        Expression::Call(call) => {
            // NEW: Extract callee name from call expression
            // For `get_obj()`, extract "get_obj"
            // For `get_obj().method()`, this would be an Attribute on a Call
            Self::get_receiver_string(&call.func)
        }
        Expression::Subscript(_) => "<subscript>".to_string(),
        _ => "<expr>".to_string(),
    }
}
```

**Rationale:**
- Callee names enable future return-type-based resolution
- Simple change with immediate benefit
- Maintains fallback for truly complex expressions

**Implications:**
- Update `attribute_access.rs` receiver extraction
- Add tests for call expression receivers

---

#### [D05] Cross-File Symbol Resolution Mapping (DECIDED) {#d05-cross-file-mapping}

**Decision:** Provide a narrow, adapter-owned mapping from `FactsStore` IDs to adapter indices
for cross-file resolution, without expanding the adapter trait.

**API shape:**
```rust
/// Cross-file symbol lookup helper produced by the integration layer.
struct CrossFileSymbolMap {
    /// Fully-qualified name -> adapter symbol index in AnalysisBundle.
    qualified_to_index: std::collections::HashMap<String, usize>,
    /// Optional fallback: simple name -> adapter symbol index (ambiguous allowed).
    name_to_index: std::collections::HashMap<String, usize>,
}

impl CrossFileSymbolMap {
    fn resolve(&self, name: &str) -> Option<usize> {
        self.qualified_to_index
            .get(name)
            .copied()
            .or_else(|| self.name_to_index.get(name).copied())
    }
}
```

**Resolution flow:**
1. Integration layer builds `CrossFileSymbolMap` by scanning `FactsStore` symbols
   (and their qualified names when available).
2. Adapter conversion uses the map to resolve receiver type names that are not
   defined in the current file.
3. If the name is ambiguous or missing, resolution returns `None`.

**Rationale:**
- Keeps the adapter trait unchanged.
- Avoids passing raw `FactsStore` IDs into adapter output.
- Centralizes cross-file lookup logic in one place.

**Implications:**
- Add a helper in the integration layer to build `CrossFileSymbolMap`
- Pass the map to conversion routines alongside `TypeTracker`
- Document resolution order: local map → cross-file map → None

#### [D06] Use Store Parameter in analyze_files (DECIDED) {#d06-use-store-parameter}

**Decision:** Remove the underscore from `_store` and use it as the source for `CrossFileSymbolMap`.

```rust
// BEFORE (broken - ignores pre-populated store)
fn analyze_files(
    &self,
    files: &[(String, String)],
    _store: &FactsStore,  // Ignored!
) -> Result<AnalysisBundle, Self::Error> {
    let mut temp_store = FactsStore::new();  // Fresh store
    // ...
}

// AFTER (uses store for cross-file resolution)
fn analyze_files(
    &self,
    files: &[(String, String)],
    store: &FactsStore,  // Used for cross-file context
) -> Result<AnalysisBundle, Self::Error> {
    // Build CrossFileSymbolMap from store for cross-file resolution
    let cross_file_map = CrossFileSymbolMap::from_store(store);

    // Still build new analysis internally
    let mut temp_store = FactsStore::new();
    let bundle = analyze_files_internal(files, &mut temp_store)?;

    // Use cross_file_map during conversion for symbol resolution
    Ok(self.convert_file_analysis_bundle(&bundle, &cross_file_map))
}
```

**What the store provides:**
- Symbols already analyzed in prior passes (for incremental analysis)
- Cross-file type information (for receiver resolution)
- Import/export relationships (for re-export chain tracing)

**When store is empty:**
- CrossFileSymbolMap is empty
- Resolution falls back to local analysis only
- Behavior identical to current implementation

**Rationale:**
- This is what Phase 11 [CQ5] specified: "adapters treat FactsStore as read-only context"
- Enables incremental analysis workflows without full re-analysis
- Minimal change: just wire up existing infrastructure

**Implications:**
- Remove underscore from `_store` parameter
- Add `CrossFileSymbolMap::from_store()` constructor
- Pass map to conversion functions
- No changes to adapter trait signature

---

### 11B.1 Specification {#specification}

#### 11B.1.1 Inputs and Outputs {#inputs-outputs}

**Inputs:**
- Python source files
- `PythonAnalyzerOptions` with new `compute_effective_exports` flag
- Pre-populated `FactsStore` (for incremental analysis)

**Outputs:**
- `FileAnalysisResult` with:
  - `Option<Span>` for optional span fields
  - Populated `base_symbol_index` for resolved attribute accesses
  - Populated `callee_symbol_index` for resolved method calls
  - `ExportIntent::Effective` entries when enabled
- Warnings for missing required spans

#### 11B.1.2 Terminology {#terminology}

- **Required span**: Span that must be present for an operation to succeed (e.g., rename target)
- **Optional span**: Span that enhances analysis but is not strictly required
- **Effective export**: Symbol that is part of the public API by convention, not explicit declaration
- **Receiver resolution**: Mapping a receiver expression to its defining symbol via type inference

---

### 11B.2 Definitive Symbol Inventory {#symbol-inventory}

#### 11B.2.1 New files {#new-files}

None.

#### 11B.2.2 Modified files {#modified-files}

| File | Changes |
|------|---------|
| `crates/tugtool-core/src/adapter.rs` | Update `CallArgData.span` to `Option<Span>` |
| `crates/tugtool-python/src/analyzer.rs` | Pass TypeTracker to conversion; integrate symbol resolution; add effective exports; use `store` param for cross-file lookup; add `CrossFileSymbolMap` |
| `crates/tugtool-python-cst/src/visitor/attribute_access.rs` | Enhance receiver extraction for Call expressions |

#### 11B.2.3 Symbols to add/modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `CallArgData.span` | field | `adapter.rs` | Change from `Span` to `Option<Span>` |
| `PythonAnalyzerOptions.compute_effective_exports` | field | `analyzer.rs` | New opt-in flag |
| `PythonAdapter::resolve_receiver_to_symbol` | method | `analyzer.rs` | New helper for resolution |
| `CrossFileSymbolMap` | struct | `analyzer.rs` | Cross-file lookup helper |
| `CrossFileSymbolMap::from_store` | method | `analyzer.rs` | Build map from FactsStore |
| `CrossFileSymbolMap::resolve` | method | `analyzer.rs` | Look up symbol by name |
| `get_receiver_string` | function | `attribute_access.rs` | Enhanced for Call expressions |

---

### 11B.3 Documentation Plan {#documentation-plan}

- [ ] Update CLAUDE.md with `compute_effective_exports` option
- [ ] Add rustdoc for receiver resolution logic
- [ ] Document effective export rules in module docs
- [ ] Update adapter.rs docs for `Option<Span>` semantics

---

### 11B.4 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test individual functions | Receiver extraction, effective export logic |
| **Integration** | End-to-end analysis | TypeTracker + symbol resolution |
| **Golden** | Verify output format | Updated adapter output with resolved indices |

#### Test Fixtures {#test-fixtures}

**Receiver Extraction:**
```rust
#[test]
fn receiver_extraction_call() {
    // get_obj().method -> receiver should be "get_obj"
    let code = "x = get_obj().method()";
    // ... assert receiver is "get_obj"
}
```

**Symbol Resolution:**
```rust
#[test]
fn attribute_access_base_symbol_resolved() {
    let code = r#"
class Handler:
    def process(self): pass

h = Handler()
h.process()
"#;
    // ... assert base_symbol_index points to Handler class
}
```

**Effective Exports:**
```rust
#[test]
fn effective_exports_computed_without_all() {
    let code = r#"
def public_func(): pass
def _private_func(): pass
class PublicClass: pass
"#;
    // With compute_effective_exports=true
    // Assert: public_func, PublicClass are effective exports
    // Assert: _private_func is NOT exported
}
```

**Missing Span Handling:**
```rust
#[test]
fn missing_span_warns_and_skips() {
    // Create CallArgData with span: None
    // Integration layer should log warning and skip
}
```

---

### 11B.5 Execution Steps {#execution-steps}

#### Step 0: Audit and Categorize Span Usages {#step-0}

**Commit:** `chore: audit Span::new(0,0) usages in analyzer`

**References:** [D01] Span Validation Strategy

**Tasks:**
- [x] List all 15+ `Span::new(0, 0)` locations in analyzer.rs
- [x] Categorize each as: required (edits), optional (informational), or removable
- [x] Document findings in this step

**Span Usage Audit (from grep):**

**Key Insight (revised during Step 2):** There are two categories of span fields:

1. **Derived/computed data** (`CallArgData`, `AttributeAccessData`, `AliasEdgeData`) - spans may genuinely be absent due to inference or error recovery → Change type to `Option<Span>`

2. **Syntactic data** (`SymbolData`, `ReferenceData`, `ExportData`, `CallSiteData`) - these represent actual syntax nodes that must have positions → Keep as `Span`, but **filter out entries without spans at conversion time**

| Line | Context | Category | Action |
|------|---------|----------|--------|
| 622 | `scope.span.unwrap_or_else` | Optional | Keep as-is (scopes are informational) |
| 639 | `symbol.span.unwrap_or_else` | FactsStore | Filter: skip symbol if no span |
| 663 | `symbol.span.unwrap_or_else` | FactsStore | Filter: skip symbol if no span |
| 875 | `local_import.span.unwrap_or_else` | Optional | Keep as-is (imports are informational) |
| 915 | `local_export.span.unwrap_or_else` | FactsStore | Filter: skip export if no span |
| 961 | `local_ref.span.unwrap_or_else` | FactsStore | Filter: skip reference if no span |
| 1138 | `unwrap_or_else` | Optional | Keep as-is (index lookup, not edit target) |
| 3217 | `scope.span.unwrap_or` | Optional | Keep as-is |
| 3241 | `symbol.span.unwrap_or` | Syntactic | Filter: skip SymbolData if no span |
| 3256 | `reference.span.unwrap_or` | Syntactic | Filter: skip ReferenceData if no span |
| 3274 | `export.span.unwrap_or` | Syntactic | Filter: skip ExportData if no span |
| 3312 | `alias_info.alias_span.unwrap_or` | Derived | Change to Option<Span> ✓ |
| 3427 | `attr.attr_span.unwrap_or` | Derived | Change to Option<Span> ✓ |
| 3448 | `arg.span.unwrap_or` | Derived | Change to Option<Span> ✓ |
| 3454 | `call.span.unwrap_or` | Syntactic | Filter: skip CallSiteData if no span |
| 3603 | `import.span.unwrap_or` | Optional | Keep as-is |

**Artifacts:**
- Categorized list of span usages

**Tests:**
- N/A (audit step)

**Checkpoint:**
- [x] All usages categorized
- [x] Plan updated with findings

**LOC Estimate:** 0 (documentation only)

---

#### Step 1: Update Adapter Data Types for Optional Spans {#step-1}

**Commit:** `refactor(adapter): use Option<Span> for potentially missing spans`

**References:** [D01] Span Validation Strategy

**Artifacts:**
- Updated `CallArgData.span` to `Option<Span>`
- Updated tests

**Tasks:**
- [x] Change `CallArgData.span: Span` to `CallArgData.span: Option<Span>` in adapter.rs
- [x] Update any tests that construct `CallArgData`
- [x] Update doc comments to explain `None` semantics

**Tests:**
- [x] Unit: `CallArgData` can be constructed with `None` span
- [x] Unit: Existing tests updated to use `Some(span)`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core`
- [x] `cargo clippy --workspace`

**Rollback:**
- Revert commit

**LOC Estimate:** ~20

---

#### Step 2: Update Python Analyzer Conversion for Spans {#step-2}

**Commit:** `fix(python): propagate Option<Span> through conversion functions`

**References:** [D01] Span Validation Strategy, Step 0 audit

**Artifacts:**
- Conversion functions pass `Option<Span>` directly
- No more `Span::new(0, 0)` in conversion functions for required fields

**Tasks:**
- [x] Update `CallArgData` conversion to use `arg.span` directly (now Option)
- [x] Update `AttributeAccessData` conversion for `span` field
- [x] Add logging when spans are missing for required fields
- [x] Keep `Span::new(0, 0)` only for truly optional fields (scopes, imports)

**Tests:**
- [x] Unit: Conversion produces `None` span when source lacks span
- [x] Integration: Analyze file with complete spans
- [x] Integration: Analyze file with missing spans (synthetic case)

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python`
- [x] No warnings in normal analysis of Temporale

**Rollback:**
- Revert commit

**LOC Estimate:** ~50

---

#### Step 3: Integrate TypeTracker with Attribute Access Resolution {#step-3}

**Commit:** `feat(python): resolve attribute access base symbols via TypeTracker`

**References:** [D02] TypeTracker Integration

**Artifacts:**
- `resolve_receiver_to_symbol` helper method
- `base_symbol_index` populated when receiver type is known
- TypeTracker passed to `convert_file_analysis`

**Tasks:**
- [x] Add `resolve_receiver_to_symbol` method to `PythonAdapter`
- [x] Modify `convert_file_analysis` signature to accept `TypeTracker` reference
- [x] Build TypeTracker in `analyze_file` and pass to conversion
- [x] In attribute access conversion:
  - Extract receiver name (simple name case)
  - Look up receiver type via TypeTracker
  - Look up type's symbol index (local map, then cross-file via `FactsStore`)
  - Set `base_symbol_index` if resolved
- [x] Update `analyze_files` to build and pass TypeTracker per file
- [x] Add helper: `lookup_symbol_in_store(type_name: &str) -> Option<usize>` (deferred to Step 3a/7 for cross-file lookup; local lookup via symbol_name_to_index is implemented)

**Tests:**
- [x] Unit: `resolve_receiver_to_symbol` returns index for typed receiver
- [x] Unit: `resolve_receiver_to_symbol` returns None for untyped receiver
- [x] Integration: `h = Handler(); h.process()` -> base_symbol_index points to Handler

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python attribute`
- [x] `cargo nextest run -p tugtool-python type_tracker`

**Rollback:**
- Revert commit

**LOC Estimate:** ~80

---

#### Step 3a: Build Cross-File Symbol Map {#step-3a}

**Commit:** `feat(python): add cross-file symbol lookup map for adapter conversion`

**References:** [D05] Cross-File Symbol Resolution Mapping

**Artifacts:**
- `CrossFileSymbolMap` helper (integration layer)
- Resolution order documented in adapter conversion

**Tasks:**
- [x] Build `CrossFileSymbolMap` from `FactsStore` symbols and qualified names
- [x] Pass the map into `convert_file_analysis` (and any helper resolution routines)
- [x] Resolve cross-file types by qualified name first, then simple name
- [x] Document ambiguity handling (returns `None` when multiple matches)

**Tests:**
- [x] Unit: qualified name lookup resolves to adapter index
- [x] Unit: ambiguous simple-name lookup returns None
- [x] Integration: receiver type defined in another file resolves via map

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python adapter`

**Rollback:**
- Revert commit

**LOC Estimate:** ~90

---

#### Step 4: Integrate TypeTracker with Call Site Resolution {#step-4}

**Commit:** `feat(python): resolve method call callees via TypeTracker`

**References:** [D02] TypeTracker Integration

**Artifacts:**
- `callee_symbol_index` populated for method calls when receiver type is known

**Tasks:**
- [x] In call site conversion:
  - For method calls (`is_method_call == true`):
    - Extract receiver name from callee (e.g., "h" from "h.process")
    - Look up receiver type via TypeTracker
    - Look up type's symbol index (local map, then cross-file via `FactsStore`)
    - Set `callee_symbol_index` to the class symbol
  - For direct function calls, existing logic remains

**Tests:**
- [x] Integration: `h = Handler(); h.process()` -> callee_symbol_index for process call points to Handler
- [x] Integration: `process()` direct call -> callee_symbol_index points to process function

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python call`

**Rollback:**
- Revert commit

**LOC Estimate:** ~60

---

#### Step 5: Add Effective Export Computation {#step-5}

**Commit:** `feat(python): add compute_effective_exports option`

**References:** [D03] Effective Export Computation

**Artifacts:**
- `PythonAnalyzerOptions.compute_effective_exports` field
- `compute_effective_exports` function
- `ExportIntent::Effective` entries emitted

**Tasks:**
- [x] Add `compute_effective_exports: bool` to `PythonAnalyzerOptions` (default false)
- [x] Add `is_effectively_public` helper function
- [x] Add `compute_effective_exports` function:
  - Check if module has explicit `__all__`
  - If not, collect module-level symbols
  - Filter by naming convention
  - Filter out imported symbols (use `analysis.imports` to collect bound names)
  - Build `ExportData` with `ExportIntent::Effective`
- [x] Call from conversion when option is enabled
- [x] Merge effective exports with declared exports in output

**Tests:**
- [x] Unit: `is_effectively_public("foo")` -> true
- [x] Unit: `is_effectively_public("_foo")` -> false
- [x] Unit: `is_effectively_public("__init__")` -> true
- [x] Integration: Module without `__all__` produces effective exports when enabled
- [x] Integration: Module with `__all__` does not produce effective exports
- [x] Integration: Option disabled -> no effective exports

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python export`

**Rollback:**
- Revert commit

**LOC Estimate:** ~100

---

#### Step 6: Enhance Receiver Extraction for Call Expressions {#step-6}

**Commit:** `feat(python-cst): extract callee name from Call expression receivers`

**References:** [D04] Enhanced Receiver Extraction

**Artifacts:**
- Updated `get_receiver_string` function
- Tests for complex receivers

**Tasks:**
- [x] Update `get_receiver_string` in `attribute_access.rs`:
  - Add `Expression::Call` arm
  - Recursively call on `call.func` to get callee name
  - Handle nested cases gracefully
- [x] Add `Expression::Subscript` case with `<subscript>` placeholder
- [x] Update tests

**Tests:**
- [x] Unit: `get_obj().method` -> receiver is "get_obj"
- [x] Unit: `get_a().get_b().method` -> receiver is "get_a.get_b"
- [x] Unit: `data[0].method` -> receiver is "<subscript>"

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python-cst receiver`

**Rollback:**
- Revert commit

**LOC Estimate:** ~30

---

#### Step 7: Wire Store Parameter for Cross-File Resolution {#step-7}

**Commit:** `feat(python): use store parameter for cross-file symbol resolution`

**References:** [D06] Use Store Parameter, Finding 1

**Artifacts:**
- `CrossFileSymbolMap::from_store()` constructor
- `_store` parameter renamed to `store` and used
- Cross-file resolution enabled via store context

**Tasks:**
- [x] Add `CrossFileSymbolMap::from_store(store: &FactsStore) -> Self` constructor
  - Iterate over `store.symbols()` to build qualified name map
  - Iterate over `store.qualified_names()` if available
  - Build simple name fallback map
- [x] In `PythonAdapter::analyze_files`:
  - Remove underscore from `_store` → `store`
  - Call `CrossFileSymbolMap::from_store(store)` at start
  - Pass map to `convert_file_analysis_bundle`
- [x] Update `convert_file_analysis` signature to accept `&CrossFileSymbolMap`
- [x] In receiver resolution (Step 3), use cross-file map as fallback after local lookup
- [x] Add integration test: analyze two files where type is defined in file A, used in file B

**Tests:**
- [x] Unit: `CrossFileSymbolMap::from_store` on empty store returns empty map
- [x] Unit: `CrossFileSymbolMap::from_store` on populated store builds lookups
- [x] Integration: Cross-file type resolution works when store has prior facts
- [x] Integration: Empty store behaves same as current (no regression)

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python cross_file`
- [x] `cargo nextest run -p tugtool-python adapter`

**Rollback:**
- Revert commit

**LOC Estimate:** ~100

---

#### Step 8: Documentation and Final Verification {#step-8}

**Commit:** `docs: document Phase 11B changes`

**Tasks:**
- [ ] Document `compute_effective_exports` option in CLAUDE.md
- [ ] Add rustdoc for `CrossFileSymbolMap`, `resolve_receiver_to_symbol`, helper methods
- [ ] Update module docs for span handling semantics (`Option<Span>` vs `Span::new(0,0)`)
- [ ] Run full test suite
- [ ] Run analysis on Temporale fixture
- [ ] Verify no `Span::new(0, 0)` in required span paths
- [ ] Verify symbol resolution works for typed receivers
- [ ] Verify effective exports work when enabled
- [ ] Verify cross-file resolution works with pre-populated store

**Checkpoint:**
- [ ] `cargo doc --workspace --no-deps`
- [ ] `cargo nextest run --workspace`
- [ ] `.tug-test-venv/bin/python -m pytest .tug/fixtures/temporale/tests/ -v`
- [ ] Manual: Analyze sample file, check attribute access has base_symbol_index
- [ ] Manual: Analyze two files, verify cross-file type resolution

**Rollback:**
- Revert commit (docs only)

---

### 11B.6 Summary Table {#summary-table}

| Finding | Severity | Steps | LOC Estimate |
|---------|----------|-------|--------------|
| F3: Missing spans | HIGH | 0, 1, 2 | ~70 |
| F2: Symbol resolution | MEDIUM | 3, 3a, 4 | ~230 |
| F4: Effective exports | MEDIUM | 5 | ~100 |
| F5: Receiver placeholders | LOW | 6 | ~30 |
| F1: Cross-file resolution | MEDIUM | 7 | ~100 |
| **Total** | | | **~530** |

---

### 11B.7 Post-Phase Verification {#post-phase-verification}

After completing all steps:

1. **Span handling**: Grep for `Span::new(0, 0)` - should only appear in optional contexts (scopes, imports)
2. **Symbol resolution**: Analyze typed code, verify `base_symbol_index` is populated
3. **Effective exports**: Enable option, analyze module without `__all__`, verify exports
4. **Receiver extraction**: Analyze `get_obj().method()`, verify receiver is `"get_obj"`
5. **Cross-file resolution**: Analyze two files where type is in file A, used in file B; verify resolution works
6. **Store parameter**: Verify `_store` underscore removed and `CrossFileSymbolMap::from_store()` called
7. **Full regression**: Run Temporale integration tests
