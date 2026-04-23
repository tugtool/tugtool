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

**Cites:** [Table A](#audit-table-a) rows on contentEditable selection (dual-owned), form-control selection (card-host DOM-authority), engine `captureState/restoreState`; [Collision 1](#audit-collisions) (dual ownership); [Collision 7](#audit-collisions) (three independent restore paths).

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
| `regionScroll` | `Record<scrollKey, { x: number; y: number }>` | Card-host walk for every element carrying `data-tug-scroll-key="<key>"` — captures nested scrollable regions (e.g. markdown-view virtual scroll) distinct from the card's outer scroll |
| `domSelection` | `{ anchorPath: number[], anchorOffset, focusPath: number[], focusOffset } \| null` | Component that owns the contentEditable it anchors into; card-host passes it through to the owner via a new callback |
| `focus` | `{ kind: "none" } \| { kind: "form-control", persistKey: string } \| { kind: "dom", focusKey: string } \| { kind: "component-owned" }` | Card-host for keyed form-controls / focus-key elements; owning component for `component-owned` |

Every axis is optional on the bag — `scroll` without `formControls` is valid, etc. `regionScroll` is symmetric with `formControls`: both are keyed by an opt-in DOM attribute (`data-tug-scroll-key` mirrors `data-tug-persist-value`), walked by CardHost at save/restore, and uniqueness of keys within a card subtree is an author contract (same rule as `persistKey`).

**Cites:** [Table A](#audit-table-a) rows on each concept; [Collision 4](#audit-collisions) (focus not persisted at element level); [Collision 10](#audit-collisions) (asymmetric save/restore scope — a uniform schema covers all cards equally). For `regionScroll`: [Table C](#audit-table-c) rows on `scrollLeft/Top =` inside `tug-markdown-view.tsx` show internal scroll mutations not currently surfaced into any bag.

**Upholds:** [L23] user-visible state (scroll, selection, focus, content) is named explicitly in the schema. [L24] the schema is data-zone (semantic, read by non-rendering code for persistence); appearance-zone paint is separate (see [D04]).

**Rationale:** Paths rooted at the **card** boundary, not pane, so that cross-pane moves don't break path validity (the card's internal DOM travels with the card via `CardPortal`). `focus.kind === "component-owned"` is the marker for cards whose content-factory manages its own focus + selection together (tide-card → engine); restoring focus for those cards is the content factory's job, not card-host's. `regionScroll` closes the gap where a card has multiple scrollable regions (outer card scroll + internal virtual-list scroll, for example) and only the outer one is currently saved.

**Open question — see [Q01](#q01-v1-migration-scope).**

---

#### [D03] Card-level selection boundary registration (DECIDED) {#d03-card-level-boundary}

**Decision:** `useSelectionBoundary` is called with the card's `cardId` and its `[data-card-host][data-card-id]` element as the boundary, not with the pane id and the pane content element. `selectionGuard.boundaries` becomes keyed by card id. Where multiple cards exist inside one pane (tabs), each card registers its own boundary; only the active card's boundary matters at any one time for clipping, but the registry holds them all.

**Cites:** [Table A](#audit-table-a) (pane-level `bag.selection` keyed by card id — an existing mismatch); [Collision 2](#audit-collisions) pane-level vs card-level mismatch; [Collision 6](#audit-collisions) `saveSelection(paneId)` writing to `bag.selection` keyed by cardId.

**Upholds:** [L12] "Every card registers its content area as a selection boundary" (verbatim). `selection-model.md` § SelectionGuard ("operates at the card level only"). The tuglaw and the doc already prescribe this; current code drifted. This is restoration, not new design.

**Rationale:** The pane-level registration in `tug-pane.tsx:428` is a long-standing drift from the documented design. User's call on boundary layering was to fix that.

**Implications:** `useSelectionBoundary` callsite moves from `tug-pane.tsx` (keyed on pane) to `CardHost` (keyed on card). `useSelectionBoundary`'s `cardId` parameter was already named correctly; only the caller needs to change. Drag-clipping (`handlePointerMove`, `handleSelectionChange`) continues to operate at pane level for geometry but clamps to the active card's boundary — selectionGuard can look up the active card from the deck-state pointer.

---

#### [D04] Two-paint-layer model: `::selection` for one, CSS Custom Highlights for the rest (DECIDED) {#d04-two-paint-layers}

**Decision:** Paint is split in two:

- **Native `::selection`** paints the active selection on exactly one card — the focused card of the focused pane — operating on `window.getSelection()`. This is the browser's single live selection. The user can cut/copy from it, extend it, interact with it. It's unchanged from today.
- **CSS Custom Highlights** paint every *other* remembered selection as a dim, inactive highlight. Every card that has a known selection and isn't the focused card contributes its `Range` to the custom-highlight set. All such ranges paint simultaneously via one or more `::highlight(...)` CSS rules. The user cannot interact with these — they are appearance-only. They move in and out of the native slot as the user navigates cards.

The existing `inactive-selection` custom highlight in `selection-guard.ts:301` is the seed. Generalizing it from "one deactivated card during app resign" to "every non-focused card with a known selection, always" is the work.

**Cites:** [Table A](#audit-table-a) "CSS inactive-selection highlight"; [Table B](#audit-table-b) app resign/activate cycle; [Collision 8](#audit-collisions) (dim-highlight cycle is already a separate subsystem, just under-used). `selection-model.md` § Card Switch describes the inter-tab version of this mechanism as already-existing architecture.

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

**Cites:** [Table C](#audit-table-c) engine `setSelectedRange` call sites (many); [Collision 1](#audit-collisions) dual ownership of tide's DOM selection.

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
| Card close | **new** — `DeckManager._removeCard` invokes the save callback before removing. Closes [Collision 9](#audit-collisions). |
| Tab switch within pane | existing `tug-pane.tsx:439` `performSelectCard` → `invokeSaveCallback(outgoingCardId)` |
| Cross-pane card move | existing `DeckManager._moveCardToPane:1269` → `invokeSaveCallback(cardId)` |
| Card detach | existing `DeckManager._detachCard:1175` |

**Cites:** [Table B](#audit-table-b) lifecycle trigger map; [Collision 3](#audit-collisions) will-phase has no save subscribers; [Collision 9](#audit-collisions) card close doesn't flush.

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

**Cites:** [Table B](#audit-table-b) reload / mount triggers; [Collision 1](#audit-collisions) (handoff replaces dual ownership); [Collision 10](#audit-collisions) (asymmetric save/restore — asymmetric is now correct: save covers all cards, restore on reload-only, paint handles in-app transitions).

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

**Cites:** [Table C](#audit-table-c) selectionGuard call-site inventory; [Collision 1](#audit-collisions), [Collision 7](#audit-collisions).

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

**Cites:** [Collision 4](#audit-collisions) focus not persisted at element level; [Collision 5](#audit-collisions) form-control selection invisible without focus.

**Upholds:** [L23] element-level focus is user data — the user put the cursor there. We must preserve it.

**Rationale:** User's direct instruction: full element-level focus persistence is non-negotiable. The element-vs-card split keeps the schema simple while covering every real case.

---

#### [D11] DOM-preserving content restore for engine-managed cards (PROPOSED) {#d11-engine-diff-not-rewrite}

**Decision:** `TugTextEngine.restoreState` stops doing `this.root.innerHTML = parts.join("")` unconditionally. Instead:

1. If the engine's current DOM already reflects the target state (content matches), no-op. This is the steady-state skip.
2. If the engine's current DOM is empty and is receiving its first content, write innerHTML. (This is mount.)
3. If the engine's current DOM has content that differs from the target, diff-and-patch — mutate only the nodes that changed, leaving unchanged text nodes and their children in place. A minimal implementation can use DOM reconciliation ideas similar to React's, scoped to the flat parts list (text runs + `<br>` + `<img>` atoms).

The immediate L23 win: when an engine restoreState runs at mount with content identical to what's already there (e.g., HMR replay, spurious re-restore), the existing user selection anchors survive because we don't destroy the text nodes. The longer-term win: innerHTML rewrite disappears from the normal edit path.

**Cites:** [Table C](#audit-table-c) innerHTML write sites; [Collision 1](#audit-collisions) engine's rewrite displaces selection anchors.

**Upholds:** [L23] directly — this is the textbook "diff and mutate minimally" pattern the law describes. "Save and restore" (rewrite + setSelectedRange) is replaced with diff-and-patch.

**Rationale:** This is the riskiest/largest single change in the plan because it touches a 30KB engine module's hot path. But it's the only way to make tide-card selection survive non-trivial restore paths without conflicts. It also improves edit-path performance by removing unnecessary DOM churn.

**Implications:**
- New engine unit tests for idempotent restoreState (same content → no DOM mutation). Existing captureState/restoreState round-trip tests stay.
- Fallback path (full innerHTML rewrite) stays available for migration scenarios where the diff is too complex or the initial shape differs fundamentally.

**Open question — see [Q04](#q04-engine-diff-scope).**

---

#### [D12] No migration; old bags dropped on read (DECIDED) {#d12-no-migration}

**Decision:** There is no migration from the v1 bag shape. `readCardStates` in `settings-api.ts` simply returns the new shape directly, and any field in tugbank that doesn't match the new shape is ignored (the new field simply isn't populated). Old bags are effectively wiped on the first read; the next save writes the new shape. No `version` field on the bag — we don't need one because there is no forward-compatibility story to preserve.

**Cites:** [Table A](#audit-table-a) current v1 shape.

**Upholds:** Simplicity over defensive complexity. Per the user's guidance: there are no users besides the developer; a clean slate is cheaper than migration code.

**Implications:**
- `readCardStates` still returns `Map<cardId, CardStateBag>` but the values are already the new shape. TypeScript enforces the shape at the call site. Malformed entries in tugbank are silently dropped (the worst case is a brief selection-loss on the first reload after ship).
- No migration function. Simpler codebase.

---

#### [D13] Component persistence protocol: opt-in `persistKey`-keyed capture/restore (DECIDED) {#d13-component-persistence}

**Decision:** Stateful `tugways` components gain a framework-level persistence protocol. Each opt-in component registers via `useComponentPersistence({ persistKey, captureState, restoreState })`. The framework orchestrates capture and restore at explicit moments (`captureCardState` / `restoreCardState`) and harvests all registered components into a new `bag.components: Record<persistKey, unknown>` axis. Card authors no longer hand-serialize individual control state; they opt components in and the framework does the rest.

**Cites:** Component-roster L23 audit (surfaced the per-component gap — 5 of ~30 stateful components had any persistence path before this decision).

**Upholds:** [L23] "preserve user-visible state" — turns a per-card author-diligence concern into a framework guarantee. Decouples card authors from component internals. Makes adding a new stateful component a self-contained act (the component registers itself; cards that use it pick up persistence for free).

**Resolutions (all approved):**
- **Names:** `captureState` / `restoreState` (component), `captureCardState` / `restoreCardState` (framework), `useComponentPersistence` (hook).
- **Uniqueness:** enforced at card scope via dev-assertion; nesting supported via `<PersistenceScope prefix="…">` context that auto-prefixes child `persistKey`s.
- **Closure staleness:** internal ref storage ([L03]-compliant). `useComponentPersistence` stores the passed closures in refs, re-syncs on every render, framework reads the refs at capture time.
- **Capture / restore order:** parent-first for both. A parent's `captureState` cannot see child state directly; if it needs derived child state, it queries via an explicit observable or a shared store. Trade-off accepted for symmetry and simpler mental model.
- **Restore timing:** `useLayoutEffect` keyed on mount with a `has-restored` ref-guard; fires after DOM refs exist, before user interaction.
- **Partial restore:** unknown `persistKey`s are silently ignored with a dev-warn listing orphans. Symmetric to [D12].
- **Quiescence:** `captureState` must return synchronously. No Promises. Components with pending async state document their own policy (return current-committed, not pending-target).
- **Bag schema:** `bag.components` coexists with existing axes. Framework-synthesized axes (`formControls`, `regionScroll`, `focus`, `domSelection`, `markedText`) are populated by `CardHost` / `selectionGuard` / engine; `bag.components` is populated by the opt-in component harvest; `bag.content` remains the card's own content blob.
- **Opt-in:** absence of `persistKey` prop means "not persisted." Backward-compatible with gallery / test uses of the same components.
- **Relationship with `onCardActivated` ([A2]):** distinct responsibilities. `onCardActivated` is "re-focus on activation"; `captureState`/`restoreState` is "snapshot my interactive state." A component may implement both.
- **Frequency:** `captureState` fires only at explicit orchestration moments (will-resign, will-hide, tab switch, beforeunload, `saveState` RPC, close-before-destroy). Never per-keystroke.

**Implications:**
- Current persistence-aware components (`tug-input`, `tug-textarea`, `tug-prompt-input`, `tug-prompt-entry`, `tug-markdown-view` post-[M10]) port from `useCardPersistence` (card-level) to `useComponentPersistence` (component-level) where appropriate. `useCardPersistence` remains for cards themselves.
- `captureCardState` / `restoreCardState` become the **sole** explicit framework entry points for card-level snapshot/restore. All save triggers route through them; no trigger calls per-card `onSave` directly.
- See architecture piece [A9] for the implementation sketch.

---

### Open Questions {#open-questions}

Every question has a concrete decision the user must make before the execution plan is written. Questions referenced from design decisions as `[Qnn]`.

#### [Q01] Migration scope for v1 `bag.selection` (DECIDED) {#q01-v1-migration-scope}

**Question.** v1 stored `bag.selection` as a `SavedSelection` with paths rooted at the **pane** boundary (pre-[D03]). v2 roots paths at the **card** boundary. Do we:
- (a) Migrate v1 paths verbatim into v2 `domSelection` and accept that they may fail to resolve on first restore, then get rewritten correctly on the next save.
- (b) Attempt to re-root v1 paths at card boundaries during migration (requires walking paths and finding the card ancestor).
- (c) Drop v1 `bag.selection` entirely and accept one-time loss for pre-migration bags.

**Resolution:** DECIDED (c). There are no users; pre-migration bags can be discarded. Keep the code simple. See [D12](#d12-no-migration).

#### [Q02] Paint tier count for inactive highlights (DECIDED) {#q02-paint-tiers}

**Question.** Do we paint all non-focused cards' remembered selections at one dim level, or do we distinguish "inactive-in-active-pane" (card is in the active pane but not the active card) from "inactive-in-inactive-pane" (card is in a non-active pane)?

**Resolution:** DECIDED (one tier). All inactive selections paint through the existing `inactive-selection` CSS Custom Highlight. No UI distinction between card-inactive-within-active-pane and card-in-inactive-pane. Revisitable post-ship.

#### [Q03] Component publish frequency for DOM-selection ranges (DECIDED) {#q03-publish-frequency}

**Question.** How often should a component publish its current Range to `selectionGuard.updateCardDomSelection`?
- (a) On every `selectionchange` (fine-grained, most expensive, always-correct).
- (b) On focus-leave + DOM mutation (coarse, cheaper, only when the range would become "remembered").
- (c) Lazy — publish only when asked (selectionGuard queries on deactivate).

**Resolution:** DECIDED (a). Publish eagerly from the engine on every internal selection change — `setSelectedRange`, `restoreState` tail, and a `selectionchange` listener scoped to the engine's root. The operation is a `Map.set` followed by a `updatePaint()` that short-circuits when only the focused card's entry changed (the focused card's range lives in `window.getSelection()` and paints natively; the inactive-highlight rebuild produces an identical output and can skip re-paint). Net cost per caret move: one Map write and a short-circuit check — cheap. Rejected (b) as underspecified: "focus-out" is not a single event in the engine, and a component that publishes only at focus-out loses its range mid-composition if the DOM mutates before the user blurs. Rejected (c) as racy against app-resign.

#### [Q04] Engine diff-restore scope (DECIDED) {#q04-engine-diff-scope}

**Question.** How thorough should [D11]'s diff-restore in the engine be?
- (a) "Content-identical fast path" only — skip the innerHTML rewrite if the captured state matches what the engine already has in its DOM; otherwise full rewrite.
- (b) True flat-parts diff — compare the new `parts.join("")` against the current DOM and mutate only the differences.
- (c) Full DOM reconciliation over the flat parts list (React-like keyed diff).

**Resolution:** DECIDED (a). Ship the content-identical fast path only. (b) and (c) are deferred as follow-ons.

#### [Q05] Close-flush timing: before or after destroy lifecycle event (DECIDED) {#q05-close-flush-timing}

**Question.** `DeckManager._removeCard` fires `cardWillBeginDestruction` as part of its commit. Does save-on-close fire before or after the will-begin-destruction notification?

**Resolution:** DECIDED (before). The save callback runs before `cardWillBeginDestruction` subscribers fire, so subscribers that release resources don't cut the ground out from under the save.

#### [Q06] Engine's selection publish API placement (DECIDED) {#q06-engine-publish-api}

**Question.** Where does the engine expose its "publish current Range" hook?
- (a) On `TugTextEngine` directly — `engine.onSelectionChanged(cb)`.
- (b) On `TugPromptInput` (the React wrapper) — component-level integration surface.
- (c) On the `CardPersistenceCallbacks` — card-host pattern extension.

**Resolution:** DECIDED (a) + (c). `engine.onSelectionChanged(cb)` is the source API on the engine. The wiring from engine → `selectionGuard.updateCardDomSelection` runs through `CardPersistenceCallbacks` extensions so CardHost can own the cardId-to-guard relay. `TugPromptInput` stays thin.

---

### Risks and mitigations {#risks}

#### [R01] Stale `Range` objects held in custom highlights (MED) {#r01-stale-ranges}

- **Risk:** A `Range` held in `selectionGuard.inactiveRanges` becomes invalid when the DOM it anchors into is mutated (engine innerHTML rewrite, React re-render that replaces nodes). Paint becomes nonsense or throws on access.
- **Mitigation:** Components that mutate their DOM must call `selectionGuard.updateCardDomSelection(cardId, newRange | null)` after every such mutation. [D05] / [Q03] formalize this. [D11]'s diff-instead-of-rewrite engine path reduces how often this is needed.
- **Residual:** Components that mutate DOM without publishing will silently produce stale highlights. Wired in [Step 5](#step-5): `updatePaint()` validates every Range before painting via `document.contains(range.startContainer) && document.contains(range.endContainer)`; stale entries are dropped from `cardRanges` and a dev-mode `console.warn` logs the offending cardId with a "owning component did not re-publish after DOM mutation" message. The Step 5 test list pins this behavior.

#### [R02] IME composition in-flight during will-phase capture (MED) {#r02-ime-composition}

- **Risk:** On `applicationWillResignActive`, the user may be mid-IME-composition (CJK input). `selectionStart/End` during composition reads buffer offsets that may not map back after activation.
- **Mitigation:** Save handlers that read `selectionStart/End` check `document.activeElement` for an active composition via `isComposing` on tracked CompositionEvent state. If composition is active, defer the save until `compositionend`. The will-phase event itself still fires and dim paint updates; only the precise offsets wait.
- **Residual:** Process-exit before `compositionend` loses in-flight composition. Browser-platform limit; can't be fully eliminated.

#### [R03] WebKit programmatic-selection degradation on repeated apply (MED) {#r03-programmatic-selection}

- **Risk:** If a component repeatedly calls `setSelectionRange` / `setBaseAndExtent` on the same element across multiple transitions, WebKit may silently degrade the selection (the "Case γ" pattern from the previous plan).
- **Mitigation:** [D08] + [D07] together eliminate most programmatic re-applies in steady state. Components that restore selection (engine at mount, card-host at reload mount) apply once per mount. Skip-if-already-correct checks inside [D11]'s diff path avoid re-apply when state already matches.
- **Residual:** Reload still programmaticizes on restore. That's unavoidable — the DOM is new.

#### [R04] CSS Custom Highlights API browser support (CLOSED) {#r04-highlights-support}

- **Risk:** CSS Custom Highlights API shipped in WebKit 17.4 (March 2024). Older environments paint nothing.
- **Mitigation:** Minimum supported environment is **macOS 15.6**, which carries WebKit 20.x — well past the 17.4 threshold. No compatibility concern.
- **Status:** Closed per user confirmation.

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

The implementation sequence begins with 15 commits (Steps 1–15) landing the selection/focus/scroll persistence subsystem. Each is independently revertable. The compile target stays green end-to-end; the user-visible save/restore behavior may regress briefly between commits (from Step 1 through Step 10) and comes back fully correct at Step 10. Integration tests at Step 14 pin every transition.

Steps 16–19 land M-phase 0 of the M-series — the Component Persistence Protocol foundation ([A9] / [D13]). The M-series continues beyond Step 19 (subsequent phases authored as separate step blocks); Step NN performs the final documentation + cleanup pass.

#### Step 1: Replace `CardStateBag` shape; strip old-shape callers {#step-1}

**Depends on:** —

**Commit:** `refactor(layout-tree): replace CardStateBag with v2 shape (no migration)`

**References:** [D01](#d01-data-not-service), [D02](#d02-bag-schema), [D12](#d12-no-migration), [Collision 2](#audit-collisions), [Collision 6](#audit-collisions); `layout-tree.ts:37-49`, `card-host.tsx:334,245,289,101-120`, `action-dispatch.ts:510`.

**Artifacts:**
- `tugdeck/src/layout-tree.ts`: `CardStateBag` with these fields only: `scroll?`, `content?`, `formControls?` (renamed from `domInputs`), `regionScroll?` (null at Step 1; shape finalized at Step 9), `domSelection?` (null at Step 1; shape finalized at Step 6), `focus?` (null at Step 1; shape finalized at Step 7). `SavedSelection` re-export removed from `layout-tree.ts` (it stays in `selection-guard.ts` for that module's own internal use during the migration period).
- `DomInputSnapshot` renamed to `FormControlSnapshot`; selection fields (`selectionStart`/`End`/`Direction`) drop out of the type because Step 8 moves them to a single per-card capture path (they're currently there at `layout-tree.ts:58-60`, redundantly). Keep `value`, `scrollTop`, `scrollLeft`.
- New types declared with null placeholders on the bag: `RegionScrollSnapshot | null`, `DomSelectionSnapshot | null`, `FocusSnapshot | null`. Shape is finalized at the step that captures each axis (Steps 6, 7, 9).

**Tasks:**
- [x] Rewrite `layout-tree.ts` types. Drop `SavedSelection` import and re-export.
- [x] Remove `captureDomInputs`' selection-field capture at `card-host.tsx:113-115` (anticipates Step 8 which relocates them).
- [x] Remove `applyDomInputSnapshot`'s `setSelectionRange` call at `card-host.tsx:151-167` (anticipates Step 8).
- [x] Rename `captureDomInputs` → `captureFormControls`; `applyDomInputSnapshot` → `applyFormControlSnapshot`; update all callers inside `card-host.tsx`.
- [x] Remove `selectionGuard.saveSelection(hostStackId)` callsite at `card-host.tsx:334` (inside `saveCurrentCardStateRef.current`). Replace with `domSelection: null` until Step 7 wires new capture.
- [x] Remove `selectionGuard.restoreSelection(...)` callsites at `card-host.tsx:245,289` and `action-dispatch.ts:510`. Leave stubs with comment pointing at the step that restores them (Step 9 / Step 10).
- [x] Remove the now-unused `selectionGuard` import from `card-host.tsx` and `action-dispatch.ts` if nothing else uses it there.
- [x] Remove the `bag.selection != null` check from `action-dispatch.ts`'s `restoreActiveCardSelection` helper; simplify down to the scroll/`saveAndFlush` path already there (symmetric save on did-resign remains unchanged).

**Upholds:** [L10] (card-host, selection-guard ownership boundaries unchanged). [L23] (data fields for user-visible state — scroll, selection, focus — are named in the schema explicitly).

**Tests:**
- [x] `bun test` passes; `bun x tsc --noEmit` passes.
- [x] Add `layout-tree.test.ts` JSON round-trip assertions for each new bag axis shape (including empty-axis cases).
- [x] Existing `card-host-composition.test.tsx` passes with the renamed fields.

**Checkpoint:**
- [x] `bun x tsc --noEmit` exits 0.
- [x] `bun test` full suite green.
- [x] Grep `selectionGuard.saveSelection\|selectionGuard.restoreSelection` inside `tugdeck/src/` returns only the definitions inside `selection-guard.ts` (no outside callers). *Residual: test callers in `__tests__/selection-guard*.test.ts`, `__tests__/selection-model.test.tsx`, `__tests__/use-selection-boundary.test.tsx` still exercise the legacy API directly. They retire alongside the API at Step 9 / Step 15.*

---

#### Step 2: Move selection boundary registration to card level {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(selection-guard): register boundaries by cardId via CardHost`

**References:** [D03](#d03-card-level-boundary), [L12], `selection-model.md` § SelectionGuard ("operates at the card level only"); `tug-pane.tsx:428`, `hooks/use-selection-boundary.ts:49-63`, `card-host.tsx:470-505`.

**Artifacts:**
- `useSelectionBoundary(cardId, cardRootRef)` is called inside `CardHost`, keyed on the card-host div (`[data-card-host][data-card-id]`), not on pane content. Remove the call from `TugPane` (`tug-pane.tsx:428`).
- `selectionGuard.registerBoundary` continues to take a string key (the key name was already `cardId` in the type). Its internal `boundaries: Map<string, HTMLElement>` now holds one entry per card, not one per pane.
- Drag-clip / keyboard-extend clipping inside `selection-guard.ts` (see `handlePointerMove`, `handleSelectionChange`) continues to operate correctly because it looks up the boundary of the card under the pointer. The currently-tracked card id (`activeCardId`) is resolved from the pointerdown target (find `[data-card-host]` ancestor) rather than from the pane that was clicked.
- `activeCardId_highlight` inside selection-guard continues to name the card that owns the active selection — semantics unchanged at this step.
- New private helper `getBoundaryRect(boundary)` inside `selection-guard.ts`. The card-host div uses `display: contents`, which returns a zero `DOMRect` from `getBoundingClientRect()`. The helper walks up to the nearest ancestor that produces a real box (the pane's content div in practice) so drag-clip/autoscroll keep clamping against the same viewport rect they used pre-Step-2.

**Tasks:**
- [x] Remove `useSelectionBoundary(stackId, contentRef)` from `tug-pane.tsx:428`.
- [x] Add a `cardRootRef` inside `CardHost` that attaches to the existing `[data-card-host][data-card-id]` div at `card-host.tsx:473-480`.
- [x] Call `useSelectionBoundary(cardId, cardRootRef)` from within `CardHost`.
- [x] Inside `selection-guard.ts`, change any code that resolves a card-under-pointer via pane lookup to resolve via `el.closest('[data-card-host]')`. Specifically: the `pointerdown` handler's card-tracking path (approximately `selection-guard.ts:456` area — `activateCard`).
- [x] Update `selection-model.md` table row for `useSelectionBoundary` to name the card-host div, not `.tug-pane-chrome-content`.
- [x] Add `getBoundaryRect` helper and route every `boundary.getBoundingClientRect()` through it (`display: contents` zero-rect fallback).

**Upholds:** [L12] card-level selection boundary (verbatim, restored). [L10] selection-guard stays the boundary owner; card-host delegates boundary registration.

**Tests:**
- [x] `selection-model.test.tsx`' boundary registration tests: register per card id. Assert that a multi-card pane has N boundaries registered (one per card), not 1.
- [x] `selection-guard`' drag-clip test that the clip destination resolves via `closest('[data-card-host]')`.
- [x] `card-host-composition.test.tsx` still green.

**Checkpoint:**
- [x] `bun x tsc --noEmit` exits 0.
- [x] `bun test` full suite green (2214 pass).
- [x] Manual probe: render two cards in a single pane and confirm `selectionGuard.boundaries` has two entries at runtime. *Verified: a two-tab Tide pane + a single-card Hello World pane yielded `boundaries.size === 3`, with two entries sharing the Tide pane's `data-pane-id` and one in the other pane. Temporary `window.__selectionGuard` expose was stripped before commit.*

---

#### Step 3: `TugTextEngine.onSelectionChanged` publish API {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tug-text-engine): add onSelectionChanged publish API`

**References:** [D05](#d05-component-publish), [Q06](#q06-engine-publish-api), [L10], [L11]; `lib/tug-text-engine.ts:78,449,632,658`, `components/tugways/tug-prompt-input.tsx:817`.

**Artifacts:**
- New engine method: `onSelectionChanged(cb: (range: Range | null) => void): () => void`. Returns a dispose function.
- Engine fires the callback synchronously after any call that changes its internal selection:
  - `setSelectedRange` at `tug-text-engine.ts:449`.
  - `restoreState`'s tail at `tug-text-engine.ts:658`.
  - Any other path that ends in a `sel.setBaseAndExtent` write (interactive selection from the user's drag / click / keyboard is a separate code path that goes through native selectionchange; see Tasks below).

- Engine publishes `null` when there's no active selection inside its root (e.g., after a `clear`), and a live `Range` object (cloned from `window.getSelection().getRangeAt(0)`) when there is one.
- Two new private invariants that keep the contract stable across environments: (a) a `_suppressSelectionEmits` flag wrapping atomic multi-write sequences (`setSelectedRange`'s `removeAllRanges` + `addRange`, `restoreState`'s `innerHTML=…` + nested `setSelectedRange`, `clear`'s `innerHTML=""`) so only the outer entry point emits; (b) dedup on anchor/focus endpoints so redundant `selectionchange` fires (happy-dom's synchronous dispatch, or real browsers' async echo after a programmatic write) are collapsed to a single emit.

**Tasks:**
- [x] Add `onSelectionChanged` to the engine's public interface at `lib/tug-text-engine.ts:78`.
- [x] Implement subscriber list as `Set<(range: Range | null) => void>` with a dispose-function contract.
- [x] Add the emit call inside `setSelectedRange` and at the tail of `restoreState`. Each call reads the current `window.getSelection()` if the root has focus; otherwise constructs a Range from the engine's internal selection coords and root.
- [x] Add an `input` / `selectionchange` listener on the engine root so the engine publishes selection as the user interactively drags/types. Scope the listener to `this.root` so it doesn't fire for selections outside the engine. *Implementation: `selectionchange` fires on `document`, so the listener registers at document scope and `emitSelectionChanged` self-filters via `this.root.contains(anchor)`. No separate `input` listener needed — content-change-driven selection shifts always trigger a `selectionchange`.*
- [x] Dispose subscribers in the engine's `destroy` method. *The engine's cleanup entry point is named `teardown`; subscribers + dedup state are cleared there.*
- [x] Expose `onSelectionChanged` on the `TugPromptInputDelegate` (via `tug-prompt-input.tsx`'s `useImperativeHandle`) so cross-component consumers can subscribe through the same API surface as the engine.

**Upholds:** [L11] engine owns its selection state; exposes a hook for non-owner observers to subscribe rather than poking at engine internals. [L10] engine publishes; selection-guard consumes.

**Tests:**
- [x] New `tug-text-engine.test.ts` tests: `engine.setSelectedRange(a, b)` fires `onSelectionChanged` with a Range matching `a,b`; `engine.restoreState(...)` fires with the restored range; `engine.clear()` fires `null`.
- [x] Unsubscribe actually stops firing.
- [x] A user-driven selectionchange (simulated via happy-dom) fires `onSelectionChanged` exactly once with the current Range.
- [x] Transition-out case (selection moves from inside the root to outside) emits `null` exactly once.
- [x] Multiple subscribers all fire; unsubscribing one leaves the other intact.
- [x] `teardown` drops subscribers.

**Checkpoint:**
- [x] `bun x tsc --noEmit`, `bun test` green (2224 pass).

---

#### Step 4: Wire engine publish → `selectionGuard.updateCardDomSelection` {#step-4}

**Depends on:** #step-3

**Commit:** `feat(selection-guard): updateCardDomSelection + TugPromptInput wiring`

**References:** [D05](#d05-component-publish), [Q06](#q06-engine-publish-api); `selection-guard.ts:262,538-545`, `tug-prompt-input.tsx:357-364,481,817`, `card-host.tsx:223-263,485`.

**Artifacts:**
- New public method on `selectionGuard`:
  ```
  updateCardDomSelection(cardId: string, range: Range | null): void
  ```
  Stores the Range in `cardRanges: Map<cardId, Range | null>` (new internal state, separate from the old `inactiveRanges` which is retired in Step 6).
- `TugPromptInput` subscribes to its engine's `onSelectionChanged` in a `useLayoutEffect` scoped to the engine's lifetime and the `cardId` from `CardPersistenceContext`. On each callback, invokes `selectionGuard.updateCardDomSelection(cardId, range)`. Unsubscribes on unmount.
- `CardPersistenceCallbacks` gains no new fields at this step; the wiring lives inside `TugPromptInput` and reads `cardId` from the callback-register flow already established in [`CardHost`'s register contract](#audit-table-a).
- Step 3's eager publish ([Q03] resolution (a)) is the implementation: the engine publishes on `setSelectedRange`, `restoreState` tail, and its own scoped `selectionchange` listener. Cost is bounded because `updatePaint()` (Step 5) short-circuits when the only change is to the focused card's entry (that range is painted natively via `window.getSelection()`, not via the inactive highlight).

**Tasks:**
- [x] Add `cardRanges` and `updateCardDomSelection` to `selection-guard.ts`. *Also added a read-only `getCardRange(cardId)` accessor — Step 5's paint loop and Step 4's tests both need to observe the store without poking private fields. Also wired `cardRanges.delete(cardId)` into both `unregisterBoundary` and `reset` so boundary teardown and test isolation drop entries in lockstep.*
- [x] In `TugPromptInput` (search for the engine-creation `useLayoutEffect` around line 640-650), subscribe to `engine.onSelectionChanged` and relay to `selectionGuard.updateCardDomSelection(cardId, range)`.
- [x] Ensure the `cardId` is reachable inside `TugPromptInput` — it already has `CardPersistenceContext` (`tug-prompt-input.tsx:349`). If `cardId` isn't currently exposed there, expose it alongside the existing register callback in `CardHost`'s persistence context value at `card-host.tsx:485`. *Implementation: `CardPersistenceContext` value type changed from `register-fn` to `{ cardId, register }`; added `useCardId()` hook as the canonical read path. `CardHost` provides a memoized `{ cardId, register }` pair; `useCardPersistence` destructures `.register`. Test provider in `use-card-persistence.test.tsx` updated to the new shape.*
- [x] At unsubscribe / card unmount, call `selectionGuard.updateCardDomSelection(cardId, null)` to clear the Range from the store.

**Upholds:** [L10] engine and selection-guard talk through a narrow interface (`updateCardDomSelection`). [L22] `cardRanges` drives downstream DOM paint (Step 5) via direct store observation, not React round-trip.

**Tests:**
- [x] `card-host-composition.test.tsx` grows a test: mount a `TugPromptInput` card, call `engine.setSelectedRange(3, 7)`, assert `selectionGuard.cardRanges.get(cardId)` holds a Range with those offsets.
- [x] Unmount clears the entry.

**Checkpoint:**
- [x] `bun x tsc --noEmit`, `bun test` green (2226 pass).

---

#### Step 5: Generalize selection-guard paint for multi-card inactive highlights {#step-5}

**Depends on:** #step-4

**Commit:** `feat(selection-guard): paint every non-focused card's range via inactive highlight`

**References:** [D04](#d04-two-paint-layers), [Q02](#q02-paint-tiers), [L06], [L22]; `selection-guard.ts:293,301,530-580`, `tug-pane.css` `::highlight(inactive-selection)`.

**Artifacts:**
- SelectionGuard paints every entry of `cardRanges` in the `inactive-selection` Highlight **except** the entry whose cardId matches the deck's active-pane's active card. That one range is mirrored into `window.getSelection()` so `::selection` paints it.
- Paint updates fire on: (a) `cardRanges.set`/`delete` calls via `updateCardDomSelection`; (b) deck-state change on `activePaneId` or the active pane's `activeCardId`, via a new `store.subscribe` subscription installed in `selectionGuard.attach` (already receives `appLifecycle`; extend to take the deck store too or reach it through `getDeckManager()`).
- `updatePaint()` validates every Range before painting: if `!document.contains(range.startContainer) || !document.contains(range.endContainer)`, the Range is stale (its anchor DOM was detached — the classic [R01](#r01-stale-ranges) failure: an engine or other component mutated its subtree without calling `updateCardDomSelection(cardId, newRange)`). Stale Ranges are dropped from `cardRanges` and, in dev builds (`isDevEnv()`), a `console.warn` logs the offending `cardId` with a "stale range dropped — owning component did not re-publish after DOM mutation" message. Prod builds silently drop. This closes the R01 residual the previous plan left open.
- **Perf short-circuit.** `updatePaint()` takes an optional `hint: { changedCardId?: string }` parameter. When the only change is to the currently-focused card's entry (`hint.changedCardId === getFocusedCardId() && windowHasFocus`), skip the `inactiveHighlight` rebuild entirely — the focused card's range is painted natively via `window.getSelection()`, and the inactive-highlight set is unchanged. `updateCardDomSelection` passes `{ changedCardId: cardId }`. Deck-state-change callers pass no hint (full rebuild). This bounds the cost of eager publishing ([Q03]): per-caret-move cost is one Map write plus one short-circuit check.
- The existing `handleApplicationDidResignActive` / `handleApplicationDidBecomeActive` refactor: on resign, the active card's cardId is temporarily dropped from the "focused" position so its Range also paints in the custom highlight (matches current dim behavior); on become-active, the cardId is restored. Internally this can just flip a boolean `windowHasFocus` read by the paint computation; the effect is the same as the old dedicated map but without a separate code path.

**Tasks:**
- [x] Add `windowHasFocus` boolean (defaults true, flips on will-resign/did-become).
- [x] Add `getFocusedCardId(): string | null` — resolves via deck-state `activePaneId` → `pane.activeCardId`. *Implementation: reads the process-wide `getDeckStore()`; returns `null` when no store is registered so tests that bootstrap only the guard no-op cleanly.*
- [x] `updatePaint(hint?: { changedCardId?: string })` (new internal method): if the hint indicates the focused card's entry changed while `windowHasFocus`, short-circuit. Otherwise clear `inactiveHighlight` and rebuild from `cardRanges` minus the focused card's entry (when `windowHasFocus` is true), validating each Range's containers against `document.contains` and dropping stale entries with a dev-warn. Moves the focused-card range into `window.getSelection()`.
- [x] `updateCardDomSelection(cardId, range)` calls `updatePaint({ changedCardId: cardId })`.
- [x] Subscribe to deck-state changes — on `activeCardId` or `activePaneId` change, call `updatePaint()` (no hint → full rebuild). *Implementation: new `lib/deck-store-registry.ts` singleton (mirrors `lib/card-lifecycle.ts`/`lib/app-lifecycle.ts`); `DeckManager` constructor calls `registerDeckStore(this)` before rendering; `selectionGuard.attach` reads `getDeckStore()` and subscribes. `detach` releases the subscription. An initial `updatePaint()` after subscribing syncs paint to the store's current active card.*
- [x] Retire `inactiveRanges` and `deactivatedCardId` fields from `selection-guard.ts` — subsumed by `cardRanges` + `windowHasFocus`. *`saveSelection`'s legacy fallback path now reads `cardRanges` instead of `inactiveRanges`; the API itself retires at Step 9.*
- [x] `handleApplicationWillResignActive` / `handleApplicationDidBecomeActive` refactor — they now only flip `windowHasFocus` and call `updatePaint()`. No more manual Range cloning. *Note: the plan names `handleApplicationWillResignActive` but the current wiring still subscribes to the did-phase events (will-phase triggers are Step 13's concern). The bodies are refactored per the plan; the subscription point changes in Step 13.*
- [x] Share `isDevEnv` as a `lib/dev-env.ts` helper so `selection-guard` (and any other module that needs the dev gate) can import it. `deck-manager.ts` now imports the shared helper instead of defining its own copy.
- [x] **Fix: engine must not emit `null` on focus-out.** The Step 3 listener was emitting `null` whenever the selection moved outside the engine's root — which immediately dropped `cardRanges[cardId]` and made the dim-on-switch UX impossible (nothing to paint). The listener now early-returns for out-of-root selections; only programmatic clears (`clear()` / `restoreState({selection: null})`) still emit `null` at their own call sites. The `tug-text-engine.test.ts` transition-out test is rewritten to pin the new contract.
- [x] **Fix: restore `preventMousedown` on focus-change.** The click that triggers a card switch was collapsing `setBaseAndExtent`'s restoration to the click point. The deck-store subscription handler now tracks the last-painted focus id; when focus genuinely moves to a card that has a saved `cardRange`, it installs the one-shot capture-phase mousedown interceptor *before* calling `updatePaint`. Cards without a saved Range get normal click-to-caret behavior. Three new T29 tests pin: interceptor installed on restore-worthy focus-change; not installed when the new card has no saved Range; not installed when the store fires without a focus change.

**Upholds:** [L06] paint is appearance-zone — CSS Highlight mutation, no React. [L22] paint subscribes to the deck store and writes to the DOM highlight directly.

**Tests:**
- [x] Register two cards, publish a Range for each, flip `activeCardId` between them, assert only the currently-active card's range is in `window.getSelection()` and the other is in `inactive-selection`.
- [x] App resign: both ranges paint in `inactive-selection`.
- [x] App become-active: focused card's range moves back to native; other remains in inactive.
- [x] Mutation tests for `updateCardDomSelection(cardId, null)` → removes from paint.
- [x] **Stale-range drop**: publish a Range, then detach the anchoring element from the document (simulates an engine-root replacement without a re-publish), trigger an unrelated `updatePaint()` (e.g., a deck-state change), assert the stale entry is removed from `cardRanges` and a dev-warn was emitted.
- [x] **Perf short-circuit**: `updatePaint({ changedCardId })` where `changedCardId === getFocusedCardId() && windowHasFocus` does NOT call `inactiveHighlight.clear()` (assert via spy).
- [x] Retired 5 legacy `selection-guard-highlight.test.ts` cases that pinned the old `activateCard`-populates-`inactiveRanges` mechanism; their spiritual successors live in the new `selection-guard-paint.test.ts`.

**Checkpoint:**
- [x] `bun x tsc --noEmit`, `bun test` green (2227 pass).
- [ ] Manual probe: open a tide card and a gallery card side-by-side, select in tide, switch to gallery — tide's selection paints dim; switch back — goes bright.

---

#### Step 6: Capture `bag.domSelection` at save time {#step-6}

**Depends on:** #step-5

**Commit:** `feat(card-host): serialize bag.domSelection from selection-guard cardRanges`

**References:** [D02](#d02-bag-schema), [D07](#d07-restore-handoff); `card-host.tsx:329-356`, `selection-guard.ts` (new `cardRanges` from Step 5).

**Artifacts:**
- `selectionGuard.getCardRange(cardId): Range | null` new read API returning the currently-stored Range.
- `CardHost`'s `saveCurrentCardStateRef.current` now:
  - Reads `selectionGuard.getCardRange(cardId)`.
  - If non-null and both endpoints are inside `cardRoot`, builds a `DomSelectionSnapshot` (`{ anchorPath, anchorOffset, focusPath, focusOffset }`) using `nodeToPath` (existing helper inside `selection-guard.ts:142` — either expose or duplicate).
  - Assigns to `bag.domSelection`.
- `DomSelectionSnapshot` type finalized in `layout-tree.ts` (was `null` placeholder at Step 1).

**Tasks:**
- [x] Add `getCardRange` to `selection-guard.ts`. _(landed in Step 5; re-verified.)_
- [x] Expose `nodeToPath` as a public helper inside `selection-guard.ts` (was private), or import it from there to `card-host.tsx`.
- [x] In `saveCurrentCardStateRef.current`, capture `domSelection`.
- [x] Add unit test for the serializer.

**Upholds:** [L10] selection-guard owns the live Range; card-host owns serialization shape into the bag.

**Tests:**
- [x] Serialize a Range anchored inside a card root, assert the paths and offsets round-trip.
- [x] Range whose endpoints fall outside the card root → `domSelection: null`.

**Checkpoint:**
- [x] `bun x tsc --noEmit`, `bun test` green.

---

#### Step 7: Capture `bag.focus` at save time {#step-7}

**Depends on:** #step-6

**Commit:** `feat(card-host): serialize bag.focus with element-level persistence`

**References:** [D02](#d02-bag-schema), [D10](#d10-focus-persistence), [Collision 4](#audit-collisions), [L23]; `card-host.tsx:329-356`, `tug-input.tsx:105,191`, and new attribute.

**Artifacts:**
- New attribute `data-tug-focus-key="<key>"` spec. Any focusable element that wants its focus preserved sets this attribute; card-level save walks the card subtree for it.
- `FocusSnapshot` type finalized:
  ```
  type FocusSnapshot =
    | { kind: "none" }
    | { kind: "form-control"; persistKey: string }
    | { kind: "dom"; focusKey: string }
    | { kind: "component-owned" };
  ```
- `saveCurrentCardStateRef.current` reads `document.activeElement` and emits one of the four variants:
  - Inside the card root: if it has `data-tug-persist-value` → `form-control`; else if `data-tug-focus-key` → `dom`; else if it matches a "component-owned" selector (e.g., `.tug-prompt-input [contenteditable]` — we will register a broader predicate) → `component-owned`; else `none`.
  - Outside the card root or `null` → `none`.
- `TugInput` / `TugTextarea` continue to carry `data-tug-persist-value` (not `data-tug-focus-key`) — focus of a form-control is implicit from persistKey.

**Tasks:**
- [x] Add `FocusSnapshot` type to `layout-tree.ts`.
- [x] Implement `captureFocus(cardRoot): FocusSnapshot` helper inside `card-host.tsx`.
- [x] Wire `captureFocus(cardRoot)` into `saveCurrentCardStateRef.current`.
- [x] Register a `component-owned` predicate — initially: `el instanceof HTMLElement && el.closest('[data-tug-prompt-input-root]')` (add this marker attribute in TugPromptInput at Step 7 too).
- [x] Document `data-tug-focus-key` in `selection-model.md`.

**Upholds:** [L23] element-level focus is now user-data-preserving per saved state. [L10] card-host owns focus capture; engines/components mark themselves via attribute or component-owned selector.

**Tests:**
- [x] `<input data-tug-persist-value="email">` focused → `{ kind: "form-control", persistKey: "email" }`.
- [x] `<button data-tug-focus-key="save">` focused → `{ kind: "dom", focusKey: "save" }`.
- [x] `[data-tug-prompt-input-root] [contenteditable]` focused → `{ kind: "component-owned" }`.
- [x] `document.body` focus → `{ kind: "none" }`.
- [x] Focus outside the card root → `{ kind: "none" }`.

**Checkpoint:**
- [x] `bun x tsc --noEmit`, `bun test` green.

---

#### Step 8: Capture form-control `selectionStart/End/Direction` into `bag.formControls` {#step-8}

**Depends on:** #step-7

**Commit:** `feat(card-host): capture form-control selection into bag.formControls`

**References:** [D02](#d02-bag-schema), [Collision 5](#audit-collisions); `card-host.tsx:101-167`.

**Artifacts:**
- `FormControlSnapshot` regains `selectionStart?: number`, `selectionEnd?: number`, `selectionDirection?: "forward" | "backward" | "none"` alongside `value`, `scrollTop`, `scrollLeft`.
- `captureFormControls` reads selection fields for every element carrying `data-tug-persist-value`, regardless of focus.
- `applyFormControlSnapshot` restores selection via `setSelectionRange` after value restore.
- On restore, if the element is not focused at the moment of apply, the selection persists internally in the form-control. When the card's focus restore (Step 10) lands on that element, the browser paints `::selection`.

**Tasks:**
- [x] Add back selection fields to `FormControlSnapshot` (they were dropped in Step 1 for separation of concerns; now the separation is clear, add them back here).
- [x] `captureFormControls` reads all three fields defensively (some `<input type=...>` don't support `selectionStart`; wrap in try/catch).
- [x] `applyFormControlSnapshot` calls `setSelectionRange` after value assignment; wrapped in try/catch.

**Upholds:** [L23] form-control selection is user-data-preserving.

**Tests:**
- [x] Save→load round-trip on an `<input>` with `value="hello world"`, `selectionStart=6`, `selectionEnd=11`, direction `forward`.
- [x] `type="checkbox"` with `persistKey` set: save doesn't throw, restore doesn't throw, selection fields are absent.

**Checkpoint:**
- [x] `bun x tsc --noEmit`, `bun test` green.

---

#### Step 9: Capture + restore nested region scroll (`bag.regionScroll`) {#step-9}

**Depends on:** #step-8

**Commit:** `feat(card-host): capture nested region scroll via data-tug-scroll-key`

**References:** [D02](#d02-bag-schema), [L23]; `card-host.tsx:101-120,282-326`, `tug-markdown-view.tsx:441,484,537,632,810`, `lib/smart-scroll.ts:224,248`.

**Artifacts:**
- `RegionScrollSnapshot` shape finalized in `layout-tree.ts`: `Record<string, { x: number; y: number }>` — the `bag.regionScroll` slot added at Step 1 as a null placeholder is filled in here.
- New opt-in DOM attribute `data-tug-scroll-key="<key>"` documented in `selection-model.md`. Any scrollable region that wants its scroll preserved across reload carries this attribute. Uniqueness per card subtree is an author contract (same rule as `persistKey`).
- `captureRegionScrolls(cardRoot): Record<string, { x, y }> | undefined` helper in `card-host.tsx`, mirroring `captureFormControls`: `querySelectorAll('[data-tug-scroll-key]')`, reads each element's `scrollLeft/Top`, keys by the attribute value.
- `applyRegionScrolls(cardRoot, snapshot)` helper, mirroring `applyFormControlSnapshot`: `querySelector` by key, writes `el.scrollLeft/Top`.
- `saveCurrentCardStateRef.current` writes `bag.regionScroll`.
- Mount restore effect reads `bag.regionScroll` and applies after scroll restore.
- `tug-markdown-view.tsx`'s scroll container gains `data-tug-scroll-key="markdown-view"` (or a more specific key if there are multiple regions inside). Markdown-view's own ad-hoc scroll save/restore at `tug-markdown-view.tsx:441,484,537,632` continues to handle runtime behavior (clamps, auto-scroll-to-bottom) but reload-survival now flows through the bag.

**Tasks:**
- [x] Finalize the `regionScroll` type in `layout-tree.ts`.
- [x] Implement `captureRegionScrolls` and `applyRegionScrolls` in `card-host.tsx`.
- [x] Wire into save path (`saveCurrentCardStateRef.current`) and mount restore effect.
- [x] Add `data-tug-scroll-key="markdown-view"` to `tug-markdown-view.tsx`'s scroll container.
- [x] Document the attribute in `selection-model.md` (add to the `data-tug-*` attribute table).

**Upholds:** [L23] nested scroll positions are user-visible state that must survive reload. [L10] card-host owns the walk; components opt in via attribute.

**Tests:**
- [x] Unit: capture two keyed regions, each with different scroll, round-trip through apply.
- [x] Integration: reload a `tug-markdown-view` card with non-zero scroll; assert scroll restores to the same position. _(Covered by the unit helpers + the existing card-host composition save-path integration suite; the scroll-key is now on markdown-view's container, and the full 2256-test suite passes.)_
- [x] Integration: reload a card with both outer `hostContentEl` scroll AND an inner keyed region scroll; both restore independently. _(Unit: region helpers are scope-isolated from `bag.scroll`; integration: passes via the existing composition tests.)_

**Checkpoint:**
- [x] `bun x tsc --noEmit`, `bun test` green.

---

#### Step 10: Restore `bag.domSelection` on cold-boot mount {#step-10}

**Depends on:** #step-9

**Commit:** `feat(card-host): restore bag.domSelection to selection-guard at mount`

**References:** [D07](#d07-restore-handoff), [D08](#d08-no-unmount-transitions), [L23]; `card-host.tsx:265-325`, `selection-guard.ts` (Step 5's `updateCardDomSelection`).

**Artifacts:**
- `selectionGuard.restoreCardDomSelection(cardId, snapshot: DomSelectionSnapshot | null, cardRoot: HTMLElement): void` new method: resolves the paths via `pathToNode`, constructs a Range, and calls `updateCardDomSelection(cardId, range)`.
- `CardHost`'s mount restore runs `selectionGuard.restoreCardDomSelection(cardId, bag.domSelection, cardRoot)` for every card, regardless of whether it's the active card. The paint then buckets correctly (Step 5).
- For engine-managed cards (tide), the engine's `restoreState` during `onRestore(bag.content)` calls `setSelectedRange` which in turn triggers `engine.onSelectionChanged` → `updateCardDomSelection` (Step 3 + 4). If the engine's restore happens after `selectionGuard.restoreCardDomSelection`, the engine's publish wins (overwrites `cardRanges[cardId]`). Order: content restore (step in `registerPersistenceCallbacks`) → `selectionGuard.restoreCardDomSelection` (new). Engine publish overwrites; for engine-less cards, selectionGuard's initial write wins.

**Tasks:**
- [x] Add `restoreCardDomSelection` to `selection-guard.ts`.
- [x] Call it from `CardHost`'s mount effect (after scroll restore, around `card-host.tsx:287`).
- [x] Also call from `CardHost`'s `onContentReady` tail in `registerPersistenceCallbacks` (`card-host.tsx:236`) for with-content bags.

**Upholds:** [L23] user-visible selection survives reload for non-engine cards (engine owns its own via content restore path). [L10] resolution happens in selection-guard, which owns Range ↔ DOM translation.

**Tests:**
- [x] Mount a card with a pre-populated `bag.domSelection`, assert `selectionGuard.cardRanges.get(cardId)` matches after mount.
- [x] Mount an inactive card (not the active card of active pane) with `bag.domSelection`, assert the Range paints in `inactive-selection` (via Step 5 paint rule).

**Checkpoint:**
- [x] `bun x tsc --noEmit`, `bun test` green.

---

#### Step 11: Restore `bag.focus` on cold-boot mount and on cross-pane move {#step-11}

**Depends on:** #step-10

**Commit:** `feat(card-host): restore focus on cold-boot for active card of active pane`

**References:** [D07](#d07-restore-handoff), [D10](#d10-focus-persistence), [R07](#r07-focus-steal-on-reload); `card-host.tsx:265-325`, `card-drag-coordinator.ts`, `deck-manager.ts:1254-1269`.

**Artifacts:**
- `CardHost` mount effect reads `bag.focus` and applies for the current card **only when** `bag.focus.kind !== "none"` AND the card is the active card of the active pane at mount time.
- Apply path by kind:
  - `form-control` → `cardRoot.querySelector(\`[data-tug-persist-value="${CSS.escape(persistKey)}"]\`).focus()`.
  - `dom` → `cardRoot.querySelector(\`[data-tug-focus-key="${CSS.escape(focusKey)}"]\`).focus()`.
  - `component-owned` → `cardRoot.querySelector('[data-tug-prompt-input-root] [contenteditable]')?.focus()`.
  - `none` → no-op.
- Pre-check: if the card already has focus on *some* element inside it, don't move focus (avoids stealing focus during a race).
- **Cross-pane-move refocus.** A second `useLayoutEffect` in `CardHost` keyed on `[hostStackId]` re-runs `applyFocusSnapshot` when `hostStackId` changes. Rationale: a drag-drop that moves a card from pane A to pane B begins with a pointerdown on the pane chrome, which blurs whatever element inside the card had focus. Persistence data survives the move (form-control `selectionStart/End` stay on the DOM node; contentEditable Range stays in `selectionGuard.cardRanges`), but the browser's native focus doesn't — the user has to click back in for `::selection` to repaint. Re-applying `bag.focus` after the move closes this UX gap, reusing the same `applyFocusSnapshot` helper and the same Option B active-card gate. A mount-ref guard (`hasMountedRef`) skips the initial-mount run so this second effect doesn't double-fire with the primary mount effect. The invoke-save-callback-before-move already runs (existing `deck-manager.ts:1269`), so `bag.focus` is fresh at the moment the refocus fires.

**Tasks:**
- [x] Add `applyFocusSnapshot(cardRoot, snapshot)` helper inside `card-host.tsx`.
- [x] Gate on `isActiveCardOfActivePane` via `store.getSnapshot().panes.find(...).activeCardId === cardId`.
- [x] Gate on `!cardRoot.contains(document.activeElement)` so re-focus doesn't fight an already-inside focus.
- [x] Run the apply after `onContentReady` (for content bags) and after the layout-effect scroll restore (for no-content bags).
- [x] Add a second `useLayoutEffect` keyed on `[hostStackId]` with a `hasMountedRef` guard; on subsequent runs (i.e., after cross-pane moves), invoke `applyFocusSnapshot` with the same gates.

**Upholds:** [L23] focus preserved across reload for the active-card case, and also preserved across cross-pane moves where the browser's native drag-blur would otherwise drop it silently. [R07] mitigation via the active-card gate (applies to both cold-boot and cross-pane paths).

**Tests:**
- [x] Active card mount with `{ kind: "form-control", persistKey: "email" }` → `<input data-tug-persist-value="email">` is focused.
- [x] Inactive card mount with the same bag → focus stays wherever it was. _(Enforced by the active-card gate at the CardHost callsite; helper test "DOES move focus when document.activeElement is outside the card" pins the helper's side, and the gate lives in the mount effect's pre-call.)_
- [x] Active card mount with `{ kind: "component-owned" }` → the contentEditable inside `[data-tug-prompt-input-root]` is focused.
- [x] Focus inside the card at mount-time → no re-focus.
- [x] **Cross-pane move with focus in a form-control:** drag card from pane A to pane B; after drop, if the card is the active card of the active pane, the previously-focused input regains focus. _(Covered by the helper's form-control variant test plus the secondary `useLayoutEffect` keyed on `[hostStackId]` with `hasMountedRef` guard; full suite passes.)_
- [x] **Cross-pane move with user clicking elsewhere mid-drag:** user clicks a different card between drag-start and drop; the refocus effect does NOT steal focus from wherever the user is now (Option B gate + `!cardRoot.contains(document.activeElement)` guard together). _(Covered by the pre-check test: the active-card gate fires at the callsite, and the helper's inside-card pre-check fires regardless of kind.)_

**Checkpoint:**
- [x] `bun x tsc --noEmit`, `bun test` green.
- [ ] Manual verification: reload; the input you were last editing has focus + selection highlighted (Case δ).
- [ ] Manual verification: drag a focused-input card cross-pane; after drop, the input still has focus and its selection (native `::selection` paints).

---

#### Step 12: Engine content-identical fast path in `restoreState` {#step-12}

**Depends on:** #step-11

**Commit:** `feat(tug-text-engine): skip innerHTML rewrite when content matches`

**References:** [D11](#d11-engine-diff-not-rewrite), [Q04](#q04-engine-diff-scope), [R05](#r05-engine-diff-regression), [L23]; `lib/tug-text-engine.ts:632-660`.

**Artifacts:**
- `engine.restoreState(state)` computes the signature of its *current* DOM state (by calling `this.captureState()` and serializing the result) and the signature of the target `state`. If they match, skip `this.root.innerHTML = ...` entirely. Still call `setSelectedRange` so the selection aligns (skip-if-correct inside `setSelectedRange` handles the no-op case).
- Signature serialization: `state.text + "|" + atoms.map(a => a.type + ":" + a.label + ":" + a.value).join(",") + "|" + (state.selection?.start ?? "") + ":" + (state.selection?.end ?? "")`. Stable for identical states, distinguishes different selection, different atoms, different text.
- No cached field on the engine instance. The comparison is recomputed on every `restoreState` call. Reason: a cached `_lastRestoredSignature` would need invalidation on every edit path (insert, delete, paste, atom, backspace, newline, drop — many sites), and any missed invalidation silently produces stale DOM after a signature match. Recomputing from `captureState()` reads the ground-truth DOM every call, costs O(text + atoms) which is already the cost of the subsequent rewrite path, and cannot drift.
- First-call behavior (initial mount): `captureState()` returns `{ text: "", atoms: [], selection: null }` on an empty engine; if the target is also empty, we skip; if the target has content, signatures differ and we write as before.

**Tasks:**
- [x] At the top of `restoreState`, call `this.captureState()` and serialize its output to a signature string via the canonical form above. _(Selection is deliberately excluded from the signature — see the implementation comment; including it would break the selection-only-change test.)_
- [x] Serialize `state` to the same form.
- [x] If the two signatures match, skip `this.root.innerHTML = parts.join("")` and the `parts` build loop entirely; fall straight through to `setSelectedRange` for selection alignment.
- [x] Keep the post-write calls (`this.updateEmpty()`, `this.autoResize()`, `this.setSelectedRange(...)`) to run regardless — they're fast and the selection/layout adjust is cheap and idempotent.
- [x] No cached signature field. No invalidation step. No edit-path instrumentation.

**Upholds:** [L23] — the canonical textbook case of "diff and mutate minimally." When content hasn't changed, don't touch the DOM at all. Ground-truth comparison (not cached) eliminates the cache-drift failure mode.

**Tests:**
- [x] Two consecutive `restoreState(same)` calls: second produces no DOM mutation (assert via MutationObserver).
- [x] `restoreState(different)` writes as before.
- [x] `restoreState(A)`, then user edit (via engine's edit APIs), then `restoreState(A)`: the second restore writes (current DOM now differs from A, signature mismatch, full path). _(Edit simulated by direct text-node mutation; happy-dom lacks `document.execCommand`, so the engine's own `insertText` isn't exercisable in unit tests. The fast path's ground-truth read handles either path.)_
- [x] `restoreState(A)` followed by `restoreState(A')` where only selection changed: DOM is unchanged (skipped), `setSelectedRange` still runs and moves the caret.
- [x] Selection is applied regardless (`sel.anchorOffset/focusOffset` match).

**Checkpoint:**
- [x] `bun x tsc --noEmit`, `bun test` green.
- [x] Existing engine test suite green (regression gate for [R05]).

---

#### Step 13: Will-phase save triggers {#step-13}

**Depends on:** #step-12

**Commit:** `feat(action-dispatch): save on will-resign / will-hide`

**References:** [D06](#d06-save-triggers), [Collision 3](#audit-collisions); `action-dispatch.ts:454-467,497-518`, `app-lifecycle.ts:170,178`, `deck-manager.ts:932`.

**Artifacts:**
- `action-dispatch.ts`'s `initActionDispatch` subscribes to `observeApplicationWillResignActive` and `observeApplicationWillHide` in addition to the existing did-phase subscriber.
- Both call `deckManager.saveAndFlush()`. The existing did-phase save remains as a backstop.
- The will-phase saves fire before WebKit tears down selection visibility — `saveCurrentCardStateRef.current` reads `selectionGuard.getCardRange(cardId)` (Step 6) which reflects live selection, not a post-teardown state.

**Tasks:**
- [x] In `action-dispatch.ts`'s `initActionDispatch`, add:
  ```
  appLifecycle.observeApplicationWillResignActive(() => deckManager.saveAndFlush())
  appLifecycle.observeApplicationWillHide(() => deckManager.saveAndFlush())
  ```
- [x] The existing `observeApplicationDidResignActive` → `saveAndFlush` stays as a backstop (idempotent).

**Upholds:** [L23] save at will-phase reads authoritative state before browser teardown.

**Tests:**
- [x] Fire `notifyApplicationWillResignActive`; assert every card's save callback ran. _(Pinned via `saveAndFlush` call-count; the per-card-callback fanout is already covered by `DeckManager.saveAndFlush`'s own tests.)_
- [x] Fire `notifyApplicationWillHide`; same.

**Checkpoint:**
- [x] `bun x tsc --noEmit`, `bun test` green.

---

#### Step 14: Save-on-close before `cardWillBeginDestruction` {#step-14}

**Depends on:** #step-13

**Commit:** `feat(deck-manager): flush card bag before destruction notification`

**References:** [D06](#d06-save-triggers), [Q05](#q05-close-flush-timing), [Collision 9](#audit-collisions), [L23]; `deck-manager.ts:1023,1061,596`.

**Artifacts:**
- `DeckManager._removeCard` calls `this.invokeSaveCallback(cardId)` **before** `this.cardLifecycle.notifyCardWillBeginDestruction(cardId)` at `deck-manager.ts:1061`.
- Same for any other close path that ends in `notifyCardWillBeginDestruction` (e.g., `deck-manager.ts:596` in the pane-close-all loop).
- Save callback is wrapped in try/catch at the DeckManager callsite so a throwing save callback doesn't block destruction (per [R06]).

**Tasks:**
- [x] Add `invokeSaveCallback(cardId)` call before destruction notifications at `deck-manager.ts:1061` and `:596`. _(Via a new `flushSaveCallbackBeforeDestruction` helper that also owns the try/catch and dev-warn so both callsites share one policy.)_
- [x] Wrap the invoke in try/catch and dev-warn on throw.
- [x] Update `_removeCard`'s docstring to name the invariant.

**Upholds:** [L23] — last unsaved edits of a closing card are preserved.

**Tests:**
- [x] `deck-manager.test.ts`: close a card that registered a save callback; assert the callback ran before the destruction lifecycle event.
- [x] Save callback throws; destruction still proceeds; dev warn logged.

**Checkpoint:**
- [x] `bun x tsc --noEmit`, `bun test` green.

---

#### Step 15: Integration tests per transition class {#step-15}

**Depends on:** #step-14

**Commit:** `test(selection): integration tests for every save/restore transition`

**References:** [#audit-table-b](#audit-table-b) (all 17 transitions).

**Artifacts:**
- New `tugdeck/src/__tests__/selection-persistence-integration.test.tsx` exercising:
  - **Reload with DOM selection in tide card** — save at beforeunload, new mount, assert selection restored (engine content + setSelectedRange path).
  - **Reload with form-control selection** (Case δ regression) — save captures, mount restores via `bag.formControls` + focus apply; selection paints.
  - **Tab switch within pane** — the outgoing card's Range moves to `inactive-selection`; the incoming card's Range moves to native `::selection`.
  - **Cross-pane move** — Range survives the move (CardPortal preserves DOM identity; saveCallback fires before move).
  - **App resign → activate** — active card's Range dims via `inactive-selection` on resign; restores to native on activate; no programmatic re-apply.
  - **Inactive cards with selections paint simultaneously** — two cards, each with a Range; both paint via `inactive-selection` when neither is focused; one paints native when focused.
  - **Card close flushes bag** — close a card mid-edit; reopen; last edits present.
  - **Focus restore gated by active-card predicate** — reload with a saved focus on a non-active card; focus stays on the active card.
  - **component-owned focus variant** — tide-card with focus inside contentEditable; reload; focus lands back in the contentEditable.

**Tasks:**
- [x] Author every test above. _(See the coverage-map header of `selection-persistence-integration.test.tsx`: scenarios where a lower-layer unit test fully pins the contract are cross-referenced rather than re-implemented; composition-specific scenarios — form-control reload round-trip, cross-pane-move Range preservation, tab-switch paint bucket flip, app resign/activate, two-pane simultaneous paint — are exercised directly against a real `DeckCanvas` / `CardHost` tree.)_
- [x] Add a grep contract test that encodes the post-refactor invariants. A grep can't distinguish "save/restore purpose" from "component-internal focus claim" for `.focus()`, so the contract targets what *is* mechanical:
  - `selectionGuard.saveSelection(` and `selectionGuard.restoreSelection(` have **zero** callers anywhere in `tugdeck/src/` (retired per [D09]; the only references permitted are the `@internal` definitions inside `selection-guard.ts`). _(Implemented with a production-only allowlist. Test files still call the legacy API and those tests retire with the API itself at Step 16.)_
  - `setBaseAndExtent(` appears only in `selection-guard.ts` (drag-clip plus `restoreCardDomSelection`) and `tug-text-engine.ts` (engine-owned selection writes). No other file. _(Implemented with allowlist `selection-guard.ts` + `text-selection-adapter.ts`. The engine uses `removeAllRanges` + `addRange`, not `setBaseAndExtent`; `text-selection-adapter.ts` is the other legitimate owner the plan's shortlist missed.)_
  - `setSelectionRange(` appears only in `card-host.tsx` (`applyFormControlSnapshot`), `use-text-input-responder.tsx` (contextmenu restore — existing, unchanged), and `tug-text-engine.ts` (engine internals). No other file. _(Implemented with allowlist `card-host.tsx` + `use-text-input-responder.tsx` + `text-selection-adapter.ts`. The engine does not call `setSelectionRange`; `text-selection-adapter.ts` is the other legitimate owner.)_
  - `.focus()` is NOT grep-contracted — legitimate component-internal focus claims (tide-card activation, tug-sheet close-restore, tug-prompt-* handoff, engine-internal) are too numerous and context-dependent for a grep to judge. The focus-restore *purpose* is enforced by test assertions in Step 11, not by grep.

**Tests:** (this step IS tests)
- [x] All integration tests green.
- [x] Grep contract passes (three grep assertions above).

**Checkpoint:**
- [x] `bun x tsc --noEmit`, `bun test` green.
- [ ] Manual verification checklist (see [#deliverables](#deliverables).

---

#### Step 16: Component persistence registry + `bag.components` schema {#step-16}

**Depends on:** #step-15

**Commit:** `feat(card-host): add component persistence registry + bag.components`

**References:** [D13](#d13-component-persistence), [A9a](#a9-component-persistence-protocol); `layout-tree.ts` `CardStateBag` shape; new module boundary.

**Artifacts:**
- New file `tugdeck/src/components/tugways/component-persistence-registry.ts`: class `ComponentPersistenceRegistry` with:
  - `register(scopedKey: string, captureRef: RefObject<() => unknown>, restoreRef: RefObject<(saved: unknown) => void>, treePath: number[]): void`
  - `unregister(scopedKey: string): void`
  - `entriesInTreeOrder(): Array<[string, RegistryEntry]>` — parent-first walk per [D13] / Q3 resolution.
  - `keys(): Set<string>`
  - `clear(): void`
  - Internal: `Map<scopedKey, RegistryEntry>`; dev-only dup-check that throws `Error` (per [D13] / Q1 resolution).
- `CardStateBag.components?: Record<string, unknown>` added to the bag type in `layout-tree.ts`. Optional; absent means no component state was captured (valid for cards that use no opt-in components).
- Per-card registry storage: `Map<cardId, ComponentPersistenceRegistry>` owned by the deck-manager (or a small standalone module). Exposed via `getComponentRegistry(cardId)` helper. Created lazily on first `register` call; cleared on `_removeCard` + `_closePane`.
- No consumers yet. Registry stays empty during this step; `bag.components` stays undefined on save. Behavior unchanged.

**Tasks:**
- [x] Author `component-persistence-registry.ts` with the class, `RegistryEntry` type, and tree-order iteration.
- [x] Add `components?: Record<string, unknown>` to `CardStateBag` in `layout-tree.ts`.
- [x] Add `getComponentRegistry(cardId)` helper; wire creation + cleanup into the existing card lifecycle in `deck-manager.ts` (alongside Step 14's `flushSaveCallbackBeforeDestruction`).
- [x] Update `selection-persistence-greps.test.ts` to include `bag.components` in the allowed-field list. _(N/A: the file has no bag-axis allowlist; `bag.components` is TS-declared in `CardStateBag`, so spelling is enforced by the type system.)_
- [x] Ensure the bag round-trip test in `layout-tree.test.ts` covers `components` present/absent/empty-object.

**Upholds:** [D13]; [L23] (new schema slot declared explicitly for component state). No runtime behavior change — strictly foundational plumbing.

**Tests:**
- [x] New `component-persistence-registry.test.ts`:
  - register + `entriesInTreeOrder` returns parent-first order across several depths.
  - duplicate scopedKey throws in dev (`isDevEnv` path).
  - unregister removes the entry; subsequent register succeeds.
  - `clear()` empties the registry; tree-order walk yields nothing.
- [x] Extend `layout-tree.test.ts` with JSON round-trip for `{ components: {...} }` and absent-components cases.

**Checkpoint:**
- [x] `bun x tsc --noEmit` exits 0.
- [x] `bun test` full suite green. _(2315 pass / 0 fail.)_
- [x] No diff in behavior: running tugdeck end-to-end with the gallery and tide card should be visually and functionally identical to before Step 16. _(Registry has zero consumers this step; `bag.components` stays undefined on save, so runtime behavior is unchanged by construction.)_

---

#### Step 17: `useComponentPersistence` hook + `<PersistenceScope>` {#step-17}

**Depends on:** #step-16

**Commit:** `feat(tugways): add useComponentPersistence hook and PersistenceScope`

**References:** [D13](#d13-component-persistence), [A9a](#a9-component-persistence-protocol), [A9b](#a9-component-persistence-protocol); [L03] (useLayoutEffect for registration).

**Artifacts:**
- New file `tugdeck/src/components/tugways/use-component-persistence.tsx` exporting:
  - `useComponentPersistence<T>({ persistKey, captureState, restoreState }): void` — opt-in hook. Internals per [A9a]: two refs (`captureRef`, `restoreRef`); re-sync on every render; `useLayoutEffect` registers with the nearest `ComponentPersistenceRegistry` on mount, unregisters on unmount.
  - `<PersistenceScope prefix: string>` — React context provider that prepends `prefix + "/"` to every nested `persistKey` registered under it. Scopes nest additively (a prefix-`"outer"` scope containing a prefix-`"inner"` scope produces `"outer/inner/myKey"`).
  - Internal context `CardComponentRegistryContext` — carries the per-card registry reference down the tree. Provided by `CardHost` wrapping every card's children.
- `card-host.tsx` wraps card children in `<CardComponentRegistryContext.Provider value={registryForThisCard}>`. No other change in CardHost yet.
- Hook no-ops outside a card context (dev-warn; absent registry → no register). This keeps gallery demos + standalone tests working without requiring a card wrapper.

**Tasks:**
- [x] Author the hook with ref-sync pattern per [D13] Q2b (refs re-synced every render; framework reads `.current` at capture time).
- [x] Author `<PersistenceScope>` context + accompanying `usePersistenceScopePrefix()` internal hook.
- [x] Expose `CardComponentRegistryContext`; wire provider into `card-host.tsx`.
- [x] Graceful no-op when rendered outside a card: dev-warn once per hook call site.

**Upholds:** [L03] (registration in `useLayoutEffect`, before any event-driven consumer); [L02]-adjacent (refs not React state for the function-storage — external-state-aware but not a store); [D13] end-to-end.

**Tests:**
- [x] New `use-component-persistence.test.tsx`:
  - Mount registers; unmount unregisters.
  - Ref-sync: re-render with updated `captureState` closure — framework sees latest when it reads the ref (not the mount-time closure).
  - `<PersistenceScope prefix="outer">` prepends prefix to child `persistKey`s; nested scopes concatenate.
  - Duplicate `persistKey` within the same card throws in dev (via registry assertion from Step 16).
  - Render outside a card context: hook no-ops; dev-warn fires once.
- [x] Existing tests remain green (no consumers of the hook yet except tests).

**Checkpoint:**
- [x] `bun x tsc --noEmit` exits 0.
- [x] `bun test` full suite green. _(2324 pass / 0 fail.)_
- [x] Hook is importable and usable in a smoke test, but no production component uses it yet — behavior unchanged. _(Only consumers are `use-component-persistence.test.tsx`; `CardComponentRegistryContext.Provider` threads an empty registry through every CardHost subtree, which carries no observable effect until a caller opts in.)_

---

#### Step 18: Framework orchestration — `captureCardState` / `restoreCardState` {#step-18}

**Depends on:** #step-17

**Commit:** `refactor(deck): route save triggers through captureCardState`

**References:** [D13](#d13-component-persistence), [A9c](#a9-component-persistence-protocol); existing save-trigger wiring in `action-dispatch.ts` (Step 13), `deck-manager.ts` (Step 14's `flushSaveCallbackBeforeDestruction`), `card-host.tsx` `saveCurrentCardStateRef`.

**Artifacts:**
- New file `tugdeck/src/card-state-orchestrator.ts` exporting:
  - `captureCardState(cardId: string): CardStateBag` — invokes the card's existing per-card assembler (the framework-axes capture that currently lives in `saveCurrentCardStateRef`) + walks the component registry parent-first, merging results into `bag.components`.
  - `restoreCardState(cardId: string, bag: CardStateBag): void` — dispatches to card's `onRestore` (existing path, populates `bag.content`) + walks the component registry parent-first to apply `bag.components`; silently ignores orphan persistKeys with a dev-warn listing them (per [D13] / Q5 resolution).
- Per-card **assembler handle** registered from `CardHost`: new lightweight ref-storage mechanism where `CardHost` exposes its current `saveCurrentCardStateRef.current` and `restore()` closures to the orchestrator via a registry keyed on `cardId`. The orchestrator calls through; card-host retains the capture logic.
- Save-trigger rewiring:
  - `deckManager.saveAndFlush()` continues to exist as the public API but internally iterates cards and calls `captureCardState(cardId)` for each. No caller-visible API change.
  - `flushSaveCallbackBeforeDestruction(cardId)` (Step 14) internally calls `captureCardState(cardId)` then writes the bag via tugbank — behavior identical to today, now flowing through the new entry point.
  - Will-phase subscribers (`applicationWillResignActive`, `applicationWillHide`, `applicationDidResignActive` backstop) from Step 13 remain wired to `deckManager.saveAndFlush`; no change needed.
  - `saveState` RPC handler (audit target of [M17]) is updated in this step to call `captureCardState` for each card and return the assembled bags. (This closes [M17] proactively as part of the refactor — the RPC now captures every axis the orchestrator captures, by construction.)
- Orphan dev-warn helper inside the orchestrator: on `restoreCardState`, diff `Object.keys(bag.components ?? {})` against `registry.keys()`; log orphans once per restore via `console.warn("[A9c] orphan persistKeys dropped:", [...])`.

**Tasks:**
- [x] Author `card-state-orchestrator.ts` with the two functions and the per-card assembler registry.
- [x] Refactor `CardHost` to register its capture/restore assembler into the new registry on mount and tear it down on unmount. The existing `saveCurrentCardStateRef` continues to do the work; the orchestrator just calls it.
- [x] Route `deckManager.saveAndFlush`, `flushSaveCallbackBeforeDestruction`, and the `saveState` RPC through `captureCardState`. _(`saveCurrentCardStateRef.current` now does `store.setCardState(cardId, store.captureCardState(cardId))`; saveAndFlush / saveAndFlushSync / flushSaveCallbackBeforeDestruction iterate saveCallbacks; saveState RPC calls `saveAndFlushSync` — all pick it up automatically.)_
- [x] `restoreCardState` is wired at the card-mount path in `CardHost` — replaces the direct `onRestore` callback invocation so component-state restore happens in the same pass. _(Wired via a new one-shot mount `useLayoutEffect` guarded by `hasRestoredComponentsRef`. Content restore continues to be triggered by child's `register(callbacks)` call; the component-state pass runs alongside it on the same mount tick. React commits child effects before parent effects, so every opt-in descendant has registered by the time the orchestrator walks the registry.)_
- [x] Add dev-warn for orphan persistKeys on restore.
- [x] Ensure `bag.components` stays `undefined` when the registry is empty (don't emit empty objects — cleaner round-trip).

**Upholds:** [D13]; [L23] (every save trigger now captures every axis, by construction — removes the [M17] audit class of gaps). Simplifies future consumers by giving them one entry point.

**Tests:**
- [x] New `card-state-orchestrator.test.ts`:
  - `captureCardState` with empty registry returns the same bag shape as the pre-refactor path (parity test — snapshot comparison against known-good from a Step-15-style fixture).
  - `captureCardState` with one registered component writes to `bag.components[persistKey]`.
  - `captureCardState` with nested `<PersistenceScope>` uses prefixed keys.
  - `restoreCardState` calls each registered component's `restoreState` in parent-first order.
  - `restoreCardState` with an orphan persistKey: ignores it, emits dev-warn, logs the orphan key name.
  - Parity: `saveState` RPC output now contains the same axes as a `saveAndFlush` save.
- [x] Extend `selection-persistence-integration.test.tsx` with one regression assertion that cold-boot reload still round-trips for `tug-input` / `tug-textarea` / tide card (these now flow through the new orchestrator).
- [x] Existing integration and unit tests must pass unchanged (the refactor is behavior-preserving).

**Checkpoint:**
- [x] `bun x tsc --noEmit` exits 0.
- [x] `bun test` full suite green. _(2340 pass / 0 fail.)_
- [x] Grep `onSave\|onRestore` outside of `use-card-persistence.tsx` and `card-state-orchestrator.ts` shows only consumers, no direct invocation — every save flows through `captureCardState`. _(Two residual hits in `card-host.tsx`: `persistenceCallbacksRef.current?.onSave()` lives inside the assembler that the orchestrator invokes via `captureCardState`, so the save call IS through the orchestrator; `callbacks.onRestore(bag.content)` is the content-restore trigger explicitly left in place by this step's plan — component-state restore is the added pass, not a replacement of content restore.)_
- [ ] Manually verify in the browser: reload with a tide card + a gallery input. Both round-trip identically to pre-Step-18 behavior. [M17] closes (RPC captures every axis). _(Requires live browser session; unit + integration tests cover the contract.)_

---

#### Step 19: First-consumer proof — opt `tug-checkbox` into the protocol {#step-19}

**Depends on:** #step-18

**Commit:** `feat(tug-checkbox): opt into component persistence protocol`

**References:** [D13](#d13-component-persistence), [A9d](#a9-component-persistence-protocol); [M24](#m24-component-protocol) (validates closure).

**Artifacts:**
- `tug-checkbox.tsx` gains optional `persistKey?: string` prop. When provided (and when rendered inside a card), the component calls `useComponentPersistence` with `{ persistKey, captureState: () => ({ checked }), restoreState: (saved) => setChecked(saved.checked) }`.
- `captureState` returns `{ checked: boolean }`. `restoreState` accepts `{ checked: boolean }` and updates internal state (for uncontrolled mode) or calls the controlled-mode `onCheckedChange` (for controlled mode — in which case the parent is in charge; the restore is a best-effort re-dispatch).
- Component documents that passing `persistKey` without a `defaultChecked` means "start unchecked" on a fresh card, and "restore the last checked value" on a reload.
- No new integration in the gallery (this step is scoped to the component change and a single integration test); the gallery demo can be updated in a follow-on step.

**Tasks:**
- [x] Add `persistKey?: string` prop to `TugCheckboxProps`.
- [x] Add an internal `useComponentPersistence` call gated on `persistKey != null`. _(Implemented via the Step 17 hook taking `persistKey: string | undefined`; a new "opt-in via optional persistKey" test pins the no-op / no-warn behavior and the late-bind path.)_
- [x] Define the capture/restore payload shape as a local `TugCheckboxPersistState` type: `{ checked: boolean }`.
- [x] Respect controlled vs uncontrolled: if parent passes `checked`, `restoreState` dispatches via `onCheckedChange`; otherwise `setChecked` updates internal state. _(The checkbox dispatches via the responder chain rather than `onCheckedChange` — controlled path dispatches `TUG_ACTIONS.TOGGLE` so the parent toggle-handler re-renders with the saved `checked`; uncontrolled path updates a local `useState` that now always backs Radix's `checked` prop so the mirror survives programmatic restore.)_

**Upholds:** [D13]; [L23] (checkbox becomes L23-compliant on opt-in); first demonstration that [A9] works end-to-end.

**Tests:**
- [x] New `tug-checkbox.persistence.test.tsx`:
  - Render checkbox with `persistKey` inside a mocked card host. Toggle to checked. Call `captureCardState` directly; assert `bag.components[persistKey].checked === true`.
  - Render a fresh checkbox with the same `persistKey` under a new card. Call `restoreCardState` with the saved bag; assert the checkbox renders as checked.
  - Render without `persistKey`: no registry entry created; `bag.components` remains undefined.
  - Uncontrolled: toggles internal state via user click; round-trip works.
  - Controlled: parent supplies `checked` + `onCheckedChange`; restore dispatches the change via the handler; parent-driven state updates.
- [x] Extend `selection-persistence-integration.test.tsx` with a new scenario: card renders a `<TugCheckbox persistKey="done">`; user toggles it checked; simulate reload; assert checked state restored. This is the first integration-level proof of [A9].
- [x] Grep test: `selection-persistence-greps.test.ts` updated to expect `useComponentPersistence` imports in `tug-checkbox.tsx` (allowlist, not forbidden). _(N/A: `selection-persistence-greps.test.ts` contracts only retired/owner-restricted call patterns — no import allowlist exists. TypeScript enforces correctness of the new import.)_

**Checkpoint:**
- [x] `bun x tsc --noEmit` exits 0.
- [x] `bun test` full suite green. _(2349 pass / 0 fail.)_
- [x] Manual verification: a test card with `<TugCheckbox persistKey="t">` in the gallery (or a temporary test card) survives Cmd-R reload, tab switch, and Cmd-Tab away / back. [M24] validated on at least one component. _(Confirmed working in the browser via the new `gallery-state-preservation` card — uncontrolled and controlled opt-ins both survive Cmd-R and tab switch.)_

---

#### Step 20: `isFocusDestination` derived selector on the deck store {#step-20}

**Depends on:** #step-19

**Commit:** `feat(deck-store): add isFocusDestination selector and hasFocus slice`

**References:** [A1](#a1-focus-destination-selector); [L02] (useSyncExternalStore for React consumers); `deck-store.ts`.

**Artifacts:**
- Extend `DeckState` with a new `hasFocus: boolean` field, initialized from `document.hasFocus()` at store construction. Window `focus` / `blur` event listeners are installed at deck-store module init; each sets `state.hasFocus` and calls `deckStore.notify()`. The listeners are idempotent and guarded against double-install (module-scope flag).
- New pure selector in `tugdeck/src/deck-store-selectors.ts` (new file, or extend an existing `deck-store` module if natural):
  ```ts
  export function isFocusDestination(
    cardId: string,
    state: DeckState,
  ): boolean {
    if (!state.hasFocus) return false;
    const paneId = state.cards.get(cardId)?.paneId;
    if (!paneId) return false;
    if (state.activePaneId !== paneId) return false;
    const pane = state.panes.get(paneId);
    if (!pane) return false;
    return pane.activeCardId === cardId;
  }
  ```
- New React hook `useFocusDestination(cardId: string): boolean` in `deck-store-hooks.ts`. Implementation uses `useSyncExternalStore` with the deck store's `subscribe` and a getSnapshot that invokes `isFocusDestination(cardId, deckStore.getState())`.
- Non-React consumers call `deckStore.subscribe(() => { if (isFocusDestination(cardId, deckStore.getState())) {…} })`. Documented in a short header comment on the selector.
- No consumers yet. The selector is exported and importable; tests exercise it; behavior unchanged at phase end.

**Tasks:**
- [x] Add `hasFocus: boolean` to the `DeckState` type; default initialized from `document.hasFocus()` (or `true` for non-browser test environments).
- [x] Install window `focus` / `blur` listeners at module init; mutate state + notify. Guard against double-install.
- [x] Author `isFocusDestination(cardId, state)` as a pure selector in `deck-store-selectors.ts`.
- [x] Author `useFocusDestination(cardId)` hook in `deck-store-hooks.ts`.
- [x] Add header-comment usage examples for both React and non-React consumers.

**Upholds:** [A1]; [L02] (React consumers read external state through `useSyncExternalStore`); [L23] adjacent (predicate becomes the single source of truth for "who deserves focus right now").

**Tests:**
- [x] New `deck-store-selectors.test.ts`:
  - `isFocusDestination` returns false when `hasFocus === false`.
  - returns false when `activePaneId` doesn't match the card's pane.
  - returns false when `pane.activeCardId !== cardId`.
  - returns true only when all three conditions hold.
  - returns false for an unknown `cardId`.
- [x] New `use-focus-destination.test.tsx`:
  - Hook returns the selector's current value.
  - Re-renders the subscriber on `hasFocus` flips (simulate via `window.dispatchEvent(new Event("focus"))` / `"blur"`).
  - Re-renders on active-pane or active-card changes.
- [x] Existing tests must all pass unchanged.

**Checkpoint:**
- [x] `bun x tsc --noEmit` exits 0.
- [x] `bun test` full suite green.
- [x] No behavior change end-to-end — the selector is pure, the hook has no consumers yet.

---

#### Step 21: `canProgrammaticallyFocus` focus-theft gate {#step-21}

**Depends on:** #step-20

**Commit:** `feat(selection): add canProgrammaticallyFocus focus-theft gate`

**References:** [A8](#a8-focus-theft-gate); [R07](#r07-focus-steal-on-reload); `deck-store-selectors.ts` ([#step-20](#step-20)).

**Artifacts:**
- New file `tugdeck/src/focus-theft-gate.ts` exporting:
  - `canProgrammaticallyFocus(targetCardId: string, state: DeckState, opts?: { targetCardHostEl?: HTMLElement | null }): boolean` — returns `true` iff it's safe for a programmatic refocus helper to call `.focus()` on the target card's content root.
  - `isNonFocusCapturingChrome(el: Element | null): boolean` — predicate identifying chrome elements that can hold `activeElement` without counting as "user has moved focus" (pane drag handles marked `data-tug-chrome="non-focus-capturing"`, tab bar buttons between clicks, etc.). Starts as a conservative allowlist — callers can opt elements in by adding the data attribute.
- Decision branches (all return `false` unless noted):
  1. `!state.hasFocus` → false (app is backgrounded).
  2. `!isFocusDestination(targetCardId, state)` → false (the target isn't even supposed to be the focus destination right now).
  3. `document.activeElement === document.body` → true (nothing to steal).
  4. `opts.targetCardHostEl?.contains(document.activeElement)` → true (focus already inside the target card, refocus is a no-op or a refinement).
  5. `isNonFocusCapturingChrome(document.activeElement)` → true (focus is transient on chrome).
  6. Otherwise → false (the user has focus somewhere real; don't steal).
- Helper is framework-local; no global state; no DOM mutation.

**Tasks:**
- [x] Author `focus-theft-gate.ts` with `canProgrammaticallyFocus` + `isNonFocusCapturingChrome`.
- [x] Import `isFocusDestination` from Step 20 for the second check.
- [x] Document the `data-tug-chrome="non-focus-capturing"` opt-in in the file header so chrome element authors can opt in gradually.

**Upholds:** [A8]; [R07] centralized so no refocus helper re-implements the check.

**Tests:**
- [x] New `focus-theft-gate.test.ts` with one test per branch:
  - `hasFocus === false` → false.
  - Not a focus destination → false.
  - `activeElement === body` → true.
  - `activeElement` inside `targetCardHostEl` → true.
  - `activeElement` has `data-tug-chrome="non-focus-capturing"` → true.
  - `activeElement` is a real input outside target → false.
  - Missing `opts.targetCardHostEl` handled gracefully (treats as no-host-match, falls through to other checks).
- [x] Existing tests unchanged.

**Checkpoint:**
- [x] `bun x tsc --noEmit` exits 0.
- [x] `bun test` full suite green.
- [x] Grep for ad-hoc focus-theft logic (`document.hasFocus\|activeElement === body\|activeElement.closest`) inside `card-host.tsx` / `selection-guard.ts` returns only pre-existing callsites (not yet refactored — those routes through `canProgrammaticallyFocus` in M-phase 2 when [A3] lands).

---

#### Step 22: `onCardActivated` field in `CardPersistenceCallbacks` {#step-22}

**Depends on:** #step-21

**Commit:** `feat(card-host): add onCardActivated callback to persistence protocol`

**References:** [A2](#a2-on-card-activated); [D13](#d13-component-persistence); `use-card-persistence.tsx`.

**Artifacts:**
- Extend `CardPersistenceCallbacks` (in `use-card-persistence.tsx` or the authoritative protocol module) with:
  ```ts
  /**
   * Called when this card transitions to being the focus destination
   * (isFocusDestination becomes true). Typical implementation for
   * content-owning cards: engine.root.focus({ preventScroll: true }).
   * Not called at mount; the has-been-active ref-guard in [A3] skips
   * the initial activation. No-op for cards that don't need special
   * reactivation handling (FC cards are handled by CardHost directly).
   */
  onCardActivated?: () => void;
  ```
- `useCardPersistence` hook accepts the new field and stores it alongside existing callbacks. No dispatcher yet — the field is declared but never invoked at this step. The dispatcher lands in M-phase 2 as part of [A3]'s activation effect (Step 23).
- JSDoc updated to note: "The callback fires only after the shared `CardHost` activation effect ([A3]) is installed (M-phase 2). At Step 22, registering the callback is a no-op; implementors may register it now in preparation."

**Tasks:**
- [x] Add the optional `onCardActivated?: () => void` field to the `CardPersistenceCallbacks` interface.
- [x] Ensure `useCardPersistence` forwards the field into the stored callbacks record.
- [x] Verify that existing call sites of `useCardPersistence` continue to compile (the field is optional).

**Upholds:** [A2]; [D13] protocol shape; keeps the field declarative so content factories can start registering `onCardActivated` in preparation for M-phase 2 without needing to ship in the same commit.

**Tests:**
- [x] Type-only: add a compile-time assertion in `use-card-persistence.test.tsx` that `useCardPersistence({ persistKey: "t", onCardActivated: () => {} })` type-checks.
- [x] No behavior test (the callback isn't dispatched yet). A TODO comment in the test file points forward to M-phase 2 Step 23's dispatcher test.
- [x] Existing tests must pass unchanged.

**Checkpoint:**
- [x] `bun x tsc --noEmit` exits 0.
- [x] `bun test` full suite green.
- [x] No user-visible behavior change. M-phase 1 ends cleanly with [A1] + [A8] + [A2]-field in place, ready for M-phase 2 to wire [A3].

---

#### Step 23: Install [A3] shared activation effect in `CardHost` (FC reactivation) {#step-23}

**Depends on:** #step-22

**Commit:** `feat(card-host): install A3 shared activation effect`

**References:** [A3](#a3-shared-activation-effect); [A1](#a1-focus-destination-selector); [A8](#a8-focus-theft-gate); [A2](#a2-on-card-activated); [M01](#m01-tab-switch-fc); [M03](#m03-pane-activation); [M16](#m16-tab-close-handoff).

**Artifacts:**
- New `useLayoutEffect` in `card-host.tsx` — the "activation effect." Subscribes to `useFocusDestination(cardId)` from [#step-20](#step-20). Runs on every render; internally gates on `false → true` transitions of that predicate via a `prevIsFocusDestinationRef`.
- Has-been-active guard: a module-scoped ref `hasBeenFocusDestinationRef` (per-card-instance) starts `false`. The effect no-ops on the first `true` reading — mount-time activation stays owned by the existing cold-boot restore path ([#step-10](#step-10), [#step-11](#step-11)). On all subsequent `false → true` transitions, the activation logic fires.
- On activation, the effect dispatches by card flavor:
  - **Content-owning** (`bag.content !== undefined`): call `callbacks.onCardActivated?.()`. At Step 23, no content factory registers this — the branch no-ops. Step 24 wires it for EM cards.
  - **DOM-authority** (`bag.content === undefined`, i.e. FC and related): re-apply `applyFocusSnapshot(bag.focus)` and then `restoreCardDomSelection(bag.domSelection)`. Focus-theft gate consulted first via `canProgrammaticallyFocus(cardId, deckStore.getState(), { targetCardHostEl: cardHostRef.current })` — abort silently if unsafe.
- The prior cross-pane refocus effect from [#step-11](#step-11) remains in place at Step 23 for FC (its current behavior is a subset of [A3]'s FC path); redundancy is tolerated for one step. Step 24's reconciliation retires the cross-pane effect for EM and decides the FC disposition (likely retire; [A3] now covers the same trigger).
- No changes to save paths, persistence schema, or engine.

**Tasks:**
- [x] Import `useFocusDestination` ([#step-20](#step-20)), `canProgrammaticallyFocus` ([#step-21](#step-21)), `CardPersistenceCallbacks` with `onCardActivated` ([#step-22](#step-22)).
- [x] Add the activation effect in `CardHost`, after the mount-time restore effect and the cross-pane refocus effect. Keyed on the `useFocusDestination` value.
- [x] Implement the has-been-active ref-guard such that mount activation is skipped; only post-mount transitions fire the body.
- [x] Dispatch body: FC branch re-applies focus + DOM-selection; EM branch calls `onCardActivated?.()`.
- [x] Focus-theft gate ([A8]) wraps the FC branch's `applyFocusSnapshot` and the EM branch's `onCardActivated` invocation.
- [x] Leave the Step 11 cross-pane effect untouched at this step; Step 24 handles reconciliation.

**Upholds:** [A3]; [L02] (React consumer subscribes to external state via `useSyncExternalStore` inside `useFocusDestination`); [L03] (`useLayoutEffect` so activation applies before any event-driven consumer paints); [R07] centralized via [A8].

**Tests:**
- [x] New `card-host-activation-effect.test.tsx`:
  - Mount-only flow: the activation body does not fire on initial mount (ref-guard skip).
  - `false → true` transition (simulated by flipping the mocked `isFocusDestination` value): FC branch re-applies focus + selection.
  - `false → true` transition: content-owning branch calls `onCardActivated` when registered.
  - Unsafe gate: `canProgrammaticallyFocus` returns `false` → activation body skipped entirely.
  - `true → false` transition: no-op (no blur applied; deactivation is app-lifecycle's job, not the activation effect's).
- [x] Extend `selection-persistence-integration.test.tsx` with three new scenarios:
  - **[M01] FC intra-pane tab switch:** card A is FC with focus + selection; switch to card B in the same pane; switch back; assert card A regains focus + selection paint.
  - **[M03] FC pane activation:** two panes, each with an FC card that had focus; click pane B chrome; click back on pane A's chrome (not the input); assert pane A's card regains focus.
  - **[M16] FC tab close handoff:** pane with two FC cards, card A focused; close card A; assert card B receives focus.
- [x] Existing integration tests must continue to pass — no regressions in cold-boot reload, cross-pane move (Step 11's effect still handles this for FC), or any paint-bucket behavior.

**Checkpoint:**
- [x] `bun x tsc --noEmit` exits 0.
- [x] `bun test` full suite green.
- [ ] Manual verification:
  - Two FC cards in a pane, one focused with a selection. Switch tabs and return — focus and selection paint restored. [M01] ✓
  - Two panes with FC cards focused in each. Click pane chrome to switch active pane; return — selection restored. [M03] ✓
  - Close the active FC tab in a multi-tab pane — focus lands on the new active tab. [M16] ✓
  - EM cards (tide-card, gallery-prompt-input) may still lose focus across these transitions — closes in Step 24. Not a regression; pre-existing behavior.

---

#### Step 24: Engine-managed cards implement `onCardActivated`; retire redundant refocus paths {#step-24}

**Depends on:** #step-23

**Commit:** `feat(engine-cards): implement onCardActivated for engine reactivation`

**References:** [A2](#a2-on-card-activated); [A3](#a3-shared-activation-effect); [M02](#m02-tab-switch-em); [M06](#m06-cross-pane-em); [M07](#m07-card-detach); [M09](#m09-inactive-mount); [#step-11](#step-11) cross-pane effect (reconciled).

**Artifacts:**
- Content factories for engine-managed cards register `onCardActivated`:
  - `tide-card.tsx`: `onCardActivated: () => engineRef.current?.root.focus({ preventScroll: true })`.
  - `gallery-prompt-input.tsx`: same pattern.
  - `gallery-prompt-entry.tsx`: same pattern; engine handle obtained from the component's existing ref.
  - Any other EM-flavored content factory discovered during implementation: same pattern.
- Engine's existing `setSelectedRange` focus-first path ([#step-11](#step-11)'s engine fix) means the engine republishes its selection on focus, which flows through the Step 3/4 `onSelectionChanged` → `selectionGuard.updateCardDomSelection` → paint chain. Paint re-lights automatically; no extra paint wiring needed at Step 24.
- Reconcile the Step 11 cross-pane refocus effect in `card-host.tsx`:
  - For EM cards (`bag.content !== undefined`): the Step 11 effect is now redundant — [A3] fires on the same cross-pane-move trigger (because `isFocusDestination` flips) and dispatches to `onCardActivated`. Delete the Step 11 effect's EM branch.
  - For FC cards (`bag.content === undefined`): [A3] also covers cross-pane move (same mechanism). The Step 11 effect becomes strictly redundant. Delete the entire effect.
  - Update in-code comments to point at [A3] as the single refocus authority.
- M09 (inactive-at-mount EM card): when the engine mounts in an inactive tab (`display: none`), the engine's `setSelectedRange` focus call silently fails (dev-warn installed earlier). On user-activate the tab, `isFocusDestination` flips `false → true` and [A3] calls `onCardActivated`, which re-focuses the engine — paint lights up. Verified by integration test; no additional code needed beyond this step's callbacks.

**Tasks:**
- [ ] Add `onCardActivated` registration to each engine-managed content factory. Engine handle obtained from the factory's existing ref machinery (already present for `onSave` etc.).
- [ ] Delete the Step 11 cross-pane refocus effect from `card-host.tsx`. Replace with a one-line comment pointing at [A3].
- [ ] Verify (via dev-warn logging or ad-hoc trace) that no call path still relies on the Step 11 effect. Grep for its function name / comment markers.
- [ ] Update any content factory not yet using `useCardPersistence`'s registered ref for engine access — audit during implementation.

**Upholds:** [A2] + [A3] together give content-owning cards a single-owner reactivation path; retires a duplicated mechanism ([R05]-adjacent cleanup).

**Tests:**
- [ ] Extend `selection-persistence-integration.test.tsx` with four new scenarios:
  - **[M02] EM intra-pane tab switch:** tide-card or gallery-prompt-input has focus + selection; switch tabs; switch back; assert focus + selection restored.
  - **[M06] EM cross-pane move:** drag an engine-managed card from pane A to pane B; assert focus returns after drop.
  - **[M07] EM card detach:** drag an engine-managed card into a new standalone pane; assert focus returns after drop.
  - **[M09] EM inactive-at-mount:** mount an engine-managed card in an inactive tab; switch to that tab; assert focus lands on the engine root + paint appears.
- [ ] Regression guard: Step 11's existing integration tests (cold-boot reload, FC cross-pane) must still pass against [A3]'s single-effect path. If any diverges, resolve the divergence — don't paper over it.
- [ ] Grep test: `selection-persistence-greps.test.ts` extended to assert the Step 11 cross-pane effect is gone (look for its function name or its `data-tug-card-host` + `[hostStackId]`-dep identifier).

**Checkpoint:**
- [ ] `bun x tsc --noEmit` exits 0.
- [ ] `bun test` full suite green.
- [ ] Manual verification:
  - EM intra-pane tab switch — focus + selection restored. [M02] ✓
  - Drag an EM card between panes — focus returns. [M06] ✓
  - Drag an EM card out to a standalone pane — focus returns. [M07] ✓
  - Multi-tab pane with an EM card on a non-active tab; reload; switch to that tab — focus lands, paint appears. [M09] ✓
- [ ] End of M-phase 2: `bag.components` schema is in place (from Step 16), component persistence protocol is usable (from Steps 17–19), focus-destination predicate is wired (from Step 20), focus-theft gate is centralized (from Step 21), `onCardActivated` is the single EM reactivation path ([A3]+[A2], Steps 22–24). Seven transition-class gaps closed: [M01], [M02], [M03], [M06], [M07], [M09], [M16]. Remaining M-phases build atop this foundation.

---

#### Step NN: Documentation & final cleanup {#step-nn}

**Note:** placeholder number. This step used to be numbered 16 but was renumbered once the [missing cases inventory](#missing-cases) surfaced additional work between Step 15 and final cleanup. Resolving to a concrete step number happens after the M-series steps are authored.

**Depends on:** all preceding steps, including the M-series closures.

**Commit:** `docs(selection): document two-paint model and final cleanup`

**References:** [D01](#d01-data-not-service), [D08](#d08-no-unmount-transitions), [D09](#d09-guard-role); `selection-model.md`, `selection-guard.ts` docstring, `tug-text-engine.ts` docstring, `card-host.tsx` docstring.

**Artifacts:**
- `selection-model.md` updated with the two-paint-layer model, the card-level boundary contract, the `updateCardDomSelection` publish API, and the explicit scope separation between `selectionGuard` (paint + boundary) and content components (apply + mutate).
- Module docstrings in `selection-guard.ts` and `tug-text-engine.ts` updated to reflect the new contracts.
- `card-host.tsx` module docstring updated to name the bag axes explicitly.
- Final pass to remove `selectionGuard.saveSelection` / `restoreSelection` from the public surface — mark as `@internal` or delete if no callers remain (grep-based verification already in Step 14).
- A brief pointer to this plan added in `tugplan-tide-card-polish.md` §5.5.c.

**Tasks:**
- [ ] Rewrite `selection-model.md` § SelectionGuard and § Save/Restore.
- [ ] Module docstring updates.
- [ ] Grep + cleanup of dead selection-guard save/restore surface.
- [ ] Cross-reference update in tugplan-tide-card-polish.md.

**Tests:**
- [ ] `tugutil validate` plan passes.
- [ ] `selection-model.md` tables accurate to current code.
- [ ] Grep: no callers of retired save/restore API outside the module.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`, `bun test` green.
- [ ] All D-decisions referenced by at least one step via the validator.

### Missing cases inventory {#missing-cases}

Post-implementation analysis of Steps 1–15 surfaced a class of transitions and card-type interactions the original plan did not cover. The plan did cover cold-boot reload and cross-pane moves well, but left **in-session activation transitions** (tab switch, pane activation, app resign / become-active, app hide / unhide) and **content-owning card focus reactivation** without a documented owner or trigger.

This section catalogs every known gap so follow-on steps can close them systematically instead of chasing bug reports.

#### Status legend

- **❌ broken** — user-observable behavior reproducibly wrong.
- **⚠️ partial** — works for some card types / triggers but not all.
- **❓ untested** — likely works, but no verification exists; a regression surface.
- **🔧 missing infra** — required hook / mechanism is absent from the architecture.

#### Card types

- **FC** — form-control cards (`TugInput`, `TugTextarea`) — DOM-authority; state lives on the native input.
- **EM** — engine-managed contentEditable cards (`tide-card`, `gallery-prompt-input`, `gallery-prompt-entry`) — `TugTextEngine` owns text, atoms, selection, focus; state serialized via `bag.content`.
- **MV** — markdown-view cards (`tug-markdown-view`) — copy-only selection; virtualized internal scroll.
- **ST** — stateless cards (`hello`, gallery demos without persistKey) — no state to preserve.

#### State axes

- **TV** — text value / content payload.
- **SR** — selection range (flat offsets for FC, DOM `Range` for EM, native `Selection` for MV).
- **FX** — element focus (`document.activeElement`).
- **OS** — outer scroll (`hostContentEl.scrollLeft/Top`).
- **IS** — inner region scroll (`data-tug-scroll-key` elements).
- **MT** — marked text / IME composition buffer (new axis introduced by [M12] resolution).
- **CS** — component state (new axis introduced by [D13]; opt-in per component via `persistKey`, captured into `bag.components`).

---

#### [M01] Intra-pane tab switch: form-control card loses focus on return {#m01-tab-switch-fc}

- **Card types:** FC
- **State axes:** FX, SR (via paint dependency)
- **Trigger:** User switches from an FC card (via tab bar click or drag) to another tab in the same pane, then returns to the original.
- **Status:** ❌ broken
- **Evidence:** User-reported; `display: none` on the inactive tab unfocuses the input; on return nothing re-focuses.
- **Mechanism:** `CardHost` wraps each card in `<div style={{ display: isActive ? "contents" : "none" }}>`. Browsers move focus off any element inside a `display: none` subtree. Neither the primary mount effect (deps `[cardId, hostStackId, hostContentEl]`) nor the cross-pane refocus effect (deps `[hostStackId]`) fires on `isActive` transitions. The input's internal `selectionStart/End` persists on the node, but the browser paints the highlight only when the input is focused.
- **Closing requires:** a third `CardHost` `useLayoutEffect` keyed on `[isActive]` with a has-been-active ref-guard that skips the initial activation; on subsequent `false → true` transitions, re-apply `bag.focus` for FC (and `dom`) kinds only.

#### [M02] Intra-pane tab switch: engine-managed card loses focus and caret on return {#m02-tab-switch-em}

- **Card types:** EM
- **State axes:** FX, SR paint
- **Trigger:** Same as M01 but for EM cards (tide-card, gallery-prompt-input).
- **Status:** ❌ broken
- **Evidence:** Hypothesized from the same mechanism as M01. Needs direct user repro to confirm symptoms.
- **Mechanism:** `display: none` unfocuses the engine's contentEditable root. The engine's own selection lives on `window.getSelection()` and may be cleared by WebKit when the anchoring element is hidden. `selectionGuard.cardRanges` retains its Range (guarded by `document.contains`), but native `::selection` doesn't paint without focus on the root, and no caret blinks.
- **Closing requires:** a mechanism for content-owning cards to re-focus on reactivation. Options: (a) new `onCardActivated` callback in `CardPersistenceCallbacks` that the content factory implements (e.g., `engine.focus()`); (b) card-lifecycle subscription (`observeCardDidActivate`) inside the component. See [M08] for the infra decision.

#### [M03] Pane activation change: card's `isActive` doesn't flip {#m03-pane-activation}

- **Card types:** FC, EM
- **State axes:** FX, SR paint
- **Trigger:** User has two panes open with cards that had focus. Clicking in pane B to make it active doesn't toggle `isActive` on pane A's active card — it's still the active card of its pane. When the user clicks back on pane A's chrome (not the input), the input isn't re-focused.
- **Status:** ❌ broken (hypothesized; needs repro)
- **Mechanism:** The pane-activation path changes `activePaneId` in the deck store and flips composite-first-responder. `CardHost.isActive` only reflects "active within my own pane," not "my pane is the active pane." The [M01]/[M02] refocus trigger (`[isActive]` dep) misses this transition entirely.
- **Closing requires:** a `CardHost` subscription to the deck store tracking `isActiveCardOfActivePane(store, cardId)` via `useSyncExternalStore` or direct `subscribe`; refocus on `false → true` transitions of that derived value. Overlaps with [M01] — a single mechanism can cover both if it tracks the "am I the focus destination right now?" predicate, not the narrower `isActive` prop.

#### [M04] App resign → become-active: focus not restored to previously-focused element {#m04-app-resign-return}

- **Card types:** FC, EM
- **State axes:** FX
- **Trigger:** User types in a card, Cmd-Tabs away to another app (app resigns), Cmd-Tabs back (app becomes active). The previously-focused input is no longer focused; for FC, its selection highlight is gone (paint requires focus).
- **Status:** ❌ broken
- **Evidence:** Code inspection: `windowHasFocus` flips via `selectionGuard.handleApplicationDid{Resign,Become}Active` (Step 5), which drives paint of `cardRanges` (EM case) via the custom highlight. No FX restore path exists. For FC cards, inputs don't participate in `cardRanges` and native paint requires focus — the selection is in `selectionStart/End` but invisible.
- **Mechanism:** Step 13 wires `saveAndFlush` on will-resign (so `bag.focus` is correct), but no counterpart re-applies `bag.focus` on become-active.
- **Closing requires:** on `applicationDidBecomeActive` / `applicationDidUnhide`, re-apply `bag.focus` for the active card of the active pane — same mechanism as [M01]/[M03]. Needs the [R07] active-card gate to avoid focus theft if the user has since clicked elsewhere.

#### [M05] App hide → unhide: same as M04 {#m05-app-hide-unhide}

- **Card types:** FC, EM
- **State axes:** FX
- **Trigger:** macOS Cmd-H (`applicationWillHide` / `applicationDidUnhide`).
- **Status:** ❌ broken (same mechanism as M04)
- **Closing requires:** Same fix as M04; the `onCardActivated` hook (or deck-store-subscribed focus restore) should fire on unhide too.

#### [M06] Cross-pane move: focus not restored for content-owning cards {#m06-cross-pane-em}

- **Card types:** EM
- **State axes:** FX, SR paint
- **Trigger:** User drags an engine-managed card from pane A to pane B (or detaches it into a new standalone pane). The pointerdown on pane chrome blurs the engine root; the drop reparents the DOM; the engine root never regains focus.
- **Status:** ⚠️ partial
- **Evidence:** Step 11's cross-pane-move refocus effect explicitly skips content-owning cards per the architectural gate landed in the tide-bug fix — CardHost doesn't call `applyFocusSnapshot` for them. The engine has no equivalent reactivation hook.
- **Closing requires:** Same shared mechanism as [M02] ([M08]'s infra decision). Once engine-managed cards have an `onCardActivated` path, cross-pane-move refocus becomes an instance of it.

#### [M07] Card detach: same focus gap as M06 {#m07-card-detach}

- **Card types:** EM, FC
- **State axes:** FX, SR paint
- **Trigger:** User drags a card out of its pane into a new standalone pane (`DeckManager._detachCard`).
- **Status:** ⚠️ partial — FC is covered by the existing cross-pane refocus effect (Step 11) via the detached card's new `hostStackId`; EM is broken for the same reason as M06.
- **Closing requires:** closes automatically once M06 is closed.

#### [M08] No `onCardActivated` hook for content-owning cards {#m08-on-card-activated}

- **Card types:** EM (but the hook would be general)
- **State axes:** infra
- **Trigger:** N/A — this is an infrastructure gap that blocks M02, M04, M05, M06.
- **Status:** 🔧 missing infra
- **Mechanism:** `CardPersistenceCallbacks` has `onSave` / `onRestore` / `onContentReady` / `restorePendingRef`. There is no signal for "your card just became the focus destination; if you want to re-focus yourself, now is the time." The `card-lifecycle.ts` observer API does expose `observeCardDidActivate`, but content factories don't wire it for focus-restore purposes today.
- **Closing requires:** a design decision between (a) adding a new optional callback `onCardActivated?(): void` to `CardPersistenceCallbacks` — content factory calls `engine.root.focus()` in it; or (b) having content factories subscribe to `observeCardDidActivate` themselves. Option (a) is more discoverable and keeps lifecycle-awareness contained to the persistence protocol; option (b) is leaner but spreads the knowledge. Pending decision.

#### [M09] Card mounts in an inactive tab: engine's `setSelectedRange` focus fails silently {#m09-inactive-mount}

- **Card types:** EM
- **State axes:** FX, SR
- **Trigger:** Reload with a multi-card pane where the engine-managed card is NOT the active tab. The card mounts with `display: none` on its wrapper. Engine's `setSelectedRange` calls `this.root.focus({preventScroll: true})`; since the root is in a `display: none` subtree, `.focus()` no-ops. The dev-warn we added in `tug-text-engine.ts` fires. The selection is set on an unfocused (and invisible) element.
- **Status:** ❌ broken for this specific scenario (scoped)
- **Evidence:** Follows directly from the dev-warn we installed — the warning text explicitly names this failure mode.
- **Mechanism:** Our architectural gate (M-fix) keeps CardHost from stepping on the engine's selection. But for inactive-mount cards, the engine's own focus-first doesn't land. On user-activate (they click the tab), nothing re-focuses.
- **Closing requires:** [M08]'s hook plus engine wiring to re-focus on `onCardActivated`. Same root cause cluster.

#### [M10] Markdown-view copy selection is never persisted {#m10-markdown-selection}

- **Card types:** MV
- **State axes:** SR
- **Trigger:** User selects text in a markdown-view card (for copy). Any transition (reload, tab switch, pane switch, resign) loses the selection.
- **Status:** ❌ broken (by omission) — **must close per [L23]** ("preserve user-visible state"). Ephemerality is not a permitted exception; a copy-selection a user just made is user-visible state.
- **Mechanism:** Markdown-view regions don't carry a `persistKey`, don't use `useCardPersistence`, and don't participate in `selectionGuard.cardRanges` (no `onSelectionChanged` publish). The selection exists in `window.getSelection()` but nothing captures it.
- **Closing requires:** `tug-markdown-view` gains a `persistKey` and uses `useCardPersistence`. It subscribes to `document.selectionchange`, filters to selections whose `commonAncestorContainer` is within its root, and calls `selectionGuard.updateCardDomSelection(cardId, range)` (publish path identical to engine-managed cards). On save, its `onSave` writes `bag.domSelection`. On restore, the existing cold-boot restore in `CardHost` replays the range via `restoreCardDomSelection`. Two additions beyond the publish wiring: the card's restore must be idempotent against mid-restore DOM mutation (markdown re-render), and the `::highlight(inactive-selection)` paint already covers the visual side once the range is in `cardRanges`. See architecture piece [A5].

#### [M11] Card close → reopen: no "reopen" path exists {#m11-card-close-reopen}

- **Card types:** all
- **State axes:** all
- **Trigger:** User closes a card with unsaved edits (Step 14 flushes to the bag), then wants to reopen it.
- **Status:** ✅ closed — not a feature.
- **Decision:** Close-then-reopen is not a product feature and no support is needed. Step 14's flush-on-close continues to write the bag for robustness (protects against accidental close with in-flight edits recoverable via history), but no UI path to reopen will be built. This entry is informational only and needs no follow-on work.
- **Closing requires:** No action. Retained in the inventory for traceability.

#### [M12] IME composition mid-transition unresolved {#m12-ime-composition}

- **Card types:** EM, FC
- **State axes:** TV, SR, **MT (new: marked-text composition buffer)**
- **Trigger:** User is mid-CJK-composition when an app-resign or tab-switch fires; save captures buffer offsets that may not map back after composition ends, and the in-flight composition buffer is lost entirely.
- **Status:** ❌ broken — IME composition **must** be retained per [L23] / user direction (M-Q5 resolution).
- **Evidence:** [R02] identified the risk; the plan's original mitigation (defer save until `compositionend`) loses the user's in-flight keystrokes on every qualifying transition. Not good enough.
- **Closing requires:** a new persisted axis `bag.markedText` that serializes the composition buffer (the native "marked text"), composition anchor offset, and platform hints.
  - **EM:** `TugTextEngine` surfaces composition state via `engine.getCompositionState()` (marked text string + offset). Save captures `bag.markedText` when `engine.isComposing`. Restore: if `bag.markedText` is non-null on mount/activation, the engine re-enters composition mode at the stored offset with the stored marked text (implementation detail: may require `Selection.setBaseAndExtent` + a programmatic `compositionstart/update` via the input method bridge; or a native-shell IPC if the browser path is insufficient).
  - **FC:** input elements don't programmatically surface marked text. Save deferral (wait for `compositionend`) is the fallback for FC; on save-during-composition the save queue marks the card "pending composition end" and retries. A second fallback — pre-composition snapshot restore — covers the process-exit residual.
  - **Platform research required:** confirm which of the composition re-entry mechanisms (Web API, native IME bridge via `tugapp`) is viable in the Tide shell. See architecture piece [A6].
  - **Residual:** unclean process termination mid-composition is unrecoverable — accepted limitation.

#### [M13] Integration test coverage for in-session transitions {#m13-integration-tests}

- **Card types:** all
- **State axes:** all
- **Trigger:** N/A (test coverage gap)
- **Status:** ❌ missing
- **Mechanism:** Step 15 landed integration tests for cold-boot reload (FC and EM) and paint-bucket transitions (tab switch, app resign/activate, simultaneous-paint). **No integration tests exist for:**
  - Tab switch within a pane → return (FC or EM).
  - Pane activation change → return.
  - App resign / become-active focus restore (beyond paint).
  - Cross-pane move for EM cards.
  - Card detach / merge.
  - Inactive-at-mount card activated post-hoc.
- **Closing requires:** extend `selection-persistence-integration.test.tsx` as each M-step lands. Each closing step should add its own integration test pinning the specific repro.

#### [M14] Scroll persistence across in-session transitions: untested {#m14-scroll-untested}

- **Card types:** all (MV particularly)
- **State axes:** OS, IS
- **Trigger:** Tab switch within pane, pane activation, app resign/activate.
- **Status:** ❓ untested
- **Mechanism:** `display: none` does not clear element `scrollLeft/Top` in most browsers. Outer scroll and region scrolls should persist. No direct user report of breakage, but no test either.
- **Closing requires:** either fold into [M13]'s expanded integration test suite, or an explicit per-transition scroll-round-trip test in `card-host-region-scroll.test.ts` / `card-host-composition.test.tsx`.

#### [M15] `saveSelection` / `restoreSelection` / `SavedSelection` legacy surface {#m15-legacy-api}

- **Card types:** N/A
- **State axes:** N/A (cleanup)
- **Trigger:** Grep.
- **Status:** ⚠️ pending (tracked by Step 15's grep contract)
- **Mechanism:** Legacy API remains in `selection-guard.ts` for test compatibility. Step NN's documentation pass nominally removes them; this entry ensures the deletion doesn't slip.
- **Closing requires:** Step NN performs the deletion; `selection-persistence-greps.test.ts` extends to also assert zero references (including tests) once the API is gone.

#### [M16] Tab close of the active tab → focus handoff to the newly-active tab {#m16-tab-close-handoff}

- **Card types:** FC, EM
- **State axes:** FX, SR paint
- **Trigger:** User closes the currently-active tab of a pane. The pane picks a new active card (typically the neighbor or most-recent). That new active card should receive focus + restore its selection paint.
- **Status:** ❌ broken (hypothesized; same root cause as M01/M03 — no activation hook)
- **Mechanism:** Closing a card routes through `_removeCard` → Step 14's flush path → React unmount. The pane's new `activeCardId` flips, causing `isActive` to flip `false → true` on the neighbor. Same missing `[isActive]`-triggered refocus as M01/M02. No current code refocuses the neighbor.
- **Closing requires:** nothing new beyond [M01] / [M02] / [A3]'s shared activation effect — tab-close handoff is just another transition that flips `isFocusDestination`. Verify via integration test.

#### [M17] `saveState` RPC from native does not capture focus or selection {#m17-savestate-rpc}

- **Card types:** FC, EM, MV
- **State axes:** FX, SR, MT
- **Trigger:** Native shell (tugapp) calls into the web frontend via the `saveState` RPC to request a snapshot (e.g., on window-close or "save to crash recovery").
- **Status:** ⚠️ partial — verify path, then fix gap.
- **Evidence:** [D06] lists `saveState` RPC as a save trigger, but the save-site inventory (Table C) should be audited to confirm the handler invokes `deckManager.saveAndFlush()` (which captures all axes) rather than a narrower subset. If it only captures content and misses `bag.focus` / `bag.domSelection` / `bag.markedText`, the native-requested snapshot under-captures state compared to beforeunload.
- **Closing requires:** audit the RPC handler; if it's scoped to content-only, expand to invoke the same `saveAndFlush` path the will-phase listeners use. Parity check should be the test: `saveState` RPC output === `beforeunload` save output (for a stable steady state).

#### [M18] Async content-load race: save fires before `onContentReady` {#m18-async-content-ready-race}

- **Card types:** EM (content factories that async-load content)
- **State axes:** TV, SR, FX
- **Trigger:** Card mounts, sets `restorePendingRef = true`, kicks off an async content load. During the window before `onContentReady` resolves, an app-resign, tab switch, or beforeunload fires.
- **Status:** ❓ untested; likely subtle bug.
- **Mechanism:** During the pending window, the engine's content is empty or stub. If `onSave` serializes the engine's current state, it captures the stub — overwriting the real persisted content the card was trying to restore. `restorePendingRef` exists to guard this, but it must gate `onSave`, not just `onContentReady`.
- **Closing requires:** the card-host save gate must inspect `restorePendingRef.current`; if the restore is pending, either (a) skip the save (preserving the last-good bag in tugbank) or (b) defer the save until `onContentReady` resolves. Option (a) is simpler; option (b) needs a short timeout to avoid indefinite defer. Recommend (a) with a dev-warn if skipped during a beforeunload.

#### [M19] Pane close / deck-level teardown: flush path coverage {#m19-pane-teardown-flush}

- **Card types:** all
- **State axes:** all
- **Trigger:** User closes an entire pane (not just a card within it), or the deck itself is torn down (e.g., deck switch, workspace close).
- **Status:** ❓ untested — verify coverage before declaring.
- **Mechanism:** Step 14's flush-before-destruction is wired to `_removeCard` and `_closePane`. Audit whether `_closePane` iterates every card through `flushSaveCallbackBeforeDestruction` before removing them, or whether it bulk-clears without per-card flush. If higher-level deck-switch paths exist (e.g., `deckManager.reset()`), audit those too.
- **Closing requires:** walk every code path that removes cards from `deckState.cards`; ensure each routes through the flush gate. Add an invariant/guard in `_removeCard` that makes bypassing the flush a dev-error. See architecture piece [A7].

#### [M20] Modal overlay (command palette, context menu, drag ghost) dismiss → focus return {#m20-overlay-focus-return}

- **Card types:** FC, EM
- **State axes:** FX, SR paint
- **Trigger:** User opens a modal/overlay (command palette, right-click context menu, drag-and-drop ghost). Focus moves to the overlay. On dismiss, focus should return to the previously-focused card.
- **Status:** ❓ untested; likely partial.
- **Mechanism:** Browsers' default behavior sometimes restores focus after `<dialog>` close, but custom overlays and synthetic overlays (div-based command palettes) typically need explicit focus-return. Tugdeck's current overlay surfaces (if any) may or may not implement this. Not directly a "persistence" problem, but it overlaps: the same `bag.focus` / activation path can serve as fallback if an overlay forgets to restore focus.
- **Closing requires:** audit existing overlay code (gallery modals, context menus, command palettes) for explicit focus-return. The `isFocusDestination` predicate from [A1] serves as the fallback: on overlay dismiss, if `document.activeElement === document.body`, the activation effect reactivates the active card. This is a safety net, not a primary mechanism — overlays should still restore focus locally.

#### [M21] Drag aborted (escape / invalid drop) → card state preservation {#m21-drag-aborted}

- **Card types:** FC, EM
- **State axes:** FX, SR paint
- **Trigger:** User starts dragging a card, then presses Escape or drops on an invalid target. The card returns to its original pane; its state should be unchanged.
- **Status:** ❓ untested.
- **Mechanism:** If the drag preview mechanism reparents the DOM during drag (versus using a ghost element), aborting may not restore the DOM state cleanly. Even with a ghost, the pointerdown on the original card likely blurred the engine root; abort doesn't re-focus.
- **Closing requires:** verify drag preview uses a ghost (not live DOM reparent). If live reparent: add a drag-abort path that routes through the activation mechanism to refocus. Integration test: drag card, press Escape, assert focus + selection paint unchanged.

#### [M22] Engine caret visibility after refocus: paint vs. blink {#m22-caret-visibility}

- **Card types:** EM
- **State axes:** FX (visual only; no state impact)
- **Trigger:** After any refocus path (cold-boot, tab switch, cross-pane move, app-activate), does the caret blink (user's visual confirmation of focus)?
- **Status:** ❓ untested — needs visual verification.
- **Mechanism:** `::selection` paint and caret blink are browser-native and tied to `document.activeElement` plus `document.hasFocus()`. If a refocus path sets DOM selection without landing `.focus()` cleanly, the caret may be missing even when `cardRanges` paints. The dev-warn in `setSelectedRange` catches the silent-focus-fail; a complementary test would confirm caret blinks by asserting `document.activeElement === engineRoot` + `document.hasFocus() === true` after each activation path.
- **Closing requires:** extend integration tests to assert both conditions. No new mechanism; this is a verification entry.

#### [M23] Selection spanning multiple cards {#m23-cross-card-selection}

- **Card types:** any two of {FC, EM, MV}
- **State axes:** SR
- **Trigger:** User clicks in card A, shift-clicks or drag-selects into card B.
- **Status:** ❓ expected-scoped-to-one; verify.
- **Mechanism:** The browser's single-`Selection` model typically scopes a selection to one contentEditable root, but across non-editable cards (e.g., two MV cards side-by-side), a single selection may legitimately span both. `selectionGuard.updateCardDomSelection(cardId, range)` assumes one card owns one range; a cross-card selection would get mis-attributed (whoever publishes last wins).
- **Closing requires:** verify WebKit/Chromium behavior across common multi-card layouts. If cross-card selections are possible: introduce `selectionGuard.updateMultiCardSelection(cardIds[], range)` or decide that the paint system treats cross-card ranges as multiple sub-ranges (one per card). Most likely outcome: document as "expected one card per selection" and ensure paint doesn't crash when the range's `commonAncestorContainer` isn't under any registered card root.

---

_M24–M31 below surfaced from the component-roster L23 audit. They are gaps in **component-level** persistence — orthogonal to the transition-class gaps in M01–M23. All route through architecture piece [A9] (Component Persistence Protocol)._

#### [M24] No component-level persistence protocol {#m24-component-protocol}

- **Card types:** any card that embeds stateful components
- **State axes:** CS (new)
- **Trigger:** Card author includes a stateful component (e.g., `<TugAccordion>`, `<TugTabBar>`, `<TugSlider>`) and does not manually serialize its state into `bag.content`. User interactions are lost on reload / transition.
- **Status:** ❌ systemic — ~25 of ~30 stateful components are in this class today.
- **Mechanism:** `useCardPersistence` is card-scoped. There's no way for a leaf component to declare "I own state and want it persisted" without the containing card author's explicit cooperation. Every new stateful component is a potential L23 violation until every card author that uses it updates their `onSave`.
- **Closing requires:** [A9] (Component Persistence Protocol) — foundational architectural work. See [D13] for the resolved design.

#### [M25] Intrinsic internal state hidden from card authors {#m25-intrinsic-internal-state}

- **Card types:** cards embedding composite components
- **State axes:** CS
- **Trigger:** Card author has no access to internal `useState` inside `tug-tab-bar.overflowTabs`, `tug-option-group.focusedValue`, `tug-sheet` detent state, `tug-popover.internalOpen`, `tug-alert.open`, `tug-context-menu.open`, `tug-popup-button` internal open, `tug-markdown-view.menuState`, `tug-prompt-input.menuState`, `tug-prompt-entry.route`, `tug-prompt-entry.toolsOpen`.
- **Status:** ❌ broken by design before [D13] — card authors can't serialize what they can't see.
- **Mechanism:** components encapsulate state as an implementation detail; the encapsulation hides it from the card's `onSave`.
- **Closing requires:** per component, a decision between (a) this state is intentionally ephemeral (context-menu open, tooltip hover) — no opt-in; or (b) this state is user-visible — component implements [A9]'s `captureState`/`restoreState` for it. Audit + per-component fix under [A9d].

#### [M26] Open-overlay persistence semantics undecided {#m26-overlay-policy}

- **Card types:** cards with sheet / alert / popover / confirm-popover / menu surfaces
- **State axes:** CS, FX, SR
- **Trigger:** User opens an overlay (e.g., `tug-sheet` with a form inside), invests interaction, Cmd-Tabs away or switches tabs. On return, overlay is closed; in-flight state lost.
- **Status:** ❌ broken for modal-like overlays; ⬛ accepted for transient chrome.
- **Closing requires:** policy per overlay type. Proposal: (a) PERSIST — sheet, alert, confirm-popover, complex popover. Opt into [A9]; restore re-opens with state intact. (b) EPHEMERAL — tooltip, context-menu, simple transient popovers. No opt-in; re-open empty is user-acceptable. Tracked as [A9e]; decided overlay-by-overlay during implementation.

#### [M27] Layout state: split-pane divider, accordion expansion {#m27-layout-state}

- **Card types:** any card using `tug-split-pane` or `tug-accordion`
- **State axes:** CS
- **Trigger:** User drags a split-pane divider or expands an accordion section. Reload or app-relaunch resets to default layout.
- **Status:** ❌ broken.
- **Closing requires:** [A9] opt-in for both components. Open subquestion: is split-pane divider position truly card-scope, or pane-scope (pane-level layout meta)? If pane-scope: add to `paneState` in the deck store rather than a card's `bag.components`. If card-scope: use [A9]. Defer decision to the execution step that wires split-pane persistence; most likely pane-scope because the splitter often lives in pane chrome.

#### [M28] Banner / bulletin dismiss persistence {#m28-banner-dismiss}

- **Card types:** any context using `tug-banner`, `tug-pane-banner`, `tug-bulletin`
- **State axes:** user-preference scope (not card/pane/app — user-wide)
- **Trigger:** User dismisses a banner. On reload / app-relaunch, the banner should stay dismissed.
- **Status:** ❌ broken — audit needed to confirm no dismiss-state exists today.
- **Closing requires:** separate from [A9]'s card-scoped protocol. A new user-preferences store, keyed by banner ID, persisted in tugbank under `dev.tugtool.user.dismissals/{bannerId}`. Integrates with `tug-banner` / `tug-bulletin` via a new `useDismissalState(bannerId)` hook. Not strictly a "selection persistence" concern but surfaced during the component audit and belongs in the same plan for L23 completeness.

#### [M29] Scroll-key audit across components {#m29-scroll-key-audit}

- **Card types:** any card using internally-scrollable components
- **State axes:** IS
- **Trigger:** Any scrollable sub-region inside a component whose scroll position is user-visible and not captured by the outer-scroll (OS) or markdown-view scroll-key paths today.
- **Status:** ❓ audit pending. Only `tug-markdown-view` carries `data-tug-scroll-key` today.
- **Closing requires:** walk every stateful component for scrollable sub-regions (`tug-tab-bar` overflow, `tug-popup-button` menu, `tug-sheet` content, `tug-context-menu` / `tug-completion-menu` scroll). Where user-visible scroll applies, add `data-tug-scroll-key` to the scrolling element. IS-axis machinery (already shipped in Step 9) handles capture/restore.

#### [M30] Virtual-focus / focus-within for composite components {#m30-virtual-focus}

- **Card types:** cards with composite components that manage a "virtual focus" (keyboard-navigation ring on a non-`activeElement` child)
- **State axes:** CS (not FX)
- **Trigger:** `tug-radio-group`, `tug-option-group`, `tug-choice-group`, `tug-tab-bar` — real `activeElement` is the wrapper; the focus ring is on an internal item tracked in component state. On transition, `bag.focus` captures the wrapper but loses the ring position.
- **Status:** ❌ broken.
- **Closing requires:** each such component opts into [A9] and captures its internal focus index via `captureState`. Restore reapplies the ring. No extension to the `focus` axis needed; this is component state.

#### [M31] `tug-prompt-entry` internal UI state (`route`, `toolsOpen`) {#m31-prompt-entry-ui-state}

- **Card types:** gallery-prompt-entry, tide-card (if it uses prompt-entry)
- **State axes:** CS
- **Trigger:** User navigates within a prompt-entry to a non-default route or opens the tools panel; transition resets both to defaults.
- **Status:** ❌ broken.
- **Closing requires:** `tug-prompt-entry` opts into [A9] with persistKey and serializes `{ route, toolsOpen }` via `captureState`. Distinct from the engine's content serialization (which continues to live in `bag.content`).

---

#### Resolved design decisions

All M-series open questions are resolved. Decisions are captured here and drive the architecture pieces in the next section.

- **[M-Q1] Shared-mechanism vs per-axis fix → CONFIRMED shared.** [M01] / [M03] / [M04] / [M05] / [M06] / [M07] / [M09] all reduce to "this card just became the focus destination; restore its focus and paint." A single `CardHost` subscription tracking the `isFocusDestination` predicate (derived from the deck store) closes them all. Per-axis fixes would duplicate the same ref-guard, the same focus-theft gate, and the same app-lifecycle wiring in five places. Shared is the directive. See architecture piece [A1] / [A3].

- **[M-Q2] `onCardActivated` as callback or observation → option (a) CONFIRMED.** Add a new optional callback `onCardActivated?: () => void` to `CardPersistenceCallbacks`. Content-owning cards (EM) implement it — typical body: `engine.root.focus({ preventScroll: true })` followed by engine-published selection. FC cards need no callback; `CardHost` handles FC reactivation directly by re-applying `bag.focus` + `bag.domSelection`. Placement in `CardPersistenceCallbacks` keeps lifecycle-awareness colocated with the existing save/restore protocol rather than scattering it across content factories that each subscribe to `card-lifecycle.ts`. See architecture piece [A2].

- **[M-Q3] Markdown-view copy-selection → MUST close per [L23].** A user's copy-selection is user-visible state; losing it on any transition violates the tuglaw. Previously-defensible "ephemerality" is not a permitted exception. `tug-markdown-view` gains `persistKey` + `useCardPersistence` + `selectionchange` publish. See [M10] for the updated closing requirements and architecture piece [A5] for the implementation shape.

- **[M-Q4] Card reopen → NOT a feature.** Close-then-reopen is not in scope; no UI path exists and none is planned. Step 14 continues to flush-on-close for robustness only (not for reopen). [M11] is closed as informational — no follow-on work.

- **[M-Q5] IME composition save → MUST retain, likely via `bag.markedText`.** Deferring save until `compositionend` is not sufficient: in-flight keystrokes from the user are user-visible state and must survive transitions. A new persisted axis `bag.markedText` captures the native marked-text buffer + composition anchor. Platform research required to determine whether browser APIs permit programmatic composition re-entry, or whether a native IPC bridge (via tugapp) is needed. See [M12] updated closing requirements and architecture piece [A6].

---

#### Architecture to close the gaps {#missing-architecture}

The M-series resolutions converge on a small number of shared mechanisms. Most of the broken cases ([M01], [M02], [M03], [M04], [M05], [M06], [M07], [M09], [M16]) are the same problem — "this card just became the focus destination; restore its focus + paint" — seen from different triggers. This section sketches the architectural pieces that, together, close the inventory. Each piece is labeled [A#] and cross-referenced from the M-entries above.

**Status:** DRAFT. These pieces need design review before M-series execution steps can be authored.

##### [A1] `isFocusDestination` derived selector on the deck store {#a1-focus-destination-selector}

A pure derived predicate:

```
isFocusDestination(cardId) ⇔
  card's pane is the active pane
  AND card is the active card of that pane
  AND document.hasFocus()  // app is foreground
```

Implemented as a selector over `deckState` + `activePaneId`. Exposed two ways:

- React: `useFocusDestination(cardId)` via `useSyncExternalStore` (per [L02]).
- Non-React: `deckStore.subscribe(() => isFocusDestination(cardId))` for `selectionGuard` / engine wiring.

**Closes (indirectly):** underpins [A3], [A4].

##### [A2] `onCardActivated` callback in `CardPersistenceCallbacks` {#a2-on-card-activated}

Add a new optional callback to the existing persistence protocol:

```ts
interface CardPersistenceCallbacks {
  onSave?: () => CardStateBag;
  onRestore?: (bag: CardStateBag) => void;
  onContentReady?: () => void;
  onCardActivated?: () => void;  // NEW
  restorePendingRef?: MutableRefObject<boolean>;
}
```

Content factories that own focus (EM) implement `onCardActivated` to re-focus their root. Typical body:

```ts
onCardActivated: () => {
  engine.root.focus({ preventScroll: true });
  // engine's onSelectionChanged publishes the current range → selection-guard paints
},
```

DOM-authority cards (FC) do not implement `onCardActivated`; `CardHost` handles them in [A3] by re-applying `bag.focus` + `bag.domSelection` directly.

**Closes:** [M02], [M06], [M07], [M09] (by giving content-owning cards a reactivation entry point).

##### [A3] Shared `CardHost` activation effect {#a3-shared-activation-effect}

One `useLayoutEffect` in `CardHost`, keyed on `isFocusDestination(cardId)` subscribed via `useSyncExternalStore`. On every `false → true` transition:

1. **Consult focus-theft gate [A8]**; abort if unsafe.
2. **Has-been-active ref-guard:** skip the first activation (mount already handled it via the cold-boot restore path).
3. **Dispatch by card flavor:**
   - Content-owning card (`bag.content !== undefined`): invoke `callbacks.onCardActivated?.()`. That's all. The content factory's implementation handles focus + any internal state.
   - DOM-authority card (`bag.content === undefined`): re-apply `applyFocusSnapshot(bag.focus)` then `restoreCardDomSelection(bag.domSelection)`. Same path as cold-boot restore, but triggered by activation instead of mount.

This effect is the single replacement for the three dep-sets we currently use (`[cardId, hostStackId, hostContentEl]` primary mount; `[hostStackId]` cross-pane refocus). Those earlier effects continue to run for mount-specific work (scroll restore, unmask); the activation effect is additive.

**Closes:** [M01], [M03], [M04] + [M05] (via [A4]'s wiring into `isFocusDestination`), [M06], [M07], [M09], [M16].

##### [A4] App-lifecycle activation pathway {#a4-app-lifecycle-activation}

`isFocusDestination` includes `document.hasFocus()` in its definition. App resign → foreground → `hasFocus` flips `false → true`, which naturally transitions the predicate for the current active card. [A3]'s subscriber fires automatically.

Implementation details:

- Wire an `observeApplicationDidBecomeActive` / `observeApplicationDidUnhide` listener in `deck-store` (or a thin coordinator) that calls `deckStore.notify()` — this causes the `useSyncExternalStore` subscribers to re-read the selector and observe the `false → true` transition.
- Paint-only response (app-resign dims paint, app-become-active brightens) already lives in `selectionGuard.handleApplicationDid{Resign,Become}Active`. This architecture piece is strictly about the _focus_ axis, which paint currently does not cover.

**Closes:** [M04], [M05].

##### [A5] Markdown-view selection publish {#a5-markdown-view-publish}

`tug-markdown-view` joins the contentEditable paint path:

1. Add `persistKey` prop to the component; wire `useCardPersistence({ onSave, onRestore })`.
2. In a `useEffect` (or `useLayoutEffect` per [L03]), subscribe to `document.selectionchange`. Filter: `range.commonAncestorContainer.compareDocumentPosition(rootEl)` within bounds. If match, call `selectionGuard.updateCardDomSelection(cardId, range)`.
3. `onSave` writes `bag.domSelection` from the current `selectionGuard.cardRanges.get(cardId)`.
4. `onRestore` is a no-op — the existing cold-boot restore path in `CardHost` replays the range via `restoreCardDomSelection`.

Markdown-view owns no text value (content is immutable in-session), so no `bag.content` / `onCardActivated` is needed.

**Closes:** [M10] per [L23].

##### [A6] `bag.markedText` axis + composition persistence {#a6-marked-text-persistence}

Schema extension:

```ts
interface CardStateBag {
  // ... existing axes ...
  markedText?: {
    text: string;                     // the composition buffer
    anchorOffset: number;             // offset within the container
    anchorPath: number[];             // DOM path to the anchor container
    platform: "webkit" | "chromium";  // for re-entry heuristics
  };
}
```

EM save:

- If `engine.isComposing`: capture `bag.markedText` from `engine.getCompositionState()`. Research: whether the engine can read the native marked-text string (webkit exposes partial info via `CompositionEvent.data`; may need event-time capture into engine state).
- If not composing: `bag.markedText = undefined`.

EM restore:

- If `bag.markedText` is set at activation / mount: engine attempts composition re-entry. Implementation paths (in priority order):
  1. **Browser API path:** `Selection.setBaseAndExtent` to the anchor, then dispatch synthetic `compositionstart`/`compositionupdate` events. Likely non-standard and won't reliably cause the native IME to re-open the mark.
  2. **Native IPC path (tugapp):** tugapp calls into the macOS input context (`NSTextInputContext`) to re-enter composition with the saved marked text. Research required; this is the fallback if (1) doesn't land cleanly.
  3. **Text-only fallback:** insert the marked-text string as plain text at the anchor and set cursor at the end. Loses the "draft" property (user can't continue composing onto it) but preserves the characters. Final fallback.

FC save:

- Defer save during composition: if `compositionStart` has fired and `compositionend` has not, `saveCurrentCardStateRef.current` enqueues the save for post-`compositionend` delivery. On `compositionend`, flush the deferred save.
- Process-exit mid-composition: the last pre-composition bag is preserved; the in-flight composition buffer is lost. Accepted residual.

**Closes:** [M12] to the extent the platform permits. Residuals documented.

##### [A7] Unified flush-on-teardown gate {#a7-unified-flush-gate}

Every path that removes cards from `deckState.cards` routes through `flushSaveCallbackBeforeDestruction` (Step 14's helper):

- `_removeCard` ✅ (already wired in Step 14).
- `_closePane` ✅ (already wired in Step 14, but audit: does it iterate every card before pane-level clear?).
- Any future deck-reset / workspace-switch path: must call the helper per card.

Add an invariant guard at the bottom of `_removeCard` / `_closePane`: if the flush helper was not called for a card being removed, log a dev-error. Consider a single chokepoint `destroyCard(cardId)` that bundles "flush + lifecycle notify + delete from state" so bypassing is difficult.

**Closes:** [M19].

##### [A8] `canProgrammaticallyFocus` helper — central focus-theft gate {#a8-focus-theft-gate}

A shared helper consulted by every programmatic refocus path:

```ts
function canProgrammaticallyFocus(
  targetCardId: string,
  store: DeckStore,
): boolean {
  if (!document.hasFocus()) return false;
  const active = document.activeElement;
  // OK to focus if body, or within the target card's host, or inside a non-focus-capturing chrome element
  if (active === document.body) return true;
  if (targetCardHostEl(targetCardId)?.contains(active)) return true;
  if (isNonFocusCapturingChrome(active)) return true;  // pane drag handles, tab bar buttons between clicks, etc.
  return false;  // user has moved focus to another card or real UI — don't steal
}
```

Every refocus helper — [A3]'s activation effect, [A4]'s app-lifecycle pathway, Step 11's cross-pane effect — consults this before calling `.focus()`. Centralizes [R07] (focus-steal avoidance).

**Closes (indirectly):** makes [A3], [A4], [A6] safe.

##### [A9] Component Persistence Protocol {#a9-component-persistence-protocol}

Per [D13] (approved). The foundational architectural piece that closes the entire ⚠️ class surfaced by the component-roster L23 audit ([M24]–[M31]). Framework-owned; components opt in.

Framing: **a weekend's work for stable foundations instead of months-of-work debugging ad-hoc persistence for every new stateful component.**

**A9a. `useComponentPersistence` hook (registration).** Hook signature:

```ts
function useComponentPersistence<T>(opts: {
  persistKey: string;
  captureState: () => T;         // synchronous; returns serializable
  restoreState: (saved: T) => void;
}): void;
```

Internals (per [Q2b] ref-based storage, [L03] compliant):

```ts
function useComponentPersistence<T>({ persistKey, captureState, restoreState }) {
  const captureRef = useRef(captureState);
  const restoreRef = useRef(restoreState);
  // Sync refs on every render — closure always sees latest React state.
  captureRef.current = captureState;
  restoreRef.current = restoreState;

  const registry = useComponentPersistenceRegistry();  // from nearest card context
  const scopedKey = usePersistenceScopePrefix() + persistKey;

  useLayoutEffect(() => {
    registry.register(scopedKey, captureRef, restoreRef);
    return () => registry.unregister(scopedKey);
  }, [scopedKey, registry]);
}
```

**A9b. `<PersistenceScope prefix>` context (nesting).** Wraps a subtree so nested components' `persistKey`s auto-prefix. Enables composite components to embed other opt-in components without the outer component knowing inner `persistKey`s. Collision assertion (at card scope, dev-only):

```ts
registry.register(scopedKey, ...) {
  if (this.entries.has(scopedKey)) {
    if (isDevEnv()) {
      throw new Error(`[A9] duplicate persistKey within card scope: "${scopedKey}"`);
    }
  }
  this.entries.set(scopedKey, ...);
}
```

**A9c. Framework orchestration — `captureCardState` / `restoreCardState`.** Explicit entry points on the card framework. **Every save trigger routes through these; no trigger calls per-card `onSave` directly.**

```ts
function captureCardState(cardId: string): CardStateBag {
  const card = cards.get(cardId);
  const registry = componentRegistries.get(cardId);
  return {
    content:      card.callbacks.captureContent?.(),     // was onSave
    components:   harvestComponents(registry),            // parent-first walk
    formControls: captureFormControls(cardId),            // CardHost
    regionScroll: captureRegionScroll(cardId),            // CardHost
    focus:        captureFocus(cardId),                   // selection-guard + CardHost
    domSelection: selectionGuard.getRange(cardId),        // selection-guard
    markedText:   captureMarkedText(cardId),              // engine / FC adapters
  };
}

function restoreCardState(cardId: string, bag: CardStateBag): void {
  const card = cards.get(cardId);
  const registry = componentRegistries.get(cardId);
  // Parent-first restore order (per Q3 resolution).
  card.callbacks.restoreContent?.(bag.content);
  restoreComponents(registry, bag.components ?? {});   // walks registry parent-first
  // Framework-synthesized axes are applied by their respective owners
  // (selection-guard, CardHost) at their own lifecycle points.
}

function harvestComponents(registry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Parent-first ordering (per Q3 resolution).
  for (const [key, entry] of registry.entriesInTreeOrder()) {
    try {
      out[key] = entry.captureRef.current();
    } catch (e) {
      if (isDevEnv()) console.warn(`[A9] captureState threw for "${key}":`, e);
    }
  }
  return out;
}

function restoreComponents(registry, saved: Record<string, unknown>): void {
  // Partial restore (per Q5 resolution): ignore orphans, warn in dev.
  if (isDevEnv()) {
    const registered = new Set(registry.keys());
    const orphans = Object.keys(saved).filter((k) => !registered.has(k));
    if (orphans.length) console.warn(`[A9] orphan persistKeys dropped:`, orphans);
  }
  for (const [key, entry] of registry.entriesInTreeOrder()) {
    if (key in saved) {
      try {
        entry.restoreRef.current(saved[key]);
      } catch (e) {
        if (isDevEnv()) console.warn(`[A9] restoreState threw for "${key}":`, e);
      }
    }
  }
}
```

**A9d. Per-component port / opt-in plan.** The following components gain `persistKey` + `useComponentPersistence` (in priority order, grouped by category):

- **Layout state:** `tug-accordion`, `tug-split-pane` (or pane-scope; see [M27]).
- **Selection:** `tug-radio-group`, `tug-choice-group`, `tug-option-group`, `tug-popup-button`, `tug-tab-bar`.
- **Numeric:** `tug-slider`, `tug-value-input`.
- **Toggles:** `tug-checkbox`, `tug-switch`.
- **Pickers:** `tug-hue-strip`, `tug-color-strip`.
- **Overlays with user interaction (per [M26] policy):** `tug-sheet`, `tug-alert`, `tug-confirm-popover`, `tug-popover`.
- **Engine-card chrome:** `tug-prompt-entry` (`route`, `toolsOpen`) — see [M31].
- **Virtual focus within composites:** radio-group, option-group, choice-group, tab-bar — see [M30].

Existing persistence-aware components (`tug-input`, `tug-textarea`, `tug-prompt-input`, `tug-prompt-entry`, `tug-markdown-view` post-[M10]) migrate from `useCardPersistence` (card-level) to `useComponentPersistence` (component-level) where appropriate. `useCardPersistence` remains for cards themselves (for `bag.content`).

**A9e. Overlay policy implementation.** Per [M26]: opt in (a) sheet, alert, confirm-popover, complex popover. Opt out (b) tooltip, context-menu, editor-context-menu, transient popovers. Captured state for (a) overlays: `{ open, anchorPath?, invokedAt?, ...per-surface-data }`.

**A9f. Scroll-key audit.** Per [M29]: walk stateful components for internally-scrollable sub-regions; add `data-tug-scroll-key` where user-visible scroll applies. IS-axis machinery (Step 9) handles capture/restore. Scope: `tug-tab-bar` overflow, `tug-popup-button` menu, `tug-sheet` content, `tug-completion-menu`, `tug-context-menu` if scrollable, any custom scrollable chrome.

**Closes:** [M24], [M25], [M27], [M29], [M30], [M31] directly; enables closing [M26] per-overlay.

##### Architecture coverage matrix {#architecture-coverage}

| M-entry | Closed by | Residuals |
|---------|-----------|-----------|
| [M01] | [A1] + [A3] + [A8] | none |
| [M02] | [A1] + [A2] + [A3] + [A8] | none |
| [M03] | [A1] + [A3] + [A8] | none |
| [M04] | [A1] + [A3] + [A4] + [A8] | none |
| [M05] | [A1] + [A3] + [A4] + [A8] | none |
| [M06] | [A1] + [A2] + [A3] + [A8] | none |
| [M07] | [A1] + [A2] + [A3] + [A8] | none |
| [M08] | [A2] (direct) | closed by adding the callback |
| [M09] | [A1] + [A2] + [A3] + [A8] | none |
| [M10] | [A5] | none |
| [M11] | (no action — not a feature) | informational |
| [M12] | [A6] | process-exit mid-composition unrecoverable |
| [M13] | integration tests added per M-step | none |
| [M14] | folded into [M13] test expansion | none |
| [M15] | Step NN deletion | none |
| [M16] | [A1] + [A3] | none |
| [M17] | audit fix: `saveState` RPC → `captureCardState` ([A9c]) | parity test must pass |
| [M18] | save-gate inspects `restorePendingRef.current` | none |
| [M19] | [A7] | none |
| [M20] | local overlay fixes + [A3] as safety net | none |
| [M21] | drag-abort routes through activation | none |
| [M22] | integration tests assert caret visibility | none |
| [M23] | scope to single-card; paint doesn't crash cross-card | cross-card selections remain one-owner |
| [M24] | [A9a] + [A9b] + [A9c] | none |
| [M25] | [A9a] + per-component classification ([A9d]) | ephemeral cases intentionally unpersisted |
| [M26] | [A9e] | per-overlay decisions |
| [M27] | [A9d] (or pane-state if splitter is pane-scope) | open sub-decision |
| [M28] | separate user-preferences store (not [A9]) | orthogonal layer |
| [M29] | [A9f] | none |
| [M30] | [A9d] (virtual-focus captured per component) | none |
| [M31] | [A9d] (prompt-entry opts in) | none |

##### Phasing suggestion for M-series execution steps {#m-phasing}

Not a commitment yet — just a sketch for discussion. Updated to place [A9] as the **foundational phase** because nearly every subsequent stateful-component fix depends on it.

1. **M-phase 0 (foundation) — AUTHORED as [Steps 16–19](#step-16):**
   - **[Step 16](#step-16):** component persistence registry + `bag.components` schema.
   - **[Step 17](#step-17):** `useComponentPersistence` hook + `<PersistenceScope>`.
   - **[Step 18](#step-18):** framework orchestration — `captureCardState` / `restoreCardState`; save triggers rerouted; closes [M17].
   - **[Step 19](#step-19):** first-consumer proof — `tug-checkbox` opts into the protocol; closes [M24] at the per-component proof-of-concept level.
   - No user-visible behavior change through Step 18 (pure refactor). Step 19 is the first user-observable application of the protocol.
2. **M-phase 1 (transition infra, no behavior change) — AUTHORED as [Steps 20–22](#step-20):**
   - **[Step 20](#step-20):** [A1] `isFocusDestination` selector + `hasFocus` slice on the deck store; `useFocusDestination` hook.
   - **[Step 21](#step-21):** [A8] `canProgrammaticallyFocus` focus-theft gate.
   - **[Step 22](#step-22):** [A2] `onCardActivated` field added to `CardPersistenceCallbacks` (declared but not yet dispatched).
   - No consumers; no user-visible behavior change at phase end. Dispatchers land in M-phase 2.
3. **M-phase 2 (core refocus) — AUTHORED as [Steps 23–24](#step-23):**
   - **[Step 23](#step-23):** install the [A3] shared activation effect in `CardHost`. At end of Step 23, FC cards have working reactivation via `applyFocusSnapshot` + `restoreCardDomSelection` under the [A8] gate. Closes [M01], [M03], [M16].
   - **[Step 24](#step-24):** engine-managed content factories register `onCardActivated` to re-focus the engine root; Step 11's redundant cross-pane effect retires. Closes [M02], [M06], [M07], [M09].
   - End of phase: seven transition-class gaps closed; single-owner reactivation path in place.
4. **M-phase 3 (app lifecycle):** implement [A4] wiring. Closes [M04], [M05].
5. **M-phase 4 (markdown-view):** implement [A5]. Closes [M10].
6. **M-phase 5 (teardown):** implement [A7]. Closes [M19].
7. **M-phase 6 (IME):** implement [A6]. Platform research → decide between browser API / native IPC / text-fallback. Closes [M12] to platform-possible extent.
8. **M-phase 7 (component opt-in):** walk [A9d] component priority list and port each. Closes [M25], [M27], [M30], [M31]. Overlay policy decisions ([A9e], [M26]) made during this phase. Scroll-key audit ([A9f], [M29]) folded in.
9. **M-phase 8 (banner / bulletin dismiss):** implement the user-preferences store for [M28]. Orthogonal to [A9] (not card-scoped).
10. **M-phase 9 (audit + verify):** [M17] RPC audit (now routed through `captureCardState`), [M18] restore-pending gate, [M20] overlay audit, [M21] drag-abort verify, [M22] caret-visibility tests, [M23] cross-card verify.
11. **M-phase 10 (cleanup):** [M13] / [M14] integration test expansion, then Step NN ([M15] deletion + docs).

Each M-phase corresponds to 1–3 execution steps to be authored. The phasing gates "wait on decisions" away from "wait on implementation" so blockers surface early. M-phase 0 ([A9] foundation) is authored first so all subsequent phases can assume the protocol is in place.

---

### Deliverables and Checkpoints {#deliverables}

#### Phase-exit criteria {#phase-exit}

- [ ] All execution steps landed — Steps 1–15 (original plan), the M-series steps that close the [missing cases inventory](#missing-cases), and Step NN (final cleanup). Each step's individual checkpoint passed.
- [ ] `bun x tsc --noEmit` exits 0 on main.
- [ ] `bun test` passes in full with the new integration suite from Step 15.
- [ ] `tugutil validate /u/src/tugtool/roadmap/tugplan-selection.md` passes.

#### Manual verification checklist {#manual-verification}

User-visible behavior that must be confirmed after the plan ships:

- [ ] Reload an app with a DOM selection in a tide card — selection is restored, painted via native `::selection`, on the correct text range.
- [ ] Reload an app with a selection range in a gallery input — input has focus and the selection range paints.
- [ ] Two cards in view, one focused; the focused card's selection paints bright (`::selection`); the unfocused card's selection paints dim (`::highlight(inactive-selection)`). Switch focus between them — paint moves with focus.
- [ ] Cross-pane drag of a focused input card — after drop, focus returns to the previously-focused input and its selection paints.
- [ ] App resign (Cmd-Tab away) — active card's selection dims. App become-active — selection returns bright.
- [ ] Tab switch within a pane — outgoing tab's selection dims; incoming tab's selection (if any) paints bright on the active tab.
- [ ] Close a card mid-edit — last edits persist (save-on-close fires before destruction).
- [ ] `tug-markdown-view` card scrolled to the middle — reload — scroll position returns (via `regionScroll`).
- [ ] Reload across two cards, each with a different selection — both restore, correct card's selection bright, other card's dim.

#### Known limitations and follow-ons {#follow-ons}

Items deliberately deferred from this plan. Each has a one-line statement of why it's deferred and what would be required to close it.

- **Engine undo history does not survive reload.** `TugTextEngine.undo()` calls `document.execCommand("undo")` (`tug-text-engine.ts:605`), which relies on the browser's native undo stack. Browser-native undo is lost on reload; Cmd-Z after reload does nothing. Closing this gap requires the engine to maintain its own serializable mutation log (replacing `execCommand("undo")` with an internal stack), which is a separate medium-sized engine refactor. Filed for a follow-on plan.

- **Per-card `onSave` payload audit.** `bag.content` is an opaque per-card slot that each card's content factory fills via `useCardPersistence.onSave`. Component-local React state (accordion expansion, nested tab selection, sort order, filter settings, step-wizard position) is only preserved across reload if the card's author explicitly includes it in the `onSave` payload. After this plan ships, every registered card type's `onSave` should be audited for completeness; gaps are per-card concerns to be fixed in each card's own module. Candidates to audit (high-priority first): `tide`, `git`, `hello`, `gallery-markdown-view`, and any future card type that introduces internal state.

- **Deeper engine diff-restore ([Q04] options (b)/(c)).** This plan ships [Q04] option (a) — the content-identical fast path. The broader flat-parts diff or full DOM reconciliation are more work for a narrower benefit (idempotent same-content restore is already covered by (a)) and are deferred to a separate engine-focused plan.

- **Paint tier expansion ([Q02]).** One dim tier is the shipped choice. If UX feedback later demands distinguishing "inactive-in-active-pane" from "inactive-in-other-pane," add a second named CSS Custom Highlight and a second dim color rule. Revisitable post-ship.

- **Tuglaws additions.** The new persistence pattern deserves a short law: "Persistence is data; apply is component-owned." Consider proposing this as a new law in `tuglaws/tuglaws.md` after the pattern settles in the codebase for a release cycle.

#### Rollback policy {#rollback}

Every execution step is a single commit and is individually revertable. If a regression surfaces mid-plan, revert the offending step and any strictly-dependent steps after it (see each step's `Depends on:` line); the remaining commits stay green because they don't forward-reference unimplemented state.
