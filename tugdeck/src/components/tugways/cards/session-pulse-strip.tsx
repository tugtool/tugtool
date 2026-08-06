/**
 * SessionPulseStrip — the production Z2 PULSE strip: the machine
 * thinking out loud, one line beneath the session card's status row, fed
 * by the app-scoped {@link PulseStore} and FILTERED TO THIS CARD'S
 * SESSION (a card never wears another session's voice).
 *
 * Behavior:
 *  - hidden entirely while the `pulse/enabled` tugbank default is off
 *    (the snapshot carries the toggle);
 *  - fixed single-line height once shown — a new line never moves
 *    layout. The line reads at two levels (S1): the session's standing
 *    OVERVIEW (the agent's standing answer to "what is this session
 *    working on") leads in headline register, bright and layout-pinned, then a
 *    `›`, then the live beat trailing in muted small mono. The activity is
 *    the run that ellipsizes, so the goal is never the part that gets cut.
 *    With no overview there is no headline and no separator — the strip is
 *    exactly the single activity line it has always been;
 *  - every line DWELLS at least {@link MIN_DWELL_MS} before the next
 *    replaces it (rapid thoughts coalesce — the newest pending line
 *    wins when the dwell expires), except the user's own clear
 *    (submit), which swaps immediately;
 *  - a changed line SWAPS INSTANTLY — one text node, no animation. Text
 *    cannot cross-fade (two different strings in one box interleave their
 *    glyphs into a smash), and the dwell already paces changes ≥1.8s
 *    apart, so an instant replace reads calm; the sparkline carries the
 *    liveness. Only one string is ever painted, so overlap is impossible;
 *  - a `None` line before the session's first beat — set exactly like
 *    every other activity string, not in a placeholder voice of its own;
 *  - a `Compacting context…` PIN for the length of a `/compact` run
 *    started from this card — the one stretch the voice cannot narrate,
 *    since the wire streams nothing between the submit and the boundary.
 *
 * Laws: [L02] every store via `useSyncExternalStore` (`usePulse`,
 *       `usePulseOverview`, the session-id selector, and
 *       `compactionProgressStore`);
 *       [L06] the dwell queue is local presentation data
 *       (`useState`/`useRef`), which changes WHAT text exists, not how it
 *       looks — no appearance passes through React state;
 *       [L19] `.tsx`/`.css` pair, `data-slot="session-pulse-strip"`;
 *       [L26] mounted whenever enabled; only the text changes.
 *
 * @module components/tugways/cards/session-pulse-strip
 */

import "./session-pulse-strip.css";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  sparklineCurves,
  TugSparkline,
} from "@/components/tugways/tug-sparkline";
import {
  TugPopover,
  TugPopoverContent,
  TugPopoverTrigger,
} from "@/components/tugways/tug-popover";
import {
  TugPopupListEmpty,
  TugPopupListFrame,
  TugPopupListItem,
  TugPopupListItemText,
  TugPopupListScroller,
  TugPopupListToneDot,
} from "@/components/tugways/tug-popup-list";
import { useFocusable } from "@/components/tugways/use-focusable";
import { useCopyableButton } from "@/components/tugways/use-copyable-text";
import {
  COMPACTING_PULSE_TEXT,
  compactionProgressStore,
  isCompactingCard,
} from "@/lib/compaction-progress-store";
import { renderPulseLine } from "@/lib/pulse-line/render-pulse-line";
import {
  groupPulseHistory,
  latestLineForScope,
  usePulseOverview,
  linesForScope,
  usePulse,
  type PulseLineEntry,
} from "@/lib/pulse-store";
import {
  ACTIVITY_BIN_MS,
  getSessionActivityStore,
  isRateChannel,
} from "@/lib/session-activity-store";
import { SessionPulseCard } from "@/components/tugways/cards/pulse-card";
import { TugPulse } from "@/components/tugways/tug-pulse";
import type { CodeSessionStore } from "@/lib/code-session-store";

/** How many recent pulses the PULSE-label popover lists. */
const PULSE_HISTORY_COUNT = 8;

