/**
 * `QuestionSummaryList` / `QuestionSummaryRow` — the ONE rendering of an
 * `AskUserQuestion` summary row (status marker · `N.` number · question
 * heading · `→ answer`), shared by both surfaces so they are pixel-identical
 * by construction rather than by hand-synced CSS:
 *
 *   - the LIVE wizard's rail (`dev-question-dialog.tsx`) — interactive rows
 *     the user clicks to jump back to a question, with a per-row status
 *     (current / done / recommended / pending) driving the marker tone and
 *     the current-row tint;
 *   - the DURABLE answered record (`ask-user-question-tool-block.tsx`) —
 *     static rows (done / pending) that read as the same artifact.
 *
 * Both build a `QuestionSummaryRowData[]` from their own state and hand it to
 * `QuestionSummaryList`; the visual state is expressed entirely through the
 * `status` field (→ `data-status`) and the shared `--tugx-qrow-*` token
 * family. There is no second copy of the box model to keep in step.
 *
 * Geometry is uniform across statuses: every row reserves its one-line
 * `→ answer` slot (hidden via `data-empty`, clamped to one ellipsized line),
 * so a status change never changes a row's height — the live rail's
 * constant-geometry contract, carried into the durable record for free.
 *
 * Laws:
 *  - [L06] no React state for appearance — `data-status` / `data-empty` gate
 *    tone + visibility; CSS owns colour and layout.
 *  - [L19] file pair (`.tsx` + `.css`), exported props, `data-slot` on the
 *    containers, this docstring.
 *  - [L20] owns the `--tugx-qrow-*` family; references `--tugx-list-row-*`
 *    read-only so its box model tracks the list-row density knob.
 *
 * @module components/tugways/question-summary-list
 */

import "./question-summary-list.css";

import React from "react";
import { Check, ChevronRight, Circle, CircleDot } from "lucide-react";

import { cn } from "@/lib/utils";

/** A summary row's visual state — drives the marker icon + tone and, for
 *  `current`, the highlight tint. */
export type QuestionRowStatus = "current" | "done" | "recommended" | "pending";

/** Pixel size for the lucide row-marker icons — matches the heading glyph
 *  height so the icon and prose sit on the same optical baseline. */
const ROW_MARKER_ICON_SIZE = 14;

/**
 * The lucide marker for a row status — one source of truth for the
 * status → icon mapping (the CSS keys tone colours off the same `data-status`
 * the row stamps):
 *
 *  - `done`        → Check       (success-toned)
 *  - `recommended` → CircleDot   (info-toned — a "soft default")
 *  - `current`     → ChevronRight (link-toned — "this row is open")
 *  - `pending`     → Circle      (muted ring)
 */
export function QuestionRowMarker({
  status,
}: {
  status: QuestionRowStatus;
}): React.ReactElement {
  if (status === "done") {
    return <Check size={ROW_MARKER_ICON_SIZE} aria-hidden="true" />;
  }
  if (status === "recommended") {
    return <CircleDot size={ROW_MARKER_ICON_SIZE} aria-hidden="true" />;
  }
  if (status === "current") {
    return <ChevronRight size={ROW_MARKER_ICON_SIZE} aria-hidden="true" />;
  }
  return <Circle size={ROW_MARKER_ICON_SIZE} aria-hidden="true" />;
}

/** One summary row's data. The caller maps its own state onto this shape. */
export interface QuestionSummaryRowData {
  /** Zero-based position — the visible number is `index + 1`. */
  index: number;
  /** The question text (the row heading). */
  question: string;
  /** The `→ answer` text. Empty → the reserved answer slot hides (keeping the
   *  row's height) rather than collapsing. Multi-select answers arrive
   *  pre-joined (one ellipsized line). */
  answer: string;
  /** Visual state — marker icon/tone + the current-row tint. */
  status: QuestionRowStatus;
  /** Jump-to-this-question, for the live rail. Omitted (or on the `current`
   *  row) → the row is static (the durable record, or the open question). */
  onActivate?: () => void;
  /** Accessible label; falls back to the question text. */
  ariaLabel?: string;
}

/**
 * One summary row — a two-column grid (marker · body). The body stacks the
 * `N. question` heading over the reserved one-line `→ answer` slot. The row is
 * clickable only when `onActivate` is set and it isn't the `current` row.
 */
export function QuestionSummaryRow({
  index,
  question,
  answer,
  status,
  onActivate,
  ariaLabel,
}: QuestionSummaryRowData): React.ReactElement {
  const interactive = onActivate !== undefined && status !== "current";
  return (
    <div
      className="question-summary-row"
      data-slot="question-summary-row"
      data-status={status}
      data-interactive={interactive ? "true" : undefined}
      role="listitem"
      aria-current={status === "current" ? "step" : undefined}
      aria-label={ariaLabel ?? question}
      onClick={interactive ? onActivate : undefined}
    >
      <span className="question-summary-row-marker" aria-hidden="true">
        <QuestionRowMarker status={status} />
      </span>
      <div className="question-summary-row-body">
        <div className="question-summary-row-heading">
          <span className="question-summary-row-number">{index + 1}.</span>
          {question}
        </div>
        <div
          className="question-summary-row-answer"
          data-slot="question-summary-row-answer"
          data-empty={answer === "" ? "true" : undefined}
        >
          → {answer}
        </div>
      </div>
    </div>
  );
}

export interface QuestionSummaryListProps {
  /** The rows, in question order. */
  rows: ReadonlyArray<QuestionSummaryRowData>;
  /** Forwarded class on the list container for cascade-scoped customization. */
  className?: string;
  /** Accessible label for the list. */
  ariaLabel?: string;
}

/**
 * The list of {@link QuestionSummaryRow}s — a flex column with the shared
 * inter-row gap. Both the live rail and the answered record render this; the
 * only difference is whether the rows carry an `onActivate`.
 */
export function QuestionSummaryList({
  rows,
  className,
  ariaLabel,
}: QuestionSummaryListProps): React.ReactElement {
  return (
    <div
      className={cn("question-summary-list", className)}
      data-slot="question-summary-list"
      role="list"
      aria-label={ariaLabel}
    >
      {rows.map((row) => (
        <QuestionSummaryRow key={`${row.index}:${row.question}`} {...row} />
      ))}
    </div>
  );
}
