<!-- tugplan-skeleton v2 -->

## Tide Transcript — Resume from JSONL + v1 Polish {#tide-transcript-resume}

**Purpose:** Close the cross-restart preservation gap that the Tide card transcript currently has — the in-memory `CodeSessionStore.transcript` dies on HMR / Developer-Reload / cold boot, even though Claude Code already persists every turn to a per-session JSONL on disk at `~/.claude/projects/<encoded-project-dir>/<sessionId>.jsonl`. Fix by reading that JSONL on `spawn_session(mode=resume)`, translating its entries to the existing `CODE_OUTPUT` event shape the live wire already speaks, and emitting them through the wire before Claude's freshly-resumed subprocess starts producing live frames. Tugdeck's existing reducer commits each replayed `turn_complete` to `transcript` exactly as it would for a live turn — no client-side rehydration path, no second source of truth, no new persistence layer. Then sweep three small `Roadmap: right away` follow-ons from [tugplan-tug-list-view.md](./tugplan-tug-list-view.md) that don't already have homes in other plans: stable in-flight ↔ committed id, atom-aware user rows, and the `TugListView` prefetching protocol.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | tugplan-tide-transcript-resume |
| Last updated | 2026-05-03 |
| Roadmap anchor | [tugplan-tug-list-view.md #roadmap](./tugplan-tug-list-view.md#roadmap) — this plan executes the resume gap surfaced post-shipping plus the right-away polish items |
| Predecessors | [tugplan-tug-list-view.md](./tugplan-tug-list-view.md) (shipped 2026-05-03), [tugplan-tide-session-ledger.md](./tugplan-tide-session-ledger.md) (shipped — owns the binding-record + resume-spawn machinery this plan extends) |
| Successors | parent [tugplan-tide-card-polish.md](./tugplan-tide-card-polish.md) §step-12 (markdown styling) and §step-13 (thinking + tool surfaces) build on the resumed transcript surface; an eventual `tugplan-tug-list-view-v2-imperative-pool.md` resolves the imperative-DOM-pool follow-on noted in #roadmap |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Tide card transcript shipped in `tugplan-tug-list-view.md` works correctly *within a single browser session*. As soon as the page reloads, HMR replaces the `card-services-store.ts` module, or the user picks Developer > Reload, the transcript pane goes blank — even though Claude itself remembers every word.

Three layers of state preservation already exist around this surface, and none of them carries the transcript content:

1. **`cardSessionBindingStore`** — persisted to tugbank by tugcast under `dev.tugtool.tide.session-keys`. Carries the binding triple `{ tug_session_id, project_dir, claude_session_id }`. On reload, [`tide-session-restore.ts`](../tugdeck/src/lib/tide-session-restore.ts) walks each Tide card, reads the record, and fires `spawn_session(mode=resume)`. **Brings Claude back online with its conversation context, but Claude does not replay prior turns to tugdeck.** Claude knows the conversation; tugdeck doesn't.
2. **`tideSessionLedger`** — sqlite-backed per-session metadata (`turn_count`, `last_used_at`, `first_user_prompt`, lifecycle state). **Does not store the messages themselves.** A directory of sessions, not a conversation archive.
3. **[A9] state preservation** (`useComponentStatePreservation` / `data-tug-state-key` / `data-tug-scroll-key`) — captures form-control values, focus key, scroll position, opt-in component state. **The Tide card uses none of these for the transcript.** `CodeSessionStore.transcript` lives in-memory on a module-singleton store; nothing writes it to a bag.

But — and this is the part that reframes the whole fix — Claude itself writes a complete per-session JSONL to `~/.claude/projects/<encoded-project-dir>/<sessionId>.jsonl`. Sample listing on this machine: 992 sessions in this workspace alone, kilobytes each. Every `user_message`, every `assistant_text` block, every `tool_use` and `tool_result`, every `turn_complete`. That JSONL is what `claude --resume` reads to reconstitute Claude's own conversation context. The data already exists. We just don't read it.

So the fix is not "persist transcripts via [A9] bag" (a parallel storage layer to a JSONL that's already on disk — explicitly rejected as a non-starter). The fix is to teach the supervisor to read the JSONL on resume and replay its events through `CODE_OUTPUT`. The translation table already lives in tugcode's `session.ts` (live stream-json → IPC outbound messages); we extend it slightly to handle the JSONL-archive shape, gate the replay on a small bracket protocol, and let tugdeck's reducer commit each `turn_complete` to `transcript` the same way it commits live ones. **One source of truth (the JSONL on disk), one ingestion path (the existing reducer), one rendering path (the `TideTranscriptDataSource`)**.

The reducer doesn't need to know "live" vs "replayed." The list view doesn't need to know. The cell renderers don't need to know. The transcript appears, the user scrolls back, and the surface looks like it never lost a thing — because it never did, the bytes were on disk all along.

After the resume work, the `Roadmap: right away` list from the parent plan has eight items. Three already have homes elsewhere: picker migration is its own plan (per [tugplan-tide-session-ledger.md](./tugplan-tide-session-ledger.md)); markdown styling is parent [§step-12](./tugplan-tide-card-polish.md#step-12); thinking + tool surfaces is parent [§step-13](./tugplan-tide-card-polish.md#step-13). One — imperative DOM cell pooling, with native-selection survival as its side-effect resolution — is a structural shift to `TugListView` v2 that warrants its own plan; promoted to #roadmap below. That leaves three small polish items this plan absorbs: **stable in-flight ↔ committed id**, **atom-aware user rows**, and the **`TugListView` prefetching protocol**.

#### Strategy {#strategy}

- **Disk is the source of truth.** Claude's per-session JSONL is the canonical conversation archive. tugdeck and the supervisor are downstream consumers. We add no new persistence layer; we read what's already there.
- **The wire is the seam.** Replay events ride `CODE_OUTPUT` in the same shape live events use, with a small bracket protocol (`replay_started` → events → `replay_complete`) so tugdeck's reducer can gate phase transitions and id-stability heuristics correctly. No new feed.
- **The reducer is the ingestion path.** No client-side rehydration method on `CodeSessionStore`, no parallel "snapshot rehydrate" code path. The reducer that handles live turns handles replayed ones — it just sees them arrive in a tighter time window.
- **Replay is bounded and synchronous w.r.t. live frames.** Replay frames flush before the freshly-spawned tugcode subprocess is allowed to produce live frames for this `tug_session_id`. No interleaving; no race. The supervisor already gates frame flow per session.
- **Translation is a tugcode concern, not a tugcast concern.** `tugcode/src/session.ts` is the canonical translator from Claude's wire shapes (and JSONL is one of those shapes, lightly different from live stream-json) to the `CODE_OUTPUT` IPC outbound messages. Adding JSONL handling there keeps one translation table in one place.
- **Replay does not write to disk.** Replay reads the JSONL but does not append to it. The freshly-resumed Claude subprocess does its own JSONL appends as the user submits new turns. We do not double-write.
- **Replay is best-effort, not load-bearing.** A missing or malformed JSONL surfaces as an empty transcript on resume, not a hard error. The card still works; the conversation is gone (well, still on Claude's side, but the historical view is gone). Logged with structured telemetry; never crashes the resume.
- **Tuglaws cross-checked at every step.** [L02], [L03], [L06], [L19], [L20], [L21], [L22], [L23] all apply. See [#tuglaws-cross-check].
- **Build stays green at every commit.** `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run` pass on every step. Warnings are errors.

#### Success Criteria (Measurable) {#success-criteria}

- A Tide card with N committed turns survives HMR with all N turns visible in the transcript pane after the next render. (Verified: dev-mode smoke against a multi-turn session.)
- A Tide card with N committed turns survives Developer > Reload with the transcript intact. (Verified: manual smoke.)
- A cold-boot of Tug.app with a previously-bound card restores the transcript pane to its prior content. (Verified: manual smoke against a real session.)
- Replay events flow through the existing `CODE_OUTPUT` reducer path; no `CodeSessionStore` method is added that bypasses the dispatcher. (Verified: code review; reducer-level tests.)
- The replayed transcript content is byte-identical to the live transcript for the same session, modulo timestamp formatting. (Verified: golden-fixture round-trip — record a session live, then replay its JSONL through the supervisor and assert the resulting `transcript` arrays match.)
- A missing JSONL or unreadable record produces an empty replay (transcript starts empty for this resume) plus a structured log line; the card still mounts and accepts new turns. (Verified: synthetic test that points the supervisor at a non-existent JSONL.)
- The in-flight `code` row's React key transitions exactly **zero** times across the awaiting-first-token → streaming → committed lifecycle for a turn whose `activeMsgId` is known at submit time. (Verified: adapter test asserts id stability across the seed transition.)
- The `TugListView` prefetching protocol exposes `delegate.prefetchForIndices` and `delegate.cancelPrefetchForIndices` and dispatches them based on a viewport-prediction window; a delegate that opts in observes prefetch / cancel calls in correct order on scroll. (Verified: `TugListView` unit tests.)
- The `user` cell renderer accepts `AtomSegment[]` content and renders atoms inline alongside text once `userMessage.attachments` carries the typed shape. (Verified: cell-renderer unit test against a fixture turn whose `attachments` is `AtomSegment[]`.)
- `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run` green at every step.

#### Scope {#scope}

1. **JSONL → `CODE_OUTPUT` translator** in tugcode (TypeScript). Pure module; unit-testable against fixture JSONLs.
2. **Replay bracket events** (`replay_started`, `replay_complete`) on `CODE_OUTPUT`. Small additive shape; the reducer recognizes them and uses them to gate id-stability + phase transitions.
3. **Resume-spawn replay wire-up** in tugcode (the bridge subprocess). On `--session-mode resume`, before Claude's stdin is opened, the bridge reads the JSONL, translates, emits.
4. **Reducer handling for replay frames** in tugdeck. Idempotent commits; phase remains `idle` during replay; `inflightUserMessage` is not set; replay-frame events do not echo back as `user_message` CODE_INPUT writes.
5. **Tide card "restoring" UX** — the `TideRestoring` placeholder already exists for the binding-restore window; extend it with a small "loading conversation…" beat for the replay window so a slow JSONL parse doesn't look like a stuck card.
6. **Stable in-flight ↔ committed id** in `TideTranscriptDataSource`. Synthetic seed minted at `send` time, patched to `activeMsgId` once known — eliminates the one-remount-per-turn the v1 protocol accepted.
7. **Atom-aware user rows.** `UserRowCell` switches from a plain `<span>` body to a body that renders `userMessage.attachments` as inline atoms when present, falling back to plain text for legacy or attachment-empty turns.
8. **`TugListView` prefetching protocol.** `delegate.prefetchForIndices(indices)` / `delegate.cancelPrefetchForIndices(indices)` plus a viewport-prediction window. Delegate-only — `TugListView` does not assume any specific prefetch behavior; consumers decide.
9. **Tuglaws walkthrough + plan close-out**, mirroring the parent plan's pattern.

Out of scope:
- New persistence layer in tugdeck or in the supervisor's sqlite (Path B / C from the diagnosis — explicit non-starter).
- Imperative DOM cell pooling (its own plan in #roadmap).
- Picker migration onto `TugListView` (its own plan).
- Markdown styling pass for assistant output (parent §step-12).
- Thinking + tool surfaces inside `code` rows (parent §step-13).
- Cmd+J keybinding (its own follow-up plan).
- Cross-machine session export / import. The JSONL is per-machine; "open this conversation on another laptop" is a much larger problem.

#### Resolved Decisions {#resolved-decisions}

Listed in [#design-decisions]. The major calls are summarized here; rationale is in the linked sections.

- [D01] JSONL parsing lives in **tugcode (TypeScript bridge)**, not tugcast (Rust supervisor) — the translation table is already there; one place; one set of tests.
- [D02] Replay frames ride **`CODE_OUTPUT`** with the same event shapes live frames use — no new feed.
- [D03] Replay flushes **synchronously before live frames** for the same `tug_session_id` — no interleaving.
- [D04] Replay is **idempotent at the reducer level** via `msg_id` deduping, but the contract is "the supervisor never replays the same turn twice in one resume" — defense-in-depth, not a load-bearing dedupe.
- [D05] Bracket events are **first-class** — `replay_started` / `replay_complete` are decoded events the reducer handles, not protocol-level metadata.
- [D06] Translation is **direct JSONL → `CODE_OUTPUT`** — bypassing the live stream-json shape because JSONL has its own format and going through stream-json would require synthesizing tokens that don't exist.
- [D07] **Sticky seed** for the in-flight ↔ committed id — the data source mints a synthetic `inflight-<nonce>` seed at `send` time and rewrites it to `${activeMsgId}` once the first delta lands, eliminating the v1 remount.

---

### Resolved Questions / Design Decisions {#design-decisions}

#### [D01] JSONL parsing in tugcode (DECIDED) {#d01-translator-location}

**Decision:** The JSONL → `CODE_OUTPUT` translator lives in `tugcode/src/session.ts` (or a sibling module imported by it), TypeScript, in the bridge subprocess. The Rust supervisor is *not* extended with JSONL parsing.

**Rationale:**

- `tugcode/src/session.ts` already owns the live stream-json → `OutboundMessage` translation table — the same vocabulary the JSONL uses for its event payloads (modulo the JSONL-specific wrapper fields). Extending that module to handle the JSONL archive shape keeps one translator in one place; adding a parallel translator in Rust would mean two-way drift maintenance.
- The bridge subprocess is the natural place: it already opens, reads, and routes per-session I/O. Adding a "before opening Claude's stdout, read this JSONL and emit translated events" path is a local change to its startup flow.
- The supervisor's job is session lifecycle (spawn, close, error, reset). Reading conversational content is downstream of lifecycle and belongs to the layer that already speaks Claude's wire shapes.
- TypeScript is the right language for parsing JSON line-by-line with the kind of permissive, evolving shapes Claude's JSONL exhibits — the live translator already does this.

**Implications:**

- A new `tugcode/src/replay.ts` (or similar) exports a pure `translateJsonlEntry(entry)` function unit-testable against fixture JSONLs.
- `tugcode/src/session.ts`'s startup path branches on `--session-mode`: for `resume`, read the JSONL before opening Claude's stdout; for `new`, current path.
- No Rust-side JSONL handling. The supervisor remains a lifecycle/ledger/binding manager.

**Alternative considered:**

- Rust-side parsing in `agent_supervisor.rs`: rejected because the translation vocabulary is already in TypeScript, replicating it would create drift, and the supervisor's job is lifecycle, not content.

---

#### [D02] Replay rides `CODE_OUTPUT` (DECIDED) {#d02-replay-channel}

**Decision:** Replay frames are emitted on the existing `CODE_OUTPUT` feed (`0x40`) using the same event shapes live frames use. No new feed; no new feed-id allocation.

**Rationale:**

- The reducer already handles every event shape replay needs (`assistant_text`, `tool_use`, `tool_result`, `tool_use_structured`, `turn_complete`, `cost_update`, `system_metadata`). Adding a separate feed would force duplication.
- A new feed would also require new client-side wiring on `FeedStore`, on the per-card session filter, on telemetry. Riding `CODE_OUTPUT` is additive at zero cost.
- The bracket events ([D05]) carry the "this is replay, not live" signal. The reducer needs that signal once, at the bracket boundary, not on every event.

**Implications:**

- No `protocol.ts` `FeedId` table changes.
- The session filter (`tug_session_id`) on `CODE_OUTPUT` already routes replay frames correctly because they carry the same id as live frames for that session.
- Telemetry and lifecycle logs distinguish replay vs live via the bracket events, not via feed id.

---

#### [D03] Replay flushes synchronously before live (DECIDED) {#d03-replay-ordering}

**Decision:** For a given `tug_session_id`, all replay frames for that session flush before any live frame for that session reaches `CODE_OUTPUT`. The supervisor gates the freshly-resumed Claude subprocess's stdout pipe until replay completes.

**Rationale:**

- Interleaving replay and live would require msg-id dedupe at the reducer (already on the table as a defense-in-depth, see [D04]) plus complex ordering logic. Synchronous flush is simpler.
- The replay is bounded — it's "the JSONL I have on disk" — so its size is known up front and the supervisor can promise "all of this lands before any of that."
- The user's perceptual order — "transcript appears, then live turns appear" — matches the wire order when replay is flushed first.

**Implications:**

- The `replay_complete` bracket event ([D05]) is the supervisor's commit point: once it's emitted, live frames for this session are unblocked.
- The bridge subprocess's spawn point is gated: the freshly-resumed `tugcode` is allowed to start emitting only after `replay_complete` lands.
- A failure to read the JSONL does NOT block live frames — `replay_started` is emitted, then immediately `replay_complete` is emitted with an `error` field; the card observes the failed-replay state, surfaces a small notice if appropriate, and resumes live ingestion.

---

#### [D04] Reducer-level idempotency (DECIDED — defense-in-depth) {#d04-idempotency}

**Decision:** The reducer dedupes `turn_complete` events by `msg_id` — committing a `TurnEntry` for a `msg_id` that already exists in `transcript` is a silent no-op (with a debug log). This is **defense-in-depth, not load-bearing**: the supervisor's contract per [D03] is that replay frames for a given session flush before live frames and never re-emit a turn that's already on disk.

**Rationale:**

- A bug in the supervisor that re-emits the same turn (e.g. a misordered replay-vs-live during a fast reconnect) should produce a duplicate transcript row in the worst case, not corrupted state.
- Msg-id dedupe is cheap — `Set<msgId>` on the reducer side; O(1) per `turn_complete`.
- It also means a user can manually replay a JSONL fragment in dev tools for debugging without committing duplicates.

**Implications:**

- `CodeSessionState` gains a `committedMsgIds: Set<string>` (or its functional equivalent — likely `transcript.map(t => t.msgId)` recomputed on demand, since transcript size stays bounded by Claude's session length).
- Tests: a synthetic re-emit of a turn with the same msg_id produces no transcript change.

---

#### [D05] First-class bracket events (DECIDED) {#d05-bracket-events}

**Decision:** Two new event types ride `CODE_OUTPUT`:

```ts
{ type: "replay_started", tug_session_id: string }
{ type: "replay_complete", tug_session_id: string, count: number, error?: { kind: string; message: string } }
```

These are decoded events the reducer handles, not protocol-level metadata. The reducer:
- On `replay_started`: snapshot the current `phase` (which should be `idle` post-spawn-ack), enter a `replaying` sub-state that is internal to the reducer (not surfaced as a new phase value yet — see [D08] below for the snapshot-phase question).
- On `replay_complete`: leave `replaying`, restore the snapshot phase, commit any final state derived from replay.

**Rationale:**

- Inline metadata on every event ("is this a replay?") is noisy and makes individual events harder to reason about.
- Bracket events match how the test catalog already treats turn boundaries — discrete, observable, named.
- They give telemetry a single observable point per replay (count, duration, error).

**Implications:**

- Tugcode emits the bracket events around the JSONL-derived stream.
- The reducer adds two cases to its event-handler switch.
- `CodeSessionSnapshot` does not gain a new field; the bracket signal stays internal to the reducer. (Open: see [Q01] below.)

---

#### [D06] Direct JSONL → `CODE_OUTPUT` (DECIDED) {#d06-direct-translation}

**Decision:** The translator goes directly from JSONL entries to the `CODE_OUTPUT` `OutboundMessage` shape, bypassing the live-stream-json intermediate format.

**Rationale:**

- JSONL entries have their own field layout (`parentUuid`, `promptId`, `message.role`, `message.content[]`, `toolUseResult`, etc.) — they're Claude's *internal* persistence format, not the live wire format.
- Going JSONL → stream-json → `OutboundMessage` would require synthesizing stream-json tokens (`stream_event` wrappers, `delta` annotations, `is_partial` flags) that don't exist in the JSONL — fabricating events.
- Going direct produces complete `OutboundMessage`s for committed turns: a single `assistant_text` with `is_partial: false`, no streaming partials. Replay should land a turn at a time, not stream it character-by-character — the user is resuming, not watching a fresh response.

**Implications:**

- Translator: `function translateJsonlEntry(entry, ctx): OutboundMessage[]` where `ctx` carries the per-session id, msg-id sequencing, etc.
- Per-turn output is a small fixed sequence: `user_message` (echoing the user's submission, optional — the reducer needs it for the in-flight pair only on live turns; for replay it can land directly as part of the committed `TurnEntry`'s `userMessage`), then any `tool_use` / `tool_result` / `tool_use_structured` events, then a single `assistant_text(is_partial: false)`, then `turn_complete(success)`.
- Replayed turns thus look to the reducer like very fast live turns: open, possibly some tool work, terminal text, complete. The reducer's existing turn-commit machinery handles them.

**Alternative considered:**

- Going through stream-json: rejected because synthesis adds complexity for no benefit; the JSONL already records the canonical shape of what Claude actually produced.

---

#### [D07] Sticky seed for the in-flight ↔ committed id (DECIDED) {#d07-sticky-seed}

**Decision:** The `TideTranscriptDataSource` mints a synthetic `inflight-<nonce>` seed at the moment a `send` is dispatched, stamps it onto the in-flight row's id, and rewrites it to `${activeMsgId}` once the reducer learns `activeMsgId`. Cell wrapper React keys reference the *current* seed, so the React reconciler matches the same wrapper across the seed-rewrite — no remount.

**Rationale:**

- The v1 protocol accepted one remount per turn at the awaiting-first-token transition (when `activeMsgId` becomes set), as documented in [tugplan-tug-list-view.md §step-10 id-stability protocol](./tugplan-tug-list-view.md#step-10). Live smoke shows the remount produces a brief flicker on the streaming `code` cell — small but noticeable, and avoidable.
- A synthetic seed minted at `send` time and patched to the real `activeMsgId` once known eliminates the remount entirely. The wrapper key stays stable; only the underlying `kindForIndex` changes (`code-streaming` → `code-committed`) at commit, which is a prop change, not a remount.
- The patch happens inside the data source's id-resolution function — not inside React state. The reducer is unaffected.

**Implications:**

- `TideTranscriptDataSource` gains an internal `inflightSeedRef` that holds the synthetic seed for the current in-flight pair; cleared on `inflightUserMessage = null`.
- `idForIndex(index)` for in-flight indices reads the seed: if `activeMsgId` is set, returns `${activeMsgId}-{user|code}`; otherwise returns the synthetic `${seed}-{user|code}`.
- The seed survives the seed-to-real transition because the seed is per-turn and the lookup naturally picks the real msg-id once it's known — no React remount because the wrapper's key stays the same string identity from one render to the next.

Wait — that's actually wrong. If the key changes string identity, React remounts. The fix is subtler: the seed must be stamped onto a per-turn lookup so that `idForIndex` returns the same string before and after `activeMsgId` is set. Concretely: the seed is the **stamp the data source remembers for this turn**, and `idForIndex` returns `${seed}-{user|code}` until `replay_complete` for the matching `msg_id` lands and the seed is rewritten *globally for all future renders* to `${msgId}`. React then sees keys change identity exactly once — at the seed-rewrite point — but at that moment the wrapper unmounts the old render and mounts a new one with the new key, which is a remount. So the v1 protocol's caveat stands: one remount per turn, just earlier in the lifecycle.

**The actual decision:** keep the v1 protocol unchanged for live submits; what this step *can* eliminate is the remount **for committed turns landing via replay** — those have `msgId` known up front, so the seed is the real msgId from frame zero, and there's no rewrite. The "right away" bullet's framing of this work was slightly optimistic about live turns; the realistic win is replay-correctness. Live-turn flicker stays as a follow-on (with imperative DOM pooling as the natural resolution).

---

#### [Q01] Snapshot-level `replaying` phase (OPEN) {#q01-replay-phase}

**Question:** Should `CodeSessionSnapshot.phase` gain a `replaying` value alongside `idle / submitting / awaiting_first_token / streaming / tool_work / awaiting_approval / errored`? Or stay with the bracket events as the only signal, and let the snapshot phase remain `idle` during replay?

**Tension:** A new phase value is a public surface change — every consumer reading `phase` sees it. But it also lets the prompt entry know "don't accept input yet, replay is in progress" without reaching into bracket-event internals.

**Resolution slot:** Resolve in Step 4 (Tugdeck reducer wiring) once we see whether `canSubmit` derived from the bracket-internal state is enough.

---

### Specification {#specification}

#### Replay protocol shape {#replay-protocol}

Two new event types on `CODE_OUTPUT`:

```ts
interface ReplayStartedEvent {
  type: "replay_started";
  tug_session_id: string;
}

interface ReplayCompleteEvent {
  type: "replay_complete";
  tug_session_id: string;
  count: number;          // number of turns committed during this replay
  error?: {
    kind: "jsonl_missing" | "jsonl_unreadable" | "jsonl_malformed";
    message: string;
  };
}
```

Between `replay_started` and `replay_complete`, the bridge emits the same event shapes the live wire produces — but with `is_partial: false` on every text event (replay is per-turn, not per-token, see [D06]).

#### `TideRowDescriptor` change for atom-aware user rows {#atom-aware-row}

```ts
export interface TideRowDescriptor {
  kind: TideTranscriptCellKind;
  turn?: TurnEntry;
  inflight?: CodeSessionSnapshot["inflightUserMessage"];
}
```

stays unchanged — the atom segments live on `turn.userMessage.attachments` (which evolves to `ReadonlyArray<AtomSegment>` once the prompt entry's atom flow lands; see [Step 7](#step-7)).

#### `TugListViewDelegate` prefetching extension {#prefetch-delegate}

```ts
export interface TugListViewDelegate {
  // ... existing optional members ...

  /**
   * Fires when an index enters the prefetch window (a small band ahead
   * of and behind the rendered window). Consumers that need to warm
   * up resources before a cell mounts (e.g. fetch a remote attachment,
   * decode a thumbnail) opt in via this hook. The list view does NOT
   * call `cellRenderers[kind]` for prefetched indices — they are
   * informational only.
   */
  prefetchForIndices?(indices: ReadonlyArray<number>): void;

  /**
   * Fires when a previously-prefetched index leaves the prefetch
   * window without mounting (e.g. the user reversed scroll direction).
   * Consumers cancel any in-flight prefetch work.
   */
  cancelPrefetchForIndices?(indices: ReadonlyArray<number>): void;
}
```

Default behavior (`undefined` delegate methods): no prefetching; current v1 behavior unchanged.

---

### Tuglaws Cross-Check {#tuglaws-cross-check}

- **L01** — One `root.render()`. No new component-level renders. ✓
- **L02** — External state via `useSyncExternalStore`. Replay events reach React via the existing reducer-snapshot path. ✓
- **L03** — `useLayoutEffect` for registrations events depend on. The "loading conversation…" placeholder mounts in the existing `TideRestoring` flow — no new layout-effect work. ✓
- **L04** — Never measure child DOM inline. Replay does not touch DOM directly. ✓
- **L06** — Appearance via CSS / DOM. The "loading" beat reuses the `TideRestoring` styles. ✓
- **L11** — Controls emit, responders own state. Prefetch dispatch fires `delegate.prefetchForIndices`; consumer responders handle as appropriate. ✓
- **L19** — Component authoring guide. No new tugways primitives in this plan. ✓
- **L20** — Token sovereignty. No new tokens introduced. ✓
- **L21** — Vite-specific surfaces (`import.meta.hot`) stay in `hmr-bridge.ts`. No new HMR coupling. ✓
- **L22** — Store observers may write DOM. The streaming `code` cell's observer pattern is unaffected — replay produces only committed cells. ✓
- **L23** — User-visible state preserved across DOM-down transitions. **This plan exists to make this true for the transcript content.** Replay reads the JSONL on every resume and re-emits the events the reducer needs to reconstitute `transcript`. ✓ (after Phase A lands)
- **L24** — State zones. No new state-zone violations. ✓

---

### Execution Steps {#execution-steps}

> Each step is its own commit. `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, and `cargo nextest run` pass at the end of every step.

#### Phase A — Resume from JSONL {#phase-a}

#### Step 1: tugcode JSONL → `CODE_OUTPUT` translator (pure module) {#step-1}

**Commit:** `tugcode(replay): JSONL entry → OutboundMessage translator`

**References:** [D01] translator-location, [D06] direct-translation, [#replay-protocol]

**Artifacts:**

- New `tugcode/src/replay.ts` exporting:
  - `interface JsonlEntry` — a permissive shape covering the variants we observed in `~/.claude/projects/<dir>/<id>.jsonl`: `user`, `assistant`, `attachment`, `tool_result`, `summary`, plus the `queue-operation` filler entries that should be skipped.
  - `function translateJsonlEntry(entry: JsonlEntry, ctx: TranslateContext): OutboundMessage[]` — takes one entry, returns 0..N outbound messages.
  - `function translateJsonlSession(jsonl: string, tugSessionId: string): { messages: OutboundMessage[]; turnCount: number; error?: { kind: string; message: string } }` — top-level function: lex the JSONL, accumulate translated messages, count committed turns, surface fatal-parse errors.
- Unit tests in `tugcode/src/__tests__/replay.test.ts` against fixture JSONLs — at minimum:
  - A simple two-turn session (user → assistant → user → assistant).
  - A turn with one `Bash` tool call (user → assistant(tool_use) → tool_result → assistant(text) → ...).
  - A turn with concurrent tool calls.
  - An attachment-only entry (the one bracketing the user message).
  - A malformed line (skipped with a warning, not fatal).

**Tasks:**

- [ ] Read 5–10 representative JSONL files under `~/.claude/projects/<dir>/` to enumerate the entry shapes the translator must handle. Document the shape coverage in `replay.ts`'s module docstring.
- [ ] Author the per-entry translator with explicit handling for each `type` value observed; unknown types log and skip.
- [ ] Author the session-level translator that drives `translateJsonlEntry` over each line and emits `replay_started` / `replay_complete` brackets around the body.
- [ ] Convert one or more representative JSONLs into a test fixture under `tugcode/src/__tests__/fixtures/jsonl/`. Anonymize any identifying content.
- [ ] Author unit tests covering the cases above.

**Tests:**

- [ ] Two-turn smoke: translator output, when fed line-by-line through the existing `OutboundMessage` reducer (in test mode), produces a `transcript` array with two `TurnEntry` records carrying the expected `userMessage.text` and `assistant` content.
- [ ] Tool-call turn: emits `tool_use` + `tool_result` + (optional) `tool_use_structured` events in the right order; the resulting `TurnEntry.toolCalls` is non-empty.
- [ ] Concurrent tools: msgs interleave by `tool_use_id` correctly.
- [ ] Malformed line: skipped; the surrounding turns are still committed; a warn line is emitted.
- [ ] Empty JSONL: produces `replay_started` immediately followed by `replay_complete` with `count: 0`.
- [ ] Missing JSONL: returned as `error: { kind: "jsonl_missing", ... }` from `translateJsonlSession`; no events between brackets.

**Checkpoint:**

- [ ] `bun x tsc --noEmit` — exit 0.
- [ ] `bun test` (in `tugcode/`) — green.
- [ ] `cargo nextest run` — green (no Rust changes; sanity).

---

#### Step 2: tugdeck reducer handles `replay_started` / `replay_complete` {#step-2}

**Depends on:** #step-1

**Commit:** `tide(transcript): reducer handles replay bracket events`

**References:** [D04] idempotency, [D05] bracket-events, [Q01] replay-phase

**Artifacts:**

- `tugdeck/src/lib/code-session-store/events.ts` — extend the discriminated-union event type with `ReplayStartedEvent` and `ReplayCompleteEvent`.
- `tugdeck/src/lib/code-session-store/reducer.ts` — handle both events:
  - `replay_started`: snapshot `phase` if not `idle`; flip an internal `_replaying: boolean` flag; clear `pendingUserMessage` defensively (replay should never see one).
  - `replay_complete`: clear `_replaying`; restore the snapshot phase if it was non-idle; on `error`, append a structured note to a new `lastReplayResult` field on the snapshot OR (per [Q01]) gate via the phase value.
- `tugdeck/src/lib/code-session-store/__tests__/code-session-store.replay.test.ts` — new file:
  - Synthetic `replay_started` / events / `replay_complete` against a fresh store; assert `transcript` shape post-`replay_complete`.
  - Idempotency: send the same `turn_complete` twice with the same `msg_id`; the second is a no-op.
  - Error path: `replay_started` immediately followed by `replay_complete` with `error: { kind: "jsonl_missing" }`; assert the card's snapshot reflects "no replay happened" cleanly.

**Tasks:**

- [ ] Extend the event type union.
- [ ] Implement the two new handlers in the reducer.
- [ ] Decide [Q01]: surface `replaying` as a phase value? Resolve in this commit.
- [ ] Add `committedMsgIds` (or equivalent) to dedupe `turn_complete`s by msg-id (defense-in-depth per [D04]).
- [ ] Author the new test file.

**Tests:**

- [ ] Bracket round-trip: `replay_started` + 2 turns + `replay_complete` produces a transcript of length 2.
- [ ] Mid-turn live-frame skip: a live `assistant_text` partial that arrives during a replay window is dropped (or not — depends on [D03] strictness) with a warn.
- [ ] Dedupe: two `turn_complete`s with the same `msg_id` produce a transcript of length 1.
- [ ] Phase preservation: `replay_started` while `phase: idle` keeps the post-replay phase as `idle`.

**Checkpoint:**

- [ ] `bun x tsc --noEmit` — exit 0.
- [ ] `bun test` — green.
- [ ] `cargo nextest run` — green.

---

#### Step 3: tugcode wires replay into resume-spawn flow {#step-3}

**Depends on:** #step-2

**Commit:** `tugcode(replay): emit replay before live on --session-mode resume`

**References:** [D03] replay-ordering

**Artifacts:**

- `tugcode/src/session.ts` — branch on `--session-mode` at the top of the per-session start path:
  - `resume` mode: locate the JSONL at `<claude_projects_root>/<encoded-project-dir>/<claude_session_id>.jsonl`, call `translateJsonlSession` from Step 1, emit each `OutboundMessage` to IPC, then start the Claude subprocess and resume normal live ingestion. The bracket events flank the replay.
  - `new` mode: current path; no replay.
- The resume path *gates* the Claude subprocess's stdout pipe: replay must flush before any live `OutboundMessage` is allowed for this session.
- Telemetry: structured logs at `tide::replay` for `replay.started` / `replay.complete` / `replay.error` with timing.

**Tasks:**

- [ ] Identify the encoded-project-dir naming used by Claude (the leading `-` plus path-with-slashes-replaced-by-dashes form).
- [ ] Wire the resume branch in tugcode session start.
- [ ] Gate live-frame emission until `replay_complete` has been written.
- [ ] Add the structured telemetry.
- [ ] If the JSONL is missing or unreadable, emit `replay_started` then `replay_complete` with `error`, and proceed to live ingestion.

**Tests:**

- [ ] Tugcode-level integration test: pre-stage a fixture JSONL, start the session in resume mode against a stub Claude process, assert replay events flow first.
- [ ] Tugcode-level integration test: missing JSONL → resume flow still completes; live frames flow normally afterward.

**Checkpoint:**

- [ ] `bun x tsc --noEmit` — exit 0.
- [ ] `bun test` (tugcode) — green.
- [ ] `cargo nextest run` — green.

---

#### Step 4: Tide card "loading conversation…" UX during replay {#step-4}

**Depends on:** #step-3

**Commit:** `tide(transcript): TideRestoring beat for replay window`

**References:** [Q01] replay-phase

**Artifacts:**

- `tugdeck/src/components/tugways/cards/tide-card.tsx` — extend the `TideRestoring` placeholder to render through the replay window in addition to the binding-restore window. The two windows share a placeholder; the wording changes from "Restoring session…" to "Loading conversation…" once binding-restore has completed but replay hasn't.
- `tugdeck/src/components/tugways/cards/tide-card.css` — minor styling adjustments if the wording wraps differently; otherwise no change.
- A small derivation: the Tide card observes `_replaying` (or the `replaying` phase if [Q01] resolves that way) and selects the wording accordingly.

**Tasks:**

- [ ] Wire the replay-state derivation into the `TideRestoring` selector.
- [ ] Update the placeholder text per the chosen wording.
- [ ] Verify the placeholder dismisses on `replay_complete`.

**Tests:**

- [ ] Component test: render the Tide card mid-replay (driven via reducer dispatch); assert `TideRestoring` is mounted with the replay wording.
- [ ] Component test: the placeholder dismisses on `replay_complete` and the transcript appears in the same render commit (no flash of empty pane).

**Checkpoint:**

- [ ] `bun x tsc --noEmit` — exit 0.
- [ ] `bun test` — green.
- [ ] `bun run audit:tokens lint` — zero violations.
- [ ] `cargo nextest run` — green.

---

#### Step 5: Tide card resume integration tests + manual smoke {#step-5}

**Depends on:** #step-4

**Commit:** `tide(transcript): resume-from-JSONL integration tests`

**References:** [#success-criteria]

**Artifacts:**

- New `tugdeck/src/__tests__/tide-card-resume.test.tsx` — drives a Tide card through:
  - Fresh mount with a stub JSONL fixture for the bound `claude_session_id`.
  - `spawn_session(mode=resume)` ack arrives.
  - Replay frames flow, transcript fills.
  - `replay_complete` lands; placeholder dismisses; transcript renders all turns.
  - User submits a new turn live; it appends correctly.
- Manual smoke checklist in this step's commit body:
  - Open a Tide card with several turns.
  - HMR (save a tugdeck file).
  - Verify the transcript repaints with all prior turns.
  - Submit a new turn; verify it appends.
  - Developer > Reload.
  - Verify the transcript repaints.
  - Cold-boot: quit Tug.app, relaunch, open the same card.
  - Verify the transcript repaints.

**Tasks:**

- [ ] Author the integration test file using the existing `setup-rtl` + WASM init harness.
- [ ] Add the manual smoke checklist to the commit body.
- [ ] Run the manual smoke against a real session.

**Tests:**

- [ ] Integration: resume → replay → transcript matches fixture turn count.
- [ ] Integration: resume with missing JSONL → empty transcript + card still functional + structured log captured.
- [ ] Integration: live submit after replay-complete works; new turn appears at the end.
- [ ] Integration: live submit during replay window is blocked (or queued — per [Q01] / [D03] resolution).

**Checkpoint:**

- [ ] `bun x tsc --noEmit` — exit 0.
- [ ] `bun test` — green.
- [ ] `bun run audit:tokens lint` — zero violations.
- [ ] `cargo nextest run` — green.
- [ ] Manual smoke checklist verified by user.

---

#### Phase B — Adapter polish {#phase-b}

#### Step 6: Stable in-flight ↔ committed id (sticky seed for replay) {#step-6}

**Depends on:** #step-5

**Commit:** `tide(transcript): sticky seed for in-flight ↔ committed id`

**References:** [D07] sticky-seed

**Artifacts:**

- `tugdeck/src/lib/tide-transcript-data-source.ts`:
  - The data source mints a `Symbol`-backed seed (or a string nonce) at the moment `inflightUserMessage` first appears on a snapshot.
  - `idForIndex(index)` for in-flight indices reads the seed and returns `${seed}-{user|code}` until `activeMsgId` is set.
  - For replay-committed turns, the msg_id is known up front, so the sticky seed never enters the picture.
- Test extensions in `tugdeck/src/lib/__tests__/tide-transcript-data-source.test.ts`:
  - For a replay-committed turn, the id at the row's index equals `${msgId}-{user|code}` directly (no seed transition).
  - For a live in-flight turn, the seed transitions at the first delta as before — this step does NOT change live-turn behavior; live-turn flicker remains a follow-on resolved by the imperative-DOM-pool plan.

**Tasks:**

- [ ] Implement the seed minting at first-appearance of `inflightUserMessage`.
- [ ] Ensure replay-committed turns bypass the seed (their msg_id is known on commit).
- [ ] Update tests to assert the new behavior.

**Tests:**

- [ ] Replay-only commit: id is `${msgId}-...` at first read; never transitions.
- [ ] Live submit (regression): seed transitions exactly once at first delta (unchanged from v1).

**Checkpoint:**

- [ ] `bun x tsc --noEmit` — exit 0.
- [ ] `bun test` — green.
- [ ] `cargo nextest run` — green.

---

#### Step 7: Atom-aware `user` row body {#step-7}

**Depends on:** #step-6

**Commit:** `tide(transcript): atom-aware user-row body`

**References:** [#atom-aware-row], parent §step-11's [D11]

**Artifacts:**

- `tugdeck/src/lib/code-session-store/types.ts` — narrow `userMessage.attachments` from `ReadonlyArray<unknown>` to `ReadonlyArray<AtomSegment>` once the prompt entry's atom flow reaches transcript form. (Gating note: if the prompt entry hasn't shipped that change, this step ships a `userMessage.attachments?: ReadonlyArray<AtomSegment>` opt-in instead.)
- `tugdeck/src/components/tugways/cards/tide-card-transcript.tsx` — `UserRowCell` renders `attachments` as inline atoms alongside `text` when present. Falls back to plain text when `attachments` is empty.
- Test extensions in `tugdeck/src/__tests__/tide-card-transcript.test.tsx` — fixture turn whose `attachments` carries one or two `AtomSegment`s; assert the rendered DOM has the atom elements inline.

**Tasks:**

- [ ] Verify whether the prompt entry's atom flow exposes `AtomSegment[]` on submission today; gate the type change accordingly.
- [ ] Update `UserRowCell` to render atoms inline.
- [ ] Add the test fixture and assertions.

**Tests:**

- [ ] Atom-bearing user message: rendered DOM contains the atom elements with their atom-specific attributes.
- [ ] Atom-empty user message (regression): renders plain text; no atom elements.

**Checkpoint:**

- [ ] `bun x tsc --noEmit` — exit 0.
- [ ] `bun test` — green.
- [ ] `bun run audit:tokens lint` — zero violations.
- [ ] `cargo nextest run` — green.

---

#### Phase C — TugListView prefetching {#phase-c}

#### Step 8: `TugListView` prefetching protocol {#step-8}

**Depends on:** #step-7

**Commit:** `tug-list-view: delegate.prefetchForIndices + cancelPrefetchForIndices`

**References:** [#prefetch-delegate]

**Artifacts:**

- `tugdeck/src/components/tugways/tug-list-view.tsx`:
  - `TugListViewDelegate` gains optional `prefetchForIndices(indices)` and `cancelPrefetchForIndices(indices)`.
  - The list view computes a prefetch window — a small band ahead of and behind the rendered window (e.g. 5 indices on each side, configurable via a delegate option in a future step).
  - On windowing pass, the list view diffs the previous prefetch set against the new one and dispatches `prefetchForIndices(added)` / `cancelPrefetchForIndices(removed)` accordingly.
  - The list view does NOT call `cellRenderers[kind]` for prefetched-only indices — they are informational.
- `tugdeck/src/components/tugways/__tests__/tug-list-view.test.tsx` — new tests covering the prefetch dispatch.

**Tasks:**

- [ ] Compute the prefetch window in the windowing pass.
- [ ] Diff against previous and dispatch.
- [ ] Author tests.

**Tests:**

- [ ] On scroll forward: indices ahead of the rendered window enter via `prefetchForIndices`; previously-prefetched indices behind the rendered window enter via `cancelPrefetchForIndices`.
- [ ] On scroll reversal: prefetched-but-not-rendered indices flip via `cancelPrefetchForIndices`.
- [ ] No prefetch dispatch when neither method is provided on the delegate (default v1 behavior).
- [ ] Cell renderers are NOT invoked for prefetched indices.

**Checkpoint:**

- [ ] `bun x tsc --noEmit` — exit 0.
- [ ] `bun test` — green.
- [ ] `bun run audit:tokens lint` — zero violations.
- [ ] `cargo nextest run` — green.

---

#### Phase D — Tuglaws walkthrough + close-out {#phase-d}

#### Step 9: Tuglaws walkthrough + plan close-out {#step-9}

**Depends on:** #step-8

**Commit:** `tide(transcript): tuglaws walkthrough; close out plan`

**References:** [#tuglaws-cross-check]

**Artifacts:**

- Per-step compliance review against [tuglaws.md](../tuglaws/tuglaws.md), [pane-model.md](../tuglaws/pane-model.md), [component-authoring.md](../tuglaws/component-authoring.md), [responder-chain.md](../tuglaws/responder-chain.md), [state-preservation.md](../tuglaws/state-preservation.md), [token-naming.md](../tuglaws/token-naming.md). Findings either land as small fixes in this commit or are explicitly logged.
- `roadmap/tide.md §T3.4.a` updated to mention JSONL replay on resume.
- `roadmap/tugplan-tug-list-view.md #roadmap` updated: `Stable in-flight ↔ committed id`, `Atom-aware rendering for user rows`, `Prefetching protocol` rows flipped to "shipped — see [tugplan-tide-transcript-resume.md]"; `Imperative DOM cell pooling` row gets a "promoted to its own plan" marker.
- Plan Metadata `Status` flips to `shipped`.

**Tasks:**

- [ ] Walk each tuglaw against this plan's diff.
- [ ] Update `tide.md §T3.4.a`.
- [ ] Update `tugplan-tug-list-view.md #roadmap` rows.
- [ ] Promote imperative-DOM-pool plan to its own follow-on file (or leave as a roadmap note pointing at a TBD plan name).

**Tests:**

- [ ] Full-suite green: `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run`.

**Checkpoint:**

- [ ] All commands above exit clean.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Tide card transcripts survive HMR / Developer-Reload / cold-boot via JSONL replay on resume — same wire path as live, no parallel persistence layer. Three small `Roadmap: right away` polish items absorbed into this plan: replay-correct in-flight ↔ committed id, atom-aware user rows, prefetching protocol on `TugListView`. Imperative DOM cell pooling promoted to its own plan.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] `tugcode/src/replay.ts` exists; pure translator unit tests green against fixture JSONLs.
- [ ] Reducer handles `replay_started` / `replay_complete` and dedupes by msg_id.
- [ ] Resume-mode session start in tugcode reads JSONL and emits replay before live.
- [ ] Tide card surfaces a "Loading conversation…" beat during replay; placeholder dismisses on `replay_complete`.
- [ ] HMR / Developer-Reload / cold-boot manual smoke verified against a multi-turn session.
- [ ] Sticky seed eliminates the seed-transition remount for replay-committed turns.
- [ ] `UserRowCell` renders inline atoms when `attachments` is non-empty.
- [ ] `TugListView` dispatches `prefetchForIndices` / `cancelPrefetchForIndices` on a working window.
- [ ] Tuglaws cross-check passes per-step.
- [ ] `tugplan-tug-list-view.md #roadmap` rows for absorbed items flipped to "shipped".
- [ ] All check commands green: `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run`.

**Acceptance tests:**

- [ ] tugcode replay-translator unit tests (Step 1).
- [ ] Reducer replay-bracket tests (Step 2).
- [ ] tugcode resume-flow integration tests (Step 3).
- [ ] Tide card replay-UX component tests (Step 4).
- [ ] Tide card resume-integration tests (Step 5).
- [ ] Adapter sticky-seed tests (Step 6).
- [ ] Atom-aware user-row tests (Step 7).
- [ ] `TugListView` prefetch tests (Step 8).

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] **Imperative DOM cell pooling** — the v2 of `TugListView` that swaps React item-keyed mount/unmount for an imperative DOM pool keyed by cell kind. Public API unchanged; lifecycle semantics shift for stateful cell renderers (per the v1 → v2 caveat in [tugplan-tug-list-view.md §[D04]](./tugplan-tug-list-view.md#d04-cell-reuse)). Promoted from `tugplan-tug-list-view.md #roadmap` to its own plan because the structural shift earns dedicated decision-making (pool sizing, eviction policy, the [D13] native-text-selection-survival side-effect win, the per-kind reuse-token contract). Plan name TBD: `tugplan-tug-list-view-v2-imperative-pool.md` is a placeholder.
- [ ] **Native-text-selection survival across scroll-out** — explicitly resolved as a side effect of the imperative-DOM-pool plan above. v1 documented limitation per [tugplan-tug-list-view.md §[D13]](./tugplan-tug-list-view.md#d13-selection-scroll-out).
- [ ] **Live-turn flicker at the awaiting-first-token transition** — the seed-rewrite remount that this plan's Step 6 *cannot* eliminate (only replay-committed turns avoid the rewrite, since their msg_id is known up front). The imperative-DOM-pool plan resolves this naturally because cell DOM survives wrapper-key changes.
- [ ] **Cross-machine session export / import** — the JSONL is per-machine. "Open this conversation on another laptop" requires a much larger design (sync, encryption, schema-stable export shape). Not in scope for this plan or near-term follow-ons.
- [ ] **Replay performance review** — long sessions (≥ 100 turns) may take observable time to translate + commit. If the user-perceived "Loading conversation…" beat exceeds a small budget, profile the translator and the reducer's commit loop. Earned when the manual smoke surfaces real lag.
- [ ] **Replay-while-live (interleaved replay)** — [D03] commits to synchronous-before-live ordering. If a future use case wants to splice replay into a live session (e.g. a compaction summary delivered alongside live frames), revisit the dedupe contract and the bracket protocol. Not earned today.
- [ ] **JSONL drift telemetry** — Claude's JSONL format may evolve across versions. A version-gate similar to the stream-json catalog drift test ([P15](./tide.md#p15-stream-json-version-gate)) would catch silent format changes. Earned when a version bump produces a real translation regression.

| Checkpoint | Verification |
|-|-|
| Tokens lint clean | `bun run audit:tokens lint` |
| Translator unit tests | `cd tugcode && bun test src/__tests__/replay.test.ts` |
| Reducer replay tests | `bun test src/lib/code-session-store/__tests__/code-session-store.replay.test.ts` |
| Tide card replay UX | `bun test src/__tests__/tide-card-resume.test.tsx` |
| Adapter seed tests | `bun test src/lib/__tests__/tide-transcript-data-source.test.ts` |
| List-view prefetch tests | `bun test src/components/tugways/__tests__/tug-list-view.test.tsx` |
| TS clean | `bun x tsc --noEmit` |
| Workspace tests | `cargo nextest run` |
| HMR smoke | Manual: open a Tide card with N turns, save a tugdeck file, observe transcript repaints intact |
| Developer > Reload smoke | Manual: open a Tide card with N turns, Developer > Reload, observe transcript repaints intact |
| Cold-boot smoke | Manual: quit Tug.app, relaunch, open the same card, observe transcript repaints intact |
