# In-App Test Harness — Strategy

**Status:** Draft proposal (2026-04-23).
**Motivation:** The tugdeck happy-dom test suite (2419 passing at writing) has been giving false green signals for focus, selection, caret, and activation-dispatch behavior. M01 works intermittently, M03 and M16 never work in the running app — while the tests that claim to cover them are green. This document lays out the path to a test harness that cannot lie because it runs inside the real Tug.app WKWebView.

**Scope:** Three phases, buildable in order. Phase 1 is low-risk tugdeck-only. Phase 2 touches Tug.app (Swift) and will spawn its own tugplan before any Swift code lands. Phase 3 delivers the first real regression tests that bind the M-series fixes in place for the long haul.

---

## 1. Problem statement

### 1.1 Why happy-dom cannot be the test surface

The tugdeck test suite runs under `bun test` with `happy-dom` injected as the global DOM. happy-dom is fast and cheap; it is also wrong about every behavior this project needs to verify:

- **Focus.** `el.focus()` on a `display: none` element updates `document.activeElement` in happy-dom. In every real browser it is a silent no-op. Tests assert `document.activeElement === expected`, pass, and ship a broken feature.
- **Portal reconciliation.** `createPortal` in happy-dom commits in ways that do not match React + real DOM — especially cross-subtree moves, which is exactly what `CardPortal` does on pane activation and card detach.
- **Event ordering.** Synthesized `pointerdown` events do not reproduce the real pointerdown → pointerup → click → focus sequence with the micro-task gaps and focus-event dispatch order a browser enforces.
- **Paint, caret, selection highlight.** happy-dom does no rendering. `::selection` styling, caret blink, inactive-selection highlight — none exist in the harness.
- **Mock store timing.** Our "integration" tests use hand-rolled `Store` classes that approximate `DeckManager` lifecycle and `_flipFirstResponder` sandwich ordering. Close is not the same as correct.

The consequence is that happy-dom tests cover *code paths*, not *outcomes*. We can verify that an effect fired and a callback dispatched; we cannot verify that the caret landed in the right element, visibly, with the right selection.

**Policy:** No new happy-dom tests for UI / focus / selection / DOM-timing behavior. Existing happy-dom tests stay for pure-logic coverage (serializers, reducers, pure selectors) where the lies do not bite.

### 1.2 Why Playwright is not the answer either

Playwright's `webkit` driver uses a Playwright-maintained WebKit build — not the WKWebView inside Tug.app. Different version, different configuration, no `WKScriptMessageHandler`, no app-specific `userContentController`, different private-API behaviors. Closer to Tug.app than Chromium, still the wrong engine in the wrong process. Switching our harness to Playwright would trade one set of lies for a smaller set of lies. That is not enough.

Tug.app runs in a real WKWebView hosted by a real macOS app. The only honest harness drives that exact configuration.

### 1.3 What we need

A test harness that:

1. Launches **Tug.app itself** (the same binary users run, with a test-mode flag).
2. Accepts commands from an external test runner.
3. Executes those commands **inside the real WKWebView** — real focus, real events, real paint, real caret, real Apple-specific bugs.
4. Returns assertable state back to the test runner.

---

## 2. Phases

### Phase 1 — In-tree deck-trace instrumentation

**Scope.** Pure tugdeck change, no Tug.app or Swift work. Lands in a single commit.

**Module name: `deck-trace.ts`, not `focus-trace.ts`.** The bugs we are diagnosing are not bugs in focus-calling code; they are bugs in why the focus-calling code never runs. To see that we need upstream events — responder-chain flips, destination transitions, CardHost mount/unmount, React commit beacons, document-level focus observers — in the same ordered stream. A narrow focus-only trace tells us nothing happened and leaves us no closer to why.

**Deliverables.**

- **`tugdeck/src/deck-trace.ts`** — a ring-buffer module exporting:
  - `deckTrace.record(event: DeckTraceEvent): void` — append to a bounded ring (cap 512 entries; oldest evicted). Every event gets `{ timestamp: performance.now(), seq: number }` stamped automatically.
  - `deckTrace.dump(): readonly DeckTraceEvent[]` — copy of the ring for inspection.
  - `deckTrace.clear(): void` — zero the ring (preserves the enable flag).
  - `deckTrace.enable(flag: boolean): void` — gate on/off; default off so production performance is untouched. When off, `record` is a single bounds-check and return.
  - `deckTrace.dumpTable(): void` — formatted `console.table` output, readable in dev tools.
  - `deckTrace.since(seq: number): readonly DeckTraceEvent[]` — slice from a sequence marker; used by tests (Phase 3) for assertions scoped to a window of interest.
  - `deckTrace.mark(): number` — returns the current `seq` for later `since()` lookups.

