# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: step-1
date: 2025-03-18T14:41:24Z
---

## step-1: Added borderSignalTone and semanticSignalTone to DerivationFormulas (default 50 in DARK_FORMULAS, 40/35 in LIGHT_OVERRIDES). Wired into borderRamp() and semanticTone() replacing hardcoded lit(50). Brio output unchanged, 1846 tests pass.

**Files changed:**
- .tugtool/tugplan-generator-light-theme-bugs.md

---

---
step: step-6
date: 2025-03-18T03:11:43Z
---

## step-6: Integration checkpoint: all verification passed — tsc clean, 1846 tests pass, both brio and harmony produce 373 tokens, harmony preset in EXAMPLE_RECIPES, set-theme accepts harmony, canvasColorHex('harmony') returns near-white, saved-themes filtering works. The Harmony light theme is fully integrated.

**Files changed:**
- .tugtool/tugplan-harmony-light-theme.md

---

---
step: step-5
date: 2025-03-18T03:09:47Z
---

## step-5: Widened ThemeName to 'brio' | 'harmony'. Added registerThemeCSS(). Updated setTheme() to inject harmony CSS and clear dynamic state. Updated revertToBuiltIn() to re-inject active built-in's CSS. Added CANVAS_COLORS.harmony. Pre-fetch harmony.css in main.tsx. Widened action-dispatch validation. Filtered built-in names from saved-themes list. 1846 tests pass.

**Files changed:**
- .tugtool/tugplan-harmony-light-theme.md

---

---
step: step-4
date: 2025-03-18T03:00:54Z
---

## step-4: Refactored generate-tug-tokens.ts: extracted buildTokenCssLines() shared function. Now generates styles/themes/harmony.css (373 tokens) alongside tug-base-generated.css (brio, unchanged). Both files use identical formatting and group ordering.

**Files changed:**
- .tugtool/tugplan-harmony-light-theme.md

---

---
step: step-3
date: 2025-03-18T02:56:49Z
---

## step-3: Calibrated LIGHT_OVERRIDES: added outlined/ghost control fg tone overrides (derivation rules use primary fields, not *ToneLight variants). Adjusted filled control, badge, icon, placeholder values. Gallery KNOWN_PAIR_EXCEPTIONS reduced from 18 to 3. Added T4.3 harmony contrast validation test. 1846 tests pass.

**Files changed:**
- .tugtool/tugplan-harmony-light-theme.md

---

---
step: step-2
date: 2025-03-18T02:42:19Z
---

## step-2: Added EXAMPLE_RECIPES.harmony — a light theme using the same cobalt/violet/indigo hue palette as brio with LIGHT_FORMULAS. Both brio and harmony produce 373 tokens. Updated EXAMPLE_RECIPES JSDoc.

**Files changed:**
- .tugtool/tugplan-harmony-light-theme.md

---

---
step: step-1
date: 2025-03-18T02:39:34Z
---

## step-1: Defined LIGHT_OVERRIDES (104 fields across 20 semantic groups) and LIGHT_FORMULAS = { ...BASE_FORMULAS, ...LIGHT_OVERRIDES }. All fields annotated with design rationale. deriveTheme produces 373 tokens. Initial best-estimate values — Step 3 will calibrate via contrast validation.

**Files changed:**
- .tugtool/tugplan-harmony-light-theme.md

---

---
step: step-8
date: 2025-03-18T01:37:08Z
---

## step-8: Final verification: token output byte-identical to pre-annotation baseline, 1845 tests pass, tsc clean, all 198 DARK_FORMULAS fields annotated with design rationale across 23 semantic groups.

**Files changed:**
- .tugtool/tugplan-annotate-dark-recipe.md

---

---
step: step-7
date: 2025-03-18T01:35:07Z
---

## step-7: Added inline design rationale comments to 76 fields across Hue Slot Dispatch (30), Sentinel Hue Dispatch (9), Sentinel Alpha (11), Computed Tone Override (15), Hue Name Dispatch (7), and Selection Mode (4) groups in DARK_FORMULAS. All 198 fields now annotated.

