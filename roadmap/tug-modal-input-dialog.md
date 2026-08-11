<!-- devise-skeleton v4 -->

## TugModalInputDialog: an app-modal input primitive, Open Quickly rebuilt on it, TugCompletionPopup retired {#phase-slug}

**Purpose:** Ship a new `TugModalInputDialog` primitive — TugAlert's app-modal machinery around a typing-first HUD input — move Open Quickly onto it with a `TugFileChooser` scope row replacing the embedded directory-switcher popup, adopt the KBF mode design (⌥⇥ engages the mode inside the dialog), and retire `TugCompletionPopup`.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-08-11 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Open Quickly today is `TugCompletionPopup` (`tugdeck/src/components/tugways/tug-completion-popup.tsx`) mounted from `OpenQuicklyOverlay` (`tugdeck/src/components/chrome/open-quickly-overlay.tsx`, rendered once at deck level in `deck-canvas.tsx`). It is a popup pretending to be modal: dismissal is held together by an `onBlur` handler with three exemptions (in-panel focus, the engine key sink, a caller `dismissGuard`), a backdrop `onMouseDown`, and an app-resign observer. The `dismissGuard` exists solely because the directory-switcher accessory — a `TugPopupButton` whose Radix menu portals outside the panel — makes focus-in-the-menu look like focus-leaving-the-popup. That same portalled menu is the focus watchdog's known blind spot (`roadmap/kbf-mode-continued-brief.md#brief-open-quickly`), and the ⌥⇥ gesture inside the popup was mis-routed until commit `1e86cd245` routed `cycle-focus-mode` through the action registry and made the toggle act on the top trapped mode. The brief's verdict was to rework the surface rather than patch it further.

The rework: a new app-modal primitive, `TugModalInputDialog`, borrowing TugAlert's modality wholesale (Radix Dialog, blocking overlay, engine focus trap, in-jail key sink). Open Quickly keeps its large HUD input, its file-match mechanism, and its result dropdown, but the embedded directory-switcher popup is retired in full and replaced by the same three-part `TugFileChooser` (path field with `/api/fs/complete` completion + recents seed + native Browse… button) the session picker's *Project path* uses — placed as a bare row **above** the HUD input. Real modality deletes the entire blur-dismiss apparatus. The dialog adopts the KBF mode design: typing-first at open, ⌥⇥ engages the mode over the dialog's own stops.

#### Strategy {#strategy}

- Build the primitive first, with a gallery card, before touching Open Quickly — the component is proven standalone, then adopted.
- Borrow TugAlert's modality machinery (`tug-alert.tsx`) rather than inventing: Radix `Dialog` (imported as `AlertDialog` from `@radix-ui/react-dialog` there), `useFocusTrap` with `deferDomFocusToTeardown`, prevented Radix auto-focus/Escape, an in-jail `[data-tug-key-sink]`, `isCancelChordEvent` for ⌘.
- Migrate the field/list/provider internals of `TugCompletionPopup` into the primitive largely intact — that part was never the problem.
- Move Open Quickly onto the primitive in one step: chooser row in, switcher out, blur-dismiss apparatus deleted.
- KBF adoption is a verification-plus-hygiene step, not a mechanism build: the `1e86cd245` gate already makes ⌥⇥ act on the top trapped mode; what the dialog owes is stops worth ringing and manual-bit hygiene at close.
- Tests are rewritten against the new surface (at0213, at0306, at0396 — including resurrecting the parked ⌥⇥ test from `c6ef67aba`), then the old component and its `@covers` references are retired.
- Proof discipline from `roadmap/kbf-mode-continued-brief.md#brief-proof` applies: a suite counts as cover only after it has been made to fail (`tugutil file probe` with a reverse patch).

#### Success Criteria (Measurable) {#success-criteria}

- ⇧⌘O opens an app-modal Open Quickly: a click on any surface beneath the overlay activates nothing beneath it (at0213 asserts the deck state is unchanged after an outside click, and that the click dismissed the dialog).
- Typing works from the first keystroke; ↓ on an **empty** query selects the first result (at0396 test 1, unchanged in spirit).
- The directory-switcher popup (`data-testid="open-quickly-switcher-menu"`) no longer exists anywhere in the tree; a `TugFileChooser` row sits above the input (at0306 rewritten).
- Settling a directory in the chooser re-scopes the search: results come from the new root (at0306 asserts a file unique to the second directory appears after the switch).
- ⌥⇥ inside the dialog engages KBF mode and rings a stop **inside the dialog**, never the card behind it; ⌥⇥ again from a parked stop disengages; dismissing the dialog after a ⌥⇥ pressed inside it leaves no ring on the deck (at0396 test 3, resurrected and made to fail first).
- `tug-completion-popup.tsx` / `.css` are deleted; `bunx vite build` and `just app-test-covers-check` pass afterward.
- The onBlur/dismissGuard/backdrop-mousedown dismissal code has no successor in the new component — dismissal is exactly: Escape ladder, ⌘., outside interaction (when opted in), app resign, commit.

#### Scope {#scope}

1. New `TugModalInputDialog` component + CSS + gallery card + registration.
2. Rewrite of `OpenQuicklyBody` in `open-quickly-overlay.tsx` onto the primitive, with the `TugFileChooser` scope row.
3. Retirement of the directory-switcher accessory and all its plumbing (`switcherLabels`, `rootCandidates` menu shaping, `dismissGuard`, `SWITCHER_MENU`).
4. KBF adoption: ⌥⇥ engages over the dialog's stops; manual-bit hygiene at close.
5. App-test rewrites (at0213, at0306, at0396) and `@covers` sweep; deletion of `tug-completion-popup.tsx`/`.css` and the `switcher-labels` unit test.
6. Doctrine updates: `tuglaws/focus-language.md` references to `TugCompletionPopup` as the typing-first carve-out.

#### Non-goals (Explicitly out of scope) {#non-goals}

