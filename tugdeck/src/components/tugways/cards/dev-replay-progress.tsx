/**
 * `DevReplayProgress` — the always-on resume affordance ([P03] /
 * Spec S03 of the resume-performance plan).
 *
 * Visible from the moment the card body mounts on a resume until the
 * replay window closes, replaced by content, never by blank. The wait
 * has three segments and only one produces deck events, so the strip
 * is built to be informative across all of them:
 *
 *  1. **Open → first frame** (spawn + request + read + translate):
 *     nothing arrives at the deck. The strip shows the t=0 facts the
 *     entry path already knew — title and expected turn total from the
 *     picker's ledger row or the cold-boot binding
 *     (`getResumeDisplayMetadata`) — on a `TugProgressIndicator` bar
 *     (determinate "N of M turns" when the total is known,
 *     indeterminate motion otherwise; the indicator owns the motion).
 *  2. **Ingest**: the replay fold flushes every
 *     `REPLAY_FOLD_FLUSH_THRESHOLD` events; each flush is a listener
 *     notify, so the `useSyncExternalStore` turn-count read below
 *     ticks exactly at flush commits — the only render-coupled signal
 *     ([L02]). Progress is never timer-driven; the one `setTimeout`
 *     here is the dismissal dwell (lifecycle, not render scheduling —
 *     the bar completes to full and lingers briefly before the strip
 *     unmounts, same timer class as `DevRestoring`'s panel delay).
 *  3. **The windowed mount commits**: bounded by collapse + windowing,
 *     painting under the strip until the window closes and the strip
 *     unmounts.
 *
 * Activity predicate: the cold-restore window
 * (`deriveColdRestoreActive` — preflight or resume-mode replaying) OR
 * any open replay window (`phase === "replaying"`, which also covers
 * a mid-session reconnect catch-up honestly).
 *
 * Laws:
 *  - [L02] both reads enter through `useSyncExternalStore`; the strip
 *    re-renders only on fold flushes / phase edges.
 *  - [L13] motion belongs to `TugProgressIndicator` (the shared
 *    progress primitive) — no bespoke animation here.
 *  - [L19] file pair, docstring, `data-slot="dev-replay-progress"`.
 *  - [L20] the indicator keeps its own tokens; this strip styles only
 *    its container.
 *
 * @module components/tugways/cards/dev-replay-progress
 */

import "./dev-replay-progress.css";

import React from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import { deriveColdRestoreActive } from "./dev-card-restore-gate";
import {
  getResumeDisplayMetadata,
  type ResumeDisplayMetadata,
} from "@/lib/dev-session-restore";

/**
 * The strip's derived view: a label plus, when the entry path knew the
 * expected turn total, a determinate `{value, max}` pair for the
 * `TugProgressIndicator` bar (which then renders the canonical
 * labeled-bar layout with a trailing "N of M turns" readout via
 * `formatValue`). Without a total the bar runs indeterminate and the
 * count, when non-zero, folds into the label. Pure — unit-tested
 * directly. `turnsSoFar` is the committed-transcript length at the
 * latest fold flush.
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
  // the metadata for any surface that wants it, but the strip reads
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
 * Force a captured view to its completed pose: the bar MUST reach
 * full before the strip dismisses — a partial fill at dismissal reads
 * as the restore escaping our control. A determinate view completes
 * to `max of max`; an indeterminate one renders a full anonymous bar.
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

/**
 * How long the completed (full-bar) pose lingers before the strip
 * unmounts. A lifecycle dwell, not render scheduling — the same
 * `setTimeout` class as `DevRestoring`'s panel-reveal delay; replay
 * progress itself stays purely event-driven.
 */
export const REPLAY_PROGRESS_DISMISS_DWELL_MS = 700;

export interface DevReplayProgressProps {
  cardId: string;
  codeSessionStore: CodeSessionStore;
}

export const DevReplayProgress: React.FC<DevReplayProgressProps> = ({
  cardId,
  codeSessionStore,
}) => {
  // Narrow primitive selectors so the strip re-renders only when the
  // routing decision or the flush-committed turn count changes.
  const active = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => {
      const s = codeSessionStore.getSnapshot();
      return deriveColdRestoreActive(s) || s.phase === "replaying";
    },
  );
  const turnsSoFar = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().transcript.length,
  );

  // Dismissal dwell: the window-close commit would otherwise unmount
  // the strip in the same paint that delivers the final turn count,
  // so the user never sees the bar finish. On the active → settled
  // edge the strip lingers briefly in its completed pose (full bar,
  // `max of max`), then unmounts. The last live view is captured in a
  // ref because the resume metadata clears with the window.
  const [dwell, setDwell] = React.useState(false);
  const lastViewRef = React.useRef<ReplayProgressView | null>(null);
  const wasActiveRef = React.useRef(false);
  React.useEffect(() => {
    if (active) {
      wasActiveRef.current = true;
      setDwell(false);
      return;
    }
    if (!wasActiveRef.current) return;
    wasActiveRef.current = false;
    setDwell(true);
    const handle = setTimeout(
      () => setDwell(false),
      REPLAY_PROGRESS_DISMISS_DWELL_MS,
    );
    return () => clearTimeout(handle);
  }, [active]);

  let view: ReplayProgressView;
  if (active) {
    view = deriveReplayProgress(turnsSoFar, getResumeDisplayMetadata(cardId));
    lastViewRef.current = view;
  } else if (dwell && lastViewRef.current !== null) {
    view = completeReplayProgress(lastViewRef.current);
  } else {
    return null;
  }
  // The anonymous full bar (indeterminate capture) has no meaningful
  // count to read out; the determinate one completes to "N of N turns".
  const showValue = view.max !== null && view.max > 1;
  return (
    <div
      className="dev-replay-progress"
      data-slot="dev-replay-progress"
      data-testid="dev-replay-progress"
      role="status"
      aria-live="polite"
    >
      <TugProgressIndicator
        variant="bar"
        size={8}
        role="action"
        state="running"
        label={view.label}
        glyphPosition="right"
        {...(view.value !== null && view.max !== null
          ? {
              value: view.value,
              max: view.max,
              ...(showValue
                ? { showValue: true, formatValue: formatReplayProgressValue }
                : {}),
            }
          : {})}
        className="dev-replay-progress-bar"
        aria-label={view.label}
      />
    </div>
  );
};
