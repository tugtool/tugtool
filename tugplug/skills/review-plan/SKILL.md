---
name: review-plan
description: Renamed — use /tugplug:plan-review, the same skill under the plan-* namespace
argument-hint: "[plan-path]"
disable-model-invocation: true
allowed-tools: Read
disallowed-tools: Task, Write, Edit, Bash, Glob, Grep
---

## Renamed

`review-plan` is now `plan-review`. Nothing about the skill changed — the plan lane's skills share a `plan-*` prefix so the roster reads as a lane rather than a pile, and the verb now reads the way the card's own `/plan-review` does.

Do nothing else. Print the replacement, on its own line and inside backticks so the Session card renders it as a clickable chip, with the plan path the user gave (or a placeholder if they gave none):

`` `/tugplug:plan-review <plan-path>` ``

Then stop. Do not read the plan, do not review it, do not offer an assessment — running the real pass is one click away, and a half-review from a stub is worse than none.

This stub exists for typed muscle memory and for the `/tugplug:review-plan …` chips still clickable in old transcripts. It is deleted in a later release.
