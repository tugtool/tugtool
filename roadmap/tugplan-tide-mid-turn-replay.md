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
| Status | draft (Phase 0 investigation pending) |
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

**Verdict (TBD — pending experiment run):**

- _To be filled in._ Expected output sketch:
  - "Across N=20 runs of a deterministic prompt, the JSONL final-entry write completed [before / at the same instant / after] the stdout `result` event with mean offset _M_ ms (stddev _σ_)."
  - "Implication for design: [the H1a or H1b path]."

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

**Verdict (TBD — pending experiment run):**

- _To be filled in._ Expected output sketch:
  - "Captured wire trace shows [interleaving pattern]. Reducer state after replay produces [the correct / a corrupted] TurnEntry in [N/N / fewer than N/N] runs."
  - "Implication for design: [the H2a or H2b or H2c path]."

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

**Verdict (TBD — pending experiment run):**

- _To be filled in._ Expected output sketch:
  - "Tugcast [drops / buffers up to N events / persists indefinitely] events emitted during the disconnect window."
  - "If H3a: card v2's recovery relies entirely on request_replay + JSONL completeness."
  - "If H3b: card v2 may see duplicate events; the reducer's [D04] msg_id dedupe handles them."

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

**Verdict (TBD — pending audit):**

- _To be filled in._ Expected output sketch:
  - Table: per-layer buffer / capacity / overflow / telemetry / recovery.
  - Identified gaps: [list of points where messages can drop without recovery].
  - Design implications: [what Phase 1 must address to satisfy "never drop"].

#### Phase 0 deliverable {#phase-0-deliverable}

A single commit `tide(transcript): mid-turn investigation — Phase 0 traces`:

- Four harness scripts / tests added to the repo
- Four trace / report files under `roadmap/tugplan-tide-mid-turn-replay-traces/`
- This plan section's "Verdict (TBD …)" placeholders all filled in with the actual findings
- A 1-2 paragraph "What we know now" summary at the end of this Phase 0 section

#### Phase 0 checkpoint {#phase-0-checkpoint}

- [ ] E1 (JSONL flush timing) harness committed; trace captured; verdict written.
- [ ] E2 (live/replay ordering) test committed; trace captured; verdict written.
- [ ] E3 (tugcast buffering) test committed; trace captured; verdict written.
- [ ] E4 (drop audit) table committed; gaps identified.
- [ ] "What we know now" summary written at end of Phase 0.
- [ ] All check commands green: `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run`.

---

### Phase 1 — Design {#phase-1}

**Status:** Pending. Design lands after Phase 0 verdicts are in.

**Likely shape (subject to Phase 0 confirmation):**

The post-mortem of α points at three changes. None ships before Phase 0 confirms its premise:

1. **Tugcode uses claude's `message.id` as the canonical id for live events.** `ActiveTurn.msgId` is set from the first stream event's `message.id` (currently `crypto.randomUUID()`). Live emits and replay emits then share an id for the same logical turn. The reducer's existing msg_id dedupe handles the merge.
2. **Reducer accepts a "still in flight" trailing replay turn.** When `replay_complete` lands and the reducer's state has `activeMsgId` set with no `turn_complete` yet committed for that id, transition to `streaming` instead of `idle`. Live events for the same id continue to flow into the existing TurnEntry.
3. **Translator stops orphan-synthesizing the trailing in-flight turn when tugcode signals it's still alive.** The trailing turn from JSONL emits its events but no synthetic `turn_complete{interrupted}`. Live forwarding produces the real `turn_complete` later.

**Open questions for the design phase (each resolved by a Phase 0 verdict):**

- E1 verdict shapes whether replay can read JSONL immediately after `result` or needs a different source for the in-flight turn's content.
- E2 verdict shapes whether the wire needs ordering guarantees (serialization in tugcode) or whether the reducer can handle interleaving.
- E3 verdict shapes whether the disconnect window requires its own recovery mechanism or whether request_replay covers it.
- E4 verdict shapes the durability story: queue capacities, overflow behavior, recovery paths.

**Phase 1 deliverable:** A revised `[#phase-1]` section of this plan, with concrete `[D##]` decisions, artifacts, tasks, tests, tuglaws cross-check, and checkpoint. Implementation phases follow.

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
