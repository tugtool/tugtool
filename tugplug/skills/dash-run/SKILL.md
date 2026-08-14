---
name: dash-run
description: Quick, plan-less, worktree-isolated work — agentless, in-thread, committing per round, stopping for review before merge
argument-hint: "[name] [instruction|status|join|release]"
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, TaskCreate, TaskUpdate
disallowed-tools: Task
---

## What this is

`dash-run` is the lightweight path for a quick task — a bug fix, a spike, a small feature, a prototype — that doesn't warrant a full plan. It runs on an isolated dash worktree and **you — the main conversation — do the work directly**. No plan, no steps, no ledger: you execute the user's instruction in-thread, commit each round, and stop before merge.

(If the task is big enough to want a plan with steps, author one with `/tugplug:devise` and run it with `/tugplug:dash-implement` instead.)

**Read [`tuglaws/dash-work-doctrine.md`](../../../tuglaws/dash-work-doctrine.md) before you start.** It is the discipline every dash run works under — the one-and-only-working-root rule, the verification bar, test discipline and the banned test shapes, law discipline, round mechanics, the stop-before-landing obligation, and no plan numbers in durable artifacts. This skill states the flow; the doctrine states the rules, and it is not repeated here.

## Input grammar

`/tugplug:dash-run <tokens…>`

- `/tugplug:dash-run <name> <instruction…>` — create the dash `<name>` if new (or continue it), then carry out `<instruction>`.
- `/tugplug:dash-run <name> status` — show that dash's details and rounds.
- `/tugplug:dash-run <name> join [message…]` — land the dash into its base branch.
- `/tugplug:dash-run <name> release` — discard the dash without merging.
- `/tugplug:dash-run status` — list all dashes.

`<name>` is alphanumeric + hyphens, 2+ chars. Reserved words: `status`, `join`, `release`.

## Lifecycle

### Create / continue

```bash
tugutil dash create <name> --description "<first ~100 chars of the instruction>" --json
```

Idempotent — returns the existing active dash if `<name>` already exists. **Capture the absolute `worktree` path** and `branch` from the response; that path is the working root for everything that follows. `create` hydrates the fresh worktree itself (its `[tugtool.dash].post_create` hook runs `bun install`), so it arrives ready.

### Work (in-thread, per round)

Carry out the instruction yourself in the worktree. Run the checks the doctrine names, then commit the round:

```bash
tugutil dash commit <name> --message "<conventional commit>" --json <<'EOF'
{"instruction":"<the instruction>","summary":"<what you did + how verified>"}
EOF
```

One command: git commit + a line in the per-project dash-log (the verbatim instruction; `tug log` on the dash branch reads the commits back). A follow-up instruction for the same dash is just another round — do it and commit again.

### Build (when there's something to see)

For a change the user should look at in the app, build + launch from the worktree:

```bash
just app-debug
just instances
tugutil dash mark <name> built
```

That brings up the `(debug, <branch>)` instance and declares the dash `built`, which is what the Lens and the Changes card report while the user looks at it.

### Stop, with a draft on file

Before you stop for the user's vet, write the dash's **join draft** — the squash message their landing will land:

```bash
tugutil draft set --owner dash:<name> --message "<subject + rounds digest>"
```

Compose it from what the rounds actually did: an imperative subject under 50 chars naming the deliverable, then a terse factual digest. Every line unbroken to its end (**no hard wrapping**), no AI or agent attribution, ever. The landing gesture lands this message and does not compose one — a dash that reaches it draftless stops there.

Then **stop and let the user vet the build.** Don't merge.

### Join (only on the user's word)

The landing is the user's gesture: **`/join <name>`** in the Session card, which previews the merge and lands the squash with the draft you left. If the user asks you to run it instead, `/tugplug:dash-join <name>` is the same landing in skill form.

### Release

```bash
tugutil dash release <name>
```

Discards the dash (worktree + branch) without merging. This is the one irreversible act in the lane — run it only when the user says to.

### Status

`tugutil dash status <name>` for the lifecycle readout (stage, rounds, worktree dirt, draft, bound sessions); `tugutil dash show <name> --json` for one dash's detail; `tugutil dash list --json` for all.

## Guardrails

Everything in [`tuglaws/dash-work-doctrine.md`](../../../tuglaws/dash-work-doctrine.md), plus:

- **Leave the draft behind.** Stopping without one hands the user a landing gesture that cannot land.
- **Never release on your own initiative.** Release discards work.
