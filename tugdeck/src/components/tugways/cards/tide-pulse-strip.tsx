/**
 * TidePulseStrip — the production Z2 PULSE strip: one ambient line of
 * color commentary beneath the dev card's status row, fed by the
 * app-scoped {@link PulseStore} and FILTERED TO THIS CARD'S SESSION.
 *
 * One commentator narrates the whole app (the pulse architecture's
 * cost story and what makes cross-session lines possible), but each
 * card's strip shows only lines about its own session — a new session
 * must never wear another session's commentary. A line covering
 * several scopes shows on every card it covers; `"app"`-scoped lines
 * are ambience for every card.
 *
 * Behavior (Spec S03 of the pulse design, amended per-card):
 *  - hidden entirely while the `pulse/enabled` tugbank default is off
 *    (the snapshot carries the toggle);
 *  - fixed single-line height once shown — a new line never moves
 *    layout;
 *  - shows the newest OWN-SCOPE line with a fade-in keyed on line
 *    identity;
 *  - a dimmed `None` placeholder before the session's first line.
 *
 * Laws: [L02] both stores via `useSyncExternalStore` (`usePulse` and
 *       the session-id selector below);
 *       [L06] the fade is a CSS animation keyed on line identity —
 *       no React state anywhere in this component;
 *       [L19] `.tsx`/`.css` pair, `data-slot="tide-pulse-strip"`;
 *       [L26] mounted whenever enabled; only the text node changes.
 *
 * @module components/tugways/cards/tide-pulse-strip
 */

import "./tide-pulse-strip.css";

import React, { useCallback, useSyncExternalStore } from "react";

import { latestLineForScope, usePulse } from "@/lib/pulse-store";
import type { CodeSessionStore } from "@/lib/code-session-store";

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
  if (!pulse.enabled) return null;
  const latest = latestLineForScope(pulse.lines, tugSessionId);
  return (
    <div className="tide-pulse-strip" data-slot="tide-pulse-strip">
      <span className="tide-pulse-strip-legend">PULSE</span>
      {latest !== null ? (
        <span key={latest.key} className="tide-pulse-strip-text">
          {latest.text}
        </span>
      ) : (
        <span className="tide-pulse-strip-text tide-pulse-strip-placeholder">
          None
        </span>
      )}
    </div>
  );
}
