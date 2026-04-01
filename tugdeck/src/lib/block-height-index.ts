/**
 * BlockHeightIndex — Float64Array prefix sum with lazy recomputation.
 *
 * Tracks the height of each markdown block and provides O(log n) offset-to-block
 * mapping via binary search on a lazily-computed prefix sum array.
 *
 * Design decisions:
 * - [D01] Float64Array gives cache-friendly contiguous memory, avoids object overhead
 * - [D05] Height estimation constants defined directly in this module.
 *
 * Capacity management: starts at `initialCapacity`, doubles on overflow.
 * Watermark tracks the lowest dirty index — prefix sum is recomputed lazily only
 * from the watermark forward when accessed.
 */

// ---------------------------------------------------------------------------
// Height estimation constants [D05]
// TODO(Phase 3B): Replace hardcoded constants with CSS custom property measurement
// once theme tokens are available for precise height computation.

/** Base line height in pixels for paragraph text. */
export const LINE_HEIGHT = 24;

/** Line height in pixels for code block content. */
export const CODE_LINE_HEIGHT = 20;

/** Fixed header height for code blocks (language label + border). */
export const CODE_HEADER_HEIGHT = 36;

/** Height of a horizontal rule in pixels. */
export const HR_HEIGHT = 33;

/**
 * Heading heights by level (index 0 = unused, 1-6 = h1-h6).
 * Includes top/bottom margins.
 */
export const HEADING_HEIGHTS: readonly number[] = [0, 56, 48, 40, 36, 32, 28];

// ---------------------------------------------------------------------------
// BlockHeightIndex

const INVALID_WATERMARK = -1;

/**
 * BlockHeightIndex stores per-block heights in a Float64Array with a lazily-
 * computed prefix sum. A validity watermark tracks the lowest dirty index;
 * recomputation runs only from the watermark forward on access.
 *
 * Usage:
 *   const index = new BlockHeightIndex();
 *   const i = index.appendBlock(estimatedHeight);
 *   index.setHeight(i, measuredHeight);
 *   const offset = index.getBlockOffset(i);
 *   const block = index.getBlockAtOffset(scrollTop);
 *   const total = index.getTotalHeight();
 */
export class BlockHeightIndex {
  private _heights: Float64Array;
  private _prefixSum: Float64Array;
  private _count: number;
  private _capacity: number;
  /** Lowest index whose prefix sum entry is stale. INVALID_WATERMARK = all valid. */
  private _watermark: number;

  constructor(initialCapacity = 1024) {
    this._capacity = Math.max(1, initialCapacity);
    this._heights = new Float64Array(this._capacity);
    this._prefixSum = new Float64Array(this._capacity + 1);
    this._count = 0;
    this._watermark = INVALID_WATERMARK;
  }

  // -------------------------------------------------------------------------
  // Public API

  /** Add a block with an estimated height. Returns the block index. */
  appendBlock(estimatedHeight: number): number {
    if (this._count === this._capacity) {
      this._grow();
    }
    const index = this._count;
    this._heights[index] = estimatedHeight;
    this._count++;
    // Invalidate prefix sum from this index forward.
    this._invalidate(index);
    return index;
  }

  /** Update the height of an existing block (e.g., after measurement). */
  setHeight(index: number, height: number): void {
    if (index < 0 || index >= this._count) {
      throw new RangeError(`BlockHeightIndex.setHeight: index ${index} out of range [0, ${this._count})`);
    }
    this._heights[index] = height;
    this._invalidate(index);
  }

  /** Get the stored height of a single block. */
  getHeight(index: number): number {
    if (index < 0 || index >= this._count) {
      throw new RangeError(`BlockHeightIndex.getHeight: index ${index} out of range [0, ${this._count})`);
    }
    return this._heights[index];
  }

  /**
   * Binary search: given a scroll offset, return the index of the first block
   * at or past that offset. Returns `count` if offset exceeds total height.
   */
  getBlockAtOffset(offset: number): number {
    if (this._count === 0) return 0;
    this._recompute();

    // Binary search on prefix sum.
    // _prefixSum[i] = sum of heights[0..i-1], so _prefixSum[i] is the start Y of block i.
    let lo = 0;
    let hi = this._count;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._prefixSum[mid] <= offset) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    // lo is now the first index where prefixSum[lo] > offset, meaning block lo-1
    // contains the offset. But we want the block whose top edge is at or before
    // the offset, so return lo - 1 (clamped to 0).
    return Math.max(0, lo - 1);
  }

  /** Get the Y offset of a block (sum of all heights before it). */
  getBlockOffset(index: number): number {
    if (index < 0 || index > this._count) {
      throw new RangeError(`BlockHeightIndex.getBlockOffset: index ${index} out of range [0, ${this._count}]`);
    }
    if (this._count === 0) return 0;
    this._recompute();
    return this._prefixSum[index];
  }

  /** Total height of all blocks (drives scroll container sizing). */
  getTotalHeight(): number {
    if (this._count === 0) return 0;
    this._recompute();
    return this._prefixSum[this._count];
  }

  /** Number of blocks currently tracked. */
  get count(): number {
    return this._count;
  }

  /**
   * Truncate the index to `newCount` blocks.
   *
   * Discards all blocks at indices `newCount` and above. Invalidates the prefix
   * sum from `newCount` onward so that subsequent reads recompute only from the
   * new boundary. After truncation, `this.count === newCount`.
   *
   * Throws `RangeError` if `newCount < 0` or `newCount > this._count`.
   */
  truncate(newCount: number): void {
    if (newCount < 0 || newCount > this._count) {
      throw new RangeError(
        `BlockHeightIndex.truncate: newCount ${newCount} out of range [0, ${this._count}]`
      );
    }
    this._count = newCount;
    this._invalidate(newCount);
  }

  /** Remove all blocks (reset). */
  clear(): void {
    this._count = 0;
    this._watermark = INVALID_WATERMARK;
    // Zero out the prefix sum sentinel.
    this._prefixSum[0] = 0;
  }

  // -------------------------------------------------------------------------
  // Private helpers

  /** Mark the prefix sum invalid from `index` forward. */
  private _invalidate(index: number): void {
    if (this._watermark === INVALID_WATERMARK || index < this._watermark) {
      this._watermark = index;
    }
  }

  /**
   * Recompute the prefix sum from the watermark forward.
   * After this call, _prefixSum[i] = sum of _heights[0..i-1] for all i in [0, _count].
   * _prefixSum[0] is always 0 (invariant maintained by clear() and _grow()).
   */
  private _recompute(): void {
    if (this._watermark === INVALID_WATERMARK) return;

    const start = this._watermark;
    // _prefixSum[start] must be valid before we proceed.
    // If start == 0, _prefixSum[0] = 0 (invariant). Otherwise it was already computed.
    for (let i = start; i < this._count; i++) {
      this._prefixSum[i + 1] = this._prefixSum[i] + this._heights[i];
    }
    this._watermark = INVALID_WATERMARK;
  }

  /** Double capacity, copying existing data. */
  private _grow(): void {
    const newCapacity = this._capacity * 2;
    const newHeights = new Float64Array(newCapacity);
    const newPrefixSum = new Float64Array(newCapacity + 1);

    newHeights.set(this._heights);
    newPrefixSum.set(this._prefixSum);

    this._heights = newHeights;
    this._prefixSum = newPrefixSum;
    this._capacity = newCapacity;
  }
}
