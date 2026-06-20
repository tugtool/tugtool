# Claude Code Guidelines for Tugtool

## Project Overview

Tugtool is a developer tool suite. Its centerpiece is the **Dev card** — a graphical surface where shell commands and AI interactions coexist in one UI, replacing the terminal. The suite includes tugcast (WebSocket multiplexer), tugcode (Claude Code bridge), tugutil (project management CLI), tugdeck (browser frontend), tugplug (agentless skills), and Tug.app (macOS host).

## Git Policy

**ONLY THE USER CAN COMMIT TO GIT.** Do not run `git commit`, `git push`, or any git commands that modify the repository history unless explicitly instructed by the user. You may run read-only git commands like `git status`, `git diff`, `git log`, etc.

**Exceptions:**
- The `/tugplug:commit` skill: when the user invokes it, commit immediately without asking for confirmation.
- Autonomous implementation: when the user explicitly authorizes autonomous sub-step execution (e.g., "go on your own"), commit after each sub-step using the same commit style as the `/tugplug:commit` skill. Report each commit hash and message.
- The `implement` and `dash` skills commit on their **`tugutil dash` worktree** (never on `main`) via `tugutil dash commit`, as part of running a recipe / dash. `main` is only updated by the user-invoked `tugutil dash join`.

## Repository Structure

| Directory | Description |
|-----------|-------------|
| `tugrust/` | Rust crates (tugcast, tugutil, tugexec, tugbank, tugcore, and supporting libraries) |
| `tugproto/` | Shared protocol / message types (TypeScript) |
| `tugcode/` | Claude Code bridge (stream-json IPC); bun-compiled binary |
| `tugdeck/` | Web frontend (the Dev card lives here) |
| `tugapp/` | Swift macOS app (Tug.app host) |
| `tugplug/` | Claude Code plugin (agentless skills: devise/implement/dash/vet/audit/commit) |
| `tuglaws/` | Architecture laws + design decisions — the curated durable doc surface |
| `roadmap/` | Implementation plans (recipes) |
| `tests/` | App-test harness that drives the real Tug.app |

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

Theme tokens live in `tugdeck/styles/themes/*.css` — `brio`/`nocturne`/`bravura` (dark) and `harmony`/`aria`/`vivace` (light). These are hand-authored CSS files — there is no generation script. Edit them directly when adding or tuning tokens. Each theme is one tint hue over a shared tone skeleton; see `tuglaws/theme-engine.md` for the authoring doctrine. Validate contrast with `bun run audit:theme-contrast` (no theme may exceed the `brio` accessibility budget). Register new themes in `SHIPPED_THEME_NAMES` (`tugdeck/src/action-dispatch.ts`).

## AskUserQuestion — shape and affordances

`AskUserQuestion`'s shape is fixed **upstream by Claude Code's own schema**, not by Tug: **1–4 questions per call, 2–4 options per question** (a hard minimum of 2 and maximum of 4 options). A call outside those bounds fails with an `InputValidationError` inside Claude Code *before* the request is ever forwarded to the Dev card — so this is not a constraint Tug can relax by editing anything here.

When generating an `AskUserQuestion` call:
- Give each question **2–4 options**.
- If you have more candidate choices, split them across multiple questions (up to 4 questions per call) — the per-question cap is real, the per-call question count gives you room.

Two rows the terminal renders below the options — **`Type something`** (a free-text answer) and **`Chat about this`** (dismiss the questions and reply in prose) — are harness *affordances*, not options, and don't count against the 2–4 cap. On the answer side they come back as the free-text answer value and the optional top-level `response` field respectively. The Dev card's `QuestionDialog` is where Tug renders these (see `chrome/dev-question-dialog.tsx`).

Tug-side handling: the `QuestionDialog` renders **any** number of options with no cap of its own — the 2–4 limit lives only in Claude Code upstream. If a call somehow exceeds 4 (e.g. a drifted or hand-crafted payload), `AskUserQuestionToolBlock` detects the `InputValidationError` and mounts a salvage path so the user can still answer. Overflow is therefore graceful, but generate within 2–4 so the round-trip isn't wasted.

## Tugdeck — Tuglaws

Before implementing any tugways/tugdeck code, verify against the [Tuglaws](tuglaws/tuglaws.md) and [Design Decisions](tuglaws/design-decisions.md). Critical laws:

1. **One `root.render()`, at mount, ever.** [L01]
2. **External state enters React through `useSyncExternalStore` only.** [L02]
3. **Use `useLayoutEffect` for registrations that events depend on.** [L03]
4. **Appearance changes go through CSS and DOM, never React state.** [L06]
