# Routes Rework — retire the `!` layer, surface the two real routes

## Summary

The `!` bang layer (button, popup, prefix, chip completion, ⌃⌘ chords) retires entirely. What remains are the two genuine composer routes — **Prompt** and **Changes** — surfaced as a two-item TugChoiceGroup in Z4A, the design Z4A had before the `!` button (`361b29eec` pre-image), now with two tabs instead of three routes. Find lifts out of the composer into a ⌘F find bar above Z2. `!btw` and `!shell` demote to one-shot slash commands. `!history` is deleted outright.

## Decisions (locked 2026-08-03)

- **`!history`: route only.** The bang route and its ⌃⌘H chord are deleted. The History shade, ⇧⌘H, Session ▸ History, and `/tugplug:history` all stay.
- **Shell net: `/shell` one-shot slash command.** The auto-router (shell-line-classifier) is the primary path; `/shell <cmd>` remains in the `/` completion as the explicit force-to-shell escape hatch. The `!<anything>` escape hatch dies with the bang parser.
- **`/` semantics: `/changes` and `/prompt` switch tabs.** The tab names appear in the `/` completion as commands and durably switch the Z4A tab. Every other slash command (including `/btw` and `/shell`) runs one-shot and leaves the tab where it was.
- **Keyboard:** ⌘F opens the Session find bar. ⇧⌘P selects the Prompt tab. ⇧⌘C keeps selecting the Changes tab. ⌘G/⇧⌘G stay as find next/previous.

## Design

### Z4A: two-tab TugChoiceGroup

- Z4A's `!` button + TugPopupMenu (`tug-prompt-entry.tsx:3153–3197`) is replaced by a `TugChoiceGroup` with two items: **Prompt** and **Changes**. `TugChoiceGroup` is alive and shipping (`tug-choice-group.tsx`; consumers: diff document, gallery, settings).
- The group's value binds to `CommitModeController` state — commit mode already *is* the Changes tab mechanically: it swaps the editor document on enter/exit (`preCommitDraftRef` stashes the prompt draft, `tug-prompt-entry.tsx:1471–1521`) and the commit message persists durably in the changeset draft store. Selecting Changes calls `enter()`, selecting Prompt calls `exit()`. All existing enter/exit paths (⇧⌘C, Session menu, `/commit`, shade self-close, land, Cancel/Escape/⌘.) now also move the visible tab selection, because the tab renders the controller's state rather than owning its own.
- User-facing vocabulary: the two tabs are **routes** named `prompt` and `changes`. Internally `CommitModeController` keeps its name; no rename churn beyond user-visible strings.
- The Prompt tab is what today's default composer is: assistant prompts, slash commands, and auto-routed shell lines.

### The bang layer retires

Deleted outright:

- `lib/bang-commands.ts` — registry, `matchBangCommandLine`, the `!<other>` → shell escape hatch, all of it.
- The `!` button, popup menu, and `COMMAND_PICKER_ITEMS` in `tug-prompt-entry.tsx`; the `openCommandPicker` delegate surface and its ⌘/ binding (`keybinding-map.ts:253`) — ⌘/ either retires or repoints at the `/` completion (decide at implementation; no user-facing promise either way).
- The position-0 `!` completion provider registration (`use-session-card-services.ts:129–136`, `completion-providers/local-commands.ts:86–113`).
- The ⌃⌘S / ⌃⌘B / ⌃⌘G / ⌃⌘H chip-seed chords and the ⌃⌘C `!changes` alias (`keybinding-map.ts:256–262`).
- `bangCommandSurfaces` in `session-card.tsx:3619–3686` and the bang branch of the `RUN_SLASH_COMMAND` handler; the `SHOW_SLASH_COMMAND_NOTICE` redirect that teaches `/shell` → `!shell` (now backwards).
- Submit-path bang recognition in `tug-prompt-entry.tsx:2260–2270`.
- Help-content rows for the chords (`lib/help-content.ts:48,57`).

Demoted to slash commands (surfaces unchanged, front door changes):

- **`/btw <question>`** — same dispatch as today's `!btw` surface: `sideQuestionStore.ask(arg)` + open the BTW placard; bare `/btw` just opens the placard. The Z2 BTW status cell stays as-is — it is the *answer* surface, and with the `!` menu gone the two-places duplication resolves itself.
- **`/shell <command>`** — same dispatch as today's `!shell` surface: guard against an in-flight exchange, else `shellSessionStore.exec(command)`. Empty arg → usage caution.
- **`/changes`** and **`/prompt`** — new slash commands that switch the Z4A tab (enter/exit commit mode). `/commit [message]` already exists and stays (it enters with a seed message); `/changes` is the bare tab switch.