**Files changed:**
- .tugtool/tugplan-annotate-dark-recipe.md

---

---
step: step-6
date: 2025-03-18T01:30:50Z
---

## step-6: Added inline design rationale comments to 23 fields across Badge Style (8), Icon Style (3), Tab Style (1), Toggle Style (3), and Field Style (8) groups in DARK_FORMULAS.

**Files changed:**
- .tugtool/tugplan-annotate-dark-recipe.md

---

---
step: step-5
date: 2025-03-18T01:28:28Z
---

## step-5: Added inline design rationale comments to 48 fields across Filled Control Prominence (3), Outlined Control Style (21), and Ghost Control Style (24) groups in DARK_FORMULAS.

**Files changed:**
- .tugtool/tugplan-annotate-dark-recipe.md

---

---
step: step-4
date: 2025-03-18T01:25:41Z
---

## step-4: Added inline design rationale comments to 19 fields across Border Visibility (7), Card Frame Style (4), and Shadow Depth (8) groups in DARK_FORMULAS.

**Files changed:**
- .tugtool/tugplan-annotate-dark-recipe.md

---

---
step: step-3
date: 2025-03-18T01:22:55Z
---

## step-3: Added inline design rationale comments to 13 fields across Text Brightness (2), Text Hierarchy (4), and Text Coloring (7) groups in DARK_FORMULAS.

**Files changed:**
- .tugtool/tugplan-annotate-dark-recipe.md

---

---
step: step-2
date: 2025-03-18T01:19:51Z
---

## step-2: Added inline design rationale comments to 19 fields across Canvas Darkness (2), Surface Layering (7), and Surface Coloring (10) groups in DARK_FORMULAS.

**Files changed:**
- .tugtool/tugplan-annotate-dark-recipe.md

---

---
step: step-1
date: 2025-03-18T01:15:56Z
---

## step-1: Baseline snapshot: tsc clean, 1845 tests pass, CSS token output saved to /tmp/tug-base-before.css for post-annotation diffing.

**Files changed:**
- .tugtool/tugplan-annotate-dark-recipe.md

---

---
step: step-3
date: 2025-03-18T00:49:11Z
---

## step-3: Integration checkpoint: token output byte-identical to pre-reorder baseline, 1845 tests pass, tsc clean, 198 fields verified across 23 semantic groups.

**Files changed:**
- .tugtool/tugplan-restructure-derivation-formulas.md

---

---
step: step-2
date: 2025-03-18T00:46:12Z
---

## step-2: Reordered all 198 fields in DerivationFormulas interface and DARK_FORMULAS constant into 23 semantic decision groups with banner comments. Updated module JSDoc table per D04 (tabBgHueSlot fields moved to hue-slot-dispatch). Token output byte-identical. 1845 tests pass.

**Files changed:**
- .tugtool/tugplan-restructure-derivation-formulas.md

---

---
step: step-1
date: 2025-03-18T00:32:11Z
---

## step-1: Baseline snapshot: 200 @semantic fields confirmed, tsc clean, 1845 tests pass, token output saved to .tugtool/_tmp_tug-base-baseline.css for post-reorder diffing.

**Files changed:**
- .tugtool/tugplan-restructure-derivation-formulas.md

---

---
step: step-4
date: 2025-03-17T23:44:36Z
---

## step-4: Integration checkpoint: all success criteria verified — 198 @semantic tags, ThemeRecipe.description required, EXAMPLE_RECIPES.brio populated, module JSDoc table present, 1845 tests pass, token output byte-identical.

**Files changed:**
- .tugtool/tugplan-semantic-layer-annotations.md

---

---
step: step-3
date: 2025-03-17T23:41:06Z
---

## step-3: Expanded @module JSDoc block with Semantic Decision Groups section documenting all 23 groups, their descriptions, and field inventories. 197 lines added. Documentation-only, token output byte-identical.

