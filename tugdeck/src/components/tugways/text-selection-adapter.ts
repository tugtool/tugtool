/**
 * text-selection-adapter.ts — Unified selection adapter interface and types.
 *
 * Provides a `TextSelectionAdapter` interface that abstracts over the three
 * distinct selection models used by tugways text components:
 *   - Native input offsets (tug-input, tug-textarea, tug-value-input)
 *   - TugTextEngine flat offsets (tug-prompt-input)
 *   - CSS Custom Highlight API / SelectionGuard paths (tug-markdown-view)
 *
 * Roadmap items 1-4 (context menu for markdown-view, right-click repositioning,
 * tab persistence, undo persistence) consume this interface so each item can
 * write selection logic once against the interface without per-model branching.
 *
 * Concrete adapter factories:
 *   - `createNativeInputAdapter` — in `use-text-input-responder.tsx`
 *   - `createEngineAdapter`      — in `tug-prompt-input.tsx`
 *   - `HighlightSelectionAdapter` — class in this file (DOM Selection over boundary element)
 *
 * Design decisions:
 *   [D01] Adapter is a plain object interface, not a class hierarchy
 *   [D02] Hybrid classifyRightClick replaces geometric-only API
 */

import { caretPositionFromPointCompat } from "./selection-guard";

// ---------------------------------------------------------------------------
// RightClickClassification
// ---------------------------------------------------------------------------

/**
 * Classification of a right-click relative to the current selection.
 *
 * Used by `TextSelectionAdapter.classifyRightClick` and by the shared
 * `repositionSelectionOnRightClick` utility (item 2).
 *
 * - `"near-caret"`:    Collapsed selection, click is near the caret.
 * - `"within-range"`:  Ranged selection, click is inside the selected range.
 * - `"elsewhere"`:     Click is outside the current selection.
 */
export type RightClickClassification = "near-caret" | "within-range" | "elsewhere";

// ---------------------------------------------------------------------------
// TextSelectionAdapter
// ---------------------------------------------------------------------------

/**
 * Uniform selection-query and selection-mutation API for tugways text components.
 *
 * Each concrete adapter closes over the underlying element or engine instance
 * so callers never deal with model-specific types. All adapters are plain
 * objects returned by factory functions per [D01].
 */
export interface TextSelectionAdapter {
  /** True when there is a non-collapsed (ranged) selection. */
  hasRangedSelection(): boolean;

  /** The currently selected text, or empty string if no ranged selection. */
  getSelectedText(): string;

  /** Select all content in the component. */
  selectAll(): void;

  /** Expand the current caret position to word boundaries. */
  expandToWord(): void;

  /**
   * Classify a right-click relative to the current selection.
   *
   * Returns the case that applies so the caller can decide whether to restore
   * the pre-click selection or expand to word.
   *
   * - `"near-caret"`:   Collapsed selection, click is near the caret.
   * - `"within-range"`: Ranged selection, click is inside the selected range.
   * - `"elsewhere"`:    Click is outside the current selection.
   *
   * @param clientX           Viewport X coordinate of the right-click event.
   * @param clientY           Viewport Y coordinate of the right-click event.
   * @param proximityThreshold Distance in pixels within which a click near a
   *                          collapsed caret is classified as `"near-caret"`.
   *                          Native input adapters may ignore this parameter
   *                          (offset comparison is exact, not geometric).
   */
  classifyRightClick(
    clientX: number,
    clientY: number,
    proximityThreshold: number,
  ): RightClickClassification;

  /**
   * Place the caret at the given viewport coordinates and expand to word
   * boundaries.
   *
   * For native inputs where the browser already placed the caret via mousedown,
   * the coordinates may be ignored and this method performs word expansion only.
   *
   * @param clientX Viewport X coordinate of the right-click event.
   * @param clientY Viewport Y coordinate of the right-click event.
   */
  selectWordAtPoint(clientX: number, clientY: number): void;
}

// ---------------------------------------------------------------------------
// NativeInputSelectionAdapterExtras
// ---------------------------------------------------------------------------

/**
 * Additional API exposed by `createNativeInputAdapter` beyond `TextSelectionAdapter`.
 *
 * The factory returns `TextSelectionAdapter & NativeInputSelectionAdapterExtras`.
 * This extra method is specific to native inputs (offset-comparison approach)
 * and is not part of the shared interface.
 *
 * See: [D04] NativeInputSelectionAdapter captures pre-click state via explicit call.
 */
export interface NativeInputSelectionAdapterExtras {
  /**
   * Capture the pre-right-click selection state.
   *
   * Call this at pointerdown time (when `event.button === 2`) to snapshot the
   * current `selectionStart` / `selectionEnd` before the browser's mousedown
   * handler potentially moves the caret. `classifyRightClick` compares the
   * post-mousedown caret position against this snapshot to determine the case.
   *
   * The `proximityThreshold` parameter to `classifyRightClick` is unused for
   * native inputs — offset comparison is exact, not geometric.
   */
  capturePreRightClick(): void;
}

// ---------------------------------------------------------------------------
// findWordBoundaries
// ---------------------------------------------------------------------------

