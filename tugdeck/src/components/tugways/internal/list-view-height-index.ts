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
 * **Two-tier read implementation.** All read methods accept
 * `(itemCount, estimateFn)` (the original stateless API). When a
 * caller has called `prepare(itemCount, estimateFn)` first, reads use
 * an internal Fenwick (binary-indexed) tree of effective heights for
 * O(log n) `offsetForIndex` / `indexForOffset` and O(1) `totalHeight`.
 * When the cache is absent or stale (`prepare` never called, or the
 * args differ from what was prepared), reads fall back to a linear
 * walk — the legacy O(n) path remains correct but slower. `set`,
 * `delete`, and `clear` keep the cache up-to-date by patching the
 * Fenwick tree in place when the index is in range, or invalidating
 * the cache when it isn't.
 *
 * The fallback path means `prepare` is an opt-in performance hint, not
 * a correctness requirement — existing call sites that don't call
 * `prepare` continue to work; they just walk linearly. New callers
 * that want the binary-search behavior call `prepare` once per
 * `(itemCount, estimateFn)` change and read freely afterward.
 *
 * Laws: this module is non-React, non-DOM. No tuglaws apply directly
 * — the height index is consumed by `TugListView`, which carries the
 * relevant law citations.
 */

interface PreparedCache {
  itemCount: number;
  estimateFn: (index: number) => number;
  /** Effective height per index (measured if known, else estimate). */
  effective: Float64Array;
  /** 1-indexed Fenwick tree over `effective`; bit[0] is unused. */
  bit: Float64Array;
}

export class HeightIndex {
  private readonly heights = new Map<number, number>();

  private cache: PreparedCache | null = null;

  /**
   * Record a measured height for the cell at `index`. Negative,
   * non-finite, or NaN values are silently ignored — `ResizeObserver`
   * has been observed to deliver zero or sub-pixel values during
   * paint, but never negative or infinite, so dropping them is a
   * defensive guard rather than a normal path.
   *
   * If a Fenwick cache is active and `index` falls within its
   * `[0, itemCount)` range, the tree is patched in place with the
   * delta between the old effective height and the new measurement.
   * Out-of-range writes leave the cache intact and become visible the
   * next time `prepare` is called.
   */
  set(index: number, height: number): void {
    if (!Number.isFinite(height) || height < 0) return;
    this.heights.set(index, height);
    if (this.cache !== null && index >= 0 && index < this.cache.itemCount) {
      const oldEffective = this.cache.effective[index];
      this.cache.effective[index] = height;
      this._bitUpdate(this.cache, index, height - oldEffective);
    }
  }

  /** Return the measured height at `index`, or `undefined` if unmeasured. */
  get(index: number): number | undefined {
    return this.heights.get(index);
  }

  /** Whether `index` has been measured. */
  has(index: number): boolean {
    return this.heights.has(index);
  }

  /**
   * Drop the measurement at `index`. Returns `true` if a value was
   * removed. If a Fenwick cache is active and `index` is in range,
   * the tree is patched back to the estimate value.
   */
  delete(index: number): boolean {
    const had = this.heights.delete(index);
    if (
      had
      && this.cache !== null
      && index >= 0
      && index < this.cache.itemCount
    ) {
      const oldEffective = this.cache.effective[index];
      const newEffective = Math.max(0, this.cache.estimateFn(index));
      this.cache.effective[index] = newEffective;
      this._bitUpdate(this.cache, index, newEffective - oldEffective);
    }
    return had;
  }

  /**
   * Drop every measurement. Invalidates any prepared cache; the next
   * `prepare` call rebuilds from estimates only.
   */
  clear(): void {
    this.heights.clear();
    this.cache = null;
  }

  /** Number of measured indices currently held. */
  get size(): number {
    return this.heights.size;
  }

  /**
   * Build (or refresh) the internal Fenwick cache for the supplied
   * `(itemCount, estimateFn)` pair. After calling this, `totalHeight`,
   * `offsetForIndex`, and `indexForOffset` all run in O(log n) (or
   * O(1) for the constant-time root). The cache is automatically
   * patched on subsequent `set` / `delete` calls; it must be rebuilt
   * via another `prepare` call when `itemCount` grows or the estimate
   * function changes identity.
   *
   * Calling `prepare` is optional — read methods fall back to a
   * linear walk when the cache is absent or stale, so correctness
   * doesn't depend on it. Performance-sensitive callers (`TugListView`)
   * call it once per data-source / estimate change.
   *
   * Cost: O(itemCount) build (one pass to fill `effective`, one pass
   * to construct the Fenwick tree). Subsequent reads run in O(log n).
   */
  prepare(itemCount: number, estimateFn: (index: number) => number): void {
    const safeItemCount = Math.max(0, Math.floor(itemCount));
    if (
      this.cache !== null
      && this.cache.itemCount === safeItemCount
      && this.cache.estimateFn === estimateFn
    ) {
      return; // Already prepared with these inputs.
    }
    const effective = new Float64Array(safeItemCount);
    const bit = new Float64Array(safeItemCount + 1); // 1-indexed.
    for (let i = 0; i < safeItemCount; i += 1) {
      const measured = this.heights.get(i);
      effective[i] =
        measured !== undefined ? measured : Math.max(0, estimateFn(i));
    }
    // Linear-time Fenwick construction: each bit[i] is initially the
    // sum of its responsibility range (a lowbit-sized window ending at
    // i-1 in 0-indexed terms). Building incrementally via _bitUpdate
    // would be O(n log n); the in-place sweep below is O(n).
    for (let i = 1; i <= safeItemCount; i += 1) {
      bit[i] += effective[i - 1];
      const j = i + (i & -i);
      if (j <= safeItemCount) {
        bit[j] += bit[i];
      }
    }
    this.cache = { itemCount: safeItemCount, estimateFn, effective, bit };
  }

