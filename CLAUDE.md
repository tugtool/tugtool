# Claude Code Guidelines for Tugtool

## Project Overview

Tugtool transforms ideas into working software through orchestrated LLM agents. A multi-agent suite collaborates to create structured tugplans and execute them to completion—from initial idea through implementation, review, and delivery.

## Git Policy

**ONLY THE USER CAN COMMIT TO GIT.** Do not run `git commit`, `git push`, or any git commands that modify the repository history unless explicitly instructed by the user. You may run read-only git commands like `git status`, `git diff`, `git log`, etc.

**Exceptions:**
- The `tugtool worktree create` command commits the tugplan file and .tugtool/ infrastructure to the worktree branch as part of worktree setup.
- The `committer-agent` is explicitly given the job to make commits during the implementer workflow.

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

Sub-agent definitions live in `tugplug/agents/` directory as markdown with YAML frontmatter:
```markdown
---
name: clarifier-agent
description: Analyze ideas and generate clarifying questions
tools: Read, Grep, Glob
---
```

### Skill Files

Orchestrator skills live in `tugplug/skills/<name>/SKILL.md` with YAML frontmatter:
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
tugtool resolve user-auth          # Resolve plan identifier to file path
tugtool resolve 1                  # Resolve numeric plan
tugtool resolve                    # Auto-select single plan
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
/tugplug:plan "add user authentication"       # Create a new tugplan
/tugplug:plan .tugtool/tugplan-auth.md       # Revise existing tugplan
/tugplug:implement .tugtool/tugplan-auth.md  # Execute a tugplan
/tugplug:merge .tugtool/tugplan-auth.md      # Merge PR and clean up
```

### Development Workflow

Use tugplans to develop tugplans:

```bash
cd /path/to/tugtool
claude --plugin-dir tugplug
```

This loads the repo as a plugin. All skills and agents are available immediately.

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
