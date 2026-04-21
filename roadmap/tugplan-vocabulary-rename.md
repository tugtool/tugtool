<!-- tugplan-skeleton v2 -->

## Vocabulary Rename — Window / Card / CardHost {#vocabulary-rename}

**Purpose:** Retire the overloaded "card/stack/tab" vocabulary and adopt a clearer three-word model: a Deck holds Windows; a Window holds one or more Cards; a tab bar appears when a Window has more than one Card. `StackFrame` / `Tugcard` merge into a single `TugWindow` component. `CardContentHost` becomes `CardHost`. Source, DOM, CSS, wire format, and Swift menu text all converge on the new names.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-04-21 |
| Predecessor | [tugplan-lifecycle-delegates.md](./tugplan-lifecycle-delegates.md) (Step 11.6.1a introduced the Card/CardStack split) |
| Related audit | [lifecycle-and-portal-audit.md](./lifecycle-and-portal-audit.md) §P1–P3 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Card/CardStack split that landed with the portal re-architecture (Step 11.6.1a) introduced the right decomposition — content identity separated from visual framing — but the names used to describe the decomposition are overloaded and in places wrong. "Card" now means three different things in source (the content identity, the visual frame, the chrome that holds the content). "Stack" means something specific and unrelated in computer science. "StackFrame" especially means a call-stack activation record to any Rust / C / Swift programmer, which is what we use all day. The DOM keeps the pre-split vocabulary (`data-card-id` on the frame is actually a stackId; `data-tab-id` on the content host is actually a cardId). Readers pay a confusion tax on every file.

The fix is a coherent vocabulary:

- **Deck** — the canvas (unchanged).
- **Window** — the visual container with position, size, z-index, drag, resize. Holds one or more Cards. Shows one at a time. A tab bar appears when it holds more than one.
- **Card** — the content identity. A `tide` card, a `hello` card, a `gallery-buttons` card. Has componentId, title, state bag. Knows nothing about portals, position, or size.
- **Tab** — UI vocabulary only. The affordance that appears on a Window with multiple Cards. Not a data concept.

This plan lands the rename across source, DOM, CSS, wire format, and Swift menu text. It also takes the opportunity to merge `StackFrame` and `Tugcard` into a single `TugWindow` component, since the two-component split ([D03] appearance-zone / content-chrome separation) was motivated by concerns that refs-based drag state already satisfies without the split.

#### Strategy {#strategy}

- **Phased, one rename-class per commit.** Data model → store API → registries → contexts → component rename → component merge → CardHost rename → DOM/CSS → action constants → Swift wire → Swift menu text → docs. Every commit is green: `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run`.
- **`Tug` prefix for types and components.** `TugWindow` the component, `TugWindowState` the type. Matches the house pattern (`Tugcard`, `TugBox`, `TugPushButton`). Avoids shadowing the browser `Window` global.
- **Merge `StackFrame` + `Tugcard` into one `TugWindow` component.** The original separation was motivated by appearance-zone drag concerns; those concerns are handled by ref-based drag state and don't require a component boundary.
- **Bump serialized layout version 2 → 3.** The on-disk field `stacks` becomes `windows`; `activeStackId` becomes `activeWindowId`. In-place v2→v3 migration is a field rename. v1 legacy support stays.
- **Tugbank row prefix `tabstate/{id}` stays.** The `{id}` is already the cardId; the prefix is historical and invisible to users. Renaming the prefix would force a data migration that buys nothing.
- **Swift user-facing menu text follows.** "Add Tab" / "Close Tab" become "Add Card" / "Close Card." Users call them windows and cards in our mental model; the menu should match.
- **Document the decisions in the audit doc.** The audit at `roadmap/lifecycle-and-portal-audit.md` gets a "Vocabulary decisions from 2026-04-21" section pointing at this plan; the existing audit text stays as written.

#### Success Criteria (Measurable) {#success-criteria}

