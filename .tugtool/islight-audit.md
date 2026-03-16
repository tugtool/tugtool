# isLight Branch Audit — theme-derivation-engine.ts

**Purpose:** Catalog all 81 `isLight` occurrences in `deriveTheme()`, categorize each by type,
and document proposed ModePreset absorption targets for the declarative refactor.

**File:** `tugdeck/src/components/tugways/theme-derivation-engine.ts`
**Total occurrences:** 81 (confirmed by grep)

---

## Occurrence Categories

| Category | Description |
|----------|-------------|
| **hue-slot** | Which hue ref/angle/name to use (e.g., `txtRefW` vs `fgInverseRef`) |
| **intensity** | Which intensity value to use for `setChromatic` |
| **tone** | Which tone value to use |
| **alpha** | Which alpha value to use |
| **structural** | `setWhite` vs `setChromatic`, `setShadow` vs `setHighlight`, transparent vs chromatic |

---

## Non-Branch Occurrences (comments/declarations — not absorption targets)

| # | Line | Content | Notes |
|---|------|---------|-------|
| 1 | 148 | JSDoc comment mentioning `isLight` | Documentation only |
| 2 | 151 | JSDoc comment mentioning `isLight` | Documentation only |
| 3 | 703 | `const isLight = recipe.mode === "light"` | Variable declaration |
| 4 | 708 | Comment: `` `isLight` branches`` | Comment only |
| 5 | 709 | `const preset = isLight ? LIGHT_PRESET : DARK_PRESET` | Already in ModePreset |

---

## Actual Branches (76 decision points across the function body)

The 76 remaining lines contain the branches to be absorbed. Many lines have multiple `isLight`
references for the same token — those are counted as one logical branch.

---

### GROUP 1: Foreground Hue Slot Selection (lines 875–910)

These 4 branches select which hue to use for per-tier foreground tokens. In light mode, all fg
tiers collapse to `txtHue`; in dark mode, each tier uses a distinct per-tier hue offset derived
from the Brio migration mapping.

| Branch # | Line | Token Context | Dark value | Light value | Category | Proposed field |
|----------|------|---------------|------------|-------------|----------|----------------|
| 1 | 875 | `fgMutedHue` | primary extract of `txtHue` | `txtHue` (bare) | hue-slot | `fgMutedHueSlot` |
| 2 | 886 | `fgSubtleHue` | `"indigo-cobalt"` | `txtHue` | hue-slot | `fgSubtleHueSlot` |
| 3 | 893 | `fgDisabledHue` | `"indigo-cobalt"` | `txtHue` | hue-slot | `fgDisabledHueSlot` |
| 4 | 906 | `fgInverseHue` | `"sapphire-cobalt"` | `txtHue` | hue-slot | `fgInverseHueSlot` |

**Notes:**
- In dark mode, `fgMutedHue` extracts the primary base name from `txtHue` (e.g., "cobalt" from "indigo-cobalt")
- In light mode, all four collapse to `txtHue` — the per-tier hue differentiation is a dark-mode-only pattern
- Proposed absorption: add `fgMutedHueSlot`, `fgSubtleHueSlot`, `fgDisabledHueSlot`, `fgInverseHueSlot` to ModePreset as enum-like values (`"txt"` | `"txtBarePrimary"` | `"indigo-cobalt"` | `"sapphire-cobalt"`)

---

### GROUP 2: Surface bg-app / bg-canvas / Surface Tiers (lines 1014–1077)

8 branches selecting hue ref for surface tokens. In light mode, surfaces use `atmRefW` or `txtRefW`;
in dark mode, they use `canvasRefW` or `surfBareBaseRef` or `surfScreenRefDark`.

