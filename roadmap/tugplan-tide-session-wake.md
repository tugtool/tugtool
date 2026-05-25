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

- **Mirror the existing replay bracket.** The reducer already has a working pattern for "events flow but no user turn is in flight" — the `replay_started`/`replay_complete` bracket and the `replaying` phase. Spontaneous wake gets a parallel bracket (`wake_started`/`wake_complete`) and a parallel phase (`waking`). No new architectural concept; one new state in an enum the reducer already iterates.
- **Detect at the source (tugcode), not in the reducer.** Detection lives where the SDK shape is known. [D02] [D04] explain why reducer-only detection was considered and rejected: it conflates detection with event handling, forces turnKey minting inside a pure handler, and reproduces detection logic that the cold-boot replay translator would need separately. Distributed detection keeps the reducer a state machine and the wire vocabulary explicit.
- **Cold-boot replay is unaffected.** The reducer's `handleTextDelta` guard already allows `"replaying"`, so historic wake turns rehydrating through `replay_started/replay_complete` already paint correctly. No JSONL translator changes are needed in Slice 1. Trigger-metadata persistence through the translator is a Slice 2 concern (called out at [#slice-2-replay-translator]).
- **Loosen exactly one reducer guard.** `handleTextDelta` accepts `"waking"` alongside `"replaying"`. The other two guards (`handleTurnComplete`, `handleUserMessageReplay`) are addressed by the bracket design (`handleWakeStarted` sets `activeMsgId` so the turn-complete early-return doesn't fire; `user_message_replay` from a wake-triggering task-notification synthetic-user-text is dropped quietly in Slice 1 and surfaced as a system note in Slice 2 chrome). Pure additive change to the guard: every existing drop still drops.
- **Reset per-turn telemetry on wake-start.** A wake turn is a real turn for live telemetry — but the per-turn fields (`firstAssistantDeltaAt`, `lastStreamEventAt`, `awaitingApprovalSince`, the interval arrays, etc.) all need resetting at wake-start, exactly the way `handleSend` resets them on user submit. Without this, a wake inherits the prior turn's telemetry. Spec [#spec-wake-started-state-reset] enumerates the exact field list.
- **Ship in two slices.** Slice 1: wire + reducer + tests + cohort verification (UI shows wake turn correctly, no chrome differentiation). Slice 2 (deferred to a follow-up plan): trigger-aware chrome for wake turns + replay-translator metadata. Slice 1 closes PPF-01; Slice 2 is polish.

#### Success Criteria (Measurable) {#success-criteria}

- A live test session with the PPF-01 reproduction recipe (`> Use the Monitor tool to tail /var/log/system.log until you see the word "kernel"…`) paints the post-60s timeout turn in Tide without reopening the session. Measured manually against the repro recipe; pass = the resumed text appears in the transcript.
- A fixture-replay test loads the captured wake session JSONL from Step 1 and asserts that the resumed assistant text lands in the transcript (not in dropped events). Pass = test exits 0.
- Step 1's empirical cohort sweep pins which mechanisms route through task_notification vs. other re-entry paths, and the plan claims are tightened to only the verified mechanisms.
- `cd tugdeck && bun x tsc --noEmit && bun test && bun run audit:tokens lint` stays green across all commits.
- `cd tugrust && cargo nextest run` stays green across all commits.
- The first-responder focus destination is unchanged by a wake (prompt-entry stays focused through `waking → idle` transitions). Verified at [#step-4-l23-check].

#### Scope {#scope}

1. New wire frame types: `wake_started`, `wake_complete` (TS types + Rust definitions for tugcast).
2. tugcode detector + emitter: detects "content arriving in idle with no preceding user_message" and emits the bracket; attaches task-notification payload as trigger metadata when present.
3. tugdeck reducer: new `waking` phase, new `handleWakeStarted`/`handleWakeComplete` (including per-turn telemetry reset), guard loosening in `handleTextDelta`, a `wakeTrigger` state field.
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
- TurnKey minting stays out of pure-reducer handlers — the store wrapper or tugcode's outbound layer mints turnKeys before dispatch, mirroring the existing replay pattern.

#### Assumptions {#assumptions}

- The SDK's task-notification flow emits `SDKTaskNotificationMessage` *near* the resumed content (within a small wall-clock window — seconds, not minutes). Verified in Step 1; if violated, the detector's `task_notification`-as-metadata correlation window needs widening or the metadata attachment needs to be retroactive (revise [D02]).
- The supervisor side (tugcast `agent_supervisor`) currently passes the SDK system messages through to the wire without filtering. Confirmed for `subtype === "init"`; assumed to hold for `subtype === "task_notification"`. Verified in Step 1.
- A single wake corresponds to a single bracket. Nested wakes (one task-notification firing during the wake turn of another task-notification) are theoretically possible; the design at [D01] flattens them to a single outer bracket — the inner wake is absorbed silently. Pinned by a test in Step 5.
- TurnKey minting at the store-wrapper / tugcode layer is preferable to letting the reducer mint its own. Justified by the existing pattern (replay events follow this convention) and by reducer purity. Verified by adopting the same pattern for `wake_started` frames.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Empirical event-shape characterization for spontaneous wake (OPEN — resolved in Step 1) {#q01-event-shapes}

**Question:** Three sub-questions to resolve from a captured live session:

1. **Ordering.** Does the stream-json sequence look like `{system, subtype: task_notification} → {assistant, …} → {result, …}`, or does the notification land after the resumed content?
2. **User-message-replay path.** Does the SDK emit an `SDKUserMessageReplay` (containing the synthetic "Monitor timed out, re-arm" text) between the task-notification and the assistant resume? If yes, does it carry the synthetic text in a recognizable form so a future Slice 2 system-note chrome can render it?
3. **Cohort coverage.** Of the provisional cohort (Monitor, ScheduleWakeup, CronCreate, Bash run_in_background, Task subagent run_in_background, PushNotification, RemoteTrigger), which actually fire `SDKTaskNotificationMessage` and which use a different re-entry mechanism (e.g., a fresh `session_id` for ScheduleWakeup, a separate cron runtime that re-binds, etc.)?

**Why it matters:** Step 3's detection logic in tugcode depends on (1). The Slice 1 vs Slice 2 boundary depends on (2). The plan's claims (and Step 6's manual sweep) depend on (3).

**Plan to resolve:** Empirical capture in Step 1. Capture stream-json from real sessions exercising each cohort member; inspect ordering, user-message-replay presence, and the dispatch path. Document findings inline in this plan as a resolution paragraph.

**Resolution:** OPEN.

#### [Q02] Should the wake turn's chrome show *what* triggered it? (OPEN — defer to Slice 2) {#q02-trigger-chrome}

**Question:** When the user sees a wake turn in the transcript, should it carry a visible cue ("Resumed by Monitor t-abc" / "Resumed by ScheduleWakeup")?

**Why it matters:** Wake turns appearing with no context could be disorienting — the user submitted "look at /var/log" two minutes ago and suddenly a new turn paints with no prompt visible. A small inline cue (a chip / a header row) would orient them.

**Plan to resolve:** Ship Slice 1 without the cue; gather feedback from real use; decide whether Slice 2 ships a chrome update.

**Resolution:** DEFERRED to Slice 2 follow-on plan.

#### [Q03] How should `interrupt()` behave during a wake turn? (OPEN — resolved in Step 4) {#q03-interrupt-during-wake}

**Question:** If the user clicks Stop while a wake turn is streaming, what happens? The interrupt machinery today is tied to a `pendingUserMessage` and a user-initiated turn-key. A wake turn synthesizes its own turnKey but has no user-initiated `pendingUserMessage`.

**Why it matters:** Step 4 has to decide whether `canInterrupt` reads as `true` during `waking` phase (yes — the user can still stop a runaway wake turn) and how the interrupt frame is shaped on the wire.

**Plan to resolve:** Step 4 designs the interrupt path; Step 5 includes a test (`interrupt during wake should commit a partial turn and clear the bracket`). Default position: `canInterrupt = true` during `waking`; the interrupt frame uses the same wire shape as a normal-turn interrupt (the server doesn't need to distinguish — the running turn is the running turn).

**Resolution:** OPEN.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Detection logic in tugcode misses an SDK message-ordering edge case | med | med | Pin [Q01] empirically in Step 1; the detector treats `task_notification` as metadata, not as the trigger signal, so reordering doesn't break the bracket | Any prod session JSONL where a wake turn fails to bracket |
| Reducer guard loosening opens a hole for genuinely-stray events | low | low | Tests in Step 5 pin every existing drop case (stray text outside any turn still drops) | Any test failure after the guard change |
| Nested wakes (wake during a wake) produce a malformed bracket | med | low | Test pinned in Step 5; the reducer flattens nested wakes to a single outer bracket via an idempotent `handleWakeStarted` (second call while already `waking` is a no-op except for trigger-metadata update) | A real-session JSONL with two overlapping task-notifications |
| `task_notification` arrives *after* the resumed content (out-of-order) | med | low | Detector uses correlation window (configurable; default 5s) to attach trigger metadata retroactively; if the window misses, the wake still brackets correctly with an anonymous trigger | Step 1 capture shows an ordering closer than the window allows |
| User types a `send` *during* an in-flight wake turn (race) | med | low | The reducer's `handleSend` allow-list adds `"waking"`; a send during waking is enqueued the same way a send during streaming is — the `queuedSends` machinery already handles this case. Test pinned in Step 5 | An interaction test surfaces a queueing race |
| Transport disconnect mid-wake (the `wake_complete` never arrives) | med | low | Recovery: on `transport_open` → `transport_settled` the reducer's existing bind-resume machinery rehydrates from JSONL, which contains the wake turn as a completed entry — so reopening the session paints it. No separate watchdog needed; the existing reconnect path is the safety net | An observed case where reconnect doesn't rehydrate the in-flight wake |

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

**Decision:** Add `wake_started` / `wake_complete` wire frames and a `"waking"` value to `CodeSessionPhase`. Don't fake a user_message to slip the wake turn through the existing `submitting → … → idle` machinery.

**Rationale:**
- The existing `replay_started`/`replay_complete` bracket is the proven pattern for "events flow but no user turn is in flight." Mirroring it costs one enum value and two new handlers; no reducer concept needs inventing.
- A faked user_message would pollute the transcript with phantom user bubbles and lie about the turn-lifecycle telemetry (TTFT would measure "time from fake-send to first-token" — meaningless).
- A bracket cleanly tags the entire wake turn so future Slice 2 work (trigger-aware chrome) has a single place to read the wake metadata.
- Nested wakes flatten to one bracket (second `handleWakeStarted` while already `waking` is a no-op except for trigger-metadata update).

**Implications:**
- New `CodeSessionPhase` enum value: `"waking"`. Every exhaustive switch on phase must add the case.
- One reducer guard loosens: `handleTextDelta` accepts `"waking"`.
- New reducer state field: `wakeTrigger: { taskId, status, summary } | null`, set on `handleWakeStarted`, cleared on `handleWakeComplete`.
- `handleWakeStarted` resets per-turn telemetry the same way `handleSend` does (spec at [#spec-wake-started-state-reset]).

#### [D02] tugcode (not tugcast, not tugdeck) detects spontaneous wake (DECIDED) {#d02-tugcode-detector}

**Decision:** The detector that recognizes "claude is emitting content from idle" lives in tugcode's `session.ts`, in the same routing layer that consumes stream-json from the claude subprocess.

**Detector signal:** "Content (assistant_text / thinking_text / tool_use) arrives in the stream-json output without a preceding `SDKUserMessage` since the last `SDKResultMessage`." `task_notification` is *metadata* attached when present, not the trigger of detection.

**Rationale:**
- tugcode is closest to the source: it sees raw stream-json frames before any IPC packaging. It can correlate metadata events with content events in the same stream.
- tugcast (`agent_supervisor`) only sees IPC frames coming out of tugcode; it doesn't know the SDK message shape and would have to re-derive the detection from packaged events.
- tugdeck's reducer can't host the detector cleanly — see [D04].
- Detector-from-content (rather than detector-from-task-notification) is robust against unknown re-entry mechanisms. If a future SDK feature wakes claude via something other than `task_notification`, the detector still fires.

**Implications:**
- tugcode owns one new piece of state per session: a `userMessageSeenSinceLastResult` boolean (or equivalent). Flipped true on `SDKUserMessage`, flipped false on `SDKResultMessage`.
- When content arrives with the boolean still false, tugcode emits `wake_started` with the most recent `task_notification` payload (if any, within a 5s correlation window) as trigger metadata, then forwards the content.
- The wake closes on the next `SDKResultMessage`: tugcode emits `wake_complete` before forwarding the result.
- The turnKey for the wake is minted by tugcode at `wake_started` emit time and carried on the frame.

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
4. **Doesn't actually save layers.** Even reducer-only needs *some* signal carrying trigger metadata for Slice 2. That signal has to land somewhere — and "wake_started/wake_complete on the wire" is the cleanest place.

**Implications:**
- Step 2's wire-frame additions are load-bearing, not optional scaffolding.
- Step 3's tugcode detector is the implementation focal point of Slice 1.
- The reducer is a pure state machine with clean handlers, not a pile of business logic.

---

### Specification {#specification}

#### Wire frames {#spec-wire-frames}

Two new IPC message types emitted by tugcode, forwarded by tugcast, consumed by tugdeck. Both go on the existing CODE_OUTPUT feed; both carry the session ID.

```ts
// New entry in tugcode/src/protocol-types.ts and mirrored in tugcast Rust:
type WakeStartedMessage = {
  type: "wake_started";
  session_id: string;
  turnKey: string;  // minted by tugcode; mirrors the replay-event pattern
  wake_trigger: {
    task_id: string;
    status: "completed" | "failed" | "stopped";
    summary: string;
  } | null;  // null if no task_notification was correlated within the window
};

type WakeCompleteMessage = {
  type: "wake_complete";
  session_id: string;
  msg_id: string;  // claude's id for the resumed assistant message
};
```

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
  status: "completed" | "failed" | "stopped";
  summary: string;
} | null;
```

#### `handleWakeStarted` state reset (mirrors `handleSend`) {#spec-wake-started-state-reset}

`handleSend` (`reducer.ts:486-540`) resets a specific set of per-turn fields at submit time. `handleWakeStarted` must reset the same fields so a wake turn's telemetry is its own, not the prior user turn's. Fields to reset:

- `awaitingApprovalSince: null`
- `awaitingApprovalAccumulatedMs: 0`
- `transportDowntimeAccumulatedMs: 0`
- `transportReconnectCount: 0`
- `lastStreamEventAt: null`
- `maxStreamGapMs: 0`
- `firstAssistantDeltaAt: null`
- `firstToolUseAt: null`
- `interruptInFlight: false`
- `interruptInFlightSegmentStartedAt: null`
- `awaitingApprovalIntervals: []`
- `transportDowntimeIntervals: []`
- `interruptInFlightIntervals: []`
- `liveTurnUsage: null`
- `costAtSubmit: state.lastCost` (the wake's cost-delta baseline is the current cumulative cost)

What `handleWakeStarted` does *not* do (vs `handleSend`):
- No real `pendingUserMessage` write — there is no user message backing a wake. Instead, `pendingUserMessage` is set to a marker object: `{ text: "", atoms: [], submitAt: Date.now(), turnKey: event.turnKey }`. The empty text is the "this is a wake" sentinel; consumers that render the user-message bubble must check for empty text and skip the render (Slice 1 acceptance; Slice 2 may render a system-note chrome).
- No `pendingDraftRestore: null` clear — the user's draft (if any) should not be touched by a wake.
- `phase: "waking"` (not `"submitting"`).
- `wakeTrigger: event.wake_trigger` (set from frame).

#### Reducer phase transitions {#spec-phase-transitions}

- `idle` + `wake_started` → `waking` (with state reset per [#spec-wake-started-state-reset])
- `waking` + `assistant_text` / `thinking_text` / `tool_use` → stays `waking` (events flow through the loosened guard)
- `waking` + `turn_complete` → commits the turn entry like a normal `streaming`/`tool_work` → `idle` commit, but routed through a new `handleWakeComplete` that also clears `wakeTrigger` and `pendingUserMessage`
- `waking` + `wake_complete` (explicit close from tugcode) → also commits and returns to `idle`. Belt-and-suspenders: `turn_complete` is the primary close; `wake_complete` is the explicit signal if claude exits the wake without a clean `result`
- `waking` + `wake_started` (nested wake) → no-op (idempotent), with optional `wakeTrigger` metadata update if the new payload is non-null and the old was null
- `waking` + `send` → enqueued via `queuedSends`, mirroring the streaming-phase enqueue behavior

#### Guard loosening (only one needed) {#spec-guard-loosenings}

`handleTextDelta` (`reducer.ts:833-841`): add `"waking"` to the phase allow-list.

`handleTurnComplete` (`reducer.ts:1462-1467`): the `activeMsgId === null && phase === "idle"` early-return stays as-is — the `waking` phase has `activeMsgId` set by the first text event.

`handleUserMessageReplay` (`reducer.ts:2689-2691`): unchanged. The synthetic user_message_replay frame from a task-notification injection is dropped quietly in Slice 1. Slice 2 may revisit if the SDK emits one and chrome wants to render it as a system note.

The comment at `reducer.ts:827` ("Live Claude should not emit this — but defensive handling…") must be updated as part of Step 4 so the next reader doesn't think the drop semantic is intentional in the broader sense. Updated comment should read approximately: *"Incoming text outside of an active turn or a wake — drop. Live claude emits content into idle only when a spontaneous wake is in progress; the wake bracket (`wake_started`/`wake_complete`) transitions phase to `waking` and is what allows the events through here. Stray text outside both an active turn and a wake bracket is still a defensive drop."*

---

### Compatibility / Migration / Rollout {#rollout}

- **Compatibility policy:** Wire-frame additions are non-breaking. Existing clients that don't recognize `wake_started` / `wake_complete` log a debug message and ignore them. Existing servers that don't emit them produce no behavior change. New phase `"waking"` is invisible to anything outside the reducer until a wake actually fires.
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
| `"waking"` | enum value | `tugdeck/src/lib/code-session-store/types.ts` | New `CodeSessionPhase` value |
| `wakeTrigger` | state field | `tugdeck/src/lib/code-session-store/types.ts` | New optional field on `CodeSessionState` |
| `handleWakeStarted` | function | `tugdeck/src/lib/code-session-store/reducer.ts` | New — resets per-turn telemetry per [#spec-wake-started-state-reset] |
| `handleWakeComplete` | function | `tugdeck/src/lib/code-session-store/reducer.ts` | Mirrors the `streaming → idle` commit path; clears `wakeTrigger` |
| `WakeStartedEvent` | type | `tugdeck/src/lib/code-session-store/events.ts` (or sibling) | Wire-frame TS shape with pre-minted `turnKey` |
| `WakeCompleteEvent` | type | same | Wire-frame TS shape |
| `routeTopLevelEvent` wake-detector arm | function | `tugcode/src/session.ts:540+` | Tracks `userMessageSeenSinceLastResult`, emits `wake_started` on first idle-content, attaches correlated task_notification metadata |
| `userMessageSeenSinceLastResult` | session field | tugcode SessionManager | Detector state |
| `lastTaskNotification` | session field | tugcode SessionManager | Most recent task_notification within correlation window |
| `WakeStartedMessage` / `WakeCompleteMessage` | TS types | `tugcode/src/protocol-types.ts` | IPC contract |
| Rust frame variants | enum | tugcast (CODE_OUTPUT frame types) | Mirror IPC types |
| Updated comment | comment | `reducer.ts:827` | Reflects the wake-bracket reality |

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
- A captured stream-json log from a live Monitor-timeout session, committed under `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/<version>/test-NN-monitor-wake.jsonl`.
- A captured stream-json log per cohort member that *does* fire `SDKTaskNotificationMessage` (subset of the provisional cohort).
- A resolution paragraph appended to [Q01] documenting: (1) message ordering, (2) presence/absence of user_message_replay for the synthetic user text, (3) which cohort members route through task_notification vs. other re-entry paths.
- This plan's cohort claims tightened to only the verified mechanisms; unverified members moved to a follow-up note.

**Tasks:**
- [ ] Run the PPF-01 repro recipe against a Tide session with stream-json logging enabled. Capture JSONL.
- [ ] For each provisional cohort member (ScheduleWakeup, CronCreate, Bash run_in_background, Task subagent run_in_background, PushNotification, RemoteTrigger): exercise minimally, observe the stream-json shape, note whether it fires task_notification or uses another path.
- [ ] Confirm the JSONL captures the full sequence: prior `result`, the system task_notification event (if any), the resumed assistant_text events, the final result.
- [ ] Resolve [Q01] sub-question 1 (ordering): notification-before-content vs. content-before-notification vs. arbitrary.
- [ ] Resolve [Q01] sub-question 2 (user_message_replay): does the SDK emit a synthetic user message and in what shape?
- [ ] Resolve [Q01] sub-question 3 (cohort): write the verified-cohort subset into this plan.
- [ ] Resolve the catalog-version question with whatever the current tugcode subprocess emits.

**Tests:**
- [ ] None — read-only empirical step.

**Checkpoint:**
- [ ] JSONLs committed; [Q01] resolved with the three sub-question paragraphs; cohort claims in this plan tightened.

---

#### Step 2: Wire-frame protocol — `wake_started` / `wake_complete` {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tide-wake): protocol — wake_started / wake_complete IPC frames`

**References:** [D01] bracket pattern, Spec [#spec-wire-frames], (#strategy)

**Artifacts:**
- TypeScript types in `tugcode/src/protocol-types.ts` (outbound shapes).
- Mirrored TypeScript types in `tugdeck/src/lib/code-session-store/events.ts` (or sibling).
- Rust frame variants in tugcast (the crate that owns the IPC enum for CODE_OUTPUT frames).
- No emitters or consumers yet — purely additive types so the wire vocabulary exists before Steps 3 and 4 land.

**Tasks:**
- [ ] Add `WakeStartedMessage` and `WakeCompleteMessage` to `tugcode/src/protocol-types.ts`.
- [ ] Mirror in tugdeck event types (default-arm consumers log debug and ignore).
- [ ] Add Rust variants in tugcast (forwarder treats them as opaque pass-through for now).
- [ ] Confirm by running tsc + cargo check that the new types thread through without breaking any consumer.

**Tests:**
- [ ] None at this step — types are additive, no behavior change yet.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test` green.
- [ ] `cd tugrust && cargo nextest run` green.

---

#### Step 3: tugcode wake detector + bracket emission {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `feat(tide-wake): tugcode detector + bracket emission`

**References:** [D02] tugcode owns detection, [Q01] event shapes (resolved in #step-1), Spec [#spec-wire-frames], (#strategy)

**Artifacts:**
- `routeTopLevelEvent` in `tugcode/src/session.ts` gains a wake-detector pass that tracks `userMessageSeenSinceLastResult` and `lastTaskNotification`.
- Bracket open: on first content (assistant/thinking/tool_use) after a `result` with `userMessageSeenSinceLastResult === false`, tugcode emits `wake_started` with the most recent task_notification payload (if within the 5s correlation window) as trigger metadata.
- Bracket close: on the next `result` while `isInWake === true`, tugcode emits `wake_complete` immediately before forwarding the result.
- TurnKey minting: tugcode mints a turnKey at `wake_started` emit time and carries it on the frame (mirrors the existing replay-event pattern).

**Tasks:**
- [ ] Detector state on SessionManager: `userMessageSeenSinceLastResult: boolean`, `lastTaskNotification: { payload, receivedAt } | null`, `isInWake: boolean`.
- [ ] Flip `userMessageSeenSinceLastResult` on `SDKUserMessage`; reset on `SDKResultMessage`.
- [ ] On `SDKTaskNotificationMessage`: cache the payload + timestamp in `lastTaskNotification`.
- [ ] On content arriving while `isIdle && !userMessageSeenSinceLastResult`: mint turnKey, emit `wake_started` (with trigger metadata if cached notification is within 5s, else null), flip `isInWake = true`, then forward content.
- [ ] On `SDKResultMessage` while `isInWake`: emit `wake_complete`, then forward the result, then clear `isInWake`, `lastTaskNotification`.
- [ ] Handle nested wakes: a second wake-start condition while already `isInWake` is a no-op (idempotent).

**Tests:**
- [ ] tugcode unit test: feed the Step-1 captured JSONL through `routeTopLevelEvent` and assert the emitted IPC sequence brackets correctly.
- [ ] tugcode unit test: feed a synthetic "content with no task_notification" sequence; assert the bracket opens with `wake_trigger: null`.
- [ ] tugcode unit test: feed a synthetic nested-wake sequence; assert only one outer bracket emits.
- [ ] tugcode unit test: feed a synthetic "user_message arrives between result and content"; assert NO wake bracket opens.

**Checkpoint:**
- [ ] `cd tugcode && bun test` green.
- [ ] tugcast still routes the new frames without panicking (cargo nextest stays green).

---

#### Step 4: tugdeck reducer — `waking` phase, handlers, guard loosening, comment update {#step-4}

**Depends on:** #step-2

**Commit:** `feat(tide-wake): reducer — waking phase, handleWake*, guard loosen, comment refresh`

**References:** [D01] bracket pattern, [D03] additive guards, Spec [#spec-reducer-state, #spec-phase-transitions, #spec-guard-loosenings, #spec-wake-started-state-reset], [Q03] interrupt during wake, (#strategy)

**Artifacts:**
- `"waking"` added to `CodeSessionPhase` enum.
- `wakeTrigger` state field on `CodeSessionState` (default `null`).
- `handleWakeStarted` in `reducer.ts` — implements the per-turn telemetry reset per [#spec-wake-started-state-reset], sets `phase: "waking"`, `wakeTrigger: event.wake_trigger`, sets the marker `pendingUserMessage` (empty text, supplied turnKey).
- `handleWakeComplete` in `reducer.ts` — commits the turn (same commit path as `handleTurnComplete`), clears `wakeTrigger`, clears `pendingUserMessage`, transitions to `idle`.
- Switch arms in the main reducer dispatcher (`reducer.ts:2826+`) for `wake_started` and `wake_complete`.
- `handleTextDelta` guard accepts `"waking"`.
- `handleSend`, `handleInterrupt`, `handleTurnComplete` reviewed for `waking`-phase interactions — `handleSend` enqueues per existing `streaming`-phase behavior, `handleInterrupt` per [Q03] resolution.
- Comment at `reducer.ts:827` updated per [#spec-guard-loosenings].
- Exhaustive-switch type-checks for all phase-keyed code: telemetry hooks (`hooks/use-lifecycle-tick.ts`), chrome (`tide-card-telemetry-*`), `canSubmit`/`canInterrupt` derivations.

**Tasks:**
- [ ] Add the enum value + state field.
- [ ] Implement `handleWakeStarted` with the full telemetry reset (test pinned in Step 5).
- [ ] Implement `handleWakeComplete`.
- [ ] Wire the dispatcher arms.
- [ ] Loosen the `handleTextDelta` guard.
- [ ] Update the comment at `reducer.ts:827`.
- [ ] Update every exhaustive `switch` on `CodeSessionPhase` to include `"waking"` (tsc will flag them).
- [ ] Decide [Q03] (interrupt during wake): document the decision inline in `handleInterrupt` and add the corresponding behavior. Default: `canInterrupt = true` during `waking`; interrupt frame is the same shape as a normal-turn interrupt.
- [ ] **[L23 check]** {#step-4-l23-check}: Verify that no first-responder logic keys off `phase === "idle"` in a way that a `waking` transition would disturb. Specifically check: the prompt-entry's focus restoration on idle, the responder-chain at `idle → submitting` transitions, the card lifecycle delegate's idle-state behavior. If any do, audit and document the interaction.

**Tests:**
- [ ] None at this step (tests live in #step-5).

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` green (exhaustive-switch errors are the gate that ensures we updated every consumer).

---

#### Step 5: Tests — pure-logic reducer + fixture replay + drift {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `test(tide-wake): reducer + fixture replay + drift coverage`

**References:** [D01] [D03], [R01], (#test-plan-concepts)

**Artifacts:**
- `tugdeck/src/lib/code-session-store/__tests__/handle-wake.test.ts` (pure-logic).
- `tugdeck/src/__tests__/session-wake-fixture-replay.test.ts` (catalog replay).
- A drift test in `tugcode/__tests__/` pinning `SDKTaskNotificationMessage` shape.

**Tasks:**
- [ ] Pure-logic: `handleWakeStarted` transitions `idle → waking` with `wakeTrigger` set; per-turn telemetry fields all reset (enumerate per [#spec-wake-started-state-reset]).
- [ ] Pure-logic: `handleWakeComplete` transitions `waking → idle` with `wakeTrigger` cleared and `pendingUserMessage` cleared.
- [ ] Pure-logic: `handleTextDelta` accepts text events during `waking`; still drops them during `idle`/`errored`/etc.
- [ ] Pure-logic: `handleTurnComplete` commits a waking turn correctly through `waking → idle` (via the existing commit path; activeMsgId is set by the first text event).
- [ ] Pure-logic: nested wake (`handleWakeStarted` while already `waking`) is idempotent; trigger metadata updates if new payload is non-null and old was null.
- [ ] Pure-logic: `handleSend` during `waking` enqueues into `queuedSends`.
- [ ] Pure-logic: interrupt during wake ([Q03] resolution pinned here).
- [ ] Pure-logic: drop-case regression — every existing drop case (stray text outside any turn, etc.) still drops.
- [ ] Fixture replay: feed the Step-1 captured JSONL through the full pipeline; assert the wake turn lands in `transcript` with the expected text and the `wakeTrigger` metadata.
- [ ] Cold-boot replay regression: replay the captured JSONL through the *cold-boot* path (`replay_started` bracket); confirm the wake turn paints correctly under `phase === "replaying"` (proves no Slice 1 work is needed on the replay translator).
- [ ] Drift: compile-time check pinning `SDKTaskNotificationMessage` fields.

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
- **Slice 2 — replay-translator metadata persistence** {#slice-2-replay-translator}. Today, cold-boot rehydration of historic wake turns paints them through the `replaying` phase correctly, but the `wakeTrigger` metadata is lost (replay events don't carry it). Slice 2 chrome that wants to render the trigger needs the translator to synthesize `wake_started/wake_complete` brackets from the JSONL. Not needed for Slice 1.
- **Slice 2 — system-note rendering for synthetic user_message_replay.** If Step 1 confirms the SDK emits a user_message_replay with the synthetic user text ("Monitor timed out…"), Slice 2 may render this as a transcript system note. Slice 1 drops it.
- **Wake-aware Stop button.** If [Q03] is deferred at Slice 1, the Stop button's behavior during `waking` may be a follow-up: ergonomics around "the agent woke up and is doing something I didn't ask for — let me stop it" deserve their own polish pass.
- **Telemetry surface for wakes.** A dev-panel inspector showing "how many turns this session were wakes vs user-initiated" — useful for understanding tool-cohort traffic patterns and confirming the fix is exercised by real workflows.
- **Cohort members that don't route through task_notification.** Any cohort member identified in Step 1 as using a different re-entry path (e.g., ScheduleWakeup if it re-binds the session) becomes a separate follow-up: design the appropriate signal, add it to the wake-detector or to a parallel mechanism.
