# Component Authoring Guide

*How to build a tugways component. Every component follows this guide exactly — no exceptions, no shortcuts. Consistency is the product.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md). `[L##]` → [laws-of-tug.md](laws-of-tug.md). `[P##]` → [color-palette.md](color-palette.md). `[T##]` → [token-naming.md](token-naming.md).*

---

## Scope Boundary (This Pass)

The current theme simplification pass does **not** rewrite every existing component token contract.

- Keep existing component contracts stable unless a component-level change is explicitly required.
- Do not introduce new ad-hoc theme logic in TSX/JS (no local recipe objects, no derivation helpers, no one-off color math).
- New theme behavior must come from `--tug-*` tokens and CSS cascade only.

---

## Files

Every component produces exactly two files in `components/tugways/`:

```
tug-{name}.tsx    — component implementation
tug-{name}.css    — all styles
```

One component per file pair. No sub-directories, no barrel exports, no index files. The file name is the component name in kebab-case with the `tug-` prefix.

---

## TSX Structure

Every `.tsx` file follows this structure in this order:

```
1. Module docstring
2. CSS import
3. Library imports
4. Internal imports
5. Constants
6. Props interface (exported)
7. Component (exported)
8. Sub-components (if any, banner-delimited)
```

### Module Docstring

Opens every file. States what the component does, not how it evolved.

```typescript
/**
 * TugSwitch — Toggle switch with track and thumb.
 *
 * Wraps @radix-ui/react-switch. Supports size variants, inline label,
 * disabled state, and role-based color injection.
 *
 * Laws: [L06] appearance via CSS, [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide
 * Decisions: [D05] component token naming
 */
```

Rules:
- First line: component name and one-sentence purpose
- Second paragraph: implementation details (what it wraps, what it supports)
- Laws and Decisions: cite every law and decision the component obeys
- No history, no "Phase N", no "replaces X", no spec references from plans

**Standardized citation set:** Every component docstring must cite the minimum set of governing laws:

| Citation | Meaning | Required For |
|----------|---------|-------------|
| [L06] | Appearance changes via CSS/DOM, never React state | All components |
| [L15] | Token-driven states; color transitions only | Interactive controls |
| [L16] | Every foreground rule declares its rendering surface | Components with CSS |
| [L19] | Component authoring guide | All components |

Add component-specific laws on top of this minimum (e.g., [L11] for controls that emit actions, [L09] for card composition).

**Plan spec references are prohibited.** Docstrings must cite tuglaws (`[L##]`) and design decisions (`[D##]`) only. References like `Spec S04` or `Spec S##` are implementation history from plan artifacts — they are not governing law and must not appear in module docstrings.

### Props Interface

Exported. Extends native HTML element props when wrapping a native element. JSDoc on every non-obvious prop. Use `@selector` to document the CSS selector for stateful props.

```typescript
export interface TugSwitchProps {
  /** Whether the switch is on. @selector [data-state="checked"] */
  checked?: boolean;
  /** Callback when toggled. */
  onCheckedChange?: (checked: boolean) => void;
  /** Inline label text. */
  label?: string;
  /** Visual size. @default "md" */
  size?: "sm" | "md" | "lg";
  /** Semantic role for color injection. @default "accent" */
  role?: "accent" | "action" | "agent" | "data" | "success" | "caution" | "danger" | "option";
  /** @selector [aria-disabled="true"] */
  disabled?: boolean;
}
```

Rules:
- Extend `React.ComponentPropsWithoutRef<'element'>` for native wrappers
- Omit and redefine props whose semantics change (e.g., `role`, `size`)
- `@selector` annotations map props to CSS selectors — this is how styling agents find the right hook
- `@default` annotations document defaults

**`@selector` is mandatory for every CSS-targetable prop.** A prop is CSS-targetable if its value affects which CSS selector applies — data attributes, class variants, pseudo-classes. The `@selector` annotation is the bridge between the TSX API and the CSS: it tells a coding agent exactly which selector to write when styling a prop's visual effect.

Patterns from the reference implementations (tug-checkbox.tsx):

