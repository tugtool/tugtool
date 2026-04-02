# Claude Code Guidelines for Tugtool

## Project Overview

Tugtool transforms ideas into working software through orchestrated LLM agents. A multi-agent suite collaborates to create structured tugplans and execute them to completion—from initial idea through implementation, review, and delivery.

## Git Policy

**ONLY THE USER CAN COMMIT TO GIT.** Do not run `git commit`, `git push`, or any git commands that modify the repository history unless explicitly instructed by the user. You may run read-only git commands like `git status`, `git diff`, `git log`, etc.

**Exceptions:**
- The `/commit` skill: when the user invokes `/commit`, commit immediately without asking for confirmation.
- The `tugcode worktree setup` command commits the tugplan file and .tugtool/ infrastructure to the worktree branch as part of worktree setup.
- The `committer-agent` is explicitly given the job to make commits during the implementer workflow.

## Repository Structure

| Directory | Description |
|-----------|-------------|
| `tugrust/` | Rust crates (tugcast, tugcode CLI, tugbank, and supporting libraries) |
| `tugplug/` | Claude Code plugin (agents and skills) |
| `tugapp/` | Swift macOS app |
| `tugdeck/` | Web frontend |
| `tugcode/` | Claude Code bridge (stream-json IPC) |
| `docs/` | Documentation |

## Build Policy

**WARNINGS ARE ERRORS.** The Rust workspace enforces `-D warnings` via `tugrust/.cargo/config.toml`.

- `cargo build` will fail if there are any warnings
- `cargo nextest run` will fail if tests have any warnings
- Fix warnings immediately; do not leave them for later

## Testing

Run Rust tests with:
```bash
cd tugrust && cargo nextest run
```

## Tugdeck — Theme Token Files

Theme tokens live in `tugdeck/styles/themes/brio.css` and `tugdeck/styles/themes/harmony.css`. These are hand-authored CSS files — there is no generation script. Edit them directly when adding or tuning tokens.

## Tugdeck — Laws of Tug

Before implementing any tugways/tugdeck code, verify against the [Laws of Tug](tuglaws/laws-of-tug.md) and [Design Decisions](tuglaws/design-decisions.md). Critical laws:

1. **One `root.render()`, at mount, ever.** [L01]
2. **External state enters React through `useSyncExternalStore` only.** [L02]
3. **Use `useLayoutEffect` for registrations that events depend on.** [L03]
4. **Appearance changes go through CSS and DOM, never React state.** [L06]
