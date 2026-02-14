# Claude Code Guidelines for Tugtool

## Project Overview

Tugtool transforms ideas into working software through orchestrated LLM agents. A multi-agent suite collaborates to create structured tugplans and execute them to completion—from initial idea through implementation, review, and delivery.

## Git Policy

**ONLY THE USER CAN COMMIT TO GIT.** Do not run `git commit`, `git push`, or any git commands that modify the repository history unless explicitly instructed by the user. You may run read-only git commands like `git status`, `git diff`, `git log`, etc.

**Exceptions:**
- The `tugtool worktree create` command commits the tugplan file and bead annotations to the worktree branch as part of worktree setup.
- The `committer-agent` is explicitly given the job to make commits during the implementer workflow.

## Plan Mode Policy

**DO NOT automatically enter Plan mode.** Never use `EnterPlanMode` unless the user explicitly asks for it. Just do the work directly.

## Crate Structure

```
crates/
├── tugtool/         # CLI binary crate
│   └── src/
│       ├── main.rs      # Entry point
│       ├── cli.rs       # Clap argument parsing
│       ├── output.rs    # JSON/text output types
│       └── commands/    # Subcommand implementations
└── tugtool-core/   # Library crate
    └── src/
        ├── lib.rs       # Public exports
        ├── types.rs     # Core data types (TugPlan, Step, etc.)
        ├── parser.rs    # Markdown tugplan parser
        ├── validator.rs # Validation rules
        ├── config.rs    # Configuration handling
        └── error.rs     # Error types
```

## Build Policy

**WARNINGS ARE ERRORS.** This project enforces `-D warnings` via `.cargo/config.toml`.

- `cargo build` will fail if there are any warnings
- `cargo nextest run` will fail if tests have any warnings
- Fix warnings immediately; do not leave them for later
- Use `#[allow(dead_code)]` sparingly and only with a comment explaining why

If you see warnings, fix them before completing your task. No exceptions.

## Key Conventions

### TugPlan Format

Tugplans are structured markdown files in `.tugtool/` directory:
- Filename pattern: `tugplan-*.md` (e.g., `tugplan-1.md`, `tugplan-auth.md`)
- Reserved files: `tugplan-skeleton.md`, `config.toml`

### Anchors

- Use explicit anchors: `### Section {#section-name}`
- Anchor format: lowercase, kebab-case, no phase numbers
- Step anchors: `{#step-0}`, `{#step-1}`, `{#step-2-1}` (substeps)
- Decision anchors: `{#d01-decision-slug}`

### References in Steps

Every execution step must have a `**References:**` line citing tugplan artifacts:
- Decisions: `[D01] Decision name`
- Anchors: `(#anchor-name, #another-anchor)`
- Tables/Specs: `Table T01`, `Spec S01`

### Dependencies

Steps declare dependencies with:
```markdown
**Depends on:** #step-0, #step-1
```

### Agent Files

Sub-agent definitions live in `agents/` directory as markdown with YAML frontmatter:
```markdown
---
name: clarifier-agent
description: Analyze ideas and generate clarifying questions
tools: Read, Grep, Glob
---
```

### Skill Files

Orchestrator skills live in `skills/<name>/SKILL.md` with YAML frontmatter:
```markdown
---
name: planner
description: Orchestrates the planning workflow - spawns sub-agents via Task
allowed-tools: Task, AskUserQuestion
---
```

## Testing

Run tests with:
```bash
cargo nextest run
```

Test fixtures are in `tests/fixtures/`:
- `valid/` - Valid tugplans for success cases
- `invalid/` - Invalid tugplans for error cases
- `golden/` - Expected JSON output

## Common Commands

### CLI (Utility Commands)

```bash
tugtool init                       # Initialize project
tugtool validate                   # Validate all tugplans
tugtool validate tugplan-1.md      # Validate specific file
tugtool list                       # List all tugplans
tugtool status tugplan-1.md        # Show progress
tugtool beads sync tugplan-1.md    # Sync steps to beads
tugtool beads status               # Show bead completion status
tugtool beads close bd-xxx         # Close a bead

# Log management commands
tugtool log rotate                 # Rotate implementation log when over threshold (500 lines or 100KB)
tugtool log rotate --force        # Force rotation even if under threshold
tugtool log prepend --step <anchor> --plan <path> --summary <text>  # Add entry to log

# Commit and open-pr commands (used by committer-agent and integrator-agent)
tugtool commit \
  --worktree <path> \
  --step <anchor> \
  --plan <path> \
  --message <text> \
  --files <file1> <file2> ... \
  --bead <bead-id> \
  --summary <text> \
  --close-reason <text> \
  --json                          # Atomic commit: log rotate, prepend, git commit, bead close

tugtool open-pr \
  --worktree <path> \
  --branch <name> \
  --base <branch> \
  --title <text> \
  --plan <path> \
  --repo <owner/repo> \
  --json                           # Push branch and open PR (body from git log)

# Health check command
tugtool doctor                     # Run health checks (log size, worktrees, broken refs)
tugtool doctor --json             # Output health check results in JSON

# Worktree commands (for isolated implementation environments)
tugtool worktree create <tugplan>  # Create isolated worktree for implementation
tugtool worktree list              # List active worktrees
tugtool worktree cleanup --merged  # Remove worktrees for merged PRs
tugtool merge <tugplan>            # Merge PR and clean up (recommended approach)
```

### Claude Code Skills (Planning and Execution)

**Initialization is automatic.** A pre-hook runs `tugtool init` before the planner and implementer skills start. You can also run it manually:
```bash
tugtool init
```

