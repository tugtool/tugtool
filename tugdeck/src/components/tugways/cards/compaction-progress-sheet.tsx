/**
 * compaction-progress-sheet.tsx — the pane-modal progress surface for
 * `/compact`.
 *
 * `/compact` summarizes the conversation (a suppressed turn the user never
 * sees) and then continues in a fresh session seeded with that summary.
 * This sheet covers the card for the duration: a determinate bar driven by
 * {@link compactionProgressStore} plus a Cancel button that interrupts the
 * summarization and leaves the session intact. Because the summarization
 * turn is suppressed, Cancel / failure commit nothing — the transcript is
 * untouched.
 *
 * The run owns the sheet's lifetime, not the user: the store transitions
 * (begin → setProgress → succeed/cancel/fail → clear) decide what shows and
 * when it dismisses. The card raises the closing bulletin off the terminal
 * `outcome`, then `clear`s the store; this component watches for that and
 * dismisses the host sheet.
 *
 * Laws: [L02] store state via `useSyncExternalStore`; [L06] appearance via
 *       CSS / the TugProgressIndicator's own DOM attributes; [L20] composed
 *       children (bar, button) keep their own tokens.
 *
 * @module components/tugways/cards/compaction-progress-sheet
 */

import React, { useEffect, useSyncExternalStore } from "react";

import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import {
  compactionProgressStore,
  type CompactionRunPhase,
} from "@/lib/compaction-progress-store";

import "./compaction-progress-sheet.css";

/** Phase → the line shown above the bar while the run is in flight. */
const PHASE_LABEL: Record<CompactionRunPhase, string> = {
  summarizing: "Summarizing…",
  respawning: "Preparing session…",
};

export interface CompactionProgressSheetProps {
  /** Dismiss the host sheet (from `useTugSheet`'s content callback). */
  close: () => void;
  /**
   * User asked to stop — interrupt the summarization and abandon the run.
   * The session is left intact (the summarization turn never committed).
   */
  onCancel: () => void;
}

export function CompactionProgressSheet({
  close,
  onCancel,
}: CompactionProgressSheetProps): React.ReactElement | null {
  const progress = useSyncExternalStore(
    compactionProgressStore.subscribe,
    compactionProgressStore.getSnapshot,
  );

  // The run owns the sheet's lifetime: once the store clears (the card has
  // raised the closing bulletin and reset), dismiss the host sheet. [L02]
  useEffect(() => {
    if (progress === null) close();
  }, [progress, close]);

  if (progress === null) return null;

  const settled = progress.outcome !== null;
  const label = settled ? "Done" : PHASE_LABEL[progress.phase];
  // Cancel only during summarizing: once the fresh session is spawning
  // (respawning) there is nothing left to interrupt.
  const cancelable = !settled && progress.phase === "summarizing";

  return (
    <div className="compaction-progress-sheet" data-slot="compaction-progress">
      <p className="compaction-progress-sheet-message" aria-live="polite">
        {label}
      </p>
      <TugProgressIndicator
        variant="bar"
        value={progress.value}
        max={1}
        size={8}
        showValue
        state={settled ? "completed" : "running"}
        className="compaction-progress-sheet-bar"
        aria-label="Compaction progress"
      />
      {cancelable ? (
        <div className="tug-sheet-actions">
          <TugPushButton onClick={onCancel} data-testid="compaction-cancel">
            Cancel
          </TugPushButton>
        </div>
      ) : null}
    </div>
  );
}
