# Tugways Implementation Strategy

## The Idea

Tear down the current tugdeck frontend to a minimal canvas shell, then build
the tugways design system back up from scratch — cleanly, one concept at a time,
following the architecture defined in `design-system-concepts.md`.

The retronow-unified-review model is the inspiration: build components in
isolation, see them visually, iterate, integrate. The app itself becomes the
proving ground. Mac-native menu commands (via `sendControl` WebSocket frames)
are the initial mechanism for triggering UI creation before the dock exists.

## Retronow Design Reference

The `roadmap/retronow/` directory contains the canonical design mockups and
style references for the tugways design system. **All future phase plans must
consult these resources** when designing components, layouts, and visual
treatments.

### Resource Inventory

| Resource | Path | What It Provides |
|----------|------|------------------|
| **Component Pack Page** | `components/retronow/RetronowComponentPackPage.tsx` | Full-page mockup showing wrapper-style component interactions end-to-end: tabs, dialogs, buttons, sliders, inputs, textareas, selects, radio groups, checkboxes, card canvas, toasts, and the ArcGauge custom component. This is the primary reference for component gallery layout and interactive controls. |
| **Control Pack** | `components/retronow/RetronowControlPack.tsx` | Compact control showcase covering input, textarea, combo, button, slider, radio, checkbox, and address bar patterns. Reference for control layout and grouping. |
| **Deck Canvas** | `components/retronow/RetronowDeckCanvas.tsx` | React card deck canvas with drag, resize, and snap behavior. Reference for card frame, header, and canvas layout patterns. |
| **Class Recipes** | `components/retronow/retronow-classes.ts` | Central class recipes for all controls: `shell`, `panel`, `button`, `buttonSecondary`, `input`, `textarea`, `tabs`, `card`, `cardHeader`, `cardBody`, `cardCanvas`. Reference for consistent styling patterns. |
| **Component CSS** | `styles/retronow-components.css` | Full CSS for all retronow controls: titlebar, tabs, buttons, fields, sliders, panels, popups, screens, gauges, scrollbars, dialog, toast, typography. Three theme variants (light, dark/bluenote, brio). Reference for CSS structure and theme-aware styling. |
| **Deck CSS** | `styles/retronow-deck.css` | Card/canvas system styles: visible grid, snap affordances, resize handles, card frames. |
| **Design Tokens** | `styles/retronow-tokens.css` | Three-theme token system (`--rn-*`): surfaces, text, accents (8-color palette), borders, shadows, spacing, radii, fonts, depths. Reference for token naming and palette structure. |
| **Unified Review** | `mockups/retronow-unified-review.html` | Browser-openable all-in-one review page. Open directly in a browser to see the full visual language across all themes. |
| **Style Mockup** | `mockups/retronow-style-mockup.html` | Standalone style exploration mockup. |
| **Component Pack Mockup** | `mockups/retronow-component-pack-mockup.html` | Browser-openable component pack preview. |

### How to Use These References

**When planning new components:** Consult `RetronowComponentPackPage.tsx` and
`RetronowControlPack.tsx` for layout patterns, interactive control grouping,
and the wrapper-style component approach. The retronow "AppButton wraps shadcn
Button" pattern is exactly the pattern tugways follows (TugButton wraps shadcn
Button, etc.).

**When designing the Component Gallery:** The retronow component pack page is
the direct inspiration for the tugways Component Gallery. Its tabbed layout
(controls, workspace, diagnostics, custom gauges), panel grouping, and
interactive toggle patterns should guide gallery expansion as new components
are added in later phases.

**When creating CSS for components:** Consult `retronow-components.css` for
the CSS structure — how controls are themed across light/dark/brio variants,
how gradients, borders, and shadows are applied, and how theme-specific
overrides are organized. The tugways equivalent uses `var(--td-*)` semantic
tokens instead of `var(--rn-*)`, but the structural patterns are the same.

**When defining tokens for new components:** Consult `retronow-tokens.css` for
the token naming scheme and palette structure. The 8-accent-color system
(orange, cyan, purple, red, green, yellow, magenta, coral) and surface
layering (surface-1 through surface-4) directly informed the tugways token
design.

**When building card frames and canvas layout:** Consult
`RetronowDeckCanvas.tsx`, `retronow-deck.css`, and the class recipes for card
shell, header, and body patterns.

## What We Have Today

The current tugdeck frontend is ~60 source files across:

| Layer | Files | Lines (approx) | Role |
|-------|-------|-----------------|------|
| Transport | `connection.ts`, `protocol.ts` | ~430 | Binary WebSocket, frame encode/decode |
| Settings | `settings-api.ts` | ~90 | Server-side settings fetch/post |
| Tokens | `tokens.css`, `globals.css`, `chrome.css` | ~650 | Three-tier design tokens, Tailwind bridge, chrome CSS |
| Layout engine | `deck-manager.ts`, `snap.ts`, `serialization.ts`, `layout-tree.ts` | ~2400 | DeckManager: panels, snap, sets, sashes, persistence |
| Card layer | `card.ts`, `react-card-adapter.tsx`, `card-context.tsx` | ~290 | Card interface, adapter, context provider |
| Chrome | `deck-canvas.tsx`, `card-frame.tsx`, `card-header.tsx`, `dock.tsx`, etc. | ~1500 | Canvas renderer, panel frames, dock, tab bar |
| Card components | 8 cards + conversation sub-components | ~3000 | about, code, terminal, git, files, stats, settings, developer |
| Supporting | hooks, contexts, action-dispatch, lib, drag-state | ~500 | Wiring, utilities |
| Entry | `main.tsx`, `index.html` | ~270 | Boot sequence |
| shadcn primitives | `components/ui/*.tsx` | ~600 | button, dialog, dropdown, tooltip, etc. |

**Total: ~9700 lines of frontend TypeScript/CSS.**

## What To Keep

These modules are solid infrastructure with no design conflicts:

| Module | Why Keep | Notes |
|--------|----------|-------|
| `connection.ts` | Clean WebSocket client, well-structured | No changes needed |
| `protocol.ts` | Binary frame protocol, shared with Rust backend | No changes needed |
| `settings-api.ts` | Clean API client, correct no-localStorage design | No changes needed |
| `tokens.css` | Three-tier token system, three themes, fonts | Tier 1 prefix rename (`--tl-` → `--tways-`), remove legacy shadcn aliases later |
| `chrome.css` | Resize handles, snap guides, sash cursors, set-flash | Compact, appropriate as CSS |
| `globals.css` | Tailwind v4 `@theme` bridge, body/grid styling | Update when token prefix changes |
| `index.html` | Minimal shell | Add inline body styles per eliminate-frontend-flash plan |
| `snap.ts` | Spatial geometry — snapping, sets, shared edges | ~500 lines of real math, no design conflicts |
| `serialization.ts` | Layout persistence (v5 format) | Extend for new CardState fields (collapsed, etc.) |
| `layout-tree.ts` | Core data types (`CardState`, `DeckState`, `TabItem`) | Remove dead `TabNode` type |
| `action-dispatch.ts` | Control frame routing from server/menu commands | Extend for new actions |
| `components/ui/*.tsx` | shadcn primitives (button, dialog, dropdown, tooltip, etc.) | Private layer — tugways wraps these |
| `lib/utils.ts` | `cn()` utility for class merging | Used everywhere |

## What To Demolish

### Delete entirely

| Module | Why |
|--------|-----|
| `cards/react-card-adapter.tsx` + test | All lifecycle methods are no-ops. It's a data bag that duplicates `CardConfig`. |
| `cards/card.ts` (the `TugCard` interface) | Has `@deprecated` methods (`setCardFrame`, `setActiveTab`), wrong abstraction for new system. Replaced by Tugcard composition (concept 6). |
| All 8 card components + tests | Placeholders. Will be rebuilt from scratch on the Tugcard base. The conversation card sub-components (code-block, message-renderer, etc.) are real work but can be revived later when the code card is rebuilt. |
| `card-titles.ts` | Simple string map, trivially recreated. |
| `drag-state.ts` | Tiny `IDragState` interface, collapses into DeckManager or the mutation model. |
| `hooks/use-card-meta.ts` | Tied to current `CardConfig.initialMeta` + `updateMeta` pattern. Replaced by Tugcard data hooks. |
| `hooks/use-feed.ts` | Current feed hook. Replaced by feed abstraction (concept 7). |
| `hooks/use-connection.ts` | Thin hook, trivially recreated. |
| `cards/card-context.tsx` | Current context provider. Replaced by Tugcard's own context. |
| `contexts/dev-notification-context.tsx` | Notification routing. Rebuilds cleanly on new infrastructure. |

### Gut and rewrite

| Module | What stays | What goes |
|--------|-----------|-----------|
| `main.tsx` | Boot sequence shape (fetch settings → apply theme → mount → connect). Native bridge hook. | Triple-registration mess (every card defined 3 times). All card imports. Factory/adapter wiring. |
| `deck-manager.ts` | Geometric core: snap computation, set management, shared edges, sashes, docking groups, layout persistence, sash drag. (~800 lines) | Card registration layer, `TugCard` interface usage, `cardsByFeed` fan-out routing, `ReactCardAdapter` factory methods, dock callback wiring, `keydownHandler` (→ responder chain). (~1000 lines) |
| `deck-canvas.tsx` | Panel rendering loop, imperative handle for sash drag. | `CardContent` component (→ Tugcard composition), feed data broadcasting, `callbacksRef` trick. |
| `card-frame.tsx` | Drag/resize with ref-based mutation. | Header/content split (→ Tugcard owns this). |
| `card-header.tsx` | Header layout structure. | Hardcoded `showCollapse={false}`, missing collapse icon toggle, no close confirmation. |
| `dock.tsx` | Delete and rewrite per concept 11. |

## The DeckManager Question

DeckManager is 1816 lines. It does two things:

**Geometric engine** (~800 lines worth keeping):
- Snap computation during drag/resize
- Set detection: shared edges → connected groups
- Sash groups: virtual resize handles at shared edges
- Docked corner computation (rounded vs. square per shared edge)
- Position offsets (1px overlap for docked panels)
- Set-move: dragging one set member moves the group
- Break-out detection: dragging away from a set
- Layout persistence (serialize → POST to settings API)

