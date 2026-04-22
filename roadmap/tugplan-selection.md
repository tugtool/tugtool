<!-- tugplan-skeleton v2 -->

## Selection, Focus, Scroll, and Content Persistence Subsystem {#phase-selection-subsystem}

**Purpose:** Define a complete, code-grounded strategy for tracking, managing, saving, and restoring text content, text selection, focus, and scroll position across every card, component, and lifecycle transition in tugdeck.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-04-22 |

---

### Phase Overview {#phase-overview}

#### Redo mandate {#redo-rationale}

An earlier version of this plan proposed a 16-step `SelectionKeeper` subsystem and reached partial implementation (Steps 1–6 committed, Step 7 attempted) before manual verification failed. The failure mode was not a bug — it was the plan.

Root cause: every decision in the previous plan was written against a theoretical model of how tugdeck handles selection, without grounding that model in the actual codebase. Multiple overviewer and critic audits reviewed the plan document for internal coherence but never validated its claims against real code. The core false premise — "the keeper can be the sole owner of selection save/restore" — silently collided with the fact that `TugTextEngine.restoreState` already owns selection restore for tide cards via `setSelectedRange`. That conflict, which a single `grep` would have surfaced, propagated through 16 steps of elaboration and six committed steps of implementation.

All committed work on the previous plan (commits `0f239b14` through `183d8af5`) has been rolled back. This document starts over from a code audit.

#### Scope {#scope}

The new plan must cover, end-to-end, the persistence of:

- **Text content** (card-level `bag.content`, component-internal engine state, controlled React state).
- **DOM selection** (`window.getSelection()` ranges inside contentEditable regions and in card chrome).
- **Form-control selection** (`<input>` / `<textarea>` `selectionStart` / `selectionEnd` / `selectionDirection`).
- **Focus** (`document.activeElement`).
- **Scroll position** (card-level scroll on `hostContentEl`, per-input scroll inside form controls, per-region scroll inside card content).

Across every one of these transitions:

- App active / resign active.
- App hide / unhide.
- Browser reload (`window.beforeunload`, `document.visibilitychange(hidden)`).
- Process relaunch (Swift `applicationShouldTerminate` → `saveState` RPC).
- Card activate / deactivate (within a pane).
- Pane activate / deactivate (within the deck).
- Card drag / move / resize.
- Pane drag / move / resize.
- Tab switch (card activation inside a multi-card pane).
- Cross-pane card move.

---

### Code audit {#audit}

This section is the single authoritative map of the system as it exists **today** (commit `01568587`). Every future design decision must cite a row here. Rows in italics are known gaps or conflicts — they are *not* load-bearing claims, they are signals of where the current system is broken or ambiguous.

#### Layered architecture {#audit-layers}

