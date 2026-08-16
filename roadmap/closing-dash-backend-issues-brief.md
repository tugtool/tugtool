# Closing the dash backend: the remaining work

This is the successor to [`roadmap/join-assessment.md`](join-assessment.md). That brief's program is done — the draft contract, the clean base at creation, and base-motion replay are all landed on `main` (`0664fca77`, `9bfae24bd`), and its landing-moment fixes (the `rerere_rung` fabrication fix, the resolution review gate) shipped before them. What this brief carries is everything found *after* that program closed: the results of the 2026-08-15 investigation into the two red app-tests and the dead Join sheet, plus the follow-ons the plan and the old brief deferred. The goal is stated by the work's owner: **wrap up the backend and make it a solid, robust foundation**, because a long list of UI and design work builds on top of it and the functionality must come first.

Written to be picked up cold. State of the world at writing: `main` at `c1d77cb06`, no dashes, no debug instances, one release instance (`release-main`) live.

## What the investigation settled (2026-08-15)

### The at0405 / at0426 "failures" are environmental, not defects

Both tests — `at0405-changes-dash-lane` and `at0426-dash-resolution-review` — **pass on `main`**, as do the other three join-surface tests (`at0417`, `at0418`, `at0425`): 5/5 files green in two runs totaling 70 seconds. The red recorded during the base-motion-replay run was environmental to running the corpus **from a dash worktree**, which at0405's own docblock already cautions about. Two controlled experiments during that run (stashing the deck work; disabling autoreplay) had already eliminated the base-motion changes as the cause.

