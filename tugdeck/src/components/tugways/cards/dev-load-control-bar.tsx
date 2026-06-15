/**
 * dev-load-control-bar — the dev transcript's Z0 load surface.
 *
 * One `TugControlBar` ([P09]–[P11], #step-5-5) that supersedes the centered
 * restore sheet, the load-previous sheet, and the load-previous bar. It
 * carries, over its life, three contents driven by a small pure state
 * machine ({@link deriveControlBarState}):
 *
 *   - **Loading** — a cold restore *or* a load-previous → a determinate
 *     progress bar (the card is **modal** while the load is actually in
 *     flight). The progress lingers, at full, for {@link PROGRESS_DWELL_MS}
 *     past the final tick so the bar visibly reaches the end before it moves
 *     on (`loadingDisplay`).
 *   - **Prompt** — older messages remain → "There are N earlier messages…
 *     Load: [50]"; *summoned* when a load finishes or the user reaches the
 *     top, and it **stays in view** until dismissed by a scroll or a submit.
 *     Non-modal.
 *   - **Hidden** — otherwise.
 *
 * The progress dwell and the prompt persistence are the same shape for a
 * cold restore, a load-previous, and a scroll-to-top — one consistent
 * lifecycle. The tail's end and the prompt's summon are committed in one
 * batch so the loading→prompt swap never flashes a gap. Content + visibility
 * are store-/state-derived ([L02]); the bar's *visibility* is mirrored to a
 * DOM attribute ([L06]). The host feeds scroll edges via the imperative
 * handle; it reads load completion + submit from the store.
 *
 * This version is deliberately trimmed: paging is a single fixed step (50) —
 * no "All", and no Cancel (a 50-row page, and the restore, are quick enough
 * that there's nothing slow to abort).
 *
 * @module components/tugways/cards/dev-load-control-bar
 */

import "./dev-load-control-bar.css";

import React from "react";

import { TugControlBar } from "@/components/tugways/tug-control-bar";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { type CodeSessionStore } from "@/lib/code-session-store";
import { deriveColdRestoreActive } from "./dev-card-restore-gate";
import {
  controlBarVisible,
  deriveControlBarState,
  type ControlBarLoadKind,
} from "./dev-load-control-bar-state";

/** Default numeric "load previous" step, capped to the messages that remain. */
const LOAD_PREVIOUS_STEP = 50;

/** How long the progress bar lingers, at full, after the last progress tick
 *  before the bar transitions to the "load more" prompt (or hides). Anchored
 *  on the final update so the determinate bar visibly reaches the end. */
const PROGRESS_DWELL_MS = 1000;

export interface DevLoadControlBarHandle {
  /** The user reached / left the top of the transcript. */
  setAtTop(atTop: boolean): void;
  /** Following-bottom changed; `true` ⇒ at the live bottom. */
  setAtBottom(atBottom: boolean): void;
}

export interface DevLoadControlBarProps {
  codeSessionStore: CodeSessionStore;
  /** The scrollable transcript region the bar inerts + scrims when modal. */
  regionEl: HTMLElement | null;
}

export const DevLoadControlBar = React.forwardRef<
  DevLoadControlBarHandle,
  DevLoadControlBarProps
