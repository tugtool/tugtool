## Phase 2.0: Snap, Sets, and Shared-Edge Resize {#phase-snap-sets}

**Purpose:** Add snap-during-move and snap-during-resize behavior, shared-edge detection and resize, guide lines during drag, set dragging (top-most panel moves set, others break out), and set recomputation on close to the canvas panel system.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-18 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The canvas panel system (Change A) is fully implemented. Panels float independently on a canvas with free-form move and resize, a flat CanvasState data model, z-order focus, and localStorage persistence. However, panels currently have no awareness of each other during drag operations. Users cannot align panels to each other, cannot resize a shared boundary between two adjacent panels, and cannot move groups of touching panels as a unit. Change B from the roadmap addresses all of these gaps.

The existing implementation lives in `tugdeck/src/panel-manager.ts` (PanelManager), `tugdeck/src/floating-panel.ts` (FloatingPanel), `tugdeck/src/layout-tree.ts` (CanvasState/PanelState types), and `tugdeck/styles/panels.css`. FloatingPanel already handles individual move and resize via pointer events with callbacks to PanelManager. This phase adds a new `snap.ts` module of pure functions consumed by PanelManager, plus a virtual sash element for shared-edge resize and guide line DOM elements for visual feedback.

#### Strategy {#strategy}

- Build snap geometry as a pure-function module (`snap.ts`) with no DOM or state dependencies, making it testable in isolation.
- Wire snap into the existing FloatingPanel move/resize pointer event loops via new `onMoving`/`onResizing` live callbacks.
- Detect shared edges from panel positions after every move-end, resize-end, and close; store sets as a runtime-only data structure in PanelManager.
- Inject virtual sash elements at shared boundaries for shared-edge resize, with their own pointer event handling.
- Use absolutely-positioned div elements in the canvas container for guide lines, shown/hidden during drag.
- Implement set dragging: top-most (highest z-index) panel drag moves the entire set; dragging any other panel breaks it out.

#### Stakeholders / Primary Customers {#stakeholders}

1. Tugdeck end users who want panel alignment and grouped behavior
2. Tugdeck developers maintaining the panel system

#### Success Criteria (Measurable) {#success-criteria}

- Dragging a panel within 8px of another panel's edge snaps to alignment (verifiable by comparing final position to target panel edge)
- Resizing a panel within 8px of another panel's edge snaps to alignment
- Two panels with zero-gap aligned edges can be resized together by dragging the shared boundary
- Guide lines appear during drag when within snap threshold and disappear on drag end
- Dragging the top-most panel of a set moves all set members; dragging a non-top panel breaks it out
- Closing a panel in a set recomputes sets correctly (remaining panels form correct groups)
- MIN_SIZE_PX (100px) enforced on both panels during shared-edge resize

#### Scope {#scope}

1. Pure-function snap geometry module (`snap.ts`)
2. Snap-during-move integration into FloatingPanel header drag
3. Snap-during-resize integration into FloatingPanel edge/corner resize
4. Shared-edge detection algorithm
5. Shared-edge resize via virtual sash elements
6. Guide line rendering during move and resize drags
7. Set computation and storage in PanelManager
8. Set dragging (top-most moves set, others break out)
9. Set recomputation on panel close

#### Non-goals (Explicitly out of scope) {#non-goals}

- Persisting sets to localStorage (sets are runtime-only per roadmap)
- Multi-directional set chains (e.g., three panels forming an L-shape treated as one set)
- Snap to canvas edges or grid lines
- Tab drag between panels

#### Dependencies / Prerequisites {#dependencies}

- Change A canvas panel system fully implemented (done)
- `tugdeck/src/panel-manager.ts` with CanvasState, PanelManager, FloatingPanel callbacks
- `tugdeck/src/floating-panel.ts` with move and resize pointer event handling
- `tugdeck/src/layout-tree.ts` with PanelState/CanvasState types

#### Constraints {#constraints}

- Must not break existing panel move, resize, focus, close, or serialization behavior
- Snap computation must be fast enough for 60fps pointer event handling (panels count is small, typically < 10)
- Guide lines and virtual sashes must not interfere with panel z-ordering or pointer event dispatch
- MIN_SIZE_PX = 100 applies to both panels during shared-edge resize

#### Assumptions {#assumptions}

- Snap threshold is 8px as specified in the roadmap
- Sets are runtime-only and never persisted to localStorage
- Set recomputation happens after every move-end, resize-end, and panel close
- The isDragging flag on PanelManager is set to true during set-move drags as well as individual drags
- FloatingPanel will get onMoving and onResizing live callbacks to communicate drag positions to PanelManager
- Any overlap (even 1px) counts for shared-edge adjacency; the proximity threshold (8px gap tolerance) applies for edge detection