```typescript
/**
 * Controlled checked state. Supports true, false, or "indeterminate".
 * @selector [data-state="checked"] | [data-state="unchecked"] | [data-state="indeterminate"]
 */
checked?: TugCheckedState;

/**
 * Visual size variant.
 * @selector .tug-checkbox-size-sm | .tug-checkbox-size-md | .tug-checkbox-size-lg
 * @default "md"
 */
size?: TugCheckboxSize;

/**
 * Disables the checkbox.
 * @selector :disabled | [data-disabled]
 * @default false
 */
disabled?: boolean;

/**
 * Semantic role for the checked/indeterminate on-state color.
 * @selector [data-role="<role>"]
 * @default "option"
 */
role?: TugCheckboxRole;
```

Props that do **not** need `@selector`:
- Callback props (`onCheckedChange`, `onClick`, `onChange`)
- String data props (`name`, `value`, `aria-label`)
- `className` — always passed through to `cn()`, no selector needed

### Component

Use `React.forwardRef` for any component that wraps a DOM element or Radix primitive. Name the function explicitly (provides displayName for DevTools).

```typescript
export const TugSwitch = React.forwardRef<HTMLButtonElement, TugSwitchProps>(
  function TugSwitch({ checked, onCheckedChange, label, size = "md", role = "accent", disabled, ...rest }, ref) {
    // ...
    return (
      <Switch.Root
        ref={ref}
        data-slot="tug-switch"
        className={cn("tug-switch", `tug-switch-${size}`)}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        {...rest}
      >
        <Switch.Thumb className="tug-switch-thumb" />
      </Switch.Root>
    );
  }
);
```

Rules:
- `data-slot="tug-{name}"` on the root element — always. This is the stable semantic anchor for CSS and tooling.
- `className` via `cn()` (from `lib/utils.ts`) — composes base class, size variant, and caller's className
- Spread `...rest` last to allow prop overrides
- No React state for appearance [L06]. All visual changes via CSS custom properties, classes, or data attributes.
- Functional components (no refs needed) skip `forwardRef` but still get `data-slot`

### Sub-Components

When a component has distinct structural parts (e.g., a group wrapper), define them in the same file, separated by banner comments:

```typescript
/* ---------------------------------------------------------------------------
 * TugRadioItem
 * ---------------------------------------------------------------------------*/

export interface TugRadioItemProps { /* ... */ }

export const TugRadioItem = React.forwardRef<HTMLButtonElement, TugRadioItemProps>(
  function TugRadioItem(props, ref) { /* ... */ }
);
```

---

## CSS Structure

Every `.css` file follows this structure in this order:

```
1. @tug-pairings table
2. Base styles (.tug-{name})
3. Sub-element styles (.tug-{name}-{part})
4. Size variants (.tug-{name}-sm, -md, -lg)
5. State selectors (rest → hover → active → focus → disabled)
6. Variant styles (emphasis × role, validation states, etc.)
```

### @tug-pairings Table

Opens every CSS file. Declares every foreground-on-background relationship the component creates. Machine-readable by `audit-tokens lint`. [L16]

**Both formats are required** — the compact block for tooling, the expanded table for human and agent readability.

**Compact block** (machine-readable — what `audit-tokens lint` parses):

```css
/* @tug-pairings {
  --tug7-element-checkmark-icon-normal-plain-rest  | --tug7-surface-toggle-track-normal-on-rest  | control
  --tug7-element-field-text-normal-label-rest      | --tug7-surface-global-primary-normal-default-rest | content
} */
```

Format: `element-token | surface-token | contrast-role`

**Expanded table** (human/agent-readable — documents the CSS context):

```css
/**
 * @tug-pairings
 * | Element                              | Surface                              | Role    | Context                          |
 * |--------------------------------------|--------------------------------------|---------|----------------------------------|
 * | --tug7-element-checkmark-icon-...rest  | --tug7-surface-toggle-track-...rest   | control | .tug-checkbox-indicator (color)  |
 * | --tug7-element-field-text-...rest      | --tug7-surface-global-primary-...rest | content | .tug-checkbox-label (color)      |
 */
```

