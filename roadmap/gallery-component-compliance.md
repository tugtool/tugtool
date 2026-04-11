# Gallery Component Compliance

Every gallery card must use the standard tug component library. No raw HTML elements styled with `cg-*` CSS classes where a tug component exists. The gallery is the showcase for the component library — it must use the library it showcases.

## Problem

Gallery cards use ~60 `cg-*` CSS classes defined in `gallery.css` to style raw `<div>`, `<p>`, `<span>`, `<input>`, and `<button>` elements. These bypass the tug component library: they don't participate in the responder chain, don't follow the selection model (no copyable context menus on text), and aren't themed through the standard token system.

## Scope

46 gallery cards + `gallery.css`. Non-gallery cards (`hello-world-card.tsx`, `git-card.tsx`) do not use `cg-*` classes.

## What stays as-is

**Demo targets** remain as raw `<div>` — these are the subjects being demonstrated, not UI chrome:

| Class | Purpose |
|-------|---------|
| `cg-mutation-box` | Animated target in mutation demo |
| `cg-mutation-tx-stage` | Positioned stage area |
| `cg-mutation-tx-card` | Mock card element |
| `cg-hue-swatch` | Gradient color strip |
| `cg-anim-dot` | Animated circle |
| `cg-anim-token-box` | Duration token indicator |
| `cg-anim-cancel-box` | Cancellation mode indicator |
| `cg-anim-slot-box` | Named slot indicator |

## Step 1: Text labels to TugLabel

Replace all text-display `<div>`, `<p>`, `<span>` elements that use `cg-*` text classes with `<TugLabel>`.

| Class | Count | Replacement |
|-------|-------|-------------|
| `cg-description` | 40 | `<TugLabel className="cg-description">` |
| `cg-demo-status` | 18 | `<TugLabel className="cg-demo-status">` — flatten `<code>` children to template literals |
| `cg-control-label` | 14 | `<TugLabel className="cg-control-label">` |
| `cg-variant-label` | 3 | `<TugLabel className="cg-variant-label">` |
| `cg-subtype-label` | 3 | `<TugLabel className="cg-subtype-label">` |
| `cg-st-readout-fn` | 3 | `<TugLabel className="cg-st-readout-fn">` |
| `cg-st-readout-value` | 3 | `<TugLabel className="cg-st-readout-value">` |
| `cg-st-note` | 2 | `<TugLabel className="cg-st-note">` |
| `cg-st-indicator-label` | 2 | `<TugLabel className="cg-st-indicator-label">` |
| `cg-st-value` | 1 | `<TugLabel className="cg-st-value">` |
| `cg-st-slider-label` | 1 | `<TugLabel className="cg-st-slider-label">` |
| `cg-anim-pct-value` | 1 | `<TugLabel className="cg-anim-pct-value">` |

`cg-demo-status` elements contain `<code>` children (e.g., `Value: <code>42</code>`). Every instance follows the same pattern and can be flattened to a template literal: `` {`Value: ${smValue}`} ``. No need to extend TugLabel.

Table cells (`<td className="cg-cascade-*">`) stay as `<td>` — TugLabel renders a `<label>`, which cannot be a table cell. Wrap with `<TugLabel>` inside the `<td>` for copyability.

## Step 2: Dividers to TugSeparator

Replace all `<div className="cg-divider" />` with `<TugSeparator />`.

- 169 occurrences across all gallery files
- Mechanical sed replacement
- Remove `cg-divider` CSS rule from `gallery.css`

## Step 3: Layout containers to TugBox

Replace `cg-*` layout containers with `<TugBox>`. TugBox exists for exactly this purpose — grouping content with optional visual chrome.

