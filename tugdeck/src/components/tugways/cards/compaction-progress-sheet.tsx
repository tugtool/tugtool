/**
 * compaction-progress-sheet.tsx — the pane-modal progress surface for
 * `/compact`.
 *
 * Native `/compact` compacts the conversation in place (same session, same
 * JSONL). It is a ~20 s opaque run — nothing streams between dispatch and the
 * `compact_boundary`, so there is no honest determinate signal. This sheet
 * covers the card for the duration with an **indeterminate** "Compacting…"
 * indicator plus a Cancel button that interrupts the run (the turn interrupt,
 * the same path Stop / Escape take).
 *
 * The run owns the sheet's lifetime, not the user: the store transitions
 * (begin → succeed/cancel/fail → clear) decide what shows and when it
 * dismisses. The card raises the closing bulletin off the terminal `outcome`,
 * then `clear`s the store; this component watches for that and dismisses the
 * host sheet.
 *
 * Laws: [L02] store state via `useSyncExternalStore`; [L06] appearance via
 *       CSS / the TugProgressIndicator's own DOM attributes; [L20] composed
 *       children (indicator, button) keep their own tokens.
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
   * User asked to stop — interrupt the compaction. Cancel maps to the turn
   * interrupt; [Q01] verifies Claude Code aborts it cleanly (session intact).
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
  // Cancel only while the run is in flight — once it settles there is nothing
  // left to interrupt (the sheet is about to dismiss).
  const cancelable = progress !== null && progress.outcome === null;
  // Seed Cancel as the sheet's live default (filled + double ring) so Return
  // triggers it — only while it is actually shown.
  useSeedKeyView(cancelable ? `${cancelFocusGroup}:0` : null);

  if (progress === null) return null;

  const settled = progress.outcome !== null;

  return (
    <div className="compaction-progress-sheet" data-slot="compaction-progress">
      {/* Indeterminate bar — the run is opaque (nothing streams until the
          boundary), so there is no determinate fraction to honor. Omitting
          `value` runs the variant's indeterminate motion. The sheet title
          ("Compacting") already names the operation. */}
      <TugProgressIndicator
        variant="bar"
        size={8}
        state={settled ? "completed" : "running"}
        className="compaction-progress-sheet-bar"
        aria-label="Compacting"
      />
      {cancelable ? (
        <div className="tug-sheet-actions">
          {/* The sheet's live default: seeded (see useSeedKeyView above) and
              opted into `persistentDefaultRing` so it wears the filled +
              double-ring default treatment the whole time it is shown, and
              Return triggers it. Cancel is the only action a running
              compaction offers. */}
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
