---
name: implement
description: Implement a plan into a tested build on an isolated worktree — walk a single step, a step range, or the whole plan; agentless, in-thread, committing per step, stopping for review before merge
argument-hint: "[plan-path] [Step N | Steps N-M]"
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, TaskCreate, TaskUpdate
disallowed-tools: Task
---

## What this is

`implement` carries a plan document from start to a launchable, tested build, on its own
git worktree, **driven by you — the main conversation — directly**. There is no agent
swarm, no drift-set ceremony, no conformance/critic/auditor gate, no inter-agent JSON
contract. You read the plan, you do the work, you run the checkpoints, you commit each
step. The worktree lifecycle rides the `tugutil dash` CLI; the plan is your checklist.

This replaces the old multi-agent orchestrator. The old way was too much ceremony for
the value it returned. The new way keeps the user in a tight feedback loop and keeps
the cost low.

**You are the implementer.** Do not spawn sub-agents (`Task`). If you catch yourself
reaching for one, stop — the point of this skill is that you do the work in-thread.

## Input

`/tugplug:implement <plan-path> [step-selector]`

- `<plan-path>` — an **explicit path** to a plan written against the devise skeleton.
  There is no default location — the path is always given.
- `[step-selector]` (optional) — **which steps to walk this invocation**:
  - *(omitted)* — walk the **whole plan** from the first unfinished step to the end.
  - `Step N` — walk a **single** step (e.g. `Step 3`).
  - `Steps N-M` — walk a **range/batch** of steps, inclusive (e.g. `Steps 3-5`).

The **Step Status Ledger** at the top of the plan's Execution Steps is the source of
truth for "where are we?". Read it first:
- With no selector, resume at the first step still marked `pending` (don't redo `done`
  steps) and continue to the end.
- With a selector, honor it — but if an earlier step a selected step `**Depends on:**`
  is not yet `done`, say so and stop rather than building on an unfinished base.

**If the plan has no Step Status Ledger** (an older or hand-written plan), fall back
gracefully: with no selector, walk from Step 1; infer which steps are already done from
`git log` on the dash branch if the dash exists, and confirm with the user before
skipping any. Offer to add a ledger to the plan (on the worktree) so future runs resume
cleanly.

If no plan exists yet, author one first with `/tugplug:devise`, or write it inline —
then point `implement` at it.

## Where things live (the rule that keeps worktrees clean)

There is no canonical plan directory — never assume `roadmap/`, `.tugtool/`, or any
other home. **Derive the working context from what you're handed**, never from
convention:

- The plan is an **explicit path**. The plan file's location tells you where you're
  starting from — read it, and find the project root by its `.tugtool/` marker (or via
  `tugutil`), not by assuming a layout.
- The moment a dash worktree exists, **the worktree directory is the one and only
  working root.** Capture its absolute path from `tugutil dash create … --json` and use
  **absolute paths into the worktree** for *every* read, write, edit, and test from
  then on.
- **Never write to the base checkout once you're in a worktree.** Not code, not the
  plan, not the ledger. The only path back is `tugutil dash join`. A stray write to the
  base root will also block `join` (its preflight requires the base clean).
- If the plan lived on the base branch, work on its **worktree copy** — read the
  original by path once, then edit only the copy inside the worktree.

## The five phases

### 1. Setup

1. Read the **Step Status Ledger** (or apply the no-ledger fallback above) and resolve
   the step selector into a concrete list of steps to walk this run.
2. Derive a short dash name from the plan slug. `tugutil dash create <name>
   --description "<one line>" --json`. **Capture the absolute `worktree` path** and
   `branch` from the response. If the dash already exists (resuming a later step
   range), `create` is idempotent and returns it. `create` hydrates the fresh worktree
   itself (its `[tugtool.dash].post_create` hook runs `bun install`), so it arrives
   ready — no manual dependency install.
3. Make sure the plan is present **inside the worktree** so you can edit its ledger
   there: if it was committed on the base branch it already rode along; otherwise copy
   the file once from its given path into the worktree. From here you work on the
   worktree copy only — never the original on the base checkout.
4. **All work from here happens inside the worktree directory, addressed by absolute
   path. Nothing is written to the base checkout.**
5. Establish a green baseline (`bun test`, and for Rust changes
   `cd tugrust && cargo nextest run`) so you know what "still green" means.
6. Create one task per step in this run's list (`TaskCreate`) so progress is visible.

### 2. Implement (walk the steps)

Walk the resolved steps in dependency order. For each step:

