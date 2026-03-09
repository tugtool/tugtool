<!-- tugplan-skeleton v2 -->

## Tugways Phase 5f3: State Preservation Bug Fixes {#phase-5f3}

**Purpose:** Fix three state-preservation bugs discovered after Phase 5f2: missing save-on-close handlers, selection lost on click-back into a card, and scroll clamping caused by wrong restore order.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5f3-state-preservation-more-fixes |
| Last updated | 2026-03-08 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phase 5f and 5f2 delivered per-tab state preservation (scroll, selection, card content) and inactive selection highlighting via the CSS Custom Highlight API. Manual testing after 5f2 revealed three bugs that compromise the reliability of the preservation system:

1. **No save on close.** There is no `visibilitychange` or `beforeunload` handler. The currently-active tab's state is never persisted when the user closes the app or navigates away.
2. **Selection lost on click-back.** The CSS Custom Highlight paints a visual ghost of the selection in inactive cards, but clicking back into that card clears the highlight without restoring the real `Selection`. The user sees the dimmed highlight, clicks the card, and the highlight vanishes with nothing restored.
3. **Scroll clamping from wrong restore order.** The RAF callback currently restores scroll, selection, and content in the wrong order. Content must be restored first so the DOM has its full structure and scrollable height before scroll and selection are applied.

#### Strategy {#strategy}

- Fix Bug 3 (restore order) first because it is the most contained change and touches `tugcard.tsx` only.
- Fix Bug 1 (save on close) second because it requires interface changes to `IDeckManagerStore` and `MockDeckManagerStore`.
- Fix Bug 2 (selection click-back) third because it touches `SelectionGuard` and requires new state management (`pendingHighlightRestore`).
- Add tests for each bug fix in the same step as the fix.
- Each fix is a separate flat step with its own commit.
- Final integration checkpoint verifies all three fixes work together.

#### Success Criteria (Measurable) {#success-criteria}

- Content restore (`onRestore`) is called before the RAF callback in the activation `useLayoutEffect` (verified by test assertion on call order).
- `visibilitychange` (hidden) and `beforeunload` both trigger all registered save callbacks and flush dirty tab states immediately (verified by unit test).
- Clicking back into a card with a stored highlight range restores the real Selection when the click is a simple click (collapsed selection after pointerup), and discards the stash when the user drags to create a new selection (verified by unit test).
- All existing tests continue to pass (`bun test`).

#### Scope {#scope}

1. Fix restore order in `tugcard.tsx` activation `useLayoutEffect` to call `onRestore` synchronously before scheduling RAF.
2. Add `registerSaveCallback` / `unregisterSaveCallback` to `IDeckManagerStore` and implement in `DeckManager`.
3. Add `visibilitychange` and `beforeunload` listeners in `DeckManager` that call all registered save callbacks then flush dirty tab states.
4. Each `Tugcard` registers `saveCurrentTabState` via `registerSaveCallback` in `useLayoutEffect`.
5. Add `pendingHighlightRestore` state to `SelectionGuard` for the click-back restore behavior.
6. Update `handlePointerDown` to stash the highlight range and clear the highlight on click into a highlighted card.
7. Add `handlePointerUp` logic: if selection collapsed, restore from stash; if non-collapsed, discard stash.
8. Unit tests for all three fixes.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changes to design-system-concepts.md (D49 and D77 are already corrected).
- Changes to tugbank storage format or API.
- Monaco editor integration.

#### Dependencies / Prerequisites {#dependencies}

- Phase 5f and 5f2 must be merged (they are).
- Corrected D49 and D77 in design-system-concepts.md must be committed (they are).

#### Constraints {#constraints}

- All changes must follow Rules of Tugways (no `root.render()` after mount, `useSyncExternalStore` for external state, `useLayoutEffect` for registrations that events depend on, appearance changes through CSS/DOM only).
- `flushDirtyTabStates` is currently private on `DeckManager`. The save-on-close path calls it directly within `DeckManager`, so it can remain private.

#### Assumptions {#assumptions}

- The `visibilitychange` event with `document.hidden === true` fires reliably before the browser discards the page. `beforeunload` is the backup for cases where `visibilitychange` does not fire.
- `requestAnimationFrame` callbacks fire after browser layout is complete, so scroll and selection restore in RAF work correctly once content is already in the DOM.
- `window.getSelection().isCollapsed` correctly distinguishes a simple click (collapsed) from a drag-to-select (non-collapsed) in the `pointerup` handler.

