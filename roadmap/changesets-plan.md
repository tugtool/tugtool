<!-- devise-skeleton v4 -->

## Changesets — Attribution Engine, Changeset Card, tugdash {#changesets}

**Purpose:** Replace the read-only Git card with an end-to-end changeset system: authoritative
per-session file attribution recorded at the moment of change, a live multi-session Changeset
card that can diff, summarize, and commit, and a standalone `tugdash` worktree tool with a
join engine that actually works. Brief: `roadmap/changesets.md`.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main (or a dash worktree per milestone) |
| Last updated | 2026-07-13 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Today the AI reconstructs "files I changed this session" by looking back through its own
context — remarkably reliable for Write/Edit, blind for `Bash`-mediated edits (`sed`, `perl`,
`git mv`, …). Meanwhile every tool event already flows through one supervised point in
tugcast (`agent_bridge.rs`'s stdout relay loop), which already intercepts other frame types
and has the session ledger in scope. Nothing persists tool calls. The Git card is a passive
2s-poll status viewer with zero actions, and `tugutil dash join` is a hardcoded
`git merge --squash` with rigid preflights and dead-end conflict handling.

This plan concentrates the AI's file knowledge down to the point of change (a sqlite record
written when the tool call lands), builds the Changeset card on that record, and promotes the
worktree workflow into a first-class `tugdash` tool whose join engine uses the same
attribution data.

#### Strategy {#strategy}

- **Attribution first** (Milestone M01): the `file_events` record and its query surface ship
  before any UI. The commit skill is the first consumer — immediate value, zero pixels.
- **Exact where possible, bracketed where not**: Write/Edit/NotebookEdit attribution comes
  straight from tool inputs; only Bash needs working-tree fingerprint bracketing. Subagent
  tool calls are NOT a hole — they arrive on the same stream with `parent_tool_use_id`.
- **Read-only card next** (M02): a workspace-scoped `CHANGESET` snapshot feed composing git
  status + attribution + dash list, bumped event-driven on every file event; the grouped card
  replaces the Git card visually before any write action exists.
- **Actions after trust** (M03): diff, sidecar-generated summaries/commit messages, and
  commit-from-card land only once the read path has proven itself.
- **tugdash last** (M04): the worktree overhaul benefits from attribution (intersection-aware
  preflight) and from the card (join preview UI), so it goes last; it is also the most
  self-contained to defer.
- Each milestone ends with an integration checkpoint; each is independently shippable.

#### Success Criteria (Measurable) {#success-criteria}

- After a session Writes/Edits N files, `tugutil changes` (in that session's Bash env) lists
  exactly those N repo files — verified by a tugcast integration test and by hand.
- A `Bash` call that edits a file via `sed` produces a `file_events` row attributing that file
  to the calling session (bracketed origin), verified by integration test.
- Resuming a session backfills `file_events` for its historical Write/Edit calls
  (idempotently — resume twice, row count unchanged).
- The Changeset card shows a file within 1s of the tool_result that changed it (event-driven
  bump, not the poll), and groups files by owning session/dash with an unattributed bucket.
- Commit-from-card stages exactly the selected changeset's files and produces a numstat
  receipt; a file dirtied by another live session is not swept in.
- `tugdash join --preview` reports conflicts without touching the working tree;
  `tugdash join` succeeds when base dirt is disjoint from the dash's changed files (today's
  code refuses).
- `cd tugrust && cargo nextest run` green; `cd tugdeck && bunx tsc --noEmit && bunx vite build`
  green; `just app-test` green at every milestone close.

#### Scope {#scope}

1. `file_events` table in `sessions.db` + `SessionLedger` API + agent_bridge intercept
   (exact + bracketed + replay backfill).
2. `TUG_SESSION_ID` environment plumbing tugcast → tugcode → claude → Bash tool calls.
3. `tugutil changes` query CLI; commit-skill rewire.
4. `CHANGESET` feed (FeedId 0x23), changeset wire types, Changeset card (read-only → actions).
5. Pathspec-capable diff query; `changeset_commit` and `changeset_summarize` control verbs;
   `claude -p` scribe sidecar.
6. `tugdash` binary + `tugdash-core` crate; `.tug/worktrees/` migration; join engine v2
   (strategies, preview, intersection preflight, journaled teardown); tugplug skill cutover.
7. Git card + `GitFeed` retirement.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Non-git VCS backends (jj/sapling). The `Vcs` seam is respected in naming/layering but no
  trait abstraction ships in this phase — premature until a second backend exists.
- Cross-workspace changeset view (sessions in *other* projects) — see [Q01].
- Staging-area management UI (interactive hunk staging, partial-file commits).
- Recovering pre-feature Bash attribution on resume (replay backfill covers exact tools only —
  a bracketed delta cannot be reconstructed after the fact; see [P06]).
- Attributing writes a `run_in_background` Bash command makes *after* its `tool_result`
  returns — the bracket closes at the result, and the detached command's later writes land
  as unattributed (visible in the card, honest, just not owned). See #bracket-algorithm.
- Removing the dev card's existing `/diff` sheet or `GIT_DIFF` machinery (it is generalized,
  not replaced).
- IndexedDB/SessionCache anything — that layer is slated for removal; nothing here builds on it.

#### Dependencies / Prerequisites {#dependencies}

- git ≥ 2.38 on the host for `git merge-tree --write-tree` (dev machine has 2.53; `tugdash`
  must degrade with a clear error below that).
- claude CLI on PATH (already a hard Tug dependency) for the scribe sidecar.
- Existing infrastructure: `SessionLedger` (`tugrust/crates/tugcast/src/session_ledger.rs`),
  agent bridge relay loop (`tugrust/crates/tugcast/src/feeds/agent_bridge.rs`),
  `WorkspaceRegistry`/`GitFeed` (`tugrust/crates/tugcast/src/feeds/workspace_registry.rs`,
  `feeds/git.rs`), card registry (`tugdeck/src/card-registry.ts`), dash implementation
  (`tugrust/crates/tugutil-core/src/dash.rs`, `tugrust/crates/tugutil/src/commands/dash.rs`).

#### Constraints {#constraints}

- **Warnings are errors** across the Rust workspace (`tugrust/.cargo/config.toml`).
- Frontend: tuglaws apply — external state via `useSyncExternalStore` only [L02]; appearance
  via CSS/DOM [L06]; no localStorage (persistent UI state → tugbank `/api/defaults`); compose
  real Tug* components, never borrow their CSS; no estimated heights; buttons with
  state-dependent content reserve the wider state's width.
- `bunx vite build` must pass before any tugdeck change is called done (dev-esbuild-only
  imports hang the app at splash).
- tugcode is a compiled binary — rebuild after edits; bun only, never npm.
- The relay loop must never let attribution failures affect frame delivery: parse errors,
  ledger write errors, and git subprocess failures all degrade to "forward the frame
  unchanged" (same posture as the existing `system_metadata` intercept).
- The commit skill's constraints stand: no heredocs, no `cd` (they trigger approval prompts).

#### Assumptions {#assumptions}

- `tug_session_id` is stable across resumes of the same Dev-card session (it is the
  card-bound identity; claude session ids rotate underneath it). Attribution keyed by
  `tug_session_id` therefore gets resume-lineage for free.
- The env chain is open: tugcode passes its environment to claude minus three auth keys
  (`tugcode/src/session.ts` `scrubbedEnv`), and claude passes env to Bash tool calls — so a
  variable set on the tugcode spawn reaches skill-run shell commands.
