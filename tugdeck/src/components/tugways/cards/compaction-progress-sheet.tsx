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
import { useSeedKeyView } from "@/components/tugways/use-focusable";
import { compactionProgressStore } from "@/lib/compaction-progress-store";

import "./compaction-progress-sheet.css";

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

  const cancelFocusGroup = React.useId();
  // Cancel only during summarizing: once the fresh session is spawning
  // (respawning) there is nothing left to interrupt.
  const cancelable =
    progress !== null &&
    progress.outcome === null &&
    progress.phase === "summarizing";
  // Seed Cancel as the sheet's live default (filled + double ring) so Return
  // triggers it — only while it is actually shown.
  useSeedKeyView(cancelable ? `${cancelFocusGroup}:0` : null);

  if (progress === null) return null;

  const settled = progress.outcome !== null;

  return (
    <div className="compaction-progress-sheet" data-slot="compaction-progress">
      {/* The determinate bar + its percentage readout carry the progress on
          their own — no phase caption needed. */}
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
          {/* The sheet's live default: seeded (see useSeedKeyView above) and
              opted into `persistentDefaultRing` so it wears the filled +
              double-ring default treatment (via `data-default-ring`) the whole
              time it is shown — not only while the seeded key view happens to be
              projecting `data-key-view-kbd` — and Return triggers it. Cancel is
              the only action a running compaction offers. */}
          <TugPushButton
            size="sm"
            emphasis="primary"
            role="action"
            onClick={onCancel}
            data-testid="compaction-cancel"
            focusGroup={cancelFocusGroup}
            focusOrder={0}
            persistentDefaultRing
          >
            Cancel
          </TugPushButton>
        </div>
      ) : null}
    </div>
  );
}
