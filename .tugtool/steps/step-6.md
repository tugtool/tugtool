# Step 6: Generate and preview the rename map

## Status: Completed

Generated the complete rename map JSON, reviewed the blast-radius stats, ran the dry-run preview, and verified that both component CSS and TypeScript files show the expected rename patterns.

## Files Modified

- `tugdeck/token-rename-map.json` — generated rename map (325 non-identity entries)

## Checkpoints

### rename-map --json exits 0

**Command:** `cd tugdeck && bun run audit:tokens rename-map --json > token-rename-map.json`

```
$ bun run scripts/audit-tokens.ts rename-map --json
```

**Result:** PASSED — exit 0, token-rename-map.json generated

### rename --stats: blast radius preview

**Command:** `cd tugdeck && bun run audit:tokens rename --map token-rename-map.json --stats`

```
=== Token Rename --stats (blast radius preview) ===

Non-identity rename entries: 325
Files to modify: 58
Total replacements: 3711

Per-file replacement counts (sorted by count):
   720  src/components/tugways/element-surface-pairing-map.ts
   425  src/__tests__/theme-derivation-engine.test.ts
   326  styles/themes/harmony.css
   326  styles/tug-base-generated.css
   269  src/components/tugways/tug-button.css
   206  src/components/tugways/cards/gallery-theme-generator-content.css
   173  src/components/tugways/tug-badge.css
   157  src/__tests__/contrast-exceptions.ts
   115  src/components/tugways/derivation-rules.ts
   112  src/components/tugways/cards/gallery-badge-mockup.css
   103  src/components/tugways/cards/gallery-card.css
    91  src/components/tugways/tug-menu.css
    54  src/components/tugways/tug-tab.css
    51  src/__tests__/theme-accessibility.test.ts
    47  src/components/tugways/cards/gallery-palette-content.css
    45  src/components/tugways/tug-input.css
    39  src/components/tugways/cards/gallery-theme-generator-content.tsx
    39  src/components/tugways/tug-code.css
    37  src/components/tugways/tug-checkbox.css
    35  src/components/tugways/tug-card.css
    34  src/__tests__/gallery-theme-generator-content.test.tsx
    31  src/components/tugways/cards/gallery-popup-button.css
    27  src/components/tugways/tug-data.css
    21  src/__tests__/style-inspector-overlay.test.ts
    21  src/components/tugways/tug-dialog.css
    17  src/components/tugways/style-inspector-overlay.ts
    17  src/components/tugways/tug-inspector.css
    16  src/components/tugways/cards/gallery-cascade-inspector-content.tsx
    13  src/components/tugways/tug-hue-strip.css
    12  src/__tests__/tug-checkbox-role.test.tsx
    12  src/__tests__/tug-switch-role.test.tsx
    12  src/components/tugways/tug-switch.css
    11  src/components/tugways/tug-dock.css
     8  src/components/tugways/theme-accessibility.ts
     8  src/components/tugways/tug-label.css
     7  src/components/tugways/tug-checkbox.tsx
     7  src/components/tugways/tug-switch.tsx
     6  src/__tests__/debug-contrast.test.ts
     6  src/components/tugways/cards/gallery-palette-content.tsx
     5  src/components/tugways/cards/gallery-label-content.tsx
     5  src/components/tugways/hooks/use-css-var.ts
     4  src/__tests__/mutation-model-demo.test.tsx
     4  src/__tests__/theme-export-import.test.tsx
     4  src/components/tugways/cards/gallery-card.tsx
     4  src/components/tugways/cards/hello-card.tsx
     4  src/components/tugways/tug-marquee.css
     4  styles/tug-base.css
     3  src/components/tugways/cards/gallery-marquee-content.tsx
     3  src/components/tugways/hooks/index.ts
     3  styles/chrome.css
     2  src/canvas-color.ts
     2  src/components/chrome/disconnect-banner.tsx
     2  src/components/tugways/tug-popup-menu.tsx
     2  src/globals.css
     1  src/__tests__/convert-hex-to-tug-color.test.ts
     1  src/components/chrome/card-frame.tsx
     1  src/components/tugways/cards/gallery-checkbox-content.tsx
     1  src/components/tugways/hooks/use-dom-style.ts
```

**Result:** PASSED — 325 non-identity entries, 58 files, 3711 replacements

### rename dry-run exits 0

**Command:** `cd tugdeck && bun run audit:tokens rename --map token-rename-map.json`