- `rg "CardStackState|stackRootRegistry|cardContentRegistry|StackFrame|Tugcard\b" tugdeck/src` returns zero matches. (Mechanical grep.)
- `rg "data-card-id" tugdeck/src` matches only content hosts (the real cards), not frames. `rg "data-window-id"` exists and names stack frames. `rg "data-tab-id"` returns zero matches.
- `rg "\.card-frame\b|\.tugcard-content\b" tugdeck` returns zero matches; `.tug-window` and `.tug-window-content` exist in their place.
- `rg "addCardToStack|setActiveCardInStack|reorderCardInStack|detachCard.*stackId|moveCardToStack|toggleStackCollapse|handleStackMoved|handleStackClosed|_closeStack|activeStackId" tugdeck/src` returns zero matches.
- Swift: `rg "focus-card|Add Tab|Close Tab|stackId" tugapp/Sources` returns zero matches (except unrelated stack-trace / menu comments).
- `DeckState` serialized with `version: 3` writes a blob with `windows` / `activeWindowId`; loading a saved `version: 2` blob migrates to the new shape.
- Every step commit: `bun x tsc --noEmit` clean, `bun test` green, `bun run audit:tokens lint` zero violations, `cargo nextest run` green.
- Manual: every tide-card smoke path from the prior plan's success criteria still passes (open, click-switch, detach, merge, close, reload).

#### Scope {#scope}

1. Data model type + field rename (`CardStackState` → `TugWindowState`; `DeckState.stacks` → `DeckState.windows`; `activeStackId` → `activeWindowId`).
2. Serialization v2 → v3 with in-place migration.
3. Store API method rename (`addCardToStack` → `addCardToWindow`, and the six sibling mutators).
4. Registry file + key rename (`card-content-registry` → `window-content-registry`; `stack-root-registry` → `window-root-registry`; keys `stackId` → `windowId`).
5. Context rename (`TugcardPortalContext` → `TugWindowPortalContext`; dirty/property/persistence contexts drop the `Tugcard` prefix).
6. Component rename: `StackFrame` → `TugWindow` (file, exports, props types; no structural change).
7. Component merge: absorb `Tugcard` into `TugWindow`; delete `tug-card.tsx`.
8. `CardContentHost` → `CardHost` (file, exports).
9. DOM attribute + CSS class rename (`data-card-id` on frames → `data-window-id`; `data-tab-id` on hosts → `data-card-id`; `.card-frame` → `.tug-window`; `.tugcard-content` → `.tug-window-content`).
10. Action constant rename (`ADD_TAB_TO_ACTIVE_CARD` → `ADD_CARD_TO_ACTIVE_WINDOW`).
11. Swift wire contract (`focus-card` with `stackId` → `focus-window` with `windowId`).
12. Swift menu text ("Add Tab" → "Add Card"; "Close Tab" → "Close Card").
13. Audit doc update in `lifecycle-and-portal-audit.md`.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Tugbank row prefix `tabstate/{id}` — keep the on-disk prefix. The key is already cardId; only the prefix carries the historical name. Renaming buys no user value.
- Window-level lifecycle events (`windowWillResize`, `windowWillClose`, etc.). Lifecycle events stay on cards. Add window-level events later if and when a subscriber asks for them.
- Merging `CardHost` with any other component. The separation between Window chrome and per-card state anchor is useful.
- Rewriting the lifecycle-delegates plan or the 11.6.1a portal plan to match the new vocabulary. Those documents become historical once closed; future plans use the new vocabulary.
- Component decomposition of the new `TugWindow` or `CardHost` (their internal hooks refactor is a separate future step — see audit P6).

#### Dependencies / Prerequisites {#dependencies}

- Green HEAD on main. All tests passing (2292/2292 at start of this plan).
- No in-flight work on `deck-manager.ts`, `deck-canvas.tsx`, `tug-card.tsx`, `stack-frame.tsx`, `card-content-host.tsx`, or the registries. (Currently the working tree has uncommitted changes in `tide-card.*` and `picker-notice-store.ts` — those are in a different subsystem and should not block this plan, but pre-step cleanup is on Ken.)

#### Constraints {#constraints}

- Warnings-are-errors (`-D warnings`) across Rust. TypeScript strict mode across tugdeck.
- Every commit must be independently reviewable and green.
- Phased execution — don't stack unrelated renames inside one commit.

#### Assumptions {#assumptions}

- No external consumer depends on the serialized-layout wire format beyond Swift and tugbank itself (both owned by this repo).
- Persisted layouts in the wild are `version: 2`; the v1 migration path is exercised by tests but not expected in production.

---

### Design Decisions {#design-decisions}

#### [D01] Data type uses `Tug` prefix (DECIDED) {#d01-tug-prefix}

**Decision:** The TypeScript type is `TugWindowState`; the component is `TugWindow`.

**Rationale:**
- Matches the house convention (`Tugcard`, `TugBox`, `TugBanner`, `TugPushButton`, `TugConnection`, …).
- Avoids shadowing the DOM-level `Window` global type.
- `Tug` is the project brand; types and components that belong to the project should carry it.