---

### 2.0.0 Design Decisions {#design-decisions}

#### [D01] Pure-function snap module (DECIDED) {#d01-snap-module}

**Decision:** All snap geometry, edge detection, and set membership logic lives in a new `tugdeck/src/snap.ts` module as pure functions with no DOM or state dependencies.

**Rationale:**
- Pure functions are trivially unit-testable without JSDOM
- PanelManager consumes the module; FloatingPanel does not import it directly
- Separation of geometry concerns from DOM concerns

**Implications:**
- `snap.ts` exports functions that take panel rectangles and return snap results
- PanelManager is responsible for calling snap functions and applying results to FloatingPanel positions

#### [D02] Live callbacks for move and resize (DECIDED) {#d02-live-callbacks}

**Decision:** FloatingPanel gains two new optional callbacks: `onMoving(x, y)` called on every pointermove during header drag, and `onResizing(x, y, w, h)` called on every pointermove during edge/corner resize. PanelManager uses these to compute snap positions and update guide lines in real time.

**Rationale:**
- The existing `onMoveEnd`/`onResizeEnd` callbacks only fire on pointerup, too late for live snap feedback
- Live callbacks let PanelManager intercept and override positions before FloatingPanel applies them to the DOM

**Implications:**
- FloatingPanelCallbacks interface gains `onMoving?` and `onResizing?` optional members
- FloatingPanel's move and resize handlers call these callbacks and use the returned (potentially snapped) position
- Existing `onMoveEnd`/`onResizeEnd` continue to fire on pointerup for state persistence

#### [D03] Guide lines as absolutely-positioned divs (DECIDED) {#d03-guide-lines}

**Decision:** Guide lines are absolutely-positioned `<div>` elements appended to the canvas container, shown/hidden during drag operations. They are managed by PanelManager, not by FloatingPanel.

**Rationale:**
- Simple DOM approach; no canvas/SVG overhead
- Absolutely-positioned divs within the canvas container naturally align with panel coordinates
- PanelManager owns the canvas container and knows all panel positions

**Implications:**
- Guide line divs are created once and reused (pool of ~4 elements: top, bottom, left, right)
- CSS class `.snap-guide-line` with dashed border, styled consistently with panels.css tokens
- Guide lines are shown when a snap target is detected, hidden on drag end

#### [D04] Virtual sash for shared-edge resize (DECIDED) {#d04-virtual-sash}

**Decision:** A virtual sash element is injected at each shared boundary between two panels. The sash is a thin absolutely-positioned div with its own pointer events that, when dragged, resizes both adjacent panels simultaneously.

**Rationale:**
- Decouples shared-edge resize from individual panel resize handles
- Sash element provides a clear interaction target with a col-resize or row-resize cursor
- Matches the user's mental model of dragging a boundary between two regions

**Implications:**
- PanelManager creates/destroys sash elements when sets are recomputed
- Sash pointerdown starts a dual-panel resize: one panel grows, the other shrinks
- MIN_SIZE_PX enforced on both panels during the resize
- Sash z-index must be above the panels it separates

#### [D05] Set membership is runtime-only (DECIDED) {#d05-sets-runtime}

**Decision:** Sets (groups of panels with shared edges) are computed at runtime from panel positions and never persisted. They are recomputed after every move-end, resize-end, and panel close.

**Rationale:**
- The roadmap explicitly states sets are runtime-only
- Deriving sets from positions is deterministic and fast for small panel counts
- No serialization format changes needed

**Implications:**
- PanelManager stores a `sets` data structure (array of panel ID arrays) as a private field
- `recomputeSets()` is called after move-end, resize-end, and panel close
- Sash elements are recreated whenever sets change

#### [D06] Set drag behavior: top-most moves set, others break out (DECIDED) {#d06-set-drag}

**Decision:** When a panel belongs to a set, dragging the top-most panel (highest z-index, i.e., last in the panels array) moves the entire set as a unit. Dragging any other panel in the set breaks it out of the set and moves it independently.

**Rationale:**
- Matches the roadmap specification exactly
- Top-most = focused panel, which is intuitive (click to focus, then drag to move group)
- Breaking out on drag of non-top panel allows easy set dissolution

**Implications:**
- PanelManager's onMoving callback checks if the dragged panel is the top-most in its set
- If top-most: translate all set members by the same delta
- If not top-most: move only the dragged panel; recompute sets after move-end
- isDragging flag set to true during both set-move and individual-move

