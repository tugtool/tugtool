<!-- tugplan-skeleton v2 -->

## Card Snap Set Visual Refinements (Phase 5c2) {#phase-5c2}

**Purpose:** Ship four visual refinements that make snapped card sets look like unified shapes — squared internal corners, perimeter-only flash, break-out restoration, and border collapse via snap offset.

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

Phase 5c delivered modifier-gated snapping and set-move in card-frame.tsx. Manual testing revealed that while the snap geometry is correct, the visual presentation of snapped sets does not yet convey "unified shape." Cards that snap together still show doubled borders at seams, rounded corners at internal junctions, and flash their full individual perimeters rather than just the outer hull. These four refinements address those gaps.

All four decisions ([D53]–[D56]) are defined in design-system-concepts.md Entry 26. The work is purely visual — no changes to snap geometry, set computation, or drag behavior.

#### Strategy {#strategy}

- Start with the `computeSnap` border-width offset ([D56]) since it is a pure-function change in snap.ts with no DOM coupling
- Add per-corner squaring ([D53]) and flash edge suppression ([D54]) as DOM manipulation in card-frame.tsx — both operate in the appearance zone per [D08]/[D09]
- Wire break-out restoration ([D55]) last since it depends on the corner-rounding and flash helpers from D53/D54
- Keep snap.ts pure: border width is passed as a parameter, never read from the DOM inside snap.ts
- Reuse existing `.set-flash-overlay` CSS and `@keyframes set-flash-fade` from chrome.css — per-edge border suppression uses inline styles on transient overlay elements, no chrome.css changes needed
- All appearance mutations target the `.tugcard` element inside the card frame, accessed via `frame.querySelector('.tugcard')`

#### Success Criteria (Measurable) {#success-criteria}

- Two cards snapped side-by-side show zero visible double-border at their shared edge (visual inspection at 2x zoom)
- Internal corners of a 2-card horizontal set are squared (border-radius 0) while outer corners remain rounded (6px)
- Set formation flash shows accent border only on exterior edges; internal edges have no visible border
- Breaking out of a set restores all four rounded corners on the detached card and triggers a full-perimeter flash
- `computeSnap` with `borderWidth=0` produces identical results to the current implementation (backward compatible)

#### Scope {#scope}

1. [D56] Add optional `borderWidth` parameter to `computeSnap` in snap.ts
2. [D53] Per-corner squaring of `.tugcard` border-radius at internal seams on snap/set-move
3. [D54] Per-edge border suppression on `.set-flash-overlay` for internal seam edges
4. [D55] Corner restoration and full-perimeter flash on break-out

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing snap geometry, thresholds, or edge detection logic
- Resize-snap border collapse (only move-snap is affected)
- Animating corner radius transitions (instant change is intentional)
- Multi-set flash coordination (each set flashes independently)

#### Dependencies / Prerequisites {#dependencies}

- Phase 5c fully complete and committed (modifier-gated snap, set-move, break-out logic)
- `.set-flash-overlay` and `@keyframes set-flash-fade` already exist in chrome.css
- `.snap-guide-line` CSS already exists in chrome.css
- `.tugcard` uses `border: 1px solid var(--td-border)` and `border-radius: var(--td-radius-md)` (6px)

#### Constraints {#constraints}

- snap.ts must remain a pure-function module — no DOM access inside snap.ts
- All visual mutations are appearance-zone operations per [D08]/[D09] — direct DOM manipulation, no React state
- Never call `root.render()` after initial mount per [D40]
- No hardcoded pixel values for border width — use `getComputedStyle` to read the actual computed value

#### Assumptions {#assumptions}

- The `.tugcard` element is reachable from card-frame.tsx via `frame.querySelector('.tugcard')` for DOM mutations
- `computeSnap` borderWidth parameter defaults to 0, making it fully backward compatible with no test changes needed
- Set perimeter flash fires on pointer-up when a new set is formed, not during drag
- Phase 5c's break-out detection in `applyDragFrame` is the correct hook point for corner restoration

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the conventions defined in the tugplan skeleton. All headings that will be cited use explicit `{#anchor}` syntax. Decisions use `[DNN]` labels. Steps use `**References:**` and `**Depends on:**` lines.

