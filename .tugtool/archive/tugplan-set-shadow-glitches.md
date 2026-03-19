<!-- tugplan-skeleton v2 -->

## Fix Set Shadow Glitches {#set-shadow-glitches}

**Purpose:** Eliminate four distinct shadow-related visual bugs in the tugdeck card set system so that .set-shadow elements are correctly created, updated, and removed throughout all card lifecycle events (drag break-out, merge, store mutations, resize).

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-05 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The card set shadow system renders a single `.set-shadow` DOM element per set, providing a unified hull shadow around snapped card groups. Four bugs cause shadow elements to become stale, orphaned, or absent during specific user interactions: break-out drag, tab-bar merge, store mutations (close/undo/redo), and resize. All four bugs are appearance-zone issues — the shadow DOM elements get out of sync with the actual card geometry.

The root cause is that `updateSetAppearance` (which recreates all shadows from scratch) is not called at the right times, and individual shadow references are not cleaned up when they should be.

#### Strategy {#strategy}

- Fix each bug as an independent, testable change with its own commit.
- Order fixes from simplest (one-line DOM removal) to most involved (store subscriber + resize tracking).
- All fixes are purely imperative DOM mutations — no new React state, no additional re-renders, no calls to `root.render()`.
- Validate each fix against Rules of Tugways before committing.
- Add an integration checkpoint at the end to verify all four fixes work together.

#### Success Criteria (Measurable) {#success-criteria}

- After break-out (modifier key during set-move drag), no `.set-shadow` elements remain in the DOM for the broken-out card's former set until `updateSetAppearance` runs at drag-end (SC1).
- After merge (card dropped on tab bar), no orphaned `.set-shadow` elements remain in the DOM (SC2).
- After any store mutation (card close, undo, redo), `.set-shadow` elements reflect the current set membership within one `store.subscribe` notification cycle (SC3).
- During resize of a set member, the `.set-shadow` element translates to match the card's geometry changes frame-by-frame (SC4).

#### Scope {#scope}

1. Bug 1: Remove shadow DOM element on break-out (card-frame.tsx, applyDragFrame break-out block)
2. Bug 2: Call updateSetAppearance before early return in merge handler (card-frame.tsx, onPointerUp merge block)
3. Bug 3: Add store subscriber in DeckCanvas for shadow updates + defensive drag-start cleanup (deck-canvas.tsx)
4. Bug 4: Track and translate shadow during resize (card-frame.tsx, handleResizeStart)

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the hull polygon computation algorithm
- Modifying the flash feedback system
- Adding tests for snap computation or set detection logic
- Changing the shadow visual appearance (CSS)

#### Dependencies / Prerequisites {#dependencies}

- Current `updateSetAppearance` function in card-frame.tsx must be exported and working correctly (it is)
- `store.subscribe()` interface available on IDeckManagerStore (it is, per deck-manager-store.ts line 26)

#### Constraints {#constraints}

- Rule 1: Never call `root.render()` after initial mount [D40, D42]
- Rule 2: Read external state with `useSyncExternalStore` only — but the store subscriber here triggers a DOM side-effect, not a React re-render, so `useEffect` with `store.subscribe()` is compliant [D40]
- Rule 4: Appearance changes go through CSS and DOM, never React state [D08, D09]
- Rule 7: CardFrame owns geometry — shadow tracking during resize stays in CardFrame [D01, D03]
- Rule 8: One responsibility per layer — DeckCanvas owns the subscriber wiring, CardFrame owns the imperative shadow manipulation [D01, D03, D05]

#### Assumptions {#assumptions}

- `updateSetAppearance` is idempotent: it removes all existing `.set-shadow` elements and recreates from scratch. Calling it extra times is safe (just potentially redundant work).
- The `store.subscribe()` callback fires synchronously after every state mutation (standard React external store contract).
- The container div (containerRef) is always available after mount.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors on all headings and stable labels for all artifacts. See skeleton for full conventions.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions exist for this plan. All four bugs have clear root causes and the fix strategies are decided.

---

### Design Decisions {#design-decisions}

#### [D01] Remove shadow DOM element immediately on break-out (DECIDED) {#d01-remove-shadow-on-breakout}

