/**
 * dev-load-control-bar — the dev transcript's Z0 load surface.
 *
 * One `TugControlBar` ([P09]–[P11], #step-5-5) that supersedes the centered
 * restore sheet, the load-previous sheet, and the load-previous bar. It
 * carries, over its life, three contents driven by a small pure state
 * machine ({@link deriveControlBarState}):
 *
 *   - **Loading** — a cold restore *or* a load-previous in flight → a
 *     determinate progress bar + Cancel; the card is **modal** (the
 *     transcript region is inert + scrimmed) for the duration.
 *   - **Prompt** — older messages remain → "There are N earlier messages…
 *     Load: [N] [All]"; shown when the user is at the top, or lingering
 *     after a load-previous (until scroll-to-bottom or submit). Non-modal.
 *   - **Hidden** — otherwise.
 *
 * Modality + progress content are React (store-derived, [L02]); the bar's
 * *visibility* is a DOM attribute toggled imperatively from store + scroll
 * signals ([L06]) so a scroll-edge crossing never re-renders the
 * transcript. The host feeds scroll edges via the imperative handle; the
 * component detects load-previous completion + submit from the store.
 *
 * Cancel routes by which load is active: a cold restore stops + closes the
 * card (the retired restore sheet's meaning); a load-previous aborts and
 * keeps the loaded window.
 *
 * @module components/tugways/cards/dev-load-control-bar
 */

import "./dev-load-control-bar.css";

import React from "react";

import { TugControlBar } from "@/components/tugways/tug-control-bar";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useResponderChain } from "../responder-chain-provider";
import { TUG_ACTIONS } from "../action-vocabulary";
import { type CodeSessionStore } from "@/lib/code-session-store";
import { deriveColdRestoreActive } from "./dev-card-restore-gate";
import { cancelDevRestore, getResumeDisplayMetadata } from "@/lib/dev-session-restore";
import {
  deriveReplayProgress,
  formatReplayProgressValue,
} from "./dev-replay-progress";
import {
  controlBarVisible,
  deriveControlBarState,
  reduceLingering,
  type ControlBarLoadKind,
} from "./dev-load-control-bar-state";

/** Default numeric "load previous" step, capped to the messages that remain. */
const LOAD_PREVIOUS_STEP = 50;

/** Read the live load-shape from the store snapshot (shared by the
 *  visibility recompute and the content render). A cold restore is the
 *  replaying/cold-restore phase *minus* a load-previous (which is also
 *  `replaying` but owns the prompt/lingering path). */
function readLoadShape(store: CodeSessionStore): {
  loadActive: boolean;
  loadKind: ControlBarLoadKind | null;
  hasOlder: boolean;
  earlierCount: number;
} {
  const snap = store.getSnapshot();
  const loadingPrevious = snap.loadingPrevious;
  const coldRestore =
    !loadingPrevious &&
    (deriveColdRestoreActive(snap) || snap.phase === "replaying");
  const loadKind: ControlBarLoadKind | null = loadingPrevious
    ? "previous"
    : coldRestore
      ? "restore"
      : null;
  return {
    loadActive: loadingPrevious || coldRestore,
    loadKind,
    hasOlder: snap.replayWindow?.hasOlder ?? false,
    earlierCount: snap.replayWindow?.firstLoadedMessageIndex ?? 0,
  };
}

export interface DevLoadControlBarHandle {
  /** The user reached / left the top of the transcript. */
  setAtTop(atTop: boolean): void;
  /** Following-bottom changed; `true` ⇒ at the live bottom. */
  setAtBottom(atBottom: boolean): void;
}

export interface DevLoadControlBarProps {
  cardId: string;
  codeSessionStore: CodeSessionStore;
  /** The scrollable transcript region the bar inerts + scrims when modal. */
  regionEl: HTMLElement | null;
}

export const DevLoadControlBar = React.forwardRef<
  DevLoadControlBarHandle,
  DevLoadControlBarProps
