<!-- tugplan-skeleton v2 -->

## Tugways Phase 5f: Inactive State Preservation {#phase-5f-state-preservation}

**Purpose:** Card and tab state (scroll position, text selection, card content state, focused card identity, and collapsed flag) survives both tab switching and app reload, enabling seamless workspace continuity.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5f-state-preservation |
| Last updated | 2026-03-08 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

When a tab becomes inactive (user switches to another tab in the same card), the inactive tab's content component unmounts, losing all ephemeral DOM state: text selection, scroll position, and any card content state (form values, tree expand/collapse, search filters). On app reload, all state is lost entirely. The Phase 5a selection guard already saves/restores selections across tab switches in-memory, but this does not survive reload. Scroll positions are never captured. Card content state is unmanaged.

Phase 5e (tugbank) established the persistence infrastructure with SQLite-backed typed defaults and HTTP bridge endpoints. This phase builds on that foundation to preserve state across both tab switches (in-memory fast path) and app reloads (tugbank durable path).

#### Strategy {#strategy}

- Add data model fields first (`collapsed` on CardState, `focusedCardId` on DeckState) with serialization support, establishing the schema before any behavioral code.
- Implement the in-memory TabStateBag cache on DeckManager and the tugbank read/write functions in settings-api.ts, providing the plumbing before any consumers exist.
- Wire Tugcard deactivation capture and activation restore as lifecycle hooks on tab switch, extending the existing selection save/restore pattern in tugcard.tsx.
- Create the `useTugcardPersistence` hook as a clean opt-in mechanism for card content components, using a new context inside Tugcard.
- Add focused card ID persistence as a reload-only mechanism: written on focus change, consumed on reload via `makeFirstResponder` in DeckCanvas (not DeckManager, which cannot access the responder chain), then cleared.
- Ensure all tab switch code paths (click, keyboard previousTab/nextTab) route through the state-saving helper so no path silently loses state.
- Implement inactive selection appearance as a pure CSS treatment using the existing `data-focused` attribute on `.card-frame`, following Rule 4 of Rules of Tugways.
- Keep terminal buffer persistence and Monaco editor integration explicitly out of scope.

#### Success Criteria (Measurable) {#success-criteria}

- Switch tabs in a card with scrolled content, switch back: scroll position is restored to within 1px (manual verification).
- Select text in a tab, switch to another tab, switch back: selection is restored (same anchor/focus).
- A card content component using `useTugcardPersistence` round-trips its state through a tab switch (onSave called on deactivation, onRestore called on activation with the saved state).
- Reload the app: scroll positions, selections, and card content state are restored from tugbank.
- Reload the app: the previously focused card regains keyboard focus via `makeFirstResponder`.
- Non-focused cards display selections with the dimmed `--tug-base-selection-bg-inactive` background, not the active highlight color.
- `collapsed` field is present on CardState, serialized/deserialized, and round-trips through tugbank (no UI in this phase).

#### Scope {#scope}

1. Add `collapsed?: boolean` to `CardState` and `focusedCardId?: string` to `DeckState` in layout-tree.ts
2. Update serialization.ts to read/write the new fields
3. Add `fetchTabState`, `putTabState`, `fetchDeckState`, `putDeckState` functions to settings-api.ts
4. Add `TabStateBag` type and in-memory cache (`Map<string, TabStateBag>`) to DeckManager
5. Implement Tugcard deactivation capture (scroll, selection, content state) and activation restore
6. Create `useTugcardPersistence` hook and `TugcardPersistenceContext`
7. Persist focused card ID to tugbank on focus change; restore on reload
8. Add `--tug-base-selection-bg-inactive` CSS token and inactive selection styles
9. Load all tab state bags from tugbank on app initialization

#### Non-goals (Explicitly out of scope) {#non-goals}

