# T3.2 Tactical Plan: tug-prompt-input

*Tactical execution plan for building the tug-prompt-input component. Companion to the T3.2 section in [tide.md](tide.md) and the spike findings in [t3-text-model-spike.md](t3-text-model-spike.md).*

---

## Principle: the spike is frozen

`gallery-text-model-spike.tsx` is not touched. It is a read-only reference for the engine patterns, CSS tricks, and event handling. We read from it; we never write to it.

---

## What We're Building

A proper tugways component — `tug-prompt-input.tsx` + `tug-prompt-input.css` — that wraps TugTextEngine in a React-compliant shell. The engine becomes a standalone module. The component is the *input field only* — not the surrounding chrome (route indicator, submit button — that's T3.4).

**Governing documents:**
- [Component Authoring Guide](../tuglaws/component-authoring.md) — file structure, TSX/CSS conventions, `@tug-pairings`, `@tug-renders-on`, checklist
- [Token Naming](../tuglaws/token-naming.md) — seven-slot `--tug7-` convention
- Laws: [L01] single mount, [L03] useLayoutEffect for registrations, [L06] appearance via CSS, [L07] stable refs, [L15] token-driven states, [L16] pairings declared, [L19] component authoring guide, [L22] direct DOM updates, [L23] preserve user-visible state

---

## Three Deliverables

### 1. `lib/tug-text-engine.ts` — the engine, ported

A fresh port of the spike's `TugTextEngine`, written as a new file using the spike as a read-only reference. **Not** a mechanical extraction that modifies the spike.

Changes from the spike:

- **Import `createAtomDOM` from tug-atom** instead of the spike's local `createAtomDOM`. This is the T3.1 integration point. The engine's DOM detection, position mapping (`flatFromDOM`, `domPosition`), and reconciler must all be written to handle tug-atom's DOM structure (inline-flex, icon span + label span, `data-slot="tug-atom"`).
- **Import `AtomSegment` from tug-atom** — it's already the canonical type definition.
- **Use `tug-atom` / `tug-atom-selected` CSS classes** instead of `spike-atom` / `spike-atom-selected`.
- **Export `TextSegment`, `Segment`, and helper functions** (`normalizeSegments`, `cloneSegments`).
- **Remove hardcoded `TYPEAHEAD_FILES`** — the typeahead becomes callback-driven (completion provider).
- **Generalize the typeahead** — the engine calls a provider callback, not a hardcoded filter. But the engine still owns the typeahead *state machine* (active, query, selectedIndex, accept, cancel, navigate) because that state is tightly coupled to cursor position and document model mutations.
- **Drop handler is a callback**, not hardcoded `files[i].name -> atom`. The consumer provides a handler that maps files to atoms.
- The engine's `onSubmit` / `onChange` / `onLog` callbacks stay as-is — they're the right pattern for L06/L22 (direct DOM updates, no React round-trip).

Known spike bugs come along for the ride. That's expected — we fix them iteratively in the new component, not in the spike.

### 2. `tug-prompt-input.tsx` + `tug-prompt-input.css` — the component

The React shell. Follows the component authoring guide exactly.

**TSX:**
- Creates engine in `useLayoutEffect` [L01, L03] — engine is a stable ref [L07]
- `data-slot="tug-prompt-input"` on root, `forwardRef`, `cn()`, `...rest`
- Props: `placeholder`, `maxRows`, `returnAction`, `numpadEnterAction`, `onSubmit`, `onChange`, `completionProvider`, `dropHandler`, `disabled`
- The contentEditable div is *inside* this component — the consumer never touches it
- Auto-resize [L06]: direct DOM height manipulation, 1 row -> maxRows
- Placeholder via `data-empty` attribute + CSS `::before` [L06]
- Imperative handle via `useImperativeHandle` for parent access: `focus()`, `clear()`, `getText()`, `getAtoms()`, `insertAtom()` — T3.4 needs these
- The typeahead popup is rendered by this component as a positioned div — the engine provides the data, the component renders the DOM

**CSS:**
- The input surface — border, padding, focus ring
- The contentEditable area — `white-space: pre-wrap`, `min-height`, `max-height`, overflow
- `::selection` re-enabled, `::highlight(card-selection)` suppressed
- `-webkit-user-modify: read-write-plaintext-only`
- `data-td-select="custom"` to exempt from SelectionGuard
- Placeholder styling via `data-empty` + `::before`
- Typeahead popup positioning and appearance
- Uses existing `field` tokens for the input surface, `atom` tokens already defined in themes

### 3. Gallery card — `gallery-prompt-input.tsx` + `gallery-prompt-input.css`

The testing surface for the new component. Mirrors the spike's testing UI (editor, diagnostics, key config, event log, insert atom, clear) but uses the real component. This is where we test and debug.

---

## Integration Points

### From T3.1 (tug-atom)

Engine's reconciler calls `createAtomDOM(seg)` from tug-atom instead of building spike-specific DOM. Engine's click handler toggles `tug-atom-selected` class. Engine's two-step backspace checks for `tug-atom-selected`. CSS classes are the contract — no runtime coupling beyond that.

**Critical:** tug-atom's DOM structure is richer than the spike's (inline-flex, icon span, label span, `data-slot`, SVG icons, 0.85em font-size, baseline alignment). The engine's DOM position mapping must handle this correctly. This is tested in pass 1 before moving on.

### For T3.3 (stores)

The completion provider interface (`(query: string) => CompletionItem[]`) is the hook. For now, the gallery card provides a fake completion provider. When SessionMetadataStore ships, it plugs in without changing the component.

History navigation: props for `onHistoryUp` / `onHistoryDown` callbacks fire when cursor is at document boundary and user presses arrow keys. PromptHistoryStore plugs into these callbacks in T3.4.

### For T3.4 (tug-prompt-entry)

The imperative handle (`focus`, `clear`, `getText`, `getAtoms`, `insertAtom`) is how tug-prompt-entry controls the input. The `onSubmit` callback is how it receives submission. Prefix detection fires a callback with the detected route. tug-prompt-entry composes this component with route indicator and submit button.

---

## What We Are NOT Building Yet

- **Route indicator chrome** — T3.4
- **Submit button** — T3.4
- **Live completion data** — T3.3 (SessionMetadataStore for `/` commands, file service for `@` files)
- **History persistence** — T3.3 (PromptHistoryStore)
- **Live Claude Code integration** — T3.5

The *hook points* for all of these exist (props, callbacks, imperative handle), but the implementations plug in later.

---

## Execution Order

### Pass 1: Port engine + build gallery card together

Write `lib/tug-text-engine.ts` by porting from the spike. Simultaneously write a minimal `gallery-prompt-input.tsx` that wires it up — similar to the spike's `SpikeEditor` function. This gives us an immediate testing surface.

The gallery card starts simple (editor + diagnostics), not the full component yet. **Test that it works** — typing, atoms, arrow navigation, selection, IME, undo, newlines. Fix DOM mapping issues that arise from tug-atom's structure. Don't move on until this works.

**Validation:** Gallery card demonstrates basic editing with tug-atom atoms. All spike behaviors work correctly with the new atom DOM structure.

### Pass 2: Build the component

Wrap the working engine in `tug-prompt-input.tsx` + `tug-prompt-input.css` per the component authoring guide. The gallery card switches from wiring the engine directly to using the component. Add the component-level features: auto-resize, placeholder, focus management, imperative handle.

**Validation:** Gallery card demonstrates all features: typing, atoms, IME, undo, typeahead, auto-resize, Return/Enter, paste, drop.

### Pass 3: Quality and correctness regime

Before adding more features, establish the formal testing and state management framework that ensures the text editing system is correct and stays correct.

#### 3a. Extract TugTextInputDelegate to shared location

Move `TugTextInputDelegate` and associated types from `tug-prompt-input.tsx` into `lib/tug-text-engine.ts` where they can be shared by the engine, component, test harness, and future consumers.

#### 3b. Define TugTextEditingState

A plain serializable object that captures the complete state of an editing component:

```typescript
interface TugTextEditingState {
  segments: Segment[];
  selection: { start: number; end: number } | null;
  markedText: { start: number; end: number } | null;
}
```

No DOM, no methods. JSON round-trips cleanly. Lives alongside `TugTextInputDelegate` in the engine module.

#### 3c. Persist editing state via tugbank [L23]

Save `TugTextEditingState` to tugbank on every meaningful change. Restore on mount. Editing state must survive: Developer → Reload, app quit/relaunch, `just app`. This is an L23 requirement — internal operations must never lose user-visible state.

#### 3d. Text Editing Operation Inventory (TEOI) ✓

A formal catalog of every editing operation as a state machine transition:

```
TugTextEditingState::incoming × Operation → TugTextEditingState::outgoing
```

Lives in `lib/tug-text-editing-operations.ts`. Contains:

- **Operation taxonomy** (24 operations): text entry (typing, insertText, paste), atom manipulation (insertAtom, typeaheadAccept), deletion by granularity (character, word, soft line, paragraph), selection, undo/redo, IME composition, transpose, kill/yank, openLine
- **19 canonical incoming states**: empty, text at every cursor position, selections, atom boundaries, multi-atom, multi-word, multiline, atom-highlighted, IME composing
- **TEOE interface**: concrete test triples with single-op and multi-step sequence support, tags for filtering
- **Operation × State matrix**: ~160 interesting combinations across 7 grouped sub-tables
- **Builder helpers**: `text()`, `atom1()`, `atom2()`, `state()`, `cursor()`, `sel()`

Architecture decisions made during 3d:
- **Visible units hierarchy** adopted from WebKit's `visible_units.h` — word, line, paragraph, document as distinct granularities
- **`execCommand`** replaces manual DOM mutation as the simulation hook for typing (exercises the real browser editing pipeline)
- **`highlightedAtomIndices`** added to `TugTextEditingState` — atom highlight is model state, not hidden CSS state
- **`deleteRange(start, end)`** added as the foundational deletion primitive
- **All mutation operations made range-aware** — `insertText`, `insertAtom`, `deleteBackward`, `deleteForward` handle ranged selections correctly
- **IME composition** included from the start, not deferred

#### 3e. Text Editing Operation Examples (TEOE) ✓

Concrete instances of TEOI triples with real data. Two tiers:

- **Hand-written** (35): boundary cases, atom interactions, two-step deletion sequences, undo/redo chains, multiline, selection spanning atoms
- **Generated** (23): mechanical patterns — no-ops, selection-overrides-granularity, clear, selectAll

Any generated TEOE can be "promoted" to hand-written when it needs custom attention. `allTEOEs()` returns the combined collection for the test runner.

Remaining TEOEs (word deletion, line deletion, paragraph deletion, transpose, kill/yank, openLine, IME) depend on the visible units layer and new engine operations — written as part of 3d-iv/3d-v below.

#### 3d-i. Visible units module

Build `lib/tug-text-visible-units.ts` — pure functions over `Segment[]`:

- `startOfWord(segments, offset) → offset`
- `endOfWord(segments, offset) → offset`
- `startOfParagraph(segments, offset) → offset`
- `endOfParagraph(segments, offset) → offset`
- `startOfDocument() → 0`
- `endOfDocument(segments) → flatLength`

No DOM. An atom is an atomic unit — it behaves as its own word. Word boundaries at spaces, punctuation, and atom edges. Paragraph boundaries at `\n` and document edges.

#### 3d-ii. Wire visible units into the engine

Implement the missing operations in TugTextEngine as one-liners on top of visible units + `deleteRange`:

- `deleteWordBackward` = `deleteRange(startOfWord(cursor), cursor)`
- `deleteWordForward` = `deleteRange(cursor, endOfWord(cursor))`
- `deleteParagraphBackward` = `deleteRange(startOfParagraph(cursor), cursor)`
- `deleteParagraphForward` = `deleteRange(cursor, endOfParagraph(cursor))`
- `killLine` = `deleteParagraphForward` + save to kill ring buffer
- `yank` = `insertText(killRingContent)`
- `transpose` = swap characters around cursor via visible units
- `openLine` = `insertText("\n")` then move cursor back one

#### 3d-iii. Handle `beforeinput` types

Route the `beforeinput` inputTypes the engine currently `preventDefault()`s and drops:

- `deleteWordBackward` → `deleteWordBackward()`
- `deleteWordForward` → `deleteWordForward()`
- `deleteSoftLineBackward` → `deleteParagraphBackward()` (soft ≡ paragraph for now)
- `deleteSoftLineForward` → `deleteParagraphForward()` (soft ≡ paragraph for now)
- `deleteHardLineForward` → `killLine()`
- `insertTranspose` → `transpose()`
- `insertFromYank` → `yank()`

#### 3d-iv. Write remaining TEOEs

Add TEOEs for the new operations: word deletion at word boundaries, at atom boundaries, at spaces; paragraph deletion at newlines; kill/yank sequences; transpose at various positions; openLine. Both hand-written interesting cases and generated mechanical patterns.

#### 3d-v. Soft line treatment

Soft line (visual wrap boundary) is distinct from paragraph (`\n` boundary). For the current non-wrapping prompt input, soft line ≡ paragraph. The `deleteSoftLineBackward` / `deleteSoftLineForward` operations route to paragraph operations. When wrapping is added later, soft line operations will need layout information (where did text wrap?) and will diverge from paragraph.

#### 3f. Simulation ≡ Interactive

The test harness uses `document.execCommand("insertText", false, text)` for typing simulation — this goes through the browser's actual editing pipeline (beforeinput → DOM mutation → MutationObserver → engine). The delegate API path (`insertText()`) goes through the engine directly. Both paths must produce the same `TugTextEditingState::outgoing` for the same `incoming × operation`. If they diverge, the simulation or the engine has a bug.

#### 3g. Exhaustive test generation

Once the TEOI framework is validated with all operations implemented, expand to 100+ TEOEs systematically. The generation framework (`generatedTEOEs()`) makes this mechanical — add new generator functions for each operation category, with promotion to hand-written for cases that need attention.

**Validation:** All TEOEs pass. Manual interaction matches simulation for every tested scenario.

### Pass 4: Add prefix detection

First-character routing (`>`, `$`, `:`, `/`). This is engine-level (the engine knows the document content) with a callback to the component. The prefix character gets styled distinctly via CSS.

**Validation:** Gallery card shows route detection, prefix styling, callback logging.

---

## Key Lesson (from failed first attempt)

The first extraction attempt failed because it simultaneously: (1) extracted the engine, (2) swapped the atom DOM from spike-atom to tug-atom, and (3) changed all DOM detection selectors — without testing after step 1. The spike was left broken and the bugs were compounded by adding new features (managed arrow navigation) instead of reverting.

**The fix:** engine and gallery card are built together in pass 1, so we have an immediate feedback loop. tug-atom integration is tested from the start — we write the engine for tug-atom from day one and fix DOM interaction issues as they surface, with a gallery card to verify every change.

---

## Reference: Spike Architecture Summary

From `t3-text-model-spike.md` — the validated patterns we're porting:

1. **"Let the browser mutate, diff afterward"** — MutationObserver fast path for typing
2. **Text-atom-text invariant** — segments always alternate, cursor always in Text node
3. **Native browser caret** — no custom cursor rendering
4. **Reconciliation skips composing node** — IME composition protected
5. **`compositionEndedAt` timing window** — WebKit compositionend ordering bug
6. **Own undo stack with immutable snapshots** — merge within 300ms
7. **Flat offset as universal position type** — text chars = 1, atoms = 1
8. **`-webkit-user-modify: read-write-plaintext-only`** — prevents spurious composition
9. **`::selection` re-enabled, `::highlight(card-selection)` suppressed** — contentEditable selection fix
