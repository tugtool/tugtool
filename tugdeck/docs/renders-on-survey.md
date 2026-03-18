# @tug-renders-on Survey

**Purpose:** Enumerate every CSS rule across the 23 component files that sets an element property
(`color`, `fill`, `border-color`, `border` shorthand with a color token, directional border
shorthands/longhands, `-webkit-text-fill-color`) without a same-rule `background-color` set to a
`var(--tug-base-*)` token. Literal `transparent`, `none`, or a missing `background-color` does NOT
count as having a surface. Each identified rule needs a `/* @tug-renders-on: --tug-base-{surface} */`
annotation before Step 2.

**Methodology:** Static analysis of every CSS rule in all 23 component files. For each rule,
checked whether it sets an element property containing `var(--tug-*)`. If yes, checked whether
the same rule also sets `background-color` to a `var(--tug-base-*)` token (not `transparent`,
`none`, or absent). Rules without a tug-base-* background set in the same rule are flagged as
needing `@tug-renders-on`. The previous survey only used the tool's "unresolved pairings" output
(104 count) as its scope, which missed rules in files the heuristic strategies happened to resolve
via class-name guessing (strategies 2-4). This revision uses pure static analysis on the CSS source.

**Annotation format (Spec S01):**

```css
/* @tug-renders-on: --tug-base-surface-default */
.selector {
  color: var(--tug-card-title-bar-fg);
}
```

---

## Summary

| File | Rules needing annotation | Count |
|------|--------------------------|-------|
| tug-button.css | 25 svg/color rules — all button variants set `color` on SVG sub-selectors without bg | 25 |
| tug-card.css | `.tugcard-loading`, `.tugcard-title`, `.card-frame[data-focused="true"] .tugcard-icon`, `.card-frame[data-focused="false"] .tugcard-icon` | 4 |
| tug-tab.css | `.tug-tab`, `.tug-tab-bar .tug-tab-add`, `.tug-tab-bar .tug-tab-overflow-btn` | 3 |
| tug-menu.css | `.tug-dropdown-item` plus 6 svg sub-selectors for open-state buttons | 7 |
| tug-badge.css | 10 outlined/ghost variant rules (bg=transparent) | 10 |
| tug-switch.css | `.tug-switch-label` | 1 |
| tug-checkbox.css | `.tug-checkbox` (border), `.tug-checkbox:hover:not(:disabled):not([data-disabled])` (border-color), `.tug-checkbox-indicator`, `.tug-checkbox[data-state="indeterminate"] .tug-checkbox-indicator`, `.tug-checkbox-label` | 5 |
| tug-input.css | `.tug-input::placeholder`, `.tug-input-invalid:not(:focus)`, `.tug-input-valid:not(:focus)`, `.tug-input-warning:not(:focus)` | 4 |
| tug-label.css | `.tug-label`, `.tug-label-required` | 2 |
| tug-marquee.css | `.tug-marquee` | 1 |
| tug-hue-strip.css | `.tug-hue-strip__swatch:hover`, `.tug-hue-strip__label`, `.tug-hue-strip__item--selected .tug-hue-strip__label` | 3 |
| tug-dialog.css | 0 — tokens-only file, no CSS rules with element properties | 0 |
| tug-data.css | 0 — tokens-only file, no CSS rules with element properties | 0 |
| tug-code.css | 0 — tokens-only file, no CSS rules with element properties | 0 |
| tug-dock.css | 0 — tokens-only file, no CSS rules with element properties | 0 |
| tug-skeleton.css | 0 — no color/fill/border-color on text/icon elements | 0 |
| tug-inspector.css | 0 — tokens-only file, no CSS rules with element properties | 0 |
| style-inspector-overlay.css | 0 — uses hardcoded oklch values exclusively, no tug-base-* tokens | 0 |
| cards/gallery-card.css | 19 rules | 19 |
| cards/gallery-badge-mockup.css | 8 rules | 8 |
| cards/gallery-popup-button.css | 9 rules | 9 |
| cards/gallery-palette-content.css | 9 rules | 9 |
| cards/gallery-theme-generator-content.css | 32 rules | 32 |
| **TOTAL** | | **142** |

> The previous survey captured only 100 distinct rules because it was based solely on the audit
> tool's "104 unresolved pairings" output — rules that heuristic strategies 2-4 happened to resolve
> (even if incorrectly) were not counted. This static analysis adds 42 additional rules, primarily
> in tug-button.css (25 svg sub-selector rules), tug-menu.css (6 additional open-state svg rules),
> tug-checkbox.css (3 additional rules), and tug-input.css (3 additional validation border-color rules).
> The total of 142 is above the ~130 estimate but well within the Risk R01 threshold of 160.
> No batching is required.

