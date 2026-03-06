<!-- tugplan-skeleton v2 -->

## Hull Polygon Visual Overhaul: SVG Flash and Virtual Set Shadow {#hull-polygon-visual-overhaul}

**Purpose:** Replace the broken per-card flash overlay system and per-card shadow clipping with a hull-polygon-based approach: one SVG flash element per set and one virtual shadow div per set, both derived from a shared `computeSetHullPolygon` function.

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

The current card snapping system has two visual subsystems that use per-card clip-path polygon logic, and both have problems. The set flash perimeter (`flashSetPerimeter`) creates individual overlay divs per card with complex polygon clip-paths that attempt to trace external edges while suppressing shared edges. This approach is fragile and visually broken -- gaps appear between card overlays. The shadow system uses per-card `clip-path: inset(...)` to clip `box-shadow` on shared internal edges, which is a maintenance burden and does not produce a unified elevation effect for the set as a whole.

Both problems share a common root: the system treats set visuals as per-card operations when they should be per-set operations. A single hull polygon that traces the outer perimeter of the entire set of snapped cards solves both problems cleanly.

#### Strategy {#strategy}

- Implement `computeSetHullPolygon` as a pure function in `snap.ts`, using coordinate compression and grid boundary tracing to compute the outer perimeter of a union of axis-aligned rectangles.
- Replace `flashSetPerimeter` with an SVG-based flash that creates one SVG element positioned on the ResponderScope, drawing a single `<path>` from the hull polygon with glow via SVG filter.
- Replace per-card `clip-path: inset(...)` shadow clipping with one virtual shadow div per set, using `clip-path: polygon(...)` from the hull polygon and CSS `filter: drop-shadow(...)`.
- Wire the virtual shadow element into the set-move RAF loop so it translates with the set during drag.
- Delete all obsolete per-card overlay/clipping helpers: `buildFlashPolygon`, `FLASH_PADDING`, `computeInternalEdges`, `buildClipPath`.
- Keep `flashCardPerimeter` unchanged (single-card break-out flash remains a simple overlay).

#### Success Criteria (Measurable) {#success-criteria}

- `computeSetHullPolygon` returns correct hull vertices for L-shapes, T-shapes, and staircases (verified by unit tests).
- Set flash displays a single continuous SVG perimeter stroke with glow, no gaps between cards (verified by manual visual test).
- Set shadow displays a unified drop-shadow that follows the hull polygon shape (verified by manual visual test).
- Shadow moves with the set during drag without flickering or disappearing (verified by manual drag test).
- `buildFlashPolygon`, `FLASH_PADDING`, `computeInternalEdges`, `buildClipPath` are deleted from the codebase.
- `cd tugdeck && bun test snap` passes with new hull polygon tests.
- `cd tugdeck && bun run build` succeeds with no errors.

#### Scope {#scope}

1. `computeSetHullPolygon` pure function in `snap.ts`
2. SVG flash replacement for `flashSetPerimeter`
3. Virtual set shadow replacement for per-card clip-path shadow clipping
4. Shadow element tracking during set-move drag
5. CSS changes for shadow removal on in-set cards and SVG flash styling
6. Deletion of obsolete helpers

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing `flashCardPerimeter` (single-card break-out flash stays as-is)
- Changing snap detection, set computation, or shared-edge algorithms
- Adding rounded corners to hull polygons (all set members already have `border-radius: 0`)
- Animating shadow changes (shadow recomputes instantly on set membership change)
- Live shadow updates during resize (shadow recomputes on resize-end only; acceptable for incremental single-card geometry changes)

#### Dependencies / Prerequisites {#dependencies}

- Existing `findSharedEdges` and `computeSets` functions in `snap.ts`
- Existing `updateSetAppearance` function in `card-frame.tsx`
- Existing `postActionSetUpdate` function in `card-frame.tsx`
- ResponderScope as the parent element of all `.card-frame` elements

#### Constraints {#constraints}

- Rules of Tugways: appearance changes go through CSS and DOM, never React state [D08, D09, D40, D42]
- Never call `root.render()` after initial mount
- All DOM mutations for flash and shadow are imperative (createElement, appendChild, style manipulation)
- Must use `bun` (never `npm`) for all JS tooling

#### Assumptions {#assumptions}

