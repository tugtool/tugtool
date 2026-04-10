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
 *   - `HighlightSelectionAdapter` — stub class in this file (wired by item 1)
 *
 * Design decisions:
 *   [D01] Adapter is a plain object interface, not a class hierarchy
 *   [D02] Hybrid classifyRightClick replaces geometric-only API
 *   [D03] HighlightSelectionAdapter is a stub in this plan
 */

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
// HighlightSelectionAdapter (stub — wired by item 1)
// ---------------------------------------------------------------------------

/**
 * Stub adapter for tug-markdown-view's CSS Custom Highlight / SelectionGuard
 * selection model.
 *
 * All methods are stubs per [D03]. Query methods return safe defaults; mutation
 * methods throw `Error("Not implemented — wired by item 1")`. Item 1 will
 * replace stub method bodies with real SelectionGuard integration.
 *
 * Satisfies `TextSelectionAdapter` so items 1-4 can import and reference it
 * without circular dependency issues before item 1 lands.
 *
 * @param _boundaryEl The boundary `HTMLElement` for the markdown-view card.
 *                    Stored for use by item 1 when the stub is wired.
 */
export class HighlightSelectionAdapter implements TextSelectionAdapter {
  // Stored for item 1 — not used by stubs.
  private readonly _boundaryEl: HTMLElement;

  constructor(boundaryEl: HTMLElement) {
    this._boundaryEl = boundaryEl;
  }

  /**
   * Always returns `false` — stub.
   * Item 1 will query SelectionGuard for a real ranged selection.
   */
  hasRangedSelection(): boolean {
    return false;
  }

  /**
   * Always returns `""` — stub.
   * Item 1 will extract the selected text from the active CSS Custom Highlight range.
   */
  getSelectedText(): string {
    return "";
  }

  /**
   * Not implemented — wired by item 1.
   * @throws Error
   */
  selectAll(): void {
    throw new Error("Not implemented — wired by item 1");
  }

  /**
   * Not implemented — wired by item 1.
   * @throws Error
   */
  expandToWord(): void {
    throw new Error("Not implemented — wired by item 1");
  }

  /**
   * Always returns `"elsewhere"` — stub.
   * Item 1 will use SelectionGuard geometry for a real classification.
   */
  classifyRightClick(
    _clientX: number,
    _clientY: number,
    _proximityThreshold: number,
  ): RightClickClassification {
    return "elsewhere";
  }

  /**
   * Not implemented — wired by item 1.
   * @throws Error
   */
  selectWordAtPoint(_clientX: number, _clientY: number): void {
    throw new Error("Not implemented — wired by item 1");
  }
}
