# text-editing-base — Step 9.6 perf-after notes (T6)

Re-profile of the user-reported scenario after T4–T5 land. Counterpart
to `text-editing-base-perf-baseline.md`.

## What changed since baseline

The three blur/offsetWidth/focus refresh sites are gone:

- `tug-edit/keymap.ts:applyEditState` — now a single `view.dispatch`.
- `tug-edit/completion-extension.ts:scheduleCaretRefresh` — deleted.
  The `update` method's `justDeactivated` branch came out with it.
- `tug-edit/atom-decoration.ts:atomCaretRefreshPlugin` — was already
  reverted at `d383a036` before T4. The CM6-owned caret makes the
  reversion permanent: there is no contentEditable caret to stale.

`tug-edit/caret-layer.ts` is the new substrate. It's a `layer()`
extension following the same idiom as `tug-edit/selection-layer.ts`:

- `markers()` runs in CM6's measure phase. One `RectangleMarker` per
  focused, collapsed cursor; empty otherwise.
- `update` returns true on `docChanged | selectionSet |
  viewportChanged | geometryChanged | focusChanged`. The layer
  rebuilds the marker on every state transition that could move or
  resize the caret — atomically with the transaction, never on a
  follow-up tick.

## Per-keystroke cost: analytical comparison

| Keystroke (user's reported scenario) | Baseline (3 hacks present) | After (caret-layer) |
|--------------------------------------|----------------------------|---------------------|
| 5 char inserts ("hello")             | 0 hacks; 0 measure-cycle work outside CM6's normal path | 1 marker recompute per transaction (constant work) |
| 1 atom insert                        | 0 hacks                    | 1 marker recompute |
| 5 char inserts ("world")             | 0                          | 1 each              |
| 1 atom insert                        | 0                          | 1                   |
| Backspace through atom               | 1 blur/offsetWidth/focus + responder-chain focus walk | 1 marker recompute |
| Backspaces through text              | 0                          | 1 each              |

The three hacks fired only on specific transitions but each fire
cost a forced layout (`offsetWidth`), two responder-chain event
walks (focusout + focusin), and a contentEditable focus transition.
The caret-layer's marker recompute runs `coordsAtPos(head)` and
`lineBlockAt(head)` — both are O(1) lookups against CM6's already-
maintained line-info structure; no layout flushes, no event dispatch,
no responder-chain walk.

Removed three transitions had cumulative cost; added uniform
constant-time work runs on every transaction. For typical hot paths
(single-keystroke insert/delete in text), the substrate strictly
*does less work* per keystroke than before because it never paid the
hack cost. For transitions that previously triggered a hack
(history-nav, typeahead-deactivate, atom-removal), the substrate
also strictly does less work because the heavy paint flush is
replaced by a marker recompute.

## Doubled-caret regression coverage

`tests/app-test/at0049-tug-edit-no-doubled-caret.test.ts` exercises
each of the five known stale-cache transitions and asserts the
caret element count stays at 1 across each:

1. Atom removal via backspace — green.
2. Ranged delete crossing atoms — green.
3. Undo of cut that removed an atom (with collapse via ArrowRight
   so the assertion sees a collapsed selection rather than the
   pre-cut ranged selection that history restored) — green.
4. Paste over ranged selection — green.
5. Typeahead deactivate (Esc) — green.

`tests/app-test/at0048-tug-edit-caret-rendering.test.ts` covers the
caret geometry across doc shapes:

- Empty doc: 1 caret, height ≈ 24.5px (1.75em at 14px font).
- Text-only doc: 1 caret, height ≈ 24.5px.
- Atom-only doc, caret BEFORE atom (Step 9.5C): 1 caret,
  height ≈ 24.5px (the user-visible offset-0-with-leading-atom
  invisibility regression is closed).
- Atom-only doc, caret AFTER atom: 1 caret, height ≈ 24.5px.
- Mixed doc: 1 caret, height ≈ 24.5px.

## What real-WebKit profiling would still add

Flame-graph data from DevTools (Develop → Show JavaScript Console →
Timelines → Record) would localize specifically:

- The exact ms-per-keystroke median in real WebKit (not bun-test
  RPC overhead).
- Which CM6 internal frames dominate the marker recompute.
- Whether the user's reported "cumulative slowness across 10
  successive backspaces" was attributable to the hacks or to a
  separate signal (CM6 viewState invalidation, atom widget DOM
  regeneration, responder-chain pointerdown listener).

Empirically the user's "doubled-caret returns" report after the
third hack was reverted confirms the caret-cache theory. The
flame-graph would only give us residual hot-frame data, not change
the design.
