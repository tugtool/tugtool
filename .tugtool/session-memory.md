# Session Memory — in-app-test-harness-701669b-2

## Project map
Tugdeck: React 19 + Vite + bun. Source `tugdeck/src/`; tests `tugdeck/src/__tests__/`. Phase 1 (deck-trace) Steps 1-2 landed; Step 3 deferred; Step 4 authored `roadmap/tugplan-in-app-bridge.md`; Step 5 testMode + seedDeckState; Step 6 `window.__tug`; Step 7 Phase 2 bridge+harness+smoke; Step 8 in-app smoke tests; Step 9 version-skew + double-connect + log-capture; Step 10 client wrappers + matchers + lint; Step 11 Phase 2 verification-only checkpoint. Tugapp: `tugapp/Sources/`; `TestHarness/` DEBUG-only. `tests/in-app/` is a separate bun workspace; `bunfig.toml` roots `.`. Transport: parallel Unix socket per [D02].

## Files touched
- tugdeck/src/deck-trace.ts — ring buffer + observers.
- tugdeck/src/__tests__/deck-trace.test.ts — pure-logic tests.
- tugdeck/src/deck-manager.ts — testMode, put*Guarded, seedDeckState.
- tugdeck/src/deck-manager-store.ts — IDeckManagerStore.invokeSaveCallback.
- tugdeck/src/components/chrome/card-host.tsx — mount/unmount trace, [A3] emit wrappers.
- tugdeck/src/components/chrome/deck-commit-beacon.tsx — commit-tick emitter.
- tugdeck/src/components/chrome/deck-canvas.tsx — mounts DeckCommitBeacon.
- tugdeck/src/main.tsx — `__tugTestMode` read; attachTugTestSurface.
- tugdeck/src/test-surface.ts — TugTestSurface interface + createTugTestSurface. SURFACE_VERSION = "1.0.0".
- tugdeck/src/__tests__/deck-manager.test.ts — testMode/seedDeckState tests.
- roadmap/tugplan-in-app-bridge.md — Phase 2 Swift bridge plan.
- tugapp/Sources/TestHarness/TestHarnessBridge.swift — coordinator; envSocketPath().
- tugapp/Sources/TestHarness/TestHarnessListener.swift — [D06] + single-listener close-after-accept + stale-probe.
- tugapp/Sources/TestHarness/TestHarnessConnection.swift — NDJSON; version/evalJS/waitForCondition; hard timeouts.
- tugapp/Sources/TestHarness/TestHarnessUserScript.swift — `__tugTestMode=true` at atDocumentStart.
- tugapp/Sources/MainWindow.swift / AppDelegate.swift — DEBUG-only wiring.
- tugapp/Tug.xcodeproj/project.pbxproj — TestHarness group.
- tests/in-app/tsconfig.json, bunfig.toml, .gitignore, package.json (+ scripts), bun.lock, logs/.gitkeep — workspace scaffold.
- tests/in-app/_harness/errors.ts + errors.test.ts — error classes.
- tests/in-app/_harness/types.ts — RPC types, EvalJsOptions, WaitForConditionOptions, LaunchTugAppOptions (incl. expectedSurfaceVersion).
- tests/in-app/_harness/rpc.ts + rpc.test.ts — RpcClient + translateError.
- tests/in-app/_harness/index.ts — launchTugApp + App (evalJS/waitForCondition/tailLog/close + Step 10 typed wrappers: click/type/focusElement/reset/seedDeckState/getActive/getFocused/getCaret/getFormControlValue/assertHostRootRegistered/getDeckTrace/markDeckTrace/clearDeckTrace/enableDeckTrace/expectFocusedCard/expectCaret). Re-exports matchers + client types.
- tests/in-app/_harness/client.ts — NEW (Step 10). Pure typed wrappers taking HarnessCaller. Locally-mirrored CaretState/ClickOptions/ResetOptions/SeedDeckStateArgs/DeckTraceEvent shapes (no tugdeck source imports — keeps tsc graph small). ClientMethodNames type. callSurface guard throws if window.__tug missing.
- tests/in-app/_harness/matchers.ts — NEW (Step 10). `toContainOrderedSubset(actual, expected): MatcherResult` pure predicate + `registerSubsetMatcher()` for `expect.extend` + `declare module "bun:test"` augmentation. Partial-match: unspecified expected keys are wildcards; explicit `undefined` means "actual must be undefined"; nested objects recurse; arrays deep-equal; missing actual entries fail with informative message naming entry index.
- tests/in-app/_harness/matchers.test.ts — NEW (Step 10). 14 pure-logic tests: pass cases (single, in-order subset with intervening, partial wildcards, empty expected, nested partial, arrays deep-equal), fail cases (missing, out-of-order, value mismatch, nested mismatch, array elem mismatch, non-array actual, same-entry reuse, explicit undefined).
- tests/in-app/lint-no-timers.ts — NEW (Step 10). Bun script scanning `tests/in-app/*.ts` for `\bsetTimeout\b` / `\bsetInterval\b`. Allowlists: `_harness/`, `node_modules/`, `logs/` directories; `lint-no-timers.ts` file itself (avoids self-false-positive from its own documentation). Exits 0 clean / 1 with file:line details. `bun run lint:no-timers` via package.json script.
- tests/in-app/_smoke.test.ts / _wait-for-condition.test.ts / _version-handshake.test.ts / _double-connect.test.ts / _log-capture.test.ts — skipIf-gated on TUGAPP_IN_APP_TEST=1.

