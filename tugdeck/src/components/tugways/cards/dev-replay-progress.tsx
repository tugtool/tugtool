/**
 * `dev-replay-progress.tsx` — pure view helpers for the restore-progress
 * readout.
 *
 * The `DevReplayProgress` strip component was retired in favor of the
 * pane-modal `DevRestoreSheet` (redux [P08]); these pure helpers — which
 * derive the `[Restoring…][bar][N of M turns]` view from the flush-committed
 * turn count + the entry path's expected total — are kept and reused inside
 * that sheet. They are unit-tested directly (`dev-replay-progress-label.test`).
 *
 * @module components/tugways/cards/dev-replay-progress
 */

import { type ResumeDisplayMetadata } from "@/lib/dev-session-restore";

/**
 * The derived view: a label plus, when the entry path knew the expected
 * turn total, a determinate `{value, max}` pair for the `TugProgressIndicator`
 * bar (which then renders the canonical labeled-bar layout with a trailing
 * "N of M turns" readout via `formatValue`). Without a total the bar runs
 * indeterminate and the count, when non-zero, folds into the label. Pure.
 * `turnsSoFar` is the committed-transcript length at the latest fold flush.
 */
export interface ReplayProgressView {
  label: string;
  /** Determinate progress value, or null → indeterminate. */
  value: number | null;
  max: number | null;
}

export function deriveReplayProgress(
  turnsSoFar: number,
  metadata: ResumeDisplayMetadata | undefined,
): ReplayProgressView {
  // The label is deliberately the bare verb — the session title rides
  // the metadata for any surface that wants it, but the readout reads
  // `[Restoring…][bar][N of M turns]` per the canonical labeled-bar
  // layout.
  const total =
    metadata?.turnCount !== undefined &&
    metadata.turnCount !== null &&
    metadata.turnCount > 0
      ? metadata.turnCount
      : null;
  if (total !== null) {
    return {
      label: "Restoring…",
      value: Math.min(turnsSoFar, total),
      max: total,
    };
  }
  if (turnsSoFar > 0) {
    return {
      label: `Restoring — ${turnsSoFar} turns…`,
      value: null,
      max: null,
    };
  }
  return { label: "Restoring…", value: null, max: null };
}

/**
 * Force a captured view to its completed pose: the bar MUST reach full
 * before the surface dismisses — a partial fill at dismissal reads as the
 * restore escaping our control. A determinate view completes to `max of
 * max`; an indeterminate one renders a full anonymous bar.
 */
export function completeReplayProgress(
  view: ReplayProgressView,
): ReplayProgressView {
  if (view.max !== null) {
    return { label: view.label, value: view.max, max: view.max };
  }
  return { label: "Restoring…", value: 1, max: 1 };
}

/** `formatValue` for the determinate readout — "465 of 4,904 turns". */
export function formatReplayProgressValue(value: number, max: number): string {
  return `${value.toLocaleString()} of ${max.toLocaleString()} turns`;
}