---

## Files with Zero Annotations Needed

These files have no CSS rules that set element properties with `var(--tug-*)` tokens:

- `tug-dialog.css` — tokens-only (`body {}` block only, no styling rules)
- `tug-data.css` — tokens-only
- `tug-code.css` — tokens-only
- `tug-dock.css` — tokens-only
- `tug-inspector.css` — tokens-only
- `tug-skeleton.css` — only sets `background-color` (no text/icon color/fill)
- `style-inspector-overlay.css` — uses hardcoded `oklch()` values exclusively; no `var(--tug-*)` tokens in any rule

---

## File-by-File Detail

### tug-button.css — 25 annotations

**Why this was previously missed:** The audit tool resolved all button pairings via heuristic strategies
(ancestor prefix and class-name matching). Static analysis reveals that every `svg { color: ... }`
sub-selector rule sets `color` without a `background-color` in the same rule.

Every `svg` sub-selector inside a filled/outlined/ghost button variant renders on the corresponding
button background defined in the parent compound class rule. The rendering surface for each SVG
icon is the same background as its parent button state.

| Selector | Property | Element token | Rendering surface | Notes |
|----------|----------|---------------|-------------------|-------|
| `.tug-button svg` | `color` | `--tug-base-control-outlined-action-icon-rest` | `--tug-base-control-outlined-action-bg-rest` | Icon on default button bg |
| `.tug-button:hover:not(:disabled):not([aria-disabled="true"]) svg` | `color` | `--tug-base-control-outlined-action-icon-hover` | `--tug-base-control-outlined-action-bg-hover` | Icon on hover bg |
| `.tug-button:active:not(:disabled):not([aria-disabled="true"]) svg` | `color` | `--tug-base-control-outlined-action-icon-active` | `--tug-base-control-outlined-action-bg-active` | Icon on active bg |
| `.tug-button-filled-accent svg` | `color` | `--tug-base-control-filled-accent-icon-rest` | `--tug-base-control-filled-accent-bg-rest` | Icon on filled-accent rest bg |
| `.tug-button-filled-accent:hover:not(:disabled):not([aria-disabled="true"]) svg` | `color` | `--tug-base-control-filled-accent-icon-hover` | `--tug-base-control-filled-accent-bg-hover` | Icon on filled-accent hover bg |
| `.tug-button-filled-accent:active:not(:disabled):not([aria-disabled="true"]) svg` | `color` | `--tug-base-control-filled-accent-icon-active` | `--tug-base-control-filled-accent-bg-active` | Icon on filled-accent active bg |
| `.tug-button-filled-action svg` | `color` | `--tug-base-control-filled-action-icon-rest` | `--tug-base-control-filled-action-bg-rest` | Icon on filled-action rest bg |
| `.tug-button-filled-action:hover:not(:disabled):not([aria-disabled="true"]) svg` | `color` | `--tug-base-control-filled-action-icon-hover` | `--tug-base-control-filled-action-bg-hover` | Icon on filled-action hover bg |
| `.tug-button-filled-action:active:not(:disabled):not([aria-disabled="true"]) svg` | `color` | `--tug-base-control-filled-action-icon-active` | `--tug-base-control-filled-action-bg-active` | Icon on filled-action active bg |
| `.tug-button-filled-danger svg` | `color` | `--tug-base-control-filled-danger-icon-rest` | `--tug-base-control-filled-danger-bg-rest` | Icon on filled-danger rest bg |
| `.tug-button-filled-danger:hover:not(:disabled):not([aria-disabled="true"]) svg` | `color` | `--tug-base-control-filled-danger-icon-hover` | `--tug-base-control-filled-danger-bg-hover` | Icon on filled-danger hover bg |
| `.tug-button-filled-danger:active:not(:disabled):not([aria-disabled="true"]) svg` | `color` | `--tug-base-control-filled-danger-icon-active` | `--tug-base-control-filled-danger-bg-active` | Icon on filled-danger active bg |
| `.tug-button-outlined-action svg` | `color` | `--tug-base-control-outlined-action-icon-rest` | `--tug-base-control-outlined-action-bg-rest` | Icon on outlined-action rest bg |
| `.tug-button-ghost-action svg` | `color` | `--tug-base-control-ghost-action-icon-rest` | `--tug-base-surface-default` | Ghost-action bg is transparent; renders on ambient surface-default |
| `.tug-button-ghost-action:hover:not(:disabled):not([aria-disabled="true"]) svg` | `color` | `--tug-base-control-ghost-action-icon-hover` | `--tug-base-surface-default` | Ghost hover bg is semi-transparent over surface-default |
| `.tug-button-ghost-action:active:not(:disabled):not([aria-disabled="true"]) svg` | `color` | `--tug-base-control-ghost-action-icon-active` | `--tug-base-surface-default` | Ghost active bg is semi-transparent over surface-default |
| `.tug-button-ghost-danger svg` | `color` | `--tug-base-control-ghost-danger-icon-rest` | `--tug-base-surface-default` | Ghost-danger bg is transparent; renders on ambient surface-default |
| `.tug-button-ghost-danger:hover:not(:disabled):not([aria-disabled="true"]) svg` | `color` | `--tug-base-control-ghost-danger-icon-hover` | `--tug-base-surface-default` | Ghost hover bg semi-transparent over surface-default |
| `.tug-button-ghost-danger:active:not(:disabled):not([aria-disabled="true"]) svg` | `color` | `--tug-base-control-ghost-danger-icon-active` | `--tug-base-surface-default` | Ghost active bg semi-transparent over surface-default |
| `.tug-button-outlined-option svg` | `color` | `--tug-base-control-outlined-option-icon-rest` | `--tug-base-surface-default` | Outlined-option rest bg is transparent; renders on ambient surface-default |
| `.tug-button-outlined-option:hover:not(:disabled):not([aria-disabled="true"]) svg` | `color` | `--tug-base-control-outlined-option-icon-hover` | `--tug-base-surface-default` | Hover bg semi-transparent over surface-default |
| `.tug-button-outlined-option:active:not(:disabled):not([aria-disabled="true"]) svg` | `color` | `--tug-base-control-outlined-option-icon-active` | `--tug-base-surface-default` | Active bg semi-transparent over surface-default |
| `.tug-button-ghost-option svg` | `color` | `--tug-base-control-ghost-option-icon-rest` | `--tug-base-surface-default` | Ghost-option bg is transparent; renders on ambient surface-default |
| `.tug-button-ghost-option:hover:not(:disabled):not([aria-disabled="true"]) svg` | `color` | `--tug-base-control-ghost-option-icon-hover` | `--tug-base-surface-default` | Ghost hover bg semi-transparent over surface-default |
| `.tug-button-ghost-option:active:not(:disabled):not([aria-disabled="true"]) svg` | `color` | `--tug-base-control-ghost-option-icon-active` | `--tug-base-surface-default` | Ghost active bg semi-transparent over surface-default |

