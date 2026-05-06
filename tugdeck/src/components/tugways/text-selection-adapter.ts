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
   * - `"near-caret"`:   Collapsed selection, click is within the same word
   *                      as the caret.
   * - `"within-range"`: Ranged selection, click is inside the selected range.
   * - `"elsewhere"`:    Click is outside the current selection.
   *
   * @param clientX Viewport X coordinate of the right-click event.
   * @param clientY Viewport Y coordinate of the right-click event.
   */
  classifyRightClick(
    clientX: number,
    clientY: number,
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

  /**
   * Snapshot the current selection state so a subsequent
   * `prepareSelectionForRightClick` call can restore it.
   *
   * Call this at `pointerdown` time when `event.button === 2`, before
   * the browser's mousedown handler has a chance to mutate the
   * selection (caret placement, smart-click word expansion). The snapshot
   * lives inside the adapter; callers don't manage it directly.
   *
   * Adapters whose surface has no notion of pre-click state (e.g. a
   * static span with no caret) implement this as a no-op.
   */
  capturePreRightClick(): void;

  /**
   * Prepare the surface's selection for a right-click context menu and
   * return `true` if a non-collapsed selection survives.
   *
   * Called from the `contextmenu` handler after `event.preventDefault`.
   * The implementation owns the four right-click cases:
   *
   *   1. Restore any state captured at `capturePreRightClick`, undoing
   *      whatever the browser's mousedown / smart-click did to the
   *      surface's selection.
   *   2. Classify the click via `classifyRightClick`.
   *   3. On `"elsewhere"`, place the caret at the click point and
   *      expand to word boundaries (via `selectWordAtPoint`).
   *   4. On `"within-range"` or `"near-caret"`, leave the restored
   *      selection in place.
   *
   * Crucially, the resulting selection is committed via the surface's
   * native API (CM6 transaction, `setSelectionRange`, DOM
   * `setBaseAndExtent`) rather than the browser's tentative
   * smart-click. WebKit reverts tentative smart-click selections when
   * the contextmenu's default is prevented, so a JS-driven commit is
   * what makes the selection actually persist into the menu's
   * lifetime.
   *
   * Returns `hasRangedSelection()` after the work has run, suitable
   * for driving the menu's Cut / Copy enablement.
   */
  prepareSelectionForRightClick(clientX: number, clientY: number): boolean;
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
  /**
   * Snapshot of the DOM selection captured at `capturePreRightClick`.
   * Stored as anchor / focus node + offset so a `setBaseAndExtent`
   * call can rebuild the same range. `null` between right-clicks or
   * when the captured selection lay outside this adapter's boundary
   * (we don't restore foreign selections).
   */
  private _preClickSnapshot:
    | { anchorNode: Node; anchorOffset: number; focusNode: Node; focusOffset: number }
    | null = null;

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
   * the selection's client rects. For collapsed selections: expands to
   * the caret's word and checks if the click falls within it.
   */
  classifyRightClick(
    clientX: number,
    clientY: number,
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

    // Collapsed — expand to the caret's word, check if the click falls
    // within the word's bounding rects, then restore the caret.
    const saved = range.cloneRange();
    sel.modify("move", "backward", "word");
    sel.modify("extend", "forward", "word");
    const wordRange = sel.getRangeAt(0);
    const rects = wordRange.getClientRects();
    // Restore collapsed caret.
    sel.removeAllRanges();
    sel.addRange(saved);

    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (clientX >= r.left && clientX <= r.right &&
          clientY >= r.top && clientY <= r.bottom) {
        return "near-caret";
      }
    }
    return "elsewhere";
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

  /**
   * Snapshot the current DOM selection when (and only when) it lives
   * inside this adapter's boundary. Selections elsewhere on the page
   * aren't ours to restore later. Called at `pointerdown` time on a
   * right-click so the snapshot predates any browser smart-click
   * mutation.
   */
  capturePreRightClick(): void {
    const sel = window.getSelection();
    if (
      sel === null ||
      sel.rangeCount === 0 ||
      sel.anchorNode === null ||
      sel.focusNode === null ||
      !this._isSelectionInBoundary(sel)
    ) {
      this._preClickSnapshot = null;
      return;
    }
    this._preClickSnapshot = {
      anchorNode: sel.anchorNode,
      anchorOffset: sel.anchorOffset,
      focusNode: sel.focusNode,
      focusOffset: sel.focusOffset,
    };
  }

  /**
   * Right-click pipeline:
   *
   *   1. Restore the pre-click snapshot via `setBaseAndExtent`. This
   *      undoes the browser's smart-click expansion (if it ran during
   *      mousedown) and re-applies the user's prior selection as a
   *      JS-driven commit.
   *   2. Classify the click against the (now-restored) selection.
   *   3. On `"elsewhere"`, place the caret at the click point and
   *      expand to word boundaries — `selectWordAtPoint` writes via
   *      `setBaseAndExtent`, also a JS commit.
   *   4. On `"within-range"` / `"near-caret"`, re-commit the current
   *      selection by reading anchor / focus from `window.getSelection`
   *      and writing them back via `setBaseAndExtent`. This step is
   *      what lifts the selection out of WebKit's "tentative" state.
   *
   * Why step 4 needs an explicit re-commit:
   *
   * When the user right-clicks directly on a word with no prior
   * selection, WebKit's mousedown handler runs a smart-click: the
   * word at the click point becomes selected as a *tentative*
   * selection — meaning WebKit will commit it if the system context
   * menu shows, and revert it if the menu is suppressed. Our
   * `event.preventDefault()` (suppressing the system menu so we can
   * show our own) puts WebKit in revert mode. Without an explicit
   * re-commit, the selection survives just long enough to drive the
   * menu's `hasSelection` sample, then collapses by the time the
   * user clicks Copy or Select All. Even Select All's continuation
   * (which writes a fresh selection via `setBaseAndExtent`) can race
   * the revert, leaving the user looking at a briefly-correct
   * highlight that snaps back to the smart-click word a moment
   * later. Re-committing in step 4 forecloses that whole race —
   * after `setBaseAndExtent`, the selection is JS-driven and WebKit
   * has nothing tentative to revert.
   */
  prepareSelectionForRightClick(clientX: number, clientY: number): boolean {
    const sel = window.getSelection();
    if (sel === null) return false;

    const snap = this._preClickSnapshot;
    if (snap !== null) {
      sel.setBaseAndExtent(
        snap.anchorNode, snap.anchorOffset,
        snap.focusNode, snap.focusOffset,
      );
    }

    const classification = this.classifyRightClick(clientX, clientY);
    if (classification === "elsewhere") {
      this.selectWordAtPoint(clientX, clientY);
    } else if (
      sel.rangeCount > 0 &&
      sel.anchorNode !== null &&
      sel.focusNode !== null &&
      this._isSelectionInBoundary(sel)
    ) {
      // "within-range" / "near-caret" — re-commit the current
      // selection so WebKit gives up its tentative-revert claim.
      sel.setBaseAndExtent(
        sel.anchorNode, sel.anchorOffset,
        sel.focusNode, sel.focusOffset,
      );
    }

    this._preClickSnapshot = null;
    return this.hasRangedSelection();
  }

  /** Check if the DOM selection's anchor or focus is within the boundary. */
  private _isSelectionInBoundary(sel: Selection): boolean {
    return (
      (sel.anchorNode !== null && this._boundaryEl.contains(sel.anchorNode)) ||
      (sel.focusNode !== null && this._boundaryEl.contains(sel.focusNode))
    );
  }
}