>(function DevLoadControlBar({ cardId, codeSessionStore, regionEl }, ref) {
  const barRef = React.useRef<HTMLDivElement | null>(null);
  const atTopRef = React.useRef(false);
  const atBottomRef = React.useRef(false);
  const lingeringRef = React.useRef(false);

  const manager = useResponderChain();
  const senderId = React.useId();

  // Structural reads (content + modal). Primitives so `useSyncExternalStore`
  // stays `Object.is`-stable across snapshot rebuilds.
  const loadingPrevious = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().loadingPrevious,
  );
  const coldRestore = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => {
      const s = codeSessionStore.getSnapshot();
      return (
        !s.loadingPrevious &&
        (deriveColdRestoreActive(s) || s.phase === "replaying")
      );
    },
  );
  const hasOlder = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().replayWindow?.hasOlder ?? false,
  );
  const earlierCount = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () =>
      codeSessionStore.getSnapshot().replayWindow?.firstLoadedMessageIndex ?? 0,
  );
  const phase = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().phase,
  );

  const loadActive = loadingPrevious || coldRestore;
  const loadKind: ControlBarLoadKind | null = loadingPrevious
    ? "previous"
    : coldRestore
      ? "restore"
      : null;

  // Recompute the bar's DOM visibility from the live snapshot + the
  // imperative scroll/lingering refs ([L06] — no React render on scroll).
  const updateVisibility = React.useCallback(() => {
    const bar = barRef.current;
    if (bar === null) return;
    const shape = readLoadShape(codeSessionStore);
    const state = deriveControlBarState({
      ...shape,
      atTop: atTopRef.current,
      lingering: lingeringRef.current,
    });
    bar.dataset.visible = String(controlBarVisible(state));
  }, [codeSessionStore]);

  // Store-driven recompute: the structural reads above re-render the
  // component on every snapshot change, so a layout effect keyed on them
  // keeps the DOM visibility in sync without a scroll signal.
  React.useLayoutEffect(() => {
    updateVisibility();
  }, [loadActive, hasOlder, earlierCount, loadKind, updateVisibility]);

  // Lingering: a finished load-previous starts it (held scroll left the
  // user below the top, but they may want to page again); submit clears it.
  const prevLoadingPreviousRef = React.useRef(loadingPrevious);
  React.useEffect(() => {
    if (prevLoadingPreviousRef.current && !loadingPrevious) {
      lingeringRef.current = reduceLingering(lingeringRef.current, {
        type: "load-previous-complete",
      });
      updateVisibility();
    }
    prevLoadingPreviousRef.current = loadingPrevious;
  }, [loadingPrevious, updateVisibility]);

  React.useEffect(() => {
    if (phase === "submitting") {
      lingeringRef.current = reduceLingering(lingeringRef.current, {
        type: "submit",
      });
      updateVisibility();
    }
  }, [phase, updateVisibility]);

  React.useImperativeHandle(
    ref,
    (): DevLoadControlBarHandle => ({
      setAtTop(atTop) {
        atTopRef.current = atTop;
        updateVisibility();
      },
      setAtBottom(atBottom) {
        atBottomRef.current = atBottom;
        if (atBottom) {
          lingeringRef.current = reduceLingering(lingeringRef.current, {
            type: "scrolled-to-bottom",
          });
        }
        updateVisibility();
      },
    }),
    [updateVisibility],
  );

  // Cancel routing by active load.
  const onCancel = React.useCallback(() => {
    if (loadingPrevious) {
      codeSessionStore.cancelLoadPrevious();
      return;
    }
    // Cold restore: stop the restore + close the card (the retired restore
    // sheet's meaning).
    cancelDevRestore(cardId);
    manager?.sendToTarget(cardId, {
      action: TUG_ACTIONS.CLOSE_TAB,
      value: cardId,
      sender: senderId,
      phase: "discrete",
    });
  }, [loadingPrevious, codeSessionStore, cardId, manager, senderId]);

  const onLoad = React.useCallback(
    (amount: number | "all") => {
      codeSessionStore.loadPrevious(amount);
    },
    [codeSessionStore],
  );

  const content: React.ReactNode = loadActive ? (
    <ControlBarLoading
      cardId={cardId}
      codeSessionStore={codeSessionStore}
      loadKind={loadKind ?? "previous"}
      onCancel={onCancel}
    />
  ) : hasOlder ? (
    <ControlBarPrompt earlierCount={earlierCount} onLoad={onLoad} />
  ) : null;

  return (
    <TugControlBar ref={barRef} modal={loadActive} regionEl={regionEl}>
      {content}
    </TugControlBar>
  );
});

