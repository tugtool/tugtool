<!-- devise-skeleton v4 -->

## Session Tags — mnemonic names fronting Dev card sessions {#session-tags}

**Purpose:** Give every Dev card session a human-friendly mnemonic **tag** — an `adjective-noun` pair like `azure-heron` — that fronts the session in the UI and is typable to address it, layered *on top of* (never replacing) the client-minted UUID and the `/rename` custom name. Tags mint client-side "from the drop", are stored authoritatively in the tugcast ledger, and are unique per machine.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-07-15 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

A Dev card session is identified by a `tugSessionId` — a UUID the client mints with `crypto.randomUUID()` and passes to the `claude` subprocess as `--session-id`. UUIDs are a solid join key but poor for humans: you cannot recall or say `a4c7946c-…`. The existing `/rename` feature (ledger `sessions.name` + `name_user_set`, surfaced by `sessionChipDisplay`/`sessionRowTitle`) lets a user name a session, but only after the fact and only by hand. This plan adds a curated mnemonic that is present the instant a session is born.

The lexicon is **already built and committed** — `tugdeck/src/lib/session-tag-lexicon.ts` (`8a84a02e0`) exports `TAG_ADJECTIVES` (512 words, 4–6 letters), `TAG_NOUNS` (1024 words, 4–5 letters), and `TAG_COMBINATIONS` (524,288). The two pools are disjoint (a tag never doubles a word) and curated for tone. This plan **consumes** that module; it must not regenerate or edit it.

The tag reuses the exact end-to-end machinery `/rename` already established: a nullable column on the ledger `sessions` row, a field on the `SessionRow` wire shape, ingestion into a per-session client store, and a precedence rule in the pure display helpers. The one genuinely new idea is *minting*: unlike a name (set on demand), a tag is minted eagerly at session creation and made unique by the ledger.

#### Strategy {#strategy}

- **Mirror `/rename`, don't invent.** The tag is a second nullable ledger column (`tag`) beside `name`/`name_user_set`, a second field on `SessionRow`, a second per-session client store beside `sessionNameStore`, and a third precedence tier in `sessionChipDisplay`/`sessionRowTitle`. Every existing seam is reused.
- **Backend first.** Ledger schema + `record_spawn` claim (Step 1) and the supervisor/bridge/protocol plumbing (Step 2) land and pass `cargo nextest` before any tugdeck code, so the wire contract is fixed before the client consumes it.
- **Client mints; the ledger enforces uniqueness.** The lexicon lives only in TypeScript. The client mints a candidate tag and re-rolls it against the tags it already knows (from cached `SessionRow`s); the ledger's `UNIQUE` index is the atomic backstop, resolving the rare true race with a deterministic numeric suffix ([P03]). No lexicon is duplicated into Rust.
- **From the drop, corrected on echo.** The client shows a provisional tag immediately (optimistic), the server claims-or-suffixes it authoritatively at `record_spawn`, and the final tag rides back on the existing `session_updated` broadcast — the same optimistic-echo pattern `/rename` uses. No new control verb.
- **Pure logic isolated and unit-tested.** Minting and tag→session resolution live in a new React/DOM-free `session-tag.ts`, authored like the existing pure `session-name.ts`.
- **Addressability = display + resolve + one filter.** Every session row and the Z4B chip show the tag; a new filter field on the `/resume` overlay matches tags (and names/prompts); a pure `resolveTag` + a reverse map back any future typed command.

#### Success Criteria (Measurable) {#success-criteria}

- A brand-new session shows a well-formed `adjective-noun` tag on its Z4B chip **before the first turn** (spawn a new card → observe the chip; the value matches `/^[a-z]{4,6}-[a-z]{4,5}(-\d+)?$/`).
- The tag survives an app restart / Maker ▸ Reload and a resume (the same tag renders after re-resume — it is read from the ledger, not re-minted).
- Two sessions never share a tag on one machine: a `record_spawn` unit test that inserts a colliding tag observes the second row receive a `-2` suffix (`cargo nextest`).
- Precedence holds: a session with a `/rename` name shows the name; clearing the name reveals the tag; a legacy tagless session still shows its prompt/UUID (unit tests on `sessionChipDisplay`/`sessionRowTitle`).
- Typing a tag substring into the `/resume` overlay filter narrows the list to the matching session(s); a non-matching string yields an empty list and fires no spawn.
- `cd tugrust && cargo nextest run` is green with `-D warnings`; `bunx vite build` succeeds; `just app-test` passes.

#### Scope {#scope}

