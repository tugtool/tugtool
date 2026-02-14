## Phase 4.0: Auto-Stage Commit — Eliminate LLM File Lists from Commit Flow {#phase-auto-stage}

**Purpose:** Make `tugtool commit` stage all dirty files automatically via `git add -A`, removing the `--files` flag entirely. This eliminates the class of bugs where LLM agents construct incomplete file lists, and makes the plan-to-merge pipeline reliable without manual intervention.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | — |
| Last updated | 2026-02-14 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The `tugtool commit` command currently requires a `--files` argument listing every file to stage. The implementer skill's orchestrator (an LLM) must construct this list from coder output. This is fragile: in a recent implementation run, the orchestrator omitted `.tugtool/tugplan-implementation-log.md` from the fixup commit's file list even though `tugtool log prepend` had updated that file. The orphaned-changes check caught the mismatch and errored, leaving the worktree dirty and blocking `tugtool merge`.

The root cause is architectural: deterministic decisions (which files to commit in an isolated worktree) are delegated to an LLM instead of being handled by deterministic code. In an implementation worktree, every dirty file belongs to the implementation. There is no reason for selective staging.

#### Strategy {#strategy}

- Replace the per-file staging loop in `tugtool commit` with a single `git add -A` call
- Remove the `--files` CLI flag entirely so callers cannot construct incomplete lists
- Add a safety guard: refuse to run `git add -A` in the main worktree (`.git` is a directory); only allow it in linked worktrees (`.git` is a file)
- Remove the `find_orphaned_changes` function — it exists solely to catch the problem that auto-staging eliminates
- Update `CommitData.files_staged` to report what was actually staged (from `git status` after staging)
- Update the committer-agent and implementer skill to stop passing `files_to_stage`
- Keep `tugtool merge` behavior unchanged: it already blocks on dirty worktrees and handles infrastructure files on main

#### Stakeholders / Primary Customers {#stakeholders}

1. Tugtool implementer skill (the LLM orchestrator that invokes commit)
2. Tugtool users running the plan-implement-merge workflow

#### Success Criteria (Measurable) {#success-criteria}

- `tugtool commit` with `--files` flag fails with a clear error telling the caller the flag no longer exists (verified by running the old invocation)
- `tugtool commit` without `--files` stages all dirty files and commits (verified by integration test)
- `tugtool commit` refuses to run in the main worktree with error code (verified by unit test)
- The implementer skill completes a full plan-to-merge cycle without the user manually staging files (verified by end-to-end run)

#### Scope {#scope}

1. `tugtool commit` Rust implementation: remove `--files`, add `git add -A`, add worktree safety guard
2. `CommitData` output struct: update `files_staged` semantics
3. CLI arg definition in `cli.rs`: remove `files` field from `Commit` variant
4. `main.rs` dispatch: remove `files` parameter from `run_commit` call
5. Committer-agent markdown: remove `files_to_stage` from input contract and command template
6. Implementer skill markdown: remove `files_to_stage` from committer payloads (commit mode and fixup mode)
7. `CLAUDE.md`: update `tugtool commit` usage documentation

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing `tugtool merge` behavior (user chose to keep current dirty-file blocking)
- Adding a `--dry-run` mode to `tugtool commit`
- Changing bead close behavior
- Modifying the `tugtool log prepend` or `tugtool log rotate` commands

#### Dependencies / Prerequisites {#dependencies}

- None. All changes are within the tugtool repository.

#### Constraints {#constraints}

- Warnings are errors: `-D warnings` is enforced, so removing the `files` parameter must be complete across all Rust code paths
- Fixup mode in committer-agent uses direct `git` commands, not `tugtool commit`, so fixup mode needs separate auto-staging logic in the agent markdown

#### Assumptions {#assumptions}

- The worktree isolation guarantee holds: every modified file in an implementation worktree belongs to that implementation
- Auto-staging with `git add -A` is safe in the worktree context (no `.env`, credentials, or large binaries)
- The `.git` file vs directory check is a reliable way to distinguish linked worktrees from the main worktree
- Existing tests in `output.rs` that construct `CommitData` will need `files_staged` values updated

---

### 4.0.0 Design Decisions {#design-decisions}

#### [D01] Remove --files flag entirely (DECIDED) {#d01-remove-files-flag}

