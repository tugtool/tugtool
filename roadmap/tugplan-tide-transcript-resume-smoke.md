## Tide Transcript Resume — Manual Smoke Checklist {#smoke-checklist}

Manual verification for [Step 5](./tugplan-tide-transcript-resume.md#step-5)
of `tugplan-tide-transcript-resume.md`. Each smoke exercises a
distinct transition class and hits a different code path; running
all four is the phase-close requirement for resume-from-JSONL.

For every smoke:
- Tug.app must be launched fresh (or per-step instructions)
- Use a real Anthropic-authenticated Claude on PATH
- Have a project directory under your home that contains tugplug
  (any tugtool checkout works)

---

### Pre-flight

- [ ] `tugcast` and `tugcode` binaries built and symlinked under
      `~/.local/bin` (`just install` does this).
- [ ] `tugdeck` dev server is running (`just dev` or equivalent) —
      HMR must be live for Smoke A.
- [ ] Tug.app launches and connects to the local supervisor.
- [ ] You have at least one Tide card you can populate with several
      turns. A simple seed: open Tide on this checkout, ask
      "summarize this repo in one paragraph"; let it complete; then
      ask "list the top-level directories"; let it complete.

---

### Smoke A — HMR (Vite module replacement, page stays alive)

Exercises: `tide-session-restore` may or may not fire; the existing
`CodeSessionStore` (which survives HMR) keeps `transcript`.

- [ ] Open a Tide card; submit ≥3 turns to populate `transcript`.
- [ ] In your editor, save a tugdeck source file (e.g.
      `tugdeck/src/components/tugways/cards/tide-card-transcript.tsx` —
      edit a comment to force HMR).
- [ ] Wait for Vite HMR to swap the module(s) — usually instant.
- [ ] **Verify:** the transcript repaints with all prior turns,
      bytes-identical to pre-HMR (modulo timestamp-rendering reflow).
- [ ] **Verify:** submit one new turn; it appends correctly below
      the prior turns.
- [ ] **Verify:** the "Loading conversation…" placeholder either
      doesn't appear (HMR didn't trigger restore) or appears very
      briefly (`<2s`). Either is acceptable.
- [ ] No stuck `replaying` phase; no red banner; no warnings in the
      dev-tools console beyond the usual HMR noise.

### Smoke B — Developer > Reload (page destroys, app stays alive)

Exercises: full `cardSessionBindingStore` rehydrate via tugbank →
`tide-session-restore` fires `spawn_session(mode=resume)` → tugcast
spawns tugcode in resume mode → tugcode reads JSONL → replay flows.

