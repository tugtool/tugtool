/**
 * DevPulseStrip — the production Z2 PULSE strip: the machine
 * thinking out loud, one line beneath the dev card's status row, fed
 * by the app-scoped {@link PulseStore} and FILTERED TO THIS CARD'S
 * SESSION (a card never wears another session's voice).
 *
 * Behavior:
 *  - hidden entirely while the `pulse/enabled` tugbank default is off
 *    (the snapshot carries the toggle);
 *  - fixed single-line height once shown — a new line never moves
 *    layout;
 *  - every line DWELLS at least {@link MIN_DWELL_MS} before the next
 *    replaces it (rapid thoughts coalesce — the newest pending line
 *    wins when the dwell expires), except the user's own clear
 *    (submit), which swaps immediately;
 *  - a changed line CROSS-FADES TO the incoming via TugAnimator (the new
 *    line rises to full opacity over the still, outgoing line — no
 *    fade-out); a beat that re-states the identical line never restages,
 *    so unchanged text shows no motion at all;
 *  - a dimmed `None` placeholder before the session's first line.
 *
 * Laws: [L02] both stores via `useSyncExternalStore` (`usePulse` and
 *       the session-id selector below);
 *       [L06] the cross-fade runs through TugAnimator (WAAPI on DOM
 *       refs) — opacity never passes through React state; the dwell
 *       queue is local presentation data (`useState`/`useRef`), which
 *       changes WHAT text exists, not how it looks;
 *       [L19] `.tsx`/`.css` pair, `data-slot="dev-pulse-strip"`;
 *       [L26] mounted whenever enabled; only the text layers change.
 *
 * @module components/tugways/cards/dev-pulse-strip
 */

import "./dev-pulse-strip.css";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { animate } from "@/components/tugways/tug-animator";
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
import { renderPulseLine } from "@/lib/pulse-line/render-pulse-line";
import {
  groupPulseHistory,
  latestLineForScope,
  linesForScope,
  usePulse,
  type PulseLineEntry,
} from "@/lib/pulse-store";
import {
  ACTIVITY_BIN_MS,
  getSessionActivityStore,
} from "@/lib/session-activity-store";
import { DevPulseCard } from "@/components/tugways/cards/pulse-card";
import type { CodeSessionStore } from "@/lib/code-session-store";

/** How many recent pulses the PULSE-label popover lists. */
const PULSE_HISTORY_COUNT = 8;

/** Every line holds the strip at least this long before the next. */
export const MIN_DWELL_MS = 1_800;
/** Cross-fade length (raw ms; TugAnimator scales by the timing dial). */
export const XFADE_MS = 600;
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
  /** Retained high-level goal behind a low-level `text` beat — the strip
   *  renders "intent › beat" (goal muted and ellipsized first, beat
   *  pinned) when present. */
  intent?: string;
  placeholder: boolean;
}

const NONE_ENTRY: DisplayEntry = Object.freeze({
  key: "__pulse_none__",
  text: "None",
  placeholder: true,
});

/**
 * Whether two entries RENDER the same line — same placeholder state, same
 * beat text, same retained intent. A new pulse line always carries a fresh
 * `key` (a new beat), but a beat that re-states the identical text (or rides
 * an unchanged intent) must NOT restage the line: there is nothing to
 * cross-fade to, so the strip stays perfectly still.
 */
function sameDisplay(a: DisplayEntry, b: DisplayEntry): boolean {
  return (
    a.placeholder === b.placeholder &&
    a.text === b.text &&
    a.intent === b.intent
  );
}

/**
 * The dwell queue: `target` is what the store wants shown; `current`
 * is what the strip shows. A swap happens immediately when the
 * current line has dwelt long enough (or the target is the user-clear
 * placeholder); otherwise the newest target waits out the remainder.
 * A swap that changes the VISIBLE line parks the previous entry in
 * `outgoing` for the cross-fade; a swap to identical text updates the key
 * silently (no fade); the animation effect settles the outgoing back to null.
 */