- No change to the file-match mechanism: `FeedStore(FILETREE)` + `FileTreeStore` + `getFileCompletionProvider` + `parseFileLocationQuery` + `openFileInCard` are carried over as-is.
- No change to `open-quickly-store.ts` or the `open-quickly` action dispatch in `deck-canvas.tsx`.
- No arrow-key spatial order inside the dialog (TugAlert's `AlertSpatialOrder` pattern): the Tab walk plus the attached-list arrows are the whole keyboard story; a spatial ring over three stops adds nothing.
- No promise-returning imperative handle (TugAlert's `alert()`/`choose()`): Open Quickly's open state lives in its store; the primitive is declarative (`open` prop / mount-while-open).
- No general watchdog portal exemption (`roadmap/kbf-mode-continued-brief.md#brief-open-quickly` names it): retiring the portalled switcher removes the bleeding case from this surface; the general fix is separate work.
- No changes to the composer's `@`-completion menu (`TugComboBox` / completion-menu machinery) beyond `@covers` corrections.

#### Dependencies / Prerequisites {#dependencies}

- Commit `1e86cd245` (⌥⇥ acts on the focus mode that owns the keyboard) — landed; the registry-routed `cycle-focus-mode` behavior is what [P03] builds on.
- Commit `2d8117575` (paint stands down while a caret is granted) and `fd7e49145` (chord-ring resolution) — the route-keyed paint the seeded field relies on.
- Commit `b31e33dd7` (trap-exit clears manual bit for engaging traps) — the rule [P04] extends to this typing-first trap at the component level.
- `TugFileChooser` / `TugComboBox` with the attached-list declaration from `c6ef67aba` (combo-box arrows fixed) — landed.

#### Constraints {#constraints}

- Tuglaws: [L01] one render root, [L02] external state via `useSyncExternalStore`, [L03] `useLayoutEffect` for registrations, [L06] appearance via CSS+DOM, [L19] component authoring (`data-slot`, tokens), [L25] canvas-overlay portal, [L29] path canonicalization is the server's answer. Cross-check `tuglaws/tuglaws.md`, `tuglaws/focus-language.md`, `tuglaws/component-authoring.md` before coding; name the laws in commit messages.
- `-D warnings` across the Rust workspace is irrelevant here, but `bunx vite build` must pass before any tugdeck step is declared done (debug app loads the prod rollup bundle).
- App-tests run via `just app-test <files…>` / `just app-test-changed`, output never piped.
- Persistent state (none new here) would go through tugbank, never Web storage.
- No `Task` sub-agents were used to author this plan; implementation follows the tugplug `implement` flow.

#### Assumptions {#assumptions}

- `TugComboBox` portals its dropdown into the canvas overlay root (`createPortal` + `useCanvasOverlay` in `tug-combo-box.tsx`) — verified by inspection. This is why [Q01] exists: that dropdown is a sibling of the Radix `Dialog.Content` in the overlay root, not a descendant.
- The engine's manual-bit API on `FocusManager` — `kbfManual(): boolean`, `setKbfManual(value: boolean)`, `toggleKbfManual()` — is sufficient for [P04]; no engine change is needed.
- at0051/at0103/at0176 carry `@covers tugdeck/src/components/tugways/tug-completion-popup.tsx` lines that are stale (those tests drive the composer's completion menu, not this component); they will be removed, not repointed, after verifying each test never mounts Open Quickly.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Radix modal semantics vs. the chooser's portalled dropdown (OPEN → resolve in step 1) {#q01-radix-portal-dropdown}

**Question:** With `Dialog.Root` modal (TugAlert's configuration), the `TugFileChooser`'s completion dropdown portals into the canvas overlay root **outside** `Dialog.Content`. Does Radix's modal treatment (outside `aria-hidden`/inert, `onInteractOutside`) block or mis-route pointer/focus interaction with that dropdown, and does a click in the dropdown fire `onInteractOutside` (which [P05] wires to dismiss)?

**Why it matters:** If unhandled, picking a completion row in the chooser would either be dead (inert) or dismiss the whole dialog (outside-interaction), i.e. the marquee new UI element would not work with the mouse.

**Options (if known):**
- Guard `onInteractOutside`: inspect the event target and prevent dismissal when it is inside the chooser's overlay `<ul>` (identified by the `overlaySlot` data-slot the dialog passes, [P10]). Keep Radix modal.
- `modal={false}` on `Dialog.Root` plus our own full-block overlay div (the primitive already renders `.tug-modal-input-dialog-overlay`); outside dismissal then rides the overlay's own `onMouseDown`, which never fires for the portalled dropdown because the dropdown stacks above it.

**Plan to resolve:** Step 1 builds the gallery card with a `TugFileChooser` in the header slot; probe both interactions (dropdown click-through; outside click) in the real app via the gallery before step 3 builds on it.

**Resolution:** OPEN — resolved by the step 1 checkpoint; the chosen mechanism is recorded in the step's commit. Start with the guard option; fall back to `modal={false}` if Radix's inert treatment blocks the dropdown at all.

#### [Q02] Seed items for the chooser: candidate shaping (DECIDED — see [P07]) {#q02-seed-shaping}

**Question:** Whether the switcher's candidate machinery (`rootCandidates`, `probeDirs` existence/canonicality filtering, `switcherLabels` disambiguation) survives into the chooser's seed.

**Resolution:** DECIDED (see [P07]): the candidate *list* survives (binding → default → recents, deduped, capped at 7, probe-filtered per [L29]); the *label* machinery (`switcherLabels`) dies — the chooser shows full paths like the session picker's recents, so leaf-name disambiguation is moot.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Radix modal blocks the portalled chooser dropdown ([Q01]) | high | med | Step 1 gallery probe before Open Quickly builds on it; two fallback mechanisms specified | Dropdown rows unclickable or dialog dismisses on row click |
| Rewritten at0396 passes without discriminating (the standing `1e86cd245` lesson) | high | med | Every new assertion is probe-verified red first (`tugutil file probe` with a reverse patch); fixture binds a session card so the behind-the-dialog tier exists | A green run on a patched-out gate |
| Manual bit stranded after ⌥⇥ inside the dialog | med | high without [P04] | [P04] component-level clear at close; asserted in at0396 test 3 | Ring visible on deck after dismissing the dialog |
| A typed scope path that does not exist | low | med | [P07]: re-scope only on settle, after `probeDirs` confirms existence and canonicalizes; a failed probe leaves the scope unchanged | Empty results after typing a bogus path |

**Risk R01: Radix inert/outside-interaction vs. portalled dropdown** {#r01-radix-inert}

- **Risk:** The chooser's dropdown, portalled outside `Dialog.Content`, is unreachable or dismissal-triggering under Radix modal semantics.
- **Mitigation:** [Q01]'s two mechanisms, probed in the gallery in step 1 before adoption.
- **Residual risk:** Future Radix upgrades change inert handling; the gallery card keeps the probe surface alive.

**Risk R02: coverage that does not discriminate** {#r02-nondiscriminating-tests}

- **Risk:** at0396's third test was committed green while proving nothing (unbound fixture card). A rewrite can repeat this.
- **Mitigation:** The fixture binds a session card (`bindSession` + `awaitEngineReady`, already written in at0396); each behavioral assertion is shown red under a reverse patch before the step closes.
- **Residual risk:** Probe discipline is manual; the checkpoint lists the probes explicitly so `implement` runs them.

---

### Design Decisions {#design-decisions}

#### [P01] TugModalInputDialog borrows TugAlert's modality machinery (DECIDED) {#p01-borrow-alert-modality}

**Decision:** The primitive composes Radix `Dialog` from `@radix-ui/react-dialog` (not `AlertDialog` — same force-focus reasoning documented at the top of `tug-alert.tsx`), portalled into the canvas overlay root via `useCanvasOverlay()` [L25], with a blocking overlay element, `useFocusTrap({ active, deferDomFocusToTeardown: true, onEscapeDismiss, kbf: false })`, Radix `onOpenAutoFocus`/`onEscapeKeyDown` both prevented, `onCloseAutoFocus` wired to the trap's writer, an in-jail `<div data-tug-key-sink tabIndex={-1} className="tug-key-sink" />` rendered first inside `FocusModeScope`, and ⌘. handled via `isCancelChordEvent` from `keymap-registry.ts`.

**Rationale:**
- TugAlert is the proven app-modal exemplar; every one of those pieces exists because a failure taught it (the key-sink-inside-the-jail comment in `tug-alert.tsx` is the canonical example).
- The engine's Escape ladder must own Escape ([P01]/[P02] of focus-language) — the completion popup already worked this way; only the modality shell changes.

**Implications:**
- Tokens join the `tug-dialog.css` family as `--tugx-modal-input-*`; the component ships `tug-modal-input-dialog.tsx` + `tug-modal-input-dialog.css` in `tugdeck/src/components/tugways/`, exporting `TugModalInputDialog`.
- No Radix `AlertDialog.Action`/`Cancel` — the dialog has no button row; commit is Enter, dismiss is Escape/⌘./outside.

#### [P02] Typing-first at open (DECIDED) {#p02-typing-first}

**Decision:** The trap passes `kbf: false` and the primitive seeds the key view onto the input via `useSeedKeyView` — exactly the completion popup's configuration and the doctrine's typing-first carve-out (`tuglaws/focus-language.md`, "A typing-first trap passes `kbf: false`").

**Rationale:**
- Auto-engaging would hand ↑/↓ to the engine's ring and the field's own key handling would never run — the regression KBF mode was written for (at0396's module doc).

**Implications:**
- The dialog opens with a caret, no rings (the route-keyed paint from `2d8117575` guarantees the pair never coexists).
- The input wrapper carries `ATTACHED_LIST_ATTRIBUTE` from `focus-manager.ts` so ↑/↓ drive the result list from the field, empty query or not.

#### [P03] The dialog adopts the KBF mode design: ⌥⇥ engages over its own stops (DECIDED) {#p03-kbf-adoption}

**Decision:** ⌥⇥ inside the dialog engages KBF mode via the manual bit, acting on the dialog's trapped mode per the `1e86cd245` gate ("while a floating surface holds a trapped mode, the toggle applies to that mode and the ring seeds among its own stops"). The dialog's engine stops are: the HUD input (order 0), the chooser's path field, and the Browse… button — all authored into one focus group ([P10]). Engaged, the ring walks those stops (Tab/⇧Tab), the field parks when walked away from, ↑/↓ on the input still drive the attached result list, and Enter on the parked field claims the caret first (the at0141 semantics from `c6ef67aba`). ⌥⇥ again from a parked stop disengages; from a granted caret it re-engages (parks) per focus-language [P09].

**Rationale:**
- The user's direction: the component adopts the KBF mode design; ⌥⇥ enters the mode.
- No new mechanism is required — `toggleKbfManual` + the gate + the stops are all landed; the dialog's job is to *be* a well-formed trapped mode with stops worth ringing (an empty group never holds the keyboard).
- The parked ⌥⇥ test from `c6ef67aba` (test.todo in at0396) becomes provable on this surface: the old defect was the ring landing on the card behind the popup; the modal overlay plus the gate make "inside the dialog" assertable.

**Implications:**
- ⇧Tab from the HUD field no longer dead-ends in a park with nowhere useful to go — the walk lands on the chooser's path field, another typing surface.
- at0396 test 3 is resurrected against this surface and probe-verified (Risk R02).

#### [P04] Manual-bit hygiene at close (DECIDED) {#p04-manual-bit-hygiene}

**Decision:** The primitive captures `focusManager.kbfManual()` when its trap goes active; at deactivate/unmount, if the bit is set **and was not set at open**, it calls `setKbfManual(false)`.

**Rationale:**
- `popFocusMode` clears the manual bit only for engaging traps (`trapped && kbf !== false` — the guard in `focus-manager.ts`, doctrine row "An engaging trap is left" in `tuglaws/focus-language.md#kbf-disengages`); a `kbf: false` trap "manages its own bit". Without this, ⌥⇥ pressed inside the dialog strands a ring on the deck the user returns to.
- A bit that was already on before open belongs to the user's deck-level mode and must survive the dialog.

**Implications:**
- Implemented inside `TugModalInputDialog` (a `useLayoutEffect` paired with the trap's `active`), so every future consumer inherits the hygiene.
- Asserted by at0396 test 3's final clause (no ring after dismiss).

#### [P05] Outside interaction dismisses, opt-in; the overlay always blocks (DECIDED) {#p05-outside-click}

**Decision:** The primitive takes `dismissOnOutsideClick?: boolean` (default `false`, the alert-like strict posture). When `true`, an outside interaction dismisses (`onInteractOutside` → call `onDismiss`, subject to the [Q01] dropdown guard) — but the overlay still swallows the event, so nothing beneath activates. Open Quickly passes `true`.

**Rationale:**
- User decision: yes to outside-click dismiss for Open Quickly — it is a launcher, not an alert.
- A future strict consumer (a required input) gets TugAlert semantics by default.

**Implications:**
- at0213's outside-click test changes meaning: it must now also assert the click did **not** activate what it landed on (the old popup's backdrop click was already non-activating; the assertion becomes explicit).

#### [P06] The blur-dismiss apparatus is deleted; app-resign dismissal stays, consumer-level (DECIDED) {#p06-no-blur-dismiss}

**Decision:** The primitive has no `onBlur` dismissal, no `dismissGuard`, no backdrop `onMouseDown` handler. The app-going-inactive dismissal (via `getAppLifecycle().observeApplicationWillResignActive`) moves to `OpenQuicklyBody` — it is launcher semantics ("a transient act on the frontmost window"), not modal semantics.

**Rationale:**
- Real modality means focus cannot wander; the exemption list existed to approximate that and is obsolete with a blocking overlay + Radix focus jail + in-jail key sink.
- An alert must survive an app switch; a launcher should not. The split belongs at the consumer.

**Implications:**
- The three-exemption `onBlur`, the `dismissGuard` prop and its `SWITCHER_MENU` querySelector predicate are deleted with no successor.

#### [P07] A bare TugFileChooser above the input replaces the directory switcher (DECIDED) {#p07-chooser-replaces-switcher}

**Decision:** The dialog's header slot holds a bare `TugFileChooser` (no label row — user decision), `kind="directory"`, `menuMode`, Browse… kept (`showBrowse` default, `browseFocusOrder` authored), full-width above the HUD input. Its controlled `value` is the active scope path; its `seed` is built from the switcher's candidate list (frontmost binding → default project path → `readSessionRecentProjects`, deduped, capped at `MAX_ROOT_CANDIDATES = 7`, probe-filtered by `probeDirs` for existence + canonical dedup per [L29]) rendered as full paths with match highlighting, in the shape of the session picker's `buildRecentsSeed` (`session-card.tsx`) minus the trash affordance. Re-scoping happens **only on settle** (`onSettle`, per the `TugComboBox` settle contract, honoring the no-resting-lies rule): the settled path is probed via `probeDirs`; if it exists, its canonical form becomes `pickedPath` and the workspace re-acquires exactly as today (`acquireDefaultWorkspace` / `acquireWorkspace` effect in `open-quickly-overlay.tsx`); if not, the scope is unchanged and the field text stands as typed.

**Rationale:**
- User decisions: retire the switcher in full; bring in the three-part chooser; place it above; bare, keep Browse.
- Settle-only re-scoping keeps keystrokes from thrashing the FILETREE feed and keeps a half-typed path from becoming a scope.
- `switcherLabels` disambiguation is moot on full paths; the function and its unit test (`src/__tests__/switcher-labels.test.ts`) retire with the switcher.

**Implications:**
- `leafName` survives (the placeholder still reads "Open Quickly in <leaf>"); `switcherLabels`, the `TugPopupButton` accessory, `useResponderForm`'s `SELECT_VALUE` wiring, and `SWITCHER_MENU` are deleted.
- The `probeDirs` candidate-filter effect keyed on `defaultPath` survives, now feeding the seed instead of the menu.

#### [P08] The completion internals fold into the primitive; TugCompletionPopup retires (DECIDED) {#p08-fold-and-retire}

**Decision:** `TugModalInputDialog` owns the completion field + result list directly: props `provider: CompletionProvider`, `onCommit(item)`, `onDismiss()`, `placeholder`, `emptyLabel?: () => string | null`, plus `header?: ReactNode` and `dismissOnOutsideClick`. The `renderLabel` match-run renderer, the pull/subscribe provider loop, the selected-row state and scroll-into-view, and the row mouse handling migrate from `tug-completion-popup.tsx` with new class/slot names. `TugCompletionPopup` and its CSS are deleted once Open Quickly is moved; no shared `TugCompletionField` extraction until a second consumer exists.

**Rationale:**
- Open Quickly is the sole consumer (verified: the only other `TugCompletionPopup` reference is a doc comment in `use-focus-trap.tsx`).
- A generic-slots primitive with a separate field component is speculative structure; fold-in is reversible when a second consumer motivates the split.

**Implications:**
- Exported constants become `MODAL_INPUT_DIALOG_FOCUS_GROUP` / field order 0; the `accessory` prop does **not** carry over (the header slot replaces its one use).
- The `use-focus-trap.tsx` doc comment naming `TugCompletionPopup` updates to name `TugModalInputDialog`.

#### [P09] Settling the chooser returns the key view to the HUD input (DECIDED) {#p09-settle-returns-focus}

**Decision:** After a successful re-scope (settle → probe ok → workspace swap), `OpenQuicklyBody` re-seeds the key view onto the HUD input (engine placement via the focus-key, the `useSeedKeyView`/`place` vocabulary — never a raw `.focus()`).

**Rationale:**
- The user's next act after choosing a scope is typing a filename; leaving the keyboard in the chooser makes every scope change cost a Tab walk back.
- The Browse… path settles the same way (`TugFileChooser`'s `browse` calls `onSettle` directly), so the native panel round-trip also lands back in the input.

**Implications:**
- The seed is a placement, so it grants the caret (focus-language [P12]); if KBF was manually engaged, the paint stands down while the caret is live — correct and already doctrine.

#### [P10] Naming, slots, and focus orders (DECIDED) {#p10-naming-orders}

**Decision:** Component `TugModalInputDialog` in `tug-modal-input-dialog.tsx`/`.css` [L19]. Slots: `tug-modal-input-dialog-overlay`, `tug-modal-input-dialog` (panel, `role="dialog"`), `-header`, `-field`, `-input`, `-list`, `-row`, `-empty`, `-match`. Focus group `MODAL_INPUT_DIALOG_FOCUS_GROUP = "tug-modal-input-dialog"`; orders: HUD input `0`, chooser path field `1`, Browse `2` (Open Quickly passes `focusGroup`/`focusOrder`/`browseFocusOrder` into `TugFileChooser`, which already supports all three). The chooser's `overlaySlot` is set to `tug-modal-input-dialog-chooser-overlay` (also the [Q01] guard's selector). CSS carries the HUD look over from `tug-completion-popup.css` (175 lines) with renamed selectors; overlay/backdrop styling aligns with `tug-alert.css`'s overlay treatment.

**Rationale:**
- Tab from the seeded input goes visually "up" to the chooser and wraps — the walk order matches the read order with the input first because the input is the surface's home.

**Implications:**
- All app-test selectors change; the test steps enumerate the new ones.

---

### Deep Dives {#deep-dives}

#### What the current code does, for the cold reader {#current-code-map}

- **Store/mount:** `tugdeck/src/lib/open-quickly-store.ts` (module singleton, `openOpenQuickly`/`closeOpenQuickly`/`subscribeOpenQuickly`/`getOpenQuicklyOpen`); `OpenQuicklyOverlay` rendered in `deck-canvas.tsx`, which reads the store via `useSyncExternalStore` and mounts `OpenQuicklyBody` only while open (the search stack's lifetime is the popup's). None of this changes.
- **Search stack (carried over verbatim):** `OpenQuicklyBody` captures the frontmost binding once (`frontmostProjectRoot` → `bindingRef`), resolves the default project path (`useTugbankValue` of `DEFAULT_PROJECT_PATH_DOMAIN`/`KEY` + `resolveProjectPathFrom` + `useHostFacts`), computes `activePath = pickedPath ?? binding ?? default`, acquires non-binding workspaces (`acquireDefaultWorkspace`/`acquireWorkspace` + `subscribeWorkspaces`/`getWorkspace`), rebuilds a `FeedStore(FeedId.FILETREE)` + `FileTreeStore` keyed on `workspaceKey` (disposing the previous), wraps the provider with `parseFileLocationQuery` (splitting `:line`, relativizing absolute paths, stashing `lineRef`), and commits through `openFileInCard(store, resolveAgainstRoot(projectDir, relative), lineRef.current)` then `closeOpenQuickly()`. The `emptyLabel` callback reads `fileTreeStore.hasResponded()` to distinguish "still thinking" from "no files".
- **What retires:** the switcher accessory (a `TugPopupButton` in a `ResponderScope` from `useResponderForm` with a `SELECT_VALUE` handler setting `pickedPath`; menu items from `rootCandidates` + `switcherLabels`; rendered only when `candidates.length > 1`), the `dismissGuard` querySelector on `SWITCHER_MENU`, and in the popup component: the three-exemption `onBlur`, the backdrop `onMouseDown`, the `accessory`/`dismissGuard` props.
- **TugAlert modality parts to copy (all in `tug-alert.tsx`):** the `import * as AlertDialog from "@radix-ui/react-dialog"` alias trick with the explanatory comment; `useFocusTrap({ active: open, deferDomFocusToTeardown: true, onEscapeDismiss })`; `Dialog.Portal container={overlayRoot}`; `Overlay` + `Content` with `onInteractOutside`, `onOpenAutoFocus={e => e.preventDefault()}` (the engine seeds instead), `onEscapeKeyDown={e => e.preventDefault()}`, `onCloseAutoFocus={onCloseAutoFocus}`, `onKeyDown` with `isCancelChordEvent`; the in-jail key-sink div with its ([P13]) comment rationale. The dialog seeds via `useSeedKeyView(`${MODAL_INPUT_DIALOG_FOCUS_GROUP}:0`)` (the completion popup's mechanism), not TugAlert's `place()`-on-open — the input is a text stop, so the seed grants a caret.
- **KBF plumbing the dialog leans on (no changes):** `FocusManager.kbfEngaged()` derives from four inputs; the manual bit API is `kbfManual()`/`setKbfManual()`/`toggleKbfManual()`; the `cycle-focus-mode` command is registry-routed and applies to the top trapped mode; `popFocusMode` clears the manual bit only for `trapped && kbf !== false` entries; paint is route-keyed (`kbfPainting()`), so caret and rings never coexist.

#### Dismissal inventory, before and after {#dismissal-inventory}

| Path | Old popup | New dialog |
|------|-----------|------------|
| Escape | engine ladder via trap `onEscapeDismiss` | unchanged |
| ⌘. | none | `isCancelChordEvent` → dismiss (new, from TugAlert) |
| Outside click | backdrop `onMouseDown`, guarded by `dismissGuard` | `onInteractOutside` → dismiss when `dismissOnOutsideClick` ([P05]), guarded per [Q01]; overlay always blocks |
| Focus leaves | field `onBlur` with three exemptions | **deleted** ([P06]) |
| App resigns active | popup-level lifecycle observer | consumer-level in `OpenQuicklyBody` ([P06]) |
| Commit | `onCommit` → caller closes | unchanged |

---

### Specification {#specification}

**Spec S01: TugModalInputDialog public API** {#s01-component-api}

```tsx
export const MODAL_INPUT_DIALOG_FOCUS_GROUP = "tug-modal-input-dialog";
export const MODAL_INPUT_DIALOG_FIELD_ORDER = 0;

export interface TugModalInputDialogProps {
  /** Accessible name + empty-field placeholder. */
  placeholder?: string;
  /** Completion source: (query) => items, optional subscribe. */
  provider: CompletionProvider;
  /** Return on the highlight / row click. */
  onCommit: (item: CompletionItem) => void;
  /** Escape ladder, ⌘., outside interaction (when enabled). */
  onDismiss: () => void;
  /** Rendered above the HUD input, inside the trap/jail — Open Quickly's chooser row. */
  header?: React.ReactNode;
  /** Empty-list message; null = still thinking, render nothing. */
  emptyLabel?: () => string | null;
  /** Launcher posture: outside interaction dismisses. Default false (alert posture). */
  dismissOnOutsideClick?: boolean;
}
```

Mount-while-open like the popup (the component renders `active: true` traps unconditionally; the consumer mounts it only while open). Header-slot controls join the dialog's Tab walk by authoring into `MODAL_INPUT_DIALOG_FOCUS_GROUP` at orders > 0 — the same contract the old `accessory` documented.

**Table T01: engine stops in the Open Quickly dialog** {#t01-focus-orders}

| Stop | Order | Kind | On arrival (KBF engaged) |
|------|-------|------|--------------------------|
| HUD input | 0 | text (attached list) | parks (ring, no caret); Enter claims caret; ↑/↓ drive result list |
| Chooser path field | 1 | text (combo, attached list) | parks; typing after Enter-claim; ↓ opens the seed menu |
| Browse… button | 2 | engine-routed leaf | ring; Return/Space opens `NSOpenPanel` |

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone (appearance / local-data / structure) | Mechanism | Law |
|-------|--------------------------------------------|-----------|-----|
| open/closed | structure | existing `open-quickly-store` + `useSyncExternalStore` (unchanged) | [L02] |
| query, items, selected row | local-data | `useState` inside the dialog (migrated as-is) | — |
| scope path (`pickedPath`), chooser text | local-data | `useState` in `OpenQuicklyBody` | — |
| FeedStore/FileTreeStore stack | local-data (imperative) | `useRef` + dispose-on-swap (migrated as-is) | [L22]-style observation |
| KBF engagement, manual bit, key view, route | structure (engine) | `FocusManager` only — never mirrored in React state | [L22], focus-language |
| ring/caret paint | appearance | engine projection → `data-kbf`/`data-key-view-kbd` + CSS | [L06] |
| selected-row highlight | appearance | `data-selected` attribute + CSS (migrated as-is) | [L06] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/tug-modal-input-dialog.tsx` | The primitive |
| `tugdeck/src/components/tugways/tug-modal-input-dialog.css` | Its styles (HUD look from `tug-completion-popup.css`, overlay from `tug-alert.css` patterns) |
| `tugdeck/src/components/tugways/cards/gallery-modal-input-dialog.tsx` | Gallery card (static provider; a `TugFileChooser` in the header to keep the [Q01] probe surface alive) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TugModalInputDialog` | component | `tug-modal-input-dialog.tsx` | Spec S01 |
| `MODAL_INPUT_DIALOG_FOCUS_GROUP` / `MODAL_INPUT_DIALOG_FIELD_ORDER` | consts | `tug-modal-input-dialog.tsx` | successors of `COMPLETION_POPUP_*` |
| `OpenQuicklyBody` | rewrite | `open-quickly-overlay.tsx` | chooser header, settle→probe→re-scope, resign observer, [P09] re-seed |
| `switcherLabels`, `rootCandidates` (menu shaping), `SWITCHER_MENU` | delete/absorb | `open-quickly-overlay.tsx` | candidate list logic survives into the seed builder ([P07]) |
| `registerGalleryCards` | modify | `cards/gallery-registrations.tsx` | add `gallery-modal-input-dialog` |
| `TugCompletionPopup` + CSS | delete | `tugways/` | step 6 |
| `src/__tests__/switcher-labels.test.ts` | delete | tugdeck unit tests | dies with `switcherLabels` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **App-test (real app)** | Drive Tug.app through the real dispatch/focus/render paths | All behavior here: modality, dismissal, KBF, re-scoping |
| **Probe (reverse patch)** | Prove an assertion discriminates | Every new at0396 assertion; the [P04] bit-clear |
| **Unit** | Pure functions | None new; `switcher-labels.test.ts` is deleted, not replaced |

#### What stays out of tests {#test-non-goals}

- jsdom/mock render tests of the dialog — banned pattern; the real app is cheap to drive.
- The native `NSOpenPanel` round-trip — not automatable headlessly; Browse's focus-stop behavior (ring, Return fires) is covered, the panel itself is not.
- FILETREE backend behavior — covered by existing at0306 plumbing and Rust-layer tests.

---

### Execution Steps {#execution-steps}

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Build TugModalInputDialog + gallery card; resolve [Q01] | pending | — |
| #step-2 | Move Open Quickly onto the primitive; chooser in, switcher out | pending | — |
| #step-3 | KBF adoption: ⌥⇥ over the dialog's stops; manual-bit hygiene | pending | — |
| #step-4 | Rewrite at0213 / at0306 / at0396 against the new surface | pending | — |
| #step-5 | Retire TugCompletionPopup; sweep `@covers`; update doctrine | pending | — |
| #step-6 | Integration checkpoint | pending | — |

#### Step 1: Build TugModalInputDialog + gallery card; resolve [Q01] {#step-1}

**Commit:** `tugways(modal-input-dialog): app-modal typing-first input primitive borrowing TugAlert modality [L19][L25]`

**References:** [P01] borrow alert modality, [P02] typing-first, [P05] outside-click prop, [P08] fold-in, [P10] naming/orders, [Q01] Radix portal dropdown, Spec S01, Risk R01, (#current-code-map, #dismissal-inventory)

**Artifacts:**
- `tug-modal-input-dialog.tsx` / `.css`, gallery card + registration.

**Tasks:**
- [ ] Create the component per Spec S01: Radix Dialog shell copied from `tug-alert.tsx` (portal container, overlay, prevented auto-focus/Escape, `onCloseAutoFocus`, in-jail key sink, ⌘. via `isCancelChordEvent`); field/list/provider internals migrated from `tug-completion-popup.tsx` (pull/subscribe loop, `renderLabel`, selected state + `scrollIntoView`, row `onMouseDown` preventDefault + click commit, `ATTACHED_LIST_ATTRIBUTE` on the field wrapper, `TugInput` with `focusGroup`/`focusOrder`, `useSeedKeyView`); trap `useFocusTrap({ active: true, deferDomFocusToTeardown: true, onEscapeDismiss: onDismiss, kbf: false })`. No `onBlur` dismissal, no backdrop mousedown handler, no `dismissGuard`, no app-lifecycle observer ([P06] puts that in the consumer).
- [ ] `dismissOnOutsideClick` wiring: `onInteractOutside` prevents by default; when the prop is set, dismiss — unless the event target is inside the chooser overlay slot ([Q01] guard, selector `[data-slot="tug-modal-input-dialog-chooser-overlay"]`).
- [ ] CSS: HUD panel/field/list/row/empty/match styles carried from `tug-completion-popup.css` under the new class names; overlay styled on the `tug-alert-overlay` pattern; tokens `--tugx-modal-input-*` declared in `tug-dialog.css`.
- [ ] Gallery card `gallery-modal-input-dialog.tsx` with a static in-memory provider and a `TugFileChooser` (menuMode, seed of a few fake paths, `overlaySlot="tug-modal-input-dialog-chooser-overlay"`, orders per Table T01) in the header; register in `gallery-registrations.tsx`.
- [ ] **[Q01] probe in the running app** (gallery card): (a) click a row in the chooser's portalled dropdown — the pick must land and the dialog must stay up; (b) click outside the panel — the dialog must dismiss and nothing beneath activates. If Radix's inert treatment blocks (a), switch to `modal={false}` + own-overlay blocking and re-probe; record the outcome in the commit message.

**Tests:**
- [ ] Manual gallery pass across themes (component-authoring checklist); behavioral coverage lands with at0213/at0396 in #step-4.

**Checkpoint:**
- [ ] `cd tugdeck && bunx vite build`
- [ ] [Q01] probe results recorded (both interactions correct in the gallery card, in the app)

---

#### Step 2: Move Open Quickly onto the primitive; chooser in, switcher out {#step-2}

**Depends on:** #step-1

**Commit:** `tugways(open-quickly): rebuild on TugModalInputDialog; TugFileChooser scope row replaces the directory switcher [L02][L06][L29]`

**References:** [P05] outside-click, [P06] consumer-level resign dismiss, [P07] chooser replaces switcher, [P09] settle returns focus, [Q02] seed shaping, Table T01, (#current-code-map, #t01-focus-orders)

**Artifacts:**
- Rewritten `OpenQuicklyBody`; deleted switcher plumbing.

**Tasks:**
- [ ] Replace the `TugCompletionPopup` render with `TugModalInputDialog` (`provider`, `onCommit` = existing `commit`, `onDismiss` = `closeOpenQuickly`, `placeholder` = existing leaf-name form, `emptyLabel` unchanged, `dismissOnOutsideClick`).
- [ ] Header: `TugFileChooser` with `value` = chooser text state (initialized to `activePath`), `base` = `activePath` (or `/`), `kind="directory"`, `menuMode`, `seed` = candidate seed built per [P07] (candidate list from the existing `rootCandidates` + `probeDirs` effect; full-path labels with match highlighting modeled on `buildRecentsSeed` in `session-card.tsx`, no trash affordance), `overlaySlot="tug-modal-input-dialog-chooser-overlay"`, `focusGroup={MODAL_INPUT_DIALOG_FOCUS_GROUP}`, `focusOrder={1}`, `browseFocusOrder={2}`.
- [ ] `onSettle`: probe the settled path via `probeDirs`; on exists, set `pickedPath` to the canonical form (workspace re-acquire effect is already keyed on `activePath`) and re-seed the key view onto the HUD input ([P09]); on missing, leave scope unchanged.
- [ ] Add the app-resign dismissal observer to `OpenQuicklyBody` ([P06]) — the code moves verbatim from the old popup.
- [ ] Delete: the switcher JSX, `useResponderForm`/`ResponderScope` wiring, `switcherLabels`, `SWITCHER_MENU`, `dismissGuard`, the `candidates.length > 1` gate (the chooser always renders).
- [ ] Verify `⇧⌘O` end-to-end in the running app: open, type, commit, re-scope via chooser typing, via seed menu pick, via Browse.

**Tests:**
- [ ] Covered in #step-4; this step's checkpoint is build + live verification.

**Checkpoint:**
- [ ] `cd tugdeck && bunx vite build`
- [ ] Live app: all three re-scope paths work and land the caret back in the HUD input

---

#### Step 3: KBF adoption: ⌥⇥ over the dialog's stops; manual-bit hygiene {#step-3}

**Depends on:** #step-2

**Commit:** `tugways(modal-input-dialog): dialog adopts KBF mode — ⌥⇥ engages over its own stops, bit cleared at close [focus-language P09/P12]`

**References:** [P03] KBF adoption, [P04] manual-bit hygiene, Table T01, Risk R02, (#p03-kbf-adoption, #p04-manual-bit-hygiene)

**Artifacts:**
- The [P04] capture/clear effect in `TugModalInputDialog`; any fixes the live walk exposes.

**Tasks:**
- [ ] Implement [P04]: capture `kbfManual()` at trap activation (the `FocusManagerContext` manager is already in scope via the trap's imports); on deactivate, clear the bit iff set-now and not-set-at-open.
- [ ] Walk the whole vocabulary in the live app with a **bound session card behind the dialog** (the `1e86cd245` failure fixture): ⌥⇥ engages and rings inside the dialog (never the card behind); Tab/⇧Tab walk input → chooser → Browse; parked input: ↑/↓ drive the results (attached list), Enter claims the caret; ⌥⇥ from a parked stop disengages; Escape dismisses from any stop; after ⌥⇥-then-Escape, no ring anywhere on the deck.
- [ ] Fix what the walk exposes; diagnose in the app first (`/api/eval` on the live instance) per the brief's proof discipline.

**Tests:**
- [ ] Assertions land in at0396 (#step-4); this step proves the behavior live.

**Checkpoint:**
- [ ] `cd tugdeck && bunx vite build`
- [ ] The live walk above passes end to end, on a deck with a bound session card

---

#### Step 4: Rewrite at0213 / at0306 / at0396 against the new surface {#step-4}

**Depends on:** #step-3

**Commit:** `tugways(open-quickly): app-tests cover the modal dialog — dismissal, chooser re-scope, KBF adoption`

**References:** [P03] KBF adoption, [P04] bit hygiene, [P05] outside-click, [P07] chooser, Risk R02, Table T01, (#success-criteria, #test-non-goals)

**Artifacts:**
- Updated `tests/app-test/at0213-open-quickly.test.ts`, `at0306-open-quickly-default-dir.test.ts`, `at0396-open-quickly-arrows.test.ts`.

**Tasks:**
- [ ] New selectors throughout: panel `[data-slot="tug-modal-input-dialog"]`, input `.tug-modal-input-dialog-input`, rows via `[data-slot="tug-modal-input-dialog-list"]`, chooser via its slot ([P10]).
- [ ] at0213: open/typing/commit unchanged in spirit; Escape dismisses; outside click dismisses **and** the surface beneath did not activate; add ⌘. dismissal.
- [ ] at0306: default-dir fallback unchanged; replace the switcher-menu interactions with chooser interactions — seed-menu pick re-scopes (a file unique to the second directory becomes findable), typed-path settle re-scopes, missing-path settle does not.
- [ ] at0396: test 1 (↓ on empty query selects first result) and test 2 (Tab reaches the chooser) rewritten; test 3 (the `c6ef67aba` test.todo) resurrected per [P03]: bound session card behind the dialog, ⌥⇥ rings inside (assert `data-key-view-kbd` within the panel and its absence on the card), ⌥⇥ again disengages, and after ⌥⇥ + Escape no `data-kbf` on `<html>`.
- [ ] Probe every new behavioral assertion red first (`tugutil file probe` with a reverse patch — e.g. patch out the [P04] clear and watch the no-ring-after-dismiss clause fail; patch out the [Q01] guard and watch the dropdown-click clause fail). Note each probe in the test header docblock.
- [ ] Update the three files' `@covers` lines to `tug-modal-input-dialog.tsx` (keeping `open-quickly-overlay.tsx` and friends).

**Tests:**
- [ ] The three files themselves.

**Checkpoint:**
- [ ] `just app-test tests/app-test/at0213-open-quickly.test.ts tests/app-test/at0306-open-quickly-default-dir.test.ts tests/app-test/at0396-open-quickly-arrows.test.ts`
- [ ] Each listed probe went red before the final green

---

#### Step 5: Retire TugCompletionPopup; sweep `@covers`; update doctrine {#step-5}

**Depends on:** #step-4

**Commit:** `tugways(completion-popup): retire TugCompletionPopup — TugModalInputDialog is the typing-first modal surface [focus-language updated]`

**References:** [P08] fold-and-retire, (#symbols, #assumptions)

**Artifacts:**
- Deleted `tug-completion-popup.tsx`/`.css`, `src/__tests__/switcher-labels.test.ts`; updated doctrine and `@covers` lines.

**Tasks:**
- [ ] Delete `tug-completion-popup.tsx` and `.css`; remove the `TugCompletionPopup` doc-comment reference in `use-focus-trap.tsx` (points at the new component now).
- [ ] Delete `src/__tests__/switcher-labels.test.ts` (its subject died in #step-2).
- [ ] `@covers` sweep: remove the `tug-completion-popup.tsx` lines from at0051/at0103/at0176 after confirming each never mounts Open Quickly (per #assumptions — if one genuinely exercises the surface, repoint it to `tug-modal-input-dialog.tsx` instead); at0052/at0053/at0054 checked the same way.
- [ ] Update `tuglaws/focus-language.md`: the typing-first carve-out row and the "next typing-first HUD" paragraph now name `TugModalInputDialog` (and its `kbf: false` site); the ⌥⇥-inside-a-trap behavior gains the dialog as its worked example. Re-run the doctrine's own grep audit (`setKbfManual|toggleKbfManual|clearKbfManualForPointer|kbfAtRest|kbf: false|hasEngagingTrap`) so every table row still names a real site — the [P04] clear is a new `setKbfManual` site the table must carry.
- [ ] Grep the repo for any remaining `tug-completion-popup` / `TugCompletionPopup` / `COMPLETION_POPUP_` references; zero must remain outside git history and this plan.

**Tests:**
- [ ] `just app-test-covers-check` (every `@covers` path resolves)

**Checkpoint:**
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test-covers-check`
- [ ] `command grep -rn "TugCompletionPopup\|tug-completion-popup" tugdeck/src tests/ tuglaws/` returns nothing

---

#### Step 6: Integration Checkpoint {#step-6}

**Depends on:** #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [P01]–[P10], (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Full derived selection over the working diff; confirm every success criterion in #success-criteria against the run and the live app.

**Tests:**
- [ ] `just app-test-changed` (selection derived from the diff via `@covers`; run bare, never piped)

**Checkpoint:**
- [ ] `just app-test-changed` — VERDICT green
- [ ] `cd tugdeck && bunx vite build`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Open Quickly is an app-modal `TugModalInputDialog` with a `TugFileChooser` scope row, adopting the KBF mode design; `TugCompletionPopup` and the directory-switcher popup no longer exist.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Every criterion in #success-criteria verified (at0213/at0306/at0396 green, probes noted red-first)
- [ ] `bunx vite build` and `just app-test-covers-check` pass with the old component deleted
- [ ] `tuglaws/focus-language.md` names the new component in the typing-first carve-out and its site tables pass their grep audit

**Acceptance tests:**
- [ ] at0213, at0306, at0396 (rewritten)
- [ ] `just app-test-changed` over the final diff

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] The general watchdog portal exemption (`deliverToEngineLeaf`'s rule for trapped surfaces' legitimate external focus) — Open Quickly stops being the bleeding case, but the debt noted in `roadmap/kbf-mode-continued-brief.md#brief-open-quickly` remains for other surfaces.
- [ ] A second `TugModalInputDialog` consumer motivating a `TugCompletionField` extraction ([P08]).
- [ ] Any ⌥⇥ Open Quickly spec follow-ons parked in `c6ef67aba` beyond what [P03] resurrects.

| Checkpoint | Verification |
|------------|--------------|
| Primitive proven standalone | Step 1 gallery probes + `bunx vite build` |
| Open Quickly on the primitive | Step 2 live walk of all three re-scope paths |
| KBF adopted | Step 3 live walk on a bound-card deck |
| Pinned | Step 4 three-file run, probes red-first |
| Retired clean | Step 5 covers-check + zero-reference grep |
| Whole | Step 6 `just app-test-changed` |
