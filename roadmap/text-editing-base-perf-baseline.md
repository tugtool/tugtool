# text-editing-base — Step 9.6 baseline notes (T1, T2, T3)

This file gathers the pre-implementation profile (T1), root-cause
diagnosis (T2), and caret-strategy decision (T3) that gate Step 9.6's
implementation.

## T1 — Per-keystroke cost: existing three-hack baseline

### Code-level audit

The substrate currently flushes WebKit's contentEditable caret cache
in three places. Each site dispatches the same three operations:

```ts
view.contentDOM.blur();
void view.contentDOM.offsetWidth;   // forced layout flush
view.focus();
```

| # | Site | Trigger | Frequency on hot paths |
|---|------|---------|------------------------|
| 1 | `tug-edit/keymap.ts:applyEditState` | Cmd-Up / Cmd-Down history-nav restore | Once per history hop |
| 2 | `tug-edit/completion-extension.ts:scheduleCaretRefresh` | Typeahead-popup deactivate | Once per `@`/`/` session close |
| 3 | `tug-edit/atom-decoration.ts:atomCaretRefreshPlugin` | Atom decoration count decrease | Once per atom removal (currently reverted at d383a036; doubled-caret returns) |

### Per-operation cost (synchronous reasoning)

`blur()` schedules a focusout event and clears WebKit's cached caret
paint. `offsetWidth` forces a synchronous layout flush so the blur
commits before the next paint. `focus()` schedules a focusin event
and re-syncs the caret from `state.selection`. The three together:

- Two `Event` dispatches (focusout + focusin), each walked by the
  responder-chain provider's listeners. Cost grows with chain depth.
- One forced layout (offsetWidth) — invalidates pending style
  recalculations, recomputes line metrics, and stalls the next paint.
- One contentEditable focus transition — WebKit re-derives caret
  position from the live `Selection` object.

On a hot path (every keystroke that crosses an atom; every typeahead
session close; every history hop), this fires unconditionally even
when the cache wasn't actually stale.

### User-reported scenario

> type "hello" → insert atom → type "world" → insert atom →
> 10 successive backspaces

| Keystroke | Hacks fired (with all three present) | Hacks fired (3rd reverted) |
|-----------|--------------------------------------|----------------------------|
| 5 char inserts ("hello")        | 0                | 0                |
| 1 atom insert                   | 0 (no removal)   | 0                |
| 5 char inserts ("world")        | 0                | 0                |
| 1 atom insert                   | 0                | 0                |
| backspace 1 → through atom      | 1 (atom hack)    | 0 (none)         |
| backspace 2-5 → text            | 0                | 0                |
| backspace 6 → through atom      | 1 (atom hack)    | 0 (none)         |
| backspace 7-10 → text           | 0                | 0                |

**Observed symptoms** (from user reports):

- *With third hack reverted*: doubled-caret returns after first
  backspace through an atom. Confirms atom-removal triggers WebKit
  cache staleness.
- *With first and second hacks intact, third reverted*: cumulative
  slowness across the full sequence. The user reported perceptible
  lag accumulating across 10 successive backspaces even on text that
  no longer contains atoms.

The cumulative-slowness signal is harder to attribute. Plausible
contributors:

1. CodeMirror 6's `viewState` invalidation on per-keystroke
   transactions in a doc that recently had layout-shifting changes
   (atom removal repaints; line measurement caches re-fill).
2. Responder-chain pointerdown listener (the one fixed in 9.5B's
   second prong) walks parentId on every focusin/focusout. Disabling
   third hack removes one focusin/focusout per atom removal but
   leaves the other two cumulating focus events on Cmd-arrows /
   typeahead-cancel paths.
3. Atom widget DOM regeneration on each transition (CM6 `eq`
   compares regenToken; on atom regen the DOM is rebuilt).

Real-WebKit profiling (Develop → Show JavaScript Console → Timelines)
would localize the dominant cost. Without that, the analytical
expectation is the per-keystroke savings from *removing* the three
hacks dominates whatever cumulative-slowness signal the user
perceived — three blur/focus pairs per "doubled-caret event" plus
two more on adjacent paths. The CM6-owned caret design eliminates
the trigger entirely.

