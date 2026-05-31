---
name: audit
description: Audit the implementation work for a plan (or a step range) AFTER it's built — assess code quality, coherence, technical choices, and architecture; audit it against the tuglaws and the real diff; then rule "fixups needed" or "codebase is in good shape"
argument-hint: "[plan-path] [; Step N | Steps N-M]"
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, WebFetch, WebSearch
disallowed-tools: Task, Write, Edit
---

## What this is

`audit` is the **post-implementation** scrutiny pass — the counterpart to
`/tugplug:vet`. Where `vet` judges a plan before the code is written, `audit` judges
the **code that got written** for a plan (or a step range) after the fact. It is the
encapsulation of the audit the user runs by hand all the time. It produces an
assessment and a verdict. It does **not** make changes — `audit` rules; the user (or a
follow-up `/tugplug:implement` / `/tugplug:dash`) acts.

**You are the auditor, in-thread.** Do not spawn sub-agents (`Task`). Do not edit
files — this is a read-and-judge pass, not a fixup pass.

## Input

`/tugplug:audit <plan-path> [; Step N | Steps N-M]`

- `<plan-path>` — an **explicit path** to the plan whose implementation you're
  auditing. There is no default location; the plan's path tells you which tree the work
  lives in (it may be a dash worktree — audit it where it is, resolving roots from the
  `.tugtool/` marker, never from an assumed directory).
- optional `; Step N` or `; Steps N-M` — narrow the audit to the work for one step or
  a range. With no step clause, audit all the implementation work for the plan.

## The pass

### 1. Establish what was actually built

Read the plan (and its **Step Status Ledger**) to know what was intended, then read
the **actual implementation**. Pull the diff — use `git log`/`git diff` for the
relevant commits (the ledger records commit hashes; on a dash worktree,
`tugutil dash show <name>` lists the rounds), and read the changed files in full, not
just the hunks. Audit the code as it stands, against what the plan promised.

### 2. Assess the code

Give your honest assessment of:

- **Code quality and coherence** — is it clean, consistent with the surrounding code,
  and free of dead ends, TODO-rot, or half-applied patterns?
- **Technical choices** — did the implementation pick the right mechanisms? Did it
  drift from the plan's decisions, and if so, for better or worse?
- **Implementation strategy** — is the work structured well, or are there seams,
  duplication, or leaks across layers that will cost later?
- **Holes, pitfalls, weaknesses, limitations** — bugs, unhandled edge cases, race
  conditions, missing tests, stale comments, warnings (warnings are errors here).
- **Test discipline (flag violations as findings):**
  - **Banned tests** — any fake-DOM/RTL test (`happy-dom`, `jsdom` render tests,
    `@testing-library/react`) or mock-store assertion test (hand-rolled core interface
    asserting mock call counts; reflexive per-mutator "pin" tests). These are banned in
    this codebase — call them out for deletion/rewrite. Real-app behavior belongs in
    `tests/app-test/` (run via `just app-test`); everything else is pure-logic
    `bun:test`.
  - **Plan numbers in durable artifacts** — any step identifier ("Step 4.5", "4i",
    "roadmap step X") written into code, comments, docstrings, test names, or commit
    messages. Flag each one; they should describe the behavior directly instead.

Look holistically. Determine whether the changes are *actually good*, not just whether
they match the plan in the abstract. A plan-faithful implementation can still be wrong.

### 3. Audit tuglaws adherence

Confirm the code adheres to the **tuglaws** as defined in
[`tuglaws/tuglaws.md`](../../../tuglaws/tuglaws.md) — **with an actual audit**, not a
glance. Cross-check [`design-decisions.md`](../../../tuglaws/design-decisions.md) where
relevant. Walk the specific laws the change touches (`[L02]`, `[L06]`, `[L22]`,
`[L23]`, `[L24]`, `[L26]`, …) and, for each, cite the concrete code that honors or
violates it. For tugdeck/tugways work this is mandatory: verify state landed in the
right zone (appearance via CSS/DOM, structure via stores/`useSyncExternalStore`,
direct DOM updates via store observers, not React round-trips), and that mount identity
and user-visible state are preserved across transitions.

### 4. Confirm the architecture sets us up for the future

Confirm this new architecture leaves the codebase in good shape — not just working, but
a foundation the next work builds on cleanly rather than around.

### 5. Verdict

End with a clear ruling:

> **Do we need to make fixups? Or can we move on from here with confidence that the
> codebase is in good shape?**

- If **fixups are needed**, list them concretely and in priority order — file, what's
  wrong, what to do — so they can be carried out (by the user, or a follow-up
  `/tugplug:implement` / `/tugplug:dash`).
- If the work is **solid**, say so plainly, with the confidence level and any
  watch-items worth tracking.

## Guardrails

- **No sub-agents.** Read and judge in-thread.
- **No edits.** `audit` assesses and recommends; it never rewrites the code.
- **Audit the real diff and real files.** Ground every finding in concrete code, not
  the plan's description of it.
- **Always end with the explicit verdict** (fixups vs. good shape).