- **`DeckTraceEvent` union.** One tagged union covering every event worth correlating:

  ```ts
  export type DeckTraceEvent = { timestamp: number; seq: number } & (
    | { kind: "fr-flip";           from: string | null; to: string | null; trigger: string }
    | { kind: "destination-flip";  cardId: string; from: boolean; to: boolean }
    | { kind: "card-host-mount";   cardId: string; hostStackId: string }
    | { kind: "card-host-unmount"; cardId: string; hostStackId: string }
    | { kind: "a3-fire";           cardId: string; isFirstRun: boolean; prev: boolean; now: boolean;
                                   earlyReturn: null | "first-run" | "not-destination" | "prev-was-true" | "no-host" | "no-bag" | "gate-refused";
                                   gatePassed: boolean | null; target: ActivationTarget | null; focusedEl: string | null }
    | { kind: "focus-call";        site: string; cardId: string; targetSelector: string;
                                   activeBefore: string; activeAfter: string; hidden: boolean }
    | { kind: "focusin";           el: string; relatedTarget: string | null }
    | { kind: "focusout";          el: string; relatedTarget: string | null }
    | { kind: "save-callback";     cardId: string; source: "close-handoff" | "debounced" | "visibilitychange" | "beforeunload" | "manual" }
    | { kind: "selection-restore"; cardId: string; via: "restoreCardDomSelection" | "applyFocusSnapshot" }
    | { kind: "commit-tick";       count: number }
  );
  ```

  `formatElement(el)` serializes an element as `tag#id.class[data-card-id=foo]`; all `el: string` fields use it. `ActivationTarget` is imported from `focus-transfer.ts` so the trace shows the resolver's output shape directly.

- **Recording sites.** Every one of these is a single `deckTrace.record(...)` call gated by `enable(true)`:

  - `deck-manager.ts#_flipFirstResponder` — record `fr-flip` right after the composite bit changes, with a `trigger` string the caller passes (`"activateCard"`, `"_removeCard"`, `"_closePane"`, `"_moveCardToPane"`, `"_detachCard"`, `"_addCardToPane"`). The caller argument is load-bearing: it is how the trace says WHO drove the flip.

  - **Destination-flip observer** (new, inside `deck-trace.ts`). A module-level subscription to the store: on every notify, compute `isFocusDestination(cardId)` for each card and diff against last state; for each card whose value flipped, emit `destination-flip`. Cost: O(cards) per notify when enabled, zero when disabled.

  - `card-host.tsx` — `card-host-mount` / `card-host-unmount` in the existing root-registration `useLayoutEffect`.

  - `card-host.tsx#[A3]` — **record `a3-fire` even when the effect EARLY-RETURNS.** The `earlyReturn` field is the single most important field in the whole trace. Today a skipped body is invisible; with this, we see "c3's [A3] fired with `isFirstRun: true` → early-return 'first-run' " and we immediately know the mount-guard is the bug.

  - `card-host.tsx` cold-boot restore — `focus-call` with `site: "cold-boot"`.

  - `card-host.tsx` Step-11 cross-pane effect — `focus-call` with `site: "cross-pane-move"`.

  - Every `.focus()` call in the codebase (grep for `.focus(`) — wrapped to emit `focus-call` with `site` naming the call site (`"a3-dom-authority"`, `"a3-component-owned"`, `"cold-boot"`, `"cross-pane-move"`). The `hidden` field is computed as `getComputedStyle(el).display === "none" || el.offsetParent === null` so we SEE when focus went at a hidden element.

  - **Document-level focus observer** (new, installed by `deck-trace.ts` when `enable(true)`): `document.addEventListener("focusin" | "focusout", ..., { capture: true })`. Records every focus transition, including ones caused by OTHER code (browser defaults, third-party listeners, the user). If our `focus-call` was immediately followed by a `focusout`+`focusin` pair pointing somewhere else, WebKit or a competing listener reverted our focus and we see it.

  - `deck-manager.ts#invokeSaveCallback` — `save-callback` event with `source` passed by the caller. `_closePane` and `_removeCard` pass `"close-handoff"`; the debounced timer passes `"debounced"`; `visibilitychange` passes `"visibilitychange"`; `beforeunload` passes `"beforeunload"`.

  - `card-host.tsx` selection-restore call sites — `selection-restore` with `via` tagging which entry was used.

  - **React commit beacon**: a tiny `<DeckCommitBeacon/>` component mounted once at the deck root with a no-deps `useLayoutEffect` that increments a counter and records `commit-tick`. Gives a rough timeline of React's commit phase to correlate against.

