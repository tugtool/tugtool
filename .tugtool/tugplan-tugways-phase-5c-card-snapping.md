<!-- tugplan-skeleton v2 -->

## Tugways Phase 5c: Card Snapping {#card-snapping}

**Purpose:** Gate snap-to-edge and set formation on the Option (Alt) modifier key so free drag is the default, with mid-drag modifier toggle and snap guide rendering via direct DOM manipulation.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-04 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The snap geometry module (`snap.ts`) contains fully tested pure functions for `computeSnap`, `findSharedEdges`, and `computeSets`, but none of this code is wired into the production drag path. Currently, `card-frame.tsx`'s `handleDragStart` only calls `clampedPosition` -- every drag is free movement with no snap guides and no set formation.

Phase 5c, as described in the implementation strategy, adds exactly one behavioral gate: the Option (Alt) modifier key. When held during drag, `computeSnap` is called and snap guides appear. When released, the card returns to free cursor-following. Sets form on drop when snapped. Set-move (dragging a formed set as a group) works without the modifier.

#### Strategy {#strategy}

- Wire `computeSnap` into the existing `applyDragFrame` rAF loop inside `card-frame.tsx`, gated on `e.altKey`
- Read other card rects from the DOM at drag-start (snapshot approach, same pattern as the existing `dragTabBarCache`)
- Render snap guide `<div>` elements via direct DOM manipulation (create/position/remove), consistent with Rules of Tug [D08]/[D09] -- no React state for guides
- Compute sets transiently at drag-start via `findSharedEdges` + `computeSets` to determine if the dragged card is part of a set (for set-move)
- Keep `snap.ts` geometry functions completely untouched -- the modifier gate lives in the drag handler
- Target ~180-220 lines of change in one file (`card-frame.tsx`), revised from the initial ~50-line estimate to account for set-move, modifier-driven break-out, guide management, and store commit ordering

#### Success Criteria (Measurable) {#success-criteria}

- Free drag (no modifier) produces no snap guides and no snapping (verify by dragging cards near each other without Option)
- Option+drag near another card produces visible snap guide lines and the card snaps to the nearest edge within `SNAP_THRESHOLD_PX` (8px)
- Pressing Option mid-drag activates snapping immediately; releasing Option mid-drag deactivates snapping immediately
- Dropping while snapped forms a set; subsequent drag of any set member moves the entire set without requiring the modifier
- During set-move (no Option), pressing Option detaches the dragged card from the set and enters snap mode; the detached card can then snap to a new set

#### Scope {#scope}

1. Add Option-key gate to the drag path in `card-frame.tsx`
2. Call `computeSnap` in `applyDragFrame` when `altKey` is true
3. Render/remove snap guide DOM elements during drag
4. Compute set membership at drag-start for set-move behavior
5. Manual verification of snap, set-move, and break-out flows

#### Non-goals (Explicitly out of scope) {#non-goals}

- Modifying `snap.ts` geometry functions
- Adding persisted set state to `CardState` or `DeckState`
- Resize snap (already works independently via `computeResizeSnap`)
- Sash rendering or docked corner computation (existing visual features, activation unchanged)
- Automated test suite for drag interaction (manual verification per strategy)

#### Dependencies / Prerequisites {#dependencies}

- Phase 5a2 (DeckManager Store Migration) must be complete -- provides the subscribable store pattern
- `snap.ts` module with `computeSnap`, `findSharedEdges`, `computeSets` exports
- `.snap-guide-line`, `.snap-guide-line-x`, `.snap-guide-line-y` CSS classes in `chrome.css`

#### Constraints {#constraints}

- Appearance changes go through CSS and DOM, never React state (Rules of Tug [D08], [D09])
- Never call `root.render()` after initial mount ([D40], [D42])
- Drag handler runs in a rAF loop -- snap computation must be fast enough for 60fps
- PointerEvent carries `altKey` natively -- no separate `keydown`/`keyup` listener needed

#### Assumptions {#assumptions}

- `snap.ts` geometry functions remain untouched as pure functions
- The `altKey` property on `PointerEvent` is read during `onPointerMove` -- since pointer events carry `altKey`, no separate keyboard listener is needed
- Break-out from a set is triggered by pressing Option during a set-move drag -- this detaches the dragged card and enters snap mode
- The change is ~180-220 lines in ~1 file (revised upward to account for set-move, break-out, guide management, and store commit ordering)

