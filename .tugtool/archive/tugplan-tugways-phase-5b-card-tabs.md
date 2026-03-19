## Tugways Phase 5b: Card Tabs {#phase-5b-card-tabs}

**Purpose:** Cards support multiple tabs with click-based management. Tab bar appears when a card has more than one tab. Switching tabs changes the visible content and the active responder. Tab icons, a type picker dropdown, and selection persistence make tabs a fully functional composition feature.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5b-card-tabs |
| Last updated | 2026-03-03 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The data model for tabs already exists: `TabItem`, `CardState.tabs`, and `CardState.activeTabId` are defined in `layout-tree.ts` and persisted in the v5 serialization format. The `SelectionGuard` singleton already has `saveSelection`/`restoreSelection` methods ready for tab switching. What is missing is the UI layer: the tab bar component, the content switching logic in Tugcard, the type picker dropdown, and the DeckManager methods to add and switch tabs.

Phase 5a established selection containment and Phase 5a2 migrated DeckManager to a subscribable store. Phase 5b builds on both: tab switching saves/restores selection (5a infrastructure), and tab state changes flow through the store (5a2 pattern). The responder chain automatically follows tab switches because inactive tab content unmounts, deregistering its responder, while the new tab's content mounts and registers.

#### Strategy {#strategy}

- Build the TugTabBar component first as a pure presentational component with no DeckManager coupling, then integrate it into Tugcard via the existing accessory slot.
- Build TugDropdown as a reusable wrapper around shadcn's DropdownMenu (same pattern as TugButton wrapping shadcn Button), then use it for the type picker in TugTabBar.
- Tugcard receives tabs and activeTabId as props from DeckCanvas; tab mutations flow through callback props to DeckManager, which updates CardState and notifies subscribers. This follows the established props-driven pattern (Rule 2: read external state with useSyncExternalStore).
- Add `addTab`, `removeTab`, and `setActiveTab` methods to DeckManager and `IDeckManagerStore`. DeckCanvas passes these as callbacks to Tugcard.
- Add a `contentFactory` field to `CardRegistration` that returns just the content component (no Tugcard chrome). For multi-tab cards, DeckCanvas constructs Tugcard directly and uses `contentFactory` for the active tab's content as children. This avoids nested Tugcards from calling the existing `factory` (which returns a complete `<Tugcard>` element).
- Inactive tabs unmount (not hidden with CSS). The responder chain deregistration is automatic via `useResponder` cleanup. No extra responder chain logic needed.
- Register `previousTab` and `nextTab` responder actions on Tugcard. Wire Mac menu `add-tab` command through the responder chain as a DeckCanvas-level action (not direct store call from action-dispatch).
- Add TugTabBar demo section to the Component Gallery as the final step.

#### Success Criteria (Measurable) {#success-criteria}

- Clicking a tab in the tab bar switches the visible content and the title bar updates to reflect the active tab (manual verification in browser).
- Tab bar is invisible when `tabs.length === 1`; visible when `tabs.length > 1` (manual + unit test).
- Clicking [+] opens a type picker listing all registered card types with icons; selecting one adds a new tab (manual verification).
- Closing the last-but-one tab causes the tab bar to disappear (manual verification).
- `previousTab` / `nextTab` responder actions cycle through tabs (manual verification via responder chain dispatch).
- Tab state persists across page reload via existing serialization (manual verification: add tabs, reload, tabs are restored).
- Selection is saved before tab switch and restored after (manual verification: select text, switch tab, switch back, selection restored).

#### Scope {#scope}

1. TugTabBar component (new file: `tug-tab-bar.tsx` + `tug-tab-bar.css`)
2. TugDropdown component (new file: `tug-dropdown.tsx` + `tug-dropdown.css`)
3. `contentFactory` field on `CardRegistration` for content-only rendering
4. Tugcard tab integration: props for tabs/activeTabId, content switching, title bar update, accessory slot wiring
5. DeckCanvas multi-tab rendering path using `contentFactory`
6. DeckManager tab methods: `addTab`, `removeTab`, `setActiveTab`
7. IDeckManagerStore interface additions for new tab methods
8. `previousTab` / `nextTab` responder actions on Tugcard
9. Mac menu `add-tab` command routed through responder chain
10. Selection save/restore on tab switch using existing SelectionGuard infrastructure
11. TugTabBar section in Component Gallery
12. Verification of tab persistence via existing v5 serialization

#### Non-goals (Explicitly out of scope) {#non-goals}

- Drag-to-reorder, drag-to-detach, drag-to-merge tabs (Phase 5b2)
- Keyboard bindings for tab switching (later phase)
- Tab overflow scrolling with scroll arrows (deferred until needed; horizontal overflow: auto is sufficient)
- Per-tab state persistence beyond selection (e.g., scroll position)
- New card types beyond hello-card (only one card type is registered in Phase 5)

#### Dependencies / Prerequisites {#dependencies}

- Phase 5a (Selection Model) complete: SelectionGuard with saveSelection/restoreSelection
- Phase 5a2 (DeckManager Store) complete: subscribable store pattern with useSyncExternalStore
- Phase 5 (Tugcard, CardFrame, card registry) complete: Tugcard composition, accessory slot, CardFrame geometry
- shadcn DropdownMenu component already installed at `tugdeck/src/components/ui/dropdown-menu.tsx`

#### Constraints {#constraints}

- All colors and spacing via `--td-*` semantic tokens exclusively (Rule 4, [D04]).
- Never call `root.render()` after initial mount (Rule 1, [D40, D42]).
- Read external state with `useSyncExternalStore` only (Rule 2, [D40]).
- Use `useLayoutEffect` for registrations that events depend on (Rule 3, [D41]).
- Appearance changes go through CSS and DOM, never React state (Rule 4, [D08, D09]).
- Tugcard composes chrome; CardFrame owns geometry (Rule 7).

#### Assumptions {#assumptions}

- TugTabBar slots into the existing `accessory` prop on Tugcard. The existing ResizeObserver-based accessory height measurement automatically accounts for tab bar height in min-size reporting.
- Inactive tab content is unmounted (not hidden with CSS `display:none`). Responder chain deregistration via `useResponder` cleanup is automatic.
- The hello-card component (the only currently registered card type) is used as the test card for multi-tab scenarios.
- Tab icons use lucide-react icons retrieved via `getRegistration(tab.componentId).defaultMeta.icon`, rendered the same way tugcard.tsx already renders icons (`icons[meta.icon as keyof typeof icons]`).
- The Tugcard header title and icon update to reflect the active tab when multiple tabs are present.
- IDeckManagerStore needs `addTab`, `removeTab`, and `setActiveTab` methods added.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses the conventions defined in the skeleton. All headings that will be referenced have explicit `{#anchor-name}` anchors. Steps cite decisions, specs, and anchors via the `**References:**` line. Dependencies cite step anchors via `**Depends on:**`.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Tab bar height changes causing layout jumps | med | low | ResizeObserver already measures accessory height | If users report visual jank on tab add/remove |
| Selection save/restore fails after content remount | low | med | Best-effort restoration; fail silently if paths don't resolve | If users report lost selections |
| Type picker dropdown z-index conflicts with CardFrame | med | low | Use radix portal (shadcn default) which renders at document root | If dropdown renders behind cards |