- **Runtime toggle.** `window.__deckTrace.enable(true)` turns recording on. Helpers on the same window global: `.dump()`, `.dumpTable()`, `.clear()`, `.mark()`, `.since(seq)`. Off by default; survives across reloads only if manually re-enabled.

- **No tests added.** Observational code; no pretending happy-dom can verify it.

**What a trace looks like when we diagnose M03.**

```
seq  kind                 trigger / cardId / detail
---  -------------------  -----------------------------------------------------
 42  fr-flip              trigger=activateCard  from=c1  to=c3
 43  destination-flip     cardId=c1  from=true  to=false
 44  destination-flip     cardId=c3  from=false to=true
 45  commit-tick          count=17
 46  a3-fire              cardId=c1  isFirstRun=false prev=true  now=false  earlyReturn=not-destination
 47  a3-fire              cardId=c3  isFirstRun=true  prev=false now=true   earlyReturn=first-run    ← THE BUG
 48  (no focus-call; user clicks away)
```

One glance and we know `[A3]`'s mount-guard is refusing to fire on c3 because c3's first-ever effect run coincides with its first-ever destination=true, so the `isFirstRun` early-return swallows the activation. No amount of manual repro would have told us that as crisply.

**Exit criteria.**
- `enable(true)` in the live app; M01, M03, M16 each reproduced once; traces dumped and pasted. Root-cause hypothesis stated.
- **If the trace reveals `[A3]` is structurally racy** — e.g. the `isFirstRun` / `prev`-guards can never correctly classify a first-time-destination activation — we **accelerate Step 23B's helper wiring** instead of trying to patch `[A3]`. This is not a deviation from plan; it is the plan acknowledging that retiring a broken effect is cheaper than fixing it. The roadmap's Phase 1 success is "we know which path to take," not "we fixed [A3]."
- `deck-trace.ts` stays in the codebase permanently; it is dev-tooling and a Phase 2 dependency.

### Phase 2 — In-app test bridge

**Scope.** Touches tugapp/ (Swift) and tugdeck/ (TypeScript). Requires a tugplan because the Swift changes have real blast radius — a test-mode socket in Tug.app is a security surface. **This document commits to writing a tugplan before any Swift code is committed.**

**Architecture sketch** (details land in the tugplan).

#### 2.1 Boot choreography

The one ordering guarantee everything else depends on: `testMode` is decided at Swift startup via environment variable, never via the bridge. Bridge connection timing is irrelevant because the mode is already set before tugdeck boots.

1. Swift `main()` reads `TUGAPP_TEST_SOCKET` env var. If set, `TEST_MODE = true` and the socket path is remembered.
2. Swift starts the Unix socket listener asynchronously (does not block boot).
3. Swift constructs the WebView with a `WKUserScript` at `WKUserScriptInjectionTime.atDocumentStart` that injects `window.__tugTestMode = true`. This fires before any tugdeck JS runs.
4. tugdeck `main.tsx` reads `window.__tugTestMode` and passes `testMode: true` to `new DeckManager(...)`.
5. `DeckManager` constructor sees `testMode: true`: skips the tugbank read in the boot sequence; installs a no-op wrapper around every tugbank write for the session; starts with the empty `DeckState` so seeding is deterministic.
6. tugdeck initializes `window.__tug` (gated on `window.__tugTestMode` and `import.meta.env.DEV`; without both, no surface is attached).
7. Harness connects to the Unix socket with bounded retry on `ECONNREFUSED` (default 10s, 100ms interval).
8. First exchange is a `version` handshake. Mismatch → harness throws immediately so the test author sees the version skew, not a cryptic downstream failure.
9. Tests run.

**Dev-mode boot (no harness) behavior.** When `TUGAPP_TEST_SOCKET` is unset, none of steps 2-8 run. tugdeck boots exactly as today. When DEBUG build + env var set but no harness ever connects: app boots in testMode (empty state), sits there; no harm done.

#### 2.2 Transport and guards

- **DEBUG-build-only guard. Non-negotiable.** Every bridge-touching Swift source file sits inside `#if DEBUG`; release builds literally do not contain the socket-opening code. In parallel, the TypeScript `window.__tug` surface is gated by BOTH `import.meta.env.DEV` AND `window.__tugTestMode === true` so release bundles tree-shake it out and dev bundles do not expose it unless test mode was requested. Independent guards on each side so a failure of either does not reach production.

- **Local Unix socket only.** No TCP, no network exposure. Socket file mode 0600; parent directory existence + ownership checked at bind time; stale socket files unlinked if owned by the same user before bind. No fallback to TCP under any condition.

