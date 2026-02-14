---
name: merge
description: Merge a plan's implementation and clean up worktree with verification
allowed-tools: Bash, AskUserQuestion, Read
---

## Purpose

Wraps the `tugtool merge` CLI command with a dry-run preview, user confirmation, and post-merge health checks. This is the final step in the `/tugtool:plan` → `/tugtool:implement` → `/tugtool:merge` flow.

The merge command auto-detects the mode based on whether the repository has an 'origin' remote and an open PR:
- **Remote mode**: Has origin + open PR → squash-merge the PR via `gh pr merge`
- **Local mode**: No origin, or no open PR → `git merge --squash` directly

---

## Input Handling

Parse the user's input to extract the plan path:

| Input Pattern | Example |
|---------------|---------|
| `.tugtool/tugplan-N.md` | `.tugtool/tugplan-12.md` |
| `tugplan-N.md` | `tugplan-12.md` (prepend `.tugtool/`) |

If no plan path is provided, search for plans with `ls .tugtool/tugplan-*.md`. If exactly one plan exists, use it. Otherwise halt with: "Usage: /tugtool:merge .tugtool/tugplan-N.md"

---

## Execute This Sequence

### 1. Dry Run Preview

Run the merge command in dry-run mode:

```bash
tugtool merge <plan_path> --dry-run --json 2>&1
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
| `dirty_files` | Uncommitted files in main (if any) |
| `warnings` | Non-blocking preflight warnings (array of strings, omitted when empty) |
| `error` | Error message (if status is error) |
| `message` | Human-readable summary |

If the command fails (exit code non-zero), report the error and halt. The error message tells the user what went wrong.

### 2. Ask for Confirmation

Note: The CLI handles dirty files automatically during the actual merge (commits infrastructure files, discards leaked implementation files). The skill does NOT need to commit or clean up dirty files — just report them if present in the dry-run output.

If the dry-run output includes a `warnings` array, present each warning to the user before asking for confirmation. Warnings are non-blocking (the merge can proceed) but surface important information such as:
- Incomplete steps/beads
- Multiple worktrees found for the plan
- gh CLI unavailable (falling back to local mode)
- Branch divergence details (commit count, diff stat)
- Infrastructure file differences
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
tugtool merge <plan_path> --json 2>&1
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
tugtool doctor
```

```bash
tugtool worktree list
```

If doctor reports issues, present them as warnings (the merge itself succeeded).

### 5. Report Results

**Remote mode success:**
- PR merged (URL + number)
- Worktree cleaned up
- Health check status
- "Main is clean and ready."

**Local mode success:**
- Branch squash-merged (commit hash)
- Worktree cleaned up
- Health check status
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
- **Incomplete steps**: "N of M steps incomplete" -- some beads are still open. Merge can proceed; user may be deferring work to a follow-up.
- **Multiple worktrees**: More than one worktree matches the plan. The most recent is used; others may be stale.
- **gh CLI unavailable**: Remote origin detected but `gh` is not installed or authenticated. Falls back to local merge mode.
- **Branch divergence**: Shows commit count and diff stat for the branch ahead of main. Informational only.
- **Infrastructure diff**: Lists .tugtool/ and .beads/ files that differ between main and the branch. These are auto-resolved during merge.
- **Failing CI checks**: PR has failing or pending CI checks. User should review before merging.
- **Dirty implementation worktree** (blocking): Uncommitted changes in the implementation worktree would be lost during cleanup. Must commit or discard before merging.

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