What remains is not a bug hunt but a decision: tests that only work from the main checkout should say so *mechanically*. Today the failure mode is a red run that looks like a regression and costs an afternoon of misattribution — it has now done so twice. The work item is in [the ledger below](#the-work).

### The Join sheet: what is eliminated, and what the dead click cannot be yet

The report driving this section: the Changes shade's join surface reads as **completely non-functional** in real use. The investigation could not reproduce it — no dash existed to drive — but it narrowed the field considerably:

- **Build vintage is eliminated.** The running release app was built 2026-08-15 18:46, minutes before `main`'s tip. It carries every fix in this line of work.
- **The landing machinery is eliminated.** The project dash-log shows both recent landings executed to completion: `base-motion-replay  9bfae24bd  joined` and `match-search-refs  b894a9490  joined`. Whatever surface was dead, `join_in` itself lands.
- **The test layer is eliminated.** All five join-surface app-tests are green against the same binary, driving the same lane in an apptest instance: clean joins, blocked joins, empty joins, conflicted previews, the resolve ladder, the review gate, adopt/leave round-trips.

What is *not* eliminated is the seam the old brief already named: a **correctly-refusing lane is indistinguishable from a dead one**. A disabled control's reason rides a native `title`, and `.tug-button:disabled` sets `pointer-events: none` — an element with no pointer events never hovers, so the reason is unreachable dead code on every refusing control. Disabled opacity (`--tugx-control-disabled-opacity`: 0.65 dark / 0.7 light) reads as live. A lane in a legitimate refusing state presents exactly as "every control is a dead click".

And one genuinely new fact: **the landing routes are silent in the log.** The release instance's tugcast log for the join evening carries no line for either join — no preview, no land, no receipt. Neither does it record the engine replay described below. When the sheet next misbehaves, the log will again have nothing to say. That is an observability defect in its own right, and it is why the incident from the first landing was never attributable and this one is not either.

**The protocol for the next occurrence** — the only way to close this for real is to catch it live:

1. Reproduce with a real dash and the shade open, in the release instance.
2. Enable diag/eval on the instance's bank; read `__deckTrace.dump()` (there is no `__tug` on a release build).
3. Capture the join store's snapshot (`joinSnapshot.active` / `.outcome` / `.dash`), `evaluateJoinLandGate`'s inputs and its reason, and `document.elementFromPoint` at the refused control's center — the at0425 work proved a "dead click" can be a `DIV.cm-line` stealing the point when the lane sits under the composer.
4. Distinguish the three candidate shapes: a *refusing* lane (gate says no and cannot say why — tactical-layer fix), a *stale* lane (store never received the entry — transport/store defect), a *covered* lane (hit-testing — layout defect).

Until then, the highest-leverage backend work for this symptom is the refusal-legibility half of the tactical layer, because it converts the ambiguous state into a labeled one — after which a dead click means exactly one thing.

### The engine races other instances over the same repository — found live

During the at0405 run, the dash-log recorded this against the fixture's dash, between its round commit and its release:

```
at0405-lane  replayed  onto c1d77cb06: 4d0d5eb01->5194e7a3a
```

A base-motion engine replayed an app-test's scratch dash mid-test. Every tugcast process watching this repository runs an engine — the release instance and every apptest instance — and each one treats any dash it can see as its own to keep current. The test passed anyway this time, but the hazard is structural:

- An app-test that asserts on a dash's tip SHA, round list, or worktree state can have the ground moved under it by another instance's engine.
- Two engines can race *each other* on the same dash; `cas_reset` makes the loser safe (it re-verifies HEAD before moving), but "safe" here means "one of them silently did nothing", not "coordinated".
- The engine that acted is unattributable — see the observability item; neither instance's log names it.

This needs a small design decision, not a large build. The candidate shapes: fixture dashes opt out at creation (`tugdash.autoreplay false` written by `dash-fixture.ts` — smallest, but every future fixture must remember); the engine ignores dashes whose name matches the fixture convention (couples the engine to test naming); or an instance only acts on dashes for workspaces *its own* clients have open (the principled one — the engine already keys wakes by workspace, but "my clients" is new state). The decision belongs to whoever takes the work item; the smallest correct move first is the fixture opt-out plus an engine log line, with the scoping question kept open.

### The dash-log writes the wrong year

Every dash-log line stamps **one year early** — the landings of 2026-08-16 UTC read `2025-08-16`. The defect is in `tugutil-core::session::now_iso8601` (`tugrust/crates/tugutil-core/src/session.rs`): hand-rolled civil-date math whose epoch constant disagrees with its own year-length function. `DAYS_TO_EPOCH` is `719162`, but the function it is combined with, `year_to_days`, counts from year 0 and gives 719527 days to 1970 — the constant is 365 days short, so the year resolves one low, forever. The function's callers are `session.rs`'s own session records and `dash.rs`'s `append_dash_log`, so the blast radius is the session ledger and every dash-log line ever written.

The fix is small and worth doing properly: replace the hand-rolled algorithm with one derived from a proven one (Howard Hinnant's `civil_from_days` shape), and pin it with a test against known timestamps. Existing log lines stay wrong; the log is append-only and the wrong year is at least *consistently* wrong, so no repair pass is needed — readers should just know the era before the fix is one year early.

### Tempdir tests pollute the live data directory

`~/Library/Application Support/Tug/projects/` holds **721 entries: one real project and ~720 tempdir slugs** (`-private-var-folders-…-tmpXXXXXX`). Every Rust test that exercises dash ops in a tempdir repo without redirecting `TUG_DATA_DIR` writes its dash-log through `project_state_dir` into the *live* data directory. The rule already exists ("any test writing a dash-log must redirect it and run `#[serial]`") — what does not exist is enforcement, and 720 directories is what a rule without enforcement produces.

Two items: a one-time sweep of the tempdir slugs (they are garbage by construction — their repos no longer exist), and an enforcement seam so the count stays at one. The precedent is `tugcore::ledger_db`'s `no_ad_hoc_ledger_opens` test: route the state-dir resolution through one seam and make an unredirected write from a test context refuse or scream. A cheap first version: a test-support constructor that sets `TUG_DATA_DIR` into the tempdir, plus a CI-side check that the projects dir did not grow during a test run.

### A literal NUL byte makes a join-path source file invisible to tooling

`tugdeck/src/lib/changeset-verb-store.ts` contains one raw `0x00` byte — inside `verbKey`, where the key separator was written as a literal NUL instead of the ` ` escape. Runtime-identical, but `rg` and `git diff` classify the whole file as binary, so the join verb store — 34KB of load-bearing landing code — is silently excluded from every search and renders as `Binary files differ` in review. This was found *by* it: a grep sweep of the join path reported the file as a binary match. Replace the byte with the escape; sweep the tree for other NULs in source files while there.

## The work {#the-work}

In suggested order. The first three are small, independent, and pay down the "solid and robust" goal directly; the middle two are the decisions; the last two are the deferred program.

1. **The hygiene round** — one dash, three fixes, each with a pin: the `now_iso8601` year (proven algorithm + known-timestamp test); the NUL byte in `changeset-verb-store.ts` (+ a tree sweep); the projects-dir sweep and its enforcement seam. None blocks the others; all three are the kind of quiet wrongness a foundation cannot carry.
2. **Landing observability** — the join (both routes), the release, and every engine action (`Replay` / `ReplayThenNotify` / `InjectConflict` / `MarkOnly` / `Skip` with its reason) each leave one INFO line in the acting instance's tugcast log, naming the dash, the route, and the outcome. This is the difference between the *next* dead-sheet report being a five-minute log read and being another archaeology session. Cheap, and it should come before any reproduction attempt so the reproduction has something to capture.
3. **The engine/instance race** — decide the scoping (see the candidates above), implement the smallest correct one (fixture opt-out at minimum), and add the engine's own log line from item 2. The at0405 replay line in the dash-log is the reproduction; a test pinning "the engine leaves opted-out dashes alone" closes it.
4. **App-tests refuse the wrong environment** — the harness (or the affected tests' fixtures) detects a run whose repo root is a dash worktree and refuses with a named reason instead of failing on assertions. Root-cause *which* aspect breaks at0405/at0426 from a worktree — likely `~/.local/bin` symlinks resolving `tugutil` to `main`'s binary while paths resolve to the worktree, but that is a hypothesis to confirm, not a finding — and put the answer in the refusal message.
5. **The Join sheet, caught live** — run the protocol above at the next occurrence. Do not build speculative fixes for it before then; the three candidate shapes have three different fixes and the evidence so far cannot pick one.
6. **The tactical layer** (from the old brief, unchanged, now partly motivated by item 5): scope the blanket `turnInProgress` gate (blocking `Resolve` locks a conflicted dash's only escape hatch); surface refusal reasons in the face, not in a `title` that can never render; make disabled look disabled; give a conflict its archaeology (which base commit touched this file, when). The refusal-legibility pieces graduate from polish to diagnostic prerequisites — they are what makes a refusing lane distinguishable from a dead one.
7. **The deferred lifecycle items** (from the plan's roadmap section): queue-a-landing-for-turn-end; a lane affordance to trigger `dash replay` by click for a deferred or conflicted dash with no bound session; teaching the injected conflict turn to run the plan's own checkpoints after the rebase. Real, but none blocks the UI campaign the way items 1–6 do.

The old brief's two open questions carry forward with one update: the composer's `/join <name>` route demonstrably lands (both recent joins completed through it or the CLI — the silent log cannot say which, which is item 2's point), and whether a landing should be reachable mid-turn is folded into the tactical layer's gate-scoping decision.

## Landmines, carried forward

Unchanged from the old brief, still every one paid for: `tugutil dash join <name> --resolve` **lands** — `--preview` is the only safe CLI probe. Only the user commits, and never hand over a `git reset` without re-reading `HEAD` first. A Rust change needs `just build-app` before any app-test can see it; a tugdeck change needs `bunx vite build` before it is done. The app-tests build real dashes in the live repository — leave no worktrees, `tugdash/*` branches, `tugdash.mergedriver` config, or `rr-cache` entries behind. Never point a foreign `sqlite3` at the live ledgers; `just db-inspect` copies first.

New, from this round: **the base-motion engine is live in every instance watching this repo** — any dash you create by hand is subject to replay the moment `main` moves, including scratch dashes made to probe something else. And the dash-log's timestamps are one year early until item 1 lands; do not let the `2025` era confuse an incident timeline.
