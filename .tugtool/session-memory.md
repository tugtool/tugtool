# Session Memory — in-app-test-harness-701669b-2

## Project map
Tugdeck: React 19 + Vite + bun. Source `tugdeck/src/`; tests `tugdeck/src/__tests__/`. Phase 1 (deck-trace) Steps 1-2 landed; Step 3 deferred; Step 4 authored `roadmap/tugplan-in-app-bridge.md`; Step 5 testMode + seedDeckState; Step 6 `window.__tug`; Step 7 Phase 2 bridge+harness+smoke; Step 8 in-app smoke tests; Step 9 version-skew + double-connect + log-capture. Tugapp: `tugapp/Sources/`; `TestHarness/` dir DEBUG-only. `tests/in-app/` is a separate bun workspace; `bunfig.toml` roots `.`. Transport: parallel Unix socket per [D02].

## Files touched
- tugdeck/src/deck-trace.ts — ring buffer + observers.
- tugdeck/src/__tests__/deck-trace.test.ts — 8 pure-logic tests.
- tugdeck/src/deck-manager.ts — testMode flag; put*Guarded; seedDeckState.
- tugdeck/src/deck-manager-store.ts — IDeckManagerStore.invokeSaveCallback.
- tugdeck/src/components/chrome/card-host.tsx — mount/unmount trace, [A3] emit wrappers.
- tugdeck/src/components/chrome/deck-commit-beacon.tsx — commit-tick emitter.
- tugdeck/src/components/chrome/deck-canvas.tsx — mounts DeckCommitBeacon.
- tugdeck/src/main.tsx — `__tugTestMode` read; testMode passthrough; attachTugTestSurface.
- tugdeck/src/test-surface.ts — TugTestSurface interface + createTugTestSurface.
- tugdeck/src/__tests__/deck-manager.test.ts — +7 tests for testMode / seedDeckState.
- roadmap/tugplan-in-app-bridge.md — Phase 2 Swift bridge plan.
- tugapp/Sources/TestHarness/TestHarnessBridge.swift — coordinator; `envSocketPath()`.
- tugapp/Sources/TestHarness/TestHarnessListener.swift — [D06] security; Step 9: stale-socket liveness probe (connect→ECONNREFUSED unlinks; success throws `staleSocketInUse`); handleAccept closes listen-FD after first accept so second connect gets ECONNREFUSED from kernel.
- tugapp/Sources/TestHarness/TestHarnessConnection.swift — NDJSON per-conn; version/evalJS/waitForCondition. Hard timeouts via `EvalCompletionState`/`PollState`. `isTruthy` handles nil/NSNull/false/0/"".
- tugapp/Sources/TestHarness/TestHarnessUserScript.swift — installs `__tugTestMode = true` at `atDocumentStart`.
- tugapp/Sources/MainWindow.swift — `#if DEBUG` user-script install, `testHarnessWebView()` accessor.
- tugapp/Sources/AppDelegate.swift — `#if DEBUG` testHarnessBridge lifecycle.
- tugapp/Tug.xcodeproj/project.pbxproj — TestHarness group wired.
- tests/in-app/tsconfig.json, bunfig.toml, .gitignore, package.json, bun.lock, logs/.gitkeep — workspace scaffold.
- tests/in-app/_harness/errors.ts — TimeoutError / AppCrashedError / VersionSkewError.
- tests/in-app/_harness/types.ts — RPC Request / Response<T>; Step 9 added `expectedSurfaceVersion` option.
- tests/in-app/_harness/rpc.ts — RpcClient (NDJSON, id correlation, `translateError`).
- tests/in-app/_harness/index.ts — `launchTugApp` + `App`; Step 9 added per-test log capture (`logs/<testName>.log`), `app.logPath`, `app.tailLog(lines=50)`, SIGINT/SIGTERM/exit handlers with `detachSignals` returned for `app.close()` to call, `expectedSurfaceVersion` override plumbed into handshake.
- tests/in-app/_smoke.test.ts — smoke; evalJS("1+1")===2 + version handshake.
- tests/in-app/_harness/errors.test.ts — error-class unit tests.
- tests/in-app/_harness/rpc.test.ts — RpcClient tests.
- tests/in-app/_wait-for-condition.test.ts — eval-error/timeout/immediate truthy.
- tests/in-app/_version-handshake.test.ts — NEW (Step 9). One skipIf-gated test: wrong `expectedSurfaceVersion: "2.0.0"` triggers VersionSkewError with preserved expected/actual.
- tests/in-app/_double-connect.test.ts — NEW (Step 9). One skipIf-gated test: raw `Bun.connect` on active socketPath rejects with ECONNREFUSED (matches codeStr/message/errno 61|111); first connection stays alive for post-refusal evalJS.
- tests/in-app/_log-capture.test.ts — NEW (Step 9). One skipIf-gated test: `launchTugApp({ testName })` → `evalJS("console.log(marker)")` → close → assert `app.logPath` exists, contents contain marker, `app.tailLog(50)` also contains marker.