## Patterns established
- `invokeSaveCallback(id, source)` is the single save-callback entry.
- `_flipFirstResponder` callers pass a `trigger` string.
- DEV gate idiom in TS: `import.meta.env?.DEV === true && window.__tugTestMode === true`.
- Transport: parallel Unix socket ([D02]); `ControlSocket.swift` template.
- Swift DEBUG contract: every `TestHarness/*.swift` opens `#if DEBUG` line 1, closes at EOF.
- WKUserScript at `atDocumentStart` sets `__tugTestMode = true` before tugdeck JS.
- RPC: NDJSON, numeric `id`; methods `version`/`evalJS`/`waitForCondition`; evalJS=5000ms, waitForCondition=2000ms/16ms.
- `TestHarnessBridge.envSocketPath()` is sole reader of `TUGAPP_TEST_SOCKET`.
- In-app tests use `describe.skipIf(!SHOULD_RUN)` gated on `TUGAPP_IN_APP_TEST=1`; launch own App; close in finally.
- Step 10 wrapper idiom: client helpers take `HarnessCaller` (minimal `{evalJS,waitForCondition}`). App methods are thin delegates `client.X(this as HarnessCaller, ...)`. Script serialization uses `JSON.stringify` helper `lit()` with `undefined`→"undefined". Every surface call wrapped by `callSurface()` IIFE that throws descriptive error if `window.__tug` missing.
- Step 10 matcher idiom: dual-shape — pure `toContainOrderedSubset(actual, expected)` predicate + `registerSubsetMatcher()` for fluent form. `declare module "bun:test" { interface Matchers }` augmentation supports `.toContainOrderedSubset` chain when registered.
- Step 10 type-duplication pattern: client.ts and tugdeck/src/test-surface.ts have parallel `CaretState`/`ClickOptions`/`ResetOptions`/`SeedDeckStateArgs` shapes. Do NOT import across the boundary — tugdeck imports React/DOM and blows up `tests/in-app/` tsc. Drift guarded at runtime by `SURFACE_VERSION` handshake ([D11]).
- Step 10 lint pattern: pure-bun script (no eslint infra). `_harness/` allowlisted (uses `setTimeoutNative` indirection already). Self-exempt (`FILE_ALLOWLIST`) because doc block mentions the banned tokens.

## Build / test notes
- `cd tugdeck && bun x tsc --noEmit` — exit 0.
- `cd tugdeck && bun test` — 2434 pass, 0 fail.
- `cd tests/in-app && bun x tsc --noEmit -p tsconfig.json` — exit 0.
- `cd tests/in-app && bun test` — 29 pass, 8 skip, 0 fail (Step 10 added 14 matchers tests).
- `cd tests/in-app && bun run lint:no-timers` — exit 0 clean (5 files scanned; harness internals excluded).
- Swift typecheck (DEBUG and release): `swiftc -typecheck ...` — exit 0.
- `tests/in-app/bunfig.toml` has `[test] root = "."` + NO happy-dom preload — must stay.

## Hints for upcoming steps
- Step 11 complete. Automated checks all green (tugdeck tsc, tugdeck tests 2434/0, in-app tsc, in-app tests 29pass/8skip/0fail, lint:no-timers clean). Manual tasks 1, 2, 3, 4 deferred: binary-size baseline (no pre-plan baseline artifact), Xcode archive `nm` inspection, dev-mode launch verification, test-mode launch+evalJS verification — all require a built debug/release Tug.app on a macOS dev box which the agent cannot run. [D13] style decision: manual checkpoints deferred and tracked; next-step work not blocked.
- Step 12 (scaffold + README): `tests/in-app/_smoke.test.ts` already exists from Step 7. Step 12 adds README.md covering: `bun test tests/in-app/` command, one-app-per-file lifecycle, pointer to fidelity-limits, `bun run lint:no-timers` command.
- Step 13-15 (M01/M03/M16 tests): import from `@/_harness` — `launchTugApp`, `toContainOrderedSubset`, `registerSubsetMatcher`. Call `registerSubsetMatcher()` at module load to enable `expect(trace).toContainOrderedSubset([...])`. Use `app.seedDeckState(...)` → `app.click(...)` / `app.type(...)` / `app.focusElement(...)` → `app.expectFocusedCard(...)` / `app.expectCaret(...)`. Get trace via `mark = await app.markDeckTrace(); ...; const trace = await app.getDeckTrace({ since: mark });`.
- Client mirrors `CaretState` shape — keep in sync if tugdeck `SURFACE_VERSION` bumps. `ClientMethodNames` union is authoring-time reminder of surface coverage.
- `_harness/index.ts` already imports `setTimeoutNative` (aliased) to hide `setTimeout` from lint-no-timers. Follow that pattern if harness internals ever need another native timer.
- `EXPECTED_SURFACE_VERSION` in `_harness/index.ts` must match `SURFACE_VERSION` in `tugdeck/src/test-surface.ts` AND `TestHarnessConnection.surfaceVersion`.
- `App.logPath` is `null` unless `testName` was passed to `launchTugApp`.
- Socket path default: `/tmp/tugapp-test-${randomUUID()}.sock`. Swift allow-list: `/tmp`, `/private/tmp`, `/var/folders`, `$HOME`.
- Deferred [D03]/[D08] from `tugplan-in-app-bridge.md` remain parked.
- `tests/in-app/package.json` now has `scripts.lint:no-timers` — `bun run lint:no-timers` from `tests/in-app/` runs the checker.
