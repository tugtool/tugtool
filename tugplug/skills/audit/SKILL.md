---
name: audit
description: Renamed — use /tugplug:dash-audit, the same skill under the dash-lane name
argument-hint: "[plan-path] [; Step N | Steps N-M]"
disable-model-invocation: true
allowed-tools: Read
disallowed-tools: Task, Write, Edit, Bash, Glob, Grep
---

## Renamed

`audit` is now `dash-audit` — the same skill, under the name the dash lane's roster settled on (`dash-implement`, `dash-run`, `dash-join`, `dash-audit`).

Do nothing else. Print the replacement, on its own line and inside backticks so the Session card renders it as a clickable chip, with the arguments the user gave (or a placeholder if they gave none):

`` `/tugplug:dash-audit <plan-path>` ``

Then stop. Do not read the diff and do not offer an assessment — running the real pass is one click away, and a half-audit from a stub is worse than none.

This stub exists for typed muscle memory and for the `/tugplug:audit …` chips still clickable in old transcripts. It is deleted in a later release.