1. Ledger: `sessions.tag` column (+ unique index), self-healing migration, and `record_spawn` tag claim-or-suffix with resume-preserve/backfill.
2. Supervisor/bridge/protocol (Rust): carry the tag on `LedgerEntry`, parse it off the `spawn_session` frame, thread it into `SessionRecord`/`record_spawn`, and emit it on `SessionRow` + `session_updated`.
3. Wire (TS): `SessionRow.tag`, `normalizeSessionRow`, `encodeSpawnSession`/`sendSpawnSession` tag field, `session_updated` passthrough.
4. Pure logic (TS): `session-tag.ts` (`mintTag`, `resolveTag`), `session-tag-store.ts`, and the name→tag→UUID precedence in `session-name.ts`.
5. Ingestion + mint wiring (TS): consume the tag at the three `action-dispatch` sites; mint a provisional tag at every client spawn site and thread it through `sendSpawnSession`.
6. Display + addressing (TS): tag on the Z4B chip and session rows; a tag-matching filter on the `/resume` overlay.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Regenerating or editing the lexicon module.
- A `/retag` (reroll) command — deferred ([Q03], #roadmap).
- Passing the tag to `tugcode` / the `claude` CLI — the tag is Tug-side only ([P07]).
- Eager backfill of tags onto all pre-existing `sessions` rows ([P06] — lazy on resume instead).
- A dedicated `/resume <tag>` typed *command* — the `/resume` overlay filter is the v1 typed-entry surface; a standalone command is a follow-on ([Q02]).
- Cross-machine tag uniqueness — tags are unique per on-disk ledger only.

#### Dependencies / Prerequisites {#dependencies}

- `tugdeck/src/lib/session-tag-lexicon.ts` (already committed, `8a84a02e0`).
- The existing `/rename` end-to-end path, which this plan mirrors (`session_ledger.rs` `name`/`rename`, `SessionRow`, `sessionNameStore`, `session-name.ts`, `action-dispatch.ts` ingestion).

#### Constraints {#constraints}

- **tuglaws.** Cross-check `tuglaws/tuglaws.md`, `tuglaws/pane-model.md`, `tuglaws/component-authoring.md`, `tuglaws/design-decisions.md`. New client state enters React only via `useSyncExternalStore` ([L02], like `sessionNameStore`); tag text is data (not a CSS-class appearance change) so [L06] is not implicated by rendering it. See #state-zone-mapping. Name the laws each step touches in its commit.
- **Warnings are errors.** The Rust workspace enforces `-D warnings`; `cargo nextest run` fails on any warning.
- **Verify with `bunx vite build`.** The debug app loads the production rollup bundle; an import that works under dev esbuild can still fail the build. No tugdeck step is done until `bunx vite build` passes.
- **App-test reality.** `just app-test` drives the real app but its replay workspace is transient (~2s); long real UI round-trips are not app-testable and must be covered at the Rust round-trip + pure-TS-unit layers (see #test-non-goals).
- **Compose existing Tug components.** The `/resume` filter field must be an existing `Tug*` input (e.g. a `TugTextField`), never hand-rolled; register the standard substrate responders if it is an editing surface.
- **SQLite gotcha.** SQLite forbids `ALTER TABLE … ADD COLUMN … UNIQUE`. Uniqueness must come from a separately-created `CREATE UNIQUE INDEX` ([P02]).

#### Assumptions {#assumptions}

- For an un-forked session `tugSessionId == claude_session_id`, so the ledger row (keyed by claude id) and the client (keyed by tug id) agree on the tag. Forked sessions where the two diverge are rare; the tag follows the ledger row (claude id) and the client's cached `SessionRow` carries whatever the server stored.
- `Math.random()` is available in the browser (the lexicon generator's sandbox restriction does not apply to tugdeck runtime code).
- Collisions are astronomically rare: 524,288 combinations, and the client re-rolls against every tag it already knows, so the server suffix path is a true last-resort race-breaker.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Backfill of pre-existing sessions (DECIDED — see [P06]) {#q01-backfill}

**Question:** Do we eagerly mint tags for every existing `sessions` row at migration time, or lazily?

**Why it matters:** Eager server-side minting would require duplicating the 1536-word lexicon into Rust (drift risk); lazy minting leaves old rows tagless until they are next touched.

**Resolution:** DECIDED (see [P06]). No eager backfill. Legacy rows render exactly as today (name → prompt/UUID) until resumed; on resume the client mints a provisional tag and `record_spawn`'s `COALESCE(sessions.tag, excluded.tag)` assigns it. Zero new machinery, zero Rust lexicon.

#### [Q02] Typed-tag entry surface (DECIDED — see [P05]) {#q02-addressing}

**Question:** Where exactly can a user *type* a tag to address a session? `resume-sheet.tsx` has no filter input today (confirmed by grep — no `input`/`filter`/`query`).

**Resolution:** DECIDED (see [P05]). v1 adds a filter field to the `/resume` overlay that matches on tag (and name/prompt); a non-matching string yields an empty list and fires nothing. The pure `resolveTag(typed, rows)` + the store's reverse map back any future standalone `/resume <tag>` command, which is deferred (#roadmap).

#### [Q03] `/retag` reroll command (DEFERRED) {#q03-retag}

**Question:** Should there be a `/retag` command to reroll a session's tag, and can `/rename` clear back to the tag?

**Resolution:** `/rename` clearing already reveals the tag for free via the name→tag→UUID precedence ([P01]) — no work needed. A `/retag` reroll (a rename-style CONTROL verb writing a fresh unique tag) is DEFERRED to #roadmap; it is not required for phase close.

#### [Q04] Chip display + truncation (DECIDED — see [P01]) {#q04-chip}

**Question:** Does the tag become the chip's value, and how does it interact with `SESSION_NAME_CAP` (16)?

**Resolution:** DECIDED. When unnamed, the tag is the chip value (name → tag → truncated UUID); the tooltip shows tag + full UUID. `SESSION_NAME_CAP` truncation still applies but never bites: a tag is at most `6 + 1 + 5 + suffix` ≈ 12–14 chars. The chip's `copyValue` includes the tag as an addressable handle.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| `UNIQUE(tag)` violation not caught by `ON CONFLICT(session_id)` → `record_spawn` errors | med | low | Explicit claim-or-suffix loop around the INSERT catching the tag-unique error ([P03], Spec S02) | any `record_spawn` error in logs |
| Tag/name field drift between Rust `SessionRow` and TS `SessionRow` | med | med | Both carry the "keep in lockstep" doc comment; Step 2/Step 3 land together; contract test on `session_updated` round-trip | a field added to one shape only |
| Adding a `UNIQUE` column via `ALTER TABLE` fails on existing DBs | high | high (if attempted) | Never inline-`UNIQUE`; add plain column + `CREATE UNIQUE INDEX` ([P02]) | migration error on upgrade |
| Legacy NULL tags collide under the unique index | high | low | SQLite treats NULLs as distinct in a unique index — many NULL tags coexist ([P02]) | duplicate-NULL constraint error |

**Risk R01: Tag-unique conflict crashes the spawn record** {#r01-tag-unique}

- **Risk:** A fresh `INSERT` whose tag already exists raises a constraint error that `ON CONFLICT(session_id) DO UPDATE` does not absorb (different conflict target), aborting the ledger write.
- **Mitigation:** Wrap the insert in a bounded retry that, on the tag-unique extended error code, rewrites the tag with the next `-N` suffix and retries ([P03], Spec S02). Client-side re-roll makes this path almost never execute.
- **Residual risk:** Under a pathological suffix cascade the loop caps out; treated as a logged degenerate case (the session still gets *a* tag or falls back to no tag, never a failed spawn).

---

### Design Decisions {#design-decisions}

#### [P01] Display precedence: name → tag → truncated UUID (DECIDED) {#p01-precedence}

**Decision:** The pure display helpers resolve, in order, the user `/rename` name, then the tag, then the truncated UUID. The UUID is only the last-resort fallback.

**Rationale:**
- Preserves the user's explicit `/rename` as highest authority (unchanged from today).
- Makes the tag the default friendly face; clearing a name auto-reveals the tag (resolves [Q03]'s "clear to tag" for free).
- A legacy tagless session degrades to exactly today's behavior (prompt/UUID).

**Implications:** `sessionChipDisplay` and `sessionRowTitle` in `session-name.ts` gain a `tag` parameter between `name` and the UUID/fallback. Every caller passes the tag.

#### [P02] The ledger column is the registry; uniqueness via a unique index (DECIDED) {#p02-ledger-registry}

**Decision:** Add `tag TEXT` to the `sessions` table and enforce uniqueness with `CREATE UNIQUE INDEX IF NOT EXISTS sessions_tag ON sessions(tag)` — never an inline `UNIQUE` column. No separate tugbank defaults domain.

**Rationale:**
- The `sessions` row already exists per session; the column is storage, the unique index is the atomic collision check, and `WHERE tag = ?` is a reverse index — three roles, one column.
- SQLite cannot add a `UNIQUE` column via `ALTER TABLE ADD COLUMN`; a separate unique index is the only migration-safe route and is semantically identical.
- SQLite treats `NULL`s as distinct in a unique index, so every pre-existing NULL-tag row coexists — essential for lazy backfill ([P06]).

**Implications:** The `CREATE TABLE` path and a new `migrate_sessions_add_tag` both add the column and the index. Never recycle tags → the 1:1 mapping is permanent, so addressing is unambiguous.

#### [P03] Client mints and re-rolls; the ledger suffixes on the rare race (DECIDED) {#p03-mint-ownership}

**Decision:** The client mints the candidate tag from the TS-only lexicon and re-rolls it against the tags it already knows; the ledger enforces true uniqueness by catching the tag-unique constraint error and appending the next numeric suffix. Rust holds no lexicon.

**Rationale:**
- Keeps the 1536-word lexicon single-sourced in TypeScript — no Rust copy, no drift.
- The "re-roll" of the original brief happens client-side where the lexicon lives; the server's suffix is the deterministic backstop for the simultaneous-mint race only.
- With 524k combinations and client-side re-roll, the suffix path is essentially never hit in practice.

**Implications:** `record_spawn` gains a claim-or-suffix loop (Spec S02). `mintTag` (Spec S01) takes the set of known tags and re-rolls. The server never needs to *generate* a tag — only to accept or suffix the one it is given.

#### [P04] From the drop, corrected on echo — no new control verb (DECIDED) {#p04-optimistic-echo}

**Decision:** The client mints a provisional tag at session creation, sets it optimistically in the tag store (instant display), and sends it on the existing `spawn_session` frame. The server's authoritative tag rides back on the existing `session_updated` broadcast (built from the ledger row). No new message type.

**Rationale:**
- Exactly the optimistic-echo pattern `/rename` uses today (`action-dispatch` sets the name store optimistically, then `session_updated` makes it authoritative).
- Adding only a *field* to an existing frame means the inbound allowlist (`types.ts` union + guard + `isInboundMessage`) is **not** triggered — that check only guards new message *types*.

**Implications:** `encodeSpawnSession`/`sendSpawnSession` gain an optional `tag`; `build_session_updated_frame` and `SessionRow` gain `tag`; `action-dispatch` ingests it at the same three sites it ingests `name`.

#### [P05] Addressing is client-side over cached rows + one `/resume` filter (DECIDED) {#p05-addressing}

**Decision:** Tag→session resolution is a client-side lookup over the cached `SessionRow` list (the client already receives every row via `list_sessions_ok`). v1 exposes typed entry through a new filter field on the `/resume` overlay; a pure `resolveTag` and a reverse map in the tag store back any future command.

**Rationale:**
- No new reverse-lookup endpoint — the data is already on the client.
- `resume-sheet.tsx` has no filter today; a single filter field is the smallest real typed-entry surface and also improves name/prompt search.

**Implications:** New `resolveTag(typed, rows)` in `session-tag.ts`; the tag store keeps a `tag → session_id` reverse map; the `/resume` overlay composes a `Tug*` text field and filters its list on tag/name/prompt.

#### [P06] No eager backfill; lazy tag-on-resume (DECIDED) {#p06-backfill}

**Decision:** Do not mint tags for existing rows at migration. New sessions get a tag at first spawn; legacy tagless rows acquire one the first time they are resumed, via `record_spawn`'s `COALESCE(sessions.tag, excluded.tag)`.

**Rationale:**
- Server-side eager minting would need a Rust lexicon (rejected, [P03]).
- On resume the client already sends a provisional tag; COALESCE assigns it to the previously-NULL row with zero extra machinery.

**Implications:** `record_spawn`'s conflict branch must `COALESCE` the tag (preserve a set tag on respawn, fill a NULL one on resume), mirroring how it already `COALESCE`s `name`.

#### [P07] The tag is Tug-side only (DECIDED) {#p07-tug-side}

**Decision:** The tag never reaches `tugcode` or the `claude` subprocess; `--session-id` stays the UUID.

**Rationale:** The tag is a presentation/addressing label over the canonical UUID; claude has no use for it and the UUID remains the disk/JSONL key.

**Implications:** The tag is added to the `spawn_session` payload for the *supervisor* (to store on `LedgerEntry`/ledger), not forwarded into the child spawn args in `agent_bridge`/`relay_session_io`.

---

### Deep Dives (Optional) {#deep-dives}

#### The spawn → session_init → ledger flow (where the tag threads) {#flow-spawn-to-ledger}

The tag follows the identical path `card_id`/`permission_mode` already travel:

1. **Client** mints `tugSessionId` (`crypto.randomUUID()`) and a provisional tag, then calls `sendSpawnSession(...)` → `encodeSpawnSession(...)` → a `spawn_session` CONTROL frame (`CONTROL_ACTION_SPAWN_SESSION`). Mint sites: `dev-card.tsx` (the `submitWith` new-session path near the two `crypto.randomUUID()` calls, and the `/clear` path that mints `newSessionId`), `dev-session-restore.ts` (the restore-as-new mint and the resume path that reuses an existing id), `resume-sheet.tsx` (the resume-as-new mint).
2. **Supervisor** (`agent_supervisor.rs`): `parse_spawn_session_payload` extracts `tug_session_id`/`project_dir`/`permission_mode` — add `tag` here. `do_spawn_session` builds/updates the in-memory `LedgerEntry` (keyed by `TugSessionId`); it sets `entry.permission_mode` on the fresh path — set `entry.tag` the same way (once on fresh insert, preserved across reconnect). `LedgerEntry::new` initializes `permission_mode: None` — add `tag: None`.
3. **Bridge** (`agent_bridge.rs`): at `session_init`, the promote block constructs `SessionRecord { session_id: record_id, workspace_key, project_dir, card_id }` and calls `sessions_recorder.record(...)`. Add `tag` to `SessionRecord` and pass `entry.tag` here (the entry is in scope in `relay_session_io`). Note the ledger row is keyed by the **claude** session id (`record_id`), which equals the tug id for un-forked sessions.
4. **Ledger** (`session_ledger.rs`): `LedgerSessionsRecorder::record` calls `record_spawn(...)`; add the `tag` argument. `record_spawn` performs `INSERT … ON CONFLICT(session_id) DO UPDATE`; the tag is set on fresh insert (claim-or-suffix, Spec S02) and `COALESCE`d on the conflict branch ([P06]).
5. **Echo**: `record` calls `broadcast_row` → `build_session_updated_frame(row)`, which serializes each field explicitly — add `tag`. The client ingests it in `action-dispatch` (`session_updated` handler), making the optimistic tag authoritative.

#### Precedence + store shape (mirror of `/rename`) {#precedence-store}

`sessionNameStore` (`session-name-store.ts`) is a `Map<session_id, string>` fed from three `action-dispatch` sites: the optimistic `/rename` echo, the `session_updated` push, and `list_sessions_ok` rows. The chip (`DevSessionIdBadge`) subscribes by id and calls `sessionChipDisplay(name, tugSessionId)`; the picker row (`dev-picker-cells.tsx`) calls `sessionRowTitle(row.name, fullPrompt ?? "")`.

The tag store is the exact same shape plus a reverse map for resolution:

**Spec S01: `session-tag.ts` pure API** {#s01-session-tag-api}
- `mintTag(known: ReadonlySet<string>, rng?: () => number): string` — pick `TAG_ADJECTIVES[i]` + `"-"` + `TAG_NOUNS[j]`; if the result is in `known`, re-roll up to a small cap (e.g. 8); if still colliding, return the last candidate (the server suffixes it). `rng` defaults to `Math.random` and is injectable for tests.
- `resolveTag(typed: string, rows: readonly SessionRow[]): string | null` — return the `session_id` of the row whose `tag` equals `typed` (exact match; case-insensitive trim), else `null`.

**Spec S02: `record_spawn` tag claim-or-suffix** {#s02-claim-or-suffix}
- Fresh insert: attempt with the provided `tag`. On the SQLite tag-unique extended error (`SQLITE_CONSTRAINT_UNIQUE` naming `sessions_tag`), rewrite `tag → "{base}-{n}"` (n from 2) and retry, bounded (e.g. 50 tries) — then give up to `NULL` rather than fail the spawn.
- Conflict-on-`session_id` branch (resume/respawn): `tag = COALESCE(sessions.tag, excluded.tag)` — a set tag is preserved, a NULL one is backfilled ([P06]). The `DO UPDATE` never triggers the unique index because the row's own tag is unchanged.

---

### Specification {#specification}

- **Data model:** `sessions.tag TEXT NULL`, unique via `sessions_tag` index (NULLs distinct). `SessionRow.tag: Option<String>` (Rust) / `tag: string | null` (TS).
- **Wire additions:** `spawn_session` payload gains optional `tag: string`. `session_updated.fields` and every `list_sessions_ok` row gain `tag`. No new message *type*.
- **Tag grammar:** `^[a-z]{4,6}-[a-z]{4,5}(-\d+)?$` (adjective-noun, optional numeric suffix).
- **Uniqueness:** per-ledger, permanent (never recycled).
- **Precedence (display):** name (`name_user_set`) → tag → truncated UUID.
- **Not supported:** cross-machine uniqueness; tag mutation (`/retag`) in v1; tag in claude spawn args.

#### State Zone Mapping (tugdeck/tugways) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| `sessionTagStore` (`session_id → tag`, plus `tag → session_id` reverse) | external data | module-singleton store + `useSyncExternalStore` | [L02] |
| Tag rendered in Z4B chip / session rows | derived render | read store/`SessionRow` via `useSyncExternalStore`; plain text content (not a CSS class) | [L02] (not [L06]) |
| `/resume` overlay filter query text | transient local UI | `useState` in the overlay component | local-data (useState) |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/session-tag.ts` | Pure `mintTag` + `resolveTag` (Spec S01). No React/DOM. |
| `tugdeck/src/lib/session-tag-store.ts` | `sessionTagStore`: `session_id → tag` + reverse map, `useSyncExternalStore`-compatible (mirror `session-name-store.ts`). |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `sessions.tag` + `sessions_tag` index | schema | `session_ledger.rs` (CREATE TABLE + `migrate_sessions_add_tag`) | [P02]; plain column + unique index |
| `SessionRow.tag` | struct field | `session_ledger.rs` | `Option<String>`; keep in lockstep with TS |
| `record_spawn` | fn signature + body | `session_ledger.rs` | add `tag` arg; claim-or-suffix (Spec S02); `COALESCE` on conflict |
| SELECTs that build `SessionRow` | SQL | `session_ledger.rs` (list/read paths) | add `tag` to column lists |
| `LedgerEntry.tag` | struct field | `agent_supervisor.rs` | `Option<String>`; `LedgerEntry::new` → `None` |
| `parse_spawn_session_payload` | fn | `agent_supervisor.rs` | parse optional `tag` |
| `do_spawn_session` | fn | `agent_supervisor.rs` | set `entry.tag` on fresh insert; preserve on reconnect |
| `SessionRecord.tag` | struct field | `agent_supervisor.rs` | `Option<&str>` |
| `build_session_updated_frame` | fn | `agent_supervisor.rs` | serialize `tag` |
| `SessionRecord { … }` construction | call site | `agent_bridge.rs` | pass `entry.tag` |
| `SessionRow.tag` / `normalizeSessionRow` | interface + fn | `protocol.ts` | `string \| null`; default `null` for older tugcast |
| `encodeSpawnSession` | fn | `protocol.ts` | optional `tag` in payload |
| `decodeSessionUpdated` | fn | `protocol.ts` | `tag` flows through `fields` |
| `sendSpawnSession` | fn | `session-lifecycle.ts` | add `tag` param → `encodeSpawnSession` |
| `sessionChipDisplay`, `sessionRowTitle` | fn | `session-name.ts` | add `tag` tier ([P01]) |
| `session_updated` / `list_sessions_ok` / bindings handlers | fn | `action-dispatch.ts` | set `sessionTagStore` (3 sites) |
| `DevSessionIdBadge` | component | `dev-session-id-badge.tsx` | subscribe `sessionTagStore`; pass tag to `sessionChipDisplay`; include tag in `copyValue` |
| picker/resume row + `/resume` filter | component | `dev-picker-cells.tsx`, `resume-sheet.tsx` | pass `row.tag`; add tag-matching filter |
| spawn mint sites | call sites | `dev-card.tsx`, `dev-session-restore.ts`, `resume-sheet.tsx` | mint provisional tag; optimistic store set; thread through `sendSpawnSession` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (Rust)** | `record_spawn` tag claim, suffix-on-collision, COALESCE-preserve-on-resume, backfill-NULL-on-resume | `session_ledger.rs` tests, real sqlite |
| **Unit (TS)** | `mintTag` re-roll + suffix-free grammar, `resolveTag` hit/miss, `sessionChipDisplay`/`sessionRowTitle` precedence, `normalizeSessionRow` default | pure modules, no DOM |
| **Contract** | `session_updated`/`list_sessions_ok` carry `tag` end to end (Rust build → TS decode) | supervisor round-trip test |
| **App-test** | A newly spawned card shows a tag chip; the `/resume` filter narrows the list | `just app-test`, short interactions only |

#### What stays out of tests {#test-non-goals}

- **Full mint→server-echo→resume→re-resume UI round-trip** — the app-test replay workspace is transient (~2s); cover the round-trip at the Rust ledger layer + pure-TS units instead ([reference: app-test transient workspace]).
- **Mock-store / jsdom render assertion tests** — banned; drive the real pure functions and the real app.
- **The lexicon contents** — already validated at generation; not re-tested here.

---

### Execution Steps {#execution-steps}

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Ledger: `tag` column, migration, `record_spawn` claim | pending | — |
| #step-2 | Supervisor/bridge/protocol: carry + emit the tag | pending | — |
| #step-3 | TS wire: `SessionRow.tag`, spawn/echo plumbing | pending | — |
| #step-4 | TS pure logic: mint, resolve, store, precedence | pending | — |
| #step-5 | TS ingestion + client mint wiring | pending | — |
| #step-6 | Display + `/resume` tag filter | pending | — |
| #step-7 | Integration checkpoint | pending | — |

#### Step 1: Ledger — `tag` column, migration, `record_spawn` claim {#step-1}

**Commit:** `tugcast(session-tags): sessions.tag column + record_spawn claim-or-suffix`

**References:** [P02] Ledger registry, [P03] Mint ownership, [P06] Lazy backfill, Spec S02, Risk R01, (#flow-spawn-to-ledger)

**Artifacts:** `sessions.tag` column + `sessions_tag` unique index; `migrate_sessions_add_tag`; `SessionRow.tag`; `record_spawn(tag)`.

**Tasks:**
- [ ] Add `tag TEXT` to the `sessions` `CREATE TABLE` and `CREATE UNIQUE INDEX IF NOT EXISTS sessions_tag ON sessions(tag)` (both the fresh-DB path and via migration).
- [ ] Add `migrate_sessions_add_tag` mirroring `migrate_sessions_add_name_user_set` (self-healing `table_columns` guard → `ALTER TABLE sessions ADD COLUMN tag TEXT`, then create the unique index); call it beside the other `migrate_sessions_*` calls.
- [ ] Add `pub tag: Option<String>` to `SessionRow`; add `tag` to every SELECT column list that builds a `SessionRow`.
- [ ] Add a `tag: Option<&str>` parameter to `record_spawn`; set it on fresh insert with the claim-or-suffix loop (Spec S02); `COALESCE(sessions.tag, excluded.tag)` on the `ON CONFLICT(session_id)` branch.

**Tests:**
- [ ] `record_spawn` inserts a live row carrying the given tag.
- [ ] Inserting a second session with a taken tag yields a `-2` suffix (unique index holds).
- [ ] Respawn preserves an existing tag; resuming a NULL-tag row backfills the provided tag.
- [ ] Two NULL-tag rows coexist (NULLs distinct in the unique index).

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast session_ledger`

#### Step 2: Supervisor/bridge/protocol — carry + emit the tag {#step-2}

**Depends on:** #step-1

**Commit:** `tugcast(session-tags): carry tag on LedgerEntry and emit on SessionRow`

**References:** [P04] Optimistic echo, [P07] Tug-side only, (#flow-spawn-to-ledger)

**Artifacts:** `LedgerEntry.tag`, `SessionRecord.tag`, `parse_spawn_session_payload` tag, `do_spawn_session` set, `build_session_updated_frame` tag, `agent_bridge` pass-through.

**Tasks:**
- [ ] Add `tag: Option<String>` to `LedgerEntry` (`LedgerEntry::new` → `None`); parse `tag` in `parse_spawn_session_payload`; in `do_spawn_session` set `entry.tag` on the fresh path and leave it on reconnect (mirror `permission_mode`).
- [ ] Add `tag: Option<&str>` to `SessionRecord`; in `agent_bridge.rs`'s `session_init` promote block pass `entry.tag.as_deref()` into the `SessionRecord`, threaded to `record_spawn`.
- [ ] Add `tag` to `build_session_updated_frame`'s serialized fields.
- [ ] Do **not** forward the tag into the child spawn args ([P07]).

**Tests:**
- [ ] A supervisor test: a `spawn_session` frame carrying a tag persists it and the emitted `session_updated` frame contains it.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

#### Step 3: TS wire — `SessionRow.tag`, spawn/echo plumbing {#step-3}

**Depends on:** #step-2

**Commit:** `tugdeck(session-tags): tag on SessionRow + spawn_session frame`

**References:** [P04] Optimistic echo, (#precedence-store)

**Artifacts:** `SessionRow.tag`, `normalizeSessionRow` default, `encodeSpawnSession`/`sendSpawnSession` tag, `decodeSessionUpdated` passthrough.

**Tasks:**
- [ ] Add `tag: string | null` to the `SessionRow` interface (with the lockstep doc comment); default it to `null` in `normalizeSessionRow` (older tugcast omits it).
- [ ] Add an optional `tag` to `encodeSpawnSession`'s payload (mirror `permission_mode`) and a `tag` param to `sendSpawnSession`.
- [ ] Confirm `decodeSessionUpdated` carries `tag` through `fields` via `normalizeSessionRow` (no separate handling needed).

**Tests:**
- [ ] `normalizeSessionRow` yields `tag: null` when the field is absent and passes it through when present.
- [ ] `encodeSpawnSession` includes `tag` only when provided.

**Checkpoint:**
- [ ] `cd tugdeck && bunx vite build`
- [ ] `cd tugdeck && bun test session` (or the repo's unit runner for these modules)

#### Step 4: TS pure logic — mint, resolve, store, precedence {#step-4}

**Depends on:** #step-3

**Commit:** `tugdeck(session-tags): mint/resolve + tag store + display precedence`

**References:** [P01] Precedence, [P03] Mint ownership, [P05] Addressing, Spec S01, (#precedence-store), (#state-zone-mapping)

**Artifacts:** `session-tag.ts` (`mintTag`, `resolveTag`), `session-tag-store.ts`, updated `sessionChipDisplay`/`sessionRowTitle`.

**Tasks:**
- [ ] Create `session-tag.ts` consuming `TAG_ADJECTIVES`/`TAG_NOUNS`: `mintTag(known, rng?)` (re-roll ≤ cap, else last candidate) and `resolveTag(typed, rows)` (Spec S01).
- [ ] Create `session-tag-store.ts` mirroring `session-name-store.ts` — a `Map<session_id, string>` plus a `tag → session_id` reverse map, `subscribe`/`getTag`/`setTag`, no-op-when-unchanged.
- [ ] Add a `tag` parameter to `sessionChipDisplay` and `sessionRowTitle` in `session-name.ts` implementing name → tag → fallback ([P01]); update the doc comments.

**Tests:**
- [ ] `mintTag` returns grammar-valid tags and re-rolls away from a `known` set (seeded `rng`).
- [ ] `resolveTag` returns the matching `session_id` and `null` on miss (case/trim-insensitive).
- [ ] `sessionChipDisplay`/`sessionRowTitle` precedence: name wins; tag when unnamed; UUID/prompt when tagless.

**Checkpoint:**
- [ ] `cd tugdeck && bunx vite build`
- [ ] unit tests for the three pure modules pass.

#### Step 5: TS ingestion + client mint wiring {#step-5}

**Depends on:** #step-4

**Commit:** `tugdeck(session-tags): ingest tag + mint provisional at spawn`

**References:** [P04] Optimistic echo, [P06] Lazy backfill, (#flow-spawn-to-ledger)

**Artifacts:** tag ingestion in `action-dispatch.ts` (3 sites); provisional mint + optimistic store set at every client spawn site, threaded through `sendSpawnSession`.

**Tasks:**
- [ ] In `action-dispatch.ts`, set `sessionTagStore` from `row.tag` at the `session_updated`, `list_sessions_ok`, and card-bindings handlers (beside the existing `sessionNameStore.setName` calls).
- [ ] At each spawn mint site — `dev-card.tsx` (`submitWith` new + `/clear`), `dev-session-restore.ts` (restore-as-new + resume), `resume-sheet.tsx` (resume-as-new) — mint a provisional tag via `mintTag(known)` where `known` is the set of tags currently in `sessionTagStore`; set it optimistically; pass it through `sendSpawnSession`. On a resume whose row already has a tag, reuse that tag rather than minting; on a legacy tagless resume, mint one ([P06]).

**Tests:**
- [ ] App-test: spawning a new card yields a tag on its chip (short interaction).

**Checkpoint:**
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test`

#### Step 6: Display + `/resume` tag filter {#step-6}

**Depends on:** #step-5

**Commit:** `tugdeck(session-tags): show tag on chip/rows + /resume filter`

**References:** [P01] Precedence, [P05] Addressing, [Q04] Chip display, (#state-zone-mapping)

**Artifacts:** `DevSessionIdBadge` tag; picker/resume row tag; `/resume` overlay filter matching tag/name/prompt.

**Tasks:**
- [ ] In `dev-session-id-badge.tsx` subscribe `sessionTagStore` by `tugSessionId` and pass the tag to `sessionChipDisplay(name, tag, tugSessionId)`; include the tag in `copyValue` (the addressable handle).
- [ ] In `dev-picker-cells.tsx` pass `row.tag` to `sessionRowTitle`; render the tag on each row (compose an existing `Tug*` element — do not hand-roll).
- [ ] Add a filter field to the `/resume` overlay (`resume-sheet.tsx`) composing an existing `Tug*` text input (`useState` for the query, [L06]/substrate responders as needed); filter the listed rows on tag (and name/prompt). A non-matching query shows an empty list and fires nothing.

**Tests:**
- [ ] App-test: the `/resume` filter narrows the list when a tag substring is typed.
- [ ] Unit: the row-filter predicate matches on tag, name, and prompt.

**Checkpoint:**
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test`

#### Step 7: Integration Checkpoint {#step-7}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** [P01]–[P07], (#success-criteria)

**Tasks:**
- [ ] Verify end to end: spawn a new session → provisional tag shows on the chip from the drop → the server-echoed authoritative tag matches (or is a suffixed variant) → the tag appears in the `/resume` list → filtering by the tag narrows to that session → resuming a legacy tagless session backfills a tag that then persists across a re-resume.

**Tests:**
- [ ] The Success Criteria (#success-criteria) all hold.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run`
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Every new Dev card session is fronted by a unique, mnemonic `adjective-noun` tag — shown on the chip and in the session lists, typable to filter/address the session in `/resume`, stored authoritatively in the ledger, and layered non-destructively over the UUID and the `/rename` name.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] New sessions show a grammar-valid tag on the chip before the first turn.
- [ ] Tags are unique per ledger (suffix-on-collision proven by a Rust unit test) and survive resume / app restart.
- [ ] Precedence name → tag → UUID holds across chip and session rows.
- [ ] The `/resume` filter matches tags; a legacy session gains a tag on resume.
- [ ] `cargo nextest run` (with `-D warnings`), `bunx vite build`, and `just app-test` all pass.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] `/retag` reroll command (rename-style CONTROL verb writing a fresh unique tag) ([Q03]).
- [ ] A standalone `/resume <tag>` typed command driven by `resolveTag` ([Q02]).
- [ ] Optional eager backfill sweep for legacy rows, if ever desired ([P06]).

| Checkpoint | Verification |
|------------|--------------|
| Ledger tag storage + uniqueness | `cargo nextest run -p tugcast session_ledger` |
| Wire + pure logic | `bunx vite build` + pure-module unit tests |
| End-to-end tag from the drop + addressing | `just app-test` + manual verification (#success-criteria) |