- The SVG flash element and shadow div are appended to the ResponderScope via imperative DOM manipulation, consistent with existing overlay patterns.
- The existing `set-flash-fade` CSS keyframe and animation duration (0.5s) are reused for the SVG flash animation.
- The hull polygon is computed in canvas-relative coordinates (same coordinate space as card rects).
- `computeInternalEdges` and `buildClipPath` are only used by `updateSetAppearance` and `flashSetPerimeter` -- once both are rewritten, these helpers can be deleted.
- Cards in a set already have `border-radius: 0` via CSS, so the hull polygon will trace sharp rectangular boundaries.
- Virtual set shadows must be visible immediately on page load for pre-existing sets. Step 3 includes a task to ensure `updateSetAppearance` is called once after initial card layout, adding a one-time call from DeckCanvas if the existing lifecycle does not already trigger it.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All key decisions were resolved in the clarification phase.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Hull polygon algorithm bug for complex shapes | high | med | Comprehensive unit tests for L, T, staircase, and single-rect cases | Visual artifacts in set perimeter flash or shadow |
| SVG filter performance with many sets | low | low | Sets are typically small (2-5 cards); SVG filter is lightweight | Frame drops observed during flash animation |
| Shadow z-index conflicts with card stacking | med | low | Shadow z-index = lowest set member z-index minus 1, managed in updateSetAppearance | Shadow appears above cards or obscures content |

