# Session Memory — in-app-test-harness-701669b-2

## Project map
Tugdeck: React 19 + Vite + bun (`tugdeck/src/`; tests `tugdeck/src/__tests__/`). Tugapp: `tugapp/Sources/`; `TestHarness/` DEBUG-only. `tests/in-app/` is a separate bun workspace; `bunfig.toml` roots `.` with NO happy-dom preload. Transport: parallel Unix socket ([D02]). Steps 1-3 (deck-trace) landed; Step 4 authored `roadmap/tugplan-in-app-bridge.md`; Steps 5-11 built Phase 2 bridge+harness; Step 12 authored `tests/in-app/README.md` (scaffold finalized).

## Files touched (condensed)
- tugdeck: `deck-trace.ts`, `deck-manager.ts` (testMode+seedDeckState), `deck-manager-store.ts` (invokeSaveCallback), `components/chrome/card-host.tsx` + `deck-commit-beacon.tsx` + `deck-canvas.tsx`, `main.tsx` (attachTugTestSurface), `test-surface.ts` (SURFACE_VERSION="1.0.0"). Tests under `src/__tests__/`.
- tugapp: `Sources/TestHarness/{TestHarnessBridge,TestHarnessListener,TestHarnessConnection,TestHarnessUserScript}.swift`; `MainWindow.swift` + `AppDelegate.swift` DEBUG wiring; `Tug.xcodeproj/project.pbxproj` TestHarness group.
- roadmap: `tugplan-in-app-bridge.md` (Phase 2 plan).
- tests/in-app scaffold: `tsconfig.json` (path alias `@/_harness`), `bunfig.toml`, `package.json`, `.gitignore` (logs/), `bun.lock`, `logs/.gitkeep`.
- tests/in-app/_harness: `errors.ts`+test, `types.ts`, `rpc.ts`+test, `index.ts` (launchTugApp + App: evalJS/waitForCondition/tailLog/close + typed wrappers click/type/focusElement/reset/seedDeckState/getActive/getFocused/getCaret/getFormControlValue/assertHostRootRegistered/getDeckTrace/markDeckTrace/clearDeckTrace/enableDeckTrace/expectFocusedCard/expectCaret), `client.ts` (pure wrappers, locally-mirrored shapes), `matchers.ts`+test (`toContainOrderedSubset` + `registerSubsetMatcher`).
- tests/in-app tests: `_smoke.test.ts` / `_wait-for-condition.test.ts` / `_version-handshake.test.ts` / `_double-connect.test.ts` / `_log-capture.test.ts` — all `describe.skipIf(!SHOULD_RUN)` gated on `TUGAPP_IN_APP_TEST=1`.
- tests/in-app/lint-no-timers.ts — bun script for `\bsetTimeout|setInterval\b` bans. `_harness/` and self allowlisted.
- **tests/in-app/README.md — NEW (Step 12).** Run command, one-app-per-file lifecycle + app.reset(), fidelity pointer, how-to-add-a-test recipe, lint:no-timers note, dir layout.

## Patterns established
- `invokeSaveCallback(id, source)` is the single save-callback entry. `_flipFirstResponder` callers pass a `trigger` string.
- DEV gate idiom (TS): `import.meta.env?.DEV === true && window.__tugTestMode === true`.
- Swift DEBUG contract: every `TestHarness/*.swift` opens `#if DEBUG` line 1, closes at EOF.
- WKUserScript at `atDocumentStart` sets `__tugTestMode = true` before tugdeck JS.
- RPC: NDJSON, numeric `id`; `version`/`evalJS`/`waitForCondition`; evalJS=5000ms, waitForCondition=2000ms/16ms. `TestHarnessBridge.envSocketPath()` sole reader of `TUGAPP_TEST_SOCKET`.
- In-app tests pattern: `describe.skipIf(!SHOULD_RUN)` → `launchTugApp()` in try → `close()` in finally. One App per file; `app.reset()` between scenarios within a file.
- Wrapper idiom: client helpers take `HarnessCaller` (minimal `{evalJS,waitForCondition}`); App methods delegate via `client.X(this as HarnessCaller, ...)`. `callSurface()` IIFE throws if `window.__tug` missing. Script serialization uses `lit()` JSON helper.
- Matcher idiom: pure `toContainOrderedSubset(actual, expected)` predicate + `registerSubsetMatcher()` for fluent form. `declare module "bun:test" { interface Matchers }` augmentation.
- Type-duplication rule: client.ts mirrors (does NOT import) tugdeck/src/test-surface.ts shapes (CaretState/ClickOptions/ResetOptions/SeedDeckStateArgs). Drift guarded at runtime by `SURFACE_VERSION` handshake ([D11]).
- Lint (no-timers): pure-bun script, no eslint. `_harness/` uses `setTimeoutNative` alias indirection.
- File-name convention (Step 12 README): `_*.test.ts` is reserved for harness-internal protocol/lifecycle tests; user-authored scenarios use `<scenario>.test.ts`.

## Build / test notes
- `cd tugdeck && bun x tsc --noEmit` — exit 0.
- `cd tugdeck && bun test` — 2434 pass, 0 fail; zero `tests/in-app/` refs in output.
- `cd tests/in-app && bun x tsc --noEmit -p tsconfig.json` — exit 0.
- `cd tests/in-app && bun test` — 29 pass, 8 skip, 0 fail.
- `cd tests/in-app && bun run lint:no-timers` — exit 0 clean (5 files scanned).
- Swift typecheck: `swiftc -typecheck ...` — exit 0.
- `tests/in-app/bunfig.toml` MUST keep `[test] root = "."` + NO happy-dom preload.
- Tugdeck bunfig roots at `src`, so `tests/in-app/` cannot leak into tugdeck's `bun test`.

## Hints for upcoming steps
- Step 12 complete. All 3 checkpoints green (in-app 29/8/0, tugdeck 2434/0 with zero in-app refs, README present+readable).
- Step 13-15 (M01/M03/M16 tests): import from `@/_harness` — `launchTugApp`, `toContainOrderedSubset`, `registerSubsetMatcher`. Call `registerSubsetMatcher()` at module load to enable `expect(trace).toContainOrderedSubset([...])`. Pattern: `app.seedDeckState(...)` → `app.click/type/focusElement(...)` → `app.expectFocusedCard/expectCaret(...)`. For trace: `const mark = await app.markDeckTrace(); ...; const trace = await app.getDeckTrace({ since: mark });`. README.md shows the canonical shape — copy from it.
- `EXPECTED_SURFACE_VERSION` in `_harness/index.ts` must match `SURFACE_VERSION` in `tugdeck/src/test-surface.ts` AND `TestHarnessConnection.surfaceVersion` (currently "1.0.0").
- `App.logPath` is `null` unless `testName` was passed to `launchTugApp`.
- Socket path default: `/tmp/tugapp-test-${randomUUID()}.sock`. Swift allow-list: `/tmp`, `/private/tmp`, `/var/folders`, `$HOME`.
- Deferred [D03]/[D08] from `tugplan-in-app-bridge.md` remain parked.
- Step 11 manual tasks deferred (binary-size baseline, archive `nm` inspection, dev-launch + test-mode-launch verification) — all require a built debug/release Tug.app which agent cannot run.
- `_harness/index.ts` uses `setTimeoutNative` alias to hide `setTimeout` from lint-no-timers. Follow that pattern if harness internals need another native timer.
