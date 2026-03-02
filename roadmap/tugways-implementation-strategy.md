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

### Phase 5b: Card Tabs (Concept 12)

**Goal**: Cards support multiple tabs. Tab bar appears when a card has more than one tab.

**What to do**:
1. Implement `TugTabBar` component — horizontal tab strip with tab select, close, add, and reorder ([D30])
2. Wire tab state into Tugcard: `tabs` array, `activeTabId`, content switching ([D31])
3. Tab bar renders only when `tabs.length > 1` — single-tab cards show no tab bar
4. Active tab's content mounts; inactive tabs unmount (responder chain follows automatically)
5. Wire Mac menu command to add a tab to the focused card (for testing)
6. Verify tab persistence via existing `CardState.tabs` / `CardState.activeTabId` in serialization
7. Add TugTabBar to the Component Gallery

**Result**: A card can host multiple tabs. Switching tabs changes the visible content and the active responder. The tab bar is invisible for the common single-tab case.

**Note**: Drag-to-merge and drag-to-detach tab gestures are stretch goals for a later phase. This phase covers click-based tab management only.

### Phase 5c: Card Snapping (Concept 13)

**Goal**: Snap-to-edge and set formation require the Option (Alt) modifier. Free drag is the default.

**What to do**:
1. Gate snap behavior on Option (Alt) modifier ([D32]): in DeckManager's drag handler, only call `computeSnap` and show guides when `event.altKey` is true. Free drag is the default.
2. Support mid-drag modifier toggle: pressing/releasing Option during a drag immediately shows/hides guides and snaps/unsnaps
3. Verify set-move still works without modifier once a set is formed ([D33])
4. Verify break-out behavior: drag a set member away to detach, then Option+drag to snap elsewhere
5. Test with multiple cards: create cards via menu, Option+drag to snap, verify set formation and set-move

**Result**: Casual drags are free movement. Option+drag activates snap guides and set formation. Existing set-move and break-out behavior preserved.

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

### Phase 8: Alerts + Title Bar + Dock (Concepts 9, 10, 11)

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
Phase 1: Theme Foundation ─────────────────────────────┐
    │                                                    │
    ▼                                                    │
Phase 2: First Component + Gallery                       │
    │                                                    │
    ├────────────────┐                                   │
    ▼                ▼                                   │
Phase 3:         Phase 4:                                │
Responder Chain  Mutation Model                          │
    │                │                                   │
    └────────┬───────┘                                   │
             ▼                                           │
         Phase 5: Tugcard Base                           │
             │                                           │
             ├──────────┬──────────┬──────────┬──────┐   │
             ▼          ▼          ▼          ▼      ▼   ▼
         Phase 5b:  Phase 5c:  Phase 6:  Phase 7:  Phase 8:
         Card Tabs  Card Snap  Feed Abs. Motion    Chrome
                                         ◄── (tokens from Phase 1)
             │          │          │         │       │
             └──────────┴──────┬───┴─────────┴───────┘
                               ▼
                  Phase 9: Card Rebuild
```

Phases 3 and 4 can run in parallel. Phases 5b, 5c, 6, 7, and 8 can all start as soon
as Phase 5 completes (Phase 7 also needs Phase 1's motion tokens). Phase 8 (Alerts +
Title Bar + Dock) only needs Tugcard (Phase 5) and the responder chain (Phase 3, already
done) — it does not depend on feeds, motion, tabs, or snapping. Phase 9 (Card Rebuild)
is the true convergence point: rebuilt cards need feeds (Phase 6) for data, motion
(Phase 7) for skeleton/transitions, and chrome (Phase 8) for title bar and dock. Phases
5b and 5c are enhancements that can land before, during, or after Phase 9.

## Estimated Scope

| Phase | New/Modified Files | Rough Size |
|-------|-------------------|------------|
| 0 | -40 files deleted, 3 gutted | Net reduction: ~8000 lines |
| 1 | ~5 files | ~300 lines |
| 2 | ~3 files | ~400 lines |
| 3 | ~4 files | ~500 lines |
| 4 | ~3 files | ~200 lines |
| 5 | ~8 files | ~1200 lines |
| 5b | ~3 files | ~350 lines |
| 5c | ~1 file | ~50 lines |
| 6 | ~4 files | ~400 lines |
| 7 | ~3 files | ~200 lines |
| 8 | ~8 files | ~1000 lines |
| 9 | ~20 files | ~3000 lines |

**Total rebuild: ~7600 lines** replacing the current ~9700 lines. The new
codebase is smaller because the triple-registration redundancy is gone, the
adapter layer is gone, and the component abstractions do more with less code.

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
7. `tugways-phase-5b-card-tabs` — tab bar, tab switching, multi-tab cards
8. `tugways-phase-5c-card-snapping` — modifier-gated snap, Option+drag to form sets
9. `tugways-phase-6-feed` — feed hooks, data flow
10. `tugways-phase-7-motion` — transitions, skeleton, startup continuity
11. `tugways-phase-8-chrome` — alerts, title bar, dock
12. `tugways-phase-9a-terminal` through `tugways-phase-9h-about` — one plan per card

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