---

### Design Decisions {#design-decisions}

#### [D01] Save callbacks registered via DeckManager store interface (DECIDED) {#d01-save-callbacks}

**Decision:** DeckManager gains a `Map<string, () => void>` of save callbacks. Each Tugcard registers its `saveCurrentTabState` function via `registerSaveCallback(cardId, callback)` in `useLayoutEffect`. DeckManager calls all registered callbacks on `visibilitychange` (hidden) and `beforeunload`, then flushes dirty tab states synchronously.

**Rationale:**
- Tugcard already has `saveCurrentTabState` that captures scroll, selection, and content. The save-on-close path just needs to trigger it for all cards.
- Registration via `useLayoutEffect` follows Rule 3 of Rules of Tugways.
- The `IDeckManagerStore` interface gains `registerSaveCallback` and `unregisterSaveCallback` methods so mock stores can provide stubs.

**Implications:**
- `IDeckManagerStore` gains two new methods.
- `MockDeckManagerStore` gains stub implementations.
- `DeckManager` constructor adds two event listeners; `destroy()` removes them.

#### [D02] Pending highlight restore with collapsed-selection gate (DECIDED) {#d02-pending-highlight-restore}

**Decision:** SelectionGuard gains a `pendingHighlightRestore` field (`Map<string, Range>`). On `pointerdown` inside a card with a stored `highlightRanges` entry, the Range is stashed in `pendingHighlightRestore` and both `highlightRanges` and the Highlight object are cleared for that card. On `pointerup`, if `window.getSelection().isCollapsed` is true (simple click), the Selection is restored from the stashed Range via `removeAllRanges()` + `addRange()`. If non-collapsed (user dragged), the stash is discarded.

**Rationale:**
- The CSS Custom Highlight paints a visual ghost but the browser-native Selection has already been cleared. Clicking back needs to restore the real Selection.
- The collapsed-selection gate distinguishes "click to re-focus" from "click and drag to create a new selection".
- Clearing the highlight immediately on pointerdown prevents a flash of two overlapping highlights.

**Implications:**
- `pendingHighlightRestore` is cleared in `stopTracking()` to handle pointer cancellation.
- `reset()` clears `pendingHighlightRestore`.
- The `handlePointerUp` method gains restore logic (it was previously a one-liner calling `stopTracking()`).

#### [D03] Content restored before RAF, scroll and selection deferred to RAF (DECIDED) {#d03-restore-order}

**Decision:** In the activation `useLayoutEffect`, content is restored synchronously in the effect body (before scheduling the RAF). The RAF callback handles only scroll position, selection, and visibility unhide. This matches the corrected D49 lifecycle.

**Rationale:**
- Content restore may call `setState`, which React flushes synchronously inside `useLayoutEffect`. This ensures the DOM has its full structure and scrollable height before scroll is applied in RAF.
- Scroll applied before content risks clamping to 0 because the DOM has not yet rendered the full content.
- Selection restore requires text nodes to be in their final positions, which only happens after content is rendered.

**Implications:**
- The early-return guard (no bag, or bag has no restorable state) applies to the combined path. If content is the only field and there is no scroll or selection, no RAF is needed and no visibility hide is applied.
- The visibility:hidden flash suppression is only applied when `bag.scroll` exists (unchanged from current behavior).

---

### Specification {#specification}

#### Spec S01: DeckManager Save Callback API {#s01-save-callback-api}

```typescript
// Additions to IDeckManagerStore:
registerSaveCallback: (id: string, callback: () => void) => void;
unregisterSaveCallback: (id: string) => void;
```

DeckManager implementation:
- `private saveCallbacks: Map<string, () => void> = new Map()`
- `registerSaveCallback(id, cb)`: stores callback in map.
- `unregisterSaveCallback(id)`: deletes callback from map.
- On `visibilitychange` (when `document.hidden === true`) and `beforeunload`: iterate all callbacks, then call `this.flushDirtyTabStates()`.
- Event listeners added in constructor, removed in `destroy()`.

#### Spec S02: SelectionGuard pendingHighlightRestore Flow {#s02-pending-highlight-flow}