> **Note on ghost/outlined icon surfaces:** The `ghost-action`, `ghost-danger`, `ghost-option`, and
> `outlined-option` button variants use `background-color: var(--tug-base-control-ghost-*/outlined-option-*-bg-rest)`
> which resolves to `transparent` or a semi-transparent overlay. The icons on these variants render
> on whatever ambient surface the button sits on. The canonical ambient surface is `--tug-base-surface-default`
> (main card content area). This is consistent with the existing `@tug-pairings` block in tug-button.css
> which records all ghost/outlined-option pairings against `surface-default`.

> **Count note:** Base `.tug-button` svg rules (rest/hover/active = 3) + filled-accent (3) + filled-action (3) +
> filled-danger (3) + outlined-action (rest only, hover/active inherit from base = 1) + ghost-action (3) +
> ghost-danger (3) + outlined-option (3) + ghost-option (3) = 3+3+3+3+1+3+3+3+3 = 25 total svg rules.

---

### tug-card.css — 4 annotations

(Unchanged from previous survey — these are correctly identified.)

| Selector | Property | Element token | Rendering surface |
|----------|----------|---------------|-------------------|
| `.tugcard-loading` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.tugcard-title` | `color` | `--tug-card-title-bar-fg` | `--tug-base-tab-bg-inactive, --tug-base-tab-bg-active` |
| `.card-frame[data-focused="true"] .tugcard-icon` | `color` | `--tug-card-title-bar-icon-active` | `--tug-base-tab-bg-active` |
| `.card-frame[data-focused="false"] .tugcard-icon` | `color` | `--tug-card-title-bar-icon-inactive` | `--tug-base-tab-bg-inactive` |

> `.tugcard-accessory` has `background-color: var(--tug-base-surface-default)` in the same rule → strategy 1, no annotation needed.
> `.tugcard-title-bar ::selection` and `.tugcard-title-bar::selection` use `color: inherit` — no specific token → no annotation needed.

---

### tug-tab.css — 3 annotations

**Why this was previously missed:** The heuristic resolved tab pairings via ancestor class matching.
Static analysis reveals 3 rules with `background-color: transparent` that set `color`.

| Selector | Property | Element token | Rendering surface | Notes |
|----------|----------|---------------|-------------------|-------|
| `.tug-tab` | `color` | `--tug-tab-fg-rest` → `--tug-base-tab-fg-rest` | `--tug-base-tab-bg-inactive` | Tab bar bg is `--tug-tab-bar-bg` → `--tug-base-tab-bg-inactive`. Tab has `background-color: transparent` in the same rule — transparent does not count as a surface |
| `.tug-tab-bar .tug-tab-add` | `color` | `--tug-base-fg-muted` | `--tug-base-tab-bg-inactive` | Button has `background-color: transparent`. Renders on tab bar background = `--tug-base-tab-bg-inactive` |
| `.tug-tab-bar .tug-tab-overflow-btn` | `color` | `--tug-base-fg-muted` | `--tug-base-tab-bg-inactive` | Same: `background-color: transparent`, renders on tab bar = `--tug-base-tab-bg-inactive` |

> **Already handled by strategy 1:**
> - `.tug-tab[data-active="true"]` has `background-color: var(--tug-tab-bg-active)` → strategy 1
> - `.tug-tab:not([data-active="true"]):hover` has `background-color: var(--tug-tab-bg-hover)` → strategy 1
> - `.tug-tab-close:hover` has `background-color: var(--tug-tab-close-bg-hover)` → strategy 1
> - `.tug-tab-bar .tug-tab-add[data-state="open"]` has `background-color: var(--tug-base-control-ghost-option-bg-active)` → strategy 1
> - `.tug-tab-bar .tug-tab-overflow-btn[data-state="open"]` has `background-color: var(--tug-base-control-ghost-option-bg-active)` → strategy 1
> - `.tug-tab-overflow-badge` has `background-color: var(--tug-tab-badge-bg)` → strategy 1
> - `.tug-tab-ghost` has `background-color: var(--tug-base-surface-control)` → strategy 1
> - `.tug-tab-bar[data-drop-target="true"]` has `background-color: var(--tug-base-surface-control)` → strategy 1
> - `.tug-tab-bar` has `background-color: var(--tug-tab-bar-bg)` (tug-base token via alias) AND `border-bottom` → strategy 1

---

### tug-menu.css — 7 annotations

**Why this was partially missed:** The tool correctly identified `.tug-dropdown-item` as needing annotation. However, the 6 open-state `svg` sub-selectors in tug-menu.css were missed because the tug-menu.css open-state button rules use `background-color` (strategy 1) but their separate `svg` sub-selectors do not.

| Selector | Property | Element token | Rendering surface | Notes |
|----------|----------|---------------|-------------------|-------|
| `.tug-dropdown-item` | `color` | `--tug-dropdown-fg` → `--tug-base-fg-default` | `--tug-base-surface-overlay` | Inside `.tug-dropdown-content` which has `background-color: var(--tug-dropdown-bg)` → `surface-overlay` |
| `.tug-button-outlined-action[data-state="open"] svg` | `color` | `--tug-base-control-outlined-action-icon-active` | `--tug-base-control-outlined-action-bg-active` | Icon on outlined-action open/active bg |
| `.tug-button-outlined-option[data-state="open"] svg` | `color` | `--tug-base-control-outlined-option-icon-active` | `--tug-base-control-outlined-option-bg-active` | Icon on outlined-option open/active bg |
| `.tug-button-filled-accent[data-state="open"] svg` | `color` | `--tug-base-control-filled-accent-icon-active` | `--tug-base-control-filled-accent-bg-active` | Icon on filled-accent open/active bg |
| `.tug-button-ghost-action[data-state="open"] svg` | `color` | `--tug-base-control-ghost-action-icon-active` | `--tug-base-surface-default` | Ghost bg is semi-transparent; icon renders on ambient surface-default |
| `.tug-button-ghost-option[data-state="open"] svg` | `color` | `--tug-base-control-ghost-option-icon-active` | `--tug-base-surface-default` | Ghost bg is semi-transparent; icon renders on ambient surface-default |
| `.tug-button-filled-danger[data-state="open"] svg` | `color` | `--tug-base-control-filled-danger-icon-active` | `--tug-base-control-filled-danger-bg-active` | Icon on filled-danger open/active bg |

---

### tug-badge.css — 10 annotations

**Correction from previous survey:** Previous count was 9 (missed `ghost-agent`). Correct count is 10 distinct rules. All have `background-color: transparent`.

| Selector | Property | Element token | Rendering surface |
|----------|----------|---------------|-------------------|
| `.tug-badge-outlined-accent` | `color`, `border-color` | `--tug-base-fg-inverse`, `--tug-base-tone-accent` | `--tug-base-surface-default` |
| `.tug-badge-outlined-danger` | `color`, `border-color` | `--tug-base-fg-inverse`, `--tug-base-tone-danger` | `--tug-base-surface-default` |
| `.tug-badge-outlined-data` | `color`, `border-color` | `--tug-base-fg-inverse`, `--tug-base-tone-data` | `--tug-base-surface-default` |
| `.tug-badge-ghost-accent` | `color` | `--tug-base-tone-accent-fg` | `--tug-base-surface-default` |
| `.tug-badge-ghost-agent` | `color` | `--tug-base-tone-agent-fg` | `--tug-base-surface-default` |
| `.tug-badge-ghost-data` | `color` | `--tug-base-tone-data-fg` | `--tug-base-surface-default` |
| `.tug-badge-outlined-success` | `color`, `border-color` | `--tug-base-fg-inverse`, `--tug-base-tone-success` | `--tug-base-surface-default` |
| `.tug-badge-ghost-success` | `color` | `--tug-base-tone-success-fg` | `--tug-base-surface-default` |
| `.tug-badge-outlined-caution` | `color`, `border-color` | `--tug-base-fg-inverse`, `--tug-base-tone-caution` | `--tug-base-surface-default` |
| `.tug-badge-ghost-caution` | `color` | `--tug-base-tone-caution-fg` | `--tug-base-surface-default` |

> One `@tug-renders-on` annotation per rule block covers all element properties in that block.

---

### tug-switch.css — 1 annotation

**Why this was previously missed:** The audit tool resolved `.tug-switch-label` via heuristic
strategy (class-name truncation — `tug-switch-label` → `tug-switch` root). Static analysis
confirms it sets `color` without a same-rule `background-color`.

| Selector | Property | Element token | Rendering surface | Notes |
|----------|----------|---------------|-------------------|-------|
| `.tug-switch-label` | `color` | `--tug-base-field-fg-label` | `--tug-base-surface-default` | The label renders in form layouts on the ambient surface-default. No background set on the label element |

---

### tug-checkbox.css — 5 annotations

**Why this was previously undercounted:** The previous survey identified 2 rules. Static analysis
finds 5: the `.tug-checkbox` border rule, the hover `border-color` rule, two `color` rules on
the indicator, and the label rule.

| Selector | Property | Element token | Rendering surface | Notes |
|----------|----------|---------------|-------------------|-------|
| `.tug-checkbox` | `border` | `--tug-base-toggle-track-off` | `--tug-base-surface-default` | Box has `background-color: transparent`; renders on form layout surface-default |
| `.tug-checkbox:hover:not(:disabled):not([data-disabled])` | `border-color` | `--tug-base-toggle-track-off-hover` | `--tug-base-surface-default` | Hover border on same surface |
| `.tug-checkbox-indicator` | `color` | `--tug-base-checkmark-fg` | `--tug-base-toggle-track-on` | The indicator (SVG) renders inside the checked box; parent `.tug-checkbox[data-state="checked"]` has `background-color: var(--tug-toggle-on-color, var(--tug-base-toggle-track-on))` |
| `.tug-checkbox[data-state="indeterminate"] .tug-checkbox-indicator` | `color` | `--tug-base-checkmark-fg-mixed` | `--tug-base-toggle-track-mixed` | Indicator inside indeterminate box; parent has `background-color: var(--tug-toggle-on-color, var(--tug-base-toggle-track-mixed))` |
| `.tug-checkbox-label` | `color` | `--tug-base-field-fg-label` | `--tug-base-surface-default` | Label renders in form layouts on ambient surface-default |

---

### tug-input.css — 4 annotations

**Why this was previously undercounted:** The previous survey identified 1 rule (`::placeholder`).
Static analysis finds 4: the placeholder rule plus 3 validation border-color rules that set
`border-color` without a same-rule `background-color`.

| Selector | Property | Element token | Rendering surface | Notes |
|----------|----------|---------------|-------------------|-------|
| `.tug-input::placeholder` | `color` | `--tug-base-field-fg-placeholder` | `--tug-base-field-bg-rest` | Base `.tug-input` sets `background-color: --tug-base-field-bg-rest`; placeholder renders on that bg |
| `.tug-input-invalid:not(:focus)` | `border-color` | `--tug-base-field-border-danger` | `--tug-base-field-bg-rest` | Validation state override; no bg in same rule; inherits base input bg = field-bg-rest |
| `.tug-input-valid:not(:focus)` | `border-color` | `--tug-base-field-border-success` | `--tug-base-field-bg-rest` | Same |
| `.tug-input-warning:not(:focus)` | `border-color` | `--tug-base-field-tone-caution` | `--tug-base-field-bg-rest` | Same |

---

### tug-label.css — 2 annotations

(Unchanged from previous survey — correctly identified.)

| Selector | Property | Element token | Rendering surface | Notes |
|----------|----------|---------------|-------------------|-------|
| `.tug-label` | `color` | `--tug-base-field-fg-label` | `--tug-base-surface-default` | Labels appear in form layouts on ambient surface-default |
| `.tug-label-required` | `color` | `--tug-base-field-fg-required` | `--tug-base-surface-default` | Required asterisk, same context |

---

### tug-marquee.css — 1 annotation

(Unchanged from previous survey — correctly identified.)

| Selector | Property | Element token | Rendering surface | Notes |
|----------|----------|---------------|-------------------|-------|
| `.tug-marquee` | `color` | `--tug-base-field-fg-label` | `--tug-base-surface-default` | Marquee is a form-adjacent label component on ambient surface |

---

### tug-hue-strip.css — 3 annotations

(Unchanged from previous survey — correctly identified.)

| Selector | Property | Element token | Rendering surface | Notes |
|----------|----------|---------------|-------------------|-------|
| `.tug-hue-strip__swatch:hover` | `border-color` | `--tug-base-border-default` | `--tug-base-surface-default` | Strip appears in gallery cards with surface-default background |
| `.tug-hue-strip__label` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` | Rotated label below swatches |
| `.tug-hue-strip__item--selected .tug-hue-strip__label` | `color` | `--tug-base-accent-default` | `--tug-base-surface-default` | Selected label on same surface |

