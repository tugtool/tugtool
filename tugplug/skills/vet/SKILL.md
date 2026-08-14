---
name: vet
description: Retired — use /tugplug:plan-review, which applies the same criteria and also fixes what it finds
argument-hint: "[plan-path]"
disable-model-invocation: true
allowed-tools: Read
disallowed-tools: Task, Write, Edit, Bash, Glob, Grep
---

## Retired

`vet` is gone. Its criteria live in [`tuglaws/plan-review-rubric.md`](../../../tuglaws/plan-review-rubric.md), and the pass that applies them is `review-plan` — which, unlike `vet`, can act on what it finds instead of handing it back.

`/tugplug:plan-devise` now asks for that review itself, so in the normal flow nobody types either command.

Do nothing else. Print the replacement, on its own line and inside backticks so the Session card renders it as a clickable chip, with the plan path the user gave (or a placeholder if they gave none):

`` `/tugplug:plan-review <plan-path>` ``

Then stop. Do not read the plan, do not review it, do not offer an assessment — running the real pass is one click away, and a half-review from a stub is worse than none.

This stub exists for typed muscle memory and for the `/tugplug:vet …` chips still clickable in old transcripts. It is deleted in a later release.