- [ ] Open a Tide card; submit ≥3 turns. Make sure the last turn
      has a `turn_complete(success)` (the page must not be
      mid-stream when you reload — that's Smoke D).
- [ ] In Tug.app's menu: Developer → Reload (or Cmd-R).
- [ ] **Verify:** the page tears down and rebuilds. The Tide card
      shows the "Loading conversation…" placeholder briefly.
- [ ] **Verify:** the placeholder dismisses; the transcript renders
      all prior turns in order, byte-identical to pre-reload (modulo
      timestamp-rendering reflow).
- [ ] **Verify:** submit one new turn; it appends correctly.
- [ ] **Verify:** in the tugcast log
      (`just tail-tugcast` / `~/Library/Logs/Tug/`), search
      `[tide::replay::started]` and `[tide::replay::complete]` —
      both must appear; `complete` must carry `count=N` matching
      the prior-turn count and no `error` field.

### Smoke C — Cold boot (Tug.app destroys, supervisor restarts from disk)

Exercises: tugcast supervisor reads its sqlite ledger +
`dev.tugtool.tide.session-keys` tugbank domain;
`rebind_from_tugbank` rehydrates the `LedgerEntry` with persisted
`claude_session_id`; the deck restores; the active Tide card's
binding record is read; `tide-session-restore` fires.

- [ ] Open a Tide card; submit ≥3 turns; let the last turn settle.
- [ ] Quit Tug.app entirely (Cmd-Q or via menu — not just close
      the window).
- [ ] Confirm tugcast also exits — `pgrep tugcast` should return
      no PIDs. If a stray supervisor is still up, kill it before
      proceeding (otherwise you're testing a warm-start).
- [ ] Relaunch Tug.app.
- [ ] **Verify:** the app reopens to your prior decks. The active
      Tide card shows the "Loading conversation…" placeholder
      briefly.
- [ ] **Verify:** the transcript repaints with all prior turns.
- [ ] **Verify:** submit one new turn; it appends correctly.
- [ ] **Verify:** the model name in committed code rows matches
      whatever model is currently bound (per [D09] — replay does
      not re-emit per-turn `SESSION_METADATA`, so historical model
      names don't surface; this is intentional for v1).

### Smoke D — Mid-turn reload (orphan turn synthesis [D08])

Exercises: the JSONL ends mid-turn (last `assistant.stop_reason`
is `tool_use` or `null`); the translator synthesizes a
`turn_complete(error)`; reducer commits the orphan as
`result === "interrupted"`.

- [ ] Open a Tide card; submit a turn that produces a long response
      (e.g. "give me a 500-word summary of how this repo's session
      lifecycle works, end-to-end" — anything that takes > 5s to
      stream).
- [ ] Mid-stream — while the assistant is still generating —
      Cmd-R / Developer → Reload.
- [ ] **Verify:** the page rebuilds; the transcript shows the
      partial assistant text from before the reload, marked as
      interrupted (per the existing `turn_complete(error)` UI).
- [ ] **Verify:** the orphan turn is *not* shown as in-flight —
      no spinner, no ghost user-row pair.
- [ ] **Verify:** submit one fresh turn; it appends after the
      interrupted one and flows live to completion.
- [ ] **Verify:** in the tugcast log,
      `[tide::replay::complete]` carries no `error` field
      (jsonl_malformed wouldn't fire — orphan synthesis is the
      translator's normal path; `count` includes the orphan).

---

### Reporting back

When done, leave each top-level checkbox above as `- [x]` if the
smoke passed, or `- [ ]` with a brief note describing the failure
mode (which step failed, what was on screen, what the log said).
The log lines `[tide::replay::started|progress|complete|error]`
under tugcast's `tugcode_stderr` target are the canonical
tellurium for replay-window behavior.

If any smoke fails, it blocks the [phase exit
criteria](./tugplan-tide-transcript-resume.md#exit-criteria).

---

## Appendix — Smoke C Diagnostic Capture (Step R0b) {#smoke-c-diagnostic}

Structured run for `tugplan-tide-transcript-resume.md` [Step R0b](./tugplan-tide-transcript-resume.md#step-r0b).
The goal is to observe **what tugcast actually does** during cold boot so we
can name the specific bug that breaks Smoke C, before authoring the
`request_replay` verb in [Phase A-R1](./tugplan-tide-transcript-resume.md#phase-a-r1).

### Pre-flight (one terminal, one editor)

- [ ] Build fresh + install:
      ```
      just install
      ```
- [ ] Confirm `tugbank` CLI is on PATH:
      ```
      tugbank --version
      ```
- [ ] Confirm Claude is reachable:
      ```
      claude --version
      ```

### Static inspection (before launching Tug.app)

Snapshot the existing tugbank records and on-disk JSONL layout so we have
a baseline:

- [ ] List all session-keys records:
      ```
      tugbank read dev.tugtool.tide.session-keys
      ```
      Note the count of records, how many carry `claude_session_id` non-null,
      how many carry `session_mode`. Existing records in this user's bank as of
      Step R0b authoring: 33 records, 6 with `claude_session_id` set, 6 with
      `session_mode`. If your numbers diverge wildly, write them down here.

- [ ] List existing on-disk JSONL project directories:
      ```
      ls ~/.claude/projects/ | head -20
      ```
      Note especially: does any directory match the *encoded form* of the
      `project_dir` your test will use, or does it match the *resolved
      symlink* form?

- [ ] **Path-encoding hypothesis check.** Pick a session-keys record whose
      `claude_session_id` is non-null and `project_dir` points at a path
      you reach via symlink (e.g. `/u/src/tugtool` symlinks to
      `/Users/<user>/Mounts/u/src/tugtool`). Compute both forms and check
      which exists:
      ```bash
      P="/u/src/tugtool"   # adjust to your record's project_dir
      ENCODED="$(printf '%s' "$P" | tr / -)"
      RESOLVED="$(cd "$P" && pwd -P)"
      ENCODED_RES="$(printf '%s' "$RESOLVED" | tr / -)"
      echo "encoded(symlink)  = ~/.claude/projects/$ENCODED"
      echo "encoded(resolved) = ~/.claude/projects/$ENCODED_RES"
      [ -d "$HOME/.claude/projects/$ENCODED" ] && echo "  symlink form  EXISTS" || echo "  symlink form  MISSING"
      [ -d "$HOME/.claude/projects/$ENCODED_RES" ] && echo "  resolved form EXISTS" || echo "  resolved form MISSING"
      ```
      Record the output below.

      Result:
      ```
      <paste here>
      ```

### Live capture

- [ ] Open a fresh terminal and start the replay-filtered tail:
      ```
      just tail-replay
      ```
- [ ] In another terminal, launch Tug.app cleanly:
      ```
      just app
      ```
- [ ] Open a Tide card; submit ≥3 turns; let the last one settle. Note
      its tug_session_id from the dev-tools console, or grep the tail for
      the most recent `card_id`/`tug_session_id` values.

      Recorded card_id / tug_session_id:
      ```
      card_id        = <paste>
      tug_session_id = <paste>
      project_dir    = <paste>
      ```

- [ ] Quit Tug.app entirely (Cmd-Q).
- [ ] Confirm tugcast also exited:
      ```
      pgrep tugcast || echo "(no tugcast process; ok)"
      ```

### Tugbank inspection (after Tug.app exit, before relaunch)

- [ ] Read the just-closed card's record:
      ```
      tugbank read dev.tugtool.tide.session-keys <card_id>
      ```
      Capture the JSON. Specifically:

      ```
      claude_session_id : <paste>
      session_mode      : <paste>
      project_dir       : <paste>
      tug_session_id    : <paste>
      ```

- [ ] **Candidate 1 (claude_session_id persistence) check.** Did the record
      carry a non-null `claude_session_id`? **Yes / No:** _____
- [ ] **Candidate 2 (session_mode persistence) check.** Did the record
      carry `session_mode: "resume"` (or "new")? **Yes / No / MISSING:** _____

### On-disk JSONL inspection

- [ ] Compute the JSONL path the *current code* would resolve from the
      record's `project_dir`:
      ```bash
      P="<paste project_dir from record>"
      ENCODED="$(printf '%s' "$P" | tr / -)"
      CLAUDE_ID="<paste claude_session_id from record>"
      ls -la "$HOME/.claude/projects/$ENCODED/$CLAUDE_ID.jsonl" 2>&1
      ```
      Result:
      ```
      <paste here>
      ```

- [ ] Check the resolved-symlink encoding (if `project_dir` is a symlinked
      path):
      ```bash
      RESOLVED="$(cd "$P" && pwd -P)"
      ENCODED_RES="$(printf '%s' "$RESOLVED" | tr / -)"
      ls -la "$HOME/.claude/projects/$ENCODED_RES/$CLAUDE_ID.jsonl" 2>&1
      ```
      Result:
      ```
      <paste here>
      ```

- [ ] **Candidate 3 (JSONL path encoding mismatch) check.** Does the JSONL
      live under the symlink-encoded path, the resolved-encoded path, or
      both? Or neither? Circle one:
      `symlink-encoded` / `resolved-encoded` / `both` / `neither`

### Cold-boot relaunch and live tail

- [ ] Relaunch Tug.app:
      ```
      just app
      ```
- [ ] Watch `just tail-replay` for the resume sequence. Capture the lines
      in order. The first three should always appear; the rest depend on
      the bug:

      ```
      [rebind.entry]                     <paste line>
      [spawn.effective_mode]             <paste>
      [supervisor.eager_spawn]           <paste>
      [session_init.parse]               <paste>
      [tide::replay::started]            <paste>
      [tide::replay::progress] (any?)    <paste>
      [tide::replay::complete]           <paste>
      [tide::replay::error] (if any)     <paste>
      ```

- [ ] **Candidate 4 (timing race) check.** Did `[tide::replay::started]`
      land before tugdeck's WS established? Compare the timestamps:
      tugdeck's WS connect log line vs. the replay-started line. **Race
      observed?** Yes / No: _____

- [ ] **Candidate 5 (reducer filter mismatch) check.** Did the
      `replay_complete` line carry the same `tug_session_id` as the
      card's binding? Cross-reference with the `card_id` / `tug_session_id`
      captured above. **Filter mismatch?** Yes / No: _____

### UI observation

- [ ] What does the Tide card show after relaunch? Circle one or more:
      `empty transcript` / `loading conversation… (stuck)` /
      `loading conversation… briefly, then empty` / `transcript repaints
      with all turns` / `picker shown (binding lost)` / `error banner` /
      `other` (describe): __________

- [ ] Was the new turn submittable afterward? **Yes / No:** _____

### Findings

Based on the captures above, the broken-smoke-C root cause(s) are:

- [ ] **Candidate 1** confirmed (claude_session_id null in the record):
      Reason: __________
- [ ] **Candidate 2** confirmed (session_mode missing or "new"):
      Reason: __________
- [ ] **Candidate 3** confirmed (JSONL path encoding mismatch):
      Reason: __________
- [ ] **Candidate 4** confirmed (timing race):
      Reason: __________
- [ ] **Candidate 5** confirmed (reducer filter mismatch):
      Reason: __________
- [ ] **Other / unanticipated:** describe: __________

### Confirmed findings (Step R0b run)

**Candidate 3 — JSONL path encoding mismatch — confirmed.**

Cold-boot smoke run captured 2026-05-04. Card `7b4599cc-…` /
tug_session_id `c563ebb5-…` populated with a fresh session, then
Tug.app cold-booted.

Tugbank record (post-quit, pre-relaunch):

```json
{
  "claude_session_id": "c563ebb5-f9f7-4807-8a1e-5e9e35faae50",
  "project_dir": "/u/src/tugtool",
  "session_mode": "new",
  "tug_session_id": "c563ebb5-f9f7-4807-8a1e-5e9e35faae50"
}
```

JSONL path resolution:

```
symlink form  = ~/.claude/projects/-u-src-tugtool/c563ebb5-…jsonl                  → MISSING
resolved form = ~/.claude/projects/-Users-kocienda-Mounts-u-src-tugtool/c563ebb5-…jsonl → EXISTS (15943 bytes)
```

Cold-boot log:

```
[rebind.entry]              card_id=7b4599cc-…  rebound_mode="new"  mode_source="persisted"
                            claude_session_id="c563ebb5-…"
[spawn.supervisor_recv]     session_mode="resume"
[spawn.effective_mode]      effective_mode="resume"  inserted=false  mode_mismatch=false
[supervisor.eager_spawn]    →
[bridge.tugcode_spawn]      args=["--dir", "/u/src/tugtool", "--session-mode", "resume",
                                  "--resume-session", "c563ebb5-…"]
[session_init.parse]        claude_session_id="c563ebb5-…"
[session_init.persist]      → tugbank record updated
[ledger.record_spawn]       workspace_key="/Users/kocienda/Mounts/u/src/tugtool"
                            project_dir="/u/src/tugtool"     ← supervisor knows the canonical form
[tide::replay::started]     jsonl_path=/Users/kocienda/.claude/projects/-u-src-tugtool/c563ebb5-…jsonl
                                       ────────────────  ↑ tugcode used the SYMLINK encoding
[tide::replay::complete]    count=0  elapsed_ms=1   ← `jsonl_missing` (file at symlink form not on disk)
```

**Note also:** the `[rebind.entry]` line for record `e0ccd472-…` shows
`rebound_mode="resume" claude_session_id=""` — a pre-fix legacy
record where session_mode was persisted as "resume" but claude_id was
not. That's a pre-Step-0 artifact, distinct from Candidate 3, but
worth a future cleanup pass on stale records.

**Other candidates ruled out for this run:**

- **Candidate 1** (claude_session_id persistence): NOT the bug here.
  The record carried `claude_session_id="c563ebb5-…"`. Step 0's
  persistence works for fresh records.
- **Candidate 2** (session_mode persistence): NOT the bug here.
  The record carried `session_mode="new"` (the user's last spawn was
  fresh-mode). The supervisor's defense-in-depth path correctly
  upgraded the rebound entry to `effective_mode="resume"` per the
  client's request.
- **Candidate 4** (timing race): NOT the bug here. The replay sequence
  fires inline with `session_init` — no observed race against WS
  drain.
- **Candidate 5** (reducer filter mismatch): NOT exercised — `replay`
  bracket events did reach tugdeck's reducer (the placeholder dismisses
  cleanly), they just carry an empty count because no JSONL was
  found upstream.

### Resolution (one-line fix landed in this step)

`tugcode/src/session.ts` `SessionManager.runReplay()` now resolves
symlinks via `fs/promises.realpath` on `this.projectDir` before
passing to `jsonlPathFor`. Claude itself canonicalizes its `cwd`
when computing where to write the JSONL, so the encoding rule has
to match. Falling back to the raw path on `realpath` failure is
safe — downstream `jsonlReader` reports `missing` exactly as
before, and tests that point at synthetic non-existent paths
continue to work.

Two regression tests added in
`tugcode/src/__tests__/replay-spawn.test.ts`:

- A symlinked tmp project dir → `jsonlReader` is invoked with the
  resolved-encoded path, not the symlink-encoded path.
- A non-existent path → fallback path is the raw-encoded form
  (no behavior change for the existing test fixtures).

Verification: re-run cold-boot Smoke C after this fix and confirm:

- [ ] `[tide::replay::path_canonicalized]` log line fires with
      `raw=/u/src/tugtool` and
      `canonical=/Users/<user>/Mounts/u/src/tugtool`.
- [ ] `[tide::replay::started]` `jsonl_path` ends in
      `-Users-<user>-Mounts-u-src-tugtool/<claude_id>.jsonl`.
- [ ] `[tide::replay::complete]` `count` matches the prior turn count
      (not 0); no `error` field.
- [ ] Tide card transcript repaints with all prior turns.
