/**
 * tug-edit/selection-layer.ts — custom CodeMirror 6 layer that paints
 * `.cm-selectionBackground` divs behind every non-empty selection
 * range.
 *
 * This file deliberately does NOT use `drawSelection` from
 * `@codemirror/view`. `drawSelection` is a bundle of three concerns
 * (selection overlay, styled cursor, native-caret/native-selection
 * suppression at `Prec.highest` with `!important`) and only the first
 * is desirable here. The native caret is what we use for the visible
 * cursor — sized by line-box, uniform across text and atom positions
 * thanks to the `.cm-line::before` ghost element in `theme.ts`. Native
 * `::selection` is suppressed by a single rule in `theme.ts` so it
 * doesn't double-paint with this overlay.
 *
 * The overlay is a real DOM layer rendered behind the editable
 * surface. It survives editor blur (the layer keeps its DOM up
 * between updates) and covers atom widgets cleanly because it's
 * geometric — `RectangleMarker.forRange` walks the selected range
 * and emits one or more rect markers regardless of what content
 * the range covers.
 *
 * Laws: [L02] selection range data is owned by CM6's `EditorState`,
 *        not React state, [L06] overlay is appearance painted via
 *        DOM layer, [L19] file structure, [L22] direct DOM-update
 *        observer (CM6 layer's `markers()` is called on each update
 *        without any React round-trip).
 */

import { EditorView, layer, RectangleMarker } from "@codemirror/view";
import type { LayerMarker } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/**
 * Selection-overlay layer. Paints `.cm-selectionBackground` divs for
 * every non-empty range in the editor's current selection. Empty
 * ranges (carets) produce no markers — the visible caret is the
 * browser's native caret driven by `caret-color`.
 */
export const tugSelectionLayer: Extension = layer({
  above: false,
  class: "cm-selectionLayer",
  update(update) {
    return update.docChanged || update.selectionSet || update.viewportChanged;
  },
  markers(view: EditorView): readonly LayerMarker[] {
    const markers: RectangleMarker[] = [];
    for (const range of view.state.selection.ranges) {
      if (range.empty) continue;
      for (const piece of RectangleMarker.forRange(view, "cm-selectionBackground", range)) {
        markers.push(piece);
      }
    }
    return markers;
  },
});