- Terminal buffer persistence (deferred to Phase 9)
- Monaco editor state persistence (deferred to Phase 8/9; the hook's `content: unknown` field is designed for it)
- Collapse UI toggle in the title bar (deferred to Phase 8a; only the data field is established here)
- Migration from pre-v5 serialization formats
- CAS (compare-and-swap) concurrency for tab state writes (fire-and-forget is sufficient)

#### Dependencies / Prerequisites {#dependencies}

- Phase 5e (tugbank) is complete: `/api/defaults/` HTTP endpoints are available for `dev.tugtool.deck.state` and `dev.tugtool.deck.tabstate` domains.
- Phase 5b (card tabs) is complete: tab switching lifecycle exists, tabs array on CardState, `setActiveTab` on DeckManager.
- Phase 5a (selection model) is complete: `SelectionGuard.saveSelection()` / `restoreSelection()` API exists.

#### Constraints {#constraints}

- All appearance changes must go through CSS and DOM, never React state (Rule 4 of Rules of Tugways).
- Read external state with `useSyncExternalStore` only (Rule 2).
- Use `useLayoutEffect` for registrations that events depend on (Rule 3).
- Every action handler must access current state through refs or stable singletons, never stale closures (Rule 5).
- Selection stays inside card boundaries (Rule 6).
- DeckManager stays a plain class (not a React component) per [D08] of the existing architecture.

#### Assumptions {#assumptions}

- The `data-focused` attribute is already set on `.card-frame` elements by `card-frame.tsx` and can be used for CSS-only inactive selection styling.
- `SelectionGuard.saveSelection()` and `restoreSelection()` APIs are stable and work correctly for the tab switch lifecycle.
- Tugbank HTTP endpoints accept `{"kind":"json","value":{...}}` tagged-value wire format for JSON payloads.
- The `contentRef` in Tugcard already points to the `.tugcard-content` div, which is the scrollable container.
- Tab IDs are stable UUIDs that survive across sessions (persisted in layout serialization).

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the conventions defined in the tugplan-skeleton. All anchors are explicit, kebab-case, and use the prefix conventions: `step-N` for execution steps, `dNN-...` for design decisions, `sNN-...` for specs.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All design decisions were resolved during clarification:
- focusedCardId is reload-only (not used at runtime for focus inference).
- Inactive selection uses dimmed background via CSS `::selection`.
- SavedSelection is stored as-is in tugbank (opaque JSON, silent no-op on DOM mismatch).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Selection restore fails after reload due to DOM structure change | low | med | Silent no-op — `restoreSelection` already handles path resolution failure gracefully | Users report lost selections after reload more than 50% of the time |
| Tab state bag grows large for complex card content | low | low | `content` field is opaque JSON; card authors control what they persist. No automatic blob growth. | Single tab state bag exceeds 100KB |
| Debounce timing causes state loss on rapid tab switches | med | low | In-memory cache is always written synchronously; tugbank write is debounced but the cache is the primary read source during a session | Users report lost state on fast tab cycling |
| Orphaned tab state bags accumulate in cache and tugbank | low | med | Tab state entries are small (scroll coords + selection path + opaque content). Orphans are harmless. Cleanup deferred to a follow-on. | Tugbank storage grows noticeably due to orphaned entries |

**Risk R01: Selection Restore Fidelity Across Reload** {#r01-selection-restore}

- **Risk:** SavedSelection uses DOM index paths that may not resolve correctly if card content structure changes between save and reload (e.g., dynamic content, async data).
- **Mitigation:** `restoreSelection` already returns silently when paths cannot be resolved. The user decided to store selections as-is with silent no-op on failure.
- **Residual risk:** Selections are best-effort across reloads. Guaranteed for static content; probabilistic for dynamic content.

---

### Design Decisions {#design-decisions}

> These decisions are imported from design-system-concepts.md [D49]-[D52] and refined with user answers from clarification.

#### [D01] Per-tab state bag with three fields (DECIDED) {#d01-tab-state-bag}

**Decision:** Each tab gets a `TabStateBag` containing `scroll?: { x: number; y: number }`, `selection?: SavedSelection | null`, and `content?: unknown`. Stored in tugbank under `dev.tugtool.deck.tabstate` domain, keyed by tab ID.

**Rationale:**
- Scroll and selection are Tugcard-managed (captured automatically on deactivation).
- Content is card-content-managed (opted in via `useTugcardPersistence`).
- The `unknown` type for content allows any JSON-serializable state without Tugcard knowing the schema.

**Implications:**
- DeckManager maintains a `Map<string, TabStateBag>` in-memory cache for fast tab-switch access.
- Tugbank is the durable backing store; writes are debounced to avoid HTTP overhead on rapid tab switches.

#### [D02] useTugcardPersistence hook for card content opt-in (DECIDED) {#d02-persistence-hook}

**Decision:** Card content components call `useTugcardPersistence({ onSave: () => T, onRestore: (state: T) => void })` to register save/restore callbacks. Tugcard calls `onSave` on deactivation and `onRestore` on activation.

**Rationale:**
- Card content owns its state schema — Tugcard treats it as opaque JSON.
- The hook pattern matches existing Tugcard extension points (`usePropertyStore`, `useSelectionBoundary`).
- Registration uses a new `TugcardPersistenceContext` inside Tugcard, following the same context-based registration pattern as `TugcardPropertyContext`.

**Implications:**
- Tugcard must provide `TugcardPersistenceContext` wrapping card content children.
- The hook registers callbacks via `useLayoutEffect` (Rule 3) so they are available before any events fire.
- If `onRestore` is registered but no saved state exists, `onRestore` is not called.

#### [D03] Focused card ID is reload-only (DECIDED) {#d03-focused-card-reload}

**Decision:** `focusedCardId` is written to `DeckState` and tugbank (`dev.tugtool.deck.state` domain) on focus change purely for reload restoration. Runtime focus continues using array-order inference in deck-canvas.tsx. On reload, `focusedCardId` is used to call `makeFirstResponder`, then cleared from memory (not from tugbank — it stays in tugbank for the next reload).

**Rationale:**
- Runtime focus is already managed by array position (last card in the array is focused). Adding a second source of truth would create conflicts.
- Only reload needs an explicit pointer because the array order alone does not trigger `makeFirstResponder`.

**Implications:**
- `focusedCardId` is written to tugbank on every `focusCard()` call (fire-and-forget PUT). The PUT is placed before the early-return guard in `focusCard()` so that clicking an already-focused card (or a single-card deck) still persists the ID.
- `focusCard()` also calls `scheduleSave()` to persist the z-order change to the layout blob. This ensures that on reload, the layout's card array order already reflects the last-focused card at the end (highest z-index), eliminating the need for z-order correction on reload.
- On reload, DeckCanvas reads `initialFocusedCardId` from the store and calls `store.handleCardFocused(focusedCardId)` (z-order update), `setDeselected(false)`, and `manager.makeFirstResponder(focusedCardId)` (responder focus) in a `useEffect` on mount. DeckManager cannot access the responder chain directly (it is a plain class, not a React component), so focus restoration is delegated to DeckCanvas which has access to `useRequiredResponderChain()`.
- The field is optional on `DeckState` (`focusedCardId?: string`).

#### [D04] Collapsed field is schema-only (DECIDED) {#d04-collapsed-schema}

**Decision:** `collapsed?: boolean` is added to `CardState`. Missing equals `false`. No serialization version bump. No UI in this phase.

**Rationale:**
- Phase 8a builds the collapse toggle UI. This phase establishes the data field so Phase 8a can simply read/write it.
- Optional field with missing-equals-false means existing serialized layouts are backward compatible.

**Implications:**
- `serialization.ts` reads `collapsed` from the raw card object with a defensive default of `false`.
- The `serialize` function includes `collapsed` in the output when present.

#### [D05] Inactive selection uses dimmed CSS background (DECIDED) {#d05-inactive-selection}

**Decision:** Selections in non-focused cards render with a dimmed, desaturated background color via `--tug-base-selection-bg-inactive` CSS token. Pure CSS approach scoped to `.card-frame[data-focused="false"] .tugcard-content ::selection`.

**Rationale:**
- Matches macOS inactive window selection conventions (low-opacity gray).
- Uses the existing `data-focused` attribute on `.card-frame` (already set by card-frame.tsx).
- Follows Rule 4: appearance changes through CSS and DOM, never React state.

**Implications:**
- New token `--tug-base-selection-bg-inactive` added to `tug-tokens.css` and overridden in `bluenote.css` and `harmony.css`.
- No JavaScript needed — the browser applies the correct `::selection` style based on the `data-focused` attribute.

#### [D06] In-memory cache is primary read source (DECIDED) {#d06-cache-primary}

**Decision:** During a session, tab state bags are read from the in-memory `Map<string, TabStateBag>` on DeckManager. Tugbank is only read on app initialization (cache miss fallback). Writes go to both cache (synchronous) and tugbank (debounced).

**Rationale:**
- Tab switches happen frequently and must be instant. HTTP round-trips to tugbank on every tab switch would add visible latency.
- The cache is populated from tugbank on initialization, so it is warm for all known tabs from the previous session.

**Implications:**
- `DeckManager.constructor` must read all tab state bags from tugbank during initialization (async, before first render is impractical — load after render and restore on first tab activation).
- Cache writes are synchronous; tugbank writes are debounced with the same `SAVE_DEBOUNCE_MS` constant used for layout saves.

---

### Specification {#specification}

#### Spec S01: TabStateBag Type {#s01-tab-state-bag-type}

```typescript
import type { SavedSelection } from "./components/tugways/selection-guard";

export interface TabStateBag {
  scroll?: { x: number; y: number };
  selection?: SavedSelection | null;
  content?: unknown;
}
```

The type lives in a new file or in `layout-tree.ts` alongside the other data model types.

#### Spec S02: Settings API Additions {#s02-settings-api}

Four new functions in `settings-api.ts`:

```typescript
/** Fetch all tab state bags from tugbank. Returns a Map keyed by tab ID. */
export async function fetchTabStatesWithRetry(): Promise<Map<string, TabStateBag>>;

/** PUT a single tab state bag to tugbank (fire-and-forget). */
export function putTabState(tabId: string, bag: TabStateBag): void;

/** Fetch the deck state (focusedCardId) from tugbank. Returns focusedCardId or null. */
export async function fetchDeckStateWithRetry(): Promise<string | null>;

/** PUT the focused card ID to tugbank (fire-and-forget). */
export function putFocusedCardId(focusedCardId: string): void;
```

**Wire format:**
- Tab state: `PUT /api/defaults/dev.tugtool.deck.tabstate/{tabId}` with body `{"kind":"json","value":{...TabStateBag...}}`
- Deck state: `PUT /api/defaults/dev.tugtool.deck.state/focusedCardId` with body `{"kind":"string","value":"<cardId>"}`

**Fetch for tab states:** Since tugbank does not have a "list all keys in domain" endpoint, `fetchTabStatesWithRetry` reads each tab ID from the loaded layout's tab list. This means the function needs the set of known tab IDs as a parameter:

```typescript
export async function fetchTabStatesWithRetry(
  tabIds: string[]
): Promise<Map<string, TabStateBag>>;
```

**Concurrency note:** All tab ID fetches fire in parallel via `Promise.allSettled`. The current tab count is expected to be small (typically under 20 tabs across all cards), so unbounded parallelism is acceptable. If tab counts grow significantly in the future, a batching or concurrency-limiting approach can be added as a follow-on.

#### Spec S03: DeckManager Tab State Cache API {#s03-cache-api}

New private field and methods on `DeckManager`:

```typescript
/** In-memory cache of tab state bags. Primary read source during a session. */
private tabStateCache: Map<string, TabStateBag> = new Map();

/** Debounce timer for tab state saves (separate from layout save timer). */
private tabStateSaveTimer: number | null = null;

/** Read a tab state bag. Returns undefined if not cached. */
getTabState(tabId: string): TabStateBag | undefined;

/** Write a tab state bag to cache and schedule debounced tugbank write. */
setTabState(tabId: string, bag: TabStateBag): void;
```

These methods are exposed on `IDeckManagerStore` so Tugcard can access them via `DeckManagerContext`.

**Destroy flush:** `DeckManager.destroy()` must flush both debounce timers before clearing them. The existing `destroy()` only cancels the layout `saveTimer` without writing — this is a pre-existing bug that this phase fixes. On destroy: (a) if `saveTimer` is pending, call `saveLayout()` then clear it, and (b) if `tabStateSaveTimer` is pending, call `putTabState` for all dirty cache entries then clear it. To track dirty tab state entries, `setTabState` records the tab ID in a `Set<string>` (`dirtyTabIds`) that is cleared after each flush.

#### Spec S04: TugcardPersistenceContext {#s04-persistence-context}

```typescript
export interface TugcardPersistenceCallbacks {
  onSave: () => unknown;
  onRestore: (state: unknown) => void;
}

/**
 * Context provided by Tugcard to its children. Card content components
 * call useTugcardPersistence() which reads this context to register
 * their save/restore callbacks.
 */
export const TugcardPersistenceContext = createContext<
  ((callbacks: TugcardPersistenceCallbacks) => void) | null
>(null);
```

#### Spec S05: useTugcardPersistence Hook {#s05-persistence-hook}

```typescript
export function useTugcardPersistence<T>(options: {
  onSave: () => T;
  onRestore: (state: T) => void;
}): void;
```

Internally:
1. Reads `TugcardPersistenceContext` to get the registration function.
2. Stores `onSave` and `onRestore` in refs (Rule 5: no stale closures).
3. Calls the registration function in `useLayoutEffect` (Rule 3) with stable wrappers that read from refs.

---

### Deep Dives (Optional) {#deep-dives}

#### Deactivation/Activation Lifecycle Flow {#lifecycle-flow}

**Tab switch (deactivation of old tab, activation of new tab):**

All tab switch paths (click via `handleTabSelect`, keyboard via `handlePreviousTab`/`handleNextTab`) route through a shared `saveCurrentTabState` helper before switching. This prevents keyboard-driven tab switches from silently losing state.

1. User switches tabs (click, Ctrl+Tab, or Ctrl+Shift+Tab).
2. `saveCurrentTabState` fires (called by all three code paths):
   a. Save scroll position: read `contentRef.current.scrollLeft` and `scrollTop`.
   b. Save selection: call `selectionGuard.saveSelection(cardId)`.
   c. Call `persistenceCallbacksRef.current?.onSave()` to get card content state.
   d. Build `TabStateBag` from the three pieces.
   e. Write to DeckManager cache: `store.setTabState(oldTabId, bag)`.
3. The tab switch callback (`onTabSelect(newTabId)`) fires, triggering React re-render.
4. React unmounts old tab content, mounts new tab content.
5. `useLayoutEffect([activeTabId])` in Tugcard fires (activation):
   a. Read `store.getTabState(newTabId)`.
   b. Set scroll position directly: `contentRef.current.scrollLeft = bag.scroll?.x ?? 0; contentRef.current.scrollTop = bag.scroll?.y ?? 0`. Since `useLayoutEffect` fires before paint, the DOM is laid out and scroll can be set synchronously (no RAF needed).
   c. Call `selectionGuard.restoreSelection(cardId, bag.selection)` if selection exists.
   d. Call `persistenceCallbacksRef.current?.onRestore(bag.content)` if content exists.

**App reload:**

1. `main.tsx` runs a two-phase initialization: (a) fetch layout, theme, and deck state in parallel via `Promise.all`; (b) deserialize the layout to extract all tab IDs, then fetch tab states using those IDs via `fetchTabStatesWithRetry(tabIds)`. Tab state fetch cannot run in parallel with layout because it depends on the tab IDs from the deserialized layout.
2. Passes all four results (layout, theme, deck state, tab states) to `DeckManager` constructor.
3. DeckManager populates `tabStateCache` from the fetched tab states.
4. DeckManager stores `initialFocusedCardId` as a public field on the store.
5. After `root.render()`, each Tugcard mounts and its `useLayoutEffect` fires. If the tab has a cached state bag, it restores scroll, selection, and content state.
6. DeckCanvas reads `store.initialFocusedCardId` in a `useEffect` on mount. If set and the card exists in the deck, it calls: `store.handleCardFocused(focusedCardId)` to update z-order, `setDeselected(false)` to clear the canvas deselect state, and `manager.makeFirstResponder(focusedCardId)` via `useRequiredResponderChain()` to set responder focus. Then clears `store.initialFocusedCardId` so it only fires once. This keeps DeckManager decoupled from the responder chain (DeckManager is a plain class, not a React component).

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/use-tugcard-persistence.tsx` | `useTugcardPersistence` hook and `TugcardPersistenceContext` |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TabStateBag` | interface | `layout-tree.ts` | Per-tab state bag type |
| `CardState.collapsed` | field | `layout-tree.ts` | Optional boolean, missing = false |
| `DeckState.focusedCardId` | field | `layout-tree.ts` | Optional string, reload-only |
| `fetchTabStatesWithRetry` | fn | `settings-api.ts` | Fetch all tab state bags from tugbank |
| `putTabState` | fn | `settings-api.ts` | PUT single tab state bag |
| `fetchDeckStateWithRetry` | fn | `settings-api.ts` | Fetch focusedCardId from tugbank |
| `putFocusedCardId` | fn | `settings-api.ts` | PUT focused card ID |
| `DeckManager.tabStateCache` | field | `deck-manager.ts` | `Map<string, TabStateBag>` |
| `DeckManager.dirtyTabIds` | field | `deck-manager.ts` | `Set<string>` for flush-on-destroy tracking |
| `DeckManager.getTabState` | method | `deck-manager.ts` | Read from cache |
| `DeckManager.setTabState` | method | `deck-manager.ts` | Write to cache + debounced tugbank |
| `IDeckManagerStore.getTabState` | method | `deck-manager-store.ts` | Interface addition |
| `IDeckManagerStore.setTabState` | method | `deck-manager-store.ts` | Interface addition |
| `IDeckManagerStore.initialFocusedCardId` | field | `deck-manager-store.ts` | Optional string, read by DeckCanvas for reload focus restoration |
| `DeckManager.initialFocusedCardId` | field | `deck-manager.ts` | Public field, set from constructor param, cleared after DeckCanvas reads it |
| `TugcardPersistenceContext` | context | `use-tugcard-persistence.tsx` | Registration context |
| `TugcardPersistenceCallbacks` | interface | `use-tugcard-persistence.tsx` | onSave/onRestore pair |
| `useTugcardPersistence` | fn | `use-tugcard-persistence.tsx` | Card content persistence hook |
| `--tug-base-selection-bg-inactive` | CSS token | `tug-tokens.css` | Dimmed selection background |

---

### Documentation Plan {#documentation-plan}

- [ ] Update `roadmap/tugways-implementation-strategy.md` Phase 5f section to mark as COMPLETE with summary of what was done
- [ ] Add changelog entry to `roadmap/design-system-concepts.md` design log (Entry 26)

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test TabStateBag serialization, settings-api functions, cache read/write | Core logic, edge cases |
| **Integration** | Test Tugcard deactivation/activation lifecycle end-to-end | Tab switch round-trip |
| **Manual** | Verify scroll restore, selection restore, focused card restore after reload | Browser-based verification |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Data Model Extensions {#step-1}

**Commit:** `feat(tugdeck): add collapsed, focusedCardId, and TabStateBag to layout data model`

**References:** [D01] Per-tab state bag, [D03] Focused card reload-only, [D04] Collapsed schema-only, Spec S01, (#d01-tab-state-bag, #d03-focused-card-reload, #d04-collapsed-schema, #s01-tab-state-bag-type)

**Artifacts:**
- Modified `tugdeck/src/layout-tree.ts` — add `TabStateBag` interface, `collapsed?: boolean` to `CardState`, `focusedCardId?: string` to `DeckState`
- Modified `tugdeck/src/serialization.ts` — read/write `collapsed` field in deserialize/serialize

**Tasks:**
- [ ] Add `TabStateBag` interface to `layout-tree.ts` with `scroll?: { x: number; y: number }`, `selection?: SavedSelection | null`, `content?: unknown`. Import `SavedSelection` from `selection-guard.ts`.
- [ ] Add `collapsed?: boolean` to `CardState` interface.
- [ ] Add `focusedCardId?: string` to `DeckState` interface.
- [ ] In `serialization.ts` `deserialize()`: read `collapsed` from raw card object with defensive default (`const collapsed = typeof rawCollapsed === "boolean" ? rawCollapsed : undefined`). Include in the `CardState` pushed to the array (only when `true`, to avoid polluting serialized output).
- [ ] In `serialization.ts` `serialize()`: `collapsed` is already included by spreading `deckState.cards` — verify it passes through. The current `serialize` returns `{ version: 5, cards: deckState.cards }` which spreads the full CardState objects, so `collapsed` will be included automatically.
- [ ] Verify `focusedCardId` on `DeckState` does not need serialization changes — it is persisted separately to tugbank via settings-api, not in the layout blob.

**Tests:**
- [ ] Verify that `deserialize` of a v5 JSON with a card containing `"collapsed": true` produces a `CardState` with `collapsed === true`.
- [ ] Verify that `deserialize` of a v5 JSON without `collapsed` on a card produces a `CardState` where `collapsed` is `undefined` (treated as `false`).
- [ ] Verify that `serialize` of a `DeckState` with a card having `collapsed: true` includes the field in the output.

**Checkpoint:**
- [ ] TypeScript compilation succeeds: `cd tugdeck && npx tsc --noEmit`
- [ ] Existing tests pass: `cd tugdeck && bun test`

---

#### Step 2: Settings API Extensions {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add tab state and deck state tugbank API functions`

**References:** [D01] Per-tab state bag, [D03] Focused card reload-only, [D06] Cache primary, Spec S02, (#s02-settings-api, #d06-cache-primary)

**Artifacts:**
- Modified `tugdeck/src/settings-api.ts` — add `fetchTabStatesWithRetry`, `putTabState`, `fetchDeckStateWithRetry`, `putFocusedCardId`

**Tasks:**
- [ ] Import `TabStateBag` from `layout-tree.ts`.
- [ ] Implement `fetchTabStatesWithRetry(tabIds: string[])`: for each tab ID, fetch `GET /api/defaults/dev.tugtool.deck.tabstate/{tabId}`. Use `Promise.allSettled` to fetch in parallel. Return a `Map<string, TabStateBag>` of successful results. 404s are skipped (no saved state for that tab). Use exponential backoff on 5xx/network errors (same pattern as `fetchLayoutWithRetry`). Since there may be many tabs, use a batch approach: fire all fetches in parallel, collect results, retry only failures.
- [ ] Implement `putTabState(tabId: string, bag: TabStateBag)`: `PUT /api/defaults/dev.tugtool.deck.tabstate/{tabId}` with body `{"kind":"json","value":<bag>}`. Fire-and-forget, log errors to `console.warn`.
- [ ] Implement `fetchDeckStateWithRetry()`: `GET /api/defaults/dev.tugtool.deck.state/focusedCardId`. Returns the string value or `null` on 404. Same retry pattern as `fetchThemeWithRetry`.
- [ ] Implement `putFocusedCardId(focusedCardId: string)`: `PUT /api/defaults/dev.tugtool.deck.state/focusedCardId` with body `{"kind":"string","value":"<id>"}`. Fire-and-forget.

**Tests:**
- [ ] Unit test: `putTabState` sends correct URL and body format (mock `fetch`).
- [ ] Unit test: `fetchDeckStateWithRetry` returns `null` on 404, returns the string value on 200.

**Checkpoint:**
- [ ] TypeScript compilation succeeds: `cd tugdeck && npx tsc --noEmit`
- [ ] Existing tests pass: `cd tugdeck && bun test`

---

#### Step 3: DeckManager Tab State Cache and Focus Persistence {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): add tab state cache and focus persistence to DeckManager`

**References:** [D01] Per-tab state bag, [D03] Focused card reload-only, [D06] Cache primary, Spec S03, (#s03-cache-api, #d03-focused-card-reload, #d06-cache-primary)

**Artifacts:**
- Modified `tugdeck/src/deck-manager.ts` — add `tabStateCache`, `getTabState`, `setTabState`, `initialFocusedCardId`, focus persistence in `focusCard`
- Modified `tugdeck/src/deck-manager-store.ts` — add `getTabState`, `setTabState`, and `initialFocusedCardId` to `IDeckManagerStore`
- Modified `tugdeck/src/components/chrome/deck-canvas.tsx` — add `useEffect` for focused card restoration on reload
- Modified `tugdeck/src/main.tsx` — fetch tab states and deck state in parallel, pass to DeckManager

**Tasks:**
- [ ] Add `private tabStateCache: Map<string, TabStateBag> = new Map()` to `DeckManager`.
- [ ] Add `private tabStateSaveTimer: number | null = null` for debounced tab state saves.
- [ ] Implement `getTabState(tabId: string): TabStateBag | undefined` — return from cache.
- [ ] Implement `setTabState(tabId: string, bag: TabStateBag): void` — write to cache synchronously, then schedule debounced `putTabState` call. Use a separate debounce timer (`tabStateSaveTimer`) from the layout save timer, with the same `SAVE_DEBOUNCE_MS` delay.
- [ ] Add `getTabState` and `setTabState` to `IDeckManagerStore` interface.
- [ ] In `focusCard()`: add `putFocusedCardId(cardId)` **before** the early-return guard (`if (idx === -1 || idx === this.deckState.cards.length - 1) return`). This ensures the focused card ID is persisted even when clicking an already-focused card or in a single-card deck. Guard only against `idx === -1` (card not found) for the PUT call.
- [ ] In `focusCard()`: add `this.scheduleSave()` after `this.notify()` so that the z-order change (card moved to end of array) is persisted to the layout blob. Currently `focusCard` does not call `scheduleSave`, meaning z-order changes are lost on reload. With this change, the layout always reflects the last-focused card at the end of the array, so reload does not need to correct z-order.
- [ ] Update `DeckManager` constructor to accept optional `initialTabStates?: Map<string, TabStateBag>` and `initialFocusedCardId?: string` parameters. Populate `tabStateCache` from `initialTabStates` if provided.
- [ ] Expose `initialFocusedCardId` as a public field on `DeckManager` (and `IDeckManagerStore`) so DeckCanvas can read it. DeckManager does NOT call `makeFirstResponder` itself -- it is a plain class without access to the responder chain.
- [ ] Add `initialFocusedCardId?: string` to `IDeckManagerStore` interface.
- [ ] In `deck-canvas.tsx`: add a `useEffect` that runs on mount, reads `store.initialFocusedCardId`, and if the card exists in the deck, calls: (1) `store.handleCardFocused(focusedCardId)` to update z-order, (2) `setDeselected(false)` to clear canvas deselect state, and (3) `manager.makeFirstResponder(focusedCardId)` via `useRequiredResponderChain()` to set responder focus. Then clear the field on the store (set to `undefined`) so it only fires once. All three calls are needed: `handleCardFocused` updates z-order, `setDeselected` removes the dim overlay, and `makeFirstResponder` routes keyboard events to the card.
- [ ] In `DeckManager.destroy()`: fix both debounce timers to flush before clearing. The existing `destroy()` only cancels the layout `saveTimer` via `clearTimeout` without calling `saveLayout()` — pending layout writes are silently lost. Fix both: (a) if `saveTimer` is pending, call `saveLayout()` before clearing it, and (b) if `tabStateSaveTimer` is pending, call `putTabState` for all dirty cache entries (tracked via `dirtyTabIds` set) before clearing it. This prevents state loss when the user makes changes and closes the app within either debounce window.
- [ ] Update `main.tsx` to use two-phase initialization: (1) fetch layout, theme, and deck state in parallel via `Promise.all` (these three are independent); (2) deserialize the layout to extract all tab IDs from the cards array, then fetch tab states via `fetchTabStatesWithRetry(tabIds)` (this depends on the layout result). Pass all four results (layout, theme, deck state, tab states) to the `DeckManager` constructor.

**Tests:**
- [ ] `getTabState` returns `undefined` for unknown tab ID.
- [ ] `setTabState` followed by `getTabState` returns the saved bag.
- [ ] `focusCard` calls `putFocusedCardId` (mock and verify).

**Checkpoint:**
- [ ] TypeScript compilation succeeds: `cd tugdeck && npx tsc --noEmit`
- [ ] Existing tests pass: `cd tugdeck && bun test`

---

#### Step 4: Tugcard Deactivation Capture {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): capture scroll, selection, and content state on tab deactivation`

**References:** [D01] Per-tab state bag, [D02] Persistence hook, Spec S04, (#lifecycle-flow, #s04-persistence-context, #d01-tab-state-bag, #d02-persistence-hook)

**Artifacts:**
- New file `tugdeck/src/components/tugways/use-tugcard-persistence.tsx` — `TugcardPersistenceCallbacks` interface and `TugcardPersistenceContext` (types and context only; the `useTugcardPersistence` hook is added in Step 6)
- Modified `tugdeck/src/components/tugways/tugcard.tsx` — extend `handleTabSelect` to capture full state bag, add persistence callbacks ref

**Tasks:**
- [ ] Create `use-tugcard-persistence.tsx` with the `TugcardPersistenceCallbacks` interface (`{ onSave: () => unknown; onRestore: (state: unknown) => void }`) and `TugcardPersistenceContext` (`createContext<((callbacks: TugcardPersistenceCallbacks) => void) | null>(null)`). The `useTugcardPersistence` hook function is NOT added yet — it is deferred to Step 6. This file is created now so that `TugcardPersistenceCallbacks` is importable by tugcard.tsx in this step, avoiding a TypeScript compilation failure between Steps 4 and 6.
- [ ] Add `import { useDeckManager } from "../../deck-manager-context"` to tugcard.tsx (not currently imported).
- [ ] Add `import { type TugcardPersistenceCallbacks } from "./use-tugcard-persistence"` to tugcard.tsx.
- [ ] Call `const store = useDeckManager()` at the top of the Tugcard component body.
- [ ] Add a `persistenceCallbacksRef = useRef<TugcardPersistenceCallbacks | null>(null)` to Tugcard.
- [ ] Create a stable `registerPersistenceCallbacks` function via `useCallback` that sets `persistenceCallbacksRef.current`.
- [ ] Extract a `saveCurrentTabState` helper function (stored in a ref for stable access per Rule 5) that captures the full state bag for the current active tab:
  - Read `contentRef.current.scrollLeft` and `contentRef.current.scrollTop` for scroll position.
  - Call `selectionGuard.saveSelection(cardId)` for selection.
  - Call `persistenceCallbacksRef.current?.onSave()` for card content state.
  - Build a `TabStateBag` from the three pieces.
  - Call `store.setTabState(activeTabIdRef.current, bag)`.
- [ ] Update `handleTabSelect` to call `saveCurrentTabState()` before calling `onTabSelect(newTabId)`. Keep the existing `savedSelectionsRef.current.set` write alongside the cache write for now -- the existing `useLayoutEffect([activeTabId])` still reads from `savedSelectionsRef` until Step 5 migrates the restore path. This avoids breaking selection restore between the Step 4 and Step 5 commits.
- [ ] Update `handlePreviousTab` and `handleNextTab` to call `saveCurrentTabState()` before calling `selectFn(targetTabId)`. Currently these handlers call `selectFn` (the raw `onTabSelect` prop via `onTabSelectRef.current`) directly, bypassing the state-saving wrapper. Without this fix, keyboard-driven tab switches would silently lose scroll, selection, and content state.
- [ ] The DeckManager cache is written in parallel with `savedSelectionsRef`. Removal of `savedSelectionsRef` is deferred to Step 5 when the restore path is also migrated.

**Tests:**
- [ ] Verify that switching tabs calls `store.setTabState` with a bag containing scroll position.
- [ ] Verify that switching tabs calls `selectionGuard.saveSelection` and includes the result in the bag.

**Checkpoint:**
- [ ] TypeScript compilation succeeds: `cd tugdeck && npx tsc --noEmit`
- [ ] Existing tests pass: `cd tugdeck && bun test`

---

#### Step 5: Tugcard Activation Restore {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugdeck): restore scroll, selection, and content state on tab activation`

**References:** [D01] Per-tab state bag, [D02] Persistence hook, (#lifecycle-flow, #d01-tab-state-bag, #d02-persistence-hook)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tugcard.tsx` — extend the `useLayoutEffect([activeTabId])` to restore from DeckManager cache

**Tasks:**
- [ ] In the existing `useLayoutEffect([activeTabId])`, replace the `savedSelectionsRef` lookup with `store.getTabState(activeTabId)`.
- [ ] If a `TabStateBag` exists:
  - Restore scroll position directly in the `useLayoutEffect` body: `contentRef.current.scrollLeft = bag.scroll?.x ?? 0; contentRef.current.scrollTop = bag.scroll?.y ?? 0;`. Since `useLayoutEffect` fires before paint, the DOM is already laid out and scroll position can be set synchronously without `requestAnimationFrame`. Avoiding RAF prevents a visible flash where content briefly appears at scroll position 0 before jumping to the restored position.
  - Call `selectionGuard.restoreSelection(cardId, bag.selection)` if `bag.selection` is not null/undefined.
  - Call `persistenceCallbacksRef.current?.onRestore(bag.content)` if `bag.content` is not undefined.
- [ ] Remove `savedSelectionsRef` entirely — both the write path (Step 4 kept dual writes) and the read path are now migrated to the DeckManager cache. This is safe to do in this step because both write and read are migrated atomically in the same commit.
- [ ] Also remove the `savedSelectionsRef` dual-write from `saveCurrentTabState` / `handleTabSelect` that Step 4 kept for backward compatibility.
- [ ] This step also handles first-mount restoration after app reload: if the DeckManager cache was populated from tugbank during initialization, the same `useLayoutEffect` path restores state on first mount.

**Tests:**
- [ ] Verify that after tab activation, scroll position is set on the content area.
- [ ] Verify that after tab activation, `selectionGuard.restoreSelection` is called with the saved selection.
- [ ] Verify that after tab activation, `onRestore` callback is called with saved content state.

**Checkpoint:**
- [ ] TypeScript compilation succeeds: `cd tugdeck && npx tsc --noEmit`
- [ ] Existing tests pass: `cd tugdeck && bun test`

---

#### Step 6: useTugcardPersistence Hook {#step-6}

**Depends on:** #step-5

**Commit:** `feat(tugdeck): add useTugcardPersistence hook for card content state persistence`

**References:** [D02] Persistence hook, Spec S04, Spec S05, (#s04-persistence-context, #s05-persistence-hook, #d02-persistence-hook)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/use-tugcard-persistence.tsx` — add `useTugcardPersistence` hook function (file was created in Step 4 with types and context only)
- Modified `tugdeck/src/components/tugways/tugcard.tsx` — provide `TugcardPersistenceContext` to card content children

**Tasks:**
- [ ] In `use-tugcard-persistence.tsx` (already created in Step 4 with `TugcardPersistenceCallbacks` and `TugcardPersistenceContext`), add the `useTugcardPersistence<T>(options: { onSave: () => T; onRestore: (state: T) => void }): void` function:
    - Read context via `useContext(TugcardPersistenceContext)`.
    - Store `options.onSave` and `options.onRestore` in refs (Rule 5).
    - In `useLayoutEffect` (Rule 3), call the registration function with stable wrappers that read from refs.
    - Return cleanup that unregisters (sets persistence callbacks to null in Tugcard).
- [ ] In `tugcard.tsx`, import `TugcardPersistenceContext` from `use-tugcard-persistence.tsx` and wrap card content children with `<TugcardPersistenceContext value={registerPersistenceCallbacks}>`. Place it inside `TugcardPropertyContext` (or alongside it — both wrap children).

**Tests:**
- [ ] Unit test: `useTugcardPersistence` registers callbacks that are called by Tugcard on deactivation/activation.
- [ ] Unit test: updating `onSave`/`onRestore` refs does not cause re-registration (stable useLayoutEffect).

**Checkpoint:**
- [ ] TypeScript compilation succeeds: `cd tugdeck && npx tsc --noEmit`
- [ ] Existing tests pass: `cd tugdeck && bun test`

---

#### Step 7: Inactive Selection CSS {#step-7}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add inactive selection dimmed background CSS token`

**References:** [D05] Inactive selection dimmed CSS, (#d05-inactive-selection)

**Artifacts:**
- Modified `tugdeck/styles/tug-tokens.css` — add `--tug-base-selection-bg-inactive`
- Modified `tugdeck/styles/bluenote.css` — override for bluenote theme
- Modified `tugdeck/styles/harmony.css` — override for harmony theme
- Modified `tugdeck/src/components/tugways/tugcard.css` — add inactive selection rule

**Tasks:**
- [ ] In `tug-tokens.css`, add `--tug-base-selection-bg-inactive: rgba(128, 128, 128, 0.25)` (low-opacity gray matching macOS inactive window conventions) in the base token section near `--tug-base-selection-bg`. This is the brio theme value (brio uses the base tokens directly, no override needed).
- [ ] In `bluenote.css`, add theme-specific override for `--tug-base-selection-bg-inactive` if needed (may use a slightly different shade for dark theme readability against dark backgrounds).
- [ ] In `harmony.css`, add theme-specific override for `--tug-base-selection-bg-inactive` if needed (harmony is a light theme like brio, so the base value may be sufficient — verify visually).
- [ ] In `tugcard.css`, add rule: `.card-frame[data-focused="false"] .tugcard-content ::selection { background-color: var(--tug-base-selection-bg-inactive); color: inherit; }`. This overrides the active selection color for non-focused cards.

**Tests:**
- [ ] Visual verification: select text in a card, click a different card to unfocus, confirm the selection in the first card shows the dimmed gray background.

**Checkpoint:**
- [ ] TypeScript compilation succeeds: `cd tugdeck && npx tsc --noEmit`
- [ ] Visual inspection in browser confirms inactive selection styling across all three themes.

---

#### Step 8: Integration Checkpoint {#step-8}

**Depends on:** #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [D01] Per-tab state bag, [D02] Persistence hook, [D03] Focused card reload-only, [D04] Collapsed schema-only, [D05] Inactive selection dimmed CSS, (#success-criteria, #lifecycle-flow)

**Tasks:**
- [ ] Verify all steps 1-7 build and tests pass together.
- [ ] Manual end-to-end verification:
  - [ ] Create two cards, each with two tabs. Scroll content in one tab, select text, switch to the other tab, switch back. Verify scroll and selection are restored.
  - [ ] Reload the app. Verify scroll position and selection are restored from tugbank.
  - [ ] Click a card to focus it. Reload the app. Verify the same card regains focus.
  - [ ] Select text in one card, click another card. Verify the first card's selection shows the dimmed background.
  - [ ] Verify `collapsed` field round-trips through serialization (set manually in tugbank, verify it deserializes correctly).

**Tests:**
- [ ] All existing tests pass: `cd tugdeck && bun test`
- [ ] TypeScript compilation clean: `cd tugdeck && npx tsc --noEmit`

**Checkpoint:**
- [ ] `cd tugdeck && npx tsc --noEmit` passes
- [ ] `cd tugdeck && bun test` passes
- [ ] Manual browser verification of all success criteria

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Tab state (scroll, selection, card content state) survives both tab switching and app reload. Focused card is restored on reload. Inactive selections render with a dimmed background. The `collapsed` data field is established for Phase 8a.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Tab switch preserves scroll position (within 1px) — manual verification
- [ ] Tab switch preserves text selection (same anchor/focus) — manual verification
- [ ] `useTugcardPersistence` round-trips card content state through tab switch — unit test or manual verification with a test card
- [ ] App reload restores scroll, selection, and card content state from tugbank — manual verification
- [ ] App reload restores focused card via `makeFirstResponder` — manual verification
- [ ] Non-focused cards show dimmed selection background (`--tug-base-selection-bg-inactive`) — visual verification across all three themes
- [ ] `collapsed?: boolean` on `CardState` serializes and deserializes correctly — unit test
- [ ] All TypeScript compilation clean (`npx tsc --noEmit`)
- [ ] All existing tests pass (`bun test`)

**Acceptance tests:**
- [ ] T01: Switch tabs with scrolled content, verify scroll restoration
- [ ] T02: Switch tabs with text selection, verify selection restoration
- [ ] T03: Reload app, verify scroll and selection restoration from tugbank
- [ ] T04: Reload app, verify focused card restoration
- [ ] T05: Verify inactive selection dimmed background in all themes
- [ ] T06: Verify `collapsed` field round-trips through serialization

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 8a: Collapse UI toggle in title bar (reads/writes `collapsed` field established here)
- [ ] Phase 8/9: Monaco editor state persistence via `useTugcardPersistence` onSave/onRestore with `editor.saveViewState()`/`editor.restoreViewState()`
- [ ] Phase 9: Terminal buffer persistence (xterm.js buffer state via `useTugcardPersistence`)
- [ ] Performance optimization: batch tugbank writes for multiple tab state changes
- [ ] Orphaned tab state cleanup: delete cache entries and fire DELETE to tugbank when tabs are removed via `_removeTab`. Deferred because orphaned entries are small and harmless.
- [ ] Tugbank "list keys in domain" endpoint to avoid needing tab ID list for `fetchTabStatesWithRetry`

| Checkpoint | Verification |
|------------|--------------|
| Data model fields present | `npx tsc --noEmit` compiles with new fields |
| Settings API functions work | Unit tests for fetch/put functions |
| Tab state cache works | `getTabState`/`setTabState` round-trip |
| Deactivation capture works | Tab switch saves scroll + selection + content |
| Activation restore works | Tab switch restores scroll + selection + content |
| Reload restore works | App reload restores all state from tugbank |
| Inactive selection CSS works | Visual inspection across three themes |
