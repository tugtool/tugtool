<!-- tugplan-skeleton v2 -->

## Tide Card Polish — Tugcast-Side Session Ledger {#tide-session-ledger}

**Purpose:** Move per-session bookkeeping out of the tugbank `sessions` map and into a purpose-built sqlite ledger inside tugcast. Add per-row metadata (turn_count, first_user_prompt, state, card_id_live), three CONTROL ops (`list_sessions`, `forget_session`, `forget_workspace_sessions`) plus a `session_updated` broadcast, and a richer picker UX showing N sessions per workspace with snippets, timestamps, and state indicators. Replaces the placeholder in the parent plan's §step-10.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | tugplan-tide-session-ledger |
| Last updated | 2026-05-02 |
| Roadmap anchor | [tugplan-tide-card-polish.md §step-10](./tugplan-tide-card-polish.md#step-10) — this plan executes that step |
| Predecessors | T3.4.c §step-4-5 (resume-vs-new picker), §step-4-5-5 (chain audit), §step-4-5-6 (post-impl audit), parent §step-7-5 (transport-state lifecycle) |
| Successors | parent §step-11 (multi-turn transcript) is independent and not blocked by this plan |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Per-session bookkeeping today is spread across three tugbank entries:

- `dev.tugtool.tide / sessions` — map of `{ [claudeSessionId]: { projectDir, createdAt } }`, written by `TugbankSessionsRecorder` on `session_init`, removed on `resume_failed`.
- `dev.tugtool.tide / live-sessions` — JSON array of session ids currently bound to a card, written by `TugbankLiveSessionsTracker` on bind / close.
- `dev.tugtool.tide.session-keys` — per-card binding (`tug_session_id`, `claude_session_id`, `project_dir`, …).

The picker reads `sessions` + `live-sessions` via `useTugbankValue` and surfaces a single "Resume last session" row per workspace. T3.4.c §step-4-5 shipped that minimum. T3.4.c §step-4-5-5 hardened the chain (no silent resume fallback; live-elsewhere rejection; pre-flight stat). What's still missing is everything the *user* would actually want to see at the picker:

- "I have three sessions going in this repo — which one am I resuming?"
- "I closed a card; did that throw away my session?"
- "Two cards both resumed the same session — now the JSONL is corrupt." *(Already covered by §step-4-5-5's live-elsewhere rejection — but the picker still surfaces only the one most-recent row.)*
- "I want to forget one specific session without forgetting all of them."
- "The resume timestamp is opaque; I want to see what the conversation was about."

This plan delivers each of those. The tugbank `sessions` map and `live-sessions` set both retire in favor of a sqlite ledger inside tugcast. The picker rewires from synchronous tugbank reads to a CONTROL `list_sessions` request plus a `session_updated` push subscription. New per-row Forget actions plus per-workspace Forget-all retire sessions deliberately, with a recoverable trash subdir for the JSONL.

#### Strategy {#strategy}

- **Ledger first, consumers next.** The sqlite ledger + migration land first as an internal write target. The bridge swaps in the new recorder/tracker behind existing traits — `SessionsRecorder` and `LiveSessionsTracker` are already abstractions in `agent_supervisor.rs`. Until the picker rewires, the ledger is invisible to the user.
- **CONTROL ops, not tugbank watches.** The picker subscribes to `list_sessions` + `session_updated` broadcasts. Tugbank stays focused on per-card binding (session-keys) and out of session metadata.
- **Ledger starts empty; no data migration from tugbank.** The existing `dev.tugtool.tide / sessions` map is an index over JSONLs that still live on disk; the ledger populates organically as new sessions spawn after this lands. Existing sessions disappear from the picker's resume list, but the underlying JSONLs are untouched — backfill (scanning `~/.claude/projects/`) is a follow-on if and when anyone misses them. The old tugbank keys go quiet (no writes after [Step 2](#step-2)) and rot harmlessly. See [D09].
- **Live state moves into the ledger.** `state="live"` + `card_id_live` replace the separate `live-sessions` set. One source of truth.
- **Resume failure is a crumb, not a delete.** The supervisor stops calling `sessions_recorder.remove(stale)`; instead it sets `state="failed"`. The picker shows a greyed row with a diagnostic. Per-row Forget is the only deletion path. See [D03].
- **Eviction is automatic but bounded.** Cap per workspace (`TIDE_LEDGER_MAX_PER_WORKSPACE`, initial 20), age-based expiry (`TIDE_LEDGER_MAX_AGE`, initial 90 days). Live rows never evicted. See [D04].
- **Forget moves to trash.** Per-row Forget moves the JSONL to `<workspace>/.tug-trash/<deletedAt>/<sessionId>.jsonl`; startup sweep removes anything older than 7 days. Recoverable for a week. See [D05].
- **Picker stays a list, not a table.** Token-driven rich rows over a `<div role="radiogroup">`. No new table primitive built or required. See [D06].
- **Tuglaws cross-checked.** [L02] (picker state via `useSyncExternalStore` against the new `tideSessionLedgerStore`), [L23] (session metadata survives reconnect via the ledger's persistence). No new IndexedDB ([D-T3-10]).
- **Build stays green at every commit.** `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run` pass on every step. Warnings are errors.

#### Success Criteria (Measurable) {#success-criteria}

- A `SessionLedger` exists at `tugrust/crates/tugcast/src/session_ledger.rs`, backed by sqlite under the user's data dir, with the schema in [#schema]. (Verified: file exists; `cargo nextest run` covers CRUD + eviction + sweep.)
- The old `dev.tugtool.tide / sessions` and `dev.tugtool.tide / live-sessions` tugbank keys receive no writes after this lands (the new code paths don't touch them). They're left in place as dead bytes — no migration, no deletion. (Verified: grep audit on production code returns zero writes; the keys can be cleaned up manually via `tugbank-cli` if anyone cares.)
- Picker renders N rows per workspace, ordered by `last_used_at DESC`, each row showing snippet / turn count / relative timestamp / state. (Verified: picker test fixture seeds 3 ledger rows; renders 3 rows in correct order with correct fields.)
- Picker subscribes to `session_updated` while open; turn-count tick on a live session updates its row in place without re-mount. (Verified: integration test dispatches a fake `session_updated` and asserts the rendered turn count updates.)
- Per-row Forget moves the JSONL to `<workspace>/.tug-trash/...` and removes the row. (Verified: integration test asserts both file move and ledger row removal.)
- A workspace with > 20 sessions has the oldest `state="closed"` row evicted on next spawn. (Verified: ledger unit test.)
- A workspace whose recent-projects entry is evicted has its ledger rows evicted in the same transaction. (Verified: integration test.)
- `resume_failed` retains the row with `state="failed"` and shows it greyed in the picker. (Verified: chain test.)
- `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run` green at every step.

#### Scope {#scope}

1. **Ledger crate.** Sqlite schema (idempotent DDL — `CREATE TABLE IF NOT EXISTS`), CRUD API, eviction helpers. In-memory test fallback.
2. **Bridge / supervisor wiring.** New `LedgerSessionsRecorder` and the live-state collapse into ledger rows. Stops writing to the old tugbank keys; resume-failed flips `state="failed"` instead of deleting the row.
3. **CONTROL ops.** `list_sessions`, `forget_session`, `forget_workspace_sessions`, `session_updated` broadcast. Encoders/decoders in tugdeck and tugcast.
4. **Tugdeck client store.** `tideSessionLedgerStore` — observes `session_updated` broadcasts, caches the workspace's session list.
5. **Picker rewires + UX.** Drop tugbank reads; render rich rows; Forget actions.
6. **Eviction + recents coherence.** Cap, age, recents↔ledger coupling.
7. **Trash + sweep.** JSONL move on Forget; startup sweep > 7 days.
8. **Tuglaws walkthrough + parent close-out.** Per-step compliance plus the close-out commit.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Server-side archival or search across prior sessions.
- Cross-machine sync.
- Session branching ("fork from turn N").
- A purpose-built table / grid component for the session list.
- Storage-pressure / response-byte tracking for a future "trim old sessions" UX. Not covered by the ledger schema in this plan.
- Collapsing `tug_session_id` and `claude_session_id` into one identifier. The dual-id model from §step-4-5-5 stays — the ledger keys on `claude_session_id` (the wire id) but the in-flight binding still uses `tug_session_id` during the spawn-handshake window. See [D08].
- Migrating the `session-keys` (per-card binding) domain off tugbank. Different concern, different lifecycle, different consumer.
- New IndexedDB-backed storage anywhere on the client side ([D-T3-10]).
- Generalizing the ledger to a multi-tenant store. One sqlite file per local user, period.

#### Dependencies / Prerequisites {#dependencies}

- Existing `SessionsRecorder` / `LiveSessionsTracker` traits in `tugrust/crates/tugcast/src/feeds/agent_supervisor.rs`.
- Existing `TugbankClient` for the migration read.
- Existing `tugcast` CONTROL feed and per-card subscription model.
- Existing `TideProjectPickerForm` in `tugdeck/src/components/tugways/cards/tide-card.tsx`.
- T3.4.c §step-4-5-5 shipped — silent resume fallback removed; live-elsewhere rejection at the supervisor; tugcode `stat` pre-flight; `claudeSessionId` on `CardSessionBinding`.
- `rusqlite` — already a workspace dependency (used by `TugbankClient`).

#### Constraints {#constraints}

- **Tuglaws** [L02], [L11], [L19], [L23] apply. See [#tuglaws-cross-check].
- **Warnings are errors.** `cargo build` / `cargo nextest run` enforce `-D warnings`.
- **No data migration.** The ledger starts empty on first run. Existing sessions in the tugbank `sessions` map disappear from the picker's resume list, but their JSONL files remain on disk. Recovery (if ever needed) is a backfill that scans `~/.claude/projects/` — out of scope for this plan. See [D09].
- **HMR is always running.** No manual tugdeck builds (`feedback_hmr`).
- **Use bun, not npm** (`feedback_use_bun`).
- **No mock-store assertion tests** — picker tests dispatch through the real store + CONTROL transport (`feedback_no_mock_store_tests`).
- **happy-dom test scoping** — picker DOM-shape tests fine in happy-dom; CONTROL roundtrip + sqlite are Rust-side `cargo nextest` (`feedback_no_happy_dom_tests`).
- **No plan numbers in code** — never write `step-N` / `4.5` / `D01` into TS/Rust/comments (`feedback_no_plan_numbers_in_code`).
- **Cross-check tuglaws** before tugdeck/tugways work (`feedback_tuglaws_cross_check`).

#### Assumptions {#assumptions}

- Sqlite under `~/Library/Application Support/Tug/sessions.db` (macOS) and `$XDG_DATA_HOME/tugcast/sessions.db` (Linux) is acceptable storage. (Already established by tugbank's own sqlite location pattern.)
- `rusqlite`'s WAL mode + busy_timeout configuration is sufficient for the supervisor's write cadence (one write per `session_init` / `turn_complete` / `resume_failed` / close).
- Picker render is fast enough to absorb a CONTROL roundtrip on mount instead of synchronous tugbank reads. (Picker is opened only when a card has no binding; the user is making a deliberate choice. ~10–50ms latency is invisible.)
- The `session_updated` push is RPS-safe. Worst case: 4 cards × 1 `turn_complete` per second per card = 4 broadcasts/sec, sent to whatever pickers are open (almost always zero, since pickers are open only at card-mount time).
- Trash directory `<workspace>/.tug-trash/` does not collide with anything claude writes inside `~/.claude/projects/<workspace>/`. (Verified by inspecting claude's own write patterns: only `<sessionId>.jsonl` files at the workspace root; no nested directories.)

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows [tuglaws/tugplan-skeleton.md §reference-conventions](../tuglaws/tugplan-skeleton.md#reference-conventions). Step anchors are kebab-case `step-N`. Decisions use `dNN-...`, open questions `qNN-...`, risks `rNN-...`. References cite IDs and `#anchors`, never line numbers.

---

### Open Questions {#open-questions}

#### [Q01] `resume_failed` row retention (DECIDED) {#q01-failed-row-retention}

**Question:** When `resume_failed` fires, does the supervisor remove the ledger row (current behavior) or set `state="failed"` and retain it as a diagnostic crumb (the sketch's preference)?

**Resolution:** DECIDED — retain as `state="failed"`. Picker renders a greyed row with a diagnostic ("Couldn't resume — JSONL missing"). Per-row Forget is the only deletion path. See [D03] for rationale and the migration impact.

---

#### [Q02] `session_updated` broadcast mechanism (DECIDED) {#q02-session-updated-mechanism}

**Question:** How do pickers receive live ledger updates — a new tugcast→client CONTROL push, or piggyback on tugbank `domain-changed` notifications somehow?

**Resolution:** DECIDED — new tugcast→client CONTROL push frame, delivered on the same per-connection CONTROL feed that already carries `spawn_session_ok`, `resume_failed`, and other server-originated CONTROL messages. The frame's `action` is `"session_updated"`; the payload carries `{ session_id, fields, removed? }`. Tugcast emits the broadcast to *all* connected CONTROL feeds (the ledger is global, not per-card); each client filters in `action-dispatch.ts` and routes the payload into the local ledger store. Pickers don't subscribe explicitly — being mounted is the subscription, since the store is the receiver. Tugbank doesn't back the ledger anymore, so its `domain-changed` channel doesn't naturally cover ledger writes.

---

#### [Q03] Trash JSONL location (DECIDED) {#q03-trash-location}

**Question:** When Forget moves a JSONL out of `~/.claude/projects/<workspace>/`, where does it land?

**Resolution:** DECIDED — `~/.claude/projects/<workspace>/.tug-trash/<deletedAt>/<sessionId>.jsonl`. In-place under the workspace's claude directory, hidden via the leading dot. Restore is `mv` back. Avoids the metadata-tracking complexity of a tug-owned trash directory; claude doesn't recursively scan its own project subdirs, so the `.tug-trash/` is invisible to it. Re-evaluate if a future claude version starts walking those subdirs.

---

#### [Q04] `first_user_prompt` truncation length (OPEN) {#q04-prompt-truncation}

**Question:** How many characters of the first user message should the ledger store for the picker snippet?

**Plan to resolve:** Land [Step 1](#step-1) with the sketch's 256-char default. Iterate when the picker is wired in [Step 6](#step-6) and a real picker render shows whether 256 is too long for clean rows.

**Resolution:** OPEN. Starting preference: 256 chars at storage time, with the picker truncating further to ~64 chars for display (so the storage cost doesn't lock us into a short snippet if the picker layout changes).

---

#### [Q05] Schema migration: SQL `migrations` table or one-shot in-code? (OPEN) {#q05-migrations}

**Question:** Does the ledger keep a `migrations` table tracking applied schema versions, or apply `CREATE TABLE IF NOT EXISTS` + `ALTER` statements idempotently from code?

**Plan to resolve:** Resolve in [Step 1](#step-1). The schema is small enough that idempotent in-code DDL is the simpler choice; a `migrations` table earns its keep only when there are multiple historical schemas to track. Reconsider if the schema gains a column post-launch.

**Resolution:** DECIDED — idempotent in-code DDL for v1 (`CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`). A `migrations` table will be introduced on the second schema variant, not preemptively. Step 1 ships this.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Sqlite write contention with the tugcast supervisor's write cadence | low | low | WAL mode + busy_timeout; writes batched per turn_complete | Picker latency spikes during heavy turn-count ticks |
| Picker re-fetch on every `session_updated` floods the wire | low | low | Push frame carries the diff (changed fields), not a full re-fetch trigger | Profile while two cards stream concurrently |
| Forget races with an in-flight `turn_complete` that bumps `last_used_at` | low | med | Forget acquires a row-level lock and sets `state="forgotten"` before file move; turn_complete writes are no-ops on `state != "live"` | Audit fires |
| Recents↔ledger coherence diverges (recents removed, ledger row stays) | med | med | Recents eviction calls `forget_workspace_sessions` in the same code path | Manual smoke after recents cap is hit |
| User notices missing sessions in picker after first post-update launch | low | high | Documented in [D09]; backfill is a follow-on if it bites | Anyone notices |
| `state="failed"` rows accumulate without bound | low | med | Same age-based eviction (90 days) applies to `state="failed"`, not just `closed` | Picker shows > 5 failed rows in a workspace |

**Risk R01: Schema-evolution debt.** {#r01-schema-debt}

- **Risk:** v1 schema lacks fields a future picker iteration wants (e.g., assistant-bytes for storage pressure, last-error reason for resume failures).
- **Mitigation:** Plan for one schema change post-launch by adding a `migrations` table on the *second* DDL, not preemptively. Adding columns to sqlite is a one-line `ALTER TABLE`.
- **Residual risk:** The picker may want a column we didn't anticipate. Adding it is cheap.

**Risk R02: Picker emptiness on first run after update.** {#r02-empty-on-update}

- **Risk:** Existing sessions disappear from the picker's resume list when the ledger replaces the tugbank `sessions` map (the ledger starts empty by design).
- **Mitigation:** Documented in [D09]. The underlying JSONLs are untouched; sessions can be resumed by id via direct CLI in the unlikely event someone needs one. Backfill from `~/.claude/projects/` is a follow-on if anyone notices.
- **Residual risk:** "Where did my sessions go?" reaction on the first post-update launch. Acceptable for a single-user dev environment.

---

### Design Decisions {#design-decisions}

#### [D01] Sqlite-backed ledger inside tugcast (DECIDED) {#d01-sqlite-ledger}

**Decision:** The session ledger is a sqlite database file owned by the tugcast process. Schema in [#schema]. Storage location: `~/Library/Application Support/Tug/sessions.db` (macOS), `$XDG_DATA_HOME/tugcast/sessions.db` (Linux).

**Rationale:** Row-level queries with `ORDER BY last_used_at DESC`, atomic eviction, indexed lookup by `workspace_key` are exactly what sqlite is for. JSONL-per-workspace was considered: O(N) reads, no index, harder eviction, file lock contention. Sqlite already ships with `rusqlite` (workspace dep), so the only marginal cost is the schema migration — small.

**Implications:**
- Tugcast owns the DB lock. No multi-process write contention by design.
- Picker reads via CONTROL, never directly via sqlite — keeps the client / server separation clean.
- WAL mode + busy_timeout for safety; sane defaults.

---

#### [D02] CONTROL ops, not tugbank watches, for picker reads (DECIDED) {#d02-control-ops}

**Decision:** The picker reads ledger data via CONTROL `list_sessions { workspace_key }` and subscribes to `session_updated` push frames while open. Tugbank does not back the ledger's persistence and does not surface its updates.

**Rationale:** The previous architecture (sessions in tugbank, picker reads via `useTugbankValue`) was viable when "sessions" was a small map; it doesn't scale to per-row queries with metadata, and the existing `domain-changed` mechanism was never meant for high-cadence state. CONTROL ops give the picker explicit shape and let the wire carry what's actually relevant per request.

**Implications:**
- New CONTROL actions: `list_sessions`, `forget_session`, `forget_workspace_sessions`, plus the `session_updated` broadcast.
- Picker render becomes async (request → response). Acceptable: the picker is opened only on card mount.
- Pickers subscribe implicitly while mounted; tugcast doesn't track subscribers manually beyond the existing per-connection feed-set machinery.

---

#### [D03] `resume_failed` retains the row as `state="failed"` (DECIDED) {#d03-failed-retention}

**Decision:** The supervisor stops calling `sessions_recorder.remove(stale)` on `resume_failed`. The `LedgerSessionsRecorder` instead transitions the row to `state="failed"`. The picker renders failed rows greyed with a one-line diagnostic. Per-row Forget is the only deletion path.

**Rationale:** Removing the row makes the resume failure invisible at picker time — the user has no breadcrumb that the session existed. Retention preserves the user's mental model (the conversation was real; resume just couldn't reach it) and gives them an explicit Forget action to use intentionally. The `state="failed"` rows are bounded by the same eviction policy, so they don't accumulate without limit.

**Implications:**
- Behavior change from current production. Manual smoke: simulate a `resume_failed` (rename a JSONL aside), open a card, observe the failed row.
- The `live-elsewhere` rejection in §step-4-5-5 still removes the live-from-other-card *concern* via the `card_id_live` field; that is independent of `state="failed"`.

---

#### [D04] Eviction policies (DECIDED) {#d04-eviction}

**Decision:** Two eviction policies, both with named constants:

- **Cap per workspace** — `TIDE_LEDGER_MAX_PER_WORKSPACE = 20`. On `session_init`, if the workspace has ≥ 20 rows, evict the oldest `state="closed"` (or `state="failed"`) by `last_used_at`. `state="live"` rows are never evicted.
- **Age-based expiry** — `TIDE_LEDGER_MAX_AGE = 90 days`. On tugcast startup, sweep all rows where `last_used_at < now - 90d AND state != "live"`.

Recents↔ledger coherence: when a recent-projects entry is evicted ([§step-4m-of-T3.4.c](./archive/tugplan-tide-card.md#step-4m)), call `forget_workspace_sessions(workspace_key)` in the same transaction.

**Rationale:** Without eviction the ledger grows unbounded over months of use. The 20/90-day defaults match the typical "I might come back to this" window most users would recognize. Constants over magic numbers — easy to revise, easy to read.

**Implications:**
- Eviction may surprise the user if a session they cared about ages out. Mitigation: 90 days is generous.
- Live rows never evicted: a card pinned open for 91 days keeps its session alive in the ledger.
- Recents-to-ledger coupling is one-way: recents eviction → ledger eviction. The reverse (ledger eviction → recents removal) is *not* automatic; a workspace with no remembered sessions can still be a recent.

---

#### [D05] Forget moves JSONL to in-place trash (DECIDED) {#d05-trash-strategy}

**Decision:** Per-row Forget (and per-workspace Forget All) does not `unlink` the JSONL. It moves the file to `~/.claude/projects/<workspace>/.tug-trash/<deletedAt>/<sessionId>.jsonl` and deletes the ledger row. Startup sweep removes any trash subdir whose `<deletedAt>` is more than 7 days old.

**Rationale:** Forget is destructive and user-visible; making it instantly recoverable for a week is a small cost. In-place trash (under the workspace) keeps relative paths stable for restore — `mv` back to parent. Trash at the tug data dir would require recording original-path metadata; no benefit here. claude itself only opens its own `<sessionId>.jsonl` files by absolute path; it does not scan workspace subdirs, so `.tug-trash/` is invisible to it.

**Implications:**
- Restore tooling can be added later; the data is preserved.
- Sweep is on tugcast startup, not background. Simpler; low-frequency operation.
- A user who deletes `.tug-trash/` manually recovers nothing — same cost as `rm -rf` in any system. Acceptable.

---

#### [D06] Picker stays a list, not a table (DECIDED) {#d06-picker-list}

**Decision:** The picker is a `<div role="radiogroup">` with rich rows, not a `<table>`. Each row is a `<button role="radio">` carrying:

- The first user-prompt snippet (or "No prompts yet" for an empty session)
- A relative timestamp ("2h ago")
- Turn count
- A state indicator (live / failed)
- A trailing Forget action

**Rationale:** Token-driven rich rows are a known shape in the design system. A purpose-built table primitive doesn't exist and isn't worth detouring for at the row counts we expect (tens, not hundreds). If a table primitive lands upstream later, reshape; otherwise stick.

**Implications:**
- No new tugways component — the picker reuses existing primitives + per-row CSS.
- Keyboard model: arrow keys move radio selection, Enter submits, Backspace triggers Forget (with confirmation sheet).

---

#### [D07] Tugcast resolves the session id pre-spawn (DECIDED — unchanged) {#d07-cli-flag-resolution}

**Decision:** Tugcast continues to resolve the session id (via the ledger now, instead of tugbank) *before* spawning tugcode and passes it as `--session-id <id>` (new) or `--resume <id>` (resume). tugcode does not call back to the ledger over CONTROL.

**Rationale:** Tugcode stays stateless w.r.t. session bookkeeping. The pre-spawn resolution path is already in place from §step-4-5-5; this plan replaces the *source* of the id (ledger instead of tugbank) without changing the *delivery* (CLI flag).

**Implications:**
- No tugcode change for this plan beyond what § step-4-5-5 already shipped.
- Tugcast's `agent_supervisor.do_spawn_session` calls `ledger.find_for_resume(workspace_key)` instead of reading the tugbank `sessions` map. Same function shape.

---

#### [D08] Dual-id model (`tug_session_id` + `claude_session_id`) preserved (DECIDED — unchanged) {#d08-dual-id}

**Decision:** The two-identifier model from §step-4-5-5 stays. The ledger keys on `claude_session_id` (the wire id, also claude's own id, also the JSONL filename). `tug_session_id` continues to serve as the routing key during the spawn-handshake window.

**Rationale:** Collapsing the two ids would require a separate refactor of the per-card binding store and the routing path. Out of scope for this plan; the dual model is stable.

**Implications:**
- The ledger's `session_id` column refers to `claude_session_id`.
- `card_id_live` lets the live-elsewhere check use the binding store's `card_id` rather than the dual id complexity.

---

#### [D09] No data migration from tugbank — ledger starts empty (DECIDED) {#d09-no-migration}

**Decision:** The ledger sqlite file is created empty on first run. No code reads the old `dev.tugtool.tide / sessions` map or the `live-sessions` set; no rows are seeded from prior storage. The old tugbank keys go quiet (no writes after [Step 2](#step-2)) and rot in place. Any backfill from on-disk JSONLs in `~/.claude/projects/<workspace>/` is a separate, optional follow-on plan.

**Rationale:** A single-user dev environment doesn't justify the ceremony of migration code, transactional safety, idempotency proofs, and the associated test surface. The JSONL files are the actual source of truth — the tugbank map was always just an index. Skipping migration trades "picker resume list is empty for one launch" against "a hundred lines of code we'd otherwise have to write, test, and maintain forever." The trade is right for the situation.

**Implications:**
- First post-update launch: the picker resume list is empty for any workspace where the user previously had sessions. Existing JSONLs are untouched; sessions can be resumed via direct `--resume` CLI if anyone needs them.
- No `migration.rs` file. No migration tests. No idempotent-rerun gymnastics.
- The old tugbank keys can be cleaned up manually via `tugbank-cli` whenever — not a blocker.
- If picker emptiness becomes user-visible friction (it won't for a single-user dev environment, but might for a public release later), a follow-on plan can introduce a `backfill_from_jsonl` helper that scans `~/.claude/projects/<workspace>/`, reads filenames + mtimes, and synthesizes ledger rows. That work is far simpler than tugbank migration would have been.

---

### Specification {#specification}

#### Schema {#schema}

```sql
CREATE TABLE IF NOT EXISTS sessions (
  session_id        TEXT PRIMARY KEY,    -- claude_session_id; matches the on-disk JSONL filename
  workspace_key     TEXT NOT NULL,       -- canonical workspace key from tugcast
  project_dir       TEXT NOT NULL,       -- raw user path for display
  created_at        INTEGER NOT NULL,    -- unix millis
  last_used_at      INTEGER NOT NULL,    -- unix millis; updated on every turn_complete
  turn_count        INTEGER NOT NULL DEFAULT 0,
  first_user_prompt TEXT,                -- first user message body, truncated to 256 chars
  state             TEXT NOT NULL,       -- "live" | "closed" | "failed"
  card_id_live      TEXT                 -- non-NULL only while state = "live"
);

CREATE INDEX IF NOT EXISTS sessions_workspace_recent
  ON sessions(workspace_key, last_used_at DESC);
```

State values are exhaustive. Transitions:

- `INSERT … state="live", card_id_live=<card_id>` on `spawn_session_ok`.
- `UPDATE state="closed", card_id_live=NULL` on `close_session` / tugcode exit.
- `UPDATE state="failed", card_id_live=NULL` on `resume_failed` (replaces today's row removal).
- Eviction (`DELETE`) on cap or age. Forget (`DELETE` + JSONL move) on user request.

#### CONTROL ops {#control-ops}

Three new CONTROL request actions and one push:

- **`list_sessions { workspace_key }` →** `{ sessions: [SessionRow, ...] }` ordered by `last_used_at DESC`. Picker calls on mount and on path change. Empty array if no rows.
- **`forget_session { session_id }` →** `{ ok: true }` or `{ error: { reason } }`. Deletes the row; moves the JSONL to trash; broadcasts a `session_updated` push with `removed=true`. Refuses if `state="live"` (must close the card first).
- **`forget_workspace_sessions { workspace_key }` →** `{ ok: true, count }` or `{ error: { reason } }`. Batch Forget for all non-live rows in the workspace. Single transaction.
- **`session_updated { session_id, fields: Partial<SessionRow>, removed?: boolean }` →** *push frame, no request*. Delivered on the per-connection CONTROL feed (same channel as `spawn_session_ok` and `resume_failed`). Tugcast broadcasts on every ledger write — including evictions ([#step-7]) — to *all* connected CONTROL feeds. Clients route the payload through `action-dispatch.ts` into the local `TideSessionLedgerStore`; pickers consuming the store update in place. Pickers don't subscribe explicitly — being mounted is the subscription.

`SessionRow` shape on the wire:

```ts
interface SessionRow {
  session_id: string;
  workspace_key: string;
  project_dir: string;
  created_at: number;
  last_used_at: number;
  turn_count: number;
  first_user_prompt: string | null;
  state: "live" | "closed" | "failed";
  card_id_live: string | null;
}
```

#### Picker UX {#picker-ux}

The picker form layout (top-down):

1. **Path input** (unchanged from current).
2. **Recents quick-pick row** (unchanged from §step-4m-of-T3.4.c — clicking fills input).
3. **Session list**, rendered when the typed path matches a workspace with one or more rows:
   - **"Start fresh"** row, always first, selected by default.
   - **N "Resume session" rows**, ordered by `last_used_at DESC`. Each row shows:
     - Snippet: `first_user_prompt` truncated to ~64 chars in the row, with full text in a tooltip / aria-label. "No prompts yet" italicized for null.
     - Relative timestamp: "just now", "2h ago", "yesterday", "3d ago", "Mar 12".
     - Turn count: "5 turns" for `turn_count > 0`, blank for 0.
     - State indicator: small tinted pill — "live", "failed". Closed is the unstyled default (no pill).
     - Trailing Forget button (icon-only, `aria-label="Forget session"`). Disabled when `state="live"` and `card_id_live != this.cardId`.
4. **Footer "Forget all sessions for this workspace" button**, rendered when there are any non-live rows.
5. **Open button** (unchanged).

Greyed states:

- `state="live" && card_id_live != this.cardId` — row greyed, click rejected with subtitle "Live in another card".
- `state="failed"` — row greyed, subtitle "Couldn't resume — JSONL missing".

Live updates: while the picker is mounted, `session_updated` push frames update rows in place (no flash, no re-mount). Specifically: turn count tick, `last_used_at` re-sort, state transition.

Loading state: the first `getSnapshot(workspace)` call after the workspace path is typed (or selected from recents) returns `{ status: "pending", rows: [] }`. The picker renders a subdued "…" placeholder under the path input — *not* an empty list of rows, which would falsely advertise "no sessions to resume." The placeholder reads as "checking…" in the order of ~10–50ms. Connection-restore re-fetch (per [Step 4](#step-4)'s `invalidateAll`) puts the picker back through the same flow.

Keyboard: arrow keys navigate rows (Start fresh + N resume rows); Enter submits; Backspace on a row triggers Forget *with confirmation sheet* — a separate `<TugSheet>` modal asks "Forget session — this is destructive but recoverable for 7 days. Continue?" with cancel + confirm.

#### Public API {#public-api}

Tugdeck side:

```ts
// Cache-miss / loading status for a workspace's session list. Distinguishes
// "really empty" (no sessions ever) from "request in flight" (don't render
// the empty state yet; show a spinner / placeholder).
export type WorkspaceLoadStatus = "idle" | "pending" | "ready" | "error";

export interface WorkspaceSnapshot {
  status: WorkspaceLoadStatus;
  rows: readonly SessionRow[];  // empty array while status === "pending" or "error"
  error?: { reason: string };
}

// New store backing the picker's session list view.
export interface TideSessionLedgerStore {
  // Subscribe + getSnapshot per useSyncExternalStore.
  subscribe(listener: () => void): () => void;
  // Returns the cached snapshot for the workspace. The first call for a
  // workspace key triggers a CONTROL list_sessions request and returns
  // { status: "pending", rows: [] }; the response settles the snapshot to
  // { status: "ready", rows: [...] }. Subsequent calls return the cached
  // snapshot; session_updated pushes update it in place.
  getSnapshot(workspaceKey: string): WorkspaceSnapshot;
  // Imperative actions; return a Promise that resolves when the CONTROL ack is received.
  forgetSession(sessionId: string): Promise<{ ok: true } | { error: { reason: string } }>;
  forgetWorkspaceSessions(
    workspaceKey: string,
  ): Promise<{ ok: true; count: number } | { error: { reason: string } }>;
  // Invalidate every cached workspace and refetch. Called on transport_settled
  // (per Step 7.5's transport-state lifecycle) so a connection bounce doesn't
  // leave the cache stale with missed session_updated pushes.
  invalidateAll(): void;
}
```

Tugcast side:

```rust
pub struct SessionLedger {
    db: Arc<Mutex<rusqlite::Connection>>,
}

impl SessionLedger {
    pub fn open(path: &Path) -> Result<Self, LedgerError>;

    pub fn list_for_workspace(
        &self,
        workspace_key: &str,
    ) -> Result<Vec<SessionRow>, LedgerError>;

    pub fn find_for_resume(
        &self,
        workspace_key: &str,
    ) -> Result<Option<SessionRow>, LedgerError>;

    pub fn record_spawn(
        &self,
        session_id: &str,
        workspace_key: &str,
        project_dir: &str,
        card_id: &str,
        now: i64,
    ) -> Result<(), LedgerError>;

    pub fn record_first_prompt(
        &self,
        session_id: &str,
        prompt: &str,  // truncated by caller
    ) -> Result<(), LedgerError>;

    pub fn record_turn(&self, session_id: &str, now: i64) -> Result<(), LedgerError>;

    pub fn mark_closed(&self, session_id: &str) -> Result<(), LedgerError>;
    pub fn mark_failed(&self, session_id: &str) -> Result<(), LedgerError>;

    pub fn forget(&self, session_id: &str) -> Result<ForgetOutcome, LedgerError>;
    pub fn forget_workspace(
        &self,
        workspace_key: &str,
    ) -> Result<ForgetWorkspaceOutcome, LedgerError>;

    pub fn evict_oldest_closed(
        &self,
        workspace_key: &str,
        cap: usize,
    ) -> Result<usize, LedgerError>;
    pub fn sweep_expired(&self, max_age_ms: i64, now: i64) -> Result<usize, LedgerError>;
}
```

#### Bootstrap (no migration) {#bootstrap}

On tugcast startup the ledger initializer runs `CREATE TABLE IF NOT EXISTS sessions(...)` plus `CREATE INDEX IF NOT EXISTS sessions_workspace_recent` against the sqlite file at the data-dir path. That's the entire startup ceremony — no read of the old tugbank `sessions` / `live-sessions` keys, no row synthesis, no transactional handoff. Per [D09].

The old tugbank keys are no longer written to (the bridge wires them out in [Step 2](#step-2)); they remain in-place until removed manually if anyone bothers.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|-|-|
| `tugrust/crates/tugcast/src/session_ledger.rs` | Ledger crate — schema, CRUD, eviction, sweep |
| `tugrust/crates/tugcast/tests/session_ledger.rs` | nextest unit suite |
| `tugdeck/src/lib/tide-session-ledger-store.ts` | Tugdeck client store |
| `tugdeck/src/lib/__tests__/tide-session-ledger-store.test.ts` | Store tests |
| `tugdeck/src/components/tugways/cards/__tests__/tide-card-session-picker.test.tsx` | Picker rich-rows tests |

#### Modified files {#modified-files}

| File | Change |
|-|-|
| `tugrust/crates/tugcast/src/feeds/agent_supervisor.rs` | Drop `TugbankSessionsRecorder` / `TugbankLiveSessionsTracker` impls; introduce `LedgerSessionsRecorder` |
| `tugrust/crates/tugcast/src/feeds/agent_bridge.rs` | Bridge calls swap from `recorder.remove(stale)` to `recorder.mark_failed(stale)` for `resume_failed` |
| `tugrust/crates/tugcast/src/main.rs` | Open the ledger on startup |
| `tugrust/crates/tugcast/src/router.rs` | Route the new CONTROL actions to handlers |
| `tugrust/crates/tugcast/src/actions.rs` | Add `ListSessions`, `ForgetSession`, `ForgetWorkspaceSessions`, `SessionUpdated` action enums |
| `tugdeck/src/protocol.ts` | `encodeListSessions`, `encodeForgetSession`, `encodeForgetWorkspaceSessions`, `decodeSessionUpdated` |
| `tugdeck/src/action-dispatch.ts` | Dispatch `session_updated` into the new ledger store |
| `tugdeck/src/components/tugways/cards/tide-card.tsx` | Picker rewires; rich rows; Forget actions |
| `tugdeck/src/components/tugways/cards/tide-card.css` | Row styles, state pill, Forget button, confirmation sheet |
| `tugdeck/src/lib/code-session-store/reducer.ts` | (no change expected; flag for verification) |

#### Symbols {#symbols}

| Symbol | Kind | Location | Notes |
|-|-|-|-|
| `SessionLedger` | struct | `session_ledger.rs` | Public API surface above |
| `SessionRow` | struct | `session_ledger.rs` | Wire-shape mirror in tugdeck `protocol.ts` |
| `LedgerError` | enum | `session_ledger.rs` | sqlite + IO errors |
| `ForgetOutcome` | struct | `session_ledger.rs` | `{ jsonl_moved_to: PathBuf }` |
| `LedgerSessionsRecorder` | struct | `agent_supervisor.rs` | Implements existing `SessionsRecorder` trait against the ledger |
| `TIDE_LEDGER_MAX_PER_WORKSPACE` | const | `session_ledger.rs` | 20 |
| `TIDE_LEDGER_MAX_AGE_DAYS` | const | `session_ledger.rs` | 90 |
| `TIDE_TRASH_SWEEP_AGE_DAYS` | const | `session_ledger.rs` | 7 |
| `TideSessionLedgerStore` | class | `tide-session-ledger-store.ts` | Public API surface above |
| `useSessionLedger(workspaceKey)` | hook | `tide-session-ledger-store.ts` | `useSyncExternalStore` wrapper |
| `encodeListSessions` etc. | functions | `protocol.ts` | Encoders for the new CONTROL ops |

---

### Documentation Plan {#documentation-plan}

- [ ] Module docstring on `session_ledger.rs` per the schema and state-machine in [#schema].
- [ ] Module docstring on `tide-session-ledger-store.ts` describing the cache + push-update model.
- [ ] Update `tide.md` § code-session-store to point at the new ledger (replacing the tugbank `sessions` map references).
- [ ] Add a brief paragraph to `tuglaws/component-authoring.md` on "stores that observe CONTROL push frames" — the ledger store is the second consumer (after the live-sessions broadcast handling that §step-4-5-5 introduced).

---

### Test Plan Concepts {#test-plan-concepts}

| Category | Purpose | When |
|-|-|-|
| Rust unit (`cargo nextest`) | `SessionLedger` CRUD, eviction, sweep — against an in-memory sqlite DB | [Step 1](#step-1) |
| Rust integration (`cargo nextest`) | Bridge / supervisor wiring — record_spawn → record_first_prompt → record_turn → mark_closed flow; resume-failed retains row | [Step 2](#step-2) |
| Protocol encoders + handlers | CONTROL request/response shape against a fake transport | [Step 3](#step-3) |
| Tugdeck unit | `TideSessionLedgerStore` cache + push-update mechanics | [Step 4](#step-4) |
| Tugdeck integration (happy-dom) | Picker render with N rows, click Forget, confirmation sheet, Forget All footer | [Step 6](#step-6) |
| Eviction + trash integration (`cargo nextest`) | Cap / age eviction; recents coherence; trash move-on-Forget; startup sweep | [Step 7](#step-7), [Step 8](#step-8) |
| Chain-shape tests (extends `R-CHAIN-*` from §step-4-5-5) | Live-elsewhere uses ledger `card_id_live`; eviction during heavy use | [Step 7](#step-7) |
| End-to-end smoke (manual) | Open card; spawn; submit; close; reopen; pick from N rows; Forget; restore from trash | [Step 9](#step-9) |

---

### Tuglaws Cross-Check {#tuglaws-cross-check}

- **L02** — `TideSessionLedgerStore` exposes `subscribe` / `getSnapshot` and is consumed via `useSyncExternalStore`. CONTROL push frames update the store's internal cache; the snapshot is stable across no-op ticks.
- **L03** — n/a (no DOM lifecycle dependencies in the store).
- **L06** — picker row appearance flows through CSS + `[data-state]` attributes; no React state for greyed/active styling.
- **L07** — `handleForget` reads the store via ref; no stale closures over the session id.
- **L11** — Forget button dispatches `forget_session` action through the responder chain so the confirmation sheet's affirm consumes the correct row.
- **L19** — picker remains a function-of-store; new helper modules under `lib/`.
- **L23** — session metadata survives reconnect via the on-disk ledger; in-flight pickers re-fetch on reconnect (`session_updated` push doesn't reach a closed connection).

---

### Execution Steps {#execution-steps}

> Each step is its own commit. `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run` pass at the end of every step.

#### Step 1: Ledger crate + schema {#step-1}

**Commit:** `tide(ledger): SessionLedger crate (sqlite-backed)`

**References:** [D01] sqlite-ledger, [D04] eviction, [D09] no-migration, [#schema], [#bootstrap], [Q05] migrations strategy

**Artifacts:**
- New `tugrust/crates/tugcast/src/session_ledger.rs` exporting `SessionLedger`, `SessionRow`, `LedgerError`, `ForgetOutcome`, `ForgetWorkspaceOutcome`, `SessionState`, plus the `TIDE_LEDGER_*` and `FIRST_USER_PROMPT_MAX_CHARS` constants.
- Inline `#[cfg(test)] mod tests` covering CRUD + eviction + sweep + idempotent open + helpers. (Tugcast is a binary crate without a `lib.rs`, so an integration test file at `tests/session_ledger.rs` cannot import the module; the inline pattern matches the rest of the crate — `actions.rs`, `router.rs`, `agent_supervisor.rs`.)
- `rusqlite` promoted from dev-dep to runtime dep on tugcast.

**Tasks:**
- [x] Author the schema and state machine per [#schema]. Use `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` (resolves [Q05] in favor of in-code DDL for v1).
- [x] Implement the public API surface from [#public-api]. Each method is a single transaction.
- [x] Configure WAL mode + `busy_timeout` on connection open.
- [x] Author Rust tests:
  - CRUD round-trip per state transition.
  - Eviction: insert 21 rows, verify oldest closed evicted on the 21st.
  - Sweep: insert a row with `last_used_at` = 91 days ago, verify swept on `sweep_expired`.
  - Idempotent open: open the same ledger file twice, verify the second open is a no-op (no DDL re-run failures).

**Tests:**
- [x] `cargo nextest run -p tugcast session_ledger` green (26 tests).

**Checkpoint:**
- [x] `cargo nextest run` (workspace-wide; new tests + no regressions — 1175 passed)
- [x] `cargo build` (no warnings)

---

#### Step 2: Wire the bridge to write the ledger {#step-2}

**Depends on:** #step-1

**Commit:** `tide(ledger): replace TugbankSessionsRecorder with LedgerSessionsRecorder`

**References:** [D01] sqlite-ledger, [D03] failed-retention, [D08] dual-id-preserved, (#scope)

**Artifacts:**
- `SessionRecord<'_>` struct + redesigned `SessionsRecorder` trait (`record`, `record_turn`, `mark_closed`, `mark_failed`, `remove` — no default impls).
- `LedgerSessionsRecorder` struct in `agent_supervisor.rs` backed by `Arc<SessionLedger>`.
- `TugbankSessionsRecorder`, `TugbankLiveSessionsTracker`, and the `LiveSessionsTracker` trait removed entirely. The live broadcast that those owned now lives in the ledger row's `state="live"` + `card_id_live` columns.
- `tugrust/crates/tugcast/src/main.rs` opens the ledger via `SessionLedger::open(SessionLedger::default_path())` on startup, runs `demote_live_to_closed()` (the new equivalent of the old `LiveSessionsTracker.clear()`), and constructs `LedgerSessionsRecorder`.
- `agent_bridge.rs` swap: `sessions_recorder.remove(stale)` → `sessions_recorder.mark_failed(stale)` for `resume_failed`. New: bridge detects `{"type":"result"}` lines and calls `record_turn`. New: bridge captures `workspace_key` + `card_id` from the entry under the `session_init` lock so the recorder gets the full `SessionRecord<'_>`.
- `do_close_session` snapshots `claude_session_id` under the entry lock (alongside `workspace_key`) and dispatches `mark_closed` after Phase 5's wire publish.
- New `demote_live_to_closed()` method on `SessionLedger`.

**Tasks:**
- [x] Extend `SessionsRecorder` trait with `record_turn`, `mark_closed`, `mark_failed` — **no default impls**. Every implementor must provide them explicitly. (A default forwarding to `remove` would silently preserve the exact behavior this plan replaces; the compile error from a missing impl is the regression-protection.)
- [x] Author `LedgerSessionsRecorder` implementing all five trait methods. Each dispatches to the right `SessionLedger` API.
- [x] Update `main.rs` to open the ledger (`SessionLedger::open(...)`), call `demote_live_to_closed()`, construct the new recorder, hand it to the supervisor. No migration step.
- [x] Drop `TugbankLiveSessionsTracker` (and the `LiveSessionsTracker` trait) — its responsibility (live-set broadcasting) is now a function of `state="live"` queries against the ledger.
- [x] Update the bridge call site for `resume_failed` to use `mark_failed`. Wire `record_turn` to `{"type":"result"}` lines. Wire `mark_closed`/`mark_failed` to the bridge's terminal teardown paths (close, crash exhaustion).
- [x] Update test stubs (`NoopSessionsRecorder` to new shape; drop `NoopLiveSessionsTracker`).

**Tests:**
- [x] Existing `agent_bridge` / `agent_supervisor` tests pass against the new recorder (482 tugcast tests green; 1183 workspace-wide).
- [x] New unit tests covering `LedgerSessionsRecorder` lifecycle: `record` inserts a live row; `record → record_turn × 3 → mark_closed` reflects each transition; `mark_failed` retains the row as failed; `remove` deletes; `record_turn` no-ops on a closed row.
- [x] New integration test: `do_close_session` calls `mark_closed` on the ledger when the entry has a `claude_session_id`.

**Checkpoint:**
- [x] `cargo nextest run` — 1183 passed
- [x] `cargo build` — no warnings

---

#### Step 3: CONTROL ops + tugcast handlers {#step-3}

**Depends on:** #step-2

**Commit:** `tide(ledger): list_sessions, forget_session, session_updated CONTROL ops`

**References:** [D02] control-ops, [#control-ops], [Q02] session-updated-mechanism

**Artifacts:**
- `actions.rs` adds `ListSessions`, `ForgetSession`, `ForgetWorkspaceSessions` request enums plus `SessionUpdated` push enum.
- `router.rs` routes the new actions to handlers backed by `SessionLedger`.
- `tugdeck/src/protocol.ts` adds encoders for the three requests + a decoder for the push.
- `tugdeck/src/action-dispatch.ts` learns to decode `session_updated` push frames (still no consumer yet — that arrives in [Step 4](#step-4)).

**Tasks:**
- [ ] Define `SessionRow` in `actions.rs` with serde derive. Mirror in `protocol.ts`.
- [ ] Implement the three request handlers in tugcast: each calls the matching `SessionLedger` API, serializes the response, returns. `forget_session` rejects when `state="live" && card_id_live != requesting card`.
- [ ] Implement the broadcast: every `SessionLedger` write that successfully transactions emits a `SessionUpdated` push to all connected clients (the existing per-connection feed mechanism is the delivery path; sessions are global, not per-card-feed).
- [ ] Encoders in `protocol.ts` mirror the existing `encodeSpawnSession` style.
- [ ] `action-dispatch.ts` decode-side identifies `session_updated` and routes it to a new dispatch target (placeholder until [Step 4](#step-4) wires the store).

**Tests:**
- [ ] Rust integration test: send `list_sessions { workspace_key }`, assert response shape against a seeded ledger.
- [ ] Rust integration test: send `forget_session`, assert ledger row removed and a `session_updated { removed: true }` is broadcast.
- [ ] Rust integration test: `forget_session` on a live row returns the right error.
- [ ] Rust integration test: a `record_turn` write produces a `session_updated` push with `fields: { turn_count, last_used_at }`.
- [ ] Tugdeck unit test: encoders produce the documented JSON shape.

**Checkpoint:**
- [ ] `cargo nextest run`
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`

---

#### Step 4: Tugdeck `TideSessionLedgerStore` {#step-4}

**Depends on:** #step-3

**Commit:** `tide(ledger): tugdeck client store with CONTROL push subscription`

**References:** [D02] control-ops, [Q02] session-updated-mechanism, [#public-api], [L02]

**Artifacts:**
- New `tugdeck/src/lib/tide-session-ledger-store.ts` implementing `TideSessionLedgerStore`.
- `useSessionLedger(workspaceKey)` hook wrapping `useSyncExternalStore`.
- `tugdeck/src/action-dispatch.ts` routes `session_updated` push frames into the store.

**Tasks:**
- [ ] Author the store: an in-memory `Map<workspaceKey, WorkspaceSnapshot>` cache. Each entry tracks `status` (`"idle" | "pending" | "ready" | "error"`) alongside `rows`.
- [ ] First-observation flow: when `getSnapshot(workspace)` is called and the cache has no entry, return `{ status: "pending", rows: [] }`, dispatch a `list_sessions` request, and on response settle the entry to `{ status: "ready", rows }`. Subsequent calls return the cached snapshot.
- [ ] Patch logic: when `session_updated { session_id, fields }` arrives, locate the row in the cache by id (across all workspaces), merge fields, re-sort by `last_used_at DESC`, emit the listener tick. Ignore the push if the workspace isn't cached yet.
- [ ] When `session_updated { removed: true }` arrives, drop the row from whichever workspace holds it.
- [ ] Implement `forgetSession` and `forgetWorkspaceSessions` as imperative actions: dispatch the CONTROL request, await the ack, return the result. The cache update arrives via the broadcast.
- [ ] Implement `invalidateAll()`: walk the cache, set every entry's `status` back to `"idle"`, drop rows. The next `getSnapshot` for each workspace re-issues `list_sessions`. Subscribe to the connection's `transport_settled` signal (per Step 7.5's transport-state lifecycle) and call `invalidateAll()` on every settle after the first — this catches any `session_updated` push that landed during a connection bounce.
- [ ] `useSessionLedger(workspaceKey)` hook calls `getSnapshot` via `useSyncExternalStore` and returns the `WorkspaceSnapshot` (status + rows). Picker consumers branch on status.

**Tests:**
- [ ] Unit test: first call returns `pending`; settling on response transitions to `ready`.
- [ ] Unit test: snapshot-stability when no changes (same `rows` array reference until a push lands).
- [ ] Unit test: `session_updated` patch updates the row in place.
- [ ] Unit test: `session_updated { removed: true }` removes the row.
- [ ] Unit test: `session_updated` for a workspace not in the cache is ignored.
- [ ] Unit test: `invalidateAll()` flips ready entries to idle; the next `getSnapshot` re-fetches.
- [ ] Unit test: `forgetSession` resolves with the CONTROL ack shape.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test src/lib/__tests__/tide-session-ledger-store.test.ts`

---

#### Step 5: Picker rewires to the ledger store (with brief loading state) {#step-5}

**Depends on:** #step-4

**Commit:** `tide(ledger): picker reads from ledger store, drops tugbank watches`

**References:** [D02] control-ops, [D08] dual-id-preserved, (#picker-ux)

**Artifacts:**
- `tide-card.tsx` swaps `useTugbankValue("dev.tugtool.tide", "sessions", …)` and `useTugbankValue("dev.tugtool.tide", "live-sessions", …)` for `useSessionLedger(workspaceKey)`.
- `resumeCandidate` derivation uses the ledger snapshot; `candidateLiveElsewhere` reads `state === "live"` + `card_id_live`.
- The shape of the picker stays the same as today (one "Resume last session" row), with one new wrinkle: the snapshot's `status` is `"pending"` on first observation, so the picker shows a brief "…" placeholder under "Resume last session" until the response lands. The richer N-row UX arrives in [Step 6](#step-6).

**Tasks:**
- [ ] Replace the two `useTugbankValue` calls with `useSessionLedger(workspaceKey)`.
- [ ] Branch on snapshot `status`: `"pending"` → render placeholder text under the Resume row (or hide the row entirely for the first ~50ms — pick the less-flashy option in code review). `"ready"` → render the resume row from the snapshot. `"error"` → render the existing notice mechanism.
- [ ] Update `parseAllSessions` and `parseLiveSessions` callers — they're no longer needed; delete.
- [ ] Refactor `resumeCandidate` to pick the most recent row from the ledger snapshot's `rows`.
- [ ] Refactor `candidateLiveElsewhere` to use `card_id_live`.
- [ ] Remove obsolete imports.

**Tests:**
- [ ] Existing picker tests in `tide-card.test.tsx` pass with the ledger-backed snapshot.
- [ ] New test: picker mount with `status === "pending"` renders the placeholder; transition to `"ready"` renders the resume row.
- [ ] New test: a `session_updated` push during picker mount updates the resume row's timestamp without re-mount.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`
- [ ] `bun run audit:tokens lint`

---

#### Step 6: Picker UX — rich rows + Forget {#step-6}

**Depends on:** #step-5

**Commit:** `tide(ledger): rich resume rows with snippets, Forget actions`

**References:** [D03] failed-retention, [D05] trash-strategy, [D06] picker-list, [Q04] prompt-truncation, (#picker-ux)

**Artifacts:**
- `tide-card.tsx` renders N rows per workspace per [#picker-ux] above.
- Per-row Forget button, confirmation `<TugSheet>`.
- Footer Forget All button.
- `tide-card.css` adds row layout, state pills, Forget button hover, sheet content styles.
- Picker tests in `__tests__/tide-card-session-picker.test.tsx`.

**Tasks:**
- [ ] Implement the rich-row renderer using existing primitives (`TugBadge` for state pills, `TugPushButton` for Forget).
- [ ] Implement relative-timestamp helper (existing or new — search the codebase first).
- [ ] Implement the confirmation sheet using `<TugSheet>`.
- [ ] Implement keyboard handling: arrow nav, Enter submit, Backspace + sheet for Forget.
- [ ] Greying logic per [#picker-ux] (live-elsewhere, failed).
- [ ] Footer Forget All with sheet.

**Tests:**
- [ ] Picker test: 3 ledger rows render as 3 resume rows + 1 Start fresh, in `last_used_at DESC` order.
- [ ] Picker test: Forget button opens sheet; affirm dispatches `forget_session`.
- [ ] Picker test: a `session_updated { state: "failed" }` push regreys the affected row in place.
- [ ] Picker test: keyboard nav + Backspace path.
- [ ] Visual review (manual): open the card with seeded ledger data; confirm row spacing, snippet truncation, state-pill colors.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`
- [ ] `bun run audit:tokens lint`
- [ ] Manual visual review.

---

#### Step 7: Eviction + recents↔ledger coherence {#step-7}

**Depends on:** #step-6

**Commit:** `tide(ledger): cap, age-based expiry, recents coherence`

**References:** [D04] eviction, (#scope)

**Artifacts:**
- `agent_supervisor.rs::do_spawn_session` calls `ledger.evict_oldest_closed(workspace_key, TIDE_LEDGER_MAX_PER_WORKSPACE)` after `record_spawn`.
- `main.rs` startup calls `ledger.sweep_expired(TIDE_LEDGER_MAX_AGE_DAYS, now)`.
- The recents eviction path (existing — `dev.tugtool.tide / recent-projects`) calls `forget_workspace_sessions(workspace_key)` when an entry ages out.

**Tasks:**
- [ ] Add the eviction call to the spawn path. It runs after `record_spawn` so the new session is never the eviction target.
- [ ] Add the startup sweep. Run after the ledger is opened but before serving any CONTROL ops.
- [ ] **Eviction broadcasts.** Every evicted row emits `session_updated { session_id, removed: true }` on the CONTROL feed — same path as `forget_session`. Without this, an open picker's cache silently goes stale when a row evicts under it. Both the spawn-path cap eviction and the startup-sweep age eviction must broadcast.
- [ ] Add the recents-eviction → ledger-eviction hook. Locate the existing recents-eviction code (`settings-api.ts`?), call `forgetWorkspaceSessions` when an entry is removed.

**Tests:**
- [ ] Rust integration test: spawn the 21st session in a workspace, assert the oldest closed row is gone.
- [ ] Rust integration test: cap eviction emits a `session_updated { removed: true }` on the CONTROL feed.
- [ ] Rust integration test: startup sweep removes a row whose `last_used_at` is 91 days old.
- [ ] Rust integration test: startup sweep emits a `session_updated { removed: true }` for each evicted row.
- [ ] Rust integration test: `state="live"` rows are never evicted, even when over the cap.
- [ ] Tugdeck integration test: simulate recents eviction, assert `forgetWorkspaceSessions` is called.

**Checkpoint:**
- [ ] `cargo nextest run`
- [ ] `bun test`
- [ ] `bun run audit:tokens lint`

---

#### Step 8: Trash + sweep {#step-8}

**Depends on:** #step-7

**Commit:** `tide(ledger): trash-on-Forget + 7-day sweep`

**References:** [D05] trash-strategy, (#scope)

**Artifacts:**
- `SessionLedger::forget` moves the JSONL to `<workspace>/.tug-trash/<deletedAt>/<sessionId>.jsonl`.
- `main.rs` startup calls a new `sweep_trash(workspace_dirs, max_age_ms)` helper.
- `ForgetOutcome` returns the trash path (used in trace logs; not surfaced to the picker).

**Tasks:**
- [ ] Implement the JSONL move. Atomic rename when source and dest are on the same filesystem (always true for in-place trash). Create the `<deletedAt>` subdir on demand.
- [ ] Implement `sweep_trash` — for each known workspace dir (from the ledger's distinct `workspace_key` set), enumerate `.tug-trash/<deletedAt>/`, delete dirs whose `<deletedAt>` is older than 7 days.
- [ ] Hook startup sweep into `main.rs` after the ledger is opened.
- [ ] Manual: Forget a session, verify the JSONL appears in `.tug-trash/...`. Roll back the system clock and restart, verify sweep removes old entries.

**Tests:**
- [ ] Rust integration test: `forget` moves the JSONL; the file is at the expected trash path.
- [ ] Rust integration test: sweep removes a trash entry > 7 days old.
- [ ] Rust integration test: sweep is a no-op if `.tug-trash/` doesn't exist.

**Checkpoint:**
- [ ] `cargo nextest run`
- [ ] `bun test`
- [ ] Manual: Forget then inspect trash dir.

---

#### Step 9: Tuglaws walkthrough + parent-plan close-out {#step-9}

**Depends on:** #step-8

**Commit:** `tide(ledger): tuglaws walkthrough, close-out`

**References:** [#tuglaws-cross-check], parent §step-10

**Tasks:**
- [ ] Walk every changed file in this plan against [tuglaws.md](../tuglaws/tuglaws.md). Record per-law disposition.
- [ ] Add the "stores that observe CONTROL push frames" paragraph to `tuglaws/component-authoring.md` (per [#documentation-plan]).
- [ ] Update `roadmap/tide.md` § code-session-store to reference the new ledger.
- [ ] Update parent `roadmap/tugplan-tide-card-polish.md`:
  - Plan Status table row for Step 10: `placeholder — promotion still owed` → `**shipped** — see tugplan-tide-session-ledger.md`.
  - Step 10 body: trim the placeholder sketch to a marker pointing to this plan (mirrors how Step 8 closed out via three subordinate plans).

**Tests:**
- [ ] All previous checkpoints still green.
- [ ] Manual end-to-end smoke: full Forget → Restore-from-trash flow; concurrent-card live-elsewhere; resume-failed retains row; eviction triggers correctly when the cap is reached.

**Checkpoint:**
- [ ] `cargo nextest run`
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`
- [ ] `bun run audit:tokens lint`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A tugcast-side sqlite session ledger replacing the tugbank `sessions` map and `live-sessions` set; CONTROL ops + a new client store; rich picker UX with Forget; eviction; recoverable trash. Parent plan §step-10 row flips to "shipped".

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] `SessionLedger` exists with full CRUD + eviction + sweep, schema per [#schema], all unit tests green.
- [ ] Migration completes on a fresh `tugcast` start; old tugbank keys are gone (verified by `tugbank-cli get`).
- [ ] Picker renders rich rows from the ledger store; live updates land via `session_updated`.
- [ ] Per-row Forget moves the JSONL to trash and removes the ledger row; Forget All works for the workspace.
- [ ] Eviction triggers at cap (20) and age (90 days); live rows are never evicted.
- [ ] Recents eviction triggers ledger eviction in the same code path.
- [ ] `resume_failed` retains the row with `state="failed"` and shows it greyed in the picker.
- [ ] All grep gates: no remaining references to `TugbankSessionsRecorder` / `TugbankLiveSessionsTracker` / `dev.tugtool.tide / sessions` / `dev.tugtool.tide / live-sessions` in production code.
- [ ] `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run` green.
- [ ] Parent plan §step-10 row flips to "**shipped** — see tugplan-tide-session-ledger.md".

**Acceptance tests:**
- [ ] All `R-CHAIN-*` chain tests from §step-4-5-5 still green against the ledger-backed flow.
- [ ] New `R-LEDGER-*` integration tests cover: Forget → trash; concurrent card live-elsewhere via ledger `card_id_live`; eviction at cap; eviction at age; recents-eviction → ledger-eviction.
- [ ] Manual end-to-end: spawn 3 sessions in `/u/src/tugtool`, close each, reopen the picker, see 3 rows; Forget the middle one; reopen picker, see 2 rows; restore the JSONL from trash (`mv` back), startup tugcast, picker again shows 3 rows.

#### Roadmap / Follow-ons (Not Required for Phase Close) {#roadmap}

- [ ] Storage-pressure tracking (assistant bytes per session) — schema add + picker affordance. Cheap follow-on if a user complains about disk usage.
- [ ] Restore-from-trash UI in the picker (today's plan: only `mv` recovery). Add an "Recently forgotten" list if real users hit Forget too often.
- [ ] Collapse `tug_session_id` and `claude_session_id`. The ledger keys on `claude_session_id` already; the routing-window concern remains. Follow-up plan if the dual-id model causes friction.
- [ ] A `migrations` table once the schema gains a second variant.
- [ ] A purpose-built table primitive in tugways. Independent component-library work; reshape the picker if and when it lands.

| Checkpoint | Verification |
|-|-|
| Ledger CRUD + migration | `cargo nextest run -p tugcast --test session_ledger` |
| Bridge wiring | `cargo nextest run` (workspace) |
| CONTROL ops | `cargo nextest run` + protocol encoder unit tests |
| Picker UX | `bun test src/components/tugways/cards/__tests__/tide-card-session-picker.test.tsx` |
| Eviction + trash | `cargo nextest run` ledger integration tests |
| End-to-end | Manual smoke per [#exit-criteria] |
