<!-- tugplan-skeleton v2 -->

## Tab Bar Overflow — Progressive Collapse and Overflow Dropdown {#tab-overflow}

**Purpose:** TugTabBar handles overflow gracefully via two-stage progressive collapse: inactive tabs collapse to icon-only first, then excess tabs move into an overflow dropdown, keeping the active tab and [+] button always visible.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5b4-tab-overflow |
| Last updated | 2026-03-04 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

TugTabBar currently uses `overflow-x: auto` with a hidden scrollbar to handle excess tabs. This is a poor experience: tabs scroll off-screen with no visual indication, and users have no way to discover or access hidden tabs. Phase 5b4 replaces this with a two-stage progressive collapse that keeps all tabs accessible. This work is purely presentational and local to TugTabBar — no changes to layout-tree.ts, serialization.ts, or DeckManager are needed.

The existing tab bar component (from Phase 5b) and the TugDropdown component provide the foundation. The overflow dropdown reuses TugDropdown as-is. Per-tab collapse state follows the Rules of Tugways appearance-zone pattern (imperative DOM data attributes, no React state), while the overflow dropdown button and its item list are structural-zone (React state), because adding/removing DOM elements requires React rendering.

#### Strategy {#strategy}

- Extract a pure `computeOverflow()` function that determines which tabs are visible vs. overflow based on measured widths, enabling thorough unit testing without DOM dependencies.
- Implement Stage 1 collapse first (icon-only inactive tabs), then Stage 2 (overflow dropdown), building incrementally.
- Use a ResizeObserver on the tab bar container to trigger re-measurement on resize, tab add/remove, or card resize.
- Measure actual tab widths via `getBoundingClientRect` after an initial render pass, then apply overflow state via data attributes (appearance-zone pattern per Rules of Tugways [D12]).
- Keep the [+] type picker button rightmost at all times, after the overflow dropdown button if present.
- Switch from `overflow-x: auto` to `overflow-x: hidden`, resolving the insertion indicator clipping issue noted in the Phase 5b2 CSS.

#### Success Criteria (Measurable) {#success-criteria}

- When tabs exceed container width at full size, inactive tabs collapse to icon-only while the active tab retains icon+label (verify by adding tabs in gallery demo until collapse triggers)
- When icon-only tabs still exceed container width, excess tabs appear in an overflow dropdown with icon+label (verify by adding more tabs until overflow triggers)
- Selecting a tab from the overflow dropdown moves it to the rightmost visible slot, displacing the previous rightmost tab into overflow (verify in gallery demo)
- The [+] type picker button remains visible at all times regardless of tab count (verify visually)
- All `computeOverflow()` edge cases pass unit tests (verify via `bun test`)
- The insertion indicator is no longer clipped by overflow (verify via `overflow-x: hidden` in CSS)

#### Scope {#scope}

1. Pure `computeOverflow()` function with unit tests
2. ResizeObserver integration in TugTabBar with DOM-driven overflow state
3. Stage 1 collapse: icon-only rendering for inactive tabs via `data-overflow` attribute
4. Stage 2 overflow: overflow dropdown button with tab count badge, using TugDropdown
5. Active tab visibility rule: selecting an overflow tab swaps it into the visible set
6. CSS changes: `overflow-x: hidden`, icon-only tab styles, overflow button styles
7. TabDragCoordinator selector fix: exclude hidden overflow tabs from reorder and indicator calculations
8. Gallery demo update: add tabs until overflow occurs
9. Fix insertion indicator clipping (resolved by `overflow-x: hidden`)

#### Non-goals (Explicitly out of scope) {#non-goals}

- Animated transitions for collapse/expand (follow-on work)
- Keyboard navigation within the overflow dropdown (Radix handles this via TugDropdown)
- Drag-and-drop reordering within the overflow dropdown
- Changes to DeckManager, layout-tree.ts, or serialization.ts

#### Dependencies / Prerequisites {#dependencies}

- Phase 5b (TugTabBar component) must be complete (it is)
- TugDropdown component must exist and be functional (it does)

#### Constraints {#constraints}

- **Appearance-zone vs. structural boundary:** Per-tab collapse/hide state is appearance-zone (imperative DOM data attributes, no React state). The overflow dropdown button and its item list are structural-zone (React state via `useState` in `useTabOverflow`), because showing/hiding the dropdown button and populating its items are structural DOM changes that require React rendering. This is consistent with Rules of Tugways [D12]: appearance-zone covers visual presentation changes on existing elements, while adding/removing elements is structural.
- All colors and spacing must use `--td-*` semantic tokens exclusively
- No `overflow-x: auto` — the overflow dropdown replaces scrolling entirely
- ResizeObserver callback must not trigger React re-renders for per-tab appearance changes (collapsed/hidden attributes); it may update React state for the overflow tab list (structural change)

