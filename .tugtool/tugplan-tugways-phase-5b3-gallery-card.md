<!-- tugplan-skeleton v2 -->

## Phase 5b3: Gallery Card Conversion {#phase-5b3-gallery-card}

**Purpose:** Convert the Component Gallery from a floating panel to a proper registered card. Each gallery section becomes its own componentId with family-based filtering, fully integrated with tabs, type picker, layout persistence, and responder chain.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | tugtool |
| Status | draft |
| Target branch | phase-5b3-gallery-card |
| Last updated | 2026-03-04 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Component Gallery is currently a floating absolute-positioned panel toggled by a `galleryVisible` boolean in DeckCanvas state, connected to action-dispatch via `registerGallerySetter`. This design predates the card system (Phase 5) and the tab infrastructure (Phase 5b). Now that the card registry, tab bar, DeckManager store, and responder chain are all operational, the gallery should become a proper card -- making it draggable, resizable, persistable, and tab-aware like every other card in the deck.

The key design change from the previous draft: each gallery section is its own `componentId` (gallery-buttons, gallery-chain-actions, gallery-mutation, gallery-tabbar, gallery-dropdown). A new `family` field on CardRegistration distinguishes "developer" components from "standard" ones, and a new `acceptsFamilies` field controls which families of tabs a card can host. The existing multi-tab rendering path in DeckCanvas already calls `contentFactory` per-tab based on the active tab's `componentId`, so no internal tab-switching component is needed.

#### Strategy {#strategy}

- Add `family`, `acceptsFamilies`, `defaultTabs`, and `title` fields to CardRegistration and CardState respectively.
- Register five separate gallery componentIds, each with its own `contentFactory` and `factory`, all with `family: "developer"`.
- Update TugTabBar to accept an `acceptedFamilies` prop and filter the type picker dropdown accordingly.
- Rework the `show-component-gallery` action to create or focus the gallery card in the deck via DeckCanvas logic.
- Remove the floating panel infrastructure: `galleryVisible` state, `registerGallerySetter` export, `gallerySetterRef` in action-dispatch, the `.cg-panel` CSS, and the gallery overlay render in DeckCanvas.
- Keep content-specific CSS classes (`cg-section`, `cg-matrix`, etc.) for styling within tab content components.
- Update tests in place: replace floating-panel assertions with card-in-deck assertions.

#### Success Criteria (Measurable) {#success-criteria}

- `show-component-gallery` action creates a gallery card in the deck if none exists, or focuses it if already present (verified by test)
- Gallery card appears with five tabs, each a distinct registered componentId (verified by test)
- Tab switching renders the correct content via DeckCanvas's per-tab `contentFactory` lookup (verified by test)
- The `[+]` type picker on the gallery card shows only "developer" family components; the `[+]` picker on standard cards shows only "standard" family components (verified by test)
- Gallery tabs are closable, draggable, and re-addable via `[+]` (verified by test)
- `registerGallerySetter` and `gallerySetterRef` are fully removed from action-dispatch.ts (verified by grep)
- `galleryVisible` state is fully removed from DeckCanvas (verified by grep)
- Card title display: "Component Gallery: TugButton" format in card header when card title is non-empty (verified by test)
- All existing tests pass after update (`bun test`)

#### Scope {#scope}

1. `family` and `acceptsFamilies` fields on `CardRegistration`
2. `title` field on `CardState` for card-level titles
3. `defaultTabs` optional field on `CardRegistration` for multi-tab card types
4. `acceptedFamilies` prop on `TugTabBar` for type picker filtering
5. Five gallery componentId registrations (gallery-buttons, gallery-chain-actions, gallery-mutation, gallery-tabbar, gallery-dropdown)
6. Each gallery componentId gets a real `factory` function (wrapping content in Tugcard, matching hello-card pattern)
7. Reworked `show-component-gallery` action using DeckCanvas `showComponentGallery` responder action
8. Removal of floating panel infrastructure from action-dispatch, DeckCanvas, and CSS
9. Updated test files

#### Non-goals (Explicitly out of scope) {#non-goals}

- Gallery card does not appear in the default layout from `buildDefaultLayout` -- it is only created on demand via the `show-component-gallery` action
- No new DeckManager method for show-or-focus logic -- that logic lives in DeckCanvas's `showComponentGallery` responder action
- Family enforcement is UI-only -- `DeckManager.addTab` does not validate family compatibility
- Single-tab factory path does not support `acceptedFamilies` filtering -- single-tab cards do not show a tab bar, so the type picker is not visible and the limitation is not reachable through UI

#### Dependencies / Prerequisites {#dependencies}

- Phase 5b (card tabs) must be complete -- tab bar, tab state, `contentFactory`, multi-tab rendering path in DeckCanvas
- Phase 5 (card registry, DeckManager, CardFrame) must be complete
- Phase 5b2 (tab drag gestures) must be complete -- gallery tabs get drag support for free
- Phase 3 (responder chain) must be complete

#### Constraints {#constraints}

- Must follow Rules of Tug: no `root.render()` after mount, `useSyncExternalStore` for store reads, `useLayoutEffect` for registrations, CSS/DOM for appearance changes
- All colors use `var(--td-*)` semantic tokens exclusively
- No components defined inside other components (structure-zone rule)

#### Assumptions {#assumptions}

- The five gallery componentIds each get their own `registerCard` call, their own `contentFactory`, and their own `defaultMeta`
- `family` and `acceptsFamilies` are added to `CardRegistration` only -- `TabItem` does not carry family information
- The `show-component-gallery` action's `defaultTabs` array sets each `TabItem`'s `componentId` to the matching gallery componentId
- The existing multi-tab rendering path in DeckCanvas already resolves the active tab's `componentId` and looks up its registration, then calls `registration.contentFactory(cardId)` -- this means each gallery tab's content is rendered by its own registration's `contentFactory` with no switch statement needed
- Existing cards (hello, etc.) get `family: "standard"` either explicitly or as a default, making them invisible in the gallery card's type picker

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All key decisions (family filtering, per-componentId registration, card title, tab closability) were resolved during clarification.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Gallery responder registration changes break existing chain-walk tests | med | low | Adapt tests to new card-based responder context; gallery registers as responder within Tugcard's ResponderScope | Tests fail after Step 5 |
| Removing `gallerySetterRef` breaks Mac menu `show-component-gallery` action | high | low | The action handler is rewritten to use responder chain dispatch, verified by updated action tests | Manual Mac menu testing fails |
| DeckCanvas multi-tab path resolves wrong registration when tabs have different componentIds | high | low | Verify that DeckCanvas's `componentId` resolution uses the active tab's componentId (already does -- line 272-273 in current deck-canvas.tsx) | Tab switching shows wrong content |

