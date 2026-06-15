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
 * Both are pure functions over counts, unit-tested in isolation. The window
 * unit is message-rows (a normal turn = user + assistant = 2 rows, a wake =
 * 1) — the same unit `RequestReplay.lastMessages` and `firstLoadedMessageIndex`
 * count in, so the arithmetic lines up end to end.
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
 * The resume window (in message-rows) needed to include the saved anchor: the
 * default window when the anchor is within it (or no anchor was saved), else
 * deep enough to reach the anchor. Never smaller than the default — recent
 * content is always loaded.
 */
export function resolveRestoreWindow(
  depthFromEnd: number | undefined,
  defaultWindow: number,
): number {
  if (depthFromEnd === undefined || depthFromEnd <= defaultWindow) {
    return defaultWindow;
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
