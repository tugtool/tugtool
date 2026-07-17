# Tracking Changes

*How a session's file changes are captured, classified, and committed. The two-layer doctrine: **capture annotates, git status decides** — the attribution ledger records who changed what at the moment of change (best-effort by construction), and the read/commit side treats the working tree as the universe so a capture gap can narrow *attribution* but can never hide a file or shrink a commit.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md), principally [D112] (point-of-change attribution, provenance-only capture, per-file contention, row liveness) and [D113] (the aggregate changeset feed). Plan lineage: `roadmap/changesets-plan.md` (capture), `roadmap/commit-tool-fixes.md` (the join inversion, buckets, and refusal contract).*

---

## Why two layers

Two real incidents shaped this design: a `perl -i` bulk pass and a `git mv` sweep each left dozens of changed files with no attribution rows, and the commit tool of the day — which computed its file set as *ledger ∩ git status* — silently committed only the files it knew about. The root cause was architectural, not a bug: **capture is inherently best-effort** (a fingerprint delta cannot be reconstructed after the fact), so any reader that treats the ledger as a gate converts every capture miss into a silent omission.

The resolution is a strict division of labor:

| Layer | Owner | Question it answers | Authority |
|---|---|---|---|
| **Capture** | tugcast (`feeds/agent_bridge.rs`, `feeds/attribution.rs`) | *Who* changed this file, *how*? | Advisory — annotates, never gates |
| **Read / commit** | tugchanges-core (+ `tugutil` CLI) | *What* is dirty, and what gets committed? | `git status --untracked-files=all` is the universe |

The invariant that falls out ([D112], `commit-tool-fixes` [P01]): **a dirty file is never invisible.** Every dirty path appears in `tugutil context` in exactly one bucket; a default `tugutil commit` either accounts for every one of them or refuses. Capture hardening (brackets, `-uall`, the turn fallback) improves attribution *quality*; it is never load-bearing for commit *correctness*.

---

## The ledger

The record is the `file_events` table in the **machine-global `changes.db`** (`~/Library/Application Support/Tug/changes.db`), one row per (session, tool call, file). One ledger for the whole machine, regardless of app instance: the working tree is machine-global, so per-instance attribution splits the truth — a second instance on the same checkout would see the first instance's work as ownerless. The rows themselves are keyed by canonical repo root (`project_dir`), so every instance's compose and every `tugutil` invocation reads the same answer.

