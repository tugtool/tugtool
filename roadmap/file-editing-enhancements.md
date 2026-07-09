<!-- devise-skeleton v4 -->

## File Editing Enhancements — Manual Save Mode {#file-editing-enhancements}

**Purpose:** Give the File card a classic manual save mode — dirty bit, Save / Save As… / Save a Copy… / Revert to Saved / Reload from Disk, a close-with-unsaved-changes gate, and a native File menu that drives it all — while preserving the safety of the current live-autosave model through a set-aside autosave of unsaved changes. Manual becomes the default; automatic mode is retained (unexposed) for a planned future feature.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-07-09 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The File card currently uses a saveless live-autosave model: every edit is written through to disk after a 1-second idle debounce (`FileEditorStore`, `tugdeck/src/lib/file-editor-store.ts`). This is great for some workflows but wrong for others — the user often wants the classic document contract: edits stay in the buffer until an explicit ⌘S, with the full range of classic save verbs and a save-before-close check. macOS's post-Lion Duplicate/Move/Rename verbs are explicitly rejected; this plan implements the pre-Lion conventions.

The design keeps the one genuinely good piece of modern NSDocument machinery: **autosave-elsewhere**. With `autosavesInPlace == false`, NSDocument periodically writes unsaved changes to a side location (`~/Library/Autosave Information`, exposed as `autosavedContentsFileURL`) without touching the real file, so a crash or quit never loses work. We replicate that with a per-document "aside" record under the Tug data directory. External-change handling follows `NSFilePresenter` semantics (`presentedItemDidChange` → reload/conflict, `presentedItemDidMove(to:)` → follow the rename, `accommodatePresentedItemDeletion` → missing-file flow) without using the AppKit classes — detection rides the existing tugcast FILESYSTEM feed plus hash-conditional writes.

#### Strategy {#strategy}

- Extend `FileEditorStore` with a `saveMode` rather than forking it: manual mode reinterprets the existing `clean | editing | writing` machine ("editing" = dirty) and repoints the existing debounce engine at the aside instead of the real file. The hash-conditional write, `_editedDuringWrite` re-flush, and keepalive final-flush machinery all carry over.
- Build bottom-up with a commit per step: Rust write-root change → aside helpers → store core → save verbs + reconciliation → close guard → card UI/sheets → menu plumbing (web) → File menu (Swift) → rename-follow → flip the default + app-tests.
- Reconciliation policy: **never auto-merge**. Clean buffer + external change → silent auto-reload (already implemented). Dirty buffer + external change → modal conflict sheet, presented immediately when the watcher fires (user decision), with Save Anyway / Reload from Disk / Save As… / Cancel.
- Menu enablement reuses the existing `menuState` projection (`tugdeck/src/lib/host-menu-state.ts` → `AppDelegate.validateMenuItem`); a new `file` block rides the payload exactly like the existing dev block.
- Quit never prompts (user decision): the aside is keepalive-flushed on teardown and silently restored (dirty) on reopen. Only explicit card close prompts, because the card — the restore vehicle — is being destroyed.

#### Success Criteria (Measurable) {#success-criteria}

- Typing in a manual-mode File card does NOT modify the file on disk (verify: `stat`/hash unchanged after edits + debounce window); ⌘S / File ▸ Save writes it (app-test at0211).
- Killing the app with a dirty manual buffer and relaunching restores the unsaved content with the dirty bit set (aside restore; app-test).
- Closing a dirty card presents Don't Save / Cancel / Save; each button does what it says (app-test).
- Editing the file on disk while a manual card is dirty presents the conflict sheet within the watcher debounce window; all four resolutions behave per **Table T01** (app-test for the Save Anyway and Reload paths).
- Renaming the open file on disk (within the session workspace) rebinds the card — path, title, tab — without a prompt (app-test or unit test at the store layer with synthetic frames).
- File menu items enable/disable per **Spec S02** gates (manual verification + `menu-state` unit tests).
- Automatic mode still passes its existing coverage (at0209 seeded to automatic; `bun test src` store tests green).
- Full verification green: `bunx tsc --noEmit`, `bun test src`, `bunx vite build`, `cd tugrust && cargo nextest run`, `just app-test at0209 at0210 at0211`.

#### Scope {#scope}

1. `saveMode: "manual" | "automatic"` in `FileEditorStore`; manual default via an unexposed deck default.
2. Set-aside autosave of unsaved changes (aside records) + restore on open/resume.
3. Save verbs: Save, Save As…, Save a Copy…, Revert to Saved, Reload from Disk; New Text File (untitled manual buffer).
4. Close gate with classic Save / Don't Save / Cancel sheet.
5. External-change reconciliation (modified / deleted / renamed), both modes where applicable.
6. Native File menu items with menuState-driven enablement (Swift).

#### Non-goals (Explicitly out of scope) {#non-goals}

