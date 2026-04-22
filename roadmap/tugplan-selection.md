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

Every decision below cites (a) the audit row(s) it rests on, (b) the tuglaws it upholds, and (c) the collision(s) from [#audit-collisions](#audit-collisions) it resolves. Decisions labeled **DECIDED** are locked; those labeled **PROPOSED** are the author's recommendation pending user sign-off.

#### [D01] Persistence is a **data representation**, not a runtime service (DECIDED) {#d01-data-not-service}

**Decision:** There is no "selection manager" object with `capture()` / `apply()` methods that owns cross-component apply logic. Persistence is a *schema* — a versioned bag shape stored per card — plus per-component adapters that serialize into and out of the schema. Each component that owns state (tide-card engine, `TugInput`, `TugTextarea`, `tug-markdown-view`) implements its own apply logic against its own DOM, because each component already knows how to apply its own state correctly.

**Cites:** [Table A](#audit-table-a) rows on contentEditable selection (dual-owned), form-control selection (card-host DOM-authority), engine `captureState/restoreState`; [Collision #1](#audit-collisions) (dual ownership); [Collision #7](#audit-collisions) (three independent restore paths).

**Upholds:** [L10] one responsibility per layer — each component owns its own apply logic. [L11] responders own the state actions mutate — components that own selection are responders for `cut`/`copy`/`selectAll`/etc.; those same components own restore. [L23] diff-and-mutate minimally — a centralized keeper re-applying selections across components is a "save and restore" pattern; per-component ownership lets each component diff-and-patch its own DOM.

**Rationale:** The previous plan's `SelectionKeeper` tried to own both the data and the apply logic. That put one module in the business of calling `setBaseAndExtent` into DOM trees owned by other modules, which silently conflicted with those modules' own restore logic (tide's engine). Separating **what to remember** (shared schema) from **how to reapply** (component-internal) eliminates the conflict by design.

**Implications:** The bag shape is exported from `layout-tree.ts` as a type only. Components import the type, implement `adapter.capture(boundary): PartOfBag` and `adapter.apply(boundary, PartOfBag): void` as local helpers, and wire those into their own existing mount/unmount/lifecycle plumbing. No central keeper module, no central apply method, no cross-component DOM writes.

---

#### [D02] Per-card bag schema carries five axes (PROPOSED) {#d02-bag-schema}

**Decision:** `CardStateBag` carries these axes, each independent:

| Axis | Type sketch | Owner at apply time |
|---|---|---|
| `scroll` | `{ x: number; y: number }` | Card-host — `hostContentEl.scrollLeft/Top` |
| `content` | `unknown` — opaque per-card payload | Card's content factory, via `useCardPersistence.onRestore` |
| `formControls` | `Record<persistKey, { value, selectionStart?, selectionEnd?, selectionDirection?, scrollTop?, scrollLeft? }>` | Card-host walk (`applyDomInputSnapshot` equivalent) — existing `domInputs` path, renamed |
| `domSelection` | `{ anchorPath: number[], anchorOffset, focusPath: number[], focusOffset } \| null` | Component that owns the contentEditable it anchors into; card-host passes it through to the owner via a new callback |
| `focus` | `{ kind: "none" } \| { kind: "form-control", persistKey: string } \| { kind: "dom", focusKey: string } \| { kind: "component-owned" }` | Card-host for keyed form-controls / focus-key elements; owning component for `component-owned` |

Every axis is optional on the bag — `scroll` without `formControls` is valid, etc.

**Cites:** [Table A](#audit-table-a) rows on each concept; [Collision #4](#audit-collisions) (focus not persisted at element level); [Collision #10](#audit-collisions) (asymmetric save/restore scope — a uniform schema covers all cards equally).

**Upholds:** [L23] user-visible state (scroll, selection, focus, content) is named explicitly in the schema. [L24] the schema is data-zone (semantic, read by non-rendering code for persistence); appearance-zone paint is separate (see [D04]).

**Rationale:** Paths rooted at the **card** boundary, not pane, so that cross-pane moves don't break path validity (the card's internal DOM travels with the card via `CardPortal`). `focus.kind === "component-owned"` is the marker for cards whose content-factory manages its own focus + selection together (tide-card → engine); restoring focus for those cards is the content factory's job, not card-host's.

**Implications:** Bag version bumps from v1 (flat `selection?: SavedSelection | null`) to v2. Migration on read is one function in `settings-api.ts` that wraps v1 selection into `domSelection` under the new shape and leaves everything else blank. v1 bags without selection migrate trivially.

**Open question — see [Q01](#q01-v1-migration-scope).**

---

#### [D03] Card-level selection boundary registration (DECIDED) {#d03-card-level-boundary}

**Decision:** `useSelectionBoundary` is called with the card's `cardId` and its `[data-card-host][data-card-id]` element as the boundary, not with the pane id and the pane content element. `selectionGuard.boundaries` becomes keyed by card id. Where multiple cards exist inside one pane (tabs), each card registers its own boundary; only the active card's boundary matters at any one time for clipping, but the registry holds them all.

**Cites:** [Table A](#audit-table-a) (pane-level `bag.selection` keyed by card id — an existing mismatch); [Collision #2](#audit-collisions) pane-level vs card-level mismatch; [Collision #6](#audit-collisions) `saveSelection(paneId)` writing to `bag.selection` keyed by cardId.

**Upholds:** [L12] "Every card registers its content area as a selection boundary" (verbatim). `selection-model.md` § SelectionGuard ("operates at the card level only"). The tuglaw and the doc already prescribe this; current code drifted. This is restoration, not new design.

**Rationale:** The pane-level registration in `tug-pane.tsx:428` is a long-standing drift from the documented design. User's call on boundary layering was to fix that.

**Implications:** `useSelectionBoundary` callsite moves from `tug-pane.tsx` (keyed on pane) to `CardHost` (keyed on card). `useSelectionBoundary`'s `cardId` parameter was already named correctly; only the caller needs to change. Drag-clipping (`handlePointerMove`, `handleSelectionChange`) continues to operate at pane level for geometry but clamps to the active card's boundary — selectionGuard can look up the active card from the deck-state pointer.

---

#### [D04] Two-paint-layer model: `::selection` for one, CSS Custom Highlights for the rest (DECIDED) {#d04-two-paint-layers}

**Decision:** Paint is split in two:

- **Native `::selection`** paints the active selection on exactly one card — the focused card of the focused pane — operating on `window.getSelection()`. This is the browser's single live selection. The user can cut/copy from it, extend it, interact with it. It's unchanged from today.
- **CSS Custom Highlights** paint every *other* remembered selection as a dim, inactive highlight. Every card that has a known selection and isn't the focused card contributes its `Range` to the custom-highlight set. All such ranges paint simultaneously via one or more `::highlight(...)` CSS rules. The user cannot interact with these — they are appearance-only. They move in and out of the native slot as the user navigates cards.

The existing `inactive-selection` custom highlight in `selection-guard.ts:301` is the seed. Generalizing it from "one deactivated card during app resign" to "every non-focused card with a known selection, always" is the work.

**Cites:** [Table A](#audit-table-a) "CSS inactive-selection highlight"; [Table B](#audit-table-b) app resign/activate cycle; [Collision #8](#audit-collisions) (dim-highlight cycle is already a separate subsystem, just under-used). `selection-model.md` § Card Switch describes the inter-tab version of this mechanism as already-existing architecture.

**Upholds:** [L06] dim-highlight paint is appearance state — goes through CSS and DOM, never React. The `Highlight` object is mutated imperatively; React is not involved. [L22] the paint owner (selection-guard) subscribes directly to the persistence store, writes to the `Highlight` set; no React round-trip. [L24] paint = appearance zone; the Range data itself = data zone.

**Rationale:** The "one browser selection" constraint I previously misstated is only true for `::selection`. The CSS Custom Highlights API holds arbitrary simultaneous ranges. Prior commits already used this for tab-switch visibility; we generalize.

**Implications:**
- One tier may be sufficient: every non-focused card's selection paints via `inactive-selection`. If we later want to distinguish "inactive-in-active-pane" from "inactive-other-pane" visually, add a second named highlight. Start with one tier and add tiers only if UX demands.
- Ranges held in the custom highlight become stale if the underlying DOM mutates (innerHTML rewrite, node split, element removal). The owning component is responsible for notifying `selectionGuard` on DOM mutations that invalidate its range. See [D06] for the owner-publishes model and [R01](#r01-stale-ranges) for the risk.
- Form-control selection **does not paint via custom highlights**. `<input>` / `<textarea>` selections are internal to the form-control shadow tree and aren't addressable by outer-DOM Ranges. Form-control selections remain invisible when unfocused; this is a browser-platform limitation we accept. See [D05] for how we handle the visibility transition.

**Open question — see [Q02](#q02-paint-tiers).**

---

#### [D05] Component-published selection ranges feed the paint owner (PROPOSED) {#d05-component-publish}

**Decision:** Components that own DOM selection (tide's `TugTextEngine`, `tug-markdown-view`, and any future contentEditable owner) publish their current Range to `selectionGuard` via a narrow API:

```
selectionGuard.updateCardDomSelection(cardId, range | null)
```

Components call this when their selection changes *and* when their DOM mutates in a way that invalidates a held Range (e.g., engine's `restoreState` rebuilds innerHTML). SelectionGuard keeps a `Map<cardId, Range>` of current published ranges, maintains the custom-highlight set by subtracting whichever cardId currently holds focus, and paints accordingly.

For form-controls (TugInput, TugTextarea), there is no publish step — their `selectionStart/End` live in the DOM and are captured by the card-host walk on save. They don't participate in the inactive-highlight paint (per [D04]).

**Cites:** [Table C](#audit-table-c) engine `setSelectedRange` call sites (many); [Collision #1](#audit-collisions) dual ownership of tide's DOM selection.

**Upholds:** [L10] engine owns selection logic, selectionGuard owns paint; neither reaches into the other's DOM. [L22] selectionGuard subscribes to component-published state and writes to the DOM highlight directly.

**Rationale:** The alternative is to have selectionGuard poll `window.getSelection()` on every focus change, but that only reads the active selection — we need to remember *every* card's last-known selection, including ones whose cards aren't currently focused. Only the component itself knows its selection after a DOM mutation it just performed. A component-publishes model makes the ownership boundary clean.

**Implications:**
- Engine's public API gains `onSelectionChanged(cb: (range: Range | null) => void)` and tide-card's wiring subscribes to it, relaying to `selectionGuard.updateCardDomSelection(cardId, range)`.
- `tug-markdown-view` already tracks its own selection for copy operations; wire it similarly.
- `TugPromptInput` already wraps the engine; becomes the publisher.
- This is a *net new* contract, so it applies only to contentEditable-backed components. Form-controls don't need it.

**Open question — see [Q03](#q03-publish-frequency).**

---

#### [D06] Save triggers: will-phase lifecycle, close, beforeunload, saveState RPC (PROPOSED) {#d06-save-triggers}

**Decision:** The save callback registered per card fires on every transition that may dissolve or obscure state:

| Trigger | Wiring |
|---|---|
| `applicationWillResignActive` | new subscriber in `action-dispatch.ts` → `deckManager.saveAndFlush()`. Replaces the did-phase save for this event. |
| `applicationWillHide` | same |
| `applicationDidResignActive` / `applicationDidHide` | backstop only (if will-phase was missed) |
| `applicationWillUnhide` / `applicationWillBecomeActive` | no save |
| `window.beforeunload` | existing `DeckManager.handleBeforeUnload` |
| `document.visibilitychange(hidden)` | existing `DeckManager.handleVisibilityChange` |
| Swift `saveState` RPC | existing `window.tugdeck.saveState` → `DeckManager.saveAndFlushSync` |
| Card close | **new** — `DeckManager._removeCard` invokes the save callback before removing. Closes [Collision #9](#audit-collisions). |
| Tab switch within pane | existing `tug-pane.tsx:439` `performSelectCard` → `invokeSaveCallback(outgoingCardId)` |
| Cross-pane card move | existing `DeckManager._moveCardToPane:1269` → `invokeSaveCallback(cardId)` |
| Card detach | existing `DeckManager._detachCard:1175` |

**Cites:** [Table B](#audit-table-b) lifecycle trigger map; [Collision #3](#audit-collisions) will-phase has no save subscribers; [Collision #9](#audit-collisions) card close doesn't flush.

**Upholds:** [L23] user state must be preserved across bookkeeping operations — saving at will-phase, before the browser tears down visibility; saving at close, before the bag is orphaned.

**Rationale:** Will-phase capture is what prior Case γ diagnostics identified as necessary. Close-flush is what tuglaw L23 demands. Both are additive — no existing trigger is removed.

**Implications:**
- No change to the save callback *shape* — just more subscribers. Each card's `saveCurrentCardStateRef` runs as before; what changes is that the callback is invoked at more moments.
- Will-phase save + did-phase save can both fire in a given transition. That's fine; saves are idempotent with respect to the bag (we overwrite). The did-phase save becomes a cheap redundancy rather than the primary path.

---

#### [D07] Restore: per-component handoff at mount, paint on store change (PROPOSED) {#d07-restore-handoff}

**Decision:** On card mount, `CardHost` delivers the bag axes to their owners:

1. `bag.scroll` — card-host writes `hostContentEl.scrollLeft/Top` at layout effect time.
2. `bag.formControls` — card-host walks `[data-tug-persist-value]` and applies via `applyDomInputSnapshot` (existing logic, slightly renamed).
3. `bag.content` — card-host calls `onRestore(bag.content)` via `useCardPersistence`; content factory (e.g. tide-card) takes it from there.
4. `bag.domSelection` — card-host passes to the component that *owns* the boundary via a new persistence callback `onRestoreDomSelection(bag.domSelection)`. For tide-card, this callback no-ops: the engine already restored selection via `bag.content`. For generic contentEditable cards (if any), the callback is the restore path.
5. `bag.focus` — card-host applies after the content factory has had its re-render cycle (post `onContentReady`), gated by [Q02]'s Option B active-card check and by the component having signaled "ready to receive focus" via an explicit callback.

On app-active / card-active transitions, *no restore runs* for cards whose DOM is still mounted (per [D08]). The dim-highlight paint is updated in response to the store's active-card pointer change; ranges move between custom highlights and `window.getSelection()` without any save/restore round trip.

**Cites:** [Table B](#audit-table-b) reload / mount triggers; [Collision #1](#audit-collisions) (handoff replaces dual ownership); [Collision #10](#audit-collisions) (asymmetric save/restore — asymmetric is now correct: save covers all cards, restore on reload-only, paint handles in-app transitions).

**Upholds:** [L10] each axis goes to its owner. [L23] in-app transitions don't destroy state, so no "restore" fires — just a paint update. [L22] paint updates observe the store directly.

**Rationale:** The previous plan's failure mode was restoring cross-component on every transition. With [D08] (cards stay mounted) plus [D04] (two-paint layers), most transitions need no restore at all — just a visibility toggle.

**Implications:**
- New callback slot in `CardPersistenceCallbacks`: `onRestoreDomSelection?(snapshot: DomSelectionSnapshot | null): void`. Optional — cards whose engine already owns selection leave it undefined.
- Restore runs only on cold mount (reload / relaunch / first view after construction).
- Paint updates run on deck-state `activePaneId` / `activeCardId` change — subscribed via the existing `observeCardDidActivate` / store observers.

---

#### [D08] Cards stay mounted across transitions; save/restore is the cold-boot boundary only (DECIDED) {#d08-no-unmount-transitions}

**Decision:** `CardHost`'s existing `display: isActive ? "contents" : "none"` pattern already keeps every card mounted throughout its deck lifetime. We explicitly adopt this as the contract: no card unmounts on tab switch, pane activation, resign/activate, or hide/unhide. DOM nodes, form-control state, React component state, and observer subscriptions are all preserved across every in-app transition.

The only transitions that destroy DOM are:
- Reload / relaunch (process or page death)
- Explicit card close
- Card-host fundamental unmount (rare — component tree collapse)

For those, bag save-and-restore is the only path. For everything else, the DOM *is* the memory; we update paint and don't touch state.

**Cites:** `card-host.tsx:478` `style={{ display: isActive ? "contents" : "none" }}`; [Table B](#audit-table-b) rows for app-resign and tab-switch showing no DOM destruction.

**Upholds:** [L23] directly — this *is* the L23 preservation path. We don't save-and-restore; we don't disturb.

**Rationale:** The strongest form of L23. The more we rely on DOM as memory, the less save/restore code we need, the fewer race conditions, the fewer edge cases. Save/restore becomes the cold-boot boundary, which is where you can't avoid it — and only there.

**Implications:**
- Tab switch within pane: no save of outgoing card's bag needed (DOM stays). `tug-pane.tsx:439`'s `invokeSaveCallback(outgoingCardId)` becomes a cheap redundancy, safe to keep but not required.
- Cross-pane move: save before move remains necessary because the card's persistence bag is the authoritative store for the new pane's first render if the move requires any React state bookkeeping. DOM identity preservation via `CardPortal` is a separate mechanism from the bag; keep the pre-move save as belt-and-suspenders.
- App resign: save is still needed, because the browser may actually exit or reload. Will-phase save catches it.

---

#### [D09] `selectionGuard` becomes the paint authority + boundary registrar; its save/restore API retires (PROPOSED) {#d09-guard-role}

**Decision:** `selectionGuard`'s responsibilities, after this plan:

**Retained:**
- Card-level boundary registration (`registerBoundary(cardId, element)` keyed by card id per [D03]).
- Drag-clipping and keyboard-extension clipping at card boundaries (unchanged).
- Custom-highlight paint of inactive selections via [D04]'s generalization.
- `updateCardDomSelection(cardId, range | null)` publish endpoint per [D05].
- App-resign / app-activate CSS dim cycle — now a special case of the general [D04] paint (just a bigger transition).

**Retired:**
- `saveSelection(cardId)` and `restoreSelection(cardId, saved)` public methods. With per-component apply ([D01]) and no-restore-on-in-app-transition ([D08]), the guard is no longer the save/restore point for any card. These methods either become `@internal` or move into the one remaining consumer (cold-mount restore for generic contentEditable if any; none today).

**Cites:** [Table C](#audit-table-c) selectionGuard call-site inventory; [Collision #1](#audit-collisions), [Collision #7](#audit-collisions).

**Upholds:** [L10] each concern one owner — guard owns paint and boundary, not persistence. [L23] no more destruction-with-recovery path hidden behind `saveSelection`/`restoreSelection`.

**Implications:**
- Every caller of `selectionGuard.saveSelection` / `restoreSelection` (today: `card-host.tsx:334,289,245`, `action-dispatch.ts:510`) is removed. The bag's `domSelection` axis is populated directly by the owning component's adapter and consumed by the owning component's restore callback.
- The guard's `inactiveRanges: Map<cardId, Range>` generalizes from "one per lifecycle transition" to "one per non-focused card, always" — this becomes the paint backing store.

---

#### [D10] Focus persistence: card-level and element-level (DECIDED) {#d10-focus-persistence}

**Decision:** The deck layer already persists the active card (`initialFocusedCardId`). We add element-level focus via `bag.focus`:

- On save, `bag.focus` records which element inside the card had focus:
  - Form-control or focus-keyed element → `{ kind: "form-control" | "dom", persistKey_or_focusKey }`.
  - Engine-managed contentEditable with focus → `{ kind: "component-owned" }` (the owning component's `bag.content` carries the detailed state).
  - No interesting focus → `{ kind: "none" }`.
- On cold-boot restore, card-host applies focus if and only if this card is the active card of the active pane ([Q02] Option B from the previous plan, which stands — the gate is UX-driven, not implementation-driven). Other cards retain `bag.focus` for later use but do not steal focus speculatively.
- In-app transitions (tab switch, pane activate) do *not* restore focus from the bag — focus is already live in the DOM (per [D08]) because the card never unmounted. The only movement is the user-driven click that triggered the transition; the browser's native focus-change semantics apply.

**Cites:** [Collision #4](#audit-collisions) focus not persisted at element level; [Collision #5](#audit-collisions) form-control selection invisible without focus.

**Upholds:** [L23] element-level focus is user data — the user put the cursor there. We must preserve it.

**Rationale:** User's direct instruction: full element-level focus persistence is non-negotiable. The element-vs-card split keeps the schema simple while covering every real case.

---

#### [D11] DOM-preserving content restore for engine-managed cards (PROPOSED) {#d11-engine-diff-not-rewrite}

**Decision:** `TugTextEngine.restoreState` stops doing `this.root.innerHTML = parts.join("")` unconditionally. Instead:

1. If the engine's current DOM already reflects the target state (content matches), no-op. This is the steady-state skip.
2. If the engine's current DOM is empty and is receiving its first content, write innerHTML. (This is mount.)
3. If the engine's current DOM has content that differs from the target, diff-and-patch — mutate only the nodes that changed, leaving unchanged text nodes and their children in place. A minimal implementation can use DOM reconciliation ideas similar to React's, scoped to the flat parts list (text runs + `<br>` + `<img>` atoms).

The immediate L23 win: when an engine restoreState runs at mount with content identical to what's already there (e.g., HMR replay, spurious re-restore), the existing user selection anchors survive because we don't destroy the text nodes. The longer-term win: innerHTML rewrite disappears from the normal edit path.

**Cites:** [Table C](#audit-table-c) innerHTML write sites; [Collision #1](#audit-collisions) engine's rewrite displaces selection anchors.

**Upholds:** [L23] directly — this is the textbook "diff and mutate minimally" pattern the law describes. "Save and restore" (rewrite + setSelectedRange) is replaced with diff-and-patch.

**Rationale:** This is the riskiest/largest single change in the plan because it touches a 30KB engine module's hot path. But it's the only way to make tide-card selection survive non-trivial restore paths without conflicts. It also improves edit-path performance by removing unnecessary DOM churn.

**Implications:**
- New engine unit tests for idempotent restoreState (same content → no DOM mutation). Existing captureState/restoreState round-trip tests stay.
- Fallback path (full innerHTML rewrite) stays available for migration scenarios where the diff is too complex or the initial shape differs fundamentally.

**Open question — see [Q04](#q04-engine-diff-scope).**

---

#### [D12] Tugbank bag version bump + read-side migration (PROPOSED) {#d12-bag-migration}

**Decision:** `CardStateBag` gains `version: 2` on new-shape writes; v1 bags (no version, `selection?: SavedSelection | null`) are migrated on read in `settings-api.ts.readCardStates`:

- v1 `bag.selection` shape → wrapped into `bag.domSelection` at v2 (paths were captured pane-rooted in v1; v2 captures card-rooted — but as a one-time migration, v1 paths are carried through as-is and either work or don't on first restore; subsequent saves write v2 correctly).
- v1 `bag.domInputs` → renamed to `bag.formControls` (shape identical).
- v1 content stays in `bag.content` unchanged.
- v1 with no bag fields migrates to empty v2 trivially.

Writes always produce v2.

**Cites:** [Table A](#audit-table-a) current v1 shape.

**Upholds:** [L23] by preserving the best approximation of user state across the migration. Pre-migration bags keep working.

**Implications:**
- One migration function (~40 lines) in `settings-api.ts`, called from `readCardStates`.
- Dev-mode log counts migrations per release cycle so we can flip off the migration once all in-flight bags are v2.

---

### Open Questions {#open-questions}

Every question has a concrete decision the user must make before the execution plan is written. Questions referenced from design decisions as `[Qnn]`.

#### [Q01] Migration scope for v1 `bag.selection` (OPEN) {#q01-v1-migration-scope}

**Question.** v1 stored `bag.selection` as a `SavedSelection` with paths rooted at the **pane** boundary (pre-[D03]). v2 roots paths at the **card** boundary. Do we:
- (a) Migrate v1 paths verbatim into v2 `domSelection` and accept that they may fail to resolve on first restore, then get rewritten correctly on the next save.
- (b) Attempt to re-root v1 paths at card boundaries during migration (requires walking paths and finding the card ancestor).
- (c) Drop v1 `bag.selection` entirely and accept one-time loss for pre-migration bags.

**Recommendation:** (a). The first restore may be imperfect for a small fraction of bags; the next save fixes it. (b) is brittle; (c) is user-hostile for no gain.

**Resolution gate:** Before the execution plan is written.

#### [Q02] Paint tier count for inactive highlights (OPEN) {#q02-paint-tiers}

**Question.** Do we paint all non-focused cards' remembered selections at one dim level, or do we distinguish "inactive-in-active-pane" (card is in the active pane but not the active card) from "inactive-in-inactive-pane" (card is in a non-active pane)?

**Recommendation:** Start with one tier (the existing `inactive-selection` highlight), evaluate UX, add a second tier only if users complain the current behavior is ambiguous.

**Resolution gate:** Before the execution plan is written; revisitable post-ship.

#### [Q03] Component publish frequency for DOM-selection ranges (OPEN) {#q03-publish-frequency}

**Question.** How often should a component publish its current Range to `selectionGuard.updateCardDomSelection`?
- (a) On every `selectionchange` (fine-grained, most expensive, always-correct).
- (b) On focus-leave + DOM mutation (coarse, cheaper, only when the range would become "remembered").
- (c) Lazy — publish only when asked (selectionGuard queries on deactivate).

**Recommendation:** (b) — publish on focus-out and on DOM mutation that invalidates the existing Range. The `selectionchange` event fires on every caret move; we don't need to re-publish just because the user arrow-keyed.

**Resolution gate:** Before the execution plan is written.

#### [Q04] Engine diff-restore scope (OPEN) {#q04-engine-diff-scope}

**Question.** How thorough should [D11]'s diff-restore in the engine be?
- (a) "Content-identical fast path" only — skip the innerHTML rewrite if the captured state matches what the engine already has in its DOM; otherwise full rewrite.
- (b) True flat-parts diff — compare the new `parts.join("")` against the current DOM and mutate only the differences.
- (c) Full DOM reconciliation over the flat parts list (React-like keyed diff).

**Recommendation:** Ship (a) in this plan; flag (b) and (c) as follow-ons. (a) covers the common "spurious restore" case (content didn't change, don't destroy selection) with minimal risk. (b) covers the edit-time scenario but is a larger engine change. (c) is overkill for a flat part list.

**Resolution gate:** Before the execution plan is written.

#### [Q05] Close-flush timing: before or after destroy lifecycle event (OPEN) {#q05-close-flush-timing}

**Question.** `DeckManager._removeCard` fires `cardWillBeginDestruction` as part of its commit. Does save-on-close fire before or after the will-begin-destruction notification?

**Recommendation:** Before. If the save callback throws or does async work, we want that complete before subscribers react to destruction (some subscribers may release resources the save callback needs — e.g., an editor engine disposing of its DOM).

**Resolution gate:** Before the execution plan is written.

#### [Q06] Engine's selection publish API placement (OPEN) {#q06-engine-publish-api}

**Question.** Where does the engine expose its "publish current Range" hook?
- (a) On `TugTextEngine` directly — `engine.onSelectionChanged(cb)`.
- (b) On `TugPromptInput` (the React wrapper) — component-level integration surface.
- (c) On the `CardPersistenceCallbacks` — card-host pattern extension.

**Recommendation:** (a) for the primary hook (engine is the source), (c) for the wiring glue (engine → `selectionGuard.updateCardDomSelection`). `TugPromptInput` stays thin.

**Resolution gate:** Before the execution plan is written.

---

### Risks and mitigations {#risks}

#### [R01] Stale `Range` objects held in custom highlights (MED) {#r01-stale-ranges}

- **Risk:** A `Range` held in `selectionGuard.inactiveRanges` becomes invalid when the DOM it anchors into is mutated (engine innerHTML rewrite, React re-render that replaces nodes). Paint becomes nonsense or throws on access.
- **Mitigation:** Components that mutate their DOM must call `selectionGuard.updateCardDomSelection(cardId, newRange | null)` after every such mutation. [D05] / [Q03] formalize this. [D11]'s diff-instead-of-rewrite engine path reduces how often this is needed.
- **Residual:** Components that mutate DOM without publishing will silently produce stale highlights. Detect via a sanity check on every access: if the Range's containers are no longer in the document, drop it from the highlight and clear from `inactiveRanges`. A dev-mode warning logs the offending cardId.

#### [R02] IME composition in-flight during will-phase capture (MED) {#r02-ime-composition}

- **Risk:** On `applicationWillResignActive`, the user may be mid-IME-composition (CJK input). `selectionStart/End` during composition reads buffer offsets that may not map back after activation.
- **Mitigation:** Save handlers that read `selectionStart/End` check `document.activeElement` for an active composition via `isComposing` on tracked CompositionEvent state. If composition is active, defer the save until `compositionend`. The will-phase event itself still fires and dim paint updates; only the precise offsets wait.
- **Residual:** Process-exit before `compositionend` loses in-flight composition. Browser-platform limit; can't be fully eliminated.

#### [R03] WebKit programmatic-selection degradation on repeated apply (MED) {#r03-programmatic-selection}

- **Risk:** If a component repeatedly calls `setSelectionRange` / `setBaseAndExtent` on the same element across multiple transitions, WebKit may silently degrade the selection (the "Case γ" pattern from the previous plan).
- **Mitigation:** [D08] + [D07] together eliminate most programmatic re-applies in steady state. Components that restore selection (engine at mount, card-host at reload mount) apply once per mount. Skip-if-already-correct checks inside [D11]'s diff path avoid re-apply when state already matches.
- **Residual:** Reload still programmaticizes on restore. That's unavoidable — the DOM is new.

#### [R04] CSS Custom Highlights API browser support (LOW) {#r04-highlights-support}

- **Risk:** CSS Custom Highlights API shipped in WebKit 17.4 (March 2024) and Firefox 140 (July 2025). Older environments paint nothing.
- **Mitigation:** Target is Tug.app (WKWebView on macOS) + modern browsers. Tug.app's WKWebView version is tied to the host OS; WebKit 17.4 requires macOS 14.4+. Confirm minimum supported macOS before committing.
- **Residual:** A user on macOS 14.3 or earlier sees no dim highlights, but the underlying selection data is still saved and restored correctly — it just doesn't paint on inactive cards. Graceful degradation.

**Open for user confirmation:** What is tugdeck's minimum supported environment?

#### [R05] Engine diff-restore regression surface (HIGH) {#r05-engine-diff-regression}

- **Risk:** [D11]'s engine restoreState diff change is a large behavior change in a hot path. Regression candidates: edit undo, content restore at mount, IME composition, cursor placement after restore.
- **Mitigation:** Start with Option (a) (content-identical skip only). Extensive engine unit test coverage before shipping. The full (b) / (c) diff is explicitly deferred to a follow-on plan.
- **Residual:** Unknown until we try. This is the riskiest single change; it gets its own Step with a full regression test matrix.

#### [R06] `_removeCard` save callback may throw (LOW) {#r06-close-throw}

- **Risk:** Save-on-close invokes the card's save callback, which may throw (e.g., serialization failure). Does destruction proceed?
- **Mitigation:** Wrap the close-save in try/catch; log in dev mode; proceed with destruction regardless. Losing save on close is a worse failure than continuing; at least the deck state stays consistent.
- **Residual:** A user closes a card whose save throws, and they don't know the bag didn't persist. Accept.

#### [R07] Focus restore at reload interrupts user typing (LOW) {#r07-focus-steal-on-reload}

- **Risk:** After reload, `CardHost` restores focus to the element that had focus at save time. If the user is already typing in a different element by the time restore fires, we steal focus.
- **Mitigation:** [Q02] Option B (from the previous plan, retained) — restore focus only when this card is the active card of the active pane at mount. Even then, check if focus is already somewhere inside the card; if yes, don't move it.
- **Residual:** Cold-boot race between user and restore. Rare; acceptable.

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
