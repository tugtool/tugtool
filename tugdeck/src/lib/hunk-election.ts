/**
 * hunk-election — reconciling a persisted hunk election against a file's
 * current hunks.
 *
 * An election names hunks by content id, and content moves. The persisted set
 * is therefore a *claim* about a file, not a fact about it, and the row has to
 * resolve the two before it can render either the checkboxes or the badge.
 *
 * One exported function, called from both places, is what makes them unable to
 * disagree: the count in the badge is the count of the boxes, by construction.
 * It lives here rather than beside the component because the component module
 * imports its own CSS, and a pure-logic test should not have to load the
 * component graph to ask what an empty intersection means.
 *
 * The reconciliation is for **display only**. The controller keeps sending the
 * persisted election unreconciled, and the engine's typed drift refusal stays
 * the authority at land time — silently dropping ids on the way to a landing
 * would land something the user never elected.
 */

/** What the row should render for one file's election. */
export interface HunkElectionDisplay {
  /** The ids whose boxes are checked. */
  elected: readonly string[];
  /** The `N of M hunks` badge's numbers, or `null` when the file lands whole. */
  partial: { elected: number; total: number } | null;
  /** Every elected id has drifted out of the file — nothing addressable is
   *  elected, and the landing will refuse until the user re-elects. */
  stale: boolean;
}

/**
 * Resolve a persisted election against the file's current hunk ids.
 *
 * `persisted === null` is whole-file landing: every box checked, no badge.
 * Otherwise the election is intersected with `ids`, and a partial intersection
 * renders as that subset.
 *
 * An **empty** intersection is the interesting case. Every box renders checked,
 * because "nothing addressable is elected" has no other coherent rendering —
 * but `stale` says so, and the row's badge carries that instead of a count. A
 * checked-everywhere row with no other signal would be asserting a whole-file
 * landing the engine is about to refuse, which is the resting lie this rule
 * exists to prevent. Rewriting the empty intersection back to `null` was the
 * other candidate and was rejected: it discards the user's stated intent behind
 * their back, and a row is not a settle gesture.
 */
export function reconcileHunkElection(
  ids: readonly string[],
  persisted: readonly string[] | null,
): HunkElectionDisplay {
  if (persisted === null) {
    return { elected: ids, partial: null, stale: false };
  }
  const current = new Set(ids);
  const elected = persisted.filter((id) => current.has(id));
  if (elected.length === 0) {
    // A file with no hunks at all (created, binary) is not drift — there was
    // never anything to elect, so it reads as whole-file rather than stale.
    if (ids.length === 0) {
      return { elected: ids, partial: null, stale: false };
    }
    return { elected: ids, partial: null, stale: true };
  }
  return {
    elected,
    partial:
      elected.length < ids.length
        ? { elected: elected.length, total: ids.length }
        : null,
    stale: false,
  };
}