**Implications:** Variables named `window` in our code continue to refer to the browser global. Our data takes names like `windowId`, `win`, or `targetWindow` where disambiguation matters.

#### [D02] Merge `StackFrame` + `Tugcard` into one component (DECIDED) {#d02-merge-window}

**Decision:** `TugWindow` is one component that owns position, size, drag, resize, z-index, title bar, tab bar, collapse, close, content div, responder scope, and selection boundary. `Tugcard` goes away as a component name and file.

**Rationale:**
- The original `[D03]` separation was motivated by appearance-zone drag concerns. Those concerns are already handled by ref-based drag state — the outer component mutates `frame.style.*` in a rAF callback; the inner component doesn't re-render during drag either way.
- One component is easier to read as "this is a window." Two components with `renderContent(injected)` coupling is harder to reason about than it needs to be.
- The merge happens once; maintaining the boundary costs every reader every time.

**Implications:** ~950 lines (sum of current `stack-frame.tsx` + `tug-card.tsx`) land in one file. The file ends up large but internally coherent. A further decomposition into internal hooks (`useWindowDrag`, `useWindowResize`, `useWindowTabBar`) is a follow-on refactor, not part of this rename.

#### [D03] Serialized layout bumps to `version: 3` (DECIDED) {#d03-v3}

**Decision:** `serialize()` emits `version: 3` blobs with the new field names (`windows`, `activeWindowId`). `deserialize()` reads `version: 3` directly; `version: 2` triggers an in-place field rename migration. v1 legacy support stays unchanged.

**Rationale:**
- On-disk field names matching in-memory field names is the only regime that stays coherent over time.
- v2→v3 migration is a trivial field rename; no semantic changes.
- A bump to v3 makes the break visible in tests, and anyone who writes code that reads a layout blob directly sees the new shape.

**Implications:** `serialization.ts` gets a `parseV3` function; `parseV2` becomes `migrateV2ToV3`. The v1 `migrateV1ToV2` stays as-is and chains into v2→v3 implicitly by emitting v3 directly.

#### [D04] Swift menu text follows internal vocabulary (DECIDED) {#d04-menu-text}

**Decision:** Swift menu items "Add Tab to Active Card" → "Add Card to Active Window"; "Close Tab" → "Close Card"; equivalent keybindings unchanged.

**Rationale:**
- Users and source converge on one vocabulary. A user who asks "what is this?" and a developer who reads the code see the same words.
- Macos Finder and Safari call them windows and tabs, where each tab has a distinct content identity. Our model matches — cards are the content; tabs are the UI affordance. Saying "Add Card" at the menu level is honest.

**Implications:** The menu label change is one Swift commit. Keybindings, menu groupings, and keyboard shortcuts stay the same.

#### [D05] Tugbank row prefix stays `tabstate/` (DECIDED) {#d05-tabstate-prefix}

**Decision:** Do not rename the `tabstate/{id}` prefix in tugbank. The `{id}` is already the cardId (identity was preserved during Step 11.6.1a); only the historical prefix carries the old word.

**Rationale:**
- Renaming the prefix would force a data migration for users who have any persisted per-card state.
- The prefix is invisible to users and to anything except tugbank internals.
- A dedicated cleanup step can rename the prefix later if it ever matters; coupling it to this rename adds risk without benefit.

**Implications:** A JSDoc comment on the tugbank-writing functions notes that the prefix is historical.

---

### Risks and Mitigations {#risks}

