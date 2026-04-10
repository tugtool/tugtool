<!-- tugplan-skeleton v2 -->

## Unified Text Selection Adapter {#text-selection-adapter}

**Purpose:** Ship a `TextSelectionAdapter` interface and two concrete adapters (NativeInput, Engine) plus a stubbed HighlightSelectionAdapter, providing a uniform selection-query API that items 1-4 of text-component-fit-and-finish will build on.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | text-selection-adapter |
| Last updated | 2026-04-10 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The five text components in tugdeck (tug-input, tug-value-input, tug-textarea, tug-prompt-input, tug-markdown-view) use three different selection models: native input offsets, TugTextEngine flat offsets, and SelectionGuard path-based ranges. Roadmap items 1-4 (context menu for markdown-view, right-click repositioning, tab persistence, undo persistence) all need to query and manipulate selection, but each item would re-derive "how do I query selection in this component type?" with ad-hoc branching. A shared adapter interface eliminates that branching so items 1-4 can write selection logic once against the interface.

This plan implements item 6 from `roadmap/text-component-fit-and-finish.md` as a foundational layer. Per user direction, the HighlightSelectionAdapter is defined as a stub (interface only, methods not wired to real selection-guard logic) — the actual wiring lands with item 1. The NativeInputSelectionAdapter and EngineSelectionAdapter are fully implemented.

#### Strategy {#strategy}

- Define the `TextSelectionAdapter` interface in a single new file with the revised hybrid design (classifyRightClick + selectWordAtPoint replacing the earlier geometric-only API).
- Implement `NativeInputSelectionAdapter` inline in `use-text-input-responder.tsx` — it is ~20 lines using the offset-comparison approach for right-click classification.
- Implement `EngineSelectionAdapter` inline in `tug-prompt-input.tsx` — it wraps TugTextEngine methods and uses DOM Selection geometry for classifyRightClick.
- Stub `HighlightSelectionAdapter` in the adapter file itself — methods throw or return defaults, documented as "wired by item 1".
- Do not refactor existing pointerdown/contextmenu handlers in this plan. The adapters are new objects created alongside existing code; item 2 will swap in the adapters for actual right-click repositioning.
- Verify via TypeScript compilation and lint — no runtime tests needed for an interface plus two thin wrappers.

#### Success Criteria (Measurable) {#success-criteria}

- `TextSelectionAdapter` interface exported from `text-selection-adapter.ts` with all 6 methods typed (`tsc --noEmit` passes) (verify: `bun run check`)
- `NativeInputSelectionAdapter` constructible from any `HTMLInputElement | HTMLTextAreaElement` and satisfies the interface (verify: `tsc --noEmit`)
- `EngineSelectionAdapter` constructible from a `TugTextEngine` instance and satisfies the interface (verify: `tsc --noEmit`)
- `HighlightSelectionAdapter` exported as a stub class satisfying the interface (verify: `tsc --noEmit`)
- Existing tests continue to pass (verify: `bun run test`)

#### Scope {#scope}

1. New file: `tugdeck/src/components/tugways/text-selection-adapter.ts` — interface, type exports, HighlightSelectionAdapter stub
2. NativeInputSelectionAdapter factory function in `use-text-input-responder.tsx`
3. EngineSelectionAdapter factory function in `tug-prompt-input.tsx`
4. Exports wired so items 1-4 can import the interface and adapters

#### Non-goals (Explicitly out of scope) {#non-goals}

- Wiring adapters into existing contextmenu handlers (that is item 2)
- Implementing the `repositionSelectionOnRightClick` shared utility (that is item 2)
- Wiring HighlightSelectionAdapter to real SelectionGuard logic (that is item 1)
- Virtualized select-all for tug-markdown-view (that is item 1)
- Content/selection persistence for native inputs (that is item 3)
- Undo stack persistence (that is item 4)
- Refactoring existing pointerdown capture in tug-prompt-input