## Patterns established
- `invokeSaveCallback(id, source)` is the single save-callback entry.
- `_flipFirstResponder` callers pass a `trigger` string.
- DEV gate idiom in TS: `import.meta.env?.DEV === true && window.__tugTestMode === true`.
- Transport: parallel Unix socket ([D02]); `ControlSocket.swift` template.
- Swift DEBUG contract: every `TestHarness/*.swift` opens `#if DEBUG` line 1, closes `#endif` at EOF; all MainWindow.swift + AppDelegate.swift TestHarness refs inside `#if DEBUG`.
- WKUserScript at `atDocumentStart` sets `__tugTestMode = true` before tugdeck JS.
- RPC: NDJSON, numeric `id`; methods `version`/`evalJS`/`waitForCondition`; evalJS=5000ms, waitForCondition=2000ms/16ms.
- Race discipline: NSLock-backed state guarantees exactly one winner.
- `TestHarnessBridge.envSocketPath()` is sole reader of `TUGAPP_TEST_SOCKET`.
- In-app tests use `describe.skipIf(!SHOULD_RUN)` gated on `TUGAPP_IN_APP_TEST=1`; launch own App; close in finally.
- Single-listener pattern (Step 9): listener closes its listening FD after first accept → path still bound but no listener → kernel returns ECONNREFUSED. Re-listen is NOT re-implemented (test scope is per-subprocess).
- Stale-socket liveness probe (Step 9): stat path, UID check, then bare connect — ECONNREFUSED or ENOENT → unlink; connect success → throw `staleSocketInUse`.
- Log capture (Step 9): `tests/in-app/logs/<sanitizedTestName>.log`, truncate on open (`flags: "w"`). stdout+stderr piped via ReadableStream readers. Log stream closed in `App.close()`.
- Signal handlers (Step 9): `installSignalHandlers(subprocess)` returns `detachSignals` for `App.close()` to remove; prevents handler accumulation across sequential launches.

## Build / test notes
- `cd tugdeck && bun x tsc --noEmit` — exit 0.
- `cd tugdeck && bun test` — 2434 pass, 0 fail.
- `cd tests/in-app && bun x tsc --noEmit -p tsconfig.json` — exit 0.
- `cd tests/in-app && bun test` — 15 pass, 8 skip (5 prior + 3 new), 0 fail.
- Swift typecheck (DEBUG and release): `swiftc -typecheck -sdk $(xcrun --sdk macosx --show-sdk-path) -target arm64-apple-macos13.0 [-D DEBUG] Sources/*.swift Sources/TestHarness/*.swift` — exit 0.
- `xcodebuild -scheme Tug -configuration Debug build` — Swift phase OK; Copy-Rust-binaries shell phase fails (no tugrust/target/Debug/) — expected, out of scope.
- `grep -L '^#if DEBUG' tugapp/Sources/TestHarness/*.swift` returns empty.
- `tests/in-app/bunfig.toml` has `[test] root = "."` + NO happy-dom preload — must stay.

## Hints for upcoming steps
- Step 10 (bun harness wrappers + `toContainOrderedSubset`): add `tests/in-app/_harness/matchers.ts`. Import types from `tugdeck/src/test-surface.ts` (TugTestSurface, CaretState). Add no-setTimeout/setInterval eslint rule scoped to `tests/in-app/`. Implement `expectFocusedCard(cardId)` via `waitForCondition("__tug.getFocusedCardId() === " + JSON.stringify(cardId))`.
- Step 11 (Phase 2 Integration Checkpoint): requires built debug Tug.app at `/Applications/Tug.app/Contents/MacOS/Tug` or `TUGAPP_DEBUG_PATH`. Set `TUGAPP_IN_APP_TEST=1`.
- Step 9's second checkpoint ("Three new in-app tests pass") was DEFERRED — same pattern as Steps 7/8: no debug binary present in the worktree. Tests are correctly skipIf-gated; they will run once Step 11's integration checkpoint runs against a built Tug.app. First checkpoint (`bun test tests/in-app/` exits 0) is satisfied.
- `EXPECTED_SURFACE_VERSION = "1.0.0"` in `_harness/index.ts` must match `SURFACE_VERSION` in `tugdeck/src/test-surface.ts` AND `TestHarnessConnection.surfaceVersion`. To force skew without a Swift rebuild, pass `expectedSurfaceVersion` option to `launchTugApp`.
- Socket path default: `/tmp/tugapp-test-${randomUUID()}.sock`. Swift allow-list: `/tmp`, `/private/tmp`, `/var/folders`, `$HOME`.
- Bun `RpcTransport` uses `sharedState` filled during `connectWithRetry`, read by `makeSocketTransport`.
- `tests/in-app/package.json` has only `bun-types`; add deps via `cd tests/in-app && bun add -d <pkg>`.
- Deferred [D03]/[D08] from `tugplan-in-app-bridge.md` remain parked.
- `App.logPath` is `null` unless `testName` was passed. Step 10+'s higher-level helper may want to default `testName` from `bun:test`'s current-test name, but there is no stable API for this — Step 9 takes it as an explicit caller concern.
