/**
 * `dev-restore-sheet.tsx` — the pane-modal restore-progress surface.
 *
 * Replaces the `DevReplayProgress` strip (redux [P08]). A cold restore that
 * runs past the reveal gate ({@link RESTORE_SHEET_GATE_MS} = 0.5 s) presents
 * a card-covering `TugSheet` — a `TugProgressIndicator` bar + Cancel — over
 * the pane's built-in `inert` + scrim; a restore that finishes under the gate
 * presents nothing and the reconstructed content reveals once (redux [P09]).
 * Cancel stops the load (`cancelDevRestore`) and closes the card
 * (`TUG_ACTIONS.CLOSE_TAB`).
 *
 * Two parts:
 *  - {@link DevRestoreSheetHost} — mounted where the strip was (inside the
 *    transcript host, which is alive across the whole replay window). It
 *    observes the cold-restore window, arms the reveal-gate timer from the
 *    *persisted* restore-start stamp (`getRestoreStartedAt`, which survives
 *    the card's services-null remount — the same reason the strip read it),
 *    presents the sheet once per episode, and renders the sheet portal. The
 *    `TugSheet` is pane-scoped via its stacking context, so presenting it
 *    from inside the transcript still covers the whole pane.
 *  - {@link DevRestoreSheetContent} — the sheet body. Reads the same
 *    flush-driven progress signals the strip read and reuses the strip's pure
 *    view helpers; self-dismisses when the restore window closes
 *    (`active → false`), mirroring the compaction sheet's "the run owns the
 *    sheet's lifetime" contract.
 *
 * Send-gating during restore (redux [Q03]) is NOT this surface's job: the
 * prompt entry's `replayHoldActive` deactivation in `dev-card.tsx` is
 * store-derived and already covers the *whole* `replaying` window — including
 * the sub-0.5 s case where no sheet mounts — so it is the thin store-level
 * guard [Q03] permits. The sheet's `inert` is additive for the visible-modal
 * case only.
 *
 * Laws:
 *  - [L02] every read enters through `useSyncExternalStore`.
 *  - [L06] the card is disabled by the sheet's `inert` + scrim (DOM), never
 *    by React appearance state.
 *  - [L13] motion belongs to `TugProgressIndicator`.
 *  - [L19] file pair (`.tsx` + `.css`), docstring, `data-slot`.
 *  - [L20] the bar and button keep their own tokens.
 *
 * @module components/tugways/cards/dev-restore-sheet
 */

import "./dev-restore-sheet.css";

import React from "react";

import { useTugSheet } from "../tug-sheet";
import { useResponderChain } from "../responder-chain-provider";
import { TUG_ACTIONS } from "../action-vocabulary";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { type CodeSessionStore } from "@/lib/code-session-store";
import { deriveColdRestoreActive } from "./dev-card-restore-gate";
import {
  cancelDevRestore,
  getResumeDisplayMetadata,
  getRestoreStartedAt,
} from "@/lib/dev-session-restore";
import {
  completeReplayProgress,
  deriveReplayProgress,
  formatReplayProgressValue,
} from "./dev-replay-progress";
// The reveal-gate constant + timer math live in a non-component module so
// this file is a clean React Fast Refresh boundary (component-only exports).
// Mixing value exports here breaks Fast Refresh and an edit would full-reload
// the app — re-resuming every session. See dev-restore-sheet-gate.ts.
import {
  RESTORE_SHEET_GATE_MS,
  restoreSheetRevealDelayMs,
} from "./dev-restore-sheet-gate";

/** The cold-restore / replay window predicate — the strip's activity rule. */
function isRestoreActive(store: CodeSessionStore): boolean {
  const s = store.getSnapshot();
  return deriveColdRestoreActive(s) || s.phase === "replaying";
}

export interface DevRestoreSheetHostProps {
  cardId: string;
  codeSessionStore: CodeSessionStore;
}

