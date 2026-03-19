<!-- tugplan-skeleton v2 -->

## React Foundation Cleanup {#react-foundation-cleanup}

**Purpose:** Eliminate all vanilla JS from the tugdeck UI layer, unify rendering under a single React root with React synthetic events for all pointer interactions, and replace every native HTML control with shadcn -- establishing a clean foundation for a custom Tug design system.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | react-foundation-cleanup |
| Last updated | 2026-02-28 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The React + shadcn migration (roadmap/react-shadcn-adoption.md) is partially complete. Phases 0-4 are done: all card content renders as React JSX inside CardContextProvider, shadcn UI components are installed and used inside cards, Tailwind v4 is the styling framework, and the token bridge works. But the chrome layer -- CardFrame, CardHeader, CardMenu, Dock, TabBar -- and canvas overlays (guide lines, sashes, flash overlays) remain vanilla JS, creating a hybrid architecture with CustomEvent bridges between vanilla and React code.

This hybrid state is blocking further design system work. Six vanilla files (card-frame.ts at 340 lines, card-header.ts at 245 lines, card-menu.ts at 185 lines, dock.ts at 290 lines, tab-bar.ts at 183 lines, plus deck-manager.ts at ~800 lines of render/overlay code) use raw document.createElement, manual addEventListener, and direct DOM style mutation. Six distinct CustomEvent channels bridge data between vanilla and React. Native HTML controls (checkbox inputs, DIV-based selects) appear in card-menu.ts. This debt must be retired before building a coherent design system.

#### Strategy {#strategy}

- Convert chrome components bottom-up: CardMenu first (standalone, consumed by CardHeader and Dock), then CardHeader, CardFrame, TabBar, and Dock
- Unify into a single React root: DeckCanvas owns the entire React tree including card content, eliminating per-card createRoot calls in ReactCardAdapter
- Replace all pointer event wiring (drag, resize, sash drag, tab reorder) with React synthetic events using pointer capture
- Use refs for style mutations during drag/resize to avoid React re-renders on every pointermove; commit final geometry to state on pointerup
- Delete vanilla test files alongside their vanilla classes; write new RTL tests for each React replacement in the same step
- Introduce DevNotificationContext at the app root to replace td-dev-notification, td-dev-build-progress, and td-dev-badge CustomEvents
- Consolidate CSS last: move cards-chrome.css rules to Tailwind utilities on React components, keeping only necessary rules (resize handle hit areas, snap guides) in a minimal chrome.css

#### Success Criteria (Measurable) {#success-criteria}

- Zero vanilla `document.createElement` calls in the UI layer (verify: `grep -r "document.createElement" tugdeck/src/ --include="*.ts" --include="*.tsx"` returns only test setup files)
- Zero `addEventListener` calls in the UI layer (verify: `grep -r "addEventListener" tugdeck/src/ --include="*.ts" --include="*.tsx"` returns only xterm.js integration in terminal-card.tsx, setup-rtl.ts, and acceptable global keyboard shortcuts in useEffect with cleanup)
- Zero native HTML controls -- no `<input type="checkbox">`, no DIV-based selects (verify: card-menu.ts deleted, shadcn DropdownMenuCheckboxItem and DropdownMenuRadioGroup used instead)
- Zero CustomEvent bridges between vanilla and React (verify: `grep -r "CustomEvent" tugdeck/src/ --include="*.ts" --include="*.tsx"` returns only td-hmr-update self-dispatch in developer-card.tsx and td-theme-change dispatch in useTheme.ts)
- One React root for the entire canvas (verify: `grep -r "createRoot" tugdeck/src/` returns exactly one call in the DeckManager initialization path)
- All existing `bun test` tests pass plus new RTL tests for each converted component (verify: `cd tugdeck && bun test`)
- Card drag, resize, sash drag, and tab reorder all function correctly with React synthetic events (verify: manual smoke test)

#### Scope {#scope}

1. Convert card-menu.ts to a CardDropdownMenu React component using shadcn DropdownMenu
2. Convert card-header.ts to a CardHeader React component with lucide-react icons
3. Convert card-frame.ts to a CardFrame React component with React pointer events for drag and resize
4. Convert tab-bar.ts to a TabBar React component with React pointer events for drag-reorder
5. Convert dock.ts to a Dock React component with lucide-react icons and CardDropdownMenu
6. Unify DeckManager rendering into a single React root via a DeckCanvas component
7. Convert canvas overlays (guide lines, sashes, flash overlays) to React components
8. Clean up remaining CustomEvent bridges: disconnect banner, action-dispatch, terminal-card theme listener
9. Consolidate CSS: replace cards-chrome.css and dock.css with Tailwind utilities plus a minimal chrome.css

#### Non-goals (Explicitly out of scope) {#non-goals}

- Converting DeckManager itself to a React component (it remains a TypeScript class that owns a React root)
- Introducing a third-party state management library (Zustand, Jotai, Redux) -- shared state uses React context or existing module-level patterns
- Redesigning the card layout system (snap.ts, layout-tree.ts, serialization.ts stay as-is)
- Building the custom Tug design system (that is the follow-on phase)
- Modifying connection.ts WebSocket lifecycle logic (only the disconnect banner DOM moves to React)
- Touching pure-function modules with no DOM dependencies (snap.ts, layout-tree.ts, serialization.ts, protocol.ts)

#### Dependencies / Prerequisites {#dependencies}

- shadcn DropdownMenu component already installed at `tugdeck/src/components/ui/dropdown-menu.tsx` (Radix-based, includes DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem)
- bun test + happy-dom + RTL setup validated by scaffold.test.tsx
- All card content already renders as React (ConversationCard, TerminalCard, GitCard, FilesCard, StatsCard, SettingsCard, DeveloperCard, AboutCard)
- Tailwind v4 and token bridge operational

#### Constraints {#constraints}

- Performance: during drag/resize, CardFrame must use ref-based style mutations (no React re-render per pointermove). React re-renders only on structural changes (panel add/remove/reorder, tab switch)
- CSS class names used as test selectors (.card-frame, .card-header-title, etc.) are preserved on React components during migration so that deck-manager.test.ts integration tests that query by CSS class continue to pass
- The lucide package (vanilla) is replaced by lucide-react for all icon rendering in the chrome layer
- dock.css (65 lines) is fully deleted as part of the Dock conversion; cards-chrome.css (404 lines) is deleted or reduced to a minimal chrome.css in the CSS consolidation step

#### Assumptions {#assumptions}

