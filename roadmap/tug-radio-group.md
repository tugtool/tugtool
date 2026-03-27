# tug-radio-group

*Mutually exclusive selection from a set of options. Circle-and-dot indicator with label, following the Apple HIG radio button pattern.*

---

## Design

TugRadioGroup wraps `@radix-ui/react-radio-group` (already installed) for accessibility and arrow-key navigation. Each item is a TugButton (ghost emphasis) that hosts a **radio circle indicator** and a label. The circle follows the traditional pattern: empty circle when unselected, filled circle with centered dot when selected.

TugButton provides the click target, sizing, hover/active states, and disabled treatment. The radio circle indicator is a CSS-styled `<span>` inside the button — its colors come from dedicated `radio` component tokens, giving each theme full control over the indicator's appearance independently of button colors.

### Anatomy

```
TugRadioGroup (root — Radix RadioGroup.Root, flex container)
└── TugRadioItem (× N — Radix RadioGroup.Item via asChild onto TugButton)
    ├── radio circle indicator (span, CSS-styled)
    │   └── dot (inner span, visible when checked)
    └── label text (children)
```

### How `asChild` Works

Radix `RadioGroup.Item` normally renders its own `<button>`. TugButton also renders a `<button>`. We can't nest buttons — invalid HTML. Radix's `asChild` prop says "don't render your own element; merge your props (aria attributes, data-state, keyboard handlers, click handler) onto the child element instead." So each radio item is a single `<button>` in the DOM that gets both Radix's radio behavior and TugButton's visual rendering.

### How It Differs from tug-segmented-choice

| | tug-radio-group | tug-segmented-choice |
|---|---|---|
| Indicator | Circle + dot (traditional radio) | Sliding highlight within unified frame |
| Layout | Row or column | Row only |
| Use case | Settings, form fields, option lists | Mode switching, view toggles |

---

## Props

### TugRadioGroup

```typescript
export type TugRadioGroupSize = "sm" | "md" | "lg";

export interface TugRadioGroupProps {
  /** Current selected value. @selector [data-state] on items */
  value?: string;
  /** Uncontrolled default value. */
  defaultValue?: string;
  /** Fires when selection changes. */
  onValueChange?: (value: string) => void;
  /** Layout direction. @selector .tug-radio-group-horizontal | .tug-radio-group-vertical @default "vertical" */
  orientation?: "horizontal" | "vertical";
  /** Visual size for all items. @selector .tug-radio-group-sm | -md | -lg @default "md" */
  size?: TugRadioGroupSize;
  /** Semantic role color for the selected indicator. @selector [data-role] */
  role?: TugRadioRole;
  /** Disables all items. @selector [data-disabled] */
  disabled?: boolean;
  /** Group label for accessibility. */
  "aria-label"?: string;
}
```

### TugRadioItem

```typescript
export interface TugRadioItemProps {
  /** The value this item represents. Required. */
  value: string;
  /** Label text. */
  children: React.ReactNode;
  /** Disables this item individually. @selector :disabled | [data-disabled] */
  disabled?: boolean;
}
```

---

## Visual Behavior

**Unselected:** Empty circle with border. Ghost button for the click target — no visible button chrome, just the circle and label.

**Selected:** Circle fills with the role color (default: accent). White dot centered inside. Radix sets `data-state="checked"` on the item.

**Hover:** Circle border lightens (standard rest → hover progression). TugButton provides the overall hover feedback on the click target area.

**Disabled:** Standard opacity treatment via TugButton. Circle and dot inherit the disabled state.

**Focus:** Arrow keys move selection between items (Radix handles this). `:focus-visible` ring on the button.

---

## Token Strategy

The radio indicator gets its own component tokens following the seven-slot convention. The `radio` component and `dot` constituent already exist in token-naming.md.

### Radio-Specific Tokens

**Indicator circle (surface — the fill behind the dot):**
```
--tug7-surface-radio-primary-normal-off-rest       ← unselected circle bg
--tug7-surface-radio-primary-normal-off-hover      ← unselected circle bg, hovered
--tug7-surface-radio-primary-normal-on-rest        ← selected circle bg (accent)
--tug7-surface-radio-primary-normal-on-hover       ← selected circle bg, hovered
--tug7-surface-radio-primary-normal-on-disabled    ← selected circle bg, disabled
```

**Indicator border (element):**
```
--tug7-element-radio-border-normal-off-rest        ← unselected circle border
--tug7-element-radio-border-normal-off-hover       ← unselected circle border, hovered
--tug7-element-radio-border-normal-off-disabled    ← unselected circle border, disabled
```

