/**
 * dev-load-previous — the transcript's "load previous" affordance + its
 * modal load sheet.
 *
 * Recency windowing loads only the most recent messages; when older
 * messages remain (`replayWindow.hasOlder`), a small bar appears at the
 * top of the transcript — but only once the user has scrolled up to the
 * oldest loaded message (visibility is a DOM `data-at-top` attribute the
 * transcript host toggles off `TugListView`'s top-edge callback, never
 * React state — [L06]). The bar reads "There are N earlier messages…"
 * and offers to page them in: a numeric step (capped to what remains)
 * and All.
 *
 * Activating an option:
 *   1. immediately presents a modal `TugSheet` ([recency P08]) so the
 *      pane goes `inert` + scrim for the whole load — the lockout means
 *      the prepend + scroll-hold land against a quiescent viewport;
 *   2. calls `store.loadPrevious(amount)`, which marks the next replay
 *      bracket as a prepend and sends the windowed older-range request.
 *
 * The existing transcript stays visible throughout (the blank-and-reveal
 * gate is suppressed for a load-previous); older turns prepend above the
 * view with held scroll ([L23]) and absolute numbering re-bases from the
 * new metadata. The sheet shows the same determinate "N of M" progress as
 * the initial restore sheet and dismisses when the load completes
 * (`loadingPrevious` clears). Cancel aborts the in-flight translate
 * (`store.cancelLoadPrevious()`), discarding the partial older batch and
 * leaving the prior window intact.
 *
 * Laws: [L02] `hasOlder` / counts / `loadingPrevious` via
 * `useSyncExternalStore`; [L06] pane disabled by sheet inert/scrim, bar
 * visibility via DOM attribute; [L13] motion belongs to
 * `TugProgressIndicator`; [L19] file pair + docstring + `data-slot`.
 *
 * Component-only exports keep this a clean React Fast Refresh boundary.
 *
 * @module components/tugways/cards/dev-load-previous
 */

import "./dev-load-previous.css";

import React from "react";

import { useTugSheet } from "../tug-sheet";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { type CodeSessionStore } from "@/lib/code-session-store";
import { formatReplayProgressValue } from "./dev-replay-progress";
// Shared reveal gate: a load that settles under this threshold never
// presents the modal (it pages in silently, held scroll), so a fast
// page-in doesn't flash a sheet. Same constant the restore sheet uses.
import { RESTORE_SHEET_GATE_MS } from "./dev-restore-sheet-gate";

/** Default numeric "load previous" step; capped to the messages that
 *  actually remain older (so the button never offers more than exists). */
const LOAD_PREVIOUS_STEP = 50;

export interface DevLoadPreviousHostProps {
  cardId: string;
  codeSessionStore: CodeSessionStore;
  /** Ref to the affordance bar — the transcript host toggles its
   *  `data-at-top` visibility from the list view's top-edge callback. */
  barRef: React.Ref<HTMLDivElement>;
}