- DeckManager retains ownership of a single React root and re-renders the canvas by calling root.render() when layout state changes; it is not itself converted to a React component in this phase
- The bun test + happy-dom + RTL setup already validated by scaffold.test.tsx is the target test environment for all new React component tests
- No new third-party state management library is introduced; shared state uses React context or module-level patterns already present in the codebase
- ReactCardAdapter becomes a config object (no createRoot of its own) once the unified single-root architecture is in place
- The td-hmr-update CustomEvent (developer-card dispatching to itself) is acceptable and not eliminated -- it does not cross a vanilla/React boundary
- The conversation-card.tsx `document.addEventListener("keydown")` inside useEffect with cleanup is a standard React pattern for global keyboard shortcuts and is acceptable

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit, named anchors and rich References lines per the skeleton contract.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Single-root card mounting strategy (DECIDED) {#q01-card-mounting}

**Question:** How do card components mount into the unified React tree when DeckManager currently mounts them via ReactCardAdapter.mount(container)?

**Why it matters:** The current architecture has each ReactCardAdapter calling createRoot() on its mount container. A unified single root requires a different card content mounting strategy.

**Options (if known):**
- Option A: CardFrame renders a portal into a card content div, and ReactCardAdapter provides the component to render via a config
- Option B: DeckCanvas receives card component factories as props and renders them directly inside CardFrame

**Plan to resolve:** Addressed in Step 6 design.

**Resolution:** DECIDED (see [D04]). ReactCardAdapter becomes a config object that specifies the component, feedIds, and initialMeta. DeckCanvas renders all card content directly. The adapter no longer calls createRoot.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Drag/resize perf regression | high | low | Ref-based style mutations during drag; React re-render only on structural changes | Frame drops visible during card drag |
| happy-dom pointer event support gaps | med | med | Verify pointer capture APIs in happy-dom; fall back to fireEvent.pointerDown/Move/Up patterns | First RTL test with pointer events fails |
| Radix DropdownMenu portal conflicts | low | low | shadcn DropdownMenu already working in card content; chrome layer uses same Portal | Menu appears behind panels or is clipped |
| Large Step 6 (single root unification) | med | med | Clear dependency on Steps 3, 4, 5 being complete and tested first; break Step 6 into card-factory-config + DeckCanvas + ReactCardAdapter-simplification tasks | Step 6 estimate exceeds 2 days |

**Risk R01: Drag/resize performance regression** {#r01-perf-regression}

- **Risk:** Moving from direct DOM style mutation to React synthetic events could introduce frame drops during card drag/resize if React re-renders on every pointermove.
- **Mitigation:**
  - CardFrame uses useRef for the root element and mutates style.left/top/width/height directly during drag
  - onPointerMove handlers read from refs and write to refs -- no setState calls during drag
  - Final geometry committed to parent via callback on onPointerUp, triggering a single re-render
  - Same ref-based pattern for VirtualSash drag
- **Residual risk:** Initial implementation may have subtle re-render triggers; profiling needed during smoke testing.

**Risk R02: happy-dom pointer event limitations** {#r02-happy-dom-pointer}

- **Risk:** happy-dom may not fully support setPointerCapture/releasePointerCapture, making RTL tests for drag behavior incomplete.
- **Mitigation:**
  - Test the mechanical aspects (handler wired, callback fired) rather than pixel-perfect drag trajectories
  - Mock setPointerCapture/releasePointerCapture if needed
  - Manual smoke testing covers the full drag/resize interaction
- **Residual risk:** Some pointer capture edge cases only testable in a real browser.

---

### Design Decisions {#design-decisions}

#### [D01] shadcn DropdownMenu replaces vanilla card-menu.ts (DECIDED) {#d01-shadcn-dropdown}

**Decision:** Replace the vanilla DropdownMenu class (card-menu.ts) with a CardDropdownMenu React component built on shadcn's DropdownMenu (Radix-based).

**Rationale:**
- shadcn DropdownMenu is already installed and used in card content
- Radix provides built-in positioning, click-outside dismiss, Escape handling, keyboard navigation, and focus management -- all currently hand-coded in card-menu.ts
- DropdownMenuCheckboxItem replaces native `<input type="checkbox">` for toggle items
- DropdownMenuRadioGroup + DropdownMenuRadioItem replaces DIV-based select items
- Eliminates the last platform-native controls in the UI

**Implications:**
- CardMenuItem types (CardMenuAction, CardMenuToggle, CardMenuSelect, CardMenuSeparator) remain as the data model; CardDropdownMenu maps them to shadcn components
- CardHeader and Dock both consume CardDropdownMenu instead of instantiating the vanilla DropdownMenu class
- The `.card-dropdown-menu`, `.card-dropdown-item`, `.card-dropdown-separator`, `.card-dropdown-select-group`, `.card-dropdown-select-option` CSS rules in cards-chrome.css are deleted

#### [D02] React synthetic events for all pointer interactions (DECIDED) {#d02-react-pointer-events}

**Decision:** All pointer-driven interactions (card drag, card resize, sash drag, tab drag-reorder) use React onPointerDown/onPointerMove/onPointerUp with pointer capture via e.currentTarget.setPointerCapture(e.pointerId).

**Rationale:**
- React synthetic events provide consistent cross-browser behavior and integrate with React's event system
- Pointer capture works identically in React synthetic events: onPointerDown calls setPointerCapture, subsequent onPointerMove/onPointerUp fire on the capturing element
- The drag/resize math (boundary clamping, snap geometry, threshold detection) is 1:1 identical to current vanilla implementation
- Eliminates all addEventListener calls for pointer events in the chrome layer

**Implications:**
- CardFrame registers onPointerDown on the header element and resize handle elements
- During drag, position/size mutations use refs (no setState per pointermove)
- Snap callbacks (onMoving/onResizing) are passed as React props instead of constructor arguments
- VirtualSash uses the same pattern for sash drag

#### [D03] Ref-based style mutation during drag for performance (DECIDED) {#d03-ref-style-mutation}

**Decision:** During drag and resize operations, CardFrame and VirtualSash mutate element styles via React refs instead of triggering React state updates and re-renders.

**Rationale:**
- A naive setState on every pointermove would trigger React reconciliation on every frame, causing visible frame drops
- The current vanilla implementation directly sets element.style.left/top/width/height -- ref-based mutation preserves this performance characteristic
- React re-renders only when structural changes occur (panel add/remove, tab switch, key panel change) or on pointerup when final geometry is committed

**Implications:**
- CardFrame holds a useRef for its root element
- onPointerMove handlers compute new geometry and write directly to ref.current.style
- onPointerUp callback fires the parent's onMoveEnd/onResizeEnd with final geometry, which triggers a proper state update and React re-render
- Testing can verify callback arguments and final state rather than intermediate style values

#### [D04] Unified single React root with DeckCanvas (DECIDED) {#d04-single-react-root}

**Decision:** DeckManager creates one React root and renders a DeckCanvas component that owns the entire React tree, including CardFrame, TabBar, Dock, overlays, and card content. ReactCardAdapter becomes a config object (no createRoot of its own).

**Rationale:**
- User explicitly chose "one root, pure React data flow" over the multi-root alternative
- A single root enables true React context flow (DevNotificationContext, theme, connection) across the entire tree without CustomEvent bridges
- ReactCardAdapter currently calls createRoot for each card -- eliminating this simplifies the adapter to a config specifying component + feedIds + initialMeta
- DeckCanvas renders card content directly inside CardFrame, using the card config to instantiate the correct component

**Implications:**
- DeckManager calls this.reactRoot.render(<DeckCanvas ...props />) instead of imperatively creating CardFrame and TabBar instances
- Card content receives context from the single provider tree (no per-card CardContextProvider wrapping needed in the adapter)
- The card-meta-update CustomEvent is eliminated: card components call useCardMeta which updates state in the DeckCanvas tree, flowing down to CardHeader via props
- ReactCardAdapter.mount(), setCardFrame(), setActiveTab() methods are removed; the adapter becomes a plain config object
- DeckManager retains all state management (deckState, cardRegistry, cardsByFeed) and geometry logic; only the render path changes

#### [D05] DevNotificationContext replaces CustomEvent bridges (DECIDED) {#d05-dev-notification-context}

**Decision:** A new DevNotificationContext React context with a provider at the app root replaces the td-dev-notification, td-dev-build-progress, and td-dev-badge CustomEvent channels. The context is updated via a ref-based setter that action-dispatch.ts can call.

**Rationale:**
- User explicitly chose this approach for event routing
- action-dispatch.ts is non-React code that needs to push data into the React tree; a ref-based setter allows it to call a function that updates React state without being a React component itself
- DeveloperCard becomes a context consumer instead of calling document.addEventListener for CustomEvents
- Dock reads badge state from context instead of listening for td-dev-badge CustomEvents
- Eliminates 3 of the 6 CustomEvent channels (td-dev-notification, td-dev-build-progress, td-dev-badge)

**Implications:**
- A new file `tugdeck/src/contexts/dev-notification-context.tsx` defines the context and provider
- The provider exposes a ref-based setter: `devNotificationRef.current.notify(payload)` that updates React state
- action-dispatch.ts receives the ref during initialization and calls it instead of dispatching CustomEvents
- DeveloperCard uses `useContext(DevNotificationContext)` instead of document.addEventListener
- Dock uses `useContext(DevNotificationContext)` to read badge counts

#### [D06] Delete vanilla test files alongside vanilla classes (DECIDED) {#d06-test-migration}

**Decision:** When a vanilla class is deleted, its corresponding vanilla test file is deleted in the same step. New RTL tests for the React replacement are written in the same step.

**Rationale:**
- User explicitly chose this test strategy
- Keeping stale vanilla tests creates confusion about test coverage
- Writing RTL tests alongside the React conversion ensures coverage is never regressed
- The bun test + happy-dom + RTL setup (scaffold.test.tsx) is already validated

**Implications:**
- card-menu.ts deletion -> card-menus.test.ts deleted, new CardDropdownMenu RTL tests written
- card-header.ts deletion -> card-header.test.ts deleted, new CardHeader RTL tests written
- card-frame.ts deletion -> card-frame.test.ts deleted, new CardFrame RTL tests written
- tab-bar.ts deletion -> tab-bar.test.ts deleted, new TabBar RTL tests written
- dock.ts deletion -> dock.test.ts deleted, new Dock RTL tests written
- deck-manager.test.ts integration tests are updated (not deleted) to work with the new React rendering

#### [D07] lucide-react replaces vanilla lucide for chrome icons (DECIDED) {#d07-lucide-react}

**Decision:** All icon rendering in the chrome layer uses lucide-react components instead of vanilla lucide's createElement function.

**Rationale:**
- Card content already uses lucide-react
- Vanilla lucide createElement creates SVG DOM elements imperatively; lucide-react renders icons as React components
- Eliminates the ICON_MAP lookup table in card-header.ts; lucide-react components are imported directly

**Implications:**
- CardHeader imports specific icons from lucide-react (MessageSquare, Terminal, etc.) and renders them as JSX
- Dock imports icons from lucide-react instead of vanilla lucide
- The `import { createElement } from "lucide"` pattern is eliminated from the chrome layer
- An icon lookup map is still needed (string icon name to React component) but it maps to React components instead of vanilla icon definitions

#### [D08] useImperativeHandle transition for DeckManager compatibility (DECIDED) {#d08-imperative-handle}

**Decision:** React CardFrame and TabBar expose imperative APIs via forwardRef + useImperativeHandle so DeckManager can call the same methods (setZIndex, updatePosition, updateSize, setKey, getElement, getCardAreaElement, getCardState, destroy for CardFrame; getElement, update, destroy for TabBar) through React refs during the transition period (Steps 3-5).

**Rationale:**
- DeckManager has ~25 imperative call sites to CardFrame methods (setZIndex, getElement, getCardAreaElement, updatePosition, updateSize, setKey, getCardState, destroy) and TabBar methods (getElement, update, destroy), particularly in sash drag code that calls fp.updatePosition/fp.updateSize during pointermove
- Deleting vanilla classes in Steps 3-5 requires DeckManager to have a compatible interface immediately
- useImperativeHandle + forwardRef is the standard React pattern for exposing imperative methods to parent code
- This approach allows vanilla deletion in Steps 3-5 (each step is fully testable) rather than deferring to Step 7
- The imperative handles are a transitional bridge: Step 7 (DeckCanvas unification) eliminates them by moving DeckManager's imperative calls into React state/props flow

**Implications:**
- React CardFrame uses forwardRef and useImperativeHandle to expose: setZIndex, updatePosition, updateSize, setKey, setDockedStyle, resetDockedStyle, getElement (returns ref.current), getCardAreaElement, getCardState, destroy
- React TabBar uses forwardRef and useImperativeHandle to expose: getElement (returns ref.current), update (triggers re-render via state), destroy
- DeckManager stores refs (React.RefObject) in its cardFrames and tabBars maps instead of class instances
- For synchronous rendering: the initial createRoot().render() call from non-React code (DeckManager.render() is vanilla TS) is already synchronous in React 18/19, so ref.current is populated immediately after the first render. For subsequent re-renders (when DeckManager calls root.render() again on layout changes), wrap in ReactDOM.flushSync() to ensure synchronous completion before DeckManager accesses ref.current. During implementation, verify whether flushSync is actually needed for re-renders -- if React batches them asynchronously, add it; if not, omit it and document the finding. flushSync is a temporary measure removed in Step 7 when the single-root DeckCanvas architecture eliminates imperative post-render calls.
- During sash drag, DeckManager calls fp.current!.updatePosition() and fp.current!.updateSize() which mutate styles via the component's internal refs
- Step 7 removes all useImperativeHandle code and flushSync when DeckManager switches to rendering DeckCanvas with props

---

### Deep Dives (Optional) {#deep-dives}

#### CustomEvent Elimination Map {#custom-event-map}

**Table T01: CustomEvent channels and their React replacements** {#t01-custom-event-map}

| # | Event Name | Source | Sink | Replacement | Step |
|---|-----------|--------|------|-------------|------|
| 1 | td-theme-change | Dock MutationObserver, useTheme.ts | useTheme.ts, terminal-card.tsx | useTheme hook reads body class directly; MutationObserver in Dock deleted in Step 5; terminal-card switches to useTheme in Step 8 | 5, 8 |
| 2 | td-dev-notification | action-dispatch.ts | developer-card.tsx | DevNotificationContext (ref-based setter from action-dispatch) | 8 |
| 3 | td-dev-build-progress | action-dispatch.ts | developer-card.tsx | DevNotificationContext (ref-based setter from action-dispatch) | 8 |
| 4 | td-dev-badge | developer-card.tsx | dock.ts | DevNotificationContext (DeveloperCard updates context, Dock reads from context) | 5, 8 |
| 5 | td-hmr-update | developer-card.tsx | developer-card.tsx (self) | No change (acceptable; does not cross vanilla/React boundary) | N/A |
| 6 | card-meta-update | useCardMeta -> CardContext -> container element | ReactCardAdapter | Eliminated: card components call useCardMeta which updates React state flowing to CardHeader via props in the unified tree | 6 |

#### DeckCanvas Component Architecture {#deck-canvas-architecture}

The unified single-root architecture centers on a DeckCanvas React component rendered by DeckManager:

```
DeckManager (TypeScript class, owns state)
  |
  +-- this.reactRoot.render(
        <DevNotificationProvider ref={devNotificationRef}>
          <DeckCanvas
            panels={deckState.cards}
            cardConfigs={cardConfigMap}
            callbacks={canvasCallbacks}
            guides={activeGuides}
            sashGroups={activeSashGroups}
            flashingPanels={flashingPanelIds}
            keyPanelId={keyPanelId}
          >
            {panels.map(panel =>
              <CardFrame
                key={panel.id}
                panelState={panel}
                meta={cardMetas.get(panel.id)}
                isKey={panel.id === keyPanelId}
                zIndex={100 + index}
                callbacks={frameCallbacks}
                canvasBounds={canvasBounds}
              >
                {panel.tabs.length > 1 &&
                  <TabBar tabs={panel.tabs} activeTabIndex={...} callbacks={tabCallbacks} />
                }
                <CardContent
                  component={cardConfigs.get(activeTabId).component}
                  feedData={feedDataForCard}
                  dimensions={cardDimensions}
                  connection={connection}
                  dragState={dragState}
                />
              </CardFrame>
            )}
            {guides.map(g => <SnapGuideLine .../>)}
            {sashGroups.map(sg => <VirtualSash .../>)}
            {flashingPanels.map(id => <SetFlashOverlay .../>)}
          </DeckCanvas>
        </DevNotificationProvider>
      )
```

DeckManager communicates with the React tree through:
1. Props passed to DeckCanvas (layout state, callbacks)
2. DevNotificationContext ref (for action-dispatch to push notifications)
3. Callbacks that DeckCanvas invokes (onMoveEnd, onResizeEnd, onFocus, onClose, etc.) which DeckManager handles to update its state and re-render

---

### Specification {#specification}

#### New React Components {#new-components}

**Spec S01: CardDropdownMenu props** {#s01-card-dropdown-menu}

```typescript
interface CardDropdownMenuProps {
  items: CardMenuItem[];
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
}
```

Maps CardMenuItem types to shadcn components:
- CardMenuAction -> DropdownMenuItem with onSelect callback
- CardMenuToggle -> DropdownMenuCheckboxItem with checked state and onCheckedChange
- CardMenuSelect -> DropdownMenuLabel + DropdownMenuRadioGroup + DropdownMenuRadioItem
- CardMenuSeparator -> DropdownMenuSeparator

**Spec S02: CardHeader props** {#s02-card-header}

```typescript
interface CardHeaderProps {
  meta: TugCardMeta;
  isKey: boolean;
  showCollapse?: boolean;
  onClose: () => void;
  onCollapse: () => void;
  onDragStart?: (e: React.PointerEvent) => void;
}
```

**Spec S03: CardFrame props** {#s03-card-frame}

```typescript
interface CardFrameProps {
  panelState: CardState;
  meta: TugCardMeta;
  isKey: boolean;
  zIndex: number;
  canvasBounds: { width: number; height: number };
  callbacks: CardFrameCallbacks;
  /** Docked corner radii: [TL, TR, BR, BL]. true = rounded (6px), false = squared (0). Default: all true. */
  dockedCorners?: [boolean, boolean, boolean, boolean];
  /** Docked position offset for 1px overlap at shared edges. Default: {dx:0, dy:0}. */
  positionOffset?: { dx: number; dy: number };
  children: React.ReactNode;
}
```

CardFrameCallbacks stays identical to the current interface (onMoveEnd, onResizeEnd, onFocus, onClose, onMoving, onResizing).

The `dockedCorners` and `positionOffset` props replace the imperative `updateDockedStyles()` and `resetDockedStyles()` methods in DeckManager. During the transition (Steps 3-6), DeckManager computes these values the same way it does now (from sharedEdges) and passes them as props when rendering per-panel React roots. In Step 7, DeckCanvas receives them as part of the per-panel render data.

**Spec S03a: CardFrameHandle (imperative API, transitional)** {#s03a-card-frame-handle}

```typescript
// Exposed via forwardRef + useImperativeHandle during Steps 3-6.
// Removed in Step 7 when DeckCanvas replaces imperative calls with props.
interface CardFrameHandle {
  setZIndex(z: number): void;
  updatePosition(x: number, y: number): void;
  updateSize(width: number, height: number): void;
  setKey(isKey: boolean): void;
  setDockedStyle(corners: [boolean, boolean, boolean, boolean], offset: { dx: number; dy: number }): void;
  resetDockedStyle(): void;
  getElement(): HTMLElement;
  getCardAreaElement(): HTMLElement;
  getCardState(): CardState;
  destroy(): void;
}
```

**Spec S04: TabBar props** {#s04-tab-bar}

```typescript
interface TabBarProps {
  tabs: TabItem[];
  activeTabIndex: number;
  callbacks: TabBarCallbacks;
}
```

TabBarCallbacks stays identical (onTabActivate, onTabClose, onTabReorder).

**Spec S04a: TabBarHandle (imperative API, transitional)** {#s04a-tab-bar-handle}

```typescript
// Exposed via forwardRef + useImperativeHandle during Steps 4-6.
// Removed in Step 7 when DeckCanvas replaces imperative calls with props.
interface TabBarHandle {
  getElement(): HTMLElement;
  update(node: TabNode): void;
  destroy(): void;
}
```

**Spec S05: DeckCanvas props** {#s05-deck-canvas}

```typescript
interface DeckCanvasProps {
  panels: CardState[];
  cardConfigs: Map<string, CardConfig>;
  cardMetas: Map<string, TugCardMeta>;
  keyPanelId: string | null;
  guides: GuidePosition[];
  sashGroups: SharedEdge[];
  flashingPanels: string[];
  canvasBounds: { width: number; height: number };
  callbacks: CanvasCallbacks;
  connection: TugConnection | null;
  dragState: IDragState | null;
}
```

**Spec S06: DevNotificationContext shape** {#s06-dev-notification-context}

```typescript
interface DevNotificationState {
  notifications: DevNotification[];
  buildProgress: BuildProgressPayload | null;
  badgeCounts: Map<string, number>;
}

interface DevNotificationContextValue {
  state: DevNotificationState;
  notify: (payload: Record<string, unknown>) => void;
  updateBuildProgress: (payload: Record<string, unknown>) => void;
  setBadge: (componentId: string, count: number) => void;
}
```

The provider exposes a ref so non-React code (action-dispatch.ts) can call notify/updateBuildProgress directly.

**Spec S07: DockCallbacks** {#s07-dock-callbacks}

```typescript
interface DockCallbacks {
  /** Show/toggle/focus a card by type (code, terminal, git, files, stats, developer, about). */
  onShowCard: (cardType: string) => void;
  /** Reset the canvas layout to default positions. */
  onResetLayout: () => void;
  /** Send restart control frame to the server. */
  onRestartServer: () => void;
  /** Clear localStorage and send reset control frame. */
  onResetEverything: () => void;
  /** Send reload_frontend control frame. */
  onReloadFrontend: () => void;
}
```

These callbacks are passed as props to the Dock React component, replacing the vanilla Dock's direct calls to DeckManager methods (addNewCard, resetLayout, sendControlFrame).

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/chrome/card-dropdown-menu.tsx` | CardDropdownMenu React component wrapping shadcn DropdownMenu |
| `tugdeck/src/components/chrome/card-header.tsx` | CardHeader React component (replaces card-header.ts) |
| `tugdeck/src/components/chrome/card-frame.tsx` | CardFrame React component (replaces card-frame.ts) |
| `tugdeck/src/components/chrome/tab-bar.tsx` | TabBar React component (replaces tab-bar.ts) |
| `tugdeck/src/components/chrome/dock.tsx` | Dock React component (replaces dock.ts) |
| `tugdeck/src/components/chrome/deck-canvas.tsx` | DeckCanvas component: single React root for entire canvas |
| `tugdeck/src/components/chrome/snap-guide-line.tsx` | SnapGuideLine overlay component |
| `tugdeck/src/components/chrome/virtual-sash.tsx` | VirtualSash overlay component with pointer capture drag |
| `tugdeck/src/components/chrome/set-flash-overlay.tsx` | SetFlashOverlay animation component |
| `tugdeck/src/components/chrome/disconnect-banner.tsx` | DisconnectBanner React component (replaces DOM in connection.ts) |
| `tugdeck/src/contexts/dev-notification-context.tsx` | DevNotificationContext and provider |
| `tugdeck/src/__tests__/card-dropdown-menu.test.tsx` | RTL tests for CardDropdownMenu |
| `tugdeck/src/__tests__/card-header-react.test.tsx` | RTL tests for React CardHeader |
| `tugdeck/src/__tests__/card-frame-react.test.tsx` | RTL tests for React CardFrame |
| `tugdeck/src/__tests__/tab-bar-react.test.tsx` | RTL tests for React TabBar |
| `tugdeck/src/__tests__/dock-react.test.tsx` | RTL tests for React Dock |

#### Files to delete {#files-to-delete}

| File | Deleted in Step |
|------|----------------|
| `tugdeck/src/card-menu.ts` | Step 1 |
| `tugdeck/src/__tests__/card-menus.test.ts` | Step 1 |
| `tugdeck/src/card-header.ts` | Step 2 |
| `tugdeck/src/__tests__/card-header.test.ts` | Step 2 |
| `tugdeck/src/card-frame.ts` | Step 3 |
| `tugdeck/src/__tests__/card-frame.test.ts` | Step 3 |
| `tugdeck/src/tab-bar.ts` | Step 4 |
| `tugdeck/src/__tests__/tab-bar.test.ts` | Step 4 |
| `tugdeck/src/dock.ts` | Step 5 |
| `tugdeck/src/__tests__/dock.test.ts` | Step 5 |
| `tugdeck/styles/dock.css` | Step 5 |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `CardDropdownMenu` | React component | `components/chrome/card-dropdown-menu.tsx` | Maps CardMenuItem[] to shadcn DropdownMenu |
| `CardHeader` | React component | `components/chrome/card-header.tsx` | Replaces vanilla CardHeader class |
| `CardFrame` | React component | `components/chrome/card-frame.tsx` | Replaces vanilla CardFrame class; uses forwardRef |
| `CardFrameHandle` | interface | `components/chrome/card-frame.tsx` | Transitional imperative API (Steps 3-6); removed in Step 7 |
| `TabBar` | React component | `components/chrome/tab-bar.tsx` | Replaces vanilla TabBar class; uses forwardRef |
| `TabBarHandle` | interface | `components/chrome/tab-bar.tsx` | Transitional imperative API (Steps 4-6); removed in Step 7 |
| `Dock` | React component | `components/chrome/dock.tsx` | Replaces vanilla Dock class |
| `DockCallbacks` | interface | `components/chrome/dock.tsx` | Callback props: onShowCard, onResetLayout, onRestartServer, onResetEverything, onReloadFrontend |
| `DeckCanvas` | React component | `components/chrome/deck-canvas.tsx` | New: single React root for canvas |
| `CardConfig` | interface | `components/chrome/deck-canvas.tsx` | Replaces ReactCardAdapterConfig for card factories |
| `SnapGuideLine` | React component | `components/chrome/snap-guide-line.tsx` | New: snap guide overlay |
| `VirtualSash` | React component | `components/chrome/virtual-sash.tsx` | New: sash drag overlay |
| `SetFlashOverlay` | React component | `components/chrome/set-flash-overlay.tsx` | New: set flash animation |
| `DisconnectBanner` | React component | `components/chrome/disconnect-banner.tsx` | New: replaces DOM in connection.ts |
| `DevNotificationContext` | React context | `contexts/dev-notification-context.tsx` | New: replaces CustomEvent bridges |
| `DevNotificationProvider` | React component | `contexts/dev-notification-context.tsx` | New: provides context + ref-based setter |
| `ReactCardAdapter` | class (modified) | `cards/react-card-adapter.tsx` | Simplified to a config object; mount/setCardFrame/setActiveTab removed |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (RTL)** | Test individual React chrome components in isolation | CardDropdownMenu, CardHeader, CardFrame, TabBar, Dock |
| **Integration (RTL)** | Test component composition and context flow | DeckCanvas rendering, DevNotificationContext flow |
| **Interaction (RTL + fireEvent)** | Test pointer events, keyboard navigation, menu behavior | Drag initiation, menu open/close, tab reorder |
| **Smoke (manual)** | Verify full drag/resize/sash behavior in browser | After each step that changes pointer handling |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.**

#### Step 1: CardMenu to shadcn DropdownMenu {#step-1}

**Commit:** `refactor(tugdeck): replace vanilla CardMenu with shadcn CardDropdownMenu`

**References:** [D01] shadcn DropdownMenu replaces vanilla card-menu.ts, [D06] Delete vanilla test files alongside vanilla classes, Spec S01, Table T01 (#t01-custom-event-map), (#d01-shadcn-dropdown, #strategy, #new-files)

**Artifacts:**
- New file: `tugdeck/src/components/chrome/card-dropdown-menu.tsx`
- New file: `tugdeck/src/__tests__/card-dropdown-menu.test.tsx`
- Deleted: `tugdeck/src/card-menu.ts`
- Deleted: `tugdeck/src/__tests__/card-menus.test.ts`
- Modified: `tugdeck/src/card-header.ts` (import CardDropdownMenu instead of vanilla DropdownMenu -- temporary hybrid: CardHeader is still vanilla but renders CardDropdownMenu via a React root in the menu button click handler)
- Modified: `tugdeck/src/dock.ts` (import CardDropdownMenu instead of vanilla DropdownMenu -- same temporary hybrid pattern)

**Tasks:**
- [ ] Create `components/chrome/card-dropdown-menu.tsx` implementing CardDropdownMenu
- [ ] Map CardMenuAction to DropdownMenuItem with onSelect
- [ ] Map CardMenuToggle to DropdownMenuCheckboxItem with checked/onCheckedChange
- [ ] Map CardMenuSelect to DropdownMenuLabel + DropdownMenuRadioGroup + DropdownMenuRadioItem
- [ ] Map CardMenuSeparator to DropdownMenuSeparator
- [ ] Update card-header.ts: replace `new DropdownMenu(items, anchor)` with a temporary React bridge. Implementation: create a container div as a sibling of the menu button, createRoot(container), render a controlled `<DropdownMenu open={true} onOpenChange={handleClose}>` where DropdownMenuTrigger wraps a hidden zero-size span (`<DropdownMenuTrigger asChild><span style="position:absolute; width:0; height:0" /></DropdownMenuTrigger>`) and DropdownMenuContent renders the items. Position the container div absolutely relative to the menu button so Radix's Popper anchors correctly. The onOpenChange(false) callback is the sole cleanup path: it unmounts the root and removes the container div. No separate click-outside handler is needed (Radix handles it). Guard against orphan roots by tracking the current root and unmounting any existing root before creating a new one. This transitional pattern survives only until Step 2 converts CardHeader to React.
- [ ] Update dock.ts: same temporary React bridge pattern for the settings dropdown -- create container div sibling, createRoot, render controlled DropdownMenu with hidden Trigger and items; onOpenChange(false) unmounts and removes container. Guard against orphan roots via tracked root reference.
- [ ] Delete card-menu.ts
- [ ] Delete `__tests__/card-menus.test.ts`
- [ ] Write `__tests__/card-dropdown-menu.test.tsx` with RTL tests
- [ ] Remove `.card-dropdown-menu`, `.card-dropdown-item`, `.card-dropdown-separator`, `.card-dropdown-select-group`, `.card-dropdown-select-option` rules from cards-chrome.css

**Tests:**
- [ ] RTL: renders action items and fires onSelect callback
- [ ] RTL: renders toggle items with checkbox indicator, fires onCheckedChange
- [ ] RTL: renders select items as radio group, fires selection callback
- [ ] RTL: renders separators between item groups
- [ ] RTL: keyboard navigation (arrow keys, Enter to select, Escape to close)

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- all tests pass
- [ ] `grep -r "card-menu" tugdeck/src/ --include="*.ts"` -- no references to deleted file (only to card-dropdown-menu.tsx)
- [ ] Manual: open a card menu, verify items render with shadcn styling, toggle and select work

---

#### Step 2: CardHeader to React {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(tugdeck): convert CardHeader to React component`

**References:** [D02] React synthetic events for all pointer interactions, [D06] Delete vanilla test files, [D07] lucide-react replaces vanilla lucide, Spec S02, (#d02-react-pointer-events, #d07-lucide-react, #new-files)

**Artifacts:**
- New file: `tugdeck/src/components/chrome/card-header.tsx`
- New file: `tugdeck/src/__tests__/card-header-react.test.tsx`
- Deleted: `tugdeck/src/card-header.ts`
- Deleted: `tugdeck/src/__tests__/card-header.test.ts`
- Modified: `tugdeck/src/card-frame.ts` (import React CardHeader; render via a React root inside the header area -- transitional until Step 3)

**Tasks:**
- [ ] Create `components/chrome/card-header.tsx` implementing CardHeader as a React component per Spec S02
- [ ] Render icon via lucide-react components using an icon lookup map (string name to React component)
- [ ] Render title, spacer, menu button (using CardDropdownMenu from Step 1), collapse button, close button
- [ ] Wire onPointerDown on header root (excluding buttons) for drag initiation via onDragStart prop
- [ ] Apply `card-header-key` class conditionally via `isKey` prop
- [ ] Preserve CSS class names (.card-header, .card-header-icon, .card-header-title, .card-header-spacer, .card-header-btn) for test selector compatibility
- [ ] Update card-frame.ts: replace `new CardHeader(meta, callbacks)` with a React root that renders the React CardHeader component
- [ ] Delete card-header.ts and its test file
- [ ] Write RTL tests for the React CardHeader

**Tests:**
- [ ] RTL: renders icon, title, and buttons based on TugCardMeta props
- [ ] RTL: close button fires onClose callback
- [ ] RTL: menu button opens CardDropdownMenu with correct items
- [ ] RTL: pointerdown on header (not on buttons) fires onDragStart
- [ ] RTL: isKey=true applies card-header-key class
- [ ] RTL: re-renders when meta props change (no updateMeta method needed)

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- all tests pass
- [ ] `grep -r "from.*lucide\"" tugdeck/src/ --include="*.ts" --include="*.tsx"` -- no vanilla lucide imports in chrome layer (only lucide-react)
- [ ] Manual: card headers render correctly, menu works, drag from header works

---

#### Step 3: CardFrame to React {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(tugdeck): convert CardFrame to React component`

**References:** [D02] React synthetic events, [D03] Ref-based style mutation during drag, [D06] Delete vanilla test files, [D08] useImperativeHandle transition, Spec S03, Risk R01, Risk R02, (#d02-react-pointer-events, #d03-ref-style-mutation, #d08-imperative-handle, #r01-perf-regression, #r02-happy-dom-pointer)

**Artifacts:**
- New file: `tugdeck/src/components/chrome/card-frame.tsx`
- New file: `tugdeck/src/__tests__/card-frame-react.test.tsx`
- Deleted: `tugdeck/src/card-frame.ts`
- Deleted: `tugdeck/src/__tests__/card-frame.test.ts`
- Modified: `tugdeck/src/deck-manager.ts` (import React CardFrame; replace vanilla class instances with React refs in cardFrames map; update all call sites to use ref.current)

**Tasks:**
- [ ] Create `components/chrome/card-frame.tsx` implementing CardFrame as a React component per Spec S03
- [ ] Use forwardRef + useImperativeHandle to expose imperative API for DeckManager compatibility: setZIndex(z), updatePosition(x, y), updateSize(w, h), setKey(isKey), setDockedStyle(corners, offset), resetDockedStyle(), getElement(), getCardAreaElement(), getCardState(), destroy() (per [D08])
- [ ] Implement setDockedStyle(): applies border-radius to root, header, and content elements based on corners tuple; applies position offset (dx, dy) to root element style. Implement resetDockedStyle(): resets to default 6px/5px radii and removes offset. These replace DeckManager's updateDockedStyles()/resetDockedStyles() querySelector-based DOM manipulation
- [ ] Render CardHeader (from Step 2) as a child
- [ ] Render card content area as a ref-accessible div (returned by getCardAreaElement imperative method)
- [ ] Render eight resize handle divs (n, s, e, w, nw, ne, sw, se) with appropriate CSS classes
- [ ] Implement header drag via React onPointerDown with pointer capture, 3px threshold, canvas boundary clamping, snap callback
- [ ] Implement resize via React onPointerDown on handles with pointer capture, min-size enforcement, canvas boundary clamping, snap callback
- [ ] Use useRef for the root element; mutate style.left/top/width/height directly during drag/resize (no setState per pointermove); imperative updatePosition/updateSize methods use the same ref
- [ ] Commit final geometry on onPointerUp by calling onMoveEnd/onResizeEnd callbacks
- [ ] Wire onFocus via onPointerDown on root element (with metaKey check for suppressZOrder)
- [ ] Apply zIndex, position, and size from panelState props; update via refs
- [ ] Preserve CSS class names (.card-frame, .card-frame-content, .card-frame-resize-*) for test selector compatibility
- [ ] Update deck-manager.ts: change cardFrames map type from `Map<string, CardFrame>` to `Map<string, React.RefObject<CardFrameHandle>>`. Update all imperative call sites from `fp.method()` to `fp.current!.method()` in the following DeckManager methods:
  - `render()`: setZIndex, getElement, getCardAreaElement, setKey
  - `focusPanel()`: setZIndex, setKey
  - `attachSashDrag()`: update PanelSnap type from `{ fp: CardFrame }` to `{ fp: React.RefObject<CardFrameHandle> }`, then update s.fp.updatePosition -> s.fp.current!.updatePosition, s.fp.updateSize -> s.fp.current!.updateSize
  - `normalizeSetPositions()`: fp.updatePosition -> fp.current!.updatePosition
  - `updateDockedStyles()`: replace querySelector-based DOM manipulation with fp.current!.setDockedStyle(corners, offset)
  - `resetDockedStyles()`: replace querySelector-based DOM manipulation with fp.current!.resetDockedStyle()
  - `flashPanels()`: fp.getElement -> fp.current!.getElement
  - `ensureSetAdjacency()`: fp.setZIndex -> fp.current!.setZIndex
  - `detectDragSetChange()`: resetDockedStyles call updated
  - `destroy()`: fp.destroy -> fp.current!.destroy
- [ ] DeckManager renders each CardFrame via createRoot per panel with ref forwarding
- [ ] Handle synchronous rendering for DeckManager compatibility: the initial createRoot().render() from non-React code is synchronous in React 18/19, so ref.current is available immediately after first render. For subsequent root.render() re-renders, wrap in `ReactDOM.flushSync()` if needed to ensure synchronous completion before DeckManager accesses ref.current (verify during implementation whether re-renders from non-React code are synchronous by default; add flushSync only if React batches them). This is a temporary transitional measure removed in Step 7.
- [ ] Delete card-frame.ts and its test file
- [ ] Write RTL tests for the React CardFrame (including imperative handle methods)
- [ ] Export CARD_TITLE_BAR_HEIGHT constant from the new component file

**Tests:**
- [ ] RTL: renders header, content area, and 8 resize handles
- [ ] RTL: onPointerDown on root fires onFocus callback
- [ ] RTL: onPointerDown on header initiates drag (verify onDragStart handling)
- [ ] RTL: onMoveEnd callback receives final position after drag sequence
- [ ] RTL: onResizeEnd callback receives final geometry after resize sequence
- [ ] RTL: zIndex prop applied to root element style
- [ ] RTL: isKey prop flows to CardHeader
- [ ] RTL: imperative handle: ref.current.setZIndex updates element style
- [ ] RTL: imperative handle: ref.current.updatePosition/updateSize mutate element styles
- [ ] RTL: imperative handle: ref.current.setKey toggles card-header-key class
- [ ] RTL: imperative handle: ref.current.setDockedStyle applies squared corners and position offset
- [ ] RTL: imperative handle: ref.current.resetDockedStyle restores default rounded corners

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- all tests pass
- [ ] `grep -r "new CardFrame" tugdeck/src/ --include="*.ts"` -- no vanilla CardFrame construction
- [ ] Manual: card drag works smoothly (no frame drops), resize works from all 8 handles, snap guides appear

---

#### Step 4: TabBar to React {#step-4}

**Depends on:** #step-3

**Commit:** `refactor(tugdeck): convert TabBar to React component`

**References:** [D02] React synthetic events, [D06] Delete vanilla test files, [D08] useImperativeHandle transition, Spec S04, (#d02-react-pointer-events, #d08-imperative-handle, #new-files)

**Artifacts:**
- New file: `tugdeck/src/components/chrome/tab-bar.tsx`
- New file: `tugdeck/src/__tests__/tab-bar-react.test.tsx`
- Deleted: `tugdeck/src/tab-bar.ts`
- Deleted: `tugdeck/src/__tests__/tab-bar.test.ts`
- Modified: `tugdeck/src/deck-manager.ts` (import React TabBar; replace vanilla class instances with React refs in tabBars map)

**Tasks:**
- [ ] Create `components/chrome/tab-bar.tsx` implementing TabBar as a React component per Spec S04
- [ ] Use forwardRef + useImperativeHandle to expose imperative API for DeckManager compatibility: getElement(), update(node) (triggers re-render via state from new TabNode), destroy() (per [D08])
- [ ] Render tabs as divs with label and close button, active tab styling via className
- [ ] Implement click-to-switch via onTabActivate callback (fires when pointerdown does not become a drag)
- [ ] Implement close button with stopPropagation and onTabClose callback
- [ ] Implement drag-reorder with onPointerDown/onPointerMove using pointer capture and 5px threshold
- [ ] Hit test via refs to tab elements + getBoundingClientRect for reorder target detection
- [ ] Preserve CSS class names (.card-tab-bar, .card-tab, .card-tab-active, .card-tab-close) for test selector compatibility
- [ ] Update deck-manager.ts: change tabBars map type from `Map<string, TabBar>` to `Map<string, React.RefObject<TabBarHandle>>` and update all call sites; render React TabBar per panel with ref forwarding
- [ ] Delete tab-bar.ts and its test file
- [ ] Write RTL tests for the React TabBar

**Tests:**
- [ ] RTL: renders tabs with correct labels and active state
- [ ] RTL: click on inactive tab fires onTabActivate
- [ ] RTL: click on close button fires onTabClose with correct tab id
- [ ] RTL: drag threshold: small movement does not trigger reorder, fires onTabActivate instead
- [ ] RTL: closable=false tabs do not render close button

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- all tests pass
- [ ] `grep -r "new TabBar" tugdeck/src/ --include="*.ts"` -- no vanilla TabBar construction
- [ ] Manual: multi-tab panels render tabs correctly, click-to-switch and close work, drag-reorder works

---

#### Step 5: Dock to React {#step-5}

**Depends on:** #step-4

**Commit:** `refactor(tugdeck): convert Dock to React component`

**References:** [D01] shadcn DropdownMenu, [D06] Delete vanilla test files, [D07] lucide-react, Spec S07, Table T01 (#t01-custom-event-map), (#d05-dev-notification-context, #d07-lucide-react, #s07-dock-callbacks, #new-files, #files-to-delete)

**Artifacts:**
- New file: `tugdeck/src/components/chrome/dock.tsx`
- New file: `tugdeck/src/__tests__/dock-react.test.tsx`
- Deleted: `tugdeck/src/dock.ts`
- Deleted: `tugdeck/src/__tests__/dock.test.ts`
- Deleted: `tugdeck/styles/dock.css`
- Modified: `tugdeck/src/main.tsx` (render Dock as React component instead of `new Dock(deck)`)

**Tasks:**
- [ ] Create `components/chrome/dock.tsx` implementing Dock as a React component accepting DockCallbacks (Spec S07)
- [ ] Render icon buttons via lucide-react components (MessageSquare, Terminal, GitBranch, FolderOpen, Activity, Code, Settings)
- [ ] Use CardDropdownMenu (from Step 1) for the settings dropdown; settings menu items invoke DockCallbacks: onShowCard for card types, onResetLayout, onRestartServer, onResetEverything, onReloadFrontend
- [ ] Read theme state via useTheme hook (eliminates MutationObserver)
- [ ] Icon button clicks call `callbacks.onShowCard(cardType)` for each card type
- [ ] Render badge counts: temporarily listen for `td-dev-badge` CustomEvents via useEffect (same mechanism as the deleted vanilla Dock) until Step 9 replaces with DevNotificationContext. Add a `// TODO: Step 9 replaces with DevNotificationContext` comment at the listener
- [ ] Render Tug logo SVG
- [ ] Replace dock.css rules with Tailwind utilities on the component
- [ ] Update main.tsx: instead of `new Dock(deck)`, render Dock within the React tree (temporarily as a separate React root until Step 7 unifies); wire DockCallbacks to DeckManager methods (onShowCard -> dispatchAction, onResetLayout -> deck.resetLayout, etc.)
- [ ] Delete dock.ts, its test file, and dock.css
- [ ] Remove `import "../styles/dock.css"` from main.tsx
- [ ] Write RTL tests for the React Dock

**Tests:**
- [ ] RTL: renders all 6 card-type icon buttons plus settings button
- [ ] RTL: clicking an icon button fires onShowCard callback with correct card type
- [ ] RTL: settings menu: Reset Layout fires onResetLayout, Restart Server fires onRestartServer, Reset Everything fires onResetEverything, Reload Frontend fires onReloadFrontend
- [ ] RTL: settings menu theme select: selecting a theme calls useTheme setter
- [ ] RTL: badge count renders when count > 0, hidden when count === 0

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- all tests pass
- [ ] `grep -r "new Dock" tugdeck/src/ --include="*.ts" --include="*.tsx"` -- no vanilla Dock construction
- [ ] `ls tugdeck/styles/dock.css` -- file does not exist
- [ ] Manual: dock renders on right edge, icon buttons work, settings menu opens, theme switching works, badges display

---

#### Step 6: Chrome Integration Checkpoint {#step-6}

**Depends on:** #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] shadcn DropdownMenu, [D02] React synthetic events, [D06] Delete vanilla test files, (#success-criteria, #strategy)

**Tasks:**
- [ ] Verify all 5 vanilla chrome files (card-menu.ts, card-header.ts, card-frame.ts, tab-bar.ts, dock.ts) are deleted
- [ ] Verify all 5 corresponding vanilla test files are deleted
- [ ] Verify no remaining `import ... from "./card-menu"` or similar vanilla imports
- [ ] Verify all pointer interactions work: card drag, card resize, tab click/close/reorder, dock buttons, dropdown menus

**Tests:**
- [ ] `cd tugdeck && bun test` -- aggregate test run covering all converted chrome components

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- all tests pass
- [ ] `ls tugdeck/src/card-menu.ts tugdeck/src/card-header.ts tugdeck/src/card-frame.ts tugdeck/src/tab-bar.ts tugdeck/src/dock.ts 2>&1` -- all 5 files report "No such file" (vanilla chrome classes deleted)
- [ ] `ls tugdeck/src/__tests__/card-menus.test.ts tugdeck/src/__tests__/card-header.test.ts tugdeck/src/__tests__/card-frame.test.ts tugdeck/src/__tests__/tab-bar.test.ts tugdeck/src/__tests__/dock.test.ts 2>&1` -- all 5 files report "No such file" (vanilla test files deleted)
- [ ] Manual smoke test: open app, create cards, drag/resize, switch tabs, use menus, change theme

---

#### Step 7: DeckManager React Canvas Rendering {#step-7}

**Depends on:** #step-6

**Commit:** `refactor(tugdeck): unify DeckManager into single React root with DeckCanvas`

**References:** [D04] Unified single React root with DeckCanvas, [D05] DevNotificationContext, Spec S05, Spec S06, (#d04-single-react-root, #deck-canvas-architecture, #new-files)

**Artifacts:**
- New file: `tugdeck/src/components/chrome/deck-canvas.tsx`
- New file: `tugdeck/src/contexts/dev-notification-context.tsx`
- Modified: `tugdeck/src/deck-manager.ts` (create single React root; render DeckCanvas; remove CardFrame/TabBar tracking maps; remove imperative DOM creation)
- Modified: `tugdeck/src/cards/react-card-adapter.tsx` (simplify to config object; remove mount/setCardFrame/setActiveTab/createRoot)
- Modified: `tugdeck/src/cards/card-context.tsx` (remove card-meta-update CustomEvent dispatch; updateMeta updates state directly)
- Modified: `tugdeck/src/hooks/use-card-meta.ts` (update to use state-based updateMeta instead of CustomEvent)
- Modified: `tugdeck/src/main.tsx` (remove per-card ReactCardAdapter instantiation; use card config objects; render Dock inside unified tree)

**Tasks:**
- [ ] Create `components/chrome/deck-canvas.tsx` implementing DeckCanvas per Spec S05
- [ ] DeckCanvas renders CardFrame for each panel, with TabBar for multi-tab panels, and card content via component from card config
- [ ] DeckCanvas renders Dock as part of the unified tree (no separate React root)
- [ ] Create `contexts/dev-notification-context.tsx` implementing DevNotificationContext per Spec S06
- [ ] DevNotificationProvider wraps the entire DeckCanvas tree; exposes ref-based setter for action-dispatch
- [ ] Modify DeckManager: create one React root; call `this.reactRoot.render(<DevNotificationProvider ...><DeckCanvas .../></DevNotificationProvider>)` in render()
- [ ] Remove `cardFrames` and `tabBars` ref maps from DeckManager (imperative handles no longer needed; DeckManager communicates via props/callbacks through DeckCanvas)
- [ ] Remove useImperativeHandle + forwardRef from CardFrame and TabBar components (transitional code from [D08] no longer needed)
- [ ] Remove per-panel createRoot calls and flushSync from DeckManager.render(); all rendering goes through the single root
- [ ] Migrate docked styling: DeckManager computes dockedCorners and positionOffset per panel (same updateDockedStyles logic) and passes them to DeckCanvas as per-panel data; CardFrame reads these from props instead of imperative setDockedStyle/resetDockedStyle calls
- [ ] Simplify ReactCardAdapter: remove mount(), setCardFrame(), setActiveTab(), createRoot call; keep feedIds, component, initialMeta as config
- [ ] Update CardContextProvider: remove card-meta-update CustomEvent mechanism; updateMeta becomes a state callback in the DeckCanvas tree
- [ ] Update useCardMeta: hook calls updateMeta from context which updates DeckCanvas state flowing to CardHeader via props
- [ ] Update main.tsx: use card config objects instead of ReactCardAdapter instances; remove separate Dock instantiation
- [ ] Update deck-manager.test.ts integration tests to work with the new React rendering path
- [ ] Update react-card-adapter.test.tsx tests (adapter is now a config object, so some tests become obsolete)

**Tests:**
- [ ] RTL: DeckCanvas renders CardFrame for each panel in deckState
- [ ] RTL: DeckCanvas renders TabBar for multi-tab panels
- [ ] RTL: DeckCanvas renders Dock
- [ ] RTL: card content renders via card config component
- [ ] RTL: useCardMeta updates flow to CardHeader via props (no CustomEvent)
- [ ] Integration: DevNotificationContext ref-based setter updates React state

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- all tests pass
- [ ] `grep -r "createRoot" tugdeck/src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v __tests__` -- exactly one createRoot call (in DeckManager)
- [ ] `grep -r "useImperativeHandle" tugdeck/src/ --include="*.tsx"` -- zero results (transitional imperative handles removed)
- [ ] `grep -r "card-meta-update" tugdeck/src/ --include="*.ts" --include="*.tsx"` -- zero results (CustomEvent channel eliminated)
- [ ] Manual: full app works end-to-end with single React root; card content renders, menus work, drag/resize works

---

#### Step 8: Canvas Overlays to React {#step-8}

**Depends on:** #step-7

**Commit:** `refactor(tugdeck): convert canvas overlays (guides, sashes, flash) to React components`

**References:** [D02] React synthetic events, [D03] Ref-based style mutation during drag, Spec S05, (#d02-react-pointer-events, #d03-ref-style-mutation, #deck-canvas-architecture, #new-files)

**Artifacts:**
- New file: `tugdeck/src/components/chrome/snap-guide-line.tsx`
- New file: `tugdeck/src/components/chrome/virtual-sash.tsx`
- New file: `tugdeck/src/components/chrome/set-flash-overlay.tsx`
- Modified: `tugdeck/src/deck-manager.ts` (remove createGuideLines, showGuides, hideGuides, createSashes, attachSashDrag, destroySashes, flashPanels methods; pass guide/sash/flash state to DeckCanvas as props)
- Modified: `tugdeck/src/components/chrome/deck-canvas.tsx` (render SnapGuideLine, VirtualSash, SetFlashOverlay components)

**Tasks:**
- [ ] Create `components/chrome/snap-guide-line.tsx`: stateless component rendering a positioned div for x or y axis guide
- [ ] Create `components/chrome/virtual-sash.tsx`: component with onPointerDown/Move/Up using pointer capture for multi-panel resize; ref-based style mutation during drag; calls DeckManager resize callback on pointerup
- [ ] Create `components/chrome/set-flash-overlay.tsx`: component rendering a bordered overlay div with CSS animation (set-flash-fade); self-removes via onAnimationEnd callback
- [ ] Remove createGuideLines(), showGuides(), hideGuides() from DeckManager; instead, DeckManager sets guide state and passes it to DeckCanvas for rendering
- [ ] Remove createSashes(), attachSashDrag(), destroySashes() from DeckManager; instead, DeckManager computes sash groups and passes them to DeckCanvas
- [ ] Remove flashPanels() from DeckManager; instead, DeckManager sets flashingPanelIds state and passes to DeckCanvas
- [ ] Remove guideElements[] and sashElements[] arrays from DeckManager
- [ ] Update DeckCanvas to render overlay components based on props
- [ ] Preserve CSS class names (.snap-guide-line, .snap-guide-line-x, .snap-guide-line-y, .virtual-sash, .virtual-sash-vertical, .virtual-sash-horizontal, .set-flash-overlay) for visual continuity

**Tests:**
- [ ] RTL: SnapGuideLine renders at correct position for x and y axes
- [ ] RTL: SnapGuideLine hidden when no guides active
- [ ] RTL: VirtualSash renders at shared edge position with correct cursor
- [ ] RTL: VirtualSash onPointerDown initiates drag sequence
- [ ] RTL: SetFlashOverlay renders with animation class, fires onAnimationEnd

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- all tests pass
- [ ] `grep -rn "guideElements\|sashElements\|createGuideLines\|createSashes\|attachSashDrag\|flashPanels" tugdeck/src/deck-manager.ts` -- zero results
- [ ] Manual: drag a card near another -- snap guides appear; snap cards together -- sash appears between them and is draggable; snap creates a set -- flash overlay fires

---

#### Step 9: Event Bridge Cleanup {#step-9}

**Depends on:** #step-7

**Commit:** `refactor(tugdeck): eliminate CustomEvent bridges, add DisconnectBanner React component`

**References:** [D05] DevNotificationContext replaces CustomEvent bridges, Table T01 (#t01-custom-event-map), Spec S06, (#d05-dev-notification-context, #custom-event-map, #new-files)

**Artifacts:**
- New file: `tugdeck/src/components/chrome/disconnect-banner.tsx`
- Modified: `tugdeck/src/connection.ts` (remove showDisconnectBanner, hideDisconnectBanner, updateBannerText, updateBannerCountdown, bannerElement; expose connection state via callbacks or observable for React consumption)
- Modified: `tugdeck/src/action-dispatch.ts` (replace CustomEvent dispatch with DevNotificationContext ref calls)
- Modified: `tugdeck/src/components/cards/developer-card.tsx` (replace document.addEventListener for td-dev-notification and td-dev-build-progress with useContext(DevNotificationContext))
- Modified: `tugdeck/src/components/cards/terminal-card.tsx` (replace document.addEventListener for td-theme-change with useTheme hook)
- Modified: `tugdeck/src/__tests__/action-dispatch.test.ts` (remove td-dev-badge CustomEvent assertions; update to verify DevNotificationContext-based flow)
- Modified: `tugdeck/index.html` (remove `<div id="disconnect-banner">`)

**Tasks:**
- [ ] Create `components/chrome/disconnect-banner.tsx`: reads connection state from a hook wrapping TugConnection's onOpen/onClose callbacks; renders the banner with countdown
- [ ] Remove showDisconnectBanner(), hideDisconnectBanner(), updateBannerText(), updateBannerCountdown() from connection.ts; remove bannerElement field
- [ ] Remove `document.getElementById("disconnect-banner")` from connection.ts
- [ ] Remove `<div id="disconnect-banner">` from index.html
- [ ] Render DisconnectBanner in DeckCanvas tree
- [ ] Update action-dispatch.ts: receive DevNotificationContext ref during initialization; replace `document.dispatchEvent(new CustomEvent("td-dev-notification"))` with `devNotificationRef.current.notify(payload)`
- [ ] Replace `document.dispatchEvent(new CustomEvent("td-dev-build-progress"))` with `devNotificationRef.current.updateBuildProgress(payload)`
- [ ] Replace `document.dispatchEvent(new CustomEvent("td-dev-badge"))` with `devNotificationRef.current.setBadge(componentId, count)`
- [ ] Update developer-card.tsx: replace document.addEventListener("td-dev-notification") with useContext(DevNotificationContext)
- [ ] Update developer-card.tsx: replace document.addEventListener("td-dev-build-progress") with useContext(DevNotificationContext)
- [ ] Update developer-card.tsx: replace `document.dispatchEvent(new CustomEvent("td-dev-badge", { detail: { count } }))` (line 269) with `DevNotificationContext.setBadge("developer", count)` -- DeveloperCard updates badge count via context instead of CustomEvent
- [ ] Update terminal-card.tsx: replace document.addEventListener("td-theme-change") with useTheme hook
- [ ] Update action-dispatch.test.ts: remove td-dev-badge CustomEvent assertions; replace with DevNotificationContext-based verification
- [ ] Update developer-card.test.tsx and terminal-card.test.tsx to work with context-based flow instead of CustomEvents

**Tests:**
- [ ] RTL: DisconnectBanner renders when connection state is disconnected
- [ ] RTL: DisconnectBanner shows countdown text
- [ ] RTL: DisconnectBanner hidden when connected
- [ ] RTL: DeveloperCard receives notifications via DevNotificationContext
- [ ] RTL: terminal-card uses useTheme for theme changes
- [ ] Integration: action-dispatch.ts ref-based notification reaches DeveloperCard via context

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- all tests pass
- [ ] `grep -rn "td-dev-notification\|td-dev-build-progress\|td-dev-badge" tugdeck/src/ --include="*.ts" --include="*.tsx" | grep -v td-hmr` -- zero results (only td-hmr-update remains, which is acceptable)
- [ ] `grep -rn "disconnect-banner" tugdeck/index.html` -- zero results
- [ ] Manual: disconnect the server -- banner appears with countdown, reconnects, banner disappears

---

#### Step 10: CSS Consolidation {#step-10}

**Depends on:** #step-8, #step-9

**Commit:** `refactor(tugdeck): consolidate CSS, replace cards-chrome.css with Tailwind utilities`

**References:** [D01] shadcn DropdownMenu, (#strategy, #constraints, #success-criteria)

**Artifacts:**
- Modified or deleted: `tugdeck/styles/cards-chrome.css` (reduce to minimal chrome.css or delete entirely)
- New file (if needed): `tugdeck/styles/chrome.css` (minimal rules for resize handle hit areas, snap guides, and flash overlays that are clearer as CSS than Tailwind)
- Modified: all React chrome components in `components/chrome/` (add Tailwind utility classes)
- Modified: `tugdeck/src/main.tsx` (update CSS import)

**Tasks:**
- [ ] Audit each CSS rule in cards-chrome.css (404 lines) and categorize:
  - Rules replaced by Tailwind utilities on React components (majority)
  - Rules better kept as CSS (resize handle hit areas, snap guide styling, flash overlay animation)
- [ ] Add Tailwind utility classes to CardFrame, CardHeader, TabBar, and DeckCanvas components
- [ ] Move retained rules to a minimal `tugdeck/styles/chrome.css`
- [ ] Delete cards-chrome.css or replace it with chrome.css
- [ ] Update CSS import in main.tsx
- [ ] Verify visual fidelity: all components look identical after CSS migration

**Tests:**
- [ ] Existing RTL tests continue to pass (CSS class selectors preserved where needed)
- [ ] Visual regression: manual comparison of before/after screenshots

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- all tests pass
- [ ] `wc -l tugdeck/styles/chrome.css` -- under 100 lines (or cards-chrome.css deleted entirely)
- [ ] Manual: full app visual inspection -- all chrome elements look identical to pre-migration state

---

#### Step 11: Final Integration Checkpoint {#step-11}

**Depends on:** #step-10

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Run all success criteria verification commands
- [ ] Full manual smoke test: create all card types, drag/resize/snap, tab operations, menu operations, theme switching, disconnect/reconnect, developer notifications

**Tests:**
- [ ] `cd tugdeck && bun test` -- final aggregate test run covering all components and integration

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- all tests pass
- [ ] `grep -rn "document.createElement" tugdeck/src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v __tests__/ | grep -v "markdown.ts\|conversation-card.tsx"` -- zero results (markdown.ts creates sanitized HTML elements; conversation-card.tsx creates a textarea for clipboard -- both acceptable non-chrome uses)
- [ ] `grep -rn "addEventListener" tugdeck/src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v __tests__/ | grep -v "connection.ts\|markdown.ts\|use-theme.ts"` -- results only in React useEffect patterns (conversation-card.tsx global keydown, terminal-card.tsx xterm integration); use-theme.ts has addEventListener in useEffect with cleanup for td-theme-change sync, which is acceptable
- [ ] `grep -rn "createRoot" tugdeck/src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v __tests__` -- exactly one result (DeckManager)
- [ ] `grep -rn "new CustomEvent" tugdeck/src/ --include="*.ts" --include="*.tsx" | grep -v "td-hmr-update\|td-theme-change\|tool-approval\|question-answer\|question-cancel" | grep -v __tests__/` -- zero results (remaining CustomEvents are acceptable: td-hmr-update self-dispatch, td-theme-change in useTheme, and React-internal conversation events in approval-prompt.tsx and question-card.tsx)
- [ ] Manual: complete end-to-end smoke test passes

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** All tugdeck chrome rendering (CardFrame, CardHeader, CardMenu, Dock, TabBar) and canvas overlays (guide lines, sashes, flash) converted to React components under a unified single React root, with all pointer interactions using React synthetic events, all controls using shadcn, and all cross-component communication using React context/props/callbacks instead of CustomEvent bridges.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Zero vanilla document.createElement calls in the UI layer (excluding test setup)
- [ ] Zero addEventListener calls in the chrome layer (React synthetic events only)
- [ ] Zero native HTML controls -- all interactive elements use shadcn
- [ ] Zero CustomEvent bridges between components (only td-hmr-update self-dispatch and td-theme-change in useTheme remain)
- [ ] One React root for the entire canvas (one createRoot call in DeckManager)
- [ ] All bun tests pass including new RTL tests for each converted component
- [ ] CSS consolidated: dock.css deleted, cards-chrome.css replaced by Tailwind utilities + minimal chrome.css

**Acceptance tests:**
- [ ] `cd tugdeck && bun test` -- 100% pass rate
- [ ] Full manual smoke test covering: card creation, drag, resize, snap, sash resize, tab switch/close/reorder, menu operations, theme switching, disconnect/reconnect, developer notifications/badges

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Convert DeckManager from TypeScript class to React component (hooks for state management)
- [ ] Build custom Tug design system on top of shadcn primitives (component variants, spacing, color, typography, animation)
- [ ] Remove remaining td-theme-change CustomEvent by internalizing theme state entirely within React
- [ ] Performance profiling and optimization of single-root rendering under heavy card layouts
- [ ] Optimize DeckCanvas prop types: convert Map<string, CardConfig> and Map<string, TugCardMeta> to plain objects or use React.memo with custom comparators to avoid unnecessary re-renders from reference-inequality on Map props

| Checkpoint | Verification |
|------------|--------------|
| Chrome components converted | All 5 vanilla files deleted, React replacements pass tests |
| Single React root | One createRoot call, DeckCanvas renders entire tree |
| Overlays converted | Guide lines, sashes, flash overlays render as React components |
| CustomEvent bridges eliminated | grep confirms only acceptable CustomEvents remain |
| CSS consolidated | dock.css deleted, cards-chrome.css replaced |
| All tests pass | `cd tugdeck && bun test` exit code 0 |
