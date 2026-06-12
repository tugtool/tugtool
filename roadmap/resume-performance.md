<!-- devise-skeleton v4 -->

## Resume Performance — Snappy Transcript Replay {#resume-performance}

**Purpose:** Make resuming a session feel instant: a medium session's transcript
(≈50 turns) fully rendered within a few hundred milliseconds of Open, with large
sessions degrading gracefully — measured first, optimized second, verified by an
app-test latency budget.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-06-11 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Resuming even a medium-length session (a couple dozen messages) takes several
seconds to paint the transcript. Investigation of the pipeline (2026-06-11)
located the costs structurally — **not** in JSON parsing (Bun parses hundreds of
KB in milliseconds):

1. **Per-entry pacing in tugcode.** `translateJsonlSession` yields the event loop
   every 16 entries via `setTimeout(0)` (`yieldToEventLoop` in
   `tugcode/src/replay.ts`; tests bypass it with `disableYield`), and `runReplay`
   writes **one IPC line per wire message**. The replay window was designed as a
   stream with a 10s hard budget (`REPLAY_HARD_TIMEOUT_MS`), not a bulk load.
2. **One websocket frame per message, one React commit per frame.** Each replayed
   line becomes its own CODE_OUTPUT frame through tugcast's merger, and tugdeck's
   `CodeSessionStore.dispatch` calls `notifyListeners()` after every
   state-changing frame (`code-session-store.ts`) — so a 50-turn replay is
   ~hundreds of reducer passes and React commits, each re-running markdown and
   highlight work for the rows it touches.
3. **Serial startup ahead of the first frame.** Open → `spawn_session` → tugcode
   process boot → synthetic `session_init` → `spawn_session_ok` → tugdeck
   constructs services → `request_replay` round-trip → translate begins. (The
   claude spawn itself is already off this path — the cold-boot order work made
   replay request-driven with claude spawning in the background.)

One architectural constraint discovered up front: **tugcast rewrites replayed
frames in flight** — the supervisor inlines persisted `turn_telemetry` onto
replayed `turn_complete` events, and the bridge merges persisted
`system_metadata` payloads. Any batching scheme must keep those per-line
intercepts working, which is why batching belongs in tugcast *after* the
intercepts, not in tugcode ([P03]).

#### Strategy {#strategy}

- **Measure before optimizing.** The first step instruments the pipeline end to
  end; every later stage is gated on what the numbers actually say ([P01]).
- **Fix the shape, not the parser.** The core bet is batching: translate without
  pacing, coalesce client-bound replay frames in tugcast, ingest each batch as
  one reducer fold and one React commit.
- **Batch at the tugcast→tugdeck edge.** tugcode keeps emitting lines (its local
  pipe is cheap and every existing tugcast intercept keeps working unchanged);
  tugcast coalesces the *client-bound* stream ([P03]).
- **Rust owns cache + orchestration; tugcode stays the only translator.** A
  `replay_cache` keyed `(size, mtime)` — the `external_scan_cache` pattern —
  plus pre-warming of recently-listed sessions, both gated on measured translate
  cost ([P05], [P06]).
- **Degrade gracefully at the whale end.** A 100MB session should stream visibly
  and stay responsive, not block; chunked batches keep the first paint early.

#### Success Criteria (Measurable) {#success-criteria}

- End-to-end stage timings (tugcode boot, file read, translate, last frame
  emitted, deck ingest done, last React commit) are recorded per resume in the
  session-lifecycle log and visible in TugDevPanel — verified by reading them off
  a real resume.
- Medium fixture (50 turns, ~500KB): transcript fully committed within **750ms**
  of the picker's Open click on the dev machine, asserted by app-test (a 2s hard
  ceiling guards CI variance; the telemetry numbers assert the tighter internal
  splits).
- Replay of the medium fixture produces **≤5 React commits** in tugdeck (down
  from one per message), asserted via the instrumentation counters in a
  pure-logic store test (batch → one notify) plus the app-test telemetry leg.
- A large session (≥50MB JSONL) shows its first transcript rows before
  translation finishes (chunked batches) and never trips `REPLAY_HARD_TIMEOUT_MS`
  on the dev machine.
- No behavioral regression: full existing replay test suites (tugcode, tugdeck,
  tugcast merger/supervisor) stay green; telemetry inlining and metadata merge
  still applied to replayed frames.

#### Scope {#scope}

