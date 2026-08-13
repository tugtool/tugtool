<!-- devise-skeleton v4 -->

## Dash Integration — Foundation {#dash-foundation}

**Purpose:** Give dashes a durable creation identity, a server-authoritative session↔dash binding, a machine-readable `dash status` readout, and a single shared implementation of dash-entry composition — the Rust/CLI substrate the visible dash UI (Changes lane, Lens section, join mode) stands on. Nothing in this phase renders; the phase ships when the wire and the ledgers carry the new facts.

This is Phase 1 of the program plan [roadmap/dash-integration-plan.md](dash-integration-plan.md). That plan's ratified decisions ([P01] overlay binding, [P02] many-cards-one-dash, [P03] dash creation id, [P06] derive-don't-record) are inherited here and cited as `program-[P##]` — they are settled and not reopened.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main (run as a dash) |
| Last updated | 2026-08-13 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Dashes today have no identity beyond a reusable branch name, no relationship to the sessions that work on them, and no single machine-readable answer to "where is this dash in its lifecycle?". Concretely: dash names are reusable and every artifact keys by name — which is why the `dash-join` skill must remember to `tugutil draft clear` after a land, or the *next* dash of the same name inherits a dead dash's clobber-protected join draft. No code anywhere links a session card to the dash it is working on; ownership is positional (which branch is checked out in the cwd, `tugutil/src/draft.rs::resolve_owner`) and per-commit (the `Tug-Dash` trailer, after the fact). And tugcast's changeset feed derives dash entries with logic explicitly flagged as duplicated from the CLI (`feeds/changeset.rs::dash_entries`: "Duplicated from the tug CLI until the dash core extracts into a shared crate").

This phase fixes the substrate: a **dash id** minted at create ([program-P03]), a **binding column** on the per-instance sessions ledger with CONTROL verbs and CLI verbs to set it ([program-P01], [program-P02]), a **`dash status`** verb, and the **`dash_entries` extraction** into tugdash-core with additive snapshot fields (`id`, `stage`, `bound_sessions`) so Phase 2 can render what this phase records.

#### Strategy {#strategy}

- Identity first: the dash id lands in tugdash-core before anything keys by it.
- Reuse the established compat patterns verbatim: draft rows migrate name→id keys via the same read-primary-then-fallback + supersede-on-write pattern `tugutil/src/draft.rs` already uses for the canonical/legacy path-spelling split; the sessions column lands via the `migrate_sessions_add_*` ALTER-TABLE idiom in `tugcast/src/session_ledger.rs`.
- One writer surface: CLI binding writes go through a new `POST /api/dash` on the running tugcast, mirroring `POST /api/draft` exactly (`tugutil/src/draft.rs::post_draft_api`, server handler `tugcast/src/server.rs::draft_handler`) — a short-lived CLI never opens an instance's `sessions.db` read-write.
- Reads tolerate what writes may miss: a binding whose dash no longer exists reads as unbound; a dash without a `tugid` reads under its legacy branch-ref identity. No hard cuts, no flag days.
- Extraction pays the duplication debt at the moment the duplicated code would otherwise grow (the new fields), per the flag already in `feeds/changeset.rs`.
- Deck changes are plumbing only — types, guards, binding-store fields — so Phase 2 starts with the data already flowing. No rendering.

#### Success Criteria (Measurable) {#success-criteria}

- `tugutil dash create x --json` emits an `id`; a second `create x` (idempotent path) emits the same id. (Rust integration test.)
- `tugutil draft set --owner dash:x` writes a row whose `owner_id` is the id-qualified form; `tugutil dash join x` (fixture repo) uses that draft as its squash message; a pre-existing legacy `tugdash/x` row is still found when no id-keyed row exists. (Rust tests on both sides of the fallback.)
- `bind_dash`/`unbind_dash` CONTROL round-trip: bind → `list_card_bindings_ok` rows carry `dash_id`/`dash_name` → unbind → they are null. (tugcast supervisor test.)
- A join or release through `do_changeset_join`/`do_changeset_release` clears every binding for that dash id. (tugcast test.)
- `tugutil dash status x --json` reports id, stage, base, rounds, worktree dirt, draft presence, and join-journal phase against a fixture repo. (Rust integration test.)
- `compose_snapshot` dash entries carry `id`, `stage`, and `bound_sessions`, and the composition comes from tugdash-core (the `feeds/changeset.rs` duplicate is deleted). (Rust test extending `compose_derives_dash_entries_from_tugdash_refs`.)
- `cargo nextest run`, `bun test`, `bunx vite build`, and `just app-test-changed` all green at phase end.

#### Scope {#scope}

1. Dash creation id: minting, storage, exposure in every dash verb's output ([program-P03], Spec S01).
2. Draft rows for dashes keyed by id, with legacy-name fallback and supersede-on-write (Spec S02).
3. Session↔dash binding: sessions-table column, CONTROL verbs, `POST /api/dash`, CLI verbs, auto-bind on create, eager clear on tugcast join/release, lazy tolerance everywhere (Spec S03, Spec S04).
4. `tugutil dash status` (Spec S05).
5. `dash_entries` extraction into tugdash-core + additive snapshot fields `id`, `stage`, `bound_sessions` (Spec S06).
6. Deck plumbing: wire types + guards, `CardSessionBinding.dash`, spawn-ack/bindings decode. No rendering.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Any visible UI — no Changes lane, no Lens section, no chrome chip, no `/dash` gesture (Phase 2).
- Step tracking (`dash step start|done`) and declared stage markers `built`/`audited` (Phase 3) — this phase's `stage` reports derived values only.
- Join mode, deck senders for `changeset_join`/`changeset_release` (Phase 4).
- Skill renames or skill-text rewrites (Phase 3).
- Cross-instance binding aggregation (see [Q02], deferred).

#### Dependencies / Prerequisites {#dependencies}

