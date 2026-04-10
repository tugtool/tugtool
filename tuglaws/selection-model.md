# Selection Model

How text selection works across tugdeck — covering both read-only card content and editing components.

## Overview

There are **three separate selection systems** in tugdeck that coexist:

1. **SelectionGuard** — a module-level singleton that manages selection rendering, boundary enforcement, and card-switch persistence for all card content via the CSS Custom Highlight API.

2. **Editing component selection models** — each editing component owns its own selection:
   - **Native inputs** (tug-input, tug-textarea, tug-value-input): `selectionStart`/`selectionEnd` on the HTML element
   - **TugTextEngine** (tug-prompt-input): flat text offsets `{ start, end }` managed by the engine, rendered through contentEditable's native selection

3. **The browser's native selection** — `window.getSelection()` / `document.Selection`. The single source of truth that both SelectionGuard and the editing components build on top of.

The relationship between these systems varies by component type:

| Component | Selection owner | SelectionGuard's role | `::selection` | `::highlight(card-selection)` |
|-----------|----------------|----------------------|---------------|-------------------------------|
| tug-markdown-view | SelectionGuard | Active: rendering, containment, drag-to-select, persistence | Transparent (suppressed) | Paints selection |
| tug-prompt-input | TugTextEngine | Passive: mirrors for card-switch dimming. `data-td-select="custom"` exempts from clipping. | Re-enabled (paints selection) | Suppressed (`transparent !important`) |
| tug-input | Browser native | Passive: mirrors for card-switch dimming | Re-enabled (paints selection) | Paints selection (redundant with `::selection`) |
| tug-textarea | Browser native | Passive: mirrors for card-switch dimming | Re-enabled (paints selection) | Paints selection (redundant with `::selection`) |
| tug-value-input | Browser native | Passive: mirrors for card-switch dimming | Re-enabled (paints selection) | Paints selection (redundant with `::selection`) |

**Note:** tug-input, tug-textarea, and tug-value-input have **double rendering** — both `::selection` and `::highlight(card-selection)` paint. This is a latent issue that doesn't currently cause visible problems because the colors match, but it means both systems are active simultaneously for these components.

---

## SelectionGuard Architecture

### Single-system rendering via CSS Custom Highlights

The browser's native `::selection` pseudo-element is suppressed inside card content:

```css
/* tug-card.css */
.tugcard-content ::selection {
  background-color: transparent;
  color: inherit;
}
```

Individual editing components re-enable `::selection` for themselves (see table above). All other selection painting goes through two CSS Custom Highlights:

| Highlight name | Purpose | Visual treatment |
|----------------|---------|-----------------|
| `card-selection` | Active card's selection | `--tug7-surface-selection-primary-normal-plain-rest` |
| `inactive-selection` | Dimmed selections for background cards | `--tug7-surface-selection-primary-normal-plain-inactive` |

#### Why CSS Highlights instead of native `::selection`?

Card switching requires showing a dimmed selection on inactive cards while showing a full selection on the active card. Native `::selection` can only render one style globally. The CSS Custom Highlight API supports multiple named highlights with independent styles.

### Three-layer selection containment

1. **CSS baseline** — `user-select: none` on `body` (`globals.css:28`) prevents selection from starting in UI chrome. Individual content components opt back in with `user-select: text`.

2. **Runtime boundary enforcement** — SelectionGuard clips selection at card boundaries when it escapes during drag:
   - `handlePointerMove`: clamps selection focus to the boundary edge via `caretPositionFromPointCompat`
   - `handleSelectionChange`: safety net that clips keyboard-driven selection (Shift+Arrow)
   - RAF-based autoscroll: scrolls content and re-extends selection when pointer exits the scroll viewport