- **Web Inspector enablement.** Test mode unconditionally sets `configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")` so Safari's Develop menu can attach. When a test fails, attach the Inspector and read the live state directly. Huge debugging win; zero production cost (DEBUG-gated).

- **Transport choice deferred to the tugplan.** First investigation task: can we route the JSON-RPC over tugcast's existing WebSocket multiplexer instead of a parallel Unix socket? Same process, same lifecycle, fewer moving pieces — IF the DEBUG guard stays clean and the channel gating is verifiable. If mixing the test channel with the production runtime transport cannot preserve the guard, we stand up the parallel socket. Decided in the tugplan, not here.

#### 2.3 RPC protocol

Two primitives, both typed, both with hard timeouts and structured errors.

**Request / response shapes** (newline-delimited JSON):

```ts
type Request =
  | { id: number; method: "evalJS";             script: string;                     timeoutMs?: number }
  | { id: number; method: "waitForCondition";   script: string; timeoutMs?: number; pollMs?: number };

type Response<T> =
  | { id: number; ok: true;  value: T }
  | { id: number; ok: false; error: { name: string; message: string; stack?: string } };
```

- **`evalJS`.** The script is wrapped server-side in a `try/catch`; a throw is serialized as `{ name, message, stack }` and returned in the `ok: false` shape. Non-serializable return values throw inside `JSON.stringify` and land in the same error path. Default timeout 5000ms; on timeout the RPC returns `{ name: "TimeoutError", ... }` and the harness MAY escalate to killing the subprocess for truly runaway scripts.
- **`waitForCondition`.** Polls the supplied script on an interval until it returns truthy or times out. Default poll 16ms; default timeout 2000ms; both overridable per call. Returns the truthy value. **This is the only waiting primitive exposed to tests** — no raw sleeps anywhere in harness or test code.

Every higher-level operation (click, type, seed state, read focus, reset, read trace) composes from these two.

#### 2.4 `DeckManager` test-mode flag

Constructor option `testMode?: boolean` (default false). When true:
- Boot sequence skips tugbank reads (`GET /dev.tugtool.deck.*`).
- Every tugbank write (`putLayout`, `putCardState`, `putFocusedCardId`) is wrapped in an `if (this.testMode) return;` guard.
- `seedDeckState` replaces the in-memory `DeckState` atomically and runs the cold-boot restore path so focus lands exactly as it would after a real reload.

No globals, no statics. The flag is carried through the constructor and read via `this.testMode` wherever needed.

#### 2.5 `window.__tug` surface

Gated by `window.__tugTestMode === true` AND `import.meta.env.DEV`. Version-handshaked on connect.

```ts
interface TugTestSurface {
  readonly version: "1.0.0";    // bumped on breaking changes; handshake enforces

  // State seeding (see §2.4).
  seedDeckState(args: {
    state: DeckState;
    cardStates?: Record<string, CardStateBag>;
    focusCardId?: string;       // if set, triggers the cold-boot restore path against this card
  }): void;

  // Granular reset (see §2.6).
  reset(opts: {
    deck?: boolean;             // clear DeckState back to empty
    selectionGuard?: boolean;   // clear registered boundaries + selection pins
    orchestrator?: boolean;     // drop component-persistence registries
    trace?: boolean;            // deckTrace.clear() (keeps enable flag)
    storage?: boolean;          // nuke localStorage + scoped IndexedDB
  }): void;

  // Direct DOM events. Tests use these INSTEAD of el.click() so the full
  // pointerdown → pointerup → click sequence fires, triggering every
  // handler our production code installs. See §2.7 for fidelity notes.
  click(selector: string, opts?: { clientX?: number; clientY?: number; metaKey?: boolean; shiftKey?: boolean }): void;
  type(selector: string, text: string): void;       // native-setter pattern; fires real input events
  focusElement(selector: string): void;             // direct .focus(); for paths where synthesized pointerdown is insufficient

  // State reads (all JSON-serializable).
  getActiveCardId(): string | null;
  getFocusedCardId(): string | null;
  getCaretState(cardId: string): {
    kind: "input";         // <input>/<textarea>
    selectionStart: number; selectionEnd: number; selectionDirection: "forward" | "backward" | "none";
    value: string;
  } | {
    kind: "range";         // contenteditable / document selection
    anchorPath: readonly number[]; anchorOffset: number;
    focusPath: readonly number[];  focusOffset: number;
    text: string;
  } | null;
  getFormControlValue(cardId: string, persistKey: string): string | null;
  assertHostRootRegistered(cardId: string): boolean;

  // Trace access (Phase 1 ring).
  getDeckTrace(opts?: { since?: number }): readonly DeckTraceEvent[];
  markDeckTrace(): number;       // seq for later since()
  clearDeckTrace(): void;
  enableDeckTrace(flag: boolean): void;
}
```