| Branch # | Line | Token | Dark hue source | Light hue source | Dark intensity | Light intensity | Category |
|----------|------|-------|-----------------|------------------|----------------|-----------------|----------|
| 5 | 1014 | `bg-app` | `canvasRefW`, i=2 | `txtRefW`, i=`atmI` | 2 | `atmI` | hue-slot + intensity |
| 6 | 1021 | `bgCanvasTone` (tone calc) | `darkBgCanvas` | `35 + (sc/100)*10` | — | — | tone |
| 7 | 1022 | `bg-canvas` | `canvasRefW`, i=2 | `atmRefW`, i=7 | 2 | 7 | hue-slot + intensity |
| 8 | 1029 | `surface-sunken` | `surfBareBaseRef`, i=`atmI` | `atmRefW`, i=`atmI` | same | same | hue-slot |
| 9 | 1036 | `surface-default` | `surfBareBaseRef`, i=`atmI` | `atmRefW`, i=4 | `atmI` | 4 | hue-slot + intensity |
| 10 | 1044 | `surface-raised` | `atmRefW`, i=`atmI` | `txtRefW`, i=5 | `atmI` | 5 | hue-slot + intensity |
| 11 | 1051 | `surface-overlay` | `surfBareBaseRef`, i=4 | `atmRefW`, i=6 | 4 | 6 | hue-slot + intensity |
| 12 | 1058 | `surface-inset` | `atmRefW`, i=`atmI` | `atmRefW`, i=4 | `atmI` | 4 | intensity |
| 13 | 1065 | `surface-content` | `atmRefW`, i=`atmI` | `atmRefW`, i=4 | `atmI` | 4 | intensity |
| 14 | 1073 | `surface-screen` | `surfScreenRefDark`, i=`txtISubtle` | `txtRefW`, i=4 | `txtISubtle` | 4 | hue-slot + intensity |

**Notes:**
- `bgCanvasTone` (branch 6) uses a different formula in light mode: `35 + (surfaceContrast/100)*10` vs dark `darkBgCanvas`
- bg-app light uses `txtRefW` (text hue drives bg-app in light mode, Harmony pattern)
- surface-raised light uses `txtRefW` (text hue, Harmony pattern)
- surface-screen light uses `txtRefW` (text hue, Harmony pattern)
- The `bgCanvasTone` formula difference can become a preset field: `bgCanvasLightBase: 35`, `bgCanvasLightScale: 10` or absorb the formula result as a computed expression
- Proposed hue slots: `bgAppHueSlot` (`"canvas"` dark | `"txt"` light), `bgCanvasHueSlot` (`"canvas"` dark | `"atm"` light), `surfaceSunkenHueSlot` (`"surfBareBase"` dark | `"atm"` light), `surfaceDefaultHueSlot` (`"surfBareBase"` dark | `"atm"` light), `surfaceRaisedHueSlot` (`"atm"` dark | `"txt"` light), `surfaceOverlayHueSlot` (`"surfBareBase"` dark | `"atm"` light), `surfaceScreenHueSlot` (`"surfScreenDark"` dark | `"txt"` light)

---

### GROUP 3: fg-inverse intensity/hue (lines 1093–1094)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 15 | 1093 | `fgInverseI` | `txtI` | `1` | intensity | `fgInverseI` (in ModePreset already — but as numeric value) |
| 16 | 1094 | `fg-inverse` hue ref | `fgInverseRef`/`fgInverseAngle`/`fgInversePrimaryName` | `txtRefW`/`txtAngleW`/`txtNameW` | hue-slot | `fgInverseHueSlot` (already in GROUP 1) |

**Notes:**
- `fgInverseI` is 1 in light vs `txtI` (3) in dark — absorption: add `fgInverseI` to ModePreset
- The hue-slot for fg-inverse is the same as GROUP 1 branch 4 (`fgInverseHueSlot`)

---

### GROUP 4: fg-placeholder / field-related foreground (line 1097)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 17 | 1097 | `fg-placeholder` | `fgPlaceholderRef`/`fgPlaceholderAngle` at `fgPlaceholderI` | `atmRefW`/`atmAngleW` at `atmIBorder` | hue-slot | `fgPlaceholderHueSlot` |

**Notes:**
- In dark: uses per-tier fg hue (bare cobalt); in light: uses atmosphere hue
- `fgPlaceholderI` is `atmIBorder` in both modes (same field), but hue source differs

---

### GROUP 5: fg-onAccent / fg-onDanger structural (line 1109)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 18 | 1109 | `fg-onAccent` | `setChromatic(fgInverseRef, txtI, 100)` | `setWhite()` | structural | sentinel hue slot: `fgOnAccentHueSlot` |
| 19 | 1109 | `fg-onDanger` | `setChromatic(fgInverseRef, txtI, 100)` | `setWhite()` | structural | sentinel hue slot: `fgOnDangerHueSlot` |

**Notes:**
- These are structural branches (setWhite vs setChromatic) — the sentinel value for light = "white"
- Proposed: add `fgOnAccentIsWhite: boolean` or `fgOnAccentHueSlot: "white" | "fgInverse"` sentinel fields

---

### GROUP 6: fg-onCaution / fg-onSuccess intensity (line 1118–1119)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 20 | 1118 | `fg-onCaution` intensity | `4` | `atmI` (5) | intensity | Note: both i=4 dark, i=atmI=5 light — trivially different |
| 21 | 1119 | `fg-onSuccess` intensity | `4` | `atmI` (5) | intensity | same |

