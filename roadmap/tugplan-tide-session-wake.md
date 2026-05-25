<!-- tugplan-skeleton v2 -->

## Tide session wake after spontaneous external trigger {#tide-session-wake}

**Purpose:** Make the Tide UI re-paint when a claude session emits content from idle — i.e., when an external trigger (Monitor timeout, ScheduleWakeup, CronCreate, run_in_background output, etc.) drives claude to resume without a user-typed message. Closes [PPF-01] from [tide-assistant-rendering.md](./tide-assistant-rendering.md#ppf-01).

The word **wake** is used throughout instead of "resume" to avoid collision with the pre-existing `bind_resume_acknowledged` machinery (`reducer.ts:2726`), which refers to session-bind reopen — a completely different concept.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken |
| Status | draft |
| Target branch | main (commit on main per repo policy) |
| Last updated | 2026-05-24 (Step 6 empirical sweep — cohort taxonomy rewritten) |

---

### Phase Overview {#phase-overview}

#### Context {#context}

PPF-01 was filed against [tide-assistant-rendering.md](./tide-assistant-rendering.md) after HMR testing surfaced a `Monitor` 60s-timeout case where the underlying claude session JSONL shows the expected `task-notification → assistant resume → bash investigation` sequence, but the Tide UI never paints the post-idle turn. The bug is *not* a closed WebSocket (heartbeats run independently every 15s in both directions per `router.rs:44-48` and `connection.ts:43-54`) and not a dropped frame at the transport layer. The events arrive at the client; the reducer in `tugdeck/src/lib/code-session-store/reducer.ts` silently discards them.

Three reducer guards do the dropping: `handleTextDelta` (`reducer.ts:833-841`) drops `assistant_text`/`thinking_text` unless `phase ∈ {submitting, awaiting_first_token, streaming, tool_work, replaying}`; `handleTurnComplete` (`reducer.ts:1462-1467`) drops `turn_complete` when `phase === "idle" && activeMsgId === null`; `handleUserMessageReplay` (`reducer.ts:2689-2691`) drops `user_message_replay` unless `phase === "replaying"`. The reducer was authored on the assumption that activity from `idle` only originates from either a typed `send` (user turn) or a bracketed `replay_started/replay_complete` cold-boot rehydration. The SDK's `SDKTaskNotificationMessage` family (`sdk.d.ts:1659-1668`) creates a third category — spontaneous mid-session wake — which falls into the gap.

The cohort of mechanisms that may drive wakes was provisionally listed (Monitor, ScheduleWakeup, CronCreate, PushNotification, RemoteTrigger, Bash with `run_in_background: true`, Task subagents with `run_in_background: true`) but only Monitor is empirically verified. Step 1 below pins which mechanisms actually fire task-notification vs. use other re-entry paths, and the design at [D02] adopts a detector shape that is robust against unknown mechanisms — the detector signal is "content arrives in idle with no preceding user_message," and `task_notification` is *metadata* attached to the wake if present, not the trigger of detection.

#### Strategy {#strategy}

- **Mirror the existing replay bracket — but simpler.** The reducer already has a working pattern for "events flow but no user turn is in flight" — the `replay_started`/`replay_complete` bracket and the `replaying` phase. Spontaneous wake gets a parallel phase (`waking`) and a parallel open-bracket frame (`wake_started`). Unlike replay, wake does NOT need its own close frame — claude's existing `turn_complete` is the close. One new state in an enum the reducer already iterates.
- **Detect at the source (tugcode), not in the reducer.** Detection lives where the SDK shape is known. [D02] [D04] explain why reducer-only detection was considered and rejected: it conflates detection with event handling, forces turnKey minting inside a pure handler, and reproduces detection logic that the cold-boot replay translator would need separately. Distributed detection keeps the reducer a state machine and the wire vocabulary explicit.
- **Cold-boot replay is unaffected.** The reducer's `handleTextDelta` guard already allows `"replaying"`, so historic wake turns rehydrating through `replay_started/replay_complete` already paint correctly. No JSONL translator changes are needed in Slice 1. Trigger-metadata persistence through the translator is a Slice 2 concern (called out at [#slice-2-replay-translator]).
- **Loosen exactly one reducer guard.** `handleTextDelta` accepts `"waking"` alongside `"replaying"`. The other two guards (`handleTurnComplete`, `handleUserMessageReplay`) are addressed by the bracket design (the wake's first text event sets `activeMsgId` so the turn-complete early-return doesn't fire; `user_message_replay` from a wake-triggering task-notification synthetic-user-text is dropped quietly in Slice 1 and surfaced as a system note in Slice 2 chrome). Pure additive change to the guard: every existing drop still drops.
- **Single open-bracket frame on the wire — `turn_complete` is the close.** Spec [#spec-wire-frames] defines only `wake_started`; there is no `wake_complete` frame. claude's normal end-of-turn `result → turn_complete` is the close signal. The reducer extends `handleTurnComplete`'s commit path with one branch: when `phase === "waking"`, the commit also clears `wakeTrigger` and `pendingUserMessage` and transitions to `idle` (parallel to the `streaming → idle` commit). Half the wire frames removed, all the ordering ambiguity gone.
- **TurnKey minted by the tugdeck store wrapper (`frameToEvent`), not tugcode.** This mirrors the existing replay-event pattern (`reducer.ts:1606-1609` — turnKeys are a per-turn React-key seed that has no meaning outside tugdeck). The `wake_started` wire frame does NOT carry a turnKey; the store wrapper mints one on frame receipt and adds it to the dispatched event.
- **Reset per-turn telemetry on wake-start via the shared helper.** A wake turn is a real turn for live telemetry — but the per-turn fields (`firstAssistantDeltaAt`, `lastStreamEventAt`, `awaitingApprovalSince`, the interval arrays, etc.) all need resetting at wake-start, exactly the way `handleSend` resets them on user submit. The existing `resetPerTurnTelemetry()` helper at `reducer.ts:1619` is already factored out for this purpose — `handleWakeStarted` calls it. Future fields added to the helper automatically apply to wakes too (no silent regression from manual enumeration drift).
- **Three slices in this plan, plus Slice 2 deferred.** **Slice 1** — wire + reducer + tests + cohort verification (Cohort A: Monitor / Bash run_in_background idle / Task run_in_background idle). **Slice 1b** — tugcode-owned shadow scheduler via croner closes Cohort B (ScheduleWakeup / CronCreate), wakes flow through the same `wake_started` bracket. **Slice 1c-a** — transcript data source treats wake turns as single-row entries (fixes the phantom user-bubble bug discovered in manual repro). Slices 1 + 1b + 1c-a together close PPF-01 end-to-end. Slice 2 (deferred to a follow-up plan): trigger-aware chrome for wake turns + replay-translator metadata + transcript sequence-model rework (Slice 1c-b plan handoff produced by Step 14).

#### Success Criteria (Measurable) {#success-criteria}

- A live test session with the PPF-01 reproduction recipe (`> Use the Monitor tool to tail /var/log/system.log until you see the word "kernel"…`) paints the post-60s timeout turn in Tide without reopening the session. Measured manually against the repro recipe; pass = the resumed text appears in the transcript.
- A fixture-replay test loads the captured wake session JSONL from Step 1 and asserts that the resumed assistant text lands in the transcript (not in dropped events). Pass = test exits 0.
- Step 1's empirical cohort sweep pins which mechanisms route through task_notification vs. other re-entry paths, and the plan claims are tightened to only the verified mechanisms.
- `cd tugdeck && bun x tsc --noEmit && bun test && bun run audit:tokens lint` stays green across all commits.
- `cd tugrust && cargo nextest run` stays green across all commits.
- The first-responder focus destination is unchanged by a wake (prompt-entry stays focused through `waking → idle` transitions). Verified at [#step-4-l23-check].

#### Scope {#scope}

The plan ships in three slices, all in scope. (Slice tagging clarifies the dependency order — Slice 1 is the foundation; 1b adds the Cohort B branch; 1c fixes the transcript bug.)

**Slice 1 — wake bracket for Cohort A (`system/task_notification`):**
1. New wire frame type: `wake_started` (TS type + Rust definition pass-through in tugcast). No `wake_complete` — `turn_complete` is the close.
2. tugcode detector + emitter: detects `system/task_notification` in `handleInterTurnEvent` and emits `wake_started` with the trigger payload; opens a fresh ActiveTurn so the wake's content events route correctly.
3. tugdeck reducer: new `waking` phase, new `handleWakeStarted` (delegates per-turn telemetry reset to existing `resetPerTurnTelemetry()` helper), guard loosening in `handleTextDelta`/`handleToolUse`/`handleToolResult`/`handleToolUseStructured`/`handleControlRequestForward`, extension to `handleTurnComplete`'s commit path for the `waking → idle` transition, a `wakeTrigger` state field. Store-wrapper change in `frameToEvent` to mint the turnKey on receipt of `wake_started`.
4. Tests covering the reducer, store-wrapper, fixture-replay, SDK drift.
5. Empirical cohort sweep (Step 6) — replaces the original "strong-evidence" claims with captured-evidence three-cohort taxonomy.

**Slice 1b — tugcode shadow scheduler for Cohort B (`ScheduleWakeup` / `CronCreate`):** Closes [Q04].
6. New tugcode module `tugcode/src/scheduler.ts` wrapping croner. Adds `croner: "^10.0.1"` dependency.
7. tugcode `session.ts` tool-use interception for `ScheduleWakeup`, `CronCreate`, `CronDelete`.
8. Wake fire path: emit `wake_started` IPC frame + write synthetic `user_message` to claude stdin.
9. Double-fire safety: cancel shadow job on observed `task_notification` matching the same `task_id`.
10. Tests + manual repro for each Cohort B tool.

**Slice 1c-a — transcript fix for orphan-assistant rendering:** Closes [Q05] minimum-viable scope.
11. `TideTranscriptDataSource` detects wake `TurnEntry`s (`userMessage.text === "" && atoms.length === 0`) and emits one row per such turn (the code-row only). Offset-table-based index math.
12. Pure-logic tests for `numberOfItems()` / `rowAt()` / `kindForIndex()` / `idForIndex()` covering committed wake, inflight wake, mixed transcript, queued sends.

**Slice 1c-b — broader transcript sequence-model rework (forward-looking plan only):**
13. Sketched as Step 14; full execution lives in a follow-on plan (`tugplan-tide-transcript-sequence-model.md`).

PPF-01 entry in [tide-assistant-rendering.md](./tide-assistant-rendering.md) is updated to point at this plan; closed when Slices 1 + 1b + 1c-a ship together.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Visual differentiation of wake turns in the transcript (wake turn looks identical to a user-initiated turn for v1; only the user bubble is suppressed — see [D06]). Trigger-aware chrome deferred to Slice 2.
- A "what triggered this?" chip / banner on wake turns. Deferred (Slice 2).
- Rendering the scheduled `prompt` text for Cohort B (Slice 1b) wakes as a transcript-visible entry. Slice 1b writes it to claude's stdin only; consistent with Cohort A's empty-text sentinel UX.
- Persisting `wakeTrigger` metadata through the cold-boot replay translator. Deferred (Slice 2).
- Durable scheduling across tugcode subprocess restarts (Slice 1b matches claude's session-scoped lifetime — `"dies when Claude exits"`). Durable persistence is a Slice 2+ concern.
- Broader transcript sequence-model rework (Slice 1c-b above). Forward-looking plan sketch only; full execution is a follow-on plan.
- Changes to the WebSocket heartbeat interval/timeout. Not the bug; out of scope.
- Server-initiated session migration / failover. Distinct subsystem.

#### Dependencies / Prerequisites {#dependencies}

- [PPF-01] in [tide-assistant-rendering.md](./tide-assistant-rendering.md#ppf-01) (the bug entry).
- Existing replay-bracket machinery (`reducer.ts` `handleReplayStarted`/`handleReplayComplete`, transcript `replaying` phase, JSONL replay translator). This plan re-uses the pattern.
- `@anthropic-ai/claude-agent-sdk` `SDKTaskNotificationMessage` shape (`sdk.d.ts:1659-1668`). Pinned to the version tugcode currently consumes. (Note: the wire emits at least `tool_use_id` and `usage` beyond what the SDK type declares — see [Q01].)
- Store-wrapper turnKey-minting machinery (the wrapper that mints `turnKey` for replay events per `reducer.ts:2703-2705`). The new `wake_started` frame consumes the same minting pattern.
- **Slice 1b only:** `croner` npm package, version `^10.0.1`. MIT, zero deps, Bun >=1.0 supported. Single API for both cron-expression and one-shot-Date scheduling. See [Q04] for the selection rationale.

#### Constraints {#constraints}

- Reducer must stay total: every event accepted in every phase, with explicit drop semantics for impossible combinations.
- No React state in the reducer surface. The new `wakeTrigger` field, *if* read by any React component, must go through `useSyncExternalStore` like every other piece of store state ([L02]). The implementer must not escape via `useEffect` to mirror the value into local state.
- The wake transition must not disturb the first-responder focus destination ([L23]). Prompt-entry focus stays put through `waking → idle` transitions.
- New wire frames must be additive — existing clients that don't yet handle them must fall through without erroring (default arm with a debug log).
- Tests must use the project's pure-logic patterns; no jsdom / happy-dom (deleted 2026-05-13 per repo policy).
- TurnKey minting stays out of pure-reducer handlers AND out of tugcode (tugcode is a Node subprocess; turnKeys are tugdeck React-key seeds). The tugdeck store wrapper's `frameToEvent` is the canonical mint site — same pattern as the existing replay events (`reducer.ts:1606-1609`).

#### Assumptions {#assumptions}

- The task-notification reaches tugcode as a `{type:"system", subtype:"task_notification", ...}` event matching the SDK's `SDKTaskNotificationMessage` type at `sdk.d.ts:1659-1668`. Empirically confirmed by the Step 1 capture at `v2.1.150-spike/test-monitor-wake-raw.jsonl` line 49.
- The supervisor side (tugcast `agent_supervisor`) currently passes the SDK system messages through to the wire without filtering. Confirmed for `subtype === "init"`; assumed to hold for `subtype === "task_notification"`. Verified in Step 1.
- A single wake corresponds to a single bracket. Nested wakes (one task-notification firing during the wake turn of another task-notification) are theoretically possible; the design at [D01] flattens them to a single outer bracket — the inner wake is absorbed silently. Pinned by a test in Step 5.
- TurnKey minting at the store wrapper is preferable to letting the reducer or tugcode mint. Justified by the existing pattern (replay events follow this convention per `reducer.ts:1606-1609`) and by reducer purity + cross-process clarity (turnKeys are React-key seeds; tugcode has no React).

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Empirical event-shape characterization for spontaneous wake (RESOLVED — three-cohort taxonomy from Step 6 sweep) {#q01-event-shapes}

**Question:** What wire shape does each async-completion tool produce in tugcode's spawn mode (`claude --output-format=stream-json --input-format=stream-json --verbose --include-partial-messages --permission-mode=bypassPermissions`), and which ones can the wake bracket close?

**Resolution:** RESOLVED via seven empirical captures committed at `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.150-spike/` (Monitor) and `/tmp/tide-cohort-sweep/` (the rest — committed as the Step 6 sweep artifacts). Earlier "strong-evidence by tool semantics" claims were guesses; this resolution corrects them with raw evidence.

**Three cohorts, by what the wire actually emits:**

**Cohort A — In-invocation async completion (Slice 1's `wake_started` bracket covers these):**
The tool's completion happens within the lifetime of a single claude invocation. Claude goes idle waiting; the SDK fires `system/task_notification` directly on the live stream-json wire. The bracket pattern from [D01]/[D02] handles the wake turn that follows.

| Tool | Capture (lines) | Wire signature |
|------|---|---|
| `Monitor` (timeout) | `v2.1.150-spike/test-monitor-wake-raw.jsonl` (90) | task_started → task_updated(killed) → **task_notification(stopped)** → system/init → wake stream → result.origin.kind="task-notification" |
| `Bash` with `run_in_background:true` (idle wait) | sweep `capture-bash-runbg.jsonl` (96) | task_started → task_updated(completed) → **task_notification(completed)** → system/init → wake stream → result.origin.kind="task-notification" |
| `Task` with `run_in_background:true` (idle wait, no TaskOutput poll) | sweep `capture-task-idle-bg.jsonl` (66) | task_started(parent) → task_started(child) → task_progress → **task_notification(child)** → **task_notification(parent)** → system/init → wake stream → result.origin.kind="task-notification" |

Common signature across the cohort: `system/task_notification` arrives between the prior turn's `result` and the wake turn's first `message_start`, optionally preceded by `task_started`/`task_updated`/`task_progress` administrative events, followed by `system/init` and the wake's stream. The wake's final `result` carries `origin:{kind:"task-notification"}` as a retrospective marker.

**Cohort B — Harness re-invoke (Slice 1's bracket does NOT cover; requires tugcode-owned scheduling — see [Q04]/[D05]):**
The tool schedules a callback that fires AFTER the current claude invocation's `result/success`. In `--output-format=stream-json` mode the invocation ends — there is no harness in tugcode's spawn mode to deliver the callback. The wake's `prompt` argument is meant to be re-injected as a synthetic user_message via the SDK CLI harness's internal queue, but that harness is absent.

| Tool | Capture | Wire signature |
|------|---|---|
| `ScheduleWakeup` (60s delay) | sweep `capture-sw-streamio.jsonl` from `probe-sw-streamio.mjs` (30 lines — claude spawn held alive 90s) | tool_use ScheduleWakeup → tool_result *"Next wakeup scheduled… the harness re-invokes you when the wakeup fires"* → result/success → **silence for 60+s** → SIGTERM kill |
| `CronCreate` (one-shot in 1 min) | sweep `capture-croncreate.jsonl` (58) | tool_use CronCreate → tool_result *"Scheduled one-shot task X. Session-only (not written to disk, **dies when Claude exits**)"* → result/success → claude exits → no further events |

Tool result texts make the harness contract explicit. Two key facts the probe nailed down:
1. tugcode spawns claude with `--input-format=stream-json` (the same mode the SDK CLI uses), keeping stdin open after `result/success`. The harness re-invoke still does NOT fire in this mode — confirmed by holding the subprocess open for 90s after a 60s ScheduleWakeup with no output of any kind.
2. Whoever owns claude's stdin (tugcode, in our case) is the only party that can deliver the wake via `user_message` injection. The Anthropic Claude Code CLI's harness sits between the user's terminal and claude in interactive mode; tugcode replaces that harness when it spawns claude programmatically.

**Cohort C — Not wake sources:**
- `PushNotification` — sync outbound, one-shot. Tool sends a desktop notification and returns. No wake involvement. (Capture: `capture-pushnotif.jsonl`, 35 lines.)
- `TaskOutput` — blocking wait. Claude blocks inside the tool until completion; no idle, no `task_notification` for the outer turn. (Capture: `capture-taskoutput.jsonl`, 67 lines; inner Bash fires `task_notification` consumed by the subagent's own SDK, but the parent claude blocks.)
- `Task run_in_background:true` WITH active TaskOutput polling — uses TaskOutput's blocking wait, same as the row above. Only the "idle wait, no poll" variant lands in Cohort A.

**Tools no longer in the cohort matrix:**
- `RemoteTrigger` — **does not exist** in claude 2.1.150 (`No matching deferred tools found` per `capture-remotetrigger-schema.jsonl`). Earlier listing was a phantom from a different environment's deferred-tool list. Removed.
- `Agent run_in_background:true` (no poll) — same SDK code path as `Task run_in_background` per the sweep; the two are aliases for `general-purpose` subagent dispatch. Listed under the Task row above.

**Original cohort claim corrected:**
The earlier Step-1 finding that "Bash with `run_in_background:true` does NOT fire task_notification — confirms run_in_background tools sit in a different cohort (active polling, no wake)" was **wrong**. That capture used a prompt that explicitly instructed claude to call BashOutput, which made claude actively poll rather than going idle. The correct split is "does claude go idle waiting" — when it does (idle-wait mode), task_notification fires; when it actively polls via {BashOutput,TaskOutput,etc.}, no notification is needed because claude is already in-tool. Both modes are legitimate; both belong to Bash/Task `run_in_background`; only the idle-wait mode lands in Cohort A.

**New wire signals discovered (out of scope for Slice 1 but useful for Slice 2 chrome):**
- `system/task_started` — fires on tool start (Bash/Task background, Monitor arm) with `task_id`, `tool_use_id`, `description`, `task_type`, optional `subagent_type`/`prompt`.
- `system/task_progress` — intermediate progress updates carrying `usage:{total_tokens,tool_uses,duration_ms}` and `last_tool_name`. Useful for surfacing "task running" with progress detail.
- `system/task_updated` — status transitions (e.g. `patch:{status:"killed"|"completed", end_time}`).
- `system/status` — ongoing claude lifecycle status (`"requesting"`, etc.) — orthogonal to tasks.

Slice 1 ignores all four (tugcast already passes them through opaquely; tugdeck's reducer drops them). Slice 2 chrome may surface `task_progress` for in-flight tool work.

**SDK type drift discovered during sweep:** `SDKTaskNotificationMessage` at `@anthropic-ai/claude-agent-sdk/sdk.d.ts:1659-1668` is INCOMPLETE — the wire emits at least two fields the type does not declare:
- `tool_use_id` (confirmed across all Cohort A captures)
- `usage:{total_tokens,tool_uses,duration_ms}` on Task/Agent `task_notification` (one example: `capture-task-idle-bg.jsonl` line 54)

The Step 5 drift test pins both compile-time (the 4 SDK-declared fields) and runtime (the 5 wire fields including tool_use_id) so a future SDK update that closes the gap moves coverage from runtime to compile-time without breaking anything.

**Note on tugcode today (the upstream bug — corrected):** `tugcode/src/session.ts:handleInterTurnEvent` (line 2737 post-Step-3) handles `subtype === "init"` but does NOT handle `subtype === "task_notification"`. The event falls through with no IPC frame emitted to tugdeck — tugdeck never hears the wake happened, the subsequent assistant content arrives at the reducer while `phase === "idle"`, and `handleTextDelta`'s guard drops it. Step 3's fix (already shipped) added the new arm.

**Robustness gaps that remain after the sweep:**
- Cohort A captures only exercise `status:"stopped"` (Monitor) and `status:"completed"` (Bash/Task runbg). The SDK type also defines `"failed"`; bracket should handle it identically (status is metadata) but it's untested.
- Nested wakes (a second `system/task_notification` arriving inside the first wake's turn) are designed for ([D01]) but not empirically observed. The Task-runbg-idle capture shows TWO consecutive `task_notification` events (parent + child) but they arrive between turns, not nested; the inner SDK consumes the child notification.
- The `system/init` event observed after task_notification in every Cohort A capture is treated as benign by the detector (no behavior change). It always follows task_notification in the observed captures; whether that's invariant is unverified — the design doesn't depend on the ordering.

#### [Q02] Should the wake turn's chrome show *what* triggered it? (OPEN — defer to Slice 2) {#q02-trigger-chrome}

**Question:** When the user sees a wake turn in the transcript, should it carry a visible cue ("Resumed by Monitor t-abc" / "Resumed by ScheduleWakeup")?

**Why it matters:** Wake turns appearing with no context could be disorienting — the user submitted "look at /var/log" two minutes ago and suddenly a new turn paints with no prompt visible. A small inline cue (a chip / a header row) would orient them.

**Plan to resolve:** Ship Slice 1 without the cue; gather feedback from real use; decide whether Slice 2 ships a chrome update.

**Resolution:** DEFERRED to Slice 2 follow-on plan.

#### [Q03] How should `interrupt()` behave during a wake turn? (RESOLVED in Step 4) {#q03-interrupt-during-wake}

**Question:** If the user clicks Stop while a wake turn is streaming, what happens? The interrupt machinery today is tied to a `pendingUserMessage` and a user-initiated turn-key. A wake turn synthesizes its own turnKey but has no user-initiated `pendingUserMessage`.

**Why it matters:** Step 4 has to decide whether `canInterrupt` reads as `true` during `waking` phase (yes — the user can still stop a runaway wake turn) and how the interrupt frame is shaped on the wire.

**Resolution:** ADOPTED the default position: `canInterrupt = true` during `waking`; the interrupt frame uses the same wire shape as a normal-turn interrupt (the server doesn't need to distinguish — the running turn is the running turn). Implementation specifics:

- **`canInterrupt` gate** (in `code-session-store.ts:getSnapshot`): added `phase === "waking"` to the existing OR-chain.
- **CASE A wake pull-down** (interrupt fires before any content has landed): `handleInterrupt` detects the wake context via `state.phase === "waking"` and (1) skips the standard draft-restore pull, because the wake's `pendingUserMessage` is an empty-text marker sentinel, NOT a user submission worth re-editing; (2) clears `wakeTrigger` alongside the standard CASE A state reset; (3) increments `pendingCaseAEchoes` so the wire's eventual `turn_complete(error)` is suppressed exactly as for a normal CASE A.
- **CASE B wake interrupt** (content already landed): `handleInterrupt` opens the interrupt segment unchanged (sets `interruptInFlight: true`, captures `interruptInFlightSegmentStartedAt`). The wire's eventual `turn_complete(error)` flows through the new `waking → idle` commit branch in `handleTurnComplete`, which commits an interrupted `TurnEntry` and clears `wakeTrigger`.
- **Defensive clearing of `wakeTrigger`** added to `handleSessionStateErrored`, `handleWireError`, and `handleTransportClose`'s non-idle branch — any terminal-error path that interrupts a wake leaves no dangling bracket marker on the state.

Step 5 will pin this with a test (`interrupt during wake should commit a partial turn and clear the bracket`).

#### [Q04] How should tugcode close the Cohort B gap (ScheduleWakeup / CronCreate)? (RESOLVED — tugcode-owned shadow scheduler via croner) {#q04-cohort-b-scheduler}

**Question:** Cohort B (ScheduleWakeup, CronCreate) cannot use the Slice 1 `wake_started` bracket because there is no `task_notification` on the wire — the harness re-invoke never fires in tugcode's spawn mode (proven by `probe-sw-streamio.mjs`). What architecture closes the gap?

**Why it matters:** ScheduleWakeup is the mechanism behind the /loop skill; without it, /loop and any user-driven "ask me again in N minutes" workflow silently dies after the first turn. CronCreate is the mechanism behind recurring background work. Both are first-class Claude Code tools and must work in Tide.

**Options considered:**

1. **Move from CLI subprocess to programmatic SDK** — tugcode would invoke `@anthropic-ai/claude-agent-sdk` programmatically rather than spawning the `claude` CLI binary. The SDK has its own harness that delivers wakes. Rejected: ~2-week rearchitecture touching every part of tugcode's session lifecycle; loses the `--input-format=stream-json` clean wire boundary the rest of tugcode is built on.
2. **Spawn a side-car `claude` instance and forward wake injections via IPC** — rejected for similar complexity reasons; doubles per-session resource cost.
3. **tugcode owns a shadow scheduler — adopted.** tugcode intercepts ScheduleWakeup / CronCreate tool-use events in the stream-json wire (`handleInterTurnEvent` or the live-turn equivalent), parses their `{delaySeconds, prompt, reason}` / `{cron, prompt, recurring}` payload, and registers a job with a real Node.js cron library. At fire time, tugcode (a) emits a `wake_started` IPC frame to tugdeck (re-using the Slice 1 bracket), (b) writes a stream-json `user_message` frame to claude's stdin carrying the scheduled `prompt`. Claude — which believes the CLI harness will fire — gets the wake regardless of whether the harness is present. Cohort B starts flowing through the same `wake_started` bracket as Cohort A.

**Resolution:** ADOPTED option 3 — the **shadow scheduler**. tugcode intercepts the scheduling tool calls (the tool itself still runs to completion on claude's side, returning the standard "harness re-invokes you" message — claude's view of the world is unchanged), and tugcode independently registers an out-of-band timer. When the timer fires, tugcode injects the wake via the stream-json input channel.

**Library choice — Croner (`croner` on npm):** Researched alternatives include `node-cron` (~3M weekly), `node-schedule` (~1.5M), `croner` (~2M, modern). Selected **croner**:
- MIT-licensed, **zero runtime dependencies** (no native modules — important for Bun).
- TypeScript-native typings included.
- **Confirmed Bun support** (croner README: "Works in Node.js >=18.0, Deno >=2.0 and Bun >=1.0.0").
- Single constructor handles BOTH cohort cases — pass a cron expression OR a `Date` object for one-shot scheduling: `new Cron('2024-01-23T00:00:00', { …, () => {…} })` per the docs.
- Clean lifecycle methods (`job.stop()`, `job.pause()`, `job.resume()`) and queryable status (`job.isRunning()`, `job.isStopped()`, `job.isBusy()`).
- Handles DST / leap year edge cases (`node-cron`'s timezone support has known DST issues — disqualifies it for our use).
- Actively maintained (10.0.1 released 2026-02-01).

**Session-scoped lifetime:** Decided to match claude's native behavior — wakes fire only while the tugcode subprocess for this session is alive. No persistence across restarts. Justification: matches the contract claude's tool result text already states (*"dies when Claude exits"*); avoids a persistence design + replay-on-restart story; matches user expectation per Step 6 question. Future durable scheduling is a Slice 2+ concern.

**`prompt`-text routing through the bracket:** The scheduled `prompt` text is what claude scheduled for the wake to receive (e.g., "Wake fired — report the current time"). Two visibility options:
- **Hidden** — `wake_started` opens with the empty-text marker (same as Cohort A); the `prompt` is written ONLY to claude's stdin; the user sees claude's response without seeing the prompt. Matches Cohort A's UX exactly.
- **Visible** — bake the prompt into `wake_trigger.summary` so Slice 2 chrome can surface it.

**Adopted: hidden.** Slice 1b keeps the same visibility model as Cohort A. The `prompt` text is internal scheduling state, not user-visible content. Slice 2 may surface it via the trigger-chrome work ([Q02]).

**Double-fire safety:** If claude's CLI harness ever does fire (e.g., a future SDK update closes the gap), and tugcode's shadow timer also fires, the wake content would be injected twice. Mitigation: tugcode's shadow timer cancels its job on first observed `system/task_notification` for the same `task_id` — if the harness fires first, tugcode steps aside. Conversely, if tugcode fires first, the harness's later `task_notification` (if any) is observed with `task_id` not in tugcode's scheduler map and is forwarded through the normal Cohort A path (no-op since the wake content already landed). Specified in Slice 1b execution steps.

#### [Q05] How should the transcript handle wake-style "orphan" assistant messages? (RESOLVED — Slice 1c-a data-source filter; Slice 1c-b sequence-model rework) {#q05-orphan-assistant}

**Question:** A Cohort A wake commits a `TurnEntry` with `userMessage.text === ""` (the empty-text sentinel). The transcript data source (`TideTranscriptDataSource`) and the user-row renderer treat every `TurnEntry` as a paired user+assistant row — so the wake's empty-text marker renders as a **phantom user bubble** (per the manual repro screenshot in Session 56cce4fe: a "You 7:32 PM ✓ OK" row appears between user-initiated turns). Plan said "consumers must check `text === ""` and skip", but no consumer was updated. Real Step 4 oversight.

**Why it matters:** The phantom bubble is wrong UX (the user did not type anything; nothing should appear in their voice), and the contract is broken (the data ships the sentinel; consumers ignore it).

**Two-tier resolution:**

**Slice 1c-a — minimum-viable data-source filter (this plan):** `TideTranscriptDataSource` treats wake turns (`turn.userMessage.text === "" && turn.userMessage.attachments.length === 0`) as **single-row entries** occupying only the code-row index. The per-turn index math changes from "always 2 indices per turn" to a precomputed offset table; the renderer itself does not change. Fully pure-logic testable.

**Slice 1c-b — broader message-sequence model (deferred to follow-on plan):** The fundamental architectural mismatch is that `TurnEntry` is a paired record (`userMessage` + `assistant`) but the real wire is a sequence of messages of varying kinds (user / assistant-text / assistant-tool / system-note). Wakes are one instance of the mismatch; future cases include:
- Multiple consecutive assistant messages within a single turn (claude emits text → tool → text → tool → text — currently flattened into one `assistant` accumulator field, would benefit from per-`type:"assistant"`-frame rows).
- System notes from the harness (auto-injected reminders, e.g. the `<system-reminder>` blocks claude reads — currently invisible).
- Tool-only turns (no assistant text, only tool execution + result — currently appear as empty assistant rows).
- Slice 1b's wake injection's `prompt` text (if [Q04]'s "visible" option is ever revisited, it'd need a system-note row, not a user row).

The sequence-model design replaces `TurnEntry`'s paired structure with a per-turn ordered list of `TranscriptMessage` records (`{kind: "user" | "assistant-text" | "assistant-tool" | "system-note", payload, …}`). The data source becomes a flat enumerator over the cross-turn sequence; the index math is one-dimensional. This is invasive — touches the reducer (replace `userMessage`/`assistant` fields with a `messages: TranscriptMessage[]`), the renderer (per-kind cell registration), the transcript persistence (replay translator emits per-message events), and every consumer that reads `TurnEntry.assistant` / `TurnEntry.userMessage`.

**Resolution:** Slice 1c-a in this plan closes the phantom-bubble bug now. Slice 1c-b is sketched in the execution steps as a forward-looking plan entry; the actual sequence-model rework lives in a follow-on plan (`tugplan-tide-transcript-sequence-model.md`, to be created after Slice 1c-a ships).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Detection logic in tugcode misses an SDK message-ordering edge case | med | med | Pin [Q01] empirically in Step 1; the detector treats `task_notification` as metadata, not as the trigger signal, so reordering doesn't break the bracket | Any prod session JSONL where a wake turn fails to bracket |
| Reducer guard loosening opens a hole for genuinely-stray events | low | low | Tests in Step 5 pin every existing drop case (stray text outside any turn still drops) | Any test failure after the guard change |
| Nested wakes (wake during a wake) produce a malformed bracket | med | low | Test pinned in Step 5; the reducer flattens nested wakes to a single outer bracket via an idempotent `handleWakeStarted` (second call while already `waking` is a no-op except for trigger-metadata update) | A real-session JSONL with two overlapping task-notifications |
| `SDKTaskNotificationMessage` field shape drifts (Anthropic renames or adds fields) | low | low | Drift test in Step 5 imports the SDK type from `@anthropic-ai/claude-agent-sdk` and asserts the five fields we forward are present at compile time. A new field would not break the wake_started emission (we just don't forward it); a removed field would break tsc and surface the drift immediately. | tsc breaks on SDK upgrade |
| User types a `send` *during* an in-flight wake turn (race) | med | low | The reducer's `handleSend` allow-list adds `"waking"`; a send during waking is enqueued the same way a send during streaming is — the `queuedSends` machinery already handles this case. Test pinned in Step 5 | An interaction test surfaces a queueing race |
| Transport disconnect mid-wake (the closing `turn_complete` never arrives) | med | low | Recovery: on `transport_open` → `transport_settled` the reducer's existing bind-resume machinery rehydrates from JSONL, which contains the wake turn as a completed entry — so reopening the session paints it. No separate watchdog needed; the existing reconnect path is the safety net | An observed case where reconnect doesn't rehydrate the in-flight wake |
| Phantom empty user bubble from the empty-text marker `pendingUserMessage` | high | OCCURRED | Original Step 4/5 contract said "consumers must check `text === ""` and skip" — but no consumer was updated, and the phantom bubble showed up in manual repro (Session 56cce4fe). [D06] / Slice 1c-a (Steps 12-13) now fix this in the data source. Step 12's pure-logic tests pin the absent user row. | Test failure or visual regression after Step 12 lands |
| Croner's timer fires DURING claude's in-flight turn (race against an ongoing user_message round-trip) | med | low | Slice 1b's wake fire path writes the synthetic user_message to claude's stdin via the same `writeLine` channel as user-initiated sends. The stream-json input format is JSON-line-delimited; claude processes input as it arrives. If a user_message is in flight, the wake injection queues naturally. tugdeck's `handleSend` enqueue path means the wake-bracketed turn lands after the in-flight user turn closes — exactly the right ordering. | Manual repro produces an interleaved bracket |
| Croner double-fire if the harness ever DOES fire (e.g., a future SDK update closes the gap) | low | low | [D05] / Step 10 pin a `cancelOnHarnessNotification` hook: when tugcode sees a real `system/task_notification` for a `task_id` matching a shadow job, the shadow is cancelled before its timer fires. If the shadow fires first, the harness's later notification is observed with no matching shadow — the Cohort A path emits a `wake_started`; the reducer's nested-wake idempotency at [D01] absorbs it. | A double-wake-turn observed in a manual repro |
| croner npm package drift (Anthropic-unrelated supply-chain concern) | low | low | Pinned to `^10.0.1` (zero deps, MIT, ~2M weekly downloads, actively maintained). `bun audit` checked in Step 8 checkpoint. | A high-severity audit finding |
| ScheduleWakeup / CronCreate tool input schemas drift on a future claude CLI release | low | med | Step 11 drift test pins the input shapes (delaySeconds/prompt/reason for ScheduleWakeup; cron/prompt/recurring for CronCreate; id for CronDelete) against the SDK-exposed schemas. A renamed field surfaces as a defensive-parse warning + a test failure. | A test failure after a claude CLI upgrade |

**Risk R01: SDK message ordering / shape drifts on a future claude-agent-sdk upgrade** {#r01-sdk-drift}

- **Risk:** The SDK could reorder, rename, or restructure `SDKTaskNotificationMessage` (or introduce a new spontaneous-resume mechanism) in a future version, breaking the tugcode detector silently.
- **Mitigation:** A drift test in `tugcode/__tests__/` that imports the type and asserts the expected fields are present at compile time; runs on every CI. The detector also uses `task_notification` as metadata only, not as the trigger — so a new SDK message type that drives wake without going through `task_notification` still triggers the bracket as long as content lands in idle.
- **Residual risk:** A future SDK that drives wakes via a `user_message`-shaped frame (rather than letting content land cold) would slip through, because the detector watches for "content without preceding user_message." That'd be a reasonable architectural change from the SDK side — re-evaluate when it surfaces.

**Risk R02: Pure-reducer contract violation via wake-detection in `handleTextDelta`** {#r02-purity}

- **Risk:** A future implementer, finding the wake detector in tugcode awkward, might move detection into `handleTextDelta` — but the reducer can't mint a turnKey on its own (purity), so the detector would have to escape via an effect. That breaks the cold/hot symmetry with replay events and contaminates the handler's responsibility surface.
- **Mitigation:** [D02] [D04] document why detection lives at the source; the spec at [#spec-wake-started-state-reset] documents that the reducer assumes a pre-minted turnKey arrives on `wake_started`.
- **Residual risk:** None if [D04] is read; this risk exists only as a latent invitation to refactor in the wrong direction.

---

### Design Decisions {#design-decisions}

#### [D01] Bracket pattern with a new `waking` phase, not a synthetic user_message (DECIDED) {#d01-bracket-pattern}

**Decision:** Add a single `wake_started` wire frame and a `"waking"` value to `CodeSessionPhase`. Use claude's existing `turn_complete` as the close signal (no `wake_complete`). Don't fake a user_message to slip the wake turn through the existing `submitting → … → idle` machinery.

**Rationale:**
- The existing `replay_started`/`replay_complete` bracket is the proven pattern for "events flow but no user turn is in flight." Mirroring it costs one enum value and two new handlers; no reducer concept needs inventing.
- A faked user_message would pollute the transcript with phantom user bubbles and lie about the turn-lifecycle telemetry (TTFT would measure "time from fake-send to first-token" — meaningless).
- A bracket cleanly tags the entire wake turn so future Slice 2 work (trigger-aware chrome) has a single place to read the wake metadata.
- Nested wakes flatten to one bracket (second `handleWakeStarted` while already `waking` is a no-op except for trigger-metadata update).

**Implications:**
- New `CodeSessionPhase` enum value: `"waking"`. Every exhaustive switch on phase must add the case.
- One reducer guard loosens: `handleTextDelta` accepts `"waking"`.
- New reducer state field: `wakeTrigger: { taskId, toolUseId, status, summary, outputFile } | null`, set on `handleWakeStarted`, cleared in `handleTurnComplete`'s commit when transitioning from `waking → idle`. Field shape pinned per [Q01] sub-question 1 (verbatim forward of `SDKTaskNotificationMessage` from `sdk.d.ts:1659-1668`; payload is what the SDK emits on the stream-json wire).
- `handleWakeStarted` resets per-turn telemetry by calling the existing `resetPerTurnTelemetry()` helper (`reducer.ts:1619`) — same helper `handleSend` uses on the queue-flush path.

#### [D02] tugcode detects spontaneous wake via `system/task_notification` event (DECIDED — pinned to empirical stream-json wire) {#d02-tugcode-detector}

**Decision:** The detector that recognizes "claude is emitting content from a task-notification" lives in tugcode's `session.ts`, in the `case "system"` arm of `routeTopLevelEvent` — directly alongside the existing `subtype === "init"` arm.

**Detector signal (pinned per Step 1 stream-json capture):** A `{type:"system", subtype:"task_notification", task_id, tool_use_id, status, summary, output_file, ...}` event arrives in the stream. This matches the SDK's formally-typed `SDKTaskNotificationMessage` (`sdk.d.ts:1659-1668`) field-for-field. It arrives BEFORE the wake turn's first `message_start`, so detection is leading-edge (not retrospective).

**Rationale:**
- tugcode is closest to the source: it sees raw stream-json frames before any IPC packaging.
- The SDK emits the wake signal as a single explicit system event with pre-parsed named fields — no correlation window, no inferential state-tracking.
- The payload carries everything Slice 2 chrome could want (`task_id`, `tool_use_id`, `status`, `summary`, `output_file`).
- tugcast (`agent_supervisor`) only sees IPC frames coming out of tugcode; it doesn't know the SDK message shape and would have to re-derive the detection from packaged events.
- tugdeck's reducer can't host the detector cleanly — see [D04].
- **Today, tugcode `case "system"` at `session.ts:565` handles only `subtype === "init"`. `subtype === "task_notification"` falls through with no IPC emission** — see [Q01] tugcode-bug note. The fix is one new arm in the existing switch.

**Implications:**
- tugcode `case "system"` gains a new arm: if `event.subtype === "task_notification"`, emit a `wake_started` IPC frame carrying the full `SDKTaskNotificationMessage` payload (verbatim — no parsing, no transformation), set the session's `isInWake` flag.
- tugcode session-state: `isInWake: boolean` — flipped true on `wake_started` emit, flipped false on the next `result` (turn close).
- The wake closes implicitly when claude emits its end-of-turn `result` (which tugcode already translates into a `turn_complete` IPC frame). No separate `wake_complete` frame on the wire.
- TurnKey for the wake is minted by tugdeck's store wrapper (`frameToEvent`) on receipt of `wake_started`. tugcode does not mint turnKeys; they are tugdeck React-key seeds.
- The retrospective `result.origin.kind:"task-notification"` marker observed in the Step 1 capture is *additional confirmation* but is not consulted by the detector — the leading `system/task_notification` event is sufficient and earlier.
- Defensive robustness: if a future SDK adds a new spontaneous-resume mechanism without going through `system/task_notification`, the detector misses it (acceptable — file as follow-up; the bracket pattern extends naturally to a new event-source arm).

#### [D03] Guard loosening is additive — every drop case is still a drop case (DECIDED) {#d03-additive-guards}

**Decision:** The one reducer guard touched (`handleTextDelta`) adds `"waking"` to its allow-list. It doesn't remove any existing drop semantics.

**Rationale:**
- Defensive totality is a load-bearing property of the reducer ([L02] state ownership through `useSyncExternalStore` requires a deterministic next-state for every event). Replacing drops with passes leaks every flaky frame.
- The bug is "we're missing a legitimate path," not "we're dropping too much." Loosen only the path the bracket certifies.

**Implications:**
- Tests in Step 5 keep every existing drop-case assertion green; they add new assertions for the waking-phase accept-case.
- The two other guards (`handleTurnComplete`, `handleUserMessageReplay`) need no change: the first because `activeMsgId` is set by the first text event under `waking` so the `idle && null` early-return doesn't fire; the second because Slice 1 drops the synthetic user_message_replay quietly (Slice 2 may revisit).

#### [D04] Detection in tugcode, not in the reducer (DECIDED) {#d04-detection-location}

**Decision:** Detection of spontaneous wake lives in tugcode, not in the reducer.

**Rationale (alternative considered: reducer-only detection):**

The reducer-only approach would have `handleTextDelta` inline the detection: when `phase === "idle"` and `assistant_text` arrives, transition to `"waking"` and continue. Pro: zero wire-protocol changes, zero Rust changes, zero tugcode changes. Con (the deciders):

1. **Conflates detection with event handling.** `handleTextDelta` becomes responsible for both "is this a wake?" and "fold the text into scratch." Two responsibilities in one handler is the wrong shape.
2. **Forces turnKey minting inside a pure handler.** TurnKeys are minted by the store wrapper before dispatch today (see comment at `reducer.ts:2703-2705`). A wake transition needs a turnKey, but the reducer can't mint one without breaking purity. Workarounds (`Math.random()`, `Date.now()`, a closure over a counter) all break the cold/hot symmetry with replay events.
3. **Reproduces detection logic that already exists at the source.** tugcode already knows the SDK shape and can detect spontaneously by sequence analysis. Detecting again in the reducer is redundant and forces the reducer to know things about the SDK it has no business knowing.
4. **Doesn't actually save layers.** Even reducer-only needs *some* signal carrying trigger metadata for Slice 2. That signal has to land somewhere — and `wake_started` on the wire (with claude's existing `turn_complete` as the implicit close) is the cleanest place.

**Implications:**
- Step 2's wire-frame additions are load-bearing, not optional scaffolding.
- Step 3's tugcode detector is the implementation focal point of Slice 1.
- The reducer is a pure state machine with clean handlers, not a pile of business logic.

#### [D05] tugcode owns a shadow scheduler using croner (DECIDED — Slice 1b) {#d05-tugcode-scheduler}

**Decision:** tugcode (Bun/TypeScript) hosts its own scheduler using the croner library. The scheduler intercepts `ScheduleWakeup` and `CronCreate` tool-use events in the stream-json wire, registers a job, and at fire time emits a `wake_started` IPC frame + writes a synthetic `user_message` to claude's stdin.

**Rationale:**
- [Q04] proved the harness re-invoke does NOT fire in `--input-format=stream-json` mode; without tugcode-owned scheduling, Cohort B is permanently broken in Tide.
- The shadow design re-uses the Slice 1 wake bracket end-to-end on the tugdeck side. The reducer, snapshot projections, transcript handling, [Q03] interrupt path, etc. all continue to work — wakes are wakes regardless of how the timer fired.
- Croner is the right library for the job (zero deps, Bun-supported, single API for both one-shot Date scheduling AND cron expressions, MIT, active). See [Q04] for the comparison.
- Session-scoped lifetime matches claude's native behavior — no persistence story needed.

**Implications:**
- New tugcode module `tugcode/src/scheduler.ts` houses `WakeScheduler` class wrapping croner.
- New dependency in `tugcode/package.json`: `croner: "^10.0.1"`.
- `tugcode/src/session.ts` gains tool-use intercept logic in the live-turn path (where `tool_use` events for `ScheduleWakeup` / `CronCreate` / `CronDelete` are seen).
- Double-fire safety: tugcode tracks `task_id`s of scheduled jobs and cancels its own job if the harness ever fires a `task_notification` with a matching `task_id`.
- The cron expression must support claude's actual emitted shape (5-field minute-level — per the user's session log: `cron:"53 19 24 5 *"`). Croner supports both 5-field and 6-field-with-seconds; the 5-field expression is the default.

#### [D06] Transcript treats wakes as single-row entries (DECIDED — Slice 1c-a; broader sequence model deferred) {#d06-transcript-wake-single-row}

**Decision:** `TideTranscriptDataSource` detects wake-style `TurnEntry`s (`userMessage.text === "" && userMessage.attachments.length === 0`) and emits ONE row per such turn (the code-row only), not two. The per-turn index math switches from `transcript.length * 2` to an offset-table lookup. The renderer (`UserRowCell`, `CodeRowCell`) is unchanged.

**Rationale:**
- The plan's contract was "consumers must check `text === ""` and skip" — but Slice 1 shipped without updating the only consumer (the transcript data source). The phantom user bubble in Session 56cce4fe is the user-visible bug that proves the gap.
- Filtering at the data-source layer is testable in pure logic — `numberOfItems()` / `rowAt()` are pure functions of the snapshot.
- Filtering at the renderer layer (return null from `UserRowCell` when wake) is the smaller change but leaves the row index occupied; the list view's measurement infrastructure would have to learn to handle zero-height cells without measurement churn. Worse architecturally.
- The broader sequence-model rework (Slice 1c-b) is invasive (touches reducer state shape, replay translator, every `TurnEntry.assistant` consumer); doing it inside this plan would balloon the scope. Filing as a follow-on plan keeps Slice 1c-a tight.

**Implications:**
- New helper on `TideTranscriptDataSource`: a per-snapshot memoized offset table mapping flat row indices to `(turnIndex, half: "user" | "code" | "wake")`. `kindForIndex`, `idForIndex`, `rowAt` all read it.
- `numberOfItems()` returns `Σ rowsPerTurn + (inflight ? rowsForInflight : 0) + queuedSends.length` where `rowsPerTurn` is 1 for wake turns, 2 otherwise. Same shape for the inflight half (1 row for an in-flight wake, 2 for a normal turn).
- The `idForIndex` keys for wake turns stay `${turnKey}-code` (no `-user` key minted), so React reconciliation through inflight → committed transition keeps working.
- The renderer code is unchanged. The wake-detection predicate is `turn.userMessage.text === "" && turn.userMessage.atoms.length === 0` — matches the empty-text sentinel exactly. (For in-flight wakes, the inflight `inflightUserMessage.text === "" && atoms.length === 0` test applies the same way.)

---

### Specification {#specification}

#### Wire frames {#spec-wire-frames}

One new IPC message type emitted by tugcode, forwarded by tugcast, consumed by tugdeck. Goes on the existing CODE_OUTPUT feed; carries the session ID. The bracket *opens* with this frame and *closes* implicitly via the existing `turn_complete` frame that claude already emits at end-of-turn — no separate close frame is needed.

```ts
// New entry in tugcode/src/protocol-types.ts:
type WakeStartedMessage = {
  type: "wake_started";
  session_id: string;
  // No turnKey here — tugdeck's store wrapper (`frameToEvent`) mints
  // it on receipt and adds it to the dispatched event, mirroring the
  // existing replay-event pattern (`reducer.ts:1606-1609`).
  //
  // wake_trigger is a verbatim forward of the SDKTaskNotificationMessage
  // payload (sdk.d.ts:1659-1668), minus the `type:"system"` /
  // `subtype:"task_notification"` envelope. Each field comes directly
  // from the SDK event:
  wake_trigger: {
    task_id: string;       // SDK: identifies which task fired
    tool_use_id: string;   // SDK: which tool_use invocation owns the task
    status: "completed" | "failed" | "stopped";
    summary: string;       // SDK: human-readable description
                           // (e.g. "kernel lines in /var/log/system.log")
    output_file: string;   // SDK: path to captured output (may be empty)
  };
};
```

**Wire-format-version note (catalog answer):** Captured raw stream-json fixture lives at `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.150-spike/test-monitor-wake-raw.jsonl` (90 lines, `claude 2.1.150`). It is in the spike catalog because the format is raw `claude -p` output — pre-tugcode-translation, unnormalized. Step 5's fixture-replay test can consume it via the same path the existing `test-task-tools-c-calculator-raw.jsonl` spike uses (read raw → run through tugcode's `routeTopLevelEvent` → assert emitted IPC sequence). Promoting to a proper normalized probe in `v2.1.150/` is a follow-up if the spike turns out to gate ongoing regression checks.

#### Reducer state changes {#spec-reducer-state}

```ts
// tugdeck/src/lib/code-session-store/types.ts
export type CodeSessionPhase =
  | "idle"
  | "submitting"
  | "awaiting_first_token"
  | "streaming"
  | "tool_work"
  | "awaiting_approval"
  | "replaying"
  | "waking"        // NEW
  | "errored";

// New state field on CodeSessionState:
wakeTrigger: {
  taskId: string;
  toolUseId: string;
  status: "completed" | "failed" | "stopped";
  summary: string;
  outputFile: string;
} | null;
```

#### `handleWakeStarted` state reset {#spec-wake-started-state-reset}

The reducer already factors per-turn telemetry reset into a `resetPerTurnTelemetry()` helper at `reducer.ts:1619` (used by `handleSend`'s queue-flush path). `handleWakeStarted` calls the same helper — no field-by-field enumeration. A future field added to the helper applies to wakes automatically (no silent regression from list drift).

```ts
function handleWakeStarted(state, event): { state, effects } {
  if (state.phase === "waking") {
    // Idempotent: nested wake is a no-op except for trigger-metadata refresh.
    return {
      state: state.wakeTrigger === null && event.wake_trigger !== null
        ? { ...state, wakeTrigger: event.wake_trigger }
        : state,
      effects: [],
    };
  }
  return {
    state: {
      ...state,
      phase: "waking",
      wakeTrigger: event.wake_trigger,
      pendingUserMessage: {
        text: "",                      // empty-text sentinel for "this is a wake"
        atoms: [],
        submitAt: Date.now(),
        turnKey: event.turnKey,        // minted by store wrapper, on event
      },
      costAtSubmit: state.lastCost,    // wake's cost-delta baseline
      ...resetPerTurnTelemetry(),      // single source of truth — same as handleSend
    },
    effects: [],
  };
}
```

What `handleWakeStarted` does *not* do (vs `handleSend`):
- No real user-message text in `pendingUserMessage` — the empty-text sentinel signals "this is a wake." Consumers that render the user-message bubble must check `pendingUserMessage.text === ""` and skip the render. Slice 2 may render a system-note chrome instead (a follow-up could add an explicit `kind: "user" | "wake"` discriminator if the empty-text convention proves fragile).
- No `pendingDraftRestore: null` clear — the user's in-progress draft (if any) must not be touched by a wake.
- `phase: "waking"` (not `"submitting"`).

#### Reducer phase transitions {#spec-phase-transitions}

- `idle` + `wake_started` → `waking` (with state reset per [#spec-wake-started-state-reset])
- `waking` + `assistant_text` / `thinking_text` / `tool_use` → stays `waking` (events flow through the loosened guard at `handleTextDelta`)
- `waking` + `turn_complete` → commits the turn entry through the existing `handleTurnComplete` commit path. The commit path gains one branch: when `state.phase === "waking"`, it clears `wakeTrigger` and `pendingUserMessage` alongside the normal commit, then transitions to `idle`. The empty-text `pendingUserMessage` sentinel is *not* written into the committed transcript entry — the commit code skips empty-text marker pendings (Step 4 must verify the commit logic does this; if it doesn't today, add the skip).
- `waking` + `wake_started` (nested wake) → idempotent no-op, with optional `wakeTrigger` metadata refresh if the new payload is non-null and the old was null
- `waking` + `send` → enqueued via `queuedSends`, mirroring the streaming-phase enqueue behavior. (UX note: a user typing during a wake almost certainly wants to interrupt; the safer queue-the-send default may be revisited in Slice 2 if real-use feedback says so.)

#### Guard loosening (only one needed) {#spec-guard-loosenings}

`handleTextDelta` (`reducer.ts:833-841`): add `"waking"` to the phase allow-list. This is the only guard loosening.

`handleTurnComplete` (`reducer.ts:1462-1467`): the `activeMsgId === null && phase === "idle"` early-return stays as-is — the `waking` phase has `activeMsgId` set by the first text event. **Extension (not loosening):** the commit-path branch that today maps `streaming`/`tool_work → idle` is extended to also map `waking → idle`. The extension also clears `wakeTrigger` and `pendingUserMessage`. Step 4 must verify the existing commit code skips empty-text marker `pendingUserMessage` writes (so the wake's marker doesn't render as a phantom user bubble); if it doesn't, add the skip.

`handleUserMessageReplay` (`reducer.ts:2689-2691`): unchanged. The synthetic user_message_replay frame from a task-notification injection is dropped quietly in Slice 1. Slice 2 may revisit if the SDK emits one and chrome wants to render it as a system note.

The comment at `reducer.ts:827` ("Live Claude should not emit this — but defensive handling…") must be updated as part of Step 4 so the next reader doesn't think the drop semantic is intentional in the broader sense. Updated comment should read approximately: *"Incoming text outside of an active turn or a wake — drop. Live claude emits content into idle only when a spontaneous wake is in progress; the `wake_started` frame transitions phase to `waking` and is what allows the events through here (closed implicitly by `turn_complete`). Stray text outside both an active turn and a wake is still a defensive drop."*

---

### Compatibility / Migration / Rollout {#rollout}

- **Compatibility policy:** The single wire-frame addition is non-breaking. Existing clients that don't recognize `wake_started` log a debug message and ignore it. Existing servers that don't emit it produce no behavior change. New phase `"waking"` is invisible to anything outside the reducer until a wake actually fires.
- **Migration plan:**
  - Step 2 lands the types (no behavior).
  - Step 3 lands tugcode emitter (the wire produces frames only when wake conditions are met — no impact on user-initiated turns).
  - Step 4 lands the reducer consumer.
  - Sliced rollout ensures each commit is independently rollback-safe.
- **Rollback strategy:** A bug in Step 3 (false-positive wake detection) is contained — the reducer ignores `wake_started` until Step 4 lands. A bug in Step 4 (guard loosening lets stray events through) reverts cleanly because the loosening is additive.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/code-session-store/__tests__/handle-wake.test.ts` | Pure-logic reducer tests for the new handlers + guard loosenings |
| `tugdeck/src/__tests__/session-wake-fixture-replay.test.ts` | Fixture-replay test against a captured wake session JSONL (captured in Step 1) |
| `tugcode/src/__tests__/wake-detector.test.ts` | Unit tests for the tugcode detector logic |
| Captured fixture under `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/<version>/test-NN-monitor-wake.jsonl` | Real wake session captured in Step 1 |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `"waking"` | enum value | `tugdeck/src/lib/code-session-store/types.ts` | Added to `CodeSessionPhase` ✓ |
| `WakeTrigger` | interface | `tugdeck/src/lib/code-session-store/types.ts` | New — camelCase form (the reducer/snapshot read this; `WakeStartedEvent.wake_trigger` on the wire is snake_case and translated in `handleWakeStarted`) ✓ |
| `wakeTrigger` | state field | `tugdeck/src/lib/code-session-store/reducer.ts` (CodeSessionState) + `types.ts` (CodeSessionSnapshot) | Default `null`; set/cleared by the wake bracket handlers ✓ |
| `handleWakeStarted` | function | `tugdeck/src/lib/code-session-store/reducer.ts` (next to `handleUserMessageReplay`) | Calls `resetPerTurnTelemetry()`; translates wire snake_case → state camelCase; idempotent on nested wakes ✓ |
| `handleTurnComplete` waking branch | function | `tugdeck/src/lib/code-session-store/reducer.ts` (after the `replaying` branch) | Clears `wakeTrigger` + `pendingUserMessage`; preserves `lastError` (wake is not a user-action recovery signal); queue-flush deliberately skipped ✓ |
| `handleInterrupt` wake-aware CASE A | function | `tugdeck/src/lib/code-session-store/reducer.ts` | Detects `state.phase === "waking"` → skips draft-restore (empty-text marker is not a user message) + clears `wakeTrigger`; CASE B path is unchanged ✓ |
| Additional terminal-path `wakeTrigger: null` | clearing | `handleSessionStateErrored`, `handleWireError`, `handleTransportClose` (non-idle branch) | Defensive — keeps the bracket marker tied to "actively in a wake" ✓ |
| Tool-event guard extensions | guards | `handleToolUse`, `handleToolResult`, `handleToolUseStructured` | `waking` added to allow-list; phase stays `waking` (mirrors `replaying` bracket-owns-phase pattern). Needed because a real wake (Monitor) fires Bash investigation tools — without these, the tool flow would be silently dropped ✓ |
| Control-forward guard extension | guard | `handleControlRequestForward` | `waking` admitted to the live-path branch so a permission/question prompt during a wake transitions to `awaiting_approval` with `prevPhase: "waking"`; `state.prevPhase ?? "streaming"` in `handleRespondApproval` / `handleRespondQuestion` restores correctly back to `waking` ✓ |
| `frameToEvent` wake arm | function | `tugdeck/src/lib/code-session-store.ts:frameToEvent` | Mints turnKey via `mintTurnKey()` and spreads onto the dispatched event, mirroring the `user_message_replay` pattern. `"wake_started"` also added to `KNOWN_CODE_OUTPUT_TYPES` ✓ |
| `canInterrupt` extension | snapshot field | `tugdeck/src/lib/code-session-store.ts:getSnapshot` | `phase === "waking"` added to the OR-chain per [Q03] ✓ |
| Snapshot `wakeTrigger` projection | snapshot field | `tugdeck/src/lib/code-session-store.ts:getSnapshot` | Pass-through of `this.state.wakeTrigger` for `Object.is` stability ([L02]) ✓ |
| `WakeStartedEvent` | type | `tugdeck/src/lib/code-session-store/events.ts` | Added in Step 2 ✓ |
| Lifecycle matrix arm | switch case | `tugdeck/src/lib/code-session-store/lifecycle-state.ts:deriveLifecycleState` | `waking → "streaming"` for Slice 1; Slice 2 may introduce a dedicated row ✓ |
| Indicator visual arm | switch case | `tugdeck/src/components/tugways/tug-state-indicator.tsx:indicatorVisualFor` | Joined the `success + animated` group with `streaming` / `replaying` ✓ |
| `PHASE_HUMAN_LABEL` extension | record entry | `tugdeck/src/components/tugways/tug-state-indicator.tsx` | `waking: "Streaming"` ✓ |
| `handleInterTurnEvent` task-notification arm | function | `tugcode/src/session.ts:handleInterTurnEvent` (line 2737) | New arm alongside the existing `subtype === "init"` arm; emits `wake_started` with the verbatim `SDKTaskNotificationMessage` payload, opens a fresh ActiveTurn, flips `isInWake` ✓ (Step 3) |
| `isInWake` | session field | tugcode SessionManager | True between `wake_started` emit and the next `result` ✓ (Step 3) |
| `WakeStarted` IPC type | TS type | `tugcode/src/types.ts` | IPC contract (no turnKey field; no wake_complete sibling) ✓ (Step 2) |
| `SystemTaskNotificationMessage` | TS type | `tugcode/src/protocol-types.ts` | Inbound stream-json shape that the detector reads ✓ (Step 2) |
| Rust frame pass-through | n/a | tugcast | Opaque pass-through verified — `wake_started` is not in tugcast's instrumented-types set, no code change required ✓ (Step 2) |
| Updated comment | comment | `reducer.ts:handleTextDelta` guard | New text cites [D03] additive-guard rationale and explains the wake-bracket as the legitimate live source of mid-idle content ✓ |

---

### Test Plan Concepts {#test-plan-concepts}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Pure-logic reducer** | Phase transitions, guard loosenings, state-field set/clear, nested-wake flatten, telemetry reset | Step 5 |
| **tugcode detector unit** | Detection logic from synthetic stream-json sequences | Step 3 (alongside implementation) and Step 5 |
| **Fixture replay** | Captured wake JSONL replays without dropped events | Step 5 |
| **Drift prevention** | SDK type-shape pinning ([R01]) | Step 5 |
| **Manual cohort verification** | Each tool in the verified cohort exercised end-to-end through HMR | Step 6 |

---

### Execution Steps {#execution-steps}

#### Step 1: Empirical capture + cohort verification {#step-1}

**Commit:** `chore(tide-wake): capture wake session fixtures and pin cohort`

**References:** [Q01] event shapes, [R01] SDK drift, (#context, #q01-event-shapes)

**Artifacts:**
- **(Done):** Captured raw stream-json fixture committed at `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.150-spike/test-monitor-wake-raw.jsonl` (90 lines). Capture command: `claude -p --output-format=stream-json --verbose --include-partial-messages --permission-mode=bypassPermissions "Use the Monitor tool to tail /var/log/system.log with a 5-second timeout, watching for the word 'kernel'. Report what happens."` run in `/tmp/tide-wake-capture/`. Spike README updated with a row documenting the new file.
- **(Done — negative-result capture, not committed):** A second capture of `Bash` with `run_in_background:true` (sleep + echo + BashOutput poll) confirmed run_in_background tools do NOT fire `system/task_notification` and are therefore NOT in the PPF-01 cohort. Used to split the cohort into async-notification vs. active-polling populations.
- **(Done):** Resolution block at [Q01] documenting all three sub-question answers (ordering, user-message-replay shape, cohort), plus a Robustness-gaps subsection naming what remains unverified.
- **(Done):** Catalog-version answer: `v2.1.150`. Fixture lives in `v2.1.150-spike/` because the capture is raw `claude -p` output (the spike-catalog convention); promoting to a normalized `v2.1.150/` probe is a follow-up if the spike turns out to gate ongoing regression.

**Tasks:**
- [x] Capture raw stream-json for a Monitor-timeout wake.
- [x] Capture raw stream-json for a Bash `run_in_background` invocation to verify whether SDK-level background tools fire the same wake signal (negative result — they don't, they use active polling).
- [x] Confirm the wake event sequence in stream-json: prior `result`, `system/task_updated`, **`system/task_notification` (the wake signal)**, `system/init`, the wake turn's stream events, final `result` with `origin:{kind:"task-notification"}`.
- [x] Resolve [Q01] sub-question 1 (ordering): `system/task_notification` arrives strictly before the wake turn's first `message_start`.
- [x] Resolve [Q01] sub-question 2 (user-event shape): there is no synthetic user event on the wire; the wake signal is `system/task_notification` matching `SDKTaskNotificationMessage` at `sdk.d.ts:1659-1668`.
- [x] Resolve [Q01] sub-question 3 (cohort): split into async-notification (in scope) vs. active-polling (out of scope) populations. Monitor verified positive; Bash `run_in_background` verified negative. Other async-notification candidates (CronCreate, ScheduleWakeup, PushNotification, RemoteTrigger, TaskOutput) remain strong-evidence-only until Step 6.
- [x] Resolve the catalog-version question: `v2.1.150`.
- [x] **Upstream-bug location pinned:** `tugcode/src/session.ts:565` `case "system"` handles `subtype === "init"` but not `subtype === "task_notification"`. The event falls through with no IPC emission. Step 3 fixes it with one new arm in the existing switch.

**Tests:**
- [x] None — read-only empirical step.

**Checkpoint:**
- [x] [Q01] resolved (all three sub-questions answered against the stream-json wire — the format tugcode parses).
- [x] Cohort claims tightened.
- [x] Catalog-version pinned to `v2.1.150`.
- [x] Stream-json fixture committed at `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.150-spike/test-monitor-wake-raw.jsonl`. Step 5's fixture-replay test can run end-to-end against this artifact.

---

#### Step 2: Wire-frame protocol — `wake_started` {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tide-wake): protocol — wake_started IPC frame`

**References:** [D01] bracket pattern, Spec [#spec-wire-frames], (#strategy)

**Artifacts:**
- Inbound stream-json type in `tugcode/src/protocol-types.ts`: `SystemTaskNotificationMessage` (mirrors `SDKTaskNotificationMessage` at `@anthropic-ai/claude-agent-sdk/sdk.d.ts:1659-1668`). Step 3 will read this shape when adding the `case "system"` arm.
- Outbound IPC type in `tugcode/src/types.ts`: `WakeStarted` interface; added to the `OutboundMessage` union next to the existing replay-bracket types.
- Mirrored reducer event type in `tugdeck/src/lib/code-session-store/events.ts`: `WakeStartedEvent` (carries `turnKey: string` minted by the store wrapper before dispatch, matching the `UserMessageReplayEvent` pattern); added to the `CodeSessionEvent` union.
- tugcast: zero code changes required. Survey of `agent_bridge.rs` confirms tugcast handles frames as opaque bytes and only `line.contains("\"type\":\"X\"")` peeks for specific instrumented types (`protocol_ack`, `session_init`, `replay_started`/`replay_complete`, `turn_complete`, `system_metadata`, `resume_failed`). `wake_started` is not in that set — it passes through opaquely.
- No emitters or consumers yet — purely additive types so the wire vocabulary exists before Steps 3 and 4 land.

**Tasks:**
- [x] Add `SystemTaskNotificationMessage` to `tugcode/src/protocol-types.ts` (inbound shape — what Step 3's detector reads from claude stdout).
- [x] Add `WakeStarted` IPC interface to `tugcode/src/types.ts` and extend the `OutboundMessage` union. No `WakeComplete` — `turn_complete` closes the bracket.
- [x] Mirror in tugdeck as `WakeStartedEvent` and extend the `CodeSessionEvent` union (carries `turnKey: string` per the store-wrapper mint contract).
- [x] tugcast: no code change required (opaque pass-through verified).
- [x] Confirm by running tsc + tests + cargo that the new types thread through without breaking any consumer.

**Tests:**
- [x] None at this step — types are additive, no behavior change yet.

**Checkpoint:**
- [x] `cd tugdeck && bun x tsc --noEmit && bun test` green (2892 / 2892 pass).
- [x] `cd tugcode && bun x tsc --noEmit && bun test` green (437 / 437 pass).
- [x] `cd tugrust && cargo nextest run` green (1324 passed, 9 skipped).
- [x] `cd tugdeck && bun run audit:tokens lint` zero violations (hygiene; no token surface touched).

---

#### Step 3: tugcode wake detector + bracket emission {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `feat(tide-wake): tugcode detector + bracket emission`

**References:** [D02] tugcode owns detection, [Q01] event shapes (resolved in #step-1), Spec [#spec-wire-frames], (#strategy)

**Artifacts:**
- `handleInterTurnEvent` in `tugcode/src/session.ts` gains a `system/task_notification` arm next to the existing `system/init` arm. **Location revised from the original draft (`case "system"` in `routeTopLevelEvent` at line 565):** the empirical capture pins `task_notification` as arriving strictly *between* turns (after the prior `result`, before the next `message_start`), and the inter-turn drain is what `handleInterTurnEvent` services. `routeTopLevelEvent` is the per-turn dispatcher and never sees the event.
- Pure helper `buildWakeStartedMessage(event, sessionId)` exported next to `routeTopLevelEvent` — builds the IPC frame from a `system/task_notification` event, returns null on malformed input. Testable without SessionManager infrastructure.
- New SessionManager field `private isInWake: boolean = false`. Flipped true when `wake_started` emits; flipped false when the wake's terminal `result` lands and `handleClaudeLine` clears `activeTurn`.
- **`handleTaskNotification` opens a fresh ActiveTurn on wake_started** (`new ActiveTurn(this.nextSeq(), "", [])`). Without this, the wake's subsequent content events (`message_start`, `assistant`, `stream_event`, terminal `result`) would all fall back to `handleInterTurnEvent` and be silently dropped — the precise upstream cause of [PPF-01].
- Bracket close: implicit. tugcode does NOT emit any wake-close frame. The wake's terminal `result` flows through `dispatchEventToTurn` → `routeTopLevelEvent` → produces the normal `turn_complete` IPC frame; `handleClaudeLine`'s cleanup then clears `activeTurn` AND `isInWake` together.

**Tasks:**
- [x] Add `buildWakeStartedMessage` pure helper exported from `session.ts`. Returns null on malformed events (missing/wrong-type `task_id`); defaults optional fields permissively (`status: "stopped"`, empty strings).
- [x] Add `WakeStarted` to the type-only import from `./types.ts` in `session.ts`.
- [x] Add `private isInWake: boolean = false` field on SessionManager with JSDoc citing the wake plan.
- [x] Add `private handleTaskNotification(event)` method on SessionManager. Calls `buildWakeStartedMessage`; emits the frame via `writeLine`; flips `isInWake`; opens a fresh ActiveTurn with empty user-text. Suppresses (logs at debug) when already `isInWake` — nested-wake idempotency.
- [x] Wire the new arm into `handleInterTurnEvent`: `if (event.type === "system" && event.subtype === "task_notification") this.handleTaskNotification(event)`.
- [x] Extend `handleClaudeLine`'s ActiveTurn-cleanup site (`if (turn.gotResult) { this.activeTurn = null; }`) to also clear `isInWake` when it's set. Comment cites the plan's bracket-close design.

**Tests:**
- [x] `buildWakeStartedMessage` forwards all five SDK payload fields verbatim (task_id, tool_use_id, status, summary, output_file).
- [x] `buildWakeStartedMessage` accepts each of the three SDK `status` values (`completed`, `failed`, `stopped`).
- [x] `buildWakeStartedMessage` returns null for non-task_notification events (system/init, system/task_updated, result, user).
- [x] `buildWakeStartedMessage` returns null for task_notification events with missing/empty/wrong-type `task_id` (defensive guard).
- [x] `buildWakeStartedMessage` defaults missing optional fields permissively (empty strings, `status: "stopped"`).
- [x] `buildWakeStartedMessage` against the Step-1 captured fixture `v2.1.150-spike/test-monitor-wake-raw.jsonl`: parses the 90-line JSONL, feeds every event through the helper, asserts exactly one wake_started emerges with task_id `b9klbr5tx`, status `stopped`, summary containing `kernel`. Pins the empirical wire shape against the implementation.
- [-] Full SessionManager-level integration test (state-transition behavior of `handleTaskNotification` + ActiveTurn open + result-clears-isInWake) — deferred to Step 5's fixture-replay test, which exercises the full tugcode → IPC → tugdeck reducer round-trip.

**Checkpoint:**
- [x] `cd tugcode && bun x tsc --noEmit` clean.
- [x] `cd tugcode && bun test` green (443 / 443 — 6 new tests added; was 437).
- [x] `cd tugdeck && bun x tsc --noEmit && bun test` green (2892 / 2892).
- [x] `cd tugdeck && bun run audit:tokens lint` zero violations.
- [x] `cd tugrust && cargo nextest run` green (1324 passed, 9 skipped) — tugcast routes the new frames as opaque pass-through per Step 2's survey.

---

#### Step 4: tugdeck reducer + store wrapper — `waking` phase, handler, commit extension, guard loosening, comment update {#step-4}

**Depends on:** #step-2

**Commit:** `feat(tide-wake): reducer — waking phase, handleWakeStarted, handleTurnComplete extension, frameToEvent mint, guard loosen, comment refresh`

**References:** [D01] bracket pattern, [D03] additive guards, Spec [#spec-reducer-state, #spec-phase-transitions, #spec-guard-loosenings, #spec-wake-started-state-reset], [Q03] interrupt during wake, (#strategy)

**Artifacts:**
- `"waking"` added to `CodeSessionPhase` enum.
- `wakeTrigger` state field on `CodeSessionState` (default `null`).
- `handleWakeStarted` in `reducer.ts` — per the spec at [#spec-wake-started-state-reset], calls existing `resetPerTurnTelemetry()` helper at `reducer.ts:1619`; sets `phase: "waking"`, `wakeTrigger: event.wake_trigger`, marker `pendingUserMessage` (empty text, supplied turnKey).
- `handleTurnComplete` extension — the existing commit path gains one branch: when `state.phase === "waking"`, it commits the turn entry, clears `wakeTrigger` and `pendingUserMessage`, and transitions to `idle` (parallel to the existing `streaming → idle` commit). The commit must skip writing the empty-text marker `pendingUserMessage` into the committed entry to avoid a phantom empty user bubble — Step 4 verifies the existing commit code does this; if not, the branch adds the skip.
- Store-wrapper extension (`frameToEvent`) — recognizes `wake_started` frames, mints a turnKey, dispatches `WakeStartedEvent` to the reducer (mirrors the existing replay-event mint pattern at `reducer.ts:1606-1609`).
- Switch arm in the main reducer dispatcher (`reducer.ts:2826+`) for `wake_started` (single arm — no `wake_complete`).
- `handleTextDelta` guard accepts `"waking"`.
- `handleSend`, `handleInterrupt`, `handleTurnComplete` reviewed for `waking`-phase interactions — `handleSend` enqueues per existing `streaming`-phase behavior, `handleInterrupt` per [Q03] resolution.
- Comment at `reducer.ts:827` updated per [#spec-guard-loosenings].
- Exhaustive-switch type-checks for all phase-keyed code (tsc is the gate).

**Tasks:**
- [x] Add the enum value + state field. `"waking"` added to `CodeSessionPhase`; `WakeTrigger` interface (camelCase) added next to it; `wakeTrigger` field added to `CodeSessionState` and `CodeSessionSnapshot`.
- [x] Extend `frameToEvent` (store wrapper) to mint a turnKey on `wake_started` receipt and dispatch `WakeStartedEvent`. `"wake_started"` added to `KNOWN_CODE_OUTPUT_TYPES`; arm in `frameToEvent` mints via `mintTurnKey()` and spreads onto the dispatched event, mirroring the `user_message_replay` pattern.
- [x] Implement `handleWakeStarted` calling `resetPerTurnTelemetry()` (single source of truth — do NOT inline the field list). Wire payload's snake_case `wake_trigger` is translated to camelCase `WakeTrigger` at the reducer boundary; nested-wake idempotency refreshes trigger metadata only when prior was `null` and new is non-null; preserves `pendingDraftRestore` per spec note; `costAtSubmit` is set AFTER the `resetPerTurnTelemetry()` spread to override its `null` reset (the wake's cost-delta baseline must be the current `lastCost`).
- [x] Extend `handleTurnComplete`: add the `waking → idle` commit branch (clears `wakeTrigger`, clears `pendingUserMessage`, skips empty-text marker in the committed transcript entry). The committed `TurnEntry.userMessage.text` naturally carries `""` from the wake marker — that empty string IS the wake sentinel; no special `buildTurnEntry` branch needed. Queue-flush is skipped (a queued send during wake gets its own turn after the wake settles).
- [x] Wire the dispatcher arm for `wake_started` (no `wake_complete` arm). Single new case in `reduce()`'s switch.
- [x] Loosen the `handleTextDelta` guard. Also loosened the parallel guards in `handleToolUse`, `handleToolResult`, `handleToolUseStructured`, and `handleControlRequestForward` — without these, a wake's tool flow (Monitor wake fires Bash investigation, per Step 1's PPF-01 context) and any mid-wake permission/question prompt would be silently dropped. The wake stays in `waking` phase across tool events (mirrors replay's bracket-owns-phase pattern).
- [x] Update the comment at `reducer.ts:827`. New text describes the wake-bracket as the legitimate live source of mid-idle content and cites [D03].
- [x] Update every exhaustive `switch` on `CodeSessionPhase` to include `"waking"` (tsc was the gate). Updated: `lifecycle-state.ts` `deriveLifecycleState` (`waking → "streaming"` lifecycle row for Slice 1 — same chrome as a user turn), `tug-state-indicator.tsx` `indicatorVisualFor` (success+pulse), `tug-state-indicator.tsx` `PHASE_HUMAN_LABEL` (`waking: "Streaming"`).
- [x] Decide [Q03] (interrupt during wake): document the decision inline in `handleInterrupt` and add the corresponding behavior. **Default adopted: `canInterrupt = true` during `waking`; interrupt frame is the same shape as a normal-turn interrupt.** `canInterrupt` extended in `code-session-store.ts`. `handleInterrupt`'s CASE A path detects wake context (`state.phase === "waking"`), skips the draft-restore pull (the empty-text marker is NOT a user message), and clears `wakeTrigger` alongside the standard CASE A reset. CASE B path is unchanged — `interruptInFlight` opens, wire echo arrives as `turn_complete(error)`, the new `waking → idle` commit branch above clears `wakeTrigger` and commits an interrupted entry. Defensive clearing of `wakeTrigger` also added to `handleSessionStateErrored`, `handleWireError`, and `handleTransportClose`'s non-idle path so a wake-in-flight cleared by any terminal-error path leaves no dangling bracket marker.
- [x] **[L23 check]** {#step-4-l23-check}: Two `phase === "idle"` reads pre-flighted (`tide-card-telemetry-popovers.tsx:766` is a JSDoc-only reference, `tide-card-telemetry-renderers.tsx:607` is `isIdle = snap.phase === "idle"`). Both treat `waking` as not-idle correctly via the literal comparison (no special-case needed). Repo-wide `grep` for `phase === "idle"` confirmed: every code-side read is either a state-transition guard (where `waking` is intentionally distinct from `idle`) or an `isIdle`-style derivation (where the literal comparison correctly returns `false` during a wake). No first-responder / focus-restoration code reads phase at all.

**Tests:**
- [x] None at this step (tests live in #step-5).

**Checkpoint:**
- [x] `cd tugdeck && bun x tsc --noEmit` green (exhaustive-switch errors served as the gate; tsc surfaced 5 errors during Step 4 — 3 test-fixture omissions of the new `wakeTrigger` field, 2 snake_case/camelCase mismatches in `handleWakeStarted` — all fixed before the step closed).
- [x] `cd tugdeck && bun test` green (2892 / 2892).
- [x] `cd tugdeck && bun run audit:tokens lint` zero violations.
- [x] `cd tugrust && cargo nextest run` green (1324 passed, 9 skipped).
- [x] `cd tugcode && bun x tsc --noEmit && bun test` green (443 / 443).

---

#### Step 5: Tests — pure-logic reducer + fixture replay + drift {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `test(tide-wake): reducer + fixture replay + drift coverage`

**References:** [D01] [D03], [R01], (#test-plan-concepts)

**Artifacts:**
- `tugdeck/src/lib/code-session-store/__tests__/handle-wake.test.ts` (pure-logic — 26 tests, all green).
- `tugdeck/src/lib/code-session-store/__tests__/code-session-store.wake.test.ts` (store-wrapper + snapshot projections — 7 tests, all green). Split from the fixture-replay test so the per-store-wrapper concerns (turnKey mint, snapshot `canInterrupt` / `canSubmit` gates, end-to-end PPF-01 round-trip) stay separate from the fixture-grounding concerns.
- `tugdeck/src/__tests__/session-wake-fixture-replay.test.ts` (catalog replay — 3 tests, all green). Reads the Step-1 capture, extracts the wake signal + terminal assistant text fields, synthesizes the IPC frames tugcode emits, and drives the reducer end-to-end. Two scenarios: live wake bracket (with `wakeTrigger` survival assertion), and cold-boot replay regression (with the deferred-to-Slice-2 `wakeTrigger` loss documented).
- `tugcode/src/__tests__/wake-sdk-drift.test.ts` (3 tests, all green). Compile-time pinning of every SDK-declared field tugcode forwards via `buildWakeStartedMessage` PLUS a runtime cross-validation against the captured fixture's `task_notification` line that pins the wire shape (including `tool_use_id`, which the SDK type currently omits — documented in the test header for a future SDK type-fix).

**Tasks:**
- [x] Pure-logic: `handleWakeStarted` transitions `idle → waking` with `wakeTrigger` set and `pendingUserMessage` set to the empty-text marker; per-turn telemetry fields all reset (spot-checked `firstAssistantDeltaAt`, `lastStreamEventAt`, `maxStreamGapMs`, `interruptInFlight`, `awaitingApprovalAccumulatedMs`); `costAtSubmit` captures `state.lastCost` AFTER the helper-spread overrides its `null` reset; `pendingDraftRestore` preserved; defensive drop for every non-idle non-waking phase.
- [x] Pure-logic: `handleTurnComplete` during `waking` transitions `waking → idle` with `wakeTrigger` cleared, `pendingUserMessage` cleared, transcript entry committed; the committed entry's `userMessage.text === ""` (empty-string IS the wake sentinel — pinned explicitly so a future change to inject placeholder text would break this test); error-path also covered (interrupted partial wake commits as `result: "interrupted"`).
- [x] Pure-logic: `handleTextDelta` accepts text events during `waking`; still drops them during `idle` / `awaiting_approval` and other phases not on the allow-list ([D03] additive-guard contract pinned for both assistant_text and thinking_text).
- [x] Pure-logic: `handleTextDelta` during `waking` sets `activeMsgId` from the first event; explicit test that walks `wake_started → assistant_text → turn_complete` and confirms the `idle && null` early-return does NOT fire.
- [x] Pure-logic: nested wake (`handleWakeStarted` while already `waking`) is idempotent — second call is a same-state-ref no-op when `wakeTrigger` is already set; refresh path covered (synthetic `wakeTrigger === null` while phase still `waking` pins the refresh contract on the reducer side, even though the live path never produces this combination).
- [x] Pure-logic: `handleSend` during `waking` enqueues into `queuedSends`; the wake's commit does NOT auto-flush the queued send (the queued message waits for an explicit follow-up send — the wake does not surprise the user by dispatching their queued text).
- [x] Pure-logic: interrupt during wake ([Q03] resolution pinned with 4 tests):
  - CASE A wake pull-down: idle, clears `wakeTrigger`, sends interrupt frame, increments `pendingCaseAEchoes`, does NOT push the empty-text marker into `pendingDraftRestore`.
  - CASE A wake pull-down preserves any prior `pendingDraftRestore`.
  - CASE B wake interrupt: `interruptInFlight: true`, segment-start captured, `wakeTrigger` remains pending the bracket-close, phase stays `waking`.
  - Wire echo for CASE A wake pull-down is suppressed by `pendingCaseAEchoes` (turn_complete(error) with empty msg_id decrements the counter and produces zero effects).
- [x] Pure-logic: drop-case regression — every existing drop case (stray text outside any turn, thinking_text outside a turn, assistant_text from awaiting_approval) still drops.
- [x] Pure-logic: terminal-error paths defensively clear `wakeTrigger` — `session_state_errored`, `wire_error`, and `transport_close` from `waking` all leave `state.wakeTrigger === null`. Transport-close also commits a transport-lost transcript entry as part of the same dispatch.
- [x] Store-wrapper test: `frameToEvent` on a `wake_started` frame mints a turnKey (the wire frame deliberately omits one; assertion checks the snapshot's `inflightUserMessage.turnKey` is a non-empty string) and threads the camelCase `wakeTrigger` payload through to the snapshot; back-to-back wakes mint distinct turnKeys so per-turn paths don't collide.
- [x] Snapshot projection test: `canInterrupt` reads `true` and `canSubmit` reads `false` during `waking` (per [Q03] resolution); both flip on the wake's commit to `idle`.
- [x] Fixture replay: feed the Step-1 captured JSONL through the full pipeline — extract task_notification (line 49) and terminal assistant text (line 62) from the fixture, synthesize the IPC frames tugcode emits, drive through the reducer. Asserts: snapshot.phase is `waking` mid-bracket with translated camelCase `wakeTrigger`; on `turn_complete` the wake turn commits with empty-text user marker, the captured assistant text in `entry.assistant`, `wakeTrigger` cleared on the snapshot, and the per-turn write path carries the assistant text under the minted turnKey.
- [x] Cold-boot replay regression: replay the captured JSONL through the cold-boot path (`replay_started` → `user_message_replay` → `assistant_text` → `turn_complete` → `replay_complete`); confirms the wake turn paints correctly under `phase === "replaying"` and proves no Slice 1 work is needed on the replay translator. Asserts (and documents) that `wakeTrigger` is NOT preserved across cold-boot rehydration today — deferred to Slice 2 per [#slice-2-replay-translator].
- [x] Drift: compile-time check via typed variable declaration referencing `SDKTaskNotificationMessage` from `@anthropic-ai/claude-agent-sdk` — covers the 4 SDK-declared forwarded fields (`task_id`, `status`, `summary`, `output_file`) plus the status union literals. Cross-validated against the Step-1 fixture at `v2.1.150-spike/test-monitor-wake-raw.jsonl` line 49 — runtime check pins all 5 forwarded wire fields (the 4 SDK-declared + `tool_use_id`, which the SDK type currently omits — documented in the test header so a future SDK type-fix doesn't get treated as breaking).

**Tests:**
- [x] All new tests pass (36 new in tugdeck, 3 new in tugcode).

**Checkpoint:**
- [x] `cd tugdeck && bun test` green (2928 / 2928 — 36 new).
- [x] `cd tugdeck && bun x tsc --noEmit` green.
- [x] `cd tugdeck && bun run audit:tokens lint` zero violations.
- [x] `cd tugcode && bun x tsc --noEmit && bun test` green (446 / 446 — 3 new).
- [x] `cd tugrust && cargo nextest run` green (1324 passed, 9 skipped).

---

#### Step 6: Empirical cohort sweep — captures and three-cohort taxonomy {#step-6}

**Depends on:** #step-5

**Commit:** `plan(tide-wake): Step 6 — empirical cohort sweep, three-cohort taxonomy`

**References:** [Q01] (rewritten with sweep findings), [Q04] / [D05] (Slice 1b scheduler), [Q05] / [D06] (transcript), (#context, #success-criteria)

**Artifacts:**
- Six raw stream-json captures committed under `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.150-spike/` (or staged under `/tmp/tide-cohort-sweep/` and promoted to the catalog as part of this step):
  - `test-bash-runbg-wake-raw.jsonl` (Bash run_in_background idle-wait, 96 lines, Cohort A) — proves the original Step-1 "negative" claim was wrong.
  - `test-task-runbg-idle-wake-raw.jsonl` (Task run_in_background idle-wait, 66 lines, Cohort A) — two consecutive task_notifications (parent + child).
  - `test-task-runbg-poll-raw.jsonl` (Task run_in_background with active TaskOutput poll, 74 lines, no wake — claude blocks in tool).
  - `test-taskoutput-blocking-raw.jsonl` (TaskOutput blocking wait, 67 lines, no outer wake — inner Bash fires task_notification consumed by subagent).
  - `test-schedulewakeup-streamio.jsonl` (60 s ScheduleWakeup probe via `probe-sw-streamio.mjs`, 30 lines + 60 s of silence — confirms Cohort B harness re-invoke does NOT fire in `--input-format=stream-json` mode).
  - `test-croncreate-streamio.jsonl` (1-min CronCreate, 58 lines, claude exits before fire — same Cohort B finding).
- The probe script `probe-sw-streamio.mjs` itself, committed under `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.150-spike/probes/` so future verifications re-run without rediscovery.
- Updated [Q01] (rewritten — three cohorts, with capture file names and signatures).
- Updated PPF-01 entry in [tide-assistant-rendering.md](./tide-assistant-rendering.md): flipped to "Resolved for Cohort A; Cohort B closed by Slice 1b" with back-link.
- Net-new design decisions: [D05] (tugcode scheduler), [D06] (transcript single-row).

**Tasks:**
- [x] Capture Bash `run_in_background:true` with idle wait (no BashOutput poll instruction); confirm task_notification fires. **Found: ORIGINAL STEP-1 CLAIM WAS WRONG** — task_notification does fire; the earlier negative was an artifact of the prompt instructing claude to poll.
- [x] Capture Task `run_in_background:true` with idle wait — both parent and child fire task_notification. New subtype `system/task_progress` discovered.
- [x] Capture Task `run_in_background:true` with TaskOutput poll — no task_notification (claude blocks in tool).
- [x] Capture TaskOutput blocking wait — same blocking behavior; inner Bash fires task_notification but outer claude blocks.
- [x] Capture ScheduleWakeup via stream-json probe (`probe-sw-streamio.mjs`) — held subprocess alive 90s past a 60s wake; ZERO output after `result/success`. Cohort B confirmed not deliverable in tugcode's spawn mode.
- [x] Capture CronCreate — same Cohort B finding; tool result text confirms session-scoped lifetime.
- [x] Confirm `PushNotification` is sync outbound (`capture-pushnotif.jsonl`) — not a wake source.
- [x] Confirm `RemoteTrigger` does not exist in claude 2.1.150 — remove from plan (`capture-remotetrigger-schema.jsonl`).
- [x] Rewrite [Q01] with the captured three-cohort taxonomy (Cohort A in-invocation async, Cohort B harness re-invoke, Cohort C not-wake-sources).
- [x] Document the new wire signals discovered (`task_started` / `task_progress` / `task_updated` / `status`) as Slice 2 chrome opportunities.
- [x] Document the SDK type drift discovered (`tool_use_id` and `usage` fields present on the wire, missing from `SDKTaskNotificationMessage`).
- [ ] Promote the staging captures from `/tmp/tide-cohort-sweep/` into the catalog under `v2.1.150-spike/` and commit them as artifacts (currently the captures exist but are not committed).
- [ ] Update PPF-01 in [tide-assistant-rendering.md](./tide-assistant-rendering.md) — closed for Cohort A; ScheduleWakeup/CronCreate noted as closed by Slice 1b once that ships.

**Tests:**
- [x] None new — Step 5's tests cover the Cohort A reducer/store/fixture behavior. Step 6 is an empirical sweep; its output is the captured fixtures + the rewritten taxonomy.

**Checkpoint:**
- [x] Three-cohort taxonomy committed in [Q01] with capture file references.
- [x] Cohort A manual Monitor repro passes (Session d258c0da screenshot — wake turn paints; phantom user bubble noted as Step 12 work).
- [x] Cohort B confirmed broken in tugcode spawn mode by probe (90s subprocess hold; no wake fired); Slice 1b is the closer.
- [ ] Captures promoted to the committed catalog (currently staged under `/tmp/tide-cohort-sweep/`).
- [ ] PPF-01 entry in the rendering plan updated.

---

#### Step 7: Slice 1 integration checkpoint (Cohort A complete) {#step-7}

**Depends on:** #step-3, #step-4, #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** [D01] [D02] [D03] [D04], (#success-criteria)

**Tasks:**
- [ ] Re-run all four gates from the project's standard checkpoint: tsc / bun test / audit:tokens lint / cargo nextest.
- [ ] Confirm the new fixture-replay test runs in the standard `bun test` invocation (not gated behind a flag).
- [ ] Confirm PPF-01 is closed for Cohort A in the rendering plan.
- [ ] Confirm L02 contract held: any React component reading `wakeTrigger` goes through `useSyncExternalStore`, not through `useEffect` mirror state. (Slice 1 has no consumers; this is a forward-looking note for Slice 2 implementers.)

**Tests:**
- [ ] Full test suite green.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test && bun run audit:tokens lint && cd ../tugrust && cargo nextest run` — all four green in sequence.

---

#### Step 8: Slice 1b — croner integration + WakeScheduler class {#step-8}

**Depends on:** #step-7

**Commit:** `feat(tide-wake-1b): add croner; introduce WakeScheduler class`

**References:** [D05] tugcode scheduler, [Q04] cohort B closer

**Artifacts:**
- `tugcode/package.json` adds `"croner": "^10.0.1"` to `dependencies`. `bun install` updates `bun.lock` deterministically.
- New module `tugcode/src/scheduler.ts` exporting `WakeScheduler` class. Construction signature: `new WakeScheduler({ emitFrame, writeStdin, logger })` where `emitFrame: (msg: OutboundMessage) => void` and `writeStdin: (line: string) => void` are injected by `SessionManager` (keeps the class testable without the full session machinery).
- Public API: `schedule({ kind: "delay", taskId, delaySeconds, prompt, reason }) | { kind: "cron", taskId, cron, prompt, recurring }`; `cancel(taskId): boolean`; `cancelOnHarnessNotification(taskId): void`; `dispose(): void`. All methods take/return synchronous values — the actual fire-time async is managed inside the class via croner.
- Internal state: `private jobs: Map<string, { cron: Cron, prompt: string, recurring: boolean, scheduledAt: number, kind: "delay" | "cron" }>`. Lifecycle: `dispose()` stops every job (`job.cron.stop()`) and clears the map; called from `SessionManager.dispose()`.
- Fire callback (executed by croner when a job's time hits): packages a `wake_started` IPC frame via `emitFrame()` and a stream-json user_message via `writeStdin()`. Both invocations are wrapped in a try/catch — a downstream throw must not unschedule sibling jobs.

**Tasks:**
- [ ] `cd tugcode && bun add croner@^10.0.1` — install the dep; verify `bun.lock` updates with zero transitive deps.
- [ ] Create `tugcode/src/scheduler.ts` with the `WakeScheduler` class per the API above.
- [ ] Wire the class into `SessionManager` construction (`session.ts`): allocate one `WakeScheduler` per session; pass `(msg) => this.writeLine(JSON.stringify(msg))` as `emitFrame` and `(line) => this.claudeStdin.write(line + "\n")` as `writeStdin` (or whatever the existing channel names are — confirm against current `session.ts`).
- [ ] Wire `WakeScheduler.dispose()` into `SessionManager.dispose()` so a session teardown stops every scheduled job.
- [ ] JSDoc on every public method citing [D05] / [Q04] and the relevant captures.

**Tests:**
- [ ] Pure-logic: `schedule` with `{ kind: "delay" }` accepts a delay in seconds and registers a croner Cron with a future Date target; assert `cron.nextRun()` is within `[now + delay − 50ms, now + delay + 50ms]`.
- [ ] Pure-logic: `schedule` with `{ kind: "cron" }` accepts a 5-field cron expression and registers a croner Cron pattern; `recurring:false` configures `maxRuns:1`.
- [ ] Pure-logic: `cancel(taskId)` returns true if job existed and is stopped (`job.cron.isStopped() === true`); returns false for an unknown taskId.
- [ ] Pure-logic: `cancelOnHarnessNotification(taskId)` cancels the matching job (the double-fire safety hook from [D05]) — silent no-op for an unknown taskId.
- [ ] Pure-logic: `dispose()` stops every job and clears the map; a second `dispose()` is idempotent.
- [ ] Integration: a 200ms `kind: "delay"` job actually fires its callback (use a real timer, no fakes — bun:test supports this fine for short delays); assert `emitFrame` was called with `type:"wake_started"` and `writeStdin` was called with the JSON line carrying the scheduled prompt.

**Checkpoint:**
- [ ] `cd tugcode && bun x tsc --noEmit && bun test` green.
- [ ] `cd tugcode && bun audit` — no high-severity advisories on croner or its transitive deps (it has zero deps; this should be trivially clean).

---

#### Step 9: Slice 1b — tugcode tool-use interception {#step-9}

**Depends on:** #step-8

**Commit:** `feat(tide-wake-1b): intercept ScheduleWakeup / CronCreate / CronDelete tool calls`

**References:** [D05], [Q04]

**Artifacts:**
- New private method on `SessionManager`: `handleSchedulingToolUse(event: AssistantToolUse): void`. Called from the per-turn dispatcher (`routeTopLevelEvent`) when a `tool_use` event matches one of three tool names (`ScheduleWakeup`, `CronCreate`, `CronDelete`). The intercept runs ALONGSIDE the normal tool_use forwarding to tugdeck — claude's tool_use frame still reaches tugdeck (the user sees the tool call in the transcript); we just additionally register a shadow job on our side.
- The intercept inspects `event.input` (an `unknown` payload from the wire). Parsing is defensive: required fields must match the SDK's tool schemas, otherwise log at warn level and skip (claude probably has a stale schema — drop the shadow rather than scheduling garbage).
- **ScheduleWakeup intercept** reads `{delaySeconds: number, prompt: string, reason?: string}` from `event.input`. Calls `this.scheduler.schedule({ kind: "delay", taskId: event.tool_use_id, delaySeconds, prompt, reason })`. Logs at info level: `tide::wake-scheduler::scheduled kind=delay tool_use_id=… delaySeconds=…`.
- **CronCreate intercept** reads `{cron: string, prompt: string, recurring: boolean}` from `event.input`. Calls `this.scheduler.schedule({ kind: "cron", taskId: event.tool_use_id, cron, prompt, recurring })`. Logs equivalent.
- **CronDelete intercept** reads `{id: string}` from `event.input` (or whatever the tool's argument key actually is — verify against `capture-croncreate.jsonl` and the CronCreate response shape; the response says `id:"3ea6c934"`, so CronDelete likely takes `id`). Calls `this.scheduler.cancel(id)`. Important: claude's CronCreate generates its own task id (e.g. `3ea6c934`) but our shadow registered under `tool_use_id`. We need to map between the two — store the claude-side `id` from the CronCreate tool_result and key our shadow on that for cancellation. See task list below.

**Tasks:**
- [ ] Add the `handleSchedulingToolUse` method on `SessionManager`. Place it next to `handleTaskNotification` so the wake-related intercepts cluster.
- [ ] Wire the dispatch site: in `routeTopLevelEvent` (or the per-turn equivalent), when `event.type === "tool_use"` and `event.tool_name in {ScheduleWakeup, CronCreate, CronDelete}`, call the intercept BEFORE the existing forward-to-tugdeck path. Forwarding still happens — the intercept is purely additive.
- [ ] Handle the CronCreate → CronDelete `id` mapping. CronCreate's `tool_result` carries `{id: "3ea6c934", …}`. Watch for the matching `tool_result` event (the `tool_use_id` matches the tool_use we shadowed), parse `tool_result.toolUseResult.id`, and update the scheduler entry's key from `tool_use_id` to the claude-side `id`. CronDelete's intercept then keys lookup by claude's `id`. (Alternative: maintain a `Map<claudeCronId, tool_use_id>` lookup table.)
- [ ] JSDoc on every intercept citing the relevant Step-6 capture file as the empirical anchor for the tool's input shape.

**Tests:**
- [ ] Pure-logic: `handleSchedulingToolUse` on a `ScheduleWakeup` event calls `scheduler.schedule({ kind: "delay", … })` with the parsed payload; a malformed input (missing `delaySeconds`) logs a warning and does NOT schedule.
- [ ] Pure-logic: same for `CronCreate` (`kind: "cron"`) and `CronDelete` (`cancel` call).
- [ ] Pure-logic: CronCreate → tool_result with `id:"3ea6c934"` → CronDelete with `id:"3ea6c934"` cancels the right shadow job.
- [ ] Pure-logic: tool_use events for OTHER tool names (Bash, Read, etc.) bypass the intercept entirely (no scheduler call).

**Checkpoint:**
- [ ] `cd tugcode && bun x tsc --noEmit && bun test` green.

---

#### Step 10: Slice 1b — wake fire path + double-fire safety {#step-10}

**Depends on:** #step-9

**Commit:** `feat(tide-wake-1b): wake fire path; double-fire guard against harness re-invoke`

**References:** [D05], [Q04]

**Artifacts:**
- Fire-callback implementation inside `WakeScheduler` (already stubbed in Step 8; this step completes it). On fire:
  1. Emit `wake_started` IPC frame to tugdeck via the injected `emitFrame`. Payload: `{type: "wake_started", session_id, wake_trigger: {task_id: <tool_use_id>, tool_use_id: <tool_use_id>, status: "completed", summary: <reason ?? "scheduled wake">, output_file: ""}, ipc_version}`. Choosing `status:"completed"` because the timer fired successfully; `summary` repurposes the user-supplied `reason` so Slice 2 chrome has something to show.
  2. Write stream-json user_message frame to claude's stdin: `{"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": <prompt>}]}}\n`. Identical shape to what the CLI harness's queue-operation enqueue would produce.
  3. For `kind: "delay"` jobs, remove the entry from the scheduler map (one-shot). For `kind: "cron"` recurring jobs, leave the entry in place; croner re-fires on each next match.
- **Double-fire safety hook:** `SessionManager.handleTaskNotification` (already routes Cohort A wakes) gains one extra line BEFORE emitting the `wake_started` frame for the cohort-A path: `this.scheduler.cancelOnHarnessNotification(event.task_id)`. If the harness ever does fire for a task we shadowed, the shadow is silently cancelled; the harness's own `task_notification` continues through the Cohort A path and the wake renders once. Symmetric: if our shadow fires first, the harness's later notification (if any) finds no matching scheduler entry — the cancel hook is a no-op and the Cohort A path still emits a `wake_started`; tugdeck's reducer detects the nested wake via `state.phase === "waking"` and the existing idempotency logic at [D01] absorbs the duplicate.

**Tasks:**
- [ ] Complete `WakeScheduler` fire-callback per the artifacts above.
- [ ] Hook the cancel-on-notification call in `SessionManager.handleTaskNotification`.
- [ ] Verify the synthetic user_message frame's shape against the user's Session 56cce4fe line 28 (`isMeta:true` is internal to the persistence layer; the stream-json wire shape is just `{type:"user", message:{role:"user", content:[…]}}`). The session JSONL's `isMeta:true` flag is a persistence-layer annotation; the stream-json wire does not carry it.
- [ ] Log lifecycle at info: `tide::wake-scheduler::fired kind=… tool_use_id=… delay_or_cron=…`.

**Tests:**
- [ ] Pure-logic: a fired delay job invokes `emitFrame` exactly once with a `wake_started` frame whose `wake_trigger.task_id` matches the scheduled `tool_use_id`.
- [ ] Pure-logic: a fired delay job invokes `writeStdin` exactly once with a JSON line that parses to `{type:"user", message:{role:"user", content:[{type:"text", text: <prompt>}]}}`.
- [ ] Pure-logic: a `kind:"cron"` job with `recurring:true` keeps re-firing (assert `emitFrame` called N times for N croner ticks); a `kind:"cron"` job with `recurring:false` fires exactly once.
- [ ] Pure-logic: `cancelOnHarnessNotification(taskId)` cancels the matching job and the firer's `emitFrame` is never called for that job after cancel.
- [ ] Pure-logic: double-fire safety end-to-end — schedule a shadow job, simulate a harness `task_notification` for the same `task_id` arriving before the shadow timer would fire (`handleTaskNotification` flow); assert the shadow's `emitFrame` is NOT called and the harness path's own `wake_started` IS emitted.

**Checkpoint:**
- [ ] `cd tugcode && bun x tsc --noEmit && bun test` green.

---

#### Step 11: Slice 1b — manual cohort B repro + drift {#step-11}

**Depends on:** #step-10

**Commit:** `N/A (verification only) — Slice 1b manual gate`

**References:** [Q04], [D05]

**Artifacts:**
- Re-run of Step 6's ScheduleWakeup and CronCreate manual repros in Tide. Wake turns now paint.
- Updated PPF-01 in [tide-assistant-rendering.md](./tide-assistant-rendering.md) noting Cohort B is closed.
- A drift test in `tugcode/src/__tests__/wake-scheduler-tool-input-drift.test.ts` that pins the input shapes of ScheduleWakeup, CronCreate, CronDelete against the actual tool schemas (the SDK exposes these via ToolSearch / system reminder; the test re-captures them at boot and asserts the keys we read are present).

**Tasks:**
- [ ] Manual: ScheduleWakeup 60s — wake turn paints in Tide, transcript shows no phantom user bubble (Step 12 must have shipped for this to be true), wake's response is rendered. Capture a screenshot for the plan record.
- [ ] Manual: CronCreate one-shot in 1 min — same.
- [ ] Manual: CronCreate recurring `* * * * *` — fires every minute; verify CronDelete (via claude calling it) cancels the shadow job.
- [ ] Manual: ScheduleWakeup at 60s + run claude long enough that the harness MIGHT fire (60s is the SDK minimum). If the harness fires, the double-fire guard cancels the shadow — verify only ONE wake turn paints.
- [ ] Update PPF-01.

**Tests:**
- [ ] Drift test passes.

**Checkpoint:**
- [ ] All three manual cases pass.
- [ ] PPF-01 closed for Cohort B.

---

#### Step 12: Slice 1c-a — TideTranscriptDataSource wake single-row {#step-12}

**Depends on:** #step-7 (Slice 1 ships the wake bracket; the data-source fix lands on top)

**Commit:** `fix(tide-wake-1c): transcript data source treats wake turns as single-row entries`

**References:** [D06], [Q05]

**Artifacts:**
- New helper `isWakeTurn(turn: TurnEntry): boolean` in `tide-transcript-data-source.ts`, exported for test reuse. Definition: `turn.userMessage.text === "" && turn.userMessage.attachments.length === 0`. Pinned to the empty-text sentinel from [D01] / Step 4. The same predicate applied to `inflightUserMessage` covers the in-flight wake case (`isWakeInflight(inflight)`).
- New private memoized helper on `TideTranscriptDataSource`: `private layoutMemo: { snapshot, layout } | null`. The `layout` is a `RowLayout` object built once per snapshot identity (same memoization pattern as `_windowsMemo`):
  ```ts
  interface RowLayout {
    /** Total number of rows the data source exposes. */
    totalRows: number;
    /** For each turnIndex, the flat row index where that turn's first row lives. */
    turnStartRow: number[];
    /** For each turnIndex, true if the turn occupies one row (wake), false if two. */
    isWakePerTurn: boolean[];
    /** Flat row index where the inflight pair (or wake row) starts; -1 if none. */
    inflightStartRow: number;
    /** True when the inflight is a wake (1 row); false when normal (2 rows). */
    inflightIsWake: boolean;
    /** Flat row index where ghost rows start; equals totalRows when no ghosts. */
    ghostStartRow: number;
  }
  ```
- All public methods (`numberOfItems`, `idForIndex`, `kindForIndex`, `rowAt`) read the layout instead of doing inline index math.
- `userRowIndexForTurn(turnIndex)` becomes `layout.isWakePerTurn[turnIndex] ? -1 : layout.turnStartRow[turnIndex]`. Callers that pass a wake turn's index get a sentinel they must handle — the only callers today are the Z2 telemetry popovers for scroll-into-view; they iterate `snapshot.transcript` so they CAN encounter wake turns. Callers must check `>= 0` before using the returned index.
- `assistantRowIndexForTurn(turnIndex)` returns the assistant row's index regardless of whether the turn has a user row: `layout.turnStartRow[turnIndex] + (layout.isWakePerTurn[turnIndex] ? 0 : 1)`. (Wake turns occupy a single row at `turnStartRow[turnIndex]`, which IS the assistant row.)
- Inflight handling: when `inflightUserMessage !== null`, the layout adds either 1 or 2 rows starting at `inflightStartRow`. If the inflight is a wake (empty-text marker), only the code row exists; if normal, both user and code.

**Tasks:**
- [ ] Add `isWakeTurn` and `isWakeInflight` helpers; export.
- [ ] Add the `RowLayout` type and the per-snapshot memoization.
- [ ] Refactor `numberOfItems`, `idForIndex`, `kindForIndex`, `rowAt` to read from `layout`. The `idForIndex` for wake turns must NOT mint a `${turnKey}-user` key (only `${turnKey}-code`) — that's the React-reconciliation correctness invariant from [L26].
- [ ] Update `userRowIndexForTurn` and `assistantRowIndexForTurn` accordingly. Find every caller (`grep -rn "userRowIndexForTurn\|assistantRowIndexForTurn" tugdeck/src`); audit each for `>= 0` checks and add where missing.
- [ ] JSDoc on every helper + on the layout type, citing [D06] / [Q05] and the empty-text sentinel.

**Tests:**
- [ ] Pure-logic: `numberOfItems` returns `2 * (non-wake count) + 1 * (wake count) + inflight rows + queuedSends.length` for a mixed transcript.
- [ ] Pure-logic: `kindForIndex` returns `"code"` for a wake turn's single row (never `"user"` for that index).
- [ ] Pure-logic: `idForIndex` for a wake turn's row returns `${turnKey}-code` (the `-user` key is never minted for a wake — would mismatch the cell wrapper and break React reconciliation).
- [ ] Pure-logic: `rowAt` for a wake turn returns `{kind: "code", turn, perTurnTokens, turnKey}` directly (no descriptor for the absent user row).
- [ ] Pure-logic: a mixed transcript with `[user-turn, wake-turn, user-turn]` lays out as `[user, code, code, user, code]` (5 rows, not 6).
- [ ] Pure-logic: an inflight wake (in-flight `inflightUserMessage.text === ""`) takes 1 row, not 2; an inflight user turn takes 2.
- [ ] Pure-logic: `userRowIndexForTurn(turnIndex)` returns `-1` for a wake turn at `turnIndex`, returns the right offset for a non-wake turn.
- [ ] Pure-logic: `assistantRowIndexForTurn(turnIndex)` returns the wake's single row for a wake turn, returns the offset+1 for a non-wake turn.
- [ ] Reference-stability: two consecutive `rowAt(index)` calls with the same snapshot return rows whose payload references are `Object.is`-equal (the layout is memoized; the per-turn `turn` and `inflight` refs come from the snapshot directly).

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test` green.

---

#### Step 13: Slice 1c-a — manual repro of the phantom-bubble fix {#step-13}

**Depends on:** #step-12

**Commit:** `N/A (verification only) — Slice 1c-a manual gate`

**References:** [D06], [Q05]

**Tasks:**
- [ ] Manual: re-run the Step 6 Monitor wake (PPF-01 repro). Confirm the transcript shows NO phantom user bubble between user-initiated turns. The wake's row is just the assistant's response.
- [ ] Manual: re-run a mid-stream wake (start a user turn, let it complete, fire ScheduleWakeup → wake fires while idle). Confirm the wake's single-row layout doesn't disrupt the surrounding user turns' identity (turnKeys are stable, no scroll jumps).
- [ ] Audit every caller of `userRowIndexForTurn` / `assistantRowIndexForTurn` — confirm they handle the `-1` sentinel.
- [ ] Update PPF-01 in [tide-assistant-rendering.md](./tide-assistant-rendering.md) — now closes both the Cohort A wake-paint bug AND the phantom-bubble bug.

**Tests:**
- [ ] No new tests at this step (Step 12's pure-logic suite is the test gate; this is a UX gate).

**Checkpoint:**
- [ ] Visual confirmation of no phantom bubble.
- [ ] PPF-01 closed across all three slices.

---

#### Step 14: Slice 1c-b — forward-looking transcript sequence-model handoff {#step-14}

**Depends on:** none (forward-looking only; produces a NEW plan, not changes to this one)

**Commit:** `N/A (plan handoff)`

**References:** [Q05], [D06]

**Artifacts:**
- New plan file `roadmap/tugplan-tide-transcript-sequence-model.md`, drafted as a sibling plan. References this plan's [Q05] / [D06] / Step 12 as the precedent that exposed the architectural mismatch.
- This plan's Step 14 produces ONLY the new plan document. No code changes here.

**Sketch of the follow-on plan's scope (for the implementer who picks it up):**
- Replace `TurnEntry`'s paired `userMessage` + `assistant` fields with `messages: ReadonlyArray<TranscriptMessage>` where each message is one of:
  - `{kind: "user", text, atoms, submitAt}` — user submission
  - `{kind: "wake", trigger, scheduledAt}` — wake bracket open (consumed by chrome, no body)
  - `{kind: "assistant-text", text, msgId}` — one `type:"assistant"` message's text block
  - `{kind: "assistant-tool", toolUseId, toolName, input, result, structuredResult, status}` — one tool call+result pair
  - `{kind: "system-note", text, source}` — runtime-injected notes (auto-reminders, etc.)
- Reducer rework: every `commit` site (handleTurnComplete, the queue-flush branch, the waking→idle branch, the transport-lost commit, the replay commits) constructs the `messages` array from the per-turn telemetry/scratch state.
- Replay translator: emits per-message events rather than the current `assistant_text`-accumulator pattern.
- Transcript data source: becomes a flat enumerator over the cross-turn message sequence. Indexes are 1:1 with messages; no per-turn pairing math.
- Renderer: per-message-kind cell registration. The `cellRenderers` map gains entries for each `kind`.
- Persistence: the JSONL persistence layer (cold-boot replay) gets a new message-shaped record format. Backwards compatibility for old persisted formats (read-only) via a forward-only translator that splits old paired entries into the new message array.

**Tasks:**
- [ ] Draft `roadmap/tugplan-tide-transcript-sequence-model.md` covering the sketch above as a full plan (Phase Overview, Open Questions, Design Decisions, Specification, Execution Steps, etc.).
- [ ] Cross-link from this plan's [Q05] and [#roadmap] to the new plan.

**Tests:**
- [ ] N/A (plan only).

**Checkpoint:**
- [ ] New plan document exists and conforms to the tugplan skeleton format.

---

#### Step 15: Final integration checkpoint (all slices) {#step-15}

**Depends on:** #step-7 (Slice 1), #step-11 (Slice 1b), #step-13 (Slice 1c-a). Step 14 (the sequence-model follow-on plan) is independent and need not gate this checkpoint.

**Commit:** `N/A (verification only) — final integration`

**References:** every [Dnn], (#success-criteria)

**Tasks:**
- [ ] Re-run all four gates from the project's standard checkpoint: `tsc / bun test / audit:tokens lint / cargo nextest`.
- [ ] Manual: full PPF-01 reproduction matrix — Monitor 5s, Bash `run_in_background:true` (idle), Task `run_in_background:true` (idle), ScheduleWakeup 60s, CronCreate one-shot, CronCreate recurring → CronDelete. All six wake turns paint correctly with no phantom user bubble.
- [ ] Confirm PPF-01 is fully closed in the rendering plan with the three-cohort context.
- [ ] Confirm `wake_started` IPC frames are the single channel by which both Cohort A (tugcode detector) and Cohort B (tugcode shadow scheduler) feed the tugdeck reducer. The reducer doesn't know or care which path produced the frame — exactly what [D01]'s bracket design promised.
- [ ] L02 + L23 + L26 audit: the snapshot's `wakeTrigger` reaches React via `useSyncExternalStore` only (Slice 1 has no consumers; Slice 2 readers must obey); the responder-chain focus destination is unchanged through `waking → idle`; the transcript cell wrapper survives the wake bracket without remounting.

**Tests:**
- [ ] Full test suite green across tugdeck + tugcode + tugrust.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test && bun run audit:tokens lint && cd ../tugrust && cargo nextest run && cd ../tugcode && bun x tsc --noEmit && bun test` — all five green in sequence.
- [ ] Manual repro matrix passes for all six Cohort A + Cohort B cases.

---

### Roadmap / Follow-ons (Explicitly Not Required for This Plan) {#roadmap}

- **Slice 1c-b — transcript sequence-model rework.** Forward-looking plan handoff produced by Step 14 (`roadmap/tugplan-tide-transcript-sequence-model.md`). Replaces `TurnEntry`'s paired structure with a per-turn message sequence to handle wakes, multiple consecutive assistant messages, system notes, and tool-only turns as first-class. Slice 1c-a in this plan handles wakes specifically; the broader rework is the follow-on.
- **Slice 2 — trigger-aware chrome.** Render wake turns with a chip / banner showing the trigger ("Monitor t-abc completed", "ScheduleWakeup fired", etc.). Resolves [Q02] if real-use feedback says it's needed. Slice 1b's `wake_trigger.summary` already carries the user-supplied `reason` text from ScheduleWakeup; Slice 2 chrome can surface it without further reducer changes.
- **Slice 2 — replay-translator metadata persistence** {#slice-2-replay-translator}. Today, cold-boot rehydration of historic wake turns paints them through the `replaying` phase correctly, but the `wakeTrigger` metadata is lost (replay events don't carry it). Slice 2 chrome that wants to render the trigger needs the translator to synthesize `wake_started` frames (with the captured trigger payload) inline within the existing `replay_started/replay_complete` bracket. No `wake_complete` synthesis needed — the replayed `turn_complete` closes it the same way the live path does.
- **Slice 2 — system-note rendering for the scheduled `prompt` text.** Slice 1b's wake injection writes the `prompt` to claude's stdin but does NOT surface it in the transcript. Slice 2 may render the prompt as a system-note row above the wake's response — gives the user a "wake fired with prompt: 'X'" context line. Requires Slice 1c-b's sequence model to land first.
- **Slice 2 — surface `task_progress` events.** The Step 6 sweep discovered the `system/task_progress` wire event (intermediate progress updates with `usage` / `last_tool_name` fields). Currently dropped. Slice 2 chrome may surface as in-flight progress detail on long-running tool work.
- **Durable scheduling across tugcode restarts.** Slice 1b is session-scoped (matches claude's native behavior). A future enhancement persists scheduled wakes to disk so they survive a tug.app restart. Out of scope for this plan; would require a persistence design + replay-on-restart logic.
- **Wake-aware Stop button.** [Q03] resolved with the default `canInterrupt = true` during `waking`. Real-use feedback may suggest a "Stop the agent + cancel the underlying schedule" combined affordance for Slice 1b wakes — currently the Stop button stops the in-flight turn but leaves the croner job intact for the next fire on recurring CronCreate. Worth a polish pass.
- **Telemetry surface for wakes.** A dev-panel inspector showing "how many turns this session were wakes vs user-initiated", broken down by cohort. Useful for understanding tool-cohort traffic patterns and confirming the shadow scheduler is being exercised.
- **Re-investigate `Task run_in_background` polling cohort.** Currently Task with TaskOutput polling stays in Cohort C (no wake). Worth re-investigating only if a real-use issue surfaces — would need to verify whether the SDK fires task_notification while TaskOutput blocks.