Additions to the surface require a `version` bump and a tugplan follow-up; the tests that depend on the surface call `assert(__tug.version === "1.0.0")` on connect to fail loudly on skew.

#### 2.6 Per-test isolation via granular reset

Two API points:

- `app.seedDeckState(args)` — seeds state atomically. Runs the cold-boot restore path so focus lands in `focusCardId`'s declared `bag.focus` target. Starting state for most tests.
- `app.reset(opts)` — every key boolean, every default false. Tests write exactly what they want cleared:

  ```ts
  // Test 1 starts fresh, with storage wiped too (first test in file):
  await app.reset({ deck: true, selectionGuard: true, orchestrator: true, trace: true, storage: true });

  // Test 2 inherits orchestrator state but wants a clean trace and deck:
  await app.reset({ deck: true, trace: true });
  ```

  The harness has no default reset behavior. Tests state intent in the body. Ambiguity about test state is the #1 source of in-app-test flakiness; forcing explicitness eliminates a class of surprise.

#### 2.7 Event synthesis: fidelity and limits

The harness's `click` / `type` dispatch synthesized events, not hardware events. This is good enough for testing our handlers (which fire on `pointerdown` / `click` / `input` as JS logic, and do not check `event.isTrusted`), and it does NOT cover browser-default behaviors gated on trusted events.

- **`click(selector)` dispatches the full sequence**: `pointerdown` → `mousedown` → `pointerup` → `mouseup` → `click`. Our production listeners in `pane-focus-controller`, `tug-pane`, close-button, and drag-coordinator all fire. Our handlers call `activateCard` / `removeCard` / `performSelectCard` directly, so M03 (pane-chrome click → `pane-focus-controller` → `store.activateCard`) and M16 (close-button click → `removeCard`) both work.

- **`type(selector, text)` uses the native-setter pattern** required for React's synthetic event system to pick up the change:
  ```ts
  const nativeSetter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")!.set!;
  for (const ch of text) {
    nativeSetter.call(el, el.value + ch);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ch }));
  }
  ```

- **`focusElement(selector)` for paths where synthesized events are insufficient.** Browser-default input focus on mousedown requires `isTrusted: true`; our synthesized pointerdown cannot trigger it. Tests that need to "focus an input as if the user clicked it" use `focusElement` directly. Our production focus restoration goes through `.focus()` calls anyway, so `focusElement` is equivalent to the production path.

- **What we cannot drive with synthesized events** — see §3.5 Fidelity limits below.

**Escape hatch.** If the three target tests (M01/M03/M16) hit a behavior that truly requires `isTrusted: true`, the tugplan carries a follow-up task for a Swift-side `CGEventPost` path (real hardware events via the macOS event stream). Requires accessibility permission on first launch; dev-only so permission prompts are acceptable. We expand to this only when a specific test demands it.

#### 2.8 Harness library shape

TypeScript under `tests/in-app/_harness/`, runs as `bun test`.

```ts
import { launchTugApp } from "@/_harness";

const app = await launchTugApp();      // spawns Tug.app subprocess, connects, version-handshakes

// Starting state — tests state reset intent explicitly:
await app.reset({ deck: true, trace: true, storage: true });
await app.seedDeckState({ state: makeDeckState(...), focusCardId: "c1" });

await app.click('[data-pane-id="p2"] [data-testid="pane-title"]');
await app.expectFocusedCard("c2");                // waitForCondition under the hood
await app.expectCaret("c2", { kind: "input", selectionStart: 0, selectionEnd: 0 });

// Ordered-subsequence trace matcher (not strict-equal; too brittle).
const trace = app.getDeckTrace({ since: appMark });
expect(trace).toContainOrderedSubset([
  { kind: "fr-flip", trigger: "activateCard", to: "c2" },
  { kind: "destination-flip", cardId: "c2", to: true },
  { kind: "focus-call", cardId: "c2" },
]);

await app.close();
```

Every waiting assertion wraps `waitForCondition`. Zero `setTimeout` in harness or test code.

#### 2.9 Lifecycle, crashes, and signals

