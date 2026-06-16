/**
 * dev-restore-window — pure helpers for faithful restore under recency
 * windowing ([recency P05]/[P06], #step-6).
 *
 * The loaded transcript window is always contiguous to the bottom (default =
 * the last N turns; load-previous prepends older turns above), so a saved
 * scroll anchor's *distance from the bottom* is **invariant across a reload**:
 * the bottom and the on-disk JSONL are unchanged, so only the content above
 * the anchor differs by how much got paged in.
 *
 * The canonical unit is the **turn** (`tuglaws/turn-metric.md`). The window is
 * sized in turns and requested as `RequestReplay.lastTurns`, and the
 * transcript anchor's depth is a **turn** count too ([P06]): one turn quantity
 * both sizes the resume window and re-finds the anchored turn — there is no
 * row↔turn unit to bridge. The only non-turn quantity that survives a restore
 * is the sub-row pixel offset *within* the anchored turn.
 *
 * Lists that have no concept of turns (the gallery, the sheets) are never
 * windowed, so their `numberOfItems` is stable across a reload and the raw
 * saved row index relocates faithfully on its own. The row helpers below
 * ({@link anchorDepthFromEnd}, {@link anchorRowIndexInWindow}) serve those
 * genuinely rowful lists; the transcript uses the turn path exclusively.
 *
 * @module lib/dev-restore-window
 */

/**
 * Rows from the saved anchor (inclusive) down to the bottom, captured at save
 * time: `numberOfItems - anchorIndex`. Clamped at 0. For non-turn lists whose
 * data source supplies no turn-depth resolver.
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
 * deep enough to reach the anchored turn. Never smaller than the default —
 * recent content is always loaded.
 *
 * Both arguments are turn counts, so this is a plain `max`: load whichever is
 * larger of the default window and the saved anchor's turn depth. No row↔turn
 * bridging — the anchor speaks the same unit the window does.
 */
export function resolveRestoreWindow(
  anchorTurnDepth: number | undefined,
  defaultWindowTurns: number,
): number {
  if (anchorTurnDepth === undefined) return defaultWindowTurns;
  return Math.max(anchorTurnDepth, defaultWindowTurns);
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
