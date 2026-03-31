# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: audit-fix
date: 2025-03-31T23:20:10Z
---

## audit-fix: Audit fix: cargo fmt formatting fix in tugcast main.rs

**Files changed:**
- tugbank-in-process-clients-01a0862-10

---

---
step: step-5
date: 2025-03-31T23:11:47Z
---

## step-5: Added DEFAULTS: 0x50 to FeedId in tugdeck protocol.ts. Fixed 8 pre-existing TypeScript errors in tugways components. tsc --noEmit passes clean.

**Files changed:**
- tugbank-in-process-clients-01a0862-10

---

---
step: step-4
date: 2025-03-31T22:43:30Z
---

## step-4: Migrated tugcast HTTP handlers (defaults.rs, server.rs) from Arc<DefaultsStore> to Arc<TugbankClient>. Consolidated main.rs to single TugbankClient for both HTTP and DEFAULTS feed. Updated integration tests. 206 tests pass.

**Files changed:**
- tugbank-in-process-clients-01a0862-10

---

---
step: step-3
date: 2025-03-31T22:34:17Z
---

## step-3: Created feeds/defaults.rs with defaults_feed function that builds aggregated DEFAULTS frames from TugbankClient. Wired into main.rs with watch channel. 206 tests pass.

**Files changed:**
- tugbank-in-process-clients-01a0862-10

---

---
step: step-2
date: 2025-03-31T22:23:35Z
---

## step-2: Created TugbankClient in tugbank-core wrapping DefaultsStore with in-memory domain snapshot cache, PRAGMA data_version polling thread, and callback registry. 5 new tests, 72 total pass.

**Files changed:**
- .tugtool/tugplan-tugbank-in-process-clients.md

---

---
step: step-1
date: 2025-03-31T22:11:44Z
---

## step-1: Added FeedId::Defaults = 0x50 variant to tugcast-core protocol with from_byte match arm, round-trip test, golden wire-format test, and dedicated from_byte/as_byte tests. 50 tests pass.

**Files changed:**
- tugbank-in-process-clients-01a0862-10

---

---
step: step-10
date: 2025-03-30T18:42:46Z
---

## step-10: Added markdown-pipeline.test.ts with 24 tests covering graceful degradation (poolSize=0 fallback), pipeline protocol correctness (lex/parse/stream contracts), HeightEstimator accuracy, and code audit verifications. Browser performance measurements (1MB viewport, 10MB yank, streaming 60fps) deferred to manual gallery card verification. OVERSCAN_SCREENS=4 per Q01.

**Files changed:**
- .tugtool/tugplan-worker-markdown-pipeline.md

---

---
step: step-9
date: 2025-03-30T18:24:51Z
---

## step-9: Integration checkpoint: verified all automated checks pass (1621 tests, build with worker chunk, zero tsc errors in pipeline files). Consolidated inline DOMPurify.sanitize() calls into upgradePlaceholderNode() function. Confirmed marked.parser() only in fallback handler. Gallery card browser tests deferred.

**Files changed:**
- .tugtool/tugplan-worker-markdown-pipeline.md

---

---
step: step-8
date: 2025-03-30T18:02:04Z
---

## step-8: Optimized collectTransferables with primitive short-circuit. Implemented per-slot lazy respawn after idle termination. Added multi-slot dispatch test with slow-worker and init timeout tests with delayed-init-worker. 5 new integration tests, all passing.

**Files changed:**
- .tugtool/tugplan-worker-markdown-pipeline.md

---

---
step: step-7
date: 2025-03-30T17:50:56Z
---

## step-7: Added MarkdownDiagnostics interface per Spec S03, onDiagnostics callback prop, and poolSize getter to TugWorkerPool. Gallery card now displays pool size, in-flight tasks, cache size, and hit rate in diagnostic overlay.

**Files changed:**
- .tugtool/tugplan-worker-markdown-pipeline.md

---

---
step: step-6
date: 2025-03-30T17:39:22Z
---

## step-6: Modified addBlockNode() to create placeholder divs on cache miss with estimated height. Added placeholderIndices Set to engine state. Parse response handlers replace placeholders with sanitized HTML. Added .tugx-md-placeholder CSS class.

**Files changed:**
- .tugtool/tugplan-worker-markdown-pipeline.md

---

---
step: step-5
date: 2025-03-30T17:31:12Z
---