```
=== Token Rename (DRY RUN) ===

src/__tests__/contrast-exceptions.ts (157 replacements):
  --tug-base-surface-default → --tug-base-surface-global-primary-normal-default-rest (1 occurrences)
  --tug-base-surface-overlay → --tug-base-surface-global-primary-normal-overlay-rest (1 occurrences)
  --tug-base-surface-screen → --tug-base-surface-global-primary-normal-screen-rest (2 occurrences)
  --tug-base-fg-muted → --tug-base-element-global-text-normal-muted-rest (1 occurrences)
  --tug-base-fg-subtle → --tug-base-element-global-text-normal-subtle-rest (2 occurrences)
  --tug-base-fg-disabled → --tug-base-element-global-text-normal-plain-disabled (1 occurrences)
  --tug-base-fg-inverse → --tug-base-element-global-text-normal-inverse-rest (4 occurrences)
  ...

src/components/tugways/tug-button.css (271 replacements):
  --tug-base-surface-default → --tug-base-surface-global-primary-normal-default-rest (24 occurrences)
  --tug-base-control-filled-accent-bg-rest → --tug-base-surface-control-primary-filled-accent-rest (5 occurrences)
  --tug-base-control-filled-accent-bg-hover → --tug-base-surface-control-primary-filled-accent-hover (5 occurrences)
  --tug-base-control-filled-accent-bg-active → --tug-base-surface-control-primary-filled-accent-active (5 occurrences)
  --tug-base-control-filled-action-bg-rest → --tug-base-surface-control-primary-filled-action-rest (5 occurrences)
  ...

src/components/tugways/tug-badge.css (173 replacements):
  --tug-base-surface-default → --tug-base-surface-global-primary-normal-default-rest (21 occurrences)
  --tug-base-fg-inverse → --tug-base-element-global-text-normal-inverse-rest (6 occurrences)
  --tug-base-tone-accent-fg → --tug-base-element-tone-text-normal-accent-rest (2 occurrences)
  ...

src/components/tugways/element-surface-pairing-map.ts (720 replacements):
  --tug-base-bg-app → --tug-base-surface-global-primary-normal-app-rest (2 occurrences)
  --tug-base-bg-canvas → --tug-base-surface-global-primary-normal-canvas-rest (5 occurrences)
  --tug-base-surface-default → --tug-base-surface-global-primary-normal-default-rest (115 occurrences)
  --tug-base-surface-raised → --tug-base-surface-global-primary-normal-raised-rest (13 occurrences)
  --tug-base-surface-overlay → --tug-base-surface-global-primary-normal-overlay-rest (9 occurrences)
  ...

src/components/tugways/cards/gallery-theme-generator-content.tsx (39 replacements):
  --tug-base-bg-canvas → --tug-base-surface-global-primary-normal-canvas-rest (1 occurrences)
  --tug-base-surface-default → --tug-base-surface-global-primary-normal-default-rest (1 occurrences)
  --tug-base-surface-overlay → --tug-base-surface-global-primary-normal-overlay-rest (1 occurrences)
  --tug-base-surface-sunken → --tug-base-surface-global-primary-normal-sunken-rest (1 occurrences)
  --tug-base-fg-default → --tug-base-element-global-text-normal-default-rest (2 occurrences)
  ...

styles/tug-base.css (4 replacements):
  --tug-base-surface-control → --tug-base-surface-global-primary-normal-control-rest (1 occurrences)
  --tug-base-fg-default → --tug-base-element-global-text-normal-default-rest (1 occurrences)
  --tug-base-border-default → --tug-base-element-global-border-normal-default-rest (1 occurrences)
  --tug-base-border-muted → --tug-base-element-global-border-normal-muted-rest (1 occurrences)

Total: 4144 replacements across 68 files

This was a DRY RUN. Use --apply to write changes.
```

**Result:** PASSED — exit 0, 4144 replacements across 68 files, patterns look correct

## Spot-Check Results

Component CSS files (e.g. `tug-button.css`, `tug-badge.css`) show correct `var()` reference renames: short names like `--tug-base-surface-default` map to full six-slot names like `--tug-base-surface-global-primary-normal-default-rest`.

TypeScript files (e.g. `element-surface-pairing-map.ts`, `gallery-theme-generator-content.tsx`) show correct string key updates using the same rename patterns.

No surprises in the dry-run output. File count (68) and replacement count (4144 including identity mappings, 3711 non-identity) are within expected range. The rename map is ready for `--apply` in step 7.
