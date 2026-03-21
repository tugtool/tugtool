# Token Naming

*Every `--tug-base-*` token follows a six-slot naming convention that makes classification, parsing, and contrast pairing mechanical.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md). `[L##]` → [laws-of-tug.md](laws-of-tug.md).*

---

## The Six Slots

```
--tug-base-<plane>-<component>-<constituent>-<emphasis>-<role>-<state>
```

All six slots are always present. No shortcuts, no omissions.

| Slot | Position | Purpose |
|------|----------|---------|
| **plane** | 1 | Is it a visible mark or the field behind it? |
| **component** | 2 | What UI component does it belong to? |
| **constituent** | 3 | What structural part of that component? |
| **emphasis** | 4 | How visually prominent? |
| **role** | 5 | What semantic purpose? |
| **state** | 6 | What interaction condition? |

---

## Slot Values

### Plane

Two values. Any tool can determine element/surface classification by reading slot 1.

| Value | Meaning | [L18] |
|-------|---------|-------|
| `element` | Visible marks: text, icons, borders, shadows, dividers, fills | `--tug-base-element-*` |
| `surface` | Fields behind elements: backgrounds, tracks | `--tug-base-surface-*` |

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

These rules make six-slot parsing deterministic:

**`disabled` is always a state, never a role.** Disabled tokens use `role=plain` with `state=disabled`. Example: `element-global-text-normal-plain-disabled`.

**`on`, `off`, `mixed`, `selected`, `highlighted` are roles, not states.** They describe persistent visual treatments that combine with interaction states. Example: `surface-toggle-track-normal-on-hover` (role=`on`, state=`hover`).

**Shadow sizes are roles.** The constituent is `shadow`; the size (`xs`, `md`, `lg`, `xl`, `overlay`) occupies the role slot. Example: `element-global-shadow-normal-xs-rest`.

**`link` is a role; interaction is a state.** Link text decomposes as `role=link` + `state=hover`. Example: `element-global-text-normal-link-hover`.

**Field text types are roles.** `label`, `placeholder`, and `required` are roles (persistent characteristics). `disabled` and `readOnly` are states. Example: `element-field-text-normal-label-rest`.

**Dual-slot values.** Some values appear in both role and state slots. `hover` is a role when it names a highlight surface's purpose (`surface-highlight-primary-normal-hover-rest`) and a state when it names an interaction condition (`element-global-text-normal-link-hover`). `mixed` is a role for toggle tracks (`surface-toggle-track-normal-mixed-rest`) and a state for checkmarks (`element-checkmark-icon-normal-plain-mixed`). The slot determines the meaning.

---

## Examples

```
element-global-text-normal-plain-rest         ← default body text
element-global-text-normal-subtle-rest        ← muted/secondary text
element-global-text-normal-link-hover         ← link text on hover
element-global-icon-normal-plain-rest         ← default icon color
element-global-border-normal-default-rest     ← standard border
element-global-shadow-normal-md-rest          ← medium shadow
element-global-fill-normal-accent-rest        ← accent fill color
element-control-text-filled-accent-rest       ← filled accent button text
element-control-text-filled-accent-hover      ← filled accent button text on hover
element-control-icon-outlined-action-rest     ← outlined action button icon
element-field-text-normal-label-rest          ← field label text
element-field-text-normal-plain-disabled      ← disabled field text
element-toggle-thumb-normal-plain-rest        ← toggle thumb
element-radio-dot-normal-plain-rest           ← radio dot
element-tone-fill-normal-success-rest         ← success tone fill
element-checkmark-icon-normal-plain-mixed     ← mixed-state checkmark

surface-global-primary-normal-app-rest        ← app background
surface-global-primary-normal-canvas-rest     ← canvas background
surface-global-primary-normal-raised-rest     ← elevated surface
surface-control-primary-filled-accent-rest    ← filled accent button bg
surface-control-primary-filled-accent-hover   ← filled accent button bg on hover
surface-toggle-track-normal-on-rest           ← toggle track (on)
surface-toggle-track-normal-off-hover         ← toggle track (off, hovered)
surface-overlay-primary-normal-dim-rest       ← overlay dim
surface-highlight-primary-normal-hover-rest   ← hover highlight
surface-highlight-primary-normal-flash-rest   ← flash highlight
```

---

## Contrast Pairing

A contrast pairing is an element token rendered on a surface token. The six-slot convention makes pairing extraction mechanical — split on `-`, read slot 1, and classify as element or surface. `audit-tokens pairings` validates all pairings against contrast thresholds. [L16, L18, D81, D83]