| Class | Count | Current | TugBox variant |
|-------|-------|---------|----------------|
| `cg-content` | 43 | Root scrollable wrapper | `<TugBox variant="plain">` with scroll styling |
| `cg-section` | 213 | Section grouping (flex column, 16px gap) | `<TugBox variant="plain">` |
| `cg-controls` | 3 | Bordered control bar | `<TugBox variant="bordered">` |
| `cg-control-group` | 12 | Horizontal label+input pair | `<TugBox variant="plain">` with flex-row |
| `cg-variant-row` | 21 | Row in variant matrix | `<TugBox variant="plain">` with flex-row |
| `cg-size-group` | 3 | Button size grouping | `<TugBox variant="plain">` with flex-row |
| `cg-matrix` | 2 | Button grid wrapper | `<TugBox variant="plain">` |
| `cg-subtype-block` | 3 | Subtype section wrapper | `<TugBox variant="plain">` |
| `cg-st-readout` | 1 | Bordered readout box | `<TugBox variant="bordered">` |
| `cg-st-preview` | 1 | Bordered preview area | `<TugBox variant="bordered">` |
| `cg-st-readout-row` | 3 | Readout row | `<TugBox variant="plain">` with flex-row |
| `cg-st-preview-row` | 5 | Preview row | `<TugBox variant="plain">` with flex-row |
| `cg-st-controls` | 1 | Controls column | `<TugBox variant="plain">` |
| `cg-st-slider-row` | 2 | Slider row | `<TugBox variant="plain">` with flex-row |
| `cg-cascade-table` | 2 | Cascade display table | Keep as `<table>` — TugBox is not a table |
| `cg-mutation-tx-controls` | 2 | Control row | `<TugBox variant="plain">` with flex-row |
| `cg-mutation-tx-slider-group` | 2 | Slider group | `<TugBox variant="plain">` with flex-row |
| `cg-tab-bar-demo` | 1 | Demo wrapper | `<TugBox variant="plain">` |
| `cg-popup-button-demo` | 1 | Demo wrapper | `<TugBox variant="plain">` with flex-row |
| `cg-mutation-demo` | 1 | Demo wrapper | `<TugBox variant="plain">` |
| `cg-anim-stages` | 1 | Stage list | `<TugBox variant="plain">` |
| `cg-anim-token-legend` | 1 | Legend layout | `<TugBox variant="plain">` with flex-row |
| `cg-anim-token-entry` | 1 | Legend entry | `<TugBox variant="plain">` with flex-row |
| `cg-anim-pct-row` | 1 | Control row | `<TugBox variant="plain">` with flex-row |
| `cg-observable-props-stage` | 1 | Demo stage | `<TugBox variant="bordered">` |

**Note:** Many of these containers need flex-direction, gap, and alignment. TugBox's `plain` variant renders a `<fieldset>` with no visible chrome. The `cg-*` class can remain alongside TugBox to supply the flex layout, or TugBox can accept style/className props for layout. Either approach works — the key is that the container IS a TugBox so it participates in the disabled cascade and carries the component identity.

## Step 4: Raw HTML controls to tug components

| Raw element | Count | Files | Tug replacement |
|------------|-------|-------|-----------------|
| `<input type="range">` | 5 | gallery-scale-timing, gallery-animator, gallery-mutation-tx, gallery-badge | `<TugSlider>` |
| `<input type="checkbox">` | 2 | gallery-scale-timing, gallery-title-bar | `<TugCheckbox>` |
| `<input type="number">` | 1 | gallery-observable-props | `<TugValueInput>` |
| `<input type="color">` | 2 | gallery-mutation-tx, gallery-observable-props | No tug equivalent — keep for now |

Each replacement requires wiring the control into the responder chain via `useResponderForm` or direct state management.

## Step 5: Remove dead CSS

After all migrations:
- Remove replaced `cg-*` rules from `gallery.css`
- Remove unused rules: `cg-control-select`, `cg-demo-trigger`, `cg-demo-controls`
- Keep demo-target rules (`cg-mutation-box`, `cg-anim-dot`, etc.)
- Layout rules (`cg-content`, `cg-section`, etc.) can be removed if TugBox + className handles layout, or kept as supplementary layout classes on TugBox

## Files

All files are in `tugdeck/src/components/tugways/cards/`:

| File | Changes |
|------|---------|
| `gallery.css` | Remove migrated rules, keep demo-target rules |
| All 46 `gallery-*.tsx` | Steps 1-4 replacements as applicable |