### Find: ⌘F bar above Z2

- **⌘F is already plumbed end-to-end.** Edit ▸ Find… (`AppDelegate.swift:1036`) sends the `find` control frame → `action-dispatch.ts:843` → responder-chain `FIND`. Menu enablement publishes from chain validation (`host-menu-state.ts:144`). The Session card just never registers a `FIND` responder — registering one lights up the menu item and the chord with zero Swift changes. Browser dev: add `preventDefaultOnMatch` to the existing ⌘F entry (`keybinding-map.ts:197`) so the browser's native find never fires.
- **The bar is a generalization of `TextCardFindBar`** (`cards/text-card-find-bar.tsx`), whose only text-card-specific part is its ~25-line `FindEngineDelegate`. Extract the bar to take a `FindSession` + engine delegate as props; the Text card keeps its docked mount; the Session card mounts it shade-style **above Z2** (same `TugSheet` shade presentation as Changes/History, autosized to one entry row), since the composer owns the card's bottom edge. Same interior: `TugEntryShell` + CM6 query field + `TugFindCluster` + ↑/↓ pair; Enter/⇧Enter next/prev; Escape dismisses and refocuses the composer.
- The engine side is untouched: `FindSession`, `TranscriptFindEngine`, transcript search index, CSS Custom Highlights, wrap overlay, reveal/settle — all already live in the Session card (`session-card.tsx:2363`, `session-card-transcript.tsx:2236–2470`). The bar is a new front door on the existing engine.
- ⌘G/⇧⌘G keep working exactly as today (they are already route-independent, gated only on `count > 0`).
- The `!find` route, its ⌃⌘G chord, and the "Usage: !find" caution die with the bang layer. The existing standalone `TugFindCluster` render in the composer area moves into the bar.

### Shade interaction

The find bar and the Changes/History shades both occupy the space above Z2. Rule: they are peers in the `ShadeViewController` sense — opening the find bar while a shade is up is allowed only if visually coherent; if not, ⌘F dismisses a passive shade first (implementation judgment, favor the simplest coherent behavior). Escape order follows the existing ladder: find bar first, then shade, then pane collapse.

## Milestones

**M1 — Bang retirement + slash demotions.** Delete the bang layer (list above). Add `/btw`, `/shell` slash commands reusing the existing dispatch surfaces verbatim. `!history` handler deleted; History shade and ⇧⌘H untouched. The composer's Z4A slot goes empty or keeps a disabled placeholder for one commit — M1 must not depend on M3's choice group. Update help content.

**M2 — ⌘F find bar.** Extract the shared find bar from `TextCardFindBar` (Text card behavior pixel-identical after extraction). Mount in the Session card above Z2; register the `FIND` responder; browser-dev ⌘F `preventDefaultOnMatch`; Escape ladder ordering. Verify Edit ▸ Find… validates enabled on a frontmost Session card.

**M3 — Z4A tabs + `/` accelerators.** Mount the two-item TugChoiceGroup bound to `CommitModeController`. Add ⇧⌘P (verify the chord is unclaimed in tugdeck keybindings and tugapp menus first). Add `/changes` and `/prompt` slash commands. Reconcile the delegate doc drift at `tug-prompt-entry.tsx:988–993` (stale "empty composer" gate description).

**M4 — Docs + tests.** Update tuglaws: [D97] zone table (Z4A occupant is stale twice over — it still says "route choice-group (Code/Shell/btw)"), plus a design decision recording the two-route model and the bang retirement. App-tests: update/retire bang-command tests, add coverage for the find bar (⌘F open, search, ⌘G cycle, Escape) and the tab group (click, ⇧⌘P/⇧⌘C, `/changes` switch), all with `@covers`. Sweep memory/roadmap references to `!` routes.

M1 and M2 are independent and can land in either order; M3 depends on M1 (the slot must be free); M4 trails.

## Open items

- ⇧⌘P conflict check (tugdeck `keybinding-map.ts`, tugapp menu key equivalents) before M3.
- ⌘/ disposition: retire vs repoint at `/` completion — decide in M1.
- Find bar vs shade coexistence: settle the coherent behavior during M2, record the choice in the M4 design decision.
