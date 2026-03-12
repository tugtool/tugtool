# Getting Started with Tugtool

This guide will help you install tugtool, set up your first project, and understand the core workflows.

## Prerequisites

Before using tugtool, you'll need:

- **macOS**: tugtool currently supports macOS (arm64 and x86_64)
- **Claude Code**: Required for agent orchestration (`plan` and `execute` commands)
- **Git**: For version control integration

### Installing Claude Code

Tugtool uses Claude Code to orchestrate its agents. Install it from:

```bash
npm install -g @anthropic-ai/claude-code
```

Or follow the instructions at the [Claude Code documentation](https://docs.anthropic.com/claude-code).

## Installation

### Option 1: Homebrew (Recommended)

The easiest way to install tugtool on macOS:

```bash
brew tap tugtool/tugtool https://github.com/tugtool/tugtool
brew install tugtool
```

### Option 2: Download Binary

Download prebuilt binaries from [GitHub Releases](https://github.com/tugtool/tugtool/releases) (replace `<VERSION>` with a release tag like `0.2.30`):

```bash
# For Apple Silicon (M1/M2/M3)
curl -L https://github.com/tugtool/tugtool/releases/latest/download/tugtool-<VERSION>-macos-arm64.tar.gz | tar xz
sudo mv bin/tugtool /usr/local/bin/

# For Intel Mac
curl -L https://github.com/tugtool/tugtool/releases/latest/download/tugtool-<VERSION>-macos-x86_64.tar.gz | tar xz
sudo mv bin/tugtool /usr/local/bin/
```

### Option 3: Build from Source

Requires Rust 1.70+ and Cargo:

```bash
git clone https://github.com/tugtool/tugtool.git
cd tugtool
cargo install --path crates/tugtool
```

## Initial Setup

### 1. Initialize Your Project

Navigate to your project directory and initialize tugtool:

```bash
cd your-project
tugtool init
```

This creates:
- `.tugtool/` directory with configuration and the skeleton template
- `.claude/skills/` directory with Claude Code skills (if skills are available)

### 2. Install Claude Code Skills

If you installed via binary download, you may need to manually install the Claude Code skills:

```bash
tugtool setup claude
```

Verify the installation:

```bash
tugtool setup claude --check
```

### 3. Verify Installation

Check that everything is working:

```bash
tugtool --version
tugtool list       # Should show no tugplans yet
```

## Core Concepts

### What is a TugPlan?

A **tugplan** is a structured markdown document that describes a software change—from high-level idea to detailed implementation steps. Tugplans live in the `.tugtool/` directory and follow a defined format (see `.tugtool/tugplan-skeleton.md`).

Key sections in a tugplan:
- **TugPlan Metadata**: Owner, status, tracking info
- **Phase Overview**: Context, strategy, scope, success criteria
- **Design Decisions**: Recorded decisions with rationale
- **Execution Steps**: Step-by-step implementation with tasks, tests, and checkpoints

### The Agent Suite

Tug uses a multi-agent architecture where specialized agents collaborate:

| Agent | Role |
|-------|------|
| **Director** | Central orchestrator—coordinates all other agents |
| **Planner** | Transforms ideas into structured tugplans |
| **Critic** | Reviews tugplan quality and completeness |
| **Interviewer** | Gathers requirements and presents feedback |
| **Architect** | Creates implementation strategies for steps |
| **Implementer** | Writes code following architect's strategy |
| **Monitor** | Tracks progress and detects drift |
| **Reviewer** | Checks tugplan adherence after each step |
| **Auditor** | Verifies code quality |
| **Committer** | Handles git operations |

### Two Invocation Paths

You can invoke tugtool workflows in two ways:

**External CLI (terminal workflow):**
```bash
tugtool plan "add user authentication"
tugtool execute .tugtool/tugplan-auth.md
```

**Internal Claude Code (session workflow):**
```
/tugtool-plan "add user authentication"
/tugtool-execute .tugtool/tugplan-auth.md
```

Both paths produce identical outcomes—choose based on your workflow preferences.

## Workflow Overview

### 1. Planning: Idea to Plan

The planning workflow transforms an idea into a structured tugplan through an iterative refinement loop:

```
tugtool plan "your idea here"
         |
    INTERVIEWER (gather requirements)
         |
    PLANNER (create plan)
         |
    CRITIC (review quality)
         |
    INTERVIEWER (present results, ask: "ready or revise?")
         |
    user says ready? --> tugplan saved as active
    user has feedback? --> loop back with feedback
```

**Key features:**
- No arbitrary iteration limit—loop continues until you approve
- Punch list tracks open items across iterations
- Supports both new ideas and revision of existing tugplans

### 2. Execution: TugPlan to Code

The execution workflow implements a tugplan step-by-step:

```
tugtool execute .tugtool/tugplan-feature.md
         |
    FOR each step (in dependency order):
         |
    ARCHITECT (create implementation strategy)
         |
    IMPLEMENTER + MONITOR (write code, watch for drift)
         |
    REVIEWER + AUDITOR (verify quality)
         |
    COMMITTER (prepare commit)
         |
    (checkpoint or continue)
```

**Key features:**
- Steps execute in dependency order
- Monitor can halt execution if drift is detected
- Supports manual or automatic commits

## Quick Start: Build a Python Calculator

The fastest way to learn tugtool is to build something. Let's create a Python command-line calculator from scratch.

### 1. Create and Initialize Your Project

```bash
mkdir py-calc
cd py-calc
tugtool init
```

You'll see that tugtool creates the `.tugtool/` directory and installs Claude Code skills.

### 2. Plan Your Application

Start the planning loop with a clear description:

```bash
tugtool plan "create a python command-line calculator that supports +, -, *, /"
```

The interviewer asks clarifying questions, the planner creates a tugplan, and the critic reviews it. When you're satisfied with the tugplan, say "ready" to finalize.

### 3. Validate the TugPlan

Check that the generated tugplan is valid:

```bash
tugtool validate tugplan-py-calc.md
```

### 4. Execute the TugPlan

Implement the calculator by executing the tugplan:

```bash
tugtool execute .tugtool/tugplan-py-calc.md
```

The director orchestrates the agent suite to implement each step. You'll see progress updates and be prompted at checkpoints.

### 5. Track Progress

```bash
tugtool status tugplan-py-calc.md   # Detailed status
tugtool list                         # All tugplans overview
```

For the complete walkthrough, see the [Python Calculator Tutorial](tutorials/py-calc-example.md).

## Using Tug Inside Claude Code

If you're already in a Claude Code session, you can use slash commands:

```
/tugtool-plan "add caching to the database layer"
```

This enters the same iterative planning loop but runs directly in your Claude Code session, which can be more convenient than shelling out to the CLI.

For execution:

```
/tugtool-execute .tugtool/tugplan-caching.md
```

## Common Options

### Plan Command Options

```bash
tugtool plan [OPTIONS] [INPUT]

Options:
  --name <NAME>        Name for the plan file
  --context <FILE>     Additional context files (repeatable)
  --timeout <SECS>     Timeout per agent invocation (default: 300)
  --json               Output result as JSON
  --quiet              Suppress progress messages
```

### Execute Command Options

```bash
tugtool execute [OPTIONS] <TUGPLAN>

Options:
  --start-step <ANCHOR>   Start from this step (e.g., #step-2)
  --end-step <ANCHOR>     Stop after this step
  --commit-policy <P>     manual or auto (default: manual)
  --checkpoint-mode <M>   step, milestone, or continuous
  --dry-run               Show tugplan without executing
  --timeout <SECS>        Timeout per step (default: 600)
  --json                  Output result as JSON
```

## Troubleshooting

### "Claude CLI not installed"

The `plan` and `execute` commands require Claude Code. Install it:

```bash
npm install -g @anthropic-ai/claude-code
```

Then verify:

```bash
which claude
```

### "Not initialized"

Run `tugtool init` in your project directory to create the `.tugtool/` directory.

### "Skills not found"

If you installed tugtool via binary download, run:

```bash
tugtool setup claude
```

This copies the Claude Code skills from the share directory to your project.

### Validation Errors

Run `tugtool validate` to see specific issues:

```bash
tugtool validate --json tugplan-problem.md
```

Common issues:
- Missing required sections (check against `.tugtool/tugplan-skeleton.md`)
- Invalid anchor format (use lowercase, kebab-case)
- Broken references (ensure cited anchors exist)

### Agent Timeout

Increase the timeout for complex operations:

```bash
tugtool execute .tugtool/tugplan-complex.md --timeout 900
```

## Next Steps

- **Tutorial**: [Build a Python Calculator](tutorials/py-calc-example.md) — Complete greenfield example
- **Tutorial**: [Create Your First Plan](tutorials/first-plan.md) — Deep dive into the planning loop
- **Tutorial**: [Execute a Plan](tutorials/execute-plan.md) — Understanding the execution workflow
- **Contributing**: See [CONTRIBUTING.md](../CONTRIBUTING.md) for development setup
- **Reference**: Check `.tugtool/tugplan-skeleton.md` for the full tugplan format
