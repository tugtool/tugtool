# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: step-5
date: 2025-03-24T15:39:53Z
---

## step-5: Added Show Style Inspector menu item to Developer menu in AppDelegate.swift with Opt+Cmd+I shortcut, calling sendControl(show-style-inspector). Swift build succeeded.

**Files changed:**
- .tugtool/tugplan-inspector-card.md

---

---
step: step-4
date: 2025-03-24T15:35:49Z
---

## step-4: Added show-style-inspector action handler in action-dispatch.ts, showStyleInspector responder action with find-or-create-and-focus semantics in DeckCanvas, replaced initStyleInspector with registerStyleInspectorCard in main.tsx. 6 new tests pass (1868 total).

**Files changed:**
- .tugtool/tugplan-inspector-card.md

---

---
step: step-3
date: 2025-03-24T15:24:20Z
---

## step-3: Created StyleInspectorContent React component with reticle-based element selection, token chain rendering, formula provenance, scale/timing readout. Registered as developer-family card. Ported styles to card CSS. 14 new tests pass (1862 total).

**Files changed:**
- .tugtool/tugplan-inspector-card.md

---

---
step: step-2
date: 2025-03-24T15:11:18Z
---

## step-2: Created ScanModeController class with imperative DOM overlay, pointer-events toggle hit detection, single-shot click selection, Alt key hover suppression. 18 new tests pass (1848 total).

**Files changed:**
- .tugtool/tugplan-inspector-card.md

---

---
step: step-1
date: 2025-03-24T15:00:49Z
---

## step-1: Extracted resolveTokenChainForProperty, resolveTokenChain, extractTugColorProvenance, buildDomPath, tryFormatTugColor, buildFormulaRows, getReverseMap, shortenNumbers, fetchFormulasData as standalone module-level exports. Class methods delegate to extracted functions. All 1830 tests pass.

**Files changed:**
- .tugtool/tugplan-inspector-card.md

---

---
step: step-7
date: 2025-03-23T18:41:19Z
---

## step-7: Final verification: tsc --noEmit clean, 64 theme tests pass, generate:tokens clean, audit:tokens zero violations, bun run build exits 0.

**Files changed:**
- .tugtool/tugplan-theme-save-format-fix.md

---

---
step: step-6
date: 2025-03-23T18:34:09Z
---

## step-6: Added RT1 and RT2 round-trip integration tests proving handleThemesSave -> activateThemeOverride works end-to-end with correct canvasParams and canonical JSON format.

**Files changed:**
- .tugtool/tugplan-theme-save-format-fix.md

---

---
step: step-5
date: 2025-03-23T18:28:10Z
---

## step-5: Added legacy format detection and migration in activateThemeOverride and themeOverridePlugin. Detects stringified recipe blob, unwraps inner JSON, rewrites file in canonical format. Three new migration tests.

**Files changed:**
- .tugtool/tugplan-theme-save-format-fix.md

---

---
step: step-4
date: 2025-03-23T18:19:51Z
---

## step-4: Added findUserThemeByName helper, hash-based filenames in handleThemesSave, name-scan lookup in activateThemeOverride/handleThemesLoadJson/themeOverridePlugin, renamed safeName to themeName, added decodeURIComponent for URL names, dedup on re-save. Comprehensive test updates.

**Files changed:**
- .tugtool/tugplan-theme-save-format-fix.md

---

---
step: step-3
date: 2025-03-23T18:06:58Z
---

## step-3: Replaced ThemeSaveBody interface with required grid/frame/card fields. Added server validation rejecting JSON blobs in recipe field and missing surface. Updated test helpers and added negative tests.

**Files changed:**
- .tugtool/tugplan-theme-save-format-fix.md

---

---
step: step-2
date: 2025-03-23T17:59:37Z
---

## step-2: Changed both save call sites (NewThemeDialog.handleCreate and performSave) to send ThemeRecipe directly as JSON body instead of wrapping with JSON.stringify(recipe). Updated theme-export-import test assertions.

**Files changed:**
- .tugtool/tugplan-theme-save-format-fix.md

---

---
step: step-1
date: 2025-03-23T17:52:21Z
---

## step-1: Removed description field from ThemeRecipe interface, shipped theme JSON files, CSS header generation, brio.css comment, validateRecipeJson, and all test fixtures.

