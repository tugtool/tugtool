# Errata — Retroactive Fixes

*Issues noted during ongoing work that need cleanup. Each item is independent — fix in any order, ideally before or during the next group build.*

---

## E01: Stale petals/pole CSS in gallery.css

**File:** `tugdeck/src/components/tugways/cards/gallery.css` (lines 487+)

**Issue:** `.tug-petals` and related keyframes (`tug-petals-rotate`, `tug-petals-fade`, `tug-petals-scale`) are legacy decorative CSS from an earlier gallery iteration. No component references them. Dead code.

**Fix:** Delete the `.tug-petals` block and associated keyframes from gallery.css.

**Noted:** Prior session (Group B work).

---

## E02: Duplicate --tugx-tooltip-* aliases in tug-menu.css

**File:** `tugdeck/src/components/tugways/tug-menu.css` (lines 79-81)

**Issue:** Three `--tugx-tooltip-*` aliases are defined in `tug-menu.css`:
```css
--tugx-tooltip-bg: var(--tug7-surface-global-primary-normal-screen-rest);
--tugx-tooltip-fg: var(--tug7-element-global-text-normal-default-rest);
--tugx-tooltip-border: var(--tug7-element-global-border-normal-default-rest);
```

These duplicate the authoritative definitions in `tug-tooltip.css` (lines 21-27), which owns the full set of seven `--tugx-tooltip-*` aliases. The menu file should not define tooltip aliases — it violates token sovereignty [L20].

**Fix:** Remove the three `--tugx-tooltip-*` lines from tug-menu.css. Verify no menu CSS rule references them (they shouldn't — menu uses `--tugx-menu-*`).

**Noted:** Group B tooltip dash.
