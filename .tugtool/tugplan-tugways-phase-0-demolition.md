<!-- tugplan-skeleton v2 -->

## Tugways Phase 0: Demolition {#tugways-phase-0-demolition}

**Purpose:** Tear down the current tugdeck frontend to a minimal canvas shell -- an empty dark grid connected to the backend with no cards, no dock, and no dead code -- ready for the tugways design system rebuild.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-0-demolition |
| Last updated | 2026-03-02 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current tugdeck frontend is approximately 9700 lines across 60 source files. It was built incrementally and now carries a triple-registration card system, deprecated adapter patterns, and wiring that conflicts with the tugways design system architecture described in `roadmap/design-system-concepts.md`. Before any new tugways concepts can be implemented (theme foundation, responder chain, Tugcard composition, feed abstraction), the conflicting infrastructure must be removed cleanly.

Phase 0 is the first step in the tugways implementation strategy (`roadmap/tugways-implementation-strategy.md`). The goal is a net reduction of approximately 8000 lines, leaving roughly 300 lines of working frontend: a blank canvas that loads, shows a dark grid background, connects to the backend, and produces no console errors. This clean slate provides the foundation for Phase 1 (Theme Foundation) and all subsequent phases.

#### Strategy {#strategy}

- **Archive before delete**: Conversation card sub-components and their logic modules contain real work (~800 lines). Move them to `_archive/cards/conversation/` before deleting card directories.
- **Delete from the leaves inward**: Start with card components and their tests, then card infrastructure (adapter, interface, context, hooks), then the dev notification context, then gut the core modules (main.tsx, DeckManager, DeckCanvas, action-dispatch).
- **Preserve transport and geometry**: `connection.ts`, `protocol.ts`, `snap.ts`, `serialization.ts`, `layout-tree.ts` (minus dead `TabNode`), `settings-api.ts`, and CSS tokens are clean infrastructure with no design conflicts. They survive intact.
- **Keep the disconnect banner**: The `DisconnectBanner` React component provides useful visual feedback during backend reconnect cycles and has no design conflicts. It stays.
- **Gut action-dispatch, do not delete**: The module is in the "What To Keep" table. Remove its `DevNotificationRef` dependency and card-specific handlers; keep the core registry, `reload_frontend`, `reset`, `set-dev-mode`, and `choose-source-tree` handlers.
- **Delete dead tests, not working ones**: Tests that exercise demolished code are deleted. Tests for surviving modules (`snap.test.ts`, `layout-tree.test.ts`, `protocol.test.ts`, `ordering.test.ts`, `conversation-types.test.ts`, `e2e-integration.test.ts`, `scaffold.test.tsx`, `action-dispatch.test.ts`) must continue to pass.
- **Accept a non-compiling intermediate state**: Steps 2 through 4 delete files while modules that import them still exist. The codebase will not compile until the gut steps (5-8) rewrite those modules. This is intentional -- deleting leaves before gutting trunks is the correct dependency order for demolition.
- **Verify at each step**: Every step has a checkpoint. The final step verifies the full contract: app loads, dark grid visible, backend connected, zero console errors, all surviving tests pass.

#### Success Criteria (Measurable) {#success-criteria}

- Frontend loads and displays the dark grid canvas background (`bun run dev`, visual confirmation in browser)
- WebSocket connection to backend is established (`connection.onOpen` fires, `frontendReady` bridge message sent)
- Browser console has zero errors on load (manual inspection or automated check)
- All surviving test files pass with zero failures (`bun test`)
- No TypeScript compilation errors (`bun run build` or `bunx tsc --noEmit`)
- `_archive/cards/conversation/` contains all conversation sub-components and logic modules
- Deleted files are gone: `components/cards/`, `cards/card.ts`, `cards/react-card-adapter.tsx`, `cards/card-context.tsx`, `card-titles.ts`, `drag-state.ts`, `hooks/use-card-meta.ts`, `hooks/use-feed.ts`, `hooks/use-connection.ts`, `contexts/dev-notification-context.tsx`
- `TabNode` type is removed from `layout-tree.ts`
- `action-dispatch.ts` has no `DevNotificationRef` import or dependency

#### Scope {#scope}

1. Delete all card components under `components/cards/` (about, code/conversation, developer, files, git, settings, stats, terminal) and their test files
2. Archive conversation card sub-components and logic modules to `_archive/cards/conversation/`
3. Delete card infrastructure: `cards/card.ts`, `cards/react-card-adapter.tsx` + test, `cards/card-context.tsx`, `cards/setup-test-dom.ts`, `card-titles.ts`, `drag-state.ts`
4. Delete card hooks: `hooks/use-card-meta.ts`, `hooks/use-feed.ts`, `hooks/use-connection.ts`
5. Delete dev notification context: `contexts/dev-notification-context.tsx`
6. Strip `main.tsx` to minimal boot sequence
7. Strip `DeckManager` to hold empty DeckState, own React root, render empty DeckCanvas
8. Strip `DeckCanvas` to render canvas div with grid background and disconnect banner, no panels, no dock
9. Gut `action-dispatch.ts` to remove DevNotificationRef dependency and card-specific handlers
10. Remove dead `TabNode` type from `layout-tree.ts`
11. Delete tests that exercise demolished code
12. Remove xterm.css import from `main.tsx`
13. Remove dead xterm chunk splitting from `vite.config.ts`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Renaming token prefix (`--tl-` to `--tways-`) -- that is Phase 1
- Extracting DeckManager geometric engine into a separate module -- that is Phase 5
- Rebuilding the dock -- that is Phase 8
- Any backend changes -- Phase 0 is frontend-only
- Modifying `connection.ts`, `protocol.ts`, `snap.ts`, or `settings-api.ts` (note: `serialization.ts` requires a minor edit to remove the deleted `CARD_TITLES` import)
- Modifying shadcn primitives under `components/ui/`

#### Dependencies / Prerequisites {#dependencies}

- The tugways implementation strategy document (`roadmap/tugways-implementation-strategy.md`) is committed and provides the phase structure
- The design system concepts document (`roadmap/design-system-concepts.md`) defines the target architecture
- The tugdeck frontend must be in a working state before demolition begins

#### Constraints {#constraints}

- **No backend changes**: The backend still sends frames. Without card subscribers, `connection.ts` silently drops them (no registered callbacks). This is expected and safe.
- **bun, not npm**: All JavaScript tooling uses `bun` per project policy
- **Surviving tests must pass**: `snap.test.ts`, `layout-tree.test.ts`, `protocol.test.ts` (lives at `src/protocol.test.ts`, not `__tests__/`), `ordering.test.ts`, `conversation-types.test.ts`, `e2e-integration.test.ts`, `scaffold.test.tsx`, `action-dispatch.test.ts`, `disconnect-banner.test.tsx` must all pass with zero failures after demolition

