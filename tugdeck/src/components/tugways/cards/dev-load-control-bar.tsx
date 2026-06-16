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
 * lifecycle.
 *
 * **Zone discipline ([L24]).** The bar's *mode* (loading / prompt / hidden)
 * and *visibility* are pure appearance — their only consumer is the renderer
 * — so they live in the DOM, never React state ([L06]). The host holds the
 * dwell + prompt-summon flags in refs, observes the store *directly* in a
 * layout effect ([L22]), and writes the resolved mode onto the band's
 * `data-visible` / `data-mode` attributes; a scroll-edge crossing or a dwell
 * tick therefore never re-renders. The two content slots are always mounted
 * and self-subscribe for their data ([L02]); the dev CSS reveals one per
 * `data-mode`. The load-in-flight flag (`modal`) is session *data*, so it
 * alone enters React via `useSyncExternalStore` to drive the region
 * inert + scrim.
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
import {
  type CodeSessionStore,
  type CodeSessionSnapshot,
} from "@/lib/code-session-store";
import { deriveColdRestoreActive } from "./dev-card-restore-gate";
import {
  controlBarVisible,
  deriveControlBarState,
  type ControlBarLoadKind,
} from "./dev-load-control-bar-state";

/** Default numeric "load previous" step, capped to the messages that remain. */
const LOAD_PREVIOUS_STEP = 50;

/** How long the progress bar lingers, at full, after a load lands before the
 *  bar transitions to the "load more" prompt (or hides) — so the determinate
 *  bar visibly reaches the end. */
const PROGRESS_DWELL_MS = 1000;

/** A load is in flight: a load-previous, or a cold restore. Pure read over the
 *  store snapshot. The restore arm is `deriveColdRestoreActive` alone — that
 *  predicate already gates the `replaying` phase on `sessionMode === "resume"`,
 *  so a fresh *new* session's brief JSONL-missing replaying round-trip never
 *  raises this surface. (A bare `phase === "replaying"` clause here would
 *  un-gate it and flash the bar on every New session.) */
