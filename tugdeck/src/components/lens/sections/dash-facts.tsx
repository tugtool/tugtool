/**
 * dash-facts.tsx — a dash's facts as one row run, and the review mark inside it.
 *
 * Two Lens surfaces say the same things about a dash now: the Dashes section's
 * roster rows, and the sub-row nested under the session working it in the Cards
 * section. They answer different questions — what dashes exist, versus what
 * this session is doing — but the sentence is the same one, so it is authored
 * once here rather than twice and kept in step by hand.
 *
 * The roster adds its own trailing project label, which the sub-row has no use
 * for: a sub-row is already inside a session, and the session names the project.
 */

import "./dash-facts.css";

import React from "react";
import { FileClock, FileQuestion } from "lucide-react";

import { TugTooltip } from "@/components/tugways/tug-tooltip";
import { dashReviewPaints, dashReviewTooltip } from "@/lib/dash-review";

/**
 * The advisory mark a dash's plan review wears.
 *
 * Absent unless there is something to say — only `stale` and `never-reviewed`
 * paint at all. A Lens row spans projects on one line, so the tooltip names the
 * state and not the plan's path; the path is the Changes shade's to show.
 */
export function DashReviewMark({
  review,
  size,
}: {
  review: string;
  /** The glyph's box, in px — each surface sizes it off its own row's mark. */
  size: number;
}): React.ReactElement {
  const Glyph = review === "stale" ? FileClock : FileQuestion;
  return (
    <TugTooltip content={dashReviewTooltip(review, null)}>
      <span
        className="lens-dashes-review"
        data-slot="lens-dashes-review"
        data-review={review}
        aria-label={dashReviewTooltip(review, null)}
      >
        <Glyph size={size} />
      </span>
    </TugTooltip>
  );
}

/** The name, the stage, the step counters, and the review mark, in that order. */
export function DashFactsRun({
  name,
  stage,
  steps,
  review,
  markSize,
  trailing,
}: {
  name: string;
  stage: string | null;
  /** `step i/N`, preformatted, or null when the sender declared no counters. */
  steps: string | null;
  review: string | null;
  markSize: number;
  /** What the surface adds after the shared run — the roster's project label. */
  trailing?: React.ReactNode;
}): React.ReactElement {
  return (
    <span className="lens-dashes-facts">
      <span className="lens-dashes-name">{name}</span>
      {stage !== null ? (
        <span className="lens-dashes-stage">{stage}</span>
      ) : null}
      {steps !== null ? <span className="lens-dashes-step">{steps}</span> : null}
      {dashReviewPaints(review) ? (
        <DashReviewMark review={review!} size={markSize} />
      ) : null}
      {trailing}
    </span>
  );
}