export function DevRestoreSheetHost({
  cardId,
  codeSessionStore,
}: DevRestoreSheetHostProps): React.ReactElement {
  const { showSheet, renderSheet } = useTugSheet();
  const manager = useResponderChain();
  const senderId = React.useId();

  const active = React.useSyncExternalStore(codeSessionStore.subscribe, () =>
    isRestoreActive(codeSessionStore),
  );

  // Cancel = stop the load AND close the card. `cancelDevRestore` clears the
  // restore expectation; `CLOSE_TAB` removes the card directly (the pane's
  // close-tab handler, not the `confirmClose` CLOSE policy). Same cascade
  // dispatch the picker uses for its cancel ([D02] `sendToTarget`).
  const onCancel = React.useCallback(() => {
    cancelDevRestore(cardId);
    manager?.sendToTarget(cardId, {
      action: TUG_ACTIONS.CLOSE_TAB,
      value: cardId,
      sender: senderId,
      phase: "discrete",
    });
  }, [cardId, manager, senderId]);

  // Present once per restore episode, gated past the reveal threshold
  // measured from the persisted restore-start stamp. A restore that settles
  // under the gate never presents (the cleanup clears the armed timer). The
  // promise resolves on dismissal, re-arming `presentedRef` so a later
  // restore episode (e.g. a reconnect catch-up) presents again.
  const presentedRef = React.useRef(false);
  React.useEffect(() => {
    if (!active || presentedRef.current) return;
    const present = (): void => {
      if (presentedRef.current) return;
      presentedRef.current = true;
      void showSheet({
        title: "Restoring session",
        icon: "History",
        hideHeaderRule: true,
        cascadeTargetId: cardId,
        content: (close) => (
          <DevRestoreSheetContent
            cardId={cardId}
            codeSessionStore={codeSessionStore}
            close={close}
            onCancel={onCancel}
          />
        ),
      }).then(() => {
        presentedRef.current = false;
      });
    };
    const startedAt = getRestoreStartedAt(cardId);
    const elapsed = startedAt === undefined ? 0 : Date.now() - startedAt;
    const remaining = restoreSheetRevealDelayMs(elapsed, RESTORE_SHEET_GATE_MS);
    if (remaining <= 0) {
      present();
      return;
    }
    const handle = window.setTimeout(present, remaining);
    return () => window.clearTimeout(handle);
  }, [active, cardId, codeSessionStore, showSheet, onCancel]);

  return <>{renderSheet()}</>;
}

interface DevRestoreSheetContentProps {
  cardId: string;
  codeSessionStore: CodeSessionStore;
  /** Dismiss the host sheet (from `useTugSheet`'s content callback). */
  close: () => void;
  /** Stop the load and close the card. */
  onCancel: () => void;
}

function DevRestoreSheetContent({
  cardId,
  codeSessionStore,
  close,
  onCancel,
}: DevRestoreSheetContentProps): React.ReactElement {
  const active = React.useSyncExternalStore(codeSessionStore.subscribe, () =>
    isRestoreActive(codeSessionStore),
  );
  const turnsSoFar = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().transcript.length,
  );

  // The restore owns the sheet's lifetime: once the window closes the
  // reconstructed content is ready, so dismiss. [L02]
  React.useEffect(() => {
    if (!active) close();
  }, [active, close]);

  const cancelFocusGroup = React.useId();

  // While active, the live "N of M turns" view; on the settled edge (the one
  // paint before dismissal) the bar completes to full so it never reads as a
  // partial fill escaping our control.
  const liveView = deriveReplayProgress(
    turnsSoFar,
    getResumeDisplayMetadata(cardId),
  );
  const view = active ? liveView : completeReplayProgress(liveView);
  const showValue = view.max !== null && view.max > 1;

  return (
    <div className="dev-restore-sheet" data-slot="dev-restore-sheet">
      <TugProgressIndicator
        variant="bar"
        size={8}
        role="action"
        state={active ? "running" : "completed"}
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
        className="dev-restore-sheet-bar"
        aria-label={view.label}
      />
      <div className="tug-sheet-actions">
        <TugPushButton
          emphasis="outlined"
          role="action"
          onClick={onCancel}
          data-testid="dev-restore-cancel"
          focusGroup={cancelFocusGroup}
          focusOrder={0}
        >
          Cancel
        </TugPushButton>
      </div>
    </div>
  );
}
