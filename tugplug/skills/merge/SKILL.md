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

Run health checks:

```bash
tugcode doctor
```

```bash
tugcode worktree list
```

If doctor reports issues, present them as warnings (the merge itself succeeded).

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
| `package.json`, `package-lock.json` | `npm install` |
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

```bash
mkdir -p .tugtool/archive
git mv <plan_path> .tugtool/archive/
```

#### Step 6b: Remove step files

If `.tugtool/steps/` contains any files, remove them:

```bash
git rm -r .tugtool/steps/ 2>/dev/null || true
```

This is a no-op if the directory is empty or doesn't exist.

#### Step 6c: Commit the archival

```bash
git commit -m "chore: archive completed plan <plan_basename>"
```

Where `<plan_basename>` is just the filename (e.g., `tugplan-token-rename-35a.md`).

If there are no changes to commit (e.g., plan was already archived), skip the
commit silently.

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

If any step fails, report clearly and suggest recovery. Do not retry automatically.

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
- **Main out of sync with origin** (remote mode): Local main has unpushed commits that `reset --hard origin/main` would destroy. Push or stash local changes before merging.

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
