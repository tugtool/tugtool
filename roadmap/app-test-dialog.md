## App-test approval dialog — informed consent before a disruptive run {#app-test-dialog}

**Purpose:** Make an app-test invocation that will seize the screen ask first, through a session-inline `TugInlineDialog` offering *run all* / *run background-only* / *cancel*, so the session enters Awaiting and the developer decides; runs that stay in the background continue to need no attention at all.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-08-01 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

App-tests now run in the background by default. `TUGAPP_NATIVE_EVENT_MODE=pid` makes the in-app harness address keyboard events to its own process (`CGEvent.postToPid`) and dispatch mouse events straight into the window as synthesized `NSEvent`s (`window.sendEvent`), the app boots as an accessory (`NSApp.setActivationPolicy(.accessory)`) so it never self-activates, and the harness launches it with `open -g`. A run no longer takes the developer's focus, cursor, or key window. That work is landed-but-uncommitted in the working tree across `tugapp/Sources/TestHarness/NativeEventHandlers.swift`, `tugapp/Sources/AppDelegate.swift`, `tugapp/Sources/MainWindow.swift`, `tests/app-test/_harness/index.ts`, and `tests/app-test/_harness/types.ts`.

A minority of tests cannot work that way. Their subject *is* activation — app resign / become-active cycles, key-window-gated responder routing, `document.hasFocus()` (which WebKit ties to application activation, not key-window status; an experiment that made the window key without activating did not restore it and broke `at0201`'s activation-click semantics). Those tests opt back in with `launchTugApp({ foreground: true })`, which sets `TUGAPP_NATIVE_EVENT_MODE=session` and drops the `-g` flag. They still take the screen, and today they do it without warning: a run that happens to include one interrupts whatever the developer is doing, mid-thought, with no signal beforehand. This plan puts a decision point in front of exactly those runs and leaves every other run untouched.

#### Strategy {#strategy}

- Make "this test steals focus" a **declared, checkable fact** (`@foreground` in the header docblock) rather than something inferred by grepping for a launch option, so the gate has a cheap and reliable input and the declaration cannot silently drift from behavior.
- Reuse the existing blocking CLI→deck→CLI round trip. `POST /api/eval` already does exactly this shape; `/api/ask` copies its machinery rather than inventing a second one.
- Reuse the existing inline-dialog primitive. `TugInlineDialog` already carries icon + title + description + a mandatory-single-select `options` radio group — the three-way choice is a natural fit, so **no new primitive is authored**.
- Ask **before** taking the machine-wide app-test gate, never while holding it, so a run waiting on a human does not block another worktree's run.
- Fail **open** where blocking would be worse than proceeding (no deck reachable, no session) and **closed** where ambiguity is dangerous (timeout, deck disconnect → treat as cancel).
- Land in dependency order — declaration, transport, CLI, deck store, component, wiring, recipe — with each step independently checkpointable.

#### Success Criteria (Measurable) {#success-criteria}

- Running a selection containing **no** `@foreground` test never contacts the deck and never prompts (verify: `just app-test at0001-tab-switch-fc.test.ts` completes with no dialog; `grep` the tugcast log for `/api/ask` shows no request).
- Running a selection containing **at least one** `@foreground` test raises the dialog and blocks until answered (verify: `just app-test at0145-permission-dialog-keyboard.test.ts` stalls before the first app launch; the Session card shows the dialog).
- While the dialog is pending the session reports the Awaiting phase (verify: `codeSessionStore.getSnapshot().phase === "awaiting_approval"` via the dev panel or `app.evalJS`).
- Choosing **Run background-only** runs the selection minus the `@foreground` files, and names the skipped files on stderr (verify: run a mixed selection; summary file count equals selection minus skipped; stderr lists them).
- Choosing **Cancel** exits non-zero without launching any app (verify: exit code is non-zero; no `Tug-apptest` process was spawned; `VERDICT:` line absent).
- The declaration cannot drift: a test with `foreground: true` at a launch site but no `@foreground` tag (or the reverse) fails the checker (verify: `just app-test-foreground-check` exits non-zero on a deliberately-desynced fixture, then passes once fixed).
- `just app-test` with no deck running still works (verify: proceeds with a stderr notice, does not hang).

#### Scope {#scope}

1. `@foreground` docblock declaration, parsed by `tests/app-test/scripts/select-tests.ts`, with a drift check against launch-site `foreground: true`.
2. A blocking ask channel: `POST /api/ask` on tugcast plus the `ask` / `ask-response` CONTROL action pair.
3. `tugutil host ask` — a CLI verb that raises the dialog and prints the chosen option id.
4. A deck-side pending-ask store participating in the session phase machine so the session enters Awaiting.
5. `AppTestAskDialog`, a new composition of `TugInlineDialog` (not a new primitive).
6. Gate logic in the `app-test` recipe: resolve selection → detect `@foreground` → ask → branch.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Reducing the foreground tier itself. The 18 corpus tests that call `simulateAppResign` / `simulateAppBecomeActive` / `simulateAppHide` / `simulateAppUnhide` genuinely need activation; synthesizing those notifications instead of calling `NSApp.activate` would make them stop testing AppKit's real behavior.
- Concurrency. The machine-wide `apptest` gate stays one-at-a-time; this plan does not attempt parallel runs.
- A general-purpose "ask the user anything from a shell script" product surface. `/api/ask` is built generically enough to serve one, but only the app-test caller ships here.
- Persisting the answer across invocations (no "don't ask again" memory). Every invocation that contains a foreground test asks.
- Changing what `foreground: true` does at runtime — that behavior is already landed.

#### Dependencies / Prerequisites {#dependencies}

- The uncommitted background-mode work must be in the tree (see [#context] for the file list). This plan assumes `foreground: true` already exists in `LaunchTugAppOptions` (`tests/app-test/_harness/types.ts`) and already drives `TUGAPP_NATIVE_EVENT_MODE` in `resolveLaunchOptions` (`tests/app-test/_harness/index.ts`).
- A running tugcast to talk to, discovered via `resolve_port` in `tugrust/crates/tugutil/src/commands/tell.rs`.
- `TUG_SESSION_ID` exported into the shell environment (already true on both the Claude and Shell routes).

#### Constraints {#constraints}

- **Warnings are errors.** The Rust workspace enforces `-D warnings` via `tugrust/.cargo/config.toml`.
- Loopback-only for the new route, matching `eval_handler`'s `addr.ip().is_loopback()` guard.
- `/api/ask` must NOT inherit `eval_handler`'s dev-mode gate. Eval is an arbitrary-code door; ask is a user-consent prompt and must work on a release instance.
- The deck must satisfy [L02]: pending-ask state enters React through `useSyncExternalStore` only.
- Dialog elements must be built every render, not cached in `useMemo` — `session-card-transcript.tsx` documents that caching a React element freezes the `Component` reference and breaks Fast Refresh for `PermissionDialog` / `QuestionDialog`.
- No `localStorage` / `sessionStorage` / IndexedDB anywhere in this work.

#### Assumptions {#assumptions}

- A developer running app-tests has the Session card visible; the dialog is worthless if unseen, but that is the normal working state.
- Answering is fast relative to a run, so a 10-minute ask timeout is generous rather than tight.
- The set of `@foreground` tests stays small (currently ~20 of 274 files), so the prompt is occasional and does not become noise that trains dismissal.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Where does the dialog mount when there is no live assistant turn? (DECIDED — see [P05]) {#q01-mount-point}

**Question:** `PermissionDialog` mounts at the foot of the last assistant turn cell, gated on `isLastAssistant && !isCommitted` in `session-card-transcript.tsx`. An app-test ask raised by the agent's Bash tool call does have a live turn — but one raised from a plain terminal does not. Where does it render then?

**Why it matters:** If the ask is modeled as turn-scoped chrome and no turn exists, the dialog silently never appears while the CLI blocks for ten minutes — the worst possible failure.

**Options:**
- Mount inside the turn cell like `PermissionDialog`, and refuse to ask when no turn is live.
- Mount at the session level, below `SessionTranscriptHost` inside `.session-view-pane[data-view="transcript"]`, independent of turn state.

**Resolution:** DECIDED (see [P05]) — session-level mount. The ask is not turn-scoped; it is a property of the session's environment.

#### [Q02] Should "Run background-only" be offered when the selection is *entirely* foreground tests? (DECIDED — see [P08]) {#q02-empty-background-set}

**Question:** If every file in the selection is `@foreground`, "run background-only" would run nothing.

**Why it matters:** An option that silently does nothing is a trap.

**Resolution:** DECIDED (see [P08]) — the option is omitted from `options` when the background subset is empty, leaving a two-way choice. The CLI computes both subsets and only offers what is non-empty.

#### [Q03] Should the answer be remembered for a session or a time window? (DEFERRED) {#q03-remember-answer}

**Question:** A developer iterating on a foreground test will be asked on every run.

**Why it matters:** Repetition trains reflexive approval, which defeats the gate.

**Plan to resolve:** Live with per-invocation asking first and see whether it actually chafes. If it does, the natural shape is an `--assume` flag the developer passes deliberately (already present per [P10] for non-interactive use) rather than implicit memory, which would risk a surprise seizure long after the decision.

**Resolution:** DEFERRED — revisit after the gate has been in daily use; no follow-up plan filed yet.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Ask blocks forever, wedging a run | high | low | 10-minute timeout → treated as cancel ([P07]) | Any report of a hung `just app-test` |
| Dialog raised but never visible | high | low | Session-level mount ([P05]); fail-open when no session ([P03]) | A blocked CLI with no dialog on screen |
| Holding the apptest gate while awaiting a human | med | med | Ask before acquiring the gate ([P09]) | Another worktree reports "held by" for minutes |
| Declaration drifts from behavior | med | med | `foreground-check` fails the build on mismatch ([P04]) | A foreground test runs unprompted |
| New route becomes an unauthenticated control surface | high | low | Loopback-only; no code execution; payload is display text plus opaque option ids ([P02]) | Any change that lets the payload carry executable content |

**Risk R01: The ask becomes noise and gets reflexively approved** {#r01-approval-fatigue}

- **Risk:** If the foreground tier grows, the prompt fires often enough that the developer stops reading it, and the gate stops informing anything.
- **Mitigation:**
  - Keep the tier small — it is a declared, checked set, so growth is visible in review.
  - The dialog names the specific files, so the content differs run to run rather than being a uniform "are you sure".
  - `just app-test-foreground-check` makes the tier's size a queryable number, worth watching.
- **Residual risk:** Nothing prevents a burst of new foreground tests; the check reports the count but does not cap it.

**Risk R02: Fail-open hides the gate exactly when it is wanted** {#r02-fail-open}

- **Risk:** [P03] proceeds without asking when no deck or session is reachable. A developer whose deck crashed mid-work would get an unannounced screen seizure.
- **Mitigation:**
  - Print a clear stderr line naming the foreground files that are about to run and why no prompt was raised.
  - Fail-open only on *transport* failure (no port, connection refused), never on a delivered-but-unanswered ask.
- **Residual risk:** The stderr notice can scroll past unread in a busy terminal.

---

### Design Decisions {#design-decisions}

#### [P01] Compose `TugInlineDialog`; author no new primitive (DECIDED) {#p01-compose-not-author}

**Decision:** The app-test dialog is a new *composition* of the existing `TugInlineDialog` (`tugdeck/src/components/tugways/tug-inline-dialog.tsx`), alongside `PermissionDialog` and `QuestionDialog` — not a new reusable component.

**Rationale:**
- The primitive already provides everything the design needs: `icon`, `iconRole`, `title`, `description`, `actions`, and an `options` mandatory-single-select radio group of `TugDialogButton`s (`TugInlineDialogOption` = `{ value, label, description? }`).
- `session-permission-dialog.tsx` is a working reference composition with the same header-bar + options shape.
- Hand-rolling UI that exists as a `Tug*` component is a standing project anti-pattern; borrowing its CSS classes instead of composing it counts as hand-rolling.

**Implications:**
- No changes to `tug-inline-dialog.tsx` itself, so `tug-inline-dialog.test.ts` and `gallery-tug-inline-dialog.tsx` are untouched.
- The three choices map onto `options` values, not onto three buttons in `actions`. `actions` carries a single confirm button; `Cancel` is an option like the others so the choice stays a single mandatory selection.

#### [P02] `/api/ask` mirrors `/api/eval`'s round-trip machinery (DECIDED) {#p02-mirror-eval}

**Decision:** Add `POST /api/ask` to tugcast modeled directly on `eval_handler` in `tugrust/crates/tugcast/src/server.rs`: mint a `requestId`, register a `oneshot::Sender` in a new `pending_asks` map on `FeedRouter`, broadcast an `ask` action on `FeedId::CONTROL`, await the oneshot with a timeout.

**Rationale:**
- The exact request/response shape already exists and is proven: `PendingEvals` in `tugrust/crates/tugcast/src/router.rs`, the broadcast in `eval_handler`, and the `"eval-response"` arm of `dispatch_action` in `tugrust/crates/tugcast/src/actions.rs` that removes the entry and sends on the oneshot.
- Threading a second map alongside the first is mechanical: `pending_evals` is already passed through `control.rs` and `main.rs` into `dispatch_action`, so `pending_asks` follows the same path.

**Implications:**
- `dispatch_action`'s signature grows a `pending_asks` parameter, touching its call sites in `control.rs` and `main.rs` and its unit-test setup in `actions.rs`.
- The deck answers with `connection.sendControlFrame("ask-response", { requestId, choice })`, mirroring `"eval-response"`.
- **`/api/ask` must not copy eval's dev-mode/diag gate.** Eval is gated because it executes arbitrary code; ask only displays text and returns an opaque option id, and must work on a release instance. Loopback-only is retained.

#### [P03] The ask is session-scoped, and fails open when there is no session (DECIDED) {#p03-session-scoped}

**Decision:** The CLI sends `TUG_SESSION_ID` as `sessionId`. The deck routes the ask to that session's card. If `TUG_SESSION_ID` is unset, the deck routes to the active session card. If tugcast is unreachable, or the deck reports no session at all, the CLI prints a stderr notice naming the foreground files and **proceeds without asking**.

**Rationale:**
- Awaiting is a *session* phase; an ask that is not attached to a session has nothing to put into Awaiting.
- Blocking a terminal-only run that cannot possibly show a dialog would make app-tests unusable outside the app, which is a worse failure than an unannounced foreground run the developer started by hand at that terminal.
- Fail-open is limited to transport/absence failures; a delivered ask that is never answered is a cancel per [P07].

**Implications:**
- The wire payload carries an optional `sessionId`.
- The CLI distinguishes "no route to a dialog" (exit 0, proceed, notice) from "asked and not answered" (exit non-zero, cancel).

#### [P04] `@foreground` is a declared docblock tag, checked against behavior (DECIDED) {#p04-foreground-declaration}

**Decision:** Every test that launches with `foreground: true` declares `@foreground` in its header docblock, exactly as `@covers` is declared. `tests/app-test/scripts/select-tests.ts` gains a `--foreground` mode that prints the foreground subset of a selection, and a check that fails when the tag and the launch-site option disagree in either direction.

**Rationale:**
- Following the established `@covers` convention means one parser, one mental model, and an existing enforcement habit (`just app-test-covers-check`).
- A docblock tag is greppable in a fraction of the time it takes to parse TypeScript for a call-site option, and the recipe gate runs on every invocation.
- The bidirectional check is what makes the declaration trustworthy: a tag without the option would prompt for a test that does not steal focus (noise), and an option without the tag would run a screen-seizing test unprompted (the actual harm).

**Implications:**
- Files to tag initially: `at0014-scroll-persistence.test.ts`, `at0126-keyboard-ring-cold-boot.test.ts`, `at0145-permission-dialog-keyboard.test.ts`, `at0165-activation-first-responder.test.ts`, `at0209-picker-field-click-single-focus.test.ts`, `at0306-open-quickly-default-dir.test.ts`, plus every file using a lifecycle verb (see [#foreground-inventory]).
- The check is per-file, not per-launch-site: `at0165` marks only its Bug D launch `foreground: true`, and the file still carries one `@foreground` tag. The tag means "this file contains at least one foreground launch".

#### [P05] The dialog mounts at session level, not inside a turn cell (DECIDED) {#p05-session-level-mount}

**Decision:** `AppTestAskDialog` renders as a sibling of `SessionTranscriptHost` inside `.session-view-pane[data-view="transcript"]` in `tugdeck/src/components/tugways/cards/session-card.tsx`, gated only on the pending-ask store — never on `isLastAssistant` or `isCommitted`.

**Rationale:**
- Resolves [Q01]. An ask can arrive with no live assistant turn (terminal invocation, or an agent turn that has already committed), and the turn-cell gating in `session-card-transcript.tsx` would render nothing in that case while the CLI blocks.
- The ask describes the session's *environment* (a run is about to seize the screen), not the content of any one turn, so turn-scoped chrome is the wrong model.
- Keeps `session-card-transcript.tsx`'s `pendingApproval` / `pendingQuestion` logic untouched, which is delicate — it is `useSyncExternalStore`-gated on `isCommitted` specifically so committed cells return stable `null` and skip re-renders.

**Implications:**
- The dialog does not participate in the `dispatchRenderInput` registry in `session-assistant-renderer-dispatch.ts` — that registry's `RenderInput` union is for turn content (`assistant_text`, `thinking`, `tool_call`, `user_text`, `permission`, `cost`), and the ask is not turn content.
- The element must still be constructed inline every render (no `useMemo` over the element) so Fast Refresh swaps the component cleanly.

#### [P06] Awaiting comes from a `pendingAsk` field feeding the existing phase branch (DECIDED) {#p06-pending-ask-phase}

**Decision:** `code-session-store.ts` gains a `pendingAsk` field on its snapshot, and the existing `phase === "awaiting_approval"` branch is extended so a pending ask also yields the Awaiting phase.

**Rationale:**
- Awaiting already exists and is already wired to telemetry (`awaitingApprovalSince`, `awaitingApprovalIntervals`, `awaitingApprovalMs`) and to the session-lifecycle zone mapping the Session card renders from. Reusing it means the ask inherits all of that for free.
- Inventing a parallel "awaiting something else" phase would fork the lifecycle state machine, which `at0084-session-lifecycle-coordination.test.ts` pins as a state-to-zone matrix.

**Implications:**
- `at0084` must be re-run; if its matrix enumerates the causes of Awaiting rather than just the phase, it needs a case added.
- The ask's Awaiting time lands in the same telemetry counters as approval time. That is acceptable and arguably correct — both are "blocked on the human" — but it means the telemetry no longer distinguishes them. Noted rather than solved.

#### [P07] Timeout and disconnect are cancels, not proceeds (DECIDED) {#p07-timeout-is-cancel}

**Decision:** `/api/ask` uses a 600-second timeout (versus eval's 30). Timeout, deck disconnect (oneshot sender dropped), or any non-`ok` response causes the CLI to exit non-zero and the recipe to abort the run.

**Rationale:**
- A delivered-but-unanswered ask means the developer is away or did not see it; seizing the screen then is precisely the harm this plan exists to prevent.
- 30 seconds is far too short for a human decision; ten minutes is long enough that a timeout genuinely means "nobody is there".
- This is the closed half of the fail-open/fail-closed split in [P03]: absence of a channel proceeds, presence of an unanswered question does not.

**Implications:**
- The recipe must distinguish CLI exit codes: `0` + choice on stdout = answered; non-zero = abort; a distinct code for "no route, proceed" per [P03].

#### [P08] Options are computed from the selection, and empty branches are omitted (DECIDED) {#p08-computed-options}

**Decision:** The CLI computes the foreground and background subsets of the resolved selection and offers only the options that would do something: `run-all` always; `run-background-only` only when the background subset is non-empty; `cancel` always.

**Rationale:**
- Resolves [Q02]. Offering an option that runs zero tests is a trap.
- The dialog's description can then state exact counts ("3 of 12 tests will take the screen"), which is what makes the prompt informative rather than a generic warning.

**Implications:**
- Option ids are a closed set — `run-all`, `run-background-only`, `cancel` — so the recipe can branch on them without parsing prose.
- The CLI, not the deck, owns option construction; the deck renders whatever `options` array it receives.

#### [P09] Ask before acquiring the machine-wide gate (DECIDED) {#p09-ask-before-gate}

**Decision:** The `app-test` recipe resolves its selection and runs the ask **before** the `tugutil host gate run --name apptest` re-exec, not inside it.

**Rationale:**
- The gate serializes whole invocations machine-wide. Holding it while a human decides would block every other worktree's run for as long as the dialog sits unanswered — up to the ten-minute timeout.
- The selection is knowable without the gate; nothing about resolving files or asking a question needs exclusivity.

**Implications:**
- The recipe's existing early-exit re-exec block (`if [ "${TUG_APPTEST_GATED:-}" != "1" ]; then … exec tugutil host gate run …`) is where the ask goes — before the `exec`.
- The chosen outcome must survive the re-exec. It is passed forward in the environment (`TUG_APPTEST_ASSUME`), which also makes the gated child skip re-asking.

#### [P10] A non-interactive escape hatch exists and is explicit (DECIDED) {#p10-assume-flag}

**Decision:** `TUG_APPTEST_ASSUME=all|background|cancel` short-circuits the ask. It is also the mechanism by which the pre-gate answer reaches the post-gate child ([P09]).

**Rationale:**
- Automation and scripted runs must not block on a dialog.
- Making it an explicit environment variable rather than implicit memory keeps the decision visible at the call site, which is the objection to remembering answers in [Q03].

**Implications:**
- Documented in the `app-test` recipe's comment block alongside the existing usage lines.
- The gated child always sees it set, so the ask happens exactly once per invocation.

---

### Deep Dives {#deep-dives}

#### End-to-end flow {#end-to-end-flow}

**Spec S01: The ask round trip** {#s01-ask-round-trip}

1. `just app-test <files…>` runs `bun scripts/select-tests.ts` to resolve the concrete file list (for `app-test-changed`) or normalizes the explicit list (for `app-test <files>` / the core tier).
2. The recipe asks `select-tests.ts --foreground <files…>` which files carry `@foreground`. Empty result → proceed directly to the gate, no network, no prompt.
3. Non-empty → `tugutil host ask` POSTs to `http://127.0.0.1:<port>/api/ask` with `{ sessionId, title, description, options[] }`. Port comes from `resolve_port(port, instance)` in `tugrust/crates/tugutil/src/commands/tell.rs`.
4. `ask_handler` in `tugrust/crates/tugcast/src/server.rs` checks loopback, mints a `requestId`, inserts a `oneshot::Sender` into `router.pending_asks`, and broadcasts `Frame::new(FeedId::CONTROL, {"action":"ask", requestId, sessionId, title, description, options})` on `router.stream_outputs`.
5. The deck's `registerAction("ask", …)` in `tugdeck/src/action-dispatch.ts` hands the payload to the pending-ask store, which routes it to the target session's `codeSessionStore` as `pendingAsk`.
6. `pendingAsk` non-null → session phase reports `awaiting_approval` ([P06]) and `AppTestAskDialog` mounts at session level ([P05]).
7. The developer picks an option and confirms. The store clears `pendingAsk` and calls `connection.sendControlFrame("ask-response", { requestId, choice })`.
8. `dispatch_action`'s `"ask-response"` arm removes the entry from `pending_asks` and sends the choice on the oneshot.
9. `ask_handler` returns `{"status":"ok","choice":"<id>"}`; `tugutil host ask` prints the id and exits 0.
10. The recipe exports `TUG_APPTEST_ASSUME=<choice>` and re-execs under the gate ([P09]). The gated child sees the variable and skips the ask.

#### The foreground inventory {#foreground-inventory}

These are the files that launch with `foreground: true` today, established by cross-referencing lifecycle-verb usage against launch sites. All 18 lifecycle-verb users were already marked; the remaining entries were marked while landing background mode.

**List L01: Files requiring `@foreground`** {#l01-foreground-files}

Lifecycle-verb users (`simulateAppResign` / `simulateAppBecomeActive` / `simulateAppHide` / `simulateAppUnhide`): `at0004-app-resign-return`, `at0005-app-hide-unhide`, `at0010-markdown-selection`, `at0014-cold-boot-scroll`, `at0014-scroll-persistence`, `at0017-savestate-rpc-parity`, `at0018-async-content-race`, `at0022-caret-visibility`, `at0027-layout-state-persistence`, `at0030-virtual-focus`, `at0035-dev-app-switch-selection`, `at0035-em-app-switch-selection`, `at0039-title-bar-return-focus-restore`, `at0078-dev-engine-focus-survives`, `at0136-stale-reapply-clobber`, `at0148-dialog-survives-reactivation`, `at0295-background-activation-click`, `at0306-open-quickly-default-dir`.

Non-lifecycle foreground cases: `at0126-keyboard-ring-cold-boot` (ring is captured on resign), `at0145-permission-dialog-keyboard` (gates on `document.hasFocus()`), `at0165-activation-first-responder` (Bug D only — Cmd-W responder routing needs a real key window), `at0209-picker-field-click-single-focus`.

The authoritative list is whatever the drift check derives; this snapshot exists so the implementer can sanity-check the checker's first run rather than trusting it blindly.

#### Why the declaration is a docblock tag and not a runtime signal {#why-declaration}

The gate must decide *before* launching anything — that is the entire point. A runtime signal (the harness reporting its mode after boot) arrives far too late: the app has already taken the screen. Static declaration is therefore forced, and the only question is what to parse. The launch-site option `foreground: true` is the ground truth but sits inside a TypeScript call expression, sometimes with other options interleaved (`at0126` passes it alongside `env`, `skipAccessibilityPreflight`, and `persistInTestMode`). The docblock tag is a stable, line-oriented, already-conventional surface, and the drift check is what keeps it honest.

---

### Specification {#specification}

#### Wire contract {#wire-contract}

**Spec S02: `POST /api/ask`** {#s02-api-ask}

Request:

```json
{
  "sessionId": "3f3f0119-…",
  "title": "3 of 12 app-tests will take the screen",
  "description": "at0145-permission-dialog-keyboard, at0165-activation-first-responder, at0014-scroll-persistence",
  "options": [
    { "value": "run-all", "label": "Run all", "description": "Includes the 3 that take the screen" },
    { "value": "run-background-only", "label": "Run background-only", "description": "Skips the 3 that take the screen" },
    { "value": "cancel", "label": "Cancel", "description": "Run nothing" }
  ]
}
```

Responses: `200 {"status":"ok","choice":"run-all"}`; `403 {"status":"error","message":"forbidden"}` (non-loopback); `400` (malformed); `500 {"status":"error","message":"deck disconnected"}`; `504 {"status":"error","message":"timeout waiting for answer"}`.

**Spec S03: CONTROL action pair** {#s03-control-actions}

Outbound (tugcast → deck), on `FeedId::CONTROL`: `{"action":"ask","requestId":"<uuid>","sessionId":"…"|null,"title":"…","description":"…","options":[…]}`.

Inbound (deck → tugcast), via `connection.sendControlFrame`: `{"action":"ask-response","requestId":"<uuid>","choice":"<option value>"}`.

#### CLI contract {#cli-contract}

**Spec S04: `tugutil host ask`** {#s04-cli-ask}

```
tugutil host ask --title <str> [--description <str>] --option <value>:<label>[:<description>] … [--timeout-secs <n>] [--port <n>] [--instance <id>]
```

Prints the chosen option's `value` to stdout on success. Exit codes: `0` answered (choice on stdout); `2` cancelled / timed out / deck disconnected; `3` no route to a dialog (no tugcast reachable) — callers treat this as "proceed without asking" per [P03].

#### State Zone Mapping (tugdeck/tugways) {#state-zone-mapping}

| State | Zone (appearance / local-data / structure) | Mechanism | Law |
|-------|--------------------------------------------|-----------|-----|
| `pendingAsk` (the live request) | local-data | store field on `codeSessionStore`, read via `useSyncExternalStore` | [L02] |
| `selectedOption` (radio selection before confirm) | local-data | `useState` in `AppTestAskDialog` — pre-commit draft, never leaves the component | [L02] |
| Session phase → Awaiting | local-data | derived in `code-session-store` from `pendingAsk` + `pendingApproval`; no separate state | [L02] |
| Dialog visibility / mount | structure | conditional render gated on the store snapshot | [L02] |
| Dialog styling, icon tint | appearance | CSS in `session-app-test-ask-dialog.css`; `iconRole` prop | [L06] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugrust/crates/tugutil/src/commands/ask.rs` | `tugutil host ask` implementation ([S04](#s04-cli-ask)) |
| `tugdeck/src/lib/pending-ask-store.ts` | Receives `ask` actions, routes to the target session, sends `ask-response` |
| `tugdeck/src/components/tugways/chrome/session-app-test-ask-dialog.tsx` | `AppTestAskDialog`, composing `TugInlineDialog` ([P01]) |
| `tugdeck/src/components/tugways/chrome/session-app-test-ask-dialog.css` | Dialog styling ([L06]) |
| `tests/app-test/at0320-app-test-ask-dialog.test.ts` | End-to-end dialog + Awaiting coverage |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `PendingAsks` | type alias | `tugrust/crates/tugcast/src/router.rs` | Mirrors `PendingEvals`; new `pending_asks` field on `FeedRouter` + its initializer |
| `ask_handler` | async fn | `tugrust/crates/tugcast/src/server.rs` | Modeled on `eval_handler`; registered as `.route("/api/ask", post(ask_handler))`; loopback-only, **no** dev gate ([P02]) |
| `dispatch_action` | fn (modify) | `tugrust/crates/tugcast/src/actions.rs` | New `pending_asks` param; new `"ask-response"` arm; update call sites in `control.rs`, `main.rs`, and the in-file test setup |
| `HostCommands::Ask` | enum variant | `tugrust/crates/tugutil/src/cli.rs` | New subcommand under `pub enum HostCommands` |
| `registerAction("ask", …)` | call | `tugdeck/src/action-dispatch.ts` | Alongside the existing `"eval"` registration |
| `pendingAsk` | store field | `tugdeck/src/lib/code-session-store.ts` | Added to the snapshot; feeds the `awaiting_approval` phase branch ([P06]) |
| `@foreground` parsing + `--foreground` mode | fn | `tests/app-test/scripts/select-tests.ts` | Alongside `@covers`; plus bidirectional drift check ([P04]) |
| `app-test-foreground-check` | recipe | `justfile` | Sibling of `app-test-covers-check` |
| `app-test` | recipe (modify) | `justfile` | Ask before the gate re-exec ([P09]); branch on `TUG_APPTEST_ASSUME` |

---

### Documentation Plan {#documentation-plan}

- [ ] `tests/app-test/README.md` — document `@foreground`, what marks a test foreground, and the approval prompt.
- [ ] `tuglaws/app-test-harness.md` — record that background is the default and the foreground tier is a declared, checked set.
- [ ] `justfile` — `app-test` comment block gains the `TUG_APPTEST_ASSUME` escape hatch and the ask behavior.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (Rust)** | `pending_asks` insert/remove/resolve; `"ask-response"` arm; option parsing in `ask.rs` | `cargo nextest run` |
| **Unit (TS)** | `@foreground` parsing and drift detection in `select-tests.ts` | `bun test` under `tests/app-test/scripts/` |
| **Integration (Rust)** | `/api/ask` end to end against a test router: loopback rejection, timeout, disconnect | `cargo nextest run` in `tugcast` |
| **App-test** | Real dialog in the real app: raise an ask, assert the dialog renders, assert phase is Awaiting, answer it, assert the response | `just app-test at0320-app-test-ask-dialog.test.ts` |
| **Contract** | The recipe branches correctly on each of the three choices | Shell-level checkpoint in [#step-7](#step-7) |

#### What stays out of tests {#test-non-goals}

- **A jsdom render test for `AppTestAskDialog`.** Fake-DOM render tests are banned in this project; the dialog is covered by a real app-test driving the real component.
- **Mock-store assertions for `pendingAsk`.** The store is exercised through the real round trip in the app-test, not by poking a fake store and asserting it changed.
- **`TugInlineDialog` itself.** Untouched by this plan ([P01]); its existing `tug-inline-dialog.test.ts` remains the coverage.
- **The foreground tests' own behavior.** Already covered; this plan only gates when they run.

---

### Execution Steps {#execution-steps}

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | `@foreground` declaration and drift check | pending | — |
| #step-2 | tugcast `/api/ask` route and `pending_asks` | pending | — |
| #step-3 | `tugutil host ask` CLI verb | pending | — |
| #step-4 | Deck pending-ask store and action registration | pending | — |
| #step-5 | `AppTestAskDialog` component | pending | — |
| #step-6 | Session mount and Awaiting phase | pending | — |
| #step-7 | Recipe gate | pending | — |
| #step-8 | Integration checkpoint | pending | — |

---

#### Step 1: `@foreground` declaration and drift check {#step-1}

**Commit:** `apptest(foreground-tag): declare screen-taking tests with @foreground and check for drift`

**References:** [P04] Foreground declaration, List L01, (#why-declaration, #foreground-inventory)

**Artifacts:**
- `@foreground` tags in every file from List L01.
- `--foreground` and drift-check modes in `tests/app-test/scripts/select-tests.ts`.
- `app-test-foreground-check` recipe.

**Tasks:**
- [ ] Extend the docblock parser in `select-tests.ts` to read `@foreground` alongside `@covers`.
- [ ] Add `--foreground <files…>`: print the subset of the given files carrying the tag, one per line, stdout only.
- [ ] Add a drift check: a file whose source contains `foreground: true` must carry `@foreground`, and vice versa. Report both directions with the offending path.
- [ ] Add `app-test-foreground-check` to the `justfile`, mirroring `app-test-covers-check`.
- [ ] Tag every file in List L01.

**Tests:**
- [ ] Unit: a fixture with the tag and no `foreground: true` is reported as drift.
- [ ] Unit: a fixture with `foreground: true` and no tag is reported as drift.
- [ ] Unit: `--foreground` on a mixed list returns only the tagged files.

**Checkpoint:**
- [ ] `just app-test-foreground-check` exits 0 on the real corpus.
- [ ] `bun scripts/select-tests.ts --foreground at0001-tab-switch-fc.test.ts at0145-permission-dialog-keyboard.test.ts` prints only `at0145-permission-dialog-keyboard.test.ts`.
- [ ] Temporarily delete one tag → the check exits non-zero naming that file; restore it.

---

#### Step 2: tugcast `/api/ask` route and `pending_asks` {#step-2}

**Commit:** `tugcast(ask): add POST /api/ask with a blocking deck round trip`

**References:** [P02] Mirror eval, [P07] Timeout is cancel, Spec S02, Spec S03, (#end-to-end-flow)

**Artifacts:**
- `PendingAsks` type and `pending_asks` field on `FeedRouter` in `router.rs`.
- `ask_handler` in `server.rs`, routed at `/api/ask`.
- `"ask-response"` arm in `dispatch_action`.

**Tasks:**
- [ ] Add `PendingAsks` alongside `PendingEvals` in `tugrust/crates/tugcast/src/router.rs`, plus the `pending_asks` field and its initializer.
- [ ] Write `ask_handler` in `server.rs` following `eval_handler`: loopback guard, JSON parse, `requestId`, oneshot registration, CONTROL broadcast, `timeout(600s)`. **Do not** copy the dev-mode/diag gate ([P02]).
- [ ] Register `.route("/api/ask", post(ask_handler))` in the router builder.
- [ ] Add the `"ask-response"` arm to `dispatch_action` in `actions.rs`, and thread `pending_asks` through its signature and its call sites in `control.rs` and `main.rs`.

**Tests:**
- [ ] Integration: a request from a non-loopback address gets 403.
- [ ] Integration: an `ask-response` with a matching `requestId` resolves the pending request with its `choice`.
- [ ] Integration: an unanswered request returns 504 after the timeout (use an injected short timeout, not a 600s test).
- [ ] Integration: a dropped sender yields 500.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast` passes with no warnings.
- [ ] `cd tugrust && cargo build` clean under `-D warnings`.

---

#### Step 3: `tugutil host ask` CLI verb {#step-3}

**Depends on:** #step-2

**Commit:** `tugutil(ask): add host ask — raise a session dialog and print the choice`

**References:** [P03] Session-scoped and fail-open, [P07] Timeout is cancel, [P08] Computed options, Spec S04, (#cli-contract)

**Artifacts:**
- `tugrust/crates/tugutil/src/commands/ask.rs`.
- `HostCommands::Ask` in `cli.rs`.

**Tasks:**
- [ ] Add the `Ask` variant to `pub enum HostCommands` in `tugrust/crates/tugutil/src/cli.rs` with `--title`, `--description`, repeatable `--option`, `--timeout-secs`, `--port`, `--instance`.
- [ ] Implement `ask.rs`: parse `value:label[:description]` options, read `TUG_SESSION_ID` from the environment, resolve the port via `resolve_port` (from `commands/tell.rs`), POST to `/api/ask` following the pattern in `commands/draft.rs`.
- [ ] Map outcomes to exit codes per Spec S04 — notably exit `3` (proceed, no route) when the port cannot be resolved or the connection is refused ([P03]).
- [ ] Print only the chosen `value` on stdout; all diagnostics to stderr.

**Tests:**
- [ ] Unit: option-spec parsing, including a description containing a colon.
- [ ] Unit: an option spec with no `:` separator is a usage error.
- [ ] Integration: against a stub server returning a choice, stdout is exactly that value and exit is 0.
- [ ] Integration: connection refused → exit 3, nothing on stdout.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugutil` passes.
- [ ] `tugutil host ask --help` shows the documented flags.

---

#### Step 4: Deck pending-ask store and action registration {#step-4}

**Depends on:** #step-2

**Commit:** `tugdeck(ask): route ask actions to a session-scoped pending-ask store`

**References:** [P03] Session-scoped, [P06] Pending-ask phase, Spec S03, (#end-to-end-flow, #state-zone-mapping)

**Artifacts:**
- `tugdeck/src/lib/pending-ask-store.ts`.
- `registerAction("ask", …)` in `action-dispatch.ts`.
- `pendingAsk` on the `code-session-store` snapshot.

**Tasks:**
- [ ] Write `pending-ask-store.ts`: hold the live request, expose `subscribe` / `getSnapshot` ([L02]), and a `respond(choice)` that clears state and calls `connection.sendControlFrame("ask-response", { requestId, choice })`.
- [ ] Register the `"ask"` action in `tugdeck/src/action-dispatch.ts` next to the existing `"eval"` registration; validate `requestId` is a string and ignore the frame otherwise, matching eval's defensive shape.
- [ ] Route by `sessionId` to the matching card's `codeSessionStore`; fall back to the active session when `sessionId` is null ([P03]).
- [ ] Add `pendingAsk` to the `code-session-store` snapshot and include it in the `awaiting_approval` phase branch ([P06]).
- [ ] Respond `cancel` automatically if the session is torn down while an ask is live, so the CLI is never left hanging.

**Tests:**
- [ ] Unit: an `ask` frame with a non-string `requestId` is ignored.
- [ ] Unit: `respond` sends `ask-response` with the matching `requestId` and clears the snapshot.
- [ ] Unit: with `pendingAsk` set, the session snapshot's phase is `awaiting_approval`.

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/lib/` passes.
- [ ] `cd tugdeck && bunx tsc --noEmit` clean.

---

#### Step 5: `AppTestAskDialog` component {#step-5}

**Depends on:** #step-4

**Commit:** `tugdeck(ask): add AppTestAskDialog composing TugInlineDialog`

**References:** [P01] Compose not author, [P08] Computed options, (#state-zone-mapping)

**Artifacts:**
- `tugdeck/src/components/tugways/chrome/session-app-test-ask-dialog.tsx` and its `.css`.

**Tasks:**
- [ ] Compose `TugInlineDialog` with `iconRole="caution"`, the request's `title`, its `description`, and its `options` mapped to `TugInlineDialogOption` (`{ value, label, description }`).
- [ ] Hold the radio selection in `useState`, defaulting to the first option; render a single confirm button in the primitive's `actions` slot; own focus-on-mount on that button, as `PermissionDialog` does.
- [ ] Call `respond(selectedOption)` on confirm.
- [ ] Follow `session-permission-dialog.tsx` for structure, class naming, and the `data-slot` convention.
- [ ] Register the component in the gallery so it is inspectable, following `gallery-tug-inline-dialog.tsx`.

**Tests:**
- [ ] Covered end-to-end in [#step-8](#step-8); no jsdom render test ([#test-non-goals](#test-non-goals)).

**Checkpoint:**
- [ ] `cd tugdeck && bunx vite build` succeeds (an import that works under dev esbuild can still fail the production rollup build).
- [ ] The gallery card renders the dialog with three options.

---

#### Step 6: Session mount and Awaiting phase {#step-6}

**Depends on:** #step-5

**Commit:** `tugdeck(ask): mount the app-test ask dialog at session level`

**References:** [P05] Session-level mount, [P06] Pending-ask phase, [Q01] Mount point, (#q01-mount-point)

**Artifacts:**
- `AppTestAskDialog` mounted in `session-card.tsx`.

**Tasks:**
- [ ] Mount `AppTestAskDialog` as a sibling of `SessionTranscriptHost` inside `.session-view-pane[data-view="transcript"]` in `tugdeck/src/components/tugways/cards/session-card.tsx`.
- [ ] Subscribe via `useSyncExternalStore` ([L02]); gate only on the pending-ask snapshot, never on `isLastAssistant` / `isCommitted` ([P05]).
- [ ] Build the element inline every render — no `useMemo` over the element — so Fast Refresh swaps the component (the same constraint `session-card-transcript.tsx` documents for `PermissionDialog`).
- [ ] Verify the session lifecycle zone reflects Awaiting while an ask is pending.

**Tests:**
- [ ] Re-run `at0084-session-lifecycle-coordination.test.ts`; add a pending-ask case if its matrix enumerates Awaiting's causes.

**Checkpoint:**
- [ ] `just app-test at0084-session-lifecycle-coordination.test.ts` passes.
- [ ] `cd tugdeck && bunx vite build` succeeds.

---

#### Step 7: Recipe gate {#step-7}

**Depends on:** #step-1, #step-3, #step-6

**Commit:** `apptest(gate): ask before running screen-taking tests`

**References:** [P08] Computed options, [P09] Ask before the gate, [P10] Assume flag, Spec S01, Spec S04, (#end-to-end-flow)

**Artifacts:**
- Ask logic in the `app-test` recipe in `justfile`.

**Tasks:**
- [ ] In the `app-test` recipe, before the `exec tugutil host gate run …` re-exec ([P09]), normalize the file list the same way the recipe already does (strip `./` and `tests/app-test/`) and query `select-tests.ts --foreground`.
- [ ] Skip everything when the foreground subset is empty, or when `TUG_APPTEST_ASSUME` is already set ([P10]).
- [ ] Build the option list per [P08] — omit `run-background-only` when the background subset is empty — and invoke `tugutil host ask`.
- [ ] Branch: `run-all` proceeds unchanged; `run-background-only` removes the foreground files from `FILES` and echoes the skipped names to stderr; `cancel` exits non-zero before any launch. Exit code 3 from the CLI proceeds with a stderr notice ([P03]).
- [ ] Export the resolved outcome as `TUG_APPTEST_ASSUME` across the re-exec so the gated child does not re-ask.
- [ ] Document `TUG_APPTEST_ASSUME` in the recipe's comment block.

**Tests:**
- [ ] Contract: `TUG_APPTEST_ASSUME=cancel just app-test at0145-…` exits non-zero and launches nothing.
- [ ] Contract: `TUG_APPTEST_ASSUME=background just app-test at0001-… at0145-…` runs only `at0001` and names `at0145` on stderr.
- [ ] Contract: `TUG_APPTEST_ASSUME=all just app-test at0001-… at0145-…` runs both.

**Checkpoint:**
- [ ] `just app-test at0001-tab-switch-fc.test.ts` completes with no prompt and no `/api/ask` request.
- [ ] `just app-test at0145-permission-dialog-keyboard.test.ts` raises the dialog and blocks until answered.
- [ ] With tugcast stopped, the same command proceeds with the stderr notice rather than hanging.

---

#### Step 8: Integration checkpoint {#step-8}

**Depends on:** #step-2, #step-3, #step-4, #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [P01]–[P10], Spec S01, (#success-criteria)

**Artifacts:**
- `tests/app-test/at0320-app-test-ask-dialog.test.ts`.

**Tasks:**
- [ ] Write the app-test: drive a real `/api/ask` against the running instance, assert the dialog renders with the expected options, assert the session phase is `awaiting_approval`, answer it natively, assert the HTTP response carries the chosen value and the dialog unmounts.
- [ ] Declare `@covers` for `tugdeck/src/lib/pending-ask-store.ts`, `tugdeck/src/components/tugways/chrome/session-app-test-ask-dialog.tsx`, and `tugrust/crates/tugcast/src/server.rs`.
- [ ] Confirm the new test does not itself need `@foreground` — it must run in the background like everything else.
- [ ] Walk each criterion in [#success-criteria](#success-criteria) and record the observed result.

**Tests:**
- [ ] `just app-test at0320-app-test-ask-dialog.test.ts`.
- [ ] `just app-test` (core tier) still 20/20.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` passes.
- [ ] `just app-test-covers-check && just app-test-foreground-check` both pass.
- [ ] `cd tugdeck && bunx vite build && bunx tsc --noEmit` clean.
- [ ] Every criterion in [#success-criteria](#success-criteria) verified.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** An app-test run that would seize the screen raises a session-inline dialog offering run-all / run-background-only / cancel, putting the session in Awaiting until answered; a run that stays in the background is never interrupted.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Background-only selections never prompt and never contact the deck (no `/api/ask` in the tugcast log).
- [ ] Mixed selections prompt, and each of the three choices behaves as specified (verified by the [#step-7](#step-7) contract checks).
- [ ] The session reports Awaiting while an ask is pending.
- [ ] `just app-test-foreground-check` passes and fails correctly on induced drift.
- [ ] `just app-test` core tier is 20/20 with the gate in place.
- [ ] No deck running → runs proceed with a notice rather than hanging.

**Acceptance tests:**
- [ ] `just app-test at0320-app-test-ask-dialog.test.ts`
- [ ] `cd tugrust && cargo nextest run`

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] [Q03] Remembering an answer for a window of time, if per-invocation asking proves to chafe.
- [ ] Distinguishing ask-Awaiting from approval-Awaiting in telemetry ([P06] merges them).
- [ ] Shrinking the foreground tier by re-examining whether individual lifecycle tests truly need real activation.

| Checkpoint | Verification |
|------------|--------------|
| Declaration is trustworthy | `just app-test-foreground-check` passes; induced drift fails it |
| Transport round trip works | `cargo nextest run -p tugcast` integration tests |
| Dialog renders and answers | `just app-test at0320-app-test-ask-dialog.test.ts` |
| Gate branches correctly | The three `TUG_APPTEST_ASSUME` contract checks in [#step-7](#step-7) |
| No regression | `just app-test` core tier 20/20 |
