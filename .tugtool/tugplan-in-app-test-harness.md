<!-- tugplan-skeleton v2 -->

## In-App Test Harness {#phase-in-app-test-harness}

**Purpose:** Build a three-phase test harness that exercises tugdeck inside the real Tug.app WKWebView — so focus, selection, caret, activation, and lifecycle behavior are verified against the runtime users actually get, not against happy-dom's approximation. Phase 1 delivers in-tree deck instrumentation. Phase 2 delivers a debug-build-only bridge between Tug.app and a bun test runner. Phase 3 delivers three M-series regression tests (M01, M03, M16) that bind the in-progress fixes in place.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-04-23 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The tugdeck happy-dom test suite (2419 passing at authoring time) has been giving false green signals for focus, selection, caret, and activation-dispatch behavior. M01 works intermittently in the running app; M03 and M16 never work — while the tests that claim to cover them are green. A test suite that passes while the feature is broken is worse than no tests: it misleads, delays the catch, and rewards the wrong abstractions.

happy-dom is wrong about the behaviors this project cares about. `el.focus()` on a `display: none` element updates `document.activeElement` in happy-dom; real browsers silently refuse. Portal reconciliation in happy-dom does not match React + real DOM — especially cross-subtree moves like `CardPortal`. Synthesized `pointerdown` events do not reproduce real event ordering. happy-dom does no rendering, so `::selection` styling, caret blink, and inactive-selection highlight are invisible to assertions. Mock `Store` classes used in our "integration" tests approximate `DeckManager` lifecycle imperfectly.

Playwright is not the answer either — its `webkit` driver is a Playwright-maintained WebKit build, not the WKWebView inside Tug.app. Closer to reality than Chromium, still wrong engine in wrong process. Switching harnesses would trade one set of lies for a smaller set of lies.

The only honest harness drives the same binary users run, inside the same WKWebView tugdeck renders into, under the same `WKWebViewConfiguration`. This plan builds that harness.

#### Strategy {#strategy}

- Three phases, sequenced so each ships debugging value independently. Phase 1 alone — before the bridge is built — gives us a real read on the current M-series bugs.
- Every bit of debugging support is DEBUG-build-only. No test-mode code ships in a release binary, ever. Enforced independently on the Swift side (`#if DEBUG`) and the TypeScript side (`import.meta.env.DEV` + `window.__tugTestMode`).
- Phase 2's Swift work lives under a follow-up tugplan. This plan commits to that tugplan existing before any Swift code is committed to `tugapp/`.
- Tests are authored against the real runtime only. This plan adds a feedback memory that prohibits new happy-dom tests for UI / focus / selection / DOM-timing behavior.
- Harness fidelity is honestly documented: any browser behavior gated on `isTrusted: true` is outside the envelope, and the plan says so in writing.
- Phase 3 coverage is deliberately capped at three tests. The goal is proving the harness shape and binding the M01/M03/M16 fixes, not boiling the ocean.

#### Success Criteria (Measurable) {#success-criteria}

