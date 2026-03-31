---
name: merge
description: Merge a plan's implementation and clean up worktree with verification
allowed-tools: Bash, AskUserQuestion, Read
---

## Purpose

Wraps the `tugcode merge` CLI command with a dry-run preview, user confirmation, and post-merge health checks. This is the final step in the `/tugplug:plan` → `/tugplug:implement` → `/tugplug:merge` flow.

The merge command auto-detects the mode based on whether the repository has an 'origin' remote and an open PR:
- **Remote mode**: Has origin + open PR → squash-merge the PR via `gh pr merge`
- **Local mode**: No origin, or no open PR → `git merge --squash` directly

---

## Input Handling

Parse the user's input to extract the plan path:

| Input Pattern | Example |
|---------------|---------|
| `.tugtool/tugplan-<slug>.md` | `.tugtool/tugplan-my-feature.md` |
| `tugplan-<slug>.md` | `tugplan-my-feature.md` (prepend `.tugtool/`) |

If no plan path is provided, search for plans with `ls .tugtool/tugplan-*.md`. If exactly one plan exists, use it. Otherwise halt with: "Usage: /tugplug:merge .tugtool/tugplan-<slug>.md"

---

## Execute This Sequence

### 1. Dry Run Preview

Run the merge command in dry-run mode:

```bash
tugcode merge <plan_path> --dry-run --json 2>&1
```

Parse the JSON output. Key fields:

| Field | Description |
|-------|-------------|
| `status` | `"ok"` or `"error"` |
| `merge_mode` | `"remote"` or `"local"` |
| `branch_name` | The implementation branch |
| `worktree_path` | Path to the worktree directory |
| `pr_url` | PR URL (remote mode only) |
| `pr_number` | PR number (remote mode only) |
| `warnings` | Non-blocking preflight warnings (array of strings, omitted when empty) |
| `error` | Error message (if status is error) |
| `message` | Human-readable summary |

If the command fails (exit code non-zero), report the error and halt. The error message tells the user what went wrong.

### 2. Ask for Confirmation

Note: Any uncommitted changes in main will block the merge — the user must commit or stash them before merging.

If the dry-run output includes a `warnings` array, present each warning to the user before asking for confirmation. Warnings are non-blocking (the merge can proceed) but surface important information such as:
- Multiple worktrees found for the plan
- gh CLI unavailable (falling back to local mode)
- Branch divergence details (commit count, diff stat)
- Failing CI checks on the PR

Present the dry-run results and ask the user to confirm:

**Remote mode:**
```
AskUserQuestion(
  questions: [{
    question: "Ready to merge? This will squash-merge the PR and clean up the worktree.",
    header: "Merge PR",
    options: [
      { label: "Merge (Recommended)", description: "Proceed with the merge" },
      { label: "Cancel", description: "Abort without making changes" }
    ],
    multiSelect: false
  }]
)
```

**Local mode:**
```
AskUserQuestion(
  questions: [{
    question: "Ready to merge? This will squash-merge the branch into main and clean up the worktree.",
    header: "Merge Branch",
    options: [
      { label: "Merge (Recommended)", description: "Proceed with the merge" },
      { label: "Cancel", description: "Abort without making changes" }
    ],
    multiSelect: false
  }]
)
```

If user selects "Cancel", halt with: "Merge cancelled."

### 3. Execute Merge

Run the actual merge:

```bash
tugcode merge <plan_path> --json 2>&1
```

Parse the JSON output. Key fields for the result:

| Field | Description |
|-------|-------------|
| `status` | `"ok"` or `"error"` |
| `merge_mode` | `"remote"` or `"local"` |
| `squash_commit` | Commit hash (local mode only) |
| `pr_url` | PR URL (remote mode only) |
| `worktree_cleaned` | Whether worktree was removed |
| `warnings` | Non-blocking preflight warnings (array of strings, omitted when empty) |
| `error` | Error message (if failed) |

If the command fails, report the error and suggest recovery.

### 4. Post-Merge Health Check

Run health checks **sequentially**, tolerating non-zero exit codes:

```bash
tugcode doctor 2>&1 || true
```

```bash
tugcode worktree list 2>&1 || true
```

**Important:** `tugcode doctor` exits non-zero when it finds issues, but those are informational warnings — the merge itself already succeeded. Never run these two commands in parallel; if doctor fails and kills the worktree list call, useful diagnostic output is lost. Run them sequentially, always appending `|| true` so neither blocks the flow.

### 5. Post-Merge Dependency Installation

After a successful merge, check whether any dependency files changed and offer to run the appropriate setup commands.

#### Step 5a: Detect Changed Dependency Files

Diff the merge commit against its parent to get the list of changed files:

```bash
git diff --name-only HEAD~1 HEAD
```

Match each changed file path against the following lookup table. The directory to run the command in is derived from the path of the changed file (e.g., `tugcode/Cargo.toml` → run in `tugcode/`; a root-level `package.json` → run in the repo root `.`).

**Dependency file lookup table** (extend by adding rows):

| File Pattern | Command |
|--------------|---------|
| `Cargo.toml`, `Cargo.lock` | `cargo build` |
| `package.json`, `bun.lock`, `bun.lockb` | `bun install` |
| `Gemfile`, `Gemfile.lock` | `bundle install` |
| `requirements.txt` | `pip install -r requirements.txt` |
| `pyproject.toml` | `pip install -e .` |
| `go.mod`, `go.sum` | `go mod download` |

