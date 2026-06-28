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
 *  - a dimmed `None` placeholder before the session's first line;
 *  - a HEAT RAMP: while a turn is in flight the legend and a running
 *    clock warm from calm through yellow → red the longer it runs
 *    (Claude Code's yellow→red status shading) — liveliness even when
 *    no new line is streaming. A single interval writes the elapsed
 *    text and `data-heat` straight to the DOM; idle clears both.
 *
 * Laws: [L02] every store read via `useSyncExternalStore` (`usePulse`,
 *       the session-id / `canInterrupt` / `submitAt` selectors below);
 *       [L06] the cross-fade runs through TugAnimator (WAAPI on DOM
 *       refs) — opacity never passes through React state; the heat
 *       ramp likewise writes `data-heat` + the elapsed clock straight
 *       to the DOM (no per-tick re-render); the dwell queue is local
 *       presentation data (`useState`/`useRef`), which changes WHAT
 *       text exists, not how it looks;
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
import { renderPulseLine } from "@/lib/pulse-line/render-pulse-line";
import { latestLineForScope, usePulse } from "@/lib/pulse-store";
import type { CodeSessionStore } from "@/lib/code-session-store";

/** Every line holds the strip at least this long before the next. */
export const MIN_DWELL_MS = 1_800;
/** Cross-fade length (raw ms; TugAnimator scales by the timing dial). */
export const XFADE_MS = 600;

/**
 * Elapsed-seconds thresholds for the heat ramp: a turn warms from calm
 * (bucket 0) through yellow → orange → coral → red as it runs longer, the
 * way Claude Code's terminal status line shades from yellow toward red. The
 * bucket count is the heat attribute; the CSS maps each to a tint.
 */
const HEAT_THRESHOLDS_S = [10, 30, 60, 120] as const;

/** Map elapsed seconds to a heat bucket (0 = calm … 4 = hottest). */
function heatBucket(seconds: number): number {
  let bucket = 0;
  for (const threshold of HEAT_THRESHOLDS_S) {
    if (seconds >= threshold) bucket += 1;
    else break;
  }
  return bucket;
}

/** Terse running clock: "12s" under a minute, "1m05s" beyond. */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${String(s).padStart(2, "0")}s`;
}

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
}: {
  codeSessionStore: CodeSessionStore;
}): React.ReactElement | null {
  const pulse = usePulse();
  // The card's bound session id — the strip's scope filter. Read
  // through the store per [L02]; empty until a session binds.
  const tugSessionId = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(
      () => codeSessionStore.getSnapshot().tugSessionId,
      [codeSessionStore],
    ),
  );
  // The heat ramp's inputs: whether a turn is in flight (`canInterrupt` is
  // the store's turn-in-flight predicate) and when it started. Both are
  // primitives, so the snapshot stays `Object.is`-stable per [L02]; the
  // per-second ramp itself never flows through React state ([L06]).
  const busy = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(
      () => codeSessionStore.getSnapshot().canInterrupt,
      [codeSessionStore],
    ),
  );
  const turnStartedAt = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(
      () => codeSessionStore.getSnapshot().activeTurn?.submitAt ?? 0,
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

  const currentElRef = useRef<HTMLSpanElement | null>(null);
  const outgoingElRef = useRef<HTMLSpanElement | null>(null);
  const stripElRef = useRef<HTMLDivElement | null>(null);
  const elapsedElRef = useRef<HTMLSpanElement | null>(null);

  // The heat ramp + running clock. One interval, alive only while a turn is.
  // It writes the `data-heat` attribute (CSS maps it to a tint) and the
  // elapsed readout's text DIRECTLY to the DOM — appearance and high-churn
  // content never round-trip through React state ([L06]). The effect re-arms
  // when the turn flips or restarts; teardown clears the clock.
  useEffect(() => {
    const strip = stripElRef.current;
    if (strip === null) return;
    if (!busy || turnStartedAt <= 0) {
      strip.dataset.heat = "0";
      if (elapsedElRef.current !== null) elapsedElRef.current.textContent = "";
      return;
    }
    const tick = (): void => {
      const seconds = Math.max(0, Math.floor((Date.now() - turnStartedAt) / 1000));
      strip.dataset.heat = String(heatBucket(seconds));
      if (elapsedElRef.current !== null) {
        elapsedElRef.current.textContent = formatElapsed(seconds);
      }
    };
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => {
      window.clearInterval(id);
    };
  }, [busy, turnStartedAt]);

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

  if (!pulse.enabled) return null;
  return (
    <div
      className="dev-pulse-strip"
      data-slot="dev-pulse-strip"
      data-heat="0"
      ref={stripElRef}
    >
      <span className="dev-pulse-strip-legend">PULSE</span>
      <span className="dev-pulse-strip-stage">
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
      <span
        className="dev-pulse-strip-elapsed"
        ref={elapsedElRef}
        aria-hidden
      />
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
