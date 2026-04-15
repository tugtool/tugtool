<!-- tugplan-skeleton v2 -->

## T3.4.a — CodeSessionStore (turn state machine) {#code-session-store}

**Purpose:** Land `CodeSessionStore` in tugdeck — a per-Tide-card L02 store that owns Claude Code turn state, observes filtered CODE_OUTPUT / SESSION_STATE frames, dispatches CODE_INPUT messages through `encodeCodeInput`, and exposes an append-only transcript plus an in-flight streaming document that `TugMarkdownView` can render. Nothing about turn state lives in React components after this phase.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-04-15 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

[T3.0.W1](./tugplan-workspace-registry-w1.md), [W2](./tugplan-workspace-registry-w2.md), and [W3.a](./tugplan-workspace-registry-w3a.md) together replaced tugcast's single-bootstrap-workspace model with per-session workspace binding. `spawn_session` now carries `project_dir`, `WorkspaceRegistry` reference-counts feed bundles per canonical project path, `LedgerEntry.workspace_key` binds each session to its workspace, and tugdeck's `CardSessionBindingStore` + `useCardWorkspaceKey` hook resolve card identity into a `{ tugSessionId, projectDir, workspaceKey }` tuple. The wire contract is stable, the router demuxes sessions by `tug_session_id` in the payload, the drift test ([§P2 follow-up](./tide.md#p2-followup-golden-catalog)) pins `claude 2.1.105` stream-json shapes as machine-readable golden fixtures, and `FeedStore` has a per-instance filter API for per-card subscriptions. Everything below the store is ready.

What's still missing is the store itself. Today there is no place for turn state to live: the gallery prompt-input spike runs against ad-hoc mock frames, `tug-prompt-entry` (T3.4.b) cannot be written without a store to consume, and the Tide card (T3.4.c) has no L02 component to subscribe to. T3.4.a fills that gap by shipping `CodeSessionStore` as a pure TypeScript L02 store with no React dependencies, a filtered `FeedStore` built from a raw `TugConnection` and `tug_session_id`, an append-only `transcript`, an in-flight `streamingDocument` PropertyStore, and an explicit turn-state machine derived from the `v2.1.105/` golden fixtures. After this phase, T3.4.b can compose the store into `tug-prompt-entry`, T3.4.c can mount both inside a Tide card, and T3.4.d can close out Phase T3 with a real end-to-end round-trip.

#### Strategy {#strategy}

- **Store owns the filter, card owns the lifecycle.** The store constructs its own filtered `FeedStore` from a raw `TugConnection` and a `tug_session_id` — consumers never build a mis-keyed feed by accident. The Tide card (T3.4.c) owns `spawn_session` / `close_session` CONTROL frames and the `CardSessionBindingStore` binding; the store handles what happens on an already-claimed session.
- **Post-W2 wire contract, no fallbacks.** There is no single-session mode, no "first card gets the default session," no conflation of `sessionKey` with `tug_session_id`. Routing is by `tug_session_id` (UUID minted per card); `claude_session_id` is observed from `session_init` and exposed on the snapshot for downstream display; `project_dir` is the card's business. A human-readable `displayLabel` is optional and has zero wire footprint.
- **Append-only transcript + in-flight streaming document.** Tide cards are long-lived chat threads, so the store maintains `transcript: ReadonlyArray<TurnEntry>` (immutable, one entry per completed turn) plus a single `streamingDocument: PropertyStore` with stable path keys (`inflight.assistant`, `inflight.thinking`, `inflight.tools`). This collapses the former `streamingStore / streamingPath / streamRegionKey` triplet into one store-owned instance plus path strings on the snapshot.
- **Fixtures are ground truth; Vitest reads them in-place.** Unit tests load `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.105/test-NN-*.jsonl` via a `loadGoldenProbe(version, probeName)` helper with placeholder substitution. No copy/export step between the Rust-owned golden directory and the tugdeck-side tests — the [drift test](./tide.md#p2-followup-golden-catalog) already guards divergence on the Rust side.
- **Sequenced reducer build-up, one state per commit.** Each execution step lands one coherent slice of the state machine behind a compile-clean commit with fixture-driven tests: scaffolding, then the basic round-trip reducer, then streaming deltas, then tools, then permission/question flows, then interrupt, then `errored` triggers, then queue semantics, then dispose/filter. Integration checkpoint at the end verifies all slices cooperate.
- **Warnings are errors across the build.** Every intermediate commit must survive `-D warnings` on Rust (unchanged by this plan) and whatever strictness tugdeck's Vitest + tsconfig imposes. No `any` escapes, no `@ts-expect-error` in committed code, no new `react` imports inside `code-session-store.ts`.
- **No React, no DOM, no IndexedDB.** `code-session-store.ts` is pure TypeScript + L02. Any persistence (not in this phase) goes through tugbank per D-T3-10. React coupling belongs in T3.4.b / T3.4.c.

#### Success Criteria (Measurable) {#success-criteria}

- `tugdeck/src/lib/code-session-store.ts` exists and exports `CodeSessionStore` + `CodeSessionSnapshot`. (verification: file exists; `tsc --noEmit` clean)
- `rg 'from "react"' tugdeck/src/lib/code-session-store.ts` returns zero matches. (verification: grep in Step 11)
- `rg 'IDBDatabase\|indexedDB' tugdeck/src/lib/code-session-store.ts tugdeck/src/lib/code-session-store/` returns zero matches. (verification: grep in Step 11)
- Replaying `v2.1.105/test-01-round-trip.jsonl` drives the store `idle → submitting → awaiting_first_token → streaming → complete → idle` with exactly one `TurnEntry` appended to `transcript`. (verification: `code-session-store.round-trip.test.ts`)
- Replaying `v2.1.105/test-02-streaming-deltas.jsonl` accumulates deltas at `inflight.assistant` in arrival order; on the `complete` event, the buffer equals the event's `text` field byte-for-byte. (verification: `code-session-store.deltas.test.ts`)
- Replaying `v2.1.105/test-06-interrupt.jsonl` after a `store.interrupt()` call drives `streaming → interrupted → idle`, commits a `TurnEntry` with `result: "interrupted"` and the accumulated text preserved. (verification: `code-session-store.interrupt.test.ts`)
- Three `send()` calls during `streaming` leave `queuedSends === 3`; after `interrupt()` + `turn_complete(error)`, `queuedSends === 0` and no `user_message` frames were written for the queued sends. (verification: `code-session-store.interrupt.test.ts`)
- Three `send()` calls during `streaming` leave `queuedSends === 3`; after `turn_complete(success)`, exactly one queued `user_message` frame is written and the store transitions `complete → idle → submitting`. (verification: `code-session-store.queue.test.ts`)
- Replaying `v2.1.105/test-05-tool-use.jsonl` flips `phase` to `tool_work` on first `tool_use` partial and back to `streaming` on matching `tool_use_structured` / `tool_result`; `inflight.tools` carries a `ToolCallState` with the fixture's tool name. (verification: `code-session-store.tools.test.ts`)
- Replaying `v2.1.105/test-21-concurrent-tools.jsonl` keeps two overlapping `tool_use_id`s simultaneously resident in `inflight.tools` and keeps `phase === "tool_work"` until both resolve. (verification: `code-session-store.tools.test.ts`)
- Replaying `v2.1.105/test-08-permission.jsonl` populates `pendingApproval`; `respondApproval(requestId, { decision: "allow" })` writes a `tool_approval` CODE_INPUT frame with the correct `request_id` and `decision`. (verification: `code-session-store.control-forward.test.ts`)
- Replaying `v2.1.105/test-11-tool-deny.jsonl` produces a `tool_approval` frame with `decision: "deny"`. (verification: same file)
- Replaying `v2.1.105/test-35-ask-user-question.jsonl` populates `pendingQuestion`; `respondQuestion(requestId, { answers })` writes a `question_answer` CODE_INPUT frame with the correct shape. (verification: same file)
- Synthetic `SESSION_STATE { state: "errored", detail: "crash_budget_exhausted" }` frame during `streaming` transitions `phase → errored`, `lastError.cause === "session_state_errored"`, `lastError.message` contains `"crash_budget_exhausted"`, transcript preserved. (verification: `code-session-store.errored.test.ts`)
- Synthetic `conn.onClose` while `phase === "submitting"` transitions `phase → errored` with `lastError.cause === "transport_closed"`. (verification: same file)
- Synthetic CONTROL error with `detail: "session_not_owned"` for this `tugSessionId` transitions `phase → errored` with `lastError.cause === "session_not_owned"`. (verification: same file)
- From `phase === "errored"`, `send("retry")` transitions to `submitting`; after a subsequent `turn_complete(success)`, `lastError === null`. (verification: same file)
- Two `CodeSessionStore` instances with distinct `tugSessionId`s against a shared mock connection receive only their own frames; replaying a stream tagged with store A's id leaves store B's snapshot unchanged. (verification: `code-session-store.filter.test.ts`)
- After `dispose()`, new frames on the connection do not update the snapshot; `streamingDocument` is cleared; no `close_session` frame was written. (verification: `code-session-store.dispose.test.ts`)
- `cd tugdeck && bun test` is green on every step commit and on the integration checkpoint. (verification: Step 11)

#### Scope {#scope}

1. New file `tugdeck/src/lib/code-session-store.ts` implementing `CodeSessionStore` (class), `CodeSessionStoreOptions` (constructor options), `CodeSessionSnapshot` (snapshot type), `TurnEntry` (immutable transcript entry), `ToolCallState` (per-call state), and the internal reducer.
2. New file `tugdeck/src/lib/code-session-store/testing/golden-catalog.ts` exporting `loadGoldenProbe(version, probeName)` plus the placeholder substitution and typed-event parsing helpers.
3. New file `tugdeck/src/lib/code-session-store/testing/mock-feed-store.ts` — a Vitest-only in-memory `FeedStore` double that replays parsed golden events to the store's subscription handler using the same filter signature as the real `FeedStore`.
4. New test suite `tugdeck/src/lib/code-session-store/__tests__/` covering: round-trip, streaming deltas, tool lifecycle, concurrent tools, control request forward (approval, deny, question), interrupt (including queue clearing), queue flush on success, errored triggers (SESSION_STATE, transport close, CONTROL errors), recovery from errored, filter correctness, dispose teardown, react-import negative check.
5. Public exports from `tugdeck/src/lib/index.ts` (or the equivalent barrel): `CodeSessionStore`, `CodeSessionSnapshot`, `TurnEntry`. The `golden-catalog` and `mock-feed-store` helpers are test-only and not re-exported.

#### Non-goals (Explicitly out of scope) {#non-goals}

- **`spawn_session` / `close_session` / `reset_session` lifecycle.** The card owns CONTROL frames via `CardSessionBindingStore` and `encodeSpawnSession` / `encodeCloseSession`. T3.4.a does not build the picker UI, does not call these encoders, and does not mint `tug_session_id`. The store accepts a `tugSessionId` that is already known to be persisted.
- **`session_command: "new" | "continue" | "fork"` routing.** `v2.1.105/test-13-*.jsonl`, `test-17-*.jsonl`, `test-20-*.jsonl` are skipped in the current manifest pending [P16](./tide.md#p16-session-command-continue). T3.4.a is single-session-per-store; `session_command` handling re-enables when P16 closes.
- **React components / hooks.** No `useSyncExternalStore`, no JSX, no `.tsx` files in scope. `tug-prompt-entry` is T3.4.b; Tide card registration is T3.4.c.
- **Persistence of transcript / snapshot.** The transcript lives in memory for the card's lifetime. Rehydration on reload is [P14](./tide.md#p14-claude-resume) (Claude `--resume`) territory; this plan leaves the hook points clean but writes no tugbank code.
- **SESSION_METADATA consumption.** `SessionMetadataStore` owns `SESSION_METADATA`; the Tide card holds references to both stores. `CodeSessionStore` does not subscribe to `SESSION_METADATA` at all.
- **`system_metadata.version` capture / version-adaptive reducer.** That scaffold is [P15](./tide.md#p15-stream-json-version-gate), which lands after T3.4.a so the version-branching is informed by what fields the store actually depends on.
- **P13 spawn cap / rate limit surfacing.** P13 adds `concurrent_session_cap_exceeded` and `spawn_rate_limited` as `SESSION_STATE { state: "errored", detail: ... }` details. T3.4.a's `errored` handling routes *any* `SESSION_STATE errored` frame to `phase → errored` with the detail copied into `lastError.message`, so P13 works with zero store changes when it lands — but no P13-specific code exists yet.
- **Local slash-command registry.** `/status`, `/model`, `/cost`, etc. are Phase T10 work. T3.4.a treats all user messages as opaque — the store writes whatever text the caller hands it to `CODE_INPUT`.
- **Bootstrap workspace retirement.** The W1 bootstrap stays alive per [W3.a](./tugplan-workspace-registry-w3a.md) non-goals; retirement rides with T3.4.c + W3.b. T3.4.a is orthogonal to the bootstrap — it operates entirely via the post-W2 session-scoped wire path.

#### Dependencies / Prerequisites {#dependencies}

- [T3.0.W2](./tugplan-workspace-registry-w2.md) — shipped. Provides `spawn_session { project_dir }` CONTROL shape, `LedgerEntry.workspace_key`, `SessionKeyRecord` persisted shape, tugdeck's `CardSessionBindingStore` + `useCardWorkspaceKey`.
- [T3.0.W3.a](./tugplan-workspace-registry-w3a.md) — draft / in-flight. Not a hard dependency for T3.4.a reducer code, but W3.a lands before T3.4.a per the [Execution Order table](./tide.md#execution-order-table). The store's reducer is unaffected by W3.a's CLI renames.
- [§P2 integration reference](./tide.md#p2-integration-reference) in `roadmap/tide.md` — the stabilized wire contract this plan is built against. Covers FeedId slots, frame payload shapes, the lifecycle order, `encodeSpawnSession` / `encodeCloseSession` / `encodeCodeInput` signatures, the `FeedStore` per-instance filter API, and server-side entry-point table.
- [§P2 follow-up golden catalog](./tide.md#p2-followup-golden-catalog) — shipped. Provides `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.105/` as machine-readable ground truth with placeholder normalization; provides `stream_json_catalog_drift.rs` as the Rust-side regression test.
- Existing `tugdeck/src/lib/feed-store.ts` with the 4-argument constructor `new FeedStore(conn, feedIds, decode?, filter?)`. Exists per [Phase T0.5 P2](./tide.md#protocol-hardening).
- Existing `tugdeck/src/protocol.ts` with `FeedId`, `encodeCodeInput(msg, tugSessionId)`. Exists per P2.
- Existing `tugdeck/src/lib/connection.ts` `TugConnection` with `.send(feedId, payload)` and a close observer (exists; this plan assumes a subscribe-to-close hook — if one doesn't exist yet, Step 8 adds one as part of errored-path wiring).
- Existing `PropertyStore` primitive used by `TugMarkdownView`'s streaming API. Exists per [Phase 3A.5 Region Model + API](./tide.md#foundation) (DONE).
- `bun` ≥ `1.x` + `vitest` as configured in `tugdeck/package.json`. Exists.

#### Constraints {#constraints}

- **Warnings are errors.** Tugdeck's `tsc --noEmit` runs under strict mode; no `any` escapes, no `@ts-expect-error`, no `@ts-ignore` in committed code. Rust-side touched crates (none in this plan) would follow `-D warnings` but this plan is tugdeck-only.
- **bun, not npm.** All commands run under `bun`. `bun test`, `bun run audit:tokens` (not touched here), `bun install`. Never `npm` / `npx`. (Memory: `feedback_use_bun`.)
- **No React, no DOM, no IndexedDB.** `code-session-store.ts` must not import from `react`, `react-dom`, `window.indexedDB`, or any DOM global. All persistence goes through tugbank when it lands later (D-T3-10). T3.4.a writes no persistence code.
- **No mock-only scaffolding leaking into production bundle.** `testing/golden-catalog.ts` and `testing/mock-feed-store.ts` are test-only and must not be importable from production paths. Validate via tsconfig `exclude` or a dedicated `vitest.config` include.
- **Golden fixture path is a relative path, not a symlink or a copy.** The test helper reads `../../../tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/<version>/<probe>.jsonl` from `tugdeck/src/lib/code-session-store/testing/`. The repo root layout is stable; any future reshuffling of tugrust or tugdeck will break the path loudly and can be repaired in a follow-up.
- **No `--no-verify`, no amend, no squash on committed steps.** Each execution step lands as a fresh commit. (CLAUDE.md commit discipline.)
- **Store must be pure-function reducer under the hood.** The outer `CodeSessionStore` class is mutable (holds the `FeedStore`, the `PropertyStore`, the subscriber list), but the inner reducer is a pure `(state, event) => state` function exported from an internal module so tests can exercise reducer logic without constructing a live store.

#### Assumptions {#assumptions}

- `FeedStore`'s 4th-argument filter runs on decoded payloads with `tug_session_id` visible as a top-level field. (Confirmed in §P2 integration reference.)
- `encodeCodeInput(msg, tugSessionId)` returns an already-encoded `ArrayBuffer` and injects `tug_session_id` as the first field of the payload. (Confirmed in §P2 integration reference.)
- A single `TugConnection` can carry frames for multiple `CodeSessionStore` instances concurrently without cross-contamination, provided each store's filter is correctly keyed. (Confirmed by the router's demux + client-side filter design in P2.)
- `PropertyStore.set(path, value)` triggers observer notifications synchronously (or at least before the next task tick), compatible with `TugMarkdownView`'s observe path. (Inherited assumption from Phase 3A.5.)
- Golden fixture filenames under `v2.1.105/` are stable for the lifetime of this plan. If Anthropic ships `claude 2.1.106` during implementation and the drift test flags it, follow the recovery workflow in [§P2 follow-up](./tide.md#p2-followup-golden-catalog) before continuing — do not hand-patch events to keep tests green.
- Vitest under bun can read files via Node's `fs.readFileSync` with `__dirname`-relative paths. (Standard.)
- The `TugConnection` exposes a close observer (`onClose` / `.subscribe(close)` / similar). If it doesn't, Step 8 adds the narrowest possible surface required for `errored` transport-close detection. The plan assumes this is a trivial addition and not a separate phase.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Transcript rehydration on reload (DEFERRED to P14) {#q01-transcript-rehydration}

**Question:** When a user reloads the browser, the current plan loses all prior `TurnEntry` history — `transcript` starts empty. Is this acceptable for T3.4.a, or must the store rehydrate from persisted state on construction?

**Why it matters:** If users lose conversation history on reload, the Tide card feels broken even though the state machine is correct. If we add persistence now, we're duplicating work that [P14](./tide.md#p14-claude-resume) will do properly via Claude `--resume`.

**Options (if known):**
- Accept the loss for T3.4.a; rehydration ships with P14.
- Add a thin tugbank-backed transcript cache to `CodeSessionStore` now.
- Stream-reconstruct the transcript from CODE_OUTPUT replay on reconnect (requires a per-session replay channel that doesn't exist).

**Plan to resolve:** DEFERRED. T3.4.a ships with an empty `transcript` on construction. P14 lands Claude `--resume` + tugbank persistence of `claude_session_id`, and rehydration can hang off the same hook.

**Resolution:** DEFERRED to P14. T3.4.a's snapshot shape carries `transcript: ReadonlyArray<TurnEntry>` as a field, not a method, so P14 can repopulate it at construction without a shape change.

#### [Q02] TurnEntry shape for tool calls (OPEN) {#q02-turn-entry-tool-shape}

**Question:** When committing a completed turn to `transcript`, should `TurnEntry.toolCalls` be a `Map<tool_use_id, ToolCallState>` (matching the in-flight shape) or a `ReadonlyArray<ToolCallState>` in arrival order?

**Why it matters:** The in-flight shape is a Map for O(1) `tool_use_id` lookup on interleaved events. But downstream rendering in `TugMarkdownView` will want to display tool calls in arrival order, which an array gives naturally but a Map does not guarantee (though JS Maps preserve insertion order). The snapshot shape is part of the public API and changing it later is painful.

**Options (if known):**
- Commit as `ReadonlyArray<ToolCallState>` in arrival order. Downstream rendering is simpler; the in-flight Map is converted on commit.
- Commit as `ReadonlyMap<string, ToolCallState>`. Preserves in-flight shape; downstream must `Array.from(map.values())` to render.
- Commit as both — a `toolCallOrder: string[]` + `toolCalls: ReadonlyMap<string, ToolCallState>`.

**Plan to resolve:** Pick one in Step 5 (tool call tracking) before landing. Default: **`ReadonlyArray<ToolCallState>`** unless fixture replay surfaces a reason it matters. Rationale: the consumer is a markdown renderer, not an event-correlation engine.

**Resolution:** OPEN until Step 5.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Stream-json shape drift between `v2.1.105` and live Claude during implementation | high | low | Rely on the golden catalog + drift test; if a new Claude ships, follow the §P2 follow-up recovery workflow before continuing | Drift test fails on a `claude` version bump during T3.4.a work |
| Fixture relative-path brittleness across repo moves | medium | low | The path is hardcoded as `../../../tugrust/.../fixtures/`; any repo root restructure breaks the helper loudly with a readable error | Future repo move or monorepo split |
| Concurrent tool-call state machine miscorrelation | high | medium | Key every tool event on `tool_use_id` in a `Map`; add `test-21-concurrent-tools.jsonl` as a required exit criterion with assertion on both ids | Fixture replay fails or tool state leaks across turns |
| Interrupt vs `turn_complete(error)` race | medium | low | The state machine does not require `interrupt()` and `turn_complete(error)` to arrive in any particular order — `interrupt()` writes the frame and stays in the current phase; the `error` turn_complete is the only driver of `interrupted → idle` | Synthetic test reorders events |
| `TugConnection.onClose` observer doesn't exist yet | medium | low | Step 8 adds the narrowest possible surface required for `errored` transport-close detection; if the shape is wrong, adjust in the same step before commit | `onClose` surface debate blocks Step 8 |
| PropertyStore synchronous-notification assumption wrong | medium | low | Every `inflight.*` write is immediately followed by an assertion-compatible read in tests; if async, tests will flake and we'll add `flushSync` or equivalent | Tests flake on delta assertions |

**Risk R01: Interleaved tool call miscorrelation** {#r01-tool-call-interleave}

- **Risk:** Two concurrent tool calls with different `tool_use_id`s arrive interleaved (`tool_use(A)` → `tool_use(B)` → `tool_result(A)` → `tool_result(B)`). If the reducer assumes sequential ordering, the state for B gets overwritten by A's result and `inflight.tools` reports a corrupt state.
- **Mitigation:**
  - Key every tool event on `tool_use_id` in a `Map<string, ToolCallState>`.
  - The `tool_work ↔ streaming` transition fires only when **all** pending `tool_use_id`s have resolved (all Map entries have `status: "done"`).
  - Exit criterion requires `test-21-concurrent-tools.jsonl` to pass with both ids observable in `inflight.tools` simultaneously.
- **Residual risk:** If Claude emits a `tool_result` for a `tool_use_id` the store never saw (driver bug, router dedup gap), the reducer logs and drops the event without transitioning. Acceptable for T3.4.a.

**Risk R02: Golden fixture path coupling** {#r02-fixture-path-coupling}

- **Risk:** The Vitest helper reads `.jsonl` files via `../../../tugrust/.../fixtures/stream-json-catalog/<version>/<probe>.jsonl`. A future repo restructure (monorepo split, directory rename) silently breaks every test.
- **Mitigation:**
  - The helper throws a readable `Error` containing the absolute resolved path when a file is missing — not a cryptic ENOENT.
  - The relative path is documented inline in `golden-catalog.ts` with a one-line comment pointing at the upstream directory.
  - A single top-of-file constant holds the relative prefix; the test helper is the only callsite.
- **Residual risk:** A repo move still requires a one-line fix. Acceptable for T3.4.a.

**Risk R03: `errored` vs `interrupted` confusion** {#r03-errored-vs-interrupted}

- **Risk:** Both paths surface as a "something went wrong" turn, and it's tempting to collapse them. But `turn_complete(error)` is user-initiated (Stop button) and preserves text; `SESSION_STATE errored` is infrastructure-level and preserves transcript but not the in-flight turn. Conflating them corrupts the `lastError` surface and misleads the UI.
- **Mitigation:**
  - The transition table has two distinct rows for these events; they route to different phases (`interrupted` vs `errored`).
  - Exit criteria include separate tests for each path.
  - The `errored` triggers table lists exhaustively what *does* route there; `turn_complete(error)` is explicitly listed under "Not in scope for `errored`".
- **Residual risk:** If a future reducer change inadvertently routes `turn_complete(error)` to `errored`, the interrupt exit-criteria test catches it.

---

### Design Decisions {#design-decisions}

#### [D01] Store owns the filtered FeedStore (DECIDED) {#d01-store-owns-feedstore}

**Decision:** `CodeSessionStore` constructs its own filtered `FeedStore` internally from a raw `TugConnection` + `tug_session_id`. The Tide card does not pre-build a `FeedStore` and pass it in.

**Rationale:**
- Encapsulates the filter shape — consumers cannot construct a mis-keyed filter by accident.
- The store already owns `tug_session_id`, so building the filter from it is natural.
- Reduces the constructor surface to three conceptual inputs: connection, session id, optional display label.
- Matches the §P2 integration reference "typical client flow" pattern.

**Implications:**
- The store depends on `FeedStore` (not injected) — slightly harder to unit-test, mitigated by the `mock-feed-store.ts` helper.
- Any future change to `FeedStore`'s constructor shape touches `CodeSessionStore`. Acceptable.

#### [D02] Card owns CONTROL lifecycle, not the store (DECIDED) {#d02-card-owns-lifecycle}

**Decision:** The Tide card (T3.4.c) sends `encodeSpawnSession` / `encodeCloseSession` / `encodeResetSession` CONTROL frames and updates `CardSessionBindingStore`. `CodeSessionStore` sends none of these and only subscribes to SESSION_STATE to observe the result.

**Rationale:**
- Keeps the store's single responsibility tight: turn state on an already-claimed session.
- Matches W2's layering — `CardSessionBindingStore` is the source of truth for card ↔ session binding, not the turn-state store.
- Allows the card to construct the store while SESSION_STATE is still `pending` (lazy spawn); the store tracks state transitions internally.
- `dispose()` is a local teardown (unsubscribe, clear listeners), not a session shutdown — the card's unmount logic drives `close_session` separately.

**Implications:**
- The store's construction is deferred in the Tide card until after `encodeSpawnSession` has been sent (but not necessarily acked).
- Tests must simulate the pre-live pending window for the `idle → submitting` transition over a lazy-spawn session.

#### [D03] Three-identifier model with displayLabel as UI-only (DECIDED) {#d03-three-identifier-model}

**Decision:** The store operates on a clean separation of four values: `tug_session_id` (wire routing), `claude_session_id` (observed from `session_init`, for `--resume`), `project_dir` (card concern, never seen by store), and `displayLabel` (UI chrome only, zero wire footprint).

**Rationale:**
- After W2, each identifier has a single purpose; conflating them is the primary source of bugs in the pre-W2 draft.
- Removing `displayLabel` from identity-critical paths means future UI changes (renaming a tab) cannot break wire routing.
- `claude_session_id` exposure on the snapshot is the hook point P14 will populate; no shape change needed when P14 lands.

**Implications:**
- The constructor takes `tugSessionId` as required and `displayLabel` as optional (defaults to `tugSessionId.slice(0, 8)`).
- `project_dir` is not a constructor parameter and is not accessible from the store.

#### [D04] Append-only transcript + in-flight PropertyStore (DECIDED) {#d04-transcript-plus-streaming}

**Decision:** The store owns `transcript: ReadonlyArray<TurnEntry>` (immutable, appended on every `turn_complete`) plus a single `streamingDocument: PropertyStore` with three stable path keys (`inflight.assistant`, `inflight.thinking`, `inflight.tools`). On `turn_complete`, in-flight content is committed to `transcript` and `inflight.*` is cleared.

**Rationale:**
- Tide cards are long-lived chat threads, not ephemeral panes — the transcript must grow monotonically.
- Separating transcript (snapshot-level, immutable) from streaming document (reference on the store, mutable) gives the renderer two distinct subscription surfaces without blurring them.
- Collapsing the pre-rewrite `streamingStore / streamingPath / streamRegionKey` triplet into one store-owned instance eliminates three different names for the same concept.
- The PropertyStore instance lives as a public property on the store (`store.streamingDocument`), not in the React snapshot, because PropertyStores aren't plain data.

**Implications:**
- `TugMarkdownView` in T3.4.c subscribes to `store.streamingDocument` directly (via its existing observe API), not through `useSyncExternalStore`.
- Consumers that need path strings thread `snapshot.streamingPaths.assistant` etc. through props; the strings are constants.
- The snapshot shape carries path strings as literal string types for TS clarity.

#### [D05] Interrupt clears the queue (DECIDED) {#d05-interrupt-clears-queue}

**Decision:** `interrupt()` dispatches an `{ type: "interrupt" }` frame and **clears** the local queued-sends buffer. Queued messages are discarded, not flushed on the next idle tick.

**Rationale:**
- The user pressed Stop; queued messages were typed with the expectation the current turn would complete. After an interrupt, sending those queued messages is usually not what the user wants.
- Preserving them would require the UI to expose "cancel queued messages" as a separate affordance, which bloats the interface.
- If a user genuinely wants to send a mid-interrupt queue, they can retype.
- Matches the simpler mental model of "Stop means stop everything."

**Implications:**
- Exit criterion pins this with a synthetic test: three queued sends + interrupt → `queuedSends === 0` and no queued `user_message` frames written.
- The `turn_complete(success)` path flushes one queued send per idle tick (distinct from the interrupt path).
- Future UX feedback might warrant reopening — if users complain they lose work on Stop, reconsider in a follow-up.

#### [D06] `respondApproval` and `respondQuestion` stay split (DECIDED) {#d06-respond-split}

**Decision:** The store exposes two separate actions — `respondApproval(requestId, { decision, updatedInput?, message? })` and `respondQuestion(requestId, { answers })` — not a unified `respond(requestId, payload)` that dispatches on `is_question`.

**Rationale:**
- The wire shapes are distinct: `tool_approval` carries `decision` and optional `updatedInput` / `message`; `question_answer` carries `answers`. A unified action would need a union type that muddles both.
- Component call sites are clearer: a permission dialog calls `respondApproval`; a question dialog calls `respondQuestion`. The mismatch (calling `respondApproval` on a question) fails at compile time with distinct types, not at runtime.
- The cost is two action names instead of one — trivial.

**Implications:**
- Component code in T3.4.b dispatches to the matching action based on which of `pendingApproval` / `pendingQuestion` is non-null in the snapshot.
- Both actions write to CODE_INPUT with `encodeCodeInput`.

#### [D07] Vitest reads golden fixtures in-place, no export step (DECIDED) {#d07-vitest-reads-in-place}

**Decision:** The tugdeck test helper `loadGoldenProbe(version, probeName)` reads `.jsonl` files directly from `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/<version>/<probeName>.jsonl` via a `__dirname`-relative path. No copy, no symlink, no Rust-side export step.

**Rationale:**
- Both `tugrust/` and `tugdeck/` live in the same repo root; the relative path is stable.
- Eliminates the duplication hazard — the Rust drift test and the tugdeck reducer test see exactly the same bytes.
- Avoids a build step and a bidirectional coupling for zero benefit.
- Windows symlink fragility is a non-issue because we don't symlink.

**Implications:**
- A future repo restructure (moving `tugdeck/` out of the root, monorepo split) breaks the helper loudly — acceptable, easy to repair.
- The helper throws a readable error including the resolved absolute path on missing fixtures.
- The relative prefix is stored as a top-of-file constant in `golden-catalog.ts`; grep-friendly if it ever needs to move.

#### [D08] `errored` and `interrupted` are distinct transitions (DECIDED) {#d08-errored-vs-interrupted}

**Decision:** `turn_complete(result: "error")` routes to `interrupted → idle` (preserves text, commits to transcript). Infrastructure errors (`SESSION_STATE errored`, transport close, CONTROL `session_not_owned` / `session_unknown`) route to `errored → idle` (populates `lastError`, transcript preserved but no new `TurnEntry` appended).

**Rationale:**
- `turn_complete(error)` is user-initiated (Stop button, typically) and carries valid in-flight content that should be saved.
- Infrastructure errors are out-of-band and usually mean the in-flight turn is lost or ambiguous.
- Conflating them would muddle the `lastError` snapshot field (what goes in `message`?) and mislead the UI.

**Implications:**
- The transition table has two distinct rows; the reducer dispatches on the event source, not on a generic "went wrong" predicate.
- `lastError.cause` enumerates only the `errored` causes: `"session_state_errored" | "transport_closed" | "session_not_owned" | "session_unknown"`.
- Exit criteria cover both paths separately.

#### [D09] `SessionMetadataStore` is independent (DECIDED) {#d09-metadata-store-independent}

**Decision:** `CodeSessionStore` does not subscribe to `SESSION_METADATA` and does not read `system_metadata` events from CODE_OUTPUT. `SessionMetadataStore` owns that feed independently. The Tide card holds references to both stores.

**Rationale:**
- `system_metadata` is chrome (model name, permission mode, slash commands, skills, plugins). It is not turn state.
- Separating concerns keeps both stores small and testable.
- `SessionMetadataStore` can cache the latest snapshot for display; `CodeSessionStore` doesn't need to know about it.

**Implications:**
- `CodeSessionStore`'s `FeedStore` subscribes to `[CODE_OUTPUT, SESSION_STATE]` only.
- `system_metadata` events that arrive on CODE_OUTPUT are ignored by the reducer (explicitly dropped, not crashed on).
- The card composes both stores at mount time.

#### [D10] `session_command` routing is out of scope (DECIDED) {#d10-session-command-out-of-scope}

**Decision:** T3.4.a does not handle `session_command: "new" | "continue" | "fork"`. The store treats one `CodeSessionStore` instance as bound to one Claude subprocess; multi-turn continuation within a single store is the only supported model.

**Rationale:**
- The `test-13 / test-17 / test-20` fixtures are skipped in the `v2.1.105/` manifest pending [P16](./tide.md#p16-session-command-continue).
- Shipping `session_command` handling before the router bug is fixed would mean writing code against a known-broken surface.
- Single-session-per-store is the cleanest default and covers the 95% case.

**Implications:**
- Multi-session-within-a-card is a follow-up — either by opening multiple Tide cards (T3.4.c) or by P16 + a later `CodeSessionStore` revision.
- The reducer does not handle the `pending-fork` / `pending-new` `session_init` variants; fixtures `test-13/17/20` remain skipped.

---

### Deep Dives {#deep-dives}

#### Turn-state machine walkthrough {#turn-state-walkthrough}

The reducer is a pure function `reduce(state: CodeSessionState, event: Event) => CodeSessionState`, where `Event` is a discriminated union over:
- Decoded stream-json events from CODE_OUTPUT (`assistant_text`, `thinking_text`, `tool_use`, `tool_result`, `tool_use_structured`, `control_request_forward`, `turn_complete`, `cost_update`, plus a passthrough for `session_init` and a drop for `system_metadata`).
- Decoded SESSION_STATE frames (`pending`, `spawning`, `live`, `errored`, `closed`).
- Internal action events (`send`, `interrupt`, `respondApproval`, `respondQuestion`) — enqueued to the reducer input stream synchronously from the public methods.
- Transport events (`transportClose`).

The state type carries the phase enum, the in-flight scratch buffers, the tool-call map, the pending approval/question refs, the queued sends array, `lastError`, `lastCostUsd`, and `claudeSessionId`. The transcript is outside the reducer — it's mutated by a post-reduce side-effect handler that watches for phase transitions to `complete` / `interrupted` and appends a new `TurnEntry` built from the just-finalized in-flight state.

**`idle → submitting` on `send()`:** The reducer receives an internal `send` event carrying `{ text, atoms, route }`. If `phase === "idle"`, it transitions to `submitting` and emits a side-effect "write CODE_INPUT frame" signal. If `phase !== "idle"`, it appends to `queuedSends` and stays put. From `errored`, the send is treated as a manual retry — `lastError` stays non-null until the next `turn_complete(success)` lands.

**`submitting → awaiting_first_token → streaming`:** The first `thinking_text` or `assistant_text` partial with a fresh `msg_id` drives `submitting → awaiting_first_token`. The `awaiting_first_token` phase is a single-tick affordance so UI can distinguish "we sent, waiting for the subprocess to wake up" from "text is flowing"; the next event immediately collapses to `streaming`. In practice the reducer can collapse this in one step by checking whether the event is the first partial of a new turn.

**`streaming` delta accumulation:** Each `assistant_text` partial (`is_partial: true`) appends `text` to an in-memory scratch buffer keyed by `msg_id`. The reducer emits a side-effect "write `inflight.assistant`" signal carrying the full accumulated buffer, which the side-effect handler writes via `streamingDocument.set`. On `is_partial: false` (the `complete` event), the buffer is replaced with the authoritative full text. **`turn_complete` is a separate event** — the reducer does not commit to transcript on `is_partial: false`; it waits for `turn_complete`.

**`streaming ↔ tool_work`:** A `tool_use` partial upserts a `ToolCallState` in the tool map and transitions to `tool_work`. A `tool_result` or `tool_use_structured` matching an existing `tool_use_id` marks that entry `done`. The phase returns to `streaming` only when all entries in the map are `done` (covers interleaved concurrent calls). Additional `tool_use` partials arriving while already in `tool_work` just add more map entries without a phase change.

**`streaming / tool_work → awaiting_approval`:** A `control_request_forward` event populates `pendingApproval` (if `is_question === false`) or `pendingQuestion` (if `is_question === true`) and transitions to `awaiting_approval`. `canInterrupt` remains true throughout — the user can still Stop during an approval wait. `respondApproval` / `respondQuestion` dispatch the matching outbound frame and transition back to the prior phase (tracked via a `prevPhase` field on the state).

**`turn_complete(success) → complete → idle`:** The reducer commits the in-flight state to `transcript` via a post-reduce handler, clears `inflight.*`, transitions to `complete` (a zero-duration phase), then immediately to `idle`. If `queuedSends` is non-empty, one send is shifted off the front and re-injected as a new `send` event, driving `idle → submitting`.

**`turn_complete(error) → interrupted → idle`:** Same structure, except the committed `TurnEntry` has `result: "interrupted"` and `queuedSends` is **cleared** on the transition to `idle` (per [D05]).

**`errored` transitions:** Any of the four triggers (SESSION_STATE errored, transport close, `session_not_owned`, `session_unknown`) route to `errored` with `lastError` populated. Transcript is preserved as-is — no new entry is appended. The next `send()` from `errored` re-enters `submitting`; `lastError` clears after the next `turn_complete(success)`.

#### Reducer split for testability {#reducer-split}

`CodeSessionStore` is the public class, but the reducer logic lives in a separate internal module:

```
tugdeck/src/lib/code-session-store.ts          — public class, owns FeedStore + PropertyStore
tugdeck/src/lib/code-session-store/reducer.ts  — pure (state, event) => state function
tugdeck/src/lib/code-session-store/events.ts   — decoded event type definitions
tugdeck/src/lib/code-session-store/types.ts    — snapshot + TurnEntry + ToolCallState types
tugdeck/src/lib/code-session-store/testing/golden-catalog.ts     — fixture loader
tugdeck/src/lib/code-session-store/testing/mock-feed-store.ts    — in-memory FeedStore double
```

The reducer tests exercise `reducer.ts` directly against hand-built or fixture-loaded event sequences, bypassing the class wrapper. The class tests (via `mock-feed-store.ts`) exercise the full subscribe-decode-dispatch path. Both levels run under `bun test`.

---

### Specification {#specification}

#### Spec S01: `CodeSessionStore` public surface {#s01-public-surface}

```ts
// tugdeck/src/lib/code-session-store.ts

export interface CodeSessionStoreOptions {
  conn: TugConnection;
  tugSessionId: string;
  displayLabel?: string;
}

export class CodeSessionStore {
  readonly streamingDocument: PropertyStore;

  constructor(options: CodeSessionStoreOptions);

  // L02 store protocol.
  subscribe(listener: () => void): () => void;
  getSnapshot(): CodeSessionSnapshot;

  // Actions.
  send(text: string, atoms: AtomSegment[], route: Route): void;
  interrupt(): void;
  respondApproval(
    requestId: string,
    payload: {
      decision: "allow" | "deny";
      updatedInput?: unknown;
      message?: string;
    },
  ): void;
  respondQuestion(
    requestId: string,
    payload: { answers: Record<string, unknown> },
  ): void;

  dispose(): void;
}
```

#### Spec S02: `CodeSessionSnapshot` shape {#s02-snapshot}

```ts
export type CodeSessionPhase =
  | "idle"
  | "submitting"
  | "awaiting_first_token"
  | "streaming"
  | "tool_work"
  | "awaiting_approval"
  | "complete"
  | "interrupted"
  | "errored";

export interface CodeSessionSnapshot {
  phase: CodeSessionPhase;

  tugSessionId: string;
  claudeSessionId: string | null;
  displayLabel: string;

  activeMsgId: string | null;
  canSubmit: boolean;
  canInterrupt: boolean;
  pendingApproval: ControlRequestForward | null;
  pendingQuestion: ControlRequestForward | null;
  queuedSends: number;

  transcript: ReadonlyArray<TurnEntry>;

  streamingPaths: {
    readonly assistant: "inflight.assistant";
    readonly thinking: "inflight.thinking";
    readonly tools: "inflight.tools";
  };

  lastCostUsd: number | null;
  lastError: {
    cause:
      | "session_state_errored"
      | "transport_closed"
      | "session_not_owned"
      | "session_unknown";
    message: string;
    at: number;
  } | null;
}

export interface TurnEntry {
  msgId: string;
  userMessage: { text: string; attachments: ReadonlyArray<unknown> };
  thinking: string;
  assistant: string;
  toolCalls: ReadonlyArray<ToolCallState>;
  result: "success" | "interrupted";
  endedAt: number;
}

export interface ToolCallState {
  toolUseId: string;
  toolName: string;
  input: unknown;
  status: "pending" | "done" | "error";
  result: unknown | null;
  structuredResult: unknown | null;
}
```

#### Spec S03: Turn-state transition table {#s03-transitions}

| From | Event | To | Side effects |
|------|-------|----|---|
| `idle` | internal `send` | `submitting` | Write `user_message` to CODE_INPUT via `encodeCodeInput` |
| `submitting` | first `thinking_text` / `assistant_text` partial (new `msg_id`) | `awaiting_first_token` → `streaming` | Initialize scratch buffers; set `activeMsgId` |
| `streaming` | `assistant_text` partial (`is_partial: true`) | `streaming` | Append delta; write `inflight.assistant` |
| `streaming` | `assistant_text` partial (`is_partial: false`) | `streaming` | Replace scratch with authoritative `text` |
| `streaming` | `thinking_text` partial | `streaming` | Append delta; write `inflight.thinking` |
| `streaming` | `tool_use` partial/complete | `tool_work` | Upsert `ToolCallState` in tool map; write `inflight.tools` |
| `tool_work` | `tool_use_structured` / `tool_result` (matching `tool_use_id`) | `streaming` (if all tools done) / `tool_work` (otherwise) | Mark entry `done`; update `inflight.tools` |
| `streaming` / `tool_work` | `control_request_forward` (`is_question: false`) | `awaiting_approval` | Populate `pendingApproval`; stash `prevPhase` |
| `streaming` / `tool_work` | `control_request_forward` (`is_question: true`) | `awaiting_approval` | Populate `pendingQuestion`; stash `prevPhase` |
| `awaiting_approval` | `respondApproval(...)` | `prevPhase` | Write `tool_approval` to CODE_INPUT; clear `pendingApproval` |
| `awaiting_approval` | `respondQuestion(...)` | `prevPhase` | Write `question_answer` to CODE_INPUT; clear `pendingQuestion` |
| any non-idle | `turn_complete(result: "success")` | `complete` → `idle` | Commit `TurnEntry(result: "success")`; clear `inflight.*`; flush one queued send if any |
| any non-idle | `turn_complete(result: "error")` | `interrupted` → `idle` | Commit `TurnEntry(result: "interrupted")` with preserved text; clear `inflight.*`; **clear queue** |
| any non-idle | `SESSION_STATE = errored` | `errored` → `idle` | Populate `lastError.cause = "session_state_errored"` |
| any non-idle | `transportClose` | `errored` → `idle` | Populate `lastError.cause = "transport_closed"` |
| any non-idle | CONTROL error `session_not_owned` (matching `tugSessionId`) | `errored` → `idle` | Populate `lastError.cause = "session_not_owned"` |
| any non-idle | CONTROL error `session_unknown` (matching `tugSessionId`) | `errored` → `idle` | Populate `lastError.cause = "session_unknown"` |
| `errored` | internal `send` | `submitting` | Same as `idle → submitting`; `lastError` stays set until next `turn_complete(success)` |

#### Spec S04: `errored` trigger table {#s04-errored-triggers}

| Trigger | Source | `lastError.cause` | Detection |
|---------|--------|-------------------|-----------|
| `SESSION_STATE = errored` frame | Supervisor (crash budget, future P13 caps) | `"session_state_errored"` | Filter-matched SESSION_STATE with `state === "errored"`; `detail` copied into `message` |
| WebSocket close during non-idle phase | Transport | `"transport_closed"` | `TugConnection` close observer; subscribed only while `phase !== "idle"` |
| CONTROL error `session_not_owned` | Router P5 authz | `"session_not_owned"` | CONTROL feed frame for this `tugSessionId` |
| CONTROL error `session_unknown` | Supervisor dispatcher | `"session_unknown"` | CONTROL feed frame for this `tugSessionId` |

Not in scope for `errored`:
- `turn_complete(result: "error")` — interrupt path, routes to `interrupted`.
- Malformed stream-json events — logged via `console.warn` and dropped; phase unchanged. Version drift is P15 territory.

#### Spec S05: Streaming document paths {#s05-streaming-paths}

| Path | Content | Writer | Clear on |
|------|---------|--------|----------|
| `inflight.assistant` | Accumulated `assistant_text` delta buffer for the current turn (string) | reducer side-effect handler | `turn_complete` (any result) |
| `inflight.thinking` | Accumulated `thinking_text` delta buffer (string) | same | same |
| `inflight.tools` | Serialized `ToolCallState[]` (JSON string) for in-flight tool calls | same | same |

The three path strings are exposed on the snapshot as `streamingPaths` literal types (`"inflight.assistant"` etc.) for TS consumers threading them through props.

#### Spec S06: `loadGoldenProbe` test helper {#s06-golden-loader}

```ts
// tugdeck/src/lib/code-session-store/testing/golden-catalog.ts

const FIXTURE_ROOT_RELATIVE =
  "../../../../tugrust/crates/tugcast/tests/fixtures/stream-json-catalog";

export interface GoldenProbe {
  version: string;
  probeName: string;
  events: ReadonlyArray<DecodedCodeOutputEvent>;
}

export function loadGoldenProbe(
  version: string,
  probeName: string,
): GoldenProbe;

// Substitutes {{uuid}}, {{iso}}, {{msg_id}}, {{tool_use_id}}, {{f64}},
// {{i64}}, {{text:len=N}} with deterministic per-test values, then parses
// one JSON event per line. Throws a readable Error with the resolved
// absolute path if the file is missing.
```

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/code-session-store.ts` | Public `CodeSessionStore` class, options, re-exports of snapshot + TurnEntry types |
| `tugdeck/src/lib/code-session-store/reducer.ts` | Pure reducer function `reduce(state, event) => state` + state shape |
| `tugdeck/src/lib/code-session-store/events.ts` | Discriminated union of decoded events the reducer accepts |
| `tugdeck/src/lib/code-session-store/types.ts` | `CodeSessionSnapshot`, `CodeSessionPhase`, `TurnEntry`, `ToolCallState`, `ControlRequestForward` (re-export) |
| `tugdeck/src/lib/code-session-store/testing/golden-catalog.ts` | `loadGoldenProbe` + placeholder substitution helpers (test-only) |
| `tugdeck/src/lib/code-session-store/testing/mock-feed-store.ts` | In-memory `FeedStore` double for reducer integration tests (test-only) |
| `tugdeck/src/lib/code-session-store/__tests__/code-session-store.round-trip.test.ts` | Basic round-trip + delta accumulation exit-criteria tests |
| `tugdeck/src/lib/code-session-store/__tests__/code-session-store.deltas.test.ts` | Streaming delta accumulation details |
| `tugdeck/src/lib/code-session-store/__tests__/code-session-store.tools.test.ts` | Tool lifecycle + concurrent tool tests |
| `tugdeck/src/lib/code-session-store/__tests__/code-session-store.control-forward.test.ts` | Permission approval / deny + AskUserQuestion tests |
| `tugdeck/src/lib/code-session-store/__tests__/code-session-store.interrupt.test.ts` | Interrupt + queue-clearing tests |
| `tugdeck/src/lib/code-session-store/__tests__/code-session-store.queue.test.ts` | Queue flush on success |
| `tugdeck/src/lib/code-session-store/__tests__/code-session-store.errored.test.ts` | Errored triggers + recovery tests |
| `tugdeck/src/lib/code-session-store/__tests__/code-session-store.filter.test.ts` | Filter correctness across multi-instance |
| `tugdeck/src/lib/code-session-store/__tests__/code-session-store.dispose.test.ts` | Dispose teardown + no-react-imports negative check |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `CodeSessionStore` | class | `tugdeck/src/lib/code-session-store.ts` | Public L02 store |
| `CodeSessionStoreOptions` | interface | same | Constructor options |
| `CodeSessionSnapshot` | interface | `types.ts` | Public snapshot shape per [S02] |
| `CodeSessionPhase` | type | `types.ts` | Phase enum |
| `TurnEntry` | interface | `types.ts` | Immutable transcript entry |
| `ToolCallState` | interface | `types.ts` | Per-call state |
| `CodeSessionState` | interface | `reducer.ts` | Internal mutable state carried through reducer |
| `CodeSessionEvent` | type (union) | `events.ts` | Discriminated union of decoded events |
| `reduce` | function | `reducer.ts` | Pure `(state, event) => state` |
| `loadGoldenProbe` | function | `testing/golden-catalog.ts` | Test-only |
| `MockFeedStore` | class | `testing/mock-feed-store.ts` | Test-only double |
| `codeSessionStore` re-export | barrel | `tugdeck/src/lib/index.ts` | Add `CodeSessionStore`, `CodeSessionSnapshot`, `TurnEntry` |
| `TugConnection.onClose` | method (may already exist) | `tugdeck/src/lib/connection.ts` | Add narrow surface if missing; Step 8 |

---

### Documentation Plan {#documentation-plan}

- [ ] One-paragraph JSDoc on `CodeSessionStore` class summarizing: per-card lifetime, identity model, transcript + streaming model, relationship to `CardSessionBindingStore`.
- [ ] One-line JSDoc on every public method (`send`, `interrupt`, `respondApproval`, `respondQuestion`, `dispose`, `subscribe`, `getSnapshot`).
- [ ] Inline comments on reducer transitions only where the wire behavior is non-obvious from the event name (interrupt path, concurrent tool correlation, approval `prevPhase` stashing). Default: no comments.
- [ ] Update [tide.md #t3-4-a-code-session-store](./tide.md#t3-4-a-code-session-store) to link this plan at the top with a "See [tugplan-code-session-store.md](./tugplan-code-session-store.md) for the implementation plan" pointer once this plan is approved.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Reducer unit** | Test `reduce(state, event) => state` in isolation against hand-built or fixture-loaded event sequences | Phase transitions, edge cases, error paths |
| **Store integration** | Test the full `CodeSessionStore` class with `MockFeedStore` driving events through subscribe/decode/dispatch | Subscription lifecycle, filter correctness, dispose teardown |
| **Fixture replay** | Test reducer + side-effect handler against `loadGoldenProbe(v2.1.105, ...)` JSONL streams | Exit-criteria tests aligned with fixture filenames |
| **Drift guard (inherited)** | Rust-side `stream_json_catalog_drift.rs` already exists and validates the fixture directory against live Claude | Runs out-of-band per [§P2 follow-up](./tide.md#p2-followup-golden-catalog) |

Every exit-criterion maps to a fixture replay test where the fixture exists, or to a reducer-unit test with synthetic events where the trigger is not in the golden catalog (e.g., `SESSION_STATE errored` synthetic frames, `transportClose` simulation).

---

### Execution Steps {#execution-steps}

> Every step commits after all checkpoints pass. Each step's `**References:**` line cites the [Dnn] decisions and [Snn] specs it implements.

#### Step 1: Scaffolding and types {#step-1}

**Commit:** `feat(tugdeck): scaffold code-session-store module + public types`

**References:** [D03] three-identifier model, [D04] transcript + streaming, [D09] metadata store independent, Spec S01, Spec S02, (#symbol-inventory, #turn-state-walkthrough)

**Artifacts:**
- `tugdeck/src/lib/code-session-store.ts` (skeleton class, throws on every method)
- `tugdeck/src/lib/code-session-store/types.ts` (`CodeSessionSnapshot`, `CodeSessionPhase`, `TurnEntry`, `ToolCallState`, `ControlRequestForward`)
- `tugdeck/src/lib/code-session-store/events.ts` (empty union placeholder)
- `tugdeck/src/lib/code-session-store/reducer.ts` (initial `CodeSessionState`, `createInitialState(tugSessionId, displayLabel)`, identity `reduce` stub)
- `tugdeck/src/lib/index.ts` — add barrel re-exports for `CodeSessionStore`, `CodeSessionSnapshot`, `TurnEntry`

**Tasks:**
- [ ] Declare the class, constructor, and all public methods (throwing `"not implemented"`).
- [ ] Define all types in `types.ts` exactly per Spec S02.
- [ ] Define `CodeSessionState` shape in `reducer.ts` including `phase`, `scratch buffers`, `toolCallMap: Map<string, ToolCallState>`, `queuedSends: Array<SendArgs>`, `prevPhase: CodeSessionPhase | null`, `lastError`, `lastCostUsd`, `claudeSessionId`, `transcript: TurnEntry[]`, `activeMsgId`, `pendingApproval`, `pendingQuestion`.
- [ ] Implement `createInitialState(tugSessionId, displayLabel)`.
- [ ] Implement `CodeSessionStore.subscribe` and `getSnapshot` against the initial state (no reducer yet).
- [ ] Wire up the constructor to create an internal `PropertyStore` exposed as `readonly streamingDocument` and initialize three empty paths.

**Tests:**
- [ ] `code-session-store.scaffold.test.ts`: construct a store with a `MockTugConnection` (simplest possible double); assert `getSnapshot()` returns the initial snapshot shape with `phase === "idle"`, `transcript === []`, `streamingPaths` populated.

**Checkpoint:**
- [ ] `cd tugdeck && bun run typecheck` (or `tsc --noEmit`)
- [ ] `cd tugdeck && bun test src/lib/code-session-store`

---

#### Step 2: Golden fixture loader + mock FeedStore {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add golden-catalog loader and mock FeedStore for code-session-store tests`

**References:** [D07] Vitest reads in-place, Spec S06, (#r02-fixture-path-coupling)

**Artifacts:**
- `tugdeck/src/lib/code-session-store/testing/golden-catalog.ts` — `loadGoldenProbe(version, probeName)`, placeholder substitution, typed parse
- `tugdeck/src/lib/code-session-store/testing/mock-feed-store.ts` — in-memory `MockFeedStore` + `MockTugConnection` that together can replay parsed events to a subscriber
- `tugdeck/src/lib/code-session-store/__tests__/golden-catalog.test.ts`

**Tasks:**
- [ ] Implement `FIXTURE_ROOT_RELATIVE` as a top-of-file constant and resolve paths via `__dirname` + `path.resolve`.
- [ ] Implement placeholder substitution with deterministic per-test values (not randomized): `{{uuid}}` → `"11111111-2222-3333-4444-555555555555"` (or a counter), `{{iso}}` → `"2026-01-01T00:00:00Z"`, numeric placeholders → `0` / `0.0`, `{{text:len=N}}` → a repeated-character string of length N. Keep the substitution exported so tests can override if they care.
- [ ] Throw a readable `Error` on missing fixtures including the resolved absolute path.
- [ ] `MockFeedStore` implements the same subscribe/filter interface as the real `FeedStore` — accepts the 4-argument constructor signature and exposes a `replay(frames)` method used by tests.
- [ ] `MockTugConnection` exposes a spy on `send()` so tests can assert what frames were written to which feed ids.

**Tests:**
- [ ] `golden-catalog.test.ts`: load `v2.1.105/test-01-round-trip.jsonl`, assert the parsed events include at least one `assistant_text` event with the expected structure.
- [ ] `golden-catalog.test.ts`: load a non-existent fixture, assert the error message includes the resolved path and the word "fixture".
- [ ] `mock-feed-store.test.ts`: subscribe a listener, replay three synthetic events, assert the listener saw them in order and the filter was applied.

**Checkpoint:**
- [ ] `cd tugdeck && bun run typecheck`
- [ ] `cd tugdeck && bun test src/lib/code-session-store`

---

#### Step 3: Reducer core — basic round-trip {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): code-session-store reducer — basic round-trip`

**References:** [D01] store owns FeedStore, [D02] card owns lifecycle, Spec S01, Spec S03, Spec S05, (#turn-state-walkthrough)

**Artifacts:**
- `code-session-store/events.ts` — populate event union for `session_init`, `turn_complete`, `send` (internal), `errored_state` (placeholder for Step 8), `transport_close` (placeholder for Step 8)
- `code-session-store/reducer.ts` — implement `idle → submitting → awaiting_first_token → streaming → complete → idle` path
- `code-session-store.ts` — wire up the real `FeedStore` construction with the `tug_session_id` filter; wire up `send()` to dispatch via `encodeCodeInput` through `conn.send`; wire up subscription loop that decodes CODE_OUTPUT events and feeds them to `reduce`
- `TurnEntry` commit: post-reduce side-effect handler appends to `transcript` on phase transitions

**Tasks:**
- [ ] Implement `idle → submitting` on `send()`: write `user_message` frame, set `activeMsgId = null` (until we see the first partial).
- [ ] Implement `submitting → awaiting_first_token → streaming` on first `assistant_text` partial (new `msg_id` detection).
- [ ] Implement minimal `streaming → complete → idle` on `turn_complete(success)` with an empty `TurnEntry` commit.
- [ ] Wire up the `FeedStore` subscription: on every frame, decode the JSON payload, dispatch to the reducer, and write any side-effect signals to `streamingDocument` or `conn.send`.
- [ ] Implement `getSnapshot` to return a new frozen object that reflects current state.

**Tests:**
- [ ] `code-session-store.round-trip.test.ts`: load `v2.1.105/test-01-round-trip.jsonl`, construct store with `MockTugConnection` + `tugSessionId: "11111111-..."`, call `store.send("hello", [], ">")`, assert a `user_message` frame was written to `MockTugConnection` on CODE_INPUT with the correct `tug_session_id`. Replay the fixture through `MockFeedStore`. Assert the phase sequence via snapshot polling between events. Assert `transcript.length === 1` at the end.

**Checkpoint:**
- [ ] `cd tugdeck && bun run typecheck`
- [ ] `cd tugdeck && bun test src/lib/code-session-store/__tests__/code-session-store.round-trip.test.ts`

---

#### Step 4: Streaming delta accumulation (assistant_text, thinking_text) {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): code-session-store streaming delta accumulation`

**References:** [D04] transcript + streaming, Spec S05, (#turn-state-walkthrough)

**Artifacts:**
- `reducer.ts` — implement scratch-buffer accumulation keyed by `msg_id` for `assistant_text` and `thinking_text` partials; handle `is_partial: false` (authoritative text replacement)
- `code-session-store.ts` — post-reduce handler writes `inflight.assistant` and `inflight.thinking` via `streamingDocument.set`; on `turn_complete`, commits the buffers into the new `TurnEntry` and clears `inflight.*`

**Tasks:**
- [ ] Track `scratch: Map<msg_id, { assistant: string; thinking: string }>` in reducer state.
- [ ] On `assistant_text` partial with `is_partial: true`, append `text` to the matching scratch entry.
- [ ] On `assistant_text` partial with `is_partial: false`, replace with the authoritative `text` field.
- [ ] Same for `thinking_text`.
- [ ] On `turn_complete(success)`, build the `TurnEntry` from the scratch entry for `activeMsgId` and append.
- [ ] Clear `inflight.*` paths via `streamingDocument.set("inflight.assistant", "")` etc. after commit.

**Tests:**
- [ ] `code-session-store.deltas.test.ts`: replay `v2.1.105/test-02-streaming-deltas.jsonl`, assert `streamingDocument.get("inflight.assistant")` grows monotonically in arrival order, then equals the `complete` event's `text` byte-for-byte. Assert `TurnEntry.assistant` in the final transcript matches.
- [ ] `code-session-store.deltas.test.ts`: same fixture, assert `inflight.assistant === ""` after `turn_complete`.
- [ ] `code-session-store.deltas.test.ts` (synthetic): build events for two `thinking_text` deltas and one final, assert `inflight.thinking` accumulates correctly.

**Checkpoint:**
- [ ] `cd tugdeck && bun run typecheck`
- [ ] `cd tugdeck && bun test src/lib/code-session-store/__tests__/code-session-store.deltas.test.ts`

---

#### Step 5: Tool call lifecycle {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugdeck): code-session-store tool call tracking`

**References:** [D04] transcript + streaming, Spec S02 (ToolCallState), Spec S03, [Q02] resolve tool-map-vs-array, Risk R01, (#r01-tool-call-interleave)

**Artifacts:**
- `reducer.ts` — implement `Map<tool_use_id, ToolCallState>` tracking; transitions `streaming → tool_work` and `tool_work → streaming` based on map-all-done predicate
- Resolve [Q02] inline: commit as `ReadonlyArray<ToolCallState>` on `TurnEntry` in insertion order; the in-flight Map is converted on commit.
- `code-session-store.ts` — post-reduce handler serializes the in-flight tool Map to `inflight.tools` on every update

**Tasks:**
- [ ] Add `toolCallMap: Map<string, ToolCallState>` to `CodeSessionState`.
- [ ] On `tool_use` partial/complete, upsert the map entry with `status: "pending"`; transition to `tool_work`.
- [ ] On `tool_result` / `tool_use_structured` matching `tool_use_id`, update the map entry to `status: "done"` with `result` / `structuredResult` populated.
- [ ] After each tool event, if every map entry is `done`, transition back to `streaming`.
- [ ] On `turn_complete`, commit `Array.from(toolCallMap.values())` into `TurnEntry.toolCalls` (preserving insertion order).
- [ ] Write serialized map to `inflight.tools` via `JSON.stringify(Array.from(...))` on every change.
- [ ] Resolve [Q02]: array, not Map. Document the decision inline in the reducer.

**Tests:**
- [ ] `code-session-store.tools.test.ts`: replay `v2.1.105/test-05-tool-use.jsonl`, assert `phase === "tool_work"` after first `tool_use` partial, `phase === "streaming"` after matching `tool_result`, `inflight.tools` contains the tool name.
- [ ] `code-session-store.tools.test.ts`: replay `v2.1.105/test-21-concurrent-tools.jsonl`, assert two distinct `tool_use_id`s appear in `inflight.tools` simultaneously, assert `phase === "tool_work"` until both resolve.
- [ ] `code-session-store.tools.test.ts`: assert `TurnEntry.toolCalls` on the committed turn is an array in insertion order.

**Checkpoint:**
- [ ] `cd tugdeck && bun run typecheck`
- [ ] `cd tugdeck && bun test src/lib/code-session-store/__tests__/code-session-store.tools.test.ts`

---

#### Step 6: Control request forward (permission + question) {#step-6}

**Depends on:** #step-5

**Commit:** `feat(tugdeck): code-session-store permission + question control forward`

**References:** [D06] split respond actions, Spec S01, Spec S03, (#turn-state-walkthrough)

**Artifacts:**
- `reducer.ts` — `streaming / tool_work → awaiting_approval` on `control_request_forward`, dispatching on `is_question`; `awaiting_approval → prevPhase` on `respondApproval` / `respondQuestion` actions
- `code-session-store.ts` — implement `respondApproval` and `respondQuestion` public methods with outbound frame dispatch via `encodeCodeInput`

**Tasks:**
- [ ] Add `prevPhase: CodeSessionPhase | null` to state; stash when entering `awaiting_approval`; restore on respond.
- [ ] On `control_request_forward` with `is_question: false`, populate `pendingApproval` with the decoded event.
- [ ] On `control_request_forward` with `is_question: true`, populate `pendingQuestion`.
- [ ] `respondApproval(requestId, { decision, updatedInput?, message? })` writes `{ type: "tool_approval", request_id: requestId, decision, updatedInput, message }` via `encodeCodeInput` and clears `pendingApproval`.
- [ ] `respondQuestion(requestId, { answers })` writes `{ type: "question_answer", request_id: requestId, answers }` and clears `pendingQuestion`.
- [ ] Both transition back to `prevPhase`.

**Tests:**
- [ ] `code-session-store.control-forward.test.ts`: replay `v2.1.105/test-08-permission.jsonl`, assert `phase === "awaiting_approval"` after the control event, assert `pendingApproval` is populated. Call `respondApproval(requestId, { decision: "allow" })`, assert a `tool_approval` frame was written to CODE_INPUT with correct `request_id` and `decision`.
- [ ] Same with `v2.1.105/test-11-tool-deny.jsonl` and `decision: "deny"`.
- [ ] Replay `v2.1.105/test-35-ask-user-question.jsonl`, assert `pendingQuestion` populated; `respondQuestion(requestId, { answers })` writes a `question_answer` frame.

**Checkpoint:**
- [ ] `cd tugdeck && bun run typecheck`
- [ ] `cd tugdeck && bun test src/lib/code-session-store/__tests__/code-session-store.control-forward.test.ts`

---

#### Step 7: Interrupt + queue semantics {#step-7}

**Depends on:** #step-6

**Commit:** `feat(tugdeck): code-session-store interrupt + queue behavior`

**References:** [D05] interrupt clears queue, Spec S01, Spec S03, (#d05-interrupt-clears-queue)

**Artifacts:**
- `reducer.ts` — queued sends array, enqueue on non-idle `send`, flush one on `turn_complete(success) → idle`, clear on `turn_complete(error) → idle`
- `code-session-store.ts` — implement `interrupt()` public method; write `{ type: "interrupt" }` frame; rely on `turn_complete(error)` to drive the transition

**Tasks:**
- [ ] On `send()` with `phase !== "idle"`, enqueue `{ text, atoms, route }` to `queuedSends`.
- [ ] On `turn_complete(success)`, shift one entry off `queuedSends` and re-emit as an internal `send` event.
- [ ] `interrupt()` writes `{ type: "interrupt" }` frame via `encodeCodeInput` and (synchronously in the reducer) clears `queuedSends`.
- [ ] On `turn_complete(error)`, commit `TurnEntry(result: "interrupted")` with preserved text, clear `inflight.*`. `queuedSends` is already empty from `interrupt()`.
- [ ] Update the transcript commit handler to build `TurnEntry.result` based on the `turn_complete` variant.

**Tests:**
- [ ] `code-session-store.interrupt.test.ts`: replay `v2.1.105/test-06-interrupt.jsonl`, call `store.interrupt()` while `phase === "streaming"`, assert the `interrupt` frame was written, replay `turn_complete(error)`, assert `phase === "idle"`, assert `transcript[0].result === "interrupted"` and `transcript[0].assistant` contains the preserved text.
- [ ] `code-session-store.interrupt.test.ts` (synthetic): three `store.send` calls during `streaming`, assert `queuedSends === 3`. Call `store.interrupt()`. Replay `turn_complete(error)`. Assert `queuedSends === 0` and that exactly two `user_message` frames were written to the mock connection (one original + zero from the queue — the interrupt frame is not a `user_message`).
- [ ] `code-session-store.queue.test.ts`: three `store.send` calls during `streaming`, assert `queuedSends === 3`. Replay `turn_complete(success)`. Assert the store wrote one queued `user_message` frame and transitioned through `complete → idle → submitting`. Replay another `turn_complete(success)`, assert a second queued send fires, and so on until `queuedSends === 0`.

**Checkpoint:**
- [ ] `cd tugdeck && bun run typecheck`
- [ ] `cd tugdeck && bun test src/lib/code-session-store/__tests__/code-session-store.interrupt.test.ts src/lib/code-session-store/__tests__/code-session-store.queue.test.ts`

---

#### Step 8: Errored phase triggers {#step-8}

**Depends on:** #step-7

**Commit:** `feat(tugdeck): code-session-store errored phase triggers + recovery`

**References:** [D08] errored vs interrupted distinct, Spec S03, Spec S04, (#s04-errored-triggers)

**Artifacts:**
- `reducer.ts` — handle `SESSION_STATE = errored`, `transportClose`, CONTROL errors; populate `lastError` with cause tag
- `code-session-store.ts` — add SESSION_STATE subscription to the filtered FeedStore; add CONTROL subscription with `tug_session_id` match; subscribe to `TugConnection` close while non-idle; recovery: `lastError` clears on next `turn_complete(success)`
- `tugdeck/src/lib/connection.ts` — add `onClose(listener)` method if not present (returns unsubscribe)

**Tasks:**
- [ ] Extend the filtered FeedStore subscription to `[CODE_OUTPUT, SESSION_STATE]` (per [D09]; no SESSION_METADATA).
- [ ] Add a separate CONTROL feed subscription (filter the same way — `tug_session_id` match on decoded payload) to catch `session_not_owned` / `session_unknown`.
- [ ] Add a `TugConnection.onClose` subscription tracked with the store's non-idle-window lifetime (subscribe on `phase !== "idle"`, unsubscribe on return to idle).
- [ ] Implement reducer transitions for all four triggers per Spec S04.
- [ ] Implement `send()` from `errored`: transitions to `submitting` and writes the frame; `lastError` stays set.
- [ ] On `turn_complete(success)` from `errored`'s recovery flow, clear `lastError`.

**Tests:**
- [ ] `code-session-store.errored.test.ts` (synthetic): inject a `SESSION_STATE { state: "errored", detail: "crash_budget_exhausted" }` during `streaming`, assert `phase === "errored"`, `lastError.cause === "session_state_errored"`, `lastError.message` contains `"crash_budget_exhausted"`, `transcript` unchanged.
- [ ] `code-session-store.errored.test.ts` (synthetic): simulate `conn.triggerClose()` while `phase === "submitting"`, assert `phase === "errored"`, `lastError.cause === "transport_closed"`.
- [ ] `code-session-store.errored.test.ts` (synthetic): inject CONTROL error with `detail: "session_not_owned"`, assert `phase === "errored"`, cause `"session_not_owned"`.
- [ ] `code-session-store.errored.test.ts` (synthetic): inject CONTROL error `session_unknown`, assert `"session_unknown"` cause.
- [ ] `code-session-store.errored.test.ts`: from `errored`, call `store.send("retry")`, assert `phase === "submitting"`, `lastError` still set. Replay `turn_complete(success)`, assert `lastError === null`.

**Checkpoint:**
- [ ] `cd tugdeck && bun run typecheck`
- [ ] `cd tugdeck && bun test src/lib/code-session-store/__tests__/code-session-store.errored.test.ts`

---

#### Step 9: Filter correctness + dispose teardown {#step-9}

**Depends on:** #step-8

**Commit:** `feat(tugdeck): code-session-store filter isolation + dispose teardown`

**References:** [D01] store owns FeedStore, [D02] card owns lifecycle, Spec S01, (#d01-store-owns-feedstore, #d02-card-owns-lifecycle)

**Artifacts:**
- Verification tests that validate multi-instance isolation and dispose cleanup (no code changes beyond ensuring `dispose` is wired correctly)

**Tasks:**
- [ ] Audit `dispose()`: unsubscribe `FeedStore`, unsubscribe CONTROL subscription, unsubscribe `onClose` listener, clear listener list, clear `queuedSends`, clear `inflight.*` paths. Does **not** send `close_session`.
- [ ] Verify `MockFeedStore` + `MockTugConnection` support constructing two stores against one connection.

**Tests:**
- [ ] `code-session-store.filter.test.ts`: construct `storeA` with `tugSessionId: "aaaa..."` and `storeB` with `tugSessionId: "bbbb..."` on a shared `MockTugConnection`. Replay frames tagged with storeA's id. Assert storeA's snapshot reflects the events; storeB's snapshot is unchanged from initial.
- [ ] `code-session-store.dispose.test.ts`: construct a store, subscribe a listener, replay a frame, assert listener fires. Call `store.dispose()`. Replay another frame, assert listener did not fire and `getSnapshot()` is unchanged. Assert `streamingDocument.get("inflight.assistant") === ""`. Assert no `close_session` frame was written to the connection.

**Checkpoint:**
- [ ] `cd tugdeck && bun run typecheck`
- [ ] `cd tugdeck && bun test src/lib/code-session-store/__tests__/code-session-store.filter.test.ts src/lib/code-session-store/__tests__/code-session-store.dispose.test.ts`

---

#### Step 10: Negative checks (react imports, IndexedDB) {#step-10}

**Depends on:** #step-9

**Commit:** `test(tugdeck): code-session-store negative checks for react + indexeddb imports`

**References:** [D09] metadata store independent, Constraints (#constraints)

**Artifacts:**
- One small test file asserting the store has no forbidden imports

**Tasks:**
- [ ] Write a test that uses Node's `fs` to read `code-session-store.ts` and its `reducer.ts` + `events.ts` + `types.ts` siblings and assert the file contents do not contain `from "react"`, `from 'react'`, `indexedDB`, `IDBDatabase`. (A test on the source text, not a runtime check.)

**Tests:**
- [ ] `code-session-store.dispose.test.ts` (or a new `negative-imports.test.ts` — pick one): grep-style assertion.

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/lib/code-session-store/__tests__`
- [ ] `cd tugdeck && rg 'from "react"' src/lib/code-session-store.ts src/lib/code-session-store/reducer.ts src/lib/code-session-store/events.ts src/lib/code-session-store/types.ts` exits with no matches

---

#### Step 11: Integration checkpoint {#step-11}

**Depends on:** #step-3, #step-4, #step-5, #step-6, #step-7, #step-8, #step-9, #step-10

**Commit:** `N/A (verification only)`

**References:** [D01]–[D10], all specs, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Re-verify every exit criterion in the `#success-criteria` list; check the box.
- [ ] Run the full tugdeck test suite to catch regressions in other stores.
- [ ] Grep-verify: zero React imports in store files, zero IndexedDB references, public barrel re-exports present.
- [ ] Update [tide.md §T3.4.a](./tide.md#t3-4-a-code-session-store) with a one-line pointer to this plan and a "✓ LANDED" note on the T3.4.a section header.

**Tests:**
- [ ] Full tugdeck test run is green.

**Checkpoint:**
- [ ] `cd tugdeck && bun run typecheck`
- [ ] `cd tugdeck && bun test`
- [ ] `rg 'from "react"' tugdeck/src/lib/code-session-store.ts tugdeck/src/lib/code-session-store/` — zero matches
- [ ] `rg 'IDBDatabase|indexedDB' tugdeck/src/lib/code-session-store.ts tugdeck/src/lib/code-session-store/` — zero matches (excluding `testing/`)
- [ ] Manual spot: import `CodeSessionStore` from `tugdeck/src/lib` (the barrel) and call `new CodeSessionStore(...)` in a REPL/scratch file; verify types resolve cleanly.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** `CodeSessionStore` — a per-Tide-card L02 TypeScript store owning Claude Code turn state, fully tested against the `v2.1.105/` golden fixture catalog, ready to be consumed by [T3.4.b](./tide.md#t3-4-b-prompt-entry) (`tug-prompt-entry`) and [T3.4.c](./tide.md#t3-4-c-tide-card) (Tide card registration).

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] `tugdeck/src/lib/code-session-store.ts` exists and exports `CodeSessionStore` + `CodeSessionSnapshot` + `TurnEntry`. (`ls` + barrel grep)
- [ ] `cd tugdeck && bun run typecheck` clean.
- [ ] `cd tugdeck && bun test` green across the full tugdeck suite.
- [ ] Every exit criterion in [Success Criteria](#success-criteria) has a passing test cited by name.
- [ ] Zero `react` / `react-dom` imports in `code-session-store.ts` and its `code-session-store/` siblings.
- [ ] Zero `IDBDatabase` / `indexedDB` references in the same files.
- [ ] All fixture-replay tests load from `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.105/` via `loadGoldenProbe`.
- [ ] `tide.md §T3.4.a` updated with a pointer to this plan and a ✓ status.

**Acceptance tests:**
- [ ] `code-session-store.round-trip.test.ts` passes against `test-01-round-trip.jsonl` and `test-02-streaming-deltas.jsonl`.
- [ ] `code-session-store.tools.test.ts` passes against `test-05-tool-use.jsonl` and `test-21-concurrent-tools.jsonl`.
- [ ] `code-session-store.control-forward.test.ts` passes against `test-08-permission.jsonl`, `test-11-tool-deny.jsonl`, `test-35-ask-user-question.jsonl`.
- [ ] `code-session-store.interrupt.test.ts` passes against `test-06-interrupt.jsonl` and the synthetic queue-clear scenario.
- [ ] `code-session-store.queue.test.ts` passes the multi-flush scenario.
- [ ] `code-session-store.errored.test.ts` passes all four trigger scenarios + recovery.
- [ ] `code-session-store.filter.test.ts` passes the multi-instance isolation scenario.
- [ ] `code-session-store.dispose.test.ts` passes the teardown scenario and the negative-imports check.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] [P14](./tide.md#p14-claude-resume) — Claude `--resume` + tugbank persistence of `claude_session_id`. Unlocks transcript rehydration on reload per [Q01]. Schedules after T3.4.c.
- [ ] [P15](./tide.md#p15-stream-json-version-gate) — version gate + divergence telemetry + version-adaptive reducer scaffold. Informed by the store's actual field dependencies, so must land after T3.4.a.
- [ ] [P16](./tide.md#p16-session-command-continue) — `session_command: new/continue/fork` through the multi-session router. Unblocks multi-session-within-a-card and re-enables `test-13/17/20` fixtures. Parallelizable.
- [ ] [T3.4.b](./tide.md#t3-4-b-prompt-entry) — `tug-prompt-entry` component consumes `CodeSessionStore` via `useSyncExternalStore`. Next step on the critical path.
- [ ] [T3.4.c](./tide.md#t3-4-c-tide-card) — Tide card registration; wires `CodeSessionStore` + `SessionMetadataStore` + `CardSessionBindingStore` together with `TugSplitPane`. Rides with [W3.b](./tide.md#t3-workspace-registry-w3b) bootstrap removal.

| Checkpoint | Verification |
|------------|--------------|
| Store scaffolding + types | Step 1 checkpoint (`bun run typecheck` + scaffold test) |
| Golden fixture loader | Step 2 checkpoint (`golden-catalog.test.ts` + `mock-feed-store.test.ts`) |
| Basic round-trip reducer | Step 3 checkpoint (`code-session-store.round-trip.test.ts`) |
| Streaming delta accumulation | Step 4 checkpoint (`code-session-store.deltas.test.ts`) |
| Tool call lifecycle | Step 5 checkpoint (`code-session-store.tools.test.ts`) |
| Control request forward | Step 6 checkpoint (`code-session-store.control-forward.test.ts`) |
| Interrupt + queue semantics | Step 7 checkpoint (`code-session-store.interrupt.test.ts`, `code-session-store.queue.test.ts`) |
| Errored triggers + recovery | Step 8 checkpoint (`code-session-store.errored.test.ts`) |
| Filter correctness + dispose | Step 9 checkpoint (`code-session-store.filter.test.ts`, `code-session-store.dispose.test.ts`) |
| Negative import checks | Step 10 checkpoint (grep + Vitest) |
| Phase integration | Step 11 (`bun test` full suite, all exit criteria boxed) |
