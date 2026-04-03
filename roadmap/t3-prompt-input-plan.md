# T3.2 Tactical Plan: tug-prompt-input

*Tactical execution plan for building the tug-prompt-input component. Companion to the T3.2 section in [tide.md](tide.md) and the spike findings in [t3-text-model-spike.md](t3-text-model-spike.md).*

---

## What We're Building

A proper tugways component — `tug-prompt-input.tsx` + `tug-prompt-input.css` — that wraps TugTextEngine in a React-compliant shell. The engine becomes a standalone module. The component is the *input field only* — not the surrounding chrome (route indicator, submit button — that's T3.4).

**Governing documents:**
- [Component Authoring Guide](../tuglaws/component-authoring.md) — file structure, TSX/CSS conventions, `@tug-pairings`, `@tug-renders-on`, checklist
- [Token Naming](../tuglaws/token-naming.md) — seven-slot `--tug7-` convention
- Laws: [L01] single mount, [L03] useLayoutEffect for registrations, [L06] appearance via CSS, [L07] stable refs, [L15] token-driven states, [L16] pairings declared, [L19] component authoring guide, [L22] direct DOM updates, [L23] preserve user-visible state

---

## Three Deliverables

### 1. `lib/tug-text-engine.ts` — the engine, extracted

The ~600-line `TugTextEngine` class moves out of the spike gallery card into a standalone module. Changes from the spike:

- **Import `createAtomDOM` from tug-atom** instead of the spike's local `createAtomDOM`. This is the T3.1 integration point.
- **Use `tug-atom` / `tug-atom-selected` CSS classes** instead of `spike-atom` / `spike-atom-selected`.
- **Import `AtomSegment` from tug-atom** — it's already the canonical type definition.
- **Export `TextSegment`, `Segment`, and helper functions** (`normalizeSegments`, `cloneSegments`).
- **Remove hardcoded `TYPEAHEAD_FILES`** — the typeahead becomes callback-driven (completion provider).
- **Generalize the typeahead** — the engine calls a provider callback, not a hardcoded filter. But the engine still owns the typeahead *state machine* (active, query, selectedIndex, accept, cancel, navigate) because that state is tightly coupled to cursor position and document model mutations.
- **Drop handler is a callback**, not hardcoded `files[i].name -> atom`. The consumer provides a handler that maps files to atoms.
- The engine's `onSubmit` / `onChange` / `onLog` callbacks stay as-is — they're the right pattern for L06/L22 (direct DOM updates, no React round-trip).

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

### 3. Gallery card — `gallery-prompt-input.tsx`

For isolated testing:
- Basic text input with atoms (insert button, drop files)
- Typeahead with a fake completion provider
- Return/Enter configuration
- Submit callback logging
- Diagnostics panel (ported from spike)
- Prefix detection demo

---

## Integration Points

### From T3.1 (tug-atom)

Engine's reconciler calls `createAtomDOM(seg)` from tug-atom instead of building spike-specific DOM. Engine's click handler toggles `tug-atom-selected` class. Engine's two-step backspace checks for `tug-atom-selected`. CSS classes are the contract — no runtime coupling beyond that.

### For T3.3 (stores)

The completion provider interface (`(query: string) => Promise<CompletionItem[]>`) is the hook. For now, the gallery card provides a fake completion provider. When SessionMetadataStore ships, it plugs in without changing the component.

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

### Pass 1: Extract engine

Move `TugTextEngine` and helpers from `gallery-text-model-spike.tsx` into `lib/tug-text-engine.ts`. Switch imports to use `createAtomDOM` and `AtomSegment` from tug-atom. Update CSS class references from `spike-atom` to `tug-atom`. The spike gallery card switches to importing from this module (keeps working as a regression reference).

**Validation:** Spike gallery card still works identically.

### Pass 2: Build the component

Create `tug-prompt-input.tsx` + `tug-prompt-input.css`. Wire engine into component shell following component authoring guide. Build gallery card. Verify all spike behaviors work in the new component.

**Validation:** Gallery card demonstrates all features: typing, atoms, IME, undo, typeahead, auto-resize, Return/Enter, paste, drop.

### Pass 3: Add prefix detection

First-character routing (`>`, `$`, `:`, `/`). This is engine-level (the engine knows the document content) with a callback to the component. The prefix character gets styled distinctly via CSS.

**Validation:** Gallery card shows route detection, prefix styling, callback logging.

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