/** Every line holds the strip at least this long before the next. */
export const MIN_DWELL_MS = 1_800;
/**
 * Sparkline full-scale, in streamed chars per 1s. Fixed (no autoscale) so the
 * line never rescales vertically. The ceiling sits ~4× above typical output
 * (~75 tok/s ≈ 300 chars/s) so real bursts have headroom before the curve rolls
 * off; SPARKLINE_CURVE spends most of the height on the low/mid band below it.
 */
const SPARKLINE_FULL_SCALE_CHARS = 1200;

/**
 * Vertical response curve. `gamma(0.6)` is a power curve, steep through the
 * low/mid band so ordinary activity spreads across the height and varies
 * visibly, then concave into the top so a burst reads tall and rolls off just
 * shy of the ceiling instead of slamming into a flat clip. Reads roughly:
 * 150 c/s → 0.30, 300 → 0.46, 500 → 0.61, 800 → 0.78, 1200+ → full.
 *
 * To retune: lower the exponent for an even steeper low end, raise it toward 1
 * for a flatter one; or swap to `sparklineCurves.soft(k)` if extreme spikes
 * must never clip at all (see {@link sparklineCurves}).
 */
const SPARKLINE_CURVE = sparklineCurves.gamma(0.6);

/** What the strip is showing: a pulse line or the placeholder. */
interface DisplayEntry {
  key: string;
  text: string;
  placeholder: boolean;
  /** Swap this entry in the moment it arrives, skipping the dwell — the
   *  user's own clear and the compaction pin both answer a gesture. */
  immediate?: boolean;
}

const NONE_ENTRY: DisplayEntry = Object.freeze({
  key: "__pulse_none__",
  text: "None",
  placeholder: true,
  immediate: true,
});

/**
 * The compaction pin. A `/compact` turn streams nothing for minutes, and
 * the submit that opened it cleared the strip — so without this the whole
 * run reads as an idle `None`, which is exactly when the user has pulled
 * the progress sheet down and has only the strip to go on. Held for the
 * run's lifetime, not the sheet's.
 */
const COMPACTING_ENTRY: DisplayEntry = Object.freeze({
  key: "__pulse_compacting__",
  text: COMPACTING_PULSE_TEXT,
  placeholder: false,
  immediate: true,
});

/**
 * The dwell queue: `target` is what the store wants shown; `current`
 * is what the strip shows. A swap happens immediately when the
 * current line has dwelt long enough (or the target is marked
 * `immediate`); otherwise the newest target waits out the remainder.
 * A swap replaces the text INSTANTLY — one node, no animation (text can't
 * cross-fade without the two strings smashing together).
 */
function useDwellDisplay(target: DisplayEntry): {
  current: DisplayEntry;
} {
  const [current, setCurrent] = useState<DisplayEntry>(target);
  const currentKeyRef = useRef(target.key);
  const lastSwapAtRef = useRef(0);
  const pendingRef = useRef<DisplayEntry | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    currentKeyRef.current = current.key;
  }, [current.key]);

  const swap = useCallback((next: DisplayEntry): void => {
    setCurrent((prev) => (prev.key === next.key ? prev : next));
    lastSwapAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (target.key === currentKeyRef.current) {
      pendingRef.current = null;
      return;
    }
    // The user's own clear (submit → placeholder) and the compaction pin
    // feel immediate; dwell only paces the machine's stream.
    if (target.immediate === true) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingRef.current = null;
      swap(target);
      return;
    }
    const remaining = lastSwapAtRef.current + MIN_DWELL_MS - Date.now();
    if (remaining <= 0 && timerRef.current === null) {
      swap(target);
      return;
    }
    // Within the dwell: the newest target wins when the window opens.
    pendingRef.current = target;
    if (timerRef.current === null) {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending !== null) swap(pending);
      }, Math.max(remaining, 0));
    }
  }, [target, swap]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return { current };
}

