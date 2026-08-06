## Keyboard Command Cleanup — Chord Tiers, Moves, and ⌘. Parity {#keyboard-command-cleanup}

**Purpose:** Adopt the modifier-key algebra as written doctrine (`tuglaws/chord-tiers.md`), move nine keyboard shortcuts onto it, add Claim All / Disclaim All as registry commands, and make ⌘. a registry-backed twin of ⎋ everywhere a surface dismisses. This is the ground-clearing phase before the systematic menu-by-menu command audit.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-08-06 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The command table ([L30], `tugdeck/src/components/tugways/command-registry.ts`) made every chord a registry fact, but the chords themselves were assigned ad hoc over time. The design brief at `roadmap/keyboard-command-cleanup-brief.md` (decisions locked 2026-08-06) fixes that with a **modifier algebra**: two base tiers (⌘ universal, ⌃⌘ Tug machinery) and two operators (⇧ counterpart, ⌥ variant), from which every modifier set derives a one-sentence meaning. Several shipped chords violate the algebra (⇧⌘P Prompt Route, ⇧⌘C/⇧⌘H shade toggles, ⇧⌘M auto-message, ⌥⌘T Next Theme, ⌘I Insert File), two Changes-shade bulk verbs have no chords at all, and five components hand-match ⌘. instead of reading the `cancel-dialog` bindings from the registry.

This plan writes the algebra into `tuglaws/`, executes the chord moves, adds the two new commands, and converts the ⌘. hand-matchers — leaving a clean, explainable keymap before the menu-by-menu audit re-scores every remaining item against the tiers.

#### Strategy {#strategy}

- Doctrine first: land `tuglaws/chord-tiers.md` + the global design decision before any code moves, so every commit can cite the rule it implements.
- Chord moves are pure registry edits plus their Swift construction-literal twins and test-pin transcription updates — one commit, mechanically verifiable.
- New commands (Claim All / Disclaim All) follow the existing `commit-auto-message` scoped-binding precedent exactly; no new machinery.
- ⌘. parity is a matcher change, not a routing change: each of the five surfaces keeps its documented dismissal path and only the chord *match* moves to the registry.
- Everything renders chords via `commandShortcut(id)` / the keymap pane projection already, so display surfaces update for free; the work is the table, the Swift literals, and the pinned test expectations.

#### Success Criteria (Measurable) {#success-criteria}

- `tuglaws/chord-tiers.md` exists, is linked from `tuglaws/commands.md`, `tuglaws/tuglaws.md` ([L30]), and `tuglaws/INDEX.md`, and `tuglaws/design-decisions.md` carries a new **D126** entry (verify by reading the four files).
- Every chord in **Table T01** resolves to its new value through the real pipeline: the updated `SHIPPED_CHORDS` rows in `tugdeck/src/components/tugways/__tests__/command-routing-drift.test.ts` pass (`bun test`).
- The native menu bar shows the new chords: updated `STATIC_ITEMS` rows in `tests/app-test/at0168-menu-structure.test.ts` pass.
- ⌃⌘A / ⌃⇧⌘A appear as scoped rows for the new commands in the keymap pane projection (`buildKeymapRows` output includes them; unit-verifiable via `settings-keymap-rows.ts`).
- The five converted components contain no literal `metaKey && (key|code) === "."` match; each calls the shared registry-backed matcher (verify by grep).
- `bunx vite build` succeeds; `just app-test-changed` verdict PASS; registry lints (`lintCommandTable`, `lintActionCoverage`, `lintNativeLocked`, `lintChordCollisions`) pass at import (they throw in DEV and run in `command-registry.test.ts`).

#### Scope {#scope}

1. Author `tuglaws/chord-tiers.md`; add D126; cross-link commands.md / tuglaws.md / INDEX.md.
2. Move seven existing chords and re-home two more (Table T01) in `command-registry.ts`, with the four Swift construction-literal twins in `tugapp/Sources/AppDelegate.swift` and the pinned-test transcription updates.
3. Add `claim-all-changes` / `disclaim-all-changes` commands (⌃⌘A / ⌃⇧⌘A, composer-scoped) wired to `ChangesRouteController`.
4. Registry-backed ⌘. matcher; convert the five hand-matching components; add ⌘. parity to dismissal surfaces that today handle only ⎋.

#### Non-goals (Explicitly out of scope) {#non-goals}

- The systematic menu-by-menu audit (names, menuEligible/scope review, free-pool grants) — the follow-on phase this plan clears the ground for.
- Re-homing Cascade ⌃⌥C / Tile ⌃⌥T — deferred to the menu pass with the whole Window menu on the table (see [Q02]).
- Rebinding UI changes: scoped bindings remain visible-but-not-rebindable in the keymap pane (its documented [Q03] stance in `settings-keymap-rows.ts`).
- ⌘. in text-field *revert* contexts (filter field, value input, slider) — see [P06]; ⎋-revert is editing currency, not surface dismissal.
- Touching `NATIVE_LOCKED`, the substrate text-editing bindings (⌃U/⌃W/⌥F/⌥B), or the CM6 ⌘↩ submit / ⌘↑↓ history handlers (candidates for `ACTIONS_OUTSIDE_THE_TABLE` review in the audit phase, not here).
- Rewriting historical chord mentions inside existing `design-decisions.md` entries (D122–D124 reference ⇧⌘P/⇧⌘C as shipped at the time); D126 supersedes them going forward.

#### Dependencies / Prerequisites {#dependencies}