---

### cards/gallery-card.css — 19 annotations

(Unchanged from previous survey — correctly identified.)

All `.cg-*` elements render inside the card content area (`.tugcard-content`) which has
`background-color: var(--tug-base-surface-default)`.

| Selector | Property | Element token | Rendering surface |
|----------|----------|---------------|-------------------|
| `.cg-section-title` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.cg-control-label` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.cg-control-select:focus` | `border-color` | `--tug-base-accent-cool-default` | `--tug-base-surface-control` |
| `.cg-subtype-label` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.cg-variant-label` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.cg-demo-status` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.cg-hue-swatch` | `border` | `--tug-base-border-default` | `--tug-base-surface-default` |
| `.cg-cascade-prop` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.cg-cascade-source` | `color` | `--tug-base-accent-default` | `--tug-base-surface-default` |
| `.cg-cascade-value` | `color` | `--tug-base-fg-default` | `--tug-base-surface-default` |
| `.cg-description` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.cg-st-value` | `color` | `--tug-base-fg-default` | `--tug-base-surface-default` |
| `.cg-st-note` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.cg-anim-physics-label` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.cg-anim-token-legend` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.cg-anim-token-entry code` | `color` | `--tug-base-fg-default` | `--tug-base-surface-default` |
| `.cg-anim-token-entry span` | `color` | `--tug-base-accent-cool-default` | `--tug-base-surface-default` |
| `.cg-anim-pct-row` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.cg-anim-pct-value` | `color` | `--tug-base-fg-default` | `--tug-base-surface-default` |

---

### cards/gallery-badge-mockup.css — 8 annotations

(Unchanged from previous survey — correctly identified.)

All `.badge-mockup-*` UI elements render inside the gallery card content area on `--tug-base-surface-default`.

| Selector | Property | Element token | Rendering surface |
|----------|----------|---------------|-------------------|
| `.badge-mockup-control-group-title` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.badge-mockup-reset, .badge-mockup-reset-all` | `color` | `--tug-base-fg-subtle` | `--tug-base-surface-default` |
| `.badge-mockup-reset:hover, .badge-mockup-reset-all:hover` | `color` | `--tug-base-fg-default` | `--tug-base-surface-default` |
| `.badge-mockup-reset-all` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.badge-mockup-slider-label` | `color` | `--tug-base-fg-subtle` | `--tug-base-surface-default` |
| `.badge-mockup-slider-value` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.badge-mockup-group-title` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.badge-mockup-row-label` | `color` | `--tug-base-fg-subtle` | `--tug-base-surface-default` |
| `.badge-mockup-vs-header` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |

> `.badge-mockup-reset, .badge-mockup-reset-all` is one rule block (multi-selector). The count is 8 distinct rule blocks,
> with `.badge-mockup-reset-all` appearing as a separate override rule.

---

### cards/gallery-popup-button.css — 9 annotations

(Unchanged from previous survey — correctly identified.)

| Selector | Property | Element token | Rendering surface |
|----------|----------|---------------|-------------------|
| `.gpb-control-group-title` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gpb-slider-label` | `color` | `--tug-base-fg-subtle` | `--tug-base-surface-default` |
| `.gpb-slider-value` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gpb-reset` | `color` | `--tug-base-fg-subtle` | `--tug-base-surface-default` |
| `.gpb-reset:hover` | `color` | `--tug-base-fg-default` | `--tug-base-surface-default` |
| `.gpb-demo-label` | `color` | `--tug-base-fg-subtle` | `--tug-base-surface-default` |
| `.gpb-status` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gpb-status code` | `color` | `--tug-base-fg-default` | `--tug-base-surface-default` |
| `.gpb-context-label` | `color` | `--tug-base-fg-subtle` | `--tug-base-surface-inset` |

