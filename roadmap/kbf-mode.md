## Keyboard Focus Mode (KBF) {#kbf-mode}

**Purpose:** Replace the three ambient arrow-ownership mechanisms (the empty-input release, the boundary latch, and the emptiness-conditioned Tab/arrow handoffs) with one explicit, named, user-controlled mode — **KBF mode** — in which rings paint and the engine owns movement keys, while mode OFF gives text surfaces unconditional key ownership and paints no rings at all. Ships the derived mode bit, the parked text stop, the list-attached-field contract that fixes Open Quickly, and the corresponding doctrine and test surgery.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-08-10 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The arrow-traversal work (`53233fdc6`, archived at [roadmap/archive/arrow-traversal.md](archive/arrow-traversal.md)) made arrows move keyboard focus everywhere, but never gave the app a mode: whether an arrow moves a caret or a ring is recomputed on every keydown from ambient DOM state, and the most load-bearing input is whether the focused text field happens to be empty. The full diagnosis, the design, and every design question — all now DECIDED — are in [roadmap/kbf-mode-brief.md](kbf-mode-brief.md). The sharpest casualty is Open Quickly: on open (empty query, seeded key view), `resolveArrowRelease` returns `"released"`, the spatial move declines, and the liveliness net consumes ↓ before the popup's own `onKeyDown` (`tugdeck/src/components/tugways/tug-completion-popup.tsx`, the `onKeyDown` handler) ever runs — so ↓ either rings the directory switcher or does nothing, in exactly the state a fast open-quickly gesture passes through.

This plan implements the brief's design D1–D7 verbatim. The brief is the *why*; this document is the *how*, standalone: every file, symbol, and behavior an implementer needs is named here.

#### Strategy {#strategy}

- **Additive before subtractive.** Land the engine mode bit, its projection, and the list-attached-field contract first, while the old mechanisms still run — every intermediate commit leaves the app working.
- **The engine owns the bit** ([P01]): `manuallyEngaged` is a `FocusManager` boolean; auto-engagement is derived from surface presence (trap stack + key-card declaration + accessibility mode), never latched.
- **One projection, one CSS gate** ([P02]/[P04]): `data-kbf` on `<html>`, written by the same `applyProjection()` pass that writes `data-focus-mode`; every ring rule in `focus-ring.css` gains it as an ancestor gate.
- **Fix the exemption before deleting the release.** The list-attached-field contract ([P08]) replaces what the empty-input release was buying for filter fields, so it lands before `arrow-release.ts` dies.
- **Delete in one step** ([P06]): the release module, the boundary latch, the Tab/arrow handoffs, and `enterAt`/`enterToward` go together, because they are one compensation network — removing half leaves dead doors.
- **Doctrine moves in the same phase**: `tuglaws/focus-language.md` is rewritten, and at0345 inverts, in the steps that change the behavior they pin.

#### Success Criteria (Measurable) {#success-criteria}