- The program plan's ratified decisions ([roadmap/dash-integration-plan.md](dash-integration-plan.md#ratified-decisions)).
- Existing machinery, all shipped: `tugdash-core/src/ops.rs` (create/list/show/join_in/release_in, `dash_base`, `dash_draft_message`, `integrate_message`), `tugutil/src/draft.rs` (`resolve_owner`, `parse_owner`, `post_draft_api`), `tugcast/src/server.rs` (`draft_handler`, loopback route registration), `tugcast/src/session_ledger.rs` (sessions DDL + `migrate_sessions_add_*` idiom), `tugcast/src/feeds/agent_supervisor.rs` (`handle_control`, `do_spawn_session` ack, `do_list_card_bindings`, `clear_dash_draft`, `do_changeset_join`, `do_changeset_release`), `tugcast/src/feeds/changeset.rs` (`compose_snapshot`, `dash_entries`), `tugcast-core/src/types.rs` (`ChangesetEntry::Dash`), `tugdeck/src/lib/changeset-types.ts`, `tugdeck/src/lib/card-session-binding-store.ts`.

#### Constraints {#constraints}

- Rust workspace `-D warnings`; `cargo nextest run` must stay green per step.
- `changes.db` schema is **not** touched — draft-row keying changes only the *values* in `owner_id`, never the DDL, so `CHANGES_SCHEMA_VERSION` stays at its current value. The per-instance `sessions.db` column lands via the tolerant `ALTER TABLE` idiom (no version gate exists or is needed there; see the comment block above the migration list in `session_ledger.rs`).
- Never open live ledger DBs with foreign sqlite3; tests use `TUG_CHANGES_DB` isolation and fixture repos, the established patterns in `tugutil/tests/` and tugcast's test modules.
- tugcast compose paths stay read-only on git: no config writes from `compose_snapshot` (see [P02]).
- Deck: no localStorage; changes must pass `bunx vite build`; wire-type changes are additive with guard updates and fixture updates.

#### Assumptions {#assumptions}

