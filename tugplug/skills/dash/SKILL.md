---
name: dash
description: Quick, plan-less, worktree-isolated work — agentless, in-thread, committing per round, stopping for review before merge
argument-hint: "[name] [instruction|status|join|release]"
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, TaskCreate, TaskUpdate
disallowed-tools: Task
---

## What this is

`dash` is the lightweight path for a quick task — a bug fix, a spike, a small
feature, a prototype — that doesn't warrant a full plan. Like `implement`, it
runs on an isolated `tugutil dash` worktree and **you — the main conversation — do the
work directly**. No plan, no steps, no drift detection, and **no sub-agent**: you
execute the user's instruction in-thread, commit each round, and stop before merge.

(If the task is big enough to want a plan with steps, author one with
`/tugplug:devise` and run it with `/tugplug:implement` instead.)

**You are the worker.** Do not spawn sub-agents (`Task`). Do the work in-thread.

## Input grammar

`/tugplug:dash <tokens…>`

- `/tugplug:dash <name> <instruction…>` — create the dash `<name>` if new (or
  continue it), then carry out `<instruction>`.
- `/tugplug:dash <name> status` — show that dash's details and rounds.
- `/tugplug:dash <name> join [message…]` — squash-merge the dash to its base branch.
- `/tugplug:dash <name> release` — discard the dash without merging.
- `/tugplug:dash status` — list all dashes.

`<name>` is alphanumeric + hyphens, 2+ chars. Reserved words: `status`, `join`,
`release`.

## Lifecycle

### Create / continue

```bash
tugutil dash create <name> --description "<first ~100 chars of the instruction>" --json
```
Idempotent — returns the existing active dash if `<name>` already exists. **Capture the
absolute `worktree` path** and `branch` from the response. If `tugdeck/node_modules` is
absent in a fresh worktree, `bun install` in `tugdeck/`. **From here, the worktree
directory is the one and only working root: address every read, write, edit, and test
by absolute path into the worktree, and never write to the base checkout.** A stray
write to the base root also blocks `join` (its preflight requires the base clean).

### Work (in-thread, per round)

Carry out the instruction yourself in the worktree. Match the surrounding code's
style. Before committing, run the relevant checks — typecheck (`bunx tsc --noEmit`),
pure-logic tests (`bun test <scope>` / `cargo nextest run`), and real-app tests via
**`just app-test <file>`** where it matters (never a hand-rolled `TUGAPP_*` bun-test
pipeline; `just app-test` ends in a greppable `VERDICT: PASS|FAIL` line). **Warnings
are errors.** Then commit the round:
```bash
tugutil dash commit <name> --message "<conventional commit>" --json <<'EOF'
{"instruction":"<the instruction>","summary":"<what you did + how verified>","files_modified":[...],"files_created":[...]}
EOF
```
One command: git commit + a recorded round (`tugutil dash show <name>` to read them).
A follow-up instruction for the same dash is just another round — do it and commit
again.

### Build (when there's something to see)

For a change the user should look at in the app, build + launch from the worktree:
```bash
just app-debug
```
That brings up the `(debug, <branch>)` instance. **Stop and let the user vet it** —
don't merge.

### Join (only on the user's word)

```bash
tugutil dash join <name> [--message "…"]
```
Squash-merges `tugdash/<name>` into the base branch and cleans up the worktree +
branch. Preflight needs the base checkout's tracked files clean.

### Release

```bash
tugutil dash release <name>
```
Discards the dash (worktree + branch) without merging.

### Status

`tugutil dash show <name> --json` for one dash; `tugutil dash list --json` for all.

## Guardrails

- **No sub-agents.** You do the work in-thread.
- **Never commit to the base branch.** All commits go to the dash worktree via
  `tugutil dash commit`; `dash join` is the only path back, and only on the user's
  say-so.
- **Verify before every commit.** Warnings are errors.
- **Right test, never a banned one.** Real-app tests via `just app-test` (never a
  hand-rolled `TUGAPP_*` pipeline); pure-logic via `bun:test`. No fake-DOM/RTL tests,
  no mock-store assertion tests — ask first if tempted.
- **No plan numbers in durable artifacts.** No step identifiers in code, comments,
  docstrings, test names, or commit messages — describe the behavior directly.
- **Name the laws.** For tugdeck/tugways changes, cross-check the tuglaws
  (`tuglaws.md`, `pane-model.md`, `component-authoring.md`) and state which laws the
  change touches in the dash commit body.
- **Stop before merge.** The user vets the result first.
- **Fix what you touch.** Pre-existing issues in files you edit are yours to fix.