**Risk R01: Drag coordinator selectors break silently** {#r01-selector-drift}

- **Risk:** `card-drag-coordinator` queries `.card-frame[data-card-id]` and `.tug-tab-bar[data-card-id]`. The rename changes both the class and the attribute. Miss either, and drag silently stops working.
- **Mitigation:** Pair the DOM attribute rename with the selector rename in the same commit (#step-9). Add a manual smoke test to the step's checkpoint.
- **Residual risk:** Zero after checkpoint passes; smoke test covers the path that automated tests cover least reliably.

**Risk R02: v2→v3 migration loses a field** {#r02-migration-drop}

- **Risk:** The migration is a field rename, but a typo could drop `activeStackId` or `collapsed` silently.
- **Mitigation:** Add a serialization round-trip test that feeds a hand-authored v2 blob through `deserialize()` and asserts the resulting DeckState matches a hand-authored v3 equivalent. Ship in #step-2.
- **Residual risk:** Very low; the test pins every field.

**Risk R03: Swift / TS wire contract mismatch** {#r03-swift-mismatch}

- **Risk:** Swift sends `focus-card` with `stackId` after TS renames to `focus-window` with `windowId`, or vice versa. The handler warns and no-ops; the user sees a silent no-op when picking from the View menu.
- **Mitigation:** Rename both sides in one commit (#step-11). Manual smoke: launch Tug.app, pick a window from View menu, verify activation.
- **Residual risk:** Low; both sides are in this repo and can be changed atomically.

---

### Execution Steps {#execution-steps}

#### Step 1: Data model type + field rename {#step-1}

**Commit:** `Rename CardStackState → TugWindowState and DeckState.stacks → DeckState.windows`

**References:** [D01] Tug prefix, (#context, #strategy)

**Artifacts:**
- `tugdeck/src/layout-tree.ts` — type rename, field rename, `validateDeckState` error messages updated.
- Consumers across `tugdeck/src/**/*.ts` — type imports, field accesses.
- Tests — mechanical find/replace.

**Tasks:**
- [x] Rename type `CardStackState` → `TugWindowState` in `layout-tree.ts`.
- [x] Rename `DeckState.stacks` → `DeckState.windows`.
- [x] Rename `DeckState.activeStackId` → `DeckState.activeWindowId`.
- [x] Update local variable conventions: `stack` → `win` where the variable is a `TugWindowState`.
- [x] Update `validateDeckState` error message strings to say "window" / "windows."
- [x] Method names keep their existing form (`addCardToStack`, etc.) — renamed in #step-3.
- [x] Internal variables named `stackId` keep their form for now — renamed in later steps as they propagate.

**Tests:**
- [x] Existing `layout-tree.test.ts` passes with the renamed types.
- [x] `deck-manager.test.ts` passes.

**Checkpoint:**
- [x] `bun x tsc --noEmit` clean.
- [x] `bun test` green at existing count.
- [x] `rg "CardStackState" tugdeck/src` returns zero matches.

---

#### Step 2: Serialization v2 → v3 with migration {#step-2}

**Depends on:** #step-1

**Commit:** `Emit serialized layout as version 3 with in-place v2→v3 migration`

**References:** [D03] v3 bump, Risk R02

**Artifacts:**
- `tugdeck/src/serialization.ts` — `serialize` emits `version: 3` with `windows` field; `parseV3` replaces `parseV2`; `migrateV2ToV3` replaces the v2-shape branch.
- Tests — new round-trip asserting v2 blobs load, v3 blobs round-trip.

**Tasks:**
- [x] Rename `parseV2` → `parseV3` and update the serialized field names read.
- [x] Add `migrateV2ToV3` that converts `stacks` → `windows` and `activeStackId` → `activeWindowId`.
- [x] `serialize()` emits `version: 3`.
- [x] `deserialize()` dispatch: `version === 3` → `parseV3`; `version === 2` → `migrateV2ToV3` then return the migrated shape; any other non-v3 with an array `cards` → v1 migration chain (same as today).

**Tests:**
- [x] Round-trip test: v3 blob → deserialize → serialize → identical shape.
- [x] Migration test: hand-authored v2 blob → deserialize → expected v3 DeckState (new field names, everything else preserved).
- [x] Existing v1 migration test still passes.

**Checkpoint:**
- [x] `bun x tsc --noEmit` clean.
- [x] `bun test` green (existing + 2 new).

---

#### Step 3: Store API method rename {#step-3}

**Depends on:** #step-2

**Commit:** `Rename store API: addCardToStack → addCardToWindow (and siblings)`

**References:** [D01] Tug prefix, (#context)

**Artifacts:**
- `tugdeck/src/deck-manager.ts` — public method + parameter renames.
- `tugdeck/src/deck-manager-store.ts` — `IDeckManagerStore` interface.
- `tugdeck/src/__tests__/mock-deck-manager-store.ts` — matching rename.
- Every consumer: `deck-canvas.tsx`, `card-drag-coordinator.ts`, `action-dispatch.ts`, `tug-card.tsx`, `card-content-host.tsx`, tests.

**Rename table:**

| Today | New |
|---|---|
| `addCardToStack(stackId, componentId)` | `addCardToWindow(windowId, componentId)` |
| `setActiveCardInStack(stackId, cardId)` | `setActiveCardInWindow(windowId, cardId)` |
| `reorderCardInStack(stackId, from, to)` | `reorderCardInWindow(windowId, from, to)` |
| `detachCard(stackId, cardId, position)` | `detachCard(windowId, cardId, position)` |
| `moveCardToStack(srcId, cardId, tgtId, idx)` | `moveCardToWindow(srcId, cardId, tgtId, idx)` |
| `toggleStackCollapse(stackId)` | `toggleWindowCollapse(windowId)` |
| `moveStack(stackId, pos, size)` | `moveWindow(windowId, pos, size)` |
| `handleStackMoved` | `handleWindowMoved` |
| `handleStackClosed` / `_closeStack` | `handleWindowClosed` / `_closeWindow` |
| `addCard(componentId)` | unchanged |
| `getFirstResponderCardId()` | unchanged |

**Tasks:**
- [ ] Rename every method in the table across `deck-manager.ts`, the interface, and the mock.
- [ ] Rename parameter names `stackId` → `windowId` on all renamed methods.
- [ ] Update every call site.
- [ ] Update JSDoc to refer to windows/cards.

**Tests:**
- [ ] Every existing `deck-manager.test.ts`, `deck-canvas.test.tsx`, `card-drag-coordinator.test.ts`, `card-header.test.tsx`, and `e2e-responder-chain.test.tsx` test passes under the new names.

**Checkpoint:**
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `rg "addCardToStack|setActiveCardInStack|reorderCardInStack|toggleStackCollapse|moveStack\b|handleStackMoved|handleStackClosed|_closeStack|moveCardToStack" tugdeck/src` returns zero matches.

---

#### Step 4: Registry files + key rename {#step-4}

**Depends on:** #step-3

**Commit:** `Rename card-content-registry → window-content-registry (and stack-root-registry → window-root-registry)`

**References:** [D01] Tug prefix, (#context)

**Artifacts:**
- File rename: `tugdeck/src/components/chrome/card-content-registry.ts` → `window-content-registry.ts`.
- File rename: `tugdeck/src/components/chrome/stack-root-registry.ts` → `window-root-registry.ts`.
- Consumers: `card-portal.tsx`, `card-content-host.tsx`, `tug-card.tsx`, tests.

**Tasks:**
- [ ] Rename both files.
- [ ] Rename keys: every `stackId` parameter in `register`/`unregister`/`getElement`/`subscribe` → `windowId`.
- [ ] Update JSDoc to reference windows, not stacks.
- [ ] Update every import.

**Tests:**
- [ ] `card-content-registry.test.ts` renamed to `window-content-registry.test.ts`; tests pass.
- [ ] `card-portal.test.tsx` passes.

**Checkpoint:**
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `rg "card-content-registry|stack-root-registry" tugdeck/src` returns zero matches.

---

#### Step 5: Context rename {#step-5}

**Depends on:** #step-4

**Commit:** `Rename Tugcard contexts: TugcardPortalContext → TugWindowPortalContext, others drop Tugcard prefix`

**References:** [D01] Tug prefix

**Artifacts:**
- `tugdeck/src/components/tugways/tug-card.tsx` — context exports renamed.
- `tugdeck/src/components/tugways/use-tugcard-persistence.ts` — context renamed.
- `tugdeck/src/components/tugways/hooks/use-property-store.ts` — if defined there, renamed.
- Consumers updated.

**Rename table:**

| Today | New |
|---|---|
| `TugcardPortalContext` | `TugWindowPortalContext` |
| `TugcardDirtyContext` | `CardDirtyContext` |
| `TugcardPropertyContext` | `CardPropertyContext` |
| `TugcardPersistenceContext` | `CardPersistenceContext` |

**Tasks:**
- [ ] Rename each context export at its definition site.
- [ ] Update every consumer import and Provider usage.
- [ ] Note in JSDoc: `TugWindowPortalContext` provides the window's root element (used by sheet/tooltip portals that need to attach inside the window's frame).

**Tests:**
- [ ] Every existing test that mounts a card body (tide, gallery, etc.) continues to pass.

**Checkpoint:**
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `rg "TugcardPortalContext|TugcardDirtyContext|TugcardPropertyContext|TugcardPersistenceContext" tugdeck/src` returns zero matches.

---

#### Step 6: Rename `StackFrame` → `TugWindow` (file + exports only) {#step-6}

**Depends on:** #step-5

**Commit:** `Rename StackFrame → TugWindow (file and exports; structure unchanged)`

**References:** [D01] Tug prefix

**Artifacts:**
- File rename: `tugdeck/src/components/chrome/stack-frame.tsx` → `tug-window.tsx`.
- Component export: `StackFrame` → `TugWindow`.
- Props type: `StackFrameProps` / `StackFrameInjectedProps` → `TugWindowProps` / `TugWindowInjectedProps`.
- Consumers: `deck-canvas.tsx` and any test.

**Tasks:**
- [ ] Rename the file.
- [ ] Rename `StackFrame` → `TugWindow` at the export.
- [ ] Rename `StackFrameProps` → `TugWindowProps`; `StackFrameInjectedProps` → `TugWindowInjectedProps`.
- [ ] Keep the internal structure: `TugWindow` still renders `Tugcard` via `renderContent(injected)`. The merge happens in #step-7.
- [ ] Update every import and JSX usage.

**Tests:**
- [ ] `stack-frame.test.tsx` (if exists) renamed to `tug-window.test.tsx`; tests pass.
- [ ] `deck-canvas.test.tsx` passes.

**Checkpoint:**
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `rg "StackFrame\b|stack-frame" tugdeck/src` returns zero matches.

---

#### Step 7: Merge `Tugcard` into `TugWindow` {#step-7}

**Depends on:** #step-6

**Commit:** `Merge Tugcard into TugWindow; delete tug-card.tsx`

**References:** [D02] Merge window, Risk R01

**Artifacts:**
- `tugdeck/src/components/chrome/tug-window.tsx` — absorbs `Tugcard`'s body.
- `tugdeck/src/components/tugways/tug-card.tsx` — deleted.
- `tugdeck/src/components/chrome/deck-canvas.tsx` — renders `<TugWindow>` directly with its full prop set; no `renderContent` pass-through.
- Consumers that imported `Tugcard`, `CARD_TITLE_BAR_HEIGHT`, `TugcardPortalContext`, `TugcardDirtyContext`, etc. — re-point to their new homes (`tug-window.tsx`, or wherever the contexts landed in #step-5).

**Tasks:**
- [ ] Absorb `Tugcard`'s render (title bar, tab bar, content div, responder scope, selection boundary) into `TugWindow`'s render.
- [ ] Inline what was `renderContent(injected)` — `TugWindow` already owns the injected callbacks; no closure needed.
- [ ] Move `CARD_TITLE_BAR_HEIGHT` constant to `tug-window.tsx` (or a new `tug-window-constants.ts`).
- [ ] Move `TugcardPortalContext` and the other contexts to `tug-window.tsx` (or keep them in the module they moved to in #step-5).
- [ ] Delete `tug-card.tsx`.
- [ ] Update every import.

**Tests:**
- [ ] Every test that rendered `<Tugcard>` directly is updated to render `<TugWindow>` with the prop surface.
- [ ] Existing drag, resize, collapse, close, tab-switch tests pass.
- [ ] Identity-preservation tests pass — the merge does not change portal mechanics.

**Checkpoint:**
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green (existing count preserved).
- [ ] `rg "Tugcard\b|tug-card" tugdeck/src` returns zero matches (inside `tugdeck/src`; tuglaws and roadmap docs stay historical).
- [ ] Manual smoke: open tide card, click its title bar — active. Drag the frame — position commits. Resize from a corner — size commits. Collapse / expand — works. Add a card to make it multi-card — tab bar appears. Click a tab — switches.

---

#### Step 8: `CardContentHost` → `CardHost` {#step-8}

**Depends on:** #step-7

**Commit:** `Rename CardContentHost → CardHost`

**References:** [D01] Tug prefix, (#context)

**Artifacts:**
- File rename: `tugdeck/src/components/chrome/card-content-host.tsx` → `card-host.tsx`.
- Component export: `CardContentHost` → `CardHost`.
- Props type: `CardContentHostProps` → `CardHostProps`.
- Consumer: `deck-canvas.tsx`.
- Test file rename: `card-content-host.test.tsx` → `card-host.test.tsx`.

**Tasks:**
- [ ] File rename.
- [ ] Export and prop-type renames.
- [ ] Update `deck-canvas.tsx` import + JSX.
- [ ] Update test file + imports.

**Checkpoint:**
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `rg "CardContentHost|card-content-host" tugdeck/src` returns zero matches.

---

#### Step 9: DOM attributes + CSS class rename {#step-9}

**Depends on:** #step-8

**Commit:** `Rename DOM attributes and CSS classes: data-window-id, data-card-id, .tug-window`

**References:** [D01] Tug prefix, Risk R01

**Artifacts:**
- `tug-window.tsx` — `data-card-id={id}` on the outer frame → `data-window-id={id}`. `.card-frame` CSS class → `.tug-window`. `.tugcard-content` div → `.tug-window-content`.
- `card-host.tsx` — `data-tab-id={cardId}` on the wrapper → `data-card-id={cardId}`.
- `card-drag-coordinator.ts` — selectors `.card-frame[data-card-id]` → `.tug-window[data-window-id]`. Any selector reading `data-tab-id` updated to read `data-card-id`.
- CSS: `chrome.css` (or wherever `.card-frame` / `.tugcard-content` live) — class rename.
- Tests — any `screen.getByTestId` / `getAttribute` that references the old names.

**Tasks:**
- [ ] Rename `data-card-id` → `data-window-id` on the frame; keep `data-testid="card-frame"` as `data-testid="tug-window"`.
- [ ] Rename `data-tab-id` → `data-card-id` on the card host wrapper.
- [ ] Rename `.card-frame` → `.tug-window` in CSS and JSX className.
- [ ] Rename `.tugcard-content` → `.tug-window-content` in CSS and JSX className.
- [ ] Update `card-drag-coordinator` and `tug-window`'s internal `dragTabBarCache` / `snapshotCardRects` query selectors.
- [ ] Update every test that reads these attributes or classes.

**Tests:**
- [ ] Drag tests in `stack-frame.test.tsx` (now `tug-window.test.tsx`) pass.
- [ ] Merge tests in `card-drag-coordinator.test.ts` pass.
- [ ] Identity preservation tests pass.

**Checkpoint:**
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `rg "data-tab-id\b|data-card-id=\{(stackId|id)\}|\.card-frame\b|\.tugcard-content\b" tugdeck` returns zero matches.
- [ ] Manual smoke: drag a card tab onto another window's tab bar — merges. Drag a window frame — position commits.

---

#### Step 10: Action constant rename {#step-10}

**Depends on:** #step-9

**Commit:** `Rename ADD_TAB_TO_ACTIVE_CARD → ADD_CARD_TO_ACTIVE_WINDOW`

**References:** (#context, #strategy)

**Artifacts:**
- `tugdeck/src/components/tugways/action-vocabulary.ts` — constant rename.
- `tugdeck/src/action-dispatch.ts` — handler registration uses new constant name.
- `tugdeck/src/components/chrome/deck-canvas.tsx` — TUG_ACTIONS usage.
- `tugapp/Sources/AppDelegate.swift` — `sendControl("add-tab-to-active-card")` → `sendControl("add-card-to-active-window")`.
- Tests — any test that references the old constant name or wire string.

**Tasks:**
- [ ] Rename `ADD_TAB_TO_ACTIVE_CARD` → `ADD_CARD_TO_ACTIVE_WINDOW`.
- [ ] Wire string: `"add-tab-to-active-card"` → `"add-card-to-active-window"` on both sides.
- [ ] Update tests.

**Checkpoint:**
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] `cargo nextest run` green.
- [ ] `rg "add-tab-to-active-card|ADD_TAB_TO_ACTIVE_CARD" tugdeck/src tugapp/Sources` returns zero matches.

---

#### Step 11: Swift wire `focus-card` → `focus-window` {#step-11}

**Depends on:** #step-10

**Commit:** `Rename focus-card wire action → focus-window with windowId`

**References:** Risk R03

**Artifacts:**
- `tugdeck/src/action-dispatch.ts` — rename `registerAction("focus-card", …)` → `registerAction("focus-window", …)`. Payload field `stackId` → `windowId`.
- `tugapp/Sources/AppDelegate.swift` — `sendControl("focus-card", ["stackId": id])` → `sendControl("focus-window", ["windowId": id])`. Any View-menu binding.

**Tasks:**
- [ ] TS handler renamed; payload read updated.
- [ ] Swift send-site renamed and payload key updated.
- [ ] If `pushCardListToHost` emits a `focused` flag keyed by stack id, no change (the shape still carries a window id; the key name stays `id` by convention).

**Checkpoint:**
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test` green.
- [ ] Manual smoke: launch Tug.app, open View menu, pick a window — target window activates, tide prompt regains focus.

---

#### Step 12: Swift menu text rename {#step-12}

**Depends on:** #step-11

**Commit:** `Rename Swift menu items: Add Tab → Add Card, Close Tab → Close Card`

**References:** [D04] Menu text

**Artifacts:**
- `tugapp/Sources/AppDelegate.swift` — menu item titles.
- `tugapp/Sources/MainMenu.swift` (or wherever the menu is defined) — titles.

**Tasks:**
- [ ] "Add Tab to Active Card" → "Add Card to Active Window" (or shorter "New Card in Active Window" / "Add Card" — pick the shortest natural phrasing).
- [ ] "Close Tab" → "Close Card".
- [ ] Keybindings unchanged.

**Checkpoint:**
- [ ] Tug.app builds and runs.
- [ ] Manual smoke: File → "Add Card" works; File → "Close Card" works; ⌘T / ⌘W unchanged.

---

#### Step 13: Update audit doc with vocabulary decisions {#step-13}

**Depends on:** #step-12

**Commit:** `Document vocabulary decisions in lifecycle-and-portal-audit.md`

**References:** [D01] Tug prefix, [D02] Merge window, [D03] v3 bump, [D04] Menu text, [D05] Tabstate prefix

**Artifacts:**
- `roadmap/lifecycle-and-portal-audit.md` — new section "Vocabulary decisions (2026-04-21)" noting the outcome of this rename and linking to this plan.

**Tasks:**
- [ ] Append a short section at the end of the audit doc pointing at `tugplan-vocabulary-rename.md` for the detail, and listing the now-resolved audit items (P1: DOM vocabulary, P2: registry file rename, P3: CSS class rename).
- [ ] Mark P1 / P2 / P3 as resolved in the audit's recommended-follow-up lists.
- [ ] Leave the other audit items (L1–L10, P4–P13) as open; they are out of scope for this plan.

**Checkpoint:**
- [ ] Audit doc reads coherently end-to-end.

---

#### Step 14: Integration checkpoint {#step-14}

**Depends on:** #step-9, #step-10, #step-11, #step-12, #step-13

**Commit:** `N/A (verification only)`

**References:** (#success-criteria)

**Tasks:**
- [ ] Verify every success criterion passes.
- [ ] Manual full smoke: open tide, add card, click-switch, detach, merge, resize, collapse, close, Cmd-Tab away / back, Cmd-H / unhide, reload.

**Checkpoint:**
- [ ] `bun run check` clean.
- [ ] `bun test` green.
- [ ] `bun run audit:tokens lint` zero violations.
- [ ] `cargo nextest run` green.
- [ ] Grep sweep:
  - `rg "CardStackState|StackFrame|Tugcard\b|stack-frame|tug-card\b|card-content-registry|stack-root-registry|data-tab-id|\.card-frame\b|\.tugcard-content\b|addCardToStack|setActiveCardInStack|moveCardToStack|toggleStackCollapse|handleStackMoved|handleStackClosed|_closeStack|activeStackId|ADD_TAB_TO_ACTIVE_CARD|focus-card\b" tugdeck/src tugapp/Sources`
  - expected: zero matches.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Source, DOM, CSS, wire contract, and Swift menu text all use the new vocabulary: Deck holds Windows; Windows hold Cards; Tabs are UI affordance on multi-card Windows. `TugWindow` is the single component for a window; `CardHost` is the per-card React anchor.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] All 13 rename steps committed; integration checkpoint (#step-14) passes.
- [ ] Grep sweep from #step-14 shows zero old-vocabulary matches in `tugdeck/src` and `tugapp/Sources`.
- [ ] Manual smoke matrix from the lifecycle-delegates plan Success Criteria still passes under the new vocabulary.
- [ ] `lifecycle-and-portal-audit.md` updated to mark P1–P3 resolved and to reference this plan.

**Acceptance tests:**
- [ ] Existing 2292 tests green at HEAD.
- [ ] v2 → v3 migration round-trip test passes.
- [ ] Identity preservation under drag / detach / merge / close / reload — unchanged from before the rename.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Internal decomposition of `TugWindow` into hooks (`useWindowDrag`, `useWindowResize`, `useWindowTabBar`) — see audit P6 analogue.
- [ ] Rename tugbank row prefix `tabstate/` → `cardstate/` if a user-facing reason surfaces (not now — see [D05]).
- [ ] Document new vocabulary in `tuglaws/framework-architecture.md` and author new tuglaws docs for window / card / app lifecycle.

---

### Open Questions {#open-questions}

*(All plan-authoring open questions resolved. Decisions recorded as [D01]–[D05].)*