**Files changed:**
- .tugtool/tugplan-semantic-layer-annotations.md

---

---
step: step-2
date: 2025-03-17T23:35:47Z
---

## step-2: Annotated all 198 fields in DerivationFormulas with @semantic JSDoc tags across 23 semantic groups. Each field linked to its decision group (canvas-darkness, surface-layering, text-brightness, text-hierarchy, etc.). Annotation-only change with zero behavioral impact. Token output byte-identical.

**Files changed:**
- .tugtool/tugplan-semantic-layer-annotations.md

---

---
step: step-1
date: 2025-03-17T23:28:03Z
---

## step-1: Added required description: string to ThemeRecipe interface. Populated EXAMPLE_RECIPES.brio description. Updated validateRecipeJson, generateCssExport, generateResolvedCssExport, currentRecipe memo, runDerive callback. Updated all test fixtures across 3 test files. 1845 tests pass, token output byte-identical.

**Files changed:**
- .tugtool/tugplan-semantic-layer-annotations.md

---

---
step: step-5
date: 2025-03-17T22:49:36Z
---

## step-5: Final verification: all 1842 tests pass, token output byte-identical to pre-refactor baseline, zero BRIO_DARK occurrences remain, DARK_FORMULAS and DARK_OVERRIDES properly exported, golden snapshot removed.

**Files changed:**
- .tugtool/tugplan-formula-builders-rename.md

---

---
step: step-4
date: 2025-03-17T22:44:31Z
---

## step-4: Mechanical rename of BRIO_DARK_FORMULAS to DARK_FORMULAS and BRIO_DARK_OVERRIDES to DARK_OVERRIDES across theme-derivation-engine.ts, theme-derivation-engine.test.ts, and gallery-theme-generator-content.test.tsx. BASE_FORMULAS alias updated. Zero old-name occurrences remain. Token output byte-identical.

**Files changed:**
- .tugtool/tugplan-formula-builders-rename.md

---

---
step: step-3
date: 2025-03-17T22:35:04Z
---

## step-3: Replaced inlined formula expressions in all factory functions and direct rule tables with named builder calls. filledRoleRules, outlinedFgRules, ghostFgRules, ghostDangerRules, semanticToneFamilyRules, badgeTintedRoleRules simplified. SURFACE_RULES, FOREGROUND_RULES, ICON_RULES, BORDER_RULES converted where applicable. File shrank from 1597 to 1430 lines. Token output byte-identical to golden snapshot.

**Files changed:**
- .tugtool/tugplan-formula-builders-rename.md

---

---
step: step-2
date: 2025-03-17T22:24:45Z
---

## step-2: Defined 18 named formula builders (surface, filledFg, outlinedFg, borderRamp, filledBg, semanticTone, badgeTinted, signalRamp, signalRampAlpha, outlinedBg, ghostBg, formulaField plus pre-applied instances). Added ComputedTones import and type F alias. No behavioral changes — builders are unused pending Step 3.

**Files changed:**
- .tugtool/tugplan-formula-builders-rename.md

---

---
step: step-1
date: 2025-03-17T22:17:03Z
---

## step-1: Captured golden token snapshot (tug-base-generated.css.golden) and added *.golden to .gitignore. Baseline: 373 tokens, 1842 tests passing.

**Files changed:**
- .tugtool/tugplan-formula-builders-rename.md

---

---
step: step-5
date: 2025-03-17T18:47:27Z
---

## step-5: Deprecated autoAdjustContrast, replaced AutoFixPanel with ContrastDiagnosticsPanel showing floor-applied and structurally-fixed diagnostics. Updated 4 test files to remove auto-fix pipeline calls. 1842 tests pass, 0 failures.

**Files changed:**
- .tugtool/tugplan-contrast-engine-overhaul.md

---

---
step: step-4
date: 2025-03-17T18:25:56Z
---

