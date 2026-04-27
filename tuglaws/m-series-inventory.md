# M-Series Inventory

Canonical registry of M-tags — the persistent inventory of selection / focus / state-persistence regression cases that the test harness gates. M-tags are stable, append-only identifiers; once assigned, a number is never reused. Tests live in `tests/in-app/m{NN}-*.test.ts` and their filename `m{NN}` prefix MUST match an entry in this inventory.

The selection-plan history (`roadmap/tugplan-selection.md`) captures the elaborated rationale, mechanism, closing-requires, and architectural cross-links for each tag. This file is the *index* — the quick map from tag → status → gating test(s) → one-line summary. When the two diverge, the selection plan's per-tag block is authoritative for design intent; this inventory is authoritative for tag numbering and current status.

## Conventions

- **Tag format:** `[M{NN}]` — two-digit zero-padded.
- **Status legend:**
  - ✅ Closed — fix landed; gating test(s) pass.
  - ⚠️ Partial — some axis closed, residual axis open or deferred.
  - ❌ Open — no fix; gating test absent or failing-by-design.
  - ❓ Untested — no gating test exists yet; behavior unverified.
  - ⬛ Not-a-feature — closed-as-WONTFIX with a documented decision.
  - 🔧 Infra — infrastructure gap that blocks other tags; not a user-visible bug per se.
- **Gating tests:** filenames listed point to `tests/in-app/`. Multiple tests per tag are allowed (e.g., FC half + EM half, or rapid-cadence variant).
- **Numbering invariant:** test filename's `m{NN}` prefix MUST match a tag in this inventory. If a test gates a regression that isn't in the inventory, *add a tag first*, then name the test.

## Adding a new tag

1. Pick the next unused `MNN`. The current high-water mark is **M38**.
2. Add an entry below in the appropriate section (or create a section).
3. State, in one line each: card types, state axes, trigger, status.
4. Cross-link the elaborated entry in `roadmap/tugplan-selection.md` if applicable.
5. Add the gating test as `tests/in-app/m{NN}-{slug}.test.ts`.

## Inventory

### Transition-class tags (M01–M23)

In-session transitions, focus restore paths, and cross-card selection. Surfaced from the selection plan's pre-25 audit.

#### [M01] Intra-pane tab switch — FC focus loss
- **Status:** ✅ closed.
- **Tests:** `m01-tab-switch-fc.test.ts`, `m01-rapid-cadence.test.ts`.
- **Summary:** FC card loses focus when its tab deactivates (via `display: none` blur); on return, refocus + selection paint must restore. Rapid-cadence variant exercises back-to-back tab clicks.

#### [M02] Intra-pane tab switch — EM focus loss
- **Status:** ✅ closed.
- **Tests:** `m02-tab-switch-em.test.ts`.
- **Summary:** Same shape as M01 for engine-managed cards (tide, gallery-prompt-input, gallery-prompt-entry); engine root re-focuses + selection paint restores on return.

#### [M03] Pane activation change
- **Status:** ✅ closed.
- **Tests:** `m03-pane-activation.test.ts`, `m03-rapid-cadence.test.ts`.
- **Summary:** Cross-pane activation must flip `isFocusDestination` and refocus the new active card's input.

#### [M04] App resign → become-active focus restore
- **Status:** ✅ closed.
- **Tests:** `m04-app-resign-return.test.ts`.
- **Summary:** Cmd-tab away + back must re-apply `bag.focus` for the deck-level first responder.

#### [M05] App hide → unhide
- **Status:** ✅ closed.
- **Tests:** `m05-app-hide-unhide.test.ts`.
- **Summary:** Cmd-H hide / unhide cycle — same focus-restore contract as M04.

#### [M06] Cross-pane move — focus restore
- **Status:** ✅ closed.
- **Tests:** `m06-cross-pane-drag.test.ts` (FC half), `m06-em-cross-pane.test.ts` (EM half).
- **Summary:** Drag a card from pane A to pane B; the dropped card receives focus + selection paint.

#### [M07] Card detach
- **Status:** ✅ closed.
- **Tests:** `m07-card-detach.test.ts` (FC half), `m07-em-card-detach.test.ts` (EM half).
- **Summary:** Drag a card out of its pane into a new standalone pane; same shape as M06.

