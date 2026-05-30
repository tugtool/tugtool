---
name: recipe
description: Author a recipe (an implementation plan) in-thread — clarify the idea, write it against the tugplan skeleton, validate it — ready for /tugplug:bake
argument-hint: "[idea]"
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, AskUserQuestion
disallowed-tools: Task
---

## What this is

`recipe` turns an idea into a concrete, implementable **recipe** — a plan document —
**written by you, the main conversation, directly**. No agent swarm, no clarifier/
author/critic/conformance/overviewer hand-offs. You investigate the codebase, ask the
few questions that genuinely change the design, write the recipe, and validate it. The
result is a `roadmap/*.md` document that `/tugplug:bake` can carry to a build.

(The skill is named `recipe` to avoid colliding with Claude Code's built-in `plan`.
The document it produces is a "recipe" — but its on-disk format is the standard
tugplan skeleton, so `tugutil validate` and `/tugplug:bake` consume it unchanged.)

**You are the author.** Do not spawn sub-agents (`Task`). Do the research and the
writing in-thread.

## Input

`/tugplug:recipe <idea>` — a free-text description of what to build.

## The flow

### 1. Understand

Read the relevant code before designing. Use Glob/Grep/Read to map the territory:
the components, the data flow, the existing conventions, the laws that apply
(tuglaws for tugdeck work). Pull external references with WebFetch/WebSearch only
when the idea needs them. The recipe must be grounded in how the code actually works,
not how you imagine it works.

### 2. Clarify (only what matters)

Ask clarifying questions **only when the answer changes the design** and you can't
resolve it from the code or a sensible default. Use `AskUserQuestion` (≤4 options
each). Don't interrogate — a couple of sharp questions beat a checklist. If the idea
is already specific, skip straight to writing.

### 3. Write against the skeleton

Author the recipe at `roadmap/<slug>.md` following the **tugplan skeleton**,
[`tuglaws/tugplan-skeleton.md`](../../../tuglaws/tugplan-skeleton.md) — this is the
mandatory format. Conform to it exactly:

- The skeleton's section order: Purpose, Plan Metadata, Phase Overview (Context /
  Strategy / Success Criteria / Scope / Non-goals / Dependencies / Constraints /
  Assumptions), then Open Questions, Risks, Design Decisions, optional Deep Dives /
  Specification / Rollout / Symbol Inventory, Test Plan Concepts, **Execution Steps**,
  Deliverables.
- Explicit `{#anchor}` headings; kebab-case; no phase numbers in anchors.
- Stable labels: Design Decisions `[D01]`, Open Questions `[Q01]`, Specs `S01`,
  Tables `T01`, Lists `L01`, Risks `R01`, Milestones `M01` — always two digits,
  never reused.
- **Execution Steps** each carry a `**Commit:**` message, `**References:**` (cite
  decisions/specs/anchors — never line numbers), `**Depends on:**` where applicable
  (anchor refs like `#step-1`), Tasks, Tests, and a falsifiable Checkpoint. This is
  the part `/tugplug:bake` walks.
- Resolve open questions where you can (spike them in-thread — read the code, check a
  fixture); explicitly defer the rest with a rationale.

Prefer a tight, real recipe over an exhaustive one. Every step should be executable
with a clear commit boundary and a falsifiable checkpoint.

### 4. Validate

```bash
tugutil validate roadmap/<slug>.md
```
Fix anything it flags (structure, anchors, references). The recipe isn't done until
it validates — `/tugplug:bake`'s setup gates on the same check.

### 5. Hand off

Tell the user the recipe is ready and point them at
`/tugplug:bake roadmap/<slug>.md`. Don't start implementing from the recipe skill
— authoring and implementing are separate steps (as is committing the recipe to git,
which the user owns).

## Guardrails

- **No sub-agents.** Research and write in-thread.
- **Conform to the skeleton.** `tuglaws/tugplan-skeleton.md` is the format contract;
  `tugutil validate` enforces it.
- **Ground the recipe in the real code.** Read before you design.
- **Don't over-ask.** Clarify only design-changing unknowns.
- **Don't auto-implement.** `recipe` produces the document; `implement` runs it.
- **Don't auto-enter Plan mode** (`EnterPlanMode`) — just write the recipe document.