#### Dependencies / Prerequisites {#dependencies}

- TugTextEngine must expose `getSelectedRange`, `setSelectedRange`, `selectWordAtPoint`, `selectAll` (confirmed: all exist)
- SelectionGuard must export `caretPositionFromPointCompat` (confirmed: already exported)
- `use-text-input-responder.tsx` must export `TextInputLikeElement` type (confirmed: already exported)

#### Constraints {#constraints}

- TypeScript strict mode — no `any` leakage in the interface or adapters
- Must not break existing context menu or selection behavior in any component
- Adapters are plain objects (not class hierarchies, not React hooks) per the roadmap specification

#### Assumptions {#assumptions}

- The revised hybrid interface (classifyRightClick + selectWordAtPoint) from the roadmap Q1 resolution is the authoritative design
- NativeInputSelectionAdapter's classifyRightClick uses offset comparison (reading browser-placed selectionStart at contextmenu time against pre-pointerdown captured offsets), with no geometric APIs
- EngineSelectionAdapter's classifyRightClick uses DOM Range geometry (`getBoundingClientRect`, `getClientRects`) and distance checks
- HighlightSelectionAdapter stub methods will throw `Error("Not implemented — wired by item 1")` for methods that require SelectionGuard integration, and return safe defaults for query methods

---

### Design Decisions {#design-decisions}

#### [D01] Adapter is a plain object interface, not a class hierarchy (DECIDED) {#d01-plain-object}

**Decision:** TextSelectionAdapter is a TypeScript interface implemented by plain object factories, not an abstract class or React hook.

**Rationale:**
- Each adapter is 5-20 lines — class overhead is unjustified
- Factory functions close over the element/engine ref, avoiding `this` binding issues
- Matches the roadmap specification: "The adapter is a plain object (not a class hierarchy, not a React hook)"

**Implications:**
- Each adapter is created via `createNativeInputAdapter(el)`, `createEngineAdapter(engine)`, etc.
- No inheritance chain, no `super` calls, no constructor ceremony

#### [D02] Hybrid classifyRightClick replaces geometric-only API (DECIDED) {#d02-hybrid-classify}

**Decision:** The adapter interface uses `classifyRightClick` and `selectWordAtPoint` instead of separate `getCaretRect`/`getSelectionRects`/`setCaretToPoint` methods.

**Rationale:**
- Native inputs cannot resolve `caretPositionFromPoint` into their internal text rendering — the browser's hit-testing API does not reach inside `<input>` elements
- The offset-comparison approach (capture selection at pointerdown, compare at contextmenu) is both simpler and more correct for native inputs
- ContentEditable and highlight adapters use DOM Range geometry naturally
- Putting the classification logic inside the adapter lets each model use its natural comparison strategy

**Implications:**
- The shared `repositionSelectionOnRightClick` utility (item 2) calls `adapter.classifyRightClick()` and `adapter.selectWordAtPoint()` — two method calls, zero model-specific branching at the call site
- NativeInputSelectionAdapter requires a `capturePreRightClick()` call at pointerdown time to record the pre-click selection state that `classifyRightClick` compares against

#### [D03] HighlightSelectionAdapter is a stub in this plan (DECIDED) {#d03-highlight-stub}

**Decision:** HighlightSelectionAdapter is defined with the correct type signature but methods are stubs — query methods return safe defaults, mutation methods throw.

**Rationale:**
- Per user direction: "Interface only — define the HighlightSelectionAdapter with its methods stubbed, leave actual wiring to item 1"
- The markdown-view selection model (CSS Custom Highlight API, virtualized content) requires significant integration work that belongs with the context menu implementation
- Defining the stub now ensures the interface is complete and items 1-4 can import it without circular dependency issues

