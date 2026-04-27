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

1. Pick the next unused `AT{NNNN}`. The current high-water mark is **AT0038**.
2. Add an entry below in the appropriate section (or create a section).
3. State, in one line each: card types, state axes, trigger, status.
4. Cross-link the elaborated entry in `roadmap/tugplan-selection.md` if applicable.
5. Add the gating test as `tests/app-test/at{NNNN}-{slug}.test.ts`.

## Inventory

### Transition-class tags (AT0001–AT0023)

In-session transitions, focus restore paths, and cross-card selection. Surfaced from the selection plan's pre-25 audit.

#### [AT0001] Intra-pane tab switch — FC focus loss
- **Status:** ✅ closed.
- **Tests:** `at0001-tab-switch-fc.test.ts`, `at0001-rapid-cadence.test.ts`.
- **Summary:** FC card loses focus when its tab deactivates (via `display: none` blur); on return, refocus + selection paint must restore. Rapid-cadence variant exercises back-to-back tab clicks.

#### [AT0002] Intra-pane tab switch — EM focus loss
- **Status:** ✅ closed.
- **Tests:** `at0002-tab-switch-em.test.ts`.
- **Summary:** Same shape as AT0001 for engine-managed cards (tide, gallery-prompt-input, gallery-prompt-entry); engine root re-focuses + selection paint restores on return.

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
- **Summary:** `tug-markdown-view` opts into the [A9] state preservation protocol; copy-selection round-trips through `bag.domSelection` + selectionGuard's CSS Custom Highlight.

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

Component-level state preservation — gaps surfaced from the L23 audit of the stateful component roster. All route through the [A9] Component State Preservation Protocol.

#### [AT0024] No component-level state preservation protocol
- **Status:** ✅ closed at Step 19 ([A9] foundational landed).
- **Tests:** `selection-persistence-integration.test.tsx` (foundational gate); per-component coverage in AT0027/AT0030/AT0031.
- **Summary:** `useComponentStatePreservation` + `ComponentStatePreservationRegistry` provide the protocol; components opt in via `componentStatePreservationKey`.

#### [AT0025] Intrinsic internal state hidden from authors
- **Status:** ✅ closed in spirit by 25D / 25E / 25F / 25G — every priority-roster component is now opted in or explicitly classified ephemeral.
- **Tests:** N/A — closure is structural (the protocol exists; per-component coverage rides AT0027/AT0030/AT0031).
- **Summary:** [A9d] roster of opt-ins resolves which internal states are user-visible (capture/restore) vs. ephemeral (no opt-in). See selection-plan [A9d] for the resolved roster.

#### [AT0026] Open-overlay persistence semantics
- **Status:** ✅ closed at Step 25F.
- **Tests:** `at0026-overlay-persistence.test.ts`.
- **Summary:** `tug-sheet` is PERSISTENT (opts into [A9]); `tug-alert`, `tug-confirm-popover`, `tug-popover`, `tug-tooltip`, `tug-context-menu` are EPHEMERAL by design.

#### [AT0027] Layout state — split-pane divider, accordion expansion
- **Status:** ✅ closed at Step 25D / 25E.
- **Tests:** `at0027-layout-state-persistence.test.ts`.
- **Summary:** `tug-accordion` opts into [A9]; `tug-split-pane` keeps its existing `storageKey` → tugbank path (pane-scope by intent). 25E extended the same Closed status to switch / radio-group / choice-group / option-group / slider / value-input.

#### [AT0028] Banner / bulletin dismiss
- **Status:** ❌ open (deferred).
- **Tests:** none yet.
- **Summary:** Originally planned as Step 25I; deferred. Closure requires a separate user-preferences store under `dev.tugtool.user.dismissals/{bannerId}`, distinct from the card-scope [A9] protocol.

#### [AT0029] Scroll-key audit across components
- **Status:** ❌ open (deferred).
- **Tests:** none yet.
- **Summary:** Originally planned as Step 25H; deferred. Walk every stateful component for scrollable sub-regions; add `data-tug-scroll-key` where the IS axis applies.