**Notes:**
- Tone is literally `7` in both modes (already same), so the tone branch is a no-op: `isLight ? 7 : 7`
- Intensity: dark=4, light=atmI. Proposed: `fgOnCautionI` and `fgOnSuccessI` preset fields
- These are currently functionally identical (4 vs 5 at tone=7) — but capturing the intent matters

---

### GROUP 7: icon-muted hue slot (line 1127)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 22 | 1127 | `icon-muted` | `fgSubtleRef/fgSubtleAngle` at `txtISubtle/fgSubtleTone` | `atmRefW/atmAngleW` at `atmIBorder/fgPlaceholderTone` | hue-slot + intensity + tone | `iconMutedHueSlot` |

**Notes:**
- Dark: follows fg-subtle (indigo-cobalt), same intensity/tone as fg-subtle
- Light: follows atm hue at border intensity and placeholder tone
- Proposed: `iconMutedHueSlot: "fgSubtle" | "atmBorder"` sentinel

---

### GROUP 8: icon-active tone (line 1136)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 23 | 1136 | `icon-active` tone | `80` | `22` | tone | `iconActiveTone` |

---

### GROUP 9: icon-onAccent structural (line 1139)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 24 | 1139 | `icon-onAccent` | `setChromatic(fgInverseRef, txtI, 100)` | `setWhite()` | structural | sentinel: `iconOnAccentIsWhite` |

---

### GROUP 10: border-muted tone/intensity (lines 1170–1171)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 25 | 1170 | `borderMutedTone` | `fgSubtleTone` (37) | `36` | tone | `borderMutedTone` |
| 26 | 1171 | `borderMutedI` | `borderIStrong` (7) | `10` | intensity | `borderMutedI` |

---

### GROUP 11: border-strong tone (line 1180)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 27 | 1180 | `borderStrongTone` | `40` | `Math.round(fgSubtleTone - 6)` (≈24) | tone | `borderStrongTone` |

**Notes:**
- Light formula uses `fgSubtleTone` (a preset value=30), so result is ~24
- Proposed: `borderStrongDarkTone: 40` and absorb light formula as `Math.round(preset.fgSubtleTone - 6)`
- Since fgSubtleTone is already in preset, this can be expressed without a new field

---

### GROUP 12: divider tone calculations (lines 1194–1195)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 28 | 1194 | `dividerDefaultTone` | `17` | `Math.round(darkSurfaceOverlay - 2)` | tone | `dividerDefaultTone` |
| 29 | 1195 | `dividerMutedTone` | `15` | `Math.round(darkSurfaceOverlay)` | tone | `dividerMutedTone` |

**Notes:**
- `darkSurfaceOverlay` is computed from `preset.surfaceOverlayTone + ...` formula, so light result depends on surfaceContrast
- Proposed: add `dividerDefaultDarkTone: 17`, `dividerMutedDarkTone: 15` to preset for dark; light remains computed

---

### GROUP 13: divider-default intensity / divider-muted hue slot (lines 1210, 1212)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 30 | 1210 | `divider-default` intensity | `6` | `atmI` (5) | intensity | `dividerDefaultI` |
| 31 | 1212 | `divider-muted` hue slot | `borderTintBareBaseName/borderTintBareAngle` at i=4 | `borderTintRefW/borderTintAngleW` at i=`atmI` | hue-slot + intensity | `dividerMutedHueSlot` |

---

### GROUP 14: selection-bg-inactive hue slot (line 1386)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 32 | 1386 | `selection-bg-inactive` | `"yellow"`, i=0, t=30, a=25 | `atmHue-20°` w/ warmth bias, i=8, t=24, a=20 | hue-slot + intensity + tone + alpha | sentinel hue slot: `selectionInactiveHueSlot` |

**Notes:**
- Dark: fixed "yellow" hue (sentinel)
- Light: computed from atm angle - 20° with warmth bias
- This is the `selectionInactive` computed hue described in plan Step 3

---

### GROUP 15: highlight-hover / highlight-dropTarget etc. (line 1399)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 33 | 1399 | `highlight-hover` | white verbatim `--tug-color(white, i: 0, t: 100, a: 5)` | `setShadow(4)` (black a=4) | structural | sentinel: `highlightHoverIsWhite` |
| 34 | 1399 | `highlight-dropTarget/preview/inspectorTarget/snapGuide` | `setChromatic(interactiveRef, 50, 50, N)` | same | (same in both modes — no branch difference) | — |

