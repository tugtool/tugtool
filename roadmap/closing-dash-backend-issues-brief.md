# Closing the dash backend: status and what is left

**Status as of 2026-08-16.** `main` at `5ba5ce400`. The eleven-step program in [`closing-dash-backend-issues.md`](closing-dash-backend-issues.md) is **landed and joined** — all eleven ledger rows `done`. What remains from the original ledger is item 5 (the Join sheet, which can only be closed live) and item 7 (the deferred lifecycle work), plus three new findings this program's own verification turned up.

This document is written to be picked up cold, after a compaction, by someone deciding what to do next. It supersedes the pre-implementation brief; the investigation narrative that is still load-bearing is preserved below, and everything settled has been folded into [What landed](#what-landed).

The goal has not changed and is the owner's own: **wrap up the backend and make it a solid, robust foundation**, because a long list of UI and design work builds on it and the functionality has to come first.

## Where we stand {#where-we-stand}

| Original work item | State |
|---|---|
| 1. The hygiene round (timestamps, NUL byte, projects dir) | **Done**, all three, each pinned |
| 2. Landing observability | **Done** — route-attributed dash-log notes + tugcast receipts |
| 3. The engine/instance race | **Done** — per-dash opt-out, honored by the engine, set by every fixture |
| 4. App-tests refuse the wrong environment | **Done** — and the root cause is now known, not hypothesised |
| 5. The Join sheet, caught live | **Open** — still needs a live occurrence; the diagnostics it needs now exist |
| 6. The tactical layer (turn gate, refusal legibility, disabled look, archaeology) | **Done**, all four |
| 7. The deferred lifecycle items | **Open**, untouched |

## What landed {#what-landed}

Eleven rounds, squashed onto `main` as `5ba5ce400`.

**The clock.** `tugutil-core::session::now_iso8601` computed civil dates from a `DAYS_TO_EPOCH` constant that disagreed with its own `year_to_days` helper by exactly 365 days, so every dash-log line stamped a year early — epoch zero rendered `1969-01-01`. Replaced with Howard Hinnant's `civil_from_days` behind a pure `iso8601_from_unix(secs, nanos)` seam, pinned at eight known epochs including both sides of a leap day (where the old error read as a year *and a day*, not a clean year). Confirmed live: new lines stamp `2026`.

**NUL-free sources.** Four raw `0x00` bytes in tracked source, spelled as `\x00` escapes: `changeset-verb-store.ts` (the one the investigation found), plus `tug-combo-box.tsx` and `shell-line-classifier.ts` — and, found during the final sweep, the plan and the brief themselves, which described the bug and then committed it. A file with a raw NUL is binary to `grep` and `git diff`, which is how 34KB of landing code stayed invisible to search. Note that the sweep command the plan named (`rg -uu`) also walks `tugrust/target` and legitimately-binary artifacts; `git grep -laP '\x00' -- <tracked source>` is the one to use.

**The projects directory.** `append_dash_log` now refuses, in debug builds, to write dash state for a repo under the OS temp directory when `TUG_DATA_DIR` is unset. The diagnosis in the pre-implementation brief was wrong in an instructive way: the Rust suite was **not** the leaker — `tugrust/.cargo/config.toml` has force-set `TUG_DATA_DIR` since `9f772204b` (2026-08-03). 703 of the 720 stale slugs predate that fix, and the only live leaker was **at0353**, which drives `tugutil dash` verbs through the app's shell route and so inherits the *app's* environment rather than cargo's. at0353 now prefixes its shell lines with a redirect. The one-time sweep is done: **721 entries → 1**, 3.0M → 240K, and the count has held at 1 across every subsequent Rust and app-test run.

**Attributable landings.** `JoinOptions` gained an `origin`, `release` takes one, and the dash-log's terminal notes now read `joined via card` / `joined via cli` and `released  via cli`. This required widening `dash.rs::is_terminal` to a **prefix** match on the note — the review caught that an exact `note == "joined"` comparison would have silently made every future join non-terminal, so a reused dash name would inherit the prior generation's declarations. `agent_supervisor` emits a `tracing::info!` receipt for join completed/refused, ladder ran/refused, and release completed.

**The engine keeps its hands off.** `branch.tugdash/<name>.tugautoreplay=false` is checked before every other input in `decide_for_dash`, and `dash-fixture.ts` writes it the moment it creates a dash. The engine's per-decision skip logging already existed; no new call site was needed.

**The corpus refuses the wrong environment — and now we know why it had to.** The `app-test` recipe refuses before any build or launch when the invoking root is a linked worktree or HEAD is a `tugdash/*` branch, with `TUG_APPTEST_ALLOW_WORKTREE=1` as the escape. The root cause is not the `~/.local/bin` symlink hypothesis the old brief offered. It is this: **every `tugutil dash` verb resolves the *main* repo root first** (`tugdash-core::ops::main_repo_root`, via `find_repo_root_from`). So a fixture dash created from a linked worktree is created against the base checkout, while the app under test has the *worktree* open as its project — the lane can never list the dash its own fixture just made, and the selector times out. Worse, a corpus run from a worktree leaves branches, worktrees and dash-log lines in the developer's main checkout. That mechanism is written into the refusal text.

**The turn gate narrowed.** `Resolve`, `Adopt` and `Leave` work mid-turn; `Join`, `Release` and `Resume teardown` stay gated because they move the base branch or destroy the dash. `Resume teardown` was the control the old brief never named — it completes an interrupted join and is the most base-mutating act on the face.

**Refusals speak.** Every refused control states its reason as visible face text, one line per control, and every dead `title` on a disabled control is gone. `.tug-button:disabled` sets `pointer-events: none`, so a tooltip on a disabled button was never readable by anyone — that was the defect, not the fix. This closes the "a correctly-refusing lane is indistinguishable from a dead one" seam that motivated item 5.

**Disabled looks disabled.** All five filled variants drop their fill when disabled, falling back to their own role's outlined treatment (in brio: solid cobalt → `transparent`), icons included. Scoped to `tug-button.css`; no theme token moved, so the light-theme accent/danger CVD floor is untouched. `bun run audit:theme-contrast` stays within the brio budget.

**A conflict names its history.** A conflicted `--preview` now carries, per conflicted path, the base commits since the merge-base that touched it — short SHA + subject, newest first, capped at five with a `+N earlier` remainder. Computed in `tugdash-core` on the preview path only; rides `JoinOutcome` as an additive field with the same absent-when-empty shape `blockers` uses. Any git failure yields no history rather than costing the caller the conflict report.

## Verification state {#verification-state}

Everything below was run on `main` at `5ba5ce400`, after `just build-app`.

- **Rust:** `cargo nextest run` workspace-wide — 2755 passed, 6 skipped.
- **tugdeck:** `tsc --noEmit` and `vite build` clean; `bun test` 6840 passed, 0 failed. (The `layout-imposer-solutions` golden the plan expected to be red is green.)
- **Theme:** `bun run audit:theme-contrast` — no theme exceeds the brio budget.
- **App-test core tier:** 16/20 files, 30/30 tests green (4 screen-takers skipped on an unattended background run).
- **The five dash-lane files, run one at a time:** `at0405` ✅ `at0417` ✅ `at0418` ✅ `at0425` ✅ `at0426` ❌ (see below). Every new assertion from this program passes live — the archaeology names the base commit, the disabled Join carries an empty `title`, and Resolve's click registers **mid-turn** with Release simultaneously disabled, which is the turn-gate narrowing read straight off the face.
- **The projects directory held at 1 entry** across all of it.

## What is still open {#still-open}

### The Join sheet, caught live — item 5, unchanged and still the big one {#join-sheet}

The report that started this: the Changes shade's join surface reads as **completely non-functional** in real use. It was never reproduced. What is eliminated: build vintage, the landing machinery (`join_in` demonstrably lands), and the test layer (all five lane files drive the same lane against the same binary).

What changed in this program's favour: the ambiguity is gone. A refusing lane now *says* why, in the face, and a disabled control now *looks* disabled. So a dead click from here means one of exactly three things, and the diagnostics to tell them apart now exist.

**The protocol for the next occurrence:**

1. Reproduce with a real dash and the shade open, in the release instance.
2. Enable diag/eval on the instance's bank; read `__deckTrace.dump()` (there is no `__tug` on a release build).
3. Capture the join store's snapshot (`joinSnapshot.active` / `.outcome` / `.dash`), `evaluateJoinLandGate`'s inputs and its reason, and `document.elementFromPoint` at the refused control's center — the at0425 work proved a "dead click" can be a `DIV.cm-line` stealing the point when the lane sits under the composer.
4. Distinguish the three shapes: a *refusing* lane (the face now states the reason — read it), a *stale* lane (store never received the entry — transport/store defect), a *covered* lane (hit-testing — layout defect).

Do not build speculative fixes before then; the three shapes have three different fixes and the evidence still cannot pick one.

### at0426 is red, and it is fixture drift — not a regression {#at0426}

`at0426-dash-resolution-review` fails deterministically on `main`, alone, on a clean slate. **Its fixture derives the conflict file from `main`'s newest first-parent commit that modified a file**, and that is now this program's own join commit, whose first modified path is `Justfile` (2050 lines). The test's premise is a *content* conflict its stub merge driver can resolve into a known string; against `Justfile` the ladder reports "1 file resolved by driver" but the candidate carries `+0 −395` — no driver body.

This was proven by probe, not inferred: pinning `conflictFile` to a small file the same commit modified (`tugutil-core/src/session.rs`) makes at0426 **pass**, and the probe restored the file afterwards. At the previous tip the auto-picked file was `commit-block.css`; one commit earlier, `roadmap/archive/tug-slider.md`. So the test's outcome depends on whatever `main` last touched — a latent defect this program's landing merely exposed. Nothing in this program touched `resolve.rs` or the ladder.

Two things to decide: pin at0426's (and at0425's) conflict file to something deterministic rather than reading it off history, and separately find out **why** a large file makes the driver rung claim a resolution it did not produce — that second question is a real ladder defect hiding behind the first.