>(function DevLoadControlBar({ codeSessionStore, regionEl }, ref) {
  const barRef = React.useRef<HTMLDivElement | null>(null);

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
  // The live progress numerator — committed messages for a cold restore,
  // the paged-in count for a load-previous. Its changes anchor the dwell
  // tail (so the bar lingers a beat past the final tick).
  const messagesLoaded = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => {
      let n = 0;
      for (const turn of codeSessionStore.getSnapshot().transcript) {
        n += turn.messages.length;
      }
      return n;
    },
  );
  const loadingPreviousLoaded = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().loadingPreviousLoaded,
  );

  const loadActive = loadingPrevious || coldRestore;
  const loadKind: ControlBarLoadKind | null = loadingPrevious
    ? "previous"
    : coldRestore
      ? "restore"
      : null;
  // The load kind outlives `loadActive` through the dwell tail; remember it
  // so the lingering progress keeps the right label/cancel routing.
  const loadKindRef = React.useRef<ControlBarLoadKind>("restore");
  if (loadKind !== null) loadKindRef.current = loadKind;
  const progressNum = loadingPrevious ? loadingPreviousLoaded : messagesLoaded;

  // Progress display = a load in flight, OR the dwell tail that holds the
  // bar at full for `PROGRESS_DWELL_MS` past the final progress tick (so the
  // determinate bar always reaches the end before the bar moves on). `tail`
  // carries only the post-load lingering; OR-ing `loadActive` in the render
  // means the bar appears the instant a load starts (no effect-tick lag).
  // The tail timer is keyed on `progressNum`, so every tick refreshes it.
  const [tail, setTail] = React.useState(false);
  // `promptShown`: the "load more" prompt has been *summoned* (a load's dwell
  // tail ended, or the user reached the top) and not yet dismissed (scroll /
  // submit). Same lifecycle for restore / load-previous / scroll-to-top.
  const [promptShown, setPromptShown] = React.useState(false);

  React.useEffect(() => {
    if (loadActive) {
      setTail(true);
      return;
    }
    if (!tail) return;
    const timer = setTimeout(() => {
      // End the tail and summon the prompt in the SAME batch so the
      // loading→prompt swap never passes through a frame where neither shows
      // (the gap): otherwise `loadingDisplay` flips false this render while
      // `promptShown` is still set by a later effect, so the derive yields
      // `hidden` for one frame. The derive gates the prompt on `hasOlder`.
      setTail(false);
      setPromptShown(true);
    }, PROGRESS_DWELL_MS);
    return () => clearTimeout(timer);
  }, [loadActive, progressNum, tail]);
  const loadingDisplay = loadActive || tail;

  // Submit dismisses the prompt.
  React.useEffect(() => {
    if (phase === "submitting") setPromptShown(false);
  }, [phase]);

  // Scroll edges (imperative, fed by the transcript): reaching the top
  // summons the prompt; leaving the top, or scrolling up off the bottom,
  // dismisses it. Dismiss only on *leaving* the bottom (`following` false) —
  // a programmatic re-pin to the bottom right after a restore must not
  // dismiss the prompt the dwell just summoned.
  React.useImperativeHandle(
    ref,
    (): DevLoadControlBarHandle => ({
      setAtTop(atTop) {
        setPromptShown(atTop);
      },
      setAtBottom(following) {
        if (!following) setPromptShown(false);
      },
    }),
    [],
  );

  // Resolve the visual state and mirror visibility to the band's DOM
  // attribute ([L06]). Re-rendering this (small, transcript-sibling) host on
  // a scroll-edge crossing is cheap and does not touch the transcript.
  const state = deriveControlBarState({
    loadingDisplay,
    hasOlder,
    earlierCount,
    promptShown,
  });
  const visible = controlBarVisible(state);
  React.useLayoutEffect(() => {
    const bar = barRef.current;
    if (bar !== null) bar.dataset.visible = String(visible);
  }, [visible]);

  const onLoad = React.useCallback(
    (amount: number) => {
      codeSessionStore.loadPrevious(amount);
    },
    [codeSessionStore],
  );

  const content: React.ReactNode =
    state.kind === "loading" ? (
      <ControlBarLoading
        codeSessionStore={codeSessionStore}
        loadKind={loadKindRef.current}
      />
    ) : state.kind === "prompt" ? (
      <ControlBarPrompt earlierCount={earlierCount} onLoad={onLoad} />
    ) : null;

  return (
    <TugControlBar ref={barRef} modal={loadActive} regionEl={regionEl}>
      {content}
    </TugControlBar>
  );
});

/** Loading state — determinate progress, no Cancel. Both loads count
 *  **messages**: a cold restore loads the most recent recency window out of
 *  the session total; a load-previous pages in a fixed step (50). The bar
 *  fills toward the window and is driven to full once the load finishes, so it
 *  always reaches the end. (Cancel was removed — paged loads are a quick fixed
 *  50, so there's nothing slow to abort; the restore likewise just runs.) */
