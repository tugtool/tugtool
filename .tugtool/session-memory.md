# Session Memory — in-app-test-harness-7d9c56e-1

## Project map
Tugdeck is the browser frontend (React 19 + Vite + bun). Source lives under `tugdeck/src/`; tests colocate under `tugdeck/src/__tests__/`. Bun is the package manager + test runner. Deck orchestration is in `deck-manager.ts` / `deck-manager-store.ts`; focus activation in `focus-transfer.ts` (seam only; side-effecting entries throw until later tugplan-selection steps wire them). Card mount/unmount in `components/chrome/card-host.tsx`. The tugplan for this phase is at `tugdeck/../.tugtool/tugplan-in-app-test-harness.md` (referenced via plan state).

## Files touched
- tugdeck/src/deck-trace.ts — ring-buffer module exporting `deckTrace` (`record`/`dump`/`dumpTable`/`enable`/`mark`/`since`/`clear`), `DeckTraceEvent` union per Spec S01, `formatElement()` serializer, `DECK_TRACE_CAPACITY=512`; `window.__deckTrace` binding gated by `import.meta.env?.DEV === true`.
- tugdeck/src/__tests__/deck-trace.test.ts — 8 pure-logic tests covering ring eviction, monotonic seq across wrap, `since(seq)` semantics, `enable(false)` no-op gate, `mark()` preservation across `clear()`.

## Patterns established
- DEV gate idiom: `import.meta.env?.DEV === true` (optional chain — bun tests have `import.meta.env` absent, so gate collapses to false under bun). Pattern matches existing `LIFECYCLE_LOG` gate in `lib/lifecycle-cascade.ts`.
- `window.__*` global bindings: use `declare global { interface Window { __foo?: T } }` then assign via `window.__foo = ...` inside DEV guard. Matches existing `window.tugdeck` pattern in `main.tsx`.
- Singleton module-level state (ring buffer + enable flag + seq counter) exported as `deckTrace` object; tests clear in `beforeEach` since state persists across tests.
- `enable(false)` is the runtime gate for `record()`; `mark`/`dump`/`since`/`clear` remain callable regardless of enable state.
- Tuglaw [D10] reminder: happy-dom/bun tests must NOT pretend to verify focus/DOM-observer behavior. Pure-logic coverage only for instrumentation modules; DOM behavior is verified in-app in later phases.

## Build / test notes
- `cd tugdeck && bun install` needed on fresh worktree (259 packages).
- `cd tugdeck && bun x tsc --noEmit` is the check/build command; exits 0 clean.
- `cd tugdeck && bun test src/__tests__/deck-trace.test.ts` runs single file in ~60ms.
- `cd tugdeck && bun test` — full suite 2427 tests / ~11s (was 2419 before this step, so +8 new).
- No linter/formatter configured in tugdeck; `tsc --noEmit` is the only gate.
- Test preload is `src/__tests__/setup-silence.ts` (silences console) + happy-dom.

## Hints for upcoming steps
- Step 2 wires call sites — `deck-manager.ts` (add `trigger`/`source` params), `card-host.tsx` (mount/unmount/A3/focus-call), new `deck-commit-beacon.tsx`, observer wiring inside `deck-trace.ts` itself. Use `import { deckTrace } from "./deck-trace"` (or `"../deck-trace"` from components/chrome).
- `DeckTraceEventInput` is the parameter type for `deckTrace.record(...)` — module stamps timestamp+seq automatically; callers omit those fields.
- `formatElement(el)` is exported and side-effect-free; use it for every `el: string` field in trace events (focus-call site pre/post, focusin/focusout).
- `ActivationTarget` type for `a3-fire.target` is imported from `./focus-transfer`.
- Per Step 2 task list, `_flipFirstResponder` gains `trigger: string` param and every internal caller passes a descriptive string (`activateCard`, `_removeCard`, `_closePane`, `_moveCardToPane`, `_detachCard`, `_addCardToPane`). `invokeSaveCallback` gains `source` of type `SaveCallbackSource`.
- `<DeckCommitBeacon/>` is a new component at `components/chrome/deck-commit-beacon.tsx` — no-deps `useLayoutEffect` increments counter and emits `commit-tick`. Must be mounted at deck root (DeckCanvas or equivalent).
- Step 2 test constraint: NO new happy-dom tests for observer behavior; existing 2427 must continue to pass.