**Notes:**
- highlight-hover is the primary structural branch: dark=white overlay, light=shadow
- The interactive highlight tokens (dropTarget etc.) are the same in both modes — no branch here

---

### GROUP 16: tab-bg-active / tab-bg-inactive / tab-bg-collapsed hue slots (lines 1435–1456)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 35 | 1435 | `tab-bg-active` | `cardFrameRefW` at `cfActiveI/cfActiveTone` | `atmRefW` at `cfActiveI/cfActiveTone` | hue-slot | `tabBgActiveHueSlot` |
| 36 | 1442 | `tab-bg-inactive` | `cardFrameRefW` at `cfInactiveI/cfInactiveTone` | `atmRefW` at `cfInactiveI/cfInactiveTone` | hue-slot | `tabBgInactiveHueSlot` |
| 37 | 1449 | `tab-bg-collapsed` | `atmRefW` at `cfInactiveI/cfInactiveTone` | `atmRefW` at `cfInactiveI/cfInactiveTone` | (same both modes) | — |
| 38 | 1456 | `tab-bg-hover` | `setHighlight(8)` | `setShadow(6)` | structural | sentinel: `tabBgHoverIsHighlight` |

**Notes:**
- tab-bg-collapsed is the same in both modes — no actual branch difference
- tab-bg-hover: dark=white highlight, light=shadow — structural sentinel

---

### GROUP 17: tab-fg-active tone / tab-close-bg-hover (lines 1466, 1473)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 39 | 1466 | `tabFgActiveTone` | `90` | `fgDefaultTone` (13) | tone | `tabFgActiveTone` |
| 40 | 1473 | `tab-close-bg-hover` | `setHighlight(12)` | `setShadow(10)` | structural | sentinel: `tabCloseBgHoverIsHighlight` |

---

### GROUP 18: control-disabled-bg (lines 1489–1490)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 41 | 1489 | `disabledBgTone` | `22` | `Math.round(70 + (sc/100)*10)` | tone | `disabledBgDarkTone: 22` |
| 42 | 1490 | `control-disabled-bg` hue | `surfBareBaseRef` at `atmI` | `atmRefW` at `6` | hue-slot + intensity | `disabledBgHueSlot` |

---

### GROUP 19: control-disabled-fg/border tones (lines 1495–1498)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 43 | 1495 | `disabledFgTone` | `38` | `fgDisabledTone` (44) | tone | `disabledFgDarkTone: 38` |
| 44 | 1497 | `disabledBorderTone` | `28` | `Math.round(dividerTone)` | tone | `disabledBorderDarkTone: 28` |
| 45 | 1498 | `control-disabled-border` intensity | `6` | `atmIBorder` | intensity | `disabledBorderI` |

---

### GROUP 20: outlinedBg tones (lines 1538–1540)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 46 | 1538 | `outlinedBgRestTone` | `Math.round(darkSurfaceInset + 2)` | `51` | tone | `outlinedBgRestLightTone: 51` |
| 47 | 1539 | `outlinedBgHoverTone` | `Math.round(darkSurfaceRaised + 1)` | `99` | tone | `outlinedBgHoverLightTone: 99` |
| 48 | 1540 | `outlinedBgActiveTone` | `Math.round(darkSurfaceOverlay)` | `48` | tone | `outlinedBgActiveLightTone: 48` |

**Notes:**
- Dark values are computed from surface tones (preset-derived), not fixed constants
- Light values are fixed constants — proposed as new preset fields

---

### GROUP 21: control-outlined-action bg-hover/active (lines 1649–1654)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 49 | 1649 | `outlined-action-bg-hover` | `setHighlight(10)` | `setChromatic(atmRefW, 4, outlinedBgHoverTone)` | structural | sentinel: `outlinedBgHoverHueSlot` |
| 50 | 1649 | `outlined-action-bg-active` | `setHighlight(20)` | `setChromatic(atmRefW, 6, outlinedBgActiveTone)` | structural | sentinel: `outlinedBgActiveHueSlot` |

---

