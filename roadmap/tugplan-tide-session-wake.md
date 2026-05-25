<!-- tugplan-skeleton v2 -->

## Tide session wake after spontaneous external trigger {#tide-session-wake}

**Purpose:** Tide's transcript paints assistant turns that resume claude from idle — Monitor timeouts, Bash/Task `run_in_background` completions, and harness-fired `ScheduleWakeup` / `CronCreate` timers. Without this work, claude continues processing the wake on its side but the resumed text never reaches the user's screen.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | in progress (Slice 1 shipped; Slice 1c-b + Slice 2 in flight) |
| Target branch | main |
| Last updated | 2026-05-25 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

When claude is between turns and goes idle, certain tools can resume it without a user submission:

- **Monitor** — when the watched file matches or the timeout fires
- **Bash** / **Task** with `run_in_background:true` — when the background process exits (and claude idle-waits rather than actively polling via BashOutput/TaskOutput)
- **ScheduleWakeup** — when the requested delay elapses
- **CronCreate** — when the registered cron expression matches the current time

Each of these resumes claude with a synthetic user_message that drives an assistant turn. Tide must show that turn in the transcript.

#### Strategy {#strategy}

- tugcode is the wake detector — observe claude's stream-json stdout, recognize wake-bracket signals, emit a single `wake_started` IPC frame to tugdeck.
- tugdeck's reducer treats `wake_started` as the start of a new turn (a `waking` phase) that closes implicitly on the next `turn_complete`.
- One bracket on the wire for two distinct wake-trigger sources (in-invocation task notifications and harness-fired re-inits) — the reducer cannot tell them apart and doesn't need to.
- Transcript treats wake turns as single-row entries (the wake carries no user-typed text, so there is no "You" bubble to render). Slice 1c-b lifts this to a full sequence substrate ([D07]) — reducer scratch, streaming PropertyStore paths, snapshot, and data source all model a turn as an ordered sequence of typed Messages; the wake's natural absence of a `user_message` Message replaces the sentinel.
- No tugcode-side scheduler. Claude Code's built-in scheduler is the source of truth for ScheduleWakeup / CronCreate timing; tugcode only reacts to its fire signal.
- Slice 2 layers trigger-aware chrome on top of the bracket: tugcode buffers `ScheduleWakeup` / `CronCreate` tool_use payloads in a per-session FIFO ([D08]) and drains them when a Cohort B wake fires, producing a chip-class UI element ([D09]).
- Wake-trigger metadata persists out-of-band via a sidecar JSONL ([D10]) so cold-boot rehydration paints the same chrome as live.
- Tide-side cancellation routes through claude's user_message back-channel ([D12]) — there is no host-initiated tool-call channel in stream-json mode.

#### Success Criteria (Measurable) {#success-criteria}

**Slice 1 (shipped):**

