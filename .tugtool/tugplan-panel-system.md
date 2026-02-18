## Phase 8.0: Panel System {#phase-panel-system}

**Purpose:** Replace the fixed CSS Grid layout in tugdeck with a full dockable panel system where cards are first-class objects: dockable to edges and to each other, tabbable together, floatable over the canvas, resizable via sashes, each with a custom header menu and a tug logo menu for adding cards and managing layouts.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-17 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current tugdeck layout is a fixed CSS Grid with a two-column arrangement: conversation on the left, terminal/git/files/stats stacked on the right, with drag handles between them. This works for the predetermined five-card arrangement but breaks as soon as the user wants to rearrange cards, float a card over the canvas, tab two cards together, or add a new card instance. The DeckManager class in `tugdeck/src/deck.ts` is tightly coupled to this fixed grid: named CSS grid areas, hardcoded column/row split fractions, and slot-specific drag handles. The panel system replaces all of this with a recursive layout tree that supports arbitrary nesting, tabbing, floating, and dynamic card creation.

The design follows the consensus architecture from Adobe Photoshop, VS Code, JupyterLab (Lumino), and Dockview: a layout tree where internal nodes are splits and leaf nodes are tab containers. The full specification is in `roadmap/component-roadmap-2.md` under "Phase 8: Panel System".

#### Strategy {#strategy}

- Build the layout tree data structure first with full serialization and v2-to-v3 migration, so existing localStorage layouts survive the transition.
- Implement the tree renderer as a replacement for the CSS Grid, producing nested flex containers with sash resizing between siblings.
- Layer tab groups on top of the tree renderer, with drag-reorder and close.
- Add drag-and-drop dock targeting using the Lumino algorithm (pure cursor-position math, no compass widget) with a blue overlay for visual feedback.
- Implement floating panels as an escape hatch from the docked tree, with undock/re-dock/move/resize/z-order.
- Build the card header bar (icon, title, menu, collapse, close) using a hybrid approach: cards provide metadata via interface, the panel system constructs the full header DOM.
- Add per-card dropdown menus and the tug logo menu last, as these are purely additive UI features.

#### Stakeholders / Primary Customers {#stakeholders}

1. tugdeck end users who want to customize their workspace layout
2. Future card developers who need a standard container and header contract

#### Success Criteria (Measurable) {#success-criteria}

- Layout save/restore round-trip completes in less than 50ms (`performance.now()` measurement)
- Drag overlay tracks cursor at 60fps with zero dropped frames during a 10-second capture (Chrome DevTools Performance panel)
- v2 localStorage layouts migrate to v3 without data loss on first load (automated test with fixture)
- All five existing cards render correctly in the new panel system with no visual regression
- At least two instances of the same card type can coexist, each receiving its own feed frames

#### Scope {#scope}

1. Layout tree data structure (SplitNode, TabNode) with topology invariants
2. Tree renderer producing nested flex containers from the layout tree, with sash resizing
3. Tab groups: tab bar rendering, drag reorder within tab bar, tab close
4. Drag-and-drop dock targeting: Lumino zone detection, blue overlay, tree mutation
5. Floating panels: undock, re-dock, move, resize, z-order management
6. Card header bar: icon, title, menu button, collapse button, close button
7. Per-card dropdown menus (Terminal, Git, Files, Stats, Conversation)
8. Tug menu: top-right logo button for adding cards, reset/save/load layout
9. Serialization to localStorage with v2-to-v3 migration
10. Multi-instance card support with feed fan-out

#### Non-goals (Explicitly out of scope) {#non-goals}

- Accessibility (keyboard-only docking, screen-reader labels) -- deferred to a dedicated pass
- Drag-and-drop of external files onto cards (already handled by conversation card)
- Theming or light-mode support
- Native drag API usage (we use pointer-event ghost per user decision)
- Persistent layout presets across devices (localStorage only, no server sync)

#### Dependencies / Prerequisites {#dependencies}

- Phase 5 (Design Tokens, Icons & Terminal Polish) must be complete -- the panel system uses semantic tokens and Lucide icons throughout
- Phase 7 (Conversation Frontend) must be complete -- the conversation card exists and needs to work within the panel system
- All five card implementations (ConversationCard, TerminalCard, GitCard, FilesCard, StatsCard) exist and conform to the TugCard interface

#### Constraints {#constraints}

- No new npm dependencies -- use `crypto.randomUUID()` for node IDs, Lucide (already installed) for icons
- The `#deck-container` root element in `index.html` does not change
- The existing TugCard interface (`feedIds`, `mount`, `onFrame`, `onResize`, `destroy`) is preserved unchanged
- Minimum card size: 100px in any dimension (prevents collapsing to nothing)
- All styling uses semantic tokens from `tugdeck/styles/tokens.css`

#### Assumptions {#assumptions}

- The existing TugCard interface is preserved unchanged; Phase 8 adds a card metadata contract on top of it
- The five existing card implementations are not rewritten; only their container management changes
- The tug logo SVG at `resources/tug-logo-dark.svg` will be inlined or bundled
- `deck.css` is largely replaced by panel system CSS; `cards.css` extended with tab bar, sash, floating panel, and header bar styles
- ConversationCard receives an IDragState interface via a setter (same pattern as current DeckManager coupling, new type)

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Visual regression from CSS Grid removal | high | medium | Default layout tree reproduces identical visual arrangement; golden test for v2-to-v3 migration; manual visual comparison before/after | Any card renders incorrectly after Step 1 |
| Drag zone detection too slow at 60fps | medium | low | Tree walk is O(n) on leaf count (typically 5-10); benchmark with Chrome DevTools; cache `getBoundingClientRect()` results per drag session | Frame drops detected during drag in Step 3 |
| Card container assumptions break silently | medium | medium | Audit all card `mount()` calls for container-dependent CSS; see Risk R01 below | Layout breaks for specific card types after Step 1 |
| ConversationCard permission mode migration | medium | low | Atomic migration in Step 5: remove `<select>` and add `CardMenuItem` replacement in the same step; no gap where permission mode is unavailable | Permission mode stops working after Step 5 |