This creates the `.tugtool/` directory with required files:
- `tugplan-skeleton.md` - Template for tugplan structure
- `config.toml` - Configuration settings
- `tugplan-implementation-log.md` - Progress tracking

Use the skills:
```
/tugtool:planner "add user authentication"       # Create a new tugplan
/tugtool:planner .tugtool/tugplan-auth.md       # Revise existing tugplan
/tugtool:implementer .tugtool/tugplan-auth.md  # Execute a tugplan
/tugtool:merge .tugtool/tugplan-auth.md         # Merge PR and clean up
```

## Error Codes

| Code | Description |
|------|-------------|
| E001 | Parse error |
| E002 | Missing required field |
| E005 | Invalid anchor format |
| E006 | Duplicate anchor |
| E009 | Not initialized |
| E010 | Broken reference |
| E011 | Circular dependency |
| E035 | Beads sync failed |
| E036 | Bead commit failed |

## Implementation Log

The implementation log at `.tugtool/tugplan-implementation-log.md` tracks completed work. The `committer-agent` updates this log as part of the commit procedure during implementation.

## Agent and Skill Architecture

Tugtool is a Claude Code plugin. Planning and execution are invoked via skills, not CLI commands.

### Primary Interface

| Skill | Purpose |
|-------|---------|
| `/tugtool:planner` | Create or revise a tugplan through agent collaboration |
| `/tugtool:implementer` | Execute a tugplan through agent orchestration |
| `/tugtool:merge` | Merge implementation PR and clean up worktree |

### Orchestrator Skills (3)

Three skills contain the main workflow logic. Orchestrators are **pure dispatchers** with only `Task` and `AskUserQuestion` tools — they cannot read files, write files, or run commands.

| Skill | Role |
|-------|------|
| **planner** | Orchestrates planning loop: setup → clarifier → author → critic |
| **implementer** | Orchestrates implementation loop: setup → architect → coder → reviewer → committer |
| **merge** | Wraps `tugtool merge` CLI with dry-run preview, confirmation, and post-merge health checks |

### Sub-Agents (8)

Sub-agents are invoked via Task tool and return JSON results. Each has specific tools and contracts.

**Planning agents (invoked by planner):**

| Agent | Role | Tools |
|-------|------|-------|
| **clarifier-agent** | Analyzes ideas, generates clarifying questions | Read, Grep, Glob |
| **author-agent** | Creates and revises tugplan documents | Read, Grep, Glob, Write, Edit |
| **critic-agent** | Reviews tugplan quality and skeleton compliance | Read, Grep, Glob |

**Implementation agents (invoked by implementer):**

| Agent | Role | Tools |
|-------|------|-------|
| **implementer-setup-agent** | Create worktree, sync beads, resolve steps | Read, Grep, Glob, Bash, Write, Edit |
| **architect-agent** | Read-only codebase analysis, produces implementation strategy per step | Bash, Read, Grep, Glob, WebFetch, WebSearch |
| **coder-agent** | Implements strategy from architect with drift detection | Read, Grep, Glob, Write, Edit, Bash, WebFetch, WebSearch |
| **reviewer-agent** | Reviews code, verifies tugplan conformance, checks build/test reports | Read, Grep, Glob, Write |
| **committer-agent** | Stage, commit, close beads, push, create PR | Read, Grep, Glob, Write, Edit, Bash |

All agents use the **persistent agent pattern** — spawned once and resumed for subsequent invocations. Planning agents (clarifier, author, critic) persist across revision loops. Implementation agents (architect, coder, reviewer, committer) persist across steps. This eliminates cold-start exploration, lets agents accumulate knowledge, and enables targeted revisions. Auto-compaction handles context overflow.

### Development Workflow

Use tugplans to develop tugplans:

```bash
cd /path/to/tugtool
claude --plugin-dir .
```

This loads the repo as a plugin. All skills and agents are available immediately.

## Worktree Workflow

The implementer skill uses git worktrees to isolate implementation work in separate directories with dedicated branches. This provides:

- **Isolation**: Each tugplan implementation gets its own branch and working directory
- **Parallel work**: Multiple tugplans can be implemented concurrently
- **Clean history**: One commit per step, matching bead granularity
- **PR-based review**: Implementation is complete when the PR is merged

### How It Works

When you run `/tugtool:implementer .tugtool/tugplan-N.md`:

1. **Worktree created**: A new git worktree is created at `.tugtool-worktrees/tugplan__<name>-<timestamp>/`
2. **Branch created**: A new branch `tugplan/<name>-<timestamp>` is created from main
3. **Beads synced**: Bead annotations are synced and committed to the worktree
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

The `/tugtool:merge` skill wraps this command with a dry-run preview, user confirmation, and auto-commits any dirty files before merging.

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
rm -rf .tugtool-worktrees/tugplan__<name>-<timestamp>
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
git worktree remove .tugtool-worktrees/tugplan__<name>-<timestamp>

# Prune stale entries
git worktree prune

# Delete the branch manually
git branch -d tugplan/<name>-<timestamp>
```

#### Step commit succeeds but bead close fails

This happens when a step commit succeeds but the bead close fails. The worktree is left in a consistent state, but beads tracking is out of sync. To fix:

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

Valid worktree paths must start with `.tugtool-worktrees/` and exist on disk. If doctor finds invalid paths:

```bash
# List all worktrees to see what's active
tugtool worktree list

# If a worktree is stale or misconfigured, remove it
git worktree remove .tugtool-worktrees/tugplan__<name>-<timestamp>
git worktree prune
```

This usually happens if:
- A worktree directory was deleted manually without using `git worktree remove`
- Session files reference a worktree that no longer exists
- Worktree was created outside the standard `.tugtool-worktrees/` location