- Dash names cannot be renamed (no rename verb exists), so embedding the name in the id-qualified owner key is stable for a dash's lifetime.
- `sessions.db` is per-instance; a session's binding lives in exactly one instance's ledger, and the CLI can find that instance by trying each discovered port ([D09] discovery, `tugutil/src/commands/tell.rs` helpers).
- One dash per session at a time (a new bind replaces the old); many sessions may bind the same dash ([program-P02]).
- The join journal (`<state-dir>/join-journal-<name>.json`, phases `Integrated|WorktreeRemoved|BranchDeleted`) is readable by tugdash-core for `status`.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows devise-skeleton v4: explicit `{#anchor}` headings, `[P##]` plan-local decisions, `[Q##]` open questions, `Spec S##`, `Risk R##`, `**Depends on:**` step anchors, `**References:**` on every step, no line-number citations. Program-plan decisions are cited as `program-[P##]`; global decisions as `[D##]`.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Dash id format (DECIDED — see [P01]) {#q01-id-format}

**Question:** What string is the dash id, and what is the draft/binding key derived from it?

**Resolution:** DECIDED — see [P01]: `tugid = <unix-millis>-<6 lowercase hex>`, owner key `tugdash/<name>#<tugid>`.

#### [Q02] Cross-instance `bound_sessions` visibility (DEFERRED) {#q02-cross-instance}

**Question:** `compose_snapshot` reads the composing instance's `sessions.db`, so `bound_sessions` lists only *that instance's* bound sessions. Should the field aggregate across instances?

**Why it matters:** With two app instances on one checkout, each deck's Lens would show only its own instance's mated sessions for a shared dash.

**Resolution:** DEFERRED — per-instance visibility is correct for Phase 2's consumers (a deck shows its own cards; `cardIdForSession` only resolves local cards anyway). Revisit if a real cross-instance workflow surfaces; the wire field is a list, so aggregation is additive later.

#### [Q03] How does a CLI bind write reach the owning instance? (DECIDED — see [P04]) {#q03-cli-bind-route}

**Resolution:** DECIDED — `POST /api/dash` on each discovered instance until one accepts, mirroring `/api/draft`'s conduit doctrine with an ownership check. See [P04].

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Legacy dash drafts stranded by the key change | med | med | read-fallback + supersede-on-write ([P03]); test pins both directions | a join lands with the description instead of a written draft |
| Stale bindings after a CLI-side join/release (tugcast not in the loop) | med | med | lazy tolerance on read ([P05]) + best-effort `dash_gone` POST from the CLI | Lens (Phase 2) shows a mated session on a dead dash |
| `ALTER TABLE sessions` collides with older builds sharing the file | low | low | per-instance db is single-build in practice; the `migrate_sessions_add_*` idiom already tolerates duplicate-column errors | migration warnings in logs |
| Extraction changes dash-entry composition behavior | med | low | port the existing `compose_derives_dash_entries_from_tugdash_refs` test unchanged before deleting the duplicate; keep the legacy-worktree fallback | fixture diff in the extraction step |
| `/api/dash` becomes an unauthenticated mutation surface | low | low | loopback-only route registration, exactly like `/api/draft`; ownership check before any write | — |

**Risk R01: id-less dashes (created by older builds) split identity** {#r01-idless-dashes}

- **Risk:** A dash created before this phase has no `tugid`; if read paths invented ids, two processes would mint different ones and drafts would fork.
- **Mitigation:** Only **write-path verbs** mint (`create`'s idempotent revisit, `bind`, `commit` — all funnel through `ensure_dash_id`, [P02]); every read path falls back to the legacy branch-ref identity when no id is on file. Minting is a git-config write in the repo, atomic enough at this concurrency (same-machine, same-user, advisory workflows).
- **Residual risk:** A read racing the first mint sees the legacy identity for one composition cycle — self-heals on the next bump.

---

### Design Decisions {#design-decisions}

#### [P01] The dash id is `<unix-millis>-<6 hex>`, stored in branch config; the owner key is `tugdash/<name>#<tugid>` (DECIDED) {#p01-id-format}

**Decision:** `tugutil dash create` mints `tugid = <unix-millis>-<6 lowercase hex chars>` and stores it as `branch.tugdash/<name>.tugid`, beside the existing `tugbase` and `description` keys (`tugdash-core/src/ops.rs::create` writes those via `git config` today). The **owner key** — used for draft rows' `owner_id` and the sessions-table `dash_id` column — is `tugdash/<name>#<tugid>`. When no `tugid` is on file, the owner key degrades to the bare branch ref `tugdash/<name>` (the legacy identity, byte-identical to today's keys).

**Rationale:**
- Implements [program-P03]. The composite form keeps rows greppable by name while making each incarnation unique; the `#` separator cannot appear in a branch ref, so parsing is unambiguous and the legacy fallback is "everything before `#`".
- Storing in branch config follows the existing metadata home ([program-P06]: a dash IS git) and is torn down with the branch automatically.
- Millis+nonce needs no coordination and sorts chronologically for free.

**Implications:** `CreateOutcome`, `DashListItem`, `ShowOutcome` (`tugdash-core/src/ops.rs`) gain `id: Option<String>` (the full owner key); a shared `ensure_dash_id(repo, name) -> String` and read-only `dash_owner_key(repo, name) -> String` (key or legacy fallback) live beside `dash_base`.

#### [P02] Only write-path verbs mint ids; read paths fall back (DECIDED) {#p02-mint-on-write}

**Decision:** `ensure_dash_id` (mints when absent) is called from `create` (both the fresh and the idempotent-revisit paths), from the `/api/dash` bind handler, and from `commit`. All read paths — `list`, `show`, `status`, `dash_draft_message`, `integrate_message`, and tugcast's snapshot composition — use `dash_owner_key` (never mint).

**Rationale:** tugcast's `compose_snapshot` must stay read-only on git (a feed recompute that writes config is a side-effecting read and a multi-process race). Risk R01 covers the split-identity hazard this rule prevents.

**Implications:** an old dash first touched by a pure-read flow keeps its legacy identity until any write verb touches it — which is exactly the compat behavior the fallback readers already handle.

#### [P03] Dash draft rows migrate name→id by read-fallback + supersede-on-write (DECIDED) {#p03-draft-key-migration}

**Decision:** Dash draft rows in `changes.changeset_drafts` are keyed `owner_kind='dash', owner_id=<owner key per [P01]>`. Writers write the id-qualified key and delete any row under the legacy `tugdash/<name>` key for the same project (supersede). Readers query the id-qualified key first and fall back to the legacy key when it differs — layered on top of the existing canonical/raw `project_dir` spelling fallback, giving up to four probes worst-case.

**Rationale:**
- This is byte-for-byte the pattern `tugutil/src/draft.rs::run_set` already uses for the path-spelling split ("A legacy-spelling row for the same owner is now stale — the row just written supersedes it") — one idiom, applied to a second axis.
- No DDL change, so `CHANGES_SCHEMA_VERSION` is untouched and older builds keep working (they read/write legacy keys, which newer readers still find).

**Implications:** touch points are exactly: `tugutil/src/draft.rs::parse_owner`/`resolve_owner` (resolve `dash:<name>` → owner key by reading the project's git config; keep legacy when unresolvable), `tugdash-core/src/ops.rs::dash_draft_message` (query id key then legacy, per spelling), tugcast `feeds/draft_engine.rs` (`DraftTarget::Dash` keys by the entry's `owner_id`, which flips with Spec S06), `feeds/agent_supervisor.rs::clear_dash_draft` (delete under **both** keys), and the `/api/draft` handler (a pass-through — `owner_id` arrives pre-resolved).

#### [P04] CLI binding writes go through `POST /api/dash`, try-each-instance (DECIDED) {#p04-api-dash}

**Decision:** A new loopback-only `POST /api/dash` endpoint on tugcast handles `{op: "bind"|"unbind"|"dash_gone", ...}` (Spec S04). `tugutil dash bind|unbind` discovers ports per [D09] (the `resolve_port` family in `tugutil/src/commands/tell.rs`) and POSTs to each live instance until one answers `ok`; an instance that does not own the session answers `unknown_session` and the CLI moves on. `dash_gone` (fired best-effort by CLI `join`/`release`) is broadcast to **every** instance, since any of them may hold bindings to the dead dash.

**Rationale:**
- `sessions.db` is per-instance, so unlike `/api/draft` (whose target is machine-global and any instance is a valid conduit), a bind must land on the owning instance — try-until-owned is the minimal extension of the existing conduit doctrine.
- The HTTP route keeps the single-writer discipline: a short-lived CLI process never opens `sessions.db` read-write.
- Headless runs with no live instance degrade gracefully: bind fails with an actionable message (binding is a UI concept; a headless dash run loses nothing).

**Implications:** handler beside `draft_handler` in `tugcast/src/server.rs`, routed with the same loopback guard; the handler resolves the dash name → owner key via `ensure_dash_id` (bind is a write path, [P02]), writes the ledger, fires the changeset bump, and answers with the written binding.

#### [P05] Bindings clear eagerly on tugcast-side landings, lazily everywhere else (DECIDED) {#p05-binding-clear}

**Decision:** `do_changeset_join` and `do_changeset_release` (which already call `clear_dash_draft` on success) additionally clear every sessions-row binding matching the dash's owner key. CLI-side `tugutil dash join`/`release` POST `{op: "dash_gone", dash: <name>}` to all discovered instances, best-effort (a warning on failure, never a join failure). Independently, **every read path treats a binding whose dash branch no longer exists as unbound** — `do_list_card_bindings` and the spawn ack null the fields when the branch is gone, and `compose_snapshot` never lists a bound session for a dash it isn't composing.

**Rationale:** the eager path covers the card workflow; the lazy path guarantees correctness when tugcast was never in the loop (terminal joins, crashes between teardown and POST). Tolerant reads are the same doctrine as [P02]'s fallback: no state is trusted to be perfectly maintained when two writers (CLI, server) share it.

**Implications:** branch-existence checks on the read path are cheap (`git rev-parse --verify` against the repo the binding's project points at) but not free — `do_list_card_bindings` batches one check per distinct bound dash, not per row.

#### [P06] `stage` in this phase is derived-only (DECIDED) {#p06-derived-stage}

**Decision:** The `stage` field (Spec S05/S06) reports only what git and the ledgers can derive: `created` (no rounds, clean worktree), `working` (rounds > 0 or dirty worktree), `draft-ready` (non-empty maintained draft), `landing` (join journal present). Declared stages (`implementing (i/N)`, `built`, `audited`) arrive in Phase 3 with the step verbs; the wire fields for them (`step_current`, `step_total`) are declared optional now and stay absent.

**Rationale:** [program-P06] derive-don't-record; shipping the derived subset now gives Phase 2 an honest stage to render without inventing state Phase 3 owns.

#### [P07] Deck plumbing is types-and-stores only (DECIDED) {#p07-deck-plumbing}

**Decision:** The deck work in this phase is exactly: additive fields on `DashChangesetEntry` (`changeset-types.ts` + guards + fixtures), `CardSessionBinding` gaining `dash?: { id: string; name: string }` (`card-session-binding-store.ts`), and decode of the new spawn-ack / `list_card_bindings_ok` fields (`protocol.ts` types where applicable, `session-restore.ts` consumption). No component renders any of it.

**Rationale:** Phase 2 starts from flowing data instead of a protocol change; and keeping this phase invisible honors the program plan's phase boundary ("nothing visible").

---

### Deep Dives {#deep-dives}

#### Current identity and draft flow (what changes, precisely) {#current-flow}

- **Create** (`tugdash-core/src/ops.rs::create`): `git worktree add <repo>/.tug/worktrees/<sanitized> -b tugdash/<name> <base>`, then writes `branch.tugdash/<name>.tugbase` and `.description` via `git config`, enables rerere, runs `[tugtool.dash].post_create` hooks with rollback. Idempotent path returns `created: false` without re-hydration — **both paths must surface the id** ([P01]); the idempotent path calls `ensure_dash_id` (a fully-present old dash gets its id on revisit, a write-path touch per [P02]).
- **Draft ownership today**: `tugutil/src/draft.rs::parse_owner` maps `dash:<name>` → `("dash", "tugdash/<name>")`; `resolve_owner`'s derivation (cwd on a `tugdash/*` branch) produces the same. `dash_draft_message` (`ops.rs`) reads `WHERE owner_kind='dash' AND owner_id=<branch> AND project_dir=<canonical|raw>`. `integrate_message` chains override → draft → description → `"Dash work"`.
- **Draft writes in production** go through `POST /api/draft` (`tugutil/src/draft.rs::post_draft_api` → `tugcast/src/server.rs::draft_handler`); the server is the [L29] canonicalization gateway for `project_dir`. Under `TUG_CHANGES_DB` (tests) the CLI writes the private db directly. The `owner_id` value passes through the server untouched — which is why [P03]'s key change needs no server-side draft work beyond `clear_dash_draft`.
- **Draft cleanup**: `feeds/agent_supervisor.rs::clear_dash_draft(ledger, project_dir, dash_name)` builds the branch-ref owner id and calls `ledger.delete_changeset_draft("dash", owner_id, key)`; called from `do_changeset_join` and `do_changeset_release` success paths. The test `releasing_or_joining_a_dash_clears_its_draft` pins it.
- **Round commits** (`ops.rs::commit`) append `Tug-Session`/`Tug-Session-Id`/`Tug-Dash` trailers via `with_dash_trailers`; `session_citation` reads the per-instance `sessions.db` resolved by `sessions_db_file()` — the same resolution `status` reuses for `bound_sessions` (best-effort, [Q02]).

#### Current binding flow (what the column plugs into) {#current-binding-flow}

- The sessions DDL (`tugcast/src/session_ledger.rs`, the `CREATE TABLE IF NOT EXISTS sessions` block) carries `session_id`, `workspace_key`, `project_dir`, `card_id`, `state`, naming/tag/synopsis fields. Column additions use the `migrate_sessions_add_*` functions called just above the DDL (e.g. `migrate_sessions_add_synopsis`) — tolerant `ALTER TABLE`, duplicate-column errors swallowed.
- **Spawn ack** (`feeds/agent_supervisor.rs::do_spawn_session`): reads the session's ledger row and emits `spawn_session_ok` with `card_id`, `tug_session_id`, `workspace_key`, `project_dir`, `session_mode`, `name`, `tag`, `synopsis`, `private`. The dash binding rides here as `dash_id` / `dash_name` (nullable), subject to [P05] tolerant reads.
- **Restore** (`do_list_card_bindings`): emits one JSON row per card-bound session (`card_id`, `session_id`, `project_dir`, `state`, `turn_count`, `is_alive`, `has_jsonl`, `name`, …). `dash_id`/`dash_name` join this row set the same way.
- **Deck**: `card-session-binding-store.ts` maps `cardId → CardSessionBinding{tugSessionId, workspaceKey, projectDir, sessionMode}`, populated from the spawn ack only (clear-then-restore on reconnect is contractual); `session-restore.ts` consumes `list_card_bindings_ok`.

#### The extraction target {#extraction-target}

`feeds/changeset.rs::dash_entries(repo_root)` re-implements: branch enumeration (`for-each-ref refs/heads/tugdash/`), base lookup (`branch.<branch>.tugbase`, defaulting `"main"` — note tugdash-core's `dash_base` instead falls back to `detect_default_branch`; the extraction adopts tugdash-core's richer fallback), round count, the worktree sanitizer + legacy `.tugtree/tugdash__<sanitized>` fallback (duplicating `ops.rs::worktree_path`), worktree dirt, `base...branch` name-status files, and newest-first `round_subjects`. The extraction moves this into a tugdash-core function taking an explicit `repo_root` (the crate's `list()` is cwd-relative; the new fn is the `_in` variant of it with per-entry detail), returning a serializable struct tugcast maps into `ChangesetEntry::Dash`. tugcast calls it via `tokio::task::spawn_blocking` (tugdash-core is sync; the supervisor already runs `join_in` on a blocking thread). The existing test `compose_derives_dash_entries_from_tugdash_refs` must pass unchanged against the extracted implementation before the duplicate is deleted.

---

### Specification {#specification}

**Spec S01: Dash id** {#s01-dash-id}

- Mint: `tugid = format!("{millis}-{nonce}")`, `millis` = unix epoch millis at mint, `nonce` = 6 lowercase hex chars from a thread-local RNG.
- Storage: `git config branch.tugdash/<name>.tugid <tugid>` in the base repo.
- Owner key: `tugdash/<name>#<tugid>`; legacy form `tugdash/<name>` when no `tugid` exists.
- API (tugdash-core, beside `dash_base`): `ensure_dash_id(repo: &Path, name: &str) -> Result<String, String>` (returns the owner key, minting if absent); `dash_owner_key(repo: &Path, name: &str) -> String` (read-only; legacy fallback); `legacy_owner_key(owner_key: &str) -> &str` (strips `#…`).
- Exposure: `id: Option<String>` (the owner key) on `CreateOutcome`, `DashListItem`, `ShowOutcome`, and Spec S05/S06 outputs. `None` only on read paths for id-less dashes.

**Spec S02: Dash draft row keying** {#s02-draft-keys}

- Write: `owner_id = dash_owner_key(...)`; after a successful id-keyed write, delete the legacy-keyed row for the same `(owner_kind, project_dir)` pair (both spellings).
- Read: probe `(id key, canonical) → (id key, raw) → (legacy key, canonical) → (legacy key, raw)`, first hit wins.
- Applies to: `tugutil draft set|show|clear` (owner resolution in `resolve_owner`/`parse_owner`), `dash_draft_message`, `draft_engine` generation targets, `clear_dash_draft` (deletes under both keys, both spellings).

**Spec S03: Binding column + CONTROL verbs** {#s03-binding-control}

- Column: `migrate_sessions_add_dash_binding` adds `dash_id TEXT` and `dash_name TEXT` to `sessions` (name denormalized for display without a git read; `dash_id` is the owner key and the authority).
- Ledger API (`session_ledger.rs`): `set_dash_binding(session_id, Option<(dash_id, dash_name)>)`, `clear_dash_bindings_for_dash(dash_id) -> usize`, `sessions_bound_to_dash(dash_id) -> Vec<String>`.
- CONTROL `bind_dash` payload `{tug_session_id, project_dir, dash}` → resolve owner key via `ensure_dash_id` in `project_dir`'s repo → `set_dash_binding` → changeset bump (the same aggregate bump `do_changeset_join` fires on a land) → broadcast `bind_dash_ok {tug_session_id, dash_id, dash_name}` / `bind_dash_err {reason}`.
- CONTROL `unbind_dash` payload `{tug_session_id}` → `set_dash_binding(.., None)` → bump → `unbind_dash_ok`.
- Dispatch: two new arms in `handle_control` beside `list_card_bindings`.
- Echo: `spawn_session_ok` and `list_card_bindings_ok` rows gain nullable `dash_id`, `dash_name`, nulled on read when the dash branch is gone ([P05]).

**Spec S04: `POST /api/dash`** {#s04-api-dash}

Request/response, loopback-only, registered beside `/api/draft`:

| op | body | behavior | response |
|---|---|---|---|
| `bind` | `{op, tug_session_id, project_dir, dash}` | ownership check (session in this ledger, else `unknown_session`); `ensure_dash_id`; `set_dash_binding`; bump | `{status:"ok", dash_id, dash_name}` |
| `unbind` | `{op, tug_session_id}` | ownership check; clear binding; bump | `{status:"ok"}` |
| `dash_gone` | `{op, project_dir, dash_id}` | `clear_dash_bindings_for_dash`; bump when any row cleared | `{status:"ok", cleared: n}` |

Errors: `{status:"error", message}` with `unknown_session` distinguishable so the CLI's try-each-instance loop can continue silently.

**Spec S05: `tugutil dash status <name> --json`** {#s05-dash-status}

New `DashCommands::Status` variant; `ops::status_in(repo_root, name) -> DashStatus`:

```json
{"ok": true, "verb": "dash status", "data": {
  "name": "…", "id": "tugdash/…#…", "branch": "tugdash/…", "base_branch": "…",
  "stage": "created|working|draft-ready|landing",
  "rounds": 3, "worktree": "…", "worktree_dirty": false,
  "draft": true, "join_journal_phase": null,
  "bound_sessions": ["<session-id>", …],
  "step_current": null, "step_total": null
}}
```

`stage` per [P06]; `bound_sessions` best-effort from `sessions_db_file()` (empty when unresolvable); `step_*` reserved for Phase 3. Plain (non-`--json`) output: one human-readable block per the CLI's existing no-glue doctrine.

**Spec S06: Snapshot additions** {#s06-snapshot-additions}

`ChangesetEntry::Dash` (`tugcast-core/src/types.rs`) and `DashChangesetEntry` (`tugdeck/src/lib/changeset-types.ts`) gain, additively: `id?: string` (owner key), `stage?: string`, `bound_sessions?: string[]`, `step_current?: number`, `step_total?: number`. **`owner_id` flips to the owner key** (id-qualified when the dash has an id, legacy branch ref otherwise) — the deck treats `owner_id` as an opaque string (display uses `display_name`), and the draft attached to the entry is looked up under the same key, so entry and draft stay consistent by construction. Golden fixtures updated; ts guards accept old and new shapes.

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| `CardSessionBinding.dash` | external | existing `cardSessionBindingStore` + `useSyncExternalStore` (field addition only) | [L02] |
| Dash entry fields (`id`/`stage`/`bound_sessions`) | server | ride the CHANGESET_ALL snapshot; no new store | [L02] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugrust/crates/tugcast/src/dash_api.rs` | `POST /api/dash` handler (Spec S04), mirroring `server.rs::draft_handler`'s structure |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ensure_dash_id`, `dash_owner_key`, `legacy_owner_key` | fn | `tugdash-core/src/ops.rs` | Spec S01, [P01]/[P02] |
| `CreateOutcome.id`, `DashListItem.id`, `ShowOutcome.id` | field | `tugdash-core/src/ops.rs` | Spec S01 |
| `dash_draft_message` | fn (modify) | `tugdash-core/src/ops.rs` | four-probe read, Spec S02 |
| `status_in`, `DashStatus` | fn/struct | `tugdash-core/src/ops.rs` | Spec S05, [P06] |
| `dash_detail_entries_in(repo_root)` | fn | `tugdash-core/src/ops.rs` | the extraction (#extraction-target) |
| `parse_owner` / `resolve_owner` | fn (modify) | `tugutil/src/draft.rs` | `dash:<name>` → owner key via git config, legacy fallback |
| `DashCommands::{Status, Bind, Unbind}` | enum variants | `tugutil/src/cli.rs` | + dispatch in `tugutil/src/dash.rs` |
| `post_dash_api` (try-each-instance) | fn | `tugutil/src/dash.rs` | [P04]; reuses `commands/tell` port discovery |
| auto-bind after create; `dash_gone` after join/release | glue | `tugutil/src/dash.rs` | best-effort, warn-never-fail |
| `migrate_sessions_add_dash_binding` | fn | `tugcast/src/session_ledger.rs` | Spec S03 |
| `set_dash_binding`, `clear_dash_bindings_for_dash`, `sessions_bound_to_dash` | fn | `tugcast/src/session_ledger.rs` | Spec S03 |
| `bind_dash` / `unbind_dash` arms | match arms | `tugcast/src/feeds/agent_supervisor.rs::handle_control` | Spec S03 |
| `do_spawn_session` ack + `do_list_card_bindings` rows | modify | `tugcast/src/feeds/agent_supervisor.rs` | `dash_id`/`dash_name`, [P05] tolerant read |
| `clear_dash_draft` | fn (modify) | `tugcast/src/feeds/agent_supervisor.rs` | delete both keys, Spec S02 |
| binding clear in `do_changeset_join`/`do_changeset_release` | modify | `tugcast/src/feeds/agent_supervisor.rs` | [P05] |
| `dash_entries` | delete | `tugcast/src/feeds/changeset.rs` | replaced by tugdash-core call via `spawn_blocking` |
| `ChangesetEntry::Dash` new fields | fields | `tugcast-core/src/types.rs` | Spec S06 |
| `DashChangesetEntry` new fields + guards | type | `tugdeck/src/lib/changeset-types.ts` | Spec S06, [P07] |
| `CardSessionBinding.dash` | field | `tugdeck/src/lib/card-session-binding-store.ts` | [P07]; decode in spawn-ack path + `session-restore.ts` |

---

### Documentation Plan {#documentation-plan}

- [ ] Rustdoc on the new tugdash-core fns states the identity model ([P01]) and mint-on-write rule ([P02]).
- [ ] `tugutil dash --help` text for `status`/`bind`/`unbind`.
- [ ] The tuglaws doc (`dash-lifecycle.md`) is **Phase 5**; no laws edits here.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (Rust)** | id mint/parse/fallback; stage derivation; four-probe draft read | steps 1, 2, 5 |
| **Integration (Rust)** | CLI round-trips against fixture repos under `TUG_CHANGES_DB`; supervisor CONTROL round-trips; join-uses-id-keyed-draft | steps 2–6 |
| **Golden / Contract** | snapshot fixtures gain the additive dash fields; ts guards accept old + new | steps 6, 7 |
| **Unit (bun)** | guard/type acceptance; binding-store field decode | step 7 |

#### What stays out of tests {#test-non-goals}

- App-tests — nothing visible changes this phase; `just app-test-changed` runs as the phase-end gate for incidental coverage, no new app-test files.
- Fake-DOM/RTL render tests and mock-store assertions — banned project-wide.
- Cross-instance `/api/dash` discovery loops — the try-each loop is thin glue over the tested `resolve_port` family; the handler's ownership check is what gets the test.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** Applies to every step.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Dash id in tugdash-core | pending | — |
| #step-2 | Draft rows key by owner key | pending | — |
| #step-3 | Binding column + CONTROL verbs + `/api/dash` | pending | — |
| #step-4 | CLI bind/unbind + create auto-bind + `dash_gone` | pending | — |
| #step-5 | `tugutil dash status` | pending | — |
| #step-6 | Extract `dash_entries`; snapshot additions | pending | — |
| #step-7 | Deck plumbing | pending | — |
| #step-8 | Integration checkpoint | pending | — |

#### Step 1: Dash id in tugdash-core {#step-1}

**Commit:** `tugdash-core: mint a creation id per dash; expose it from every verb`

**References:** [P01], [P02], Spec S01, Risk R01, (#current-flow)

**Artifacts:** `ensure_dash_id` / `dash_owner_key` / `legacy_owner_key`; `id` on `CreateOutcome` / `DashListItem` / `ShowOutcome`; mint calls in `create` (both paths) and `commit`.

**Tasks:**
- [ ] Add the three fns beside `dash_base` in `tugdash-core/src/ops.rs` per Spec S01 (config key `branch.tugdash/<name>.tugid`, written with the same `git_output(... ["config", ...])` shape `create` uses for `tugbase`).
- [ ] `create`: fresh path mints after the config writes; idempotent path calls `ensure_dash_id` before returning; both populate `CreateOutcome.id`.
- [ ] `commit`: call `ensure_dash_id` at entry (a write-path touch that backfills old dashes).
- [ ] `list` / `show`: populate `id` via `dash_owner_key` (read-only; `None` never occurs — the fallback string is always available — so the field is `Option` only for wire hygiene on Spec S06; here it is always `Some`).

**Tests:**
- [ ] Rust: create mints; second create returns the same id; an id-less fixture dash reads its legacy owner key from `dash_owner_key` and gains an id after `commit`.
- [ ] Rust: `legacy_owner_key("tugdash/x#123-abc") == "tugdash/x"`; passthrough for legacy strings.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugdash-core`

---

#### Step 2: Draft rows key by owner key {#step-2}

**Depends on:** #step-1

**Commit:** `Dash drafts key by creation id; legacy name-keyed rows read and superseded`

**References:** [P03], Spec S01, Spec S02, (#current-flow)

**Artifacts:** owner resolution in `tugutil/src/draft.rs`; four-probe `dash_draft_message`; both-key `clear_dash_draft`.

**Tasks:**
- [ ] `tugutil/src/draft.rs`: `parse_owner`'s `dash:` arm and `resolve_owner`'s cwd-derivation resolve the owner key by reading `branch.tugdash/<name>.tugid` from the project's repo (legacy form when absent). Direct-write (`TUG_CHANGES_DB`) and API paths both send the resolved key; the direct-write supersede also deletes the legacy-keyed row (extending the existing legacy-spelling delete).
- [ ] `tugdash-core/src/ops.rs::dash_draft_message`: four-probe read per Spec S02 (id/legacy × canonical/raw).
- [ ] `tugcast/src/feeds/agent_supervisor.rs::clear_dash_draft`: delete under both keys; extend the pinned test `releasing_or_joining_a_dash_clears_its_draft` to seed one row under each key.
- [ ] `tugcast/src/feeds/draft_engine.rs`: confirm `DraftTarget::Dash` keys by the entry's `owner_id` (it flips in #step-6); add a comment noting the dependency, no behavior change here.

**Tests:**
- [ ] Rust (tugutil, `TUG_CHANGES_DB` isolation): `draft set --owner dash:x` writes the id key; a pre-seeded legacy row is found by `draft show` when no id row exists and deleted after a `set`.
- [ ] Rust (tugdash-core, fixture repo): a join with an id-keyed draft uses it as the squash message; with only a legacy-keyed draft, likewise.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugdash-core -p tugutil -p tugcast`

---

#### Step 3: Binding column + CONTROL verbs + `/api/dash` {#step-3}

**Depends on:** #step-1

**Commit:** `Session↔dash binding: sessions column, bind/unbind control verbs, /api/dash`

**References:** [P04], [P05], Spec S03, Spec S04, (#current-binding-flow)

**Artifacts:** migration + ledger API; `handle_control` arms; `dash_api.rs`; ack/bindings echo; eager clear on join/release.

**Tasks:**
- [ ] `session_ledger.rs`: `migrate_sessions_add_dash_binding` (two tolerant `ALTER TABLE`s, modeled on `migrate_sessions_add_synopsis`), called in the migration list; `set_dash_binding` / `clear_dash_bindings_for_dash` / `sessions_bound_to_dash`; `dash_id`/`dash_name` on the row struct `list_with_card_id` returns.
- [ ] `agent_supervisor.rs`: `bind_dash` / `unbind_dash` arms per Spec S03 with payload parsers beside the existing `parse_*_payload` fns; changeset bump on success (the same bump `do_changeset_join` fires).
- [ ] `do_spawn_session` ack and `do_list_card_bindings` rows: emit `dash_id`/`dash_name`, nulled when the dash branch no longer exists ([P05] — one `git rev-parse --verify refs/heads/<branch>` per distinct bound dash, batched).
- [ ] `do_changeset_join` / `do_changeset_release` success paths: `clear_dash_bindings_for_dash` beside the existing `clear_dash_draft`.
- [ ] New `tugcast/src/dash_api.rs` + route registration in `server.rs` beside `/api/draft` (same loopback guard, same `spawn_blocking` discipline): `bind` / `unbind` / `dash_gone` per Spec S04; `bind` resolves the owner key via `ensure_dash_id` (write path).

**Tests:**
- [ ] Rust (tugcast): bind → `list_card_bindings_ok` carries the fields → unbind → nulls; bind then delete the branch in the fixture → fields null on read ([P05]).
- [ ] Rust (tugcast): join and release each clear bindings for the dash id.
- [ ] Rust (tugcast): `/api/dash` bind for an unknown session answers `unknown_session`; `dash_gone` clears rows and reports the count.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 4: CLI bind/unbind + create auto-bind + `dash_gone` {#step-4}

**Depends on:** #step-3

**Commit:** `tugutil dash bind/unbind; create auto-binds; join/release broadcast dash_gone`

**References:** [P04], [P05], Spec S04, (#q03-cli-bind-route)

**Artifacts:** `DashCommands::{Bind, Unbind}` + dispatch; `post_dash_api`; create/join/release glue.

**Tasks:**
- [ ] `cli.rs`: `Bind { name }` / `Unbind` variants (unbind takes no name — it clears the calling session's binding); `dash.rs` dispatch.
- [ ] `dash.rs::post_dash_api`: discover ports per [D09] (`commands/tell` helpers, as `post_draft_api` does), POST to each until `ok`; `unknown_session` continues the loop; exhaustion is an actionable error for `bind`/`unbind` and a warning for `dash_gone`.
- [ ] `bind` requires `TUG_SESSION_ID` (error otherwise, same message style as `resolve_owner`'s no-owner error).
- [ ] `create` dispatch: after a successful create with `TUG_SESSION_ID` set, best-effort bind (warn on failure, never fail the create).
- [ ] `join` / `release` dispatch: after success, best-effort `dash_gone` to every discovered instance.

**Tests:**
- [ ] Rust (tugutil): `dash bind` without `TUG_SESSION_ID` exits 1 with the actionable message; `--json` envelopes parse.
- [ ] Rust (tugcast, exercising the handler the CLI targets): bind→unbind round-trip through `/api/dash` over a test server, covering the response shapes the CLI decodes.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugutil -p tugcast`

---

#### Step 5: `tugutil dash status` {#step-5}

**Depends on:** #step-3

**Commit:** `tugutil dash status: one machine-readable lifecycle readout`

**References:** [P06], Spec S05, (#state-model in the program plan; #current-flow)

**Artifacts:** `ops::status_in` + `DashStatus`; `DashCommands::Status` + dispatch; plain and `--json` output.

**Tasks:**
- [ ] `status_in(repo_root, name)`: compose from existing helpers — `dash_owner_key`, `dash_base`, round count (as `list` does), worktree + dirt (as `show` does), draft presence (`dash_draft_message(...).is_some()`), join-journal phase (read the journal file `show`'s siblings use in `join_in`), `bound_sessions` via `sessions_db_file()` read-only (`SELECT session_id FROM sessions WHERE dash_id = ?`, empty on any failure).
- [ ] Stage derivation per [P06] as a pure fn with the precedence `landing > draft-ready > working > created`, unit-tested on synthesized inputs.
- [ ] `step_current`/`step_total` emitted as JSON nulls (Phase 3's slots).

**Tests:**
- [ ] Rust unit: stage precedence table.
- [ ] Rust integration (fixture repo): fresh dash → `created`; after a round → `working`; after `draft set` → `draft-ready`; journal present → `landing`.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugdash-core -p tugutil`

---

#### Step 6: Extract `dash_entries`; snapshot additions {#step-6}

**Depends on:** #step-1, #step-3

**Commit:** `Dash snapshot entries compose from tugdash-core; entries carry id, stage, bound sessions`

**References:** [P02], [P05], [P06], Spec S06, (#extraction-target)

**Artifacts:** `dash_detail_entries_in` in tugdash-core; deleted `feeds/changeset.rs::dash_entries`; extended `ChangesetEntry::Dash`; updated fixtures.

**Tasks:**
- [ ] `tugdash-core`: `dash_detail_entries_in(repo_root)` returning the per-dash detail the feed needs (name, owner key, base — via `dash_base`'s detection fallback, adopted deliberately over the duplicate's bare `"main"` default — rounds, worktree rel/abs + dirt with the legacy-home fallback from `worktree_path`, name-status files, newest-first round subjects). Pure read path: `dash_owner_key`, never `ensure_dash_id` ([P02]).
- [ ] `feeds/changeset.rs`: replace the `dash_entries` body with a `spawn_blocking` call into tugdash-core; map into `ChangesetEntry::Dash`; delete the local sanitizer/parsing duplicates.
- [ ] `tugcast-core/src/types.rs`: add `id`, `stage`, `bound_sessions`, `step_current`, `step_total` (all optional/serde-defaulted) to `ChangesetEntry::Dash`; **`owner_id` becomes the owner key** per Spec S06. `stage` computed in compose from the same pure derivation as #step-5 (share it from tugdash-core); `bound_sessions` from `sessions_bound_to_dash` on the compose-side ledger.
- [ ] Draft attachment in compose: look up dash drafts under the entry's `owner_id` with the Spec S02 legacy fallback, so an entry composed before any write-verb mint still finds its legacy-keyed draft.
- [ ] Update golden snapshot fixtures.

**Tests:**
- [ ] Rust: `compose_derives_dash_entries_from_tugdash_refs` passes against the extracted implementation (extended to assert `id`/`stage`/`bound_sessions`).
- [ ] Rust: an id-less dash composes with the legacy `owner_id` and still attaches its legacy-keyed draft.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugdash-core -p tugcast`

---

#### Step 7: Deck plumbing {#step-7}

**Depends on:** #step-3, #step-6

**Commit:** `Deck carries the dash binding and the extended dash entry; nothing renders yet`

**References:** [P07], Spec S03, Spec S06, (#state-zone-mapping)

**Artifacts:** extended `DashChangesetEntry` + guards; `CardSessionBinding.dash`; ack/bindings decode.

**Tasks:**
- [ ] `changeset-types.ts`: additive optional fields per Spec S06; guards accept old and new shapes; fixture updates.
- [ ] `card-session-binding-store.ts`: `dash?: { id: string; name: string }` on `CardSessionBinding`, populated from `spawn_session_ok`'s `dash_id`/`dash_name` in the same code path that populates `workspaceKey` (the ack consumer in `session-lifecycle.ts` / wherever the store's setter is invoked from the ack — follow the existing `synopsis` field's route as the template).
- [ ] `session-restore.ts`: carry the fields through the `list_card_bindings_ok` consumption so a restored card's binding matches a freshly spawned one.
- [ ] `bind_dash_ok` / `unbind_dash_ok` broadcast handling: update the binding store entry for the affected session (`cardIdForSession` gives the reverse walk), so a bind issued by a skill mid-session reaches the store without a respawn.

**Tests:**
- [ ] bun: guards accept a legacy dash entry (no new fields) and an extended one; binding decode round-trip for ack rows with and without dash fields.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx vite build`

---

#### Step 8: Integration checkpoint {#step-8}

**Depends on:** #step-2, #step-4, #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Walk the lifecycle on a fixture/scratch repo end to end: `dash create x` (id minted, auto-bind attempted) → `draft set --owner dash:x` (id-keyed row) → `dash status x --json` (stage `draft-ready`, draft true) → `dash join x` (draft used as message; `dash_gone` broadcast) → bindings and drafts gone.
- [ ] Confirm no step introduced a visible UI change (the phase's contract).

**Tests:**
- [ ] The full suites, as below.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run`
- [ ] `cd tugdeck && bun test && bunx vite build`
- [ ] `just app-test-changed`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Dashes have durable creation identities; sessions bind to dashes server-authoritatively with CLI, CONTROL, and HTTP surfaces; `dash status` answers the lifecycle question machine-readably; the changeset snapshot carries id, stage, and mated sessions from a single shared composition — with zero visible UI change.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Every Success Criterion in (#success-criteria) verified by its named test.
- [ ] `feeds/changeset.rs` contains no dash-composition logic of its own.
- [ ] A dash created by an older build (no `tugid`) round-trips every verb and the feed under its legacy identity.

**Acceptance tests:**
- [ ] The #step-8 lifecycle walk.
- [ ] `cargo nextest run` / `bun test` / `bunx vite build` / `just app-test-changed` green.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 2: render `snapshot.dashes` (Changes lane, chrome chip, Lens section, `/dash` gesture).
- [ ] Phase 3: `dash step` verbs fill `step_current`/`step_total`; declared stages join the derivation.
- [ ] [Q02] cross-instance `bound_sessions` aggregation, if a real workflow demands it.

| Checkpoint | Verification |
|------------|--------------|
| Identity + drafts | tugdash-core/tugutil suites (#step-1, #step-2) |
| Binding | tugcast supervisor + `/api/dash` suites (#step-3, #step-4) |
| Status + snapshot | tugdash-core/tugcast suites (#step-5, #step-6) |
| Deck plumbing | bun + vite build (#step-7) |
| Phase | #step-8 aggregate |