**Decision:** Remove the `--files` CLI flag from `tugtool commit` rather than making it optional. Callers that pass `--files` will get a clear clap error.

**Rationale:**
- A breaking change forces all callers to update immediately, preventing silent fallback to the old bug-prone path
- There is exactly one caller (committer-agent), and it is updated in the same tugplan
- An optional flag would leave dead code and confusing documentation

**Implications:**
- The `files: Vec<String>` parameter is removed from `run_commit` function signature
- The file-existence validation loop is removed
- The `files_to_stage` variable is replaced by a `git add -A` call

#### [D02] Worktree safety guard via .git check (DECIDED) {#d02-worktree-safety-guard}

**Decision:** Before running `git add -A`, verify that `<worktree>/.git` is a file (linked worktree), not a directory (main worktree). Fail with a descriptive error if it is a directory.

**Rationale:**
- `git add -A` in the main worktree could stage unrelated work, credentials, or large files
- Linked worktrees always have a `.git` file pointing to the main `.git` directory
- This is a simple, reliable check that requires no configuration

**Implications:**
- A new early check is added to `run_commit` before any git operations
- The error message explains why and suggests running in a worktree

#### [D03] Auto-stage replaces orphaned-changes check (DECIDED) {#d03-remove-orphaned-check}

**Decision:** Remove the `find_orphaned_changes` function entirely. Auto-staging eliminates the category of bugs it was designed to detect.

**Rationale:**
- `find_orphaned_changes` existed to catch incomplete `--files` lists from LLM callers
- With `git add -A`, there are no orphaned changes by definition
- Keeping dead detection code adds maintenance burden and confusion

**Implications:**
- The function and its call site are deleted
- No replacement detection is needed

#### [D04] Report actually-staged files via git status (DECIDED) {#d04-report-staged-files}

**Decision:** After `git add -A`, run `git diff --cached --name-only` to populate `CommitData.files_staged` with the actual list of staged files.

**Rationale:**
- The current code populates `files_staged` from the input list, which may not match reality
- Reporting actual staged files gives accurate commit metadata
- Downstream consumers (implementer skill progress messages) need accurate file counts

**Implications:**
- A `git diff --cached --name-only` call is added after `git add -A`
- The `files_staged` field semantics change from "files requested" to "files actually staged"

#### [D05] Fixup mode in committer-agent uses git add -A (DECIDED) {#d05-fixup-auto-stage}

**Decision:** The committer-agent's fixup mode (direct git commands) will also use `git add -A` instead of staging individual files from `files_to_stage`.

**Rationale:**
- The same worktree isolation guarantee applies
- Fixup mode had the same bug surface as commit mode
- Consistency: both paths use the same staging strategy

**Implications:**
- The committer-agent fixup template changes from `git add <file1> <file2>` to `git -C <worktree> add -A`
- The `files_to_stage` field is removed from the fixup mode input contract

---

### 4.0.1 Specification {#specification}

#### 4.0.1.1 Changes to `tugtool commit` CLI {#commit-cli-changes}

**Before:**
```
tugtool commit --worktree PATH --step ANCHOR --plan PATH --message MSG \
  --files FILE1 FILE2 ... --bead BEAD_ID --summary TEXT [--close-reason TEXT]
```

**After:**
```
tugtool commit --worktree PATH --step ANCHOR --plan PATH --message MSG \
  --bead BEAD_ID --summary TEXT [--close-reason TEXT]
```

The `--files` flag is removed. All dirty files in the worktree are staged automatically.

#### 4.0.1.2 Changes to `run_commit` Function Signature {#run-commit-signature}

**Before:**
```rust
pub fn run_commit(
    worktree: String,
    step: String,
    plan: String,
    message: String,
    files: Vec<String>,
    bead: String,
    summary: String,
    close_reason: Option<String>,
    json: bool,
    quiet: bool,
) -> Result<i32, String>
```

**After:**
```rust
pub fn run_commit(
    worktree: String,
    step: String,
    plan: String,
    message: String,
    bead: String,
    summary: String,
    close_reason: Option<String>,
    json: bool,
    quiet: bool,
) -> Result<i32, String>
```

The `files: Vec<String>` parameter is removed. The `#[allow(clippy::too_many_arguments)]` annotation must be kept: after removal, `run_commit` still has 9 parameters, above clippy's default threshold of 7.

