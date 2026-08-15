/**
 * dash-review.ts — what a dash's plan review state means to a surface.
 *
 * The state itself is computed on the server and rides the dash changeset entry
 * as one string ([P03]); nothing here parses a plan. What lives here is the
 * shared reading of that string, so the three surfaces that paint the mark —
 * the Lens Dashes row, the Changes shade's dash row, and the masthead dash chip
 * — cannot disagree about which states paint or about what they mean.
 *
 * **Only `stale` and `never-reviewed` paint.** A mark that is always present is
 * not a mark: `reviewed` and an absent field are the quiet, common case, and a
 * surface renders nothing for them.
 *
 * The mark is advisory and gates nothing ([P07]) — the gate that matters is
 * `dash-implement`'s setup, which refuses to walk an unreviewed plan long
 * before anything reaches a landing.
 *
 * @module lib/dash-review
 */

/** The two states that paint, in the spellings `tugutil plan status` reports. */
export const DASH_REVIEW_PAINTS = ["stale", "never-reviewed"] as const;

/** Does this review state say anything worth a mark? */
export function dashReviewPaints(review: string | null | undefined): boolean {
  return (
    review !== null &&
    review !== undefined &&
    (DASH_REVIEW_PAINTS as readonly string[]).includes(review)
  );
}

/**
 * What the mark's tooltip says.
 *
 * The two painting states get different words because they call for different
 * responses: a plan that moved past its review wants a re-review, while a plan
 * nothing ever vouched for wants a first one. `planPath` is named only where
 * the surface is this project's own room and the path is actionable — the Lens
 * spans projects on one line, so it passes none.
 */
export function dashReviewTooltip(
  review: string,
  planPath: string | null,
): string {
  const lead =
    review === "stale"
      ? "Plan has changed since its last review"
      : "Plan has never been reviewed";
  return planPath === null ? lead : `${lead} — ${planPath}`;
}
