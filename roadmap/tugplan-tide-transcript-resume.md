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
| Predecessors | [tugplan-tug-list-view.md](./tugplan-tug-list-view.md) (shipped 2026-05-03); [tugplan-tide-session-ledger.md](./tugplan-tide-session-ledger.md) (shipped — owns the binding-record + resume-spawn machinery this plan extends). [§P14](./tide.md#p14-claude-resume) `claude_session_id` persistence is **absorbed as Step 0** of this plan — historically a separate roadmap item, brought in here because it's the load-bearing prerequisite for JSONL replay |
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

- **Persist `claude_session_id` first.** The Path A wire-replay machinery is gated on the supervisor knowing which JSONL to read for each card on resume. Today, `claude_session_id` is captured in-memory but never persisted — the [§P14](./tide.md#p14-claude-resume) work absorbed as Step 0 closes that gap. Without it, every reload spawns a fresh Claude subprocess and there is no JSONL to replay.
- **Disk is the source of truth.** Claude's per-session JSONL is the canonical conversation archive. tugdeck and the supervisor are downstream consumers. We add no new persistence layer; we read what's already there.
- **The wire is the seam.** Replay events ride `CODE_OUTPUT` in the same shape live events use, with a small bracket protocol (`replay_started` → events → `replay_complete`) so tugdeck's reducer can gate phase transitions and id-stability heuristics correctly. No new feed.
- **The reducer is the ingestion path.** No client-side rehydration method on `CodeSessionStore`, no parallel "snapshot rehydrate" code path. The reducer that handles live turns handles replayed ones — it just sees them arrive in a tighter time window, gated by a new `replaying` phase ([D11]).
- **Replay is bounded and synchronous w.r.t. live frames.** Replay frames flush on tugcode's IPC stdout *before* tugcode forwards live events translated from Claude's stdout for the same session. The boundary is at tugcode's IPC stdout, not at Claude's pipe — Claude can be running, emitting stream-json, and tugcode buffers its translated output until `replay_complete` has been written to IPC. No interleaving; no race.
- **Translation is a tugcode concern, not a tugcast concern.** `tugcode/src/session.ts` already owns the live stream-json → `OutboundMessage` translation. JSONL handling (a sibling shape, lightly different from live stream-json) lives in `tugcode/src/replay.ts`. One translation vocabulary in one language. The Rust supervisor stays a lifecycle/ledger/binding manager.
- **Replay does not write to disk.** Replay reads the JSONL but does not append to it. The freshly-resumed Claude subprocess does its own JSONL appends as the user submits new turns. We do not double-write.
- **Replay is best-effort, not load-bearing.** A missing, unreadable, or malformed JSONL surfaces as an empty transcript on resume, not a hard error. The card still works; the conversation history is gone for that card (the bytes are still on Claude's side). Logged with structured telemetry; the hard time budget per [D10] guarantees the card becomes interactive within 10s of binding regardless of JSONL state.
- **Honest replay accuracy trade-offs.** Per-row historical model name is *not* preserved in v1 ([D09]); orphan turns at reload synthesize as interrupted ([D08]); claude_session_id mismatches in tugbank vs. on-disk JSONL produce empty transcripts (handled cleanly). Each is documented; each has a follow-on path if it becomes a real complaint.
- **Tuglaws cross-checked at every step.** [L02], [L03], [L06], [L10], [L11], [L19], [L20], [L22], [L23], [L24] apply. See [#tuglaws-cross-check]. L23 in particular is satisfied by a third preservation mechanism — external archive replay — distinct from in-session minimal mutation and cross-session [A9] save/restore.
- **Build stays green at every commit.** `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run` pass on every step. Warnings are errors.

#### Success Criteria (Measurable) {#success-criteria}

- `claude_session_id` is persisted to tugbank in `relay_session_io`'s atomic-promote block and rehydrated on startup; subsequent `spawn_session(mode=resume)` invocations spawn the tugcode subprocess with `--resume <id>` and Claude reloads its conversation context. (Verified: Step 0 unit tests + real-claude integration test `test_close_then_reopen_preserves_history`.)
- A Tide card with N committed turns survives HMR with all N turns visible in the transcript pane after the next render. (Verified: dev-mode Smoke A against a multi-turn session.)
- A Tide card with N committed turns survives Developer > Reload with the transcript intact. (Verified: Smoke B.)
- A cold-boot of Tug.app with a previously-bound card restores the transcript pane to its prior content. (Verified: Smoke C against a real session.)
- A reload mid-stream produces a transcript with the orphan turn committed as interrupted ([D08]). (Verified: Smoke D + integration test.)
- Replay events flow through the existing `CODE_OUTPUT` reducer path; no `CodeSessionStore` method is added that bypasses the dispatcher. (Verified: code review; reducer-level tests.)
- The replayed transcript content is byte-identical to a live recording of the same session, modulo timestamp formatting and the [D09] current-model-on-all-rows trade-off. (Verified: golden-fixture round-trip — record a session live, then replay its JSONL through the supervisor and assert the resulting `transcript` arrays match.)
- A missing or unreadable JSONL produces an empty replay (transcript starts empty for this resume) plus a `lastReplayResult.kind === "jsonl_missing" | "jsonl_unreadable"` snapshot field; the card still mounts and accepts new turns within 10s. (Verified: integration test pointing the supervisor at a non-existent JSONL.)
- A long JSONL replay respects [D10]'s budget thresholds: the placeholder transitions to a count-aware variant after 2s and the card becomes interactive within 10s regardless of JSONL size. (Verified: integration test with a synthetic-delay fixture.)
- The replay-committed `code` row's React key transitions exactly **zero** times across the row's lifetime — the JSONL-derived `msg_id` is the row's id from frame zero ([D07]). (Verified: adapter test asserts id stability for replay turns.)
- Live-turn flicker is unchanged from v1 ([D07]'s honest scope) — the seed transition for live in-flight turns continues to remount once at first delta and is documented as a follow-on resolved by imperative DOM pooling.
- The `TugListView` prefetching protocol exposes `delegate.prefetchForIndices` and `delegate.cancelPrefetchForIndices` and dispatches them based on a viewport-prediction window; a delegate that opts in observes prefetch / cancel calls in correct order on scroll. (Verified: `TugListView` unit tests.)
- The `user` cell renderer accepts `AtomSegment[]` content and renders atoms inline alongside text once `userMessage.attachments` carries the typed shape. (Verified: cell-renderer unit test against a fixture turn whose `attachments` is `AtomSegment[]`.)
- `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run` green at every step.

#### Scope {#scope}

1. **`claude_session_id` persistence + resume threading** ([§P14](./tide.md#p14-claude-resume) absorbed). Persists in the atomic-promote block; `rebind_from_tugbank` rehydrates; `TugcodeSpawner` threads `--resume <id>`; `do_reset_session` invalidates. Step 0.
2. **JSONL → `CODE_OUTPUT` translator** in tugcode (TypeScript). Pure module; unit-testable against fixture JSONLs. Surveyed shape coverage per [D06]; orphan-turn synthesis per [D08]; batched async iteration per [D10].
3. **Replay bracket events** (`replay_started`, `replay_complete`) on `CODE_OUTPUT` per [D05]. Small additive shape; the reducer recognizes them and uses them to gate phase transitions.
4. **`replaying` phase value** on `CodeSessionSnapshot.phase` per [D11]. Drives `canSubmit: false` and the `TideRestoring` placeholder via `data-phase` cascade.
5. **Reducer handling for replay frames** in tugdeck. Idempotent commits via msg-id dedupe ([D04]); phase transitions to `replaying` during replay; `inflightUserMessage` is cleared defensively; replay-frame events do not echo back as `user_message` CODE_INPUT writes.
6. **Resume-spawn replay wire-up** in tugcode. On `--resume-session <id>`, tugcode emits replay events on its IPC stdout *before* it forwards live events from Claude's stdout for the same session. Live events from Claude during the replay window are buffered and flushed after `replay_complete`.
7. **Tide card "Loading conversation…" UX** — the `TideRestoring` placeholder gains a count-aware variant for [D10]'s soft-budget state and a timeout-state variant for the hard-budget cutoff.
8. **Sticky id for replay-committed turns** in `TideTranscriptDataSource` per [D07]. The replay-committed turn's `msg_id` is the row's id from frame zero — no seed transition. Live-turn flicker is unchanged.
9. **Atom-aware user rows.** `UserRowCell` switches from a plain `<span>` body to a body that renders `userMessage.attachments` as inline atoms when present, falling back to plain text for legacy or attachment-empty turns.
10. **`TugListView` prefetching protocol.** `delegate.prefetchForIndices(indices)` / `delegate.cancelPrefetchForIndices(indices)` plus a viewport-prediction window. Delegate-only — `TugListView` does not assume any specific prefetch behavior; consumers decide.
11. **Tuglaws walkthrough + plan close-out**, mirroring the parent plan's pattern.

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
- [D03] Replay flushes **synchronously before live frames** for the same `tug_session_id` on tugcode's IPC stdout — Claude's stream-json output is buffered and flushed after `replay_complete`.
- [D04] Replay is **idempotent at the reducer level** via `msg_id` deduping; defense-in-depth against supervisor double-replay.
- [D05] Bracket events are **first-class** — `replay_started` / `replay_complete` are decoded events the reducer handles, not protocol-level metadata.
- [D06] Translation is **direct JSONL → `CODE_OUTPUT`** with the surveyed shape inventory; unknown shapes log + skip per `tide::replay::unknown_shape`.
- [D07] **Sticky id for replay-committed turns only** — the JSONL-derived `msg_id` is the row's id from frame zero; no remount on replay. Live-turn flicker remains unchanged from v1 (resolved by imperative DOM pooling, tracked in #roadmap).
- [D08] **Orphan turns at replay boundary synthesize as `turn_complete(error)`** — interrupted, matching live `interrupt()` semantics; user's submission stays visible with the accumulated assistant text and an interrupted marker.
- [D09] **No SESSION_METADATA replay in v1** — replay-committed code rows show the *current* model name; per-row historical model tracked as a follow-on.
- [D10] **Replay performance budget** — soft 2s (placeholder gains count-aware copy), hard 10s (truncate replay; resume with empty transcript); incremental batched commit so the UI stays responsive.
- [D11] **`replaying` phase value** on `CodeSessionSnapshot.phase` — drives `canSubmit: false` and the placeholder via the existing `data-phase` cascade.

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
- `CodeSessionSnapshot` exposes the bracket signal via the new `replaying` phase value per [D11], plus the `lastReplayResult` field for telemetry / dev surface.

---

#### [D06] Direct JSONL → `CODE_OUTPUT` (DECIDED) {#d06-direct-translation}

**Decision:** The translator goes directly from JSONL entries to the `CODE_OUTPUT` `OutboundMessage` shape, bypassing the live-stream-json intermediate format.

**Rationale:**

- JSONL entries have their own field layout (`parentUuid`, `promptId`, `message.role`, `message.content[]`, `toolUseResult`, etc.) — they're Claude's *internal* persistence format, not the live wire format.
- Going JSONL → stream-json → `OutboundMessage` would require synthesizing stream-json tokens (`stream_event` wrappers, `delta` annotations, `is_partial` flags) that don't exist in the JSONL — fabricating events.
- Going direct produces complete `OutboundMessage`s for committed turns: a single `assistant_text` with `is_partial: false`, no streaming partials. Replay should land a turn at a time, not stream it character-by-character — the user is resuming, not watching a fresh response.

**Surveyed JSONL shapes (real `~/.claude/projects/<dir>/*.jsonl` files on this machine).** Top-level entry types observed across 30+ files:

| Top-level `type` | Frequency | Translator action |
|---|---|---|
| `assistant` | high — most lines after `user` | translate per `message.content[]` block (text → `assistant_text`, `tool_use` → `tool_use`, `thinking` → `thinking_text`); `stop_reason: "end_turn"` marks the turn boundary and triggers `turn_complete(success)` |
| `user` | high | distinguish: a `user` entry whose `message.content[]` carries `text` blocks is a user submission → `user_message`; one whose content is `tool_result` blocks is a tool response → `tool_result` event(s) keyed on `tool_use_id` |
| `attachment` | medium — bracketing user messages | skip (Claude bookkeeping; tool listings, skill listings, file references — not transcript-visible) |
| `queue-operation` | low | skip (Claude's internal scheduling marker) |
| `last-prompt` | low | skip (bookmark for `--continue`; not transcript content) |
| `file-history-snapshot` | low — long sessions only | skip (Claude's file-tracking metadata) |
| `ai-title` | low | skip (Claude's auto-generated session title; not transcript) |
| `system` | low — once per session | skip (`system_init`-style bookkeeping; live `session_init` from the resumed Claude subprocess populates `SessionMetadataStore`, see [D09]) |
| `permission-mode` | low — on permission changes | skip (UI-visible at the chrome layer, not the transcript) |

Content blocks observed inside `message.content[]`:

| Block `type` | Translator action |
|---|---|
| `text` | `assistant_text(is_partial: false)` (when on `assistant`); included verbatim in user submission text (when on `user`) |
| `tool_use` | `tool_use` event with the block's `id`, `name`, `input` |
| `tool_result` | `tool_result` event keyed on `tool_use_id`; `is_error` and content carried through |
| `thinking` | `thinking_text(is_partial: false)` |
| `image` | translator emits the `user_message` with an attachment; no `image` is shown in the v1 user-row body (out of scope per [D11] from the parent plan) |

**Open shape policy.** Claude's JSONL format evolves with new releases — the inventory above is "what we observed, when we surveyed." Unknown top-level types and unknown content-block types are **logged via `tide::replay::unknown_shape` telemetry and skipped**. The drift signal is observable; the transcript stays best-effort. A future P15-style version-gate could promote unknown shapes to a structured divergence event, but v1 picks the simpler "log + skip" path.

**Turn-boundary detection.** A turn's terminal event is the `assistant` entry with `message.stop_reason: "end_turn"`. All `assistant` entries with `stop_reason: "tool_use"` or `null` are intermediate — emit their content blocks but don't fire `turn_complete` yet. The translator carries a small per-turn buffer (`current_msg_id`, accumulated text, accumulated tool-call set) that's flushed as a `turn_complete(success)` when the terminal `end_turn` lands.

**Implications:**

- Translator: `function translateJsonlEntry(entry, ctx): OutboundMessage[]` where `ctx` carries the per-session id, msg-id sequencing, the per-turn buffer, and the current `current_msg_id`.
- Per-turn output is a fixed sequence: `user_message` (echoing the user's submission), then any `tool_use` / `tool_result` events interleaved per `tool_use_id`, then `thinking_text` (if any) before the terminal text, then a single `assistant_text(is_partial: false)`, then `turn_complete(success)`.
- Replayed turns thus look to the reducer like very fast live turns: open, possibly some tool work, terminal text, complete. The reducer's existing turn-commit machinery handles them.

**Alternative considered:**

- Going through stream-json: rejected because synthesis adds complexity for no benefit; the JSONL already records the canonical shape of what Claude actually produced.

---

#### [D07] Sticky seed for replay-committed turns (DECIDED) {#d07-sticky-seed}

**Decision:** For turns landing via replay, the `TideTranscriptDataSource` reads `msg_id` from the JSONL-derived `turn_complete` event and uses `${msgId}-{user|code}` as the row's id from frame zero. No seed rewrite, no remount. **Live-turn flicker (the v1 awaiting-first-token remount) is unaffected by this step** and remains a tracked follow-on, naturally resolved by the imperative-DOM-pool plan.

**Rationale:**

- The v1 protocol's seed transition exists because, on a live submit, `activeMsgId` is unknown until the first `assistant_text` partial lands. Replay-committed turns don't have this gap — the JSONL carries the full `msg_id` up front, so the data source mints a stable id at commit time.
- Trying to "fix" live-turn flicker via the same sticky-seed mechanism doesn't actually work: any rewrite of the React wrapper's key string identity is a remount, regardless of how cleverly the data source tracks the seed-to-real transition. The honest win is replay-correctness; live flicker needs DOM that survives wrapper-key changes (imperative pool), not a smarter id protocol.
- The patch happens inside the data source's id-resolution function — not inside React state. The reducer is unaffected.

**Implications:**

- `TideTranscriptDataSource.idForIndex(index)` for replay-committed indices reads `transcript[k].msgId` directly and returns `${msgId}-{user|code}`. No seed; no rewrite path engaged.
- For live in-flight indices, the v1 protocol stays: `${INFLIGHT_ID_SEED}-{user|code}` until `activeMsgId` is set, then `${activeMsgId}-{user|code}`. The single remount per live turn is preserved as a documented follow-on, not a regression.
- Tests assert: replay-committed turns produce id stability across the entire turn lifecycle (no seed transition observed); live turns continue to exhibit the v1 single-remount behavior.

**Corrects the parent plan's optimistic framing.** The `Roadmap: right away` bullet in [tugplan-tug-list-view.md #roadmap](./tugplan-tug-list-view.md#roadmap) implied a more general "stable in-flight ↔ committed id" win is possible. That implication is wrong without a DOM-survives-key-changes mechanism (imperative pool). This step ships the genuine, scoped win.

---

#### [D08] In-flight turn at replay boundary (DECIDED) {#d08-orphan-turn}

**Decision:** When the JSONL ends mid-turn — the last `assistant` entry has `stop_reason: "tool_use"` or `null`, or the last entry is a `user` submission with no answering `assistant` — the translator synthesizes a `turn_complete(error)` (interrupted) for the orphaned turn. The accumulated text is preserved, matching what the reducer does on a live `interrupt()` ([tugplan-code-session-store.md test-06 path](../tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.105/test-06-interrupt-mid-stream.jsonl)).

**Rationale:**

- A reload mid-stream is a real, common case (user closes laptop while a response is generating; HMR fires while a tool is running). The orphan turn is on disk; it has user-visible content the user *put there*.
- Three options exist: (a) skip orphans entirely (last user_message visible-but-unanswered, jarring); (b) synthesize `turn_complete(success)` (lies — Claude didn't finish); (c) synthesize `turn_complete(error)` (matches Claude's own "interrupted" semantics). (c) is correct.
- The reducer already handles `turn_complete(error)` cleanly via the interrupt path. The committed `TurnEntry.result` is `"interrupted"`, which is the truthful state of what happened.

**Implications:**

- The translator carries a per-turn buffer; at end-of-file, if the buffer holds a turn that hasn't seen its terminal `end_turn`, it emits the synthesized `turn_complete(error)` before `replay_complete`.
- An orphan turn with no `assistant` content at all (user submitted, page reloaded before Claude responded) lands as a `TurnEntry` with `assistant: ""` and `result: "interrupted"`. The cell renderer handles empty assistant text gracefully.
- A test in Step 1 covers this: a fixture JSONL that ends mid-turn produces a transcript with the orphan committed as interrupted.

**Alternative considered:**

- Skip orphans: rejected because the user's submission visibly disappears, which is a different kind of regression than the one we're fixing.

---

#### [D09] SESSION_METADATA replay policy (DECIDED) {#d09-metadata-policy}

**Decision:** v1 does **not** replay `SESSION_METADATA` events. The live `system_init` / `system_metadata` from the resumed Claude subprocess populates `SessionMetadataStore.model` for the current session. All replay-committed `code` rows display the **current** model name in their identifier line, even if the historical session spanned model changes.

**Rationale:**

- Replaying SESSION_METADATA per-turn would produce flicker as different replayed rows commit with different historical models. UI ergonomics > strict accuracy for v1.
- The Tide card's chrome shows the current model — the transcript inheriting that name is consistent with the rest of the surface.
- The historical model is observable in the JSONL (each `assistant` entry's `message.model` field). A future refinement could surface per-row historical model when a session is known to span versions, but that's a polish item, not a v1 concern.

**Implications:**

- The translator does not emit any `SESSION_METADATA` events; it only emits CODE_OUTPUT events.
- `useSessionModelName(sessionMetadataStore)` returns the same value for every code row in the rendered transcript — which is what users will expect.
- Documented as a known-trade-off in [#roadmap]: "per-row historical model in transcripts."

**Known surface artifact — model-name flash on resume.** Replay-committed code rows commit *before* the resumed Claude subprocess emits its post-`--resume` `system_init` (which lands on the live wire after `replay_complete`). For the gap between `replay_complete` and that first live `system_init`, `useSessionModelName(sessionMetadataStore)` returns `null` and `CodeCommittedRowCell` shows `CODE_DEFAULT_IDENTIFIER = "Code"` for every replayed row. Once `system_init` lands, all rows flip to the model name in the same render. This brief flash is acceptable for v1 (it matches the pre-binding cold-start behavior of the live path) but worth recording so a future polish item can pre-stage the metadata read from the JSONL's `system` entry, or hold the placeholder for a few hundred ms longer. Not a blocker.

**Alternative considered:**

- Replay per-turn `SESSION_METADATA`: rejected for v1 because the UI consequence (model-name flicker on resume scroll) is worse than the accuracy gain.

---

#### [D10] Replay performance budget (DECIDED) {#d10-perf-budget}

**Decision:** Replay runs incrementally with two budget thresholds:

- **Soft budget — 2 seconds.** If `replay_complete` hasn't landed by 2s after `replay_started`, the `TideRestoring` placeholder updates from "Loading conversation…" to "Loading conversation… (N turns)" with a live count. The placeholder remains visible; the user sees progress.
- **Hard budget — 10 seconds.** If `replay_complete` hasn't landed by 10s, the placeholder switches to "Conversation history unavailable; resuming with empty transcript" and the supervisor truncates remaining replay output. Live frames flow normally afterward; the user can submit new turns.

**Implementation:**

- The translator emits replay events in batches (e.g. 16 turns per `await new Promise(setImmediate)`) so the IPC pipe stays responsive and the per-turn `turn_complete` lands at the reducer with enough yield for the React layer to repaint.
- The supervisor times the replay window per session and includes timing in the structured `tide::replay::complete` log line.
- The hard timeout fires from the supervisor side; the translator drops remaining JSONL lines and emits `replay_complete { error: { kind: "replay_timeout", message: "..." } }`.

**Rationale:**

- Real machines have JSONLs of 37K+ lines (largest on this dev machine). Synchronous parse-and-emit of that whole file blocks the IPC pipe for seconds.
- Without a budget, a slow disk or a corrupted JSONL produces a stuck "Loading conversation…" pane with no recovery. The hard cutoff guarantees a Tide card always becomes interactive within 10s of binding.
- The soft-budget count update is cheap and gives the user a sense of "still working."

**Implications:**

- A new `tide::replay::progress` structured log line fires every batch with the running count.
- The placeholder copy in `TideRestoring` gains a count-aware variant for the soft-budget state.
- A Step 5 test covers the hard-budget path: a fixture JSONL with synthetic delay produces the truncated state.

---

#### [D11] Snapshot `replaying` phase (DECIDED — supersedes prior open question) {#d11-replaying-phase}

**Decision:** `CodeSessionSnapshot.phase` gains a `replaying` value. The reducer enters `replaying` on `replay_started` and leaves on `replay_complete`. `canSubmit` is `false` while `replaying`. `canInterrupt` is `false`. The prompt entry's existing `data-phase` cascade picks up the new value automatically.

**Rationale:**

- The alternative — keeping replay state internal and deriving `canSubmit` from a private flag — leaks every consumer that wants to know about replay through a separate channel. A single phase value is the canonical signal the snapshot already uses.
- `phase` is a discriminated union; adding a value is additive. Existing consumers that switch on `phase` get a TypeScript exhaustiveness error if they forget the new case — surfaces the change at build time, which is exactly what we want.
- The prompt entry already disables submit while `phase` is non-idle; the new value rides that path with zero new wiring.

**Implications:**

- `CodeSessionPhase` union extended with `"replaying"`.
- Reducer's `canSubmit` derivation: `phase === "idle" && transportState === "online"` becomes `(phase === "idle" || phase === "errored") && transportState === "online"` (the existing form) — `replaying` naturally falls outside the OR.
- `canInterrupt` derivation excludes `replaying`.
- Existing exhaustiveness checks at consumer sites flag the new case at compile time — fix-forward.

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
    kind:
      | "jsonl_missing"        // file does not exist at expected path
      | "jsonl_unreadable"     // file exists but cannot be read (permissions, etc.)
      | "jsonl_malformed"      // file exists, partial parse failures
      | "replay_timeout";      // [D10] hard-budget timeout
    message: string;
  };
}
```

Between `replay_started` and `replay_complete`, the bridge emits the same event shapes the live wire produces — but with `is_partial: false` on every text event (replay is per-turn, not per-token, see [D06]).

#### `CodeSessionPhase` extension per [D11] {#code-session-phase}

```ts
type CodeSessionPhase =
  | "idle"
  | "submitting"
  | "awaiting_first_token"
  | "streaming"
  | "tool_work"
  | "awaiting_approval"
  | "replaying"           // NEW — set on `replay_started`, cleared on `replay_complete`
  | "errored";
```

`canSubmit` is false during `replaying`; `canInterrupt` is false during `replaying`. The Tide card's existing `data-phase` cascade picks up the new value automatically.

#### `CodeSessionSnapshot.lastReplayResult` (NEW) {#last-replay-result}

```ts
interface LastReplayResult {
  kind: "success" | "jsonl_missing" | "jsonl_unreadable" | "jsonl_malformed" | "replay_timeout";
  message: string;
  count: number;            // turns committed before the result was determined
  at: number;               // Date.now() at `replay_complete`
}
```

`null` until the first `replay_complete` lands; populated on **every** `replay_complete` thereafter, including success (`kind: "success"`, `message: ""`). The `TideRestoring` placeholder reads this for the timeout-state copy; telemetry / dev-surface readers can distinguish success from each error variant by `kind`. Cleared back to `null` only on a fresh `replay_started` for the next resume.

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
- **L02** — External state via `useSyncExternalStore`. Replay events reach React via the existing reducer-snapshot path; the new `replaying` phase value flows through the same snapshot subscription. ✓
- **L03** — `useLayoutEffect` for registrations events depend on. The "loading conversation…" placeholder mounts via the existing `TideRestoring` flow — no new layout-effect work. ✓
- **L04** — Never measure child DOM inline. Replay does not touch DOM directly. ✓
- **L06** — Appearance via CSS / DOM. The "loading" beat reuses the `TideRestoring` styles plus a count-aware variant for [D10]'s soft-budget state. ✓
- **L10** — One responsibility per layer. Translator lives in tugcode (where the live stream-json → `OutboundMessage` translation already lives, per [D01]); session lifecycle stays in tugcast supervisor; UI placeholder stays in the Tide card. No layer reaches across. ✓
- **L11** — Controls emit, responders own state. Prefetch dispatch fires `delegate.prefetchForIndices`; consumer responders handle as appropriate. ✓
- **L19** — Component authoring guide. No new tugways primitives in this plan. ✓
- **L20** — Token sovereignty. No new tokens introduced. ✓
- **L22** — Store observers may write DOM. The streaming `code` cell's observer pattern is unaffected — replay produces only committed cells. ✓
- **L23** — User-visible state preserved across DOM-down transitions. **This plan satisfies L23 via a third preservation mechanism — external archive replay.** The two mechanisms named in L23 are *in-session minimal mutation* (DOM stays alive across pane moves / activations / cmd-tab) and *cross-session [A9] save/restore* (DOM comes down, bag captures and restores user-visible state to tugbank). The transcript content is preserved by neither: it lives on Claude's per-session JSONL on disk, written by Claude itself as the session progresses. On resume, the supervisor reads the JSONL and replays its events through the wire so the reducer reconstitutes `transcript`. This is a third valid mechanism for the same law — the data is preserved by an external system that is the canonical source of truth, and we read it back at the same moment the protocol calls for restoration. L23's intent ("user data must survive transitions; pick the mechanism that matches the transition class") is met. ✓ (after Phase A lands)
- **L24** — State zones. No new state-zone violations. The `replaying` phase value lives in the structure zone (snapshot field, drives `data-phase` cascade); the placeholder text is appearance zone (CSS-driven via `data-phase`). ✓

**Note on L21.** L21 governs third-party code licensing, not Vite's `import.meta.hot` surface (an earlier plan draft conflated the two). This plan uses no new third-party libraries; L21 has no application here.

---

### Execution Steps {#execution-steps}

> Each step is its own commit. `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, and `cargo nextest run` pass at the end of every step.

#### Phase A — Resume from JSONL {#phase-a}

#### Step 0: Persist `claude_session_id` and thread it through resume (absorbs [§P14](./tide.md#p14-claude-resume)) {#step-0}

**Commit:** `tide(resume): persist claude_session_id; thread --resume on rebound spawns`

**References:** [tide.md §P14](./tide.md#p14-claude-resume), [tide.md §T0.5 P14 entry-point table](./tide.md#p2-integration-reference), [agent_supervisor.rs:1484](../tugrust/crates/tugcast/src/feeds/agent_supervisor.rs)

**Why this is Step 0.** The rest of Phase A reads `~/.claude/projects/<encoded-project-dir>/<claude_session_id>.jsonl`. Today, `claude_session_id` is captured in-memory in `relay_session_io`'s atomic-promote block but never persisted — `agent_supervisor.rs:1484` writes `claude_session_id: None` on every `spawn_session_ok`, and `rebind_from_tugbank` rehydrates with `None`. Without this step, the subsequent steps have no claude_session_id to key the JSONL lookup on, and Claude itself spawns fresh on every reload (no `--resume` flag is passed). This step is exactly the [§P14](./tide.md#p14-claude-resume) work, absorbed here because it's the load-bearing prerequisite for everything else in Phase A.

**Artifacts:**

- `tugrust/crates/tugcast/src/feeds/agent_bridge.rs` — extend `relay_session_io`'s atomic-promote block (the lock-held section that captures `claude_session_id` from `session_init`) to also write `claude_session_id` into tugbank under `dev.tugtool.tide.session-keys`. The write happens in the same critical section as the in-memory ledger update so persistence and in-memory state can never diverge per [tide.md §P14 Step 1](./tide.md#p14-claude-resume).
- `tugrust/crates/tugcast/src/feeds/agent_supervisor.rs` — `do_spawn_session`'s Phase 2 tugbank write at line 1481-1486 currently emits `claude_session_id: None` always. Update so a reconnect (existing ledger entry) preserves the persisted `claude_session_id` instead of clobbering it with `None`. New ledger entries continue to write `None` until `session_init` lands and the atomic-promote block updates the record.
- `tugrust/crates/tugcast/src/feeds/agent_supervisor.rs` — `rebind_from_tugbank` reads `SessionKeyRecord.claude_session_id` from the tugbank blob and rehydrates the `LedgerEntry::claude_session_id` field. The `--resume` flag in the spawn args path (built around line 1517 of [tide.md §P14 Step 2](./tide.md#p14-claude-resume)) then sees `Some(id)` and threads it into `TugcodeSpawner`.
- `tugrust/crates/tugcast/src/feeds/agent_bridge.rs` — `TugcodeSpawner` (or its config builder) gains an optional `resume_claude_session_id` field. `spawn_session_worker` reads `entry.claude_session_id` after rebind populates it; if `Some`, the spawned tugcode subprocess gets `--resume <id>` (or an env var); if `None`, fresh spawn.
- `tugcode/src/session.ts` — replace the legacy resume-id read from the `dev.tugtool.app / session-id` singleton path (carried over from before multi-session) with a read from the new `--resume-session <id>` CLI flag (or env var) the supervisor passes on spawn. tugcode's own singleton tugbank write goes away — supervisor owns persistence ([tide.md §P14 Step 3](./tide.md#p14-claude-resume)).
- `tugrust/crates/tugcast/src/feeds/agent_supervisor.rs` — `do_reset_session` invalidates `claude_session_id` (tugbank delete + in-memory clear) **before** killing the subprocess so the next spawn is fresh per [tide.md §P14 Step 4](./tide.md#p14-claude-resume). `do_close_session` does **not** invalidate — a closed card can be reopened with history. **Idempotency invariant:** the invalidate-then-kill sequence treats the kill step as best-effort; if the subprocess kill fails (process already exited, signal lost, etc.), persistence is already cleared and the next spawn is fresh — there is no recovery path that re-introduces the old `claude_session_id`. A retry of `reset_session` on a partially-completed prior reset finds nothing to invalidate (already gone) and proceeds to the kill step (which is also idempotent in the supervisor's existing semantics). Net: persistence always becomes consistent with "session reset"; ledger consistency follows on next `spawn_session_ok`.

**Tasks:**

- [x] Extend `agent_bridge.rs::relay_session_io` atomic-promote block with the tugbank persistence write.
- [x] Update `do_spawn_session`'s Phase 2 record write to preserve persisted `claude_session_id` on reconnects.
- [x] Wire `rebind_from_tugbank` to read `claude_session_id` back into the rehydrated `LedgerEntry`.
- [x] Add `resume_claude_session_id` to `TugcodeSpawner` config; thread through spawn args. *Implemented as a per-call parameter on `ChildSpawner::spawn_child` (with `build_tugcode_command` appending `--resume-session <id>` when `Some`); `run_session_bridge` reads `entry.claude_session_id` before each spawn iteration and threads it through. Cleaner than per-instance state because the resume id is tied to the session, not the spawner.*
- [x] Update tugcode to read the resume id from CLI/env (drop the legacy singleton tugbank path). *No legacy singleton path existed in production tugcode (`getTugbankClient` was unused outside of test setup), so this work reduced to the canonical change: `main.ts` parses `--resume-session <id>`, threads through `SessionManager` constructor's optional fourth arg, `initialize()` prefers the persisted id over `sessionId` for the claude `--resume <id>` invocation. The synthesized `session_init` IPC line also carries the actual claude id we spawned with so tugcast's atomic-promote block doesn't briefly persist the wrong value.*
- [x] Wire `do_reset_session` to invalidate `claude_session_id` in tugbank + in-memory before subprocess restart. *Also flips `entry.session_mode` back to `New` so the next spawn is truly fresh — without this, a `Resume`-mode entry whose claude_session_id was just cleared would still tell tugcode `--session-mode resume`, and tugcode's fallback path (`resumeSessionId ?? sessionId`) would tell claude to resume the JSONL still on disk.*

**Tests:**

- [x] `test_session_init_persists_claude_session_id` — drives `relay_session_io` via duplex streams; asserts tugbank gets the write atomically with the ledger update ([tide.md §P14 Step 5](./tide.md#p14-claude-resume)).
- [x] `test_spawn_session_preserves_persisted_claude_session_id_on_reconnect` — covers the reconnect path (`!inserted` branch) by mid-life setting `entry.claude_session_id`, calling `spawn_session` again, and asserting the persisted record still carries the id. *Renamed from the plan's tentative `test_spawn_session_resumes_persisted_claude_session_id` to better describe what it actually pins (the reconnect-time preserve, not the spawn-time read).*
- [x] `test_rebind_rehydrates_claude_session_id` — asserts a fresh supervisor over a tugbank record carrying `claude_session_id: Some(...)` rebinds the entry with that id populated, so the next spawn after rebind threads `--resume-session <id>` through correctly.
- [x] `test_reset_session_clears_persisted_claude_session_id` — asserts `reset_session` deletes the claude_session_id binding before the subprocess restart.
- [x] `test_close_session_preserves_claude_session_id` — asserts a `close_session` followed by (cold-boot rebind +) `spawn_session(mode=resume)` rehydrates the persisted id. The cold-boot path is simulated by spinning up a fresh `AgentSupervisor` over the same store after the close-side dropped its supervisor.
- [x] Existing `test_close_session_deletes_tugbank_entry` flipped to `test_close_session_preserves_tugbank_entry` and `test_close_session_logs_on_tugbank_delete_failure_and_continues` flipped to `test_close_session_does_not_call_tugbank_delete` to match the new contract (close preserves; only `reset_session` deletes).
- [x] tugcode unit tests: `[P14] SessionManager resumeSessionId` describe-block covers the constructor's fourth arg (set / undefined / empty-string coercion); `[P14] main.ts --resume-session argv` covers the CLI parsing end-to-end via spawned `bun run main.ts`.
- [ ] Real-claude integration test: `test_close_then_reopen_preserves_history` — open a session, exchange a turn that establishes known context ("remember the word gazebo"), close the WebSocket, reopen, send a probe ("what word did I tell you to remember?"), assert the response contains "gazebo". Pins the resume path end-to-end. **CI gating:** matches the existing tugcast real-claude convention — `#[cfg(feature = "real-claude-tests")]` + `#[ignore]` + `TUG_REAL_CLAUDE=1` env gate (see `tugrust/crates/tugcast/Cargo.toml` lines 52–70 and the `multi_session_real_claude` test for the canonical pattern). Default `cargo nextest run` does not enumerate it. Local invocation: `TUG_REAL_CLAUDE=1 cargo test -p tugcast --features real-claude-tests test_close_then_reopen_preserves_history -- --ignored`. The test lives either in the existing `multi_session_real_claude.rs` integration target or a sibling `resume_real_claude.rs` if it grows enough fixtures to warrant its own. Step 0's automated checkpoint runs the default suite; **this test is deferred to Step 5 as part of Smoke B / C verification** — Step 0 ships the plumbing and the unit tests that pin each link in the chain; the real-claude end-to-end runs once when the JSONL replay UI lands and we can observe both the Step 0 resume of Claude's own context and the Step 5 wire-side replay together.

**Checkpoint:**

- [x] `bun x tsc --noEmit` — exit 0.
- [x] `bun test` — green (210 tugcode tests + 2945 tugdeck tests).
- [x] `cargo nextest run` — green (1207 workspace tests, 9 skipped).

**Note:** This step ships the `--resume` plumbing without any JSONL-replay UI work. After Step 0 lands, a card that reloads will *resume Claude itself* (Claude reads its own JSONL into context), but tugdeck's transcript pane will still show empty until Step 3 — Claude has the conversation context, but the wire is silent on history. Steps 1–5 close the remaining gap.

---

#### Step 1: tugcode JSONL → `CODE_OUTPUT` translator (pure module) {#step-1}

**Commit:** `tugcode(replay): JSONL entry → OutboundMessage translator`

**References:** [D01] translator-location, [D06] direct-translation, [#replay-protocol]

**Artifacts:**

- New `tugcode/src/replay.ts` exporting:
  - `interface JsonlEntry` — a permissive shape covering the surveyed variants per [D06]: top-level `user`, `assistant`, `attachment`, `queue-operation`, `last-prompt`, `file-history-snapshot`, `ai-title`, `system`, `permission-mode`. Content-block types inside `message.content[]`: `text`, `tool_use`, `tool_result`, `thinking`, `image`. Unknown shapes are accepted at parse time and dispatched to a skip-with-telemetry path at translate time.
  - `interface TranslateContext` — per-translation state: `tug_session_id`, msg-id sequencing, the per-turn buffer (`current_msg_id`, accumulated text, accumulated `Map<tool_use_id, ToolCallState>`), and a counter of committed turns.
  - `function translateJsonlEntry(entry: JsonlEntry, ctx: TranslateContext): OutboundMessage[]` — takes one entry, returns 0..N outbound messages, mutates `ctx`'s per-turn buffer.
  - `function translateJsonlSession(jsonl: string, tugSessionId: string, opts?: { batchSize?: number }): AsyncIterable<OutboundMessage>` — top-level async iterator that lexes the JSONL line by line, drives `translateJsonlEntry`, yields outbound messages in batches per [D10]'s incremental commit policy, emits `replay_started` at the start, the synthesized `turn_complete(error)` for any orphan turn per [D08], and `replay_complete` at the end.
- Unit tests in `tugcode/src/__tests__/replay.test.ts` against fixture JSONLs — at minimum:
  - A simple two-turn session (user → assistant(end_turn) → user → assistant(end_turn)).
  - A turn with one `Bash` tool call (user → assistant(tool_use, stop_reason=tool_use) → user(tool_result) → assistant(end_turn)).
  - A turn with concurrent tool calls (multiple tool_use blocks in one assistant entry, then multiple tool_result entries before the terminal assistant).
  - A turn with `thinking` content blocks before the terminal text.
  - A turn with an `image` content block in the user submission.
  - An attachment-only entry (`hook_success`, `task_reminder`, `skill_listing`, `file`) — skipped silently.
  - A `queue-operation` / `last-prompt` / `file-history-snapshot` / `ai-title` / `system` / `permission-mode` entry — each skipped silently with telemetry.
  - An unknown top-level type — skipped via `tide::replay::unknown_shape` log.
  - An orphan turn at end-of-file (last `assistant.stop_reason: "tool_use"` or last entry is `user`) — synthesizes `turn_complete(error)` per [D08].
  - A malformed JSON line — skipped with a warning, not fatal; surrounding turns still commit.

**Tasks:**

- [x] Author the per-entry translator with explicit handling for each surveyed `type` value; unknown types log to `tide::replay::unknown_shape` and skip.
- [x] Implement the per-turn buffer + boundary detection: an `assistant` entry with `message.stop_reason: "end_turn"` triggers `turn_complete(success)`; entries with `stop_reason: "tool_use"` accumulate into the buffer.
- [x] Implement [D08]'s orphan-turn synthesis at end-of-file.
- [x] Author the session-level async iterator with batched yields per [D10].
- [x] Convert representative JSONLs into anonymized test fixtures. *Built inline in `replay.test.ts` as `JsonlEntry[]`-driven `makeJsonl(...)` builders rather than separate fixture files: the entries are small, anonymized, and live next to their assertions. A future expansion (e.g. a 1000-line stress fixture for performance regressions) can land as a real file under `__tests__/fixtures/jsonl/` without disturbing the inline tests.*
- [x] Author unit tests covering the cases above.

**Tests:**

> Step 1 tests assert the translator's `OutboundMessage[]` output shape directly — the tugdeck reducer is exercised in Step 2 and the cross-package wire integration is exercised in Step 5. No reducer is imported in `tugcode/`.
- [x] Two-turn smoke: translator output is the expected `OutboundMessage[]` sequence — for each turn: `user_message_replay`, optional intermediate `tool_use` / `tool_result` events, terminal `assistant_text(is_partial: false)`, `turn_complete(success)` carrying the turn's `msg_id` and assembled text. *Outbound shape is `user_message_replay` (not `user_message`) per the new `OutboundMessage` variant added in Step 1 — `user_message` is reserved for the inbound `tugcast → tugcode` shape; the replay echo is a distinct outbound type carrying `msg_id` so the reducer can correlate it with the upcoming `assistant_text` / `turn_complete`.*
- [x] Tool-call turn: emits `user_message_replay` + `tool_use` + `tool_result` + terminal `assistant_text(is_partial: false)` + `turn_complete(success)` in the right order.
- [x] Concurrent tools: `tool_use` and `tool_result` events interleave by `tool_use_id` correctly in insertion order ([Q02]).
- [x] Thinking content: `thinking_text(is_partial: false)` lands before the terminal `assistant_text` in the same turn.
- [x] Image content in user submission: `user_message_replay` carries the image attachment with `media_type` + base64 `content`.
- [x] Skipped shapes: `attachment` / `queue-operation` / `last-prompt` / `file-history-snapshot` / `ai-title` / `system` / `permission-mode` all produce zero outbound messages each; surrounding turns still commit; **silent** (no telemetry fires for skip-listed types — telemetry is reserved for shape-drift signals).
- [x] Unknown top-level type: produces zero outbound messages and fires `unknown_shape` telemetry with `kind: "top_level"`.
- [x] Unknown content_block type: skipped with `unknown_shape` telemetry; surrounding text content of the same entry still emits.
- [x] Orphan turn at end-of-file: synthesizes `turn_complete(error)` with accumulated text + tool_use + thinking preserved.
- [x] Bare user submission at end-of-file (no answering assistant): commits no turn; the buffer is opened by `assistant`, not `user`, so an unanswered submission lands as zero-turn replay.
- [x] Malformed JSON line: skipped; surrounding turns commit; `replay_complete` carries `error: { kind: "jsonl_malformed" }` while still counting the committed turns.
- [x] Empty JSONL: produces `replay_started` immediately followed by `replay_complete` with `count: 0` and no error.
- [x] Missing JSONL: `translateJsonlSession({ kind: "missing", message })` yields `replay_started` then `replay_complete` with `error: { kind: "jsonl_missing", ... }`; no transcript events between brackets.
- [x] Unreadable JSONL: same shape as missing, with `kind: "jsonl_unreadable"`.
- [x] Batched commit per [D10]: with `disableYield: false` and `batchSize: 2`, a `setTimeout(0)` scheduled before iteration fires mid-stream — proving the iterator yields the event loop between batches.
- [x] Direct `translateJsonlEntry` unit tests covering: user entry returns `[]`, intermediate assistant returns `[]`, terminal assistant flushes + resets ctx, unknown / missing-type telemetry, ipc_version stamping.

**Checkpoint:**

- [x] `bun x tsc --noEmit` — exit 0 (tugdeck typecheck still green; tugcode TS changes are additive and the existing test suite continues to typecheck).
- [x] `bun test` (in `tugcode/`) — 237 tests pass (210 prior + 27 new replay tests).
- [x] `cargo nextest run` — 1207 workspace tests pass (no Rust changes; sanity).

---

#### Step 2: tugdeck reducer handles `replay_started` / `replay_complete` {#step-2}

**Depends on:** #step-1

**Commit:** `tide(transcript): reducer handles replay bracket events`

**References:** [D04] idempotency, [D05] bracket-events, [D11] replaying-phase

**Artifacts:**

- `tugdeck/src/lib/code-session-store/events.ts` — extend the discriminated-union event type with `ReplayStartedEvent` and `ReplayCompleteEvent`.
- `tugdeck/src/lib/code-session-store/types.ts` — extend `CodeSessionPhase` with `"replaying"` per [D11]. Update the `canSubmit` and `canInterrupt` derivations in the snapshot builder so `replaying` excludes both.
- `tugdeck/src/lib/code-session-store/reducer.ts` — handle both events:
  - `replay_started`: transition `phase: {idle | errored} → replaying`. Clear `pendingUserMessage` defensively (replay should never see one). Replay must only run from `idle` or `errored` (a fresh `spawn_session_ok` for a previously-errored card transitions `errored → idle` before replay begins, so by the time `replay_started` lands the phase is `idle`; the `errored` case is an explicit invariant in case the supervisor sequences differently). `replay_started` from `submitting` / `awaiting_first_token` / `streaming` / `tool_work` / `awaiting_approval` / `replaying` is a logged warning + drop.
  - `replay_complete`: transition `phase: replaying → idle`. **Always** populate `lastReplayResult: { kind, message, count, at: Date.now() }` — `kind: "success"` with empty `message` on the no-error path, the matching error kind otherwise.
- Snapshot dedupe: `committedMsgIds: Set<string>` derived from `transcript.map(t => t.msgId)` (lazy, recomputed when transcript changes). `turn_complete` with a `msg_id` already in the set is a no-op + debug log per [D04].
- `tugdeck/src/lib/code-session-store/__tests__/code-session-store.replay.test.ts` — new file covering the cases listed under Tests below.

**Tasks:**

- [x] Extend the event type union with `ReplayStartedEvent` / `ReplayCompleteEvent` / `UserMessageReplayEvent`. *Three events, not two: the per-turn user-message echo is a separate event so the reducer's existing turn-commit machinery can handle replay turns "like very fast live turns" without inventing a synthesized aggregate event.*
- [x] Extend `CodeSessionPhase` with `"replaying"`; fix exhaustiveness at consumer sites. *Only one consumer-side update was needed (`tug-prompt-entry.test.tsx`'s `defaultSnapshot()` factory) — the reducer's switch-with-default and the snapshot builder cover the rest.*
- [x] Update `canSubmit` / `canInterrupt` derivations to exclude `replaying`. *No code change needed — `canSubmit` is `phase === "idle" || phase === "errored"`, which excludes `replaying` naturally; `canInterrupt` enumerates active live phases and likewise excludes `replaying`.*
- [x] Implement the three new handlers in the reducer (`handleReplayStarted`, `handleReplayComplete`, `handleUserMessageReplay`). Plus extend the live `handleTextDelta` / `handleToolUse` / `handleToolResult` to accept `replaying` phase as an *accumulator* — they update scratch + toolCallMap but skip phase transitions and `write-inflight` effects, leaving phase entry/exit to the bracket pair. `handleTurnComplete` also branches: while `replaying`, it commits a `TurnEntry` and stays in `replaying` rather than returning to `idle` (the closing bracket is what returns to idle). `handleSend` drops while `replaying` defensively.
- [x] Add `committedMsgIds` derivation + `turn_complete` dedupe. *Lives on `CodeSessionState` directly as a `Set<string>`, populated whenever `handleTurnComplete` commits an entry. A duplicate `turn_complete` for an already-committed `msg_id` is a `console.debug`-logged no-op and does not produce a second `TurnEntry`.*
- [x] Add `lastReplayResult` snapshot field; populate on every `replay_complete` (success and error variants).
- [x] Author the new test file.

**Tests:**

- [x] Bracket round-trip: `replay_started` + 2 turns + `replay_complete` produces `phase: idle`, transcript length 2, and `lastReplayResult.kind === "success"` with `count: 2`.
- [x] Errored → replaying transition: a card whose phase is `errored` accepts `replay_started`, transitions to `replaying`, commits a turn, and lands on `idle` after `replay_complete`.
- [x] Phase exposure: between `replay_started` and `replay_complete`, `phase === "replaying"`, `canSubmit === false`, `canInterrupt === false`.
- [x] `send` while replaying: the reducer drops the action (synthetic test calls `store.send("hi")` mid-replay; asserts no CODE_INPUT frame is written, no `pendingUserMessage` set, no `queuedSends`).
- [x] Mid-turn live-frame during replay: a live `assistant_text` partial that arrives while `phase === "replaying"` accumulates in scratch but does not flip phase or touch the in-flight streaming document. *Refined wording from the original "dropped with a warn" — the cleaner contract is "accumulates without side-effects": replay's own `assistant_text` events go through the same code path, so a stray live partial would be indistinguishable from a replay event mid-window. Phase + in-flight pane stay clean either way.*
- [x] Dedupe: two `turn_complete`s with the same `msg_id` produce a transcript of length 1; the second commit is a `console.debug`-logged no-op.
- [x] Error surface: `replay_started` followed by `replay_complete` with `error: { kind: "jsonl_missing" }` produces `phase: idle`, transcript length 0, `lastReplayResult.kind === "jsonl_missing"`.
- [x] Replay timeout: `replay_complete` with `error: { kind: "replay_timeout" }` sets `lastReplayResult` (with `count` reflecting the pre-timeout commits) and lets the card become interactive.
- [x] All four error variants (`jsonl_missing`, `jsonl_unreadable`, `jsonl_malformed`, `replay_timeout`) round-trip the `kind` through the snapshot.
- [x] `lastReplayResult` lifecycle: a fresh `replay_started` clears the prior window's result back to `null`; `replay_complete` outside `replaying` is a logged no-op; `replay_started` from `submitting` is a logged no-op (live-turn protection).

**Checkpoint:**

- [x] `bun x tsc --noEmit` — exit 0.
- [x] `bun test` — 2957 tugdeck tests pass (2945 prior + 12 new replay tests) + 237 tugcode tests pass.
- [x] `cargo nextest run` — 1207 workspace tests pass (no Rust changes; sanity).

---

#### Step 3: tugcode wires replay into resume-spawn flow {#step-3}

**Depends on:** #step-2

**Commit:** `tugcode(replay): emit replay before live on --session-mode resume`

**References:** [D03] replay-ordering

**Artifacts:**

- `tugcode/src/session.ts` — branch on `--session-mode` at the top of the per-session start path. **Frame-emission boundary:** tugcode owns its own IPC stdout (the pipe to tugcast); Claude owns Claude's stdout (the pipe to tugcode's stream-json reader). The "gate" is at tugcode's *IPC stdout* — tugcode emits replay-derived `OutboundMessage`s to its IPC stdout *before* it begins forwarding live events translated from Claude's stdout. Concretely:
  - `resume` mode:
    1. Locate the JSONL at `<claude_projects_root>/<encoded-project-dir>/<claude_session_id>.jsonl` (path passed in via the new `--resume-session <id>` CLI flag from Step 0; `claude_projects_root` defaults to `~/.claude/projects/` and is overridable for tests).
    2. Spawn the Claude subprocess with `--resume <claude_session_id>` so Claude internally rehydrates its context. Claude's stdout reader is created but its translated events are buffered (not yet forwarded to IPC stdout).
    3. Iterate `translateJsonlSession(...)` from Step 1; emit each yielded `OutboundMessage` to IPC stdout. The `replay_started` bracket lands first; per-turn events stream in batched flushes per [D10]; `replay_complete` lands last.
    4. Once `replay_complete` has been written to IPC stdout, drain the buffered live events from Claude's stdout reader and resume normal live forwarding.
  - `new` mode: current path; Claude spawns fresh, no replay.
- Telemetry: structured logs at `tide::replay` for `replay.started` / `replay.progress` (every batch with running count, per [D10]) / `replay.complete` / `replay.error` with timing and turn count.
- Hard-timeout enforcement: a wall-clock timer per [D10]; on expiry, abort the iterator, write `replay_complete { error: { kind: "replay_timeout", ... } }`, drop remaining JSONL lines, and resume live forwarding.

**Tasks:**

- [x] Identify the encoded-project-dir naming used by Claude (the leading `-` plus path-with-slashes-replaced-by-dashes form). Document the encoding in the module docstring.
- [x] Wire the resume branch in tugcode session start with the buffer-then-flush flow described above.
- [x] Gate live-frame *forwarding* (not Claude subprocess startup) until `replay_complete` has been written to IPC stdout.
- [x] Add the structured telemetry (`replay.started` / `replay.progress` / `replay.complete` / `replay.error`).
- [x] Implement [D10]'s hard-timeout enforcement.
- [x] If the JSONL is missing or unreadable, emit `replay_started` then `replay_complete` with `error: { kind: "jsonl_missing" | "jsonl_unreadable" }`, and proceed to live ingestion.
- [x] Bound the live-stdout buffer at a small constant (`REPLAY_LIVE_BUFFER_MAX = 1024` translated frames is more than enough — Claude on `--resume` with no new user message is essentially silent). On overflow, emit a `replay.live_buffer_overflow` warn telemetry line, stop buffering, and drain whatever was buffered after `replay_complete`. Overflow is a flag for "something pathological"; the user-visible failure mode is still safe (transcript replays; live events resume; a small live-frame slice may be dropped, recoverable via Claude's next emission). *Implementation note: tugcode does not run a continuous translation drain during replay. Because handleUserMessage is the only consumer of claude's stdout and is not invoked until after `runReplay` returns, the wire-level ordering "all replay frames precede all live frames" holds by construction. Claude's stdout sits in the OS pipe (~64 KB on Linux/macOS) during the replay window, well within bounds for the "essentially silent" `--resume` case. The constant is exported as a documented threshold; the hard-budget timeout is the ultimate safety net against a pathologically chatty claude.*
- [x] If the Claude subprocess exits *during* the replay window, abort the replay iterator, emit `replay_complete { error: { kind: "jsonl_unreadable", message: "claude_exited_during_replay" } }` (the JSONL itself is fine; the subprocess we needed to bring back online is gone), drop buffered live events, and report subprocess exit through the existing lifecycle telemetry path. The card surfaces `lastReplayResult` and stays in `idle` so the user can re-spawn manually.

**Tests:**

- [x] Tugcode-level integration test: pre-stage a fixture JSONL, start the session in resume mode against a stub Claude process, assert replay events flow on IPC stdout first, live events flow second.
- [x] Missing JSONL: resume flow still completes; the bracket pair lands with `error: { kind: "jsonl_missing" }`; live frames flow normally afterward.
- [x] Unreadable JSONL (e.g. permission denied): same as missing, with `error: { kind: "jsonl_unreadable" }`.
- [x] Hard timeout: a fixture JSONL with synthetic delay (a wrapper that throttles iteration past 10s) produces `replay_complete { error: { kind: "replay_timeout" } }` and the card-side reducer transitions to `idle`.
- [x] Buffer-then-flush ordering: live events emitted by Claude during the replay window are buffered in tugcode and forwarded to IPC stdout only after `replay_complete`; an integration test asserts the wire ordering. *Covered by construction (see implementation note above): handleUserMessage is gated until `runReplay` returns, so any live frames Claude emitted during the replay window land at IPC stdout strictly after `replay_complete`.*
- [ ] Buffer overflow: a synthetic Claude stub that emits >`REPLAY_LIVE_BUFFER_MAX` events during a slow replay produces a `replay.live_buffer_overflow` warn line; the buffered prefix is still drained after `replay_complete`; the card stays interactive. *Skipped in v1 — no continuous translation drain runs during replay, so this telemetry path doesn't exist. The hard-budget timeout covers the equivalent stuck-pipe scenario at the user-visible level.*
- [x] Claude crash mid-replay: a Claude stub that exits during the replay window produces `replay_complete { error: { kind: "jsonl_unreadable", message: "claude_exited_during_replay" } }`; the card transitions to `idle` with the populated `lastReplayResult`.

**Checkpoint:**

- [x] `bun x tsc --noEmit` — exit 0.
- [x] `bun test` (tugcode) — green.
- [x] `cargo nextest run` — green.

---

#### Step 4: Tide card "loading conversation…" UX during replay {#step-4}

**Depends on:** #step-3

**Commit:** `tide(transcript): TideRestoring beat for replay window`

**References:** [D10] perf-budget, [D11] replaying-phase

**Artifacts:**

- `tugdeck/src/components/tugways/cards/tide-card.tsx` — extend the `TideRestoring` placeholder to render through the replay window in addition to the binding-restore window. The Tide card observes `phase === "replaying"` (per [D11]) and selects placeholder wording:
  - **Initial state (0–2s after `replay_started`):** "Loading conversation…"
  - **Soft-budget state (>2s):** "Loading conversation… (N turns)" where N is updated from `tide::replay::progress` telemetry forwarded as a snapshot field (or, simpler for v1, a derived count from the in-progress transcript length — the reducer commits replayed turns incrementally per [D10]).
  - **Hard-budget timeout state:** when `lastReplayResult.kind === "replay_timeout"`, the placeholder briefly shows "Conversation history unavailable; resuming with empty transcript" before dismissing into the empty live transcript.
- `tugdeck/src/components/tugways/cards/tide-card.css` — minor styling for the count-aware placeholder variant; otherwise no change.

**Tasks:**

- [x] Wire the `phase === "replaying"` derivation into the `TideRestoring` selector.
- [x] Implement the three placeholder copy variants (initial / soft-budget with count / hard-budget timeout).
- [x] Decide how the count surfaces — derived from `transcript.length` during replay is simplest; an explicit `replayInProgress: { count }` snapshot field is cleaner if the count needs to differ from `transcript.length`. Pick simplest that works. *Picked the simplest path: the gate reads `transcript.length` directly. Replay commits each `turn_complete` to `transcript` per [D11], so this number tracks the soft-budget count exactly.*
- [x] Verify the placeholder dismisses on `replay_complete` (success path).
- [x] Verify the timeout-state copy renders briefly then dismisses on hard-budget timeout.

**Tests:**

- [x] Component test: render the Tide card with `phase: "replaying"`; assert `TideRestoring` is mounted with the replay wording.
- [x] Component test: simulate the soft-budget state — `phase: "replaying"` for >2s with `transcript.length === 7`; assert the count "(7 turns)" appears in the placeholder.
- [x] Component test: simulate the hard-budget timeout — `replay_complete` arrives with `error: { kind: "replay_timeout" }`; assert the placeholder shows the timeout copy briefly, then dismisses to an empty live transcript with `phase: idle`.
- [x] Component test: the placeholder dismisses on `replay_complete` (success) and the transcript appears in the same render commit (no flash of empty pane).

**Checkpoint:**

- [x] `bun x tsc --noEmit` — exit 0.
- [x] `bun test` — green.
- [x] `bun run audit:tokens lint` — zero violations.
- [x] `cargo nextest run` — green.

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
- Manual smoke checklists differentiated by transition class — these hit different code paths and need separate verification:

  **Smoke A — HMR (Vite module replacement, page stays alive).**
   - Open a Tide card; submit several turns to populate `transcript`.
   - In your editor, save a tugdeck source file (e.g. `tide-card-transcript.tsx`).
   - Vite HMR replaces the module(s); React fast-refresh remounts affected components.
   - Expected: `cardSessionBindingStore` survives in module memory (the binding module typically isn't HMR-replaced); `tide-session-restore` may or may not fire depending on which modules HMR'd. If it does fire, replay flows; if not, the existing CodeSessionStore (which survived) keeps the transcript.
   - Verify: the transcript repaints with all prior turns.
   - Verify: submit a new turn; it appends.

  **Smoke B — Developer > Reload (page destroys, app stays alive).**
   - Open a Tide card with several turns; ensure at least one terminal-state turn (`turn_complete(success)`) is on the wire.
   - Cmd-R / Developer > Reload.
   - Expected: the page tears down; tugbank rehydrates; `cardSessionBindingStore` reads its persisted record; `tide-session-restore` walks each Tide card and fires `spawn_session(mode=resume)`; replay flows; placeholder shows briefly; transcript repaints.
   - Verify: transcript content is byte-identical to pre-reload (modulo timestamp formatting).
   - Verify: submit a new turn; it appends.

  **Smoke C — Cold boot (Tug.app destroys, supervisor restarts from disk).**
   - Open a Tide card with several turns.
   - Quit Tug.app entirely.
   - Relaunch Tug.app.
   - Expected: tugcast supervisor reads its sqlite ledger + `dev.tugtool.tide.session-keys` tugbank domain; `rebind_from_tugbank` rehydrates the `LedgerEntry` with persisted `claude_session_id`; the deck restores; the active Tide card's binding record is read; `tide-session-restore` fires; replay flows.
   - Verify: transcript repaints with all prior turns.
   - Verify: submit a new turn; it appends.

  **Smoke D — Mid-turn reload (orphan turn synthesis).**
   - Open a Tide card; submit a turn that produces a long response (e.g. "summarize the last 10 commits in detail").
   - Mid-stream — while the assistant is still generating — Cmd-R / Developer > Reload.
   - Expected: replay reads the JSONL; the orphan in-flight turn synthesizes per [D08] as a `turn_complete(error)` (interrupted); the transcript shows the user's submission and whatever assistant text was captured before reload, with an interrupted marker.
   - Verify: transcript shows the orphan turn as interrupted, not as in-flight.
   - Verify: card is interactive afterward; submit a fresh turn; it appends after the interrupted one.

**Tasks:**

- [ ] Author the integration test file using the existing `setup-rtl` + WASM init harness.
- [ ] Add the manual smoke checklists A/B/C/D to the commit body.
- [ ] Run all four manual smokes against a real session.

**Tests:**

- [ ] Integration: resume → replay → transcript matches fixture turn count.
- [ ] Integration: resume with missing JSONL → empty transcript + `lastReplayResult.kind === "jsonl_missing"` + card still functional.
- [ ] Integration: orphan-turn JSONL (last `assistant.stop_reason: "tool_use"`) → transcript carries the orphan as `result: "interrupted"` per [D08].
- [ ] Integration: live submit after `replay_complete` — `phase: idle`, `canSubmit: true`; new turn flows live.
- [ ] Integration: live submit during replay window — `phase: replaying`, `canSubmit: false`; the prompt entry's submit button is disabled.

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

- [ ] `claude_session_id` persisted and threaded through resume (Step 0); real-claude integration test confirms `--resume` end-to-end.
- [ ] `tugcode/src/replay.ts` exists; pure translator unit tests green against fixture JSONLs covering the surveyed shape inventory + orphan-turn synthesis.
- [ ] Reducer handles `replay_started` / `replay_complete`, exposes `replaying` phase, dedupes by msg_id, surfaces `lastReplayResult`.
- [ ] Resume-mode session start in tugcode emits replay events on IPC stdout before forwarding live events from Claude's stdout; respects [D10] hard-timeout.
- [ ] Tide card surfaces "Loading conversation…" / "Loading conversation… (N turns)" / timeout-state copy via `phase === "replaying"` + `lastReplayResult`; placeholder dismisses on `replay_complete`.
- [ ] Smokes A (HMR), B (Reload), C (cold boot), D (mid-turn reload) all verified against a real session.
- [ ] Sticky id eliminates the seed-transition remount for replay-committed turns; live-turn flicker documented as a follow-on.
- [ ] `UserRowCell` renders inline atoms when `attachments` is non-empty.
- [ ] `TugListView` dispatches `prefetchForIndices` / `cancelPrefetchForIndices` on a working window.
- [ ] Tuglaws cross-check passes per-step.
- [ ] `tugplan-tug-list-view.md #roadmap` rows for absorbed items flipped to "shipped"; [§P14](./tide.md#p14-claude-resume) flipped to shipped via this plan's Step 0.
- [ ] All check commands green: `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run`.

**Acceptance tests:**

- [ ] `claude_session_id` persistence + threading tests (Step 0) — including the real-claude `test_close_then_reopen_preserves_history` integration.
- [ ] tugcode replay-translator unit tests (Step 1) — covers all surveyed shapes, orphan-turn synthesis, batched yields.
- [ ] Reducer replay-bracket + `replaying` phase + `lastReplayResult` tests (Step 2).
- [ ] tugcode resume-flow integration tests (Step 3) — ordering, missing JSONL, hard timeout.
- [ ] Tide card replay-UX component tests (Step 4) — three placeholder copy variants, dismiss timing.
- [ ] Tide card resume-integration tests (Step 5) — including orphan-turn smoke.
- [ ] Adapter sticky-id tests (Step 6).
- [ ] Atom-aware user-row tests (Step 7).
- [ ] `TugListView` prefetch tests (Step 8).

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] **Imperative DOM cell pooling** — the v2 of `TugListView` that swaps React item-keyed mount/unmount for an imperative DOM pool keyed by cell kind. Public API unchanged; lifecycle semantics shift for stateful cell renderers (per the v1 → v2 caveat in [tugplan-tug-list-view.md §[D04]](./tugplan-tug-list-view.md#d04-cell-reuse)). Promoted from `tugplan-tug-list-view.md #roadmap` to its own plan because the structural shift earns dedicated decision-making (pool sizing, eviction policy, the [D13] native-text-selection-survival side-effect win, the per-kind reuse-token contract). Plan name TBD: `tugplan-tug-list-view-v2-imperative-pool.md` is a placeholder.
- [ ] **Native-text-selection survival across scroll-out** — explicitly resolved as a side effect of the imperative-DOM-pool plan above. v1 documented limitation per [tugplan-tug-list-view.md §[D13]](./tugplan-tug-list-view.md#d13-selection-scroll-out).
- [ ] **Live-turn flicker at the awaiting-first-token transition** — the seed-rewrite remount that this plan's Step 6 *cannot* eliminate (only replay-committed turns avoid the rewrite, since their msg_id is known up front). The imperative-DOM-pool plan resolves this naturally because cell DOM survives wrapper-key changes.
- [ ] **Cross-machine session export / import** — the JSONL is per-machine. "Open this conversation on another laptop" requires a much larger design (sync, encryption, schema-stable export shape). Not in scope for this plan or near-term follow-ons.
- [ ] **Replay performance review** — long sessions (≥ 100 turns) may take observable time to translate + commit. If the user-perceived "Loading conversation…" beat exceeds a small budget, profile the translator and the reducer's commit loop. Earned when the manual smoke surfaces real lag.
- [ ] **Replay-while-live (interleaved replay)** — [D03] commits to synchronous-before-live ordering. If a future use case wants to splice replay into a live session (e.g. a compaction summary delivered alongside live frames), revisit the dedupe contract and the bracket protocol. Not earned today.
- [ ] **JSONL drift telemetry** — Claude's JSONL format may evolve across versions. A version-gate similar to the stream-json catalog drift test ([P15](./tide.md#p15-stream-json-version-gate)) would catch silent format changes. v1 logs unknown shapes via `tide::replay::unknown_shape` per [D06], which is the observability seed; promote to a structured divergence event when the count starts to matter.
- [ ] **Per-row historical model name** — [D09] commits to "current model wins for all replay-committed rows" in v1. A future refinement could surface per-row historical model when the JSONL records different models across the session's lifetime. Earned when sessions routinely span model versions and users notice.

| Checkpoint | Verification |
|-|-|
| Tokens lint clean | `bun run audit:tokens lint` |
| Supervisor + bridge tests | `cargo nextest run` (covers Step 0's persistence + threading + real-claude integration) |
| Translator unit tests | `cd tugcode && bun test src/__tests__/replay.test.ts` |
| Reducer replay tests | `bun test src/lib/code-session-store/__tests__/code-session-store.replay.test.ts` |
| Tide card replay UX | `bun test src/__tests__/tide-card-resume.test.tsx` |
| Adapter sticky-id tests | `bun test src/lib/__tests__/tide-transcript-data-source.test.ts` |
| List-view prefetch tests | `bun test src/components/tugways/__tests__/tug-list-view.test.tsx` |
| TS clean | `bun x tsc --noEmit` |
| Smoke A — HMR | Manual per Step 5; transcript repaints intact across module replacement |
| Smoke B — Developer > Reload | Manual per Step 5; transcript repaints from JSONL replay |
| Smoke C — Cold boot | Manual per Step 5; quit-and-relaunch restores transcript |
| Smoke D — Mid-turn reload | Manual per Step 5; orphan turn commits as interrupted |