#### 4.0.1.3 Worktree Safety Check {#worktree-safety-check}

Added as the first validation after confirming the worktree path exists:

```rust
// Check that we're in a linked worktree, not the main worktree
let git_path = worktree_path.join(".git");
if git_path.is_dir() {
    return error_response(
        "Refusing to auto-stage in main worktree. \
         tugtool commit must run in a linked worktree (.git must be a file, not a directory).",
        json, quiet,
    );
}
```

#### 4.0.1.4 Auto-Stage Sequence {#auto-stage-sequence}

Replaces the per-file staging loop and orphaned-changes check:

```rust
// Stage all changes
let output = Command::new("git")
    .arg("-C").arg(worktree_path)
    .arg("add").arg("-A")
    .output()
    .map_err(|e| format!("Failed to run git add -A: {}", e))?;

if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    return error_response(&format!("git add -A failed: {}", stderr), json, quiet);
}

// Collect actually-staged files for reporting
let output = Command::new("git")
    .arg("-C").arg(worktree_path)
    .arg("diff").arg("--cached").arg("--name-only")
    .output()
    .map_err(|e| format!("Failed to run git diff --cached: {}", e))?;

let files_staged: Vec<String> = String::from_utf8_lossy(&output.stdout)
    .lines()
    .filter(|l| !l.is_empty())
    .map(|l| l.to_string())
    .collect();
```

#### 4.0.1.5 Committer-Agent Commit Mode Template {#committer-commit-template}

**Before:**
```bash
tugtool commit \
  --worktree "{worktree_path}" \
  --step "{step_anchor}" \
  --plan "{plan_path}" \
  --message "{proposed_message}" \
  --files {files_to_stage[0]} {files_to_stage[1]} ... \
  --bead "{bead_id}" \
  --summary "{log_entry.summary}" \
  --close-reason "{close_reason}" \
  --json
```

**After:**
```bash
tugtool commit \
  --worktree "{worktree_path}" \
  --step "{step_anchor}" \
  --plan "{plan_path}" \
  --message "{proposed_message}" \
  --bead "{bead_id}" \
  --summary "{log_entry.summary}" \
  --close-reason "{close_reason}" \
  --json
```

#### 4.0.1.6 Committer-Agent Fixup Mode Template {#committer-fixup-template}

**Before (Step 2 — stage files):**
```bash
git -C "{worktree_path}" add {files_to_stage[0]} {files_to_stage[1]} ...
```

**After (Step 2 — stage all, Step 2b — capture staged files):**
```bash
git -C "{worktree_path}" add -A
```

Then capture the list of staged files for the output JSON:
```bash
git -C "{worktree_path}" diff --cached --name-only
```

The committer-agent parses the output lines into the `files_staged` array in its fixup JSON response. This replaces the old behavior of echoing back the input `files_to_stage` list.

#### 4.0.1.7 Implementer Skill Committer Payloads {#implementer-payloads}

The `files_to_stage` field is removed from all committer payloads in the implementer skill:
- Section 3f (step commit): remove `files_to_stage` from JSON
- Section 4a-retry (audit fixup): remove `files_to_stage` from JSON
- Section 5a-retry (CI fixup): remove `files_to_stage` from JSON

---

### 4.0.2 Symbol Inventory {#symbol-inventory}

#### 4.0.2.1 Files to Modify {#files-to-modify}

| File | Change |
|------|--------|
| `crates/tugtool/src/commands/commit.rs` | Remove `files` param, add safety guard, replace staging with `git add -A`, remove `find_orphaned_changes` |
| `crates/tugtool/src/cli.rs` | Remove `files` field from `Commit` variant; update `test_commit_command` and `test_commit_with_close_reason` tests |
| `crates/tugtool/src/main.rs` | Remove `files` from `run_commit` call |
| `crates/tugtool/src/output.rs` | Update `CommitData` test fixtures (remove hardcoded file lists, adjust expectations) |
| `agents/committer-agent.md` | Remove `files_to_stage` from contracts and templates |
| `skills/implement/SKILL.md` | Remove `files_to_stage` from all committer payloads |
| `CLAUDE.md` | Update `tugtool commit` usage example |