- **Location:** `tugcore::instance::changes_db_path()` — deliberately independent of `TUG_INSTANCE_ID`; the `TUG_CHANGES_DB` env override exists solely for test isolation (the app-test harness and CLI suites point it at scratch files). Each instance's `SessionLedger` opens its own per-instance `sessions.db` and `ATTACH`es the shared `changes.db` as schema `changes`; on first open it migrates any legacy per-instance `file_events` rows in and drops the legacy table.
- **Writer:** tugcast only (`session_ledger.rs` owns the DDL; the relay loop writes rows). Multiple tugcast processes write concurrently — WAL + busy-timeout make that safe. Every write is best-effort — a ledger error is logged and the wire frame forwards unchanged; attribution never gates delivery ([D112]). Evicting a `sessions` row deletes its `changes.file_events` rows explicitly (a trigger cannot reach across databases).
- **Reader:** tugchanges-core opens `changes.db` **read-only** (`SQLITE_OPEN_READ_ONLY`, WAL-safe against the concurrent writers) for `file_events`, plus the per-instance `sessions.db` for the known-session test — a session with rows in the shared ledger is known even when this instance holds no `sessions` row for it. Raw-SQL coupling (`tugchanges-core/src/ledger.rs`; a contract test guards the shape).
- **Idempotency contract:** the primary key is `(tug_session_id, tool_use_id, file_path)` with `ON CONFLICT DO NOTHING`. Replay/resume re-streams history freely and converges; every capture source must mint `tool_use_id`s that respect this key (the turn bracket's synthetic `turn:<opened_at_millis>` id exists for exactly this reason).
- **Path space:** `file_path` is stored **repo-relative in canonical space**, projected at capture time against the session's canonical repo root (`CanonicalPath`), so both sides of every downstream join speak git's language. Legacy absolute-path rows degrade safely: they stop matching and the file surfaces as `unattributed` — visible, never silent.
- **Provenance only:** a row records who/what/when/how (`tug_session_id`, `tool_use_id`, `file_path`, `tool_name`, `op`, `origin`, `at`) and **no judgments**. The schema's `ambiguous` column is legacy — always written 0, read by nothing (which also neutralizes every historical row the retired time-overlap heuristic poisoned; see Contention below).

---

## Capture: the four origins

All capture happens at one supervised point — tugcast's stdout relay loop (`agent_bridge.rs::relay_session_io`), which every tool frame already traverses. Four source rules, distinguished by the row's `origin`:

| `origin` | `tool_name` | Mechanism | When |
|---|---|---|---|
| `exact` | `Write`/`Edit`/`MultiEdit`/`NotebookEdit` | Path read straight from the tool input | Recorded on the **successful** `tool_result` (a denied/errored call records nothing) |
| `bash` | `Bash` | Per-call working-tree fingerprint bracket | Snapshot on `tool_use`, delta on `tool_result` |
| `turn` | `Turn` | Turn-scoped fallback bracket | Snapshot on the `user_message` forward, delta on the turn's non-replayed `turn_complete` |
| `replay` | (as original) | Exact-tool backfill during JSONL replay | Historical `timestamp` used as `at`; PK collapses re-streams |

### Exact tools

The relay holds a `PendingCalls` map (size-capped, oldest-evicted, **not** cleared on `turn_complete` — a background agent's child `tool_use`/`tool_result` pair can straddle a turn boundary). Populated at `tool_use` time, consumed at `tool_result` time; only a successful result records.

### The Bash bracket

Bash is the one opaque mutator, so it is bracketed: on the Bash `tool_use` the relay snapshots the working tree (`snapshot_worktree`: `git status --porcelain=v2 --untracked-files=all`, plus mtime per listed path — status catches category changes, mtime catches a same-status re-write), and on the `tool_result` it snapshots again and attributes the delta (`OpenBracket::into_delta_rows`). The delta is attributed regardless of the result's `is_error` — a failing command can have mutated files before it failed.

### The turn-scoped fallback bracket

The per-call Bash bracket has structural holes (G2/G3 below), so the relay also brackets the **whole turn**: pre-snapshot when a `user_message` is forwarded to tugcode stdin (seconds before the model can emit any command), post-snapshot on that turn's non-replayed `turn_complete`. Any delta path not already covered by an exact or per-call row this turn (tracked in a relay-local `turn_recorded_paths` set) becomes an `origin='turn'` row. A path an exact or Bash row already recorded this turn gets no turn row; replay never opens a turn bracket (user messages don't replay through `input_rx`, and a replayed `turn_complete` closes nothing).

### Capture is a private, per-session affair

**Every bracket is relay-local.** There is no cross-session bracket registry: a relay's Bash brackets live in a per-relay map beside its turn bracket, a crashed relay simply drops them (no sweep ceremony — the read side's bucket surfacing covers the residual gap), and no capture path can observe, mark, or be marked by another session. A bracket delta is a *claim* of authorship, not a proof; competing claims are resolved where they can actually be seen — per file, at read time (Contention, below).

### Replay

On resume/restore, exact tool frames re-stream from JSONL and backfill rows with `origin='replay'` at their historical timestamps. Bash deltas are **never** reconstructed at replay — the pre-command fingerprint no longer exists (G1). This is accepted, not fought: the read side makes it harmless.

---

## Contention and row liveness

Two read-time rules turn raw provenance rows into trustworthy classification. Both are computed per file, from evidence; capture contributes facts only.

**Contention (`shared`).** A file is `shared` if and only if **two or more sessions hold live ledger rows for that exact repo-relative path** on the same repo. This is the *only* cross-session signal. Wall-clock overlap between sessions is never evidence: the retired design cross-marked rows `ambiguous` whenever two sessions' Bash brackets were open on the same repo root at the same moment, which false-positived on every unrelated concurrent command (several session cards on one checkout ≈ everything ambiguous) while adding nothing real — the genuine hazard of overlapping fingerprint windows (session B's write landing inside session A's bracket) *always* leaves both sessions holding rows for the contended path, which is exactly what the per-file rule detects. Per-file contention also catches sequential same-file edits a time window would miss. Shared files are excluded from every default commit set (the card's one-click commit and `tugutil commit` alike) and included only by explicit election (`--all`, `--tree`, `--paths`); the claimant sessions are named alongside the flag.

