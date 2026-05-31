---
name: vet
description: Vet a plan (or a step range within it) BEFORE implementation — assess plan quality, coherence, technical choices, and strategy; check it against the tuglaws and the real code; then rule "fixups needed" or "clear to implement"
argument-hint: "[plan-path] [; Step N | Steps N-M]"
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, WebFetch, WebSearch
disallowed-tools: Task, Write, Edit
---

## What this is

`vet` is the **pre-implementation** scrutiny pass. You point it at a plan
— optionally a single step or a range — and it pulls back to judge whether
the plan is actually good *before* anyone writes the code. It is the encapsulation of
the assessment the user runs by hand all the time. It produces an assessment and a
verdict. It does **not** make changes — `vet` rules; the user (or `/tugplug:implement`)
acts.

**You are the reviewer, in-thread.** Do not spawn sub-agents (`Task`). Do not edit
files — this is a read-and-judge pass, not a fixup pass.

## Input

`/tugplug:vet <plan-path> [; Step N | Steps N-M]`

- `<plan-path>` — an **explicit path** to the plan to vet. There is no default
  location; the plan's path tells you which tree you're reading from (resolve roots from
  the `.tugtool/` marker, never from an assumed directory).
- optional `; Step N` or `; Steps N-M` — narrow the assessment to one step or a range.
  With no step clause, vet the whole plan.

## The pass

### 1. Ground yourself in the plan and the real code

Read the plan (or the named steps). Then read the **actual code** the plan would
touch — the components, data flow, and conventions it builds on. Don't assess the plan
in the abstract; assess it against how the code really works. Use Glob/Grep/Read
freely; pull external references with WebFetch/WebSearch only when the plan leans on
them.

### 2. Pull back and assess

Give your honest assessment of:

- **Plan quality and coherence** — is the design sound, internally consistent, and
  complete? Are the steps executable, with real commit boundaries and falsifiable
  checkpoints?
- **Technical choices** — are the chosen mechanisms right, or is there a simpler /
  more robust / more idiomatic option the plan missed?
- **Implementation strategy and sequencing** — does the step order make sense? Are
  dependencies real and minimal? Is anything mis-scoped or out of order?
- **Holes, pitfalls, weaknesses, limitations** — what will bite during
  implementation? What edge cases, failure modes, or migration hazards are unaddressed?
- **Test plan sanity** — flag any step whose Test Plan proposes a **banned** test:
  fake-DOM/RTL (`happy-dom`, `jsdom` render, `@testing-library/react`) or mock-store
  assertion tests. Real-app behavior must target `tests/app-test/` (`just app-test`);
  everything else is pure-logic `bun:test`. Catching this now saves a doomed step later.

Look holistically. Don't just read it as a refactor — determine whether the changes
are *actually good*, not merely plausible on paper. Judge whether the result, once
built, is something the codebase wants.

### 3. Confirm tuglaws adherence

Confirm the proposed changes adhere to the **tuglaws** as defined in
[`tuglaws/tuglaws.md`](../../../tuglaws/tuglaws.md) (cross-check
[`design-decisions.md`](../../../tuglaws/design-decisions.md) where relevant). Name the
specific laws the plan touches (`[L02]`, `[L22]`, `[L24]`, `[L26]`, …) and state, for
each, whether the plan honors it or risks violating it. For tugdeck/tugways work this
is mandatory — call out the State Zone Mapping and whether each piece of state lands in
the right zone.

### 4. Confirm it sets us up for the future

Confirm that this plan, once implemented, leaves the architecture in a better place —
not just locally correct, but a foundation the next features can build on without
having to undo it.

### 5. Verdict

End with a clear ruling:

> **Do we need to make fixups? Or can we move on to the implementation?**

- If **fixups are needed**, list them concretely and in priority order — what to change
  in the plan and why — so the user can fold them in before `/tugplug:implement`.
- If the plan is **clear to implement**, say so plainly, with the confidence level and
  any watch-items to keep an eye on during the build.

## Guardrails

- **No sub-agents.** Read and judge in-thread.
- **No edits.** `vet` assesses and recommends; it never rewrites the plan or the code.
- **Ground every claim in the real code or the tuglaws.** No abstract hand-waving.
- **Always end with the explicit verdict** (fixups vs. clear to implement).
