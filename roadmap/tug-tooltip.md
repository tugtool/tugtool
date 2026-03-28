# tug-tooltip — Roadmap Proposal

*Hover/focus tooltip wrapping `@radix-ui/react-tooltip`.*

---

## What It Is

A non-interactive popup that appears on hover or focus to provide supplementary information. The most common uses: labeling icon-only buttons, showing full text for truncated labels, and displaying keyboard shortcuts next to action names.

**Not** a popover (interactive content). Not a context menu. Just a read-only label that appears and disappears.

---

## Radix Primitive

`@radix-ui/react-tooltip` — **already installed** (^1.2.8).

### Parts We Wrap

| Radix Part | Our Element | Purpose |
|------------|-------------|---------|
| `Tooltip.Provider` | TugTooltipProvider | Shared delay config across the app |
| `Tooltip.Root` | Managed internally | Open/close state container |
| `Tooltip.Trigger` | Passed as `children` | The element that activates the tooltip |
| `Tooltip.Portal` | Always used | Renders tooltip in a portal |
| `Tooltip.Content` | The tooltip bubble | Positioned popup with text |
| `Tooltip.Arrow` | Optional arrow | Visual pointer to trigger |

### Key Radix Features We Get Free

- **Delay management**: `delayDuration` (default 700ms) and `skipDelayDuration` (300ms) — hover one tooltip, move to another and it opens instantly
- **Collision avoidance**: automatic repositioning when tooltip would overflow viewport
- **Positioning**: `side` (top/bottom/left/right), `sideOffset`, `align` (start/center/end)
- **Data attributes**: `data-state="delayed-open"|"instant-open"|"closed"`, `data-side`, `data-align`
- **CSS variables**: `--radix-tooltip-content-transform-origin` for directional animations
- **Keyboard**: opens on focus, closes on Escape
- **ARIA**: `role="tooltip"`, `aria-describedby` linking trigger to content

---

## Design Decisions

### D1: Inline API — One Component, Not Three

Tooltip usage should be dead simple. Rather than requiring callers to compose Root + Trigger + Content, we provide a single `TugTooltip` that wraps its children (the trigger) and takes the tooltip text as a prop.

```tsx
<TugTooltip content="Save document" shortcut="⌘S">
  <button>💾</button>
</TugTooltip>
```

Internally, TugTooltip renders Root + Trigger (with `asChild`) + Portal + Content. The child element becomes the trigger directly — no wrapper div.

### D2: TugTooltipProvider at App Root

Radix requires a `Tooltip.Provider` ancestor for shared delay behavior. We export `TugTooltipProvider` as a thin wrapper. It goes at the app root once, near `TugBoxProvider` or similar top-level providers.

```tsx
<TugTooltipProvider>
  <App />
</TugTooltipProvider>
```

