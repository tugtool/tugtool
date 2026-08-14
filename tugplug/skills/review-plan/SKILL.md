---
name: review-plan
description: Review a plan and fix what it finds — run the linter, apply the review rubric against the real code, edit the plan in place, and append a Review Record. Replaces the read-only vet pass.
argument-hint: "[plan-path]"
disable-model-invocation: true
allowed-tools: Bash, Read, Edit, Glob, Grep, WebFetch, WebSearch
disallowed-tools: Task, Write
---

## What this is

`review-plan` is the **pre-implementation** pass: read a plan, judge it against the real code, and **fix what you find**. It is not a report. The old `vet` skill was read-only by construction, so the only thing it could do with a finding was hand it back — and the answer was invariably "do the fixups". This does the fixups.

The card runs this automatically after `/tugplug:devise`, on the review model, as a visible turn. You can also invoke it by hand on any plan: one devised before this existed, one edited since, one written by hand.

**You are the reviewer, in-thread.** Do not spawn sub-agents (`Task`).

**You edit exactly one file: the plan.** Not the code the plan describes. A plan review that starts implementing is not a review.

## Input

`/tugplug:review-plan <plan-path>` — an **explicit path**. There is no default location; the plan's path tells you which tree you are reading from (resolve roots from the `.tugtool/` marker, never from an assumed directory).

## The pass

### 1. Lint it

```bash
tugutil plan lint <plan-path>
```

Every diagnostic is yours to fix, warnings included. They are mechanical by design — missing sections, duplicate anchors, `[D##]` where `[P##]` belongs, a step with no checkpoint, a `**Depends on:**` naming a step that does not exist or comes later, a ledger row with no step. Fix them in the plan and re-run until it is clean.

Exit 2 means the document is not a plan (or cannot be read). Say so and stop — do not review a brief as if it were a plan.

Fix the linter's findings *first*, so the reading below is spent on judgment rather than bookkeeping.

### 2. Read the code the plan touches

Read the actual components, data flow, and conventions the plan builds on — not the plan's description of them. Use Glob/Grep/Read freely; pull external references with WebFetch/WebSearch only when the plan leans on them.

This is the step that makes the review worth its cost. A finding you could have written from the plan alone is not a finding.

### 3. Apply the rubric

Read [`tuglaws/plan-review-rubric.md`](../../../tuglaws/plan-review-rubric.md) and work down it: plan quality and coherence, technical choices, strategy and sequencing, holes and pitfalls, test-plan sanity, the tuglaws cross-check (name the specific laws; for tugdeck work verify the State Zone Mapping), the does-this-leave-the-architecture-better test, and the cold-reader test.

If the rubric is absent — a project without `tuglaws/` — proceed on the criteria above and **say so** in the Review Record. A missing rubric degrades the review; it does not cancel it.

### 4. Apply the fixups

Edit the plan directly. Rewrite the step that was out of order, replace the banned test with the right one at the right layer, add the failure path the plan skipped, correct the decision that contradicts the code you just read.

What to fix versus what to raise:

- **Fix** anything you can settle from the code, the laws, or the plan's own decisions.
- **Raise as an Open Question** (`[Q##]`, with a rationale and a plan to resolve) anything that needs the user's judgment — a scope call, a product decision, a trade-off with no technically correct answer. Do not quietly decide those.
- **Leave alone** anything you merely would have done differently. A plan is not wrong for not being yours.

Keep the plan lint-clean as you go — re-run the linter after substantive edits.

### 5. Append the Review Record

Add one paragraph to `### Review Record {#review-record}` (immediately after Plan Metadata; add the section if the plan predates it). One round per pass, appended — never rewritten, since the point is the history.

```markdown
**Round 1 — 2026-08-13, opus.** Lint: 0 errors, 3 warnings (2 fixed).
Applied: sequencing — Step 4 depended on a later step, reordered; test plan — Step 2
proposed an RTL render test, rewritten as an app-test; law [L02] — the new store read
bypassed `useSyncExternalStore`, corrected in Spec S01.
Deferred: the migration-window question, now [Q03].
```

Prose, not a table — a table invites one-word entries, and the value is the specificity. Name what you changed and why, and what you deliberately did not.

### 6. Hand off

Report what changed, in a few lines. Then give the next move as a literal command on its own line, **inside backticks**, command and path together in one span:

`` `/tugplug:implement roadmap/my-plan.md` ``

The Session card only turns a command line into a clickable chip when it arrives as its own inline code span; written as bare prose it is dead text.

## Guardrails

- **No sub-agents.** Read, judge, and fix in-thread.
- **Edit only the plan file.** Never the code it describes.
- **Never report "looks good" without having read the code the plan touches.** A review that could have been written from the plan alone has not happened.
- **Ground every claim in the real code or the tuglaws.** Name the file, the symbol, the law.
- **Fix what you can; escalate what you cannot.** A judgment call becomes an Open Question, not a silent decision.
- **Always append the Review Record**, even on a clean pass — a round that found nothing is a fact worth recording, and a vacuous round is supposed to be visible in the artifact.