#### [AT0030] Virtual-focus / focus-within for composite components
- **Status:** ✅ closed at Step 25E (selected-value axis); virtual-focus-without-selection deferred.
- **Tests:** `at0030-virtual-focus.test.ts`.
- **Summary:** `tug-radio-group`, `tug-choice-group`, `tug-option-group` capture their selected value via [A9]. The narrower "focused but not selected" axis is deferred — niche edge case.

#### [AT0031] `tug-prompt-entry` chrome state (`route`, `toolsOpen`)
- **Status:** ✅ closed for `gallery-prompt-entry` at Step 25G; tide-card lazy-mount gap documented.
- **Tests:** `at0031-prompt-entry-chrome.test.ts`.
- **Summary:** `toolsOpen` rides `bag.components.entry-chrome`; `route` stays in `bag.content.currentRoute` (it's the index into `perRoute`, splitting would force two-phase restore [L23 violation]). Tide's lazy `TugPromptEntry` mount falls outside the [A9c] orchestrator's one-shot restore window — separate follow-up gap.

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

#### [AT0035] App-switch selection survival (EM + tide)
- **Status:** ✅ closed at Step 23G.
- **Tests:** `at0035-em-app-switch-selection.test.ts`, `at0035-tide-app-switch-selection.test.ts`.
- **Summary:** Selection survives cmd-tab away + back for EM cards. Tide-specific variant exercises the redundant focus-paths bug (legacy `cardDidActivate` + framework `onCardActivated`) that triggered WebKit's selectionchange-on-focus quirk intermittently. The 23G fix routes the delegate's `focus()` through `engine.setSelectedRange` for the WebKit-safe focus-then-select pattern.

#### [AT0036] Inactive-card cmd-tab selection survival
- **Status:** ✅ closed at Step 25C.5 Layer 4.
- **Tests:** `at0036-inactive-card-app-switch-selection.test.ts`.
- **Summary:** FC card (TugInput) selection survives the cmd-tab cycle WHILE inactive, plus a re-activation click that would otherwise clobber the saved selection. Closure pattern: form-control mount-restore is one-shot; activation-time re-apply is `installFormControlReapplyOnNextMousedown`'s job (deterministic event-ordering primitive, no RAF/timing).

### Multi-card paint invariants (AT0037–AT0038)

Surfaced during selection-plan Step 25C.4 (active/inactive paint split). Gate cross-card selection invariants the paint architecture must maintain.

#### [AT0037] Multi-card deck-wide restore consistency
- **Status:** ✅ closed at Step 25C.4.
- **Tests:** `at0037-deck-wide-restore-consistency.test.ts` (renamed from `m26-*` during the 25L AT-series audit; original numbering collided with the AT0026 overlay-policy tag).
- **Summary:** On a multi-card deck restore, exactly one card holds document focus AND its range is in `window.getSelection()`; every inactive card's range lives in `selectionGuard.cardRanges` + the `inactive-selection` CSS Custom Highlight; bag-on-disk preserves the four 25C.3 axes (text/atoms/selection/scrollTop) per card.

#### [AT0038] Deactivation-time inactive paint
- **Status:** ✅ closed at Step 25C.4.
- **Tests:** `at0038-deactivation-inactive-paint.test.ts` (renamed from `m27-*` during the 25L AT-series audit; original numbering collided with the AT0027 layout-state tag).
- **Summary:** When a user deactivates a scrolled EM card with a selection, `paintMirrorAsInactive(publish)` rebuilds a DOM Range at the user's actual selection — not at a wrong scroll-relative position. Gates `flatToDom`'s correctness against scrolled content.

## Maintenance

This file is append-only for the tag list. Status fields update as fixes land or regress. Removing a tag requires a documented decision and a successor tag noted inline (`[M{NN}] superseded by [M{MM}] — see ...`).

When a test file is renamed, the inventory entry's "Tests:" line must be updated in the same commit. The renaming-history note (e.g., AT0037/AT0038's "renamed from m26-*/m27-*") is preserved for archaeology.