There are four distinct persistence layers in tugdeck. Every concept below is owned by exactly one, sometimes two (the collisions are spelled out in [#audit-collisions](#audit-collisions)):

1. **Deck-state layer** (`deck-manager.ts`, `settings-api.ts`). Saves the deck layout (panes, cards, positions, active-pane / active-card-per-pane pointers) and the global `initialFocusedCardId` pointer. Stored as `dev.tugtool.deck.layout`, `dev.tugtool.deck.state/focusedCardId`, `dev.tugtool.deck.cardstate/{cardId}` in tugbank.
2. **Card-host layer** (`components/chrome/card-host.tsx`). Saves and restores per-card scroll, per-card content payload (via `useCardPersistence`), and per-input DOM-authority state (value, selection, scroll) via `captureDomInputs` / `applyDomInputSnapshot`. One save closure per card, registered as a `registerSaveCallback(cardId, …)` with the deck manager.
3. **Component-internal layer.** `TugTextEngine` (in `lib/tug-text-engine.ts`) owns its own content + selection via `captureState` / `restoreState`, embedded as the opaque `bag.content` payload through `useCardPersistence`. `tug-markdown-view` manages its own scroll state locally.
4. **Selection-guard layer** (`components/tugways/selection-guard.ts`). Runtime behaviors: (a) drag-clipping and boundary enforcement; (b) CSS dim-highlight for inactive-selection visibility during app resign/activate; (c) tab-switch save/restore via `saveSelection(paneId)` / `restoreSelection(paneId, …)`. Keyed **by pane id**, not card id — critical.

#### Table A — concept × owner (per-concept ownership map) {#audit-table-a}

| Concept | Owner(s) | Save site | Restore site | Keyed by |
|---|---|---|---|---|
| Card-level scroll (`hostContentEl.scrollLeft/Top`) | Card-host | `card-host.tsx:329` `saveCurrentCardStateRef` → `bag.scroll` | `card-host.tsx:287` (layout effect) and `card-host.tsx:237` (`onContentReady`) | `cardId` |
| Card content payload (opaque, card-defined) | Card-host → component-internal | `useCardPersistence.onSave()` via `persistenceCallbacksRef.current.onSave()` (`card-host.tsx:343`) → `bag.content` | `registerPersistenceCallbacks` (`card-host.tsx:260`) → `onRestore(bag.content)` | `cardId` |
| DOM selection (contentEditable, e.g. `TugPromptInput`) | **TWO**: component-internal engine AND selection-guard | Engine: `TugTextEngine.captureState()` at `tug-text-engine.ts:617` → `{ text, atoms, selection: {start,end} }` → embedded in `bag.content` via `TugPromptEntry` onSave. Guard: `selectionGuard.saveSelection(hostStackId)` at `card-host.tsx:334` → `bag.selection` (walk paths from pane boundary). | Engine: `engine.restoreState` at `tug-text-engine.ts:632` rewrites `this.root.innerHTML` then `setSelectedRange(start,end)`. Guard: `selectionGuard.restoreSelection(hostStackId, bag.selection)` at `card-host.tsx:289` and `:245` → `setBaseAndExtent`. | Engine: card-via-content; guard: **pane id** |
| DOM selection (card chrome outside any contentEditable) | Selection-guard only | Same `selectionGuard.saveSelection(hostStackId)` | Same `selectionGuard.restoreSelection(hostStackId, …)` | Pane id |
| Form-control value | Card-host | `card-host.tsx:101` `captureDomInputs` walks `[data-tug-persist-value]` → `bag.domInputs[key].value` | `card-host.tsx:144` `applyDomInputSnapshot` → `el.value = snap.value` at mount + on MutationObserver fires | `persistKey` per element |
| Form-control selection (`selectionStart/End/Direction`) | Card-host via DomInputSnapshot | `card-host.tsx:113` `captureDomInputs` reads `el.selectionStart/End/Direction` regardless of focus | `card-host.tsx:153` `applyDomInputSnapshot` → `el.setSelectionRange(...)` | `persistKey` per element |
| Per-input scroll (`<input>` / `<textarea>` internal scroll) | Card-host via DomInputSnapshot | `card-host.tsx:116` `captureDomInputs` → `scrollTop/Left` | `card-host.tsx:149` `applyDomInputSnapshot` → `el.scrollTop/Left =` | `persistKey` per element |
| Focus (`document.activeElement`) at element level | **NOT PERSISTED ANYWHERE** | *(none)* | *(none — user must click back into inputs after reload)* | *n/a* |
| Deck-level active-card pointer | Deck-state | `putFocusedCardId(cardId)` (called by `focusCard` and `activateCard`) | `DeckManager` constructor reads `initialFocusedCardId` and calls `activateCard` on boot | Global |
| Per-pane active-card pointer (tab pointer) | Deck-state | Part of `TugPaneState.activeCardId`, serialized in layout | Restored via `deserialize` of layout JSON | Pane id |
| Active pane pointer | Deck-state | Part of `DeckState.activePaneId`, serialized in layout | Restored via `deserialize` | Global |
| Per-region scroll inside `tug-markdown-view` | Component-internal (`tug-markdown-view.tsx`) | Local refs + smart-scroll lib at `tug-markdown-view.tsx:441,478,530,632` | Same file, inline | Local |
| CSS inactive-selection highlight (dim state during resign/activate) | Selection-guard | `selectionGuard.handleApplicationDidResignActive` at `selection-guard.ts:530` — clones live range into `inactiveRanges[cardId]`, adds to CSS highlight, clears browser selection | `selectionGuard.handleApplicationDidBecomeActive` at `selection-guard.ts:560` — restores saved range to `window.getSelection()`, removes from inactive highlight | Card (via `activeCardId_highlight`) |

#### Table B — transition × trigger (lifecycle trigger map) {#audit-table-b}

| Transition | Trigger source | Subscribers (in order) | State touched |
|---|---|---|---|
| Reload (Cmd-R, in-process) | `window.beforeunload` | `DeckManager.handleBeforeUnload` (`deck-manager.ts:170`) → `saveCallbacks.forEach` → `flushDirtyCardStates({sync:true})` | Fires every card's `saveCurrentCardStateRef` — captures scroll + `selectionGuard.saveSelection(paneId)` + `onSave()` content + `captureDomInputs`. |
| Reload (action-dispatch "reload") | Swift `reload` Control frame → `action-dispatch.ts:211` → `DeckManager.prepareForReload` | Same callbacks as beforeunload, awaited | Same |
| Tab backgrounded | `document.visibilitychange(hidden)` | `DeckManager.handleVisibilityChange` (`deck-manager.ts:158`) → `saveCallbacks.forEach` + async `flushDirtyCardStates` | Same capture as reload |
| App will-resign active | Swift `applicationWillResignActive` Control frame | **`lifecycle-cascade.ts:127`** cascades to `cardWillDeactivate` / `cardDidDeactivate` on the active card only. **No save trigger fires on will-phase.** | Card-lifecycle events, no persistence |
| App did-resign active | Swift `applicationDidResignActive` | `action-dispatch.ts:497` → `deckManager.saveAndFlush()` (saves all cards); `selection-guard.ts:393` → `handleApplicationDidResignActive` (dim active card's selection into CSS highlight) | All card bags; CSS highlight state |
| App will-hide | Swift `applicationWillHide` | `lifecycle-cascade.ts:130` cascades to card-lifecycle events. **No save trigger.** | Card-lifecycle events only |
| App did-hide | Swift `applicationDidHide` | *(no subscribers in save path)* | *(nothing)* |
| App did-become-active | Swift `applicationDidBecomeActive` | `action-dispatch.ts:514` → `restoreActiveCardSelection` — calls `selectionGuard.restoreSelection(pane.id, bag.selection)` for the active-pane's active card; `selection-guard.ts:396` → `handleApplicationDidBecomeActive` (un-dim); `lifecycle-cascade.ts:133` cascades to `cardWillActivate` / `cardDidActivate` | Selection re-applied, dim removed, card-lifecycle |
| App did-unhide | Swift `applicationDidUnhide` | Same as did-become-active (`action-dispatch.ts:517`, `lifecycle-cascade.ts:136`) | Same |
| Swift quit (`applicationShouldTerminate`) | `window.tugdeck.saveState()` wire at `main.tsx:210` | `DeckManager.saveAndFlushSync()` — all card callbacks + sync flush | Same as reload |
| Card activation within a pane (tab switch) | `tug-pane.tsx:439` `performSelectCard` | `store.invokeSaveCallback(outgoingCardId)` → then `setActiveCardInPane` → card-lifecycle `cardWillDeactivate`/`cardDidDeactivate` on outgoing, `cardWillActivate`/`cardDidActivate` on incoming | Outgoing card's bag; card-lifecycle events |
| Deck-level pane activation (click on a pane) | `focusCard` / `activateCard` | Bumps pane z-order, flips composite first-responder bit, writes `putFocusedCardId`; **no save trigger for intra-pane content** | Deck state only |
| Cross-pane card move | `DeckManager._moveCardToPane` (`deck-manager.ts:1254`) | `this.invokeSaveCallback(cardId)` at `:1269` **before** the commit, then deck-state mutation | Source card's bag flushed; deck state |
| Card detach | `DeckManager._detachCard` (`deck-manager.ts:1161`) | `this.invokeSaveCallback(cardId)` at `:1175`; new pane is created | Source card's bag flushed; deck state |
| Card drag (in-flight) | `card-drag-coordinator.ts` | Ghost DOM clone only; no state capture during drag | Transient DOM |
| Pane drag / move / resize | `DeckManager.handlePaneMoved` | Updates `panes[].position/size`, `notify()`, `scheduleSave()` | Deck state only; no card-level capture |
| Card close | `DeckManager._removeCard` | **Does NOT invoke save callback.** Just removes from deck state. | Deck state; card bag becomes orphaned |
| Card construction (brand-new card) | `DeckManager._addCardToPane` / `addCard` | Fires `cardDidFinishConstruction`; card mounts with empty bag | None on save side |

#### Table C — write-site inventory (every read/write to the persisted concepts) {#audit-table-c}

| Concept write verb | Call sites in `tugdeck/src/` | Notes |
|---|---|---|
| `window.getSelection().setBaseAndExtent` | `text-selection-adapter.ts:309` (contentEditable-adapter caret placement); `selection-guard.ts:673` (`restoreSelection` path); `selection-guard.ts:876,882` (drag-clip forced-pin) | 4 sites. Only `selection-guard.ts:673` is persistence-restoration. |
| `el.setSelectionRange` | `card-host.tsx:153` (`applyDomInputSnapshot`); `use-text-input-responder.tsx:267,288` (contextmenu restore); `tug-text-engine.ts` (internal via setSelectedRange helpers) | 3 persistence sites plus many engine-internal sites (via `setSelectedRange`). |
| `el.focus()` | `tug-sheet.tsx:486` (sheet close restore); `use-text-input-responder.tsx:189,553` (contextmenu + responder); `tug-prompt-entry.tsx:681,846`; `tug-prompt-input.tsx:469,913`; `tide-card.tsx:1016,1020,1024,1047,1070` (tide-specific card-lifecycle focus reclaim); `gallery-prompt-input.tsx:293,301`; `tug-group-utils.tsx:188` (group roving focus); `tug-text-engine.ts:462,489,514,519,535,552,557` | ~20 sites. None are driven by a global-focus-persistence layer — all are either component-internal or card-specific. |
| `scrollLeft =` / `scrollTop =` | `card-host.tsx:149-150,237-238,285-286` (persistence restore); `tug-markdown-view.tsx:484,537,634,810` (smart-scroll); `lib/smart-scroll.ts:224,248`; `tug-text-engine.ts:1536` (scroll-clamp after innerHTML rewrite) | Persistence writes are all in card-host. Markdown and engine manage their own internal scroll. |
| `el.innerHTML =` (destroys any selection anchored in `el`) | `tug-text-engine.ts:595,652` (`clear` + `restoreState`); `tug-markdown-view.tsx:383,715` (sanitized markdown render); `tug-prompt-input.tsx:567` (popup clear); `card-drag-coordinator.ts:613` (ghost, not content); `lib/markdown.ts:152` (code wrap) | **`tug-text-engine.ts:652` is the critical site** — `restoreState` rewrites the contentEditable's innerHTML, producing new DOM nodes, then immediately sets selection via `setSelectedRange`. Any selection anchor that pointed at the pre-rewrite DOM (e.g., from `selectionGuard.restoreSelection`) becomes invalid. |
| `TugTextEngine.captureState / restoreState` | Captured: `tug-prompt-entry.tsx:592,650,723,779`; `tug-prompt-input.tsx:355,480`; `gallery-prompt-input.tsx:269`. Restored: `tug-prompt-entry.tsx:665,725,820`; `tug-prompt-input.tsx:359,481,651,817`. Definition: `tug-text-engine.ts:617,632`. | Engine owns its state; the content payload routed through `useCardPersistence` is `TugTextEditingState = { text, atoms, selection: {start,end} | null }`. |
| `selectionGuard.saveSelection` / `restoreSelection` | `card-host.tsx:334,289,245`; `action-dispatch.ts:510` | Four call sites. Keyed by `hostStackId` (pane id). |
| `captureDomInputs` / `applyDomInputSnapshot` | `card-host.tsx:101,144,347,315` | DOM-authority path, keyed by `persistKey` per element. |

#### Collisions and gaps surfaced by the audit {#audit-collisions}

These are the concrete findings that invalidate the previous plan and must shape the new one:

1. **Dual ownership of contentEditable selection (tide card, gallery-prompt-entry, gallery-prompt-input).** The engine's `restoreState` rewrites `this.root.innerHTML` and then calls `setSelectedRange(start, end)`. Simultaneously, `selectionGuard.restoreSelection(paneId, bag.selection)` walks the `anchorPath` / `focusPath` captured from the pane boundary and calls `setBaseAndExtent`. Both fire on restore; whichever wins depends on timing. After the engine's innerHTML rewrite, guard's paths may resolve to different text nodes or fall off the tree entirely.

2. **Pane-level vs card-level boundary mismatch.** `useSelectionBoundary(stackId, contentRef)` registers the **pane** content element as the selection boundary (`tug-pane.tsx:428`). In a multi-card (tab) pane, every tab shares one boundary. Save/restore keyed by pane id means that saving one tab's selection and restoring in another is indistinguishable at the boundary layer — the tab-switch path relies on `invokeSaveCallback(outgoingCardId)` firing *before* the swap to capture the right bag.

3. **Will-phase lifecycle events have no save subscribers.** `applicationWillResignActive` and `applicationWillHide` cascade to card-lifecycle events via `lifecycle-cascade.ts` but nothing in the save path (selection-guard, deck-manager saveAndFlush, action-dispatch) listens to the *will*-phase. Saves fire only on the *did*-phase (`applicationDidResignActive` → `deckManager.saveAndFlush()`). WebKit tears down selection visibility between the two.

4. **Focus is not persisted at element level.** Only the card-level "which card was active" pointer is persisted (`putFocusedCardId`). Which input inside that card had focus is nowhere saved or restored. On reload, the user always has to click back into the specific input they were editing.

5. **Form-control selection is captured regardless of focus (good), but unfocused selection is invisible on restore.** `captureDomInputs` walks every `[data-tug-persist-value]` element in the card's subtree and records each one's `selectionStart/End/Direction` — no focus requirement. On restore, `setSelectionRange` on an unfocused input stores the range internally but paints no highlight. Without a focus-restore counterpart, selections on unfocused inputs are "there but invisible" — first click moves the caret, losing the saved selection.

6. **`selectionGuard.saveSelection(paneId)` captures against pane boundary, written under `bag.selection` keyed by `cardId`.** `card-host.tsx:334` calls `selectionGuard.saveSelection(hostStackId)` and writes the returned `SavedSelection | null` to the current card's `bag.selection`. But the saved paths are rooted at the pane boundary, not the card root. For single-card panes this is fine. For multi-card panes the paths are valid only as long as the same active card is swapped in during restore.

7. **Three paths overlap for tide-card reload.** On reload of a card that uses `TugPromptEntry`: (a) `bag.content` carries engine state → engine.restoreState rewrites innerHTML + sets engine-coord selection; (b) `bag.selection` carries pane-boundary DOM paths → `selectionGuard.restoreSelection` runs; (c) `bag.domInputs` may carry non-prompt form-control state for inputs elsewhere in the card. All three fire on restore, from different parts of `CardHost`. (a) and (b) race on the same DOM; (c) is independent. The fragility of (b) after (a) is Case A's failure mode.

8. **Visibility-dimming cycle on app resign/activate is a DIFFERENT path from persistence save/restore.** `selection-guard`'s `handleApplicationDidResignActive` / `handleApplicationDidBecomeActive` manage an in-memory CSS highlight for dimming — not persistence. They clear `window.getSelection()` on resign, then restore it on become-active. This is transient visibility plumbing, orthogonal to `saveSelection`/`restoreSelection`.

9. **Card close (`_removeCard`) does not flush.** When a card is closed, its bag is left in the deck-state cache / tugbank without a final save. For short-lived cards this is fine, but if the card was mid-edit and the user closes it intending to re-open, the last edits may not be captured. (May or may not matter depending on UX intent — flagged for decision, not automatically a bug.)

10. **The deck-manager's `saveCallbacks.forEach` iterates the registry**, so reload/background/resign all save every card that has a registered callback — not just the active one. `action-dispatch.ts:514`'s `restoreActiveCardSelection` on become-active, by contrast, only restores the **active** pane's **active** card. Asymmetric scope: save-all, restore-one. (Rest of the cards' selection is restored when the user next tabs into them, via the card-activation path — if that path even fires a re-apply, which it currently does NOT.)

#### Audit checkpoint {#audit-checkpoint}

- Card types whose contents exercise persisted state: `tide` (TugPromptEntry + TugPromptInput inside), `git`, `hello` (stateless), gallery-* cards (primarily TugInput/TugTextarea/TugPromptInput/TugPromptEntry wrappers).
- Unique `componentId`s: 47 registered (mostly gallery demos).
- `useCardPersistence` consumers (outside internal infrastructure): `tug-input.tsx`, `tug-textarea.tsx`, `tug-prompt-entry.tsx`, `tug-prompt-input.tsx`, `gallery-textarea.tsx`.
- `data-tug-persist-value` consumers: `tug-input.tsx:191`, `tug-textarea.tsx` (analogous), gallery demos. DOM-authority walk is `card-host.tsx:101-120`.
- Will-phase event emission from Swift: confirmed present (`tugapp/Sources/AppDelegate.swift:199-211` per the previous plan's Q03 verification). No JS save subscriber currently uses them.

---

### Design decisions {#design-decisions}

*To be written. Every decision below must cite row(s) from Tables A/B/C above.*

---

### Open Questions {#open-questions}

*To be populated during the design phase.*

---

### Risks and mitigations {#risks}

*To be populated during the design phase.*

---

### Execution Steps {#execution-steps}

#### Step 1: Code audit {#step-1}

**Depends on:** none

**Commit:** `docs(selection-plan): ground ownership and trigger maps against code`

**References:** [#audit](#audit), [#audit-table-a](#audit-table-a), [#audit-table-b](#audit-table-b), [#audit-table-c](#audit-table-c), [#audit-collisions](#audit-collisions)

**Artifacts:**
- [Table A](#audit-table-a): per-concept ownership map. Fully populated.
- [Table B](#audit-table-b): per-transition trigger map. Fully populated.
- [Table C](#audit-table-c): per-verb write-site inventory. Fully populated.
- [Collisions and gaps](#audit-collisions) section listing the ten concrete issues the audit found.

**Tasks:**
- [x] Grep every `setBaseAndExtent`, `setSelectionRange`, `.focus()`, `scrollLeft =`, `scrollTop =`, `innerHTML =` write site in `tugdeck/src/` and record file:line in Table C.
- [x] Trace content save/restore through `useCardPersistence` and component-internal persistence for every `registerCard` consumer (tide, git, hello, 44 gallery demos).
- [x] For each lifecycle observer (`app-lifecycle`, `card-lifecycle`, `DeckManager` save path, `beforeunload`, `visibilitychange`, Swift `saveState` RPC, `invokeSaveCallback` callers), record file:line and the state touched in Table B.
- [x] Enumerate collisions / gaps where concepts are dually-owned or un-owned in [#audit-collisions](#audit-collisions).

**Tests:**
- [x] Audit tables reviewed; every active write site enumerated in Table C appears in at least one row of Tables A or B.

**Checkpoint:**
- [x] `tugutil validate /u/src/tugtool/roadmap/tugplan-selection.md` passes.

#### Step 2: Design decisions grounded on audit {#step-2}

**Depends on:** #step-1

**Commit:** `docs(selection-plan): design decisions grounded on audit rows`

**References:** Every decision cites at least one row of Table A/B/C.

**Artifacts:**
- [Design decisions](#design-decisions) section populated with decisions that explicitly cite the collision or gap they address.
- [Open Questions](#open-questions) populated with the questions the audit surfaced that do not yet have a design answer.

**Tasks:**
- [ ] For each collision/gap in [#audit-collisions](#audit-collisions), write one design decision. If no decision is possible, write an Open Question.
- [ ] Call out explicitly which of the current layers (deck-state / card-host / component-internal / selection-guard) owns which concept in the redesign.
- [ ] Decide: does the redesign introduce a new subsystem, or rebalance the existing four? Justify from Table A.

**Tests:**
- [ ] Every decision in [#design-decisions](#design-decisions) contains a `[file.ts:line]` or `[#audit-table-X]` citation. *(design-phase review, no code tests yet)*

**Checkpoint:**
- [ ] `tugutil validate` passes.
- [ ] Every decision text contains a `[file.ts:line]` or `[#audit-table-X]` citation.

> Execution steps beyond #step-2 will be written once design decisions are locked. Nothing goes into `tugdeck/src/` until then.

---

### Deliverables and Checkpoints {#deliverables}

*To be populated once the execution plan exists beyond the audit and design steps.*
