/**
 * TidePulseStrip — the production Z2 PULSE strip: the machine
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
 *       [L19] `.tsx`/`.css` pair, `data-slot="tide-pulse-strip"`;
 *       [L26] mounted whenever enabled; only the text layers change.
 *
 * @module components/tugways/cards/tide-pulse-strip
 */

import "./tide-pulse-strip.css";

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

export function TidePulseStrip({
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
        key: "tide-pulse-xfade-in",
      });
    }
    if (outgoingEl === null) {
      settleOutgoing(outgoing);
      return;
    }
    const fade = animate(outgoingEl, [{ opacity: 1 }, { opacity: 0 }], {
      duration: XFADE_MS,
      easing: "ease",
      key: "tide-pulse-xfade-out",
    });
    fade.finished
      .then(() => settleOutgoing(outgoing))
      .catch(() => settleOutgoing(outgoing));
  }, [outgoing, settleOutgoing]);

  if (!pulse.enabled) return null;
  return (
    <div className="tide-pulse-strip" data-slot="tide-pulse-strip">
      <span className="tide-pulse-strip-legend">PULSE</span>
      <span className="tide-pulse-strip-stage">
        <PulseLineText
          spanRef={currentElRef}
          entry={current}
          className={
            current.placeholder
              ? "tide-pulse-strip-text tide-pulse-strip-placeholder"
              : "tide-pulse-strip-text"
          }
        />
        {outgoing !== null ? (
          <PulseLineText
            spanRef={outgoingElRef}
            entry={outgoing}
            className={
              outgoing.placeholder
                ? "tide-pulse-strip-text tide-pulse-strip-outgoing tide-pulse-strip-placeholder"
                : "tide-pulse-strip-text tide-pulse-strip-outgoing"
            }
            ariaHidden
          />
        ) : null}
      </span>
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