#### [D07] Shared-edge detection algorithm (DECIDED) {#d07-edge-detection}

**Decision:** Two panels share an edge when: (a) one panel's right edge equals another's left edge (or top equals bottom) within a proximity tolerance (8px gap), and (b) there is at least 1px of perpendicular overlap between the panels.

**Rationale:**
- The user answered that any overlap (even 1px) counts; only the 8px proximity threshold matters for edge adjacency
- This allows panels that are slightly offset vertically (or horizontally) to still form shared edges
- The 8px gap tolerance means panels do not need to be pixel-perfect to be considered adjacent

**Implications:**
- `findSharedEdges()` function in snap.ts returns pairs of (panelA, panelB, edge direction, overlap range)
- Sets are built by grouping panels that share edges (connected components)
- Gap tolerance of 8px means panels within 0-8px of each other on the relevant axis are considered adjacent

---

### 2.0.1 Specification {#specification}

#### 2.0.1.1 Terminology {#terminology}

- **Snap**: Adjusting a panel's position during move or resize to align its edge with another panel's edge when within the snap threshold
- **Snap threshold**: 8px distance at which snap detection activates
- **Shared edge**: A boundary between two panels where one panel's edge is within 8px of another panel's opposing edge, with at least 1px perpendicular overlap
- **Set**: A group of panels connected by shared edges (a connected component in the adjacency graph)
- **Virtual sash**: A thin interactive element positioned at a shared edge that enables dual-panel resize
- **Guide line**: A visual indicator (dashed line) shown during drag at potential snap positions
- **Top-most panel**: The panel with the highest z-index in a set (last in the panels array)
- **Break out**: Removing a panel from its set by dragging it independently

#### 2.0.1.2 Snap Behavior {#snap-behavior}

