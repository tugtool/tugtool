## Phase 1.0: Canvas Panel System (Change A) {#canvas-panel-system}

**Purpose:** Replace the tiling/docking layout system with a free-form canvas where all panels are absolutely-positioned floating panels, eliminating the split tree, sashes, dock targeting, and preset system.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugplan/canvas-panel-system |
| Tracking issue/PR | TBD |
| Last updated | 2025-02-18 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current tugdeck layout system is a tiling/docking tree (SplitNode/TabNode) with sash resizers, dock targeting, and tree normalization. This model violates the core sizing principle: closing a panel causes neighbors to expand, sash drags redistribute space across the whole tree, and tree normalization rearranges weights unpredictably. The user has no direct control over individual panel geometry.

The canvas model replaces all of this with a flat array of absolutely-positioned panels. Each panel owns its own position and size. Moving, closing, or opening a panel never affects any other panel. This is Change A from the canvas-panel-system roadmap, establishing the foundation that Change B (snap, sets, shared-edge resize) will build upon.

#### Strategy {#strategy}

- **Step 0: Types first.** Replace DockState/SplitNode/FloatingGroup with CanvasState/PanelState in layout-tree.ts. This is the foundation every other file depends on.
- **Step 1: Default layout and serialization.** Rewrite buildDefaultLayout() to return CanvasState with absolute positions. Implement v4 serialization (load/save). Discard any non-v4 data on load.
- **Step 2: Rendering overhaul.** Rewrite PanelManager.render() to iterate CanvasState.panels and create one FloatingPanel per entry. Simplify FloatingPanel to accept PanelState directly. Wire focus model (click-to-front, visual indicator). Adapt TabBar for same-type multi-tab support inside floating panels.
- **Step 3: Dead code removal.** Delete sash.ts, dock-target.ts, and all tree-related code (SplitNode, normalizeTree, insertNode, removeTab, renderSplit, renderNode, renderTabNode, enforceGeometricMinimums). Remove preset system entirely.
- **Step 4: Test and CSS.** Delete obsolete tests, write new tests for CanvasState, buildDefaultLayout, v4 serialization, and the canvas rendering path. Update CSS to remove split/sash/dock styles.

#### Stakeholders / Primary Customers {#stakeholders}

1. tugdeck end users (want predictable panel sizing and positioning)
2. tugdeck developers (want simpler layout model to extend in Change B)

#### Success Criteria (Measurable) {#success-criteria}

- All five default panels render as floating panels at computed positions with 12px gaps (`bun run build` succeeds, visual inspection confirms layout)
- Click-to-front focus model works (clicking a panel brings it to front with brighter border)
- Panel move and resize work independently (moving/closing one panel does not affect others)
- v4 serialization round-trips correctly (save to localStorage, reload, positions preserved)
- No references to SplitNode, sash, dock-target, normalizeTree, or preset code remain in the codebase
- `bun test` passes with new test suite covering CanvasState, buildDefaultLayout, and v4 serialization

#### Scope {#scope}

1. New CanvasState and PanelState types replacing DockState
2. New buildDefaultLayout() computing absolute panel positions from viewport
3. Simplified PanelManager.render() using only FloatingPanel instances
4. Focus model with z-ordering and visual indicator
5. v4 serialization format with discard-on-unknown-version fallback
6. TabBar adapted for same-type multi-tab support inside floating panels
7. Removal of split tree, sash, dock targeting, preset system, and V2 migration
8. Updated CSS removing split/sash/dock overlay styles, adding focus indicator
9. New test suite for canvas data model and serialization

#### Non-goals (Explicitly out of scope) {#non-goals}

- Snap, sets, or shared-edge resize (Change B)
- Guide lines during drag (Change B)
- Cross-type tab mixing (conversation + terminal in same panel)
- V3-to-V4 migration (clean slate; old data is discarded)

#### Dependencies / Prerequisites {#dependencies}

- Existing FloatingPanel class (will be adapted, not rewritten from scratch)
- Existing CardHeader class (kept as-is)
- Existing card registry and fan-out dispatch (D10) in PanelManager (kept as-is)

#### Constraints {#constraints}

- TypeScript with Bun bundler (no webpack/vite)
- No external layout library dependencies
- Must maintain card instance identity during re-render (D09)
- FloatingPanel minimum size 100px (L01.7)

#### Assumptions {#assumptions}

- The CanvasState/PanelState types will be added to layout-tree.ts, replacing existing types during cleanup
- buildDefaultLayout() in serialization.ts will return CanvasState with five panels positioned with 12px gaps, conversation panel roughly 2/3 width, four right panels stacked
- The visual focus indicator (brighter border/accent color) will be implemented via a CSS class toggled on the frontmost floating-panel element
- The main localStorage key `tugdeck-layout` is retained but now stores v4 CanvasState format; any non-v4 value triggers buildDefaultLayout()
- FloatingPanel constructor will accept PanelState directly rather than FloatingGroup
- TabBar is retained and adapted to work inside FloatingPanel for same-type multi-tab support
- Core principle: resizing is always user-controlled; panels never resize automatically; closing a panel leaves a gap; moving a panel does not affect neighbors

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions remain. All design decisions were resolved during the clarification phase.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Large refactor scope causes mid-step breakage | med | med | @ts-nocheck bridge in Step 0; each step compiles independently | Build fails after a step |
| TabBar index-to-id conversion introduces subtle tab selection bugs | med | med | Dedicated conversion task with call-site audit; unit tests for id-based activation | Tab switching misbehaves after Step 2 |
| Removing DockState breaks test files that are not rewritten until Step 4 | low | high | Test files are excluded from build; Step 4 rewrites all affected tests | `bun test` fails between Steps 2-3 |

