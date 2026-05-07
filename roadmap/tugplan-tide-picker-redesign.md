<!-- tugplan-skeleton v2 -->

## Tide Picker Redesign — Header Support, Filter Primitive, and TugListView-Driven Sheet {#tide-picker-redesign}

**Purpose:** Replace the Tide card's project-picker sheet with a single `TugListView`-driven surface, after first lifting two `TugListView` capabilities — header/footer cells (deferred from [tugplan-tug-list-view.md §Q04](./archive/tugplan-tug-list-view.md#q04-headers-footers)) and a reusable filter wrapper (modeled on UIKit's `UISearchController` projecting a filtered data source into `UITableView`) — into the primitive itself.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-05-07 |
| Predecessor | [tugplan-tug-list-view.md](./archive/tugplan-tug-list-view.md) (TugListView v1) |
| Related | [tugplan-tide-card-polish.md](./tugplan-tide-card-polish.md) |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Tide card's project-picker sheet (`TideProjectPickerForm` in `tugdeck/src/components/tugways/cards/tide-card.tsx`) stacks four input idioms in one form: a `TugInput` for the project path, a column of `TugPushButton emphasis="ghost"` buttons for recent paths, a `TugRadioGroup` for "Start fresh" + existing sessions, and Cancel/Open. Two interactive lists are fused into the form (path list and session list), and they share the typed-path state silently — clicking a recent re-keys `useSessionLedger(trimmedPath)` and the radio group's content swaps under the user. There is no architectural seam between path discovery and session selection.

`TugPushButton` bakes `text-transform: uppercase` into its base style (`tug-push-button.css:4`). The recents column renders Unix paths *through* that button — turning `/Users/Ken/projects/foo` into `/USERS/KEN/PROJECTS/FOO`. Unix paths are case-sensitive; an all-caps treatment is wrong both as a presentation of arbitrary user data and as a categorical fact about paths.

