## Keyboard Focus Mode (KBF) {#kbf-mode}

**Purpose:** Replace the three ambient arrow-ownership mechanisms (the empty-input release, the boundary latch, and the emptiness-conditioned Tab/arrow handoffs) with one explicit, named, user-controlled mode — **KBF mode** — in which rings paint and the engine owns movement keys, while mode OFF gives text surfaces unconditional key ownership and paints no rings at all. Ships the derived mode bit, the parked text stop, the list-attached-field contract that fixes Open Quickly, and the corresponding doctrine and test surgery.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | vetted — fixups folded in 2026-08-10 |
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
- **Paint and movement stand down together** ([P04]/[P07], #step-5): the ring gate and the ladder's mode gate are one commit. Gating the rings while the movement stages still walk would ship an app where focus moves invisibly, which is worse than either endpoint.
- **Doctrine moves in the same phase**: `tuglaws/focus-language.md` is rewritten, and at0345 inverts, in the steps that change the behavior they pin.

#### Success Criteria (Measurable) {#success-criteria}

- Open Quickly: with an empty query and ≥1 result, ↓ highlights the next result and ↑ the previous, from the first keystroke; typing then deleting back to empty does not change arrow behavior. (New app-test, #step-10.)
- Mode OFF: no element in the deck carries `data-key-view-kbd` at all, and no `[data-key-cursor]` bar or `[data-key-within]` outline paints; a caret-holding editor keeps all four plain arrows regardless of content; two presses of ↑ at a document edge move nothing out of the editor. (Mode-division app-test.)
- Mode ON (⌥⇥): rings paint; Tab/⇧Tab and arrows move the ring; `Space` commits; a text stop **arrived at by engine movement** is ringed with **no caret** until Return or a printable character grants one. (Parked-stop app-test.)
- A text-first surface still opens with a caret: the rename sheet, the resume-sheet filter, and the session question dialog put the caret in their seeded field on open, ring and all. (Parked-stop app-test, second half — [P12] seed rule.)
- One Escape closes a sheet while the caret is in a field inside it — no double-Escape regression. (Escape-ladder app-test.)
- `just hooks-test`-class checks: `cd tugdeck && bun test` green, `bunx vite build` clean, and the selective app-test run derived by `just app-test-changed` green at phase end.

#### Scope {#scope}

1. The derived KBF mode bit in the focus engine, its `data-kbf` projection, and the `kbf: false` trap flag.
2. Manual engagement (⌥⇥, Escape rung, pointerdown-clears, printable/Return grants on parked stops) and the promotion of `useCycleMode` mechanics to the general mechanism.
3. The ring gate: the projection withholds the `data-key-view-kbd` paint flavor in mode OFF, and one `html:not([data-kbf])` suppression covers the cursor bar and the within mark; `persistentDefaultRing` exempt.
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

**Where this plan amends the brief.** Four decisions are narrower or differently-mechanized than the brief's wording, each because the brief's wording does not survive contact with the code. They are amendments, not reopenings — the brief's intent is preserved in every case, and each is argued at its decision:

| Brief | Plan | Why |
|---|---|---|
| Q1: "with a live caret, Tab belongs to the text surface" | [P07]: multi-line surfaces own Tab; a single-line `INPUT` spends it on movement | a plain `<input>` has no Tab meaning, so the brief's rule plus never-fall-through makes Tab a dead key — and takes Open Quickly's own directory switcher out of reach |
| D1: "Every ring rule in `focus-ring.css` gains that attribute as a gate" | [P04]: the projection withholds `data-key-view-kbd`; two suppressions cover the rest | an ancestor-prefix gate raises the leaf rule above every item-group suppression and repaints the "double ring" the language spent three attempts removing ([R04]) |
| D4: a text stop while engaged is parked | [P12]: parked when *arrived at by movement*; seeded stops and accessibility mode grant | an unqualified rule opens every text-first sheet in the app ringed and caret-less, and strands assistive tech with no caret anywhere |
| Class A: "any `useFocusTrap` push is the auto-engager" | Spec S01: any **trapped** mode entry | `pushFocusMode` also carries non-trapped descend scopes, which are navigation, not surfaces |

#### [Q01] Attached-list commit gesture (DECIDED per-site) {#q01-attached-list-commit}

**Question:** When ↑/↓ drive an attached list from a caret-holding field, what commits the cursored row?

**Resolution:** DECIDED — the field's existing commit gesture per site: Open Quickly's `Enter` commits the highlighted item (already in `tug-completion-popup.tsx`'s `onKeyDown`); a `TugFilterField` site keeps `Return` meaning what its delegate says today. The contract ([P08], Spec S02) carries only cursor movement; commit stays the surface's.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Parked-stop grant transitions (printable/Return/click) regress WebKit focus | high | med | idempotent grants ([R01]), IME gating, at-suite coverage | any watchdog steal ledger entry naming the entry shell |
| A text-first surface opens with no caret | high | med | the seed rule ([P12]): only engine *movement* parks; a seed / explicit placement grants | any sheet whose field needs a keystroke before it types |
| Escape ladder rung misordered | high | med | explicit rung spec (Spec S04) + escape-ladder app-test before ship | a sheet needing two Escapes |
| Ring gate misses a paint site | med | low (was med) | the projection withholds the flavor rather than the CSS out-selecting it ([P04], [R04]); one suppression for the two marks that stay stamped | a ring painting in mode OFF |
| A `data-key-view-kbd` probe reads absent where a test expected focus | med | high (by design) | the flavor now *means* "a ring is painted"; position probes move to `[data-key-view]` (#step-10) | any at-suite asserting focus position in a mode-OFF surface |
| Future trap becomes a KBF surface unintentionally | med | high (by design) | `kbf: false` flag exists from day one ([P03]) | next typing-first HUD |

**Risk R01: The parked text stop is where the implementation risk lives** {#r01-parked-stop}

- **Risk:** Parking (ring, blurred editor, no DOM grant) was removed once because caret-less states bred illegal rings and focus drift; the transitions back *into* typing are `.focus()` grants and each must be idempotent and IME-safe.
- **Mitigation:** Parking never focuses a *text* surface — it routes the stop `engine-routed`, and realization parks the sink. Note that `parkKeySink()` **is** a focus write: it focuses the sink element and thereby blurs the editor. What parking avoids is WebKit's blur-on-re-focus hazard on the editor itself (focus-language, "Grants are idempotent"); what it incurs is a blur, which puts it under [L23] — the re-grant must land the caret where it was, and `grantTextSurface`'s idempotency guard (focus-manager.ts, the "surface ALREADY holds DOM focus" branch, written for exactly CM6's caret-normalizing focus path) is what keeps that true. The printable-grant path fires only on `!event.isComposing`, no ⌘/⌃ modifiers, `event.key.length === 1`, and grants focus synchronously inside the capture keydown so the browser's own text insertion lands in the newly focused editor — no synthetic re-dispatch. Return rides the existing Return-descend grant.
- **Residual risk:** dead-key/IME edge sequences on the first character typed into a parked stop; covered by a manual pass with a non-Latin input source before phase close. CM6 selection across a park/re-grant round trip is checked in #step-6's app checkpoint.

**Risk R02: Escape ladder precedence** {#r02-escape-ladder}

- **Risk:** The KBF-disengage rung landing above any dismissable surface makes Escape stop closing things — the most user-visible possible regression.
- **Mitigation:** The rung is specified as the *last* branch of the existing act-dispatch Escape ladder in `responder-chain-provider.tsx` (the branch list at its "single Escape ladder" comment): `onEscapeDismiss` surfaces first, non-trapped ascends, `escapeExits` cycles, and only then a bare `manuallyEngaged` clear. Covered by the escape-ladder app-test in #step-10.
- **Residual risk:** third-party (Radix) layers consuming Escape before the document ladder — unchanged from today.

**Risk R03: Mode OFF hides every ring some surface leaned on** {#r03-ring-dependents}

- **Risk:** A surface that used a resting ring to explain itself looks wrong in mode OFF.
- **Mitigation:** `persistentDefaultRing` / `data-default-ring` is exempt from the gate ([P04]) — it is a promise about Return, not a focus mark, and it rides its own attribute, so neither the withheld flavor nor the suppression list touches it. The brief found every current site but two is a Class-A auto-engaging surface; the residuals (session entry's own `data-tug-entry-default` promotion, session-history view) get a visual check in #step-5.
- **Residual risk:** none identified beyond the visual check.

**Risk R04: The ring gate as a CSS ancestor prefix would invert the cascade** {#r04-css-specificity}

- **Risk:** The obvious spelling of the gate — prefixing `[data-key-view-kbd]` with `html[data-kbf]` — takes the leaf-ring rule from (0,1,0) to (0,2,1) and so *above* every item-group suppression that exists to defeat it: `.tug-list-view[data-key-view-kbd] { outline: none }` and its siblings (`tug-choice-group.css`, `tug-option-group.css`, `tug-tab-view.css`) are (0,2,0) and win today on specificity alone. Gating that way paints a leaf ring on every group key view — the "double ring" failure `focus-ring.css` records as three separate failed attempts — and ties `html[data-app-active="false"]` at (0,2,1), reintroducing exactly the source-order fragility that rule's comment exists to prevent.
- **Mitigation:** Do not raise any painting rule's specificity. [P04] gates at the **projection** (the flavor is never stamped in mode OFF, so ~40 component selectors keyed on `[data-key-view-kbd]` stop matching with no cascade change at all) and suppresses the two remaining marks with a rule anchored on `html` in the established `data-app-active` shape.
- **Residual risk:** a future component painting from `[data-key-cursor]`/`[data-key-within]` through a pseudo-element the suppression does not name; the #step-5 sweep is written to look for `::before`/`::after` marks specifically, not just `outline`.

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

**Implications:** No component reads the mode in React for appearance. `data-kbf` is the mode's public mark — what CSS selects on it is `html:not([data-kbf])` suppressions ([P04]), never a prefix that raises a painting rule's specificity ([R04]); the ring's own trigger is withheld at the projection instead.

#### [P03] Auto-engagement is derived from the trap; `kbf: false` is the escape hatch (DECIDED) {#p03-trap-flag}

**Decision:** `pushFocusMode` options (focus-manager.ts) and `UseFocusTrapOptions` (`use-focus-trap.tsx`) gain `kbf?: boolean` (default engage). `TugCompletionPopup` (`tug-completion-popup.tsx`, its `useFocusTrap({ active: true, onEscapeDismiss })` call) passes `kbf: false` — the one exempt trap today.

**Rationale:** Brief Class A: any `useFocusTrap` push is the auto-engager, so the enumeration (TugSheet, TugAlert, TugPopover/TugConfirmPopover, TugContextMenu, TugEditorContextMenu, internal TugPopupMenu, session question/permission dialogs, app-test ask dialog, Settings chord capture) needs no per-surface list to maintain. The flag must exist from day one or the next typing-first HUD reproduces the Open Quickly bug exactly (brief Risk 4).

**Implications:** The Settings ▸ Keyboard chord capture stays an ordinary engaging trap; its armed capture must be able to record ⌥⇥ itself, which works because the chord-capture guard in `captureListener` (`chordCaptureState.isArmed()`) runs before any KBF gesture handling.

#### [P04] The ring gate is the projection, not a CSS prefix; `data-default-ring` is exempt (DECIDED) {#p04-css-gate}

**Decision:** Two mechanisms, in this order:

1. **`data-key-view-kbd` is withheld in mode OFF.** `computeProjection()` (focus-manager.ts) already derives the paint trigger as `keyViewKbd: state.keyViewKeyboard || this.ringFollowsPointer`; it gains `&& this.kbfEngaged()`. `focus-ring.css`'s own header calls this attribute "**One trigger**", and it is exactly that: a pure paint signal, not a position record. The *unflavored* `data-key-view` is untouched, so every behavioral reader (`deliverToEngineLeaf`'s `querySelector("[data-key-view]")`, the watchdog, `arrowReleaseSubject`'s `inKeyView` containment while it still exists) sees no change.
2. **One suppression for the two marks that stay stamped.** `[data-key-cursor]` and `[data-key-within]` keep carrying position and containment truth in both modes — 27 and several app-tests respectively read them as structure — so their *paint* is suppressed rather than their attribute withheld, in `focus-ring.css`, anchored on `html` in the same shape (and for the same documented specificity reason) as the existing `data-app-active` rule:

```css
html:not([data-kbf]) :is([data-key-cursor], [data-key-within]) {
  outline: none;
  background-image: none;
}
/* The movement cursor's bar is a generated pseudo-element, which no outline
   suppression reaches (`tug-list-view.css`, `tug-accordion.css`). */
html:not([data-kbf]) [data-key-cursor]::before {
  content: none;
}
```

`[data-default-ring]` (the `persistentDefaultRing` treatment in `internal/tug-button.css`) is exempt from both mechanisms — it rides its own attribute and paints in both modes (brief Q3: a promise about Return, not a focus position).

**Rationale:** Brief D2 ("No focus ring is painted anywhere" in OFF) + D3 (rings ⇔ engaged). The rejected spelling — an `html[data-kbf]` ancestor prefix on the paint rules — is a cascade inversion, not a gate: see [R04]. Withholding the flavor also means the gate cannot *miss* a rule: the ~40 selectors keyed on `[data-key-view-kbd]` across ~20 component stylesheets (`tug-sheet.css`, `tug-alert.css`, `tug-popover.css`, `tug-switch.css`, `tug-value-input.css`, `tug-list-row.css`'s `:has()` selection tints, `lens-section-band.css`, `jots-card.css`, the item-group suppressions) all stand down at once, with their relative specificities exactly as they are today.

**Implications:**
- Per-component suppressions are untouched, because nothing about the cascade changes.
- `data-key-view-kbd` now *means* "a ring is painted here". An app-test using it as a position probe in a mode-OFF surface must move to `[data-key-view]` (#step-10 does this sweep; 60 app-test files reference the attribute today).
- Withholding is a projection write like any other, so the watchdog heals it and [L06] holds — no component reads the mode in React.
- The `[data-cycling="false"]` ring-suppression block in focus-ring.css is subsumed and deleted (#step-5); the `[data-cycling="true"]` submit-fill stand-down rules in `tug-prompt-entry.css`/`tug-entry-shell.css` are re-keyed in #step-3.

#### [P05] `manuallyEngaged` persists across card activation; pointerdown clears it (DECIDED) {#p05-persistence}

**Decision:** The bit is deck-global and survives keyboard-driven card switches (⌘L and friends). A document capture-phase `pointerdown` clears it — the existing mouse-exit rule in `use-cycle-mode.tsx` (its capture `pointerdown` listener) generalized to one provider-level listener. `CYCLE_FOCUS_MODE` keeps `routing: "key-card"` (the toggle still needs the key card to seed the ring), but the bit it flips is the engine's.

**Rationale:** Brief Q2 (persisting is the friendlier answer; pointerdown clears it anyway) and D5's table.

**Implications:** On key-card change while engaged, the engine seeds the new key card's ring (its commit-home / first-in-mode) so the mode never points at nothing.

#### [P06] The deletions land as one step, after the exemption exists (DECIDED) {#p06-deletions}

**Decision:** `arrow-release.ts` (module + `arrow-release.test.ts`), the `data-tug-arrow-release` channel and its CM6 producer (`projectRelease` / `resolveEditorRelease` / the `ViewPlugin` and latch state in `tug-text-editor/keymap.ts`), the boundary latch (`armedEdge`, `LATCH_EDGE`, `EXIT_DIRECTION`, the latch keydown branches), `onArrowExit` (keymap config + every host wire), `onTabWhenEmpty` and the empty-Tab rule, `enterAt`/`enterToward` in `use-cycle-mode.tsx`, and the arrow repeat gating in `arrowNavListener`/`arrowFallbackListener` are all deleted in #step-7, which depends on the attached-list contract (#step-4) and the mode gate (#step-5) landing first.

**Rationale:** Brief "What this deletes" — every one is compensation for the missing parked state; removing half leaves dead doors (a host handoff with no receiver, a release with no reader).

**Implications:** Host wiring to touch: `tug-text-editor.tsx`, `tug-message-editor.tsx`, `tug-prompt-entry.tsx`, `cards/session-card.tsx`, `tug-find-bar.tsx`, `lens-section-band.tsx`, `jots-card.tsx`, `cards/resume-sheet.tsx`, `chrome/session-question-dialog.tsx`, `session-history/session-history-view.tsx` (the grep set for `onArrowExit|onTabWhenEmpty|data-tug-arrow-release|filterFieldDidRequestAdvance` as of 2026-08-10). `keymap-arrow-history.test.ts` keeps its Cmd/Opt-history halves; latch cases are deleted.

#### [P07] Tab in mode OFF: a *multi-line* caret owns it; a single-line field and the nowhere state walk; the engine never yields Tab to WebKit (DECIDED) {#p07-tab-off}

**Decision:** Three cases in mode OFF, resolved structurally — by the *kind* of surface, never by its content:

1. **A multi-line text surface with a live caret owns Tab** — contentEditable / `TEXTAREA`, or anything advertising `data-tug-tab-consume` right now (an open completion). Indent and completion-accept are real Tab meanings and stay unconditional; the empty-Tab handoff dies.
2. **A single-line field (`INPUT`) with a live caret does not own Tab.** A single-line field has no indent and no Tab meaning of its own — a Tab there is a request to leave. It engages KBF and takes one step, exactly like the nowhere case.
3. **The nowhere state** (active card, no caret — a diff card, transcript prose after a stray click) engages KBF and takes one step.

The native-Tab fallback in `focusWalkListener` (`responder-chain-provider.tsx` — today it yields when `advanceKeyViewFocus` returns `false`) is removed: a Tab the engine cannot spend is consumed, never handed to WebKit.

**Rationale:** Brief Q1 — symmetric with ⌥⇥, and the most-tried key always produces a visible landing; the never-fall-through corollary is explicit in the brief. Case 2 is the amendment the brief's phrasing missed: "with a live caret, Tab belongs to the text surface" strands Tab as a **dead key** in every mode-OFF single-line field, because a plain `<input>` has no Tab behavior to belong to it and the engine no longer yields to WebKit. Concretely that would take the directory switcher in Open Quickly — which the brief promises ⌥⇥ and Tab both reach — and the ⌘F find bar's own controls out of keyboard reach entirely. The single-line/multi-line split is a structural predicate (tag kind), not a content predicate, so it is not a reintroduction of the emptiness rule this whole plan exists to delete.

**Implications:**
- The predicate in `focusWalkListener` is: own Tab iff `document.activeElement` is contentEditable, a `TEXTAREA`, or inside `[data-tug-tab-consume="true"]`, or `keyViewConsumesTab()`. Everything else — `INPUT`, no caret, engine-routed — walks, engaging first if `kbfEngaged()` is false.
- `data-tug-tab-consume` handling is unchanged: it is checked before the walk, so a single-line field that genuinely wants Tab (a future field with its own completion) opts back in through the existing channel.
- Never-fall-through applies to subtrees not authored as engine stops too (a portalled third-party layer, a native form). Any such surface must register focusables or its Tab is consumed — a tripwire worth a dev-log warn when the walk is empty (#step-5).

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

**Decision:** While KBF is engaged, **arriving at a text stop by engine movement** parks it: the engine routes it `engine-routed` (sink parked, no DOM grant, no caret) and the ring paints on the input area. Return grants the caret without typing (the existing Return-descend). A printable character clears `manuallyEngaged`, grants the caret, and types the character. While KBF is engaged *and* a caret is live in a stop, the stop wears **both** ring and caret. Rings exist iff KBF is engaged — one sentence, the whole rule.

Two placements are **not** engine movement and therefore **grant**, not park:

- **A seeded or explicitly-placed text stop.** A surface that seeds its own key view onto a field (`useSeedKeyView`) or places the key view at a text stop deliberately is declaring a text-first entry point, and it must open with a caret. This is not a corner case: `rename-session-sheet.tsx` seeds its field and says so in its own comment ("the engine seeds the key view onto the FIELD (caret on open)"), and so do `gallery-sheet.tsx`, `resume-sheet.tsx`, the attachment preview, and the session question / permission dialogs. Every one of them is a Class-A auto-engaging surface, so an unqualified park rule would open every text-first sheet in the app ringed and caret-less. The brief's D4 is about *arrow landings*; parking is scoped to movement accordingly.
- **Accessibility mode.** Class C is permanently engaged, and an engine-routed key view in accessibility mode has real DOM focus mirrored onto the key-view element (`focusKeyView`'s accessibility branch, and `applyProjection`'s re-mirror). Parking a text stop there would mirror focus onto the field's *wrapper* and leave an assistive-tech user with no caret in any field until they typed a character. Parking is disabled outright when `accessMode === "accessibility"`: text stops grant exactly as they do today.

**Rationale:** Brief D4 — this restores the pre-`53233fdc6` parked state and repeals focus-language's "never wears a focus ring" axiom, which the brief traces as the root of the whole compensation network. The two carve-outs preserve the two properties the axiom was protecting that are still true: a text-first surface types immediately, and assistive tech always has real focus on a real widget.

**Implications:** Parking is a change to the **route derivation**, which today is documented as content-free and lives at more than one site. All of them move together (Spec S05): `classifyRoute` (the pure `target.kind` + focus-contract classifier — its "Never a per-call flag: there is no way to author a contradiction" comment must be rewritten, because the mode now is an input), `focusKeyView`'s independent re-derivation of `this.route` from `responderHasFocusContract`, and — the one most easily missed — `focusKeyView`'s `isBareNativeControl` branch, which **grants** any bare `<input>`/`<textarea>` with no contract-bound responder. That branch is exactly the filter-field and HUD class, and it is deliberately symmetric with the watchdog's legality predicate, so park and legality must move as a pair or parking silently fails there while the watchdog calls the resulting focus legal.

`this.route` is a **cache**, recomputed only inside `realizeTarget`/`focusKeyView`. Toggling the mode while a text stop holds the key view leaves it stale, so `setKbfManual`/`toggleKbfManual` and any derivation input change must re-realize the current target (Spec S05), not merely reproject.

at0345 (`tests/app-test/at0345-editor-never-rings.test.ts`) inverts: a parked stop *does* ring; a mode-OFF editor does *not*; and a seeded sheet field rings *and* holds the caret.

---

### Deep Dives {#deep-dives}

#### The document keyboard ladder, as it stands {#ladder-today}

All stages are document capture-phase keydown listeners installed in one layout effect in `tugdeck/src/components/tugways/responder-chain-provider.tsx`, in registration order (the install block near the file's end): `noteKeyboardInput` → `focusWalkListener` (Tab; yields to `data-tug-tab-consume` and to native when the walk is empty) → `arrowNavListener` (spatial plane; consults `resolveArrowRelease(arrowReleaseSubject(document.activeElement), direction)` and drops released-but-repeat presses) → `captureListener` (chords/bindings; `chordCaptureState.isArmed()` guard; Escape-yield to the ladder) → `actDispatchListener` (Space/Enter/Escape; hosts the single Escape ladder: (1) keyViewCaptures, (2) top mode `onEscapeDismiss`, (4) non-trapped ascend, (5) `escapeExits` cycle pop, (3) trapped-no-callback dev-warn) → `keyViewDelegateListener` (`KeyViewBehavior.onKey`) → `arrowFallbackListener` (the liveliness net; second `resolveArrowRelease` consult + repeat gate + `moveKeyViewLinear` + `place()`) → `engineScrollKeyListener` → bubble-phase `bubbleListener`.

KBF's changes to this ladder are surgical: `arrowNavListener` and `arrowFallbackListener` gain a `kbfEngaged()` gate and an `[data-tug-attached-list]` yield and lose their `resolveArrowRelease` consults and repeat gates; `focusWalkListener` gains the engage-and-step path (nowhere state *and* single-line field, [P07]) and loses the native fallback; `keyViewDelegateListener`'s slot gains the printable-grant branch ahead of the delegate (#printable-grant); `actDispatchListener`'s Escape ladder gains rung (6): bare `manuallyEngaged` clear. Everything else is untouched.

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
  || activeContext.modeStack.some(m => m.trapped && m.kbf !== false) // Class A: traps
  || cardRegistry.get(keyCardComponentId)?.kbfAtRest === true        // Class B: declared cards
```

`m.trapped &&` is load-bearing, and is the correction to the brief's looser phrasing. Class A is "a surface that **traps** the keyboard", not "anything on the mode stack": `pushFocusMode` also carries **non-trapped descend scopes** — a list row scope (`tug-list-view.tsx`) and an accordion section scope (`tug-accordion.tsx`) — which are pushed *while already navigating*, not because a surface appeared. Engaging on those would make a descend an engagement event and would let a mode-OFF card enter KBF by descending. `useFocusTrap` passes `trapped: true` (its default, no call site overrides it), so the enumeration in the brief's Class A table is exactly what this predicate resolves to.

The bit is never stored derived; every read computes. Notification: any mutation of an input notifies the manager's subscribers, calls `reproject()`, **and re-realizes the current target** so the cached keyboard route cannot go stale against the new mode (Spec S05).

**Spec S02: The attached-list component contract** {#s02-attached-list}

- The field component (TugFilterField; Open Quickly's `TugInput` wrapper in `tug-completion-popup.tsx`) stamps `data-tug-attached-list` on the wrapper element that contains the focused `<input>` (containment test in the ladder, same reasoning as `arrowReleaseSubject`'s `inKeyView` containment: the active element is the inner input, the marker rides the wrapper).
- Ladder rule: `arrowNavListener` and `arrowFallbackListener` return early for ↑/↓ when `document.activeElement?.closest('[data-tug-attached-list]') !== null`. Horizontal arrows are unaffected (caret keys).
- `TugFilterFieldDelegate` replaces `filterFieldDidRequestAdvance?(): void` with `attachedListMoveCursor?(direction: "up" | "down"): boolean` (return false = nothing to move, key falls through to the caret). Each of the five sites maps it onto the list it already owns (the Lens section's list cursor handle via `lens-section-content.ts` registration; the picker/resume/history rows likewise). Commit stays per-site ([Q01]).

**Spec S03: `data-kbf` projection and the withheld flavor** {#s03-data-kbf}

`computeProjection()` adds `kbf: boolean`; `applyProjection()` writes/removes the attribute on `document.documentElement` diff-then-write, counting writes like every other mark. The watchdog needs no new class: the attribute is healed by the same reprojection.

In the same pass, `computeProjection()`'s existing `keyViewKbd` derivation gains the mode as a factor ([P04]):

```
keyViewKbd = (keyViewKeyboard || ringFollowsPointer) && kbfEngaged()
```

`applyProjection`'s existing set/remove of `data-key-view-kbd` then does the rest, diff-then-write, with no new branch. `data-key-view`, `data-key-cursor`, `data-key-within`, and `data-default-ring` are stamped exactly as they are today in both modes.

**Spec S04: Gesture × state table** {#s04-gestures}

| Gesture | OFF, caret live | OFF, nowhere | ON (manual), ring on non-text stop | ON, parked text stop | ON (auto), caret live (typing descend) |
|---|---|---|---|---|---|
| ⌥⇥ | set manual; seed key card's commit-home | same | clear manual; caret to card's resting destination | same | set manual; ring returns to last stop ([P09]) |
| Tab | multi-line / tab-consuming surface's (indent/completion); a single-line `INPUT` engages + one step ([P07]) | engage + one step ([P07]) | linear walk (never native) | linear walk | surface's, by the same split |
| ↑/↓ | caret (or attached list) | consumed, no-op | spatial plane + net | spatial plane + net | caret (or attached list) |
| Printable | types | — | (non-text stop: per stop) | clear manual, grant, type ([P12]) | types |
| Return | surface's | — | scope default | grant caret, no text | surface's |
| Space | types | — | commits stop | types (printable rule) | types |
| Escape | ladder as today | ladder | ladder rungs 1–5, then clear manual (rung 6) | same | auto: dismisses surface in one press (rung 2) |
| Pointerdown | — | — | clears manual; click places focus | same | same |

**Spec S05: The park predicate and the route sites** {#s05-park-predicate}

```
parksTextStop(target) =
     kbfEngaged()
  && accessMode !== "accessibility"        // [P12] Class C carve-out
  && targetIsTextContract(target)          // contract-bearing responder OR bare native control
  && arrivalWasEngineMovement              // [P12] seed / explicit placement grants
  && !descendedInto                        // Return / printable / click already granted
```

`arrivalWasEngineMovement` is a property of the **placement**, not of engine state: `moveKeyViewSpatial`, `moveKeyViewLinear`, `focusNext`/`focusPrevious`, and the walk are movement; `useSeedKeyView`'s placement, an explicit `realizeTarget` from a surface, `focusFirstInMode`'s commit-home seed, and a pointer placement are not. Carry it as an option on the placement (alongside `modality`) rather than inferring it — an inference over "did the key view change by one step" is exactly the ambient-predicate class this plan deletes.

Three sites in `focus-manager.ts` derive or consume the route, and all three take the predicate:

| Site | Today | Under KBF |
|---|---|---|
| `classifyRoute(target)` | pure `target.kind` + `responderHasFocusContract` | same, then `parksTextStop` downgrades a `dom-granted` verdict to `engine-routed`. Its "never a per-call flag" comment is rewritten: the mode is a derivation input, and the *placement's* arrival kind is a per-placement input — both are recorded state, not caller opinion. |
| `focusKeyView()`'s re-derivation of `this.route` | `responderHasFocusContract(keyViewId)` | same predicate, same answer — the two must not diverge. |
| `focusKeyView()`'s `isBareNativeControl` grant branch | grants any uncontracted `INPUT`/`TEXTAREA`/`SELECT` | parks it instead when `parksTextStop` holds. Its twin, the coordinator's `isBareNativeControl` legality read behind `legalKeyboardElement`, must agree — grant and legality stay symmetric, or the watchdog blesses a caret the mode says should not exist. |

**Cache invalidation.** `this.route` is recomputed only inside `realizeTarget`/`focusKeyView`. Every derivation input (manual toggle, mode push/pop, key-card adoption, access-mode change) therefore re-realizes the current target after notifying — a bare `reproject()` would repaint the marks while leaving the keyboard routed by the old mode's answer.

#### State Zone Mapping {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| `kbfManuallyEngaged` | structure | `FocusManager` field, mutated imperatively, read via subscribe | [L22], [L02] |
| `kbfEngaged()` (derived) | structure | pure derivation over engine state | [L22] |
| `data-kbf` on `<html>` | appearance | `applyProjection()` diff-then-write | [L06] |
| `kbf` trap flag | structure | `pushFocusMode` option, per mode entry | [L22] |
| `kbfAtRest` | structure | `CardRegistration` static declaration | — |
| `data-tug-attached-list` | structure (a declared contract projected into the DOM for the ladder to read — the same class as `data-tug-tab-consume`, not appearance) | component-stamped DOM attribute, ladder-read | [L24] |
| arrival kind on a placement | structure | placement option, recorded with the target | [L22] |
| ring paint in/out of mode | appearance | withheld `data-key-view-kbd` + one `html:not([data-kbf])` suppression | [L06] |
| caret preservation across park → re-grant | user data | `grantTextSurface` idempotency guard | [L23] |

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
| `keyViewKbd` derivation | modified | `focus-manager.ts` `computeProjection()` | `&& kbfEngaged()` — [P04] mechanism 1 |
| `parksTextStop()` | private method | `focus-manager.ts` FocusContext | Spec S05 |
| `arrival?: "movement" \| "placement"` | option | `realizeTarget` / `place()` opts, recorded on the target | Spec S05, [P12] seed rule |
| `classifyRoute` / `focusKeyView` / `isBareNativeControl` branch | modified | `focus-manager.ts` | Spec S05 — the three route sites move together |
| `attachedListMoveCursor` | delegate method | `tug-filter-field.tsx` | Spec S02, replaces `filterFieldDidRequestAdvance` |
| `data-tug-attached-list` | DOM attribute | field wrappers | Spec S02 |
| `"view.keyboardFocus"` | menuItemId + NSMenuItem | `command-registry.ts`, `tugapp/Sources/AppDelegate.swift` | [P11] |

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tests/app-test/at0393-kbf-mode-division.test.ts` | OFF: no `data-key-view-kbd` anywhere, no cursor bar, arrows never move a ring; ON: rings + movement |
| `tests/app-test/at0394-open-quickly-arrows.test.ts` | ↓ selects first result on empty query; Tab reaches the directory switcher ([P07] case 2) |
| `tests/app-test/at0395-kbf-parked-stop.test.ts` | movement-arrived stop: ring + no caret, printable types and lands; seeded sheet field: ring + caret on open ([P12] seed rule) |
| `tests/app-test/at0396-kbf-escape-ladder.test.ts` | one Escape closes a sheet from a caret inside it |

(at0392 is the current highest at-number in `tests/app-test/`; confirm before authoring, the corpus moves.)
| `tugdeck/src/components/tugways/__tests__/kbf-derivation.test.ts` | Spec S01 unit coverage |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** (`bun test`, DOM-free) | the derivation (Spec S01), the park predicate (Spec S05), gesture-policy pure functions | every engine-policy branch |
| **App-test** (real Tug.app) | mode division, Open Quickly, parked stop, Escape ladder, the inverted at0345, rewritten at0341–43 | every user-visible behavior in this plan |
| **Drift prevention** | at0248/at0277/at0282 stay green with KBF force-engaged | descend machinery must be untouched |

#### Blast radius, and the probe migration {#blast-radius}

This phase touches the three most widely-covered files in the deck. As of 2026-08-10: **65** app-test files declare `@covers` on `focus-manager.ts`, **14** on `focus-ring.css`, **5** on `responder-chain-provider.tsx`; **60** files reference `data-key-view-kbd` and **27** reference `data-key-cursor`. Two consequences the plan budgets for rather than discovers:

- The selection `just app-test-changed` derives at #step-11 will be corpus-scale (~70 serialized app launches). That is the correct run and it is expensive; schedule it as the phase's closing act, not as an inner-loop check.
- `data-key-view-kbd` changes meaning ([P04]): it marks a *painted ring*, not a focus position. Any suite using it as a position probe in a surface that is mode-OFF must move to `[data-key-view]`. #step-5 runs this sweep as a survey **immediately after the gate lands**, over the 60 referencing files, so the migration is one bounded pass rather than 70 red results at the end.

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
| #step-4 | Attached-list contract | pending | — |
| #step-5 | The mode gate: rings and the ladder | pending | — |
| #step-6 | Parked text stop | pending | — |
| #step-7 | The deletions | pending | — |
| #step-8 | Menu item | pending | — |
| #step-9 | Doctrine surgery | pending | — |
| #step-10 | Test rework + new suites | pending | — |
| #step-11 | Integration checkpoint | pending | — |

**Why this order.** The paint gate and the ladder's mode gate are **one commit** (#step-5), and the attached-list contract lands before them. The alternative — gating the rings first and the movement stages several commits later — ships an app where mode OFF still walks the key view with nothing painted: focus moves invisibly for the length of the phase, which is a worse state than either endpoint and contradicts "every intermediate commit leaves the app working". And the arrow gate cannot precede the attached-list contract, because in mode OFF the session picker's filter reaches its rows today *through* the empty-input release; gating arrows before its replacement exists would break it for a commit.

#### Step 1: Engine bit, derivation, projection {#step-1}

**Commit:** `tugways(kbf): add the derived KBF mode bit and its data-kbf projection`

**References:** [P01] engine bit, [P02] projection, Spec S01, Spec S03, (#ladder-today)

**Artifacts:** `kbfManuallyEngaged`, `kbfEngaged()`, `setKbfManual`/`toggleKbfManual`, `KBF_ATTRIBUTE`, `FocusProjection.kbf`, the `applyProjection()` write; no consumer yet — behavior unchanged.

**Tasks:**
- [ ] Add the field + derivation to `FocusManager` (focus-manager.ts), reading `this.accessMode`, the active context's mode stack (**trapped entries only**, Spec S01), and the key card's registration (import the registry lookup; tolerate an unregistered componentId as `false`).
- [ ] Thread `kbf` through `computeProjection()`/`applyProjection()` per Spec S03 — the `data-kbf` write only; the `keyViewKbd` factor lands in #step-5 with the rest of the gate.
- [ ] Ensure every input mutation notifies, reprojects, **and re-realizes the current target** (mode push/pop, key-card adoption, access-mode set, manual set) — the cached `this.route` must never outlive a mode change (Spec S05).

**Tests:**
- [ ] `__tests__/kbf-derivation.test.ts`: manual on/off; trap with/without `kbf: false`; a **non-trapped descend scope does not engage**; background-card trap does not engage; accessibility overrides everything; `kbfAtRest` card.

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
- [ ] Add `kbfAtRest?: boolean` to `CardRegistration`; declare true on Lens, Jots, Settings, Keyboard, About, Gazette, Pulse, Devtools registrations; leave Session/Text/File-view/Diff/Hello absent. (Find each registration by grepping `registerCard` call sites for the componentIds in the brief's Class-B table. The brief could not name Pulse's `componentId` — resolve it here.)
- [ ] Apply the **empty-group check** to every card declared `true`, the same test that put the diff card at OFF (brief Q6): the card must register at least one focus stop, directly or through Tug components that register their own (a `TugPushButton` counts). A card that auto-engages onto nothing is a mode pointing at no ring.
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
- [ ] Provider-level default for `CYCLE_FOCUS_MODE` when no card handler claims it: toggle the bit and seed `focusFirstInMode()`. **Verify the fallback actually fires** — the registry entry is `routing: "key-card"` (`command-registry.ts`), and today only the session card and the gallery demo register a handler. If a key-card-routed action does not fall through the chain to a provider-level responder, ⌥⇥ is dead on the Lens and the diff card, which is precisely where the general mode needs it.
- [ ] Key-card change while engaged: seed the new key card's ring (commit-home / first-in-mode) in `adoptKeyCard`.
- [ ] Escape rung (6) in `actDispatchListener`'s ladder: base mode + `manuallyEngaged` → clear it, land the resting destination; sits **below** every existing rung.
- [ ] ⌥⇥ from a typing descend inside a forced mode re-engages to the ring ([P09]); never disengages a forced mode.

**Tests:**
- [ ] Unit: toggle/pointerdown/Escape transitions against Spec S04 where DOM-free; the rest lands in #step-10's app-tests.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx vite build`
- [ ] App: ⌥⇥ on a session card enters the cycle (ring on submit); ⌥⇥ again restores the caret; ⌘L to the Lens with the bit set keeps the mode; a click anywhere clears it.

---

#### Step 4: Attached-list contract {#step-4}

**Depends on:** #step-2

**Commit:** `tugways(kbf): list-attached fields own their vertical arrows in both modes`

**References:** [P08] attached list, Spec S02, [Q01], (#ladder-today)

**Tasks:**
- [ ] Ladder: yield ↑/↓ in `arrowNavListener` and `arrowFallbackListener` when the active element is inside `[data-tug-attached-list]` (before the release consults, which still exist until #step-7).
- [ ] `tug-filter-field.tsx`: add `attachedListMoveCursor` to the delegate; stamp the attribute on the wrapper when the delegate supplies it; field `onKeyDown` claims ↑/↓ through it; delete nothing yet.
- [ ] Adopt at the five sites (`lens-section-band.tsx`, `jots-card.tsx`, `session-card.tsx` picker, `resume-sheet.tsx`, `session-history-view.tsx`): map to each list's cursor.
- [ ] Open Quickly: stamp the attribute on the `TugCompletionPopup` field wrapper so the ladder yields and the popup's existing `onKeyDown` (ArrowDown/ArrowUp/Enter/Escape) finally runs on an empty query.

**Tests:**
- [ ] Unit: field-level policy (delegate present → arrows claimed; absent → untouched) where testable DOM-free.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx vite build`
- [ ] App: Open Quickly, empty query, ≥2 roots — ↓ highlights the first result (not the switcher); Lens filter — ↓ moves the section's row cursor with the caret staying put.

---

#### Step 5: The mode gate — rings and the ladder, in one commit {#step-5}

**Depends on:** #step-1, #step-3, #step-4

**Commit:** `tugways(kbf): rings and movement keys both answer to the mode bit`

**References:** [P04] ring gate, [P07] Tab, Risk R03, Risk R04, (#s03-data-kbf), (#blast-radius)

**Artifacts:** paint and movement stand down together — the point of the single commit is that no shipped state has focus moving invisibly.

**Tasks (paint):**
- [ ] `computeProjection()`: `keyViewKbd = (keyViewKeyboard || ringFollowsPointer) && kbfEngaged()` ([P04] mechanism 1). No CSS specificity anywhere is touched by this.
- [ ] `styles/focus-ring.css`: add the two `html:not([data-kbf])` suppressions from [P04] for `[data-key-cursor]` / `[data-key-within]` and the cursor bar's `::before`. Anchor on `html` for the reason the file's own `data-app-active` comment records.
- [ ] Sweep for paint sites the two mechanisms miss — specifically **pseudo-element** marks, which no `outline` suppression reaches: `grep -rn --include='*.css' 'data-key-cursor\]::\|data-key-within\]::\|data-key-view-kbd\]::' tugdeck/src tugdeck/styles`. Known today: `tug-list-view.css` and `tug-accordion.css` cursor bars, `jots-card.css`'s cell bar, the editor's `::after` key-view border.
- [ ] Delete the `[data-cycling="false"]` suppression block (subsumed — the flavor is now withheld outright in mode OFF) and the `[data-cycling="true"] [data-key-within]` block if the within suppression covers it; verify against the session card cycling visuals first.
- [ ] Leave `[data-default-ring]` / `persistentDefaultRing` (internal/tug-button.css) untouched by both mechanisms; visually check the two mode-OFF residual surfaces: the session entry's `data-tug-entry-default` promotion and the session-history view.

**Tasks (ladder):**
- [ ] `arrowNavListener` / `arrowFallbackListener`: gate the ring stages on `kbfEngaged()`. Mode OFF → the stages no-op (the release consults and repeat gates stay in place until #step-7 deletes them; the gate simply runs first). Mode ON → unchanged.
- [ ] `focusWalkListener` per [P07]: multi-line / `data-tug-tab-consume` surfaces keep Tab; a single-line `INPUT` with a caret, and the nowhere state, engage KBF and take one step; remove the native-Tab yield so a Tab the engine cannot spend is consumed.
- [ ] Dev-log warn (never a user-visible beep) when the walk is empty and the Tab is swallowed — the tripwire for a subtree that was never authored as engine stops.
- [ ] Route `advanceKeyViewFocus`'s other callers (the View menu's Next / Previous Keyboard Focus) through the same engage-and-step so they behave in mode OFF.

**Tasks (probe survey — do it here, while the change is one commit):**
- [ ] Grep the 60 app-test files referencing `data-key-view-kbd` and classify each use: *ring assertion* (keep — and it now also asserts the mode) vs *position probe* (migrate to `[data-key-view]`). Record the list; the migrations themselves land in #step-10.

**Tests:**
- [ ] Unit: the nowhere / single-line / multi-line Tab predicate; the projection's `keyViewKbd` factor.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx vite build`
- [ ] App: no ring anywhere at rest on a session card, and no list cursor bar in a mode-OFF list; rings appear the moment a sheet opens or ⌥⇥ engages; a Lens list still shows its cursor bar (Class-B engaged).
- [ ] App: mode OFF, arrows in the prompt move only the caret; click transcript prose → Tab paints a ring and steps; in the prompt, Tab still indents.

---

#### Step 6: Parked text stop {#step-6}

**Depends on:** #step-3, #step-5

**Commit:** `tugways(kbf): restore the parked text stop; printable and Return grant the caret`

**References:** [P12] parked stop, Spec S05, Risk R01, (#printable-grant), Spec S04

**Tasks:**
- [ ] Implement `parksTextStop()` per Spec S05, including both carve-outs: **accessibility mode never parks**, and a **seeded / explicitly-placed** text stop grants rather than parks.
- [ ] Thread the placement's `arrival` through `place()` / `realizeTarget` and record it with the target; movement performers (`moveKeyViewSpatial`, `moveKeyViewLinear`, `focusNext`/`focusPrevious`, the walk) pass `"movement"`, everything else `"placement"`. Do not infer it.
- [ ] Apply the predicate at **all three route sites** (Spec S05): `classifyRoute` (and rewrite its "never a per-call flag" comment), `focusKeyView`'s re-derivation, and `focusKeyView`'s `isBareNativeControl` grant branch — with the coordinator's `isBareNativeControl` legality read kept symmetric so the watchdog does not bless a caret the mode forbids.
- [ ] Printable-grant branch per #printable-grant (capture stage, synchronous grant, no preventDefault, IME/modifier/length gates); clears `manuallyEngaged`. Return-descend keeps its existing grant path; verify idempotency (the substrate's `view.hasFocus` guard).
- [ ] CSS: the parked stop's ring on the input area (the editor stop's registered element) paints under the #step-5 gate; the both-marks state (ring + live caret while engaged) needs no new rule — verify the editor's own key-view treatment (`::after` border, per the focus-ring.css comment) composes.
- [ ] D6 semantics: after a typing descend, Escape behaves per Spec S04 (manual already cleared → falls through; auto surface → rung 2 dismisses in one press).
- [ ] Invert `tests/app-test/at0345-editor-never-rings.test.ts`: parked stop rings; mode-OFF editor never rings; a seeded sheet field rings *and* carries the caret; rename if its name no longer describes it (keep the at-number).

**Tests:**
- [ ] Unit: `parksTextStop` truth table — movement vs placement, accessibility on/off, contract-bearing vs bare native control, descended vs not.
- [ ] at0345 (inverted) green; falsification check: force a mode-OFF ring and see it red.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx vite build`
- [ ] `just app-test tests/app-test/at0345-*.test.ts`
- [ ] App: ⌥⇥ → arrow onto the editor stop → ring, no caret; type "x" → caret live, "x" in the document, mode manual-cleared.
- [ ] App: open the rename sheet — caret in the field on open, ring painted, typing lands immediately (the seed rule). Same for the resume-sheet filter and a session question dialog with a text field.
- [ ] App: park a stop with a mid-document caret, then re-grant — the selection comes back where it was ([L23], R01).
- [ ] App: with accessibility keyboard-access mode on, every text stop still takes a caret.

---

#### Step 7: The deletions {#step-7}

**Depends on:** #step-4, #step-5, #step-6

**Commit:** `tugways(kbf): delete the release policy, boundary latch, and handoff contracts`

**References:** [P06] deletions, (#deletion-inventory), [P08]

**Tasks:**
- [ ] Execute the deletion inventory table verbatim, re-running its grep first.
- [ ] `arrowNavListener`/`arrowFallbackListener`: delete the release consults and the repeat gates outright — the mode gate landed in #step-5 already does the work, and what remains in mode OFF is the plain "a focused text surface owns its arrows" shape.
- [ ] Remove `filterFieldDidRequestAdvance` from the delegate and all five sites (superseded in #step-4).
- [ ] Delete the latch halves of the keymap unit tests; keep Cmd/Opt history coverage (`keymap-arrow-history.test.ts`).

**Tests:**
- [ ] `bun test` green with the deleted suites gone; no references remain (`grep` returns empty).

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx vite build`
- [ ] App: mode OFF — ↑ held at a non-empty prompt's top edge never leaves the editor; empty prompt — arrows still never leave; Lens filter arrows still drive rows (attached list, not release).

---

#### Step 8: Menu item {#step-8}

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

#### Step 9: Doctrine surgery {#step-9}

**Depends on:** #step-5, #step-6, #step-7

**Commit:** `tuglaws(kbf): rewrite focus-language for the mode division`

**References:** brief "Doctrine surgery" section, [P12], [P04], [P08]

**Tasks:**
- [ ] `tuglaws/focus-language.md`, per the brief's section list: mode division opens "Motion: two planes"; delete the boundary-latch paragraph, both empty-field-spends rules, the landing-grants rule, the never-wears-a-ring rule and its "the box, not the DOM node" corollary, and "Crossing out is always a discrete press"; rewrite "Three carriers" (wash keeps its job; ring absence in OFF is the rule); strengthen "plain arrows are caret keys" (unconditional in OFF; Cmd-history unaffected); **keep the three-in-a-row failure history as a note** explaining why the old rule existed and why the mode retires it; contract table gains the `data-kbf` gate row; authoring contract gains the attached-list contract and the `kbf: false` flag.
- [ ] Record the two rules an author cannot derive from the mode sentence alone: **a seeded text stop grants, a moved-to one parks** ([P12]), and **`data-key-view-kbd` means a painted ring, not a focus position** ([P04]) — the latter belongs in the contract table beside the attribute.
- [ ] Note the Tab split ([P07]): multi-line surfaces own Tab, single-line fields spend it on movement, and the engine never hands Tab to WebKit.
- [ ] Sweep the other laws for invalidated statements — `tuglaws/list-view-usage.md` (amended by `53233fdc6`) at minimum; `component-authoring.md` and `design-decisions.md` cross-references.
- [ ] No hard-wrapped prose.

**Tests:** none (doc step).

**Checkpoint:**
- [ ] A grep of `tuglaws/` for "boundary latch", "arrow-release", "onArrowExit", "onTabWhenEmpty", "enterAt" returns only historical notes that identify themselves as such.

---

#### Step 10: Test rework + new suites {#step-10}

**Depends on:** #step-5, #step-6, #step-7

**Commit:** `app-test(kbf): mode-division, open-quickly, parked-stop, and escape-ladder suites; arrow suites rewritten`

**References:** brief "Test impact", (#new-files), (#blast-radius), [P04], [P07], [P08], [P12], Risk R02

**Tasks:**
- [ ] Work the probe-migration list produced by #step-5's survey: every *position* probe on `data-key-view-kbd` in a mode-OFF surface moves to `[data-key-view]`; every *ring* assertion stays and now doubles as a mode assertion.
- [ ] Rewrite `at0341-lens-cross-section-arrows`, `at0342-picker-arrow-traversal` (KBF engaged at start where they exercise ring motion), and `at0343-prompt-arrow-latch-history` (latch half deleted; Cmd-history half kept).
- [ ] Run `at0248-lens-list-cursor-keys`, `at0277-lens-row-accessories-keyboard`, `at0282-lens-row-arrow-escape` with KBF force-engaged at test start; they must pass unmodified — a failure is an implementation leak into the descend machinery, fix the code not the test.
- [ ] Author the four new suites from #new-files (at0393–at0396, confirming the highest at-number first; `@covers` headers pointing at `focus-manager.ts`, `responder-chain-provider.tsx`, `tug-completion-popup.tsx`, `tug-filter-field.tsx` as appropriate).
- [ ] `just app-test-covers-check`.

**Tests:** the step *is* tests.

**Checkpoint:**
- [ ] `just app-test <the four new files> tests/app-test/at0341-*.test.ts tests/app-test/at0342-*.test.ts tests/app-test/at0343-*.test.ts tests/app-test/at0345-*.test.ts tests/app-test/at0248-*.test.ts tests/app-test/at0277-*.test.ts tests/app-test/at0282-lens-row-arrow-escape.test.ts`

---

#### Step 11: Integration checkpoint {#step-11}

**Depends on:** #step-8, #step-9, #step-10

**Commit:** `N/A (verification only)`

**References:** (#success-criteria), (#exit-criteria), (#blast-radius)

**Tasks:**
- [ ] `just app-test-changed` over the phase's full diff; run what it selects. Expect a corpus-scale selection (~70 serialized launches — see #blast-radius) and budget for it as a single closing run, not an inner-loop check.
- [ ] Manual pass: the Spec S04 table row by row on a real session card + Lens + one sheet; the IME first-character check (Risk R01 residual) with a non-Latin input source.
- [ ] Manual pass with accessibility keyboard-access mode on: every text stop takes a caret, every engine-routed stop still mirrors real focus ([P12] Class C carve-out).
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
| Open Quickly regression dead | new open-quickly app-test (at0394) |
| Mode division holds | mode-division app-test (at0393) |
| Text-first surfaces still open with a caret | parked-stop app-test (at0395), seed half |
| No double-Escape | escape-ladder app-test (at0396) |
| Full phase | `just app-test-changed` VERDICT |