### GROUP 22: control-outlined-action fg/icon (lines 1656–1670)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 51 | 1656 | `outlined-action-fg-rest` | `txtRefW`, i=`max(1,txtI-1)`, t=100 (white) | `txtRefW`, i=`txtI`, t=`fgDefaultTone` | tone + intensity | `outlinedActionFgRestDarkTone: 100` |
| 52 | 1656 | `outlined-action-fg-hover` | same as above | `txtRefW`, i=`txtI`, t=10 | tone | `outlinedActionFgHoverLightTone: 10` |
| 53 | 1656 | `outlined-action-fg-active` | same as above | `txtRefW`, i=`txtI`, t=8 | tone | `outlinedActionFgActiveLightTone: 8` |
| 54 | 1656 | `outlined-action-icon-rest` | `txtRefW`, i=`max(1,txtI-1)`, t=100 | `txtRefW`, i=`txtISubtle`, t=`fgMutedTone` | tone + intensity | parallel to fg-rest |
| 55 | 1656 | `outlined-action-icon-hover` | same | `txtRefW`, i=`txtISubtle`, t=22 | tone | `outlinedActionIconHoverLightTone: 22` |
| 56 | 1656 | `outlined-action-icon-active` | same | `txtRefW`, i=`txtISubtle`, t=13 | tone | `outlinedActionIconActiveLightTone: 13` |

**Notes:**
- This pattern repeats for `outlined-agent` (GROUP 23) and `outlined-option` (GROUP 26)
- The [D10] flat preset fields will capture all of these per-state values

---

### GROUP 23: control-outlined-agent bg/fg/icon (lines 1680–1701)

Same pattern as GROUP 22. All isLight branches are parallel to outlined-action:

| Branch # | Lines | Tokens | Category | Proposed field |
|----------|-------|--------|----------|----------------|
| 57–62 | 1680–1701 | `outlined-agent-bg-hover/active`, `outlined-agent-fg/icon-*` | structural + tone + intensity | Same [D10] pattern fields as outlined-action |

---

### GROUP 24: control-ghost-action bg-hover/active (lines 1710–1715)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 63 | 1710 | `ghost-action-bg-hover` | `setHighlight(10)` | `setShadow(6)` | structural | sentinel: `ghostBgHoverIsHighlight` |
| 64 | 1710 | `ghost-action-bg-active` | `setHighlight(20)` | `setShadow(12)` | structural | sentinel: `ghostBgActiveIsHighlight` |

---

### GROUP 25: control-ghost-action fg/icon (lines 1717–1737)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 65 | 1717 | `ghost-action-fg-rest` | `txtRefW`, i=`max(1,txtI-1)`, t=100 | `txtRefW`, i=`txtISubtle`, t=`fgMutedTone` | tone + intensity | `ghostActionFgRestLightI/T` |
| 66 | 1717 | `ghost-action-fg-hover/active` | `txtRefW` near-white | `txtRefW`, i=9, t=15/10 | tone + intensity | [D10] fields |
| 67 | 1727 | `ghost-action-border-hover` intensity | `20` | `10` | intensity | `ghostActionBorderHoverI` |
| 68 | 1727 | `ghost-action-border-hover` tone | `60` | `35` | tone | `ghostActionBorderHoverTone` |
| 69 | 1728 | `ghost-action-border-active` intensity | `20` | `10` | intensity | same field |
| 70 | 1728 | `ghost-action-border-active` tone | `60` | `35` | tone | same field |
| 71 | 1729 | `ghost-action-icon-rest/hover/active` | `txtRefW` near-white | `txtRefW` at `txtISubtle`/fgMutedTone | tone + intensity | [D10] fields |

---

### GROUP 26: control-ghost-danger bg-hover/active (lines 1744–1749)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 72 | 1744 | `ghost-danger-bg-hover` alpha | `10` | `8` | alpha | `ghostDangerBgHoverAlpha` |
| 73 | 1744 | `ghost-danger-bg-active` alpha | `20` | `15` | alpha | `ghostDangerBgActiveAlpha` |

---

### GROUP 27: control-outlined-option bg/fg/icon (lines 1765–1791)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 74–77 | 1765–1791 | `outlined-option-bg-hover/active`, `outlined-option-fg/icon-*` | Same structural + tone pattern as outlined-action | [D10] fields |
| 78 | 1789 | `outlined-option-border-rest` tone | `50` | `fgMutedTone` (22) | tone | `outlinedOptionBorderRestTone` |
| 79 | 1790 | `outlined-option-border-hover` tone | `55` | `fgMutedTone - 3` (19) | tone | computed |
| 80 | 1791 | `outlined-option-border-active` tone | `60` | `fgMutedTone - 6` (16) | tone | computed |

---

### GROUP 28: control-ghost-option bg/fg/icon/border (lines 1796–1822)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 81–86 | 1796–1822 | `ghost-option-*` | Same parallel patterns as ghost-action | [D10] fields |
| 87 | 1813 | `ghost-option-border-hover` i/t | i=20, t=60 | i=10, t=35 | intensity + tone | same as ghost-action border |
| 88 | 1814 | `ghost-option-border-active` i/t | i=20, t=60 | i=10, t=35 | intensity + tone | same |

