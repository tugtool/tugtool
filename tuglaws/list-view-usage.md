# TugListView Usage — House Rules

*One list primitive, one row. This is the single source of truth for how a
`TugListView` consumer renders rows, owns selection, and picks its knobs. Read
it before adding or touching any `TugListView` cell renderer.*

`TugListView` is the framework's windowed list primitive (UIKit `UITableView`
lineage). `TugListRow` is its row (UIKit `UITableViewCell` lineage) — it owns
the leading / content / trailing layout and the rest → hover → selected →
selected-hover state ramp, all token-driven ([L06], [L15]). A consumer supplies
a *data source* and a *cell renderer*; the cell renderer's job is to compose
`TugListRow`, not to reinvent it.

## The rules

1. **`TugListRow` is the only sanctioned row.** Every cell renderer composes
   `<TugListRow>` for its row chrome. A cell renders fully custom markup *only*
   when its content is not a row — rich streaming content, dense tabular data —
   and then it carries an inline comment naming it a sanctioned exception (see
   [Sanctioned exceptions](#sanctioned-exceptions)).

2. **No consumer reimplements the row state ramp.** Selection / hover / disabled
   row visuals belong to `TugListRow`. Consumer CSS must never paint
   `[data-selected]`, `:hover`, or `[data-disabled]` row *backgrounds* — that is
   a duplicate system that silently drifts from the primitive and won't inherit
   its improvements. Consumer CSS styles only consumer-specific affordances
   (a trailing trash reveal, a status badge), never the ramp.
   Both row text lines are ONE rendering path: `title` and `subtitle` each go
   through a single `TugLabel` whether the caller passes a string or a node, so
   `subtitleMaxLines` and the selected-row recolor behave identically for both.
   `.tug-list-row-title` / `.tug-list-row-subtitle` are naming hooks for a
   consumer that must bend one list's text; they declare no typography of their
   own.

3. **Use `title` / `subtitle`, not `children` — highlighted text included.**
   The structured path renders through `TugLabel`, so row text matches the rest
   of the app, and both slots accept a `ReactNode`: filter/search matches
   compose as `renderFilterHighlight(displayString, query)` straight into
   `title` / `subtitle`, keeping the row's typography, truncation, and selected
   recolor. Pass the string the row actually renders (already truncated,
   already abbreviated) — highlight ranges index THAT string, and ranges taken
   from a raw source field paint at the wrong offsets. The `children` escape
   hatch bypasses `TugLabel` entirely — reach for it *only* when the primary
   content is genuinely not text (an RTL middle-ellipsis path, a two-column
   matcher row), and then add a one-line comment justifying it and apply the
   shared title typography so it still reads consistently ([L20] keeps the
   row's tokens; the cell just opts into them).

4. **Single-select with a checkmark uses `selectedGlyph="check"`.** Never
   hand-roll a fixed-width check holder in `leading` — `selectedGlyph` reserves
   the column and aligns titles for you.

5. **Read-only listings pass `interactive={false}`.** A list that does not act
   on click should not imply it does (no hover affordance, out of the tab
   order).

6. **House layout is `flush`.** In-sheet listings use `rowLayout="flush"`.
   `pill` is reserved for free-standing, card-like rows *outside* a bordered list
   frame. A list inside a bordered frame uses `flush`.

7. **Rows are separated by a line OR a band, never both, and never from consumer CSS.** `rowSeparator` draws the hairline between rows; `rowStriping` tints alternate rows instead. They say the same thing, so a list that turns one on turns the other off — a striped list with hairlines too is stating its structure twice. Both are the primitive's, and the band especially cannot be hand-rolled in a consumer stylesheet: `:nth-child` is read against the *rendered window*, not the data, so a consumer zebra rule makes the bands crawl as the window slides under a scroll. The primitive publishes `data-row-parity` from the absolute row index for exactly this reason. Strength is a named rung (`"faint"` / `"subtle"` / `"medium"` / `"strong"` = 2 / 4 / 7 / 11%) or any percent; the tint is a wash of the surface's own text color, which is what lets one number read correctly on the dark themes and the light ones.

8. **A dense list sets its text measure once, with `rowTextSize`.** Rows in one list agreeing on a size matters more than each cell renderer picking for itself, so the prop deliberately outranks each `TugLabel`'s own `size`. It reaches the content column only — shrinking a list's type must not shrink its close boxes. Two lists that stack in one column (the Lens's Snippets and Text Files) share one measure from one place; see `lens-list-presentation.ts`.

## Selection ownership matrix

Pick the mechanism by the list's intent — do not invent a third path.

| List intent | Mechanism | Example |
|---|---|---|
| Always exactly one selected (navigation / picker) | `selectionRequired` — list-view-owned, mirrored via `onSelectionChange` ([L24]) | session picker, recents |
| Pick-to-confirm (commit on OK) | consumer-owned: `delegate.onSelect` → `useState` | model / effort picker |
| Read-only display | none + `interactive={false}` | skills / agents / help listings |
| Tool-output display | none + `inline` | transcript body-kinds |

## Consumer inventory

Every `TugListView` consumer and the row model it uses. Keep this current when
adding a consumer.

| Consumer | Cell model | Selection | Notes |
|---|---|---|---|
| `help-sheet` | `TugListRow` title/subtitle | none, read-only | |
| `agents-sheet` | `TugListRow` title/subtitle | none, read-only | |
| `skills-sheet` | `TugListRow` title/subtitle + leading | none, read-only | |
| `memory-sheet` | `TugListRow` title/subtitle | consumer | |
| `permission-mode-chip` | `TugListRow` title/subtitle + leading | consumer | |
| `model-picker-sheet` | `TugListRow` title/subtitle + `selectedGlyph` | consumer | |
| `effort-picker-sheet` | `TugListRow` title/subtitle + `selectedGlyph` | consumer | |
| `permission-rules-editor` | `TugListRow` (matcher rides `children`, justified) | consumer | |
| dev session picker (`session-picker-cells`) | `TugListRow` title/subtitle (both filter-highlighted) + trailing trash | `selectionRequired` | filtered by `TugFilterField` |
| dev recents (`session-picker-cells`) | `TugListRow` `children` (RTL path + `<mark>`, justified) | `selectionRequired` | |
| `/resume` overlay (`resume-sheet`) | the session-picker cells | none | filtered by `TugFilterField` |
| lens Sessions (`sessions-section`) | `TugListRow` title/subtitle + leading dot + trailing sparkline | none, cursor only | filtered by `TugFilterField` |
| lens Snippets (`snippets-section`) | `TugListRow` `children` (incipit, drag source + inline markdown) | `selectionRequired` | filtered by `TugFilterField`; one-line list — striping + measure from `lens-list-presentation.ts` |
| lens Text Files (`text-files-section`) | `TugListRow` title + leading close box + slot picker on the title line | none, cursor only | filtered by `TugFilterField`; one-line list — striping + measure from `lens-list-presentation.ts` |
| `gallery-list-view-filter` | custom path cells | none | the `useFilteredDataSource` wrapper's living contract |
| `rewind-sheet` | `TugListRow` title/subtitle | consumer | |
| transcript body-kinds (`path-list`, `todo-list`, `search-result`) | see [Sanctioned exceptions](#sanctioned-exceptions) | none, `inline` | |
| `session-card-transcript` | custom streaming turn cells | none, `inline` | sanctioned exception |

## Sanctioned exceptions

A cell may bypass `TugListRow` only if it appears here with a rationale.

- **`session-card-transcript` — streaming turn cells.** A transcript turn is not a
  row: it hosts streaming markdown, tool blocks, approval prompts, and inline
  questions, observed directly from stores ([L22]) and grown imperatively
  ([L06]). `AssistantTurnCell` and the user/tool turn cells are custom React
  components by design. They still participate in `TugListView` windowing,
  lifecycle, and `pageByEntry` navigation — only the *row chrome* is bespoke.

- **Tool-output body-kinds — `path-list-block`, `todo-list-block`,
  `search-result-block`.** Dense, status-driven tool-output rows, not
  title/subtitle rows: a todo row carries a per-status background band, a
  strikethrough-on-completed text decoration, a live `TugProgressIndicator`
  ring for the in-progress icon, and per-status single-line-vs-wrap behavior;
  path and search rows are monospace paths and match-count layouts. Expressing
  these through `TugListRow` would require pervasive overrides reaching into
  the primitive's internals (its title `TugLabel`, its padding, its background)
  — an [L20] token-sovereignty violation — and would regress the compact
  density these checklists depend on. They render in `inline` mode, hold no
  selection (so they do **not** duplicate the selection/disabled ramp), and
  their only state affordance is a `:hover` background drawn from the shared
  `--tugx-block-row-hover-bg` token. They remain custom cells by design.

## Filtering a list

A long list gets a `TugFilterField` (see its module docstring for the delegate
contract). Two mechanisms are sanctioned, and the choice is about the cells:

- **In-source** (every product surface). The data source takes a `filterQuery`
  input and applies `filterQueryMatch` inside its own `recompute()`. Rows,
  `rowAt`, `indexForId`, selection, and the cursor then live in ONE filtered
  coordinate space, which is what typed cell renderers (`dataSource.rowAt(i)`
  on a concrete class) need. **A list index names a row in the projection,
  never a position in the underlying document** — any consumer that turns an
  index back into a model object must go through the data source.
- **Wrapper** (`useFilteredDataSource`). The generic composition path, for
  consumers whose cells do not depend on a concrete data-source type; cells
  translate indices with `baseIndexFor`. `gallery-list-view-filter` is its
  living contract and the composition point for future sorting/grouping
  wrappers.

Matching is fuzzy, multi-term AND across a row's fields, and **ranked**: while a
query is active the rows sort best-match-first, and the moment it clears they
return to their native order untouched — so a drag-arranged or persisted order
is never rewritten, only temporarily set aside (reorder gestures are disabled
while a filter is on, so the two orders never fight).

One rule earns its keep on long lists: a match must be **compact**. `scoreMatch`
accepts any in-order character run, which is right for a ≤50-item popup and
useless over rows carrying whole sentences — five scattered letters "match" any
prompt, so a 900-row list filters to 900 rows. `filterMatchScore` rejects a
match whose span far exceeds the characters it matched, keeping the acronym-ish
hits (`sesldg` → `session-ledger-store`) and dropping the noise.

## Cross-references

- [component-authoring.md](component-authoring.md) — the general component
  author's checklist; this doc is its `TugListView`-specific addendum.
- [tuglaws.md](tuglaws.md) — [L06] appearance via CSS/DOM, [L15] token-driven
  state visuals, [L19] component authoring, [L20] component-token sovereignty,
  [L24] selection state ownership.