#### 4.0.2.2 Symbols to Remove {#symbols-to-remove}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `find_orphaned_changes` | fn | `commands/commit.rs` | Entire function deleted |
| `files` | field | `cli.rs` `Commit` variant | CLI arg removed |
| `files` | param | `run_commit()` | Function parameter removed |

#### 4.0.2.3 Symbols to Add {#symbols-to-add}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| worktree safety check | code block | `run_commit()` | `.git` file vs directory check |

---

### 4.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Verify safety guard logic | Worktree detection check |
| **Integration** | Verify full commit flow in temp worktree | End-to-end auto-staging |
| **Golden / Contract** | Verify `CommitData` JSON shape | Output struct serialization |

---

### 4.0.4 Execution Steps {#execution-steps}

#### Step 0: Remove --files from CLI and Rust Plumbing {#step-0}

**Commit:** `refactor(commit): remove --files flag and auto-stage all worktree changes`

**References:** [D01] Remove --files flag entirely, [D02] Worktree safety guard via .git check, [D03] Auto-stage replaces orphaned-changes check, [D04] Report actually-staged files via git status, (#commit-cli-changes, #run-commit-signature, #worktree-safety-check, #auto-stage-sequence, #files-to-modify, #symbols-to-remove, #symbols-to-add)

**Artifacts:**
- Modified `crates/tugtool/src/cli.rs` — `files` field removed from `Commit` variant; `test_commit_command` and `test_commit_with_close_reason` tests rewritten to work without `--files`
- Modified `crates/tugtool/src/main.rs` — `files` argument removed from `run_commit()` call
- Modified `crates/tugtool/src/commands/commit.rs` — `files` param removed, safety guard added, `git add -A` replaces per-file staging, `find_orphaned_changes` deleted, `files_staged` populated from `git diff --cached --name-only`
- Modified `crates/tugtool/src/output.rs` — test fixtures updated for `CommitData`

**Tasks:**
- [ ] Remove `files: Vec<String>` field from `Commit` variant in `cli.rs`
- [ ] Update `test_commit_command` in `cli.rs`: remove `--files` args from `try_parse_from`, remove `files` from `Commands::Commit` destructure, remove `files` assertion
- [ ] Update `test_commit_with_close_reason` in `cli.rs`: remove `--files` args from `try_parse_from`, remove `files` from `Commands::Commit` destructure (uses `..` pattern, but the `--files` arg in `try_parse_from` must be removed)
- [ ] Remove `files` from the `run_commit()` call in `main.rs`
- [ ] In `run_commit()` in `commit.rs`: remove `files: Vec<String>` parameter
- [ ] Add worktree safety guard: check `.git` is a file, not a directory; return error if directory
- [ ] Remove the file-existence validation loop that checks each file exists in worktree
- [ ] Remove the per-file staging loop that runs `git add` on each file individually
- [ ] Remove the call to `find_orphaned_changes` and its error handling block
- [ ] Delete the `find_orphaned_changes` function entirely
- [ ] Add `git add -A` call in place of the removed staging code
- [ ] Add `git diff --cached --name-only` call to populate `files_staged`
- [ ] Update the `files_staged` field in `CommitData` construction to use the actual staged file list
- [ ] Keep `#[allow(clippy::too_many_arguments)]` — `run_commit` still has 9 parameters after removal, above clippy's threshold of 7
- [ ] Update `CommitData` test fixtures in `output.rs` if needed

**Tests:**
- [ ] CLI parse test: `test_commit_command` parses successfully without `--files` and destructures without `files` field
- [ ] CLI parse test: `test_commit_with_close_reason` parses successfully without `--files`
- [ ] Unit test: `run_commit` returns error when `.git` is a directory (main worktree)
- [ ] Integration test: `run_commit` in a temp linked worktree stages and commits all dirty files
- [ ] Integration test: `run_commit` correctly reports staged files in `CommitData.files_staged`
- [ ] Golden test: `CommitData` serialization still matches expected JSON shape

**Checkpoint:**
- [ ] `cargo build` succeeds with no warnings
- [ ] `cargo nextest run` — all tests pass
- [ ] `cargo clippy` — no warnings
- [ ] Manual verification: `tugtool commit --files foo` produces a clap error about unrecognized flag

**Rollback:**
- `git revert HEAD` to restore the `--files` flag

**Commit after all checkpoints pass.**

---

#### Step 1: Update Agent and Skill Markdown {#step-1}

**Depends on:** #step-0

**Commit:** `docs(agents): remove files_to_stage from committer-agent and implementer skill`

**References:** [D01] Remove --files flag entirely, [D05] Fixup mode in committer-agent uses git add -A, (#committer-commit-template, #committer-fixup-template, #implementer-payloads)

**Artifacts:**
- Modified `agents/committer-agent.md` — `files_to_stage` removed from input contracts, commit mode template updated, fixup mode template updated
- Modified `skills/implement/SKILL.md` — `files_to_stage` removed from all committer payloads (3f, 4a-retry, 5a-retry)
- Modified `CLAUDE.md` — `tugtool commit` usage example updated

**Tasks:**
- [ ] In `agents/committer-agent.md`: remove `files_to_stage` from commit mode input contract
- [ ] In `agents/committer-agent.md`: remove `files_to_stage` from fixup mode input contract
- [ ] In `agents/committer-agent.md`: remove `--files` line from commit mode CLI template
- [ ] In `agents/committer-agent.md`: replace `git add {files_to_stage[...]}` with `git -C "{worktree_path}" add -A` in fixup Step 2
- [ ] In `agents/committer-agent.md`: add fixup Step 2b — run `git -C "{worktree_path}" diff --cached --name-only` and parse output lines into `files_staged` array
- [ ] In `agents/committer-agent.md`: update fixup JSON output — `files_staged` is populated from `git diff --cached --name-only` output, not echoed from input
- [ ] In `agents/committer-agent.md`: update fixup mode constraint from "THREE commands" to "FOUR commands" (log prepend, git add -A, git diff --cached --name-only, git commit)
- [ ] In `skills/implement/SKILL.md` section 3f: remove `files_to_stage` from committer JSON payload
- [ ] In `skills/implement/SKILL.md` section 4a-retry: remove `files_to_stage` from fixup JSON payload
- [ ] In `skills/implement/SKILL.md` section 5a-retry: remove `files_to_stage` from fixup JSON payload
- [ ] In `CLAUDE.md`: update the `tugtool commit` usage example to remove `--files`

**Tests:**
- [ ] Validate that no remaining references to `files_to_stage` or `--files` exist in agent/skill markdown (grep check)

**Checkpoint:**
- [ ] `grep -r "files_to_stage" agents/ skills/` returns no matches
- [ ] `grep -r "\-\-files" agents/ skills/ CLAUDE.md` returns no matches related to `tugtool commit`
- [ ] `tugtool validate` passes on all existing tugplans

**Rollback:**
- `git revert HEAD` to restore the previous agent/skill definitions

**Commit after all checkpoints pass.**

---

### 4.0.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** `tugtool commit` auto-stages all dirty files in implementation worktrees, eliminating the need for LLM agents to construct file lists.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugtool commit` no longer accepts `--files` (clap rejects it)
- [ ] `tugtool commit` runs `git add -A` and commits all worktree changes
- [ ] `tugtool commit` refuses to run in the main worktree (`.git` is a directory)
- [ ] `committer-agent.md` contains no references to `files_to_stage`
- [ ] `skills/implement/SKILL.md` contains no references to `files_to_stage`
- [ ] `cargo build && cargo nextest run && cargo clippy` all pass clean
- [ ] `CLAUDE.md` reflects the updated `tugtool commit` interface

**Acceptance tests:**
- [ ] Integration test: commit in linked worktree auto-stages and succeeds
- [ ] Unit test: commit in main worktree is rejected with descriptive error
- [ ] Contract test: `CommitData` serialization produces valid JSON with `files_staged`

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Consider adding `--dry-run` to `tugtool commit` for pre-commit inspection
- [ ] Consider adding a `--worktree-only` safety flag to other commands that modify git state
- [ ] Audit whether the coder-agent should stop reporting `files_created`/`files_modified` (no longer consumed by committer)

| Checkpoint | Verification |
|------------|--------------|
| Build clean | `cargo build` exits 0 with no warnings |
| Tests pass | `cargo nextest run` exits 0 |
| Lint clean | `cargo clippy` exits 0 |
| No stale references | `grep -r "files_to_stage\|--files" agents/ skills/ CLAUDE.md` returns no commit-related matches |

**Commit after all checkpoints pass.**
