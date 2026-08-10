/**
 * press-collapses-selection.ts — a press inside a standing
 * selection collapses it on the way down, not on the way up.
 *
 * Left to itself, a press landing *inside* a ranged selection does
 * not collapse it. WebKit and CM6 both defer the collapse to the
 * release, because that press might be the start of dragging the
 * selected text somewhere: CM6's `MouseSelection` sets
 * `dragging = null` for a single click inside the primary range and
 * only calls `select()` from its `mouseup`.
 *
 * The deferral buys drag-to-move and costs a wash. A selection
 * stays painted for as long as the button is held, so pressing
 * anywhere inside one lights that whole span until release — and
 * after a Select All, "inside the selection" is *everywhere*, so an
 * ordinary click in an editor flashes the entire document. That
 * flash reads as a bug every time it happens, and it happens on the
 * most ordinary gesture there is.
 *
 * So the press collapses the selection itself, before CM6's own
 * mousedown handler runs. CM6 then sees an empty selection, takes
 * its `dragging = false` branch, and behaves as it does for any
 * click on unselected text: the caret lands under the pointer, and
 * a drag from there extends a new selection. The trade is
 * deliberate — dragging selected text to move it within an editor
 * is given up, and press-drag inside a selection selects instead.
 *
 * Only a plain primary click is claimed. A secondary click keeps
 * the selection for the context menu that acts on it, Shift extends
 * it, Cmd adds a range, Alt starts a rectangular one, and a
 * double / triple click re-selects by word or line — CM6 collapses
 * on mousedown for all of those already, so none of them flash and
 * none of them are touched here.
 *
 * Laws: [L06] the gesture writes the editor's selection (document
 *        state) and paints nothing itself; [L19] one concern per
 *        file — substrate-internal pointer behavior, shared by
 *        every CM6 surface (`TugTextEditor`, the Text card's
 *        editor, `TugCodeView`) so the gesture cannot drift
 *        between them.
 */

import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Collapses a ranged selection to the click point on `mousedown`
 * when the press lands inside it. Returns `false` so CM6's own
 * mouse handling still runs — it needs to, since it is what starts
 * the drag-select and re-resolves the caret with its own
 * coordinate bias.
 */
export const pressCollapsesSelection: Extension = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || event.detail !== 1) return false;
    // Any modifier means the press is one of the gestures that
    // extends, adds to, or reshapes the selection rather than
    // replacing it — all of which CM6 already resolves on the way
    // down.
    if (event.shiftKey || event.metaKey || event.altKey || event.ctrlKey) {
      return false;
    }

    const main = view.state.selection.main;
    if (main.empty) return false;

    // `false` for the second argument: resolve a position even when
    // the press is outside the text (the blank band below short
    // content), the same reach CM6's own hit-test has.
    const pos = view.posAtCoords(
      { x: event.clientX, y: event.clientY },
      false,
    );
    if (pos < main.from || pos > main.to) return false;

    view.dispatch({
      selection: EditorSelection.cursor(pos),
      userEvent: "select.pointer",
    });
    return false;
  },
});