**Dot (element — the centered dot inside the selected circle):**
```
--tug7-element-radio-dot-normal-plain-rest         ← dot color (white/bright)
--tug7-element-radio-dot-normal-plain-disabled     ← dot color, disabled
```

**Role injection:** Same pattern as checkbox/switch. The on-state surface tokens accept role variants via inline CSS custom property injection:
```typescript
"--tugx-radio-on-color": `var(--tug7-surface-radio-primary-normal-${tokenSuffix}-rest)`
```

### Contrast Pairings

| Element | Surface | Role | Context |
|---------|---------|------|---------|
| `--tug7-element-radio-dot-*` | `--tug7-surface-radio-primary-normal-on-*` | control | dot on filled circle |
| `--tug7-element-radio-border-*` | `--tug7-surface-radio-primary-normal-off-*` | control | circle border on circle bg |

Label text pairings are inherited from TugButton (ghost emphasis).

---

## CSS Structure

```css
/* @tug-pairings {
  --tug7-element-radio-dot-normal-plain-rest     | --tug7-surface-radio-primary-normal-on-rest  | control
  --tug7-element-radio-border-normal-off-rest    | --tug7-surface-radio-primary-normal-off-rest | control
} */

/* Layout */
.tug-radio-group { display: flex; }
.tug-radio-group-horizontal { flex-direction: row; }
.tug-radio-group-vertical { flex-direction: column; }

/* Indicator circle */
.tug-radio-indicator { /* circle dimensions, border, border-radius: 50% */ }
.tug-radio-dot { /* centered dot, hidden by default */ }

/* States — driven by Radix data-state on the parent item */
[data-state="checked"] .tug-radio-indicator { /* filled with role color */ }
[data-state="checked"] .tug-radio-dot { /* visible */ }

/* Sizes */
.tug-radio-group-sm .tug-radio-indicator { /* smaller circle */ }
.tug-radio-group-md .tug-radio-indicator { /* default circle */ }
.tug-radio-group-lg .tug-radio-indicator { /* larger circle */ }
```

---

## Keyboard Navigation

Handled by Radix RadioGroup:

- **Arrow Left/Up:** Previous item
- **Arrow Right/Down:** Next item
- **Tab:** Moves focus into/out of group (not between items)

No custom keyboard handling needed.

---

## Implementation Notes

1. **TugButton as host.** Each TugRadioItem uses `asChild` on `RadioGroup.Item` to merge Radix's radio props onto a TugButton rendered with `ghost` emphasis and `subtype="icon-text"`. The radio circle indicator occupies the icon slot position (leading). This gives consistent sizing, spacing, and interaction feedback across all tugways controls.

2. **Role injection.** Same pattern as checkbox/switch: compute `tokenSuffix` from the `role` prop, inject `--tugx-radio-on-color` and related custom properties as inline styles. CSS references these for the selected indicator color. Default is accent.

3. **Size propagation.** Group-level `size` flows to TugButton and to the indicator circle dimensions. Use React context so items don't need explicit size props.

4. **No label wrapper needed.** Unlike checkbox/switch which optionally wrap in a `<label>`, radio items get their label as button content. The TugButton *is* the label's click target. Radix handles the accessibility association.

---

## Files

```
tugdeck/src/components/tugways/tug-radio-group.tsx   — TugRadioGroup + TugRadioItem
tugdeck/src/components/tugways/tug-radio-group.css   — Indicator + layout styles
tugdeck/src/components/gallery/gallery-radio-group.tsx — Gallery card
```

---

## Checklist

- [ ] Wraps `@radix-ui/react-radio-group` (already installed)
- [ ] Each item is a TugButton (ghost, via asChild) with radio circle indicator
- [ ] Circle-and-dot indicator: empty circle unselected, filled circle + dot selected
- [ ] Own radio component tokens (`--tug7-{surface,element}-radio-*`)
- [ ] Role color injection for selected state (same pattern as checkbox/switch)
- [ ] Horizontal and vertical orientation
- [ ] Size variants (sm, md, lg) propagated via context
- [ ] Individual item disable + group-level disable
- [ ] `data-slot="tug-radio-group"` on root, `data-slot="tug-radio-item"` on items
- [ ] `@tug-pairings` with radio-specific contrast pairings
- [ ] Gallery card with representative examples
- [ ] `bun run build` passes
- [ ] `bun run audit:tokens lint` passes