function useDwellDisplay(target: DisplayEntry): {
  current: DisplayEntry;
  outgoing: DisplayEntry | null;
  settleOutgoing: (entry: DisplayEntry) => void;
} {
  const [current, setCurrent] = useState<DisplayEntry>(target);
  const [outgoing, setOutgoing] = useState<DisplayEntry | null>(null);
  const currentKeyRef = useRef(target.key);
  const lastSwapAtRef = useRef(0);
  const pendingRef = useRef<DisplayEntry | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    currentKeyRef.current = current.key;
  }, [current.key]);

  const swap = useCallback((next: DisplayEntry): void => {
    setCurrent((prev) => {
      if (prev.key === next.key) return prev;
      // Only stage a cross-fade when the VISIBLE line differs. A new beat
      // that renders the same text (or an unchanged retained intent) updates
      // the key in place — no outgoing layer, no animation, nothing to see.
      if (!sameDisplay(prev, next)) setOutgoing(prev);
      return next;
    });
    lastSwapAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (target.key === currentKeyRef.current) {
      pendingRef.current = null;
      return;
    }
    // The user's own clear (submit → placeholder) feels immediate;
    // dwell only paces the machine's stream.
    if (target.placeholder) {
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

  const settleOutgoing = useCallback((entry: DisplayEntry): void => {
    setOutgoing((live) => (live === entry ? null : live));
  }, []);

  return { current, outgoing, settleOutgoing };
}

export function DevPulseStrip({
  codeSessionStore,
  focusGroup,
  focusOrder,
}: {
  codeSessionStore: CodeSessionStore;
  /**
   * Author the PULSE label into a focus group ([P10] revised) — when set, the
   * label registers as a **leaf** cycle stop (its own Tab stop, like the Z2
   * status cells; no arrow-roving), and Space/Enter open the recent-pulses
   * popover natively. Supplied by the dev card, which owns the Tab order;
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
  // Lines cleared by this card's last submit stay hidden; the next
  // turn's voice repopulates the strip.
  const latest = latestLineForScope(
    pulse.lines,
    tugSessionId,
    pulse.cleared.get(tugSessionId),
  );
  const target: DisplayEntry =
    latest !== null
      ? {
          key: latest.key,
          text: latest.text,
          ...(latest.intent !== undefined ? { intent: latest.intent } : {}),
          placeholder: false,
        }
      : NONE_ENTRY;
  const { current, outgoing, settleOutgoing } = useDwellDisplay(target);

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
  // The compact line stays a single muted hue — no dominant-channel tint.
  // Color-by-channel is legible only where the label sits beside the line
  // (the expanded Pulse card); on this word-sized strip a shifting color has
  // no legend, so it reads as noise. The expansion carries the color story.

  const currentElRef = useRef<HTMLSpanElement | null>(null);
  const outgoingElRef = useRef<HTMLSpanElement | null>(null);

  // The cross-fade TO the incoming: the new line rises to full opacity ON TOP
  // of the parked outgoing, which holds still underneath — there is NO
  // fade-out ([L06] — WAAPI on DOM, never React state). Because the outgoing
  // stays put, an unchanged line (were one ever staged) would show no motion;
  // in practice `swap` already suppresses identical lines, so a staged
  // outgoing always differs and the new line develops in over the old. The
  // outgoing settles out once the incoming is fully opaque.
  useLayoutEffect(() => {
    if (outgoing === null) return;
    const currentEl = currentElRef.current;
    if (currentEl === null) {
      settleOutgoing(outgoing);
      return;
    }
    const fade = animate(currentEl, [{ opacity: 0 }, { opacity: 1 }], {
      duration: XFADE_MS,
      easing: "ease",
      key: "dev-pulse-xfade-in",
    });
    fade.finished
      .then(() => settleOutgoing(outgoing))
      .catch(() => settleOutgoing(outgoing));
  }, [outgoing, settleOutgoing]);

  // The last few pulses for this card's session — shown in the legend popover.
  const history = linesForScope(pulse.lines, tugSessionId, PULSE_HISTORY_COUNT);

  // Right-click → Copy the current line's raw text (not the placeholder),
  // intent included so the copy carries the whole two-level reading.
  const copyLine = useCopyableButton(
    current.placeholder ? "" : composeLineCopy(current.intent, current.text),
  );

  if (!pulse.enabled) return null;
  return (
    <div className="dev-pulse-strip" data-slot="dev-pulse-strip">
      {/*
        dismissOnChainActivity=false: a row's right-click → Copy dispatches the
        `copy` action through the responder chain, which would otherwise read as
        foreign chain activity and close this popover mid-copy. The copy
        originates from WITHIN the popover, so it must not dismiss it; Escape,
        click-outside, Space, and the trigger toggle still close it.
      */}
      <TugPopover dismissOnChainActivity={false}>
        <TugPopoverTrigger>
          <button
            type="button"
            className="dev-pulse-strip-legend"
            data-slot="dev-pulse-legend"
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
          <DevPulseHistory lines={history} />
        </TugPopoverContent>
      </TugPopover>
      <span
        ref={copyLine.ref as React.Ref<HTMLSpanElement>}
        onContextMenu={copyLine.onContextMenu}
        className="dev-pulse-strip-stage"
      >
        <PulseLineText
          spanRef={currentElRef}
          entry={current}
          className={
            current.placeholder
              ? "dev-pulse-strip-text dev-pulse-strip-placeholder"
              : "dev-pulse-strip-text"
          }
        />
        {outgoing !== null ? (
          <PulseLineText
            spanRef={outgoingElRef}
            entry={outgoing}
            className={
              outgoing.placeholder
                ? "dev-pulse-strip-text dev-pulse-strip-outgoing dev-pulse-strip-placeholder"
                : "dev-pulse-strip-text dev-pulse-strip-outgoing"
            }
            ariaHidden
          />
        ) : null}
      </span>
      {/*
        The compact sparkline is the entry point to the expanded Activity
        card ([P12] Surface): clicking it opens a popover of per-channel
        small-multiples for this session. The trigger mirrors the legend
        button's focus discipline (leaf, never steals card focus).
      */}
      <TugPopover>
        <TugPopoverTrigger>
          <button
            type="button"
            className="dev-pulse-strip-spark-trigger"
            tabIndex={-1}
            data-tug-focus="refuse"
            data-no-activate=""
            aria-label="Session pulse detail"
          >
            <TugSparkline
              getSeries={getSeries}
              binMs={ACTIVITY_BIN_MS}
              fullScale={SPARKLINE_FULL_SCALE_CHARS}
              curve={SPARKLINE_CURVE}
              width={64}
              height={22}
              className="dev-pulse-strip-spark"
              title="Session activity — text, tokens, tools, and subagents"
            />
          </button>
        </TugPopoverTrigger>
        <TugPopoverContent side="top" align="end" sideOffset={8} arrow>
          <DevPulseCard session={tugSessionId} />
        </TugPopoverContent>
      </TugPopover>
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
function DevPulseHistory({
  lines,
}: {
  lines: readonly PulseLineEntry[];
}): React.ReactElement {
  const groups = React.useMemo(() => groupPulseHistory(lines), [lines]);
  return (
    <TugPopupListFrame
      title="Recent pulses"
      kind="item"
      className="dev-pulse-history"
      data-slot="dev-pulse-history"
    >
      {groups.length === 0 ? (
        <TugPopupListEmpty>No pulses yet.</TugPopupListEmpty>
      ) : (
        <TugPopupListScroller data-slot="dev-pulse-history-body">
          {groups.map((group) => (
            <div className="dev-pulse-history-group" key={group.beats[0].key}>
              {group.intent !== undefined ? (
                <DevPulseHistoryIntent intent={group.intent} />
              ) : null}
              {group.beats.map((beat) => (
                <DevPulseHistoryBeat
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
function DevPulseHistoryIntent({
  intent,
}: {
  intent: string;
}): React.ReactElement {
  const render = React.useMemo(() => renderPulseLine(intent), [intent]);
  return (
    <div className="dev-pulse-history-intent">
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
function DevPulseHistoryBeat({
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
      className="dev-pulse-history-beat"
      indicator={<TugPopupListToneDot tone="default" />}
    >
      <TugPopupListItemText primary={primary} />
      {copy.contextMenu}
    </TugPopupListItem>
  );
}

/** Raw-text form of a line for the clipboard: "intent › text". */
function composeLineCopy(intent: string | undefined, text: string): string {
  return intent !== undefined ? `${intent} › ${text}` : text;
}

/**
 * One rendered line layer. The pulse-line library owns fidelity and
 * safety (math-first split, sanitized markdown, KaTeX, total-function
 * fallback); this component only re-renders once a lazy KaTeX load
 * resolves, then every render is synchronous. `html: ""` is the
 * library's render-as-plain-text signal. An entry carrying an `intent`
 * renders two levels — the retained thought muted, then a bullet, then
 * the live beat.
 */
function PulseLineText({
  entry,
  className,
  spanRef,
  ariaHidden,
}: {
  entry: DisplayEntry;
  className: string;
  spanRef: React.MutableRefObject<HTMLSpanElement | null>;
  ariaHidden?: boolean;
}): React.ReactElement {
  const [engineEpoch, bumpEngineReady] = React.useReducer(
    (n: number) => n + 1,
    0,
  );
  // engineEpoch keys the memo so the resolved KaTeX engine re-renders
  // the SAME entry with real typesetting (the first pass showed the
  // escaped source while the engine loaded).
  const render = React.useMemo(
    () =>
      entry.placeholder
        ? null
        : {
            text: renderPulseLine(entry.text),
            intent:
              entry.intent !== undefined ? renderPulseLine(entry.intent) : null,
          },
    [entry, engineEpoch],
  );
  React.useEffect(() => {
    const pendings = [render?.text.pending, render?.intent?.pending].filter(
      (p): p is Promise<void> => p != null,
    );
    if (pendings.length === 0) return;
    let live = true;
    void Promise.all(pendings).then(() => {
      if (live) bumpEngineReady();
    });
    return () => {
      live = false;
    };
  }, [render]);
  if (render === null) {
    return (
      <span ref={spanRef} className={className} aria-hidden={ariaHidden}>
        {entry.text}
      </span>
    );
  }
  const textNode =
    render.text.html.length === 0 ? (
      <>{entry.text}</>
    ) : (
      <span dangerouslySetInnerHTML={{ __html: render.text.html }} />
    );
  if (entry.intent === undefined) {
    return (
      <span ref={spanRef} className={className} aria-hidden={ariaHidden}>
        {textNode}
      </span>
    );
  }
  const intentNode =
    render.intent === null || render.intent.html.length === 0 ? (
      <>{entry.intent}</>
    ) : (
      <span dangerouslySetInnerHTML={{ __html: render.intent.html }} />
    );
  // Two levels on one line: the retained goal (muted context) leads
  // into the live beat (bright, primary). The beat is layout-pinned and
  // the intent ellipsizes first, so the thing happening NOW is never the
  // part that gets cut. `›` reads as "drilling into detail".
  return (
    <span ref={spanRef} className={className} aria-hidden={ariaHidden}>
      <span className="dev-pulse-line dev-pulse-line--twolevel">
        <span className="dev-pulse-intent">{intentNode}</span>
        <span className="dev-pulse-intent-sep" aria-hidden="true">
          ›
        </span>
        <span className="dev-pulse-beat">{textNode}</span>
      </span>
    </span>
  );
}
