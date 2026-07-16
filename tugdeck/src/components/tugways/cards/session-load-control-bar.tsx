/**
 * session-load-control-bar — the dev transcript's Z0 surface, split into two
 * pieces so the resting strip is part of the scrolling content while the
 * in-flight progress stays a non-shifting overlay:
 *
 *   - {@link SessionTranscriptTopRow} — the permanent Z0 row, mounted as the
 *     list's `leadingContent`. It is the transcript's first scrolling row:
 *     off-screen when scrolled down, the first thing reached at the top, and
 *     the topmost row as older turns prepend below it. Resting content only —
 *     "Session created <datetime>" on the left, "Turns displayed X of Y" + a
 *     "Load N more" / "All loaded" status on the right — so it never changes
 *     height and the transcript never hops. With nothing to "reveal", the
 *     keyboard scroll-to-top (Opt-Shift-Up) just lands on it.
 *   - {@link SessionLoadOverlay} — the determinate progress band + modal (inert +
 *     scrimmed) region, shown only while a cold restore or load-previous is
 *     in flight (plus the {@link PROGRESS_DWELL_MS} dwell tail). An ABSOLUTE
 *     overlay over the transcript area, never a layout sibling, so locking
 *     the region while loading never shifts the content. Works during a cold
 *     restore, when the top row's list is not yet mounted.
 *
 * **Zone discipline ([L24]).** The overlay's visibility is pure appearance,
 * so it lives in the DOM (`data-visible`), driven by a layout effect that
 * observes the store directly and runs the dwell tail — never React state
 * ([L06]/[L22]). Only the `modal` flag (region inert + scrim) enters React,
 * since `usePaneInert` is a React seam. The top row self-subscribes for its
 * data ([L02]).
 *
 * Paging is a single fixed step (25) — no "All", and no Cancel (a page, and
 * the restore, are quick enough that there's nothing slow to abort).
 *
 * @module components/tugways/cards/session-load-control-bar
 */

import "./session-load-control-bar.css";

import React from "react";

import { TugControlBar } from "@/components/tugways/tug-control-bar";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import {
  type CodeSessionStore,
  type CodeSessionSnapshot,
} from "@/lib/code-session-store";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import { useSessionLedger } from "@/lib/session-ledger-store";
import { deriveColdRestoreActive } from "./session-card-restore-gate";
import {
  deriveControlBarState,
  deriveLoadStatus,
  type ControlBarLoadKind,
} from "./session-load-control-bar-state";

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

export interface SessionLoadControlBarProps {
  codeSessionStore: CodeSessionStore;
  /** The scrollable transcript region the bar inerts + scrims when modal. */
  regionEl: HTMLElement | null;
}

/**
 * The permanent Z0 row — the transcript's first scrolling row. Mounted as
 * the list's `leadingContent`, so it scrolls with the content (off-screen
 * when scrolled down, the first thing reached at the top) and stays the
 * topmost row as older turns prepend below it. Resting content only — the
 * in-flight progress is the {@link SessionLoadOverlay}'s job — so it never
 * changes height and the transcript never hops.
 */
export function SessionTranscriptTopRow({
  codeSessionStore,
  cardId,
}: {
  codeSessionStore: CodeSessionStore;
  /** Owning card id — resolves this card's bound `projectDir` (binding
   *  store) so the metadata row can read its session's ledger `created_at`. */
  cardId: string;
}): React.ReactElement {
  const onLoad = React.useCallback(
    (amount: number) => {
      codeSessionStore.loadPrevious(amount);
    },
    [codeSessionStore],
  );
  // The Compaction Summary is NOT hoisted here — it renders inline at the
  // compaction point (right above the compaction quiet line) so it stays with
  // the compaction that produced it. See the `system_note` "compact" branch in
  // `session-card-transcript.tsx`.
  return (
    <div className="session-transcript-top-row" data-slot="session-transcript-top-row">
      <ControlBarMetadata
        codeSessionStore={codeSessionStore}
        cardId={cardId}
        onLoad={onLoad}
      />
    </div>
  );
}

/**
 * The load overlay — a determinate progress band + a modal (inert +
 * scrimmed) region, shown only while a cold restore or a load-previous is in
 * flight (plus the dwell tail that holds the full bar a beat past the final
 * tick). It is an ABSOLUTE overlay over the transcript area, not a layout
 * sibling, so it never shifts the content: the region locks beneath it and
 * the band paints above the scrim. Works during a cold restore too, when the
 * list (and the {@link SessionTranscriptTopRow}) is not yet mounted — there is
 * simply no region to scrim, and the band shows over the empty area.
 *
 * Zone discipline ([L24]): the band's visibility lives in the DOM
 * (`data-visible`), driven by a layout effect that observes the store
 * directly and runs the dwell tail — never React state ([L06]/[L22]). Only
 * the `modal` flag (region inert + scrim) enters React, since `usePaneInert`
 * is a React seam.
 */
