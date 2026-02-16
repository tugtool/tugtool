# Tug

Tug is an AI-assisted software construction system.

The core idea (the "Tug Thesis") is simple: to do better work on larger software projects with AI, coding assistants need structured workflows, persistent artifacts, and explicit orchestration loops, not just ad-hoc prompts in a single context window.

Today, Tug centers on `tugplan` (a structured markdown plan artifact) and `tugtool` (the engine that validates plans and runs the workflow). In Claude Code, the main loop is:

1. `/tugtool:plan` - turn an idea into a validated tugplan.
2. `/tugtool:implement` - execute it in an isolated worktree and produce a PR.
3. `/tugtool:merge` - land the result on `main` and clean up.

Tug treats the work product as both code and process artifacts (decisions, steps, reviews, and commits), so larger changes stay coherent.

Status today: the `plan -> implement -> merge` flow is working now; the roadmap components below are planned and not yet operating as part of the live workflow.

## Roadmap Components

The broader Tug system is planned to include these components:

- `tugcast`: event stream of what happened during planning and implementation.
- `tugfeed`: typed channels that publish specific classes of events/data.
- `tugcard`: UI card that renders one or more feeds.
- `tugdeck`: control and observation surface for watching/steering execution.
- `tugdots`: connective execution model for preserving action/decision/state history.

See `roadmap/component-roadmap.md` for architecture details.

## Get Started From Scratch

This section is the fastest path from a fresh machine to a working Tug workflow.

### 1) Install System Dependencies

Required tools for the full workflow:

- `git` (repo/worktrees)
- `tmux` (required by `tugcast`)
- `gh` (PR creation/merge flows)
- `bd` (Beads CLI)
- Node.js + npm (for `tugdeck` frontend build)
- Rust toolchain (repo pins Rust `1.93.0`, with `rustfmt` and `clippy`)
- Claude Code CLI

On macOS (Homebrew example):

```bash
brew update
brew install git tmux gh node rustup
npm install -g @anthropic-ai/claude-code
```

Install and activate the pinned Rust toolchain:

```bash
rustup toolchain install 1.93.0 --component rustfmt --component clippy
rustup default 1.93.0
```

Install `bd` (Beads CLI) using your preferred method, then verify:

```bash
bd --version
```

Optional but recommended for tests:

```bash
cargo install cargo-nextest
```

### 2) Clone And Pull Repo Dependencies

```bash
git clone https://github.com/tugtool/tugtool.git
cd tugtool
```

Fetch Rust dependencies for all workspace crates:

```bash
cargo fetch --locked
```

Install frontend dependencies for `tugdeck`:

```bash
cd tugdeck
npm install
cd ..
```

### 3) Build Everything Once

Build the Rust workspace:

```bash
cargo build
```

Build the `tugdeck` bundle:

```bash
cd tugdeck
npm run build
cd ..
```

Run tests:

```bash
cargo nextest run
```

### 4) Install `tugtool` CLI (Optional For Local Dev)

For day-to-day use outside this repo checkout:

```bash
cargo install --path crates/tugtool
```

Verify:

```bash
tugtool --version
```

### 5) Initialize A Target Project

In the project where you want to use Tug:

```bash
tugtool init
tugtool init --check
tugtool doctor
```

### 6) Run Tug In Claude Code

Launch Claude Code with this plugin:

```bash
claude --plugin-dir /path/to/tugtool
```

Then run:

```text
/tugtool:plan "add a /health endpoint that returns service status and version"
/tugtool:implement .tugtool/tugplan-health.md
/tugtool:merge .tugtool/tugplan-health.md
```

## CLI Commands (Utility Surface)

The CLI is the utility/runtime layer around Tug workflows. 
You generally don't need to run these yourself. The agents run these commands for you as part of the `plan -> implement -> merge` workflow.

### Core

```bash
tugtool init
tugtool init --check
tugtool validate
tugtool validate .tugtool/tugplan-1.md
tugtool list
tugtool status .tugtool/tugplan-1.md
tugtool resolve
tugtool resolve user-auth
tugtool doctor
tugtool version --verbose
```

### Beads

```bash
tugtool beads sync .tugtool/tugplan-1.md
tugtool beads status
tugtool beads pull .tugtool/tugplan-1.md
tugtool beads close bd-abc123 --reason "Step complete"
```

### Worktree And Merge

```bash
tugtool worktree create .tugtool/tugplan-1.md --json
tugtool worktree list
tugtool worktree cleanup --merged
tugtool merge .tugtool/tugplan-1.md --dry-run
tugtool merge .tugtool/tugplan-1.md
```

### Log And Commit Utilities

```bash
tugtool log rotate
tugtool log prepend --step "#step-0" --plan .tugtool/tugplan-1.md --summary "Completed step 0"

# Primarily for automation agents:
tugtool commit --worktree /abs/path --step "#step-0" --plan .tugtool/tugplan-1.md --message "feat: ..." --bead bd-abc --summary "..."
tugtool open-pr --worktree /abs/path --branch tugplan/foo-123 --base main --title "..." --plan .tugtool/tugplan-1.md
```

## Repository Layout

```text
crates/
  tugtool/        # CLI binary crate
  tugtool-core/   # parser/validator/types library
  tugcast/        # event stream server (roadmap implementation)
  tugcast-core/   # protocol/types for tugcast
tugdeck/          # frontend deck/card UI
skills/           # orchestrator skills: plan, implement, merge
agents/           # sub-agent specs
roadmap/          # architecture and component roadmap
docs/             # user and reference docs
```

## Development Notes

- Run Tug as a plugin while developing: `claude --plugin-dir .`
- This repo treats warnings as errors (`-D warnings`).
- Beads integration is a required part of the implementation flow.

## Documentation

- `roadmap/component-roadmap.md` - tugcast/tugdeck architecture and phased roadmap
- `docs/beads-json-contract.md` - beads JSON contract details

## License

MIT