**Files changed:**
- .tugtool/tugplan-theme-save-format-fix.md

---

---
step: step-11
date: 2025-03-23T15:50:34Z
---

## step-11: Final integration checkpoint: build passes, dead code removed, audit:tokens passes, all automated checks green

**Files changed:**
- .tugtool/tugplan-theme-switching-pipeline.md

---

---
step: step-10
date: 2025-03-23T15:40:29Z
---

## step-10: Added THEME_CANVAS_PARAMS generation to generate-tug-tokens.ts, production link swap to theme-provider.tsx, and Rollup config for theme CSS assets

**Files changed:**
- .tugtool/tugplan-theme-switching-pipeline.md

---

---
step: step-9
date: 2025-03-23T15:24:17Z
---

## step-9: Removed generateResolvedCssExport import and all call sites from gallery-theme-generator-content.tsx. Save bodies now send only { name, recipe } per D07.

**Files changed:**
- .tugtool/tugplan-theme-switching-pipeline.md

---

---
step: step-8
date: 2025-03-23T15:16:12Z
---

## step-8: Rewrote setTheme to POST /__themes/activate. Removed themeCSSMap, registerThemeCSS, applyInitialTheme, style injection. Simplified main.tsx startup. Updated test files for D07.

**Files changed:**
- .tugtool/tugplan-theme-switching-pipeline.md

---

---
step: step-7
date: 2025-03-23T14:52:46Z
---

## step-7: Server-side integration checkpoint: all unit tests pass, build clean, server-side theme pipeline verified

**Files changed:**
- .tugtool/tugplan-theme-switching-pipeline.md

---

---
step: step-6
date: 2025-03-23T14:45:37Z
---

## step-6: Removed handleThemesLoadCss, makeRuntimeCssGeneratorFromPath, SHIPPED_THEMES_CSS_DIR, CSS route handler, and related tests

**Files changed:**
- .tugtool/tugplan-theme-switching-pipeline.md

---

---
step: step-5
date: 2025-03-23T14:37:21Z
---

## step-5: Removed CSS file write from handleThemesSave, added safeName return, middleware calls activateThemeOverride via withMutex after save

**Files changed:**
- .tugtool/tugplan-theme-switching-pipeline.md

---

---
step: step-4
date: 2025-03-23T14:25:49Z
---

## step-4: Added reactivateActiveTheme helper in controlTokenHotReload to re-derive tug-theme-override.css after regenerate runs

**Files changed:**
- .tugtool/tugplan-theme-switching-pipeline.md

---

---
step: step-3
date: 2025-03-23T14:17:58Z
---

## step-3: Added activateThemeOverride, handleThemesActivate, writeMutex, and POST /activate route in themeSaveLoadPlugin. 8 unit tests.

**Files changed:**
- .tugtool/tugplan-theme-switching-pipeline.md

---

---
step: step-2
date: 2025-03-23T14:04:02Z
---

## step-2: Added themeOverridePlugin with configResolved hook that reads .tugtool/active-theme and writes tug-theme-override.css at startup

**Files changed:**
- .tugtool/tugplan-theme-switching-pipeline.md

---

---
step: step-1
date: 2025-03-23T13:55:52Z
---

## step-1: Added tug-theme-override.css to tugdeck/.gitignore and created the empty override CSS file on disk

**Files changed:**
- .tugtool/tugplan-theme-switching-pipeline.md

---

---
step: step-16
date: 2025-03-22T22:42:23Z
---

## step-16: Final verification: 1792 tests pass, generate:tokens succeeds, audit:tokens lint clean, all obsolete code removed (EXAMPLE_RECIPES, Bluenote, theme-recipes.ts, formulas escape hatch, ExportImportPanel)

**Files changed:**
- .tugtool/tugplan-theme-recipe-authoring.md

---

---
step: step-15
date: 2025-03-22T22:36:04Z
---

## step-15: Rewrote theme-engine.md for JSON themes/RECIPE_REGISTRY/document model, updated design-decisions.md D01-D03 and added D86-D92, updated CLAUDE.md token generation docs

**Files changed:**
- .tugtool/tugplan-theme-recipe-authoring.md

---