`TugListView` (the UIKit-`UITableView`-shaped windowed list primitive shipped via [tugplan-tug-list-view.md](./archive/tugplan-tug-list-view.md)) is already the host for the Tide transcript. It is a single-section flat list ([tugplan-tug-list-view.md §D02](./archive/tugplan-tug-list-view.md#d02-single-section)) with no header/footer support ([§Q04](./archive/tugplan-tug-list-view.md#q04-headers-footers), explicitly deferred) and no filter affordance. The picker rewrite needs both: section dividers (`RECENTS`, `SESSIONS`) and a filter over recents driven by the path input.

This plan unifies that work in three phases: Phase 0 lifts header/footer support into the primitive; Phase 1 ships a reusable filter wrapper; Phase 2 rewrites the picker on top of both. The first two phases stand alone — they leave the door open for any future consumer that wants list sections or filtered enumerations — and Phase 2 consumes them to land the user-visible UX change.

#### Strategy {#strategy}

- **Primitive first.** Phase 0 and Phase 1 are pure primitive enhancements with no consumer migration. Each ships standalone tests and a gallery card before any consumer takes a dependency. Landing the picker rewrite first would shape the primitive APIs around one consumer's accidental needs.
- **Headers via row roles, not full sections.** The picker needs section *dividers*, not multi-section enumeration. Phase 0 adds an optional `roleForIndex(index): "cell" | "header" | "footer"` to the data source — flat-list-shape preserved, additive, no breaking change to existing consumers. Full UITableView-style sections (`numberOfSections`, IndexPath shape) remain a separate future enhancement — see [D02].
- **Filter as data-source decorator.** Phase 1's `useFilteredDataSource` is a wrapper around a base `TugListViewDataSource`, not a prop on `TugListView`. UIKit's `UISearchController`/`UITableView` split is the model: the table doesn't filter; a separate object projects a filtered data source the table consumes. The host owns the search input — see [D01].
- **Picker rows use a fixed seven-kind vocabulary.** Three optional sections (RECENTS / SESSIONS / PENDING) over seven kinds. The vocabulary is enumerated in [Spec S01](#s01-row-vocabulary) so cell renderers, tests, and the data source can reference it without restating the matrix.
- **Select-then-Open uniformly except for navigation/destructive rows.** Session rows are *selectable choices*; path-recent rows are *navigation actions*; forget-all is a *destructive action*. The selection idiom matches the row's semantics rather than forcing one click model across categories — see [D03], [D04], [D05].
- **One commit per step.** Build stays green at every step (`bun run check`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run`). `-D warnings` enforced.
- **Tuglaws apply.** Every step that touches React state, registrations, or DOM appearance re-checks against [tuglaws.md](../tuglaws/tuglaws.md). The closing step records the walkthrough.
- **No new persistence.** Recents stay on tugbank's `dev.tugtool.tide / recent-projects`; the ledger stays on `TideSessionLedgerStore`. No new IndexedDB. Per [tide.md §D-T3-10](./tide.md#decisions-t3).
- **All-caps fix is structural, not stylistic.** Phase 2 sidesteps `TugPushButton`'s baked-in `text-transform: uppercase` by replacing the recents-as-buttons column with `TugListView` cells. No change to `tug-push-button.css` — see [D08].

#### Success Criteria (Measurable) {#success-criteria}

**Phase 0 — Header/footer support:**
- `TugListViewDataSource` accepts an optional `roleForIndex(index): "cell" | "header" | "footer"`. Defaults to `"cell"` when omitted. (verification: typecheck + unit tests)
- Cells whose role is `"header"` or `"footer"` render with `data-list-cell-role` set to that value on the cell wrapper. They are not focusable (`tabIndex={-1}`), do not fire `delegate.onSelect`, and are skipped by any list-view-internal keyboard navigation. (verification: unit tests + DOM assertion)
- The transcript (`TideTranscriptDataSource`) and the existing gallery list view continue to render with no behavioral change. (verification: existing tests pass; manual smoke)
- A new gallery card demonstrates a flat list with header and footer kinds rendering as visually distinct rows. (verification: manual)

**Phase 1 — Filter primitive:**
- `useFilteredDataSource(base, predicate, filterToken)` exists in `tugdeck/src/components/tugways/use-filtered-data-source.ts` and returns a `TugListViewDataSource` whose enumeration is `base` filtered by `predicate(baseIndex, base)`. (verification: typecheck + tests)
- The wrapper subscribes to the base via `subscribe`, ticks listeners on every base change AND on `filterToken` identity changes, and exposes `baseIndexFor(filteredIndex)` for typed cell-renderer access. (verification: tests)
- `getVersion()` returns a value whose identity changes only on actual state changes — `Object.is`-stable across no-change calls per [L02]. (verification: tests)
- A gallery card demonstrates filtering against a `TugInput` substring query. (verification: manual)

**Phase 2 — Picker rewrite:**
- `TideProjectPickerForm` mounts a single `TugListView` against a `TidePickerDataSource` composite. The recents-as-buttons column and the `TugRadioGroup` are deleted from the picker form. (verification: `rg 'TugPushButton' tugdeck/src/components/tugways/cards/tide-card.tsx` returns no matches inside `TideProjectPickerForm`; `rg 'TugRadioGroup\|TugRadioItem' tugdeck/src/components/tugways/cards/tide-card.tsx` returns zero matches)
- Recent paths render with original case preserved. (verification: manual)
- The picker emits exactly the seven kinds in [Spec S01](#s01-row-vocabulary) across the three optional sections. (verification: data-source unit tests + manual)
- Open submits per [Spec S02](#s02-open-semantics). (verification: tests + manual)
- `path-recent` click fills the input via `setPath(recent)`; the list re-enumerates to SESSIONS once the ledger settles. (verification: manual)
- Default selection on first SESSIONS render is `{ kind: "session-new" }`. (verification: tests)
- Live `session-resume` rows render disabled with a `live` badge; failed rows render selectable with a `failed` badge. (verification: tests + manual)
- ArrowUp/ArrowDown moves selection across selectable rows, skipping headers, loading, path-recents, forget-all, and live session-resumes. (verification: tests + manual)
- The picker notice banner, retry callback, per-row Forget icon, inline confirm panel, and forget-all flow survive the rewrite unchanged. (verification: tests + manual)
- Cancel via Esc or button cascades CLOSE through the responder chain per [#cancel-cascade]. (verification: tests + manual)

**Compliance:**
- `bun run check`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run` pass at every commit.
- `-D warnings` enforced.
- Component authoring guide checklist passes for every new file.
- No new IndexedDB dependencies introduced.

#### Scope {#scope}

1. Optional `roleForIndex` on `TugListViewDataSource` and the corresponding behavior in `TugListView` (focus / selection / data attribute).
2. `useFilteredDataSource` wrapper helper plus tests and a gallery card.
3. `TidePickerDataSource` composite adapter that enumerates seven cell kinds across three sections.
4. Replacement of the recents-as-buttons column and the `TugRadioGroup` inside the picker sheet.
5. Cell renderers for each new kind, scoped under `tide-card.css` per [L20].
6. Picker-owned arrow-key navigation across selectable rows.
7. Tests for the role contract, the filter wrapper, the picker data source, and the rewritten form.
8. Two new gallery cards (header/footer demo, filter demo).

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Master/detail (split-pane) picker layout.** Held in reserve for a future phase if recents grow beyond ~15 entries with metadata.
- **Removing the global `TugPushButton` uppercase rule.** The redesign sidesteps it; touching the rule is a separate decision.
- **Server-side recents filtering.** The wrapper supports it via a different base data source, but the picker's recents stay client-side.
- **Full UITableView-style sections.** `numberOfSections`, `numberOfItemsInSection`, `IndexPath`-shaped data sources, sticky section headers — none of these land in this plan. Header/footer cells (Phase 0) are the smaller additive shape that solves the picker's need; full sections remain a future enhancement per [tugplan-tug-list-view.md §roadmap](./archive/tugplan-tug-list-view.md#roadmap).
- **Multi-select in the list view.** Consumer-owned single-selection covers the picker.
- **Keyboard arrow nav inside `TugListView` itself.** The picker handles its own arrow keys — see [D10]. A primitive enhancement would be a separate plan.
- **Search-input chrome inside `TugListView`.** The host owns the input per [D01] / `UISearchController` split.

#### Dependencies / Prerequisites {#dependencies}

- `TugListView` v1 from [tugplan-tug-list-view.md](./archive/tugplan-tug-list-view.md) (shipped).
- `TideSessionLedgerStore` (`tugdeck/src/lib/tide-session-ledger-store.ts`) — already the picker's session source.
- `useTugbankValue` for `dev.tugtool.tide / recent-projects` — already the picker's recents source.
- `TugInput`, `TugSheet`, `useTugSheet`, `useResponderForm`, `TugPushButton` (action-button usage retained), `TugBadge`, `Trash2` icon — all in current use.

#### Constraints {#constraints}

- `-D warnings` build policy ([CLAUDE.md `Build Policy`](../CLAUDE.md)).
- [L02] external state via `useSyncExternalStore` only.
- [L03] event-dependent registrations in `useLayoutEffect`.
- [L06] appearance changes via CSS / DOM, never React state.
- [L11] action vocabulary for any chain-routed dispatch.
- [L19] component authoring guide for any new exported primitive surface.
- [L20] component-token sovereignty — consumer overrides via cascade-scoped selectors.
- [L23] `data-tug-scroll-key` for scroll-position survival across DOM-down transitions.

#### Assumptions {#assumptions}

- Recents fits in memory and remains short (typically <20 paths). The composite data source can filter eagerly without windowing pressure.
- The path input's value is treated as a single concept ("the project path the user is choosing") — no separate "search query" mode. Recents matching is a typeahead side effect of typing a path. (Confirmed in design discussion.)
- Existing `TideTranscriptDataSource` and `GalleryListViewDataSource` will not opt into `roleForIndex` initially; the optional default keeps them unchanged.
- The session ledger store's snapshot shape is stable; the composite consumes its existing `SessionRow[]` typing.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows tugplan-skeleton v2. Anchors are explicit and stable; design decisions and open questions are labeled `[D01]`, `[Q01]`, etc.; execution steps cite plan artifacts on `**References:**` lines.

---

### Open Questions {#open-questions}

> All five open questions raised during design were resolved before authoring. They are recorded here for traceability.

#### [Q01] Section header treatment in the picker (RESOLVED → Phase 0 + [D02]) {#q01-section-headers}

**Question:** Section headers (`RECENTS`, `SESSIONS`) needed muted, non-uppercased treatment, but `TugListView` had no header concept. Render via plain `<div role="presentation">` cells with consumer-scoped CSS, reuse `TugLabel`, or lift into the primitive?

**Resolution:** RESOLVED — lift into the primitive. Phase 0 adds optional `roleForIndex` to `TugListViewDataSource` so headers (and footers) become a first-class capability. The picker uses it; future consumers reuse it. See [D02].

---

#### [Q02] Path truncation direction for `path-recent` (RESOLVED → [D07]) {#q02-path-truncation}

**Question:** Long paths (`/Users/Ken/Mounts/u/src/tugtool`) overflow the cell. Truncate at the end (default `text-overflow: ellipsis`) or at the start (preserves the project name's tail)?

**Resolution:** RESOLVED — truncate at the start, macOS Finder path-popup style. The meaningful tail (project name) stays visible; the prefix elides. See [D07].

---

#### [Q03] Default selection on first SESSIONS render (RESOLVED → [D06]) {#q03-default-selection}

**Question:** When SESSIONS becomes visible, auto-select `session-new`, or leave selection `null` and rely on Open's null-fallback rule?

**Resolution:** RESOLVED — auto-select `{ kind: "session-new" }`. Makes the keyboard-Enter path unambiguous; matches the user's most likely intent. See [D06].

---

#### [Q04] Wrapper + gallery commit grouping (RESOLVED → [D09]) {#q04-wrapper-gallery-grouping}

**Question:** Land the filter wrapper and its gallery card in one commit (gallery is the manual smoke for the wrapper) or split them?

**Resolution:** RESOLVED — split. Smaller commits per step is the house style; the test suite is the gate, not the gallery card. See [D09].

---

#### [Q05] Keyboard arrow navigation across picker rows (RESOLVED → [D10]) {#q05-keyboard-arrows}

**Question:** Today's `TugRadioGroup` provides Up/Down. The replacement list view's `onSelect` only fires on Space/Enter. Build arrow-key navigation into the primitive or into the picker?

**Resolution:** RESOLVED — build into the picker. The picker has the most domain knowledge about which kinds are selectable. A primitive enhancement is a separate future plan. See [D10].

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| `roleForIndex` contract change ripples to existing consumers | low | low | Optional method with default `"cell"`; existing consumers untouched | Any existing consumer test fails after Step 1 |
| Filter wrapper miss-ticks when predicate closure changes without token | med | med | Explicit `filterToken` argument; documented contract; tests cover the case | Filter wrapper tests fail or gallery card shows stale rows |
| Picker rewrite regresses live-row gating, retry, or forget-all | high | med | Preserve existing test coverage; new tests for selection state; manual smoke checklist covers each flow | Any tide-card test fails; manual smoke surfaces dropped behavior |
| Selection state divergence from data-source enumeration | med | med | `useLayoutEffect` invalidation rule mirrors the existing `selectedRow` snap-back at `tide-card.tsx:797`; tests assert it | Selection points at a vanished session id |

**Risk R01: Existing consumer breakage from `roleForIndex` addition** {#r01-role-rollout}

- **Risk:** Adding a new method to `TugListViewDataSource` could break consumers that strictly type their adapter.
- **Mitigation:** Method is optional (`roleForIndex?(...)`). Default behavior when omitted is `"cell"`, preserving the existing single-role flat list. `TideTranscriptDataSource` and `GalleryListViewDataSource` are not touched.
- **Residual risk:** A consumer that adds `roleForIndex` returning anything other than `"cell"`/`"header"`/`"footer"` triggers a runtime assert; the type narrows it to those three at compile time.

**Risk R02: Filter wrapper subtle update bug** {#r02-filter-staleness}

- **Risk:** A predicate closure that captures stale state could keep filtering against old values if the `filterToken` doesn't change identity.
- **Mitigation:** The hook's contract requires the consumer to pass a `filterToken` whose identity changes whenever predicate semantics change. JSDoc spells out the contract; tests cover it.
- **Residual risk:** A consumer that passes a stable token while the predicate's closure mutates will see stale results. Caught only by manual review or an end-to-end test.

**Risk R03: Picker rewrite UX regression** {#r03-picker-regression}

- **Risk:** The rewrite removes radio-group ergonomics (Up/Down nav, `value`-attribute Backspace dispatch, the inline confirm panel's plumbing).
- **Mitigation:** Preserve all current test cases; build arrow-key nav into Step 9 (per [D10]); reuse the inline confirm panel verbatim.
- **Residual risk:** A flow that's tested only manually (Backspace-to-forget on a focused row) could regress silently. The rewrite step's manual smoke checklist covers it.

---

### Design Decisions {#design-decisions}

#### [D01] Filter is a data-source decorator, not a TugListView prop (DECIDED) {#d01-uitableview-search-split}

**Decision:** `TugListView` does not gain a `filterPredicate` prop or own a search field. Filtering ships as `useFilteredDataSource(base, predicate, filterToken)`, a hook that returns a wrapped `TugListViewDataSource` projecting only indices that pass the predicate. The host owns the input.

**Rationale:**
- UIKit's split is the model: `UITableView` doesn't filter; `UISearchController` projects a filtered data source the table consumes.
- The primitive's `numberOfItems` / `idForIndex` / `kindForIndex` contract stays the single source of truth — a `filterPredicate` prop would split that truth across two places.
- Wrappers compose: a future `useSortedDataSource` / `useGroupedDataSource` can stack without growing TugListView's prop surface.
- Server-side filtering becomes possible without primitive change: a consumer who wants the server to filter just builds a different base data source.

**Implications:**
- Cell renderers that need typed access to the base data source's extension methods (e.g. `TideTranscriptDataSource.rowAt`) call `wrapper.baseIndexFor(p.index)` and route through the base.
- The picker's case is simple enough that the composite data source absorbs filter logic internally without using the wrapper — see [D12].

---

#### [D02] Header/footer support via row roles, not full sections (DECIDED) {#d02-role-flat-list}

**Decision:** Phase 0 adds `roleForIndex?(index: number): "cell" | "header" | "footer"` to `TugListViewDataSource`. Cells whose role is `"header"` or `"footer"` render a `data-list-cell-role` attribute on the wrapper, are not focusable (`tabIndex={-1}`), do not fire `delegate.onSelect`, and are skipped by list-view-internal keyboard navigation. Full UITableView-style sections (`numberOfSections`, IndexPath shape, sticky headers) remain deferred.

**Rationale:**
- The picker — the immediate consumer — needs section *dividers*, not multi-section enumeration. Roles solve that with one optional method.
- Full sections add real complexity (height index keyed by section, section-folding, sticky headers, IndexPath-aware imperative API). None earns its place yet, per [tugplan-tug-list-view.md §D02](./archive/tugplan-tug-list-view.md#d02-single-section).
- An optional method preserves the existing single-section flat-list contract. No existing consumer is forced to adapt.
- Migrating to full sections later is additive: `numberOfSections` becomes the new method, IndexPath becomes the new shape, the existing role concept becomes per-section header/footer renderers.

**Implications:**
- Cell renderers for header/footer kinds don't need to know about the role themselves — the primitive sets `tabIndex={-1}` and the data attribute. The renderer paints what it wants.
- CSS uses `[data-list-cell-role="header"]` for visual treatment via the consumer's cascade-scoped selectors per [L20].
- Lifts the resolved status of [tugplan-tug-list-view.md §Q04](./archive/tugplan-tug-list-view.md#q04-headers-footers) from "deferred" to "shipped via roles."

---

#### [D03] Select-then-Open for session rows (DECIDED) {#d03-select-then-open}

**Decision:** The picker's session rows (`session-new`, `session-resume`) are *selectable choices*; the trailing Open button consumes the current selection. There is no click-to-open shortcut on session rows.

**Rationale:**
- More forgiving for accidental misclicks. A misclicked row can be re-clicked (or arrow-keyed past) without an irreversible side effect.
- Matches the `TugRadioGroup` ergonomics the rewrite replaces — no change in user model.
- Keeps the Open button always meaningful; users learn one terminal action.

**Implications:**
- Selection state lives in the consumer (`useState`) per [Q06]/[D03] of the TugListView plan. The primitive does not store selection.
- Open with no selection submits `(query, "new", new uuid)` per [Spec S02](#s02-open-semantics). Same outcome as Open-on-`session-new`.

---

#### [D04] `path-recent` rows are click-to-navigate (DECIDED) {#d04-path-recent-navigation}

**Decision:** Clicking a `path-recent` row fills the path input (`setPath(recent)`); the list re-enumerates to show SESSIONS for that path. The recent does NOT become the current selection.

**Rationale:**
- A recent is a *route* into the session-choice screen, not a session choice itself.
- Forces the user through the explicit Start-fresh / Resume choice, preserving the existing UX guarantee that every spawn flows through that decision.
- Matches the user's stated instinct: "single click = navigate (fills input, list flips to sessions)."

**Implications:**
- Worst case is two clicks to open a brand-new project (recent → Start fresh OR Open-with-no-selection).
- Selectable kinds are exactly `session-new` and non-live `session-resume`; arrow-key nav skips path-recents.

---

#### [D05] `forget-all` is a direct destructive action (DECIDED) {#d05-forget-all-direct}

**Decision:** Clicking the `forget-all` row opens the inline confirmation panel (the existing `pendingForget` flow). It does NOT take selection.

**Rationale:**
- Destructive actions should not piggy-back on Open. Pretending the row is "selected" then making the user click Open to forget would be unsafe.
- Preserves the existing two-screen confirm gesture without nested overlays.

**Implications:**
- The cell renderer's `onClick` fires `onRequestForgetAll()`; the form's render branch swaps to the confirm panel exactly as today.

---

#### [D06] Default selection is `session-new` on first SESSIONS render (DECIDED) {#d06-auto-select-session-new}

**Decision:** When SESSIONS becomes visible, selection auto-defaults to `{ kind: "session-new" }`. When SESSIONS goes from hidden to visible, the same default applies. When SESSIONS is hidden (no path / pending / no rows), selection is `null`.

**Rationale:**
- Makes Enter / Open immediately meaningful — the user can always commit without an extra click.
- Matches the most common intent: "open this project, fresh."
- Mirrors the existing `selectedRow = "new"` default in the radio-group form (`tide-card.tsx:740`).

**Implications:**
- The selection-invalidation rule (when a `session-resume` row vanishes) snaps back to `session-new`, not `null`.
- The Open-with-null-selection rule still applies for the brief window where the user has typed a path before the ledger has settled.

---

#### [D07] Path truncation is macOS Finder ellipsis-at-start (DECIDED) {#d07-finder-style-truncation}

**Decision:** `path-recent` cells truncate long paths from the start (ellipsis on the leading edge), preserving the meaningful tail (project name) — matching macOS Finder path popups.

**Rationale:**
- The project name is the discriminator; the prefix is mostly identical across recents (`/Users/Ken/...`).
- Native macOS pattern; user familiarity is high.

**Implications:**
- Implemented via `direction: rtl` + `text-overflow: ellipsis` + Unicode bidirectional override (`unicode-bidi: plaintext`) on the cell's text element. (`unicode-bidi: plaintext` keeps the Latin path text logically left-to-right while the container's RTL direction trips the truncation onto the leading edge.)
- The full path is set on `title` for hover tooltip and `aria-label` for screen readers.

---

#### [D08] All-caps fix is structural, not stylistic (DECIDED) {#d08-structural-allcaps-fix}

**Decision:** The picker's all-caps recents bug is fixed by replacing `TugPushButton` with `TugListView` cells. The global `text-transform: uppercase` rule on `.tug-push-button` is left untouched. Cancel and Open buttons inside `tug-sheet-actions` remain `TugPushButton` instances.

**Rationale:**
- Smallest blast radius. Touching `tug-push-button.css` ripples through every push-button in the app.
- The all-caps treatment is correct for short command labels (Cancel, Open, Submit) and wrong for content-bearing buttons. The redesign separates those two uses.

**Implications:**
- Future cases of "user content rendered through TugPushButton" need to be moved off the primitive too, OR the primitive grows an opt-out (deferred to a separate decision).

---

#### [D09] Filter wrapper and gallery card land in separate commits (DECIDED) {#d09-wrapper-and-gallery-separate}

**Decision:** `useFilteredDataSource` (Phase 1, Step 4) and its gallery card (Phase 1, Step 5) are separate commits.

**Rationale:**
- Smaller commits per step is the house style.
- The test suite is the gate; the gallery is manual smoke.
- A reviewer can validate the wrapper without scrolling through a gallery card.

**Implications:**
- Step 5 depends on Step 4's surfaces being shipped; the dependency is recorded on the step's `Depends on:` line.

---

#### [D10] Picker owns arrow-key navigation, not the primitive (DECIDED) {#d10-picker-owns-arrows}

**Decision:** ArrowUp/ArrowDown navigation across selectable rows is implemented in `TideProjectPickerForm`'s keydown handler in Phase 2, Step 9. `TugListView` does not gain built-in arrow nav.

**Rationale:**
- The picker has the most domain knowledge: which kinds are selectable, how to skip non-live `session-resume` rows, how to wrap.
- A primitive-level arrow-nav feature would need to take a "selectability predicate" or read selection state — both consumer concerns.
- Sized to a single picker step.

**Implications:**
- The picker reads `dataSource.kindForIndex(i)` and `dataSource.rowAt(i)` to decide selectability when stepping.
- A future primitive enhancement (built-in arrow nav with a selectability predicate) is a separate plan.

---

#### [D11] Notice banner stays outside the list view (DECIDED) {#d11-notice-outside-list}

**Decision:** The picker's notice banner (`PickerNotice`) and Retry button render *above* `TugListView`, not as a list row.

**Rationale:**
- The notice has its own copy and a Retry button; it doesn't fit any of the seven row kinds.
- Keeping it outside preserves the notice's prominence — it shouldn't scroll with the list.

**Implications:**
- The retry callback (`onRetryRestore`) survives untouched.
- The notice's CSS (`.tide-card-picker-notice`, `.tide-card-picker-notice-actions`) is unchanged.

---

#### [D12] Picker uses internal eager filter for recents (DECIDED) {#d12-picker-eager-filter}

**Decision:** `TidePickerDataSource` filters recents internally (eager substring match against `query`) rather than stacking `useFilteredDataSource` over a recents-only base data source. `useFilteredDataSource` remains the canonical reusable pattern documented in the gallery card.

**Rationale:**
- Recents are typically <20 items. The windowing benefit of a wrapper is zero at that scale.
- The composite already needs to consume both recents and sessions; threading recents through a wrapper adds an indirection without benefit.
- The wrapper's existence justifies its own tests and gallery; the picker's choice is a documented exception based on data shape, not a vote against the wrapper.

**Implications:**
- A future consumer with a larger filterable list reaches for `useFilteredDataSource` directly.
- The picker's data source can be migrated to the wrapper later if recents grow without changing its public surface.

---

### Specification {#specification}

#### Spec S01: Picker Row Vocabulary {#s01-row-vocabulary}

**Section ordering** (top → bottom): RECENTS, SESSIONS, PENDING. Sections are *omitted* when their visibility predicate is false. SESSIONS and PENDING are mutually exclusive on `ledger.status`.

**Cell kinds (seven):**

| Kind | Section | Role | Visibility | Click behavior |
|---|---|---|---|---|
| `header-recents`  | RECENTS  | header | filtered recents non-empty | no-op |
| `path-recent`     | RECENTS  | cell   | one per recent that case-sensitively contains `query` AND is not exactly equal to `query`. (Empty `query` → all recents qualify.) | `setPath(recent)`; list re-enumerates. Does NOT take selection. |
| `header-sessions` | SESSIONS | header | `ledger.status === "ready"` AND `query.length > 0` | no-op |
| `session-new`     | SESSIONS | cell   | same as above; always present in the section | becomes the current selection |
| `session-resume`  | SESSIONS | cell   | one per non-deleted ledger row | becomes the current selection unless `state === "live"` (renders disabled) |
| `forget-all`      | SESSIONS | footer | `nonLiveSessionCount > 0`; rendered after the last `session-resume` | open inline confirm panel; does NOT take selection |
| `loading`         | PENDING  | cell   | `query.length > 0` AND `ledger.status === "pending"` | no-op |

**Visual treatments:**

- `header-recents` / `header-sessions`: muted weight + small size, sentence case (`Recents`, `Sessions`). No `text-transform: uppercase`. Under `[data-list-cell-role="header"]`.
- `path-recent`: monospace family from `--tug-font-family-mono`; ellipsis-at-start truncation per [D07]; `title` and `aria-label` carry the full path.
- `session-new`, `session-resume`: existing rich row layout (title + subtitle stack, optional trailing icon/badge), preserved verbatim.
- `forget-all`: rendered as a quiet footer link; `[data-list-cell-role="footer"]`.
- `loading`: subdued "checking…" placeholder; `aria-live="polite"`.
- Selected cells (`session-new` or `session-resume`) carry `data-selected="true"` for CSS-driven highlight per [L06].

#### Spec S02: Open Semantics {#s02-open-semantics}

The trailing Open button is always present. It computes its submission per the current selection:

| Selection                              | Open submits                              |
|----------------------------------------|-------------------------------------------|
| `{ kind: "session-new" }`              | `(query, "new", new uuid)`                |
| `{ kind: "session-resume"; sessionId }`| `(query, "resume", sessionId)`            |
| `null` AND `query.length > 0`          | `(query, "new", new uuid)`                |
| `null` AND `query.length === 0`        | no-op (button disabled)                   |

The defense-in-depth check in the existing `submit` (downgrade to `"new"` if the selected session id has vanished) survives unchanged.

#### Spec S03: Selection Invalidation {#s03-selection-invalidation}

- Path input changes (user typed, user clicked a recent): SESSIONS may re-enumerate; if the selected `session-resume` row no longer appears, selection snaps to `{ kind: "session-new" }` if SESSIONS is still visible, or `null` if not.
- SESSIONS goes from visible to hidden: selection becomes `null`.
- SESSIONS goes from hidden to visible: selection becomes `{ kind: "session-new" }`.

Implemented via a `useLayoutEffect` mirroring the existing snap-back at `tide-card.tsx:797`.

#### Spec S04: Cancel Cascade {#s04-cancel-cascade}

Esc / Cancel button → `close("cancel")` on the sheet → `useSheetDelegate`'s `sheetDidReturnResult` handler dispatches `TUG_ACTIONS.CLOSE` via `manager.sendToTarget(cardId, ...)` per [tide §D02](./tide.md#decisions-t3). Behavior unchanged from the current picker.

#### Spec S05: `roleForIndex` API {#s05-role-api}

```ts
// New optional method on TugListViewDataSource:
roleForIndex?(index: number): "cell" | "header" | "footer";
// Default when omitted: "cell".
```

**Behavior:**
- `"cell"` (default): existing behavior. `tabIndex={0}`; click and Space/Enter fire `delegate.onSelect`; included in any internal nav.
- `"header"` / `"footer"`: cell wrapper carries `data-list-cell-role="header"` (or `"footer"`). `tabIndex={-1}`. Click and Space/Enter do NOT fire `delegate.onSelect`. Internal keyboard nav (when added) skips the cell. Cell renderers can still attach their own `onClick` handlers for action behavior.

**Compatibility:**
- Existing data sources that omit the method get `"cell"` for every index.
- Existing tests pass without modification.

#### Spec S06: `useFilteredDataSource` API {#s06-filter-api}

```ts
export function useFilteredDataSource(
  base: TugListViewDataSource,
  predicate: (baseIndex: number, base: TugListViewDataSource) => boolean,
  filterToken: unknown,
): FilteredTugListViewDataSource;

export interface FilteredTugListViewDataSource extends TugListViewDataSource {
  /** Returns the base index for the item at the given filtered index. */
  baseIndexFor(filteredIndex: number): number;
}
```

**Contract:**
- Subscribes to `base.subscribe`; on every base tick, re-projects.
- On every `filterToken` identity change (`Object.is` compare), re-projects.
- `getVersion()` returns a value whose identity changes on either trigger; reference-stable when neither trigger fired.
- `numberOfItems()` returns the count of base indices passing `predicate`.
- `idForIndex(i)` returns `base.idForIndex(baseIndexFor(i))`.
- `kindForIndex(i)` returns `base.kindForIndex(baseIndexFor(i))`.
- `roleForIndex(i)` (when defined) returns `base.roleForIndex?.(baseIndexFor(i))`.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/use-filtered-data-source.ts` | `useFilteredDataSource` hook + `FilteredTugListViewDataSource` interface |
| `tugdeck/src/components/tugways/__tests__/use-filtered-data-source.test.ts` | Filter-wrapper tests |
| `tugdeck/src/components/tugways/cards/gallery-list-view-headers.tsx` | Gallery card demonstrating header/footer roles |
| `tugdeck/src/components/tugways/cards/gallery-list-view-filter.tsx` | Gallery card demonstrating filter wrapper |
| `tugdeck/src/lib/tide-picker-data-source.ts` | `TidePickerDataSource` composite + `PickerRow` typed access |
| `tugdeck/src/lib/__tests__/tide-picker-data-source.test.ts` | Composite-data-source tests |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TugListViewDataSource.roleForIndex` | optional method | `tugdeck/src/components/tugways/tug-list-view.tsx` | New optional method per [Spec S05](#s05-role-api) |
| `data-list-cell-role` attribute | DOM attribute | `tug-list-view.tsx` cell wrapper | Set when role ≠ `"cell"` |
| `useFilteredDataSource` | hook | `tugdeck/src/components/tugways/use-filtered-data-source.ts` | Per [Spec S06](#s06-filter-api) |
| `FilteredTugListViewDataSource` | interface | same | Extends `TugListViewDataSource` with `baseIndexFor` |
| `TidePickerDataSource` | class | `tugdeck/src/lib/tide-picker-data-source.ts` | Implements `TugListViewDataSource`; typed `rowAt(i): PickerRow` |
| `PickerRow` | discriminated union | same | Seven kinds per [Spec S01](#s01-row-vocabulary) |
| `useTidePickerDataSource` | hook | same | Constructs the composite from `(recents, query, ledger)` |
| `TideProjectPickerForm` | function (rewritten) | `tugdeck/src/components/tugways/cards/tide-card.tsx` | Mounts `TugListView`; replaces recents column + radio group |
| picker cell renderers | components | `tide-card.tsx` (or new sibling file) | One per kind in [Spec S01](#s01-row-vocabulary) |

#### Files to delete or trim {#files-trimmed}

| File | Change |
|------|--------|
| `tide-card.css` | Remove `.tide-card-picker-recents`, `.tide-card-picker-recents-list`, `.tide-card-picker-pending-placeholder` rules; add `.tide-card-picker-list-view` and `[data-list-cell-role]` scoped rules |
| `tide-card.tsx` (within `TideProjectPickerForm`) | Delete the `recents.length > 0` block, the `TugRadioGroup` block, the `useResponderForm({ selectValue })` block, the radio-row `useId()` |

---

### Documentation Plan {#documentation-plan}

- [ ] `tug-list-view.tsx` module docstring: add a "Row roles" subsection describing `roleForIndex` and the `data-list-cell-role` attribute.
- [ ] `tug-list-view.tsx` module docstring: add a "Filtering" subsection linking to `use-filtered-data-source.ts` and the `gallery-list-view-filter` card.
- [ ] `use-filtered-data-source.ts`: full module docstring + JSDoc on the exported hook and interface, citing [Spec S06](#s06-filter-api) and the UISearchController split rationale.
- [ ] `tide-picker-data-source.ts`: module docstring describing the three-section enumeration, citing [Spec S01](#s01-row-vocabulary).
- [ ] [tugplan-tug-list-view.md §roadmap](./archive/tugplan-tug-list-view.md#roadmap): mark "Header / footer views" as shipped via this plan; mark "Picker migration onto `TugListView`" as shipped.
- [ ] [tugplan-tug-list-view.md §Q04](./archive/tugplan-tug-list-view.md#q04-headers-footers): note that the deferred header/footer feature shipped via row roles ([D02] in this plan) rather than full sections.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test individual functions, methods, and small components in isolation | `roleForIndex` defaulting; `useFilteredDataSource` projection logic; `TidePickerDataSource` row enumeration across input states |
| **Integration** | Test components working together | `TugListView` + role-aware cell wrappers; `TugListView` + filtered data source; `TideProjectPickerForm` end-to-end with a mocked ledger |
| **Drift Prevention** | Detect unintended behavior changes | Existing tide-card and tug-list-view tests must continue to pass without modification (Phase 0 is additive) |
| **Manual / Smoke** | Validate visual rendering and gestures | Each gallery card; the rewritten picker's main flows |

---

### Execution Steps {#execution-steps}

> Commit after all checkpoints pass. Patterns: each phase ends in an Integration Checkpoint step that depends on its constituent steps and uses `Commit: N/A (verification only)`.

#### Step 1: Phase 0 — Add `roleForIndex` to TugListView data source {#step-1}

**Commit:** `tugways(tug-list-view): add roleForIndex with header/footer behavior`

**References:** [D02] role-flat-list, [Spec S05](#s05-role-api), Risk R01, (#scope, #context, #strategy), [tugplan-tug-list-view.md §Q04](./archive/tugplan-tug-list-view.md#q04-headers-footers)

**Artifacts:**
- Edit `tugdeck/src/components/tugways/tug-list-view.tsx`:
  - Add optional `roleForIndex?(index: number): "cell" | "header" | "footer"` to `TugListViewDataSource`.
  - Read role per cell during render; default to `"cell"` when method is undefined.
  - Set `data-list-cell-role="header"` (or `"footer"`) on the cell wrapper when role ≠ `"cell"`.
  - When role ≠ `"cell"`: render with `tabIndex={-1}`; gate `delegate.onSelect` dispatch (click and Space/Enter handlers early-return).
  - Update module docstring with a "Row roles" section.
- Edit `tugdeck/src/components/tugways/__tests__/tug-list-view.test.tsx`:
  - Add cases: default role is `"cell"` for data sources without the method; `"header"` cells set the data attribute and `tabIndex={-1}`; clicking a `"header"` cell does not fire `onSelect`; existing transcript-shaped data sources are unaffected.

**Tasks:**
- [x] Add the `roleForIndex` declaration to `TugListViewDataSource`.
- [x] Thread the role through cell rendering.
- [x] Gate focus and `onSelect` on role.
- [x] Update the module docstring.
- [x] Add unit + integration tests.
- [x] Verify existing tests pass without modification.

**Tests:**
- [x] `bun test src/components/tugways/__tests__/tug-list-view.test.tsx` covers the new cases.
- [x] `bun test src/lib/__tests__/tide-transcript-data-source.test.ts` continues to pass (drift check).

**Checkpoint:**
- [x] `bun run check`
- [x] `bun test src/components/tugways/__tests__/tug-list-view.test.tsx`
- [x] `bun run audit:tokens lint`

---

#### Step 2: Phase 0 — Gallery card for header/footer roles {#step-2}

**Depends on:** #step-1

**Commit:** `tugways(gallery): add list-view headers gallery card`

**References:** [D02] role-flat-list, [Spec S05](#s05-role-api), (#success-criteria)

**Artifacts:**
- New file `tugdeck/src/components/tugways/cards/gallery-list-view-headers.tsx`: a card mounting `TugListView` over a synthetic data source that emits `[header, cell, cell, cell, footer]` (and similar permutations); cell renderers paint the kind name. Demonstrates the `data-list-cell-role` attribute is set and that headers/footers don't take focus.
- Edit `tugdeck/src/components/tugways/cards/gallery-registrations.tsx`: register the new gallery card.

**Tasks:**
- [x] Implement `GalleryListViewHeadersDataSource`.
- [x] Cell renderers for `cell`, `header`, `footer` kinds with distinct visual treatments.
- [x] Register in gallery.

**Tests:**
- [x] Manual smoke: open the gallery card; Tab through the list — focus skips header and footer cells.
- [x] Manual smoke: cells are visually distinct; the data attribute appears in DevTools.

**Checkpoint:**
- [x] `bun run check`
- [x] `bun run audit:tokens lint`
- [x] Manual: gallery card mounts, headers visually distinct, focus skips them.

---

#### Step 3: Phase 0 Integration Checkpoint {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `N/A (verification only)`

**References:** [D02] role-flat-list, (#success-criteria)

**Tasks:**
- [x] Confirm `roleForIndex` is shipped, defaults preserve existing behavior, and the gallery card demonstrates the new capability.

**Tests:**
- [x] Aggregate suite green.

**Checkpoint:**
- [x] `bun run check`
- [x] `bun test` (curated subset: TugListView primitive + its consumers — `tug-list-view.test.tsx`, `gallery-list-view-content.test.tsx`, `tide-card-transcript.test.tsx`, `tide-transcript-data-source.test.ts`. 101 pass / 0 fail / 446 ms. Full-suite run skipped per "no minutes-long runs.")
- [x] `bun run audit:tokens lint`
- [x] `cargo nextest run`

---

#### Step 4: Phase 1 — `useFilteredDataSource` helper {#step-4}

**Depends on:** #step-3

**Commit:** `tugways(tug-list-view): add useFilteredDataSource decorator hook`

**References:** [D01] uitableview-search-split, [Spec S06](#s06-filter-api), Risk R02, (#strategy)

**Artifacts:**
- New file `tugdeck/src/components/tugways/use-filtered-data-source.ts`:
  - `FilteredTugListViewDataSource` interface extending `TugListViewDataSource` with `baseIndexFor(filteredIndex): number`.
  - `useFilteredDataSource(base, predicate, filterToken)` hook returning the wrapper.
  - Internal `FilteredDataSource` class managing the `baseIndices: number[]` projection, base subscription, listener set, monotonic version counter.
  - Re-projection triggers: base tick, filterToken identity change.
  - Module docstring covering the UISearchController split rationale, the contract, and the [L02] `Object.is` version-stability requirement.
- New file `tugdeck/src/components/tugways/__tests__/use-filtered-data-source.test.ts`:
  - Empty base; all-pass; no-pass; predicate change; promotion of a previously-filtered item; drop of a previously-projected item; version-token reference stability under no change; `baseIndexFor` correctness across base reorder.

**Tasks:**
- [x] Implement the `FilteredDataSource` class.
- [x] Implement the `useFilteredDataSource` hook.
- [x] Write the module docstring.
- [x] Write the tests listed above.

**Tests:**
- [x] `bun test src/components/tugways/__tests__/use-filtered-data-source.test.ts` — all cases pass.

**Checkpoint:**
- [x] `bun run check`
- [x] `bun test src/components/tugways/__tests__/use-filtered-data-source.test.ts`
- [x] `bun run audit:tokens lint`

---

#### Step 5: Phase 1 — Gallery card for filter wrapper {#step-5}

**Depends on:** #step-4

**Commit:** `tugways(gallery): add list-view filter gallery card`

**References:** [D01] uitableview-search-split, [D09] wrapper-and-gallery-separate, [Spec S06](#s06-filter-api)

**Artifacts:**
- New file `tugdeck/src/components/tugways/cards/gallery-list-view-filter.tsx`:
  - 50-item synthetic data source.
  - `TugInput` above `TugListView`; the input's value drives a substring predicate via `useFilteredDataSource`.
  - Demonstrates host-owns-input split (input is outside the list view DOM).
- Edit `tugdeck/src/components/tugways/cards/gallery-registrations.tsx`: register the new card.
- Edit `tugdeck/src/components/tugways/tug-list-view.tsx`: add a "Filtering" subsection to the module docstring with a link to `use-filtered-data-source.ts`.

**Tasks:**
- [ ] Implement the gallery card.
- [ ] Register in gallery.
- [ ] Update `tug-list-view.tsx` JSDoc.

**Tests:**
- [ ] Manual smoke: typing narrows the list; deleting widens it; scroll position is stable across filter changes.

**Checkpoint:**
- [ ] `bun run check`
- [ ] `bun run audit:tokens lint`
- [ ] Manual: filter card behaves per the smoke checklist.

---

#### Step 6: Phase 1 Integration Checkpoint {#step-6}

**Depends on:** #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] uitableview-search-split, [D09] wrapper-and-gallery-separate, (#success-criteria)

**Tasks:**
- [ ] Confirm the wrapper API matches [Spec S06](#s06-filter-api), the gallery card mounts, and JSDoc cross-links resolve.

**Tests:**
- [ ] Aggregate suite green.

**Checkpoint:**
- [ ] `bun run check`
- [ ] `bun test`
- [ ] `bun run audit:tokens lint`
- [ ] `cargo nextest run`

---

#### Step 7: Phase 2 — `TidePickerDataSource` composite {#step-7}

**Depends on:** #step-3, #step-6

**Commit:** `tide(picker): add TidePickerDataSource composite adapter`

**References:** [D02] role-flat-list, [D11] notice-outside-list, [D12] picker-eager-filter, [Spec S01](#s01-row-vocabulary), [Spec S03](#s03-selection-invalidation)

**Artifacts:**
- New file `tugdeck/src/lib/tide-picker-data-source.ts`:
  - `PickerRow` discriminated union (seven kinds).
  - `TidePickerDataSource` class implementing `TugListViewDataSource`:
    - Inputs (passed at construction or via update methods): `recents: ReadonlyArray<string>`, `query: string`, `ledger: { status: "idle" | "pending" | "ready"; rows: SessionRow[] }`.
    - Internal eager filter on recents per [D12].
    - Section-emission logic per [Spec S01](#s01-row-vocabulary).
    - `roleForIndex(i)` returns `"header"` for `header-recents` / `header-sessions`, `"footer"` for `forget-all`, `"cell"` otherwise.
    - `idForIndex(i)`: `recents:<path>` for `path-recent`; `session:new` for `session-new`; `session:resume:<sessionId>` for `session-resume`; literal kind for singletons.
    - `kindForIndex(i)`: returns the row's kind.
    - `subscribe(listener)` / `getVersion()`: monotonic counter incremented on every `setInputs(...)` call.
    - Typed access: `rowAt(i): PickerRow`.
  - `useTidePickerDataSource(recents, query, ledgerSnapshot)` hook constructing and updating the composite.
- New file `tugdeck/src/lib/__tests__/tide-picker-data-source.test.ts`:
  - Empty recents + empty query → numberOfItems is 0.
  - Non-empty recents + empty query → header-recents + N path-recent rows.
  - Non-empty recents + matching query, ledger pending → header-recents + matching path-recent rows + loading.
  - Recents that match the query, with one recent exactly equaling the query → exact-match recent excluded.
  - Ledger ready with rows → header-sessions + session-new + N session-resume rows; forget-all iff non-live count > 0.
  - Ledger ready with zero rows → header-sessions + session-new only; no forget-all.
  - Live row → kind `session-resume`, `row.state === "live"`.
  - `idForIndex` stability across recents change (a session row's id is stable when its index shifts).
  - Subscribe/unsubscribe: one tick per upstream change.

**Tasks:**
- [ ] Define `PickerRow`.
- [ ] Implement `TidePickerDataSource`.
- [ ] Implement `useTidePickerDataSource`.
- [ ] Write the module docstring.
- [ ] Write the tests listed above.

**Tests:**
- [ ] `bun test src/lib/__tests__/tide-picker-data-source.test.ts` — all cases pass.

**Checkpoint:**
- [ ] `bun run check`
- [ ] `bun test src/lib/__tests__/tide-picker-data-source.test.ts`
- [ ] `bun run audit:tokens lint`

---

#### Step 8: Phase 2 — Picker cell renderers + scoped CSS {#step-8}

**Depends on:** #step-7

**Commit:** `tide(picker): add cell renderers for picker row kinds`

**References:** [D02] role-flat-list, [D04] path-recent-navigation, [D05] forget-all-direct, [D07] finder-style-truncation, [D08] structural-allcaps-fix, [Spec S01](#s01-row-vocabulary)

**Artifacts:**
- Edit `tugdeck/src/components/tugways/cards/tide-card.tsx`: add seven `TugListViewCellRenderer<TidePickerDataSource>` components. Per-cell callbacks (`onNavigate`, `onSelectSession`, `onRequestForgetSession`, `onRequestForgetAll`) flow through React context owned by `TideProjectPickerForm` (added in Step 9).
  - `HeaderRecentsCell` / `HeaderSessionsCell` — sentence-case label, `aria-hidden`-ish presentation. Inert per role.
  - `PathRecentCell` — plain text path, `direction: rtl` + `unicode-bidi: plaintext` + `text-overflow: ellipsis` per [D07]; `title` and `aria-label` carry full path. Click → `onNavigate(path)`.
  - `SessionNewCell` — "Start fresh" / "New session" stack; `data-selected` reflects consumer selection state.
  - `SessionResumeCell` — existing rich row layout; `data-selected` reflects consumer selection state; trailing trash icon for non-live rows; `live` / `failed` badges.
  - `ForgetAllCell` — quiet footer link; click → `onRequestForgetAll()`.
  - `LoadingCell` — `aria-live="polite"` "checking…".
- Edit `tugdeck/src/components/tugways/cards/tide-card.css`:
  - New scoped block under `.tide-card-picker-list-view` per [L20].
  - `[data-list-cell-role="header"]` styling (muted, small, sentence case, no uppercase).
  - `[data-list-cell-role="footer"]` styling (subdued link).
  - `[data-selected="true"]` highlight on session cells.
  - `direction: rtl; unicode-bidi: plaintext; text-overflow: ellipsis` on `.tide-card-picker-path-recent` per [D07].
  - Remove `.tide-card-picker-recents`, `.tide-card-picker-recents-list`, `.tide-card-picker-pending-placeholder` rules.

**Tasks:**
- [ ] Implement seven cell renderers.
- [ ] Define a React context for cell-renderer callbacks (or pass via props on the data source — pick the smaller surface).
- [ ] Add scoped CSS; remove obsolete rules.
- [ ] Verify `data-list-cell-role` styling renders as designed in DevTools.

**Tests:**
- [ ] Cell-renderer unit tests via `@testing-library/react` (render, click, role attribute, selected state).

**Checkpoint:**
- [ ] `bun run check`
- [ ] `bun test src/components/tugways/cards/__tests__/`
- [ ] `bun run audit:tokens lint`

---

#### Step 9: Phase 2 — Rewrite `TideProjectPickerForm` with `TugListView` {#step-9}

**Depends on:** #step-8

**Commit:** `tide(picker): replace recents-buttons + radio-group with TugListView`

**References:** [D03] select-then-open, [D04] path-recent-navigation, [D05] forget-all-direct, [D06] auto-select-session-new, [D08] structural-allcaps-fix, [D10] picker-owns-arrows, [D11] notice-outside-list, [Spec S01](#s01-row-vocabulary), [Spec S02](#s02-open-semantics), [Spec S03](#s03-selection-invalidation), [Spec S04](#s04-cancel-cascade), Risk R03

**Artifacts:**
- Edit `tugdeck/src/components/tugways/cards/tide-card.tsx`:
  - Inside `TideProjectPickerForm`:
    - Drop the `recents.length > 0` block (recents-as-buttons column).
    - Drop the `TugRadioGroup` block and its surrounding `useResponderForm({ selectValue })` block.
    - Drop the `tide-card-picker-pending-placeholder` div.
    - Add `selection: { kind: "session-new" } | { kind: "session-resume"; sessionId: string } | null` state.
    - Mount `<TugListView dataSource={pickerDataSource} delegate={pickerDelegate} cellRenderers={pickerCellRenderers} scrollKey="tide-card-picker" inline />` between the path input and the `tug-sheet-actions` row.
    - Implement `onSelect(index)` delegate that reads `dataSource.kindForIndex(index)` and dispatches: navigation for `path-recent`; selection update for `session-new` / non-live `session-resume`; confirm-panel open for `forget-all`; early return for headers / loading / live `session-resume`.
    - Implement `[Spec S03](#s03-selection-invalidation)` via `useLayoutEffect`.
    - Implement [D06] auto-default-to-`session-new` when SESSIONS first appears.
    - Implement [D10] keyboard handler: ArrowUp/ArrowDown moves selection across selectable rows (skipping headers / loading / path-recents / forget-all / live session-resumes); wraps at boundaries; Enter activates Open.
    - Update `submit()` to consume the new selection state per [Spec S02](#s02-open-semantics); preserve the defense-in-depth downgrade.
    - Update `handleFormKeyDown` Backspace handler: read selection state instead of `target.getAttribute("value")` for forget-on-Backspace.
    - Notice banner above `TugListView` per [D11] — unchanged from current code.
    - Cancel/Open buttons in `tug-sheet-actions` remain `TugPushButton` instances.
- Edit `tugdeck/src/__tests__/tide-card.test.tsx`:
  - Update selectors for the new DOM shape.
  - Add cases: select-then-Open for session-new and session-resume; click-to-navigate for path-recent; click-to-act for forget-all; arrow-key navigation skips inert rows; auto-select on first SESSIONS render; selection invalidation when the selected session vanishes.

**Tasks:**
- [ ] Refactor `TideProjectPickerForm` per the artifact list.
- [ ] Implement arrow-key navigation.
- [ ] Update tests.
- [ ] Manual smoke per [#manual-smoke-checklist](#manual-smoke-checklist) below.

**Tests:**
- [ ] `bun test src/__tests__/tide-card.test.tsx` — all cases pass.

**Checkpoint:**
- [ ] `bun run check`
- [ ] `bun test`
- [ ] `bun run audit:tokens lint`
- [ ] `rg 'TugRadioGroup\|TugRadioItem' tugdeck/src/components/tugways/cards/tide-card.tsx` returns zero matches.
- [ ] `rg 'TugPushButton' tugdeck/src/components/tugways/cards/tide-card.tsx` returns matches only inside `tug-sheet-actions` and the editor-settings sheet body.
- [ ] Manual smoke (see below).

##### Manual Smoke Checklist {#manual-smoke-checklist}

1. Open a Tide card → picker drops down → input focused.
2. Type a partial path → recents narrow with original case preserved.
3. Click a recent → input fills, list flips to SESSIONS, `Start fresh` is auto-selected.
4. Click an existing session row → selection moves to that row.
5. Click Open with `Start fresh` selected → `spawn_session` fresh.
6. Click Open with a `session-resume` selected → `spawn_session` resume.
7. Type a brand-new path → ledger settles with `Start fresh` only → click Open → fresh session.
8. Esc → sheet closes, card closes (cancel cascade).
9. ArrowUp/ArrowDown moves between selectable rows, skipping headers / loading / path-recents / forget-all / live rows.
10. Enter on a selected `session-resume` activates Open.
11. Per-row trash icon → confirm panel → confirm → row vanishes, panel closes, picker returns.
12. "Forget all sessions for this path" → confirm panel → confirm → all non-live rows vanish.
13. Path with one live session → `live` badge visible, row not selectable, arrow nav skips it.
14. Path retry notice (simulated): notice renders above the list view; Retry button works; list view is below the notice.

---

#### Step 10: Phase 2 — Tuglaws walkthrough + cleanup {#step-10}

**Depends on:** #step-9

**Commit:** `tide(picker): tuglaws walkthrough and cleanup`

**References:** [tuglaws.md](../tuglaws/tuglaws.md), [pane-model.md](../tuglaws/pane-model.md), [component-authoring.md](../tuglaws/component-authoring.md), [design-decisions.md](../tuglaws/design-decisions.md), (#constraints)

**Artifacts:**
- Final pass over `tide-card.tsx` and `tide-card.css` — remove any commented-out legacy code and orphaned selectors.
- Walk the rewrite against tuglaws and record findings in the commit message:
  - [L01] no extra `root.render`.
  - [L02] external state via `useSyncExternalStore`; recents, query (local), ledger.
  - [L03] event-dependent registrations in `useLayoutEffect`.
  - [L06] selection highlight is CSS (`[data-selected]`), not className concat.
  - [L11] no new chain handlers; `TUG_ACTIONS.CLOSE` cascade preserved.
  - [L19] new files follow component authoring guide.
  - [L20] new tokens scoped under the picker; no reach into `--tugx-list-view-*`.
  - [L23] `scrollKey="tide-card-picker"` distinct from `"tide-card-transcript"`.
- Update [tugplan-tug-list-view.md §roadmap](./archive/tugplan-tug-list-view.md#roadmap) entries: mark "Header / footer views" and "Picker migration onto `TugListView`" as shipped (note: the archive plan can be edited to reflect the shipped status, or a footnote added — pick whichever the team's archive convention prefers).

**Tasks:**
- [ ] Final pass over `tide-card.tsx` / `tide-card.css`.
- [ ] Walk tuglaws.
- [ ] Update archive plan annotation.
- [ ] Commit message records the walkthrough.

**Tests:**
- [ ] All four test/build commands green.
- [ ] `git diff --stat` shows orphaned CSS deleted.

**Checkpoint:**
- [ ] `bun run check`
- [ ] `bun test`
- [ ] `bun run audit:tokens lint`
- [ ] `cargo nextest run`

---

#### Step 11: Phase 2 Integration Checkpoint (Plan close) {#step-11}

**Depends on:** #step-7, #step-8, #step-9, #step-10

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Confirm all success criteria from [#success-criteria](#success-criteria) are met.
- [ ] Confirm the manual smoke checklist from Step 9 passes end-to-end.
- [ ] Confirm no regression in transcript or gallery list-view behavior.

**Tests:**
- [ ] Aggregate suite green.

**Checkpoint:**
- [ ] `bun run check`
- [ ] `bun test`
- [ ] `bun run audit:tokens lint`
- [ ] `cargo nextest run`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A `TugListView`-driven Tide project picker, built on a primitive that supports header/footer rows and a reusable filter-decorator hook.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] `roleForIndex` ships in `TugListView`; existing consumers unchanged. (verification: `bun test` green, transcript renders unchanged in manual smoke)
- [ ] `useFilteredDataSource` ships with full test coverage and a gallery card. (verification: `bun test`, manual gallery)
- [ ] `TideProjectPickerForm` is rewritten on top of `TugListView` + `TidePickerDataSource`. (verification: `rg` checks in [#success-criteria](#success-criteria) + manual smoke)
- [ ] All seven row kinds render correctly across the four input states (empty / partial-match / exact-known / exact-unknown). (verification: data-source unit tests + manual)
- [ ] Recent paths render with original case preserved. (verification: manual)
- [ ] Open semantics match [Spec S02](#s02-open-semantics). (verification: tests + manual)
- [ ] Cancel cascade matches [Spec S04](#s04-cancel-cascade). (verification: tests + manual)
- [ ] Tuglaws walkthrough recorded in the closing commit. (verification: commit message review)

**Acceptance tests:**
- [ ] `bun test src/components/tugways/__tests__/tug-list-view.test.tsx`
- [ ] `bun test src/components/tugways/__tests__/use-filtered-data-source.test.ts`
- [ ] `bun test src/lib/__tests__/tide-picker-data-source.test.ts`
- [ ] `bun test src/__tests__/tide-card.test.tsx`
- [ ] `cargo nextest run`

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] **Full UITableView-style sections** (`numberOfSections`, `numberOfItemsInSection`, `IndexPath`-shaped data source, sticky section headers). Earned when a consumer needs cross-section semantics that role-on-flat-list can't express.
- [ ] **Built-in arrow-key navigation in `TugListView`** with a selectability predicate. Earned when a second consumer reproduces the picker's arrow-nav handler.
- [ ] **Master/detail picker layout.** Earned when recents grow beyond ~15 entries with metadata that benefits from a dedicated pane.
- [ ] **Server-side recents filtering.** Drop-in replacement at the base data source layer; no primitive change needed.
- [ ] **Atom-aware path rendering.** Once paths support project-name + branch + workspace metadata as structured atoms, the `path-recent` cell renderer evolves to display them.

| Checkpoint | Verification |
|------------|--------------|
| Phase 0 primitive shipped | `bun test src/components/tugways/__tests__/tug-list-view.test.tsx` green; gallery-list-view-headers card mounts |
| Phase 1 primitive shipped | `bun test src/components/tugways/__tests__/use-filtered-data-source.test.ts` green; gallery-list-view-filter card mounts |
| Phase 2 picker shipped | `bun test src/__tests__/tide-card.test.tsx` green; manual smoke checklist passes |
| Tuglaws walkthrough | Commit message of the closing commit includes the eight-law walk |
| No regression | `bun test`, `bun run audit:tokens lint`, `cargo nextest run` all green |
