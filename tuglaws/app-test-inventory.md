# AT-Tag Inventory

Canonical registry of AT-tags — the persistent inventory of selection / focus / state-persistence regression cases that the app-test harness gates. AT-tags are stable, append-only identifiers; once assigned, a number is never reused. Tests live in `tests/app-test/at{NNNN}-*.test.ts` and their filename `at{NNNN}` prefix MUST match an entry in this inventory.

The selection-plan history (`roadmap/tugplan-selection.md`) captures the elaborated rationale, mechanism, closing-requires, and architectural cross-links for each tag. This file is the *index* — the quick map from tag → status → gating test(s) → one-line summary. When the two diverge, the selection plan's per-tag block is authoritative for design intent; this inventory is authoritative for tag numbering and current status.

> **History:** This file was previously named `m-series-inventory.md` and used an `M{NN}` two-digit prefix. The 2026-04-27 cleanup renamed it to `app-test-inventory.md` and renumbered every tag `M{NN}` → `AT{NNNN}` (1:1 mapping; e.g. `M01` → `AT0001`, `M38` → `AT0038`). See `roadmap/tugplan-app-test-cleanup.md` for the rationale.

## Conventions

- **Tag format:** `[AT{NNNN}]` — four-digit zero-padded.
- **Status legend:**
  - ✅ Closed — fix landed; gating test(s) pass.
  - ⚠️ Partial — some axis closed, residual axis open or deferred.
  - ❌ Open — no fix; gating test absent or failing-by-design.
  - ❓ Untested — no gating test exists yet; behavior unverified.
  - ⬛ Not-a-feature — closed-as-WONTFIX with a documented decision.
  - 🔧 Infra — infrastructure gap that blocks other tags; not a user-visible bug per se.
- **Gating tests:** filenames listed point to `tests/app-test/`. Multiple tests per tag are allowed (e.g., FC half + EM half, or rapid-cadence variant).
- **Numbering invariant:** test filename's `at{NNNN}` prefix MUST match a tag in this inventory. If a test gates a regression that isn't in the inventory, *add a tag first*, then name the test.

## Adding a new tag

1. Pick the next unused `AT{NNNN}`. The current high-water mark is **AT0181**. Gaps with no test file today: AT0008/0011/0012/0013/0015 are infra/decision/deferred tags (see entries); AT0028/0029 deferred; AT0036/0047/0062–0066/0072–0077/0079/0089 are retired or never-filled; AT0123/0124/0129/0130/0132–0135 are unused.
2. Add an entry below in the appropriate section (or create a section).
3. State, in one line each: card types, state axes, trigger, status.
4. Cross-link the elaborated entry in `roadmap/tugplan-selection.md` if applicable.
5. Add the gating test as `tests/app-test/at{NNNN}-{slug}.test.ts`.

> **Collision renumbering (2026-06-11 reconciliation).** Six AT numbers previously had **two test files gating unrelated regressions** — a violation of the "one tag = one regression" rule (multiple files per tag are allowed only for halves of the *same* regression, e.g. an FC half + EM half). Resolved: in each pair the earlier-authored file kept the number and the later interloper moved to a fresh tag (AT0175–AT0180). The moves: `at0051-session-mount-focus` → **AT0175**; `at0104-tab-accepts-completion` → **AT0176**; `at0105-permission-cycle-keys` → **AT0177**; `at0106-sheet-focus-trap` → **AT0178**; `at0107-dynamic-keybinding` → **AT0179**; `at0163-list-accessory-keyboard` → **AT0180** (here `sheet-focus-language` predated the accessory test, so AT0163 stays with `sheet-focus-language`).
>
> **Tag reuse.** Four tags were reused after their original meaning was retired/deferred — the entries below document the current meaning: **AT0024**, **AT0025** (now prompt-state round-trips, formerly component-protocol structural tags), **AT0070**, **AT0071** (now TugDevPanel tags, formerly deferred FileBlock / retired find-fixture tags).

## Inventory

### Harness-floor tag (AT0000)

#### [AT0000] Smoke — launch and quit
- **Status:** ✅ closed.
- **Tests:** `at0000-smoke.test.ts`.
- **Summary:** Simplest possible app-test: `launchTugApp` completes the handshake (asserts a non-empty surface version), then `close`. No scenario, no native events, AX preflight skipped. A failure here points at build / signing / bridge, not any scenario under test.

### Transition-class tags (AT0001–AT0023)

In-session transitions, focus restore paths, and cross-card selection. Surfaced from the selection plan's pre-25 audit.

#### [AT0001] Intra-pane tab switch — FC focus loss
- **Status:** ✅ closed.
- **Tests:** `at0001-tab-switch-fc.test.ts`, `at0001-rapid-cadence.test.ts`.
- **Summary:** FC card loses focus when its tab deactivates (via `display: none` blur); on return, refocus + selection paint must restore. Rapid-cadence variant exercises back-to-back tab clicks.

#### [AT0002] Intra-pane tab switch — EM focus loss
- **Status:** ✅ closed.
- **Tests:** `at0002-tab-switch-em.test.ts`.
- **Summary:** Same shape as AT0001 for engine-managed cards (dev, gallery-prompt-input, gallery-prompt-entry); engine root re-focuses + selection paint restores on return.

#### [AT0003] Pane activation change
- **Status:** ✅ closed.
- **Tests:** `at0003-pane-activation.test.ts`, `at0003-rapid-cadence.test.ts`.
- **Summary:** Cross-pane activation must flip `isFocusDestination` and refocus the new active card's input.

#### [AT0004] App resign → become-active focus restore
- **Status:** ✅ closed.
- **Tests:** `at0004-app-resign-return.test.ts`.
- **Summary:** Cmd-tab away + back must re-apply `bag.focus` for the deck-level first responder.

#### [AT0005] App hide → unhide
- **Status:** ✅ closed.
- **Tests:** `at0005-app-hide-unhide.test.ts`.
- **Summary:** Cmd-H hide / unhide cycle — same focus-restore contract as AT0004.

#### [AT0006] Cross-pane move — focus restore
- **Status:** ✅ closed.
- **Tests:** `at0006-cross-pane-drag.test.ts` (FC half), `at0006-em-cross-pane.test.ts` (EM half).
- **Summary:** Drag a card from pane A to pane B; the dropped card receives focus + selection paint.

#### [AT0007] Card detach
- **Status:** ✅ closed.
- **Tests:** `at0007-card-detach.test.ts` (FC half), `at0007-em-card-detach.test.ts` (EM half).
- **Summary:** Drag a card out of its pane into a new standalone pane; same shape as AT0006.

#### [AT0008] `onCardActivated` hook — infrastructure
- **Status:** ✅ closed (infra landed at Step 23B).
- **Tests:** N/A — covered by the AT0002/AT0004/AT0005/AT0006/AT0007/AT0009 EM-half tests above.
- **Summary:** Optional `onCardActivated?(): void` callback in `CardPersistenceCallbacks`; EM content factories implement it. Closes the M-Q2 design question.

#### [AT0009] Inactive-mount EM card
- **Status:** ✅ closed.
- **Tests:** `at0009-em-inactive-mount.test.ts`.
- **Summary:** EM card mounts in an inactive tab; engine's `setSelectedRange` no-ops on a `display: none` root. On user-activate, the activation hook re-focuses + reapplies selection.

#### [AT0010] Markdown-view copy-selection persistence
- **Status:** ✅ closed at Step 25B.
- **Tests:** `at0010-markdown-selection.test.ts`, `at0010-cold-boot-selection.test.ts`.
- **Summary:** `tug-markdown-view` opts into the [A9] state preservation protocol (see [state-preservation.md](state-preservation.md)); copy-selection round-trips through `bag.domSelection` + selectionGuard's CSS Custom Highlight.

#### [AT0011] Card close → reopen
- **Status:** ⬛ not-a-feature (M-Q4 resolution).
- **Tests:** N/A.
- **Summary:** No reopen UI path is planned. Close-on-flush remains for crash-recovery only.

#### [AT0012] IME composition mid-transition
- **Status:** ❌ open.
- **Tests:** none yet (gated behind a CJK / IME availability check, planned for [25J]).
- **Summary:** New `bag.markedText` axis required to preserve in-flight composition buffer across transitions. Out of scope for the 25C–25G core selection-plan series.

#### [AT0013] Integration test coverage for in-session transitions
- **Status:** ✅ closed by the AT-tag-specific tests landed across 25A–25K.
- **Tests:** every other AT-tag's gating tests collectively.
- **Summary:** Originally framed as "no integration tests exist for tab switch / pane activation / etc." — addressed not by extending one mega-test file but by landing a focused `m{NN}-*.test.ts` per AT-tag. The inventory itself is the integration test plan; coverage is complete iff every Closed/Partial tag has a green gating test.

#### [AT0014] Scroll persistence
- **Status:** ✅ closed.
- **Tests:** `at0014-scroll-persistence.test.ts`, `at0014-cold-boot-scroll.test.ts`.
- **Summary:** `bag.regionScroll` round-trips across tab switch + cmd-tab on `gallery-markdown-50kb`.

#### [AT0015] Legacy `saveSelection` / `restoreSelection` / `SavedSelection`
- **Status:** ⚠️ partial — production callers retired, surface still exists for test compatibility.
- **Tests:** `selection-persistence-greps.test.ts` (grep contract).
- **Summary:** API still exported from `selection-guard.ts`; remaining call sites are inside the file's own test fixtures. Retire fully when no test depends on the surface.

#### [AT0016] Tab close — focus handoff to neighbor
- **Status:** ✅ closed.
- **Tests:** `at0016-tab-close-handoff.test.ts`, `at0016-rapid-cadence.test.ts`.
- **Summary:** Closing the active tab promotes a neighbor; the new active card receives focus.

#### [AT0017] `saveState` RPC parity
- **Status:** ✅ closed.
- **Tests:** `at0017-savestate-rpc-parity.test.ts`.
- **Summary:** Native `window.tugdeck.saveState()` and the will-phase / window-blur path produce JSON-equal bags for steady state.

#### [AT0018] Async content-load race
- **Status:** ✅ closed for synchronous-restore factories (current shipping set).
- **Tests:** `at0018-async-content-race.test.ts`.
- **Summary:** Save fires before / during content-load — `restorePendingRef` gates `invokeSaveCallback` so the stub doesn't overwrite seeded content.

#### [AT0019] Pane teardown — flush path
- **Status:** ✅ closed.
- **Tests:** `at0019-pane-teardown-flush.test.ts`.
- **Summary:** `_closePane` flushes every card's `onSave` before any `cardWillBeginDestruction`; `__tug.closePane` exercises the path.

