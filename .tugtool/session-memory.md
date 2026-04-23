# Session Memory — in-app-test-harness-701669b-2

## Project map
Tugdeck: browser frontend (React 19 + Vite + bun). Source at `tugdeck/src/`; tests at `tugdeck/src/__tests__/`. Phase 1 instrumentation (deck-trace) landed in Steps 1-2; Step 3 deferred (observational); Step 4 authored Phase 2 Swift tugplan; Step 5 landed testMode + seedDeckState; Step 6 landed `window.__tug` test surface. Phase 2 work continues through parent plan Steps 7-11 (Swift bridge + harness library). `roadmap/tugplan-in-app-bridge.md` is the Swift-side bridge plan. Tugapp (macOS host): Swift under `tugapp/Sources/` with `ControlSocket.swift` as the template for AF_UNIX listeners. Tugcast: axum WebSocket server at `tugrust/crates/tugcast/src/server.rs`, TCP + bearer auth (NOT local-only). tugplan-skeleton at `tuglaws/tugplan-skeleton.md` is v2.

## Files touched
- tugdeck/src/deck-trace.ts — ring buffer + observers (Phase 1 Step 1).
- tugdeck/src/__tests__/deck-trace.test.ts — 8 pure-logic ring-buffer tests.
- tugdeck/src/deck-manager.ts — Step 2: `_flipFirstResponder(trigger)`, `invokeSaveCallback(id, source)`. Step 5: `testMode: boolean` field + 7th constructor option `{ testMode? }`; three private wrappers `putLayoutGuarded` / `putCardStateGuarded` / `putFocusedCardIdGuarded`; every tugbank write call site now routes through a guard; `seedDeckState(args)` public method.
- tugdeck/src/deck-manager-store.ts — IDeckManagerStore.invokeSaveCallback signature now `(id, source?)`.
- tugdeck/src/components/chrome/card-host.tsx — mount/unmount trace, `[A3]` a3-fire-on-every-path, focus-call wrappers, selection-restore (Phase 1 Step 2).
- tugdeck/src/components/chrome/deck-commit-beacon.tsx — <DeckCommitBeacon/> commit-tick emitter.
- tugdeck/src/components/chrome/deck-canvas.tsx — mounts DeckCommitBeacon.
- tugdeck/src/main.tsx — Step 5: `declare global` adds `__tugTestMode?: boolean`; passes `{ testMode: isTestMode }` to DeckManager. Step 6: imports `attachTugTestSurface`; calls it right after `initActionDispatch(connection, deck)`.
- tugdeck/src/test-surface.ts — NEW (Step 6). Full `TugTestSurface` interface per Spec [#s03-tug-surface]; `createTugTestSurface(deck)` factory; `attachTugTestSurface(deck)` with double-guard `import.meta.env?.DEV === true && window.__tugTestMode === true`. `SURFACE_VERSION = "1.0.0"`. Event synthesis per Spec [#s04-event-synthesis]: `click` dispatches pointerdown→mousedown→pointerup→mouseup→click; `type` uses native-setter + InputEvent; `focusElement` is direct `el.focus()`. `reset(opts)` axes: storage/deck/selectionGuard/orchestrator/trace, each idempotent. `getCaretState` variants: `input` (activeElement is keyed form-control) and `range` (selectionGuard.getCardRange + nodeToPath). `getFormControlValue` queries cardHostRoot for `[data-tug-persist-value]` with `CSS.escape(persistKey)`.
- tugdeck/src/__tests__/deck-manager.test.ts — +7 tests: testMode default-false, addCard no-fetch under testMode, empty-deck under testMode, seedDeckState atomic-replace + notify, cardStates merge, focusCardId activate, ignore focusCardId when not in state.
- roadmap/tugplan-in-app-bridge.md — Phase 2 Swift bridge plan (Step 4). 898 lines, skeleton-v2 conformant.

## Patterns established
- `invokeSaveCallback(id, source)` is the single entry point for save-callback fires.
- `_flipFirstResponder` callers MUST pass a tag (`trigger` string).
- Trace helper wrappers (`traceApplyFocusSnapshot`, `emitA3`) guarantee events on every code path including early returns.
- DEV gate idiom: `import.meta.env?.DEV === true` (or `import.meta.env.DEV` in main.tsx).
- Phase 2 transport decision: **parallel Unix socket** (not tugcast). `ControlSocket.swift` is the template.
- Phase 2 Swift files live under `tugapp/Sources/TestHarness/` with `#if DEBUG` at line 1.
- Phase 2 TS double-guard: `import.meta.env.DEV && window.__tugTestMode === true` at every attach point.
- **testMode guard pattern**: tugbank I/O routes through `this.putLayoutGuarded` / `putCardStateGuarded` / `putFocusedCardIdGuarded`.
- **seedDeckState contract**: atomic state replace, merge cardStates, fire construction for NEW card ids, discard registries for DEPARTED card ids, single `notify()`, then `activateCard(focusCardId)` if the card exists.
- `window.__tugTestMode` is declared in the `Window` augmentation in main.tsx. Callers read `window.__tugTestMode === true` so `undefined` is never truthy.
- **Test surface attach**: declare `window.__tug?` via `declare global` in `test-surface.ts`; assignment happens inside `attachTugTestSurface(deck)` which double-gates on DEV + testMode. `main.tsx` calls `attachTugTestSurface(deck)` exactly once after `initActionDispatch`.
- **Test surface dependencies**: bound to a `DeckManager` closure (not `IDeckManagerStore`, because `seedDeckState` is concrete-only). Reads `deckTrace` + `selectionGuard` singletons directly.
- **Event-synthesis shape**: `PointerEventInit` + `MouseEventInit` share a base (`bubbles: true, cancelable: true, composed: true, button: 0`, modifiers). `buttons: 1` for pressed phase, `buttons: 0` for released phase.
- **Native-setter pattern**: `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype | HTMLTextAreaElement.prototype, "value").set` then `.call(el, newValue)`; follow with `InputEvent("input", { inputType: "insertText", data: ch })` per character.

## Build / test notes
- `cd tugdeck && bun x tsc --noEmit` — exits 0 clean.
- `cd tugdeck && bun test` — 2434 pass, 0 fail (Step 6 added no new tests per plan instructions).
- `tugutil validate <absolute-path>` — validates a tugplan; warnings for uncited decisions exit 0.
- `tugutil validate` requires absolute paths when run via agent bash (working dir resets between calls).
- No linter/formatter for tugdeck; tsc is the gate.
- DeckManager test file uses `globalThis.fetch` noop stub.
- **Step 6 tests deferred by plan text**: "No new happy-dom UI tests. Surface is exercised end-to-end by Phase 3 in-app tests." Only tsc + grep + manual smoke are required as checkpoints.

## Hints for upcoming steps
- Step 7 (parent plan): Transport + first `evalJS` round-trip. Swift bridge. See `roadmap/tugplan-in-app-bridge.md` Steps 3-7 for the Swift-side breakdown. Parallel Unix socket per [D02].
- Step 8: `waitForCondition` primitive + structured errors + timeouts. Pure Swift; surface already exposes synchronous reads for it to poll.
- Step 9: Version handshake + lifecycle + log capture. Swift reads `window.__tug.version` via `evalJS` and asserts `"1.0.0"` major match.
- Step 10: Bun harness library wrappers at `tests/in-app/_harness/`. Typed wrappers over `evalJS`/`waitForCondition`; `toContainOrderedSubset` matcher. The TS wrappers should import the `TugTestSurface` interface/types from `tugdeck/src/test-surface.ts` — exports include: `TugTestSurface`, `CaretState`, `ClickOptions`, `ResetOptions`, `SeedDeckStateArgs`, `SURFACE_VERSION`.
- `DeckManager` constructor has 7 positional args; the 7th is `options?: { testMode?: boolean }`.
- In test mode, `DeckManager` constructor discards stale `initialLayout` / `initialCardStates` / `initialFocusedCardId`.
- `seedDeckState` method is public on DeckManager but NOT on IDeckManagerStore interface — test-only entry point.
- `test-surface.ts` uses `CSS.escape` for persistKey lookups. `cardStatesRecordToMap` converts the JSON-transported `Record<string, CardStateBag>` shape back to the `Map` that `DeckManager.seedDeckState` consumes.
- `makeEmptyDeckState()` returns `{ cards: [], panes: [], hasFocus: document.hasFocus() }` — no panes (invariant 3 forbids empty panes).
- `getActiveCardId()` in the test surface maps to `deck.getFirstResponderCardId()` — the composite FR bit — because that is what the user perceives as "active". `getFocusedCardId()` maps to `deck.getFocusedCardId()` (top of z-order).
- `reset` axes are applied in this order: `storage`, `deck`, `selectionGuard`, `orchestrator`, `trace`. `orchestrator` axis piggybacks on an empty `seedDeckState` to drop registries.
- No new tests written for Step 6 (per plan's "No new happy-dom UI tests" instruction). Phase 3 tests (Steps 13-15) will exercise the surface end-to-end through the Swift bridge.
- Deferred [D03] and [D08] decisions from `roadmap/tugplan-in-app-bridge.md` remain parked.