**Spec S01: Snap-during-move** {#s01-snap-move}

When a panel is being moved (header drag):
1. For each other panel, compute distance from each edge of the moving panel to each parallel edge of the other panel
2. If any distance is within 8px, snap the moving panel's position so that edge aligns exactly
3. Snap is applied to x and y independently (can snap horizontally and vertically simultaneously)
4. Co-linear alignment: also check if top-of-moving aligns with top-of-other (or bottom-to-bottom, etc.)
5. The snapped position is what gets applied to the DOM and reported to onMoveEnd

**Spec S02: Snap-during-resize** {#s02-snap-resize}

When a panel is being resized (edge/corner drag):
1. For the edges being resized, compute distance to parallel edges of other panels
2. If within 8px, snap the resizing edge to align
3. Snap only applies to the edges being actively dragged (e.g., resizing east edge only snaps the right edge)
4. MIN_SIZE_PX still enforced even when snapping

#### 2.0.1.3 Shared-Edge Detection {#shared-edge-detection}

**Spec S03: Edge adjacency algorithm** {#s03-edge-adjacency}

Given two panels A and B:
- **Vertical shared edge (A.right ~ B.left):** `|A.right - B.left| <= 8` AND `max(A.top, B.top) < min(A.bottom, B.bottom)` (at least 1px vertical overlap)
- **Horizontal shared edge (A.bottom ~ B.top):** `|A.bottom - B.top| <= 8` AND `max(A.left, B.left) < min(A.right, B.right)` (at least 1px horizontal overlap)

A shared edge record contains: panelA id, panelB id, axis (vertical or horizontal), and the overlap range.

#### 2.0.1.4 Set Computation {#set-computation}

**Spec S04: Set computation algorithm** {#s04-sets}

1. Compute all shared edges between all panel pairs
2. Build an adjacency graph: each panel is a node, each shared edge is an undirected edge
3. Find connected components using union-find or BFS
4. Each connected component is a set (array of panel IDs)
5. Singleton panels (no shared edges) are not part of any set

#### 2.0.1.5 Virtual Sash Behavior {#virtual-sash-behavior}

**Spec S05: Virtual sash interaction** {#s05-virtual-sash}

- Sash element is positioned at the shared boundary between two panels
- For a vertical shared edge: sash is a thin vertical strip (e.g., 8px wide) centered on the boundary, spanning the overlap range
- Cursor: `col-resize` for vertical shared edges, `row-resize` for horizontal
- On pointerdown: enter shared-edge resize mode
  - Track pointer delta along the resize axis
  - Grow panelA by delta, shrink panelB by delta (or vice versa depending on direction)
  - Enforce MIN_SIZE_PX on both panels: clamp delta so neither panel goes below 100px
  - Update both panels' positions and sizes in real time
- On pointerup: commit final positions/sizes to PanelState, recompute sets, recreate sashes, save layout
- Sash z-index: above both adjacent panels

#### 2.0.1.6 Guide Line Behavior {#guide-line-behavior}

**Spec S06: Guide lines** {#s06-guide-lines}

- During move or resize, when a snap target is detected, show a guide line at the snap position
- Vertical guide line: full canvas height, 1px wide, dashed style
- Horizontal guide line: full canvas width, 1px tall, dashed style
- Multiple guide lines can appear simultaneously (one per active snap axis)
- Guide lines are hidden immediately when the snap condition no longer holds or when drag ends

#### 2.0.1.7 Set Dragging {#set-dragging}

**Spec S07: Set drag rules** {#s07-set-drag}

- When a panel belongs to a set and the user starts a header drag:
  - If the panel is the top-most (highest z-index) in its set: translate all set members by the same (dx, dy)
  - If the panel is not top-most: move only this panel; it leaves the set
- After a set-move drag ends: recompute sets (panels may have moved near new neighbors)
- After a break-out drag ends: recompute sets (remaining panels may split into sub-sets)
- Snap applies during set-move drag (the set as a whole can snap to non-set panels)

---

### 2.0.2 Symbol Inventory {#symbol-inventory}

#### 2.0.2.1 New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/snap.ts` | Pure-function snap geometry, edge detection, and set computation |

#### 2.0.2.2 Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `Rect` | interface | `snap.ts` | `{ x, y, width, height }` panel bounding box |
| `SnapAxis` | type | `snap.ts` | `"x" \| "y"` |
| `SnapResult` | interface | `snap.ts` | `{ x: number \| null, y: number \| null, guides: GuidePosition[] }` |
| `GuidePosition` | interface | `snap.ts` | `{ axis: SnapAxis, position: number }` |
| `SharedEdge` | interface | `snap.ts` | `{ panelAId: string, panelBId: string, axis: "vertical" \| "horizontal", overlapStart: number, overlapEnd: number, boundaryPosition: number }` |
| `PanelSet` | interface | `snap.ts` | `{ panelIds: string[] }` |
| `computeSnap` | function | `snap.ts` | Compute snap for a moving panel against other panels |
| `computeResizeSnap` | function | `snap.ts` | Compute snap for a resizing panel edge |
| `findSharedEdges` | function | `snap.ts` | Find all shared edges between panels |
| `computeSets` | function | `snap.ts` | Compute connected components from shared edges |
| `panelToRect` | function | `snap.ts` | Convert PanelState to Rect |
| `SNAP_THRESHOLD_PX` | const | `snap.ts` | `8` |
| `onMoving?` | callback | `floating-panel.ts` | Optional live move callback on FloatingPanelCallbacks |
| `onResizing?` | callback | `floating-panel.ts` | Optional live resize callback on FloatingPanelCallbacks |
| `sets` | field | `panel-manager.ts` | Private `PanelSet[]` on PanelManager |
| `sashElements` | field | `panel-manager.ts` | Private `HTMLElement[]` for virtual sash DOM |
| `guideElements` | field | `panel-manager.ts` | Private `HTMLElement[]` for guide line DOM |
| `recomputeSets()` | method | `panel-manager.ts` | Recompute sets and recreate sashes |
| `showGuides()` | method | `panel-manager.ts` | Show/update guide lines during drag |
| `hideGuides()` | method | `panel-manager.ts` | Hide all guide lines |
| `createSashes()` | method | `panel-manager.ts` | Create virtual sash elements for current shared edges |
| `destroySashes()` | method | `panel-manager.ts` | Remove virtual sash elements |
| `.snap-guide-line` | CSS class | `panels.css` | Guide line styling (dashed, positioned) |
| `.snap-guide-line-x` | CSS class | `panels.css` | Vertical guide line |
| `.snap-guide-line-y` | CSS class | `panels.css` | Horizontal guide line |
| `.virtual-sash` | CSS class | `panels.css` | Shared-edge sash styling |
| `.virtual-sash-vertical` | CSS class | `panels.css` | Vertical sash (col-resize) |
| `.virtual-sash-horizontal` | CSS class | `panels.css` | Horizontal sash (row-resize) |

---

### 2.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test pure snap/edge/set functions in isolation | `snap.ts` geometry functions |
| **Integration** | Test PanelManager wiring of snap, sets, sashes, guide lines | Full PanelManager with mock DOM |
| **Manual** | Verify visual behavior in the browser | Guide lines, sash cursors, set drag feel |

---

### 2.0.4 Execution Steps {#execution-steps}

#### Step 0: Snap geometry module with pure functions {#step-0}

**Commit:** `feat(tugdeck): add snap.ts with pure snap and edge detection functions`

**References:** [D01] Pure-function snap module, [D07] Shared-edge detection algorithm, Spec S01, Spec S02, Spec S03, Spec S04, (#snap-behavior, #shared-edge-detection, #set-computation, #terminology)

**Artifacts:**
- New file `tugdeck/src/snap.ts`
- Exports: `Rect`, `SnapResult`, `GuidePosition`, `SharedEdge`, `PanelSet`, `SNAP_THRESHOLD_PX`, `computeSnap`, `computeResizeSnap`, `findSharedEdges`, `computeSets`, `panelToRect`

**Tasks:**
- [ ] Create `tugdeck/src/snap.ts` with the `Rect` interface (`{ x, y, width, height }`)
- [ ] Implement `SNAP_THRESHOLD_PX = 8`
- [ ] Implement `panelToRect(panel: PanelState): Rect` to convert PanelState to Rect
- [ ] Implement `computeSnap(moving: Rect, others: Rect[]): SnapResult` — for each edge of the moving rect, find closest parallel edge of any other rect within threshold; return snapped x/y and guide positions
- [ ] Implement `computeResizeSnap(resizingEdges: { top?: number, bottom?: number, left?: number, right?: number }, others: Rect[]): { top?: number, bottom?: number, left?: number, right?: number, guides: GuidePosition[] }` — snap only the edges being resized
- [ ] Implement `findSharedEdges(panels: { id: string, rect: Rect }[]): SharedEdge[]` — pairwise check for edge adjacency per Spec S03
- [ ] Implement `computeSets(panelIds: string[], sharedEdges: SharedEdge[]): PanelSet[]` — connected components via union-find

**Tests:**
- [ ] Unit test: `computeSnap` with two panels, moving panel within 8px of stationary panel right edge snaps to it
- [ ] Unit test: `computeSnap` with moving panel beyond 8px does not snap
- [ ] Unit test: `computeSnap` snaps x and y independently when both are within threshold
- [ ] Unit test: `computeResizeSnap` snaps right edge to another panel's left edge
- [ ] Unit test: `findSharedEdges` detects vertical shared edge (A.right == B.left with overlap)
- [ ] Unit test: `findSharedEdges` detects horizontal shared edge (A.bottom == B.top with overlap)
- [ ] Unit test: `findSharedEdges` returns empty for panels with no overlap even if edges align
- [ ] Unit test: `findSharedEdges` detects edges within 8px gap tolerance
- [ ] Unit test: `computeSets` groups two panels sharing an edge into one set
- [ ] Unit test: `computeSets` returns separate sets for disconnected groups
- [ ] Unit test: `computeSets` returns empty array for panels with no shared edges

**Checkpoint:**
- [ ] `bun test` passes for all snap.ts unit tests
- [ ] `bun build tugdeck/src/snap.ts` compiles without errors

**Rollback:**
- Delete `tugdeck/src/snap.ts` and associated test file

**Commit after all checkpoints pass.**

---

#### Step 1: Live callbacks on FloatingPanel {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugdeck): add onMoving/onResizing live callbacks to FloatingPanel`

**References:** [D02] Live callbacks for move and resize, (#specification, #snap-behavior, #symbols)

**Artifacts:**
- Modified `tugdeck/src/floating-panel.ts` with `onMoving?` and `onResizing?` on FloatingPanelCallbacks
- Move handler calls `onMoving` on every pointermove and uses returned position
- Resize handler calls `onResizing` on every pointermove and uses returned geometry

**Tasks:**
- [ ] Add `onMoving?: (x: number, y: number) => { x: number, y: number }` to `FloatingPanelCallbacks`
- [ ] Add `onResizing?: (x: number, y: number, width: number, height: number) => { x: number, y: number, width: number, height: number }` to `FloatingPanelCallbacks`
- [ ] In `handleHeaderDrag`, after computing newX/newY, call `onMoving` if provided and use the returned position for `updatePosition`
- [ ] In `attachResizeDrag`, after computing newX/newY/newW/newH, call `onResizing` if provided and use the returned geometry for `updatePosition`/`updateSize`

**Tests:**
- [ ] Unit test: FloatingPanel calls `onMoving` on every pointermove during header drag
- [ ] Unit test: FloatingPanel uses returned position from `onMoving` (snap override)
- [ ] Unit test: FloatingPanel calls `onResizing` on every pointermove during resize drag
- [ ] Unit test: Existing `onMoveEnd`/`onResizeEnd` still fire on pointerup with correct values

**Checkpoint:**
- [ ] `bun build tugdeck/src/floating-panel.ts` compiles without errors
- [ ] Existing panel move and resize behavior unchanged when callbacks are not provided

**Rollback:**
- Revert changes to `floating-panel.ts`

**Commit after all checkpoints pass.**

---

#### Step 2: Snap-during-move and snap-during-resize wiring {#step-2}

**Depends on:** #step-0, #step-1

**Commit:** `feat(tugdeck): wire snap computation into PanelManager move and resize`

**References:** [D01] Pure-function snap module, [D02] Live callbacks for move and resize, Spec S01, Spec S02, (#snap-behavior, #d01-snap-module, #d02-live-callbacks)

**Artifacts:**
- Modified `tugdeck/src/panel-manager.ts` to import snap functions and provide `onMoving`/`onResizing` callbacks that apply snap

**Tasks:**
- [ ] Import `computeSnap`, `computeResizeSnap`, `panelToRect` from `snap.ts` in `panel-manager.ts`
- [ ] In the FloatingPanel constructor call inside `render()`, provide `onMoving` callback that: collects Rects for all other panels, calls `computeSnap`, returns snapped position
- [ ] In the FloatingPanel constructor call inside `render()`, provide `onResizing` callback that: determines which edges are active, calls `computeResizeSnap`, returns snapped geometry
- [ ] Set `this._isDragging = true` at the start of move/resize and `false` at the end (if not already)

**Tests:**
- [ ] Integration test: moving a panel near another panel's edge results in snapped final position
- [ ] Integration test: resizing a panel's right edge near another panel's left edge snaps to alignment
- [ ] Integration test: panels far apart do not snap

**Checkpoint:**
- [ ] `bun build` compiles without errors
- [ ] Manual verification: dragging a panel near another causes position snap

**Rollback:**
- Revert snap-related changes in `panel-manager.ts`

**Commit after all checkpoints pass.**

---

#### Step 3: Guide lines during drag {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): add guide lines during move and resize drags`

**References:** [D03] Guide lines as absolutely-positioned divs, Spec S06, (#guide-line-behavior, #terminology)

**Artifacts:**
- Modified `tugdeck/src/panel-manager.ts` with guide line DOM management (guideElements, showGuides, hideGuides)
- Modified `tugdeck/styles/panels.css` with `.snap-guide-line`, `.snap-guide-line-x`, `.snap-guide-line-y` styles

**Tasks:**
- [ ] Add `.snap-guide-line` base CSS: `position: absolute; pointer-events: none; z-index: 9990;`
- [ ] Add `.snap-guide-line-x` CSS: vertical dashed line (`border-left: 1px dashed var(--accent); height: 100%;`)
- [ ] Add `.snap-guide-line-y` CSS: horizontal dashed line (`border-top: 1px dashed var(--accent); width: 100%;`)
- [ ] In PanelManager, create a pool of guide line divs (2 vertical, 2 horizontal) appended to the canvas container, initially hidden
- [ ] Implement `showGuides(guides: GuidePosition[])`: position and show the appropriate guide line divs
- [ ] Implement `hideGuides()`: hide all guide line divs
- [ ] In `onMoving` callback, after computing snap, call `showGuides` with the snap result's guides
- [ ] In `onResizing` callback, after computing snap, call `showGuides` with the snap result's guides
- [ ] On move-end and resize-end, call `hideGuides()`

**Tests:**
- [ ] Unit test: `showGuides` makes guide line elements visible at correct positions
- [ ] Unit test: `hideGuides` hides all guide line elements
- [ ] Integration test: moving a panel near a snap target shows guide lines; releasing hides them

**Checkpoint:**
- [ ] `bun build` compiles without errors
- [ ] Manual verification: dashed guide lines appear when dragging near snap targets

**Rollback:**
- Remove guide line CSS and revert PanelManager guide line code

**Commit after all checkpoints pass.**

---

#### Step 4: Shared-edge detection and set computation {#step-4}

**Depends on:** #step-0

**Commit:** `feat(tugdeck): add set computation and storage to PanelManager`

**References:** [D05] Set membership is runtime-only, [D07] Shared-edge detection algorithm, Spec S03, Spec S04, (#shared-edge-detection, #set-computation, #symbols)

**Artifacts:**
- Modified `tugdeck/src/panel-manager.ts` with `sets` field, `recomputeSets()` method
- `recomputeSets()` called after move-end, resize-end, and panel close

**Tasks:**
- [ ] Add private `sets: PanelSet[] = []` field to PanelManager
- [ ] Import `findSharedEdges`, `computeSets`, `panelToRect`, `PanelSet` from `snap.ts`
- [ ] Implement `recomputeSets()`: convert all panels to `{id, rect}`, call `findSharedEdges`, call `computeSets`, store result in `this.sets`
- [ ] Call `recomputeSets()` after `onMoveEnd` callback in render
- [ ] Call `recomputeSets()` after `onResizeEnd` callback in render
- [ ] Call `recomputeSets()` after `removeCard` (panel close)
- [ ] Expose `getSets()` for testing

**Tests:**
- [ ] Integration test: two panels placed edge-to-edge are in the same set after move-end
- [ ] Integration test: moving a panel away from the group removes it from the set
- [ ] Integration test: closing a panel recomputes sets correctly

**Checkpoint:**
- [ ] `bun build` compiles without errors
- [ ] Unit tests for set computation pass

**Rollback:**
- Remove sets field and recomputeSets from PanelManager

**Commit after all checkpoints pass.**

---

#### Step 5: Virtual sash elements for shared-edge resize {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugdeck): add virtual sash elements for shared-edge resize`

**References:** [D04] Virtual sash for shared-edge resize, Spec S05, (#virtual-sash-behavior, #terminology, #symbols)

**Artifacts:**
- Modified `tugdeck/src/panel-manager.ts` with `sashElements`, `createSashes()`, `destroySashes()`, and sash pointer event handling
- Modified `tugdeck/styles/panels.css` with `.virtual-sash`, `.virtual-sash-vertical`, `.virtual-sash-horizontal` styles

**Tasks:**
- [ ] Add `.virtual-sash` CSS: `position: absolute; z-index: 9950; background: transparent;`
- [ ] Add `.virtual-sash-vertical` CSS: `width: 8px; cursor: col-resize;` with hover highlight
- [ ] Add `.virtual-sash-horizontal` CSS: `height: 8px; cursor: row-resize;` with hover highlight
- [ ] Add private `sashElements: HTMLElement[] = []` to PanelManager
- [ ] Implement `destroySashes()`: remove all sash elements from DOM and clear array
- [ ] Implement `createSashes()`: for each shared edge from `findSharedEdges`, create a div positioned at the boundary, spanning the overlap range; attach pointer event handlers
- [ ] In sash pointerdown handler: set `_isDragging = true`, capture pointer, track delta; on pointermove: compute new sizes for both panels (grow one, shrink other), clamp both to MIN_SIZE_PX, update both FloatingPanels' positions and sizes
- [ ] On sash pointerup: set `_isDragging = false`, release pointer, commit final positions to PanelState, call `recomputeSets()`, call `createSashes()`, `scheduleSave()`
- [ ] Call `destroySashes()` then `createSashes()` at the end of `recomputeSets()`
- [ ] Import `SharedEdge` type from snap.ts; store shared edges alongside sets for sash creation

**Tests:**
- [ ] Integration test: two edge-adjacent panels produce a virtual sash element in the DOM
- [ ] Integration test: dragging the sash resizes both panels (one grows, other shrinks)
- [ ] Integration test: dragging the sash does not let either panel go below MIN_SIZE_PX
- [ ] Integration test: after sash drag, sets are recomputed and sash is recreated at new position

**Checkpoint:**
- [ ] `bun build` compiles without errors
- [ ] Manual verification: shared boundary shows col-resize cursor; dragging resizes both panels

**Rollback:**
- Remove sash-related code from PanelManager and CSS

**Commit after all checkpoints pass.**

---

#### Step 6: Set dragging {#step-6}

**Depends on:** #step-4, #step-2

**Commit:** `feat(tugdeck): implement set dragging and break-out behavior`

**References:** [D06] Set drag behavior, Spec S07, (#set-dragging, #terminology, #symbols)

**Artifacts:**
- Modified `tugdeck/src/panel-manager.ts` with set-aware move logic in `onMoving` callback
- Modified `tugdeck/src/floating-panel.ts` with support for external position updates during set-move

**Tasks:**
- [ ] In PanelManager's `onMoving` callback, determine if the moving panel is in a set
- [ ] If in a set and is the top-most panel (last in panels array among set members): compute delta from panel's original position; apply same delta to all other set members' FloatingPanel instances via `updatePosition`
- [ ] If in a set but not top-most: move only this panel (break-out); snap applies to this panel alone
- [ ] During set-move, apply snap computation using the set's bounding box against non-set panels
- [ ] On move-end after set-move: update all moved panels' PanelState positions, call `recomputeSets()`, `scheduleSave()`
- [ ] On move-end after break-out: update only the moved panel's PanelState, call `recomputeSets()`, `scheduleSave()`
- [ ] Set `_isDragging = true` during set-move for all affected panels

**Tests:**
- [ ] Integration test: dragging the top-most panel of a set moves all set members by the same delta
- [ ] Integration test: dragging a non-top panel of a set moves only that panel
- [ ] Integration test: after set-move, sets are recomputed
- [ ] Integration test: after break-out, remaining panels form correct sets
- [ ] Integration test: snap applies during set-move against non-set panels

**Checkpoint:**
- [ ] `bun build` compiles without errors
- [ ] Manual verification: dragging focused panel in a group moves the group; dragging non-focused panel pulls it free

**Rollback:**
- Revert set-drag logic in PanelManager onMoving callback

**Commit after all checkpoints pass.**

---

#### Step 7: Set recomputation on close and final polish {#step-7}

**Depends on:** #step-5, #step-6

**Commit:** `feat(tugdeck): set recomputation on close, guide line polish, and cleanup`

**References:** [D05] Set membership is runtime-only, Spec S04, Spec S06, Spec S07, (#set-computation, #guide-line-behavior, #set-dragging)

**Artifacts:**
- Modified `tugdeck/src/panel-manager.ts` with verified close-recompute path, guide line cleanup, and edge case handling
- Any final CSS tweaks to guide line and sash styling

**Tasks:**
- [ ] Verify that `removeCard` -> panel removal -> `recomputeSets()` correctly splits sets when a connecting panel is removed
- [ ] Ensure sashes are destroyed and recreated after panel close
- [ ] Ensure guide lines are hidden if a drag is cancelled (pointercancel)
- [ ] Verify that `isDragging` is correctly set/unset during all drag types (individual move, set move, individual resize, shared-edge resize)
- [ ] Add destroy cleanup: `destroySashes()` and guide line removal in PanelManager.destroy()
- [ ] Verify resetLayout clears sets and sashes

**Tests:**
- [ ] Integration test: closing a panel that connects two sub-groups splits the set into two
- [ ] Integration test: closing the last panel in a set dissolves the set
- [ ] Integration test: after resetLayout, sets and sashes are empty
- [ ] Integration test: guide lines are hidden after pointercancel during drag

**Checkpoint:**
- [ ] `bun build` compiles without errors
- [ ] Full test suite passes
- [ ] Manual end-to-end verification: snap, guide lines, shared-edge resize, set drag, break-out, close recompute all work together

**Rollback:**
- Revert this commit (isolated polish/cleanup changes)

**Commit after all checkpoints pass.**

---

### 2.0.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Complete snap, sets, and shared-edge resize behavior for the canvas panel system, matching the Change B specification in the roadmap.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `bun build` compiles without errors
- [ ] All unit tests for snap.ts pass
- [ ] All integration tests for PanelManager snap/set/sash wiring pass
- [ ] Snap-during-move works: dragging a panel within 8px of another panel's edge causes snap
- [ ] Snap-during-resize works: resizing a panel edge within 8px of another edge causes snap
- [ ] Guide lines appear during drag at snap positions and disappear on drag end
- [ ] Shared-edge resize works: dragging a virtual sash resizes both adjacent panels
- [ ] MIN_SIZE_PX enforced during shared-edge resize
- [ ] Set drag works: top-most panel drag moves set, other panel drag breaks out
- [ ] Set recomputation works after move-end, resize-end, and panel close
- [ ] Existing panel behavior (focus, close, serialization, tab management) unchanged

**Acceptance tests:**
- [ ] Unit tests: snap geometry functions produce correct results
- [ ] Integration tests: PanelManager correctly wires snap, sets, sashes, guide lines
- [ ] Manual tests: end-to-end visual verification of all behaviors

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Snap to canvas edges or grid
- [ ] Multi-panel set chains (L-shapes, T-shapes)
- [ ] Persist sets to localStorage if use cases emerge
- [ ] Tab drag between panels
- [ ] Animated snap transitions

| Checkpoint | Verification |
|------------|--------------|
| Snap geometry module | Unit tests pass, `bun build` clean |
| Live callbacks | FloatingPanel tests pass, existing behavior preserved |
| Snap wiring | Integration tests pass, manual snap verification |
| Guide lines | Visual verification, show/hide tests pass |
| Set computation | Unit and integration tests for edge detection and sets |
| Virtual sashes | Sash resize integration tests, MIN_SIZE_PX enforcement |
| Set dragging | Set-move and break-out integration tests |
| Full integration | All tests pass, manual end-to-end verification |

**Commit after all checkpoints pass.**
