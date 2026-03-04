<!-- tugplan-skeleton v2 -->

## Phase 5b3: Gallery Card Conversion {#phase-5b3-gallery-card}

**Purpose:** Convert the Component Gallery from a floating absolute-positioned panel to a proper registered card with five demo tabs, fully integrated with the tab bar, type picker, layout persistence, and responder chain.

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

This conversion also eliminates the `gallerySetterRef` / `registerGallerySetter` coupling between action-dispatch and DeckCanvas, replacing it with the standard `addCard` / `focusCard` path that all other cards use. The gallery becomes five tabs (one per demo section) rendered through `contentFactory`, so each tab mounts independently when active -- consistent with the tab architecture established in Phase 5b.

#### Strategy {#strategy}

- Register `component-gallery` as a single card type with `contentFactory` and five default tabs, one per demo section.
- Extract each demo section (TugButton, Chain-Action Buttons, Mutation Model, TugTabBar, TugDropdown) into its own standalone content component callable from `contentFactory`.
- Rework the `show-component-gallery` action to create or focus the gallery card in the deck via DeckCanvas logic (read `cardsRef` to find existing gallery tab, call `store.handleCardFocused` if found, else `store.addCard`).
- Remove the floating panel infrastructure: `galleryVisible` state, `registerGallerySetter` export, `gallerySetterRef` in action-dispatch, the `.cg-panel` absolute-positioned CSS, and the gallery overlay render in DeckCanvas.
- Keep content-specific CSS classes (`cg-section`, `cg-matrix`, etc.) for styling within tab content components.
- Update tests in place: replace floating-panel assertions with card-in-deck assertions.

#### Success Criteria (Measurable) {#success-criteria}

- `show-component-gallery` action creates a gallery card in the deck if none exists, or focuses it if already present (verified by test)
- Gallery card appears with five tabs, one per demo section, and tab switching renders the correct content (verified by test)
- `registerGallerySetter` and `gallerySetterRef` are fully removed from action-dispatch.ts (verified by grep)
- `galleryVisible` state is fully removed from DeckCanvas (verified by grep)
- Gallery card persists across sessions via serialization (verified by manual inspection -- card appears after reload)
- All existing tests pass after update (`bun test`)
- Gallery card participates in responder chain (verified by existing chain-walk tests adapted to card context)

#### Scope {#scope}

1. Card registration for `component-gallery` with `contentFactory` and `defaultMeta`
2. Five standalone tab content components (one per demo section)
3. Reworked `show-component-gallery` action using DeckCanvas `showComponentGallery` responder action
4. Removal of floating panel infrastructure from action-dispatch, DeckCanvas, and CSS
5. Updated test files: `component-gallery.test.tsx`, `component-gallery-action.test.ts`, `deck-canvas.test.tsx`, `e2e-responder-chain.test.tsx`, `mutation-model-demo.test.tsx`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Gallery card does not appear in the default layout from `buildDefaultLayout` -- it is only created on demand via the `show-component-gallery` action
- No new DeckManager method for show-or-focus logic -- that logic lives in DeckCanvas's `showComponentGallery` responder action
- Gallery sub-tabs are not individually addable via the `[+]` type picker -- `component-gallery` is registered as one `componentId`
- No drag gesture support for gallery tabs (that is Phase 5b2, already complete)

#### Dependencies / Prerequisites {#dependencies}

- Phase 5b (card tabs) must be complete -- tab bar, tab state, `contentFactory`, multi-tab rendering path in DeckCanvas
- Phase 5 (card registry, DeckManager, CardFrame) must be complete
- Phase 3 (responder chain) must be complete

#### Constraints {#constraints}

- Must follow Rules of Tug: no `root.render()` after mount, `useSyncExternalStore` for store reads, `useLayoutEffect` for registrations, CSS/DOM for appearance changes
- All colors use `var(--td-*)` semantic tokens exclusively
- No components defined inside other components (structure-zone rule)

#### Assumptions {#assumptions}

