<!-- tugplan-skeleton v2 -->

## Tugways Phase 5f2: State Preservation Fixes {#phase-5f2-state-preservation-fixes}

**Purpose:** Fix the four state preservation failures from Phase 5f — scroll restore timing, selection restore timing, inactive selection CSS, and app reload restore — so that card state survives tab switches and app reloads without visual glitches or silent failures.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5f2-state-preservation-fixes |
| Last updated | 2026-03-08 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phase 5f implemented the state preservation infrastructure — TabStateBag, DeckManager cache, Tugcard deactivation capture and activation restore, useTugcardPersistence hook, and inactive selection CSS. However, four failures remain:

1. **Scroll restore timing:** The `useLayoutEffect` in tugcard.tsx that restores `scrollTop`/`scrollLeft` fires before the browser completes layout. At that point the content area has zero scrollable height, so `scrollTop` assignments are clamped to 0. The scroll position is silently lost.

2. **Selection restore timing:** Same root cause. `useLayoutEffect` fires before content is fully laid out, so `setBaseAndExtent` silently fails because the target text nodes are not yet positioned. The selection is silently lost.

3. **Inactive selection CSS:** The existing `::selection` rule on `.card-frame[data-focused="false"] .tugcard-content` only styles the browser's global Selection object. When the user clicks in another card, the browser clears the global Selection entirely via `pointerdown`, so `::selection` has nothing to style. The dimmed inactive selection is never visible.

4. **App reload restore:** Depends on the same `useLayoutEffect` path as tab switch restore. Once scroll and selection timing are fixed, app reload restore should work correctly.

#### Strategy {#strategy}

- Fix scroll and selection restore timing by deferring to `requestAnimationFrame`, which fires after the browser completes layout and the content area has its full scrollable dimensions.
- Suppress the visual flash caused by the one-frame delay (content visible at scroll position 0 before RAF fires) by hiding the content area with `visibility: hidden` during the first frame, then restoring visibility in the RAF callback after scroll is applied.
- Replace the `::selection`-based inactive selection styling with the CSS Custom Highlight API (`CSS.highlights`, `::highlight()`), which paints saved selections as non-Selection highlight ranges that persist across focus changes.
- Capture the selection Range proactively on every `pointerdown` outside the card, replacing the `::highlight()` on each capture. This ensures the highlight is always current.
- Own the highlight lifecycle in SelectionGuard, which already owns selection state save/restore and knows about card boundaries.
- Update the D77 design decision in `roadmap/design-system-concepts.md` to reflect the CSS Custom Highlight API approach.
- Follow Rules of Tugways strictly: all appearance changes through CSS and DOM (Rule 4), no React state for visual mutations (Rule 1), `useLayoutEffect` for registrations (Rule 3).

#### Success Criteria (Measurable) {#success-criteria}

- Scroll a card's content area, switch tabs, switch back: scroll position is restored to within 1px. No flash of content at scroll position 0 is visible (manual verification).
- Select text in a card, switch tabs, switch back: selection is restored (same anchor/focus nodes and offsets).
- Select text in card A, click in card B: card A shows the previously selected text with the dimmed `--tug-base-selection-bg-inactive` highlight via `::highlight(inactive-selection)`.
- Reload the app with scrolled content and text selections: scroll positions and selections are restored after reload.
- No regressions in existing selection guard behavior (pointer clamping, keyboard clipping, autoscroll).

#### Scope {#scope}

1. Defer scroll restore from `useLayoutEffect` to `requestAnimationFrame` in tugcard.tsx
2. Defer selection restore from `useLayoutEffect` to `requestAnimationFrame` in tugcard.tsx
3. Add `visibility: hidden` flash suppression during the first frame before RAF fires
4. Add CSS Custom Highlight API support to SelectionGuard: save Range on card deactivation, create/update `CSS.highlights` entry
5. Add `::highlight(inactive-selection)` CSS rule to tugcard.css, replacing the `::selection`-based inactive styling
6. Update D77 in `roadmap/design-system-concepts.md` to document the CSS Custom Highlight API approach
7. Update existing tests and add new tests for the timing fixes and highlight behavior

#### Non-goals (Explicitly out of scope) {#non-goals}

