/**
 * tug-edit/caret-layer.ts — custom CodeMirror 6 layer that paints a
 * single caret stroke at the head of a collapsed, focused selection.
 *
 * Replaces WebKit's contentEditable caret. The native caret renderer
 * caches paint geometry on focus and on scroll; layout-shifting
 * transitions that don't touch focus or scroll (history-nav doc swap,
 * typeahead-popup deactivate, atom removal via backspace / cut /
 * undo) leave the cache stale, and the new caret renders alongside
 * the cached one — the user sees doubled-caret strokes. Three patches
 * once flushed the cache by triggering `view.contentDOM.blur() →
 * offsetWidth read → view.focus()` after each known stale-able
 * transition. This layer makes those patches unnecessary by giving
 * CM6 ownership of caret rendering: there is no contentEditable
 * caret to stale; CM6 paints the caret atomically with each
 * transaction the same way `selection-layer.ts` paints the selection
 * background.
 *
 * Design contract (mirrors `selection-layer.ts`):
 *
 *   - `layer({ above: true })` so the caret stroke renders above
 *     selection background and text glyphs.
 *   - `markers()` returns `[]` when the editor isn't focused, when
 *     the main selection is ranged (caret is invisible during
 *     ranged-selection in standard caret semantics — selection paint
 *     handles the visible state), or when the head position has no
 *     coords (scrolled off-screen).
 *   - When focused + collapsed + visible, returns one
 *     `RectangleMarker`. Geometry:
 *     - `left = coords.left - base.left` (document-relative; same
 *       coordinate transformation `RectangleMarker.forRange` uses
 *       internally for empty ranges, lifted here so we can override
 *       height).
 *     - `top = view.lineBlockAt(head).top` (document-relative line
 *       top; uniform across atom-bearing and text-only positions).
 *     - `width = 2` (caret stroke width).
 *     - `height = view.lineBlockAt(head).height` (line-box height,
 *       which the `.cm-line::before` ghost in `theme.ts` pins to
 *       1.75em regardless of inline content).
 *   - Updates on `docChanged | selectionSet | viewportChanged |
 *     geometryChanged | focusChanged` so every transition that
 *     changes head position OR layout OR focus rebuilds the marker.
 *
 * Why the line-block-height geometry: `RectangleMarker.forRange` for
 * an empty range constructs the marker with `height = pos.bottom -
 * pos.top` from `coordsAtPos`, which is the *glyph* height — text
 * glyphs (~18px) vs atom widgets (24px) vs the line-height-pinning
 * ghost (24.5px) all give different answers. Substituting
 * `lineBlockAt(head).height` produces a uniform 24.5px caret that
 * never wobbles between text-only and atom-bearing positions.
 *
 * Why a custom layer instead of CM6's `drawSelection`: drawSelection
 * bundles `::selection: transparent !important` and `caret-color:
 * transparent !important` at `Prec.highest`; the former collides
 * with the substrate's existing `.cm-content ::selection { color }`
 * glyph-recolor rule. Building our own caret layer composes cleanly
 * with the existing `selection-layer.ts` overlay (same `layer()`
 * idiom, no precedence battles) and isolates the caret-rendering
 * concern from selection rendering.
 *
 * Laws: [L02] caret position is owned by CM6's `EditorState.selection`,
 *        not React state, [L06] caret painted via DOM layer (real DOM
 *        nodes — appearance-only), [L19] file structure (next to
 *        `selection-layer.ts`, the sister rendering layer), [L22]
 *        direct DOM-update observer (CM6 layer's `markers()` runs in
 *        the measure phase without a React round-trip).
 */

import { EditorView, layer, RectangleMarker } from "@codemirror/view";
import type { LayerMarker } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/** Caret stroke width in pixels. Matches WebKit's native caret stroke. */
const CARET_STROKE_WIDTH = 2;

/**
 * Document-relative origin used to translate viewport coordinates
 * returned by `coordsAtPos` into the layer's positioning context.
 * Layer markers are absolutely positioned with their parent at the
 * document origin, so left/top must be relative to the document
 * (scroller content area), not the viewport.
 *
 * Mirrors the private `getBase(view)` helper in
 * `@codemirror/view`'s `RectangleMarker.forRange` implementation —
 * lifted here so we can compose caret X with line-block Y / height
 * instead of taking the glyph rect wholesale.
 */
function documentBase(view: EditorView): { left: number; top: number } {
  const rect = view.scrollDOM.getBoundingClientRect();
  return {
    left: rect.left - view.scrollDOM.scrollLeft,
    top: rect.top - view.scrollDOM.scrollTop,
  };
}

/**
 * Caret-overlay layer. Paints a single `tug-edit-caret` div at the
 * head of the main selection when the editor is focused and the
 * selection is collapsed. Empty otherwise — selection-overlay paint
 * handles the visible state for ranged selections.
 */
export const tugCaretLayer: Extension = layer({
  above: true,
  class: "tug-edit-caret-layer",
  update(update) {
    return (
      update.docChanged
      || update.selectionSet
      || update.viewportChanged
      || update.geometryChanged
      || update.focusChanged
    );
  },
  markers(view: EditorView): readonly LayerMarker[] {
    if (!view.hasFocus) return [];
    const sel = view.state.selection.main;
    if (!sel.empty) return [];
    const coords = view.coordsAtPos(sel.head, 1);
    if (coords === null) return [];
    const lineBlock = view.lineBlockAt(sel.head);
    const base = documentBase(view);
    return [
      new RectangleMarker(
        "tug-edit-caret",
        coords.left - base.left,
        lineBlock.top,
        CARET_STROKE_WIDTH,
        lineBlock.height,
      ),
    ];
  },
});
