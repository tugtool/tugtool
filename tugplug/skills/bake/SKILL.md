---
name: bake
description: Bake a recipe (an implementation plan) into a tested build on an isolated worktree — agentless, in-thread, committing per step, stopping for review before merge
argument-hint: "[recipe-path]"
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, TaskCreate, TaskUpdate
disallowed-tools: Task
---

## What this is

`bake` carries one recipe — a plan document — from start to a launchable, tested
build, on its own git worktree, **driven by you — the main conversation — directly**.
There is no agent swarm, no drift-set ceremony, no conformance/critic/auditor gate, no
inter-agent JSON contract. You read the recipe, you do the work, you run the
checkpoints, you commit each step. The worktree lifecycle rides the `tugutil dash`
CLI; the recipe is your checklist.

This replaces the old multi-agent `implement` orchestrator. The old way was too much
ceremony for the value it returned. The new way keeps the user in a tight feedback
loop and keeps the cost low.

**You are the baker.** Do not spawn sub-agents (`Task`). If you catch yourself
reaching for one, stop — the point of this skill is that you do the work in-thread.

## Input

`/tugplug:bake <recipe-path>` — a recipe written against the tugplan skeleton (e.g.
`roadmap/tool-call-header.md`). It must pass `tugutil validate`.

If no recipe exists yet, author one first with `/tugplug:recipe`, or write it inline —
then point `bake` at it.

## The five phases

### 1. Setup

1. `tugutil validate <recipe>` — the recipe must be valid (has execution steps). Fix
   or bail if not.
2. Derive a short dash name from the recipe slug. `tugutil dash create <name>
   --description "<one line>" --json`. Capture `worktree` and `branch` from the
   response. (Branch is `tugdash/<name>`; worktree is `.tugtree/tugdash__<name>/`.)
3. The recipe rides along from `main` if it's committed there; otherwise copy it into
   the worktree.
4. **All work from here happens inside the worktree directory.**
5. If `tugdeck/node_modules` is absent (a fresh worktree checkout), run
   `bun install` in `tugdeck/`. Establish a green baseline (`bun test`, and for
   Rust changes `cd tugrust && cargo nextest run`) so you know what "still green"
   means.
6. Create one task per recipe step (`TaskCreate`) so progress is visible.

### 2. Bake (walk the steps)

Walk the recipe's execution steps in dependency order. For each step:

- Read the step's Tasks / References / Checkpoint.
- Do the work yourself, in the worktree. Match the surrounding code's style.
- Run **that step's checkpoint** before committing: typecheck (`bunx tsc --noEmit`),
  unit tests (`bun test <scope>`), the relevant gallery/HMR check, and
  `just app-test <file>` where the step calls for a real-app test. For Rust, `cargo
  nextest run`. **Warnings are errors** — leave zero new lint/type findings, and fix
  pre-existing ones you touch.
- Commit the step:
  ```bash
  tugutil dash commit <name> --message "<conventional commit>" --json <<'EOF'
  {"instruction":"Step N: <title>","summary":"<what landed + how verified>","files_modified":[...],"files_created":[...]}
  EOF
  ```
  One command: it makes the git commit AND records a round you can later read with
  `tugutil dash show <name>`.
- Mark the task complete; move to the next step.

Pragmatics:
- Folding trivial or already-absorbed steps into a neighbor is fine — `dash join`
  squashes at the end, so per-step commit granularity is for *your* visibility
  during the run, not the final history.
- If a step's verification fails, fix it before committing. Never commit red.

### 3. Build

From the worktree directory:
```bash
just app-debug
```
This builds + signs + launches a separate `(debug, <branch>)` instance derived from
the worktree's cwd — independent of the user's main instance. Confirm it's live
(`just instances`), and report the instance id plus `just launch-debug` /
`just logs-debug` / `just stop-debug`.

**Stop here.** Do not merge. The build is the user's to vet and test.

### 4. Iterate (interactive)

The user tests and reports issues. Fix them on the worktree, run the relevant
checkpoint, and commit each fix as its own `dash commit` round. Know your build
surface:
- **tugdeck (frontend)** changes are live via Vite HMR — no rebuild; tell the user
  to hard-reload the card if Fast Refresh doesn't repaint a row.
- **Rust / tugcode / Swift** changes need a rebuild — `just app-debug` again (tugcode
  is bun-compiled; it has no HMR).

Loop until the user is satisfied.

### 5. Join (only on the user's word)

Do **not** merge until the user explicitly asks. When they do:
```bash
tugutil dash join <name>
```
This squash-merges `tugdash/<name>` into `main` and cleans up the worktree + branch.
Preflight needs `main`'s tracked files clean — if it balks, tell the user to commit
or stash their unrelated main-checkout changes first.

## Guardrails

- **No sub-agents.** You do the work in-thread.
- **Never commit to `main`.** All commits go to the dash worktree via
  `tugutil dash commit`. The user owns `main`; `dash join` is the only path back, and
  only on their say-so.
- **Verify before every commit.** Green typecheck + tests. Warnings are errors.
- **Stop before merge.** The user tests the build first.
- **Fix what you touch.** Pre-existing issues in files you edit are yours to fix, not
  report.

## When to reach for something else

This skill holds all the recipe's context in one conversation, which fits
small-to-medium recipes well (a dozen steps is healthy). For a very large recipe
(many heavy steps that would exhaust the conversation), split it into phases and run
`bake` per phase, or author smaller recipes. For a quick, recipe-less change, use
`/tugplug:dash` instead.
