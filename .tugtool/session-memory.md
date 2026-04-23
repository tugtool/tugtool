# Session Memory — in-app-test-harness-701669b-2

## Project map
Tugdeck: React 19 + Vite + bun. Source `tugdeck/src/`; tests `tugdeck/src/__tests__/`. Phase 1 (deck-trace) Steps 1-2 landed; Step 3 deferred; Step 4 authored `roadmap/tugplan-in-app-bridge.md`; Step 5 landed testMode + seedDeckState; Step 6 landed `window.__tug`; Step 7 landed full Phase 2 (Swift bridge + bun harness + smoke test); Step 8 added 3 in-app smoke tests (underlying Swift impl already shipped in Step 7). Tugapp (macOS host): `tugapp/Sources/`; DEBUG-only `TestHarness/` dir, 4 Swift files each `#if DEBUG`-bracketed at file scope. `tests/in-app/` is a separate bun workspace; its `bunfig.toml` roots `.` and does NOT preload happy-dom. Transport: parallel Unix socket per [D02], NOT tugcast.

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
- tugapp/Sources/TestHarness/TestHarnessBridge.swift — coordinator; `envSocketPath()`; listener+connection lifecycle.
- tugapp/Sources/TestHarness/TestHarnessListener.swift — Unix-socket listener; [D06] security (parent-dir allow-list, uid, fchmod 0600, fstat).
- tugapp/Sources/TestHarness/TestHarnessConnection.swift — NDJSON per-conn; dispatches version/evalJS/waitForCondition. surfaceVersion "1.0.0". Hard timeouts via `EvalCompletionState`/`PollState` NSLock race winners. `isTruthy` for nil/NSNull/false/0/"".
- tugapp/Sources/TestHarness/TestHarnessUserScript.swift — `install(into:)`; `__tugTestMode = true` at `atDocumentStart`; developerExtrasEnabled.
- tugapp/Sources/MainWindow.swift — `#if DEBUG` user-script install when `envSocketPath() != nil`; `testHarnessWebView()` accessor.
- tugapp/Sources/AppDelegate.swift — `#if DEBUG` `testHarnessBridge` field; starts/attaches on launch; teardown on terminate.
- tugapp/Tug.xcodeproj/project.pbxproj — TestHarness group + Sources phase wiring.
- tests/in-app/tsconfig.json, bunfig.toml, .gitignore, package.json, bun.lock, logs/.gitkeep — workspace scaffold.
- tests/in-app/_harness/errors.ts — TimeoutError / AppCrashedError / VersionSkewError.
- tests/in-app/_harness/types.ts — RPC Request / Response<T> / option types.
- tests/in-app/_harness/rpc.ts — RpcClient (NDJSON, id correlation, `translateError` wire-name → class).
- tests/in-app/_harness/index.ts — `launchTugApp` (Bun.spawn + Bun.connect retry + version handshake), `App` with evalJS/waitForCondition/close. `EXPECTED_SURFACE_VERSION = "1.0.0"`.
- tests/in-app/_smoke.test.ts — skipIf gated; evalJS("1+1")===2 + version handshake.
- tests/in-app/_harness/errors.test.ts — error-class unit tests.
- tests/in-app/_harness/rpc.test.ts — RpcClient correlation/framing/translation/close tests.
- tests/in-app/_wait-for-condition.test.ts — NEW (Step 8). Three skipIf-gated in-app tests: eval-error (evalJS throw → Error w/ matching name/message), condition-timeout (never-truthy → TimeoutError w/ timeoutMs), condition-immediate (truthy returns value).