/**
 * Find the word boundaries around a given offset in a string.
 *
 * Scans backward from `offset` for the first whitespace or punctuation
 * character (exclusive) to find the word start, and forward for the first
 * whitespace or punctuation character (exclusive) to find the word end.
 *
 * If `offset` is on a whitespace or punctuation character, the returned range
 * collapses to `{ start: offset, end: offset }`.
 *
 * Used by `NativeInputSelectionAdapter`'s `expandToWord` and `selectWordAtPoint`
 * to extend the browser-placed caret to word boundaries via
 * `el.setSelectionRange(start, end)`.
 *
 * @param text   The full string value of the input / textarea.
 * @param offset The character offset to expand (typically `el.selectionStart`).
 * @returns      `{ start, end }` inclusive start / exclusive end indices.
 */
export function findWordBoundaries(
  text: string,
  offset: number,
): { start: number; end: number } {
  // Word boundary: whitespace or ASCII punctuation.
  const isBoundary = (ch: string): boolean => /[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(ch);

  // If the character at `offset` is itself a boundary, collapse the range.
  if (offset < text.length && isBoundary(text[offset]!)) {
    return { start: offset, end: offset };
  }

  // Scan backward to find word start.
  let start = offset;
  while (start > 0 && !isBoundary(text[start - 1]!)) {
    start--;
  }

  // Scan forward to find word end.
  let end = offset;
  while (end < text.length && !isBoundary(text[end]!)) {
    end++;
  }

  return { start, end };
}

// ---------------------------------------------------------------------------
// HighlightSelectionAdapter
// ---------------------------------------------------------------------------

/**
 * Adapter for tug-markdown-view's CSS Custom Highlight / DOM Selection model.
 *
 * Wraps `window.getSelection()` scoped to a boundary element. Used by items
 * 1-2 for context menu copy enablement, right-click classification, and
 * word-at-point expansion.
 *
 * All query methods check that the DOM Selection is within the boundary
 * element before returning results. Mutation methods operate on the standard
 * DOM Selection API — `Selection.modify` for word expansion,
 * `caretPositionFromPointCompat` for coordinate-to-offset conversion.
 *
 * @param boundaryEl The boundary `HTMLElement` for the markdown-view content.
 */
export class HighlightSelectionAdapter implements TextSelectionAdapter {
  private readonly _boundaryEl: HTMLElement;

  constructor(boundaryEl: HTMLElement) {
    this._boundaryEl = boundaryEl;
  }

  /** True when there is a non-collapsed DOM selection within the boundary. */
  hasRangedSelection(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    return this._isSelectionInBoundary(sel);
  }

  /** Selected text from the DOM selection, or empty string. */
  getSelectedText(): string {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return "";
    if (!this._isSelectionInBoundary(sel)) return "";
    return sel.toString();
  }

  /**
   * Select all content within the boundary element via DOM Selection.
   *
   * Note: tug-markdown-view does NOT call this for virtualized select-all.
   * The view's selectAll action handler sets a logical flag + CSS visual
   * instead, because the DOM only contains a viewport window of blocks.
   * This method exists for non-virtualized contexts or testing.
   */
  selectAll(): void {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(this._boundaryEl);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** Expand the current caret to word boundaries via Selection.modify. */
  expandToWord(): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    sel.modify("move", "backward", "word");
    sel.modify("extend", "forward", "word");
  }

  /**
   * Classify a right-click using DOM Range geometry.
   *
   * For ranged selections: checks if the click point falls within any of
   * the selection's client rects. For collapsed selections: checks
   * proximity of the click to the caret rect.
   */
  classifyRightClick(
    clientX: number,
    clientY: number,
    proximityThreshold: number,
  ): RightClickClassification {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return "elsewhere";
    if (!this._isSelectionInBoundary(sel)) return "elsewhere";

    const range = sel.getRangeAt(0);

    if (!sel.isCollapsed) {
      // Ranged selection — check if click is within any selection rect.
      const rects = range.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (clientX >= r.left && clientX <= r.right &&
            clientY >= r.top && clientY <= r.bottom) {
          return "within-range";
        }
      }
      return "elsewhere";
    }

    // Collapsed — check proximity to caret.
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return "elsewhere";
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist <= proximityThreshold ? "near-caret" : "elsewhere";
  }

  /**
   * Place caret at the given viewport coordinates and expand to word.
   * Uses `caretPositionFromPointCompat` for coordinate-to-offset conversion.
   */
  selectWordAtPoint(clientX: number, clientY: number): void {
    const pos = caretPositionFromPointCompat(clientX, clientY);
    if (!pos) return;
    const sel = window.getSelection();
    if (!sel) return;
    sel.setBaseAndExtent(pos.node, pos.offset, pos.node, pos.offset);
    sel.modify("move", "backward", "word");
    sel.modify("extend", "forward", "word");
  }

  /** Check if the DOM selection's anchor or focus is within the boundary. */
  private _isSelectionInBoundary(sel: Selection): boolean {
    return (
      (sel.anchorNode !== null && this._boundaryEl.contains(sel.anchorNode)) ||
      (sel.focusNode !== null && this._boundaryEl.contains(sel.focusNode))
    );
  }
}