**Decision:** At the break-out transition point in `applyDragFrame` (line 538 of card-frame.tsx), call `dragShadowEl.current.parentNode?.removeChild(dragShadowEl.current)` before clearing the ref to null.

**Rationale:**
- The current code clears the ref but leaves the DOM element orphaned until drag-end.
- One-line imperative DOM removal is consistent with Rule 4.
- The shadow will be recreated correctly by `updateSetAppearance` at drag-end via `postActionSetUpdate`.

**Implications:**
- During the break-out-to-drag-end window, the former set has no shadow. This is correct because the set no longer exists after break-out.

#### [D02] Call updateSetAppearance before merge early return (DECIDED) {#d02-shadow-cleanup-on-merge}

**Decision:** In the merge handler's early-return path (card-frame.tsx onPointerUp, around line 660-672), call `updateSetAppearance(canvasBounds, frame.parentElement)` before the `return` statement. Do not call `postActionSetUpdate` (no flash needed on merge).

**Rationale:**
- The merge handler currently clears `dragShadowEl.current = null` and returns early without calling any shadow cleanup.
- `updateSetAppearance` removes all `.set-shadow` elements and recreates only those that match current card geometry. After merge, the source card may be removed, so old shadows must be cleaned up.
- Shadow-only cleanup (no flash) is the correct behavior per user answer.

**Implications:**
- The merge path must read `dragCanvasBounds.current` (already available in closure) and `frame.parentElement` to pass to `updateSetAppearance`.

#### [D03] Store subscriber for shadow updates on mutations (DECIDED) {#d03-store-subscriber-shadow}

**Decision:** Register a `store.subscribe()` callback in DeckCanvas via `useEffect` that calls `updateSetAppearance` on every store notification. Also add a defensive sweep at drag-start in CardFrame that removes orphaned `.set-shadow` elements.

**Rationale:**
- The current `useLayoutEffect([], ...)` only runs once at mount. Store mutations (card close, undo, redo) change card geometry without triggering shadow updates.
- A store subscriber ensures shadows are always current after any state change.
- The subscriber uses `store.subscribe()` in a `useEffect` — NOT `useSyncExternalStore` — because the callback only triggers a DOM side-effect (imperative shadow recreation), not a React re-render. This complies with Rule 2 (which applies to reading state into React) and Rule 4 (appearance changes via DOM).
- The defensive drag-start sweep is belt-and-suspenders: it cleans up any shadows that might have been missed.

**Implications:**
- `updateSetAppearance` will be called on every store notification, including ones that don't change card geometry. This is acceptable because the function is fast (queries DOM, diffs sets, rebuilds shadow divs).
- The `useEffect` returns an unsubscribe function for cleanup.
- A module-level gesture flag in card-frame.tsx gates the subscriber via `isGestureActive()` / `setGestureActive(v)` getter/setter functions. When a drag or resize is in progress, the subscriber skips `updateSetAppearance` to avoid invalidating the shadow element reference held by the active gesture. Getter/setter functions are used instead of `export let` to avoid fragile ES module live binding issues.

#### [D04] Translate shadow during resize via position delta (DECIDED) {#d04-resize-shadow-translate}

**Decision:** At resize-start in `handleResizeStart`, snapshot the shadow element and its origin (same pattern as `dragShadowEl`/`dragShadowOrigin` at drag-start). In `applyResizeFrame`, translate the shadow wrapper by the delta between the card's current position and its start position.

**Rationale:**
- During resize, the card's position may change (e.g., resizing from the north or west edge moves the top-left corner). The shadow must track this movement.
- Position-translation only (not full shadow rebuild per frame) is consistent with the set-move drag pattern and avoids expensive per-frame hull recomputation.
- The shadow is fully rebuilt by `postActionSetUpdate` at resize-end, so per-frame translation only needs to be approximate.

**Implications:**
- Only the shadow wrapper's `left`/`top` are updated during resize. The shadow's width/height and clip-path are NOT updated per-frame — they are rebuilt at resize-end.
- For east/south-only resizes, the card position doesn't change, so the shadow stays put (correct behavior — the shadow wrapper position doesn't need to move when only width/height change).
- Known visual artifact: during sash resizes (shared edge between two set members), both cards change size simultaneously but the shadow's clip-path remains frozen at the pre-resize hull shape. The shadow position translates correctly but its outline will be slightly misaligned until `postActionSetUpdate` rebuilds it at resize-end. This is an acceptable transient artifact consistent with the position-translation-only approach.

