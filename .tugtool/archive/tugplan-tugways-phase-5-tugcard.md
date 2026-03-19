<!-- tugplan-skeleton v2 -->

## Tugways Phase 5: Tugcard Base Component System {#tugways-phase-5-tugcard}

**Purpose:** Ship the Tugcard composition component, the `useTugcardData` hook, rebuilt CardFrame, single-registry card registration, rebuilt DeckManager orchestrator, and a Hello test card proving the end-to-end pipeline from Mac menu command to rendered, draggable, resizable card on the canvas.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5-tugcard |
| Last updated | 2026-03-02 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phases 0-4 have established the foundation: an empty canvas shell (Phase 0), theme architecture with `--td-*` semantic tokens (Phase 1), TugButton and the Component Gallery (Phase 2), the responder chain with four-stage key pipeline (Phase 3), and the three-zone mutation model with appearance-zone DOM hooks (Phase 4). The canvas currently renders a grid background, a disconnect banner, and an optional Component Gallery -- but no cards.

Phase 5 builds the card system. The design documents (`design-system-concepts.md` Concept 6, `tugways-implementation-strategy.md` Phase 5) specify a composition-based Tugcard wrapper, a hooks-based data access pattern, dynamic min-size reporting, and a single-registry card system that replaces the demolished triple-registration pattern. DeckManager must be rebuilt from its current empty shell to a full orchestrator that manages card state, delegates rendering to DeckCanvas, and integrates with the geometric infrastructure in `snap.ts`. This phase implements free drag only -- snap.ts wiring is Phase 5c scope.

#### Strategy {#strategy}

- Build bottom-up: card registry first, then Tugcard component, then CardFrame, then DeckManager rebuild, then DeckCanvas integration.
- Follow the design documents exactly for Tugcard props, `useTugcardData` hook semantics, and CardFrame/Tugcard separation of concerns ([D15], [D16], [D17]).
- Implement a static Hello test card (`feedIds=[]`) that proves the full pipeline without any backend dependency.
- Wire a single Mac Developer menu item ("Show Test Card") via `sendControl('show-card', params: ['component': 'hello'])` to create the test card, requiring a Swift change to AppDelegate.
- Add the `show-card` action handler to `action-dispatch.ts` for creating cards by component ID.
- Defer snap behavior (Phase 5c), card tabs (Phase 5b), feed data streaming (Phase 6), and skeleton/error states beyond basic placeholders.

#### Success Criteria (Measurable) {#success-criteria}

- Selecting Developer > Show Test Card creates a Hello card on the canvas with a title bar, visible content area, and correct theme styling (`bun run build` succeeds with no errors)
- The card can be freely dragged to any position within the canvas bounds (`manual test: drag card, verify position updates`)
- The card can be resized down to its dynamic min-size and no smaller (`manual test: resize card, verify min-size clamping`)
- The card can be closed via the title bar close button and is removed from DeckState (`manual test: close card, verify removal`)
- Layout persistence works: card positions survive page reload (`manual test: create card, reload, verify position restored`)
- Tugcard registers as a responder node in the chain between DeckCanvas and card content (`responder chain unit test`)
- All existing tests continue to pass (`cd tugdeck && bun test`)
- New unit tests pass for card-registry, Tugcard, CardFrame, useTugcardData, and DeckManager (`cd tugdeck && bun test`)

#### Scope {#scope}

1. Card registry module with `Map<string, CardRegistration>` and single-call registration API
2. Tugcard composition component: chrome (header with title, icon, close button), responder chain node, accessory slot, content area, basic loading/error placeholders
3. `useTugcardData` hook: returns feed data from Tugcard context (null for feedless cards)
4. Dynamic min-size reporting: Tugcard computes and exposes min-size to CardFrame via callback
5. CardFrame component: positioning, sizing, drag, resize, z-index, min-size clamping
6. DeckManager rebuild: card registry integration, `addCard`/`removeCard` methods, layout persistence, render pipeline passing DeckState to DeckCanvas
7. DeckCanvas rebuild: renders CardFrame components from DeckState, handles card creation via `show-card` action
8. `show-card` action handler in action-dispatch.ts
9. Swift AppDelegate change: "Show Test Card" menu item in Developer menu
10. Hello test card: static card content proving the pipeline

#### Non-goals (Explicitly out of scope) {#non-goals}

- Snap-to-edge and set formation (Phase 5c: modifier-gated snap)
- Card tabs and TugTabBar (Phase 5b)
- Feed data streaming and `useFeedBuffer`/`useFeedStore` (Phase 6)
- Skeleton shimmer animation and crossfade transitions (Phase 7)
- Alerts, title bar collapse, dock (Phase 8a)
- Any real card content (terminal, git, files, etc. -- Phase 9)

#### Dependencies / Prerequisites {#dependencies}

- Phase 0 (demolition): empty canvas shell, gutted DeckManager -- DONE
- Phase 1 (theme): `--td-*` semantic tokens, TugThemeProvider -- DONE
- Phase 2 (first component): TugButton, Component Gallery, action-dispatch -- DONE
- Phase 3 (responder chain): ResponderChainManager, useResponder, four-stage key pipeline -- DONE
- Phase 4 (mutation model): useCSSVar, useDOMClass, useDOMStyle hooks -- DONE
- `snap.ts`: pure geometric functions (computeSnap, detectSharedEdges, findSets) -- KEPT from pre-demolition
- `serialization.ts`: v5 format serialize/deserialize -- KEPT
- `layout-tree.ts`: CardState, DeckState, TabItem types -- KEPT
- `connection.ts`: TugConnection with `onFrame()` callback API -- KEPT

#### Constraints {#constraints}

- TypeScript strict mode with no `any` types
- All CSS must use `--td-*` semantic tokens, not raw colors
- CardFrame drag/resize must use appearance-zone mutations (refs + RAF), not React state, per the three-zone mutation model ([D12])
- No new npm/bun dependencies required (`lucide-react` is already installed at `^0.575.0` for Tugcard header icons)
- Warnings are errors (`bun run build` must produce zero warnings)

#### Assumptions {#assumptions}

- The Tugcard component will live in `tugdeck/src/components/tugways/tugcard.tsx` and `useTugcardData` will be in `tugdeck/src/components/tugways/hooks/use-tugcard-data.ts`, following the existing `components/tugways/` and `hooks/` directory structure.
- CardFrame will be rebuilt as a new React component in `tugdeck/src/components/chrome/card-frame.tsx`, rendered by DeckCanvas once DeckManager provides a non-empty DeckState.
- The single card registry will be a plain `Map<string, CardRegistration>` in a separate registry module, where each entry holds the componentId, a factory function returning a React element, and default meta.
- The `connection.onFrame()` API (already implemented in `connection.ts`) is what Tugcard uses internally to subscribe to `feedIds` -- no new connection API is needed.
- Tests follow the existing vitest + `@testing-library/react` pattern with `bun:test`.
- Phase 5 implements free drag only -- `snap.ts` wiring is Phase 5c scope.
- The design documents (`design-system-concepts.md` and `tugways-implementation-strategy.md`) are authoritative for all architectural decisions.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