export function DevLoadPreviousHost({
  cardId,
  codeSessionStore,
  barRef,
}: DevLoadPreviousHostProps): React.ReactElement {
  const { showSheet, renderSheet } = useTugSheet();
  const focusGroup = React.useId();
  // Pending sheet-reveal timer for the in-flight load (cleared on unmount).
  const sheetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (sheetTimerRef.current !== null) clearTimeout(sheetTimerRef.current);
    },
    [],
  );

  const earlierCount = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().replayWindow?.firstLoadedMessageIndex ?? 0,
  );
  const hasOlder = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().replayWindow?.hasOlder ?? false,
  );
  const loadingPrevious = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().loadingPrevious,
  );

  const startLoad = React.useCallback(
    (amount: number | "all") => {
      // Send the older-range request (sets `loadingPrevious` synchronously),
      // then arm the modal: present it only if the load is *still* in
      // flight past the reveal gate. A fast page-in (the common 50/100
      // case) settles first and pages in silently with held scroll — no
      // sheet flash. A slow load ("all" on a whale) presents the modal +
      // progress + Cancel.
      codeSessionStore.loadPrevious(amount);
      if (sheetTimerRef.current !== null) clearTimeout(sheetTimerRef.current);
      sheetTimerRef.current = setTimeout(() => {
        sheetTimerRef.current = null;
        if (!codeSessionStore.getSnapshot().loadingPrevious) return;
        void showSheet({
          title: "Loading earlier messages",
          icon: "History",
          hideHeaderRule: true,
          cascadeTargetId: cardId,
          content: (close) => (
            <DevLoadPreviousSheetContent
              codeSessionStore={codeSessionStore}
              close={close}
              onCancel={() => codeSessionStore.cancelLoadPrevious()}
            />
          ),
        });
      }, RESTORE_SHEET_GATE_MS);
    },
    [cardId, codeSessionStore, showSheet],
  );

  // The numeric step is capped to what's actually older; when that is the
  // whole remainder, the single button loads everything and "All" is
  // redundant.
  const step = Math.min(LOAD_PREVIOUS_STEP, earlierCount);
  const showAll = earlierCount > step;

  return (
    <>
      {hasOlder && !loadingPrevious ? (
        <div
          ref={barRef}
          className="dev-load-previous-bar"
          data-slot="dev-load-previous"
          data-at-top="false"
        >
          <span className="dev-load-previous-label">
            {`There ${earlierCount === 1 ? "is" : "are"} ${earlierCount} earlier message${
              earlierCount === 1 ? "" : "s"
            } in this session.`}
          </span>
          <span className="dev-load-previous-actions-label">Load:</span>
          <TugPushButton
            size="sm"
            emphasis="outlined"
            role="action"
            focusGroup={focusGroup}
            focusOrder={0}
            onClick={() => startLoad(step)}
          >
            {step}
          </TugPushButton>
          {showAll ? (
            <TugPushButton
              size="sm"
              emphasis="outlined"
              role="action"
              focusGroup={focusGroup}
              focusOrder={1}
              onClick={() => startLoad("all")}
            >
              All
            </TugPushButton>
          ) : null}
        </div>
      ) : null}
      {renderSheet()}
    </>
  );
}

interface DevLoadPreviousSheetContentProps {
  codeSessionStore: CodeSessionStore;
  /** Dismiss the host sheet (from `useTugSheet`'s content callback). */
  close: () => void;
  /** Abort the in-flight load (keeps the prior window). */
  onCancel: () => void;
}

function DevLoadPreviousSheetContent({
  codeSessionStore,
  close,
  onCancel,
}: DevLoadPreviousSheetContentProps): React.ReactElement {
  const loadingPrevious = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().loadingPrevious,
  );
  const loaded = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().loadingPreviousLoaded,
  );
  const target = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().loadingPreviousTarget,
  );
  const cancelFocusGroup = React.useId();

  // The load owns the sheet's lifetime: once the bracket completes (commit
  // or abort), `loadingPrevious` clears and we dismiss. [L02]
  React.useEffect(() => {
    if (!loadingPrevious) close();
  }, [loadingPrevious, close]);

  // Determinate "N of M messages" — the same progress form as the initial
  // restore sheet. On the settled edge complete the bar to full so it
  // never reads as a partial fill escaping our control.
  const value = loadingPrevious ? Math.min(loaded, target) : target;
  const showValue = target > 1;

  return (
    <div className="dev-load-previous-sheet" data-slot="dev-load-previous-sheet">
      <TugProgressIndicator
        variant="bar"
        size={8}
        role="action"
        state={loadingPrevious ? "running" : "completed"}
        label="Loading earlier messages…"
        glyphPosition="right"
        value={value}
        max={target > 0 ? target : 1}
        {...(showValue
          ? { showValue: true, formatValue: formatReplayProgressValue }
          : {})}
        className="dev-load-previous-sheet-bar"
        aria-label="Loading earlier messages"
      />
      <div className="tug-sheet-actions">
        <TugPushButton
          emphasis="outlined"
          role="action"
          onClick={onCancel}
          data-testid="dev-load-previous-cancel"
          focusGroup={cancelFocusGroup}
          focusOrder={0}
        >
          Cancel
        </TugPushButton>
      </div>
    </div>
  );
}