- **One app launch per test file.** Tests within a file share the subprocess and state-reset explicitly per §2.6.
- **Stale socket files.** On launch, if a socket file exists at the target path owned by the same user AND no process holds it, the harness unlinks it before bind. Owned by a different user → hard error.
- **Double-connect.** Swift accepts one client at a time; a second connect gets `ECONNREFUSED` until the first disconnects.
- **App crash mid-test.** The harness's socket read returns EOF → the in-flight RPC rejects with `AppCrashedError`; all pending promises reject; the current test fails fast. Subprocess cleanup runs.
- **Hung script.** `evalJS` has a per-call timeout (§2.3). On timeout the harness sends a cancellation and logs the script; a truly stuck subprocess is killed.
- **Signal handling.** `process.on("SIGINT" | "SIGTERM")` in the harness triggers `await app.close()`. `process.on("exit")` does a synchronous `kill` as last resort so no orphaned Tug.app subprocesses are left running.
- **Log capture.** Tug.app stdout/stderr routes to `tests/in-app/logs/<test>.log`. On failure, the runner prints the last 50 lines with the failure report.

**Tugplan covers** (beyond what §§2.1-2.9 already pin):
- **Transport investigation** (first task): reuse tugcast's WebSocket multiplexer if the DEBUG guard remains clean, otherwise stand up the parallel Unix socket per §2.2.
- Exact `#if DEBUG` placement on every Swift source file that touches the bridge.
- Exact `import.meta.env.DEV` + `window.__tugTestMode` gate placement on every TypeScript entry point that touches `window.__tug`.
- `WKUserScript` injection-timing verification (document-start) so `__tugTestMode` is set before any tugdeck script runs.
- Socket-path security (mode 0600, parent-dir ownership, stale-unlink policy) per §2.9 — hardening details.
- Typed RPC client: hand-written vs codegen; error classes (`TimeoutError`, `AppCrashedError`, `VersionSkewError`).
- Test location fixed at **repository-root `tests/in-app/`**. Tugplan specifies config (tsconfig, `bun test` glob, ignored from tugdeck's own test run so the happy-dom suite does not try to load in-app tests).
- CI considerations (deferred; first target is local dev on macOS). Hardware-event fallback (`CGEventPost`) tracked as a follow-up task per §2.7.

**Exit criteria.**
- Tugplan written and reviewed.
- Tug.app `--test-harness` flag working; `evalJS("1+1")` returns 2 from a bun harness script.
- `window.__tug` surface live and callable via the bridge.
- No change to release-build binary size or behavior.

### Phase 3 — First three in-app tests (M01, M03, M16)

**Scope.** Pure test authoring against the Phase 2 harness. Bounds our confidence that the fixes for M01/M03/M16 stay fixed.

**Deliverables.** All live under repository-root `tests/in-app/`. Each test uses `app.click` / `app.type` / `app.focusElement` to drive gestures (per §2.7) and asserts against both `__tug` state reads and the deck-trace ring via `toContainOrderedSubset` (per §2.8).

- **`tests/in-app/m01-tab-switch-fc.test.ts`** — seed a pane with two FC cards (FC probes with `data-tug-persist-value` / `data-tug-focus-key` markers), activate card A, type "alpha", click tab B, verify B is focused and has its own caret state, click back to A, verify A's caret is restored at offset 5 (end of "alpha"). Ordered-subsequence assertion on the trace: `[tab-click-driven fr-flip, destination-flip a→false, destination-flip b→true, focus-call b]` → back again.

- **`tests/in-app/m03-pane-activation.test.ts`** — seed two panes each with one FC card, focus into card A1 (pane 1), `app.click` pane 2's title bar, verify card A2 becomes the focused card of the deck's active pane, verify A1's caret state was saved via `save-callback` in the trace, click pane 1 again, verify A1's caret restored at its saved offset.

- **`tests/in-app/m16-tab-close-handoff.test.ts`** — seed a pane with three cards [c1, c2, c3], activate c2, `app.click` c2's close button, verify c3 (the documented handoff target) becomes the focused card, verify **via the trace** that no `save-callback` fired for c2 during close (c2 was about to be destroyed), verify c3's caret landed at its declared `bag.focus` target.

**Non-goals for Phase 3.**
- Not M02/M05/M15 or any other scenario. Three is enough to prove the harness shape and bind the fixes. Wider coverage is a follow-on.
- Not CI. Local `bun test tests/in-app/` only for the initial target.

**Escape clause.** If Phase 1 reveals `[A3]` is structurally racy (per the Phase 1 exit criteria), Phase 3 tests validate **Step 23B's helper-based synchronous path**, not the patched `[A3]` path. The test scenarios (M01/M03/M16) are the same; the production code under test shifts. Harness and trace both support either outcome.

**Exit criteria.**
- Three tests green against the current code with fixes applied.
- Each test fails predictably when the fix is reverted (we verify by hand-breaking a known path and watching the test go red).

---

## 3. Dependencies and sequencing

```
Phase 1 (tugdeck-only)          →  Phase 2 (tugapp + tugdeck)     →  Phase 3 (test authoring)
in-tree focus instrumentation      in-app test bridge + tugplan      first 3 in-app tests
~30min + PR                        multi-day; Swift work;             depends on Phase 2;
                                   tugplan before Swift               closes the M-series gap
```

- Phase 1 ships immediately. It delivers debugging value for the current 23A work *before* we commit to the test-bridge build-out.
- Phase 2 reuses the Phase 1 `deck-trace` ring as an assertable surface. `window.__tug.getDeckTrace()` just returns the ring. Without Phase 1 the trace does not exist to assert against.
- Phase 3 depends on Phase 2 entirely — no tests until the harness can drive the app.

---

## 3.5 Fidelity limits

The harness is honest about what it cannot test. Putting these limits in writing so we don't quietly paper over them later.

- **`isTrusted: true`-gated browser behaviors.** Synthesized PointerEvent / MouseEvent / InputEvent dispatch sets `isTrusted: false`. Any browser behavior that gates on the trust bit is unreachable from tests driven by synthesized events. Known categories: browser-default focus on mousedown for inputs/buttons; WebKit gesture focus-lock semantics (may or may not apply to synthetic events — undocumented); fullscreen requests; clipboard API writes; permissions prompts; IME composition lifecycles. **Mitigation:** for focus specifically, tests call `__tug.focusElement(selector)` directly — our production code does the same via `.focus()` so the test path matches the production path. For the rest, they are outside the harness's envelope; manual verification remains the fallback. **Escape hatch:** Swift-side `CGEventPost` for real hardware events, added in a follow-up if a specific test demands it.

- **Visual rendering, paint, caret blink.** The harness reads DOM, focus, computed styles, selection state — it cannot assert "the caret is visibly blinking on screen" or "the `::selection` highlight painted in the right color." Proxies we can assert: `getComputedStyle(el).display !== "none"`, `el.getBoundingClientRect().width > 0`, `document.activeElement === el`, `getSelection().toString() === expected`. These catch most "element is not rendered" bugs but not rendering-correctness bugs. Acceptable tradeoff; noted for transparency.

- **User-perceptible timing ("is it snappy?").** The harness measures time between events precisely, but "snappy" is a subjective read that only humans can sign off on. Performance regressions that stay under a threshold but feel off are invisible here. Proxy: assert trace-event time deltas under a budget (`expect(trace.find(focus-call).timestamp - trace.find(fr-flip).timestamp).toBeLessThan(50)`).

- **Multi-window scenarios.** Current Tug.app is single-window. The harness assumes one WebView. Multi-window support is a future concern; the `__tug` surface would need to be per-window keyed, the bridge would need channel multiplexing. Not in scope for Phase 2.

- **Cross-process behavior (tugcode, tugcast).** FC-card tests use no external processes and cover M01/M03/M16 fully. EM-card tests involving a real tide editor would need tugcode running and stream-json IPC exercised. Phase 3 stays in FC-card territory. EM-card harness support is a future phase if needed.

- **Safari ≠ WKWebView differences.** Running the same test under Safari (or Playwright-webkit) would likely give different results for the subset of behaviors WKWebView configures differently (data-detectors, content rules, user agent). The harness runs inside the real Tug.app WKWebView, so by construction it sees Tug.app's configuration. Safari-in-isolation comparisons are out of scope.

When a bug falls outside the fidelity envelope, we say so, test what we can, and mark the residual as "manual verification required." We do not pretend.

---

## 4. Decisions

These were open questions in the first draft; all resolved.

- **Per-test isolation is a per-test choice, at axis granularity.** Tests call `app.reset({ deck?, selectionGuard?, orchestrator?, trace?, storage? })` with every axis defaulting to false. Test authors state exactly what they want cleared. See §2.6 for rationale and §2.5 for the signature. No default reset behavior; ambiguity about starting state is the #1 source of in-app-test flakiness, and making it explicit eliminates the class.

- **`seedDeckState` bypasses tugbank via a boot-time DeckManager flag.** `DeckManager` gains a `testMode: boolean` constructor option (or equivalent factory parameter). When true, the boot sequence does NOT read persisted state from tugbank and does NOT write to tugbank during the session. The in-app bridge sets this flag when test mode is active, so `seedDeckState` is the single source of state for the whole run.

- **Harness provides first-class `waitForCondition`.** The bridge primitive is described in §2 Phase 2; the harness library wraps it so all test-side waiting goes through it. No raw `await new Promise(r => setTimeout(r, 50))` in test code — if a test needs to wait, it waits on a condition (usually an assertion on `window.__tug` state), not a timer. Default timeout 2000ms, overridable per call.

- **All debugging support is DEBUG-build-only; nothing leaks to production.** This is non-negotiable and load-bearing. Every entry point — the socket, the `window.__tug` surface, the `DeckManager.testMode` path, the `deck-trace` toggle if it ever becomes a security concern — is gated by the same DEBUG guard on the Swift side and tree-shaken out of release bundles on the TypeScript side. No runtime flag, no environment variable, no production code path can reach any of this. The tugplan specifies the exact guard: a Swift `#if DEBUG` on every bridge-touching source file AND a bundle-level `import.meta.env.DEV` gate on the TypeScript surface, so each half's guard is independent.

- **tugcast reuse: investigate first, decide in the tugplan.** tugcast already runs a WebSocket multiplexer inside the app and knows how to route control frames. It is plausible we can piggyback a test-mode channel onto it rather than standing up a parallel Unix-socket server — same process, same lifecycle, fewer moving pieces. Counterargument: mixing the DEBUG-only test channel with the production runtime transport blurs the guard and risks a release-build leak. The tugplan's first investigation task is a concrete assessment: what would it cost to reuse tugcast, and is the DEBUG guard still clean if we do? If yes, reuse. If no, parallel socket.

- **Tests live at repository root.** `tests/in-app/` alongside the top-level `tugrust/`, `tugdeck/`, `tugapp/`. This placement matches the harness's job (launch the whole Tug.app; no single-workspace claims it) and keeps the runner path-resolution simple.

- **Instrumentation covers the whole deck, not just focus.** The Phase 1 module is `deck-trace.ts` — tagged event union over `fr-flip`, `destination-flip`, `card-host-mount/unmount`, `a3-fire` (including early-returns), `focus-call`, `focusin`/`focusout`, `save-callback`, `selection-restore`, `commit-tick`. A narrow focus-only trace cannot diagnose bugs where the focus call never runs; a deck-wide trace can. See §2 Phase 1.

- **`evalJS` / `waitForCondition` carry structured errors and hard timeouts.** The RPC protocol is a discriminated union over `{ ok: true, value }` and `{ ok: false, error: { name, message, stack? } }`. Script throws serialize. Non-serializable return values become errors. `TimeoutError`, `AppCrashedError`, `VersionSkewError` are the three standard error names tests may need to handle. See §2.3 and §2.9.

- **Boot timing: env var at Swift startup, never via the bridge.** `DeckManager.testMode` is resolved before tugdeck's first line of JS. Bridge connect is separate concern for RPC transport; it cannot race the mode decision. See §2.1.

- **Event synthesis via dispatched PointerEvent/MouseEvent/InputEvent, with explicit `isTrusted: false` fidelity limits.** Tests drive gestures through `__tug.click` / `__tug.type` / `__tug.focusElement`. The envelope covers M01/M03/M16; anything trusted-event-gated is documented as a fidelity limit (§3.5) and may escalate to `CGEventPost` in follow-up if a test demands it. See §2.7.

- **`__tug` surface versioned; handshake enforces.** `__tug.version = "1.0.0"`. Surface additions bump the version. Harness asserts on connect; skew fails loudly. See §2.5.

---

## 5. Risks

- **Swift blast radius.** Any change to tugapp/ touches the shipping binary. The DEBUG guard is not defense-in-depth — it is the only defense. Swift `#if DEBUG` on every bridge-touching file, TypeScript `import.meta.env.DEV` on every `window.__tug` touch point, code review discipline to catch any bypass. A release build that contains a single line of bridge code is a shipping bug.
- **Test bridge as attack surface.** Even in DEBUG builds, a local-socket RPC is an open door. The socket path must be strictly user-scoped (mode 0600, parent-dir ownership checked). No TCP, ever. If we reuse tugcast's transport instead, the same scrutiny applies to the channel gating.
- **Harness drift.** If the harness grows faster than our test coverage, we end up with rich infrastructure and no assertions binding it in place. Phase 3 deliverables — three working tests — are the deliberate pull on this.
- **happy-dom creep.** Now that we know happy-dom lies, there is still a temptation to add "quick checks" there. Feedback memory captures the prohibition; PR review enforces it.

---

## 6. Plan doc hygiene

- When Phase 2's tugplan lands in `roadmap/tugplan-in-app-bridge.md`, this strategy doc links to it from §2 Phase 2.
- When Phase 3 lands, this doc's §2 Phase 3 updates its exit criteria to "done" and the doc moves from "Draft proposal" to "Active."
- Retired only once all three phases ship and have been load-bearing for the M-series fixes for at least one release cycle.
