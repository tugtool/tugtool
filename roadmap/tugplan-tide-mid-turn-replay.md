<!-- tugplan-skeleton v2 -->

## Tide Transcript — Mid-turn Replay (Investigation + Design) {#tide-mid-turn-replay}

**Purpose:** Make the mid-turn reload case work *robustly*. After a user reloads (HMR, Cmd-R, cold-boot) while a turn is in flight, the Tide card should fetch the conversation history and connect to the live continuation of the in-flight turn — without losing a single event in any race or drop window. Today this case is broken; one prior design attempt was reverted because it was built on speculation rather than observation. This plan opens with an automated investigation phase, then designs from observed reality.

**Design goal stated by the user:**

> "The front end is not doing much work. The reducer's existing msg_id-keyed accumulation handles everything. Claude Code keeps ticking. Tugcast keeps ticking. The card just observes."

> "We must NEVER drop a message on the floor — one way or another."

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | Phase 0 complete (verdicts captured, drop audit done); Phase 1 design ready to author |
| Target branch | tugplan-tide-mid-turn-replay |
| Last updated | 2026-05-04 |
| Roadmap anchor | [tugplan-tide-transcript-resume.md #phase-a-r3](./tugplan-tide-transcript-resume.md#phase-a-r3) — extracted from there after one reverted attempt |
| Predecessors | [tugplan-tide-transcript-resume.md](./tugplan-tide-transcript-resume.md) (closed 2026-05-04, except the mid-turn case extracted here). The infrastructure this plan builds on — the request_replay verb, the active drain, the supervisor's Spawning-window queue, the JSONL translator — is all in place |
| Successors | TBD — depends on what the investigation finds |
| Related | [tugplan-tide-transcript-followon.md](./tugplan-tide-transcript-followon.md) — adapter polish, independent of this work |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Three smokes for the resume work shipped: HMR reload (A), Developer > Reload (B), and cold boot (C). The fourth, **Smoke D — mid-turn reload**, did not. A user who reloads while claude is mid-stream sees one of two failure modes today:

- **Pre-α** (the state at the start of this plan): the in-flight turn appears as `result: "interrupted"` in the transcript even though claude is still streaming the reply, and the actual completion lands in the JSONL on disk and never reaches the screen.
- **α (reverted)**: the card got stuck on the existing "Loading conversation" spinner for ~12s (the new `replay_deferred` placeholder lost the precedence chain), then rendered an empty assistant response (the JSONL flush race left the assistant entry unwritten when replay read it).

The α attempt was an architectural commitment built on speculation. Six pitfalls deep into the plan, none of which were verified against the actual wire, the design landed broken in two distinct ways. That post-mortem produced this plan's framing: **investigate first, design second.**

The fundamental architectural finding from the post-mortem:

> Live and replay use *different* `msg_id` schemes for the same logical turn. Live events carry tugcode's `crypto.randomUUID()` (minted by `newMsgId()` when `handleUserMessage` installs an `ActiveTurn`). Replay events carry claude's `message.id` (read from the JSONL file). Same logical turn, two different keys. Every "merge replay with live" design (D-1, D-2, α) had to bolt on reconciliation, and that's where the pitfalls came from.

The user's framing for the fix uses the architectural inversion: the card just fetches history, then naturally connects to whatever live stream is in progress. That works if and only if live and replay agree on the id. **Tugcode is the live id minter, and claude reveals its `message.id` on every stream event. Tugcode can use claude's id from the start.** Then the merge problem disappears: the reducer's existing msg_id-keyed accumulation stitches replay and live together with no special handling.

But before we commit to that design, three observable behaviors need to be confirmed. The investigation phase below pins each one.

#### Strategy {#strategy}

- **Investigate before designing.** Phase 0 captures observable behavior on the wire. No design is locked in until the questions are answered. The α attempt's failure was speculation outrunning observation; that mistake doesn't repeat.
- **Automate every experiment.** Phase 0 produces deterministic, repeatable evidence — Bash + tugcode test rigs + cargo tests, all runnable without human-in-the-loop reload-and-watch. The user is not a test monkey.
- **Durability before features.** "Never drop a message" is the hard requirement. Each layer that can drop a message gets characterized in the investigation; the design phase proves drops are impossible (or explicitly accepted with telemetry + recovery).
- **Build stays green at every commit.** `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run` pass on every step. Warnings are errors.

#### Success Criteria (Measurable) {#success-criteria}

The plan succeeds when **all** of the following hold:

- Smoke D (mid-turn reload) passes manual + automated verification: the card shows the prior turns, the in-flight turn appears with the user prompt visible, the assistant text streams in to completion, and the final TurnEntry commits cleanly with both halves of the turn on screen — no duplicate row, no empty response, no stuck spinner.
- The same scenario, captured as an automated regression test, produces a deterministic green outcome on every run.
- A "drop audit" verifies that no message can be silently lost between claude's stdout and the tugdeck reducer in the reload-mid-turn scenario. Any potential drop point either: (a) is provably unreachable, (b) is gated by a buffer / queue with bounded capacity and an explicit telemetry signal on overflow, or (c) is recovered via re-fetch (e.g. the request_replay verb gives card v2 a way to ask for the JSONL again if it suspects loss).
- HMR cycles during development become viable for dogfooding: a developer using tugtool to develop tugtool can reload mid-turn and continue working without losing context. ("We would never be able to use this tool to modify the tool, if you get my meaning." — user, 2026-05-04.)

#### Scope {#scope}

1. **Phase 0 — Investigation** ([#phase-0]). Three automated experiments + one drop audit. No production code changes; all output is structured trace data + a written report.
2. **Phase 1 — Design** ([#phase-1]). Pinned by Phase 0's findings. Lays out the architecture (most likely: claude-id canonicalization + minimal reducer change) and the wire-protocol changes needed.
3. **Phase 2+ — Implementation.** Detailed once Phase 1 lands.

Out of scope:

- Cross-machine session export / import.
- Imperative DOM cell pooling.
- The adapter polish items (separate plan).

---

### Resolved Questions / Design Decisions {#design-decisions}

This section will fill in as the investigation produces evidence and the design phase records its decisions. Initially empty.

#### [DM01] Phase 0 must run before any design commitment {#dm01-investigate-first}

**Decision:** No production code touching live/replay merge ships before Phase 0 ([#phase-0]) lands its three reports + the drop audit. The α attempt's failure mode — "design committed to its premise before observing the system" — does not repeat.

**Rationale:**

- The post-mortem of α showed that two of the three failure modes (`replayPreflightActive` precedence, JSONL flush race) were observable from telemetry but were not observed before code shipped.
- The msg_id mismatch was named in the plan's pitfalls section but the resolution was bolted-on machinery instead of a structural fix.
- "Investigate first" is the discipline that worked in [Phase A-R0](./tugplan-tide-transcript-resume.md#phase-a-r0) of the resume saga (cold-boot diagnosis via telemetry capture before the realpath fix). The same discipline applies here.

#### [DM02] The investigation is automated {#dm02-automated-investigation}

**Decision:** Every Phase 0 experiment runs without a human reloading a browser, clicking a button, or watching for a banner. Each experiment is a script (`bun test`, `cargo nextest`, or a Bash harness) that produces a verdict — `PASS` / `FAIL` / structured timing data — readable by code.

**Rationale:**

- Manual smokes are slow (one cycle per minute under good conditions) and non-repeatable (timing varies; the question often hinges on microsecond-scale ordering).
- Automation pins the scenario so a regression in any layer breaks a CI test, not a vibe.
- The user's stated requirement: "I don't want to be a test monkey" (2026-05-04).

---

### Phase 0 — Investigation {#phase-0}

**Goal.** Answer four observable questions before any production code changes:

1. [E1] **JSONL flush timing.** When claude emits the `result` event on stdout for a turn, has it already flushed the final assistant entry to the JSONL file?
2. [E2] **Live/replay ordering.** When `runReplay` runs while claude is still streaming for the same in-flight turn, in what order do replay events and live events arrive at tugdeck? Are they consistent? Are they reconcilable?
3. [E3] **Tugcast subscriber buffering.** When a WebSocket client disconnects and reconnects, what events does the new connection see? Are events emitted during the disconnect window delivered, dropped, or replayed?
4. [E4] **Drop audit.** Across the full path (claude stdout → tugcode → tugcast → tugdeck reducer), where can a message be silently lost? Each potential drop point must be characterized: under what conditions does it drop, and what's the recovery story?

Each experiment produces:

- A runnable script / test file, committed to the repo
- A structured trace output (JSON or human-readable text)
- A written verdict (a paragraph in this plan, post-experiment)

The verdicts together form the input to [Phase 1 — Design](#phase-1).

#### Experiment E1 — JSONL flush timing {#e1-jsonl-flush-timing}

**Question.** When claude (the binary at `/Users/kocienda/.local/bin/claude`, version 2.1.128) emits a `result` event on stdout in stream-json mode, has it already flushed the final assistant entry (the one with `stop_reason: end_turn`) to the JSONL file at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`?

**Why it matters.** If `result` arrives BEFORE the JSONL flush, then `await activeTurn.completion` resolves before JSONL has the data. Any "wait for completion then read JSONL" design ([α](#)) hits an empty/partial JSONL and emits an incomplete turn. This was the "empty assistant response" failure mode in the reverted α attempt.

**Hypothesis.** Two possibilities, only one of which is true:

- **H1a (race exists).** Claude emits `result` to stdout asynchronously vs. the JSONL write. Tugcode reading JSONL right after `result` may see partial state. Implication: any mid-turn replay design must NOT rely on JSONL being current at the moment `result` arrives. Either wait extra (timing-fragile), poll JSONL until stable (timing-fragile), or use tugcode's own ActiveTurn state instead of JSONL for the in-flight turn.
- **H1b (no race).** Claude flushes JSONL atomically before emitting `result`. The two are sequenced. Tugcode reading JSONL right after `result` always sees the complete turn. Implication: a "wait for completion then read JSONL" design is sound; α's empty-response failure must have come from somewhere else.

**Harness design.** A standalone Bash script that:

1. Spawns `claude --print --output-format stream-json --include-partial-messages` with a deterministic prompt (e.g. `"reply with exactly the string FOO and nothing else"`).
2. Captures stdout line-by-line with monotonic timestamps.
3. Polls the corresponding JSONL file (path computed from `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`) at high frequency, recording the file's modification time and size at every poll.
4. After the turn completes, computes:
   - `t_result_stdout` — wall-clock when `{"type":"result"}` appeared on stdout
   - `t_jsonl_complete` — wall-clock when the JSONL contained the final assistant entry with `stop_reason: end_turn`
5. Reports `t_jsonl_complete - t_result_stdout` (positive = race exists; negative or zero = no race).

**Implementation location.** New file: `tugcode/scripts/investigate-jsonl-flush-timing.sh` (or `.ts` if Bun's better-suited).

**Verdict format.** Single-paragraph summary in this plan section, plus the captured trace as an appendix file under `roadmap/tugplan-tide-mid-turn-replay-traces/e1-jsonl-flush-timing.json`.

**How I run it.** `bash tugcode/scripts/investigate-jsonl-flush-timing.sh > traces/e1-trace.json && bun run scripts/analyze-e1.ts < traces/e1-trace.json`. No human in the loop; result is `PASS` (race characterized + verdict known) or `FAIL` (claude unavailable or unexpected output shape; needs investigation before retry).

**Verdict — H1a confirmed (race exists).**

Across 10 runs of the deterministic prompt `"reply with exactly the string FOO and nothing else"` against `claude --output-format stream-json --input-format stream-json --include-partial-messages --replay-user-messages` on this machine (claude 2.1.128), the JSONL's first `assistant` entry with a non-null `stop_reason` always landed **after** the `result` event arrived on stdout. Stats:

| Metric | Value |
|-|-|
| Runs | 10 / 10 with positive offset |
| Min `t_jsonl_complete - t_result_stdout` | **2 ms** |
| Max | **6 ms** |
| Mean | **4.2 ms** |
| Median | 4 ms |
| Stddev | 1.66 ms |

Raw deltas (sorted, ms): `[2, 2, 3, 3, 3, 5, 6, 6, 6, 6]`. Trace files: `roadmap/tugplan-tide-mid-turn-replay-traces/e1-batch-run-{01..10}.json`. Aggregate: `roadmap/tugplan-tide-mid-turn-replay-traces/e1-batch-summary.json`.

**Implication for design (load-bearing):**

A "wait for `result` on stdout, then read JSONL" design (the abandoned α) is unsound in principle — the JSONL is consistently incomplete at the moment of `result`. Even small budgets like 2ms would have to handle the long tail. The empty-assistant-response failure mode in the reverted α was likely this race surfacing under load. **The right answer is to not depend on JSONL for the in-flight turn at all** — tugcode has the in-flight turn's content in its own `ActiveTurn.partialText` (and elsewhere in the per-turn drain state) before `result` arrives, so the in-flight turn can be reconstructed from tugcode's own state. JSONL remains the source of truth for *committed* turns where the race is irrelevant (claude's previous-turn assistant entry has been on disk for seconds before reload).

#### Experiment E2 — Live/replay ordering during the replay window {#e2-live-replay-ordering}

**Question.** While `runReplay` is iterating its translator output and emitting replay events on tugcode's stdout, the drain task is also forwarding live stream events from claude. In what order do these two streams interleave on the wire? Is the ordering deterministic? Can the reducer reconstruct the correct accumulated state regardless of order?

**Why it matters.** With α we tried to suppress live events during the replay window. The simpler design (claude-id canonicalization) makes that unnecessary IF the reducer's existing accumulation is order-tolerant. We need to characterize the actual interleaving and test the reducer against it.

**Hypothesis.** Three possibilities:

- **H2a (no overlap).** When `runReplay` is dispatching, the drain has nothing to forward (claude is silent during JSONL read). Replay events flow in a clean block, then live picks up. The reducer's existing handlers are sufficient.
- **H2b (overlap with same id, accumulation safe).** Replay and live events for the same in-flight turn interleave on the wire, but both use the same `msg_id` (claude's `message.id`) and the reducer's text accumulation is idempotent or replace-on-final. The reducer commits the right TurnEntry regardless of order.
- **H2c (overlap with same id, accumulation unsafe).** Replay and live events for the same in-flight turn interleave, but the reducer's `is_partial: true` (append) vs. `is_partial: false` (replace) logic produces different text depending on order. The reducer needs ordering guarantees, OR the wire needs a serialization point.

**Harness design.** A new tugcode test file: `tugcode/src/__tests__/replay-spawn-mid-turn.test.ts`. The test:

1. Builds a `SessionManager` in resume mode with a JSONL fixture containing N committed turns + a trailing in-flight turn (assistant entry with `stop_reason: null`).
2. Mocks claude's stdout with a controllable `ReadableStream` so the test scripts byte-by-byte timing of stream events.
3. Drives the scenario:
   - Install an `ActiveTurn` (simulating handleUserMessage).
   - Start drain forwarding live events at a controllable rate.
   - Concurrently invoke `runReplay()`.
   - Capture every `writeLine` call to mocked `Bun.stdout` with monotonic seq.
4. Asserts the captured wire output: do replay events and live events interleave? In what pattern? Are they reconcilable by the reducer?
5. Replays the captured wire into a fresh `CodeSessionStore` instance and asserts the resulting `transcript` matches the expected committed turns + the in-flight turn's full content.

**Implementation location.** `tugcode/src/__tests__/replay-spawn-mid-turn.test.ts`.

**How I run it.** `cd tugcode && bun test src/__tests__/replay-spawn-mid-turn.test.ts`. Output is the standard bun-test pass/fail with descriptions.

**Verdict format.** Single-paragraph summary + the test file's assertions become the documented contract.

**Verdict — H2c confirmed: msg_id divergence visible on the wire.**

The interleaved-test wire trace (full output preserved in test stdout; rerunnable):

```
type=session_init
type=assistant_text msg_id=1d1ab81a-...     ← LIVE event (tugcode UUID)
type=replay_started
type=system_metadata
type=user_message_replay msg_id=msg_committed_1
type=assistant_text       msg_id=msg_committed_1
type=turn_complete        msg_id=msg_committed_1
type=user_message_replay msg_id=msg_inflight_claude_id_2  ← REPLAY trailing turn (claude's id)
type=assistant_text       msg_id=msg_inflight_claude_id_2
type=turn_complete        msg_id=msg_inflight_claude_id_2 ← orphan-synthesized per [D08]
type=replay_complete
type=assistant_text msg_id=1d1ab81a-...     ← LIVE event (tugcode UUID, AFTER replay)
```

Three load-bearing observations:

1. **Live and replay events DO interleave on the wire**, even within a single `runReplay` invocation. The first live `assistant_text` lands BEFORE `replay_started`, the second AFTER `replay_complete`. They straddle the bracket rather than being contained by it.

2. **The msg_id divergence is real and confirmed.** Replay events for the trailing in-flight turn use `msg_inflight_claude_id_2` (claude's `message.id` from JSONL). Live events use a tugcode UUID (`1d1ab81a-...`, minted by `newMsgId()` when `ActiveTurn` was installed). The reducer keys by `msg_id`; same logical turn, two keys → reducer treats them as two turns.

3. **Live events that land outside the replay bracket are silently dropped at the reducer.** Pre-`replay_started`, phase is `idle`; `handleAssistantText` drops in `idle`. Post-`replay_complete`, phase is back to `idle`; same drop. So today's wire-shape, even before any "merge" attempt, *loses* the live deltas at the reducer.

**Implication for design.** Three things must change before mid-turn replay can work:

- The msg_id divergence must be eliminated. Two options: (a) tugcode learns claude's `message.id` from the first stream event and uses it as canonical for live emits; (b) the translator emits the trailing in-flight turn's events with tugcode's UUID instead of claude's id. Either path makes the reducer's existing dedupe handle the merge. Option (a) is structurally cleaner (it's a one-time canonicalization at the source) and has the bonus of making live and replay reconcilable for any future feature that needs it. Option (b) is a smaller code change but only fixes the trailing-in-flight-turn case.
- The translator must NOT orphan-synthesize a `turn_complete{interrupted}` for the trailing turn when tugcode signals the turn is the live in-flight one. Otherwise we double-commit (one interrupted from replay, one completed later from live).
- The reducer must accept live events for the in-flight turn's `msg_id` even outside the active phase set. Either by extending the phase allowlist for the matching `activeMsgId`, or by ensuring the bracket cleanly contains the live events (which requires tugcode-side ordering control).

#### Experiment E3 — Tugcast subscriber buffering {#e3-tugcast-buffering}

**Question.** When a WebSocket client (tugdeck) disconnects from tugcast and a new client reconnects, what events does the new client see? Specifically: are events emitted by tugcast during the disconnect window (a) delivered to the reconnected client, (b) dropped, or (c) replayed on demand?

**Why it matters.** The reload-mid-turn scenario disconnects and reconnects the WebSocket. During the disconnect window (typically tens to hundreds of milliseconds), claude keeps streaming, tugcode keeps emitting, tugcast keeps receiving. If those events are dropped, card v2 sees a discontinuity. If they're buffered, card v2 catches up. If they're replayed via request_replay, the request_replay verb is the recovery story.

**Hypothesis.** Three possibilities:

- **H3a (drops by default).** Tugcast forwards events to active subscribers only. Disconnect drops the subscriber; events emitted during the gap go to /dev/null. Reconnect starts fresh. Implication: card v2 must rely entirely on JSONL replay + live forwarding from the reconnect point to reconstruct.
- **H3b (per-session buffering).** Tugcast holds a per-session ring buffer (or unbounded buffer) of recent events; on reconnect, the new client receives a replay of the buffer. Implication: card v2 might see duplicates of events that JSONL replay also covers.
- **H3c (something else — needs investigation).** A different mechanism (subscriber-resumption tokens, durable streams, etc.) is in play.

**Harness design.** A Rust test in `tugrust/crates/tugcast/tests/`. The test:

1. Spawns the tugcast supervisor in-process (or via a controllable harness — check what `tests/` directory in tugcast offers today).
2. Establishes a WS client connection, subscribes to a session.
3. Drives a tugcode subprocess (or a stub that emits scripted events) producing a sequence of CODE_OUTPUT frames at known timestamps.
4. Disconnects the WS client mid-stream.
5. Lets the supervisor receive N more events while the client is offline.
6. Reconnects a new WS client (or re-subscribes the same client) and observes what's delivered.
7. Asserts the observed delivery pattern against H3a / H3b / H3c.

**Alternative path.** If standing up a real tugcast in a test is too heavy, instrument the existing supervisor + subscriber code paths with telemetry; capture a real run via `just dev-tugcast` and a programmatic WS client; analyze the resulting trace.

**Implementation location.** TBD — depends on what tugcast's existing test infrastructure supports. Investigation step #1 is to read the tugcast `tests/` directory + `feeds/agent_supervisor.rs` and pick the right integration point.

**How I run it.** `cd tugrust && cargo nextest run -p tugcast --tests` (after the test is written).

**Verdict — H3a confirmed: tugcast drops disconnect-window frames for fresh subscribers.**

Three sub-tests in `tugrust/crates/tugcast/tests/e3_subscriber_buffering.rs` (all passing):

- `e3_fresh_subscriber_sees_only_post_subscribe_frames`: a `broadcast::Sender` with capacity 1024 (mirroring `CODE_BROADCAST_CAPACITY`). Pre-subscribe sends are not delivered to a later subscriber; only post-subscribe sends arrive.
- `e3_disconnect_then_reconnect_loses_disconnect_window_frames`: card v1 subscribes, drains 3 frames, drops the receiver. Frames 4-8 are sent during the disconnect. Card v2 subscribes anew and sees only frames 9-11. Frames 4-8 are silently dropped from card v2's perspective.
- `e3_lag_recovery_is_for_existing_subscribers_only`: tokio's `broadcast` surfaces `RecvError::Lagged(N)` to an existing slow subscriber. The router's `LagPolicy::Replay` reacts to that signal by replaying from the shared `ReplayBuffer` (1000 frames). This path is for *existing* slow subscribers — it does NOT help a *new* subscriber catching up after disconnect-then-reconnect.

**Architectural facts confirmed by code reading:**

- `feeds/code.rs::CODE_BROADCAST_CAPACITY = 1024`.
- `main.rs:313` wires `code_replay = ReplayBuffer::new(1000)` and `LagPolicy::Replay(code_replay)` for `FeedId::CODE_OUTPUT`.
- `router.rs:402` calls `tx.subscribe()` per fresh client → fresh `broadcast::Receiver`. No catchup mechanism on connect.

**Implication for mid-turn reload.** Any CODE_OUTPUT events emitted while the WebSocket was between card v1 and card v2 are **lost** at the broadcast layer for card v2. Recovery has exactly two sources:

1. **JSONL** — reliable for *committed* turns (modulo E1's small flush race for the most recent one).
2. **Live wire from card v2's connect time forward** — reliable while v2 is connected.

Neither source alone covers the disconnect-window in-flight turn. The combination requires that **tugcode emit the in-flight turn's content from its own `ActiveTurn` state** when card v2 sends `request_replay`, then continue forwarding live events. JSONL alone won't work (E1's race plus the delete window for events emitted after v1 disconnected but before reaching JSONL flush).

#### Experiment E4 — Drop audit {#e4-drop-audit}

**Question.** Across the full path (claude stdout → tugcode → tugcast → tugdeck reducer), where can a message be silently lost? For each potential drop point: what causes the drop, what's the recovery story, and what telemetry signals the drop?

**Why it matters.** The user's hard requirement: "We must NEVER drop a message on the floor — one way or another." This experiment maps the surface area before we design the durability story.

**Approach.** No automated harness — this is a structural code audit. Output is a written table.

For each layer, list:
- The buffer / queue / channel
- Its capacity
- The behavior on overflow (block, drop, error)
- The telemetry signal (lifecycle log, error frame) on overflow or close
- The recovery path (re-fetch via request_replay? re-emit? lost forever?)

**Layers to audit.**

1. **claude → tugcode**: claude's stdout pipe (OS-level, ~64KB on macOS), drained by tugcode's `stdoutDrain` task.
2. **tugcode internal**: `writeLine` to Bun.stdout. Synchronous; the question is whether tugcast's reader keeps up.
3. **tugcode → tugcast**: tugcode's stdout pipe, drained by tugcast's bridge.
4. **tugcast supervisor**: per-session queue (`LedgerEntry::queue`), bounded — what are its limits and overflow behavior?
5. **tugcast → WebSocket**: the WS sender. What if a client is slow / disconnected?
6. **WebSocket → tugdeck**: the WS receiver. Does the WS protocol guarantee delivery? What about lost frames?
7. **tugdeck FeedStore**: routing, filtering. Does it ever drop?
8. **tugdeck reducer**: the explicit drop branches (e.g. `assistant_text` in idle phase). Each drop is a deliberate choice; this audit catalogs them.

**Implementation location.** Output table in this plan section. Source for the table: a code-reading pass (Read + Grep) over the relevant files; no test runs needed.

**How I run it.** Sequential code reads + summarized findings.

**Verdict format.** A table in this section + a paragraph naming the gaps the design must close.

**Verdict — drop-point inventory complete.**

| # | Layer | Buffer / Channel | Capacity | Overflow behavior | Telemetry | Recovery |
|-|-|-|-|-|-|-|
| 1 | claude → tugcode (claude stdout pipe) | OS pipe | macOS default ~64 KB | claude blocks on write (TCP-style backpressure) | none from claude | drain catches up; no drops |
| 2 | tugcode internal `writeLine` → Bun.stdout | OS pipe to tugcast | macOS default ~64 KB | tugcode blocks on write (Bun.write awaits) | none | tugcast's reader keeps draining; backpressure transparent |
| 3 | tugcode → tugcast (tugcode stdout pipe) | OS pipe | macOS default ~64 KB | tugcode blocks on write | none | tugcast's bridge keeps draining |
| 4 | tugcast supervisor per-session queue | `BoundedQueue<Frame>` (`agent_supervisor.rs`) | **256** (`BOUNDED_QUEUE_CAP`) | overflow drops the new push, returns `QueuePush::Overflow` | `request_replay.skipped reason="spawning_queue_overflow"` (tracing::warn) | **NONE today** — verb is dropped; cold-boot transcript may show empty until next dispatch (e.g. another reload) |
| 5 | tugcast CODE_OUTPUT broadcast | `tokio::sync::broadcast` | **1024** (`CODE_BROADCAST_CAPACITY`) | existing subscribers get `RecvError::Lagged(N)` | router emits `lag_detected` + `lag_recovery` control frames | router's `LagPolicy::Replay` replays from `ReplayBuffer` (1000 frames) — **existing subscribers only**; fresh subscribers after disconnect-reconnect get nothing for the disconnect window (E3) |
| 6 | tugcast CODE_OUTPUT replay buffer | `ReplayBuffer` (router.rs) | **1000** frames, evicting FIFO | oldest frame evicted on push past capacity | none on eviction | covers replay-on-lag for existing subscribers; if eviction happens during a long lag, the lagged subscriber gets a partial replay (older frames already evicted) |
| 7 | WebSocket frame to tugdeck | TCP socket | TCP receive buffer (kernel) | TCP backpressure; both ends pace | none | TCP guarantees in-order delivery + no loss while connection is open. Disconnect = recovery via reconnect+`request_replay`. |
| 8 | tugdeck `FeedStore` filter | `acceptFrame` → router by `tug_session_id` | n/a (synchronous filter) | drop if filter rejects | none | n/a — the filter is the contract |
| 9 | tugdeck `frameToEvent` decoder | `KNOWN_CODE_OUTPUT_TYPES` allowlist | n/a | drop unknown event types | none on receiver side | n/a — silent drop; must update allowlist when adding new event types |
| 10 | tugdeck reducer drop branches | per-handler phase guards | n/a | drop event if phase doesn't match (e.g. `handleAssistantText` drops in idle) | optional `console.warn` in some handlers | n/a — the drop is intentional defense-in-depth, but during mid-turn reload these become real drops (E2 finding) |

**Identified gaps where messages can drop without recovery in the mid-turn-reload scenario:**

- **G1 (E1 race).** Tugcode reading JSONL right after `result` on stdout sees a 2-6ms incomplete window. Result: an "in-flight" turn that just finished may show empty assistant content if replay reads JSONL too eagerly. Recovery: read tugcode's own `ActiveTurn.partialText` for the in-flight turn instead of JSONL.
- **G2 (E3 broadcast drop).** CODE_OUTPUT events emitted during the disconnect window between card v1 leaving and card v2 connecting are not delivered to card v2 by the broadcast channel. Recovery: card v2 sends `request_replay`; tugcode replays from JSONL + ActiveTurn.
- **G3 (E2 reducer drop).** Live events for an in-flight turn that arrive at tugdeck while phase is `idle` (i.e., before `replay_started` and after `replay_complete`) are dropped by the reducer. Recovery: today, none — the events are silently lost. Design phase must either (a) gate the live emit so events arrive only within the bracket, (b) extend the reducer's phase allowlist for events keyed by `state.activeMsgId`, or (c) buffer & re-dispatch.
- **G4 (Spawning-queue overflow).** A user typing 256+ messages during the cold-boot Spawning window (claude not yet alive) overflows the supervisor's per-session queue. Today logs and drops. Recovery: re-issue. Likely not realistic in practice; document and move on.
- **G5 (broadcast lag with eviction).** A subscriber that lags long enough for the 1000-frame `ReplayBuffer` to evict gets a partial replay. Likely rare in practice (1000 frames is many turns of content) but possible under load. Recovery: nothing automatic.

**Design implications.** To satisfy "never drop a message" for the mid-turn reload case:

- **Tugcode is the source of truth for the in-flight turn**, not JSONL. Closes G1.
- **Card v2 fetching via `request_replay` is the recovery path** for events lost during the disconnect window. Closes G2 *if* tugcode's response includes the in-flight turn's content from its own state (i.e., closes G1's same fix).
- **The bracket must contain the live events for the in-flight turn**, OR the reducer must accept them outside the bracket. Closes G3. Probably the simplest fix is for tugcode to suppress live emit during runReplay's window for the in-flight turn, and emit a single coherent block for it inside the bracket. (This avoids the α suppression failure mode because tugcode's ActiveTurn state, not JSONL, drives the in-flight content emission.)
- **G4 (spawning-queue overflow) and G5 (replay-buffer eviction)** are accepted as out-of-scope for this plan. Both have telemetry; both are realistic only under pathological load.

#### What we know now {#what-we-know-now}

The four experiments together produce a coherent picture of where the mid-turn reload scenario fails today and what the design must do.

**The story in one paragraph.** Tugcode mints its own UUID for each in-flight turn, but claude writes JSONL using its own `message.id`. These IDs never match. When a user reloads mid-turn, three things happen concurrently: (i) tugcode keeps draining claude's stdout and emitting live events keyed by the tugcode UUID; (ii) tugdeck's WebSocket disconnects, so events emitted in that window are lost at the broadcast layer (E3); (iii) when card v2 reconnects and dispatches `request_replay`, tugcode reads the JSONL — but the JSONL is a few milliseconds behind claude's stdout (E1) and uses claude's `message.id` (E2 confirms divergence). The orphan-synthesis path then fabricates a `turn_complete{interrupted}` for the trailing turn. Live events for the same logical turn (with tugcode's UUID, different key) arrive outside the replay bracket and get dropped by the reducer's phase guards (E2, E4 G3). Net result: the in-flight turn appears as a phantom interrupted row in the transcript while claude is still happily streaming, and the user has lost their work as far as the UI is concerned.

**The fix shape, derived from the verdicts.** Four design commitments, each pinned by a specific experiment:

1. **Tugcode is the in-flight turn's source of truth.** When `request_replay` arrives, tugcode emits the in-flight turn's content from its own `ActiveTurn` state (`partialText`, `toolCallMap`, the user's stored prompt) — not from JSONL. Pins E1's race away. JSONL stays the source of truth for *committed* turns where the race is irrelevant.
2. **Live and replay agree on `msg_id`.** Tugcode learns claude's `message.id` from the first stream event of each turn and uses it as `ActiveTurn.msgId`, replacing the throwaway UUID it currently mints. The reducer's existing dedupe handles the merge for free. Pins E2's divergence away.
3. **The translator skips orphan synthesis when tugcode signals the trailing turn is the live in-flight one.** No more `turn_complete{interrupted}` for a turn that's actually still streaming. The signal is a single flag passed from tugcode to the translator.
4. **Tugcode emits the in-flight turn's content as a coherent block inside the replay bracket.** During `runReplay`, tugcode holds back live emit for the in-flight turn (suppress flag on `ActiveTurn`) and emits one consolidated set of events from its own state at the right point in the bracket. After `replay_complete`, live emit resumes naturally. Pins E2's interleaving and E4's G3 drop away. **This is different from α** because the suppressed events are emitted from tugcode's own ActiveTurn state inside the bracket, not skipped entirely with the hope that JSONL has them later.

**What the front end does.** Front end sends `request_replay` on services construction (already shipped). Reducer accepts the bracket. With (1)–(4), the wire delivers a clean replay including the in-flight turn keyed by claude's `message.id`. After `replay_complete`, live events with the same `message.id` continue to flow into the same TurnEntry. Card observer renders. Done. **The front end is not doing more work — it's the back end's job to deliver a coherent stream, and the back end has the data it needs to do it.**

**Drop story for "never lose a message."** Per E4: G1, G2, G3 are all closed by the four design commitments above. G4 (Spawning-queue overflow at 256 buffered frames during cold-boot) and G5 (broadcast replay buffer eviction at 1000 frames) are accepted as pathological-load-only and remain documented with telemetry. The "never drop" requirement is satisfied for the mid-turn reload scenario.

#### Phase 0 deliverable {#phase-0-deliverable}

A single commit `tide(mid-turn): Phase 0 investigation — harnesses + verdicts`:

- Four harness scripts / tests added to the repo:
  - `tugcode/scripts/investigate-jsonl-flush-timing.ts` (E1 single-run)
  - `tugcode/scripts/run-e1-batch.ts` (E1 multi-run aggregator)
  - `tugcode/src/__tests__/replay-spawn-mid-turn.test.ts` (E2)
  - `tugrust/crates/tugcast/tests/e3_subscriber_buffering.rs` (E3)
- Trace / report files under `roadmap/tugplan-tide-mid-turn-replay-traces/`:
  - `e1-batch-run-{01..10}.json`, `e1-batch-summary.json`
- This plan section's verdicts filled in with the actual findings
- "What we know now" summary written

#### Phase 0 checkpoint {#phase-0-checkpoint}

- [x] E1 (JSONL flush timing) harness committed; 10-run trace captured; verdict written. **Race exists, mean 4.2ms.**
- [x] E2 (live/replay ordering) test committed; trace captured; verdict written. **msg_id divergence + reducer drop confirmed on the wire.**
- [x] E3 (tugcast buffering) test committed; three sub-tests passing; verdict written. **Disconnect-window frames lost at broadcast layer.**
- [x] E4 (drop audit) table committed; five gaps identified, three closed by Phase 1 design commitments, two accepted as pathological-load-only.
- [x] "What we know now" summary written.
- [x] All check commands green: `bun test` (tugcode + new E2 test), `cargo nextest run` (tugcast + new E3 test). _TS / lint not re-run for this commit since no production source changed; the harnesses live under `scripts/` and `tests/` and don't enter the production build graph._

---

### Phase 1 — Design {#phase-1}

**Status:** Ready to author. Phase 0 closed; verdicts + drop audit pin the design space.

The design is the four commitments named in [#what-we-know-now]:

1. **Tugcode uses claude's `message.id` as the canonical id for live events.** `ActiveTurn.msgId` is captured from the first stream event of each turn instead of being minted via `crypto.randomUUID()`. Live emits and replay emits then share an id for the same logical turn — the reducer's existing `msg_id` dedupe ([D04]) handles the merge automatically.
2. **In-flight content emitted from `ActiveTurn`, not JSONL.** When `runReplay` runs against a JSONL whose trailing turn matches `this.activeTurn?.msgId`, tugcode emits the in-flight turn's content from its own per-turn state (user prompt + accumulated `partialText` + tool calls), not from the JSONL's partial assistant entry. JSONL stays the source of truth for committed turns. Closes E1's race.
3. **Translator skips orphan synthesis on the live in-flight trailing turn.** A flag from tugcode tells the translator "the trailing turn is the one I'm currently streaming; emit its committed prefix from JSONL but no synthetic `turn_complete{interrupted}`." The bracket closes; live forwarding (now using the same `msg_id` per #1) produces the real `turn_complete`.
4. **Live emit for the in-flight turn is suppressed during `runReplay`'s window**, then resumed after `replay_complete`. Tugcode (which owns both the drain and `runReplay`) is the natural serialization point. The suppressed events accumulate in `ActiveTurn` state during the window — they're not lost, they're just held back from the wire — and emerge as the resume's first deltas after `replay_complete`. Closes E2's interleaving and E4's G3.

**What's NOT in the design** (deliberately):

- No new wire-protocol frames. The bracket protocol stays exactly as today.
- No new reducer phases. `replay_deferred` is not coming back.
- No "Check again" UI. The user shouldn't ever wait long enough to need a manual retry — replay reads JSONL fast and the in-flight content emits from already-cached state in tugcode.
- No client-side reconciliation logic. The reducer's existing `msg_id` dedupe is the entire merge story.

**Open implementation questions** (small, resolved during Phase 2 by reading code):

- Where exactly in `dispatchEventToTurn` does `ActiveTurn.msgId` get set from claude's `message.id`? Need to identify which event(s) carry it and verify ordering.
- Does the translator already pass options through on a per-turn basis, or do we need to thread one? (The "skip orphan synthesis" flag.)
- Are there existing places where `ActiveTurn.msgId` is captured as a UUID and read elsewhere (logs, telemetry)? If yes, those sites need a one-line update when the canonical-id change lands.

**Phase 1 deliverable:** A revised `[#phase-1]` section of this plan with concrete `[D##]` decisions for each of (1)–(4), per-step artifacts/tasks/tests/tuglaws cross-check, and a checkpoint. Implementation phases follow.

---

### Phase 2+ — Implementation {#phase-2-plus}

**Status:** Pending Phase 1.

Will be sized into discrete steps once the design is locked. Likely shape: one step per layer (tugcode id-canonicalization → translator hint → reducer handler) with a failure-first proof per step and an automated end-to-end Smoke D test as the close-out.

---

### Tuglaws cross-check (preliminary) {#tuglaws-cross-check}

The design phase will produce the per-step cross-check. Up front, the laws this work touches:

- **L02** — reducer changes must stay within `useSyncExternalStore`-only structure-zone discipline.
- **L23** — preserving user-visible state across the reload is the entire point of this plan.
- **D04** (msg_id dedupe at the reducer) — load-bearing once live and replay agree on the id.
- **D08** (orphan synthesis) — likely conditioned on whether the trailing turn is the one currently in flight (tugcode-side hint).
- **D12** (request-driven replay) — unchanged; the request_replay verb is still the single trigger.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Smoke D passes — mid-turn reload restores the transcript with the in-flight turn correctly attached, no events dropped, no manual recovery needed.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Phase 0 investigation complete (four verdicts written).
- [ ] Phase 1 design recorded as `[D##]` decisions in this plan.
- [ ] Phase 2+ implementation lands; failure-first proofs verified per step.
- [ ] Smoke D — mid-turn reload — passes manually.
- [ ] Smoke D — automated regression — passes deterministically (`bun test src/__tests__/replay-spawn-mid-turn.test.ts` or equivalent).
- [ ] Drop audit's identified gaps closed: every potential drop point either provably unreachable, gated by a bounded queue with telemetry, or recovered via request_replay.
- [ ] HMR cycles during dogfooding don't lose conversation context (manual confirmation via the user's actual workflow).
- [ ] Tuglaws cross-check passes per-step.
- [ ] All check commands green: `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run`.

| Checkpoint | Verification |
|-|-|
| E1 verdict | `bash tugcode/scripts/investigate-jsonl-flush-timing.sh` + verdict in plan |
| E2 verdict | `bun test src/__tests__/replay-spawn-mid-turn.test.ts` |
| E3 verdict | `cargo nextest run -p tugcast` (specific test TBD) + verdict in plan |
| E4 verdict | Drop-audit table in plan |
| Smoke D regression | `bun test` (specific test TBD per Phase 2 design) |
| Smoke D manual | User confirmation; not blocking ship if automated covers it |
| TS clean | `bun x tsc --noEmit` |
| Rust clean | `cargo nextest run` |
| Lint clean | `just lint` |