#### Assumptions {#assumptions}

- TugDropdown can be reused as-is for the overflow dropdown — no new props are needed
- The overflow dropdown button displays a numeric badge showing the count of overflow tabs, styled with `--td-*` tokens
- The [+] type picker button always remains rightmost (after the overflow dropdown button if present)
- The gallery-tabbar demo will be updated to show a control that adds tabs until overflow occurs
- No changes to layout-tree.ts, serialization.ts, or DeckManager are needed — overflow state is entirely presentational and local to TugTabBar
- The insertion indicator clipping issue noted in the CSS comment ("deferred to Phase 5b4") will be resolved by switching to `overflow-x: hidden`

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors per the skeleton contract. All headings that are referenced elsewhere have `{#anchor-name}` appended. Anchors are kebab-case, lowercase, no phase numbers.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| ResizeObserver loop warnings | low | med | Use `requestAnimationFrame` debounce for DOM writes after measurement | Browser console shows ResizeObserver loop error |
| Measurement accuracy on first render | med | low | Defer measurement to `useLayoutEffect` + ResizeObserver; no flash of unstyled tabs | Tabs flicker on mount |
| Resize during drag corrupts DOM | med | low | Skip overflow recalculation while drag is in progress | Tab drag produces visual glitches |
| Hidden tabs corrupt drag reorder index | high | high | Update TabDragCoordinator selectors to exclude hidden tabs | Drag insertion lands at wrong index when overflow is active |