---

### Design Decisions {#design-decisions}

#### [D01] Snap gated on Option (Alt) modifier key (DECIDED) {#d01-modifier-gate}

**Decision:** Snap-to-edge and guide rendering activate only when `event.altKey` is true during drag. Free drag is the default.

**Rationale:**
- Matches design-system-concepts.md [D32]: snap requires Option modifier during drag
- Casual card repositioning should not trigger unintended snapping
- The modifier can be toggled mid-drag for fluid interaction

**Implications:**
- The `altKey` property is read from `PointerEvent` on every `pointermove` inside the rAF loop
- No separate `keydown`/`keyup` listener needed -- pointer events carry modifier state

#### [D02] Set-move active without modifier once set is formed (DECIDED) {#d02-set-move-always}

**Decision:** Once cards are snapped into a set, dragging any set member moves the entire group without requiring the Option modifier.

**Rationale:**
- Matches design-system-concepts.md [D33]: set-move is always active once a set is formed
- Requiring the modifier for every set-move would be tedious
- The modifier is only for *forming* sets, not for *using* them

**Implications:**
- At drag-start, compute set membership via `findSharedEdges` + `computeSets`
- If the dragged card belongs to a set, apply the drag delta to all set members
- Set membership is transient -- recomputed each drag-start from current positions

#### [D03] Snap guides rendered via direct DOM manipulation (DECIDED) {#d03-dom-guides}

**Decision:** Snap guide lines are created/positioned/removed as `<div>` elements with `.snap-guide-line` CSS classes via direct DOM manipulation inside the rAF loop.

**Rationale:**
- Consistent with Rules of Tug [D08]/[D09]: appearance changes go through CSS and DOM, never React state
- Guide lifetime exactly matches the drag gesture -- create on first snap, remove on drag-end or when Option is released
- No React re-renders during drag

**Implications:**
- Guide elements are appended to the canvas container (same parent as card frames)
- A ref tracks active guide elements for cleanup
- Guide position is set via `style.left` / `style.top` per the existing `.snap-guide-line-x` / `.snap-guide-line-y` CSS

#### [D04] Card rects snapshotted at drag-start (DECIDED) {#d04-rect-snapshot}

**Decision:** Other card rects are read from the DOM once at drag-start and cached for the duration of the drag, following the same pattern as `dragTabBarCache`.

**Rationale:**
- Avoids repeated DOM reads during the rAF loop (performance)
- Other cards do not move during a single-card drag (unless set-move, handled separately)
- Consistent with the existing `dragTabBarCache` pattern in `card-frame.tsx`

**Implications:**
- At drag-start, query all `.card-frame[data-card-id]` elements (excluding the dragged card) and read their `getBoundingClientRect()`
- Convert to canvas-relative `Rect` objects by subtracting the canvas element's own `getBoundingClientRect()` offset (`rect.x = domRect.left - canvasBounds.left`, etc.) since `snap.ts` operates in canvas-relative coordinates

#### [D05] Break-out is triggered by pressing Option during set-move (DECIDED) {#d05-breakout-trigger}

**Decision:** During a set-move drag (card belongs to a set, no Option held), pressing Option detaches the dragged card from the set. The other set members stop moving and remain at their current DOM positions. The detached card immediately enters snap mode (guides appear, can snap to a new target).

