/**
 * dev-restore-window — pure helpers for faithful restore under recency
 * windowing ([recency P05]/[P06], #step-6).
 *
 * The loaded transcript window is always contiguous to the bottom (default =
 * the last N message-rows; load-previous prepends older rows above), so a
 * saved scroll anchor's *distance from the bottom* in rows — `depthFromEnd` —
 * is **invariant across a reload**: the bottom and the on-disk JSONL are
 * unchanged, so only the rows above the anchor differ by how much got paged
 * in. That single number does both jobs:
 *
 *   1. **Size the resume window** — load enough recent rows to include the
 *      anchor (the default N when the anchor is within it; deeper when the
 *      user was parked above it).
 *   2. **Relocate the anchor** — within whatever window lands, the anchor's
 *      row index is `numberOfItems - depthFromEnd`.
 *
 * The window is now sized in **turns** (the canonical unit,
 * `tuglaws/turn-metric.md`) and requested as `RequestReplay.lastTurns`, while
 * the scroll anchor stays row-based ([P06]): a saved `depthFromEnd` is a
 * row distance, and the anchor's relocation within whatever rows land is row
 * arithmetic. The two meet at load time — a turn-sized request yields a set
 * of rows, and the anchor is placed within them. Because every turn is at
 * least one row, requesting N turns always loads at least N rows, which makes
 * the row-anchor coverage check below a safe lower bound.
 *
 * @module lib/dev-restore-window
 */

/**
 * Rows from the saved anchor (inclusive) down to the bottom, captured at save
 * time: `numberOfItems - anchorIndex`. Clamped at 0.
 */
export function anchorDepthFromEnd(
  numberOfItems: number,
  anchorIndex: number,
): number {
  return Math.max(0, numberOfItems - anchorIndex);
}

/**
 * The resume window (in **turns**) needed to include the saved anchor: the
 * default window when the anchor is within it (or no anchor was saved), else
 * deep enough to reach the anchor. Never smaller than the default — recent
 * content is always loaded.
 *
 * `depthFromEnd` is a row distance, `defaultWindowTurns` a turn count. They
 * are comparable as a *guarantee* because every turn yields at least one row:
 * a window of K turns loads ≥ K rows, so when `depthFromEnd ≤ defaultWindowTurns`
 * the default window is certain to reach the anchor. When the anchor is
 * deeper, returning `depthFromEnd` turns still guarantees coverage (≥ that
 * many rows) — an over-approximation for multi-row turns that loads somewhat
 * more than a row-window would, which is acceptable and visible in the load
 * bar ([R02]).
 */
export function resolveRestoreWindow(
  depthFromEnd: number | undefined,
  defaultWindowTurns: number,
): number {
  if (depthFromEnd === undefined || depthFromEnd <= defaultWindowTurns) {
    return defaultWindowTurns;
  }
  return depthFromEnd;
}

/**
 * Relocate the saved anchor to a row index in the freshly-loaded window:
 * `numberOfItems - depthFromEnd`, clamped into `[0, numberOfItems)`. With a
 * window sized by {@link resolveRestoreWindow} the anchor lands in range; the
 * clamp guards a window that loaded fewer rows than expected (e.g. a session
 * shorter than the saved depth).
 */
export function anchorRowIndexInWindow(
  numberOfItems: number,
  depthFromEnd: number,
): number {
  const index = numberOfItems - depthFromEnd;
  if (index <= 0) return 0;
  if (index >= numberOfItems) return Math.max(0, numberOfItems - 1);
  return index;
}
