/**
 * gutter-line-selection.ts — click and drag the
 * line-number gutter to select whole lines.
 *
 * CM6 ships no gesture on the line-number gutter: `lineNumbers()`
 * renders the column and nothing more, so a press there fell
 * through to the browser, which selected the *number* rather than
 * the line it names. Every editor a person arrives from — Xcode,
 * VS Code, Sublime, GitHub — answers the same press by selecting
 * the line, and a drag by extending that selection line by line.
 * This is that gesture, as a set of gutter DOM handlers.
 *
 * The selection is whole-line and *includes the line break*, so a
 * selected line carries its own terminator: cut a line and the
 * lines around it close up rather than leaving a blank one behind.
 * The final line of the document has no terminator to include, so
 * it ends at the document end.
 *
 * The drag is anchored on the line first pressed, and runs in
 * either direction: dragging up from the anchor puts the head at
 * the top of the span (a reversed range), which is what keeps a
 * subsequent Shift-click or Shift-Arrow extending from the end the
 * pointer left. Shift-click extends the standing selection instead
 * of starting a new one, reading its anchor line back out of the
 * range — a reversed range's anchor sits at the *start of the line
 * after* its last line (that trailing break again), so the read
 * steps back one line in that case.
 *
 * Dragging past the top or bottom edge scrolls. The move events
 * stop arriving once the pointer stops moving, so a held pointer
 * outside the viewport would otherwise freeze mid-scroll: a timer
 * re-resolves the head line from the last pointer position on each
 * tick. That resolution is a height lookup *through the scrolled
 * document* — as the view scrolls, the same screen Y names a later
 * line — so the span keeps growing under a still pointer and comes
 * to rest at the document's end. The timer is an interval rather
 * than a rAF loop deliberately: a background window runs no
 * animation frames, and a gesture's outcome may never depend on
 * one.
 *
 * Laws: [L06] the gesture writes the editor's selection (document
 *        state), never React state; [L19] one concern per file —
 *        substrate-internal gutter behavior, shared by every
 *        gutter-bearing CM6 surface (`TugTextEditor`'s custom
 *        gutter and `TugCodeView`'s stock one) so the gesture
 *        cannot drift between them.
 */

import { EditorSelection, type EditorState, type SelectionRange } from "@codemirror/state";
import { EditorView, type BlockInfo } from "@codemirror/view";

/** How often a held drag re-reads its head line while scrolling. */
const AUTOSCROLL_TICK_MS = 33;

/** The document line number under a client Y, clamped to the document. */
function lineNumberAtClientY(view: EditorView, clientY: number): number {
  const block = view.lineBlockAtHeight(clientY - view.documentTop);
  return view.state.doc.lineAt(block.from).number;
}

/**
 * The whole-line range from `anchorLine` through `headLine`,
 * inclusive of both and of the last line's terminator. Reversed
 * when the head is above the anchor, so the range's head stays on
 * the edge the pointer is dragging.
 */
function lineSpan(
  state: EditorState,
  anchorLine: number,
  headLine: number,
): SelectionRange {
  const doc = state.doc;
  const forward = headLine >= anchorLine;
  const first = doc.line(forward ? anchorLine : headLine);
  const last = doc.line(forward ? headLine : anchorLine);
  const start = first.from;
  const end = Math.min(doc.length, last.to + 1);
  return forward
    ? EditorSelection.range(start, end)
    : EditorSelection.range(end, start);
}

/** The line a Shift-click should extend from — see the reversed-range note. */
function anchorLineOf(state: EditorState): number {
  const { anchor, head } = state.selection.main;
  const doc = state.doc;
  if (anchor > head && anchor > 0 && doc.lineAt(anchor).from === anchor) {
    return doc.lineAt(anchor - 1).number;
  }
  return doc.lineAt(anchor).number;
}

function onGutterMouseDown(
  view: EditorView,
  line: BlockInfo,
  event: Event,
): boolean {
  const mouse = event as MouseEvent;
  // Left button only, and never the macOS Control-click that opens a
  // context menu — both of those belong to whoever handles them next.
  if (mouse.button !== 0 || mouse.ctrlKey) return false;

  const anchorLine = mouse.shiftKey
    ? anchorLineOf(view.state)
    : view.state.doc.lineAt(line.from).number;
  let headLine = view.state.doc.lineAt(line.from).number;
  let pointerY = mouse.clientY;

  const apply = (): void => {
    view.dispatch({
      selection: lineSpan(view.state, anchorLine, headLine),
      scrollIntoView: true,
      userEvent: "select.pointer",
    });
  };

  apply();
  // The press is ours, so the browser never moves focus for it.
  if (view.state.facet(EditorView.editable)) view.focus();

  const track = (): void => {
    const next = lineNumberAtClientY(view, pointerY);
    if (next === headLine) return;
    headLine = next;
    apply();
  };

  const win = view.dom.ownerDocument.defaultView ?? window;
  const onMove = (moved: MouseEvent): void => {
    pointerY = moved.clientY;
    track();
  };
  const ticker = win.setInterval(track, AUTOSCROLL_TICK_MS);
  const onUp = (): void => {
    win.clearInterval(ticker);
    win.removeEventListener("mousemove", onMove);
    win.removeEventListener("mouseup", onUp);
  };
  win.addEventListener("mousemove", onMove);
  win.addEventListener("mouseup", onUp);

  return true;
}

/**
 * Gutter DOM handlers implementing the gesture. Pass as a gutter
 * config's `domEventHandlers` — `gutter({ domEventHandlers })` for
 * a custom gutter, `lineNumbers({ domEventHandlers })` for the
 * stock one.
 */
export const gutterLineSelectionHandlers: {
  [event: string]: (view: EditorView, line: BlockInfo, event: Event) => boolean;
} = {
  mousedown: onGutterMouseDown,
};