#### [M08] `onCardActivated` hook — infrastructure
- **Status:** ✅ closed (infra landed at Step 23B).
- **Tests:** N/A — covered by the M02/M04/M05/M06/M07/M09 EM-half tests above.
- **Summary:** Optional `onCardActivated?(): void` callback in `CardPersistenceCallbacks`; EM content factories implement it. Closes the M-Q2 design question.

#### [M09] Inactive-mount EM card
- **Status:** ✅ closed.
- **Tests:** `m09-em-inactive-mount.test.ts`.
- **Summary:** EM card mounts in an inactive tab; engine's `setSelectedRange` no-ops on a `display: none` root. On user-activate, the activation hook re-focuses + reapplies selection.

#### [M10] Markdown-view copy-selection persistence
- **Status:** ✅ closed at Step 25B.
- **Tests:** `m10-markdown-selection.test.ts`, `m10-cold-boot-selection.test.ts`.
- **Summary:** `tug-markdown-view` opts into the [A9] persistence protocol; copy-selection round-trips through `bag.domSelection` + selectionGuard's CSS Custom Highlight.

#### [M11] Card close → reopen
- **Status:** ⬛ not-a-feature (M-Q4 resolution).
- **Tests:** N/A.
- **Summary:** No reopen UI path is planned. Close-on-flush remains for crash-recovery only.

#### [M12] IME composition mid-transition
- **Status:** ❌ open.
- **Tests:** none yet (gated behind a CJK / IME availability check, planned for [25J]).
- **Summary:** New `bag.markedText` axis required to preserve in-flight composition buffer across transitions. Out of scope for the 25C–25G core selection-plan series.

#### [M13] Integration test coverage for in-session transitions
- **Status:** ✅ closed by the M-tag-specific tests landed across 25A–25K.
- **Tests:** every other M-tag's gating tests collectively.
- **Summary:** Originally framed as "no integration tests exist for tab switch / pane activation / etc." — addressed not by extending one mega-test file but by landing a focused `m{NN}-*.test.ts` per M-tag. The inventory itself is the integration test plan; coverage is complete iff every Closed/Partial tag has a green gating test.

#### [M14] Scroll persistence
- **Status:** ✅ closed.
- **Tests:** `m14-scroll-persistence.test.ts`, `m14-cold-boot-scroll.test.ts`.
- **Summary:** `bag.regionScroll` round-trips across tab switch + cmd-tab on `gallery-markdown-50kb`.

#### [M15] Legacy `saveSelection` / `restoreSelection` / `SavedSelection`
- **Status:** ⚠️ partial — production callers retired, surface still exists for test compatibility.
- **Tests:** `selection-persistence-greps.test.ts` (grep contract).
- **Summary:** API still exported from `selection-guard.ts`; remaining call sites are inside the file's own test fixtures. Retire fully when no test depends on the surface.

#### [M16] Tab close — focus handoff to neighbor
- **Status:** ✅ closed.
- **Tests:** `m16-tab-close-handoff.test.ts`, `m16-rapid-cadence.test.ts`.
- **Summary:** Closing the active tab promotes a neighbor; the new active card receives focus.

#### [M17] `saveState` RPC parity
- **Status:** ✅ closed.
- **Tests:** `m17-savestate-rpc-parity.test.ts`.
- **Summary:** Native `window.tugdeck.saveState()` and the will-phase / window-blur path produce JSON-equal bags for steady state.

#### [M18] Async content-load race
- **Status:** ✅ closed for synchronous-restore factories (current shipping set).
- **Tests:** `m18-async-content-race.test.ts`.
- **Summary:** Save fires before / during content-load — `restorePendingRef` gates `invokeSaveCallback` so the stub doesn't overwrite seeded content.

#### [M19] Pane teardown — flush path
- **Status:** ✅ closed.
- **Tests:** `m19-pane-teardown-flush.test.ts`.
- **Summary:** `_closePane` flushes every card's `onSave` before any `cardWillBeginDestruction`; `__tug.closePane` exercises the path.

#### [M20] Modal overlay dismiss → focus return
- **Status:** ✅ closed.
- **Tests:** `m20-overlay-focus-return.test.ts`.
- **Summary:** Editor context-menu Escape → focus lands back in the editor (representative of all portal-then-dismiss surfaces).

#### [M21] Drag aborted — card state preservation
- **Status:** ✅ closed.
- **Tests:** `m21-drag-aborted.test.ts`.
- **Summary:** Drag + Escape (or invalid drop) returns the card to its original pane with focus + selection unchanged.

