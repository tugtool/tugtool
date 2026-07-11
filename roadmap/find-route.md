<!-- devise-skeleton v4 -->

## Find Route — Transcript Search in the Dev Card {#find-route}

**Purpose:** Add a **Find** route to the Dev card's prompt entry — a live, incremental
text search over the transcript with Case-sensitive / Entire-word / Grep toggles,
Next/Previous navigation, a match-count readout, wrap-around, and a landing flash on
each match — reachable by ⌘F or the route popup.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-07-11 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Dev card's prompt entry is a data-driven **route** system: the same editor
surface flips between `❯` Code, `$` Shell, and `?` btw by writing a single string
onto a per-entry `RouteLifecycle`. Each route is declared as data across a handful of
small lookup tables — there is no central switch. Today none of the routes searches
the transcript; the only find surfaces are CodeMirror-internal (a Text card's reveal
flash, a code view's search ping), and the ⌘F keybinding is a card-level stub that
currently resolves to whichever CM6 editor owns the active find session.

We want Find to be the transcript's universal search: type a query, see every match
tinted, jump between them with the active match flashed, and search **the content
that is actually expanded** — prose, thinking, tool input/output, and the bodies of
expanded tool-call blocks (including their embedded file/diff/code editors, which have
no find of their own today). Collapsed blocks are skipped. This is the first of three
planned new routes; it lands the route-as-search pattern the others will follow.

#### Strategy {#strategy}

- **Additive route.** Find slots into the existing route tables (`ROUTE_ITEMS`,
  `ROUTE_PREFIX_ALIAS`, `RETURN_ACTION_BY_ROUTE`, `DEV_PROMPT_PLACEHOLDER_BY_ROUTE`,
  `routeChipKeys`) exactly like Code/Shell/btw, plus one new per-entry store,
  `DevFindSession`, armed/torn-down via `RouteLifecycle`'s will/did observers.
- **Separate counting from painting.** The authoritative match set + "N of M" count
  is computed from a **data-model plain-text projection** of each searchable row
  (gated by expansion state), so the count is correct even for expanded rows scrolled
  off-screen and unmounted. Painting resolves DOM Ranges for currently-mounted content
  and repaints as `TugListView` windows rows in and out.
- **Reuse the proven highlight primitive.** Paint matches with the CSS Custom Highlight
  API — the same mechanism `selection-guard.ts` already uses for inactive selection —
  because it spans markdown DOM and CM6 content DOM uniformly, which no CM6 decoration
  can (the transcript is a virtualized custom list, not one editor).
- **Reuse the flash visual language.** The landing flash reuses the box-shadow-ring
  keyframe aesthetic of the Text-card reveal flash, applied to the transcript's active
  match rather than a CM6 line.
- **Build in visible vertical slices.** Chrome first (route + cluster + buttons), then
  counting, then painting, then flash, then extended scope, then the wrap graphic —
  each a slice runnable in the live-HMR app.
- **Appearance stays out of React.** All highlighting, the landing flash, and the wrap
  graphic are imperative DOM / Custom Highlight / Web-Animations work ([L06]); only the
  query, options, match set, and active index are store state read through
  `useSyncExternalStore` ([L02]).

#### Success Criteria (Measurable) {#success-criteria}

> Make these falsifiable.

- Pressing ⌘F with the Dev card focused (and no CM6 editor holding find) flips the
  prompt entry to the Find route and focuses the query editor (verify: type after ⌘F,
  characters land in the query, transcript search runs). (#s01-find-model)
- Typing a query that occurs N times across expanded transcript content shows the
  count chip reading `1 of N` and paints N tinted matches, the first stronger/active.
  (#s02-match-count, #s04-highlighting)
- Next / Previous (buttons, ⌘G / ⇧⌘G, or Return / Shift-Return) advance the active
  index with wrap-around; the active match scrolls into view clear of the sticky
  headers and flashes. (#s03-navigation, #s05-flash)
- Toggling Case sensitive / Entire word / Grep changes the match set live and the
  toggle state persists across a card reload (verify via tugbank defaults round-trip).
  (#s06-options)
- A match inside an **expanded** tool-call body (e.g. an expanded Read/Edit block's
  file content) is found and flashed; the same block **collapsed** yields no match.
  (#s07-scope)
- Wrapping past the last (or first) match shows a transient wrap-around graphic.
  (#s08-wrap)
- `bunx vite build` succeeds and `just app-test` passes. (#exit-criteria)

#### Scope {#scope}

1. A `⌕` Find route added to the prompt-entry route system with its own placeholder,
   route-trigger entry, and typed-prefix alias.
2. A per-entry `DevFindSession` store holding query, options, ordered matches, active
   index, and wrap state; armed on entering the route, cleared on leaving.
3. A pure transcript-search module implementing plain / case-sensitive / whole-word /
   grep (regex) matching over per-row text projections.
4. A data-model plain-text projection of searchable transcript content, gated by
   tool-block expansion state.
5. The Z4B Find cluster: a `TugOptionGroup` (Case sensitive · Entire word · Grep) and a
   match-count chip.
6. Z5 repurposed to Next with a Previous secondary button; `FIND_NEXT` / `FIND_PREVIOUS`
   navigation wired to buttons, ⌘G / ⇧⌘G, and Return / Shift-Return.
7. Custom-Highlight painting of all matches + the active match, repainted across
   windowing, plus a landing flash on the active match.
8. Search coverage extended into expanded tool-call bodies and their embedded CM6
   editors.
9. A transient wrap-around overlay graphic.
10. Persistence of the option toggles via tugbank defaults.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Searching **collapsed** tool-call content (explicitly excluded per the scope answer).
- Replace / find-and-replace — Find is read-only navigation.
- Searching non-transcript surfaces (other card types, the pane chrome).
- Regex capture-group extraction, multiline regex spanning row boundaries, or
  PCRE-only features beyond the JS `RegExp` engine.
- A results panel / occurrence list — matches live in the transcript, navigated in place.
- Changing the existing CM6-editor find (Text card / code view) — its leaf-first ⌘F
  ownership is preserved untouched.

#### Dependencies / Prerequisites {#dependencies}

- The route system in `tug-prompt-entry.tsx` (`ROUTE_ITEMS`, `ROUTE_PREFIX_ALIAS`,
  `RETURN_ACTION_BY_ROUTE`, `routeAwareSubmitButtonMode`, the `SELECT_VALUE` /
  `SELECT_ROUTE` / `SUBMIT` responder handlers) and `RouteLifecycle`
  (`lib/route-lifecycle.ts`).
- `DevRouteChromeManifest` (`chrome/dev-route-chrome-manifest.tsx`) and its
  `routeChipKeys` / `RouteChipKey` slot model; the `indicatorsContent` wiring in
  `dev-card.tsx`.
- `TugOptionGroup` (`tug-option-group.tsx`), `TugPushButton` / `TugButton`,
  `TugStableOverlay` (`internal/tug-stable-overlay.tsx`).
- The transcript host `DevTranscriptHost` (`cards/dev-card-transcript.tsx`) with its
  `scrollToIndex` imperative handle and `ToolBlockExpansionContext` provider; the
  `DevTranscriptDataSource` (`lib/dev-transcript-data-source.ts`); `TugListView`
  (`tug-list-view.tsx`) with `scrollToIndex` / `getElementForIndex`.
- The CSS Custom Highlight API pattern in `selection-guard.ts` and the type shim
  `types/highlight-api.d.ts`.
- `CanvasOverlayRoot` (`chrome/canvas-overlay-root.tsx`) for the wrap graphic;
  `ToolBlockExpansionState` (`cards/blocks/expansion-state.ts`) and
  `collapseDefaultFor` (`cards/blocks/tool-collapse-defaults.ts`) for expansion gating.
- tugbank defaults (`/api/defaults/<domain>/<key>`) for option persistence — no
  `localStorage` (project rule).

#### Constraints {#constraints}

- **WARNINGS ARE ERRORS.** The Rust side is unaffected, but tugdeck must pass
  `bunx tsc` / lint clean; the debug app loads the production rollup bundle, so
  `bunx vite build` must succeed before the change is declared done.
- **Tuglaws.** [L02] external state via `useSyncExternalStore`; [L03] registrations in
  `useLayoutEffect`; [L06] appearance via CSS/DOM never React state; [L26] one stable
  node for the Z5 button / identity badge across route flips; [D97] Z4A/Z4B/Z5 are
  layout slots whose occupant may change.
- **No `localStorage` / `sessionStorage` / IndexedDB** — option persistence goes
  through tugbank defaults.
- **Real, not fake.** No mock-store or jsdom render tests; verification drives the real
  Dev card via `just app-test` / the live app.

#### Assumptions {#assumptions}

- The prompt-entry editor content, while in the Find route, is the live query — search
  runs incrementally as the query changes (browser-style), not on an explicit submit.
- Matches are non-overlapping, left-to-right, top-to-bottom in flat-row order; the
  active match is a single index into that ordered list.
- Rendered visible text is what users search: the plain-text projection reduces
  markdown to its rendered text, keeps code/tool I/O verbatim, and both counting and
  painting operate over that same visible text so they agree.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit `{#anchor}` headings and rich `**References:**` lines. Plan-local
decisions are `[P01]`; global tuglaws decisions are cited as `[D97]` etc. Never cite
line numbers — cite anchors.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Shift-Return mapping to Find Previous (OPEN) {#q01-shift-return-previous}

**Question:** The prompt-entry return path is a `"submit" | "newline"` pair inverted by
Shift (see `RETURN_ACTION_BY_ROUTE` and the `returnAction` prop in `tug-prompt-entry.tsx`).
Return maps cleanly to Find Next by branching the `SUBMIT` handler. Can Shift-Return be
made Find Previous cleanly, given the substrate treats the shifted return as "newline"?

**Why it matters:** If the substrate's shifted-return can't be intercepted without
invasive editing, we should not contort it — Previous is already covered by the Z5
Previous button and ⇧⌘G.

**Options (if known):**
- Intercept the Find route's "newline" return branch in the prompt entry and dispatch
  `FIND_PREVIOUS` instead of inserting a newline (a single-line query never needs a
  newline anyway).
- Leave Shift-Return unbound in Find; rely on the Previous button + ⇧⌘G.

**Plan to resolve:** During `#step-4`, read the substrate's return handling in
`tug-text-editor` (the `returnAction` consumer inside `TugPromptEntry`); if the newline
branch is interceptable at the prompt-entry level, wire Previous; else defer.

**Resolution:** DECIDED default — Return→Find Next is required; Shift-Return→Find Previous
is best-effort in `#step-4`. If not cleanly interceptable, DEFERRED to the button + ⇧⌘G
(no follow-up plan needed — full Previous coverage still ships).

#### [Q02] Plain-text projection fidelity for markdown rows (OPEN) {#q02-projection-fidelity}

**Question:** How faithfully must the data-model projection of an `assistant_text`
(markdown) row match the rendered DOM text, so that the authoritative count (from the
projection) equals what the painter can highlight (from the DOM)?

**Why it matters:** A drift (e.g. counting a match inside `**bold**` markup the user
can't see) would show a phantom in the count with nothing painted.

**Options (if known):**
- Reduce markdown to plain text via the same parser the renderer uses
  (`TugMarkdownBlock`'s pipeline), extracting text nodes only.
- Search raw markdown source (simpler, but drifts from rendered text).

**Plan to resolve:** In `#step-5`, locate the markdown-to-DOM pipeline behind
`TugMarkdownBlock` and derive a text-only projection from the same AST; unit-test that
the projection of representative markdown equals the mounted node's `textContent`.

**Resolution:** DECIDED — project from the rendered text (option 1). Where a segment has
no cheap text projection, fall back to the mounted DOM `textContent` when available and
record the row as "count-deferred until mounted" (logged via `tugDevLogStore`, never
silently dropped).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Virtualized repaint misses matches in rows mounted after a scroll | med | high | Repaint on every window/scroll change; see `#r01-virtualized-repaint` | A scrolled-to match paints late or not at all |
| Projection ≠ rendered text → phantom counts | med | med | Project from rendered AST; `#q02-projection-fidelity` | Count exceeds paintable matches |
| Grep regex is catastrophically slow / invalid | low | med | Guard `RegExp` construction, cap work, treat invalid as zero matches; `#r02-regex-safety` | UI stalls on a pathological pattern |
| Sticky-header reveal strands the active match under pinned chrome | med | med | Reuse the sticky-clearing reveal math; `#r03-sticky-reveal` | Flashed match sits under the tool-block header |

**Risk R01: Virtualized repaint coverage** {#r01-virtualized-repaint}

- **Risk:** `TugListView` mounts only a window of rows; matches in rows that mount later
  (during a scroll or a scroll-to-match) won't be painted if we paint once.
- **Mitigation:**
  - Repaint the Custom Highlight ranges whenever the rendered window changes. `TugListView`
    exposes no window-change callback today; add a minimal `onRenderedRangeChange`
    notifier (or a `ResizeObserver` + scroll listener on the scrollport) and re-resolve
    ranges for currently-mounted content on each tick.
  - Keep the authoritative match set in the data-model projection so the count never
    depends on what's mounted; only the *paint* is best-effort per-window.
- **Residual risk:** A match in a row that never mounts is counted but not painted until
  navigated to (acceptable — navigating scrolls it into view, which mounts and paints it).

**Risk R02: Regex safety** {#r02-regex-safety}

- **Risk:** A user-entered grep pattern is invalid or pathological (ReDoS-style backtracking).
- **Mitigation:**
  - Construct `RegExp` in a try/catch; an invalid pattern yields zero matches and a subdued
    "invalid pattern" affordance (no throw).
  - Search per-row bounded strings (not the whole transcript concatenated), and cap total
    matches at a sane ceiling, logging truncation via `tugDevLogStore` (never a silent cap).
- **Residual risk:** A valid but slow pattern can still cost a frame on a huge transcript;
  acceptable for a user-initiated find.

**Risk R03: Sticky-header reveal** {#r03-sticky-reveal}

- **Risk:** Scrolling a match to `block: "start"` can strand it under the pinned
  tool-block header (`--tugx-pin-stack-top` + block-header height), a known transcript gotcha.
- **Mitigation:** Reuse the sticky-clearing reveal approach already used for match reveal
  in `body-kinds/file-block.tsx` (`handleScrollMatchIntoView`) — scroll so the match lands
  below the summed sticky chrome, not merely to the row top.
- **Residual risk:** Nested sticky depths differ per block kind; verify the flashed match
  is fully visible in `#step-7`.

---

### Design Decisions {#design-decisions}

#### [P01] Find is a route, not a mode (DECIDED) {#p01-find-is-a-route}

**Decision:** Find is a fourth prompt-entry route (`value: "⌕"`), added to `ROUTE_ITEMS`
and the route lookup tables, not a separate overlay or card mode.

**Rationale:**
- The route system is already the mechanism for "the editor means something different
  now" — swapping placeholder, Return semantics, Z4B occupant, and Z5 behavior — which
  is exactly what Find needs. [D97] designates Z4A/Z4B/Z5 as slots whose occupant may
  change on a route gesture.
- Reuses `RouteLifecycle`'s will/did observers ([D01]–[D03]) to arm/tear-down the find
  session with zero new lifecycle plumbing.

**Implications:**
- New entries in `ROUTE_ITEMS`, `ROUTE_PREFIX_ALIAS`, `RETURN_ACTION_BY_ROUTE`,
  `DEV_PROMPT_PLACEHOLDER_BY_ROUTE`, and a `RouteChipKey`/branch in `routeChipKeys`.
- `RETURN_ACTION_BY_ROUTE` gates the `SELECT_ROUTE` keyboard handler (membership check),
  so Find MUST be a key there.

#### [P02] Query lives in the editor; the session is the store (DECIDED) {#p02-query-in-editor}

**Decision:** The prompt-entry editor doc IS the query while in the Find route; on each
edit the entry pushes the query text into a per-entry `DevFindSession` store, which holds
options, matches, active index, and wrap state and is read via `useSyncExternalStore`.

**Rationale:**
- Keeps the query where the user types it (no parallel input), and keeps all derived
  search state in one [L02] store rather than scattered React state.
- One session per prompt entry mirrors `RouteLifecycle`'s per-entry scoping ([D01]).

**Implications:**
- `DevFindSession` recomputes matches when query, options, the transcript snapshot, or
  expansion state changes.
- Leaving the Find route (`routeWillChange`) clears the session (query, matches, paint).

#### [P03] Count from the data model, paint from the DOM (DECIDED) {#p03-count-vs-paint}

**Decision:** The authoritative match set and "N of M" count are computed from a
data-model plain-text projection of each searchable row (gated by expansion); Custom
Highlight painting resolves DOM Ranges only for currently-mounted content and repaints on
window change.

**Rationale:**
- Rows are virtualized — most are unmounted — so a DOM-only search would undercount.
- Painting can only touch mounted DOM, so it must be a separate, best-effort projection
  of the same authoritative match set. See `#r01-virtualized-repaint`.

**Implications:**
- Need a `rowSearchText(index)` projection keyed to visible text ([Q02]).
- Navigation scrolls a match into view (mounting it) before the painter can flash it.

#### [P04] Custom Highlight API for painting, not CM6 decorations (DECIDED) {#p04-custom-highlight}

**Decision:** Paint matches with the CSS Custom Highlight API — two registered
highlights, `transcript-find-match` (all matches) and `transcript-find-active` (current)
— rather than any CodeMirror decoration.

**Rationale:**
- The transcript is a custom virtualized list spanning markdown DOM and multiple
  independent CM6 subtrees; only the Custom Highlight API can paint ranges uniformly
  across all of them from one owner. `selection-guard.ts` already proves the pattern in
  this codebase, and the type shim (`types/highlight-api.d.ts`) is in place.

**Implications:**
- A single imperative highlighter owns `CSS.highlights.set/delete` for the two names,
  plus `::highlight(transcript-find-match)` / `::highlight(transcript-find-active)` CSS.
- All painting is [L06] appearance work — no React state drives it.

#### [P05] Z5 becomes Next; a secondary Previous button joins it (DECIDED) {#p05-z5-next-prev}

**Decision:** In the Find route the single Z5 button ([L26]) becomes **Next** (dispatches
`FIND_NEXT`); a **Previous** secondary button (dispatching `FIND_PREVIOUS`) mounts to its
left, reusing the same conditional-secondary-button slot the queue `+` button uses during
an in-flight turn.

**Rationale:**
- Matches the user's chosen layout: primary Z5 = Next, secondary-left = Previous.
- Keeps Z5 one node across routes ([L26]); only the icon / action / `data-mode` change,
  exactly as the existing submit-vs-stop projection does.

**Implications:**
- `routeAwareSubmitButtonMode` (or an equivalent projection) gains a Find branch that
  poses Z5 as Next; the `SUBMIT` handler branches to `FIND_NEXT` in the Find route.
- The secondary Previous button is CSS/route-gated like the queue button; it dispatches
  `FIND_PREVIOUS` via a direct handler, not the `SUBMIT` action.

#### [P06] Option toggles are multi-select and persisted via tugbank (DECIDED) {#p06-options-persist}

**Decision:** Case sensitive / Entire word / Grep are a `TugOptionGroup` (independent
toggles, `value: string[]`, `setValue` responder action); their state persists via a
tugbank default (`/api/defaults/find/options`), never `localStorage`.

**Rationale:**
- `TugOptionGroup` is exactly a multi-toggle group; radio/choice groups are wrong here.
- Project rule bans web storage; tugbank defaults are the persistence path.

**Implications:**
- The Find cluster owns the `value: string[]`, feeds it to `DevFindSession`, and
  read/writes the tugbank default on mount / change.
- Grep = regex; Entire word wraps `\b…\b`; Case sensitive toggles the flag — all compose
  (Spec S01).

#### [P07] ⌘F enters the Find route only when no CM6 editor owns find (DECIDED) {#p07-cmd-f-scope}

**Decision:** ⌘F resolves leaf-first through the responder chain: a focused CM6 editor
(Text card / code view) keeps its own `FIND`; otherwise a card-level `FIND` handler on the
Dev card's `card-content` responder enters the Find route and focuses the query editor.

**Rationale:**
- Preserves existing per-editor find (non-goal to change it) while giving the transcript a
  find when no editor claims it. The chain's first-responder-up walk gives this priority
  for free.

**Implications:**
- Add a `FIND` handler to the Dev card `card-content` responder that calls
  `setRoute("⌕")` + focus prompt. `FIND_NEXT` / `FIND_PREVIOUS` route to the find-session
  owner (the prompt entry / dev card) when the Find route is active.

---

### Deep Dives (Optional) {#deep-dives}

#### Route wiring touch-points {#route-wiring}

All in `tugdeck/src/components/tugways/tug-prompt-entry.tsx` unless noted. The route
system is data-driven; a new route is additive across these tables (each has an
explanatory docstring in the file):

- `ROUTE_ITEMS` — the ordered route list `{ value, label, icon }`; drives the popup and
  the width-stabilized trigger (`WIDEST_ROUTE_LABEL` is derived from it, so a longer label
  auto-widens). Add `{ value: "⌕", label: "Find", icon: <Search size={14} /> }`
  (`Search` from `lucide-react`).
- `ROUTE_PREFIX_ALIAS` — typed-prefix → route char; add a Find prefix if desired
  (`route-prefix-extension.ts` flips the route when the prefix is typed at offset 0).
- `RETURN_ACTION_BY_ROUTE` — `"submit" | "newline"` per route; the `SELECT_ROUTE`
  keyboard handler gates on membership here, so Find MUST appear. Set Find to `"submit"`
  and branch the `SUBMIT` handler to `FIND_NEXT` (see `#p05-z5-next-prev`). Consumed at
  the `returnAction` prop: `returnActionOverride ?? RETURN_ACTION_BY_ROUTE[route] ?? "submit"`.
- `routeAwareSubmitButtonMode` — route-conditional Z5 mode; add a Find branch posing Next.
- Responder handlers: `SELECT_VALUE` (popup pick) and `SELECT_ROUTE` (⇧⌘-shortcut) both
  funnel to `routeLifecycle.setRoute`; `SUBMIT` branches on route.
- `DevRouteChromeManifest` (`chrome/dev-route-chrome-manifest.tsx`): `routeChipKeys(route)`
  returns the ordered chip keys; add a Find branch returning `["identity", "find"]` (or
  just `["find"]` if the identity badge is not wanted in Find) and a `find` slot + prop.
- `dev-card.tsx`: `DEV_PROMPT_PLACEHOLDER_BY_ROUTE` (add `"⌕": "Find in transcript"`),
  and the `DevRouteChromeManifest` wiring (`indicatorsContent`) gains a `find={<DevFindCluster …/>}`
  slot.
- `keybinding-map.ts`: `{ key: "KeyF", meta: true, action: TUG_ACTIONS.FIND }` already
  exists (a card stub); `FIND_NEXT` (⌘G) / `FIND_PREVIOUS` (⇧⌘G) already exist. Optionally
  add a `SELECT_ROUTE "⌕"` chord for symmetry with ⇧⌘C/S/B.

#### Transcript search + navigation flow {#search-flow}

- **Text projection.** `DevTranscriptDataSource` (`lib/dev-transcript-data-source.ts`)
  surfaces message-derived rows (`user` / `assistant` / `ghost`) from a `CodeSessionStore`
  snapshot; `rowAt(index)` / `numberOfItems()` resolve typed row payloads. Add a
  `rowSearchText(index)` (or a sibling module) that projects each searchable row to visible
  plain text: `user` submission text; `assistant` run text (`assistant_text` → markdown
  reduced to text per [Q02]; `assistant_thinking` → verbatim; `tool_use` → tool
  input/output text **only when the block is expanded**). Expansion is read from the
  card's `ToolBlockExpansionState` (`cards/blocks/expansion-state.ts`,
  `resolve(toolUseId, collapseDefaultFor(toolName))`), provided by the transcript host via
  `ToolBlockExpansionContext`.
- **Match compute.** A pure `transcript-search.ts` takes the ordered per-row text +
  `FindOptions` and returns ordered `FindMatch[]` (`{ index, rowStart, rowEnd, … }`).
  Plain/case/word/grep semantics in Spec S01.
- **Navigation.** `DevFindSession` holds `activeIndex`; Next/Previous advance it with
  wrap. On change, call `DevTranscriptHost.scrollToIndex(rowIndex)` (pass-through to
  `TugListView.scrollToIndex`, which mounts + measures the row via its two-pass protocol),
  then the painter resolves the active match's DOM Range and flashes it, clearing sticky
  chrome per `#r03-sticky-reveal`.
- **Painting.** A `transcript-find-highlighter` walks currently-mounted rows
  (`getElementForIndex` / the rendered range), locates each match substring within the
  node's text (a text-node walker → `Range`), adds ranges to the `transcript-find-match`
  Highlight, and the active one to `transcript-find-active`. Repaint on window change
  (`#r01-virtualized-repaint`).

---

### Specification {#specification}

**Spec S01: Match semantics** {#s01-find-model}

- **Query** — the prompt-entry editor's plain text while in the Find route; empty query
  → zero matches, cleared paint.
- **FindOptions** — `{ caseSensitive: boolean; wholeWord: boolean; grep: boolean }`.
- **Plain** (grep off): substring search over each row's projected text. Case-insensitive
  unless `caseSensitive`. `wholeWord` requires match boundaries to be non-word on both
  sides (`\b` semantics over the projected text).
- **Grep** (grep on): the query is a JS `RegExp` source; flags `g` always, `i` unless
  `caseSensitive`. `wholeWord` wraps the source as `\b(?:…)\b`. Invalid source → zero
  matches (no throw), subdued invalid affordance (`#r02-regex-safety`).
- **Ordering** — matches are non-overlapping, discovered left-to-right within a row and
  rows in flat-row order (`DevTranscriptDataSource` index order); the ordered list indexes
  Next/Previous.
- **Scope** — searchable rows: `user`, `assistant` (text + thinking + expanded tool
  I/O), and expanded tool-call bodies incl. embedded editors. Collapsed tool blocks and
  `ghost` rows are excluded.

**Spec S02: Match count readout** {#s02-match-count}

- The count chip shows `‹active+1› of ‹total›` (1-based), or `No results` for a non-empty
  query with zero matches, or nothing for an empty query. Width-stabilized with
  `TugStableOverlay` so `1 of 9` → `10 of 90` never reflows. No click action.

**Spec S03: Navigation** {#s03-navigation}

- Next advances `activeIndex` by +1, Previous by −1, both modulo `total` (wrap). Triggers:
  Z5 Next button, Previous secondary button, ⌘G / ⇧⌘G, Return / Shift-Return (Shift-Return
  best-effort per [Q01]). Each advance scrolls the active match into view (sticky-clear)
  and flashes it. A wrap (crossing an end) raises the wrap graphic (Spec S05 / #s08-wrap).

**Spec S04: Highlighting** {#s04-highlighting}

- Two registered highlights: `transcript-find-match` (subtle tint, every match) and
  `transcript-find-active` (stronger, the active match only). Painted via the Custom
  Highlight API over mounted DOM; repainted on every rendered-window change. Cleared on
  query empty / leaving the Find route.

**Spec S05: Landing flash + wrap graphic** {#s05-flash}

- On each active-match landing, a one-shot flash reuses the reveal-flash visual language
  (`@keyframes` box-shadow accent ring, honoring `--tug-motion-*` and
  `prefers-reduced-motion`) — see the Text-card reveal flash for the exact aesthetic.
- On a wrap, a transient graphic mounts in `CanvasOverlayRoot` (a `position: fixed;
  inset: 0; pointer-events: none` layer) and animates via Web Animations (blink/fade,
  `tug-menu-item-blink` model), auto-removing after its animation window.

**Spec S06: Options + persistence** {#s06-options}

- `TugOptionGroup` items: `{ value: "case", label: "Case sensitive" }`,
  `{ value: "word", label: "Entire word" }`, `{ value: "grep", label: "Grep" }`;
  `value: string[]`; `setValue` responder handler updates the cluster's state and
  `DevFindSession`. State persists to tugbank `/api/defaults/find/options` (read on mount,
  write on change).

**Spec S07: Expansion-gated scope** {#s07-scope}

- A tool-call block contributes to the match set iff it is expanded, resolved through
  `ToolBlockExpansionState.resolve(toolUseId, collapseDefaultFor(toolName))`. Toggling a
  block's expansion recomputes the match set (the session subscribes to expansion changes).

**Spec S08: Wrap indication** {#s08-wrap}

- Wrap fires only when a Next from the last match returns to the first, or a Previous from
  the first returns to the last; not on ordinary steps. The graphic is transient and
  non-interactive.

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| Active route (incl. `⌕` Find) | structure/local-data | `RouteLifecycle` store + `useRoute` | [L02] |
| Session arm/teardown on route change | structure | `useRouteDelegate` (will/did) in `useLayoutEffect` | [L03] |
| Find query text | local-data | mirrored from editor doc into `DevFindSession` store + `useSyncExternalStore` | [L02] |
| Find options (case/word/grep) | local-data | `DevFindSession` store [L02] + `TugOptionGroup` `setValue` responder + tugbank default persistence | [L02] |
| Match set / active index / wrapped flag | local-data | `DevFindSession` store + `useSyncExternalStore` | [L02] |
| All-match + active-match paint | appearance | CSS Custom Highlight API, imperative DOM (no React state) | [L06] |
| Landing flash | appearance/animation | CSS `@keyframes` / WAAPI on DOM, not React state | [L06] |
| Wrap overlay graphic | appearance/animation | WAAPI in `CanvasOverlayRoot` portal; minimal node existence | [L06] |
| Z5 Next / Previous secondary button | structure | one Z5 node across routes + route-gated secondary button | [L26], [D97] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/dev-find-session.ts` | `DevFindSession` store + `FindOptions` / `FindMatch` types; per-entry search state ([P02]) |
| `tugdeck/src/lib/transcript-search.ts` | Pure match engine — plain/case/word/grep over per-row text (Spec S01) |
| `tugdeck/src/lib/transcript-search-text.ts` | `rowSearchText(index)` projection, expansion-gated (Spec S07, [Q02]) |
| `tugdeck/src/components/tugways/transcript-find-highlighter.ts` | Custom-Highlight painter + landing flash ([P04], Spec S04/S05) |
| `tugdeck/src/components/tugways/chrome/dev-find-cluster.tsx` | Z4B Find cluster: `TugOptionGroup` + match-count chip ([P06], Spec S02/S06) |
| `tugdeck/src/components/tugways/chrome/find-wrap-overlay.tsx` | Transient wrap graphic in `CanvasOverlayRoot` (Spec S08) |
| `tugdeck/src/components/tugways/chrome/dev-find-cluster.css` | Cluster layout |
| `tugdeck/src/components/tugways/transcript-find.css` | `::highlight(transcript-find-*)` + flash `@keyframes` |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ROUTE_ITEMS` | const | `tug-prompt-entry.tsx` | add `⌕` Find entry ([P01]) |
| `ROUTE_PREFIX_ALIAS` | const | `tug-prompt-entry.tsx` | optional Find prefix |
| `RETURN_ACTION_BY_ROUTE` | const | `tug-prompt-entry.tsx` | add `"⌕": "submit"` (gates `SELECT_ROUTE`) |
| `routeAwareSubmitButtonMode` | fn | `tug-prompt-entry.tsx` | Find branch → Next pose ([P05]) |
| `SUBMIT` handler | responder | `tug-prompt-entry.tsx` | Find branch → dispatch `FIND_NEXT` ([P05]) |
| Previous secondary button | JSX | `tug-prompt-entry.tsx` | route-gated, dispatches `FIND_PREVIOUS` ([P05]) |
| `routeChipKeys` / `RouteChipKey` / props | fn/type | `chrome/dev-route-chrome-manifest.tsx` | add `find` key + slot ([P01]) |
| `DEV_PROMPT_PLACEHOLDER_BY_ROUTE` | const | `cards/dev-card.tsx` | add Find placeholder |
| `indicatorsContent` wiring | JSX | `cards/dev-card.tsx` | supply `find={<DevFindCluster/>}` + own the session |
| `FIND` handler | responder | `cards/dev-card.tsx` (card-content) | enter Find route + focus prompt ([P07]) |
| `rowSearchText` | fn | `lib/transcript-search-text.ts` | projection (Spec S07) |
| `DevTranscriptHost` | component | `cards/dev-card-transcript.tsx` | expose expansion + projection access + rendered-range notifier ([R01]) |
| `onRenderedRangeChange` (or equiv) | prop/handle | `tug-list-view.tsx` | window-change notifier for repaint ([R01]) |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | `transcript-search` semantics (plain/case/word/grep, ordering, invalid regex) and `DevFindSession` navigation/wrap on real projected strings | Core match + nav logic |
| **Unit** | `rowSearchText` projection equals rendered `textContent` for representative rows ([Q02]) | Projection fidelity |
| **App-test** | Drive the real Dev card: ⌘F enters Find, type → count + paint, Next/Prev + wrap + flash, expansion gating | End-to-end behavior |
| **Build** | `bunx vite build` (rollup bundle the debug app loads) | Before "done" |

#### What stays out of tests {#test-non-goals}

- No mock-store or jsdom render tests (banned project pattern) — search logic is tested on
  real projected strings; UI behavior via `just app-test` against the real app.
- No screenshot pixel-diffing of the flash animation — its presence is asserted
  structurally; a collapsed-Range Custom Highlight can paint a spurious wash in WebKit
  screenshots (known gotcha), so assertions target range/attribute state, not pixels.

---

### Execution Steps {#execution-steps}

> Commit after all checkpoints pass. Each step is a slice runnable in the live-HMR app
> (except pure-logic Step 1). Commit on `main` (repo policy — the user commits).

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Search engine + session store (pure) | pending | — |
| #step-2 | Add the Find route (wiring only) | pending | — |
| #step-3 | Z4B Find cluster (options + count) | pending | — |
| #step-4 | Z5 Next / Previous + navigation | pending | — |
| #step-5 | Expansion-gated text projection + live match set | pending | — |
| #step-6 | Custom-Highlight painting + virtualized repaint | pending | — |
| #step-7 | Landing flash + sticky-clear reveal | pending | — |
| #step-8 | Extend scope into expanded tool/editor content | pending | — |
| #step-9 | Wrap-around overlay graphic | pending | — |
| #step-10 | Integration checkpoint | pending | — |

#### Step 1: Search engine + session store (pure) {#step-1}

**Commit:** `dev-find(engine): DevFindSession store + pure transcript-search (plain/case/word/grep)`

**References:** [P02] Query-in-editor/session-store, [P03] Count-vs-paint, Spec S01, Spec S03, (#search-flow, #p06-options-persist)

**Artifacts:**
- `lib/transcript-search.ts` — `search(rows: string[], query: string, opts: FindOptions): FindMatch[]`.
- `lib/dev-find-session.ts` — `DevFindSession` (store: `subscribe`/`getSnapshot`; state: `query`, `options`, `matches`, `activeIndex`, `wrapped`); `next()`/`previous()` with wrap; `FindOptions`, `FindMatch` types.

**Tasks:**
- [ ] Implement plain/case/word/grep matching with non-overlapping left-to-right ordering; invalid regex → `[]` (`#r02-regex-safety`).
- [ ] Implement `DevFindSession` as an [L02] store; `next`/`previous` compute wrap and set a `wrapped` flag when an end is crossed (Spec S03/S08).
- [ ] No React, no DOM in either module.

**Tests:**
- [ ] Unit: plain vs case-sensitive vs whole-word vs grep on crafted multi-row strings; ordering; empty query → `[]`; invalid regex → `[]`.
- [ ] Unit: `next`/`previous` cycle and set `wrapped` exactly at the crossing.

**Checkpoint:**
- [ ] `cd tugdeck && bun test` (or the project's TS unit runner) passes for the new modules.
- [ ] `bunx tsc --noEmit` clean.

---

#### Step 2: Add the Find route (wiring only) {#step-2}

**Depends on:** #step-1

**Commit:** `dev-find(route): add the ⌕ Find route to the prompt-entry route system`

**References:** [P01] Find-is-a-route, [P07] Cmd-F-scope, (#route-wiring), [D97], [L26]

**Artifacts:**
- `tug-prompt-entry.tsx`: `ROUTE_ITEMS` (+ `⌕` Find, `Search` icon), `RETURN_ACTION_BY_ROUTE` (`"⌕": "submit"`), optional `ROUTE_PREFIX_ALIAS` entry.
- `cards/dev-card.tsx`: `DEV_PROMPT_PLACEHOLDER_BY_ROUTE` (+ Find); construct one `DevFindSession` per card; a `FIND` handler on the `card-content` responder that `setRoute("⌕")` + focuses the prompt ([P07]).
- Arm/clear the session via `useRouteDelegate` (will → clear on leave, did → arm on enter) ([L03]).

**Tasks:**
- [ ] Add the route entry + placeholder + prefix alias; confirm the popup shows Find and the trigger width-stabilizes.
- [ ] Wire ⌘F (card-content `FIND`) to enter the route; confirm a focused CM6 editor still keeps its own find (leaf-first).
- [ ] Arm/teardown the `DevFindSession` on route enter/leave; mirror the editor doc into `session.query` on edit while in Find.

**Tests:**
- [ ] App-test: ⌘F on the Dev card (nothing else focused) flips to Find and focuses the query; typing updates `session.query` (assert via `tugDevLogStore` or a store read).

**Checkpoint:**
- [ ] `bunx vite build` succeeds.
- [ ] In the live app: ⌘F → route reads Find, placeholder shows, typing lands in the query editor.

---

#### Step 3: Z4B Find cluster (options + count) {#step-3}

**Depends on:** #step-2

**Commit:** `dev-find(chrome): Z4B Find cluster — Case/Word/Grep toggles + match-count chip`

**References:** [P06] Options+persist, Spec S02, Spec S06, (#route-wiring), [L02], [L06]

**Artifacts:**
- `chrome/dev-find-cluster.tsx` + `dev-find-cluster.css`: `TugOptionGroup` (case/word/grep) + count chip (`TugStableOverlay`).
- `chrome/dev-route-chrome-manifest.tsx`: add `"find"` to `RouteChipKey`, a `find` prop/slot, and a `routeChipKeys` branch for the Find route.
- `cards/dev-card.tsx`: pass `find={<DevFindCluster …/>}`; own the option `value: string[]`; persist to tugbank `/api/defaults/find/options`.

**Tasks:**
- [ ] Render the cluster in Z4B on the Find route; other routes unchanged (manifest branch).
- [ ] Wire `setValue` → cluster state → `session.options`; read/write the tugbank default.
- [ ] Count chip renders from `session` (`Spec S02` copy: `N of M` / `No results` / empty).

**Tests:**
- [ ] App-test: toggling Grep/Case/Word changes the match count on a known transcript; reload the card → toggles restore from tugbank.

**Checkpoint:**
- [ ] `bunx vite build` succeeds.
- [ ] Live: Find route shows the option group + count; toggles persist across a Maker ▸ Reload.

---

#### Step 4: Z5 Next / Previous + navigation {#step-4}

**Depends on:** #step-3

**Commit:** `dev-find(nav): Z5 Next + Previous secondary button, ⌘G/⇧⌘G, Return navigation`

**References:** [P05] Z5-next-prev, [Q01] Shift-Return-Previous, Spec S03, [L26], (#route-wiring)

**Artifacts:**
- `tug-prompt-entry.tsx`: `routeAwareSubmitButtonMode` Find branch (Next pose); `SUBMIT` handler Find branch → `FIND_NEXT`; a route-gated Previous secondary button (dispatches `FIND_PREVIOUS`).
- `FIND_NEXT` / `FIND_PREVIOUS` handlers on the find-session owner; ⌘G / ⇧⌘G already mapped.
- Navigation calls `DevTranscriptHost.scrollToIndex(rowIndex)` (scroll only; paint/flash arrive in #step-6/#step-7).

**Tasks:**
- [ ] Repurpose Z5 as Next in Find (one node, [L26]); mount Previous to its left.
- [ ] Wire Return → `FIND_NEXT`; attempt Shift-Return → `FIND_PREVIOUS`, else defer per [Q01].
- [ ] `next`/`previous` update `activeIndex` and scroll the active match's row into view.

**Tests:**
- [ ] App-test: Next/Prev (buttons + ⌘G/⇧⌘G) cycle `activeIndex` with wrap; the transcript scrolls to the active row.

**Checkpoint:**
- [ ] `bunx vite build` succeeds.
- [ ] Live: Next/Prev advance and scroll; count reads `k of M` tracking the active index.

---

#### Step 5: Expansion-gated text projection + live match set {#step-5}

**Depends on:** #step-4

**Commit:** `dev-find(scope): expansion-gated row text projection feeding the live match set`

**References:** [P03] Count-vs-paint, [Q02] Projection-fidelity, Spec S01, Spec S07, (#search-flow)

**Artifacts:**
- `lib/transcript-search-text.ts`: `rowSearchText(index)` over the `DevTranscriptDataSource` snapshot — `user` text, `assistant` text (markdown→text per [Q02]) + thinking, tool I/O **only when expanded** (via `ToolBlockExpansionState.resolve` + `collapseDefaultFor`).
- `dev-find-session.ts`: recompute matches when query, options, transcript snapshot, or expansion change; `DevTranscriptHost` exposes the projection + expansion access to the session.

**Tasks:**
- [ ] Build the projection from the data source; reduce markdown to rendered text ([Q02]); exclude collapsed tool bodies and `ghost` rows (Spec S07).
- [ ] Recompute on snapshot/expansion/query/options change; count now authoritative (Spec S02).

**Tests:**
- [ ] Unit: `rowSearchText` of representative markdown equals the rendered `textContent`.
- [ ] App-test: match in an expanded block counts; collapsing it drops the match (Spec S07).

**Checkpoint:**
- [ ] `bunx vite build` succeeds.
- [ ] Live: count matches hand-verified occurrences across expanded prose + tool I/O.

---

#### Step 6: Custom-Highlight painting + virtualized repaint {#step-6}

**Depends on:** #step-5

**Commit:** `dev-find(paint): Custom-Highlight all matches + active, repainted across windowing`

**References:** [P04] Custom-Highlight, Spec S04, Risk R01, (#p04-custom-highlight, #r01-virtualized-repaint), [L06]

**Artifacts:**
- `transcript-find-highlighter.ts`: register `transcript-find-match` / `transcript-find-active` Highlights; resolve `Range`s for mounted rows (text-node walker over `getElementForIndex` content); repaint on rendered-window change.
- `transcript-find.css`: `::highlight(transcript-find-match)` / `::highlight(transcript-find-active)`.
- `tug-list-view.tsx`: minimal `onRenderedRangeChange` notifier (or scroll/ResizeObserver hook) for repaint.

**Tasks:**
- [ ] Paint all mounted matches subtly, the active one stronger; clear on empty query / route leave.
- [ ] Repaint on window change so scrolled-in rows get their matches (Risk R01).

**Tests:**
- [ ] App-test: N matches paint; scrolling paints newly-mounted matches; clearing the query clears paint.

**Checkpoint:**
- [ ] `bunx vite build` succeeds.
- [ ] Live: every visible match is tinted; the active match is visually distinct.

---

#### Step 7: Landing flash + sticky-clear reveal {#step-7}

**Depends on:** #step-6

**Commit:** `dev-find(flash): landing flash on the active match, cleared of sticky headers`

**References:** Spec S05, Risk R03, (#s05-flash, #r03-sticky-reveal), [L06]

**Artifacts:**
- `transcript-find.css`: box-shadow-ring `@keyframes` (reuse the Text-card reveal-flash aesthetic; `--tug-motion-*`; `prefers-reduced-motion`).
- Highlighter: flash the active match on each landing; reveal-scroll clears summed sticky chrome (`--tugx-pin-stack-top` + block-header + file-header) per the `file-block.tsx` reveal approach.

**Tasks:**
- [ ] Flash the active match one-shot on navigation; honor reduced-motion.
- [ ] Ensure the flashed match lands below the pinned tool-block header, not under it (Risk R03).

**Tests:**
- [ ] App-test: navigating flashes the active match; the flashed match is fully visible (not under sticky chrome).

**Checkpoint:**
- [ ] `bunx vite build` succeeds.
- [ ] Live: each Next/Prev flashes the landing match, fully revealed.

---

#### Step 8: Extend scope into expanded tool/editor content {#step-8}

**Depends on:** #step-7

**Commit:** `dev-find(scope): search + paint inside expanded tool bodies and embedded editors`

**References:** Spec S07, [P03] Count-vs-paint, [P04] Custom-Highlight, (#search-flow)

**Artifacts:**
- `transcript-search-text.ts`: include expanded FileBlock/DiffBlock/CodeView content in the projection.
- `transcript-find-highlighter.ts`: resolve `Range`s inside CM6 `contentDOM` for mounted expanded editors (FileBlock sizes CM6 to content, so its lines are fully laid out when mounted).

**Tasks:**
- [ ] Project + paint matches inside expanded embedded editors; confirm collapsed ones contribute nothing.
- [ ] Navigate to and flash a match inside an expanded editor.

**Tests:**
- [ ] App-test: a query hitting an expanded Read/Edit file body counts, paints, and flashes; collapsing the block removes it.

**Checkpoint:**
- [ ] `bunx vite build` succeeds.
- [ ] Live: find lands inside an expanded file/diff/code body.

---

#### Step 9: Wrap-around overlay graphic {#step-9}

**Depends on:** #step-8

**Commit:** `dev-find(wrap): transient wrap-around overlay graphic on cycle crossing`

**References:** Spec S05, Spec S08, (#s08-wrap), [L06]

**Artifacts:**
- `chrome/find-wrap-overlay.tsx`: a transient graphic portaled into `CanvasOverlayRoot`, animated via WAAPI (blink/fade, `tug-menu-item-blink` model), auto-removed after its window.
- Session: raise the wrap signal only on an end-crossing (Spec S08).

**Tasks:**
- [ ] Show the graphic on wrap (Next-from-last / Prev-from-first), not on ordinary steps.
- [ ] Non-interactive, auto-dismissing; respects reduced-motion.

**Tests:**
- [ ] App-test: Next past the last match raises the wrap graphic once; an ordinary Next does not.

**Checkpoint:**
- [ ] `bunx vite build` succeeds.
- [ ] Live: wrapping shows the transient graphic; ordinary navigation does not.

---

#### Step 10: Integration checkpoint {#step-10}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5, #step-6, #step-7, #step-8, #step-9

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #exit-criteria), Spec S01–S08

**Tasks:**
- [ ] Verify the full flow end-to-end: ⌘F → type → count + paint → Next/Prev/⌘G/⇧⌘G + Return → wrap graphic → toggle options (persisted) → expanded-block match → Esc/route-switch exits and clears paint.

**Tests:**
- [ ] App-test: the aggregate Find scenario passes on a real resumed transcript.

**Checkpoint:**
- [ ] `bunx vite build` succeeds.
- [ ] `just app-test` passes.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A ⌘F-reachable Find route that searches expanded transcript content live,
paints all matches with an active-match flash, navigates with wrap, and persists its
Case/Word/Grep toggles.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] ⌘F (no CM6 editor focused) enters Find and focuses the query; CM6-editor find still wins when focused ([P07]).
- [ ] Query shows `N of M`, paints all matches, flashes the active one on each step (Spec S02/S04/S05).
- [ ] Next/Prev via buttons + ⌘G/⇧⌘G + Return wrap around with the wrap graphic (Spec S03/S08).
- [ ] Case/Word/Grep change the match set live and persist across reload (Spec S06).
- [ ] Matches inside expanded tool bodies are found; collapsed are not (Spec S07).
- [ ] `bunx vite build` succeeds and `just app-test` passes.

**Acceptance tests:**
- [ ] Unit suite for `transcript-search` + `DevFindSession` + `rowSearchText`.
- [ ] App-test aggregate Find scenario (#step-10).

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] The two further planned routes (this plan lands the route-as-search pattern they follow).
- [ ] Optional: a match inside a **collapsed** block auto-expands on navigate (currently excluded).
- [ ] Optional: find-and-replace.

| Checkpoint | Verification |
|------------|--------------|
| Route reachable | ⌘F / popup shows Find; placeholder + trigger correct |
| Search correct | count = hand-verified occurrences on a real transcript |
| Navigation | Next/Prev/⌘G/⇧⌘G/Return wrap + flash |
| Options persist | tugbank `/api/defaults/find/options` round-trip across reload |
| Scope gating | expanded block matches; collapsed does not |
| Build + tests | `bunx vite build` + `just app-test` |