## T2 — Root cause: WebKit contentEditable caret cache staleness

### What was confirmed empirically (from prior commits and reports)

The three hacks are *empirical evidence* of three transitions that
trigger WebKit's caret-cache staleness. Each was added in response to
an observed doubled-caret symptom:

- **History-nav restore** (`applyEditState`, present since the keymap
  was introduced): Cmd-Up replaces the entire document and moves the
  selection. WebKit retains the prior frame's caret geometry. Without
  the blur/focus flush, the new caret renders at the restored
  position AND a leftover stroke at the old (typically position 0).
- **Typeahead-popup deactivate** (commit `e4ddd7e3`): the popup
  paints on top of the surface; closing it doesn't invalidate
  WebKit's cached caret paint. After the popup hides, the cached
  paint can remain at the pre-deletion column while the live caret
  renders at the post-deletion column.
- **Atom removal via backspace / cut / undo** (commit `8c5ce8bc`,
  reverted at `d383a036`): replacing an atom widget with a smaller
  rendering (or empty doc) leaves WebKit's caret cache pointing at
  the now-removed widget's geometry.

The user confirmed the third symptom returns *immediately* after
reverting the third hack: "we are back to doubled-up carets" after
"delete an atom or two".

### Why the cache stales

WebKit's contentEditable caret renderer caches paint geometry at
focus-time and on scroll. Layout-shifting transitions that *don't*
fire `focusin`/`focusout` and *don't* scroll skip the invalidation
hooks WebKit is listening on. The three transitions above all do
exactly that: they replace document content (changing line layout)
without touching focus or scroll.

`view.focus()` alone is a no-op when contentDOM is already focused
(WebKit short-circuits). The flush requires `blur()` first to drop
the cached paint, then `focus()` to install a fresh one. The
`offsetWidth` read between them forces layout to commit so the blur
happens before the focus call collapses with it (without the layout
flush, the focus transition can re-use the stale paint).

### Other transitions that should be checked

Beyond the three already patched, the following transitions
*plausibly* trigger the same staleness:

1. **Ranged delete crossing atoms** — covered by atom-removal class.
2. **Cmd-Z (undo of cut)** — atom widget reappears via inverted
   effect (Step 9.5B). Layout shift from no-widget to widget.
3. **Cmd-Z (undo of paste over selection)** — bigger document
   layout swap.
4. **Paste over a ranged selection** — replaces a range with new
   text/atoms, layout shift.

The CM6-owned caret design (T3) eliminates the cache as a
stale-able resource: WebKit's contentEditable caret is suppressed
via `caret-color: transparent`, and CM6 paints the visible caret as
a layer DOM node updated atomically with each transaction. No
cache, no staleness.

## T3 — Decision record: Option B (custom caret layer)

### The two options on the table

**Option A — `drawSelection` from `@codemirror/view` with height
override.** Bundles a `.cm-cursor` div sized from `coordsAtPos`'s
glyph rect. Override `.cm-cursor` height to `1.75em` to track
line-box. Pros: standard CM6 path. Cons: bundles `::selection`
suppression at `Prec.highest` with `!important`, fights with
`tug-edit/selection-layer.ts`'s overlay (which we keep), and forces
us to fight precedence on the existing `::selection { color: ... }`
glyph-recolor rule the substrate already declares for active
selection.

**Option B — Custom caret layer following the existing
`tug-edit/selection-layer.ts` pattern.** A new
`tug-edit/caret-layer.ts` extension built on `layer()` from
`@codemirror/view`. The layer's `markers()` returns a single
`RectangleMarker` for collapsed, focused selections; empty for
ranged or unfocused. The marker's geometry comes from
`view.coordsAtPos(head).left` (X) and
`view.lineBlockAt(head).top`/`.height` (Y / height) so the caret
height tracks the line-box rather than the glyph rect.
`theme.ts` flips `.cm-content { caret-color: transparent }` to
suppress WebKit's native caret. Pros: matches the existing
selection-overlay design idiom; no precedence battles; full control
over line-height parity; one CM6 measure-cycle integration point;
zero per-transaction side effects. Cons: ~50 lines of code we
maintain.

