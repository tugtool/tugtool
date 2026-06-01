---
name: devise
description: Devise an implementation plan in-thread — clarify the idea, write it against the devise skeleton, validate it — ready for /tugplug:implement
argument-hint: "[idea] [→ output-path]"
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, AskUserQuestion
disallowed-tools: Task
---

## What this is

`devise` turns an idea into a concrete, implementable **plan** — a plan document
**written by you, the main conversation, directly**. No agent swarm, no clarifier/
author/critic/conformance/overviewer hand-offs. You investigate the codebase, ask the
few questions that genuinely change the design, write the plan, and validate it. The
result is a plan document — written to a path **you specify** — that
`/tugplug:implement` can carry to a build.

(The skill is named `devise` to avoid colliding with Claude Code's built-in `plan`.
The document it produces is a standard tugplan in the devise-skeleton format, so
`/tugplug:implement` consumes it unchanged.)

**You are the author.** Do not spawn sub-agents (`Task`). Do the research and the
writing in-thread.

## Input

`/tugplug:devise <idea> [→ <output-path>]` — a free-text description of what to build,
and **where to write the plan**.

## Where the plan goes (no assumed directory)

A plan is just a markdown file at an **explicit path**. There is **no default
directory** — never assume `roadmap/`, `.tugtool/`, or any other home. If the
invocation doesn't name an output path, **ask the user for it** (one question) before
writing; propose a filename (from the slug) but let them supply the location. Write the
plan exactly there and report the path you wrote. Whether and where it's committed to
git is the user's call.

## The flow

### 1. Understand

Read the relevant code before designing. Use Glob/Grep/Read to map the territory:
the components, the data flow, the existing conventions, the laws that apply
(tuglaws for tugdeck work). Pull external references with WebFetch/WebSearch only
when the idea needs them. The plan must be grounded in how the code actually works,
not how you imagine it works.

### 2. Clarify (only what matters)

Ask clarifying questions **only when the answer changes the design** and you can't
resolve it from the code or a sensible default. Use `AskUserQuestion` (≤4 options
each). Don't interrogate — a couple of sharp questions beat a checklist. If the idea
is already specific, skip straight to writing.

### 3. Write against the skeleton

Author the plan at the output path you were given (or asked for) following the
**devise skeleton**, [`tuglaws/devise-skeleton.md`](../../../tuglaws/devise-skeleton.md)
— this is the mandatory format. Conform to it exactly:

- The skeleton's section order: Purpose, Plan Metadata, Phase Overview (Context /
  Strategy / Success Criteria / Scope / Non-goals / Dependencies / Constraints /
  Assumptions), then Open Questions, Risks, Design Decisions, optional Deep Dives /
  Specification / Rollout / Symbol Inventory, Test Plan Concepts, **Execution Steps**
  (with a **Step Status Ledger**), Deliverables.
- Explicit `{#anchor}` headings; kebab-case; no phase numbers in anchors.
- Stable labels: plan-local Design Decisions `[P01]` (use `P`, **never** `D` — `[D##]`
  is reserved for the global `tuglaws/design-decisions.md`, which a plan may cite by
  reference), Open Questions `[Q01]`, Specs `S01`, Tables `T01`, Lists `L01`, Risks
  `R01`, Milestones `M01` — always two digits, never reused.
- **Execution Steps** each carry a `**Commit:**` message, `**References:**` (cite
  decisions/specs/anchors — never line numbers), `**Depends on:**` where applicable
  (anchor refs like `#step-1`), Tasks, Tests, and a falsifiable Checkpoint. This is
  the part `/tugplug:implement` walks. Seed the **Step Status Ledger** with every step
  marked `pending`.
- For tugdeck/tugways work, fill the **State Zone Mapping** table — map each new piece
  of state to its tuglaws zone before writing steps.
- Resolve open questions where you can (spike them in-thread — read the code, check a
  fixture); explicitly defer the rest with a rationale.

Prefer a tight, real plan over an exhaustive one. Every step should be executable
with a clear commit boundary and a falsifiable checkpoint.

### 4. Self-check

Re-read the plan against the skeleton: required sections present, anchors unique,
`**Depends on:**` lines point at real step anchors, every step has a commit boundary
and a falsifiable checkpoint. Conformance is a convention you uphold by authorship and
review — fix anything off before handing off.

### 5. Hand off

Tell the user the plan is ready, name the exact path you wrote, and point them at
`/tugplug:implement <plan-path>`. Don't start implementing from the devise skill
— authoring and implementing are separate steps (as is committing the plan to git,
which the user owns).

## Guardrails

- **No sub-agents.** Research and write in-thread.
- **Explicit path, no assumed directory.** The plan goes exactly where the user says.
  Never hardcode or default to `roadmap/`, `.tugtool/`, or any other location — ask if
  the path wasn't given.
- **Conform to the skeleton.** `tuglaws/devise-skeleton.md` is the format contract,
  upheld by authorship and review.
- **Ground the plan in the real code.** Read before you design.
- **Don't over-ask.** Clarify only design-changing unknowns.
- **Don't auto-implement.** `devise` produces the document; `implement` runs it.
- **Don't auto-enter Plan mode** (`EnterPlanMode`) — just write the plan document.