---

### Specification {#specification}

#### Bug Fix Details {#bug-fix-details}

**Spec S01: Break-out shadow removal** {#s01-breakout-removal}

Location: `card-frame.tsx`, `applyDragFrame` function, break-out detection block (around line 517-546).

Before clearing `dragShadowEl.current = null`, add:
```typescript
if (dragShadowEl.current) {
  dragShadowEl.current.parentNode?.removeChild(dragShadowEl.current);
}
```

**Spec S02: Merge shadow cleanup** {#s02-merge-cleanup}

Location: `card-frame.tsx`, `onPointerUp` function, merge early-return block (around line 651-673).

Before the `return` statement, after clearing shadow ref, add:
```typescript
updateSetAppearance(dragCanvasBounds.current, frame.parentElement);
```

Note: `dragCanvasBounds` is already captured in the drag-start closure. `frame.parentElement` is the containerRef div.

**Spec S03: Store subscriber in DeckCanvas** {#s03-store-subscriber}

Location: `deck-canvas.tsx`, after the existing `useLayoutEffect` for initial shadow creation.

Add a new `useEffect` that subscribes to store changes. The subscriber must skip shadow rebuilds when a drag or resize is in progress, because `updateSetAppearance` removes all `.set-shadow` elements and would invalidate the `dragShadowEl` or `resizeShadowEl` reference held by the active gesture. Use getter/setter functions (`isGestureActive()` / `setGestureActive(v)`) backed by a private module-level boolean in card-frame.tsx, called at drag-start/resize-start and their respective pointer-up handlers:

```typescript
useEffect(() => {
  const unsubscribe = store.subscribe(() => {
    if (isGestureActive()) return; // skip while drag/resize owns shadow refs
    const containerEl = containerRef.current;
    if (!containerEl) return;
    const canvasBounds = containerEl.getBoundingClientRect();
    updateSetAppearance(canvasBounds.width > 0 ? canvasBounds : null, containerEl);
  });
  return unsubscribe;
}, [store]);
```

The gesture state is exposed via `isGestureActive()` and `setGestureActive(v)` functions exported from `card-frame.tsx`. Using getter/setter functions (rather than `export let`) avoids fragile ES module live bindings that break silently if the import is destructured or aliased. `setGestureActive(true)` is called at the start of `handleDragStart` and `handleResizeStart`. `setGestureActive(false)` is called at every exit point of the drag and resize `onPointerUp` handlers — including the merge early-return path — after all `onCardMoved` calls but before `postActionSetUpdate` or `updateSetAppearance`.

This uses `store.subscribe()` directly (not `useSyncExternalStore`) because the callback performs a DOM side-effect, not a React state update.

**Spec S04: Defensive drag-start shadow sweep** {#s04-drag-start-sweep}

Location: `card-frame.tsx`, `handleDragStart` callback. Insert immediately before the shadow lookup block (around line 407, after set membership computation at lines 367-405 and before the `dragShadowEl.current = null` reset at line 410). This placement ensures set membership is already computed when the rebuild runs, and the subsequent shadow lookup references a freshly-built element.

Add a sweep that removes orphaned `.set-shadow` elements and rebuilds:
```typescript
// Defensive sweep: remove all .set-shadow elements before drag begins.
// The store subscriber recreates them, but stale shadows from a missed
// update could interfere with drag shadow tracking.
const container = frame.parentElement;
if (container) {
  const staleShadows = container.querySelectorAll<HTMLElement>(".set-shadow");
  staleShadows.forEach((el) => el.parentNode?.removeChild(el));
}
```

Then re-run `updateSetAppearance` to rebuild clean shadows before looking up the drag shadow:
```typescript
updateSetAppearance(dragCanvasBounds.current, container);
```

**Spec S05: Resize shadow tracking** {#s05-resize-shadow-tracking}

Location: `card-frame.tsx`, `handleResizeStart` callback.

At resize-start, after computing `resizePreSetMemberIds`, snapshot the shadow element:
```typescript
let resizeShadowEl: HTMLElement | null = null;
let resizeShadowOriginX = 0;
let resizeShadowOriginY = 0;
if (resizePreSetMemberIds.length > 0) {
  const idString = resizePreSetMemberIds.slice().sort().join(",");
  const shadowEl = document.querySelector<HTMLElement>(
    `.set-shadow[data-set-card-ids="${idString}"]`,
  );
  if (shadowEl) {
    resizeShadowEl = shadowEl;
    resizeShadowOriginX = parseFloat(shadowEl.style.left) || 0;
    resizeShadowOriginY = parseFloat(shadowEl.style.top) || 0;
  }
}
```

In `applyResizeFrame`, after applying the resize to the frame, translate the shadow:
```typescript
if (resizeShadowEl) {
  const deltaX = r.left - startLeft;
  const deltaY = r.top - startTop;
  resizeShadowEl.style.left = `${resizeShadowOriginX + deltaX}px`;
  resizeShadowEl.style.top = `${resizeShadowOriginY + deltaY}px`;
}
```

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Store subscriber fires too frequently | low | med | updateSetAppearance is fast; profile if needed | Visible lag on rapid mutations |
| Defensive drag-start sweep removes shadow being used by another drag | low | low | Only one drag can be active at a time (pointer capture) | Multi-touch scenarios |
| Store subscriber fires during active drag/resize | med | med | gestureActive flag gates subscriber; shadows rebuilt at gesture end | Shadow ref invalidated during drag |

**Risk R01: Store subscriber performance** {#r01-subscriber-perf}

- **Risk:** `updateSetAppearance` called on every store notification could cause jank with many cards.
- **Mitigation:** The function queries a small number of DOM elements and does simple geometry. Only rebuild shadows when set membership actually changes (future optimization if needed).
- **Residual risk:** With 50+ cards, the DOM query overhead may become noticeable. Not a concern for current usage patterns.

**Risk R02: Store subscriber invalidates gesture shadow refs** {#r02-subscriber-gesture-conflict}

- **Risk:** If the store subscriber calls `updateSetAppearance` while a drag or resize is in progress, it removes all `.set-shadow` elements, invalidating the `dragShadowEl` or `resizeShadowEl` reference held by the active gesture. This would cause the shadow to vanish mid-gesture and the translate logic to operate on a detached element.
- **Mitigation:** A module-level gesture flag (via `isGestureActive()` / `setGestureActive()`) gates the subscriber. The flag is set at gesture-start and cleared at gesture-end. `postActionSetUpdate` (called at gesture-end) rebuilds shadows after the flag is cleared, so no updates are lost.
- **Residual risk:** If the flag is not cleared due to an exception in `onPointerUp`, the subscriber would be permanently disabled. This is mitigated by the defensive sweep at drag-start (Step 4), which rebuilds shadows regardless of the flag.

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Remove shadow DOM element on break-out {#step-1}

**Commit:** `fix(tugdeck): remove shadow DOM element on break-out detach`

**References:** [D01] Remove shadow DOM element immediately on break-out, Spec S01, (#s01-breakout-removal, #context, #bug-fix-details)

**Artifacts:**
- Modified: `tugdeck/src/components/chrome/card-frame.tsx`

**Tasks:**
- [ ] In `applyDragFrame`, in the break-out detection block (around line 536-538), add `dragShadowEl.current.parentNode?.removeChild(dragShadowEl.current)` before the line `dragShadowEl.current = null`
- [ ] Wrap the removal in a null check: `if (dragShadowEl.current) { ... }`

**Tests:**
- [ ] Manual: drag a set member, press Alt to break out, verify no orphaned `.set-shadow` in DOM inspector during the remainder of the drag

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` completes without errors
- [ ] Manual verification: break-out drag leaves no stale shadow element

---

#### Step 2: Clean up shadow on merge early return {#step-2}

**Depends on:** #step-1

**Commit:** `fix(tugdeck): clean up shadow on merge early return`

**References:** [D02] Call updateSetAppearance before merge early return, Spec S02, (#s02-merge-cleanup, #context)

**Artifacts:**
- Modified: `tugdeck/src/components/chrome/card-frame.tsx`

**Tasks:**
- [ ] In `onPointerUp`, in the merge handler early-return block (around line 660-672), add `updateSetAppearance(dragCanvasBounds.current, frame.parentElement)` before the `return` statement
- [ ] Place it after the line `dragShadowEl.current = null` to ensure the ref is cleared before the full rebuild
- [ ] Note: Step 3 will later add `setGestureActive(false)` to this same early-return block, placed before the `updateSetAppearance` call added here. The two changes are ordered so the gesture flag is cleared before the shadow rebuild runs

**Tests:**
- [ ] Manual: drag a card onto another card's tab bar (merge), verify no orphaned `.set-shadow` in DOM inspector

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` completes without errors
- [ ] Manual verification: merge leaves no stale shadow element

---

#### Step 3: Add store subscriber for shadow updates {#step-3}

**Depends on:** #step-2

**Commit:** `fix(tugdeck): add store subscriber for shadow updates on mutations`

**References:** [D03] Store subscriber for shadow updates on mutations, Spec S03, (#s03-store-subscriber, #context, #constraints)

**Artifacts:**
- Modified: `tugdeck/src/components/chrome/card-frame.tsx` (gestureActive flag: declaration, set/clear in drag and resize handlers)
- Modified: `tugdeck/src/components/chrome/deck-canvas.tsx` (store subscriber with gestureActive guard)

**Tasks:**
- [ ] In `card-frame.tsx`, add a module-level `isGestureActive()` getter and `setGestureActive(v: boolean)` setter backed by a private `let _gestureActive = false`. Export both functions. This avoids fragile `export let` live bindings that break if the import is destructured or aliased
- [ ] Call `setGestureActive(true)` at the start of `handleDragStart` and `handleResizeStart` (before any DOM queries or state snapshots)
- [ ] Call `setGestureActive(false)` at every exit point of the drag and resize `onPointerUp` handlers. Placement must be after all `onCardMoved` calls (which fire store mutations) but before `postActionSetUpdate` (which calls `updateSetAppearance`). This ensures the subscriber does not fire redundantly during `onCardMoved` commits, while `postActionSetUpdate` runs with the flag cleared so its `updateSetAppearance` call is the authoritative rebuild. Specifically:
  - Drag normal exit: after `onCardMoved` calls for the dragged card and set members (around line 732), before `postActionSetUpdate` at line 736
  - Drag merge early-return: in the merge early-return block (around line 668), before the `return` statement. This exit path has no `postActionSetUpdate`; Step 2 adds `updateSetAppearance` here instead. The flag must be cleared before that call so the subscriber is re-enabled
  - Resize normal exit: after `onCardMoved` calls for the resized card and sash neighbor (around line 1075), before `postActionSetUpdate` at line 1079
- [ ] In `deck-canvas.tsx`, import `isGestureActive` from `card-frame.tsx`
- [ ] Add a `useEffect` after the existing `useLayoutEffect` that subscribes to `store.subscribe()`
- [ ] In the subscriber callback, check `if (isGestureActive()) return` to skip updates while a drag or resize owns shadow refs
- [ ] If not skipped, get `containerRef.current`, compute canvas bounds, and call `updateSetAppearance(canvasBounds, containerEl)`
- [ ] Return `unsubscribe` from the `useEffect` cleanup function
- [ ] Verify hook order comment at top of DeckCanvas is updated to include the new `useEffect`

**Tests:**
- [ ] Manual: create a set of two cards, close one card, verify the remaining card's shadow is removed immediately
- [ ] Manual: create a set, undo a card close, verify the shadow is recreated
- [ ] Manual: while dragging a set member, trigger a store mutation (e.g., keyboard shortcut to add a card) — verify no crash or shadow loss during drag

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` completes without errors
- [ ] Manual verification: card close/undo correctly updates shadows

---

#### Step 4: Add defensive shadow sweep at drag-start {#step-4}

**Depends on:** #step-3

**Commit:** `fix(tugdeck): add defensive shadow sweep at drag-start`

**References:** [D03] Store subscriber for shadow updates on mutations, Spec S04, (#s04-drag-start-sweep, #context)

**Artifacts:**
- Modified: `tugdeck/src/components/chrome/card-frame.tsx`

**Tasks:**
- [ ] In `handleDragStart`, insert the defensive sweep immediately before the shadow lookup block (around line 407), after set membership computation (lines 367-405) is complete. Note: `setGestureActive(true)` (from Step 3) runs at the very start of `handleDragStart`, so the gesture flag is already set before this sweep executes — the store subscriber will not interfere
- [ ] Remove all `.set-shadow` elements from the container, then call `updateSetAppearance(dragCanvasBounds.current, container)` to rebuild clean shadows
- [ ] The existing shadow lookup at lines 410-424 naturally follows the rebuild, so `dragShadowEl` will reference a freshly-built element

**Tests:**
- [ ] Manual: rapidly close a card and start dragging another card, verify no stale shadows

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` completes without errors
- [ ] Manual verification: drag-start always has correct shadow state

---

#### Step 5: Track and translate shadow during resize {#step-5}

**Depends on:** #step-4

**Commit:** `fix(tugdeck): track and translate shadow during resize`

**References:** [D04] Translate shadow during resize via position delta, Spec S05, (#s05-resize-shadow-tracking, #context, #constraints)

**Artifacts:**
- Modified: `tugdeck/src/components/chrome/card-frame.tsx`

**Tasks:**
- [ ] In `handleResizeStart`, after computing `resizePreSetMemberIds`, snapshot the shadow element and its origin position into local variables (`resizeShadowEl`, `resizeShadowOriginX`, `resizeShadowOriginY`)
- [ ] In `applyResizeFrame`, after applying the resize to the frame element, compute the position delta (`r.left - startLeft`, `r.top - startTop`) and apply it to the shadow wrapper's left/top
- [ ] Verify that east/south-only resizes produce zero delta (no shadow movement needed)

**Tests:**
- [ ] Manual: create a set of two cards, resize one from the north edge, verify the shadow tracks the card's position change
- [ ] Manual: resize from the east edge only, verify the shadow does not move (only width changes)

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` completes without errors
- [ ] Manual verification: resize of set members correctly tracks shadow position

---

#### Step 6: Integration Checkpoint {#step-6}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] Remove shadow DOM element immediately on break-out, [D02] Call updateSetAppearance before merge early return, [D03] Store subscriber for shadow updates on mutations, [D04] Translate shadow during resize via position delta, (#success-criteria)

**Tasks:**
- [ ] Verify all four bug fixes work together end-to-end
- [ ] Open DOM inspector, perform the following sequence: create set, break out (Bug 1), undo break-out, merge into tab bar (Bug 2), undo merge, close a card (Bug 3), undo close, resize a set member (Bug 4)
- [ ] At each step, verify `.set-shadow` elements in the DOM match the expected set membership
- [ ] Verify no console errors or warnings related to shadow elements

**Tests:**
- [ ] Manual end-to-end: full sequence of create set, break out, undo, merge, undo, close, undo, resize — verify `.set-shadow` count matches expected set count at each step

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` completes without errors
- [ ] Full manual walkthrough of all four bug scenarios passes with no orphaned or missing shadows

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** All four shadow glitch bugs fixed — shadow elements are correctly created, updated, and removed throughout all card lifecycle events.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Break-out drag immediately removes the shadow DOM element (SC1)
- [ ] Merge early return cleans up shadow elements (SC2)
- [ ] Store mutations (close, undo, redo) trigger shadow updates via subscriber (SC3)
- [ ] Resize of set members translates shadow in real-time (SC4)
- [ ] `cd tugdeck && bun run build` passes
- [ ] No Rules of Tugways violations: no new React state, no `root.render()`, no `useSyncExternalStore` for the side-effect subscriber

**Acceptance tests:**
- [ ] Manual: break-out drag → no orphaned shadow
- [ ] Manual: merge → no orphaned shadow
- [ ] Manual: card close in set → shadow updates immediately
- [ ] Manual: resize set member → shadow tracks position

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Optimize `updateSetAppearance` to diff set membership before rebuilding (avoid unnecessary DOM churn)
- [ ] Add automated visual regression tests for shadow positioning
- [ ] Consider debouncing the store subscriber if performance becomes a concern with many cards

| Checkpoint | Verification |
|------------|--------------|
| Build passes | `cd tugdeck && bun run build` |
| No shadow orphans after break-out | DOM inspector during break-out drag |
| No shadow orphans after merge | DOM inspector after tab-bar drop |
| Shadows update on store mutations | DOM inspector after card close/undo |
| Shadow tracks during resize | Visual inspection during resize drag |
