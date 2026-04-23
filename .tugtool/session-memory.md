# Session Memory — in-app-test-harness-7d9c56e-1

## Project map
Tugdeck is the browser frontend (React 19 + Vite + bun). Source lives under `tugdeck/src/`; tests colocate under `tugdeck/src/__tests__/`. Bun is the package manager + test runner. Deck orchestration is in `deck-manager.ts` / `deck-manager-store.ts`; focus activation in `focus-transfer.ts`; card mount/unmount in `components/chrome/card-host.tsx`; deck root render in `components/chrome/deck-canvas.tsx`. Tugplan at `.tugtool/tugplan-in-app-test-harness.md`. Phase 1 instrumentation complete through Step 2; Step 3 is observational (no code).

## Files touched
- tugdeck/src/deck-trace.ts — ring buffer + observers. `enable(true)` idempotently installs destination-flip (per-card diff on store notify) + document-level focusin/focusout (capture phase). `enable(false)` tears down. `formatElement()` exported.
- tugdeck/src/__tests__/deck-trace.test.ts — 8 pure-logic tests (step 1).
- tugdeck/src/deck-manager.ts — `_flipFirstResponder` takes `trigger: string` (last arg); 7 internal callers pass tags (`activateCard`, `addCard`, `_closePane`, `_setActiveCardInPane`, `_addCardToPane`, `_removeCard`, `_detachCard`, `_moveCardToPane`). `invokeSaveCallback(id, source?)` emits `save-callback` before invoking registered callback. Visibilitychange/beforeunload/saveAndFlushSync/saveAndFlush/prepareForReload rewritten from `forEach((cb)=>cb())` to `for cardId of keys { invokeSaveCallback(cardId, source) }` so trace sees tagged events. `flushSaveCallbackBeforeDestruction` → `close-handoff`; `_detachCard`/`_moveCardToPane` pre-move flush → `manual`.
- tugdeck/src/deck-manager-store.ts — `IDeckManagerStore.invokeSaveCallback` signature now `(id: string, source?: SaveCallbackSource) => void` (optional param keeps existing test mocks type-compatible).
- tugdeck/src/components/chrome/card-host.tsx — [A3] effect emits `a3-fire` on every return path (first-run/not-destination/prev-was-true/gate-refused/no-bag/no-host/null=completed). Helper `traceApplyFocusSnapshot(site, cardId, cardRoot, snapshot)` wraps the three applyFocusSnapshot call sites (cold-boot/cross-pane-move/a3-dom-authority) and emits `focus-call` with activeBefore/activeAfter/hidden/targetSelector. Two `restoreCardDomSelection` sites emit `selection-restore`. Cold-boot `applyFocusSnapshot` emits extra `selection-restore` tagged via=applyFocusSnapshot per [#l01-recording-sites]. `registerCardHostRoot` useLayoutEffect emits `card-host-mount`/`card-host-unmount` (added `hostStackId` to dep array).
- tugdeck/src/components/chrome/deck-commit-beacon.tsx — NEW. `<DeckCommitBeacon/>` renders null; no-deps useLayoutEffect increments counter + emits `commit-tick`.
- tugdeck/src/components/chrome/deck-canvas.tsx — Imports + renders `<DeckCommitBeacon/>` once inside the deck root div.

## Patterns established
- `invokeSaveCallback(id, source)` is the single entry point for all save-callback fires; direct `saveCallbacks.forEach` is forbidden (would skip trace recording).
- Helper wrappers (`traceApplyFocusSnapshot`, `emitA3`) keep call sites clean while guaranteeing trace events fire on every path including early returns.
- DEV gate idiom remains `import.meta.env?.DEV === true`. Session-memory-only; `deckTrace` trace itself is enable-flag gated, not DEV-gated.
- Observer install gate: `installObservers()` only if first transition false→true; `uninstallObservers()` on true→false. Idempotent via module-scope disposer refs.
- When using `isFirstRun` on a `useLayoutEffect`, still record the trace event before returning — `a3-fire` MUST fire on EVERY run for the trace to be useful.

## Build / test notes
- `cd tugdeck && bun x tsc --noEmit` — exits 0 clean.
- `cd tugdeck && bun test` — 2427 pass, 0 fail, ~10.4s (unchanged from baseline; no new tests per Step 2 plan).
- No linter/formatter configured in tugdeck; tsc is the only gate.
- Test preload: happy-dom + src/__tests__/setup-silence.ts.
- grep checkpoint: `deckTrace.record` appears in deck-manager.ts (3×), deck-trace.ts observers (4×), card-host.tsx (7×), deck-commit-beacon.tsx (1×).

## Hints for upcoming steps
- Step 3 was fully deferred by the coder agent: all 7 tasks, 1 test (N/A), and 3 checkpoints require launching Tug.app dev build, Safari Web Inspector, and human interaction with real WKWebView. A fresh-spawn agent cannot execute this in an unattended environment. Human must run `window.__deckTrace.enable(true); __deckTrace.clear(); /* repro M01 */; __deckTrace.dumpTable()` three times (once each for M01, M03, M16), paste outputs back into the plan or a notes file, then write the root-cause hypothesis and the patch-[A3]-vs-accelerate-23B decision per [D13]. Phase 1 instrumentation code is healthy: `bun x tsc --noEmit` clean, `bun test src/__tests__/deck-trace.test.ts` 8 pass.
- Step 4 authors `roadmap/tugplan-in-app-bridge.md` — Phase 2 tugplan for Swift bridge. Step 4 depends on the Step 3 decision (which path Phase 3 tests target). If Step 3 decision is still pending when Step 4 is attempted, Step 4 can still enumerate Phase 2 tasks but must leave the "target fix" reference open for Phase 3.
- `[A3]` now records `target` via `resolveActivationTarget(cardId, store)` and `focusedEl` (post-body activeElement). When reading a trace and target===null, the card has no resolvable focus target regardless of gate/bag outcome.
- `_setActiveCardInPane` also calls `_flipFirstResponder` (7th internal caller, not in the plan's six); tagged `_setActiveCardInPane`. Retain this tag in any future refactor.
- `SaveCallbackSource` type is now imported by `deck-manager-store.ts` — creates a new weak dep edge tugdeck store → deck-trace. If deck-trace ever needs to import from deck-manager-store, move `SaveCallbackSource` to a leaf file.
- Test mocks of `IDeckManagerStore.invokeSaveCallback` still use `(id: string) => void` signature and type-check fine; don't "fix" them to add the source param unless a test needs to assert on source.
