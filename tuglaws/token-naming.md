# Token Naming

*Every design-system CSS custom property uses a prefix that declares its kind, making classification instant and unambiguous.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md). `[L##]` → [laws-of-tug.md](laws-of-tug.md).*

---

## Prefix System

All `--tug*-` CSS custom properties use one of four prefixes:

| Prefix | Kind | Parse Rule | Examples |
|--------|------|-----------|---------|
| `--tug7-` | Seven-slot semantic token | Always 7 segments after prefix. Machine-parseable. | `--tug7-element-global-text-normal-plain-rest` |
| `--tugc-` | Color palette | Hue constants, named grays, global anchors. | `--tugc-red-h`, `--tugc-gray-ink`, `--tugc-l-dark` |
| `--tugx-` | Extension | Component aliases, shared utilities. Locally defined. | `--tugx-card-border`, `--tugx-control-disabled-opacity` |
| `--tug-` | Scale / dimension | Spacing, radius, motion, font, icon sizes. Simple global values. | `--tug-space-md`, `--tug-radius-lg`, `--tug-motion-duration-fast` |

An agent seeing a CSS custom property classifies it instantly by prefix:
- **`--tug7-`** → Seven-slot token. Split on `-`, read the 7 slots. Look up in this document.
- **`--tugc-`** → Palette color. Defined in `tug-palette.css`. Never component-scoped.
- **`--tugx-`** → Extension. Trace to its definition — component CSS `body {}` block or shared utility file.
- **`--tug-`** → Scale. Global dimensional value. Never ambiguous with the above.

No counting hyphens. No tracing. No guessing.

---

## The Seven Slots

```
--<namespace>-<plane>-<component>-<constituent>-<emphasis>-<role>-<state>
```

All seven slots are always present. No shortcuts, no omissions.

| Slot | Position | Purpose |
|------|----------|---------|
| **namespace** | 0 | Identifies the design system. Always `tug7` for seven-slot tokens. |
| **plane** | 1 | Is it a visible mark or the field behind it? |
| **component** | 2 | What UI component does it belong to? |
| **constituent** | 3 | What structural part of that component? |
| **emphasis** | 4 | How visually prominent? |
| **role** | 5 | What semantic purpose? |
| **state** | 6 | What interaction condition? |

---

## Slot Values

### Namespace

One value. Slot 0 is always `tug7` for seven-slot semantic tokens, identifying them as part of the tug design system with the seven-slot naming convention.

### Plane

Three values. Any tool can determine element/surface/effect classification by reading slot 1.

| Value | Meaning | [L18] |
|-------|---------|-------|
| `element` | Visible marks: text, icons, borders, shadows, dividers, fills | `--tug7-element-*` |
| `surface` | Fields behind elements: backgrounds, tracks | `--tug7-surface-*` |
| `effect` | Visual effect parameters: filter colors, amounts, blend modes, durations, easings | `--tug7-effect-*` |

Note: `effect` tokens do not participate in contrast pairing — they are parameters, not rendered colors.

### Component

The UI component or system the token belongs to.

`global` · `control` · `tab` · `tone` · `field` · `badge` · `selection` · `checkmark` · `toggle` · `radio` · `overlay` · `highlight` · `card`

### Constituent

The structural sub-part within a component. Different values are valid for each plane.

**Element constituents:** `text` · `icon` · `border` · `shadow` · `divider` · `fill` · `outline` · `thumb` · `dot` · `close` · `title` · `control`

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

**Highlight purposes:** `hover` · `drop` · `preview` · `inspector` · `snap` · `flash` · `highlight`

### State

The interaction condition. Every token has a state — non-interactive tokens use `rest`.

`rest` · `hover` · `active` · `focus` · `disabled` · `readonly` · `mixed` · `inactive` · `collapsed`

---

## Classification Rules

These rules make seven-slot parsing deterministic:

**`disabled` is always a state, never a role.** Disabled tokens use `role=plain` with `state=disabled`. Example: `--tug7-element-global-text-normal-plain-disabled`.

**`on`, `off`, `mixed`, `selected`, `highlighted` are roles, not states.** They describe persistent visual treatments that combine with interaction states. Example: `--tug7-surface-toggle-track-normal-on-hover` (role=`on`, state=`hover`).

**Shadow sizes are roles.** The constituent is `shadow`; the size (`xs`, `md`, `lg`, `xl`, `overlay`) occupies the role slot. Example: `--tug7-element-global-shadow-normal-xs-rest`.

