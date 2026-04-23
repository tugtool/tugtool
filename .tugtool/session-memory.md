# Session Memory — in-app-test-harness-701669b-2

## Project map
Tugdeck: browser frontend (React 19 + Vite + bun). Source at `tugdeck/src/`; tests at `tugdeck/src/__tests__/`. Phase 1 instrumentation (deck-trace) landed in Steps 1-2; Step 3 deferred (observational). Phase 2 work is spread across parent plan Steps 5-11 (TS + Swift) plus `roadmap/tugplan-in-app-bridge.md` (Swift-side bridge). Tugapp (macOS host): Swift under `tugapp/Sources/` with `ControlSocket.swift` as the template for AF_UNIX listeners. Tugcast: axum WebSocket server at `tugrust/crates/tugcast/src/server.rs`, TCP + bearer auth (NOT local-only). tugplan-skeleton at `tuglaws/tugplan-skeleton.md` is v2.

## Files touched
- tugdeck/src/deck-trace.ts — ring buffer + observers (Phase 1 Step 1).
- tugdeck/src/__tests__/deck-trace.test.ts — 8 pure-logic ring-buffer tests.
- tugdeck/src/deck-manager.ts — `_flipFirstResponder(trigger)`, `invokeSaveCallback(id, source)` (Phase 1 Step 2).
- tugdeck/src/deck-manager-store.ts — IDeckManagerStore.invokeSaveCallback signature now `(id, source?)`.
- tugdeck/src/components/chrome/card-host.tsx — mount/unmount trace, `[A3]` a3-fire-on-every-path, focus-call wrappers, selection-restore (Phase 1 Step 2).
- tugdeck/src/components/chrome/deck-commit-beacon.tsx — <DeckCommitBeacon/> commit-tick emitter.
- tugdeck/src/components/chrome/deck-canvas.tsx — mounts DeckCommitBeacon.
- roadmap/tugplan-in-app-bridge.md — NEW (Step 4). Phase 2 tugplan for Swift bridge + `tests/in-app/` scaffold. 898 lines, skeleton-v2 conformant. Decisions: [D01] file-scope `#if DEBUG`; [D02] parallel Unix socket (tugcast-reuse rejected); [D03] T-1/T-2 stay in parent Phase 2; [D04] boot timing; [D05] hand-written RPC client; [D06] socket security; [D07] structured errors; [D08] CGEventPost deferred.

## Patterns established
- `invokeSaveCallback(id, source)` is the single entry point for save-callback fires; bypassing it skips trace recording.
- `_flipFirstResponder` callers MUST pass a tag (6 internal + `_setActiveCardInPane` as 7th not in original plan).
- Trace helper wrappers (`traceApplyFocusSnapshot`, `emitA3`) guarantee events on every code path including early returns.
- DEV gate idiom: `import.meta.env?.DEV === true`.
- Phase 2 transport decision: **parallel Unix socket** (not tugcast). Tugcast is TCP + bearer; its `ws_handler` runs in all builds so a DEBUG-only verb leaves dispatch in release binaries. `ControlSocket.swift` is the template (socket(AF_UNIX), sockaddr_un, DispatchSourceRead).
- Phase 2 Swift files live under `tugapp/Sources/TestHarness/` with `#if DEBUG` at line 1 of every file (partial-file gating forbidden).
- Phase 2 TS double-guard: `import.meta.env.DEV && window.__tugTestMode === true` at every attach point.
- tugplan cross-references to the parent plan use the parent's anchor IDs fully qualified in prose.

## Build / test notes
- `cd tugdeck && bun x tsc --noEmit` — exits 0 clean.
- `cd tugdeck && bun test` — 2427 pass, 0 fail (baseline after Phase 1).
- `tugutil validate <absolute-path>` — validates a tugplan; warnings for uncited decisions exit 0, but cleaner to cite them in at least one step's References.
- `tugutil validate` requires absolute paths when run via agent bash (working dir resets between calls).
- No linter/formatter for tugdeck; tsc is the gate.

## Hints for upcoming steps
- Step 5 (parent plan): `DeckManager.testMode?: boolean` constructor flag. `this.testMode` guard at every tugbank I/O site. `seedDeckState(args)` method: atomic state replace, cold-boot restore if `focusCardId` set. Mock stores in `mock-deck-manager-store.ts` likely need new optional field (no behavior change).
- Step 6 (parent plan): `window.__tug` surface at `tugdeck/src/test-surface.ts`. Full `TugTestSurface` interface per parent Spec [#s03-tug-surface]. Double guard. Version constant `"1.0.0"`.
- Step 7 (parent plan): Swift bridge + first `evalJS` round-trip. See `roadmap/tugplan-in-app-bridge.md` Steps 3-7 for the Swift-side breakdown. Transport is parallel Unix socket per [D02].
- `roadmap/tugplan-in-app-bridge.md` decisions NOT yet cited in any step are [D03] and [D08] (both resolved to "deferred" / "placement" — cited in this plan's own Step 1 and Step 8 respectively to satisfy validate).
- Step 3 of the parent plan (M01/M03/M16 trace repro) was deferred by user; the decision about patched-[A3]-vs-accelerated-23B carries into Phase 3 tests — not blocking Phase 2 work.
- `SaveCallbackSource` type is imported by `deck-manager-store.ts` (weak dep edge). If deck-trace ever imports from deck-manager-store, move the type to a leaf file.
