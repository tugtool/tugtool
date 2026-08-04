## Changes Rework — Batch Claim, Disclaim, Row Polish, and Hunk-Level Changes {#changes-rework}

**Purpose:** Expand the Changes system in three parts: (1) tighten the claim verb into a true atomic batch, add its inverse (*disclaim*), and polish the row affordances (icons, metadata divider); (2) teach the changes engine to stage and land *portions* of files (hunk-level selection over `git apply --cached`); (3) capture sub-file edit evidence (spans) and make SHARED contention hunk-aware, so disjoint edits to one file by two sessions no longer contend.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main (three separate dash passes; see #strategy) |
| Last updated | 2026-08-04 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Changes system (tuglaws/tracking-changes.md, [D112]) tracks per-session file attribution in the machine-global `changes.db` and lands work through `tugutil`/tugcast verbs. Three pressures motivate this plan. First, the claim verb's interface is asymmetric and slightly dishonest: `CLAIM ALL` already sends one batched wire request, but the server loops N independent journaled inserts, so a partial failure leaves a half-claimed batch surfaced only as a "shortfall" error; and there is no way to *remove* a file from a session's claims at all — the only ownership-removal primitive (`sever_file_ownership_except`) fires solely as a side effect of someone else claiming. Second, small row-rendering inconsistencies: the vertical divider before the attribution text is a CSS `border-left` that only the provenance span carries, so `shared`-badge-only and hint-only rows render without it; and the claim icon is `CornerUpLeft` where the desired vocabulary is `corner-down-left` (claim) / `corner-up-right` (disclaim). Third — the big one — the engine is strictly whole-file: staging is `git add -- <files>` by written contract (`tugchanges-core/src/commit.rs`), SHARED is a pure path-string match over proof rows, and the ledger records no sub-file granularity anywhere. Most cross-session overlaps are file-level coincidences (two sessions touching disjoint parts of one file), so file-level SHARED over-warns and over-excludes. Hunk-level staging plus hunk-aware contention cuts SHARED down to true overlaps while keeping file-level support for the overlaps that are real.

No interactivity is needed for any of this: `git add -p` is a prompting UI over patch surgery, and the non-interactive equivalent — filter the diff to selected hunks, feed it to `git apply --cached` — is fully scriptable. The shell supplement this plan ships is therefore *steering and verbs*, not a PTY ([P13], upholding [D111] "No TTY emulator").

#### Strategy {#strategy}

- Three parts, three dash passes, one plan. Each part ends at an integration-checkpoint step and is independently landable: **M01** (steps 1–5) claim/disclaim/polish; **M02** (steps 6–11) hunk-level selection and landing; **M03** (steps 12–16) span capture and hunk-aware SHARED.
- Mechanics before attribution: M02 ships the hunk model, partial staging, and the hunk-picker UI with *manual* election (which alone softens SHARED pain — a shared file stops being all-or-nothing); M03 then makes the engine *know* whose hunks are whose.
- Respect the existing doctrine at every step: proof decides, correlation suggests; degradation is always toward `unattributed` (visible, never falsely claimed); a dirty file is never invisible; spans **annotate**, `git diff` **decides** — the same two-layer split one level down.
- Avoid the `changes.db` schema gate until it is truly needed: M01 and M02 are schema-free (new journal records, the free-form `changeset_drafts.selection` TEXT, additive wire fields). Only M03 bumps `CHANGES_SCHEMA_VERSION` to 2, with a purely additive new table.
- One implementation per rule: hunk identity is computed in Rust only and served to the deck ([P06]); the hunk-overlap decision lives in tugchanges-core and is consumed by both readers ([P14]) so the two SHARED implementations cannot fork.

#### Success Criteria (Measurable) {#success-criteria}

- A `CLAIM ALL` of N files writes one `fe_batch` journal record and either claims the whole batch or none of it; `changeset_claim_ok.claimed` is the batch size *after* `repo_relative_key` mapping (outside-repo paths are skipped-and-warned before the batch, today's behavior) or `0` (Rust unit test on the ledger + supervisor test).
- A per-row Disclaim on an attributed file removes it from the session's changeset on the next aggregate recompute; the file reappears as `unattributed` (or the other claimant becomes sole owner if it was shared). Verified by a `tugutil changes disclaim` CLI round trip and an app-test.
- Every changes-list row with any trailing metadata (badge, provenance, or hint) renders exactly one leading divider; rows with none render none (visual check + app-test DOM assertion on the wrapper class).
- Claim renders `corner-down-left`, Disclaim renders `corner-up-right` (DOM assertion on the lucide class names).
- Landing a two-hunk file with one hunk elected commits exactly that hunk's lines (`git show HEAD` contains it, working tree still carries the other) and the receipt's `left_behind` machinery still accounts for every dirty path (Rust integration test in `commit.rs`).
- With spans captured, two sessions editing disjoint regions of one file show **no** SHARED badge and each session's default landing takes its own hunks; two sessions editing the same region still show SHARED (Rust test seeding two sessions' span rows).
- `cargo nextest run` green, `bunx vite build` green, `just app-test-changed` green at each part's integration checkpoint.

#### Scope {#scope}

1. Atomic batch claim (one journal record, all-or-nothing).
2. Disclaim verb end-to-end: journal record, ledger delete, supervisor CONTROL verb, HTTP bridge, `tugutil changes disclaim`, deck store/controller/row affordance.
3. Icon swap (claim → `CornerDownLeft`, disclaim → `CornerUpRight`) and the single-divider metadata wrapper.
4. Hunk model in tugchanges-core: parse, stable identity, filtered-patch builder.
5. Hunk-level election in the draft selection, per-hunk checkboxes in the inline diff, partial staging in `commit`, wire plumbing (`changeset_commit.hunks`), `tugutil commit --hunks`.
6. `tugutil file stage` (non-interactive index staging verb) and shell-route steering for interactive `-p` git invocations.
7. `changes.file_event_spans` table (schema v2), span capture for exact tools and `tugutil file edit` receipts, hunk-aware SHARED in both readers, contested-hunk UI.

#### Non-goals (Explicitly out of scope) {#non-goals}

- No PTY, terminal emulator, or interactive shell tunnel — [D111] stands; the shell supplement is steering + verbs only ([P13]).
- No carry-forward re-minting of ledger rows for the un-landed remainder of a partial commit — deferred with rationale ([Q02], [P08]).
- No span capture for `bash`/`turn` bracket rows or parsed `cmd` rows — correlation evidence stays whole-file ([Q03]).
- No change to the dash-lane `tugutil dash join` path (`tugdash-core/src/ops.rs` `commit_worktree_dirt` stays `git add -A`); hunk election is a main-lane landing feature.
- No "Disclaim all" bulk button (the wire takes `files[]`, so it is a later affordance, not a later protocol).
- No line-level (sub-hunk) staging; hunks (with git's own splitting granularity) are the unit.

#### Dependencies / Prerequisites {#dependencies}

- M02 steps depend on M01 only for repo state (no functional coupling); M03 depends on M02's hunk model (`tugchanges-core::hunks`) and hunk-id spec (Spec S02).
- The implementing session must rebuild all `tug*` binaries after M03's schema bump — an older binary on the machine loses shared-table write access by design (see #rollout).

#### Constraints {#constraints}

- **WARNINGS ARE ERRORS** (`-D warnings` workspace-wide).
- `changes.db` is machine-global with concurrent writers at potentially different binary versions; the `changes.*` tables are exempt from drift-rebuild and governed by the `user_version` gate (`session_ledger.rs::bootstrap_changes_schema`). Schema changes go through `CHANGES_SCHEMA_VERSION` + `CHANGES_MIGRATIONS` only.
- Never open live ledger DBs with a foreign sqlite3; use `just db-inspect`.
- Frontend laws: [L02] external state via `useSyncExternalStore` only; [L06] appearance via CSS/DOM; verify tugdeck changes with `bunx vite build`; app-tests via `just app-test-changed`.
- All git operations shell out (`tugchanges-core/src/git.rs::git_output/git_stdout`); no git2/gix anywhere — keep it that way.

#### Assumptions {#assumptions}

- Single-machine deployment: the schema-v2 lockout of older binaries is a rebuild, not a rollout problem.
- The index is clean under normal Tug operation (only Tug lands; raw git is read-only spelunking by policy), so the partial-staging index-clean precondition ([P07]) refuses rarely and loudly.
- The Session card commit button's existing `--paths`-style bypass continues to define the card lane; hunk election rides the same `changeset_commit` verb additively.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Hunk identity normalization (DECIDED — see [P06]) {#q01-hunk-identity}

**Question:** What makes a hunk's id stable across re-diffs and between server and deck?

**Why it matters:** Draft selections and span anchors reference hunks by id; an unstable id silently orphans elections, and a deck-side re-derivation could disagree with Rust.

**Resolution:** DECIDED (see [P06]): the id is a content hash over the hunk's body lines only (the `-`/`+`/context lines, byte-exact, excluding the `@@` header), computed in Rust and served to the deck. Line-number drift from *other* hunks changing does not move the id; any change to the hunk's own content does — which is exactly when a stale election must be refused.

#### [Q02] Carry-forward rows for a partial commit's remainder (DEFERRED) {#q02-carry-forward}

**Question:** A partial commit spends every ledger row on the path (liveness is per-path `git log -1`), so the un-landed remainder's evidence dies — should the engine re-mint rows for the remainder's owner at land time?

**Why it matters:** After session A lands its hunks of a shared file, session B's surviving hunks degrade to `unattributed`.

**Resolution:** DEFERRED ([P08]): degradation toward `unattributed` is the doctrine's blessed failure direction (visible, never falsely claimed), and B's hunks remain electable by hand. Revisit after M03 ships if the degradation annoys in practice; the mechanism would be a server-side re-mint at land time (same trust class as `sever_file_ownership_except`, which already crosses sessions server-side).

#### [Q03] Spans for correlation-class evidence (DEFERRED) {#q03-correlation-spans}

**Question:** Should `bash`/`turn` bracket rows or parsed `cmd` rows carry spans?

**Resolution:** DEFERRED: a bracket delta is a whole-tree fingerprint with no sub-file information, and a parsed command names files, not regions. Span-less evidence widens to a whole-file claim by rule ([P12]) — conservative, matching today's behavior exactly.

#### [Q04] Disclaim semantics on a shared file (DECIDED — see [P02]) {#q04-disclaim-shared}

**Question:** What does disclaiming a file another session also holds do?

**Resolution:** DECIDED (see [P02]): disclaim deletes only the *requesting* session's rows. If another session holds live proof rows it becomes the sole owner (the file leaves both sessions' SHARED state); otherwise the file degrades to `unattributed`. This makes disclaim the graceful one-click resolution of a SHARED file in the other party's favor.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Journal record variants unknown to older builds (R01) | med | low | single-machine rebuild; deletes stay shape-safe | multi-instance mixed-version use |
| Schema-v2 lockout of stale binaries (R02) | med | med | rebuild all binaries in the M03 pass; sidecar + gate already refuse safely | a stale dash-worktree build writing |
| Anchor false positives mis-assigning a hunk (R03) | high | low | exact-content matching first, widen-to-file on any ambiguity ([P12]) | any observed wrong per-hunk ownership |
| Dual-reader SHARED drift (R04) | med | med | extract the overlap decision into tugchanges-core, consumed by both ([P14]) | any new third reader |
| Index-clean precondition trips on hand-staged work (R05) | low | low | typed refusal naming the staged paths; raw git is read-only by policy anyway | recurring refusals in practice |

**Risk R01: Journal-format forward compatibility** {#r01-journal-compat}

- **Risk:** `changes_journal.rs` deserializes records with `serde_json::from_str::<Record>` — a build without the new `fe_batch`/`fe_disclaim` variants fails to parse those lines during replay/forwarding.
- **Mitigation:** the journal replay already counts and warns on failed lines rather than aborting; this is a single-machine deployment where all binaries rebuild together; `Record::shapes_rows` classifies Disclaim as a delete, which stays allowed even when the version gate locks a build out of shaping rows.
- **Residual risk:** a mixed-version window mid-pass can drop batch/disclaim records on the older side; acceptable for the duration of a dash pass.

**Risk R03: Anchor mis-match** {#r03-anchor-mismatch}

- **Risk:** content-anchor matching assigns a hunk to the wrong session (e.g. two sessions inserted identical text).
- **Mitigation:** identical insertions genuinely are contested — matching both sessions marks the hunk shared, which is the *correct* reading; any anchor that matches zero hunks or matches ambiguously widens that session's claim to the whole file ([P12]), reproducing today's file-level behavior. The failure direction is over-report of SHARED, never a false sole claim.
- **Residual risk:** more SHARED badges than theoretically minimal; never fewer than correct.

---

### Design Decisions {#design-decisions}

#### [P01] Batch claim is one journal record, all-or-nothing (DECIDED) {#p01-batch-claim-atomic}

**Decision:** `do_changeset_claim` writes one `Record::FileEventBatch { rows }` journal record applied in a single SQLite transaction, replacing the per-row `record_file_event` loop.

**Rationale:**
- One user gesture should be one durable record — atomic on disk, atomic in replay, one forwarder unit.
- The current loop's partial-failure mode is only surfaced as a deck-side "shortfall" heuristic (`claimShortfallDetail` in `changeset-verb-store.ts`); all-or-nothing makes the receipt honest by construction.

**Implications:**
- New `Record` variant (serde tag `"fe_batch"`, `shapes_rows() == true`); `SessionLedger::record_file_events(&[FileEventRow])`; `apply_journal_record` loops `insert_file_event` inside the one record's application (the applier already runs each record on one connection — wrap in an explicit transaction).
- `changeset_claim_ok.claimed` becomes `N` or `0`; the deck's shortfall path remains as a guard but should no longer fire for partial writes.

#### [P02] Disclaim deletes the requesting session's rows; degradation is toward unattributed (DECIDED) {#p02-disclaim-semantics}

**Decision:** `changeset_disclaim { project_dir, session_id, files }` deletes **all** of the named session's `file_events` rows (proof and bracket alike) for the given repo-relative paths in the given project, via a journaled `Record::Disclaim`.

**Rationale:**
- Deleting only proof rows would leave the session's own bracket rows hinting `likely` on the file it just renounced — a resting lie.
- Follows invariant 7's degradation direction and [Q04]'s shared-file resolution.

**Implications:**
- Serde tag `"fe_disclaim"`, `shapes_rows() == false` (a delete — permitted even under the version-gate lockout, like `Sever`).
- SQL mirrors `sever_file_ownership_sql` with `tug_session_id = ?` instead of `!=`.
- Reply `changeset_disclaim_ok { project_dir, disclaimed }` / `changeset_disclaim_err { project_dir, detail }`; guards identical to claim (open project, ledger present, `repo_relative_key` mapping with skip-and-warn).

#### [P03] Disclaim is a first-class verb at every layer claim exists (DECIDED) {#p03-disclaim-parity}

**Decision:** Disclaim ships with wire verb, HTTP bridge (free via the `changeset_` prefix in `server.rs`), `tugutil changes disclaim`, verb-store round-trip state, controller method, and a per-row card affordance — full parity with claim.

**Rationale:** "One verb owner; the CLI is the API" (tracking-changes.md) — a UI-only disclaim would be a dead end for skills and scripts.

**Implications:** New `run_disclaim` in `tugutil/src/changes.rs` mirroring `run_claim`; new CLI subcommand; deck store keys disclaim state by initiating card entry exactly as claim does.

#### [P04] Icon vocabulary: claim = CornerDownLeft, disclaim = CornerUpRight (DECIDED) {#p04-icons}

**Decision:** Both the per-row claim button and the `Claim all` button render `<CornerDownLeft size={12} />`; disclaim renders `<CornerUpRight size={12} />`.

**Rationale:** User-specified vocabulary; both icons exist in the installed `lucide-react` set as direct imports (no registration step).

**Implications:** Replace the `CornerUpLeft` import/uses in `tug-changes-list.tsx`.

#### [P05] One metadata divider, carried by a wrapper (DECIDED) {#p05-metadata-divider}

**Decision:** `FileIdentity` wraps the `shared` badge, provenance, and hint spans in a single `.tug-changes-list-file-meta` span; the `border-left: 1px solid var(--tug7-element-global-border-normal-muted-rest)` + `padding-left: var(--tug-space-md)` move from `.tug-changes-list-file-provenance` to the wrapper, rendered only when at least one child exists.

**Rationale:** The divider is a separator between the file name and its metadata cluster, not a property of one metadata kind; a wrapper guarantees exactly one divider regardless of which children render.

**Implications:** The wrapper carries `display: inline-flex; gap: 8px; align-items: baseline;` so intra-cluster spacing survives; the provenance rule keeps its typography only.

#### [P06] Hunk identity is a Rust-computed content hash, served to the deck (DECIDED) {#p06-hunk-identity}

**Decision:** A hunk's id is a hex-truncated SHA-256 over its body lines (every `-`/`+`/space line of the hunk, byte-exact, newline-joined; the `@@` header excluded), computed only in `tugchanges-core::hunks`; the deck receives ids alongside diff text and never re-derives them.

**Rationale:** [Q01]; one implementation means the deck's checkbox, the draft's election, and the commit's filter can never disagree; excluding the header makes the id immune to unrelated hunks shifting line numbers, while any content change invalidates the election — precisely the drift-refusal we want.

**Implications:** Duplicate ids within one file (two identical hunks) are disambiguated by an ordinal suffix (`<hash>#2`); the filtered-patch builder and the selection both use the suffixed form.

#### [P07] Partial staging = `git apply --cached` on a filtered patch; commit from the index; index-clean precondition (DECIDED) {#p07-partial-staging}

**Decision:** When any file in the landing carries a hunk election, `stage_and_commit` switches modes: refuse unless `git diff --cached --quiet` reports a clean index (typed error naming the staged paths); stage whole-file selections with `git add --`; stage partial files by rebuilding a unified diff of only the elected hunks (new-side `@@` start offsets recomputed by cumulative delta over included hunks) and piping it to `git apply --cached`; then `git commit -m <msg>` **without a pathspec**. The per-file diff runs with `--no-ext-diff` (an external diff driver would break both the patch and id agreement with the wire's ids, which assume default `-U3` context on both sides).

**Rationale:**
- `git commit -- <paths>` commits *working-tree* content for those paths, which would drag unselected hunks in — the pathspec form is structurally incompatible with partial staging.
- The index-clean precondition keeps "the commit is exactly what was staged" true by construction, the same receipt-honesty contract the current pathspec form provides.
- Recomputing offsets ourselves (rather than `git apply --recount`) keeps the patch well-formed and the failure mode a loud refusal, not a fuzzy match.

**Implications:**
- `CommitOptions` gains `hunks: Option<BTreeMap<String, Vec<String>>>` (path → elected hunk ids); empty/absent map preserves today's pathspec path byte-for-byte.
- A selected hunk id absent from the file's current diff is a typed refusal (`CommitError::HunkDrift { path, ids }`) — nothing staged, nothing committed.
- **Created/untracked files are whole-file only.** The deck's diff wire *synthesizes* a new-file unified diff for untracked paths (`feeds/git.rs`), but the engine's partial branch parses `git diff --no-color -- <path>`, which emits nothing for an untracked file — any election on one is a guaranteed drift refusal. The engine rejects `hunks` keys naming untracked/created paths with a typed error, and the UI (Step 9) renders no hunk controls on them.
- On any failure after staging began, the engine runs `git reset -- <all staged paths>` (the whole-file subset ∪ the partial paths) before returning, so a refusal never leaves a half-staged index — resetting only the partial paths would leave the `git add`-staged whole files tripping the *next* attempt's index-clean precondition on our own residue.
- The `with_rename_sources` staged-rename handling applies to the whole-file subset only.

#### [P08] A partial commit spends the whole path's rows; the remainder degrades (DECIDED) {#p08-partial-spends-path}

**Decision:** No change to row liveness (`min_live_at_ms` stays per-path); the un-landed remainder of a partially-committed file surfaces as `unattributed` afterward.

**Rationale:** [Q02]; matches invariant 7's degradation direction; a carry-forward mechanism is recorded as a follow-on, not built speculatively.

#### [P09] Hunk elections ride the draft selection TEXT (DECIDED) {#p09-selection-hunks}

**Decision:** `ChangesetDraftSelection` (deck `changeset-types.ts`; server-side an opaque free-form TEXT column `changeset_drafts.selection`) gains `hunks?: { [path: string]: string[] }` — per-path elected hunk ids, meaningful only when the path is in the landing set.

**Rationale:** The selection column is already free-form and machine-global; no schema change, no version bump, and the "no resting lies" rule is satisfied by writing the selection on every checkbox settle exactly as file dispositions do today.

#### [P10] Spans are a new additive table under schema v2; spans annotate, git diff decides (DECIDED) {#p10-spans-table}

**Decision:** M03 adds `changes.file_event_spans` keyed `(tug_session_id, tool_use_id, file_path, seq)` with `kind` and `anchor` columns; `CHANGES_SCHEMA_VERSION` goes to 2 with a registered `CHANGES_MIGRATIONS` entry; `file_events` itself is untouched.

**Rationale:** SHARED is computed from the machine-global ledger by two readers — hunk evidence must live where they read or the readers fork; a new table keeps the migration a single additive `CREATE TABLE` and leaves every existing row and reader working unmodified during the transition.

**Implications:** All the bump's satellite edits (see #rollout); span writes ride the existing `Record::FileEvent` journal record extended with a `#[serde(default)] spans: Vec<FileEventSpan>` field, so old journal lines still parse.

#### [P11] Anchors are content, never line numbers (DECIDED) {#p11-content-anchors}

**Decision:** A span anchor records what was written, not where: for `Edit`/`MultiEdit`, the SHA-256 and a size-capped head excerpt of each `new_string` (and `old_string` hash for replacements); for `Write`/`NotebookEdit`, the single anchor kind `whole`; for `tugutil file edit --patch`, the applied hunks' content hashes (the same identity as [P06]).

**Rationale:** Line numbers are dead the moment any other edit lands above them; content matches against the current diff's hunk bodies at read time regardless of drift.

#### [P12] SHARED is hunk-overlap only when every owner has spans; any span-less owner widens to file-level (DECIDED) {#p12-shared-widening}

**Decision:** For a path with ≥2 live proof owners: map each owner's anchors onto the file's current hunks; an owner with no spans, a `whole` anchor, or any unmatched/ambiguous anchor claims the whole file. `shared` is true iff two owners' claimed hunk sets intersect (a whole-file claim intersects everything). Per-owner hunk sets are surfaced so the UI can mark contested hunks and default-elect a session's own hunks.

**Rationale:** Conservative by construction — every widening reproduces today's exact behavior; the failure direction is over-report ([R03]), matching invariant 6's spirit.

#### [P13] The shell supplement is steering plus verbs, never a PTY (DECIDED) {#p13-shell-steering}

**Decision:** Interactive-only staging invocations (`git add|commit|stash|checkout|restore|reset` with `-p`/`--patch`/`--interactive`, and bare `git commit` with no `-m`) are detected at the deck's shell-routing layer and answered with a steering notice into the Changes shade instead of executing; agents get `tugutil file stage --patch` as the first-class non-interactive path.

**Rationale:** In the `$` route these commands read EOF from `</dev/null` and silently stage nothing (the worst outcome: a no-op that looks like success); [D111]'s block model is deliberate doctrine and the tmux probe was rejected on the record. The Session-card thesis is that the graphical surface replaces terminal interactivity — the hunk picker *is* our `git add -p`.

#### [P14] The overlap decision has one implementation (DECIDED) {#p14-one-overlap-impl}

**Decision:** The span→hunk matching and shared/sole verdict live in `tugchanges-core` (new `contention.rs` or within `hunks.rs`) as pure functions over `(hunks, per-session anchors)`; both `tugchanges-core::changes::compute_changes` and tugcast `feeds/changeset.rs` call it.

**Rationale:** The file-level SHARED rule already exists twice ("they must stay in sync" is a standing hazard); the hunk-level rule is too intricate to hand-mirror. tugcast already depends on tugchanges-core (`shell_ops`, diff parsing), so the dependency direction exists.

---

### Deep Dives {#deep-dives}

#### Current claim flow (verified) {#claim-flow}

Frontend: `tugdeck/src/components/tugways/tug-changes-list.tsx` renders per-row claim buttons (`data-testid="tug-changes-list-claim"`, icon `CornerUpLeft`) and section-header `Claim all` buttons (`tug-changes-list-claim-all-<kind>`) for the `unattributed` and `orphaned` entries; `cards/session-changes/session-changes-view.tsx` wires them to `ChangesRouteController.claim(paths)` (`lib/changes-route-controller.ts`), which calls `ChangesetVerbStore.claim(entryKey, projectDir, sessionId, files)` (`lib/changeset-verb-store.ts`) — one `changeset_claim` CONTROL frame with the whole `files[]`. Replies `changeset_claim_ok {project_dir, claimed}` / `changeset_claim_err {project_dir, detail}` correlate through a project→entry in-flight map; a `claimed < requested` reply is treated as an error (`claimShortfallDetail`). Errors surface via `cards/claim-error-notice-controller.tsx` (sticky danger bulletin).

Server: dispatch `"changeset_claim"` in `tugcast/src/feeds/agent_supervisor.rs` (`parse_changeset_claim_payload` → `do_changeset_claim`). Guards: project in `WorkspaceRegistry`, ledger present. One synthetic `tool_use_id = format!("claim:{at}")` groups the batch; per path, `repo_relative_key` maps (skip-and-warn outside the repo) and a `FileEventRow { tool_name: "Claim", op: "claimed", origin: "claim", ambiguous: false }` is written via `ledger.record_file_event` — **N separate journal records today**. Then `sever_file_ownership_except(canonical, &request.files, &request.session_id)` (one set-based DELETE, journaled as `Record::Sever`) and `changeset_all_bump().notify_one()`. The HTTP bridge in `tugcast/src/server.rs` routes any `changeset_*`-prefixed action POSTed to `/api/tell` into the same handler; `tugutil changes claim` (`tugutil/src/changes.rs::run_claim`) uses it.

Ledger: `tugcast/src/session_ledger.rs` — `record_file_event` wraps `Record::FileEvent` through `write_change` (journal append + `apply_journal_record`); `insert_file_event` is `INSERT … ON CONFLICT (tug_session_id, tool_use_id, file_path) DO NOTHING`. `apply_journal_record` is the single applier shared by live writes, forwarded writes, and journal replay — every new record variant is added there once. The `Record` enum lives in `tugcast/src/changes_journal.rs` with serde-renamed tags (`"fe"`, `"fe_sever"`, …) and a `shapes_rows()` classifier (deletes stay allowed under the version-gate lockout).

#### Current row rendering (verified) {#row-rendering}

`FileIdentity` in `tug-changes-list.tsx` renders, after `FilePathLink`: the `shared` badge (`.tug-changes-list-badge.tug-changes-list-badge-shared`, lowercase text uppercased by CSS), the provenance span (`.tug-changes-list-file-provenance`, text `` `${op} · ${origin}` `` — a middle dot, with `origin` suppressed for `dash`/`claim` rows), and the hint span (`.tug-changes-list-file-hint`, `likely` / `seen by N` / `from <owner>`). In `tug-changes-list.css`, only the provenance rule carries `padding-left` + `border-left` — the visible "pipe". The row container `.tug-changes-list-file-identity` is `inline-flex; gap: 8px`.

#### Current commit engine (verified) {#commit-engine}

`tugchanges-core/src/commit.rs`: `commit(opts)` → `derive_file_set` (the Table-T01 disposition matrix via pure `select_from_buckets`; `paths` bypasses bucketing — the Session card's `run_changeset_commit` in `tugcast/src/feeds/changeset.rs` always passes explicit `files`) → `stage_and_commit` (`git add -- <stageable>` then `git commit -m <msg> -- <files ∪ rename-sources>`; `stageable_paths` drops already-staged deletions, `with_rename_sources` adds staged-rename sources) → `build_receipt` (+ `left_behind` re-bucketing). `CommitError::UnattributedPresent` is the typed exit-3 refusal. All git runs through `tugchanges-core/src/git.rs::git_output/git_stdout` (`git -C <root> …`). The diff parser `git.rs::parse_unified_diff`/`parse_diff_chunk` already walks `@@` boundaries but discards headers (counts only); `DiffFile.unified` retains the verbatim per-file chunk text.

Existing patch machinery to reuse: `tugutil/src/commands/file_probe.rs` — `git_apply(patch, check_only)` (`git apply [--check] -` over stdin), `git_apply_stdout(patch, ["--numstat","-z"])`, and `patch_targets` (the union-of-numstat-and-headers protected-set rule); `tugutil/src/commands/file.rs::edit_by_patch` (validate `--check`, apply, receipt only files whose bytes moved).

#### Hunk-aware read side (M03 sketch) {#hunk-read-side}

`tugchanges-core/src/changes.rs::compute_changes` classifies each dirty path from live rows (`ledger.rs`: `PROOF_ORIGINS = ["exact","replay","claim","cmd"]`; `foreign_proof_sessions_for_path` = canonical-root match + `max_proof_at >= min_live_at_ms`); `shared = !foreign_proof.is_empty()`. tugcast `feeds/changeset.rs` composes the aggregate with its own `proof_owners: HashMap<path, HashSet<session>>` and marks `file.shared = true` when `len() > 1`. M03 inserts one step in both: when a path has ≥2 proof owners, load spans for the live rows, parse the path's current hunks (M02's module), call the shared tugchanges-core verdict fn ([P14]), and emit per-owner hunk sets alongside the boolean. The wire `ChangesetFile` (deck `lib/changeset-types.ts`) gains optional `own_hunks?: string[]` / `contested_hunks?: string[]` — additive, absent means file-level.

---

### Specification {#specification}

**Spec S01: Disclaim wire contract** {#s01-disclaim-wire}

Request (CONTROL frame or `POST /api/tell`): `{ "action": "changeset_disclaim", "project_dir": "<abs>", "session_id": "<tug session id>", "files": ["<repo-relative>", …] }` — all fields required, `files` non-empty. Replies: `{ "action": "changeset_disclaim_ok", "project_dir", "disclaimed": <n rows deleted> }` or `{ "action": "changeset_disclaim_err", "project_dir", "detail" }`. Guards and path mapping identical to claim (#claim-flow). Success fires the aggregate bump; the rows vanish from the session's entry on the next recompute (no client-side flip).

**Spec S02: Hunk model** {#s02-hunk-model}

`tugchanges-core/src/hunks.rs`: `pub struct Hunk { pub id: String, pub old_start: u32, pub old_lines: u32, pub new_start: u32, pub new_lines: u32, pub body: String }`; `pub fn parse_hunks(unified_diff_for_one_file: &str) -> Vec<Hunk>`; `pub fn hunk_id(body: &str) -> String` per [P06] (SHA-256 of body, hex, first 16 chars; ordinal suffix `#N` on within-file duplicates); `pub fn filtered_patch(file_header: &str, hunks: &[Hunk], selected: &BTreeSet<String>) -> Result<String, HunkDrift>` — emits the original `---`/`+++` header plus the selected hunks with new-side starts recomputed by cumulative delta over *included* hunks only; errors if any selected id is absent.

**Spec S03: `changeset_commit` hunks field** {#s03-commit-hunks}

The existing `changeset_commit { project_dir, files, message, session_name?, session_id? }` payload gains optional `"hunks": { "<repo-relative path>": ["<hunk id>", …], … }`. Every key must also appear in `files`. Absent/empty → today's behavior byte-for-byte. `run_changeset_commit` forwards it into `CommitOptions.hunks`; `tugutil commit` gains `--hunks <path-to-json|->` accepting the same map. Error replies reuse `changeset_commit_err.detail`; hunk drift produces `detail` beginning `hunk drift:` and naming path + ids.

**Spec S04: Spans schema and matching** {#s04-spans-schema}

```sql
CREATE TABLE IF NOT EXISTS changes.file_event_spans (
    tug_session_id TEXT NOT NULL,
    tool_use_id    TEXT NOT NULL,
    file_path      TEXT NOT NULL,
    seq            INTEGER NOT NULL,
    kind           TEXT NOT NULL,   -- 'whole' | 'insert' | 'replace' | 'hunk'
    anchor         TEXT NOT NULL,   -- JSON: {"new_hash","new_head","new_len","old_hash"?} or {"hunk_id"}
    PRIMARY KEY (tug_session_id, tool_use_id, file_path, seq)
);
```

Rows are children of a `file_events` row (same first three key columns); deletion follows the parent (Disclaim/Sever/DeleteSession delete from both tables). Matching at read time, per owner per anchor: `hunk` anchors match a current hunk by id equality; `insert`/`replace` anchors match a hunk whose added-line text contains the anchor's `new_head` and whose added-byte length is plausible for `new_len`, else by `new_hash` equality against the hunk's full added text; zero or >1 distinct-hunk matches → the owner widens to whole-file ([P12]). `new_head` is capped at 200 bytes, anchors per event at 32 (`whole` recorded beyond the cap).

**Spec S05: Receipt hunks extension** {#s05-receipt-hunks}

`TUG-FILE-RECEIPT` ops gain an optional additive field: `{"op":"modified","path":"/abs/x.ts","hunks":["<hunk id>", …]}` — the [P06] ids of the hunks `tugutil file edit --patch` actually applied. The relay's `parse_receipt_line` (`tugcast/src/feeds/attribution.rs`, which already ignores unknown fields) learns to read it and mint `kind='hunk'` span rows alongside the `cmd` file event. `tugutil file edit --replace` computes the resulting hunk post-substitution the same way.

#### State Zone Mapping (tugdeck/tugways) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| Disclaim round-trip (pending/error per entry) | external | `ChangesetVerbStore` + `useSyncExternalStore` (mirror of claim) | [L02] |
| Hunk checkbox elections | external (durable) | written to the draft selection via the existing draft write path on every toggle settle; read back through the changeset feed's draft snapshot | [L02] |
| Metadata divider, icon swap | appearance | CSS + JSX structure only | [L06] |
| Contested-hunk marking in the diff | appearance | CSS classes on hunk rows driven by server-supplied ids | [L06] |

---

### Compatibility / Migration / Rollout {#rollout}

- **M01/M02:** no schema changes. New journal record variants are forward-incompatible with older binaries' journal *replay* (Risk R01) — rebuild all `tug*` binaries when landing each pass (they land from one dash join, so this is the normal flow).
- **M03 schema bump, the complete satellite list** (all in `tugcast/src/session_ledger.rs` unless noted): `CHANGES_SCHEMA_VERSION` 1→2; add `(1, "CREATE TABLE IF NOT EXISTS file_event_spans …")` to `CHANGES_MIGRATIONS`; add the table to `bootstrap_changes_schema`'s idempotent DDL block; add `file_event_spans` to the quarantine `salvage_into` table list (currently `["file_events", "changeset_drafts"]`) so a post-quarantine rebuild recovers span rows rather than leaning entirely on journal replay; extend the version-gate tests; extend eviction (`DeleteSession`), `Sever`, and the new `Disclaim` SQL to also delete matching span rows; read side adds a spans query in `tugchanges-core/src/ledger.rs` (which hand-mirrors the writer's schema per its module doc) and updates the seeded test DDL in `ledger.rs` and `changes.rs` tests. After the pass lands: rebuild everything; any stale binary (e.g. an old dash-worktree build) refuses shared-table row-shaping writes by the existing gate — expected and safe.
- **Wire:** every new field is additive and optional (`hunks` on commit, `own_hunks`/`contested_hunks` on files, `hunks` on receipt ops); an old deck against a new server, or vice versa, degrades to file-level behavior.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugrust/crates/tugchanges-core/src/hunks.rs` | Hunk parse/identity/filtered-patch (Spec S02) + the [P14] overlap verdict |
| `tugrust/crates/tugutil/src/commands/file_stage.rs` (or a `stage` fn in `file.rs`) | `tugutil file stage --patch` |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `Record::FileEventBatch` | enum variant | `tugcast/src/changes_journal.rs` | tag `"fe_batch"`, shapes_rows=true |
| `Record::Disclaim` | enum variant | `tugcast/src/changes_journal.rs` | tag `"fe_disclaim"`, shapes_rows=false |
| `SessionLedger::record_file_events` | fn | `tugcast/src/session_ledger.rs` | transactional batch insert |
| `SessionLedger::disclaim_file_ownership` | fn | `tugcast/src/session_ledger.rs` | + `disclaim_file_ownership_sql` |
| `ChangesetDisclaimPayload`, `parse_changeset_disclaim_payload`, `do_changeset_disclaim`, `send_changeset_disclaim_err` | struct/fns | `tugcast/src/feeds/agent_supervisor.rs` | mirrors claim |
| `run_disclaim` | fn | `tugutil/src/changes.rs` | + CLI subcommand in `tugutil/src/cli.rs` |
| `DisclaimState`, `ChangesetVerbStore.disclaim/disclaimState/clearDisclaim`, `useChangesetDisclaim` | TS | `tugdeck/src/lib/changeset-verb-store.ts` | mirrors claim state |
| `ChangesRouteController.disclaim` | TS method | `tugdeck/src/lib/changes-route-controller.ts` | |
| `onDisclaimFile`, `disclaimPending` props; `.tug-changes-list-file-meta` | TS/CSS | `tugdeck/src/components/tugways/tug-changes-list.tsx` / `.css` | + icon swap |
| `Hunk`, `parse_hunks`, `hunk_id`, `filtered_patch`, `HunkDrift` | Rust | `tugchanges-core/src/hunks.rs` | Spec S02 |
| `CommitOptions.hunks`, `CommitError::HunkDrift` | fields/variant | `tugchanges-core/src/commit.rs` | [P07] |
| `ChangesetDraftSelection.hunks` | TS field | `tugdeck/src/lib/changeset-types.ts` | [P09] |
| `FileEventSpan`, spans on `Record::FileEvent` | struct/field | `tugcast/src/changes_journal.rs` + `session_ledger.rs` | `#[serde(default)]` |
| span capture in `PendingCall`/`into_row` path | Rust | `tugcast/src/feeds/attribution.rs` | [P11] anchors from tool input |
| overlap verdict fn (`classify_contention` or similar) | Rust | `tugchanges-core` | [P14], consumed by `changes.rs` + tugcast `feeds/changeset.rs` |
| interactive-staging detection | TS | deck shell-routing layer (beside `lib/shell-line-classifier.ts` / the prompt-entry submit routing) | [P13] |

---

### Documentation Plan {#documentation-plan}

- [ ] `tuglaws/tracking-changes.md`: add Disclaim to the origins/consumers tables; document span capture, [P12] widening, and the hunk-level SHARED rule; note the partial-commit liveness consequence ([P08]).
- [ ] `tuglaws/design-decisions.md`: candidate global promotions after the plan lands (disclaim semantics; hunk-identity rule) — user's call at landing time.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (Rust)** | hunk parse/id/filtered-patch determinism; disclaim SQL; batch atomicity; anchor matching table | every engine step |
| **Integration (Rust)** | real-git commit tests in `commit.rs` (the existing `init_repo` pattern); CLI round trips in the `changes_cli` suite | partial staging, drift refusal, disclaim CLI |
| **Journal replay** | new record variants replay idempotently (the `session_ledger.rs` replay test pattern) | steps 1, 2, 13 |
| **App-test** | Changes card affordances end-to-end (`@covers` on touched sources; run via `just app-test-changed`) | disclaim button, divider/icons, hunk checkboxes |

#### What stays out of tests {#test-non-goals}

- No jsdom/mock-store render tests — banned pattern; deck behavior is covered by app-tests driving the real app.
- No full app-test corpus runs — selection is derived (`just app-test-changed`); core tier only if an unscopeable surface is touched.
- No tests of git's own `apply` semantics — we test our filtered-patch construction and refusal paths, trusting git on application.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** Steps 1–5 are dash pass 1 (Milestone M01), 6–11 dash pass 2 (M02), 12–16 dash pass 3 (M03).

**Milestone M01: Claim/Disclaim/Polish** {#m01-claim-disclaim-polish} · **Milestone M02: Hunk-level landing** {#m02-hunk-landing} · **Milestone M03: Spans + hunk-aware SHARED** {#m03-spans-shared}

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Atomic batch claim record | done | adfdd559c |
| #step-2 | Disclaim backend + CLI | done | 2b5d72032 |
| #step-3 | Disclaim frontend | done | fa27a9a0a |
| #step-4 | Icons + metadata divider | done | fa27a9a0a |
| #step-5 | M01 integration checkpoint | done | N/A (verification only) |
| #step-6 | Hunk model in tugchanges-core | pending | — |
| #step-7 | Hunk ids on the diff wire | pending | — |
| #step-8 | Partial staging in commit | pending | — |
| #step-9 | Hunk election UI + draft selection | pending | — |
| #step-10 | file stage verb + shell steering | pending | — |
| #step-11 | M02 integration checkpoint | pending | — |
| #step-12 | Schema v2: spans table | pending | — |
| #step-13 | Span capture | pending | — |
| #step-14 | Hunk-aware contention verdict | pending | — |
| #step-15 | Contention UI + default election | pending | — |
| #step-16 | M03 integration checkpoint | pending | — |

#### Step 1: Atomic batch claim record {#step-1}

**Commit:** `tugcast(changes-rework): atomic batch claim via one fe_batch journal record`

**References:** [P01] Batch claim atomic, Risk R01, (#claim-flow)

**Artifacts:** `Record::FileEventBatch`, `SessionLedger::record_file_events`, `do_changeset_claim` using it.

**Tasks:**
- [ ] Add `Record::FileEventBatch { rows: Vec<FileEventRow> }` (serde tag `"fe_batch"`) to `tugcast/src/changes_journal.rs`; classify `shapes_rows() == true`.
- [ ] Add `SessionLedger::record_file_events(&self, rows: &[FileEventRow])` in `session_ledger.rs`; in `apply_journal_record`, apply the batch inside an explicit SQLite transaction over `insert_file_event` (all rows or none; the per-row `ON CONFLICT DO NOTHING` semantics are preserved within the batch).
- [ ] In `do_changeset_claim` (`feeds/agent_supervisor.rs`), collect the `FileEventRow`s (unchanged construction, shared `claim:{at}` tool_use_id), issue one `record_file_events` call, and set `claimed` to the full count on success / `0` on error (warn as today).

**Tests:**
- [ ] Ledger unit test: a batch of 3 rows lands atomically; replaying the same journal record is idempotent (PK collapse) — follow the existing replay-test pattern in `session_ledger.rs`.
- [ ] Ledger unit test: a batch containing a duplicate-PK row still succeeds (conflict-ignored), count reflects rows applied.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 2: Disclaim backend + CLI {#step-2}

**Depends on:** #step-1

**Commit:** `tugcast(changes-rework): changeset_disclaim verb — journaled ownership renunciation`

**References:** [P02] Disclaim semantics, [P03] Disclaim parity, [Q04], Spec S01, (#claim-flow)

**Artifacts:** `Record::Disclaim`, `SessionLedger::disclaim_file_ownership`, supervisor verb + dispatch, `tugutil changes disclaim`.

**Tasks:**
- [ ] Add `Record::Disclaim { project_dir, session_id, paths }` (tag `"fe_disclaim"`, `shapes_rows() == false`) and its applier: `DELETE FROM changes.file_events WHERE project_dir = ?1 AND tug_session_id = ?2 AND file_path IN (…)` — model on `sever_file_ownership_sql`.
- [ ] Add `SessionLedger::disclaim_file_ownership(project_dir, paths, session_id) -> Result<usize, LedgerError>` (no-op on empty paths, like sever).
- [ ] In `feeds/agent_supervisor.rs`: `ChangesetDisclaimPayload` + parser (same shape/validation as claim), `"changeset_disclaim"` dispatch arm, `do_changeset_disclaim` (guards: open project, ledger; map each file through `repo_relative_key` with skip-and-warn; delete; `changeset_all_bump().notify_one()`; reply per Spec S01), `send_changeset_disclaim_err`.
- [ ] `tugutil/src/changes.rs::run_disclaim` mirroring `run_claim` (POST `{"action":"changeset_disclaim", …}` to `/api/tell`); register `changes disclaim <paths…>` in `tugutil/src/cli.rs` beside claim.

**Tests:**
- [ ] Ledger unit test: disclaim deletes exactly the named session's rows for the named paths (other sessions' and other paths' rows survive); journal-replay idempotent.
- [ ] Supervisor/CLI integration test in the existing `changes_cli` suite: claim then disclaim round trip; disclaimed file re-buckets as `unattributed`; disclaiming one owner of a two-owner path leaves the other as sole (non-shared) owner.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast -p tugutil -p tugchanges-core`

---

#### Step 3: Disclaim frontend {#step-3}

**Depends on:** #step-2

**Commit:** `tugdeck(changes-rework): per-row Disclaim affordance on session files`

**References:** [P02], [P03], Spec S01, State Zone Mapping (#state-zone-mapping), (#claim-flow)

**Artifacts:** verb-store disclaim state + hook, controller method, per-row button on session-entry files.

**Tasks:**
- [ ] `changeset-verb-store.ts`: `DisclaimState` (mirror `ClaimState` including the shortfall-as-error rule against `requested`), `_disclaims`/`_disclaimInflight` maps, `disclaim(entryKey, projectDir, sessionId, files)`, `_onControl` arms for `changeset_disclaim_ok`/`_err`, `disclaimState`/`clearDisclaim`, `useChangesetDisclaim`.
- [ ] `changes-route-controller.ts`: `disclaim(paths: string[])` beside `claim`.
- [ ] `tug-changes-list.tsx`: new props `onDisclaimFile?: (path: string) => void` and `disclaimPending?: boolean`; render a per-row icon button (subtype `icon`, size `2xs`, emphasis `outlined`, role `accent`, `data-testid="tug-changes-list-disclaim"`, title `Disclaim this file from this session`) in the row-trailing span for `entry.kind === "session"` files only — structurally the mirror of the existing claim button.
- [ ] `session-changes-view.tsx`: wire `onDisclaimFile={(path) => changesController.disclaim([path])}` and `disclaimPending`; extend `claim-error-notice-controller.tsx` to surface disclaim errors with the same sticky-bulletin mechanics.

**Tests:**
- [ ] New app-test (with `@covers` for `tug-changes-list.tsx`, `changeset-verb-store.ts`, `changes-route-controller.ts`): an attributed file's Disclaim click moves it to the unattributed section on the next recompute.

**Checkpoint:**
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test-changed`

---

#### Step 4: Icons + metadata divider {#step-4}

**Depends on:** #step-3

**Commit:** `tugdeck(changes-rework): claim/disclaim corner icons; one metadata divider per row`

**References:** [P04] Icons, [P05] Metadata divider, (#row-rendering)

**Tasks:**
- [ ] In `tug-changes-list.tsx`: import `CornerDownLeft, CornerUpRight` from `lucide-react`; use `CornerDownLeft` for the per-row claim and `Claim all` buttons, `CornerUpRight` for the Step-3 disclaim button; drop the `CornerUpLeft` import.
- [ ] Wrap the badge/provenance/hint spans in `FileIdentity` in `<span className="tug-changes-list-file-meta">`, rendered only when at least one child is non-null.
- [ ] In `tug-changes-list.css`: new `.tug-changes-list-file-meta { display: inline-flex; align-items: baseline; gap: 8px; flex-shrink: 0; padding-left: var(--tug-space-md); border-left: 1px solid var(--tug7-element-global-border-normal-muted-rest); }`; remove `padding-left`/`border-left` from `.tug-changes-list-file-provenance` (keep its typography).

**Tests:**
- [ ] Extend the Step-3 app-test (or the existing changes-card app-test this file's `@covers` resolves to): assert a hint-only row and a provenance row each render exactly one `.tug-changes-list-file-meta` wrapper, and a metadata-free row renders none.

**Checkpoint:**
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test-changed`

---

#### Step 5: M01 integration checkpoint {#step-5}

**Depends on:** #step-1, #step-2, #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** Milestone M01, (#success-criteria)

**Tasks:**
- [ ] Verify claim/disclaim round trips in the running app (claim all → one atomic batch; disclaim → unattributed; disclaim on a shared file → other side sole owner).

**Tests:**
- [ ] `cd tugrust && cargo nextest run`
- [ ] `just app-test-changed`

**Checkpoint:**
- [ ] Both green; visual pass on the Changes shade (icons, dividers).

---

#### Step 6: Hunk model in tugchanges-core {#step-6}

**Commit:** `tugchanges-core(changes-rework): hunk parse, content identity, filtered-patch builder`

**References:** [P06] Hunk identity, [Q01], Spec S02, (#commit-engine)

**Artifacts:** `tugchanges-core/src/hunks.rs` per Spec S02.

**Tasks:**
- [ ] Implement `parse_hunks` over one file's unified diff text (input shape: what `git diff --no-color -- <path>` emits; reuse/extend the `@@`-walking in `git.rs::parse_diff_chunk` rather than duplicating its line handling — `DiffFile.unified` already retains the verbatim chunk).
- [ ] Implement `hunk_id` ([P06]: SHA-256 over body lines excluding the `@@` header, hex, 16 chars, `#N` ordinal on duplicates) and `filtered_patch` (original `---`/`+++` header + selected hunks, new-side starts recomputed by cumulative delta over included hunks; `HunkDrift` on unknown ids).

**Tests:**
- [ ] Unit: id stability under other-hunk drift (same body, shifted `@@` numbers → same id); id change on body change; duplicate-hunk ordinals; a `\ No newline at end of file` marker rides its hunk's body (through parse, id, and `filtered_patch`) without counting as a body line for offset math.
- [ ] Unit: `filtered_patch` of hunks {1 of 3}, {2,3 of 3}, {all}, {none→error}, and a real-git application test: build a repo, make a 3-hunk change, filter to hunk 2, `git apply --cached`, assert `git diff --cached` contains exactly hunk 2's lines.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugchanges-core`

---

#### Step 7: Hunk ids on the diff wire {#step-7}

**Depends on:** #step-6

**Commit:** `tugcast(changes-rework): serve hunk ids with per-file diffs`

**References:** [P06], Spec S02, (#hunk-read-side)

**Tasks:**
- [ ] Locate the server side of the per-file diff the Changes card's inline diff consumes (the deck's `lib/changeset-diff-store.ts` / `lib/git-diff-store.ts` descriptors resolve to tugcast's git feed, `tugcast/src/feeds/git.rs`, which delegates parsing to tugchanges-core). Attach each served file-diff's hunk id list (Spec S02 ids, in hunk order) as an additive field on the diff response payload.
- [ ] Deck: thread the ids through the diff store snapshot types so the diff body can key hunks; no rendering change yet.

**Tests:**
- [ ] Rust unit on the feed serializer: ids present, ordered, matching `hunks::hunk_id` of the same text.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`
- [ ] `cd tugdeck && bunx vite build`

---

#### Step 8: Partial staging in commit {#step-8}

**Depends on:** #step-6

**Commit:** `tugchanges-core(changes-rework): hunk-elected landing via git apply --cached`

**References:** [P07] Partial staging, [P08] Liveness consequence, Spec S02, Spec S03, (#commit-engine)

**Artifacts:** `CommitOptions.hunks`, `CommitError::HunkDrift`, the partial branch of `stage_and_commit`, wire + CLI plumbing.

**Tasks:**
- [ ] Extend `CommitOptions` with `hunks: Option<BTreeMap<String, Vec<String>>>`; absent/empty → existing code path untouched.
- [ ] Partial branch per [P07]: index-clean guard (`git diff --cached --quiet`; on failure, typed `Other` error naming the staged paths from `git diff --cached --name-only`); `git add --` the whole-file subset (existing `stageable_paths` rules); per partial file, `git diff --no-color --no-ext-diff -- <path>` → `parse_hunks` → `filtered_patch` → `git apply --cached` via stdin (reuse the child-process shape of `file_probe.rs::git_apply`); `git commit -m <msg>` with **no** pathspec; on any post-staging failure, `git reset -- <all staged paths>` (whole-file ∪ partial) before returning.
- [ ] Map `HunkDrift` to `CommitError::HunkDrift { path, ids }` (a refusal-class error: nothing committed; CLI exit 1 with a `hunk drift:` prefix — Spec S03).
- [ ] `feeds/changeset.rs::run_changeset_commit` + the `changeset_commit` payload parser in `agent_supervisor.rs`: accept optional `hunks`, validate keys ⊆ `files`, pass through.
- [ ] `tugutil commit --hunks <file|->` parsing the Spec-S03 JSON map.

**Tests:**
- [ ] `commit.rs` integration (real git, `init_repo` pattern): 3-hunk file, elect hunk 2 → `git show HEAD` contains hunk 2 only, worktree still dirty with hunks 1+3, `left_behind` re-bucketing runs; mixed landing (one whole file + one partial file) commits both correctly; drift election refuses with nothing staged (assert `git diff --cached` empty after refusal — including the mixed case where a whole file was already `git add`-staged before the partial file's drift surfaced); dirty-index precondition refuses; a `hunks` key naming an untracked/created path refuses.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugchanges-core -p tugcast -p tugutil`

---

#### Step 9: Hunk election UI + draft selection {#step-9}

**Depends on:** #step-7, #step-8

**Commit:** `tugdeck(changes-rework): per-hunk election checkboxes riding the draft selection`

**References:** [P09] Selection hunks, Spec S03, State Zone Mapping (#state-zone-mapping)

**Tasks:**
- [ ] `changeset-types.ts`: add `hunks?: { [path: string]: string[] }` to `ChangesetDraftSelection`, and extend the runtime validator `isOptionalDraftSelection` to accept it (a present `hunks` must be a record of string arrays; absent stays valid).
- [ ] Render a per-hunk election control in the inline diff body for session-entry files (the diff body renders through `DiffBlock` from `body-kinds/diff-block` inside `tug-changes-list.tsx`'s expanded-file branch; key controls by the Step-7 server ids). Compose existing Tug components for the control — never hand-roll. **No hunk controls on created/untracked files** — their wire diff is synthesized and the engine refuses elections on them ([P07]); they stage whole or not at all.
- [ ] Toggle writes go through the draft write path on settle (the same `changeset-draft-store.ts` route file dispositions use — `selection` rides `tugutil draft set` / the `/api/draft` POST); a file with a hunk subset elected renders its row as partially-included.
- [ ] The commit gesture assembles `hunks` from the draft selection and sends it on `changeset_commit` (`changeset-verb-store.ts::commit` gains the optional field; `commit-mode-controller.ts` / `session-changes-view.tsx` thread it).

**Tests:**
- [ ] App-test (`@covers` the touched deck files): expand a 2-hunk file, deselect one hunk, land, assert the commit's numstat reflects the partial change and the tree stays dirty with the remainder.

**Checkpoint:**
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test-changed`

---

#### Step 10: file stage verb + shell steering {#step-10}

**Depends on:** #step-6

**Commit:** `tugutil(changes-rework): file stage verb; steer interactive -p invocations to the Changes shade`

**References:** [P13] Shell steering, Spec S05 (receipt precedent), (#context)

**Tasks:**
- [ ] `tugutil file stage --patch <file|->`: validate with `git apply --check --cached`, then `git apply --cached`; reuse `file_probe.rs`'s `git_apply`/`patch_targets` helpers; print a staged-paths summary (no `TUG-FILE-RECEIPT` — staging moves no working-tree bytes, and a receipt would mint a false `modified` row). Register in `tugutil/src/cli.rs`.
- [ ] Deck: at the shell-routing layer (the routing that dispatches `$`/auto-routed lines — beside `lib/shell-line-classifier.ts` and the prompt-entry submit routing; there is no `lib/bang-commands.ts`, the bang/route dispatch lives in the prompt-entry path), detect `git (add|commit|stash|checkout|restore|reset)` invocations carrying `-p`/`--patch`/`--interactive` and bare `git commit` without `-m`/`-F`; instead of executing, render a notice block: interactive staging doesn't work in the block shell (stdin is `/dev/null`) and hunk staging lives in the Changes shade. Detection is a literal-token scan of the parsed words — no execution, no grammar changes.

**Tests:**
- [ ] Rust: `file stage` stages a valid patch (assert `git diff --cached`), refuses a non-applying one with git's stderr, leaves the worktree bytes untouched either way.
- [ ] Deck unit-level coverage via the routing layer's existing test seam if present; otherwise the app-test in #step-11 covers the steering row.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugutil`
- [ ] `cd tugdeck && bunx vite build`

---

#### Step 11: M02 integration checkpoint {#step-11}

**Depends on:** #step-8, #step-9, #step-10

**Commit:** `N/A (verification only)`

**References:** Milestone M02, (#success-criteria)

**Tasks:**
- [ ] End-to-end in the running app: edit a file in two places, elect one hunk, land, confirm the remainder stays dirty and re-buckets ([P08] — it will read `unattributed` after the partial commit; expected, documented).
- [ ] Type `git add -p` in the `$` route → steering notice, nothing executed.

**Tests:**
- [ ] `cd tugrust && cargo nextest run`
- [ ] `just app-test-changed`

**Checkpoint:**
- [ ] Both green.

---

#### Step 12: Schema v2 — spans table {#step-12}

**Commit:** `tugcast(changes-rework): changes.db v2 — file_event_spans (additive)`

**References:** [P10] Spans table, Spec S04, Risk R02, (#rollout)

**Tasks:**
- [ ] Execute the complete satellite list in #rollout: version constant 1→2, `CHANGES_MIGRATIONS` entry, idempotent DDL in `bootstrap_changes_schema`, `file_event_spans` added to the quarantine `salvage_into` table list, version-gate test updates, span-row deletion joined into `DeleteSession`/`Sever`/`Disclaim` appliers, read-side spans query + seeded test DDL updates in `tugchanges-core` (`ledger.rs`, `changes.rs` tests).
- [ ] Add `FileEventSpan { seq, kind, anchor }` and the `#[serde(default)] spans` field on `Record::FileEvent` (and on `FileEventBatch` rows) with insertion in `apply_journal_record`.

**Tests:**
- [ ] Version-gate tests: on-disk v1 migrates to v2; on-disk v3 refuses writes; sidecar stamps.
- [ ] Journal-compat test: a v1-era `"fe"` line without `spans` parses and applies (serde default).

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast -p tugchanges-core`

---

#### Step 13: Span capture {#step-13}

**Depends on:** #step-12

**Commit:** `tugcast(changes-rework): content-anchor span capture for exact tools and edit receipts`

**References:** [P11] Content anchors, Spec S04, Spec S05, [Q03], (#claim-flow)

**Tasks:**
- [ ] `feeds/attribution.rs`: retain size-capped anchor material from exact-tool inputs in `PendingCall` (Edit/MultiEdit: per-edit `old_string`/`new_string` hashes + capped `new_head`; Write/NotebookEdit: `whole`), and emit spans on the successful `tool_result`'s `FileEventRow` (riding the extended `Record::FileEvent`). Replay backfill (`origin='replay'`) carries the same anchors — the tool input replays.
- [ ] `tugutil file edit`: compute applied-hunk ids (Spec S02 identity over the post-apply `git diff` scoped to the receipt files) and add `hunks` to receipt ops (Spec S05); relay parses them into `kind='hunk'` spans on the minted `cmd` rows.
- [ ] `claim` rows record a single `whole` span (a claim is a whole-file assertion).

**Tests:**
- [ ] Relay-level test (existing attribution test patterns): an Edit frame mints a file event with matching insert/replace spans; a Write mints `whole`; a receipt with `hunks` mints hunk spans; anchor caps enforced (33rd anchor → `whole`).

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast -p tugutil`

---

#### Step 14: Hunk-aware contention verdict {#step-14}

**Depends on:** #step-12, #step-13

**Commit:** `tugchanges-core(changes-rework): hunk-aware SHARED — one overlap verdict, two readers`

**References:** [P12] Widening, [P14] One implementation, Spec S04, Risk R03, Risk R04, (#hunk-read-side)

**Tasks:**
- [ ] Implement the pure verdict fn in tugchanges-core per Spec S04 matching + [P12] widening: input `(hunks: &[Hunk], per_session_anchors)`, output per-session claimed-hunk sets + the shared boolean + the contested id set.
- [ ] Consume it in `changes.rs::compute_changes` (replacing the bare `!foreign_proof.is_empty()` for multi-owner paths; single-owner and span-less cases short-circuit to today's answers) and in tugcast `feeds/changeset.rs`'s `proof_owners` pass; both load spans only for paths with ≥2 proof owners (cost stays bounded by the dirty set).
- [ ] Extend the wire `ChangesetFile` with optional `own_hunks`/`contested_hunks` (additive; deck types in `changeset-types.ts`).

**Tests:**
- [ ] Verdict-fn unit table: disjoint anchors → not shared; overlapping → shared; one span-less owner → shared (file-level); ambiguous anchor → that owner widens; identical insertions by two sessions → contested.
- [ ] `changes.rs` integration: seed two sessions' rows + spans against a real repo with a two-region edit; assert the buckets and shared bits both ways.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugchanges-core -p tugcast`

---

#### Step 15: Contention UI + default election {#step-15}

**Depends on:** #step-9, #step-14

**Commit:** `tugdeck(changes-rework): SHARED only on true overlap; own-hunk default election; contested marks`

**References:** [P12], Spec S03, State Zone Mapping (#state-zone-mapping), (#row-rendering)

**Tasks:**
- [ ] The `shared` badge renders from the server's hunk-aware bit (no deck logic change — the server now sends fewer `shared: true`s); rows with `own_hunks` present and no contest render as normal attributed files.
- [ ] In the hunk-election view (Step 9), mark contested hunks (CSS class + title naming the other claimant sessions) and default-elect the session's `own_hunks` on files that have them (the default-selection rule for such files becomes "own hunks" instead of the all-or-nothing `!shared` exclusion; unelected contested hunks simply stay unstaged).
- [ ] Update the commit-mode/default-selection derivation (`commit-mode-controller.ts`, `session-changes-view.tsx` selection defaults) accordingly.

**Tests:**
- [ ] App-test: two sessions edit disjoint regions of one file (drive the second session's rows via `tugutil changes claim` + a seeded edit, or two relay sessions if the harness supports it); assert no SHARED badge, own-hunk default election, and a clean partial landing.

**Checkpoint:**
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test-changed`

---

#### Step 16: M03 integration checkpoint {#step-16}

**Depends on:** #step-14, #step-15

**Commit:** `N/A (verification only)`

**References:** Milestone M03, (#success-criteria), (#rollout)

**Tasks:**
- [ ] Rebuild all binaries; confirm the live `changes.db` migrated to v2 (sidecar + `PRAGMA user_version` via `just db-inspect changes "PRAGMA user_version"`).
- [ ] Full doctrine pass on `tuglaws/tracking-changes.md` updates (#documentation-plan).

**Tests:**
- [ ] `cd tugrust && cargo nextest run`
- [ ] `just app-test-changed`

**Checkpoint:**
- [ ] Both green; the two-session disjoint-edit scenario shows no SHARED end-to-end.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A Changes system with an atomic batch claim, a first-class disclaim verb at every layer, consistent row metadata rendering, hunk-level election and landing over `git apply --cached`, and span-based hunk-aware SHARED that contends only on true overlaps — landed in three dash passes (M01/M02/M03) from this plan.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Every #success-criteria item verified by its named test or check.
- [ ] `cargo nextest run` green workspace-wide; `bunx vite build` green; `just app-test-changed` green after each pass.
- [ ] `tuglaws/tracking-changes.md` updated (disclaim, spans, hunk-aware SHARED, partial-commit liveness note).

**Acceptance tests:**
- [ ] Step-8 partial-landing integration tests.
- [ ] Step-14 verdict-fn unit table.
- [ ] Step-15 two-session disjoint-edit app-test.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Carry-forward re-mint for a partial commit's remainder ([Q02]/[P08]).
- [ ] "Disclaim all" bulk affordance.
- [ ] Spans from `shell_ops`-parsed in-place editor commands (would require the grammar to model substitution effects — likely never worth it; [Q03]).
- [ ] Promoting disclaim semantics and hunk identity into `tuglaws/design-decisions.md` as global `[D##]` entries.

| Checkpoint | Verification |
|------------|--------------|
| M01 lands | #step-5 |
| M02 lands | #step-11 |
| M03 lands | #step-16 |