1. Pipeline instrumentation (tugcode, tugcast, tugdeck) with stage timings.
2. Remove per-entry pacing from the replay translate loop.
3. tugcast replay batching: coalesce client-bound replayed frames into
   `replay_batch` frames after the existing intercepts.
4. tugdeck batch ingest: one reducer fold + one notify per batch.
5. Transcript render audit: defer off-screen markdown/highlight work if the audit
   shows eager mounting dominates.
6. (Gated) `replay_cache` sqlite table + tugcode cache read/write.
7. (Gated) Pre-warm translation of recently-listed sessions.
8. (Gated) Startup-path trims (tugcode boot, round-trip collapsing).
9. App-test latency budget.

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Porting `translateJsonlSession` to Rust.** tugcode remains the single
  translator ([P05] names the trigger that would reopen this).
- **Changing replay semantics** — what gets replayed (mid-turn pending rows,
  compaction handling, orphan synthesis) is untouched; only pacing, framing, and
  caching change.
- **Live-turn streaming performance.** This plan is about the replay window;
  live token streaming already renders incrementally by design.
- **Client-side transcript persistence.** No IndexedDB/localStorage; caching is
  server-side sqlite only.

#### Dependencies / Prerequisites {#dependencies}

- Session unification (landed `f5fc76c2`): the `external_scan_cache` pattern,
  cached scan plumbing, and `claude_project_dir` chokepoint the cache stages
  reuse.
- The request-driven replay order (`request_replay` verb, background claude
  spawn) in `tugcode/src/main.ts` / the supervisor.
- Existing instrumentation rails: `logSessionLifecycle` (tugcode + tugdeck),
  `tugDevLogStore` / TugDevPanel telemetry.

#### Constraints {#constraints}

- **Warnings are errors** (`-D warnings`) in the Rust workspace.
- New sqlite tables via `CREATE TABLE IF NOT EXISTS` only (no-migration policy).
- tugdeck state changes conform to tuglaws — notably [L02] (external state via
  `useSyncExternalStore`) for the batch ingest path; cross-check before the deck
  steps and name laws in commit messages.
- tugcode is a compiled binary — rebuild to test; tugdeck is HMR-live.
- Replayed-frame **intercepts must keep working**: telemetry inlining onto
  `turn_complete`, `system_metadata` merge, journal pending-row deletion.
- Wire compatibility during rollout: a deck that doesn't know `replay_batch`
  must not break — the batch frame ships behind a client-advertised capability
  or a tugcast config default that can be reverted ([P04]).

#### Assumptions {#assumptions}

- The dominant cost is deck-side per-frame commits (markdown/highlight × N
  messages), with translate pacing second — Step 1's numbers will confirm or
  reorder the later stages.
