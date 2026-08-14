# Dash Work Doctrine

*How an agent works on a dash worktree. The rules below hold for every dash — a quick plan-less task, a planned run walking a ledger, an audit that only reads. They are cited, not copied: a working skill states its own flow and points here for the discipline, so the discipline has exactly one home.*

This document covers **how the work is done**. The dash's state model — what `created`, `working`, `implementing`, `built`, `audited`, `draft-ready`, and `landing` mean and how each is derived or declared — is a separate subject.

## The one and only working root

A dash *is* a git branch (`tugdash/<name>`) plus a worktree. `tugutil dash create <name> --json` returns that worktree's absolute path. **Capture it.** From that moment it is the only working root:

- Address **every** read, write, edit, and test by absolute path into the worktree. A shell's cwd silently reverts to the base checkout between tool calls; a relative path is a coin flip.
- **Never write to the base checkout.** Not code, not a plan, not a ledger, not a scratch file. The base branch is the user's; the only path back is their landing gesture.
- A stray write to the base root also *blocks* the landing — the join preflight requires the base clean where it intersects the dash's files.
- If the document a run is driving lives on the base branch, work on its **worktree copy**. Read the original by path once if you must; edit only the copy.

There is no canonical directory for anything. `roadmap/`, `.tugtool/`, and every other home are derived from what you were handed, never assumed.

## Verify before every commit

**Warnings are errors.** The Rust workspace enforces `-D warnings`; treat a type error, a lint finding, or a failing test the same way.

The bar before a round is committed:

- `bunx tsc --noEmit` for TypeScript that moved.
- Pure-logic tests for the scope that moved (`bun test <scope>`).
- `cargo nextest run` for Rust — the affected crates while iterating, the workspace before the run ends.
- A real-app test where the change is one only the real app can show.

**Never commit red.** If a check fails, fix it and re-run; a round that lands broken makes every later round's verdict meaningless.

**Fix what you touch.** A pre-existing warning, type error, or dead branch in a file you are editing is yours to fix, not to report. Punting it as "pre-existing" leaves the next reader the same trap.

## Test discipline

The kind of test must match the layer, and two kinds are banned outright.

- **Real-app / browser-behavior tests** — focus, selection, event ordering, caret, portal timing, gestures — live in `tests/app-test/` and run through **`just app-test <file>`**. Never hand-roll the equivalent `TUGAPP_IN_APP_TEST=1 TUGAPP_DEBUG_PATH=… bun test …` pipeline: the recipe does the app-path query, the re-sign, the dist refresh, and the pkill, and prints a finished report ending in a `VERDICT:` line. Never pipe that output into a filter — the pipeline's exit status becomes the filter's, so a green run reads as a silent failure.
- **Pure-logic tests** — stores, protocol, math, validators, layout trees — are plain `bun:test` files with no DOM globals.
- **Banned, do not write and do not re-add:**
  - **Fake-DOM / RTL tests.** No `happy-dom`, no `jsdom` render tests, no `@testing-library/react`. There is no in-process DOM substrate. A test that needs `document`/`window` to express itself is either a pure function over data or an app-test.
  - **Mock-store assertion tests.** Never hand-roll a core interface to count mock method calls, and do not write per-mutator "pin" tests even against the real engine. `tsc --noEmit` already catches interface drift. Write an integration test in response to a real bug, at the real layer.
- If a banned shape looks genuinely worth it, **ask first**.

## Law discipline

Before writing or materially changing code under `tugdeck/src/components/tugways/` or `tugdeck/src/components/chrome/` — hooks, components, CardHost plumbing, portal and registry wiring — read [`tuglaws.md`](tuglaws.md), [`pane-model.md`](pane-model.md), and [`component-authoring.md`](component-authoring.md), and **name the laws the change touches in the round's commit body** (e.g. "upholds [L02] via `useSyncExternalStore`; [L22] via direct store observation").

Preservation-by-mimicry is not an audit: copying the shape of neighbouring code proves nothing about which invariant it was upholding. Naming the law is the proof.

Not required for Rust, Swift, plugin, or pure documentation changes.

## Rounds

A round is one commit plus one line in the per-project dash-log, made by one command:

```bash
tugutil dash commit <name> --message "<conventional commit>" --json <<'EOF'
{"instruction":"<what was asked>","summary":"<what landed + how verified>"}
EOF
```

Git records the diff; the log records the instruction git cannot see. `tug log` on the dash branch reads the rounds back.

**Never commit to the base branch.** Every commit goes through `tugutil dash commit` onto the dash worktree.

## Stop before the landing

The build is the user's to vet. Bring up the debug instance from the worktree (`just app-debug`), report it, and stop — do not merge, and do not run the landing on the user's behalf.

Before stopping, leave the **join draft** behind: compose the squash message from what the rounds actually did and write it with `tugutil draft set --owner dash:<name> --message "…"`. The landing gesture lands that message; it does not compose one. A dash that arrives at the landing draftless stops there, which is a stall you caused one step earlier.

## What never gets asked

A skill in this lane may raise a dialog at a real decision point — an unsettleable design question, a judgment call with no technically correct answer, a stale plan, a refused ledger edit, a disposition the user owns. That licence is narrow, and it comes with a boundary, because a run that asks about everything is worse than one that asks about nothing: it trains the user to click through the dialog that mattered.

- Never ask to commit a round.
- Never ask before running a checkpoint.
- Never ask permission to write the join draft.
- Never ask "should I continue?" between ordinary steps.
- Never ask anything with a conventional default.

Join's other stops — a conflict, a missing draft, a named blocker — stay stops. They are correct refusals with one right answer, not unasked questions.

## No plan numbers in durable artifacts

Never write step identifiers — "Step 4.5", "4i", "roadmap step X" — into code, comments, docstrings, test names, or commit messages. Describe the behavior or the reason directly.

A plan document carries step numbers because it *is* the bookkeeping; so does the dash-log's `instruction` field, for the same reason. Nothing that outlives the run does.

## No sub-agents

The worker is the main conversation. Do the work in-thread. The whole point of the agentless model is that the user stays in a tight feedback loop with one thread that holds the context, rather than reviewing the output of a swarm that does not.
