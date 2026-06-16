<!-- devise-skeleton v4 -->

## Batch-the-wire transcript loading {#phase-batch-wire}

**Purpose:** Make cold transcript loads (resume + load-previous) fast by shipping the replay through the IPC pipe in coarse batches instead of one tiny delta frame at a time, and by dropping the 8ms live-streaming pacing on the cold path — without touching the reducer, the live-streaming path, or the rendered result.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-06-16 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The IPC pipe between tugcode and tugdeck was built for **live streaming**: a remote model dribbles tokens, each delta becomes a discrete IPC frame that propagates immediately for live feel. On a **cold load** we already have the whole session on disk, yet `translateJsonlSession` re-atomizes it into the *same* per-delta frames a live model would have produced, paces them at 8ms (`DEFAULT_TIME_SLICE_MS`), and pushes each one through four process boundaries individually: a serialized `Bun.write` syscall (tugcode `ipc.ts`), a `read_line`/splice/`Frame::new`/broadcast hop (tugcast), one WebSocket message, and one browser decode+dispatch.

Instrumentation on session `c53db98c` (added in the measurement pass, `perf.replay_ingest`) settled where the cost actually is:

```
ms: 278   frames: 2084   dispatchMs: 3   reduceMs: 2   waitMs: 275
```

The browser folded all **2084 deltas in 2ms**. The reducer is essentially free; **99% of the ingest window (275ms of 278ms) is the browser sitting idle waiting for frames to trickle in.** The waste is entirely in *moving* the frames one-at-a-time and the pacing — not in the delta representation. This plan attacks exactly that: collapse the per-frame transport, drop the cold-path pacing. The rendered transcript and the reducer logic are untouched.

#### Strategy {#strategy}

- **Batch the wire, not the semantics.** The translator still produces the identical frame sequence; we only change *how many wire lines* carry it. A `replay_batch` envelope packs N frames into one IPC line.
- **tugcast needs zero changes.** `splice_tug_session_id` stamps the *outer* object's first field, and the CODE_OUTPUT relay forwards lines transparently — a batch envelope rides through unmodified.
- **The batch is a transport wrapper, not a reducer event.** It is unwrapped at the browser's FeedStore ingest boundary; each inner frame flows through the existing `frameToEvent` + `dispatch` path exactly as today. The reducer never learns batching exists.
- **Land the browser unwrap first** (backward-compatible), *then* the tugcode batching — so no version-skew window where a `replay_batch` frame reaches a browser that can't unwrap it.
- **De-pace the cold path only.** Drop the generator's 8ms macrotask yields when there is no live in-flight turn (`inflight === null`); let the consumer pace at batch granularity so abort/IO still get serviced.
- **Verify against the existing perf instrumentation.** Success is `waitMs` collapsing and tugcode's emitted wire-frame count dropping ~2084 → ~10, with the browser's dispatched-frame count unchanged (no semantic loss).

#### Success Criteria (Measurable) {#success-criteria}

- On reload of a real ≥50-turn session (e.g. `c53db98c`), `perf.replay_ingest.waitMs` drops from ~275ms to **< 50ms** (dev-panel, source `perf`).
- tugcode `perf.replay_translate.batches` (wire lines emitted) is **≈ ⌈content-frames / REPLAY_BATCH_SIZE⌉ + brackets** (~10 for this session), down from ~2084 individual `writeLine` calls.
- Browser `perf.replay_ingest.frames` (dispatched reducer events) is **unchanged** (~2084) — proves the batch carries every frame, no loss.
- The rendered transcript is byte-identical: turn count and content match the per-frame path (golden/contract replay tests stay green).
- Cancelling a load mid-flight still closes the bracket cleanly (`replay_complete{aborted:true}`) — no abort regression.

#### Scope {#scope}

