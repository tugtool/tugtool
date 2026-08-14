---
name: devise
description: Renamed — use /tugplug:plan-devise, the same skill under the plan-* namespace
argument-hint: "[idea] [→ output-path]"
disable-model-invocation: true
allowed-tools: Read
disallowed-tools: Task, Write, Edit, Bash, Glob, Grep
---

## Renamed

`devise` is now `plan-devise`. Nothing about the skill changed — the plan lane's skills share a `plan-*` prefix so the roster reads as a lane rather than a pile.

Do nothing else. Print the replacement, on its own line and inside backticks so the Session card renders it as a clickable chip, carrying whatever arguments the user gave (or a placeholder if they gave none):

`` `/tugplug:plan-devise <idea>` ``

Then stop. Do not investigate, do not design, do not write a plan — the real skill is one click away, and a half-plan from a stub is worse than none.

This stub exists for typed muscle memory and for the `/tugplug:devise …` chips still clickable in old transcripts. It is deleted in a later release.