The **Context column** is the key addition in the expanded table. It specifies exactly which CSS rule creates the pairing (`selector (property)`). A coding agent reading the pairings table can navigate directly to the rule that needs attention.

**Components with no contrast pairings** (decorative or animation-only components) still open with the annotation so tooling knows the absence is intentional:

```css
/* @tug-pairings: none — decorative/animation only, no foreground-on-background contrast */
```

### @tug-renders-on Annotations

Every CSS rule that sets `color`, `fill`, `stroke`, or `border-color` without setting `background-color` in the same rule must include this annotation: [L16]

```css
/* @tug-renders-on: --tug7-surface-global-primary-normal-default-rest */
.tug-label {
  color: var(--tug7-element-field-text-normal-label-rest);
}
```

### @tug-effects Declaration

Components that use effect-plane tokens (`--tug7-effect-*`) declare them in a separate `@tug-effects` block in the CSS file header, after `@tug-pairings`. Effect tokens carry non-color values — amounts, blend modes, opacity levels — and do not participate in contrast pairing.

```css
/* @tug-effects {
  --tug7-effect-card-desat-normal-dim-inactive     | desaturation overlay color
  --tug7-effect-card-desat-normal-amount-inactive   | desaturation intensity (0-1)
  --tug7-effect-card-wash-normal-dim-inactive       | wash overlay color
  --tug7-effect-card-wash-normal-blend-inactive     | wash blend mode
} */
```

Format: `token | description`. No contrast role — effect tokens define rendering parameters, not rendered colors.

Most components will not have effect tokens. Include this section only when the component uses the `effect` plane.

### Token Usage

