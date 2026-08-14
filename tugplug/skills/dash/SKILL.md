---
name: dash
description: Renamed — use /tugplug:dash-run, the same skill under the dash-lane name
argument-hint: "[name] [instruction|status|join|release]"
disable-model-invocation: true
allowed-tools: Read
disallowed-tools: Task, Write, Edit, Bash, Glob, Grep
---

## Renamed

`dash` is now `dash-run` — the same skill, under the name the dash lane's roster settled on (`dash-implement`, `dash-run`, `dash-join`, `dash-audit`). The bare name went to the lane, not to one skill in it.

Do nothing else. Print the replacement, on its own line and inside backticks so the Session card renders it as a clickable chip, with the arguments the user gave (or a placeholder if they gave none):

`` `/tugplug:dash-run <name> <instruction…>` ``

Then stop. Do not create a dash and do not carry out the instruction — the real skill is one click away, and a half-run from a stub leaves a worktree nobody asked for.

This stub exists for typed muscle memory and for the `/tugplug:dash …` chips still clickable in old transcripts. It is deleted in a later release.
