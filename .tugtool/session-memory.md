# Session Memory — in-app-test-harness-701669b-2

## Project map
Tugdeck: React 19 + Vite + bun. Tugapp Swift `TestHarness/` DEBUG-only. `tests/in-app/` is a separate bun workspace, `bunfig.toml` roots `.` + NO happy-dom. Steps 1-3 deck-trace; Step 4 authored Phase 2 plan; Steps 5-11 built bridge+harness; Step 12 README; Step 13 m01 test; Step 14 m03 test; Step 15 m16 test.

## Files touched (condensed)
- tugdeck: `deck-trace.ts`, `deck-manager.ts` (testMode+seedDeckState), `deck-manager-store.ts` (invokeSaveCallback), `components/chrome/{card-host,deck-commit-beacon,deck-canvas}.tsx`, `main.tsx`, `test-surface.ts` (SURFACE_VERSION "1.0.0"). Tests in `src/__tests__/`.
- tugapp: `Sources/TestHarness/{TestHarnessBridge,TestHarnessListener,TestHarnessConnection,TestHarnessUserScript}.swift`; `MainWindow.swift`+`AppDelegate.swift` DEBUG wiring; `Tug.xcodeproj/project.pbxproj`.
- roadmap: `tugplan-in-app-bridge.md`.
- tests/in-app scaffold: `tsconfig.json` (@/_harness alias), `bunfig.toml`, `package.json`, `.gitignore`, `bun.lock`, `logs/.gitkeep`, `README.md`, `lint-no-timers.ts`.
- tests/in-app/_harness: `errors.ts`+test, `types.ts`, `rpc.ts`+test, `index.ts`, `client.ts`, `matchers.ts`+test.
- tests/in-app harness tests: `_smoke / _wait-for-condition / _version-handshake / _double-connect / _log-capture .test.ts` — all `skipIf(!SHOULD_RUN)`.
- Scenario tests: `m01-tab-switch-fc.test.ts` (step 13), `m03-pane-activation.test.ts` (step 14), **`m16-tab-close-handoff.test.ts` (step 15 NEW)**.

## Patterns established
- `invokeSaveCallback(id, source)` single entry. `_flipFirstResponder` takes `trigger` string.
- DEV gate: `import.meta.env?.DEV === true && window.__tugTestMode === true`.
- Swift `TestHarness/*.swift` opens `#if DEBUG` line 1, closes at EOF.
- WKUserScript `atDocumentStart` sets `__tugTestMode = true` before tugdeck JS.
- RPC: NDJSON, numeric id; `version`/`evalJS`/`waitForCondition`; evalJS=5000ms, wfc=2000ms/16ms.
- Test pattern: `skipIf(!SHOULD_RUN)` → `launchTugApp()` → `close()` in finally. One App per file; `app.reset()` between scenarios.
- Wrapper idiom: client helpers take `HarnessCaller`; App delegates `client.X(this as HarnessCaller, ...)`. `callSurface()` IIFE + `lit()` JSON helper.
- Matcher: pure `toContainOrderedSubset` + `registerSubsetMatcher()` at module load for fluent form.
- client.ts mirrors (NOT imports) test-surface.ts shapes. Drift caught by `SURFACE_VERSION` handshake [D11].
- Lint no-timers: pure-bun script. `_harness/` uses `setTimeoutNative` alias.
- File naming: `_*.test.ts` = harness-internal; `<scenario>.test.ts` = user scenarios.
- Scenario idiom: declare `app` OUTSIDE try so catch can call `app.tailLog(50)`. Trace assertions: `mark = markDeckTrace()` before gesture, `getDeckTrace({ since: mark })` after, scoped per transition. Omit fields (e.g. `source` on save-callback) in expected entries to accept any value for that field — the subset matcher only asserts specified fields.
- **FC-card seeding:** `componentId: "gallery-input"` — renders TugInputs stamped `data-tug-persist-value="gallery-input/size/sm"` etc. Selector `[data-card-id="X"] [data-tug-persist-value="gallery-input/size/sm"]`. PersistKey collisions across cards are OK because lookup scopes by `[data-card-id]` subtree.
- **Tab selector:** `[data-testid="tug-tab-${cardId}"]` (from `tug-tab-bar.tsx`).
- **Pane title selector:** `[data-pane-id="${paneId}"] [data-testid="tug-pane-title"]` — `.tug-pane` frame carries `data-pane-id={id}` (line 1153), `CardTitleBar` renders `<span data-testid="tug-pane-title">` (tug-pane.tsx:155).
- **Cross-pane activation path:** `pane-focus-controller` capture-pointerdown → `store.activateCard(pane.activeCardId)` → `_flipFirstResponder` → `fr-flip`. Title-bar click is a Branch-A activation (walks up to `[data-pane-id]`, no metaKey/no-activate opt-outs).

