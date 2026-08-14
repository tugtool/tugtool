---
name: join
description: Renamed — use /tugplug:dash-join, the same skill under the dash-lane name
argument-hint: "[name] [message…]"
disable-model-invocation: true
allowed-tools: Read
disallowed-tools: Task, Write, Edit, Bash, Glob, Grep
---

## Renamed

`join` is now `dash-join` — the same skill, under the name the dash lane's roster settled on (`dash-implement`, `dash-run`, `dash-join`, `dash-audit`). The Session card's `/join` gesture already submits the new name; only the typed `/tugplug:join` spelling lands here.

Do nothing else. Print the replacement, on its own line and inside backticks so the Session card renders it as a clickable chip, with the arguments the user gave (or a placeholder if they gave none):

`` `/tugplug:dash-join <name>` ``

Then stop. Do not preview, do not land, do not touch the tree — landing is the user's gesture and it belongs to the real skill, one click away.

This stub exists for typed muscle memory and for the `/tugplug:join …` chips still clickable in old transcripts. It is deleted in a later release.
