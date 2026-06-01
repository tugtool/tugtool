<!-- written against devise-skeleton v3 -->

## Retire `state.db` and Plan Validation — Keep the Skeleton, Cut the Scaffolding {#retire-statedb-validation}

**Purpose:** Remove the dash state database, the plan parser/validator, and the
`tugutil validate` gate — the mechanization that grew up around the plan format — while
keeping the [devise-skeleton](../tuglaws/devise-skeleton.md) structure intact, so
`devise` / `implement` / `dash` read and act on plan files and code directly.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | `main` (via a `tugdash/` worktree) |
| Last updated | 2026-06-01 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Two pieces of tugutil infrastructure have outlived their reason to exist, and a third —
the skills' validation ceremony — exists only to feed them.

`state.db` is a 2-table SQLite database (`dashes`, `dash_rounds`) used by exactly one
caller, `tugutil dash`; its own schema header admits *"the only surviving consumer is the
dash flow."* A dash **is** a git branch (`tugdash/<name>`) plus a worktree
(`.tugtree/tugdash__<name>`), and `dash_rounds` is `git log` + `git show --stat` copied
into rows — ~90% of the database duplicates state git already holds. Its original
justification, visibility into long-running `/implement` runs, is gone, and the artifact
that visibility produced — `.tugtool/tugplan-implementation-log.md` — was created by
`tugutil init` but **never written to.** A committed fossil.

Meanwhile `/implement` opens by running `tugutil validate`, which drags in a 1967-line
`validator.rs` and a 1698-line `parser.rs` to turn a markdown plan into an AST and assert
metadata/anchor/dependency rules before a single line of real work. The parser's only
non-validation consumer, `tugutil list`, uses it to count checkboxes.

The plan *format* earns its keep — it keeps work on track. What we remove is the compiler
that grew around it. See [P01].

#### Strategy {#strategy}

- **Keep the language, delete the compiler.** The skeleton structure stays a required
  authoring convention; the parser/validator/state.db/validate-gate that mechanized it go.
- **Git is the source of truth for dash lifecycle** ([P02]); the one datum git lacks — the
  verbatim instruction — lands in a flat append-only markdown log ([P04]).
- **Hydrate the worktree at creation, from config** ([P07]); a fresh `tugdash/` worktree
  arrives with deps installed, so the skills get to work instead of rediscovering `bun install`.
- **Sequence for a green build at every step.** `StateDb` spans all dash subcommands, so the
  dash rewrite is one atomic step. `parser`/`types` can only be deleted after *both* their
  consumers (`validator`, `list`) are gone, so validation removal precedes parser removal.
- **Docs and skills last**, once the commands they describe no longer exist.
- **Prune as we cut** — dead `TugError` variants and unused deps fail the `-D warnings` build,
  so they are removed in the same step that orphans them.

#### Success Criteria (Measurable) {#success-criteria}

- `rg 'StateDb|parse_tugplan|validate_tugplan|state\.db'` returns zero hits in live code
  (outside `roadmap/archive/`). (grep)
- `tugutil-core/Cargo.toml` no longer depends on `rusqlite` or `sha2`. (file inspection)
- `cargo build` and `cargo nextest run` pass clean under `-D warnings` across the workspace. (CI/local)
- A full `dash create → commit → show → join` cycle works with no `.tugtool/state.db`
  present, leaving a `tugdash(...)` commit on `main` and lines in `.tugtool/dash-log.md`. (manual)
- A fresh `dash create` leaves the worktree hydrated (`tugdeck/node_modules` present) with no
  manual `bun install`. (manual)
- `tuglaws/devise-skeleton.md` retains every structural section; only its two
  `tugutil validate` references are removed. (diff inspection)

#### Scope {#scope}

1. Rewrite `tugutil dash` on git primitives + a flat log + config-driven worktree hydration;
   delete `state.db` / `StateDb`.
2. Delete `validator.rs`, `parser.rs`, `types.rs`, the `validate` command, and `tugutil list`.
3. Strip the `validate` gate and round-ledger plumbing from the `devise`/`implement`/`dash`
   skills and `tugplug/CLAUDE.md`; strip the validation references from `devise-skeleton.md`.
