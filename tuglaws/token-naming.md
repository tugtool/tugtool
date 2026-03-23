# Token Naming

*Every `--tug-*` token follows a seven-slot naming convention that makes classification, parsing, and contrast pairing mechanical.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md). `[L##]` → [laws-of-tug.md](laws-of-tug.md).*

---

## The Seven Slots

```
--<namespace>-<plane>-<component>-<constituent>-<emphasis>-<role>-<state>
```

All seven slots are always present. No shortcuts, no omissions.

| Slot | Position | Purpose |
|------|----------|---------|
| **namespace** | 0 | Identifies the design system. Always `tug`. |
| **plane** | 1 | Is it a visible mark or the field behind it? |
| **component** | 2 | What UI component does it belong to? |
| **constituent** | 3 | What structural part of that component? |
| **emphasis** | 4 | How visually prominent? |
| **role** | 5 | What semantic purpose? |
| **state** | 6 | What interaction condition? |

---

## Slot Values

### Namespace

One value. Slot 0 is always `tug`, identifying the token as part of the tug design system.

### Plane

Two values. Any tool can determine element/surface classification by reading slot 1.

| Value | Meaning | [L18] |
|-------|---------|-------|
| `element` | Visible marks: text, icons, borders, shadows, dividers, fills | `--tug-element-*` |
| `surface` | Fields behind elements: backgrounds, tracks | `--tug-surface-*` |

### Component

The UI component or system the token belongs to.

`global` · `control` · `tab` · `tabClose` · `tone` · `field` · `badge` · `selection` · `checkmark` · `toggle` · `radio` · `overlay` · `highlight`

### Constituent

The structural sub-part within a component. Different values are valid for each plane.

**Element constituents:** `text` · `icon` · `border` · `shadow` · `divider` · `fill` · `thumb` · `dot`

**Surface constituents:** `primary` · `track`

### Emphasis

How visually prominent the token renders. Maps to the emphasis axis of the emphasis×role matrix.

`normal` · `filled` · `outlined` · `ghost` · `tinted`

### Role

The semantic purpose of the token. This is the largest and most varied slot.

Roles fall into several categories:

**General:** `default` · `muted` · `subtle` · `plain` · `inverse` · `link` · `strong` · `separator`

**Accent/brand:** `accent` · `accentCool` · `accentSubtle` · `action` · `active`

**Signal:** `danger` · `success` · `caution` · `agent` · `data`

**On-surface:** `onAccent` · `onDanger` · `onSuccess` · `onCaution`

**Toggle/selection:** `on` · `off` · `mixed` · `selected` · `highlighted`

**Field text:** `label` · `placeholder` · `required`

**Shadow sizes:** `xs` · `md` · `lg` · `xl` · `overlay`

**Surface purposes:** `app` · `canvas` · `raised` · `sunken` · `inset` · `content` · `screen` · `control` · `dim` · `scrim`

**Highlight purposes:** `hover` · `dropTarget` · `preview` · `inspectorTarget` · `snapGuide` · `flash` · `highlight`

### State

The interaction condition. Every token has a state — non-interactive tokens use `rest`.

`rest` · `hover` · `active` · `focus` · `disabled` · `readOnly` · `mixed` · `inactive` · `collapsed`

---

## Classification Rules

These rules make seven-slot parsing deterministic:

**`disabled` is always a state, never a role.** Disabled tokens use `role=plain` with `state=disabled`. Example: `tug-element-global-text-normal-plain-disabled`.

**`on`, `off`, `mixed`, `selected`, `highlighted` are roles, not states.** They describe persistent visual treatments that combine with interaction states. Example: `tug-surface-toggle-track-normal-on-hover` (role=`on`, state=`hover`).

**Shadow sizes are roles.** The constituent is `shadow`; the size (`xs`, `md`, `lg`, `xl`, `overlay`) occupies the role slot. Example: `tug-element-global-shadow-normal-xs-rest`.

**`link` is a role; interaction is a state.** Link text decomposes as `role=link` + `state=hover`. Example: `tug-element-global-text-normal-link-hover`.

**Field text types are roles.** `label`, `placeholder`, and `required` are roles (persistent characteristics). `disabled` and `readOnly` are states. Example: `tug-element-field-text-normal-label-rest`.

**Dual-slot values.** Some values appear in both role and state slots. `hover` is a role when it names a highlight surface's purpose (`tug-surface-highlight-primary-normal-hover-rest`) and a state when it names an interaction condition (`tug-element-global-text-normal-link-hover`). `mixed` is a role for toggle tracks (`tug-surface-toggle-track-normal-mixed-rest`) and a state for checkmarks (`tug-element-checkmark-icon-normal-plain-mixed`). The slot determines the meaning.

---

## Examples

```
tug-element-global-text-normal-plain-rest         ← default body text
tug-element-global-text-normal-subtle-rest        ← muted/secondary text
tug-element-global-text-normal-link-hover         ← link text on hover
tug-element-global-icon-normal-plain-rest         ← default icon color
tug-element-global-border-normal-default-rest     ← standard border
tug-element-global-shadow-normal-md-rest          ← medium shadow
tug-element-global-fill-normal-accent-rest        ← accent fill color
tug-element-control-text-filled-accent-rest       ← filled accent button text
tug-element-control-text-filled-accent-hover      ← filled accent button text on hover
tug-element-control-icon-outlined-action-rest     ← outlined action button icon
tug-element-field-text-normal-label-rest          ← field label text
tug-element-field-text-normal-plain-disabled      ← disabled field text
tug-element-toggle-thumb-normal-plain-rest        ← toggle thumb
tug-element-radio-dot-normal-plain-rest           ← radio dot
tug-element-tone-fill-normal-success-rest         ← success tone fill
tug-element-checkmark-icon-normal-plain-mixed     ← mixed-state checkmark

tug-surface-global-primary-normal-app-rest        ← app background
tug-surface-global-primary-normal-canvas-rest     ← canvas background
tug-surface-global-primary-normal-raised-rest     ← elevated surface
tug-surface-control-primary-filled-accent-rest    ← filled accent button bg
tug-surface-control-primary-filled-accent-hover   ← filled accent button bg on hover
tug-surface-toggle-track-normal-on-rest           ← toggle track (on)
tug-surface-toggle-track-normal-off-hover         ← toggle track (off, hovered)
tug-surface-overlay-primary-normal-dim-rest       ← overlay dim
tug-surface-highlight-primary-normal-hover-rest   ← hover highlight
tug-surface-highlight-primary-normal-flash-rest   ← flash highlight
```

---

## Contrast Pairing

A contrast pairing is an element token rendered on a surface token. The seven-slot convention makes pairing extraction mechanical — split on `-`, read slot 0 for the namespace, slot 1 for the plane, and classify as element or surface. Every `--tug-*` element token has a corresponding surface token it renders on. `audit-tokens pairings` validates all pairings against contrast thresholds. [L16, L18, D81, D83]