---

### GROUP 29: field-bg-rest intensity (line 1850)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 89 | 1850 | `field-bg-rest` intensity | `atmI` (5) | `7` | intensity | `fieldBgRestI` |

---

### GROUP 30: field-bg-hover / field-bg-readOnly hue slot (lines 1852, 1860)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 90 | 1852 | `field-bg-hover` | `surfBareBaseRef` at `atmI` | `atmRefW` at `atmI` | hue-slot | `fieldBgHoverHueSlot` |
| 91 | 1860 | `field-bg-readOnly` | `surfBareBaseRef` at `atmI` | `atmRefW` at `atmI` | hue-slot | `fieldBgReadOnlyHueSlot` |

---

### GROUP 31: field-placeholder / field-border-rest / field-border-hover hue (lines 1874–1882)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 92 | 1874 | `field-placeholder` | `fgPlaceholderRef/fgPlaceholderAngle` at `fgPlaceholderI` | `atmRefW/atmAngleW` at `atmIBorder` | hue-slot | `fieldPlaceholderHueSlot` |
| 93 | 1874 | `field-border-rest` | `fgPlaceholderRef` at `fgPlaceholderI` | `atmRefW` at `atmIBorder` | hue-slot | `fieldBorderRestHueSlot` |
| 94 | 1874 | `field-border-hover` | `fgSubtleRef` at `txtISubtle/fgSubtleTone` | `borderStrongHueRef` at `borderIStrong/borderStrongTone` | hue-slot | `fieldBorderHoverHueSlot` |

---

### GROUP 32: toggle-track-off tone / toggle-track-disabled (lines 1900, 1907–1911)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 95 | 1900 | `toggleTrackOffTone` | `28` | `Math.round(dividerTone)` | tone | `toggleTrackOffDarkTone: 28` |
| 96 | 1907 | `toggleDisabledTone` | `22` | `Math.round(darkSurfaceOverlay)` | tone | computed from preset in both modes |
| 97 | 1908 | `toggle-track-disabled` hue | `surfBareBaseRef` at `atmI` | `atmRefW` at `6` | hue-slot + intensity | `toggleTrackDisabledHueSlot` |

---

### GROUP 33: toggle-thumb structural (line 1918)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 98 | 1918 | `toggle-thumb` | `setChromatic(fgInverseRef, txtI, 100)` | `setWhite()` | structural | sentinel: `toggleThumbIsWhite` |

---

### GROUP 34: toggle-thumb-disabled tone (line 1924)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 99 | 1924 | `toggleThumbDisabledTone` | `40` | `fgDisabledTone` (44) | tone | `toggleThumbDisabledDarkTone: 40` |

---

### GROUP 35: checkmark / radio-dot structural (line 1930)

| Branch # | Line | Token | Dark value | Light value | Category | Proposed field |
|----------|------|-------|------------|-------------|----------|----------------|
| 100 | 1930 | `checkmark` | `setChromatic(fgInverseRef, txtI, 100)` | `setWhite()` | structural | sentinel: `checkmarkIsWhite` |
| 101 | 1930 | `radio-dot` | `setChromatic(fgInverseRef, txtI, 100)` | `setWhite()` | structural | sentinel: `radioDotIsWhite` |

---

## Summary by Category

| Category | Count | Notes |
|----------|-------|-------|
| **hue-slot** | 22 | Surface tiers, fg tiers, borders, fields, tabs, controls |
| **structural** | 18 | setWhite vs setChromatic, setHighlight vs setShadow |
| **tone** | 20 | Per-token tone values that differ by mode |
| **intensity** | 15 | Per-token intensity values that differ by mode |
| **alpha** | 4 | ghost-danger bg alpha, selection-inactive alpha |

**Total logical branches:** 79 decision points across 76 code lines
(Some lines express multiple independent branches; counted as separate logical branches above)

---

## All Branches Can Be Expressed as Preset Field Differences — Confirmation

**List L01 from plan (6 difference types) confirmed:**