export function SessionPulseStrip({
  codeSessionStore,
  cardId,
  focusGroup,
  focusOrder,
}: {
  codeSessionStore: CodeSessionStore;
  /**
   * The owning card — the scope of the compaction pin ({@link
   * COMPACTING_ENTRY}). `compactionProgressStore` is an app-wide singleton
   * holding one run per initiating card, so only that card's strip wears the
   * pin. Omitted in gallery / fixture mounts (no pin).
   */
  cardId?: string;
  /**
   * Author the PULSE label into a focus group ([P10] revised) — when set, the
   * label registers as a **leaf** cycle stop (its own Tab stop, like the Z2
   * status cells; no arrow-roving), and Space/Enter open the recent-pulses
   * popover natively. Supplied by the session card, which owns the Tab order;
   * omitted in gallery / fixture mounts (pointer-only, as before).
   */
  focusGroup?: string;
  /** Order within {@link focusGroup}. */
  focusOrder?: number;
}): React.ReactElement | null {
  const pulse = usePulse();
  // Leaf cycle-stop registration ([P10] revised), mirroring `TugStatusCell`.
  // Keyed by `id` independent of the DOM ref, so we stamp `data-tug-focusable`
  // straight onto the button below rather than routing a ref through
  // `TugPopoverTrigger` (whose `asChild` clone would replace it). The engine
  // resolves the label by that attribute, drives DOM focus to it during the
  // cycle walk, and paints the leaf ring via the global `[data-key-view-kbd]`
  // rule. Hooks run before the `!enabled` early return ([L02]).
  const legendFocusableId = React.useId();
  const legendRegistered = focusGroup !== undefined;
  useFocusable({
    id: legendFocusableId,
    group: focusGroup ?? "",
    order: focusOrder ?? 0,
    register: legendRegistered,
  });
  // The card's bound session id — the strip's scope filter. Read
  // through the store per [L02]; empty until a session binds.
  const tugSessionId = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(
      () => codeSessionStore.getSnapshot().tugSessionId,
      [codeSessionStore],
    ),
  );
  // A manual `/compact` run started from THIS card. The wire is silent for
  // its whole duration, so the pin below is the only thing the strip can
  // say about it; the daemon's own `Compacted context` beat closes it out.
  const compaction = useSyncExternalStore(
    compactionProgressStore.subscribe,
    compactionProgressStore.getSnapshot,
  );
  const compacting = isCompactingCard(compaction, cardId);
  // Lines cleared by this card's last submit stay hidden; the next
  // turn's voice repopulates the strip.
  const latest = latestLineForScope(
    pulse.lines,
    tugSessionId,
    pulse.cleared.get(tugSessionId),
  );
  // The session's standing overview — the headline run. Separate from the beat
  // entirely: it never enters the dwell queue (it is not news, so it has
  // nothing to pace against) and never enters the history.
  const overview = usePulseOverview(tugSessionId);
  const target: DisplayEntry = compacting
    ? COMPACTING_ENTRY
    : latest !== null
      ? {
          key: latest.key,
          text: latest.text,
          placeholder: false,
        }
      : NONE_ENTRY;
  const { current } = useDwellDisplay(target);

  // Live activity feed for the sparkline. The app-scoped store is a stable
  // singleton (NOT snapshot state): the sparkline samples its composite
  // series imperatively for this card's session, off React's render path;
  // the scroll itself is WAAPI ([L06]/[L13]). All derivation is upstream in
  // tugcode ([Q05]) — the deck only records + reads.
  const activityStore = getSessionActivityStore();
  const getSeries = useCallback(
    (nowMs: number): number[] =>
      activityStore !== null && tugSessionId.length > 0
        ? activityStore.compositeSeries(tugSessionId, nowMs)
        : [],
    [activityStore, tugSessionId],
  );
  // The tape's data-event clock, filtered to rate channels — this strip
  // draws the composite of rate work, so gauge levels (which move whether
  // or not the session works) must not wake it.
  const subscribeActivity = useCallback(
    (wake: () => void): (() => void) =>
      activityStore !== null && tugSessionId.length > 0
        ? activityStore.subscribeActivity(tugSessionId, (channel) => {
            if (isRateChannel(channel)) wake();
          })
        : () => {},
    [activityStore, tugSessionId],
  );
  // The compact line stays a single muted hue — no dominant-channel tint.
  // Color-by-channel is legible only where the label sits beside the line
  // (the expanded Pulse card); on this word-sized strip a shifting color has
  // no legend, so it reads as noise. The expansion carries the color story.

  // The last few pulses for this card's session — shown in the legend popover.
  const history = linesForScope(pulse.lines, tugSessionId, PULSE_HISTORY_COUNT);

  // Right-click → Copy the current line's raw text (not the placeholder),
  // headline included so the copy carries the whole two-level reading.
  const copyLine = useCopyableButton(
    current.placeholder ? "" : composeLineCopy(overview?.text, current.text),
  );

  if (!pulse.enabled) return null;
  /*
    dismissOnChainActivity=false: a row's right-click → Copy dispatches the
    `copy` action through the responder chain, which would otherwise read as
    foreign chain activity and close this popover mid-copy. The copy
    originates from WITHIN the popover, so it must not dismiss it; Escape,
    click-outside, Space, and the trigger toggle still close it.
  */
  const legend = (
    <TugPopover dismissOnChainActivity={false}>
      <TugPopoverTrigger>
        <button
          type="button"
          className="session-pulse-strip-legend"
          data-slot="session-pulse-legend"
          // Like the Z2 status cells: not a *native* Tab stop and never steals
          // card focus to the editor on click; the engine drives DOM focus
          // here during the cycle walk (a `<button>` is programmatically
          // focusable at -1) and Space/Enter open the popover natively.
          tabIndex={-1}
          data-tug-focus="refuse"
          data-no-activate=""
          data-tug-focusable={legendRegistered ? legendFocusableId : undefined}
          aria-label="Recent pulses"
        >
          PULSE
        </button>
      </TugPopoverTrigger>
      <TugPopoverContent side="top" align="start" sideOffset={8} arrow spaceDismisses>
        <SessionPulseHistory lines={history} />
      </TugPopoverContent>
    </TugPopover>
  );

  /*
    The compact sparkline is the entry point to the expanded Activity card
    ([P12] Surface): clicking it opens a popover of per-channel small-multiples
    for this session. The trigger mirrors the legend button's focus discipline
    (leaf, never steals card focus).
  */
  const spark = (
    <TugPopover>
      <TugPopoverTrigger>
        <button
          type="button"
          className="session-pulse-strip-spark-trigger"
          tabIndex={-1}
          data-tug-focus="refuse"
          data-no-activate=""
          aria-label="Session pulse detail"
        >
          <TugSparkline
            getSeries={getSeries}
            subscribeActivity={subscribeActivity}
            binMs={ACTIVITY_BIN_MS}
            fullScale={SPARKLINE_FULL_SCALE_CHARS}
            curve={SPARKLINE_CURVE}
            width={64}
            height={22}
            title="Session activity — text, tokens, tools, and subagents"
          />
        </button>
      </TugPopoverTrigger>
      <TugPopoverContent side="top" align="end" sideOffset={8} arrow>
        <SessionPulseCard session={tugSessionId} />
      </TugPopoverContent>
    </TugPopover>
  );

  return (
    <div className="session-pulse-strip" data-slot="session-pulse-strip">
      {/*
        The whole two-level reading is `TugPulse`: the strip contributes the
        band it rides on and the two controls at its ends, and NO typography —
        face, size, baseline, and the `›` all belong to the component, so this
        strip and the Lens row cannot drift apart.

        The headline is read straight from the store on every render. It
        deliberately does NOT go through `useDwellDisplay`: the dwell paces the
        beat's rapid commentary, and the emitter's own floor already makes the
        overview slow. Pacing it twice would only delay the session's first
        headline for no reading benefit.
      */}
      <TugPulse
        legend={legend}
        headline={overview !== null ? overview.text : undefined}
        activity={
          <PulseLineText
            entry={current}
            className="session-pulse-strip-text"
          />
        }
        trailing={spark}
        stageProps={{
          ref: copyLine.ref as React.Ref<HTMLSpanElement>,
          onContextMenu: copyLine.onContextMenu,
        }}
      />
      {copyLine.contextMenu}
    </div>
  );
}

