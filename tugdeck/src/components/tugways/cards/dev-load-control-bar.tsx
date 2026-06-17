/**
 * dev-load-control-bar — the dev transcript's permanent Z0 strip.
 *
 * One `TugControlBar` ([P09]–[P11]) that is a **permanent fixture** at the
 * top of the transcript: it never mounts/unmounts and never toggles its
 * height, so the transcript no longer hops when it would once have appeared
 * (on reaching the top) or disappeared (on scrolling away). With nothing to
 * "reveal", the keyboard scroll-to-top (Opt-Shift-Up) no longer needs a
 * follow-up wheel event to summon it — the strip is simply always there.
 *
 * It carries one of two contents driven by {@link deriveControlBarState}:
 *
 *   - **Loading** — a cold restore *or* a load-previous → a determinate
 *     progress bar (the region is **modal** — inert + scrimmed — while the
 *     load is in flight). The progress lingers, at full, for
 *     {@link PROGRESS_DWELL_MS} past the final tick so the bar visibly
 *     reaches the end before it swaps back (`loadingDisplay`).
 *   - **Metadata** — the resting content: "Session created <datetime>" on
 *     the left, "Turns displayed X of Y" + a "Load N more" / "All loaded"
 *     status on the right.
 *
 * **Zone discipline ([L24]).** The strip's *mode* (loading / metadata) is
 * pure appearance — its only consumer is the renderer — so it lives in the
 * DOM, never React state ([L06]). The host holds the post-load dwell flag in
 * a ref, observes the store *directly* in a layout effect ([L22]), and
 * writes the resolved mode onto the band's `data-mode` attribute; a dwell
 * tick therefore never re-renders. `data-visible` is pinned `"true"` (the
 * strip is permanent). Both content slots are always mounted and
 * self-subscribe for their data ([L02]); the dev CSS reveals one per
 * `data-mode`. The load-in-flight flag (`modal`) is session *data*, so it
 * alone enters React via `useSyncExternalStore` to drive the region
 * inert + scrim.
 *
 * Paging is a single fixed step (25) — no "All", and no Cancel (a page, and
 * the restore, are quick enough that there's nothing slow to abort).
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
  deriveControlBarState,
  deriveLoadStatus,
  type ControlBarLoadKind,
} from "./dev-load-control-bar-state";

/** Default numeric "load previous" step in turns, capped to the turns that remain. */
const LOAD_PREVIOUS_STEP = 25;

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

export interface DevLoadControlBarProps {
  codeSessionStore: CodeSessionStore;
  /** The scrollable transcript region the bar inerts + scrims when modal. */
  regionEl: HTMLElement | null;
}