**Risk R01: Gallery responder identity change** {#r01-responder-identity}

- **Risk:** The gallery currently registers as responder `"component-gallery"` with a hardcoded string ID. As a card, its responder ID becomes the card instance UUID (registered by Tugcard). Chain-walk tests that reference `"component-gallery"` will break.
- **Mitigation:** The gallery's responder registration via `useResponder` (with `id: "component-gallery"`) is removed. Tugcard handles responder registration using `cardId`. Tests are updated to use the card ID instead.
- **Residual risk:** Any external code that hardcodes `"component-gallery"` as a responder ID will break. A grep confirms only the gallery component and its tests reference it.

**Risk R02: Multi-componentId tab rendering** {#r02-multi-component-tab}

- **Risk:** DeckCanvas's multi-tab rendering path currently resolves one `registration` from the active tab's componentId and uses that single registration's `contentFactory` for the card. If tabs have different componentIds, the content must switch registrations on tab change.
- **Mitigation:** DeckCanvas already resolves `componentId` from the active tab (lines 272-273 of deck-canvas.tsx), then looks up the registration. On each tab switch, React re-renders and resolves the new active tab's registration. The `contentFactory` call uses the correct registration each time. No code change needed in DeckCanvas for this to work.
- **Residual risk:** The `meta` prop passed to the multi-tab Tugcard still comes from the resolved registration's `defaultMeta`. Since header title/icon already follow the active tab's registration ([D05] in Tugcard), this works correctly.

---

### Design Decisions {#design-decisions}

#### [D01] Five separate componentIds for gallery sections (DECIDED) {#d01-separate-component-ids}

**Decision:** Each gallery section is its own componentId: `gallery-buttons`, `gallery-chain-actions`, `gallery-mutation`, `gallery-tabbar`, `gallery-dropdown`. Five separate registry entries, each with its own `contentFactory` and `factory`. No internal tab-switching component.

**Rationale:**
- The existing multi-tab rendering path in DeckCanvas already calls `contentFactory` per-tab based on the active tab's `componentId` -- this architecture supports heterogeneous tabs natively
- Gallery tabs become individually addable via the `[+]` type picker (filtered by family)
- No switch statement or `GalleryTabContent` wrapper is needed -- each registration's `contentFactory` returns its content directly

**Implications:**
- Five `registerCard` calls instead of one
- Each gallery componentId needs its own `defaultMeta` (title, icon, closable)
- The `show-component-gallery` action creates a card with `defaultTabs` that reference all five componentIds

#### [D02] Family field on CardRegistration (DECIDED) {#d02-family-field}

**Decision:** Add a `family` field (single string) to `CardRegistration`. Two families: `"developer"` and `"standard"`. All five gallery componentIds get `family: "developer"`. Existing cards get `family: "standard"`.

**Rationale:**
- Separates developer tools from application cards in the type picker
- Simple string field is extensible -- future families can be added without schema changes
- Family is a registration-level concept, not a per-tab concept

**Implications:**
- `CardRegistration` interface gains `family: string`
- All existing `registerCard` calls must add `family: "standard"` (or default to `"standard"` when omitted)

#### [D03] acceptsFamilies field on CardRegistration (DECIDED) {#d03-accepts-families}

**Decision:** Add an optional `acceptsFamilies` field (array of family strings) to `CardRegistration`. Controls which families of tabs a card can host. The gallery card accepts `["developer"]` only. Standard cards accept `["standard"]` only (or this is the default when omitted). The `[+]` type picker filters available components by the card's `acceptsFamilies`. Enforcement is UI-only -- `DeckManager.addTab` does NOT validate family compatibility.

**Rationale:**
- Prevents developer tools from appearing in the standard card's type picker and vice versa
- UI-only enforcement keeps DeckManager simple and avoids blocking programmatic tab additions
- Default behavior (when `acceptsFamilies` is omitted) is `["standard"]`, so existing cards work without changes

**Implications:**
- `CardRegistration` interface gains `acceptsFamilies?: string[]`
- `CardState` interface gains `acceptsFamilies: readonly string[]`, populated from registration at card creation time
- TugTabBar must receive `acceptedFamilies` as a prop and filter `getAllRegistrations()` accordingly
- DeckCanvas reads `cardState.acceptsFamilies` (not the active tab's registration) and passes it through Tugcard to TugTabBar -- this ensures stability when tabs have different componentIds

#### [D04] Card title field on CardState (DECIDED) {#d04-card-title}

**Decision:** Cards get an optional `title` field on `CardState` (empty string by default). Display format in the card header is `<card-title>: <tab-title>` when card title is non-empty, or just `<tab-title>` when card title is empty. The component gallery card has title `"Component Gallery"`.

**Rationale:**
- Allows cards to have a persistent identity separate from the active tab's title
- The gallery shows "Component Gallery: TugButton" which is clearer than just "TugButton"
- Empty string default means existing cards are unaffected

**Implications:**
- `CardState` interface gains `title: string` (default `""`)
- `DeckManager.addCard` must populate `title` from the registration (new `defaultTitle` field on `CardRegistration`, default `""`)
- Tugcard header rendering must compose `title` with the active tab's title when `title` is non-empty
- Serialization must include the `title` field

#### [D05] Focus logic in DeckCanvas showComponentGallery action (DECIDED) {#d05-focus-logic}

**Decision:** DeckCanvas maintains a `galleryCardIdRef` (a `useRef<string | null>`) that tracks the card ID of the most recently created full gallery card. The `showComponentGallery` responder action checks whether `galleryCardIdRef.current` is non-null and still present in `cardsRef.current`. If found, it focuses that card. If not found (null, or card was closed/removed), it creates a new gallery card via `store.addCard("gallery-buttons")` and stores the returned card ID in `galleryCardIdRef`. After focusing or creating the gallery card, it calls `manager.makeFirstResponder(cardId)` so the gallery takes responder focus immediately (matching the existing gallery behavior where `ComponentGallery` calls `makeFirstResponder` on mount).

Multiple gallery cards can exist simultaneously: if a user detaches gallery tabs into standalone cards, those detached single-tab cards are just normal cards. A subsequent `showComponentGallery` creates a fresh full gallery card (or focuses the tracked one). The ref-based approach avoids the fragile `tabs.length > 1` heuristic -- the ref directly tracks which card is "the gallery."

**Rationale:**
- Direct ID tracking via ref is more reliable than heuristics based on tab count or family membership
- Keeps gallery-specific logic out of DeckManager (which is generic)
- Uses existing `cardsRef` that DeckCanvas already maintains for `cycleCard`
- Detached gallery tabs should not prevent opening a new full gallery card
- `makeFirstResponder` after focus/create matches existing gallery behavior (the old `ComponentGallery` called `makeFirstResponder("component-gallery")` on mount)

**Implications:**
- DeckCanvas gains a `galleryCardIdRef = useRef<string | null>(null)` -- set on `addCard`, cleared implicitly when the card is not found in `cardsRef`. As defense-in-depth, `handleCardClosed` also clears the ref if the closed card matches `galleryCardIdRef.current`.
- The `show-component-gallery` action-dispatch handler must dispatch through the responder chain (like `add-tab`) rather than calling a gallery setter directly
- The Mac menu `show-component-gallery` control frame flows: action-dispatch -> responder chain -> DeckCanvas `showComponentGallery` action
- `addCard("gallery-buttons")` is the entry point because `gallery-buttons` is the first gallery componentId and carries the `defaultTabs` configuration

#### [D06] Remove floating panel infrastructure entirely (DECIDED) {#d06-remove-floating-panel}

**Decision:** Remove `galleryVisible` state from DeckCanvas, `registerGallerySetter` / `gallerySetterRef` from action-dispatch, and the `.cg-panel` absolute-positioned CSS. The gallery overlay render block in DeckCanvas (`galleryVisible && <ComponentGallery ...>`) is deleted.

**Rationale:**
- The floating panel is replaced by a proper card -- keeping both would create two ways to show the gallery
- Removing dead code reduces maintenance burden and confusion

**Implications:**
- `component-gallery-action.test.ts` must be completely rewritten (it tests `registerGallerySetter` toggle behavior)
- `component-gallery.test.tsx` must be updated (it tests the floating panel render context)
- `deck-canvas.test.tsx` must be updated (the `showComponentGallery` test asserts `.cg-panel` toggle behavior)
- `e2e-responder-chain.test.tsx` must be updated (it dispatches `showComponentGallery` and asserts `.cg-panel` presence and `"component-gallery"` as first responder)
- `mutation-model-demo.test.tsx` must update its import of `MutationModelDemo` from the old path
- `action-dispatch.ts` becomes simpler with one fewer module-level ref

#### [D07] showComponentGallery is show-only, not toggle (DECIDED) {#d07-show-only}

**Decision:** The `showComponentGallery` action creates the gallery card if absent, or focuses it if present. It never closes/removes the gallery card. This is a deliberate behavior change from the previous floating panel which toggled visibility.

**Rationale:**
- As a proper card, the gallery has a close button in the card header -- users close it that way
- Show-or-focus is simpler and matches how other `show-card` actions work
- Toggle semantics require tracking whether the card is "topmost" which is fragile with z-order logic

**Implications:**
- The chain-action button in the gallery that was labeled "Toggle Gallery" must be renamed to "Show Gallery"
- The `showComponentGallery` responder action never calls `store.handleCardClosed`

#### [D08] Gallery tabs are normal closable, draggable, addable tabs (DECIDED) {#d08-normal-tabs}

**Decision:** Gallery tabs have `closable: true`, are draggable (via Phase 5b2 infrastructure), and are individually re-addable via the `[+]` type picker (filtered by `acceptsFamilies: ["developer"]`). No special cases.

**Rationale:**
- Gallery tabs should behave like any other tab -- close, drag-reorder, re-add
- Phase 5b2 provides drag support for free
- Family filtering ensures gallery components only appear in the gallery card's picker

**Implications:**
- `defaultTabs` entries all have `closable: true`
- When the last gallery tab is closed, the card is removed (existing DeckManager `_removeTab` behavior)
- Users can re-add closed gallery tabs via the `[+]` picker

#### [D09] Each gallery componentId has a real factory (DECIDED) {#d09-real-factory}

**Decision:** Each gallery componentId gets a real `factory` function that wraps its content in Tugcard, matching the hello-card pattern. This is for the single-tab rendering path.

**Rationale:**
- A gallery tab can end up as a single-tab card via tab detach (Phase 5b2 drag)
- The single-tab path uses `registration.factory(cardId, injected)`, so each componentId needs a working factory
- Consistency with the hello-card registration pattern

**Implications:**
- Five factory functions, each creating a Tugcard with the appropriate content component as children

---

### Specification {#specification}

#### Card Registration Extensions {#card-registration-extensions}

**Spec S01: CardRegistration new fields** {#s01-registration-fields}

```typescript
export interface CardRegistration {
  // ... existing fields ...

  /**
   * Family grouping for this card type. Used by acceptsFamilies
   * to filter the type picker. Defaults to "standard" when omitted.
   */
  family?: string;

  /**
   * Which families of tabs this card can host. Controls the [+] type
   * picker filtering. Defaults to ["standard"] when omitted.
   * Enforcement is UI-only -- addTab does not validate.
   */
  acceptsFamilies?: readonly string[];

  /**
   * Optional pre-populated tabs for multi-tab card types.
   * When present, DeckManager.addCard uses these as templates:
   * componentId, title, and closable are copied; id is replaced
   * with crypto.randomUUID(). The first tab becomes activeTabId.
   */
  defaultTabs?: readonly TabItem[];

  /**
   * Default card-level title. Empty string means no card title prefix.
   * When non-empty, the header displays "<title>: <tab-title>".
   */
  defaultTitle?: string;
}
```

**Spec S02: CardState new fields** {#s02-card-state-fields}

```typescript
export interface CardState {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  tabs: TabItem[];
  activeTabId: string;
  /** Card-level title. Empty string = no prefix. */
  title: string;
  /** Which families of tabs this card can host. Copied from registration at creation time. */
  acceptsFamilies: readonly string[];
}
```

`DeckManager.addCard` populates `title` from `registration.defaultTitle ?? ""` and `acceptsFamilies` from `registration.acceptsFamilies ?? ["standard"]`. Storing `acceptsFamilies` on CardState (rather than reading it from the active tab's registration at render time) ensures the type picker shows the correct families even when tabs have different componentIds with different registrations.

Note: `_mergeTab` does NOT need modification for `title` or `acceptsFamilies`. It splices tabs between existing cards without creating new cards or modifying card-level properties -- both fields remain unchanged on the target card.

**Spec S03: Gallery registrations** {#s03-gallery-registrations}

Five `registerCard` calls, one per gallery section. Example for `gallery-buttons`:

```typescript
registerCard({
  componentId: "gallery-buttons",
  factory: (cardId, injected) => (
    <Tugcard
      cardId={cardId}
      meta={{ title: "TugButton", icon: "LayoutGrid", closable: true }}
      feedIds={[]}
      onDragStart={injected.onDragStart}
      onMinSizeChange={injected.onMinSizeChange}
    >
      <GalleryButtonsContent />
    </Tugcard>
  ),
  contentFactory: () => <GalleryButtonsContent />,
  defaultMeta: { title: "TugButton", icon: "LayoutGrid", closable: true },
  defaultFeedIds: [],
  family: "developer",
  acceptsFamilies: ["developer"],
  // defaultTabs only on gallery-buttons (the entry-point componentId)
  defaultTabs: GALLERY_DEFAULT_TABS,
  defaultTitle: "Component Gallery",
});
```

The other four (gallery-chain-actions, gallery-mutation, gallery-tabbar, gallery-dropdown) follow the same pattern but WITHOUT `defaultTabs` or `defaultTitle` -- those only apply to the entry-point componentId (`gallery-buttons`), which is what `addCard("gallery-buttons")` creates.

**Spec S04: Gallery default tabs (templates)** {#s04-gallery-default-tabs}

```typescript
const GALLERY_DEFAULT_TABS: TabItem[] = [
  { id: "template", componentId: "gallery-buttons", title: "TugButton", closable: true },
  { id: "template", componentId: "gallery-chain-actions", title: "Chain Actions", closable: true },
  { id: "template", componentId: "gallery-mutation", title: "Mutation Model", closable: true },
  { id: "template", componentId: "gallery-tabbar", title: "TugTabBar", closable: true },
  { id: "template", componentId: "gallery-dropdown", title: "TugDropdown", closable: true },
];
```

The `id` values in `defaultTabs` are placeholders -- `DeckManager.addCard` replaces each with `crypto.randomUUID()` at creation time. This ensures no duplicate tab IDs exist across cards (e.g., when a user detaches a gallery tab and then opens a new gallery card, or re-opens gallery after closing it).

Tabs are `closable: true` -- gallery tabs are normal tabs ([D08]). When the last tab is closed, the card is removed.

**Spec S05: TugTabBar acceptedFamilies prop** {#s05-tab-bar-families}

```typescript
export interface TugTabBarProps {
  // ... existing fields ...

  /**
   * Which families of components to show in the [+] type picker.
   * Filters getAllRegistrations() by registration.family.
   * Defaults to ["standard"] when omitted.
   */
  acceptedFamilies?: readonly string[];
}
```

The type picker dropdown in TugTabBar filters:

```typescript
const typePickerItems = Array.from(getAllRegistrations().values())
  .filter((reg) => {
    const regFamily = reg.family ?? "standard";
    const accepted = acceptedFamilies ?? ["standard"];
    return accepted.includes(regFamily);
  })
  .map((reg) => ({
    id: reg.componentId,
    label: reg.defaultMeta.title,
    icon: renderIcon(reg.defaultMeta.icon),
  }));
```

**Spec S06: Tugcard header title composition** {#s06-header-title}

When the card has a non-empty `title` (from CardState), the header displays:

```
<card-title>: <tab-title>
```

When `title` is empty (default), the header displays just:

```
<tab-title>
```

DeckCanvas passes the card's `title` to Tugcard. Tugcard composes the effective title string in its header rendering logic. The `title` comes from CardState (not from the registration at render time), so it persists with the card.

**Spec S07: show-component-gallery action flow** {#s07-show-gallery-action}

The action is show-only, not toggle ([D07]). It creates or focuses the gallery card but never removes it.

The `show-component-gallery` action handler in `initActionDispatch` dispatches through the responder chain:

```typescript
registerAction("show-component-gallery", () => {
  if (responderChainManagerRef) {
    responderChainManagerRef.dispatch("showComponentGallery");
  } else {
    console.warn("show-component-gallery: responder chain manager not registered yet");
  }
});
```

The DeckCanvas `showComponentGallery` responder action uses `galleryCardIdRef` to track the gallery card:

```typescript
// In DeckCanvas, alongside cardsRef:
const galleryCardIdRef = useRef<string | null>(null);

// In useResponder actions:
showComponentGallery: () => {
  const c = cardsRef.current;
  const trackedId = galleryCardIdRef.current;
  const existing = trackedId ? c.find((card) => card.id === trackedId) : null;

  let cardId: string;
  if (existing) {
    store.handleCardFocused(existing.id);
    cardId = existing.id;
  } else {
    const newId = store.addCard("gallery-buttons");
    if (!newId) return; // registration missing -- should not happen
    galleryCardIdRef.current = newId;
    cardId = newId;
  }
  // Make the gallery card first responder (matches existing gallery behavior).
  manager.makeFirstResponder(cardId);
},
```

**Spec S08: DeckCanvas multi-tab path with acceptedFamilies passthrough** {#s08-deckcanvas-families}

DeckCanvas's multi-tab rendering path reads `acceptsFamilies` from `cardState` (not from the active tab's registration) and passes it to Tugcard, which forwards it to TugTabBar. This is correct because `acceptsFamilies` is a card-level property set at creation time (Spec S02) -- it must not change when the user switches between tabs with different componentIds.

```typescript
// In the multi-tab branch of renderContent:
<Tugcard
  cardId={cardState.id}
  meta={registration.defaultMeta}
  feedIds={registration.defaultFeedIds ?? []}
  tabs={cardState.tabs}
  activeTabId={cardState.activeTabId}
  acceptedFamilies={cardState.acceptsFamilies}
  cardTitle={cardState.title}
  onTabSelect={...}
  onTabClose={...}
  onTabAdd={...}
  onClose={...}
  onDragStart={injected.onDragStart}
  onMinSizeChange={injected.onMinSizeChange}
>
  {registration.contentFactory?.(cardState.id) ?? null}
</Tugcard>
```

Tugcard receives `acceptedFamilies` and `cardTitle` as new optional props, forwarding `acceptedFamilies` to TugTabBar and using `cardTitle` in the header title composition (Spec S06).

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/cards/gallery-card.tsx` | Five gallery card registrations, content components, `GALLERY_DEFAULT_TABS` |
| `tugdeck/src/components/tugways/cards/gallery-card.css` | Content-specific styles (migrated from `component-gallery.css`, minus `.cg-panel` and `.cg-titlebar`) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `registerGalleryCards` | fn | `gallery-card.tsx` | Calls `registerCard` five times, one per gallery section |
| `GalleryButtonsContent` | component | `gallery-card.tsx` | TugButton interactive preview + full matrix |
| `GalleryChainActionsContent` | component | `gallery-card.tsx` | Chain-action button demos |
| `GalleryMutationContent` | component | `gallery-card.tsx` | Mutation model demo (wraps existing `MutationModelDemo`) |
| `GalleryTabBarContent` | component | `gallery-card.tsx` | TugTabBar demo (wraps existing `TugTabBarDemo`) |
| `GalleryDropdownContent` | component | `gallery-card.tsx` | TugDropdown demo (wraps existing `TugDropdownDemo`) |
| `GALLERY_DEFAULT_TABS` | const | `gallery-card.tsx` | Array of five `TabItem` entries with distinct componentIds |
| `family` | field | `card-registry.ts` (`CardRegistration`) | Optional string, defaults to `"standard"` |
| `acceptsFamilies` | field | `card-registry.ts` (`CardRegistration`) | Optional `readonly string[]`, defaults to `["standard"]` |
| `defaultTabs` | field | `card-registry.ts` (`CardRegistration`) | Optional `readonly TabItem[]` for multi-tab card types |
| `defaultTitle` | field | `card-registry.ts` (`CardRegistration`) | Optional string, defaults to `""` |
| `title` | field | `layout-tree.ts` (`CardState`) | Card-level title string, default `""` |
| `acceptsFamilies` | field | `layout-tree.ts` (`CardState`) | Which families this card hosts, default `["standard"]` |
| `addCard` | method | `deck-manager-store.ts` (`IDeckManagerStore`) | **ADDED** -- `(componentId: string) => string \| null`, needed by DeckCanvas showComponentGallery |
| `acceptedFamilies` | prop | `tug-tab-bar.tsx` (`TugTabBarProps`) | Optional `readonly string[]` for type picker filtering |
| `acceptedFamilies` | prop | `tugcard.tsx` (`TugcardProps`) | Optional, forwarded to TugTabBar |
| `cardTitle` | prop | `tugcard.tsx` (`TugcardProps`) | Optional string, used in header title composition |
| `galleryCardIdRef` | ref | `deck-canvas.tsx` | `useRef<string \| null>(null)` -- tracks the gallery card ID for show-or-focus logic |
| `registerGallerySetter` | fn | `action-dispatch.ts` | **REMOVED** |
| `gallerySetterRef` | var | `action-dispatch.ts` | **REMOVED** |
| `galleryVisible` | state | `deck-canvas.tsx` | **REMOVED** |
| `ComponentGallery` | component | `component-gallery.tsx` | **REMOVED** (file deleted) |
| `ComponentGalleryProps` | interface | `component-gallery.tsx` | **REMOVED** |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test gallery registrations, family filtering in TugTabBar, card title composition, `defaultTabs` in DeckManager.addCard | Core logic, edge cases |
| **Integration** | Test `show-component-gallery` action creates/focuses gallery card in deck, responder chain walk with gallery card, type picker filtering end-to-end | End-to-end action flows |
| **Drift Prevention** | Verify `registerGallerySetter` is fully removed, no `.cg-panel` CSS references remain | Regression, dead code |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers -- add an anchor instead.

#### Step 1: Extend CardRegistration with family, acceptsFamilies, defaultTabs, and defaultTitle {#step-1}

**Commit:** `feat: add family, acceptsFamilies, defaultTabs, defaultTitle to CardRegistration`

**References:** [D02] Family field on CardRegistration, [D03] acceptsFamilies field, [D04] Card title field, Spec S01, Spec S02, (#s01-registration-fields, #s02-card-state-fields, #card-registration-extensions)

**Artifacts:**
- Modified `tugdeck/src/card-registry.ts`: add `family?`, `acceptsFamilies?`, `defaultTabs?`, `defaultTitle?` to `CardRegistration`
- Modified `tugdeck/src/layout-tree.ts`: add `title: string` and `acceptsFamilies: readonly string[]` to `CardState`
- Modified `tugdeck/src/deck-manager-store.ts`: add `addCard` to `IDeckManagerStore` interface (needed by DeckCanvas's `showComponentGallery` responder action which calls `store.addCard`)
- Modified `tugdeck/src/deck-manager.ts`: update `addCard` to use `registration.defaultTabs` as templates (UUID tab IDs), populate `card.title` and `card.acceptsFamilies` from registration; update `_detachTab` to copy `title` and `acceptsFamilies` from the source card to the new detached card
- Modified `tugdeck/src/serialization.ts`: update `deserialize()` to extract `title` and `acceptsFamilies` fields from the raw card JSON (defaults: `""` and `["standard"]` when missing). Note: `serialize()` needs no change because it passes through the full `CardState` array directly.
- Modified `tugdeck/src/__tests__/deck-manager.test.ts`: add `title` and `acceptsFamilies` fields to all inline CardState objects
- Modified `tugdeck/src/__tests__/deck-canvas.test.tsx`: add `title` and `acceptsFamilies` fields to all inline CardState objects and mock store
- Modified `tugdeck/src/__tests__/e2e-responder-chain.test.tsx`: add `title` and `acceptsFamilies` fields to all inline CardState objects
- Modified `tugdeck/src/__tests__/layout-tree.test.ts`: add `title` and `acceptsFamilies` fields to all inline CardState objects
- Modified `tugdeck/src/__tests__/card-frame.test.tsx`: add `title` and `acceptsFamilies` fields to all inline CardState objects
- Modified `tugdeck/src/__tests__/snap.test.ts`: add `title` and `acceptsFamilies` fields to all inline CardState objects

**Tasks:**
- [ ] Add `family?: string`, `acceptsFamilies?: readonly string[]`, `defaultTabs?: readonly TabItem[]`, `defaultTitle?: string` fields to `CardRegistration` interface in `card-registry.ts`
- [ ] Add `title: string` and `acceptsFamilies: readonly string[]` fields to `CardState` interface in `layout-tree.ts`
- [ ] Add `addCard: (componentId: string) => string | null` to `IDeckManagerStore` interface in `deck-manager-store.ts` -- this is required because DeckCanvas's `showComponentGallery` responder action calls `store.addCard("gallery-buttons")` and `store` is typed as `IDeckManagerStore`
- [ ] Update `DeckManager.addCard()` in `deck-manager.ts`: when `registration.defaultTabs` is defined and non-empty, use those entries as templates -- copy `componentId`, `title`, and `closable` from each template but assign `crypto.randomUUID()` as the `id` (avoids duplicate tab IDs across cards). Set `activeTabId` to the first generated tab's ID. Set `card.title` to `registration.defaultTitle ?? ""`. Set `card.acceptsFamilies` to `registration.acceptsFamilies ?? ["standard"]`.
- [ ] When `defaultTabs` is not present, tab creation is unchanged (single tab from `defaultMeta` with a UUID tab ID), but the CardState object literal must still include the new fields: `title` set to `registration.defaultTitle ?? ""`, `acceptsFamilies` set to `registration.acceptsFamilies ?? ["standard"]`
- [ ] Update `DeckManager._detachTab()` to copy `title: ""` (detached cards lose the card-level title because they are generic containers, not named card instances -- a detached "TugButton" tab is just a TugButton card, not a "Component Gallery" card) and `acceptsFamilies: card.acceptsFamilies` (inherited from source card) into the new CardState object literal. Inheriting `acceptsFamilies` preserves the source card's family context so the detached card's `[+]` type picker shows the correct families (e.g., a detached gallery tab keeps `["developer"]`).
- [ ] Update serialization: `serialize()` needs no change (it passes through the full `CardState` array, so the new fields are included automatically). In `deserialize()`, which cherry-picks individual fields from the raw JSON card object (not spreading), extract `title` and `acceptsFamilies` alongside the existing `id`, `position`, `size`, `tabs`, `activeTabId` fields. Default `title` to `""` when the raw field is missing or not a string. Default `acceptsFamilies` to `["standard"]` when the raw field is missing or `!Array.isArray()` (same defensive pattern as the existing `tabs` validation).
- [ ] Update existing `registerHelloCard` to add `family: "standard"` (or rely on default behavior)
- [ ] Add `title` and `acceptsFamilies` fields to all inline `CardState` objects in test files: `deck-manager.test.ts`, `deck-canvas.test.tsx`, `e2e-responder-chain.test.tsx`, `layout-tree.test.ts`, `card-frame.test.tsx`, `snap.test.ts`. Also add both fields to `buildDefaultLayout` in serialization.ts.
- [ ] Ensure all mock `IDeckManagerStore` objects in test files are complete: add `addCard: vi.fn()` (new) and also add any pre-existing missing methods (`reorderTab`, `detachTab`, `mergeTab`) that were added to `IDeckManagerStore` in Phase 5b2 but never added to some mock stores. Affected files: `deck-canvas.test.tsx`, `e2e-responder-chain.test.tsx`, `tugcard.test.tsx`, and any other files with mock stores. This prevents TypeScript errors and ensures mock completeness going forward.

**Tests:**
- [ ] Add test in `card-registry.test.ts`: register a card with `family`, `acceptsFamilies`, `defaultTabs`, verify `getRegistration` returns them
- [ ] Add test in `deck-manager.test.ts`: `addCard` with `defaultTabs` registration creates a card with all specified tabs (tab IDs are fresh UUIDs, not the template IDs), `activeTabId` set to first tab, `title` set correctly, and `acceptsFamilies` set correctly
- [ ] Add test in `deck-manager.test.ts`: `addCard` without `defaultTabs` still creates a single-tab card with `title: ""`
- [ ] Add test in `deck-manager.test.ts`: `detachTab` on a card with `acceptsFamilies: ["developer"]` creates a new card that inherits `acceptsFamilies: ["developer"]` (not `["standard"]`)

**Checkpoint:**
- [ ] `cd tugdeck && bun test` (full suite -- mock store changes in multiple test files must all compile and pass)

---

#### Step 2: Add acceptedFamilies prop to TugTabBar {#step-2}

**Depends on:** #step-1

**Commit:** `feat: add acceptedFamilies prop to TugTabBar for type picker filtering`

**References:** [D03] acceptsFamilies field, Spec S05, (#s05-tab-bar-families, #d03-accepts-families)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-tab-bar.tsx`: add `acceptedFamilies` prop, filter type picker items by family

**Tasks:**
- [ ] Add `acceptedFamilies?: readonly string[]` to `TugTabBarProps`
- [ ] Update the type picker dropdown builder to filter `getAllRegistrations()` by `registration.family` against `acceptedFamilies` (default `["standard"]` when prop is omitted)
- [ ] Verify that when `acceptedFamilies` is not passed, only `"standard"` family components appear (backward compatible)

**Tests:**
- [ ] Add test in `tug-tab-bar.test.tsx`: with `acceptedFamilies: ["developer"]`, only developer-family registrations appear in the type picker
- [ ] Add test in `tug-tab-bar.test.tsx`: without `acceptedFamilies`, only standard-family registrations appear

**Checkpoint:**
- [ ] `cd tugdeck && bun test tug-tab-bar.test`

---

#### Step 3: Add cardTitle prop to Tugcard for header title composition {#step-3}

**Depends on:** #step-1

**Commit:** `feat: add cardTitle prop to Tugcard for card-level title display`

**References:** [D04] Card title field, Spec S06, (#s06-header-title, #d04-card-title)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tugcard.tsx`: add `cardTitle` and `acceptedFamilies` optional props, compose header title, forward `acceptedFamilies` to TugTabBar

**Tasks:**
- [ ] Add `cardTitle?: string` and `acceptedFamilies?: readonly string[]` to `TugcardProps`
- [ ] Update header title rendering: when `cardTitle` is non-empty, display `"${cardTitle}: ${effectiveMeta.title}"`, else display `effectiveMeta.title`
- [ ] Forward `acceptedFamilies` to TugTabBar in the multi-tab accessory slot

**Tests:**
- [ ] Add test in `tugcard.test.tsx`: with `cardTitle="Component Gallery"`, header shows "Component Gallery: Hello"
- [ ] Add test in `tugcard.test.tsx`: with `cardTitle=""` or omitted, header shows just the tab title

**Checkpoint:**
- [ ] `cd tugdeck && bun test tugcard.test`

---

#### Step 4: Update DeckCanvas to pass cardTitle and acceptedFamilies {#step-4}

**Depends on:** #step-2, #step-3

**Commit:** `feat: DeckCanvas passes cardTitle and acceptedFamilies to Tugcard`

**References:** [D03] acceptsFamilies field, [D04] Card title field, Spec S08, (#s08-deckcanvas-families, #d03-accepts-families, #d04-card-title)

**Artifacts:**
- Modified `tugdeck/src/components/chrome/deck-canvas.tsx`: multi-tab rendering path passes `cardTitle={cardState.title}` and `acceptedFamilies={cardState.acceptsFamilies}` to Tugcard

**Tasks:**
- [ ] In the multi-tab branch of `renderContent`, add `cardTitle={cardState.title}` and `acceptedFamilies={cardState.acceptsFamilies}` props to the Tugcard element (read from CardState, not from the active tab's registration -- see Spec S08)
- [ ] Verify the single-tab path is unaffected (factory handles its own rendering)

**Tests:**
- [ ] Add test in `deck-canvas.test.tsx`: multi-tab card with `title: "Foo"` renders header with "Foo: <tab-title>"

**Checkpoint:**
- [ ] `cd tugdeck && bun test deck-canvas.test`

---

#### Step 5: Create gallery card registrations and content components {#step-5}

**Depends on:** #step-4

**Commit:** `feat: add five gallery card registrations with content components`

**References:** [D01] Five separate componentIds, [D08] Normal tabs, [D09] Real factory each, Spec S03, Spec S04, (#s03-gallery-registrations, #s04-gallery-default-tabs, #symbol-inventory)

**Artifacts:**
- New file `tugdeck/src/components/tugways/cards/gallery-card.tsx`: `registerGalleryCards`, five content components, `GALLERY_DEFAULT_TABS`
- New file `tugdeck/src/components/tugways/cards/gallery-card.css`: content-specific styles migrated from `component-gallery.css` (without `.cg-panel`, `.cg-titlebar`, `.cg-title`)

**Tasks:**
- [ ] Create `gallery-card.tsx` with all symbols listed in the symbol inventory
- [ ] Extract the TugButton interactive preview + full matrix into `GalleryButtonsContent` (including `SubtypeButton` helper and preview controls state)
- [ ] Extract chain-action buttons section into `GalleryChainActionsContent`
- [ ] Wrap `MutationModelDemo` in `GalleryMutationContent`
- [ ] Wrap `TugTabBarDemo` in `GalleryTabBarContent`
- [ ] Wrap `TugDropdownDemo` in `GalleryDropdownContent`
- [ ] Implement `registerGalleryCards` that calls `registerCard` five times -- each with `family: "developer"`, `acceptsFamilies: ["developer"]`, `closable: true`. Only the `gallery-buttons` registration gets `defaultTabs: GALLERY_DEFAULT_TABS` and `defaultTitle: "Component Gallery"`.
- [ ] Each registration includes a real `factory` function wrapping content in Tugcard (matching hello-card pattern) for the single-tab rendering path ([D09])
- [ ] Each registration includes `contentFactory` returning just the content component (for multi-tab rendering path)
- [ ] Create `gallery-card.css` by copying content-specific styles from `component-gallery.css` (all `.cg-` classes except `.cg-panel`, `.cg-titlebar`, `.cg-title`)
- [ ] Import `gallery-card.css` in `gallery-card.tsx`
- [ ] The reusable demo components (`MutationModelDemo`, `TugTabBarDemo`, `TugDropdownDemo`, `SubtypeButton`) should remain exported from their original locations or be moved to `gallery-card.tsx` -- choose the simpler path

**Tests:**
- [ ] Verify `gallery-card.tsx` compiles without type errors (`bun build`)
- [ ] Add unit test: each of the five content components renders without errors

**Checkpoint:**
- [ ] `cd tugdeck && bun test`

---

#### Step 6: Wire gallery card, remove floating panel, and update all tests {#step-6}

**Depends on:** #step-5

**Commit:** `feat: wire gallery card, remove floating panel, update tests`

**References:** [D05] Focus logic in DeckCanvas, [D06] Remove floating panel infrastructure, [D07] Show-only semantics, Spec S07, (#s07-show-gallery-action, #d05-focus-logic, #d06-remove-floating-panel, #d07-show-only, #test-plan-concepts, #success-criteria)

This step is atomic: it performs the wiring, deletion, and test updates in a single commit to avoid broken intermediate test states. The old floating panel code, the new card wiring, and all affected test files are updated together so that the test suite passes at the commit boundary.

**Artifacts:**
- Modified `tugdeck/src/main.tsx`: add `registerGalleryCards()` call alongside `registerHelloCard()`
- Modified `tugdeck/src/action-dispatch.ts`: remove `gallerySetterRef`, `registerGallerySetter` export, update `show-component-gallery` handler to dispatch through responder chain
- Modified `tugdeck/src/components/chrome/deck-canvas.tsx`: update `showComponentGallery` responder action to find-or-create gallery card, remove `galleryVisible` state, remove `registerGallerySetter` import, remove gallery overlay render block, remove `GALLERY_ZINDEX` constant
- Deleted `tugdeck/src/components/tugways/component-gallery.tsx`
- Deleted `tugdeck/src/components/tugways/component-gallery.css`
- Rewritten `tugdeck/src/__tests__/component-gallery-action.test.ts`
- Rewritten `tugdeck/src/__tests__/component-gallery.test.tsx`
- Updated `tugdeck/src/__tests__/deck-canvas.test.tsx`
- Updated `tugdeck/src/__tests__/e2e-responder-chain.test.tsx`
- Updated `tugdeck/src/__tests__/mutation-model-demo.test.tsx`

**Tasks:**
- [ ] In `main.tsx`, import `registerGalleryCards` from `gallery-card.tsx` and call it before `DeckManager` construction
- [ ] In `action-dispatch.ts`:
  - Remove `gallerySetterRef` variable and its type import
  - Remove `registerGallerySetter` function export
  - Remove `gallerySetterRef = null` from `_resetForTest`
  - Change `show-component-gallery` handler to dispatch `"showComponentGallery"` through `responderChainManagerRef` (same pattern as `add-tab`)
- [ ] In `deck-canvas.tsx`:
  - Remove `import { registerGallerySetter } from "@/action-dispatch"`
  - Remove `import { ComponentGallery } from "@/components/tugways/component-gallery"`
  - Remove `const [galleryVisible, setGalleryVisible] = useState<boolean>(false)`
  - Remove `useEffect(() => { registerGallerySetter(setGalleryVisible); }, [])`
  - Remove the gallery overlay JSX block (`galleryVisible && ...`)
  - Remove `GALLERY_ZINDEX` constant
  - Add `const galleryCardIdRef = useRef<string | null>(null)` alongside `cardsRef`
  - Update `showComponentGallery` action: check `galleryCardIdRef.current` against `cardsRef.current` to find the tracked gallery card. If found, call `store.handleCardFocused(id)`. If not found, call `store.addCard("gallery-buttons")` and store the returned ID in `galleryCardIdRef`. After either path, call `manager.makeFirstResponder(cardId)` so the gallery takes responder focus immediately ([D05], [D07] show-only, never close)
  - Wrap the `onClose` callback (currently `() => store.handleCardClosed(cardState.id)`): when the closed card matches `galleryCardIdRef.current`, clear the ref to `null` (defense-in-depth so `showComponentGallery` creates a fresh gallery card next time)
- [ ] Delete `tugdeck/src/components/tugways/component-gallery.tsx`
- [ ] Delete `tugdeck/src/components/tugways/component-gallery.css`
- [ ] Grep for any remaining imports of `component-gallery.tsx` or `component-gallery.css` and update them
- [ ] In the `GalleryChainActionsContent` component (created in Step 5), rename the "Toggle Gallery" button label to "Show Gallery" ([D07])
- [ ] Rewrite `component-gallery-action.test.ts`:
  - Test that `show-component-gallery` action dispatches `"showComponentGallery"` through the responder chain manager
  - Test that when `responderChainManagerRef` is null, the action warns but does not throw
  - Remove all `registerGallerySetter` / `gallerySetterRef` tests
- [ ] Rewrite `component-gallery.test.tsx`:
  - Test that `registerGalleryCards()` registers all five gallery componentIds in the card registry
  - Test that each of the five content components renders without errors
  - Test responder chain walk: gallery card rendered as Tugcard, chain-action buttons dispatch through the responder chain to DeckCanvas
- [ ] Update `deck-canvas.test.tsx`:
  - Rewrite the "showComponentGallery toggles gallery visibility" test: verify that dispatching `showComponentGallery` calls `store.addCard("gallery-buttons")` when no gallery card exists, and that `makeFirstResponder` is called with the new card ID
  - Verify that dispatching `showComponentGallery` a second time (gallery card now exists via ref tracking) calls `store.handleCardFocused` with the existing card's ID and `makeFirstResponder` with the same ID
- [ ] Update `e2e-responder-chain.test.tsx`:
  - Replace `.cg-panel` assertions with card-based assertions
  - Replace `getFirstResponder() === "component-gallery"` assertion with the card's UUID-based responder ID (since Tugcard registers with `cardId`). Verify `makeFirstResponder` is called when `showComponentGallery` fires ([D05]).
  - Alternatively, verify `canHandle("cycleCard")` returns true (which proves the chain walk reaches DeckCanvas)
  - Add show-only idempotency test: dispatch `showComponentGallery` twice when a gallery card exists, verify the card is NOT removed (only focused) -- confirms [D07] show-only semantics
- [ ] Update `mutation-model-demo.test.tsx`:
  - Change import from `import { MutationModelDemo } from "@/components/tugways/component-gallery"` to the new path in `gallery-card.tsx`

**Tests:**
- [ ] All rewritten and updated tests pass

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `grep -r "registerGallerySetter" tugdeck/src/ --include='*.ts' --include='*.tsx'` returns no results
- [ ] `grep -r "galleryVisible" tugdeck/src/ --include='*.ts' --include='*.tsx'` returns no results
- [ ] `grep -r "component-gallery.tsx" tugdeck/src/ --include='*.ts' --include='*.tsx'` returns no results
- [ ] `grep -r "component-gallery.css" tugdeck/src/ --include='*.ts' --include='*.tsx' --include='*.css'` returns no results

---

#### Step 7: Integration Checkpoint {#step-7}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** [D01] Five separate componentIds, [D02] Family field, [D03] acceptsFamilies field, [D04] Card title field, [D05] Focus logic, [D06] Remove floating panel, [D07] Show-only semantics, [D08] Normal tabs, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all artifacts from Steps 1-6 are complete and work together
- [ ] Verify `registerGallerySetter` is fully removed (grep)
- [ ] Verify `galleryVisible` state is fully removed from DeckCanvas (grep)
- [ ] Verify no `.cg-panel` CSS class references remain (grep)
- [ ] Verify gallery card appears with five tabs when `show-component-gallery` fires
- [ ] Verify header shows "Component Gallery: TugButton" format
- [ ] Verify `[+]` type picker on gallery card shows only developer-family components
- [ ] Verify `[+]` type picker on hello card shows only standard-family components
- [ ] Verify gallery tabs are closable and re-addable via `[+]`
- [ ] Verify chain-action buttons in the gallery's Chain Actions tab dispatch through the responder chain

**Tests:**
- [ ] Full test suite passes

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `grep -r "registerGallerySetter" tugdeck/src/ --include='*.ts' --include='*.tsx'` returns no results
- [ ] `grep -r "galleryVisible" tugdeck/src/ --include='*.ts' --include='*.tsx'` returns no results
- [ ] `grep -r "gallerySetterRef" tugdeck/src/ --include='*.ts' --include='*.tsx'` returns no results
- [ ] `grep -r "cg-panel" tugdeck/src/ --include='*.css' --include='*.tsx'` returns no results

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The Component Gallery is a proper registered card with five individually-registered demo tabs, family-based type picker filtering, card-level title display, and full tab lifecycle support (closable, draggable, addable). The floating panel infrastructure is entirely removed.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `show-component-gallery` creates or focuses a gallery card in the deck (verified by test)
- [ ] Gallery card has five tabs with distinct componentIds that switch correctly (verified by test)
- [ ] `[+]` type picker filters by family -- gallery card shows developer components, standard cards show standard components (verified by test)
- [ ] Gallery tabs are closable, draggable, and re-addable (verified by test)
- [ ] Card header shows "Component Gallery: <tab-title>" format (verified by test)
- [ ] `registerGallerySetter`, `gallerySetterRef`, `galleryVisible`, and `.cg-panel` are fully removed (verified by grep)
- [ ] All tests pass (`bun test`)
- [ ] Gallery card persists across sessions in saved layout

**Acceptance tests:**
- [ ] `cd tugdeck && bun test` -- all tests pass with zero failures
- [ ] `grep -rn "registerGallerySetter\|gallerySetterRef\|galleryVisible" tugdeck/src/ --include='*.ts' --include='*.tsx'` returns no results

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Gallery card icon in the type picker dropdown (requires icon improvements in a future phase)
- [ ] Keyboard shortcut to show gallery (e.g., Ctrl+Shift+G)
- [ ] Gallery card in default layout for dev builds only
- [ ] Family enforcement in DeckManager.addTab (currently UI-only)
- [ ] Parameterize the `addTab` responder action in DeckCanvas (currently hardcoded to `"hello"` componentId) -- requires payload support in the responder chain dispatch

| Checkpoint | Verification |
|------------|--------------|
| Card registrations work | `registerGalleryCards()` + `getRegistration("gallery-buttons")` returns valid registration with family "developer" |
| Five tabs created on addCard | `store.addCard("gallery-buttons")` creates card with 5 tabs, each with distinct componentId |
| Show-or-focus logic | Second `show-component-gallery` focuses existing card, does not create duplicate |
| Family filtering | Gallery card's `[+]` picker shows only developer-family components; hello card's `[+]` picker shows only standard-family |
| Card title display | Header reads "Component Gallery: TugButton" on gallery card |
| Floating panel removed | No grep hits for `registerGallerySetter`, `galleryVisible`, `gallerySetterRef`, `cg-panel` |
| Full test suite | `cd tugdeck && bun test` passes |