- Any automatic three-way merging of concurrent edits ([P04]).
- Exposing save-mode in the Settings UI (the deck default exists but is deliberately unexposed).
- Lion-style Duplicate / Rename / Move To… verbs in manual mode (Move To… survives only as automatic mode's top-bar affordance).
- A background sweep/GC daemon for orphaned aside files (see [Q01], deferred).
- Watching files outside the session workspace root with a new file-watching mechanism (the focus-time recheck fallback covers them; see [#watch-coverage]).
- NSDocument/NSFilePresenter adoption in Swift — the host stays document-model-free; all logic lives in the web/Rust layers.

#### Dependencies / Prerequisites {#dependencies}

- Existing `FileEditorStore` machinery (hash-conditional writes, FILESYSTEM feed subscription, `_editedDuringWrite`) — landed as of commit `37f007edd`.
- tugcast fs endpoints `/api/fs/read`, `/api/fs/write` (`tugrust/crates/tugcast/src/fs_read.rs`, `fs_write.rs`).
- `menuState` WKScriptMessage pipeline (`tugdeck/src/lib/host-menu-state.ts` ↔ `tugapp/Sources/AppDelegate.swift`).
- `choosePath(kind: "save")` NSSavePanel bridge (`tugdeck/src/lib/native-path-picker.ts` ↔ `AppDelegate.bridgeChoosePath`).

#### Constraints {#constraints}

- **Warnings are errors** across the Rust workspace (`-D warnings`).
- Tuglaws apply to all tugdeck work — notably [L02] (external state via `useSyncExternalStore` only), [L11] (controls emit actions; responders own state), [L23] (save-on-close handoff before card destruction), [L27] (every acquisition returns its release).
- No localStorage/sessionStorage/IndexedDB; the save-mode default persists via tugbank `/api/defaults/`.
- `bunx vite build` must pass before any tugdeck step is declared done (dev esbuild passes where rollup fails).
- Never hand-roll UI that exists as a Tug\* component — sheets use `TugSheet` / `presentAlertSheet`.
- HMR must never reload data or transcript state; store instances and asides must be inert to HMR.

#### Assumptions {#assumptions}

- Only a pane's **active** card body is mounted; background tabs live as bags (deck state preservation). Consequence: at most one close guard per pane is live, and closing a background tab cannot prompt — its aside on disk is the safety net (see [P06]).
- WKWebView + AppKit menu behavior: a menu item whose key equivalent matches validates via `validateMenuItem(_:)`; a matching-but-disabled item eats the chord with a beep and does NOT fall through to the web view (documented in `host-menu-state.ts`'s edit-block docstring). This drives [P07].
- The FILESYSTEM feed (FeedId `0x10`) covers only paths under the session workspace root(s); File cards may hold paths outside any workspace (see [#watch-coverage]).

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows `tuglaws/devise-skeleton.md` v4: explicit `{#anchor}` headings, `[P##]` plan-local decisions, `[Q##]` open questions, `S##` specs, `T##` tables, `L##` lists, `R##` risks, `**Depends on:**`/`**References:**` lines on every step, no line-number citations.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Orphaned aside GC policy (DEFERRED) {#q01-aside-gc}

**Question:** Asides whose document is never reopened (crash, then the file is deleted externally; or Option-click force-close of a card whose file is later removed) accumulate in the aside directory. When are they collected?

**Why it matters:** Unbounded growth of small JSON files in Application Support; also stale asides could restore edits the user forgot about months later.

**Options (if known):**
- Opportunistic: on every successful open of path P, any aside for P is either consumed or (if invalid/stale) deleted — this is implemented in this plan and bounds per-document staleness.
- A startup sweep deleting asides older than N days — not implemented.

**Plan to resolve:** Ship with opportunistic consumption only; revisit if the directory grows in practice.

**Resolution:** DEFERRED — orphan volume is expected to be tiny (one JSON per crashed dirty document); macOS's own Autosave Information has the same shape. Opportunistic cleanup on open is part of Step 3.

#### [Q02] App-quit prompting (DECIDED — see [P06]) {#q02-quit-prompt}

**Question:** Should quitting with dirty buffers prompt per document (classic pre-Lion) or quit freely relying on the aside?

**Resolution:** DECIDED by the user: quit freely; the aside keepalive-flush preserves edits and they restore dirty on relaunch. Recorded in [P06].

#### [Q03] Conflict timing and clean-reload visibility (DECIDED — see [P04]) {#q03-conflict-timing}

**Question:** Present the dirty-file conflict sheet immediately when the watcher fires, or defer to save time? Announce silent clean-buffer reloads?

**Resolution:** DECIDED by the user: interrupt immediately on the watcher event; clean-buffer auto-reload stays fully silent. Recorded in [P04].

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| FSEvents rename pairing unreliable | med | med | Hash-match heuristic with strict fallback to the missing-file flow (never guess wrong silently) | Rename-follow app-test flakes |
| Menu key equivalents eating web chords | med | low | Dynamic key equivalent for ⇧⌘S ([P07]); no new web keybindings | Any beep on a previously-working chord |
| Aside write races / duplicate cards on same path | med | low | Aside writes are hash-chained conditional writes ([P08]); `openFileInCard` already reuses path-bound cards | Two cards deliberately opened on one path |
| at0209 (live autosave) breaks when default flips | low | high | Step 10 seeds the automatic deck default in that test before any card opens | — |

**Risk R01: FSEvents rename ambiguity** {#r01-rename-ambiguity}

- **Risk:** On macOS, `notify` reports renames as `RenameMode::Any` per-path; the watcher probes existence and emits `Removed{old}` + `Created{new}` — the pair is only correlated by arriving in one debounce batch. A batch with multiple creations, or a rename racing a content change, can defeat pairing.
- **Mitigation:** Adopt a candidate only when its disk sha256 equals our `_baselineSha256` (the buffer's unsaved edits never touch disk, so the moved file's bytes still hash to the baseline); prefer a same-basename candidate; if zero or >1 candidates match, fall back to the missing-file flow — a prompt, never a wrong rebind.
- **Residual risk:** A rename performed *together with* a content change (e.g. `git checkout` swapping branches) won't pair — it lands in the missing-file flow, which is safe and correct.

**Risk R02: Close-gate coverage gaps** {#r02-close-gate-gaps}

- **Risk:** Close paths are plural (X button, ⌘W, ⌥⌘W close-all, pane close, Option-click bypass); missing one lets a dirty card die without its prompt. **The "single funnel" is a partial truth**: a plain X-click on a card whose pane does NOT set `confirmClose` (the File card's case today) short-circuits inside `CardTitleBar` — both `handleClosePointerUp` and the keyboard-activation `handleCloseClick` call `onClose?.()` **directly** when `!confirmClose`, never touching `requestClose`. So hooking only `requestClose`/`requestCloseWith` would leave the most common gesture (clicking the X) bypassing the guard.
- **Mitigation:** The guard consultation must live in **all four** `CardTitleBar` close sites — `handleClosePointerUp`, `handleCloseClick`, `requestClose`, `requestCloseWith` — not just the two imperative-handle ones. They all live inside one component, so it is still a single shared helper (`consultGuardThen(proceed)`), but the plan names every site. Option-click bypass is *deliberately preserved* ([P06]): the aside survives it, so nothing is lost. Note the X path closes the **entire pane** (`handleTitleBarClose` → `onClose`), so the guard gates a pane close; that is correct because the dirty card is the pane's active/mounted card and background tabs' asides are already flushed.
- **Residual risk:** Background tabs close without prompting (their bodies are unmounted, no live guard) — by design; their asides persist and restore on reopen.

---

### Design Decisions {#design-decisions}

#### [P01] Two save modes on one store; manual is the default via an unexposed deck default (DECIDED) {#p01-save-modes}

**Decision:** `FileEditorStore` gains `saveMode: "manual" | "automatic"`, fixed at open time. The File card resolves the mode from tugbank deck default `dev.tugtool.file-editor` key `save-mode` (values `"manual"` | `"automatic"`, missing → `"manual"`), read from the tugbank client cache the same way `readOpenTarget` does in `tugdeck/src/lib/open-file-in-card.ts`. No settings UI exposes it.

**Rationale:**
- Automatic mode is required intact for a planned future feature; a mode flag on the proven store beats a fork.
- A tugbank default (not a constructor-only flag) gives app-tests and the future feature a real seam without UI (`app.seedDeckState` / tugbank PUT can set it).

**Implications:**
- `FileEditorSnapshot` gains `saveMode`; all state transitions branch on it exactly where the write target differs.
- Existing automatic-mode tests keep passing unchanged at the store level (mode defaults to `"automatic"` in the store constructor when unspecified; the *card* passes the resolved default — so the flip is card-level, Step 10).

#### [P02] Classic save verbs only (DECIDED) {#p02-classic-verbs}

**Decision:** Manual mode ships Save (⌘S), Save As… (⇧⌘S, dynamic — see [P07]), Save a Copy… (⌥⇧⌘S), Revert to Saved, Reload from Disk, New Text File (⌥⌘N), and a dirty-checked Close. No Duplicate, no Rename, no Move To… in manual mode; the top bar's Move To… button becomes Save As… when the card is manual.

**Rationale:** Explicit user requirement — pre-Lion conventions, verbatim.

**Implications:** `FileCardTopBar` (`tugdeck/src/components/tugways/cards/file-card-top-bar.tsx`) needs the mode to pick its button label/handler; the underlying flow (`pickPath("save") → store.saveAs`) is shared.

#### [P03] Set-aside autosave: one JSON record per dirty document (DECIDED) {#p03-aside}

**Decision:** Unsaved manual-mode changes autosave (existing 1 s debounce) to a single JSON file per document under `~/Library/Application Support/Tug/Autosave Information/` per **Spec S01**. The aside is deleted on: successful Save/Save As, Revert to Saved, Reload-from-disk-discarding-edits, conflict "Reload from Disk", open-time "Use Disk Version", and close-time "Don't Save". It is *kept* on Option-click force-close and on quit — those are the restore cases.

**Rationale:**
- Mirrors NSDocument autosave-elsewhere (`autosavesInPlace == false` → Autosave Information), the "automatic virtue" the user wants preserved.
- One JSON file per document = one atomic `fs_write` per flush; no content/metadata tear.
- Named "Autosave Information" as deliberate homage; kept separate from `Drafts/` (which remains automatic-mode's untitled-file home).

**Implications:**
- `fs_write.rs` must create parent directories under this root the way it already does for `drafts_root()` (Step 1).
- Reverting deletes the aside — a revert is an explicit discard, exactly as NSDocument removes autosaved contents on revert. No "recoverable revert" cleverness.

#### [P04] Reconciliation: never merge; silent clean reload; immediate conflict sheet when dirty (DECIDED) {#p04-reconciliation}

**Decision:** No automatic merging under any circumstance. Clean buffer + external modification → silent in-place reload (existing `_recheckDisk` behavior, kept fully silent per user decision). Dirty buffer + external modification → the modal conflict sheet (**Spec S03**) presented immediately when the watcher event arrives, and equally when a ⌘S lands a `conflict` outcome. Full matrix in **Table T01**.

**Rationale:**
- Silent merges corrupt files; a text editor must never write bytes the user hasn't seen.
- Immediate interruption (user decision, [Q03]): the user should learn about the divergence before typing for ten more minutes, not at save time.

**Implications:** `_onFilesystemFrame` in `file-editor-store.ts` — which today *ignores* events while `saveState === "editing"` — must, in manual mode, re-read disk and raise `conflict` when the disk hash diverges from `_baselineSha256`. Automatic mode keeps its current behavior (the conditional write adjudicates).

#### [P05] Rename-follow (both modes): trust `Renamed{from,to}`; otherwise hash-match the probe pair (DECIDED) {#p05-rename-follow}

**Decision:** When a FILESYSTEM batch shows our file renamed, follow it: rebind `path`/`fileName`, re-key the aside, update titles — no prompt (this is `presentedItemDidMoveToURL` behavior). Adoption rules: (a) a `Renamed { from, to }` event whose resolved `from` equals our path → adopt `to` directly; (b) a `Removed` for our path *plus* `Created` event(s) in the same batch → read candidates (same-basename candidate first; else only if the batch has exactly one `Created`) and adopt iff the candidate's `sha256 === _baselineSha256`; (c) otherwise → the missing-file flow. Applies to automatic mode too (today a rename strands it in a missing-conflict).

**Rationale:**
- `FsEvent::Renamed { from, to }` already exists in `tugrust/crates/tugcast-core/src/types.rs`, but macOS FSEvents delivers `RenameMode::Any`, which `convert_event` (`tugrust/crates/tugcast/src/feeds/file_watcher.rs`) probes into `Removed`+`Created` — so the paired event is the Linux/Windows path and the hash heuristic is the macOS path. No Rust change needed.
- Hash-matching is sound even when dirty: unsaved edits live only in the buffer, so the moved file's bytes still hash to the last-saved baseline.

**Implications:** At most a couple of candidate `readFileFromDisk` calls per batch that removed our file — bounded, rare. The registry (`file-card-open-registry.ts`) needs no re-keying (keyed by cardId; `getPath()` reads live state).

#### [P06] Close gate: async per-card guard at the title-bar funnel; quit and force-close never prompt (DECIDED) {#p06-close-gate}

**Decision:** A new module-level registry (`tugdeck/src/lib/card-close-guard.ts`) maps cardId → `guard: () => Promise<"close" | "cancel">`, registered by the File card body ([L27]: registration returns its release). `CardTitleBar.requestClose` / `requestCloseWith` in `tug-pane.tsx` consult the registry: a registered guard supersedes the `confirmClose` popover for that card; `"close"` proceeds, `"cancel"` aborts. Option-click bypass is preserved unchanged. App quit does not prompt ([Q02]): the existing pagehide/unmount keepalive flush persists the aside, and reopening restores the edits dirty.

**Rationale:**
- Every close gesture (X click, ⌘W, ⌥⌘W, pane close, menu Close) funnels through `CardTitleBar` — but through **four** sites, not one: the X button's `handleClosePointerUp`/`handleCloseClick` call `onClose` directly on a non-`confirmClose` pane, while ⌘W/close-all use the `requestClose`/`requestCloseWith` handle. The guard consultation goes in a shared helper called from all four (see Risk R02). No scattering across files — all four are in `tug-pane.tsx`.
- Option-click force-close is safe *because of* the aside: the edits survive on disk and restore on reopen. Prompting there would break the established escape hatch for no safety gain.
- Only the mounted active card can be dirty-in-memory (background tabs are bags); their asides are already flushed, so closing them silently is lossless.

**Implications:** The File card's guard presents the Save/Don't Save/Cancel sheet (**Spec S03**); "Save" on an untitled buffer runs the save panel first, and a canceled panel cancels the close. `deck-manager.ts` itself stays guard-free — [L23] close-handoff still fires the (aside) flush before destruction as the last line of defense.

#### [P07] Menu enablement via a `file` menuState block; ⇧⌘S key equivalent assigned dynamically (DECIDED) {#p07-menu-state}

**Decision:** `host-menu-state.ts` gains `MenuStateFileBlock` (**Spec S02**) published by the File card exactly like the dev block (`publishDevMenuState`/`clearDevMenuState` pattern; rides the payload only while that card is the focused pane's active card). Swift `MenuState` parses it; `validateMenuItem` gates the new items. The Save As… item's ⇧⌘S key equivalent is set/cleared in `AppDelegate.updateMenuState(_:)` (not in `validateMenuItem`) based on whether a file card is frontmost.

**Rationale:**
- ⇧⌘S is bound in the web layer to `SELECT_ROUTE "$"` (the Dev card's Shell route chord, `tugdeck/src/components/tugways/keybinding-map.ts`). A menu item with a matching key equivalent that validates *disabled* eats the chord with a beep and never reaches the web view — so a static ⇧⌘S on Save As… would kill the Shell-route chord whenever a dev card is frontmost. Dynamic assignment gives file cards the classic shortcut and everyone else their chord.
- `updateMenuState` is the safe mutation point — it runs on payload arrival, outside AppKit's key-equivalent scan.

**Implications:** ⌥⇧⌘S (Save a Copy) and ⌥⌘N (New Text File) collide with nothing (verified against `keybinding-map.ts` and the existing menu) and stay static. Revert/Reload get no key equivalents. No new web keybindings are added — like New Dev Card (⌘N), these are menu-only commands; the existing browser-dev ⌘S binding to `TUG_ACTIONS.SAVE` stays.

#### [P08] Aside writes are hash-chained conditional writes (DECIDED) {#p08-aside-writes}

**Decision:** The aside helper tracks the aside file's own last-written sha256 and conditions each rewrite on it, using the create-new → on-`conflict`-retry-with-reported-hash pattern already used by `FileEditorStore.saveAs`. No `force` flag is added to `/api/fs/write`.

**Rationale:** Keeps the fs endpoint's invariant (every write is conditional or create-new) intact; a stale aside from a crash is absorbed by the first conflict-retry.

**Implications:** The aside module owns a tiny state machine (`_asideSha256`) per store instance; a fresh store re-reading the aside on open re-seeds the chain.

#### [P09] Focus-time recheck backstops the watcher (DECIDED) {#p09-focus-recheck}

**Decision:** On card activation (`onCardActivated` in `file-card.tsx`'s `useCardStatePreservation` wiring) and on window becoming visible (a `visibilitychange` listener that acts **only** when `document.visibilityState === "visible"` — the same event fires on hide, where the existing `flushOnHide` handler already runs; a bare `visibilitychange` recheck would fire a disk read on every hide too), the store rechecks disk: clean → existing `refreshFromDisk()` silent reload; manual + dirty → compare disk sha to baseline and raise the conflict sheet on divergence.

**Rationale:** The FILESYSTEM feed only watches the session workspace root ([#watch-coverage]); files opened from elsewhere get no events. Checking on activation is exactly what NSDocument-based apps do when the app becomes active.

**Implications:** Cheap (one `/api/fs/read` per activation of a file card); must not fire while a sheet is already up or a write is in flight (reuse the `_recheckQueued` discipline).

#### [P10] Untitled manual buffers are aside-only until first save (DECIDED) {#p10-untitled}

**Decision:** New Text File opens a manual card with `path: null`, `fileName: "Untitled"`, seeded empty; its aside is keyed by the card's draftId (`aside-untitled-<draftId>.json`). No file exists anywhere until the first Save runs the save panel. Automatic mode's existing `openDraft` (real file under `Drafts/`) is untouched.

**Rationale:** Classic untitled semantics — the document has no file identity until saved — while the aside still crash-protects it. Avoids creating-then-GCing `Drafts/` files for manual buffers.

**Implications:** `phase === "ready"` with `path === null` becomes legal in manual mode; `flush`/save paths and the status/top bars must tolerate it. Save on untitled routes through the save panel; a cancelled panel leaves the buffer dirty and open. The card bag carries `{ draftId, untitled: true }` so restore re-enters `openUntitled` and finds the aside.

#### [P11] Reuse routing never rebinds a dirty card (DECIDED) {#p11-reuse-dirty}

**Decision:** In `openFileInCard` (`tugdeck/src/lib/open-file-in-card.ts`), the `"reuse"` open-target consults the frontmost file card's dirty state (via a new `FileCardOpenEntry.isDirty()`); a dirty card is never rebound — the open falls through to the `"new"` route.

**Rationale:** Rebinding tears down the buffer; prompting mid-open is hostile. Opening a fresh card is always safe and cheap.

**Implications:** One added method on `FileCardOpenEntry` (`file-card-open-registry.ts`); path-keyed reuse of an already-bound card (`findFileCardByPath`) is unaffected — activating a dirty card that already shows the requested path is fine.

#### [P12] Two distinct write targets; `flush()` is the aside path, `save()` is the real-file path (DECIDED) {#p12-write-targets}

**Decision:** In manual mode the store has two write paths that must never be confused. `flush()` (and every existing lifecycle caller — `onSave`, `pagehide`/`visibilitychange`, unmount, `[L23]` close-handoff, all of which call `store.flush({keepalive})` directly in `file-card.tsx`) writes the **aside**. The **real file** is written only by the explicit save verbs: `save()`, `saveAs()`, `saveACopy()`, and the conflict resolution `resolveConflict("overwrite")` — which in manual mode routes to the real-file save path with the baseline pre-seeded from `conflict.diskSha256`, NOT to `flush()`.

**Rationale:**
- The existing `resolveConflict("overwrite")` ends with `await this.flush()`. Once `flush()` is repointed at the aside (the whole premise of manual mode), an unchanged overwrite arm would flush the aside, report success, and never touch the real file — silently discarding the user's "Save Anyway" decision in the exact flow the feature exists to protect. This is a data-integrity trap and must be closed explicitly.
- Lifecycle callers must hit the aside (never the real file) so that closing/quitting a dirty manual card persists the crash-recovery payload without an unrequested real-file write.

**Implications:**
- `resolveConflict` branches on `saveMode`: automatic keeps `flush()`; manual seeds `_baselineSha256 = conflict.diskSha256`, clears the conflict, and calls the real-file save, deleting the aside on the ok settle.
- A unit test must assert that, in manual mode, the overwrite arm issues a write to the **real path** (not the aside path) and that the aside is deleted afterward.

---

### Deep Dives {#deep-dives}

#### Current architecture inventory (what the implementer builds on) {#current-architecture}

**Store** — `tugdeck/src/lib/file-editor-store.ts`. One `FileEditorStore` per mounted File card. Key surface: `openPath(path)`, `openDraft(draftId)`, `saveAs(newPath)`, `saveNow()`, `noteEdit()`, `flush(opts?)`, `resolveConflict("reload" | "overwrite")`, `refreshFromDisk()`, `setLineEnding(ending)`, `dispose()`; `subscribe`/`getSnapshot` for `useSyncExternalStore`. Internal: `_baselineSha256` (the hash every write is conditioned on), `_debounceTimer` (`AUTOSAVE_DEBOUNCE_MS = 1000`), `_flushInFlight`, `_editedDuringWrite` (edit landed mid-write → re-flush on settle instead of reporting clean), `_recheckQueued`, `_unsubscribeFilesystem`. `serializeEol(text, ending)` owns the newline representation at the write boundary (CM6 always yields `\n`-only text). `_onWriteSettled(outcome)` handles ok / `conflict` (→ `conflict: {reason:"hash", diskSha256}`) / `missing` / transport-failure-with-backoff. `_onFilesystemFrame` filters FILESYSTEM batches for `${workspace_key}/${event.path} === snap.path`; while `writing` it queues a recheck (own echo), while `editing` or conflicted it currently ignores, otherwise `_recheckDisk()` silently reloads when the disk hash diverged. The store never touches CM6 — it goes through the attached `FileEditorBridge` (`getText`, `replaceText`, `getPositions`, `applyPositions`).

**File I/O** — `tugdeck/src/lib/file-io.ts`: `readFileFromDisk(path)` → `{ path (canonicalized), content, sha256, size, mtimeMs, readOnly }` or typed error; `writeFileToDisk({ path, content, baselineSha256, delete? }, { keepalive? })` → ok`{sha256, mtimeMs}` / `conflict{diskSha256}` / typed error. `baselineSha256: null` means create-new (fails `conflict` if the target exists — the retry-with-reported-hash pattern deliberately overwrites after a save panel confirmed replacement). Server: `tugrust/crates/tugcast/src/fs_read.rs` (`MAX_READ_BYTES` 8 MiB, `guard_absolute_path`, secret-path denylist) and `fs_write.rs` (atomic temp+fsync+rename; parents created **only** under `drafts_root()` = `~/Library/Application Support/Tug/Drafts`).

**Card** — `tugdeck/src/components/tugways/cards/file-card.tsx` (`FileCardContent`): creates the store, `useSyncExternalStore` snapshot, bag = `{ path, draftId, anchor, scrollTop }` (positions only, never content), `useCardStatePreservation` with `onSave` → `flush({keepalive:true})` and `onRestore` → reopen + pending positions, pagehide/visibilitychange/unmount final flush, title sync to `cardTitleStore` (`tugdeck/src/lib/card-title-store.ts`), registration in `file-card-open-registry.ts` (`FileCardOpenEntry { getPath, revealLine, openFile }`). Save As today = top bar Move To… → `pickPath("save", initialPath)` (`native-path-picker.ts`) → `store.saveAs`. Conflict/missing render as a `TugPaneBanner` (non-modal) with reload/overwrite buttons. `FileCardTopBar` and `FileCardStatusBar` (save cell copy: "Saving…"/"Unsaved"/"Saved(: time)"; line-ending + language popups) complete the chrome.

**Actions & keys** — `tugdeck/src/action-dispatch.ts`: `initActionDispatch` subscribes `FeedId.CONTROL`; every CONTROL frame's JSON goes to `dispatchAction`. Chain adapters exist where the CONTROL name equals the `TUG_ACTIONS` name (e.g. `save` → `sendToFirstResponder({action: SAVE})`; likewise `close`, `close-all`, `open-file`). `TUG_ACTIONS` lives in `tugdeck/src/components/tugways/action-vocabulary.ts`. The SAVE responder handler lives in `tugdeck/src/components/tugways/tug-file-editor.tsx` (calls `store.saveNow()`). Static web keybindings in `keybinding-map.ts` (⌘S → SAVE for browser dev; ⇧⌘S → SELECT_ROUTE "$" — see [P07]).

**Menu pipeline** — web→Swift: `host-menu-state.ts` aggregates `MenuStateDeckProjection` + per-card dev block (`publishDevMenuState(cardId, block)` / `clearDevMenuState(cardId)`; the publisher keeps a `Map` and serializes the block only while its card is the focused pane's active card), diffs/coalesces, posts to `webkit.messageHandlers.menuState`. Swift: `AppDelegate.updateMenuState(_:)` caches a `MenuState` struct; `validateMenuItem(_:)` gates by `menuItem.identifier` (items tagged `.identified("file.save")` etc.). Swift→web: menu selectors call `processManager.sendControl(action, params)` → UDS `{"type":"tell",...}` → tugcast CONTROL feed → `dispatchAction`. The File menu is built in `AppDelegate.setupMenuBar` (New Dev Card ⌘N, New Git Card ⇧⌘N, Open File… ⌘O → NSOpenPanel → `sendControl("open-file")`, Close ⌘W, Close All ⌥⌘W, Save ⌘S → `sendControl("save")`, Export Transcript…).

**Close flow** — `tugdeck/src/components/chrome/tug-pane.tsx`: `CardTitleBar` handle exposes `requestClose()` and `requestCloseWith({needsConfirm, message, confirmLabel, onConfirm})`; X-click, ⌘W (`handleChromeClose`), and ⌥⌘W (`handleCloseAll`) all route through them; `confirmClose` (static `CardMeta` flag in `card-registry.ts`) opens a two-button `TugConfirmPopover`; Option-click always bypasses. `deck-manager.ts` fires `invokeSaveCallback(cardId, "close-handoff")` before destruction ([L23]).

**Sheets** — `tugdeck/src/components/tugways/tug-sheet.tsx`: pane-modal (portals into the pane frame, scrim + `inert` body, Escape/⌘. cancel). Imperative: `useTugSheet()` → `{ showSheet(options): Promise<string | undefined>, renderSheet }` — resolve value is whatever `close(result)` passed. `presentAlertSheet(showSheet, options): Promise<boolean>` (`tug-alert-sheet.tsx`) is the two-button shorthand. Canonical card-scoped pattern: `model-picker-sheet.tsx`'s `useModelPicker`.

#### Reconciliation matrix {#reconciliation-matrix}

**Table T01: External-change reconciliation** {#t01-reconciliation}

| Buffer state | Disk event | Detection | Behavior |
|---|---|---|---|
| Clean (any mode) | modified | watcher / focus recheck | Silent in-place reload (existing `_recheckDisk`; buffer, line ending, readOnly re-seeded) |
| Dirty (manual) | modified | watcher / focus recheck | Read disk; if `sha256 !== _baselineSha256` → `conflict {reason:"hash", diskSha256}` → **modal conflict sheet** (Spec S03) immediately |
| Dirty (manual) | modified | ⌘S write returns `conflict` | Same sheet, seeded from the write outcome |
| Dirty (automatic) | modified | write returns `conflict` | Unchanged: non-modal banner with Reload / Overwrite |
| Any | deleted | watcher / write returns `missing` / recheck `not_found` | Manual: **missing sheet** (Spec S03: Save / Save As… / Cancel). Automatic: existing missing banner |
| Any (both modes) | renamed | `Renamed{from,to}` or Removed+Created pairing ([P05]) | Follow: rebind path/fileName, re-key aside, update title/tab; no prompt |
| Dirty (manual), card closed | modified while away | open-time aside check (aside.baselineSha256 ≠ disk sha) | **Open-conflict sheet** (Spec S03: Keep My Changes / Use Disk Version) |

Conflict sheet resolutions (dirty + modified): **Save Anyway** → write the **real file** conditioned on the reported disk hash, then delete the aside on ok settle (in manual mode this must route through the real-file save path, NOT `flush()` — which now targets the aside; see [P12]); **Reload from Disk** → `resolveConflict("reload")` + delete aside; **Save As…** → save panel → `saveAs` (disk file keeps the foreign version — the classic "keep both"); **Cancel** → stay dirty, conflict badge in the status bar, save disabled until resolved (matches the existing `noteEdit`/`flush` conflict no-op discipline).

#### Watch coverage gap {#watch-coverage}

`FilesystemFeed` frames carry a `workspace_key` and paths relative to a session workspace root; `_onFilesystemFrame` reconstructs `${root}/${event.path}`. A File card bound to a path outside every active workspace gets **no watcher events at all** — external modification there is only caught by (a) the hash-conditional write at save time and (b) the focus-time recheck ([P09]). This is why [P09] is not optional. The watcher's 100 ms debounce (`DEBOUNCE_MILLIS`, `file_watcher.rs`) sets the "immediately" latency floor for [P04].

#### Aside lifecycle walkthrough {#aside-lifecycle}

1. **Edit** in manual mode → `noteEdit()` → `saveState: "editing"` (dirty) + debounce arms → `_flushAside()` writes **Spec S01** JSON (hash-chained, [P08]). The real file is untouched.
2. **⌘S** → real-file conditional write (existing `flush` body, target = real path) → on ok: `saveState: "clean"`, `_baselineSha256` updated, aside deleted (conditional `delete: true`).
3. **Quit / crash** → last aside flush (pagehide keepalive, or simply the last debounced flush) survives.
4. **Reopen** (card restore or fresh `openPath`) → read disk, read aside: no aside → normal open; aside with `baselineSha256 === disk.sha256` → seed buffer from `aside.content` + `aside.lineEnding`, `saveState: "editing"` (silent, NSDocument-style); aside with mismatched baseline → open-conflict sheet (**Table T01** last row); `"invalid"` aside (parseable but wrong `path`/version) → delete it, normal open ([Q01] opportunistic cleanup); `"unreadable"` aside (transport/`too_large`) → leave it on disk, normal open (never delete a payload we couldn't read — watch-item, Step 2).
5. **Untitled** ([P10]): same flow keyed by draftId; first Save runs the panel, then converts to a path-keyed document (aside deleted).

---

### Specification {#specification}

**Spec S01: Aside record format** {#s01-aside-format}

Location: `~/Library/Application Support/Tug/Autosave Information/` (tilde expanded by the fs endpoints, like `draftPathFor`). Filename: `aside-<fnv1a64-hex-of-canonical-path>.json` for path-bound documents; `aside-untitled-<draftId>.json` for untitled buffers. FNV-1a 64-bit is implemented in TS in `file-aside.ts` (BigInt; deterministic, no crypto.subtle dependency); the embedded `path` field is verified on read so a hash collision degrades to "no aside", never to a wrong restore.

```json
{
  "version": 1,
  "path": "/abs/canonical/path.txt",   // null for untitled
  "draftId": null,                      // non-null for untitled
  "content": "…full buffer text, \n-normalized…",
  "lineEnding": "LF" | "CRLF" | "CR",
  "baselineSha256": "…",               // disk sha the edits are based on; null for untitled
  "editedAt": 1234567890123
}
```

**Spec S02: `MenuStateFileBlock` and menu gates** {#s02-menu-file-block}

TS (`host-menu-state.ts`), published by the File card via new `publishFileMenuState(cardId, block)` / `clearFileMenuState(cardId)` mirroring the dev-block pair; rides `MenuStatePayload` as `file: MenuStateFileBlock | null` (null unless the focused pane's active card is a File card in phase `ready`):

```ts
interface MenuStateFileBlock {
  cardId: string;
  mode: "manual" | "automatic"; // gates Save differently (see below)
  dirty: boolean;      // manual: saveState !== "clean"; automatic: false
  untitled: boolean;   // path === null (manual) — Save must run the panel
  readOnly: boolean;
  hasPath: boolean;    // a disk file is bound (gates Revert/Reload)
  conflict: boolean;   // unresolved conflict — Save disabled until resolved
}
```

Swift (`AppDelegate.swift` `MenuState`): add `struct File { cardId, mode, dirty, untitled, readOnly, hasPath, conflict }`, parsed in `MenuState.init(payload:)`. Menu items and gates (`validateMenuItem`, keyed on `.identified` ids):

| Item | Id | Key | Enabled iff |
|---|---|---|---|
| New Text File | `file.newTextFile` | ⌥⌘N | always |
| Save | `file.save` (exists) | ⌘S | `file != nil && !readOnly && !conflict && (mode == "automatic" \|\| dirty \|\| untitled)` |
| Save As… | `file.saveAs` | ⇧⌘S *dynamic* ([P07]) | `file != nil` |
| Save a Copy… | `file.saveACopy` | ⌥⇧⌘S | `file != nil` |
| Revert to Saved | `file.revertToSaved` | — | `file != nil && dirty && hasPath` |
| Reload from Disk | `file.reloadFromDisk` | — | `file != nil && hasPath` |

**Automatic-mode Save must stay enabled** (whenever `!readOnly && !conflict`) to preserve today's "flush now + checkpoint" ⌘S. If Save validated disabled for an automatic card, the beep-eats-chord rule ([P07], #assumptions) would make ⌘S *beep* in the packaged app instead of flushing — an unforced regression of the retained feature. Manual mode adds the `dirty || untitled` requirement (a clean titled document has nothing to save).

Selectors dispatch `sendControl("new-text-file")`, `sendControl("save-as")`, `sendControl("save-a-copy")`, `sendControl("revert-to-saved")`, `sendControl("reload-from-disk")`; Save keeps `sendControl("save")`. `updateMenuState` sets `file.saveAs`'s `keyEquivalent`/`keyEquivalentModifierMask` when `file != nil` and clears it otherwise.

**List L01: New control actions and chain actions** {#l01-actions}

- `TUG_ACTIONS.SAVE_AS = "save-as"`, `SAVE_A_COPY = "save-a-copy"`, `REVERT_TO_SAVED = "revert-to-saved"`, `RELOAD_FROM_DISK = "reload-from-disk"` — added to `action-vocabulary.ts` (with docstring entries) and registered in `action-dispatch.ts` as Both-flavor adapters (`registerAction(name, () => sendToFirstResponder({action: name}))`, the `save` adapter pattern). Handled by responders registered at the File card scope (Step 6).
- `"new-text-file"` — CONTROL-only action in `action-dispatch.ts`: creates a File card whose bag is `{ draftId: <new id>, untitled: true }` via the deck store's add-card path with `initialContent` (the seam added for `newTab` routing in `deck-manager.ts`), then activates it. Not responder-routed; no web keybinding (menu-only, like `show-card`).

**Spec S03: Sheet copy and buttons** {#s03-sheets}

All sheets are pane-modal, presented from the File card via `useTugSheet().showSheet` (custom content; `presentAlertSheet` where two buttons suffice). Classic order: destructive-alternative left, Cancel, default right; Return = default; Escape/⌘. = Cancel.

1. **Close (dirty):** "Do you want to save the changes made to the document “{fileName}”?" / "Your changes will be lost if you don't save them." — [Don't Save] … [Cancel] [Save•]. Don't Save = delete aside + close. Save = save (untitled → panel; panel cancel → treat as Cancel) + close on success.
2. **Conflict (dirty + disk modified):** "The document “{fileName}” has been changed by another application." / "Your unsaved changes and the changes on disk conflict." — [Reload from Disk] [Save As…] … [Cancel] [Save Anyway•]. Semantics per [#reconciliation-matrix].
3. **Missing (manual, file deleted):** "The file for “{fileName}” has been deleted by another application." — [Save As…] … [Cancel] [Save•] (Save recreates at the same path: create-new write, conflict-retry).
4. **Revert:** "Do you want to revert to the last saved version of “{fileName}”?" / "Your current changes will be lost." — [Cancel] [Revert•(danger)] (`presentAlertSheet`, `confirmRole: "danger"`).
5. **Reload from Disk while dirty:** same body as Revert with "reload the version on disk" phrasing; when clean it reloads without a sheet.
6. **Open-conflict (aside baseline ≠ disk):** "“{fileName}” has unsaved changes from a previous session, but the file on disk has been changed since." — [Use Disk Version] … [Keep My Changes•]. Keep = seed buffer from aside, dirty, `_baselineSha256` = current disk sha (so the next Save is conditioned on what's really there). Use Disk = delete aside, normal open.

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| `saveMode`, dirty bit (`saveState`), `conflict`, `untitled` | local-data (per-card store) | `FileEditorStore` + `useSyncExternalStore` (existing) | [L02] |
| Aside content/sha chain | non-React module state | private fields in `FileEditorStore` / `file-aside.ts`; never rendered | — |
| Sheet visibility/result | component-local via TugSheet | `useTugSheet().showSheet` promise (established pattern) | [L11] |
| Close guard registry | non-React module Map | `card-close-guard.ts`; registration returns release | [L27] |
| Menu enablement facts | outward mirror (no React consumer) | `publishFileMenuState` → `menuState` post | [L02] n/a — store-observed, render-free |
| Dirty dot in tab/title | external store | `cardTitleStore.set(cardId, "● " + name)` from the existing title-sync effect | [L02] |
| Status-bar save cell copy | derived from snapshot | existing `FileCardStatusBar` props | [L02] |
| Save-mode default | persisted | tugbank `dev.tugtool.file-editor` / `save-mode` (no settings UI) | no-localStorage rule |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/file-aside.ts` | Aside key derivation (FNV-1a 64), `asidePathFor(path)` / `asidePathForUntitled(draftId)`, `readAside`, `writeAside` (hash-chained, [P08]), `deleteAside`, `parseAside` validation |
| `tugdeck/src/lib/card-close-guard.ts` | `registerCardCloseGuard(cardId, guard): () => void`, `getCardCloseGuard(cardId)` |
| `tugdeck/src/components/tugways/cards/file-card-save-sheets.tsx` | `useFileSaveSheets(showSheet)` — presenters for the six Spec S03 sheets |
| `tugdeck/src/lib/file-aside.test.ts` | Unit tests (mocked `file-io`) |
| `tugdeck/src/lib/file-editor-store.manual.test.ts` | Manual-mode state machine tests (pattern: `file-editor-store.autosave.test.ts`'s `mock.module("@/lib/file-io", …)`) |
| `tests/app-test/at0211-file-editor-manual-save.test.ts` | End-to-end manual-mode coverage |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `asides_root()` | fn | `tugrust/crates/tugcast/src/fs_write.rs` | `…/Tug/Autosave Information`; parent-creation check generalizes `drafts_root()` to both roots |
| `FileEditorStore.saveMode` + ctor option | field | `file-editor-store.ts` | default `"automatic"` at store level; card passes resolved default ([P01]) |
| `FileEditorStore.openUntitled(draftId)` | method | `file-editor-store.ts` | [P10] |
| `FileEditorStore.save()` | method | `file-editor-store.ts` | manual explicit save; real-file write + aside delete; untitled → signals "needs path" to the card |
| `FileEditorStore.saveACopy(path)` | method | `file-editor-store.ts` | create-new + conflict-retry; no rebind, no state change |
| `FileEditorStore.revertToSaved()` / `reloadFromDisk()` | methods | `file-editor-store.ts` | force recheck + aside delete; card owns the confirm sheets |
| `FileEditorStore.recheckOnActivation()` | method | `file-editor-store.ts` | [P09] |
| `FileEditorSnapshot.saveMode`, `.untitled` | fields | `file-editor-store.ts` | render surface for status/menu facts |
| `FileCardBagContent.untitled` | field | `file-card.tsx` | `coerceBagContent` extension |
| `FileCardOpenEntry.isDirty()` | method | `file-card-open-registry.ts` | [P11] |
| `MenuStateFileBlock`, `publishFileMenuState`, `clearFileMenuState`, `MenuStatePayload.file` | types/fns | `host-menu-state.ts` | [P07], Spec S02 |
| `TUG_ACTIONS.SAVE_AS` / `SAVE_A_COPY` / `REVERT_TO_SAVED` / `RELOAD_FROM_DISK` | consts | `action-vocabulary.ts` | List L01 |
| Adapters + `new-text-file` | registrations | `action-dispatch.ts` | List L01 |
| Close-guard consultation | logic | `chrome/tug-pane.tsx` (`requestClose`, `requestCloseWith`) | [P06] |
| `MenuState.File` + parsing, six File items, gates, dynamic ⇧⌘S | Swift | `tugapp/Sources/AppDelegate.swift` | Spec S02 |
| `readSaveMode()` | fn | `open-file-in-card.ts` or `file-editor-settings.ts` | [P01]; `readOpenTarget` pattern |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (store)** | Manual-mode state machine: dirty transitions, aside flush targets, restore matrix, conflict raising, rename adoption rules | Deterministic `mock.module("@/lib/file-io")` with controllable outcomes and synthetic FILESYSTEM frames — the established `file-editor-store.autosave.test.ts` pattern |
| **Unit (pure)** | FNV key derivation, aside parse/validate, menu-block computation, gate predicates | `bun test src` |
| **Rust unit** | `asides_root` parent creation; existing `fs_write` conditional semantics unchanged | `cargo nextest run` |
| **App-test (integration)** | Real app, real files: at0211 manual-save E2E; at0209 re-seeded automatic; at0210 unchanged | `just app-test` |

#### What stays out of tests {#test-non-goals}

- jsdom/fake-DOM render tests of sheets or menu items — banned pattern; sheets are exercised through the real app in at0211.
- Mock-store assertion tests of React wiring — banned; `useSyncExternalStore` wiring is covered by the app-tests.
- Swift `validateMenuItem` unit tests — no Swift test harness in-repo; gates are verified via the app-test driving `dispatchControlAction` plus manual menu inspection, and the TS gate predicates (which mirror them) are unit-tested.
- Crash-recovery of the keepalive fetch itself — covered by the browser contract; the restore path is tested by writing an aside and reopening.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass** (via `tugutil dash commit` on a dash worktree, or by the user per the git policy). Standard tugdeck checkpoint = `cd tugdeck && bunx tsc --noEmit && bun test src && bunx vite build`; standard Rust checkpoint = `cd tugrust && cargo nextest run`.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | fs_write: Autosave Information root | pending | — |
| #step-2 | Aside helpers (`file-aside.ts`) | pending | — |
| #step-3 | Store manual-mode core | pending | — |
| #step-4 | Save verbs + reconciliation in the store | pending | — |
| #step-5 | Card close guard in pane chrome | pending | — |
| #step-6 | File card manual UI: sheets, status, guard, routing | pending | — |
| #step-7 | Menu-state file block + control actions | pending | — |
| #step-8 | Swift File menu | pending | — |
| #step-9 | Rename-follow + focus recheck | pending | — |
| #step-10 | Flip default; app-tests | pending | — |
| #step-11 | Integration checkpoint | pending | — |

#### Step 1: fs_write — Autosave Information root {#step-1}

**Commit:** `fs_write: create parents under the Autosave Information root`

**References:** [P03] Set-aside autosave, Spec S01, (#aside-lifecycle)

**Artifacts:** `asides_root()` in `tugrust/crates/tugcast/src/fs_write.rs`; parent-creation check accepts both tug-owned roots.

**Tasks:**
- [ ] Add `asides_root() -> Option<PathBuf>` returning `dirs::data_dir()/Tug/Autosave Information` (mirror `drafts_root()`).
- [ ] Generalize the missing-parent branch in the write handler: parents are created iff the parent starts with `drafts_root()` OR `asides_root()`; anywhere else stays `parent_missing`.
- [ ] Update the module docstring that says parents are created "only under the Tug drafts directory".

**Tests:**
- [ ] Rust test: write to a nested path under a temp-overridden asides root creates parents (follow the existing drafts-root test's env/temp technique).
- [ ] Existing `missing_parent_outside_drafts_is_an_error` still passes.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run`

#### Step 2: Aside helpers {#step-2}

**Depends on:** #step-1

**Commit:** `File editor: aside (set-aside autosave) helpers`

**References:** [P03], [P08] Hash-chained aside writes, Spec S01, (#aside-lifecycle)

**Artifacts:** `tugdeck/src/lib/file-aside.ts` + `file-aside.test.ts`.

**Tasks:**
- [ ] FNV-1a 64-bit hex over the canonical path (BigInt); `asidePathFor(path)` / `asidePathForUntitled(draftId)` returning tilde paths under `~/Library/Application Support/Tug/Autosave Information/`.
- [ ] `parseAside(json, expectedPathOrDraftId)` — strict validation (version, field types, path/draftId match); invalid → null. **Distinguish outcomes for the caller:** `readAside` must return a three-way result — `{ record }` (valid), `"invalid"` (parseable but wrong/corrupt → safe to delete, [Q01]), or `"unreadable"` (transport error, `not_found`, or `too_large` — an aside for a file near the 8 MiB `MAX_READ_BYTES` cap can exceed it once JSON-escaped). The caller MUST NOT delete on `"unreadable"` — deleting there destroys the crash-recovery payload it failed to read. Only `"invalid"` is deletable.
- [ ] `AsideWriter` (or equivalent) owning the sha chain: first write `baselineSha256: null`; on `conflict` retry with the reported `diskSha256`; subsequent writes conditioned on the last ok `sha256`. `write(record, {keepalive?})`, `delete()` (conditional `delete: true`), `read()` re-seeding the chain.

**Tests:**
- [ ] Key derivation is deterministic and distinct for distinct paths; untitled keying by draftId.
- [ ] Parse rejects wrong-path payloads (collision safety) and wrong versions.
- [ ] Sha-chain: mocked `file-io` returning exists-conflict on first write → retry succeeds; chain carries forward.

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test src && bunx vite build`

#### Step 3: Store manual-mode core {#step-3}

**Depends on:** #step-2

**Commit:** `File editor: manual save mode core (dirty bit, aside autosave, untitled, restore)`

**References:** [P01] Save modes, [P03], [P10] Untitled aside-only, Spec S01, Table T01 (last row), (#current-architecture, #aside-lifecycle)

**Artifacts:** `FileEditorStore` mode branch; `openUntitled`; open-time aside restore; `file-editor-store.manual.test.ts`.

**Tasks:**
- [ ] Ctor option `{ saveMode?: "manual" | "automatic" }` (default `"automatic"` — the card flips the default in #step-10); `saveMode` + `untitled` on the snapshot. **Guard against the reset wipe:** `openPath` resets state via `{ ...EMPTY_SNAPSHOT, phase: "loading", … }`; since a rebind (`saveAs`→`openPath`, rename-follow) reuses the same store, `saveMode` must NOT be reset by that spread — hold it in a private field (`_saveMode`) and re-apply it into every `_update` that resets the snapshot (or keep it off `EMPTY_SNAPSHOT` and merge it back), else a Save As on a manual card silently reverts to automatic. Unit-test a rebind preserves the mode.
- [ ] Manual `noteEdit`/debounce: dirty = `saveState: "editing"`; the debounce flushes the **aside** (internal `_flushAside()`, using the Step-2 writer; content `\n`-normalized, `lineEnding` recorded). Real file untouched. Reuse the `_editedDuringWrite` discipline for aside flushes (aside writer races are absorbed by its sha chain, but a mid-flight edit must re-flush).
- [ ] `setLineEnding` in manual mode: record + mark dirty (no real-file write).
- [ ] `openPath` (manual): after the disk read, consult the aside per [#aside-lifecycle] — silent dirty restore on baseline match; expose a mismatch as a new snapshot field the card renders as the open-conflict sheet (e.g. `pendingAsideConflict: { asideContent, asideLineEnding } | null`) with resolver `resolveAsideConflict("keep" | "disk")`; `"invalid"` aside → delete + normal open; `"unreadable"` aside → keep on disk + normal open (never delete an unread payload).
- [ ] `openUntitled(draftId)`: `phase: "ready"`, `path: null`, `fileName: "Untitled"`, empty seed; aside keyed by draftId; restore path for an existing untitled aside.
- [ ] Lifecycle: pagehide/unmount `flush({keepalive})` targets the aside in manual mode; `dispose()` leaves the aside on disk (that is the restore payload); [L23] close-handoff likewise flushes the aside.

**Tests (deterministic, mocked file-io):**
- [ ] Edits never trigger a real-path write in manual mode; aside is written after debounce.
- [ ] Reopen with matching-baseline aside → buffer = aside content, dirty; with mismatched baseline → `pendingAsideConflict`; both resolver arms.
- [ ] Untitled: no file writes besides the aside; restore round-trip via draftId.
- [ ] Automatic mode paths byte-identical in behavior (existing autosave tests untouched and green).

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test src && bunx vite build`

#### Step 4: Save verbs + reconciliation in the store {#step-4}

**Depends on:** #step-3

**Commit:** `File editor: manual save verbs and external-change reconciliation`

**References:** [P02] Classic verbs, [P04] Reconciliation, [P08], [P12] Write targets, Table T01, Spec S03 semantics, (#reconciliation-matrix, #p12-write-targets)

**Artifacts:** `save()`, `saveACopy(path)`, `revertToSaved()`, `reloadFromDisk()`; manual conflict-on-watch; aside deletion on the discard paths.

**Tasks:**
- [ ] `save()`: manual explicit save — real-path conditional write (reuse the `flush` write body with the real target), on ok delete aside + `clean` + `lastSavedAt`; on `conflict`/`missing` set the corresponding `conflict` snapshot (sheet is the card's job). Untitled (`path === null`) → return a discriminant (`"needs-path"`) so the card runs the panel then `saveAs`.
- [ ] `saveAs(newPath)` manual behavior: existing create-new + conflict-retry write, then rebind; delete the old aside (path-keyed or untitled) and reset the sha chain for the new key; clears dirty.
- [ ] `saveACopy(path)`: write only; no rebind, no dirty change, no aside change.
- [ ] `revertToSaved()` / `reloadFromDisk()`: `_recheckDisk({force:true})` + delete aside + `clean`. (Confirm sheets live in the card; the store methods are unconditional.)
- [ ] `_onFilesystemFrame` manual branch: dirty + hit → read disk; diverged → `conflict {reason:"hash", diskSha256}` (immediately, per [P04]); clean branch unchanged (silent reload). Automatic branch byte-identical to today.
- [ ] `resolveConflict` branches on `saveMode` ([P12]): `"reload"` → force recheck + delete aside (both modes). `"overwrite"` → automatic keeps the existing `flush()`; **manual** seeds `_baselineSha256 = conflict.diskSha256`, clears the conflict, and routes to the **real-file** save path (`save()`), deleting the aside on the ok settle — it MUST NOT call `flush()`, which now writes the aside and would silently drop the user's "Save Anyway".

**Tests:**
- [ ] Save round-trip: dirty → save → clean + aside deleted; conflict outcome → conflict snapshot, aside retained.
- [ ] Watcher frame while dirty (synthetic frame, mocked read divergence) → conflict raised without a write.
- [ ] **Manual `resolveConflict("overwrite")` issues a write to the REAL path (not the aside path) and deletes the aside afterward** — the [P12] data-integrity guard; assert the write target explicitly via the mocked `file-io` call args.
- [ ] Save Anyway / Reload arms including aside deletion; Save a Copy leaves state untouched.
- [ ] Revert/Reload clear dirty and delete the aside.

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test src && bunx vite build`

#### Step 5: Card close guard in pane chrome {#step-5}

**Commit:** `Pane chrome: async per-card close guard`

**References:** [P06] Close gate, Risk R02, [L03] (registrations events depend on), (#current-architecture)

**Artifacts:** `tugdeck/src/lib/card-close-guard.ts`; guard consultation in `chrome/tug-pane.tsx`.

**Tasks:**
- [ ] Registry: `registerCardCloseGuard(cardId, guard: () => Promise<"close" | "cancel">): () => void` ([L27] returned release), `getCardCloseGuard(cardId)`.
- [ ] Shared helper in `CardTitleBar` — `consultGuardThen(proceed: () => void)`: if the (active/closing) card has a registered guard, await it and call `proceed()` only on `"close"`; otherwise call `proceed()` immediately. **Call it from all FOUR close sites** — `handleClosePointerUp`, `handleCloseClick`, `requestClose`, `requestCloseWith` (Risk R02: the first two call `onClose` directly on a non-`confirmClose` pane, so hooking only the imperative handle would leave a plain X-click bypassing the guard). Option-click (`event.altKey`) still bypasses the guard entirely.
- [ ] Preserve existing behavior when there is no guard and no dirty card: a `confirmClose` pane still opens its popover; a plain pane still closes immediately. The guard supersedes only when registered.
- [ ] Multi-tab ⌘W (`handleChromeClose`) and Close All (`handleCloseAll`) route their active-card close through the same consultation; pane-close of a multi-card stack keeps its "Close N Tabs?" popover and additionally runs the active card's guard (background tabs have no live guard by construction — see #assumptions).
- [ ] Guard runs must be single-flight per card (a second ⌘W while the sheet is up is a no-op).

**Tests:**
- [ ] Unit test of the registry (register/release/leak-check per the L27 test pattern in the codebase).
- [ ] Behavior is exercised end-to-end in #step-10's app-test — specifically a **plain X-click** on a dirty file card (the `!confirmClose` short-circuit path) must show the sheet, not close silently (no fake-DOM chrome tests — #test-non-goals).

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test src && bunx vite build`

#### Step 6: File card manual UI — sheets, status, guard, routing {#step-6}

**Depends on:** #step-3, #step-4, #step-5

**Commit:** `File card: manual-mode sheets, dirty chrome, close gate, save routing`

**References:** [P02], [P06], [P10], [P11] Reuse never rebinds dirty, Spec S03, (#state-zone-mapping)

**Artifacts:** `file-card-save-sheets.tsx`; wiring in `file-card.tsx`, `file-card-top-bar.tsx`, `file-card-status-bar.tsx`, `tug-file-editor.tsx`, `file-card-open-registry.ts`, `open-file-in-card.ts`.

**Tasks:**
- [ ] `useFileSaveSheets` presenting the six Spec S03 sheets via `useTugSheet` (model-picker pattern; `renderSheet()` in the card body; `presentAlertSheet` for the two-button ones).
- [ ] Close guard registration (manual mode, mounted card) — register in a `useLayoutEffect` ([L03]: the close gesture may fire before a passive effect commits, mirroring the card's existing `registerOpenFileCard` layout-effect), release on cleanup ([L27]). Guard body: dirty → close sheet → Don't Save = `deleteAside` + `"close"`; Save = `save()` (untitled → `pickPath("save")` first, panel cancel → `"cancel"`) then `"close"` on success; Cancel → `"cancel"`. Clean → `"close"` immediately.
- [ ] Conflict presentation: effect observing `snapshot.conflict` (manual) presents the conflict/missing sheet; `pendingAsideConflict` presents the open-conflict sheet. Cancel leaves a status-bar conflict badge.
- [ ] Add `TUG_ACTIONS.SAVE_AS` / `SAVE_A_COPY` / `REVERT_TO_SAVED` / `RELOAD_FROM_DISK` to `action-vocabulary.ts` with docstring entries (List L01 — the CONTROL adapters follow in #step-7).
- [ ] Responder handlers at the card scope for `SAVE_AS` (panel → `saveAs`), `SAVE_A_COPY` (panel → `saveACopy`), `REVERT_TO_SAVED` (sheet → `revertToSaved`), `RELOAD_FROM_DISK` (dirty → sheet; clean → direct); manual-mode `SAVE` handler in `tug-file-editor.tsx` routes to `store.save()` (and surfaces `"needs-path"` to the card's panel flow) instead of `saveNow()`.
- [ ] Chrome: status-bar save cell manual copy — "Edited" (dirty) / "Saved{: time}" / "Saving…" / conflict badge; title-sync effect prefixes "● " when dirty (`cardTitleStore`); top bar shows Save As… instead of Move To… in manual mode; bag carries `untitled`; `onRestore` routes `untitled` bags to `openUntitled`.
- [ ] `FileCardOpenEntry.isDirty()`; `openFileInCard` `"reuse"` route falls through to `"new"` when the frontmost file card is dirty ([P11]).

**Tests:**
- [ ] Unit: `isDirty` reuse fallback (pure routing logic, mocked registry).
- [ ] Sheets and chrome verified end-to-end in #step-10 (at0211).

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test src && bunx vite build`

#### Step 7: Menu-state file block + control actions {#step-7}

**Depends on:** #step-6

**Commit:** `File editor: menuState file block and File-menu control actions`

**References:** [P07] Menu enablement, Spec S02, List L01, (#current-architecture)

**Artifacts:** `MenuStateFileBlock` + publish/clear in `host-menu-state.ts`; adapters + `new-text-file` in `action-dispatch.ts`.

**Tasks:**
- [ ] `MenuStateFileBlock`, `MenuStatePayload.file`, `publishFileMenuState`/`clearFileMenuState` — mirror the dev block (Map keyed by cardId; serialized only when that card is the focused pane's active card).
- [ ] File card effect publishing the block from the snapshot (mode/dirty/untitled/readOnly/hasPath/conflict) and clearing on unmount ([L27]).
- [ ] Both-flavor adapters in `action-dispatch.ts` for the four chain actions added in #step-6 (`registerAction(name, () => sendToFirstResponder({action: name}))`, the `save` adapter pattern).
- [ ] `new-text-file` CONTROL action: add a File card with bag `{ draftId, untitled: true }` (the `initialContent` seam), then activate it (the `transferFocusForActivation` pattern used by the `newTab` open-target fix).

**Tests:**
- [ ] Unit: file-block projection (given snapshots → block fields, incl. `mode`); payload includes `file` only when the file card is frontmost (extend the existing `host-menu-state` tests).
- [ ] Unit: Save-gate predicate — automatic card (`mode: "automatic"`, clean) → Save enabled; clean titled manual card → Save disabled; read-only or conflicted → disabled (mirrors the Spec S02 gate so the TS side is verified even though Swift `validateMenuItem` has no test harness).
- [ ] Unit: adapter registrations dispatch to the first responder (existing `action-dispatch.test.ts` patterns; mocks return callable unsubscribes per L27).

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test src && bunx vite build`

#### Step 8: Swift File menu {#step-8}

**Depends on:** #step-7

**Commit:** `Tug.app: classic File menu (New Text File, Save As, Save a Copy, Revert, Reload)`

**References:** [P02], [P07], Spec S02, (#current-architecture)

**Artifacts:** Menu items, selectors, `MenuState.File` parsing, gates, dynamic ⇧⌘S in `tugapp/Sources/AppDelegate.swift`.

**Tasks:**
- [ ] Items per Spec S02 (`.identified` ids; the `NSMenuItem(title:action:keyEquivalent:modifierMask:)` convenience for ⌥⌘N / ⌥⇧⌘S): New Text File after New Git Card; Save As… / Save a Copy… after Save; separator; Revert to Saved; Reload from Disk.
- [ ] Selectors call `sendControl` with the List L01 action names (follow `saveActiveEditor(_:)`).
- [ ] `MenuState`: add `File` struct (incl. `mode`) + `init(payload:)` parsing; `validateMenuItem` cases per the Spec S02 gate column — note the Save gate's `mode == "automatic" || dirty || untitled` clause so an automatic card's ⌘S never validates disabled (else it beeps instead of flushing).
- [ ] `updateMenuState`: locate `file.saveAs` and set `keyEquivalent = "s"`, `keyEquivalentModifierMask = [.command, .shift]` when `menuState.file != nil`, else clear to `""` ([P07]).

**Tests:**
- [ ] Build: `xcodebuild`/`just` app build path used by `just app-test-build` compiles warning-free.
- [ ] Behavioral verification lands in #step-10's app-test (menu commands via `dispatchControlAction` equivalents) plus manual menu inspection: with a dev card frontmost, ⇧⌘S still switches the prompt route (no beep); with a dirty file card frontmost, Save/Save As enable; with an **automatic** file card frontmost (seeded), ⌘S still flushes (no beep).

**Checkpoint:**
- [ ] Full app build succeeds (`just app-test-build` build phase or the project's standard build recipe).

#### Step 9: Rename-follow + focus recheck {#step-9}

**Depends on:** #step-4

**Commit:** `File editor: follow external renames; recheck on activation`

**References:** [P05] Rename-follow, [P09] Focus recheck, Risk R01, Table T01, (#watch-coverage)

**Artifacts:** Rename adoption in `_onFilesystemFrame`; `recheckOnActivation()`; card wiring for activation/window-focus.

**Tasks:**
- [ ] Handle `Renamed { from, to }` frames (extend `parseFilesystemFrame` — events currently parse only `{kind, path}`; `Renamed` events serialize `from`/`to` per the serde enum in `tugcast-core/src/types.rs`): resolved `from` matches → adopt.
- [ ] macOS pairing: batch contains `Removed` for our path → collect `Created` candidates; same-basename first, else a sole `Created`; `readFileFromDisk(candidate)` and adopt iff `sha256 === _baselineSha256`; else missing-file flow. Adoption = update `path`/`fileName` snapshot, migrate the aside to the new key (write new, delete old), leave dirty state and baseline untouched. Both modes.
- [ ] `recheckOnActivation()`: no-op while `writing`/sheet-pending; clean → `refreshFromDisk()`; manual dirty → read + raise conflict on divergence. Wire from `onCardActivated` and a `visibilitychange` listener in `file-card.tsx` that acts **only when `document.visibilityState === "visible"`** ([P09] watch-item: the same event fires on hide, where `flushOnHide` already runs — an unguarded recheck would issue a disk read on every hide). `useLayoutEffect` registration, listener release on unmount ([L03], [L27]).

**Tests:**
- [ ] Unit (synthetic frames, mocked reads): `Renamed` adoption; Removed+Created pairing happy path; ambiguity (two creations, no basename match) → missing flow; hash mismatch → missing flow; dirty state preserved across adoption; aside re-keyed.
- [ ] Unit: activation recheck matrix (clean-diverged reload; dirty-diverged conflict; in-flight no-op).

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test src && bunx vite build`

#### Step 10: Flip the default; app-tests {#step-10}

**Depends on:** #step-6, #step-7, #step-8, #step-9

**Commit:** `File editor: manual save is the default; app-test coverage`

**References:** [P01], [P06], [P10], [P12] Write targets, Table T01, Spec S03, (#success-criteria)

**Artifacts:** `readSaveMode()` default `"manual"` wired in `file-card.tsx`; at0209/at0210 updates; `tests/app-test/at0211-file-editor-manual-save.test.ts`.

**Tasks:**
- [ ] Card resolves `save-mode` (tugbank `dev.tugtool.file-editor`, default `"manual"`) and constructs the store with it; the empty-phase "New Untitled File" affordance routes to `openUntitled` in manual mode.
- [ ] at0209 (live autosave): seed the `save-mode: "automatic"` deck default (tugbank helper) before opening the card, so it keeps exercising automatic mode as real coverage of the retained feature.
- [ ] at0210: adjust save-cell copy expectations if touched ("Saved" ↔ "Edited" wording per mode); seed automatic where the old expectations are load-bearing, or update to manual expectations — prefer updating to manual since that's the shipping default.
- [ ] at0211 (new) — **every scenario opens a real file with a real disk path so no path lands in an NSSavePanel** (a native modal panel would block the harness until timeout; nothing in `tests/app-test/_harness/` can drive or cancel a native panel). Scenarios: (1) open file → type → status "Edited", disk unchanged (read file via harness) → `dispatchControlAction("save")` → "Saved", disk updated; (2) modify the file externally while dirty → conflict sheet appears → "Save Anyway" writes the buffer to disk (verify real file content changed — the [P12] guard); reset and repeat → "Reload from Disk" reverts buffer; (3) dirty close via **a plain X-click** (`nativeClickAtElement` on the close button — exercises the `!confirmClose` short-circuit, Risk R02) AND via `dispatchControlAction("close")` → sheet → Don't Save closes without writing; (4) aside restore: type into a titled file, close via Option-bypass (or harness reload), reopen same file → content restored dirty, status "Edited". Respect the harness realities: `SHOULD_RUN` gate, generous `waitForCondition` timeouts (the cold-start popover flake precedent from at0210 — use ≥15000 ms), reveal-scroll clears the sticky header.
- [ ] Untitled/needs-path Save and Save As… panel routing are covered at the **unit level** (`file-editor-store.manual.test.ts`: `save()` on `path === null` returns `"needs-path"`; `saveAs`/`saveACopy` given a path write and rebind) — NOT in at0211, to keep every app-test path panel-free. New Text File is still smoke-tested in at0211 (`dispatchControlAction("new-text-file")` → an Untitled card appears and accepts typing), stopping short of the Save that would open the panel.

**Tests:**
- [ ] `just app-test at0209 at0210 at0211` green (2 runs to shake flakes).

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit && bun test src && bunx vite build`
- [ ] `cd tugrust && cargo nextest run`
- [ ] `just app-test at0209 at0210 at0211 at0155`

#### Step 11: Integration Checkpoint {#step-11}

**Depends on:** #step-10

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #exit-criteria), Table T01, Spec S02

**Tasks:**
- [ ] Walk every Success Criteria bullet against the real app (packaged build): menu enablement matrix by hand (dev card frontmost → ⇧⌘S switches route, no beep; file card dirty → Save enabled; clean titled → Save disabled), quit-with-dirty → relaunch restore, out-of-workspace file conflict via focus recheck.
- [ ] Re-read the tuglaws touched ([L02], [L11], [L23], [L27]) against the diff; run `bun run audit:tokens lint` for any CSS added with the sheets/status chrome.

**Tests:**
- [ ] Full suite: `bun test src`, `cargo nextest run`, `just app-test` (file-editor set).

**Checkpoint:**
- [ ] All Success Criteria (#success-criteria) individually verified and noted in the ledger.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The File card ships classic manual save as its default mode — dirty bit, full save-verb set, close gate, set-aside crash safety, and macOS-convention external-change reconciliation — with automatic mode fully retained behind an unexposed default.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Every #success-criteria bullet verified (per-bullet method stated there).
- [ ] All eleven steps `done` in the ledger with commits recorded.
- [ ] No regressions: full `bun test src`, `cargo nextest run`, app-test file-editor set, `bunx vite build` green.

**Acceptance tests:**
- [ ] at0211 (manual save E2E) green twice consecutively.
- [ ] at0209 green exercising automatic mode via the seeded default.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap-follow-ons}

- [ ] The planned feature that consumes automatic mode (user-directed; the `save-mode` default is its seam).
- [ ] Aside GC sweep if orphan volume ever matters ([Q01]).
- [ ] Extending watcher coverage beyond workspace roots (per-file watches), should focus-recheck latency prove insufficient in practice.

| Checkpoint | Verification |
|------------|--------------|
| Manual default, dirty bit, save verbs | at0211 |
| Close gate | at0211 close-sheet scenario |
| Reconciliation matrix | at0211 conflict scenarios + store unit tests |
| Rename-follow | store unit tests (synthetic frames) |
| Menu gates + ⇧⌘S chord safety | Step 11 manual matrix |
| Automatic mode retained | at0209 (seeded) + existing store tests |