### Decision: Option B

Rationale, weighed against the criteria the roadmap calls out:

| Criterion | Option A | Option B |
|-----------|----------|----------|
| Line-height parity | Override `.cm-cursor` CSS to `1.75em` (CSS solution; works) | `lineBlockAt(head).height` directly (data solution; native) |
| Coexists with `selection-layer.ts` | drawSelection's `Prec.highest` `::selection: transparent !important` collides with our existing `::selection { color: ... }` glyph-recolor (we'd need to flip our rule to `!important` and possibly `Prec.highest`) | layer composes cleanly — same idiom, different markers function |
| Atom-widget caret room (Step 9.5C) | `coordsAtPos(0)` for leading-atom doc returns the atom's left edge; `.cm-cursor` painted at that X with overridden height fixes Step 9.5C | Same `coordsAtPos` answer; layer renders outside the inline-replaced widget hierarchy so the caret is unconstrained by widget bounds |
| Per-transaction cost | drawSelection's update fires on each transaction; same as Option B | layer's `markers()` fires in CM6's measure cycle; no per-transaction side effect |
| Maintenance surface | Smaller (~5 lines of CSS override + extension wiring) but tied to drawSelection's internals | Larger (~50 lines of TS) but fully in our codebase |
| Multi-cursor | drawSelection handles natively | Single-cursor today; multi-cursor needs an iteration over `selection.ranges` (TugEdit doesn't currently expose multi-cursor) |

The deciding factor is *zero per-transaction side effects* — which
both options technically satisfy, but Option A introduces precedence
battles whose interactions we'd then need to verify across every
combination of `tugSelectionLayer` / `::selection` / `cm-focused` /
`cm-readonly` we currently rely on. Option B is the lower-risk
landing.

### Implementation contract

`tug-edit/caret-layer.ts` exports `tugCaretLayer: Extension`. The
extension:

1. Returns `[]` from `markers()` when:
   - `view.hasFocus` is `false`, OR
   - `selection.main.empty` is `false` (ranged), OR
   - `view.coordsAtPos(head, 1)` is `null` (off-screen).
2. Otherwise returns a single `RectangleMarker` with:
   - `left = coords.left - getBase(view).left` (document-relative;
     same translation `RectangleMarker.forRange` uses internally).
   - `top = view.lineBlockAt(head).top` (document-relative; uniform
     across atom-bearing and text-only positions).
   - `width = 2` (caret stroke).
   - `height = view.lineBlockAt(head).height` (line-box height).
3. Updates on `docChanged | selectionSet | viewportChanged | geometryChanged | focusChanged`.

`theme.ts`:
- `.cm-content { caret-color: transparent }` (was `TOKENS.caret`)
- `.tug-edit-caret-layer { pointer-events: none }`
- `&.cm-focused > .cm-scroller > .tug-edit-caret-layer { animation: tug-edit-caret-blink 1.2s steps(1) infinite }`
- `@keyframes tug-edit-caret-blink { 0%, 100% {}; 50% { opacity: 0 } }`
- `.tug-edit-caret { background-color: var(--tug7-element-field-border-normal-plain-active) }`
- The existing `.cm-line::before` ghost element stays. It pinned the
  *native* caret's height to the line-box; with `caret-color:
  transparent` the ghost's height-pinning role is moot, but the
  ghost also pins the *line-box* height for atom-text mixed lines
  to a uniform 1.75em (so that `lineBlockAt(head).height` is a
  consistent 24.5px regardless of contents). Removing it would let
  text-only lines collapse to the glyph height. Keep it.

The three hacks come out together (T5), one commit. If a doubled
caret reappears after T5 in any scenario, T2 missed something —
re-diagnose, don't paper over.
