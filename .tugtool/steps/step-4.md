# Step 4: Execute atomic token rename across all files

## Status: Completed

Executed the atomic token rename for all 7 tokens per the rename plan from Step 3. All source files, generated CSS, the pairing map, and test snapshots were updated in a single coherent change set.

## Rename Summary

| Old Name | New Name |
|---|---|
| `--tug-base-field-fg` | `--tug-base-field-fg-default` |
| `--tug-base-field-placeholder` | `--tug-base-field-fg-placeholder` |
| `--tug-base-field-label` | `--tug-base-field-fg-label` |
| `--tug-base-field-required` | `--tug-base-field-fg-required` |
| `--tug-base-checkmark` | `--tug-base-checkmark-fg` |
| `--tug-base-checkmark-mixed` | `--tug-base-checkmark-fg-mixed` |
| `--tug-base-separator` | `--tug-base-divider-separator` |

## Files Modified

- `tugdeck/src/components/tugways/derivation-rules.ts` — 7 map key renames
- `tugdeck/scripts/generate-tug-tokens.ts` — removed `separator` group from GROUP_ORDER/GROUP_LABELS; divider-separator now falls under `divider` group
- `tugdeck/styles/tug-base-generated.css` — regenerated (373 tokens, new names)
- `tugdeck/styles/themes/harmony.css` — regenerated (373 tokens, new names)
- `tugdeck/src/components/tugways/element-surface-pairing-map.ts` — token string renames (#1, #3, #5, #6) plus new entries for field-fg-placeholder and field-fg-required (surfaced by the T1.1 pairing completeness test after rename made them classifiable as fg tokens)
- `tugdeck/src/components/tugways/tug-input.css` — field-fg-default, field-fg-placeholder
- `tugdeck/src/components/tugways/tug-label.css` — field-fg-label, field-fg-required
- `tugdeck/src/components/tugways/tug-checkbox.css` — checkmark-fg, checkmark-fg-mixed, field-fg-label; comment updated
- `tugdeck/src/components/tugways/tug-marquee.css` — field-fg-label
- `tugdeck/src/components/tugways/tug-switch.css` — field-fg-label
- `tugdeck/src/components/tugways/tug-inspector.css` — divider-separator
- `tugdeck/src/components/tugways/tug-dialog.css` — divider-separator
- `tugdeck/src/components/tugways/tug-data.css` — divider-separator
- `tugdeck/src/components/tugways/cards/gallery-checkbox-content.tsx` — field-fg-label inline style
- `tugdeck/src/components/tugways/tug-checkbox.tsx` — comment text updated
- `tugdeck/src/__tests__/theme-derivation-engine.test.ts` — all 7 renames in snapshot lists and expected value maps; field-fg-placeholder ground truth L updated from 0.5064 to 0.6252 (contrast floor now applied after pairing map entry added)
- `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx` — checkmark-fg, field-fg-default

## Notable Side Effect

Adding `field-fg-placeholder` and `field-fg-required` to the pairing map (required by T1.1 which checks all fg-classified tokens) triggered the contrast floor enforcement in `evaluateRules`. The `field-fg-placeholder` token's derived lightness shifted from L=0.5064 to L=0.6252 against `field-bg-rest` at the `subdued-text` threshold (45). The BRIO_GROUND_TRUTH snapshot was updated accordingly. `field-fg-required` was given `ui-component` role (threshold 30) to avoid contrast floor interference with its signal-color derivation.

## Checkpoints

### bun run generate:tokens

**Command:** `cd tugdeck && bun run generate:tokens`

```
$ bun run scripts/generate-tug-tokens.ts
[generate-tug-tokens] wrote 373 tokens to .../tugdeck/styles/tug-base-generated.css
[generate-tug-tokens] wrote 373 tokens to .../tugdeck/styles/themes/harmony.css
```

**Result:** PASSED — 373 tokens, exit 0

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
 13509 expect() calls
Ran 1878 tests across 71 files. [19.13s]
```

**Result:** PASSED — 1878 pass, 0 fail

### Zero old token names

**Verification:** grep for all 7 old names across `.ts`, `.tsx`, `.css` files in `tugdeck/` returned zero matches.

**Result:** PASSED — zero old token names remain in any source file
