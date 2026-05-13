/**
 * tug-text-editor/selection-adapter.ts — `TextSelectionAdapter` factory backed
 * by a CodeMirror 6 `EditorView`.
 *
 * Adapts CM6's selection model to the substrate-neutral
 * `TextSelectionAdapter` interface declared in
 * `text-selection-adapter.ts`. The right-click context menu, copy
 * enablement, and word-at-point expansion all consume that interface,
 * so a single concrete adapter per editing model keeps the menu and
 * its callers free of model-specific branching ([D01]).
 *
 * Selection model: `view.state.selection.main`. CM6 is the source of
 * truth — the global DOM Selection follows CM6's transactions, never
 * the other way around. The adapter therefore reads `from` / `to` /
 * `head` from CM6 directly and ignores `window.getSelection()`. That
 * matches the rest of the substrate ([L02]).
 *
 * Right-click classification ("near-caret" / "within-range" /
 * "elsewhere") uses CM6 layout — `view.coordsAtPos` for selection
 * geometry, `view.state.wordAt` for the caret's surrounding word.
 * Position semantics over screen geometry would be tempting (one
 * `posAtCoords` call) but the historical UX is geometric: a click on
 * the trailing whitespace of a selected line should still register as
 * "within-range" because it falls inside the painted highlight rect.
 * Using rects keeps that parity with `tug-prompt-input` ([L20]).
 *
 * Mutation methods (`selectAll`, `expandToWord`, `selectWordAtPoint`)
 * dispatch CM6 transactions with `userEvent: "select"`. The adapter
 * does not focus the view — the caller (typically the contextmenu
 * handler in `tug-text-editor.tsx`) already owns focus management.
 *
 * Laws: [L02] CM6 owns selection; the adapter reads through
 *        `view.state.selection`, [L06] no React state is mutated;
 *        selection changes flow through CM6 transactions,
 *        [L07] `view` is captured by closure and read at call time,
 *        [L11] adapter exposes selection queries / mutations as a
 *        flat API; the menu and its action handlers wire it into
 *        the responder chain, [L19] file structure, [L20] geometric
 *        right-click classification matches `tug-prompt-input`'s
 *        existing UX.
 */

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type {
  RightClickClassification,
  TextSelectionAdapter,
} from "../text-selection-adapter";

// ---------------------------------------------------------------------------
// Hit testing helpers
// ---------------------------------------------------------------------------

/** Plain bounding rect in viewport coordinates. */
interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Build per-line bounding rects covering `[from, to)` in `view`.
 *
 * The rects are in viewport coordinates and follow CM6's painted
 * selection layout: one rect per visual line that the range crosses.
 * Each rect is derived from `view.coordsAtPos` at the line's left and
 * right ends within the range. `view.coordsAtPos` returns `null` when
 * the position has no rendered geometry — e.g. when called before the
 * editor has measured its layout, or when the position falls in a
 * folded region. The line is skipped silently in that case.
 *
 * Returns an empty array when `from >= to`.
 */
function rectsForRange(view: EditorView, from: number, to: number): Rect[] {
  if (from >= to) return [];
  const rects: Rect[] = [];
  const doc = view.state.doc;
  let pos = from;
  while (pos < to) {
    const line = doc.lineAt(pos);
    const lineEnd = Math.min(line.to, to);
    let startCoords: ReturnType<typeof view.coordsAtPos> = null;
    let endCoords: ReturnType<typeof view.coordsAtPos> = null;
    try {
      startCoords = view.coordsAtPos(pos, 1);
      endCoords = view.coordsAtPos(lineEnd, -1);
    } catch {
      // Layout-less environments throw from coordsAtPos; treat as
      // "no geometry available" and skip.
    }
    if (startCoords !== null && endCoords !== null) {
      rects.push({
        left: Math.min(startCoords.left, endCoords.left),
        right: Math.max(startCoords.right, endCoords.right),
        top: Math.min(startCoords.top, endCoords.top),
        bottom: Math.max(startCoords.bottom, endCoords.bottom),
      });
    }
    // Step over the trailing newline of this line (if the range
    // continues) so the next iteration starts at the next line's
    // first character. If the range ends mid-line, the loop's `pos
    // < to` guard ends iteration on the next check.
    pos = lineEnd >= line.to ? line.to + 1 : lineEnd;
  }
  return rects;
}

