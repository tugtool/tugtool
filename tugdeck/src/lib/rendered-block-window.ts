/**
 * RenderedBlockWindow — sliding window viewport manager for virtualized markdown rendering.
 *
 * Maintains a contiguous range [startIndex, endIndex) of blocks with DOM nodes.
 * On scroll, computes the new visible range from BlockHeightIndex, diffs against
 * the current window, and returns enter/exit block ranges plus spacer heights.
 *
 * Design decisions:
 * - [D02] Sliding window with overscan — 2 screens above and below the viewport.
 *   Spacer elements above and below handle the scroll-height padding; no CSS transform needed.
 * - Dirty flag tracking via Set<number> — marks blocks whose content changed and need DOM rebuild.
 */

import { BlockHeightIndex } from "./block-height-index";

// ---------------------------------------------------------------------------
// Public types

/** An inclusive-start, exclusive-end range of block indices. */
export interface BlockRange {
  startIndex: number;
  endIndex: number;
}

/**
 * Diff result returned by RenderedBlockWindow.update().
 * Caller uses this to add entering blocks to the DOM and remove exiting blocks.
 */
export interface WindowUpdate {
  /** Ranges of blocks that should be added to the DOM. */
  enter: BlockRange[];
  /** Ranges of blocks that should be removed from the DOM. */
  exit: BlockRange[];
  /** Height of the top spacer div (sum of heights for blocks before startIndex). */
  topSpacerHeight: number;
  /** Height of the bottom spacer div (sum of heights for blocks after endIndex). */
  bottomSpacerHeight: number;
}

// ---------------------------------------------------------------------------
// RenderedBlockWindow

/**
 * RenderedBlockWindow maintains a contiguous range [startIndex, endIndex) of
 * blocks whose DOM nodes exist. On each scroll event, it:
 *   1. Computes the visible block range from BlockHeightIndex binary search.
 *   2. Extends by overscan (default: 2 viewport heights above and below).
 *   3. Diffs against the current rendered range.
 *   4. Returns enter/exit ranges for the caller to apply to the DOM.
 *   5. Provides top/bottom spacer heights so the scroll container has accurate total height.
 *
 * Usage:
 *   const window = new RenderedBlockWindow(heightIndex, viewportHeight);
 *   const update = window.update(scrollTop);
 *   // apply update.enter / update.exit to DOM
 *   // set topSpacer.style.height = update.topSpacerHeight + "px"
 *   // set bottomSpacer.style.height = update.bottomSpacerHeight + "px"
 */
export class RenderedBlockWindow {
  private _heightIndex: BlockHeightIndex;
  private _viewportHeight: number;
  private _overscanScreens: number;
  private _startIndex: number;
  private _endIndex: number;
  private _dirty: Set<number>;

  /**
   * @param heightIndex - BlockHeightIndex that tracks block heights and prefix sums.
   * @param viewportHeight - Current viewport height in pixels.
   * @param overscanScreens - Number of viewport heights to render above and below the visible area. Default: 2.
   */
  constructor(heightIndex: BlockHeightIndex, viewportHeight: number, overscanScreens = 2) {
    this._heightIndex = heightIndex;
    this._viewportHeight = Math.max(1, viewportHeight);
    this._overscanScreens = Math.max(0, overscanScreens);
    this._startIndex = 0;
    this._endIndex = 0;
    this._dirty = new Set();
  }

  // -------------------------------------------------------------------------
  // Public API

