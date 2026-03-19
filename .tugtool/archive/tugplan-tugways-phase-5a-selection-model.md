<!-- tugplan-skeleton v2 -->

## Tugways Phase 5a: Selection Model {#phase-5a-selection}

**Purpose:** Contain text selection within card boundaries so card chrome is never selectable, drag selection clamps at card edges with zero visual flash, and Cmd+A is scoped to the focused card.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5a-selection-model |
| Last updated | 2026-03-03 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phase 5 delivered the Tugcard composition component with card frames, drag, resize, and responder chain integration. Cards now render on the canvas, but the browser's native selection behavior is unconstrained: a user can drag-select across card boundaries, highlight title bars and resize handles, and Cmd+A selects the entire document. This breaks the card-as-container metaphor.

Web research (documented in design-system-concepts.md Concept 14) confirmed that `user-select: contain` was never implemented in modern browsers, Shadow DOM does not prevent selection crossing in WebKit/Safari, and iframes are too heavyweight. The viable approach is a three-layer system: CSS `user-select: none` as a baseline to prevent selection from starting in the wrong places, a JavaScript SelectionGuard singleton that clips selection at runtime when it escapes card boundaries, and a `data-td-select` attribute API for card authors to control selectability within content areas.

#### Strategy {#strategy}

- Add a global `user-select: none` baseline on `body` in `globals.css`, then opt content areas back in with `user-select: text` -- this prevents selection from starting in canvas, card frames, resize handles, or accessory slots.
- Implement SelectionGuard as a module-level singleton (same pattern as ResponderChainManager) that registers card content boundaries and clips selection at runtime.
- Implement pointer-clamped selection clipping for drag selection (caretPositionFromPoint with WebKit fallback) and a selectionchange safety net for keyboard-driven selection (Shift+arrow).
- Provide a `useSelectionBoundary` hook so Tugcard auto-registers its content area with SelectionGuard -- card authors never interact with the guard directly.
- Wire a `selectAll` responder action in Tugcard so Cmd+A selects within the focused card only, using a `preventDefaultOnMatch` flag on the keybinding to prevent the browser default.
- Add semantic tokens for selection styling and CSS rules for the `data-td-select` attribute API.
- Implement RAF-based autoscroll in SelectionGuard: pointer-clamping breaks native browser autoscroll (the browser never sees the pointer leave the scrollable area), so SelectionGuard implements distance-based autoscroll via `requestAnimationFrame` during clamped selection drag, re-extending the selection after each scroll tick.
- Add `saveSelection`/`restoreSelection` methods to SelectionGuard for per-card selection persistence. Phase 5b tab switching uses these to retain selection across tab changes.
- Verify `data-td-select="custom"` works correctly with contenteditable regions -- the guard must not interfere with contenteditable's native selection, while still preventing selection from escaping the card.

#### Success Criteria (Measurable) {#success-criteria}

- Drag selection starting in a card's content area cannot visually extend beyond that card's boundary (manual test: drag pointer outside card, selection stays clamped at edge)
- Title bars, accessory slots, resize handles, snap guides, and canvas background are never selectable (manual test: attempt to select each area, no selection highlight appears)
- Cmd+A with a focused card selects only that card's content, not the entire document (automated test: dispatch selectAll action, verify selection is within card content div)
- `data-td-select="none"` prevents selection, `data-td-select="all"` produces atomic selection, `data-td-select="custom"` defers to child component including contenteditable (automated tests via bun:test)
- RAF-based autoscroll works during clamped selection drag in cards with overflow content (manual test: drag-select past the bottom edge of a scrollable card, content scrolls and selection extends)
- `saveSelection`/`restoreSelection` round-trip correctly: save selection state, clear it, restore it, verify same range (automated test)
- All existing tugcard.test.tsx and responder-chain tests continue to pass

#### Scope {#scope}

1. CSS `user-select` baseline on body and opt-in on card content areas
2. SelectionGuard singleton with pointer-clamped clipping, selectionchange safety net, and RAF-based autoscroll
3. `saveSelection`/`restoreSelection` methods on SelectionGuard for per-card selection persistence
4. `useSelectionBoundary` hook for automatic card content area registration
5. `data-td-select` attribute API with four modes (default, none, all, custom) — including explicit contenteditable verification
6. Cmd+A scoped to focused card via `selectAll` responder action with `preventDefaultOnMatch` keybinding
7. `--td-selection-bg` and `--td-selection-text` semantic tokens, `::selection` CSS rule
8. `overscroll-behavior: contain` on card content area

#### Non-goals (Explicitly out of scope) {#non-goals}

- Tab switching integration: Phase 5a provides `saveSelection`/`restoreSelection` infrastructure on SelectionGuard, but the actual save-before-unmount / restore-after-mount wiring is Phase 5b's responsibility (tabs don't exist yet)
- Rich text editing features: contenteditable works as a selection boundary via `data-td-select="custom"`, but rich text toolbar integration, formatting commands, and collaborative editing features are Phase 9 card rebuild concerns