## Patterns established
- `invokeSaveCallback(id, source)` is the single save-callback entry.
- `_flipFirstResponder` callers pass a `trigger` string.
- DEV gate idiom in TS: `import.meta.env?.DEV === true && window.__tugTestMode === true`.
- Transport: parallel Unix socket ([D02]); `ControlSocket.swift` was template for `TestHarnessListener`.
- Swift DEBUG contract: every `TestHarness/*.swift` opens `#if DEBUG` at line 1, closes `#endif` at EOF; MainWindow.swift + AppDelegate.swift TestHarness refs all inside `#if DEBUG ... #endif`.
- Two-layer TS gate: `import.meta.env.DEV && window.__tugTestMode === true`. WKUserScript at `atDocumentStart` sets `__tugTestMode = true` before tugdeck JS (Spec [#s05]).
- RPC: NDJSON, numeric `id`; methods `version`/`evalJS`/`waitForCondition`; server timeouts evalJS=5000ms, waitForCondition=2000ms/16ms poll.
- Race discipline: Swift `NSLock`-backed `EvalCompletionState`/`PollState` guarantees exactly one of (timeout, completion, poll winner) resolves.
- Discriminated-union Omit: `type RequestWithoutId = Request extends infer R ? (R extends {id: number} ? Omit<R, "id"> : never) : never`.
- `TestHarnessBridge.envSocketPath()` is sole reader of `TUGAPP_TEST_SOCKET`.
- In-app tests use `describe.skipIf(!SHOULD_RUN)` gated on `TUGAPP_IN_APP_TEST=1`, launch own App, close in `finally`.

## Build / test notes
- `cd tugdeck && bun x tsc --noEmit` — exit 0.
- `cd tugdeck && bun test` — 2434 pass, 0 fail.
- `cd tests/in-app && bun x tsc --noEmit -p tsconfig.json` — exit 0.
- `cd tests/in-app && bun test` — 15 pass, 5 skip, 0 fail after Step 8 (3 new skipIf-gated).
- Swift type-check (DEBUG + release): `swiftc -typecheck -sdk $(xcrun --sdk macosx --show-sdk-path) -target arm64-apple-macos13.0 [-D DEBUG] Sources/*.swift Sources/TestHarness/*.swift` — exit 0.
- `xcodebuild -scheme Tug -configuration Debug build` — Swift phase succeeds; Copy-Rust-binaries shell phase fails (no tugrust/target/Debug/) — expected, out of scope.
- `grep -L '^#if DEBUG' tugapp/Sources/TestHarness/*.swift` returns empty.
- tugdeck `bunfig.toml` has `root = "src"`, structurally excludes `tests/in-app/`.
- `tests/in-app/bunfig.toml` has `[test] root = "."` + NO happy-dom preload — must stay.

## Hints for upcoming steps
- Step 9 (version handshake + lifecycle + log capture): version handshake already implemented. Step 9 likely wires `LaunchTugAppOptions.testName` (defined, unused) to `logs/<test>.log` stdout/stderr redirection.
- Step 10 (bun harness wrappers + `toContainOrderedSubset`): add `tests/in-app/_harness/matchers.ts`. Import types from `tugdeck/src/test-surface.ts` (TugTestSurface, CaretState, etc.). Add no-setTimeout/setInterval eslint rule scoped to `tests/in-app/`.
- Step 11 (Phase 2 Integration Checkpoint): requires built debug Tug.app at `/Applications/Tug.app/Contents/MacOS/Tug` (or `TUGAPP_DEBUG_PATH`). Set `TUGAPP_IN_APP_TEST=1` to actually run.
- Step 8's second checkpoint ("Three in-app smoke tests pass") was deferred — same pattern as Step 7: no debug binary in the worktree. Tests are correctly skipIf-gated.
- `EXPECTED_SURFACE_VERSION = "1.0.0"` in `_harness/index.ts` must match `SURFACE_VERSION` in `tugdeck/src/test-surface.ts` AND `TestHarnessConnection.surfaceVersion`.
- Socket path default: `/tmp/tugapp-test-${randomUUID()}.sock`. Swift allow-list: `/tmp`, `/private/tmp`, `/var/folders`, `$HOME`.
- Bun `RpcTransport` uses `sharedState` object filled during `connectWithRetry`, read by `makeSocketTransport` — don't refactor without reading why.
- `tests/in-app/package.json` has only `bun-types`; add deps via `cd tests/in-app && bun add -d <pkg>`.
- Deferred [D03]/[D08] from `tugplan-in-app-bridge.md` remain parked.