---

### Design Decisions {#design-decisions}

#### [D01] Per-corner squaring via shared-edge neighbor lookup (DECIDED) {#d01-corner-squaring}

**Decision:** Each card in a set computes its four corner radii by checking whether each adjacent edge (top, right, bottom, left) has a neighbor in the set's shared-edge list. Corners where both forming edges have neighbors are squared; corners where either forming edge is exterior remain rounded.

**Rationale:**
- Per-corner logic handles arbitrary set topologies (L-shapes, T-shapes) not just rows/columns
- Reuses `findSharedEdges` already called at drag-start — no new geometry computation needed

**Implications:**
- A helper function `computeCornerRadii(cardId, sharedEdges)` returns a 4-tuple of CSS radius values
- Applied to `.tugcard` element via `style.borderRadius` (shorthand: top-left top-right bottom-right bottom-left)
- Must be recomputed for all set members when any member joins or leaves

#### [D02] Flash overlay per-edge border suppression via inline style (DECIDED) {#d02-flash-suppression}

**Decision:** When creating `.set-flash-overlay` elements for a set, compute which edges are internal seams and set `borderTop/Right/Bottom/Left` to `none` on internal edges via inline style. External edges keep the `3px solid var(--td-accent)` border.

**Rationale:**
- Inline styles are simpler than adding/removing CSS utility classes and avoid class name proliferation
- The flash overlay is a transient DOM element (removed after animation) so inline styles have no maintenance burden
- Matches the appearance-zone direct-DOM pattern used throughout card-frame.tsx

**Implications:**
- Each card's flash overlay has potentially different suppressed edges depending on its position in the set
- The flash overlay's `border-radius` must match the card's current corner rounding (squared at seams, rounded at exterior)
- The inline-style approach eliminates the need for per-edge CSS utility classes in chrome.css — design-system-concepts.md Entry 26 mentions chrome.css changes, but inline styles on transient overlay elements are simpler and sufficient

#### [D03] Border collapse offset applied only to snap-to-neighbor edges (DECIDED) {#d03-border-collapse}

**Decision:** The `borderWidth` parameter in `computeSnap` shifts the snap target position inward by `borderWidth` pixels when a moving card's edge aligns with a stationary card's edge. This makes adjacent borders overlap into a single visual line.

**Rationale:**
- Offset is applied per-axis at the point where snap delta is computed, requiring minimal code change
- Default value of 0 preserves existing behavior for all current callers
- Border width is read from the DOM in card-frame.tsx and passed as a number to keep snap.ts pure

**Implications:**
- Only `computeSnap` is modified; `computeResizeSnap` is not affected (resize-snap border collapse is out of scope)
- `findSharedEdges` uses the same `SNAP_THRESHOLD_PX` (8px) which naturally absorbs the ~1px border-width offset — no threshold change needed. The `boundaryPosition` calculation (midpoint of the two edges) will be ~0.5px off from the visual seam, but this value is only used for guide positioning, not for corner or flash computation. No modification to `findSharedEdges` is required

#### [D04] Break-out triggers corner restore, remaining-member recompute, and detached-card flash (DECIDED) {#d04-breakout-restore}

**Decision:** When break-out is detected in `applyDragFrame`, three things happen synchronously: (1) the detached card's `.tugcard` gets all four corners restored to `var(--td-radius-md)`, (2) remaining set members recompute their corner radii via the corner-squaring helper, and (3) a full-perimeter `.set-flash-overlay` is appended to the detached card's frame.

**Rationale:**
- Synchronous execution during break-out ensures no visual glitch between old corners and new corners
- Remaining members must recompute because the departed card's edge is now exterior for its former neighbors

**Implications:**
- The break-out block in `applyDragFrame` grows to include corner restore + flash creation
- Flash overlay self-removes via `animationend` event listener (same pattern used for set formation flash)

---

### Specification {#specification}

#### computeSnap Border-Width Offset {#spec-border-offset}