- `window.__deckTrace.enable(true)` active in the live app, M01/M03/M16 reproduced once each, three trace dumps pasted back, root-cause hypothesis stated. (Verified: trace contents shared in this document's M-series thread.)
- Tug.app subprocess launched with `TUGAPP_TEST_SOCKET=/tmp/tugapp-test-<uuid>.sock` from a bun harness script; `evalJS("1+1")` returns `2`. (Verified: `bun test tests/in-app/_smoke.test.ts` exits 0.)
- `tests/in-app/m01-tab-switch-fc.test.ts`, `m03-pane-activation.test.ts`, `m16-tab-close-handoff.test.ts` all pass against the code with M-series fixes applied. (Verified: `bun test tests/in-app/` exits 0.)
- Each M-series test fails when its target fix is reverted by hand. (Verified: drift-prevention exercise documented in Step 16.)
- Release-build binary size and behavior unchanged vs pre-plan baseline. (Verified: `wc -c` on notarized binary before / after; manual smoke run of release build.)
- Zero new happy-dom tests added for UI / focus / selection / DOM-timing behavior across the whole plan. (Verified: grep review of commits.)

#### Scope {#scope}

1. `tugdeck/src/deck-trace.ts` — ring-buffer deck instrumentation module with tagged event union, recording sites across `deck-manager.ts` and `card-host.tsx`, destination-flip observer, document-level focus-in/out observer, commit-tick beacon.
2. `DeckManager.testMode` constructor flag that short-circuits tugbank reads and suppresses tugbank writes.
3. `window.__tug` and `window.__tugTestMode` surfaces, gated by `import.meta.env.DEV` so release bundles tree-shake them.
4. Tug.app `--test-harness=path` / `TUGAPP_TEST_SOCKET` mode with DEBUG-only Unix-socket bridge, `WKUserScript` injecting `__tugTestMode` at document-start, `evalJS` + `waitForCondition` RPC primitives.
5. Bun harness library under `tests/in-app/_harness/` — `launchTugApp`, typed client, `toContainOrderedSubset` matcher, `click` / `type` / `focusElement` / `reset` / `seedDeckState` / `expectFocusedCard` / `expectCaret` wrappers.
6. Three in-app tests at repository-root `tests/in-app/` covering M01 (intra-pane tab switch, FC card), M03 (pane-chrome activation), M16 (tab-close handoff).
7. Phase 2 follow-up tugplan `roadmap/tugplan-in-app-bridge.md` with transport choice (tugcast reuse vs parallel socket), exact Swift guard placement, WKUserScript ordering, typed RPC client.
8. Feedback memory prohibiting new happy-dom tests in the affected behavior classes.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Replacing all happy-dom tests. Pure-logic unit tests (serializers, reducers, pure selectors, the deck-trace ring buffer itself) stay on happy-dom — they test data structures, not UI behavior.
- CI integration. First target is local-dev `bun test tests/in-app/` on macOS. CI is a follow-on.
- Multi-window support. Tug.app is single-window today; the harness assumes one WebView.
- EM-card tests (tide-card contentEditable with tugcode running). Phase 3 is FC-cards only (inputs with `data-tug-persist-value` / `data-tug-focus-key`).
- Safari-in-isolation or Playwright-webkit comparisons. The harness runs inside the real Tug.app WKWebView by construction.
- `CGEventPost`-based hardware event injection. Kept as an escape hatch for tests that truly need `isTrusted: true` events; not implemented in this plan.
- Wider M-series coverage (M02/M05/M15/etc.). Three tests prove the harness; wider coverage is a follow-on.
- Coverage for Tug.app's macOS chrome (menus, window controls). Harness targets the WKWebView content only.

#### Dependencies / Prerequisites {#dependencies}

- `focus-transfer.ts` and `ActivationTarget` (landed at `tugplan-selection` Step 23A). Used by the trace's `a3-fire` event shape.
- `isFocusDestination` and `useFocusDestination` (landed at `tugplan-selection` Step 20). Used by the destination-flip observer.
- `canProgrammaticallyFocus` / focus-theft gate (landed at `tugplan-selection` Step 21). Gate-result field in `a3-fire` events.
- `CardHost` root registration (`registerCardHostRoot` / `peekCardHostRoot`, landed at Step 23A).
- macOS development environment: Xcode for tugapp/ Swift edits; bun for test runner; Safari with Develop menu for WKWebView inspection.

#### Constraints {#constraints}

- **DEBUG-build-only guard is load-bearing, not defense-in-depth.** A release build that contains a single line of bridge code is a shipping bug. Enforced on both the Swift (`#if DEBUG`) and TypeScript (`import.meta.env.DEV` + runtime `__tugTestMode` check) halves, independently.
- **Local Unix socket only.** No TCP. No network exposure. Socket file mode 0600; parent-dir ownership checked at bind time.
- **No `setTimeout`-based waiting in test code.** Every wait goes through `waitForCondition`. Ambiguity about event-loop timing in WKWebView is the #1 source of in-app-test flakiness.
- **No new happy-dom tests for UI / focus / selection / DOM-timing behavior.** Codified in feedback memory; enforced at review.
- **Synthesized events only.** `isTrusted: true` behaviors are outside the harness envelope; documented as fidelity limits.
- **macOS only.** Tug.app is macOS-only; no Linux/Windows harness path.
- **Single WebView assumption.** Harness and `__tug` surface are not keyed per-window.

#### Assumptions {#assumptions}

- The bugs we need to diagnose (M01/M03/M16) are reachable via synthesized PointerEvent/MouseEvent/InputEvent dispatch — our handlers do not check `event.isTrusted`.
- `WKUserScript` at `atDocumentStart` fires before any tugdeck JS runs; `window.__tugTestMode` is readable in `main.tsx` before `DeckManager` is constructed.
- `bun` is stable enough as a test runner and subprocess launcher for our needs on macOS.
- FC cards (inputs with `data-tug-persist-value` / `data-tug-focus-key`) reproduce M01/M03/M16 without requiring EM cards (contentEditable, tugcode).
- Tug.app's `WKWebViewConfiguration` does not need to change between release and test modes beyond enabling Web Inspector and the `__tugTestMode` user script.
- The three target tests are short enough that one-app-per-test-file lifecycle is fast enough; no optimization needed in Phase 2.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Transport: reuse tugcast's WebSocket multiplexer, or stand up a parallel Unix socket? (DEFERRED) {#q01-transport-choice}

**Question:** Tug.app already embeds tugcast's WebSocket multiplexer for runtime control frames. Can a DEBUG-only test-mode channel piggyback on tugcast, or does the test bridge need its own Unix socket transport? Reuse means one transport, one lifecycle; parallel means cleaner DEBUG-only separation.

**Why it matters:** Mixing the test channel with the production runtime transport risks blurring the DEBUG guard — a leak anywhere on the tugcast side leaks the test channel too. A parallel Unix socket is structurally cleaner but adds a second listener.

**Options:**
- Reuse tugcast. Add a DEBUG-only control-frame verb for test RPC.
- Parallel Unix socket. New listener in tugapp/, bound to a user-scoped path.

**Plan to resolve:** First investigation task in `roadmap/tugplan-in-app-bridge.md` (Step 4 of this plan). Concrete assessment: does the DEBUG guard stay clean if we reuse tugcast? If yes, reuse. If no, parallel.

**Resolution:** DEFERRED to [#step-4] and tracked in [D04].

#### [Q02] Should T-1 and T-2 (`DeckManager.testMode`, `window.__tug` surface) land during Phase 1 instead of Phase 2? (DEFERRED) {#q02-t1-t2-placement}

**Question:** T-1 and T-2 are TypeScript-only and harmless when nothing calls them. Landing them alongside Phase 1 would leave Phase 2 as a Swift-only boundary — simpler to review, easier to roll back.

**Why it matters:** Placement affects reviewer ergonomics and the natural Swift-vs-TypeScript commit grouping. Landing T-1/T-2 early means Phase 2's first real commit is a clean Swift-+-transport slice; landing them in Phase 2 keeps all test-mode wiring under the tugplan umbrella.

**Options:**
- Move T-1 and T-2 to Phase 1 (alongside Steps 1-2).
- Keep T-1 and T-2 in Phase 2 per the current plan.

**Plan to resolve:** Decide when `tugplan-in-app-bridge.md` is authored (this plan's Step 4). The tugplan sets the scope boundary.

**Resolution:** DEFERRED to [#step-4].

#### [Q03] `CGEventPost` escape hatch — do any of M01/M03/M16 require it? (DEFERRED) {#q03-cgeventpost-needed}

**Question:** Synthesized events have `isTrusted: false`. If any of the three target tests hits a WebKit behavior gated on `isTrusted: true`, the harness cannot drive it. Does any of M01/M03/M16 actually require a trusted event?

**Why it matters:** Building `CGEventPost` is real work (Swift-side macOS event-stream posting, accessibility permission handling). Doing it speculatively bloats Phase 2; skipping it when a test needs it blocks Phase 3.

**Plan to resolve:** Observed empirically during Phase 3. If all three tests pass via synthesized events, escape hatch not needed. If any test cannot be made reliable via synthesized events, a follow-up plan adds `CGEventPost` per [#q03-cgeventpost-needed].

**Resolution:** DEFERRED to Phase 3 observation. Tracked in [D10] fidelity-limit documentation.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Swift bridge code leaks to release binary | critical | low | DEBUG-only guards on both halves; code review; binary-size diff in exit criteria | Any Swift PR touching bridge-adjacent files |
| Test bridge becomes attack surface | high | low | Local Unix socket only, mode 0600, parent-dir check; no TCP; DEBUG-only | Any change to transport or socket-path handling |
| Harness grows faster than test coverage (shelf-ware) | medium | medium | Phase 3 deliverables — three working tests — are the deliberate pull | Harness adds features without corresponding tests using them |
| Creep of happy-dom tests for UI behavior | medium | medium | Feedback memory in place; PR review catches | Any PR adding a test file under `tugdeck/src/__tests__/` that exercises focus / selection / DOM timing |
| `isTrusted: true` required by a target test | medium | low | Documented fidelity limit; `CGEventPost` as follow-on | Phase 3 test proves unreliable via synthesized events |
| WKWebView timing differs from assumptions, causing flakiness | medium | medium | `waitForCondition` as sole waiting primitive; retry budgets per call | More than one flaky test in Phase 3 |

**Risk R01: Swift bridge code leaks to release binary** {#r01-swift-release-leak}

- **Risk:** A `#if DEBUG` bracket is forgotten on a bridge-touching file, shipping the Unix-socket listener (or a mapping of `__tugTestMode`) to end-user release builds. Even a single unbracketed line is a shipping bug.
- **Mitigation:**
  - Every bridge-touching Swift file is opened ONLY inside `#if DEBUG ... #endif`.
  - Every TypeScript touchpoint of `window.__tug` / `window.__tugTestMode` is gated behind `import.meta.env.DEV` AND a runtime `__tugTestMode` check, so Vite dead-code-eliminates it from release bundles.
  - Phase 2 tugplan specifies exact file-level placement and a CI grep check for unbracketed references.
  - Release-build binary-size diff vs pre-plan baseline is a phase exit criterion.
- **Residual risk:** A build misconfiguration where DEBUG is set in a release archive would still leak the code. Accepted — out-of-scope for this plan; trapped by Xcode archive review.

**Risk R02: Test bridge as attack surface** {#r02-bridge-attack-surface}

- **Risk:** Even under DEBUG builds, a local-socket RPC that accepts arbitrary `evalJS` is a code-execution gate. Misconfigured path permissions or an accidental TCP fallback turns it into a remote attack surface.
- **Mitigation:**
  - Local Unix socket only. TCP is not a code path, anywhere.
  - Socket file mode 0600; parent directory ownership checked at bind time.
  - Stale socket files unlinked only if owned by the same user.
  - DEBUG-only guard (see R01).
- **Residual risk:** A developer who copies the socket path to another user and weakens permissions. Accepted; dev-tooling trust model.

**Risk R03: Harness drift** {#r03-harness-drift}

- **Risk:** The harness accumulates `__tug` surface features and helper wrappers faster than tests use them. Ends up as rich infrastructure with nothing binding it in place; maintenance cost without value.
- **Mitigation:** Phase 3 deliverables are three working tests. Anything added to the `__tug` surface that no test uses is candidate for removal. Version-bump discipline on the surface.
- **Residual risk:** Temptation to add "nice-to-have" helpers. Flagged in PR review.

**Risk R04: happy-dom creep** {#r04-happy-dom-creep}

- **Risk:** Now that we know happy-dom lies, there is still pressure to add "quick happy-dom checks" for new UI behavior rather than building real tests.
- **Mitigation:** Feedback memory in place; PR review enforces. Any new test file under `tugdeck/src/__tests__/` touching focus/selection/DOM-timing behavior is rejected by default.
- **Residual risk:** Legitimate pure-logic tests (serializers, reducers) stay on happy-dom; line is judgment call at review time.

---

### Design Decisions {#design-decisions}

#### [D01] Per-test isolation is per-test, at axis granularity (DECIDED) {#d01-per-test-isolation}

**Decision:** Tests call `app.reset({ deck?, selectionGuard?, orchestrator?, trace?, storage? })` with every axis defaulting to false. Test authors state exactly what they want cleared in the test body. No default reset behavior; no implicit cleanup.

**Rationale:**
- Ambiguity about starting state is the #1 source of in-app-test flakiness; forcing explicitness eliminates the class.
- Each test's intent is visible in its own source, not buried in a shared `beforeEach` somewhere.
- Axis granularity lets a test inherit a cache that matters (e.g. orchestrator registrations) while resetting a cache that does not (e.g. trace ring).

**Implications:**
- `__tug.reset` (see Spec [#s03-tug-surface]) takes an options object with every axis optional.
- `seedDeckState` is the companion call that loads state; does not reset anything implicitly.
- Harness lints / fails loud if a test calls the harness without calling `reset` or `seedDeckState` first.

#### [D02] `seedDeckState` bypasses tugbank via a boot-time DeckManager flag (DECIDED) {#d02-testmode-flag}

**Decision:** `DeckManager` gains a `testMode: boolean` constructor option. When true, boot sequence skips tugbank reads (`GET /dev.tugtool.deck.*`) and every tugbank write (`putLayout`, `putCardState`, `putFocusedCardId`) is wrapped in an early-return guard. `seedDeckState` is the single source of state for the whole test-mode session.

**Rationale:**
- The alternative — a global `__tugTestSeed` the boot path reads first — couples DeckManager to a window global. Constructor option is cleaner and testable.
- Tugbank bypass must be decided before tugdeck boots, otherwise the boot sequence races the bridge-connect.

**Implications:**
- DeckManager constructor gains one optional parameter; backward-compatible (default false).
- `this.testMode` is read wherever tugbank I/O is performed; no statics, no globals.
- Release builds never reach this code path because the flag is set only by the DEBUG-gated bridge.

#### [D03] All debugging support is DEBUG-build-only; nothing leaks to production (DECIDED) {#d03-debug-only-guard}

**Decision:** Every entry point of the bridge is gated independently on two halves. Swift side: `#if DEBUG` on every bridge-touching source file. TypeScript side: `import.meta.env.DEV` on every touchpoint of `window.__tug` / `window.__tugTestMode`, so Vite tree-shakes the surface from release bundles. The Swift guard and the TypeScript guard are independent — a failure of either alone does not reach production.

**Rationale:**
- The bridge accepts arbitrary `evalJS`; it is a code-execution gate. Shipping it to end users is a security incident.
- Defense-in-depth (two independent guards) means the system remains safe if one half is misconfigured.
- Phase 2 tugplan specifies exact file-level placement so the guard boundary is reviewable in one pass.

**Implications:**
- Release builds have no socket listener, no `window.__tug`, no `DeckManager.testMode` codepath reachable.
- Binary-size diff vs baseline is a phase exit criterion.
- Tugplan includes a CI grep check for unbracketed references.

#### [D04] tugcast transport: investigate first, decide in tugplan (DECIDED) {#d04-transport-investigation}

**Decision:** Phase 2 tugplan's first task is a concrete assessment of whether routing test-mode RPC over tugcast's existing WebSocket multiplexer preserves the DEBUG guard. If yes, reuse tugcast's transport with a DEBUG-only test-mode verb. If no, stand up a parallel Unix socket.

**Rationale:**
- Reuse is structurally simpler — one transport, one lifecycle, fewer moving pieces.
- Mixing test-channel with production runtime transport risks blurring the DEBUG guard; a leak on tugcast's side leaks the test channel.
- The tradeoff is real and not decidable in the abstract; it needs the tugcast code in hand.

**Implications:**
- `roadmap/tugplan-in-app-bridge.md` opens with the investigation as Task 1.
- Whichever transport wins, the RPC shape (Spec [#s02-rpc-protocol]) is the same.

#### [D05] Tests live at repository root (DECIDED) {#d05-tests-at-root}

**Decision:** In-app tests live at `tests/in-app/` alongside the top-level workspaces (`tugrust/`, `tugdeck/`, `tugapp/`, `tugcode/`, `tugplug/`).

**Rationale:**
- The harness launches Tug.app (the full binary), which no single workspace owns. Root placement matches the harness's cross-cutting scope.
- Runner path-resolution is simpler (no `../../../tugapp/` relative paths).

**Implications:**
- `tests/in-app/` gains its own `tsconfig.json` and `bun test` glob.
- Excluded from `tugdeck/`'s happy-dom suite so `bun test` in tugdeck does not accidentally load in-app tests.

#### [D06] Instrumentation covers the whole deck, not just focus (DECIDED) {#d06-deck-trace-scope}

**Decision:** Phase 1 module is `deck-trace.ts`, not `focus-trace.ts`. Event union covers `fr-flip`, `destination-flip`, `card-host-mount` / `card-host-unmount`, `a3-fire` (including early-returns with reason tag), `focus-call`, `focusin` / `focusout`, `save-callback`, `selection-restore`, `commit-tick`.

**Rationale:**
- The M03/M16 bugs are not bugs in focus-calling code; they are bugs in why focus-calling code never runs.
- A narrow focus-only trace cannot diagnose "the effect body early-returned." The `a3-fire` event with `earlyReturn` tag IS the diagnostic.
- Whole-deck scope makes the trace a general-purpose debugging tool beyond M-series fixes.

**Implications:**
- Recording sites span `deck-manager.ts`, `card-host.tsx`, and `deck-trace.ts` itself (destination-flip observer, document-level focus observer, commit-tick beacon).
- `_flipFirstResponder` and `invokeSaveCallback` gain a caller-provided `trigger` / `source` parameter.

#### [D07] `evalJS` / `waitForCondition` carry structured errors and hard timeouts (DECIDED) {#d07-rpc-error-model}

**Decision:** RPC protocol is a discriminated union `{ ok: true, value } | { ok: false, error: { name, message, stack? } }`. Script throws serialize into the `ok: false` shape server-side. Non-serializable return values become errors. Standard error classes on the harness side: `TimeoutError`, `AppCrashedError`, `VersionSkewError`.

**Rationale:**
- Silent nulls are the worst debugging experience; structured errors let tests match on error kind.
- Hard timeouts (default 5000ms `evalJS`, 2000ms `waitForCondition`) prevent a stuck subprocess from hanging the whole test run.
- Three error classes cover the failure modes tests will actually need to branch on.

**Implications:**
- Spec [#s02-rpc-protocol] documents the wire shape.
- Harness client wraps `ok: false` responses as thrown errors of the matching class so test code is idiomatic.

#### [D08] Boot timing: env var at Swift startup, never via the bridge (DECIDED) {#d08-boot-timing}

**Decision:** `DeckManager.testMode` is resolved before tugdeck's first line of JS. Swift reads `TUGAPP_TEST_SOCKET` env var at startup; if set, the `__tugTestMode = true` assignment lands via `WKUserScript` at `atDocumentStart`; tugdeck reads it in `main.tsx` and passes `testMode: true` to the DeckManager constructor. Bridge socket connect is a separate concern for RPC transport; it cannot race the mode decision.

**Rationale:**
- The alternative — set mode via the bridge after connect — races the boot sequence. Tugbank reads may fire before the bridge attaches, polluting state.
- Env-var-at-startup is the simplest primitive that provably runs before any JS.

**Implications:**
- `WKUserScript` injection timing is verified in Phase 2 tugplan (Step 4).
- `TUGAPP_TEST_SOCKET` unset = no test mode; app boots exactly as today.
- `TUGAPP_TEST_SOCKET` set + no harness ever connects = app sits in test mode with empty deck; harmless dev-mode behavior.

#### [D09] Event synthesis via dispatched PointerEvent/MouseEvent/InputEvent; `isTrusted: false` fidelity limits documented (DECIDED) {#d09-event-synthesis}

**Decision:** Tests drive gestures through `__tug.click`, `__tug.type`, `__tug.focusElement`. `click` dispatches the full `pointerdown → mousedown → pointerup → mouseup → click` sequence. `type` uses the native-setter pattern so React's synthetic-event system sees the change. `focusElement` calls `.focus()` directly for paths where synthesized pointerdown is insufficient.

**Rationale:**
- Our production listeners (`pane-focus-controller`, `tug-pane`, close-button, drag-coordinator) all respond to JS logic that does not check `event.isTrusted`. Synthesized events reach our handlers.
- Browser-default focus-on-mousedown for inputs requires `isTrusted: true`; not reachable via synthesized events. Documented fidelity limit.
- Escape hatch (`CGEventPost`) reserved for a later phase if a test demands it.

**Implications:**
- Envelope covers M01/M03/M16 based on current code inspection.
- Tests cannot verify browser-default focus behavior; our production code uses explicit `.focus()` anyway, so test path matches production path.
- Spec [#s04-event-synthesis] documents exact dispatch order.

#### [D10] Fidelity limits are documented, not hidden (DECIDED) {#d10-fidelity-limits}

**Decision:** The plan includes an explicit "Fidelity limits" section (see [#fidelity-limits]) enumerating what the harness cannot test: `isTrusted: true`-gated behaviors; visual rendering / caret blink / paint correctness; user-perceptible timing ("is it snappy"); multi-window scenarios; cross-process (tugcode, tugcast) behavior; Safari ≠ WKWebView differences.

**Rationale:**
- Writing these down prevents quiet assumption that they're covered.
- Tests that need coverage outside the envelope are marked "manual verification required" instead of pretending.

**Implications:**
- Any future PR that adds a test claiming to cover a fidelity-limited behavior is rejected at review.
- If demand for coverage outside the envelope accumulates, a follow-up plan can expand (e.g. `CGEventPost`).

#### [D11] `__tug` surface is versioned; handshake enforces (DECIDED) {#d11-tug-surface-versioning}

**Decision:** `window.__tug.version = "1.0.0"` is a compile-time constant. Harness client asserts `__tug.version === expectedVersion` on connect; mismatch throws `VersionSkewError`. Every addition to the surface bumps the version and triggers a tugplan follow-up.

**Rationale:**
- Without versioning, the first silent surface-shape drift breaks tests invisibly months later.
- Making version a compile-time constant (not a string field looked up at runtime) means Vite dead-code-removes the old version when the surface changes.

**Implications:**
- First version is `1.0.0`. Phase 3 tests assert on it.
- Any PR that extends the surface must include a version bump and a harness-client version bump.

#### [D12] `waitForCondition` is the sole waiting primitive (DECIDED) {#d12-waitforcondition}

**Decision:** The RPC exposes `waitForCondition(script, timeoutMs?, pollMs?)` as a first-class primitive. The harness library wraps it for all test-side waiting. No raw `setTimeout` in test code or harness code.

**Rationale:**
- Timer-based waits are the most common source of flakiness in real-browser test harnesses.
- Condition-based waits scale with the actual signal; they fail loud on timeout instead of sometimes-passing on a race.

**Implications:**
- Harness lint enforces "no `setTimeout` / `setInterval` in `tests/in-app/`."
- Default timeout 2000ms, overridable per call. Long waits signal a test design problem.

#### [D13] Phase 1 success is "we know which path to take" — accelerate 23B if [A3] is structurally racy (DECIDED) {#d13-phase-1-exit}

**Decision:** Phase 1 exit criteria explicitly allow the outcome "accelerate Step 23B's helper wiring instead of trying to patch [A3]." If the trace reveals `[A3]`'s `isFirstRun` / `prev`-guards cannot correctly classify a first-time-destination activation, retiring the effect is cheaper than fixing it.

**Rationale:**
- Investigation sometimes reveals that the bug's fix is a different architectural choice, not a patch.
- The plan should not assume the solution; it should support either outcome.

**Implications:**
- Step 3 (Phase 1 integration checkpoint) explicitly documents the "accelerate 23B" branch as a valid exit.
- Phase 3 tests are written against whichever path wins (patched `[A3]` or helper-based sync dispatch). Trace shape supports both.

---

### Deep Dives {#deep-dives}

#### In-tree instrumentation — Phase 1 {#phase-1-deck-trace}

Pure tugdeck change. No Tug.app or Swift work. Lands across two commits.

**Module name: `deck-trace.ts`, not `focus-trace.ts`.** The bugs we are diagnosing are not bugs in focus-calling code; they are bugs in why the focus-calling code never runs. To see that, we need upstream events — responder-chain flips, destination transitions, CardHost mount/unmount, React commit beacons, document-level focus observers — in the same ordered stream. A narrow focus-only trace tells us nothing happened and leaves us no closer to why.

The event shape (Spec [#s01-deck-trace-event]) is one tagged union over 11 event kinds. Every event carries `{ timestamp, seq }`. Ring is bounded at 512 entries, oldest-evicted. Enable flag gates all recording — when off, `record` is a single bounds-check and return.

Recording sites (List [#l01-recording-sites]) span `deck-manager.ts` (flip and save events), `card-host.tsx` (mount/unmount, [A3] including early-returns, every `.focus()` site, selection-restore), and `deck-trace.ts` itself (destination-flip observer, document-level focus observer, commit-tick beacon).

**What a trace looks like when we diagnose M03** (Table [#t01-m03-trace-example]):

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

One glance: `[A3]`'s mount-guard is refusing to fire on c3 because c3's first-ever effect run coincides with its first-ever destination=true, so the `isFirstRun` early-return swallows the activation. No amount of manual repro would have told us that as crisply.

#### In-app test bridge — Phase 2 {#phase-2-bridge}

Touches `tugapp/` (Swift) and `tugdeck/` (TypeScript). Gated by `roadmap/tugplan-in-app-bridge.md` (authored as this plan's Step 4) before any Swift code is committed.

##### 2.1 Boot choreography {#boot-choreography}

One ordering guarantee: `testMode` is decided at Swift startup via env var, never via the bridge. Bridge connection timing is irrelevant because the mode is already set before tugdeck boots.

1. Swift `main()` reads `TUGAPP_TEST_SOCKET` env var. If set, `TEST_MODE = true` and the socket path is remembered.
2. Swift starts the Unix socket listener asynchronously (does not block boot).
3. Swift constructs the WebView with a `WKUserScript` at `WKUserScriptInjectionTime.atDocumentStart` injecting `window.__tugTestMode = true`. This fires before any tugdeck JS runs.
4. tugdeck `main.tsx` reads `window.__tugTestMode` and passes `testMode: true` to `new DeckManager(...)`.
5. DeckManager constructor sees `testMode: true`: skips the tugbank read in the boot sequence, installs the write-suppressor, starts with empty `DeckState`.
6. tugdeck initializes `window.__tug` (gated on `window.__tugTestMode` AND `import.meta.env.DEV`; without both, no surface is attached).
7. Harness connects to the Unix socket with bounded retry on `ECONNREFUSED` (default 10s, 100ms interval).
8. First exchange is a `version` handshake. Mismatch → harness throws immediately.
9. Tests run.

Dev-mode boot without a harness: when `TUGAPP_TEST_SOCKET` is unset, steps 2-8 do not run; tugdeck boots exactly as today. When env var set but no harness connects: app sits in test mode with empty state; harmless.

##### 2.2 Transport and guards {#transport-and-guards}

DEBUG-only guard is non-negotiable (see [D03]). Web Inspector is enabled in test mode (`configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")`) so Safari's Develop menu can attach.

Transport choice deferred to the tugplan ([Q01] / [D04]).

##### 2.3 RPC protocol {#rpc-protocol}

See Spec [#s02-rpc-protocol] for wire shapes. Two primitives: `evalJS(script, timeoutMs?)` and `waitForCondition(script, timeoutMs?, pollMs?)`. Every higher-level operation composes from these two.

Hard timeouts are the default. `waitForCondition` is the sole waiting primitive ([D12]).

##### 2.4 `DeckManager` test-mode flag {#deckmanager-testmode}

Constructor option `testMode?: boolean` (default false). When true: skip tugbank reads; wrap every tugbank write in `if (this.testMode) return;`; `seedDeckState` replaces in-memory `DeckState` atomically and runs the cold-boot restore path. No globals, no statics.

##### 2.5 `window.__tug` surface {#tug-surface}

See Spec [#s03-tug-surface] for the full TypeScript interface. Gated by `window.__tugTestMode && import.meta.env.DEV`. Version-handshaked on connect ([D11]).

##### 2.6 Per-test isolation via granular reset {#granular-reset}

Per [D01]: `app.reset(opts)` with every axis defaulting to false; `app.seedDeckState(args)` for starting state; no implicit defaults.

##### 2.7 Event synthesis: fidelity and limits {#event-synthesis-details}

See Spec [#s04-event-synthesis] and [D09]. `click` dispatches the full pointer sequence; `type` uses the native-setter pattern; `focusElement` is the direct `.focus()` escape for cases where synthesized pointerdown is insufficient.

##### 2.8 Harness library shape {#harness-library}

TypeScript under `tests/in-app/_harness/`, runs as `bun test`.

```ts
import { launchTugApp } from "@/_harness";

const app = await launchTugApp();      // spawns Tug.app subprocess, connects, version-handshakes

await app.reset({ deck: true, trace: true, storage: true });
await app.seedDeckState({ state: makeDeckState(...), focusCardId: "c1" });

await app.click('[data-pane-id="p2"] [data-testid="pane-title"]');
await app.expectFocusedCard("c2");                // waitForCondition under the hood
await app.expectCaret("c2", { kind: "input", selectionStart: 0, selectionEnd: 0 });

const appMark = app.markDeckTrace();
const trace = app.getDeckTrace({ since: appMark });
expect(trace).toContainOrderedSubset([
  { kind: "fr-flip", trigger: "activateCard", to: "c2" },
  { kind: "destination-flip", cardId: "c2", to: true },
  { kind: "focus-call", cardId: "c2" },
]);

await app.close();
```

Every waiting assertion wraps `waitForCondition`. Zero `setTimeout` in harness or test code.

##### 2.9 Lifecycle, crashes, and signals {#lifecycle}

See List [#l03-lifecycle-behaviors]. One app launch per test file; stale socket unlink; double-connect refusal; crash mid-test detection; hung-script timeout; SIGINT/SIGTERM handling; log capture to `tests/in-app/logs/<test>.log`.

#### First three in-app tests — Phase 3 {#phase-3-tests}

Pure test authoring against the Phase 2 harness. All tests live under `tests/in-app/`, use `app.click` / `app.type` / `app.focusElement` to drive gestures, and assert against both `__tug` state reads and the deck-trace ring via `toContainOrderedSubset`.

- **m01-tab-switch-fc.test.ts** — seed a pane with two FC cards, activate card A, type "alpha", click tab B, verify B is focused with its own caret state, click back to A, verify A's caret is restored at offset 5 (end of "alpha"). Trace assertion: `[tab-click-driven fr-flip, destination-flip a→false, destination-flip b→true, focus-call b]` then the reverse.
- **m03-pane-activation.test.ts** — seed two panes each with one FC card, focus into A1 (pane 1), click pane 2's title bar, verify A2 becomes the focused card of the deck's active pane, verify A1's caret state was saved via `save-callback` in the trace, click pane 1 again, verify A1's caret restored.
- **m16-tab-close-handoff.test.ts** — seed a pane with three cards [c1, c2, c3], activate c2, click c2's close button, verify c3 becomes the focused card, verify via the trace that no `save-callback` fired for c2 during close (c2 was about to be destroyed), verify c3's caret landed at its declared `bag.focus` target.

**Escape clause.** If Phase 1 reveals `[A3]` is structurally racy ([D13]), Phase 3 tests validate Step 23B's helper-based synchronous path, not the patched `[A3]` path. The test scenarios are the same; the production code under test shifts. Harness and trace support either outcome.

#### Fidelity limits {#fidelity-limits}

The harness is honest about what it cannot test. Putting these limits in writing so we do not quietly paper over them later.

- **`isTrusted: true`-gated browser behaviors.** Synthesized PointerEvent / MouseEvent / InputEvent dispatch sets `isTrusted: false`. Out-of-envelope categories: browser-default focus on mousedown for inputs; WebKit gesture focus-lock semantics (may or may not apply to synthetic events — undocumented); fullscreen requests; clipboard API writes; permissions prompts; IME composition lifecycles. **Mitigation:** for focus specifically, tests call `__tug.focusElement(selector)` directly — our production code does the same via `.focus()`, so the test path matches the production path. For the rest, manual verification remains the fallback. **Escape hatch:** Swift-side `CGEventPost` as follow-on if a specific test demands it ([Q03]).
- **Visual rendering, paint, caret blink.** The harness reads DOM, focus, computed styles, selection state — it cannot assert "the caret is visibly blinking on screen" or "`::selection` highlight painted in the right color." Proxies: `getComputedStyle(el).display !== "none"`, `el.getBoundingClientRect().width > 0`, `document.activeElement === el`, `getSelection().toString() === expected`. Catches most "element not rendered" bugs; does not catch rendering-correctness bugs.
- **User-perceptible timing ("is it snappy?").** Harness measures event-time deltas precisely; "snappy" is subjective and humans-only. Proxy: assert trace-event deltas under a budget (`expect(trace.find(focus-call).timestamp - trace.find(fr-flip).timestamp).toBeLessThan(50)`).
- **Multi-window scenarios.** Current Tug.app is single-window. Harness assumes one WebView. Multi-window is a future concern.
- **Cross-process behavior (tugcode, tugcast).** FC-card tests use no external processes and cover M01/M03/M16 fully. EM-card tests involving tide would need tugcode running. Phase 3 stays in FC-card territory.
- **Safari ≠ WKWebView differences.** The harness runs inside the real Tug.app WKWebView by construction. Safari-in-isolation comparisons are out of scope.

When a bug falls outside the fidelity envelope, we say so, test what we can, and mark the residual as "manual verification required." We do not pretend.

---

### Specification {#specification}

#### Spec S01: `DeckTraceEvent` union {#s01-deck-trace-event}

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

`formatElement(el)` serializes elements as `tag#id.class[data-card-id=foo]`; all `el: string` fields use it. `ActivationTarget` is imported from `focus-transfer.ts`.

#### Spec S02: RPC protocol {#s02-rpc-protocol}

Newline-delimited JSON. Every request has a numeric `id`; response shares the id.

```ts
type Request =
  | { id: number; method: "evalJS";           script: string;                     timeoutMs?: number }
  | { id: number; method: "waitForCondition"; script: string; timeoutMs?: number; pollMs?: number };

type Response<T> =
  | { id: number; ok: true;  value: T }
  | { id: number; ok: false; error: { name: string; message: string; stack?: string } };
```

- **`evalJS`.** Script wrapped server-side in `try/catch`; throws serialize to `ok: false` shape. Non-serializable return values throw inside `JSON.stringify` and land in the same error path. Default timeout 5000ms.
- **`waitForCondition`.** Polls the script until truthy or timeout. Default poll 16ms; default timeout 2000ms. Returns the truthy value.

Standard error `name` values the harness translates to JS error classes: `TimeoutError`, `AppCrashedError`, `VersionSkewError`.

#### Spec S03: `window.__tug` surface {#s03-tug-surface}

Gated by `window.__tugTestMode === true` AND `import.meta.env.DEV`. Version-handshaked on connect ([D11]).

```ts
interface TugTestSurface {
  readonly version: "1.0.0";    // bumped on breaking changes; harness asserts

  // State seeding.
  seedDeckState(args: {
    state: DeckState;
    cardStates?: Record<string, CardStateBag>;
    focusCardId?: string;       // if set, runs the cold-boot restore path against this card
  }): void;

  // Granular reset. Every axis defaults to false.
  reset(opts: {
    deck?: boolean;             // clear DeckState back to empty
    selectionGuard?: boolean;   // clear registered boundaries + selection pins
    orchestrator?: boolean;     // drop component-persistence registries
    trace?: boolean;            // deckTrace.clear() (preserves enable flag)
    storage?: boolean;          // nuke localStorage + scoped IndexedDB
  }): void;

  // Gesture drivers. Tests use these INSTEAD of el.click() so the full
  // pointerdown → pointerup → click sequence fires.
  click(selector: string, opts?: { clientX?: number; clientY?: number; metaKey?: boolean; shiftKey?: boolean }): void;
  type(selector: string, text: string): void;       // native-setter pattern
  focusElement(selector: string): void;             // direct .focus(); for isTrusted-gated fallback

  // State reads. All returns JSON-serializable.
  getActiveCardId(): string | null;
  getFocusedCardId(): string | null;
  getCaretState(cardId: string): {
    kind: "input";
    selectionStart: number; selectionEnd: number; selectionDirection: "forward" | "backward" | "none";
    value: string;
  } | {
    kind: "range";
    anchorPath: readonly number[]; anchorOffset: number;
    focusPath: readonly number[];  focusOffset: number;
    text: string;
  } | null;
  getFormControlValue(cardId: string, persistKey: string): string | null;
  assertHostRootRegistered(cardId: string): boolean;

  // Trace access.
  getDeckTrace(opts?: { since?: number }): readonly DeckTraceEvent[];
  markDeckTrace(): number;
  clearDeckTrace(): void;
  enableDeckTrace(flag: boolean): void;
}
```

Additions require a version bump and a tugplan follow-up.

#### Spec S04: Event synthesis semantics {#s04-event-synthesis}

**`click(selector, opts?)` dispatches, in order:**

1. `new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX, clientY, button: 0, buttons: 1, pointerType: "mouse", pointerId: 1, isPrimary: true, ...modifiers })`
2. `new MouseEvent("mousedown", { ...same base })`
3. `new PointerEvent("pointerup", { ...base, buttons: 0 })`
4. `new MouseEvent("mouseup", { ...base, buttons: 0 })`
5. `new MouseEvent("click", { ...base, buttons: 0 })`

Our production handlers (`pane-focus-controller`, `tug-pane`, close-button, drag-coordinator) respond to JS logic that does not check `event.isTrusted`.

**`type(selector, text)` uses the native-setter pattern:**

```ts
const nativeSetter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")!.set!;
for (const ch of text) {
  nativeSetter.call(el, el.value + ch);
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ch }));
}
```

The native setter is required so React's synthetic-event system sees the change.

**`focusElement(selector)`** calls `el.focus()` directly. Used for paths where synthesized pointerdown cannot drive browser-default focus behavior (see [D09] fidelity limits).

#### Spec S05: `DeckManager.testMode` semantics {#s05-testmode-semantics}

Constructor option `testMode?: boolean` (default false). When true:

- Boot sequence: skip all `GET /dev.tugtool.deck.*` tugbank reads. Initial state is empty `DeckState`.
- Writes: every call to `putLayout`, `putCardState`, `putFocusedCardId` is wrapped in `if (this.testMode) return;`. Fire-and-forget callers see no error; state stays in memory only.
- `seedDeckState(args)`: replaces `this.state` atomically, merges `args.cardStates` into the in-memory cache, runs the cold-boot restore path if `focusCardId` is set.

No globals, no statics. `this.testMode` is read at each tugbank I/O site.

#### Spec S06: Boot choreography ordering contract {#s06-boot-choreography}

See [#boot-choreography] for the full sequence. The ordering contract that matters:

- `window.__tugTestMode` is written by a `WKUserScript` at `atDocumentStart`. This fires BEFORE any tugdeck script tag executes.
- `main.tsx` reads `window.__tugTestMode` at module top level and passes it to `new DeckManager(...)`.
- Bridge socket connect is asynchronous and unrelated to mode decision. Bridge attach timing cannot affect `testMode` value.

Phase 2 tugplan verifies injection timing in a Swift-side test.

#### List L01: Recording sites {#l01-recording-sites}

Every site below records one `deckTrace.record(...)` call, gated by `enable(true)`:

- `deck-manager.ts#_flipFirstResponder` — `fr-flip` after the composite bit changes. Caller passes `trigger` string (`"activateCard"`, `"_removeCard"`, `"_closePane"`, `"_moveCardToPane"`, `"_detachCard"`, `"_addCardToPane"`).
- `deck-trace.ts` destination-flip observer — module-level store subscription; on every notify, diffs `isFocusDestination(cardId)` per card; emits `destination-flip` per flipped card. Cost: O(cards) per notify when enabled, zero when disabled.
- `card-host.tsx` — `card-host-mount` / `card-host-unmount` in the existing root-registration `useLayoutEffect`.
- `card-host.tsx#[A3]` — `a3-fire` EVEN WHEN the effect early-returns. The `earlyReturn` field is the single most important field in the trace.
- `card-host.tsx` cold-boot restore — `focus-call` with `site: "cold-boot"`.
- `card-host.tsx` Step-11 cross-pane effect — `focus-call` with `site: "cross-pane-move"`.
- Every `.focus()` call site (grep `\.focus\(`) — wrapped to emit `focus-call` with site-naming string; `hidden` field computed as `getComputedStyle(el).display === "none" || el.offsetParent === null`.
- `deck-trace.ts` document-level focus observer — `document.addEventListener("focusin" | "focusout", ..., { capture: true })`. Records external focus moves so we see WebKit or third-party reversions.
- `deck-manager.ts#invokeSaveCallback` — `save-callback` with `source` passed by caller. `_closePane` / `_removeCard` pass `"close-handoff"`; debounced timer passes `"debounced"`; `visibilitychange` passes `"visibilitychange"`; `beforeunload` passes `"beforeunload"`.
- `card-host.tsx` selection-restore call sites — `selection-restore` with `via` tagging the entry.
- `<DeckCommitBeacon/>` (new component at deck root) — no-deps `useLayoutEffect` increments counter, records `commit-tick`. Rough timeline of React commits.

#### List L02: Fidelity-limited behaviors {#l02-fidelity-limits}

See [#fidelity-limits] for the full text. Summary of what the harness cannot test: `isTrusted: true`-gated behaviors (browser-default focus on mousedown, gesture focus-lock, fullscreen, clipboard, permissions prompts, IME); visual rendering / caret blink / paint correctness; user-perceptible timing; multi-window scenarios; cross-process behavior; Safari ≠ WKWebView differences.

#### List L03: Lifecycle behaviors {#l03-lifecycle-behaviors}

- One app launch per test file. Tests within a file share the subprocess and reset explicitly per [D01].
- Stale socket files: if socket file exists at target path owned by same user AND no process holds it, harness unlinks before bind. Different owner → hard error.
- Double-connect: Swift accepts one client at a time; second connect gets `ECONNREFUSED`.
- App crash mid-test: harness socket read returns EOF → in-flight RPC rejects with `AppCrashedError`; all pending promises reject; test fails fast.
- Hung script: `evalJS` per-call timeout elapses → harness sends cancellation, logs script; truly stuck subprocess is killed.
- Signals: `process.on("SIGINT" | "SIGTERM")` triggers `app.close()`. `process.on("exit")` does synchronous `kill` as last resort.
- Log capture: Tug.app stdout/stderr routes to `tests/in-app/logs/<test>.log`. On failure, runner prints last 50 lines.

#### Table T01: Example M03 trace {#t01-m03-trace-example}

See [#phase-1-deck-trace] for the worked example. Table represents what a trace dump looks like when `[A3]`'s mount-guard refuses to fire on the newly-activated card.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/deck-trace.ts` | Ring buffer, `DeckTraceEvent` union, `record`/`dump`/`enable`/`mark`/`since`/`clear`/`dumpTable`, destination-flip observer, document-level focus observer, `window.__deckTrace` bindings |
| `tugdeck/src/__tests__/deck-trace.test.ts` | Pure-logic unit tests on the ring buffer (append, evict, since slicing). happy-dom-safe because they test the data structure. |
| `tugdeck/src/components/chrome/deck-commit-beacon.tsx` | `<DeckCommitBeacon/>` component mounted once at deck root; emits `commit-tick` on each React commit |
| `tugdeck/src/test-surface.ts` | `window.__tug` implementation; gated by `import.meta.env.DEV` + `window.__tugTestMode` |
| `tests/in-app/_harness/index.ts` | `launchTugApp`, typed RPC client, `toContainOrderedSubset` matcher, `click`/`type`/`focusElement`/`reset`/`seedDeckState`/`expectFocusedCard`/`expectCaret` wrappers |
| `tests/in-app/_smoke.test.ts` | `launchTugApp → evalJS("1+1") → close` smoke test |
| `tests/in-app/m01-tab-switch-fc.test.ts` | M01 regression test |
| `tests/in-app/m03-pane-activation.test.ts` | M03 regression test |
| `tests/in-app/m16-tab-close-handoff.test.ts` | M16 regression test |
| `tests/in-app/tsconfig.json` | TypeScript config for in-app tests |
| `tests/in-app/logs/` | Directory (gitignored) for per-test Tug.app stdout/stderr capture |
| `roadmap/tugplan-in-app-bridge.md` | Phase 2 tugplan: transport choice, Swift guard placement, WKUserScript ordering, typed RPC client |

#### Modified files {#modified-files}

| File | Change |
|------|--------|
| `tugdeck/src/deck-manager.ts` | Add `testMode?: boolean` constructor option; guard tugbank reads/writes; add `trigger: string` parameter to every `_flipFirstResponder` caller; add `source: "..."` parameter to every `invokeSaveCallback` caller; emit `fr-flip` and `save-callback` trace events |
| `tugdeck/src/components/chrome/card-host.tsx` | Emit `card-host-mount` / `card-host-unmount`; wrap `[A3]` to emit `a3-fire` on every run including early-returns with `earlyReturn` reason; wrap every `.focus()` call site to emit `focus-call`; emit `selection-restore`; mount `<DeckCommitBeacon/>` |
| `tugdeck/src/main.tsx` | Read `window.__tugTestMode` at module top level; pass `testMode: true` to DeckManager constructor when set |
| `tugapp/` | Bridge code gated by `#if DEBUG`; `WKUserScript` for `__tugTestMode` injection at `atDocumentStart`; socket listener; `WKWebViewConfiguration` with Web Inspector enabled in test mode. Specifics in `tugplan-in-app-bridge.md` |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `DeckTraceEvent` | type | `tugdeck/src/deck-trace.ts` | Tagged union (Spec [#s01-deck-trace-event]) |
| `deckTrace` | object | `tugdeck/src/deck-trace.ts` | `record` / `dump` / `dumpTable` / `enable` / `mark` / `since` / `clear` |
| `window.__deckTrace` | global | `tugdeck/src/deck-trace.ts` | Dev-tooling binding |
| `window.__tug` | global | `tugdeck/src/test-surface.ts` | `TugTestSurface` (Spec [#s03-tug-surface]) |
| `window.__tugTestMode` | global | Injected by Swift `WKUserScript` | Read by `main.tsx` at boot |
| `TugTestSurface` | interface | `tugdeck/src/test-surface.ts` | Spec [#s03-tug-surface] |
| `DeckCommitBeacon` | React component | `tugdeck/src/components/chrome/deck-commit-beacon.tsx` | Emits `commit-tick` |
| `DeckManager.testMode` | constructor option | `tugdeck/src/deck-manager.ts` | Spec [#s05-testmode-semantics] |
| `TimeoutError` | class | `tests/in-app/_harness/errors.ts` | RPC error class |
| `AppCrashedError` | class | `tests/in-app/_harness/errors.ts` | RPC error class |
| `VersionSkewError` | class | `tests/in-app/_harness/errors.ts` | RPC error class |
| `launchTugApp` | function | `tests/in-app/_harness/index.ts` | Spawn + connect + handshake |
| `toContainOrderedSubset` | matcher | `tests/in-app/_harness/matchers.ts` | Trace-assertion matcher |
| `_flipFirstResponder` | method | `tugdeck/src/deck-manager.ts` | Gains `trigger: string` parameter |
| `invokeSaveCallback` | method | `tugdeck/src/deck-manager.ts` | Gains `source: string` parameter |

---

### Documentation Plan {#documentation-plan}

- [ ] Update `tugdeck/CLAUDE.md` or a new `tugdeck/DEBUGGING.md` with how to enable `deck-trace` (`window.__deckTrace.enable(true)`, `.dumpTable()`, `.clear()`).
- [ ] Update `tugapp/` README with `--test-harness=<path>` flag and `TUGAPP_TEST_SOCKET` env var — DEBUG-builds only.
- [ ] Add `tests/in-app/README.md` explaining how to write an in-app test: launch, reset, seedDeckState, drive gestures, assert, close.
- [ ] Add memory entry for the happy-dom prohibition (landed at conversation time; recorded here as a checkbox to prevent drift).
- [ ] Update `CLAUDE.md` at project root with a pointer to this plan and the in-app test harness as the canonical test surface for focus/selection/caret behavior.
- [ ] `roadmap/tugplan-in-app-bridge.md` (authored in Step 4) is the Phase 2 detailed plan; this plan links to it from `#phase-2-bridge`.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (happy-dom allowed)** | Test pure data structures and pure selectors | Ring buffer, DeckTraceEvent serialization, matcher logic |
| **In-app integration (real WKWebView)** | Test behavior inside the real runtime | Focus, selection, caret, activation, lifecycle — everything Phase 3 covers |
| **Golden / Contract** | Pin wire-protocol shapes | `DeckTraceEvent` JSON shape; RPC request/response shape; `__tug.version` handshake |
| **Drift Prevention** | Detect behavior regressions | Each Phase 3 test must fail predictably when its target fix is reverted; hand-verified at Step 16 |

**What we do not use:**
- happy-dom for any UI / focus / selection / DOM-timing behavior. Codified in feedback memory; enforced at review.
- Playwright or any non-WKWebView browser driver for anything.
- Mock `DeckManager` / `Store` classes for in-app tests. Real DeckManager inside real app.

---

### Execution Steps {#execution-steps}

Sixteen flat steps covering three phases with one integration checkpoint per phase. Every step has an explicit commit boundary and checkpoint. **Commit after all checkpoints pass.**

#### Step 1: Scaffold `deck-trace.ts` module {#step-1}

**Commit:** `feat(deck-trace): scaffold ring buffer module with DeckTraceEvent union`

**References:** [D06] deck-trace scope, Spec [#s01-deck-trace-event], (#phase-1-deck-trace)

**Artifacts:**
- `tugdeck/src/deck-trace.ts` — module exporting `deckTrace.record` / `.dump` / `.dumpTable` / `.enable` / `.mark` / `.since` / `.clear`, and `window.__deckTrace` binding. Module has no recording sites wired yet.
- `tugdeck/src/__tests__/deck-trace.test.ts` — pure-logic tests on ring buffer (append-and-evict at capacity, `since(seq)` slicing, `enable(false)` no-op, `mark()` sequence).

**Tasks:**
- [ ] Define `DeckTraceEvent` tagged union per Spec [#s01-deck-trace-event].
- [ ] Implement bounded ring (cap 512), oldest-evicted.
- [ ] Implement `record` (bounds-check + append); no-op fast path when `enable(false)`.
- [ ] Implement `dump` / `dumpTable` / `enable` / `mark` / `since` / `clear`.
- [ ] Wire `window.__deckTrace` bindings.
- [ ] Gate everything behind `import.meta.env.DEV` so release bundles tree-shake the module.

**Tests:**
- [ ] Ring appends events up to 512; the 513th evicts the oldest.
- [ ] `since(seq)` returns only events with `seq > that`.
- [ ] With `enable(false)`, `record(event)` is a no-op and `dump()` returns empty.
- [ ] `mark()` returns the current sequence counter.

**Checkpoint:**
- [ ] `bun x tsc --noEmit` exits 0 in tugdeck/.
- [ ] `bun test src/__tests__/deck-trace.test.ts` passes.
- [ ] `grep -r 'window.__deckTrace' tugdeck/src/` shows the binding is present only behind `import.meta.env.DEV`.

---

#### Step 2: Wire all deck-trace recording sites {#step-2}

**Depends on:** #step-1

**Commit:** `feat(deck-trace): wire instrumentation call sites across deck-manager and card-host`

**References:** [D06] deck-trace scope, [D13] Phase 1 exit, List [#l01-recording-sites], (#phase-1-deck-trace)

**Artifacts:**
- `tugdeck/src/deck-manager.ts` — `_flipFirstResponder` and `invokeSaveCallback` gain caller-provided `trigger` / `source` parameters; each call site passes a descriptive string. Trace events emitted inside the methods.
- `tugdeck/src/components/chrome/card-host.tsx` — mount/unmount records; `[A3]` wrapped to emit `a3-fire` on every run with `earlyReturn` tag; every `.focus()` site wrapped; `selection-restore` records at both entries.
- `tugdeck/src/components/chrome/deck-commit-beacon.tsx` — new `<DeckCommitBeacon/>` component, mounted once at deck root; emits `commit-tick`.
- `tugdeck/src/deck-trace.ts` — destination-flip observer (store subscription, per-card diff); document-level `focusin`/`focusout` observer (capture phase).
- DeckCanvas or whichever component mounts the deck root wires `<DeckCommitBeacon/>` in.

**Tasks:**
- [ ] Add `trigger: string` parameter to `_flipFirstResponder`; update every internal caller (`activateCard`, `_removeCard`, `_closePane`, `_moveCardToPane`, `_detachCard`, `_addCardToPane`).
- [ ] Emit `fr-flip` after the composite bit changes.
- [ ] Add `source: string` parameter to `invokeSaveCallback`; update callers (`_closePane` / `_removeCard` → `"close-handoff"`; debounced timer → `"debounced"`; visibilitychange handler → `"visibilitychange"`; beforeunload → `"beforeunload"`).
- [ ] Emit `save-callback` inside `invokeSaveCallback`.
- [ ] Install destination-flip observer in `deck-trace.ts`: subscribe to store, diff `isFocusDestination(cardId)` per card on each notify, emit `destination-flip` for flipped cards. Gated by `enable(true)`.
- [ ] Install document-level `focusin`/`focusout` observer in `deck-trace.ts`. Gated by `enable(true)`.
- [ ] Emit `card-host-mount` / `card-host-unmount` in `CardHost`'s root-registration `useLayoutEffect`.
- [ ] Wrap `[A3]` effect body to emit `a3-fire` on every run, recording `isFirstRun`, `prev`, `now`, `earlyReturn` reason (`null` if the body completed), `gatePassed`, `target` from `resolveActivationTarget`, and `focusedEl` (or null).
- [ ] Wrap every `.focus()` call site in `card-host.tsx` to emit `focus-call` with site name, target selector, activeBefore/activeAfter, and `hidden` computed field.
- [ ] Emit `selection-restore` at each entry (`restoreCardDomSelection` in `[A3]` DOM-authority branch; `applyFocusSnapshot` in cold-boot).
- [ ] Create `<DeckCommitBeacon/>` component with no-deps `useLayoutEffect` that increments a counter and records `commit-tick`.
- [ ] Mount `<DeckCommitBeacon/>` at the deck root.

**Tests:**
- [ ] No new tests in this commit. (This is observational code; per [D10] we do not pretend happy-dom can verify focus/DOM behavior.)
- [ ] Existing tugdeck test suite continues to pass: `bun test` in tugdeck exits 0 against all 2419 previous tests (or updated count if any were touched for the `trigger` / `source` parameters).

**Checkpoint:**
- [ ] `bun x tsc --noEmit` exits 0 in tugdeck/.
- [ ] `bun test` in tugdeck exits 0.
- [ ] Dev-mode manual smoke: run tugdeck dev server, open devtools, run `window.__deckTrace.enable(true); __deckTrace.mark(); /* interact */; __deckTrace.dumpTable()`; verify at least one event of each expected kind appears after interacting with panes/cards.
- [ ] `grep 'deckTrace.record' tugdeck/src/` shows call sites in `deck-manager.ts`, `card-host.tsx`, `deck-trace.ts` (observers), `deck-commit-beacon.tsx`.

---

#### Step 3: Phase 1 Integration Checkpoint — reproduce M01/M03/M16 with trace {#step-3}

**Depends on:** #step-2

**Commit:** `N/A (verification only)`

**References:** [D13] Phase 1 exit criterion, Table [#t01-m03-trace-example], (#phase-1-deck-trace)

**Tasks:**
- [ ] Launch Tug.app (dev build). Open Safari Web Inspector.
- [ ] Run `window.__deckTrace.enable(true); window.__deckTrace.clear()`.
- [ ] Reproduce M01 (intra-pane tab switch on an FC card). `window.__deckTrace.dumpTable()`. Capture output.
- [ ] `window.__deckTrace.clear()`. Reproduce M03 (pane-chrome activation click). `dumpTable()`. Capture output.
- [ ] `window.__deckTrace.clear()`. Reproduce M16 (tab-close handoff). `dumpTable()`. Capture output.
- [ ] State the root-cause hypothesis in writing (in the conversation or a notes file). Confirm whether `[A3]` is patchable or structurally racy.
- [ ] If `[A3]` is structurally racy per the trace, plan proceeds to accelerate Step 23B's helper-based synchronous dispatch. Otherwise, plan a patch to `[A3]`'s mount-guard. Either outcome is consistent with [D13].

**Tests:**
- [ ] N/A — observational checkpoint.

**Checkpoint:**
- [ ] Three trace dumps captured.
- [ ] Root-cause hypothesis written.
- [ ] Decision made: patch `[A3]` OR accelerate 23B. Choice carries forward to Phase 3 test assertions.

---

#### Step 4: Author Phase 2 tugplan — `roadmap/tugplan-in-app-bridge.md` {#step-4}

**Depends on:** #step-3

**Commit:** `plan(in-app-bridge): author phase 2 tugplan for test bridge`

**References:** [D03] DEBUG-only guard, [D04] transport investigation, [D08] boot timing, [D09] event synthesis, [D10] fidelity limits, [#boot-choreography], (#phase-2-bridge, #transport-and-guards, #fidelity-limits)

**Artifacts:**
- `roadmap/tugplan-in-app-bridge.md` — tugplan-skeleton-conformant plan covering Swift bridge, TypeScript surface, transport choice, exact guard placement.

**Tasks:**
- [ ] Investigation task 1: assess tugcast transport reuse. Concrete read of tugcast's WebSocket multiplexer, verify whether DEBUG-only gating stays clean under reuse. Write result into the tugplan ([Q01]/[D04]).
- [ ] Design decision on transport (reuse tugcast OR parallel Unix socket).
- [ ] Specify exact `#if DEBUG` placement at file level in tugapp/ — every bridge-touching source file.
- [ ] Specify `WKUserScript` injection timing verification test — a Swift-side unit test that `__tugTestMode` is readable before tugdeck's first script tag evaluates.
- [ ] Decide [Q02]: whether T-1/T-2 move to Phase 1 or stay in Phase 2.
- [ ] Specify typed RPC client shape (hand-written vs codegen) and `TimeoutError` / `AppCrashedError` / `VersionSkewError` class definitions.
- [ ] Specify socket-path security (mode 0600, parent-dir ownership, stale-unlink policy).
- [ ] Specify `tests/in-app/` config (tsconfig, bun test glob, exclude from tugdeck suite, log directory).
- [ ] Declare hardware-event fallback (`CGEventPost`) as a deferred follow-up per [Q03].

**Tests:**
- [ ] Plan doc validates via `tugutil validate roadmap/tugplan-in-app-bridge.md` (no structural errors).

**Checkpoint:**
- [ ] `roadmap/tugplan-in-app-bridge.md` exists with all skeleton-required sections.
- [ ] `tugutil validate` passes.
- [ ] Transport decision recorded.

---

#### Step 5: `DeckManager.testMode` constructor flag {#step-5}

**Depends on:** #step-4

**Commit:** `feat(deck-manager): add testMode flag bypassing tugbank reads and writes`

**References:** [D02] testMode flag, [D08] boot timing, Spec [#s05-testmode-semantics], (#deckmanager-testmode)

**Artifacts:**
- `tugdeck/src/deck-manager.ts` — `testMode?: boolean` constructor option; `this.testMode` guard at every tugbank I/O site; `seedDeckState(args)` method on the class.

**Tasks:**
- [ ] Add `testMode?: boolean` parameter to `DeckManager` constructor (default false).
- [ ] Guard boot-sequence tugbank reads behind `if (this.testMode) { /* start empty */ } else { /* existing read path */ }`.
- [ ] Wrap every tugbank write (`putLayout`, `putCardState`, `putFocusedCardId`) in `if (this.testMode) return;`.
- [ ] Add `seedDeckState(args)` method: replace `this.state` atomically, merge `args.cardStates` into the in-memory cache, run the cold-boot restore path if `args.focusCardId` is set. Notify subscribers.
- [ ] Update `tugdeck/src/main.tsx` to read `window.__tugTestMode` (gated by `import.meta.env.DEV`) and pass `testMode: true` when set.
- [ ] Update mock stores (`mock-deck-manager-store.ts` and per-test Store classes) if the construction path is exposed through them — likely just new optional fields, no behavior change.

**Tests:**
- [ ] Unit test (happy-dom allowed for pure-logic on the flag): `new DeckManager({ testMode: true })` does not issue a fetch for `dev.tugtool.deck.layout`; does not issue `putLayout` on state change.
- [ ] Unit test: `seedDeckState({ state, cardStates, focusCardId })` atomically replaces state and fires subscribers.

**Checkpoint:**
- [ ] `bun x tsc --noEmit` exits 0.
- [ ] `bun test` in tugdeck exits 0.
- [ ] `grep 'this.testMode' tugdeck/src/deck-manager.ts` shows the guard at every tugbank I/O site.

---

#### Step 6: `window.__tug` surface scaffold (read + command methods) {#step-6}

**Depends on:** #step-5

**Commit:** `feat(test-surface): scaffold window.__tug surface gated by testMode`

**References:** [D01] per-test isolation, [D03] DEBUG-only, [D11] versioning, Spec [#s03-tug-surface], (#tug-surface, #granular-reset)

**Artifacts:**
- `tugdeck/src/test-surface.ts` — implements `TugTestSurface` interface; attaches to `window.__tug` only when `import.meta.env.DEV && window.__tugTestMode === true`.

**Tasks:**
- [ ] Author `TugTestSurface` TypeScript interface per Spec [#s03-tug-surface]. Export from `test-surface.ts`.
- [ ] Implement `version`, `seedDeckState`, `reset`, `click`, `type`, `focusElement`, `getActiveCardId`, `getFocusedCardId`, `getCaretState`, `getFormControlValue`, `assertHostRootRegistered`, `getDeckTrace`, `markDeckTrace`, `clearDeckTrace`, `enableDeckTrace`.
- [ ] `click` follows the full dispatch order per Spec [#s04-event-synthesis].
- [ ] `type` uses the native-setter pattern per Spec [#s04-event-synthesis].
- [ ] `focusElement` calls `el.focus()` directly.
- [ ] `reset` implements axis granularity per [D01]: per-axis effect functions, each idempotent.
- [ ] Attach surface in `main.tsx` conditional: `if (import.meta.env.DEV && window.__tugTestMode === true) { window.__tug = createTugTestSurface(store); }`.

**Tests:**
- [ ] No new happy-dom UI tests. Surface is exercised end-to-end by Phase 3 in-app tests.

**Checkpoint:**
- [ ] `bun x tsc --noEmit` exits 0.
- [ ] Grep: `window.__tug` only written inside `import.meta.env.DEV` + `__tugTestMode` gate.

---

#### Step 7: Transport + first `evalJS` round-trip {#step-7}

**Depends on:** #step-6

**Commit:** `feat(tugapp): add test-harness bridge with evalJS RPC (DEBUG-only)`

**References:** [D03] DEBUG-only, [D04] transport choice, Spec [#s02-rpc-protocol], (#phase-2-bridge, #transport-and-guards)

**Artifacts:**
- Swift code in `tugapp/` (per `tugplan-in-app-bridge.md` decision): env-var detection, transport listener, `evalJS` RPC handler, `WKUserScript` for `__tugTestMode` injection, Web Inspector enablement. All gated behind `#if DEBUG`.
- `tests/in-app/_harness/index.ts` — `launchTugApp` spawns subprocess, connects, performs a raw `evalJS` call.
- `tests/in-app/_smoke.test.ts` — single smoke test: `launchTugApp → evalJS("1 + 1") → close`; expects `2`.
- `tests/in-app/tsconfig.json`, `tests/in-app/.gitignore` (excludes `logs/`).

**Tasks:**
- [ ] Implement Swift-side env-var detection and socket (or tugcast channel) listener per tugplan choice.
- [ ] Install `WKUserScript` at `atDocumentStart` injecting `window.__tugTestMode = true` when in test mode.
- [ ] Enable Web Inspector (`configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")`) in test mode.
- [ ] Implement `evalJS` handler: wrap in try/catch, serialize throws, enforce default 5000ms timeout.
- [ ] Ensure every bridge source file is inside `#if DEBUG ... #endif`.
- [ ] Implement minimal bun harness: `launchTugApp` (subprocess spawn, socket connect with bounded retry), raw `evalJS` call, `close`.
- [ ] Configure `tests/in-app/` — tsconfig, bun test glob, exclusion from tugdeck test run.

**Tests:**
- [ ] `tests/in-app/_smoke.test.ts`: launch, `evalJS("1 + 1") === 2`, close. Passes.
- [ ] Manual check: `xcodebuild archive` of tugapp/ Release config produces a binary with no bridge symbols (verify via `nm` or equivalent).

**Checkpoint:**
- [ ] `bun test tests/in-app/_smoke.test.ts` exits 0.
- [ ] `tugdeck`'s own `bun test` still exits 0 (no regression).
- [ ] Release-build binary size diff from pre-plan baseline within noise threshold (verify via `wc -c`).
- [ ] `grep -n 'TUGAPP_TEST_SOCKET' tugapp/` shows only DEBUG-guarded references.

---

#### Step 8: `waitForCondition` primitive + structured errors + timeouts {#step-8}

**Depends on:** #step-7

**Commit:** `feat(tugapp-bridge): add waitForCondition primitive and structured error responses`

**References:** [D07] RPC error model, [D12] waitForCondition, Spec [#s02-rpc-protocol], (#rpc-protocol)

**Artifacts:**
- Swift-side `waitForCondition` handler implementing the polling loop per Spec [#s02-rpc-protocol].
- `tests/in-app/_harness/errors.ts` — `TimeoutError`, `AppCrashedError`, `VersionSkewError` classes.
- Harness client translates `ok: false` responses into the matching thrown error class.

**Tasks:**
- [ ] Implement `waitForCondition(script, timeoutMs?, pollMs?)` in Swift: poll the script at `pollMs` intervals (default 16ms) until truthy or timeout (default 2000ms). Returns the truthy value on success; serializes `{ name: "TimeoutError", ... }` on timeout.
- [ ] Enforce `evalJS` per-call timeout server-side; return `{ name: "TimeoutError", ... }` on elapse.
- [ ] Extend harness RPC client: on `ok: false` response, map `error.name` to `TimeoutError` / `AppCrashedError` / other; throw. Preserve `stack` for debugging.
- [ ] Add `AppCrashedError` handling: harness socket read returning EOF rejects in-flight RPC with `AppCrashedError`.

**Tests:**
- [ ] In-app test: `evalJS` that throws returns an error the client throws as an Error with matching `name`/`message`.
- [ ] In-app test: `waitForCondition` that never returns truthy times out at configured `timeoutMs`; harness client throws `TimeoutError`.
- [ ] In-app test: `waitForCondition` for an immediately-truthy expression returns the value.

**Checkpoint:**
- [ ] `bun test tests/in-app/` exits 0.
- [ ] Three new in-app smoke tests pass: eval-error, condition-timeout, condition-immediate.

---

#### Step 9: Version handshake + lifecycle + log capture {#step-9}

**Depends on:** #step-8

**Commit:** `feat(tugapp-bridge): add version handshake, crash detection, signal handling, log capture`

**References:** [D11] version handshake, List [#l03-lifecycle-behaviors], (#lifecycle)

**Artifacts:**
- Harness client version-handshakes on connect; throws `VersionSkewError` on mismatch.
- Stale-socket unlink and double-connect refusal (Swift side).
- Signal handling in harness (`SIGINT` / `SIGTERM` / `exit`).
- Per-test log capture to `tests/in-app/logs/<test>.log`.

**Tasks:**
- [ ] Add `version` handshake: first message after connect asserts `__tug.version === EXPECTED_VERSION`; mismatch throws `VersionSkewError`.
- [ ] Swift-side: stale socket file check (owned by current user + no process holding it → unlink; different owner → hard error).
- [ ] Swift-side: accept only one client at a time; second connect gets `ECONNREFUSED`.
- [ ] Harness-side: `process.on("SIGINT" | "SIGTERM")` triggers `app.close()`; `process.on("exit")` does a synchronous subprocess kill as last resort.
- [ ] Harness-side: route Tug.app stdout/stderr to `tests/in-app/logs/<test>.log`.
- [ ] On test failure, runner prints the last 50 lines of the log.

**Tests:**
- [ ] Version-skew test: harness with wrong expected version → throws `VersionSkewError`.
- [ ] Double-connect test: second harness client hits `ECONNREFUSED`.
- [ ] Log-capture test: `evalJS("console.log('test log')"); close;` then verify the log file contains the line.

**Checkpoint:**
- [ ] `bun test tests/in-app/` exits 0.
- [ ] Three new in-app tests (version-skew, double-connect, log-capture) pass.

---

#### Step 10: Bun harness library wrappers {#step-10}

**Depends on:** #step-9

**Commit:** `feat(tests-in-app): build typed harness library with gesture and assertion wrappers`

**References:** Spec [#s03-tug-surface], Spec [#s04-event-synthesis], (#harness-library)

**Artifacts:**
- `tests/in-app/_harness/index.ts` exports `launchTugApp`, typed client.
- `tests/in-app/_harness/client.ts` — typed wrappers: `click`, `type`, `focusElement`, `reset`, `seedDeckState`, `expectFocusedCard`, `expectCaret`, `getDeckTrace`, `markDeckTrace`, etc.
- `tests/in-app/_harness/matchers.ts` — `toContainOrderedSubset` matcher for trace assertions.
- No-`setTimeout` lint rule in the harness tsconfig/eslint config.

**Tasks:**
- [ ] Implement typed wrappers around `evalJS` / `waitForCondition` per Spec [#s03-tug-surface] shapes.
- [ ] Implement `expectFocusedCard(cardId)` as `waitForCondition` on `__tug.getFocusedCardId() === cardId` with a timeout.
- [ ] Implement `expectCaret(cardId, expected)` as `waitForCondition` on deep-equal of `getCaretState`.
- [ ] Implement `toContainOrderedSubset` matcher: asserts the ordered subset appears in the trace. Partial-match on each entry (keys that are specified must match; unspecified keys are wildcards).
- [ ] Add no-`setTimeout`/`setInterval` eslint rule for `tests/in-app/`.

**Tests:**
- [ ] Harness-internal tests (pure-logic, happy-dom allowed): `toContainOrderedSubset` returns true for an in-order subset, false for out-of-order or missing entries.

**Checkpoint:**
- [ ] `bun x tsc --noEmit` exits 0 for `tests/in-app/`.
- [ ] `toContainOrderedSubset` unit tests pass.
- [ ] Lint check: no `setTimeout`/`setInterval` usage in `tests/in-app/`.

---

#### Step 11: Phase 2 Integration Checkpoint {#step-11}

**Depends on:** #step-7, #step-8, #step-9, #step-10

**Commit:** `N/A (verification only)`

**References:** Success criteria [#success-criteria], (#phase-2-bridge)

**Tasks:**
- [ ] Verify all Phase 2 artifacts exist: `deck-trace.ts` recording, `DeckManager.testMode`, `window.__tug` surface, transport + RPC + errors, version handshake + lifecycle, harness library.
- [ ] Verify release-build binary size vs pre-plan baseline within noise threshold.
- [ ] Manual Xcode archive pass: verify the archived binary has no bridge symbols (via `nm` or equivalent).
- [ ] Verify dev-mode behavior: tugdeck boots normally when `TUGAPP_TEST_SOCKET` is unset.
- [ ] Verify test-mode behavior: set `TUGAPP_TEST_SOCKET`, launch Tug.app manually, inspect `window.__tug` presence, run one `evalJS` via the harness.

**Tests:**
- [ ] `bun test tests/in-app/_smoke.test.ts` exits 0.
- [ ] Aggregate: all prior in-app tests (eval-error, condition-timeout, condition-immediate, version-skew, double-connect, log-capture) pass.

**Checkpoint:**
- [ ] `bun test tests/in-app/` exits 0.
- [ ] Binary-size diff recorded and within budget.
- [ ] Manual archive inspection clean.

---

#### Step 12: `tests/in-app/` scaffold + trivial smoke tests {#step-12}

**Depends on:** #step-11

**Commit:** `feat(tests-in-app): finalize harness config and add smoke test`

**References:** [D05] tests at root, (#phase-3-tests)

**Artifacts:**
- `tests/in-app/README.md` — how to write an in-app test.
- `tests/in-app/_smoke.test.ts` — already in place from Step 7; retained as the canonical first test.
- `tests/in-app/tsconfig.json`, path aliases, bun test glob, exclusion from tugdeck suite.

**Tasks:**
- [ ] Author `tests/in-app/README.md` covering: run command (`bun test tests/in-app/`), lifecycle model (one app per file, explicit reset), fidelity envelope pointer to [#fidelity-limits], how to add a new test.
- [ ] Verify `tests/in-app/` is excluded from `tugdeck`'s own `bun test` run (check `tugdeck/bunfig.toml` or equivalent test config).
- [ ] Confirm `tests/in-app/logs/` is gitignored.

**Tests:**
- [ ] `bun test tests/in-app/_smoke.test.ts` exits 0 (already green from Step 7; re-verified here).

**Checkpoint:**
- [ ] `bun test tests/in-app/` exits 0.
- [ ] `bun test` in tugdeck exits 0 and does not attempt to load files under `tests/in-app/`.
- [ ] README.md present and readable.

---

#### Step 13: M01 test — intra-pane tab switch (FC) {#step-13}

**Depends on:** #step-12

**Commit:** `test(in-app): add m01-tab-switch-fc covering intra-pane tab switch`

**References:** [D13] Phase 1 exit drives target fix, Spec [#s03-tug-surface], (#phase-3-tests)

**Artifacts:**
- `tests/in-app/m01-tab-switch-fc.test.ts`.

**Tasks:**
- [ ] Seed a pane with two FC cards (cards with `data-tug-persist-value` / `data-tug-focus-key` probes).
- [ ] Activate card A, type "alpha", click tab B.
- [ ] Assert B is focused (via `expectFocusedCard`) with its own caret state.
- [ ] Click back to A.
- [ ] Assert A's caret restored at offset 5 (end of "alpha") via `expectCaret`.
- [ ] Ordered-subsequence trace assertion: `[fr-flip to A, destination-flip a→true, focus-call a]`, then `[fr-flip to B, destination-flip b→true, focus-call b]`, then `[fr-flip to A, destination-flip a→true, focus-call a]` for the return.

**Tests:**
- [ ] `m01-tab-switch-fc.test.ts` exits 0 against the code with the M-series fix applied.

**Checkpoint:**
- [ ] `bun test tests/in-app/m01-tab-switch-fc.test.ts` exits 0.

---

#### Step 14: M03 test — pane-chrome activation {#step-14}

**Depends on:** #step-13

**Commit:** `test(in-app): add m03-pane-activation covering pane-chrome click handoff`

**References:** (#phase-3-tests)

**Artifacts:**
- `tests/in-app/m03-pane-activation.test.ts`.

**Tasks:**
- [ ] Seed two panes each with one FC card (A1 in p1, A2 in p2).
- [ ] Focus into A1 (pane 1 is active, A1 is focus destination).
- [ ] Click pane 2's title bar via `app.click('[data-pane-id="p2"] [data-testid="pane-title"]')`.
- [ ] Assert A2 is the focused card of the deck's active pane (via `expectFocusedCard`).
- [ ] Assert A1's state was saved: trace contains `save-callback { cardId: "A1", source: "..." }` between the click and the `fr-flip`.
- [ ] Click pane 1 again.
- [ ] Assert A1's caret restored at its saved offset.

**Tests:**
- [ ] `m03-pane-activation.test.ts` exits 0.

**Checkpoint:**
- [ ] `bun test tests/in-app/m03-pane-activation.test.ts` exits 0.

---

#### Step 15: M16 test — tab-close handoff {#step-15}

**Depends on:** #step-14

**Commit:** `test(in-app): add m16-tab-close-handoff covering active-tab close`

**References:** (#phase-3-tests)

**Artifacts:**
- `tests/in-app/m16-tab-close-handoff.test.ts`.

**Tasks:**
- [ ] Seed a pane with three cards [c1, c2, c3].
- [ ] Activate c2.
- [ ] Click c2's close button via `app.click('[data-card-id="c2"] [data-testid="close-button"]')` (or the equivalent selector per actual tug-pane close-button markup).
- [ ] Assert c3 (the documented handoff target) is the focused card.
- [ ] Assert via the trace that NO `save-callback` event fired for `cardId: "c2"` during the close (c2 was about to be destroyed; saving its state is wasted work).
- [ ] Assert c3's caret landed at its declared `bag.focus` target (via `expectCaret`).

**Tests:**
- [ ] `m16-tab-close-handoff.test.ts` exits 0.

**Checkpoint:**
- [ ] `bun test tests/in-app/m16-tab-close-handoff.test.ts` exits 0.

---

#### Step 16: Phase 3 Integration Checkpoint — drift-prevention exercise {#step-16}

**Depends on:** #step-13, #step-14, #step-15

**Commit:** `N/A (verification only)`

**References:** Success criteria [#success-criteria], (#phase-3-tests)

**Tasks:**
- [ ] Run `bun test tests/in-app/`; confirm all three M-series tests pass.
- [ ] Drift-prevention exercise: for each of m01/m03/m16, by hand revert the target fix locally, re-run the test, verify it fails. Revert the revert. Document the outcome in a notes file or conversation.
- [ ] Confirm no new happy-dom tests were added in the plan's commits (grep review).
- [ ] Confirm release-build binary size unchanged vs pre-plan baseline.
- [ ] Update this doc's Status from `draft` to `active`.
- [ ] Update plan-doc-hygiene section to point at `tugplan-in-app-bridge.md` now that it exists.

**Tests:**
- [ ] Aggregate: `bun test tests/in-app/` exits 0 with all three M-series tests plus smoke/eval-error/condition-timeout/condition-immediate/version-skew/double-connect/log-capture.

**Checkpoint:**
- [ ] `bun test tests/in-app/` exits 0.
- [ ] Drift-prevention verified for all three tests.
- [ ] Status updated.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A DEBUG-build-only test harness that launches Tug.app in a subprocess, drives the real WKWebView via an RPC bridge, and asserts against real focus/selection/caret state — plus three M-series regression tests that bind the current fixes in place. Release builds are untouched.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] `deck-trace.ts` lives in tugdeck/, instruments the whole deck, and `window.__deckTrace.enable(true); ... .dumpTable()` produces usable traces in the live dev app.
- [ ] `roadmap/tugplan-in-app-bridge.md` is written, reviewed, and referenced from this plan's §2.
- [ ] `TUGAPP_TEST_SOCKET=...` env var launches Tug.app in test mode; `evalJS("1+1")` from a bun harness script returns 2.
- [ ] `window.__tug` surface is attached only when `import.meta.env.DEV && window.__tugTestMode === true`.
- [ ] `tests/in-app/m01-tab-switch-fc.test.ts`, `m03-pane-activation.test.ts`, `m16-tab-close-handoff.test.ts` all pass.
- [ ] Each of the three M-series tests fails predictably when its target fix is reverted.
- [ ] Release-build binary size unchanged vs pre-plan baseline (within noise).
- [ ] Zero new happy-dom tests for UI / focus / selection / DOM-timing behavior.
- [ ] Feedback memory for "no happy-dom tests" is present and referenced from project CLAUDE.md.

**Acceptance tests:**
- [ ] `bun test tests/in-app/` exits 0.
- [ ] `bun test` in tugdeck exits 0 (no regression from instrumentation or `testMode` flag).
- [ ] `bun x tsc --noEmit` exits 0 in both tugdeck/ and tests/in-app/.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Widen Phase 3 coverage to M02, M05, M15, and the remaining M-series scenarios.
- [ ] CI integration: `bun test tests/in-app/` on macOS runner, gated by a test-mode-only build artifact.
- [ ] `CGEventPost` hardware-event fallback (per [Q03] — if a test demands it).
- [ ] EM-card harness support (tugcode running, stream-json IPC exercised).
- [ ] Multi-window test harness support (if Tug.app gains multi-window).
- [ ] Retire `[A3]` from `card-host.tsx` entirely once Step 23B's helper-based path is load-bearing (if Phase 1 revealed the structural race per [D13]).

| Checkpoint | Verification |
|------------|--------------|
| Phase 1 traces captured | Conversation / notes file with M01/M03/M16 trace dumps |
| `evalJS("1+1") === 2` | `bun test tests/in-app/_smoke.test.ts` exits 0 |
| M01/M03/M16 tests green | `bun test tests/in-app/m*.test.ts` exits 0 |
| Drift-prevention verified | Manual revert-and-retest documented in Step 16 |
| Release binary unchanged | `wc -c` diff within noise threshold; `nm` inspection shows no bridge symbols |

---