```
pointerdown (capture phase):
  For each boundary:
    If click target is inside boundary AND highlightRanges has entry for cardId:
      1. Stash range in pendingHighlightRestore.set(cardId, range)
      2. Delete from highlightRanges
      3. Delete range from this.highlight
    Else if click target is inside boundary (no highlight):
      [existing behavior: clear inactive highlight]
    Else if selection anchor is inside boundary:
      [existing behavior: capture inactive highlight]

pointerup:
  If pendingHighlightRestore.size > 0:
    For each (cardId, range) in pendingHighlightRestore:
      sel = window.getSelection()
      If sel.isCollapsed:
        sel.removeAllRanges()
        sel.addRange(range)
      // Else: user dragged to select — discard stash
    pendingHighlightRestore.clear()
  [existing behavior: stopTracking()]

stopTracking():
  [existing behavior]
  pendingHighlightRestore.clear()

reset():
  [existing behavior]
  pendingHighlightRestore.clear()
```

#### Spec S03: Corrected Restore Order in Tugcard useLayoutEffect {#s03-restore-order}

```
useLayoutEffect (deps: [activeTabId, cardId]):
  bag = store.getTabState(activeTabId)
  if no bag or no restorable state → return

  // 1. Content restore (synchronous, before RAF)
  if bag.content !== undefined:
    persistenceCallbacksRef.current?.onRestore(bag.content)

  // 2. Determine if RAF is needed (scroll or selection to restore)
  needsRaf = bag.scroll !== undefined || bag.selection != null
  if !needsRaf → return  // content-only restore, no hide/RAF needed

  // 3. Flash suppression (hide before RAF)
  if contentEl && bag.scroll !== undefined:
    contentEl.style.visibility = "hidden"

  // 4. RAF: scroll + selection + unhide
  rafHandle = requestAnimationFrame(() => {
    if bag.scroll: restore scroll
    if bag.selection: restore selection
    contentEl.style.visibility = ""
  })

  cleanup: cancelAnimationFrame(rafHandle), restore visibility
```

---