- The command registry / keymap registry architecture already on main ([L30], `commands.md`) — no schema work needed.
- `roadmap/keyboard-command-cleanup-brief.md` — the locked design source this plan implements.

#### Constraints {#constraints}

- **Warnings are errors** across the Rust workspace; Swift edits must build clean (`tugapp`).
- tugdeck changes must pass `bunx vite build` (the release rollup can fail where dev esbuild succeeds).
- App-tests run selectively: `just app-test-changed` (never the full corpus); every new/changed test keeps valid `@covers` lines.
- No `localStorage`; any persistence goes through tugbank (none is added here — overrides already live in `dev.tugtool.keymap`).
- Chords are identified by `KeyboardEvent.code` + four modifier flags; labels are display-only (`chord-format.ts`).

#### Assumptions {#assumptions}

- macOS reserved chords stay as listed in the brief (⌃⌘Q, ⌃⌘D, ⌃⌘Space, ⇧⌘3/4/5, ⇧⌘Q, ⇧⌘/, ⌥⌘⎋, ⌘Space, ⌘⇥, ⌘`, ⌃-arrows, ⌃Space); none of the new chords collide with them (⌃⌘C/H/T/I/M/A/P, ⌃⇧⌘A, ⌃⌥⌘P are all unreserved).
- User keymap overrides (tugbank `dev.tugtool.keymap`) are per-command binding lists; moving a *default* does not disturb an existing override (absent = registry default), so no migration is needed.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Gate for the Changes bulk-verb chords (DECIDED) {#q01-claim-gate}

**Question:** When are ⌃⌘A / ⌃⇧⌘A live — while the Changes shade is visible, or while commit mode is active?

**Why it matters:** A chord live at the wrong time either fires on invisible state or goes dead while the user is looking at the buttons it mirrors.

**Resolution:** DECIDED (see [P03]). Reading `session-card.tsx`'s `TOGGLE_CHANGES_VIEW` handler: raising the Changes shade *is* entering commit mode (`commitModeController.enter()`), and the handler's own comment says "Showing Changes is Changes mode." `tug-prompt-entry.tsx` already gates its `COMMIT_AUTO_MESSAGE` scoped registration on `commitActive` — the new bindings register at the same site under the same gate.

#### [Q02] Cascade/Tile ⌃⌥ home (DEFERRED) {#q02-cascade-tile}

**Question:** `window.cascade` ⌃⌥C and `window.tile` ⌃⌥T sit in a modifier set the algebra doesn't generate (⌃⌥ with no ⌘).

**Resolution:** DEFERRED to the menu-by-menu audit — candidate homes (⌃⌥⌘ window-arrangement) should be weighed with the whole Window menu on the table. `chord-tiers.md` records the anomaly explicitly so it reads as a known debt, not an endorsement.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Muscle-memory breakage for shipped chords | med | high (by design) | Keymap pane + menus show the new chords from one source; users can override any of them in Settings ▸ Keyboard | User feedback after ship |
| A missed test pin fails after a chord move | low | med | Deep dive [#pinned-tests] enumerates every pin found; step tasks include a repo-wide grep for the old chords | Any red test naming an old chord |
| ⌃⌘C dead in some focus context (WebKit/AppKit eats ⌃-chords?) | med | low | ⌃⌘P and ⌃⌘F already ship and work through the same pipeline; at0340's updated chord drive proves ⌃⌘C end-to-end | at0340 failure |
| ⌘. matcher changes double-fire cancel (local + global funnel) | med | low | The conversions keep each surface's existing propagation posture (documented per-surface in [#cancel-cluster]); only the match predicate changes | A dialog closing twice / beeping |

**Risk R01: at0253's ⇧⌘C collision workaround goes stale** {#r01-at0253-stale}

- **Risk:** `tests/app-test/at0253-commit-dialog.test.ts` documents avoiding the ⇧⌘C *chord drive* because headless key synthesis collided with ⌥⇧⌘C Copy-as-Plain-Text ([D117]); after the move to ⌃⌘C the workaround text is stale and the collision may no longer exist.
- **Mitigation:** Update the comment; do not rework the test's drive mechanism in this plan (behavior unchanged).
- **Residual risk:** None — comment-only.

---

### Design Decisions {#design-decisions}

#### [P01] The modifier algebra is doctrine, written to `tuglaws/chord-tiers.md` (DECIDED) {#p01-modifier-algebra}

**Decision:** Chord assignment follows two base tiers — **⌘ the universal tier** (verbs any Mac user knows + highest-frequency Tug verbs; digits are places) and **⌃⌘ the Tug tier** (Tug's own machinery: surfaces, shades, modes, themes, app-specific features) — and two operators that keep the key and add a modifier: **⇧ = the counterpart** (reverse / widen / undo) and **⌥ = the variant** (same verb, altered object or form). Composition gives every other set its meaning: ⌥⇧⌘ = both twists ("…as Plain Text"), ⌃⇧⌘ = counterpart of a Tug-tier command, ⌃⌥⌘ = variant/advanced form of a Tug-tier command (the "super-advanced" tier). Plain ⌥ and plain ⌃ letters are closed forever (glyph typing; the caret's emacs set), with ⌥⇥ and ⌃` grandfathered non-printing exceptions.

**Rationale:**
- Consistency, clarity, explainability — every chord's shape becomes a one-sentence derivation instead of a memorized fact.
- The algebra was already half-latent in shipped bindings (⌘V→⌥⌘V→⌥⇧⌘V; ⌘Z→⇧⌘Z; ⌘W→⌥⌘W), so adopting it moves few chords.

**Implications:**
- Spec S01 fixes the document's contents; the [L30] entry and `commands.md` gain cross-links so "Adding a command" step 1 includes picking the tier.
- Rules codified alongside: the pairing rule (a composed chord shares its key with its base), the arrows exemption (⌘/⌥⌘-arrow families have no letter base; ⇧ still means "to the extreme"), the scarcity rule (plain ⌘'s free slots — D, Y, J, E + punctuation — go only to many-times-an-hour commands), and ⌘. parity ([P05]).

#### [P02] Nine chords move in one commit, defaults only (DECIDED) {#p02-chord-moves}

**Decision:** Apply Table T01 as registry-default edits (plus Swift construction-literal twins and pinned-test transcriptions). User overrides are untouched; no migration.

**Rationale:**
- Overrides are per-command lists in tugbank where *absent means registry default* — a default move is exactly the case the override design already absorbs.
- One commit keeps the drift-test transcription honest: the test pins what shipped, and the commit that moves a chord is the commit that re-transcribes the pin.

**Implications:**
- Four Swift literals change in `buildMenuBar()` (`session.toggleChanges`, `session.toggleHistory`, `session.permissionMode.cycle`, `view.nextTheme`); `session.insertFile` needs no Swift edit (its `keyEquivalent` is `""` at construction; ⌘I arrives via the registry sweep and will arrive as ⌃⌘I the same way).
- Freed defaults returned to the pool and recorded in `chord-tiers.md`: ⇧⌘P, ⇧⌘C, ⇧⌘H, ⇧⌘M, ⌥⌘T, ⌘I.

#### [P03] Claim All / Disclaim All are first-responder commands scoped to the composer, gated on commit mode (DECIDED) {#p03-claim-commands}

**Decision:** Two new `TUG_ACTIONS` (`claim-all-changes`, `disclaim-all-changes`), two new `COMMANDS` entries with `routing: "first-responder"` and default bindings ⌃⌘A / ⌃⇧⌘A carrying `scope: { kind: "responder", responderId: COMPOSER_RESPONDER_SCOPE }`. `tug-prompt-entry.tsx` registers them via `useKeybindings` beside the existing `COMMIT_AUTO_MESSAGE` registration (same `commitActive` gate, chords read from `keymapRegistry.bindingsOf(...)`, never spelled again). `session-card.tsx` handles both in its `useResponder` actions map (the map that already holds `TOGGLE_CHANGES_VIEW`), calling `changesController.claim(paths)` / `changesController.disclaim(paths)`.

**Rationale:**
- The Changes shade is a **passive** sheet — the composer keeps focus while it is up (`session-changes-view.tsx` module doc) — so the composer's responder is where the chords are genuinely live; this is byte-for-byte the `commit-auto-message` precedent, which `commands.md` names as the sanctioned scoped pattern.
- ⌃⌘A joins the Changes neighborhood (⌃⌘C shade, ⌃⌘M message, ⌃⌘A claim); ⌃⇧⌘A is the ⇧-counterpart of ⌃⌘A per the algebra, one finger from its pair.

**Implications:**
- **Semantics** (mirrors the shade's bulk buttons, wired in `session-changes-view.tsx`): Claim All = `changesController.claim([...unattributed paths, ...orphaned paths])` from the controller snapshot (`snap.unattributed`, `snap.orphaned` — path arrays of `{path}` file lists); Disclaim All = `changesController.disclaim(entry.files paths)` from `snap.entry`. Handlers no-op when the relevant path list is empty or a claim/disclaim round-trip is pending (read the phase non-reactively from `changeset-verb-store` by `changesController.entryKey`, the same store `useChangesetClaim`/`useChangesetDisclaim` wrap).
- Door coverage: bindings are the door (no `menuItemId`), so `lintCommandTable` passes without `internal`. The keymap pane shows them as scoped, non-rebindable rows — the existing `[Q03]` stance.
- `command-routing-drift.test.ts` also carries a routing-expectation map (near the top of the file, `[TUG_ACTIONS.TOGGLE_CHANGES_VIEW]: "key-card"` etc.); add rows for both new ids as `"first-responder"`.

#### [P04] Next Theme's chord enters the registry (DECIDED) {#p04-next-theme-registry}

**Decision:** `next-theme` (today: registry entry with `menuItemId: "view.nextTheme"`, **no bindings** — the ⌥⌘T chord exists only as a Swift construction literal) gains a registry binding: ⌃⌘T with `menuEligible: true, preventDefault: true`. The Swift literal updates to ⌃⌘T as the pre-first-push default.

**Rationale:**
- [L30]: a chord that exists only as a Swift literal is invisible to the keymap pane, to overrides, and to `resolveChord`.
- Verified in `host-menu-state.ts`: an entry that is **not** `mirrored` still gets a chord claim in the push when `keymapRegistry.menuChords()` claims its menu item — so a binding alone suffices; no `mirrored`/gate work needed.

**Implications:** Next Theme becomes rebindable and appears in the keymap pane's View group for free (the row model groups by menu-item-id namespace).

#### [P05] ⌘. parity is a matcher change; routing stays per-surface (DECIDED) {#p05-cancel-matcher}

**Decision:** Add one exported helper in `keymap-registry.ts` — `isCancelChordEvent(event)` — that returns true when the event matches any `cancel-dialog` binding **except** Escape (`chordMatchesEvent` from `chord-format.ts` over `keymapRegistry.bindingsOf(TUG_ACTIONS.CANCEL_DIALOG)`, skipping `chord.key === "Escape"`). The five hand-matching components call it in place of their literal `metaKey && key === "."` predicates; each keeps its documented dismissal action and propagation posture unchanged. Escape stays exactly where it is today (engine ladder for alert/sheet/context-menu; local for placard).

**Rationale:**
- The five handlers are *not* naive bypasses — each documents why chain routing is unreliable for its surface (portaled popover whose buttons never promote; placard outside any focus mode). The [L30] defect is only the authored chord match, which also mis-matches by `event.key` label instead of `code` identity.
- Excluding Escape from the helper prevents the conversions from stealing Escape from the engine's ladder on surfaces that deliberately don't handle it locally.

**Implications:**
- A user rebind of Cancel updates every surface at once — the whole point of the funnel.
- `tug-editor-context-menu.tsx`'s extra `ctrlKey` alternative (`metaKey || ctrlKey`) is dropped: the registry chord is the one truth.

#### [P06] Parity scope: dismissal yes, field-revert no (DECIDED) {#p06-parity-scope}

**Decision:** ⌘. mirrors ⎋ wherever ⎋ *dismisses a surface or backs out of a mode* (alerts, sheets, popovers, placards, context menus, overlays, lightboxes). ⎋ that *reverts an in-field edit* (`tug-filter-field`, `tug-value-input`, `tug-slider`) stays Escape-only: that ⎋ is form-control currency inside a typing surface, and ⌘. there would be both surprising and outside macOS convention. This line is written into `chord-tiers.md`.

**Rationale:** The user's directive is "everywhere we now support escape usages to cancel, dismiss sheets and alerts, etc." — dismissal semantics. Field-revert is the one ⎋ family with different semantics (edit the value, not leave the surface).

**Implications:** The parity audit (List L01) classifies every non-engine ⎋ handler found by grep; included surfaces gain the helper, excluded ones get nothing.

#### [P07] One global design decision, D126 (DECIDED) {#p07-d126}

**Decision:** Append **D126** to `tuglaws/design-decisions.md` in the house style (bold-statement paragraph, trailing law/decision citations): the adoption of the chord-tier algebra, the Table T01 moves, the two new commands, and ⌘. parity — citing [L30], [D117] (the stale at0253 note), and superseding the chord spellings embedded in D122–D124 prose without editing those entries.

---

### Deep Dives {#deep-dives}

#### Where chords live and how they reach surfaces {#chord-plumbing}

- **Defaults** are `bindings` arrays on entries in `tugdeck/src/components/tugways/command-registry.ts` (the `COMMANDS` array), built by the `chord()` helper (global scope) or written literally for scoped bindings (`COMPOSER_RESPONDER_SCOPE`). There is no separate keymap data file.
- **Matching identity** is `KeyboardEvent.code` + the four modifier flags; `label` is display-only (`chord-format.ts`: `chordMatchesEvent`, `formatChord`, `codeToKeyEquivalent`).
- **The push:** `keymapRegistry.menuChords()` returns `Record<menuItemId, ChordSpec | null>` from the first `menuEligible` binding per entry; `host-menu-state.ts` folds it into the menuState `commands` block. Key fact verified for [P04]: a non-`mirrored` entry still receives a chord claim when its menu item is claimed (`if (!mirrored && !(menuItemId in chords)) continue;` — presence in `chords` is sufficient).
- **Swift side:** `applyCommandChords(in:)` in `tugapp/Sources/AppDelegate.swift` walks the menu tree writing `keyEquivalent` + mask from each gate's three-state chord (`.absent` keeps the construction literal, `.detach` clears, `.apply` writes). Construction literals in `buildMenuBar()` are pre-first-push defaults only — but they should still be edited to the new chords so a cold-start menu bar never flashes stale chords.
- **Display:** every UI surface renders via `commandShortcut(id)` (`keymap-registry.ts`) — e.g. `tug-prompt-entry.tsx` tooltip for the Changes toggle, `shell-interactive-staging.ts`, `help-content.ts`. These update automatically; no authored strings exist for the moved chords outside comments.

#### The five ⌘. hand-matchers {#cancel-cluster}

| File | Current match | Dismissal path (KEPT) | Notes |
|---|---|---|---|
| `tug-alert.tsx` (content `onKeyDown`) | `e.metaKey && e.key === "."` | `handleOpenChange(false)` | Escape is engine-ladder via `onEscapeDismiss`; Radix Escape suppressed |
| `tug-confirm-popover.tsx` (`handleKeyDown`) | same | `manager.sendToTarget(responderId, CANCEL_DIALOG)` (identity-routed; documented why first-responder routing is unreliable for the portaled popover) | Bubble-phase after the capture keybinding listener |
| `tug-sheet.tsx` (`handleKeyDown`) | same | `requestCancel()` | Escape engine-owned |
| `tug-placard.tsx` (document capture listener) | `key === "Escape" \|\| (key === "." && metaKey)` | `onCloseRef.current()`; deliberately does not preventDefault/stopPropagation | Keeps its local Escape (placards push no focus mode); becomes `key === "Escape" || isCancelChordEvent(e)` |
| `tug-editor-context-menu.tsx` (window capture) | `e.key === "." && (e.metaKey \|\| e.ctrlKey)` | `dismiss()` with preventDefault+stopPropagation | Drops the ctrl alternative per [P05] |

#### ⎋-surface parity audit seed {#escape-audit}

Grep basis: `key === "Escape"` handlers outside `__tests__` and outside modifier-guard contexts. Classification per [P06]:

**List L01: parity audit** {#l01-parity-audit}
- INCLUDE (dismissal): `dev-error-overlay.ts` (overlay dismiss), `src/components/tugways/body-kinds/image-block.tsx` (lightbox), `src/lib/markdown/enhance-img.ts` (image overlay), `src/components/tugways/cards/gallery-mutation-tx.tsx` (gallery-only surface — include for uniformity), `tug-text-editor/completion-extension.ts` (completion popup dismiss — include; the popup already handles its own keys, add the matcher beside its Escape branch).
- EXCLUDE (field-revert / engine-owned / archive): `tug-filter-field.tsx`, `tug-value-input.tsx`, `tug-slider.tsx` (revert semantics, [P06]); `responder-chain-provider.tsx` and `focus-act.ts` (the engine's own Escape plumbing — ⌘. already reaches the funnel as a global `cancel-dialog` binding); `settings-keymap-body.tsx` (chord-capture UI — ⎋/⌘. there are *recordable input*, never dismissal); `src/_archive/**` (dead).
- The implementer re-runs the grep at execution time and classifies any new hits by the same rule; the rule, not this snapshot, is the contract.

#### Tests that pin the moved chords {#pinned-tests}

- `tugdeck/src/components/tugways/__tests__/command-routing-drift.test.ts` — `SHIPPED_CHORDS` (chord → command-id pairs resolved through the real pipeline) pins ⇧⌘P (prompt route), ⌃⌘P (cycle permission), ⇧⌘C, ⇧⌘H; also a routing-expectation map keyed by `TUG_ACTIONS`. Update the four rows, add ⌃⌘T → `next-theme` (it gains a global binding), optionally ⌃⌘I → insert-file if a row exists for it (add if absent — the table welcomes additions). Updating this file is sanctioned transcription: the test pins shipped defaults, and this commit changes the shipped defaults.
- `tests/app-test/at0168-menu-structure.test.ts` — `STATIC_ITEMS` pins `session.permissionMode.cycle` (`p`, command|control → becomes command|control|option) and `session.insertFile` (`i`, command → becomes command|control). Neither shade toggle nor `view.nextTheme` is pinned there (View is dynamic; the shade items aren't in the static table).
- `tests/app-test/at0340-composer-routes.test.ts` — *drives* ⇧⌘C and ⇧⌘P as key events and asserts route state; update both drives to ⌃⌘C / ⌃⌘P (assertion text mentions the chords too).
- `tests/app-test/at0253-commit-dialog.test.ts` — comment-only reference to the old ⇧⌘C collision (Risk R01).
- `tests/app-test/at0179-dynamic-keybinding.test.ts`, `at0181-keymap-chord-sweep.test.ts`, `at0182-keymap-override.test.ts` — read the registry dynamically; expected to pass unchanged, but grep them for literal old chords before declaring done.
- Sweep command for stragglers: `grep -rn '⇧⌘C\|⇧⌘H\|⇧⌘P\|⇧⌘M\|⌥⌘T' tugdeck/src tests/app-test tugapp/Sources` (labels appear in comments and assertion messages; fix the ones describing the moved commands, leave e.g. ⌥⇧⌘C alone).

#### Comment debt riding the moves {#comment-debt}

Stale prose to update in the same commits (comments state what the code does — no history, per repo comment rules):
- `command-registry.ts` `select-composer-route:prompt` entry comment ("promoting ⇧⌘P would take a plain letter chord…") — rewrite for ⌃⌘P citing chord-tiers.
- `command-registry.ts` `commit-auto-message` comment ("⇧⌘M, live only while…") → ⌃⌘M.
- `session-card.tsx` handler comments naming ⇧⌘C / ⇧⌘H (the `TOGGLE_CHANGES_VIEW` / `TOGGLE_HISTORY_VIEW` actions-map entries) and any "⌃⌘C alias" mention.
- `tug-prompt-entry.tsx` "⇧⌘M invokes Auto-Message" comment → ⌃⌘M.
- `session-changes-view.tsx` module doc and header comment ("⇧⌘C is the toggle" / "dismissed by ⇧⌘C") → ⌃⌘C.
- `lib/help-content.ts` and `lib/shell-interactive-staging.ts` render chords via `commandShortcut` — verify no authored chord strings; update label text only if a literal appears.

---

### Specification {#specification}

**Table T01: Chord moves and additions** {#t01-chord-moves}

| Command id | Entry today | New default binding (code + flags, label) | Swift literal edit |
|---|---|---|---|
| `select-composer-route:prompt` | `KeyP` meta+shift | `KeyP` ctrl+meta, label "p" | none (no menu item) |
| `cycle-permission-mode` | `KeyP` ctrl+meta | `KeyP` ctrl+alt+meta, label "p" | `session.permissionMode.cycle`: mask `[.command,.control]` → `[.command,.control,.option]` |
| `toggle-changes-view` | `KeyC` meta+shift | `KeyC` ctrl+meta, label "c" | `session.toggleChanges`: `[.command,.shift]` → `[.command,.control]` |
| `toggle-history-view` | `KeyH` meta+shift | `KeyH` ctrl+meta, label "h" | `session.toggleHistory`: `[.command,.shift]` → `[.command,.control]` |
| `commit-auto-message` | `KeyM` meta+shift, composer-scoped | `KeyM` ctrl+meta, label "m", same scope | none (no menu item) |
| `next-theme` | **no bindings** (Swift literal ⌥⌘T only) | ADD `KeyT` ctrl+meta, label "t", `menuEligible`, `preventDefault` | `view.nextTheme`: `[.command,.option]` → `[.command,.control]` |
| `insert-file` | `KeyI` meta, `menuEligible` | `KeyI` ctrl+meta, label "i", keep `menuEligible`+`preventDefault` | none (construction `keyEquivalent` is `""`) |
| `claim-all-changes` (NEW) | — | `KeyA` ctrl+meta, label "a", composer-scoped, `preventDefault` | none |
| `disclaim-all-changes` (NEW) | — | `KeyA` ctrl+meta+shift, label "a", composer-scoped, `preventDefault` | none |

All moved global bindings keep their existing `preventDefault`/`menuEligible` options unless the table says otherwise. Freed defaults: ⇧⌘P, ⇧⌘C, ⇧⌘H, ⇧⌘M, ⌥⌘T, ⌘I.

**Spec S01: `tuglaws/chord-tiers.md` contents** {#s01-chord-tiers-doc}

Transcribe Part 1 of `roadmap/keyboard-command-cleanup-brief.md` into tuglaws house style (italic thesis line up top, `*Cross-references:*` line citing [L30], commands.md, menus.md, design-decisions.md; no hard-wrapped prose):
1. The algebra — two base tiers, two operators, the composed sets with their one-liners, closed sets with the two grandfathered exceptions.
2. The six rules: pairing, arrows exemption, scarcity, closed sets, ⌘. parity (with the [P06] dismissal-vs-revert line), menu-placement-is-a-chord-decision (cite commands.md four-layer resolution).
3. The free-pool ledger: plain-⌘ free letters ranked with convention caveats (D, Y safest; J, E claimable; B, U, P reserved with reasons; punctuation ⌘' ⌘; ⌘\ free; ⌘[ ⌘] reserved for navigation), digits taken, and the six freed chords from Table T01.
4. The macOS never-bind list (from #assumptions).
5. Known anomalies: Cascade/Tile ⌃⌥ ([Q02] deferral), the ⌥⌘/ DevTools wink, ⌘T maker-debug-only.
6. Cross-links back: commands.md "Adding a command" gains a tier-selection clause; [L30]'s law text in tuglaws.md gains a pointer sentence; INDEX.md gains a one-line entry.

**Spec S02: `isCancelChordEvent`** {#s02-cancel-matcher}

```ts
// keymap-registry.ts
export function isCancelChordEvent(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): boolean
```
Returns true iff the event matches any binding of `TUG_ACTIONS.CANCEL_DIALOG` whose `chord.key !== "Escape"`, via `chordMatchesEvent`. Reads the singleton `keymapRegistry` so overrides apply. Accepts both native and React keyboard events structurally. No Escape matching — Escape ownership is per-surface ([P05]).

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone (appearance / local-data / structure) | Mechanism | Law |
|-------|--------------------------------------------|-----------|-----|
| (none new) | — | Chord moves are registry data edits; claim/disclaim handlers call the existing `ChangesRouteController` + `changeset-verb-store`; scoped bindings ride the existing `useKeybindings` registration in `tug-prompt-entry.tsx` | [L02] (stores already wired), [L30] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tuglaws/chord-tiers.md` | The modifier-algebra doctrine (Spec S01) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TUG_ACTIONS.CLAIM_ALL_CHANGES` | const `"claim-all-changes"` | `tugdeck/src/components/tugways/action-vocabulary.ts` | [P03]; name per action-naming.md |
| `TUG_ACTIONS.DISCLAIM_ALL_CHANGES` | const `"disclaim-all-changes"` | same | |
| `claim-all-changes` / `disclaim-all-changes` entries | `CommandEntry` ×2 | `command-registry.ts` | first-responder routing, composer-scoped bindings (Table T01) |
| 7 edited `bindings` | data | `command-registry.ts` | Table T01 moves |
| `isCancelChordEvent` | fn | `keymap-registry.ts` | Spec S02 |
| Claim/disclaim action handlers | entries in `useResponder` actions map | `cards/session-card.tsx` | beside `TOGGLE_CHANGES_VIEW`; call `changesController` |
| Scoped-binding registration | extend the `commitKeybindings` memo | `tug-prompt-entry.tsx` | same `commitActive` gate, `bindingsOf` both new ids |
| 4 `keyEquivalent`/mask literals | data | `tugapp/Sources/AppDelegate.swift` (`buildMenuBar`) | Table T01 rightmost column |
| `SHIPPED_CHORDS` + routing map rows | test data | `__tests__/command-routing-drift.test.ts` | [#pinned-tests] |
| `STATIC_ITEMS` rows ×2 | test data | `tests/app-test/at0168-menu-structure.test.ts` | permissionMode.cycle, insertFile |
| Chord drives | test edits | `tests/app-test/at0340-composer-routes.test.ts` | ⌃⌘C / ⌃⌘P |
| **D126** | decision entry | `tuglaws/design-decisions.md` | [P07] |

---

### Documentation Plan {#documentation-plan}

- [ ] `tuglaws/chord-tiers.md` (Spec S01)
- [ ] `tuglaws/commands.md` — cross-link in the Chords section + Cross-References list + "Adding a command" step 1 tier clause
- [ ] `tuglaws/tuglaws.md` — one pointer sentence in [L30]
- [ ] `tuglaws/INDEX.md` — one-line entry
- [ ] `tuglaws/design-decisions.md` — D126

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (bun)** | Registry lints, drift-test chord/routing transcriptions, keymap-row projection for the new scoped commands | Steps 2–4 |
| **App-test (selective)** | Native menu chord masks (at0168), end-to-end chord drive (at0340), keymap sweep/override invariants (at0181/at0182) | Step 2, integration |
| **Drift Prevention** | `SHIPPED_CHORDS` re-transcription is the new pin; `lintActionCoverage` forces the new actions into the table | Steps 2–3 |

#### What stays out of tests {#test-non-goals}

- End-to-end app-test of ⌃⌘A/⌃⇧⌘A claiming real changeset entries — the app-test replay workspace's changeset entries are transient (~2s), so long Changes-shade flows are not app-testable by standing precedent; coverage is the registry/unit layer (dispatch + lints + row projection) plus the existing Rust round-trip tests for claim/disclaim verbs.
- jsdom render tests and mock-store assertions — banned patterns.
- Re-testing the five converted surfaces' dismissal behaviors — unchanged routing; only the match predicate moved (covered by grep-based success criterion + existing suites).

---

### Execution Steps {#execution-steps}

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Doctrine: chord-tiers.md, D126, cross-links | pending | — |
| #step-2 | Chord moves: registry, Swift literals, pinned tests | pending | — |
| #step-3 | Claim All / Disclaim All commands | pending | — |
| #step-4 | ⌘. matcher + parity sweep | pending | — |
| #step-5 | Integration checkpoint | pending | — |

#### Step 1: Doctrine — chord-tiers.md, D126, cross-links {#step-1}

**Commit:** `tuglaws(chord-tiers): adopt the modifier algebra for chord assignment; D126`

**References:** [P01] modifier algebra, [P06] parity scope, [P07] D126, Spec S01, [Q02] deferral, (#context, #documentation-plan)

**Artifacts:**
- `tuglaws/chord-tiers.md`; edits to `commands.md`, `tuglaws.md` ([L30]), `INDEX.md`, `design-decisions.md` (D126).

**Tasks:**
- [ ] Author `tuglaws/chord-tiers.md` per Spec S01, sourcing content from `roadmap/keyboard-command-cleanup-brief.md` Part 1; include Table T01's moves as the worked example and the freed-pool ledger.
- [ ] Add the cross-links (commands.md Chords section + Cross-References + Adding-a-command step 1; tuglaws.md L30 pointer; INDEX.md line).
- [ ] Append D126 to `design-decisions.md` in house style ([P07]); do not edit D122–D124 prose.

**Tests:**
- [ ] None (docs); links resolve by inspection.

**Checkpoint:**
- [ ] Every relative link in the new/edited docs resolves (`grep -o '\](\S*\.md[^)]*)' tuglaws/chord-tiers.md` and open each; anchors named in this plan exist).

---

#### Step 2: Chord moves — registry, Swift literals, pinned tests {#step-2}

**Depends on:** #step-1

**Commit:** `tugways(keymap): move seven chords onto the chord-tier algebra`

**References:** [P02] chord moves, [P04] next-theme registry, Table T01, Risk R01, (#chord-plumbing, #pinned-tests, #comment-debt)

**Artifacts:**
- Edited `bindings` on seven entries in `command-registry.ts`; four Swift literals in `AppDelegate.swift`; updated `SHIPPED_CHORDS`/`STATIC_ITEMS`/at0340 drives; comment updates.

**Tasks:**
- [ ] Apply Table T01's seven move/add rows (all but the two NEW commands) in `command-registry.ts`, updating the entry comments listed in [#comment-debt].
- [ ] Edit the four `buildMenuBar()` literals (Table T01 rightmost column) in `tugapp/Sources/AppDelegate.swift`.
- [ ] Update `SHIPPED_CHORDS` (⌃⌘P prompt-route, ⌃⌥⌘P cycle-permission, ⌃⌘C, ⌃⌘H; add ⌃⌘T next-theme and ⌃⌘I insert-file rows) in `command-routing-drift.test.ts`.
- [ ] Update `STATIC_ITEMS` in `at0168-menu-structure.test.ts` (permissionMode.cycle mods, insertFile mods) and the chord drives + assertion text in `at0340-composer-routes.test.ts` (⇧⌘C→⌃⌘C, ⇧⌘P→⌃⌘P); refresh the stale at0253 comment (Risk R01).
- [ ] Run the straggler grep from [#pinned-tests] and fix remaining prose/comments describing the moved chords (leave ⌥⇧⌘C/⌥⇧⌘V alone).
- [ ] Rebuild Tug.app (Swift changed) so app-tests exercise the new literals.

**Tests:**
- [ ] `cd tugdeck && bun test src/components/tugways/__tests__/command-routing-drift.test.ts src/components/tugways/__tests__/command-registry.test.ts`
- [ ] `just app-test-changed` (expect at0168, at0340, at0181, at0182, at0179 in the derived selection).

**Checkpoint:**
- [ ] Both bun test files green; `bunx vite build` succeeds; `just app-test-changed` VERDICT PASS.

---

#### Step 3: Claim All / Disclaim All commands {#step-3}

**Depends on:** #step-2

**Commit:** `tugways(changes): Claim All ⌃⌘A and Disclaim All ⌃⇧⌘A as registry commands`

**References:** [P03] claim commands, [Q01] gate, Table T01 (NEW rows), (#symbols, #state-zone-mapping)

**Artifacts:**
- Two `TUG_ACTIONS` constants; two `COMMANDS` entries; extended `commitKeybindings` memo in `tug-prompt-entry.tsx`; two handlers in `session-card.tsx`; drift-test routing rows.

**Tasks:**
- [ ] Add `CLAIM_ALL_CHANGES`/`DISCLAIM_ALL_CHANGES` to `action-vocabulary.ts` (kebab-case per action-naming.md, placed in the vocabulary's session/changes grouping).
- [ ] Add the two `CommandEntry` rows (Table T01 NEW rows): `routing: "first-responder"`, titles **"Claim All Changes"** / **"Disclaim All Changes"**, composer-responder-scoped bindings, `preventDefault: true`; entry comments state the commit-mode gate and the shade-button twinning.
- [ ] Extend the `commitKeybindings` memo in `tug-prompt-entry.tsx` to also map `bindingsOf` both new ids (same `commitActive` gate, same KeyBinding projection).
- [ ] Add both handlers to the `useResponder` actions map in `cards/session-card.tsx` (beside `TOGGLE_CHANGES_VIEW`): compute paths per [P03] semantics from `changesController.getSnapshot()`, guard on empty paths and on a pending claim/disclaim phase read non-reactively from `changeset-verb-store` by `changesController.entryKey`, then call `changesController.claim(paths)` / `.disclaim(paths)`.
- [ ] Add the two routing-expectation rows in `command-routing-drift.test.ts`.

**Tests:**
- [ ] `command-registry.test.ts` (lints: door coverage sees bindings; `lintActionCoverage` sees both wires) and `command-routing-drift.test.ts` green.
- [ ] Unit-verify the keymap-pane projection: `buildKeymapRows` output includes both commands as scoped rows (extend an existing `settings-keymap-rows` test if one exists; otherwise assert via a small addition there).

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/components/tugways/__tests__/` green; `bunx vite build` succeeds; manual smoke in the debug app: with the Changes shade up, ⌃⌘A claims the unattributed bucket and ⌃⇧⌘A disclaims the session entry.

---

#### Step 4: ⌘. matcher + parity sweep {#step-4}

**Depends on:** #step-1

**Commit:** `tugways(cancel-chord): registry-backed ⌘. matcher; parity on dismissal surfaces`

**References:** [P05] cancel matcher, [P06] parity scope, Spec S02, List L01, (#cancel-cluster, #escape-audit)

**Artifacts:**
- `isCancelChordEvent` in `keymap-registry.ts`; five converted components; parity additions on List L01's INCLUDE surfaces.

**Tasks:**
- [ ] Implement `isCancelChordEvent` per Spec S02.
- [ ] Convert the five surfaces in [#cancel-cluster], preserving each dismissal path and propagation posture exactly; drop the context menu's `ctrlKey` alternative.
- [ ] Re-run the ⎋ grep from [#escape-audit], classify per [P06], and add the matcher beside the Escape branch on each INCLUDE surface (dev-error-overlay, image lightbox paths, gallery-mutation-tx, completion popup).
- [ ] Verify no literal ⌘. match remains: `grep -rn 'key === "\."\|code === "Period"' tugdeck/src --include='*.ts*'` returns only `keymap-registry.ts`/`chord-format.ts`/registry data.

**Tests:**
- [ ] Existing suites for the five surfaces stay green (no behavioral change intended).

**Checkpoint:**
- [ ] Grep criterion above holds; `bunx vite build` succeeds; manual smoke: ⌘. closes an alert, the confirm popover, a sheet, a placard, and the editor context menu; ⌘. dismisses the completion popup and an image lightbox.

---

#### Step 5: Integration Checkpoint {#step-5}

**Depends on:** #step-2, #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #test-plan-concepts)

**Tasks:**
- [ ] Confirm every success criterion in [#success-criteria], including the keymap pane visually showing the new tier layout (Settings ▸ Keyboard) and the Session/View menus showing ⌃⌘C/⌃⌘H/⌃⌥⌘P/⌃⌘T/⌃⌘I.

**Tests:**
- [ ] `cd tugdeck && bun test src/components/tugways/__tests__/` (full tugways unit slice).

**Checkpoint:**
- [ ] `bunx vite build` clean; `just app-test-changed` VERDICT PASS across the full working diff.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The chord-tier doctrine on paper in `tuglaws/`, all nine chord moves/additions live through the registry with menus/keymap-pane/tests agreeing, and ⌘. behaving as ⎋'s twin on every dismissal surface.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] All five steps `done` in the ledger with commits recorded (user lands them).
- [ ] Success criteria in [#success-criteria] each verified.
- [ ] [Q02] recorded as deferred in `chord-tiers.md`'s anomalies section.

**Acceptance tests:**
- [ ] `command-routing-drift.test.ts`, `command-registry.test.ts` green.
- [ ] `just app-test-changed` VERDICT PASS.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] The systematic menu-by-menu command audit (names, tiers, menuEligible/scope per chord, free-pool grants).
- [ ] Cascade/Tile ⌃⌥ re-home ([Q02]).
- [ ] `ACTIONS_OUTSIDE_THE_TABLE` review of the CM6 ⌘↩ submit and ⌘↑↓ history handlers.

| Checkpoint | Verification |
|------------|--------------|
| Doctrine linked | chord-tiers.md reachable from commands.md, tuglaws.md [L30], INDEX.md |
| Chords moved end-to-end | at0168 + at0340 + drift test green |
| New commands live | keymap-pane rows + manual ⌃⌘A/⌃⇧⌘A smoke |
| ⌘. parity | grep criterion + manual smoke across the six surfaces |