1. **Hue slot** — yes: all 22 hue-slot branches map to named sentinel values (`"atm"`, `"canvas"`, `"txt"`, `"surfBareBase"`, `"fgInverse"`, `"fgSubtle"`, `"yellow"`) or can be computed per Step 3
2. **Intensity** — yes: all 15 intensity branches map to simple numeric fields in ModePreset
3. **Tone** — yes: all 20 tone branches map to numeric fields (some are fixed constants, some are expressions over existing preset values)
4. **Alpha** — yes: 4 alpha differences map to numeric fields
5. **Structural sentinel (setWhite vs setChromatic)** — yes: 12 branches, expressible as `boolean` sentinel fields (`fgOnAccentIsWhite`, `toggleThumbIsWhite`, etc.)
6. **Structural sentinel (setHighlight vs setShadow)** — yes: 6 branches, expressible as `boolean` sentinel fields (`tabBgHoverIsHighlight`, `highlightHoverIsWhite`, etc.)

**No branches require procedural logic that cannot be expressed as a preset field or computed expression over preset fields.**

---

## Proposed New ModePreset Fields (Step 2 input)

### Hue Slot Fields (~20 new fields)
```
bgAppHueSlot: "canvas" | "txt"
bgCanvasHueSlot: "canvas" | "atm"
surfaceSunkenHueSlot: "surfBareBase" | "atm"
surfaceDefaultHueSlot: "surfBareBase" | "atm"
surfaceRaisedHueSlot: "atm" | "txt"
surfaceOverlayHueSlot: "surfBareBase" | "atm"
surfaceScreenHueSlot: "surfScreenDark" | "txt"
fgMutedHueSlot: "txtBarePrimary" | "txt"
fgSubtleHueSlot: "indigo-cobalt" | "txt"
fgDisabledHueSlot: "indigo-cobalt" | "txt"
fgInverseHueSlot: "sapphire-cobalt" | "txt"
fgPlaceholderHueSlot: "fgMuted" | "atm"
tabBgActiveHueSlot: "cardFrame" | "atm"
tabBgInactiveHueSlot: "cardFrame" | "atm"
fieldBgHoverHueSlot: "surfBareBase" | "atm"
fieldBgReadOnlyHueSlot: "surfBareBase" | "atm"
fieldPlaceholderHueSlot: "fgPlaceholder" | "atm"
fieldBorderRestHueSlot: "fgPlaceholder" | "atm"
disabledBgHueSlot: "surfBareBase" | "atm"
toggleTrackDisabledHueSlot: "surfBareBase" | "atm"
```

### Sentinel (boolean) Fields (~10 new fields)
```
fgOnAccentIsWhite: boolean      // true in light, false in dark
fgOnDangerIsWhite: boolean      // true in light, false in dark
iconOnAccentIsWhite: boolean    // true in light, false in dark
highlightHoverIsWhite: boolean  // true in dark (white overlay), false in light (shadow)
tabBgHoverIsHighlight: boolean  // true in dark, false in light
tabCloseBgHoverIsHighlight: boolean  // true in dark, false in light
toggleThumbIsWhite: boolean     // true in light, false in dark
checkmarkIsWhite: boolean       // true in light, false in dark
radioDotIsWhite: boolean        // true in light, false in dark
outlinedBgHoverIsHighlight: boolean  // true in dark, false in light
ghostBgHoverIsHighlight: boolean     // true in dark, false in light
```

### New Intensity Fields (~10 new fields)
```
bgAppI: number            // dark: 2, light: atmI
bgCanvasI: number         // dark: 2, light: 7
surfaceDefaultI: number   // dark: atmI, light: 4
surfaceRaisedI: number    // dark: atmI, light: 5
surfaceOverlayI2: number  // dark: 4, light: 6  (note: surfaceOverlayI already exists for overlay surface token)
surfaceInsetI: number     // dark: atmI, light: 4
surfaceContentI: number   // dark: atmI, light: 4
surfaceScreenI2: number   // dark: txtISubtle, light: 4
fgInverseI: number        // dark: txtI, light: 1
fgOnCautionI: number      // dark: 4, light: atmI
iconMutedI: number        // dark: txtISubtle, light: atmIBorder (alias same as atmIBorder)
iconActiveTone: number    // dark: 80, light: 22  (tone, not intensity — misnamed in group)
borderMutedI: number      // dark: borderIStrong, light: 10
dividerDefaultI: number   // dark: 6, light: atmI
disabledBgI: number       // dark: atmI, light: 6
disabledBorderI: number   // dark: 6, light: atmIBorder
fieldBgRestI: number      // dark: atmI, light: 7
ghostActionBorderHoverI: number  // dark: 20, light: 10
ghostDangerBgHoverAlpha: number  // dark: 10, light: 8
ghostDangerBgActiveAlpha: number // dark: 20, light: 15
```