  /**
   * Sum of heights over `[0, itemCount)`, using measured heights when
   * known and the estimate accessor otherwise. Used by
   * `computeWindow` to populate spacer geometry and by the list view
   * to decide when a re-window is warranted.
   *
   * Fast path (O(1)): when a prepared cache matches `itemCount` and
   * `estimatedHeightForIndex` identity, reads the Fenwick tree's
   * total directly. Fallback path (O(n)): walks linearly.
   */
  totalHeight(
    itemCount: number,
    estimatedHeightForIndex: (index: number) => number,
  ): number {
    if (itemCount <= 0) return 0;
    const safeItemCount = Math.floor(itemCount);
    if (this._cacheMatches(safeItemCount, estimatedHeightForIndex)) {
      return this._bitPrefixSum(this.cache!, safeItemCount);
    }
    let total = 0;
    for (let i = 0; i < safeItemCount; i += 1) {
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
   * Cumulative offset of cell `index` (sum of heights of cells
   * `[0, index)`). Used by `scrollToIndex` to compute the target
   * `scrollTop`. Out-of-range clamping matches `offsetForIndex` in
   * `list-view-window.ts`: negative → 0; index past end of the
   * prepared range → total height of the prepared range (with no
   * cache, walks until the heights map runs out and returns the
   * partial sum).
   *
   * Fast path (O(log n)): when a prepared cache covers `index` and
   * matches `estimatedHeightForIndex` identity, reads the Fenwick
   * tree's prefix sum. Fallback path (O(n)): walks linearly.
   */
  offsetForIndex(
    index: number,
    estimatedHeightForIndex: (index: number) => number,
  ): number {
    if (index <= 0) return 0;
    const target = Math.floor(index);
    if (
      this.cache !== null
      && this.cache.estimateFn === estimatedHeightForIndex
      && this.cache.itemCount >= target
    ) {
      return this._bitPrefixSum(this.cache, target);
    }
    let offset = 0;
    for (let i = 0; i < target; i += 1) {
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
   * Fast path (O(log n)): when a prepared cache matches `itemCount`
   * and `estimatedHeightForIndex` identity, walks the Fenwick tree
   * via standard binary lifting. Fallback path (O(n)): walks
   * linearly.
   */
  indexForOffset(
    offset: number,
    itemCount: number,
    estimatedHeightForIndex: (index: number) => number,
  ): number {
    if (itemCount <= 0) return 0;
    if (offset <= 0) return 0;
    const safeItemCount = Math.floor(itemCount);
    if (this._cacheMatches(safeItemCount, estimatedHeightForIndex)) {
      return this._bitBinarySearch(this.cache!, offset);
    }
    let cumulative = 0;
    for (let i = 0; i < safeItemCount; i += 1) {
      const measured = this.heights.get(i);
      const h =
        measured !== undefined
          ? measured
          : Math.max(0, estimatedHeightForIndex(i));
      const itemBottom = cumulative + h;
      if (itemBottom > offset) return i;
      cumulative = itemBottom;
    }
    return safeItemCount - 1;
  }

  // ---------------------------------------------------------------------
  // Fenwick internals
  // ---------------------------------------------------------------------

  private _cacheMatches(
    itemCount: number,
    estimateFn: (index: number) => number,
  ): boolean {
    return (
      this.cache !== null
      && this.cache.itemCount === itemCount
      && this.cache.estimateFn === estimateFn
    );
  }

  /** Add `delta` to position `index0` (0-indexed) of the Fenwick tree. */
  private _bitUpdate(cache: PreparedCache, index0: number, delta: number): void {
    if (delta === 0) return;
    const n = cache.itemCount;
    let i = index0 + 1; // 1-indexed.
    while (i <= n) {
      cache.bit[i] += delta;
      i += i & -i;
    }
  }

  /** Sum of `effective[0..endExclusive)`. */
  private _bitPrefixSum(cache: PreparedCache, endExclusive: number): number {
    let sum = 0;
    let i = Math.min(endExclusive, cache.itemCount);
    while (i > 0) {
      sum += cache.bit[i];
      i -= i & -i;
    }
    return sum;
  }

  /**
   * Find the smallest 0-indexed `i` such that the cumulative bottom
   * after cell `i` strictly exceeds `offset` — i.e. the cell that
   * CONTAINS `offset`. Standard Fenwick binary-lifting walk.
   */
  private _bitBinarySearch(cache: PreparedCache, offset: number): number {
    const n = cache.itemCount;
    if (n === 0) return 0;
    let idx = 0; // running 1-indexed prefix end.
    let cumulative = 0;
    let mask = 1;
    while (mask * 2 <= n) mask *= 2;
    while (mask > 0) {
      const next = idx + mask;
      if (next <= n && cumulative + cache.bit[next] <= offset) {
        idx = next;
        cumulative += cache.bit[next];
      }
      mask >>= 1;
    }
    // After the walk: cumulative = prefix[idx] (1-indexed) ≤ offset,
    // and prefix[idx + 1] > offset (by the loop's maximality). The
    // 0-indexed cell containing `offset` is `idx` itself (since
    // 0-indexed cell `idx` spans `[prefix[idx], prefix[idx + 1])`).
    return Math.min(idx, n - 1);
  }
}
