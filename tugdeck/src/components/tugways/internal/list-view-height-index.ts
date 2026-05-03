/**
 * list-view-height-index — sparse measured-height store for `TugListView`.
 *
 * Internal building block — app code uses `TugListView` instead.
 *
 * Holds measured heights for cells the list view has actually
 * rendered and observed via `ResizeObserver`. Unmeasured indices fall
 * back to the consumer's `delegate.estimatedHeightForKind` value via
 * the accessor parameter on the read methods. The combination
 * (measured + estimate fallback) gives `computeWindow` a continuous
 * height function over the full item range, which it needs to walk
 * cumulative offsets without gaps.
 *
 * **Sparse by design.** The map is keyed on rendered-cell indices;
 * cells that scroll out of the rendered window have their entries
 * left in place (so a subsequent scroll-back returns the previously-
 * measured height before `ResizeObserver` re-fires). Stale entries
 * for indices that no longer exist (after a data-source shrink) are
 * harmless — `computeWindow` walks `[0, itemCount)` and ignores them.
 *
 * **No prefix sums in v1.** The plan calls `indexForOffset`
 * "binary-search-friendly," meaning the API shape doesn't preclude a
 * future implementation that maintains prefix sums for O(log n)
 * lookups. v1 walks linearly because:
 *   - `computeWindow` already walks linearly in Step 3, so the
 *     dominant cost is unchanged.
 *   - Prefix-sum invalidation across `set` calls is real complexity
 *     that earns its keep only on lists with thousands of items.
 *   - The transcript (the first consumer) tops out at tens of items
 *     in typical use; the picker (deferred follow-on) is similar.
 * If profiling later shows the linear walk dominating, swap the
 * implementation behind the same API; callers don't change.
 *
 * Laws: this module is non-React, non-DOM. No tuglaws apply directly
 * — the height index is consumed by `TugListView`, which carries the
 * relevant law citations.
 */

export class HeightIndex {
  private readonly heights = new Map<number, number>();

  /**
   * Record a measured height for the cell at `index`. Negative,
   * non-finite, or NaN values are silently ignored — `ResizeObserver`
   * has been observed to deliver zero or sub-pixel values during
   * paint, but never negative or infinite, so dropping them is a
   * defensive guard rather than a normal path.
   */
  set(index: number, height: number): void {
    if (!Number.isFinite(height) || height < 0) return;
    this.heights.set(index, height);
  }

  /** Return the measured height at `index`, or `undefined` if unmeasured. */
  get(index: number): number | undefined {
    return this.heights.get(index);
  }

  /** Whether `index` has been measured. */
  has(index: number): boolean {
    return this.heights.has(index);
  }

  /** Drop the measurement at `index`. Returns `true` if a value was removed. */
  delete(index: number): boolean {
    return this.heights.delete(index);
  }

  /** Drop every measurement. */
  clear(): void {
    this.heights.clear();
  }

  /** Number of measured indices currently held. */
  get size(): number {
    return this.heights.size;
  }

  /**
   * Sum of heights over `[0, itemCount)`, using measured heights when
   * known and the estimate accessor otherwise. Used by
   * `computeWindow` to populate spacer heights and by the list view
   * to decide when a re-window is warranted.
   */
  totalHeight(
    itemCount: number,
    estimatedHeightForIndex: (index: number) => number,
  ): number {
    if (itemCount <= 0) return 0;
    let total = 0;
    for (let i = 0; i < itemCount; i += 1) {
      const measured = this.heights.get(i);
      if (measured !== undefined) {
        total += measured;
      } else {
        total += Math.max(0, estimatedHeightForIndex(i));
      }
    }
    return total;
  }

  /**
   * Cumulative offset of cell `index` (sum of heights of cells `[0,
   * index)`). Used by `scrollToIndex` to compute the target
   * `scrollTop`. Out-of-range clamping matches `offsetForIndex` in
   * `list-view-window.ts`: negative → 0; index past end → total
   * height of the document.
   */
  offsetForIndex(
    index: number,
    estimatedHeightForIndex: (index: number) => number,
  ): number {
    if (index <= 0) return 0;
    let offset = 0;
    for (let i = 0; i < index; i += 1) {
      const measured = this.heights.get(i);
      if (measured !== undefined) {
        offset += measured;
      } else {
        offset += Math.max(0, estimatedHeightForIndex(i));
      }
    }
    return offset;
  }

  /**
   * Find the smallest index `i` in `[0, itemCount)` whose cumulative
   * `bottom` exceeds `offset` — i.e. the cell that contains the given
   * pixel position. Used by `scrollToIndex` for unrendered targets
   * and by future window-aware fast paths.
   *
   * v1 walks linearly. The signature accepts `estimatedHeightForIndex`
   * so a future binary-search implementation has fallback heights for
   * unmeasured indices; v1 doesn't use that hook.
   */
  indexForOffset(
    offset: number,
    itemCount: number,
    estimatedHeightForIndex: (index: number) => number,
  ): number {
    if (itemCount <= 0) return 0;
    if (offset <= 0) return 0;
    let cumulative = 0;
    for (let i = 0; i < itemCount; i += 1) {
      const measured = this.heights.get(i);
      const h = measured !== undefined ? measured : Math.max(0, estimatedHeightForIndex(i));
      const itemBottom = cumulative + h;
      if (itemBottom > offset) return i;
      cumulative = itemBottom;
    }
    return itemCount - 1;
  }
}