/**
 * The PULSE-label popover body: the recent pulses for this session,
 * newest first, GROUPED by intent so a retained goal heads its run of
 * beats instead of repeating on each row. Built on the shared
 * {@link TugPopupListFrame} vocabulary — the same titled surface the
 * Z2 status popups use — with each beat a leading-dot item row. An
 * empty history reads as a quiet placeholder.
 */
function SessionPulseHistory({
  lines,
}: {
  lines: readonly PulseLineEntry[];
}): React.ReactElement {
  const groups = React.useMemo(() => groupPulseHistory(lines), [lines]);
  return (
    <TugPopupListFrame
      title="Recent pulses"
      kind="item"
      className="session-pulse-history"
      data-slot="session-pulse-history"
    >
      {groups.length === 0 ? (
        <TugPopupListEmpty>No pulses yet.</TugPopupListEmpty>
      ) : (
        <TugPopupListScroller data-slot="session-pulse-history-body">
          {groups.map((group) => (
            <div className="session-pulse-history-group" key={group.beats[0].key}>
              {group.intent !== undefined ? (
                <SessionPulseHistoryIntent intent={group.intent} />
              ) : null}
              {group.beats.map((beat) => (
                <SessionPulseHistoryBeat
                  key={beat.key}
                  text={beat.text}
                  intent={group.intent}
                />
              ))}
            </div>
          ))}
        </TugPopupListScroller>
      )}
    </TugPopupListFrame>
  );
}