**App wiring** (~1000 lines to demolish):
- `cardsByFeed` routing (→ concept 7 feed abstraction)
- `TugCard` interface + `ReactCardAdapter` usage (→ concept 6 Tugcard)
- `cardConfigs` + `cardFactories` + `addCard` triple-registration (→ single registry)
- `cardMetas` state (→ Tugcard manages its own meta)
- React root creation + `render()` method (→ simpler, DeckCanvas owns more)
- Dock callbacks wiring (→ responder chain actions)
- `keyPanelId` + `focusPanel()` (→ concept 4 responder chain focus model)
- `keydownHandler` for Ctrl+` (→ responder chain key pipeline)

**Verdict**: Keep DeckManager, but extract the geometric engine into a clean
module (`canvas-geometry.ts` or similar) and rebuild the orchestrator on top of
it using the new concepts. The geometric code is ~500 lines of spatial math with
no design system dependencies — it just works on rectangles.

## Phases

### Phase 0: Demolition

**Goal**: Empty canvas. Dark grid. Connected to backend. No cards. No dock.

**What to do**:
1. Delete all card components (`components/cards/*`)
2. Delete card infrastructure (`card.ts`, `react-card-adapter.tsx`, `card-context.tsx`, `card-titles.ts`, `drag-state.ts`)
3. Delete card hooks (`use-card-meta.ts`, `use-feed.ts`, `use-connection.ts`)
4. Delete dev notification context
5. Strip `main.tsx` to: CSS imports → connection → fetch settings → apply theme → create minimal DeckManager → connect
6. Strip `DeckManager` to: hold empty DeckState, own React root, render empty DeckCanvas
7. Strip `DeckCanvas` to: render canvas div with grid background, no panels, no dock
8. Remove dead `TabNode` type from `layout-tree.ts`
9. Verify: app loads, shows dark grid, connects to backend, no errors

**Result**: ~300 lines of working frontend. A blank canvas ready for new work.

**Risk**: The backend still sends frames to the frontend. Without card
subscribers, those frames are silently dropped by `connection.ts` (it just won't
find any registered callbacks). This is fine — no errors, no crashes.

### Phase 1: Theme Foundation (Concepts 1, 2)

**Goal**: Loadable theme architecture. `components/tugways/` directory exists.

**What to do**:
1. Rename token prefix `--tl-` → `--tways-` throughout `tokens.css` and all CSS references ([D02])
2. Implement theme-as-CSS-stylesheet pattern ([D01], [D03]): theme switching injects/replaces a `<link>` tag instead of toggling body classes
3. Add `--td-duration-fast/moderate/slow/glacial` and `--td-easing-standard/enter/exit` motion tokens to tokens.css ([D23])
4. Add `--td-duration-scalar` with `prefers-reduced-motion` media query ([D24])
5. Create `components/tugways/` directory ([D06])
6. Implement `TugThemeProvider` (React context for current theme name + setter)
7. Wire Mac menu "Settings > Theme" to switch themes via control frame

**Result**: Themes load as CSS files. Motion tokens exist. Directory structure ready.

### Phase 2: First Component + Gallery (Concept 3)

**Goal**: TugButton works end-to-end. Component gallery visible in the app.

**What to do**:
1. Create `components/tugways/tug-button.tsx` — wraps shadcn `Button`, adds `onAction` chain-action mode, tugways variant tokens ([D07], [D08])
2. Create a "Component Gallery" card — a standalone view (like retronow-unified-review but live in the app) that shows all tugways components with variant toggles
3. Wire a Mac Developer menu item ("Show Component Gallery") via `sendControl` → `action-dispatch` to display the gallery as a floating panel on the canvas
4. Gallery starts with just TugButton in all its variants
5. As each new component is built in later phases, add it to the gallery

**Result**: Visible proof that the design system works. A live environment for testing components.

**Design reference**: The retronow `RetronowComponentPackPage.tsx` is the direct model for the Component Gallery. As new components are added in later phases, the gallery should grow to match the retronow pack's tabbed layout, panel grouping, and interactive toggle patterns. See [Retronow Design Reference](#retronow-design-reference) for the full inventory.

**Note on the gallery**: This is not a card in the old sense — it doesn't need the Tugcard infrastructure from concept 6. It's a simple React component rendered in a basic frame on the canvas. It exists to prove the component system before the card system is rebuilt.

### Phase 3: Responder Chain (Concept 4)

**Goal**: Event routing infrastructure. Key pipeline works.

**What to do**:
1. Implement `ResponderChainManager` — singleton that manages the chain tree ([D09])
2. Implement `useResponder` hook — registers a component as a responder node
3. Implement four-stage key pipeline: capture → focused responder → bubble → app-level ([D10])
4. Implement action validation: `canHandle` + `validateAction` ([D11])
5. Wire DeckCanvas as a responder (receives canvas-level actions)
6. Wire the gallery panel as a responder (test basic key routing)
7. Implement keyboard shortcuts (e.g., panel cycling) in the responder chain key pipeline

**Result**: Actions flow through the responder chain. Focus is chain-managed, not DeckManager-managed.

### Phase 4: Mutation Model + DOM Hooks (Concept 5)

**Goal**: Three-zone mutation model is operational.

**What to do**:
1. Implement `useCSSVar` hook — read/write CSS custom properties on a ref'd element ([D13])
2. Implement `useDOMClass` hook — toggle classes without re-render
3. Implement `useDOMStyle` hook — set inline styles without re-render
4. Document the three zones: appearance (CSS, zero re-renders), local data (targeted setState), structure (subtree re-render) ([D12])
5. Apply the five structure-zone rules ([D14])

**Result**: Components can mutate appearance without React re-renders. The mutation discipline is established.

**Note**: DeckManager's existing ref-based style mutation during drag is a natural appearance-zone operation. Formalizing it with the new hooks happens in Phase 5 when the DeckManager orchestrator is rebuilt and cards exist to test with.

### Phase 5: Tugcard Base (Concept 6)

**Goal**: Cards can be created, framed, receive data, participate in the chain.

**What to do**:
1. Implement `Tugcard` composition component ([D15]): `<Tugcard><Tugcard.Header /><Tugcard.Content /></Tugcard>`
2. Implement `useTugcardData` hook ([D16]) — provides card dimensions, feed data, dispatch, collapse state
3. Implement dynamic min-size ([D17]) — cards report their minimum dimensions
4. Rebuild `CardFrame` to wrap Tugcard and integrate with DeckManager geometry
5. Implement card registration: single registry, one call per card type (no triple-registration)
6. Wire Mac menu "Developer > Show [Card Type]" commands via control frames
7. Rebuild `DeckManager` orchestrator: new card registry, simplified render method, feed routing delegated to Tugcard hooks
8. Build one test card (maybe a simple "hello world" card) to prove the pipeline end-to-end

**Result**: A card appears on the canvas when triggered from the Mac menu. It has a title bar, can be dragged, resized, snapped, and docked. The old infrastructure is fully replaced.

### Phase 5a: Tugcard Selection Model (Concept 14)

**Goal**: Selection is contained within card boundaries. Card chrome is never selectable. Cmd+A is scoped to the focused card.

**What to do**:
1. Add `user-select: none` to canvas background, card frames, accessory slots, and resize handles. Add explicit `user-select: text` to card content areas. Title bar header already has `user-select: none` from Phase 5.
2. Implement `SelectionGuard` singleton — registers card content areas as selection boundaries, tracks which card owns the active selection, clips selection when it escapes the originating card. Includes `saveSelection`/`restoreSelection` methods for per-card selection persistence (used by Phase 5b tab switching).
3. Implement `useSelectionBoundary` hook — called by Tugcard on its content area div to register/unregister with SelectionGuard. Card authors never interact with the guard directly.
4. Implement pointer-clamped selection clipping ([D36]): during drag selection, when the pointer exits the card boundary, clamp coordinates to the boundary edge and use `document.caretPositionFromPoint()` to find the nearest text position. Call `selection.extend()` to pin the selection focus at the edge. Zero visual flash.
5. Implement RAF-based autoscroll in SelectionGuard: pointer-clamping breaks native browser autoscroll (the browser never sees the pointer leave the scrollable area), so SelectionGuard must implement distance-based autoscroll via `requestAnimationFrame` during clamped selection drag. After each scroll tick, re-clamp and re-extend the selection to track newly visible content.
6. Implement `selectionchange` safety net for keyboard-driven selection extension (Shift+arrow).
7. Implement `data-td-select` attribute API ([D37]) with four modes: default (text), `none`, `all`, `custom`. Wire via CSS rules and SelectionGuard awareness. The `custom` mode explicitly handles contenteditable regions — verify with a contenteditable test div that selection containment works correctly when contenteditable's native behavior tries to extend selection beyond the card.
8. Wire `selectAll` responder action in Tugcard ([D38]) to call `selectAllChildren` on the card's content area. Cmd+A now selects within the focused card only.
9. Add `--td-selection-bg` and `--td-selection-text` semantic tokens to `tokens.css`. Add `::selection` rule to `tugcard.css`.
10. Add `overscroll-behavior: contain` to card content area CSS to prevent scroll chaining during selection drag.
11. Test: selection cannot cross card boundaries, chrome is never selectable, Cmd+A is card-scoped, autoscroll works in overflow content, contenteditable regions work correctly with `data-td-select="custom"`, save/restore selection round-trips correctly.

**Result**: Selection is fully contained within card boundaries. Title bars, accessory slots, canvas gaps, and resize handles are never selectable. Drag selection clamps smoothly at card edges with RAF-based autoscroll for overflow content. Cmd+A selects within the focused card. Card authors can mark regions as non-selectable, atomic-selectable, or custom-managed (including contenteditable) via `data-td-select`. Selection persistence infrastructure is ready for Phase 5b tab switching.

### Phase 5a2: DeckManager Store Migration (Concept 5, [D40]-[D42])

**Goal**: DeckManager becomes a subscribable store. One `root.render()` at construction time. All subsequent state changes flow through `useSyncExternalStore`. Responder registration uses `useLayoutEffect`. The async render gap that causes timing bugs between imperative state and React rendering is eliminated.

**Background**: React 19's `createRoot().render()` is asynchronous — it schedules work via `queueMicrotask()` and returns immediately. DeckManager currently calls `root.render()` on every state mutation (10+ call sites), creating a timing gap where imperative code (like `makeFirstResponder`) runs before React has processed the render. This manifests as responder chain bugs (Ctrl+` cycling fails) and will affect any future feature that combines imperative state mutations with React rendering.

**What to do**:
1. Add `subscribe`/`getSnapshot`/`getVersion` methods to DeckManager following the `useSyncExternalStore` contract. Add a `notify()` private method that increments the version and fires subscriber callbacks.
2. Create `DeckManagerContext` (`createContext<DeckManager | null>(null)`) and `useDeckManager()` convenience hook in a new `deck-manager-context.tsx` module.
3. Modify DeckManager constructor: wrap the single `root.render()` call with a `<DeckManagerContext.Provider value={this}>` around the existing component tree. This is the only `root.render()` call that will ever execute.
4. Replace all `this.render()` calls in DeckManager's mutating methods (`addCard`, `removeCard`, `moveCard`, `focusCard`, `applyLayout`, `refresh`) with `this.notify()`. Remove the `private render()` method entirely.
5. DeckCanvas reads `deckState` from DeckManager via `useSyncExternalStore(manager.subscribe, manager.getSnapshot)` instead of receiving it as a prop. Remove `deckState` from `DeckCanvasProps`. Read `onCardMoved`, `onCardClosed`, `onCardFocused` callbacks from the DeckManager instance (accessed via context) instead of props.
6. Switch `useResponder` registration from `useEffect` to `useLayoutEffect`. This ensures responder nodes register during the commit phase (before paint), not after. Responder chain is always consistent before the next browser event fires.
7. Verify: Ctrl+` cycling works end-to-end, card focus visuals update correctly, add/remove cards works via Mac menu, layout persistence works (save/load), drag/resize works (onCardMoved), close button works (onCardClosed), all existing tests pass.

**Files modified**:
1. `tugdeck/src/deck-manager.ts` — subscribe/getSnapshot/notify API, remove repeated render() calls
2. `tugdeck/src/deck-manager-context.tsx` — new module: DeckManagerContext + useDeckManager hook
3. `tugdeck/src/components/chrome/deck-canvas.tsx` — read from store via useSyncExternalStore, remove deckState/callback props
4. `tugdeck/src/components/tugways/use-responder.tsx` — useEffect → useLayoutEffect for registration

**Result**: DeckManager state changes are deterministic. The async render gap is eliminated. The responder chain is always consistent. Future features that combine imperative mutations with React rendering (tab switching, card snapping, dock actions, modal dialogs) inherit these guarantees automatically.

**Note**: This phase is a focused infrastructure change — it does not add new user-facing features. It fixes the architectural root cause of timing bugs between DeckManager and React, establishing a reliable foundation for all subsequent phases.

### Phase 5b: Card Tabs (Concept 12)

**Goal**: Cards support multiple tabs with click-based management. Tab bar appears when a card has more than one tab.

**What to do**:
1. Implement `TugTabBar` component — horizontal tab strip with tab select, close, and add ([D30])
2. Wire tab state into Tugcard: `tabs` array, `activeTabId`, content switching ([D31])
3. Tab bar renders only when `tabs.length > 1` — single-tab cards show no tab bar
4. Tab icons — each tab displays its card type icon from `getRegistration(tab.componentId).defaultMeta.icon`. Same icon source for title bar (single-tab) and tab bar (multi-tab)
5. Active/inactive tab visual states — active tab has bottom border accent, inactive tabs are muted, close buttons appear on hover
6. [+] button with type picker dropdown — lists all registered card types (icon + title) from `getAllRegistrations()`. Selecting a type adds a new tab of that type. Mixed-type tabs fully supported — no card type restrictions
7. Active tab's content mounts; inactive tabs unmount (responder chain follows automatically)
8. Register `previousTab` and `nextTab` responder actions on Tugcard — switch tabs via the responder chain (no-op for single-tab cards). Keyboard bindings wired in a later phase
9. Wire Mac menu command to add a tab to the focused card (for testing)
9. Verify tab persistence via existing `CardState.tabs` / `CardState.activeTabId` in serialization
10. Add TugTabBar to the Component Gallery

**Result**: A card can host multiple tabs of any type. Switching tabs changes the visible content and the active responder. The tab bar is invisible for the common single-tab case. Tab icons provide visual identity, especially for mixed-type cards.

### Phase 5b2: Tab Drag Gestures (Concept 12)

**Goal**: Tabs can be reordered, detached, and merged via drag gestures.

**What to do**:
1. Drag-to-reorder — drag a tab within its tab bar to change position. Pointer-capture on the tab element, hit-test against tab positions, animated insertion indicator
2. Drag-to-detach — drag a tab out of the tab bar onto the canvas to create a new single-tab card. Hit-test against the tab bar boundary; once outside, create a new CardState with the detached tab and remove it from the source card
3. Drag-to-merge — drag a tab from one card onto another card's tab bar to add it as a new tab. Hit-test against all visible tab bars. Works regardless of card type (mixed-type tabs supported)
4. Visual feedback during drag — ghost tab follows pointer, insertion indicator shows drop position, tab bar highlights as valid drop target

**Result**: Users can freely reorganize tabs between cards via direct manipulation. Combined with Phase 5b's click-based management, tabs are a fully interactive composition feature.

**Note**: Phase 5b2 depends on Phase 5b (tab bar component and tab state management must exist). It does not block any other phase.

### Phase 5b3: Gallery Card (Concept 3, [D43])

**Goal**: Convert the Component Gallery from a floating absolute-positioned panel to a proper registered card with tabs.

**What to do**:
1. Register `"component-gallery"` as a card type in `card-registry.ts` with `CardRegistration` — contentFactory, defaultMeta (title: "Component Gallery", icon, closable: true), defaultFeedIds: []
2. Create `ComponentGalleryCard` content component — replaces the current `ComponentGallery` floating panel. Uses five tabs, one per demo section: TugButton, Chain-Action Buttons, Mutation Model, TugTabBar, TugDropdown
3. Rework `show-component-gallery` action to create/focus the gallery card in the deck (via `DeckManager.addCard` or focus if already present) rather than toggling a floating panel
4. Remove the floating panel infrastructure — `galleryVisible` state in DeckCanvas, `registerGallerySetter` in action-dispatch, the absolute-positioned `cg-panel` CSS
5. Extract each gallery section into a standalone content component (one per tab) — each renders independently when its tab is active
6. Verify gallery card works with existing tab infrastructure — tab switching, type picker, persistence, responder chain
7. Update tests — replace floating panel assertions with card-in-deck assertions

**Result**: The Component Gallery is a proper card that dogfoods the card and tab systems. No z-index hacks for dropdown portals. Gallery persists across sessions. The five tabs provide clean section separation.

**Note**: Phase 5b3 depends on Phase 5b (tab bar and tab state must exist). It does not depend on Phase 5b2 (drag gestures).

### Phase 5b4: Tab Overflow (Concept 12, [D44])

**Goal**: Tab bars handle overflow gracefully via progressive collapse — icon-only inactive tabs, then an overflow dropdown.

**What to do**:
1. Add a `ResizeObserver` to TugTabBar that measures available width and computes which tabs fit
2. Implement Stage 1 collapse — when tabs don't fit at full size, render inactive tabs as icon-only (hide labels). Active tab always shows icon+label
3. Implement Stage 2 overflow — when icon-only tabs still don't fit, excess tabs move into an overflow dropdown at the right end of the bar. The dropdown shows icon+label for each overflow tab
4. Implement active tab visibility rule — selecting a tab from the overflow dropdown moves it to the rightmost visible slot, displacing the previous rightmost tab into the overflow
5. Add overflow dropdown button with tab count badge, styled with `--td-*` tokens, using TugDropdown
6. Ensure the [+] type picker button remains visible at all times (rightmost, after overflow dropdown if present)
7. Handle dynamic changes — tab add/remove, card resize, and drag-to-merge (Phase 5b2) all trigger re-measurement
8. Update Component Gallery's TugTabBar demo to show overflow behavior

**Result**: Tab bars degrade gracefully as tabs accumulate. The active tab is always visible. Users can access all tabs via the overflow dropdown. The tab bar never wraps or scrolls.

**Note**: Phase 5b4 depends on Phase 5b (tab bar component must exist). It does not depend on Phase 5b2 (drag gestures) or Phase 5b3 (gallery card), though both benefit from overflow handling.

### Phase 5b5: Tab Refinements (Concept 12, [D45])

**Goal**: Tab interaction refinements discovered during implementation of Phases 5b2–5b4.

**What to do**:
1. Card-as-tab merge — when a card drag (via CardFrame) ends over another card's tab bar, merge the source card's tab into the target instead of completing the move. On pointer up in CardFrame's drag handler, hit-test against all `.tug-tab-bar[data-card-id]` elements. If the drop position is inside a tab bar belonging to a different card, call `store.mergeTab(sourceCardId, sourceTabId, targetCardId, insertIndex)` and remove the now-empty source card. This reuses the existing `mergeTab` DeckManager method and the `data-card-id` hit-test infrastructure from Phase 5b2.

**Result**: Single-tab cards can be merged into other cards via drag, completing the tab composition story. Combined with Phase 5b2's tab-to-tab drag gestures, all tab reorganization scenarios are covered.

**Note**: Phase 5b5 depends on Phase 5b2 (drag coordinator and hit-test infrastructure must exist). Additional refinement items may be added as Phases 5b3 and 5b4 are implemented.

### Phase 5e: Tugbank Defaults Store (Concept 17, [D46]-[D48])

**Goal**: Replace the flat-file settings backend with a SQLite-backed typed defaults store. Establish the persistence infrastructure that Phase 5f (state preservation) and all future state-heavy features build on.

**What to do**:
1. Create `tugbank-core` library crate in the tugtool workspace — SQLite schema bootstrap, `Value` enum (null, bool, i64, f64, string, bytes, json), domain CRUD, CAS concurrency via generation counters, `DomainHandle` API
2. Create `tugbank` binary crate — `clap`-based CLI modeled after macOS `defaults` (domains, read, write, delete, keys, cas-write, generation)
3. Add `DefaultsStore` to tugcast's Rust backend — open tugbank SQLite DB at startup (path: `~/.config/tug/defaults.db` or configurable)
4. Implement HTTP bridge endpoints in tugcast: `GET /api/defaults/<domain>`, `GET /api/defaults/<domain>/<key>`, `PUT /api/defaults/<domain>/<key>`, `DELETE /api/defaults/<domain>/<key>`
5. Migrate existing settings: on first startup, if legacy flat settings file exists, read its contents and write them into `dev.tugtool.deck.layout` (cards JSON) and `dev.tugtool.app` (theme) domains, then remove the flat file
6. Update `settings-api.ts` to use the new `/api/defaults/` endpoints for layout and theme reads/writes. Preserve the debounced save pattern.
7. Verify: app loads layout from tugbank, theme persists across reload, `tugbank` CLI can read/write values, two-process CAS tests pass

**Files created/modified**:
1. `tugcode/tugbank-core/` — new library crate (schema, value, domain, store)
2. `tugcode/tugbank/` — new binary crate (CLI)
3. `tugcode/tugcast/` — DefaultsStore integration, HTTP bridge endpoints
4. `tugdeck/src/settings-api.ts` — new endpoint URLs, domain-aware reads/writes

**Result**: All persistence flows through tugbank. The flat settings file is gone. The `tugbank` CLI provides debugging and scripting access. Domain separation (`dev.tugtool.deck.layout`, `dev.tugtool.deck.state`, `dev.tugtool.deck.tabstate`, `dev.tugtool.app`) is established for Phase 5f and beyond.

**Note**: Phase 5e is primarily Rust/backend work. The frontend change is limited to updating `settings-api.ts` endpoint URLs and response parsing. No new UI features.

### Phase 5f: Inactive State Preservation (Concept 18, [D49]-[D52])

**Goal**: Card and tab state survives both tab switching and app reload. Selections, scroll positions, collapse state, focused card identity, and card content state are all preserved.

**What to do**:
1. Add `collapsed?: boolean` to `CardState` in `layout-tree.ts` ([D52]). Update serialization to read/write it. No UI yet — Phase 8a builds the collapse toggle.
2. Add `focusedCardId?: string` to `DeckState` in `layout-tree.ts` ([D51]). DeckManager writes it to tugbank (`dev.tugtool.deck.state` → `focusedCardId`) on focus change. On reload, call `makeFirstResponder` on the restored card ID after mount.
3. Implement `TabStateBag` type — `{ scroll?: { x: number; y: number }; selection?: SavedSelection | null; content?: unknown }`. Create an in-memory cache (`Map<string, TabStateBag>`) on DeckManager for fast tab-switch access.
4. Implement Tugcard deactivation capture: on tab switch away, read `contentArea.scrollLeft`/`scrollTop`, call `SelectionGuard.saveSelection()`, call the card content's `onSave` callback (if registered). Write the state bag to the in-memory cache and debounce-write to tugbank (`dev.tugtool.deck.tabstate` domain, keyed by tab ID).
5. Implement Tugcard activation restore: on tab switch to, read the state bag from the in-memory cache (falling back to tugbank on cache miss). After mount, set `contentArea.scrollLeft`/`scrollTop`. Call `SelectionGuard.restoreSelection()`. Call the card content's `onRestore` callback (if registered).
6. Implement `useTugcardPersistence` hook ([D50]) — card content components call `useTugcardPersistence({ onSave: () => T, onRestore: (state: T) => void })`. The hook registers callbacks with Tugcard via context. Tugcard calls `onSave` on deactivation and `onRestore` on activation.
7. On app reload: DeckManager reads all tab state bags from tugbank during initialization. Passes them to Tugcard instances. Each Tugcard restores its active tab's state on first mount.
8. Verify: switch tabs → scroll position restored, selection restored. Reload app → scroll position restored, selection restored, focused card restored, collapsed state restored. Card content state round-trips via `useTugcardPersistence`.

**Files created/modified**:
1. `tugdeck/src/layout-tree.ts` — add `collapsed` to CardState, `focusedCardId` to DeckState
2. `tugdeck/src/serialization.ts` — serialize/deserialize new fields
3. `tugdeck/src/deck-manager.ts` — tab state cache, focus persistence, tugbank writes
4. `tugdeck/src/components/tugways/tugcard.tsx` — deactivation capture, activation restore lifecycle
5. `tugdeck/src/components/tugways/use-tugcard-persistence.tsx` — new hook
6. `tugdeck/src/selection-guard.ts` — ensure save/restore works with the new lifecycle (may need no changes if the API is already correct)

**Result**: Tab state survives both tab switches and app reload. Card content components can opt into state persistence via a simple hook. The selection guard's existing save/restore mechanism is extended from in-memory-only to durable persistence via tugbank. The `collapsed` field is ready for Phase 8a's UI. The focused card is restored on reload.

**Note**: Terminal buffer persistence is explicitly deferred to Phase 9's terminal card work. The `useTugcardPersistence` hook provides the mechanism; the terminal card will implement its own `onSave`/`onRestore` for xterm.js buffer state when the time comes.

### Phase 5c: Card Snapping (Concept 13)

**Status: COMPLETE** (2026-03-04)

**Goal**: Snap-to-edge and set formation require the Option (Alt) modifier. Free drag is the default.

**What was done**:
1. Gated snap behavior on configurable modifier key (default: Alt/Option) via `SNAP_MODIFIER_KEY` constant and `isSnapModifier()` helper in `card-frame.tsx`. Solo card drag only calls `computeSnap` when modifier is held.
2. Mid-drag modifier toggle supported: pressing/releasing Option immediately shows/hides guides and snaps/unsnaps.
3. Set-move works without modifier once a set is formed — dragging any member moves the group.
4. Break-out triggered by pressing Option during set-move (modifier transition false→true), not just drag distance.

**Result**: Casual drags are free movement. Option+drag activates snap guides and set formation. Set-move and break-out behavior work correctly.

### Phase 5c2: Card Snap Set Refinements (Concept 13, [D53]-[D60])

**Status: COMPLETE** (2026-03-05)

**Goal**: Snapped card sets look and behave like unified shapes — squared corners, single-line borders, outer-hull perimeter flash, clip-path shadow management, and clean break-out visuals. Plus card activation refinements.

**What was done** (across PRs #85-#88 and a dash):

1. **Border collapse in snap math** ([D56]): `computeSnap` in `snap.ts` gained a `borderWidth` parameter. Snap positions offset inward by border width so adjacent card borders overlap. Drag reads computed width via `getComputedStyle(tugcardEl).borderTopWidth`; resize uses hardcoded 1px.
2. **Set corner rounding** ([D53]): simplified from per-corner computation to uniform `border-radius: 0` for all set members via CSS `data-in-set` attribute. `updateSetAppearance()` sets/removes the attribute based on set membership.
3. **Outer-hull perimeter flash** ([D54]): `computeSetHullPolygon()` added to `snap.ts` — coordinate compression + grid-based boundary trace. `flashSetPerimeter()` renders a single SVG `<path>` stroking the hull with glow filter. Replaced the per-card overlay edge-suppression approach.
4. **Break-out visual restoration** ([D55]): removing `data-in-set` restores rounded corners via CSS. `flashCardPerimeter()` creates a `.card-flash-overlay` div. Break-out triggered by Alt key transition (false→true) during set-move.
5. **Shadow rewrite** ([D57]): replaced `.set-shadow` DOM elements with `clip-path: inset()` on `.tugcard`. `computeClipPathForCard()` helper maps SharedEdge data to inset values. `SHADOW_EXTEND_PX = 20`. Deleted `_gestureActive` flag system, `dragShadowEl`/`resizeShadowEl` refs, shadow tracking in drag/resize RAF loops. Store subscriber calls `updateSetAppearance` unconditionally.
6. **Active/inactive shadow tokens** ([D58]): added `--td-card-shadow-inactive` across all three themes. `.tugcard` uses inactive shadow by default; `.card-frame[data-focused="true"] .tugcard` uses active shadow.
7. **Command-key suppresses activation** ([D59]): `metaKey` check in `handleFramePointerDown` and `handleResizeStart` skips `onCardFocused` call.
8. **Resize click activates card** ([D60]): `handleResizeStart` explicitly calls `onCardFocused(id)` since `stopPropagation()` prevents the frame handler from firing.

**Files modified**:
1. `tugdeck/src/snap.ts` — `computeSnap` borderWidth parameter, `computeSetHullPolygon` algorithm
2. `tugdeck/src/components/chrome/card-frame.tsx` — clip-path system, flash functions, break-out, activation, deleted shadow tracking infrastructure
3. `tugdeck/src/components/chrome/deck-canvas.tsx` — removed `isGestureActive` guard, unconditional `updateSetAppearance`
4. `tugdeck/styles/chrome.css` — `.tugcard` shadow rules, `.card-flash-overlay`, removed `.set-shadow`/`.set-shadow-shape`
5. `tugdeck/styles/tokens.css` — `--td-card-shadow-inactive` token
6. `tugdeck/styles/bluenote.css` — bluenote inactive shadow override
7. `tugdeck/styles/harmony.css` — harmony inactive shadow override

**Result**: Snapped sets look like unified shapes with clean single-line borders, squared corners, clip-path shadow management, and hull-polygon perimeter flash. Break-out cleanly restores visual independence. Active/inactive shadows differentiate focused cards. Resize activates cards. Command-click preserves window order.

**Note**: Phase 5c2 depended on Phase 5c (snap and set-move). Both phases are now complete. They do not block any other phase.

### Phase 5d1: Default Button (Concept 3, [D39])

**Goal**: Dialogs, alerts, sheets, and popovers can designate a default button. Enter activates it. The `primary` variant is the visual affordance.

**What to do**:
1. Add `setDefaultButton(buttonRef)` and `clearDefaultButton(buttonRef)` methods to `ResponderChainManager` — registers/unregisters a default button for the current modal scope
2. Extend the stage-2 key pipeline handler to check for a registered default button when Enter is pressed: if no native `<button>` or text input has DOM focus, activate the default button via synthetic click
3. Confirm `primary` variant styling uses `--td-accent` fill as the default button visual — already wired via `--primary: var(--td-accent)` in `tokens.css`, verify it reads clearly in all three themes
4. Fix `destructive` variant styling in `tug-button.css` — the destructive button currently looks indistinguishable from other variants. Add explicit `background-color: var(--td-danger)` and `color: var(--td-text-inverse)` to `.tug-button-destructive` so destructive buttons have a bold red fill with white text across all three themes. Verify in the Component Gallery that primary (accent fill) and destructive (danger fill) are clearly distinct
5. Update TugConfirmPopover to register its confirm button as the default button on open, clear on close
6. Wire alert button role logic in `TugAlertHost`: when a `"destructive"` button is present, the `"cancel"` button gets `variant="primary"` and is registered as the default button; when no destructive button is present, the `"default"` role button gets `variant="primary"` and is registered as the default button
7. Wire the same role logic in `TugSheetHost`
8. Test: Enter activates the default button in alerts, sheets, and popovers; Enter does not interfere when a native button or text input has focus; destructive actions have Cancel as the default button; destructive buttons are visually distinct (bold red fill, white text) from primary buttons (accent fill)

**Result**: The default button pattern works end-to-end. Enter activates the accent-filled `primary` button in any modal context. The responder chain manages scoping so nested modals (sheet inside a card while an alert is open) route Enter correctly.

**Note**: Phase 5d1 depends on Phase 3 (responder chain exists) and Phase 5 (Tugcard base, where alerts and sheets are first consumed). It does not depend on Phase 8a (which builds TugAlert/TugSheet/TugConfirmPopover) — rather, Phase 8a depends on Phase 5d1 for the default button registration mechanism. Phase 5d1 establishes the responder chain extension and key pipeline wiring; Phase 8a wires it into the concrete alert/sheet/popover components.

### Phase 5d2: Control Action Foundation (Concept 19, [D61]-[D63])

**Status: COMPLETE** (2026-03-05)

**Goal**: The responder chain supports typed action payloads, continuous action phases, explicit-target dispatch, never-hide button semantics, and a last-resort responder. All existing dispatch call sites migrated from bare strings to `ActionEvent` with zero legacy support.

**What was done**:
1. Defined `ActionPhase` type and `ActionEvent` interface in `responder-chain.ts` — `{ action, sender?, value?, phase }` with five phases: `discrete`, `begin`, `change`, `commit`, `cancel`
2. Changed `dispatch()` to accept only `ActionEvent` (clean break — no string overload, no backward compatibility). All handler signatures changed from `() => void` to `(event: ActionEvent) => void`
3. Added `dispatchTo(targetId, event)` for explicit-target dispatch — throws `Error` on unregistered target
4. Added `nodeCanHandle(nodeId, action)` for per-node capability queries without chain walk
5. Added `target` prop to `TugButton` — uses `dispatchTo` and `nodeCanHandle` instead of chain-walk dispatch/canHandle
6. Changed TugButton to never hide — buttons render as `aria-disabled` when unhandled, never return `null`
7. Added `canHandle: () => true` to DeckCanvas as last-resort responder
8. Added ActionEvent Dispatch demo section to gallery Chain Actions tab
9. Migrated all ~40 dispatch call sites and all handler registrations in a single step
10. Removed obsolete `nonexistentAction` button from gallery and its test

**Files modified** (19 total):
1. `tugdeck/src/components/tugways/responder-chain.ts` — ActionPhase, ActionEvent, dispatch signature, dispatchTo, nodeCanHandle
2. `tugdeck/src/components/tugways/use-responder.tsx` — UseResponderOptions.actions type change
3. `tugdeck/src/components/tugways/responder-chain-provider.tsx` — keybinding dispatch produces ActionEvent
4. `tugdeck/src/components/tugways/tug-button.tsx` — target prop, never-hide, ActionEvent dispatch
5. `tugdeck/src/action-dispatch.ts` — dispatch calls produce ActionEvent
6. `tugdeck/src/components/tugways/tugcard.tsx` — handler signatures accept ActionEvent
7. `tugdeck/src/components/chrome/deck-canvas.tsx` — handler signatures, canHandle: () => true
8. `tugdeck/src/components/tugways/cards/gallery-card.tsx` — removed nonexistentAction, added ActionEvent demo
9. `tugdeck/src/__tests__/responder-chain.test.ts` — dispatch migration + dispatchTo/nodeCanHandle tests
10. `tugdeck/src/__tests__/chain-action-button.test.tsx` — dispatch migration + hide-to-disable inversion + target tests
11. `tugdeck/src/__tests__/tugcard.test.tsx` — dispatch migration
12. `tugdeck/src/__tests__/deck-canvas.test.tsx` — dispatch migration + last-resort test
13. `tugdeck/src/__tests__/use-responder.test.tsx` — dispatch migration
14. `tugdeck/src/__tests__/e2e-responder-chain.test.tsx` — dispatch migration
15. `tugdeck/src/__tests__/action-dispatch.test.ts` — mock manager + assertion migration
16. `tugdeck/src/__tests__/component-gallery-action.test.ts` — mock manager migration
17. `tugdeck/src/__tests__/key-pipeline.test.tsx` — handler signature migration
18. `tugdeck/src/__tests__/selection-model.test.tsx` — dispatch migration
19. `tugdeck/src/__tests__/component-gallery.test.tsx` — handler migration, removed nonexistentAction test

**Result**: The responder chain speaks a richer action language. `dispatch()` accepts only `ActionEvent` — bare strings are a compile error. Continuous controls can express begin/change/commit/cancel phases. Inspector panels can target specific cards via `dispatchTo`. TugButton never hides — unhandled actions render as disabled. DeckCanvas is the last-resort responder. 655 tests pass, zero TypeScript errors.

**Note**: Phase 5d2 depends on Phase 5a2 (responder chain infrastructure must be stable). It does not depend on Phase 5d1 (default button) — the two are independent extensions to the responder chain.

### Phase 5d3: Mutation Transactions (Concept 20, [D64]-[D66])

**Goal**: Live-preview editing with snapshot/restore. Inspector scrubs mutate CSS/DOM in the appearance zone; commit finalizes, cancel reverts. Style cascade introspection available for inspector display.

**What to do**:
1. Implement `MutationTransaction` class — `begin(target, properties)` snapshots current CSS/inline/data-attribute values; `preview(target, property, value)` applies appearance-zone mutations; `commit()` finalizes; `cancel()` restores snapshot
2. Implement `MutationTransactionManager` singleton — creates transactions, tracks active transactions per element, auto-cancels previous transaction if a new one starts on the same element
3. Implement `StyleCascadeReader` utility — `getDeclared(element, property)` returns value + source layer (`token`/`class`/`inline`/`preview`); `getComputed(element, property)` returns computed value; `getTokenValue(tokenName)` reads from document computed style
4. Build a vertical-slice demo in the Component Gallery: a mock card element with a color swatch and x/y coordinate fields. Scrubbing the color picker previews the change in real time (appearance zone). Releasing commits. Pressing Escape cancels and restores the original color. The demo shows the cascade reader displaying which layer the current value comes from
5. Verify: preview mutations are pure CSS/DOM (no React re-renders during scrub). Cancel restores exactly the snapshotted state. Commit leaves final values in place. Multiple sequential transactions on the same element work correctly

**Files created/modified**:
1. `tugdeck/src/components/tugways/mutation-transaction.ts` — new: MutationTransaction, MutationTransactionManager
2. `tugdeck/src/components/tugways/style-cascade-reader.ts` — new: StyleCascadeReader utility
3. `tugdeck/src/components/tugways/cards/gallery-card.tsx` — mutation transaction demo section

**Result**: The infrastructure for live-preview editing exists. Inspector panels (Phase 8e) and continuous controls (Phase 8b) can use transactions for scrub-preview-commit workflows without custom snapshot/restore code.

**Note**: Phase 5d3 depends on Phase 5d2 (action phases drive transaction lifecycle) and Phase 4 (mutation model hooks for appearance-zone operations). It does not depend on Phase 5d1.

### Phase 5d4: Observable Properties (Concept 21, [D67]-[D69])

**Goal**: Cards can expose inspectable properties via a typed key-path store. Inspectors discover, read, write, and observe properties without importing card internals. PropertyStore integrates with `useSyncExternalStore` for targeted React re-renders.

**What to do**:
1. Implement `PropertyStore` class — typed key-value store with schema validation, `get(path)`, `set(path, value, source)`, `observe(path, listener)` returning unsubscribe function. Change records include `{ path, oldValue, newValue, source, transactionId? }`
2. Implement `PropertySchema` and `PropertyDescriptor` types — path, type (`string`/`number`/`boolean`/`color`/`point`/`enum`), label, constraints (min/max, enumValues, readOnly)
3. Implement `usePropertyStore` hook — card content components call this to register a PropertyStore with their card. Takes schema + `onGet`/`onSet` callbacks. Returns the store instance
4. Ensure `useSyncExternalStore` compatibility — `PropertyStore.observe()` works as a subscribe function; `PropertyStore.get()` returns stable references for unchanged values (no spurious re-renders)
5. Wire `setProperty` action handler in Tugcard — when a `setProperty` action arrives via the responder chain (from an inspector), route it to the card content's PropertyStore
6. Build a minimal inspector demo in the Component Gallery: a PropertyStore with three properties (color, fontSize, fontFamily). An inspector panel reads the schema, renders appropriate controls, and edits via `dispatchTo`. Changes reflect in both the target element (live preview via transaction) and the inspector fields (via store observation)
7. Verify: inspector reads match card state, inspector writes update the card, changes from the card side notify the inspector, source attribution prevents circular updates, `useSyncExternalStore` triggers re-renders only for the changed property

**Files created/modified**:
1. `tugdeck/src/components/tugways/property-store.ts` — new: PropertyStore, PropertySchema, PropertyChange
2. `tugdeck/src/components/tugways/hooks/use-property-store.ts` — new: usePropertyStore hook
3. `tugdeck/src/components/tugways/tugcard.tsx` — setProperty action handler routing
4. `tugdeck/src/components/tugways/cards/gallery-card.tsx` — inspector demo section

**Result**: The property observation infrastructure is complete. Cards can opt in to inspectability with a hook call and a schema. Inspector panels (Phase 8e) compose with any card via the PropertyStore + responder chain, with zero direct coupling.

**Note**: Phase 5d4 depends on Phase 5d2 (explicit-target dispatch for inspector→card actions) and Phase 5d3 (mutation transactions for live preview). It is the capstone of the 5d sub-phases, establishing the full inspector pipeline.

### Phase 5d5a: Palette Engine (Concept 22, [D70])

**Goal**: A computed OKLCH color palette with 24 hue families and a continuous 0–100 intensity scale, runtime-generated and injectable as CSS custom properties. An interactive gallery demo for tuning the transfer function curve.

**What to do**:
1. Implement `PaletteEngine` TypeScript module — defines the 24 hue families (name + OKLCH angle), the smoothstep-based transfer function mapping intensity (0–100) to OKLCH lightness and chroma, and a `tugPaletteColor(hueName, intensity)` function returning `oklch(...)` strings
2. Implement `tugPaletteVarName(hueName, intensity)` — returns the CSS variable name in `--tug-palette-hue-<angle>-<name>-tone-<intensity>` format
3. Implement standard-stop injection — at app startup and theme switch, compute 264 CSS variables (24 hues x 11 stops at 0, 10, 20, ..., 100) and inject into `<style id="tug-palette">`
4. Implement per-hue chroma capping — `maxChromaForHue(hueAngle)` prevents OKLCH gamut clipping for sRGB displays, especially for yellows and greens at high intensity
5. Implement theme parameter protocol — themes can override hue angles, L/C curve parameters, and chroma caps via CSS custom properties (`--tug-theme-hue-red`, `--tug-theme-lc-l-max`, etc.) consumed by the palette engine at load time
6. Implement named tone aliases — `soft` (15), `default` (50), `strong` (75), `intense` (100) as convenience mappings
7. Build interactive palette gallery demo — displays all 24 hues across the full 0–100 intensity range as a continuous gradient strip. Includes interactive controls for adjusting transfer function parameters (L/C anchors, curve type selection between smoothstep, bezier, and piecewise). Visual comparison mode to evaluate different curve shapes side by side
8. Investigate transfer function alternatives — compare smoothstep, cubic bezier, and piecewise functions. Document findings on which produces the most designer-friendly gradient across hues (especially for yellow/green where OKLCH chroma limits differ significantly from blue/violet)
9. Gamut-check all 24 hues at all standard stops for sRGB and P3 displays. Adjust chroma caps where needed
10. Verify: palette injection < 1ms, `tugPaletteColor()` returns correct oklch strings, theme overrides shift colors correctly, gallery demo renders all 24x11 stops

**Files created/modified**:
1. `tugdeck/src/components/tugways/palette-engine.ts` — new: PaletteEngine, tugPaletteColor, hue definitions, transfer function, injection
2. `tugdeck/src/components/tugways/cards/gallery-card.tsx` — palette demo tab
3. `tugdeck/src/components/tugways/cards/gallery-card.css` — palette demo styles

**Result**: The computed palette is live. Any hue at any intensity is available as a CSS variable (standard stops) or via a TypeScript utility (arbitrary values). The gallery demo provides interactive curve tuning. The transfer function is validated across all hues.

**Note**: Phase 5d5a can start anytime after Phase 5a2 (basic infrastructure must exist). It does not depend on Phases 5d1–5d4. The palette engine is a standalone module that produces CSS variables — it has no coupling to the responder chain, mutation model, or property store.

### Phase 5d5b: Global Scale & Timing (Concept 22, [D72]-[D73])

**Goal**: A single `--tug-scale` value controls all UI dimensions. A single `--tug-timing` value controls all animation durations. A `--tug-motion` toggle disables motion entirely.

**What to do**:
1. Add `--tug-scale: 1`, `--tug-timing: 1`, and `--tug-motion: 1` to `:root` in `tokens.css`
2. Add `prefers-reduced-motion` media query that sets `--tug-motion: 0`
3. Implement `data-tug-motion` attribute management — set `data-tug-motion="off"` on `<body>` when `--tug-motion` is 0. Add global CSS rule that zeroes all animation/transition durations when off
4. Define the scaled dimension token set: every font size, spacing, radius, icon size, and stroke width expressed as `calc(<base> * var(--tug-scale))`. Stroke tokens use `max(1px, calc(...))` floor. Border widths excluded from scaling
5. Define the timed duration token set: every motion duration expressed as `calc(<base> * var(--tug-timing))`
6. Define component-level scale tokens: `--tug-comp-button-scale`, `--tug-comp-tab-scale`, `--tug-comp-dock-scale`, etc. (all default to `1`)
7. Implement JS integration helpers: `getTugScale()`, `getTugTiming()`, `isTugMotionEnabled()` for RAF-based animations and imperative style mutations
8. Build gallery demo — scale slider (0.85–2.0) that resizes all gallery components live. Timing slider (0.1–10.0) that affects all gallery animations. Motion toggle. Component-level scale controls for buttons and tabs
9. Verify: scale 0.85/1.0/1.25/1.5 produce correct proportions across all existing components. Timing 0.5/1.0/5.0 affect all animations. Motion off disables all animation. Component scales compose correctly with global scale

**Files created/modified**:
1. `tugdeck/styles/tokens.css` — global multipliers, scaled tokens, timed tokens
2. `tugdeck/src/components/tugways/scale-timing.ts` — new: JS helpers
3. `tugdeck/src/components/tugways/cards/gallery-card.tsx` — scale/timing demo
4. `tugdeck/src/components/tugways/cards/gallery-card.css` — scale/timing demo styles

**Result**: The entire UI resizes by changing one number. All animations speed up or slow down by changing one number. Motion can be disabled entirely. Component-level scale overrides allow fine-tuning. JS-driven animations respect the same values.

**Note**: Phase 5d5b can start anytime after Phase 5a2. It does not depend on Phase 5d5a (palette engine) — the two are independent and can run in parallel. It does not depend on Phases 5d1–5d4.

### Phase 5d5c: Token Architecture (Concept 22, [D71])

**Goal**: Introduce the `--tug-base-*` and `--tug-comp-*` token layers with the full semantic taxonomy. Temporary aliases bridge old tokens to new tokens. No consumer migration yet.

**What to do**:
1. Define the complete `--tug-base-*` semantic taxonomy in a new `tug-tokens.css` file — all ~300 tokens across surfaces, foreground, icon, borders, elevation, typography, spacing, radius, stroke, icon size, motion, accent, selection, workspace chrome, controls, menus, overlays, feedback, tables, charts, syntax, terminal, chat, files, inspector domains
2. Wire `--tug-base-*` accent tokens to computed palette variables from Phase 5d5a (e.g., `--tug-base-accent-default: var(--tug-palette-hue-55-orange-tone-50)`)
3. Wire all dimension tokens through `var(--tug-scale)` from Phase 5d5b
4. Wire all duration tokens through `var(--tug-timing)` from Phase 5d5b
5. Create temporary backward-compatibility aliases: every `--td-*` and `--tways-*` token gets an alias that points to the equivalent `--tug-base-*` token. This ensures zero visual change while the new layer is being introduced
6. Define initial `--tug-comp-*` component token families where base semantics are too generic (dock buttons, titlebar controls, tab overflow, field metadata, gauge annotations)
7. Verify: all existing components render identically with the backward-compatibility aliases in place. No visual diff in any theme (Brio, Bluenote, Harmony)

**Files created/modified**:
1. `tugdeck/styles/tug-tokens.css` — new: complete `--tug-base-*` taxonomy
2. `tugdeck/styles/tug-comp-tokens.css` — new: `--tug-comp-*` families
3. `tugdeck/styles/tokens.css` — backward-compatibility aliases added
4. `tugdeck/styles/bluenote.css` — palette engine parameter overrides
5. `tugdeck/styles/harmony.css` — palette engine parameter overrides

**Result**: The new token architecture exists in parallel with the old one. All new tokens are defined and wirable. Backward-compatibility aliases ensure zero visual regression. Migration can proceed incrementally in the next phase.

**Note**: Phase 5d5c depends on Phase 5d5a (palette engine must exist for accent/chart/syntax tokens to reference computed palette variables) and Phase 5d5b (scale/timing multipliers must exist for dimension/duration tokens to reference). This is the coordination phase that brings the palette engine and multipliers together into a coherent semantic layer.

### Phase 5d5d: Consumer Migration (Concept 22, [D71])

**Goal**: Migrate all CSS and TypeScript consumers from `--td-*`/`--tways-*` to `--tug-base-*`/`--tug-comp-*`. Remove all legacy aliases. Search-based enforcement.

**What to do**:
1. Migrate tugways component CSS first — `tug-button.css`, `tug-tab-bar.css`, `tugcard.css`, `tug-dropdown.css`, `gallery-card.css`, and all other `components/tugways/*.css` files
2. Migrate chrome CSS — `chrome.css`, `card-frame` styles, `deck-canvas` styles
3. Migrate `globals.css` — repoint the Tailwind v4 `@theme` bridge from legacy aliases to `--tug-base-*` tokens
4. Migrate shadcn wrapper assumptions — update `components/ui/*.tsx` inline styles and any hardcoded token references
5. Migrate chart and syntax consumers — update any TypeScript that reads token values via `getComputedStyle` or sets them via inline styles
6. Migrate runtime token readers/writers — update `StyleCascadeReader`, `MutationTransaction`, and any other TS code that references `--td-*` or `--tways-*` strings
7. Remove backward-compatibility aliases from `tokens.css` — the old `--td-*`, `--tways-*`, and legacy aliases (`--background`, `--foreground`, `--primary`, etc.) are deleted
8. Add search-based enforcement: a CI-friendly script that greps for `--td-`, `--tways-`, and the legacy alias names, failing if any are found outside of migration documentation
9. Verify: all three themes (Brio, Bluenote, Harmony) render correctly with zero visual diff. No `--td-*`, `--tways-*`, or legacy aliases remain in source

**Files modified** (many):
1. `tugdeck/src/components/tugways/*.css` — all component CSS files
2. `tugdeck/styles/chrome.css` — chrome token references
3. `tugdeck/src/globals.css` — Tailwind bridge
4. `tugdeck/src/components/ui/*.tsx` — shadcn wrapper token references
5. `tugdeck/styles/tokens.css` — remove legacy aliases
6. `tugdeck/src/components/tugways/*.ts` — runtime token readers

**Result**: The migration is complete. Only `--tug-palette-*`, `--tug-base-*`, and `--tug-comp-*` tokens exist. The codebase is clean. Enforcement prevents regression.

**Note**: Phase 5d5d depends on Phase 5d5c (new token layers must exist with backward-compatibility aliases before consumers can be migrated). This is the highest-risk phase — it touches many files. The backward-compatibility aliases from 5d5c de-risk it by allowing incremental migration with verification after each file group.

### Phase 5d5e: Cascade Inspector (Concept 22, [D74])

**Goal**: A dev-mode `Ctrl+Option + hover` overlay that shows the full token resolution chain for any inspected component.

**What to do**:
1. Implement `StyleInspectorOverlay` singleton — tracks global modifier state for `Ctrl+Option`, manages overlay lifecycle
2. On pointer move with modifiers active: locate target with `elementFromPoint`, walk to nearest inspect root, read computed style, resolve token chain via `StyleCascadeReader`
3. Display overlay showing: component identity, DOM path, selected computed properties (background, foreground, border, shadow, radius, typography), full resolution chain (`--tug-comp-*` → `--tug-base-*` → `--tug-palette-*`)
4. For computed palette colors: display hue family name, angle, and intensity number (e.g., "orange hue-55, tone 50")
5. Display current `--tug-scale` and `--tug-timing` values and their effect on the inspected element's dimensions and transitions
6. Implement pin/unpin — clicking while inspecting pins the overlay so the user can stop hovering and examine details. `Escape` closes
7. Highlight the target element with a dev-only overlay outline
8. Add gallery demo section showing the inspector in action
9. Verify: inspector correctly resolves all three token layers, palette provenance is accurate, scale/timing readout matches actual values

**Files created/modified**:
1. `tugdeck/src/components/tugways/style-inspector-overlay.ts` — new: StyleInspectorOverlay singleton
2. `tugdeck/src/components/tugways/style-inspector-overlay.css` — new: overlay styles
3. `tugdeck/src/components/tugways/cards/gallery-card.tsx` — inspector demo section

**Result**: The style system is navigable. Developers can point at any element and see exactly which tokens are in play, where they come from, and how scale/timing affect them. The computed palette provenance makes OKLCH color choices transparent.

**Note**: Phase 5d5e depends on Phase 5d5d (token migration must be complete so the inspector shows the final token names, not legacy aliases). It also benefits from Phase 5d3 (`StyleCascadeReader` utility) and Phase 5d4 (`PropertyStore` for additional introspection), though it can function without them.

### Phase 6: Feed Abstraction (Concept 7)

**Goal**: Cards receive typed, accumulated data from backend feeds.

**What to do**:
1. Implement `useFeedBuffer` (ring buffer for append-stream feeds like terminal output) ([D20])
2. Implement `useFeedStore` (indexed store for snapshot feeds like git status)
3. Wire connection frame callbacks to feed distribution
4. Interface-first: define TypeScript types for each feed's payload ([D21])
5. Test with a simple card that displays live feed data

**Result**: Feed data flows from backend → connection → feed hooks → card content. No more `onFrame` method on cards.

### Phase 7: Motion + Startup Continuity (Concept 8)

**Goal**: Enter/exit transitions work. No flash on reload.

**What to do**:
1. Implement enter/exit CSS `@keyframes` driven by `data-state` attributes (Radix pattern)
2. Implement skeleton shimmer with `background-attachment: fixed` for sync
3. Implement the three-layer startup continuity from `eliminate-frontend-flash.md`:
   - Inline body styles in `index.html`
   - Startup overlay div
   - CSS HMR boundary module
4. Test: CSS edit → no flash. Browser reload → no flash. Backend restart → no flash.

**Result**: Visual transitions are smooth. No jarring state changes.

### Phase 8a: Alerts + Title Bar + Dock (Concepts 9, 10, 11)

**Goal**: Full chrome layer.

**What to do**:
1. **Alerts** ([D25], [D26]):
   - Implement `TugAlertHost` at app root
   - Implement `tugAlert()` imperative Promise API
   - Implement `TugSheet` for card-modal dialogs
   - Implement `TugConfirmPopover` for button-local confirmations
   - Implement `TugToast` via Sonner integration
2. **Title bar** ([D27]):
   - Implement window-shade collapse (CSS height transition to 28px)
   - Add `collapsed: boolean` to `CardState`
   - Implement close confirmation via `TugConfirmPopover`
   - Change menu icon from `EllipsisVertical` to `Ellipsis`
3. **Dock** ([D28], [D29]):
   - Rewrite Dock from scratch with three button types
   - Implement declarative `DockConfig` shape
   - Implement dock placement (any edge)
   - Add Radix Tooltip hover labels
   - Wire dock button actions through responder chain

**Design reference**: Retronow's titlebar, tabs, dialog, toast, popup, and button patterns (`retronow-components.css`, `RetronowComponentPackPage.tsx`) are the visual models for alerts, title bar, and dock. See [Retronow Design Reference](#retronow-design-reference).

**Result**: The dock replaces Mac menu commands as the primary UI for creating and managing cards. Chrome is complete.

### Phase 8b: Form Controls + Core Display ([D34])

**Goal**: Settings card has all the form controls it needs. Core display primitives available to all cards.

**What to do**:
1. Install shadcn primitives not yet present: `slider`, `label`, `separator`
2. Implement 8 form control wrappers:
   - `TugInput` — wraps Input, adds validation states, error styling, `--td-*` tokens
   - `TugTextarea` — wraps Textarea, adds auto-resize option, char count, error state
   - `TugSelect` — wraps Select, adds tugways variants, token-based styling
   - `TugCheckbox` — wraps Checkbox, adds label integration, mixed state
   - `TugRadioGroup` — wraps RadioGroup, adds group label, horizontal/vertical layout
   - `TugSwitch` — wraps Switch, adds label position, size variants
   - `TugSlider` — wraps Slider, adds value display, range labels, tick marks. Emits action phases (`begin`/`change`/`commit`/`cancel`) per [D61] when used with `action` prop
   - `TugLabel` — wraps Label, adds required indicator, helper text slot
3. Implement `TugSeparator` wrapper — horizontal/vertical, label slot
4. All continuous controls (TugSlider, TugInput, TugTextarea) support the `action`/`target` props from [D61]/[D62] for chain-action mode with phases. Direct-action mode via `onChange` remains available
5. Add all 9 components to the Component Gallery with interactive controls
6. Write tests for each component following the established hook test pattern

**Result**: All form controls exist. Continuous controls emit action phases for inspector integration. The Settings card can be built.

### Phase 8c: Display, Feedback & Navigation ([D34])

**Goal**: Loading states, status display, menus, and scroll areas available to all cards.

**What to do**:
1. Install shadcn primitives not yet present: `context-menu`
2. Implement 7 display and feedback components:
   - `TugBadge` (original) — tone variants (good/warn/alert/info), pill shape, count mode
   - `TugSpinner` (original) — size variants, standalone loading indicator
   - `TugProgress` (original) — horizontal bar, percentage, indeterminate mode
   - `TugSkeleton` (original) — shimmer placeholder, `background-attachment: fixed` sync ([D23])
   - `TugKbd` (original) — keyboard shortcut chip display
   - `TugAvatar` (original) — image + fallback initials, size variants
   - `TugStatusIndicator` (original) — tone-colored dot + text (good/warn/alert/info)
3. Implement 4 navigation and overlay wrappers:
   - `TugTooltip` — wraps Tooltip, hover labels, kbd shortcut display
   - `TugDropdownMenu` — wraps DropdownMenu, kbd shortcuts in items, tone icons
   - `TugScrollArea` — wraps ScrollArea, themed scrollbar, autohide
   - `TugContextMenu` — wraps ContextMenu, right-click menus for cards
4. Add all 11 components to the Component Gallery
5. Write tests for each component

**Result**: Cards have loading states, status badges, scrollable areas, and context menus. Every card type has the display primitives it needs.

### Phase 8d: Data Display, Visualization & Compound Components ([D34])

**Goal**: Data-heavy cards (Stats, Git, Files, Conversation) have their specialized components.

**What to do**:
1. Install shadcn primitive not yet present: `table`
2. Implement 4 data display components:
   - `TugTable` (wrapper) — wraps Table, adds sortable columns, stripe option
   - `TugStatCard` (original) — key-value metric display (label + large number + trend)
   - `TugDialog` (wrapper) — wraps Dialog, general-purpose (not alert/sheet)
   - `TugButtonGroup` (composition) — connected button row, shared border radius
3. Implement 3 data visualization originals (from retronow custom instruments):
   - `TugSparkline` — SVG inline chart with 4 variants: area, line, column, bar
   - `TugLinearGauge` — horizontal gauge with needle, thresholds, major/minor tick marks
   - `TugArcGauge` — radial gauge with needle, arc fill, center readout
4. Implement 1 compound component:
   - `TugChatInput` (composition) — TugTextarea + submit button + file attachment button, Shift+Enter for newline, Enter to submit
5. Add all 8 components to the Component Gallery with interactive controls
6. Write tests for each component

**Design reference**: Sparklines and gauges are drawn directly from the retronow custom instruments (`retronow-unified-review.html`). The gauge configuration controls (scale, tick counts, format units, accent colors) serve as the reference for prop design. See [Retronow Design Reference](#retronow-design-reference).

**Result**: The full 28-component library is complete. The Component Gallery is a comprehensive design system showcase. Phase 9 card rebuilds can begin.

### Phase 8e: Inspector Panels (Concepts 19–21, [D61]-[D69])

**Goal**: Color picker, font picker, and coordinate inspector panels available as first-class tugways components. Each emits action phases (begin/change/commit/cancel), works with mutation transactions for live preview, and reads/writes via PropertyStore.

**What to do**:
1. Implement `TugColorPicker` (original) — hue/saturation/brightness wheel or strip, opacity slider, hex/RGB input, swatch history. Emits `setColor` action with `begin/change/commit/cancel` phases. During `change` phase, uses MutationTransaction for live preview on the target element
2. Implement `TugFontPicker` (original) — font family dropdown (system fonts), font size TugSlider, weight/style toggles. Emits `setFontSize`, `setFontFamily`, `setFontWeight` actions with phases
3. Implement `TugCoordinateInspector` (original) — x/y/width/height number fields with scrub-on-drag (drag the label to scrub the value). Emits `setPosition`, `setSize` actions with phases. Fields read from PropertyStore and update on external changes
4. Implement `TugInspectorPanel` (composition) — container that hosts inspector sections. Reads `PropertyStore.getSchema()` from the focused card and dynamically renders appropriate controls for each property. Registers as a responder node. Uses explicit-target dispatch (D62) to send edits to the focused card
5. Wire `TugInspectorPanel` to respond to card focus changes — when the focused card changes, the inspector reads the new card's PropertyStore schema and updates its displayed controls. If the focused card has no PropertyStore, the inspector shows "No inspectable properties"
6. Add all inspector components to the Component Gallery with interactive demos
7. Verify: color picker scrub previews live with transaction, commit persists, cancel reverts. Font picker changes cascade through CSS. Coordinate inspector reflects current values and updates on external changes. Inspector works with any card that registers a PropertyStore

**Files created/modified**:
1. `tugdeck/src/components/tugways/tug-color-picker.tsx` — new
2. `tugdeck/src/components/tugways/tug-font-picker.tsx` — new
3. `tugdeck/src/components/tugways/tug-coordinate-inspector.tsx` — new
4. `tugdeck/src/components/tugways/tug-inspector-panel.tsx` — new
5. `tugdeck/styles/tug-inspector.css` — new

**Result**: Inspector panels are reusable tugways components. Any card that exposes a PropertyStore gets free inspector support. The color/font/coordinate controls are available standalone for use in card content (e.g., a settings card's theme color editor).

**Note**: Phase 8e depends on Phases 5d2–5d4 (action phases, mutation transactions, PropertyStore must exist) and Phase 8b (TugSlider and form controls used internally by inspector components). It does not depend on Phase 8a (chrome) or Phase 8d (data viz). Phase 8e is an enhancement — it does not block Phase 9, but Phase 9 cards benefit from PropertyStore support.

### Phase 9: Card Rebuild

**Goal**: All card content rebuilt on new infrastructure.

**What to do** (one card at a time):
1. **Terminal card** — rebuild on Tugcard + useFeedBuffer. xterm.js integration. Most complex, proves feed streaming works.
2. **Code/Conversation card** — rebuild on Tugcard + useFeedStore. Revive code-block, message-renderer, etc. from deleted files.
3. **Git card** — rebuild on Tugcard + useFeedStore. Snapshot feed.
4. **Files card** — rebuild on Tugcard + useFeedStore. Snapshot feed.
5. **Stats card** — rebuild on Tugcard + useFeedBuffer/Store. Multiple feeds.
6. **Settings card** — rebuild on Tugcard. Uses theme provider.
7. **Developer card** — rebuild on Tugcard. Dev-mode features.
8. **About card** — rebuild on Tugcard. Static content.

**Design reference**: Retronow's card frame, header, and canvas patterns (`RetronowDeckCanvas.tsx`, `retronow-deck.css`, `retronow-classes.ts`) are the visual models for card chrome and layout. See [Retronow Design Reference](#retronow-design-reference).

Each rebuilt card can optionally expose a `PropertyStore` via `usePropertyStore` ([D67]) for inspector integration. Cards that expose inspectable properties (style, layout, content settings) get free inspector panel support without any inspector-specific code.

**Result**: Full app restored with new infrastructure. Every card uses Tugcard composition, feed hooks, responder chain, and the three-zone mutation model. Cards with PropertyStore registrations are automatically inspectable.

## Phase Dependencies

```
Phase 0: Demolition
    │
    ▼
Phase 1: Theme Foundation ──────────────────────────────────┐
    │                                                        │
    ▼                                                        │
Phase 2: First Component + Gallery                           │
    │                                                        │
    ├────────────────┐                                       │
    ▼                ▼                                       │
Phase 3:         Phase 4:                                    │
Responder Chain  Mutation Model                              │
    │                │                                       │
    └────────┬───────┘                                       │
             ▼                                               │
         Phase 5: Tugcard Base                               │
             │                                               │
             ▼                                               │
         Phase 5a: Selection Model                           │
             │                                               │
             ▼                                               │
         Phase 5a2: DeckManager Store Migration              │
             │                                               │
             ├──────────┬──────────┬──────────┬──────┐       │
             ▼          ▼          ▼          ▼      ▼       ▼
         Phase 5b:  Phase 5c:  Phase 5d1: Phase 6:  Phase 7:
         Card Tabs  Card Snap  Default    Feed Abs. Motion
                        │      Button               ◄── (tokens from Phase 1)
                        ▼          │
                    Phase 5c2:  Phase 5d2:
                    Snap Set    Control Action
                    Refinements Foundation
                                   │
                                Phase 5d3:
                                Mutation
                                Transactions
                                   │
                                Phase 5d4:
                                Observable
                                Properties
             │                    │
             ├────────┐            │
             ▼        ▼            ▼
         Phase 5b2: Phase 5b3: Phase 8a:
         Tab Drag   Gallery    Chrome
         Gestures   Card          │
             │        │        Phase 8b: Form Controls
             ├────────┤           │
             ▼        │        Phase 8c: Display & Nav
         Phase 5b4:   │           │
         Tab          │        Phase 8d: Data Viz & Compound
         Overflow     │           │
             │        │        Phase 8e: ◄─── (5d2 + 5d3 + 5d4 + 8b)
         Phase 5b5:   │        Inspector
         Tab          │        Panels
         Refinements  │                    │         │       │
             │        │                    │         │       │
             │     Phase 5e: ◄─────────────┤         │       │
             │     Tugbank                 │         │       │
             │        │                    │         │       │
             │     Phase 5f: ◄─── (5b + 5e)│         │       │
             │     State                   │         │       │
             │     Preservation            │         │       │
             │        │                    │         │       │
             └────────┴────────────────┬───┴─────────┴───────┘
                                       ▼
                          Phase 9: Card Rebuild

    Theme Token Overhaul (can run in parallel with 5b–8e):

         Phase 5d5a: ◄─── (5a2)    Phase 5d5b: ◄─── (5a2)
         Palette Engine             Scale & Timing
             │                          │
             └────────────┬─────────────┘
                          ▼
                  Phase 5d5c: ◄─── (5d5a + 5d5b)
                  Token Architecture
                          │
                          ▼
                  Phase 5d5d: ◄─── (5d5c)
                  Consumer Migration
                          │
                          ▼
                  Phase 5d5e: ◄─── (5d5d, benefits from 5d3 + 5d4)
                  Cascade Inspector
```

Phases 3 and 4 can run in parallel. Phase 5a (Selection Model) depends on Phase 5 and
should be completed before Phase 5a2 and all subsequent phases — card content in all
subsequent phases needs correct selection behavior from the start. Phase 5a2 (DeckManager
Store Migration) depends on Phase 5a and must complete before Phases 5b, 5c, 5d1, 6, 7,
and 8a — all subsequent phases inherit the deterministic event flow guarantees established
by the store migration. Phases 5b, 5c, 5d1, 6, and 7 can all start as soon as Phase 5a2
completes (Phase 7 also needs Phase 1's motion tokens). Phase 5d1 (Default Button) adds
`setDefaultButton`/`clearDefaultButton` to the responder chain and wires Enter at stage 2
of the key pipeline — a prerequisite for Phase 8a's alert, sheet, and popover components,
which register their default buttons on mount. Phase 8a (Alerts + Title Bar + Dock)
depends on Phase 5d1 for the default button mechanism. Phases 8b–8d are sequential (each
wave builds on the previous) and depend on Phase 2 (Component Gallery exists) and Phase 4
(mutation model hooks). They can run in parallel with Phases 5b, 5c, 6, and 7. Phase 9
(Card Rebuild) is the true convergence point: rebuilt cards need feeds (Phase 6) for data,
motion (Phase 7) for skeleton/transitions, chrome (Phase 8a) for title bar and dock, and
the component library (Phases 8b–8e) for form controls, data display, visualization, and inspectors.
Phases 5b, 5b2, 5b3, 5b4, 5b5, 5c, 5c2, and 5d1–5d4 are enhancements that can land before, during, or after Phase 9.
Phase 5c2 (Card Snap Set Refinements) depends on Phase 5c (snap and set-move must exist). It adds set visual identity: corner rounding, perimeter flash, border collapse, and break-out restoration.
Phase 5b2 (Tab Drag Gestures) depends on Phase 5b (tab bar component and tab state must exist).
Phase 5b3 (Gallery Card) depends on Phase 5b (tab system must exist). It does not depend on Phase 5b2.
Phase 5b4 (Tab Overflow) depends on Phase 5b (tab bar must exist). It does not depend on Phase 5b2 or 5b3, though both benefit from overflow handling.
Phase 5b5 (Tab Refinements) depends on Phase 5b2 (drag coordinator and hit-test infrastructure must exist). It is a collection phase — additional items may be added during 5b3/5b4 implementation.
Phase 5d2 (Control Action Foundation) depends on Phase 5a2 (responder chain infrastructure must be stable). It does not depend on Phase 5d1 — the two are independent extensions to the responder chain.
Phase 5d3 (Mutation Transactions) depends on Phase 5d2 (action phases drive transaction lifecycle) and Phase 4 (mutation model hooks for appearance-zone operations).
Phase 5d4 (Observable Properties) depends on Phase 5d2 (explicit-target dispatch) and Phase 5d3 (mutation transactions for live preview). It is the capstone of the 5d sub-phases.
Phase 5e (Tugbank) can start anytime after Phase 5a2 — it is primarily Rust/backend work with a small `settings-api.ts` update. It does not depend on any frontend phase beyond the basic infrastructure.
Phase 5f (State Preservation) depends on Phase 5e (tugbank must exist for durable storage) and Phase 5b (tabs must exist for per-tab state lifecycle). It does not block Phase 9, but Phase 9 cards benefit from the `useTugcardPersistence` hook.
Phase 8e (Inspector Panels) depends on Phases 5d2–5d4 (action phases, mutation transactions, PropertyStore) and Phase 8b (TugSlider and form controls). It does not block Phase 9, but Phase 9 cards benefit from PropertyStore support for inspector integration.
Phase 5d5a (Palette Engine) can start anytime after Phase 5a2. It is a standalone module with no coupling to the responder chain, mutation model, or property store. It does not depend on Phases 5d1–5d4.
Phase 5d5b (Global Scale & Timing) can start anytime after Phase 5a2. It is independent of Phase 5d5a — the two can run in parallel.
Phase 5d5c (Token Architecture) depends on Phase 5d5a (palette variables for accent/chart/syntax tokens) and Phase 5d5b (scale/timing multipliers for dimension/duration tokens). It introduces the new layers with backward-compatibility aliases for zero-risk introduction.
Phase 5d5d (Consumer Migration) depends on Phase 5d5c (new token layers must exist before consumers migrate). This is the highest-risk phase — it touches many files. The backward-compatibility aliases from 5d5c de-risk it by enabling incremental migration.
Phase 5d5e (Cascade Inspector) depends on Phase 5d5d (token migration must be complete so the inspector shows final names). It benefits from Phase 5d3 (StyleCascadeReader) and Phase 5d4 (PropertyStore) but can function without them.
The 5d5 sub-phases are an enhancement track that can run in parallel with Phases 5b–8e. They do not block Phase 9. Phase 5d5d (Consumer Migration) should ideally complete before Phase 9 begins, so rebuilt cards use the new token names from the start.

## Estimated Scope

| Phase | New/Modified Files | Rough Size |
|-------|-------------------|------------|
| 0 | -40 files deleted, 3 gutted | Net reduction: ~8000 lines |
| 1 | ~5 files | ~300 lines |
| 2 | ~3 files | ~400 lines |
| 3 | ~4 files | ~500 lines |
| 4 | ~3 files | ~200 lines |
| 5 | ~8 files | ~1200 lines |
| 5a | ~5 files | ~400 lines |
| 5a2 | ~4 files | ~200 lines |
| 5b | ~4 files | ~400 lines |
| 5b2 | ~3 files | ~300 lines |
| 5b3 | ~5 files | ~400 lines |
| 5b4 | ~3 files | ~300 lines |
| 5b5 | ~2 files | ~100 lines |
| 5c | ~1 file | ~50 lines |
| 5c2 | ~3 files | ~200 lines |
| 5d1 | ~3 files | ~150 lines |
| 5d2 | ~3 files | ~200 lines |
| 5d3 | ~3 files | ~300 lines |
| 5d4 | ~4 files | ~400 lines |
| 5d5a | ~3 files | ~400 lines |
| 5d5b | ~4 files | ~300 lines |
| 5d5c | ~5 files | ~600 lines |
| 5d5d | ~20 files | ~500 lines (net change, mostly renames) |
| 5d5e | ~3 files | ~400 lines |
| 5e | ~10 files | ~1500 lines |
| 5f | ~6 files | ~500 lines |
| 6 | ~4 files | ~400 lines |
| 7 | ~3 files | ~200 lines |
| 8a | ~8 files | ~1000 lines |
| 8b | ~9 files | ~800 lines |
| 8c | ~11 files | ~700 lines |
| 8d | ~8 files | ~1000 lines |
| 8e | ~5 files | ~800 lines |
| 9 | ~20 files | ~3000 lines |

**Total rebuild: ~17,900 lines** replacing the current ~9700 lines. The new
codebase is larger because the 28-component library (Phases 8a–8d) adds ~2500
lines of reusable UI primitives, the control action/transaction/property
infrastructure (Phases 5d2–5d4) adds ~900 lines, the inspector panels (Phase 8e)
add ~800 lines, tugbank (Phase 5e) adds ~1500 lines of Rust infrastructure
for typed persistence, and the theme token overhaul (Phases 5d5a–5d5e) adds
~2200 lines of palette engine, scaled/timed tokens, semantic taxonomy, and
cascade inspector. The triple-registration redundancy is gone, the adapter
layer is gone, and the component abstractions do more with less code.

## How This Drives Tugplan Creation

Each phase becomes one tugplan. The phases are designed to be:

- **Self-contained**: each phase has a clear deliverable and can be verified independently
- **Testable**: each phase produces something visible (empty canvas, gallery component, working card)
- **Ordered but parallelizable**: phases 3+4 can overlap, phase 7 can start early
- **Right-sized**: each phase is 200–1200 lines of new code, which fits well in a single plan

The suggested plan sequence:

1. `tugways-phase-0-demolition` — tear down, verify empty canvas
2. `tugways-phase-1-theme` — tokens, theme loading, directory structure
3. `tugways-phase-2-first-component` — TugButton + gallery
4. `tugways-phase-3-responder-chain` — event routing
5. `tugways-phase-4-mutation-model` — DOM hooks, three-zone discipline
6. `tugways-phase-5-tugcard` — card base component, new DeckManager
7. `tugways-phase-5a-selection-model` — selection containment, SelectionGuard, developer API
8. `tugways-phase-5a2-deckmanager-store` — subscribable store, eliminate root.render() calls, useLayoutEffect registration
9. `tugways-phase-5b-card-tabs` — tab bar, icons, type picker, tab switching, active/inactive states
10. `tugways-phase-5b2-tab-drag-gestures` — reorder, detach to new card, merge into existing card
11. `tugways-phase-5b3-gallery-card` — convert Component Gallery to a proper tabbed card
12. `tugways-phase-5b4-tab-overflow` — progressive tab collapse: icon-only, then overflow dropdown
13. `tugways-phase-5b5-tab-refinements` — card-as-tab merge, additional refinements
14. `tugways-phase-5c-card-snapping` — modifier-gated snap, Option+drag to form sets, `Geometric engine` section features used
15. `tugways-phase-5c2-card-snapping-refinements` — set corner rounding, outer-hull perimeter flash, break-out restoration, border collapse
16. `tugways-phase-5d1-default-button` — Enter key routing, default button registration, primary variant as default button visual
17. `tugways-phase-5d2-control-action` — ActionEvent with payloads/phases, explicit-target dispatch, control/responder separation
18. `tugways-phase-5d3-mutation-transactions` — snapshot/preview/commit/cancel, StyleCascadeReader, vertical-slice gallery demo
19. `tugways-phase-5d4-observable-properties` — PropertyStore, usePropertyStore hook, inspector demo
20. `tugways-phase-5d5a-palette-engine` — computed OKLCH palette, 24 hues x 0–100 intensity, transfer function, interactive gallery demo
21. `tugways-phase-5d5b-scale-timing` — global scale, global timing, motion toggle, per-component scale, JS helpers
22. `tugways-phase-5d5c-token-architecture` — `--tug-base-*` and `--tug-comp-*` layers, full semantic taxonomy, backward-compatibility aliases
23. `tugways-phase-5d5d-consumer-migration` — migrate all CSS/TS from `--td-*`/`--tways-*`, remove legacy aliases, enforcement
24. `tugways-phase-5d5e-cascade-inspector` — dev-mode Ctrl+Option hover, token chain resolution, palette provenance
25. `tugways-phase-5e-tugbank` — SQLite-backed defaults store, CLI, HTTP bridge, settings migration
26. `tugways-phase-5f-state-preservation` — per-tab state bags, scroll/selection persistence, collapse field, focused card, useTugcardPersistence hook
27. `tugways-phase-6-feed` — feed hooks, data flow
28. `tugways-phase-7-motion` — transitions, skeleton, startup continuity
29. `tugways-phase-8a-chrome` — alerts, title bar, dock (depends on 5d1 for default button)
30. `tugways-phase-8b-form-controls` — form controls + core display (9 components); continuous controls emit action phases (D61)
31. `tugways-phase-8c-display-nav` — display, feedback & navigation (11 components)
32. `tugways-phase-8d-data-viz` — data display, visualization & compound (8 components)
33. `tugways-phase-8e-inspector-panels` — TugColorPicker, TugFontPicker, TugCoordinateInspector, TugInspectorPanel
34. `tugways-phase-9a-terminal` through `tugways-phase-9h-about` — one plan per card; each card can expose PropertyStore for inspector support

## Resolved Questions

1. **Conversation card sub-components**: The code-block renderer, message
   renderer, approval prompt, etc. are real work (~800 lines). **Archive in
   `_archive/`** during demolition for easy revival.

2. **Backend changes**: None needed. The feed abstraction (concept 7) is
   entirely a frontend refactor. The binary wire protocol (`[FeedId][length]
   [Uint8Array]`) stays as-is. Concept 7's TypeScript interfaces are frontend
   decode targets — they describe the shape of data after the frontend decodes
   the bytes it already receives. The `decode` function on each Tugcard converts
   `Uint8Array` → typed object, same as today's ad-hoc parsing, just
   standardized. The only new backend work is the optional `FeedId.TUG_FEED`
   (`0x50`) for the tug-feed progress stream — a new feature, not a change to
   existing feeds, and explicitly designed to come later per [D21].

3. **Incremental usability**: Mac menu commands are acceptable until the dock
   is built (Phase 8). Phase 8 can start right after Phase 5 — it doesn't
   need to wait for feeds, motion, tabs, or snapping.

4. **Test strategy**: Per-phase. Write tests for each new component as it's
   built, not as a batch sweep at the end.
