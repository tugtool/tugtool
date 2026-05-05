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
| Status | Phase 0 complete; Phase 1 plan authored ([DM03]–[DM06] + spec + 4 execution steps); ready to implement |
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

#### [DM03] Tugcode adopts claude's `message.id` as the canonical id for live events (DECIDED — Phase 1) {#dm03-canonical-id}

**Decision:** `ActiveTurn.msgId` is captured from the first stream event of each turn that carries `message.id`. Live emits and replay emits then share an id for the same logical turn, and the reducer's existing `msg_id` dedupe ([D04] of the resume plan) handles the merge automatically. The current `crypto.randomUUID()` mint at `handleUserMessage` time is replaced.

**Rationale:**

- The msg_id divergence (live = tugcode UUID, replay = claude id) is the load-bearing root cause of every prior mid-turn merge attempt's failure. E2 confirmed the divergence on the wire.
- We control tugcode. Tugcode reads claude's stdout. Claude reveals `message.id` on every stream event. The data is right there.
- The reducer already handles "two events with the same `msg_id`" correctly (idempotent commit). It does NOT handle "two events with different `msg_id`s for the same logical turn" — that's what we've been trying to bolt on. Fixing the producer is structurally cleaner than fixing every consumer.
- One-time canonicalization at the source eliminates a class of future bugs where a feature accidentally exposes the divergence.

**Implications:**

- `ActiveTurn` constructor takes the placeholder UUID off the hot path. The `msgId` field becomes mutable until first stream event and then frozen.
- Anywhere live events emit before `message.id` is known: there is no such site today. The drain calls `dispatchEventToTurn` only on stdout-line arrivals, and the first arrival carries `message.id`. Verified during Step 1.
- Pre-existing call sites that read `ActiveTurn.msgId` (logs, the `signalEofToActiveTurn` emit path) get an updated value after first stream event. None of them snapshot the id before that point in production paths.

**Alternative considered:** translator emits the trailing in-flight turn's events with tugcode's UUID instead of claude's id. **Rejected** because the divergence still exists for any future feature that wants to merge live + replay; the alternative only patches the trailing-turn case.

#### [DM04] In-flight turn content is emitted from `ActiveTurn`, not from JSONL (DECIDED — Phase 1) {#dm04-active-turn-source}

