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

3. **Use `title` / `subtitle`, not `children`.** The structured path renders
   through `TugLabel`, so row text matches the rest of the app. The `children`
   escape hatch bypasses `TugLabel` entirely — reach for it *only* when the
   primary content is not a plain string (e.g. `<mark>`-highlighted search
   results, an RTL middle-ellipsis path), and then add a one-line comment
   justifying it and apply the shared title typography so it still reads
   consistently ([L20] keeps the row's tokens; the cell just opts into them).

4. **Single-select with a checkmark uses `selectedGlyph="check"`.** Never
   hand-roll a fixed-width check holder in `leading` — `selectedGlyph` reserves
   the column and aligns titles for you.

5. **Read-only listings pass `interactive={false}`.** A list that does not act
   on click should not imply it does (no hover affordance, out of the tab
   order).

6. **House layout is `flush`.** In-sheet listings use `rowLayout="flush"`.
   `pill` is reserved for free-standing, card-like rows *outside* a bordered list
   frame. A list inside a bordered frame uses `flush`.

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
| dev session picker (`dev-picker-cells`) | `TugListRow` title/subtitle + trailing trash | `selectionRequired` | |
| dev recents (`dev-picker-cells`) | `TugListRow` `children` (RTL path + `<mark>`, justified) | `selectionRequired` | |
| `rewind-sheet` | `TugListRow` title/subtitle | consumer | |
| transcript body-kinds (`path-list`, `todo-list`, `search-result`) | see [Sanctioned exceptions](#sanctioned-exceptions) | none, `inline` | |
| `dev-card-transcript` | custom streaming turn cells | none, `inline` | sanctioned exception |

## Sanctioned exceptions

A cell may bypass `TugListRow` only if it appears here with a rationale.

- **`dev-card-transcript` — streaming turn cells.** A transcript turn is not a
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

## Cross-references

- [component-authoring.md](component-authoring.md) — the general component
  author's checklist; this doc is its `TugListView`-specific addendum.
- [tuglaws.md](tuglaws.md) — [L06] appearance via CSS/DOM, [L15] token-driven
  state visuals, [L19] component authoring, [L20] component-token sovereignty,
  [L24] selection state ownership.
