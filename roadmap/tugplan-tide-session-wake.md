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

- The SDK's task-notification flow emits `SDKTaskNotificationMessage` *near* the resumed content (within a small wall-clock window — seconds, not minutes). Verified in Step 1; if violated, the detector's `task_notification`-as-metadata correlation window needs widening or the metadata attachment needs to be retroactive (revise [D02]).
- The supervisor side (tugcast `agent_supervisor`) currently passes the SDK system messages through to the wire without filtering. Confirmed for `subtype === "init"`; assumed to hold for `subtype === "task_notification"`. Verified in Step 1.
- A single wake corresponds to a single bracket. Nested wakes (one task-notification firing during the wake turn of another task-notification) are theoretically possible; the design at [D01] flattens them to a single outer bracket — the inner wake is absorbed silently. Pinned by a test in Step 5.
- TurnKey minting at the store wrapper is preferable to letting the reducer or tugcode mint. Justified by the existing pattern (replay events follow this convention per `reducer.ts:1606-1609`) and by reducer purity + cross-process clarity (turnKeys are React-key seeds; tugcode has no React).

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
- New reducer state field: `wakeTrigger: { taskId, status, summary } | null`, set on `handleWakeStarted`, cleared in `handleTurnComplete`'s commit when transitioning from `waking → idle`.
- `handleWakeStarted` resets per-turn telemetry by calling the existing `resetPerTurnTelemetry()` helper (`reducer.ts:1619`) — same helper `handleSend` uses on the queue-flush path.

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
- The wake closes implicitly when claude emits its end-of-turn `result` (which tugcode already translates into a `turn_complete` IPC frame). No separate `wake_complete` frame on the wire.
- TurnKey for the wake is minted by tugdeck's store wrapper (`frameToEvent`) on receipt of `wake_started`. tugcode does not mint turnKeys; they are tugdeck React-key seeds.

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
  wake_trigger: {
    task_id: string;
    status: "completed" | "failed" | "stopped";
    summary: string;
  } | null;  // null if no task_notification was correlated within the window
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
| `"waking"` | enum value | `tugdeck/src/lib/code-session-store/types.ts` | New `CodeSessionPhase` value |
| `wakeTrigger` | state field | `tugdeck/src/lib/code-session-store/types.ts` | New optional field on `CodeSessionState` |
| `handleWakeStarted` | function | `tugdeck/src/lib/code-session-store/reducer.ts` | New — calls existing `resetPerTurnTelemetry()` helper per [#spec-wake-started-state-reset] |
| `handleTurnComplete` extension | function | `tugdeck/src/lib/code-session-store/reducer.ts` | New `waking → idle` commit branch; clears `wakeTrigger` and `pendingUserMessage`; skips writing the empty-text marker into the committed entry |
| `frameToEvent` extension | function | `tugdeck/src/lib/code-session-store/<store wrapper>` | Recognizes `wake_started` frames; mints turnKey; dispatches `WakeStartedEvent` to the reducer |
| `WakeStartedEvent` | type | `tugdeck/src/lib/code-session-store/events.ts` (or sibling) | Reducer event shape (with `turnKey` minted by `frameToEvent`) |
| `routeTopLevelEvent` wake-detector arm | function | `tugcode/src/session.ts:540+` | Tracks `userMessageSeenSinceLastResult`, emits `wake_started` on first idle-content, attaches correlated task_notification metadata |
| `userMessageSeenSinceLastResult` | session field | tugcode SessionManager | Detector state |
| `lastTaskNotification` | session field | tugcode SessionManager | Most recent task_notification within correlation window |
| `WakeStartedMessage` | TS type | `tugcode/src/protocol-types.ts` | IPC contract (no turnKey field; no wake_complete sibling) |
| Rust frame pass-through | enum arm or opaque case | tugcast (CODE_OUTPUT frame types) | Implementer picks typed-variant vs opaque-pass-through based on the actual frame-type infrastructure |
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

#### Step 2: Wire-frame protocol — `wake_started` {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tide-wake): protocol — wake_started IPC frame`

**References:** [D01] bracket pattern, Spec [#spec-wire-frames], (#strategy)

**Artifacts:**
- TypeScript outbound type in `tugcode/src/protocol-types.ts`.
- Mirrored TypeScript event type in `tugdeck/src/lib/code-session-store/events.ts` (or sibling) — with `turnKey: string` on the reducer-event side (minted by the store wrapper in Step 4, not on the wire).
- tugcast handling — implementer surveys the existing CODE_OUTPUT frame infrastructure and picks either typed-enum-variant or opaque pass-through based on what's already in place.
- No emitters or consumers yet — purely additive types so the wire vocabulary exists before Steps 3 and 4 land.

**Tasks:**
- [ ] Add `WakeStartedMessage` to `tugcode/src/protocol-types.ts`. No `WakeCompleteMessage` — `turn_complete` closes the bracket.
- [ ] Mirror in tugdeck event types (default-arm consumers log debug and ignore).
- [ ] Handle in tugcast (typed variant or opaque pass-through per existing pattern).
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
- Bracket close: implicit. tugcode does NOT emit any wake-close frame — claude's normal end-of-turn `result → turn_complete` is the close signal, and the reducer's commit path handles the `waking → idle` transition (Step 4).
- tugcode clears its `isInWake` flag on the `result` so a subsequent wake brackets correctly.

**Tasks:**
- [ ] Detector state on SessionManager: `userMessageSeenSinceLastResult: boolean`, `lastTaskNotification: { payload, receivedAt } | null`, `isInWake: boolean`.
- [ ] Flip `userMessageSeenSinceLastResult` on `SDKUserMessage`; reset on `SDKResultMessage`.
- [ ] On `SDKTaskNotificationMessage`: cache the payload + timestamp in `lastTaskNotification`.
- [ ] On content arriving while `isIdle && !userMessageSeenSinceLastResult`: emit `wake_started` (with trigger metadata if cached notification is within 5s, else null), flip `isInWake = true`, then forward content. **No turnKey on the frame — tugdeck mints it.**
- [ ] On `SDKResultMessage` while `isInWake`: forward the result normally; clear `isInWake`, `lastTaskNotification`. **No `wake_complete` emitted.**
- [ ] Handle nested wakes: a second wake-start condition while already `isInWake` is a no-op (idempotent).

**Tests:**
- [ ] tugcode unit test: feed the Step-1 captured JSONL through `routeTopLevelEvent` and assert the emitted IPC sequence contains exactly one `wake_started` followed by content followed by `turn_complete` (no `wake_complete`).
- [ ] tugcode unit test: feed a synthetic "content with no task_notification" sequence; assert the bracket opens with `wake_trigger: null`.
- [ ] tugcode unit test: feed a synthetic nested-wake sequence; assert only one `wake_started` emits.
- [ ] tugcode unit test: feed a synthetic "user_message arrives between result and content"; assert NO `wake_started` emits.

**Checkpoint:**
- [ ] `cd tugcode && bun test` green.
- [ ] tugcast still routes the new frames without panicking (cargo nextest stays green).

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
- [ ] Add the enum value + state field.
- [ ] Extend `frameToEvent` (store wrapper) to mint a turnKey on `wake_started` receipt and dispatch `WakeStartedEvent` (mirrors `reducer.ts:1606-1609` comment about replay-event minting).
- [ ] Implement `handleWakeStarted` calling `resetPerTurnTelemetry()` (single source of truth — do NOT inline the field list).
- [ ] Extend `handleTurnComplete`: add the `waking → idle` commit branch (clears `wakeTrigger`, clears `pendingUserMessage`, skips empty-text marker in the committed transcript entry).
- [ ] Wire the dispatcher arm for `wake_started` (no `wake_complete` arm).
- [ ] Loosen the `handleTextDelta` guard.
- [ ] Update the comment at `reducer.ts:827`.
- [ ] Update every exhaustive `switch` on `CodeSessionPhase` to include `"waking"` (tsc will flag them).
- [ ] Decide [Q03] (interrupt during wake): document the decision inline in `handleInterrupt` and add the corresponding behavior. Default: `canInterrupt = true` during `waking`; interrupt frame is the same shape as a normal-turn interrupt.
- [ ] **[L23 check]** {#step-4-l23-check}: Two `phase === "idle"` reads are pre-flighted to telemetry chrome (`tide-card-telemetry-popovers.tsx:766`, `tide-card-telemetry-renderers.tsx:607`) — both are `isIdle = snap.phase === "idle"` threaded into popover/renderer logic. Verify they treat `"waking"` as not-idle correctly (probably correct — the popovers want to read "the card is active" during a wake, same as during a user turn). Audit any responder-chain or first-responder code for analogous reads (grep `phase === "idle"` and `phase === 'idle'` across tugdeck/src). No prompt-entry focus restoration was found pre-flight; confirm none surfaces.

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
- **Slice 2 — replay-translator metadata persistence** {#slice-2-replay-translator}. Today, cold-boot rehydration of historic wake turns paints them through the `replaying` phase correctly, but the `wakeTrigger` metadata is lost (replay events don't carry it). Slice 2 chrome that wants to render the trigger needs the translator to synthesize `wake_started` frames (with the captured trigger payload) inline within the existing `replay_started/replay_complete` bracket. No `wake_complete` synthesis needed — the replayed `turn_complete` closes it the same way the live path does. Not needed for Slice 1.
- **Slice 2 — system-note rendering for synthetic user_message_replay.** If Step 1 confirms the SDK emits a user_message_replay with the synthetic user text ("Monitor timed out…"), Slice 2 may render this as a transcript system note. Slice 1 drops it.
- **Wake-aware Stop button.** If [Q03] is deferred at Slice 1, the Stop button's behavior during `waking` may be a follow-up: ergonomics around "the agent woke up and is doing something I didn't ask for — let me stop it" deserve their own polish pass.
- **Telemetry surface for wakes.** A dev-panel inspector showing "how many turns this session were wakes vs user-initiated" — useful for understanding tool-cohort traffic patterns and confirming the fix is exercised by real workflows.
- **Cohort members that don't route through task_notification.** Any cohort member identified in Step 1 as using a different re-entry path (e.g., ScheduleWakeup if it re-binds the session) becomes a separate follow-up: design the appropriate signal, add it to the wake-detector or to a parallel mechanism.