1. A `replay_batch` outbound wire type in tugcode and the emit-loop refactor that buffers replay frames and flushes them as batches.
2. Cold-path de-pacing (`disableYield` for `inflight === null`) with batch-granular cooperative yielding in the consumer.
3. The browser-side unwrap at the FeedStore ingest boundary (`onFeedStoreChange` + `_ingestFrameForTest`), routing inner frames through the existing dispatch.
4. Perf-line additions so the win is measurable (tugcode `batches`/`frames`; the browser side already reports `waitMs`).

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Render cost.** The ~665ms `perf.replay_render` for 46 rich rows is downstream of the store and identical under this change; it is a separate investigation.
- **The live-streaming path.** Live deltas are inherently incremental and are never batched; this plan only touches the JSONL replay loop.
- **Approach C (hydrate-don't-replay).** Forking restore onto a finished-turn data path is explicitly *not* this plan; the 2ms reduce number shows delta-folding isn't the cost, so replay stays.
- **Mid-stream-reload de-pacing.** Batching applies to all replays, but de-pacing is gated to cold (`inflight === null`); the live-tail interleaving case keeps today's pacing.

#### Dependencies / Prerequisites {#dependencies}

- The `perf.replay_ingest` (browser) and `perf.replay_translate` (tugcode) instrumentation from the measurement pass — already on main.
- tugcode is a bun-compiled binary (no HMR): batching steps require `bun build --compile … --outfile tugrust/target/debug/tugcode` before they take effect in a running app.

#### Constraints {#constraints}

- **Warnings are errors** across the Rust workspace; tugdeck must pass `bunx tsc --noEmit` clean.
- tugdeck laws apply to `code-session-store.ts`: external state still enters React through the store's `useSyncExternalStore` contract ([L02]); the change is in the store's wire-ingest routing, adds no new React state.
- The `writeTail` serialization in `ipc.ts` must remain the single ordering authority — a batch is one large line and must not interleave with other writes.

#### Assumptions {#assumptions}

- The FeedStore delivers CODE_OUTPUT frames **per-frame, synchronously** (`feed-store.ts`: each `onFrame` sets the map and notifies listeners inline) — so unwrapping a batch into N synchronous dispatches preserves ordering and loses nothing.
- `splice_tug_session_id` stamps only the outer object; inner frames of a batch carry no `tug_session_id` and don't need one (the session filter runs on the outer envelope at the feed boundary, before unwrap).
- BATCH_SIZE in the low hundreds keeps any single batch line well-bounded; the existing `writeTail` already handles >64KiB lines without interleave.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

Anchors are explicit, kebab-case, no phase numbers. Plan-local decisions are `[P01]`+ (never `[D01]`). Steps cite decisions/specs/anchors, never line numbers.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Single-frame flush: raw frame or 1-element envelope? (DECIDED) {#q01-single-frame-flush}

**Question:** When the buffer holds exactly one frame at a flush point (notably the bracket frames `replay_started` / `replay_complete`), do we emit it as a raw frame or wrap it in a 1-element `replay_batch`?

**Why it matters:** The browser mounts the replay paint gate on `replay_started` and flushes the fold on `replay_complete`; burying either inside a batch (or behind bulk content) delays the gate. Raw brackets also keep the wire shape for the common bracket frames identical to today, narrowing the blast radius.

**Resolution:** DECIDED (see [P03]). Flush emits a raw frame when the buffer holds one frame, and a `replay_batch` envelope only for ≥2 frames. Brackets are flushed standalone, so they always go raw.

#### [Q02] De-pacing mechanism: `disableYield` vs. large `timeSliceMs`? (DECIDED) {#q02-depace-mechanism}

**Question:** To drop the 8ms macrotask yields on the cold path, pass `disableYield: true` to `translateJsonlSession`, or pass a large `timeSliceMs`?

**Why it matters:** `disableYield: true` removes the generator's internal `await yieldToEventLoop()` entirely; the consumer's per-frame `Promise.race` (a microtask) still runs, so abort/timeout stay responsive, and the consumer's per-batch macrotask yield drains writes. A large `timeSliceMs` keeps the same machinery but rarely fires — strictly weaker and less explicit.

**Resolution:** DECIDED (see [P05]). Use `disableYield: true` for `inflight === null`; the consumer owns pacing at batch granularity.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Version skew: new binary emits `replay_batch` to a browser without unwrap | high | med | Land browser unwrap first; unwrap is backward-compatible | Any deploy where the binary is newer than the frontend |
| Bracket/fold timing: gate mounts late if `replay_started` is batched | med | low | Flush brackets as raw standalone frames ([P03]) | Replay paint gate visibly delayed |
| Abort responsiveness drops with de-pacing | med | low | Keep per-frame `Promise.race`; flush + yield per batch | A mid-load cancel hangs |
| Oversized batch line | low | low | Bound batch by frame count (REPLAY_BATCH_SIZE); `writeTail` already serializes >64KiB | Wire corruption / latency spike on image-heavy replays |

**Risk R01: version skew between binary and frontend** {#r01-version-skew}

- **Risk:** tugcode (new) emits `replay_batch`; tugdeck (old) has no unwrap → `frameToEvent` rejects the unknown `type`, the frame is dropped, the transcript loads empty.
- **Mitigation:** Step ordering — the browser unwrap ([#step-1]) lands before tugcode batching ([#step-2]). The unwrap is purely additive: single frames still take the existing path, so an old binary against a new frontend also works.
- **Residual risk:** None within this repo's ship model (frontend HMR updates first; binary requires an explicit rebuild that the implement flow performs after Step 1).

**Risk R02: bracket and fold timing** {#r02-bracket-timing}

- **Risk:** The browser mounts the paint gate on `replay_started` and flushes deferred notifications on `replay_complete`; packing either into a bulk batch delays first paint or the final flush.
- **Mitigation:** [P03] — brackets flush standalone as raw frames; only the bulk content between them batches.
- **Residual risk:** The gate now mounts when the first wire line arrives, which is already near-instant on a fast load.

**Risk R03: abort granularity** {#r03-abort-granularity}

- **Risk:** Removing the 8ms yields could starve the abort/timeout race.
- **Mitigation:** The consumer keeps `await Promise.race([iter.next(), timeout, abort])` per frame (microtask-cheap) and adds one macrotask yield per batch flush so writes drain.
- **Residual risk:** Abort is now observed at batch boundaries (~REPLAY_BATCH_SIZE frames) rather than every 8ms — acceptable because the whole replay completes in tens of ms.

---

### Design Decisions {#design-decisions}

#### [P01] The batch is a transport envelope, not a reducer event (DECIDED) {#p01-transport-envelope}

**Decision:** `replay_batch` is unwrapped at the browser's FeedStore ingest boundary; each inner frame is routed through the unchanged `frameToEvent` + `dispatch` path. The reducer, the event union, and `KNOWN_CODE_OUTPUT_TYPES` (which gates *single-frame* reducer events) are not extended with a batch event.

**Rationale:**
- The measurement (`reduceMs: 2` for 2084 frames) proves delta-folding is free; there is no reason to change reducer semantics.
- Keeping the unwrap at the wire boundary means restore stays the single unified delta path that live streaming also uses — batching is invisible above the FeedStore.

**Implications:**
- The unwrap lives in `onFeedStoreChange` and `_ingestFrameForTest` (a shared `routeFrame` helper), not in `frameToEvent`.
- The reducer's replay fold and phase guards operate on dispatched inner events exactly as today.

#### [P02] tugcast is unchanged (DECIDED) {#p02-tugcast-unchanged}

**Decision:** No Rust changes. The batch envelope `{"type":"replay_batch","frames":[…]}` is relayed as an ordinary CODE_OUTPUT line.

**Rationale:**
- `splice_tug_session_id` scans for the first `{` and stamps `tug_session_id` as the outer object's first field — it operates on whatever JSON line tugcode emits, batch or not.
- The CODE_OUTPUT relay forwards lines verbatim; it never inspects `type`.

**Implications:**
- Fewer wire frames also reduces broadcast-channel lag pressure (`LagPolicy::Replay`) on slow clients — a free side benefit, not a goal.

#### [P03] Brackets flush raw; only bulk content batches (DECIDED) {#p03-brackets-raw}

**Decision:** `replay_started`, `replay_complete`, and any single-frame flush go out as raw frames; a `replay_batch` envelope is emitted only for ≥2 buffered frames.

**Rationale:** Preserves the browser's paint-gate mount on `replay_started` and the fold flush on `replay_complete`, and keeps the bracket wire shape identical to today.

**Implications:** The emit helper checks buffer length at flush; pending-row synthetics (injected right after `replay_started`) buffer with the following content rather than forcing the bracket into a batch.

#### [P04] Browser unwrap ships before tugcode batching (DECIDED) {#p04-order-unwrap-first}

**Decision:** Implement and land the browser unwrap ([#step-1]) before the tugcode emit batching ([#step-2]).

**Rationale:** Eliminates any window where a `replay_batch` frame reaches a browser that drops unknown types (R01). The unwrap is backward-compatible with the current per-frame emitter.

**Implications:** No feature flag or IPC-version gate is needed for the batch type.

#### [P05] De-pace cold replay only, consumer-driven (DECIDED) {#p05-depace-cold}

**Decision:** Pass `disableYield: true` to `translateJsonlSession` when `inflight === null`; the consumer flushes a batch and yields to the event loop once per batch. Mid-stream reload (`inflight !== null`) keeps today's pacing.

**Rationale:** The cold path is the measured case and has no live-drain interleaving. The consumer's per-frame `Promise.race` keeps abort responsive; a per-batch macrotask yield drains `writeTail`.

**Implications:** Pacing authority moves from the generator's 8ms timer to the consumer's batch cadence on the cold path.

#### [P06] REPLAY_BATCH_SIZE = 256 frames, count-thresholded (DECIDED) {#p06-batch-size}

**Decision:** Flush when the buffer reaches `REPLAY_BATCH_SIZE` (256) frames or at a bracket. The constant is a single named value, tunable later against real sessions.

**Rationale:** 256 collapses this session's ~2084 frames into ~8 batches + brackets while keeping each batch line bounded.

**Implications:** A follow-on may add a byte-size cap if image-heavy batches prove large; not needed for phase close.

---

### Deep Dives (Optional) {#deep-dives}

#### Emit-side batching flow (tugcode) {#emit-flow}

The replay consumer loop in `SessionManager` (the `while (true)` racing `iter.next()` against timeout/abort/exit) currently calls `writeLine(msg)` per frame. The refactor introduces a frame buffer and a `flushBatch` closure:

- **Buffer + flush.** `flushBatch()` is a no-op on an empty buffer; emits the lone frame raw when length === 1; otherwise emits `{ type: "replay_batch", frames: <buffered>, ipc_version: <IPC_VERSION> }` and clears the buffer ([P03], [P06]).
- **Content frames.** Replace the per-frame `writeLine(msg)` with `buffer.push(msg)`; call `flushBatch()` when `buffer.length >= REPLAY_BATCH_SIZE`, then `await yieldToEventLoop()` so the write drains and abort can win ([P05], [R03]).
- **`replay_started`.** Buffer is empty at this point (it's the first frame); push it and `flushBatch()` immediately so the gate mounts raw, *then* run the pending-row injection.
- **Pending-row synthetics.** `injectPendingRowSynthetics` currently writes directly; thread the buffer's emit through it (accept an emit callback, or push into the shared buffer) so synthetics land in order, batched with the content that follows.
- **`replay_complete`.** Flush the buffer first, then `writeLine` the buffered `replay_complete` raw — it stays the last line and triggers the browser fold flush.
- **Loop exit / finally.** Flush any remainder before the `perf.replay_translate` log.

`perf.replay_translate` gains `batches` (wire lines emitted) alongside a renamed `frames` (inner frames) so the wire-frame collapse is directly measurable; `drain_ms` (added in the measurement pass) already reports flush time.

#### Browser unwrap flow (tugdeck) {#unwrap-flow}

`CodeSessionStore.onFeedStoreChange` iterates changed feeds and calls `frameToEvent` + `dispatch` per feed value. Introduce a private `routeFrame(feedId, value)` used by both `onFeedStoreChange` and `_ingestFrameForTest`:

```
private routeFrame(feedId, value) {
  if (feedId === FeedId.CODE_OUTPUT &&
      (value as { type?: string }).type === "replay_batch") {
    const frames = (value as { frames?: unknown }).frames;
    if (Array.isArray(frames)) {
      for (const inner of frames) {
        const event = this.frameToEvent(feedId, inner);
        if (event !== null) this.dispatch(event, "wire");
      }
      return;
    }
  }
  const event = this.frameToEvent(feedId, value);
  if (event !== null) this.dispatch(event, "wire");
}
```

The outer envelope already passed the session filter (it carries the spliced `tug_session_id`); inner frames are dispatched post-filter and need no tsid. Every inner frame still goes through `frameToEvent` (so `KNOWN_CODE_OUTPUT_TYPES`, the `session_init` divergence check, etc. all apply unchanged) and `dispatch` (so the replay fold and perf counters tick per inner frame exactly as today).

---

### Specification {#specification}

#### Wire format — `replay_batch` (contract) {#s01-replay-batch} 

**Spec S01: `replay_batch` envelope** {#s01-spec}

```jsonc
{
  "type": "replay_batch",
  "frames": [ /* OutboundMessage, in emission order */ ],
  "ipc_version": 2,
  "tug_session_id": "<spliced by tugcast on the outer object>"
}
```

- `frames` is a non-empty, ordered array of the exact `OutboundMessage` objects the per-frame path would have emitted. Inner frames carry no `tug_session_id`.
- Only emitted for ≥2 buffered frames; single frames and brackets are raw ([P03]).
- Unwrapped entirely at the browser ingest boundary; never reaches the reducer as a unit ([P01]).

#### State Zone Mapping (tugdeck/tugways) {#state-zone-mapping}

| State | Zone (appearance / local-data / structure) | Mechanism | Law |
|-------|--------------------------------------------|-----------|-----|
| Unwrapped inner frames → reducer events | structure | existing store `dispatch` → `reduce`; observed via `useSyncExternalStore` | [L02], [L22] |
| (none new) batch is transport-only, no React state | — | — | — |

No new React state is introduced. The change is in the store's wire-ingest routing, which already feeds the reducer through the established external-store path.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ReplayBatch` | interface | `tugcode/src/types.ts` | `{ type:"replay_batch"; frames: OutboundMessage[]; ipc_version: number }`; add to `OutboundMessage` union |
| `REPLAY_BATCH_SIZE` | const | `tugcode/src/session.ts` (or replay consts) | 256, [P06] |
| replay emit loop | modify | `tugcode/src/session.ts` (#emit-flow) | buffer + `flushBatch`; bracket-raw; per-batch yield |
| `injectPendingRowSynthetics` | modify | `tugcode/src/session.ts` | emit through the shared buffer |
| `perf.replay_translate` fields | modify | `tugcode/src/session.ts` | add `batches`, rename emitted count to `frames` |
| `disableYield` threading | modify | `tugcode/src/session.ts` | pass `disableYield: inflight === null` to `translateJsonlSession` |
| `routeFrame` | add | `tugdeck/src/lib/code-session-store.ts` (#unwrap-flow) | unwrap `replay_batch`; used by `onFeedStoreChange` + `_ingestFrameForTest` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (bun:test, tugdeck)** | Real-store unwrap via `_ingestFrameForTest` | Step 1 — a `replay_batch` dispatches each inner frame; transcript identical to per-frame ingest |
| **Unit (bun:test, tugcode)** | Capture stdout, assert framing | Step 2 — brackets raw, bulk batched, decoded inner sequence equals the unbatched sequence |
| **Contract / golden** | Replay output equivalence | Steps 2–3 — existing replay/segmentation tests stay green (batching changes framing, not content) |
| **Integration (real app)** | Perf capture on reload | Step 4 — `waitMs` collapse + tugcode `batches` drop, via dev-panel on a real session |

#### What stays out of tests {#test-non-goals}

- Render cost (`perf.replay_render`) — out of scope for this plan; not a regression surface here.
- Mock-store call-count tests and fake-DOM/RTL render tests — banned; the unwrap is exercised through the **real** store + reducer via `_ingestFrameForTest` (the same path `perf-counters.test.ts` uses).
- tugcast Rust changes — none ([P02]); no new Rust tests needed beyond the workspace staying green.

---

### Execution Steps {#execution-steps}

> Commit after all checkpoints pass. tugcode steps require a binary rebuild to take effect; tugdeck is HMR-live.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Browser-side `replay_batch` unwrap | pending | — |
| #step-2 | tugcode emit batching + wire type | pending | — |
| #step-3 | Cold-path de-pacing | pending | — |
| #step-4 | Integration checkpoint + measurement | pending | — |

#### Step 1: Browser-side `replay_batch` unwrap {#step-1}

**Commit:** `tugdeck: unwrap replay_batch at the ingest boundary`

**References:** [P01] transport envelope, [P04] order unwrap-first, Spec S01, (#unwrap-flow, #state-zone-mapping)

**Artifacts:**
- `routeFrame(feedId, value)` helper in `code-session-store.ts`, used by `onFeedStoreChange` and `_ingestFrameForTest`.
- bun:test exercising a `replay_batch` through the real store.

**Tasks:**
- [ ] Add `routeFrame`: when CODE_OUTPUT value `type === "replay_batch"` and `frames` is an array, dispatch each inner frame via `frameToEvent` + `dispatch`; otherwise the existing single path.
- [ ] Route both `onFeedStoreChange` and `_ingestFrameForTest` through `routeFrame` (no behavior change for non-batch frames).
- [ ] Name the laws upheld in the commit body: [L02] (store remains the single external source feeding `useSyncExternalStore`), [L22] (direct store observation) — no new React state.

**Tests:**
- [ ] A `replay_batch` containing one full replayed turn dispatches the same events and produces the identical transcript as feeding those frames individually (assert via `getSnapshot().transcript` and `_getPerfForDevPanel().lastReplay.frames`).
- [ ] A non-batch frame still routes unchanged (regression guard).

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit`
- [ ] `cd tugdeck && bun test src/lib/code-session-store/__tests__/`

---

#### Step 2: tugcode emit batching + wire type {#step-2}

**Depends on:** #step-1

**Commit:** `tugcode: batch replay frames over the wire`

**References:** [P01] transport envelope, [P02] tugcast unchanged, [P03] brackets raw, [P06] batch size, Spec S01, (#emit-flow, #symbol-inventory)

**Artifacts:**
- `ReplayBatch` interface added to `types.ts` and the `OutboundMessage` union.
- `REPLAY_BATCH_SIZE` constant; buffered emit + `flushBatch` in the replay consumer loop.
- `injectPendingRowSynthetics` routed through the buffer.
- `perf.replay_translate` reports `batches` and inner `frames`.

**Tasks:**
- [ ] Define `ReplayBatch` and add it to `OutboundMessage`.
- [ ] Refactor the replay consumer loop to buffer content frames and `flushBatch` on threshold / brackets per [#emit-flow]; flush `replay_started` and `replay_complete` raw.
- [ ] Thread the buffer's emit through `injectPendingRowSynthetics`.
- [ ] Update `perf.replay_translate` fields (`batches`, `frames`).
- [ ] Rebuild the binary: `bun build --compile tugcode/src/main.ts --outfile tugrust/target/debug/tugcode`.

**Tests:**
- [ ] bun:test capturing replay stdout: brackets are raw frames; >`REPLAY_BATCH_SIZE` content yields `replay_batch` envelope(s); concatenating all `frames` arrays (and raw frames) reconstructs the exact unbatched frame sequence.
- [ ] Existing replay/session tests stay green (content unchanged).

**Checkpoint:**
- [ ] `cd tugcode && bunx tsc --noEmit`
- [ ] `cd tugcode && bun test`

---

#### Step 3: Cold-path de-pacing {#step-3}

**Depends on:** #step-2

**Commit:** `tugcode: drop 8ms pacing on cold replay`

**References:** [P05] de-pace cold, [Q02] mechanism, Risk R03, (#emit-flow)

**Artifacts:**
- `disableYield: inflight === null` threaded into the `translateJsonlSession` options.
- Per-batch `await yieldToEventLoop()` in the consumer.

**Tasks:**
- [ ] Pass `disableYield: true` to the translator when `inflight === null`; leave mid-stream (`inflight !== null`) on today's pacing.
- [ ] Ensure the consumer yields once per batch flush so `writeTail` drains and abort/timeout stay responsive.
- [ ] Rebuild the binary.

**Tests:**
- [ ] Abort test: a `cancel_replay` mid-load still closes with `replay_complete{aborted:true}` (existing abort coverage stays green).
- [ ] Timeout path unaffected (existing coverage green).

**Checkpoint:**
- [ ] `cd tugcode && bunx tsc --noEmit`
- [ ] `cd tugcode && bun test`

---

#### Step 4: Integration checkpoint + measurement {#step-4}

**Depends on:** #step-1, #step-2, #step-3

**Commit:** `N/A (verification only)`

**References:** (#success-criteria), `perf.replay_ingest`, `perf.replay_translate`

**Tasks:**
- [ ] Build + launch the worktree debug app (`just app-debug`); load a real ≥50-turn session (`c53db98c`).
- [ ] Capture `perf.replay_ingest` (dev-panel, source `perf`) and the tugcode `perf.replay_translate` line.

**Tests:**
- [ ] `waitMs < 50` (down from ~275).
- [ ] tugcode `batches ≈ 10`, inner `frames ≈ 2084`; browser `frames ≈ 2084` (no loss).
- [ ] Transcript renders identically (turn count, content) to the pre-change load.

**Checkpoint:**
- [ ] Both perf lines captured and meet the success criteria; transcript visually identical.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Cold transcript loads ship the replay in ~10 batched wire lines with no cold-path pacing, cutting ingest wait from ~275ms to sub-50ms, with the reducer, live path, and rendered transcript unchanged.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Browser unwraps `replay_batch` transparently; single-frame path still works (Step 1 tests).
- [ ] tugcode emits batches with raw brackets; inner sequence equals the unbatched sequence (Step 2 tests).
- [ ] Cold replay runs without 8ms pacing; abort/timeout intact (Step 3 tests).
- [ ] `waitMs` and tugcode `batches` meet the success criteria on a real session (Step 4).

**Acceptance tests:**
- [ ] `cd tugdeck && bun test src/lib/code-session-store/__tests__/`
- [ ] `cd tugcode && bun test`
- [ ] Real-app reload perf capture (Step 4).

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Render-cost investigation (`perf.replay_render` ~665ms for 46 rows) — separate plan.
- [ ] De-pace the mid-stream-reload replay (`inflight !== null`) once the live-tail interleaving is re-verified.
- [ ] Optional byte-size cap on batches if image-heavy sessions produce large batch lines.

| Checkpoint | Verification |
|------------|--------------|
| Browser unwrap | `bun test` over `code-session-store/__tests__/` |
| Emit batching | tugcode `bun test` framing assertions |
| De-pacing | abort/timeout tests green |
| End-to-end win | dev-panel `perf.replay_ingest.waitMs` < 50 on `c53db98c` |