export function DevLoadControlBar({
  codeSessionStore,
  regionEl,
}: DevLoadControlBarProps): React.ReactElement {
  const barRef = React.useRef<HTMLDivElement | null>(null);

  // Appearance refs ([L06]): the post-load dwell lives here, never React
  // state — so a dwell tick mutates the DOM without a re-render.
  const tailActiveRef = React.useRef(false); // within the post-load dwell
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

  // Resolve the strip's mode from the live snapshot + the dwell ref and
  // mirror it onto the band's DOM attributes ([L06]/[L22]). `data-visible`
  // is pinned `"true"` — the strip is a permanent fixture — and `data-mode`
  // selects which content slot the dev CSS reveals. Never React state.
  const updateBar = React.useCallback(() => {
    const bar = barRef.current;
    if (bar === null) return;
    const snap = codeSessionStore.getSnapshot();
    const state = deriveControlBarState({
      loadingDisplay: readLoadActive(snap) || tailActiveRef.current,
    });
    bar.dataset.visible = "true";
    bar.dataset.mode = state.kind;
  }, [codeSessionStore]);

  // Observe the store directly ([L22]) — the strip's mode is a DOM mutation,
  // not React-rendered state. This handler also runs the dwell tail: hold the
  // full progress for `PROGRESS_DWELL_MS` after a load lands, then swap back
  // to the metadata row (one `updateBar` per transition, so the
  // loading→metadata swap is a single clean frame).
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
        // swap back to the metadata row.
        tailActiveRef.current = true;
        if (tailTimerRef.current !== null) clearTimeout(tailTimerRef.current);
        tailTimerRef.current = setTimeout(() => {
          tailTimerRef.current = null;
          tailActiveRef.current = false;
          updateBar();
        }, PROGRESS_DWELL_MS);
      }
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
      <ControlBarMetadata codeSessionStore={codeSessionStore} onLoad={onLoad} />
    </TugControlBar>
  );
}

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
  // Turns committed so far in the loaded transcript window — the cold-restore
  // progress numerator. One transcript entry is one committed turn (the
  // canonical unit, `tuglaws/turn-metric.md`), so the count is just the
  // window's entry count — matching the turns-sized denominator.
  const turnsLoaded = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().transcript.length,
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
    () => codeSessionStore.getSnapshot().restoreWindowTurns,
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
    // The window is the resume request's size in turns: the default N, or
    // deeper for a faithful restore to a saved anchor above it ([P06]).
    label = `Restoring the most recent ${restoreWindow} turns…`;
    ({ value, max } = restoreBarValueMax(turnsLoaded, restoreWindow, active));
    formatValue = formatWindowValue;
  } else {
    const effTarget = active ? target : lastTargetRef.current;
    label = "Loading earlier turns…";
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

/**
 * Restore progress bar value/max in **turns** (the canonical unit). While the
 * load streams, the bar fills `turnsLoaded` toward the requested window. Once
 * it lands, the readout settles to the turns actually committed (a session
 * shorter than the window shows "3 of 3 turns", never a phantom "25 of 25").
 * Pure over counts so the selection is unit-testable without the component.
 */
export function restoreBarValueMax(
  turnsLoaded: number,
  restoreWindowTurns: number,
  active: boolean,
): { value: number; max: number } {
  if (active) {
    const max = restoreWindowTurns;
    return { value: Math.min(turnsLoaded, max), max };
  }
  const max = Math.max(1, Math.min(turnsLoaded, restoreWindowTurns));
  return { value: max, max };
}

/** `formatValue` for the cold-restore window readout — "3 of 25 turns". */
function formatWindowValue(value: number, max: number): string {
  return `${value.toLocaleString()} of ${max.toLocaleString()} turns`;
}

/** `formatValue` for the load-previous determinate readout. */
function formatLoadPreviousValue(value: number, max: number): string {
  return `${value.toLocaleString()} of ${max.toLocaleString()} turns`;
}

/**
 * Format the session-created wall-clock as "Jun 17, 6:11 AM" — month/day
 * (unambiguous across days, since a resumed session may be old) + short
 * clock, locale-formatted. Appearance only ([L06]); not unit-tested
 * (locale/timezone dependent).
 */
function formatSessionCreated(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Metadata state — the strip's resting content. Left: "Session created
 * <datetime>" (omitted until the anchor is known). Right: "Turns displayed
 * X of Y" + a fixed-step "Load N more" action, or "All loaded" when nothing
 * remains. All self-subscribed ([L02]) so the slot needs no props beyond the
 * load callback and stays mounted across mode swaps.
 */
function ControlBarMetadata({
  codeSessionStore,
  onLoad,
}: {
  codeSessionStore: CodeSessionStore;
  onLoad: (amount: number) => void;
}): React.ReactElement {
  const createdAtMs = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().sessionCreatedAtMs,
  );
  const transcriptLength = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().transcript.length,
  );
  const replayWindow = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().replayWindow,
  );
  const focusGroup = React.useId();

  const status = deriveLoadStatus({
    transcriptLength,
    firstLoadedTurnIndex: replayWindow?.firstLoadedTurnIndex ?? null,
    totalTurns: replayWindow?.totalTurns ?? null,
    step: LOAD_PREVIOUS_STEP,
  });

  return (
    <div className="dev-load-control-bar-metadata">
      <div className="dev-load-control-bar-meta-left">
        {createdAtMs !== null ? (
          <TugLabel emphasis="proposal" className="dev-load-control-bar-label">
            {`Session created ${formatSessionCreated(createdAtMs)}`}
          </TugLabel>
        ) : null}
      </div>
      <div className="dev-load-control-bar-meta-right">
        <TugLabel emphasis="proposal" className="dev-load-control-bar-label">
          {`Turns displayed ${status.displayed.toLocaleString()} of ${status.total.toLocaleString()}`}
        </TugLabel>
        <span className="dev-load-control-bar-meta-sep" aria-hidden="true">
          ·
        </span>
        {status.hasOlder ? (
          <>
            <TugLabel
              emphasis="proposal"
              className="dev-load-control-bar-actions-label"
            >
              Load
            </TugLabel>
            <TugPushButton
              size="sm"
              emphasis="outlined"
              role="action"
              focusGroup={focusGroup}
              focusOrder={0}
              onClick={() => onLoad(status.loadStep)}
            >
              {status.loadStep}
            </TugPushButton>
            <TugLabel
              emphasis="proposal"
              className="dev-load-control-bar-actions-label"
            >
              more
            </TugLabel>
          </>
        ) : (
          <TugLabel
            emphasis="proposal"
            className="dev-load-control-bar-actions-label"
          >
            All loaded
          </TugLabel>
        )}
      </div>
    </div>
  );
}