4. Cleanup: deps, `lib.rs` exports, the `init` log fossil, dead error variants, gitignore,
   orphaned `.tugtool` files, integration tests.

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Changing the plan format.** No skeleton section is added, removed, or restructured.
- **Touching tugbank/tugcast's own rusqlite usage.** Those are legitimate and unrelated.
- **Reworking the dash UX** beyond what dropping the DB forces (no new flags, no new outputs).
- **Building a richer visibility surface** (feed cards, etc.) — the flat log is the whole answer.

#### Dependencies / Prerequisites {#dependencies}

- None external. The removal is self-contained: verified that no justfile recipe, CI job,
  `.claude` hook, or skill *other than the prose being rewritten* calls `tugutil validate`,
  `tugutil list`, or drives `tugutil dash` (see [Q01]).

#### Constraints {#constraints}

- **Warnings are errors** (`tugrust/.cargo/config.toml` enforces `-D warnings`): every step
  must leave zero dead code, including orphaned enum variants and unused deps.
- **Green build at every commit boundary** — the step sequence is ordered to guarantee it.
- This repo commits directly to `main`; implement runs on a `tugdash/` worktree and joins.

#### Assumptions {#assumptions}

- `git`, `git worktree`, and `git config` are available in every environment that runs `dash`
  (already true — the current dash flow shells out to git throughout).
- Losing the joined/released "graveyard" and structured round metadata is acceptable for
  lightweight jobs; the durable record is the squash commit on `main` plus the log (see
  *Deliberately dropped*).

---

### Reference and Anchor Conventions {#reference-conventions}

This plan follows the [devise-skeleton](../tuglaws/devise-skeleton.md) anchor rules.
Anchors used here: `#step-N` for execution steps; `pNN-...` for plan-local decisions
(`[P01]`); `qNN-...` for open questions (`[Q01]`); `rNN-...` for risks. Plan-local
decisions use `[P##]`; no `[D##]` (global) decisions are cited.

---

### Open Questions {#open-questions}

#### [Q01] Does anything outside the skills depend on the removed commands? (DECIDED) {#q01-external-callers}

**Question:** Would deleting `tugutil validate` / `tugutil list` or changing `tugutil dash`
output break CI, justfile recipes, hooks, or other automation?

**Why it matters:** A silent external caller would turn a clean removal into a breakage.