  /**
   * Compute the new window for the given scroll position and diff against the current window.
   * Returns enter/exit ranges and updated spacer heights.
   * Must be called after blocks have been appended to the BlockHeightIndex.
   */
  update(scrollTop: number): WindowUpdate {
    const count = this._heightIndex.count;

    if (count === 0) {
      const hadRange = this._startIndex < this._endIndex;
      const update: WindowUpdate = {
        enter: [],
        exit: hadRange ? [{ startIndex: this._startIndex, endIndex: this._endIndex }] : [],
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
      this._startIndex = 0;
      this._endIndex = 0;
      return update;
    }

    // Compute visible range.
    const overscanPx = this._overscanScreens * this._viewportHeight;
    const visibleTop = Math.max(0, scrollTop);
    const visibleBottom = scrollTop + this._viewportHeight;

    const overscanTop = Math.max(0, visibleTop - overscanPx);
    const overscanBottom = visibleBottom + overscanPx;

    // Find first block at or after overscanTop.
    let newStart = this._heightIndex.getBlockAtOffset(overscanTop);

    // Find first block past overscanBottom (exclusive end).
    let newEnd = this._heightIndex.getBlockAtOffset(overscanBottom);
    // Advance past the block that contains overscanBottom if it's not already past it.
    if (newEnd < count) {
      const blockTop = this._heightIndex.getBlockOffset(newEnd);
      if (blockTop <= overscanBottom) {
        newEnd++;
      }
    }
    // Clamp to valid range.
    newStart = Math.max(0, Math.min(newStart, count));
    newEnd = Math.max(newStart, Math.min(newEnd, count));

    // Diff old [_startIndex, _endIndex) vs new [newStart, newEnd).
    const oldStart = this._startIndex;
    const oldEnd = this._endIndex;

    const enter: BlockRange[] = [];
    const exit: BlockRange[] = [];

    if (oldStart >= oldEnd) {
      // No previous window — everything is new.
      if (newStart < newEnd) {
        enter.push({ startIndex: newStart, endIndex: newEnd });
      }
    } else if (newStart >= newEnd) {
      // New window is empty — everything exits.
      exit.push({ startIndex: oldStart, endIndex: oldEnd });
    } else {
      // Both windows are non-empty. Compute symmetric diff.
      // Blocks exiting at the top: [oldStart, min(oldEnd, newStart))
      if (oldStart < newStart) {
        exit.push({ startIndex: oldStart, endIndex: Math.min(oldEnd, newStart) });
      }
      // Blocks exiting at the bottom: [max(oldStart, newEnd), oldEnd)
      if (newEnd < oldEnd) {
        exit.push({ startIndex: Math.max(oldStart, newEnd), endIndex: oldEnd });
      }
      // Blocks entering at the top: [newStart, min(newEnd, oldStart))
      if (newStart < oldStart) {
        enter.push({ startIndex: newStart, endIndex: Math.min(newEnd, oldStart) });
      }
      // Blocks entering at the bottom: [max(newStart, oldEnd), newEnd)
      if (oldEnd < newEnd) {
        enter.push({ startIndex: Math.max(newStart, oldEnd), endIndex: newEnd });
      }
    }

    // Compute spacer heights.
    const topSpacerHeight = newStart > 0 ? this._heightIndex.getBlockOffset(newStart) : 0;
    const totalHeight = this._heightIndex.getTotalHeight();
    const bottomStart = newEnd < count ? this._heightIndex.getBlockOffset(newEnd) : totalHeight;
    const bottomSpacerHeight = Math.max(0, totalHeight - bottomStart);

    this._startIndex = newStart;
    this._endIndex = newEnd;

    return { enter, exit, topSpacerHeight, bottomSpacerHeight };
  }

  /** Current rendered range [startIndex, endIndex). */
  get currentRange(): BlockRange {
    return { startIndex: this._startIndex, endIndex: this._endIndex };
  }

  /** Mark a block as dirty — its content changed and the DOM node needs rebuilding. */
  markDirty(index: number): void {
    this._dirty.add(index);
  }

  /** Check if a block is dirty. */
  isDirty(index: number): boolean {
    return this._dirty.has(index);
  }

  /** Clear the dirty flag for a block after its DOM node has been updated. */
  clearDirty(index: number): void {
    this._dirty.delete(index);
  }

  /** Update viewport height (e.g., on window/container resize). */
  setViewportHeight(height: number): void {
    this._viewportHeight = Math.max(1, height);
  }
}