- Open Quickly: with an empty query and ≥1 result, ↓ highlights the next result and ↑ the previous, from the first keystroke; typing then deleting back to empty does not change arrow behavior. (New app-test, #step-11.)
- Mode OFF: no element in the deck matches `[data-key-view-kbd]`-driven ring paint; a caret-holding editor keeps all four plain arrows regardless of content; two presses of ↑ at a document edge move nothing out of the editor. (Mode-division app-test.)
- Mode ON (⌥⇥): rings paint; Tab/⇧Tab and arrows move the ring; `Space` commits; a text stop is ringed with **no caret** until Return or a printable character grants one. (Parked-stop app-test.)
- One Escape closes a sheet while the caret is in a field inside it — no double-Escape regression. (Escape-ladder app-test.)
- `just hooks-test`-class checks: `cd tugdeck && bun test` green, `bunx vite build` clean, and the selective app-test run derived by `just app-test-changed` green at phase end.

#### Scope {#scope}

1. The derived KBF mode bit in the focus engine, its `data-kbf` projection, and the `kbf: false` trap flag.
2. Manual engagement (⌥⇥, Escape rung, pointerdown-clears, printable/Return grants on parked stops) and the promotion of `useCycleMode` mechanics to the general mechanism.
3. CSS: rings gated on `data-kbf`; `persistentDefaultRing` exempt.
4. The list-attached-field contract, adopted by every `TugFilterField` consumer and by Open Quickly.
5. Deletion of `arrow-release.ts`, the `data-tug-arrow-release` channel, the boundary latch, `onArrowExit`, `onTabWhenEmpty`, `enterAt`/`enterToward`, and the arrow repeat gating.
6. Class-A (trap-derived) and Class-B (per-card declared) auto-engagement, with accessibility mode permanently engaged.
7. Doctrine surgery on `tuglaws/focus-language.md` (+ a sweep of the other laws) and the app-test/unit-test rework.

#### Non-goals (Explicitly out of scope) {#non-goals}

- No changes to the spatial plane, `rowGridOrder`, seams, the liveliness net's *mechanics*, cursor handles, descended row scopes (`handleListKey`), `place()`, the gesture interpreter, or the projection/watchdog/steal-ledger machinery — all survive untouched per the brief's "What this deletes".
- No changes to accelerators, chords, menus (beyond the one new item), or the responder chain: ⌘F, ⌘S, ⌘., Escape-to-dismiss are identical in both modes. KBF governs movement, not commands.
- No deck-edge tint or status glyph for the mode cue — the rings are the cue (DECIDED in the brief, D5).
- No hunk navigation for the diff card (revisit only if it grows furniture; brief Q6).
- No reopening of the tabled focus-walk/ring chord subsystem (see memory: keyboard focus nav tabled) beyond what this brief's decisions require.

#### Dependencies / Prerequisites {#dependencies}

- [roadmap/kbf-mode-brief.md](kbf-mode-brief.md) — the decided design; this plan cites its D1–D7 and Q1–Q7 by those labels.
- `tuglaws/focus-language.md`, `tuglaws/tuglaws.md` ([L02][L03][L06][L22]), `tuglaws/list-view-usage.md`.
- The app-test harness (`just app-test-changed`, `@covers` declarations — see `tests/app-test/README.md`).

#### Constraints {#constraints}

- Rust-workspace warnings-are-errors does not apply here, but tugdeck must pass `bunx vite build` (the debug app loads the prod rollup bundle) and `bun test`.
- [L01]–[L06], [L22]: no second `root.render`, external state via `useSyncExternalStore` only, layout-effect registration, appearance via CSS+DOM, engine structure never mirrored into React state.
- No `localStorage`; any persisted preference rides tugbank defaults (none is planned — the mode bit is session-transient by design).
- App-tests: selective runs via `@covers`; never the full corpus.

#### Assumptions {#assumptions}

- The brief's auto-engagement inventory (verified by sweep 2026-08-10) is current; #step-2 re-verifies the trap call-site list before wiring the flag.
- `useFocusTrap`'s `trapped` default (`true`, no call site passes it explicitly) still holds — the `kbf` flag is a new orthogonal option, not a change to `trapped`.
- at0248/at0277/at0282 stay green with KBF force-engaged at test start; if they don't, the mode division has leaked into the descend machinery and that is a bug in the implementation, not the tests.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

All seven brief-level questions were resolved by the owner on 2026-08-10 and are recorded in the brief's closing section with groundings; this plan restates them as decisions [P07] (Tab in OFF, brief Q1), [P05] (persistence across activation, brief Q2), [P04] (persistentDefaultRing, brief Q3), [P09] (⌥⇥ in forced modes, brief Q4), [P10] (Jots/diff dispositions, brief Q5/Q6), and [P11] (menu discoverability, brief Q7). No open questions remain.

#### [Q01] Attached-list commit gesture (DECIDED per-site) {#q01-attached-list-commit}

**Question:** When ↑/↓ drive an attached list from a caret-holding field, what commits the cursored row?

**Resolution:** DECIDED — the field's existing commit gesture per site: Open Quickly's `Enter` commits the highlighted item (already in `tug-completion-popup.tsx`'s `onKeyDown`); a `TugFilterField` site keeps `Return` meaning what its delegate says today. The contract ([P08], Spec S02) carries only cursor movement; commit stays the surface's.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Parked-stop grant transitions (printable/Return/click) regress WebKit focus | high | med | idempotent grants ([R01]), IME gating, at-suite coverage | any watchdog steal ledger entry naming the entry shell |
| Escape ladder rung misordered | high | med | explicit rung spec (Spec S04) + escape-ladder app-test before ship | a sheet needing two Escapes |
| Ring-gate CSS misses a rule | med | med | grep sweep for `data-key-view-kbd`/`data-key-cursor`/`data-key-within` selectors in #step-4 | a ring painting in mode OFF |
| Future trap becomes a KBF surface unintentionally | med | high (by design) | `kbf: false` flag exists from day one ([P03]) | next typing-first HUD |

**Risk R01: The parked text stop is where the implementation risk lives** {#r01-parked-stop}

- **Risk:** Parking (ring, blurred editor, no DOM grant) was removed once because caret-less states bred illegal rings and focus drift; the transitions back *into* typing are `.focus()` grants and each must be idempotent and IME-safe.
- **Mitigation:** Parking itself performs **no** `.focus()` write (the engine parks the sink — no exposure to WebKit's blur-on-re-focus hazard, per focus-language "Grants are idempotent"). The printable-grant path fires only on `!event.isComposing`, no ⌘/⌃ modifiers, `event.key.length === 1`, and grants focus synchronously inside the capture keydown so the browser's own text insertion lands in the newly focused editor — no synthetic re-dispatch. Return rides the existing Return-descend grant.
- **Residual risk:** dead-key/IME edge sequences on the first character typed into a parked stop; covered by a manual pass with a non-Latin input source before phase close.

**Risk R02: Escape ladder precedence** {#r02-escape-ladder}

- **Risk:** The KBF-disengage rung landing above any dismissable surface makes Escape stop closing things — the most user-visible possible regression.
- **Mitigation:** The rung is specified as the *last* branch of the existing act-dispatch Escape ladder in `responder-chain-provider.tsx` (the branch list at its "single Escape ladder" comment): `onEscapeDismiss` surfaces first, non-trapped ascends, `escapeExits` cycles, and only then a bare `manuallyEngaged` clear. Covered by the escape-ladder app-test in #step-11.
- **Residual risk:** third-party (Radix) layers consuming Escape before the document ladder — unchanged from today.

**Risk R03: Mode OFF hides every ring some surface leaned on** {#r03-ring-dependents}

- **Risk:** A surface that used a resting ring to explain itself looks wrong in mode OFF.
- **Mitigation:** `persistentDefaultRing` / `data-default-ring` is exempt from the gate ([P04]) — it is a promise about Return, not a focus mark. The brief found every current site but two is a Class-A auto-engaging surface; the residuals (session entry's own `data-tug-entry-default` promotion, session-history view) get a visual check in #step-4.
- **Residual risk:** none identified beyond the visual check.

---

### Design Decisions {#design-decisions}

#### [P01] The mode bit lives on the FocusManager coordinator, derived, deck-global (DECIDED) {#p01-engine-bit}

**Decision:** `FocusManager` (the coordinator class in `tugdeck/src/components/tugways/focus-manager.ts`) gains a private `kbfManuallyEngaged: boolean` and a public derivation `kbfEngaged(): boolean` = `accessMode === "accessibility" || kbfManuallyEngaged || autoEngagingSurfaceActive()`. Consumers read it through the manager's existing `subscribe` channel (`useSyncExternalStore` in React, direct reads in the ladder).

**Rationale:**
- Brief D1: derived, not raw — a sheet closing can never strand the mode, because auto-engagement is implied by presence, never latched.
- Brief Class C: accessibility keyboard-access mode (`keyboardAccessStore.getMode() === "accessibility"`, already mirrored into the manager via `setKeyboardAccessMode` in `responder-chain-provider.tsx`) is **permanently engaged** — it belongs in the derivation itself, non-negotiable.
- [L02]/[L22]: engine structure, single source of truth, never mirrored in React state.

**Implications:**
- `autoEngagingSurfaceActive()` reads (a) the **active context's** focus-mode stack for any pushed entry whose `kbf !== false` (Class A — traps pushed on background cards do not engage), and (b) the key card's `CardRegistration.kbfAtRest === true` declaration (Class B).
- Every mutation path that can change the answer (mode push/pop, key-card change, manual toggle, access-mode change) already calls `reproject()`/notifies; the derivation makes those notifications carry the mode too.

#### [P02] Projection: one attribute, `data-kbf` on `<html>` (DECIDED) {#p02-projection}

**Decision:** `FocusManager.applyProjection()` (focus-manager.ts, the diff-then-write convergence pass that already writes `FOCUS_MODE_ATTRIBUTE` onto `document.documentElement`) gains a `data-kbf` write: present (empty value) when `kbfEngaged()`, absent otherwise. `FocusProjection` gains the corresponding boolean from `computeProjection()`.

**Rationale:** Brief D1 "Projection: one attribute", [L06] appearance via CSS+DOM; riding the existing pass keeps state-driven convergence (any reproject heals drift) and gives the watchdog the mark for free.

**Implications:** No component reads the mode in React for appearance; CSS selects `html[data-kbf] …`.

#### [P03] Auto-engagement is derived from the trap; `kbf: false` is the escape hatch (DECIDED) {#p03-trap-flag}

**Decision:** `pushFocusMode` options (focus-manager.ts) and `UseFocusTrapOptions` (`use-focus-trap.tsx`) gain `kbf?: boolean` (default engage). `TugCompletionPopup` (`tug-completion-popup.tsx`, its `useFocusTrap({ active: true, onEscapeDismiss })` call) passes `kbf: false` — the one exempt trap today.

**Rationale:** Brief Class A: any `useFocusTrap` push is the auto-engager, so the enumeration (TugSheet, TugAlert, TugPopover/TugConfirmPopover, TugContextMenu, TugEditorContextMenu, internal TugPopupMenu, session question/permission dialogs, app-test ask dialog, Settings chord capture) needs no per-surface list to maintain. The flag must exist from day one or the next typing-first HUD reproduces the Open Quickly bug exactly (brief Risk 4).

**Implications:** The Settings ▸ Keyboard chord capture stays an ordinary engaging trap; its armed capture must be able to record ⌥⇥ itself, which works because the chord-capture guard in `captureListener` (`chordCaptureState.isArmed()`) runs before any KBF gesture handling.

#### [P04] Ring CSS gates on `data-kbf`; `data-default-ring` is exempt (DECIDED) {#p04-css-gate}

**Decision:** In `tugdeck/styles/focus-ring.css`, the `[data-key-view-kbd]`, `[data-key-cursor]`, and `[data-key-within]` paint rules gain the `html[data-kbf]` ancestor gate. `[data-default-ring]` (the `persistentDefaultRing` treatment in `internal/tug-button.css`) does **not** — it paints in both modes (brief Q3: a promise about Return, not a focus position).

**Rationale:** Brief D2 ("No focus ring is painted anywhere" in OFF) + D3 (rings ⇔ engaged). Anchoring on `html` also preserves the specificity arithmetic the file's `html[data-app-active="false"]` comment documents.

**Implications:** Per-component suppressions (`outline: none` in item-group CSS) are unaffected — a gate that prevents paint composes with suppressions that prevent paint. The `[data-cycling="false"]` ring-suppression block in focus-ring.css is subsumed and deleted (#step-4); the `[data-cycling="true"]` submit-fill stand-down rules in `tug-prompt-entry.css`/`tug-entry-shell.css` are re-keyed in #step-3.

#### [P05] `manuallyEngaged` persists across card activation; pointerdown clears it (DECIDED) {#p05-persistence}

**Decision:** The bit is deck-global and survives keyboard-driven card switches (⌘L and friends). A document capture-phase `pointerdown` clears it — the existing mouse-exit rule in `use-cycle-mode.tsx` (its capture `pointerdown` listener) generalized to one provider-level listener. `CYCLE_FOCUS_MODE` keeps `routing: "key-card"` (the toggle still needs the key card to seed the ring), but the bit it flips is the engine's.

**Rationale:** Brief Q2 (persisting is the friendlier answer; pointerdown clears it anyway) and D5's table.

**Implications:** On key-card change while engaged, the engine seeds the new key card's ring (its commit-home / first-in-mode) so the mode never points at nothing.

#### [P06] The deletions land as one step, after the exemption exists (DECIDED) {#p06-deletions}

**Decision:** `arrow-release.ts` (module + `arrow-release.test.ts`), the `data-tug-arrow-release` channel and its CM6 producer (`projectRelease` / `resolveEditorRelease` / the `ViewPlugin` and latch state in `tug-text-editor/keymap.ts`), the boundary latch (`armedEdge`, `LATCH_EDGE`, `EXIT_DIRECTION`, the latch keydown branches), `onArrowExit` (keymap config + every host wire), `onTabWhenEmpty` and the empty-Tab rule, `enterAt`/`enterToward` in `use-cycle-mode.tsx`, and the arrow repeat gating in `arrowNavListener`/`arrowFallbackListener` are all deleted in #step-8, which depends on the attached-list contract (#step-6) landing first.

**Rationale:** Brief "What this deletes" — every one is compensation for the missing parked state; removing half leaves dead doors (a host handoff with no receiver, a release with no reader).

**Implications:** Host wiring to touch: `tug-text-editor.tsx`, `tug-message-editor.tsx`, `tug-prompt-entry.tsx`, `cards/session-card.tsx`, `tug-find-bar.tsx`, `lens-section-band.tsx`, `jots-card.tsx`, `cards/resume-sheet.tsx`, `chrome/session-question-dialog.tsx`, `session-history/session-history-view.tsx` (the grep set for `onArrowExit|onTabWhenEmpty|data-tug-arrow-release|filterFieldDidRequestAdvance` as of 2026-08-10). `keymap-arrow-history.test.ts` keeps its Cmd/Opt-history halves; latch cases are deleted.

#### [P07] Tab in mode OFF: the caret owns it; the nowhere state engages; the engine never yields Tab to WebKit (DECIDED) {#p07-tab-off}

**Decision:** With a live caret, Tab belongs to the text surface unconditionally (indent/completion — the empty-Tab handoff dies). In the *nowhere* state (active card, no caret — a diff card, transcript prose after a stray click), Tab engages KBF and takes one step. The native-Tab fallback in `focusWalkListener` (`responder-chain-provider.tsx` — today it yields when `advanceKeyViewFocus` returns `false`) is removed: a Tab the engine cannot spend is consumed, never handed to WebKit.

**Rationale:** Brief Q1 — symmetric with ⌥⇥, and the most-tried key always produces a visible landing; the never-fall-through corollary is explicit in the brief.

**Implications:** The "nowhere" predicate is: `kbfEngaged()` false AND `document.activeElement` is not a text surface (not contentEditable/INPUT/TEXTAREA) — i.e. the keyboard is neither in a text surface nor in the engine's mode. `data-tug-tab-consume` handling is unchanged for live carets.

#### [P08] The list-attached field: one declared contract, both modes (DECIDED) {#p08-attached-list}

**Decision:** A text field may declare an attached list. While the caret is in that field, ↑/↓ drive the attached list's cursor and never leave the field, in both modes, regardless of emptiness. Mechanically: the field's wrapper (the element whose inner `<input>` holds focus) carries `data-tug-attached-list`; the document ladder's arrow stages yield vertical arrows whenever `document.activeElement` is inside `[data-tug-attached-list]`; the field's own React `onKeyDown` drives the cursor. Spec S02 has the component API.

**Rationale:** Brief D7 — one rule fixes Open Quickly, covers every `TugFilterField`, and retires `filterFieldDidRequestAdvance` plus the automatic empty-input release.

**Implications:** `TugFilterFieldDelegate.filterFieldDidRequestAdvance` (declared in `tug-filter-field.tsx`) is replaced by cursor-driving methods at its five call sites ([P06] lists them). Open Quickly needs nothing beyond the attribute + `kbf: false` — it opens in mode OFF with the caret in the field, and its existing `onKeyDown` finally runs.

#### [P09] ⌥⇥ inside a forced (auto-engaged) mode returns the keyboard from a typing descend to the ring; it never disengages a forced mode (DECIDED) {#p09-alt-tab-forced}

**Decision:** When `kbfEngaged()` is true and the caret is live (typing descend, brief D6), ⌥⇥ re-engages manually and places the ring back at the stop it left. When the derivation is ON only because a surface forces it, ⌥⇥ never turns the mode off.

**Rationale:** Brief Q4 — the D6 re-engage gesture made uniform.

**Implications:** `toggle` semantics become: engaged-and-ring-live → clear manual (if the derivation then still holds, the keyboard goes to the typing descend's caret only if one exists — otherwise stays); caret-live → set manual + return to ring. The exact state table is Spec S04.

#### [P10] Class-B card dispositions (DECIDED) {#p10-class-b}

**Decision:** `CardRegistration` (`tugdeck/src/card-registry.ts`) gains `kbfAtRest?: boolean`. Auto-engage (true): Lens, Jots (list level; an open jot is a typing descend, Escape ascends to the jot's row — today's behavior, the editor already lives in a non-trapped descend scope with blur-commit in `jots-card.tsx`), Settings (+ its bodies), Keyboard, About, Gazette, Pulse, Devtools. OFF at rest (false/absent): Session, Text, File view, Diff (registers no focus stops today; the empty-group rule forbids engaging a surface with nothing to ring), Hello. Gallery cards follow their subject; `gallery-cycle-demo.tsx` becomes the KBF demo.

**Rationale:** Brief Class B table + Q5/Q6 resolutions.

**Implications:** The invariant to pin: **every engine-routed stop is reachable only in KBF mode; in mode OFF the keyboard is either in a text surface or nowhere** (brief D3).

#### [P11] Discoverability: a menu item with a decorative chord (DECIDED) {#p11-menu-item}

**Decision:** A "Keyboard Focus" View-menu item fires the toggle, with ⌥⇥ shown as display-only text — *not* registered as an AppKit key equivalent. Mechanically: `menuItemId: "view.keyboardFocus"` on the `CYCLE_FOCUS_MODE` entry in `command-registry.ts` **without** `menuEligible` on its chord (preserving the reason recorded in that entry's comment: a real key equivalent is scanned above every surface that wants a modified Tab, the Settings chord capture among them), plus a Swift-side `NSMenuItem` in `tugapp/Sources/AppDelegate.swift` with `keyEquivalent: ""` and the "⌥⇥" glyph rendered as trailing title text, `.identified("view.keyboardFocus")`.

**Rationale:** Brief Q7, grounded in the existing registry comment and the `menuEligible` promotion mechanics in `keymap-registry.ts`.

**Implications:** Requires `just build-app` to test (tugapp change); the JS side's gate/chord sync (`host-menu-state.ts`) picks the item up by `menuItemId` as usual.

#### [P12] The parked text stop and the both-marks state (DECIDED) {#p12-parked-stop}

**Decision:** While KBF is engaged, landing the key view on a text stop **parks**: the engine routes it `engine-routed` (sink parked, no DOM grant, no caret) and the ring paints on the input area. Return grants the caret without typing (the existing Return-descend). A printable character clears `manuallyEngaged`, grants the caret, and types the character. While KBF is engaged *and* a caret is live in a stop, the stop wears **both** ring and caret. Rings exist iff KBF is engaged — one sentence, the whole rule.

**Rationale:** Brief D4 — this restores the pre-`53233fdc6` parked state and repeals focus-language's "never wears a focus ring" axiom, which the brief traces as the root of the whole compensation network.

**Implications:** The engine's route derivation (focus-manager.ts, the "router is the target" logic that classifies contract-bearing responders `dom-granted`) gains a KBF-parked branch: a text-contract target while `kbfEngaged()` and not descended-into resolves `engine-routed`; the grant happens on descend (Return/printable/click). at0345 (`tests/app-test/at0345-editor-never-rings.test.ts`) inverts: a parked stop *does* ring; a mode-OFF editor does *not*.

---

### Deep Dives {#deep-dives}

#### The document keyboard ladder, as it stands {#ladder-today}

All stages are document capture-phase keydown listeners installed in one layout effect in `tugdeck/src/components/tugways/responder-chain-provider.tsx`, in registration order (the install block near the file's end): `noteKeyboardInput` → `focusWalkListener` (Tab; yields to `data-tug-tab-consume` and to native when the walk is empty) → `arrowNavListener` (spatial plane; consults `resolveArrowRelease(arrowReleaseSubject(document.activeElement), direction)` and drops released-but-repeat presses) → `captureListener` (chords/bindings; `chordCaptureState.isArmed()` guard; Escape-yield to the ladder) → `actDispatchListener` (Space/Enter/Escape; hosts the single Escape ladder: (1) keyViewCaptures, (2) top mode `onEscapeDismiss`, (4) non-trapped ascend, (5) `escapeExits` cycle pop, (3) trapped-no-callback dev-warn) → `keyViewDelegateListener` (`KeyViewBehavior.onKey`) → `arrowFallbackListener` (the liveliness net; second `resolveArrowRelease` consult + repeat gate + `moveKeyViewLinear` + `place()`) → `engineScrollKeyListener` → bubble-phase `bubbleListener`.

KBF's changes to this ladder are surgical: `arrowNavListener` and `arrowFallbackListener` gain a `kbfEngaged()` gate and an `[data-tug-attached-list]` yield and lose their `resolveArrowRelease` consults and repeat gates; `focusWalkListener` gains the nowhere-state engage and loses the native fallback; `actDispatchListener`'s Escape ladder gains rung (6): bare `manuallyEngaged` clear. Everything else is untouched.

#### Engagement, seeding, and the fate of `useCycleMode` {#cycle-promotion}

`useCycleMode` (`use-cycle-mode.tsx`) is **promoted, not deleted** (brief: "What this deletes", last paragraph). What it keeps: the trapped-mode push carrying `commitDisposition` + `escapeExits`, the commit-home seed (`focusFirstInMode` + `focusKeyView`), the resting-focus landing on relinquish (the layout effect watching the engine-derived `cycling` flip), and `CycleScope`. What changes: `toggle()` no longer flips a card-local notion — it calls the new `FocusManager.toggleKbfManual()`, and the card's push/pop rides a subscription to the manager bit, so the deck-global bit and the card's trapped walk cannot desync. What dies: `enterAt`/`enterToward` (both exist only to receive handoffs from a text surface) and the hook's own capture-phase pointerdown listener (generalized to one provider-level listener per [P05]).

Manual engagement on a card **without** a cycle scope (Lens, a Class-B card already engaged, a diff card): the engine seeds `focusFirstInMode()` on the card's current mode and paints. The session card keeps its wiring shape — `CYCLE_FOCUS_MODE` handler on the card-content responder (session-card.tsx, the action map entry near `[TUG_ACTIONS.CYCLE_FOCUS_MODE]`), `restingFocus: () => entryDelegateRef.current?.focus()`, `data-cycling` on the card root — with the handler now calling the manager toggle.

#### The printable-grant mechanics {#printable-grant}

The grant must be synchronous inside the capture keydown so the browser's own text-insertion pipeline (beforeinput → input) lands the character in the just-focused editor — no synthetic event re-dispatch, no clipboard tricks. Placement: a new branch at the top of `keyViewDelegateListener`'s slot (after chords, before the delegate), firing only when: `kbfEngaged()`, the key view is a parked text stop, `event.key.length === 1`, no `metaKey`/`ctrlKey`, and `!event.isComposing`. It clears `manuallyEngaged`, realizes the stop's dom-grant (the same contract grant Return-descend uses), and **returns without preventDefault** — the browser types the character into the newly focused editor. Space is a printable here (it types a space into the field), which takes precedence over Space-commits on a *text* stop only; non-text stops keep Space-commit.

#### Deletion inventory, by file {#deletion-inventory}

| File | What goes |
|---|---|
| `src/components/tugways/arrow-release.ts` | entire module |
| `src/components/tugways/__tests__/arrow-release.test.ts` | entire file |
| `src/components/tugways/tug-text-editor/keymap.ts` | `projectRelease`, `resolveEditorRelease`, the release/latch `ViewPlugin`, `armedEdge` state, `LATCH_EDGE`, `EXIT_DIRECTION`, `onArrowExit` in `TugTextEditorKeymapConfig`, `EditorArrowExitDirection`, all plain-arrow latch keydown branches (Enter/history/gap-fill bindings stay) |
| `src/components/tugways/responder-chain-provider.tsx` | both `resolveArrowRelease` consults + imports, both repeat gates, the native-Tab fallback |
| `src/components/tugways/use-cycle-mode.tsx` | `enterAt`, `enterToward`, the capture pointerdown listener (moved to provider) |
| `src/components/tugways/tug-filter-field.tsx` | `filterFieldDidRequestAdvance` (replaced per Spec S02) |
| hosts (the [P06] list) | `onArrowExit` / `onTabWhenEmpty` / advance wiring |
| unit tests | latch cases of `keymap-arrow-history.test.ts` siblings; any `keymap-editor-release`-named suite |

Before deleting, re-run the grep that produced this inventory (`grep -rln 'filterFieldDidRequestAdvance\|onArrowExit\|onTabWhenEmpty\|data-tug-arrow-release' tugdeck/src`) — the codebase moves.

---

### Specification {#specification}

**Spec S01: The derivation** {#s01-derivation}

```
kbfEngaged() =
     accessMode === "accessibility"                                  // Class C, non-negotiable
  || kbfManuallyEngaged                                              // ⌥⇥ / menu item
  || activeContext.modeStack.some(m => m.kbf !== false)              // Class A: traps
  || cardRegistry.get(keyCardComponentId)?.kbfAtRest === true        // Class B: declared cards
```

The bit is never stored derived; every read computes. Notification: any mutation of an input notifies the manager's subscribers and calls `reproject()`.

**Spec S02: The attached-list component contract** {#s02-attached-list}

- The field component (TugFilterField; Open Quickly's `TugInput` wrapper in `tug-completion-popup.tsx`) stamps `data-tug-attached-list` on the wrapper element that contains the focused `<input>` (containment test in the ladder, same reasoning as `arrowReleaseSubject`'s `inKeyView` containment: the active element is the inner input, the marker rides the wrapper).
- Ladder rule: `arrowNavListener` and `arrowFallbackListener` return early for ↑/↓ when `document.activeElement?.closest('[data-tug-attached-list]') !== null`. Horizontal arrows are unaffected (caret keys).
- `TugFilterFieldDelegate` replaces `filterFieldDidRequestAdvance?(): void` with `attachedListMoveCursor?(direction: "up" | "down"): boolean` (return false = nothing to move, key falls through to the caret). Each of the five sites maps it onto the list it already owns (the Lens section's list cursor handle via `lens-section-content.ts` registration; the picker/resume/history rows likewise). Commit stays per-site ([Q01]).

**Spec S03: `data-kbf` projection** {#s03-data-kbf}

`computeProjection()` adds `kbf: boolean`; `applyProjection()` writes/removes the attribute on `document.documentElement` diff-then-write, counting writes like every other mark. The watchdog needs no new class: the attribute is healed by the same reprojection.

**Spec S04: Gesture × state table** {#s04-gestures}

| Gesture | OFF, caret live | OFF, nowhere | ON (manual), ring on non-text stop | ON, parked text stop | ON (auto), caret live (typing descend) |
|---|---|---|---|---|---|
| ⌥⇥ | set manual; seed key card's commit-home | same | clear manual; caret to card's resting destination | same | set manual; ring returns to last stop ([P09]) |
| Tab | surface's (indent/completion) | engage + one step ([P07]) | linear walk (never native) | linear walk | surface's |
| ↑/↓ | caret (or attached list) | consumed, no-op | spatial plane + net | spatial plane + net | caret (or attached list) |
| Printable | types | — | (non-text stop: per stop) | clear manual, grant, type ([P12]) | types |
| Return | surface's | — | scope default | grant caret, no text | surface's |
| Space | types | — | commits stop | types (printable rule) | types |
| Escape | ladder as today | ladder | ladder rungs 1–5, then clear manual (rung 6) | same | auto: dismisses surface in one press (rung 2) |
| Pointerdown | — | — | clears manual; click places focus | same | same |

#### State Zone Mapping {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| `kbfManuallyEngaged` | structure | `FocusManager` field, mutated imperatively, read via subscribe | [L22], [L02] |
| `kbfEngaged()` (derived) | structure | pure derivation over engine state | [L22] |
| `data-kbf` on `<html>` | appearance | `applyProjection()` diff-then-write | [L06] |
| `kbf` trap flag | structure | `pushFocusMode` option, per mode entry | [L22] |
| `kbfAtRest` | structure | `CardRegistration` static declaration | — |
| `data-tug-attached-list` | behavior (declared gesture policy) | component-stamped DOM attribute, ladder-read | [L06] |
| ring paint in/out of mode | appearance | CSS gate `html[data-kbf]` | [L06] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `kbfManuallyEngaged` | private field | `focus-manager.ts` FocusManager | [P01] |
| `kbfEngaged()` | method | `focus-manager.ts` FocusManager | Spec S01 |
| `toggleKbfManual()` / `setKbfManual(v)` | methods | `focus-manager.ts` FocusManager | notify + reproject |
| `kbf?: boolean` | option | `pushFocusMode` opts, `FocusModeEntry`, `UseFocusTrapOptions` | [P03] |
| `kbfAtRest?: boolean` | field | `card-registry.ts` CardRegistration | [P10] |
| `kbf: boolean` | field | `FocusProjection` | Spec S03 |
| `KBF_ATTRIBUTE = "data-kbf"` | const | `focus-manager.ts` | Spec S03 |
| `attachedListMoveCursor` | delegate method | `tug-filter-field.tsx` | Spec S02, replaces `filterFieldDidRequestAdvance` |
| `data-tug-attached-list` | DOM attribute | field wrappers | Spec S02 |
| `"view.keyboardFocus"` | menuItemId + NSMenuItem | `command-registry.ts`, `tugapp/Sources/AppDelegate.swift` | [P11] |

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tests/app-test/at03XX-kbf-mode-division.test.ts` (next free at-number) | OFF: no rings, arrows never move a ring; ON: rings + movement |
| `tests/app-test/at03XX-open-quickly-arrows.test.ts` | ↓ selects first result on empty query |
| `tests/app-test/at03XX-kbf-parked-stop.test.ts` | ring + no caret; printable types and lands |
| `tests/app-test/at03XX-kbf-escape-ladder.test.ts` | one Escape closes a sheet from a caret inside it |
| `tugdeck/src/components/tugways/__tests__/kbf-derivation.test.ts` | Spec S01 unit coverage |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** (`bun test`, DOM-free) | the derivation (Spec S01), gesture-policy pure functions | every engine-policy branch |
| **App-test** (real Tug.app) | mode division, Open Quickly, parked stop, Escape ladder, the inverted at0345, rewritten at0341–43 | every user-visible behavior in this plan |
| **Drift prevention** | at0248/at0277/at0282 stay green with KBF force-engaged | descend machinery must be untouched |

#### What stays out of tests {#test-non-goals}

- jsdom render tests and mock-store assertions — banned pattern (drive real code paths on real content).
- Per-theme ring color assertions — the gate is presence/absence of paint, not hue; transitions poison mid-flight style reads (assert the un-animated property).
- IME dead-key sequences — manual pass before phase close (Risk R01 residual); not automatable in the harness.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** Every commit runs `cd tugdeck && bun test && bunx vite build` at minimum; app-test checkpoints name their files. Commits go directly on `main` (repo convention). New app-tests must carry `@covers` headers (`just app-test-covers-check`).

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Engine bit, derivation, projection | pending | — |
| #step-2 | Trap flag + card declarations | pending | — |
| #step-3 | Manual engagement gestures | pending | — |
| #step-4 | CSS ring gate | pending | — |
| #step-5 | Menu item | pending | — |
| #step-6 | Attached-list contract | pending | — |
| #step-7 | Parked text stop | pending | — |
| #step-8 | The deletions | pending | — |
| #step-9 | Tab rules | pending | — |
| #step-10 | Doctrine surgery | pending | — |
| #step-11 | Test rework + new suites | pending | — |
| #step-12 | Integration checkpoint | pending | — |

#### Step 1: Engine bit, derivation, projection {#step-1}

**Commit:** `tugways(kbf): add the derived KBF mode bit and its data-kbf projection`

**References:** [P01] engine bit, [P02] projection, Spec S01, Spec S03, (#ladder-today)

**Artifacts:** `kbfManuallyEngaged`, `kbfEngaged()`, `setKbfManual`/`toggleKbfManual`, `KBF_ATTRIBUTE`, `FocusProjection.kbf`, the `applyProjection()` write; no consumer yet — behavior unchanged.

**Tasks:**
- [ ] Add the field + derivation to `FocusManager` (focus-manager.ts), reading `this.accessMode`, the active context's mode stack, and the key card's registration (import the registry lookup; tolerate an unregistered componentId as `false`).
- [ ] Thread `kbf` through `computeProjection()`/`applyProjection()` per Spec S03.
- [ ] Ensure every input mutation notifies + reprojects (mode push/pop, key-card adoption, access-mode set, manual set).

**Tests:**
- [ ] `__tests__/kbf-derivation.test.ts`: manual on/off; trap with/without `kbf: false`; background-card trap does not engage; accessibility overrides everything; `kbfAtRest` card.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx vite build`
- [ ] In the running app (HMR): `document.documentElement.hasAttribute("data-kbf")` is false at rest, true while a sheet is open (verify via TugDevPanel/evalJS).

---

#### Step 2: Trap flag + card declarations {#step-2}

**Depends on:** #step-1

**Commit:** `tugways(kbf): kbf trap flag and per-card kbfAtRest declarations`

**References:** [P03] trap flag, [P10] Class-B dispositions, (#s01-derivation)

**Tasks:**
- [ ] Add `kbf?: boolean` to `pushFocusMode` opts / `FocusModeEntry` / `UseFocusTrapOptions`; default engage.
- [ ] `TugCompletionPopup` passes `kbf: false`.
- [ ] Add `kbfAtRest?: boolean` to `CardRegistration`; declare true on Lens, Jots, Settings, Keyboard, About, Gazette, Pulse, Devtools registrations; leave Session/Text/File-view/Diff/Hello absent. (Find each registration by grepping `registerCard` call sites for the componentIds in the brief's Class-B table.)
- [ ] Re-verify the brief's Class-A trap call-site list by grepping `useFocusTrap(` — new call sites since 2026-08-10 get the default (engage) unless typing-first.

**Tests:**
- [ ] Extend `kbf-derivation.test.ts` for the flag and a declared card.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx vite build`
- [ ] App: `data-kbf` present with the Lens as key card; absent with a session card at rest; absent while Open Quickly is up.

---

#### Step 3: Manual engagement gestures {#step-3}

**Depends on:** #step-2

**Commit:** `tugways(kbf): route ⌥⇥, pointerdown-clear, and the Escape rung through the engine bit`

**References:** [P05] persistence, [P09] forced modes, Spec S04, (#cycle-promotion), Risk R02

**Tasks:**
- [ ] `useCycleMode`: `toggle()` calls `toggleKbfManual()`; the push/pop of the card's cycle scope subscribes to the manager bit (push when engaged & key card & has scope; pop + `restingFocus` on disengage). Keep `commitDisposition`, `escapeExits`, `CycleScope`, the relinquish layout effect.
- [ ] Move the mouse-exit capture `pointerdown` listener from `use-cycle-mode.tsx` into the provider (one listener: clears `manuallyEngaged`; the click's own placement then proceeds — preserve the no-caret-flash behavior by popping `moveDomFocus: false` as today).
- [ ] Provider-level default for `CYCLE_FOCUS_MODE` when no card handler claims it: toggle the bit and seed `focusFirstInMode()`.
- [ ] Key-card change while engaged: seed the new key card's ring (commit-home / first-in-mode) in `adoptKeyCard`.
- [ ] Escape rung (6) in `actDispatchListener`'s ladder: base mode + `manuallyEngaged` → clear it, land the resting destination; sits **below** every existing rung.
- [ ] ⌥⇥ from a typing descend inside a forced mode re-engages to the ring ([P09]); never disengages a forced mode.

**Tests:**
- [ ] Unit: toggle/pointerdown/Escape transitions against Spec S04 where DOM-free; the rest lands in #step-11's app-tests.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx vite build`
- [ ] App: ⌥⇥ on a session card enters the cycle (ring on submit); ⌥⇥ again restores the caret; ⌘L to the Lens with the bit set keeps the mode; a click anywhere clears it.

---

#### Step 4: CSS ring gate {#step-4}

**Depends on:** #step-1

**Commit:** `tugways(kbf): gate every ring rule on data-kbf; default-ring exempt`

**References:** [P04] CSS gate, Risk R03, (#s03-data-kbf)

**Tasks:**
- [ ] In `styles/focus-ring.css`: prefix the `[data-key-view-kbd]`, `[data-key-cursor]`, and `[data-key-within]` paint rules with `html[data-kbf]`; check the specificity note against `html[data-app-active="false"]` still holds (it names `html` too, so it stays ≥ the gated rules).
- [ ] Delete the `[data-cycling="false"]` suppression block (subsumed) and the `[data-cycling="true"] [data-key-within]` block if the within-mark's gate now covers it — verify against the session card cycling visuals first.
- [ ] Sweep every stylesheet for other selectors on the three attributes (`grep -rn 'data-key-view-kbd\|data-key-cursor\|data-key-within' tugdeck/styles tugdeck/src --include='*.css'`) and gate any that *paint* (suppressions stay ungated).
- [ ] Leave `[data-default-ring]` / `persistentDefaultRing` (internal/tug-button.css) ungated; visually check the two mode-OFF residual surfaces: the session entry's `data-tug-entry-default` promotion and the session-history view.

**Tests:** none new (visual + app-test coverage arrives in #step-11).

**Checkpoint:**
- [ ] `cd tugdeck && bunx vite build`
- [ ] App: no ring anywhere at rest on a session card; rings appear the moment a sheet opens or ⌥⇥ engages.

---

#### Step 5: Menu item {#step-5}

**Depends on:** #step-3

**Commit:** `tugways+tugapp(kbf): Keyboard Focus menu item with decorative ⌥⇥`

**References:** [P11] menu item

**Tasks:**
- [ ] `command-registry.ts`: add `menuItemId: "view.keyboardFocus"` to the `CYCLE_FOCUS_MODE` entry; do **not** add `menuEligible` to its chord; update the entry's "chord-only, deliberately" comment to record the decorative-chord decision.
- [ ] `tugapp/Sources/AppDelegate.swift`: add the View-menu `NSMenuItem` with `keyEquivalent: ""`, `.identified("view.keyboardFocus")`, title carrying the ⌥⇥ glyph as text (match the file's existing item idiom).
- [ ] `just build-app`.

**Tests:**
- [ ] The command-routing drift test (`__tests__/command-routing-drift.test.ts`) and menus doc test pass with the new `menuItemId`.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx vite build`; `just build-app`
- [ ] App: the menu item toggles the mode; Settings ▸ Keyboard chord capture can still record ⌥⇥ while armed.

---

#### Step 6: Attached-list contract {#step-6}

**Depends on:** #step-2

**Commit:** `tugways(kbf): list-attached fields own their vertical arrows in both modes`

**References:** [P08] attached list, Spec S02, [Q01], (#ladder-today)

**Tasks:**
- [ ] Ladder: yield ↑/↓ in `arrowNavListener` and `arrowFallbackListener` when the active element is inside `[data-tug-attached-list]` (before the release consults, which still exist until #step-8).
- [ ] `tug-filter-field.tsx`: add `attachedListMoveCursor` to the delegate; stamp the attribute on the wrapper when the delegate supplies it; field `onKeyDown` claims ↑/↓ through it; delete nothing yet.
- [ ] Adopt at the five sites (`lens-section-band.tsx`, `jots-card.tsx`, `session-card.tsx` picker, `resume-sheet.tsx`, `session-history-view.tsx`): map to each list's cursor.
- [ ] Open Quickly: stamp the attribute on the `TugCompletionPopup` field wrapper so the ladder yields and the popup's existing `onKeyDown` (ArrowDown/ArrowUp/Enter/Escape) finally runs on an empty query.

**Tests:**
- [ ] Unit: field-level policy (delegate present → arrows claimed; absent → untouched) where testable DOM-free.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx vite build`
- [ ] App: Open Quickly, empty query, ≥2 roots — ↓ highlights the first result (not the switcher); Lens filter — ↓ moves the section's row cursor with the caret staying put.

---

#### Step 7: Parked text stop {#step-7}

**Depends on:** #step-3, #step-4

**Commit:** `tugways(kbf): restore the parked text stop; printable and Return grant the caret`

**References:** [P12] parked stop, Risk R01, (#printable-grant), Spec S04

**Tasks:**
- [ ] Engine route derivation: a text-contract target resolves `engine-routed` (park, no grant) while `kbfEngaged()` and not descended; Return-descend keeps its grant path; verify the grant is idempotent (the substrate's `view.hasFocus` guard).
- [ ] Printable-grant branch per #printable-grant (capture stage, synchronous grant, no preventDefault, IME/modifier/length gates); clears `manuallyEngaged`.
- [ ] CSS: the parked stop's ring on the input area (the editor stop's registered element) paints under the #step-4 gate; the both-marks state (ring + live caret while engaged) needs no new rule — verify the editor's own key-view treatment (`::after` border, per the focus-ring.css comment) composes.
- [ ] D6 semantics: after a typing descend, Escape behaves per Spec S04 (manual already cleared → falls through; auto surface → rung 2 dismisses in one press).
- [ ] Invert `tests/app-test/at0345-editor-never-rings.test.ts`: parked stop rings; mode-OFF editor never rings; rename if its name no longer describes it (keep the at-number).

**Tests:**
- [ ] at0345 (inverted) green; falsification check: force a mode-OFF ring and see it red.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx vite build`
- [ ] `just app-test tests/app-test/at0345-*.test.ts`
- [ ] App: ⌥⇥ → arrow onto the editor stop → ring, no caret; type "x" → caret live, "x" in the document, mode manual-cleared.

---

#### Step 8: The deletions {#step-8}

**Depends on:** #step-6, #step-7

**Commit:** `tugways(kbf): delete the release policy, boundary latch, and handoff contracts`

**References:** [P06] deletions, (#deletion-inventory), [P08]

**Tasks:**
- [ ] Execute the deletion inventory table verbatim, re-running its grep first.
- [ ] `arrowNavListener`/`arrowFallbackListener`: replace the release consults with the mode gate — OFF: yield to any focused text surface unconditionally (the existing editable-active shape) and otherwise no-op the ring stages; ON: proceed as today, minus repeat gates.
- [ ] Remove `filterFieldDidRequestAdvance` from the delegate and all five sites (superseded in #step-6).
- [ ] Delete the latch halves of the keymap unit tests; keep Cmd/Opt history coverage (`keymap-arrow-history.test.ts`).

**Tests:**
- [ ] `bun test` green with the deleted suites gone; no references remain (`grep` returns empty).

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx vite build`
- [ ] App: mode OFF — ↑ held at a non-empty prompt's top edge never leaves the editor; empty prompt — arrows still never leave; Lens filter arrows still drive rows (attached list, not release).

---

#### Step 9: Tab rules {#step-9}

**Depends on:** #step-8

**Commit:** `tugways(kbf): Tab engages from the nowhere state; the engine never yields Tab to WebKit`

**References:** [P07] Tab in OFF, Spec S04

**Tasks:**
- [ ] `focusWalkListener`: mode OFF + caret live → untouched (surface owns Tab; `data-tug-tab-consume` path unchanged); mode OFF + nowhere → engage manual + one step, consume; mode ON → walk, and a failed walk is consumed (delete the native-Tab yield).
- [ ] Confirm `advanceKeyViewFocus` callers (View-menu Next/Previous Keyboard Focus commands) behave sanely in mode OFF (they should engage first — route them through the same engage-and-step).

**Tests:**
- [ ] Unit coverage of the nowhere predicate.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx vite build`
- [ ] App: click transcript prose (caret nowhere) → Tab paints a ring and steps; in the prompt, Tab still indents.

---

#### Step 10: Doctrine surgery {#step-10}

**Depends on:** #step-7, #step-8, #step-9

**Commit:** `tuglaws(kbf): rewrite focus-language for the mode division`

**References:** brief "Doctrine surgery" section, [P12], [P04], [P08]

**Tasks:**
- [ ] `tuglaws/focus-language.md`, per the brief's section list: mode division opens "Motion: two planes"; delete the boundary-latch paragraph, both empty-field-spends rules, the landing-grants rule, the never-wears-a-ring rule and its "the box, not the DOM node" corollary, and "Crossing out is always a discrete press"; rewrite "Three carriers" (wash keeps its job; ring absence in OFF is the rule); strengthen "plain arrows are caret keys" (unconditional in OFF; Cmd-history unaffected); **keep the three-in-a-row failure history as a note** explaining why the old rule existed and why the mode retires it; contract table gains the `data-kbf` gate row; authoring contract gains the attached-list contract and the `kbf: false` flag.
- [ ] Sweep the other laws for invalidated statements — `tuglaws/list-view-usage.md` (amended by `53233fdc6`) at minimum; `component-authoring.md` and `design-decisions.md` cross-references.
- [ ] No hard-wrapped prose.

**Tests:** none (doc step).

**Checkpoint:**
- [ ] A grep of `tuglaws/` for "boundary latch", "arrow-release", "onArrowExit", "onTabWhenEmpty", "enterAt" returns only historical notes that identify themselves as such.

---

#### Step 11: Test rework + new suites {#step-11}

**Depends on:** #step-8, #step-9

**Commit:** `app-test(kbf): mode-division, open-quickly, parked-stop, and escape-ladder suites; arrow suites rewritten`

**References:** brief "Test impact", (#new-files), [P07], [P08], [P12], Risk R02

**Tasks:**
- [ ] Rewrite `at0341-lens-cross-section-arrows`, `at0342-picker-arrow-traversal` (KBF engaged at start where they exercise ring motion), and `at0343-prompt-arrow-latch-history` (latch half deleted; Cmd-history half kept).
- [ ] Run `at0248-lens-list-cursor-keys`, `at0277-lens-row-accessories-keyboard`, `at0282-lens-row-arrow-escape` with KBF force-engaged at test start; they must pass unmodified — a failure is an implementation leak into the descend machinery, fix the code not the test.
- [ ] Author the four new suites from #new-files (next free at-numbers; `@covers` headers pointing at `focus-manager.ts`, `responder-chain-provider.tsx`, `tug-completion-popup.tsx`, `tug-filter-field.tsx` as appropriate).
- [ ] `just app-test-covers-check`.

**Tests:** the step *is* tests.

**Checkpoint:**
- [ ] `just app-test <the four new files> tests/app-test/at0341-*.test.ts tests/app-test/at0342-*.test.ts tests/app-test/at0343-*.test.ts tests/app-test/at0345-*.test.ts tests/app-test/at0248-*.test.ts tests/app-test/at0277-*.test.ts tests/app-test/at0282-lens-row-arrow-escape.test.ts`

---

#### Step 12: Integration checkpoint {#step-12}

**Depends on:** #step-5, #step-10, #step-11

**Commit:** `N/A (verification only)`

**References:** (#success-criteria), (#exit-criteria)

**Tasks:**
- [ ] `just app-test-changed` over the phase's full diff; run what it selects.
- [ ] Manual pass: the Spec S04 table row by row on a real session card + Lens + one sheet; the IME first-character check (Risk R01 residual) with a non-Latin input source.
- [ ] Verify the D3 invariant by inspection: no engine-routed stop reachable in mode OFF.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx vite build`
- [ ] `just app-test-changed` — VERDICT green.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** KBF mode shipped: a derived, engine-owned, `data-kbf`-projected keyboard-focus mode with manual (⌥⇥/menu) and derived (trap/card/accessibility) engagement, the parked text stop, the list-attached-field contract, the deletion of the three ambient mechanisms, and matching doctrine + tests.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Every #success-criteria bullet verified by its named test or check.
- [ ] `arrow-release.ts` and the boundary latch no longer exist; grep for the deletion inventory returns empty.
- [ ] `tuglaws/focus-language.md` describes the shipped model; the old axiom survives only as a history note.
- [ ] Step Status Ledger fully `done` with commit hashes.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] `gallery-cycle-demo` → full KBF gallery demo with copy explaining the mode.
- [ ] Diff-card hunk navigation (would flip it to auto-engage; brief Q6's revisit trigger).
- [ ] Reopening the tabled focus-walk chord subsystem, if ever, now on top of a real mode.

| Checkpoint | Verification |
|------------|--------------|
| Open Quickly regression dead | new open-quickly app-test |
| Mode division holds | mode-division app-test |
| No double-Escape | escape-ladder app-test |
| Full phase | `just app-test-changed` VERDICT |