#### [AT0020] Modal overlay dismiss → focus return
- **Status:** ✅ closed.
- **Tests:** `at0020-overlay-focus-return.test.ts`.
- **Summary:** Editor context-menu Escape → focus lands back in the editor (representative of all portal-then-dismiss surfaces).

#### [AT0021] Drag aborted — card state preservation
- **Status:** ✅ closed.
- **Tests:** `at0021-drag-aborted.test.ts`.
- **Summary:** Drag + Escape (or invalid drop) returns the card to its original pane with focus + selection unchanged.

#### [AT0022] Engine caret visibility
- **Status:** ✅ closed.
- **Tests:** `at0022-caret-visibility.test.ts`.
- **Summary:** After every refocus path (cold-boot, app cycle, tab switch), `document.activeElement` is the engine root AND `document.hasFocus() === true` (caret blinks).

#### [AT0023] Cross-card selection
- **Status:** ✅ closed (paint system doesn't crash; cross-card ranges treated as informational).
- **Tests:** `at0023-cross-card-selection.test.ts`.
- **Summary:** Native drag from card A's content to card B's content does not throw on `window.getSelection()` or `__tug.getSelection(cardId)`.

### Component-roster tags (AT0024–AT0031)

Component-level state preservation — gaps surfaced from the L23 audit of the stateful component roster. All route through the [A9] Component State Preservation Protocol (see [state-preservation.md](state-preservation.md) for the full protocol).

> **AT0024 / AT0025 reuse:** these two numbers originally tagged structural protocol milestones gated by the `.tsx` unit test `selection-persistence-integration.test.tsx` (not an app-test). The protocol's structural closure now rides AT0026/AT0027/AT0030. The AT0024/AT0025 *app-test* slots were subsequently filled with the prompt-state round-trip scenarios documented below.

#### [AT0024] Prompt-state round-trip across reload + relaunch
- **Status:** ✅ closed.
- **Tests:** `at0024-prompt-state-roundtrip.test.ts`.
- **Summary:** Comprehensive prompt-state round-trip matrix — a dev / `gallery-prompt-entry` card's multi-line text, non-collapsed selection, and editor scroll position survive `Maker > Reload` AND quit + relaunch.

#### [AT0025] Selection survives the deactivation → reload/relaunch path
- **Status:** ✅ closed.
- **Tests:** `at0025-prompt-deactivated-roundtrip.test.ts`.
- **Summary:** Layer-4 case — type + select in a session card, deactivate it by clicking a sibling tab, reload or relaunch, reactivate; the selection round-trips (previously lost because `engine.captureState()` read a live DOM Selection that no longer existed on the deactivated card).

#### [AT0026] Open-overlay persistence semantics
- **Status:** ✅ closed at Step 25F.
- **Tests:** `at0026-overlay-persistence.test.ts`.
- **Summary:** `tug-sheet` is PERSISTENT (opts into [A9]; see [state-preservation.md](state-preservation.md)); `tug-alert`, `tug-confirm-popover`, `tug-popover`, `tug-tooltip`, `tug-context-menu` are EPHEMERAL by design.

#### [AT0027] Layout state — split-pane divider, accordion expansion
- **Status:** ✅ closed at Step 25D / 25E.
- **Tests:** `at0027-layout-state-persistence.test.ts`.
- **Summary:** `tug-accordion` opts into [A9] (see [state-preservation.md](state-preservation.md)); `tug-split-pane` keeps its existing `storageKey` → tugbank path (pane-scope by intent). 25E extended the same Closed status to switch / radio-group / choice-group / option-group / slider / value-input.

#### [AT0028] Banner / bulletin dismiss
- **Status:** ❌ open (deferred).
- **Tests:** none yet.
- **Summary:** Originally planned as Step 25I; deferred. Closure requires a separate user-preferences store under `dev.tugtool.user.dismissals/{bannerId}`, distinct from the card-scope [A9] protocol (see [state-preservation.md](state-preservation.md)).

#### [AT0029] Scroll-key audit across components
- **Status:** ❌ open (deferred).
- **Tests:** none yet.
- **Summary:** Originally planned as Step 25H; deferred. Walk every stateful component for scrollable sub-regions; add `data-tug-scroll-key` where the IS axis applies.

#### [AT0030] Virtual-focus / focus-within for composite components
- **Status:** ✅ closed at Step 25E (selected-value axis); virtual-focus-without-selection deferred.
- **Tests:** `at0030-virtual-focus.test.ts`.
- **Summary:** `tug-radio-group`, `tug-choice-group`, `tug-option-group` capture their selected value via [A9] (see [state-preservation.md](state-preservation.md)). The narrower "focused but not selected" axis is deferred — niche edge case.

#### [AT0031] `tug-prompt-entry` chrome state (`route`) — retired
- **Status:** ⊘ retired — the tools popover was removed from the prompt-entry design (it was never in production Dev; only the gallery card mounted it). Its `toolsOpen` axis and `at0031-prompt-entry-chrome.test.ts` were deleted with it.
- **Tests:** none — the `route` axis is now gated by `at0085-prompt-entry-route.test.ts`.
- **Summary:** `tug-prompt-entry` no longer exposes a `bag.components` chrome surface. The `route` axis rides `bag.content.route` and round-trips through `at0085-prompt-entry-route.test.ts`.

### EM-card focus follow-up gates (AT0032–AT0036)

Surfaced during selection-plan Step 23F / 23G / 25C.5 work. Each closes a specific EM-card focus or selection bug that escaped the AT0001–AT0023 transition coverage.

#### [AT0032] EM cold-boot selection paint
- **Status:** ✅ closed at Step 23F.
- **Tests:** `at0032-em-cold-boot-selection.test.ts`.
- **Summary:** Saved selection round-trips through cold-boot / mount-restore for an EM card seeded as ACTIVE. Gates the `cold-boot-restore-snapshot` + `engine-restore-applied` diagnostic chain that 23F established.

#### [AT0033] Fresh-EM-card resolver classification
- **Status:** ✅ closed at Step 23F.
- **Tests:** `at0033-em-fresh-card-activation.test.ts`.
- **Summary:** Pre-23F, `resolveActivationTarget` discriminated EM vs FC by `bag.content !== undefined`; fresh never-saved EM cards mis-classified as FC and focus landed on a toolbar button instead of the contenteditable. 23F adds `engineKind: "em"` to the card registry; this test is the regression gate.

#### [AT0034] EM focus after cross-pane move
- **Status:** ✅ closed at Step 23F.
- **Tests:** `at0034-em-focus-after-move.test.ts`.
- **Summary:** Pre-23F, `engine-activation-dispatched` fired on a cross-pane drag (proving `onCardActivated` ran) but `.focus()` no-op'd on the freshly re-mounted contenteditable, leaving `document.activeElement` on BODY. This test is the regression gate for the actual focus-landing assertion that at0006-em / at0007-em deliberately omit.

#### [AT0035] App-switch selection survival (EM + dev)
- **Status:** ✅ closed at Step 23G.
- **Tests:** `at0035-em-app-switch-selection.test.ts`, `at0035-dev-app-switch-selection.test.ts`.
- **Summary:** Selection survives cmd-tab away + back for EM cards. The dev-specific variant exercises the redundant focus-paths bug (legacy `cardDidActivate` + framework `onCardActivated`) that triggered WebKit's selectionchange-on-focus quirk intermittently — it reproduces ONLY with session-card, not `gallery-prompt-entry`. The 23G fix routes the delegate's `focus()` through `engine.setSelectedRange` for the WebKit-safe focus-then-select pattern.

#### [AT0036] Inactive-card cmd-tab selection survival
- **Status:** ⬛ retired — gating test removed (2026-06-08).
- **Tests:** _(none — `at0036-inactive-card-app-switch-selection.test.ts` deleted)_.
- **Summary:** FC card (TugInput) selection survival across a cmd-tab cycle + re-activation click. Retired because the gating test was structurally brittle: it never reached its selection assertion — it died at setup, where a native CGEvent click into a **second pane's** input failed to activate that pane (a multi-pane native-click geometry artifact, not the property under test). The selection-survival property itself remains covered by the form-control restore path exercised in AT0037/AT0038 and the AT0001/AT0010 selection tests. The tag number is retained (never reused); re-add a test here only with a non-native-multi-pane activation path.

### Multi-card paint invariants (AT0037–AT0038)

Surfaced during selection-plan Step 25C.4 (active/inactive paint split). Gate cross-card selection invariants the paint architecture must maintain.

#### [AT0037] Multi-card deck-wide restore consistency
- **Status:** ✅ closed at Step 25C.4.
- **Tests:** `at0037-deck-wide-restore-consistency.test.ts` (renamed from `m26-*` during the 25L AT-series audit; original numbering collided with the AT0026 overlay-policy tag).
- **Summary:** On a multi-card deck restore, exactly one card holds document focus AND its range is in `window.getSelection()`; every inactive card's range lives in `selectionGuard.cardRanges` + the `inactive-selection` CSS Custom Highlight; bag-on-disk preserves the four 25C.3 axes (text/atoms/selection/scrollTop) per card.

#### [AT0038] Deactivation-time inactive paint
- **Status:** ✅ closed at Step 25C.4. Covered by the `gallery-prompt-entry` variants.
- **Tests:** `at0038-deactivation-inactive-paint.test.ts` (renamed from `m27-*` during the 25L AT-series audit; original numbering collided with the AT0027 layout-state tag).
- **Summary:** When a user deactivates a scrolled EM card with a selection, `paintMirrorAsInactive(publish)` rebuilds a DOM Range at the user's actual selection — not at a wrong scroll-relative position. Gates `flatToDom`'s correctness against scrolled content. The `dev` (SessionCardBody) variants were removed (2026-06-08): they died at the same multi-pane native-activation-click setup as AT0036, never reaching the paint assertion; the property is fully covered by the `gallery-prompt-entry` variants, which drive the same EM engine.

### Title-bar / close-confirm + text-editor tags (AT0039–AT0050)

Surfaced during the close-confirm work and the `tug-text-editor` substrate migration. AT0039–AT0041 gate title-bar focus + close-confirm behavior; AT0042–AT0050 gate the `tug-text-editor` substrate (state round-trip, clipboard, caret rendering) and the `tug-prompt-entry` migration onto it.

#### [AT0039] Title-bar return-focus restore (inactive FC card)
- **Status:** ✅ closed.
- **Tests:** `at0039-title-bar-return-focus-restore.test.ts`.
- **Summary:** Selection in an INACTIVE FC card (TugInput) survives a title-bar-driven activation round-trip when the OTHER card (TugTextarea) was the focused card mid-trip — the case the retired AT0036 missed because it used an input-click (not a title-bar click) and the same component on both sides.

#### [AT0040] Title-bar X close confirmation
- **Status:** ✅ closed.
- **Tests:** `at0040-multi-tab-close-confirm.test.ts`.
- **Summary:** Pane-level close-confirm matrix: plain X click opens a "Close Card?" / "Close N Tabs?" popover that stays open until confirm/cancel; Option-click closes the pane immediately (power-user escape hatch).

#### [AT0041] Gallery close → reopen reachability
- **Status:** ✅ closed.
- **Tests:** `at0041-gallery-close-reopen.test.ts`.
- **Summary:** Closing the Component Gallery via the title-bar X (multi-tab confirm flow) must leave `SHOW_COMPONENT_GALLERY` reachable so a subsequent `View > Show Component Gallery` re-opens it (regression: the action handler lived on a responder that the close path tore down).

#### [AT0042] tug-text-editor state round-trip across reload
- **Status:** ✅ closed.
- **Tests:** `at0042-tug-text-editor-state-roundtrip.test.ts`.
- **Summary:** `gallery-text-editor` typed text survives `Maker > Reload` through `useTextEditorStatePreservation` registered with the enclosing `CardHost`.

#### [AT0043] tug-text-editor copy across selection classes
- **Status:** ✅ closed.
- **Tests:** `at0043-tug-text-editor-copy-diag.test.ts`.
- **Summary:** Empirical clipboard read-back for `tug-text-editor` copy across text-only / mixed / atom-only selection classes (the atom-only "appears not to copy" and mixed-paste symptoms from the Step 9 manual checkpoint).

#### [AT0044] tug-text-editor clipboard stress + undo
- **Status:** ✅ closed.
- **Tests:** `at0044-tug-text-editor-clipboard-stress.test.ts`.
- **Summary:** Multi-step copy/paste round-trips and undo-after-cut/paste for `tug-text-editor` atoms — guards atom-content loss across repeated pastes and atom-decoration loss after undo.

#### [AT0045] tug-text-editor Cmd+A after typing
- **Status:** ✅ closed.
- **Tests:** `at0045-tug-text-editor-cmd-a-after-typing.test.ts`.
- **Summary:** After a typing transaction, Cmd+A still reaches the responder-chain → CM6 selectAll path.

#### [AT0046] tug-text-editor first responder after button click
- **Status:** ✅ closed.
- **Tests:** `at0046-tug-text-editor-first-responder-after-button-click.test.ts`.
- **Summary:** Clicking an atom-row button no longer steals first responder from the editor — `pane-focus-controller` now honors `data-tug-focus="refuse"` so ⌘A/⌘C/⌘X/⌘V keep reaching the editor's handlers.

#### [AT0048] tug-text-editor caret rendering
- **Status:** ✅ closed.
- **Tests:** `at0048-tug-text-editor-caret-rendering.test.ts`.
- **Summary:** The CM6-owned caret renders as exactly one DOM node with line-height-derived geometry across the four canonical doc shapes (guards against zero/two markers and height drift).

#### [AT0049] tug-text-editor no doubled caret
- **Status:** ✅ closed.
- **Tests:** `at0049-tug-text-editor-no-doubled-caret.test.ts`.
- **Summary:** Each layout-shifting transition that historically left WebKit's contentEditable caret cache stale (e.g. atom removal via backspace) leaves exactly one caret element with the CM6-owned caret layer in place.

#### [AT0050] tug-prompt-entry migration onto tug-text-editor
- **Status:** ✅ closed.
- **Tests:** `at0050-tug-prompt-entry-text-editor-migration.test.ts`.
- **Summary:** End-to-end coverage for the Step 15 migration of `tug-prompt-entry` onto the `tug-text-editor` substrate (dropped per-route drafts + route-atom-in-doc model). Also gates that route characters typed into the editor are ordinary text (first-character route switching removed).

### Overlay-tier tags (AT0051)

Surfaced during the canvas overlay-tier plan (`roadmap/tugplan-tide-overlay-tier.md`). Gate the canvas-level escape hatch for popup-class primitives — popups must clear every pane's `overflow: hidden` clip rect and stay anchored to their trigger across host-bounds changes.

#### [AT0051] Completion popup escapes the card frame
- **Status:** ✅ closed at overlay-tier Step 1.
- **Tests:** `at0051-completion-popup-escapes-card.test.ts` (4 cases: portal focus retention spike, structural placement, live click-to-accept, ResizeObserver re-anchor).
- **Summary:** Typeahead popup is portaled into `<CanvasOverlayRoot />` (sibling of the pane container in `DeckCanvas`); painted at viewport coordinates with `position: fixed`; `pointerdown` + `e.preventDefault()` keeps `document.activeElement` on the editor across the portal hop ([D08] resolution); ResizeObserver on the editor host re-anchors on sash drag and cancels the session on pane collapse ([D06]).

### Companion-binding tags (AT0052–AT0054)

Surfaced during the popup-bindings plan (`roadmap/tugplan-tide-popup-bindings.md`) Step 4. Gate the companion-popup auto-dismiss signal — DOM focus on the editor's `contentDOM` per [D05] / (#companion-binding) — replacing the prior `cardDidDeactivate` subscription. Strict-superset coverage: every dismissal the deck-store signal triggered, the focus signal also triggers; the focus signal additionally catches the in-card service-popup case ("image 5" font-picker bug) the old signal missed.

#### [AT0052] Companion auto-dismiss when sibling popup grabs focus
- **Status:** ✅ closed at popup-bindings Step 4 (runtime-verified `just app-test` PASS).
- **Tests:** `at0052-completion-cancels-on-sibling-popup.test.ts`.
- **Summary:** Original "image 5" reproducer: open `@` typeahead in a `gallery-text-editor` card; native-click the font-family `TugPopupButton`; the `useCompanionPopupBinding` hook observes Radix's `FocusScope.onMountAutoFocus` blurring `view.contentDOM` and dispatches `cancelCompletion(view)`. Asserted by the completion menu transitioning to `display: none` and the typeahead state field clearing. Verifies the chain: trigger click → Radix mounts content → FocusScope grabs focus → focusout on contentDOM → microtask defer → companion fires → cancelCompletion runs.

#### [AT0053] Companion auto-dismiss on peer-card click
- **Status:** ✅ closed at popup-bindings Step 4 (runtime-verified `just app-test` PASS).
- **Tests:** `at0053-completion-cancels-on-peer-card-click.test.ts`.
- **Summary:** Strict-superset of the prior `cardDidDeactivate`-based dismissal. Open `@` typeahead in card-A; native-click the chrome of card-B; focus moves to card-B; card-A's contentDOM loses focus; companion binding fires `cancelCompletion`. Verified post-migration that the user-visible behavior of "popup vanishes when peer card activates" still holds — through the focus signal rather than the deck-store deactivate event.

#### [AT0054] Escape keymap regression guard post companion-binding migration
- **Status:** ✅ closed at popup-bindings Step 4 (runtime-verified `just app-test` PASS).
- **Tests:** `at0054-completion-escape-still-cancels.test.ts`.
- **Summary:** Open `@` typeahead in a `gallery-text-editor` card; press Escape; the existing keymap path (`tugCompletionKeymap` → `cancelCompletion`) must still run unmodified post-migration. Regression guard: the binding swap touched the cancel SIGNAL set, not the keymap; this test pins that the keymap path is unaffected.

### Service-binding tags (AT0055–AT0058)

Surfaced during the popup-bindings plan (`roadmap/tugplan-tide-popup-bindings.md`) Step 5. Gate the service-popup close-focus restoration mechanism (`useServicePopupBinding` per [D06] / [D07]) and the popup-in-sheet z-tier elevation ([D09]). Together they cover: positive restore (image 5 close path), external-click skip-restore, and popup-in-sheet correct stacking + close-focus.

#### [AT0055] Service popup close restores editor focus
- **Status:** ✅ closed at popup-bindings Step 5 (runtime-verified `just app-test` PASS).
- **Tests:** `at0055-popup-close-restores-editor-focus.test.ts`.
- **Summary:** Image 5 close-path regression guard. Open editor; type a baseline keystroke; click font-family `TugPopupButton` (captureOnOpen snapshots editor responder); pick a menu item; menu closes; service binding's `onCloseAutoFocus` calls `event.preventDefault()` + `manager.focusResponder(captured)` which invokes the editor's substrate `view.focus()` callback, landing DOM focus back on `view.contentDOM`. The clinching assertion: a second native keystroke after the menu closes lands in the editor without an additional click. Verifies the chain: trigger click promotes nothing on chain (TugButton refuse) → captureOnOpen snapshots editor → menu blink + close cascade → onCloseAutoFocus restores → editor regains DOM focus → keystroke lands.

#### [AT0056] Service popup outside-click skips restore
- **Status:** ✅ closed at popup-bindings Step 5 (runtime-verified `just app-test` PASS).
- **Tests:** `at0056-popup-outside-click-skips-restore.test.ts`.
- **Summary:** External-click predicate per [D07]. Open `/` typeahead so a popup is live; native-click the deck canvas background (outside the editor, outside any popup, outside any sheet); the document-level pointerdown listener installed by `captureOnOpen` flips `externalClickRef = true`; companion binding (Step 4) fires on focusout and hides the completion popup; service binding's `onCloseAutoFocus` short-circuits the restore path because of the flag. Asserted by the completion popup hiding AND `document.activeElement` NOT being inside the editor's `view.contentDOM` post-click. The negative focus assertion is sufficient to prove the binding did not over-restore; where focus DOES land is governed by `pane-focus-controller`, not the binding.

#### [AT0057] Popup inside a sheet stacks above the sheet
- **Status:** ✅ closed at popup-bindings Step 5 (runtime-verified `just app-test` PASS).
- **Tests:** `at0057-popup-in-sheet-stacking.test.ts`.
- **Summary:** [D09] popup-in-sheet z-tier elevation visual gate. Open the `gallery-sheet` card's "Basic Sheet" (which now contains a `TugPopupButton` via `SheetPopupContent`); open the popup-button menu inside the sheet; assert the menu's portaled content carries `tug-menu-in-dialog` (signals the `TugSheetStackingContext` consumption fired) AND the resolved `z-index` is `9600` (the elevated `--tug-z-overlay-menu-in-dialog` token) AND the menu's bounding rect overlaps the sheet content rect (proves the menu paints on top, not in some unrelated viewport corner). The "popup remains clickable" sub-assertion was deferred because the harness's coord-based click is unreliable when the popup trigger sits above the visible viewport during sheet animation; the structural assertions cover [D09]'s mechanism.

#### [AT0058] Popup inside a sheet keeps focus in the sheet on close
- **Status:** ✅ closed at popup-bindings Step 5 (runtime-verified `just app-test` PASS).
- **Tests:** `at0058-popup-in-sheet-close-focus.test.ts`.
- **Summary:** Same fixture as AT0057. Open the sheet; open the popup-button menu inside; pick a menu item; assert `document.activeElement` is a descendant of the sheet's content element (`[data-slot="tug-sheet"]`) after the menu closes. The menu-item click is INSIDE the canvas overlay root (popup content); the trigger click before that is also inside the overlay root (sheet content); so the service binding's external-click predicate does NOT flag external; either restore-via-binding or Radix's default close-focus-to-trigger keeps focus in the sheet. The test guards against a regression where the binding tried to restore prior responder onto an element BEHIND the sheet (the gallery card).

### Region-scroll anchor-metadata save tag (AT0059)

Phase E.6 of `roadmap/tide-assistant-rendering.md` — the framework extension that lets variable-height virtualized lists (notably the session-card transcript) preserve their scroll position across reload by anchoring on `(cellIndex, offsetWithinCell)` rather than raw pixels. This tag pins the SAVE side: the `data-tug-scroll-state` DOM attribute reflects live scroll, and `captureRegionScrolls` reads it into `bag.regionScroll[key].meta`.

#### [AT0059] Region-scroll anchor metadata — save side
- **Status:** ✅ closed at Phase E.6 step 1 (`just app-test` PASS).
- **Tests:** `at0059-region-scroll-anchor-save.test.ts`.
- **Summary:** Mount the `gallery-list-view-scroll-keyed` card (which mounts `GalleryListView` with `scrollKey="gallery-list-view-scroll"`); native-scroll the inner `[data-tug-scroll-key="gallery-list-view-scroll"]` container to a known offset. Assert that the same element carries `data-tug-scroll-state` whose JSON parses to `{anchor: {index, offset}}` with `index === heightIndex.indexForOffset(scrollTop)` for the scrolled position. Then call `window.tugdeck.saveState()` to flush; read `window.__tug.getCardStateBag(cardId)` and assert `bag.regionScroll["gallery-list-view-scroll"].meta.anchor` matches the value the DOM attribute carried. Closes Phase E.6's "first, prove we are saving the scroll state when it changes" sub-task.

#### [AT0060] Variable-height list view — content settled detection
- **Status:** ✅ closed at Phase E.6 step 2 (`just app-test` PASS).
- **Tests:** `at0060-list-view-content-settled.test.ts`.
- **Summary:** Mount the `gallery-list-view-scroll-keyed` card (which runs in `inline=true` mode — every cell mounted, mirroring the session-card transcript). Prove three signals that together identify "content has loaded, rendered, and settled": (1) **loaded** — `dataSource.numberOfItems()` reflects the seeded item count; (2) **rendered** — `document.querySelectorAll('[data-tug-list-cell-index]').length === itemCount` (every cell in DOM); (3) **settled** — `scrollHeight` of the scroll container is stable across two observations 250ms apart, AND scrollHeight exceeds clientHeight (real layout has happened, not a zero-height intermediate state). Once all three are true, the apply path's preconditions for anchor-based restore are satisfied. Closes Phase E.6's "prove we can identify when content has settled" sub-task.

#### [AT0061] Region-scroll anchor metadata — apply side (full round-trip)
- **Status:** ✅ closed at Phase E.6 step 3 (`just app-test` PASS).
- **Tests:** `at0061-region-scroll-anchor-apply.test.ts`.
- **Summary:** Full save-then-reload-then-apply round-trip on `gallery-list-view-scroll-keyed`. Mount → wait for content settled (AT0060 signals) → scroll to a known position → assert `data-tug-scroll-state` reflects the new anchor → `saveState()` → record scrollTop + anchor → `appReload()` (same code path as Maker > Reload menu — `prepareForReload` flushes + `location.reload`) → on the new page, wait for content settled again → assert the inner scrollport's scrollTop has been restored to within tolerance of the saved scrollTop AND the live anchor on `data-tug-scroll-state` matches the saved anchor (proving the anchor cell is at the same content-relative viewport position). Closes Phase E.6's "prove we can then apply all the scroll states" sub-task.

#### [AT0062] Late-mounting component-state restore (registry observer channel)
- **Status:** 🗑️ superseded at Phase E.8. Replaced by [AT0067] / [AT0068]. The Phase E.7 observer-channel restore path the test pinned was removed — components now mount in their saved state via `useSavedComponentState` inside `useState` initializers, so there is no post-mount apply path to gate.
- **Tests:** *(removed)*.

#### [AT0063] BashToolBlock fold state survives Maker > Reload
- **Status:** 🗑️ superseded at Phase E.8. Replaced by [AT0067]. Same goal — fold state survives reload — but the failure mode AT0063 pinned (post-mount observer-channel apply) no longer exists; AT0067 pins the stronger contract that the saved fold reflects on the FIRST DOM observation, no intermediate frame.
- **Tests:** *(removed)*.

#### [AT0064] BashToolBlock inner scroll survives Maker > Reload
- **Status:** 🗑️ superseded at Phase E.8. Replaced by [AT0068]. Same goal — inner scroll survives reload — but AT0068 pins the stronger contract that the scroller is CREATED at the saved `scrollTop` (no jump from 0 to saved).
- **Tests:** *(removed)*.

#### [AT0065] Session-card-like inner scroll survives Maker > Reload + scroller-rebuild
- **Status:** 🗑️ superseded at Phase E.8. The element-identity-gated `MutationObserver` re-apply for inner-scroller rebuilds stays in `card-host.tsx` (it's the fallback for scrollers recreated mid-card-lifetime), but the production failure AT0065 pinned was scoped to the now-removed late-mount path; the manual checkpoints in `tide-assistant-rendering.md` Phase E.8 cover the rebuild-after-restore case end-to-end.
- **Tests:** *(removed)*.

#### [AT0067] BashToolBlock fold state mounts in its saved value on first paint
- **Status:** 🗑️ retired — surface migrated. The per-body TerminalBlock fold AT0067 drove no longer exists for tool blocks: `BashToolBlock` renders its `TerminalBlock` `embedded`, which suppresses the per-body fold (the body renders a flat clamped preview), and the whole-block fold moved to the chrome (`ToolBlockHistoryCollapse`, `data-block-collapsed`), persisted via `ToolBlockExpansionContext` overrides that only the transcript host provides. The mount-in-saved-state contract for that override is unit-covered by `blocks/__tests__/expansion-state.test.ts`, and the chrome's synchronous `useState` initializer prevents the post-mount flash by construction. (A future session-card/transcript-level test could add integration coverage of the chrome fold's first-paint-from-saved-state; the gallery-bash approach can't reach it.)
- **Tests:** none (was `at0067-bash-block-mount-in-saved-state.test.ts`, deleted; the `gallery-bash-mount-in-saved-state` fixture was removed too).

#### [AT0068] BashToolBlock inner scroller is created at its saved scrollTop
- **Status:** 🗑️ retired — surface removed. An embedded `BashToolBlock` body renders a flat clamped preview, not a virtualized inner scroller — there is no inner `data-tug-scroll-key` scroller to persist. Scroll-restore-on-reload for the transcript is now owned by the outer transcript scroller, app-covered by [AT0190] / [AT0059] / [AT0061].
- **Tests:** none (was `at0068-bash-block-inner-scroll-from-creation.test.ts`, deleted).

#### [AT0069] Outer transcript first-paint accuracy with saved geometry — RETIRED
- **Status:** ⬛ retired. AT0069 gated the saved-`meta.cellHeights` first-paint optimization — hydrating a per-cell measured-height snapshot into the live `HeightIndex` so commit 1 resolved the anchor offset exactly instead of from an estimate. That whole apparatus was deleted: the transcript renders inline (every row at its real, measured height) with no `content-visibility` deferral and no estimates, so the saved-height bag had no purpose and was removed entirely. The regression it gated (estimated-then-refined first-paint hop) is structurally impossible without estimates. Anchor restore — the surviving mechanism — is gated by **AT0190** (`at0190-transcript-anchor-restore.test.ts`) and AT0061. Test file `at0069-outer-transcript-first-paint.test.ts` deleted. The tag number is retired (not reused).

#### [AT0070] TugDevPanel toggle round-trip
- **Status:** ✅ closed (reused tag — see note). Originally claimed at Phase E.9 as a deferred FileBlock CM6 line-relative-restore tag (the line-relative writer/reader semantics remain unit-test-covered; AT0061 exercises the same attribute channel). The app-test slot was later filled with the TugDevPanel toggle scenario below.
- **Tests:** `at0070-dev-panel-toggle.test.ts`.
- **Summary:** TugDevPanel toggle round-trip via the `show-dev-panel-toggle` action (Step 20.3.1). Drives the action directly rather than the `⌥⌘/` chord — under the app-test harness maker mode reads false on the unseeded tugbank, so the Maker menu (and its "Show Dev Panel" item) is hidden.

#### [AT0071] TugDevPanel active-tab persistence
- **Status:** ✅ closed (reused tag — see note). Originally a content-owning-focus / find-row tag retired at Phase E.12 when per-block Find was removed; the original fixture and test file were deleted. The app-test slot was later filled with the TugDevPanel active-tab persistence scenario below.
- **Tests:** `at0071-dev-panel-tab-persistence.test.ts`.
- **Summary:** TugDevPanel `activeTab` persistence (Step 20.3.2): the active tab survives a panel hide/show round-trip (via `show-dev-panel-toggle`) AND a full `appReload` (via the tugbank-persisted `activeTab` key under `dev.tugtool.dev-panel`).

#### [AT0072] Content-owning focus survives card-switch
- **Status:** 🗑 **retired at Phase E.12** — same reason as AT0071 (find fixture removed). The card-switch source is now gated for the engine path by AT0080.
- **Tests:** `at0072-content-owning-focus-survives-card-switch.test.ts` (deleted).

#### [AT0073] Content-owning focus survives Maker > Reload
- **Status:** 🗑 **retired at Phase E.12** — same reason as AT0071 (find fixture removed). The reload source is now gated for the engine path by AT0081.
- **Tests:** `at0073-content-owning-focus-survives-reload.test.ts` (deleted).

#### [AT0074] Engine focus fallback when `bag.focus` is absent
- **Status:** 🗑 **retired at Phase E.12** — bundled with the find-fixture AT-series at Phase E.12. The "absent `bag.focus` → engine resolution" path it gated is still exercised: a fresh session card has no saved focus and AT0033 gates fresh-card activation; AT0078 / AT0080 / AT0081 gate the engine path across every activation source. No successor needed.
- **Tests:** `at0074-engine-focus-fallback.test.ts` (deleted).

#### [AT0075] Session-card find row focus survives app-switch
- **Status:** 🗑 **retired at Phase E.12** — was `describe.skip` pending a harness extension; per-block Find is removed in total at Phase E.12, so the behavior is gone. The file is deleted.
- **Tests:** `at0075-dev-find-app-switch.test.ts` (deleted).

#### [AT0076] Session-card find row focus survives card-switch
- **Status:** 🗑 **retired at Phase E.12** — same reason as AT0075. The file is deleted.
- **Tests:** `at0076-dev-find-card-switch.test.ts` (deleted).

#### [AT0077] Session-card find row focus survives Maker > Reload
- **Status:** 🗑 **retired at Phase E.12** — same reason as AT0075. The file is deleted.
- **Tests:** `at0077-dev-find-reload.test.ts` (deleted).

#### [AT0078] Session-card engine focus survives app-switch
- **Status:** ✅ shipped at Phase E.11; retained + repurposed at Phase E.12 as the app-switch gate for the single-text-entry rule (#phase-e-12): a session card's activation focus always lands on the `tug-prompt-entry` contenteditable.
- **Tests:** `at0078-dev-engine-focus-survives.test.ts`.
- **Summary:** Seed a session-card, bind a fake session, await engine ready. Click into the contenteditable, type "hello", `simulateAppResign` (window-blur). After a brief blur dwell, `simulateAppBecomeActive` runs `reactivateCurrentFocusDestination` → `applyBagFocus` → engine resolution → engine hook invocation → `view.focus()`. Asserts `document.activeElement` is the session-card's contenteditable.

#### [AT0079] Session-card engine focus wins over stale find-row mount
- **Status:** 🗑 **retired at Phase E.12** — was `describe.skip`; per-block Find is removed in total at Phase E.12, so there is no "stale find-row mount" for the engine kind to win over. The file is deleted.
- **Tests:** `at0079-dev-engine-focus-wins-over-stale-find.test.ts` (deleted).

#### [AT0080] Session-card focus lands on the prompt entry after card-switch
- **Status:** ✅ shipped at Phase E.12 — the card-switch gate for the single-text-entry rule (#phase-e-12).
- **Tests:** `at0080-dev-focus-card-switch.test.ts`.
- **Summary:** Two session cards (A + B) in one pane, both bound to fake sessions. Click into A's contenteditable, type "hello", click B's tab (focus lands on B's contenteditable), click A's tab. Asserts `document.activeElement` is A's `tug-prompt-entry` contenteditable — the activation focus has one destination.

#### [AT0081] Session-card focus lands on the prompt entry after Maker > Reload
- **Status:** ✅ shipped at Phase E.12 — the cold-boot / reload gate for the single-text-entry rule (#phase-e-12). Exercises the `deferred-engine` settle (the one late-mount focus path that survives Phase E.12's retirement of the `deferred-dom` focus-retry branch).
- **Tests:** `at0081-dev-focus-reload.test.ts`.
- **Summary:** Seed a session card, bind a fake session, type into the contenteditable, `appReload`, re-seed with the persisted bag, re-bind the session. Asserts `document.activeElement` is the session-card's `tug-prompt-entry` contenteditable after the cold-boot RESTORE → `deferred-engine` → `engineHooksVersion` re-run path. Waits for the contenteditable to mount rather than the `engine-ready` harness signal, which does not re-arm after `appReload`.

> **Cross-pane drag** — the fourth activation source for the single-text-entry rule (#phase-e-12) — is gated by AT0034 (`at0034-em-focus-after-move.test.ts`), which exercises a cross-pane drag and a detach on `gallery-prompt-entry` (the `tug-prompt-entry` surface a session card uses internally) and asserts focus lands on the contenteditable. No new tag is needed.

#### [AT0082] Gallery-shipped assistant renderers
- **Status:** ✅ closed.
- **Tests:** `at0082-gallery-shipped-renderers.test.ts`.
- **Summary:** Render-half verification for the Dev assistant-rendering gallery cards — the `SessionThinkingBlock` chrome, the `JsonTreeBlock` body kind, the file tool wrappers (`ReadToolBlock` / `EditToolBlock`), the `DefaultToolWrapper` fallback, and the extended `gallery-bash-tool-block` card. (Registry wiring is pinned separately by the `gallery-registrations.test.ts` unit test.)

#### [AT0083] TugListView scroll-to-bottom reliability + auto-pin funnel
- **Status:** ✅ shipped at tide-assistant-turns Step 20.4.16 Sub-step I — gates the I-0 restore-anchor fix and the I-1 `maybePinToBottom` consolidation.
- **Tests:** `at0083-list-view-submit-pin.test.ts`.
- **Summary:** Drives `gallery-list-view-scroll-keyed` (real `TugListView` + `SmartScroll` + CardHost region-scroll restore). Test 1 (I-0): cold-boot a card restored to a mid-list anchor, drive the fixture's "Scroll to bottom" control (the inner `TugListView`'s imperative `scrollToBottom()` — the same method the session-card transcript host calls on submit), assert the scroller lands AND holds at the bottom — the restore-anchor apply effect must not pull it back. Test 2 (I-0 a/b/c + I-1): `scrollToBottom()` at the bottom is a no-op; after `tug-disengage-follow-bottom` content growth does NOT auto-pin (gate false — also covers the collapsed-hunk case); `scrollToBottom()` re-engages follow-bottom; subsequent growth then auto-pins (gate true). Gates `SmartScroll.shouldAutoPin` / `maybePinToBottom` — the funnel `TugMarkdownView` also routes through.

### Session-card lifecycle + chrome tags (AT0084–AT0088)

Surfaced during the session-card-zones / Claude-Code-parity plans. Gate the lifecycle state-to-zone coordination matrix, the route axis, and the Z4B chrome chips. (The shipped-renderers tag AT0082 and the list-view tag AT0083 above belong to the dev assistant-rendering / region-scroll families.)

#### [AT0084] Session-card lifecycle state-to-zone coordination matrix
- **Status:** ✅ closed.
- **Tests:** `at0084-session-lifecycle-coordination.test.ts`.
- **Summary:** Drives a real `CodeSessionStore` inside a real session card through every distinct lifecycle matrix row (IDLE → STREAMING → TOOL_WORK → COMPLETE, AWAITING_USER, QUEUED_NEXT_TURN, ERRORED, REPLAYING, TRANSPORT_DOWN, the two interrupt cases) via `driveSession` and asserts the rendered DOM for zones Z1/Z2/Z5. No mock store, no fake DOM.

#### [AT0085] tug-prompt-entry route survives reload
- **Status:** ✅ closed.
- **Tests:** `at0085-prompt-entry-route.test.ts`.
- **Summary:** `TugPromptEntry`'s `route` axis rides `bag.content.route` and round-trips across reload — the successor coverage for the retired AT0031 chrome axis.

#### [AT0086] SessionRouteIndicatorBadge repaint + mount identity
- **Status:** ✅ closed.
- **Tests:** `at0086-session-route-indicator-badge.test.ts`.
- **Summary:** `SessionRouteIndicatorBadge` repaints when the prompt-entry route flips (Code / Shell) and keeps its mount identity across the flip.

#### [AT0087] TugBadge two-line presentation
- **Status:** ✅ closed.
- **Tests:** `at0087-tug-badge-two-line.test.ts`.
- **Summary:** The two-line `TugBadge` variant (`layout="label-top" | "content-top"` + `label`) renders with the borrowed status-bar legend typography, correct stacking order, and a width-stabilized slot — verified against the real app since there is no DOM unit layer.

#### [AT0088] Permission-mode chip cycling
- **Status:** ✅ closed.
- **Tests:** `at0088-permission-mode-chip.test.ts`.
- **Summary:** The Z4B permission-mode chip (a two-line `TugPushButton`) cycles default → acceptEdits → plan → auto via `⇧⌘P` and via its behavior sheet, reflecting the change optimistically through `SessionMetadataStore.applyPermissionMode`.

### Claude-Code-parity command + banner tags (AT0090–AT0108)

Surfaced during the session-card / Claude-Code-parity plan. Gate the `/permissions` editor, slash-command live surfaces (`/rewind`, `/resume`, `/diff`, `/compact`), pane-scope routing, completion-acceptance, and the soft warn/caution banners.

#### [AT0090] /permissions rules editor
- **Status:** ✅ closed.
- **Tests:** `at0090-permissions-rules-editor.test.ts`.
- **Summary:** The `/permissions` rules editor adds/removes allow & deny rules.

#### [AT0091] /permissions Recently-denied tab
- **Status:** ✅ closed.
- **Tests:** `at0091-recently-denied.test.ts`.
- **Summary:** The `/permissions` Recently-denied tab promotes a denied request into a rule.

#### [AT0092] /permissions Workspace tab
- **Status:** ✅ closed.
- **Tests:** `at0092-workspace-directories.test.ts`.
- **Summary:** The `/permissions` Workspace tab adds additional working directories.

#### [AT0093] /permissions bucket routing
- **Status:** ✅ closed.
- **Tests:** `at0093-permission-buckets.test.ts`.
- **Summary:** Every `/permissions` tab writes to the correct persistence bucket.

#### [AT0094] /permissions add-rule scope routing
- **Status:** ✅ closed.
- **Tests:** `at0094-permission-scope-routing.test.ts`.
- **Summary:** The add-rule scope picker routes a new rule to the chosen scope (project / user / etc.).

#### [AT0095] Rate-limit caution banner
- **Status:** 🗑️ retired — feature removed.
- **Tests:** none (was `at0095-rate-limit-banner.test.ts`, deleted).
- **Summary:** The persistent app-level rate-limit banner was replaced by a single deck-wide `RateLimitBulletinBridge` that fires transient bulletins from the account-global rate-limit store. Per-card dedup (the test's whole premise) is now structurally impossible; the surviving transition logic (`nextUsageBulletin`) is unit-covered in `lib/__tests__/rate-limit.test.ts`.

#### [AT0096] Reasoning-effort chip
- **Status:** ✅ closed.
- **Tests:** `at0096-effort-chip.test.ts`.
- **Summary:** The Z4B reasoning-effort chip mounts only when the bound session advertises effort support.

#### [AT0097] /rewind turn picker + restore confirm
- **Status:** ✅ closed.
- **Tests:** `at0097-rewind-sheet.test.ts`.
- **Summary:** The `/rewind` turn picker opens and its restore-confirm flow drives a conversation rewind.

#### [AT0098] /rewind local-truncation mount identity
- **Status:** ✅ closed.
- **Tests:** `at0098-rewind-mount-identity.test.ts`.
- **Summary:** The [L26] pin for `/rewind`'s local conversation truncation — surviving transcript rows keep their React reconciliation identity (no remount), so scroll/selection/DOM-resident state stay intact.

#### [AT0099] /resume focused sessions overlay
- **Status:** ✅ closed.
- **Tests:** `at0099-resume-command.test.ts`.
- **Summary:** Typing `/resume` on a live bound session opens a card-scoped sessions overlay (sessions list, no project-path / recents chrome); cancel dismisses it and leaves the live session + transcript intact.

#### [AT0100] Sheet is pane-modal
- **Status:** ✅ closed.
- **Tests:** `at0100-sheet-pane-modal-focus.test.ts`.
- **Summary:** A sheet is PANE-modal, never app-modal — other panes stay interactive while a sheet is open.

#### [AT0101] Slash command pane scope
- **Status:** ✅ closed.
- **Tests:** `at0101-slash-command-pane-scope.test.ts`.
- **Summary:** A slash command typed into a card dispatches within that card's pane scope.

#### [AT0102] Default-button pane scope
- **Status:** ✅ closed.
- **Tests:** `at0102-default-button-pane-scope.test.ts`.
- **Summary:** A default button registered by a card is scoped to its pane — Return in another pane doesn't trigger it.

#### [AT0103] Submit accepts open completion
- **Status:** ✅ closed.
- **Tests:** `at0103-submit-accepts-completion.test.ts`.
- **Summary:** Submitting while the completion popup is open accepts the highlighted suggestion rather than submitting raw text.

#### [AT0104] /diff per-file accordion sheet
- **Status:** ✅ closed.
- **Tests:** `at0104-diff-sheet.test.ts`.
- **Summary:** `/diff` opens a per-file accordion sheet of the session's changes.

#### [AT0105] API retry banner
- **Status:** ✅ closed.
- **Tests:** `at0105-api-retry-banner.test.ts`.
- **Summary:** The session card surfaces claude's API-retry state as a soft banner.

#### [AT0106] Compact-boundary divider
- **Status:** ✅ closed.
- **Tests:** `at0106-compact-boundary-divider.test.ts`.
- **Summary:** The session-card transcript shows a compaction-boundary divider.

#### [AT0107] /compact live surface
- **Status:** ✅ closed.
- **Tests:** `at0107-compact-command.test.ts`.
- **Summary:** `/compact`'s live surface — the compaction divider header renders for a `/compact`-born session and the suppressed seed turn never appears in the transcript.

#### [AT0108] Unknown-event warn banner
- **Status:** ✅ closed.
- **Tests:** `at0108-unknown-event-banner.test.ts`.
- **Summary:** The session card surfaces tugcode's forward-compat `unknown_event` frame as a soft, dismissible warn banner (rather than silently dropping an untranslated top-level event).

### Focus-language, keyboard-cycling + menu-validation tags (AT0109–AT0174)

The largest cluster — the unified focus ring / selection color contract, per-component engine-driven focus, the keyboard-focus-cycling primitive, card-modal dialog keyboard models, sheet focus-trap language, singletons, and native-menu validation.

#### [AT0109] Single app-owned focus ring
- **Status:** ✅ closed.
- **Tests:** `at0109-focus-ring.test.ts`.
- **Summary:** The single app-owned focus ring (`focus-ring.css` + the engine) is the only focus indicator.

#### [AT0110] Selection color contract
- **Status:** ✅ closed.
- **Tests:** `at0110-selection-accent.test.ts`.
- **Summary:** The color contract for selection (accent tokens) holds across surfaces.

#### [AT0111] Keyboard-active ring color
- **Status:** ✅ closed.
- **Tests:** `at0111-blue-keyboard-active.test.ts`.
- **Summary:** Orange is confined to the keyboard-active ring; other focus states stay blue.

#### [AT0112] Button focus engine-driven
- **Status:** ✅ closed.
- **Tests:** `at0112-button-focus.test.ts`.
- **Summary:** The base button's focus is engine-driven.

#### [AT0113] Checkbox focus engine-driven
- **Status:** ✅ closed.
- **Tests:** `at0113-checkbox-focus.test.ts`.
- **Summary:** `TugCheckbox` focus is engine-driven.

#### [AT0114] Switch focus engine-driven
- **Status:** ✅ closed.
- **Tests:** `at0114-switch-focus.test.ts`.
- **Summary:** `TugSwitch` focus is engine-driven.

#### [AT0115] Slider focus engine-driven
- **Status:** ✅ closed.
- **Tests:** `at0115-slider-focus.test.ts`.
- **Summary:** `TugSlider` focus is engine-driven.

#### [AT0116] Tab-bar container stop
- **Status:** ✅ closed.
- **Tests:** `at0116-tab-bar-focus.test.ts`.
- **Summary:** `TugTabBar` is a single item-container focus stop with internal arrow navigation.

#### [AT0117] Radio-group container stop
- **Status:** ✅ closed.
- **Tests:** `at0117-radio-group-focus.test.ts`.
- **Summary:** `TugRadioGroup` is a single item-container focus stop.

#### [AT0118] Choice-group container stop
- **Status:** ✅ closed.
- **Tests:** `at0118-choice-group-focus.test.ts`.
- **Summary:** `TugChoiceGroup` is a single item-container focus stop.

#### [AT0119] Option-group container stop
- **Status:** ✅ closed.
- **Tests:** `at0119-option-group-focus.test.ts`.
- **Summary:** `TugOptionGroup` is a single item-container focus stop.

#### [AT0120] Accordion container stop
- **Status:** ✅ closed.
- **Tests:** `at0120-accordion-focus.test.ts`.
- **Summary:** `TugAccordion` is a single item-container focus stop (Enter descends to the inner control, Escape ascends).

#### [AT0121] List-view container stop
- **Status:** ✅ closed.
- **Tests:** `at0121-list-view-container-focus.test.ts`.
- **Summary:** `TugListView` container-stop shape.

#### [AT0122] List-view input-subordinate
- **Status:** ✅ closed.
- **Tests:** `at0122-list-view-subordinate-focus.test.ts`.
- **Summary:** `TugListView` input-subordinate shape (rows yield to an inner input).

#### [AT0125] Background-tab focus isolation
- **Status:** ✅ closed.
- **Tests:** `at0125-background-tab-focus-isolation.test.ts`.
- **Summary:** The Tab walk ignores hidden (background-tab) cards' focusables.

#### [AT0126] Keyboard ring cold-boot
- **Status:** ✅ closed.
- **Tests:** `at0126-keyboard-ring-cold-boot.test.ts`.
- **Summary:** The keyboard focus ring survives a cold boot / reload.

#### [AT0127] List-view cursor (listbox model)
- **Status:** ✅ closed.
- **Tests:** `at0127-list-view-cursor.test.ts`.
- **Summary:** `TugListView` listbox model ([P01]/[P03]) — cursor movement and selection.

#### [AT0128] Context-menu preserves input selection
- **Status:** ✅ closed.
- **Tests:** `at0128-ctx-menu-input-selection.test.ts`.
- **Summary:** A secondary-click (macOS Control-click, `button: 0`) opening the context menu on selected text in a native `TugInput` must NOT drop the selection, so Cut / Copy act on what the user had selected.

#### [AT0131] Textarea paste menu
- **Status:** ✅ closed.
- **Tests:** `at0131-textarea-paste-menu.test.ts`.
- **Summary:** Reproduces the real menu-paste flow on a `TugTextarea` (context-menu Paste lands).

#### [AT0136] Stale form-control reapply clobber guard
- **Status:** ✅ closed.
- **Tests:** `at0136-stale-reapply-clobber.test.ts`.
- **Summary:** A live edit must never be clobbered by a saved form-control snapshot when the user clicks back into the field (the now-removed `installFormControlReapplyOnNextMousedown` mechanism caused deleted TugInput text to reappear on right-click).

#### [AT0137] Textarea cut + paste round-trip
- **Status:** ✅ closed.
- **Tests:** `at0137-textarea-cut-paste.test.ts`.
- **Summary:** Cut then Paste round-trips in `TugTextarea`.

#### [AT0138] Keyboard-cycling trigger chord
- **Status:** ✅ closed.
- **Tests:** `at0138-cycle-trigger-chord.test.ts`.
- **Summary:** The keyboard-focus-cycling trigger chord enters cycle mode.

#### [AT0139] Keyboard-cycling mode scope
- **Status:** ✅ closed.
- **Tests:** `at0139-cycle-mode-scope.test.ts`.
- **Summary:** The keyboard-focus-cycling mode primitive scopes correctly to its surface.

#### [AT0140] Session card joins the cycle ring
- **Status:** ✅ closed.
- **Tests:** `at0140-cycle-session-card.test.ts`.
- **Summary:** The session card joins the keyboard-focus-cycling ring.

#### [AT0141] Session-picker persistent keyboard stop
- **Status:** ✅ closed.
- **Tests:** `at0141-picker-keys.test.ts`.
- **Summary:** The session picker is a PERSISTENT keyboard-focus stop with its own key handling.

#### [AT0142] Single-select list keyboard model
- **Status:** ✅ closed.
- **Tests:** `at0142-single-select-keyboard.test.ts`.
- **Summary:** The single-select list keyboard model (arrow + select).

#### [AT0143] Descend / Escape-ascend inside a sheet
- **Status:** ✅ closed.
- **Tests:** `at0143-descend-escape-ascend.test.ts`.
- **Summary:** Escape ascends out of a descended scope INSIDE a sheet (a descendable accordion whose inner control is a text input, inside a Radix dialog); it dismisses the sheet only at the sheet's top level.

#### [AT0144] One filled+ring per sheet
- **Status:** ✅ closed.
- **Tests:** `at0144-one-filled-ring.test.ts`.
- **Summary:** At most one filled+ring control per sheet ([P14]).

#### [AT0145] PermissionDialog keyboard model
- **Status:** ✅ closed.
- **Tests:** `at0145-permission-dialog-keyboard.test.ts`.
- **Summary:** The PermissionDialog is card-modal with a complete keyboard model.

#### [AT0146] QuestionDialog keyboard model
- **Status:** ✅ closed.
- **Tests:** `at0146-question-dialog-keyboard.test.ts`.
- **Summary:** The QuestionDialog is card-modal with a complete keyboard model.

#### [AT0147] QuestionDialog wizard nav focus
- **Status:** ✅ closed.
- **Tests:** `at0147-question-nav-focus.test.ts`.
- **Summary:** QuestionDialog wizard navigation keeps keyboard focus inside the dialog across steps.

#### [AT0148] Card-modal dialog survives reactivation
- **Status:** ✅ closed.
- **Tests:** `at0148-dialog-survives-reactivation.test.ts`.
- **Summary:** A pending card-modal dialog survives card deactivation/reactivation.

#### [AT0149] Dialog Return after Tab
- **Status:** ✅ closed.
- **Tests:** `at0149-dialog-enter-after-tab.test.ts`.
- **Summary:** Return commits the card-modal dialog's default action even after Tab moved focus within it.

#### [AT0150] Composed-sheet spatial order
- **Status:** ✅ closed.
- **Tests:** `at0150-sheet-spatial-order.test.ts`.
- **Summary:** A composed (non-dialog) sheet declares a spatial arrow order via the context-derived `useSpatialOrder(order)` form ([P22]/[P23]) — reading the enclosing `FocusModeContext` for its scope id.

#### [AT0151] Confirm-popover editor restore
- **Status:** ✅ closed.
- **Tests:** `at0151-confirm-popover-editor-restore.test.ts`.
- **Summary:** The close-confirm popover restores editor focus on dismiss.

#### [AT0152] Confirm-popover first-responder restore
- **Status:** ✅ closed.
- **Tests:** `at0152-confirm-popover-firstresponder-restore.test.ts`.
- **Summary:** A confirm popover restores the prior first responder on dismiss.

#### [AT0153] About card singleton
- **Status:** ✅ closed.
- **Tests:** `at0153-about-singleton.test.ts`.
- **Summary:** About card singleton + payload — only one About card mounts.

#### [AT0154] Settings card singleton
- **Status:** ✅ closed.
- **Tests:** `at0154-settings-singleton.test.ts`.
- **Summary:** Settings card singleton — only one Settings card mounts.

#### [AT0155] Settings propagation
- **Status:** ✅ closed.
- **Tests:** `at0155-settings-propagation.test.ts`.
- **Summary:** Settings card edits propagate to the rest of the app.

#### [AT0156] Title-bar control set
- **Status:** ✅ closed.
- **Tests:** `at0156-title-bar-controls.test.ts`.
- **Summary:** The pane title bar carries only the window-shade (collapse) and close controls — the per-pane `…` card-settings button is retired (settings live in the app-level Settings card). DOM-only, no native CGEvents.

#### [AT0157] Escape is mode-stack ordering (two-pane cycle)
- **Status:** ✅ closed.
- **Tests:** `at0157-cycle-escape-two-pane.test.ts`.
- **Summary:** Escape is mode-stack ordering, not a DOM heuristic — with a surface open over a cycle, one Escape closes the surface and the next exits the cycle.

#### [AT0158] Menu Escape close-focus
- **Status:** ✅ closed.
- **Tests:** `at0158-menu-escape-close-focus.test.ts`.
- **Summary:** Closing a service popup menu with Escape restores focus correctly.

#### [AT0159] Alert Escape
- **Status:** ✅ closed.
- **Tests:** `at0159-alert-escape.test.ts`.
- **Summary:** `tug-alert` joins the engine focus trap; Escape dismisses it.

#### [AT0160] Context-menu Escape engine-owned
- **Status:** ✅ closed.
- **Tests:** `at0160-context-menu-escape.test.ts`.
- **Summary:** `tug-context-menu` Escape is engine-owned.

#### [AT0161] QuestionDialog geometry
- **Status:** ✅ closed.
- **Tests:** `at0161-question-dialog-geometry.test.ts`.
- **Summary:** The QuestionDialog's geometry is correct (sizing / placement).

#### [AT0162] Control-click does not activate a button
- **Status:** ✅ closed.
- **Tests:** `at0162-button-ctrl-click-no-activate.test.ts`.
- **Summary:** A Control-click (macOS secondary gesture, dispatched as `click` with `ctrlKey === true`) must not fire a `TugButton`'s action — `TugButton.handleClick` ignores any `ctrlKey` click so a Ctrl-click on a Z4B chip raises only the context menu.

#### [AT0163] Sheet focus language
- **Status:** ✅ closed.
- **Tests:** `at0163-sheet-focus-language.test.ts`.
- **Summary:** Gallery sheet bodies carry the full focus language (trap + spatial order + ring). (The `list-accessory-keyboard` test that previously shared this prefix was renumbered to AT0180.)

#### [AT0164] Alert focus language
- **Status:** ✅ closed.
- **Tests:** `at0164-alert-focus-language.test.ts`.
- **Summary:** `TugAlert` carries the full focus language (trap + spatial order + ring).

#### [AT0165] Active card owns first responder
- **Status:** ✅ closed.
- **Tests:** `at0165-activation-first-responder.test.ts`.
- **Summary:** The active card always owns first responder on activation.

#### [AT0166] Per-card close-confirm + Close All
- **Status:** ✅ closed.
- **Tests:** `at0166-close-confirm-multitab-and-close-all.test.ts`.
- **Summary:** Per-card close confirmation in multi-tab panes plus the Close All path.

#### [AT0167] File-menu close validation
- **Status:** ✅ closed.
- **Tests:** `at0167-file-menu-close-validation.test.ts`.
- **Summary:** Native File-menu Close items validate against deck state.

#### [AT0168] Menu structure contract
- **Status:** ✅ closed.
- **Tests:** `at0168-menu-structure.test.ts`.
- **Summary:** The menu bar's structure contract (item presence + ordering).

#### [AT0169] Deck-tier menu validation
- **Status:** ✅ closed.
- **Tests:** `at0169-menu-deck-validation.test.ts`.
- **Summary:** Deck-state-tier menu validation (items enable/disable per deck state).

#### [AT0170] Maker-menu gate
- **Status:** ✅ closed.
- **Tests:** `at0170-maker-mode-gate.test.ts`.
- **Summary:** The Maker menu's tugbank gate (hidden unless maker mode is enabled).

#### [AT0171] Session-menu card-type validation
- **Status:** ✅ closed.
- **Tests:** `at0171-session-menu-card-type.test.ts`.
- **Summary:** Session-menu item validation by card type.

#### [AT0172] Session-menu live-state validation
- **Status:** ✅ closed.
- **Tests:** `at0172-session-menu-live-state.test.ts`.
- **Summary:** Session-menu item validation against the bound session's live state.

#### [AT0173] Settings shortcut
- **Status:** ✅ closed.
- **Tests:** `at0173-settings-shortcut.test.ts`.
- **Summary:** `⌘,` opens the Settings card.

#### [AT0174] Edit-menu validation
- **Status:** ✅ closed.
- **Tests:** `at0174-edit-menu-validation.test.ts`.
- **Summary:** The Edit menu (Cut/Copy/Paste/Delete/Select All/Undo/Redo + Find) validates against the focused responder's real edit capabilities via `AppDelegate.validateMenuItem` ← `MenuState.edit` (web responder `validateAction` projected onto the menu, D05) — replacing the native AppKit selectors that over-enabled Copy / Select All.

### Collision-renumber successor tags (AT0175–AT0180)

These tags were minted on 2026-06-11 to resolve the six prefix collisions (see the note at the top of the file). Each is the later-authored file of a colliding pair, moved off the number the earlier file kept.

#### [AT0175] Session-card mount-time focus + caret claim
- **Status:** ✅ closed (renumbered from AT0051).
- **Tests:** `at0175-session-mount-focus.test.ts`.
- **Summary:** When a session card mounts as the focused card and its session binds, the prompt-entry editor (CodeMirror's `contentDOM`) gains DOM focus AND the custom caret layer renders, all without a user click. Pins the editor-focus contract (Spec [S02], `roadmap/tugplan-session-init-orchestration.md`): every overlay that sets `inert` on `.tug-pane-body` emits a per-card `xxxDidHide` after `inert` clears, and `SessionCardBody` makes an idempotent focus claim.

#### [AT0176] Tab accepts an open completion
- **Status:** ✅ closed (renumbered from AT0104).
- **Tests:** `at0176-tab-accepts-completion.test.ts`.
- **Summary:** Tab is owned by the app focus walk, but a text editor with an open completion popup keeps Tab to accept the highlighted suggestion — while the typeahead is interactive the editor advertises `data-tug-tab-consume="true"` on its `contentDOM` and the focus walk yields Tab to the editor's completion keymap instead of advancing focus ([Q02] flag model).

#### [AT0177] Permission-mode cycle keys
- **Status:** ✅ closed (renumbered from AT0105).
- **Tests:** `at0177-permission-cycle-keys.test.ts`.
- **Summary:** Permission-mode cycling is on `⇧⌘P`, never on Shift+Tab — the keyboard path that drives the Z4B permission-mode chip.

#### [AT0178] Sheet focus-trap mode
- **Status:** ✅ closed (renumbered from AT0106).
- **Tests:** `at0178-sheet-focus-trap.test.ts`.
- **Summary:** Opening a sheet pushes a focus-trap mode onto the engine mode stack and closing it pops the mode.

#### [AT0179] Dynamic context-scoped keybinding
- **Status:** ✅ closed (renumbered from AT0107).
- **Tests:** `at0179-dynamic-keybinding.test.ts`.
- **Summary:** A dynamic, context-scoped keybinding registers and fires (complementing the static-chord coverage in AT0085 / AT0177).

#### [AT0180] List-row trailing accessory keyboard
- **Status:** ✅ closed (renumbered from AT0163).
- **Tests:** `at0180-list-accessory-keyboard.test.ts`.
- **Summary:** List-row trailing accessories join the keyboard focus language — end-to-end keyboard journey: reveal-on-cursor, Right-descend, Space→popover, confirm→landing, Left/Escape ascend, Enter-still-opens.

### Turn metric (AT0181)

#### [AT0181] Origin-first turn count — no shift, no phantom user row
- **Status:** ⚠️ partial — the behavior was **vetted live in the workspace-built app** (no count shift, no phantom `#u`) and is gated at the lower layers (the tugcast engine count, the single-count-authority reconcile/migration tests, the real-corpus engine==tugcode per-turn contract, and the tugdeck `reducer.origin` store tests). An automated in-app gate is deferred pending the corpus-isolation enabler below.
- **Tests:** lower-layer contracts (see Summary); `at0181-turns-redux.test.ts` deferred.
- **Summary:** Opening a session shows the same turn number before and after (the picker count == the highest rendered `#a`/`#u` address == `engine(file)`), and an assistant-originated turn (wake / `/compact` / `--continue` orphan) renders `#a`-only with no phantom `#u` row. Plan: `roadmap/canonical-turns-redux.md`.
- **Envelope note:** the picker-driven assertion needs a session under the active project's claude corpus. The app-test instance runs in its own worktree (a different encoded project dir), and the real reference session (`49e9aec6`, 81 turns) lives under the *main* project dir, while `~/.claude/projects` is global — so isolating a seeded real-shape session would require a test-only override of the claude-projects root (production has none today) rather than writing into the user's real corpus. Until that override lands, this case is verified by the lower-layer contracts plus live vetting on the `debug-main` instance where `49e9aec6` resides.

### Window-shade collapse (AT0194)

#### [AT0194] Window-shade collapse — clean stub, height round-trips
- **Status:** ✅ closed.
- **Tests:** `at0194-window-shade-collapse.test.ts`.
- **Summary:** Collapsing a card to the window-shade stub leaves no chrome protruding below the title bar (the chrome paints at the frame's border-box, not 2px taller), and a title-bar interaction (click/drag) on the *collapsed* card preserves the stored expanded height instead of committing the collapsed stub height — so re-expanding restores the card to its original height. Guards [D07] / [D27]. Native CGEvents (click + drag).

### Text card live autosave (AT0209)

#### [AT0209] Text card — open, autosave-in-place, conflict, quit-flush
- **Status:** ✅ open (new feature gate).
- **Tests:** `at0209-text-card-live-autosave.test.ts`.
- **Summary:** The Text card's saveless core loop on real temp files: opening renders disk content byte-for-byte; typing lands on disk within the autosave debounce with no explicit save; an external write racing an unflushed local edit raises the hash-conflict banner (409) instead of clobbering either side, and "Reload from Disk" adopts the external content; quitting inside the debounce window still lands the edit via the teardown flush, and a fresh process re-opens the flushed content. Native CGEvents (click + type).

### Route enhancements — three-route chrome (AT0215–AT0216)

#### [AT0215] Three-route Session card — per-route Z4B chrome, flanking geometry, btw round-trip
- **Status:** ✅ open (new feature gate).
- **Tests:** `at0215-route-chrome.test.ts`.
- **Summary:** The `code | shell | btw` Session card. The per-route Z4B chrome manifest mounts exactly its Table T01 chip set on each route (chips a route drops UNMOUNT — code shows Session/Project/Mode/Model/Effort, shell shows Project/Cwd, btw shows Session/Project), verified across a choice-group click (→ Shell) and the ⇧⌘B keybinding (→ btw). Risk R04: the leading Z4A choice group and trailing Z5 submit button stay pixel-fixed while the centred-floating Z4B cluster swaps width. The `?`-route submission is a native side question ([P02]): submitting on btw opens the overlay and the ask + settled answer never change the transcript entry count (the [D108] invariant, beside AT0211). Guards [P01]/[P02]/[P03], Table T01. Native CGEvents (click + type + key) + a synthetic ⇧⌘B keydown.

#### [AT0216] Shell route — exchange e2e, live cwd, restore interleave
- **Status:** ✅ open (new feature gate).
- **Tests:** `at0216-shell-route.test.ts`.
- **Summary:** The `$` route end-to-end against the REAL shell backend ([P06]/[P07], Risk R02). Submitting `echo` / `cd` / `pwd` through the prompt entry sends SHELL_INPUT over the live connection; tugcast's per-session shell child executes each command and the SHELL_OUTPUT frames settle a transcript row carrying the command, the combined output, and the exit label — non-context ink ([P11]), tagged `[data-slot="session-transcript-shell-row"]` with `[data-participant="shell"]`. The stateful `cd` moves the live Cwd chip ([P10]) and the following `pwd` prints the moved directory (proving the shell session persists across exchanges). Restore ([P07]): after Maker ▸ Reload, a real `spawn_session(resume)` replays a fixture JSONL Claude turn while the ledgered exchanges restore through `list_shell_exchanges`; the reloaded transcript reproduces the identical interleaved row order (`user, assistant, shell, shell, shell`) and shell row content regardless of arrival order — the ledger restore can land before the JSONL replay, so a replayed Claude turn slides back past the already-seated shell rows to its arrival position (append order is the source of truth; the real corpus is 39% non-monotonic in timestamp, so timestamp is not a safe global sort key). Native CGEvents (click + type + key).

### Focus / alert / status polish (AT0217–AT0220)

#### [AT0217] Pane-modal sheet default ring survives click-away / click-back
- **Status:** ✅ open (regression gate).
- **Tests:** `at0217-sheet-default-ring-click-back.test.ts`.
- **Summary:** Clicking away from a pane with an open pane-modal sheet and clicking back re-establishes the sheet's default button as the key view with the keyboard ring ([P16]/[P20]) — the sheet-tier counterpart of AT0203's card-modal coverage.

#### [AT0218] TugAlert `choose()` rows — selectable list + OK/Cancel commit model
- **Status:** ✅ open (new feature gate).
- **Tests:** `at0218-alert-chooser-rows.test.ts`.
- **Summary:** The multi-action `choose()` alert renders rich rows as a selectable list (arrow-roved highlight, click moves highlight only) while OK wears the persistent default ring and Return commits the highlighted row.

#### [AT0219] WORK-cell revamp — aggregate count, no turn-boundary flicker
- **Status:** ✅ open (new feature gate).
- **Tests:** `at0219-work-revamp.test.ts`.
- **Summary:** The Z2 WORK cell aggregates one active count across incomplete tasks + running jobs + scheduled rows + active goal, and holds steady across a turn boundary whose first streamed block is not a Task frame.

#### [AT0220] Z4B Mode / Model / Effort lock while a turn is in flight
- **Status:** ✅ open (regression gate).
- **Tests:** `at0220-settings-chips-turn-lock.test.ts`.
- **Summary:** Mode / Model / Effort controls act only while `canSubmit` (idle/errored + online); mid-turn interaction is declined at the setter seam so a control change can never race or tear down a running turn ([R07]).

### Transcript find (AT0221)

#### [AT0221] Transcript find — index↔DOM fidelity gate
- **Status:** ✅ open (new feature gate).
- **Tests:** `at0221-transcript-find-fidelity.test.ts`.
- **Summary:** The Find engine's count↔paint invariant over a real replayed session: the count chip's whole-transcript total equals the painted `data-tugx-findable` ranges, whose document-order casing sequence equals the fixture's hand-computed source order (per-row ORDER alignment across a markdown user body, a thinking+text mixed row, and heading/em/bold/code/link/list/table constructs); chrome text (a collapsed Bash header command containing the query) never paints; ⌘G advances the active match; a query spanning two adjacent findable containers matches nothing while each side alone matches inside its own container; and on a long virtualized transcript the count is scroll-independent with ⌘G wrap across off-screen matches. Also the reveal contract: typing alone scrolls the first match into the visible band (below the pinned chrome, above the scroller's bottom edge), refining the query re-reveals when the active match's identity moves, and the landing-flash ring is an absolutely-positioned child of the scroller — contained by its box, overlapping the active match, never floating over chrome.

#### [AT0222] One-shot /shell and /find from the Code route
- **Status:** ✅ open (new feature gate).
- **Tests:** `at0222-one-shot-commands.test.ts`.
- **Summary:** The Code route's one-shot accelerators: `/shell <cmd>` settles a real exchange row while the route stays `❯`; `/find <query>` paints the transcript matches with the first active, ⌘G cycles across rows, Escape (empty editor) dissolves the highlights, a fresh `/find` re-seeds, and a subsequent non-find submission dissolves again; on the `$` route the `/` completion popup withholds the `codeRouteOnly` set (`shell`/`find`/`btw`) while ordinary local commands stay offered.

#### [AT0223] Text card bottom find bar
- **Status:** ✅ open (new feature gate).
- **Tests:** `at0223-text-card-find-bar.test.ts`.
- **Summary:** The Text card's find bar is the Dev entry's find face on the shared `TugEntryShell`, docked between the editor and the status bar: a CM6 substrate query field above the shell toolbar (shared Case/Word/Grep cluster + count badge centred; outlined-↑ / filled-↓ Z5 pair trailing; no route trigger, no ✕). ⌘F summons it with focus in the field, typing counts over CM6 search decorations, Enter advances / Shift-Enter retreats / the ↓ button advances, the Case toggle narrows the count live, Escape closes and clears decorations, wrapping past the last match raises the shared `FindSession`-driven wrap indicator (the same overlay the Session card shows), and the Case toggle persists into a freshly opened bar through the global find-options preference (`dev.tugtool.find`/`options`).

#### [AT0224] Active-card keyboard contract
- **Status:** ✅ open (new feature gate).
- **Tests:** `at0224-card-active-keyboard.test.ts`.
- **Summary:** Keyboard accelerators land on the active card no matter how it became active: a pane title-bar click preserves first responder (`data-tug-fr-preserve` — the title bar is an activation/drag surface, never a responder target), so ⇧⌘S still flips the route with the caret resting in the entry; reactivating a deactivated card by its title bar restores that card's first responder to its key view ([P21]'s finer-restore), so the route chord lands on the reactivated card and not its neighbor; ⌘F after a title-bar click opens the Text card's find bar with the caret in the query field; ⌘G / ⇧⌘G advance / retreat the match while the find FIELD is focused (the bar is the responder for find navigation); and a text card created-and-activated in one gesture (`openFileInCard` — Open Quickly's commit path) owns ⌘F immediately — CardHost completes the activation focus claim at mount / engine-hook registration, and the text editor registers engine hooks so the claim resolves. Cycling (Ctrl-`) to a never-focused text card gives it ⌘F immediately and a subsequent title-bar click cannot wedge the keyboard — the [P21] reconciler (key-card changes + chain registration changes, default-focus target for never-focused cards) maintains the invariant for every card type uniformly.

## Maintenance

This file is append-only for the tag list. Status fields update as fixes land or regress. Removing a tag requires a documented decision and a successor tag noted inline (`[M{NN}] superseded by [M{MM}] — see ...`).

When a test file is renamed, the inventory entry's "Tests:" line must be updated in the same commit. The renaming-history note (e.g., AT0037/AT0038's "renamed from m26-*/m27-*") is preserved for archaeology.