- A Monitor invocation with a 5-second timeout paints its resumed text in the transcript without reopening the session.
- A `ScheduleWakeup delaySeconds:60` paints its wake response in the transcript (at the next minute boundary after `now+60s`, per the harness's documented behavior).
- A `CronCreate` (one-shot and recurring) paints each scheduled fire as a wake turn; the user's CronDelete cancels further fires.
- No wake turn renders with a phantom "You" bubble above it.
- The user can interrupt a runaway wake turn via the Stop affordance.

**Slice 1c-b + Slice 2 (in flight):**

- Reducer, streaming substrate, snapshot, and data source all model a turn as a sequence of typed Messages ([D07]). Wire interleaving (text → tool → text) commits as `[AssistantText, ToolUseMessage, AssistantText]` rather than a flattened single string. The empty-text wake sentinel ([D06]) is gone from every site. All existing transcript / reducer / replay tests pass against the new shape.
- Each wake turn paints with a chip identifying its trigger kind (Monitor / Scheduled / Cron) and a click-expand detail panel.
- After closing and reopening a session, wake turns retain the same chip and detail content (no metadata loss across rehydration).
- A wake fired by `ScheduleWakeup` / `CronCreate` renders its registered prompt as a subdued `system_note` row above the assistant's response.
- The user can cancel a recurring scheduled task by right-clicking its chip and choosing "Cancel"; no further fires arrive over a 3-minute hold.

#### Scope {#scope}

**Slice 1 (shipped):**

1. tugcode wake detection for in-invocation tools (Monitor / Bash runbg idle / Task runbg idle) — `system/task_notification` arm.
2. tugcode wake detection for harness-fired tools (ScheduleWakeup / CronCreate) — `system/init` re-bracket arm.
3. tugdeck reducer + store wrapper handling of the `wake_started` bracket and its `waking → idle` close on `turn_complete`.
4. Transcript data source treats wake turns as single-row entries (via [D06] interim sentinel).

**Slice 1c-b + Slice 2 (in flight):**

5. Lift the turn model to a full sequence substrate ([D07]): reducer scratch holds `Message[]` per active turn, streaming PropertyStore paths key per-Message, `TurnEntry` exposes `messages: ReadonlyArray<Message>`, `ToolCallState` retires onto `ToolUseMessage`, `thinking` becomes a Message kind. Removes the [D06] sentinel end-to-end.
6. Trigger-aware chrome — chip renderer above the wake turn keyed on `WakeTrigger.kind`; Cohort B FIFO correlation in tugcode ([D08], [D09]).
7. Replay-translator metadata persistence — sidecar JSONL ([D10]) so rehydration paints the same chrome as live.
8. System-note rendering for the registered scheduled prompt — Cohort B only; carried on `wake_started.wake_trigger.prompt` ([D11]).
9. Tide-side cancellation of recurring scheduled tasks — context-menu affordance on the cron chip routes a hidden user_message ([D12]).

#### Non-goals (Explicitly out of scope) {#non-goals}

- Durable scheduling across tugcode subprocess restart. Harness scheduling is session-scoped by Anthropic's design (*"dies when Claude exits"*); we match that. Resume-mode rehydration of unexpired scheduled tasks does not currently fire — documented upstream limitation per Step 4.
- Cross-session wake delivery (Routines, Desktop scheduled tasks, etc.). Anthropic ships those separately.
- Cancellation of `ScheduleWakeup` (one-shot wakes). No upstream `WakeDelete` tool exists. Step 9 covers `CronCreate` cancellation only.
- Per-fire cancellation of cron occurrences (only the whole cron task can be cancelled).
- Out-of-band correlation IDs between `ScheduleWakeup` / `CronCreate` tool_use payloads and their fires beyond the FIFO heuristic ([D08]). If/when upstream exposes a correlation id, the implementation upgrades; until then the FIFO is the source of truth.

#### Dependencies / Prerequisites {#dependencies}

- Claude Code v2.1.150 or compatible (the Cron* tools require v2.1.72+; `system/task_notification` shape pinned against `@anthropic-ai/claude-agent-sdk/sdk.d.ts:1659-1668`).
- `tugcode/probes/wake-investigation/` captures of claude's stream-json wire (committed; reproducible via `probe-harness.mjs`).

#### Constraints {#constraints}

- tugcode invokes claude with `--input-format=stream-json --output-format=stream-json --verbose --include-partial-messages --replay-user-messages`. The detector and the bracket close design must operate on the wire shape that mode produces.
- The `wake_started` IPC frame and `WakeTrigger` snapshot field are camelCase tugdeck-side, snake_case tugcode-side. Translate at the reducer boundary.
- tugcode is bun-compiled to a standalone binary (`bun build --compile`). Source edits require an explicit rebuild — there is no HMR.

#### Assumptions {#assumptions}

- The harness scheduler's `system/init` fire signal is a reliable contract for Cohort B. The pattern is empirically observed (`tugcode/probes/wake-investigation/capture-*.stdout`) but not in published SDK documentation. A future Claude Code release that alters the pattern would surface here.
- `system/task_notification` fields used today (`task_id`, `tool_use_id`, `status`, `summary`, `output_file`) remain on the wire. The SDK type declares all of these except `tool_use_id`; the wire emits all five.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Cohort taxonomy (RESOLVED) {#q01-cohorts}

**Question:** Which tools produce wake turns, and what wire signal does tugcode observe for each?

**Resolution:** Three cohorts, two distinct wire signals:

| Cohort | Tools | Wire signal | Handler |
|---|---|---|---|
| **A — in-invocation async** | Monitor; Bash `run_in_background:true` (idle); Task `run_in_background:true` (idle) | `system/task_notification` between turns | `handleTaskNotification` |
| **B — harness re-invoke** | ScheduleWakeup; CronCreate | A fresh `system/init` between turns (claude's built-in scheduler fired its timer) | `handleWakeReInit` |
| **C — not wake sources** | PushNotification (sync outbound); TaskOutput (blocking wait); Task/Bash `run_in_background:true` WITH active poll | n/a | none |

Empirical capture data at `tugcode/probes/wake-investigation/capture-sw-60-*.stdout` and `capture-cron-1m-*.stdout` plus `tugrust/.../v2.1.150-spike/test-{monitor-wake,bash-runbg-wake,task-runbg-idle-wake}.jsonl`.

#### [Q02] Should the wake turn's chrome show what triggered it? (RESOLVED) {#q02-trigger-chrome}

**Question:** When a wake turn paints, should the transcript carry a visible "Resumed by X" cue?

**Resolution:** Yes — chip-class chrome above the assistant text per [D09], populated for Cohort A from the existing `WakeTrigger` snapshot field and for Cohort B from the per-session FIFO ([D08]) that buffers `ScheduleWakeup` / `CronCreate` tool_use payloads. Implemented in Step 6.

Field signal (Session 3702c898): user noted the Stop button flips on during a wake even though the user did not initiate the turn. The chip-class chrome treats wake-initiated turns as a distinct visual class (still interruptible per [Q03], but the chrome signals "spontaneous").

#### [Q03] How should interrupt behave during a wake? (RESOLVED) {#q03-interrupt-during-wake}

**Question:** If the user clicks Stop while a wake turn is streaming, what happens?

**Resolution:** `canInterrupt` is true during `phase === "waking"`. The interrupt frame is identical in shape to a user-initiated interrupt — there is no pending user_message to discard, so the implementation simplification is to call the existing interrupt path. The wake's `turn_complete` (or `turn_cancelled`) closes the bracket.

---

### Risks and Mitigations {#risks}

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Claude Code release changes the `system/init` re-emit pattern (e.g., adds a new mid-turn re-init context that's neither compact nor wake) | low | high | Cohort B detector lives in one place (`handleClaudeLine`). The disambiguation rule is "between-turn re-init = wake, mid-turn re-init = not wake" — pinned by `tugcode/src/__tests__/wake-reinit.test.ts`. Step 4 adds a fixture-replay drift test that catches wire-shape changes earlier. |
| `system/task_notification` SDK type misses fields the wire emits (e.g., `tool_use_id`) | low | low | Existing drift test `tugcode/src/__tests__/wake-sdk-drift.test.ts` pins both compile-time (declared fields) and runtime (wire fields) coverage. |
| Concurrent wakes (Cohort A `task_notification` and Cohort B re-init arriving in close succession) double-bracket on the wire | low | low | Both handlers guard on `this.isInWake` and no-op if a bracket is already open. The reducer also flattens nested wakes at [D01]. |
| Resume-mode session (`--resume`) restores unexpired harness tasks that then fire — same detector applies but is unverified empirically | medium | low | Step 4 manual repro. The detector's heuristic is turn-state-based and doesn't care about session lifecycle, so it should hold. |
| Sequence-substrate rework (Step 5, [D07]) touches reducer state, streaming PropertyStore paths, snapshot shape, and every consumer of `TurnEntry.userMessage` / `.assistant` / `.thinking` / `.toolCalls`. Risks silent transcript regressions and streaming-cell remount cascades | medium | high | Single landing commit; full reducer + transcript-data-source + replay test suite must pass; the existing wake / inflight / replay test cases form the regression net. Per-Message `messageKey` preserves [L26] mount identity. Manual repro of a representative session matrix gates merge. |
| `[D07]` append-or-mutate heuristic (trailing-Message-kind match) misorders the wire — e.g. a `thinking_text` partial arrives while an `assistant_text` block is mid-stream and spuriously closes the text block. Multi-block assistant turns commit with the wrong segmentation | medium | medium | Verify the wire contract against captured fixtures BEFORE locking the rule (Step 5 open contract #1, #2). If the wire provides a stronger signal (`text_block_start` etc.), key on that. Add a fixture-replay test of a multi-block / interleaved-thinking trace as the regression net. |
| Cohort B FIFO ([D08]) misattributes a fire to the wrong scheduled task when multiple ScheduleWakeup tasks register with identical `delaySeconds` | low | low | Documented [D08] edge case; UI chip shows the misattributed prompt rather than the correct one — visible to user; corrective is to query claude. Upgrade path exists if/when upstream exposes a correlation id. |
| Sidecar JSONL ([D10]) and claude's JSONL drift out of sync (e.g., partial write on crash leaves a turn with metadata pointing at a missing turn_index) | medium | low | Sidecar writes use append-only with fsync per record. Replay-translator tolerates orphan sidecar entries (skip + warn) and missing entries (omit chrome). |
| Hidden cancellation user_message ([D12]) produces a visible "Cancelled." assistant turn that leaks into the transcript despite suppression | medium | low | Filter the turn at the tugcode boundary (no `submit_accepted`, drop subsequent `assistant_text` until `turn_complete`). Known limitation noted in Step 9; future polish can prompt-engineer the synthetic message to suppress acknowledgment. |

---

### Design Decisions {#design-decisions}

#### [D01] Bracket pattern with a new `waking` phase {#d01-bracket-pattern}

**Decision:** A new reducer phase `waking` brackets the wake turn. Opened by `wake_started`, closed implicitly by the next `turn_complete` (no separate `wake_complete` frame).

**Rationale:** A wake turn needs a phase distinct from `idle` (so guards that drop assistant text in idle don't fire) and distinct from `submitting`/`streaming` (so submit/interrupt affordances aren't enabled mid-wake unless [Q03] says so). Closing implicitly on `turn_complete` reuses the existing turn-close path — no new wire frame, no new commit code.

Nested wakes flatten to one outer bracket. `handleWakeStarted` arriving while already `phase === "waking"` is treated as an idempotent metadata refresh.

#### [D02] tugcode is the detector, not the reducer {#d02-detector-location}

**Decision:** tugcode owns wake detection. The reducer only knows about the `wake_started` IPC frame.

**Rationale:** The wire shapes that signal a wake (`system/task_notification`, fresh `system/init`) are claude/SDK-specific. Keeping that knowledge in tugcode means the reducer is portable and the SDK's wire-shape evolution is absorbed at the tugcode boundary. The reducer's job is to react to a clean, semantic frame.

#### [D03] Guard loosening is additive {#d03-additive-guards}

**Decision:** Only one existing reducer guard needs to loosen for `waking`-phase events: `handleTextDelta`'s phase check now accepts `idle | streaming | waking` instead of `idle | streaming`. Every other guard remains a drop case; the wake bracket is the sole path that opens an inflight slot for waking.

**Rationale:** Minimum-change defensive policy. Each loosened guard is a new attack surface; one is auditable, more would not be.

#### [D04] Detection in tugcode, not the reducer {#d04-detection-location}

**Decision:** The detector lives in `tugcode/src/session.ts:handleClaudeLine`, which sees every parsed stream-json event regardless of `activeTurn` state.

**Rationale:** Cohort A `task_notification` arrives between turns (`activeTurn === null`); Cohort B re-init can arrive either between turns or mid-turn. The detector must classify correctly in both cases, which requires a single dispatch site that observes every event before turn-routing decides what to do with it.

#### [D05] Cohort B uses claude's harness scheduler — tugcode detects the re-init signal {#d05-reinit-detector}

**Decision:** Claude Code v2.1+ has its own scheduler that fires `ScheduleWakeup` / `CronCreate` timers between turns and emits a fresh `system/init` event to bracket the resulting assistant turn. tugcode does NOT run its own scheduler; it observes the fire signal and opens a wake bracket.

**Disambiguation:** `system/init` is also re-emitted mid-turn after `compact_boundary` events. Distinguish by `activeTurn` state at the time of arrival:

- `activeTurn === null` and `sessionInitSeen === true` → wake fire; emit `wake_started` and open `ActiveTurn`.
- `activeTurn !== null` and `sessionInitSeen === true` → mid-turn re-init (compact); fall through to `dispatchEventToTurn` so the existing `system_metadata` IPC forwarding behavior is preserved.
- `sessionInitSeen === false` → first init; flip the flag and fall through to normal dispatch.

The wake's user_message (the registered prompt) is injected into claude's internal queue and never appears on the stdout wire — tugcode sees only the assistant's response.

**Why no tugcode-side scheduler:** Empirically verified that the harness fires its own timers in stream-json spawn mode (see `roadmap/archive/wake-investigation-findings.md`). Re-implementing the schedule logic would (a) duplicate work the harness already does, (b) double-fire if both timers run in parallel, and (c) require re-implementing the harness's cron rounding / jitter / DST handling.

#### [D06] Transcript treats wakes as single-row entries {#d06-transcript-wake-single-row}

**Decision:** `TideTranscriptDataSource` detects wake-style `TurnEntry`s (`userMessage.text === ""` and no attachments) and emits ONE row per such turn (the code-row only), not two. The per-turn index math uses an offset-table lookup; the renderer is unchanged.

**Rationale:** Wake turns carry no user-typed text — the empty-text marker is a contract sentinel, not user data. Rendering it as a "You" row produces a phantom user bubble.

**Status:** **Superseded by [D07].** Step 5 retires the sentinel end-to-end:
- The reducer no longer populates `pendingUserMessage` with empty text for wakes (replaced by `pendingTurn` with `isWake: true` and `initialMessages: []`).
- The committed wake `TurnEntry.messages` simply contains no `user_message` Message — iteration yields zero user rows naturally.
- `isWakeTurn` / `isWakeInflight` / `userRowIndexForTurn`'s `-1` sentinel / the offset-table layout machinery all delete.

The sentinel pattern was the right interim shape under Slice 1c-a's constraint that the committed entry be a paired record; [D07] removes that constraint at the substrate level, and the sentinel goes with it.

#### [D07] Full sequence substrate — Message identity, per-Message streaming, ToolCallState retirement {#d07-sequence-substrate}

**Decision:** Reducer state, committed entry shape, streaming substrate, and the data source all model a turn as an ordered sequence of typed Messages. The Message is the unit of identity, mutation, and rendering. Paired-field aggregation (`userMessage` + `assistant` + `thinking`) and parallel storage (`toolCallMap` beside scratch) retire.

**Message union:**

```ts
type MessageKind =
  | "user_message"
  | "assistant_text"
  | "assistant_thinking"
  | "system_note"
  | "tool_use";

interface MessageBase {
  /**
   * Stable React-row identity, minted at Message creation and unchanged
   * through every subsequent mutation (streaming append, tool_result
   * landing on a tool_use, etc.). Derived as `${turnKey}-m${seq}` where
   * `seq` is a monotonic per-turn counter — debuggable and uniqueness
   * is intrinsic to the construction.
   */
  messageKey: string;
  createdAt: number;
}

interface UserMessage extends MessageBase {
  kind: "user_message";
  text: string;
  attachments: ReadonlyArray<AtomSegment>;
  submitAt: number;
}

interface AssistantText extends MessageBase {
  kind: "assistant_text";
  text: string;             // mutates by append during streaming
}

interface AssistantThinking extends MessageBase {
  kind: "assistant_thinking";
  text: string;
}

interface SystemNote extends MessageBase {
  kind: "system_note";
  text: string;
  source: "scheduled" | "compact" | "other";
}

interface ToolUseMessage extends MessageBase {
  kind: "tool_use";
  toolUseId: string;
  toolName: string;
  input: unknown;
  status: "pending" | "done" | "error";
  result: unknown | null;
  structuredResult: unknown | null;
  parentToolUseId?: string;
  toolWallMs: number | null;
}

type Message =
  | UserMessage
  | AssistantText
  | AssistantThinking
  | SystemNote
  | ToolUseMessage;
```

**Reducer state shape:**

```ts
interface ScratchEntry {
  messages: Message[];                    // arrival-order sequence
  toolCallIndex: Map<string, number>;     // toolUseId → messages array index
                                          // (O(1) lookup for tool_result / tool_use_structured)
  nextMessageSeq: number;                 // monotonic counter for messageKey minting
}

state.scratch: Map<msgId, ScratchEntry>;  // shape change: messages, not {assistant,thinking}
state.pendingTurn: PendingTurn | null;    // replaces pendingUserMessage
// state.toolCallMap retires (folded into ScratchEntry.toolCallIndex)

interface PendingTurn {
  turnKey: string;
  submitAt: number;
  isWake: boolean;
  initialMessages: Message[];   // [user_message] for handleSend;
                                // [] or [system_note] for handleWakeStarted
  nextMessageSeq: number;       // carries through to ScratchEntry at drain
}
```

**TurnEntry shape:**

```ts
interface TurnEntry {
  turnKey: string;
  msgId: string;
  messages: ReadonlyArray<Message>;
  // turn-level metadata unchanged: result, endedAt, wallClockMs,
  // awaitingApprovalMs, transportDowntimeMs, activeMs, ttftMs,
  // ttftcMs, reconnectCount, maxStreamGapMs, turnEndReason, cost
}
```

Removed fields: `userMessage`, `thinking`, `assistant`, `toolCalls`.

**Append-or-mutate rule for text Messages.** When an `assistant_text` (or `assistant_thinking`) delta lands:

1. If `scratch[msgId].messages` is empty OR its trailing Message kind ≠ this delta's kind → append a fresh Message of this kind.
2. Otherwise → mutate the trailing Message's `text`.

Wire interleaving is preserved: `text → tool_use → tool_result → text` produces `[AssistantText, ToolUseMessage, AssistantText]` — two distinct text Messages bracketing the tool call, as the wire emitted. Today's substrate squashes this to one concatenated string; tomorrow's preserves the temporal sequence.

**Streaming substrate — per-Message PropertyStore paths.** The three fixed channels retire:

| Today | Tomorrow |
|---|---|
| `turn.${turnKey}.assistant` | `turn.${turnKey}.message.${messageKey}.text` (per AssistantText / AssistantThinking) |
| `turn.${turnKey}.thinking` | (same as above) |
| `turn.${turnKey}.tools` | `turn.${turnKey}.message.${messageKey}.state` (per ToolUseMessage, JSON-serialized) |

The `write-inflight` effect carries `messageKey` and `channel: "text" | "state"`. [L26] holds per-Message: `messageKey` is stable from creation through commit; the cell wrapper for that Message subscribes once and retains its source forever.

**Wake handling.** `handleWakeStarted` sets `pendingTurn = { turnKey, submitAt, isWake: true, initialMessages: [...] }`. `initialMessages` is `[]` for a bare wake, or `[SystemNote{prompt}]` once Step 8's `wakeTrigger.prompt` is populated (no separate code path needed in Step 8 — the system_note is just an initial Message). The wake's `messages` never contain a `user_message` Message, so the data source produces no user row. No sentinel.

**`pendingUserMessage` and `snapshot.inflightUserMessage` retire.** Replaced by `state.pendingTurn` (reducer-internal) and `snapshot.activeTurn: ActiveTurnSnapshot | null` (public) exposing `{ turnKey, submitAt, isWake, messages: ReadonlyArray<Message> }`. The data source iterates `activeTurn.messages` for inflight rows, same way it iterates `turn.messages` for committed rows.

**ToolCallState retires.** Its fields move onto `ToolUseMessage`. Tool calls live in `messages` in arrival position; `toolCallIndex` is the O(1) lookup for tool_result handling, pointing into the messages array instead of being parallel storage.

**Rationale.** Three forces make the substrate the right scope:

1. **Wire-shape fidelity.** The wire emits a sequence; today's substrate flattens it. A boundary-translation refactor (paired substrate, sequence at commit) leaves the temporal interleaving — text before a tool call vs. text after — unrecoverable. Future renders can't show what claude actually did because the data is gone.
2. **Extension at the kind level.** Adding a new Message kind under the substrate model is: add a union case, add a handler, add a renderer. The `TurnEntry` shape never changes. Under the boundary model, every new kind needs a new field on `TurnEntry`, a new merge step in `buildTurnEntry`, and consumer updates — the type system theater of "messages" hides that the substrate doesn't believe in them.
3. **Single representation.** Boundary translation maintains two reps (paired substrate + synthesized messages). They drift. The substrate model is one rep end-to-end: reducer holds it, streaming writes it, snapshot exposes it, render iterates it.

**Migration.** Single landing commit. The dependencies between types, reducer state, handlers, streaming paths, data source, consumers, and tests are tight enough that dual-rep migration would carry more risk (drift between reps) than just cutting over. The working tree is green at each step of the cutover; the commit boundary is just where the last `bun x tsc --noEmit && bun test` goes green.

**Open contracts to verify before locking.** Two open contracts gate the append-or-mutate rule:

1. Does the wire emit any signal that distinguishes "continuation of the previous text block" from "new text block separated by a tool call" beyond the bare ordering? If yes, the append-or-mutate rule should key on that signal rather than on the trailing-Message-kind heuristic.
2. For thinking: does claude ever interleave `thinking_text` with `assistant_text` mid-block, or are they always discrete? The heuristic depends on this.

Both verified against `tugcode/probes/wake-investigation/capture-*.stdout` before Step 5 lands code.

#### [D08] Cohort B trigger correlation via per-session FIFO {#d08-cohort-b-fifo}

**Decision:** Tugcode buffers `ScheduleWakeup` / `CronCreate` tool_use payloads in a per-session FIFO at the time they appear on the stdout wire. On a Cohort B wake bracket:

- `ScheduleWakeup` fire → consume the FIFO's head ScheduleWakeup entry.
- `CronCreate` fire → look up the entry by `cron_id` (the harness's re-init does not carry it, so the lookup is best-effort: most recent CronCreate with no CronDelete). Recurring fires reuse the same entry until a CronDelete arrives.

The FIFO is per-session, in-memory, dropped on session close. Persisted via [D10]'s sidecar for replay.

**Rationale:** The harness's `system/init` re-emit carries no metadata identifying which scheduled task fired. The FIFO is best-effort but reliable in practice — concurrent unrelated scheduled tasks fire at minute boundaries with discrete identities and rarely overlap. The misattribution edge case (two ScheduleWakeup tasks with identical `delaySeconds`) is documented as a non-goal; the chrome chip will display the misattributed prompt, which is visible to the user and recoverable.

#### [D09] Chrome visual class — chip above the assistant row {#d09-chrome-visual-class}

**Decision:** A `<TranscriptChrome>` chip renders above the wake turn's assistant text. The chip is a kind-specific icon + short label:

- `task_notification` → "Monitor" with summary tooltip.
- `schedule_wakeup` → "Scheduled" with fire time + delay tooltip.
- `cron_create` → "Cron" with cron expression + next-fire tooltip.

Click expands an inline detail panel; click again collapses. The chip is the only new chrome element; the assistant text row beneath it is unchanged.

**Rationale:** Minimal disruption to existing transcript layout. Distinct from user-message styling (which the wake lacks). Signals "spontaneous" without consuming a full row. Click-to-expand keeps detail reversible — the chip is glanceable; the panel is on-demand.

#### [D10] Trigger persistence via sidecar JSONL {#d10-sidecar-jsonl}

**Decision:** Tugcode writes wake-trigger metadata to `~/.tugtool/wake-triggers/<session_id>.jsonl`. One line per wake fire:

```json
{ "turn_index": 7, "wake_trigger": { "kind": "schedule_wakeup", "summary": "...", "scheduled_for": "..." }, "prompt": "summarize today's commits" }
```

`turn_index` references the corresponding turn in claude's `~/.claude/projects/<projectId>/<sessionId>.jsonl`. The replay translator loads the sidecar at rehydration time and joins on `turn_index`. Writes are append-only with `fsync` per record.

**Rationale:** Claude's JSONL is owned by Anthropic — we do not modify its schema. A sidecar isolates our metadata; the join key is the only coupling. tugbank's `/api/defaults` model is for user prefs, not per-session timeline metadata; using it here would inflate that namespace inappropriately. The `~/.tugtool/wake-triggers/` directory is tugcode-owned and may be deleted at any time (replay simply omits chrome for affected turns).

#### [D11] Wake prompt carried on `wake_started.wake_trigger.prompt` {#d11-prompt-on-wake-started}

**Decision:** The scheduled prompt extends `wake_started.wake_trigger` with an optional `prompt: string` field. The reducer reads it at bracket-open and appends a `Message { kind: "system_note", text: prompt, source: "scheduled" }` to the wake turn's `messages` array (Step 5 sequence model). Persisted via [D10].

**Rationale:** Avoids a separate `wake_prompt` IPC frame. Keeps all wake metadata in one frame. The field is optional — Cohort A has no synthetic prompt; legacy `wake_started` records without `prompt` remain valid. ipc_version stays at 2 (additive field).

#### [D12] Cancellation transport via hidden user_message {#d12-cancellation-hidden-user-message}

**Decision:** Tide-side cancellation routes through the existing user_message channel:

1. Tugdeck UI sends `cancel_scheduled_task { cron_id }` IPC.
2. Tugcode injects a hidden user_message ("/cancel cron `<id>`") into claude's stdin.
3. Tugcode flags the resulting turn for transcript suppression: no `submit_accepted` is emitted; subsequent `assistant_text` / `turn_complete` frames for that turn are dropped at the tugcode boundary so they never reach the transcript renderer.

**Rationale:** Claude's stream-json `--input-format` accepts only user_message frames as host input — there is no host-initiated tool-call channel. The user_message route is the only supported back-channel for triggering a specific tool (CronDelete). Hiding it from the transcript preserves the affordance's directness: the user clicks Cancel, the chip vanishes, no stray chat turn.

**Known limitation:** claude's brief acknowledgment of the cancellation may leak into the transcript before suppression filters it. Mitigation: prompt-engineer the synthetic message to instruct an empty reply; failing that, accept the brief flash as known polish work.

---

### Specification {#specification}

#### Wire frames {#spec-wire-frames}

**`wake_started`** (tugcode → tugdeck IPC, ipc_version 2):

```ts
interface WakeStarted {
  type: "wake_started";
  session_id: string;
  wake_trigger: {
    // Always present
    task_id: string;          // empty for Cohort B (no tool id on the wire)
    tool_use_id: string;      // empty for Cohort B
    status: "completed" | "failed" | "stopped";
    summary: string;          // user-supplied reason for Cohort A; tool kind label for Cohort B
    output_file: string;

    // Added by Step 6+; optional, ipc_version stays at 2
    kind?: "task_notification" | "schedule_wakeup" | "cron_create";
    prompt?: string;          // [D11] — Cohort B only, the registered scheduled prompt
    scheduled_for?: string;   // ISO timestamp — ScheduleWakeup fire time
    cron_expression?: string; // CronCreate's expression string
    cron_id?: string;         // CronCreate's id (for cancellation routing per [D12])
  };
  ipc_version: 2;
}
```

No `wake_complete` frame. The bracket closes on the next `turn_complete`.

**`cancel_scheduled_task`** (tugdeck → tugcode IPC, added by Step 9):

```ts
interface CancelScheduledTask {
  type: "cancel_scheduled_task";
  session_id: string;
  cron_id: string;
  ipc_version: 2;
}
```

No response frame on the wire — the user sees the chip vanish (state derives from the suppressed CronDelete result; see [D12]).

#### Reducer state {#spec-reducer-state}

`CodeSessionState` gains (Slice 1 — shipped):

```ts
phase: ... | "waking";
wakeTrigger: WakeTrigger | null;  // camelCase, populated on wake_started, cleared on turn_complete
```

`CodeSessionSnapshot` mirrors the same.

Slice 1c-b ([D07], Step 5) replaces the paired substrate with a full sequence substrate. See [D07] for the full type definitions; the surface relevant to the snapshot is:

```ts
interface TurnEntry {
  turnKey: string;
  msgId: string;
  messages: ReadonlyArray<Message>;
  // turn-level metadata unchanged: result, endedAt, wallClockMs,
  // awaitingApprovalMs, transportDowntimeMs, activeMs, ttftMs,
  // ttftcMs, reconnectCount, maxStreamGapMs, turnEndReason, cost
}

interface ActiveTurnSnapshot {
  turnKey: string;
  submitAt: number;
  isWake: boolean;
  messages: ReadonlyArray<Message>;     // live, mutates as wire events land
}

interface CodeSessionSnapshot {
  // ... unchanged surface ...
  transcript: ReadonlyArray<TurnEntry>;
  activeTurn: ActiveTurnSnapshot | null;   // replaces inflightUserMessage
}
```

Removed from `TurnEntry`: `userMessage`, `thinking`, `assistant`, `toolCalls`. Removed from snapshot: `inflightUserMessage`. Removed from reducer state: `toolCallMap` (folded into `ScratchEntry.toolCallIndex` per [D07]), `pendingUserMessage` (replaced by `pendingTurn`).

#### Phase transitions {#spec-phase-transitions}

```
idle ───wake_started──→ waking ───turn_complete──→ idle (commits TurnEntry with empty userMessage)
                          │
                          └──interrupt──→ committing → idle (commits partial or cancels)
```

`submit` from `waking` enters the same merge-with-active-wake path as submit during streaming. The `Send` button is disabled during `waking`; `Stop` is enabled.

#### Guard loosening (only one needed) {#spec-guard-loosenings}

`handleTextDelta`'s phase guard: `if (state.phase !== "idle" && state.phase !== "streaming" && state.phase !== "waking") return ...`. Every other guard stays as drop case.

#### Transcript rendering {#spec-transcript}

**Slice 1c-b (Step 5):** the data source iterates `turn.messages` for each committed turn and `activeTurn.messages` for the in-flight turn, emitting one row per Message. The row's React key is `messageKey` (stable from Message creation through commit per [D07] / [L26]).

Per-Message row kinds:

- `user_message` → `{ kind: "user", messageKey, message }`
- `assistant_text` → `{ kind: "code", messageKey, message, turnKey }` (cell subscribes to `turn.${turnKey}.message.${messageKey}.text`)
- `assistant_thinking` → `{ kind: "thinking", messageKey, message, turnKey }` (cell subscribes to the same per-Message text path)
- `system_note` → `{ kind: "system-note", messageKey, message }` (Step 8 renders these for `source === "scheduled"`)
- `tool_use` → `{ kind: "tool", messageKey, message, turnKey }` (cell subscribes to `turn.${turnKey}.message.${messageKey}.state`; future polish; for Slice 1c-b the row exists but the renderer may fall back to today's tool log surface)

The `cellRenderers` map gains the new kinds; per [L26] each kind resolves to a single stable component-type + renderer-reference (no inline lambda traps).

Wake-turn chrome (Step 6): if `turn.wakeTrigger != null` (committed) or `activeTurn.isWake && activeTurn.messages.length > 0` (inflight), emit a `{ kind: "chrome", trigger }` row before the first message row of the turn. Chrome rows are not Messages — they're a per-turn affordance the data source synthesizes from `wakeTrigger`.

Ghost rows for queued sends unchanged: one per `QueuedSend`, key `${turnKey}-ghost`.

**No `isWakeTurn` / `isWakeInflight` predicates.** A wake's `messages` simply doesn't contain a `user_message` Message, so no user row is emitted — the iteration produces exactly the rows the data shape implies.

**No `userRowIndexForTurn` / `assistantRowIndexForTurn` sentinels.** Consumers needing a flat row index for a specific Message use `messageRowIndex(turnIndex, messageKey)` which walks the prefix; the function is total (returns a valid index or throws on unknown key — no `-1` sentinel branch for consumers to handle).

---

### Compatibility / Migration / Rollout {#rollout}

No migration required. The change is additive:

- New IPC frame `wake_started` (consumers that don't know about it ignore it).
- New reducer phase `waking` (a value, not a schema change).
- New `wakeTrigger` snapshot field (nullable; legacy consumers see `null`).

Rollback is trivial: revert the commits. No persisted state shape changes.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

**Slice 1 (shipped):**

- `tugcode/src/__tests__/wake-reinit.test.ts` — re-init detector tests.
- `tugcode/probes/wake-investigation/probe-harness.mjs` — spawns claude directly, captures the raw stream-json wire.
- `tugcode/probes/wake-investigation/probe-tugcode.mjs` — spawns the compiled tugcode binary, captures its IPC stdout end-to-end.
- `tugcode/probes/wake-investigation/analyze.mjs` — decodes a capture for human reading.
- `tugcode/probes/wake-investigation/capture-{sw-60,cron-1m}-*.{stdout,jsonl,meta,stderr}` — committed capture artifacts.
- `roadmap/archive/wake-investigation-findings.md` — empirical findings doc anchoring [D05].

**Slice 1c-b + Slice 2 (in flight):**

- `tugcode/src/wake-trigger-sidecar.ts` — write/read primitive for `~/.tugtool/wake-triggers/<session_id>.jsonl` (Step 7).
- `tugcode/src/__tests__/wake-trigger-sidecar.test.ts` — sidecar write + concurrent-read invariants.
- `tugcode/src/__tests__/wake-trigger-correlation.test.ts` — Cohort B FIFO drain semantics (Step 6).
- `tugcode/src/__tests__/cancellation.test.ts` — `cancel_scheduled_task` → hidden user_message → suppression invariants (Step 9).
- `tugdeck/src/components/tugways/transcript/transcript-chrome.tsx` — chip renderer (Step 6); context menu added in Step 9.
- `tugdeck/src/components/tugways/transcript/system-note-row.tsx` — subdued row for `system_note` Messages (Step 8).

#### Symbols added / modified {#symbols}

**Slice 1 (shipped):**

`tugcode/src/session.ts`:

- `class SessionManager` gains `private sessionInitSeen: boolean = false` (reset by `killAndCleanup`).
- `handleClaudeLine` gains the re-init detector branch ([D05]).
- New private method `handleWakeReInit()` — Cohort B bracket-open (mirrors `handleTaskNotification`).
- `handleTaskNotification` (Cohort A) is unchanged.
- New IPC type `WakeStarted` and pure helper `buildWakeStartedMessage`.

`tugdeck/src/lib/code-session-store/`:

- `reducer.ts` gains `handleWakeStarted`, `wakeTrigger` state field, `waking` phase value.
- `types.ts` gains `WakeStartedEvent`, `WakeTrigger`.
- `frameToEvent.ts` mints a `turnKey` for the wake bracket.

`tugdeck/src/lib/tide-transcript-data-source.ts`:

- Per-snapshot offset-table lookup replaces flat-index math.
- `isWakeTurn` / `isWakeInflight` helpers.
- `userRowIndexForTurn` returns `-1` for wake turns (consumers handle the sentinel).

**Slice 1c-b + Slice 2 (in flight):**

`tugdeck/src/lib/code-session-store/types.ts`:

- `MessageKind`, `Message` discriminated union ([D07], Step 5).
- `TurnEntry` reshaped to `{ turnKey, msgId, messages, ...turn-level metadata }`; `userMessage` / `thinking` / `assistant` / `toolCalls` fields deleted (Step 5).
- `ActiveTurnSnapshot` interface; `CodeSessionSnapshot.activeTurn` replaces `inflightUserMessage` (Step 5).
- `ToolCallState` interface deleted — fields move onto `ToolUseMessage` (Step 5).
- `WakeTrigger` extended with `kind`, `prompt`, `scheduled_for`, `cron_expression`, `cron_id` (Step 6).
- `CancelScheduledTaskFrame` outbound IPC type (Step 9).

`tugdeck/src/lib/code-session-store/reducer.ts`:

- `state.scratch` reshaped from `Map<msgId, {assistant, thinking}>` to `Map<msgId, ScratchEntry>` (Step 5).
- `state.pendingTurn` replaces `state.pendingUserMessage` (Step 5).
- `state.toolCallMap` deleted; tool index folded into `ScratchEntry.toolCallIndex` (Step 5).
- `handleTextDelta` rewrites for append-or-mutate trailing Message (Step 5).
- `handleToolUse` / `handleToolResult` / `handleToolUseStructured` update Messages via `toolCallIndex` (Step 5).
- `handleSend` / `handleWakeStarted` seed `pendingTurn.initialMessages` (Step 5; Step 8 extends `handleWakeStarted` to include the `SystemNote` for `wakeTrigger.prompt`).
- `buildTurnEntry` simplifies to `messages: Array.from(scratch[msgId]?.messages ?? [])` plus turn-level metadata (Step 5).
- `write-inflight` effect kind carries `messageKey` and `channel: "text" | "state"` (Step 5).

`tugdeck/src/lib/code-session-store/store.ts`:

- Snapshot derivation builds `activeTurn` from `pendingTurn` + scratch (Step 5).
- `cancelScheduledTask(cron_id)` action (Step 9).

`tugdeck/src/lib/tide-transcript-data-source.ts`:

- Per-Message iteration replaces offset-table (Step 5).
- `isWakeTurn` / `isWakeInflight` / `userRowIndexForTurn` / `assistantRowIndexForTurn` / `RowLayout` / `buildRowLayout` / `locateCommittedRow` all deleted (Step 5).
- New: `MessageLayout`, `messageRowIndex(turnIndex, messageKey)`.
- `TideTranscriptCellKind` extends to `"user" | "code" | "thinking" | "system-note" | "tool" | "ghost"` (Step 5; renderer registrations added in Step 6 / 8 as those steps land).
- Emits `{ kind: "chrome", trigger }` row before wake-turn messages (Step 6).

`tugdeck/src/components/tugways/cards/tide-card-transcript.tsx`:

- Cell renderers updated: each Message kind maps to one renderer; per-Message streaming subscriptions key off `messageKey` (Step 5).

`tugdeck/src/components/tugways/cards/turn-entry-markdown.ts`:

- Iterates `turn.messages` filtering `assistant_text` (was: read `turn.assistant`) (Step 5).

`tugdeck/src/components/tugways/cards/tide-card-telemetry-popovers.tsx`:

- Reads the first `user_message` Message's text (was: `turn.userMessage.text.trim()`) (Step 5).

`tugdeck/src/components/tugways/chrome/tide-thinking-block.tsx`:

- Reads `assistant_thinking` Message(s) (was: `TurnEntry.thinking`) (Step 5).

`tugcode/src/session.ts`:

- `pendingWakeTriggers` per-session FIFO ([D08], Step 6).
- `wake_started` emission extended with new optional fields (Step 6).
- Sidecar JSONL write on every wake bracket ([D10], Step 7).
- `handleCancelScheduledTask` IPC handler — injects hidden user_message ([D12], Step 9).
- Turn-suppression flag and IPC-frame filter for the hidden cancellation turn (Step 9).

---

### Test Plan Concepts {#test-plan-concepts}

Pure-logic only (no DOM). Three layers:

1. **Reducer**: each handler tested with hand-built `WakeStartedEvent` / `TurnCompleteEvent` against the state shape.
2. **tugcode dispatcher**: `handleClaudeLine` / `handleInterTurnEvent` / `handleWakeReInit` tested with parsed JSON event objects; assert state transitions and IPC emissions.
3. **Wire shape pinning**: drift tests load captured stream-json fixtures and assert the fields tugcode reads are present.

---

### Execution Steps {#execution-steps}

The implementation shipped across the following work; all steps are complete except Step 4.

#### Step 1: Slice 1 — Cohort A wake bracket {#step-1}

**Status:** Shipped.

**Scope:** `wake_started` IPC + reducer `waking` phase + `handleTaskNotification` detector for `system/task_notification`.

**Files:**
- `tugcode/src/session.ts`: `buildWakeStartedMessage`, `handleTaskNotification`, `WakeStarted` type.
- `tugdeck/src/lib/code-session-store/reducer.ts`: `handleWakeStarted`, `wakeTrigger` state, `waking` phase.
- `tugdeck/src/lib/code-session-store/frameToEvent.ts`: `turnKey` mint for the wake bracket.
- `tugdeck/src/lib/code-session-store/types.ts`: `WakeStartedEvent`, `WakeTrigger`.
- Drift test: `tugcode/src/__tests__/wake-sdk-drift.test.ts`.

**Manual repro:** Monitor / Bash runbg / Task runbg (idle wait) — wake turn paints.

#### Step 2: Slice 1b — Cohort B re-init detector {#step-2}

**Status:** Shipped (final fix in commit `bcc3e2b6`).

**Scope:** `handleWakeReInit` for the harness fire signal (`system/init` between turns).

**Files:**
- `tugcode/src/session.ts`: `sessionInitSeen` field, re-init detector branch in `handleClaudeLine`, `handleWakeReInit` method.
- `tugcode/src/__tests__/wake-reinit.test.ts` (6 cases).

**Manual repro:** ScheduleWakeup 60s / CronCreate one-shot / CronCreate recurring + CronDelete — all paint correctly (verified in sessions 95d18839, 017f1206, 5f5af4de; Monitor regression in 2cad794c).

#### Step 3: Slice 1c-a — transcript single-row for wake turns {#step-3}

**Status:** Shipped (commit `19c8cb58`).

**Scope:** `TideTranscriptDataSource` per-snapshot offset table; `isWakeTurn` / `isWakeInflight` helpers; `userRowIndexForTurn` returns `-1` for wake turns.

**Files:**
- `tugdeck/src/lib/tide-transcript-data-source.ts`
- `tugdeck/src/lib/__tests__/tide-transcript-data-source.test.ts` (8 new wake-row cases).
- `tugdeck/src/components/tugways/cards/tide-card-telemetry-popovers.tsx` (one consumer updated for `-1` sentinel).

**Manual repro:** wake fires without phantom "You" bubble.

#### Step 4: Robustness — wire-shape drift test + resume-mode verification {#step-4}

**Status:** Drift test shipped (10 cases). Resume-mode probe shipped; **empirical finding: scheduled wakes do not fire after resume in stream-json spawn mode** — an upstream Claude Code limitation, NOT a tugcode bug. Documented in `roadmap/archive/wake-investigation-findings.md`.

**Artifacts:**

1. **Drift test for the Cohort B re-init pattern (SHIPPED).** `tugcode/src/__tests__/wake-reinit-drift.test.ts` loads `tugcode/probes/wake-investigation/capture-sw-60-*.stdout` and `capture-cron-1m-*.stdout` and asserts five invariants per capture:
   - exactly two `system/init` events (spawn + wake fire),
   - the first turn closes with `result/success` before the wake fires,
   - the second `system/init` is followed by the wake's `message_start`,
   - no `system/task_notification` precedes the wake (rules out Cohort A misclassification),
   - the wake turn closes with its own `result/success`.

   A future Claude Code release that changes any of these invariants fails the test loudly with a fixture-diff message instead of silently breaking Cohort B in production.

2. **Resume-mode probe (SHIPPED, finding documented).** `tugcode/probes/wake-investigation/probe-resume.mjs` spawns tugcode in new mode, schedules a ScheduleWakeup, kills tugcode, respawns in `--session-mode resume`, holds 150s past the scheduled fire time, and reports a PASS / FAIL verdict.

   **Empirical result: FAIL.** In `--input-format stream-json --output-format stream-json --resume <id>` mode, claude restores the scheduled task's metadata (it can describe what's pending when asked) but the in-process scheduler does NOT actually fire restored tasks. No `system/init` re-emit, no synthetic user_message, no assistant turn — the wake simply never lands. The official scheduled-tasks docs claim `--resume` restores unexpired tasks; that does not appear to hold in our spawn configuration. Documented in detail in [`archive/wake-investigation-findings.md`](./archive/wake-investigation-findings.md).

   **Why this is not a tugcode bug:** the detector handles the fire signal correctly; the fire just doesn't arrive. If a future Claude Code release restarts the scheduler in this mode, the probe will PASS without tugcode code changes.

   **User-visible implication:** if a Tide session is closed before a scheduled wake fires and the user then reopens the session via the resume path, the wake will NOT fire. Sessions that stay open continuously are unaffected (Probes 1-4 confirmed live).

**Checkpoint:**
- `cd tugcode && bun x tsc --noEmit && bun test` green (463 tests).
- Resume-mode probe `bun probe-resume.mjs` runs end-to-end; current VERDICT line is `FAIL` for the reason above. If/when upstream changes, the same probe will surface a `PASS`.

**Resolution / scope decision (2026-05-25):** in-session reliability is the gating success criterion; cross-restart wake delivery is not. The resume-mode failure is corroborated by the broader pattern of scheduled-task reliability bugs filed against Claude Code (see [#40228](https://github.com/anthropics/claude-code/issues/40228) durable flag, [#44128](https://github.com/anthropics/claude-code/issues/44128) tasks don't fire when desktop closed, [#36131](https://github.com/anthropics/claude-code/issues/36131) tasks need active focus, [#56194](https://github.com/anthropics/claude-code/issues/56194) feature request for app-independent scheduling). All four of those issues are open and unaddressed upstream; our case fits the same pattern. The findings doc is moved to [`archive/`](./archive/wake-investigation-findings.md) to keep the active plan focused on shipped capability. Slice 1 closes; the resume-mode failure stands as a known upstream limitation that the existing detector will pick up automatically if/when Anthropic ships a fix.

#### Step 5: Slice 1c-b — full sequence substrate {#step-5}

**Status:** Not started.

**Scope:** Lift the turn model to a sequence substrate end-to-end per [D07]. Reducer state, streaming PropertyStore paths, snapshot, data source, and every consumer model a turn as an ordered sequence of typed Messages. Message is the unit of identity, mutation, streaming subscription, and rendering. Paired-field aggregation and parallel `toolCallMap` storage retire. The [D06] wake sentinel is removed at every site.

This is **not** a boundary-translation refactor. The substrate believes in the sequence; consumers don't have to maintain a fiction.

**Architectural decisions locked in [D07]:**

- Message union: `user_message | assistant_text | assistant_thinking | system_note | tool_use`.
- `messageKey` derivation: `${turnKey}-m${seq}` with `seq` monotonic per turn — debuggable, intrinsically unique.
- `TideTranscriptCellKind` extends to narrow per-kind values (`user | code | thinking | system-note | tool | ghost`) — one renderer per kind, no internal dispatch (matches [L26]'s renderer-reference axis: one stable lambda per kind).
- `ToolCallState` retires onto `ToolUseMessage`.
- `state.pendingUserMessage` and `snapshot.inflightUserMessage` replaced by `state.pendingTurn` and `snapshot.activeTurn`.

**Open contracts to verify against captured wire fixtures BEFORE locking handler code:**

1. Does the stream-json wire emit any signal that distinguishes "continuation of the prior text block" from "new text block separated by a tool call" beyond the bare event ordering? Candidates: `message_start` / `content_block_start` / similar.
2. Do `thinking_text` and `assistant_text` events ever interleave mid-block, or are thinking blocks always discrete from assistant blocks?

The append-or-mutate rule's heuristic ("trailing-Message-kind match") is correct under both questions resolving to "no special signal — bare ordering is enough." If either resolves otherwise, the rule keys on the wire signal instead. Verification probe: parse `tugcode/probes/wake-investigation/capture-*.stdout` for `assistant_text` + `thinking_text` + `tool_use` event sequences and classify the inter-event signals.

**Files (production):**

- `tugdeck/src/lib/code-session-store/types.ts` — Message union, ScratchEntry, PendingTurn, ActiveTurnSnapshot, TurnEntry reshape. `ToolCallState` deleted; `inflightUserMessage` deleted; `userMessage` / `thinking` / `assistant` / `toolCalls` deleted from TurnEntry.
- `tugdeck/src/lib/code-session-store/events.ts` — review event shapes for any field renames the reducer-side change implies.
- `tugdeck/src/lib/code-session-store/effects.ts` — `write-inflight` effect kind carries `messageKey` and `channel: "text" | "state"`.
- `tugdeck/src/lib/code-session-store/reducer.ts` — substrate change (see [D07] handler-by-handler table). Bulk of the work.
- `tugdeck/src/lib/code-session-store/code-session-store.ts` (or wherever the snapshot builder lives) — derive `activeTurn` from `pendingTurn` + scratch.
- `tugdeck/src/lib/tide-transcript-data-source.ts` — per-Message iteration; delete `isWakeTurn` / `isWakeInflight` / `RowLayout` / `buildRowLayout` / `userRowIndexForTurn` / `assistantRowIndexForTurn` / `locateCommittedRow`; introduce `MessageLayout` + `messageRowIndex`.
- `tugdeck/src/components/tugways/cards/tide-card-transcript.tsx` — cell renderers per Message kind; per-Message streaming subscription paths.
- `tugdeck/src/components/tugways/cards/turn-entry-markdown.ts` — iterate messages filtering `assistant_text`.
- `tugdeck/src/components/tugways/cards/tide-card-telemetry-popovers.tsx` — read first `user_message` Message text.
- `tugdeck/src/components/tugways/chrome/tide-thinking-block.tsx` — read `assistant_thinking` Message text.

**Files (tests — net coverage preserved, shape updated):**

- `tugdeck/src/lib/code-session-store/__tests__/*` — ~30 reducer tests. Most diffs are mechanical: `expect(state.scratch.get(msgId)?.assistant).toBe(...)` → `expect(findTrailingMessage(state.scratch.get(msgId)!, "assistant_text")?.text).toBe(...)`. Build a small test helper module (`__tests__/_helpers/messages.ts`) for "find Message of kind", "construct fixture TurnEntry with messages", etc.
- `tugdeck/src/lib/__tests__/tide-transcript-data-source.test.ts` — substantial rewrite. The variable-rows-per-turn invariants the current tests pin are replaced by per-Message row counts. New invariants: a turn with N Messages produces N rows; the message-kind narrows the cell renderer.
- `tugdeck/src/__tests__/session-wake-fixture-replay.test.ts` — fixture-replay test. The captured fixtures don't change; the assertions about shape do.
- `tugdeck/src/__tests__/assistant-rendering-fixture-replay.test.ts` — same.
- `tugdeck/src/components/tugways/cards/__tests__/tide-card-transcript-tool-calls.test.ts` — tool-call rendering test; shape updates.
- New test: `tugdeck/src/lib/code-session-store/__tests__/reducer.message-sequence.test.ts` — pin the append-or-mutate rule against fixture event sequences (the regression net for Risk #2).

**Commit sequence (single landing commit):**

The dependencies between types, reducer state, handlers, streaming paths, data source, consumers, and tests are tight enough that dual-rep migration carries more risk (drift between reps) than a clean cutover. Working-tree process:

1. **Probe the wire** to resolve the two open contracts. Update [D07]'s append-or-mutate rule if the wire provides a stronger signal.
2. **Draft `types.ts`** changes locally; tsc reveals the consumer-error set.
3. **Rewrite reducer** state shape + handlers. Reducer tests fail in expected places only (no regressions in unrelated handlers).
4. **Rewrite snapshot builder** (`activeTurn` derivation).
5. **Rewrite data source.** Data-source tests fail in expected places.
6. **Rewrite consumers** (5 files).
7. **Update all failing tests** in one pass.
8. `cd tugdeck && bun x tsc --noEmit && bun test` green.
9. One commit on main.

If the cutover ends up too large to review comfortably, split by file at commit time using `git add -p` — but the working tree is always green at the commit boundary.

**Manual repro:**

- A normal user → assistant turn renders two rows (user_message + assistant_text).
- A turn where claude says text, calls a tool, then says more text commits as three rows in order — distinct from today's "all text squashed into one row above the tool log."
- A turn with interleaved thinking renders the thinking block in its arrival position relative to assistant text.
- A wake turn renders one row (assistant_text only; no empty-text sentinel anywhere).
- Replay of a recorded session produces identical row output to pre-Step-5 for simple turns; multi-block / interleaved turns now render with preserved ordering.
- `grep -rE "isWakeTurn|isWakeInflight|userRowIndexForTurn|assistantRowIndexForTurn|inflightUserMessage|\\.toolCallMap|\\bpendingUserMessage\\b" tugdeck/src` returns nothing (or only deletion-marker comments awaiting a follow-up cleanup commit).
- `grep -rE "TurnEntry\\.userMessage|TurnEntry\\.assistant\\b|TurnEntry\\.thinking|TurnEntry\\.toolCalls" tugdeck/src` returns nothing.

**Checkpoint:**

- `cd tugdeck && bun x tsc --noEmit && bun test` green; full reducer + data source + fixture-replay suites pass.
- Manual sweep: send a normal turn; send a turn that triggers a tool call mid-stream; trigger a wake (any Cohort A or B); verify all render correctly in HMR.
- The new fixture-replay test for multi-block / interleaved ordering passes against a captured trace.

#### Step 6: Slice 2 — trigger-aware chrome (resolves [Q02]) {#step-6}

**Status:** Not started.

**Scope:** Resolves [Q02]. Render a chip above each wake turn identifying its trigger kind per [D09]. Cohort A reads existing `wakeTrigger.summary` / `task_id`. Cohort B reads new fields populated via the per-session FIFO per [D08]. The chip is visual; the detail panel is on-demand (click to expand).

**Files:**

- `tugcode/src/session.ts` — `pendingWakeTriggers` FIFO populated at `ScheduleWakeup` / `CronCreate` tool_use observation time; drained by `handleWakeReInit`. Recurring crons re-use the FIFO entry keyed by `cron_id` until `CronDelete` evicts it.
- `tugcode/src/__tests__/wake-trigger-correlation.test.ts` — FIFO drain semantics; recurring-cron payload reuse; CronDelete eviction; misattribution edge case ([D08]).
- `tugdeck/src/lib/code-session-store/types.ts` — `WakeTrigger` extended with `kind`, `prompt?`, `scheduled_for?`, `cron_expression?`, `cron_id?`.
- `tugdeck/src/lib/code-session-store/reducer.ts` — propagate extended fields onto `TurnEntry.wakeTrigger` at `handleWakeStarted`.
- `tugdeck/src/components/tugways/transcript/transcript-chrome.tsx` (new) — chip renderer with click-to-expand detail panel per [D09].
- `tugdeck/src/components/tugways/cards/tide-card-transcript.tsx` — render chrome chip above wake-turn assistant text within the existing code-row renderer.
- `tugdeck/src/lib/tide-transcript-data-source.ts` — emit `{ kind: "chrome", trigger }` row before the first message row of any wake turn.

**Manual repro:**

- ScheduleWakeup 60s → wake turn paints with a "Scheduled" chip; click expands to show fire time and delay.
- CronCreate `*/2 * * * *` → each fire paints with a "Cron" chip showing the expression.
- Monitor 5s → wake turn paints with a "Monitor" chip showing summary.
- Two ScheduleWakeup tasks registered in quick succession → first fire's chip shows the first prompt, second fire's chip shows the second (FIFO order).

**Checkpoint:** `cd tugcode && bun x tsc --noEmit && bun test` green; `cd tugdeck && bun x tsc --noEmit && bun test` green; rebuild tugcode binary; manual repro pass.

#### Step 7: Slice 2 — replay-translator metadata persistence {#step-7}

**Status:** Not started.

**Scope:** Cold-boot rehydration paints Step 6's chrome with the original trigger metadata. Tugcode persists wake-trigger metadata to a sidecar JSONL per [D10]; the replay translator joins on `turn_index` and synthesizes `WakeStartedEvent`s inline within the replay bracket. No `wake_complete` synthesis needed — the replayed `turn_complete` closes it.

**Files:**

- `tugcode/src/wake-trigger-sidecar.ts` (new) — append-only JSONL writer with `fsync` per record; reader that returns a `Map<turnIndex, WakeTriggerRecord>`. Tolerates a missing or partially-written file (returns an empty / partial map).
- `tugcode/src/__tests__/wake-trigger-sidecar.test.ts` — write + concurrent-read invariants; partial-write tolerance; missing-file degradation.
- `tugcode/src/session.ts` — append a sidecar record on every wake bracket emission (both cohorts), tagged with the upcoming turn_index.
- `tugcode/src/replay.ts` (or wherever session rehydration loads claude's JSONL) — load the sidecar at rehydration time; pass the index to the translator.
- `tugdeck/src/lib/code-session-store/replay/replay-translator.ts` — accept the `wakeTriggers` index; at each turn boundary matching a record, inject a synthesized `WakeStartedEvent` before the assistant_text events.
- `tugdeck/src/lib/code-session-store/replay/__tests__/replay-wake.test.ts` (new) — replay rehydration with sidecar produces wake-turn chrome equivalent to live; orphan sidecar entries (no matching turn_index) skipped with warn.

**Manual repro:**

- Live: start session, ScheduleWakeup 60s, observe Step 6's chip.
- Close Tide. Reopen via session-history (read-only replay path; in-process resume is blocked by Step 4's upstream limitation).
- Rehydrated wake turn paints with the same chip and detail panel.
- Delete sidecar file; rehydration succeeds; wake turn paints without chrome (graceful degradation).

**Checkpoint:** `cd tugcode && bun x tsc --noEmit && bun test` green; `cd tugdeck && bun x tsc --noEmit && bun test` green; rebuild tugcode binary; manual repro pass including the degradation case.

#### Step 8: Slice 2 — system-note rendering for the scheduled prompt {#step-8}

**Status:** Not started.

**Scope:** Render the registered scheduled prompt as a `system_note` Message inside the wake turn, above the assistant's response. Cohort B only. Realizes [D11]. Requires Step 5 (sequence model) and Step 6 (Cohort B FIFO; the prompt is already captured there).

**Files:**

- `tugcode/src/session.ts` — Step 6's FIFO entry captures the prompt at tool_use time; Step 8 emits it on the wake bracket via `wake_started.wake_trigger.prompt`.
- `tugdeck/src/lib/code-session-store/reducer.ts` — at `handleWakeStarted`, if `wakeTrigger.prompt` is present, append `{ kind: "system_note", text: prompt, source: "scheduled" }` to the wake turn's `messages` array ahead of any assistant_text.
- `tugdeck/src/components/tugways/transcript/system-note-row.tsx` (new) — subdued row: muted background, monospace prompt text, "scheduled" prefix label.
- `tugdeck/src/lib/tide-transcript-data-source.ts` — emit `{ kind: "systemNote", source }` row for `system_note` Messages.
- Tests: reducer test for the system-note appending; transcript-data-source test for the row emission; replay round-trip via Step 7's sidecar.

**Manual repro:**

- ScheduleWakeup 60s with prompt "list any commits I made today" → wake turn renders the prompt as a subdued note above the assistant's actual response.
- CronCreate with multi-line prompt → multi-line preserved.
- Cohort A wake (Monitor) → no system_note row (no synthetic prompt).
- After Step 7's sidecar lands, reopened session shows the same system_note on the rehydrated wake turn.

**Checkpoint:** `cd tugcode && bun x tsc --noEmit && bun test` green; `cd tugdeck && bun x tsc --noEmit && bun test` green; rebuild tugcode binary; manual repro pass.

#### Step 9: Tide-side cancellation of scheduled tasks {#step-9}

**Status:** Not started.

**Scope:** UI affordance to cancel a recurring scheduled task without typing into chat. Right-click the "Cron" chip from Step 6 → "Cancel" → routes a hidden CronDelete request through the user_message back-channel per [D12]. `ScheduleWakeup` has no cancellation surface — no upstream `WakeDelete` tool exists; one-shot wakes can't be cancelled.

**Files:**

- `tugdeck/src/components/tugways/transcript/transcript-chrome.tsx` — context menu with "Cancel" item; visible only when `WakeTrigger.kind === "cron_create"`.
- `tugdeck/src/lib/code-session-store/store.ts` — `cancelScheduledTask(cron_id)` action that dispatches the IPC frame.
- `tugdeck/src/lib/tugcast/messages.ts` — outbound IPC frame type `CancelScheduledTaskFrame { type: "cancel_scheduled_task"; session_id; cron_id; ipc_version: 2 }`.
- `tugcode/src/session.ts` — `handleCancelScheduledTask` IPC handler; inject a hidden user_message ("/cancel cron `<id>`") into claude's stdin; flag the resulting turn for suppression at the tugcode boundary (no `submit_accepted` emitted; subsequent `assistant_text` / `turn_complete` IPC frames for that turn dropped).
- `tugcode/src/__tests__/cancellation.test.ts` — end-to-end: IPC frame → hidden user_message injection → suppression of resulting turn frames; chip-vanish state derives from suppressed CronDelete result.

**Known limitation:** claude's brief acknowledgment of the cancellation may flash in the transcript before the suppression filter takes effect. Mitigation: prompt-engineer the synthetic message to request an empty reply; failing that, accept the flash as polish work for a later pass.

**Manual repro:**

- `CronCreate "* * * * *"` registers; wait for first fire; chip paints.
- Right-click chip → "Cancel" → chip vanishes; no further fires over a 3-minute hold.
- Direct CronDelete via chat still works (the two cancellation paths are independent and don't interfere).
- `ScheduleWakeup` chip context menu has no Cancel item (verified visually).

**Checkpoint:** `cd tugcode && bun x tsc --noEmit && bun test` green; `cd tugdeck && bun x tsc --noEmit && bun test` green; rebuild tugcode binary; manual repro pass.