/** Loading state — determinate progress + Cancel. The progress source is
 *  the cold-restore "N of M turns" view, or the load-previous message
 *  counters. */
function ControlBarLoading({
  cardId,
  codeSessionStore,
  loadKind,
  onCancel,
}: {
  cardId: string;
  codeSessionStore: CodeSessionStore;
  loadKind: ControlBarLoadKind;
  onCancel: () => void;
}): React.ReactElement {
  const cancelFocusGroup = React.useId();

  const turnsSoFar = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().transcript.length,
  );
  const loaded = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().loadingPreviousLoaded,
  );
  const target = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().loadingPreviousTarget,
  );

  let label: string;
  let value: number | null;
  let max: number | null;
  if (loadKind === "restore") {
    const view = deriveReplayProgress(turnsSoFar, getResumeDisplayMetadata(cardId));
    label = view.label;
    value = view.value;
    max = view.max;
  } else {
    label = "Loading earlier messages…";
    value = Math.min(loaded, target);
    max = target > 0 ? target : 1;
  }
  const showValue = max !== null && max > 1;

  return (
    <div className="dev-load-control-bar-loading">
      <TugProgressIndicator
        variant="bar"
        size={8}
        role="action"
        state="running"
        label={label}
        glyphPosition="right"
        {...(value !== null && max !== null
          ? {
              value,
              max,
              ...(showValue
                ? {
                    showValue: true,
                    formatValue:
                      loadKind === "restore"
                        ? formatReplayProgressValue
                        : formatLoadPreviousValue,
                  }
                : {}),
            }
          : {})}
        className="dev-load-control-bar-bar"
        aria-label={label}
      />
      <TugPushButton
        size="sm"
        emphasis="outlined"
        role="action"
        onClick={onCancel}
        data-testid="dev-load-control-bar-cancel"
        focusGroup={cancelFocusGroup}
        focusOrder={0}
      >
        Cancel
      </TugPushButton>
    </div>
  );
}

/** `formatValue` for the load-previous determinate readout. */
function formatLoadPreviousValue(value: number, max: number): string {
  return `${value.toLocaleString()} of ${max.toLocaleString()} messages`;
}

/** Prompt state — "There are N earlier messages…" + the load actions. */
function ControlBarPrompt({
  earlierCount,
  onLoad,
}: {
  earlierCount: number;
  onLoad: (amount: number | "all") => void;
}): React.ReactElement {
  const focusGroup = React.useId();
  const step = Math.min(LOAD_PREVIOUS_STEP, earlierCount);
  const showAll = earlierCount > step;
  return (
    <div className="dev-load-control-bar-prompt">
      <span className="dev-load-control-bar-label">
        {`There ${earlierCount === 1 ? "is" : "are"} ${earlierCount} earlier message${
          earlierCount === 1 ? "" : "s"
        } in this session.`}
      </span>
      <span className="dev-load-control-bar-actions-label">Load:</span>
      <TugPushButton
        size="sm"
        emphasis="outlined"
        role="action"
        focusGroup={focusGroup}
        focusOrder={0}
        onClick={() => onLoad(step)}
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
          onClick={() => onLoad("all")}
        >
          All
        </TugPushButton>
      ) : null}
    </div>
  );
}