**Risk R01: ResizeObserver Loop Warnings** {#r01-resize-loop}

- **Risk:** Writing DOM attributes in a ResizeObserver callback can trigger another observation cycle, causing "ResizeObserver loop completed with undelivered notifications" warnings.
- **Mitigation:** Batch DOM writes in a `requestAnimationFrame` callback after reading measurements, ensuring writes happen outside the observation cycle. The `computeOverflow()` pure function runs synchronously; only the DOM attribute application is deferred.
- **Residual risk:** Edge cases with rapid concurrent resizes may still produce a single warning, but functionality is unaffected.

**Risk R02: Tab Width Measurement Timing** {#r02-measurement-timing}

- **Risk:** Measuring tab widths via `getBoundingClientRect` before the browser has laid out the tabs yields zero or incorrect values.
- **Mitigation:** Use `useLayoutEffect` to attach the ResizeObserver, ensuring measurement runs after React has committed DOM changes. The ResizeObserver fires after layout, guaranteeing accurate measurements.
- **Residual risk:** None — `useLayoutEffect` + ResizeObserver is the standard pattern for layout-dependent effects.

**Risk R03: Resize During Active Drag** {#r03-resize-during-drag}

- **Risk:** If a card is resized while a tab drag is in progress, the ResizeObserver callback could modify `data-overflow` attributes on tab elements that the TabDragCoordinator is actively manipulating, causing visual glitches or incorrect drag state.
- **Mitigation:** The `useTabOverflow` hook's ResizeObserver callback checks `tabDragCoordinator.isDragging` (or equivalent) at the start of each observation. If a drag is in progress, the callback returns early without recalculating or modifying DOM. Overflow state is recalculated on the next observation after the drag ends.
- **Residual risk:** The overflow state may be momentarily stale during a drag, but this is invisible to the user since the drag gesture visually dominates the tab bar.

**Risk R04: Hidden Overflow Tabs Corrupt Drag Reorder Index** {#r04-hidden-tabs-drag}

- **Risk:** `TabDragCoordinator.computeReorderIndex()` (line 505) and `updateInsertionIndicator()` (line 546) use `querySelectorAll('.tug-tab')` to enumerate tab elements. When overflow tabs have `data-overflow="hidden"` with `display: none`, they return zero-width bounding rects from `getBoundingClientRect()`, causing incorrect midpoint calculations and wrong insertion indices during drag.
- **Mitigation:** Update both selectors in `tab-drag-coordinator.ts` to exclude hidden overflow tabs: `.tug-tab:not([data-overflow="hidden"])`. This ensures only visible tabs (full or collapsed) participate in reorder index computation and insertion indicator positioning.
- **Residual risk:** None — the filtered selector precisely matches the set of tabs that have meaningful layout positions.

---

### Design Decisions {#design-decisions}

> Record *decisions* (not options). Each decision includes the "why" so later phases don't reopen it accidentally.

#### [D01] DOM measurement for full widths, fixed constant for icon-only widths (DECIDED) {#d01-dom-measurement}

**Decision:** Full tab widths are measured via `getBoundingClientRect` on the rendered tab elements. Icon-only widths use a fixed constant `ICON_ONLY_TAB_WIDTH = 28` (padding 8px + icon 12px + padding 8px), because tabs are only ever rendered at full width — there is no icon-only DOM element to measure.

**Rationale:**
- Full tab widths vary by content (title length, close button presence) and must be measured from the DOM
- Icon-only width is 28px, not 32px: in collapsed mode, `.tug-tab-title` and `.tug-tab-close` are hidden with `display: none`, removing them from flex layout. With only `.tug-tab-icon` as a single flex child, CSS `gap` contributes 0px. The width is left padding (8px) + icon (12px) + right padding (8px) = 28px.
- Avoiding a two-pass render (full then icon-only) keeps the implementation simple and avoids layout thrashing

**Implications:**
- Tabs must be rendered in the DOM (even if ultimately hidden) to measure their full width
- The measurement pass runs on every ResizeObserver callback and on tab add/remove
- If icon or padding CSS values change, `ICON_ONLY_TAB_WIDTH` must be updated to match
- Collapsed tab CSS must use `display: none` on `.tug-tab-title` and `.tug-tab-close` (not `visibility: hidden`) to ensure they are removed from flex layout and gap does not apply

#### [D02] Overflow state split across appearance and structural zones (DECIDED) {#d02-imperative-dom}

**Decision:** Per-tab collapse/hide state is driven by `data-overflow` attributes on tab DOM elements, set imperatively by the ResizeObserver callback (appearance-zone). The overflow tab list (which tabs appear in the dropdown) is stored in React state via `useState` in `useTabOverflow` (structural-zone), because it controls whether the overflow dropdown button is rendered and what items it contains.

**Rationale:**
- Per-tab visual changes (collapsed, hidden) are appearance-zone per Rules of Tugways [D12] — CSS handles them via `data-overflow` attributes, avoiding re-renders for the common case of resizing
- The overflow dropdown button is a structural DOM addition/removal — React must render it and its TugDropdown items, which requires React state
- This split is consistent with existing patterns: `data-active` and `data-dragging` are appearance-zone, while the [+] type picker dropdown items are React-rendered

**Implications:**
- CSS rules target `[data-overflow="collapsed"]` to hide tab labels and `[data-overflow="hidden"]` to hide tabs entirely
- `useTabOverflow` returns `overflowTabs: TabItem[]` via `useState` — React re-renders only when the overflow tab list changes (not on every resize)
- The ResizeObserver callback sets DOM attributes imperatively for per-tab state, then calls `setOverflowTabs()` only when the set of overflow tabs actually changes (reference equality check)

#### [D03] Pure computeOverflow function for testability (DECIDED) {#d03-pure-compute}

**Decision:** The core overflow logic is extracted into a pure function `computeOverflow(tabWidths, containerWidth, activeTabId, fixedWidths)` that returns `{ visibleTabIds, collapsedTabIds, overflowTabIds, stage }`. This function is unit-tested directly without DOM or ResizeObserver dependencies.

**Rationale:**
- Pure functions are trivially testable — no mocking of ResizeObserver, no DOM setup
- Separates the "what should overflow" question from the "how to apply it" question
- Makes the algorithm auditable and debuggable independently of the rendering layer

**Implications:**
- `computeOverflow` lives in its own module (`tab-overflow.ts`) and is imported by TugTabBar
- Tab widths are passed as `TabMeasurement[]` with `hasIcon` flag so the function handles iconless tabs correctly (iconless tabs cannot collapse to icon-only)
- `ICON_ONLY_TAB_WIDTH` constant (28px) is exported from `tab-overflow.ts` for use by the measurement code

#### [D04] Replace overflow-x: auto with overflow-x: hidden (DECIDED) {#d04-overflow-hidden}

**Decision:** The `.tug-tab-bar` container switches from `overflow-x: auto` to `overflow-x: hidden`. The overflow dropdown replaces horizontal scrolling entirely.

**Rationale:**
- The overflow dropdown provides a discoverable, accessible mechanism for accessing all tabs
- `overflow-x: auto` with hidden scrollbar was invisible to users — tabs scrolled off-screen with no affordance
- Switching to `overflow-x: hidden` resolves the insertion indicator clipping issue noted in Phase 5b2 CSS comments ("deferred to Phase 5b4")

**Implications:**
- The insertion indicator (`.tug-tab-insert-indicator`) is no longer clipped by overflow
- Tabs that don't fit are handled by the overflow dropdown, not by scrolling
- The CSS comment about insertion indicator clipping can be removed

#### [D05] Active tab visibility rule via swap (DECIDED) {#d05-active-tab-swap}

**Decision:** When a user selects a tab from the overflow dropdown, that tab moves to the rightmost visible slot. The tab that previously occupied the rightmost visible slot is displaced into the overflow set.

**Rationale:**
- The active tab must always be visible (it shows icon+label and is the user's focus)
- Swapping with the rightmost visible tab minimizes visual disruption — only two tabs change position
- This mirrors the behavior of browser tab overflow implementations

**Implications:**
- `onTabSelect` callback continues to work unchanged — DeckManager updates `activeTabId`, which triggers re-render, and the ResizeObserver callback recomputes overflow with the new active tab
- The `computeOverflow()` function always places the active tab in the visible set, adjusting other tabs as needed

#### [D06] Overflow dropdown button with badge count (DECIDED) {#d06-overflow-button}

**Decision:** When tabs overflow, an overflow dropdown button appears between the last visible tab and the [+] button. It displays a numeric badge showing the count of overflow tabs (e.g., "+3") and opens a TugDropdown listing all overflow tabs with icon+label.

**Rationale:**
- The badge provides at-a-glance awareness of how many tabs are hidden
- Reusing TugDropdown avoids building a new dropdown component
- Placing it between tabs and [+] keeps the [+] rightmost, maintaining spatial consistency

**Implications:**
- The overflow button is rendered conditionally in TugTabBar's JSX (it is a structural element, not appearance-zone)
- The button's badge count and the dropdown items list are derived from the overflow tab set
- Styled with `--td-*` tokens to match the tab bar aesthetic

#### [D07] TabDragCoordinator selectors exclude hidden overflow tabs (DECIDED) {#d07-drag-selector-fix}

**Decision:** `computeReorderIndex()` and `updateInsertionIndicator()` in `tab-drag-coordinator.ts` use the selector `.tug-tab:not([data-overflow="hidden"])` instead of `.tug-tab` to enumerate tab elements for drag reorder calculations.

**Rationale:**
- Hidden overflow tabs have `display: none` and return zero-width bounding rects from `getBoundingClientRect()`, which corrupts midpoint calculations and produces wrong insertion indices
- Only visible tabs (full-width or collapsed) have meaningful layout positions and should participate in reorder index computation
- This is a targeted, backward-compatible change — when no tabs have `data-overflow="hidden"`, the selector matches the same set as `.tug-tab`

**Implications:**
- Both `computeReorderIndex()` (line 505) and `updateInsertionIndicator()` (line 546) must be updated
- The selector constant should be defined once (e.g., `const VISIBLE_TAB_SELECTOR = '.tug-tab:not([data-overflow="hidden"])'`) to avoid duplication

#### [D08] Overflow dropdown and type picker are separate TugDropdown instances (DECIDED) {#d08-separate-dropdowns}

**Decision:** The overflow dropdown and the [+] type picker are independent sibling TugDropdown instances, not a single combined dropdown.

**Rationale:**
- They serve different purposes: overflow dropdown selects an existing tab, type picker creates a new tab
- Radix auto-close behavior ensures opening one closes the other
- Combining them would conflate semantically distinct actions and complicate the item list

**Implications:**
- The overflow TugDropdown is rendered conditionally (only when `overflowTabs.length > 0`)
- The [+] TugDropdown is always rendered (existing behavior, unchanged)
- Both are siblings in the flex layout, with [+] always rightmost

---

### Specification {#specification}

#### Inputs and Outputs {#inputs-outputs}

**Spec S01: computeOverflow Function Signature** {#s01-compute-overflow}

```typescript
interface TabMeasurement {
  tabId: string;
  fullWidth: number;      // width with icon + label + close button
  iconOnlyWidth: number;  // ICON_ONLY_TAB_WIDTH if tab has an icon, fullWidth if no icon (cannot collapse)
  hasIcon: boolean;       // whether this tab has an icon (determines collapsibility)
}

interface OverflowResult {
  stage: "none" | "collapsed" | "overflow";
  visibleFullIds: string[];     // tabs shown at full size (always includes activeTabId)
  collapsedIds: string[];       // tabs shown as icon-only
  overflowIds: string[];        // tabs hidden, shown in overflow dropdown
}

function computeOverflow(
  tabs: TabMeasurement[],
  containerWidth: number,
  activeTabId: string,
  overflowButtonWidth: number,
  addButtonWidth: number,
): OverflowResult;
```

**Spec S02: computeOverflow Algorithm** {#s02-overflow-algorithm}

1. Reserve space for the [+] button (`addButtonWidth`).
2. Try all tabs at full width. If they fit in `containerWidth - addButtonWidth`, return `stage: "none"` with all tabs in `visibleFullIds`.
3. Stage 1 collapse: keep the active tab at full width. For each inactive tab: if `hasIcon` is true, use `iconOnlyWidth` (ICON_ONLY_TAB_WIDTH); if `hasIcon` is false, keep at `fullWidth` (iconless tabs cannot collapse). If the total fits in `containerWidth - addButtonWidth`, return `stage: "collapsed"` with `activeTabId` in `visibleFullIds` and collapsible inactive tabs in `collapsedIds`. Iconless inactive tabs remain in `visibleFullIds` at full width.
4. Stage 2 overflow: reserve space for the overflow button (`overflowButtonWidth`). Starting from the rightmost inactive tab, move tabs to `overflowIds` until the remaining tabs (active at full + remaining inactive at icon-only or full for iconless) fit in `containerWidth - addButtonWidth - overflowButtonWidth`. Return `stage: "overflow"`.
5. Edge case: if even the active tab alone exceeds the container, return `stage: "overflow"` with only the active tab visible (at full width) and all others in overflow.

**Spec S03: DOM Data Attributes for Overflow State** {#s03-dom-attributes}

| Attribute | Element | Values | Purpose |
|-----------|---------|--------|---------|
| `data-overflow` | `.tug-tab` | `"collapsed"` | Tab shown as icon-only (Stage 1) |
| `data-overflow` | `.tug-tab` | `"hidden"` | Tab hidden, in overflow dropdown (Stage 2) |
| `data-overflow-active` | `.tug-tab-bar` | `"true"` | Overflow mode is active (either stage) |

**Spec S04: Overflow Button Markup** {#s04-overflow-button}

```html
<button class="tug-tab-overflow-btn" data-testid="tug-tab-overflow-btn">
  <span class="tug-tab-overflow-badge">+3</span>
</button>
```

The overflow button is rendered conditionally when `overflowIds.length > 0`. It triggers a TugDropdown containing one item per overflow tab (icon + label). Selecting an item calls `onTabSelect(tabId)`.

#### Terminology and Naming {#terminology}

| Term | Definition |
|------|-----------|
| Stage 1 collapse | Inactive tabs render as icon-only (label hidden) to save horizontal space |
| Stage 2 overflow | Tabs that don't fit even at icon-only are moved to an overflow dropdown |
| Visible tab | A tab rendered in the tab bar (at full or icon-only width) |
| Overflow tab | A tab hidden from the bar and listed in the overflow dropdown |
| Fixed elements | The overflow button and [+] button, which always occupy their reserved space |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/tab-overflow.ts` | Pure `computeOverflow()` function |
| `tugdeck/src/__tests__/tab-overflow.test.ts` | Unit tests for `computeOverflow()` |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TabMeasurement` | interface | `tab-overflow.ts` | Input type for `computeOverflow`, includes `hasIcon` flag |
| `OverflowResult` | interface | `tab-overflow.ts` | Return type for `computeOverflow` |
| `computeOverflow` | fn | `tab-overflow.ts` | Pure overflow calculation logic |
| `ICON_ONLY_TAB_WIDTH` | const | `tab-overflow.ts` | Fixed 28px width for icon-only collapsed tabs (8 + 12 + 8, no gap) |
| `OVERFLOW_BUTTON_WIDTH` | const | `tab-overflow.ts` | Estimated 40px width for overflow dropdown button (used before button is rendered) |
| `useTabOverflow` | fn (hook) | `tug-tab-bar.tsx` | ResizeObserver + measurement + DOM attribute application |
| `.tug-tab-overflow-btn` | CSS class | `tug-tab-bar.css` | Overflow dropdown trigger button |
| `.tug-tab-overflow-badge` | CSS class | `tug-tab-bar.css` | Badge showing overflow tab count |
| `data-overflow` | attribute | `tug-tab-bar.css` | CSS rules for collapsed/hidden tabs |
| `VISIBLE_TAB_SELECTOR` | const | `tab-drag-coordinator.ts` | `.tug-tab:not([data-overflow="hidden"])` — excludes hidden overflow tabs from drag calculations |
| `get isDragging` | getter | `tab-drag-coordinator.ts` | Public getter exposing private `dragActive` for drag-guard in overflow hook |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `computeOverflow()` pure function with various tab counts, widths, and active tab positions | Core overflow algorithm, edge cases |
| **Integration** | Test TugTabBar renders correct DOM attributes and overflow button based on container width | End-to-end overflow rendering |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Extract computeOverflow Pure Function {#step-1}

**Commit:** `feat(tugdeck): add computeOverflow pure function for tab overflow calculation`

**References:** [D03] Pure computeOverflow function, Spec S01, Spec S02, (#inputs-outputs, #strategy)

**Artifacts:**
- New file `tugdeck/src/tab-overflow.ts` with `TabMeasurement`, `OverflowResult`, and `computeOverflow()`
- New file `tugdeck/src/__tests__/tab-overflow.test.ts` with unit tests

**Tasks:**
- [ ] Create `tugdeck/src/tab-overflow.ts` exporting `TabMeasurement`, `OverflowResult`, `computeOverflow()`, `ICON_ONLY_TAB_WIDTH` constant (28px), and `OVERFLOW_BUTTON_WIDTH` constant (40px estimated)
- [ ] Implement the algorithm per Spec S02: try full-width, then Stage 1 collapse (respecting `hasIcon`), then Stage 2 overflow
- [ ] Handle edge cases: zero tabs, single tab, all tabs fit, only active tab fits, active tab alone overflows container, iconless tabs

**Tests:**
- [ ] T01: All tabs fit at full width — returns `stage: "none"`, all in `visibleFullIds`
- [ ] T02: Active tab fits at full, inactive tabs fit at icon-only — returns `stage: "collapsed"`
- [ ] T03: Tabs overflow even at icon-only — returns `stage: "overflow"` with excess in `overflowIds`
- [ ] T04: Active tab is always in `visibleFullIds`, never in `collapsedIds` or `overflowIds`
- [ ] T05: Zero tabs — returns `stage: "none"` with empty arrays
- [ ] T06: Single tab (active) — always returns `stage: "none"`
- [ ] T07: Overflow removes tabs from the right (rightmost inactive first)
- [ ] T08: Even if active tab alone exceeds container, it stays in `visibleFullIds`
- [ ] T09: Iconless inactive tabs stay in `visibleFullIds` at full width during Stage 1 (they cannot collapse)
- [ ] T10: Iconless tabs can still be moved to `overflowIds` in Stage 2
- [ ] T10a: `ICON_ONLY_TAB_WIDTH` is 28 — add a test with a comment documenting the CSS dependency chain: `.tug-tab` padding (8px + 8px) + `.tug-tab-icon` width (12px) = 28px. The test asserts the exported constant equals 28 so that any future change to the constant forces a reviewer to verify the CSS still matches.

**Checkpoint:**
- [ ] `cd tugdeck && bun test tab-overflow`

---

#### Step 2: CSS Foundation — Overflow Hidden and Collapse Styles {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add CSS for tab overflow collapse and hidden states`

**References:** [D04] Replace overflow-x: auto with overflow-x: hidden, [D02] Imperative DOM data attributes, Spec S03, Spec S04, (#constraints)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-tab-bar.css`

**Tasks:**
- [ ] Change `.tug-tab-bar` from `overflow-x: auto` to `overflow-x: hidden`
- [ ] Remove the `.tug-tab-bar::-webkit-scrollbar { display: none }` rule (no longer needed)
- [ ] Add `.tug-tab[data-overflow="collapsed"] .tug-tab-title` and `.tug-tab[data-overflow="collapsed"] .tug-tab-close` rules with `display: none` to remove them from flex layout (not `visibility: hidden`), so CSS `gap` does not apply and the collapsed tab width matches `ICON_ONLY_TAB_WIDTH` (28px)
- [ ] Add `.tug-tab[data-overflow="hidden"]` rule: `display: none`
- [ ] Add `.tug-tab-overflow-btn` styles: inline-flex, centered, `--td-*` tokens, same height as tab bar
- [ ] Add `.tug-tab-overflow-badge` styles: small badge with `--td-accent` background, white text, border-radius
- [ ] Remove the CSS comment about insertion indicator clipping being "deferred to Phase 5b4"
- [ ] Add hover state for `.tug-tab-overflow-btn` using `--td-surface-control`

**Tests:**
- [ ] Visual verification — collapsed tabs show icon only (manual check in gallery demo, deferred to Step 6)

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` (CSS compiles without errors)

---

#### Step 3: Update TabDragCoordinator Selectors for Overflow Compatibility {#step-3}

**Depends on:** #step-2

**Commit:** `fix(tugdeck): exclude hidden overflow tabs from drag reorder index and insertion indicator`

**References:** [D07] TabDragCoordinator selectors exclude hidden overflow tabs, Risk R04, Spec S03, (#strategy)

**Artifacts:**
- Modified `tugdeck/src/tab-drag-coordinator.ts` — updated selectors in `computeReorderIndex()` and `updateInsertionIndicator()`

**Tasks:**
- [ ] Define a constant `VISIBLE_TAB_SELECTOR = '.tug-tab:not([data-overflow="hidden"])'` in `tab-drag-coordinator.ts`
- [ ] Update `computeReorderIndex()` (line 505) to use `barElement.querySelectorAll<HTMLElement>(VISIBLE_TAB_SELECTOR)` instead of `barElement.querySelectorAll<HTMLElement>(".tug-tab")`
- [ ] Update `updateInsertionIndicator()` (line 546) to use `barElement.querySelectorAll<HTMLElement>(VISIBLE_TAB_SELECTOR)` instead of `barElement.querySelectorAll<HTMLElement>(".tug-tab")`
- [ ] Add the `get isDragging(): boolean` public getter to `TabDragCoordinator`, exposing the existing private `dragActive` field (needed by the overflow hook in Step 4)

**Tests:**
- [ ] T11: Existing tab drag tests still pass (selector change is backward-compatible — when no tabs have `data-overflow="hidden"`, the result is identical)
- [ ] T12: Verify `VISIBLE_TAB_SELECTOR` matches only non-hidden tabs (unit test with a mock DOM containing tabs with and without `data-overflow="hidden"`)

**Checkpoint:**
- [ ] `cd tugdeck && bun test tab-drag`
- [ ] `cd tugdeck && bun run build`

---

#### Step 4: useTabOverflow Hook — ResizeObserver and DOM Attribute Application {#step-4}

**Depends on:** #step-1, #step-2, #step-3

**Commit:** `feat(tugdeck): add useTabOverflow hook with ResizeObserver integration`

**References:** [D01] DOM measurement, [D02] Imperative DOM data attributes, [D03] Pure computeOverflow, Risk R01, Risk R02, Risk R03, Spec S01, Spec S03, (#assumptions, #constraints)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-tab-bar.tsx` — new `useTabOverflow` hook

**Tasks:**
- [ ] Create `useTabOverflow(barRef, tabs, activeTabId)` hook inside `tug-tab-bar.tsx`
- [ ] In `useLayoutEffect`, attach a ResizeObserver to `barRef.current`. The dependency array includes `tabs.length`, `activeTabId`, and a serialized tab titles key (`tabs.map(t => t.title).join('|')`) to ensure re-measurement on tab add/remove, active tab change, and tab title change. The ResizeObserver handles container resize automatically.
- [ ] On each observation: first check if a tab drag is in progress via `tabDragCoordinator.isDragging` (a new public getter exposing the existing private `dragActive` field); if so, skip overflow recalculation to avoid modifying DOM elements during an active drag gesture. Add the `get isDragging(): boolean` getter to `TabDragCoordinator` in `tab-drag-coordinator.ts`.
- [ ] Measure each tab's full width via `getBoundingClientRect`. For icon-only width, use `ICON_ONLY_TAB_WIDTH` constant (28px) for tabs with icons; use `fullWidth` for iconless tabs (they cannot collapse). Determine `hasIcon` by checking for the `.tug-tab-icon` child element.
- [ ] Measure the [+] button width via `getBoundingClientRect`. For the overflow button width: if the overflow button is currently rendered, measure it; otherwise use `OVERFLOW_BUTTON_WIDTH` constant (40px estimated) as the bootstrap value for the first computation that introduces overflow.
- [ ] Call `computeOverflow()` with measured values
- [ ] Apply per-tab results to DOM imperatively via `requestAnimationFrame`: set `data-overflow` attribute on each tab element, set `data-overflow-active` on the bar (appearance-zone, no React state)
- [ ] Use `useState<TabItem[]>` for `overflowTabs` — call `setOverflowTabs()` only when the set of overflow tab IDs actually changes (compare by joining IDs). This is a structural-zone change: React must render/remove the overflow dropdown button and its items.
- [ ] Return `{ overflowTabs }` so TugTabBar can render the overflow dropdown conditionally
- [ ] Clean up ResizeObserver on unmount

**Tests:**
- [ ] T13: Hook integration tested via TugTabBar rendering tests in Step 6

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` (TypeScript compiles without errors)

---

#### Step 5: Overflow Dropdown Button and Active Tab Swap {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugdeck): add overflow dropdown button with tab count badge and active tab swap`

**References:** [D05] Active tab visibility rule, [D06] Overflow dropdown button, [D08] Separate dropdowns, Spec S04, (#terminology, #strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-tab-bar.tsx` — overflow button JSX, TugDropdown for overflow tabs

**Tasks:**
- [ ] Add a `ref` to the tab bar container div for `useTabOverflow`
- [ ] Render the overflow dropdown button conditionally when `overflowTabs.length > 0`, wrapped in its own TugDropdown instance (separate from the [+] type picker per [D08])
- [ ] The overflow button shows a badge with `+{count}` text (e.g., "+3")
- [ ] The overflow TugDropdown items are derived from `overflowTabs` (icon + label for each)
- [ ] When an overflow tab is selected from the dropdown, call `onTabSelect(tabId)` — DeckManager updates `activeTabId`, triggering re-render, and the ResizeObserver recomputes overflow with the new active tab visible
- [ ] Ensure the [+] type picker button remains rightmost in the flex layout (after the overflow dropdown)
- [ ] Ensure the overflow button has `data-testid="tug-tab-overflow-btn"` for testing

**Tests:**
- [ ] T14: Overflow button renders when tabs overflow (verified in Step 6)
- [ ] T15: Selecting an overflow tab calls `onTabSelect` (verified in Step 6)

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` (TypeScript compiles without errors)

---

#### Step 6: Integration Checkpoint — Tab Bar Overflow End-to-End {#step-6}

**Depends on:** #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] DOM measurement, [D02] Imperative DOM data attributes, [D05] Active tab swap, [D06] Overflow dropdown button, [D07] Drag selector fix, (#success-criteria)

**Tasks:**
- [ ] Verify all artifacts from Steps 1-5 are complete and work together
- [ ] Verify `computeOverflow()` unit tests pass
- [ ] Verify TabDragCoordinator selector tests pass
- [ ] Verify TugTabBar builds without errors
- [ ] Verify no TypeScript or lint errors across the tugdeck project
- [ ] Verify tab add/remove and title changes trigger re-measurement (dependency array includes `tabs.length`, `activeTabId`, and `tabs.map(t => t.title).join('|')` for title-change sensitivity)
- [ ] Verify card resize triggers re-measurement (ResizeObserver on tab bar element)

**Tests:**
- [ ] T16: Full test suite passes

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run build`

---

#### Step 7: Gallery Demo Update {#step-7}

**Depends on:** #step-6

**Commit:** `feat(tugdeck): update gallery TugTabBar demo to show overflow behavior`

**References:** [D06] Overflow dropdown button, (#scope, #assumptions)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/cards/gallery-card.tsx` — `TugTabBarDemo` updated

**Tasks:**
- [ ] Update `TugTabBarDemo` to start with enough initial tabs (or provide an "Add 5 tabs" button) so that overflow is demonstrable in a reasonably sized card
- [ ] Add a status line showing current overflow stage ("none", "collapsed", "overflow") and count of overflow tabs
- [ ] Verify that adding tabs via [+] triggers progressive collapse: first icon-only, then overflow dropdown appears
- [ ] Verify that selecting a tab from the overflow dropdown swaps it into the visible set

**Tests:**
- [ ] T17: Gallery demo renders without errors (existing gallery-card tests still pass)
- [ ] T18: Overflow status line renders and shows correct stage after adding tabs

**Checkpoint:**
- [ ] `cd tugdeck && bun test gallery-card`
- [ ] `cd tugdeck && bun run build`

---

#### Step 8: Final Integration Checkpoint {#step-8}

**Depends on:** #step-7

**Commit:** `N/A (verification only)`

**References:** [D01] DOM measurement, [D02] Overflow state split, [D04] Overflow hidden, [D05] Active tab swap, [D06] Overflow dropdown button, [D07] Drag selector fix, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all success criteria are met
- [ ] Run full test suite
- [ ] Verify no regressions in existing TugTabBar tests
- [ ] Verify no regressions in existing tab drag tests
- [ ] Verify gallery demo shows overflow behavior correctly

**Tests:**
- [ ] T19: All `computeOverflow()` unit tests pass
- [ ] T20: All existing TugTabBar tests pass (no regressions)
- [ ] T21: All existing tab drag tests pass (no regressions)
- [ ] T22: Gallery card tests pass

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run build`

---

### Deliverables and Checkpoints {#deliverables}

> This is the single place we define "done" for the phase. Keep it crisp and testable.

**Deliverable:** TugTabBar handles overflow via two-stage progressive collapse (icon-only inactive tabs, then overflow dropdown) with an overflow button showing a tab count badge, active tab swap on dropdown selection, and the [+] button always visible.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `computeOverflow()` pure function passes all unit tests (`bun test tab-overflow`)
- [ ] Tab bar uses `overflow-x: hidden` instead of `overflow-x: auto`
- [ ] Inactive tabs collapse to icon-only before overflow dropdown appears
- [ ] Overflow dropdown button shows count badge and lists overflow tabs with icon+label
- [ ] Selecting an overflow tab swaps it into the rightmost visible slot
- [ ] [+] type picker button remains visible at all times
- [ ] Gallery demo demonstrates overflow behavior
- [ ] TabDragCoordinator correctly excludes hidden overflow tabs from reorder index calculations
- [ ] All existing TugTabBar and tab drag tests pass without regression

**Acceptance tests:**
- [ ] T01-T10: `computeOverflow()` unit tests (including iconless tab handling)
- [ ] T11-T12: TabDragCoordinator selector compatibility tests
- [ ] T19-T22: Full integration test suite

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Animated collapse/expand transitions for Stage 1 icon-only toggle
- [ ] Keyboard shortcut to cycle through overflow tabs
- [ ] Drag-and-drop reordering within the overflow dropdown
- [ ] Overflow tab preview on hover

| Checkpoint | Verification |
|------------|--------------|
| Pure overflow logic | `cd tugdeck && bun test tab-overflow` |
| Full test suite | `cd tugdeck && bun test` |
| Build succeeds | `cd tugdeck && bun run build` |