- Read the step's Tasks / References / Checkpoint.
- Do the work yourself, in the worktree. Match the surrounding code's style.
- Run **that step's checkpoint** before committing: typecheck (`bunx tsc --noEmit`),
  pure-logic unit tests (`bun test <scope>`), the relevant gallery/HMR check, and a
  real-app test where the step calls for one (see **Test discipline** below). For Rust,
  `cargo nextest run`. **Warnings are errors** — leave zero new lint/type findings, and
  fix pre-existing ones you touch (don't punt them as "pre-existing").
- Commit the step:
  ```bash
  tugutil dash commit <name> --message "<conventional commit>" --json <<'EOF'
  {"instruction":"Step N: <title>","summary":"<what landed + how verified>","files_modified":[...],"files_created":[...]}
  EOF
  ```
  One command: it makes the git commit AND appends the verbatim instruction to the
  per-project dash-log (`tugutil state-dir`). Read progress back with `git log` on the
  dash branch.
- **Update the Step Status Ledger** in the plan: flip the step from `pending` to
  `done` and record its commit. (Edit the plan in the worktree.)
- Mark the task complete; move to the next step.

Pragmatics:
- Folding trivial or already-absorbed steps into a neighbor is fine — `dash join`
  squashes at the end, so per-step commit granularity is for *your* visibility
  during the run, not the final history.
- If a step's verification fails, fix it before committing. Never commit red.
- When you reach the end of the requested selection (single step, range, or whole
  plan), stop walking and report the ledger state — which steps are `done` and which
  remain `pending`.

### Test discipline

The kind of test must match the layer — and two kinds are **banned** in this codebase:

- **Real-app / browser-behavior tests** (focus, selection, event ordering, caret,
  portal timing, gestures) → write in `tests/app-test/` and run them with
  **`just app-test <file>`** (no file arg = full sweep). **Never hand-roll** the
  equivalent `TUGAPP_IN_APP_TEST=1 TUGAPP_DEBUG_PATH=… bun test …` pipeline — the
  `just app-test` target does the app-path query, re-sign, dist refresh, and pkill, and
  ends with a greppable `VERDICT: PASS|FAIL` last line. Check pass/fail via `tail -n 1`.
- **Pure-logic tests** (stores, protocol, math, validators, layout-tree) → plain
  `bun:test` files with no DOM globals.
- **BANNED — do not write, do not re-add:**
  - **Fake-DOM / RTL tests** — no `happy-dom`, no `jsdom`-based render tests, no
    `@testing-library/react`. happy-dom was deleted; there is no in-process DOM
    substrate. If a test would need `document`/`window` to express itself, rewrite it
    as a pure function over data or move it to `app-test`.
  - **Mock-store assertion tests** — never hand-roll a core interface (e.g.
    `IDeckManagerStore`) to assert mock method-call counts, and don't reflexively write
    per-mutator "pin" tests even against the real engine. `tsc --noEmit` already catches
    interface drift. Write an integration test only in response to a real bug, at the
    real layer.
  - If you think a banned-style test is genuinely worth it, **ask first** — don't just
    write it.

### Law discipline (tugdeck / tugways)

Before writing or materially changing code under `tugdeck/src/components/tugways/` or
`tugdeck/src/components/chrome/` (hooks, components, CardHost plumbing, portal/registry
wiring), consult [`tuglaws/tuglaws.md`](../../../tuglaws/tuglaws.md),
[`pane-model.md`](../../../tuglaws/pane-model.md), and
[`component-authoring.md`](../../../tuglaws/component-authoring.md) — and **name the
laws the change touches in the dash commit body** (e.g. "upholds L02 via
`useSyncExternalStore`; L22 via direct store observation"). Preservation-by-mimicry is
not an audit. Not required for Rust/Swift/plugin code or pure plan-doc edits.

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

Loop until the user is satisfied. A follow-up "now do Steps 6-8" is just another
`implement` run against the same plan and dash.

### 5. Join (only on the user's word)

Do **not** merge until the user explicitly asks. When they do:
```bash
tugutil dash join <name>
```
This squash-merges `tugdash/<name>` into the base branch (`main` for this repo) and
cleans up the worktree + branch. Preflight needs the base branch's tracked files clean
— if it balks, tell the user to commit or stash their unrelated base-checkout changes
first.

## Guardrails

- **No sub-agents.** You do the work in-thread.
- **Honor the selector and the ledger.** Walk exactly the requested steps; resume from
  the first `pending` step; never rebuild a `done` step or build on an unfinished
  dependency. No ledger → fall back (walk from Step 1, infer done-state from dash
  rounds / git, confirm before skipping).
- **Never commit to the base branch.** All commits go to the dash worktree via
  `tugutil dash commit`. The user owns the base branch; `dash join` is the only path
  back, and only on their say-so.
- **Verify before every commit.** Green typecheck + tests. Warnings are errors.
- **Right test, never a banned one.** Real-app tests via `just app-test` (never a
  hand-rolled `TUGAPP_*` pipeline); pure-logic via `bun:test`. No fake-DOM/RTL tests,
  no mock-store assertion tests — ask first if tempted.
- **No plan numbers in durable artifacts.** Never write step identifiers ("Step 4.5",
  "4i", "roadmap step X") into code, comments, docstrings, test names, or commit
  messages. Describe the behavior/reason directly. (The plan doc carries step numbers;
  the code and commits do not — the `tugutil dash` round's `instruction` field is the
  one place "Step N" belongs, since it's bookkeeping, not a durable artifact.)
- **Name the laws.** For tugdeck/tugways changes, cross-check the tuglaws and state which
  laws the change touches in the dash commit body.
- **Stop before merge.** The user tests the build first.
- **Fix what you touch.** Pre-existing issues in files you edit are yours to fix, not
  report.

## When to reach for something else

This skill holds the plan's context in one conversation, which fits small-to-medium
plans well (a dozen steps is healthy). For a very large plan (many heavy steps that
would exhaust the conversation), walk it in batches — `/tugplug:implement <plan>
Steps 1-4`, review, then `Steps 5-8` — or author smaller plans. For a quick,
plan-less change, use `/tugplug:dash` instead.
