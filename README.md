# Tugtool

Go from ideas to implementation via multi-agent orchestration. Tugtool transforms ideas into working software through a suite of specialized LLM agents that plan, implement, review, and track progress to completion.

## Installation

### Homebrew (macOS)

The easiest way to install tugtool on macOS:

```bash
brew tap specks-dev/tug https://github.com/specks-dev/tug
brew install tug
```

### Download Binary

Download prebuilt binaries from [GitHub Releases](https://github.com/tug-dev/tug/releases):

```bash
# For Apple Silicon (M1/M2/M3)
curl -L https://github.com/tug-dev/tug/releases/latest/download/tugtool-latest-macos-arm64.tar.gz | tar xz
sudo mv bin/tugtool /usr/local/bin/

# For Intel Mac
curl -L https://github.com/tug-dev/tug/releases/latest/download/tugtool-latest-macos-x86_64.tar.gz | tar xz
sudo mv bin/tugtool /usr/local/bin/
```

### From Source

Requires Rust 1.70+ and Cargo:

```bash
git clone https://github.com/tug-dev/tug.git
cd tug
cargo install --path crates/tugtool
```

### Post-Install Setup

After installation, initialize tugtool in your project:

```bash
cd your-project
tugtool init
```

This creates a `.tugtool/` directory with the skeleton template and configuration.

Verify your installation:

```bash
tugtool --version
```

### Using as a Claude Code Plugin

Tugtool is a Claude Code plugin. For development or local use:

```bash
cd /path/to/tugtool
claude --plugin-dir .
```

This loads all tugtool skills and agents. You can then use:
- `/tugtool:planner "your idea"` - Create a new tugplan
- `/tugtool:implementer .tugtool/tugplan-name.md` - Execute a tugplan

## Quick Start

1. Initialize a tugtool project:

```bash
tugtool init
```

This creates a `.tugtool/` directory with:
- `tugplan-skeleton.md` - Template for new tugplans
- `config.toml` - Project configuration

2. Create a tugplan via Claude Code:

```bash
claude --plugin-dir /path/to/tugtool
# Then in Claude Code:
/tugtool:planner "add a health check endpoint"
```

Or manually from the skeleton:

```bash
cp .tugtool/tugplan-skeleton.md .tugtool/tugplan-myfeature.md
```

3. Validate your tugplan:

```bash
tugtool validate tugplan-myfeature.md
```

4. Execute your tugplan:

```bash
claude --plugin-dir /path/to/tugtool
# Then in Claude Code:
/tugtool:implementer .tugtool/tugplan-myfeature.md
```

5. Track progress:

```bash
tugtool status tugplan-myfeature.md
tugtool list
```

## Commands

### `tugtool init`

Initialize a tugtool project in the current directory.

```bash
tugtool init          # Create .tugtool/ directory
tugtool init --force  # Overwrite existing .tugtool/
```

### `tugtool validate`

Validate tugplan structure against format conventions.

```bash
tugtool validate                    # Validate all tugplans
tugtool validate tugplan-1.md       # Validate specific file
tugtool validate --strict           # Enable strict mode
tugtool validate --json             # Output as JSON
```

### `tugtool list`

List all tugplans with summary information.

```bash
tugtool list                  # List all tugplans
tugtool list --status draft   # Filter by status
tugtool list --json           # Output as JSON
```

### `tugtool status`

Show detailed completion status for a tugplan.

```bash
tugtool status tugplan-1.md       # Show status
tugtool status tugplan-1.md -v   # Verbose (show tasks)
tugtool status tugplan-1.md --json  # Output as JSON
```

### `tugtool beads close`

Close a bead to mark work complete.

```bash
tugtool beads close bd-abc123                      # Close a bead
tugtool beads close bd-abc123 --reason "Step done" # Close with reason
tugtool beads close bd-abc123 --json               # JSON output
```

## Planning and Execution (Claude Code Skills)

Planning and execution are handled via Claude Code skills, not CLI commands.

### `/tugtool:plan`

Create or revise a tugplan through agent collaboration.

```
/tugtool:plan "add a health check endpoint"       # Create from idea
/tugtool:plan .tugtool/tugplan-existing.md        # Revise existing tugplan
```

The planning flow:
1. **Clarifier** analyzes the idea and generates questions
2. **Interviewer** presents questions and gathers user input
3. **Planner** creates a structured plan
4. **Critic** reviews for quality and implementability
5. Loop continues until critic approves or user accepts

### `/tugtool:execute`

Execute a tugplan step-by-step with agent orchestration.

```
/tugtool:execute .tugtool/tugplan-feature.md
```

The execution flow for each step:
1. **Architect** creates implementation strategy
2. **Implementer** executes strategy (with self-monitoring for drift)
3. **Reviewer** and **Auditor** verify work in parallel
4. **Logger** updates implementation log
5. **Committer** stages files and commits changes

## Agent and Skill Architecture

Tugtool uses a multi-agent architecture implemented as a Claude Code plugin.

### Agents (5)

Agents handle complex, multi-step workflows:

| Agent | Role | Description |
|-------|------|-------------|
| **director** | Orchestrator | Coordinates workflow via Task and Skill tools |
| **planner** | Idea → TugPlan | Creates and revises tugplan documents |
| **interviewer** | User Interaction | Single point of user interaction via AskUserQuestion |
| **architect** | Step → Strategy | Creates implementation strategies with expected touch sets |
| **implementer** | Strategy → Code | Executes strategies with self-monitoring for drift |

### Skills (8)

Skills run inline for focused tasks:

| Skill | Role | Description |
|-------|------|-------------|
| **plan** | Entry Point | Spawns director with mode=plan |
| **execute** | Entry Point | Spawns director with mode=execute |
| **clarifier** | Analysis | Analyzes ideas, returns clarifying questions |
| **critic** | Review | Reviews tugplan quality and implementability |
| **reviewer** | Verification | Verifies completed step matches tugplan |
| **auditor** | Quality | Checks code quality, security, error handling |
| **logger** | Documentation | Updates implementation log |
| **committer** | Git | Stages files, commits changes, closes beads |

## TugPlan Format

Tugplans follow a structured markdown format. See `.tugtool/tugplan-skeleton.md` for the complete template.

### Key Sections

- **TugPlan Metadata**: Owner, status, tracking info
- **Phase Overview**: Context, strategy, scope
- **Design Decisions**: [D01], [D02], etc.
- **Execution Steps**: Step 0, Step 1, etc.
- **Deliverables**: Exit criteria, milestones

### Anchors and References

- Use explicit anchors: `### Section {#section-name}`
- Reference anchors: `**Depends on:** #step-0, #step-1`
- Reference decisions: `**References:** [D01] Decision name`

## Beads Integration

Tugtool integrates with [Beads](https://github.com/kocienda/beads) for issue/task tracking. This enables two-way synchronization between tugplan steps and external work items.

### Requirements

- **Beads CLI** (`bd`) must be installed and available in PATH
- **Beads initialized** in your project (`bd init` creates `.beads/` directory)
- **Network connectivity** for beads commands (they communicate with the beads backend)

### Commands

#### `tugtool beads sync`

Sync tugplan steps to beads—creates beads for steps and writes IDs back to the tugplan.

```bash
tugtool beads sync tugplan-1.md           # Sync a specific tugplan
tugtool beads sync tugplan-1.md --dry-run # Preview without making changes
tugtool beads sync tugplan-1.md --prune-deps  # Remove stale dependency edges
```

This creates:
- A **root bead** (epic) for the entire tugplan
- **Child beads** for each execution step
- **Dependency edges** matching the `**Depends on:**` lines

Bead IDs are written back to the tugplan file:
- `**Beads Root:** \`bd-xxx\`` in TugPlan Metadata
- `**Bead:** \`bd-xxx.1\`` in each step

#### `tugtool beads status`

Show execution status for each step based on linked beads.

```bash
tugtool beads status tugplan-1.md    # Show status for one tugplan
tugtool beads status                   # Show status for all tugplans
tugtool beads status --pull            # Also update checkboxes
```

Status values:
- **complete**: Bead is closed
- **ready**: Bead is open, all dependencies are complete
- **blocked**: Waiting on dependencies
- **pending**: No bead linked yet

#### `tugtool beads pull`

Update tugplan checkboxes from bead completion status.

```bash
tugtool beads pull tugplan-1.md      # Pull completion for one tugplan
tugtool beads pull                    # Pull for all tugplans
tugtool beads pull --no-overwrite     # Don't change manually checked items
```

When a step's bead is closed, `pull` marks the checkpoint items as complete.

#### `tugtool beads link`

Manually link an existing bead to a step.

```bash
tugtool beads link tugplan-1.md step-3 bd-abc123
```

### Two-Way Sync Workflow

Beads integration supports a bidirectional workflow:

1. **TugPlan → Beads** (sync): Create beads from your tugplan
   ```bash
   tugtool beads sync tugplan-feature.md
   ```

2. **Work in Beads**: Team members work on beads, closing them when complete

3. **Beads → TugPlan** (pull): Update tugplan checkboxes from bead status
   ```bash
   tugtool beads pull tugplan-feature.md
   ```

4. **Check Status**: See what's ready to work on
   ```bash
   tugtool beads status tugplan-feature.md
   ```

5. **Iterate**: Re-sync after adding new steps, pull after completing work

### Example Session

```bash
# Initialize beads (one-time setup)
bd init

# Create beads from your tugplan
tugtool beads sync tugplan-1.md
# Output: Synced tugplan-1.md to beads:
#   Root bead: bd-abc123
#   Steps synced: 5
#   Dependencies added: 3

# Check what's ready to work on
tugtool beads status tugplan-1.md
# Output: Step 0: Setup     [x] complete  (bd-abc123.1)
#         Step 1: Core      [ ] ready     (bd-abc123.2)
#         Step 2: Tests     [ ] blocked   (bd-abc123.3) <- waiting on bd-abc123.2

# After completing work, close the bead
bd close bd-abc123.2

# Pull completion back to tugplan checkboxes
tugtool beads pull tugplan-1.md
# Output: tugtool-1: 3 checkboxes updated
```

### Beads Readiness Checklist

Before using beads integration, verify your setup:

1. **Tugtool CLI installed and on PATH:**
   ```bash
   tugtool --version
   # Should show: tugtool x.y.z
   ```

2. **Beads CLI (`bd`) installed and on PATH:**
   ```bash
   bd --version
   # Should show: bd x.y.z
   ```
   If not on PATH, set `TUG_BD_PATH` or configure in `.tugtool/config.toml`.

3. **Beads initialized in your project:**
   ```bash
   ls .beads/
   # Should show: config.toml, beads.db, etc.
   ```
   If not present, run `bd init`.

4. **Verify beads commands work:**
   ```bash
   tugtool beads status --json
   # Should return valid JSON (even if no tugplans have beads yet)
   ```

**Discovery chain for `bd` binary:**
1. `TUG_BD_PATH` environment variable (highest priority)
2. `config.tugtool.beads.bd_path` from `.tugtool/config.toml`
3. Default `"bd"` (expects `bd` on PATH)

## Configuration

Project configuration lives in `.tugtool/config.toml`:

```toml
[tugtool]
skeleton_file = "tugplan-skeleton.md"
default_status = "draft"
naming_pattern = "tugplan-*.md"

[tugtool.beads]
enabled = true
bd_path = "bd"              # Path to beads CLI
root_issue_type = "epic"    # Issue type for root bead
substeps = "none"           # Substep handling: "none" or "children"
pull_checkbox_mode = "checkpoints"  # What to check: "checkpoints" or "all"
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments or file not found |
| 3 | Validation error |
| 5 | Beads CLI not installed |
| 9 | Not initialized (.tugtool/ not found) |
| 13 | Beads not initialized |

## Error Codes

| Code | Description |
|------|-------------|
| E001 | Parse error |
| E002 | Missing required field |
| E005 | Invalid anchor format / Beads CLI not installed |
| E006 | Duplicate anchor |
| E009 | Not initialized (.tugtool/ not found) |
| E010 | Broken reference |
| E011 | Circular dependency |
| E013 | Beads not initialized (.beads/ not found) |
| E016 | Beads command failed |
| E035 | Beads sync failed |
| E036 | Bead commit failed |

## Troubleshooting

### "Not initialized"

Run `tugtool init` in your project directory to create the `.tugtool/` directory.

### "Beads CLI not installed" (E005)

The beads commands require the `bd` binary:

1. Install the beads CLI from [beads releases](https://github.com/kocienda/beads/releases)
2. Add to PATH, or set `TUG_BD_PATH` environment variable
3. Verify: `bd --version`

### "Beads not initialized" (E013)

Run `bd init` in your project directory to create the `.beads/` directory.

### "Beads command failed" (E016)

A beads operation failed. Check the error message for details. Common causes:
- Network connectivity issues
- Invalid bead ID
- Permission problems

### Validation Errors

Check the specific issues with:

```bash
tugtool validate tugplan-problem.md --json
```

Common issues: missing sections, invalid anchor format, broken references.

### Plugin Not Loading

If skills/agents aren't available in Claude Code:

```bash
# Verify you're loading the plugin
claude --plugin-dir /path/to/tugtool

# Check skills are discovered
# In Claude Code: /help
# Should list /tugtool:plan, /tugtool:execute, etc.
```

## Documentation

- **[Getting Started Guide](docs/getting-started.md)** - Installation, setup, and core concepts
- **[Tutorial: Create Your First TugPlan](docs/tutorials/first-plan.md)** - Walk through the planning workflow
- **[Tutorial: Execute a TugPlan](docs/tutorials/execute-plan.md)** - Walk through the execution workflow

## License

MIT