#### Assumptions {#assumptions}

- The xterm.css import in `main.tsx` will be removed along with the TerminalCard -- no terminal card means no need for xterm styles in Phase 0
- The settings API fetch and theme application logic in `main.tsx` will be retained in stripped form -- fetch settings, apply theme class to body -- since the strategy explicitly lists these steps as part of the Phase 0 boot sequence
- The `_archive/` directory is created at `tugdeck/src/_archive/` (within the source tree for easy revival)
- The `lib/markdown.ts` file is kept as-is since `e2e-integration.test.ts` imports from it and is not in the demolition scope
- The `hooks/use-theme.ts` file is kept as-is since it will be needed by the stripped DeckManager/DeckCanvas for theme support
- `action-dispatch.ts` will be gutted to remove its `DevNotificationRef` dependency but kept since the strategy lists it in the "What To Keep" table; the `show-card` action becomes a no-op stub for Phase 0

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All clarification has been resolved through user answers and assumptions.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Backend frames dropped silently | low | high | connection.ts has no registered callbacks; frames are a no-op | If backend health checks depend on frame acknowledgment |
| Surviving tests break due to import chain | med | med | Fix each broken import; the test list is explicit | Any test failure after demolition |
| Archive directory loses files during later work | low | low | Archive is committed to git; files are recoverable | Before Phase 9 card rebuild begins |