**Risk R01: Hull polygon trace misses interior holes** {#r01-hull-interior}

- **Risk:** A pathological arrangement of rectangles could create an interior hole that the boundary trace algorithm does not handle (since it only traces the outer perimeter).
- **Mitigation:** The algorithm only needs the outer perimeter -- interior holes are irrelevant for both flash stroke and shadow clip-path. The coordinate compression + grid fill approach guarantees correct outer boundary tracing.
- **Residual risk:** None for the outer perimeter use case.

---

### Design Decisions {#design-decisions}

#### [D01] Hull polygon lives in snap.ts as a pure function (DECIDED) {#d01-hull-in-snap}

**Decision:** `computeSetHullPolygon` is implemented in `snap.ts` alongside `findSharedEdges` and `computeSets`.

**Rationale:**
- It is a pure geometry function with no DOM dependencies
- It operates on the same `Rect` type already used by snap functions
- Keeps all set geometry logic co-located

**Implications:**
- Exported from `snap.ts`, imported by `card-frame.tsx`
- Unit-testable in `snap.test.ts`

#### [D02] SVG flash replaces per-card overlay flash (DECIDED) {#d02-svg-flash}

**Decision:** `flashSetPerimeter` is rewritten to create one SVG element on the ResponderScope with a single `<path>` tracing the hull polygon, styled with a 3px accent stroke and an SVG `<filter>` for glow.

**Rationale:**
- Eliminates gaps between per-card overlays
- Single element is simpler to create, animate, and clean up
- SVG filters produce smooth glow effects without CSS box-shadow hacks

**Implications:**
- The SVG element is positioned at the hull bounding box on the ResponderScope
- Uses `overflow: visible` so glow extends beyond SVG bounds
- Self-removes on `animationend`
- `buildFlashPolygon`, `FLASH_PADDING` are deleted

#### [D03] Virtual shadow uses wrapper + clipped inner div (DECIDED) {#d03-virtual-shadow}

**Decision:** `updateSetAppearance` creates one shadow structure per set on the ResponderScope: a wrapper div with `filter: drop-shadow(...)` containing an inner div with `clip-path: polygon(...)` and an opaque background. The wrapper is NOT clipped so the shadow extends beyond the polygon shape; the inner div defines the visible shape.

**Rationale:**
- CSS `filter` is applied after `clip-path` in the rendering pipeline, so applying both on the same element would clip the shadow itself
- The wrapper + inner pattern lets `drop-shadow` operate on the painted area of the inner div (which is polygon-shaped) while the shadow extends freely beyond the wrapper bounds
- Produces a unified elevation effect for the entire set
- Eliminates per-card `clip-path: inset(...)` management

**Implications:**
- Wrapper div (`.set-shadow`): `position: absolute`, sized/positioned at hull bounding box, `filter: drop-shadow(0 2px 8px rgba(0,0,0,0.4))`, `pointer-events: none`, NOT clipped
- Inner div (`.set-shadow-shape`): `width: 100%`, `height: 100%`, `clip-path: polygon(...)` with hull vertices in element-local coords, `background: var(--td-surface)`. The background color does not need to match card surfaces exactly because the shadow wrapper's z-index is below all set member cards -- the inner shape is fully occluded by the cards stacked above it. Only the drop-shadow extending beyond the cards is visible.
- Each `.set-shadow` wrapper gets a `data-set-card-ids` attribute containing the sorted, comma-joined card IDs of its set (used for lookup during drag)
- Shadow z-index = lowest set member z-index minus 1 (managed in `updateSetAppearance`)
- Cards in a set get `box-shadow: none` via CSS `.card-frame[data-in-set="true"]` rule. This applies to ALL in-set cards regardless of focus state -- the virtual set shadow fully replaces per-card shadows for set members, including focused cards. The `.card-frame[data-in-set="true"]` selector has sufficient specificity to override the focused-card shadow rule.
- `computeInternalEdges` and `buildClipPath` are deleted

#### [D04] Shadow z-index managed in updateSetAppearance (DECIDED) {#d04-shadow-zindex}

**Decision:** Shadow element z-index calculation happens inside `updateSetAppearance`, which already manages set z-index grouping.

**Rationale:**
- `updateSetAppearance` already has access to all card z-indices and set membership
- Keeps z-index logic centralized in one function
- Shadow z-index = lowest set member z-index minus 1 ensures shadow is behind all set members

**Implications:**
- No separate z-index management needed elsewhere

#### [D05] Shadow ref stored at drag-start for RAF loop (DECIDED) {#d05-shadow-ref}

**Decision:** At set-move drag-start, look up the set's shadow element by matching the `data-set-card-ids` attribute (sorted, comma-joined card IDs) against the current set membership. Store a direct reference (and its starting position) in a `useRef`. In the RAF loop, apply the same clamped delta to the shadow's `left`/`top`.

**Rationale:**
- `data-set-card-ids` provides a deterministic lookup that works correctly in multi-set scenarios (no geometric heuristics)
- Avoids querying the DOM for the shadow element every frame
- Same pattern as `dragSetMembers` / `dragSetOrigins` refs
- On drop, `updateSetAppearance` recomputes everything fresh

**Implications:**
- New refs: `dragShadowEl` and `dragShadowOrigin`
- Shadow lookup: build the sorted, comma-joined card ID string for the current set, then `document.querySelector('.set-shadow[data-set-card-ids="..."]')`
- Shadow must never be hidden during drag

#### [D07] Container element parameter for flash and shadow functions (DECIDED) {#d07-container-param}

**Decision:** `flashSetPerimeter`, `updateSetAppearance`, and `postActionSetUpdate` all gain a `containerEl: HTMLElement` parameter representing the ResponderScope element. `postActionSetUpdate` passes it through to both `flashSetPerimeter` and `updateSetAppearance`. Call sites obtain it from `frame.parentElement` (drag-end) or the resize equivalent.

**Rationale:**
- Both flash SVG and shadow divs must be appended to the ResponderScope
- Explicit parameter is clearer than querying the DOM or relying on global selectors
- Consistent with existing pattern where `canvasBounds` is already passed through

**Implications:**
- `postActionSetUpdate` signature changes: adds `containerEl` parameter
- Call sites in drag-end and resize-end pass `frame.parentElement` as the container
- `flashSetPerimeter` no longer queries individual card frame elements to find a parent

#### [D06] Fail-safe edge case handling (DECIDED) {#d06-fail-safe}

**Decision:** If `computeSetHullPolygon` returns an empty polygon (degenerate input), skip creating the SVG flash or shadow div for that set. No crash, no visual artifact.

**Rationale:**
- Defensive programming; degenerate input should not break the UI
- An empty polygon means no perimeter to draw

**Implications:**
- Guard check at call sites before creating DOM elements

---

### Specification {#specification}

#### computeSetHullPolygon Algorithm {#hull-algorithm}

**Spec S01: computeSetHullPolygon Signature** {#s01-hull-signature}

```typescript
export interface Point {
  x: number;
  y: number;
}

/**
 * Compute the outer perimeter polygon of a union of axis-aligned rectangles.
 * Returns vertices in canvas coordinates, ordered clockwise.
 * Returns empty array for degenerate input (no rects, zero-area rects).
 */
export function computeSetHullPolygon(rects: Rect[]): Point[];
```

**Spec S02: Hull Algorithm Steps** {#s02-hull-steps}

1. Collect all unique X coordinates (left and right edges of all rects) into sorted array `xs`.
2. Collect all unique Y coordinates (top and bottom edges of all rects) into sorted array `ys`.
3. Build a boolean grid of size `(xs.length - 1) x (ys.length - 1)`: cell `(i, j)` is filled if any rect covers the region `xs[i]..xs[i+1]`, `ys[j]..ys[j+1]`.
4. Find the topmost-leftmost filled cell. Start at its top-left corner, facing right.
5. Trace clockwise boundary using the following pseudocode:

```
directions = [RIGHT, DOWN, LEFT, UP]  // clockwise order
dir = RIGHT  // initial direction (index 0)
startPos = top-left corner of topmost-leftmost filled cell
startDir = dir
pos = startPos
vertices = [pos]

loop:
  // Try turn-right first (check cell to the right of current direction)
  rightDir = directions[(dirIndex + 1) % 4]
  // "cell to the right" = the cell that would be on your right side
  // as you walk in direction `dir` from position `pos`
  if cellToRight(pos, dir) is filled:
    dir = rightDir
    pos = pos + step(dir)
    append pos to vertices
  // Try straight (check cell ahead)
  elif cellAhead(pos, dir) is filled:
    pos = pos + step(dir)
    append pos to vertices
  // Turn left (stay at same position, rotate direction)
  else:
    dir = directions[(dirIndex + 3) % 4]  // turn left
    // do NOT move, do NOT append vertex (direction change only)

  if pos == startPos and dir == startDir:
    break  // completed the loop

// cellAhead(pos, dir): the cell whose edge you are currently
//   walking along (the filled cell to your right as you face dir).
//   At corner (col, row):
//   RIGHT → cell at (col, row)      [below-right of corner]
//   DOWN  → cell at (col-1, row)    [below-left of corner]
//   LEFT  → cell at (col-1, row-1)  [above-left of corner]
//   UP    → cell at (col, row-1)    [above-right of corner]
//
// cellToRight(pos, dir): the cell that would be to your right
//   AFTER turning right (one step ahead in the turned direction).
//   At corner (col, row):
//   RIGHT → cell at (col, row-1)    [above-right of corner]
//   DOWN  → cell at (col, row)      [below-right of corner]
//   LEFT  → cell at (col-1, row)    [below-left of corner]
//   UP    → cell at (col-1, row-1)  [above-left of corner]
```

6. Post-process: remove collinear vertices. A vertex is collinear if the direction from its predecessor to itself equals the direction from itself to its successor. This produces minimal polygons (e.g. a simple rectangle yields exactly 4 vertices, not 4+N for intermediate grid corners along straight edges).

7. Return vertices in canvas coordinates (convert grid indices back via `xs[col]`, `ys[row]`).

**Worked example: two horizontally adjacent cells (2x1 grid)**

Grid (2 columns, 1 row), both cells filled. Corner positions use `(col, row)` notation:

```
  col0  col1  col2
row0  +-----+-----+
      |fill  |fill |
row1  +-----+-----+
```

The trace starts at corner `(0,0)` facing RIGHT. It follows the outer boundary clockwise, visiting corners: `(0,0) → (1,0) → (2,0) → (2,1) → (1,1) → (0,1) → (0,0)`.

At corners `(1,0)` and `(1,1)`, the trace continues straight because the cell ahead is filled -- these are intermediate corners along straight edges. After collinear vertex removal, the result is 4 vertices: `(0,0) → (2,0) → (2,1) → (0,1)` -- the bounding rectangle of the merged pair.

For an L-shape (3 cells in an L), the trace produces 6 vertices after collinear removal -- the concave corner where the L bends is preserved because the direction changes there.

**Spec S03: SVG Flash Element Structure** {#s03-svg-flash}

```
<svg class="set-flash-svg" style="position:absolute; left:{bx}px; top:{by}px; width:{bw}px; height:{bh}px; overflow:visible; pointer-events:none; z-index:9999;">
  <defs>
    <filter id="set-flash-glow-{uid}">
      <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <path d="{svgPath}" fill="none" stroke="var(--td-accent)" stroke-width="3"
        filter="url(#set-flash-glow-{uid})"/>
</svg>
```

Where `bx, by, bw, bh` are the hull bounding box (with padding for glow), `svgPath` is the hull polygon converted to SVG path data (M/L commands) in SVG-local coordinates (hull coords minus bounding box origin), and `uid` is a unique identifier generated by a module-level counter (`let nextFlashId = 0; const uid = nextFlashId++;`). This ensures each SVG filter has a unique ID even when multiple flashes are active simultaneously.

**Spec S04: Shadow Element Structure** {#s04-shadow-element}

```html
<div class="set-shadow" data-set-card-ids="{sortedCommaJoinedIds}" style="
  position: absolute;
  left: {hx}px; top: {hy}px;
  width: {hw}px; height: {hh}px;
  filter: drop-shadow(0 2px 8px rgba(0,0,0,0.4));
  z-index: {lowestSetMemberZ - 1};
  pointer-events: none;
">
  <div class="set-shadow-shape" style="
    width: 100%; height: 100%;
    clip-path: polygon({localHullCoords});
    background: var(--td-surface);
  "/>
</div>
```

Where `hx, hy, hw, hh` are the hull bounding box, `localHullCoords` are hull vertices translated to element-local coordinates, and `sortedCommaJoinedIds` is the sorted, comma-joined card IDs of the set (used for lookup during drag per [D05]).

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

No new files. All changes are to existing files.

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `Point` | interface | `snap.ts` | `{ x: number; y: number }` |
| `computeSetHullPolygon` | fn | `snap.ts` | Pure function: `Rect[] -> Point[]` |
| `flashSetPerimeter` | fn (modify) | `card-frame.tsx` | Rewrite: new signature with `containerEl` param, SVG hull flash |
| `updateSetAppearance` | fn (modify, export) | `card-frame.tsx` | New `containerEl` param, virtual shadow creation, remove per-card clip-path; exported for DeckCanvas initial-load call |
| `postActionSetUpdate` | fn (modify) | `card-frame.tsx` | New `containerEl` param, passes to flash and shadow functions |
| `dragShadowEl` | ref | `card-frame.tsx` | Shadow wrapper element ref for RAF loop |
| `dragShadowOrigin` | ref | `card-frame.tsx` | Shadow starting position for RAF loop |
| `nextFlashId` | let (module-level) | `card-frame.tsx` | Counter for unique SVG filter IDs |
| `buildFlashPolygon` | fn (delete) | `card-frame.tsx` | Replaced by hull polygon |
| `FLASH_PADDING` | const (delete) | `card-frame.tsx` | No longer needed |
| `computeInternalEdges` | fn (delete) | `card-frame.tsx` | Replaced by hull polygon |
| `buildClipPath` | fn (delete) | `card-frame.tsx` | Replaced by hull polygon |
| `.set-flash-svg` | CSS class | `chrome.css` | SVG flash styling |
| `.set-shadow` | CSS class | `chrome.css` | Virtual shadow wrapper styling |
| `.set-shadow-shape` | CSS class | `chrome.css` | Inner clipped shape for shadow |
| `.set-flash-overlay` | CSS class (rename) | `chrome.css` | Renamed to `.card-flash-overlay` for single-card break-out flash |
| `.card-flash-overlay` | CSS class | `chrome.css` | Renamed from `.set-flash-overlay`, used by `flashCardPerimeter` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `computeSetHullPolygon` with various rect configurations | Core geometry logic, edge cases |
| **Build** | Verify the project compiles cleanly | After every step |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers -- add an anchor instead.

#### Step 1: Implement computeSetHullPolygon with unit tests {#step-1}

**Commit:** `feat(snap): add computeSetHullPolygon for outer perimeter of rect unions`

**References:** [D01] Hull in snap.ts, [D06] Fail-safe edge cases, Spec S01, Spec S02, (#hull-algorithm, #success-criteria)

**Artifacts:**
- `tugdeck/src/snap.ts` -- new `Point` interface and `computeSetHullPolygon` function
- `tugdeck/src/__tests__/snap.test.ts` -- new test cases for hull polygon

**Tasks:**
- [ ] Add `Point` interface to `snap.ts`
- [ ] Implement `computeSetHullPolygon` following Spec S02 algorithm: coordinate compression, grid fill, clockwise boundary trace, collinear vertex removal
- [ ] Handle degenerate cases: empty array, zero-area rects, single rect (returns 4 vertices after collinear removal)
- [ ] Add unit tests:
  - Single rectangle: returns 4 corners clockwise
  - Two rectangles side by side (horizontal): returns 4 corners of combined bounding box
  - Two rectangles stacked (vertical): returns 4 corners of combined bounding box
  - L-shape (3 rectangles): returns 6-vertex polygon
  - T-shape: returns 8-vertex polygon
  - Staircase (3 rects diagonal): returns polygon tracing the staircase outline
  - Overlapping rectangles: merged correctly
  - Empty input: returns empty array
  - Single zero-area rect: returns empty array

**Tests:**
- [ ] All `computeSetHullPolygon` unit tests pass

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test snap`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build`

---

#### Step 2: Replace flashSetPerimeter with SVG hull flash {#step-2}

**Depends on:** #step-1

**Commit:** `feat(card-frame): replace per-card flash overlays with single SVG hull flash`

**References:** [D02] SVG flash, [D06] Fail-safe edge cases, [D07] Container element parameter, Spec S03, (#strategy, #success-criteria)

**Artifacts:**
- `tugdeck/src/components/chrome/card-frame.tsx` -- rewritten `flashSetPerimeter`, updated `postActionSetUpdate`
- `tugdeck/styles/chrome.css` -- new `.set-flash-svg` class, update `.set-flash-overlay` usage

**Tasks:**
- [ ] Change `flashSetPerimeter` signature to accept `containerEl: HTMLElement` (the ResponderScope) as a new parameter, replacing per-card frame lookup
- [ ] Rewrite `flashSetPerimeter` body to:
  1. Collect rects for all cards in the set from `cardRects` parameter
  2. Call `computeSetHullPolygon` with those rects
  3. Guard: if hull is empty, return early (fail-safe per [D06])
  4. Compute hull bounding box with glow padding (4px)
  5. Create SVG element with `<defs>` containing glow filter (feGaussianBlur + feMerge)
  6. Create `<path>` element with hull polygon as SVG path data (M/L/Z), translated to SVG-local coords
  7. Style: `stroke: var(--td-accent)`, `stroke-width: 3`, `fill: none`, filter reference
  8. Position SVG at hull bounding box on the ResponderScope
  9. Add `set-flash-fade` animation via CSS class
  10. Self-remove on `animationend`
  11. Append SVG to `containerEl`
- [ ] Update `postActionSetUpdate` signature to accept `containerEl: HTMLElement` parameter per [D07]
- [ ] Update `postActionSetUpdate` to pass `containerEl` through to `flashSetPerimeter`
- [ ] Update call sites of `postActionSetUpdate` (drag-end and resize-end) to pass `frame.parentElement` as `containerEl`
- [ ] Add `.set-flash-svg` CSS class in `chrome.css` with `overflow: visible` and animation binding
- [ ] Delete `buildFlashPolygon` function
- [ ] Delete `FLASH_PADDING` constant
- [ ] Verify `flashCardPerimeter` is unchanged (single-card break-out flash)

**Tests:**
- [ ] Build succeeds with no errors

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build`

---

#### Step 3: Replace per-card shadow clipping with virtual set shadow {#step-3}

**Depends on:** #step-1

**Commit:** `feat(card-frame): replace per-card clip-path shadow with virtual set shadow divs`

**References:** [D03] Virtual shadow wrapper + inner div, [D04] Shadow z-index, [D05] Shadow ref with data-set-card-ids lookup, [D06] Fail-safe edge cases, [D07] Container element parameter, Spec S04, (#strategy, #success-criteria)

**Artifacts:**
- `tugdeck/src/components/chrome/card-frame.tsx` -- modified `updateSetAppearance`
- `tugdeck/styles/chrome.css` -- new `.set-shadow` and `.set-shadow-shape` styling, updated `data-in-set` shadow rule

**Tasks:**
- [ ] Export `updateSetAppearance` from `card-frame.tsx` (change from module-private `function` to `export function`) so DeckCanvas can call it on initial load
- [ ] Change `updateSetAppearance` signature to accept `containerEl: HTMLElement` parameter per [D07]
- [ ] Update `postActionSetUpdate` to pass `containerEl` through to `updateSetAppearance` (same parameter it already passes to `flashSetPerimeter` from Step 2)
- [ ] In `updateSetAppearance`, at the start of the function, remove all existing `.set-shadow` elements from `containerEl` (query and remove). This remove-and-recreate pattern is intentionally acceptable: all DOM mutations (remove old shadows, create new shadows) execute synchronously within a single JS microtask, so the browser will not paint an intermediate frame without shadows. No flicker occurs.
- [ ] For each set computed by `computeSets`:
  1. Collect rects for all set members
  2. Call `computeSetHullPolygon` with those rects
  3. Guard: if hull is empty, skip this set (fail-safe per [D06])
  4. Compute hull bounding box
  5. Create wrapper div (`.set-shadow`) per Spec S04: `position: absolute`, sized at hull bounding box, `filter: drop-shadow(0 2px 8px rgba(0,0,0,0.4))`, `pointer-events: none`, NO clip-path on wrapper
  6. Set `data-set-card-ids` attribute on wrapper to sorted, comma-joined card IDs of the set (for deterministic lookup during drag per [D05])
  7. Create inner div (`.set-shadow-shape`): `width: 100%`, `height: 100%`, `clip-path: polygon(...)` with hull vertices in element-local coords, `background: var(--td-surface)`
  8. Append inner div to wrapper div
  9. Compute shadow z-index = lowest z-index among set member elements minus 1
  10. Append wrapper div to `containerEl`
- [ ] Remove per-card `clip-path: inset(...)` logic from `updateSetAppearance` (the `el.style.clipPath = buildClipPath(...)` and `el.style.clipPath = ""` lines)
- [ ] Delete `computeInternalEdges` function
- [ ] Delete `buildClipPath` function
- [ ] In `chrome.css`, delete the existing `.card-frame[data-in-set="true"][data-focused="true"] { box-shadow: var(--td-card-shadow-active) }` rule -- this rule is now obsolete because virtual set shadows fully replace per-card shadows for in-set cards
- [ ] In `chrome.css`, add `.card-frame[data-in-set="true"] { box-shadow: none }` rule. This rule must appear AFTER the `.card-frame[data-focused="true"] { box-shadow: var(--td-card-shadow-active) }` rule in the file so it wins the cascade (both selectors have equal specificity: one class + one attribute selector). Place it in the existing set membership CSS section, which already appears after the focus section.
- [ ] In `chrome.css`, add `.set-shadow` and `.set-shadow-shape` base styles
- [ ] Ensure `updateSetAppearance` is called once after initial card layout so that pre-existing sets (loaded from saved state) get shadow divs at page load. DeckCanvas imports the exported `updateSetAppearance` from `card-frame.tsx` and calls it in its `useEffect` after mount, passing the ResponderScope container element and canvas bounds. This ensures shadows are visible immediately, not only after the first user interaction.

**Tests:**
- [ ] Build succeeds with no errors

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build`

---

#### Step 4: Wire shadow element into set-move RAF loop {#step-4}

**Depends on:** #step-3

**Commit:** `feat(card-frame): translate virtual shadow during set-move drag`

**References:** [D05] Shadow ref at drag-start, (#strategy, #success-criteria)

**Artifacts:**
- `tugdeck/src/components/chrome/card-frame.tsx` -- new refs, drag-start snapshot, RAF loop update

**Tasks:**
- [ ] Add `dragShadowEl` ref (`useRef<HTMLElement | null>`) and `dragShadowOrigin` ref (`useRef<{x: number, y: number}>`)
- [ ] In `handleDragStart`, when set-move is detected (after `dragSetMembers` is populated):
  1. Build the sorted, comma-joined card ID string from `dragSetMemberIdsAtDragStart.current` (which already includes the dragged card's own `id` plus all set members)
  2. Query the shadow element deterministically: `document.querySelector('.set-shadow[data-set-card-ids="' + idString + '"]')`
  3. Store reference in `dragShadowEl.current`
  4. Store its starting `left`/`top` (parsed from `style.left`/`style.top`) in `dragShadowOrigin.current`
- [ ] In `applyDragFrame` RAF loop, in the set-move branch (where `dragSetMembers` are moved):
  1. If `dragShadowEl.current` is not null, apply the same `clampedDeltaX`/`clampedDeltaY` to its `left`/`top` using `dragShadowOrigin.current`
- [ ] On break-out (modifier key pressed during set-move), clear `dragShadowEl.current` (the shadow remains visible at the set's current position; it will be recomputed by `updateSetAppearance` at drag-end via `postActionSetUpdate`)
- [ ] On drag end, clear `dragShadowEl.current` (shadow recomputed by `updateSetAppearance`)
- [ ] Shadow must never be hidden during drag -- it stays visible at all times
- [ ] Note: during resize operations, the shadow is NOT live-updated in the RAF loop; it is recomputed on resize-end when `updateSetAppearance` runs. This is acceptable because resize changes a single card's geometry incrementally, and the shadow snaps to the correct shape on completion.

**Tests:**
- [ ] Build succeeds with no errors

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build`

---

#### Step 5: CSS cleanup and final deletions {#step-5}

**Depends on:** #step-2, #step-3

**Commit:** `refactor(chrome): remove obsolete per-card flash overlay CSS`

**References:** [D02] SVG flash, [D03] Virtual shadow, (#success-criteria)

**Artifacts:**
- `tugdeck/styles/chrome.css` -- remove `.set-flash-overlay` rule (replaced by `.set-flash-svg`)

**Tasks:**
- [ ] Rename `.set-flash-overlay` to `.card-flash-overlay` in `chrome.css` (the class name now accurately reflects its single-card break-out purpose)
- [ ] Update `flashCardPerimeter` in `card-frame.tsx` to use `card-flash-overlay` instead of `set-flash-overlay`
- [ ] Add `.set-flash-svg` CSS class in `chrome.css` if not already added in Step 2 (defensive check)
- [ ] Verify no remaining references to `set-flash-overlay` anywhere in the codebase (all uses should now be `card-flash-overlay` or `set-flash-svg`)
- [ ] Verify no remaining references to `buildFlashPolygon`, `FLASH_PADDING`, `computeInternalEdges`, `buildClipPath` in the codebase
- [ ] Verify `clip-path` is no longer set on `.card-frame` elements by `updateSetAppearance`

**Tests:**
- [ ] Build succeeds with no errors

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build`

---

#### Step 6: Integration Checkpoint {#step-6}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] Hull in snap.ts, [D02] SVG flash, [D03] Virtual shadow, [D05] Shadow ref at drag-start, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all unit tests pass
- [ ] Verify build succeeds
- [ ] Verify the following helpers are deleted: `buildFlashPolygon`, `FLASH_PADDING`, `computeInternalEdges`, `buildClipPath`
- [ ] Verify `flashCardPerimeter` is unchanged in behavior
- [ ] Verify no per-card `clip-path: inset(...)` is applied by `updateSetAppearance`

**Tests:**
- [ ] All `computeSetHullPolygon` unit tests pass (aggregate verification)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test snap`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A hull-polygon-based visual system for card sets: one SVG flash per set (replacing broken per-card overlays), one virtual shadow div per set (replacing per-card clip-path clipping), with shadow tracking during set-move drag.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `computeSetHullPolygon` exists in `snap.ts` with comprehensive unit tests (`cd tugdeck && bun test snap`)
- [ ] `flashSetPerimeter` creates a single SVG element per set with hull polygon path and glow filter
- [ ] `updateSetAppearance` creates virtual shadow divs per set with hull polygon clip-path
- [ ] Shadow elements translate with the set during drag (RAF loop)
- [ ] `buildFlashPolygon`, `FLASH_PADDING`, `computeInternalEdges`, `buildClipPath` are deleted
- [ ] `cd tugdeck && bun run build` passes with no errors

**Acceptance tests:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test snap`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build`

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Animate shadow transitions when set membership changes (fade in/out)
- [ ] Add rounded corner support to hull polygon for aesthetic polish
- [ ] Performance optimization for very large sets (10+ cards) if needed

| Checkpoint | Verification |
|------------|--------------|
| Hull polygon unit tests pass | `cd tugdeck && bun test snap` |
| Build succeeds | `cd tugdeck && bun run build` |
| Obsolete helpers deleted | grep for `buildFlashPolygon`, `computeInternalEdges`, `buildClipPath` returns no results |