### The dash-lane files cannot run concurrently {#lane-concurrency}

Running all five at once gives 2/5 green; run one at a time they are 4/5 (at0426 aside). They share one repository, and `dash create` collides in ways the fixture's retry does not cover — it only retries on text matching `index.lock`. Any other transient git failure breaks out immediately, and the failure is then **invisible**: `dash-fixture.ts`'s `tugutil()` wrapper reads `out.stderr` from a `Bun.spawnSync` that never asked for a stderr pipe, so the thrown message is `… failed:` with nothing after the colon. A failed `beforeAll` also skips `afterAll`, so the run leaves `tugdash/*` branches behind that make the *next* run fail differently.

Three cheap fixes, in order of value: pipe stderr in the fixture so a failure says something; widen the retry to any transient git failure; and give the lane files a serialization marker so the harness does not run them concurrently.

### The deferred lifecycle items — item 7, untouched {#deferred}

Queue-a-landing-for-turn-end; a lane affordance to trigger `dash replay` by click for a deferred or conflicted dash with no bound session; teaching the injected conflict turn to run the plan's own checkpoints after the rebase. Real, but none of them blocks the UI campaign.

### Small things noticed, not fixed {#small-things}

- **The plan's review stamp reads `stale`.** The final round edited the plan's prose (removing the raw NUL it carried), which is outside what ledger progress may touch. The plan is finished, so the stamp costs nothing — but do not read `stale` as "unreviewed".
- **The join doubled its own subject prefix.** `5ba5ce400`'s message begins `tugdash(close-backend): tugdash(backend): …` — the landing prefixed the draft's subject, which already had a scope. Worth a look at whoever composes the squash message.
- **The live release instance predates these fixes.** Its `joined` line for this very landing stamped `2025` and recorded a bare `joined` with no route — both are the old code, still running in a process started before the fix landed. Rebuild and relaunch the release instance and both correct themselves. Nothing to fix in the tree.

