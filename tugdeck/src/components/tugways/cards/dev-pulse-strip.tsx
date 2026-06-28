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
 *  - replacements CROSS-FADE via TugAnimator (the outgoing line fades
 *    out over the incoming line fading in);
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
import { TugSparkline } from "@/components/tugways/tug-sparkline";
import {
  TugPopover,
  TugPopoverContent,
  TugPopoverTrigger,
} from "@/components/tugways/tug-popover";
import { useFocusable } from "@/components/tugways/use-focusable";
import { useCopyableButton } from "@/components/tugways/use-copyable-text";
import { renderPulseLine } from "@/lib/pulse-line/render-pulse-line";
import {
  latestLineForScope,
  linesForScope,
  usePulse,
  type PulseLineEntry,
} from "@/lib/pulse-store";
import { THROUGHPUT_BIN_MS } from "@/lib/throughput-meter";
import type { CodeSessionStore } from "@/lib/code-session-store";

/** How many recent pulses the PULSE-label popover lists. */
const PULSE_HISTORY_COUNT = 8;

/** Every line holds the strip at least this long before the next. */
export const MIN_DWELL_MS = 1_800;
/** Cross-fade length (raw ms; TugAnimator scales by the timing dial). */
export const XFADE_MS = 600;
/**
 * Sparkline full-scale, in streamed chars per 1s bin. Fixed (no autoscale) so
 * the line never rescales vertically: ~75 tok/s ≈ 300 chars/s of output reads
 * near full height, faster bursts clamp at the top, lulls read low.
 */
const SPARKLINE_FULL_SCALE_CHARS = 300;

/** What the strip is showing: a pulse line or the placeholder. */
interface DisplayEntry {
  key: string;
  text: string;
  placeholder: boolean;
}

const NONE_ENTRY: DisplayEntry = Object.freeze({
  key: "__pulse_none__",
  text: "None",
  placeholder: true,
});

/**
 * The dwell queue: `target` is what the store wants shown; `current`
 * is what the strip shows. A swap happens immediately when the
 * current line has dwelt long enough (or the target is the user-clear
 * placeholder); otherwise the newest target waits out the remainder.
 * Each swap parks the previous entry in `outgoing` for the
 * cross-fade; the animation effect settles it back to null.
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
      setOutgoing(prev);
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
      ? { key: latest.key, text: latest.text, placeholder: false }
      : NONE_ENTRY;
  const { current, outgoing, settleOutgoing } = useDwellDisplay(target);

  // Live output-velocity feed for the sparkline. The meter is a stable store
  // field (NOT snapshot state): the sparkline samples it imperatively, off
  // React's render path; the scroll itself is WAAPI ([L06]/[L13]).
  const meter = codeSessionStore.throughputMeter;
  const getSeries = useCallback((nowMs: number) => meter.series(nowMs), [meter]);

  const currentElRef = useRef<HTMLSpanElement | null>(null);
  const outgoingElRef = useRef<HTMLSpanElement | null>(null);

  // The cross-fade: incoming rises to full opacity while the parked
  // outgoing layer fades away, both through TugAnimator ([L06] —
  // WAAPI on DOM, never React state). Named slots cancel cleanly when
  // swaps outpace the fade.
  useLayoutEffect(() => {
    if (outgoing === null) return;
    const currentEl = currentElRef.current;
    const outgoingEl = outgoingElRef.current;
    if (currentEl !== null) {
      animate(currentEl, [{ opacity: 0 }, { opacity: 1 }], {
        duration: XFADE_MS,
        easing: "ease",
        key: "dev-pulse-xfade-in",
      });
    }
    if (outgoingEl === null) {
      settleOutgoing(outgoing);
      return;
    }
    const fade = animate(outgoingEl, [{ opacity: 1 }, { opacity: 0 }], {
      duration: XFADE_MS,
      easing: "ease",
      key: "dev-pulse-xfade-out",
    });
    fade.finished
      .then(() => settleOutgoing(outgoing))
      .catch(() => settleOutgoing(outgoing));
  }, [outgoing, settleOutgoing]);

  // The last few pulses for this card's session — shown in the legend popover.
  const history = linesForScope(pulse.lines, tugSessionId, PULSE_HISTORY_COUNT);

  // Right-click → Copy the current line's raw text (not the placeholder).
  const copyLine = useCopyableButton(current.placeholder ? "" : current.text);

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
      <TugSparkline
        getSeries={getSeries}
        binMs={THROUGHPUT_BIN_MS}
        fullScale={SPARKLINE_FULL_SCALE_CHARS}
        width={64}
        height={22}
        className="dev-pulse-strip-spark"
        title="Output throughput in characters streamed per second"
      />
      {copyLine.contextMenu}
    </div>
  );
}

/**
 * The PULSE-label popover body: the last few pulses for this session, newest
 * first, each rendered through the same markdown/LaTeX pipeline as the strip.
 * An empty history reads as a quiet placeholder.
 */
function DevPulseHistory({
  lines,
}: {
  lines: readonly PulseLineEntry[];
}): React.ReactElement {
  return (
    <div className="dev-pulse-history" data-slot="dev-pulse-history">
      <div className="dev-pulse-history-title">Recent pulses</div>
      {lines.length === 0 ? (
        <div className="dev-pulse-history-empty">None yet</div>
      ) : (
        lines.map((line) => (
          <DevPulseHistoryRow key={line.key} text={line.text} />
        ))
      )}
    </div>
  );
}

function DevPulseHistoryRow({ text }: { text: string }): React.ReactElement {
  const render = React.useMemo(() => renderPulseLine(text), [text]);
  // Right-click → Copy this row's raw pulse text.
  const copy = useCopyableButton(text);
  const body =
    render === null || render.html.length === 0 ? (
      <span className="dev-pulse-history-text">{text}</span>
    ) : (
      <span
        className="dev-pulse-history-text"
        dangerouslySetInnerHTML={{ __html: render.html }}
      />
    );
  return (
    <div
      ref={copy.ref as React.Ref<HTMLDivElement>}
      onContextMenu={copy.onContextMenu}
      className="dev-pulse-history-row"
    >
      <span className="dev-pulse-history-bullet" aria-hidden="true">
        •
      </span>
      {body}
      {copy.contextMenu}
    </div>
  );
}

/**
 * One rendered line layer. The pulse-line library owns fidelity and
 * safety (math-first split, sanitized markdown, KaTeX, total-function
 * fallback); this component only re-renders once a lazy KaTeX load
 * resolves, then every render is synchronous. `html: ""` is the
 * library's render-as-plain-text signal.
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
    () => (entry.placeholder ? null : renderPulseLine(entry.text)),
    [entry, engineEpoch],
  );
  React.useEffect(() => {
    if (render?.pending == null) return;
    let live = true;
    void render.pending.then(() => {
      if (live) bumpEngineReady();
    });
    return () => {
      live = false;
    };
  }, [render]);
  if (render === null || render.html.length === 0) {
    return (
      <span ref={spanRef} className={className} aria-hidden={ariaHidden}>
        {entry.text}
      </span>
    );
  }
  return (
    <span
      ref={spanRef}
      className={className}
      aria-hidden={ariaHidden}
      dangerouslySetInnerHTML={{ __html: render.html }}
    />
  );
}