**Decision:** When `runReplay` runs against a JSONL whose trailing turn is the one currently in flight (`this.activeTurn?.msgId` matches the trailing assistant entry's id, per [DM03]), tugcode emits the in-flight turn's content from `ActiveTurn` state — the user's prompt (newly stored), accumulated `partialText`, recorded tool calls — not from the JSONL's partial assistant entry. JSONL stays the source of truth for *committed* turns.

**Rationale:**

- E1 confirmed JSONL trails stdout `result` by 2-6ms. That's small but always positive; under load the tail extends. Reading JSONL the instant `result` arrives consistently sees an incomplete file.
- Tugcode already has the in-flight turn's content in memory: `partialText` accumulates as deltas arrive; tool calls and approvals pass through `dispatchEventToTurn`. The data is fresher and more complete than JSONL.
- The user's prompt is currently NOT stored on `ActiveTurn`; that's a small one-field addition (`userText: string`).
- This is the inversion that closes E1's race: the wire reflects tugcode's authoritative state, not a derivative on disk.

**Implications:**

- `ActiveTurn` gains a `userText: string` field, set by `handleUserMessage` from the inbound `UserMessage`'s text.
- `runReplay` reads `this.activeTurn` at entry. If non-null and matching the JSONL's trailing turn, the translator skips the trailing turn (per [DM05]) and tugcode emits a `user_message_replay` + accumulated `assistant_text` + recorded tool events using `ActiveTurn` state.
- The translator's existing JSONL → events translation is unchanged for committed turns; the in-flight turn diverts to the new tugcode-side emission path.

**Alternative considered:** make tugcode wait some extra ms after `result` for JSONL to settle (a "settle window"). **Rejected** because timing-fragile and adds latency. The right answer is to use the data tugcode already has.

#### [DM05] Translator skips orphan synthesis when tugcode signals the live in-flight trailing turn (DECIDED — Phase 1) {#dm05-orphan-handoff}

**Decision:** `translateJsonlSession` gains an option `liveInflightMsgId?: string`. When set, the translator's end-of-JSONL flush behaves differently: if the trailing turn's terminal assistant entry has `message.id === liveInflightMsgId`, the translator emits no events for that turn at all (tugcode's own emission path covers it per [DM04]), and skips the synthetic `turn_complete{interrupted}` per [D08] of the resume plan. When `liveInflightMsgId` is unset, the existing orphan-synthesis behavior is preserved (cold-boot replays of JSONLs that end mid-turn from a previous interrupted session still synthesize the orphan).

**Rationale:**

- [D08] orphan synthesis is correct for cold-boot of an interrupted session. It is wrong when the trailing turn is the one tugcode is currently streaming locally. The two cases are distinguishable: tugcode either has an `ActiveTurn` for that id or doesn't.
- A single optional flag is the minimal protocol change. No new wire shapes; no new translator vocabularies.
- Keeping the cold-boot orphan-synthesis path preserves [D08]'s contract for the case it was designed for.

**Implications:**

- `tugcode/src/replay.ts` accepts the new option in `TranslateSessionOptions`.
- `tugcode/src/session.ts::runReplay` populates the option from `this.activeTurn` at entry time.
- The translator's existing per-turn buffer detection (already in place for [D08]) does the matching; if the trailing turn's `message.id` equals `liveInflightMsgId`, skip; otherwise proceed as today.

**Alternative considered:** strip [D08]'s synthesis entirely and rely on tugcode-side detection in all cases. **Rejected** because it loses the cold-boot interrupted-session signal that today's `result: "interrupted"` row provides for legitimately-orphaned JSONLs.

#### [DM06] Live emit for the in-flight turn is suppressed during `runReplay`'s window (DECIDED — Phase 1) {#dm06-suppress-during-replay}

**Decision:** `ActiveTurn` gains a `suppressEmit: boolean` field. When `runReplay` enters with a matching active turn, it sets `suppressEmit=true` on that turn, runs the replay (which emits committed turns from JSONL plus the in-flight turn's coherent block from ActiveTurn state per [DM04]), then clears `suppressEmit` after the closing `replay_complete` is on the wire. While suppressed, the drain's `dispatchEventToTurn` updates `ActiveTurn` state (`partialText`, `gotResult`, etc.) but does NOT call `writeLine` for that turn's events. After unsuppress, the drain resumes emitting normally — any deltas accumulated during the window arrive as the resume's first emits, keyed by claude's `message.id` ([DM03]).

**Rationale:**

- E2 confirmed live and replay events for the same in-flight turn interleave on the wire and that live events outside the bracket get dropped at the reducer's phase guard. Both problems disappear if tugcode emits one coherent block for the in-flight turn inside the bracket.
- This is **NOT** the α design that was reverted. α's failure was emitting from JSONL after suppression cleared, hitting E1's race; [DM06] emits from `ActiveTurn` state ([DM04]) inside the bracket, so the race is irrelevant.
- The suppression window is short (~tens of ms — `runReplay` is fast). Deltas accumulated during the window are not lost; they ride out as live events post-bracket.
- Tugcode is the natural serialization point — it owns both the drain and `runReplay`.

**Implications:**

- `dispatchEventToTurn` checks `turn.suppressEmit` at each per-turn `writeLine` site (mirrors the seven-site pattern catalogued in the reverted α; the difference is what happens during the window, not the gating mechanism).
- `signalEofToActiveTurn` similarly honors `suppressEmit` (its emits are also per-turn).
- `runReplay`'s post-bracket cleanup unconditionally clears `suppressEmit` on the active turn (defensive: the state must not persist across replays).

**Pitfall: claude crash during the suppressed window.** If claude's stdout EOFs while `runReplay` is mid-iteration (claude crashed, killed, or the subprocess otherwise dies), the drain hits EOF and calls `signalEofToActiveTurn`. With `suppressEmit=true`, that handler's `turn_cancelled` / `error` `writeLine` is skipped — but `turn.finish()` still runs, so the active turn ends. After replay events finish, `runReplay` calls `emitInflightTurnFromActiveTurn` (per [DM04]). Without explicit handling, the synthesized block emits `user_message_replay` + `assistant_text` but **no terminal event**, because no `gotResult` arrived. After `replay_complete` and suppression clearing, the drain is dead (EOF), so no live `turn_complete` ever arrives. The reducer's `pendingUserMessage` stays set, scratch has assistant text, but the TurnEntry never commits — the in-flight turn dangles. **Mitigation:** `emitInflightTurnFromActiveTurn` checks `turn.gotResult` / `turn.interrupted` and emits the appropriate terminal event (`turn_complete` for `gotResult`, `turn_cancelled` for `interrupted`) inside the bracket. See [#emit-inflight] for the spec; pinned by Step 3's tests.

**Alternative considered:** rely on the reducer to dedupe + reorder. **Rejected** because today's reducer drops events outside the active phase set, and changing that surface area is a larger blast radius than fixing tugcode's wire-emit ordering at the source.

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

### Specification {#specification}

#### Wire shape (unchanged) {#wire-shape}

The mid-turn replay rides the existing `CODE_OUTPUT` bracket: `replay_started` → per-turn events → `replay_complete`. **No new wire frames.** Reducer phases unchanged: `idle | submitting | awaiting_first_token | streaming | tool_work | awaiting_approval | replaying | errored`. **No new reducer phase.** The four design decisions ([DM03]–[DM06]) all live below the wire — they reshape what tugcode emits, not how tugdeck observes it.

#### `ActiveTurn` shape {#active-turn-shape}

Per [DM03], [DM04], [DM06], the `ActiveTurn` class in `tugcode/src/session.ts` adds three fields and one mutation point:

```ts
class ActiveTurn {
  /** Mutable until first stream event with `message.id` arrives,
   * then frozen. Pre-populated with a placeholder UUID at install
   * time so logs / EOF emit have something to show even if the
   * turn dies before any stream event arrives. */
  msgId: string;

  /** The user's prompt text, captured by handleUserMessage from
   * the inbound UserMessage. Source-of-truth for the in-flight
   * turn's user_message_replay payload during runReplay (DM04). */
  readonly userText: string;

  /** Attachments captured by handleUserMessage from the inbound
   * UserMessage. Threaded through to the synthesized
   * user_message_replay so attachment-bearing turns (file uploads
   * etc.) reconstruct faithfully on mid-turn replay. Empty array
   * when the user submitted plain text. */
  readonly userAttachments: ReadonlyArray<Attachment>;

  /** Accumulated assistant text — already exists. */
  partialText: string;

  /** Already exists. */
  gotResult: boolean;
  interrupted: boolean;
  rev: number;
  seq: number;
  completion: Promise<void>;

  /** Set by runReplay when it adopts this turn for in-flight
   * emission (DM06). While true, dispatchEventToTurn and
   * signalEofToActiveTurn skip their per-turn writeLine calls
   * but continue to update state. Cleared by runReplay after
   * replay_complete is on the wire. */
  suppressEmit: boolean;
}
```

#### `runReplay` flow {#run-replay-flow}

```ts
async runReplay(): Promise<void> {
  if (sessionMode !== "resume") return;
  if (replayActive) {
    logReplay("request_dropped", { reason: "replay_in_flight" });
    return;
  }
  replayActive = true;

  // Snapshot the active turn at entry; nothing else can install one
  // synchronously and the synchronous block from here through the
  // first await runs in one tick.
  const inflight = (
    activeTurn !== null &&
    !activeTurn.gotResult &&
    !activeTurn.interrupted
  ) ? activeTurn : null;
  if (inflight !== null) inflight.suppressEmit = true;

  try {
    writeLine({ type: "replay_started", ipc_version: 2 });

    // Translator emits committed turns from JSONL. Trailing in-flight
    // turn is skipped iff its claude message.id matches inflight.msgId
    // (DM05).
    const translatorOpts: TranslateSessionOptions = {
      liveInflightMsgId: inflight?.msgId ?? undefined,
    };
    for await (const ev of translateJsonlSession(jsonl, translatorOpts)) {
      writeLine(ev);
    }

    // Emit the in-flight turn from ActiveTurn state (DM04). Skipped
    // when no in-flight turn exists or when the JSONL didn't end
    // with a turn matching it (the translator already emitted a
    // complete turn for this id; tugcode's emit would duplicate).
    if (inflight !== null && translatorTrailingTurnSkipped) {
      emitInflightTurnFromActiveTurn(inflight);
    }

    writeLine({ type: "replay_complete", count, ipc_version: 2 });
  } finally {
    replayActive = false;
    if (inflight !== null) inflight.suppressEmit = false;
  }
}
```

The `translatorTrailingTurnSkipped` signal is a small post-condition on the translator's iterator (e.g., a sentinel value or a flag returned alongside the count). Implementation detail; pinned in Step 2.

#### `emitInflightTurnFromActiveTurn` shape {#emit-inflight}

```ts
function emitInflightTurnFromActiveTurn(turn: ActiveTurn): void {
  // user_message_replay: synthetic but keyed by claude's msg_id
  // (DM03), with the user's prompt text and attachments from
  // ActiveTurn (DM04).
  writeLine({
    type: "user_message_replay",
    msg_id: turn.msgId,
    text: turn.userText,
    attachments: turn.userAttachments,
    ipc_version: 2,
  });

  // assistant_text: the partial accumulated so far. is_partial=false
  // marks "this is the latest authoritative text" so the reducer's
  // accumulator replaces rather than appends. After replay_complete
  // the drain's live emits resume with their natural is_partial: true
  // delta pattern, appending to scratch from this baseline. Allocate
  // a fresh seq via this.nextSeq() rather than reusing turn.seq —
  // turn.seq is the user-message half's seq, allocated when the
  // ActiveTurn was installed; the assistant_text needs its own seq
  // to maintain the wire-side seq invariant (matches the existing
  // pattern at session.ts:2032 where the final assistant_text on
  // gotResult uses this.nextSeq()).
  if (turn.partialText.length > 0) {
    writeLine({
      type: "assistant_text",
      msg_id: turn.msgId,
      seq: this.nextSeq(),
      rev: turn.rev,
      text: turn.partialText,
      is_partial: false,
      status: "streaming",
      ipc_version: 2,
    });
  }

  // tool_use / tool_result: emitted from the per-turn tool-call
  // record kept by the drain. Implementation detail in Step 3 once
  // we read the exact shape of the drain's tool tracking.

  // Terminal event for already-finished turns. If the turn finished
  // (gotResult or interrupted) BEFORE runReplay's bracket completes
  // — typical scenario: claude crashed or stdout EOFed during the
  // suppressed window — the drain's signalEofToActiveTurn ran with
  // suppressEmit=true and skipped its writeLine but called
  // turn.finish(). Without an explicit terminal emit here, the
  // reducer's pendingUserMessage stays set and the TurnEntry never
  // commits. Emit the appropriate terminal event so the bracket
  // delivers a complete TurnEntry.
  if (turn.gotResult) {
    writeLine({
      type: "turn_complete",
      msg_id: turn.msgId,
      seq: this.nextSeq(),
      result: "success",
      ipc_version: 2,
    });
  } else if (turn.interrupted) {
    writeLine({
      type: "turn_cancelled",
      msg_id: turn.msgId,
      seq: this.nextSeq(),
      partial_result: turn.partialText || "User interrupted",
      ipc_version: 2,
    });
  }
  // Else: turn is still live; the drain's post-suppression live
  // emits will eventually carry the real turn_complete with its
  // own seq.
}
```

#### Translator option and "did-skip" reporting {#translator-option}

```ts
interface TranslateSessionOptions {
  // Existing options...

  /** When set, the translator's end-of-JSONL flush checks the
   * trailing turn's terminal assistant message.id. If it matches
   * liveInflightMsgId, the entire trailing turn (user + partial
   * assistant + tool entries) is skipped — tugcode's own emission
   * path covers it. Orphan synthesis is also skipped. When unset,
   * the existing behavior applies: trailing in-flight turns
   * orphan-synthesize a turn_complete{interrupted}. */
  liveInflightMsgId?: string;
}

/** Result returned by `translateJsonlSession` after the iterator
 * exits. The caller reads `skippedTrailingTurn` to decide whether
 * to emit the in-flight turn from ActiveTurn state (DM04).
 * `count` is the number of turn_complete events the translator
 * emitted, mirroring today's return shape. */
interface TranslateSessionResult {
  count: number;
  /** True iff `liveInflightMsgId` was set AND the JSONL's trailing
   * turn's assistant entry matched it AND the translator skipped
   * that turn's events. False in all other cases (no liveInflight
   * set, no trailing turn, trailing turn id didn't match, JSONL
   * empty/malformed). */
  skippedTrailingTurn: boolean;
}
```

**Reporting mechanism, pinned:** `translateJsonlSession` is changed from a bare `AsyncIterable<OutboundMessage>` to an async function that returns a `Promise<TranslateSessionResult>` *and* yields events through a callback (or a held generator's `.return()` value, depending on which fits cleanest at implementation time). `runReplay` reads `skippedTrailingTurn` after the iterator exits to decide whether to call `emitInflightTurnFromActiveTurn`.

The exact API shape — generator-with-final-value vs. callback-plus-promise — is a Step 2 implementation detail. The contract is fixed: **the translator MUST tell `runReplay` whether the trailing turn was skipped, before `runReplay` decides whether to emit from ActiveTurn.** Without this signal, `runReplay` would risk double-emitting the trailing turn (once from the translator, once from `emitInflightTurnFromActiveTurn`).

#### What stays the same {#unchanged}

- `request_replay` IPC verb ([D12] of resume plan).
- Reducer phases.
- `[D04]` msg_id dedupe — load-bearing for the merge once IDs agree.
- `[D08]` orphan synthesis — preserved for cold-boot interrupted-session JSONLs.
- All wire frames, all event types.

---

### Tuglaws Cross-Check {#tuglaws-cross-check}

The work touches tugcode (TypeScript bridge subprocess) and the translator. **No tugdeck changes.** No React, no responder chain, no token system, no list-view. The relevant laws:

- **L02** (External state enters React through useSyncExternalStore only) — N/A. Reducer is unchanged; the wire-shape is unchanged; tugdeck is a passive consumer.
- **L23** (Internal implementation operations must never lose user-visible state) — load-bearing. The whole plan exists to satisfy L23 for the mid-turn reload case. Pre-fix: in-flight turn is lost or shown as phantom interrupted. Post-fix: in-flight turn renders correctly with both halves of its content.
- **L24** (three-zone state partition) — N/A. No new state in tugdeck; tugcode-side state is per-process bridge state, outside the React zone model.

Cross-references to the resume plan's design decisions:

- **[D04]** msg_id dedupe at the reducer — relied on heavily. Once live and replay agree on `msg_id` (per [DM03]), the reducer's existing dedupe is the entire merge story.
- **[D08]** orphan synthesis — conditioned on `liveInflightMsgId` per [DM05]. Cold-boot path preserved.
- **[D12]** request-driven replay — unchanged; the verb is still the single trigger.

---

### Phase 1 — Implementation {#phase-1}

**Status:** Ready. Phase 0 closed; design pinned in [DM03]–[DM06]; spec written above.

Three execution steps + one close-out step. Each step ships a single commit, has failure-first proofs, and leaves the build green.

#### Step 1: Tugcode adopts claude's `message.id` as canonical for live events {#step-1}

**Commit:** `tugcode(mid-turn): canonicalize ActiveTurn.msgId from claude message.id`

**References:** [DM03], [E2 verdict](#e2-live-replay-ordering)

**Why this is Step 1.** The msg_id divergence is the load-bearing root cause. Every other step in this plan relies on live and replay events for the same logical turn agreeing on `msg_id`. Without this step first, [DM05]'s match (`liveInflightMsgId` against the JSONL's trailing turn id) cannot fire — the active turn's id wouldn't be claude's id.

**Artifacts:**

- `tugcode/src/session.ts` — `ActiveTurn.msgId` becomes mutable until first stream event with `message.id`, then frozen. `handleUserMessage` installs `ActiveTurn` with a placeholder UUID (so logs / EOF have something to show before claude responds). `dispatchEventToTurn` extracts `message.id` from the first stream event for the turn and overwrites `ActiveTurn.msgId`. The `EventMappingContext` passed into `routeTopLevelEvent` and `mapStreamEvent` then carries the canonical id.
- `tugcode/src/session.ts` — `mapStreamEvent` (currently at session.ts:697-770) gains a `message_start` branch that extracts `message.id` from `event.message.id` and exposes it via the existing `EventMappingResult` (or a sibling field on `routeTopLevelEvent`'s return). Today the function only handles `content_block_start` / `content_block_delta` / `tool_use` / `tool_result` and silently drops `message_start` — it must surface the id so `dispatchEventToTurn` can canonicalize.
- `tugcode/src/session.ts` — `routeTopLevelEvent` (currently at session.ts:351) gains the same id-extraction in its `case "assistant"` branch (session.ts:443) — read `(message?.id as string)` and surface it. Belt-and-suspenders: claude's stream-json with `--include-partial-messages` typically carries `message.id` in `message_start` BEFORE the top-level `assistant` snapshot, but the `assistant` snapshot also carries it; whichever lands first wins. Subsequent events with a matching id are no-ops; an event with a divergent id is logged and ignored (defensive — should not occur in practice for a single turn).
- `tugcode/src/session.ts` — `ActiveTurn` gains `userText: string` and `userAttachments: ReadonlyArray<Attachment>` per [#active-turn-shape]. `handleUserMessage` populates both from the inbound `UserMessage` before installing the active turn.
- `tugcode/src/__tests__/session.test.ts` (or `replay-spawn-drain.test.ts`) — new tests driving stream events with `message.id` (via `message_start`) and the top-level `assistant` event with `message.id`, asserting the active turn's `msgId` was overwritten in each case.

**Tasks:**

- [x] Read `dispatchEventToTurn` end-to-end. Identify the order in which `message_start`, top-level `assistant`, and the first emit-bearing event arrive. Confirm that no live emit fires before `message.id` is known (the first emit is for `content_block_delta`, which arrives after `message_start`).
- [x] Extend `mapStreamEvent` with a `message_start` branch that extracts `event.message.id` and threads it back through `EventMappingResult` (add a `messageId?: string` field).
- [x] Extend `routeTopLevelEvent`'s `case "assistant"` branch to read `(message?.id as string)` and surface it on `RouteResult` (add a `messageId?: string` field).
- [x] Add `userText: string` and `userAttachments: ReadonlyArray<Attachment>` to `ActiveTurn`. `Attachment` is already declared in `types.ts`.
- [x] Update `handleUserMessage` to populate `userText` from `msg.text` and `userAttachments` from `msg.attachments ?? []` before installing the active turn.
- [x] Implement the canonicalization in `dispatchEventToTurn`: after each call to `routeTopLevelEvent` / `mapStreamEvent`, check if the result surfaced a `messageId`. If so AND `turn.msgId` is still the placeholder, overwrite `turn.msgId`. Update `ctx.msgId` for any subsequent emits within the same dispatch tick so the FIRST emit (from the same event that carried the id) uses the canonical id.
- [x] Add tests as below.

**Tests:**

- [x] **Unit (msgId canonicalization via `message_start`)**: install an `ActiveTurn` with placeholder UUID `"placeholder-1"`. Drive a stream event of the form `{type: "stream_event", event: {type: "message_start", message: {id: "msg_claude_xyz", role: "assistant", ...}}}`. Assert `turn.msgId === "msg_claude_xyz"` after dispatch.
- [x] **Unit (msgId canonicalization via top-level `assistant`)**: same setup, but drive `{type: "assistant", message: {id: "msg_claude_abc", ...}}` instead. Assert `turn.msgId === "msg_claude_abc"`. Pins the belt-and-suspenders path for cases where `message_start` is absent.
- [x] **Unit (subsequent events keep the id)**: drive a second stream event for the same turn with the same `message.id`. Assert `turn.msgId` is still the captured value. Drive a third event with a *different* `message.id` (defensive check; shouldn't occur in production); assert tugcode keeps the first id captured and logs the divergence (no overwrite).
- [x] **Unit (`userText` + `userAttachments` populated)**: drive a `handleUserMessage({type: "user_message", text: "hello", attachments: [{filename: "f.txt", content: "...", media_type: "text/plain"}]})`. Read `(manager as any).activeTurn`. Assert `activeTurn.userText === "hello"` and `activeTurn.userAttachments.length === 1` with the right shape.
- [x] **Integration (live emit uses canonical id)**: drive a full turn through the drain (mock claude stdout feeding `message_start` → `content_block_delta` → ... → `result`). Assert every `assistant_text` / `turn_complete` IPC frame's `msg_id` matches claude's `message.id`, not the original placeholder UUID.
- [x] **Failure-first proof**: temporarily strip the canonicalization so `turn.msgId` stays the placeholder. Run the integration test. Assert it fails because emitted frames carry the placeholder UUID instead of claude's id. Restore. _Verified: 7 of 8 canonical tests fail with the canonicalization stripped (placeholder UUIDs leak into wire output); restored after verification._
- [x] **Regression (existing tests stay green)**: full `bun test` — `ActiveTurn.msgId`'s semantics change but its visibility doesn't; existing tests that observe emitted IPC frames pass because they read `msg_id` from the wire, not the construction-time UUID. _Verified: 291 / 291 tests pass post-implementation._

**Tuglaws cross-check:**

- N/A — tugcode bridge subprocess; no React; no tokens.

**Checkpoint:**

- [x] `bun test` (tugcode) — green. _291 / 291 pass._
- [x] `cargo nextest run` — green. _1221 / 1221 pass._
- [x] `just lint` — clean. _Auto-format applied to a pre-existing rustfmt issue in `e3_subscriber_buffering.rs` (Phase 0 file, not part of Step 1 logic) so the build stays green per the plan's strategy._

---

#### Step 2: Translator option to skip the live in-flight trailing turn {#step-2}

**Commit:** `tugcode(mid-turn): translator skips trailing turn on liveInflightMsgId match`

**Depends on:** [Step 1](#step-1)

**References:** [DM05], [D08] of the resume plan (orphan synthesis preserved for cold-boot)

**Artifacts:**

- `tugcode/src/replay.ts` — `TranslateSessionOptions` gains optional `liveInflightMsgId?: string`. The end-of-JSONL flush checks the trailing turn's terminal assistant entry's `message.id`. If it matches, skip the entire trailing turn (no `user_message_replay`, no per-turn assistant_text events, no orphan synthesis). The existing per-turn buffer detection is reused; the new branch is a single early-return inside the trailing-turn flush.
- `tugcode/src/replay.ts` — `translateJsonlSession` returns `TranslateSessionResult { count, skippedTrailingTurn }` per [#translator-option]. Today's API yields events through an async iterator; the `skippedTrailingTurn` value lands either as the iterator's `return` value (read via `iterator.next().value` after the iterator exits) OR via a callback on the options object — pick the cleaner shape at implementation time. `runReplay` reads `skippedTrailingTurn` in Step 3 to decide whether to emit the in-flight content from `ActiveTurn`.
- `tugcode/src/__tests__/replay.test.ts` — new tests for both branches (matched skip; unmatched orphan synthesis); plus a test that the returned `skippedTrailingTurn` accurately reports each branch's outcome.

**Tasks:**

- [x] Add `liveInflightMsgId?: string` to `TranslateSessionOptions`.
- [x] Update the trailing-turn flush branch: when `liveInflightMsgId` is set AND matches the trailing turn's id, skip everything for that turn.
- [x] Implement `TranslateSessionResult` per [#translator-option]. The contract is fixed: `skippedTrailingTurn` is `true` iff `liveInflightMsgId` was set, the JSONL had a trailing turn, AND the trailing turn's id matched. Otherwise `false`. _Implementation: AsyncGenerator's third type parameter (TReturn). `runReplay` reads it via `r.value` on the final `.next()` result; existing for-await call sites continue to work because they discard the return value. This is the cleanest pick — no callback indirection, no parallel promise — and it pins the contract at the type level._
- [x] Verify the cold-boot path is unaffected: existing tests with no `liveInflightMsgId` set must still synthesize the orphan `turn_complete{interrupted}`, and `skippedTrailingTurn` must be `false` for them.
- [x] Add tests as below.

**Tests:**

- [x] **Unit (skip on match)**: JSONL fixture with N committed turns + a trailing in-flight turn whose terminal assistant id is `"msg_X"`. Translator called with `liveInflightMsgId: "msg_X"` → emits the N committed turns and NOTHING for the trailing turn (no `user_message_replay`, no `assistant_text`, no `turn_complete`). `skippedTrailingTurn === true`.
- [x] **Unit (no skip on mismatch)**: same JSONL, called with `liveInflightMsgId: "msg_DIFFERENT"` → trailing turn emits with orphan synthesis as today. `skippedTrailingTurn === false`.
- [x] **Unit (cold-boot regression, no liveInflight)**: same JSONL, called with `liveInflightMsgId: undefined` → trailing turn orphan-synthesizes as today (preserves [D08] for the cold-boot interrupted-session case). `skippedTrailingTurn === false`.
- [x] **Unit (no trailing turn)**: JSONL with only completed turns (every assistant entry has `stop_reason`). Called with any `liveInflightMsgId` value → emits all turns normally. `skippedTrailingTurn === false`.
- [x] **Failure-first proof**: temporarily strip the early-return so the trailing turn always emits. Run the skip-on-match test. Assert it fails because the trailing turn's events appeared on the wire AND `skippedTrailingTurn` reports `false` (or whatever the buggy state produces — document the diagnostic shape). Restore. _Verified: with the skip path stripped, the skip-on-match test fails with `Expected length: 1, Received length: 2` (a duplicate `user_message_replay` for the trailing turn leaks through). Restored after verification._

Plus three additional pin tests landed alongside the five required ones: `missing JSONL with liveInflightMsgId still reports skippedTrailingTurn=false` (error-branch contract), `empty liveInflightMsgId is treated as unset` (defensive against placeholder-buffer collisions), and `for-await consumers cleanly ignore the return value` (backward-compat guard for pre-Step-2 call sites).

**Tuglaws cross-check:**

- N/A — pure TypeScript translator module; no React.

**Checkpoint:**

- [x] `bun test` (tugcode) — green. _298 / 298 pass; 7 new tests added in the trailing-turn-skip describe block._
- [x] `cargo nextest run` — green. _1221 / 1221 pass._
- [x] `just lint` — clean.

---

#### Step 3: tugcode emits in-flight turn from `ActiveTurn` during `runReplay` {#step-3}

**Commit:** `tugcode(mid-turn): emit in-flight turn from ActiveTurn; suppress live emit during replay window`

**Depends on:** [Step 1](#step-1), [Step 2](#step-2)

**References:** [DM04], [DM06], [E1 verdict](#e1-jsonl-flush-timing), [E2 verdict](#e2-live-replay-ordering)

**Artifacts:**

- `tugcode/src/session.ts` — `ActiveTurn.suppressEmit: boolean = false`. `dispatchEventToTurn` and `signalEofToActiveTurn` skip their per-turn `writeLine` calls when `suppressEmit` is true (state updates and `finish()` still run). The seven gating sites are documented in the `ActiveTurn` class doc.
- `tugcode/src/session.ts` — `runReplay` snapshots `this.activeTurn` at entry, treats it as an in-flight turn for defer purposes only when `!gotResult && !interrupted`. If matched: set `suppressEmit=true`, thread `liveInflightMsgId` into the translator, after the iterator completes call `emitInflightTurnFromActiveTurn(turn)` if the translator skipped the trailing turn, then emit `replay_complete`, then clear `suppressEmit` (`finally` guard).
- `tugcode/src/session.ts` — `emitInflightTurnFromActiveTurn` (private helper): emits the synthesized block per [#emit-inflight] — `user_message_replay` (with `msg_id = turn.msgId`, `text = turn.userText`, `attachments = turn.userAttachments`), then a consolidated `assistant_text { is_partial: false, text: turn.partialText }` with a fresh seq via `this.nextSeq()`, then per-turn tool events from the drain's per-turn tool record, then a terminal event (`turn_complete` if `gotResult`, `turn_cancelled` if `interrupted`, otherwise nothing — the live drain emits the real `turn_complete` post-bracket).
- `tugcode/src/__tests__/replay-spawn-mid-turn.test.ts` — extend the existing investigation test or write a new test: drive a full mid-turn replay scenario (active turn installed, runReplay called, then live drain emits more deltas + result). Assert the wire trace has exactly one bracket and one TurnEntry's worth of events for the in-flight turn, all keyed by claude's id.

**Tasks:**

- [x] Add `suppressEmit` field to `ActiveTurn` and gate the seven per-turn writeLine sites in `dispatchEventToTurn` (5) and `signalEofToActiveTurn` (2). _Sites enumerated in the `ActiveTurn.suppressEmit` doc-comment: routeResult.messages forwarding, streamResult.messages forwarding, control_request_forward, complete-text on gotResult, turn_complete on gotResult, EOF turn_cancelled, EOF error._
- [x] Update `runReplay` per the spec section above. The defer branch is **NOT** the α "wait for completion" pattern — it sets `suppressEmit`, runs replay, emits the in-flight block, and clears suppress. No await on `activeTurn.completion`. _Buffered-replay_complete pattern: runReplay holds back the translator's terminal `replay_complete`, calls `emitInflightTurnFromActiveTurn` if `skippedTrailingTurn===true`, then emits the buffered close to preserve chronological wire ordering [committed, in-flight, replay_complete]._
- [x] Implement `emitInflightTurnFromActiveTurn` per [#emit-inflight]. Allocate fresh seqs via `this.nextSeq()` for the assistant_text and any terminal event. Handle the `gotResult` and `interrupted` branches per the [DM06] crash-during-suppression pitfall.
- [x] Read the drain's tool-call tracking and decide whether to thread tool events through `emitInflightTurnFromActiveTurn` now or defer to a follow-on. _Deferred: the drain dispatches tool events through writeLine without buffering per-turn tool state, so we have no record to replay. Documented in the helper's doc-comment as a known v1 limitation. A tool-approval that lands mid-window is rare given the bracket's tens-of-ms window; deferred to roadmap follow-on (mid-tool-use reload)._
- [x] Verify the post-suppression live emit picks up cleanly. Add an inline comment in `mapStreamEvent`'s `content_block_delta` branch noting that the **delta-only** emission shape (`text: delta.text`, `is_partial: true`) is load-bearing for Step 3's "snapshot then resume" pattern: the synthesized `is_partial: false` snapshot REPLACES the reducer's scratch, and subsequent live deltas APPEND to it. If a future change makes `mapStreamEvent` emit cumulative text instead of deltas, mid-turn replay's resume would double-count and Step 3's integration test would fail. The comment is the canary.
- [x] Add tests as below.

**Tests:**

- [x] **Unit (suppress gates emit but not state)**: with `suppressEmit=true`, drive a stream_event delta and a result event. Assert no `assistant_text` / `turn_complete` IPC frames. Assert `partialText` accumulated and `gotResult=true`. _4 unit tests in session.test.ts: text-delta gating, result-event gating, suppress=false control, control_request_forward gating with pendingControlRequests still recorded._
- [x] **Unit (in-flight emission shape, still-live turn)**: install an active turn with `userText="hi"`, `userAttachments=[]`, `partialText="hello world"`, `msgId="msg_X"`, `gotResult=false`, `interrupted=false`. Call `emitInflightTurnFromActiveTurn`. Assert wire emits, in order: `user_message_replay { msg_id: "msg_X", text: "hi", attachments: [] }`, then `assistant_text { msg_id: "msg_X", text: "hello world", is_partial: false, seq: <fresh> }`. NO terminal event (`turn_complete` / `turn_cancelled`) — the live drain emits the real one post-bracket.
- [x] **Unit (in-flight emission with attachments)**: same setup but `userAttachments=[{filename: "f.txt", content: "...", media_type: "text/plain"}]`. Assert the emitted `user_message_replay` carries the attachment array verbatim.
- [x] **Unit (in-flight emission, gotResult-true)**: install an active turn with `gotResult=true`. Call `emitInflightTurnFromActiveTurn`. Assert wire emits include a `turn_complete { msg_id: "msg_X", result: "success", seq: <fresh> }` after the assistant_text. Pins the [DM06] crash-during-suppression mitigation for the success branch.
- [x] **Unit (in-flight emission, interrupted-true)**: install an active turn with `interrupted=true`. Assert wire emits include a `turn_cancelled { msg_id: "msg_X", partial_result: <text>, seq: <fresh> }` after the assistant_text. _Plus three additional pins: `signalEofToActiveTurn` honors suppressEmit on interrupted/unfinished turns; empty-partialText skips assistant_text; gotResult precedence over interrupted._
- [x] **Integration (full Smoke D, still-streaming turn)**: install active turn for a partial stream; call runReplay; drive more deltas via the mock claude stdout post-suppression; let the turn complete with a `result` event. Assert the final wire trace has exactly one bracket and exactly one TurnEntry's worth of events for the in-flight turn, all keyed by claude's id. The reducer's scratch ends as `<snapshot text>` + `<post-bracket deltas>` with no double-counting.
- [x] **Integration (claude crashes during suppressed window)**: install active turn; call runReplay; mid-iteration, close the mock claude stdout (simulating EOF). Assert: `signalEofToActiveTurn` runs but its writeLine is gated; `runReplay` proceeds to emit the synthesized block; the synthesized block includes a terminal event because `turn.interrupted` was set by the EOF path or `turn.gotResult` was set if claude completed before EOF. Assert the reducer commits one TurnEntry rather than dangling. _Deterministic timing for "EOF mid-suppress" is hard to script in Bun's microtask model; the unit-test branches (gotResult/interrupted terminal events on emit-inflight, signalEofToActiveTurn honors suppress) cover the logic. Plus an integration test for the still-live ordering pin and an integration test for "post-bracket live deltas land normally" backstop the suppress lifecycle._
- [x] **Integration (no active turn → no in-flight emission)**: regression-pin existing cold-boot replay path. Call runReplay with no active turn; assert no `emitInflightTurnFromActiveTurn` invocation; trailing-turn orphan synthesis fires as today.
- [x] **Failure-first proof (suppress gate)**: temporarily revert the `suppressEmit` checks so live events leak during the window. Run the integration test. Assert it fails because live deltas appear before/inside the bracket alongside the in-flight emission. Restore. _Verified: stripping the `if (!turn.suppressEmit)` guards (replace_all) breaks 2 of 4 suppress-gate unit tests with `Received length: 1` (cost_update / turn_complete leaked). Restored._
- [x] **Failure-first proof (in-flight emission)**: temporarily revert the `emitInflightTurnFromActiveTurn` call. Run the integration test. Assert it fails because the in-flight turn's user/assistant events are absent from the bracket. Restore. _Verified: stripping the call breaks both Smoke D integration tests (in-flight events absent). Restored._
- [x] **Failure-first proof (terminal event on crash)**: with the gotResult-true unit test, temporarily strip the terminal-event branches. Run the test. Assert it fails because no `turn_complete` was emitted. Restore. _Verified: stripping the gotResult/interrupted branches breaks 4 of 7 emit-inflight unit tests (gotResult, interrupted, interrupted-empty, gotResult-precedence). Restored._

**Tuglaws cross-check:**

- N/A — tugcode bridge subprocess; no React.

**Checkpoint:**

- [x] `bun test` (tugcode) — green; failure-first proofs both produce sensible diagnostics. _316 / 316 pass; 18 new tests added (13 in session.test.ts, 5 in replay-spawn-mid-turn.test.ts)._
- [x] `cargo nextest run` — green. _1221 / 1221 pass._
- [x] `just lint` — clean.

Workspace-wide regression check: `bun test` from repo root — 3365 / 3365 pass (was 3347 pre-Step-3, +18 new).

---

#### Step 4: End-to-end automated Smoke D test + manual verification {#step-4}

**Commit:** `tide(mid-turn): automated Smoke D test; manual verification`

**Depends on:** [Step 3](#step-3)

**References:** Full plan; closes [#exit-criteria].

**Artifacts:**

- `tugcode/src/__tests__/replay-spawn-mid-turn.test.ts` — promoted from the Phase 0 investigation test into a permanent regression test. Asserts the post-Step-3 contract: a mid-turn replay scenario produces exactly one TurnEntry with both user and assistant content, keyed by claude's id, with no duplicate row.
- `roadmap/tugplan-tide-mid-turn-replay.md` — close-out updates. Status flips to `shipped`. Phase 1 checkpoints all flipped to `[x]`. Verdicts archived (Phase 0 traces stay; section retitled to "historical").
- `roadmap/tugplan-tide-transcript-resume-smoke.md` (in archive) — Smoke D entry updated to "passes via mid-turn plan, see [tugplan-tide-mid-turn-replay.md]".

**Tasks:**

- [ ] Promote the investigation test to a permanent regression test (rename file, sharpen assertions, remove diagnostic prints).
- [ ] Manual verification: run a real session, submit a long-streaming turn, reload mid-stream, observe the card. Verify one TurnEntry, both halves of the content, no duplicate, no phantom interrupted row.
- [ ] Manual verification: cancel-during-mid-turn-replay edge case. Submit a turn, reload, cancel via existing UI, verify the truncated turn renders cleanly.
- [ ] Update the smoke checklist in `roadmap/archive/tugplan-tide-transcript-resume-smoke.md` to flip Smoke D to passing with a telemetry citation.
- [ ] Flip plan status to `shipped`.

**Tests:**

- [ ] Full-suite green: `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run`.
- [ ] The promoted Smoke D test runs deterministically green across N=20 sequential invocations (catches order-fragile assertions).

**Tuglaws cross-check:**

- N/A — test plumbing + doc updates.

**Checkpoint:**

- [ ] All check commands green.
- [ ] Manual Smoke D passes.
- [ ] Plan status: `shipped`.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Smoke D passes — mid-turn reload restores the transcript with the in-flight turn correctly attached, no events dropped, no manual recovery needed. Investigation harnesses ship as permanent regression tests; one promoted to the load-bearing Smoke D pin.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [x] Phase 0 investigation complete (four verdicts written, drop audit done).
- [x] Phase 1 design recorded as `[DM03]`–`[DM06]` decisions in this plan; spec written.
- [x] Step 1 (canonical msg_id): `ActiveTurn.msgId` is claude's `message.id`; live-emit integration test asserts every wire frame carries it; failure-first proof landed.
- [x] Step 2 (translator skip): `liveInflightMsgId` option implemented; both branches tested; cold-boot regression preserved; failure-first proof landed.
- [x] Step 3 (in-flight emission + suppress): `suppressEmit` field gates seven emit sites; `emitInflightTurnFromActiveTurn` ships; integration test asserts one bracket + one TurnEntry for the in-flight turn; both failure-first proofs landed.
- [ ] Step 4 (close-out): regression test promoted; Smoke D smoke-checklist entry passing; plan status `shipped`.
- [ ] Smoke D — mid-turn reload — passes manually.
- [ ] Smoke D — automated regression — passes deterministically.
- [ ] Drop audit's identified gaps closed (G1, G2, G3 by Phase 1 design; G4, G5 explicitly accepted as pathological-load-only with telemetry).
- [ ] HMR cycles during dogfooding don't lose conversation context (manual confirmation via the user's actual workflow).
- [ ] All check commands green: `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run`.

| Checkpoint | Verification |
|-|-|
| E1 verdict | `bun run tugcode/scripts/run-e1-batch.ts 10` + verdict in plan |
| E2 verdict | `bun test src/__tests__/replay-spawn-mid-turn.test.ts` |
| E3 verdict | `cargo nextest run --manifest-path tugrust/Cargo.toml -p tugcast --test e3_subscriber_buffering` + verdict in plan |
| E4 verdict | Drop-audit table in [#e4-drop-audit] |
| Step 1 unit + integration tests | `cd tugcode && bun test` |
| Step 2 translator tests | `cd tugcode && bun test src/__tests__/replay.test.ts` |
| Step 3 mid-turn integration test | `cd tugcode && bun test src/__tests__/replay-spawn-mid-turn.test.ts` |
| Step 4 promoted regression | Same test, asserted N=20 sequential green |
| Smoke D manual | User confirmation; not blocking ship if automated covers it |
| TS clean | `bun x tsc --noEmit` |
| Rust clean | `cargo nextest run` |
| Lint clean | `just lint` |

#### Roadmap / Follow-ons {#roadmap}

Items explicitly NOT required for Phase Close. Listed for future reference.

- [ ] **G4 — Spawning-queue overflow** (E4): the supervisor's per-session `BoundedQueue` (256-frame capacity) drops `request_replay` on overflow during cold-boot Spawning. Today logs `request_replay.skipped reason="spawning_queue_overflow"`. Pathological-load only; promote to a structured drop event if the count starts to matter.
- [ ] **G5 — Broadcast replay buffer eviction** (E4): the shared 1000-frame `ReplayBuffer` evicts oldest on overflow. A subscriber that lags long enough loses the oldest frames during their lag-recovery replay. Pathological-load only.
- [ ] **Per-session replay buffer** — if G5 ever bites, the design space includes a per-session ring buffer (instead of the shared one) so one chatty session can't evict another's recent history. Out of scope today; the shared buffer is sized comfortably for normal use.
- [ ] **Mid-tool-use reload** — when claude is mid-tool-use at reload, the in-flight emission needs to thread tool_use / tool_result events from the drain's per-turn tool record. Step 3's task list calls this out for implementation; if the drain's tool tracking turns out to be unstructured for direct emission, the emission path falls back to "user prompt + accumulated text only", and tool events arrive post-replay as live deltas. Document the limitation if encountered; fix is a follow-on.
- [ ] **Cross-machine session export / import** — the JSONL is per-machine; "open this conversation on another laptop" is much larger.