/** True when `(x, y)` falls inside any of `rects`. */
function pointInRects(rects: readonly Rect[], x: number, y: number): boolean {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// createCMSelectionAdapter
// ---------------------------------------------------------------------------

/**
 * Create a `TextSelectionAdapter` backed by a CodeMirror 6 `EditorView`.
 *
 * The returned adapter holds `view` by closure so every call reads the
 * current `view.state` — selection / document mutations between calls
 * are reflected without re-creating the adapter ([L07]).
 *
 * Used by `tug-text-editor.tsx` to drive `TugEditorContextMenu`: the
 * contextmenu listener instantiates an adapter, asks
 * `classifyRightClick` how to position the menu (preserve / expand /
 * pick a fresh word), and passes `hasRangedSelection()` into the menu
 * so Cut / Copy enablement matches the user's actual selection.
 */
export function createCMSelectionAdapter(view: EditorView): TextSelectionAdapter {
  /**
   * Snapshot of the primary selection captured at right-click
   * `pointerdown`, stored as CM6 `from` / `to` so a transaction can
   * rebuild the same range. `null` between right-clicks or when the
   * pointerdown landed outside the editor's contentDOM.
   */
  let preClickSnapshot: { from: number; to: number } | null = null;

  /**
   * True when the primary selection range is non-empty. Multi-range
   * selections are uncommon in the substrate but only the main range
   * affects clipboard / menu enablement, mirroring the rest of the
   * adapter family.
   */
  function hasRangedSelection(): boolean {
    const sel = view.state.selection.main;
    return sel.from !== sel.to;
  }

  /**
   * Selected text from the primary range. Empty string when the
   * selection is collapsed.
   */
  function getSelectedText(): string {
    const sel = view.state.selection.main;
    if (sel.from === sel.to) return "";
    return view.state.sliceDoc(sel.from, sel.to);
  }

  /** Select the entire document via a CM6 transaction. */
  function selectAll(): void {
    const len = view.state.doc.length;
    view.dispatch({
      selection: EditorSelection.range(0, len),
      userEvent: "select",
    });
  }

  /**
   * Expand a collapsed caret to the surrounding word. No-op when the
   * selection is already ranged (matches the engine adapter's policy:
   * preserve a ranged selection rather than collapse + reselect) or
   * when the caret sits on whitespace / punctuation
   * (`view.state.wordAt` returns null).
   */
  function expandToWord(): void {
    const sel = view.state.selection.main;
    if (sel.from !== sel.to) return;
    const word = view.state.wordAt(sel.head);
    if (word === null) return;
    view.dispatch({
      selection: EditorSelection.range(word.from, word.to),
      userEvent: "select",
    });
  }

  /**
   * Classify a right-click against the current selection.
   *
   * Ranged selection: a click whose viewport coordinates fall inside
   *   any of the selection's per-line rects is `"within-range"`.
   *   Otherwise `"elsewhere"`.
   *
   * Collapsed caret: find the caret's surrounding word via
   *   `view.state.wordAt(sel.head)`. If a word exists and the click
   *   falls inside its rects, the result is `"near-caret"`. Otherwise
   *   `"elsewhere"` — including the case where the caret sits on
   *   whitespace or punctuation (no word) and the case where the
   *   click is far from the caret's word.
   *
   * The geometric approach matches `tug-prompt-input`'s adapter so
   * cross-substrate UX stays identical: a click on the trailing
   * whitespace of a selected line still classifies as
   * "within-range" because it falls inside the painted highlight
   * rect, not just the character offsets.
   */
  function classifyRightClick(
    clientX: number,
    clientY: number,
  ): RightClickClassification {
    const sel = view.state.selection.main;
    if (sel.from !== sel.to) {
      const rects = rectsForRange(view, sel.from, sel.to);
      return pointInRects(rects, clientX, clientY) ? "within-range" : "elsewhere";
    }
    const word = view.state.wordAt(sel.head);
    if (word === null) return "elsewhere";
    const rects = rectsForRange(view, word.from, word.to);
    return pointInRects(rects, clientX, clientY) ? "near-caret" : "elsewhere";
  }

  /**
   * Place the caret at the click point and expand it to the
   * surrounding word. Used by the contextmenu handler when
   * `classifyRightClick` returned `"elsewhere"` — the menu opens over
   * a fresh word at the click point rather than preserving a stale
   * selection elsewhere.
   *
   * `view.posAtCoords` resolves the click to a document position;
   * `view.state.wordAt` finds the word's bounds. If the click lands
   * on whitespace / punctuation (no word) we collapse the caret at
   * the click point — that matches "click outside any word"
   * behavior in the engine adapter, where the underlying word
   * expansion silently no-ops.
   *
   * No-op when the click falls outside any rendered position — the
   * editor's selection is left as-is.
   */
  function selectWordAtPoint(clientX: number, clientY: number): void {
    let pos: number | null = null;
    try {
      pos = view.posAtCoords({ x: clientX, y: clientY });
    } catch {
      // Pre-measure: no layout to resolve from.
    }
    if (pos === null) return;
    const word = view.state.wordAt(pos);
    if (word === null) {
      view.dispatch({
        selection: EditorSelection.cursor(pos),
        userEvent: "select",
      });
      return;
    }
    view.dispatch({
      selection: EditorSelection.range(word.from, word.to),
      userEvent: "select",
    });
  }

  /**
   * Snapshot CM6's primary selection at right-click pointerdown. The
   * editor's pointerdown listener calls this on `event.button === 2`
   * before the browser's mousedown can move the caret. CM6 is the
   * source of truth for the editor's selection, so reading
   * `view.state.selection.main` here captures the user's pre-right-
   * click state directly — no DOM Selection round-trip.
   */
  function capturePreRightClick(): void {
    const sel = view.state.selection.main;
    preClickSnapshot = { from: sel.from, to: sel.to };
  }

  /**
   * Right-click pipeline: restore the pre-click snapshot via a CM6
   * transaction (undoing any smart-click expansion the browser ran),
   * classify the click, and either keep the restored selection or
   * call `selectWordAtPoint` to re-place the caret. CM6 transactions
   * are the JS-driven commit that survives the contextmenu's
   * `preventDefault` — without them, WebKit reverts whatever the
   * smart-click did and the menu opens against an empty selection.
   *
   * Returns `hasRangedSelection()` for the menu's Cut / Copy gates.
   */
  function prepareSelectionForRightClick(
    clientX: number,
    clientY: number,
  ): boolean {
    if (preClickSnapshot !== null) {
      view.dispatch({
        selection: EditorSelection.range(preClickSnapshot.from, preClickSnapshot.to),
        userEvent: "select",
      });
    }
    const classification = classifyRightClick(clientX, clientY);
    if (classification === "elsewhere") {
      selectWordAtPoint(clientX, clientY);
    }
    preClickSnapshot = null;
    return hasRangedSelection();
  }

  return {
    hasRangedSelection,
    getSelectedText,
    selectAll,
    expandToWord,
    classifyRightClick,
    selectWordAtPoint,
    capturePreRightClick,
    prepareSelectionForRightClick,
  };
}