function readLoadActive(snap: CodeSessionSnapshot): boolean {
  return snap.loadingPrevious || deriveColdRestoreActive(snap);
}

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

  // Appearance refs ([L06]): the post-load dwell and the "load more" summon
  // live here, never React state — so a dwell tick or a scroll-edge crossing
  // mutates the DOM without a re-render.
  const tailActiveRef = React.useRef(false); // within the post-load dwell
  const promptShownRef = React.useRef(false); // prompt summoned, not dismissed
  const tailTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLoadActiveRef = React.useRef(false);

  // `loadActive` is session DATA (the reducer/banner read it), so it alone
  // enters React via `useSyncExternalStore` ([L02]) — it drives the `modal`
  // prop (region inert + scrim while a load is in flight). It changes only
  // when a load starts/ends (rare); the re-render is cheap and never reaches
  // the transcript (a sibling).
  const loadActive = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => readLoadActive(codeSessionStore.getSnapshot()),
  );

  // Resolve the bar's visual state from the live snapshot + the appearance
  // refs and mirror it onto the band's DOM attributes ([L06]/[L22]): the
  // generic `data-visible` (TugControlBar's show/hide) and `data-mode` (which
  // content slot the dev CSS reveals). Never React state.
  const updateBar = React.useCallback(() => {
    const bar = barRef.current;
    if (bar === null) return;
    const snap = codeSessionStore.getSnapshot();
    const state = deriveControlBarState({
      loadingDisplay: readLoadActive(snap) || tailActiveRef.current,
      hasOlder: snap.replayWindow?.hasOlder ?? false,
      earlierCount: snap.replayWindow?.firstLoadedMessageIndex ?? 0,
      promptShown: promptShownRef.current,
    });
    bar.dataset.visible = String(controlBarVisible(state));
    bar.dataset.mode = state.kind;
  }, [codeSessionStore]);

  // Observe the store directly ([L22]) — the bar's mode is a DOM mutation,
  // not React-rendered state. This handler also runs the dwell tail (hold the
  // full progress for `PROGRESS_DWELL_MS` after a load lands, then summon the
  // prompt) and the submit dismiss. Flipping `tailActive` + `promptShown`
  // together when the tail fires (then one `updateBar`) keeps the
  // loading→prompt swap from ever passing through a hidden frame.
  React.useLayoutEffect(() => {
    const onChange = (): void => {
      const snap = codeSessionStore.getSnapshot();
      const active = readLoadActive(snap);
      if (active) {
        if (tailTimerRef.current !== null) {
          clearTimeout(tailTimerRef.current);
          tailTimerRef.current = null;
        }
        tailActiveRef.current = false;
      } else if (prevLoadActiveRef.current) {
        // A load just landed → hold the full progress for the dwell, then
        // summon the prompt (the derive gates it on `hasOlder`).
        tailActiveRef.current = true;
        if (tailTimerRef.current !== null) clearTimeout(tailTimerRef.current);
        tailTimerRef.current = setTimeout(() => {
          tailTimerRef.current = null;
          tailActiveRef.current = false;
          promptShownRef.current = true;
          updateBar();
        }, PROGRESS_DWELL_MS);
      }
      if (snap.phase === "submitting") promptShownRef.current = false;
      prevLoadActiveRef.current = active;
      updateBar();
    };
    const unsubscribe = codeSessionStore.subscribe(onChange);
    onChange();
    return () => {
      unsubscribe();
      if (tailTimerRef.current !== null) clearTimeout(tailTimerRef.current);
    };
  }, [codeSessionStore, updateBar]);

  // Scroll edges (imperative, fed by the transcript): reaching the top
  // summons the prompt; leaving the top, or scrolling up off the bottom,
  // dismisses it — all DOM-only ([L06]), no re-render. Dismiss only on
  // *leaving* the bottom (`following` false) — a programmatic re-pin right
  // after a restore must not dismiss the prompt the dwell just summoned.
  React.useImperativeHandle(
    ref,
    (): DevLoadControlBarHandle => ({
      setAtTop(atTop) {
        promptShownRef.current = atTop;
        updateBar();
      },
      setAtBottom(following) {
        if (!following) {
          promptShownRef.current = false;
          updateBar();
        }
      },
    }),
    [updateBar],
  );

  const onLoad = React.useCallback(
    (amount: number) => {
      codeSessionStore.loadPrevious(amount);
    },
    [codeSessionStore],
  );

  // Both content slots are always mounted and self-subscribe for their data
  // ([L02]); the dev CSS reveals one per `data-mode` ([L06]). Because neither
  // is gated on React appearance state, the mode swap is a pure DOM change.
  return (
    <TugControlBar ref={barRef} modal={loadActive} regionEl={regionEl}>
      <ControlBarLoading codeSessionStore={codeSessionStore} />
      <ControlBarPrompt codeSessionStore={codeSessionStore} onLoad={onLoad} />
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
}: {
  codeSessionStore: CodeSessionStore;
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
      return !s.loadingPrevious && deriveColdRestoreActive(s);
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

  // Sticky load kind: which load this progress represents. Set while a load
  // is in flight; retained through the dwell tail (both flags false) so the
  // label/format stay correct after the load lands. Self-determined so the
  // slot needs no prop and can stay mounted.
  const loadKindRef = React.useRef<ControlBarLoadKind>("restore");
  if (loadingPrevious) loadKindRef.current = "previous";
  else if (restoreActive) loadKindRef.current = "restore";
  const loadKind = loadKindRef.current;

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
    // The window is the resume request's size: the default N, or deeper for a
    // faithful restore to a saved anchor above it ([recency #step-6]).
    label = `Restoring the most recent ${restoreWindow} messages…`;
    if (active) {
      // Streaming: fill the determinate bar toward the requested window.
      max = restoreWindow;
      value = Math.min(messagesLoaded, max);
    } else {
      // Landed: report the count actually committed, not the requested window —
      // a session shorter than the window loads fewer, so the readout settles
      // to "18 of 18", never a phantom "50 of 50".
      max = Math.max(1, Math.min(messagesLoaded, restoreWindow));
      value = max;
    }
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
  codeSessionStore,
  onLoad,
}: {
  codeSessionStore: CodeSessionStore;
  onLoad: (amount: number) => void;
}): React.ReactElement {
  // Self-subscribed ([L02]) so the slot needs no count prop and stays mounted.
  const earlierCount = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () =>
      codeSessionStore.getSnapshot().replayWindow?.firstLoadedMessageIndex ?? 0,
  );
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
