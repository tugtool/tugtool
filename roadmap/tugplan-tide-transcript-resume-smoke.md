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
