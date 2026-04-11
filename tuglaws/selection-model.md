# Selection Model

How text selection works across tugdeck cards.

## Three Selection Categories

Every component in a card falls into one of three categories, declared via the `data-tug-select` attribute:

| Category | `data-tug-select` | CSS | Click-drag | ⌘A | Right-click | Selection highlight |
|----------|-------------------|-----|-----------|-----|-------------|-------------------|
| **Selectable** | `"text"` | `user-select: text` | Creates visible selection | Selects all within component | Copy from selection | Native `::selection` paints |
| **Copyable** | `"copy"` | `user-select: none` | No effect | Not included in select-all | Context menu with Copy | No highlight |
| **Chrome** | `"none"` or absent | `user-select: none` | No effect | Not included in select-all | "No Actions" fallback menu | No highlight |

**Selectable** — text the user can directly select via keyboard or click-drag. Examples: tug-markdown-view content, tug-input, tug-textarea, tug-value-input, tug-prompt-input. These components set `user-select: text` and handle `selectAll` in the responder chain.

**Copyable** — informational text the user might want to copy but should never directly select. Examples: labels with `copyable` prop, timestamps, status lines. These inherit `user-select: none`. The only way to copy is right-click → Copy from a context menu, which reads `el.textContent` directly — no DOM Selection, no highlight. Use the `useCopyableText` hook.