3. **`data-td-select` attribute API** — per-region control within a card:
   - `default` — normal (clipping applies)
   - `none` — blocks selection (`user-select: none`)
   - `all` — selects entire region on click (`user-select: all`)
   - `custom` — SelectionGuard skips clipping for this subtree (used by tug-prompt-input's contentEditable)

### Event listeners

SelectionGuard installs **five document-level listeners** in `attach()` (called by ResponderChainProvider at startup):

| Event | Phase | Purpose |
|-------|-------|---------|
| `pointerdown` | capture | Card activation, start drag tracking |
| `pointermove` | capture | Clamp selection to boundary during drag |
| `pointerup` | capture | Stop tracking |
| `selectionchange` | bubble | Mirror DOM Selection into CSS Highlight; clip escaped keyboard selections |
| `selectstart` | capture | Block selection from starting outside card boundaries |

**Ordering with other listeners:** ResponderChainProvider also has a capture-phase `pointerdown` listener (for first-responder promotion). It fires **before** SelectionGuard's listener (both capture, registration order determines sequence within the same phase). Component-level listeners (bubble phase) fire after both.

### Internal state

| Field | Type | Purpose |
|-------|------|---------|
| `boundaries` | `Map<string, HTMLElement>` | Registered card content boundary elements |
| `cardRanges` | `Map<string, Range>` | Last-known Range clone per card — **survives highlight removal** |
| `activeHighlightCardId` | `string \| null` | Which card's Range is in `card-selection` |
| `activeHighlight` | `Highlight` | The `card-selection` CSS Highlight object |
| `inactiveHighlight` | `Highlight` | The `inactive-selection` CSS Highlight object |
| `justActivatedCardId` | `string \| null` | Set on card switch; cleared after first `selectionchange` |
| `isTracking` | `boolean` | Whether a pointer drag is in progress |
| `activeCardId` | `string \| null` | Card being tracked during drag |
| `lastPointerX/Y` | `number` | Last pointer position (for clamping and autoscroll) |

**Hidden state hazards:**
- `cardRanges` persists Range clones even after they're removed from both highlights. This is intentional (fallback for `saveSelection`) but means stale Ranges exist that can be re-added to highlights by `activateCard`.
- `activeHighlightCardId` can be `null` when the selection is cleared (e.g., `removeAllRanges()` → `selectionchange` → `syncActiveHighlight` with `rangeCount === 0`). Different code paths treat `null` differently, creating ambiguity between "no card focused" and "selection was cleared in the active card."
- `justActivatedCardId` is set in `activateCard` on card switches. It causes `syncActiveHighlight` to preserve the old non-collapsed Range instead of accepting the browser's click-collapse. If set unexpectedly, selections become "stuck."

---

## Callers and Integration Points

### Who calls SelectionGuard methods

| Method | Caller | File:Line | When |
|--------|--------|-----------|------|
| `attach()` | ResponderChainProvider | `responder-chain-provider.tsx:58` | Component mount (once) |
| `detach()` | ResponderChainProvider | `responder-chain-provider.tsx:212` | Component unmount cleanup |
| `activateCard(cardId)` | SelectionGuard.handlePointerDown | `selection-guard.ts` (internal) | Pointer click in card content or chrome |
| `activateCard(focusedCardId)` | DeckCanvas | `deck-canvas.tsx:372` | `useLayoutEffect` on every `focusedCardId` change |
| `registerBoundary(cardId, el)` | useSelectionBoundary hook | `use-selection-boundary.ts:56` | Card content area mount |
| `unregisterBoundary(cardId)` | useSelectionBoundary hook | `use-selection-boundary.ts:58` | Card content area unmount |
| `saveSelection(cardId)` | tug-card.tsx | `tug-card.tsx:569` | Tab deactivation (before content unmounts) |
| `restoreSelection(cardId, saved)` | tug-card.tsx | `tug-card.tsx:742, 778` | Tab activation (after content remounts) |
| `deactivateApp()` | main.tsx | `main.tsx:176` | Swift `applicationDidResignActive` |
| `activateApp()` | main.tsx | `main.tsx:182` | Swift `applicationDidBecomeActive` |

**Critical: `activateCard` has two call sites** with different semantics:
1. **SelectionGuard.handlePointerDown** — runs during a pointer event, in capture phase, before the browser processes the click
2. **DeckCanvas.useLayoutEffect** — runs after React commits, triggered by `focusedCardId` state change

Both call the same `activateCard` method, which unconditionally moves Ranges between highlights. The DeckCanvas path can re-trigger activation even when SelectionGuard's own `handlePointerDown` has already processed the same click.

### How DeckCanvas determines focusedCardId

```ts
// deck-canvas.tsx:144
const focusedCardId = deselected
  ? null
  : (cards.length > 0 ? cards[cards.length - 1].id : null);
```

The last card in the array is focused (highest z-index). Focus changes when:
- Card clicked → `store.handleCardFocused()` → reorders array → new last element
- `Ctrl+\`` keyboard → cycles cards
- Card created → new card pushed to end
- Card closed → next card becomes last
- Canvas background click → `deselected = true` → `focusedCardId = null`
- Initial app load → restored from tugbank

Each of these triggers the `useLayoutEffect` at line 370-374, which calls `selectionGuard.activateCard(focusedCardId)`.

### How ResponderChainProvider interacts

ResponderChainProvider does **not** call SelectionGuard methods directly (beyond `attach`/`detach`). However, its capture-phase `pointerdown` listener promotes the first responder, which can trigger React state updates, which can trigger DeckCanvas's `useLayoutEffect`, which calls `activateCard`. This is an **indirect** activation path.

---

## Key Behaviors (Detailed)

### Normal selection (drag-to-select within a card)

1. `pointerdown` (capture): Finds the card boundary containing the target. Sets `isTracking = true`, records card and pointer position.
2. Browser's default `mousedown`: starts native selection tracking.
3. `pointermove` (capture): If pointer escapes boundary rect, clamps selection focus to boundary edge. If near scroll viewport edge, starts RAF autoscroll.
4. `selectionchange` (fires during drag): `syncActiveHighlight()` clones the browser's Range, stores in `cardRanges[cardId]`, adds to `activeHighlight`.
5. `pointerup` (capture): Stops tracking.

### Card switch (click from Card A to Card B)

1. `pointerdown` (capture) on Card B:
   - Calls `activateCard(cardB)`:
     - Card A's Range: `activeHighlight` → `inactiveHighlight` (dims)
     - Card B's Range: `inactiveHighlight` → `activeHighlight` (activates)
     - Sets `justActivatedCardId = cardB` (if Card B had a non-collapsed Range)
   - If Card B's Range is non-collapsed:
     - Restores browser Selection: `sel.removeAllRanges()` + `sel.addRange(range.cloneRange())`
     - Installs one-shot `mousedown` handler (`installPreventMousedown`) that calls `preventDefault()` — stops browser from collapsing the restored selection

2. `selectionchange`: `syncActiveHighlight()` runs. The `justActivatedCardId` guard: if Range is collapsed and `justActivatedCardId` matches, **preserves the existing non-collapsed Range** instead of accepting the collapse.

3. DeckCanvas `useLayoutEffect`: `focusedCardId` changed → calls `activateCard(cardB)` again. Should be a no-op if `activeHighlightCardId` already equals `cardB`.

### Selection cleared

When `removeAllRanges()` is called (from any source) or the selection anchor moves outside all boundaries:

1. `selectionchange` → `syncActiveHighlight()` sees `rangeCount === 0` or anchor outside boundaries.
2. Removes Range from `activeHighlight`.
3. Sets `activeHighlightCardId = null`.
4. **Keeps the Range in `cardRanges`** (fallback for `saveSelection`).

### Save/restore for tab switches

- `saveSelection(cardId)`: Serializes selection as index paths from boundary root. Tries live browser Selection first, falls back to stored Range in `cardRanges`.
- `restoreSelection(cardId, saved)`: Resolves paths back to DOM nodes, calls `setBaseAndExtent`, then `syncActiveHighlight()` synchronously.

### App activation/deactivation

- `deactivateApp()`: Moves active card's Range to `inactiveHighlight` (all selections dim). Called from Swift.
- `activateApp()`: Moves it back to `activeHighlight` and restores browser Selection. Called from Swift.

---

## CSS Rules Reference

### `::selection` suppression and restoration

| Selector | Value | File |
|----------|-------|------|
| `.tugcard-content ::selection` | `transparent` | tug-card.css:394 |
| `.tugcard-title-bar ::selection`, `.tugcard-title-bar::selection` | `transparent` | tug-card.css:190-196 |
| `.tug-textarea::selection` | Re-enabled (selection colors) | tug-textarea.css:85 |
| `.tug-value-input::selection` | Re-enabled (selection colors) | tug-value-input.css:68 |
| `.tug-input::selection` | Re-enabled (selection colors) | tug-input.css:80 |
| `.tug-prompt-input-editor ::selection`, `.tug-prompt-input-editor::selection` | Re-enabled (selection colors) | tug-prompt-input.css:113-114 |

### `::highlight()` rules

| Selector | Value | File |
|----------|-------|------|
| `::highlight(card-selection)` | Selection colors | tug-card.css:405 |
| `::highlight(inactive-selection)` | Dimmed colors | tug-card.css:418 |
| `.tug-prompt-input-editor::highlight(card-selection)` | `transparent !important` (suppressed) | tug-prompt-input.css:119-120 |
| `.tug-prompt-input-editor::highlight(inactive-selection)` | `transparent !important` (suppressed) | tug-prompt-input.css:125-126 |
| `.tug-textarea::highlight(card-selection)`, `inactive-selection` | Selection/dimmed colors | tug-textarea.css:90-91 |
| `.tug-value-input::highlight(card-selection)`, `inactive-selection` | Selection/dimmed colors | tug-value-input.css:73-74 |
| `.tug-input::highlight(card-selection)`, `inactive-selection` | Selection/dimmed colors | tug-input.css:85-86 |
| `[data-select-all] .tugx-md-block-container ::highlight(card-selection)` | `transparent` (suppressed during select-all) | tug-markdown-view.css:120 |

### `user-select` rules

| Selector | Value | File |
|----------|-------|------|
| `body` | `none` | globals.css:28 |
| `.tugcard-title-bar` | `none` | tug-card.css:183 |
| `.tugcard-content` | Inherits `none` from body (was `text`, changed) | tug-card.css:351 |
| `[data-td-select="none"]` | `none` | tug-card.css:424 |
| `[data-td-select="all"]` | `all` | tug-card.css:428 |
| `.tugx-md-scroll-container` | `text` | tug-markdown-view.css:39 |
| `.tug-input` | `text` | tug-input.css:63 |
| `.tug-textarea` | `text` | tug-textarea.css:68 |
| `.tug-value-input` | `text` | tug-value-input.css:52 |
| `.tug-sheet` | `text` | tug-sheet.css:90 |

### Data attributes

| Attribute | Purpose | Set by |
|-----------|---------|--------|
| `data-td-select` | Per-region selection control (none/all/custom) | Component authors |
| `data-no-activate` | Skip highlight activation on click | tug-card.tsx (close button) |
| `data-card-id` | Identifies card ownership for chrome elements | tug-card.tsx, tug-tab-bar.tsx |
| `data-select-all` | Logical select-all active | tug-markdown-view.tsx |

---

## Registration

Cards register their content area as a selection boundary via `useSelectionBoundary(cardId, contentRef)`, which calls `selectionGuard.registerBoundary(cardId, element)` in a `useLayoutEffect`. The boundary element is the `.tugcard-content` div.

---

## Known Issues

### 1. Same-card click-to-clear fails (stuck selections)

**Status: Partially fixed, root cause not fully resolved**

After drag-selecting text, clicking to clear the selection fails — it appears "stuck" or flashes. Multiple fixes have been applied to `handlePointerDown` and `activateCard` (early return for same-card, three-case structure) but the symptom persists. The root cause may involve:

- `syncActiveHighlight` unconditionally mirroring browser selection state on every `selectionchange`, including transient states during click processing
- `justActivatedCardId` guard preserving old selections when it shouldn't
- `activateCard` being called from DeckCanvas's `useLayoutEffect` as a second activation path
- WebKit-specific behavior where clicking on selected text doesn't collapse on mousedown (waits for mouseup to determine click vs drag-start)
- Interaction between `cardRanges` persistence and the Highlight API — stale Ranges survive in `cardRanges` after being removed from highlights, and can be re-added by any path that calls `activateCard`

### 2. Selection boundary is too broad

**Status: CSS change applied, highlight painting issue remains**

The SelectionGuard boundary is registered on `.tugcard-content` — the entire scrollable content area. `user-select: text` has been moved from `.tugcard-content` to individual content components, which prevents selection from *starting* in card chrome. However, the CSS Custom Highlight API paints based on Range position, independent of `user-select`. If a drag-selection Range spans from content through chrome (because the boundary includes both), the highlight paints through chrome even though `user-select: none` is set there.

Fixing this requires either:
- Narrowing the SelectionGuard boundary to specific content components (requires multi-boundary-per-card support)
- Clipping the Range itself to exclude `user-select: none` regions
- Adding `::highlight(card-selection) { background-color: transparent }` rules to chrome elements

### 3. Double rendering on native input components

tug-input, tug-textarea, and tug-value-input have both `::selection` re-enabled AND `::highlight(card-selection)` rules. Both paint simultaneously. Currently harmless because colors match, but it means two rendering systems are active for these components. tug-prompt-input correctly suppresses `::highlight()` with `!important` and uses only `::selection`.

---

## Required Selection Features

What the selection system needs to deliver:

### Basic selection in read-only content (tug-markdown-view)
- Click-and-drag to select text
- Click to clear an existing selection
- Single click does NOT leave a visible caret (read-only content)
- Selection does not extend into card chrome (titles, toolbars, buttons)
- Selection does not extend into other cards
- Copy (⌘C) copies the selected text
- Right-click context menu with Copy enabled when selection exists

### Select-all in virtualized content
- ⌘A (or context menu Select All) selects the entire document, including content not currently in the DOM
- Visual feedback: all visible blocks appear selected
- ⌘C after ⌘A copies the full document from the data model
- Any click or new selection clears the select-all state
- Select-all completely replaces any previous selection (no ghost of old selection)

### Card-switch selection preservation
- When switching from Card A to Card B, Card A's selection dims (inactive style)
- When switching back to Card A, the dimmed selection reactivates
- Copy works immediately after switching back (browser Selection matches the visual)

### Tab-switch selection persistence
- Selection survives tab changes within a card (save before unmount, restore after remount)

### App activation/deactivation
- All selections dim when the app loses focus
- Active card's selection restores when the app regains focus

### Editing component coexistence
- Editing components (tug-prompt-input, native inputs) manage their own selection
- SelectionGuard renders their selection for card-switch dimming without interfering
- No double rendering artifacts

---

## Files

| File | Role |
|------|------|
| `selection-guard.ts` | SelectionGuard singleton — rendering, containment, persistence |
| `hooks/use-selection-boundary.ts` | Hook to register/unregister card content boundaries |
| `tug-card.css` | `::selection` suppression, `::highlight()` token rules, `data-td-select` attribute rules |
| `globals.css` | `user-select: none` baseline on body |
| `tug-card.tsx` | Calls `useSelectionBoundary`, `saveSelection`, `restoreSelection` |
| `responder-chain-provider.tsx` | Calls `attach()`/`detach()`, owns capture-phase pointerdown for first-responder promotion |
| `deck-canvas.tsx` | Calls `activateCard` on `focusedCardId` changes |
| `main.tsx` | Wires `activateApp`/`deactivateApp` to Swift lifecycle |
| `tug-prompt-input.css` | Suppresses `::highlight()`, re-enables `::selection` |
| `tug-input.css`, `tug-textarea.css`, `tug-value-input.css` | Re-enable `::selection`, also have `::highlight()` rules (double rendering) |
| `tug-markdown-view.css` | `user-select: text`, `caret-color: transparent`, select-all visual, highlight suppression during select-all |
| `tug-markdown-view.tsx` | Context menu, responder registration, virtualized select-all logic |
| `text-selection-adapter.ts` | TextSelectionAdapter interface, HighlightSelectionAdapter implementation |