**Risk R01: activeTabIndex-to-activeTabId Conversion Cascade** {#r01-index-to-id-cascade}

- **Risk:** PanelState uses `activeTabId` (string) while TabBar and all existing code uses `activeTabIndex` (number). Converting every call site is error-prone and could introduce off-by-one or stale-id bugs.
- **Mitigation:**
  - Step 2 includes an explicit task to audit all `activeTabIndex` call sites in TabBar and PanelManager
  - TabBar.update() and renderTabs() are rewritten to derive the active index from `activeTabId` via `tabs.findIndex()`
  - Unit tests verify tab activation by id, not by index
- **Residual risk:** If a tab is removed and the activeTabId becomes stale, findIndex returns -1. The deserializer must clamp to a valid tab.

**Risk R02: Public API Surface Change Breaks Downstream Tests** {#r02-api-surface-change}

- **Risk:** PanelManager methods `getDockState()`, `applyLayout()`, `getTabBar()`, `findTabNodeById()` are used extensively in tests (50+ call sites across 5 test files). Renaming or removing these without updating tests causes mass failures.
- **Mitigation:**
  - Step 2 explicitly renames/replaces all four methods
  - `getDockState()` becomes `getCanvasState()`
  - `applyLayout(DockState)` becomes `applyLayout(CanvasState)` (same name, new signature)
  - `getTabBar()` and `findTabNodeById()` are removed (no tree to query)
  - Step 4 rewrites all test files that reference these methods
- **Residual risk:** Tests between Steps 2 and 4 will fail. This is expected and documented.

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Flat array replaces tree (DECIDED) {#d01-flat-array}

**Decision:** Replace the DockState tree (SplitNode/TabNode with weights and normalization) with a flat `CanvasState { panels: PanelState[] }` where array position determines z-order (last = frontmost).

**Rationale:**
- Eliminates all tree mutation complexity (normalizeTree, insertNode, removeTab, weight redistribution)
- Z-order is implicit in array position, no separate z-index tracking needed in data model
- Direct mapping from data to rendering: one PanelState = one FloatingPanel DOM element

**Implications:**
- All tree-related code (SplitNode, normalizeTree, insertNode, removeTab) becomes dead code to be deleted
- No docked vs floating distinction; all panels are floating
- Panel addition is array push; panel removal is array splice; focus is move-to-end

#### [D02] No migration from V3 (DECIDED) {#d02-no-migration}

**Decision:** On startup, if localStorage contains a non-v4 layout, discard it entirely and build the default canvas layout. No V3-to-V4 migration.

**Rationale:**
- V3 tree structure has no meaningful mapping to absolute positions (weights are proportional, not pixel-based)
- Clean slate avoids migration bugs and edge cases
- Users get a well-designed default layout rather than a potentially broken translation

**Implications:**
- Users lose their saved layout on upgrade (acceptable for this foundational change)
- V2 migration code in serialization.ts is also deleted
- The `version: 4` field in serialized data is the sole discriminator

#### [D03] FloatingPanel accepts PanelState directly (DECIDED) {#d03-panel-accepts-panelstate}

**Decision:** Simplify FloatingPanel constructor to accept PanelState (id, position, size, tabs, activeTabId) instead of FloatingGroup. Remove onDragOut from FloatingPanelCallbacks entirely.

**Rationale:**
- FloatingGroup was the bridge between tree model and floating panels; with the tree gone, PanelState is the direct data source
- onDragOut was for re-dock targeting (drag a floating panel back into the tree); with no tree, there is nothing to re-dock into
- Simplified callback interface: onMoveEnd, onResizeEnd, onFocus, onClose

**Implications:**
- FloatingPanel constructor signature changes
- FloatingPanelCallbacks loses onDragOut
- handleHeaderDrag no longer needs "drag out to re-dock" detection; it just moves the panel freely

#### [D04] Remove preset system entirely (DECIDED) {#d04-remove-presets}

**Decision:** Delete savePreset, loadPreset, listPresets, deletePreset, PRESETS_STORAGE_KEY, and all PanelManager preset methods. Clean slate, no dead code.

**Rationale:**
- Presets stored V3 tree layouts which are incompatible with the canvas model
- Re-implementing presets for the canvas model can be done later if needed
- Removing now avoids carrying dead code through the refactor

**Implications:**
- TugMenu loses "Save Layout...", "Load: ..." menu items
- PanelManager loses savePreset(), loadPreset(), getPresetNames() methods
- PRESETS_STORAGE_KEY localStorage entries become orphaned (harmless)

#### [D05] TabBar adapted for same-type multi-tab in floating panels (DECIDED) {#d05-tabbar-in-floating}

**Decision:** Keep TabBar and adapt it to work inside FloatingPanel. Each panel can have multiple tabs, but only tabs of the same card type (e.g., multiple conversation tabs in one panel). "New Tab" is a card-level menu action (in the card's own dropdown menu), not a Tug menu action. The top-level Tug menu always creates a new standalone panel.

**Rationale:**
- TabBar already handles tab switching, reorder, and close -- reusing it inside FloatingPanel avoids reimplementation
- Same-type constraint keeps the mental model simple and avoids confusing mixed-content panels
- Card-level "New Tab" action (via card menu) is the natural place since the user is already interacting with that card type

**Implications:**
- FloatingPanel must render TabBar when panel has multiple tabs, CardHeader when single tab
- TabBar.onDragOut callback is removed (no dock targeting to drag into)
- PanelState.tabs array can have multiple entries (all same componentId)
- addNewTab(panelId, componentId) method added to PanelManager for card menus to call

#### [D07] TabNode is kept; IDragState and drag-state.ts are kept (DECIDED) {#d07-kept-symbols}

**Decision:** Keep `TabNode` interface in layout-tree.ts, keep `IDragState` interface and `drag-state.ts`. TabNode is no longer used as a layout tree node but is retained because TabBar depends on it for its constructor and update() method. IDragState is retained because ConversationCard and TerminalCard import it for drag-state coupling.

**Rationale:**
- TabBar's constructor takes `TabNode` and its `update()` method takes `TabNode`. Rewriting TabBar to accept a different shape would be unnecessary churn since TabNode's structure (id, tabs, activeTabIndex) maps directly to PanelState's tab data.
- In the canvas model, PanelManager constructs a TabNode from PanelState data to pass to TabBar. This is a thin adapter, not a leak of the old tree model.
- IDragState is a standalone interface with no tree dependencies. ConversationCard and TerminalCard use it to query drag state during pointer events; this coupling is independent of the layout model.

**Implications:**
- TabNode stays exported from layout-tree.ts alongside CanvasState, PanelState, and TabItem
- TabBar's internal interface is unchanged (still takes TabNode); only the onDragOut callback is removed
- PanelManager still `implements IDragState` and still exposes `isDragging`
- drag-state.ts is NOT deleted in Step 3

#### [D06] Focus model with CSS class (DECIDED) {#d06-focus-css}

**Decision:** The focused (frontmost) panel gets a `.floating-panel-focused` CSS class that applies a brighter border and slightly stronger shadow. All other panels use default styling.

**Rationale:**
- CSS-only approach is simple and performant
- Single class toggle on focus change, no per-panel style calculation needed
- Consistent with existing CSS variable system (can use `var(--accent)` for focused border)

**Implications:**
- PanelManager.render() must track which panel is focused and apply/remove the class
- New CSS rule `.floating-panel-focused { border-color: var(--accent); box-shadow: ... }`
- Focus state is runtime-only, not serialized

---

### 1.0.1 Specification {#specification}

#### 1.0.1.1 Data Model {#data-model}

**Spec S01: CanvasState and PanelState Types** {#s01-canvas-types}

```typescript
/** Canvas state: flat array of panels ordered by z-index (last = frontmost) */
export interface CanvasState {
  panels: PanelState[];
}

/** Individual panel state */
export interface PanelState {
  id: string;                          // crypto.randomUUID()
  position: { x: number; y: number };  // absolute pixel position
  size: { width: number; height: number }; // absolute pixel size
  tabs: TabItem[];                     // one or more tabs (same componentId)
  activeTabId: string;                 // id of the currently active tab
}
```

**Key invariants:**
- `panels` array order = z-order (index 0 is backmost, last index is frontmost)
- All tabs within a PanelState share the same `componentId`
- `activeTabId` must reference a tab in `tabs`
- `size.width >= 100` and `size.height >= 100` (L01.7 minimum)

#### 1.0.1.2 Serialization Format {#serialization-format}

**Spec S02: V4 Serialization** {#s02-v4-serialization}

```json
{
  "version": 4,
  "panels": [
    {
      "id": "uuid-string",
      "position": { "x": 12, "y": 12 },
      "size": { "width": 600, "height": 500 },
      "tabs": [
        { "id": "uuid-string", "componentId": "conversation", "title": "Conversation" }
      ],
      "activeTabId": "uuid-string"
    }
  ]
}
```

**Load behavior:**
- Parse JSON from localStorage key `tugdeck-layout`
- If `version !== 4`, discard and call `buildDefaultLayout()`
- If `version === 4`, deserialize panels, clamp positions to canvas bounds, enforce 100px minimums
- If parse fails (corrupt data), discard and call `buildDefaultLayout()`

**Save behavior:**
- Serialize CanvasState with `version: 4`
- Write to localStorage key `tugdeck-layout`
- Debounce saves (500ms, same as current)

#### 1.0.1.3 Default Layout {#default-layout}

**Spec S03: Default Layout Computation** {#s03-default-layout}

`buildDefaultLayout(canvasWidth: number, canvasHeight: number): CanvasState`

Computes absolute positions from viewport dimensions:

```
GAP = 12px
LEFT_FRACTION = 0.6    (conversation panel width fraction)

Conversation panel:
  x: GAP
  y: GAP
  width: (canvasWidth - 3*GAP) * LEFT_FRACTION
  height: canvasHeight - 2*GAP

Right column (4 panels stacked):
  x: GAP + conversationWidth + GAP
  rightWidth: canvasWidth - conversationX - GAP
  Each panel height: (canvasHeight - 2*GAP - 3*GAP) / 4
  Panel[i].y: GAP + i * (panelHeight + GAP)
```

The five panels in order (which is also z-order):
1. Conversation (leftmost, tallest)
2. Terminal (right column, top)
3. Git (right column, second)
4. Files (right column, third)
5. Stats (right column, bottom)

#### 1.0.1.4 Focus Model {#focus-model}

**Spec S04: Focus and Z-Order** {#s04-focus-model}

- **Click-to-front:** Clicking anywhere in a panel moves it to the end of `CanvasState.panels` (highest z-order) and applies `.floating-panel-focused` CSS class.
- **Visual indicator:** Focused panel gets brighter border (`var(--accent)`), stronger shadow. All others use default styling.
- **Z-index assignment:** During render, panels are assigned z-index values 100, 101, 102, ... in array order. The focused panel (last) gets the highest value.
- **Focus is runtime-only:** Not serialized. On load, the last panel in the array is considered focused.

---

### 1.0.2 Symbol Inventory {#symbol-inventory}

#### 1.0.2.1 New types {#new-types}

**Table T01: New Types** {#t01-new-types}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `CanvasState` | interface | `layout-tree.ts` | Replaces `DockState` |
| `PanelState` | interface | `layout-tree.ts` | Replaces `FloatingGroup` |

#### 1.0.2.2 Modified symbols {#modified-symbols}

**Table T02: Modified Symbols** {#t02-modified-symbols}

| Symbol | Kind | Location | Change |
|--------|------|----------|--------|
| `FloatingPanel` | class | `floating-panel.ts` | Constructor takes `PanelState` instead of `FloatingGroup`; `onDragOut` removed from callbacks |
| `FloatingPanelCallbacks` | interface | `floating-panel.ts` | Remove `onDragOut` |
| `PanelManager` | class | `panel-manager.ts` | Replace `dockState: DockState` with `canvasState: CanvasState`; rewrite render(); remove tree methods |
| `buildDefaultLayout` | function | `serialization.ts` | Returns `CanvasState` with absolute positions; takes `(canvasWidth, canvasHeight)` |
| `serialize` | function | `serialization.ts` | Serializes `CanvasState` to v4 format |
| `deserialize` | function | `serialization.ts` | Deserializes v4 format only; non-v4 discarded |
| `TugMenu` | class | `tug-menu.ts` | Remove preset menu items |
| `TabBar` | class | `tab-bar.ts` | Remove `onDragOut` from `TabBarCallbacks` |

#### 1.0.2.3 Kept symbols (explicitly NOT deleted) {#kept-symbols}

**Table T05: Kept Symbols** {#t05-kept-symbols}

| Symbol | Kind | Location | Reason |
|--------|------|----------|--------|
| `TabNode` | interface | `layout-tree.ts` | Used by TabBar constructor/update(); PanelManager constructs TabNode from PanelState to pass to TabBar ([D07]) |
| `TabItem` | interface | `layout-tree.ts` | Used by PanelState.tabs; unchanged |
| `IDragState` | interface | `drag-state.ts` | Used by ConversationCard, TerminalCard; PanelManager implements it ([D07]) |
| `CardHeader` | class | `card-header.ts` | Used by FloatingPanel for single-tab panels; unchanged |

#### 1.0.2.5 Deleted symbols {#deleted-symbols}

**Table T03: Deleted Symbols** {#t03-deleted-symbols}

| Symbol | Kind | Location | Reason |
|--------|------|----------|--------|
| `SplitNode` | interface | `layout-tree.ts` | Tree model removed |
| `DockState` | interface | `layout-tree.ts` | Replaced by CanvasState |
| `FloatingGroup` | interface | `layout-tree.ts` | Replaced by PanelState |
| `DockZone` | type | `layout-tree.ts` | Dock targeting removed |
| `Orientation` | type | `layout-tree.ts` | No split orientation needed |
| `LayoutNode` | type | `layout-tree.ts` | No tree union type needed |
| `normalizeTree` | function | `layout-tree.ts` | Tree normalization removed |
| `insertNode` | function | `layout-tree.ts` | Tree insertion removed |
| `removeTab` | function | `layout-tree.ts` | Tree tab removal replaced by array splice |
| `findTabNode` | function | `layout-tree.ts` | No tree to search |
| `createSash` | function | `sash.ts` | File deleted entirely |
| `computeDropZone` | function | `dock-target.ts` | File deleted entirely |
| `DockOverlay` | class | `dock-target.ts` | File deleted entirely |
| `isCursorInsideCanvas` | function | `dock-target.ts` | File deleted entirely |
| `savePreset` | function | `serialization.ts` | Preset system removed |
| `loadPreset` | function | `serialization.ts` | Preset system removed |
| `listPresets` | function | `serialization.ts` | Preset system removed |
| `deletePreset` | function | `serialization.ts` | Preset system removed |
| `PRESETS_STORAGE_KEY` | const | `serialization.ts` | Preset system removed |
| `migrateV2ToV3` | function | `serialization.ts` | V2 migration removed |
| `V2LayoutState` | interface | `serialization.ts` | V2 type removed |
| `SerializedDockState` | interface | `serialization.ts` | Replaced by v4 format |
| `validateDockState` | function | `serialization.ts` | Replaced by v4 validation |

#### 1.0.2.6 Deleted files {#deleted-files}

**Table T04: Deleted Files** {#t04-deleted-files}

| File | Reason |
|------|--------|
| `tugdeck/src/sash.ts` | No sash dividers in canvas model |
| `tugdeck/src/dock-target.ts` | No dock targeting in canvas model |
| `tugdeck/src/__tests__/dock-target.test.ts` | Tests for deleted code |

---

### 1.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test CanvasState manipulation (focus, add, remove, reorder) | Core data model |
| **Unit** | Test buildDefaultLayout() produces valid positions | Default layout |
| **Golden / Contract** | Test v4 serialization round-trip | Serialization |
| **Integration** | Test PanelManager render path creates correct DOM | Rendering |

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 0: New CanvasState/PanelState Types and Layout-Tree Cleanup {#step-0}

**Commit:** `feat(tugdeck): add CanvasState/PanelState types, remove tree types`

**References:** [D01] Flat array replaces tree, [D07] TabNode is kept, Spec S01, Table T01, Table T03, Table T05, (#data-model, #d01-flat-array, #d07-kept-symbols)

**Artifacts:**
- `tugdeck/src/layout-tree.ts` — new CanvasState/PanelState interfaces; TabItem and TabNode explicitly retained ([D07]: TabNode is used by TabBar constructor/update, TabItem is used by PanelState.tabs)
- Dead type exports removed: SplitNode, DockState, FloatingGroup, DockZone, Orientation, LayoutNode
- Dead function exports removed: normalizeTree, insertNode, removeTab, findTabNode

**Tasks:**
- [ ] Add `CanvasState` interface with `panels: PanelState[]`
- [ ] Add `PanelState` interface with id, position, size, tabs (TabItem[]), activeTabId
- [ ] Keep `TabItem` interface (unchanged, used by PanelState)
- [ ] Keep `TabNode` interface (unchanged, used by TabBar; PanelManager constructs TabNode from PanelState data to pass to TabBar — see [D07])
- [ ] Remove `SplitNode`, `DockState`, `FloatingGroup`, `DockZone`, `Orientation`, `LayoutNode` type exports
- [ ] Remove `normalizeTree`, `insertNode`, `removeTab`, `findTabNode` function exports and their private helpers (`insertIntoNode`, `removeTabFromNode`)
- [ ] Temporarily add `// @ts-nocheck` to files that import deleted symbols (panel-manager.ts, serialization.ts, floating-panel.ts, dock-target.ts, sash.ts, tab-bar.ts) so the build does not block this step; these files are rewritten in subsequent steps. Note: tab-bar.ts imports `type TabNode` from layout-tree.ts, which is kept but its co-exports (SplitNode, etc.) are removed, potentially causing import resolution issues.

**Tests:**
- [ ] Unit test: CanvasState with empty panels array is valid
- [ ] Unit test: PanelState with single tab constructs correctly
- [ ] Unit test: PanelState with multiple same-type tabs constructs correctly

**Checkpoint:**
- [ ] `bun run build` succeeds (with ts-nocheck on downstream files)
- [ ] New types are importable from layout-tree.ts

**Rollback:**
- Revert commit; restore original layout-tree.ts

**Commit after all checkpoints pass.**

---

#### Step 1: Serialization and Default Layout {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugdeck): v4 canvas serialization and default layout`

**References:** [D02] No migration from V3, [D04] Remove preset system entirely, Spec S02, Spec S03, (#serialization-format, #default-layout, #d02-no-migration, #d04-remove-presets)

**Artifacts:**
- `tugdeck/src/serialization.ts` — complete rewrite: v4 serialize/deserialize, new buildDefaultLayout(canvasWidth, canvasHeight), all V2/V3/preset code deleted

**Tasks:**
- [ ] Delete all V2/V3 serialization types and functions (SerializedDockState, SerializedNode, SerializedSplit, SerializedTabGroup, SerializedTab, SerializedFloatingGroup, V2LayoutState, serializeNode, serializeTabNode, serializeFloatingGroup, deserializeV3, deserializeNode, deserializeTabGroup, deserializeFloatingGroup, migrateV2ToV3, validateDockState)
- [ ] Delete preset functions and constant (savePreset, loadPreset, listPresets, deletePreset, PRESETS_STORAGE_KEY)
- [ ] Implement `serialize(canvasState: CanvasState): object` — produces `{ version: 4, panels: [...] }` per Spec S02
- [ ] Implement `deserialize(json: string, canvasWidth: number, canvasHeight: number): CanvasState` — parses v4, discards non-v4 with fallback to buildDefaultLayout; clamps positions to canvas bounds; enforces 100px minimums
- [ ] Implement `buildDefaultLayout(canvasWidth: number, canvasHeight: number): CanvasState` — computes five panels with 12px gaps per Spec S03
- [ ] Remove `// @ts-nocheck` from serialization.ts

**Tests:**
- [ ] Unit test: buildDefaultLayout(1200, 800) returns 5 panels with correct positions and 12px gaps
- [ ] Unit test: buildDefaultLayout panels have non-overlapping bounding boxes
- [ ] Unit test: serialize -> deserialize round-trip preserves all panel data
- [ ] Unit test: deserialize with version:3 data falls back to buildDefaultLayout
- [ ] Unit test: deserialize with corrupt JSON falls back to buildDefaultLayout
- [ ] Unit test: deserialize clamps panel positions to canvas bounds
- [ ] Unit test: deserialize enforces 100px minimum sizes

**Checkpoint:**
- [ ] `bun run build` succeeds (serialization.ts compiles cleanly)
- [ ] All serialization tests pass

**Rollback:**
- Revert commit; restore original serialization.ts

**Commit after all checkpoints pass.**

---

#### Step 2: PanelManager and FloatingPanel Canvas Rendering {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): canvas rendering with FloatingPanel-only layout`

**References:** [D01] Flat array replaces tree, [D03] FloatingPanel accepts PanelState, [D05] TabBar adapted for same-type multi-tab, [D06] Focus model with CSS class, [D07] TabNode is kept, Spec S01, Spec S04, Table T02, Table T05, Risk R01, (#data-model, #focus-model, #d03-panel-accepts-panelstate, #d05-tabbar-in-floating, #d06-focus-css, #d07-kept-symbols, #r01-index-to-id-cascade)

**Artifacts:**
- `tugdeck/src/floating-panel.ts` — constructor takes PanelState; onDragOut removed from callbacks; header drag moves panel freely (no re-dock detection)
- `tugdeck/src/tab-bar.ts` — onDragOut removed from TabBarCallbacks; kept for multi-tab rendering inside floating panels
- `tugdeck/src/panel-manager.ts` — complete rewrite of render path; replaces DockState with CanvasState; removes all tree rendering, sash, dock targeting, geometric enforcement, drag-and-drop lifecycle
- `tugdeck/src/tug-menu.ts` — remove preset menu items (Save Layout, Load: ...)
- `tugdeck/src/main.ts` — update PanelManager usage if constructor signature changes
- `tugdeck/styles/panels.css` — add `.floating-panel-focused` rule; remove split/sash CSS when dead code is deleted

**Tasks:**
- [ ] Rewrite `FloatingPanel` constructor to accept `PanelState` instead of `FloatingGroup`
- [ ] Remove `onDragOut` from `FloatingPanelCallbacks` interface
- [ ] Simplify `handleHeaderDrag` to always move the panel freely on canvas (remove re-dock detection, remove drag-out-of-bounds check)
- [ ] Remove `onDragOut` from `TabBarCallbacks` interface
- [ ] Update `TabBar` to not fire drag-out events (remove vertical-bounds check in `attachTabPointerEvents`)
- [ ] **activeTabIndex-to-activeTabId conversion cascade:** Audit and convert all call sites that use index-based active tab selection to id-based selection. Specific sites:
  - TabBar.renderTabs(): change `i === node.activeTabIndex` to derive active index from `activeTabId` via `tabs.findIndex(t => t.id === activeTabId)` (TabBar still receives a TabNode constructed from PanelState, so PanelManager sets `activeTabIndex` from `activeTabId` before passing to TabBar)
  - PanelManager.handleTabActivate(): receives tab index from TabBar callback, must convert to `activeTabId = panel.tabs[newIndex].id` and update PanelState
  - FloatingPanel header meta construction: change `tabs[activeTabIndex]` to `tabs.find(t => t.id === activeTabId)`
  - All render paths that read `activeTabIndex` to show/hide tab mounts must use `activeTabId` comparison instead
  - Serialization: `activeTabId` is serialized as a string (not an index); on deserialize, validate that `activeTabId` references an existing tab; if not, fall back to `tabs[0].id`
- [ ] Rewrite `PanelManager` to store `canvasState: CanvasState` instead of `dockState: DockState`
- [ ] Rewrite `PanelManager.render()` to iterate `canvasState.panels` and create one FloatingPanel per entry, assigning z-index in array order
- [ ] Implement focus model: clicking a panel moves its PanelState to end of panels array, removes `.floating-panel-focused` from all panels, adds it to the clicked panel
- [ ] Remove all tree-related methods from PanelManager: renderNode, renderSplit, renderTabNode, enforceGeometricMinimums, checkAndAdjustSplit, findSplitElement, findSplitElementInDom, getNodeWeights, applyLiveWeights, applySashWeights
- [ ] Remove all drag-and-drop dock targeting methods: handleDragOut, handleFloatingDragOut, undockToFloating, onDragMove, onDragUp, cancelDrag, executeDrop, cleanupDrag, collectTabNodeRects, createDragGhost, findTabItemById
- [ ] Remove DockOverlay instance and overlay property
- [ ] Remove preset methods: savePreset, loadPreset, getPresetNames, and loadPreset helper recreateCardsFromTree
- [ ] Update `addCard()` to search `canvasState.panels` instead of tree for matching componentId
- [ ] Update `removeCard()` to splice from `canvasState.panels` array instead of tree removal
- [ ] Update `addNewCard()` to push new PanelState to `canvasState.panels` array
- [ ] Add `addNewTab(panelId: string, componentId: string)` method for card-level "New Tab" action
- [ ] Update `resetLayout()` to use new buildDefaultLayout(canvasWidth, canvasHeight)
- [ ] Update `loadLayout()` and `saveLayout()` to use new serialize/deserialize
- [ ] **Public API method updates:** Rename/replace PanelManager methods affected by the DockState-to-CanvasState change:
  - Rename `getDockState()` to `getCanvasState(): CanvasState`
  - Rewrite `applyLayout(dockState: DockState)` to `applyLayout(canvasState: CanvasState)` — same method name, new parameter type; validates CanvasState (clamp positions, enforce 100px minimums), sets internal state, re-renders, and schedules save
  - Remove `getTabBar(tabNodeId)` — no tree TabNodes to query; TabBar instances are internal to FloatingPanel rendering
  - Remove `findTabNodeById(tabNodeId)` — no tree to search; callers should use `getCanvasState().panels` to find panels by id
- [ ] Update `TugMenu.buildMenuItems()` to remove "Save Layout...", "Load: ..." items, and "No saved presets"
- [ ] Remove imports of deleted modules (sash, dock-target, normalizeTree, insertNode, removeTab, etc.)
- [ ] Remove `// @ts-nocheck` from all files
- [ ] Add `.floating-panel-focused` CSS rule with accent border and stronger shadow
- [ ] Ensure TabBar renders inside FloatingPanel when panel has multiple tabs (via same rendering path)

**Tests:**
- [ ] Integration test: PanelManager with 5 panels creates 5 FloatingPanel DOM elements
- [ ] Unit test: clicking a panel moves it to end of panels array (focus)
- [ ] Unit test: addNewCard creates a new PanelState at canvas center
- [ ] Unit test: removeCard splices panel from array
- [ ] Unit test: addNewTab adds a tab to existing panel (same componentId only)

**Checkpoint:**
- [ ] `bun run build` succeeds with zero warnings
- [ ] All panels render as floating panels in the browser
- [ ] Click-to-front focus works visually
- [ ] Move and resize work independently per panel

**Rollback:**
- Revert commit; restore previous panel-manager.ts, floating-panel.ts, tab-bar.ts, tug-menu.ts

**Commit after all checkpoints pass.**

---

#### Step 3: Dead Code Removal and File Deletion {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(tugdeck): delete sash, dock-target, and remaining tree code`

**References:** [D01] Flat array replaces tree, [D04] Remove preset system entirely, [D07] TabNode is kept; IDragState kept, Table T03, Table T04, Table T05, (#d01-flat-array, #d04-remove-presets, #d07-kept-symbols, #deleted-files, #deleted-symbols)

**Artifacts:**
- Delete `tugdeck/src/sash.ts`
- Delete `tugdeck/src/dock-target.ts`
- Clean up any remaining imports or references to deleted code across all source files
- Remove split/sash/dock-overlay CSS rules from `tugdeck/styles/panels.css`

**Tasks:**
- [ ] Delete `tugdeck/src/sash.ts`
- [ ] Delete `tugdeck/src/dock-target.ts`
- [ ] Grep all `.ts` files for imports of `sash`, `dock-target`, `DockOverlay`, `computeDropZone`, `isCursorInsideCanvas`, `DockZone`, `SplitNode`, `normalizeTree`, `insertNode`, `DockState`, `FloatingGroup`, `removeTab`, `findTabNode`, `validateDockState` — remove any remaining references. Note: `TabNode`, `TabItem`, and `IDragState` are intentionally kept ([D07])
- [ ] Remove CSS rules: `.panel-split`, `.panel-split-horizontal`, `.panel-split-vertical`, `.panel-split-child`, `.panel-sash`, `.panel-sash-horizontal`, `.panel-sash-vertical`, `.panel-sash:hover`, `.panel-sash.active`, `.dock-overlay`, `.dock-drag-ghost`
- [ ] **Keep** `IDragState` interface and `drag-state.ts` — ConversationCard and TerminalCard import IDragState, and PanelManager still implements it ([D07])
- [ ] Verify no TypeScript errors from dangling references

**Tests:**
- [ ] No test for this step (deletion verified by build)

**Checkpoint:**
- [ ] `bun run build` succeeds with zero warnings
- [ ] `grep -r "sash\|dock-target\|DockOverlay\|SplitNode\|normalizeTree\|insertNode\|DockState\|FloatingGroup\|DockZone\|removeTab\|findTabNode\|validateDockState" tugdeck/src/` returns no hits (excluding test files being rewritten in Step 4 and excluding `TabNode` which is intentionally kept per [D07])
- [ ] CSS file has no split/sash/dock rules

**Rollback:**
- Revert commit; restore deleted files

**Commit after all checkpoints pass.**

---

#### Step 4: Test Suite Update {#step-4}

**Depends on:** #step-3

**Commit:** `test(tugdeck): update test suite for canvas panel system`

**References:** [D01] Flat array replaces tree, Spec S01, Spec S02, Spec S03, Spec S04, Risk R02, (#test-plan-concepts, #data-model, #serialization-format, #default-layout, #focus-model, #r02-api-surface-change)

**Artifacts:**
- Delete `tugdeck/src/__tests__/dock-target.test.ts`
- Delete or fully rewrite `tugdeck/src/__tests__/layout-tree.test.ts` (old tree tests no longer relevant)
- Rewrite `tugdeck/src/__tests__/floating-panel.test.ts` for PanelState-based constructor
- Rewrite `tugdeck/src/__tests__/panel-manager.test.ts` for canvas rendering path
- Rewrite `tugdeck/src/__tests__/tab-bar.test.ts` for adapted TabBar (no onDragOut)
- Update `tugdeck/src/__tests__/tug-menu.test.ts` to remove preset-related test cases
- Note: `tugdeck/src/__tests__/e2e-integration.test.ts` does NOT import any layout types (it tests ConversationCard and message rendering only) and requires no changes

**Tasks:**
- [ ] Delete `tugdeck/src/__tests__/dock-target.test.ts`
- [ ] Rewrite `tugdeck/src/__tests__/layout-tree.test.ts` to test CanvasState/PanelState types (construction, invariants)
- [ ] Rewrite `tugdeck/src/__tests__/floating-panel.test.ts` to test PanelState-based FloatingPanel
- [ ] Rewrite `tugdeck/src/__tests__/panel-manager.test.ts`:
  - Test render() creates correct number of FloatingPanel elements
  - Test focus model (click moves panel to end of array)
  - Test addNewCard/removeCard
  - Test addNewTab (same-type constraint)
  - Test resetLayout builds default canvas
  - Test `getCanvasState()` returns current canvas state (replaces getDockState tests)
  - Test `applyLayout(CanvasState)` validates and applies new state (replaces old applyLayout tests)
- [ ] Rewrite `tugdeck/src/__tests__/tab-bar.test.ts` for adapted TabBar (no onDragOut callback)
- [ ] Update `tugdeck/src/__tests__/tug-menu.test.ts` to verify no preset menu items; update all `getDockState()` calls to `getCanvasState()`; remove preset-related test cases
- [ ] Add serialization round-trip tests if not already covered in Step 1

**Tests:**
- [ ] All new/rewritten tests pass
- [ ] No test file imports deleted modules

**Checkpoint:**
- [ ] `bun test` passes with zero failures
- [ ] `bun run build` still succeeds
- [ ] No references to deleted types/functions in any test file

**Rollback:**
- Revert commit; restore previous test files

**Commit after all checkpoints pass.**

---

### 1.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** tugdeck canvas panel system (Change A) — all panels render as free-form floating panels on an absolutely-positioned canvas, with v4 serialization, focus model, and no remaining tiling/docking code.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `bun run build` produces zero errors and zero warnings
- [ ] `bun test` passes all tests with zero failures
- [ ] All five default panels render at computed positions with 12px gaps
- [ ] Click-to-front focus works (visual indicator on focused panel)
- [ ] Panel move and resize are independent (no neighbor effects)
- [ ] v4 serialization round-trips correctly (save, reload, positions preserved)
- [ ] No imports of sash.ts, dock-target.ts, SplitNode, normalizeTree, insertNode, DockState, FloatingGroup anywhere in the codebase
- [ ] No preset code (savePreset, loadPreset, listPresets, PRESETS_STORAGE_KEY) anywhere in the codebase
- [ ] sash.ts and dock-target.ts files do not exist

**Acceptance tests:**
- [ ] Unit tests for CanvasState/PanelState construction and invariants
- [ ] Unit tests for buildDefaultLayout position computation
- [ ] Golden tests for v4 serialization round-trip
- [ ] Integration tests for PanelManager canvas rendering
- [ ] Unit tests for focus model (click-to-front z-ordering)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Change B: Snap, sets, and shared-edge resize
- [ ] Re-implement preset/layout saving for canvas model
- [ ] Panel minimize/maximize gestures
- [ ] Keyboard shortcuts for panel focus cycling

| Checkpoint | Verification |
|------------|--------------|
| Build clean | `bun run build` zero warnings |
| Tests pass | `bun test` zero failures |
| No dead code | grep for deleted symbols returns empty |
| Visual verification | Five floating panels with 12px gaps, focus indicator works |

**Commit after all checkpoints pass.**