#### [M22] Engine caret visibility
- **Status:** ✅ closed.
- **Tests:** `m22-caret-visibility.test.ts`.
- **Summary:** After every refocus path (cold-boot, app cycle, tab switch), `document.activeElement` is the engine root AND `document.hasFocus() === true` (caret blinks).

#### [M23] Cross-card selection
- **Status:** ✅ closed (paint system doesn't crash; cross-card ranges treated as informational).
- **Tests:** `m23-cross-card-selection.test.ts`.
- **Summary:** Native drag from card A's content to card B's content does not throw on `window.getSelection()` or `__tug.getSelection(cardId)`.

### Component-roster tags (M24–M31)

Component-level persistence — gaps surfaced from the L23 audit of the stateful component roster. All route through the [A9] Component Persistence Protocol.

#### [M24] No component-level persistence protocol
- **Status:** ✅ closed at Step 19 ([A9] foundational landed).
- **Tests:** `selection-persistence-integration.test.tsx` (foundational gate); per-component coverage in M27/M30/M31.
- **Summary:** `useComponentPersistence` + `ComponentPersistenceRegistry` provide the protocol; components opt in via `persistKey`.

#### [M25] Intrinsic internal state hidden from authors
- **Status:** ✅ closed in spirit by 25D / 25E / 25F / 25G — every priority-roster component is now opted in or explicitly classified ephemeral.
- **Tests:** N/A — closure is structural (the protocol exists; per-component coverage rides M27/M30/M31).
- **Summary:** [A9d] roster of opt-ins resolves which internal states are user-visible (capture/restore) vs. ephemeral (no opt-in). See selection-plan [A9d] for the resolved roster.

#### [M26] Open-overlay persistence semantics
- **Status:** ✅ closed at Step 25F.
- **Tests:** `m26-overlay-persistence.test.ts`.
- **Summary:** `tug-sheet` is PERSISTENT (opts into [A9]); `tug-alert`, `tug-confirm-popover`, `tug-popover`, `tug-tooltip`, `tug-context-menu` are EPHEMERAL by design.

#### [M27] Layout state — split-pane divider, accordion expansion
- **Status:** ✅ closed at Step 25D / 25E.
- **Tests:** `m27-layout-state-persistence.test.ts`.
- **Summary:** `tug-accordion` opts into [A9]; `tug-split-pane` keeps its existing `storageKey` → tugbank path (pane-scope by intent). 25E extended the same Closed status to switch / radio-group / choice-group / option-group / slider / value-input.

#### [M28] Banner / bulletin dismiss
- **Status:** ❌ open (deferred).
- **Tests:** none yet.
- **Summary:** Originally planned as Step 25I; deferred. Closure requires a separate user-preferences store under `dev.tugtool.user.dismissals/{bannerId}`, distinct from the card-scope [A9] protocol.

#### [M29] Scroll-key audit across components
- **Status:** ❌ open (deferred).
- **Tests:** none yet.
- **Summary:** Originally planned as Step 25H; deferred. Walk every stateful component for scrollable sub-regions; add `data-tug-scroll-key` where the IS axis applies.

#### [M30] Virtual-focus / focus-within for composite components
- **Status:** ✅ closed at Step 25E (selected-value axis); virtual-focus-without-selection deferred.
- **Tests:** `m30-virtual-focus.test.ts`.
- **Summary:** `tug-radio-group`, `tug-choice-group`, `tug-option-group` capture their selected value via [A9]. The narrower "focused but not selected" axis is deferred — niche edge case.

#### [M31] `tug-prompt-entry` chrome state (`route`, `toolsOpen`)
- **Status:** ✅ closed for `gallery-prompt-entry` at Step 25G; tide-card lazy-mount gap documented.
- **Tests:** `m31-prompt-entry-chrome.test.ts`.
- **Summary:** `toolsOpen` rides `bag.components.entry-chrome`; `route` stays in `bag.content.currentRoute` (it's the index into `perRoute`, splitting would force two-phase restore [L23 violation]). Tide's lazy `TugPromptEntry` mount falls outside the [A9c] orchestrator's one-shot restore window — separate follow-up gap.

### EM-card focus follow-up gates (M32–M36)

Surfaced during selection-plan Step 23F / 23G / 25C.5 work. Each closes a specific EM-card focus or selection bug that escaped the M01–M23 transition coverage.

#### [M32] EM cold-boot selection paint
- **Status:** ✅ closed at Step 23F.
- **Tests:** `m32-em-cold-boot-selection.test.ts`.
- **Summary:** Saved selection round-trips through cold-boot / mount-restore for an EM card seeded as ACTIVE. Gates the `cold-boot-restore-snapshot` + `engine-restore-applied` diagnostic chain that 23F established.

#### [M33] Fresh-EM-card resolver classification
- **Status:** ✅ closed at Step 23F.
- **Tests:** `m33-em-fresh-card-activation.test.ts`.
- **Summary:** Pre-23F, `resolveActivationTarget` discriminated EM vs FC by `bag.content !== undefined`; fresh never-saved EM cards mis-classified as FC and focus landed on a toolbar button instead of the contenteditable. 23F adds `engineKind: "em"` to the card registry; this test is the regression gate.

#### [M34] EM focus after cross-pane move
- **Status:** ✅ closed at Step 23F.
- **Tests:** `m34-em-focus-after-move.test.ts`.
- **Summary:** Pre-23F, `engine-activation-dispatched` fired on a cross-pane drag (proving `onCardActivated` ran) but `.focus()` no-op'd on the freshly re-mounted contenteditable, leaving `document.activeElement` on BODY. This test is the regression gate for the actual focus-landing assertion that m06-em / m07-em deliberately omit.

#### [M35] App-switch selection survival (EM + tide)
- **Status:** ✅ closed at Step 23G.
- **Tests:** `m35-em-app-switch-selection.test.ts`, `m35-tide-app-switch-selection.test.ts`.
- **Summary:** Selection survives cmd-tab away + back for EM cards. Tide-specific variant exercises the redundant focus-paths bug (legacy `cardDidActivate` + framework `onCardActivated`) that triggered WebKit's selectionchange-on-focus quirk intermittently. The 23G fix routes the delegate's `focus()` through `engine.setSelectedRange` for the WebKit-safe focus-then-select pattern.

#### [M36] Inactive-card cmd-tab selection survival
- **Status:** ✅ closed at Step 25C.5 Layer 4.
- **Tests:** `m36-inactive-card-app-switch-selection.test.ts`.
- **Summary:** FC card (TugInput) selection survives the cmd-tab cycle WHILE inactive, plus a re-activation click that would otherwise clobber the saved selection. Closure pattern: form-control mount-restore is one-shot; activation-time re-apply is `installFormControlReapplyOnNextMousedown`'s job (deterministic event-ordering primitive, no RAF/timing).

### Multi-card paint invariants (M37–M38)

Surfaced during selection-plan Step 25C.4 (active/inactive paint split). Gate cross-card selection invariants the paint architecture must maintain.

#### [M37] Multi-card deck-wide restore consistency
- **Status:** ✅ closed at Step 25C.4.
- **Tests:** `m37-deck-wide-restore-consistency.test.ts` (renamed from `m26-*` during the 25L M-series audit; original numbering collided with the M26 overlay-policy tag).
- **Summary:** On a multi-card deck restore, exactly one card holds document focus AND its range is in `window.getSelection()`; every inactive card's range lives in `selectionGuard.cardRanges` + the `inactive-selection` CSS Custom Highlight; bag-on-disk preserves the four 25C.3 axes (text/atoms/selection/scrollTop) per card.

#### [M38] Deactivation-time inactive paint
- **Status:** ✅ closed at Step 25C.4.
- **Tests:** `m38-deactivation-inactive-paint.test.ts` (renamed from `m27-*` during the 25L M-series audit; original numbering collided with the M27 layout-state tag).
- **Summary:** When a user deactivates a scrolled EM card with a selection, `paintMirrorAsInactive(publish)` rebuilds a DOM Range at the user's actual selection — not at a wrong scroll-relative position. Gates `flatToDom`'s correctness against scrolled content.

## Maintenance

This file is append-only for the tag list. Status fields update as fixes land or regress. Removing a tag requires a documented decision and a successor tag noted inline (`[M{NN}] superseded by [M{MM}] — see ...`).

When a test file is renamed, the inventory entry's "Tests:" line must be updated in the same commit. The renaming-history note (e.g., M37/M38's "renamed from m26-*/m27-*") is preserved for archaeology.