**Rationale:**
- Position-based break-out (comparing the card's position to the set bounding box) is fundamentally flawed during set-move: since all set members follow the dragged card by the same delta, the dragged card always stays at the same relative position within the set -- it can never "move away" from the bounding box
- Using the Option key as the explicit break-out trigger is consistent with the overall modifier design: Option means "I want to rearrange/snap" rather than "I want to move the group"
- The user flow is natural: drag a set (group moves), press Option to detach and snap the card elsewhere, release Option to return to free drag

**Implications:**
- In `applyDragFrame`, when `latestAltKey.current` transitions from false to true while `dragSetMembers.current` is non-empty: commit each set member's current DOM position via `onCardMoved`, then clear `dragSetMembers.current` and `dragSetOrigins.current` (detach)
- A `prevAltKey` ref tracks the previous frame's `altKey` value to detect the false-to-true transition
- No `BREAK_OUT_THRESHOLD_PX` constant is needed -- break-out is purely modifier-driven

#### [D06] Card merge takes priority over snap-on-drop (DECIDED) {#d06-merge-priority}

**Decision:** In `onPointerUp`, the existing card-as-tab merge hit-test ([D45]) runs first and returns early if a merge target is found. Snap-on-drop logic only executes if no merge occurred.

**Rationale:**
- Merge is an intentional action (user drags card onto a tab bar) and should not be overridden by snap proximity
- The existing `onPointerUp` already returns early after merge -- snap logic is appended after the merge check

**Implications:**
- No change to the existing merge hit-test code path
- Snap-on-drop and set-member position commit are placed after the merge early-return block

---

### Specification {#specification}

#### Drag Behavior Specification {#drag-behavior-spec}

**Spec S01: Modifier-Gated Snap Behavior** {#s01-snap-behavior}

| Condition | During drag | On drop |
|-----------|------------|---------|
| No Option key | Free movement via `clampedPosition`, no guides | Card lands at cursor position, no set formed |
| Option key held | `computeSnap` called, guides shown, card snaps to nearest edge within 8px | If snapped, set formed with adjacent card(s) |
| Option pressed mid-drag | Snap activates immediately on next rAF frame | N/A |
| Option released mid-drag | Snap deactivates, guides removed, card returns to cursor position | N/A |

**Spec S02: Set-Move and Break-Out Behavior** {#s02-set-move}

| Condition | Behavior |
|-----------|----------|
| Dragged card is in a set, no Option held | Set-move: all set members move by the same pointer displacement delta |
| Dragged card is not in a set | Single-card drag (normal behavior) |
| Option pressed during set-move (altKey transitions false-to-true) | Break-out: commit set members' current positions to the store, detach dragged card from set, enter snap mode |
| After break-out, Option still held | Detached card snaps to nearby edges, can form a new set on drop |
| After break-out, Option released | Detached card moves freely (no snap, no set) |

**Spec S03: Drop Priority** {#s03-drop-priority}

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 (highest) | Pointer over another card's tab bar ([D45]) | Merge -- existing code path, return early |
| 2 | Option held and snap result non-null | Snap-on-drop -- commit snapped position, commit set member positions |
| 3 (default) | Neither merge nor snap | Free drop -- commit clamped position |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Wire snap into card-frame.tsx drag path {#step-1}

**Commit:** `feat(tugways): wire Option-gated snap into card drag path`

**References:** [D01] Modifier gate, [D02] Set-move always, [D03] DOM guides, [D04] Rect snapshot, [D05] Break-out threshold, [D06] Merge priority, Spec S01, Spec S02, Spec S03, (#drag-behavior-spec, #context, #strategy)

**Artifacts:**
- Modified `tugdeck/src/components/chrome/card-frame.tsx` -- snap integration in `handleDragStart`

**Tasks:**
- [ ] Import `computeSnap`, `findSharedEdges`, `computeSets`, and types `Rect`, `GuidePosition`, `SnapResult` from `@/snap` at top of file
- [ ] Add a `dragOtherRects` ref (`useRef<{id: string; rect: Rect}[]>([])`) to cache other card rects during drag (keyed by id for `findSharedEdges` compatibility; extract `.rect` when calling `computeSnap`)
- [ ] Add a `dragGuideEls` ref (`useRef<HTMLElement[]>([])`) to track active guide DOM elements
- [ ] Add a `dragSetMembers` ref (`useRef<{id: string; el: HTMLElement}[]>([])`) to track set member card ids and frame elements (empty if not in a set). The `id` field is read from the element's `data-card-id` attribute at drag-start and used for `onCardMoved` calls. Note: cached element refs may become stale if React reconciles mid-drag, but this is safe because pointer capture prevents re-renders during drag (no state mutations until `onPointerUp`)
- [ ] Add a `dragSetOrigins` ref (`useRef<{x: number; y: number}[]>([])`) parallel to `dragSetMembers`, populated at drag-start with each set member's `parseFloat(el.style.left)` / `parseFloat(el.style.top)`. Using original DOM positions (not CardState props) ensures set-move deltas are computed in a single coordinate space
- [ ] Add a `latestAltKey` ref (`useRef(false)`) that is updated in `onPointerMove` from `e.altKey`
- [ ] Add a `prevAltKey` ref (`useRef(false)`) to track the previous frame's `altKey` value for detecting the false-to-true transition that triggers break-out
- [ ] Add a `lastSnapResult` ref (`useRef<SnapResult | null>(null)`) to carry the most recent snap result from `applyDragFrame` (rAF closure) to `onPointerUp` (pointer event closure)
- [ ] In `handleDragStart`, after building `dragTabBarCache`, snapshot other card rects: query all `.card-frame[data-card-id]` elements (excluding this card's id), read `getBoundingClientRect()`, convert to canvas-relative `Rect` objects by subtracting the canvas element's own `getBoundingClientRect()` offset (i.e., `rect.x = domRect.left - canvasBounds.left`, `rect.y = domRect.top - canvasBounds.top`; the canvas container has `position: relative` set by `DeckManager` at construction), and store in `dragOtherRects.current`
- [ ] In `handleDragStart`, compute set membership: construct `allCardRects` by prepending this card's own `{id, rect}` entry to `dragOtherRects.current`, then call `findSharedEdges(allCardRects)` followed by `computeSets(allCardRects.map(c => c.id), sharedEdges)`; if this card belongs to a set with 2+ members, store the other set members as `{id, el}` entries in `dragSetMembers.current` -- look up each element via `document.querySelector(.card-frame[data-card-id="..."])` and read `id` from the `data-card-id` attribute; simultaneously populate `dragSetOrigins.current` with each member's `{x: parseFloat(el.style.left), y: parseFloat(el.style.top)}`
- [ ] In `handleDragStart`, initialize `latestAltKey.current = false` and `prevAltKey.current = false`
- [ ] In `onPointerMove`, add `latestAltKey.current = e.altKey` after updating `latestDragPointer`. This is the sole write site for `latestAltKey` -- without it, snap never activates. Known limitation: if the user releases Option while the pointer is stationary, `latestAltKey` is not updated until the next `pointermove` event, so guides may persist briefly. This is acceptable for Phase 5c; a supplementary `keyup` listener could be added in a follow-on if needed
- [ ] In `applyDragFrame`, after computing `pos` via `clampedPosition`, implement break-out detection first: if `dragSetMembers.current` is non-empty and `latestAltKey.current` is true and `prevAltKey.current` was false (Option just pressed during set-move), then detach -- for each set member, read its current DOM position (`parseFloat(el.style.left)`, `parseFloat(el.style.top)`) and size (`el.offsetWidth`, `el.offsetHeight`) and call `onCardMoved(member.id, position, size)` to commit the in-flight positions to the store; then clear `dragSetMembers.current` and `dragSetOrigins.current`. This commits set member positions synchronously before the detached card enters snap mode
- [ ] After break-out check, update `prevAltKey.current = latestAltKey.current` for next frame
- [ ] In `applyDragFrame`, add the snap branch: if `latestAltKey.current` is true and `dragSetMembers.current` is empty (not in a set, or just broke out), call `computeSnap` with the moving card's rect (at `pos`, using `frame.offsetWidth`/`frame.offsetHeight` for size) against `dragOtherRects.current.map(r => r.rect)`; store the result in `lastSnapResult.current`; if snap result has non-null x/y, override `pos.x`/`pos.y`; call `syncGuides` to render guide DOM elements from `snap.guides`
- [ ] If `latestAltKey.current` is false and `dragSetMembers.current` is empty (solo card, no Option): set `lastSnapResult.current = null` and call `clearGuides`
- [ ] If `dragSetMembers.current` is non-empty and `latestAltKey.current` is false (set-move active, no break-out): compute pointer displacement `deltaX = latestDragPointer.current.x - dragStartPointer.current.x`, `deltaY = latestDragPointer.current.y - dragStartPointer.current.y`; apply to each set member: `el.style.left = (dragSetOrigins.current[i].x + deltaX) + 'px'`, `el.style.top = (dragSetOrigins.current[i].y + deltaY) + 'px'`. Using pointer displacement as the single delta source avoids mixing CardState position-space with DOM style-space
- [ ] Create helper `syncGuides(guides: GuidePosition[], container: HTMLElement)`: for each guide, create or reuse a `<div>` with `.snap-guide-line` + axis class (`.snap-guide-line-x` or `.snap-guide-line-y`), set only `style.left` (for x-axis guide) or `style.top` (for y-axis guide) -- the CSS classes already handle full extent via `top:0/bottom:0` and `left:0/right:0` respectively; append to container; remove excess guide elements; track in `dragGuideEls.current`
- [ ] Create helper `clearGuides()`: remove all guide elements from DOM, clear `dragGuideEls.current`
- [ ] In `onPointerUp`, call `clearGuides()` immediately after the `dragActive` check and before the merge hit-test. This ensures guides are removed from the DOM even if the merge early-return fires (otherwise guide elements would leak into the DOM on merge)
- [ ] In `onPointerUp`, respect drop priority (Spec S03): the existing merge hit-test ([D45]) runs first and returns early if a merge target is found. After the merge check (and after `dragTabBarCache` cleanup), the existing `clampedPosition` + `onCardMoved` call handles the dragged card's final position (this code is unchanged). After that existing call, add set-member commit logic: if `lastSnapResult.current` is non-null and has non-null x/y, the dragged card's `onCardMoved` should use the snapped position instead (`lastSnapResult.current.x ?? finalPos.x`, `lastSnapResult.current.y ?? finalPos.y`). Then, if `dragSetMembers.current` is non-empty (set-move completed without break-out), call `onCardMoved(member.id, ...)` for each member using their final position from `parseFloat(el.style.left)` / `parseFloat(el.style.top)` and size from `el.offsetWidth` / `el.offsetHeight`. All `onCardMoved` calls happen synchronously before any React re-render -- each call triggers `DeckManager.notify()` which queues a `useSyncExternalStore` update, but React batches these into a single synchronous render after the event handler completes, so DOM positions written during drag are committed to the store before React overwrites `style.left`/`style.top` from props
- [ ] In `onPointerUp`, reset `dragOtherRects.current`, `dragSetMembers.current`, `dragSetOrigins`, `latestAltKey.current`, `prevAltKey.current`, `lastSnapResult.current`

**Tests:**
- [ ] Manual: create 2+ cards, drag without Option -- no guides, no snapping
- [ ] Manual: drag with Option held near another card -- guides appear, card snaps
- [ ] Manual: press Option mid-drag -- guides appear immediately
- [ ] Manual: release Option mid-drag -- guides disappear, card follows cursor
- [ ] Manual: Option+drag to snap, release pointer -- set formed, subsequent drag moves group
- [ ] Manual: during set-move, press Option -- dragged card detaches from set, other members stop at their current positions, snap guides appear
- [ ] Manual: after break-out with Option held, drag near another card -- snaps to new set on drop

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with no errors
- [ ] `cd tugdeck && bun run lint` passes
- [ ] All manual test scenarios above pass in the browser

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Option-gated card snapping with snap guides, set formation, and set-move in the tugways canvas.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Free drag (no modifier) shows no snap guides and does not snap (manual verification)
- [ ] Option+drag shows snap guides and snaps to edges within 8px (manual verification)
- [ ] Mid-drag modifier toggle produces immediate visual response (manual verification)
- [ ] Set-move works without modifier after set formation (manual verification)
- [ ] Option-triggered break-out during set-move detaches card and enters snap mode (manual verification)
- [ ] `bun run build` and `bun run lint` pass with no errors or warnings

**Acceptance tests:**
- [ ] Create 3 cards via menu, Option+drag card A to snap beside card B, verify guide lines appear and set forms
- [ ] Drag card A (now in set with B) without Option -- both cards move together
- [ ] While set-moving A+B, press Option -- A detaches, B stays at its current position, snap guides appear
- [ ] With Option still held, drag A near card C -- A snaps to C, new set forms on drop

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Automated integration tests for drag+snap interaction (requires pointer event simulation)
- [ ] Sash handle rendering at shared edges (existing feature, activation unchanged)
- [ ] Docked corner computation for snapped sets (existing feature, activation unchanged)

| Checkpoint | Verification |
|------------|--------------|
| Build passes | `cd tugdeck && bun run build` |
| Lint passes | `cd tugdeck && bun run lint` |
| Snap guides visible | Manual: Option+drag near another card, blue dashed lines appear |
| Set-move works | Manual: snap two cards, drag one without Option, both move |
| Break-out works | Manual: during set-move, press Option, card detaches |
