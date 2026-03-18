# Step 6: Add @tug-pairings comment blocks to all component CSS files

## Status: Completed

Added `@tug-pairings` comment blocks to all 23 component CSS files in `tugdeck/src/components/tugways/` and `tugdeck/src/components/tugways/cards/`. Each block lists all foreground-on-background pairings for that component per Spec S02 format, placed immediately after the file-level docblock.

## Files Modified

- `tugdeck/src/components/tugways/tug-button.css` — 48 pairing entries (fg+icon per emphasis/role/state)
- `tugdeck/src/components/tugways/tug-card.css` — 7 pairing entries
- `tugdeck/src/components/tugways/tug-tab.css` — 8 pairing entries
- `tugdeck/src/components/tugways/tug-menu.css` — 9 pairing entries
- `tugdeck/src/components/tugways/tug-dialog.css` — 5 pairing entries
- `tugdeck/src/components/tugways/tug-badge.css` — 23 pairing entries
- `tugdeck/src/components/tugways/tug-switch.css` — 4 pairing entries (3 decorative + 1 label)
- `tugdeck/src/components/tugways/tug-checkbox.css` — 3 pairing entries
- `tugdeck/src/components/tugways/tug-input.css` — 6 pairing entries
- `tugdeck/src/components/tugways/tug-label.css` — 2 pairing entries
- `tugdeck/src/components/tugways/tug-marquee.css` — 1 pairing entry
- `tugdeck/src/components/tugways/tug-data.css` — 3 pairing entries
- `tugdeck/src/components/tugways/tug-code.css` — 8 pairing entries
- `tugdeck/src/components/tugways/tug-dock.css` — 2 pairing entries
- `tugdeck/src/components/tugways/tug-hue-strip.css` — 1 pairing entry
- `tugdeck/src/components/tugways/tug-skeleton.css` — declarative "no pairings" block (decorative only)
- `tugdeck/src/components/tugways/tug-inspector.css` — 2 pairing entries (1 has hardcoded bg)
- `tugdeck/src/components/tugways/style-inspector-overlay.css` — descriptive block noting hardcoded oklch, 6 logical pairings listed
- `tugdeck/src/components/tugways/cards/gallery-card.css` — 5 pairing entries
- `tugdeck/src/components/tugways/cards/gallery-badge-mockup.css` — 7 pairing entries (filled variants only; tinted variants use non-token colors)
- `tugdeck/src/components/tugways/cards/gallery-popup-button.css` — 2 pairing entries
- `tugdeck/src/components/tugways/cards/gallery-palette-content.css` — 4 pairing entries
- `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.css` — 18 pairing entries

## Special Cases

- `tug-skeleton.css`: no text/icon pairings — purely decorative animated block; block notes this explicitly
- `style-inspector-overlay.css`: uses hardcoded oklch values exclusively — not tracked in the pairing map; block documents the 6 logical pairings for reference
- `tug-inspector.css`: one pairing has a hardcoded oklch background (`--tug-dev-overlay-bg`); noted in the block
- All token names use post-rename names (`checkmark-fg`, `checkmark-fg-mixed`, `field-fg-label`, `field-fg-placeholder`, `field-fg-required`, `field-fg-default`, `divider-separator`)

## Checkpoints

### grep count: @tug-pairings returns 23

**Command:** `grep -rl "@tug-pairings" tugdeck/src/components/tugways/ | wc -l`

```
23
```

**Result:** PASSED — 23 files contain @tug-pairings blocks

### Spot-check: tug-card.css contains fg-default on tab-bg-active

**Command:** `grep "tab-bg-active" tugdeck/src/components/tugways/tug-card.css`

```
 * | --tug-card-title-bar-fg (fg-default) | --tug-card-title-bar-bg-active (tab-bg-active) | body-text | Card title text on active title bar [THE GAP] |
 * | --tug-card-title-bar-icon-active (icon-active) | --tug-card-title-bar-bg-active (tab-bg-active) | ui-component | Card icon on active title bar |
   --tug-card-title-bar-bg-active: var(--tug-base-tab-bg-active);
```

**Result:** PASSED — fg-default on tab-bg-active is documented in the CSS comment block

### bun run check

**Command:** `cd tugdeck && bun run check`

```
$ bunx tsc --noEmit
(no output — zero TypeScript errors)
```

**Result:** PASSED — zero TypeScript errors, exit 0

### bun test

**Command:** `cd tugdeck && bun test`

```
bun test v1.3.9 (cf6cdbbb)

 1878 pass
 0 fail
 13589 expect() calls
Ran 1878 tests across 71 files. [18.88s]
```

**Result:** PASSED — 1878 pass, 0 fail
