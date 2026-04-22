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

The implementation sequence is 15 commits. Each is independently revertable. The compile target stays green end-to-end; the user-visible save/restore behavior may regress briefly between commits (from Step 1 through Step 10) and comes back fully correct at Step 10. Integration tests at Step 14 pin every transition.

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

**Tasks:**
- [ ] Remove `useSelectionBoundary(stackId, contentRef)` from `tug-pane.tsx:428`.
- [ ] Add a `cardRootRef` inside `CardHost` that attaches to the existing `[data-card-host][data-card-id]` div at `card-host.tsx:473-480`.
- [ ] Call `useSelectionBoundary(cardId, cardRootRef)` from within `CardHost`.
- [ ] Inside `selection-guard.ts`, change any code that resolves a card-under-pointer via pane lookup to resolve via `el.closest('[data-card-host]')`. Specifically: the `pointerdown` handler's card-tracking path (approximately `selection-guard.ts:456` area — `activateCard`).
- [ ] Update `selection-model.md` table row for `useSelectionBoundary` to name the card-host div, not `.tug-pane-chrome-content`.

**Upholds:** [L12] card-level selection boundary (verbatim, restored). [L10] selection-guard stays the boundary owner; card-host delegates boundary registration.

**Tests:**
- [ ] `selection-model.test.tsx`' boundary registration tests: register per card id. Assert that a multi-card pane has N boundaries registered (one per card), not 1.
- [ ] `selection-guard`' drag-clip test that the clip destination resolves via `closest('[data-card-host]')`.
- [ ] `card-host-composition.test.tsx` still green.

**Checkpoint:**
- [ ] `bun x tsc --noEmit` exits 0.
- [ ] `bun test` full suite green.
- [ ] Manual probe: render two cards in a single pane and confirm `selectionGuard.boundaries` has two entries at runtime (via a temporary dev-log, removed at the step commit).

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

**Tasks:**
- [ ] Add `onSelectionChanged` to the engine's public interface at `lib/tug-text-engine.ts:78`.
- [ ] Implement subscriber list as `Set<(range: Range | null) => void>` with a dispose-function contract.
- [ ] Add the emit call inside `setSelectedRange` and at the tail of `restoreState`. Each call reads the current `window.getSelection()` if the root has focus; otherwise constructs a Range from the engine's internal selection coords and root.
- [ ] Add an `input` / `selectionchange` listener on the engine root so the engine publishes selection as the user interactively drags/types. Scope the listener to `this.root` so it doesn't fire for selections outside the engine.
- [ ] Dispose subscribers in the engine's `destroy` method.

**Upholds:** [L11] engine owns its selection state; exposes a hook for non-owner observers to subscribe rather than poking at engine internals. [L10] engine publishes; selection-guard consumes.

**Tests:**
- [ ] New `tug-text-engine.test.ts` tests: `engine.setSelectedRange(a, b)` fires `onSelectionChanged` with a Range matching `a,b`; `engine.restoreState(...)` fires with the restored range; `engine.clear()` fires `null`.
- [ ] Unsubscribe actually stops firing.
- [ ] A user-driven selectionchange (simulated via happy-dom) fires `onSelectionChanged` exactly once with the current Range.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`, `bun test` green.

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
- [ ] Add `cardRanges` and `updateCardDomSelection` to `selection-guard.ts`.
- [ ] In `TugPromptInput` (search for the engine-creation `useLayoutEffect` around line 640-650), subscribe to `engine.onSelectionChanged` and relay to `selectionGuard.updateCardDomSelection(cardId, range)`.
- [ ] Ensure the `cardId` is reachable inside `TugPromptInput` — it already has `CardPersistenceContext` (`tug-prompt-input.tsx:349`). If `cardId` isn't currently exposed there, expose it alongside the existing register callback in `CardHost`'s persistence context value at `card-host.tsx:485`.
- [ ] At unsubscribe / card unmount, call `selectionGuard.updateCardDomSelection(cardId, null)` to clear the Range from the store.

**Upholds:** [L10] engine and selection-guard talk through a narrow interface (`updateCardDomSelection`). [L22] `cardRanges` drives downstream DOM paint (Step 5) via direct store observation, not React round-trip.

**Tests:**
- [ ] `card-host-composition.test.tsx` grows a test: mount a `TugPromptInput` card, call `engine.setSelectedRange(3, 7)`, assert `selectionGuard.cardRanges.get(cardId)` holds a Range with those offsets.
- [ ] Unmount clears the entry.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`, `bun test` green.

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
- [ ] Add `windowHasFocus` boolean (defaults true, flips on will-resign/did-become).
- [ ] Add `getFocusedCardId(): string | null` — resolves via deck-state `activePaneId` → `pane.activeCardId`.
- [ ] `updatePaint(hint?: { changedCardId?: string })` (new internal method): if the hint indicates the focused card's entry changed while `windowHasFocus`, short-circuit. Otherwise clear `inactiveHighlight` and rebuild from `cardRanges` minus the focused card's entry (when `windowHasFocus` is true), validating each Range's containers against `document.contains` and dropping stale entries with a dev-warn. Moves the focused-card range into `window.getSelection()`.
- [ ] `updateCardDomSelection(cardId, range)` calls `updatePaint({ changedCardId: cardId })`.
- [ ] Subscribe to deck-state changes — on `activeCardId` or `activePaneId` change, call `updatePaint()` (no hint → full rebuild).
- [ ] Retire `inactiveRanges` and `deactivatedCardId` fields from `selection-guard.ts` — subsumed by `cardRanges` + `windowHasFocus`.
- [ ] `handleApplicationWillResignActive` / `handleApplicationDidBecomeActive` refactor — they now only flip `windowHasFocus` and call `updatePaint()`. No more manual Range cloning.

