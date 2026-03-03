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

### Phase 5c: Card Snapping (Concept 13)

**Goal**: Snap-to-edge and set formation require the Option (Alt) modifier. Free drag is the default.

**What to do**:
1. Gate snap behavior on Option (Alt) modifier ([D32]): in DeckManager's drag handler, only call `computeSnap` and show guides when `event.altKey` is true. Free drag is the default.
2. Support mid-drag modifier toggle: pressing/releasing Option during a drag immediately shows/hides guides and snaps/unsnaps
3. Verify set-move still works without modifier once a set is formed ([D33])
4. Verify break-out behavior: drag a set member away to detach, then Option+drag to snap elsewhere
5. Test with multiple cards: create cards via menu, Option+drag to snap, verify set formation and set-move

**Result**: Casual drags are free movement. Option+drag activates snap guides and set formation. Existing set-move and break-out behavior preserved.

### Phase 5d: Default Button (Concept 3, [D39])

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

**Note**: Phase 5d depends on Phase 3 (responder chain exists) and Phase 5 (Tugcard base, where alerts and sheets are first consumed). It does not depend on Phase 8a (which builds TugAlert/TugSheet/TugConfirmPopover) — rather, Phase 8a depends on Phase 5d for the default button registration mechanism. Phase 5d establishes the responder chain extension and key pipeline wiring; Phase 8a wires it into the concrete alert/sheet/popover components.

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
   - `TugSlider` — wraps Slider, adds value display, range labels, tick marks
   - `TugLabel` — wraps Label, adds required indicator, helper text slot
3. Implement `TugSeparator` wrapper — horizontal/vertical, label slot
4. Add all 9 components to the Component Gallery with interactive controls
5. Write tests for each component following the established hook test pattern

**Result**: All form controls exist. The Settings card can be built.

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

**Result**: Full app restored with new infrastructure. Every card uses Tugcard composition, feed hooks, responder chain, and the three-zone mutation model.

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
         Phase 5b:  Phase 5c:  Phase 5d:  Phase 6:  Phase 7:
         Card Tabs  Card Snap  Default    Feed Abs. Motion
             │                 Button               ◄── (tokens from Phase 1)
             ▼                    │
         Phase 5b2:               ▼
         Tab Drag              Phase 8a:
         Gestures              Chrome
                                  │
                               Phase 8b: Form Controls
                                  │
                               Phase 8c: Display & Nav
                                  │
                               Phase 8d: Data Viz & Compound
             │          │                    │         │       │
             └──────────┴────────────────┬───┴─────────┴───────┘
                                         ▼
                            Phase 9: Card Rebuild
```

Phases 3 and 4 can run in parallel. Phase 5a (Selection Model) depends on Phase 5 and
should be completed before Phase 5a2 and all subsequent phases — card content in all
subsequent phases needs correct selection behavior from the start. Phase 5a2 (DeckManager
Store Migration) depends on Phase 5a and must complete before Phases 5b, 5c, 5d, 6, 7,
and 8a — all subsequent phases inherit the deterministic event flow guarantees established
by the store migration. Phases 5b, 5c, 5d, 6, and 7 can all start as soon as Phase 5a2
completes (Phase 7 also needs Phase 1's motion tokens). Phase 5d (Default Button) adds
`setDefaultButton`/`clearDefaultButton` to the responder chain and wires Enter at stage 2
of the key pipeline — a prerequisite for Phase 8a's alert, sheet, and popover components,
which register their default buttons on mount. Phase 8a (Alerts + Title Bar + Dock)
depends on Phase 5d for the default button mechanism. Phases 8b–8d are sequential (each
wave builds on the previous) and depend on Phase 2 (Component Gallery exists) and Phase 4
(mutation model hooks). They can run in parallel with Phases 5b, 5c, 6, and 7. Phase 9
(Card Rebuild) is the true convergence point: rebuilt cards need feeds (Phase 6) for data,
motion (Phase 7) for skeleton/transitions, chrome (Phase 8a) for title bar and dock, and
the component library (Phases 8b–8d) for form controls, data display, and visualization.
Phases 5b, 5b2, 5c, and 5d are enhancements that can land before, during, or after Phase 9.
Phase 5b2 (Tab Drag Gestures) depends on Phase 5b (tab bar component and tab state must exist).

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
| 5c | ~1 file | ~50 lines |
| 5d | ~3 files | ~150 lines |
| 6 | ~4 files | ~400 lines |
| 7 | ~3 files | ~200 lines |
| 8a | ~8 files | ~1000 lines |
| 8b | ~9 files | ~800 lines |
| 8c | ~11 files | ~700 lines |
| 8d | ~8 files | ~1000 lines |
| 9 | ~20 files | ~3000 lines |

**Total rebuild: ~11,200 lines** replacing the current ~9700 lines. The new
codebase is modestly larger because the 28-component library (Phases 8a–8d)
adds ~2500 lines of reusable UI primitives that the old codebase lacked. The
triple-registration redundancy is gone, the adapter layer is gone, and the
component abstractions do more with less code.

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
11. `tugways-phase-5c-card-snapping` — modifier-gated snap, Option+drag to form sets
12. `tugways-phase-5d-default-button` — Enter key routing, default button registration, primary variant as default button visual
13. `tugways-phase-6-feed` — feed hooks, data flow
14. `tugways-phase-7-motion` — transitions, skeleton, startup continuity
15. `tugways-phase-8a-chrome` — alerts, title bar, dock (depends on 5d for default button)
16. `tugways-phase-8b-form-controls` — form controls + core display (9 components)
17. `tugways-phase-8c-display-nav` — display, feedback & navigation (11 components)
18. `tugways-phase-8d-data-viz` — data display, visualization & compound (8 components)
19. `tugways-phase-9a-terminal` through `tugways-phase-9h-about` — one plan per card

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