function ControlBarLoading({
  codeSessionStore,
  loadKind,
}: {
  codeSessionStore: CodeSessionStore;
  loadKind: ControlBarLoadKind;
}): React.ReactElement {
  // Messages committed so far across the live transcript — the cold-restore
  // progress numerator (the window is sized in messages, not turns).
  const messagesLoaded = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => {
      let n = 0;
      for (const turn of codeSessionStore.getSnapshot().transcript) {
        n += turn.messages.length;
      }
      return n;
    },
  );
  // Whether the cold restore is still streaming (vs. finished — the bar is
  // held through its dwell and must show the completed pose then).
  const restoreActive = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => {
      const s = codeSessionStore.getSnapshot();
      return (
        !s.loadingPrevious &&
        (deriveColdRestoreActive(s) || s.phase === "replaying")
      );
    },
  );
  // The window this resume requested — the restore progress denominator
  // (default N, or deeper for a faithful restore to an above-window anchor).
  const restoreWindow = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().restoreWindowMessages,
  );
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

  // Is the represented load still in flight? When false we're in the dwell
  // tail: the bar holds at full.
  const active = loadKind === "restore" ? restoreActive : loadingPrevious;

  // `loadingPreviousTarget` resets to 0 once the load completes; remember the
  // last real target so the tail keeps showing "N of N messages" instead of
  // dropping the readout (which would relayout the row).
  const lastTargetRef = React.useRef(0);
  if (loadingPrevious && target > 0) lastTargetRef.current = target;

  let label: string;
  let value: number;
  let max: number;
  let formatValue: (value: number, max: number) => string;
  if (loadKind === "restore") {
    // One stable state: the bar reports progress against the load window
    // only — the session-wide total lives in the picker (as JSONL size), not
    // here, so there's no late-arriving total to make the label flip. The
    // window is the resume request's size: the default N, or deeper for a
    // faithful restore to a saved anchor above it ([recency #step-6]).
    label = `Restoring the most recent ${restoreWindow} messages…`;
    max = restoreWindow;
    value = active ? Math.min(messagesLoaded, max) : max;
    formatValue = formatWindowValue;
  } else {
    const effTarget = active ? target : lastTargetRef.current;
    label = "Loading earlier messages…";
    max = effTarget > 0 ? effTarget : 1;
    value = active ? Math.min(loaded, effTarget) : max;
    formatValue = formatLoadPreviousValue;
  }
  const showValue = max > 1;

  return (
    <div className="dev-load-control-bar-loading">
      <TugProgressIndicator
        variant="bar"
        size={8}
        role="action"
        state="running"
        label={label}
        labelEmphasis="proposal"
        glyphPosition="right"
        value={value}
        max={max}
        {...(showValue ? { showValue: true, formatValue } : {})}
        className="dev-load-control-bar-bar"
        aria-label={label}
      />
    </div>
  );
}

/** `formatValue` for the cold-restore window readout — "18 of 50". */
function formatWindowValue(value: number, max: number): string {
  return `${value.toLocaleString()} of ${max.toLocaleString()}`;
}

/** `formatValue` for the load-previous determinate readout. */
function formatLoadPreviousValue(value: number, max: number): string {
  return `${value.toLocaleString()} of ${max.toLocaleString()} messages`;
}

/** Prompt state — "There are N earlier messages…" + a single fixed-step
 *  load action. ("All" was removed — paging is a quick fixed 50 at a time; a
 *  whole-session load is intentionally not offered in this version.) */
function ControlBarPrompt({
  earlierCount,
  onLoad,
}: {
  earlierCount: number;
  onLoad: (amount: number) => void;
}): React.ReactElement {
  const focusGroup = React.useId();
  const step = Math.min(LOAD_PREVIOUS_STEP, earlierCount);
  return (
    <div className="dev-load-control-bar-prompt">
      <TugLabel emphasis="proposal" className="dev-load-control-bar-label">
        {`There ${earlierCount === 1 ? "is" : "are"} ${earlierCount} earlier message${
          earlierCount === 1 ? "" : "s"
        } in this session.`}
      </TugLabel>
      <TugLabel emphasis="proposal" className="dev-load-control-bar-actions-label">
        Load:
      </TugLabel>
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
    </div>
  );
}
