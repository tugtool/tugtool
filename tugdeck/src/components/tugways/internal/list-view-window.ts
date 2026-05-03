/**
 * list-view-window — pure windowing math for `TugListView`.
 *
 * Internal building block — app code uses `TugListView` instead.
 *
 * Given a viewport, a scroll offset, an item count, and a per-index
 * height accessor, computes which contiguous slice of indices should
 * be in the rendered window plus the spacer heights that fake the
 * scroll height for the unrendered cells. Pure: no React, no DOM, no
 * mutable state — drop-in testable.
 *
 * Step 3 ships the cumulative-walk variant, which is O(n) per call.
 * Step 4's height-index version will memoize prefix sums and use a
 * binary search; the public input/output shape stays the same so the
 * caller (`TugListView`) doesn't change.
 *
 * Semantics:
 * - The `firstIndex` / `lastIndex` slice is half-open `[firstIndex,
 *   lastIndex)` — `lastIndex` is the exclusive end. This matches
 *   typical JS slice idioms; `Array.slice(firstIndex, lastIndex)`
 *   gives the rendered range.
 * - `topSpacerHeight` is the total height of cells `[0, firstIndex)`
 *   so the rendered cells appear at the right scroll offset.
 * - `bottomSpacerHeight` is the total height of cells `[lastIndex,
 *   itemCount)` so the scroll height matches the document model.
 * - `totalHeight` is the sum of all item heights — convenient for
 *   spacer correctness checks and external scroll math.
 *
 * Edge cases (each pinned by its own test in Step 3):
 * - `itemCount === 0`: empty window, both spacers zero.
 * - `itemCount === 1`: a single rendered cell when in viewport,
 *   spacers reflect either side; no overscan into negative indices.
 * - `scrollTop > totalHeight`: window clamps to last item, top spacer
 *   covers everything before, bottom spacer is zero.
 * - `viewportHeight === 0`: window degenerates to overscan-only at
 *   the current scroll offset.
 * - `overscanCount` larger than itemCount: clamps; never produces
 *   indices outside `[0, itemCount)`.
 */

export interface ComputeWindowInput {
  /** Total number of items per `dataSource.numberOfItems()`. */
  itemCount: number;
  /** Current `scrollContainer.scrollTop` value. */
  scrollTop: number;
  /** Current `scrollContainer.clientHeight`. */
  viewportHeight: number;
  /**
   * Number of cells to render above and below the visible viewport
   * for smooth scrolling. The list view will render up to
   * `overscanCount` extra cells on each side of the visible range.
   */
  overscanCount: number;
  /**
   * Per-index height in CSS pixels. Step 3 calls this with a fixed
   * value derived from `delegate.estimatedHeightForKind`; Step 4
   * substitutes a `HeightIndex`-backed accessor that returns measured
   * heights when known and estimates otherwise.
   */
  estimatedHeightForIndex: (index: number) => number;
}

export interface ComputeWindowResult {
  /** First rendered index (inclusive). */
  firstIndex: number;
  /** End of rendered range (exclusive). */
  lastIndex: number;
  /** Pixel height of the top spacer ([0, firstIndex)). */
  topSpacerHeight: number;
  /** Pixel height of the bottom spacer ([lastIndex, itemCount)). */
  bottomSpacerHeight: number;
  /** Sum of all item heights — total scroll height of the document. */
  totalHeight: number;
}

const EMPTY_RESULT: Readonly<ComputeWindowResult> = Object.freeze({
  firstIndex: 0,
  lastIndex: 0,
  topSpacerHeight: 0,
  bottomSpacerHeight: 0,
  totalHeight: 0,
});

export function computeWindow(input: ComputeWindowInput): ComputeWindowResult {
  const { itemCount, scrollTop, viewportHeight, overscanCount, estimatedHeightForIndex } = input;

  if (itemCount <= 0) {
    return EMPTY_RESULT;
  }

  const safeScrollTop = scrollTop < 0 ? 0 : scrollTop;
  const safeViewport = viewportHeight < 0 ? 0 : viewportHeight;
  const safeOverscan = overscanCount < 0 ? 0 : Math.floor(overscanCount);
  const viewportEnd = safeScrollTop + safeViewport;

  // First pass: walk indices, accumulate height, find the visible
  // window's edges. Single-pass O(n); Step 4 swaps this for a
  // binary-search-friendly height index.
  let firstVisibleIndex = -1;
  let lastVisibleIndex = -1;
  let cumulative = 0;

  for (let i = 0; i < itemCount; i += 1) {
    const h = Math.max(0, estimatedHeightForIndex(i));
    const itemTop = cumulative;
    const itemBottom = cumulative + h;

    if (firstVisibleIndex === -1 && itemBottom > safeScrollTop) {
      firstVisibleIndex = i;
      // Seed `lastVisibleIndex` to the first match so a zero-height
      // viewport (`viewportHeight === 0`) still produces a non-empty
      // window. Without this seed, the second predicate below would
      // never fire when `itemTop === viewportEnd`.
      lastVisibleIndex = i;
    }
    if (firstVisibleIndex !== -1 && itemTop < viewportEnd) {
      lastVisibleIndex = i;
    }

    cumulative = itemBottom;
  }

  const totalHeight = cumulative;

  // No visible item — distinguish two cases:
  //   1. All items have zero total height (every cell is zero-tall).
  //      The list has no scrollable extent; render everything in
  //      document order so any zero-height content (focus rings,
  //      outlines, etc.) still paints.
  //   2. Scroll position is past the end of a non-zero document.
  //      Clamp the window to the last item so the user still sees
  //      content rather than an empty viewport.
  if (firstVisibleIndex === -1) {
    if (totalHeight === 0) {
      return {
        firstIndex: 0,
        lastIndex: itemCount,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
        totalHeight: 0,
      };
    }
    firstVisibleIndex = itemCount - 1;
    lastVisibleIndex = itemCount - 1;
  }

  // Apply overscan symmetrically. Clamp to [0, itemCount).
  const firstIndex = Math.max(0, firstVisibleIndex - safeOverscan);
  const lastIndexInclusive = Math.min(itemCount - 1, lastVisibleIndex + safeOverscan);
  const lastIndex = lastIndexInclusive + 1;

  // Compute spacer heights. Two more single-pass walks; total
  // complexity remains O(n) for Step 3.
  let topSpacerHeight = 0;
  for (let i = 0; i < firstIndex; i += 1) {
    topSpacerHeight += Math.max(0, estimatedHeightForIndex(i));
  }
  let bottomSpacerHeight = 0;
  for (let i = lastIndex; i < itemCount; i += 1) {
    bottomSpacerHeight += Math.max(0, estimatedHeightForIndex(i));
  }

  return {
    firstIndex,
    lastIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    totalHeight,
  };
}

/**
 * Compute the cumulative offset (in CSS pixels) of the cell at
 * `index`. Used by `scrollToIndex` to compute the target `scrollTop`
 * for an unrendered row. Pure single-pass O(n); Step 4 swaps for a
 * height-index prefix-sum lookup.
 *
 * Out-of-range indices clamp: negative → 0; index >= itemCount →
 * `totalHeight` (the document end). Matches the [D03] tolerance for
 * stale index paths.
 */
export function offsetForIndex(
  index: number,
  itemCount: number,
  estimatedHeightForIndex: (index: number) => number,
): number {
  if (itemCount <= 0 || index <= 0) {
    return 0;
  }
  const stop = Math.min(index, itemCount);
  let offset = 0;
  for (let i = 0; i < stop; i += 1) {
    offset += Math.max(0, estimatedHeightForIndex(i));
  }
  return offset;
}