**Risk R01: Accessory Height Jank** {#r01-accessory-jank}

- **Risk:** Adding or removing the tab bar changes the accessory slot height, potentially causing a visible layout jump in the content area.
- **Mitigation:** The existing ResizeObserver in Tugcard already measures accessory height dynamically. The tab bar appears/disappears in a single frame. No animation needed for Phase 5b (animations are Phase 8 / Concept 8).
- **Residual risk:** A single-frame layout reflow is unavoidable but imperceptible at 60fps.

**Risk R02: Selection Restore Failure** {#r02-selection-restore}

- **Risk:** After tab switch and remount, the saved selection paths may not resolve if content structure changed (e.g., dynamic content).
- **Mitigation:** `restoreSelection` already fails silently. For hello-card (static content), paths always resolve. Dynamic cards (future phases) accept best-effort restoration.
- **Residual risk:** Dynamic content cards may lose selection on tab switch. Acceptable for Phase 5b.

---

### Design Decisions {#design-decisions}

#### [D01] Tab state is props-driven from DeckManager (DECIDED) {#d01-props-driven-tabs}

**Decision:** Tugcard receives `tabs`, `activeTabId`, `onTabSelect`, `onTabClose`, and `onTabAdd` as props. Tab mutations flow through callbacks to DeckManager, which updates `CardState` and notifies subscribers via the store pattern.

**Rationale:**
- Consistent with the existing DeckManager store pattern established in Phase 5a2 ([D40]).
- Single source of truth for tab state in `CardState`, enabling persistence without additional wiring.
- DeckCanvas already maps `CardState` to component props; adding tab props is a natural extension.

**Implications:**
- DeckManager needs `addTab(cardId, componentId)`, `removeTab(cardId, tabId)`, and `setActiveTab(cardId, tabId)` methods.
- IDeckManagerStore interface must be extended with these methods.
- DeckCanvas must pass tab callbacks to each CardFrame/Tugcard.

#### [D02] TugDropdown wraps shadcn DropdownMenu (DECIDED) {#d02-tug-dropdown}

**Decision:** Build a `TugDropdown` component that wraps shadcn's `DropdownMenu` as a private implementation detail, following the same pattern as TugButton wrapping shadcn's Button.

**Rationale:**
- Maintains the tugways abstraction layer: app code imports `TugDropdown`, never shadcn directly.
- Enables consistent semantic token styling across all dropdowns.
- The type picker is the first consumer; future phases (dock, menus) will reuse TugDropdown.

**Implications:**
- New files: `tug-dropdown.tsx`, `tug-dropdown.css`.
- TugDropdown uses `--td-*` tokens for all visual properties.
- Type picker in TugTabBar composes TugDropdown with card registry data.

#### [D03] Tab bar uses the Tugcard accessory slot (DECIDED) {#d03-tab-bar-accessory}

**Decision:** TugTabBar renders in the Tugcard accessory slot. When `tabs.length > 1`, Tugcard passes `<TugTabBar ... />` as the `accessory` prop. When `tabs.length === 1`, accessory is null and the tab bar is invisible.

**Rationale:**
- The accessory slot was designed for exactly this purpose (Spec S07).
- The existing ResizeObserver-based height measurement works automatically.
- No changes to CardFrame — it remains unaware of tabs (Rule 7, [D31]).

**Implications:**
- Tugcard must conditionally compute the accessory prop based on `tabs.length`.
- Min-size reporting automatically adapts when the tab bar appears/disappears.

#### [D04] Inactive tabs unmount, active tab mounts (DECIDED) {#d04-unmount-inactive}

**Decision:** Only the active tab's content component is mounted. Inactive tabs are not rendered at all (no CSS `display:none` hiding).

**Rationale:**
- Responder chain deregistration is automatic via `useResponder` cleanup on unmount.
- No memory overhead from keeping inactive tab DOM trees alive.
- Consistent with the design document (Concept 12, [D31]).

**Implications:**
- Tab switch causes a full unmount/mount cycle for content.
- Selection must be saved before unmount and restored after mount (using SelectionGuard).
- Content state is lost on unmount (acceptable for Phase 5b; stateful content like terminals may opt into keep-alive in future phases).

#### [D05] Header title and icon follow the active tab (DECIDED) {#d05-header-follows-active}

**Decision:** When a card has multiple tabs, the Tugcard header title and icon update to reflect the active tab's card type registration metadata.

**Rationale:**
- The title bar's identity should match what the user sees in the content area.
- Same icon source for single-tab (title bar) and multi-tab (title bar + tab bar): `getRegistration(tab.componentId).defaultMeta`.

**Implications:**
- Tugcard must look up the active tab's registration to determine header title and icon.
- The `meta` prop passed to Tugcard should be derived from the active tab's registration, not hardcoded.

#### [D08] CardRegistration adds contentFactory for tab content rendering (DECIDED) {#d08-content-factory}

**Decision:** Add a `contentFactory` field to `CardRegistration` that returns just the content component (e.g., `<HelloCardContent/>`), separate from the existing `factory` which returns a complete `<Tugcard>` element. For multi-tab cards, DeckCanvas constructs a single Tugcard directly and uses `contentFactory(cardId)` to render the active tab's content as children. The existing `factory` is retained for backward compatibility with single-tab rendering.

**Rationale:**
- The existing `factory` produces a complete `<Tugcard>` element (see hello-card.tsx). Calling the factory from inside Tugcard to get per-tab content would create nested Tugcards -- architecturally incorrect.
- A separate `contentFactory` cleanly separates the content component from the Tugcard chrome, enabling Tugcard to swap content on tab switch without nesting.
- DeckCanvas is already the layer that knows about CardState, tabs, and the store -- it is the natural place to construct the tab-aware Tugcard.

**Implications:**
- `CardRegistration` interface gains an optional `contentFactory: (cardId: string) => React.ReactNode` field.
- Each card type's registration must provide `contentFactory`. For hello-card: `contentFactory: () => <HelloCardContent />`.
- DeckCanvas rendering logic forks: single-tab cards can use the existing `factory` path; multi-tab cards use `contentFactory` to get the active tab's content and construct Tugcard directly with all tab props.
- The `factory` field remains required for backward compatibility and single-tab rendering. Future phases may deprecate it in favor of `contentFactory` exclusively.

#### [D09] Add-tab routed as DeckCanvas responder action (DECIDED) {#d09-add-tab-responder}

**Decision:** The Mac menu `add-tab` command is routed through the responder chain as a DeckCanvas-level action, not through action-dispatch directly calling the store. DeckCanvas registers an `addTab` responder action that identifies the focused card and calls `store.addTab`.

**Rationale:**
- `initActionDispatch` (action-dispatch.ts) only receives `(connection, deckManager)` and has no access to the ResponderChainManager singleton, which lives inside the React tree.
- Routing through the responder chain is architecturally clean: the `add-tab` control frame triggers a `showComponentGallery`-style responder dispatch, and the DeckCanvas action handler has access to both the store and the responder manager via hooks.
- Follows the same pattern as `cycleCard` and `showComponentGallery` -- Mac menu commands dispatched through the responder chain.

**Implications:**
- action-dispatch registers an `add-tab` handler that calls `manager.dispatch("addTab")` (similar to how show-component-gallery works). This requires a `registerResponderChainManager` function in action-dispatch, called from ResponderChainProvider on mount.
- DeckCanvas registers `addTab` in its responder actions. The handler reads the first responder id (which is a cardId when a card is focused), then calls `store.addTab(focusedCardId, "hello")`. The component parameter comes from the control frame payload and is passed via a module-level variable or closure.
- Alternative simpler approach: action-dispatch registers a handler that dispatches `addTab` through the manager, and the DeckCanvas action handler does the focused-card lookup internally.

#### [D06] Add-tab action uses DeckManager + responder chain (DECIDED) {#d06-add-tab-routing}

**Decision:** `DeckManager.addTab(cardId, componentId)` is the canonical data method for adding tabs. The Mac menu `add-tab` command is routed through the responder chain as a DeckCanvas-level action (see [D09]), not by having action-dispatch call the store directly. This keeps action-dispatch decoupled from the ResponderChainManager.

**Rationale:**
- DeckManager is the single source of truth for card/tab state.
- The responder chain's first responder identifies the focused card without coupling action-dispatch to internal React state.
- action-dispatch has no access to the ResponderChainManager (it lives inside the React tree). Routing through a responder action avoids this architectural gap.

**Implications:**
- action-dispatch registers an `add-tab` handler that dispatches through the responder chain manager (registered via a `registerResponderChainManager` setter, same pattern as `registerGallerySetter`).
- DeckCanvas registers an `addTab` responder action that reads the first responder to identify the focused card and calls `store.addTab`.
- The Mac menu add-tab command always adds the default card type (currently "hello") rather than showing a type picker UI. The responder chain's `dispatch(action)` signature takes only an action string with no payload, so parameterized componentId selection is not possible through this path. The type picker is available in the tab bar [+] button for interactive type selection. Parameterized dispatch is deferred to a future phase.

#### [D07] Selection saved/restored on tab switch (DECIDED) {#d07-selection-persistence}

**Decision:** When switching tabs, Tugcard saves and restores selection state per tab. The `selectionGuard.saveSelection(cardId)` API uses the cardId to locate the boundary element (since only one boundary is registered per card). Tugcard stores the returned `SavedSelection` in a local ref keyed by **tabId** (not cardId), so each tab retains its own selection state across switches.

**Rationale:**
- SelectionGuard already has save/restore methods designed for Phase 5b.
- The SelectionGuard API uses cardId to locate the registered boundary element. Only one tab's content is mounted at a time, so there is exactly one boundary per card at any moment.
- The saved result is stored per-tabId in Tugcard's local ref so that switching back to a previously active tab restores that specific tab's selection.
- Best-effort restoration: if content structure changed, restore silently fails.

**Implications:**
- Tugcard maintains a `useRef<Map<string, SavedSelection>>` keyed by tabId.
- The save/restore sequence on tab switch is strictly ordered: (1) call `selectionGuard.saveSelection(cardId)` and store result keyed by the OLD tabId, (2) update activeTabId (triggering content unmount/mount), (3) in a `useLayoutEffect` after the new tab mounts, call `selectionGuard.restoreSelection(cardId, savedSelections.get(newTabId))` if a saved selection exists for the new tab.
- **Timing prerequisite:** `useSelectionBoundary` must register the boundary element via `useLayoutEffect` (not `useEffect`) so that the boundary is available when Tugcard's restore `useLayoutEffect` fires. React executes `useLayoutEffect` hooks bottom-up (children before parents), so the content component's boundary registration runs before Tugcard's restore hook. The existing `useSelectionBoundary` uses `useEffect`, which runs after `useLayoutEffect` -- this must be changed in Step 4 (see task below).

---

### Specification {#specification}

#### Inputs and Outputs {#inputs-outputs}

**Spec S01: TugTabBarProps** {#s01-tab-bar-props}

```typescript
interface TugTabBarProps {
  tabs: TabItem[];
  activeTabId: string;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabAdd: (componentId: string) => void;
}
```

**Spec S02: Extended TugcardProps** {#s02-extended-tugcard-props}

New props added to `TugcardProps` for tab support:

```typescript
// Added to TugcardProps
tabs?: TabItem[];
activeTabId?: string;
onTabSelect?: (tabId: string) => void;
onTabClose?: (tabId: string) => void;
onTabAdd?: (componentId: string) => void;
```

When `tabs` is provided and has length > 0, Tugcard uses tab-aware rendering. When `tabs` is undefined or empty, Tugcard renders in single-tab mode (existing behavior).

**Spec S05: CardRegistration contentFactory** {#s05-content-factory}

New optional field added to `CardRegistration`:

```typescript
// Added to CardRegistration interface in card-registry.ts
contentFactory?: (cardId: string) => React.ReactNode;
defaultFeedIds?: string[];
```

- `contentFactory` returns just the content component (e.g., `<HelloCardContent />`) without the Tugcard chrome wrapper.
- Required for multi-tab rendering. DeckCanvas uses `contentFactory` to get the active tab's content, then constructs a single Tugcard element directly with all tab props and the content as children.
- The existing `factory` field (which returns a full `<Tugcard>` element) is retained for backward compatibility with single-tab card rendering.
- Each card type registration must provide both `factory` (for single-tab) and `contentFactory` (for multi-tab). Example for hello-card: `contentFactory: () => <HelloCardContent />`.
- `defaultFeedIds` provides the feed IDs for the multi-tab rendering path. Defaults to `[]` when omitted. The multi-tab Tugcard construction reads `registration.defaultFeedIds ?? []`. This is a zero-cost forward hook for Phase 6 feed-aware card types.

**Spec S03: DeckManager Tab Methods** {#s03-deck-manager-tab-methods}

```typescript
// Added to IDeckManagerStore and DeckManager
addTab(cardId: string, componentId: string): string | null;
removeTab(cardId: string, tabId: string): void;
setActiveTab(cardId: string, tabId: string): void;
```

- `addTab`: Creates a new `TabItem` with a random UUID id, appends to the card's `tabs` array, sets it as `activeTabId`, notifies subscribers, schedules save. Returns the new tab id or null if the card or registration is not found.
- `removeTab`: Removes the tab from the card's `tabs` array. If the removed tab was active, activates the previous tab (or first tab if the removed tab was first). If only one tab remains, the card stays with that tab. If the last tab is removed, the card is removed entirely.
- `setActiveTab`: Sets `activeTabId` on the card. No-op if the tab id is not in the card's `tabs` array.

**Spec S04: TugDropdownProps** {#s04-tug-dropdown-props}

```typescript
interface TugDropdownItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface TugDropdownProps {
  trigger: React.ReactNode;
  items: TugDropdownItem[];
  onSelect: (id: string) => void;
}
```

#### Terminology and Naming {#terminology}

| Term | Definition |
|------|-----------|
| Tab bar | The horizontal strip of tab buttons rendered in the Tugcard accessory slot when `tabs.length > 1` |
| Active tab | The tab whose content is currently mounted and visible; identified by `CardState.activeTabId` |
| Type picker | A dropdown menu triggered by the [+] button in the tab bar, listing all registered card types |
| Tab switch | Changing the active tab: unmount old content, mount new content, update header |

#### Tab Visual States {#tab-visual-states}

**Table T01: Tab Visual States** {#t01-tab-visual-states}

| State | Background | Text Color | Border | Close Button |
|-------|-----------|------------|--------|-------------|
| Active | `var(--td-surface)` | `var(--td-text)` | 2px bottom `var(--td-accent)` | Visible |
| Inactive | transparent | `var(--td-text-muted)` | none | Hidden (visible on hover) |
| Inactive:hover | `var(--td-surface-control)` | `var(--td-text)` | none | Visible |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/tug-tab-bar.tsx` | TugTabBar component |
| `tugdeck/src/components/tugways/tug-tab-bar.css` | TugTabBar styles using `--td-*` tokens |
| `tugdeck/src/components/tugways/tug-dropdown.tsx` | TugDropdown wrapper around shadcn DropdownMenu |
| `tugdeck/src/components/tugways/tug-dropdown.css` | TugDropdown styles using `--td-*` tokens |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TugTabBar` | component | `tug-tab-bar.tsx` | Presentational tab strip component |
| `TugTabBarProps` | interface | `tug-tab-bar.tsx` | Props: tabs, activeTabId, onTabSelect, onTabClose, onTabAdd |
| `TugDropdown` | component | `tug-dropdown.tsx` | Reusable dropdown wrapping shadcn DropdownMenu |
| `TugDropdownProps` | interface | `tug-dropdown.tsx` | Props: trigger, items, onSelect |
| `TugDropdownItem` | interface | `tug-dropdown.tsx` | Item shape: id, label, icon?, disabled? |
| `addTab` | method | `deck-manager.ts` | Add a tab to a card by cardId and componentId |
| `removeTab` | method | `deck-manager.ts` | Remove a tab from a card |
| `setActiveTab` | method | `deck-manager.ts` | Set the active tab on a card |
| `addTab` | method signature | `deck-manager-store.ts` | IDeckManagerStore interface addition |
| `removeTab` | method signature | `deck-manager-store.ts` | IDeckManagerStore interface addition |
| `setActiveTab` | method signature | `deck-manager-store.ts` | IDeckManagerStore interface addition |
| `contentFactory` | field | `card-registry.ts` | Optional content-only factory on CardRegistration |
| `defaultFeedIds` | field | `card-registry.ts` | Optional feed IDs on CardRegistration (defaults to []) |
| `registerResponderChainManager` | function | `action-dispatch.ts` | Register ResponderChainManager for action routing |
| `tabs` | prop | `tugcard.tsx` | Optional TabItem[] prop |
| `activeTabId` | prop | `tugcard.tsx` | Optional string prop |
| `onTabSelect` | prop | `tugcard.tsx` | Optional callback prop |
| `onTabClose` | prop | `tugcard.tsx` | Optional callback prop |
| `onTabAdd` | prop | `tugcard.tsx` | Optional callback prop |
| `previousTab` | action | `tugcard.tsx` | Responder action: switch to previous tab |
| `nextTab` | action | `tugcard.tsx` | Responder action: switch to next tab |
| `addTab` | action | `deck-canvas.tsx` | Responder action: add tab to focused card |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test DeckManager tab methods in isolation | addTab, removeTab, setActiveTab edge cases |
| **Unit** | Test TugTabBar renders correct visual states | Active/inactive tabs, close button visibility, [+] button |
| **Integration** | Test Tugcard tab switching end-to-end | Content mounts/unmounts, header updates, responder chain |
| **Integration** | Test tab persistence round-trip | Serialize with tabs, deserialize, verify tabs restored |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add DeckManager Tab Methods, Store Interface, and contentFactory {#step-1}

**Commit:** `feat(tugdeck): add DeckManager addTab/removeTab/setActiveTab and CardRegistration contentFactory`

**References:** [D01] Tab state is props-driven from DeckManager, [D08] CardRegistration adds contentFactory, Spec S03, Spec S05, (#s03-deck-manager-tab-methods, #s05-content-factory, #d01-props-driven-tabs, #d08-content-factory, #symbols)

**Artifacts:**
- Modified `tugdeck/src/deck-manager-store.ts` -- add `addTab`, `removeTab`, `setActiveTab` to `IDeckManagerStore`
- Modified `tugdeck/src/deck-manager.ts` -- implement the three methods
- Modified `tugdeck/src/card-registry.ts` -- add optional `contentFactory` field to `CardRegistration`
- Modified `tugdeck/src/components/tugways/cards/hello-card.tsx` -- add `contentFactory` to hello-card registration
- Modified `tugdeck/src/__tests__/deck-canvas.test.tsx` -- add `addTab`, `removeTab`, `setActiveTab` stubs to `makeMockStore`
- Modified `tugdeck/src/__tests__/e2e-responder-chain.test.tsx` -- add `addTab`, `removeTab`, `setActiveTab` stubs to `makeMockStore`

**Tasks:**
- [ ] Add `addTab(cardId: string, componentId: string): string | null`, `removeTab(cardId: string, tabId: string): void`, `setActiveTab(cardId: string, tabId: string): void` to the `IDeckManagerStore` interface in `deck-manager-store.ts`
- [ ] Implement `addTab` in `DeckManager`: look up registration, create `TabItem` with `crypto.randomUUID()`, append to card's `tabs` array, set as `activeTabId`, shallow-copy `deckState`, `notify()`, `scheduleSave()`. Return the new tab id or null.
- [ ] Implement `removeTab` in `DeckManager`: find card, remove tab. If removed tab was active, activate the previous tab (or first if removed was first). If last tab removed, call `removeCard(cardId)`. Shallow-copy, notify, save.
- [ ] Implement `setActiveTab` in `DeckManager`: find card, verify tabId exists in card's tabs, set `activeTabId`. Shallow-copy, notify, save.
- [ ] Bind all three methods in the constructor as public arrow properties or `.bind(this)` assignments (same pattern as `handleCardMoved`, `handleCardClosed`, `handleCardFocused` in the existing constructor). This gives each method a stable identity so it can be passed directly to React components without triggering re-renders. Declare the corresponding public fields on the class matching the IDeckManagerStore signatures.
- [ ] Add optional `contentFactory?: (cardId: string) => React.ReactNode` field to `CardRegistration` interface in `card-registry.ts` (Spec S05). This field returns just the content component without Tugcard chrome.
- [ ] Add `defaultFeedIds?: string[]` field to `CardRegistration` interface in `card-registry.ts`. Defaults to `[]` when omitted. The multi-tab rendering path in DeckCanvas reads `registration.defaultFeedIds ?? []` instead of hardcoding `feedIds={[]}`. This provides a forward-compatible hook for Phase 6 feed-aware card types without requiring any retroactive changes.
- [ ] Update `registerHelloCard` in `hello-card.tsx` to provide `contentFactory: () => <HelloCardContent />` alongside the existing `factory`. (No `defaultFeedIds` needed for hello-card since the default is already `[]`.)
- [ ] Update `makeMockStore` in `tugdeck/src/__tests__/deck-canvas.test.tsx` and `tugdeck/src/__tests__/e2e-responder-chain.test.tsx` to include no-op stubs for `addTab`, `removeTab`, and `setActiveTab` so the mock satisfies the updated `IDeckManagerStore` interface. These stubs do not need real logic -- they just prevent TypeScript compilation errors.

**Tests:**
- [ ] Unit test: `addTab` creates a new tab with correct componentId and title from registration
- [ ] Unit test: `addTab` returns null for unregistered componentId
- [ ] Unit test: `addTab` returns null for non-existent cardId
- [ ] Unit test: `removeTab` removes the specified tab and activates an adjacent tab
- [ ] Unit test: `removeTab` on last tab removes the card entirely
- [ ] Unit test: `setActiveTab` updates activeTabId
- [ ] Unit test: `setActiveTab` is a no-op for invalid tabId
- [ ] Unit test: hello-card registration includes `contentFactory` that returns `HelloCardContent`

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with no TypeScript errors
- [ ] All existing tests pass

---

#### Step 2: Build TugDropdown Component {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add TugDropdown wrapper for shadcn DropdownMenu`

**References:** [D02] TugDropdown wraps shadcn DropdownMenu, Spec S04, (#s04-tug-dropdown-props, #d02-tug-dropdown, #new-files)

**Artifacts:**
- New file `tugdeck/src/components/tugways/tug-dropdown.tsx`
- New file `tugdeck/src/components/tugways/tug-dropdown.css`

**Tasks:**
- [ ] Create `tug-dropdown.tsx` with `TugDropdown` component wrapping shadcn's `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, and `DropdownMenuItem`.
- [ ] Define `TugDropdownItem` interface: `{ id: string; label: string; icon?: React.ReactNode; disabled?: boolean }`.
- [ ] Define `TugDropdownProps` interface: `{ trigger: React.ReactNode; items: TugDropdownItem[]; onSelect: (id: string) => void }`.
- [ ] TugDropdown renders: `DropdownMenu` root, `DropdownMenuTrigger asChild` wrapping the trigger, `DropdownMenuContent` with items mapped to `DropdownMenuItem` elements. Each item renders optional icon + label.
- [ ] Create `tug-dropdown.css` with styles using `--td-*` tokens: content background `var(--td-surface-raised)`, item text `var(--td-text)`, item hover `var(--td-surface-control)`, border `var(--td-border)`, border-radius `var(--td-radius-md)`, shadow `var(--td-shadow-md)`.
- [ ] Export `TugDropdown`, `TugDropdownProps`, and `TugDropdownItem` from the module.

**Tests:**
- [ ] Manual verification: TugDropdown renders with trigger and items (tested via Component Gallery in Step 10)

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with no TypeScript errors

---

#### Step 3: Build TugTabBar Component {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): add TugTabBar component with tab select, close, and type picker`

**References:** [D03] Tab bar uses the Tugcard accessory slot, Spec S01, Table T01, (#s01-tab-bar-props, #t01-tab-visual-states, #d03-tab-bar-accessory, #new-files, #tab-visual-states)

**Artifacts:**
- New file `tugdeck/src/components/tugways/tug-tab-bar.tsx`
- New file `tugdeck/src/components/tugways/tug-tab-bar.css`

**Tasks:**
- [ ] Create `tug-tab-bar.tsx` with `TugTabBar` component accepting `TugTabBarProps` (Spec S01).
- [ ] Render each tab as a button with icon (from `getRegistration(tab.componentId).defaultMeta.icon` via lucide-react `icons` map) and title. Active tab gets `data-active="true"` attribute.
- [ ] Active tab: `var(--td-surface)` background, `var(--td-text)` color, 2px bottom border `var(--td-accent)`, close button always visible.
- [ ] Inactive tab: transparent background, `var(--td-text-muted)` color, no bottom border, close button visible on hover only.
- [ ] Close button (x) rendered conditionally per tab: only show the close button when `tab.closable` is true (the `TabItem` interface has a `closable: boolean` field). For closable tabs, the close button is always visible on active tabs and visible on hover for inactive tabs (per Table T01). For non-closable tabs, no close button is rendered. Click calls `onTabClose(tabId)`. Stop propagation to prevent tab select.
- [ ] [+] button at the end of the tab strip. On click, opens a TugDropdown type picker listing all registered card types from `getAllRegistrations()`. Each item shows icon + title. Selecting an item calls `onTabAdd(componentId)`.
- [ ] Tab bar container: horizontal flex, `overflow-x: auto` for overflow, no wrapping. Height approx 28px to match header.
- [ ] Create `tug-tab-bar.css` with styles using `--td-*` tokens exclusively. Use `data-active` attribute selector for active state.
- [ ] All interactive elements have `user-select: none` to prevent accidental selection.

**Tests:**
- [ ] Unit test: TugTabBar renders correct number of tab buttons
- [ ] Unit test: Active tab has `data-active="true"` attribute
- [ ] Unit test: Clicking a tab calls `onTabSelect` with the correct tabId
- [ ] Unit test: Clicking close button calls `onTabClose` with the correct tabId
- [ ] Unit test: Close button is not rendered for tabs with `closable: false`
- [ ] Unit test: [+] button renders and type picker lists all registered card types

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with no TypeScript errors
- [ ] All tests pass

---

#### Step 4: Wire Tab State into Tugcard {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): wire tab state and TugTabBar into Tugcard composition`

**References:** [D01] Tab state is props-driven, [D03] Tab bar uses accessory slot, [D04] Inactive tabs unmount, [D05] Header follows active tab, [D07] Selection saved/restored, Spec S02, (#s02-extended-tugcard-props, #d01-props-driven-tabs, #d03-tab-bar-accessory, #d04-unmount-inactive, #d05-header-follows-active, #d07-selection-persistence)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tugcard.tsx` -- add tab props, conditional tab bar, content switching, selection persistence, responder actions
- Modified `tugdeck/src/components/tugways/hooks/use-selection-boundary.ts` -- change `useEffect` to `useLayoutEffect` for boundary registration (Rule of Tug #3)

**Tasks:**
- [ ] **Change `useSelectionBoundary` to use `useLayoutEffect`:** In `tugdeck/src/components/tugways/hooks/use-selection-boundary.ts`, change the `useEffect` (line 53) to `useLayoutEffect` and update the import. This aligns with Rule of Tug #3 ("Use useLayoutEffect for registrations that events depend on") -- selection restore depends on boundary registration, so the boundary must be registered during the commit phase before any `useLayoutEffect` in a parent component fires. React executes `useLayoutEffect` hooks bottom-up (children before parents), so the content component's boundary registration via `useLayoutEffect` completes before Tugcard's restore `useLayoutEffect` runs.
- [ ] Add optional tab props to `TugcardProps`: `tabs?: TabItem[]`, `activeTabId?: string`, `onTabSelect?: (tabId: string) => void`, `onTabClose?: (tabId: string) => void`, `onTabAdd?: (componentId: string) => void` (Spec S02).
- [ ] When `tabs` is provided and `tabs.length > 1`, render `<TugTabBar>` in the accessory slot. The TugTabBar is rendered inside Tugcard's existing accessory container div (the one measured by ResizeObserver). When `tabs.length <= 1`, the accessory slot remains empty (or uses the original accessory prop if provided).
- [ ] Compute active tab metadata: look up `getRegistration(activeTab.componentId).defaultMeta` to get title and icon for the header. Fall back to the `meta` prop if no active tab is found.
- [ ] Content switching: Tugcard renders `children` as the content area (unchanged from current behavior). DeckCanvas is responsible for passing the correct children based on the active tab (see Step 5). Tugcard itself does not call any factory -- it receives the active tab's content as `children`. Only the active tab's content is mounted because DeckCanvas only passes the active tab's content (D04).
- [ ] Selection persistence with strict ordering (D07): maintain a `useRef<Map<string, SavedSelection>>` keyed by tabId in Tugcard's component scope. Note: the `SelectionGuard` class has a private `savedSelections` field, but it is unused infrastructure -- do not use it. The per-tab selection map lives entirely in Tugcard's local ref. Wrap `onTabSelect` so that before calling the parent callback: (1) call `selectionGuard.saveSelection(cardId)` to get the current selection, (2) store the result keyed by the OLD activeTabId. After the new tab's content mounts, restore selection in a `useLayoutEffect` with dependency array `[activeTabId]` -- this fires whenever the active tab changes. Inside the effect, call `selectionGuard.restoreSelection(cardId, savedSelections.get(activeTabId))` if a saved selection exists for the new active tab. This `useLayoutEffect` fires after the child's `useLayoutEffect` (which registered the boundary via the updated `useSelectionBoundary`), so the boundary is guaranteed to be available.
- [ ] **Ref-based access for responder actions (Rule of Tug #5):** `useResponder` registers actions once at mount time via `useLayoutEffect`. The registered action closures are never re-registered on subsequent renders. Therefore, `previousTab` and `nextTab` handlers **must not** close over `tabs`, `activeTabId`, or `onTabSelect` directly -- those values would be stale after any prop update. Instead, create refs and update them on every render:
  - `const tabsRef = useRef(tabs); tabsRef.current = tabs;`
  - `const activeTabIdRef = useRef(activeTabId); activeTabIdRef.current = activeTabId;`
  - `const onTabSelectRef = useRef(onTabSelect); onTabSelectRef.current = onTabSelect;`
  Then `previousTab` and `nextTab` read from `tabsRef.current`, `activeTabIdRef.current`, and call `onTabSelectRef.current(targetTabId)`. This matches the exact pattern DeckCanvas uses for `cycleCard` with `cardsRef.current`.
- [ ] Register `previousTab` and `nextTab` responder actions using the refs above. `previousTab`: read `tabsRef.current` and `activeTabIdRef.current`, find current tab index, switch to `tabs[(index - 1 + tabs.length) % tabs.length]` via `onTabSelectRef.current`. `nextTab`: same pattern with `(index + 1) % tabs.length`. No-op when tabs is undefined or has length <= 1.
- [ ] Ensure the existing accessory height measurement (ResizeObserver) still works correctly when the tab bar appears/disappears.

**Tests:**
- [ ] Unit test: Tugcard with tabs renders TugTabBar in the accessory slot
- [ ] Unit test: Tugcard without tabs renders no TugTabBar (backward compatible)
- [ ] Unit test: Header title and icon reflect the active tab's registration metadata
- [ ] Unit test: Only the active tab's content is mounted (inactive tabs not in DOM)
- [ ] Unit test: previousTab and nextTab responder actions cycle correctly
- [ ] Existing `use-selection-boundary.test.tsx` tests still pass after useEffect-to-useLayoutEffect change

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with no TypeScript errors
- [ ] All tests pass (including existing selection boundary tests)

---

#### Step 5: Wire DeckCanvas to Construct Tab-Aware Tugcard {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugdeck): wire DeckCanvas to construct Tugcard with tab props and contentFactory`

**References:** [D01] Tab state is props-driven, [D05] Header follows active tab, [D08] CardRegistration adds contentFactory, Spec S05, (#d01-props-driven-tabs, #d05-header-follows-active, #d08-content-factory, #s05-content-factory, #context)

**Artifacts:**
- Modified `tugdeck/src/components/chrome/deck-canvas.tsx` -- construct Tugcard directly for multi-tab cards using contentFactory; single-tab cards use existing factory path

**Tasks:**
- [ ] Update the card registration lookup in DeckCanvas: currently uses `cardState.tabs[0]?.componentId`. Change to use the active tab: `cardState.tabs.find(t => t.id === cardState.activeTabId)?.componentId ?? cardState.tabs[0]?.componentId`. This ensures the correct registration is used for header title/icon (D05).
- [ ] Fork the `renderContent` logic based on tab count. **Single-tab cards** (`cardState.tabs.length <= 1`): use the existing `factory(cardId, injected)` + `cloneElement(element, { onClose })` path unchanged. **Multi-tab cards** (`cardState.tabs.length > 1`): construct `<Tugcard>` directly inside `renderContent`, passing all tab props explicitly:
  ```
  <Tugcard
    cardId={cardState.id}
    meta={activeRegistration.defaultMeta}
    feedIds={activeRegistration.defaultFeedIds ?? []}
    tabs={cardState.tabs}
    activeTabId={cardState.activeTabId}
    onTabSelect={(tabId) => store.setActiveTab(cardState.id, tabId)}
    onTabClose={(tabId) => store.removeTab(cardState.id, tabId)}
    onTabAdd={(componentId) => store.addTab(cardState.id, componentId)}
    onClose={() => store.handleCardClosed(cardState.id)}
    onDragStart={injected.onDragStart}
    onMinSizeChange={injected.onMinSizeChange}
  >
    {activeRegistration.contentFactory?.(cardState.id) ?? null}
  </Tugcard>
  ```
  This avoids nested Tugcards (D08) and avoids fragile cloneElement prop injection for tab props. `feedIds` reads from `activeRegistration.defaultFeedIds ?? []` so Phase 6 feed-aware card types work without retroactive changes.
- [ ] Add `import { Tugcard } from "@/components/tugways/tugcard"` to DeckCanvas (not currently imported since DeckCanvas delegates to factories).
- [ ] The tab callbacks wrap the store methods: `onTabSelect: (tabId) => store.setActiveTab(cardState.id, tabId)`, `onTabClose: (tabId) => store.removeTab(cardState.id, tabId)`, `onTabAdd: (componentId) => store.addTab(cardState.id, componentId)`. These inline arrow functions create new references every render, which is acceptable for Phase 5b -- the Tugcard component does not memo-compare these callbacks. Stabilizing with `useCallback` is a future optimization if profiling reveals unnecessary re-renders.
- [ ] When a card transitions from single-tab to multi-tab (a tab is added), DeckCanvas automatically renders via the multi-tab path on the next store update because `cardState.tabs.length` changes. No explicit transition logic needed.

**Tests:**
- [ ] Integration test: adding a tab via store.addTab makes the tab bar appear on the card
- [ ] Integration test: switching tabs via store.setActiveTab changes the visible content
- [ ] Integration test: single-tab card still renders via existing factory path (backward compatible)
- [ ] Integration test: closing a multi-tab card via the onClose prop on the directly-constructed Tugcard calls `store.handleCardClosed` with the correct cardId (verifies the multi-tab path wires onClose correctly, since it bypasses the cloneElement injection used by the single-tab path)

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with no TypeScript errors
- [ ] All tests pass
- [ ] Manual verification: open the app, add a hello card, the card renders with a single tab (no tab bar visible)

---

#### Step 6: Integration Checkpoint -- Tab Switching End-to-End {#step-6}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] Tab state is props-driven, [D04] Inactive tabs unmount, [D05] Header follows active tab, [D07] Selection saved/restored, (#success-criteria, #context)

**Tasks:**
- [ ] Manually add a second tab to a card (via browser console: `store.addTab(cardId, "hello")`)
- [ ] Verify the tab bar appears with two tabs
- [ ] Verify clicking a tab switches content and updates header title/icon
- [ ] Verify the close button removes a tab and the tab bar disappears when one tab remains
- [ ] Verify selection save/restore: select text in tab 1, switch to tab 2, switch back to tab 1, verify selection is restored
- [ ] Verify responder chain: after tab switch, the new tab's content is the active responder

**Tests:**
- [ ] Aggregate: all unit and integration tests from Steps 1-5 pass together (`cd tugdeck && bun test`)
- [ ] Manual end-to-end test: two-tab card with tab switching, close, and selection restore

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds
- [ ] All tests pass
- [ ] Manual verification of all items above

---

#### Step 7: Wire Mac Menu Add-Tab Command {#step-7}

**Depends on:** #step-6

**Commit:** `feat(tugdeck): wire add-tab Mac menu command via responder chain`

**References:** [D06] Add-tab action uses DeckManager + responder chain, [D09] Add-tab routed as DeckCanvas responder action, (#d06-add-tab-routing, #d09-add-tab-responder, #strategy)

**Artifacts:**
- Modified `tugdeck/src/action-dispatch.ts` -- add `registerResponderChainManager` setter; register `add-tab` handler that dispatches through the responder chain
- Modified `tugdeck/src/components/tugways/responder-chain-provider.tsx` -- call `registerResponderChainManager` on mount
- Modified `tugdeck/src/components/chrome/deck-canvas.tsx` -- register `addTab` responder action
- Modified Swift side (`tugapp/`) -- add Developer menu item for "Add Tab" that sends `add-tab` control frame

**Tasks:**
- [ ] Add `registerResponderChainManager(manager: ResponderChainManager)` function to `action-dispatch.ts` (same module-level setter pattern as `registerGallerySetter`). Store in a module-level variable.
- [ ] In `ResponderChainProvider`, call `registerResponderChainManager(manager)` inside the mount `useEffect`, alongside the existing `selectionGuard.attach()` call.
- [ ] Register `add-tab` action handler in `initActionDispatch`. The handler dispatches `"addTab"` through the registered ResponderChainManager: `responderChainManagerRef.dispatch("addTab")`. If no manager is registered, log a warning and no-op.
- [ ] In DeckCanvas, register `addTab` as a responder action (alongside existing `cycleCard`, `showComponentGallery`, etc.). The handler reads `cardsRef.current` to find the focused card (last card in the array, same logic as `focusedCardId`), then calls `store.addTab(focusedCardId, "hello")`. If no card is focused (empty array), no-op. Note: the handler does not check the `deselected` flag -- if cards exist but the user has clicked the canvas background to deselect, the add-tab action still targets the topmost card (last in array). This is acceptable behavior: the deselected state is a visual indicator, not a semantic "no card is active" state, and adding a tab to the topmost card is the reasonable default. The componentId `"hello"` is intentionally hardcoded because it is the only registered card type in Phase 5. The responder chain's `dispatch(action)` signature takes only an action string with no payload, so parameterized componentId dispatch is deferred to a future phase that adds payload support or a different routing mechanism.
- [ ] On the Swift side: add a "Add Tab" menu item to the Developer menu in `AppDelegate.swift` or `MenuCommands.swift` that sends `{ "action": "add-tab" }` control frame via `sendControl`.
- [ ] If the Swift side is too complex to wire in this step, document the manual testing approach (browser console: `manager.dispatch("addTab")`).

**Tests:**
- [ ] Manual test: select a card, trigger "Add Tab" from Developer menu (or browser console), verify a new tab is added to the focused card

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds
- [ ] Manual verification: Mac menu "Add Tab" adds a tab to the focused card

---

#### Step 8: Verify Tab Persistence {#step-8}

**Depends on:** #step-6

**Commit:** `N/A (verification only)`

**References:** [D01] Tab state is props-driven, (#scope, #assumptions)

**Tasks:**
- [ ] Manually verify that tab state persists across page reload: add tabs, reload the page, verify tabs are restored with the correct active tab
- [ ] Review `serialization.ts` to confirm v5 format already handles `CardState.tabs` and `CardState.activeTabId` correctly. No code changes expected.
- [ ] If serialization does not handle multiple tabs correctly (e.g., only validates `tabs[0]`), file a fix in this step.

**Tests:**
- [ ] Existing serialization round-trip tests pass with multi-tab CardState
- [ ] Manual persistence test: add tabs, reload, verify tabs restored

**Checkpoint:**
- [ ] Tab state survives page reload
- [ ] Existing serialization tests still pass

---

#### Step 9: Update filterRegisteredCards for Multi-Tab Cards {#step-9}

**Depends on:** #step-5

**Commit:** `fix(tugdeck): update filterRegisteredCards to handle mixed-type multi-tab cards`

**References:** [D01] Tab state is props-driven, Spec S03, (#d01-props-driven-tabs, #s03-deck-manager-tab-methods)

**Artifacts:**
- Modified `tugdeck/src/deck-manager.ts` -- update `filterRegisteredCards` to validate all tabs, not just `tabs[0]`

**Tasks:**
- [ ] Currently `filterRegisteredCards` only checks `card.tabs[0]?.componentId`. Update it to validate that the card's active tab has a registered componentId. Alternatively, filter out individual unregistered tabs from each card while keeping the card if at least one registered tab remains.
- [ ] Chose approach: filter individual unregistered tabs from each card. If all tabs are filtered out, remove the card. If the active tab was filtered out, set `activeTabId` to the first remaining tab.
- [ ] Update DeckCanvas's rendering loop to use the active tab's componentId (not `tabs[0]`) for registration lookup. (This may already be done in Step 5; verify and complete here if needed.)

**Tests:**
- [ ] Unit test: card with mixed registered/unregistered tabs keeps only registered tabs
- [ ] Unit test: card with all unregistered tabs is removed entirely
- [ ] Unit test: if active tab is unregistered, activeTabId falls back to first registered tab

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds
- [ ] All tests pass

---

#### Step 10: Add TugTabBar and TugDropdown to Component Gallery {#step-10}

**Depends on:** #step-6

**Commit:** `feat(tugdeck): add TugTabBar and TugDropdown sections to Component Gallery`

**References:** [D02] TugDropdown wraps shadcn DropdownMenu, [D03] Tab bar uses accessory slot, Table T01, (#t01-tab-visual-states, #d02-tug-dropdown, #d03-tab-bar-accessory)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/component-gallery.tsx` -- add TugTabBar and TugDropdown demo sections

**Tasks:**
- [ ] Add a "TugTabBar" section to the Component Gallery. Render a standalone TugTabBar with 3 sample tabs (using hello card registration data). Wire onTabSelect to switch the active tab in local state. Wire onTabClose to remove tabs from local state. Wire onTabAdd to add tabs from local state.
- [ ] Add a "TugDropdown" section showing a standalone TugDropdown with sample items (icon + label), demonstrating the trigger button and item selection.
- [ ] Add dividers between the new sections and existing sections.
- [ ] Verify both demo sections are interactive and styled correctly with `--td-*` tokens.

**Tests:**
- [ ] Manual verification: both gallery sections render correctly and respond to interaction

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds
- [ ] Manual verification: Component Gallery shows TugTabBar and TugDropdown sections

---

#### Step 11: Final Integration Checkpoint {#step-11}

**Depends on:** #step-6, #step-7, #step-8, #step-9, #step-10

**Commit:** `N/A (verification only)`

**References:** [D01] Tab state is props-driven, [D04] Inactive tabs unmount, [D05] Header follows active tab, [D07] Selection saved/restored, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all success criteria are met (see Success Criteria section)
- [ ] Verify no TypeScript errors and all tests pass
- [ ] Verify no console warnings or errors during normal tab operations
- [ ] Verify backward compatibility: single-tab cards render identically to pre-Phase 5b

**Tests:**
- [ ] Full test suite pass: `cd tugdeck && bun test` -- all unit and integration tests green
- [ ] Manual acceptance test: walk through all success criteria items

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds
- [ ] All tests pass
- [ ] All success criteria verified manually

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Cards support multiple tabs with click-based management. Tab bar appears when a card has more than one tab, with tab select, close, add (via type picker), and active/inactive visual states. Selection is saved/restored on tab switch. Tab state persists across reload.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] TugTabBar component exists and renders correctly (`tug-tab-bar.tsx` + `tug-tab-bar.css`)
- [ ] TugDropdown component exists and wraps shadcn DropdownMenu (`tug-dropdown.tsx` + `tug-dropdown.css`)
- [ ] DeckManager has `addTab`, `removeTab`, `setActiveTab` methods
- [ ] Tugcard renders tab bar in accessory slot when `tabs.length > 1`
- [ ] Header title and icon follow the active tab
- [ ] `previousTab` / `nextTab` responder actions registered on Tugcard
- [ ] Mac menu "Add Tab" command works for testing
- [ ] Tab state persists across page reload
- [ ] Selection saved/restored on tab switch
- [ ] TugTabBar and TugDropdown appear in Component Gallery
- [ ] All existing tests pass; no regressions

**Acceptance tests:**
- [ ] Add second tab to card: tab bar appears with two tabs
- [ ] Switch tabs: content changes, header updates, selection restored
- [ ] Close tab: tab removed, tab bar disappears when one tab remains
- [ ] Type picker: [+] button opens dropdown with registered card types
- [ ] Reload page: tabs are restored from persistence
- [ ] `previousTab` / `nextTab` cycle through tabs

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 5b2: Drag-to-reorder, drag-to-detach, drag-to-merge tab gestures
- [ ] Keyboard bindings for tab switching (Ctrl+Tab / Ctrl+Shift+Tab)
- [ ] Tab overflow scrolling with scroll arrows for many tabs
- [ ] Per-tab scroll position persistence
- [ ] Keep-alive option for stateful tab content (e.g., terminals)

| Checkpoint | Verification |
|------------|--------------|
| Tab bar visibility | Tabs.length > 1 shows tab bar; tabs.length === 1 hides it |
| Tab switching | Click tab -> content changes, header updates |
| Tab persistence | Reload page -> tabs restored |
| Selection persistence | Select text, switch tab, switch back -> selection restored |
| Type picker | Click [+] -> dropdown lists all registered card types |
| Responder actions | previousTab/nextTab cycle through tabs |
| Build clean | `cd tugdeck && bun run build` succeeds with no errors |