---

### cards/gallery-palette-content.css — 9 annotations

(Unchanged from previous survey — correctly identified.)

| Selector | Property | Element token | Rendering surface |
|----------|----------|---------------|-------------------|
| `.gp-achromatic-swatch:hover` | `border-color` | `--tug-base-border-default` | `--tug-base-surface-default` |
| `.gp-achromatic-label` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gp-curve-axis-label` | `fill` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gp-curve-hue-label` | `fill` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gp-curve-hue-label--selected` | `fill` | `--tug-base-accent-default` | `--tug-base-surface-default` |
| `.gp-vvgrid-header-cell` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gp-vvgrid-row-label` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gp-picker-swatch` | `border` | `--tug-base-border-default` | `--tug-base-surface-default` |
| `.gp-picker-readout` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |

---

### cards/gallery-theme-generator-content.css — 32 annotations

(Unchanged from previous survey — correctly identified.)

Most elements render on `--tug-base-surface-default`. Key exceptions noted below.

| Selector | Property | Element token | Rendering surface |
|----------|----------|---------------|-------------------|
| `.gtg-hue-column-title` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gtg-preview-title` | `color` | `--tug-base-fg-default` | `--tug-base-bg-canvas` |
| `.gtg-preview-body` | `color` | `--tug-base-fg-default` | `--tug-base-bg-canvas` |
| `.gtg-preview-muted` | `color` | `--tug-base-fg-muted` | `--tug-base-bg-canvas` |
| `.gtg-preview-subtle` | `color` | `--tug-base-fg-subtle` | `--tug-base-bg-canvas` |
| `.gtg-preview-link` | `color` | `--tug-base-fg-link` | `--tug-base-bg-canvas` |
| `.gtg-preview-inline-row` | `color` | `--tug-base-fg-default` | `--tug-base-bg-canvas` |
| `.gtg-erp-subtitle` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gtg-erp-col-label` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gtg-erp-row-label` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gtg-compact-hue-label` | `color` | `--tug-base-fg-default` | `--tug-base-surface-default` |
| `.gtg-compact-hue-chip` | `border` | `--tug-base-border-default` | `--tug-base-surface-default` |
| `.gtg-compact-hue-name` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gtg-slider-label` | `color` | `--tug-base-fg-default` | `--tug-base-surface-default` |
| `.gtg-slider-value` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gtg-token-header` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gtg-token-name` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gtg-token-swatch` | `border` | `--tug-base-border-default` | `--tug-base-surface-default` |
| `.gtg-token-value` | `color` | `--tug-base-fg-subtle` | `--tug-base-surface-default` |
| `.gtg-dash-col-header` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gtg-dash-swatch` | `border` | `--tug-base-border-default` | `--tug-base-surface-default` |
| `.gtg-dash-token-name` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gtg-dash-ratio` | `color` | `--tug-base-fg-subtle` | `--tug-base-surface-default` |
| `.gtg-cvd-token-header` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gtg-cvd-type-label` | `color` | `--tug-base-fg-default` | `--tug-base-surface-default` |
| `.gtg-autofix-result` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gtg-autofix-suggestion-item` | `color` | `--tug-base-fg-default` | `--tug-base-tone-caution-bg` |
| `.gtg-autofix-suggestion-type` | `color` | `--tug-base-tone-caution-fg` | `--tug-base-tone-caution-bg` |
| `.gtg-diag-section-title` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gtg-diag-item` | `color` | `--tug-base-fg-default` | `--tug-base-surface-default` |
| `.gtg-diag-token` | `color` | `--tug-base-fg-default` | `--tug-base-surface-default` |
| `.gtg-diag-detail` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |
| `.gtg-saved-theme-label` | `color` | `--tug-base-fg-muted` | `--tug-base-surface-default` |