**Deduplication rules:**
- If multiple files from the same lookup-table row changed in the same directory, run the command only once for that directory.
- If files from different rows changed in the same directory, run each distinct command once for that directory.

#### Step 5b: Confirm with User (if any detected)

If no dependency files changed, skip this entire step silently — do not report anything.

If dependency files were detected, present them to the user and ask for confirmation before running anything:

```
AskUserQuestion(
  questions: [{
    question: "Dependency files changed after the merge. Run the setup commands listed below?\n\n  tugcode/Cargo.toml → cargo build (in tugcode/)\n  tugdeck/package.json → npm install (in tugdeck/)",
    header: "Install Dependencies",
    options: [
      { label: "Run (Recommended)", description: "Run all listed setup commands" },
      { label: "Skip", description: "Skip dependency installation" }
    ],
    multiSelect: false
  }]
)
```

Replace the example file/command lines with the actual detected entries.

If the user selects "Skip", continue to step 6 without running any commands.

#### Step 5c: Run Approved Commands

For each (directory, command) pair in the approved list, run:

```bash
cd <directory> && <command>
```

Report each command's outcome (success or failure). If a command fails, report the error but continue running the remaining commands — do not halt the entire merge flow. Collect all results and include them in the final report (step 6).

---

### 6. Archive Completed Plan

After the merge and dependency steps, archive the completed plan file and clean
up step files so they don't confuse future agent runs.

#### Step 6a: Move the plan file to the archive directory

First, verify the plan file still exists at `<plan_path>`. If it does not (already archived or moved during merge), skip to step 6d.

```bash
mkdir -p .tugtool/archive
git mv <plan_path> .tugtool/archive/
```

If `git mv` fails (file already tracked elsewhere, path mismatch), fall back to a manual move:

```bash
mv <plan_path> .tugtool/archive/ 2>/dev/null || true
git add .tugtool/archive/<plan_basename> 2>/dev/null || true
git rm --cached <plan_path> 2>/dev/null || true
```

#### Step 6b: Remove step files

If `.tugtool/steps/` contains any files, remove them:

```bash
git rm -r .tugtool/steps/ 2>/dev/null || true
```

This is a no-op if the directory is empty or doesn't exist.

#### Step 6c: Commit the archival

Check whether there are any staged changes before committing:

```bash
git diff --cached --quiet 2>/dev/null
```

If there are staged changes (exit code 1), commit them:

```bash
git commit -m "chore: archive completed plan <plan_basename>"
```

If there are no staged changes (exit code 0), the plan was already archived — skip the commit silently.

#### Step 6d: Archive plan in state database

After archiving, the old plan path no longer exists on disk. Run state archive to
preserve its entries in state.db with archived status:

```bash
tugcode state archive <plan_id>
```

This transitions the plan to archived status and takes a content snapshot.
If it fails, report the error but do not halt.

---

### 7. Report Results

**Remote mode success:**
- PR merged (URL + number)
- Worktree cleaned up
- Health check status
- Dependency installation results (if any commands were run)
- Plan archived
- "Main is clean and ready."

**Local mode success:**
- Branch squash-merged (commit hash)
- Worktree cleaned up
- Health check status
- Dependency installation results (if any commands were run)
- Plan archived
- "Main is clean and ready."

---

## Error Handling

**The merge itself (step 3) is the only hard failure.** Once the merge succeeds, all subsequent steps (health check, dependency install, archive, state archive) are best-effort cleanup. If any cleanup step fails, report the error as a warning and continue to the next step. Never let a cleanup failure prevent the merge from being reported as successful.

If step 3 fails, report clearly and suggest recovery. Do not retry automatically.

**Common errors:**
- **No worktree found**: Implementation hasn't run or worktree was already cleaned up
- **Merge conflicts** (local): User must resolve manually, then retry
- **PR merge failed** (remote): Check PR status on GitHub
- **Worktree cleanup failed**: Run `git worktree remove <path> --force`

**Common preflight warnings** (non-blocking):
- **Multiple worktrees**: More than one worktree matches the plan. The most recent is used; others may be stale.
- **gh CLI unavailable**: Remote origin detected but `gh` is not installed or authenticated. Falls back to local merge mode.
- **Branch divergence**: Shows commit count and diff stat for the branch ahead of main. Informational only.
- **Failing CI checks**: PR has failing or pending CI checks. User should review before merging.

**Blocking errors**:
- **Uncommitted changes in main**: Any tracked modified files on main will block the merge. User must commit or stash these changes before merging.
- **Dirty implementation worktree**: Uncommitted changes in the implementation worktree would be lost during cleanup. Must commit or discard before merging.
- **Local main ahead of origin** (remote mode): Local main has unpushed commits. After the PR merges on GitHub, the fast-forward sync will fail. Push local commits first (`git push origin main`).
- **Local main diverged from origin** (remote mode): Local main has diverged from origin/main. Local and remote have commits that aren't ancestors of each other. Reconcile with `git pull --rebase origin main` then push before merging.

---

## Output

**On success:**
- Merge result (PR URL or commit hash)
- Worktree cleanup status
- Health check warnings (if any)
- "Main is clean and ready."

**On failure:**
- Error details
- Suggested recovery action