- A single websocket frame can safely carry a few hundred KB of batched payload
  (chunk cap verified against tugcast's frame limits during the batching step).
- `(file_size, file_mtime)` remains an exact validity key for append-only
  session JSONLs (same assumption the scan cache already relies on).

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses **explicit, named anchors** and **rich `References:` lines** in
execution steps, per `tuglaws/devise-skeleton.md`:

- Every heading cited elsewhere carries an explicit `{#anchor}` (kebab-case, no
  phase numbers).
- Plan-local design decisions are `[P##]` (`[D##]` is reserved for the global
  `tuglaws/design-decisions.md`); open questions `[Q##]`; specs `S##`; risks
  `R##`. Two digits, never reused.
- Execution steps cite plan artifacts by label and anchor — never line numbers —
  and declare ordering with `**Depends on:** #step-N` lines referencing real
  step anchors.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Where exactly does the replay window begin and end in tugcast? (DECIDED) {#q01-replay-window-markers}

**Question:** The merger/supervisor must know which client-bound frames are
"replay" (coalesce) vs live (forward immediately). `replay_complete` marks the
end; what marks the start, and is the marker visible at the coalescing point?

**Why it matters:** Batching must never delay live frames; a wrong window turns
a live turn into a laggy one.

**Resolution:** DECIDED — resolved by code survey (2026-06-11, vet pass). The
window is already first-class on the wire at every layer the coalescer needs:
tugcode emits `replay_started` before its first replayed message; the bridge
flips its replay-window flag on it (and builds its per-window telemetry index
there — `agent_bridge.rs`); the merger maintains a saturating open-window
counter incremented on `replay_started` and decremented on `replay_complete`
(`agent_supervisor.rs`, `LedgerEntry` replay-depth field); and the deck store
models a `replaying` phase off the same pair. #step-3 consumes the existing
markers — no wire changes are needed to detect the window.

#### [Q02] Are transcript rows virtualized, or do all rows mount eagerly? (OPEN → resolve in #step-1) {#q02-transcript-virtualization}

**Question:** `BlockHeightIndex` maps markdown block heights, but whether
`dev-card-transcript` defers off-screen row rendering is unconfirmed.

**Why it matters:** If every row mounts and parses markdown eagerly, batching
alone still pays the full render cost in one commit — better than N commits, but
the long-session tail then needs deferred rendering (#step-5).

**Plan to resolve:** #step-1's audit task answers this with the instrumentation
numbers (commit count × commit duration vs row count).

**Resolution:** OPEN (resolved by #step-1).

#### [Q03] Is cold translate cost ever the long pole? (OPEN → gates #step-6/#step-7) {#q03-translate-cost}

**Question:** With pacing removed and batching in place, does translate time as
a function of file size justify the cache + pre-warm stages?

**Why it matters:** The cache stages are real machinery; if translate of a p95
session is <100ms they're dead weight.

**Plan to resolve:** #step-1 instrumentation across small/medium/whale fixtures;
revisit after #step-4 lands.

**Resolution:** OPEN (gates #step-6 and #step-7; either may be closed as
"not needed" in the ledger with the measured numbers as rationale).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Batching breaks a replayed-frame intercept | high | med | Batch after intercepts in tugcast ([P03]); merger tests pin telemetry-inline + metadata-merge on batched replays ([R01]) | Any intercept test red |
| One giant batch commit jank on whales | med | med | Chunked batches (count/byte cap), first chunk flushes early ([R02]) | Whale fixture first-paint > 1s |
| Old/new wire mismatch during rollout | med | low | Capability-gated `replay_batch` with per-frame fallback ([P04]) | Mixed-version session breakage |
| Cache staleness vs rewrites (rewind truncates JSONL in place) | med | low | `(size, mtime)` key invalidates on any byte change — same contract the scan cache relies on ([R03]) | Stale transcript after rewind |
| Latency app-test flakes on CI variance | med | med | Generous hard ceiling + telemetry-split assertions instead of one tight wall-clock number ([R04]) | Flaky at0-test |

**Risk R01: Intercept regression under batching** {#r01-intercept-regression}

- **Risk:** Replayed `turn_complete` frames lose their inlined telemetry, or
  `system_metadata` loses its merge, once frames travel inside a batch.
- **Mitigation:** Coalescing happens strictly downstream of the supervisor's
  rewrite point; Rust tests assert a batched replay carries the inlined
  telemetry fields verbatim.
- **Residual risk:** A future intercept added upstream of the coalescer is
  unaffected by construction; one added downstream must handle batches — the
  coalescer's module docs say so loudly.

**Risk R02: Single-commit jank on very large sessions** {#r02-whale-jank}

- **Risk:** Folding 10k messages into one commit trades N small jank for one
  multi-second freeze.
- **Mitigation:** Chunked batches with a flush-early first chunk (fast first
  paint), subsequent chunks at animation-frame cadence; deferred off-screen row
  work (#step-5) bounds per-chunk render cost.
- **Residual risk:** Whales still cost what they cost; the budget only promises
  graceful streaming, not instant whales.

**Risk R03: Replay cache serves a stale transcript** {#r03-cache-staleness}

- **Risk:** A cached translation outlives an in-place JSONL rewrite (destructive
  rewind truncates the live file).
- **Mitigation:** `(size, mtime)` validity check on every read — identical to
  the scan cache contract that already guards the same files.
- **Residual risk:** Same-size same-mtime rewrites are theoretically possible
  and practically not (truncation changes size).

**Risk R04: Flaky latency assertions** {#r04-flaky-latency}

- **Risk:** Wall-clock budgets on a shared dev machine flake.
- **Mitigation:** App-test asserts a generous end-to-end ceiling (2s) plus the
  *internal* telemetry splits (translate ms, commit count) which are
  machine-load-insensitive; the tight 750ms number is a by-hand dev-machine
  criterion recorded in the checkpoint, not a CI gate.

---

### Design Decisions {#design-decisions}

#### [P01] Measurement gates every optimization stage (DECIDED) {#p01-measure-first}

**Decision:** #step-1 lands stage-timing instrumentation before any optimization;
#step-5 through #step-8 are explicitly gated on its numbers and may be closed as
"not needed" with the measurements as rationale.

**Rationale:**
- The investigation's cost ranking is structural inference, not measurement; the
  per-frame-commit hypothesis is strong but unproven.
- Instrumentation is permanently useful (TugDevPanel) and cheap.

**Implications:**
- The Step Status Ledger may legitimately end with gated steps marked
  `closed (not needed)` — that is success, not abandonment.

#### [P02] Translate runs unpaced; cooperative yield by time slice (DECIDED) {#p02-unpaced-translate}

**Decision:** `runReplay`'s translate loop drops the every-16-entries
`setTimeout(0)` pacing in favor of a coarse time-slice yield (only after ≥8ms of
continuous work), keeping the IPC pipe responsive on whales without taxing the
common case.

**Rationale:**
- `setTimeout(0)` is a ≥1ms macrotask delay; hundreds of entries pay hundreds of
  forced idle milliseconds for no responsiveness benefit at medium sizes.
- A time-slice yield preserves the original intent (pipe responsiveness during
  whale replays) at ~zero cost for medium sessions.

**Implications:**
- `disableYield` test option survives unchanged (it now bypasses the time-slice
  check).

#### [P03] Batching lives in tugcast, downstream of the intercepts (DECIDED) {#p03-batch-in-tugcast}

**Decision:** tugcode keeps emitting one IPC line per message; tugcast coalesces
*client-bound* replayed CODE_OUTPUT frames into `replay_batch` frames (chunked
by count/byte caps) strictly after the supervisor/bridge rewrites (telemetry
inlining, metadata merge, journal intercepts).

**Rationale:**
- tugcast actively rewrites replayed frames; batching upstream (in tugcode)
  would hide lines from those intercepts or force them all to learn the batch
  envelope.
- The tugcode→tugcast pipe is local and cheap; the expensive edge is
  tugcast→tugdeck framing plus the deck's per-frame work.
- Rust-side coalescing is the natural home for the later cache stage too —
  the batch payload is exactly what `replay_cache` would store.

**Implications:**
- New wire message `replay_batch` (Spec S01); the merger/supervisor learns the
  replay window ([Q01]).
- tugcode's only change in the batching stage is [P02] (pacing) and, if [Q01]
  requires it, a replay-start marker line.

#### [P04] `replay_batch` is capability-gated with per-frame fallback (DECIDED) {#p04-capability-gated}

**Decision:** tugcast emits `replay_batch` only when the connected client has
advertised support (or a tugcast default flag enables it); otherwise the
existing per-frame stream is preserved bit-for-bit.

**Rationale:**
- HMR/reload windows can pair an old deck with a new tugcast (and vice versa);
  a silent contract change bricks replay exactly when iterating on it.
- The fallback doubles as the instant rollback lever.

**Implications:**
- Capability rides the existing connection handshake; the fallback path stays
  tested (the legacy replay tests keep running against it).

#### [P05] tugcode remains the single translator; the Rust-port trigger is named (DECIDED) {#p05-single-translator}

**Decision:** `translateJsonlSession` stays the only JSONL→wire translator. Rust
owns caching and orchestration only. The trigger to revisit a Rust port: after
the cache + pre-warm stages, if **cold** translation of a p95 session still
exceeds ~500ms in Step-1 instrumentation and that cold path is user-visible
(cache misses on first resume of large sessions users actually open).

**Rationale:**
- The translator encodes a large body of surveyed JSONL lore (orphan synthesis,
  compaction markers, isMeta rules, TUI record types); two implementations
  drift, and drift here corrupts transcripts silently.
- Caching makes the hot path translation-free regardless of language.

**Implications:**
- Any future port must come with a shared golden-fixture suite both translators
  pass before the Rust one ships.

#### [P06] Replay cache stores the translated stream, keyed (size, mtime), written and read by tugcode (DECIDED, gated by [Q03]) {#p06-replay-cache}

**Decision:** A `replay_cache` table in tugcast's sqlite (same db, same
no-migration bootstrap as `external_scan_cache`) stores tugcode's translated
wire-message stream per session, keyed by session id and validated by
`(file_size, file_mtime)`. tugcode writes it after a cold translate and reads it
instead of re-translating on a hit (via its existing cross-process `bun:sqlite`
handle). Pre-warming (#step-7) populates it for recently-listed sessions via a
translate-only tugcode invocation orchestrated by tugcast.

**Rationale:**
- Caching the *pre-intercept* translated stream keeps telemetry/metadata
  inlining live on every serve — cached payloads never go stale against ledger
  state, only against file bytes (which the key covers).
- tugcode reading/writing keeps the single-translator rule ([P05]) intact;
  tugcast never interprets transcript content.

**Implications:**
- Cache rows can be large (MBs for whales) — a per-row size cap and a total-size
  sweep policy land with the table.
- The pre-warm invocation is a new headless tugcode mode (`--translate-only`),
  budgeted and concurrency-capped by the supervisor.

---

### Specification {#specification}

**Spec S01: `replay_batch` wire frame** {#s01-replay-batch}

A CODE_OUTPUT frame whose payload is:

```json
{ "type": "replay_batch", "tug_session_id": "...", "seq": 1, "final": false,
  "messages": [ { ...wire message... }, ... ] }
```

- `messages` preserves the exact per-frame payloads (post-intercept) in emission
  order — a client folding them one-by-one must produce a state identical to the
  legacy stream.
- Chunk caps: ≤256 messages and ≤512KB serialized per frame (verified against
  tugcast frame limits in #step-3); the first chunk flushes as soon as it fills
  *or* 32 messages arrive, whichever is first, for early first paint.
- **Flush triggers — no frame is ever held hostage.** A pending (partial) batch
  flushes on the first of: chunk cap reached; `replay_complete` observed;
  **window abort** (the replay window closes without `replay_complete` — tugcode
  exit/crash mid-replay, which the merger's saturating window counter already
  detects); or a **max-hold timer (~50ms)** since the batch's first message, so
  a stalled translate never delays already-emitted frames.
- `replay_complete` still travels as its own frame after the last batch
  (`final: true` is advisory).

**Spec S02: Stage-timing instrumentation points** {#s02-timings}

| Stage | Where | Emitted as |
|-------|-------|-----------|
| tugcode boot → ready | tugcode main | `logSessionLifecycle("perf.boot", {ms})` |
| `request_replay` received | tugcode | `perf.replay_requested` |
| JSONL read | tugcode runReplay | `perf.replay_read` `{ms, bytes, lines}` |
| translate + emit | tugcode runReplay | `perf.replay_translate` `{ms, messages}` |
| coalesce + forward | tugcast replay path | tracing + frame-count counter |
| first/last batch ingested | tugdeck store | `perf.replay_ingest` `{ms, frames, commits}` |
| last React commit | tugdeck transcript | `perf.replay_render` `{ms, rows}` |

All deck-side numbers also land in `tugDevLogStore` so TugDevPanel shows a
per-resume waterfall. The store counts its own `notifyListeners` calls between
replay start and `replay_complete` — that counter is the "≤5 commits" assertion
surface.

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone (appearance / local-data / structure) | Mechanism | Law |
|-------|--------------------------------------------|-----------|-----|
| Batched replay ingest | external state (server frames) | existing `CodeSessionStore` reducer; batch = loop of existing events with deferred notify, one `useSyncExternalStore` tick | [L02] |
| Replay perf counters | external state (diagnostics) | `tugDevLogStore` / telemetry store (existing) | [L02] |
| Deferred off-screen row rendering (#step-5, if needed) | appearance/structure per audit | CSS/content-visibility or windowing at the list layer — decided by the audit, named in that step's commit | [L06], [L24] |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (bun, pure logic)** | Translate-loop pacing, batch fold = N single folds (state equivalence), notify counting | tugcode + tugdeck stores, no DOM |
| **Unit (Rust)** | Coalescer chunking, intercept preservation on batched frames, replay_cache validity/sweep | tugcast merger/supervisor/ledger |
| **Golden / Contract** | Batched stream folds to identical store state as legacy stream | shared fixture, both paths |
| **App-test** | End-to-end latency budget + telemetry splits on medium fixture; whale first-paint leg | `just app-test` |

#### What stays out of tests {#test-non-goals}

- Mock-store call-count tests — the commit counter is real store
  instrumentation, asserted through the real reducer, not a hand-rolled mock.
- Fake-DOM render timing — render cost is measured in the app-test against the
  real app; no jsdom substitutes.
- Tight wall-clock CI gates — see [R04]; CI asserts ceilings and internal
  splits, the tight target is a dev-machine checkpoint.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Pipeline instrumentation + baseline numbers | pending | — |
| #step-2 | Unpaced translate loop | pending | — |
| #step-3 | tugcast replay coalescer (`replay_batch`) | pending | — |
| #step-4 | tugdeck batch ingest, single commit | pending | — |
| #step-5 | Transcript render audit + deferred off-screen work (gated) | pending | — |
| #step-6 | replay_cache table + tugcode read/write (gated) | pending | — |
| #step-7 | Pre-warm recently-listed sessions (gated) | pending | — |
| #step-8 | Startup-path trims (gated) | pending | — |
| #step-9 | App-test latency budget | pending | — |
| #step-10 | Integration checkpoint | pending | — |

#### Step 1: Pipeline instrumentation + baseline numbers {#step-1}

**Commit:** `Instrument the resume replay pipeline end to end`

**References:** [P01] Measure first, Spec S02, [Q02], [Q03], (#context, #s02-timings)

**Artifacts:**
- Stage-timing emissions at every Spec S02 point (tugcode, tugcast tracing,
  tugdeck store + transcript)
- Store-level notify/commit counter scoped to the replay window
- A baseline table (small / medium / whale fixture timings) recorded in this
  plan under a `#baseline-numbers` anchor, answering [Q02] (commit count vs row
  count) and seeding [Q03]

**Tasks:**
- [ ] Emit Spec S02 timings via `logSessionLifecycle` / tracing / `tugDevLogStore`
- [ ] Count store notifies between replay start and `replay_complete`
- [ ] Audit transcript mounting (eager vs deferred) and record the answer to [Q02]
- [ ] Resume three fixtures (small ~10 turns, medium ~50 turns/500KB, whale ≥50MB) and record the waterfall in the plan

**Tests:**
- [ ] Pure-logic: the notify counter increments per notify and resets per replay window
- [ ] tugcode unit: perf lines emitted with plausible (>0) values during a fixture replay

**Checkpoint:**
- [ ] `cd tugcode && bun test` and `cd tugdeck && bun test && bunx tsc --noEmit`
- [ ] Baseline table committed into the plan with real numbers

---

#### Step 2: Unpaced translate loop {#step-2}

**Depends on:** #step-1

**Commit:** `Replace per-16-entries replay pacing with a time-slice yield`

**References:** [P02] Unpaced translate, (#q03-translate-cost, #s02-timings)

**Artifacts:**
- `translateJsonlSession` yields only after ≥8ms of continuous work
- Before/after translate timings for the three fixtures appended to the baseline table

**Tasks:**
- [ ] Swap the batch-count yield for a time-slice check; keep `disableYield` semantics
- [ ] Re-measure the fixtures

**Tests:**
- [ ] Existing replay suites green unchanged (pacing is invisible to outputs)
- [ ] Pure-logic: yield fires under a forced-slow clock, not for fast medium runs

**Checkpoint:**
- [ ] `cd tugcode && bun test`
- [ ] Medium-fixture translate time drops in the recorded numbers

---

#### Step 3: tugcast replay coalescer (`replay_batch`) {#step-3}

**Depends on:** #step-1

**Commit:** `Coalesce replayed frames into replay_batch after the supervisor intercepts`

**References:** [P03] Batch in tugcast, [P04] Capability gate, Spec S01, [Q01], Risk R01, Risk R02, (#s01-replay-batch)

**Artifacts:**
- Replay-window detection in the merger using the existing `replay_started` /
  `replay_complete` markers and the merger's open-window counter ([Q01])
- Coalescer with Spec S01 chunk caps, early first flush, and the full flush-
  trigger set (cap / `replay_complete` / window abort / ~50ms max-hold timer),
  strictly downstream of telemetry-inline / metadata-merge
- Capability gate with bit-exact per-frame fallback

**Tasks:**
- [ ] Wire the coalescer to the existing window markers; document the window
      contract — and the "intercepts upstream, coalescing downstream" rule —
      in the coalescer's module docs
- [ ] Implement chunking + every Spec S01 flush trigger (cap, `replay_complete`,
      window abort via the merger's window counter, max-hold timer)
- [ ] Implement the capability gate; verify the 512KB cap against tugcast frame limits
- [ ] Keep `replay_complete` as its own frame

**Tests:**
- [ ] Rust: batched replay preserves inlined telemetry fields and merged metadata verbatim (R01 pin)
- [ ] Rust: chunk caps respected; first chunk flushes early; live frames after `replay_complete` are never batched
- [ ] Rust: a partial batch flushes on `replay_complete`; a window that aborts without `replay_complete` (subprocess death mid-replay) flushes the pending buffer rather than dropping it
- [ ] Rust: a stalled window (no new messages, no completion) flushes the pending batch within the max-hold bound
- [ ] Rust: capability-absent client receives the legacy stream bit-for-bit

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 4: tugdeck batch ingest, single commit {#step-4}

**Depends on:** #step-3

**Commit:** `Ingest replay_batch as one reducer fold and one notify (L02)`

**References:** [P03], [P04], Spec S01, Spec S02, (#state-zone-mapping, #success-criteria)

**Artifacts:**
- `replay_batch` protocol type + capability advertisement on the connection handshake
- Store folds a batch through the existing reducer with notifies deferred to one tick
- Commit counter shows ≤5 commits for the medium fixture

**Tasks:**
- [ ] Protocol type + guard; advertise the capability
- [ ] Batch fold with single notify; cross-check tuglaws and name [L02] in the commit
- [ ] Re-measure the fixtures; update the baseline table

**Tests:**
- [ ] Golden: folding a batched stream yields a store state deep-equal to folding the same messages per-frame (contract test on a shared fixture)
- [ ] Pure-logic: one notify per batch frame; counter assertion for the medium fixture

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx tsc --noEmit`
- [ ] Recorded medium-fixture commit count ≤5 and ingest+render time materially down

---

#### Step 5: Transcript render audit + deferred off-screen work (gated) {#step-5}

**Depends on:** #step-4

**Commit:** `Defer off-screen transcript row rendering` *(or close as not-needed with numbers)*

**References:** [P01], [Q02], Risk R02, (#state-zone-mapping, #q02-transcript-virtualization)

**Artifacts:**
- Either: deferred rendering for off-screen rows (mechanism per the audit — content-visibility / windowing at the list layer, leaning on `BlockHeightIndex` estimates), or a ledger entry closing this step with the Step-4 numbers as rationale

**Tasks:**
- [ ] Decide from the #step-4 re-measurement whether single-commit render cost still breaches the medium budget or whale first-paint
- [ ] If proceeding: implement, name the tuglaws zones touched, re-measure

**Tests:**
- [ ] If proceeding: pure-logic tests for the windowing/height math; behavior to the app-test

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx tsc --noEmit`; numbers recorded either way

---

#### Step 6: replay_cache table + tugcode read/write (gated) {#step-6}

**Depends on:** #step-2, #step-3

**Commit:** `Cache translated replay streams keyed by (size, mtime)` *(or close as not-needed)*

**References:** [P05] Single translator, [P06] Replay cache, [Q03], Risk R03, (#p06-replay-cache)

**Artifacts:**
- `replay_cache` table (CREATE IF NOT EXISTS; per-row size cap; total-size sweep) in tugcast's sqlite
- tugcode writes after cold translate, reads on `(size, mtime)` hit via its existing bun:sqlite handle

**Tasks:**
- [ ] Gate check: proceed only if [Q03]'s numbers show cold translate as a user-visible cost
- [ ] Table + ledger methods (Rust) mirroring the scan-cache shape; sweep policy
- [ ] tugcode cache path; cold path unchanged

**Tests:**
- [ ] Rust: validity key, size cap, sweep
- [ ] tugcode pure-logic: hit skips translate (counter), miss writes back; stale `(size, mtime)` re-translates (R03 pin)

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast && cd ../tugcode && bun test`

---

#### Step 7: Pre-warm recently-listed sessions (gated) {#step-7}

**Depends on:** #step-6

**Commit:** `Pre-warm replay translations for recently listed sessions` *(or close as not-needed)*

**References:** [P06], [Q03], (#p06-replay-cache, #strategy)

**Artifacts:**
- Headless `--translate-only` tugcode mode (read JSONL → write replay_cache → exit)
- Supervisor pre-warm after `list_sessions`: top-N most-recent uncached sessions, concurrency-capped, cancellable

**Tasks:**
- [ ] Gate check (same numbers as #step-6, plus observed cache-miss rate on first resumes)
- [ ] Translate-only mode; supervisor orchestration with caps

**Tests:**
- [ ] Rust: pre-warm respects concurrency cap and skips cached/oversized sessions
- [ ] tugcode: translate-only writes a valid cache row and exits cleanly

**Checkpoint:**
- [ ] Full `cargo nextest run -p tugcast` + `bun test`; a listed-then-resumed fixture hits the cache (telemetry shows translate ms ≈ 0)

---

#### Step 8: Startup-path trims (gated) {#step-8}

**Depends on:** #step-1

**Commit:** `Trim resume startup latency ahead of the first replay frame` *(or close as not-needed)*

**References:** [P01], Spec S02, (#context, #success-criteria)

**Artifacts:**
- Whatever the boot/round-trip numbers justify — candidates: collapsing the `spawn_session_ok` → `request_replay` round-trip (supervisor auto-queues replay for resume spawns), tugcode boot trims — chosen and documented against the measurements

**Tasks:**
- [ ] Gate check on Step-1's boot + round-trip splits
- [ ] Implement the winning trim(s); re-measure

**Tests:**
- [ ] Suites green; replay request semantics preserved (HMR remount re-replay still works)

**Checkpoint:**
- [ ] Recorded first-frame latency drop, or the step closed with numbers

---

#### Step 9: App-test latency budget {#step-9}

**Depends on:** #step-2, #step-4

**Commit:** `app-test: resumed medium session renders within the latency budget`

**References:** Spec S01, Spec S02, Risk R04, (#success-criteria, #test-non-goals)

**Artifacts:**
- App-test seeding a medium TUI-shaped fixture (≈50 turns / 500KB — generator shared with at0181's builder), resuming it, asserting: full transcript rendered under the 2s hard ceiling; telemetry splits (translate ms, ingest commits ≤5) within budget; whale leg asserting first rows paint before `replay_complete`
- The 750ms dev-machine number recorded in the checkpoint run

**Tasks:**
- [ ] Fixture generator; resume flow per at0181's proven path
- [ ] Read the perf telemetry back out of the page (TugDevPanel store) for the split assertions

**Tests:**
- [ ] The app-test itself, ending with the greppable `VERDICT: PASS|FAIL` line

**Checkpoint:**
- [ ] `just app-test <file>` → `VERDICT: PASS`, with the dev-machine wall time noted in the ledger

---

#### Step 10: Integration checkpoint {#step-10}

**Depends on:** #step-2, #step-4, #step-9

**Commit:** `N/A (verification only)`

**References:** [P01]–[P06], (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify the full surface together, including gated steps' close-out rationales; confirm the legacy per-frame fallback still passes the replay suites

**Tests:**
- [ ] Full suites green

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run`
- [ ] `cd tugdeck && bun test && bunx tsc --noEmit`
- [ ] `cd tugcode && bun test`
- [ ] `just app-test <latency test>` → `VERDICT: PASS`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Resume replay measured end to end and restructured from
per-message streaming to batched bulk delivery — medium sessions render in a few
hundred milliseconds, whales stream gracefully, and the cache/pre-warm machinery
exists exactly where the measurements justify it.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Per-resume stage waterfall visible in TugDevPanel (Spec S02)
- [ ] Medium fixture: ≤5 deck commits and the app-test budget green (#step-9)
- [ ] Whale fixture: first rows before translation completes; no `REPLAY_HARD_TIMEOUT_MS` trips
- [ ] Replayed-frame intercepts (telemetry inline, metadata merge) pinned green under batching
- [ ] Every gated step either landed or closed in the ledger with measured rationale
- [ ] Legacy per-frame fallback still fully green (rollback lever intact)

**Acceptance tests:**
- [ ] `cargo nextest run` green with `-D warnings`
- [ ] `bun test` (tugdeck, tugcode) green
- [ ] Latency app-test `VERDICT: PASS`

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Rust port of the translator — only if the [P05] trigger fires
- [ ] Replay-cache reuse for the rewind sheet's transcript preview
- [ ] Extending the perf waterfall to live-turn streaming metrics

| Checkpoint | Verification |
|------------|--------------|
| Rust suites | `cd tugrust && cargo nextest run` |
| Frontend suites | `cd tugdeck && bun test && bunx tsc --noEmit` |
| Bridge suite | `cd tugcode && bun test` |
| End to end | `just app-test` latency test → `VERDICT: PASS` |
