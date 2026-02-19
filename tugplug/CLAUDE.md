# Tugplug Plugin Guidelines

## Beads Policy

**Beads is a hard requirement.** Beads provides inter-agent communication (architect writes strategy to bead design field, coder reads it) and enables interrupt/resume via `bd ready`. Beads failures during worktree setup are fatal.

- **Direct SQLite mode**: All `bd` commands run with `BEADS_NO_DAEMON=1` and `BEADS_NO_AUTO_FLUSH=1` (hardcoded in `BeadsCli` constructor). No daemon, no auto-flush.
- **No plan file annotations**: `tugtool beads sync` creates beads in SQLite and returns `bead_mapping` in JSON output. Plan files are never modified by sync.
- **Hook removal**: `tugtool init` detects and removes `.git/hooks/pre-commit` and `.git/hooks/post-merge` files that contain beads/bd references. This prevents beads git hooks from blocking commits.
- **Merge checks simplified**: The unreliable bead completion check has been removed from merge preflight. The main sync check (local vs origin/main) is now a warning, not a blocker.

## Plan Mode Policy

**DO NOT automatically enter Plan mode.** Never use `EnterPlanMode` unless the user explicitly asks for it. Just do the work directly.

## Agent and Skill Architecture

Tugtool is a Claude Code plugin. Planning and execution are invoked via skills, not CLI commands.

### Primary Interface

| Skill | Purpose |
|-------|---------|
| `/tugplug:plan` | Create or revise a tugplan through agent collaboration |
| `/tugplug:implement` | Execute a tugplan through agent orchestration |
| `/tugplug:merge` | Merge implementation PR and clean up worktree |

### Orchestrator Skills (3)

Three skills contain the main workflow logic. Orchestrators are **pure dispatchers** with only `Task` and `AskUserQuestion` tools — they cannot read files, write files, or run commands. Exception: the implement skill additionally uses Bash for `tugtool` CLI commands (worktree creation), gated by a PreToolUse hook.

| Skill | Role |
|-------|------|
| **plan** | Orchestrates planning loop: setup → clarifier → author → critic |
| **implement** | Orchestrates implementation loop: architect → coder → reviewer → committer (worktree setup via direct CLI call) |
| **merge** | Wraps `tugtool merge` CLI with dry-run preview, confirmation, and post-merge health checks |

### Sub-Agents (9)

Sub-agents are invoked via Task tool and return JSON results. Each has specific tools and contracts.

**Planning agents (invoked by plan):**

| Agent | Role | Tools |
|-------|------|-------|
| **clarifier-agent** | Analyzes ideas, generates clarifying questions | Bash, Read, Grep, Glob, WebFetch, WebSearch, Write, Edit |
| **author-agent** | Creates and revises tugplan documents | Bash, Read, Grep, Glob, Write, Edit |
| **critic-agent** | Reviews tugplan quality and skeleton compliance | Read, Grep, Glob, Bash |

**Implementation agents (invoked by implement):**

| Agent | Role | Tools |
|-------|------|-------|
| **architect-agent** | Read-only codebase analysis, produces implementation strategy per step | Bash, Read, Grep, Glob, WebFetch, WebSearch |
| **coder-agent** | Implements strategy from architect with drift detection | Read, Grep, Glob, Write, Edit, Bash, WebFetch, WebSearch |
| **reviewer-agent** | Reviews code, verifies tugplan conformance, checks build/test reports | Bash, Read, Grep, Glob, Write, Edit |
| **committer-agent** | Thin CLI wrapper for git commits | Bash |
| **auditor-agent** | Post-loop quality gate, verifies deliverables, runs fresh build/test/clippy/fmt | Bash, Read, Grep, Glob |
| **integrator-agent** | Push branch, create PR, verify CI status | Bash |

All agents use the **persistent agent pattern** — spawned once and resumed for subsequent invocations. Planning agents (clarifier, author, critic) persist across revision loops. Implementation agents (architect, coder, reviewer, committer) persist across steps. This eliminates cold-start exploration, lets agents accumulate knowledge, and enables targeted revisions. Auto-compaction handles context overflow.

### Development Workflow

Use tugplans to develop tugplans:

```bash
cd /path/to/tugtool
claude --plugin-dir tugplug
```

This loads the repo as a plugin. All skills and agents are available immediately.

## Worktree Workflow

The implementer skill uses git worktrees to isolate implementation work in separate directories with dedicated branches. This provides:

- **Isolation**: Each tugplan implementation gets its own branch and working directory
- **Parallel work**: Multiple tugplans can be implemented concurrently
- **Clean history**: One commit per step, matching bead granularity
- **PR-based review**: Implementation is complete when the PR is merged

### How It Works

When you run `/tugplug:implement .tugtool/tugplan-N.md`:

1. **Worktree created**: A new git worktree is created at `.tugtree/tugplan__<name>-<timestamp>/`
2. **Branch created**: A new branch `tugplan/<name>-<timestamp>` is created from main
3. **Beads synced**: Beads are synced to SQLite and bead_mapping is returned in JSON output (plan files are not modified)
4. **Steps executed**: Each step is implemented and committed separately
5. **PR created**: After all steps complete, a PR is automatically created to main

### Merge Workflow (Recommended)

After implementation completes and a PR is created, use the `tugtool merge` command to automate the merge workflow:

```bash
# Preview what will happen
tugtool merge .tugtool/tugplan-12.md --dry-run

# Merge the PR and clean up
tugtool merge .tugtool/tugplan-12.md
```

The merge command auto-detects the mode based on whether the repository has an `origin` remote and an open PR:

- **Remote mode** (has origin + open PR): Squash-merges the PR via `gh pr merge`, then cleans up
- **Local mode** (no origin, or no open PR): Runs `git merge --squash` directly, then cleans up

Steps:
1. Finds the worktree for the tugplan using git-native worktree discovery
2. Detects merge mode (remote or local)
3. Reports any uncommitted changes in main as `dirty_files`
4. Squash-merges (via PR or local branch)
5. Cleans up the worktree and branch

The `/tugplug:merge` skill wraps this command with a dry-run preview, user confirmation, and auto-commits any dirty files before merging.

### Manual Cleanup (Alternative)

If you prefer manual control or the merge command is unavailable:

```bash
# Fetch latest main to ensure merge is detected
git fetch origin main

# Remove worktrees for merged PRs (dry run first)
tugtool worktree cleanup --merged --dry-run

# Actually remove them
tugtool worktree cleanup --merged
```

The cleanup command:
- Uses git-native worktree removal (`git worktree remove`)
- Prunes stale worktree metadata (`git worktree prune`)
- Deletes the local branch

### Troubleshooting

#### "Worktree already exists"

If you see this error, it means a worktree for this tugplan already exists:

```bash
# List all worktrees to see what exists
tugtool worktree list

# If the worktree is stale, remove it manually
rm -rf .tugtree/tugplan__<name>-<timestamp>
git worktree prune
```

#### "Branch not merged" after PR merge

This can happen with squash or rebase merges, where the original commits are not ancestors of main:

```bash
# Update your local main branch
git fetch origin main
git checkout main
git pull origin main

# Try cleanup again
tugtool worktree cleanup --merged
```

If cleanup still fails, you may need to remove the worktree manually:

```bash
# Remove the worktree
git worktree remove .tugtree/tugplan__<name>-<timestamp>

# Prune stale entries
git worktree prune

# Delete the branch manually
git branch -d tugplan/<name>-<timestamp>
```

#### Step commit succeeds but bead close fails

This happens when a step commit succeeds but the bead close fails. The worktree is left in a consistent state, but beads tracking is out of sync.

Note: Beads now uses direct SQLite mode (no daemon, no auto-flush), which eliminates most daemon-related failures. If a bead close still fails, to fix:

1. Check the implementation log in the worktree for the bead ID
2. Close the bead manually: `tugtool beads close bd-xxx`
3. If continuing implementation, the next step should proceed normally

#### Implementation log is too large

If the implementation log grows beyond 500 lines or 100KB, it can slow down parsing and git operations. The `tugtool doctor` command will warn you about large logs:

```bash
# Check project health including log size
tugtool doctor

# If the log is oversized, rotate it to archive
tugtool log rotate
```

When you run `tugtool log rotate`, the current log is moved to `.tugtool/archive/implementation-log-YYYY-MM-DD-HHMMSS.md` and a fresh log is created. All historical entries are preserved in the archive.

Note: `tugtool beads close` automatically rotates oversized logs, so manual rotation is rarely needed.

#### Doctor reports broken references

If `tugtool doctor` finds broken anchor references in your tugplans, you need to fix them before implementation:

```bash
# See which references are broken
tugtool doctor --json | jq '.checks[] | select(.name == "broken_refs")'

# Common causes:
# - Step anchor was renamed but references weren't updated
# - Decision anchor typo
# - Anchor was removed but reference remained

# Fix the references in your tugplan file, then verify
tugtool validate .tugtool/tugplan-N.md
```

#### Doctor reports invalid worktree paths

Valid worktree paths must start with `.tugtree/` and exist on disk. If doctor finds invalid paths:

```bash
# List all worktrees to see what's active
tugtool worktree list

# If a worktree is stale or misconfigured, remove it
git worktree remove .tugtree/tugplan__<name>-<timestamp>
git worktree prune
```

This usually happens if:
- A worktree directory was deleted manually without using `git worktree remove`
- Session files reference a worktree that no longer exists
- Worktree was created outside the standard `.tugtree/` location