**Chrome** — UI surface with no copyable text content. Examples: buttons, toolbar icons, section dividers, decorative elements. Inherits `user-select: none` and offers no copy mechanism. Right-click shows a "No Actions" fallback menu (never the browser's native menu).

## Rules

**Rule 1: Only selectable components set `user-select: text`.** Copyable and chrome components inherit `user-select: none` from the body. No container element (`.tugcard-content`, `.tug-sheet`, etc.) sets `user-select: text` on behalf of its children.

**Rule 2: Select-all is always scoped to the first responder.** When ⌘A is dispatched through the responder chain, it is handled by the focused selectable component. The card does not handle `selectAll` — if no selectable component is focused, the action is unhandled (no-op).

**Rule 3: Drag-selection is confined to the component where it started.** `user-select: none` on surrounding chrome prevents the selection from extending into copyable or chrome regions. SelectionGuard prevents it from escaping the card.

**Rule 4: Components that contain both chrome and selectable regions use `user-select: none` on the container and `user-select: text` on the selectable region.**

**Rule 5: Copyable components offer right-click → Copy.** They register as responders with a `copy` handler that reads `el.textContent` and writes to the clipboard. They show a `TugEditorContextMenu` with Copy enabled and all other items disabled. They do NOT handle `selectAll`. Use the `useCopyableText` hook.

**Rule 6: Chrome controls refuse focus on click.** Controls marked with `data-tug-focus="refuse"` do not steal keyboard focus or first-responder status from editors on click. This is the web equivalent of Cocoa's `acceptsFirstResponder = false`. The `click` event and keyboard Tab navigation are unaffected. Implemented centrally in `responder-chain-provider.tsx` via two document-level listeners (pointerdown skips promotion, mousedown calls `preventDefault`). Controls only need to add the attribute.

## `data-tug-select` Attribute

Per-region selection control within a card:

| Value | Purpose | CSS effect |
|-------|---------|------------|
| `"text"` | Selectable content | `user-select: text` (set by the component's own CSS) |
| `"copy"` | Copyable content (right-click only) | No CSS override (inherits `none`) |
| `"none"` | Chrome (explicit) | `user-select: none` |
| `"custom"` | Component owns selection autonomously | SelectionGuard skips boundary clipping |
| `"all"` | Select entire region on click | `user-select: all` |
| absent | Chrome (default) | Inherits `user-select: none` from body |

## Focus Acceptance Model

Controls (buttons, checkboxes, switches, sliders, etc.) refuse focus on click via `data-tug-focus="refuse"`. This prevents the browser from moving focus and the responder chain from promoting a new first responder when a chrome control is clicked.

| Component | Focus behavior |
|-----------|---------------|
| TugButton, TugPushButton, TugPopupButton | Refuses focus on click |
| TugCheckbox | Refuses focus on click |
| TugSwitch | Refuses focus on click |
| TugSlider | Refuses focus on click |
| TugChoiceGroup items | Refuses focus on click |
| TugOptionGroup items | Refuses focus on click |
| TugTabBar tabs | Refuses focus on click |
| TugRadioGroup items | Refuses focus on click (via TugButton) |
| TugInput, TugTextarea, TugValueInput | **Accepts focus** — needs keyboard input |
| TugPromptInput | **Accepts focus** — contentEditable |
| TugMarkdownView | **Accepts focus** — tabIndex=0 for keyboard shortcuts |

## Context Menu Hierarchy

Every right-click in the app produces a context menu — never the browser's native menu:

1. **Component-specific menus** — selectable components (text inputs, markdown view) and copyable components show `TugEditorContextMenu` with appropriate items enabled/disabled.
2. **Fallback "No Actions" menu** — a document-level `contextmenu` handler in `ResponderChainProvider` catches any right-click not already handled by a component. Shows a minimal menu with "No Actions" label.

The native browser context menu is suppressed app-wide.

---

## SelectionGuard (Boundary Enforcer)

SelectionGuard is a module-level singleton that operates at the **card level only**:
- Prevents selections from escaping card boundaries
- Handles card-switch dimming (inactive-selection CSS Highlight)
- Handles card-switch restoration (restore browser Selection on click-back)
- Manages app activation/deactivation dimming

It does NOT reach inside cards to manage content selection. Active selection rendering uses native `::selection`. Components own their own selection behavior.

### Architecture

Only ONE CSS Custom Highlight exists: `inactive-selection` for dimmed cards. Active selection uses native `::selection` — no highlight needed.

```css
/* tug-card.css — active selection uses native ::selection */
.tugcard-content ::selection {
  background-color: var(--tug7-surface-selection-primary-normal-plain-rest);
  color: var(--tug7-element-selection-text-normal-plain-rest);
}

/* Dimmed selection for inactive cards */
::highlight(inactive-selection) {
  background-color: var(--tug7-surface-selection-primary-normal-plain-inactive);
  color: inherit;
}
```

### Three-Layer Selection Containment

1. **CSS baseline** — `user-select: none` on `body` (`globals.css`). Content components opt in with `user-select: text` individually.
2. **Runtime boundary enforcement** — SelectionGuard clips selection at card boundaries:
   - `handlePointerMove`: clamps selection focus to boundary edge via `caretPositionFromPointCompat`
   - `handleSelectionChange`: clips keyboard-driven selection (Shift+Arrow) that escapes
   - RAF-based autoscroll for overflow cards
3. **`data-tug-select` attribute API** — per-region control (see table above).

### Event Listeners

SelectionGuard installs five document-level listeners via `attach()`:

| Event | Phase | Purpose |
|-------|-------|---------|
| `pointerdown` | capture | Card activation, start drag tracking |
| `pointermove` | capture | Clamp selection to boundary during drag |
| `pointerup` | capture | Stop tracking |
| `selectionchange` | bubble | Clip escaped keyboard selections |
| `selectstart` | capture | Block selection from starting outside card boundaries |

### Card Switch

On card switch (`activateCard`):
1. Clone the old card's DOM Selection Range into `inactive-selection` highlight (dimmed)
2. Clear browser Selection
3. Restore new card's saved Range to browser Selection (native `::selection` paints it)
4. Install one-shot `mousedown` handler to prevent the click from collapsing the restored selection

### Internal State

| Field | Type | Purpose |
|-------|------|---------|
| `boundaries` | `Map<string, HTMLElement>` | Registered card content boundary elements |
| `inactiveRanges` | `Map<string, Range>` | Cloned Ranges for cards with dimmed selections |
| `activeCardId_highlight` | `string \| null` | The focused card |
| `inactiveHighlight` | `Highlight` | The `inactive-selection` CSS Highlight object |
| `isTracking` | `boolean` | Whether a pointer drag is in progress |
| `activeCardId` | `string \| null` | Card being tracked during drag |
| `lastPointerX/Y` | `number` | Last pointer position (for clamping and autoscroll) |

### Registration

Cards register via `useSelectionBoundary(cardId, contentRef)` → `selectionGuard.registerBoundary(cardId, element)` in `useLayoutEffect`. The boundary element is `.tugcard-content`.

### Save/Restore for Tab Switches

- `saveSelection(cardId)`: Serializes selection as index paths from boundary root. Tries live browser Selection first, falls back to `inactiveRanges`.
- `restoreSelection(cardId, saved)`: Resolves paths back to DOM nodes, calls `setBaseAndExtent`. Native `::selection` renders immediately.

### App Activation/Deactivation

- `deactivateApp()`: Clones active card's Selection into `inactive-selection`. Clears browser Selection. Called from Swift.
- `activateApp()`: Restores from `inactiveRanges`. Called from Swift.

---

## Relationship to Editing Components

SelectionGuard and editing components' selection models are separate systems:

| Component | Selection owner | SelectionGuard's role |
|-----------|----------------|----------------------|
| tug-markdown-view | Browser (DOM Selection) | Boundary enforcement only. Native `::selection` renders. |
| tug-prompt-input | TugTextEngine | Boundary enforcement only. `data-tug-select="custom"` exempts from clipping. Native `::selection` renders. |
| tug-input, tug-textarea, tug-value-input | Browser native | Boundary enforcement only. Native `::selection` renders. |

---

## ResponderChainProvider Document-Level Infrastructure

ResponderChainProvider installs several document-level listeners beyond SelectionGuard:

| Event | Phase | Purpose |
|-------|-------|---------|
| `pointerdown` | capture | First-responder promotion (skips `data-tug-focus="refuse"` controls) |
| `mousedown` | capture | Focus refusal (`preventDefault` on `data-tug-focus="refuse"` controls) |
| `focusin` | capture | First-responder promotion for keyboard Tab navigation |
| `contextmenu` | bubble | Fallback "No Actions" menu (suppresses native context menu) |
| `keydown` | capture + bubble | Four-stage keyboard pipeline |

---

## Files

| File | Role |
|------|------|
| `selection-guard.ts` | Boundary enforcer singleton |
| `hooks/use-selection-boundary.ts` | Hook to register/unregister card content boundaries |
| `responder-chain-provider.tsx` | Focus refusal, fallback context menu, SelectionGuard lifecycle |
| `use-copyable-text.tsx` | Hook for copyable components (right-click → Copy) |
| `tug-card.css` | `::selection` token rules, `::highlight(inactive-selection)`, `data-tug-select` attribute CSS |
| `globals.css` | `user-select: none` baseline on body |
| `tug-card.tsx` | Calls `useSelectionBoundary`, `saveSelection`, `restoreSelection` |
| `tug-label.tsx` | First consumer of `useCopyableText` (via `copyable` prop) |