**Row liveness.** A ledger row is **live** only while it postdates the last commit that touched its path; a commit *spends* the rows it absorbs. Concretely (`min_live_at_ms`, implemented identically in tugchanges-core `changes.rs` and tugcast `changeset.rs`): a row is live iff `at ≥ (last_commit_epoch_secs + 1) × 1000`, the whole commit second treated as spent so ties break toward spent; a path with no commit history (new/untracked) spends nothing — every row is live. Spent rows neither attribute nor contend: without this rule rows are immortal, so the moment a path went dirty again — days later, by anyone — every historical row resurfaced and re-claimed it (G6). The degradation direction is always toward `unattributed`: visible, never falsely claimed.

The cost profile: liveness needs one `git log -1 --format=%ct -- <path>` per dirty path *that has rows at all* (a cheap SQL probe runs first), bounded by the dirty set.

---

## The capture-gap inventory

The known ways attribution can be missing or wrong — and why each is safe now:

| Gap | What happens | Disposition |
|---|---|---|
| **G1 — replay never brackets Bash** | Historical Bash deltas are unreconstructable after restart/reload | Unfixable at capture; file surfaces as `unattributed` |
| **G2 — pre-snapshot races a fast command** | Claude Code executes Bash regardless of the relay; a fast `perl -i` can finish before the pre-snapshot's `git status` returns → pre == post, zero rows | Caught by the **turn bracket** (its pre-snapshot precedes the whole turn) |
| **G3 — relay crash mid-Bash** | The open bracket is dropped with the relay | Mid-Bash within a live turn: turn bracket. Mid-turn crash: `unattributed` |
| **G4 — shell route (`$` commands)** | Shell commands never traverse the relay's tool frames ([D111]) | Deliberately uncaptured; visible as `unattributed` |
| **G5 — untracked-directory collapse** | Plain porcelain collapses a fully-untracked dir to one `? dir/` line, so files inside never matched any join | Fixed outright: **both** status universes (`snapshot_worktree` and tugchanges-core's `status_output`) pass `--untracked-files=all` |
| **G6 — row immortality** | Rows outlive the commit that consumed them; a re-dirtied path resurrected every fossil claim on it | Fixed at read time by the **row-liveness rule** — spent rows neither attribute nor contend |

The pattern: G5/G6 were read-side defects and are fixed; G2/G3 are narrowed by the turn bracket; G1/G4 and every future unknown gap are rendered harmless by the bucket surfacing. No gap can produce a silent half-commit, and no gap's residue can falsely claim a file.

---

## The read side: three buckets

`tugchanges-core` (`changes.rs::resolve_changes`) enumerates `git status --porcelain=v2 --untracked-files=all` as the universe and classifies **every dirty path** into exactly one bucket, using **live rows only**:

| Bucket | Meaning | Shape |
|---|---|---|
| `files` (attributed) | This session has live rows for the path | `Change` — `{path, op, origin, shared, sessions, git_status, diff}`; latest live event wins op/origin; `shared` + claimant `sessions` when other sessions also hold live rows |
| `foreign` | Only *other* sessions hold live rows, and their `project_dir` canonicalizes to this repo root | `ForeignChange` — `{path, git_status, sessions[], diff}` |
| `unattributed` | No live rows anywhere (including all-claims-spent) | `Change` with sentinel `op:"unknown"`, `origin:"none"` |

All three are diffed in `context` (an untracked file gets a synthesized add-diff via `git diff --no-index -- /dev/null <path>` — never an empty string). The per-path session query (`ledger.rs::sessions_for_path` / `foreign_sessions_for_path`: canonicalized repo match + the liveness cut) is advisory classification: a row that fails to match degrades to `unattributed`, visible either way.

Session resolution is unchanged and fires **before** bucketing: no session id / no ledger / unknown session exit **2**. A known session with zero attributed files and a dirty tree is *not* an error — it is empty `files` plus a populated `unattributed`.

The legacy `tugutil changes` verb keeps its event-scoped wire contract (attributed only); the buckets surface through `context`, the commit skill's single command.

---

## Commit: the disposition contract

`tugchanges_core::commit` implements the matrix (`commit-tool-fixes` Table T01), with precedence `--paths` > `--tree` > (`--include-unattributed` / `--leave-unattributed` / `--all`):

| Invocation | Commits | If unattributed files exist |
|---|---|---|
| (default) | attributed, non-shared | **refuses — exit 3, nothing committed** |
| `--leave-unattributed` | attributed, non-shared | proceeds; receipt `left_behind` names them |
| `--include-unattributed` | + unattributed | included |
| `--all` | + shared (composes with the two above) | per the flags above |
| `--tree` | attributed ∪ unattributed ∪ shared — everything but foreign | included |
| `--paths <p…>` | exactly the given paths; bypasses bucketing entirely | caller's call |

- **Exit codes:** 0 success · 1 real error · 2 session resolution · 3 refusal (`CommitError::UnattributedPresent`, typed — no string sniffing). The exit-3 stderr lists the offending paths *and* names the disposition flags, so the way out is always in the message.
- **`foreign` never blocks and is never auto-included** — only an explicit `--paths` can take another session's file.
- **Staging is by construction:** `git add -- <files>` then `git commit -m <msg> -- <files>` — never `git add .` — so the receipt cannot disagree with what was staged.
- **The receipt tells on itself:** after committing, the bucketing re-runs and `CommitReceipt.left_behind` (`{unattributed, foreign, shared}`) names every still-dirty path. A partial commit is visible in its own receipt, not two sessions later.

The net effect of refusal + `--tree` + `left_behind`: a half-commit is impossible to produce *by accident*. Every narrowing is an explicit, named election.

---

## Consumers

| Consumer | Path | Notes |
|---|---|---|
| `tugutil context` / `commit` | tugchanges-core via the CLI (`tugutil/src/changes.rs`) | The bucket surface; JSON envelope fields are additive |
| The commit skill | `tugplug/skills/commit/SKILL.md` | Runs `context --json`, must dispose of every `unattributed` file (include it, or leave it and name it as inflight); treats exit 3 as "re-run with a disposition flag", never as "fall back to raw git" |
| Session card commit button | `tugcast feeds/changeset.rs::run_changeset_commit` | Calls `commit()` with an explicit `paths` set → bypasses bucketing, can never hit the refusal; maps `CommitError` back to its `String` error |
| Changeset card / feed | `feeds/changeset.rs`, `feeds/changeset_all.rs` ([D113]) | Composes live ledger rows per project (same liveness rule); marks per-file multi-owner paths `shared`; the card's default selection is `!shared` for session files and **OFF for unattributed** (inclusion is an explicit per-file election — the card mirror of the exit-3 refusal) |
| Dash commits | tugdash-core (`tugutil dash commit`) | A **separate** file-selection path on an isolated single-writer worktree; not governed by the bucket contract (auditing it for the same narrowing shape is a recorded follow-on) |

---

## Invariants (the short list)

1. **A dirty file is never invisible.** `git status -uall` is the read-side universe; the ledger annotates it, never filters it.
2. **A default commit is never silently partial.** Unattributed + no disposition → exit-3 refusal; any leftover is named in the receipt's `left_behind`.
3. **Capture never gates delivery.** Every relay intercept is best-effort: log, forward unchanged.
4. **Every capture source is upsert-idempotent** under the `(session, tool_use_id, file_path)` PK.
5. **Capture records provenance, never judgments.** All brackets are relay-local; no capture path observes or marks another session, and no row carries a cross-session flag.
6. **Contention is a per-file fact, computed at read time.** A file is `shared` iff two or more sessions hold live rows for that exact path. Wall-clock overlap is never evidence.
7. **A ledger row is live only until its path's next commit.** A commit spends the rows it absorbs; spent rows neither attribute nor contend, and ties degrade toward `unattributed` — visible, never falsely claimed.
8. **Shared and foreign files are opt-in only.** No default set includes them; `foreign` never blocks.
9. **The ledger is machine-global.** One `changes.db` regardless of app instance, keyed by canonical repo root — attribution truth is never split across instances that share a working tree.
10. **No replay reconstruction.** A fingerprint delta that wasn't captured live is gone; the bucket surfacing, not heroics, makes that safe.