**Risk R01: Card Container CSS Assumptions** {#r01-container-assumptions}

- **Risk:** Existing cards make CSS assumptions about their container that will break when the panel system replaces the CSS Grid card-slot containers. Specifically: ConversationCard's `.card-header` uses `margin: -8px -8px 0 -8px` to counteract the 8px `.card-slot` padding and render flush headers. The panel system's card mount containers will not have this padding, so the negative margins will create visual artifacts (header hanging outside its container).
- **Mitigation:**
  - Step 1: Panel system card mount containers use zero padding (card content fills the entire area)
  - Step 5: When removing card self-created headers, also remove the negative-margin hack from ConversationCard's header CSS
  - Verify each card renders correctly after Step 1 (before headers are migrated) by checking that no card content overflows its container
- **Residual risk:** Other cards may have similar undocumented CSS assumptions discovered only at integration time

**Risk R02: Existing Test Suite Breakage** {#r02-test-breakage}

- **Risk:** `tugdeck/src/__tests__/deck-layout.test.ts` tests DeckManager's v1-to-v2 migration logic and CSS Grid layout semantics. When `deck.ts` is removed in Step 1, these tests will fail to compile.
- **Mitigation:**
  - Step 1: Remove `deck-layout.test.ts` and replace with equivalent tests for layout-tree.ts and serialization.ts (which cover the same migration scenarios at the v2-to-v3 level)
- **Residual risk:** None; the new tests cover a superset of the old test scenarios

---

### 8.0.0 Design Decisions {#design-decisions}

#### [D01] Layout tree with SplitNode and TabNode (DECIDED) {#d01-layout-tree}

**Decision:** The layout is a recursive tree with two node types: SplitNode (internal, splits space between children with weights) and TabNode (leaf, holds one or more cards as tabs).

**Rationale:**
- This is the consensus architecture across Adobe Photoshop, VS Code, JupyterLab (Lumino), and Dockview
- A tree naturally supports arbitrary nesting, unlike a fixed grid
- Topology invariants (no same-grain nesting, no single-child splits, leaves are always tab nodes) keep the tree normalized

**Implications:**
- Every mutation must run the topology normalization pass
- The existing CSS Grid layout in `deck.css` is fully replaced by nested flex containers
- DeckManager is replaced by a PanelManager that owns the layout tree

#### [D02] Version 3 serialization with v2 migration (DECIDED) {#d02-serialization-v3}

**Decision:** The serialized dock state uses version 3 format. On first load, existing v2 layouts (`colSplit`/`rowSplits`/`collapsed`) are migrated into the panel tree format automatically.

**Rationale:**
- Users must not lose their saved layouts on upgrade
- The v2 format (column split + row splits + collapsed set) maps deterministically to a layout tree
- Version field in localStorage enables forward-compatible schema evolution

**Implications:**
- Migration code must handle the v2 schema completely (colSplit, rowSplits array, collapsed array)
- The localStorage key remains `"tugdeck-layout"` with a version field to distinguish
- Save debounce remains 500ms

#### [D03] Pointer-event ghost for drag (DECIDED) {#d03-pointer-event-ghost}

**Decision:** On `pointerdown` on a tab or card header, clone the card header as a lightweight floating element that tracks `pointermove`. No native HTML5 drag API.

**Rationale:**
- The native drag API has platform inconsistencies and limited control over the drag preview
- Pointer events give full control over positioning, styling, and hit testing
- The ghost is lightweight (just a header clone, not the full card DOM)

**Implications:**
- All drag state is managed via `setPointerCapture` / `pointermove` / `pointerup`
- The ghost element is absolutely positioned on the deck canvas with `pointer-events: none`
- Zone detection is computed from cursor position, not from native drag events

#### [D04] Lumino-style zone detection (DECIDED) {#d04-zone-detection}

**Decision:** Drop zones are computed using pure cursor-position math following the Lumino algorithm: root edge test (40px), then TabNode hit test via `getBoundingClientRect()`, then zone-within-target by edge proximity.

**Rationale:**
- No compass widget or overlay zones needed -- the algorithm is purely mathematical
- Lumino's approach is battle-tested in JupyterLab
- Root-edge docking (top/bottom/left/right of entire canvas) provides a natural way to create new rows/columns

**Implications:**
- Zone detection must walk the layout tree on every `pointermove` during drag
- Performance must be validated at 60fps during drag operations
- The blue overlay geometry is computed per zone type (root edges use golden ratio complement 38.2%)

#### [D05] IDragState interface for card coupling (DECIDED) {#d05-drag-state-interface}

**Decision:** Introduce a minimal `IDragState` interface in a dedicated shared file (`tugdeck/src/drag-state.ts`) that the new panel system implements. ConversationCard (and TerminalCard) receive it via a setter, replacing the current DeckManager coupling. This interface must be introduced in Step 1 (alongside PanelManager) to avoid a type-cascade compilation failure.

**Rationale:**
- Cards that need to coordinate with layout (e.g., suppressing resize during drag) need a narrow interface, not the full panel manager
- The setter pattern is already established (`setDeckManager`)
- A minimal interface prevents cards from depending on panel system internals
- Both ConversationCard and TerminalCard import `DeckManager` type today; replacing DeckManager with PanelManager in `main.ts` would break compilation if the cards still reference the old type
- Placing IDragState in a shared file (`drag-state.ts`) rather than in `panel-manager.ts` avoids a layering inversion where card modules import from the manager module

**Implications:**
- `IDragState` is defined in `tugdeck/src/drag-state.ts` and exported
- `IDragState` exposes only `isDragging: boolean` (and potentially `isResizing: boolean`)
- ConversationCard and TerminalCard import `IDragState` from `../drag-state` (not from `../panel-manager`)
- PanelManager imports and implements `IDragState` from `./drag-state`
- The setter is renamed from `setDeckManager` to `setDragState` (or kept as `setDeckManager` with the new type)
- This change happens in Step 1 (not Step 5) to ensure every step compiles independently

#### [D06] Hybrid header bar construction (DECIDED) {#d06-hybrid-header}

**Decision:** Cards provide metadata (title, icon name, menu items) via an extended interface; the panel system constructs the full header DOM from that metadata.

**Rationale:**
- Consistent header styling across all cards without each card building its own header
- Cards remain focused on their content area; chrome is the panel system's responsibility
- Menu items are declarative data, not DOM elements, enabling the panel system to render them uniformly

**Implications:**
- The TugCard interface is extended with an optional `TugCardMeta` property (title, icon, menuItems, closable)
- Existing card implementations that create their own `.card-header` must be updated to provide metadata instead
- The panel system's header replaces the card's self-created header
- **ConversationCard special case:** The current ConversationCard header contains an interactive `<select>` element for permission mode that calls `connection.send()`. The migration is atomic within Step 5: remove the self-created header including the `<select>`, and in the same step add a "Permission mode" `CardMenuItem` of type `"select"` with options `["default", "acceptEdits", "bypassPermissions", "plan"]` and an `action` callback that sends the same `permission_mode` IPC message via `connection.send()`. This avoids any step where permission mode is unavailable. The `CardMenuItem` spec supports `type: "select"` with an `options` array and a callback that receives the selected value. ConversationCard's `meta.menuItems` getter must capture `this.connection` in the closure. The DropdownMenu class and card-menu.ts are created in Step 5 to support this; Step 6 then adds the remaining card menus (Terminal, Git, Files, Stats, plus Conversation's New Session and Export History items).

#### [D07] Multi-instance card support with feed fan-out (DECIDED) {#d07-multi-instance}

**Decision:** Multiple instances of the same card type are supported. Feed frames are fanned out to all registered instances sharing the same feedId.

**Rationale:**
- Users may want two terminal cards showing different sessions, or two file cards with different filters
- The existing feed dispatch in DeckManager sends frames to a single card per feedId; this must become a one-to-many dispatch
- Each card instance gets a unique `id` (via `crypto.randomUUID()`) but shares `componentId`

**Implications:**
- The frame dispatch map changes from `Map<FeedId, TugCard>` to `Map<FeedId, Set<TugCard>>`
- Card constructors may need an instance ID parameter for distinguishing instances
- The tug menu "Add card" action creates a new card instance and adds it to the feed dispatch

#### [D08] Sash resizing replaces drag handles (DECIDED) {#d08-sash-resizing}

**Decision:** Between every pair of siblings in a SplitNode, a thin sash element (4px wide/tall) allows proportional resizing. Sashes replace the current drag-handle system.

**Rationale:**
- Sashes are generated dynamically from the layout tree structure, not hardcoded per slot
- They support any number of children in any orientation, unlike the fixed grid handles
- The visual style (invisible until hovered, then fades to border color) is standard in all professional panel systems

**Implications:**
- Sash elements are absolutely positioned between flex children
- `setPointerCapture` manages the drag, recomputing weights from cursor position
- Minimum card size (100px) is enforced during sash drag
- Layout is saved to localStorage on sash release

#### [D09] Instance identity preservation during layout mutations (DECIDED) {#d09-instance-identity}

**Decision:** All layout mutations (dock, undock, tab, split, float, re-dock) preserve card instance identity. The card's DOM element is reparented into the new container via `appendChild` / `insertBefore`; card instances are never destroyed and recreated for layout changes. Card instances are only destroyed on explicit close (X button) or layout reset.

**Rationale:**
- Terminal cards maintain cursor state, scrollback buffer, and WebGL context; re-creating would lose all of this
- Conversation cards maintain streaming state, message ordering buffer, session cache, and scroll position; re-creating would lose the conversation
- DOM reparenting preserves all internal state including event listeners, timers, and WebSocket subscriptions
- This matches how VS Code, JupyterLab (Lumino), and Dockview handle panel moves

**Implications:**
- `renderTree()` must diff the current DOM against the layout tree and reparent existing card elements rather than clearing and rebuilding
- Tab switching hides inactive tabs with `display: none` rather than unmounting them (keeping the card instance alive and its DOM in the document)
- Only explicit close (X button) calls `card.destroy()` and removes from the feed dispatch map
- Layout reset destroys all cards and rebuilds from scratch (this is the one case where card instances are destroyed)
- Floating panel undock/re-dock reparents the same card element between the docked tree container and the floating panel container

#### [D10] Manager-level fan-out for frame dispatch (DECIDED) {#d10-manager-fanout}

**Decision:** PanelManager registers exactly ONE callback per feedId with `connection.onFrame()` at initialization time. The callback internally iterates the `Map<FeedId, Set<TugCard>>` card registry. Cards are added to and removed from the internal sets only; no per-card-instance callbacks are registered with the connection.

**Rationale:**
- The current transport callback registration (`connection.onFrame`) is append-only with no unsubscribe mechanism
- Frequent create/destroy flows (add card, reset layout, load preset, multi-instance) would accumulate orphaned frame handlers if each card instance registered its own callback
- A single callback per feedId eliminates the leak entirely; card churn only affects the internal set membership

**Implications:**
- PanelManager registers all known feedIds on construction (once), never again
- `addCard(card)` adds the card to the internal `Set<TugCard>` for each of its feedIds
- `removeCard(card)` removes the card from the internal sets and calls `card.destroy()`
- The frame callback iterates `cardSet.forEach(card => card.onFrame(feedId, payload))`; if the set is empty the frame is silently dropped
- This architecture is established in Step 1 and used unchanged through Steps 2-7

---

### 8.0.1 Specification {#specification}

#### 8.0.1.1 Data Model {#data-model}

**Spec S01: Layout Tree Types** {#s01-layout-tree-types}

```typescript
type Orientation = "horizontal" | "vertical";
type LayoutNode = SplitNode | TabNode;

interface SplitNode {
  type: "split";
  orientation: Orientation;
  children: LayoutNode[];
  weights: number[];  // proportional sizes, same length as children, sum to 1.0
}

interface TabNode {
  type: "tab";
  id: string;           // crypto.randomUUID()
  tabs: TabItem[];
  activeTabIndex: number;
}

interface TabItem {
  id: string;           // unique card instance ID
  componentId: string;  // "terminal" | "git" | "files" | "stats" | "conversation"
  title: string;
  closable: boolean;
}

interface DockState {
  root: LayoutNode;
  floating: FloatingGroup[];
}

interface FloatingGroup {
  position: { x: number; y: number };
  size: { width: number; height: number };
  node: TabNode;
}
```

**Spec S02: Serialization Types** {#s02-serialization-types}

```typescript
interface SerializedDockState {
  version: 3;
  root: SerializedNode;
  floating: SerializedFloatingGroup[];
  presetName?: string;
}

type SerializedNode = SerializedSplit | SerializedTabGroup;

interface SerializedSplit {
  type: "split";
  orientation: "horizontal" | "vertical";
  children: SerializedNode[];
  weights: number[];
}

interface SerializedTabGroup {
  type: "tabs";
  activeId: string;
  tabs: SerializedTab[];
}

interface SerializedTab {
  id: string;
  componentId: string;
  title: string;
}

interface SerializedFloatingGroup {
  position: { x: number; y: number };
  size: { width: number; height: number };
  group: SerializedTabGroup;
}
```

**Spec S03: Card Metadata Interface** {#s03-card-meta}

```typescript
interface TugCardMeta {
  title: string;
  iconName: string;        // Lucide icon name
  menuItems: CardMenuItem[];
  closable: boolean;
}

interface CardMenuItem {
  label: string;
  type: "action" | "toggle" | "select";
  value?: string | boolean;
  options?: string[];       // for "select" type
  action: (value?: string | boolean) => void;  // for "select", receives the selected value
}

// Extended TugCard interface (optional metadata)
interface TugCard {
  readonly feedIds: readonly FeedIdValue[];
  readonly collapsible?: boolean;
  readonly meta?: TugCardMeta;
  mount(container: HTMLElement): void;
  onFrame(feedId: FeedIdValue, payload: Uint8Array): void;
  onResize(width: number, height: number): void;
  destroy(): void;
}
```

**Spec S04: IDragState Interface** {#s04-drag-state}

Defined in `tugdeck/src/drag-state.ts` (shared module, no circular dependency risk).

```typescript
interface IDragState {
  readonly isDragging: boolean;
}
```

#### 8.0.1.2 Topology Invariants {#topology-invariants}

**List L01: Layout Tree Invariants** {#l01-invariants}

1. **No same-grain nesting.** A horizontal split never directly contains another horizontal split. The inner node's children are promoted (flattened) into the outer. Same for vertical.
2. **No single-child splits.** If a split ends up with one child, the split is replaced by that child.
3. **Leaves are always tab nodes.** Every leaf is a tab container, even if it holds only one tab.
4. **Root can be either type.** A single undocked card is just a root TabNode.
5. **Weights sum to 1.0.** The weights array in a SplitNode always sums to 1.0 (within floating-point tolerance).
6. **No empty tab nodes in the docked tree.** If the last tab is removed from a TabNode, the TabNode is removed from the tree and invariants re-run.
7. **Minimum size enforcement (two-layer).** All leaf nodes must meet the 100px minimum in both dimensions. This invariant is enforced at two layers:
   - **Structural layer (`normalizeTree`):** Remains geometry-agnostic. It operates only on tree structure and weight proportions. It does NOT take pixel dimensions as input and does NOT enforce pixel minimums directly.
   - **Geometric layer (PanelManager layout pass):** After calling `normalizeTree()`, PanelManager walks the rendered DOM and verifies each docked container meets 100px minimum using actual pixel dimensions from `getBoundingClientRect()`. If any container is sub-minimum, PanelManager adjusts the parent SplitNode's weights to redistribute space and re-renders. This runs after every tree mutation (insert, remove, sash drag), deserialization, and preset load.
   - **Floating panels:** `validateDockState()` (Spec S07) handles floating panel size clamping to 100px minimum during deserialization. At runtime, floating panel resize drag enforces 100px minimum directly.

#### 8.0.1.3 Dock Zone Detection Algorithm {#zone-detection-algorithm}

**Spec S05: Zone Detection** {#s05-zone-detection}

The algorithm runs on every `pointermove` during a drag operation. Steps are evaluated in strict priority order; the first match wins.

**Precedence rules:**
- **P1: Root edges take absolute priority.** If the cursor is within 40px of any canvas edge, the result is always a root zone regardless of what TabNode is underneath. Corner overlap (two root edges simultaneously) resolves to the edge the cursor is closest to.
- **P2: Tab-bar zone takes priority over widget zones.** Within a hit TabNode, if the cursor is within the tab-bar height, the result is `tab-bar` even if the cursor is also near a widget edge.
- **P3: Closest edge wins for widget zones.** Among top/bottom/left/right, the edge with the smallest distance from cursor wins. Ties (diagonal corners equidistant from two edges) resolve to the edge with the larger absolute distance from center, producing a deterministic result.

**Algorithm steps:**

1. **Root edge test.** If the cursor is within 40px of any edge of the deck canvas:
   - `root-top`: new horizontal row above everything
   - `root-bottom`: new horizontal row below everything
   - `root-left`: new vertical column left of everything
   - `root-right`: new vertical column right of everything
   - Overlay covers 38.2% of canvas in the appropriate dimension (golden ratio complement)
   - If cursor is within 40px of two edges (corner), resolve to the closer edge; on exact tie, prefer horizontal (top/bottom) over vertical (left/right)

2. **TabNode hit test.** Walk the layout tree, testing which TabNode's bounding rect contains the cursor via `getBoundingClientRect()`.

3. **Zone within the target TabNode.** Evaluated in priority order:
   - `tab-bar` (P2): cursor within tab bar height (28px from top of TabNode) -> dock as a new tab
   - `widget-top` / `widget-bottom` / `widget-left` / `widget-right` (P3): closest edge wins; ties resolved as described above -> split target
   - `center`: target has only one tab and cursor is not near any edge -> replace entire area

4. **Overlay geometry per zone:**

**Table T01: Overlay Geometry** {#t01-overlay-geometry}

| Zone | Overlay covers |
|------|---------------|
| root-left/right | Left/right 38.2% of deck canvas width |
| root-top/bottom | Top/bottom 38.2% of deck canvas height |
| widget-left/right | Left/right 50% of target TabNode |
| widget-top/bottom | Top/bottom 50% of target TabNode |
| tab-bar | Tab bar height of the target |
| center | Entire target TabNode |

#### 8.0.1.4 V2-to-V3 Migration {#v2-v3-migration}

**Spec S06: Migration Algorithm** {#s06-migration}

When loading from localStorage and `version === 2`:

1. Read `colSplit` (default 0.667), `rowSplits` (default [0.25, 0.5, 0.75]). The v2 `collapsed` array is read but ignored -- v3 has no persisted collapsed concept; collapsed state in v2 is discarded and all cards start expanded
2. Construct the layout tree:
   - Root: `SplitNode(horizontal)` with two children
   - Left child: `TabNode` with a single Conversation tab, weight = `colSplit`
   - Right child: `SplitNode(vertical)` with four children (Terminal, Git, Files, Stats), weight = `1 - colSplit`
   - Right child weights derived from `rowSplits`: `[rowSplits[0], rowSplits[1] - rowSplits[0], rowSplits[2] - rowSplits[1], 1 - rowSplits[2]]`
3. Save as v3 immediately

Note: The panel system's header collapse button is a runtime-only UI toggle (it sets `display: none` on the card content area); collapsed state is not persisted in v3 serialization.

#### 8.0.1.4a Deserialization Validation {#deserialization-validation}

**Spec S07: Post-Deserialization Validation** {#s07-deserialization-validation}

After deserializing a `DockState` (from main layout or named preset), run these validation steps:

1. **Minimum-size clamping for floating panels.** If any `FloatingGroup.size.width` or `FloatingGroup.size.height` is less than 100px, clamp it to 100px (invariant L01.7, floating panel layer).
2. **Off-canvas clamping for floating panels.** Clamp `FloatingGroup.position` so the panel is fully within the visible canvas bounds. If `position.x + size.width > canvasWidth`, set `position.x = canvasWidth - size.width`. Same for y-axis. If `position.x < 0`, set `position.x = 0`. Same for y. This prevents panels from being loaded off-screen after a window resize.
3. **Structural tree normalization.** Run `normalizeTree()` on the deserialized root to enforce structural topology invariants (L01.1-6). `normalizeTree()` is geometry-agnostic and does not take pixel dimensions.
4. **Geometric minimum enforcement (deferred to PanelManager).** After `validateDockState()` returns, PanelManager renders the tree and runs its geometric layout pass to verify all docked containers meet the 100px minimum (invariant L01.7, geometric layer). This happens automatically as part of the first render after deserialization.
5. **Preset schema.** Named presets use the same v3 `SerializedDockState` format with no independent version number. If the schema changes in a future version, all presets stored under the `tugdeck-layouts` localStorage key migrate together.

#### 8.0.1.5 Default Layout {#default-layout}

The default layout when no saved state exists:

```
root: SplitNode(horizontal)
+-- TabNode [Conversation]          weight: 0.667
+-- SplitNode(vertical)             weight: 0.333
    +-- TabNode [Terminal]          weight: 0.25
    +-- TabNode [Git]              weight: 0.25
    +-- TabNode [Files]            weight: 0.25
    +-- TabNode [Stats]            weight: 0.25
```

#### 8.0.1.6 Card Header Menus {#card-header-menus}

**Table T02: Card Menu Items** {#t02-card-menus}

| Card | Menu items |
|------|------------|
| Terminal | Font size (S/M/L), Clear scrollback, WebGL on/off |
| Git | Refresh now, Show/hide untracked |
| Files | Clear history, Max entries (50/100/200) |
| Stats | Sparkline timeframe (30s/60s/120s), Show/hide sub-cards |
| Conversation | Permission mode (default/acceptEdits/bypassPermissions/plan), New session, Export history |

#### 8.0.1.7 Tug Menu Items {#tug-menu-items}

**Table T03: Tug Menu** {#t03-tug-menu}

| Item | Action |
|------|--------|
| + Terminal | Create new Terminal card instance as floating panel |
| + Conversation | Create new Conversation card instance as floating panel |
| + Git | Create new Git card instance as floating panel |
| + Files | Create new Files card instance as floating panel |
| + Stats | Create new Stats card instance as floating panel |
| (separator) | |
| Reset layout | Restore default layout |
| Save layout as... | Prompt for name, save to localStorage |
| Load layout... | Show submenu of saved presets |
| (separator) | |
| About tugdeck | Version info |

---

### 8.0.2 Symbol Inventory {#symbol-inventory}

#### 8.0.2.1 New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/layout-tree.ts` | LayoutNode, SplitNode, TabNode types; topology normalization; tree mutation functions |
| `tugdeck/src/drag-state.ts` | IDragState interface (shared module imported by cards and panel-manager) |
| `tugdeck/src/panel-manager.ts` | PanelManager class replacing DeckManager; owns layout tree, renders DOM, dispatches frames |
| `tugdeck/src/sash.ts` | Sash resize element creation and drag logic |
| `tugdeck/src/dock-target.ts` | Zone detection algorithm and overlay rendering |
| `tugdeck/src/floating-panel.ts` | FloatingGroup management: undock, re-dock, move, resize, z-order |
| `tugdeck/src/tab-bar.ts` | Tab bar rendering, drag reorder, close button |
| `tugdeck/src/card-header.ts` | Card header bar construction from TugCardMeta |
| `tugdeck/src/card-menu.ts` | Dropdown menu rendering for card menus and tug menu |
| `tugdeck/src/tug-menu.ts` | Tug logo button and top-level menu |
| `tugdeck/src/serialization.ts` | Serialize/deserialize DockState, v2-to-v3 migration |
| `tugdeck/styles/panels.css` | Panel system styles (sash, tab bar, floating panel, header bar, menus, overlay) |

#### 8.0.2.2 Modified files {#modified-files}

| File | Change |
|------|--------|
| `tugdeck/src/main.ts` | Replace DeckManager with PanelManager; update card registration and setter calls |
| `tugdeck/src/deck.ts` | Deprecated/removed; replaced by `panel-manager.ts` |
| `tugdeck/src/cards/card.ts` | Add optional `meta?: TugCardMeta` to TugCard interface |
| `tugdeck/src/cards/conversation-card.ts` | Change `setDeckManager` to `setDragState(IDragState)` (Step 1); add `meta` property and remove self-created header including permission mode `<select>` (Step 5) |
| `tugdeck/src/cards/terminal-card.ts` | Change `setDeckManager` to `setDragState(IDragState)` (Step 1); add `meta` property (Step 5) |
| `tugdeck/src/cards/git-card.ts` | Add `meta` property; remove self-created header |
| `tugdeck/src/cards/files-card.ts` | Add `meta` property; remove self-created header |
| `tugdeck/src/cards/stats-card.ts` | Add `meta` property; remove self-created header |
| `tugdeck/index.html` | Add `<link rel="stylesheet" href="panels.css">` after cards.css |
| `tugdeck/styles/deck.css` | Remove CSS Grid layout rules; retain disconnect banner and collapse styles |
| `tugdeck/styles/cards.css` | Remove `.card-header` negative-margin hack and `.collapse-btn` styles (moved to panel system) |
| `tugdeck/src/__tests__/deck-layout.test.ts` | Removed; replaced by layout-tree and serialization tests |

#### 8.0.2.3 Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `SplitNode` | interface | `layout-tree.ts` | Internal tree node |
| `TabNode` | interface | `layout-tree.ts` | Leaf tree node |
| `TabItem` | interface | `layout-tree.ts` | Single tab within a TabNode |
| `DockState` | interface | `layout-tree.ts` | Root + floating panels |
| `FloatingGroup` | interface | `layout-tree.ts` | Floating panel descriptor |
| `normalizeTree` | function | `layout-tree.ts` | Enforce topology invariants |
| `insertNode` | function | `layout-tree.ts` | Insert a card at a dock zone |
| `removeTab` | function | `layout-tree.ts` | Remove a tab and clean up |
| `PanelManager` | class | `panel-manager.ts` | Replaces DeckManager; implements IDragState |
| `IDragState` | interface | `drag-state.ts` | Narrow interface for card coupling (shared module) |
| `validateDockState` | function | `serialization.ts` | Post-deserialization validation (Spec S07) |
| `TugCardMeta` | interface | `cards/card.ts` | Card metadata for header construction |
| `CardMenuItem` | interface | `cards/card.ts` | Menu item descriptor |
| `SerializedDockState` | interface | `serialization.ts` | v3 serialization format |
| `migrateV2ToV3` | function | `serialization.ts` | Migration from CSS Grid layout |
| `createSash` | function | `sash.ts` | Create sash element between siblings |
| `computeDropZone` | function | `dock-target.ts` | Lumino zone detection |
| `DockOverlay` | class | `dock-target.ts` | Blue overlay element management |
| `TabBar` | class | `tab-bar.ts` | Tab bar rendering and interaction |
| `CardHeader` | class | `card-header.ts` | Header bar construction |
| `DropdownMenu` | class | `card-menu.ts` | Generic dropdown menu |
| `TugMenu` | class | `tug-menu.ts` | Top-right logo button + menu |

---

### 8.0.3 Documentation Plan {#documentation-plan}

- [ ] Update `roadmap/component-roadmap-2.md` Phase 8 section to mark as implemented
- [ ] Add inline JSDoc comments to all public exports in new files (layout-tree.ts, panel-manager.ts, serialization.ts, etc.)
- [ ] Document the TugCardMeta interface contract for future card developers in card.ts

---

### 8.0.4 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test layout tree mutations, topology normalization, zone detection math, serialization | Core data structure logic |
| **Integration** | Test PanelManager rendering, card mounting, frame dispatch to multiple instances | Component interaction |
| **Golden / Contract** | Compare serialized layout JSON against known-good snapshots; verify v2-to-v3 migration output | Schema stability |

---

### 8.0.5 Execution Steps {#execution-steps}

> **Compilation invariant:** Every step must compile independently. The IDragState interface (in `drag-state.ts`) and card setter updates are introduced in Step 1 alongside PanelManager to prevent type-cascade failures in Steps 1-4.
>
> **Instance identity rule:** All layout mutations in Steps 1-4 (dock, undock, tab, split, float, re-dock) preserve card instance identity via DOM reparenting. Cards are never destroyed and recreated for layout changes. See [D09].
>
> **Fan-out rule:** PanelManager registers one callback per feedId with the connection at setup time. Cards are added/removed from internal `Map<FeedId, Set<TugCard>>` sets only. No per-card-instance callbacks are registered with the connection. See [D10].

#### Step 0: Layout Tree Data Structure {#step-0}

**Commit:** `feat(tugdeck): add layout tree data structure with topology normalization and serialization`

**References:** [D01] Layout tree with SplitNode and TabNode, [D02] Version 3 serialization with v2 migration, Spec S01, Spec S02, Spec S06, Spec S07, List L01, (#data-model, #topology-invariants, #v2-v3-migration, #s02-serialization-types, #deserialization-validation, #s07-deserialization-validation)

**Artifacts:**
- `tugdeck/src/layout-tree.ts` -- SplitNode, TabNode, TabItem, DockState, FloatingGroup types; `normalizeTree()`, `insertNode()`, `removeTab()`, `findTabNode()` functions
- `tugdeck/src/serialization.ts` -- `serialize()`, `deserialize()`, `validateDockState()`, `migrateV2ToV3()`, `buildDefaultLayout()` functions
- Unit tests for tree operations, serialization, and deserialization validation

**Tasks:**
- [ ] Create `tugdeck/src/layout-tree.ts` with all type definitions from Spec S01
- [ ] Implement `normalizeTree()` enforcing structural invariants L01.1-6. `normalizeTree()` is geometry-agnostic: it operates on tree structure and weight proportions only, with no pixel dimensions as input. Minimum-size geometric enforcement (L01.7) is handled by PanelManager's layout pass, not by `normalizeTree()`
- [ ] Implement `insertNode(tree, zone, newTab)` to add a card at a computed dock zone (split or tab). After insertion, run `normalizeTree()` which enforces minimum-size weights
- [ ] Implement `removeTab(tree, tabId)` to remove a tab and run normalization
- [ ] Implement `findTabNode(tree, tabNodeId)` for hit-test resolution
- [ ] Create `tugdeck/src/serialization.ts` with SerializedDockState types from Spec S02
- [ ] Implement `serialize(dockState)` and `deserialize(json)` with round-trip fidelity
- [ ] Implement `validateDockState(dockState, canvasWidth, canvasHeight)` following Spec S07: clamp floating panel sizes to 100px minimum, clamp floating panel positions to canvas bounds, run `normalizeTree()` on root
- [ ] `deserialize()` calls `validateDockState()` after parsing
- [ ] Implement `migrateV2ToV3(v2State)` following Spec S06 algorithm. The v2 `collapsed` array is read but ignored; all cards start expanded in v3
- [ ] Implement `buildDefaultLayout()` producing the default five-card arrangement

**Tests:**
- [ ] Unit test: normalizeTree flattens same-grain nested splits
- [ ] Unit test: normalizeTree removes single-child splits
- [ ] Unit test: normalizeTree preserves valid trees unchanged
- [ ] Unit test: normalizeTree does NOT take pixel dimensions; it only enforces structural invariants (verify it does not modify weights based on pixel sizes)
- [ ] Unit test: insertNode at widget-left creates a horizontal split
- [ ] Unit test: insertNode at tab-bar adds tab to existing TabNode
- [ ] Unit test: removeTab from multi-tab node preserves remaining tabs
- [ ] Unit test: removeTab of last tab removes TabNode and normalizes
- [ ] Unit test: serialize/deserialize round-trip produces identical DockState
- [ ] Unit test: validateDockState clamps floating panel with sub-100px size to 100px
- [ ] Unit test: validateDockState clamps floating panel position to canvas bounds
- [ ] Golden test: migrateV2ToV3 with default v2 state produces expected v3 JSON (collapsed array ignored)
- [ ] Golden test: migrateV2ToV3 with custom colSplit/rowSplits produces correct tree
- [ ] Golden test: migrateV2ToV3 with collapsed cards in v2 produces all-expanded v3 tree
- [ ] Unit test: buildDefaultLayout produces correct structure

**Checkpoint:**
- [ ] `bun test` passes all layout tree and serialization tests
- [ ] No TypeScript compilation errors

**Rollback:** Revert commit; new files only, no existing code changed.

**Commit after all checkpoints pass.**

---

#### Step 1: Tree Renderer, IDragState Migration, and Manager Fan-Out {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugdeck): add tree renderer with sash resizing, introduce IDragState, replace DeckManager`

**References:** [D01] Layout tree with SplitNode and TabNode, [D05] IDragState interface for card coupling, [D08] Sash resizing replaces drag handles, [D09] Instance identity preservation, [D10] Manager-level fan-out, Spec S01, Spec S04, Risk R01, Risk R02, (#data-model, #default-layout, #specification, #s04-drag-state, #r01-container-assumptions, #r02-test-breakage, #d09-instance-identity, #d10-manager-fanout)

**Artifacts:**
- `tugdeck/src/drag-state.ts` -- IDragState interface (shared module)
- `tugdeck/src/panel-manager.ts` -- PanelManager class (renders tree as DOM, owns card registry, dispatches frames via manager-level fan-out, implements IDragState)
- `tugdeck/src/sash.ts` -- Sash element creation, drag logic, weight recalculation
- `tugdeck/styles/panels.css` -- Flex container styles, sash styles
- Modified `tugdeck/src/main.ts` -- Replace DeckManager instantiation with PanelManager; update card setter calls
- Modified `tugdeck/src/cards/conversation-card.ts` -- Change `setDeckManager(DeckManager)` to `setDragState(IDragState)` imported from `../drag-state`
- Modified `tugdeck/src/cards/terminal-card.ts` -- Change `setDeckManager(DeckManager)` to `setDragState(IDragState)` imported from `../drag-state`
- Modified `tugdeck/index.html` -- Add `<link rel="stylesheet" href="panels.css">` tag
- Removed `tugdeck/src/__tests__/deck-layout.test.ts` -- Replaced by layout-tree and serialization tests from Step 0

**Tasks:**
- [ ] Create `tugdeck/src/drag-state.ts` with `IDragState` interface (Spec S04: `{ readonly isDragging: boolean }`). This is a standalone shared module with no dependencies on panel-manager
- [ ] Create `tugdeck/src/panel-manager.ts` with `PanelManager` class importing and implementing `IDragState` from `./drag-state`
- [ ] PanelManager constructor takes `(container: HTMLElement, connection: TugConnection)` -- same signature as DeckManager. Store `connection` for feed dispatch and call `connection.onOpen(() => this.handleResize())` to preserve the existing reconnect-resize behavior
- [ ] **Manager-level fan-out ([D10]):** PanelManager registers exactly ONE callback per known feedId with `connection.onFrame()` during construction. Each callback iterates `this.cardsByFeed.get(feedId)` (a `Map<FeedId, Set<TugCard>>`) and calls `card.onFrame(feedId, payload)` on each. If the set is empty the frame is silently dropped. `addCard(card)` adds the card to the sets for each of its feedIds. `removeCard(card)` removes from sets and calls `card.destroy()`. No per-card-instance callbacks are ever registered with the connection
- [ ] **DOM reparenting ([D09]):** Implement `renderTree(node, parentEl)` that recursively produces nested flex containers from the layout tree. When re-rendering after a tree mutation, existing card DOM elements are reparented into their new containers via `appendChild` rather than destroying and recreating. Card instances are never destroyed for layout mutations; only explicit close (X button) or layout reset calls `card.destroy()`
- [ ] For SplitNode: create a flex container with `flex-direction` matching orientation; children get `flex` based on weights
- [ ] For TabNode: create a container div (zero padding, no `.card-slot` class) that hosts the active card's mount point. Inactive tabs in a multi-tab group are hidden with `display: none` but remain mounted in the DOM (their card instances stay alive)
- [ ] Create `tugdeck/src/sash.ts` with sash creation between flex children
- [ ] Implement sash drag: `setPointerCapture`, recompute weights on `pointermove`, enforce 100px minimum directly during drag (pixel-aware constraint on the drag handler). After sash release, run `normalizeTree()` for structural invariants, then the geometric layout pass to verify 100px minimums
- [ ] On sash release: update layout tree weights and save to localStorage
- [ ] Create `tugdeck/styles/panels.css` with flex container, sash, and canvas styles
- [ ] Add `<link rel="stylesheet" href="panels.css">` to `tugdeck/index.html` (after `cards.css`). Bun bundles only JS; CSS must be loaded via `<link>` tags
- [ ] Update `tugdeck/src/main.ts`: replace `import { DeckManager }` with `import { PanelManager }`; instantiate `new PanelManager(container, connection)` instead of `new DeckManager(container, connection)`
- [ ] Update `tugdeck/src/main.ts`: change `conversationCard.setDeckManager(deck)` to `conversationCard.setDragState(deck)` and `terminalCard.setDeckManager(deck)` to `terminalCard.setDragState(deck)`
- [ ] Update `tugdeck/src/cards/conversation-card.ts`: replace `import type { DeckManager } from "../deck"` with `import type { IDragState } from "../drag-state"`; rename `setDeckManager(dm: DeckManager)` to `setDragState(ds: IDragState)`; change field type from `DeckManager` to `IDragState`; update `this.deckManager?.isDragging` references to use the new field name
- [ ] Update `tugdeck/src/cards/terminal-card.ts`: replace `import type { DeckManager } from "../deck"` with `import type { IDragState } from "../drag-state"`; rename `setDeckManager(dm: DeckManager)` to `setDragState(ds: IDragState)`; change field type from `DeckManager` to `IDragState`; update `this.deckManager?.isDragging` references to use the new field name
- [ ] **Geometric minimum enforcement (L01.7, geometric layer):** After every `renderTree()` call, PanelManager walks the rendered DOM and checks each docked container's pixel dimensions via `getBoundingClientRect()`. If any container is under 100px in either dimension, PanelManager adjusts the parent SplitNode's weights to redistribute space and re-renders. This runs after tree mutations, deserialization, sash release, and window resize
- [ ] Implement `handleResize()` calling `onResize` on all mounted cards when their container dimensions change
- [ ] Wire `ResizeObserver` on each card container for accurate resize detection
- [ ] Remove `tugdeck/src/__tests__/deck-layout.test.ts` (tests v1-to-v2 migration and CSS Grid layout assumptions that no longer apply; replaced by Step 0's layout-tree and serialization tests covering v2-to-v3 migration)
- [ ] Add a temporary override in `panels.css` to neutralize ConversationCard's negative-margin header hack (`margin: -8px -8px 0 -8px` in `.card-header`). Override: `.panel-card-container .card-header { margin: 0; }`. This override is removed in Step 5 when self-created headers are deleted

**Tests:**
- [ ] Integration test: PanelManager renders the default layout with five cards visible
- [ ] Unit test: sash drag recalculates weights correctly
- [ ] Unit test: sash enforces minimum 100px size
- [ ] Integration test: frame dispatch delivers to correct card instances via manager-level fan-out
- [ ] Unit test: IDragState.isDragging reflects PanelManager drag state
- [ ] Unit test: removeCard removes card from feed dispatch sets (no orphaned callbacks)
- [ ] Unit test: geometric layout pass adjusts weights when a container is under 100px

**Checkpoint:**
- [ ] `bun build` succeeds with zero TypeScript errors (no type-cascade from DeckManager removal)
- [ ] All five cards render in the default layout when loaded in browser
- [ ] Sash resizing between cards works in both horizontal and vertical orientations
- [ ] Layout saves to localStorage and restores on reload
- [ ] ConversationCard `scrollToBottom` still suppresses during drag (via IDragState)
- [ ] TerminalCard `fitAddon.fit()` still suppresses during drag (via IDragState)
- [ ] `bun test` passes (deck-layout.test.ts removed; remaining tests unaffected)

**Rollback:** Revert commit; restore DeckManager import in `main.ts` and card files; remove `drag-state.ts`.

**Commit after all checkpoints pass.**

---

#### Step 2: Tab Groups {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add tab groups with tab bar rendering, reorder, and close`

**References:** [D01] Layout tree with SplitNode and TabNode, [D06] Hybrid header bar construction, Spec S01, Spec S03, (#data-model, #specification)

**Artifacts:**
- `tugdeck/src/tab-bar.ts` -- TabBar class: renders tab strip, handles click to switch active tab, drag to reorder, close button
- Updated `tugdeck/src/panel-manager.ts` -- Integrate tab bar into TabNode rendering
- Updated `tugdeck/styles/panels.css` -- Tab bar styles (active/inactive tabs, close button, hover states)

**Tasks:**
- [ ] Create `tugdeck/src/tab-bar.ts` with `TabBar` class
- [ ] Render tab strip: one tab element per TabItem in the TabNode, horizontally arranged
- [ ] Active tab: `color: var(--foreground)`, `border-bottom: 2px solid var(--accent)`
- [ ] Inactive tab: `color: var(--muted-foreground)`
- [ ] Tab close button: `X` icon, visible on hover, color transitions from `var(--muted-foreground)` to `var(--destructive)`
- [ ] **Tab switching preserves instance identity ([D09]):** Click tab to switch active tab -- update `activeTabIndex`, set the previously active card's container to `display: none`, then set the newly active card's container to `display: block`. Inactive tabs remain mounted in the DOM; their card instances are NOT destroyed. This preserves terminal scrollback, conversation state, streaming state, etc.
- [ ] **Mandatory onResize on tab activation:** After setting the newly active card's container to `display: block`, immediately call `card.onResize(containerWidth, containerHeight)` with the container's current dimensions. This is required because cards hidden with `display: none` have zero-size dimensions; xterm.js FitAddon, conversation scroll position, and other size-dependent logic will not recover without an explicit resize notification. Use `getBoundingClientRect()` on the container to get the current dimensions after the display change
- [ ] Implement tab drag-reorder within the tab bar using pointer events. Reordering reparents tab elements in the DOM; card instances are preserved
- [ ] **Tab close destroys the card instance:** Close (X button) removes the tab from the TabNode, calls `removeCard(card)` on PanelManager (which calls `card.destroy()` and removes from feed dispatch sets), and runs `removeTab` if it was the last tab
- [ ] When active tab is closed, activate the next tab (or previous if last)
- [ ] Update PanelManager to create a TabBar for every TabNode with more than one tab
- [ ] Ensure single-tab TabNodes show no tab bar (card fills the entire area)

**Tests:**
- [ ] Unit test: clicking a tab switches the active card (previous card hidden, not destroyed)
- [ ] Unit test: activating a hidden tab calls card.onResize() with correct container dimensions
- [ ] Unit test: closing a tab calls card.destroy() and removes it from feed dispatch
- [ ] Unit test: closing the last tab removes the TabNode from the tree
- [ ] Unit test: drag-reorder updates tab order in the TabNode
- [ ] Integration test: two cards tabbed together switch correctly on tab click; inactive card retains state

**Checkpoint:**
- [ ] Tab bar renders correctly for multi-tab groups
- [ ] Tab switching hides/shows cards correctly (inactive cards remain alive)
- [ ] TerminalCard re-activates correctly after being hidden (xterm.js grid dimensions recalculated via onResize)
- [ ] Tab close destroys card and tree normalizes properly

**Rollback:** Revert commit; tab bar code is additive.

**Commit after all checkpoints pass.**

---

#### Step 3: Drag-and-Drop Dock Targeting {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): add drag-and-drop dock targeting with zone detection and overlay`

**References:** [D03] Pointer-event ghost for drag, [D04] Lumino-style zone detection, [D09] Instance identity preservation, Spec S05, Table T01, (#zone-detection-algorithm, #specification, #d09-instance-identity)

**Artifacts:**
- `tugdeck/src/dock-target.ts` -- `computeDropZone()` function, `DockOverlay` class
- Updated `tugdeck/src/tab-bar.ts` -- Tab drag initiates dock targeting when dragged outside tab bar
- Updated `tugdeck/src/panel-manager.ts` -- Integrates drag lifecycle (start, move, drop, cancel)
- Updated `tugdeck/styles/panels.css` -- Overlay styles, drag ghost styles

**Tasks:**
- [ ] Create `tugdeck/src/dock-target.ts` with `computeDropZone(cursorX, cursorY, canvasRect, layoutTree)` function
- [ ] Implement zone detection with strict precedence: (P1) root edge test runs first and takes absolute priority (40px threshold); corner overlap resolves to closer edge, tie breaks to horizontal; (P2) tab-bar zone beats widget zones; (P3) closest edge wins for widget zones, ties resolved by larger distance from center
- [ ] Implement TabNode hit test via `getBoundingClientRect()` on TabNode DOM elements
- [ ] Implement zone-within-target computation by edge proximity with precedence rules
- [ ] Create `DockOverlay` class: single `<div>`, absolutely positioned, `pointer-events: none`, `background: var(--accent)` at 20% opacity, `border: 2px solid var(--accent)`
- [ ] Implement overlay geometry computation per zone (Table T01)
- [ ] Add 100ms hide delay to prevent flicker on zone boundary crossing
- [ ] Implement drag ghost: on `pointerdown` on a tab, clone the tab element as a floating ghost tracking cursor
- [ ] In PanelManager, wire drag lifecycle: pointerdown starts drag, pointermove updates zone detection + overlay, pointerup executes drop
- [ ] **On drop: reparent the card DOM element ([D09]).** Call `insertNode` to mutate the tree, then re-render. The card's existing DOM is moved to the new container via `appendChild`; the card instance is never destroyed and recreated. Card state (terminal scrollback, conversation messages, streaming state) is fully preserved across dock operations
- [ ] On cancel (Escape key or drag release outside any zone): reparent card back to original position
- [ ] When dragging a tab out of a multi-tab group, remove it from the source TabNode (tab is removed, but card instance is preserved and moved)

**Tests:**
- [ ] Unit test: computeDropZone returns root-left when cursor is within 40px of left edge
- [ ] Unit test: computeDropZone returns root zone even when cursor is over a TabNode (P1 priority)
- [ ] Unit test: computeDropZone returns tab-bar when cursor is within tab bar height (P2 beats widget)
- [ ] Unit test: computeDropZone returns widget-left/right/top/bottom based on edge proximity
- [ ] Unit test: computeDropZone resolves corner tie deterministically (P3 rule)
- [ ] Unit test: overlay geometry matches Table T01 for each zone type
- [ ] Integration test: dragging a tab to a different card's area creates a split; card state preserved
- [ ] Integration test: dragging a tab to another card's tab bar creates a tab group; card state preserved

**Checkpoint:**
- [ ] Drag-and-drop produces correct tree mutations
- [ ] Blue overlay displays correct geometry during drag
- [ ] 60fps maintained during drag (Chrome DevTools Performance panel)

**Rollback:** Revert commit; dock targeting is additive.

**Commit after all checkpoints pass.**

---

#### Step 4: Floating Panels {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): add floating panels with undock, re-dock, move, resize, z-order`

**References:** [D01] Layout tree with SplitNode and TabNode, [D03] Pointer-event ghost for drag, [D09] Instance identity preservation, Spec S01, Spec S02, Spec S07, (#data-model, #specification, #d09-instance-identity, #deserialization-validation)

**Artifacts:**
- `tugdeck/src/floating-panel.ts` -- FloatingGroup DOM rendering, move/resize drag, z-order management
- Updated `tugdeck/src/panel-manager.ts` -- Manages `floating[]` array in DockState; floating panel lifecycle
- Updated `tugdeck/src/dock-target.ts` -- When cursor leaves all dock zones, transition to floating
- Updated `tugdeck/styles/panels.css` -- Floating panel chrome (shadow, border, resize handles)

**Tasks:**
- [ ] Create `tugdeck/src/floating-panel.ts` with floating panel DOM rendering
- [ ] Floating panel container: `position: absolute`, `background: var(--card)`, `border: 1px solid var(--border)`, `box-shadow: 0 8px 24px rgba(0,0,0,0.4)`
- [ ] **Temporary minimal title bar:** A plain draggable `<div>` with only the card title text (no icon, no menu button, no collapse, no close button). This is NOT the full CardHeader -- CardHeader does not exist yet (created in Step 5). The title bar is purely functional: enough to identify the card and drag the floating panel around. It is styled with `height: 28px`, `cursor: grab`, `background: var(--muted)`, `color: var(--foreground)`, `font-size: 12px`, `padding: 0 8px`, `line-height: 28px`. Step 5 replaces this temporary title bar with the full CardHeader for both docked and floating panels
- [ ] Resize: all four edges and four corners are drag targets (8px hit area). Enforce 100px minimum on resize (invariant L01.7)
- [ ] Move: drag title bar updates `position.x/y`
- [ ] Z-order: clicking a floating panel raises it (`z-index` management)
- [ ] **Undocking reparents the card DOM ([D09]):** When cursor leaves all dock zones during drag, the card's DOM element is moved from its docked container into a new floating panel container via `appendChild`. The card instance is NOT destroyed; terminal scrollback, conversation state, etc. are fully preserved
- [ ] **Re-docking reparents the card DOM ([D09]):** Dragging a floating panel's title bar over a dock zone reparents the card from the floating container back into the docked tree. Standard drop-targeting applies. Card instance is preserved
- [ ] Integrate floating panels into serialization (already in SerializedDockState). On deserialize, `validateDockState()` (Spec S07) clamps floating panel positions to canvas bounds and sizes to 100px minimum
- [ ] PanelManager renders floating panels as children of the canvas element

**Tests:**
- [ ] Unit test: undocking a tab creates a FloatingGroup at cursor position; card instance preserved
- [ ] Unit test: re-docking a floating panel removes it from floating array and inserts into tree; card instance preserved
- [ ] Unit test: floating panel z-order updates on click
- [ ] Integration test: floating panel persists position/size through save/load cycle
- [ ] Integration test: move and resize stay within canvas bounds
- [ ] Unit test: floating panel loaded with off-canvas position is clamped to visible bounds
- [ ] Unit test: floating panel loaded with sub-100px size is clamped to 100px

**Checkpoint:**
- [ ] Cards can be undocked to floating panels by dragging away from dock zones
- [ ] Floating panels can be re-docked by dragging over dock zones
- [ ] Floating panel move, resize, and z-order work correctly
- [ ] Layout with floating panels saves and restores from localStorage

**Rollback:** Revert commit; floating panel code is additive.

**Commit after all checkpoints pass.**

---

#### Step 5: Card Header Bar, DropdownMenu, and Permission Mode Migration {#step-5}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): add card header bar with dropdown menu, migrate permission mode`

**References:** [D06] Hybrid header bar construction, [D09] Instance identity preservation, Spec S03, Risk R01, Table T02, (#card-header-menus, #specification, #r01-container-assumptions)

**Artifacts:**
- `tugdeck/src/card-header.ts` -- CardHeader class: constructs header DOM from TugCardMeta
- `tugdeck/src/card-menu.ts` -- DropdownMenu class: generic positioned dropdown (created here so permission mode can use it immediately)
- Updated `tugdeck/src/cards/card.ts` -- Add `TugCardMeta` and `CardMenuItem` interfaces; add optional `meta` to TugCard
- Updated card implementations -- Add `meta` property to all five cards; remove self-created `.card-header` elements; ConversationCard includes permission mode `CardMenuItem`
- Updated `tugdeck/src/panel-manager.ts` -- Construct CardHeader for each mounted card (docked and floating)
- Updated `tugdeck/src/floating-panel.ts` -- Replace temporary minimal title bar with full CardHeader
- Updated `tugdeck/styles/panels.css` -- Header bar styles, dropdown menu styles (popover bg, border, shadow, items, hover)
- Updated `tugdeck/styles/cards.css` -- Remove `.card-header` negative-margin hack and `.collapse-btn` styles

**Tasks:**
- [ ] Create `tugdeck/src/card-menu.ts` with `DropdownMenu` class (created in this step so the permission mode menu item works immediately)
- [ ] Menu container: `background: var(--popover)`, `color: var(--popover-foreground)`, `border: 1px solid var(--border)`, `box-shadow: 0 4px 12px rgba(0,0,0,0.3)`
- [ ] Menu items: action items (click to execute), toggle items (checkbox), select items (submenu or radio group)
- [ ] Dismiss on click-outside or Escape key
- [ ] Position below the menu button, clamp to viewport edges
- [ ] Create `tugdeck/src/card-header.ts` with `CardHeader` class
- [ ] Header structure: icon (Lucide) + title (12px, uppercase, 600 weight) + spacer + menu button + collapse button + close button
- [ ] Menu button: `EllipsisVertical` Lucide icon -- click opens DropdownMenu with the card's `meta.menuItems`
- [ ] Collapse button: `Minus` icon (docked only) -- toggles card content visibility (28px collapsed height). This is a runtime-only UI toggle, not persisted in serialization
- [ ] Close button: `X` icon -- calls `removeCard(card)` on PanelManager (which calls `card.destroy()`) and removes from tree. Close is always enabled, even for the last instance of a component type. Closing all cards results in an empty canvas; users add cards back via the Tug menu (Step 7)
- [ ] Add `TugCardMeta` and `CardMenuItem` interfaces to `cards/card.ts`
- [ ] **ConversationCard (atomic permission-mode migration):** Add `meta` property with title "Conversation", icon "MessageSquare", closable true. The `menuItems` array includes ONE item: Permission mode as a `"select"` type `CardMenuItem` with options `["default", "acceptEdits", "bypassPermissions", "plan"]`, default `"acceptEdits"`, and an action callback that captures `this.connection` and sends `{ type: "permission_mode", mode }` via `connection.send(FeedId.CONVERSATION_INPUT, payload)`. **Remove the self-created `.card-header` DOM** including the `<select>` element and the title `<span>`. The permission mode functionality is preserved with zero gap -- the old `<select>` is removed and the new `CardMenuItem` replaces it in the same step. The remaining Conversation menu items (New session, Export history) are added in Step 6
- [ ] Note: the `margin: -8px -8px 0 -8px` on `.card-header` in `cards.css` was a hack to counteract `.card-slot` padding; since Step 1 containers have zero padding and this step removes the self-created header, this hack is eliminated naturally. Remove the CSS rule
- [ ] Update TerminalCard: add `meta` property with title "Terminal", icon "Terminal", closable true, empty menuItems (populated in Step 6)
- [ ] Update GitCard: add `meta` property with title "Git", icon "GitBranch", closable true, empty menuItems; remove self-created header DOM
- [ ] Update FilesCard: add `meta` property with title "Files", icon "FolderOpen", closable true, empty menuItems; remove self-created header DOM
- [ ] Update StatsCard: add `meta` property with title "Stats", icon "Activity", closable true, empty menuItems; remove self-created header DOM
- [ ] PanelManager creates CardHeader for each docked card, inserting it above the card's mount area
- [ ] **Upgrade floating panel headers:** Replace the temporary minimal title bar (plain draggable div from Step 4) with the full CardHeader in all floating panels. The CardHeader provides the same drag-to-move functionality via its title area, plus icon, menu button, collapse, and close. Update `floating-panel.ts` to use CardHeader instead of the temporary title bar
- [ ] Remove `.card-header` styles from `cards.css` (the `margin: -8px -8px 0 -8px` hack and related rules). Also remove the Step 1 temporary override `.panel-card-container .card-header { margin: 0; }` from `panels.css` (no longer needed). Header styling is now in `panels.css` via CardHeader

**Tests:**
- [ ] Unit test: CardHeader renders correct icon, title, and buttons from meta
- [ ] Unit test: collapse button toggles card content visibility
- [ ] Unit test: close button removes card, calls destroy, and normalizes tree
- [ ] Unit test: DropdownMenu opens on click and closes on click-outside
- [ ] Unit test: DropdownMenu closes on Escape key
- [ ] Unit test: ConversationCard permission mode menu item sends correct IPC message on selection
- [ ] Unit test: floating panel uses full CardHeader (not temporary title bar) after Step 5
- [ ] Integration test: all five cards display correct header metadata (both docked and floating)

**Checkpoint:**
- [ ] All docked cards show consistent header bars with icon, title, and action buttons
- [ ] All floating panels show full CardHeader (temporary title bar replaced)
- [ ] Collapse/expand works for all docked cards
- [ ] Close removes the card from the layout (works even for the last instance of a component type)
- [ ] No visual artifacts from removed negative-margin hack (verify ConversationCard header renders flush)
- [ ] ConversationCard permission mode works via the dropdown menu (send a permission_mode message and verify it arrives)

**Rollback:** Revert commit; restore self-created headers in card files.

**Commit after all checkpoints pass.**

---

#### Step 6: Remaining Per-Card Menus {#step-6}

**Depends on:** #step-5

**Commit:** `feat(tugdeck): add per-card menus for all cards`

**References:** [D06] Hybrid header bar construction, Spec S03, Table T02, (#card-header-menus, #specification)

Note: The DropdownMenu class and CardHeader menu button wiring were created in Step 5. ConversationCard's Permission mode menu item was also added in Step 5 as part of the atomic migration. This step adds the remaining menu items for all five cards.

**Artifacts:**
- Updated card implementations -- Populate remaining menuItems in meta (Terminal, Git, Files, Stats, Conversation)

**Tasks:**
- [ ] Terminal card: add Font size (S/M/L select), Clear scrollback (action), WebGL on/off (toggle) menu items
- [ ] Git card: add Refresh now (action), Show/hide untracked (toggle) menu items
- [ ] Files card: add Clear history (action), Max entries (50/100/200 select) menu items
- [ ] Stats card: add Sparkline timeframe (30s/60s/120s select), Show/hide sub-cards (toggle) menu items
- [ ] Conversation card: add New session (action) and Export history (action) menu items (Permission mode already added in Step 5)

**Tests:**
- [ ] Unit test: action items fire their callback on click
- [ ] Unit test: toggle items update their value on click
- [ ] Unit test: select items update and fire callback with selected value
- [ ] Integration test: each card's menu items are correct per Table T02

**Checkpoint:**
- [ ] Each card's menu button opens the correct dropdown menu with all items per Table T02
- [ ] Menu items execute their actions correctly
- [ ] Terminal Font size changes xterm.js font size
- [ ] Git Refresh triggers a data fetch
- [ ] Conversation New session sends the appropriate IPC

**Rollback:** Revert commit; menu item additions are additive.

**Commit after all checkpoints pass.**

---

#### Step 7: Tug Menu and Multi-Instance Cards {#step-7}

**Depends on:** #step-4, #step-6

**Commit:** `feat(tugdeck): add tug menu, multi-instance cards, save/load/reset layout`

**References:** [D07] Multi-instance card support with feed fan-out, [D09] Instance identity preservation, [D10] Manager-level fan-out, [D02] Version 3 serialization with v2 migration, Spec S02, Spec S07, Table T03, (#tug-menu-items, #default-layout, #s02-serialization-types, #deserialization-validation, #d09-instance-identity, #d10-manager-fanout)

**Artifacts:**
- `tugdeck/src/tug-menu.ts` -- TugMenu class: logo button, dropdown with add-card, reset, save/load
- Updated `tugdeck/src/panel-manager.ts` -- Multi-instance card creation; layout preset management
- Updated `tugdeck/src/serialization.ts` -- Named preset save/load in localStorage
- Updated `tugdeck/styles/panels.css` -- Tug menu button and dropdown styles

**Tasks:**
- [ ] Create `tugdeck/src/tug-menu.ts` with `TugMenu` class
- [ ] Tug button: `position: absolute`, top-right corner of canvas, `z-index` above all panels; uses tug logo SVG at 24x24
- [ ] Dropdown menu uses DropdownMenu from card-menu.ts
- [ ] Add card items: create new card instance with unique `id` via `crypto.randomUUID()`, call `addCard(card)` on PanelManager (which adds to the internal `Map<FeedId, Set<TugCard>>` fan-out sets per [D10]), and add as a floating panel at canvas center
- [ ] **Multi-instance feed fan-out ([D10]):** The manager-level fan-out established in Step 1 already supports multiple card instances per feedId. Adding a new card instance calls `addCard(card)` which adds to the existing sets. The single connection callback per feedId iterates the set and delivers to all instances. No new connection callbacks are registered
- [ ] Reset layout: call `removeCard(card)` on ALL current cards (which calls `card.destroy()` on each), clear the layout tree, call `buildDefaultLayout()`, create the default five cards, and `addCard` each. This is the one case where card instances are intentionally destroyed ([D09])
- [ ] Save layout as: prompt for name (simple `window.prompt`), save to `tugdeck-layouts` localStorage key as named JSON entry. **Preset schema:** Presets use the same v3 `SerializedDockState` format with no independent version number. If the schema changes, all presets migrate together
- [ ] Load layout: show submenu of saved preset names, load selected. Call `removeCard` on all current cards (destroys them), deserialize the preset (which runs `validateDockState()` per Spec S07 for off-canvas clamping and minimum-size enforcement), rebuild card instances from the deserialized tree, and `addCard` each
- [ ] About tugdeck: show version info in a simple alert or popover

**Tests:**
- [ ] Unit test: adding a card creates a new floating panel with the correct componentId
- [ ] Unit test: feed fan-out delivers frames to all instances with matching feedId (via manager-level dispatch)
- [ ] Unit test: reset layout destroys all cards and produces the default five-card arrangement
- [ ] Unit test: after reset, no orphaned card instances remain in the feed dispatch sets
- [ ] Unit test: save/load layout round-trips correctly via localStorage
- [ ] Unit test: loaded preset runs validateDockState (off-canvas and minimum-size clamping)
- [ ] Integration test: two terminal cards simultaneously receive terminal feed frames
- [ ] Golden test: v2 layout migrates to v3 and renders the same visual arrangement

**Checkpoint:**
- [ ] Tug menu button is visible and functional in top-right corner
- [ ] Adding a new card creates a floating panel
- [ ] Multiple instances of the same card type receive feed frames independently
- [ ] Reset layout restores default (all previous cards destroyed, no leaks)
- [ ] Save/load layout presets work correctly (including off-canvas clamping)
- [ ] Full end-to-end: start with no saved state, use the panel system, save, reload, layout persists

**Rollback:** Revert commit; tug menu code is additive.

**Commit after all checkpoints pass.**

---

### 8.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A complete dockable panel system replacing the fixed CSS Grid, where cards can be docked, tabbed, floated, resized, and managed through a tug logo menu, with full layout persistence and multi-instance support.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Cards can be dragged from one dock zone to another (manual test)
- [ ] Cards can be tabbed together by dropping on a tab bar (manual test)
- [ ] Cards can be floated by dragging away from all dock zones (manual test)
- [ ] Floating cards can be re-docked by dragging over a dock zone (manual test)
- [ ] Sash resizing works between all adjacent siblings in any split orientation (manual test)
- [ ] Blue overlay shows correct geometry for all zone types during drag (manual test)
- [ ] Tab close removes the card; last-tab-close removes the TabNode and cleans the tree (unit test + manual test)
- [ ] Card header menus open and dismiss correctly (manual test)
- [ ] Tug menu adds new card instances as floating panels (manual test)
- [ ] Layout persists to localStorage and restores correctly on reload (integration test)
- [ ] v2 layouts migrate to v3 without breaking (golden test)
- [ ] Reset layout restores default arrangement (integration test)
- [ ] Multiple instances of the same card type coexist and receive independent feed frames (integration test)
- [ ] Drag overlay maintains 60fps (Chrome DevTools Performance panel)
- [ ] Layout save/restore round-trip completes in less than 50ms (`performance.now()` measurement)

**Acceptance tests:**
- [ ] Golden test: v2 migration fixture produces expected v3 layout JSON
- [ ] Unit test: full topology normalization test suite passes
- [ ] Integration test: PanelManager renders all five cards in default layout
- [ ] Unit test: feed fan-out delivers to multiple card instances

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Keyboard-only docking (accessibility)
- [ ] Screen-reader labels for all panel system elements (accessibility)
- [ ] Contrast verification for all panel chrome against WCAG AA (accessibility)
- [ ] Layout sync across devices (server-side storage)
- [ ] Animated transitions for dock/undock/tab-switch operations
- [ ] Custom card creation API for third-party extensions

| Checkpoint | Verification |
|------------|--------------|
| Layout tree logic | `bun test` -- all unit tests for layout-tree.ts and serialization.ts |
| Tree renderer | Five cards render in default layout; sash resize works |
| Tab groups | Multi-tab groups switch correctly; close works |
| Dock targeting | Drag-and-drop produces correct mutations; overlay correct |
| Floating panels | Undock/re-dock/move/resize all work; persists through save/load |
| Card headers | All five cards show correct header metadata |
| Card menus | All menus open, dismiss, execute actions |
| Tug menu + multi-instance | Add cards works; feed fan-out works; save/load/reset works |

**Commit after all checkpoints pass.**
