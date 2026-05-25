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
| Last updated | 2026-05-24 |

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
- **Ship in two slices.** Slice 1: wire + reducer + tests + cohort verification (UI shows wake turn correctly, no chrome differentiation). Slice 2 (deferred to a follow-up plan): trigger-aware chrome for wake turns + replay-translator metadata. Slice 1 closes PPF-01; Slice 2 is polish.

#### Success Criteria (Measurable) {#success-criteria}

- A live test session with the PPF-01 reproduction recipe (`> Use the Monitor tool to tail /var/log/system.log until you see the word "kernel"…`) paints the post-60s timeout turn in Tide without reopening the session. Measured manually against the repro recipe; pass = the resumed text appears in the transcript.
- A fixture-replay test loads the captured wake session JSONL from Step 1 and asserts that the resumed assistant text lands in the transcript (not in dropped events). Pass = test exits 0.
- Step 1's empirical cohort sweep pins which mechanisms route through task_notification vs. other re-entry paths, and the plan claims are tightened to only the verified mechanisms.
- `cd tugdeck && bun x tsc --noEmit && bun test && bun run audit:tokens lint` stays green across all commits.
- `cd tugrust && cargo nextest run` stays green across all commits.
- The first-responder focus destination is unchanged by a wake (prompt-entry stays focused through `waking → idle` transitions). Verified at [#step-4-l23-check].

#### Scope {#scope}

1. New wire frame type: `wake_started` (TS type + Rust definition pass-through in tugcast). No `wake_complete` — `turn_complete` is the close.
2. tugcode detector + emitter: detects "content arriving in idle with no preceding user_message" and emits `wake_started`; attaches task-notification payload as trigger metadata when present.
3. tugdeck reducer: new `waking` phase, new `handleWakeStarted` (delegates per-turn telemetry reset to existing `resetPerTurnTelemetry()` helper at `reducer.ts:1619`), guard loosening in `handleTextDelta`, extension to `handleTurnComplete`'s commit path for the `waking → idle` transition, a `wakeTrigger` state field. Store-wrapper change in `frameToEvent` to mint the turnKey on receipt of `wake_started` (mirrors the existing replay pattern).
4. Comment update at `reducer.ts:827` so the old "Live Claude should not emit this" assertion no longer reads as a reason to revert the guard change.
5. Pure-logic reducer tests + a fixture-replay test against a captured wake session.
6. Cohort verification: each tool in the provisional cohort exercised against the new path; plan claims tightened to the verified subset.
7. PPF-01 entry in [tide-assistant-rendering.md](./tide-assistant-rendering.md) updated to point at this plan; closed when this plan ships.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Visual differentiation of wake turns in the transcript (wake turn looks identical to a user-initiated turn for v1). Deferred to a follow-up plan.
- A "what triggered this?" chip / banner on wake turns. Deferred (Slice 2).
- Rendering the synthetic user-message-replay text (e.g., "Monitor timed out, re-arm if needed") as a transcript entry. Slice 1 drops it; Slice 2 may render it as a system note.
- Persisting `wakeTrigger` metadata through the cold-boot replay translator. Deferred (Slice 2).
- Changes to the WebSocket heartbeat interval/timeout. Not the bug; out of scope.
- Server-initiated session migration / failover. Distinct subsystem.

#### Dependencies / Prerequisites {#dependencies}

- [PPF-01] in [tide-assistant-rendering.md](./tide-assistant-rendering.md#ppf-01) (the bug entry).
- Existing replay-bracket machinery (`reducer.ts` `handleReplayStarted`/`handleReplayComplete`, transcript `replaying` phase, JSONL replay translator). This plan re-uses the pattern.
- `@anthropic-ai/claude-agent-sdk` `SDKTaskNotificationMessage` shape (`sdk.d.ts:1659-1668`). Pinned to the version tugcode currently consumes.
- Store-wrapper turnKey-minting machinery (the wrapper that mints `turnKey` for replay events per `reducer.ts:2703-2705`). The new `wake_started` frame consumes the same minting pattern.

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

#### [Q01] Empirical event-shape characterization for spontaneous wake (RESOLVED via PPF-01 session log analysis) {#q01-event-shapes}

**Question:** Three sub-questions about the wake mechanism's wire shape.

**Resolution:** RESOLVED via two raw stream-json captures of `claude -p --output-format=stream-json --verbose --include-partial-messages --permission-mode=bypassPermissions`:

1. **Monitor with 5s timeout** — `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.150-spike/test-monitor-wake-raw.jsonl` (90 lines). The PPF-01 reproduction. Fires `system/task_notification` → wake turn.
2. **Bash with `run_in_background:true`** (working capture; not committed as a fixture since it's a negative result) — a `sleep 4 && echo DONE` background invocation followed by BashOutput polling. Does NOT fire `system/task_notification`. Confirms run_in_background tools sit in a different cohort (active polling, no wake).

**Sub-question 1 — Wake-signal ordering in stream-json: `system/task_notification` arrives strictly between the prior turn's `result` and the wake turn's first `message_start`.** Monitor capture line-by-line:
- L47: first `result` (intermediate, end of "Monitor armed…" turn). No `origin` field. `num_turns:3`.
- L48: `{type:"system", subtype:"task_updated", task_id:"b9klbr5tx", patch:{status:"killed", end_time:...}}` — task state update (Monitor killed at timeout)
- **L49: `{type:"system", subtype:"task_notification", task_id:"b9klbr5tx", tool_use_id:"toolu_01XzLVALeMEvdqb4qiNDbRdp", status:"stopped", output_file:"", summary:"kernel lines in /var/log/system.log", uuid:"...", session_id:"..."}` — the wake signal.** Matches `SDKTaskNotificationMessage` at `sdk.d.ts:1659-1668` field-for-field.
- L50: `system/init` — claude re-initializes the session (same `session_id`, not a fresh session)
- L51+: wake turn streams (`stream_event`s, `assistant` messages with text/thinking/tool_use)
- L90: wake's final `result` with `origin:{kind:"task-notification"}` as retrospective marker. `num_turns:2` (the wake's own turn counter).

**Sub-question 2 — There is NO synthetic user event on the wire.** In stream-json between L47 and L51, no `type:"user"` event appears. The wake transitions directly from the prior turn's `result` to the next turn's `message_start`, with `system/task_notification` as the only leading marker. No string-content parsing required on the tugcode side — the SDK already pre-parses the payload into named fields.

**Sub-question 3 — Cohort splits into two non-overlapping populations.** The `system/task_notification` event is fired by the SDK's task subsystem for tools whose completion is *event-driven* (claude goes idle waiting; an external trigger raises the wake). Tools with *active-polling* semantics use a different path entirely (`system/task_started` + `system/task_updated` + periodic `system/status`, no notification — claude stays active calling the tool's read API).

**Async-notification cohort (PPF-01-affected; in scope for this plan):**
- **Empirically verified**: `Monitor` (`status:"stopped"` shown in capture; the SDK type also defines `"completed"` and `"failed"` status values).
- **Strong-evidence by tool semantics**: `CronCreate` (cron-fired), `ScheduleWakeup` (delayed wakes — the /loop skill flow uses this mechanism), `PushNotification` (external push arrival), `RemoteTrigger` (external trigger arrival), `TaskOutput` (deferred task completion). Step 6 verifies each.

**Active-polling cohort (NOT PPF-01-affected; out of scope, no fix needed):**
- **Empirically verified non-affected**: `Bash` with `run_in_background:true` (capture exhibited `task_started`/`task_updated`/`status` events, no `task_notification`, no `origin` on the final `result`).
- **Strong-evidence non-affected**: `Agent` with `run_in_background:true` (same SDK mechanism, claude polls subagent output via the SDK's read API).

**Synchronous tools (no async behavior at all):**
- `EnterPlanMode`, `ExitPlanMode`, `EnterWorktree`, `ExitWorktree`, `NotebookEdit`, `WebFetch`, `WebSearch`, `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate`, `TaskStop`, `ToolSearch`, `CronDelete`, `CronList`.

**Note on tugcode today (the upstream bug):** `tugcode/src/session.ts:565` `case "system"` handles `subtype === "init"` but does NOT handle `subtype === "task_notification"`. The event falls through with no IPC frame emitted to tugdeck — tugdeck never hears the wake happened, the subsequent assistant content arrives at the reducer while `phase === "idle"`, and `handleTextDelta`'s guard drops it. Step 3's fix is a single new arm in `case "system"` alongside the existing `"init"` arm.

**Robustness gaps the plan does not yet close (Step 6 cohort sweep work):**
- The Monitor capture only exercises `status:"stopped"`. The SDK type also defines `"completed"` and `"failed"`; both should bracket identically (status is metadata, not a routing key) but neither is captured.
- Async-notification cohort beyond Monitor is strong-evidence-only. ScheduleWakeup, CronCreate, PushNotification, RemoteTrigger, TaskOutput each require their own setup to capture (cron schedules, external push events, etc.). The detector's correctness depends on each firing `system/task_notification`; if any uses a different subtype, that tool stays broken until a new arm is added.
- Nested wakes (a second `system/task_notification` arriving inside the first wake's turn) are designed for in the plan but not empirically observed.
- The `system/init` event observed at L50 of the Monitor capture is treated as benign by the detector (no behavior change); whether it always follows `task_notification` or is Monitor-specific is unverified — the design doesn't depend on it.

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
| Phantom empty user bubble from the empty-text marker `pendingUserMessage` | med | med | Spec [#spec-guard-loosenings] requires `handleTurnComplete`'s commit branch for `waking → idle` to skip writing the empty-text marker into the committed transcript entry. Test pinned in Step 5 asserts no phantom bubble in the committed entry. If the existing commit code doesn't already skip empty-text pendings, Step 4 adds the skip. | A fixture-replay test surfaces a phantom bubble |

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
- `tugdeck/src/lib/code-session-store/__tests__/handle-wake.test.ts` (pure-logic).
- `tugdeck/src/__tests__/session-wake-fixture-replay.test.ts` (catalog replay).
- A drift test in `tugcode/__tests__/` pinning the SDK type: import `SDKTaskNotificationMessage` from `@anthropic-ai/claude-agent-sdk` and assert that the five fields we forward (`task_id`, `tool_use_id`, `status`, `summary`, `output_file`) all exist on the type. A future SDK that adds a field is fine (we just don't forward the new one); a future SDK that removes a field breaks tsc and surfaces the drift immediately. Cross-referenced against the Step-1 captured fixture, which exhibits the same field set on the wire.

**Tasks:**
- [ ] Pure-logic: `handleWakeStarted` transitions `idle → waking` with `wakeTrigger` set and `pendingUserMessage` set to the empty-text marker; per-turn telemetry fields all reset (assertion can spot-check the helper was called, e.g., `firstAssistantDeltaAt === null`).
- [ ] Pure-logic: `handleTurnComplete` during `waking` transitions `waking → idle` with `wakeTrigger` cleared, `pendingUserMessage` cleared, transcript entry committed, AND no phantom empty user bubble (assert the committed entry contains no empty-text user-message segment).
- [ ] Pure-logic: `handleTextDelta` accepts text events during `waking`; still drops them during `idle`/`errored`/etc.
- [ ] Pure-logic: `handleTextDelta` during `waking` sets `activeMsgId` from the first event so the `handleTurnComplete` early-return at `idle && null` does not fire.
- [ ] Pure-logic: nested wake (`handleWakeStarted` while already `waking`) is idempotent; trigger metadata refreshes if new payload is non-null and old was null.
- [ ] Pure-logic: `handleSend` during `waking` enqueues into `queuedSends`.
- [ ] Pure-logic: interrupt during wake ([Q03] resolution pinned here).
- [ ] Pure-logic: drop-case regression — every existing drop case (stray text outside any turn, etc.) still drops.
- [ ] Store-wrapper test: `frameToEvent` on a `wake_started` frame mints a turnKey and dispatches `WakeStartedEvent` with the trigger payload threaded through.
- [ ] Fixture replay: feed the Step-1 captured JSONL through the full pipeline; assert the wake turn lands in `transcript` with the expected text and the `wakeTrigger` metadata, and no phantom user bubble.
- [ ] Cold-boot replay regression: replay the captured JSONL through the *cold-boot* path (`replay_started` bracket); confirm the wake turn paints correctly under `phase === "replaying"` (proves no Slice 1 work is needed on the replay translator).
- [ ] Drift: compile-time check importing `SDKTaskNotificationMessage` from `@anthropic-ai/claude-agent-sdk` and asserting the five forwarded fields (`task_id`, `tool_use_id`, `status`, `summary`, `output_file`) exist. Cross-validated against the Step-1 fixture at `v2.1.150-spike/test-monitor-wake-raw.jsonl` line 49 (the captured wire shape matches the SDK type).

**Tests:**
- [ ] All new tests pass.

**Checkpoint:**
- [ ] `cd tugdeck && bun test` green.
- [ ] `bun x tsc --noEmit` green.
- [ ] `bun run audit:tokens lint` green (no token surface touched, but run for hygiene).

---

#### Step 6: Cohort verification — manual repro per verified tool {#step-6}

**Depends on:** #step-5

**Commit:** `N/A (verification only)`

**References:** (#context, #success-criteria), Step 1's verified-cohort subset

**Artifacts:**
- Updated PPF-01 entry in [tide-assistant-rendering.md](./tide-assistant-rendering.md): status flipped from Active → Resolved, with a back-link to this plan.

**Tasks:**
- [ ] Manual: Monitor 60s timeout → wake turn paints.
- [ ] Manual: for each cohort member verified in Step 1 to route through task_notification, repro the case; wake turn paints.
- [ ] Manual: for each cohort member that does NOT route through task_notification (per Step 1's findings), document the alternative re-entry path it uses; if Slice 1 doesn't cover it, file as a Slice 2 / follow-up plan item.
- [ ] Update PPF-01 in [tide-assistant-rendering.md](./tide-assistant-rendering.md) to Resolved.

**Tests:**
- [ ] None new — Step 5's tests are the test gate. Step 6 is a real-world cohort sweep.

**Checkpoint:**
- [ ] At least the Monitor case passes cleanly. Other verified-cohort members are blockers if they fail.

---

#### Step 7: Integration checkpoint {#step-7}

**Depends on:** #step-3, #step-4, #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** [D01] [D02] [D03] [D04], (#success-criteria)

**Tasks:**
- [ ] Re-run all four gates from the project's standard checkpoint: tsc / bun test / audit:tokens lint / cargo nextest.
- [ ] Confirm the new fixture-replay test runs in the standard `bun test` invocation (not gated behind a flag).
- [ ] Confirm PPF-01 is closed in the rendering plan.
- [ ] Confirm L02 contract held: any React component reading `wakeTrigger` goes through `useSyncExternalStore`, not through `useEffect` mirror state. (Slice 1 has no consumers; this is a forward-looking note for Slice 2 implementers.)

**Tests:**
- [ ] Full test suite green.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test && bun run audit:tokens lint && cd ../tugrust && cargo nextest run` — all four green in sequence.

---

### Roadmap / Follow-ons (Explicitly Not Required for This Plan) {#roadmap}

- **Slice 2 — trigger-aware chrome.** Render wake turns with a chip / banner showing the trigger ("Monitor t-abc completed", "ScheduleWakeup fired", etc.). Resolves [Q02] if real-use feedback says it's needed.
- **Slice 2 — replay-translator metadata persistence** {#slice-2-replay-translator}. Today, cold-boot rehydration of historic wake turns paints them through the `replaying` phase correctly, but the `wakeTrigger` metadata is lost (replay events don't carry it). Slice 2 chrome that wants to render the trigger needs the translator to synthesize `wake_started` frames (with the captured trigger payload) inline within the existing `replay_started/replay_complete` bracket. No `wake_complete` synthesis needed — the replayed `turn_complete` closes it the same way the live path does. Not needed for Slice 1.
- **Slice 2 — system-note rendering for synthetic user_message_replay.** If Step 1 confirms the SDK emits a user_message_replay with the synthetic user text ("Monitor timed out…"), Slice 2 may render this as a transcript system note. Slice 1 drops it.
- **Wake-aware Stop button.** If [Q03] is deferred at Slice 1, the Stop button's behavior during `waking` may be a follow-up: ergonomics around "the agent woke up and is doing something I didn't ask for — let me stop it" deserve their own polish pass.
- **Telemetry surface for wakes.** A dev-panel inspector showing "how many turns this session were wakes vs user-initiated" — useful for understanding tool-cohort traffic patterns and confirming the fix is exercised by real workflows.
- **Cohort members that don't route through task_notification.** Any cohort member identified in Step 1 as using a different re-entry path (e.g., ScheduleWakeup if it re-binds the session) becomes a separate follow-up: design the appropriate signal, add it to the wake-detector or to a parallel mechanism.