**Spec S01: computeSnap signature change** {#s01-snap-signature}

```typescript
export function computeSnap(
  moving: Rect,
  others: Rect[],
  validate?: EdgeValidator,
  borderWidth?: number   // NEW — default 0
): SnapResult;
```

When `borderWidth > 0`, the snap delta for each axis is adjusted: if the moving card's right edge snaps to a stationary card's left edge (or vice versa), the snap position shifts inward by `borderWidth` so the borders overlap. Specifically:
- Moving-right to other-left: `bestXDelta = otherEdge - movingEdge - borderWidth`
- Moving-left to other-right: `bestXDelta = otherEdge - movingEdge + borderWidth`
- Moving-bottom to other-top: `bestYDelta = otherEdge - movingEdge - borderWidth`
- Moving-top to other-bottom: `bestYDelta = otherEdge - movingEdge + borderWidth`

Edge-to-same-edge alignments (left-to-left, right-to-right, etc.) are NOT offset — only edge-to-adjacent-edge pairs receive the offset.

#### Corner Radius Computation {#spec-corner-radii}

**Spec S02: computeCornerRadii helper** {#s02-corner-radii}

```typescript
function computeCornerRadii(
  cardId: string,
  sharedEdges: SharedEdge[],
  radiusValue: string  // e.g. "6px" or "var(--td-radius-md)"
): { topLeft: string; topRight: string; bottomRight: string; bottomLeft: string }
```

First, determine which of the card's four edges have a neighbor using **directional** SharedEdge matching. The `findSharedEdges` convention encodes direction: `cardAId` is the card whose right/bottom edge is shared, `cardBId` is the card whose left/top edge is shared. The directional mapping (matching Spec S03's flash suppression logic):

- **right edge** has neighbor: exists a **vertical** SharedEdge where `cardAId === cardId` (card is on the left, its right edge is shared)
- **left edge** has neighbor: exists a **vertical** SharedEdge where `cardBId === cardId` (card is on the right, its left edge is shared)
- **bottom edge** has neighbor: exists a **horizontal** SharedEdge where `cardAId === cardId` (card is on top, its bottom edge is shared)
- **top edge** has neighbor: exists a **horizontal** SharedEdge where `cardBId === cardId` (card is on bottom, its top edge is shared)

Then for each corner, square it if **either** forming edge has a neighbor (OR logic):

- **top-left**: top has neighbor OR left has neighbor → `"0"`, else → `radiusValue`
- **top-right**: top has neighbor OR right has neighbor → `"0"`, else → `radiusValue`
- **bottom-right**: bottom has neighbor OR right has neighbor → `"0"`, else → `radiusValue`
- **bottom-left**: bottom has neighbor OR left has neighbor → `"0"`, else → `radiusValue`

**Why OR, not AND:** AND logic (square only when both forming edges have neighbors) fails the fundamental case. In a 2-card vertical stack (A on top, B on bottom), card A has a neighbor only on its bottom edge. Under AND, A's bottom-left corner checks (bottom=yes AND left=no) and stays rounded -- but design-system-concepts.md [D53] explicitly states "the top card squares its bottom-left/bottom-right." AND would produce zero squared corners for any 2-card pair. OR correctly squares corners along the seam. For L-shaped sets, OR may square an extra corner at the junction where only one edge has a neighbor; this is the intended visual -- that corner abuts a seam and should appear flush rather than rounded into a gap.

#### Flash Edge Suppression {#spec-flash-edges}

**Spec S03: flash overlay edge computation** {#s03-flash-edges}

For each card in a newly formed set, create a `.set-flash-overlay` element. Before appending, compute which edges face another set member:
- If the card has a shared **vertical** edge where it is on the **left** (cardAId, right edge shared): suppress `borderRight`
- If the card has a shared **vertical** edge where it is on the **right** (cardBId, left edge shared): suppress `borderLeft`
- If the card has a shared **horizontal** edge where it is on **top** (cardAId, bottom edge shared): suppress `borderBottom`
- If the card has a shared **horizontal** edge where it is on **bottom** (cardBId, top edge shared): suppress `borderTop`

Set via inline style: `el.style.borderRight = 'none'` etc. The overlay's `borderRadius` is set to match the card's current `.tugcard` border-radius (which has already been squared at seams by [D01]).

Additionally, apply `clip-path: inset(T R B L)` to each overlay to prevent box-shadow glow from bleeding across internal seam edges. For each edge: if internal, use `0` (flush clip); if exterior, use `-4px` (allow glow to extend). Example for a card with an internal right edge: `clip-path: inset(-4px 0 -4px -4px)`. The CSS `inset: -1px` on `.set-flash-overlay` remains unchanged — `clip-path` already constrains rendering on internal edges, making per-edge inset overrides unnecessary.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Border-width offset causes sub-pixel rendering artifacts | low | low | Use actual computed value, not hardcoded; test at 1x and 2x | Visual artifacts reported |
| Corner rounding computation incorrect for 3+ card sets | med | low | Test with L-shape and T-shape topologies in checkpoint | Non-trivial set layouts look wrong |

**Risk R01: Flash overlay border-radius mismatch** {#r01-flash-radius-mismatch}

- **Risk:** The flash overlay's border-radius does not match the card's current corner rounding, producing a visible gap or overlap at corners during the flash animation.
- **Mitigation:** Read the `.tugcard` element's current `style.borderRadius` and copy it to the flash overlay before appending.
- **Residual risk:** If corner rounding is applied after flash creation in the same frame, the flash may show stale radii. Mitigated by always applying corners before flash.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

No new files. All changes are to existing files.

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `computeSnap` | fn (modify) | `tugdeck/src/snap.ts` | Add optional `borderWidth` param (default 0) |
| `computeCornerRadii` | fn (new) | `tugdeck/src/components/chrome/card-frame.tsx` | Pure helper, returns per-corner radius strings |
| `applySetCorners` | fn (new) | `tugdeck/src/components/chrome/card-frame.tsx` | DOM mutation: applies corner radii to `.tugcard` elements in a set |
| `resetCorners` | fn (new) | `tugdeck/src/components/chrome/card-frame.tsx` | DOM mutation: restores all four corners to rounded |
| `flashSetPerimeter` | fn (new) | `tugdeck/src/components/chrome/card-frame.tsx` | Creates per-card `.set-flash-overlay` with edge suppression |
| `flashCardPerimeter` | fn (new) | `tugdeck/src/components/chrome/card-frame.tsx` | Creates full-perimeter flash for a single card (break-out) |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `computeCornerRadii` logic for various edge topologies | Corner squaring correctness |
| **Visual verification** | Manual inspection of snap sets at 1x and 2x zoom | Border collapse, flash, corner rounding |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add borderWidth parameter to computeSnap {#step-1}

**Commit:** `feat(snap): add borderWidth offset parameter to computeSnap for border collapse [D56]`

**References:** [D03] border collapse offset, Spec S01, (#spec-border-offset, #d03-border-collapse, #context)

**Artifacts:**
- Modified `tugdeck/src/snap.ts`: `computeSnap` function gains optional `borderWidth` parameter

**Tasks:**
- [ ] Add `borderWidth?: number` as the fourth parameter to `computeSnap`, defaulting to `0`
- [ ] Replace the nested array iteration (`for movingEdge of [movingLeft, movingRight]` / `for otherEdge of [otherLeft, otherRight]`) with four explicit named-edge comparisons per axis. This is necessary because array iteration loses track of which edge is which. For X-axis, the four comparisons and their offset rules are:
  - `movingLeft` vs `otherLeft` (same-edge, left-to-left): no offset
  - `movingLeft` vs `otherRight` (adjacent, moving-left to other-right): `delta = otherEdge - movingEdge + bw`
  - `movingRight` vs `otherLeft` (adjacent, moving-right to other-left): `delta = otherEdge - movingEdge - bw`
  - `movingRight` vs `otherRight` (same-edge, right-to-right): no offset
  Where `bw` is the resolved `borderWidth ?? 0`. Each comparison still uses the same best-distance tracking logic.
- [ ] Apply the same pattern for Y-axis with four explicit comparisons:
  - `movingTop` vs `otherTop` (same-edge): no offset
  - `movingTop` vs `otherBottom` (adjacent, moving-top to other-bottom): `delta = otherEdge - movingEdge + bw`
  - `movingBottom` vs `otherTop` (adjacent, moving-bottom to other-top): `delta = otherEdge - movingEdge - bw`
  - `movingBottom` vs `otherBottom` (same-edge): no offset
- [ ] Verify that with `borderWidth=0` the function produces identical results (run existing tests)

**Tests:**
- [ ] Existing snap tests pass unchanged (backward compatibility)

**Checkpoint:**
- [ ] `cd tugdeck && bun test snap` passes with no failures

---

#### Step 2: Wire borderWidth in card-frame.tsx drag handler {#step-2}

**Depends on:** #step-1

**Commit:** `feat(card-frame): pass computed border width to computeSnap for border collapse [D56]`

**References:** [D03] border collapse offset, Spec S01, (#spec-border-offset, #d03-border-collapse, #constraints)

**Artifacts:**
- Modified `tugdeck/src/components/chrome/card-frame.tsx`: drag handler reads border width and passes to `computeSnap`

**Tasks:**
- [ ] At drag-start (in `handleDragStart`), after snapshotting the frame element, read the `.tugcard` element's computed border width via `getComputedStyle(tugcardEl).borderTopWidth` and parse it to a number. Store in a ref (e.g. `dragBorderWidth`)
- [ ] In `applyDragFrame` where `computeSnap` is called, pass `dragBorderWidth.current` as the fourth argument: `computeSnap(movingRect, otherRects, undefined, dragBorderWidth.current)`. The explicit `undefined` for the `validate` parameter is required because `borderWidth` is the 4th positional parameter — TypeScript does not allow skipping positional args
- [ ] Verify visually: two cards snapped side-by-side show a single 1px border at their shared edge, not a doubled 2px border

**Tests:**
- [ ] Visual verification: snap two cards horizontally and vertically, confirm single-line border at seams at 2x zoom

**Checkpoint:**
- [ ] App builds without errors: `cd tugdeck && bun run build`
- [ ] No TypeScript errors: `cd tugdeck && bunx tsc --noEmit`

---

#### Step 3: Implement per-corner squaring helpers {#step-3}

**Depends on:** #step-2

**Commit:** `feat(card-frame): add computeCornerRadii and applySetCorners for per-corner squaring [D53]`

**References:** [D01] per-corner squaring, Spec S02, (#spec-corner-radii, #d01-corner-squaring)

**Artifacts:**
- New helper functions in `tugdeck/src/components/chrome/card-frame.tsx`: `computeCornerRadii`, `applySetCorners`, `resetCorners`

**Tasks:**
- [ ] Implement `computeCornerRadii(cardId, sharedEdges, radiusValue)` per Spec S02 — for each corner, check if either forming edge has a shared-edge neighbor. Return object with four radius strings
- [ ] Implement `applySetCorners(setCardIds, sharedEdges, radiusValue)` — for each card in the set, find its `.tugcard` DOM element via `.card-frame[data-card-id] .tugcard`, compute its corner radii, and apply via `style.borderRadius` (CSS shorthand: `topLeft topRight bottomRight bottomLeft`)
- [ ] Implement `resetCorners(cardFrameEl)` — find the `.tugcard` inside the frame and reset `style.borderRadius` to `''` (reverts to CSS default `var(--td-radius-md)`)
- [ ] Place all three functions as module-level functions in card-frame.tsx (outside the component, since they are pure helpers or DOM utilities)

**Tests:**
- [ ] Manual: verify `computeCornerRadii` produces correct results for a 2-card horizontal pair by inspecting DOM in devtools

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes
- [ ] `cd tugdeck && bun run build` succeeds

---

#### Step 4: Apply corner squaring on set formation and set-move {#step-4}

**Depends on:** #step-3

**Commit:** `feat(card-frame): apply set corner squaring on snap-to-set and set-move [D53]`

**References:** [D01] per-corner squaring, [D04] break-out restore, Spec S02, (#spec-corner-radii, #d01-corner-squaring, #strategy)

**Artifacts:**
- Modified `handleDragStart` and `onPointerUp` in card-frame.tsx to call `applySetCorners`

**Tasks:**
- [ ] In `onPointerUp` (drag end), after committing the final position and computing set membership for the new arrangement, call `findSharedEdges` and `computeSets` on the updated card positions. If the dragged card is now part of a set, call `applySetCorners` for all members of that set
- [ ] When a card is NOT in a set after drop, call `resetCorners` on it to ensure corners are rounded
- [ ] In the set-move path (modifier not held, set members moving together), corners were already applied at the previous formation — no action needed during the move itself
- [ ] At drag-start, reset corners only on the dragged card (not all cards) to ensure a clean slate for this card's snap evaluation. Other cards' corner state is managed by their own set membership and must not be disturbed

**Tests:**
- [ ] Visual: snap two cards side-by-side, verify internal corners are squared and external corners are rounded via devtools inspection of `.tugcard` style.borderRadius

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds
- [ ] Visual verification at 2x zoom: 2-card horizontal set shows correct corner rounding

---

#### Step 5: Implement flash overlay with per-edge suppression {#step-5}

**Depends on:** #step-4

**Commit:** `feat(card-frame): set perimeter flash with internal edge suppression [D54]`

**References:** [D02] flash suppression, Spec S03, (#spec-flash-edges, #d02-flash-suppression, #dependencies)

**Artifacts:**
- New helper functions `flashSetPerimeter` and `flashCardPerimeter` in card-frame.tsx
- Modified `onPointerUp` to trigger flash on set formation

**Tasks:**
- [ ] Implement `flashSetPerimeter(setCardIds, sharedEdges)` per Spec S03: for each card in the set, create a `.set-flash-overlay` div, compute which edges are internal seams, suppress those borders via inline style (`el.style.borderTop = 'none'` etc.), set the overlay's `borderRadius` to match the card's current `.tugcard` border-radius, append to the card's `.card-frame` element, and add an `animationend` listener to self-remove
- [ ] Address box-shadow bleed on internal edges: the CSS `.set-flash-overlay` has `box-shadow: 0 0 5px ... , inset 0 0 16px ...` which bleeds across suppressed internal edges. Apply `clip-path: inset(T R B L)` on each overlay to clip the glow to the exterior sides only. For internal edges, set the corresponding inset value to `0` (flush clip); for exterior edges, set it to `-4px` (allow glow to extend beyond the border). This clips the outer glow at seam edges while preserving it on the hull
- [ ] Implement `flashCardPerimeter(cardFrameEl)`: create a `.set-flash-overlay` div with all four borders intact (no suppression), inherit border-radius from the `.tugcard` element, append and self-remove on animationend
- [ ] In `onPointerUp`, after calling `applySetCorners`, call `flashSetPerimeter` for the newly formed set
- [ ] Ensure the flash overlay's `borderRadius` is read from the `.tugcard` element AFTER corner squaring has been applied (corners first, then flash). The inline `style.borderRadius` on the overlay is mandatory — the CSS rule `.set-flash-overlay { border-radius: inherit }` inherits from `.card-frame`, not `.tugcard`, so it would produce incorrect radii without the explicit inline override

**Tests:**
- [ ] Visual: form a 2-card set, verify flash shows accent border only on exterior edges
- [ ] Visual: verify internal edge has no visible flash border

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds
- [ ] Visual verification: set formation flash traces outer hull only

---

#### Step 6: Wire break-out corner restoration and flash {#step-6}

**Depends on:** #step-5

**Commit:** `feat(card-frame): break-out restores corners and flashes detached card [D55]`

**References:** [D04] break-out restore, (#d04-breakout-restore, #strategy)

**Artifacts:**
- Modified break-out detection block in `applyDragFrame` in card-frame.tsx

**Tasks:**
- [ ] In the break-out detection block (where `latestSnapModifier.current === true && prevSnapModifier.current === false` and set members exist), after committing member positions and clearing `dragSetMembers`:
  1. Call `resetCorners(frame)` on the detached card's frame to restore all four rounded corners
  2. Recompute shared edges and sets for the remaining members (excluding the detached card). Call `applySetCorners` on any remaining set to update their corner radii (the departed card's edge is now exterior for its former neighbors)
  3. If remaining members no longer form a set (were a 2-card set, now singletons), call `resetCorners` on each remaining member
  4. Call `flashCardPerimeter(frame)` on the detached card to flash its full perimeter
- [ ] Ensure corner restoration happens BEFORE flash creation so the flash shows the correct (rounded) border-radius

**Tests:**
- [ ] Visual: form a 3-card set, break out one card, verify: detached card has all rounded corners and flashes; remaining 2-card set recomputes corners correctly
- [ ] Visual: form a 2-card set, break out one card, verify: both cards return to fully rounded corners; detached card flashes

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds
- [ ] Visual verification: break-out produces correct corners and flash

---

#### Step 7: Integration Checkpoint {#step-7}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** [D01] corner squaring, [D02] flash suppression, [D03] border collapse, [D04] break-out restore, (#success-criteria)

**Tasks:**
- [ ] Verify all four refinements work together end-to-end
- [ ] Test: snap two cards side-by-side — single border line, squared internal corners, perimeter-only flash
- [ ] Test: snap a third card to form an L-shape — all corners compute correctly
- [ ] Test: break out from a set — corners restore, flash fires, remaining set recomputes
- [ ] Test: drag without modifier — free drag, no snap, no corner changes
- [ ] Test: `computeSnap` with `borderWidth=0` matches previous behavior (backward compat)

**Tests:**
- [ ] `cd tugdeck && bun test snap` — existing snap unit tests pass unchanged
- [ ] All five visual verification scenarios above pass at 2x zoom

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with no errors
- [ ] `cd tugdeck && bunx tsc --noEmit` passes
- [ ] `cd tugdeck && bun test snap` passes
- [ ] All five visual verification scenarios pass at 2x zoom

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Snapped card sets display as unified visual shapes with squared internal corners, single-line borders at seams, perimeter-only flash on formation, and correct corner/flash restoration on break-out.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `computeSnap` accepts optional `borderWidth` parameter, default 0, backward compatible (existing tests pass)
- [ ] Two cards snapped side-by-side show a single 1px border at the shared edge (no double-border)
- [ ] Internal corners are squared, external corners are rounded for any set topology
- [ ] Set formation flash shows accent border only on exterior edges
- [ ] Break-out restores rounded corners on detached card and triggers full-perimeter flash
- [ ] Remaining set members recompute corners after a break-out
- [ ] `cd tugdeck && bun run build` passes
- [ ] `cd tugdeck && bun test snap` passes

**Acceptance tests:**
- [ ] Visual: 2-card horizontal set — single border, correct corners, perimeter flash
- [ ] Visual: 3-card L-shape set — correct per-corner computation
- [ ] Visual: break-out from 3-card set — detached card rounds and flashes, remainder recomputes
- [ ] Visual: break-out from 2-card set — both cards fully rounded, detached flashes

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Resize-snap border collapse (not in scope for Phase 5c2)
- [ ] Animated corner radius transitions (instant change is intentional for now)
- [ ] Multi-set flash coordination
- [ ] Corner rounding for collapsed cards in sets

| Checkpoint | Verification |
|------------|--------------|
| snap.ts backward compat | `cd tugdeck && bun test snap` passes with no changes to existing tests |
| Build clean | `cd tugdeck && bun run build` exits 0 |
| Type check | `cd tugdeck && bunx tsc --noEmit` exits 0 |
| Visual: border collapse | 2-card set shows single border at seam (2x zoom) |
| Visual: corner squaring | Internal corners squared, external corners rounded |
| Visual: perimeter flash | Flash on exterior edges only, no internal edge flash |
| Visual: break-out restore | Detached card rounds corners and flashes full perimeter |