Props: `delayDuration` (default 500ms — slightly faster than Radix's 700ms), `skipDelayDuration` (default 300ms).

### D3: Built-in Keyboard Shortcut Display

The `shortcut` prop accepts a string that renders as a styled `<kbd>` element alongside the tooltip text. This is the primary use case for tooltips in tugways — labeling buttons with their keyboard shortcut.

```tsx
<TugTooltip content="Bold" shortcut="⌘B">
  <TugPushButton>B</TugPushButton>
</TugTooltip>
```

Renders as: `Bold  ⌘B` where `⌘B` is in a muted kbd style.

Kbd styling uses tokens already defined in tug-dialog.css: `--tugx-kbd-fg`, `--tugx-kbd-bg`, `--tugx-kbd-border`. These will be moved/shared to tug-tooltip.css or referenced directly.

### D4: Positioning Props

Expose `side` and `align` directly. Defaults: `side="top"`, `align="center"`. Radix handles collision avoidance automatically.

`sideOffset` defaults to 6px (small gap between trigger and tooltip).

### D5: Arrow

Include the Radix arrow by default. A `arrow` prop (boolean, default true) controls whether it renders. The arrow gives visual connection between trigger and tooltip.

### D6: Animation via CSS Keyframes [L14]

Fade + slight scale entrance, fade-out on close. CSS `@keyframes` keyed on `data-state`:

```css
.tug-tooltip-content[data-state="delayed-open"],
.tug-tooltip-content[data-state="instant-open"] {
  animation: tug-tooltip-enter calc(100ms * var(--tug-timing, 1)) ease;
}

.tug-tooltip-content[data-state="closed"] {
  animation: tug-tooltip-exit calc(80ms * var(--tug-timing, 1)) ease;
}
```

Duration scales via `--tug-timing` for motion compliance [L13].

### D7: Token Strategy

Tooltip tokens already exist in tug-menu.css. We'll define them in tug-tooltip.css instead (they belong to the tooltip component, not menu):

| Element | Token | Purpose |
|---------|-------|---------|
| Background | `--tug7-surface-global-primary-normal-screen-rest` | Tooltip bubble bg |
| Text | `--tug7-element-global-text-normal-default-rest` | Tooltip text color |
| Border | `--tug7-element-global-border-normal-default-rest` | Subtle border |
| Kbd text | `--tug7-element-global-text-normal-muted-rest` | Muted shortcut text |
| Kbd bg | `--tug7-surface-global-primary-normal-default-rest` | Kbd badge surface |
| Kbd border | `--tug7-element-global-border-normal-default-rest` | Kbd badge border |
| Arrow fill | inherits tooltip bg | Arrow matches bubble |

No new theme tokens needed — all use existing base-tier tokens.

### D8: No Role Color Injection

Tooltips are informational, not interactive controls. No semantic role coloring. One appearance everywhere.

### D9: No Size Variants

One size. Tooltip text is always small (0.75rem / 12px). Kbd badges are slightly smaller. Padding is compact. If size variants prove necessary later they can be added, but tooltip content should be brief by nature.

### D10: Disabled Triggers

When the trigger element is disabled, the tooltip should still work — disabled buttons still need labels for accessibility. Radix handles this: the trigger uses `asChild` and keyboard/pointer events still reach the Tooltip.Trigger wrapper even when the child is `aria-disabled`.

---

## Props

### TugTooltipProvider

```typescript
export interface TugTooltipProviderProps {
  /** Delay before tooltip appears on hover.
   * @default 500 */
  delayDuration?: number;
  /** Window after closing where next tooltip opens instantly.
   * @default 300 */
  skipDelayDuration?: number;
  children: React.ReactNode;
}
```

### TugTooltip

```typescript
export interface TugTooltipProps {
  /** Tooltip text content. */
  content: React.ReactNode;
  /** Keyboard shortcut displayed as a <kbd> badge.
   * @selector .tug-tooltip-shortcut */
  shortcut?: string;
  /**
   * Which side of the trigger to place the tooltip.
   * @selector [data-side="top"] | [data-side="bottom"] | [data-side="left"] | [data-side="right"]
   * @default "top"
   */
  side?: "top" | "bottom" | "left" | "right";
  /**
   * Alignment along the side axis.
   * @selector [data-align="start"] | [data-align="center"] | [data-align="end"]
   * @default "center"
   */
  align?: "start" | "center" | "end";
  /** Distance from trigger in px. @default 6 */
  sideOffset?: number;
  /** Show the arrow pointer. @default true */
  arrow?: boolean;
  /** Override delay for this specific tooltip. */
  delayDuration?: number;
  /** Controlled open state. */
  open?: boolean;
  /** Controlled state callback. */
  onOpenChange?: (open: boolean) => void;
  /** The trigger element (wrapped with asChild). */
  children: React.ReactElement;
}
```

---

## CSS Structure

```
tug-tooltip.css:
  @tug-pairings table
  Component-tier aliases (body {})
  Keyframe animations (enter/exit)
  Content (.tug-tooltip-content) — bg, border, padding, typography, shadow
  Arrow (.tug-tooltip-arrow) — fill inherits bg
  Shortcut badge (.tug-tooltip-shortcut) — kbd styling
```

---

## File Plan

```
tugdeck/src/components/tugways/
  tug-tooltip.tsx     — TugTooltipProvider + TugTooltip
  tug-tooltip.css     — All styles

tugdeck/src/components/tugways/cards/
  gallery-tooltip.tsx — Gallery demo card

tugdeck/src/__tests__/
  tug-tooltip.test.tsx — Behavioral tests
```

Single file pair. Provider and Tooltip in one file (Provider is trivial — thin Radix wrapper).

---

## Gallery Card Sections

1. **Basic** — Text tooltip on a button, default position (top)
2. **Positioning** — Four buttons with side=top/bottom/left/right
3. **With Shortcut** — Tooltip showing label + keyboard shortcut badge
4. **Without Arrow** — arrow={false} for a cleaner look
5. **On Icon Buttons** — Tooltip labeling icon-only TugPushButtons (the primary use case)
6. **Alignment** — align=start/center/end on a wide trigger
7. **Disabled Trigger** — Tooltip on a disabled button (still shows)
8. **Rich Content** — content as ReactNode with multiple lines

---

## Dashes

Two dashes:

1. **Component implementation** — Build TugTooltipProvider + TugTooltip with full CSS, animation, shortcut badge. Wire up TugTooltipProvider at app root.
2. **Gallery card** — All 8 sections above, registered in component gallery

---

## Dependencies

- `@radix-ui/react-tooltip` — already installed
- Existing base-tier tokens — no new theme tokens needed
- Tooltip aliases currently in tug-menu.css should migrate to tug-tooltip.css (cleanup of existing code)