export function SessionLoadOverlay({
  codeSessionStore,
  regionEl,
}: SessionLoadControlBarProps): React.ReactElement {
  const barRef = React.useRef<HTMLDivElement | null>(null);

  // Appearance ref ([L06]): the post-load dwell lives here, never React
  // state — so a dwell tick mutates the DOM without a re-render.
  const tailActiveRef = React.useRef(false);
  const tailTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLoadActiveRef = React.useRef(false);

  // `loadActive` drives the `modal` prop (region inert + scrim while a load
  // is actually in flight — not during the dwell tail). It enters React via
  // `useSyncExternalStore` ([L02]); the re-render is rare and cheap.
  const loadActive = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => readLoadActive(codeSessionStore.getSnapshot()),
  );

  // Mirror the band's visibility onto the DOM ([L06]/[L22]): visible while a
  // load is in flight OR within the dwell tail; hidden otherwise. The band's
  // single content is the progress row (`data-mode="loading"`).
  const updateBar = React.useCallback(() => {
    const bar = barRef.current;
    if (bar === null) return;
    const snap = codeSessionStore.getSnapshot();
    const state = deriveControlBarState({
      loadingDisplay: readLoadActive(snap) || tailActiveRef.current,
    });
    bar.dataset.visible = String(state.kind === "loading");
    bar.dataset.mode = "loading";
  }, [codeSessionStore]);

  // Observe the store directly ([L22]). Runs the dwell tail: hold the full
  // progress for `PROGRESS_DWELL_MS` after a load lands, then hide the band.
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
        // hide the overlay.
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

  return (
    <div className="session-load-overlay" data-slot="session-load-overlay">
      <TugControlBar ref={barRef} modal={loadActive} regionEl={regionEl}>
        <ControlBarLoading codeSessionStore={codeSessionStore} />
      </TugControlBar>
    </div>
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
    <div className="session-load-control-bar-loading">
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
        className="session-load-control-bar-bar"
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
 * Metadata state — the strip's resting content. Left: "Session created:
 * <datetime>" (omitted until the creation time is known). Right: "Turns
 * displayed: X of Y" + a fixed-step "Load N more" action, "All loaded" when
 * nothing remains, or "No turns" on a fresh zero-turn session. All
 * self-subscribed ([L02]) so the slot needs only the card id (to resolve its
 * ledger row) and the load callback, and stays mounted across mode swaps.
 *
 * **Session-created source — the ledger is the authority.** The dev session
 * ledger carries each session's `created_at`: the spawn time for sessions
 * Tug created, and the JSONL-derived transcript birth for externally bridged
 * (terminal) sessions. That value is present at zero turns — before any
 * replay anchor exists — so it's the primary source, with the replay-derived
 * `sessionCreatedAtMs` (the first turn's wall-clock) as the fallback for the
 * brief window before the ledger row loads.
 */
function ControlBarMetadata({
  codeSessionStore,
  cardId,
  onLoad,
}: {
  codeSessionStore: CodeSessionStore;
  cardId: string;
  onLoad: (amount: number) => void;
}): React.ReactElement {
  const replayCreatedAtMs = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().sessionCreatedAtMs,
  );
  const tugSessionId = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().tugSessionId,
  );
  // This card's bound project dir keys the ledger fetch ([L02]). Empty until
  // a session is bound — `useSessionLedger` then short-circuits to idle.
  const projectDir = React.useSyncExternalStore(
    cardSessionBindingStore.subscribe,
    React.useCallback(
      () => cardSessionBindingStore.getBinding(cardId)?.projectDir ?? "",
      [cardId],
    ),
  );
  const ledger = useSessionLedger(projectDir);
  const ledgerCreatedAtMs =
    ledger.rows.find((r) => r.session_id === tugSessionId)?.created_at ?? null;
  // Ledger wins (stable, present at zero turns); replay anchor backfills the
  // pre-load window.
  const createdAtMs = ledgerCreatedAtMs ?? replayCreatedAtMs;
  const transcriptLength = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().transcript.length,
  );
  const replayWindow = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().replayWindow,
  );
  // A `/compact`-born session relabels the header "Session compacted" — it
  // is a "fake new" session (an implementation detail of compaction), not a
  // genuinely new card/session. The date/time is the same source (the fresh
  // session's created-at); only the verb changes.
  const isCompacted =
    React.useSyncExternalStore(
      codeSessionStore.subscribe,
      () => codeSessionStore.getSnapshot().compactionSeed,
    ) !== null;
  const sessionVerb = isCompacted ? "Session compacted" : "Session created";
  const focusGroup = React.useId();

  const status = deriveLoadStatus({
    transcriptLength,
    firstLoadedTurnIndex: replayWindow?.firstLoadedTurnIndex ?? null,
    totalTurns: replayWindow?.totalTurns ?? null,
    step: LOAD_PREVIOUS_STEP,
  });

  return (
    <div className="session-load-control-bar-metadata">
      <div className="session-load-control-bar-meta-left">
        {createdAtMs !== null ? (
          <TugLabel emphasis="proposal" className="session-load-control-bar-label">
            {`${sessionVerb}: ${formatSessionCreated(createdAtMs)}`}
          </TugLabel>
        ) : isCompacted ? (
          <TugLabel emphasis="proposal" className="session-load-control-bar-label">
            {sessionVerb}
          </TugLabel>
        ) : null}
      </div>
      <div className="session-load-control-bar-meta-right">
        {status.total === 0 ? (
          // A fresh session with no committed turns yet: the "0 of 0 · All
          // loaded" math reads as a stuck empty page rather than a new
          // session, so show a purpose-built waiting state instead.
          <TugLabel emphasis="proposal" className="session-load-control-bar-label">
            No turns
          </TugLabel>
        ) : (
          <>
            <TugLabel emphasis="proposal" className="session-load-control-bar-label">
              {`Turns displayed: ${status.displayed.toLocaleString()} of ${status.total.toLocaleString()}`}
            </TugLabel>
            <span className="session-load-control-bar-meta-sep" aria-hidden="true">
              ·
            </span>
            {status.hasOlder ? (
              <>
                <TugLabel
                  emphasis="proposal"
                  className="session-load-control-bar-actions-label"
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
                  className="session-load-control-bar-actions-label"
                >
                  more
                </TugLabel>
              </>
            ) : (
              <TugLabel
                emphasis="proposal"
                className="session-load-control-bar-actions-label"
              >
                All loaded
              </TugLabel>
            )}
          </>
        )}
      </div>
    </div>
  );
}
