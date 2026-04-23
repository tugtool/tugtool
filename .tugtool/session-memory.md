# Session Memory — in-app-test-harness-701669b-2

## Project map
Tugdeck: browser frontend (React 19 + Vite + bun). Source at `tugdeck/src/`; tests at `tugdeck/src/__tests__/`. Phase 1 instrumentation (deck-trace) landed in Steps 1-2; Step 3 deferred (observational); Step 4 authored Phase 2 Swift tugplan; Step 5 landed testMode + seedDeckState. Phase 2 work continues through parent plan Steps 6-11 (TS + Swift). `roadmap/tugplan-in-app-bridge.md` is the Swift-side bridge plan. Tugapp (macOS host): Swift under `tugapp/Sources/` with `ControlSocket.swift` as the template for AF_UNIX listeners. Tugcast: axum WebSocket server at `tugrust/crates/tugcast/src/server.rs`, TCP + bearer auth (NOT local-only). tugplan-skeleton at `tuglaws/tugplan-skeleton.md` is v2.

## Files touched
- tugdeck/src/deck-trace.ts — ring buffer + observers (Phase 1 Step 1).
- tugdeck/src/__tests__/deck-trace.test.ts — 8 pure-logic ring-buffer tests.
- tugdeck/src/deck-manager.ts — Step 2: `_flipFirstResponder(trigger)`, `invokeSaveCallback(id, source)`. Step 5: `testMode: boolean` field + 7th constructor option `{ testMode? }`; three private wrappers `putLayoutGuarded` / `putCardStateGuarded` / `putFocusedCardIdGuarded` each starting `if (this.testMode) return;`; every tugbank write call site now routes through a guard; `seedDeckState(args)` public method for atomic state replace + cardState merge + cold-boot restore via `activateCard`.
- tugdeck/src/deck-manager-store.ts — IDeckManagerStore.invokeSaveCallback signature now `(id, source?)`.
- tugdeck/src/components/chrome/card-host.tsx — mount/unmount trace, `[A3]` a3-fire-on-every-path, focus-call wrappers, selection-restore (Phase 1 Step 2).
- tugdeck/src/components/chrome/deck-commit-beacon.tsx — <DeckCommitBeacon/> commit-tick emitter.
- tugdeck/src/components/chrome/deck-canvas.tsx — mounts DeckCommitBeacon.
- tugdeck/src/main.tsx — Step 5: `declare global` adds `__tugTestMode?: boolean`; `isTestMode = import.meta.env.DEV && window.__tugTestMode === true`; passes `{ testMode: isTestMode }` as DeckManager's 7th arg.
- tugdeck/src/__tests__/deck-manager.test.ts — +7 tests: testMode default-false, addCard no-fetch under testMode, empty-deck under testMode with stale layout; seedDeckState atomic-replace + notify, cardStates merge, focusCardId activate, ignore focusCardId when not in state.
- roadmap/tugplan-in-app-bridge.md — NEW (Step 4). Phase 2 tugplan for Swift bridge + `tests/in-app/` scaffold. 898 lines, skeleton-v2 conformant. Decisions: [D01] file-scope `#if DEBUG`; [D02] parallel Unix socket (tugcast-reuse rejected); [D03] T-1/T-2 stay in parent Phase 2; [D04] boot timing; [D05] hand-written RPC client; [D06] socket security; [D07] structured errors; [D08] CGEventPost deferred.

## Patterns established
- `invokeSaveCallback(id, source)` is the single entry point for save-callback fires; bypassing it skips trace recording.
- `_flipFirstResponder` callers MUST pass a tag (6 internal + `_setActiveCardInPane` as 7th not in original plan).
- Trace helper wrappers (`traceApplyFocusSnapshot`, `emitA3`) guarantee events on every code path including early returns.
- DEV gate idiom: `import.meta.env?.DEV === true` (or `import.meta.env.DEV` in main.tsx).
- Phase 2 transport decision: **parallel Unix socket** (not tugcast). `ControlSocket.swift` is the template.
- Phase 2 Swift files live under `tugapp/Sources/TestHarness/` with `#if DEBUG` at line 1 of every file.
- Phase 2 TS double-guard: `import.meta.env.DEV && window.__tugTestMode === true` at every attach point.
- **testMode guard pattern**: tugbank I/O routes through `this.putLayoutGuarded` / `putCardStateGuarded` / `putFocusedCardIdGuarded` — each wrapper's first line is `if (this.testMode) return;` (or `return Promise.resolve();`). This satisfies the Step-5 checkpoint (`grep 'this.testMode' deck-manager.ts`) while keeping call sites readable.
- **seedDeckState contract**: atomic state replace, merge cardStates, fire construction for NEW card ids, discard registries for DEPARTED card ids, single `notify()`, then `activateCard(focusCardId)` if the card exists in the new state.
- `window.__tugTestMode` is declared in the `Window` augmentation in main.tsx. Callers read it through `window.__tugTestMode === true` so `undefined` is never truthy.

## Build / test notes
- `cd tugdeck && bun x tsc --noEmit` — exits 0 clean.
- `cd tugdeck && bun test` — 2434 pass, 0 fail (was 2427 after Phase 1; +7 from Step 5).
- `tugutil validate <absolute-path>` — validates a tugplan; warnings for uncited decisions exit 0.
- `tugutil validate` requires absolute paths when run via agent bash (working dir resets between calls).
- No linter/formatter for tugdeck; tsc is the gate.
- DeckManager test file uses `globalThis.fetch` noop stub; individual tests that need to spy on fetch override it in-block and restore in `finally`. Pattern works for testMode verification tests.

## Hints for upcoming steps
- Step 6 (parent plan): `window.__tug` surface at `tugdeck/src/test-surface.ts`. Full `TugTestSurface` interface per parent Spec [#s03-tug-surface]. Double guard: `import.meta.env.DEV && window.__tugTestMode === true`. Version constant `"1.0.0"`. The surface should call `deck.seedDeckState(args)` to implement the `seedDeckState` RPC command.
- Step 7 (parent plan): Swift bridge + first `evalJS` round-trip. See `roadmap/tugplan-in-app-bridge.md` Steps 3-7 for the Swift-side breakdown. Transport is parallel Unix socket per [D02].
- `DeckManager` constructor now has 7 positional args; the 7th is `options?: { testMode?: boolean }`. Existing callers (main.tsx and the test file) pass or omit it appropriately.
- In test mode, `DeckManager` constructor discards stale `initialLayout` / `initialCardStates` / `initialFocusedCardId` args (tested). This means Step 6's surface can still pass layout-sourced boot args without worrying about double-seeding.
- `roadmap/tugplan-in-app-bridge.md` decisions NOT yet cited in any step are [D03] and [D08] (both resolved to "deferred" / "placement" — cited in this plan's own Step 1 and Step 8 respectively).
- `SaveCallbackSource` type is imported by `deck-manager-store.ts` (weak dep edge). If deck-trace ever imports from deck-manager-store, move the type to a leaf file.
- The `seedDeckState` method is public on DeckManager but NOT on IDeckManagerStore interface — by design, since it's a test-only entry point. Step 6's test surface calls it through the concrete `DeckManager` ref held in main.tsx, not via the interface.
