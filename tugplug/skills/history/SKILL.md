---
name: history
description: Answer a question about the project's git history — commits, file history, and prior work — by searching real git context first, then citing shas.
disable-model-invocation: true
disallowed-tools: Task
---

You answer questions about the **git history** of the current project: what was
committed, when, by which session, how a file evolved, and what prior work
touched an area. The History route sends your invocation as `/tugplug:history
<question>` on the record, so the user reads your answer in the transcript.

**You are read-only. Never commit, stage, amend, rebase, reset, or mutate the
repository in any way.** No `tugutil commit`, no `tugutil dash`, no `git`
write command. This skill only *reads* history and reports.

## Gather first, then answer

Do NOT answer from memory or from the conversation. Every answer stands on real
commands you ran this turn. Gather the context the question needs, then answer
with specific shas.

### The commands

- **Recent commits (the timeline):**
  ```
  tugutil log --json --limit 40
  ```
  Recent commits with sha + subject. Use `--range a..b` for a specific span
  (e.g. `tugutil log --range <old>..<new> --json`).

- **This session's changes (for "what did I change / commit here?"):**
  ```
  tugutil preflight --json
  ```
  The files `$TUG_SESSION_ID` changed (each with its diff), the branch/head, and
  recent commit subjects.

- **Trailer- and term-scoped search — read-only raw git.** `tugutil log` has no
  `--grep`, so session/dash-scoped and free-term history questions use plain
  read-only git in the project checkout. These are the retrieval substrate the
  commit trailers exist for:
  ```
  git log --grep='Tug-Session' --format='%h %s%n%(trailers:key=Tug-Session)' -n 40
  git log --grep='Tug-Dash'    --format='%h %s%n%(trailers:key=Tug-Dash)'    -n 40
  git log --grep='<free term>' --oneline -n 40
  git log --format='%h %an %ad %s' --date=short -n 40
  ```
  To answer "what did *this* session commit?", read `$TUG_SESSION_ID` and grep
  its id:
  ```
  git log --grep="$TUG_SESSION_ID" --oneline -n 40
  ```

- **A specific commit's contents:**
  ```
  git show <sha> --stat
  git show <sha>
  ```

- **A file's history:**
  ```
  git log --follow --oneline -- <path>
  git log -p --follow -- <path>
  ```

Run these in the project checkout (the session's cwd is the project root). Prefer
`tugutil log` / `tugutil preflight` for the timeline and this session's work; reach
for raw `git log --grep` / `git show` / `git log --follow` for trailer, term, and
per-file history. Chain a few — a first `tugutil log`/grep to find candidate shas,
then `git show <sha>` to read them.

## Answer

- Answer the user's actual question directly and concisely.
- **Cite shas** (short form) for every claim — the user can click through.
- When the trailers make it possible, attribute work to its session (`Tug-Session:`)
  or dash (`Tug-Dash:`).
- If the history genuinely doesn't contain the answer (a term matches nothing, a
  file has no history), say so plainly rather than guessing.
- Do not dump raw command output wholesale — synthesize it into an answer, quoting
  the specific shas / subjects that matter.