## Suggested order {#next-steps}

1. **Rebuild and relaunch the release instance.** Everything below reads better against a binary that carries this program: the receipts exist, the refusals speak, the clock is right.
2. **Fix at0426's fixture** (pin the conflict file) so the lane suite is green, then open the ladder question its failure exposed — a driver rung that reports a resolution it did not produce is a correctness bug, and it is the one genuinely new defect on this list.
3. **Make the lane fixtures survive each other** — stderr, retry breadth, serialization. Three small changes that stop a real failure from arriving as a blank message.
4. **Then item 5** — the Join sheet, at the next live occurrence, with the protocol above. The instrumentation to catch it now exists; the thing to resist is fixing it before it is caught.
5. **Then item 7**, the deferred lifecycle work, when the UI campaign wants it.

## Landmines, carried forward {#landmines}

Every one of these was paid for. `tugutil dash join <name> --resolve` **lands** — `--preview` is the only safe CLI probe. Only the user commits, and never hand over a `git reset` without re-reading `HEAD` first. A Rust change needs `just build-app` before any app-test can see it; a tugdeck change needs `bunx vite build` before it is done. The app-tests build real dashes in the live repository — leave no worktrees, `tugdash/*` branches, `tugdash.mergedriver` config, or `rr-cache` entries behind, and check `git branch --list 'tugdash/*'` after a red run, because a failed `beforeAll` skips its own cleanup. Never point a foreign `sqlite3` at the live ledgers; `just db-inspect` copies first.

New from this round, and now enforced rather than remembered: **the app-test corpus does not run from a dash worktree** — the recipe refuses, because every dash verb resolves the main repo root and a fixture dash would be created in the base checkout. **The base-motion engine is live in every instance watching this repo**, so any dash you create by hand is subject to replay the moment `main` moves; fixtures opt out, hand-made probe dashes do not. And **dash-log lines written before `5ba5ce400` are one year early** — do not let the `2025` era confuse an incident timeline.