**`link` is a role; interaction is a state.** Link text decomposes as `role=link` + `state=hover`. Example: `--tug7-element-global-text-normal-link-hover`.

**Field text types are roles.** `label`, `placeholder`, and `required` are roles (persistent characteristics). `disabled` and `readonly` are states. Example: `--tug7-element-field-text-normal-label-rest`.

**Dual-slot values.** Some values appear in both role and state slots. `hover` is a role when it names a highlight surface's purpose (`--tug7-surface-highlight-primary-normal-hover-rest`) and a state when it names an interaction condition (`--tug7-element-global-text-normal-link-hover`). `mixed` is a role for toggle tracks (`--tug7-surface-toggle-track-normal-mixed-rest`) and a state for checkmarks (`--tug7-element-checkmark-icon-normal-plain-mixed`). The slot determines the meaning.

---

## camelCase Convention

**Slot values are single lowercase words.** When a slot value is genuinely multi-word — the concept cannot be decomposed by placing parts in different slots — use **camelCase**. This is the sanctioned escape hatch: it keeps the seven-slot parser deterministic (split on `-`, get exactly 7 segments) while remaining readable.

Before introducing a camelCase value, verify:
1. Can the concept split across component + constituent? (e.g., `tabClose` → `tab` + `close`)
2. Can context move to a CSS selector? (e.g., `titlebarOn` → `plain` + selector for focused card)
3. Can a suffix be dropped because the component slot already provides context? (e.g., `dropTarget` → `drop` when component is `highlight`)

If all three answers are no, camelCase is correct.

**Sanctioned camelCase values:**

- **On-surface roles:** `onAccent` · `onDanger` · `onSuccess` · `onCaution` — foreground color for use on a named surface (standard design-system pattern)
- **Accent variants:** `accentCool` · `accentSubtle` — role variants where the base role is modified by a quality that is ambiguous without the base

---

## Examples

```
--tug7-element-global-text-normal-plain-rest         ← default body text
--tug7-element-global-text-normal-subtle-rest        ← muted/secondary text
--tug7-element-global-text-normal-link-hover         ← link text on hover
--tug7-element-global-icon-normal-plain-rest         ← default icon color
--tug7-element-global-border-normal-default-rest     ← standard border
--tug7-element-global-shadow-normal-md-rest          ← medium shadow
--tug7-element-global-fill-normal-accent-rest        ← accent fill color
--tug7-element-control-text-filled-accent-rest       ← filled accent button text
--tug7-element-control-text-filled-accent-hover      ← filled accent button text on hover
--tug7-element-control-icon-outlined-action-rest     ← outlined action button icon
--tug7-element-field-text-normal-label-rest          ← field label text
--tug7-element-field-text-normal-plain-disabled      ← disabled field text
--tug7-element-toggle-thumb-normal-plain-rest        ← toggle thumb
--tug7-element-radio-dot-normal-plain-rest           ← radio dot
--tug7-element-tone-fill-normal-success-rest         ← success tone fill
--tug7-element-checkmark-icon-normal-plain-mixed     ← mixed-state checkmark

--tug7-surface-global-primary-normal-app-rest        ← app background
--tug7-surface-global-primary-normal-canvas-rest     ← canvas background
--tug7-surface-global-primary-normal-raised-rest     ← elevated surface
--tug7-surface-control-primary-filled-accent-rest    ← filled accent button bg
--tug7-surface-control-primary-filled-accent-hover   ← filled accent button bg on hover
--tug7-surface-toggle-track-normal-on-rest           ← toggle track (on)
--tug7-surface-toggle-track-normal-off-hover         ← toggle track (off, hovered)
--tug7-surface-overlay-primary-normal-dim-rest       ← overlay dim
--tug7-surface-highlight-primary-normal-hover-rest   ← hover highlight
--tug7-surface-highlight-primary-normal-flash-rest   ← flash highlight
```

---

## Contrast Pairing

A contrast pairing is an element token rendered on a surface token. The seven-slot convention makes pairing extraction mechanical — the `--tug7-` prefix identifies a seven-slot token; split on `-`, read slot 0 (`tug7`) for the namespace, slot 1 for the plane, and classify as element or surface. Every `--tug7-element-*` token has a corresponding `--tug7-surface-*` token it renders on. `audit-tokens pairings` validates all pairings against contrast thresholds. [L16, L18, D81, D83]