## Build / test notes
- `cd tugdeck && bun x tsc --noEmit` / `bun test` — exit 0.
- `cd tests/in-app && bun x tsc --noEmit -p tsconfig.json` — exit 0.
- `cd tests/in-app && bun test` — 29 pass, 11 skip (was 10), 0 fail.
- `cd tests/in-app && bun run lint:no-timers` — clean (8 files, was 7).
- `bun test tests/in-app/m03-pane-activation.test.ts` — exit 0 (1 skipped default).
- `bun test tests/in-app/m16-tab-close-handoff.test.ts` — exit 0 (1 skipped default).
- Swift `swiftc -typecheck ...` — exit 0.
- `tests/in-app/bunfig.toml` MUST keep `[test] root = "."` + NO happy-dom preload.

## Hints for upcoming steps
- Step 15 complete. Checkpoint `bun test tests/in-app/m16-tab-close-handoff.test.ts` exits 0 (skipped without `TUGAPP_IN_APP_TEST=1`).
- **Step 16 is Phase 3 integration checkpoint** — drift-prevention exercise (revert each fix by hand, verify test fails, revert the revert). Also: verify no happy-dom tests added, release-build binary size unchanged, update plan Status `draft`→`active`, update plan-doc-hygiene to point at `tugplan-in-app-bridge.md`.
- m16 idiom notes: used `traceClose.filter(e => e.kind === "save-callback" && e.cardId === "c2")` + `expect(...).toEqual([])` for the "did not happen" assertion (ordered-subset matcher is only positive). `DeckTraceEvent` is exported as a type from `_harness/index.ts`. Gated c3 host root wait AFTER the close-click (c3 not mounted until handoff runs).
- `EXPECTED_SURFACE_VERSION` in `_harness/index.ts` must match `SURFACE_VERSION` in `tugdeck/src/test-surface.ts` AND `TestHarnessConnection.surfaceVersion` (currently "1.0.0").
- `App.logPath` null unless `testName` passed. Always pass `testName` in scenario tests so `tailLog(50)` has output.
- Socket path default `/tmp/tugapp-test-${randomUUID()}.sock`. Swift allow-list `/tmp`, `/private/tmp`, `/var/folders`, `$HOME`.
- Deferred [D03]/[D08] from `tugplan-in-app-bridge.md` parked. Step 11 manual tasks deferred (require built Tug.app).
- `CaretState` input variant after typing: `{ kind:"input", selectionStart:N, selectionEnd:N, selectionDirection:"none", value:"..." }`. `readSelectionDirection` normalizes null→"none".
- `waitForCondition` + `assertHostRootRegistered(cardId)` is the right wait-for-mount primitive after `seedDeckState`. For multi-card seeds, AND multiple calls.
- **Save-callback semantics:** Intra-pane tab switch via `performSelectCard` (tug-pane.tsx:436) calls `store.invokeSaveCallback(outgoingCardId)` → emits trace event. Cross-pane activation via `pane-focus-controller` calls `store.activateCard(newFR)` with NO explicit save-callback in the production path as of this step. The m03 plan asserts a save-callback between click and fr-flip; if this fails in a real run, it surfaces a gap in the cross-pane save wiring (the M-series fix may add it). Omit `source` in the expected subset so any source tag passes.