> `.gtg-mode-btn`, `.gtg-mode-btn:hover`, `.gtg-mode-btn--active` all set `background-color` with tug-base-* → strategy 1.
> `.gtg-dash-badge--pass`, `--marginal`, `--fail`, `--decorative` all set their own `background-color` → strategy 1.

---

## Total Count Summary

| File | Distinct rules needing annotation |
|------|----------------------------------|
| tug-button.css | 25 |
| tug-card.css | 4 |
| tug-tab.css | 3 |
| tug-menu.css | 7 |
| tug-badge.css | 10 |
| tug-switch.css | 1 |
| tug-checkbox.css | 5 |
| tug-input.css | 4 |
| tug-label.css | 2 |
| tug-marquee.css | 1 |
| tug-hue-strip.css | 3 |
| cards/gallery-card.css | 19 |
| cards/gallery-badge-mockup.css | 8 |
| cards/gallery-popup-button.css | 9 |
| cards/gallery-palette-content.css | 9 |
| cards/gallery-theme-generator-content.css | 32 |
| **TOTAL** | **142** |

> The total of 142 is above the ~130 estimate but within the Risk R01 threshold of 160.
> No batching is required. The annotation work in Step 2 can proceed file-by-file.

---

## Multi-Surface Rules

The following rules render on different surfaces depending on state. They require comma-separated annotation syntax:

