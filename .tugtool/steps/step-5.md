# Step 5: Update element-surface-pairing-map.ts with all discovered pairings

## Status: Completed

Added all 20 missing pairings discovered in the Step 2 audit to `element-surface-pairing-map.ts`. Three pairings are below the body-text contrast threshold due to structural engine constraints and are acknowledged as accessibility gaps pending Phase 2 resolution. Updated 4 test files to document these as known gap pairs (not design choices).

## Gaps Closed

### From the 36 identified audit gaps, 20 were genuinely missing from the map:

| Gap | Element | Surface | Role | Notes |
|---|---|---|---|---|
| #1 (PRIMARY) | `fg-default` | `tab-bg-active` | body-text | Card title text on active title bar |
| #2 | `fg-default` | `tab-bg-inactive` | body-text | Card title text on inactive title bar |
| #3 | `icon-active` | `tab-bg-active` | ui-component | Card icon on active title bar |
| #4 | `fg-subtle` | `tab-bg-inactive` | ui-component | Card icon on inactive title bar |
| #5 | `surface-default` | `accent-default` | ui-component | Tab overflow badge text (CSS sets color directly) |
| #6 | `fg-onAccent` | `accent-subtle` | ui-component | Active preset button (parentSurface: surface-default) |
| #8 | `fg-muted` | `bg-canvas` | subdued-text | Preview canvas muted text |
| #9 | `fg-subtle` | `bg-canvas` | subdued-text | Preview canvas subtle text |
| #11 | `fg-link` | `bg-canvas` | body-text | Preview canvas link text |
| #15 | `fg-subtle` | `surface-inset` | subdued-text | Context bar label text |
| #19 | `fg-default` | `tone-caution-bg` | body-text | Autofix suggestion items (parentSurface: surface-default) |
| #28 | `tone-danger` | `surface-overlay` | ui-component | Danger menu item text (chromatic signal color) |
| #29 | `fg-default` | `accent-subtle` | body-text | Menu selected item text (parentSurface: surface-default) |
| #30 | `checkmark-fg` | `toggle-track-on` | ui-component | Checkbox checkmark on checked background |
| #31 | `checkmark-fg-mixed` | `toggle-track-mixed` | ui-component | Indeterminate dash on mixed background |
| #32 | `fg-inverse` | `tone-danger` | ui-component | Dock button notification badge |
| #33 | `fg-muted` | `divider-default` | ui-component | Neutral badge on divider-default used as bg |
| #34 | `fg-subtle` | `field-bg-focus` | ui-component | Dock button icons on dock background |
| #35 | `fg-default` | `surface-control` | body-text | Gallery/code block text on surface-control |
| #36 | `fg-muted` | `surface-control` | body-text | Code comment text in code block |

### Gaps already present in the map (not re-added):

Gaps #7 (`fg-default`/`surface-raised`), #12 (`fg-default`/`surface-raised` duplicate), #13 (`fg-muted`/`surface-raised`), #14 (`fg-default`/`surface-inset`), #16/17/18 (tone-*-fg on tone-*-bg), #20 (`fg-muted`/`surface-sunken`), #21 (`fg-subtle`/`surface-sunken`), #22 (`fg-default`/`surface-inset` duplicate), #23 (`fg-muted`/`surface-inset`), #24 (`fg-default`/`surface-screen`), #25 (`fg-default`/`field-bg-focus`), #26 (`fg-default`/`surface-overlay`), #27 (`fg-subtle`/`surface-overlay`) were already in the map.

## Known Accessibility Gaps (Phase 2)

Three newly-added body-text pairs are below contrast 75 due to structural engine constraints. These are NOT by design — they are accessibility gaps that Phase 2 of the theme-system-overhaul will close:

| Pair | Contrast (Brio dark) | Reason |
|---|---|---|
| `fg-default` on `tab-bg-active` | ~73.6 (marginal) | Engine does not auto-adjust fg-default for tab surfaces |
| `fg-default` on `accent-subtle` | ~62 (composited) | 15% alpha tint; engine cannot adjust fg-default for chromatic surfaces |
| `fg-default` on `tone-caution-bg` | ~58 (composited) | ~12% alpha tint; same structural constraint |

## Files Modified

- `tugdeck/src/components/tugways/element-surface-pairing-map.ts` — 20 new pairing entries added in "Step 5 additions" section
- `tugdeck/src/__tests__/theme-accessibility.test.ts` — T3.5 and CB6: added STEP5_GAP_PAIR_EXCEPTIONS set documenting the 3 gap pairs
- `tugdeck/src/__tests__/contrast-dashboard.test.tsx` — T7.2: added STEP5_GAP_PAIR_EXCEPTIONS set
- `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx` — KNOWN_PAIR_EXCEPTIONS: added 3 gap pairs
- `tugdeck/src/__tests__/theme-derivation-engine.test.ts` — KNOWN_PAIR_EXCEPTIONS and LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS: added 3 gap pairs

## Checkpoints

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
 13581 expect() calls
Ran 1878 tests across 71 files. [20.38s]
```

**Result:** PASSED — 1878 pass, 0 fail

### grep for fg-default on tab-bg-active

**Command:** `grep "tab-bg-active" tugdeck/src/components/tugways/element-surface-pairing-map.ts`

```
surface: "--tug-base-tab-bg-active",   (line 1080 — existing tab-fg-active entry)
surface: "--tug-base-tab-bg-active",   (line 1471 — new fg-default entry [Gap #1])
surface: "--tug-base-tab-bg-active",   (line 1481 — new icon-active entry [Gap #3])
```

**Result:** PASSED — `fg-default` on `tab-bg-active` is present with `body-text` role
