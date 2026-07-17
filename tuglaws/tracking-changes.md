# Tracking Changes

*How a session's file changes are captured, classified, and committed. The two-layer doctrine: **capture annotates, git status decides** — the attribution ledger records who changed what at the moment of change (best-effort by construction), and the read/commit side treats the working tree as the universe so a capture gap can narrow *attribution* but can never hide a file or shrink a commit.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md), principally [D112] (point-of-change attribution) and [D113] (the aggregate changeset feed). Plan lineage: `roadmap/changesets-plan.md` (capture), `roadmap/commit-tool-fixes.md` (the join inversion, buckets, and refusal contract).*

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

The record is the `file_events` table in `sessions.db`, one row per (session, tool call, file):

- **Writer:** tugcast only (`session_ledger.rs` owns the DDL; the relay loop writes rows). Every write is best-effort — a ledger error is logged and the wire frame forwards unchanged; attribution never gates delivery ([D112]).
- **Reader:** tugchanges-core opens the db **read-only** (`SQLITE_OPEN_READ_ONLY`, WAL-safe against the concurrent writer) and couples to the schema by raw SQL (`tugchanges-core/src/ledger.rs`; a contract test guards the shape).
- **Idempotency contract:** the primary key is `(tug_session_id, tool_use_id, file_path)` with `ON CONFLICT DO NOTHING`. Replay/resume re-streams history freely and converges; every capture source must mint `tool_use_id`s that respect this key (the turn bracket's synthetic `turn:<opened_at_millis>` id exists for exactly this reason).
- **Path space:** `file_path` is stored **repo-relative in canonical space**, projected at capture time against the session's canonical repo root (`CanonicalPath`), so both sides of every downstream join speak git's language. Legacy absolute-path rows degrade safely: they stop matching and the file surfaces as `unattributed` — visible, never silent.

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

Bash brackets live in the **shared `BracketRegistry`** (one per tugcast process, cloned into every relay) so brackets from different sessions on the same checkout can see each other — this is the ambiguity mechanism, below.

### The turn-scoped fallback bracket

The per-call Bash bracket has structural holes (G2/G3 below), so the relay also brackets the **whole turn**: pre-snapshot when a `user_message` is forwarded to tugcode stdin (seconds before the model can emit any command), post-snapshot on that turn's non-replayed `turn_complete`. Any delta path not already covered by an exact or per-call row this turn (tracked in a relay-local `turn_recorded_paths` set) becomes an `origin='turn'` row.

Three rules keep it honest:

1. **Relay-local, never registered.** The turn bracket is held as a relay-local `OpenBracket` and **never enters the shared `BracketRegistry`**. A turn window spans idle thinking time; registering it would cross-mark every concurrent session's rows `ambiguous` on mere wall-clock overlap (with several session cards on one checkout, essentially everything went ambiguous — a shipped regression, since reverted). The turn bracket is a capture-gap safety net, not a signal of concurrent writing: its rows are never `ambiguous`, and it never marks another session.
2. **Dedup, don't duplicate.** A path an exact or Bash row already recorded this turn gets no turn row.
3. **Replay never opens one.** User messages don't replay through `input_rx`; a replayed `turn_complete` closes nothing. A relay crash mid-turn simply drops the local bracket — the residual gap is covered by the read side, not by cleanup ceremony.

### Replay

On resume/restore, exact tool frames re-stream from JSONL and backfill rows with `origin='replay'` at their historical timestamps. Bash deltas are **never** reconstructed at replay — the pre-command fingerprint no longer exists (G1). This is accepted, not fought: the read side makes it harmless.

---

## Ambiguity: who cross-marks whom

`ambiguous` means "another session may own this change — recorded, never guessed." The marking rule is deliberately narrow:

- **Only per-call Bash brackets cross-mark**, via the shared registry: when one session opens a Bash bracket on a repo root where another session's Bash bracket is already open, both sides' deltas come out `ambiguous` (marked in both directions, regardless of close order). These are seconds-wide windows; overlap means two sessions were plausibly *writing* concurrently.
- **Turn brackets never participate** — in either direction (see above). Wall-clock overlap of two open *turns* is not evidence of contention.
- Ambiguous rows are **excluded from every default commit set** (the card's one-click commit and `tugutil commit` alike); they are included only by explicit election (`--all`, `--tree`, `--paths`). One session's commit never silently sweeps another's file.
- The Changeset composition **ORs `ambiguous` across a file's events** (`feeds/changeset.rs`), so a file once marked stays marked for that session until its rows age out (commit + fresh session). Consequence worth knowing: fixing an over-marking bug stops *new* inflation but does not retroactively clean rows already in the ledger.

---

## The capture-gap inventory

The known ways a session-made change ends up with no row — and why each is safe now:

| Gap | What happens | Disposition |
|---|---|---|
| **G1 — replay never brackets Bash** | Historical Bash deltas are unreconstructable after restart/reload | Unfixable at capture; file surfaces as `unattributed` |
| **G2 — pre-snapshot races a fast command** | Claude Code executes Bash regardless of the relay; a fast `perl -i` can finish before the pre-snapshot's `git status` returns → pre == post, zero rows | Caught by the **turn bracket** (its pre-snapshot precedes the whole turn) |
| **G3 — relay crash mid-Bash** | The open bracket is swept on teardown | Mid-Bash within a live turn: turn bracket. Mid-turn crash: `unattributed` |
| **G4 — shell route (`$` commands)** | Shell commands never traverse the relay's tool frames ([D111]) | Deliberately uncaptured; visible as `unattributed` |
| **G5 — untracked-directory collapse** | Plain porcelain collapses a fully-untracked dir to one `? dir/` line, so files inside never matched any join | Fixed outright: **both** status universes (`snapshot_worktree` and tugchanges-core's `status_output`) pass `--untracked-files=all` |

The pattern: G5 was a read-side bug and is fixed; G2/G3 are narrowed by the turn bracket; G1/G4 and every future unknown gap are rendered harmless by the bucket surfacing. No gap can produce a silent half-commit.

---

## The read side: three buckets

`tugchanges-core` (`changes.rs::resolve_changes`) enumerates `git status --porcelain=v2 --untracked-files=all` as the universe and classifies **every dirty path** into exactly one bucket:

| Bucket | Meaning | Shape |
|---|---|---|
| `files` (attributed) | This session has rows for the path | `Change` — `{path, op, origin, ambiguous, git_status, diff}`; latest event wins op/origin, ambiguity ORs |
| `foreign` | Only *other* sessions have rows, and their `project_dir` canonicalizes to this repo root | `ForeignChange` — `{path, git_status, sessions[], diff}` |
| `unattributed` | No rows anywhere | `Change` with sentinel `op:"unknown"`, `origin:"none"` |

All three are diffed in `context` (an untracked file gets a synthesized add-diff via `git diff --no-index -- /dev/null <path>` — never an empty string). The foreign query (`ledger.rs::sessions_for_path` + canonicalized repo match) is advisory classification: a row that fails to match degrades to `unattributed`, visible either way.

Session resolution is unchanged and fires **before** bucketing: no session id / no ledger / unknown session exit **2**. A known session with zero attributed files and a dirty tree is *not* an error — it is empty `files` plus a populated `unattributed`.

The legacy `tugutil changes` verb keeps its event-scoped wire contract (attributed only); the buckets surface through `context`, the commit skill's single command.

---

## Commit: the disposition contract

`tugchanges_core::commit` implements the matrix (`commit-tool-fixes` Table T01), with precedence `--paths` > `--tree` > (`--include-unattributed` / `--leave-unattributed` / `--all`):

| Invocation | Commits | If unattributed files exist |
|---|---|---|
| (default) | attributed, non-ambiguous | **refuses — exit 3, nothing committed** |
| `--leave-unattributed` | attributed, non-ambiguous | proceeds; receipt `left_behind` names them |
| `--include-unattributed` | + unattributed | included |
| `--all` | + ambiguous (composes with the two above) | per the flags above |
| `--tree` | attributed ∪ unattributed ∪ ambiguous — everything but foreign | included |
| `--paths <p…>` | exactly the given paths; bypasses bucketing entirely | caller's call |

- **Exit codes:** 0 success · 1 real error · 2 session resolution · 3 refusal (`CommitError::UnattributedPresent`, typed — no string sniffing). The exit-3 stderr lists the offending paths *and* names the disposition flags, so the way out is always in the message.
- **`foreign` never blocks and is never auto-included** — only an explicit `--paths` can take another session's file.
- **Staging is by construction:** `git add -- <files>` then `git commit -m <msg> -- <files>` — never `git add .` — so the receipt cannot disagree with what was staged.
- **The receipt tells on itself:** after committing, the bucketing re-runs and `CommitReceipt.left_behind` (`{unattributed, foreign, ambiguous}`) names every still-dirty path. A partial commit is visible in its own receipt, not two sessions later.

The net effect of refusal + `--tree` + `left_behind`: a half-commit is impossible to produce *by accident*. Every narrowing is an explicit, named election.

---

## Consumers

| Consumer | Path | Notes |
|---|---|---|
| `tugutil context` / `commit` | tugchanges-core via the CLI (`tugutil/src/changes.rs`) | The bucket surface; JSON envelope fields are additive |
| The commit skill | `tugplug/skills/commit/SKILL.md` | Runs `context --json`, must dispose of every `unattributed` file (include it, or leave it and name it as inflight); treats exit 3 as "re-run with a disposition flag", never as "fall back to raw git" |
| Session card commit button | `tugcast feeds/changeset.rs::run_changeset_commit` | Calls `commit()` with an explicit `paths` set → bypasses bucketing, can never hit the refusal; maps `CommitError` back to its `String` error |
| Changeset card / feed | `feeds/changeset.rs`, `feeds/changeset_all.rs` ([D113]) | Composes ledger rows per project; ORs `ambiguous` per file; renders `origin` opaquely (`turn` rows flow as ordinary advisory events) |
| Dash commits | tugdash-core (`tugutil dash commit`) | A **separate** file-selection path on an isolated single-writer worktree; not governed by the bucket contract (auditing it for the same narrowing shape is a recorded follow-on) |

---

## Invariants (the short list)

1. **A dirty file is never invisible.** `git status -uall` is the read-side universe; the ledger annotates it, never filters it.
2. **A default commit is never silently partial.** Unattributed + no disposition → exit-3 refusal; any leftover is named in the receipt's `left_behind`.
3. **Capture never gates delivery.** Every relay intercept is best-effort: log, forward unchanged.
4. **Every capture source is upsert-idempotent** under the `(session, tool_use_id, file_path)` PK.
5. **Ambiguity requires evidence of concurrent writing.** Only per-call Bash brackets cross-mark; the turn bracket (a whole-turn window) never does, in either direction.
6. **Ambiguous and foreign files are opt-in only.** No default set includes them; `foreign` never blocks.
7. **No replay reconstruction.** A fingerprint delta that wasn't captured live is gone; the bucket surfacing, not heroics, makes that safe.