All colors come from `--tug-*` tokens. Never hardcode colors. [L15, T##]

```css
/* Correct */
.tug-input { background-color: var(--tug7-surface-field-primary-normal-plain-rest); }

/* Wrong */
.tug-input { background-color: oklch(0.15 0.01 260); }
```

**Tokens must match what they're applied to.** The seven-slot naming system encodes what a token is *for* — the plane (`element` vs `surface`), the constituent (`text` vs `fill` vs `border`), and the component (`control` vs `field` vs `toggle`). A token applied to a CSS property must make semantic sense:

- A control fill or background → use a `surface` token, not a `text` token
- A border → use a `border` token, not a `fill` token
- A checkbox on-state → use a `toggle-track` surface token, not a `text-muted` token

If a token's seven-slot name doesn't describe what it's actually styling, the pairing is wrong — even if the color happens to look right. The naming system makes mismatches visible: a `text` token controlling a checkbox fill is immediately suspect to any agent reading the code. Use this as a smell test during review.

### Component-Tier Alias Rules

Some components define short `--tugx-{component}-*` aliases that resolve to base-tier `--tug7-*` tokens. The decision rule:

- **Use base tokens directly** when the component is simple (fewer than 5 token references) and the seven-slot names are clear in context. Checkbox, switch, input, label, badge, skeleton, and marquee all use this pattern.
- **Use component-tier aliases** when the component is complex — many sub-parts, many tokens, or tokens referenced from multiple CSS rules — and shorter aliases improve readability. Card and tab-bar use this pattern.

When aliases are used, define them in `body {}` at the top of the CSS file, after `@tug-pairings` and before base styles. Every alias must resolve to a base-tier `--tug7-*` token in **one hop**. [L17]

```css
body {
  /* Card aliases — resolve to base tier in one hop [L17] */
  --tugx-card-border: var(--tug7-element-global-border-normal-default-rest);
  --tugx-card-bg: var(--tug7-surface-global-primary-normal-overlay-rest);
}
```

Never chain aliases (`--tugx-card-bg: var(--tugx-card-other-alias)`) — that is a second hop and violates [L17].

### State Selectors

States progress in a consistent order. Interactive controls lighten progressively: rest (darkest) → hover → active (lightest). [L15]

```css
.tug-button { /* rest */ }
.tug-button:hover { /* hover */ }
.tug-button:active { /* active */ }
.tug-button:focus-visible { /* focus ring */ }
.tug-button:disabled,
.tug-button[aria-disabled="true"] { /* disabled */ }
```

Radix components use `[data-state="checked"]`, `[data-state="open"]`, etc. Combine with interaction states:

```css
.tug-switch[data-state="checked"]:hover { /* checked + hovered */ }
```

### Naming Convention

- Block: `.tug-{name}` — root element
- Part: `.tug-{name}-{part}` — sub-elements (thumb, indicator, track, label)
- Size: `.tug-{name}-{size}` — sm, md, lg
- Variant: `.tug-{name}-{emphasis}-{role}` — for emphasis × role components

---

## Component Patterns

### Emphasis × Role

For components with multiple visual emphases (filled, outlined, ghost) crossed with semantic roles (accent, action, danger, etc.). Each combination maps to a compound CSS class that selects the right tokens.

**When to use:** Buttons, badges — components where the same structural element renders in visually distinct emphasis levels with semantic color meaning.

**Implementation:**
- Props: `emphasis` and `role` (or combined into a variant prop)
- CSS class: `.tug-{name}-{emphasis}-{role}`
- Tokens: `--tug7-surface-control-primary-{emphasis}-{role}-{state}` for backgrounds, `--tug7-element-control-{constituent}-{emphasis}-{role}-{state}` for foregrounds

### Role Color Injection

For selection controls where a single structural design takes on different role colors via CSS custom property injection, without re-rendering.

**When to use:** Checkboxes, switches, radio buttons — controls where the visual structure is identical across roles but the active/on color changes.

**Implementation:**
- Prop: `role` with a default (typically `"accent"`)
- CSS fallback: `var(--tug-toggle-on-color, var(--tug7-surface-toggle-track-normal-on-rest))`
- JS injection: set `--tug-toggle-on-color` as an inline style to the role's tone token
- Three branches: default role (neutral color), non-default roles (tone map lookup), accent (no injection, CSS default)
- This is pure appearance-zone work [L06] — no React state, no re-render

### Compositional Components

For components that produce no visual output of their own, but compose two or more tugways components into a unified API.

**When to use:** When a common composition pattern (e.g., TugPopupMenu + TugButton) warrants a dedicated component to reduce caller boilerplate, but the visual identity is fully owned by the child components.

**Implementation:**
- Produces only a `.tsx` file — no `.css` file.
- Documents delegation in its module docstring: which child components it renders and which styling responsibilities are delegated to them.
- Does not need `@tug-pairings` — its children own the pairings.
- Still needs: exported props interface with JSDoc, `data-slot` on the root element, and law citations.
- Use a plain function (not `forwardRef`) unless a ref to the DOM root is needed.

```typescript
/**
 * TugPopupButton — Convenience popup button composing TugPopupMenu + TugButton.
 *
 * Styling delegated to TugButton (trigger appearance) and TugPopupMenu (dropdown).
 * No component CSS — this is a pure composition.
 *
 * Laws: [L11] controls emit actions, [L19] authoring guide
 */
```

### Field Controls

For form inputs that follow the field token family.

**When to use:** Text inputs, textareas, selects — form fields with rest/hover/focus/disabled/readOnly states and optional validation.

**Implementation:**
- Tokens: `--tug7-surface-field-primary-*` for backgrounds, `--tug7-element-field-{text,border}-*` for foregrounds
- States: rest → hover → focus → disabled → readOnly
- Validation: `[aria-invalid="true"]` overrides border color (but not focus state)
- Size variants via class

---

## Accessibility

Every component must be accessible. This is not optional.

### Keyboard Navigation

- All interactive elements reachable via Tab
- Enter/Space activate buttons and toggles
- Arrow keys navigate within groups (radio, select, tabs)
- Escape closes overlays
- Focus ring visible on `:focus-visible` only (not on click)

### ARIA

- Radix wrappers inherit ARIA from the primitive — don't duplicate
- Native wrappers: add `aria-invalid`, `aria-disabled`, `aria-required` as appropriate
- Every interactive element must have an accessible name (`aria-label`, associated label, or visible text)
- `aria-disabled="true"` (not HTML `disabled`) for chain-action controls that must remain in the tab order [D06]

### Data Attributes

Components emit data attributes for external styling and tooling:

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `data-slot` | Stable semantic identifier | `data-slot="tug-button"` |
| `data-state` | Radix state | `data-state="checked"` |
| `data-role` | Semantic role variant | `data-role="danger"` |
| `data-size` | Size variant | `data-size="sm"` |

---

## Testing

Tests verify behavior, not values. [See test trimming principles.]

### What to Test

- Component renders without throwing
- Keyboard interaction works (Tab, Enter, Space, Escape)
- Prop changes produce correct DOM state (disabled → `aria-disabled`, checked → `data-state`)
- Callbacks fire on interaction
- Role injection produces correct inline style

### What NOT to Test

- Exact token values or CSS output
- Exact class names
- Snapshot tests
- Pixel-level rendering
- Internal implementation details

### Test File Location

```
src/__tests__/tug-{name}.test.tsx
```

Import `./setup-rtl` first, then `bun:test`, then `@testing-library/react`.

---

## Checklist

Before a component is done:

- [ ] `.tsx` follows the TSX structure (docstring, props, forwardRef, data-slot)
- [ ] `.css` follows the CSS structure (@tug-pairings, @tug-renders-on, base → states → variants)
- [ ] All colors via `--tug-*` tokens, zero hardcoded colors
- [ ] Every token matches what it styles: surface tokens for fills/backgrounds, border tokens for borders, text tokens for text — no semantic mismatches
- [ ] No ad-hoc theme logic in component TSX/JS
- [ ] `data-slot="tug-{name}"` on root element
- [ ] Module docstring cites minimum law set ([L06], [L15] if interactive, [L16] if CSS, [L19]) plus any component-specific laws; no `Spec S##` references
- [ ] Props interface exported with JSDoc; every CSS-targetable prop has `@selector` annotation
- [ ] `@tug-pairings` present in both compact and expanded-table formats; components with no pairings use `@tug-pairings: none`
- [ ] Component-tier aliases (if used) defined in `body {}` and resolve to base tokens in one hop [L17]
- [ ] `@tug-effects` block present if the component uses `--tug7-effect-*` tokens
- [ ] Compositional components (no CSS): delegation documented in module docstring; no `@tug-pairings` needed
- [ ] Keyboard accessible (Tab, Enter/Space, Escape)
- [ ] `bun run build` exits 0
- [ ] `bun run test` exits 0
- [ ] `bun run audit:tokens lint` exits 0
- [ ] Renders correctly in Component Gallery across themes

---

## Reference: Token Naming

Tokens follow the seven-slot convention from [token-naming.md](token-naming.md):

```
--<namespace>-<plane>-<component>-<constituent>-<emphasis>-<role>-<state>
```

| Slot | Purpose |
|------|---------|
| namespace | Always `tug7`. Identifies the design system and seven-slot convention. |
| plane | `element` (visible marks) or `surface` (backgrounds) |
| component | `global`, `control`, `field`, `toggle`, `badge`, etc. |
| constituent | `text`, `icon`, `border`, `shadow`, `primary`, `track`, etc. |
| emphasis | `normal`, `filled`, `outlined`, `ghost`, `tinted` |
| role | `default`, `accent`, `action`, `danger`, `success`, etc. |
| state | `rest`, `hover`, `active`, `focus`, `disabled` |

## Reference: Laws That Govern Components

| Law | Summary | Applies To |
|-----|---------|------------|
| [L01] | One `root.render()`, ever | All components |
| [L02] | External state via `useSyncExternalStore` only | Components reading stores |
| [L03] | `useLayoutEffect` for registrations events depend on | Responder participants |
| [L06] | Appearance changes via CSS/DOM, never React state | All components |
| [L15] | Token-driven control states; color transitions only | Interactive controls |
| [L16] | Every foreground rule declares its rendering surface | All CSS files |
| [L17] | Component aliases (`--tugx-*`) resolve to `--tug7-*` in one hop | Component-tier tokens |
| [L18] | Element/surface vocabulary | All token usage |