- Fallback for browsers that do not support CSS Custom Highlight API (the existing `::selection` rule provides graceful degradation — inactive cards just will not show dimmed selections)
- Changes to the TabStateBag data model or DeckManager cache
- Changes to the useTugcardPersistence hook API
- Terminal or Monaco editor state persistence

#### Dependencies / Prerequisites {#dependencies}

- Phase 5f is complete: TabStateBag, DeckManager tab state cache, Tugcard deactivation/activation lifecycle, and useTugcardPersistence hook are all in place.
- CSS Custom Highlight API (`CSS.highlights`, `Highlight` constructor, `::highlight()`) is available in the target browser (Chromium-based WebView in the macOS app).

#### Constraints {#constraints}

- All appearance changes must go through CSS and DOM, never React state (Rule 4 of Rules of Tugways).
- Never call `root.render()` after initial mount (Rule 1).
- Use `useLayoutEffect` for registrations that events depend on (Rule 3).
- Every action handler must access current state through refs or stable singletons, never stale closures (Rule 5).
- Selection stays inside card boundaries (Rule 6).

#### Assumptions {#assumptions}

- The app reload restore (failure 4) is dependent on fixing the scroll and selection timing bugs (failures 1 and 2). No separate fix is needed beyond the RAF deferral applied to the same `useLayoutEffect` path.
- The D77 design decision will be updated in `roadmap/design-system-concepts.md` as part of this plan to reflect the CSS Custom Highlight API approach.
- The RAF deferral for scroll and selection restore applies to both tab switch restore and app reload restore, since both use the same `useLayoutEffect` path in tugcard.tsx.
- The CSS Highlight API requires registering a named highlight via `CSS.highlights.set()` and styling it with `::highlight(inactive-selection)` in CSS — this approach is consistent with Rule 4 (appearance via CSS) since the style itself stays in CSS, even though JavaScript creates the Highlight object.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the conventions defined in the tugplan-skeleton. All anchors are explicit, kebab-case, and use the prefix conventions: `step-N` for execution steps, `dNN-...` for design decisions, `sNN-...` for specs.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All clarifying questions were resolved during planning:

- **Capture trigger:** Proactive capture on every `pointerdown` outside the card (chosen over lazy/deferred).
- **Fallback:** No fallback for unsupported browsers (existing `::selection` rule handles gracefully).
- **Flash handling:** Suppress with `visibility: hidden` during first frame, restore in RAF callback.
- **Highlight owner:** SelectionGuard owns the CSS Highlight lifecycle.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| RAF timing still too early for some content | med | low | If RAF fires before layout for complex content, add a second RAF (double-RAF). Monitor during testing. | Scroll restore fails for specific card types |
| CSS Custom Highlight API not available | low | low | Graceful degradation: existing `::selection` rule remains. Inactive cards just will not dim. | Browser update removes API |
| Flash suppression causes visible flicker | med | low | `visibility: hidden` is paint-free (no layout recalc). If still visible, switch to `opacity: 0` with `will-change: opacity`. | Flicker visible during tab switch |