### New Tone Fields (~20 new fields)
```
borderMutedTone: number           // dark: fgSubtleTone (37), light: 36
borderStrongTone: number          // dark: 40, light: computed from fgSubtleTone - 6
dividerDefaultTone: number        // dark: 17, light: computed from surfaceOverlay
dividerMutedTone: number          // dark: 15, light: computed from surfaceOverlay
tabFgActiveTone: number           // dark: 90, light: fgDefaultTone
disabledBgTone: number            // dark: 22, light: computed from surfaceContrast
disabledFgTone: number            // dark: 38, light: fgDisabledTone
disabledBorderTone: number        // dark: 28, light: computed from dividerTone
outlinedBgRestLightTone: number   // light: 51 (dark: computed from darkSurfaceInset)
outlinedBgHoverLightTone: number  // light: 99 (dark: computed from darkSurfaceRaised)
outlinedBgActiveLightTone: number // light: 48 (dark: computed from darkSurfaceOverlay)
toggleTrackOffTone: number        // dark: 28, light: computed from dividerTone
toggleDisabledTone: number        // computed in both modes — no new field needed
toggleThumbDisabledTone: number   // dark: 40, light: fgDisabledTone
ghostActionBorderHoverTone: number // dark: 60, light: 35
```

### Per-State Control Emphasis Fields [D10] (~60-100 new fields)
The outlined and ghost control families have per-state fg/icon tone and intensity differences.
These will be captured as flat `{family}{State}{Property}` named fields per [D10] in Step 2.

---

## Verification: 81 `isLight` grep hits accounted for

| Lines | Count | Status |
|-------|-------|--------|
| 148, 151 | 2 | Comments — not branches |
| 703, 708, 709 | 3 | Declaration + comment + preset selection |
| 875, 886, 893, 906 | 4 | GROUP 1: fg hue slots |
| 1014, 1021, 1022, 1029, 1036, 1044, 1051, 1058, 1065, 1073 | 10 | GROUP 2: surface tiers |
| 1093, 1094 | 2 | GROUP 3: fg-inverse |
| 1097 | 1 | GROUP 4: fg-placeholder |
| 1109 | 1 | GROUP 5: fg-onAccent/Danger |
| 1118, 1119 | 2 | GROUP 6: fg-onCaution/Success |
| 1127 | 1 | GROUP 7: icon-muted |
| 1136 | 1 | GROUP 8: icon-active tone |
| 1139 | 1 | GROUP 9: icon-onAccent |
| 1170, 1171 | 2 | GROUP 10: border-muted |
| 1180 | 1 | GROUP 11: border-strong tone |
| 1194, 1195 | 2 | GROUP 12: divider tones |
| 1210, 1212 | 2 | GROUP 13: divider intensity/hue |
| 1386 | 1 | GROUP 14: selection-inactive |
| 1399 | 1 | GROUP 15: highlight-hover |
| 1435, 1442, 1449, 1456 | 4 | GROUP 16: tab-bg slots |
| 1466, 1473 | 2 | GROUP 17: tab-fg/close |
| 1489, 1490 | 2 | GROUP 18: disabled-bg |
| 1495, 1497, 1498 | 3 | GROUP 19: disabled-fg/border |
| 1538, 1539, 1540 | 3 | GROUP 20: outlinedBg tones |
| 1649, 1656 | 2 | GROUP 21+22: outlined-action bg+fg |
| 1680, 1687 | 2 | GROUP 23: outlined-agent |
| 1710, 1717 | 2 | GROUP 24+25: ghost-action bg+fg |
| 1727, 1728, 1729 | 3 | GROUP 25: ghost-action border+icon |
| 1744 | 1 | GROUP 26: ghost-danger |
| 1765, 1772 | 2 | GROUP 27: outlined-option bg+fg |
| 1789, 1790, 1791 | 3 | GROUP 27: outlined-option border |
| 1796, 1803 | 2 | GROUP 28: ghost-option bg+fg |
| 1813, 1814, 1815 | 3 | GROUP 28: ghost-option border+icon |
| 1850, 1852 | 2 | GROUP 29+30: field-bg |
| 1860 | 1 | GROUP 30: field-bg-readOnly |
| 1874 | 1 | GROUP 31: field-placeholder/border |
| 1900, 1907, 1908 | 3 | GROUP 32: toggle-track |
| 1918 | 1 | GROUP 33: toggle-thumb |
| 1924 | 1 | GROUP 34: toggle-thumb-disabled |
| 1930 | 1 | GROUP 35: checkmark/radio |
| **Total** | **81** | **All accounted for** |
