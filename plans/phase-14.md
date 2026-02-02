# Phase 14: Python Refactoring Operations {#phase-14}

**Purpose:** Build concrete Python refactoring operations on top of the infrastructure established in Phase 13, expanding tugtool from a single-operation tool (rename) to a comprehensive refactoring engine with 10+ operations.

---

## Table of Contents

1. [Plan Metadata](#plan-metadata-14)
2. [Phase Overview](#phase-overview-14)
3. [Execution Steps](#execution-steps-14)
4. [Deliverables and Checkpoints](#deliverables-14)

---

### Plan Metadata {#plan-metadata-14}

| Field | Value |
|-------|-------|
| Owner | tugtool team |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-02 |

---

### Phase Overview {#phase-overview-14}

#### Context {#context-14}

Phase 13 established the foundational infrastructure for Python refactoring operations:
- Stage 0: Edit primitives (`BatchSpanEditor`), position lookup, stub discovery, FactsStore completeness
- Layer 0: Hardened rename operation with edge cases addressed
- Design decisions for side-effect analysis, control flow, code generation, and edit models

Phase 14 builds the actual refactoring operations on this foundation, implementing Layers 1-4 infrastructure and shipping 10 new operations.

#### Strategy {#strategy-14}

- **Layer-first implementation:** Continue building infrastructure in layers, not operation-by-operation
- **Progressive capability:** Each layer unlocks new operations; ship operations as layers complete
- **Conservative defaults:** When uncertain (side effects, control flow), refuse rather than break code
- **Agent-native throughout:** Every operation follows analyze/emit/apply workflow with JSON output

#### Dependencies / Prerequisites {#dependencies-14}

- **Phase 13 complete:** All Stage 0 infrastructure and Layer 0 hardening
- **Temporale fixture:** Test target for all operations
- **Edit primitives available:** `BatchSpanEditor` from [Phase 13 D07](phase-13.md#d07-edit-primitives)
- **Position lookup working:** From [Phase 13 Step 0.2](phase-13.md#step-0-2)
- **Stub discovery operational:** From [Phase 13 Step 0.3](phase-13.md#step-0-3)

#### Scope {#scope-14}

1. Implement Rename Parameter operation
2. Build Layer 1 infrastructure (expression analysis)
3. Implement Extract Variable and Extract Constant operations
4. Build Layer 2 infrastructure (side effects, use-def)
5. Implement Inline Variable and Safe Delete operations
6. Build Layer 3 infrastructure (import manipulation)
7. Implement Move Function and Move Class operations
8. Build Layer 4 infrastructure (method transformation)
9. Implement Extract Method, Inline Method, and Change Signature operations

#### Non-goals {#non-goals-14}

- **Organize Imports:** Ruff handles this well; defer
- **Pattern-based transforms:** Future phase
- **Layers 5-6 operations:** Encapsulate Field, Pull Up/Push Down, Move Module
- **Rust language support:** Separate phase

---

### Execution Steps {#execution-steps-14}

Phase 14 is organized into four stages, each building a layer of infrastructure and the operations it enables.

---

#### Stage 1: Layer 1 + Initial Operations {#stage-14-1}

##### Step 1.0: String Annotation Infrastructure {#step-14-1-0}

**Commit:** `feat(python): add string annotation span tracking and rename support`

**References:** [Phase 13 D08](phase-13.md#d08-stub-updates)

**Rationale:** Investigation revealed that string annotation support (renaming symbols inside forward references like `x: "Handler"`) requires foundational infrastructure that does not yet exist. This step adds that infrastructure before Step 1.1.

**Infrastructure Gaps Identified:**

| Gap | Description | Status |
|-----|-------------|--------|
| Gap 1 | `AnnotationInfo.span` tracks parameter/variable name, not the string literal span | ✓ Fixed |
| Gap 2 | No annotation-to-symbol resolution for string annotations | ✓ Fixed |
| Gap 3 | No FactsStore integration for string annotation spans | ✓ Fixed |
| Gap 4 | Rename operation doesn't query string annotations | ✓ Fixed |

**Existing Infrastructure:**
- Detection: `AnnotationCollector` detects `AnnotationKind::String` ✓
- Transformation: `StringAnnotationParser.rename()` handles all patterns ✓
- Pattern: Type comment handling in rename.rs (lines 787-833) provides template

**Artifacts:**
- Updated `crates/tugtool-python-cst/src/visitor/annotation.rs` (add `annotation_span`)
- Updated `crates/tugtool-python/src/types.rs` (add span to `AnnotationInfo`)
- Updated `crates/tugtool-python/src/ops/rename.rs` (integrate string annotation edits)

**Tasks:**
- [x] Add `annotation_span: Option<Span>` to `AnnotationInfo` in annotation.rs
- [x] Capture string literal span (including quotes) during annotation collection
- [x] Propagate annotation_span through `FileAnalysis.cst_annotations`
- [x] Add `string_annotations()` access via FileAnalysis.cst_annotations
- [x] Integrate string annotation handling into rename.rs (follow type comment pattern)
- [x] Add unit tests for annotation span extraction

**Tests:**
- [x] Unit: `test_annotation_span_string_literal`
- [x] Unit: `test_annotation_span_concatenated_string`
- [x] Unit: `test_annotation_span_return_type_string`
- [x] Unit: `test_annotation_span_non_string_is_none`
- [x] Unit: `test_annotation_span_variable_annotation`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python-cst annotation_span` - 6 tests pass
- [x] `cargo nextest run --workspace` - 2630 tests pass
- [x] String annotations renamed correctly in basic cases

**Rollback:** Revert commit

---

##### Step 1.1: Rename Parameter Operation {#step-14-1-1}

**Commit:** `feat(python): add rename-param operation`

**References:** [Phase 13 D05](phase-13.md#d05-rename-reference), [Phase 13 Operation 1](phase-13.md#op-rename-param), [Phase 13 D08](phase-13.md#d08-stub-updates), [Phase 13 Step 0.4](phase-13.md#step-0-4), [Phase 13 Step 1.1](phase-13.md#step-1-1)

**Prerequisites:**
- [Phase 13 Step 0.4](phase-13.md#step-0-4) (reference scope infrastructure)
- [Phase 13 Step 1.1](phase-13.md#step-1-1) (rename hardening)
- [Step 1.0](#step-14-1-0) (string annotation infrastructure)

**Artifacts:**
- Updated CLI in `crates/tugtool/src/cli.rs`
- New command: `tug apply python rename-param`

**Tasks:**
- [x] Extract rename-param logic from general rename
- [x] Add parameter-specific validation
- [x] Update call sites with keyword arguments
- [x] Update parameter names in `.pyi` stubs when present ([Phase 13 D08](phase-13.md#d08-stub-updates))
- [x] Update general rename to edit stubs per [Phase 13 D08](phase-13.md#d08-stub-updates) (deferred from Phase 13 Step 1.1)
- [x] Update general rename to edit string annotations per [Phase 13 D08](phase-13.md#d08-stub-updates) (deferred from Phase 13 Step 1.1)

**Tests:**
- [x] Integration: `test_rename_param_basic`
- [x] Integration: `test_rename_param_keyword_only`
- [x] Integration: `test_rename_param_updates_stub`
- [x] Integration: `test_rename_updates_stub` (deferred from Phase 13 Step 1.1)
- [x] Integration: `test_rename_updates_string_annotation` (deferred from Phase 13 Step 1.1)
- [ ] Golden: `rename_param_response.json`

**Checkpoint:**
- [x] `tug apply python rename-param --at test.py:1:11 --to recipient` - Verified with test file

**Rollback:** Revert commit

---

##### Step 1.2: Layer 1 Infrastructure {#step-14-1-2}

**Commit:** `feat(python): add Layer 1 expression analysis infrastructure`

**References:** [Phase 13 Layer 1](phase-13.md#layer-1), [Phase 13 Table T05](phase-13.md#t05-layer1-components), [Phase 13 Step 0.2](phase-13.md#step-0-2)

**Dependencies:** [Phase 13 Step 0.2](phase-13.md#step-0-2) (position lookup infrastructure)

**Artifacts:**
- New `crates/tugtool-python/src/layers/` module
- New `crates/tugtool-python/src/layers/expression.rs`
- Updated `crates/tugtool-python/src/lib.rs` (export layers module)

**Tasks:**
- [x] Create `layers/mod.rs` with module structure
- [x] Implement `ExpressionBoundaryDetector` (uses position lookup from [Phase 13 Step 0.2](phase-13.md#step-0-2))
- [x] Implement `UniqueNameGenerator`
- [x] Implement `SingleAssignmentChecker`
- [x] Handle comprehension/generator expression scopes
- [x] Add comprehensive unit tests

**Tests:**
- [x] Unit: `test_expression_boundary_simple`
- [x] Unit: `test_expression_boundary_parenthesized`
- [x] Unit: `test_unique_name_no_conflict`
- [x] Unit: `test_unique_name_with_conflict`
- [x] Unit: `test_single_assignment_true`
- [x] Unit: `test_single_assignment_reassigned`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python expression` - 16 tests pass
- [x] All Layer 1 components have >80% test coverage

**Rollback:** Revert commit, delete `layers/` directory

---

##### Step 1.3: Extract Variable Operation {#step-14-1-3}

**Commit:** `feat(python): add extract-variable operation`

**References:** [Phase 13 Operation 2](phase-13.md#op-extract-variable), [Phase 13 Layer 1](phase-13.md#layer-1), [Phase 13 D07](phase-13.md#d07-edit-primitives), [Phase 13 Step 0.1](phase-13.md#step-0-1), [Phase 13 Step 0.2](phase-13.md#step-0-2), [Step 1.2](#step-14-1-2)

**Artifacts:**
- New `crates/tugtool-python/src/ops/extract_variable.rs`
- CLI command: `tug apply python extract-variable`

**Placement Rules:**

The extracted variable assignment is inserted:
1. **Statement context:** Immediately before the statement containing the expression
2. **Expression context:** At the same indentation level as the enclosing statement
3. **Multi-line expressions:** Before the first line of the enclosing statement

**Rejection Cases (MVP):**
- Expression inside comprehension (would change semantics - evaluated per-iteration vs once)
- Expression inside lambda (cannot add statements)
- Expression inside decorator arguments (complex evaluation order)

**Tasks:**
- [ ] Implement extract-variable operation
- [ ] Validate expression boundary using Layer 1 infrastructure
- [ ] Generate unique name if not provided
- [ ] Detect insertion point (before enclosing statement)
- [ ] Detect and preserve indentation
- [ ] Replace expression with variable reference
- [ ] Reject comprehension/lambda/decorator contexts with clear error

**Tests:**
- [ ] Integration: `test_extract_variable_basic`
- [ ] Integration: `test_extract_variable_nested`
- [ ] Integration: `test_extract_variable_in_function`
- [ ] Integration: `test_extract_variable_multiline`
- [ ] Integration: `test_extract_variable_reject_comprehension`
- [ ] Integration: `test_extract_variable_reject_lambda`
- [ ] Golden: `extract_variable_response.json`

**Checkpoint:**
- [ ] `tug apply python extract-variable --at test.py:5:10-5:25 --name total`
- [ ] Output matches golden schema

**Rollback:** Revert commit

---

##### Step 1.4: Extract Constant Operation {#step-14-1-4}

**Commit:** `feat(python): add extract-constant operation`

**References:** [Phase 13 Operation 3](phase-13.md#op-extract-constant), [Phase 13 Layer 1](phase-13.md#layer-1), [Phase 13 D07](phase-13.md#d07-edit-primitives), [Phase 13 Step 0.1](phase-13.md#step-0-1), [Step 1.2](#step-14-1-2)

**Artifacts:**
- New `crates/tugtool-python/src/ops/extract_constant.rs`
- CLI command: `tug apply python extract-constant`

**Supported Literal Types:**
- Integer literals (`42`, `0xFF`, `0b1010`)
- Float literals (`3.14`, `1e-5`)
- String literals (`"hello"`, `'world'`, `"""multiline"""`)
- Bytes literals (`b"data"`)
- Boolean literals (`True`, `False`)
- None literal (`None`)
- Complex numbers (`3+4j`) - deferred, low priority
- Ellipsis (`...`) - deferred, rarely extracted

**Placement Rules:**
1. After all imports (including TYPE_CHECKING blocks)
2. Before the first class or function definition
3. If constants already exist, add after them (preserve grouping)

**Tasks:**
- [ ] Implement extract-constant operation
- [ ] Detect literal expressions (all supported types)
- [ ] Insert constant at module level (after imports, before first definition)
- [ ] Validate constant naming (UPPER_SNAKE_CASE warning if not)
- [ ] Check for name conflicts with existing module-level names

**Tests:**
- [ ] Integration: `test_extract_constant_number`
- [ ] Integration: `test_extract_constant_string`
- [ ] Integration: `test_extract_constant_placement`
- [ ] Golden: `extract_constant_response.json`

**Checkpoint:**
- [ ] `tug apply python extract-constant --at test.py:10:15 --name TAX_RATE`

**Rollback:** Revert commit

---

#### Stage 1 Summary {#stage-14-1-summary}

After completing Phase 14 Stage 1 (Steps 1.0-1.4), you will have:
- String annotation infrastructure for rename operations (Step 1.0) ✓
- Rename Parameter operation (building on Phase 13's rename hardening) ✓
- Layer 1 infrastructure for expression analysis
- Extract Variable and Extract Constant operations
- **New operations added in Stage 1:** 3 (Rename Parameter, Extract Variable, Extract Constant)
- **Total operations after Stage 1:** 4 (Rename Symbol from Phase 13 + 3 new)
- **Infrastructure enhanced:** General rename now supports string annotations and .pyi stubs (D08)

**Stage 1 Checkpoint:**
- [x] `cargo nextest run --workspace` - 2635 tests pass (Step 1.0 + Step 1.1)
- [ ] `tug analyze python --help` shows all 4 operations
- [ ] Temporale fixture tests pass for all operations
- [x] String annotations renamed correctly in rename operations (Step 1.0)
- [x] `tug apply python rename-param` works correctly (Step 1.1)

---

#### Stage 2: Layer 2 (Side Effects + Use-Def) {#stage-14-2}

##### Step 2.1: Layer 2 Infrastructure {#step-14-2-1}

**Commit:** `feat(python): add Layer 2 statement analysis infrastructure`

**References:** [Phase 13 Layer 2](phase-13.md#layer-2), [Phase 13 D02](phase-13.md#d02-conservative-side-effects), [Phase 13 Table T10](phase-13.md#t10-purity-rules), [Phase 13 Table T06](phase-13.md#t06-layer2-components)

**Artifacts:**
- New `crates/tugtool-python/src/layers/statement.rs`

**Tasks:**
- [ ] Implement `SideEffectAnalyzer` with conservative defaults
- [ ] Implement `UseDefAnalyzer` using existing binding/reference data
- [ ] Implement `UnusedSymbolDetector`
- [ ] Add comprehensive unit tests

**Tests:**
- [ ] Unit: `test_side_effect_pure_expression`
- [ ] Unit: `test_side_effect_function_call`
- [ ] Unit: `test_use_def_simple`
- [ ] Unit: `test_unused_function`
- [ ] Unit: `test_unused_import`

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python statement`

**Rollback:** Revert commit

---

##### Step 2.2: Inline Variable Operation {#step-14-2-2}

**Commit:** `feat(python): add inline-variable operation`

**References:** [Phase 13 Operation 4](phase-13.md#op-inline-variable), [Phase 13 Layer 2](phase-13.md#layer-2), [Phase 13 D02](phase-13.md#d02-conservative-side-effects), [Phase 13 Table T10](phase-13.md#t10-purity-rules), [Phase 13 D07](phase-13.md#d07-edit-primitives), [Phase 13 Step 0.1](phase-13.md#step-0-1), [Step 2.1](#step-14-2-1)

**Artifacts:**
- New `crates/tugtool-python/src/ops/inline_variable.rs`
- CLI command: `tug apply python inline-variable`

**Tasks:**
- [ ] Implement inline-variable operation
- [ ] Check single-assignment constraint
- [ ] Check side-effect purity (or single use)
- [ ] Replace all references with expression
- [ ] Remove assignment statement

**Tests:**
- [ ] Integration: `test_inline_variable_basic`
- [ ] Integration: `test_inline_variable_multi_use_pure`
- [ ] Integration: `test_inline_variable_reject_impure_multi`
- [ ] Integration: `test_inline_variable_reject_reassigned`
- [ ] Golden: `inline_variable_response.json`

**Checkpoint:**
- [ ] `tug apply python inline-variable --at test.py:5:1`

**Rollback:** Revert commit

---

##### Step 2.3: Safe Delete Operation (Basic) {#step-14-2-3}

**Commit:** `feat(python): add safe-delete operation (basic)`

**References:** [Phase 13 Operation 5](phase-13.md#op-safe-delete), [Phase 13 Layer 2](phase-13.md#layer-2), [Phase 13 Table T12](phase-13.md#t12-public-api), [Step 2.1](#step-14-2-1)

**Artifacts:**
- New `crates/tugtool-python/src/ops/safe_delete.rs`
- CLI command: `tug apply python safe-delete`

**Tasks:**
- [ ] Implement safe-delete operation
- [ ] Check for any references to symbol
- [ ] Report error if symbol is used
- [ ] Delete symbol definition

**Tests:**
- [ ] Integration: `test_safe_delete_unused_function`
- [ ] Integration: `test_safe_delete_unused_class`
- [ ] Integration: `test_safe_delete_reject_used`
- [ ] Golden: `safe_delete_response.json`

**Checkpoint:**
- [ ] `tug apply python safe-delete --at test.py:5:5`

**Rollback:** Revert commit

---

#### Stage 2 Summary {#stage-14-2-summary}

After completing Phase 14 Stage 2 (Steps 2.1-2.3), you will have:
- Layer 2 infrastructure for side-effect and use-def analysis
- Inline Variable and Safe Delete (basic) operations
- **New operations added in Stage 2:** 2 (Inline Variable, Safe Delete)
- **Total operations after Stage 2:** 6

**Stage 2 Checkpoint:**
- [ ] `cargo nextest run --workspace`
- [ ] All Layer 2 components tested
- [ ] Inline Variable rejects impure multi-use (conservative)

---

#### Stage 3: Layer 3 (Import Manipulation) {#stage-14-3}

##### Step 3.1: Layer 3 Infrastructure {#step-14-3-1}

**Commit:** `feat(python): add Layer 3 import manipulation infrastructure`

**References:** [Phase 13 Layer 3](phase-13.md#layer-3), [Phase 13 Table T08](phase-13.md#t08-import-order), [Phase 13 Table T09](phase-13.md#t09-special-imports), [Phase 13 Table T07](phase-13.md#t07-layer3-components), [Phase 13 Table T02](phase-13.md#t02-rename-gaps), [Phase 13 Step 1.1](phase-13.md#step-1-1)

**Artifacts:**
- New `crates/tugtool-python/src/layers/imports.rs`

**Tasks:**
- [ ] Implement `ImportInserter` (finds correct insertion point)
- [ ] Implement `ImportRemover` (handles cleanup)
- [ ] Implement `ImportUpdater` (changes source/target)
- [ ] Add stdlib module list for grouping
- [ ] Add `__init__.py` re-export detection (deferred from Phase 13 Step 1.1, [Phase 13 Table T02](phase-13.md#t02-rename-gaps))

**Tests:**
- [ ] Unit: `test_import_insert_after_docstring`
- [ ] Unit: `test_import_insert_preserve`
- [ ] Unit: `test_import_remove_single`
- [ ] Unit: `test_import_remove_from_group`
- [ ] Unit: `test_import_update_source`
- [ ] Integration: `test_rename_init_reexport` (deferred from Phase 13 Step 1.1)

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python imports`

**Rollback:** Revert commit

---

##### Step 3.2: Move Function Operation {#step-14-3-2}

**Commit:** `feat(python): add move-function operation`

**References:** [Phase 13 Operation 6](phase-13.md#op-move-function), [Phase 13 Layer 3](phase-13.md#layer-3), [Phase 13 Table T08](phase-13.md#t08-import-order), [Phase 13 Table T09](phase-13.md#t09-special-imports), [Phase 13 D08](phase-13.md#d08-stub-updates), [Phase 13 Step 0.3](phase-13.md#step-0-3), [Step 3.1](#step-14-3-1)

**Artifacts:**
- New `crates/tugtool-python/src/ops/move_symbol.rs`
- CLI command: `tug apply python move`

**Tasks:**
- [ ] Implement move operation for functions
- [ ] Extract function definition
- [ ] Insert into target module
- [ ] Add necessary imports to target
- [ ] Update all import statements in codebase
- [ ] Check for circular imports
- [ ] Update stub files and string annotations for moved functions ([Phase 13 D08](phase-13.md#d08-stub-updates))

**Tests:**
- [ ] Integration: `test_move_function_basic`
- [ ] Integration: `test_move_function_with_deps`
- [ ] Integration: `test_move_function_update_imports`
- [ ] Integration: `test_move_function_reject_circular`
- [ ] Integration: `test_move_function_updates_stub`
- [ ] Integration: `test_move_function_updates_string_annotations`
- [ ] Golden: `move_function_response.json`

**Checkpoint:**
- [ ] `tug apply python move --at utils.py:10:1 --to helpers`

**Rollback:** Revert commit

---

##### Step 3.3: Move Class Operation {#step-14-3-3}

**Commit:** `feat(python): extend move operation for classes`

**References:** [Phase 13 Operation 7](phase-13.md#op-move-class), [Phase 13 Layer 3](phase-13.md#layer-3), [Phase 13 Table T08](phase-13.md#t08-import-order), [Phase 13 Table T09](phase-13.md#t09-special-imports), [Phase 13 D08](phase-13.md#d08-stub-updates), [Phase 13 Step 0.3](phase-13.md#step-0-3), [Step 3.1](#step-14-3-1)

**Tasks:**
- [ ] Extend move operation for classes
- [ ] Handle type annotation references
- [ ] Handle inheritance chains
- [ ] Update stub files and string annotations for moved classes ([Phase 13 D08](phase-13.md#d08-stub-updates))

**Tests:**
- [ ] Integration: `test_move_class_basic`
- [ ] Integration: `test_move_class_with_subclass`
- [ ] Integration: `test_move_class_type_annotations`
- [ ] Integration: `test_move_class_updates_stub`

**Checkpoint:**
- [ ] `tug apply python move --at models.py:15:1 --to entities`

**Rollback:** Revert commit

---

##### Step 3.4: Safe Delete (with Import Cleanup) {#step-14-3-4}

**Commit:** `feat(python): enhance safe-delete with import cleanup`

**References:** [Phase 13 Operation 5](phase-13.md#op-safe-delete), [Phase 13 Layer 3](phase-13.md#layer-3), [Phase 13 Table T08](phase-13.md#t08-import-order), [Phase 13 Table T09](phase-13.md#t09-special-imports), [Step 3.1](#step-14-3-1)

**Tasks:**
- [ ] Enhance safe-delete to remove imports
- [ ] Clean up `from X import Y` when Y is deleted
- [ ] Clean up `__all__` entries

**Tests:**
- [ ] Integration: `test_safe_delete_removes_imports`
- [ ] Integration: `test_safe_delete_cleans_all`

**Checkpoint:**
- [ ] Safe delete removes all traces including imports

**Rollback:** Revert commit

---

#### Stage 3 Summary {#stage-14-3-summary}

After completing Phase 14 Stage 3 (Steps 3.1-3.4), you will have:
- Layer 3 infrastructure for import manipulation
- Move Function and Move Class operations
- Enhanced Safe Delete with import cleanup
- **New operations added in Stage 3:** 2 (Move Function, Move Class)
- **Total operations after Stage 3:** 8

**Stage 3 Checkpoint:**
- [ ] `cargo nextest run --workspace`
- [ ] Move operations update all imports correctly
- [ ] Safe delete cleans up imports

---

#### Stage 4: Layer 4 (Method Transformation) {#stage-14-4}

##### Step 4.1: Layer 4 Infrastructure {#step-14-4-1}

**Commit:** `feat(python): add Layer 4 method transformation infrastructure`

**References:** [Phase 13 Layer 4](phase-13.md#layer-4), [Phase 13 D03](phase-13.md#d03-simple-control-flow), [Phase 13 Table T11](phase-13.md#t11-control-flow-reject), [Phase 13 D07](phase-13.md#d07-edit-primitives), [Phase 13 Step 0.1](phase-13.md#step-0-1)

**Artifacts:**
- New `crates/tugtool-python/src/layers/transform.rs`

**Tasks:**
- [ ] Implement `ParameterAnalyzer` (simple cases)
- [ ] Implement `ReturnValueAnalyzer`
- [ ] Implement `BodyExtractor`
- [ ] Implement `ParameterSubstituter`
- [ ] Implement `ReturnHandler`

**Tests:**
- [ ] Unit: `test_parameter_analyzer_simple`
- [ ] Unit: `test_return_analyzer_single`
- [ ] Unit: `test_body_extractor`
- [ ] Unit: `test_param_substituter`

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python transform`

**Rollback:** Revert commit

---

##### Step 4.2: Extract Method Operation {#step-14-4-2}

**Commit:** `feat(python): add extract-method operation`

**References:** [Phase 13 Operation 8](phase-13.md#op-extract-method), [Phase 13 Layer 4](phase-13.md#layer-4), [Phase 13 D03](phase-13.md#d03-simple-control-flow), [Phase 13 Table T11](phase-13.md#t11-control-flow-reject), [Phase 13 D07](phase-13.md#d07-edit-primitives), [Phase 13 Step 0.1](phase-13.md#step-0-1), [Step 4.1](#step-14-4-1)

**Artifacts:**
- New `crates/tugtool-python/src/ops/extract_method.rs`
- CLI command: `tug apply python extract-method`

**Tasks:**
- [ ] Implement extract-method operation
- [ ] Validate selection boundaries
- [ ] Analyze parameters and return values
- [ ] Generate method signature
- [ ] Replace selection with method call

**Tests:**
- [ ] Integration: `test_extract_method_simple`
- [ ] Integration: `test_extract_method_with_params`
- [ ] Integration: `test_extract_method_with_return`
- [ ] Integration: `test_extract_method_reject_multi_return`
- [ ] Integration: `test_extract_method_reject_async` (CF_ASYNC)
- [ ] Integration: `test_extract_method_reject_generator` (CF_GENERATOR)
- [ ] Integration: `test_extract_method_reject_exception_boundary` (CF_EXCEPTION)
- [ ] Golden: `extract_method_response.json`

**Checkpoint:**
- [ ] `tug apply python extract-method --at test.py:10:5-15:20 --name helper`

**Rollback:** Revert commit

---

##### Step 4.3: Inline Method Operation {#step-14-4-3}

**Commit:** `feat(python): add inline-method operation`

**References:** [Phase 13 Operation 9](phase-13.md#op-inline-method), [Phase 13 Layer 4](phase-13.md#layer-4), [Phase 13 Layer 3](phase-13.md#layer-3), [Phase 13 D03](phase-13.md#d03-simple-control-flow), [Phase 13 Table T11](phase-13.md#t11-control-flow-reject), [Phase 13 D07](phase-13.md#d07-edit-primitives), [Phase 13 Step 0.1](phase-13.md#step-0-1), [Step 4.1](#step-14-4-1)

**Tasks:**
- [ ] Implement inline-method operation
- [ ] Extract method body
- [ ] Substitute parameters with arguments
- [ ] Handle return statements
- [ ] Handle self references

**Tests:**
- [ ] Integration: `test_inline_method_simple`
- [ ] Integration: `test_inline_method_with_self`
- [ ] Integration: `test_inline_method_with_return`
- [ ] Golden: `inline_method_response.json`

**Checkpoint:**
- [ ] `tug apply python inline-method --at test.py:20:10`

**Rollback:** Revert commit

---

##### Step 4.4: Change Signature Operation {#step-14-4-4}

**Commit:** `feat(python): add change-signature operation`

**References:** [Phase 13 Operation 10](phase-13.md#op-change-signature), [Phase 13 Layer 4](phase-13.md#layer-4), [Phase 13 Table T13](phase-13.md#t13-signature-support), [Phase 13 Table T14](phase-13.md#t14-callsite-constraints), [Phase 13 D08](phase-13.md#d08-stub-updates), [Phase 13 Step 0.3](phase-13.md#step-0-3), [Step 4.1](#step-14-4-1)

**Tasks:**
- [ ] Implement change-signature operation
- [ ] Support --add, --remove, --reorder
- [ ] Update all call sites
- [ ] Handle default values
- [ ] Update stub signatures and string annotations per [Phase 13 D08](phase-13.md#d08-stub-updates)

**Tests:**
- [ ] Integration: `test_change_sig_add_param`
- [ ] Integration: `test_change_sig_remove_param`
- [ ] Integration: `test_change_sig_reorder`
- [ ] Integration: `test_change_sig_updates_stub`
- [ ] Integration: `test_change_sig_updates_string_annotation`
- [ ] Golden: `change_signature_response.json`

**Checkpoint:**
- [ ] `tug apply python change-signature --at test.py:5:5 --add "timeout=30"`

**Rollback:** Revert commit

---

#### Stage 4 Summary {#stage-14-4-summary}

After completing Phase 14 Stage 4 (Steps 4.1-4.4), you will have:
- Layer 4 infrastructure for method transformation
- Extract Method, Inline Method, and Change Signature operations
- **New operations added in Stage 4:** 3 (Extract Method, Inline Method, Change Signature)
- **Total operations after Stage 4:** 11

**Stage 4 Checkpoint:**
- [ ] `cargo nextest run --workspace`
- [ ] Extract Method works for simple single-exit cases
- [ ] Inline Method handles self references correctly

---

### Deliverables and Checkpoints {#deliverables-14}

**Deliverable:** A comprehensive Python refactoring engine with 10+ operations built on the infrastructure from Phase 13.

#### Phase Exit Criteria ("Done means...") {#exit-criteria-14}

- [ ] **Phase 13 prerequisite complete:** All Stage 0 infrastructure from Phase 13 operational
- [ ] **10 new operations implemented:** Rename Parameter, Extract Variable, Extract Constant, Inline Variable, Safe Delete, Move Function, Move Class, Extract Method, Inline Method, Change Signature
- [ ] **Layers 1-4 complete:** All infrastructure components implemented and tested
- [ ] **Golden tests:** Each operation has golden output tests
- [ ] **Temporale coverage:** All operations tested against Temporale fixture
- [ ] **Documentation:** AGENT_API.md updated with all operations

**Acceptance tests:**
- [ ] `cargo nextest run --workspace` passes
- [ ] `cargo clippy --workspace -- -D warnings` clean
- [ ] All golden tests pass
- [ ] Temporale integration tests pass

#### Milestones {#milestones-14}

**Milestone M14-01: Stage 1 Complete** {#m14-01}
- [ ] 4 operations: Rename Symbol (from Phase 13), Rename Parameter, Extract Variable, Extract Constant
- [ ] Layer 1 infrastructure complete

**Milestone M14-02: Stage 2 Complete** {#m14-02}
- [ ] 6 operations (adding Inline Variable, Safe Delete)
- [ ] Layer 2 infrastructure complete

**Milestone M14-03: Stage 3 Complete** {#m14-03}
- [ ] 8 operations (adding Move Function, Move Class)
- [ ] Layer 3 infrastructure complete

**Milestone M14-04: Stage 4 Complete** {#m14-04}
- [ ] 11 operations (adding Extract Method, Inline Method, Change Signature)
- [ ] Layer 4 infrastructure complete

#### Roadmap / Follow-ons {#roadmap-14}

- [ ] Stage 5: Layers 5-6 (Encapsulate Field, Pull Up/Push Down, Move Module)
- [ ] Organize Imports operation (if demand exists)
- [ ] Pattern-based transforms (future phase)
- [ ] Advanced control flow (multiple returns, exception handling)