**Risk R01: Import chain breakage in surviving tests** {#r01-import-chain-breakage}

- **Risk:** Some surviving tests may transitively import demolished modules (e.g., `action-dispatch.test.ts` imports `DevNotificationRef` type from `dev-notification-context.tsx`)
- **Mitigation:** After each deletion step, run `bunx tsc --noEmit` and `bun test` to catch breakage immediately. Fix imports before proceeding.
- **Residual risk:** The `action-dispatch.test.ts` file will need its mock `DevNotificationRef` removed, which requires updating the test alongside the module gut.

**Risk R02: DeckManager geometric rendering pipeline must be removed** {#r02-deckmanager-gut-scope}

- **Risk:** The geometric rendering pipeline in DeckManager depends on types from deleted chrome files (`SashGroup`/`PanelSnapshot` from `virtual-sash.tsx`, `PanelFlashConfig`/`DeckCanvasHandle` from `deck-canvas.tsx`, `CARD_TITLE_BAR_HEIGHT` from `card-frame.tsx`, `DockCallbacks` from `dock.tsx`). This means nearly all geometric rendering methods must be removed -- not just the card wiring.
- **Mitigation:** The underlying spatial math lives in `snap.ts` (computeSnap, computeResizeSnap, findSharedEdges, computeSets) and has zero dependencies on deleted files. It survives intact. Only the DeckManager methods that thread snap results through deleted chrome types are removed. Phase 5 will re-integrate snap.ts math with new chrome components.
- **Residual risk:** Phase 5 must re-implement the rendering pipeline that connects snap.ts math to the new DeckCanvas. The math is preserved; the rendering glue is not.

---

### Design Decisions {#design-decisions}

#### [D01] Archive conversation sub-components and logic in _archive/cards/conversation/ (DECIDED) {#d01-archive-conversation}

**Decision:** Conversation card sub-components (approval-prompt, attachment-handler, code-block, message-renderer, question-card, streaming-state, tool-card) and conversation logic modules (code-block-utils, ordering, session-cache, types) are moved to `tugdeck/src/_archive/cards/conversation/` rather than deleted outright.

**Rationale:**
- These contain approximately 800 lines of real rendering and parsing work
- They will be revived when the code card is rebuilt in Phase 9
- The user explicitly chose "Archive in _archive/" over deletion

**Implications:**
- The `_archive/` directory is committed to git and survives across branches
- Archived files are not imported by any surviving module -- dead code by design
- Tests for archived components are archived alongside them (not in `__tests__/`)

#### [D02] Delete dead tests rather than archiving them (DECIDED) {#d02-delete-dead-tests}

**Decision:** Tests that exercise demolished code (card component tests, card infrastructure tests, chrome component tests for removed components) are deleted outright rather than archived.

**Rationale:**
- The user explicitly chose "Delete them -- They test demolished code and a clean test suite is the goal"
- These tests will be rewritten from scratch for the new Tugcard-based components
- Archiving tests alongside code they test is confusing; the code is archived, the tests are not

**Implications:**
- Deleted test files: `canvas-overlays.test.tsx`, `card-dropdown-menu.test.tsx`, `card-frame-react.test.tsx`, `card-header-react.test.tsx`, `deck-canvas.test.tsx`, `deck-manager.test.ts`, `dev-notification-context.test.tsx`, `dock-react.test.tsx`, `tab-bar-react.test.tsx`
- Also deleted: card-level test files under `components/cards/` and `cards/react-card-adapter.test.tsx`, `cards/setup-test-dom.ts`, `components/cards/setup-test-dom.ts`
- Note: `disconnect-banner.test.tsx` is NOT deleted (the component survives per [D03]); `cards/conversation/session-cache.test.ts` is archived (not deleted) per [D01]

#### [D03] Keep the disconnect banner (DECIDED) {#d03-keep-disconnect-banner}

**Decision:** The `DisconnectBanner` React component (`components/chrome/disconnect-banner.tsx`) survives Phase 0 and is rendered by the stripped DeckCanvas.

**Rationale:**
- The user explicitly chose "Keep it -- Provides useful feedback during backend reconnect cycles"
- It depends only on `TugConnection` (which is kept) and has no card or dock dependencies
- It provides useful visual feedback during development

**Implications:**
- `DeckCanvas` must still accept a `connection` prop to pass to `DisconnectBanner`
- The `disconnect-banner.test.tsx` test file is retained (the component survives)

#### [D04] Gut action-dispatch to remove DevNotificationRef and card handlers (DECIDED) {#d04-gut-action-dispatch}

**Decision:** `action-dispatch.ts` is stripped of its `DevNotificationRef` import/dependency, `dev_notification` handler, `dev_build_progress` handler, `show-card` handler (becomes no-op stub or removed), `focus-card` handler, and `close-card` handler. The core registry (`registerAction`, `dispatchAction`, `_resetForTest`), `initActionDispatch` (with simplified signature), `reload_frontend`, `reset`, `set-dev-mode`, and `choose-source-tree` handlers are retained.

**Rationale:**
- The strategy lists `action-dispatch.ts` in the "What To Keep" table with note "Extend for new actions"
- The DevNotificationRef dependency couples it to the demolished context
- Card-specific handlers (`show-card`, `focus-card`, `close-card`, `dev_notification`, `dev_build_progress`) reference demolished DeckManager methods and card infrastructure

**Implications:**
- `initActionDispatch` signature changes: removes `devNotificationRefArg` parameter, removes DeckManager methods that no longer exist
- The `action-dispatch.test.ts` must be updated to match the new module shape
- Mac menu commands that trigger `show-card` will be no-ops until Phase 5 rebuilds card creation

#### [D05] Strip DeckManager to empty shell (DECIDED) {#d05-strip-deckmanager}

**Decision:** DeckManager is stripped to: hold an empty `DeckState`, own a single React root, render an empty `DeckCanvas`. All card registration, factory, `cardsByFeed` fan-out, `cardMetas`, `DevNotificationRef`, dock callback wiring, and `keydownHandler` code are removed. The geometric rendering pipeline (sash groups, flash overlays, docked corners, position offsets, snap guides, set-move context, and all methods that produce/consume these through deleted chrome types) is also removed. The underlying math in `snap.ts` survives as standalone utility code.

**Rationale:**
- Phase 0 goal is an empty canvas; no panels means no geometric operations execute
- The geometric rendering pipeline threads through deleted chrome types (`SashGroup`/`PanelSnapshot` from `virtual-sash.tsx`, `PanelFlashConfig` from `deck-canvas.tsx`, `CARD_TITLE_BAR_HEIGHT` from `card-frame.tsx`, `DockCallbacks` from `dock.tsx`). These types cannot be retained without keeping the deleted files.
- The spatial math (snap computation, set detection, shared edge finding) lives in `snap.ts` and has zero dependencies on deleted files. It survives intact and will be re-integrated in Phase 5.

**Implications:**
- DeckManager constructor signature simplifies: takes `container`, `connection`, optional `prefetchedLayout`
- DeckManager no longer implements `IDragState` (that interface is deleted)
- The `render()` method renders `<DeckCanvas connection={...} />` wrapped in `<ErrorBoundary>` -- no panels, no overlays, no complex props
- `sendControlFrame()` method is retained (used by future phases and the native bridge)
- Layout persistence (serialize/deserialize/save) remains functional but operates on empty state
- The resulting DeckManager is approximately 100-150 lines: constructor, render, refresh, getDeckState, sendControlFrame, and layout persistence

#### [D06] Remove xterm.css import from main.tsx (DECIDED) {#d06-remove-xterm-css}

**Decision:** The `import "@xterm/xterm/css/xterm.css"` line in `main.tsx` is removed in Phase 0.

**Rationale:**
- No terminal card exists after demolition
- xterm styles add unnecessary bytes to the bundle
- The import will be re-added when the terminal card is rebuilt in Phase 9

**Implications:**
- None for Phase 0 (no terminal card to style)

---

### Deep Dives (Optional) {#deep-dives}

#### File Inventory: What Gets Deleted, Archived, Gutted, or Kept {#file-inventory}

**Table T01: File Disposition** {#t01-file-disposition}

| File | Disposition | Notes |
|------|-------------|-------|
| `components/cards/about-card.tsx` + test | DELETE | |
| `components/cards/developer-card.tsx` + test | DELETE | |
| `components/cards/files-card.tsx` + test | DELETE | |
| `components/cards/git-card.tsx` + test | DELETE | |
| `components/cards/settings-card.tsx` + test | DELETE | |
| `components/cards/stats-card.tsx` + test | DELETE | |
| `components/cards/terminal-card.tsx` + test | DELETE | |
| `components/cards/setup-test-dom.ts` | DELETE | |
| `components/cards/conversation/*.tsx` + tests | ARCHIVE to `_archive/cards/conversation/` | UI sub-components |
| `components/cards/conversation/setup-test-dom.ts` | ARCHIVE | |
| `cards/conversation/code-block-utils.ts` | ARCHIVE to `_archive/cards/conversation/` | Logic module |
| `cards/conversation/ordering.ts` | ARCHIVE to `_archive/cards/conversation/` | Logic module |
| `cards/conversation/session-cache.ts` + test | ARCHIVE to `_archive/cards/conversation/` | Logic module |
| `cards/conversation/types.ts` | ARCHIVE to `_archive/cards/conversation/` | Type definitions |
| `cards/card.ts` | DELETE | `TugCard` interface, deprecated methods |
| `cards/react-card-adapter.tsx` + test | DELETE | Adapter pattern replaced by Tugcard |
| `cards/card-context.tsx` | DELETE | Replaced by Tugcard context |
| `cards/setup-test-dom.ts` | DELETE | |
| `card-titles.ts` | DELETE | Simple string map |
| `drag-state.ts` | DELETE | `IDragState` collapses into DeckManager |
| `hooks/use-card-meta.ts` | DELETE | Tied to CardContext |
| `hooks/use-feed.ts` | DELETE | Tied to CardContext |
| `hooks/use-connection.ts` | DELETE | Tied to CardContext |
| `contexts/dev-notification-context.tsx` | DELETE | Notification routing rebuilt later |
| `main.tsx` | GUT | Strip to minimal boot sequence |
| `deck-manager.ts` | GUT | Strip to empty shell (see [D05]) |
| `components/chrome/deck-canvas.tsx` | GUT | Empty canvas with disconnect banner |
| `action-dispatch.ts` | GUT | Remove DevNotificationRef, card handlers |
| `layout-tree.ts` | MODIFY | Remove dead `TabNode` type |
| `components/chrome/card-frame.tsx` | DELETE | No panels to frame |
| `components/chrome/card-header.tsx` | DELETE | No panels to head |
| `components/chrome/card-dropdown-menu.tsx` | DELETE | No panels, no menu |
| `components/chrome/dock.tsx` | DELETE | No dock in Phase 0 |
| `components/chrome/tab-bar.tsx` | DELETE | No tabs |
| `components/chrome/snap-guide-line.tsx` | DELETE | No panels, no guides |
| `components/chrome/virtual-sash.tsx` | DELETE | No panels, no sashes |
| `components/chrome/set-flash-overlay.tsx` | DELETE | No panels, no flash |
| `components/chrome/error-boundary.tsx` | KEEP | Useful general infrastructure |
| `components/chrome/disconnect-banner.tsx` | KEEP | Per [D03] |
| `connection.ts` | KEEP | Clean WebSocket client |
| `protocol.ts` + test | KEEP | Binary frame protocol |
| `snap.ts` | KEEP | Spatial geometry math |
| `serialization.ts` | MODIFY | Remove `CARD_TITLES` import; inline title strings in `buildDefaultLayout()` |
| `settings-api.ts` | KEEP | Settings fetch/post |
| `hooks/use-theme.ts` | KEEP | Theme switching |
| `lib/utils.ts` | KEEP | `cn()` utility |
| `lib/markdown.ts` | KEEP | Used by e2e-integration.test.ts |
| `globals.css` | KEEP | Tailwind/token bridge |
| `vite.config.ts` | MODIFY | Remove dead xterm manual chunk splitting |
| `components/ui/*.tsx` | KEEP | shadcn primitives |

**Table T02: Test File Disposition** {#t02-test-file-disposition}

| Test File | Disposition | Reason |
|-----------|-------------|--------|
| `__tests__/snap.test.ts` | KEEP | Tests surviving snap.ts |
| `__tests__/layout-tree.test.ts` | KEEP (update) | Tests surviving layout-tree.ts; update to remove TabNode tests |
| `src/protocol.test.ts` (note: not in `__tests__/`) | KEEP | Tests surviving protocol.ts |
| `__tests__/ordering.test.ts` | KEEP (update imports) | Tests ordering logic; update import paths to `_archive/` |
| `__tests__/conversation-types.test.ts` | KEEP (update imports) | Tests type definitions; update import paths to `_archive/` |
| `__tests__/e2e-integration.test.ts` | KEEP (update imports) | Tests markdown utilities; update session-cache import to `_archive/` |
| `__tests__/scaffold.test.tsx` | KEEP | Tests shadcn Button rendering |
| `__tests__/action-dispatch.test.ts` | KEEP (update) | Tests surviving action-dispatch.ts; update mocks |
| `__tests__/setup-rtl.ts` | KEEP | Test setup infrastructure |
| `__tests__/canvas-overlays.test.tsx` | DELETE | Tests demolished snap guide/sash/flash components |
| `__tests__/card-dropdown-menu.test.tsx` | DELETE | Tests demolished component |
| `__tests__/card-frame-react.test.tsx` | DELETE | Tests demolished component |
| `__tests__/card-header-react.test.tsx` | DELETE | Tests demolished component |
| `__tests__/deck-canvas.test.tsx` | DELETE | Tests demolished DeckCanvas shape |
| `__tests__/deck-manager.test.ts` | DELETE | Tests demolished DeckManager shape |
| `__tests__/dev-notification-context.test.tsx` | DELETE | Tests demolished context |
| `__tests__/disconnect-banner.test.tsx` | KEEP | Tests surviving component |
| `__tests__/dock-react.test.tsx` | DELETE | Tests demolished dock |
| `__tests__/tab-bar-react.test.tsx` | DELETE | Tests demolished tab bar |

---

### Specification {#specification}

#### Stripped main.tsx Boot Sequence {#stripped-main-boot}

**Spec S01: main.tsx after Phase 0** {#s01-main-boot}

The stripped `main.tsx` performs exactly these steps in order:

1. Import `globals.css` and `chrome.css` (no xterm.css)
2. Import `TugConnection`, `DeckManager`, `fetchSettingsWithRetry`, `initActionDispatch`
3. Construct `TugConnection` with WebSocket URL derived from `window.location.host`
4. Get `deck-container` element from DOM
5. Async IIFE:
   a. Fetch settings with retry (`fetchSettingsWithRetry`)
   b. Apply theme to `document.body` (remove stale theme classes, add new one)
   c. Construct `DeckManager(container, connection, prefetchedLayout)`
   d. Call `initActionDispatch(connection, deckManager)` (no DevNotificationRef)
   e. Register `connection.onOpen` to post `frontendReady` to native bridge
   f. Call `connection.connect()`
   g. Log "tugdeck initialized"

No card imports. No card configs. No card factories. No card instances. No dock callbacks.

#### Stripped DeckManager Shape {#stripped-deckmanager-shape}

**Spec S02: DeckManager after Phase 0** {#s02-deckmanager-shape}

```typescript
class DeckManager {
  // Kept fields
  private container: HTMLElement;
  private connection: TugConnection;
  private deckState: DeckState; // { cards: [] }
  private reactRoot: Root | null;
  private deckCanvasRef: React.RefObject<DeckCanvasHandle | null>;
  private saveTimer: number | null;

  // Kept methods
  constructor(container, connection, prefetchedLayout?)
  getDeckState(): DeckState
  render(): void  // renders empty DeckCanvas
  refresh(): void
  sendControlFrame(action: string): void

  // Removed — card wiring:
  //   cardsByFeed, lastPayload, cardRegistry, cardConfigs,
  //   cardFactories, cardMetas, keyPanelId, _isDragging, keydownHandler,
  //   devNotificationRef, dockCallbacks, registerCardConfig(),
  //   registerCardFactory(), addCard(), removeCard(), findPanelByComponent(),
  //   closePanelByComponent(), addNewCard(), getCardRegistry(),
  //   getDevNotificationRef(), setDockCallbacks(), focusPanel()

  // Removed — geometric rendering pipeline (depends on deleted chrome types):
  //   sashGroups (SashGroup from virtual-sash.tsx — deleted)
  //   flashingPanels (PanelFlashConfig from deck-canvas.tsx — gutted)
  //   dockedCorners, positionOffsets (passed as DeckCanvas props — gutted)
  //   guides (GuidePosition — snap.ts type survives, but no DeckCanvas prop to consume it)
  //   sets, sharedEdges (CardSet/SharedEdge — snap.ts types survive, but
  //     recomputeSets() calls updateDockedStyles() which uses deleted types)
  //   _setMoveContext, _dragInitialSetKey, _dragBreakOutFired, soloOverridePanels
  //   CARD_TITLE_BAR_HEIGHT import (from card-frame.tsx — deleted)
  //   All onMoving/onResizing/onMoveEnd/onResizeEnd methods that reference
  //     DeckCanvasHandle imperative methods, SashGroup, PanelSnapshot, etc.
  //   recomputeSets(), updateDockedStyles(), all sash/flash/guide methods

  // NOTE: snap.ts, computeSnap, computeResizeSnap, findSharedEdges,
  //   computeSets etc. survive as standalone utility code. They are imported
  //   by DeckManager but not called at runtime (no panels). The imports can
  //   remain or be removed — either way compiles clean since snap.ts has no
  //   deleted-type dependencies.
}
```

In practice, the Phase 0 DeckManager will be a small shell (~100-150 lines): constructor, render(), refresh(), getDeckState(), sendControlFrame(), and layout persistence. Nearly all the geometric rendering pipeline must be removed because it threads through deleted chrome types (SashGroup, PanelSnapshot, PanelFlashConfig, DeckCanvasHandle imperative methods, CARD_TITLE_BAR_HEIGHT). The underlying math in `snap.ts` survives untouched and will be re-integrated in Phase 5.

#### Stripped DeckCanvas Shape {#stripped-deckcanvas-shape}

**Spec S03: DeckCanvas after Phase 0** {#s03-deckcanvas-shape}

```tsx
interface DeckCanvasProps {
  connection: TugConnection | null;
}

interface DeckCanvasHandle {
  // Minimal or empty handle
}

const DeckCanvas = forwardRef<DeckCanvasHandle, DeckCanvasProps>(
  function DeckCanvas({ connection }, ref) {
    useImperativeHandle(ref, () => ({}), []);
    return (
      <>
        <DisconnectBanner connection={connection} />
      </>
    );
  }
);
```

The canvas `div` with grid background is provided by `#deck-container` in `index.html` and styled by `globals.css`. DeckCanvas renders inside it.

#### Stripped action-dispatch.ts Shape {#stripped-action-dispatch-shape}

**Spec S04: action-dispatch.ts after Phase 0** {#s04-action-dispatch-shape}

```typescript
// Kept exports
export type ActionHandler = (payload: Record<string, unknown>) => void;
export function registerAction(action: string, handler: ActionHandler): void;
export function dispatchAction(payload: Record<string, unknown>): void;
export function _resetForTest(): void;

// Simplified initActionDispatch -- no DevNotificationRef param
export function initActionDispatch(
  connection: TugConnection,
  deckManager: DeckManager
): void;

// Kept handlers registered by initActionDispatch:
//   "reload_frontend" -- reload page with dedup guard
//   "reset" -- clear localStorage
//   "set-dev-mode" -- call WKScriptMessageHandler bridge
//   "choose-source-tree" -- call WKScriptMessageHandler bridge

// Removed handlers:
//   "show-card", "focus-card", "close-card"
//   "dev_notification", "dev_build_progress"

// Removed: devNotificationRef module variable, DevNotificationRef import
```

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New crates (if any) {#new-crates}

None.

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/_archive/cards/conversation/` | Archive directory for conversation sub-components and logic |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TabNode` | interface (REMOVE) | `layout-tree.ts` | Dead type, unused |
| `initActionDispatch` | fn (MODIFY) | `action-dispatch.ts` | Remove `devNotificationRefArg` parameter |
| `DeckManager` | class (GUT) | `deck-manager.ts` | Remove card wiring, keep geometric shell |
| `DeckCanvas` | component (GUT) | `deck-canvas.tsx` | Render only disconnect banner |
| `DeckCanvasProps` | interface (SIMPLIFY) | `deck-canvas.tsx` | Reduce to `connection` prop |
| `DeckCanvasHandle` | interface (SIMPLIFY) | `deck-canvas.tsx` | Empty or minimal |
| `buildDefaultLayout` | fn (MODIFY) | `serialization.ts` | Inline title strings, remove `CARD_TITLES` import |

---

### Documentation Plan {#documentation-plan}

- [ ] No external documentation changes required for Phase 0 (demolition is internal)
- [ ] Verify the tugways implementation strategy document (`roadmap/tugways-implementation-strategy.md`) remains accurate after demolition

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Surviving unit tests** | Verify modules untouched by demolition still pass | After every deletion step |
| **Updated unit tests** | Verify gutted modules (action-dispatch, layout-tree) work with new shape | After gut steps |
| **TypeScript compilation** | Catch broken imports and stale references | After every step |
| **Manual smoke test** | Verify app loads, dark grid, backend connection, no errors | Final step |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers -- add an anchor instead.

#### Step 1: Archive conversation sub-components and logic modules {#step-1}

<!-- Step 1 has no dependencies (it is the root) -->

**Commit:** `refactor(tugdeck): archive conversation card sub-components to _archive/`

**References:** [D01] Archive conversation sub-components, Table T01 (#t01-file-disposition), (#context, #strategy)

**Artifacts:**
- New directory: `tugdeck/src/_archive/cards/conversation/`
- Moved files: all `components/cards/conversation/*.tsx`, `*.test.tsx`, `setup-test-dom.ts`
- Moved files: all `cards/conversation/*.ts` (code-block-utils, ordering, session-cache + test, types)

**Tasks:**
- [ ] Create directory `tugdeck/src/_archive/cards/conversation/`
- [ ] Move all files from `tugdeck/src/components/cards/conversation/` to `tugdeck/src/_archive/cards/conversation/` (approval-prompt.tsx + test, attachment-handler.tsx + test, code-block.tsx + test, conversation-card.tsx + test, message-renderer.tsx + test, question-card.tsx + test, streaming-state.tsx, tool-card.tsx + test, setup-test-dom.ts)
- [ ] Move all files from `tugdeck/src/cards/conversation/` to `tugdeck/src/_archive/cards/conversation/` (code-block-utils.ts, ordering.ts, session-cache.ts + test, types.ts)
- [ ] Update import paths in surviving test files that reference the moved modules:
  - `__tests__/ordering.test.ts`: change `../cards/conversation/ordering` and `../cards/conversation/types` to `../_archive/cards/conversation/ordering` and `../_archive/cards/conversation/types`
  - `__tests__/conversation-types.test.ts`: change `../cards/conversation/types` to `../_archive/cards/conversation/types`
  - `__tests__/e2e-integration.test.ts`: change `../cards/conversation/session-cache` to `../_archive/cards/conversation/session-cache`
- [ ] Verify the source directories are now empty (can be deleted in next step)

**Tests:**
- [ ] Verify the three updated test files have no broken imports (compilation will be checked later once gut steps complete)

**Checkpoint:**
- [ ] `ls tugdeck/src/_archive/cards/conversation/` shows all archived files
- [ ] `ls tugdeck/src/components/cards/conversation/` shows empty or directory removed
- [ ] `ls tugdeck/src/cards/conversation/` shows empty or directory removed
- [ ] `grep -r "cards/conversation/" tugdeck/src/__tests__/` shows only `_archive/cards/conversation/` paths (no stale imports)

---

#### Step 2: Delete card components, card infrastructure, card hooks, and dev notification context {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(tugdeck): delete card components, infrastructure, hooks, and dev notification context`

**References:** [D02] Delete dead tests, Table T01 (#t01-file-disposition), (#scope)

**Artifacts:**
- Deleted: `components/cards/` directory (about, developer, files, git, settings, stats, terminal cards + tests + setup-test-dom)
- Deleted: `cards/card.ts`, `cards/react-card-adapter.tsx`, `cards/react-card-adapter.test.tsx`, `cards/card-context.tsx`, `cards/setup-test-dom.ts`
- Deleted: `card-titles.ts`, `drag-state.ts`
- Deleted: `hooks/use-card-meta.ts`, `hooks/use-feed.ts`, `hooks/use-connection.ts`
- Deleted: `contexts/dev-notification-context.tsx`
- Deleted: empty `cards/` directory, empty `components/cards/` directory, empty `contexts/` directory

**Tasks:**
- [ ] Delete `tugdeck/src/components/cards/` directory entirely (all remaining card files: about-card.tsx + test, developer-card.tsx + test, files-card.tsx + test, git-card.tsx + test, settings-card.tsx + test, stats-card.tsx + test, terminal-card.tsx + test, setup-test-dom.ts)
- [ ] Delete `tugdeck/src/cards/card.ts`
- [ ] Delete `tugdeck/src/cards/react-card-adapter.tsx` and `tugdeck/src/cards/react-card-adapter.test.tsx`
- [ ] Delete `tugdeck/src/cards/card-context.tsx`
- [ ] Delete `tugdeck/src/cards/setup-test-dom.ts`
- [ ] Delete `tugdeck/src/cards/` directory (should now be empty)
- [ ] Delete `tugdeck/src/card-titles.ts`
- [ ] Delete `tugdeck/src/drag-state.ts`
- [ ] Delete `tugdeck/src/hooks/use-card-meta.ts`
- [ ] Delete `tugdeck/src/hooks/use-feed.ts`
- [ ] Delete `tugdeck/src/hooks/use-connection.ts`
- [ ] Delete `tugdeck/src/contexts/dev-notification-context.tsx`
- [ ] Delete `tugdeck/src/contexts/` directory (should now be empty)

**Tests:**
- [ ] No test execution yet -- code that imports these modules will break until gut steps are done

**Checkpoint:**
- [ ] `ls tugdeck/src/components/cards/` fails (directory gone)
- [ ] `ls tugdeck/src/cards/` fails (directory gone)
- [ ] `ls tugdeck/src/contexts/` fails (directory gone)
- [ ] `ls tugdeck/src/hooks/` shows only `use-theme.ts`

---

#### Step 3: Delete dead test files {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(tugdeck): delete test files for demolished components`

**References:** [D02] Delete dead tests, Table T02 (#t02-test-file-disposition), (#strategy)

**Artifacts:**
- Deleted test files: `canvas-overlays.test.tsx`, `card-dropdown-menu.test.tsx`, `card-frame-react.test.tsx`, `card-header-react.test.tsx`, `deck-canvas.test.tsx`, `deck-manager.test.ts`, `dev-notification-context.test.tsx`, `dock-react.test.tsx`, `tab-bar-react.test.tsx`

**Tasks:**
- [ ] Delete `tugdeck/src/__tests__/canvas-overlays.test.tsx`
- [ ] Delete `tugdeck/src/__tests__/card-dropdown-menu.test.tsx`
- [ ] Delete `tugdeck/src/__tests__/card-frame-react.test.tsx`
- [ ] Delete `tugdeck/src/__tests__/card-header-react.test.tsx`
- [ ] Delete `tugdeck/src/__tests__/deck-canvas.test.tsx`
- [ ] Delete `tugdeck/src/__tests__/deck-manager.test.ts`
- [ ] Delete `tugdeck/src/__tests__/dev-notification-context.test.tsx`
- [ ] Delete `tugdeck/src/__tests__/dock-react.test.tsx`
- [ ] Delete `tugdeck/src/__tests__/tab-bar-react.test.tsx`

**Tests:**
- [ ] No test execution yet -- surviving tests may still fail due to unfinished gut steps

**Checkpoint:**
- [ ] `ls tugdeck/src/__tests__/` shows only: `action-dispatch.test.ts`, `conversation-types.test.ts`, `disconnect-banner.test.tsx`, `e2e-integration.test.ts`, `layout-tree.test.ts`, `ordering.test.ts`, `scaffold.test.tsx`, `setup-rtl.ts`, `snap.test.ts`

---

#### Step 4: Delete demolished chrome components {#step-4}

**Depends on:** #step-3

**Commit:** `refactor(tugdeck): delete demolished chrome components`

**References:** Table T01 (#t01-file-disposition), (#scope)

**Artifacts:**
- Deleted: `components/chrome/card-frame.tsx`, `card-header.tsx`, `card-dropdown-menu.tsx`, `dock.tsx`, `tab-bar.tsx`, `snap-guide-line.tsx`, `virtual-sash.tsx`, `set-flash-overlay.tsx`
- Kept: `components/chrome/deck-canvas.tsx` (will be gutted), `disconnect-banner.tsx`, `error-boundary.tsx`

**Tasks:**
- [ ] Delete `tugdeck/src/components/chrome/card-frame.tsx`
- [ ] Delete `tugdeck/src/components/chrome/card-header.tsx`
- [ ] Delete `tugdeck/src/components/chrome/card-dropdown-menu.tsx`
- [ ] Delete `tugdeck/src/components/chrome/dock.tsx`
- [ ] Delete `tugdeck/src/components/chrome/tab-bar.tsx`
- [ ] Delete `tugdeck/src/components/chrome/snap-guide-line.tsx`
- [ ] Delete `tugdeck/src/components/chrome/virtual-sash.tsx`
- [ ] Delete `tugdeck/src/components/chrome/set-flash-overlay.tsx`

**Tests:**
- [ ] No test execution yet -- gut steps still needed

**Checkpoint:**
- [ ] `ls tugdeck/src/components/chrome/` shows only: `deck-canvas.tsx`, `disconnect-banner.tsx`, `error-boundary.tsx`

---

#### Step 5: Gut DeckCanvas to empty canvas shell {#step-5}

**Depends on:** #step-4

**Commit:** `refactor(tugdeck): strip DeckCanvas to empty canvas with disconnect banner`

**References:** [D03] Keep disconnect banner, [D05] Strip DeckManager to empty shell, Spec S03 (#s03-deckcanvas-shape), (#stripped-deckcanvas-shape)

**Artifacts:**
- Modified: `tugdeck/src/components/chrome/deck-canvas.tsx` -- stripped to minimal component

**Tasks:**
- [ ] Rewrite `deck-canvas.tsx` per Spec S03: remove all imports of deleted components (CardFrame, TabBar, Dock, CardContextProvider, SnapGuideLine, VirtualSash, SetFlashOverlay)
- [ ] Remove `CardConfig`, `CardContent`, `PanelContainer`, `CanvasCallbacks`, `PanelFlashConfig` types/components
- [ ] Simplify `DeckCanvasProps` to just `connection: TugConnection | null`
- [ ] Simplify `DeckCanvasHandle` to empty object
- [ ] Component renders only `<DisconnectBanner connection={connection} />`
- [ ] Remove all panel rendering, feed data state, panel element refs, imperative handle methods, callbacks ref, and meta update handling

**Tests:**
- [ ] No test execution yet -- DeckManager still references old types

**Checkpoint:**
- [ ] `wc -l tugdeck/src/components/chrome/deck-canvas.tsx` shows approximately 30-50 lines
- [ ] File compiles with no type errors in isolation (may have module resolution issues until DeckManager is gutted)

---

#### Step 6: Gut DeckManager to empty shell {#step-6}

**Depends on:** #step-5

**Commit:** `refactor(tugdeck): strip DeckManager to empty canvas shell`

**References:** [D05] Strip DeckManager to empty shell, Spec S02 (#s02-deckmanager-shape), Risk R02 (#r02-deckmanager-gut-scope), Table T01 (#t01-file-disposition), (#strategy)

**Artifacts:**
- Modified: `tugdeck/src/deck-manager.ts` -- stripped to empty shell
- Modified: `tugdeck/src/serialization.ts` -- removed `CARD_TITLES` import, inlined title strings

**Tasks:**
- [ ] Remove all imports of deleted modules: `TugCard`, `TugCardMeta` from `cards/card`, `CARD_TITLES` from `card-titles`, `IDragState` from `drag-state`, `DevNotificationProvider`/`DevNotificationRef` from `contexts/dev-notification-context`, `CardConfig`/`CanvasCallbacks`/`PanelFlashConfig`/`DeckCanvasHandle` complex types from `deck-canvas`, `CardFrame`/`CARD_TITLE_BAR_HEIGHT` from `card-frame`, `DockCallbacks` from `dock`, `SashGroup`/`PanelSnapshot` from `virtual-sash`
- [ ] Remove `implements IDragState` from class declaration
- [ ] Remove card registration fields: `cardsByFeed`, `lastPayload`, `cardRegistry`, `cardConfigs`, `cardFactories`, `cardMetas`
- [ ] Remove app wiring fields: `keyPanelId`, `_isDragging`, `keydownHandler`, `devNotificationRef`, dock-related fields
- [ ] Remove `OUTPUT_FEED_IDS` constant and `titleForComponent` function
- [ ] Remove card-related methods: `registerCardConfig`, `registerCardFactory`, `addCard`, `removeCard`, `findPanelByComponent`, `closePanelByComponent`, `addNewCard`, `getCardRegistry`, `getDevNotificationRef`, `setDockCallbacks`, `focusPanel`, `isDragging` getter
- [ ] Remove card-related constructor code: keydown handler, feed registration on connection
- [ ] Remove geometric rendering pipeline that depends on deleted chrome types:
  - Fields: `sashGroups` (uses `SashGroup` from deleted `virtual-sash.tsx`), `flashingPanels` (uses `PanelFlashConfig` from gutted `deck-canvas.tsx`), `dockedCorners`, `positionOffsets`, `guides`, `sets`, `sharedEdges`, `_setMoveContext`, `_dragInitialSetKey`, `_dragBreakOutFired`, `soloOverridePanels`
  - Methods: `recomputeSets()`, `updateDockedStyles()`, all sash/flash/guide-related methods, `onMoving()`, `onResizing()`, `onMoveEnd()`, `onResizeEnd()` (these thread through `DeckCanvasHandle` imperative methods and deleted types)
  - Constants: `CARD_TITLE_BAR_HEIGHT` import (from deleted `card-frame.tsx`)
- [ ] Simplify `render()`: render `<DeckCanvas connection={this.connection} />` wrapped in `<ErrorBoundary>` (no DevNotificationProvider, no complex props)
- [ ] Keep constructor basics: container, connection, deckState initialization, React root creation, initial render
- [ ] Keep `getDeckState()`, `refresh()` (calls render), `sendControlFrame()`
- [ ] Keep layout persistence methods (serialize, deserialize, save debounce) -- they operate on DeckState, not cards
- [ ] Optionally keep snap.ts imports as unused (they compile clean since snap.ts has no deleted dependencies) or remove them for cleanliness
- [ ] Fix `serialization.ts`: remove `import { CARD_TITLES } from "./card-titles"` and inline the title strings directly in `buildDefaultLayout()` (e.g., `"Conversation"`, `"Terminal"`, `"Git"`, `"Files"`, `"Stats"`)

**Tests:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes with no errors

**Checkpoint:**
- [ ] TypeScript compilation succeeds with zero errors
- [ ] DeckManager file is significantly reduced (target: under 300 lines for the active shell; dormant geometric code may add more)

---

#### Step 7: Gut action-dispatch.ts and update its test {#step-7}

**Depends on:** #step-6

**Commit:** `refactor(tugdeck): strip action-dispatch of card and notification handlers`

**References:** [D04] Gut action-dispatch, Spec S04 (#s04-action-dispatch-shape), Risk R01 (#r01-import-chain-breakage), (#strategy)

**Artifacts:**
- Modified: `tugdeck/src/action-dispatch.ts` -- DevNotificationRef removed, card handlers removed
- Modified: `tugdeck/src/__tests__/action-dispatch.test.ts` -- updated mocks and test cases

**Tasks:**
- [ ] Remove `DevNotificationRef` import from `action-dispatch.ts`
- [ ] Remove `devNotificationRef` module variable and its usage
- [ ] Remove `devNotificationRefArg` parameter from `initActionDispatch` signature
- [ ] Remove handlers: `show-card`, `focus-card`, `close-card`, `dev_notification`, `dev_build_progress`
- [ ] Simplify the DeckManager parameter type in `initActionDispatch` -- it may need only `sendControlFrame` now, or a minimal interface
- [ ] Update `_resetForTest()` to not clear `devNotificationRef`
- [ ] Update `action-dispatch.test.ts`: remove mock `DevNotificationRef`, remove tests for deleted handlers, keep tests for `reload_frontend`, `reset`, `set-dev-mode`, `choose-source-tree`, `registerAction`, `dispatchAction`
- [ ] Simplify mock DeckManager in test to match new minimal interface

**Tests:**
- [ ] `cd tugdeck && bun test src/__tests__/action-dispatch.test.ts` passes

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes
- [ ] `cd tugdeck && bun test src/__tests__/action-dispatch.test.ts` passes with zero failures

---

#### Step 8: Strip main.tsx to minimal boot sequence {#step-8}

**Depends on:** #step-7

**Commit:** `refactor(tugdeck): strip main.tsx to minimal boot sequence`

**References:** [D06] Remove xterm.css import, Spec S01 (#s01-main-boot), (#stripped-main-boot)

**Artifacts:**
- Modified: `tugdeck/src/main.tsx` -- stripped to minimal boot
- Modified: `tugdeck/vite.config.ts` -- removed dead xterm chunk splitting

**Tasks:**
- [ ] Remove xterm.css import
- [ ] Remove all card component imports (AboutCard, SettingsCard, FilesCard, GitCard, StatsCard, DeveloperCard, ConversationCard, TerminalCard)
- [ ] Remove `ReactCardAdapter` import
- [ ] Remove `CardConfig` type import
- [ ] Remove `FeedId` import (no longer needed for card config)
- [ ] Remove `CARD_TITLES` import
- [ ] Remove `DockCallbacks` type import
- [ ] Remove `dispatchAction` import (only `initActionDispatch` needed)
- [ ] Remove all card config objects (`codeConfig`, `terminalConfig`, `gitConfig`, `filesConfig`, `statsConfig`, `aboutConfig`, `settingsConfig`, `developerConfig`)
- [ ] Remove all `deck.registerCardConfig()` calls
- [ ] Remove all `deck.registerCardFactory()` calls
- [ ] Remove all `deck.addCard()` calls
- [ ] Remove `deck.refresh()` call (or keep if needed for initial render)
- [ ] Remove dock callbacks object and `deck.setDockCallbacks()` call
- [ ] Simplify `initActionDispatch(connection, deck)` call (no DevNotificationRef argument)
- [ ] Remove `deck.getDevNotificationRef()` call
- [ ] Keep: CSS imports (globals.css, chrome.css), TugConnection construction, container lookup, settings fetch, theme application, DeckManager construction, `initActionDispatch`, `connection.onOpen` for frontendReady bridge, `connection.connect()`, console.log
- [ ] Remove dead xterm manual chunk splitting from `vite.config.ts` (the `id.includes("node_modules/@xterm/")` and `id.includes("node_modules/xterm")` lines in the manual chunks config)

**Tests:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes

**Checkpoint:**
- [ ] `wc -l tugdeck/src/main.tsx` shows approximately 40-60 lines
- [ ] TypeScript compilation succeeds
- [ ] No imports reference deleted modules

---

#### Step 9: Remove dead TabNode type from layout-tree.ts and update tests {#step-9}

**Depends on:** #step-8

**Commit:** `refactor(tugdeck): remove dead TabNode type from layout-tree.ts`

**References:** Table T01 (#t01-file-disposition), Table T02 (#t02-test-file-disposition), (#scope)

**Artifacts:**
- Modified: `tugdeck/src/layout-tree.ts` -- TabNode interface removed
- Modified: `tugdeck/src/__tests__/layout-tree.test.ts` -- remove any TabNode-specific tests

**Tasks:**
- [ ] Remove the `TabNode` interface from `layout-tree.ts`
- [ ] Check `layout-tree.test.ts` for any tests that reference `TabNode` and remove them
- [ ] Verify no other surviving file imports `TabNode`

**Tests:**
- [ ] `cd tugdeck && bun test src/__tests__/layout-tree.test.ts` passes

**Checkpoint:**
- [ ] `TabNode` does not appear in `layout-tree.ts`
- [ ] `cd tugdeck && bunx tsc --noEmit` passes
- [ ] `cd tugdeck && bun test src/__tests__/layout-tree.test.ts` passes

---

#### Step 10: Full verification -- compilation, tests, and smoke test {#step-10}

**Depends on:** #step-9

**Commit:** `N/A (verification only)`

**References:** (#success-criteria), (#constraints), Risk R01 (#r01-import-chain-breakage), Risk R02 (#r02-deckmanager-gut-scope)

**Tasks:**
- [ ] Run full TypeScript compilation: `cd tugdeck && bunx tsc --noEmit`
- [ ] Run all surviving tests: `cd tugdeck && bun test`
- [ ] Verify test list matches expected survivors: `snap.test.ts`, `layout-tree.test.ts`, `protocol.test.ts`, `ordering.test.ts`, `conversation-types.test.ts`, `e2e-integration.test.ts`, `scaffold.test.tsx`, `action-dispatch.test.ts`, `disconnect-banner.test.tsx`
- [ ] Run dev server: `cd tugdeck && bun run dev`
- [ ] Open browser and verify: dark grid canvas background is visible
- [ ] Verify: WebSocket connection establishes (check browser devtools network tab)
- [ ] Verify: browser console has zero errors
- [ ] Verify: `_archive/cards/conversation/` contains all expected files
- [ ] Verify: no stale imports of deleted modules exist in surviving source files

**Tests:**
- [ ] `cd tugdeck && bun test` -- all surviving tests pass with zero failures
- [ ] `cd tugdeck && bunx tsc --noEmit` -- zero type errors

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` exits 0
- [ ] `cd tugdeck && bun test` exits 0 with all tests passing
- [ ] Manual: app loads in browser, dark grid visible, WebSocket connected, zero console errors

---

### Deliverables and Checkpoints {#deliverables}

> This is the single place we define "done" for the phase. Keep it crisp and testable.

**Deliverable:** A minimal tugdeck frontend shell (~300 lines of active code) that loads, shows a dark grid canvas, connects to the backend via WebSocket, and has zero console errors -- ready for Phase 1 (Theme Foundation) to build on.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] All card components, card infrastructure, card hooks, and dev notification context are deleted or archived (verified by directory listing)
- [ ] `main.tsx` is under 60 lines with no card imports
- [ ] DeckManager renders an empty DeckCanvas with only a disconnect banner
- [ ] `action-dispatch.ts` has no DevNotificationRef dependency
- [ ] `TabNode` is removed from `layout-tree.ts`
- [ ] `_archive/cards/conversation/` contains all conversation sub-components and logic modules
- [ ] `cd tugdeck && bunx tsc --noEmit` passes with zero errors
- [ ] `cd tugdeck && bun test` passes with zero failures across all surviving test files
- [ ] App loads in browser: dark grid visible, WebSocket connected, zero console errors

**Acceptance tests:**
- [ ] `cd tugdeck && bunx tsc --noEmit` exits 0
- [ ] `cd tugdeck && bun test` exits 0
- [ ] Manual smoke test: `bun run dev`, open browser, see dark grid, verify WebSocket in devtools, verify zero console errors

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 1: Rename token prefix `--tl-` to `--tways-`, implement theme-as-CSS-stylesheet, create `components/tugways/` directory
- [ ] Phase 5: Extract DeckManager geometric engine into clean module, rebuild orchestrator with Tugcard composition
- [ ] Phase 8: Rebuild dock from scratch with new button types and responder chain integration
- [ ] Phase 9: Rebuild all card content on new Tugcard + feed hook infrastructure, reviving archived conversation components

| Checkpoint | Verification |
|------------|--------------|
| Archive complete | `ls tugdeck/src/_archive/cards/conversation/` shows all files |
| Deletions complete | `ls tugdeck/src/components/cards/` fails; `ls tugdeck/src/cards/` fails |
| TypeScript clean | `cd tugdeck && bunx tsc --noEmit` exits 0 |
| Tests pass | `cd tugdeck && bun test` exits 0 |
| App loads | Manual: dark grid, WebSocket connected, zero console errors |