**Upholds:** [L06] paint is appearance-zone — CSS Highlight mutation, no React. [L22] paint subscribes to the deck store and writes to the DOM highlight directly.

**Tests:**
- [ ] Register two cards, publish a Range for each, flip `activeCardId` between them, assert only the currently-active card's range is in `window.getSelection()` and the other is in `inactive-selection`.
- [ ] App resign: both ranges paint in `inactive-selection`.
- [ ] App become-active: focused card's range moves back to native; other remains in inactive.
- [ ] Mutation tests for `updateCardDomSelection(cardId, null)` → removes from paint.
- [ ] **Stale-range drop**: publish a Range, then detach the anchoring element from the document (simulates an engine-root replacement without a re-publish), trigger an unrelated `updatePaint()` (e.g., a deck-state change), assert the stale entry is removed from `cardRanges` and a dev-warn was emitted.
- [ ] **Perf short-circuit**: `updatePaint({ changedCardId })` where `changedCardId === getFocusedCardId() && windowHasFocus` does NOT call `inactiveHighlight.clear()` (assert via spy).

**Checkpoint:**
- [ ] `bun x tsc --noEmit`, `bun test` green.
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
- [ ] Add `getCardRange` to `selection-guard.ts`.
- [ ] Expose `nodeToPath` as a public helper inside `selection-guard.ts` (was private), or import it from there to `card-host.tsx`.
- [ ] In `saveCurrentCardStateRef.current`, capture `domSelection`.
- [ ] Add unit test for the serializer.

**Upholds:** [L10] selection-guard owns the live Range; card-host owns serialization shape into the bag.