**Resolution:** DECIDED — no. Grepped `Justfile`, `.github`, `.claude`, `tugplug`, and the
Rust tree: `validate` appears only in skill prose (rewritten in [#step-5]); `list` has zero
callers anywhere; no non-skill caller drives `dash`. Safe to remove.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Dead `TugError` variants fail `-D warnings` | med | high | Prune variants in the step that orphans them ([#step-1], [#step-2], [#step-3]) | build error |
| `parser`/`types` deleted while still referenced | med | low | Order: remove `validator` + `list` first, then `parser`/`types` ([#step-3]) | compile error |
| A dash mid-flight when `state.db` is removed loses its row | low | low | Removal targets a clean tree; existing `tugdash/` branches keep working (git-derived) | user has a live dash |

**Risk R01: Git-derived dash status loses the joined/released distinction** {#r01-terminal-status}

- **Risk:** Once a dash branch is deleted, git cannot say whether it was joined or released.
- **Mitigation:** The `.tugtool/dash-log.md` line records the terminal action; joins also leave
  a `tugdash(<name>):` squash commit on `main`.
- **Residual risk:** No queryable history of long-since-deleted dashes — accepted per [P04].

---

### Design Decisions {#design-decisions}

#### [P01] Retain the devise-skeleton structure in full; remove only its mechanization (DECIDED) {#p01-keep-skeleton}

**Decision:** The plan format — Phase Overview, named anchors, `[P01]` decisions,
`**References:**`/`**Depends on:**` lines, the Step Status Ledger, the step/checkpoint shape —
is kept exactly. What is removed is the tooling that enforced or consumed it: the validator,
the parser/AST, and the `tugutil validate` gate.

**Rationale:**
- The structure is the bare-bones infrastructure that keeps work on track; it has earned its place.
- The skeleton was always a contract for the author and the main loop to *follow and read* —
  it does not need a compiler.

**Implications:**
- `devise` still authors against the skeleton; `implement` still walks it via the ledger.
- `devise-skeleton.md` loses only its two `tugutil validate` references ([#step-5]).
- Conformance to the skeleton is upheld by authorship and review, not a CLI gate.

#### [P02] Git is the source of truth for dash lifecycle (DECIDED) {#p02-git-source-of-truth}

**Decision:** A dash's existence and status derive from the presence of its `tugdash/<name>`
branch and `.tugtree/tugdash__<name>` worktree — not a database row.

**Rationale:**
- ~90% of the `dashes`/`dash_rounds` columns duplicate git; a dash *is* a branch + worktree.
- Eliminates a SQLite dependency and ~400 lines of CRUD for state git already holds.

**Implications:**
- `list` ⇒ `git worktree list` + `git branch --list 'tugdash/*'`; round count ⇒
  `git rev-list --count <base>..tugdash/<name>`.
- `show` ⇒ `git log <base>..tugdash/<name>` + `git status` of the worktree.

#### [P03] Base branch lives in git config (DECIDED) {#p03-base-in-git-config}

**Decision:** `create` stores the base in `git config branch.tugdash/<name>.tugbase` (and the
description in `branch.tugdash/<name>.description`); `join` reads it back, falling back to
`detect_default_branch` if absent.

**Rationale:**
- `join` is the one operation that genuinely needs remembered state (where to merge); git
  config is the natural, git-local home for per-branch metadata.

**Implications:**
- No external store needed for the only non-derivable dash datum.

#### [P04] Visibility is a flat append-only markdown log (DECIDED) {#p04-flat-log}

**Decision:** `dash commit` appends one line to `.tugtool/dash-log.md`:
`<iso8601>  <dash>  <commit-hash>  <instruction>`. `release` appends a `released` line. The
file is gitignored (per-developer working state). This replaces both `dash_rounds` and the
never-built implementation-log.

**Rationale:**
- Human-readable, greppable, `tail -f`-able, diffable, no schema — the original
  long-running-`/implement` visibility need, met with a fraction of the complexity.

**Implications:**
- The verbatim `instruction` (git's one gap) is preserved in the log, sourced from the
  existing stdin `DashRoundMeta` JSON.

#### [P05] The plan's Step Status Ledger remains the "where are we?" source (DECIDED) {#p05-ledger-is-truth}

**Decision:** `implement` resumes and scopes from the plan's own **Step Status Ledger**
(read directly from the markdown), never from an external state store.

**Rationale:**
- The ledger already lives in the plan and is the natural, in-place record; no DB needed.

**Implications:**
- The no-ledger fallback reads `git log` on the dash branch instead of `tugutil dash show`.

#### [P06] `tugutil list` is scaffolding on the skeleton — remove it (DECIDED) {#p06-drop-list}

**Decision:** Delete `tugutil list`; it parses plans solely to count checkboxes and has zero
callers ([Q01]). If a need resurfaces, it returns as a trivial line scan (`- [ ]` vs `- [x]`),
no AST.

**Rationale:**
- It is the last non-validation consumer of `parser`/`types`; removing it lets those go too.

**Implications:**
- Removed alongside `parser.rs`/`types.rs` in [#step-3].

#### [P07] `dash create` hydrates the worktree via a config-declared post-create hook (DECIDED) {#p07-worktree-hydration}

**Decision:** After `git worktree add`, `dash create` runs the commands declared in
`[tugtool.dash].post_create` (from `.tugtool/config.toml`), with the new worktree as cwd —
e.g. `bun install --cwd tugdeck`. The hook runs **only on actual creation**, not on the
idempotent resume path, and a non-zero exit **hard-fails** `create` with the command's output.

**Rationale:**
- A git worktree never inherits gitignored files, so `tugdeck/node_modules` is *always* absent
  in a fresh `tugdash/` worktree — a structural certainty, not a per-dash discovery. The skills
  currently rediscover it as prose and get diverted into an ad-hoc `bun install` before reaching
  the task.
- Keeping the command in config keeps `tugutil` generic — it runs what the project *declares*,
  never a hardcoded `bun`/`tugdeck` path in the Rust binary.
- This is also what gives `.tugtool/config.toml` a durable purpose once the validation fields
  (`validation_level`, `show_info`) are removed — see [#step-4].

**Implications:**
- `config.rs` gains a `[tugtool.dash].post_create: Vec<String>` field; `init`'s `DEFAULT_CONFIG`
  seeds it with `bun install --cwd tugdeck`.
- The skills no longer install deps or check for `node_modules` — the worktree arrives hydrated
  ([#step-5] removes that prose).
- Hydration is the *tool's* job; establishing a green test **baseline** stays the *skill's* job
  (contextual: which suites, Rust vs JS).
- **Rejected:** symlinking the base checkout's `node_modules` into the worktree — fragile with
  native bindings and bun's layout; `bun install` from bun's global cache is fast enough.

---

### Specification {#specification}

#### Internal Architecture — dash on git {#dash-on-git}

Post-rewrite command behavior (all shell out to `git`, as the current flow already does):

- **`create <name>`** — `git worktree add .tugtree/tugdash__<name> -b tugdash/<name> <base>`;
  `git config branch.tugdash/<name>.tugbase <base>` and `…​.description <desc>` per [P03].
  Idempotent: existing worktree/branch returns as-is. Keeps `validate_dash_name` +
  `detect_default_branch`. No DB.
- **`commit <name>`** — `git add -A` + `git commit` in the worktree (unchanged), then append a
  log line per [P04]. `DashRoundMeta` JSON on stdin still supplies `instruction`/`summary`.
- **`join <name>`** — unchanged squash-merge flow (preflight clean base, verify current branch
  == base, squash `tugdash/<name>`, `tugdash(<name>):` commit, remove worktree + branch). Base
  from `branch.*.tugbase` ([P03]). Drops the DB status flip.
- **`release <name>`** — remove worktree + delete branch; append a `released` line.
- **`list`** / **`show`** — git-derived per [P02].

#### Worktree hydration (contract) {#worktree-hydration-spec}

`[tugtool.dash].post_create` is an ordered list of shell commands. On a real `create` (a freshly
added worktree), `dash create` runs each from the worktree root, in order; the first non-zero
exit aborts `create` and surfaces the failing command's stderr. On the idempotent path (worktree
already existed) the hook is skipped. Default seeded by `init`:

```toml
[tugtool.dash]
post_create = ["bun install --cwd tugdeck"]
```

#### Log format (contract) {#log-format}

`.tugtool/dash-log.md`, append-only, one record per line:

```
2026-06-01T14:22:09Z  retire-statedb  9f3c1a2  Step 1: dash on git
```

Released dashes: `… <dash>  released  <reason-or-blank>`. No header, no schema, no parsing —
consumers `grep`/`tail`.

#### Error and Warning Model {#error-model}

`TugError` loses every now-dead variant (e.g. `StateDbOpen`, `StateDbQuery`, and
validation-only variants). Because `-D warnings` rejects unused variants, each is removed in
the step that orphans it.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### Files to delete {#delete-files}

| File | Lines | Reason |
|------|------:|--------|
| `tugrust/crates/tugutil-core/src/validator.rs` | 1967 | plan-rule validation |
| `tugrust/crates/tugutil-core/src/parser.rs` | 1698 | markdown → AST |
| `tugrust/crates/tugutil-core/src/types.rs` | 328 | AST types (`TugPlan`, …) |
| `tugrust/crates/tugutil-core/src/state.rs` | 71 | `StateDb` open + schema |
| `tugrust/crates/tugutil/src/commands/validate.rs` | 428 | `validate` command |
| `tugrust/crates/tugutil/src/commands/list.rs` | 174 | `list` command ([P06]) |

#### New files {#new-files}

| Path | Purpose |
|------|---------|
| `.tugtool/dash-log.md` | runtime append-only visibility log ([P04]); gitignored, not a source file |

#### Symbols to modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `run_dash_{create,commit,join,release,list,show}` | fn | `tugutil/src/commands/dash.rs` | rewrite on git; drop `StateDb` calls |
| `impl crate::state::StateDb` | impl block | `tugutil-core/src/dash.rs` | delete (~335 lines) |
| `lib.rs` module decls + re-exports | mod/use | `tugutil-core/src/lib.rs` | drop `parser`/`validator`/`types`/`state` + their exports + smoke tests |
| `Commands::{Validate,List}` | enum variants | `tugutil/src/cli.rs` | remove |
| `Commands::{Validate,List}` dispatch | match arms | `tugutil/src/main.rs` | remove |
| `commands` exports | mod/use | `tugutil/src/commands/mod.rs` | drop `validate`, `list`, `run_validate`, `run_list` |
| `DashConfig`/`post_create` | struct/field | `tugutil-core/src/config.rs` | add `[tugtool.dash].post_create: Vec<String>` ([P07]); remove dead `validation_level`/`show_info` |
| `run_init` / `DEFAULT_CONFIG` | fn/const | `tugutil/src/commands/init.rs` | stop creating `tugplan-implementation-log.md`; seed `post_create` default; drop validation fields |
| `TugError` | enum | `tugutil-core/src/error.rs` | prune dead variants |
| `[dependencies]` | manifest | `tugutil-core/Cargo.toml` | drop `rusqlite`, `sha2` |

---

### Documentation Plan {#documentation-plan}

- [ ] `tuglaws/devise-skeleton.md` — strip the two `tugutil validate` references, bump to `v4`;
      keep every structural section ([#step-5], [P01]).
- [ ] `tugplug/CLAUDE.md` + `devise`/`implement`/`dash` SKILL.md — remove the validate gate and
      round-ledger framing ([#step-5]).
- [ ] `tuglaws/design-decisions.md` + `roadmap/` sweep — reword stale "validated by" references
      to "convention"; leave archived plans as history ([#step-5]).

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When |
|----------|---------|------|
| **Integration (CLI)** | Drive `tugutil dash` end-to-end against a temp git repo, asserting git state (branch/worktree/log) | [#step-1] |
| **Drift / grep gates** | Assert removed symbols have zero live references | [#step-6] |

#### What stays out of tests {#test-non-goals}

- No tests for the deleted parser/validator (the code is gone).
- No mock-store or call-count tests for dash — assert real git state, per project test policy.

---

### Execution Steps {#execution-steps}

> Commit after each step's checkpoint passes. Each step leaves a green `-D warnings` build.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Dash on git + worktree hydration + flat log; delete `state.db`/`StateDb` | pending | — |
| #step-2 | Delete `validator.rs` + the `validate` command | pending | — |
| #step-3 | Delete `tugutil list`, then `parser.rs` + `types.rs` | pending | — |
| #step-4 | Cleanup: deps, `init` fossil, gitignore, orphans | pending | — |
| #step-5 | De-ceremony skills + skeleton/docs | pending | — |
| #step-6 | Integration checkpoint | pending | — |

#### Step 1: Dash on git + worktree hydration + flat log; delete `state.db`/`StateDb` {#step-1}

**Commit:** `refactor(tugutil): drive dash on git primitives, retire state.db`

**References:** [P02] git-source-of-truth, [P03] base-in-git-config, [P04] flat-log,
[P07] worktree-hydration, (#dash-on-git, #worktree-hydration-spec, #log-format)

**Artifacts:**
- Rewritten `run_dash_*` in `commands/dash.rs`; new `.tugtool/dash-log.md` append path.
- `[tugtool.dash].post_create` field in `config.rs` + a seeded default in `init`'s `DEFAULT_CONFIG`.
- Deleted `tugutil-core/src/state.rs` and the `impl StateDb` block in `dash.rs`.

**Tasks:**
- [ ] Rewrite `run_dash_create` on `git worktree add` + `git config` ([P03]); drop `StateDb`.
- [ ] On real creation only, run `[tugtool.dash].post_create` from the worktree root; hard-fail on
      a non-zero exit ([P07], #worktree-hydration-spec). Add the field to `config.rs` and seed it
      in `DEFAULT_CONFIG`.
- [ ] Rewrite `run_dash_commit` to append a log line ([P04]) instead of `record_round`.
- [ ] Rewrite `run_dash_join` / `run_dash_release` to read base from git config; drop status flip.
- [ ] Rewrite `run_dash_list` / `run_dash_show` to read git ([P02]).
- [ ] Delete `state.rs` + the `impl crate::state::StateDb` block; drop `state` from `lib.rs`;
      keep `DashStatus`/`DashInfo`/`DashRound` only if a command still needs them as plain structs.
- [ ] Prune `TugError::StateDb*` variants; delete the on-disk `.tugtool/state.db*`.

**Tests:**
- [ ] Update `tugutil-core/tests/integration_tests.rs` dash cases to assert git state + log lines.
- [ ] Add a case: `create` in a repo whose config declares a `post_create` echo command runs it
      once on creation and not on idempotent resume.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugutil -p tugutil-core`
- [ ] Manual: `create → commit → show → join` on a throwaway dash; confirm the `tugdash(...)`
      commit on base, the `.tugtool/dash-log.md` lines, and a hydrated `tugdeck/node_modules`.

---

#### Step 2: Delete `validator.rs` + the `validate` command {#step-2}

**Commit:** `refactor(tugutil): remove plan validator and validate command`

**References:** [P01] keep-skeleton, (#symbol-inventory)

**Artifacts:**
- Deleted `tugutil-core/src/validator.rs` and `tugutil/src/commands/validate.rs`.

**Tasks:**
- [ ] Delete `validator.rs`; remove `pub mod validator` + validator re-exports from `lib.rs`.
- [ ] Delete `commands/validate.rs`; remove `Validate` from `cli.rs`, its `main.rs` dispatch arm,
      and the `run_validate` export from `commands/mod.rs`.
- [ ] Prune any validation-only `TugError` variants now orphaned.

**Tests:**
- [ ] Remove validate cases from `tugutil/tests/cli_integration_tests.rs`.

**Checkpoint:**
- [ ] `cargo build` + `cargo nextest run -p tugutil -p tugutil-core` clean under `-D warnings`.

---

#### Step 3: Delete `tugutil list`, then `parser.rs` + `types.rs` {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(tugutil): remove list command and plan parser/AST`

**References:** [P06] drop-list, [P01] keep-skeleton, (#delete-files)

**Artifacts:**
- Deleted `commands/list.rs`, `parser.rs`, `types.rs`.

**Tasks:**
- [ ] Delete `commands/list.rs`; remove `List` from `cli.rs`, its `main.rs` arm, the `run_list`
      export ([P06]).
- [ ] Now that `validator` (#step-2) and `list` are gone, delete `parser.rs` + `types.rs`; remove
      `pub mod parser`/`types` + `parse_tugplan`/`TugPlan`/`ParseDiagnostic` re-exports from `lib.rs`.
      Inline a minimal local type for any surviving incidental use rather than keeping the module.

**Tests:**
- [ ] Remove parser/list cases from the integration tests.

**Checkpoint:**
- [ ] `cargo build` + `cargo nextest run` clean under `-D warnings`.

---

#### Step 4: Cleanup — deps, `init` fossil, gitignore, orphans {#step-4}

**Depends on:** #step-1, #step-3

**Commit:** `chore(tugutil): drop dead deps, init log fossil, and orphaned .tugtool files`

**References:** [P04] flat-log, (#error-model)

**Tasks:**
- [ ] `tugutil-core/Cargo.toml` — drop `rusqlite` + `sha2`; delete the `dependency_smoke_tests`
      module in `lib.rs` (their only users).
- [ ] `config.rs` + `DEFAULT_CONFIG` — remove the now-dead validation fields (`validation_level`,
      `show_info`, and `naming.name_pattern` if it served only validation — confirm consumers
      first). `[tugtool.dash].post_create` ([P07]) becomes config.toml's primary content.
- [ ] `commands/init.rs` — stop creating `tugplan-implementation-log.md`; remove the committed
      fossil file. `init` still creates `.tugtool/` + `config.toml` (needed by `resolve`).
- [ ] `.gitignore` — drop `.tugtool/state.db*`; add `.tugtool/dash-log.md` ([P04]).
- [ ] Remove the orphaned, tracked `.tugtool/session-memory.md` (confirm zero references first).

**Tests:**
- [ ] Update `init` integration cases that assert the log file is created.

**Checkpoint:**
- [ ] `cargo build` + `cargo nextest run` clean under `-D warnings`.

---

#### Step 5: De-ceremony the skills + skeleton/docs {#step-5}

**Depends on:** #step-1, #step-2, #step-3

**Commit:** `docs(tugplug): drop validate gate and round-ledger framing; keep skeleton`

**References:** [P01] keep-skeleton, [P05] ledger-is-truth, (#documentation-plan)

**Tasks:**
- [ ] `skills/implement/SKILL.md` — delete the `tugutil validate` setup gate + input clause;
      replace `tugutil dash show`/round references with `git log` + the Step Status Ledger ([P05]);
      **delete the Setup step that checks for `node_modules` and runs `bun install`** — the
      worktree now arrives hydrated ([P07]). Keep the baseline green check (a skill judgment).
- [ ] `skills/devise/SKILL.md` — delete the closing `tugutil validate` step + "implement gates on
      the same check" language.
- [ ] `skills/dash/SKILL.md` — drop "records a round"/`dash show` framing (a round is a commit)
      and any "fresh worktree needs `bun install`" framing ([P07]).
- [ ] `tugplug/CLAUDE.md` — remove `tugutil validate` mentions; keep `create → commit → join`.
- [ ] `tuglaws/devise-skeleton.md` — remove "It is validated by `tugutil validate`" (header) and
      "(validated by `tug validate`)" (Depends-on rule); bump to `v4`. **Keep every section** ([P01]).
- [ ] `tuglaws/design-decisions.md` + `roadmap/` sweep — reword stale enforcement references to
      "convention"; leave archived plans untouched.

**Checkpoint:**
- [ ] `rg 'tugutil validate|tug validate' tugplug tuglaws` returns only historical/archived hits.

---

#### Step 6: Integration checkpoint {#step-6}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** (#success-criteria)

**Tasks:**
- [ ] Verify the four prior code steps work together: a clean dash lifecycle with no `state.db`.

**Tests:**
- [ ] `cargo build` + `cargo nextest run` clean under `-D warnings` across the whole workspace.

**Checkpoint:**
- [ ] `rg 'StateDb|parse_tugplan|validate_tugplan|state\.db'` → zero live hits (archive excepted).
- [ ] Manual end-to-end `dash` cycle confirms the log + base commit; `.tugtool/` has no `state.db`.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A tugutil with no plan parser/validator and no dash state database — dash runs
on git + a flat log, and the skills act on skeleton-structured plans directly.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] `state.db`, `StateDb`, `validator.rs`, `parser.rs`, `types.rs`, `validate`/`list` commands
      all gone; `rusqlite`/`sha2` dropped from `tugutil-core`. (grep + file check)
- [ ] `cargo build` + `cargo nextest run` green under `-D warnings`. (local)
- [ ] `devise-skeleton.md` structurally intact, validation references removed, at `v4`. (diff)
- [ ] A real `dash` cycle works with no `state.db`. (manual)

| Checkpoint | Verification |
|------------|--------------|
| No live references to removed symbols | `rg` sweep ([#step-6]) |
| Green workspace | `cargo nextest run` ([#step-6]) |
| Skeleton preserved | diff of `devise-skeleton.md` shows only validation-ref removals |

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] `.tugtool/config.toml` now earns its keep via `[tugtool.dash].post_create` ([P07]); revisit
      only if a second project ever needs a *different* hydration command (per-project override).
- [ ] Decide if `resolve` should absorb the "find the plan" convenience the skills currently
      hand-roll, now that `list` is gone.
