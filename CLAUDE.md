# Claude Code Guidelines for Tugtool

## Project Overview

Tugtool transforms ideas into working software through orchestrated LLM agents. A multi-agent suite collaborates to create structured tugplans and execute them to completion—from initial idea through implementation, review, and delivery.

## Git Policy

**ONLY THE USER CAN COMMIT TO GIT.** Do not run `git commit`, `git push`, or any git commands that modify the repository history unless explicitly instructed by the user. You may run read-only git commands like `git status`, `git diff`, `git log`, etc.

**Exceptions:**
- The `tugcode worktree setup` command commits the tugplan file and .tugtool/ infrastructure to the worktree branch as part of worktree setup.
- The `committer-agent` is explicitly given the job to make commits during the implementer workflow.

## Repository Structure

| Directory | Description |
|-----------|-------------|
| `tugcode/` | Rust CLI crates (tugcode binary + tugtool-core library) |
| `tugplug/` | Claude Code plugin (agents and skills) |
| `tugapp/` | Swift macOS app |
| `tugdeck/` | Web frontend |
| `tugtalk/` | Speech interface |
| `docs/` | Documentation |

## Build Policy

**WARNINGS ARE ERRORS.** The tugcode project enforces `-D warnings` via `tugcode/.cargo/config.toml`.

- `cargo build` will fail if there are any warnings
- `cargo nextest run` will fail if tests have any warnings
- Fix warnings immediately; do not leave them for later

## Testing

Run tugcode tests with:
```bash
cd tugcode && cargo nextest run
```