**Risk R01: RAF timing edge case** {#r01-raf-timing}

- **Risk:** For very complex card content, even a single RAF callback might fire before layout is fully complete.
- **Mitigation:** Test with the Gallery card (most complex existing card). If needed, use double-RAF (RAF inside RAF). The flash suppression (`visibility: hidden`) masks any timing gap.
- **Residual risk:** Extremely complex future card content could still hit this edge case. The double-RAF pattern is available as an escalation.

**Risk R02: Highlight API browser compatibility** {#r02-highlight-compat}

- **Risk:** CSS Custom Highlight API is relatively new. If the WebView engine version does not support it, inactive selections will not be visually dimmed.
- **Mitigation:** Feature-detect `CSS.highlights` before using it. Fall back to no dimming (the `::selection` rule is harmless but ineffective). The Chromium version shipped with the macOS app supports the API.
- **Residual risk:** None — feature detection prevents errors.

---

### Design Decisions {#design-decisions}

#### [D01] Defer scroll and selection restore to requestAnimationFrame (DECIDED) {#d01-raf-deferral}

**Decision:** Replace the synchronous scroll/selection restore in `useLayoutEffect` with a deferred restore inside `requestAnimationFrame`.

**Rationale:**
- `useLayoutEffect` fires after React commits DOM changes but before the browser completes layout. At this point, the content area may have zero scrollable height (content not yet laid out), so `scrollTop` assignments are clamped to 0.
- `requestAnimationFrame` fires after the browser completes layout and before paint. By this point, the content area has its full scrollable dimensions and text nodes are positioned, so both `scrollTop` and `setBaseAndExtent` succeed.
- This is a DOM-only change — no React state involved (Rule 4). The `useLayoutEffect` still runs to schedule the RAF; the actual DOM manipulation happens in the RAF callback.

**Implications:**
- There is a one-frame window between `useLayoutEffect` and RAF where content is visible at scroll position 0. This is addressed by [D02] flash suppression.
- The RAF handle must be cancelled on cleanup (component unmount or `activeTabId` change) to prevent stale restores.
- Both tab switch restore and app reload restore use the same code path, so both are fixed simultaneously.

#### [D02] Suppress restore flash with visibility:hidden (DECIDED) {#d02-flash-suppression}

**Decision:** Hide the content area with `visibility: hidden` during the first frame (between `useLayoutEffect` and RAF callback), then restore visibility after scroll is applied. Apply hiding only when the bag contains scroll state (`bag.scroll` exists). Selection-only restores do not need hiding.

**Rationale:**
- The RAF deferral ([D01]) creates a one-frame window where content is visible at scroll position 0 before the correct scroll position is applied. This causes a visible flash.
- `visibility: hidden` prevents the content from being painted but does not affect layout. The browser still computes scrollable dimensions, so `scrollTop` works correctly in the RAF callback.
- Setting `visibility` is a direct DOM manipulation — consistent with Rule 4 (appearance through CSS and DOM, never React state).
- Selection restore via `setBaseAndExtent` has no visible flash artifact — it either succeeds (selection appears) or silently fails (no selection). There is no "wrong position" state analogous to scroll-at-zero that would flash. Hiding for selection-only restores would be unnecessary and would briefly blank the content area for no benefit.

**Implications:**
- The `visibility` manipulation targets the `contentRef` element directly (the `.tugcard-content` div).
- If the RAF callback does not fire (e.g., component unmounts before RAF), the cleanup function must restore `visibility: visible` to prevent the content area from being permanently hidden.

#### [D03] CSS Custom Highlight API for inactive selections (DECIDED) {#d03-highlight-api}

**Decision:** Use the CSS Custom Highlight API (`CSS.highlights`, `Highlight` constructor, `::highlight(inactive-selection)`) to paint saved selections in inactive cards, replacing the `::selection`-based approach.

**Rationale:**
- The browser clears the global Selection on `pointerdown` in another card. `::selection` only styles the global Selection, so it has nothing to style once the selection is cleared.
- The CSS Custom Highlight API creates named highlight ranges that are independent of the global Selection. These ranges persist across focus changes and are styled with `::highlight(name)` in CSS.
- This approach is consistent with Rule 4: the style definition stays in CSS (`::highlight(inactive-selection)`), and JavaScript only creates the `Highlight` object and registers it with `CSS.highlights`. The visual appearance is entirely CSS-driven.
- Feature detection (`CSS.highlights !== undefined`) provides safe degradation.

**Implications:**
- SelectionGuard must save the selection Range (not just the path-based `SavedSelection`) on card deactivation, before the browser clears it.
- A named highlight `"inactive-selection"` is registered globally via `CSS.highlights.set()`. It contains Range objects from all inactive cards with saved selections.
- When a card becomes active, its ranges are removed from the highlight. When a card is deactivated, its saved range is added.
- The existing `::selection` rule for inactive cards remains as a harmless no-op (the browser selection is cleared, so the rule has nothing to style). No need to remove it.
- Requires updating D77 in `roadmap/design-system-concepts.md`.

#### [D04] Proactive range capture on pointerdown (DECIDED) {#d04-proactive-capture}

**Decision:** Capture the live selection Range on every `pointerdown` that occurs outside the card's content area, and immediately update the CSS Highlight.

**Rationale:**
- The browser clears the global Selection on `pointerdown`. To save the Range for the CSS Highlight, we must capture it *before* the browser clears it.
- The `pointerdown` handler in SelectionGuard already fires on every `pointerdown` (capture phase). Adding range capture here is natural — it runs before the browser's default `pointerdown` behavior clears the selection.
- Proactive capture ensures the highlight is always current, even for rapid clicks between cards.

**Implications:**
- The `handlePointerDown` in SelectionGuard gains a **separate highlight-capture loop** that runs before the existing tracking loop. The capture loop visits ALL boundaries (capture for inactive cards, clear for the active card). The existing tracking loop has an early return on first match and cannot be merged with the capture loop.
- When the user clicks inside a card's content area, that card's ranges are removed from the highlight (the card is becoming active and will own the live selection).
- Canvas clicks (outside all card boundaries) trigger highlight capture for any card with a selection. The inactive highlight persists when the user clicks on the canvas — this is the natural behavior since the selection was made and the user clicked away.

#### [D05] SelectionGuard owns highlight lifecycle (DECIDED) {#d05-highlight-owner}

**Decision:** SelectionGuard owns the creation, update, and teardown of the CSS Custom Highlight for inactive selections.

**Rationale:**
- SelectionGuard already owns selection state save/restore and knows about card boundaries. It handles `pointerdown`, `pointermove`, `pointerup`, and `selectionchange` events at the document level.
- Adding highlight management to SelectionGuard keeps all selection-related logic in one place, avoiding coordination between multiple modules.
- SelectionGuard is a module-level singleton ([D02] from Phase 5a), so the highlight is created once and shared across all cards.

**Implications:**
- SelectionGuard gains a `private highlight: Highlight | null` field and a `private highlightRanges: Map<string, Range>` map (cardId to Range).
- `attach()` creates the Highlight and registers it with `CSS.highlights.set("inactive-selection", highlight)`.
- `detach()` removes it from `CSS.highlights`.
- `reset()` clears the highlight ranges (for testing).

---

### Specification {#specification}

#### Scroll and Selection Restore Timing {#restore-timing}

**Spec S01: RAF-deferred restore sequence** {#s01-raf-restore}

The `useLayoutEffect` in tugcard.tsx (currently at line 322) is modified as follows:

1. **useLayoutEffect fires** (after React DOM commit, before browser layout):
   - Read the `TabStateBag` from `store.getTabState(activeTabId)`.
   - If no bag exists, or the bag has no `scroll` and no `selection` and no `content`, return early (no hide/RAF needed — cards with no saved state render normally with no flash).
   - If the bag has scroll state (`bag.scroll` exists), set `contentRef.current.style.visibility = "hidden"` on the content area element to suppress the flash of content at position 0. Selection-only restores do not need hiding because `setBaseAndExtent` has no visible flash artifact — it either succeeds or silently fails.
   - Schedule a `requestAnimationFrame` callback.
   - Store the RAF handle in a **local variable** captured by the cleanup closure (not a ref). This is safe because React runs the cleanup function for the previous effect invocation before running the new effect body, so on rapid tab switches (A to B to C), the old RAF for tab A is cancelled before the new RAF for tab B is scheduled. No cross-contamination is possible.

2. **RAF callback fires** (after browser layout, before paint):
   - If `bag.scroll` exists, set `contentEl.scrollLeft = bag.scroll.x` and `contentEl.scrollTop = bag.scroll.y`.
   - If `bag.selection` exists, call `selectionGuard.restoreSelection(cardId, bag.selection)`.
   - If `bag.content` exists, call `persistenceCallbacksRef.current?.onRestore(bag.content)`.
   - Set `contentRef.current.style.visibility = ""` (restore visibility).

3. **Cleanup** (component unmount or `activeTabId` change):
   - Cancel the pending RAF via `cancelAnimationFrame(rafHandle)`. The `rafHandle` is a local variable captured by the cleanup closure, so each cleanup cancels exactly the RAF that was scheduled by that invocation — no cross-contamination on rapid tab switches.
   - Restore `contentRef.current.style.visibility = ""` to prevent permanent hiding.

#### CSS Custom Highlight API Integration {#highlight-integration}

**Spec S02: SelectionGuard highlight management** {#s02-highlight-management}

SelectionGuard gains the following new members:

| Member | Type | Purpose |
|--------|------|---------|
| `highlightRanges` | `Map<string, Range>` | Maps cardId to the saved Range for inactive selection highlighting |
| `highlight` | `Highlight \| null` | The CSS Highlight object registered with `CSS.highlights` |

The `Highlight` object has a `Set`-like interface: use `highlight.add(range)` to add a Range, `highlight.delete(range)` to remove one, and `highlight.clear()` to remove all ranges.

**Lifecycle:**

- `attach()`: If `CSS.highlights` is available, create a new `Highlight()` and call `CSS.highlights.set("inactive-selection", highlight)`.
- `detach()`: If `CSS.highlights` is available, call `CSS.highlights.delete("inactive-selection")`. Clear `highlightRanges`. Set `highlight = null`.
- `reset()`: Clear `highlightRanges`. If `highlight` exists, call `highlight.clear()`.

**Spec S03: Proactive range capture flow** {#s03-range-capture}

On `pointerdown` (capture phase), a **separate highlight-capture loop** runs before the existing tracking loop. The two loops serve different purposes and cannot be merged: the highlight-capture loop must visit ALL boundaries, while the existing tracking loop finds the single boundary containing the click target and returns early on first match.

The highlight-capture loop:

1. Get the current `window.getSelection()`.
2. Iterate ALL registered boundaries. For each boundary:
   a. If the click target is *inside* this boundary, call `clearInactiveHighlight(cardId)` — the card is becoming active and should not have an inactive highlight.
   b. If the selection has `rangeCount > 0` and the selection's anchor node is inside this boundary, but the click target is *outside* this boundary (the user is clicking away):
      - Clone the first range: `selection.getRangeAt(0).cloneRange()`.
      - **Boundary containment check:** Verify that both `range.startContainer` and `range.endContainer` are within the card's boundary element (`boundary.contains(range.startContainer) && boundary.contains(range.endContainer)`). If either is outside (e.g., the selection spans multiple cards during a brief browser race), discard the range and skip highlight capture for this card. This prevents painting a highlight that crosses card boundaries.
      - Store it in `highlightRanges.set(cardId, range)`.
      - Add the range to the `highlight` object via `highlight.add(range)`.
3. Canvas clicks (outside all registered boundaries) naturally trigger highlight capture for any card with a selection, since no boundary contains the click target. The inactive highlight persists when the user clicks on the canvas.

**Spec S04: CSS highlight styling** {#s04-highlight-styling}

```css
/* Inactive selection via CSS Custom Highlight API.
 * Replaces the ::selection approach that cannot style cleared selections.
 * The "inactive-selection" highlight is managed by SelectionGuard.
 */
::highlight(inactive-selection) {
  background-color: var(--tug-base-selection-bg-inactive);
  color: inherit;
}
```

The existing `.card-frame[data-focused="false"] .tugcard-content ::selection` rule remains but is effectively a no-op (the browser selection is cleared when the card loses focus).

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/types/highlight-api.d.ts` | Ambient TypeScript declarations for the CSS Custom Highlight API (`Highlight`, `HighlightRegistry`, `CSS.highlights`) — not included in the default ES2020 lib |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `highlightRanges` | field | `selection-guard.ts` (SelectionGuard class) | `Map<string, Range>` — cardId to saved Range for inactive highlight |
| `highlight` | field | `selection-guard.ts` (SelectionGuard class) | `Highlight \| null` — CSS Highlight object |
| `captureInactiveHighlight` | method | `selection-guard.ts` (SelectionGuard class) | Captures selection range for a card being deactivated, adds to highlight |
| `clearInactiveHighlight` | method | `selection-guard.ts` (SelectionGuard class) | Removes a card's range from the highlight (card becoming active) |

---

### Documentation Plan {#documentation-plan}

- [ ] Update D77 in `roadmap/design-system-concepts.md` to document the CSS Custom Highlight API approach, replacing the `::selection`-only description.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test SelectionGuard highlight management methods in isolation | Range capture, highlight lifecycle, feature detection |
| **Integration** | Test Tugcard restore timing with RAF deferral | Scroll restore, selection restore, flash suppression |
| **Manual** | Visual verification of inactive selection appearance | Highlight color, flash suppression, cross-theme consistency |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Defer scroll and selection restore to RAF with flash suppression {#step-1}

**Commit:** `fix(tugcard): defer scroll/selection restore to requestAnimationFrame with visibility suppression`

**References:** [D01] RAF deferral, [D02] Flash suppression, Spec S01, (#restore-timing, #context, #strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tugcard.tsx` — rewrite the activation restore `useLayoutEffect`

**Tasks:**
- [ ] In tugcard.tsx, modify the `useLayoutEffect` that restores tab state (currently around line 322). Read `store.getTabState(activeTabId)` first. If no bag exists, or the bag has no `scroll`, `selection`, or `content`, return early — cards with no saved state render normally with no flash and no unnecessary RAF. Only when a bag with restorable state exists, schedule a `requestAnimationFrame`. Apply `visibility: hidden` only when `bag.scroll` exists (selection-only restores have no visible flash artifact — `setBaseAndExtent` either succeeds or silently fails).
- [ ] In the RAF callback: restore scroll position (`scrollLeft`, `scrollTop`), restore selection via `selectionGuard.restoreSelection()`, restore content state via `persistenceCallbacksRef.current?.onRestore()`, and then set `contentRef.current.style.visibility = ""`.
- [ ] Store the RAF handle in a **local variable** captured by the cleanup closure (not a ref). The cleanup function cancels the RAF and restores `visibility = ""`. This is safe for rapid tab switches because React runs the previous invocation's cleanup before running the new effect body — the old RAF is cancelled before the new one is scheduled, preventing cross-contamination (e.g., tab A's state being restored into tab C's content).
- [ ] Ensure the `eslint-disable-next-line react-hooks/exhaustive-deps` comment is preserved (dependency array is `[activeTabId, cardId]`).

**Tests:**
- [ ] Existing `tugcard.test.tsx` tests continue to pass. Note: the test environment's RAF mock in `setup-rtl.ts` schedules callbacks via `setTimeout(0)`. Assertions that check restore side effects (e.g., `restoreSelection` spy calls, `onRestore` callback calls) are currently placed **outside** the `act()` block. With the RAF deferral, these side effects occur inside the `setTimeout(0)` callback. If `act()` does not flush the pending `setTimeout(0)` before the assertion runs, tests will fail. **Fix:** wrap the assertion in an additional `await act(async () => {})` call to flush pending timers, or move the assertion inside the existing `act()` block. Check each restore test and adjust as needed.
- [ ] Manual test: scroll a card's content, switch tabs, switch back — scroll position is restored, no flash of position-0 content.
- [ ] Manual test: select text in a card, switch tabs, switch back — selection is restored.
- [ ] Manual test: reload the app with scrolled content — scroll position is restored after reload.
- [ ] Manual test: rapidly switch tabs (A to B to C) — tab C renders with its own saved state (or no state), not tab A's state. Verify no cross-contamination from stale RAF callbacks.

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --run tugcard.test` passes
- [ ] Manual verification: tab switch restore works without flash

---

#### Step 2: Add CSS Custom Highlight API support to SelectionGuard {#step-2}

**Depends on:** #step-1

**Commit:** `feat(selection-guard): add CSS Custom Highlight API for inactive selection painting`

**References:** [D03] Highlight API, [D04] Proactive capture, [D05] Highlight owner, Spec S02, Spec S03, (#highlight-integration, #strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/selection-guard.ts` — add highlight fields, capture/clear methods, pointerdown integration
- New `tugdeck/src/types/highlight-api.d.ts` — ambient TypeScript type declarations for CSS Custom Highlight API

**Tasks:**
- [ ] Check whether TypeScript recognizes `CSS.highlights` and `Highlight`. The project targets ES2020 with no explicit `lib` in tsconfig.json, so the CSS Custom Highlight API types are not included. Add `tugdeck/src/types/highlight-api.d.ts` with ambient declarations for `Highlight` (constructor, `add`, `delete`, `clear`, `has`, `size`), `HighlightRegistry` (`set`, `get`, `delete`, `has`, `clear`), and extend the global `CSS` namespace with `highlights: HighlightRegistry`. The file is automatically included by the `"include": ["src/**/*.ts"]` glob in tsconfig.json.
- [ ] Add `private highlightRanges: Map<string, Range> = new Map()` field to SelectionGuard.
- [ ] Add `private highlight: Highlight | null = null` field to SelectionGuard.
- [ ] In `attach()`: feature-detect `CSS.highlights`. If available, create `new Highlight()` and call `CSS.highlights.set("inactive-selection", this.highlight)`.
- [ ] In `detach()`: if `CSS.highlights` is available, call `CSS.highlights.delete("inactive-selection")`. Clear `highlightRanges`. Set `highlight = null`.
- [ ] In `reset()`: clear `highlightRanges`. If `highlight` exists, call `highlight.clear()`.
- [ ] Add `captureInactiveHighlight(cardId: string): void` method: get current selection, verify anchor is in the card's boundary, clone the range, then verify both `range.startContainer` and `range.endContainer` are within the boundary (discard the range if either is outside — prevents cross-card highlight painting). Store the validated range in `highlightRanges` and add to `highlight` via `highlight.add(range)`.
- [ ] Add `clearInactiveHighlight(cardId: string): void` method: remove the card's range from `highlightRanges` and from `highlight`.
- [ ] In `handlePointerDown()`: add a **separate highlight-capture loop** that runs before the existing tracking loop. The two loops serve different purposes and cannot be merged: the highlight-capture loop must visit ALL boundaries to capture/clear highlights for every card, while the existing tracking loop finds the single boundary containing the click target and returns early. The highlight-capture loop iterates all boundaries: for each boundary where the selection's anchor node is contained but the click target is *not* contained, call `captureInactiveHighlight(cardId)`. For each boundary where the click target *is* contained, call `clearInactiveHighlight(cardId)`. This loop runs to completion before the existing tracking loop begins. Canvas clicks (outside all cards) naturally cause highlight capture for any card with a selection, since no boundary contains the click target.
- [ ] In `unregisterBoundary(cardId)`: call `clearInactiveHighlight(cardId)` to clean up ranges for removed cards.
- [ ] Remove the unused `private savedSelections: Map<string, SavedSelection>` field from SelectionGuard. This map was part of the Phase 5b infrastructure but is now dead code — the Phase 5f migration moved all selection state to the DeckManager tab state cache. Also remove its reference in `reset()`. The `saveSelection()` and `restoreSelection()` public methods remain (they are stateless — they read/write the live browser Selection, not the map).

**Tests:**
- [ ] Unit test: `captureInactiveHighlight` stores a Range in `highlightRanges` and adds it to the Highlight object.
- [ ] Unit test: `clearInactiveHighlight` removes the Range from both `highlightRanges` and the Highlight.
- [ ] Unit test: `attach()` registers highlight with `CSS.highlights` when available; `detach()` removes it.
- [ ] Unit test: `reset()` clears all highlight state.
- [ ] Unit test: feature detection — when `CSS.highlights` is undefined, highlight methods are no-ops (no errors).
- [ ] Unit test: `captureInactiveHighlight` discards a range whose `startContainer` or `endContainer` is outside the card's boundary (cross-card selection edge case).
- [ ] Existing `selection-guard.test.ts` tests continue to pass.

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --run selection-guard.test` passes
- [ ] All new unit tests pass

---

#### Step 3: Add ::highlight(inactive-selection) CSS and update existing rules {#step-3}

**Depends on:** #step-2

**Commit:** `style(tugcard): add ::highlight(inactive-selection) CSS rule for inactive selection painting`

**References:** [D03] Highlight API, Spec S04, (#highlight-integration, #strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tugcard.css` — add `::highlight(inactive-selection)` rule

**Tasks:**
- [ ] Add the `::highlight(inactive-selection)` rule to tugcard.css using `--tug-base-selection-bg-inactive` token and `color: inherit`.
- [ ] Add a comment above the existing `.card-frame[data-focused="false"] .tugcard-content ::selection` rule noting it is now a no-op retained for graceful degradation.
- [ ] Verify all three themes (tug-tokens, bluenote, harmony) already define `--tug-base-selection-bg-inactive`. No token changes needed — they were added in Phase 5f.

**Tests:**
- [ ] Manual test: select text in card A, click in card B. Card A shows the dimmed highlight via `::highlight(inactive-selection)`.
- [ ] Manual test: switch themes (tug-tokens, bluenote, harmony). The inactive highlight color follows the theme token in each case.
- [ ] Manual test: select text in card A, click card B, then click card A. Card A's highlight disappears and the live selection becomes active.

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --run` passes (no regressions)
- [ ] Manual visual verification across all three themes

---

#### Step 4: Update D77 design decision in design-system-concepts.md {#step-4}

**Depends on:** #step-3

**Commit:** `docs(design): update D77 inactive selection to document CSS Custom Highlight API approach`

**References:** [D03] Highlight API, (#strategy, #assumptions)

**Artifacts:**
- Modified `roadmap/design-system-concepts.md` — update the D77 section at anchor `#d77-inactive-selection`

**Tasks:**
- [ ] Update the D77 "Inactive Selection Appearance" section (around line 3244 of design-system-concepts.md) to describe the CSS Custom Highlight API approach.
- [ ] Replace the `::selection` implementation description with the `::highlight(inactive-selection)` approach.
- [ ] Note that SelectionGuard captures the Range proactively on `pointerdown` and registers it with `CSS.highlights`.
- [ ] Retain mention that the `::selection` rule is kept as a harmless fallback for browsers without Highlight API support.
- [ ] Update the implementation code sample to show `::highlight(inactive-selection)` instead of the `::selection` rule.

**Tests:**
- [ ] N/A (documentation only)

**Checkpoint:**
- [ ] D77 section accurately describes the CSS Custom Highlight API approach
- [ ] No broken anchors in design-system-concepts.md (the `{#d77-inactive-selection}` anchor is preserved)

---

#### Step 5: Integration Checkpoint {#step-5}

**Depends on:** #step-1, #step-2, #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] RAF deferral, [D02] Flash suppression, [D03] Highlight API, [D04] Proactive capture, [D05] Highlight owner, Spec S01, Spec S02, Spec S03, Spec S04, (#success-criteria, #restore-timing, #highlight-integration)

**Tasks:**
- [ ] Verify all four original failures are resolved end-to-end:
  - [ ] Scroll restore: scroll a card, switch tabs, switch back. Scroll position restored, no flash.
  - [ ] Selection restore: select text, switch tabs, switch back. Selection restored.
  - [ ] Inactive selection CSS: select text in card A, click card B. Card A shows dimmed highlight.
  - [ ] App reload: scroll and select text, reload. State restored after reload.
- [ ] Verify no regressions in selection guard behavior (pointer clamping, keyboard clipping, autoscroll, boundary containment).
- [ ] Verify across all three themes (tug-tokens, bluenote, harmony).

**Tests:**
- [ ] Full test suite passes: `cd tugdeck && bun test -- --run`

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --run` passes (full test suite)
- [ ] All four success criteria verified manually

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Card state preservation works correctly — scroll positions, text selections, and card content state survive tab switches and app reloads without visual glitches, and inactive cards display saved selections with a dimmed highlight.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Scroll restore works on tab switch and app reload without flash (manual verification)
- [ ] Selection restore works on tab switch and app reload (manual verification)
- [ ] Inactive selection is visually dimmed via `::highlight(inactive-selection)` across all three themes (manual verification)
- [ ] All existing tests pass with no regressions (`bun test -- --run`)
- [ ] D77 design decision is updated in `roadmap/design-system-concepts.md`

**Acceptance tests:**
- [ ] `cd tugdeck && bun test -- --run tugcard.test` passes
- [ ] `cd tugdeck && bun test -- --run selection-guard.test` passes
- [ ] `cd tugdeck && bun test -- --run` (full suite) passes

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Double-RAF escalation if single RAF proves insufficient for complex card content
- [ ] Browser fallback for CSS Custom Highlight API if needed for non-Chromium targets
- [ ] Monaco editor inactive selection integration (Phase 8/9)

| Checkpoint | Verification |
|------------|--------------|
| Scroll restore timing | Manual: switch tabs with scrolled content, no flash, position restored |
| Selection restore timing | Manual: switch tabs with selected text, selection restored |
| Inactive selection highlight | Manual: click away from card with selection, dimmed highlight visible |
| App reload restore | Manual: reload with scrolled/selected content, state restored |
| Full test suite | `cd tugdeck && bun test -- --run` |