**Tests:**
- [ ] Serialize a Range anchored inside a card root, assert the paths and offsets round-trip.
- [ ] Range whose endpoints fall outside the card root → `domSelection: null`.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`, `bun test` green.

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
- [ ] Add `FocusSnapshot` type to `layout-tree.ts`.
- [ ] Implement `captureFocus(cardRoot): FocusSnapshot` helper inside `card-host.tsx`.
- [ ] Wire `captureFocus(cardRoot)` into `saveCurrentCardStateRef.current`.
- [ ] Register a `component-owned` predicate — initially: `el instanceof HTMLElement && el.closest('[data-tug-prompt-input-root]')` (add this marker attribute in TugPromptInput at Step 7 too).
- [ ] Document `data-tug-focus-key` in `selection-model.md`.

**Upholds:** [L23] element-level focus is now user-data-preserving per saved state. [L10] card-host owns focus capture; engines/components mark themselves via attribute or component-owned selector.

**Tests:**
- [ ] `<input data-tug-persist-value="email">` focused → `{ kind: "form-control", persistKey: "email" }`.
- [ ] `<button data-tug-focus-key="save">` focused → `{ kind: "dom", focusKey: "save" }`.
- [ ] `[data-tug-prompt-input-root] [contenteditable]` focused → `{ kind: "component-owned" }`.
- [ ] `document.body` focus → `{ kind: "none" }`.
- [ ] Focus outside the card root → `{ kind: "none" }`.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`, `bun test` green.

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
- [ ] Add back selection fields to `FormControlSnapshot` (they were dropped in Step 1 for separation of concerns; now the separation is clear, add them back here).
- [ ] `captureFormControls` reads all three fields defensively (some `<input type=...>` don't support `selectionStart`; wrap in try/catch).
- [ ] `applyFormControlSnapshot` calls `setSelectionRange` after value assignment; wrapped in try/catch.

**Upholds:** [L23] form-control selection is user-data-preserving.

**Tests:**
- [ ] Save→load round-trip on an `<input>` with `value="hello world"`, `selectionStart=6`, `selectionEnd=11`, direction `forward`.
- [ ] `type="checkbox"` with `persistKey` set: save doesn't throw, restore doesn't throw, selection fields are absent.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`, `bun test` green.

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
- [ ] Finalize the `regionScroll` type in `layout-tree.ts`.
- [ ] Implement `captureRegionScrolls` and `applyRegionScrolls` in `card-host.tsx`.
- [ ] Wire into save path (`saveCurrentCardStateRef.current`) and mount restore effect.
- [ ] Add `data-tug-scroll-key="markdown-view"` to `tug-markdown-view.tsx`'s scroll container.
- [ ] Document the attribute in `selection-model.md` (add to the `data-tug-*` attribute table).

**Upholds:** [L23] nested scroll positions are user-visible state that must survive reload. [L10] card-host owns the walk; components opt in via attribute.

**Tests:**
- [ ] Unit: capture two keyed regions, each with different scroll, round-trip through apply.
- [ ] Integration: reload a `tug-markdown-view` card with non-zero scroll; assert scroll restores to the same position.
- [ ] Integration: reload a card with both outer `hostContentEl` scroll AND an inner keyed region scroll; both restore independently.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`, `bun test` green.

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
- [ ] Add `restoreCardDomSelection` to `selection-guard.ts`.
- [ ] Call it from `CardHost`'s mount effect (after scroll restore, around `card-host.tsx:287`).
- [ ] Also call from `CardHost`'s `onContentReady` tail in `registerPersistenceCallbacks` (`card-host.tsx:236`) for with-content bags.

**Upholds:** [L23] user-visible selection survives reload for non-engine cards (engine owns its own via content restore path). [L10] resolution happens in selection-guard, which owns Range ↔ DOM translation.

**Tests:**
- [ ] Mount a card with a pre-populated `bag.domSelection`, assert `selectionGuard.cardRanges.get(cardId)` matches after mount.
- [ ] Mount an inactive card (not the active card of active pane) with `bag.domSelection`, assert the Range paints in `inactive-selection` (via Step 5 paint rule).

**Checkpoint:**
- [ ] `bun x tsc --noEmit`, `bun test` green.

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
- [ ] Add `applyFocusSnapshot(cardRoot, snapshot)` helper inside `card-host.tsx`.
- [ ] Gate on `isActiveCardOfActivePane` via `store.getSnapshot().panes.find(...).activeCardId === cardId`.
- [ ] Gate on `!cardRoot.contains(document.activeElement)` so re-focus doesn't fight an already-inside focus.
- [ ] Run the apply after `onContentReady` (for content bags) and after the layout-effect scroll restore (for no-content bags).
- [ ] Add a second `useLayoutEffect` keyed on `[hostStackId]` with a `hasMountedRef` guard; on subsequent runs (i.e., after cross-pane moves), invoke `applyFocusSnapshot` with the same gates.

**Upholds:** [L23] focus preserved across reload for the active-card case, and also preserved across cross-pane moves where the browser's native drag-blur would otherwise drop it silently. [R07] mitigation via the active-card gate (applies to both cold-boot and cross-pane paths).

**Tests:**
- [ ] Active card mount with `{ kind: "form-control", persistKey: "email" }` → `<input data-tug-persist-value="email">` is focused.
- [ ] Inactive card mount with the same bag → focus stays wherever it was.
- [ ] Active card mount with `{ kind: "component-owned" }` → the contentEditable inside `[data-tug-prompt-input-root]` is focused.
- [ ] Focus inside the card at mount-time → no re-focus.
- [ ] **Cross-pane move with focus in a form-control:** drag card from pane A to pane B; after drop, if the card is the active card of the active pane, the previously-focused input regains focus.
- [ ] **Cross-pane move with user clicking elsewhere mid-drag:** user clicks a different card between drag-start and drop; the refocus effect does NOT steal focus from wherever the user is now (Option B gate + `!cardRoot.contains(document.activeElement)` guard together).

**Checkpoint:**
- [ ] `bun x tsc --noEmit`, `bun test` green.
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
- [ ] At the top of `restoreState`, call `this.captureState()` and serialize its output to a signature string via the canonical form above.
- [ ] Serialize `state` to the same form.
- [ ] If the two signatures match, skip `this.root.innerHTML = parts.join("")` and the `parts` build loop entirely; fall straight through to `setSelectedRange` for selection alignment.
- [ ] Keep the post-write calls (`this.updateEmpty()`, `this.autoResize()`, `this.setSelectedRange(...)`) to run regardless — they're fast and the selection/layout adjust is cheap and idempotent.
- [ ] No cached signature field. No invalidation step. No edit-path instrumentation.

**Upholds:** [L23] — the canonical textbook case of "diff and mutate minimally." When content hasn't changed, don't touch the DOM at all. Ground-truth comparison (not cached) eliminates the cache-drift failure mode.

**Tests:**
- [ ] Two consecutive `restoreState(same)` calls: second produces no DOM mutation (assert via MutationObserver).
- [ ] `restoreState(different)` writes as before.
- [ ] `restoreState(A)`, then user edit (via engine's edit APIs), then `restoreState(A)`: the second restore writes (current DOM now differs from A, signature mismatch, full path).
- [ ] `restoreState(A)` followed by `restoreState(A')` where only selection changed: DOM is unchanged (skipped), `setSelectedRange` still runs and moves the caret.
- [ ] Selection is applied regardless (`sel.anchorOffset/focusOffset` match).

**Checkpoint:**
- [ ] `bun x tsc --noEmit`, `bun test` green.
- [ ] Existing engine test suite green (regression gate for [R05]).

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
- [ ] In `action-dispatch.ts`'s `initActionDispatch`, add:
  ```
  appLifecycle.observeApplicationWillResignActive(() => deckManager.saveAndFlush())
  appLifecycle.observeApplicationWillHide(() => deckManager.saveAndFlush())
  ```
- [ ] The existing `observeApplicationDidResignActive` → `saveAndFlush` stays as a backstop (idempotent).

**Upholds:** [L23] save at will-phase reads authoritative state before browser teardown.

**Tests:**
- [ ] Fire `notifyApplicationWillResignActive`; assert every card's save callback ran.
- [ ] Fire `notifyApplicationWillHide`; same.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`, `bun test` green.

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
- [ ] Add `invokeSaveCallback(cardId)` call before destruction notifications at `deck-manager.ts:1061` and `:596`.
- [ ] Wrap the invoke in try/catch and dev-warn on throw.
- [ ] Update `_removeCard`'s docstring to name the invariant.

**Upholds:** [L23] — last unsaved edits of a closing card are preserved.

**Tests:**
- [ ] `deck-manager.test.ts`: close a card that registered a save callback; assert the callback ran before the destruction lifecycle event.
- [ ] Save callback throws; destruction still proceeds; dev warn logged.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`, `bun test` green.

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
- [ ] Author every test above.
- [ ] Add a grep contract test that encodes the post-refactor invariants. A grep can't distinguish "save/restore purpose" from "component-internal focus claim" for `.focus()`, so the contract targets what *is* mechanical:
  - `selectionGuard.saveSelection(` and `selectionGuard.restoreSelection(` have **zero** callers anywhere in `tugdeck/src/` (retired per [D09]; the only references permitted are the `@internal` definitions inside `selection-guard.ts`).
  - `setBaseAndExtent(` appears only in `selection-guard.ts` (drag-clip plus `restoreCardDomSelection`) and `tug-text-engine.ts` (engine-owned selection writes). No other file.
  - `setSelectionRange(` appears only in `card-host.tsx` (`applyFormControlSnapshot`), `use-text-input-responder.tsx` (contextmenu restore — existing, unchanged), and `tug-text-engine.ts` (engine internals). No other file.
  - `.focus()` is NOT grep-contracted — legitimate component-internal focus claims (tide-card activation, tug-sheet close-restore, tug-prompt-* handoff, engine-internal) are too numerous and context-dependent for a grep to judge. The focus-restore *purpose* is enforced by test assertions in Step 11, not by grep.

**Tests:** (this step IS tests)
- [ ] All integration tests green.
- [ ] Grep contract passes (three grep assertions above).

**Checkpoint:**
- [ ] `bun x tsc --noEmit`, `bun test` green.
- [ ] Manual verification checklist (see [#deliverables](#deliverables).

---

#### Step 16: Documentation & final cleanup {#step-16}

**Depends on:** #step-15

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

### Deliverables and Checkpoints {#deliverables}

#### Phase-exit criteria {#phase-exit}

- [ ] All 16 execution steps landed and each step's individual checkpoint passed.
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