### Definitive Symbol Inventory {#symbol-inventory}

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `saveCallbacks` | private field | `deck-manager.ts` | `Map<string, () => void>` |
| `registerSaveCallback` | public method | `deck-manager.ts` | Implements `IDeckManagerStore.registerSaveCallback` |
| `unregisterSaveCallback` | public method | `deck-manager.ts` | Implements `IDeckManagerStore.unregisterSaveCallback` |
| `handleVisibilityChange` | private method | `deck-manager.ts` | Bound listener for `visibilitychange` |
| `handleBeforeUnload` | private method | `deck-manager.ts` | Bound listener for `beforeunload` |
| `registerSaveCallback` | interface method | `deck-manager-store.ts` | Added to `IDeckManagerStore` |
| `unregisterSaveCallback` | interface method | `deck-manager-store.ts` | Added to `IDeckManagerStore` |
| `pendingHighlightRestore` | private field | `selection-guard.ts` | `Map<string, Range>` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test SelectionGuard pendingHighlightRestore stash/restore/discard and DeckManager save callback registration/flush | Core logic for Bug 1 and Bug 2 |
| **Unit** | Test restore order (onRestore called before RAF callback) | Core logic for Bug 3 |
| **Integration** | Verify all three fixes pass together with full test suite | Final verification |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Fix restore order in Tugcard activation useLayoutEffect {#step-1}

**Commit:** `fix(tugcard): restore content before RAF to prevent scroll clamping`

**References:** [D03] Content restored before RAF, Spec S03, (#s03-restore-order, #context)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tugcard.tsx` — activation `useLayoutEffect`

**Tasks:**
- [ ] In the activation `useLayoutEffect` (around line 328), move the `bag.content` restore out of the RAF callback and into the `useLayoutEffect` body, before `requestAnimationFrame` is scheduled.
- [ ] After content restore, check if RAF is still needed (`bag.scroll !== undefined || bag.selection != null`). If not, return early without scheduling RAF or applying visibility:hidden.
- [ ] The RAF callback retains only scroll restore, selection restore, and visibility unhide.
- [ ] Verify the early-return guard still works: if `!bag || (bag.scroll === undefined && bag.selection == null && bag.content === undefined)`, return early with no side effects.
- [ ] Review existing persistence tests in `use-tugcard-persistence.test.tsx` and `tugcard.test.tsx` for any assertions about `onRestore` timing relative to RAF. Update tests that assume `onRestore` fires inside the RAF callback to assert it fires before RAF instead.

**Tests:**
- [ ] T01: In `tugcard.test.tsx` or `use-tugcard-persistence.test.tsx`, verify that `onRestore` is called synchronously (before RAF fires) when a tab with saved content is activated.
- [ ] T02: Verify that when only `content` is saved (no scroll, no selection), no RAF is scheduled and no visibility:hidden is applied.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`

---

#### Step 2: Add save-on-close handlers to DeckManager {#step-2}

**Depends on:** #step-1

**Commit:** `feat(deck-manager): save all tab states on visibilitychange and beforeunload`

**References:** [D01] Save callbacks registered via DeckManager, Spec S01, (#s01-save-callback-api, #context)

**Artifacts:**
- Modified `tugdeck/src/deck-manager-store.ts` — `IDeckManagerStore` interface gains `registerSaveCallback` and `unregisterSaveCallback`
- Modified `tugdeck/src/deck-manager.ts` — implementation of save callbacks, `visibilitychange` and `beforeunload` listeners
- Modified `tugdeck/src/__tests__/mock-deck-manager-store.ts` — stub implementations

**Tasks:**
- [ ] Add `registerSaveCallback(id: string, callback: () => void): void` and `unregisterSaveCallback(id: string): void` to `IDeckManagerStore`.
- [ ] In `DeckManager`, add `private saveCallbacks: Map<string, () => void> = new Map()`.
- [ ] Implement `registerSaveCallback` and `unregisterSaveCallback` as public methods on `DeckManager`.
- [ ] Add private bound handler methods for `visibilitychange` and `beforeunload`. The `visibilitychange` handler checks `document.hidden === true` before acting. Both handlers iterate all registered save callbacks, then call `this.flushDirtyTabStates()`.
- [ ] In the constructor, add `document.addEventListener("visibilitychange", ...)` and `window.addEventListener("beforeunload", ...)`.
- [ ] In `destroy()`, remove both event listeners.
- [ ] In `MockDeckManagerStore`, add no-op stubs for `registerSaveCallback` and `unregisterSaveCallback`.

**Tests:**
- [ ] T03: In `deck-manager.test.ts`, verify that `registerSaveCallback` stores and `unregisterSaveCallback` removes a callback.
- [ ] T04: Verify that simulating `visibilitychange` with `document.hidden === true` calls all registered callbacks and flushes dirty tab states.
- [ ] T05: Verify that simulating `beforeunload` calls all registered callbacks and flushes dirty tab states.
- [ ] T06: Verify that `destroy()` removes the event listeners (subsequent visibility change does not call callbacks).

**Checkpoint:**
- [ ] `cd tugdeck && bun test`

---

#### Step 3: Register Tugcard save callback with DeckManager {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugcard): register save callback for close-time state flush`

**References:** [D01] Save callbacks registered via DeckManager, Spec S01, (#s01-save-callback-api, #strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tugcard.tsx` — new `useLayoutEffect` for save callback registration

**Tasks:**
- [ ] Add a `useLayoutEffect` in Tugcard that calls `store.registerSaveCallback(cardId, () => saveCurrentTabStateRef.current?.())` on mount (using Rule 3: `useLayoutEffect` for registrations that events depend on). The registered callback is a stable wrapper that dereferences `saveCurrentTabStateRef.current` at call time, not at registration time. This is critical because `saveCurrentTabStateRef.current` is reassigned every render (it is an inline function, not a stable ref value). Passing `saveCurrentTabStateRef.current!` directly would capture the initial render's closure and go stale.
- [ ] The cleanup function calls `store.unregisterSaveCallback(cardId)`.
- [ ] Dependency array: `[cardId, store]`.

**Tests:**
- [ ] T07: In `tugcard.test.tsx`, verify that mounting a Tugcard with a mock store calls `registerSaveCallback` with the card ID and a function. Verify that unmounting calls `unregisterSaveCallback`.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`

---

#### Step 4: Add pendingHighlightRestore to SelectionGuard {#step-4}

**Depends on:** #step-1

**Commit:** `fix(selection-guard): restore selection on click-back into highlighted card`

**References:** [D02] Pending highlight restore, Spec S02, (#s02-pending-highlight-flow, #context)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/selection-guard.ts` — `pendingHighlightRestore` field, updated `handlePointerDown`, `handlePointerUp`, `stopTracking`, `reset`

**Tasks:**
- [ ] Add `private pendingHighlightRestore: Map<string, Range> = new Map()` field to `SelectionGuard`.
- [ ] In `handlePointerDown`, modify the first branch of the highlight-capture loop (the `if (element.contains(target))` branch, line 522 in current source). Currently this branch unconditionally calls `this.clearInactiveHighlight(cardId)`. Split it into two cases: (a) if `this.highlightRanges.has(cardId)`, stash the range in `pendingHighlightRestore.set(cardId, range)`, then delete from `highlightRanges` and `this.highlight` (inline the clear rather than calling `clearInactiveHighlight` so the range is stashed first); (b) else, call `this.clearInactiveHighlight(cardId)` as before (no-op when no highlight exists, but keeps the path clean). The second branch (`else if` for capture, line 525) is unchanged.
- [ ] In `handlePointerUp`, before calling `stopTracking()`: if `pendingHighlightRestore.size > 0`, iterate entries. For each stashed range, check `window.getSelection()?.isCollapsed`. If collapsed, call `sel.removeAllRanges()` then `sel.addRange(range)`. If non-collapsed, do nothing (discard). Call `pendingHighlightRestore.clear()` explicitly here, before `stopTracking()` runs. This is the primary clear site; `stopTracking()`'s clear (below) is a safety net for pointer-cancel paths that skip `handlePointerUp`.
- [ ] In `stopTracking()`, add `this.pendingHighlightRestore.clear()` as a safety-net clear for pointer-cancel and other paths that bypass `handlePointerUp`.
- [ ] In `reset()`, add `this.pendingHighlightRestore.clear()`.

**Tests:**
- [ ] T08: In `selection-guard.test.ts`, verify that clicking into a card with a stored highlight range stashes the range and clears the highlight.
- [ ] T09: Verify that pointerup with collapsed selection restores the Selection from the stashed range.
- [ ] T10: Verify that pointerup with non-collapsed selection (user dragged) discards the stash without restoring.
- [ ] T11: Verify that `stopTracking()` clears `pendingHighlightRestore`.
- [ ] T12: Verify that `reset()` clears `pendingHighlightRestore`.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`

---

#### Step 5: Integration Checkpoint {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] Save callbacks, [D02] Pending highlight restore, [D03] Restore order, (#success-criteria)

**Tasks:**
- [ ] Verify all three bug fixes are present and non-conflicting.
- [ ] Verify no TypeScript compilation errors.
- [ ] Verify all existing tests pass alongside new tests.

**Tests:**
- [ ] T13: Full test suite passes with all new tests from Steps 1-4 running together (`bun test`).

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx tsc --noEmit`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Three state-preservation bugs fixed: save-on-close, selection click-back restore, and correct restore order (content before scroll/selection).

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cd tugdeck && bun test` passes with all new and existing tests.
- [ ] `cd tugdeck && bunx tsc --noEmit` passes with no errors.
- [ ] Content restore (`onRestore`) is called before any RAF callback in the activation useLayoutEffect.
- [ ] `visibilitychange` and `beforeunload` both flush all registered save callbacks and dirty tab states.
- [ ] Clicking back into a card with a highlight range restores the Selection on simple click and discards on drag-select.

**Acceptance tests:**
- [ ] T01-T02: Restore order tests (Step 1)
- [ ] T03-T06: Save-on-close tests (Step 2)
- [ ] T07: Tugcard save callback registration test (Step 3)
- [ ] T08-T12: Selection click-back restore tests (Step 4)
- [ ] T13: Full integration test suite (Step 5)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Monaco editor integration with `useTugcardPersistence` (Phase 8/9)
- [ ] Collapsed card state persistence (Phase 8a)

| Checkpoint | Verification |
|------------|--------------|
| All tests pass | `cd tugdeck && bun test` |
| TypeScript clean | `cd tugdeck && bunx tsc --noEmit` |