**Implications:**
- Item 1 will replace stub method bodies with real SelectionGuard integration
- `hasRangedSelection` returns `false`, `getSelectedText` returns `""`, `selectAll` and `expandToWord` throw, `classifyRightClick` returns `"elsewhere"`, `selectWordAtPoint` throws

#### [D04] NativeInputSelectionAdapter captures pre-click state via explicit call (DECIDED) {#d04-native-capture}

**Decision:** NativeInputSelectionAdapter exposes a `capturePreRightClick()` method that the contextmenu handler calls at pointerdown time. This is not part of the TextSelectionAdapter interface — it is adapter-specific setup.

**Rationale:**
- The offset-comparison approach requires knowing the selection state before the browser's mousedown handler moves it
- This capture is specific to native inputs (contentEditable adapters use geometry instead)
- Making it an explicit call keeps the adapter stateless between right-click sequences

**Implications:**
- The consumer's pointerdown handler (button === 2) calls `adapter.capturePreRightClick()` before the browser's default action
- `classifyRightClick` reads the captured state and compares against the browser-placed caret position

---

### Specification {#specification}

#### TextSelectionAdapter Interface {#adapter-interface}

**Spec S01: TextSelectionAdapter** {#s01-adapter}

```ts
interface TextSelectionAdapter {
  /** True when there is a non-collapsed selection. */
  hasRangedSelection(): boolean;

  /** The currently selected text, or empty string if no ranged selection. */
  getSelectedText(): string;

  /** Select all content. */
  selectAll(): void;

  /** Expand the current caret to word boundaries. */
  expandToWord(): void;

  /**
   * Classify a right-click relative to the current selection.
   * Returns the case that applies so the caller can decide
   * whether to restore the pre-click selection or expand to word.
   *
   * - "near-caret": collapsed selection, click is near the caret
   * - "within-range": ranged selection, click is inside the range
   * - "elsewhere": click is outside current selection
   */
  classifyRightClick(
    clientX: number,
    clientY: number,
    proximityThreshold: number,
  ): "near-caret" | "within-range" | "elsewhere";

  /**
   * Place the caret at the given viewport coordinates and expand
   * to word boundaries. For native inputs where the browser already
   * placed the caret via mousedown, this just does word expansion.
   */
  selectWordAtPoint(clientX: number, clientY: number): void;
}
```

#### NativeInputSelectionAdapter Additional API {#native-adapter-api}

**Spec S02: NativeInputSelectionAdapter extras** {#s02-native-extras}

```ts
interface NativeInputSelectionAdapterExtras {
  /**
   * Call at pointerdown (button === 2) to capture the pre-right-click
   * selection state. classifyRightClick compares against this snapshot.
   */
  capturePreRightClick(): void;
}
```

The factory returns `TextSelectionAdapter & NativeInputSelectionAdapterExtras`.

#### RightClickClassification Type {#classification-type}

**Spec S03: RightClickClassification** {#s03-classification}

```ts
type RightClickClassification = "near-caret" | "within-range" | "elsewhere";
```

Exported from `text-selection-adapter.ts` for use by the item 2 shared utility.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/text-selection-adapter.ts` | Interface, RightClickClassification type, HighlightSelectionAdapter stub, word-boundary utility |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TextSelectionAdapter` | interface | `text-selection-adapter.ts` | Core interface per Spec S01 |
| `RightClickClassification` | type | `text-selection-adapter.ts` | Union type per Spec S03 |
| `NativeInputSelectionAdapterExtras` | interface | `text-selection-adapter.ts` | Extra methods for native input adapter per Spec S02 |
| `HighlightSelectionAdapter` | class (stub) | `text-selection-adapter.ts` | Stub per [D03], takes boundary element |
| `findWordBoundaries` | function | `text-selection-adapter.ts` | Shared utility: given string + offset, returns `{ start, end }` |
| `createNativeInputAdapter` | function | `use-text-input-responder.tsx` | Factory returning `TextSelectionAdapter & NativeInputSelectionAdapterExtras` |
| `createEngineAdapter` | function | `tug-prompt-input.tsx` | Factory returning `TextSelectionAdapter` |

---

### Execution Steps {#execution-steps}

#### Step 1: Create text-selection-adapter.ts with interface and stub {#step-1}

**Commit:** `feat(tugdeck): add TextSelectionAdapter interface and HighlightSelectionAdapter stub`

**References:** [D01] Plain object interface, [D02] Hybrid classifyRightClick, [D03] Highlight stub, Spec S01, Spec S03, (#adapter-interface, #classification-type)

**Artifacts:**
- New file: `tugdeck/src/components/tugways/text-selection-adapter.ts`

**Tasks:**
- [ ] Create `text-selection-adapter.ts` with the `TextSelectionAdapter` interface matching Spec S01
- [ ] Export `RightClickClassification` type per Spec S03
- [ ] Export `findWordBoundaries(text: string, offset: number): { start: number; end: number }` utility — scans for word-boundary characters (whitespace, punctuation) around the offset. This is shared by NativeInputSelectionAdapter's `expandToWord` and `selectWordAtPoint`
- [ ] Implement `HighlightSelectionAdapter` as a stub class per [D03]: constructor takes a boundary `HTMLElement`; `hasRangedSelection` returns `false`; `getSelectedText` returns `""`; `classifyRightClick` returns `"elsewhere"`; `selectAll`, `expandToWord`, and `selectWordAtPoint` throw `Error("Not implemented — wired by item 1")`
- [ ] Ensure all exports have JSDoc comments

**Tests:**
- [ ] N/A — interface and stub only; `bun run check` verifies type correctness

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run check` (tsc --noEmit passes)

---

#### Step 2: Implement NativeInputSelectionAdapter {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add NativeInputSelectionAdapter for native text inputs`

**References:** [D01] Plain object interface, [D02] Hybrid classifyRightClick, [D04] Native capture, Spec S01, Spec S02, (#adapter-interface, #native-adapter-api, #symbols)

**Artifacts:**
- Modified: `tugdeck/src/components/tugways/use-text-input-responder.tsx` — new `createNativeInputAdapter` export

**Tasks:**
- [ ] Add `createNativeInputAdapter(el: TextInputLikeElement): TextSelectionAdapter & NativeInputSelectionAdapterExtras` to `use-text-input-responder.tsx` (import `NativeInputSelectionAdapterExtras` from Spec S02)
- [ ] `hasRangedSelection`: `el.selectionStart !== el.selectionEnd` (guarding nulls)
- [ ] `getSelectedText`: `el.value.slice(el.selectionStart!, el.selectionEnd!)` when ranged, else `""`
- [ ] `selectAll`: `el.select()`
- [ ] `expandToWord`: use `findWordBoundaries(el.value, el.selectionStart!)` then `el.setSelectionRange(start, end)`
- [ ] `capturePreRightClick`: snapshot `{ start: el.selectionStart, end: el.selectionEnd }` into closure-local state
- [ ] `classifyRightClick`: read current `el.selectionStart` (browser-placed caret), compare against captured snapshot per the three-case algorithm from roadmap Q1 resolution. Case 1: captured was collapsed and new offset matches — return `"near-caret"`. Case 2: captured was ranged and new offset falls within — return `"within-range"`. Case 3: otherwise — return `"elsewhere"`. The `proximityThreshold` parameter is unused for native inputs (offset comparison is exact).
- [ ] `selectWordAtPoint`: the browser already placed the caret; call `expandToWord()` to extend to word boundaries
- [ ] Import `TextSelectionAdapter`, `NativeInputSelectionAdapterExtras`, `RightClickClassification`, and `findWordBoundaries` from `text-selection-adapter.ts`

**Tests:**
- [ ] N/A — thin wrapper over native input APIs; `bun run check` verifies type correctness

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run check` (tsc --noEmit passes)

---

#### Step 3: Implement EngineSelectionAdapter {#step-3}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add EngineSelectionAdapter for TugTextEngine`

**References:** [D01] Plain object interface, [D02] Hybrid classifyRightClick, Spec S01, (#adapter-interface, #symbols)

**Artifacts:**
- Modified: `tugdeck/src/components/tugways/tug-prompt-input.tsx` — new `createEngineAdapter` export

**Tasks:**
- [ ] Add `createEngineAdapter(engine: TugTextEngine): TextSelectionAdapter` to `tug-prompt-input.tsx`
- [ ] `hasRangedSelection`: `engine.getSelectedRange()` with `end > start`
- [ ] `getSelectedText`: `window.getSelection()?.toString() ?? ""` scoped to engine root, or extract from engine state using range offsets against `engine.getText()`
- [ ] `selectAll`: `engine.selectAll()`
- [ ] `expandToWord`: use `Selection.modify("move", "backward", "word")` + `Selection.modify("extend", "forward", "word")` matching the pattern already used by `engine.selectWordAtPoint`
- [ ] `classifyRightClick`: use `window.getSelection()?.getRangeAt(0)` for geometry. If selection is collapsed, compute distance from caret rect to (clientX, clientY) and compare against `proximityThreshold`. If ranged, check if (clientX, clientY) falls within any of `getClientRects()`. Otherwise return `"elsewhere"`.
- [ ] `selectWordAtPoint`: collapse any existing selection first via `engine.setSelectedRange(0)` to clear the ranged-selection guard in `engine.selectWordAtPoint`, then delegate to `engine.selectWordAtPoint(clientX, clientY)`. This ensures that the "elsewhere" right-click case always selects a new word at the click point rather than preserving a stale ranged selection.
- [ ] Import `TextSelectionAdapter` and `RightClickClassification` from `text-selection-adapter.ts`

**Tests:**
- [ ] N/A — thin wrapper over engine APIs; `bun run check` verifies type correctness

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run check` (tsc --noEmit passes)

---

#### Step 4: Integration Checkpoint {#step-4}

**Depends on:** #step-1, #step-2, #step-3

**Commit:** `N/A (verification only)`

**References:** [D01] Plain object interface, [D02] Hybrid classifyRightClick, [D03] Highlight stub, (#success-criteria)

**Tasks:**
- [ ] Verify all three adapter types satisfy the `TextSelectionAdapter` interface (tsc catches type errors)
- [ ] Verify existing context menu behavior is unchanged (adapters are additive, no existing code modified beyond new exports)
- [ ] Verify no import cycles between the new file and existing modules

**Tests:**
- [ ] N/A — integration verification; `bun run check` and `bun run test` cover correctness

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run check` (full type check)
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run test` (existing tests pass)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A `TextSelectionAdapter` interface with NativeInput and Engine implementations ready for items 1-4 to consume, plus a stubbed HighlightSelectionAdapter placeholder for item 1.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `TextSelectionAdapter` interface exported and importable (`bun run check` passes)
- [ ] `createNativeInputAdapter` and `createEngineAdapter` factories exported and type-correct
- [ ] `HighlightSelectionAdapter` stub exported with correct type signature
- [ ] `findWordBoundaries` utility exported and used by NativeInputSelectionAdapter
- [ ] Zero type errors, existing tests pass

**Acceptance tests:**
- [ ] `bun run check` — TypeScript compilation succeeds with no errors
- [ ] `bun run test` — existing test suite passes unchanged

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Item 1: Wire HighlightSelectionAdapter to SelectionGuard, implement tug-markdown-view context menu
- [ ] Item 2: Implement `repositionSelectionOnRightClick` shared utility using adapters, wire into all contextmenu handlers
- [ ] Item 3: Content/selection persistence for native inputs via useTugcardPersistence
- [ ] Item 4: Undo stack persistence across tab changes