#### Dependencies / Prerequisites {#dependencies}

- Phase 5 Tugcard base: Tugcard composition component, CardFrame, responder chain integration, `tugcard.css`, `tugcard.tsx` (all delivered)
- Phase 3 Responder chain: `ResponderChainManager`, `useResponder`, `ResponderChainProvider`, `keybinding-map.ts` (all delivered)
- Phase 4 Mutation model: `useCSSVar`, `useDOMClass`, `useDOMStyle` hooks (all delivered; SelectionGuard follows the same appearance-zone discipline)

#### Constraints {#constraints}

- `document.caretPositionFromPoint()` is the standard API but was only recently added to WebKit; `caretRangeFromPoint()` is the WebKit/Safari fallback. Runtime feature detection is required.
- Selection events (`selectionchange`) fire asynchronously and at high frequency during drag. SelectionGuard must use synchronous imperative handling with no React state updates (appearance-zone only).
- The `preventDefaultOnMatch` keybinding flag must not break existing keybindings that do not use it.

#### Assumptions {#assumptions}

- The `body` element is the correct place for the `user-select: none` baseline because all interactive content lives within card content areas that opt back in.
- SelectionGuard as a module-level singleton (not provided via React context) is the right pattern because selection events need synchronous handling outside the React lifecycle, matching the ResponderChainManager pattern.
- The `caretRangeFromPoint` WebKit fallback produces equivalent results to `caretPositionFromPoint` for the purpose of pointer-clamped clipping.
- Card content areas identified by `[data-testid='tugcard-content']` are the correct boundary elements (the `tugcard-content` div rendered by Tugcard).

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

All headings that will be referenced use explicit anchors in kebab-case. Decisions use two-digit labels (D01, D02, etc.) with corresponding anchors. Steps use step-N anchors. Stable label conventions (Spec, Table, List, Risk) follow the skeleton rules.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| caretPositionFromPoint not available in target WebKit | high | low | Runtime feature detect with caretRangeFromPoint fallback | Safari version testing reveals neither API works |
| selectionchange event timing causes flash before clipping | med | med | Pointer-level clamping handles drag path (primary); selectionchange is safety net only | Visual flash observed during selection drag |
| user-select: none on body breaks text input in future components | med | low | Card content areas explicitly opt in; form controls in content inherit user-select: text | New form control added in Phase 8b fails to receive selection |