- The `component-gallery` card uses the existing multi-tab rendering path in DeckCanvas (`contentFactory` + `tabs.length > 1` fork) -- not a custom internal tab switcher
- `component-gallery.css` and the `.cg-panel` selector are removed; content-specific CSS classes (`cg-section`, `cg-matrix`, etc.) are kept in a renamed/retained file
- The gallery card is closable (`closable: true` in `defaultMeta`) and persists in the saved layout across sessions
- The `registerGallerySetter` export and `gallerySetterRef` in action-dispatch.ts are fully removed along with all callers

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All key decisions (focus logic, tab strategy, test strategy) were resolved during clarification.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Gallery responder registration changes break existing chain-walk tests | med | low | Adapt tests to new card-based responder context; gallery registers as responder within Tugcard's ResponderScope | Tests fail after Step 3 |
| Removing `gallerySetterRef` breaks Mac menu `show-component-gallery` action | high | low | The action handler is rewritten to use `deckManager.addCard` / responder chain dispatch, verified by updated action tests | Manual Mac menu testing fails |

**Risk R01: Gallery responder identity change** {#r01-responder-identity}

- **Risk:** The gallery currently registers as responder `"component-gallery"` with a hardcoded string ID. As a card, its responder ID becomes the card instance UUID (registered by Tugcard). Chain-walk tests that reference `"component-gallery"` will break.
- **Mitigation:** The gallery's responder registration via `useResponder` (with `id: "component-gallery"`) is removed. Tugcard handles responder registration using `cardId`. Tests are updated to use the card ID instead.
- **Residual risk:** Any external code that hardcodes `"component-gallery"` as a responder ID will break. A grep confirms only the gallery component and its tests reference it.

---

### Design Decisions {#design-decisions}

#### [D01] Single componentId with internal tabs (DECIDED) {#d01-single-component-id}

**Decision:** Register `component-gallery` as one `componentId` in the card registry. The card internally manages five tabs using tab IDs like `"gallery-tab-buttons"`, `"gallery-tab-chain-actions"`, etc. Sub-tabs are not card registry entries and cannot be added via the `[+]` type picker.

**Rationale:**
- The gallery is a development tool, not a family of cards -- one registry entry keeps things simple
- Five internal tabs match the existing five sections of the gallery
- Users should not be able to add individual gallery sections as standalone cards

**Implications:**
- `contentFactory` receives `cardId` and must determine which tab content to render based on the active tab's `componentId` field in the `TabItem`
- Actually, since all five tabs share `componentId: "component-gallery"`, `contentFactory` cannot distinguish tabs by `componentId` alone. Instead, we use the tab's `id` field (a well-known string like `"gallery-tab-buttons"`) to select the correct content component.
- DeckCanvas's multi-tab rendering path calls `registration.contentFactory(cardId)` but does not pass the active tab ID. We need to extend the approach: `contentFactory` will be a function of `(cardId: string)` and the content component will read the active tab from the DeckManager store via `useSyncExternalStore` to determine which section to render.

#### [D02] Focus logic in DeckCanvas showComponentGallery action (DECIDED) {#d02-focus-logic}

**Decision:** The `showComponentGallery` responder action in DeckCanvas reads `cardsRef` to find an existing card with a `component-gallery` tab. If found, it calls `store.handleCardFocused(cardId)`. If not found, it calls `store.addCard("component-gallery")`. No new DeckManager method is needed.

**Rationale:**
- Keeps gallery-specific logic out of DeckManager (which is generic)
- Uses existing `cardsRef` that DeckCanvas already maintains for `cycleCard`
- Consistent with how `addTab` is already handled in DeckCanvas

**Implications:**
- The `show-component-gallery` action-dispatch handler must dispatch through the responder chain (like `add-tab`) rather than calling a gallery setter directly
- The Mac menu `show-component-gallery` Control frame flows: action-dispatch -> responder chain -> DeckCanvas `showComponentGallery` action

#### [D03] Remove floating panel infrastructure entirely (DECIDED) {#d03-remove-floating-panel}

**Decision:** Remove `galleryVisible` state from DeckCanvas, `registerGallerySetter` / `gallerySetterRef` from action-dispatch, and the `.cg-panel` absolute-positioned CSS. The gallery overlay render block in DeckCanvas (`galleryVisible && <ComponentGallery ...>`) is deleted.

**Rationale:**
- The floating panel is replaced by a proper card -- keeping both would create two ways to show the gallery
- Removing dead code reduces maintenance burden and confusion

**Implications:**
- `component-gallery-action.test.ts` must be completely rewritten (it tests `registerGallerySetter` toggle behavior)
- `component-gallery.test.tsx` must be updated (it tests the floating panel render context)
- `deck-canvas.test.tsx` must be updated (the `showComponentGallery` test asserts `.cg-panel` toggle behavior)
- `e2e-responder-chain.test.tsx` must be updated (it dispatches `showComponentGallery` and asserts `.cg-panel` presence and `"component-gallery"` as first responder)
- `mutation-model-demo.test.tsx` must update its import of `MutationModelDemo` from the old path to the new `gallery-card.tsx` path
- `action-dispatch.ts` becomes simpler with one fewer module-level ref

#### [D04] Gallery card has five pre-populated tabs (DECIDED) {#d04-five-tabs}

**Decision:** When `addCard("component-gallery")` is called, DeckManager creates a card with five tabs pre-populated, one per demo section. The `registerCard` call specifies a custom `defaultTabs` configuration (or the card creation logic in the registration function handles it).

**Rationale:**
- The gallery's purpose is to show all five demo sections
- Pre-populating tabs on creation avoids requiring users to manually add each section

**Implications:**
- The standard `addCard` flow creates a single tab from `defaultMeta`. For the gallery, we need all five tabs created at once. This requires either: (a) a custom `addCard` override, (b) calling `addTab` five times after `addCard`, or (c) extending `CardRegistration` with an optional `defaultTabs` array.
- We choose option (c): add an optional `defaultTabs?: TabItem[]` to `CardRegistration`. When present, `DeckManager.addCard` uses these tabs instead of creating a single tab from `defaultMeta`. This is generic and reusable for future multi-tab card types.

#### [D05] ContentFactory uses active tab ID to select section (DECIDED) {#d05-content-factory-tab-id}

**Decision:** The `contentFactory` for `component-gallery` renders a wrapper component (`GalleryTabContent`) that reads the card's active tab ID from the DeckManager store via `useSyncExternalStore` and renders the corresponding demo section component.

**Rationale:**
- `contentFactory` only receives `cardId`, not the active tab ID
- Reading from the store is the Rules-of-Tug-compliant way to access external state (Rule #2: `useSyncExternalStore` only)
- This avoids changing the `contentFactory` signature, which would affect all existing card types

**Implications:**
- `GalleryTabContent` must be a React component (not a plain function) that uses hooks
- Each demo section is a standalone component imported by `GalleryTabContent`

#### [D06] showComponentGallery is show-only, not toggle (DECIDED) {#d06-show-only}

**Decision:** The `showComponentGallery` action creates the gallery card if absent, or focuses it if present. It never closes/removes the gallery card. This is a deliberate behavior change from the previous floating panel which toggled visibility.

**Rationale:**
- As a proper card, the gallery has a close button in the card header -- users close it that way
- Show-or-focus is simpler and matches how other `show-card` actions work (e.g., the existing `show-card` action handler in action-dispatch)
- Toggle semantics require tracking whether the card is "topmost" which is fragile with z-order logic

**Implications:**
- The chain-action button in the gallery that was labeled "Toggle Gallery" must be renamed to "Show Gallery" to avoid confusion
- The `showComponentGallery` responder action never calls `store.handleCardClosed`

---

### Specification {#specification}

#### Card Registration {#card-registration}

**Spec S01: component-gallery CardRegistration** {#s01-gallery-registration}

The `factory` is included for structural completeness but will not be invoked in practice: the gallery always starts with five tabs, so DeckCanvas always takes the multi-tab rendering path (`contentFactory`). The `factory` serves as a fallback only if a future code path creates a single-tab gallery card.

```typescript
registerCard({
  componentId: "component-gallery",
  factory: (cardId, injected) => (
    <Tugcard
      cardId={cardId}
      meta={{ title: "Component Gallery", icon: "LayoutGrid", closable: true }}
      feedIds={[]}
      onDragStart={injected.onDragStart}
      onMinSizeChange={injected.onMinSizeChange}
    >
      <GalleryTabContent cardId={cardId} />
    </Tugcard>
  ),
  contentFactory: (cardId) => <GalleryTabContent cardId={cardId} />,
  defaultMeta: { title: "Component Gallery", icon: "LayoutGrid", closable: true },
  defaultFeedIds: [],
  defaultTabs: GALLERY_DEFAULT_TABS,
});
```

**Spec S02: Gallery default tabs** {#s02-gallery-default-tabs}

```typescript
const GALLERY_DEFAULT_TABS: TabItem[] = [
  { id: "gallery-tab-buttons", componentId: "component-gallery", title: "TugButton", closable: false },
  { id: "gallery-tab-chain-actions", componentId: "component-gallery", title: "Chain Actions", closable: false },
  { id: "gallery-tab-mutation", componentId: "component-gallery", title: "Mutation Model", closable: false },
  { id: "gallery-tab-tabbar", componentId: "component-gallery", title: "TugTabBar", closable: false },
  { id: "gallery-tab-dropdown", componentId: "component-gallery", title: "TugDropdown", closable: false },
];
```

Tabs are `closable: false` because the gallery is a fixed set of demo sections -- closing individual tabs does not make sense. The card itself is closable.

**Spec S03: CardRegistration.defaultTabs extension** {#s03-default-tabs-extension}

Tab IDs from `defaultTabs` are used as-is (not replaced with UUIDs). For card types with `defaultTabs`, the tab IDs are deterministic. This means a second gallery card would have the same tab IDs as the first, but since only one gallery card should exist at a time (enforced by the show-or-focus logic in [D02]), this is not a problem. The deterministic IDs also allow `GalleryTabContent` to use well-known tab IDs in its switch statement ([D05]).

```typescript
export interface CardRegistration {
  // ... existing fields ...

  /**
   * Optional pre-populated tabs for multi-tab card types.
   * When present, DeckManager.addCard uses these tabs as-is (preserving
   * their IDs) instead of creating a single tab from defaultMeta.
   * The first tab becomes the activeTabId.
   *
   * Tab IDs must be unique within the card. For singleton card types
   * (like the gallery, which uses show-or-focus logic), deterministic
   * IDs are safe because only one instance exists at a time.
   *
   * When absent (undefined), addCard creates a single tab as before.
   */
  defaultTabs?: readonly TabItem[];
}
```

**Spec S04: GalleryTabContent component** {#s04-gallery-tab-content}

```typescript
/**
 * GalleryTabContent -- reads the active tab ID from the DeckManager store
 * and renders the corresponding demo section component.
 *
 * This is the contentFactory output for the component-gallery card type.
 * It uses useSyncExternalStore to read the active tab, consistent with
 * Rule of Tug #2.
 */
function GalleryTabContent({ cardId }: { cardId: string }) {
  const store = useDeckManager();
  const deckState = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const card = deckState.cards.find((c) => c.id === cardId);
  const activeTabId = card?.activeTabId;

  switch (activeTabId) {
    case "gallery-tab-buttons":
      return <GalleryButtonsTab />;
    case "gallery-tab-chain-actions":
      return <GalleryChainActionsTab />;
    case "gallery-tab-mutation":
      return <GalleryMutationTab />;
    case "gallery-tab-tabbar":
      return <GalleryTabBarTab />;
    case "gallery-tab-dropdown":
      return <GalleryDropdownTab />;
    default:
      return null;
  }
}
```

**Spec S05: show-component-gallery action flow** {#s05-show-gallery-action}

The action is show-only, not toggle ([D06]). It creates or focuses the gallery card but never removes it.

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

The DeckCanvas `showComponentGallery` responder action:

```typescript
showComponentGallery: () => {
  const c = cardsRef.current;
  const existing = c.find((card) =>
    card.tabs.some((tab) => tab.componentId === "component-gallery")
  );
  if (existing) {
    store.handleCardFocused(existing.id);
  } else {
    store.addCard("component-gallery");
  }
},
```

The chain-action button in the gallery's Chain Actions tab is renamed from "Toggle Gallery" to "Show Gallery" to reflect the show-only semantics ([D06]).

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/cards/gallery-card.tsx` | Card registration, `GalleryTabContent`, and the five tab content components |
| `tugdeck/src/components/tugways/cards/gallery-card.css` | Content-specific styles (migrated from `component-gallery.css`, minus `.cg-panel` and `.cg-titlebar`) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `registerGalleryCard` | fn | `gallery-card.tsx` | Calls `registerCard` with the gallery CardRegistration |
| `GalleryTabContent` | component | `gallery-card.tsx` | Reads active tab from store, renders matching section |
| `GalleryButtonsTab` | component | `gallery-card.tsx` | TugButton interactive preview + full matrix |
| `GalleryChainActionsTab` | component | `gallery-card.tsx` | Chain-action button demos |
| `GalleryMutationTab` | component | `gallery-card.tsx` | Mutation model demo (wraps existing `MutationModelDemo`) |
| `GalleryTabBarTab` | component | `gallery-card.tsx` | TugTabBar demo (wraps existing `TugTabBarDemo`) |
| `GalleryDropdownTab` | component | `gallery-card.tsx` | TugDropdown demo (wraps existing `TugDropdownDemo`) |
| `GALLERY_DEFAULT_TABS` | const | `gallery-card.tsx` | Array of five `TabItem` entries |
| `defaultTabs` | field | `card-registry.ts` (`CardRegistration`) | Optional `readonly TabItem[]` for multi-tab card types |
| `registerGallerySetter` | fn | `action-dispatch.ts` | **REMOVED** |
| `gallerySetterRef` | var | `action-dispatch.ts` | **REMOVED** |
| `galleryVisible` | state | `deck-canvas.tsx` | **REMOVED** |
| `ComponentGallery` | component | `component-gallery.tsx` | **REMOVED** (file deleted or archived) |
| `ComponentGalleryProps` | interface | `component-gallery.tsx` | **REMOVED** |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `registerGalleryCard` registration, `GalleryTabContent` tab switching, individual tab content rendering | Core logic, edge cases |
| **Integration** | Test `show-component-gallery` action creates/focuses gallery card in deck, responder chain walk with gallery card | End-to-end action flows |
| **Drift Prevention** | Verify `registerGallerySetter` is fully removed, no `.cg-panel` CSS references remain | Regression, dead code |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers -- add an anchor instead.

#### Step 1: Extend CardRegistration with defaultTabs {#step-1}

**Commit:** `feat: add optional defaultTabs to CardRegistration`

**References:** [D04] Gallery card has five pre-populated tabs, Spec S03, (#s03-default-tabs-extension, #card-registration)

**Artifacts:**
- Modified `tugdeck/src/card-registry.ts`: add `defaultTabs?: readonly TabItem[]` to `CardRegistration`
- Modified `tugdeck/src/deck-manager.ts`: update `addCard` to use `registration.defaultTabs` when present

**Tasks:**
- [ ] Add `defaultTabs?: readonly TabItem[]` field to `CardRegistration` interface in `card-registry.ts`
- [ ] Update `DeckManager.addCard()` in `deck-manager.ts`: when `registration.defaultTabs` is defined and non-empty, use those tabs (copied as-is) instead of creating a single tab from `defaultMeta`. Set `activeTabId` to the first tab's ID.
- [ ] When `defaultTabs` is not present, behavior is unchanged (single tab created from `defaultMeta` with a UUID tab ID)

**Tests:**
- [ ] Add test in `card-registry.test.ts`: register a card with `defaultTabs`, verify `getRegistration` returns the tabs
- [ ] Add test in `deck-manager.test.ts`: `addCard` with `defaultTabs` registration creates a card with all specified tabs and `activeTabId` set to first tab

**Checkpoint:**
- [ ] `cd tugdeck && bun test card-registry.test deck-manager.test`

---

#### Step 2: Create gallery card registration and tab content components {#step-2}

**Depends on:** #step-1

**Commit:** `feat: add component-gallery card with five tab content components`

**References:** [D01] Single componentId with internal tabs, [D05] ContentFactory uses active tab ID, Spec S01, Spec S02, Spec S04, (#s01-gallery-registration, #s02-gallery-default-tabs, #s04-gallery-tab-content, #symbol-inventory)

**Artifacts:**
- New file `tugdeck/src/components/tugways/cards/gallery-card.tsx`: `registerGalleryCard`, `GalleryTabContent`, `GalleryButtonsTab`, `GalleryChainActionsTab`, `GalleryMutationTab`, `GalleryTabBarTab`, `GalleryDropdownTab`, `GALLERY_DEFAULT_TABS`
- New file `tugdeck/src/components/tugways/cards/gallery-card.css`: content-specific styles migrated from `component-gallery.css` (without `.cg-panel`, `.cg-titlebar`, `.cg-title`)

**Tasks:**
- [ ] Create `gallery-card.tsx` with all symbols listed in the symbol inventory
- [ ] Extract the TugButton interactive preview + full matrix into `GalleryButtonsTab` (including `SubtypeButton` helper and preview controls state)
- [ ] Extract chain-action buttons section into `GalleryChainActionsTab`
- [ ] Wrap `MutationModelDemo` in `GalleryMutationTab`
- [ ] Wrap `TugTabBarDemo` in `GalleryTabBarTab`
- [ ] Wrap `TugDropdownDemo` in `GalleryDropdownTab`
- [ ] Implement `GalleryTabContent` that reads active tab ID from DeckManager store via `useSyncExternalStore` and renders the matching section (Spec S04)
- [ ] Implement `registerGalleryCard` that calls `registerCard` with `contentFactory`, `factory`, `defaultMeta`, `defaultTabs` (Spec S01)
- [ ] Create `gallery-card.css` by copying content-specific styles from `component-gallery.css` (all `.cg-` classes except `.cg-panel`, `.cg-titlebar`, `.cg-title`)
- [ ] Import `gallery-card.css` in `gallery-card.tsx`
- [ ] The reusable demo components (`MutationModelDemo`, `TugTabBarDemo`, `TugDropdownDemo`, `SubtypeButton`) should remain exported from their original locations or be moved to `gallery-card.tsx` -- choose the simpler path (keep in `gallery-card.tsx` since `component-gallery.tsx` will be deleted)

**Tests:**
- [ ] Verify `gallery-card.tsx` compiles without type errors (`bun build`)
- [ ] Add unit test: `GalleryTabContent` renders correct section for each of the five tab IDs (mock DeckManager store with different `activeTabId` values)

**Checkpoint:**
- [ ] `cd tugdeck && bun test`

---

#### Step 3: Wire gallery card, remove floating panel, and update all tests {#step-3}

**Depends on:** #step-2

**Commit:** `feat: wire gallery card, remove floating panel, update tests`

**References:** [D02] Focus logic in DeckCanvas, [D03] Remove floating panel infrastructure, [D06] Show-only semantics, Spec S05, (#s05-show-gallery-action, #d02-focus-logic, #d03-remove-floating-panel, #d06-show-only, #test-plan-concepts, #success-criteria)

This step is atomic: it performs the wiring, deletion, and test updates in a single commit to avoid broken intermediate test states. The old floating panel code, the new card wiring, and all affected test files are updated together so that the test suite passes at the commit boundary.

**Artifacts:**
- Modified `tugdeck/src/main.tsx`: add `registerGalleryCard()` call alongside `registerHelloCard()`
- Modified `tugdeck/src/action-dispatch.ts`: remove `gallerySetterRef`, `registerGallerySetter` export, update `show-component-gallery` handler to dispatch through responder chain
- Modified `tugdeck/src/components/chrome/deck-canvas.tsx`: update `showComponentGallery` responder action to find-or-create gallery card, remove `galleryVisible` state, remove `registerGallerySetter` import, remove gallery overlay render block, remove `GALLERY_ZINDEX` constant
- Deleted `tugdeck/src/components/tugways/component-gallery.tsx`
- Deleted `tugdeck/src/components/tugways/component-gallery.css`
- Rewritten `tugdeck/src/__tests__/component-gallery-action.test.ts`
- Rewritten `tugdeck/src/__tests__/component-gallery.test.tsx`
- Updated `tugdeck/src/__tests__/deck-canvas.test.tsx`: rewrite `showComponentGallery` tests to use card-based assertions instead of `.cg-panel` toggle assertions
- Updated `tugdeck/src/__tests__/e2e-responder-chain.test.tsx`: replace `.cg-panel` assertions and `"component-gallery"` responder ID references with card-based equivalents
- Updated `tugdeck/src/__tests__/mutation-model-demo.test.tsx`: change `MutationModelDemo` import from `@/components/tugways/component-gallery` to `@/components/tugways/cards/gallery-card`

**Tasks:**
- [ ] In `main.tsx`, import `registerGalleryCard` from `gallery-card.tsx` and call it before `DeckManager` construction
- [ ] In `action-dispatch.ts`:
  - Remove `gallerySetterRef` variable and its `React.Dispatch<React.SetStateAction<boolean>>` type import
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
  - Update `showComponentGallery` action: scan `cardsRef.current` for a card with `tabs.some(t => t.componentId === "component-gallery")`, call `store.handleCardFocused` if found, else `store.addCard("component-gallery")` ([D06] show-only, never close)
- [ ] Delete `tugdeck/src/components/tugways/component-gallery.tsx`
- [ ] Delete `tugdeck/src/components/tugways/component-gallery.css`
- [ ] Grep for any remaining imports of `component-gallery.tsx` or `component-gallery.css` and update them
- [ ] In the `GalleryChainActionsTab` component (created in Step 2), rename the "Toggle Gallery" button label to "Show Gallery" ([D06])
- [ ] Rewrite `component-gallery-action.test.ts`:
  - Test that `show-component-gallery` action dispatches `"showComponentGallery"` through the responder chain manager
  - Test that when `responderChainManagerRef` is null, the action warns but does not throw
  - Remove all `registerGallerySetter` / `gallerySetterRef` tests
- [ ] Rewrite `component-gallery.test.tsx`:
  - Test that `registerGalleryCard()` registers `component-gallery` in the card registry
  - Test that `GalleryTabContent` renders the correct section for each tab ID
  - Test that each of the five tab content components renders without errors
  - Test responder chain walk: gallery card rendered as Tugcard, chain-action buttons (e.g., "Cycle Card") dispatch through the responder chain to DeckCanvas
  - Remove all `.cg-panel` assertions, `onClose` prop tests, and floating panel context
- [ ] Update `deck-canvas.test.tsx`:
  - Rewrite the "showComponentGallery toggles gallery visibility" test: instead of asserting `.cg-panel` presence/absence, verify that dispatching `showComponentGallery` calls `store.addCard("component-gallery")` when no gallery card exists. Mock `addCard` on the store and assert it was called with `"component-gallery"`.
  - Keep the "handles showComponentGallery action (dispatch returns true)" test as-is (it only checks dispatch return value)
- [ ] Update `e2e-responder-chain.test.tsx`:
  - Replace `.cg-panel` assertions with card-based assertions (e.g., check that `store.addCard` was called or that a card with `componentId: "component-gallery"` exists in the store)
  - Replace `getFirstResponder() === "component-gallery"` assertion with the card's UUID-based responder ID (since Tugcard registers with `cardId`, the first responder becomes the gallery card's ID, not the string `"component-gallery"`)
  - Alternatively, verify `canHandle("cycleCard")` returns true (which proves the chain walk reaches DeckCanvas regardless of the gallery card's responder ID)
- [ ] Update `mutation-model-demo.test.tsx`:
  - Change import from `import { MutationModelDemo } from "@/components/tugways/component-gallery"` to `import { MutationModelDemo } from "@/components/tugways/cards/gallery-card"`

**Tests:**
- [ ] All rewritten and updated tests pass

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `grep -r "registerGallerySetter" tugdeck/src/ --include='*.ts' --include='*.tsx'` returns no results
- [ ] `grep -r "galleryVisible" tugdeck/src/ --include='*.ts' --include='*.tsx'` returns no results
- [ ] `grep -r "component-gallery.tsx" tugdeck/src/ --include='*.ts' --include='*.tsx'` returns no results (except in `_archive/` if applicable)
- [ ] `grep -r "component-gallery.css" tugdeck/src/ --include='*.ts' --include='*.tsx' --include='*.css'` returns no results

---

#### Step 4: Integration Checkpoint {#step-4}

**Depends on:** #step-1, #step-2, #step-3

**Commit:** `N/A (verification only)`

**References:** [D01] Single componentId with internal tabs, [D02] Focus logic in DeckCanvas, [D03] Remove floating panel infrastructure, [D06] Show-only semantics, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all artifacts from Steps 1-3 are complete and work together
- [ ] Verify `registerGallerySetter` is fully removed (grep)
- [ ] Verify `galleryVisible` state is fully removed from DeckCanvas (grep)
- [ ] Verify no `.cg-panel` CSS class references remain (grep)
- [ ] Verify gallery card appears with five tabs when `show-component-gallery` fires
- [ ] Verify chain-action buttons in the gallery's Chain Actions tab dispatch through the responder chain (e.g., "Cycle Card" dispatches `cycleCard` via DeckCanvas)

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

**Deliverable:** The Component Gallery is a proper registered card with five demo tabs, fully integrated with the card system, tab bar, layout persistence, and responder chain. The floating panel infrastructure is entirely removed.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `show-component-gallery` creates or focuses a gallery card in the deck (verified by test)
- [ ] Gallery card has five tabs that switch correctly (verified by test)
- [ ] `registerGallerySetter`, `gallerySetterRef`, `galleryVisible`, and `.cg-panel` are fully removed (verified by grep)
- [ ] All tests pass (`bun test`)
- [ ] Gallery card persists across sessions in saved layout

**Acceptance tests:**
- [ ] `cd tugdeck && bun test` -- all tests pass with zero failures
- [ ] `grep -rn "registerGallerySetter\|gallerySetterRef\|galleryVisible" tugdeck/src/ --include='*.ts' --include='*.tsx'` returns no results

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Gallery card icon in the type picker dropdown (requires type-picker UI in a future phase)
- [ ] Keyboard shortcut to toggle gallery visibility (e.g., Ctrl+Shift+G)
- [ ] Gallery card in default layout for dev builds only

| Checkpoint | Verification |
|------------|--------------|
| Card registration works | `registerGalleryCard()` + `getRegistration("component-gallery")` returns valid registration |
| Five tabs created on addCard | `store.addCard("component-gallery")` creates card with 5 tabs |
| Show-or-focus logic | Second `show-component-gallery` focuses existing card, does not create duplicate |
| Floating panel removed | No grep hits for `registerGallerySetter`, `galleryVisible`, `gallerySetterRef`, `cg-panel` |
| Full test suite | `cd tugdeck && bun test` passes |
