## Tugways Phase 5b2: Tab Drag Gestures {#phase-5b2-tab-drag-gestures}

**Purpose:** Tabs can be reordered within a tab bar, detached into new cards, and merged into existing cards via pointer-capture drag gestures -- with visual feedback (ghost tab, insertion indicator, drop-target highlight) that follows Rules of Tugways appearance-zone discipline.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5b2-tab-drag-gestures |
| Last updated | 2026-03-03 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phase 5b delivered click-based tab management: TugTabBar, TugDropdown, contentFactory, DeckManager tab methods (addTab, removeTab, setActiveTab), and multi-tab rendering in DeckCanvas. Users can add, switch, and close tabs. What is missing is the spatial manipulation layer: dragging tabs to reorder them within a bar, dragging them out of a bar to detach into new cards, and dragging them onto another card's bar to merge.

The pointer-capture drag pattern is already established in `card-frame.tsx` -- CardFrame uses `setPointerCapture`, RAF-throttled `pointermove` handling, and appearance-zone DOM style mutations during drag with a structure-zone commit on drop. Phase 5b2 reuses this exact pattern for tab dragging, extending it with hit-testing against tab positions (reorder), tab bar bounding rects (detach threshold), and all visible tab bars (merge targets).

#### Strategy {#strategy}