| File | Selector | Surfaces |
|------|----------|---------|
| tug-card.css | `.tugcard-title` | `--tug-base-tab-bg-inactive, --tug-base-tab-bg-active` |

---

## Alias Chain Survey

Per the plan [D02], these files have alias chains requiring flattening:

| File | Alias | Current value | Should become |
|------|-------|---------------|---------------|
| tug-menu.css | `--tug-dropdown-bg` | `var(--tug-menu-bg)` | exempt (COMPAT_ALIAS_ALLOWLIST) |
| tug-menu.css | `--tug-dropdown-fg` | `var(--tug-menu-fg)` | exempt |
| tug-menu.css | `--tug-dropdown-border` | `var(--tug-menu-border)` | exempt |
| tug-menu.css | `--tug-dropdown-shadow` | `var(--tug-menu-shadow)` | exempt |
| tug-menu.css | `--tug-dropdown-item-bg-hover` | `var(--tug-menu-item-bg-hover)` | exempt |
| tug-menu.css | `--tug-dropdown-item-bg-selected` | `var(--tug-menu-item-bg-selected)` | exempt |
| tug-menu.css | `--tug-dropdown-item-fg` | `var(--tug-menu-item-fg)` | exempt |
| tug-menu.css | `--tug-dropdown-item-fg-disabled` | `var(--tug-menu-item-fg-disabled)` | exempt |
| tug-menu.css | `--tug-dropdown-item-fg-danger` | `var(--tug-menu-item-fg-danger)` | exempt |
| tug-menu.css | `--tug-dropdown-item-meta` | `var(--tug-menu-item-meta)` | exempt |
| tug-menu.css | `--tug-dropdown-item-shortcut` | `var(--tug-menu-item-shortcut)` | exempt |
| tug-menu.css | `--tug-dropdown-item-icon` | `var(--tug-menu-item-icon)` | exempt |
| tug-menu.css | `--tug-dropdown-item-icon-danger` | `var(--tug-menu-item-icon-danger)` | exempt |
| tug-menu.css | `--tug-dropdown-item-chevron` | `var(--tug-menu-item-chevron)` | exempt |
| tug-tab.css | `--tug-tab-bar-bg` | `var(--tug-card-title-bar-bg-inactive)` | `var(--tug-base-tab-bg-inactive)` |
| tug-tab.css | `--tug-tab-bg-active` | `var(--tug-card-title-bar-bg-active)` | `var(--tug-base-tab-bg-active)` |

