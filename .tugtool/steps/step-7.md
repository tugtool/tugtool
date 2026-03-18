# Step 7: Write cross-check verification script

## Status: Completed

Wrote `tugdeck/scripts/verify-pairings.ts`, a cross-check script that parses every
`@tug-pairings` block from all 23 component CSS files, extracts the resolved
`--tug-base-*` token pairs, and compares them against `element-surface-pairing-map.ts`.

Running the script revealed a systematic mismatch: ghost and outlined-option button
variants use transparent/semi-transparent background tokens; the `@tug-pairings`
comments initially referenced the literal CSS bg tokens (`ghost-action-bg-rest`, etc.)
but the pairing map records contrast at the effective underlying surface (`surface-default`).
Updated the CSS comment blocks in `tug-button.css`, `tug-badge.css`, and `tug-tab.css`
to align with the map convention. Script now exits 0 with zero gaps.

## Files Created

- `tugdeck/scripts/verify-pairings.ts` — cross-check verification script

## Files Modified

- `tugdeck/src/components/tugways/tug-button.css` — corrected ghost/outlined-option surface references to `surface-default`
- `tugdeck/src/components/tugways/tug-badge.css` — corrected ghost-action/ghost-danger surface references to `surface-default`
- `tugdeck/src/components/tugways/tug-tab.css` — corrected tab fg surface references to `surface-sunken`; ghost-option-fg-active surface to `surface-default`

## Implementation Notes

- The script parses `@tug-pairings` table rows from CSS comment blocks using the Spec S02 format
- Token resolution: cells starting with `--tug-base-` are used directly; component-alias cells extract the resolved name from the parenthetical `(name)` annotation
- Decorative pairings are skipped (no minimum contrast requirement)
- Entries with ambient/parent/transparent/hardcoded surfaces are skipped (no concrete token to cross-check)
- GAPS (CSS pairs not in map) cause exit code 1 — these are accessibility coverage holes
- ORPHANS (map pairs not in any CSS block) are reported as informational warnings — many pre-existing map entries were added from design intent before the CSS comment convention existed
- Exit code 0 when there are zero gaps (orphans are acceptable)

## Checkpoint: `bun run tugdeck/scripts/verify-pairings.ts`

**Command:** `bun run tugdeck/scripts/verify-pairings.ts`

```
verify-pairings: cross-checking @tug-pairings CSS blocks against element-surface-pairing-map.ts

  CSS files scanned: 23
  CSS pairings parsed (after dedup): 110
  Map entries loaded: 260
  GAPS: none — all CSS-declared pairings are covered by the map.
  ORPHANS (150) — map entries not traceable to any @tug-pairings block (informational):
    [ORPHAN] --tug-base-fg-default | --tug-base-bg-app
    ... (150 pre-existing design-intent entries)

  Result: PASS (with 150 informational orphan(s)) — zero gaps; orphans are pre-existing map entries added from design intent.
```

**Exit code:** 0

**Result:** PASSED

## Build Checks

**bun run check:** PASSED — zero TypeScript errors

**bun test:** PASSED — 1878 pass, 0 fail