## step-5: Verified streaming path already wired to worker pipeline from step 4. Fixed streaming task handle tracking: stream handles now pushed to inFlightParses for cancellation on unmount, with .finally() cleanup to prevent unbounded growth.

**Files changed:**
- .tugtool/tugplan-worker-markdown-pipeline.md

---

---
step: step-4
date: 2025-03-30T17:13:05Z
---

## step-4: Rewrote static rendering path to use TugWorkerPool with lex-then-parse pipeline. Added MdWorkerReq/MdWorkerRes types, pool creation in useLayoutEffect, fallbackHandler for graceful degradation, RAF-coalesced scroll handler with in-flight parse cancellation. Worker chunk now emitted in build.

**Files changed:**
- .tugtool/tugplan-worker-markdown-pipeline.md

---

---
step: step-3
date: 2025-03-30T16:57:23Z
---

## step-3: Created tugdeck/src/workers/markdown-worker.ts implementing Web Worker script with lex, parse, and stream message handlers. Uses marked and DefaultTextEstimator with relative imports. Implements MainToWorkerMessage/WorkerToMainMessage protocol with serializeError for error handling.

**Files changed:**
- .tugtool/tugplan-worker-markdown-pipeline.md

---

---
step: step-2
date: 2025-03-30T16:45:28Z
---

## step-2: Created markdown-height-estimator.ts with HeightEstimator interface, HeightEstimatorMeta, and DefaultTextEstimator class. Updated block-height-index.ts to re-export constants. Updated tug-markdown-view.tsx to delegate to DefaultTextEstimator. Added comprehensive test suite.

**Files changed:**
- .tugtool/tugplan-worker-markdown-pipeline.md

---

---
step: step-1
date: 2025-03-30T16:36:01Z
---

## step-1: Removed idle-callback pre-rendering system (scheduleIdleBatch, CHUNKED_CONTENT_THRESHOLD, RENDER_BATCH_SIZE, idleHandle, renderedCount) and added htmlCache Map with cacheHits/cacheMisses counters to MarkdownEngineState. addBlockNode() now checks cache before calling renderToken().

**Files changed:**
- .tugtool/tugplan-worker-markdown-pipeline.md

---

---
step: audit-fix
date: 2025-03-30T03:38:26Z
---

## audit-fix: CI fix: ran cargo fmt to resolve pre-existing formatting diffs in tugcast/src/auth.rs, tugcast/src/feeds/agent_bridge.rs, and tugcast/src/main.rs

**Files changed:**
- .tugtool/tugplan-markdown-rendering-core.md

---

---
step: step-5
date: 2025-03-30T03:26:48Z
---

## step-5: Created gallery-markdown-view.tsx demonstrating TugMarkdownView in static (1MB), streaming (PropertyStore-driven deltas), and 10MB stress test modes with diagnostic overlay. Registered in gallery-registrations.tsx. Build passes.

**Files changed:**
- .tugtool/tugplan-markdown-rendering-core.md

---

---
step: step-4
date: 2025-03-30T03:18:25Z
---

## step-4: Enhanced TugMarkdownView streaming path with blockOffsets parallel array for source byte offset tracking, incremental tail re-lexing from last block boundary, dirty flag reconciliation, RAF-based auto-scroll, and finalization pass on turn_complete. Build passes.

**Files changed:**
- .tugtool/tugplan-markdown-rendering-core.md

---

---
step: step-3
date: 2025-03-30T03:09:16Z
---

## step-3: Created TugMarkdownView component with static content rendering, virtualized scroll window, ResizeObserver-based height refinement, DOMPurify sanitization, and chunked idle-callback batching for large content. Build passes.

**Files changed:**
- .tugtool/tugplan-markdown-rendering-core.md

---

---
step: step-2
date: 2025-03-30T02:54:36Z
---

## step-2: Created RenderedBlockWindow class with overscan-based visible range computation, enter/exit range diffing, spacer height calculation, and dirty tracking. 24 tests passing.

**Files changed:**
- .tugtool/tugplan-markdown-rendering-core.md

---

---
step: step-1
date: 2025-03-30T02:47:27Z
---

## step-1: Created BlockHeightIndex class with Float64Array-backed prefix sum, lazy recomputation, binary search for offset-to-block mapping, growable array, and height estimation constants. 44 tests passing.

**Files changed:**
- .tugtool/tugplan-markdown-rendering-core.md

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

