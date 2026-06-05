/**
 * tug-text-editor/selection-adapter.ts — `TextSelectionAdapter` factory backed
 * by a CodeMirror 6 `EditorView`.
 *
 * Adapts CM6's selection model to the substrate-neutral `TextSelectionAdapter`
 * interface (`text-selection-adapter.ts`), which the right-click context menu
 * consumes for Copy enablement and selected-text queries. CM6 is the source of
 * truth: the adapter reads `view.state.selection.main` directly and ignores
 * `window.getSelection()`.
 *
 * Selection *preservation* across a secondary-click is not the adapter's job —
 * it is handled at the source by the `EditorView.domEventHandlers.mousedown`
 * guard in `tug-text-editor.tsx` (which suppresses CM6's pointer selection for a
 * secondary-click over a range), so there is no capture / restore here.
 *
 * Laws: [L02] CM6 owns selection; the adapter reads through
 *        `view.state.selection`, [L06] no React state is mutated;
 *        selection changes flow through CM6 transactions,
 *        [L07] `view` is captured by closure and read at call time.
 */

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { TextSelectionAdapter } from "../text-selection-adapter";

/**
 * Create a `TextSelectionAdapter` backed by a CodeMirror 6 `EditorView`. The
 * returned adapter holds `view` by closure so every call reads the current
 * `view.state` ([L07]).
 */
export function createCMSelectionAdapter(view: EditorView): TextSelectionAdapter {
  return {
    hasRangedSelection(): boolean {
      const sel = view.state.selection.main;
      return sel.from !== sel.to;
    },

    getSelectedText(): string {
      const sel = view.state.selection.main;
      if (sel.from === sel.to) return "";
      return view.state.sliceDoc(sel.from, sel.to);
    },

    selectAll(): void {
      const len = view.state.doc.length;
      view.dispatch({
        selection: EditorSelection.range(0, len),
        userEvent: "select",
      });
    },
  };
}
