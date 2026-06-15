/**
 * list-view-prepend — pure helpers for holding scroll position when a
 * data source grows at the FRONT (older turns paged in above the view).
 *
 * Internal building block — app code uses `TugListView` instead.
 *
 * Two concerns, both pure and unit-testable in isolation from the DOM:
 *
 *   1. {@link detectPrepend} — classify a commit as a front-insert by
 *      comparing the row id at index 0 across commits. On an append
 *      (the normal case) the first id is unchanged, so this returns
 *      `null` and the compensation path stays dormant.
 *   2. {@link prependScrollAdjustment} — the scroll-position-hold math:
 *      after M rows insert above the viewport the container's
 *      `scrollHeight` grows; adding that delta to `scrollTop` keeps the
 *      previously-visible content under the same viewport Y ([L23]).
 *
 * Laws: this module is non-React, non-DOM. The relevant citations
 * ([L23] scroll preservation, [L06] the `scrollTop` write is DOM) live
 * on `TugListView`, which wires these helpers to the live container.
 */

/**
 * A detected front-insert: `added` rows appeared ahead of the previously
 * first row. `null` means "not a prepend" — either the first row id is
 * unchanged (an append or a no-op), the list was empty before, or the
 * count didn't grow.
 */
export interface PrependDetection {
  /** Number of rows inserted at the front this commit. */
  added: number;
}

/**
 * Classify a commit as a front-insert (prepend) or not, from the row id
 * at index 0 and the item count, across two commits.
 *
 * A prepend is recognized when ALL hold:
 *   - there was a prior first id (the list wasn't empty before),
 *   - the first id changed (new rows sit ahead of the old first row),
 *   - the count grew.
 *
 * `added` is `count - prevCount`. A load-previous bracket only adds
 * older turns (never simultaneously appends), so the front delta is the
 * whole growth. An append leaves the first id unchanged and returns
 * `null`, keeping the scroll-hold path dormant in the common case.
 */
export function detectPrepend(
  prevFirstId: string | null,
  prevCount: number,
  firstId: string | null,
  count: number,
): PrependDetection | null {
  if (prevFirstId === null) return null;
  if (firstId === null) return null;
  if (firstId === prevFirstId) return null;
  if (count <= prevCount) return null;
  return { added: count - prevCount };
}

/**
 * The scroll-position-hold value: given the container's `scrollHeight`
 * before and after a front-insert and the `scrollTop` captured before
 * the commit, return the `scrollTop` that keeps the previously-visible
 * content at the same viewport Y.
 *
 * The browser preserves `scrollTop` across a DOM growth, so content
 * inserted above visually pushes the view down by the inserted height;
 * compensating by the `scrollHeight` delta cancels that push. A
 * non-positive delta (no growth, or a shrink) yields no change beyond
 * clamping, so the helper is safe to call unconditionally once a
 * prepend is detected. The result is clamped to `>= 0`.
 */
export function prependScrollAdjustment(
  oldScrollHeight: number,
  newScrollHeight: number,
  oldScrollTop: number,
): number {
  const delta = newScrollHeight - oldScrollHeight;
  return Math.max(0, oldScrollTop + delta);
}