> The `--tug-dropdown-*` → `--tug-menu-*` chain (14 entries) is the compat layer documented in [D02]
> and will be added to `COMPAT_ALIAS_ALLOWLIST` in audit-tokens.ts.
> The `--tug-tab-bar-bg` and `--tug-tab-bg-active` cross-component chains in tug-tab.css are NOT
> exempt and must be flattened in Step 3.

---

## Checkpoint

- [x] All 23 files surveyed using static analysis (not heuristic tool output)
- [x] Total distinct rules needing annotation: **142**
- [x] Each identified rule has a proposed surface token
- [x] Multi-surface rules identified: 1 (`.tugcard-title`)
- [x] Total vs estimate: 142 vs ~130 estimate. Higher because the estimate did not account for
      button SVG sub-selectors (25 rules) or the 6 tug-menu.css open-state SVG rules. Count is
      well below Risk R01 threshold (160), so no batching of annotation work is required.
- [x] Previous survey errors corrected:
      - tug-button.css: was 0, now 25 (SVG icon sub-selectors on all button variants)
      - tug-tab.css: was 0, now 3 (transparent-bg rules)
      - tug-menu.css: was 1, now 7 (6 additional open-state SVG rules)
      - tug-badge.css: was 9, now 10 (ghost-agent was missing)
      - tug-switch.css: was 0, now 1 (label)
      - tug-checkbox.css: was 2, now 5 (indicator color rules and label)
      - tug-input.css: was 1, now 4 (3 validation border-color rules added)