- Add three new DeckManager methods (`reorderTab`, `detachTab`, `mergeTab`) to `IDeckManagerStore` first so the state management is testable independently of the UI.
- Build the drag coordinator as a module-scope singleton (`tab-drag-coordinator.ts`) that manages the entire drag lifecycle imperatively -- no React state during drag (appearance-zone only, Rule 4).
- Use `setPointerCapture` on the tab element div, mirroring CardFrame's established pattern for reliable move/up tracking outside bounds.
- Ghost tab is an absolutely-positioned DOM element created imperatively at drag-start, appended as a child of the canvas container div (`#deck-container`), and destroyed on drop -- not React-rendered.
- Hit-test against all visible `.tug-tab-bar` elements on every pointer move to detect reorder position, detach (pointer exits source bar), and merge target (pointer enters another card's bar).
- Insertion indicator is a thin vertical bar injected into the TugTabBar div via DOM manipulation during drag; removed on drop.
- Drop-target highlight on tab bars uses a `data-drop-target="true"` attribute, styled purely in CSS.
- The last remaining tab on a card cannot be detached; the drag cancels and the tab returns to its source position.

#### Success Criteria (Measurable) {#success-criteria}

- Dragging a tab within its bar reorders it visually during drag and commits the new order on drop (manual verification + unit test on `reorderTab`).
- Dragging a tab out of its bar's bounding rect creates a new single-tab card at the drop position, and the source card loses that tab (manual verification + unit test on `detachTab`).
- Dragging a tab onto another card's tab bar adds it as a new tab in the target card and removes it from the source card (manual verification + unit test on `mergeTab`).
- A ghost tab element follows the pointer during drag, positioned as a child of `#deck-container` (manual verification).
- An insertion indicator appears at the correct position in the tab bar during reorder drag (manual verification).
- Tab bars that are valid merge targets show a drop-target highlight via `data-drop-target="true"` (manual verification + CSS inspection).
- The last tab on a card cannot be detached; drag cancels and tab returns to source position (manual verification + unit test).
- Single-tab cards show a tab bar drop zone preview when another tab is dragged over them (manual verification).

#### Scope {#scope}

1. `reorderTab(cardId, fromIndex, toIndex)` method on DeckManager and IDeckManagerStore
2. `detachTab(cardId, tabId, position)` method on DeckManager and IDeckManagerStore
3. `mergeTab(sourceCardId, tabId, targetCardId, insertAtIndex)` method on DeckManager and IDeckManagerStore
4. Tab drag coordinator singleton (`tab-drag-coordinator.ts`)
5. Ghost tab element (imperatively created/destroyed DOM element)
6. Insertion indicator (DOM-injected vertical bar in TugTabBar)
7. Drop-target highlight via `data-drop-target` attribute and CSS
8. Single-tab card drop zone preview during external tab drag
9. TugTabBar integration: `onPointerDown` handler on each tab div to initiate drag
10. CSS additions to `tug-tab-bar.css` for drag visual feedback

#### Non-goals (Explicitly out of scope) {#non-goals}

- Tab overflow handling during drag (Phase 5b4)
- Keyboard-based tab reordering
- Multi-tab drag (dragging multiple selected tabs at once)
- Cross-window tab drag
- Drag-to-reorder between different cards without merging (always merges into target)
- Animation/motion on reorder commit (deferred to Phase 7 motion system)

#### Dependencies / Prerequisites {#dependencies}

- Phase 5b (Card Tabs) complete: TugTabBar, TugDropdown, contentFactory, DeckManager tab methods, multi-tab rendering path in DeckCanvas
- Phase 5a2 (DeckManager Store) complete: subscribable store pattern with useSyncExternalStore
- Phase 5 (Tugcard, CardFrame) complete: pointer-capture drag pattern established in CardFrame
- `CardState.tabs`, `CardState.activeTabId`, `TabItem` types in `layout-tree.ts`

#### Constraints {#constraints}

- All appearance mutations during drag go through direct DOM style/class/attribute manipulation, never through React state (Rule 4, [D08, D09]).
- Never call `root.render()` after initial mount (Rule 1, [D40, D42]).
- Read external state with `useSyncExternalStore` only (Rule 2, [D40]).
- Ghost tab and insertion indicator are imperatively created DOM elements, not React components.
- The tab drag coordinator must not hold references to React components or state setters.
- DeckManager methods (`reorderTab`, `detachTab`, `mergeTab`) follow the established pattern: mutate deckState, shallow-copy, call `notify()`, schedule save.

#### Assumptions {#assumptions}

- Phase 5b is complete and merged: TugTabBar, TugDropdown, contentFactory, DeckManager tab methods (addTab/removeTab/setActiveTab), and multi-tab rendering path in DeckCanvas all exist.
- A new DeckManager method `reorderTab(cardId, fromIndex, toIndex)` will be added to `IDeckManagerStore`.
- Drag initiation uses `setPointerCapture` on the tab div element (same pattern as CardFrame drag).
- All appearance mutations during drag go through direct DOM style/class manipulation (appearance-zone), never through React state.
- The ghost tab is a separate DOM element created imperatively at drag start and destroyed at drag end -- not React-rendered.
- The insertion indicator is a thin vertical bar rendered inside the TugTabBar div using DOM manipulation.
- Tab bar drop-target highlight is applied via a data attribute (`data-drop-target="true"`) on the TugTabBar div, styled purely in CSS.
- The last tab on a card cannot be detached; the drag gesture returns the tab to its source position.
- New DeckManager method `detachTab(cardId, tabId, position)` handles detach: removes tab from source card, creates a new CardState with that tab at the given canvas position.
- New DeckManager method `mergeTab(sourceCardId, tabId, targetCardId, insertAtIndex)` handles merge: removes tab from source card and inserts into target card.
- When a tab is detached into a new card, the new card receives focus (appears on top). The new card is appended to the end of the cards array, giving it the highest z-index. This matches user intent: the user is spatially moving the tab to a new location, so their attention follows the detached tab.
- Ghost tab coordinate conversion (viewport to `#deck-container`-relative) assumes `#deck-container` has no CSS transforms (translate, scale, rotate). The current codebase does not apply transforms to this element; if transforms are added in the future, the coordinate conversion must be updated.
- Detach position uses the raw drop coordinates (converted to container-relative) as the new card's top-left position. This does not account for card chrome offset (title bar height, etc.), so the new card may appear slightly offset from the ghost tab's visual position. This is acceptable for initial implementation; a follow-on could adjust the position to account for chrome.
- Tab drag does not stop propagation on the initial pointerdown event; the source card receives focus via CardFrame's normal focus handling. The ghost tab at z-index 5000 (`GHOST_TAB_ZINDEX`) ensures visual continuity during drag regardless of z-order changes from focus.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses the conventions defined in the skeleton. All headings that will be referenced have explicit `{#anchor-name}` anchors. Steps cite decisions, specs, and anchors via the `**References:**` line. Dependencies cite step anchors via `**Depends on:**`.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Hit-test performance on many cards | med | low | RAF-throttled pointer moves; only query `.tug-tab-bar` elements once at drag start and cache rects | > 20 cards open simultaneously |
| Ghost tab z-index conflicts with cards or chrome | low | low | Ghost tab z-index set to 5000 (`GHOST_TAB_ZINDEX`), above `GALLERY_ZINDEX` (1000), below `DisconnectBanner` (9999) | Visual overlap reported |
| Detach creates card at invalid position | med | low | Clamp new card position to canvas bounds using same logic as CardFrame's `clampedPosition` | Card appears offscreen |

**Risk R01: Stale bounding rects during drag** {#r01-stale-rects}

- **Risk:** If a card is resized or moved by another mechanism while a tab drag is in progress, cached bounding rects for tab bars become stale, causing incorrect hit-test results.
- **Mitigation:** Cache bounding rects at drag-start only. Tab drag is a brief gesture (< 2 seconds typically). Document that concurrent card manipulation during tab drag is unsupported.
- **Residual risk:** Edge case of very slow drags during concurrent layout changes may produce incorrect hit results. Acceptable for initial implementation.

**Risk R02: Source card removal during detach of second-to-last tab** {#r02-source-card-removal}

- **Risk:** When a card has exactly two tabs and one is detached, the source card drops to one tab. The tab bar should disappear and the remaining tab should work correctly. DeckManager must handle this state transition cleanly.
- **Mitigation:** `detachTab` uses the `_spliceTabFromCards` helper for source-side tab removal, which handles the transition from multi-tab to single-tab correctly (active tab fallback, card removal if last tab). Tab bar visibility is driven by `tabs.length > 1` in Tugcard, which automatically hides the tab bar when the source card drops to one tab.
- **Residual risk:** None -- existing infrastructure handles this case.

---

### Design Decisions {#design-decisions}

> Record *decisions* (not options). Each decision includes the "why" so later phases don't reopen it accidentally.

#### [D01] Tab drag uses pointer-capture on the tab div element (DECIDED) {#d01-pointer-capture-tab}

**Decision:** Tab drag initiation uses `setPointerCapture` on the individual tab's div element inside TugTabBar, mirroring the CardFrame drag pattern.

**Rationale:**
- Pointer capture ensures reliable move/up tracking even when the pointer exits the tab bar or the card entirely.
- The CardFrame drag pattern (`card-frame.tsx` lines using `setPointerCapture`, RAF-throttled moves, appearance-zone mutations) is proven and well-understood in this codebase.
- Pointer capture on the tab div rather than the tab bar container gives correct event routing when dragging over other elements.

**Implications:**
- Pointer capture is **deferred** to `tabDragCoordinator.startDrag()` -- not applied during the initial threshold-detection phase. The tab div's `onPointerDown` registers document-level `pointermove`/`pointerup` listeners for threshold detection. Once the 5px drag threshold is exceeded, `startDrag()` calls `setPointerCapture(event.pointerId)` on the tab element and registers element-level `pointermove`/`pointerup` listeners for the actual drag.
- The existing `onClick` handler on tabs must be differentiated from drag initiation (a 5px distance threshold prevents clicks from triggering drags).
- Tab drag and card drag cannot conflict because their initiation paths are mutually exclusive: tab drag initiates from `onPointerDown` on tab divs inside the TugTabBar (accessory slot), while card drag initiates from `onPointerDown` on the CardFrame header div. These are different DOM elements in different parts of the card's DOM tree, so a single pointer event can only trigger one or the other.

#### [D02] Ghost tab is an imperatively-created canvas child (DECIDED) {#d02-ghost-tab-canvas-child}

**Decision:** The ghost tab is an absolutely-positioned DOM element created imperatively at drag start, appended as a child of the `#deck-container` div (the canvas container), z-indexed above all cards, and removed on drag end.

**Rationale:**
- Creating the ghost imperatively (not via React) means zero React re-renders during drag, consistent with Rule 4 (appearance changes go through CSS and DOM, never React state).
- Positioning as a child of `#deck-container` puts the ghost in the same coordinate space as CardFrames, simplifying position calculations.
- Z-index above all cards (`GHOST_TAB_ZINDEX = 5000`, above `GALLERY_ZINDEX = 1000` but below `DisconnectBanner` at 9999 and `ErrorBoundary` at 99999) ensures the ghost is always visible during drag without colliding with chrome overlays.

**Implications:**
- The ghost element must be styled to look like a tab (matching `.tug-tab` CSS but with reduced opacity and a subtle shadow).
- The ghost element's position is updated on every RAF-throttled pointer move via `style.left`/`style.top`.
- The ghost element is removed from the DOM on pointer up (drop or cancel).

#### [D03] Appearance-zone DOM manipulation during drag, structure-zone commit on drop (DECIDED) {#d03-appearance-then-structure}

**Decision:** During a tab drag, all visual feedback (ghost tab position, insertion indicator position, drop-target highlight) is applied via direct DOM manipulation (appearance zone). The actual state change (reorder, detach, or merge) is committed to DeckManager as a single structure-zone operation on pointer up.

**Rationale:**
- This is exactly the pattern CardFrame uses for card drag: RAF-throttled `style.left`/`style.top` during drag, `onCardMoved` on pointer up.
- Zero React re-renders during drag means smooth 60fps visual feedback regardless of card complexity.
- A single commit on drop avoids intermediate states where the store has partially-completed operations.

**Implications:**
- The drag coordinator must track drag state entirely in module-scope variables and refs (no React state).
- All visual elements (ghost, indicator, highlight attributes) must be cleaned up on drag end regardless of outcome (drop, cancel, or error).
- On pointer up, cleanup (listener removal, pointer capture release, visual element removal) must happen BEFORE the DeckManager commit. This matches CardFrame's pattern and prevents stale event routing if React synchronously unmounts the dragged tab element during the `notify()` call.

#### [D04] Detach threshold is tab bar bounding rect exit (DECIDED) {#d04-detach-threshold}

**Decision:** Tab detach is triggered when the pointer exits the TugTabBar div's bounding rect during a drag. This is a fast, binary check: inside the rect means reorder mode, outside means detach/merge mode.

**Rationale:**
- Matches browser tab-strip UX: dragging a tab out of the browser's tab bar detaches it into a new window immediately upon exit.
- A bounding rect check is computationally trivial (four comparisons) and runs efficiently on every pointer move.
- No distance threshold tuning needed -- the tab bar rect provides a natural boundary.

**Implications:**
- `getBoundingClientRect()` is called on the source tab bar at drag start and cached.
- When the pointer re-enters the source bar's rect after exiting, the drag mode switches back to reorder (the user can "cancel" a detach by returning to the bar).
- When the pointer is outside the source bar, all other tab bars are checked for merge target hit-testing.

#### [D05] Single-tab cards show drop zone preview during external drag (DECIDED) {#d05-single-tab-drop-zone}

**Decision:** When a tab drag is in progress and the pointer moves over any card (including single-tab cards), that card's tab bar area shows a drop-target highlight preview, indicating it is a valid merge target.

**Rationale:**
- Without a visible tab bar, single-tab cards appear unable to accept dropped tabs. A preview drop zone makes the merge affordance discoverable.
- The preview is purely visual (CSS driven via `data-drop-target` attribute on the Tugcard accessory div), applied and removed imperatively during drag.

**Implications:**
- Single-tab cards have a zero-height accessory div (`height: 0; overflow: hidden` in tugcard.tsx), so `getBoundingClientRect()` on the accessory returns a zero-height rect that cannot be hit-tested. Instead, the coordinator uses the `.card-frame[data-card-id]` rect (which already exists, see card-frame.tsx) as the hit-test proxy for single-tab cards. When the pointer enters a card-frame rect that has no visible tab bar (i.e., not in the `allTabBarRects` set), the coordinator treats it as a merge-eligible single-tab card.
- The visual drop-target feedback is still applied to the `.tugcard-accessory` div (setting `data-drop-target="true"` and CSS min-height to reveal the drop zone), but the hit-testing itself uses the card-frame rect.
- The `.tugcard-accessory` div must have a `data-card-id` attribute so the coordinator can find and apply the data attribute to the correct accessory div once a card-frame hit is detected.

#### [D06] Last tab cannot be detached (DECIDED) {#d06-last-tab-no-detach}

**Decision:** If a card has only one tab, that tab cannot be dragged (drag does not initiate). If a card has exactly two tabs, dragging one of them detaches it but the other remains as a single-tab card.

**Rationale:**
- Detaching the last tab would leave an empty card frame with no content, which is an invalid state. Removing the card entirely would be surprising -- the user dragged a tab, not closed a card.
- For two-tab cards, detaching one is well-defined: the source card transitions from multi-tab to single-tab (tab bar disappears), which is already handled by existing Tugcard rendering logic.

**Implications:**
- The `onPointerDown` handler on tab divs must check `tabs.length > 1` before initiating drag. Single-tab cards' tab bar is not visible anyway (tabs.length must be > 1 for the bar to render), so this is a safety check.
- `detachTab` in DeckManager uses the `_spliceTabFromCards` helper for the source side, which handles the multi-to-single transition (including active tab fallback).

#### [D07] Drag coordinator is a module-scope singleton (DECIDED) {#d07-drag-coordinator-singleton}

**Decision:** The tab drag coordinator is a module-scope singleton class instance (not a React component, not a hook). It manages the entire drag lifecycle: initiation, pointer tracking, hit-testing, visual feedback, and drop commit.

**Rationale:**
- Drag state must live outside React to avoid re-renders during drag (Rule 4).
- A singleton provides a single point of coordination for cross-card operations (merge targets, ghost positioning).
- Module-scope ensures the coordinator is accessible from TugTabBar's pointer event handlers without prop drilling.
- This follows the pattern of `selectionGuard` and `responder-chain.ts` -- module-scope singletons that manage cross-component concerns.

**Implications:**
- The coordinator holds a reference to the `IDeckManagerStore` instance, set once at initialization (similar to how action-dispatch holds a DeckManager reference).
- The coordinator exposes `startDrag(event, tabElement, cardId, tabId, tabs, store)` called from TugTabBar's pointer handler.
- All drag state (ghost element, cached rects, current mode) is coordinator instance state, not React state.

---

### Specification {#specification}

#### DeckManager Tab Drag Methods {#deck-manager-drag-methods}

**Spec S01: reorderTab** {#s01-reorder-tab}

```ts
reorderTab(cardId: string, fromIndex: number, toIndex: number): void
```

Moves the tab at `fromIndex` to `toIndex` within the card's tabs array. No-op if the card is not found, indices are out of bounds, or `fromIndex === toIndex`. Shallow-copies deckState, notifies subscribers, schedules save.

**Spec S02: detachTab** {#s02-detach-tab}

```ts
detachTab(cardId: string, tabId: string, position: { x: number; y: number }): string | null
```

Removes the tab identified by `tabId` from the card identified by `cardId`. Creates a new `CardState` with a single tab (the detached tab), positioned at `position` with default size (400x300). The position is clamped to canvas bounds using the same logic as CardFrame's `clampedPosition` helper, preventing the new card from appearing offscreen. Returns the new card's id, or null if the source card or tab is not found. No-op if the tab is the last tab on the card (enforced by the coordinator, but DeckManager also guards). Source-side tab removal is performed inline via the `_spliceTabFromCards` helper (not by calling `_removeTab`, which would double-fire notify). The new card is appended to the end of the cards array (highest z-index), so it appears on top and receives focus. Exactly one `notify()` and one `scheduleSave()` per call.

**Spec S03: mergeTab** {#s03-merge-tab}

```ts
mergeTab(sourceCardId: string, tabId: string, targetCardId: string, insertAtIndex: number): void
```

Removes the tab identified by `tabId` from `sourceCardId` and inserts it into `targetCardId` at `insertAtIndex`. No-op if `sourceCardId === targetCardId` (same-card merge is meaningless; use `reorderTab` instead). The merged tab becomes the active tab on the target card. If the source card has only one tab remaining after removal, the card is removed entirely (the `_spliceTabFromCards` helper handles this). If the source card has multiple tabs, the active tab selection follows the same fallback logic as `_removeTab`. Source-side tab removal is performed inline via `_spliceTabFromCards` (not by calling `_removeTab` or `removeCard`, which would double-fire notify). Exactly one `notify()` and one `scheduleSave()` per call.

**Last-tab merge behavior:** `mergeTab` does NOT guard against merging the sole tab from a single-tab card. The API fully supports it: the source card is removed and the tab appears on the target card. However, the drag coordinator prevents this path from being reached via drag gesture because single-tab cards have no visible tab bar and [D06] prevents drag initiation on single-tab cards. The DeckManager API remains complete and correct for programmatic use.

#### Tab Drag Coordinator API {#coordinator-api}

**Spec S04: TabDragCoordinator** {#s04-tab-drag-coordinator}

```ts
class TabDragCoordinator {
  /** Initialize with store reference. Called once from DeckCanvas or main. */
  init(store: IDeckManagerStore): void;

  /**
   * Start a tab drag. Called from TugTabBar's onPointerDown on a tab.
   * @param event - The pointer event that initiated the drag
   * @param tabElement - The DOM element of the dragged tab
   * @param cardId - The source card id
   * @param tabId - The tab being dragged
   * @param tabCount - Number of tabs on the source card (for last-tab guard)
   */
  startDrag(
    event: PointerEvent,
    tabElement: HTMLElement,
    cardId: string,
    tabId: string,
    tabCount: number,
  ): void;
}

/** Module-scope singleton instance */
export const tabDragCoordinator: TabDragCoordinator;
```

The coordinator manages all drag state internally:
- `dragActive: boolean` -- whether a drag is in progress
- `sourceCardId: string` -- the card the tab is being dragged from
- `sourceTabId: string` -- the tab being dragged
- `sourceBarRect: DOMRect` -- cached bounding rect of the source tab bar
- `containerRect: DOMRect` -- cached bounding rect of `#deck-container` for coordinate conversion
- `allTabBarRects: Array<{ cardId: string; rect: DOMRect; barElement: HTMLElement }>` -- cached rects of all visible `.tug-tab-bar` elements (multi-tab cards only)
- `allCardFrameRects: Array<{ cardId: string; rect: DOMRect; accessoryElement: HTMLElement }>` -- cached rects of all `.card-frame[data-card-id]` elements that do NOT have a visible tab bar (single-tab cards). The `accessoryElement` is the matching `.tugcard-accessory[data-card-id]` div inside this card, used to apply `data-drop-target` for visual feedback.
- `ghostElement: HTMLDivElement | null` -- the ghost tab DOM element
- `indicatorElement: HTMLDivElement | null` -- the insertion indicator DOM element
- `currentMode: 'reorder' | 'detach' | 'merge'` -- current drag mode based on pointer position
- `currentReorderIndex: number` -- insertion index for reorder mode
- `currentMergeTarget: { cardId: string; insertIndex: number } | null` -- merge target info

#### Ghost Tab Visual Spec {#ghost-tab-spec}

**Spec S05: Ghost Tab Element** {#s05-ghost-tab}

- Element type: `div`
- CSS class: `tug-tab-ghost`
- Parent: `#deck-container` (canvas container)
- Position: `position: absolute`
- Z-index: `5000` (named constant `GHOST_TAB_ZINDEX` in `tab-drag-coordinator.ts`; above `GALLERY_ZINDEX = 1000`, below `DisconnectBanner` at 9999)
- Size: matches the source tab element's `offsetWidth` x `offsetHeight`
- Content: clone of the source tab's inner HTML (icon + title)
- Opacity: `0.7`
- Background: `var(--td-surface-control)`
- Border: `1px solid var(--td-border)`
- Border-radius: `4px`
- Box-shadow: `0 2px 8px rgba(0,0,0,0.15)`
- Pointer-events: `none`
- Position updates: on every RAF-throttled pointer move, convert viewport coordinates to `#deck-container`-relative coordinates by subtracting the cached container rect origin, then apply `style.left = (clientX - containerRect.left - grabOffsetX)`, `style.top = (clientY - containerRect.top - grabOffsetY)` (where grab offsets are the pointer's position within the original tab at drag start). The container rect is cached at drag start alongside other bounding rects.

#### Insertion Indicator Visual Spec {#insertion-indicator-spec}

**Spec S06: Insertion Indicator Element** {#s06-insertion-indicator}

- Element type: `div`
- CSS class: `tug-tab-insert-indicator`
- Parent: the `.tug-tab-bar` div being targeted (source bar for reorder, target bar for merge)
- Position: `position: absolute`
- Width: `2px`
- Height: `100%` of the tab bar
- Background: `var(--td-accent)`
- Top: `0`
- Left: computed from the left edge of the tab at the insertion index
- Pointer-events: `none`
- Transition: `left var(--td-duration-fast) var(--td-easing-standard)` for smooth movement between positions
- **Known limitation:** The `.tug-tab-bar` has `overflow-x: auto`, which clips absolutely-positioned children. If tabs overflow the bar width, the insertion indicator may be clipped or invisible at overflow positions. This is acceptable because tab overflow handling during drag is explicitly deferred to Phase 5b4 (see non-goals). In the common case (tabs fit within bar width), the indicator renders correctly.

#### Drop-Target Highlight Spec {#drop-target-spec}

**Spec S07: Drop-Target Highlight** {#s07-drop-target-highlight}

- Applied by setting `data-drop-target="true"` on the `.tug-tab-bar` element (multi-tab cards) or `.tugcard-accessory` element (single-tab cards).
- CSS rule: background-color change to `var(--td-surface-control)`, border-bottom color change to `var(--td-accent)`.
- For single-tab cards: the accessory div gets a minimum height of `28px` (same as tab bar height) and the drop-target styling, making the drop zone visible.
- Removed by deleting the `data-drop-target` attribute on drag end or when the pointer moves away.

#### TugTabBar Integration {#tab-bar-drag-integration}

**Spec S08: TugTabBar Drag Initiation** {#s08-tab-bar-drag-init}

Each tab div in TugTabBar receives an `onPointerDown` handler that:

1. Checks `tabs.length > 1` (last-tab guard; single-tab bars are invisible anyway).
2. Records the pointer start position.
3. Registers **document-level** `pointermove` and `pointerup` listeners for threshold detection. No `setPointerCapture` during this phase -- pointer capture is deferred to `tabDragCoordinator.startDrag()` after the threshold is exceeded.
4. On the first `pointermove` that exceeds a 5px threshold from the start position, removes the document-level listeners and calls `tabDragCoordinator.startDrag(...)`, which captures the pointer on the tab element.
5. If `pointerup` fires before the threshold is exceeded, removes the document-level listeners and allows the existing `onClick` handler to fire normally (tab selection).

This threshold-based approach differentiates clicks from drags without interfering with the existing click-to-select behavior. Pointer capture is intentionally deferred so that sub-threshold pointer movements do not disrupt normal click event flow.

The TugTabBar must also expose its own DOM element via a `data-card-id` attribute on the `.tug-tab-bar` div so the coordinator can identify which card a tab bar belongs to.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/tab-drag-coordinator.ts` | Module-scope singleton managing tab drag lifecycle, hit-testing, and visual feedback |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TabDragCoordinator` | class | `tugdeck/src/tab-drag-coordinator.ts` | Singleton class managing drag state, ghost, indicator, hit-testing |
| `tabDragCoordinator` | const | `tugdeck/src/tab-drag-coordinator.ts` | Module-scope singleton instance |
| `GHOST_TAB_ZINDEX` | const | `tugdeck/src/tab-drag-coordinator.ts` | `5000` -- above GALLERY_ZINDEX (1000), below DisconnectBanner (9999) |
| `reorderTab` | method | `tugdeck/src/deck-manager.ts` | Reorder tab within a card's tabs array |
| `detachTab` | method | `tugdeck/src/deck-manager.ts` | Remove tab and create new single-tab card |
| `mergeTab` | method | `tugdeck/src/deck-manager.ts` | Move tab from one card to another |
| `_spliceTabFromCards` | private method | `tugdeck/src/deck-manager.ts` | Pure helper: removes tab from card in cards array, handles active-tab fallback and empty-card removal, no notify/save |
| `reorderTab` | interface method | `tugdeck/src/deck-manager-store.ts` | Added to `IDeckManagerStore` |
| `detachTab` | interface method | `tugdeck/src/deck-manager-store.ts` | Added to `IDeckManagerStore` |
| `mergeTab` | interface method | `tugdeck/src/deck-manager-store.ts` | Added to `IDeckManagerStore` |
| `.tug-tab-ghost` | CSS class | `tugdeck/src/components/tugways/tug-tab-bar.css` | Ghost tab element styling |
| `.tug-tab-insert-indicator` | CSS class | `tugdeck/src/components/tugways/tug-tab-bar.css` | Insertion indicator styling |
| `[data-drop-target]` | CSS rule | `tugdeck/src/components/tugways/tug-tab-bar.css` | Drop-target highlight on tab bars |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test DeckManager methods (reorderTab, detachTab, mergeTab) in isolation | Core state logic, edge cases, guard clauses |
| **Unit** | Test TabDragCoordinator hit-testing logic with mock rects | Hit-test correctness, mode transitions |
| **Integration** | Test TugTabBar drag initiation with coordinator | Click vs drag threshold, pointer capture |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add DeckManager tab drag methods and IDeckManagerStore interface {#step-1}

**Commit:** `feat(tugdeck): add reorderTab, detachTab, mergeTab to DeckManager`

**References:** [D03] Appearance then structure, [D06] Last tab no detach, Spec S01, Spec S02, Spec S03, (#deck-manager-drag-methods, #s01-reorder-tab, #s02-detach-tab, #s03-merge-tab, #assumptions)

**Artifacts:**
- Modified `tugdeck/src/deck-manager-store.ts`: add `reorderTab`, `detachTab`, `mergeTab` to `IDeckManagerStore` interface
- Modified `tugdeck/src/deck-manager.ts`: implement `_reorderTab`, `_detachTab`, `_mergeTab` private methods, bind in constructor, expose via public properties

**Tasks:**
- [ ] Add `reorderTab(cardId: string, fromIndex: number, toIndex: number): void` to `IDeckManagerStore`
- [ ] Add `detachTab(cardId: string, tabId: string, position: { x: number; y: number }): string | null` to `IDeckManagerStore`
- [ ] Add `mergeTab(sourceCardId: string, tabId: string, targetCardId: string, insertAtIndex: number): void` to `IDeckManagerStore`
- [ ] Implement `_reorderTab` in DeckManager: validate card exists, validate indices in bounds, splice tab from `fromIndex` and insert at `toIndex`, shallow-copy deckState, notify, scheduleSave
- [ ] Extract a private helper `_spliceTabFromCards(cards: CardState[], cardId: string, tabId: string): { updatedCards: CardState[]; removedTab: TabItem | null }` that removes a tab from a card within a cards array, handling active-tab fallback when the removed tab was active, and removing the card entirely if it was the last tab. Returns the updated cards array and the removed TabItem. This helper does NOT call `notify()` or `scheduleSave()` -- it is a pure data transform.
- [ ] Implement `_detachTab` in DeckManager: validate card and tab exist, guard against last-tab detach (return null). Call `_spliceTabFromCards` to remove tab from source card. Clamp the given position to canvas bounds (reuse CardFrame's `clampedPosition` logic or equivalent). Create new CardState with detached tab at clamped position with default size, append to end of the updated cards array (so it gets highest z-index and appears on top). Assign `this.deckState = { ...this.deckState, cards: updatedCards }`, then single `notify()` + `scheduleSave()`. Return new card id.
- [ ] Implement `_mergeTab` in DeckManager: guard no-op when `sourceCardId === targetCardId`, validate source card/tab and target card exist. Call `_spliceTabFromCards` to remove tab from source card. Insert removed tab into target at `insertAtIndex` (clamp to valid range), set merged tab as target's activeTabId. Assign `this.deckState = { ...this.deckState, cards: updatedCards }`, then single `notify()` + `scheduleSave()`.
- [ ] Bind all three methods in DeckManager constructor (same pattern as `addTab`, `removeTab`, `setActiveTab`)
- [ ] Add public property declarations for the three bound methods

**Tests:**
- [ ] T1: `reorderTab` moves tab from index 0 to index 2 in a 3-tab card
- [ ] T2: `reorderTab` no-op when fromIndex === toIndex
- [ ] T3: `reorderTab` no-op when card not found
- [ ] T4: `reorderTab` no-op when indices out of bounds
- [ ] T5: `detachTab` creates new card with detached tab, removes from source
- [ ] T6: `detachTab` returns null when card has only one tab (last-tab guard)
- [ ] T7: `detachTab` handles two-tab card: source transitions to single-tab
- [ ] T8: `detachTab` returns null when card not found
- [ ] T9: `mergeTab` moves tab from source to target at insertAtIndex
- [ ] T10: `mergeTab` removes source card when source had only one tab
- [ ] T11: `mergeTab` sets merged tab as activeTabId on target
- [ ] T12: `mergeTab` clamps insertAtIndex to target tabs length
- [ ] T13: `mergeTab` no-op when sourceCardId === targetCardId

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "reorderTab|detachTab|mergeTab"` passes
- [ ] `cd tugdeck && bun test` passes (no regressions)

---

#### Step 2: Add drag feedback CSS to tug-tab-bar.css {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add tab drag visual feedback CSS`

**References:** [D02] Ghost tab canvas child, [D03] Appearance then structure, Spec S05, Spec S06, Spec S07, (#ghost-tab-spec, #insertion-indicator-spec, #drop-target-spec)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-tab-bar.css`: new CSS classes and rules for ghost tab, insertion indicator, drop-target highlight, and single-tab drop zone preview

**Tasks:**
- [ ] Add `.tug-tab-ghost` class: position absolute, z-index 5000 (matches `GHOST_TAB_ZINDEX` constant, above `GALLERY_ZINDEX` 1000, below `DisconnectBanner` 9999), opacity 0.7, background `var(--td-surface-control)`, border `1px solid var(--td-border)`, border-radius 4px, box-shadow, pointer-events none, display inline-flex, align-items center, gap 4px, padding 0 8px, font matching `.tug-tab`, user-select none
- [ ] Add `position: relative` to the existing `.tug-tab-bar` rule (required so the absolutely-positioned insertion indicator is positioned relative to the tab bar, per Spec S06)
- [ ] Add `.tug-tab-insert-indicator` class: position absolute, width 2px, height 100%, top 0, background `var(--td-accent)`, pointer-events none, transition left with `var(--td-duration-fast) var(--td-easing-standard)`
- [ ] Add `.tug-tab-bar[data-drop-target="true"]` rule: background-color `var(--td-surface-control)`, border-bottom-color `var(--td-accent)`
- [ ] Add `.tugcard-accessory[data-drop-target="true"]` rule: min-height 28px, background-color `var(--td-surface-control)`, border-bottom `2px solid var(--td-accent)`, transition for smooth appearance
- [ ] Add `.tug-tab[data-dragging="true"]` rule: opacity 0.3, to dim the source tab during drag

**Tests:**
- [ ] T-CSS: Build succeeds with new CSS classes (verified by `bun run build` -- CSS parse errors would fail the build)

**Checkpoint:**
- [ ] CSS file parses without errors (no build errors from `cd tugdeck && bun run build`)

---

#### Step 3: Implement TabDragCoordinator singleton {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `feat(tugdeck): implement TabDragCoordinator for tab drag gestures`

**References:** [D01] Pointer capture on tab, [D02] Ghost tab canvas child, [D03] Appearance then structure, [D04] Detach threshold, [D05] Single-tab drop zone, [D06] Last tab no detach, [D07] Drag coordinator singleton, Spec S04, Spec S05, Spec S06, Spec S07, (#coordinator-api, #s04-tab-drag-coordinator, #ghost-tab-spec, #insertion-indicator-spec, #drop-target-spec)

**Artifacts:**
- New file `tugdeck/src/tab-drag-coordinator.ts`

**Tasks:**
- [ ] Create `TabDragCoordinator` class with `init(store: IDeckManagerStore)` method
- [ ] Implement `startDrag(event, tabElement, cardId, tabId, tabCount)`: guard `tabCount > 1`, call `setPointerCapture` on the tab element, cache `#deck-container` bounding rect for ghost coordinate conversion, cache source bar rect via `tabElement.closest('.tug-tab-bar')`. Build two-tier hit-test cache: (1) `allTabBarRects` -- query all `.tug-tab-bar[data-card-id]` elements (excluding source card), cache their rects and bar element refs; (2) `allCardFrameRects` -- query all `.card-frame[data-card-id]` elements whose cardId is NOT in the `allTabBarRects` set (these are single-tab cards with zero-height accessory divs), cache their frame rects and resolve the matching `.tugcard-accessory[data-card-id]` element inside each for visual feedback. The `data-card-id` attributes are added in Step 4 and are present at runtime before any drag can occur. Create ghost element, add `data-dragging="true"` to source tab, register `pointermove`/`pointerup` listeners on the tab element
- [ ] Implement `onPointerMove(e)`: RAF-throttled, update ghost position, determine current mode (inside source bar = reorder, outside source bar over another bar = merge, outside all bars = detach), update insertion indicator position and drop-target attributes accordingly
- [ ] Implement reorder hit-testing: for each tab in the source bar, compare pointer X against tab midpoints to determine insertion index, position insertion indicator at the correct tab boundary
- [ ] Implement merge hit-testing with two-tier strategy: (1) check pointer position against `allTabBarRects` (multi-tab cards) -- if hit, set `data-drop-target="true"` on the target tab bar, compute insertion index from pointer X against tab midpoints within that bar; (2) if no tab bar hit, check pointer position against `allCardFrameRects` (single-tab cards) -- if hit, set `data-drop-target="true"` on the card's `.tugcard-accessory` element (looked up from the cached `accessoryElement` ref), insertion index defaults to `tabs.length` (append). Clear `data-drop-target` from any previously-highlighted element when the target changes or pointer exits all targets
- [ ] Implement `onPointerUp(e)` with cleanup-before-commit ordering (matches CardFrame's established pattern where cleanup precedes the structure-zone commit): (1) remove `pointermove`/`pointerup` listeners from the tab element, (2) release pointer capture, (3) clean up all visual elements (remove ghost, remove indicator, remove all `data-drop-target` and `data-dragging` attributes), (4) THEN determine final action based on `currentMode` and call the appropriate DeckManager method (`reorderTab`, `detachTab`, or `mergeTab`). This ordering prevents stale event routing if React synchronously unmounts the tab element during the DeckManager `notify()` call (e.g., when detach or merge removes the tab from its source card)
- [ ] Implement `cleanup()`: remove ghost element, remove indicator element, clear `data-drop-target` from all tab bars (via `allTabBarRects` entries) and all accessory divs (via `allCardFrameRects` entries), clear `data-dragging` from the source tab, release pointer capture if still held
- [ ] Implement ghost creation: create div, apply `.tug-tab-ghost` class, clone source tab innerHTML (icon + title), set dimensions from source tab, append to `#deck-container`. Position uses container-relative coordinates (viewport coords minus cached `#deck-container` rect origin)
- [ ] Implement insertion indicator creation/update: create div with `.tug-tab-insert-indicator` class, insert into the appropriate tab bar, position via `style.left`
- [ ] Export `tabDragCoordinator` singleton instance
- [ ] Handle edge case: pointer exits the canvas entirely (cancel drag, return tab to source)

**Tests:**
- [ ] T14: `startDrag` guards against single-tab cards (tabCount <= 1)
- [ ] T15: Coordinator reorder hit-testing returns correct insertion index for pointer positions between tabs (unit test with mock rects)
- [ ] T16: Coordinator correctly transitions between reorder/detach/merge modes based on pointer position relative to cached rects

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with no TypeScript errors
- [ ] `cd tugdeck && bun test` passes (no regressions)

---

#### Step 4: Integrate drag initiation into TugTabBar {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): wire tab drag initiation in TugTabBar`

**References:** [D01] Pointer capture on tab, [D06] Last tab no detach, Spec S08, (#s08-tab-bar-drag-init, #tab-bar-drag-integration)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-tab-bar.tsx`: add `onPointerDown` handler to each tab div, add `data-card-id` attribute to the tab bar div
- Modified `tugdeck/src/components/tugways/tugcard.tsx`: pass `cardId` to TugTabBar via a new prop

**Tasks:**
- [ ] Add `cardId: string` prop to `TugTabBarProps` interface
- [ ] Add `data-card-id={cardId}` attribute to the `.tug-tab-bar` div element
- [ ] Add `data-card-id={cardId}` attribute to the `.tugcard-accessory` div in Tugcard (for single-tab card merge target identification)
- [ ] Add `onPointerDown` handler to each `.tug-tab` div: record start position, register **document-level** `pointermove` and `pointerup` listeners (no `setPointerCapture` during threshold detection). On `pointermove` exceeding 5px threshold, remove document-level listeners and call `tabDragCoordinator.startDrag(nativeEvent, tabElement, cardId, tabId, tabs.length)` which applies pointer capture. On `pointerup` before threshold, remove document-level listeners and allow normal `onClick` to fire
- [ ] Ensure click-to-select continues to work: pointer capture is deferred to `startDrag()`, so sub-threshold pointer movements do not disrupt the click event sequence
- [ ] Pass `cardId` from Tugcard to TugTabBar in the Tugcard render (add `cardId={cardId}` prop)

**Tests:**
- [ ] T17: Tab click (no movement) still triggers `onTabSelect` callback
- [ ] T18: Tab pointer down + 6px movement initiates drag (verify `tabDragCoordinator.startDrag` is called)

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with no TypeScript errors
- [ ] `cd tugdeck && bun test` passes (no regressions)

---

#### Step 5: Initialize coordinator in DeckCanvas and verify end-to-end {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugdeck): initialize TabDragCoordinator in DeckCanvas`

**References:** [D07] Drag coordinator singleton, [D05] Single-tab drop zone, Spec S04, (#coordinator-api, #s04-tab-drag-coordinator)

**Artifacts:**
- Modified `tugdeck/src/components/chrome/deck-canvas.tsx`: import `tabDragCoordinator` and call `tabDragCoordinator.init(store)` in a `useEffect` at mount

**Tasks:**
- [ ] Import `tabDragCoordinator` from `@/tab-drag-coordinator`
- [ ] In DeckCanvas, add `useEffect(() => { tabDragCoordinator.init(store); }, [store])` to provide the coordinator with the store reference
- [ ] Verify that the coordinator initialization happens before any tab drag can be attempted (useEffect runs after first render, which is before any user interaction). Re-initialization is safe because `init()` only overwrites the stored `IDeckManagerStore` reference; no cleanup is needed

**Tests:**
- [ ] T19: Manual end-to-end test: open browser, create multi-tab card, drag tab within bar to reorder, verify tab order changes on drop
- [ ] T20: Manual end-to-end test: drag tab out of bar, verify new card created at drop position
- [ ] T21: Manual end-to-end test: drag tab onto another card's tab bar, verify tab merges
- [ ] T22: Manual end-to-end test: drag tab over single-tab card, verify drop zone preview appears
- [ ] T23: Manual end-to-end test: attempt to drag last tab on a card, verify drag does not initiate

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with no TypeScript errors
- [ ] `cd tugdeck && bun test` passes (no regressions)
- [ ] Manual verification of all five drag gesture scenarios in browser

---

#### Step 6: Integration Checkpoint {#step-6}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] Pointer capture on tab, [D02] Ghost tab canvas child, [D03] Appearance then structure, [D04] Detach threshold, [D05] Single-tab drop zone, [D06] Last tab no detach, Spec S01, Spec S02, Spec S03, (#success-criteria)

**Tasks:**
- [ ] Verify all DeckManager tab drag methods work correctly via unit tests
- [ ] Verify ghost tab appears and follows pointer during drag
- [ ] Verify insertion indicator shows at correct position during reorder
- [ ] Verify drop-target highlight appears on merge targets
- [ ] Verify single-tab cards show drop zone preview
- [ ] Verify last-tab guard prevents detach
- [ ] Verify tab state persists after drag operations (reload page, verify layout)
- [ ] Verify no React re-renders during drag (check with React DevTools profiler)

**Tests:**
- [ ] T-INT1: All DeckManager unit tests pass (reorderTab, detachTab, mergeTab)
- [ ] T-INT2: All TabDragCoordinator unit tests pass (guards, hit-testing)
- [ ] T-INT3: All TugTabBar integration tests pass (click vs drag)
- [ ] T-INT4: End-to-end manual verification of all five drag gesture scenarios

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes (all existing + new tests)
- [ ] `cd tugdeck && bun run build` succeeds
- [ ] All success criteria verified manually in browser

---

### Deliverables and Checkpoints {#deliverables}

> This is the single place we define "done" for the phase. Keep it crisp and testable.

**Deliverable:** Tabs can be freely reordered, detached into new cards, and merged into existing cards via pointer-capture drag gestures, with ghost tab, insertion indicator, and drop-target visual feedback -- all following Rules of Tugways appearance-zone discipline.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Drag-to-reorder changes tab order within a card on drop (manual + unit tests)
- [ ] Drag-to-detach creates a new single-tab card at the drop position (manual + unit tests)
- [ ] Drag-to-merge moves a tab from one card to another (manual + unit tests)
- [ ] Ghost tab follows pointer during all drag modes (manual)
- [ ] Insertion indicator appears at correct position during reorder and merge (manual)
- [ ] Drop-target highlight appears on valid merge targets including single-tab cards (manual)
- [ ] Last tab on a card cannot be detached (manual + unit test)
- [ ] Zero React re-renders during drag (React DevTools profiler)
- [ ] Tab state persists after drag operations via existing serialization (manual: drag, reload, verify)
- [ ] All existing tests continue to pass (`cd tugdeck && bun test`)

**Acceptance tests:**
- [ ] T1-T13: DeckManager unit tests for reorderTab, detachTab, mergeTab
- [ ] T14-T16: TabDragCoordinator unit tests for guards and hit-testing
- [ ] T17-T18: TugTabBar integration tests for click vs drag differentiation
- [ ] T19-T23: Manual end-to-end tests for all drag gesture scenarios

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 5b4: Tab overflow handling interacts with drag -- dragging into an overflowing card triggers re-measurement
- [ ] Motion/animation on reorder commit (Phase 7 motion system)
- [ ] Keyboard-based tab reordering
- [ ] Multi-tab drag (selecting and dragging multiple tabs at once)
- [ ] Accessibility: announce drag operations to screen readers

| Checkpoint | Verification |
|------------|--------------|
| DeckManager methods | `cd tugdeck && bun test -- --grep "reorderTab\|detachTab\|mergeTab"` |
| Full test suite | `cd tugdeck && bun test` |
| Build | `cd tugdeck && bun run build` |
| Manual drag gestures | All five scenarios verified in browser |