/** A group's intent heading — the goal in calm muted prose (emphasis
 *  flattened in CSS), shown once above its beats. */
function SessionPulseHistoryIntent({
  intent,
}: {
  intent: string;
}): React.ReactElement {
  const render = React.useMemo(() => renderPulseLine(intent), [intent]);
  return (
    <div className="session-pulse-history-intent">
      {render.html.length === 0 ? (
        <>{intent}</>
      ) : (
        <span dangerouslySetInnerHTML={{ __html: render.html }} />
      )}
    </div>
  );
}

/** One beat row: a leading tone dot + the live action, the primary
 *  reading of the row. Right-click copies the raw `intent › beat`. */
function SessionPulseHistoryBeat({
  text,
  intent,
}: {
  text: string;
  intent?: string;
}): React.ReactElement {
  const render = React.useMemo(() => renderPulseLine(text), [text]);
  const copy = useCopyableButton(composeLineCopy(intent, text));
  const primary =
    render.html.length === 0 ? (
      <>{text}</>
    ) : (
      <span dangerouslySetInnerHTML={{ __html: render.html }} />
    );
  return (
    <TugPopupListItem
      ref={copy.ref as React.Ref<HTMLDivElement>}
      onContextMenu={copy.onContextMenu}
      className="session-pulse-history-beat"
      indicator={<TugPopupListToneDot tone="default" />}
    >
      <TugPopupListItemText primary={primary} />
      {copy.contextMenu}
    </TugPopupListItem>
  );
}

/**
 * Raw-text form of a line for the clipboard: "intent › text".
 *
 * Two callers with two different intents. The strip passes the session
 * overview, so a copy carries the same two-level reading the eye gets; the
 * history popover passes its group's line intent, which is the level that
 * survives there ([P09]).
 */
function composeLineCopy(intent: string | undefined, text: string): string {
  return intent !== undefined ? `${intent} › ${text}` : text;
}

/**
 * The activity run. The pulse-line library owns fidelity and safety
 * (math-first split, sanitized markdown, KaTeX, total-function fallback);
 * this component only re-renders once a lazy KaTeX load resolves, then
 * every render is synchronous. `html: ""` is the library's
 * render-as-plain-text signal.
 *
 * The activity is a tool call, so backticked paths and commands are exactly
 * what the markdown pipeline is for. The headline beside it is one
 * model-written sentence with no markup in it, so the strip renders that one
 * as plain text rather than paying for a second pipeline.
 */
function PulseLineText({
  entry,
  className,
}: {
  entry: DisplayEntry;
  className: string;
}): React.ReactElement {
  const [engineEpoch, bumpEngineReady] = React.useReducer(
    (n: number) => n + 1,
    0,
  );
  // engineEpoch keys the memo so the resolved KaTeX engine re-renders
  // the SAME entry with real typesetting (the first pass showed the
  // escaped source while the engine loaded).
  const render = React.useMemo(
    () => (entry.placeholder ? null : renderPulseLine(entry.text)),
    [entry, engineEpoch],
  );
  React.useEffect(() => {
    const pending = render?.pending;
    if (pending == null) return;
    let live = true;
    void pending.then(() => {
      if (live) bumpEngineReady();
    });
    return () => {
      live = false;
    };
  }, [render]);
  if (render === null || render.html.length === 0) {
    return <span className={className}>{entry.text}</span>;
  }
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: render.html }}
    />
  );
}
