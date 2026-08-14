---
name: dash-run
description: Renamed — use /tugplug:dash-on, the same skill with a trimmed input grammar
argument-hint: "[name] [instruction…]"
disable-model-invocation: true
allowed-tools: Read
disallowed-tools: Task, Write, Edit, Bash, Glob, Grep
---

## Renamed

`dash-run` is now `dash-on` — you work *on* a dash, and the name says so.

Its input grammar also lost the `status`, `join`, and `release` sub-verbs: landing belongs to `/join` and `dash-join`, the readouts are `tugutil dash status|show|list`, and release is a bare CLI call the user makes. So `dash-on` takes a name and an instruction, and nothing else.

Do nothing else. Print the replacement, on its own line and inside backticks so the Session card renders it as a clickable chip, carrying whatever arguments the user gave (or a placeholder if they gave none):

`` `/tugplug:dash-on <name> <instruction>` ``

If what they typed was one of the retired sub-verbs, name its home instead of the chip — `/join <name>` for a landing, `tugutil dash status <name>` for a readout, `tugutil dash release <name>` for a discard — and stop there.

Then stop. Do not create a dash, do not do the work — the real skill is one click away.

This stub exists for typed muscle memory and for the `/tugplug:dash-run …` chips still clickable in old transcripts. It is deleted in a later release.