## step-4: Added enforceContrastFloor with binary search in tone space, ContrastDiagnostic interface, and evaluateRules integration. 10 token tones floor-clamped. All 1840 tests pass with 0 failures.

**Files changed:**
- .tugtool/tugplan-contrast-engine-overhaul.md

---

---
step: step-3
date: 2025-03-17T17:32:59Z
---

## step-3: Consolidated DerivationFormulas from 268 to 198 fields (70-field net reduction). Refactored outlinedFgRules and unified ghostFgRules factories. Established BASE_FORMULAS + BRIO_DARK_OVERRIDES pattern. Token output byte-identical.

**Files changed:**
- .tugtool/tugplan-contrast-engine-overhaul.md

---

---
step: step-2
date: 2025-03-17T17:12:08Z
---

## step-2: Replaced computePerceptualContrast with OKLab L-based metric. Removed old constants, added CONTRAST_SCALE=150, POLARITY_FACTOR=0.85, CONTRAST_MIN_DELTA=0.03. Calibrated thresholds against Brio token set. Added CB6 rank-ordering calibration test. 40 tests pass.

**Files changed:**
- .tugtool/tugplan-contrast-engine-overhaul.md

---

---
step: step-1
date: 2025-03-17T16:29:34Z
---

## step-1: Added hexToOkLabL function implementing OKLab M1 matrix conversion (Spec S02) and calibration test infrastructure for algorithm replacement in Step 2

**Files changed:**
- .tugtool/tugplan-contrast-engine-overhaul.md

---

---
step: step-10
date: 2025-03-17T13:43:26Z
---

## step-10: Fixed 2 remaining isLight comment references. Deleted .tugtool/baseline-tokens.txt. Verified: zero isLight/ModePreset/DARK_PRESET/LIGHT_PRESET across all source. 1814 tests pass, tokens byte-identical.

**Files changed:**
- .tugtool/tugplan-recipe-formulas-refactor.md

---

---
step: step-9
date: 2025-03-17T13:36:42Z
---

## step-9: Deleted ModePreset interface, DARK_PRESET, LIGHT_PRESET (~890 lines). Cleaned up all references. Rewrote T-PRESET-EXPORTS as T-FORMULAS-EXPORTS. ThemeRecipe.formulas is now the sole formula source. 1814 tests pass, baseline match.

**Files changed:**
- .tugtool/tugplan-recipe-formulas-refactor.md

---

---
step: step-8
date: 2025-03-17T13:22:04Z
---

## step-8: Changed Expr type, StructuralRule, evaluateRules() from ModePreset to DerivationFormulas. Renamed ~200 preset refs to formulas in derivation-rules.ts. Replaced ~35 isLight branches with unified field reads. Refactored outlinedFgRules factory. Zero isLight and zero preset remain in derivation-rules.ts. 1814 tests pass, baseline match.

**Files changed:**
- .tugtool/tugplan-recipe-formulas-refactor.md

---

---
step: step-7
date: 2025-03-17T12:53:20Z
---

## step-7: Added 75 unified per-state control emphasis fields (Table T01) to DerivationFormulas interface and BRIO_DARK_FORMULAS: outlined-action/agent/option fg/icon (60), ghost-action/option fg/icon (24 subset already existed), plus 9 non-control branch fields. Purely additive.

**Files changed:**
- .tugtool/tugplan-recipe-formulas-refactor.md

---

---
step: step-6
date: 2025-03-17T12:45:05Z
---

## step-6: Changed computeTones() from (preset: ModePreset) to (formulas: DerivationFormulas). Replaced 7 isLight branches with number|null override fields. Deleted T-TONES-LIGHT, T-RULES-LIGHT-MATCH, T-ACC-1 light sub-test (clean break per D06). deriveTheme() fallback simplified to recipe.formulas ?? BRIO_DARK_FORMULAS. 1814 tests pass, baseline match.

**Files changed:**
- .tugtool/tugplan-recipe-formulas-refactor.md

---