- `sessions.db` (WAL mode) tolerates a concurrent read-only open from `tugutil` while tugcast
  writes — standard sqlite WAL semantics; DB lives on local disk
  (`~/Library/Application Support/Tug/sessions.db`).

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses the devise-skeleton v4 conventions: explicit `{#anchor}` on every cited
heading, `[P##]` plan-local decisions, `[Q##]` open questions, `Spec S##`, `Risk R##`,
`Milestone M##`, `**Depends on:** #step-N` lines, and rich `**References:**` lines. Never
cite line numbers; cite anchors and symbols.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Cross-workspace changeset view (DEFERRED) {#q01-cross-workspace}

**Question:** Should the Changeset card ever show live sessions in *other* projects on the
same deck, or stay strictly per-workspace?

**Why it matters:** Determines whether the feed is workspace-scoped (like GIT) or app-scoped
(like PULSE), which is hard to change later.

**Resolution:** DEFERRED — ship workspace-scoped ([P09]); the composition point
(`ChangesetFeed`) can later be lifted to app scope without changing the wire format (the
snapshot already carries `workspace_key`). Revisit after M02 dogfooding.

#### [Q02] Scribe model selection (DEFERRED) {#q02-scribe-model}

**Question:** Which model should the `claude -p` scribe use for summaries/commit messages?

**Why it matters:** Latency vs. quality for an interactive card action.

**Resolution:** DEFERRED — default to `haiku` via `--model`, overridable through a tugbank
default (`dev.tugtool.changeset` / `scribe_model`), read at spawn. No UI for it this phase.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Bash bracketing adds a `git status` per Bash call | med | med | porcelain-v2 status is ~10ms on this repo; only Bash calls pay; reuse `is_within_git_worktree` gate to skip non-repos | status latency > 100ms observed |
| Multi-session overlap misattributes Bash deltas | med | low | overlap → `ambiguous` flag, never a guess; ambiguous rows excluded from one-click commit ([P15]) | user reports wrong grouping |
| Scribe (`claude -p`) slow or auth-broken headless | med | med | spawn with scrubbed env (subscription auth, same as tugcode); card shows in-flight state; hard 60s timeout with error surfaced | consistent timeouts |
| `.tugtree` → `.tug/worktrees/` migration breaks live dashes | high | low | `git worktree move` only when worktree is clean and no tug instance holds it; otherwise print instructions and continue against old path | migration failure in the wild |
| Rust/TS wire-type drift for ChangesetSnapshot | med | med | golden contract fixture consumed by both a Rust test and a bun test ([P10]) | either test fails |

**Risk R01: Fingerprint snapshot races** {#r01-fingerprint-races}

- **Risk:** The pre-snapshot for a Bash bracket runs a moment after the tool actually starts
  (frame arrival vs. execution), so a very fast self-edit could be missed or doubled.
- **Mitigation:** The `tool_use` frame is emitted when claude *issues* the call, before the
  harness executes it — the snapshot races only network/pipe latency (ms). Deltas are
  computed set-wise (path → status+mtime fingerprint), so double-counting collapses.
- **Residual risk:** An external editor writing during exactly that window is attributed to
  the bracket. Accepted; the card's diff view makes it visible.

---

### Design Decisions {#design-decisions}

#### [P01] Ownership = session lineage + dash (DECIDED) {#p01-ownership}

**Decision:** A changeset's owner is a `tug_session_id` (inline changesets) or a dash
(branch+worktree). Files dirty in the tree with no owning event rows form the
**unattributed** bucket, rendered honestly.

**Rationale:** User decision (brief, "Settled decisions"). `tug_session_id` survives resumes,
so lineage is free. A dash worktree is one changeset regardless of how many sessions
contribute.

**Implications:** `file_events` keys on `tug_session_id`; dashed changesets are derived from
branch topology (`base..branch` + worktree dirt), not from event rows.

#### [P02] file_events lives in sessions.db (DECIDED) {#p02-file-events-home}

**Decision:** Attribution rows go in a new `file_events` table in the existing session ledger
(`~/Library/Application Support/Tug/sessions.db`), NOT tugbank.

**Rationale:** tugbank is a `(domain,key)→value` defaults store with a per-entry size cap —
wrong shape. `sessions.db` is already per-session, already written from the interception
point, and has the cascade-trigger idiom (`turns`, `turn_telemetry`) to copy.

**Implications:** Schema added in `bootstrap_schema` with the self-healing column guard and a
cascade-delete trigger on `sessions`, exactly like `turns_cascade_delete_on_session`.

#### [P03] Intercept in the agent_bridge relay loop (DECIDED) {#p03-intercept-point}

**Decision:** Attribution is captured in tugcast's stdout relay loop in
`tugrust/crates/tugcast/src/feeds/agent_bridge.rs` — the same `else if line.contains(...)`
chain that handles `turn_complete` and `system_metadata` — not in tugcode.

**Rationale:** One process sees every session (tugcode is per-session and short-lived); the
loop already has `tug_session_id`, `ledger_entry` (with `project_dir` and
`claude_session_id`), `session_ledger`, and the `in_replay` flag in scope.

**Implications:** Substring pre-filter (`"\"type\":\"tool_use\""` etc.) before a full
`serde_json` parse, so only tool lines pay deserialization — same trade the existing
intercepts document.

#### [P04] Exact attribution records on successful tool_result only (DECIDED) {#p04-result-gated}

**Decision:** A Write/Edit/NotebookEdit event is persisted when its `tool_result` arrives
with `is_error: false` — never at `tool_use` time.

**Rationale:** Denied and errored calls (permission refusal, `old_string` not found) must not
pollute the record. `ToolResult` frames carry only `tool_use_id`/`output`/`is_error`
(`tugcode/src/types.ts` `ToolResult`), so the loop keeps a pending map
`tool_use_id → (tool_name, file_path, parent_tool_use_id)` populated at `tool_use` time and
consumed at `tool_result` time.

**Implications:** The pending map is relay-local and size-capped with oldest-entry
eviction (a few hundred entries; each is tiny). It is NOT cleared on `turn_complete`:
`subagent-tail.ts` re-emits a background agent's child frames on a ~250ms poll while the
parent turn may already be over, so a child's `tool_use` can precede a `turn_complete` and
its `tool_result` follow it — clearing at the turn boundary would orphan exactly the edits
this feature exists to catch.

#### [P05] Fingerprint bracketing for Bash only; overlap → ambiguous (DECIDED) {#p05-bracketing}

**Decision:** Bash is the one opaque mutator. On a Bash `tool_use`, snapshot the working
tree (`git status --porcelain=v2` → path→state map); on its successful `tool_result`,
snapshot again and attribute the delta to that call with `origin='bash'`. If another
session's bracket on the same repo root overlapped the window, the delta rows get
`ambiguous=1` — recorded, never guessed. Subagent frames (`parent_tool_use_id` set) get the
same treatment per-call: exact for nested Write/Edit, bracketed for nested Bash.

**Rationale:** Subagent calls flow through the stream (foreground natively; background via
`tugcode/src/subagent-tail.ts` re-emission), so no Task-level bracketing is needed. Bracket
overlap across sessions on one checkout is rare; honesty beats cleverness.

**Implications:** A shared bracket registry keyed by canonical repo root, owned by
`AgentSupervisor` and handed to each relay (relays for different sessions must see each
other's open brackets).

#### [P06] Replay backfills exact events idempotently (DECIDED) {#p06-replay-backfill}

**Decision:** Replay-bracketed `tool_use`/`tool_result` frames (the `in_replay` path) ARE
processed for exact attribution, upserted idempotently; Bash frames in replay are skipped
(no fingerprint is reconstructable after the fact).

**Rationale:** Resume re-emits the full persisted history — processing it means a session
started before this feature (or a reconnect re-stream from `subagent-tail`'s offset-0
replay) converges to the same rows. Idempotency comes from the primary key.

**Implications:** PK `(tug_session_id, tool_use_id, file_path)` with
`INSERT ... ON CONFLICT DO NOTHING`. Replay frames carry `timestamp` (epoch ms) — use it as
`at` so backfilled rows keep historical time.

#### [P07] TUG_SESSION_ID env self-identification (DECIDED) {#p07-env-id}

**Decision:** tugcast sets `TUG_SESSION_ID=<tug_session_id>` on the tugcode spawn (next to
the `env_remove` auth-scrub calls in `agent_bridge.rs`); tugcode's `scrubbedEnv` passes it
through to claude; claude passes env to Bash tool calls. Skills and CLIs self-identify from
the variable.

**Rationale:** Closes the "which session am I?" gap without any protocol change. Verified:
the chain currently strips only the three auth keys.

**Implications:** `tugutil changes` (and future tooling) reads `TUG_SESSION_ID` with a
`--session` override.

#### [P08] Query surface = `tugutil changes`, direct read-only sqlite (DECIDED) {#p08-query-surface}

**Decision:** M01's query surface is a `tugutil changes` subcommand that opens `sessions.db`
read-only, joins `file_events` for the session against current `git status`, and prints
plain or `--json` output. No HTTP endpoint in M01.

**Rationale:** Avoids port/instance discovery inside skill prose (the commit skill bans
heredocs/`cd`; a bare `tugutil changes --json` is one clean command). WAL read-only opens
are safe cross-process. The card gets its data via the feed, not HTTP, so nothing else needs
an endpoint yet. Living in tugutil is acceptable residual grab-bag: `changes` is a query,
not the worktree capability that becomes `tugdash` ([P12]).

**Implications:** `tugutil` gains a `rusqlite` dependency (read-only open flags) and reuses
`tugutil-core/src/paths.rs` conventions; sessions.db path resolution must match
`SessionLedger::default_path`.

#### [P09] CHANGESET is a workspace-scoped snapshot feed with event-driven bumps (DECIDED) {#p09-feed-shape}

**Decision:** `FeedId::CHANGESET = 0x23`, a `SnapshotFeed` owned by `WorkspaceEntry` beside
`GitFeed`, splicing `workspace_key`. It recomputes on (a) a bump signal fired by the
attribution intercept after each file-event write, (b) the existing 2s poll as fallback for
external edits.

**Rationale:** A changeset is a property of a checkout, not a conversation — the card shows
*all* sessions' work on one project. Bump-on-event delivers the "never out of date" feel;
the poll catches hand edits.

**Implications:** `agent_bridge` needs a handle to signal the right workspace's feed — a
`tokio::sync::watch`/`Notify` registered per repo root in `WorkspaceRegistry`
(`find_entry_by_path` already maps project_dir → entry).

#### [P10] Wire types: Rust authoritative, TS mirrored, golden-fixture guarded (DECIDED) {#p10-wire-types}

**Decision:** `ChangesetSnapshot` and friends are defined in
`tugrust/crates/tugcast-core/src/types.rs` (serde snake_case, like `GitStatus`); the TS
mirror lives in one tugdeck module; a checked-in golden JSON fixture is deserialized by a
Rust test and validated by a bun test, so drift fails CI on either side.

**Rationale:** Full codegen is a phase of its own; the hand-mirror + comment idiom (today's
`GitStatus`) has no guard at all. The fixture is the cheap middle.

**Implications:** New fixture file under `tugdeck/src/__tests__/fixtures/` (or sibling)
referenced from both test suites.

#### [P11] Scribe = one-shot `claude -p` spawned by tugcast (DECIDED) {#p11-scribe}

**Decision:** Summaries and commit messages come from a headless sidecar: tugcast spawns
`claude -p --output-format text --model <scribe_model>` with a composed prompt (scoped diff +
the owner's recent user prompts from the `turns` table + dash-log lines for dashes), env
auth-scrubbed exactly like the tugcode spawn. Modeled on the `ChildSpawner` pattern
(`TugpulseSpawner` in `feeds/pulse.rs`) for testability.

**Rationale:** User decision (headless sidecar; never disturbs the working session). claude
CLI is already a hard dependency; `-p` needs no session ledger, no transcript, no resume.

**Implications:** A `changeset_summarize` CONTROL verb; a spawner trait so tests fake the
child; 60s timeout; result returned as a CONTROL response (request/response, not a feed).

#### [P12] tugdash: standalone binary + tugdash-core crate (DECIDED) {#p12-tugdash}

**Decision:** Dash leaves the tugutil grab bag: new crates `tugrust/crates/tugdash-core`
(library: all dash logic, callable from tugcast) and `tugrust/crates/tugdash` (CLI:
`create/commit/join/release/list/show`). `tugutil dash` is deleted in the same milestone;
tugplug skills cut over.

**Rationale:** User decision on the name. Core/CLI split is the precondition for the card
driving create/commit/join through the same code as the CLI.

**Implications:** `tugutil-core/src/dash.rs` and `tugutil/src/commands/dash.rs` move (git
history preserved via plain moves in one commit); `justfile`/build/packaging gain the new
binary; `instance::reap_instance_tmux` dependency moves or is re-exposed.

#### [P13] Worktrees live in `.tug/worktrees/`; auto-migrate from `.tugtree/` (DECIDED) {#p13-worktree-home}

**Decision:** New worktree path: `<repo>/.tug/worktrees/<sanitized-name>`, git-ignored via a
`.tug/` entry. Any tugdash command that finds `.tugtree/` worktrees migrates them with
`git worktree move` when safe (clean worktree, no live instance), else warns and proceeds
against the old path.

**Rationale:** User decision (in-repo, new name). `.tug/` gives Tug one dot-directory to
grow into rather than another tool-specific name.

**Implications:** `tugutil init`'s gitignore block updates (it currently writes `.tugtree/`);
`worktree_path()` in the moved core changes; migration must handle the tmux-holding-files
race that `remove_dash_worktree` already documents.

#### [P14] Join engine v2: strategies, merge-tree preview, intersection preflight, journal (DECIDED) {#p14-join-v2}

**Decision:** `tugdash join` gains `--strategy squash|merge|rebase` (default squash,
preserving today's behavior), `--preview` (in-memory `git merge-tree --write-tree
<base> <branch>`, reporting conflict files without touching any worktree), an
intersection-aware preflight (base dirt is only blocking when it intersects the dash's
changed file set `git diff --name-only <base>...<branch>` ∪ worktree dirt), and a join
journal in the project state dir making teardown resumable (`tugdash join --continue`).

**Rationale:** These four are the concrete fixes for the observed pain: squash-only history
loss, dead-end conflicts, "commit or stash first" false positives, and non-atomic teardown
(warn-pile). The auto-commit that currently ignores its exit status (`let _ =` in
`run_dash_join`) becomes a hard error.

**Implications:** Conflict output is structured (`--json` lists conflicted paths) so the card
can render it and offer AI-assisted resolution ([#step-21]).

#### [P15] Commit-from-card stages exactly the changeset's files (DECIDED) {#p15-card-commit}

**Decision:** The `changeset_commit` CONTROL verb takes `{project_dir, files[], message}`,
runs `git add -- <files...>` then `git commit -m <message>` in `project_dir`, and responds
with the `git show --numstat --format= HEAD` receipt (the commit skill's receipt idiom).
Files that are `ambiguous=1` or multi-owned (`shared: true`, see #snapshot-composition) are
excluded from the card's default selection and require explicit user inclusion.

**Rationale:** This is the session-scoped `git add` the commit skill does by inference, done
by construction. Ambiguity and shared-ownership policy resolves the brief's open item:
visible badge, opt-in commit — one session's commit never silently sweeps another's file.

**Implications:** The verb refuses an empty `files` list and never falls back to `git add .`.

#### [P16] Git card and GitFeed retire at M02 close (DECIDED) {#p16-git-card-retirement}

**Decision:** `ChangesetSnapshot` embeds the branch/ahead-behind/HEAD data (the feed reuses
`parse_porcelain_v2` and the poll loop from `feeds/git.rs`); once the Changeset card renders
it, `registerGitCard()` and `GitFeed` are removed, along with the Swift "New Git Card" menu
item (`tugapp/Sources/AppDelegate.swift` `newGitCard`) which becomes "New Changeset Card".

**Rationale:** Two cards polling the same repo is waste; the brief says the git card
retires.

**Implications:** FeedId `0x20` (GIT) is retired from registration but the constant remains
reserved (never reuse); `GIT_DIFF`/`GIT_DIFF_QUERY` (0x21/0x22) survive — the dev card's
`/diff` and the Changeset card both use them after Step 13.

---

### Deep Dives {#deep-dives}

#### The attribution pipeline, end to end {#attribution-pipeline}

```
claude stream-json ─▶ tugcode session.ts (assembles ToolUse{input}, ToolResult)
  ─▶ tugcode stdout (one JSON line per frame)
  ─▶ tugcast agent_bridge.rs relay loop            ◀── INTERCEPT HERE [P03]
        tool_use:    pending[tool_use_id] = {tool_name, file_path|command, parent_id}
                     Bash → open bracket (pre-snapshot)             [P05]
        tool_result: is_error? drop : persist file_events rows      [P04]
                     Bash → close bracket (post-snapshot, delta)
                     → bump workspace ChangesetFeed                 [P09]
        (pending map: size-capped, evict-oldest — never cleared on turn_complete;
         background-agent child frames straddle turn boundaries)
  ─▶ splice_tug_session_id ─▶ FeedId::CODE_OUTPUT (unchanged, always)
```

Key shapes (from `tugcode/src/types.ts`): `ToolUse{type:"tool_use", tool_name, tool_use_id,
input: object, parent_tool_use_id?, timestamp?}`; `ToolResult{type:"tool_result",
tool_use_id, output, is_error, timestamp?}`. The result does NOT carry the tool name or
input — hence the pending map. `tool_input_progress` frames are display telemetry and are
ignored by attribution.

Exact-attribution tool names and their path fields: `Write`→`input.file_path`,
`Edit`→`input.file_path`, `MultiEdit`→`input.file_path` (legacy, still handled),
`NotebookEdit`→`input.notebook_path`. Paths are stored as given (absolute); repo-relative
projection happens at query time against `project_dir`.

#### Bracket algorithm {#bracket-algorithm}

A bracket registry `Mutex<HashMap<RepoRoot, Vec<OpenBracket>>>` lives on `AgentSupervisor`
and is cloned into every relay. `OpenBracket{tug_session_id, tool_use_id, opened_at,
pre: HashMap<PathBuf, FileState>}` where `FileState` is the porcelain-v2 XY status plus
mtime. Repo root = the same ancestor walk `is_within_git_worktree` uses (`feeds/git.rs`);
non-repo project dirs never open brackets.

On close: `delta = paths where post != pre (added / removed / status-changed)`. Each delta
path becomes a `file_events` row with `origin='bash'`, `op` derived from the transition
(created/modified/deleted/renamed). `ambiguous=1` iff any *other* session's bracket on the
same root overlapped `[opened_at, closed_at]`. Brackets abandoned by a dying relay are
dropped with the relay (registry entries carry the session id; relay teardown sweeps them).

Known limitation, by design: a `run_in_background` Bash command returns its `tool_result`
immediately, so writes the detached command makes after the bracket closes land as
unattributed. Do not hold brackets open to chase this — unattributed-but-visible is the
honest answer (see Non-goals).

#### ChangesetSnapshot composition {#snapshot-composition}

The feed recomputes by: (1) run the `GitFeed` status parse (branch, ahead/behind, head,
staged/unstaged/untracked); (2) query `file_events` for all sessions whose ledger rows have
`project_dir` = this workspace (join through the `sessions` table; owner display name =
session `name` when `name_user_set`, else the id hash — same rule the Z4B chip uses); (3)
derive dash entries the way `run_dash_list` does (`git for-each-ref refs/heads/tugdash/`,
config `branch.<b>.tugbase`, worktree dirt); (4) partition dirty files: owned (event row
exists), ambiguous, unattributed. **Multi-owner rule:** a file with event rows from more
than one owner (e.g. an exact row from session A and a bash row from session B) appears in
*each* owning changeset with `shared: true`; shared files, like ambiguous ones, are excluded
from the card's default commit selection ([P15]) — one session's commit must never silently
sweep a file another session also touched. Committed-but-unpushed work appears via
ahead-count only — per-owner committed history is not in the M02 snapshot.

#### Replay/idempotency invariant {#replay-idempotency}

Any frame may be seen more than once per row lifetime (resume replays full history;
`subagent-tail.resetForReplay()` re-streams background-agent children from offset 0 on
reconnect). The invariant: **persisting a file event is an upsert keyed
`(tug_session_id, tool_use_id, file_path)`; processing the same frame twice is a no-op.**
Brackets never open in replay (`in_replay` guard) — [P06]. Note one asymmetry: reconnect
re-streams of subagent children arrive as LIVE frames (not `in_replay`). This is benign and
needs no special handling — re-streamed exact events upsert into existing rows, and a
re-streamed Bash child re-opens a bracket whose close computes an empty delta (the disk
hasn't changed), recording nothing. Do not add a dedup layer for this case.

---

### Specification {#specification}

**Spec S01: `file_events` schema** {#s01-file-events-schema}

```sql
CREATE TABLE IF NOT EXISTS file_events (
    tug_session_id TEXT NOT NULL,
    tool_use_id    TEXT NOT NULL,
    file_path      TEXT NOT NULL,   -- as given by the tool input / bracket delta (absolute)
    tool_name      TEXT NOT NULL,   -- Write | Edit | MultiEdit | NotebookEdit | Bash
    op             TEXT NOT NULL,   -- write | edit | notebook | created | modified | deleted | renamed
    origin         TEXT NOT NULL,   -- exact | bash | replay
    ambiguous      INTEGER NOT NULL DEFAULT 0,
    parent_tool_use_id TEXT,        -- set for subagent-issued calls
    project_dir    TEXT NOT NULL,   -- checkout root at event time (worktree-aware)
    at             INTEGER NOT NULL,-- epoch ms (frame time live; ToolUse.timestamp on replay)
    PRIMARY KEY (tug_session_id, tool_use_id, file_path)
);
CREATE INDEX IF NOT EXISTS file_events_project ON file_events(project_dir, at);
CREATE TRIGGER IF NOT EXISTS file_events_cascade_delete_on_session ...  -- same idiom as turns
```

Bash rows use the bracket's `tool_use_id`; a Bash call touching N files yields N rows.

**Spec S02: `ChangesetSnapshot` wire shape (CHANGESET feed, 0x23)** {#s02-changeset-snapshot}

```jsonc
{
  "workspace_key": "…",              // spliced first, like GIT frames
  "branch": "main", "ahead": 0, "behind": 0,
  "head_sha": "…", "head_message": "…",
  "changesets": [
    { "kind": "session", "owner_id": "<tug_session_id>", "display_name": "…",
      "live": true,
      "files": [ { "path": "tugdeck/src/foo.ts", "git_status": "M ",
                   "op": "edit", "origin": "exact", "ambiguous": false,
                   "shared": false, "last_touched": 0 } ] },
    { "kind": "dash", "owner_id": "tugdash/fix-join", "display_name": "fix-join",
      "base": "main", "rounds": 3, "worktree": ".tug/worktrees/tugdash__fix-join",
      "worktree_dirty": false, "files": [ /* base..branch name-status */ ] }
  ],
  "unattributed": [ { "path": "…", "git_status": "??" } ]
}
```

Paths in the snapshot are repo-relative. Rust structs in `tugcast-core/src/types.rs`; TS
mirror + golden fixture per [P10].

**Spec S03: CONTROL verbs** {#s03-control-verbs}

Handled in `AgentSupervisor::handle_control` alongside `spawn_session`/`list_sessions`:

- `changeset_commit {project_dir, files: [repo-relative…], message}` →
  `changeset_commit_ok {sha, receipt}` | `changeset_commit_err {detail}`. Runs
  `git add -- <files…>` + `git commit -m`; receipt = `git show --numstat --format= HEAD`.
- `changeset_summarize {project_dir, owner_kind, owner_id, files, kind: "summary"|"commit_message"}`
  → `changeset_summarize_ok {text}` | `…_err {detail}` ([P11]).
- `changeset_join {project_dir, dash, strategy?, message?, preview: bool}` →
  `changeset_join_ok {…}` with, for preview, `{clean: bool, conflicts: [path…]}` ([P14],
  M04 — the verb calls `tugdash-core`).

**Spec S04: `tugutil changes` output** {#s04-tugutil-changes}

`tugutil changes [--session <tug_session_id>] [--project <dir>] [--json]`. Session defaults
from `$TUG_SESSION_ID`; project from cwd. Joins event rows against `git status --porcelain=v2`
so vanished/committed files drop out. Plain output: one repo-relative path per line,
**excluding ambiguous rows**, with a one-line stderr note when any were excluded
("N ambiguous file(s) omitted — use --json"). `--json` (the commit-skill contract):
`{session, project, files: [{path, op, origin, ambiguous, git_status}]}` — includes
ambiguous rows with the flag set. Exit 2 when the session id is missing/unknown.

**Spec S05: `tugdash` CLI surface** {#s05-tugdash-cli}

`tugdash create <name> [--description] [--json]` · `tugdash commit <name> --message … [--json]`
(stdin round-meta preserved) · `tugdash join <name> [--strategy squash|merge|rebase]
[--preview] [--continue] [--message] [--json]` · `tugdash release <name>` · `tugdash list
[--json]` · `tugdash show <name> [--json]`. Behavior identical to today's `tugutil dash`
except: new worktree home ([P13]), join engine v2 ([P14]), auto-commit failure is fatal.

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| ChangesetSnapshot (feed data) | local-data (external) | `FeedStore` → `useCardData<ChangesetSnapshot>()` (already `useSyncExternalStore`-backed via `useCardFeedStore`) | [L02] |
| Section expand/collapse per owner | local-data (ephemeral UI) | `useState` in the card component | — |
| File selection for commit | local-data (ephemeral UI) | `useState` (cleared on snapshot change when selected paths vanish) | — |
| Commit/summarize in-flight + result | local-data (external, async verb round-trip) | small module store + `useSyncExternalStore` (CONTROL request/response, like other verb stores) | [L02] |
| Diff sheet visibility/content | local-data (external) | existing `git-diff-store.ts` pattern (extended for pathspec) | [L02] |
| Hover/active row appearance | appearance | CSS only | [L06] |

No new persistent UI state; nothing touches localStorage. Read-only file lists render no
tabindex (mousedown-focus default gotcha).

---

### Compatibility / Migration / Rollout {#rollout}

- **sessions.db**: additive table + trigger via the existing self-healing `bootstrap_schema`
  guard; older tugcast binaries ignore it. No version bump needed (matches how
  `pulse_lines` was added).
- **`.tugtree/` → `.tug/worktrees/`**: auto-migration per [P13]; `tugutil init --force`
  refreshes the gitignore block; `.tugtree/` gitignore line is left in place (harmless) but
  new inits write only `.tug/`.
- **`tugutil dash` removal**: same-milestone cutover of tugplug skills ([#step-20]); no
  deprecation alias. The skills are the only programmatic callers and they update in
  lockstep; a stray `tugutil dash` invocation gets clap's unknown-subcommand error, and
  tugdash ships in the same commit series.
- **Feeds**: CHANGESET (0x23) is additive; GIT (0x20) stops being registered at M02 close
  ([P16]) — old decks reconnect and simply never receive 0x20 frames (snapshot feeds are
  absent-tolerant: the git card shows its loading state, and the card itself is removed in
  the same release).
- **Rollback**: each milestone is revertible independently; attribution rows are advisory
  data (nothing else keys on them).

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New crates {#new-crates}

| Crate | Purpose |
|-------|---------|
| `tugrust/crates/tugdash-core` | Dash/worktree library: naming, create/commit/join/release/list/show, join engine v2, migration; callable from tugcast |
| `tugrust/crates/tugdash` | The standalone CLI binary over tugdash-core |

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugrust/crates/tugcast/src/feeds/attribution.rs` | Tool-frame parsing (`InspectedToolUse`/`InspectedToolResult`), pending map, bracket registry, `record_file_event` glue |
| `tugrust/crates/tugcast/src/feeds/changeset.rs` | `ChangesetFeed` (SnapshotFeed) + snapshot composition |
| `tugrust/crates/tugcast/src/scribe.rs` | `ScribeSpawner` trait + `ClaudeScribeSpawner` (`claude -p`), prompt composition |
| `tugrust/crates/tugutil/src/commands/changes.rs` | `tugutil changes` |
| `tugdeck/src/components/tugways/cards/changeset-card.tsx` | The Changeset card + `registerChangesetCard()` |
| `tugdeck/src/lib/changeset-types.ts` | TS mirror of the wire types |
| `tugdeck/src/lib/changeset-verb-store.ts` | commit/summarize round-trip store |
| `tugdeck/src/__tests__/fixtures/changeset-snapshot.golden.json` | Golden contract fixture ([P10]), referenced by both the Rust and bun contract tests |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `file_events` table + `record_file_event` / `file_events_for_session` / `file_events_for_project` | sql + fns | `tugcast/src/session_ledger.rs` | Spec S01; cascade trigger idiom from `turns` |
| tool intercept branches | code | `tugcast/src/feeds/agent_bridge.rs` (relay loop `else if` chain) | [P03]–[P06]; pending map + bracket open/close |
| `TUG_SESSION_ID` env | code | `agent_bridge.rs` tugcode spawn (`Command` next to `env_remove` calls) | [P07] |
| `FeedId::CHANGESET = 0x23` | const | `tugcast-core/src/protocol.rs` + `tugdeck/src/protocol.ts` | [P09] |
| `ChangesetSnapshot`, `ChangesetEntry`, `ChangesetFile` | structs | `tugcast-core/src/types.rs` | Spec S02 |
| `ChangesetFeed` wiring | code | `tugcast/src/feeds/workspace_registry.rs` (`WorkspaceEntry::new`, watch channel, `spawn_snapshot_feed`) + `tugcast/src/main.rs` (`add_snapshot_watches`) | beside GitFeed |
| `changeset_commit` / `changeset_summarize` / `changeset_join` | verbs | `tugcast/src/feeds/agent_supervisor.rs` `handle_control` | Spec S03 |
| pathspec on diff query | code | `tugcast/src/main.rs` GIT_DIFF adapter + `feeds/git.rs` `build_git_diff_snapshot` + `tugdeck/src/lib/git-diff-store.ts` | Step 13 |
| `registerGitCard` removal, `newGitCard` → `newChangesetCard` | code | `tugdeck/src/main.tsx`, `tugdeck/src/components/tugways/cards/git-card.tsx` (deleted), `tugapp/Sources/AppDelegate.swift` | [P16] |
| skills cutover | docs | `tugplug/skills/{commit,implement,dash}/SKILL.md`, `tugplug/CLAUDE.md` | Steps 6, 20 |

---

### Documentation Plan {#documentation-plan}

- [ ] `tuglaws/design-decisions.md`: promote durable decisions (attribution invariant,
      CHANGESET feed scope, tugdash naming) to `[D##]` entries at phase close.
- [ ] `CLAUDE.md`: repository-structure table row for `tugdash`; commit-skill note if its
      contract wording changes.
- [ ] `tugplug/skills/*/SKILL.md` updates are execution-step artifacts (Steps 6, 20), not
      an afterthought.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | ledger upsert idempotency, tool-frame parsing, bracket delta math, porcelain parsing reuse, join preflight intersection logic | core logic |
| **Integration** | relay-loop intercepts against synthetic tugcode stdout (existing agent_bridge test idiom), `tugutil changes` against a temp repo + temp sessions.db, tugdash lifecycle against a scratch git repo | end-to-end within a process |
| **Golden / Contract** | ChangesetSnapshot fixture parsed by Rust + TS ([P10]) | wire format |
| **App-test** | Changeset card renders grouped snapshot in the real app; commit-from-card round trip on a scratch repo | `just app-test`, real Tug.app |

#### What stays out of tests {#test-non-goals}

- jsdom/fake-DOM render tests and mock-store assertions — banned; the card is exercised by
  app-tests against the real app on real content.
- Scribe output *quality* — we test spawn/timeout/error paths with a fake `ScribeSpawner`,
  never assert on model prose; real-claude runs are on-demand only.
- Migration against every historical `.tugtree` shape — covered for the current layout only;
  the fallback path (warn + continue on old path) is the safety net.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** Rust checkpoints run from `tugrust/`
> (`cargo nextest run` — warnings are errors); tugdeck checkpoints require
> `bunx tsc --noEmit` and `bunx vite build`; tugcode requires `bun test` and a binary
> rebuild. Commits are made by the user (or per the autonomous/dash exceptions in
> CLAUDE.md).

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | file_events table + ledger API | done | 8cd2c31bf |
| #step-2 | TUG_SESSION_ID env plumbing | done | a68ea0145 |
| #step-3 | Exact attribution intercept + replay backfill | done | 2c406e7a3 |
| #step-4 | Bash fingerprint bracketing | done | 0e529e2b2 |
| #step-5 | tugutil changes | done | 930cb51f1 |
| #step-6 | Commit-skill rewire | done | cef2a9e7b |
| #step-7 | M01 integration checkpoint | done | (verification only) |
| #step-8 | Changeset wire types + golden fixture | done | 9a5a5aa02 |
| #step-9 | ChangesetFeed + bump channel | done | 6567e92be |
| #step-10 | Changeset card (read-only) | done | bb712bf4d |
| #step-11 | Git card + GitFeed retirement | done | 60eadf0a7 |
| #step-12 | M02 integration checkpoint | done | (verification only) |
| #step-13 | Pathspec diff query | pending | — |
| #step-14 | changeset_commit verb + card commit flow | pending | — |
| #step-15 | Scribe sidecar + summarize verb + card UI | pending | — |
| #step-16 | M03 integration checkpoint | pending | — |
| #step-17 | tugdash-core + tugdash CLI extraction | pending | — |
| #step-18 | .tug/worktrees home + migration | pending | — |
| #step-19 | Join engine v2 | pending | — |
| #step-20 | Skill + packaging cutover | pending | — |
| #step-21 | Card dash integration + AI conflict assist | pending | — |
| #step-22 | M04 / phase exit checkpoint | pending | — |

**Milestone M01: Attribution engine** {#m01-attribution} — steps 1–7.
**Milestone M02: Changeset feed + read-only card** {#m02-card} — steps 8–12.
**Milestone M03: Card actions** {#m03-actions} — steps 13–16.
**Milestone M04: tugdash** {#m04-tugdash} — steps 17–22.

---

#### Step 1: file_events table + ledger API {#step-1}

**Commit:** `feat(tugcast): file_events table and SessionLedger attribution API`

**References:** [P01] Ownership, [P02] file_events home, [P06] Replay idempotency, Spec S01,
Milestone M01, (#attribution-pipeline, #replay-idempotency)

**Artifacts:**
- `file_events` table, index, cascade trigger in `bootstrap_schema`
  (`tugrust/crates/tugcast/src/session_ledger.rs`), following the `turns` idiom including the
  self-healing column guard.
- Ledger methods: `record_file_event(&FileEventRow)` (upsert, `ON CONFLICT DO NOTHING`),
  `file_events_for_session(tug_session_id)`, `file_events_for_project(project_dir)`
  (joined with `sessions` for owner display fields).

**Tasks:**
- [ ] Add `FileEventRow` struct (fields per Spec S01) and the three methods.
- [ ] Wire the cascade trigger to `sessions` deletion like `turns_cascade_delete_on_session`.

**Tests:**
- [ ] Upsert idempotency: same `(session, tool_use_id, path)` twice → one row.
- [ ] Cascade: deleting a session row removes its events.
- [ ] Schema self-heal: drifted `file_events` table is rebuilt (mirror the existing
      `turn_telemetry` drift test).

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 2: TUG_SESSION_ID env plumbing {#step-2}

**Commit:** `feat(tugcast): expose TUG_SESSION_ID to the session subprocess chain`

**References:** [P07] Env self-identification, Milestone M01, (#assumptions)

**Artifacts:**
- `.env("TUG_SESSION_ID", tug_session_id)` on the tugcode spawn in
  `tugrust/crates/tugcast/src/feeds/agent_bridge.rs` (the `Command` that carries the three
  `env_remove` auth-scrub calls).
- Verification that tugcode's `scrubbedEnv` (`tugcode/src/session.ts`) passes it through
  unmodified (it destructures out only the three auth keys — expected no code change; add a
  comment noting the variable is load-bearing for `tugutil changes`).

**Tasks:**
- [ ] Set the env var; keep the comment block that says the scrub list must stay in sync.

**Tests:**
- [ ] tugcast integration test (existing agent_bridge harness): spawned fake-tugcode sees
      `TUG_SESSION_ID` in its environment.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`
- [ ] Manual: in a live Dev-card session, `echo $TUG_SESSION_ID` from a Bash tool call prints
      the session id shown by the Z4B chip.

---

#### Step 3: Exact attribution intercept + replay backfill {#step-3}

**Depends on:** #step-1

**Commit:** `feat(tugcast): attribute Write/Edit/NotebookEdit file events in the relay loop`

**References:** [P03] Intercept point, [P04] Result-gated, [P06] Replay backfill, Spec S01,
Milestone M01, (#attribution-pipeline, #replay-idempotency)

**Artifacts:**
- `tugrust/crates/tugcast/src/feeds/attribution.rs`: `InspectedToolUse` /
  `InspectedToolResult` (serde structs over the `ToolUse`/`ToolResult` line shapes from
  `tugcode/src/types.ts` — `tool_name`, `tool_use_id`, `input.file_path` /
  `input.notebook_path`, `parent_tool_use_id`, `timestamp`, `is_error`), plus a
  `PendingCalls` map type.
- New `else if` branches in the relay loop (`agent_bridge.rs`, beside the `turn_complete` /
  `system_metadata` intercepts): `tool_use` populates the pending map; `tool_result` with
  `is_error:false` resolves it to `record_file_event` rows (`origin='exact'` live,
  `'replay'` when `in_replay`; `at` from `timestamp` when present). The pending map is
  size-capped with oldest-entry eviction and is never cleared on `turn_complete` — a
  background agent's child `tool_use`/`tool_result` pair can straddle a turn boundary
  (subagent-tail re-emission), and clearing would orphan it. All failure paths forward the
  frame unchanged.

**Tasks:**
- [ ] Substring pre-filters (`"\"type\":\"tool_use\""`, `"\"type\":\"tool_result\""`) before
      full parse, matching the documented perf trade of the existing intercepts.
- [ ] Handle `MultiEdit` alongside Write/Edit/NotebookEdit; ignore all other tool names here
      (Bash is Step 4).
- [ ] Store `project_dir` from `ledger_entry` on each row (worktree sessions record their
      worktree root).

**Tests:**
- [ ] Relay integration test (existing fake-tugcode stdout idiom): a
      tool_use(Write)+tool_result(ok) pair yields one row; is_error yields none; frames are
      forwarded byte-identical either way.
- [ ] Replay-bracketed frames with `timestamp` backfill rows with historical `at`; replaying
      twice leaves the count unchanged.
- [ ] Subagent frame (`parent_tool_use_id` set) records the parent id.
- [ ] Straddle: a `tool_use` before a `turn_complete` with its `tool_result` after still
      records (the map survives the turn boundary); eviction test at the size cap.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 4: Bash fingerprint bracketing {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugcast): bracket Bash tool calls with working-tree fingerprints`

**References:** [P05] Bracketing, Risk R01, Spec S01, Milestone M01, (#bracket-algorithm)

**Artifacts:**
- Bracket registry (`attribution.rs`): `OpenBracket`, per-repo-root vec, owned by
  `AgentSupervisor`, cloned into relays; snapshot helper running
  `git status --porcelain=v2` → `HashMap<PathBuf, FileState>` (reuse/parse via the
  porcelain-v2 machinery in `feeds/git.rs`; gate on its `is_within_git_worktree` walk).
- Relay-loop wiring: Bash `tool_use` opens a bracket (never in replay); successful Bash
  `tool_result` closes it, computes the delta, records rows (`origin='bash'`, `op` from the
  status transition, `ambiguous` per overlap rule); errored result still closes and records
  (a failing command can have mutated files before failing).
- Relay teardown sweeps the session's abandoned brackets.

**Tasks:**
- [ ] Delta classification: created / modified / deleted / renamed from pre/post XY states.
- [ ] Overlap detection across sessions on the same repo root.
- [ ] Feed-bump hook point stubbed (a no-op `Notify` until Step 9).

**Tests:**
- [ ] Unit: delta math over synthetic pre/post maps (create/modify/delete/rename).
- [ ] Integration (temp git repo): fake Bash bracket around an actual file write attributes
      the file; two overlapping brackets mark rows ambiguous; non-repo project dir opens no
      bracket.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 5: tugutil changes {#step-5}

**Depends on:** #step-1, #step-2

**Commit:** `feat(tugutil): changes subcommand — authoritative session file list`

**References:** [P07] Env self-identification, [P08] Query surface, Spec S04, Milestone M01

**Artifacts:**
- `tugrust/crates/tugutil/src/commands/changes.rs` + clap wiring in `tugutil/src/cli.rs`:
  read-only sqlite open of `sessions.db` (path logic mirroring
  `SessionLedger::default_path`, honoring the same env override if one exists), query
  `file_events` by session, join against `git status --porcelain=v2` run in `--project`/cwd,
  print plain paths or `--json` per Spec S04.

**Tasks:**
- [ ] `--session` flag defaulting from `$TUG_SESSION_ID`; exit 2 with a one-line hint when
      absent.
- [ ] Repo-relative path projection; drop rows whose files are no longer dirty (committed or
      reverted) from the default listing; `--all` keeps them.

**Tests:**
- [ ] Integration: temp sessions.db + temp repo → exact expected stdout for plain and
      `--json` forms; plain output omits ambiguous rows and notes the omission on stderr;
      JSON includes them with the flag set.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugutil`
- [ ] Manual, live session: `tugutil changes` from a Bash tool call lists the files this
      session edited and nothing else.

---

#### Step 6: Commit-skill rewire {#step-6}

**Depends on:** #step-5

**Commit:** `feat(tugplug): commit skill queries tugutil changes for session scope`

**References:** [P08] Query surface, Spec S04, Milestone M01

**Artifacts:**
- `tugplug/skills/commit/SKILL.md`: the "commit ONLY the files you changed in this session"
  section gains the authoritative path — run `tugutil changes --json` (one command, no
  heredoc, no `cd`) as the primary source of the session file list; retain the
  transcript-memory method as fallback when the command is unavailable (old tugcast,
  missing env) and keep the `git status`/`git diff` cross-check. The JSON form is
  mandatory for the skill: plain output silently omits ambiguous rows (Spec S04), and the
  skill must see the `ambiguous` flag to call those files out for judgment rather than
  stage them blindly.

**Tasks:**
- [ ] Update the Context-gathering and Stage-and-Commit sections; preserve the
      `git commit -m … && git --no-pager show --numstat --format= HEAD` receipt contract.

**Tests:**
- [ ] N/A (prose skill; behavior covered by the Step 7 live pass).

**Checkpoint:**
- [ ] Live dogfood: invoke `/tugplug:commit` in a session that edited files via Write AND via
      a Bash `sed`; the commit contains exactly those files.

---

#### Step 7: M01 integration checkpoint {#step-7}

**Depends on:** #step-3, #step-4, #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** Milestone M01, (#success-criteria)

**Tasks:**
- [ ] Two concurrent sessions on this repo: session A edits via Write, session B via Bash;
      `tugutil changes` in each lists only its own files; overlap case marks ambiguous.
- [ ] Resume session A; verify backfill idempotency (row counts stable across two resumes).

**Tests:**
- [ ] Full-suite pass.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run`
- [ ] `just app-test`

---

#### Step 8: Changeset wire types + golden fixture {#step-8}

**Depends on:** #step-1

**Commit:** `feat(tugcast-core): ChangesetSnapshot wire types with golden contract fixture`

**References:** [P10] Wire types, Spec S02, Milestone M02, (#snapshot-composition)

**Artifacts:**
- `ChangesetSnapshot` / `ChangesetEntry` / `ChangesetFile` in
  `tugrust/crates/tugcast-core/src/types.rs` (serde snake_case, beside `GitStatus`).
- TS mirror in `tugdeck/src/lib/changeset-types.ts`.
- Golden fixture JSON checked in; Rust test deserializes it; bun test validates the TS type
  guards against it.

**Tasks:**
- [ ] `FeedId::CHANGESET = 0x23` in `tugcast-core/src/protocol.rs` and
      `tugdeck/src/protocol.ts` (name `"changeset"`).

**Tests:**
- [ ] Round-trip serde test (Rust); fixture-validation test (bun).

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast-core`
- [ ] `cd tugdeck && bun test changeset && bunx tsc --noEmit`

---

#### Step 9: ChangesetFeed + bump channel {#step-9}

**Depends on:** #step-4, #step-8

**Commit:** `feat(tugcast): workspace ChangesetFeed with event-driven bumps`

**References:** [P09] Feed shape, [P16] Retirement (prep), Spec S02, Milestone M02,
(#snapshot-composition)

**Artifacts:**
- `tugrust/crates/tugcast/src/feeds/changeset.rs`: `ChangesetFeed` as a `SnapshotFeed`
  constructed in `WorkspaceEntry::new` (`workspace_registry.rs`) beside `GitFeed`, spawned
  via `spawn_snapshot_feed`, watch receiver added in `main.rs` `add_snapshot_watches`.
  Composition per #snapshot-composition; splices `workspace_key`; diff-suppressed emission
  like GitFeed.
- Bump channel: a `tokio::sync::Notify` per workspace, resolvable from the attribution code
  by repo root (`WorkspaceRegistry::find_entry_by_path`); the Step-4 stub now fires it. The
  feed selects on {notify, 2s interval, cancel}.
- Feed takes a `SessionLedger` handle (main.rs already owns one) for the event/owner joins,
  and derives dash entries via `git for-each-ref refs/heads/tugdash/` + config reads
  (the same commands `run_dash_list` uses — copied here until Step 17 provides
  tugdash-core to call).

**Tasks:**
- [ ] Owner display-name rule: ledger `name` when `name_user_set`, else id hash (the Z4B
      chip rule).
- [ ] Partition dirty files into owned / ambiguous / unattributed; mark multi-owned files
      `shared: true` in every owning changeset (#snapshot-composition).

**Tests:**
- [ ] Integration (temp repo + temp ledger): snapshot groups a session-owned file, a
      bracketed-ambiguous file, and an untracked hand-edit into the right buckets; a bump
      recomputes without waiting for the poll.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 10: Changeset card (read-only) {#step-10}

**Depends on:** #step-8, #step-9

**Commit:** `feat(tugdeck): changeset card — grouped multi-session view (read-only)`

**References:** [P01] Ownership, [P09] Feed shape, Spec S02, Milestone M02,
(#state-zone-mapping)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/changeset-card.tsx`: header (branch, ahead/behind,
  HEAD message — the git card's data, restyled), one collapsible section per changeset
  (session sections show display name + live dot; dash sections show base/rounds/worktree
  state), file rows with git-status glyph + op/origin provenance, ambiguous and shared
  badges, unattributed section, clean-tree empty state. `registerChangesetCard()` with
  `componentId: "changeset"`, `defaultFeedIds: [FeedId.CHANGESET]`, registered from
  `tugdeck/src/main.tsx`.

**Tasks:**
- [ ] Data via `useCardData<ChangesetSnapshot>()` (the git-card idiom — already
      `useSyncExternalStore`-backed).
- [ ] Compose Tug* components for chrome (no hand-rolled lookalikes); read-only rows carry
      no tabindex; appearance states in CSS only.
- [ ] Section expand/collapse as `useState`.

**Tests:**
- [ ] App-test: drive the real app against seeded state (scratch-repo dirt + pre-populated
      `file_events` rows in the ledger); assert the card renders the expected grouped
      sections, badges, and unattributed bucket (screenshot + DOM assertions per app-test
      conventions). Do NOT drive a real Claude session here — real-claude tests are
      on-demand only; the event-driven bump path is covered by Step 9's Rust integration
      test, and live-session behavior is Step 12's manual checkpoint.

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bunx vite build`
- [ ] `just app-test`

---

#### Step 11: Git card + GitFeed retirement {#step-11}

**Depends on:** #step-10

**Commit:** `feat(tugdeck,tugcast,tugapp): retire the git card; changeset card replaces it`

**References:** [P16] Retirement, Milestone M02

**Artifacts:**
- Delete `tugdeck/src/components/tugways/cards/git-card.tsx` and its `registerGitCard()`
  call in `main.tsx`; remove `GitFeed` construction from `WorkspaceEntry::new` and its
  watch from `main.rs` (keep `parse_porcelain_v2`/diff machinery — ChangesetFeed and
  GIT_DIFF use them); retire FeedId 0x20 registration (constant stays, commented reserved).
- `tugapp/Sources/AppDelegate.swift`: `newGitCard` (⇧⌘N, "New Git Card") becomes
  "New Changeset Card" sending `show-card` with `component: "changeset"`.

**Tasks:**
- [ ] Sweep for `FeedId.GIT` consumers on the deck side; confirm only the git card
      subscribed.

**Tests:**
- [ ] Existing git.rs parser tests keep passing (parser stays).

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` ; `cd tugdeck && bunx tsc --noEmit && bunx vite build`
- [ ] Build Tug.app; menu item opens the changeset card.

---

#### Step 12: M02 integration checkpoint {#step-12}

**Depends on:** #step-10, #step-11

**Commit:** `N/A (verification only)`

**References:** Milestone M02, (#success-criteria)

**Tasks:**
- [ ] Live: two sessions editing this repo; card shows both groups; a Write lands in the
      card within ~1s (bump path); a hand edit appears as unattributed within the poll
      interval.

**Tests:**
- [ ] Full-suite pass.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` ; `just app-test` ; `cd tugdeck && bunx vite build`

---

#### Step 13: Pathspec diff query {#step-13}

**Depends on:** #step-10

**Commit:** `feat(tugcast,tugdeck): pathspec-scoped git diff query for the changeset card`

**References:** [P16] Retirement (GIT_DIFF survives), Spec S02, Milestone M03

**Artifacts:**
- `GIT_DIFF_QUERY` (0x22) payload gains optional `paths: [repo-relative…]` (and
  `project_dir` where the adapter needs disambiguation); the adapter in
  `tugcast/src/main.rs` and `build_git_diff_snapshot` (`feeds/git.rs`) pass
  `-- <paths…>` through to `git diff HEAD`. Absent `paths` preserves today's whole-tree
  behavior (dev card `/diff` unchanged).
- `tugdeck/src/lib/git-diff-store.ts` extended for scoped requests; changeset card rows get
  a diff affordance opening the same sheet component the dev card uses, scoped to the
  file/changeset.

**Tasks:**
- [ ] Request/response correlation for concurrent scoped queries (include an echo token if
      the current store assumes one outstanding query).

**Tests:**
- [ ] Rust: scoped snapshot contains only requested paths.
- [ ] App-test: clicking a file row opens its diff.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast` ; `cd tugdeck && bunx tsc --noEmit && bunx vite build`
- [ ] `just app-test`

---

#### Step 14: changeset_commit verb + card commit flow {#step-14}

**Depends on:** #step-10

**Commit:** `feat(tugcast,tugdeck): commit a changeset from the card`

**References:** [P15] Card commit, Spec S03, Milestone M03, (#state-zone-mapping)

**Artifacts:**
- `changeset_commit` in `AgentSupervisor::handle_control` per Spec S03: validates non-empty
  files, runs `git add -- <files…>` + `git commit -m` in `project_dir`, replies ok with
  `{sha, receipt}` (numstat) or err with stderr detail; fires the workspace bump so the card
  refreshes instantly.
- `tugdeck/src/lib/changeset-verb-store.ts` (round-trip store, `useSyncExternalStore`);
  card UI: per-changeset file checkboxes (default: all non-ambiguous selected), message
  field, commit button (width-stabilized against its busy state), receipt rendering,
  error surface via TugAlert.

**Tasks:**
- [ ] Ambiguous and shared rows excluded from default selection with the badge explaining
      why ([P15], #snapshot-composition).
- [ ] Selection state reconciles when a snapshot removes files (committed elsewhere).
- [ ] The commit-message input is an editing surface: register the substrate responders
      (CUT/COPY/PASTE/SELECT_ALL/UNDO/REDO) via the standard responder hook
      (registration in `useLayoutEffect` per [L03]), or compose an existing Tug input
      component that already carries them — otherwise Cmd-A/C/X/V/Z go dead under the
      capture-phase preventDefault above the card.

**Tests:**
- [ ] Rust integration: verb commits exactly the listed files in a temp repo; refuses empty
      list; error path returns stderr.
- [ ] App-test: end-to-end card commit on a scratch repo; receipt shows the numstat.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast` ; `cd tugdeck && bunx tsc --noEmit && bunx vite build`
- [ ] `just app-test`

---

#### Step 15: Scribe sidecar + summarize verb + card UI {#step-15}

**Depends on:** #step-14

**Commit:** `feat(tugcast,tugdeck): headless scribe generates summaries and commit messages`

**References:** [P11] Scribe, [Q02] Scribe model, Spec S03, Milestone M03

**Artifacts:**
- `tugrust/crates/tugcast/src/scribe.rs`: `ScribeSpawner` trait + `ClaudeScribeSpawner`
  running `claude -p --output-format text --model <model>` (model from tugbank default
  `dev.tugtool.changeset`/`scribe_model`, fallback `haiku`), env-scrubbed like the tugcode
  spawn, 60s timeout. Prompt composition: scoped diff (Step 13 plumbing) + last N user
  prompts for the owner session(s) from the `turns` table + dash-log lines for dashes.
- `changeset_summarize` verb per Spec S03; card UI: "Summarize" and "Draft message" actions
  per changeset — the drafted message lands in the Step-14 message field, in-flight state on
  the verb store.

**Tasks:**
- [ ] Fake-spawner tests for timeout/error/success; never assert model prose.
- [ ] Scribe stderr → TugDevPanel log (`tugDevLogStore`), not console.

**Tests:**
- [ ] Rust: verb round trip with fake spawner; prompt composer includes diff + prompts +
      dash-log for each owner kind.
- [ ] On-demand real-claude smoke (not in the default suite, per app-test policy).

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast` ; `cd tugdeck && bunx tsc --noEmit && bunx vite build`
- [ ] Manual: draft a commit message from the card on a real diff.

---

#### Step 16: M03 integration checkpoint {#step-16}

**Depends on:** #step-13, #step-14, #step-15

**Commit:** `N/A (verification only)`

**References:** Milestone M03, (#success-criteria)

**Tasks:**
- [ ] Full card loop live: see change → open diff → draft message → commit → receipt →
      groups update; other session's files untouched.

**Tests:**
- [ ] Full-suite pass.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` ; `just app-test` ; `cd tugdeck && bunx vite build`

---

#### Step 17: tugdash-core + tugdash CLI extraction {#step-17}

**Commit:** `feat(tugdash): extract dash into tugdash-core + tugdash CLI`

**References:** [P12] tugdash, Spec S05, Milestone M04

**Artifacts:**
- `tugrust/crates/tugdash-core`: everything from `tugutil-core/src/dash.rs` (name
  validation, `detect_default_branch`, dash-log) plus the orchestration from
  `tugutil/src/commands/dash.rs` (`run_dash_create/commit/join/release/list/show`,
  `branch_name`, `worktree_path`, `remove_dash_worktree`, `reap_dash_tmux`) reshaped as a
  library API returning typed results (no printing). The tmux reap keeps calling
  `tugutil`'s instance module — move `instance` discovery helpers into a small shared
  location or re-expose them (decide at implementation: least-churn wins; note the current
  call `instance::reap_instance_tmux`).
- `tugrust/crates/tugdash`: clap CLI over the core, subcommands per Spec S05, `--json`
  everywhere, behavior-identical to `tugutil dash` at this step (join engine v2 is Step 19).
- `tugutil dash` subcommand deleted; `tugutil-core/src/dash.rs` deleted.

**Tasks:**
- [ ] Workspace `Cargo.toml` membership; `justfile`/packaging rows so `tugdash` ships beside
      `tugutil` in Tug.app resources.
- [ ] Port the existing dash tests to the new crates.

**Tests:**
- [ ] Existing dash lifecycle tests green under tugdash (create → commit → join → gone;
      idempotent create; release).

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugdash -p tugdash-core -p tugutil`

---

#### Step 18: .tug/worktrees home + migration {#step-18}

**Depends on:** #step-17

**Commit:** `feat(tugdash): worktrees move to .tug/worktrees with auto-migration`

**References:** [P13] Worktree home, Risk table (migration), Milestone M04, (#rollout)

**Artifacts:**
- `worktree_path()` → `<repo>/.tug/worktrees/<sanitized-name>`; `tugutil init` gitignore
  block writes `.tug/` (keeps recognizing `.tugtree/` as already-ignored).
- Migration pass on every tugdash command: for each `tugdash/*` branch whose worktree sits
  under `.tugtree/`, `git worktree move` to the new home when the worktree is clean and no
  live instance holds it (reuse the reap/instance checks `remove_dash_worktree` uses);
  otherwise warn once and operate on the old path.

**Tasks:**
- [ ] `list`/`show` report the actual path either way.

**Tests:**
- [ ] Integration: repo with a `.tugtree` worktree migrates on `tugdash list`; a dirty one
      doesn't and still joins from its old path.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugdash -p tugdash-core`

---

#### Step 19: Join engine v2 {#step-19}

**Depends on:** #step-17

**Commit:** `feat(tugdash): join strategies, preview, intersection preflight, journaled teardown`

**References:** [P14] Join v2, [P01] Ownership, Spec S05, Milestone M04, (#dependencies)

**Artifacts:**
- `--strategy squash|merge|rebase` (squash default; merge = `--no-ff` merge preserving
  rounds; rebase = rebase onto base then fast-forward).
- `--preview`: `git merge-tree --write-tree <base> <branch>` (git ≥2.38 guard with a clear
  error), structured `--json` conflict list, tree untouched.
- Intersection preflight replacing the clean-base gate: blocking only when base dirt ∩
  (dash changed set = `git diff --name-only <base>...<branch>` ∪ worktree dirt) ≠ ∅; the
  current not-on-base-branch guard stays. Optional deeper check against `file_events` for
  provenance display (read-only sessions.db open, the Step-5 machinery).
- Join journal in the project state dir (beside `dash-log.md`): phases
  merge→commit→worktree-remove→branch-delete recorded; `--continue` resumes after partial
  failure; the silent auto-commit (`let _ =`) becomes fatal-on-error.

**Tasks:**
- [ ] Conflict path: on real (non-preview) conflict, leave a clean abort (restore pre-join
      state) plus the structured conflict list — never today's mid-merge dead end.

**Tests:**
- [ ] Scratch-repo matrix: each strategy lands the expected history; preview reports a
      manufactured conflict without touching the tree; disjoint base dirt joins; overlapping
      base dirt refuses with the intersecting paths named; kill-between-phases then
      `--continue` completes.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugdash -p tugdash-core`

---

#### Step 20: Skill + packaging cutover {#step-20}

**Depends on:** #step-17, #step-18, #step-19

**Commit:** `feat(tugplug): skills drive tugdash; docs cut over`

**References:** [P12] tugdash, Spec S05, Milestone M04, (#documentation-plan)

**Artifacts:**
- `tugplug/skills/implement/SKILL.md`, `tugplug/skills/dash/SKILL.md`, `tugplug/CLAUDE.md`:
  every `tugutil dash …` becomes `tugdash …` (same flags; stdin round-meta unchanged);
  worktree-path prose updated to `.tug/worktrees/`; join prose mentions `--preview` before
  join.
- Root `CLAUDE.md`: repository-structure and Git-policy exception wording
  (`tugutil dash …` → `tugdash …`).

**Tasks:**
- [ ] Grep-sweep the repo for `tugutil dash` and `.tugtree` references (docs, tests,
      justfile, app-test helpers) and update.

**Tests:**
- [ ] N/A (prose + packaging; verified by Step 22 dogfood).

**Checkpoint:**
- [ ] `rg -n "tugutil dash|\.tugtree" --glob '!roadmap/**'` returns only intentional
      residue (migration code, this plan).

---

#### Step 21: Card dash integration + AI conflict assist {#step-21}

**Depends on:** #step-14, #step-19, #step-20

**Commit:** `feat(tugcast,tugdeck): join dashes from the changeset card with preview and AI assist`

**References:** [P14] Join v2, [P11] Scribe (sidecar precedent), Spec S03, Milestone M04

**Artifacts:**
- `changeset_join` verb (Spec S03) calling `tugdash-core`: preview and execute forms;
  responses carry the structured conflict list; workspace bump on completion.
- Card dash sections gain Join/Release actions: Join opens a preview pane (conflict list or
  clean bill) → confirm executes; on conflicts, a "Resolve with AI" affordance spawns a
  session in the dash worktree via the existing `spawn_session` CONTROL verb with an initial
  prompt naming the conflicted files and the join intent (the session opens as a normal Dev
  card bound to the worktree).

**Tasks:**
- [ ] Confirm-before-join (hard-to-reverse action); width-stabilized action buttons.

**Tests:**
- [ ] Rust: verb preview/execute round trips on a scratch repo.
- [ ] App-test: card joins a clean dash end-to-end; conflicted preview renders the list.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` ; `cd tugdeck && bunx tsc --noEmit && bunx vite build`
- [ ] `just app-test`

---

#### Step 22: M04 / phase exit checkpoint {#step-22}

**Depends on:** #step-18, #step-19, #step-20, #step-21

**Commit:** `N/A (verification only)`

**References:** Milestones M01–M04, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Full dogfood loop: `/tugplug:devise` a toy plan → `/tugplug:implement` on a tugdash
      worktree (skills now driving tugdash) → watch the dash changeset in the card → preview
      → join from the card.
- [ ] Documentation Plan items done (design-decisions promotions, CLAUDE.md rows).

**Tests:**
- [ ] Full-suite pass everywhere.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run`
- [ ] `cd tugdeck && bunx tsc --noEmit && bunx vite build` ; `cd tugcode && bun test`
- [ ] `just app-test`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Authoritative per-session file attribution feeding a live, multi-session
Changeset card that diffs, summarizes, and commits — plus `tugdash`, a standalone worktree
tool with a join engine that previews, tolerates disjoint base dirt, survives conflicts, and
tears down atomically.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] `tugutil changes` returns the exact session file set, Bash edits included
      (integration tests + live dogfood).
- [ ] Commit skill stages from the authoritative list (live dogfood commit).
- [ ] Changeset card is the only git surface (git card gone), grouped by owner, sub-second
      on tool-driven changes (app-test + live).
- [ ] Card can diff, draft a message, and commit exactly one changeset's files (app-test).
- [ ] `tugdash` replaces `tugutil dash` everywhere; join preview/strategies/preflight/journal
      all demonstrated by the Step-19 test matrix.
- [ ] All suites green: `cargo nextest run`, `bun test` (tugcode), `bunx tsc --noEmit`,
      `bunx vite build`, `just app-test`.

**Acceptance tests:**
- [ ] Step 7, 12, 16, 22 integration checkpoints.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] `Vcs` trait + second backend (jj/sapling).
- [ ] Cross-workspace changeset view ([Q01]).
- [ ] Rust→TS codegen replacing the golden-fixture guard.
- [ ] Interactive hunk staging / partial-file commits from the card.
- [ ] Attribution-aware `/rewind` integration (file checkpointing already snapshots
      Write/Edit — a natural pairing).

| Checkpoint | Verification |
|------------|--------------|
| M01 attribution | #step-7 |
| M02 card read path | #step-12 |
| M03 card actions | #step-16 |
| M04 tugdash + exit | #step-22 |
