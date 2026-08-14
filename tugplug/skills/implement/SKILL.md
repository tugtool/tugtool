---
name: implement
description: Renamed — use /tugplug:dash-implement, the same skill under the dash-lane name
argument-hint: "[plan-path] [Step N | Steps N-M]"
disable-model-invocation: true
allowed-tools: Read
disallowed-tools: Task, Write, Edit, Bash, Glob, Grep
---

## Renamed

`implement` is now `dash-implement` — the same skill, under the name the dash lane's roster settled on (`dash-implement`, `dash-run`, `dash-join`, `dash-audit`).

Do nothing else. Print the replacement, on its own line and inside backticks so the Session card renders it as a clickable chip, with the arguments the user gave (or a placeholder if they gave none):

`` `/tugplug:dash-implement <plan-path> [Step N | Steps N-M]` ``

Then stop. Do not read the plan, do not create a dash, do not start walking steps — the real skill is one click away, and a half-run from a stub leaves a worktree nobody asked for.

This stub exists for typed muscle memory and for the `/tugplug:implement …` chips still clickable in old transcripts. It is deleted in a later release.