**Risk R01: caretPositionFromPoint API availability** {#r01-caret-api}

- **Risk:** The standard `caretPositionFromPoint` may not be available in the target WebKit version embedded in the macOS app.
- **Mitigation:**
  - Implement runtime feature detection: try `caretPositionFromPoint` first, fall back to `caretRangeFromPoint` if undefined.
  - Both APIs return equivalent position information; the fallback path is well-tested in Safari.
- **Residual risk:** If neither API is available (extremely unlikely in any modern WebKit), pointer-clamped clipping degrades to the selectionchange safety net, which clips after-the-fact rather than proactively.

**Risk R02: Selection flash during rapid pointer movement** {#r02-selection-flash}

- **Risk:** During fast drag selection, the browser may briefly render selection outside the card boundary before the pointermove handler clamps it.
- **Mitigation:**
  - Pointer-level clamping on every pointermove event (not throttled, not RAF-batched) minimizes the window.
  - The selectionchange safety net catches any residual escapes within a single event loop tick.
- **Residual risk:** A single-frame flash may be observable at very high mouse velocity on slow machines. Acceptable for Phase 5a.

---

### Design Decisions {#design-decisions}

> Record *decisions* (not options). Each decision includes the "why" so later phases don't reopen it accidentally.

#### [D01] Body-level user-select: none baseline (DECIDED) {#d01-body-baseline}

**Decision:** Add `user-select: none` to `body` in `globals.css` as a global baseline, then opt card content areas back in with `user-select: text`.

**Rationale:**
- Prevents selection from starting in canvas background, card frames, resize handles, snap guides, or any future chrome element by default.
- A single baseline rule is simpler and more robust than adding `user-select: none` to each chrome element individually (which risks missing new elements).
- Card content areas are the only places where text selection is meaningful.

**Implications:**
- Every card content area must have `user-select: text` applied via CSS.
- Future components outside card content areas (dock, title bar overlays) inherit the baseline and are non-selectable by default.
- Form controls in card content areas (inputs, textareas) inherit `user-select: text` and work normally.

#### [D02] SelectionGuard module-level singleton (DECIDED) {#d02-guard-singleton}

**Decision:** SelectionGuard is a module-level singleton instantiated at import time, not provided via React context or created per-provider.

**Rationale:**
- Selection events fire at very high frequency during drag; synchronous imperative handling is essential.
- Matches the ResponderChainManager pattern (singleton outside React state).
- There is exactly one document selection in the browser; a singleton maps naturally to this constraint.

**Implications:**
- `useSelectionBoundary` imports the singleton directly; no context provider needed.
- Tests must reset the singleton state between test cases (expose a `reset()` method for testing).
- SelectionGuard is purely an appearance-zone concern with zero React re-renders.

#### [D03] Pointer-clamped selection clipping via caretPositionFromPoint (DECIDED) {#d03-pointer-clamping}

**Decision:** During drag selection, when the pointer exits the card boundary, clamp coordinates to the boundary edge and use `document.caretPositionFromPoint()` (with `caretRangeFromPoint` WebKit fallback) to find the nearest text position. Call `selection.extend()` to pin the selection focus at the clamped edge.

**Rationale:**
- Proactive clamping on every pointermove produces smooth, continuous containment with zero visual flash.
- The selectionchange event-based approach alone is reactive (clips after escape) and can produce visible flicker.
- `caretPositionFromPoint` is the standard API; `caretRangeFromPoint` is the well-supported WebKit equivalent.

**Implications:**
- SelectionGuard installs pointer event listeners (pointerdown, pointermove, pointerup) on the document.
- The guard must track which card boundary the current selection originated in.
- Coordinate clamping is a pure geometric computation (clamp clientX/clientY to the card content area's bounding rect).

#### [D04] selectionchange safety net for keyboard selection (DECIDED) {#d04-selectionchange-safety-net}

**Decision:** A `document.addEventListener('selectionchange', ...)` listener acts as a safety net that clips selection back to card boundaries when keyboard-driven selection extension (Shift+arrow) escapes the card.

**Rationale:**
- Pointer-clamped clipping only handles mouse/touch selection. Keyboard selection extension via Shift+arrow can also escape card boundaries.
- The selectionchange event fires after each selection change, including keyboard-driven ones.
- This is a safety net, not the primary mechanism -- it clips after-the-fact.

**Implications:**
- SelectionGuard listens for `selectionchange` on the document.
- On each event, the guard checks if the current selection's anchor and focus are within the same registered card boundary. If not, it clips to the originating card.
- Performance: `selectionchange` fires frequently but the handler is a fast boundary-check (one `getBoundingClientRect` + `contains` call).

#### [D05] Four select modes via data-td-select attribute (DECIDED) {#d05-select-modes}

**Decision:** The `data-td-select` attribute provides four modes for card content regions: `default` (text, implicit when attribute is absent), `none` (non-selectable controls), `all` (atomic selection for code blocks), `custom` (embedded component manages its own selection, e.g., xterm.js, CodeMirror).

**Rationale:**
- Card authors need fine-grained control within content areas without directly interacting with SelectionGuard.
- CSS-based modes (`none`, `all`) are zero-JavaScript. The `custom` mode signals SelectionGuard to skip clipping for that subtree.
- The attribute is declarative and inspectable in DevTools.

**Implications:**
- CSS rules: `[data-td-select='none'] { user-select: none; }`, `[data-td-select='all'] { user-select: all; }`.
- SelectionGuard checks for `data-td-select="custom"` on selection ancestor nodes and skips clipping when found.
- Default mode (no attribute) inherits `user-select: text` from the card content area.

#### [D06] Cmd+A scoped to focused card via preventDefaultOnMatch (DECIDED) {#d06-scoped-selectall}

**Decision:** Add a `selectAll` responder action to Tugcard that calls `selectAllChildren` on the card's content area div. Wire Cmd+A as a keybinding with `preventDefaultOnMatch: true` so the browser's native select-all is suppressed when the binding matches.

**Rationale:**
- Users expect Cmd+A to select content within the focused context, not the entire document.
- The responder chain already handles action dispatch; `selectAll` fits naturally alongside `close`, `minimize`, `toggleMenu`, `find`.
- `preventDefaultOnMatch` is a targeted extension to the existing keybinding system that does not affect bindings without the flag.

**Implications:**
- `KeyBinding` interface in `keybinding-map.ts` gains an optional `preventDefaultOnMatch?: boolean` field.
- `matchKeybinding` return type changes to include the flag (or returns the full binding object).
- The capture-phase listener in `ResponderChainProvider` calls `preventDefault` when the flag is set, before dispatching.
- Tugcard must hold a ref to its content div to call `window.getSelection().selectAllChildren(contentRef.current)`.

#### [D07] Selection tokens via color-mix (DECIDED) {#d07-selection-tokens}

**Decision:** Add `--td-selection-bg` and `--td-selection-text` semantic tokens to `tokens.css`. The background token uses `color-mix(in srgb, var(--td-accent-cool) 40%, transparent)` for a translucent accent-tinted highlight. The text token uses `var(--td-text)`.

**Rationale:**
- Theme-aware selection styling ensures selection highlight matches the active theme.
- `color-mix` provides translucent tinting without hardcoded RGBA values, and adapts automatically when theme tokens change.
- The 40% opacity is a good default that is visible but does not obscure text.

**Implications:**
- A `::selection` rule in `tugcard.css` applies these tokens to card content areas.
- Theme override files (bluenote.css, harmony.css) can override these tokens if needed (they inherit the accent-cool base by default).

---

### Specification {#specification}

#### SelectionGuard API {#selectionguard-api}

**Spec S01: SelectionGuard public interface** {#s01-selectionguard-interface}

```typescript
/** Serialized selection state for save/restore across tab switches. */
interface SavedSelection {
  anchorPath: number[];   // index path from content root to anchor node
  anchorOffset: number;
  focusPath: number[];    // index path from content root to focus node
  focusOffset: number;
}

class SelectionGuard {
  /** Register a card content area as a selection boundary. */
  registerBoundary(cardId: string, element: HTMLElement): void;

  /** Unregister a card content area. */
  unregisterBoundary(cardId: string): void;

  /** Initialize document-level event listeners. Called once at app startup. */
  attach(): void;

  /** Remove document-level event listeners. Called on teardown. */
  detach(): void;

  /**
   * Save the current selection state for a card. Returns null if the card
   * does not own the active selection. Used by Phase 5b tab switching to
   * save selection before unmounting a tab's content.
   */
  saveSelection(cardId: string): SavedSelection | null;

  /**
   * Restore a previously saved selection state for a card. The card's
   * boundary element must be registered and its content DOM must match
   * the structure at save time (same content, re-mounted). Used by
   * Phase 5b tab switching to restore selection after remounting a tab.
   */
  restoreSelection(cardId: string, saved: SavedSelection): void;

  /** Reset all state (for testing). */
  reset(): void;
}

/** Module-level singleton instance. */
export const selectionGuard: SelectionGuard;
```

**Spec S02: useSelectionBoundary hook signature** {#s02-use-selection-boundary}

```typescript
/**
 * Register a card content area as a selection boundary with SelectionGuard.
 * Called by Tugcard internally. Card authors never call this directly.
 *
 * @param cardId - The card's unique identifier
 * @param contentRef - React ref to the card's content area div
 */
function useSelectionBoundary(
  cardId: string,
  contentRef: React.RefObject<HTMLElement | null>
): void;
```

**Spec S03: preventDefaultOnMatch keybinding extension** {#s03-prevent-default-keybinding}

```typescript
export interface KeyBinding {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: string;
  /** When true, the pipeline calls preventDefault when this binding matches. */
  preventDefaultOnMatch?: boolean;
}

/** Updated return type: returns the full KeyBinding or null. */
export function matchKeybinding(event: KeyboardEvent): KeyBinding | null;
```

**Spec S04: Caret position helper** {#s04-caret-position-helper}

```typescript
/**
 * Get the caret position from a point, using caretPositionFromPoint with
 * caretRangeFromPoint WebKit fallback.
 *
 * @returns { node: Node, offset: number } or null if no position found.
 */
function caretPositionFromPointCompat(
  x: number,
  y: number
): { node: Node; offset: number } | null;
```

#### data-td-select Attribute Modes {#select-attribute-modes}

**Table T01: data-td-select attribute modes** {#t01-select-modes}

| Value | CSS Effect | SelectionGuard Behavior | Use Case |
|-------|-----------|------------------------|----------|
| (absent) | Inherits `user-select: text` from `.tugcard-content` | Normal clipping | Default text content |
| `none` | `user-select: none` | Skips (nothing to select) | Buttons, toolbars, non-text controls |
| `all` | `user-select: all` | Normal clipping (atomic select) | Code blocks, pre-formatted content |
| `custom` | No CSS override | Skips clipping for this subtree | xterm.js, CodeMirror, contenteditable |

#### CSS Changes Summary {#css-changes}

**Table T02: CSS modifications** {#t02-css-changes}

| File | Change | Reference |
|------|--------|-----------|
| `globals.css` | Add `user-select: none` to `body` rule | [D01] |
| `tugcard.css` | Add `user-select: text` to `.tugcard-content` | [D01] |
| `tugcard.css` | Add `overscroll-behavior: contain` to `.tugcard-content` | Phase 5a scope item 7 |
| `tugcard.css` | Add `::selection` rule with token-based colors | [D07] |
| `tugcard.css` | Add `[data-td-select='none']`, `[data-td-select='all']` rules | [D05] |
| `tokens.css` | Add `--td-selection-bg` and `--td-selection-text` tokens | [D07] |
| `chrome.css` | Add `user-select: none` to `.card-frame-resize` (belt-and-suspenders) | [D01] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/selection-guard.ts` | SelectionGuard singleton: boundary registration, pointer-clamped clipping, selectionchange safety net, RAF autoscroll, save/restore selection, caretPositionFromPoint compat |
| `tugdeck/src/components/tugways/hooks/use-selection-boundary.ts` | Hook for Tugcard to register content area with SelectionGuard |
| `tugdeck/src/__tests__/selection-guard.test.ts` | Unit tests for SelectionGuard singleton |
| `tugdeck/src/__tests__/use-selection-boundary.test.tsx` | Unit tests for useSelectionBoundary hook (register/unregister lifecycle) |
| `tugdeck/src/__tests__/selection-model.test.tsx` | Integration tests for selection containment, Cmd+A scoping, data-td-select modes |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `SelectionGuard` | class | `selection-guard.ts` | Module-level singleton, registers boundaries, clips selection, autoscrolls, saves/restores selection |
| `selectionGuard` | const (singleton) | `selection-guard.ts` | Exported singleton instance |
| `SavedSelection` | interface | `selection-guard.ts` | Serialized selection state: anchorPath, anchorOffset, focusPath, focusOffset |
| `caretPositionFromPointCompat` | fn | `selection-guard.ts` | Runtime feature detect: caretPositionFromPoint with caretRangeFromPoint fallback |
| `useSelectionBoundary` | fn (hook) | `hooks/use-selection-boundary.ts` | Registers/unregisters card content area with SelectionGuard |
| `preventDefaultOnMatch` | field | `keybinding-map.ts` `KeyBinding` | Optional boolean; pipeline calls preventDefault when true |
| `matchKeybinding` | fn (modified) | `keybinding-map.ts` | Returns full `KeyBinding` object instead of action string |
| `KEYBINDINGS` | const (extended) | `keybinding-map.ts` | Add `{ key: "KeyA", meta: true, action: "selectAll", preventDefaultOnMatch: true }` |
| `selectAll` | action handler | `tugcard.tsx` | Calls `selectAllChildren` on card content ref |
| `contentRef` | ref | `tugcard.tsx` | Ref to content area div, passed to useSelectionBoundary and selectAll |
| `--td-selection-bg` | CSS token | `tokens.css` | `color-mix(in srgb, var(--td-accent-cool) 40%, transparent)` |
| `--td-selection-text` | CSS token | `tokens.css` | `var(--td-text)` |

---

### Documentation Plan {#documentation-plan}

- [ ] Add JSDoc header to `selection-guard.ts` citing D34-D38 from design-system-concepts.md and this plan's decisions
- [ ] Add JSDoc header to `use-selection-boundary.ts` explaining that card authors do not interact with SelectionGuard directly
- [ ] Document `data-td-select` attribute API in `selection-guard.ts` JSDoc (table of four modes, including contenteditable with `custom`)
- [ ] Document `SavedSelection` interface and `saveSelection`/`restoreSelection` usage for Phase 5b tab switching
- [ ] Document RAF-based autoscroll behavior: why it's required (pointer-clamping breaks native autoscroll), edge zone sizing, speed curve

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test SelectionGuard boundary registration, clamping math, caretPositionFromPoint compat, save/restore round-trip | Core guard logic, edge cases |
| **Integration** | Test Tugcard + SelectionGuard integration via useSelectionBoundary, Cmd+A scoping, contenteditable with data-td-select="custom" | End-to-end selection containment |
| **Regression** | Verify existing Tugcard and responder chain tests pass after keybinding changes | Backward compatibility |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: CSS Baseline and Selection Tokens {#step-1}

**Commit:** `feat(tugdeck): add user-select baseline and selection tokens`

**References:** [D01] Body-level user-select baseline, [D07] Selection tokens via color-mix, Table T02 CSS changes, (#context, #css-changes)

**Artifacts:**
- Modified `tugdeck/src/globals.css` -- add `user-select: none` to `body` rule
- Modified `tugdeck/styles/tokens.css` -- add `--td-selection-bg` and `--td-selection-text` semantic tokens
- Modified `tugdeck/src/components/tugways/tugcard.css` -- add `user-select: text` and `overscroll-behavior: contain` to `.tugcard-content`, add `::selection` rule, add `[data-td-select]` CSS rules
- Modified `tugdeck/styles/chrome.css` -- add `user-select: none` to `.card-frame-resize`

**Tasks:**
- [ ] Add `user-select: none` to the existing `body` rule in `globals.css`
- [ ] Add `--td-selection-bg: color-mix(in srgb, var(--td-accent-cool) 40%, transparent)` and `--td-selection-text: var(--td-text)` to the semantic token section in `tokens.css` (after the titlebar/icon tokens block)
- [ ] Add `user-select: text` and `overscroll-behavior: contain` to `.tugcard-content` in `tugcard.css`
- [ ] Add `.tugcard-content ::selection { background-color: var(--td-selection-bg); color: var(--td-selection-text); }` rule to `tugcard.css`
- [ ] Add `[data-td-select='none'] { user-select: none; }` and `[data-td-select='all'] { user-select: all; }` rules to `tugcard.css`
- [ ] Add `user-select: none` to `.card-frame-resize` in `chrome.css` (belt-and-suspenders with body baseline)
- [ ] Verify `.tugcard-header` already has `user-select: none` (confirmed in existing CSS)

**Tests:**
- [ ] T01: Existing tugcard.test.tsx passes (no regressions from CSS changes)
- [ ] T02: Existing card-frame.test.tsx passes

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/tugcard.test.tsx`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/card-frame.test.tsx`

---

#### Step 2: preventDefaultOnMatch Keybinding Extension {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add preventDefaultOnMatch to keybinding pipeline`

**References:** [D06] Cmd+A scoped to focused card via preventDefaultOnMatch, Spec S03, (#selectionguard-api, #strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/keybinding-map.ts` -- add `preventDefaultOnMatch` field to `KeyBinding`, update `matchKeybinding` return type to `KeyBinding | null`, add Cmd+A binding
- Modified `tugdeck/src/components/tugways/responder-chain-provider.tsx` -- update capture listener to check `preventDefaultOnMatch` flag and call `preventDefault` when set

**Tasks:**
- [ ] Add optional `preventDefaultOnMatch?: boolean` field to the `KeyBinding` interface
- [ ] Change `matchKeybinding` return type from `string | null` to `KeyBinding | null` -- return the full binding object on match, null on no match
- [ ] Add `{ key: "KeyA", meta: true, action: "selectAll", preventDefaultOnMatch: true }` to the `KEYBINDINGS` array
- [ ] Update `ResponderChainProvider` capture listener with complete updated logic: `const binding = matchKeybinding(event); if (!binding) return; if (binding.preventDefaultOnMatch) { event.preventDefault(); } const handled = manager.dispatch(binding.action); if (handled) { event.preventDefault(); event.stopImmediatePropagation(); }` -- this ensures `preventDefaultOnMatch` adds an early preventDefault on match (before dispatch) while preserving the existing dispatch-gated preventDefault and stopImmediatePropagation for all bindings
- [ ] Update test assertions in `key-pipeline.test.tsx` that compare `matchKeybinding(event)` to a string value -- change them to compare against the full KeyBinding object or use `matchKeybinding(event)?.action` (e.g., `expect(matchKeybinding(event)?.action).toBe("cyclePanel")`)
- [ ] Update any other callers of `matchKeybinding` to use the new return type (check for `.action` property instead of direct string)

**Tests:**
- [ ] T03: matchKeybinding returns full KeyBinding object for Cmd+A
- [ ] T04: matchKeybinding returns null for non-matching keys (existing behavior)
- [ ] T05: matchKeybinding returns full KeyBinding object for Ctrl+` (existing binding, backward compat)
- [ ] T06: Updated key-pipeline.test.tsx tests pass with new KeyBinding return type
- [ ] T07: Existing responder-chain.test.ts passes (regression check)
- [ ] T08a: Existing e2e-responder-chain.test.tsx passes (verifies capture listener still dispatches correctly after refactor)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/key-pipeline.test.tsx`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/responder-chain.test.ts`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/e2e-responder-chain.test.tsx`

---

#### Step 3: SelectionGuard Singleton {#step-3}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): implement SelectionGuard singleton with pointer-clamped clipping`

**References:** [D02] SelectionGuard module-level singleton, [D03] Pointer-clamped clipping, [D04] selectionchange safety net, [D05] Four select modes, Spec S01, Spec S04, Risk R01, Risk R02, Table T01, (#selectionguard-api, #select-attribute-modes)

**Artifacts:**
- New `tugdeck/src/components/tugways/selection-guard.ts`
- New `tugdeck/src/__tests__/selection-guard.test.ts`

**Tasks:**
- [ ] Create `selection-guard.ts` with the `SelectionGuard` class implementing Spec S01, including `SavedSelection` interface
- [ ] Implement `registerBoundary(cardId, element)` -- stores cardId-to-element mapping
- [ ] Implement `unregisterBoundary(cardId)` -- removes mapping
- [ ] Implement `attach()` -- installs document-level `pointerdown`, `pointermove`, `pointerup`, and `selectionchange` listeners
- [ ] Implement `detach()` -- removes all document-level listeners
- [ ] Implement `reset()` -- clears all boundaries, saved selections, and internal state (for testing)
- [ ] Implement `caretPositionFromPointCompat(x, y)` as a private method or module-level function: try `document.caretPositionFromPoint(x, y)`, fall back to `document.caretRangeFromPoint(x, y)`, return `{ node, offset }` or null
- [ ] Implement pointer-clamped clipping logic:
  - On `pointerdown`: check if `event.target` is contained within a registered boundary element using `element.contains(event.target)`. Only begin tracking if the target is inside a registered card content area (this prevents resize handles, title bars, and canvas clicks from starting selection tracking).
  - On `pointermove` while tracking: if pointer exits the boundary rect, clamp coordinates to boundary edge, call `caretPositionFromPointCompat` with clamped coords, call `selection.extend()` to pin the focus
  - On `pointerup`: stop tracking, cancel any active autoscroll RAF
- [ ] Implement RAF-based autoscroll: when the pointer is outside the card content area's scroll viewport during a clamped selection drag, compute scroll velocity proportional to distance from the nearest edge (EDGE_SIZE_PX = 40, MAX_SCROLL_SPEED = 20), scroll via `requestAnimationFrame`, and re-extend the selection after each scroll tick to track newly visible content. The RAF loop continues as long as the pointer stays outside the scroll viewport, even if the pointer stops moving.
- [ ] Implement `selectionchange` safety net: on each event, check if selection anchor and focus are within the same registered boundary. If selection spans multiple boundaries or escapes entirely, collapse to the originating boundary.
- [ ] Check for `data-td-select="custom"` on ancestor nodes -- when found, skip clipping for that subtree (this includes contenteditable regions)
- [ ] Implement `saveSelection(cardId)`: if the card owns the active selection, serialize anchor/focus as DOM tree index paths (array of child indices from the boundary element to the node) and offsets. Return `SavedSelection` or null.
- [ ] Implement `restoreSelection(cardId, saved)`: walk the saved index paths from the card's boundary element to resolve anchor/focus nodes, then call `selection.setBaseAndExtent()`. No-op if the boundary is not registered or nodes cannot be resolved (DOM structure changed).
- [ ] Export the `selectionGuard` singleton instance and the `SavedSelection` interface
- [ ] Write unit tests for boundary registration/unregistration
- [ ] Write unit tests for clamping math (pure geometry: given boundary rect and pointer position, compute clamped coords)
- [ ] Write unit tests for reset behavior
- [ ] Write unit tests for saveSelection/restoreSelection round-trip

**Tests:**
- [ ] T08: registerBoundary stores cardId-to-element mapping; unregisterBoundary removes it
- [ ] T09: reset clears all boundaries and saved selections
- [ ] T10: Clamping function clamps pointer coordinates to boundary rect edges (pure math test)
- [ ] T11: Guard skips clipping when ancestor has data-td-select="custom" (including contenteditable)
- [ ] T11a: saveSelection returns null when card does not own active selection
- [ ] T11b: saveSelection/restoreSelection round-trip: save, collapse selection, restore, verify same range
- [ ] T11c: restoreSelection is a no-op when boundary is not registered (no error thrown)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/selection-guard.test.ts`

---

#### Step 4: useSelectionBoundary Hook {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): implement useSelectionBoundary hook`

**References:** [D02] SelectionGuard singleton, Spec S02, (#selectionguard-api)

**Artifacts:**
- New `tugdeck/src/components/tugways/hooks/use-selection-boundary.ts`
- New `tugdeck/src/__tests__/use-selection-boundary.test.tsx`
- Modified `tugdeck/src/components/tugways/hooks/index.ts` -- add export for `useSelectionBoundary`

**Tasks:**
- [ ] Create `use-selection-boundary.ts` implementing Spec S02
- [ ] Hook calls `selectionGuard.registerBoundary(cardId, element)` in a `useEffect` when the ref has a current element, and `selectionGuard.unregisterBoundary(cardId)` on cleanup
- [ ] Add `useSelectionBoundary` export to `hooks/index.ts` barrel
- [ ] Write `use-selection-boundary.test.tsx` with T12 test case

**Tests:**
- [ ] T12: useSelectionBoundary registers boundary on mount and unregisters on unmount (test via SelectionGuard singleton inspection, in `use-selection-boundary.test.tsx`)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/use-selection-boundary.test.tsx`

---

#### Step 5: Wire Tugcard -- contentRef, selectAll, useSelectionBoundary {#step-5}

**Depends on:** #step-2, #step-4

**Commit:** `feat(tugdeck): wire selectAll action and selection boundary in Tugcard`

**References:** [D06] Cmd+A scoped to focused card, [D02] SelectionGuard singleton, Spec S01, Spec S02, (#selectionguard-api, #strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tugcard.tsx` -- add contentRef, useSelectionBoundary call, selectAll action handler
- New `tugdeck/src/__tests__/selection-model.test.tsx` -- integration tests for Cmd+A scoping and selection boundary

**Tasks:**
- [ ] Add a `useRef<HTMLDivElement>(null)` for the content area div in Tugcard (contentRef)
- [ ] Attach contentRef to the `tugcard-content` div
- [ ] Call `useSelectionBoundary(cardId, contentRef)` to register the content area with SelectionGuard
- [ ] Add `selectAll` action to the Tugcard responder actions map: calls `window.getSelection()?.selectAllChildren(contentRef.current!)` when the content ref is available. Note: the selectAll callback captures `contentRef` (a stable React ref object), so it always reads the current `.current` value at call time -- this is safe because `useResponder` reads `optionsRef.current` inside `useEffect`, and the options ref is updated on every render
- [ ] Write integration test: render Tugcard, dispatch selectAll, verify selection is within content area
- [ ] Write integration test: verify Tugcard registers as responder with selectAll action (extends T15 from existing test)
- [ ] Write integration test: render Tugcard with a `<div contenteditable data-td-select="custom">` inside content area, verify SelectionGuard does not interfere with contenteditable selection, and verify selection cannot escape the card boundary even when contenteditable tries to extend it

**Tests:**
- [ ] T13: Tugcard registers selectAll action in responder chain (canHandle('selectAll') returns true)
- [ ] T14: Dispatching selectAll through the chain calls selectAllChildren on the content area
- [ ] T15: Tugcard content area is registered with SelectionGuard on mount
- [ ] T15a: Contenteditable region with data-td-select="custom" inside card content receives full selection autonomy (guard does not clip within the custom region)
- [ ] T16: Existing tugcard.test.tsx passes (no regressions)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/selection-model.test.tsx`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/tugcard.test.tsx`

---

#### Step 6: Attach SelectionGuard at App Startup {#step-6}

**Depends on:** #step-5

**Commit:** `feat(tugdeck): attach SelectionGuard at app startup`

**References:** [D02] SelectionGuard singleton, Spec S01, (#selectionguard-api, #context)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/responder-chain-provider.tsx` -- call `selectionGuard.attach()` in the provider's useEffect and `selectionGuard.detach()` on cleanup

**Tasks:**
- [ ] Import `selectionGuard` singleton in `responder-chain-provider.tsx`
- [ ] In the existing `useEffect` that installs key pipeline listeners, add `selectionGuard.attach()` at the start and `selectionGuard.detach()` in the cleanup function
- [ ] This co-locates the guard lifecycle with the key pipeline lifecycle -- both are document-level event systems that live for the duration of the provider

**Tests:**
- [ ] T17: Existing e2e-responder-chain.test.tsx passes
- [ ] T18: Existing key-pipeline.test.tsx passes

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/e2e-responder-chain.test.tsx`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/key-pipeline.test.tsx`

---

#### Step 7: Integration Checkpoint {#step-7}

**Depends on:** #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** [D01] Body baseline, [D02] SelectionGuard singleton, [D03] Pointer-clamped clipping, [D06] Cmd+A scoped, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all artifacts from Steps 1-6 are complete and work together
- [ ] Run the full tugdeck test suite to confirm no regressions

**Tests:**
- [ ] T19: Full test suite passes with all selection model changes in place

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

### Deliverables and Checkpoints {#deliverables}

> This is the single place we define "done" for the phase. Keep it crisp and testable.

**Deliverable:** Selection is fully contained within card boundaries. Title bars, accessory slots, canvas background, and resize handles are never selectable. Drag selection clamps at card edges with RAF-based autoscroll for overflow content. Cmd+A selects within the focused card only. Card authors can mark regions as non-selectable, atomic-selectable, or custom-managed (including contenteditable) via `data-td-select`. Selection persistence infrastructure (`saveSelection`/`restoreSelection`) is ready for Phase 5b tab switching.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `user-select: none` is on body; card content areas have `user-select: text` (CSS inspection)
- [ ] SelectionGuard singleton is attached at app startup and registers card content boundaries (code review)
- [ ] Pointer-clamped selection clipping prevents drag selection from escaping card boundaries (manual test)
- [ ] RAF-based autoscroll works during clamped selection drag in cards with overflow content (manual test: drag-select past edge, content scrolls, selection extends)
- [ ] selectionchange safety net clips keyboard-driven selection extension at card edges (manual test)
- [ ] Cmd+A dispatches selectAll to the focused card, selecting only its content (automated test T14)
- [ ] `data-td-select` attribute controls selectability in four modes, including contenteditable with `custom` (automated tests T11, T15a, CSS rules present)
- [ ] `saveSelection`/`restoreSelection` round-trip correctly (automated tests T11a-T11c)
- [ ] `--td-selection-bg` and `--td-selection-text` tokens exist and `::selection` rule uses them (CSS inspection)
- [ ] `overscroll-behavior: contain` is on card content area (CSS inspection)
- [ ] All tugdeck tests pass (`bun test`)

**Acceptance tests:**
- [ ] T14: Dispatching selectAll through the chain selects content within the focused card only
- [ ] T11: SelectionGuard skips clipping for `data-td-select="custom"` subtrees (including contenteditable)
- [ ] T11b: saveSelection/restoreSelection round-trip preserves selection state
- [ ] T15a: Contenteditable region with data-td-select="custom" receives full selection autonomy
- [ ] T19: Full tugdeck test suite passes

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 5b wires save-before-unmount / restore-after-mount tab switching using the `saveSelection`/`restoreSelection` infrastructure delivered in this phase
- [ ] Rich text editing features (formatting toolbar, collaborative editing) for contenteditable regions in Phase 9 card rebuilds — the selection containment model handles contenteditable correctly via `data-td-select="custom"`, but editing-specific features are card-level concerns

| Checkpoint | Verification |
|------------|--------------|
| CSS baseline applied | `user-select: none` on body, `user-select: text` on `.tugcard-content` visible in computed styles |
| SelectionGuard operational | Card boundaries registered on mount, clipping fires on pointer exit, autoscroll works in overflow content |
| Cmd+A scoped | `bun test src/__tests__/selection-model.test.tsx` |
| Selection persistence | `bun test src/__tests__/selection-guard.test.ts` (T11a-T11c) |
| Full regression | `cd tugdeck && bun test` |