All headings that will be referenced use explicit anchors in kebab-case. Decisions use labeled headings (e.g., `[D01]`) with explicit anchors. Specs use `Spec SNN` labels. Steps reference decisions, specs, and anchors via `**References:**` lines. Steps beyond Step 1 include `**Depends on:**` lines.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Serialization version bump for collapsed field (DEFERRED) {#q01-serialization-version}

**Question:** Should the serialization format version change when the `collapsed` field is added to CardState?

**Why it matters:** If the field is added without a version bump, old serialized layouts will lack the field but deserialization will still work (undefined treated as false). A version bump would reject old layouts.

**Options (if known):**
- Keep v5, treat missing `collapsed` as `false` (backward compatible)
- Bump to v6

**Plan to resolve:** Deferred to Phase 8a (title bar collapse). The `collapsed` field is not needed in Phase 5. When Phase 8a adds it, the plan will decide on version handling.

**Resolution:** DEFERRED (Phase 8a will decide. Phase 5 does not add `collapsed` to CardState.)

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| DeckManager rebuild breaks layout persistence | med | low | Keep v5 format, test serialize/deserialize round-trip | Deserialization test fails |
| CardFrame drag performance with many cards | low | low | Appearance-zone mutations (RAF + refs, no React re-renders) | >10 cards visible, frame drops |
| Responder chain integration complexity | med | med | Test Tugcard as responder node in isolation before DeckCanvas integration | Chain dispatch tests fail |

**Risk R01: DeckManager state complexity** {#r01-deckmanager-complexity}

- **Risk:** Rebuilding DeckManager from an empty shell to a full orchestrator in one phase could introduce state management bugs.
- **Mitigation:**
  - Build incrementally: registry first, then addCard/removeCard, then render pipeline, then persistence.
  - Test each layer independently before integration.
  - Keep DeckManager as a plain TypeScript class (not React state) per existing pattern.
- **Residual risk:** Edge cases in card creation/removal ordering during rapid operations.

**Risk R02: CardFrame drag/resize ref-based mutation** {#r02-cardframe-drag}

- **Risk:** Ref-based drag/resize (appearance-zone) must coordinate with DeckState (structure-zone) on drag-end, creating a two-zone boundary.
- **Mitigation:**
  - During drag: appearance-zone only (refs + RAF, zero re-renders).
  - On drag-end: commit final position to DeckState (structure-zone, single re-render) and schedule save.
  - This matches the pre-demolition pattern that worked well.
- **Residual risk:** Brief visual inconsistency if React re-render lags behind pointer.

---

### Design Decisions {#design-decisions}

> All design decisions below follow the authoritative design documents (`design-system-concepts.md` and `tugways-implementation-strategy.md`). No deviations.

#### [D01] Tugcard is composition, not inheritance (DECIDED) {#d01-tugcard-composition}

**Decision:** Tugcard is a wrapper component. Card authors compose their content into it as children: `<Tugcard meta={meta} feedIds={[]}><HelloContent /></Tugcard>`.

**Rationale:**
- React idiom strongly favors composition over inheritance.
- Card authors only supply content; Tugcard provides all chrome, responder chain integration, feed subscription, and loading/error states.
- Per `design-system-concepts.md` [D15].

**Implications:**
- Every card type is a content component wrapped in Tugcard.
- Tugcard owns the header, accessory slot, and content area layout.
- Card content receives data via `useTugcardData()` hook, not render props.

#### [D02] Hooks for data, not render props (DECIDED) {#d02-hooks-not-render-props}

**Decision:** Card content components access feed data via `useTugcardData<T>()` hook. Tugcard gates child mounting: children only render after feed data arrives, so the hook always returns populated data (never null). For feedless cards (`feedIds=[]`), children mount immediately and `useTugcardData()` returns null.

**Rationale:**
- Follows the Excalidraw precedent: hooks for data access, parent handles gating logic.
- No null-checking boilerplate in card content components that have feeds.
- Per `design-system-concepts.md` [D16].

**Implications:**
- Tugcard provides a React context with the current feed data.
- `useTugcardData` reads from that context.
- Phase 5 feedless cards (Hello) never call `useTugcardData()`.

#### [D03] CardFrame and Tugcard have clean separation (DECIDED) {#d03-cardframe-tugcard-separation}

**Decision:** CardFrame handles position, size, drag, resize, z-index. Tugcard handles chrome, responder chain, feed, loading/error, accessories. Neither knows about the other's domain.

**Rationale:**
- Clean responsibility boundary: CardFrame is geometry, Tugcard is behavior.
- CardFrame reads Tugcard's computed min-size via a callback rather than hardcoding.
- Per `design-system-concepts.md` Concept 6, "Relationship to CardFrame".

**Implications:**
- CardFrame wraps Tugcard as a child.
- CardFrame receives position/size from DeckState and reports changes back to DeckManager.
- Tugcard receives meta and feedIds from the card registry.

#### [D04] Single-call card registration replaces triple-registration (DECIDED) {#d04-single-registry}

**Decision:** Each card type is registered once via a single `registerCard()` call that provides componentId, a React component factory, and default metadata. No separate config, factory, and adapter registrations.

**Rationale:**
- The old triple-registration pattern (`cardConfigs` + `cardFactories` + `addCard`) was redundant and error-prone.
- A single `Map<string, CardRegistration>` is sufficient.
- Per `tugways-implementation-strategy.md` Phase 5 item 5.

**Implications:**
- `card-registry.ts` module exports `registerCard()` and `getRegistration()`.
- DeckManager uses the registry to create cards.
- The Hello test card registration is the first and only entry in Phase 5.

#### [D05] Dynamic min-size reported by Tugcard (DECIDED) {#d05-dynamic-minsize}

**Decision:** Tugcard computes its total minimum size as header height (28px) + accessory slot height + child's declared `minContentSize`. Tugcard reports this to CardFrame via a callback ref. CardFrame clamps resize to this minimum.

**Rationale:**
- Cards must never be resized smaller than their non-scrollable chrome.
- The min-size is dynamic: it changes when accessories appear/disappear.
- Replaces the old hardcoded `MIN_SIZE_PX = 100`.
- Per `design-system-concepts.md` [D17].

**Implications:**
- Tugcard accepts `minContentSize?: { width: number; height: number }` prop (default `{ width: 100, height: 60 }`).
- Tugcard calls `onMinSizeChange({ width, height })` whenever computed min-size changes.
- CardFrame receives the min-size callback and uses it during resize clamping.

#### [D06] CardFrame drag uses appearance-zone mutations (DECIDED) {#d06-cardframe-drag-zone}

**Decision:** During drag and resize, CardFrame mutates position/size via refs and RAF (appearance-zone). On pointer-up, the final position is committed to DeckState (structure-zone) with a single re-render.

**Rationale:**
- Appearance-zone mutations produce zero React re-renders during drag, keeping 60fps.
- Matches the three-zone mutation model from Phase 4 ([D12]).
- The pre-demolition CardFrame used this same pattern successfully.

**Implications:**
- CardFrame holds a ref to its DOM element for direct style mutation.
- DeckManager provides `onCardMoved(id, position, size)` callback for structure-zone commit.
- Layout persistence (scheduleSave) triggers on structure-zone commit only.

#### [D07] Tugcard is a responder node (DECIDED) {#d07-tugcard-responder}

**Decision:** Tugcard registers as a responder node via `useResponder`. It sits between DeckCanvas (parent) and card content (child) in the chain. Tugcard handles standard card actions: `close`, `minimize`, `toggleMenu`, `find`. It delegates everything else to the child content's responder.

**Rationale:**
- Cards need to handle standard chrome actions uniformly.
- The responder chain manages focus: when a Tugcard becomes the "key" card, its children become eligible first responders.
- Per `design-system-concepts.md` Concept 6, "Responder Chain Integration".

**Implications:**
- Tugcard calls `useResponder({ id: cardId, actions: { close, minimize, ... } })`.
- Tugcard wraps children in `<ResponderScope>`.
- DeckCanvas is the parent responder; Tugcard nodes are its children.

#### [D08] DeckManager stays a plain TypeScript class (DECIDED) {#d08-deckmanager-class}

**Decision:** DeckManager remains a plain TypeScript class (not a React component or hook). It owns DeckState, the card registry, and coordinates between action-dispatch and DeckCanvas.

**Rationale:**
- DeckManager manages imperative concerns (layout persistence, connection, window resize) that do not map cleanly to React lifecycle.
- The existing pattern works and is well-tested.
- DeckCanvas receives DeckState as a prop and renders cards; DeckManager calls `render()` when state changes.

**Implications:**
- DeckManager's `render()` method passes DeckState and callbacks to DeckCanvas via React.createElement.
- DeckCanvas is a controlled component driven by DeckManager state.
- Card creation/removal happens in DeckManager; DeckCanvas reflects the result.

#### [D09] Hello test card is static with no feed (DECIDED) {#d09-hello-test-card}

**Decision:** The Hello test card uses `feedIds=[]`, renders a title ("Hello") and a short text message. It proves CardFrame geometry, Tugcard chrome, drag/resize, responder chain integration, and registry without any backend dependency.

**Rationale:**
- Feed infrastructure is Phase 6. Phase 5 needs a card that works without feeds.
- A static card is the simplest possible end-to-end test of the card pipeline.
- Per user answer: "A static 'Hello' card with no feed."

**Implications:**
- Hello card content is a simple React component with static text.
- `useTugcardData()` returns null; the content component does not call it.
- The card validates drag, resize, close, persistence, and responder chain integration.

#### [D10] Show Test Card wired via Developer menu and show-card action (DECIDED) {#d10-show-test-card-menu}

**Decision:** Add "Show Test Card" to the Developer menu in AppDelegate.swift. It calls `sendControl('show-card', params: ['component': 'hello'])`. The frontend `show-card` action handler looks up the component in the card registry and calls `DeckManager.addCard()`.

**Rationale:**
- Mac menu commands are the established mechanism for triggering UI actions before the dock exists (Phase 8a).
- The `show-card` action is general-purpose: future card types reuse the same handler with different component IDs.
- Per user answer: "Add a new 'Show Test Card' item to the Developer menu."

**Implications:**
- Swift change: one new `NSMenuItem` and one new `@objc` action method.
- `action-dispatch.ts`: new `show-card` handler that delegates to DeckManager.
- DeckManager: `addCard(componentId)` creates a CardState and re-renders.

---

### Specification {#specification}

#### Tugcard Props {#tugcard-props}

**Spec S01: TugcardProps interface** {#s01-tugcard-props}

```typescript
interface TugcardMeta {
  title: string;
  icon?: string;           // Lucide icon name or null
  closable?: boolean;      // default: true
}

interface TugcardProps {
  cardId: string;                                      // unique card instance ID
  meta: TugcardMeta;                                   // title, icon, closable
  feedIds: readonly FeedIdValue[];                      // feeds to subscribe to
  decode?: (feedId: FeedIdValue, bytes: Uint8Array) => unknown;  // default: JSON parse
  minContentSize?: { width: number; height: number };  // default: { width: 100, height: 60 }
  accessory?: React.ReactNode | null;                  // top accessory slot
  onMinSizeChange?: (size: { width: number; height: number }) => void;  // callback to CardFrame
  onDragStart?: (event: React.PointerEvent) => void;    // callback to CardFrame: header initiates drag
  onClose?: () => void;                                // called when close action fires
  children: React.ReactNode;                           // card content
}
```

Per `design-system-concepts.md` [D15] and Tugcard Props Summary.

#### Card Registry {#card-registry-spec}

**Spec S02: CardRegistration interface** {#s02-card-registration}

```typescript
import type { CardFrameInjectedProps } from "./components/chrome/card-frame";

interface CardRegistration {
  componentId: string;                        // "hello", "terminal", "git", etc.
  factory: (cardId: string, injected: CardFrameInjectedProps) => React.ReactElement;  // creates Tugcard with injected callbacks
  defaultMeta: TugcardMeta;                   // default title, icon, closable
}
```

The factory receives `CardFrameInjectedProps` so it can forward `onDragStart` and `onMinSizeChange` to the Tugcard it creates. DeckCanvas calls `registration.factory(card.id, injectedProps)` inside the `renderContent` function it passes to CardFrame.

**Spec S03: Registry API** {#s03-registry-api}

```typescript
function registerCard(registration: CardRegistration): void;
function getRegistration(componentId: string): CardRegistration | undefined;
function getAllRegistrations(): Map<string, CardRegistration>;
```

#### CardFrame Props {#cardframe-props}

**Spec S04: CardFrameProps interface** {#s04-cardframe-props}

```typescript
/** Props injected by CardFrame into the content rendered by renderContent. */
interface CardFrameInjectedProps {
  onDragStart: (event: React.PointerEvent) => void;    // header calls this to initiate drag
  onMinSizeChange: (size: { width: number; height: number }) => void;  // Tugcard reports min-size
}

interface CardFrameProps {
  cardState: CardState;                         // position, size, id from DeckState
  renderContent: (injected: CardFrameInjectedProps) => React.ReactNode;  // render function for Tugcard
  onCardMoved: (id: string, position: { x: number; y: number }, size: { width: number; height: number }) => void;
  onCardClosed: (id: string) => void;
  onCardFocused: (id: string) => void;          // pointer-down brings card to front
  zIndex: number;
}
```

**Prop injection via render function:** CardFrame uses a `renderContent` prop (not `children`) to inject `onDragStart` and `onMinSizeChange` callbacks into Tugcard. DeckCanvas calls `renderContent` when constructing the CardFrame, passing the injected props through to Tugcard. This is type-safe, explicit, and avoids `React.cloneElement` fragility.

**Drag initiation:** CardFrame creates an `onDragStart(event: React.PointerEvent)` callback and passes it via `renderContent`. Tugcard's header calls this on pointer-down. CardFrame extracts `event.nativeEvent` to call `setPointerCapture()` on its frame element, then handles the drag mechanic (RAF updates, bounds clamping, structure-zone commit on pointer-up). Both Spec S01 and Spec S04 use `React.PointerEvent` consistently; CardFrame accesses the native event internally when needed for DOM APIs. CardFrame has no knowledge of header height or internal Tugcard structure.

**Min-size communication:** CardFrame manages min-size as internal state (`useState`). It creates an `onMinSizeChange` callback and passes it via `renderContent`. When Tugcard calls `onMinSizeChange`, CardFrame updates its internal min-size state and uses it during resize clamping. Default min-size before Tugcard reports: `{ width: 150, height: 100 }`.

#### DeckManager API Extensions {#deckmanager-api}

**Spec S05: DeckManager new methods** {#s05-deckmanager-methods}

```typescript
class DeckManager {
  // Existing methods retained: render(), refresh(), getDeckState(),
  // sendControlFrame(), handleResize(), applyLayout(), destroy()

  // New Phase 5 methods:
  addCard(componentId: string): string | null;  // create card from registry, add to DeckState; returns cardId or null if not registered
  removeCard(cardId: string): void;             // remove card from DeckState
  moveCard(id: string, position: { x: number; y: number }, size: { width: number; height: number }): void;
  focusCard(cardId: string): void;              // bring card to front (highest z-index)
}
```

#### DeckCanvas Props Extensions {#deckcanvas-props}

**Spec S06: DeckCanvasProps for Phase 5** {#s06-deckcanvas-props}

```typescript
interface DeckCanvasProps {
  connection: TugConnection | null;
  deckState?: DeckState;                        // NEW: cards to render (default: empty cards array)
  onCardMoved?: (id: string, position: { x: number; y: number }, size: { width: number; height: number }) => void;
  onCardClosed?: (id: string) => void;
  onCardFocused?: (id: string) => void;
}
```

All new props are optional with sensible defaults (empty DeckState, no-op callbacks). This preserves backward compatibility with existing test call sites that pass only `connection={null}`.

#### Tugcard Visual Stack {#tugcard-visual-stack}

**Spec S07: Tugcard internal layout** {#s07-tugcard-layout}

```
CardFrame (absolute positioning, drag handles, resize handles)
  └─ Tugcard (flex column)
       ├─ CardHeader (28px, title + icon + close/minimize)
       ├─ Accessory slot (0px when null)
       └─ Content area (flex-grow, overflow auto)
            └─ children (card-specific content)
```

The header is an internal implementation detail of Tugcard. Card authors do not interact with it directly.

#### show-card Action Payload {#show-card-payload}

**Spec S08: show-card control frame** {#s08-show-card-action}

```json
{
  "action": "show-card",
  "component": "hello"
}
```

The `component` field is the `componentId` from the card registry. If the component is not registered, the handler logs a warning and takes no action.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/card-registry.ts` | Card registration map and API (Spec S02, S03) |
| `tugdeck/src/components/tugways/tugcard.tsx` | Tugcard composition component (Spec S01, S07) |
| `tugdeck/src/components/tugways/tugcard.css` | Tugcard chrome styles (header, content area) |
| `tugdeck/src/components/tugways/hooks/use-tugcard-data.ts` | useTugcardData hook and TugcardDataContext |
| `tugdeck/src/components/tugways/cards/hello-card.tsx` | Hello test card content component |
| `tugdeck/src/__tests__/card-registry.test.ts` | Card registry unit tests |
| `tugdeck/src/__tests__/tugcard.test.tsx` | Tugcard component unit tests |
| `tugdeck/src/__tests__/card-frame.test.tsx` | CardFrame component unit tests |
| `tugdeck/src/__tests__/use-tugcard-data.test.tsx` | useTugcardData hook unit tests |
| `tugdeck/src/__tests__/deck-manager.test.ts` | DeckManager unit tests (addCard, removeCard, moveCard, focusCard) |
| `tugdeck/src/__tests__/hello-card.test.tsx` | Hello card integration test |

#### Modified files {#modified-files}

| File | Changes |
|------|---------|
| `tugdeck/src/deck-manager.ts` | Rebuild: add card registry integration, addCard/removeCard/moveCard/focusCard, pass DeckState to DeckCanvas |
| `tugdeck/src/components/chrome/deck-canvas.tsx` | Rebuild: render CardFrame components from DeckState, accept new props |
| `tugdeck/src/components/chrome/card-frame.tsx` | Rebuild: new component with drag/resize/z-index/min-size-clamping |
| `tugdeck/src/action-dispatch.ts` | Add show-card handler |
| `tugdeck/src/main.tsx` | Import and call card registration on startup |
| `tugdeck/src/components/tugways/hooks/index.ts` | Export useTugcardData |
| `tugdeck/src/serialization.ts` | Update buildDefaultLayout to return empty DeckState |
| `tugapp/Sources/AppDelegate.swift` | Add "Show Test Card" menu item to Developer menu |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TugcardMeta` | interface | `tugcard.tsx` | Title, icon, closable |
| `TugcardProps` | interface | `tugcard.tsx` | Spec S01 |
| `Tugcard` | component | `tugcard.tsx` | Composition wrapper |
| `TugcardDataContext` | context | `hooks/use-tugcard-data.ts` | Feed data context |
| `useTugcardData` | hook | `hooks/use-tugcard-data.ts` | Returns feed data or null |
| `CardRegistration` | interface | `card-registry.ts` | Spec S02 |
| `registerCard` | function | `card-registry.ts` | Spec S03 |
| `getRegistration` | function | `card-registry.ts` | Spec S03 |
| `getAllRegistrations` | function | `card-registry.ts` | Spec S03 |
| `CardFrameInjectedProps` | interface | `card-frame.tsx` | Spec S04, injected into Tugcard via renderContent |
| `CardFrameProps` | interface | `card-frame.tsx` | Spec S04, uses renderContent instead of children |
| `CardFrame` | component | `card-frame.tsx` | Drag/resize shell |
| `HelloCardContent` | component | `cards/hello-card.tsx` | Static test card |
| `registerHelloCard` | function | `cards/hello-card.tsx` | Calls registerCard |
| `addCard` | method | `deck-manager.ts` | Spec S05 |
| `removeCard` | method | `deck-manager.ts` | Spec S05 |
| `moveCard` | method | `deck-manager.ts` | Spec S05 |
| `focusCard` | method | `deck-manager.ts` | Spec S05 |

---

### Documentation Plan {#documentation-plan}

- [ ] Update `tugways-implementation-strategy.md` Phase 5 status to DONE after completion
- [ ] Add inline JSDoc to all new public exports (Tugcard, useTugcardData, CardFrame, registry API)

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test card registry, Tugcard rendering, useTugcardData hook, CardFrame props | Core logic, component isolation |
| **Integration** | Test DeckCanvas rendering cards from DeckState, show-card action end-to-end | Components working together |
| **Contract** | Verify TugcardProps, CardRegistration, CardFrameProps interfaces | API surface stability |

**Test numbering convention:** Tests are numbered by component grouping (T01-T05 registry, T06-T08 hook, T09-T15 Tugcard, T16-T20 CardFrame, T21-T22 Hello card, T23-T24 action-dispatch, T25-T27 DeckCanvas, T28-T35 DeckManager). This groups related tests for readability; the numbers do not imply execution order across steps.

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers -- add an anchor instead.

#### Step 1: Card Registry Module {#step-1}

**Commit:** `feat(tugdeck): add card registry module with single-call registration`

**References:** [D04] Single-call card registration, Spec S02, Spec S03, (#card-registry-spec, #d04-single-registry)

**Artifacts:**
- `tugdeck/src/card-registry.ts` -- new module
- `tugdeck/src/__tests__/card-registry.test.ts` -- new test file

**Tasks:**
- [ ] Create `tugdeck/src/card-registry.ts` with `CardRegistration` interface, module-level `Map<string, CardRegistration>`, and exported functions: `registerCard()`, `getRegistration()`, `getAllRegistrations()`
- [ ] `registerCard()` stores the registration keyed by `componentId`. Calling with a duplicate `componentId` logs a warning and overwrites.
- [ ] `getRegistration()` returns `CardRegistration | undefined`.
- [ ] `getAllRegistrations()` returns a read-only view of the map.
- [ ] Add `_resetForTest()` function (clears map) for test isolation.

**Tests:**
- [ ] T01: registerCard stores a registration and getRegistration retrieves it
- [ ] T02: getRegistration returns undefined for unregistered component
- [ ] T03: duplicate registerCard overwrites and logs warning
- [ ] T04: getAllRegistrations returns all registered entries
- [ ] T05: _resetForTest clears the registry

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test card-registry`

---

#### Step 2: TugcardDataContext and useTugcardData Hook {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add useTugcardData hook and TugcardDataContext`

**References:** [D02] Hooks for data, Spec S01, (#d02-hooks-not-render-props, #tugcard-props)

**Artifacts:**
- `tugdeck/src/components/tugways/hooks/use-tugcard-data.ts` -- new module
- `tugdeck/src/components/tugways/hooks/index.ts` -- updated barrel export
- `tugdeck/src/__tests__/use-tugcard-data.test.tsx` -- new test file

**Tasks:**
- [ ] Create `TugcardDataContext` as a React context holding `{ feedData: Map<number, unknown> } | null` (null when outside a Tugcard)
- [ ] Implement `useTugcardData<T>()`: reads `TugcardDataContext`. Returns null when context value is null (feedless card or outside Tugcard). When feed data exists, returns the first feed's decoded value typed as `T` (single-feed convenience). For multi-feed access, a second overload `useTugcardData()` returns the full `Map<number, unknown>`.
- [ ] Export `TugcardDataProvider` component for use by Tugcard internally (not part of public API).
- [ ] Add `useTugcardData` to the barrel export in `hooks/index.ts`.

**Tests:**
- [ ] T06: useTugcardData returns null when rendered outside TugcardDataProvider
- [ ] T07: useTugcardData returns feed data when rendered inside TugcardDataProvider with populated data
- [ ] T08: useTugcardData returns null when feedData map is empty (feedless card)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test use-tugcard-data`

---

#### Step 3: Tugcard Composition Component {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): add Tugcard composition component with chrome and responder integration`

**References:** [D01] Tugcard composition, [D03] CardFrame/Tugcard separation, [D05] Dynamic min-size, [D07] Tugcard responder node, Spec S01, Spec S07, (#d01-tugcard-composition, #d03-cardframe-tugcard-separation, #d05-dynamic-minsize, #d07-tugcard-responder, #tugcard-visual-stack)

**Artifacts:**
- `tugdeck/src/components/tugways/tugcard.tsx` -- new component
- `tugdeck/src/components/tugways/tugcard.css` -- new styles
- `tugdeck/src/__tests__/tugcard.test.tsx` -- new test file

**Tasks:**
- [ ] Create `Tugcard` component implementing TugcardProps (Spec S01)
- [ ] Render internal visual stack (Spec S07): CardHeader (28px) with title, icon (optional Lucide icon), close button; accessory slot (collapses to 0 when null); content area (flex-grow, overflow auto)
- [ ] Register as a responder node via `useResponder({ id: cardId, actions: { close, minimize, toggleMenu, find } })` -- `close` calls `onClose` prop; `minimize`, `toggleMenu`, `find` are stubs in Phase 5
- [ ] Wrap children in `<ResponderScope>` so card content can register as a child responder
- [ ] Wrap children in `<TugcardDataProvider>` with empty feed data map (feed subscription deferred to Phase 6)
- [ ] Compute total min-size: 28 (header) + accessory height + `minContentSize`. Call `onMinSizeChange` when this changes. Use `useEffect` with a layout measurement for accessory height.
- [ ] For feedless cards (`feedIds.length === 0`): mount children immediately
- [ ] For cards with feeds (`feedIds.length > 0`): show a placeholder "Loading..." text in Phase 5 (proper skeleton deferred to Phase 7). Children mount only after first feed data arrives.
- [ ] Create `tugcard.css` with styles using verified `--td-*` tokens: header background `var(--td-header-active)` (focused) / `var(--td-header-inactive)` (unfocused), header text `var(--td-text)`, content area background `var(--td-surface)`, border `var(--td-border)`, border-radius `var(--td-radius-md)`. Accept a `data-focused` attribute on the Tugcard root so CSS can switch between active/inactive header backgrounds.
- [ ] Header calls `onDragStart` prop on pointer-down (if provided). This is the drag initiation point: Tugcard decides *where* drag starts (the header), CardFrame decides *how* drag works (mechanics via the callback). The close button must stop propagation to prevent drag initiation on close clicks.
- [ ] Close button calls `onClose` prop when clicked

**Tests:**
- [ ] T09: Tugcard renders header with title text
- [ ] T10: Tugcard renders children in content area
- [ ] T11: Tugcard close button calls onClose
- [ ] T12: Tugcard with accessory renders accessory between header and content
- [ ] T13: Tugcard without accessory renders no accessory slot height
- [ ] T14: Tugcard calls onMinSizeChange with computed minimum on mount
- [ ] T15: Tugcard registers as responder with expected actions

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test tugcard`

---

#### Step 4: CardFrame Component {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): rebuild CardFrame with drag, resize, and min-size clamping`

**References:** [D03] CardFrame/Tugcard separation, [D05] Dynamic min-size, [D06] Appearance-zone drag, Spec S04, (#d03-cardframe-tugcard-separation, #d06-cardframe-drag-zone, #cardframe-props, #r02-cardframe-drag)

**Artifacts:**
- `tugdeck/src/components/chrome/card-frame.tsx` -- rebuilt component
- `tugdeck/src/__tests__/card-frame.test.tsx` -- new test file

**Tasks:**
- [ ] Rebuild `CardFrame` as a React component accepting CardFrameProps (Spec S04)
- [ ] Render as an absolutely-positioned div with `left`, `top`, `width`, `height` from `cardState.position` and `cardState.size`
- [ ] Apply `zIndex` prop for stacking order
- [ ] Implement drag via `onDragStart` callback injected through `renderContent`: CardFrame creates the `onDragStart` handler and passes it to the content via `CardFrameInjectedProps`. When `onDragStart` fires (called by Tugcard's header on pointer-down), CardFrame extracts `event.nativeEvent` for `setPointerCapture()`, reads canvas bounds from `frameRef.current.parentElement!.getBoundingClientRect()` at drag start, and handles the entire drag mechanic: RAF-driven position updates via ref-based style mutation (appearance-zone), canvas bounds clamping against the captured parent rect, and `onCardMoved` call on pointer-up (structure-zone commit). CardFrame has no knowledge of the header's pixel height or DOM structure -- it only knows that a drag was initiated at a given pointer position.
- [ ] Implement resize via 8 edge/corner handles (reuse CSS classes from `chrome.css`): capture pointer, update size via ref-based style mutation, clamp to min-size, call `onCardMoved` on pointer-up
- [ ] Handle min-size via `onMinSizeChange` callback injected through `renderContent`: CardFrame manages min-size as internal state (`useState`), creates the `onMinSizeChange` handler, and passes it via `CardFrameInjectedProps`. When Tugcard calls it, CardFrame updates its min-size and uses it during resize clamping. Default min-size: `{ width: 150, height: 100 }` until Tugcard reports.
- [ ] On pointer-down anywhere in frame: call `onCardFocused(id)` to bring to front
- [ ] Call `renderContent({ onDragStart, onMinSizeChange })` to render the Tugcard inside the frame div

**Tests:**
- [ ] T16: CardFrame renders at correct position and size from cardState
- [ ] T17: CardFrame applies zIndex prop
- [ ] T18: CardFrame calls onCardFocused on pointer-down
- [ ] T19: CardFrame calls onCardClosed when Tugcard fires close
- [ ] T20: CardFrame clamps resize to min-size

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test card-frame`

---

#### Step 5: DeckManager Rebuild {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugdeck): rebuild DeckManager with card registry, addCard, removeCard, and render pipeline`

**References:** [D04] Single-call registration, [D08] DeckManager class, Spec S05, Spec S06, (#d04-single-registry, #d08-deckmanager-class, #deckmanager-api, #r01-deckmanager-complexity)

**Artifacts:**
- `tugdeck/src/deck-manager.ts` -- rebuilt with new methods
- `tugdeck/src/serialization.ts` -- update buildDefaultLayout to return empty DeckState
- `tugdeck/src/__tests__/layout-tree.test.ts` -- update 4 tests that assert buildDefaultLayout returns 5 panels
- `tugdeck/src/__tests__/deck-manager.test.ts` -- new unit tests for DeckManager methods

**Tasks:**
- [ ] Import `getRegistration` from `card-registry.ts` at the top of `deck-manager.ts`.
- [ ] Add `addCard(componentId: string): string | null` -- call `getRegistration(componentId)` from the card registry; if not found, log warning and return null. Generate a unique card ID via `crypto.randomUUID()`. Create a single `TabItem` with a unique tab ID (also `crypto.randomUUID()`), the `componentId` from the argument, and `title`/`closable` from the registry's `defaultMeta`. Create a new `CardState` with `id`, default position (centered or cascaded), default size (400x300), `tabs: [tabItem]`, and `activeTabId: tabItem.id`. Append to `deckState.cards`. Call `render()` and `scheduleSave()`. Return the generated card ID.
- [ ] Add `removeCard(cardId: string): void` -- filter `deckState.cards` to remove the card. Call `render()` and `scheduleSave()`.
- [ ] Add `moveCard(id, position, size): void` -- find card in `deckState.cards`, update position and size. Call `render()` and `scheduleSave()`.
- [ ] Add `focusCard(cardId: string): void` -- reorder `deckState.cards` to move the focused card to the end of the array (highest z-index by render order). Call `render()`.
- [ ] Update `render()` to pass `deckState` and stable callbacks to DeckCanvas. Bind callbacks once in the constructor so `render()` never creates new function objects. Each state-mutating method (addCard, removeCard, moveCard, focusCard) must assign `this.deckState = { ...this.deckState }` (shallow copy) before calling `render()` so React sees a new reference. The render() call shape:

```typescript
// In constructor:
this.handleCardMoved = this.moveCard.bind(this);
this.handleCardClosed = this.removeCard.bind(this);
this.handleCardFocused = this.focusCard.bind(this);

// In render():
this.reactRoot.render(
  React.createElement(TugThemeProvider, { initialTheme: this.initialTheme },
    React.createElement(ErrorBoundary, null,
      React.createElement(ResponderChainProvider, null,
        React.createElement(DeckCanvas, {
          connection: this.connection,
          deckState: this.deckState,              // new object ref on each mutation
          onCardMoved: this.handleCardMoved,      // stable, bound once
          onCardClosed: this.handleCardClosed,    // stable, bound once
          onCardFocused: this.handleCardFocused,  // stable, bound once
        })
      )
    )
  )
);
```
- [ ] Remove `deckCanvasRef` (React.createRef) from DeckManager -- DeckManager no longer needs an imperative handle since it passes state to DeckCanvas via props. The actual `forwardRef` and `DeckCanvasHandle` removal from DeckCanvas itself happens in Step 6.
- [ ] Implement card position cascading: each new card offsets from the previous by (30, 30) pixels. When the cascaded position would place the card's right or bottom edge beyond the canvas bounds, reset the cascade counter to (0, 0) and start from the top-left corner again. Track the cascade offset as a simple counter on DeckManager (e.g., `private cascadeIndex: number = 0`).
- [ ] Update `buildDefaultLayout()` in `serialization.ts` to return an empty DeckState (`{ cards: [] }`) instead of generating 5 pre-populated cards with hardcoded componentIds ("code", "terminal", "git", "files", "stats") that are not registered in Phase 5. The old default layout is meaningless without those card types; an empty canvas is the correct default until Phase 9 registers real cards.
- [ ] Update 4 tests in `layout-tree.test.ts` that depend on `buildDefaultLayout` returning 5 panels: (1) "buildDefaultLayout(1200, 800) returns 5 panels" -- change to assert `cards.length === 0`; (2) "buildDefaultLayout panels have non-overlapping bounding boxes" -- update to handle empty array (trivially passes); (3) "deserialize with version:3 data falls back to buildDefaultLayout" -- change `cards.length` assertion from 5 to 0; (4) "deserialize with corrupt JSON falls back to buildDefaultLayout" -- change `cards.length` assertion from 5 to 0.
- [ ] Retain all existing functionality: layout persistence, initialLayout, theme reading, scheduleSave, destroy.

**Tests:**
- [ ] T28: buildDefaultLayout returns empty DeckState (updated existing test)
- [ ] T29: deserialize fallback returns empty DeckState (updated existing tests)
- [ ] T30: addCard with registered component creates CardState with correct tabs, activeTabId, and default size; returns card ID
- [ ] T31: addCard with unregistered component logs warning and returns null; DeckState unchanged
- [ ] T32: removeCard removes the card from DeckState.cards
- [ ] T33: moveCard updates position and size of the specified card
- [ ] T34: focusCard moves the specified card to the end of the cards array
- [ ] T35: addCard cascading positions offset each new card by (30, 30)

Note: DeckManager tests create a minimal DeckManager with a mock container (div element) and mock connection. They test the data-layer methods (addCard, removeCard, moveCard, focusCard) by inspecting `getDeckState()` after each call. The `render()` method is stubbed or allowed to no-op since these tests verify state management, not rendering.

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test deck-manager`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test layout-tree`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` (zero warnings, zero errors)

---

#### Step 6: DeckCanvas Rebuild {#step-6}

**Depends on:** #step-5

**Commit:** `feat(tugdeck): rebuild DeckCanvas to render CardFrame components from DeckState`

**References:** [D03] CardFrame/Tugcard separation, [D08] DeckManager class, Spec S06, Spec S07, (#d03-cardframe-tugcard-separation, #deckcanvas-props, #tugcard-visual-stack)

**Artifacts:**
- `tugdeck/src/components/chrome/deck-canvas.tsx` -- rebuilt to render cards
- `tugdeck/src/__tests__/deck-canvas.test.tsx` -- updated test call sites
- `tugdeck/src/__tests__/e2e-responder-chain.test.tsx` -- updated test call sites
- `tugdeck/src/__tests__/component-gallery.test.tsx` -- updated test call sites (if needed)

**Tasks:**
- [ ] Update `DeckCanvasProps` to include optional `deckState`, `onCardMoved`, `onCardClosed`, `onCardFocused` (Spec S06). All new props default to sensible values: `deckState` defaults to `{ cards: [] }`, callbacks default to no-ops. This ensures existing test renders passing only `connection={null}` continue to work without changes.
- [ ] Remove `forwardRef` wrapper and `DeckCanvasHandle` -- the imperative handle is no longer needed since DeckManager passes state via props instead of calling imperative methods. Simplify DeckCanvas to a plain function component.
- [ ] Remove `deckCanvasRef` from DeckManager (Step 5 prerequisite is already committed at this point).
- [ ] Map `deckState.cards` to `CardFrame` components. For each card, look up the registration via `getRegistration(card.tabs[0]?.componentId)`. If the registry lookup returns undefined, skip that card gracefully (log a warning, do not render). Pass a `renderContent` function to CardFrame that receives `CardFrameInjectedProps` and calls `registration.factory(card.id, injectedProps)` to create the Tugcard with the injected callbacks. Example: `renderContent={(injected) => registration.factory(card.id, injected)}`.
- [ ] Assign z-index by array position (first card = lowest z-index)
- [ ] Preserve existing functionality: DisconnectBanner, Component Gallery toggle, responder chain root registration
- [ ] Ensure the gallery panel renders above cards (higher z-index)
- [ ] Verify all existing DeckCanvas tests still pass with the optional prop defaults. Update test imports if `DeckCanvasHandle` type is removed.

**Tests:**
- [ ] T25: DeckCanvas renders cards from deckState prop (test creates mock card registrations via `registerCard()` from `card-registry.ts` with a simple div factory, since the Hello card is not registered until Step 7; uses `_resetForTest()` in afterEach for isolation)
- [ ] T26: DeckCanvas with no deckState prop renders empty (backward compat)
- [ ] T27: DeckCanvas skips cards with unregistered componentIds (pass a deckState with a componentId that has no registration; verify warning logged and no CardFrame rendered)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test deck-canvas`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build`

---

#### Step 7: Hello Test Card and Registration {#step-7}

**Depends on:** #step-6

**Commit:** `feat(tugdeck): add Hello test card and card registration in main.tsx`

**References:** [D01] Tugcard composition, [D04] Single-call registration, [D09] Hello test card, Spec S01, Spec S02, (#d01-tugcard-composition, #d04-single-registry, #d09-hello-test-card)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/hello-card.tsx` -- new file
- `tugdeck/src/main.tsx` -- updated to import and register Hello card
- `tugdeck/src/__tests__/hello-card.test.tsx` -- new test file

**Tasks:**
- [ ] Create `HelloCardContent` component: renders a centered title "Hello" and a short text message "This is a test card." using `--td-*` token-based styling
- [ ] Create `registerHelloCard()` function that calls `registerCard({ componentId: 'hello', factory: (cardId, injected) => <Tugcard cardId={cardId} meta={{ title: 'Hello', closable: true }} feedIds={[]} onDragStart={injected.onDragStart} onMinSizeChange={injected.onMinSizeChange}><HelloCardContent /></Tugcard>, defaultMeta: { title: 'Hello', closable: true } })`
- [ ] Update `main.tsx` to import and call `registerHelloCard()` before DeckManager construction

**Tests:**
- [ ] T21: HelloCardContent renders title and message text
- [ ] T22: registerHelloCard makes "hello" available in the registry

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test hello-card`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build`

---

#### Step 8: show-card Action Handler {#step-8}

**Depends on:** #step-7

**Commit:** `feat(tugdeck): add show-card action handler in action-dispatch`

**References:** [D10] Show Test Card menu wiring, Spec S08, (#d10-show-test-card-menu, #show-card-payload)

**Artifacts:**
- `tugdeck/src/action-dispatch.ts` -- updated with show-card handler

**Tasks:**
- [ ] Register `show-card` action handler in `initActionDispatch()`: extract `component` string from payload, validate it is a string, call `deckManager.addCard(component)`.
- [ ] If `component` is missing or not a string, log a warning and return.
- [ ] The handler does not check the registry -- DeckManager.addCard handles unknown componentIds by logging a warning and returning null.
- [ ] Remove the `void deckManager;` unused-variable suppression line at the end of `initActionDispatch()` -- `deckManager` is now used by the `show-card` handler.
- [ ] Note: The existing AppDelegate already sends `show-card` with `component: "settings"` and `component: "about"`. Once this handler is registered, those menu items will fire but DeckManager.addCard will log a warning and return null since "settings" and "about" are not registered in Phase 5. This is correct behavior -- those cards will be registered in Phase 9 when they are rebuilt.

**Tests:**
- [ ] T23: show-card action calls deckManager.addCard with the component value
- [ ] T24: show-card action with missing component logs warning

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test action-dispatch`

---

#### Step 9: Swift AppDelegate Menu Item {#step-9}

**Depends on:** #step-8

**Commit:** `feat(tugapp): add Show Test Card item to Developer menu`

**References:** [D10] Show Test Card menu wiring, (#d10-show-test-card-menu)

**Artifacts:**
- `tugapp/Sources/AppDelegate.swift` -- updated Developer menu

**Tasks:**
- [ ] Add `NSMenuItem(title: "Show Test Card", action: #selector(showTestCard(_:)), keyEquivalent: "")` to the Developer menu, after the "Show Component Gallery" item
- [ ] Add `@objc private func showTestCard(_ sender: Any) { sendControl("show-card", params: ["component": "hello"]) }` action method

**Tests:**
- [ ] (Swift UI wiring -- verified manually via the integration checkpoint)

**Checkpoint:**
- [ ] Swift project compiles: `cd /Users/kocienda/Mounts/u/src/tugtool/tugapp && xcodebuild -scheme tugapp -configuration Debug build 2>&1 | tail -5` (or Xcode build succeeds)

---

#### Step 10: Integration Checkpoint {#step-10}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5, #step-6, #step-7, #step-8, #step-9

**Commit:** `N/A (verification only)`

**References:** [D01] Tugcard composition, [D03] CardFrame/Tugcard separation, [D04] Single-call registration, [D06] Appearance-zone drag, [D07] Tugcard responder, [D09] Hello test card, [D10] Show Test Card menu, Spec S01-S08, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all unit tests pass
- [ ] Verify build succeeds with zero warnings
- [ ] Manual test: launch app, open Developer menu, click "Show Test Card" -- a Hello card appears on the canvas
- [ ] Manual test: drag the card freely across the canvas
- [ ] Manual test: resize the card; verify min-size clamping prevents shrinking below header + content minimum
- [ ] Manual test: click the close button; card disappears
- [ ] Manual test: create two cards; verify they cascade (offset positions)
- [ ] Manual test: click a background card to bring it to front
- [ ] Manual test: create a card, reload the page; verify the card persists at its position
- [ ] Manual test: open Component Gallery alongside a card; verify both coexist

**Tests:**
- [ ] All unit tests pass (`bun test` covers T01-T35 plus existing tests)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build`

---

### Deliverables and Checkpoints {#deliverables}

> This is the single place we define "done" for the phase. Keep it crisp and testable.

**Deliverable:** A Hello test card can be created from the Developer menu, rendered on the canvas with Tugcard chrome (title bar, close button), dragged, resized with min-size clamping, closed, and persisted across reloads -- proving the Tugcard composition system, card registry, rebuilt CardFrame, and rebuilt DeckManager end-to-end.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` passes all tests (existing + new)
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` succeeds with zero warnings
- [ ] Developer > Show Test Card creates a draggable, resizable Hello card on the canvas
- [ ] Card persists position and size across page reload
- [ ] Card close button removes card from canvas and DeckState
- [ ] Tugcard registers as a responder node (verified by unit test)
- [ ] Multiple cards coexist with correct z-ordering (click to bring to front)

**Acceptance tests:**
- [ ] T01-T05: Card registry unit tests pass
- [ ] T06-T08: useTugcardData hook tests pass
- [ ] T09-T15: Tugcard component tests pass
- [ ] T16-T20: CardFrame component tests pass
- [ ] T21-T22: Hello card tests pass
- [ ] T23-T24: show-card action tests pass
- [ ] T25-T27: DeckCanvas card rendering tests pass
- [ ] T28-T29: Updated buildDefaultLayout and deserialize fallback tests pass
- [ ] T30-T35: DeckManager unit tests pass (addCard, removeCard, moveCard, focusCard, cascading)
- [ ] All pre-existing tests continue to pass (no regressions)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 5b: Card tabs (TugTabBar, multi-tab cards)
- [ ] Phase 5c: Card snapping (Option+drag modifier-gated snap via snap.ts)
- [ ] Phase 6: Feed abstraction (useFeedBuffer, useFeedStore, live data)
- [ ] Phase 7: Motion + startup continuity (skeleton shimmer, enter/exit transitions)
- [ ] Phase 8a: Alerts, title bar collapse, dock
- [ ] Tugcard error boundary (basic placeholder exists; full error state in Phase 7)
- [ ] Tugcard skeleton/loading state (basic placeholder exists; proper shimmer in Phase 7)

| Checkpoint | Verification |
|------------|--------------|
| All unit tests pass | `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` |
| Build succeeds | `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` |
| Hello card end-to-end | Developer > Show Test Card creates card, drag, resize, close, reload persist |
| Responder chain integration | Tugcard appears as responder node in chain tests |
