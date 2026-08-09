/**
 * SessionPhaseDot — a session's liveness, as a leaf subscription.
 *
 * Liveness is not identity, and this component is where that decision becomes
 * structure. The identity record carries no phase field: phase lives on a
 * per-*card* `codeSessionStore` whose snapshot is the whole session state, and
 * a resolver that subscribed to that snapshot would wake every chip, line, row,
 * and masthead in the app on every transcript event.
 *
 * So the dot is its own leaf, composed INTO a row, a chip, or a masthead as a
 * child. A reducer wake repaints the dot and nothing else. Identity and liveness
 * are two subscriptions with two keys, and the component that mounts them both
 * is where they meet.
 *
 * Keyed by **session**, not by card: the dot is the session's mark on every
 * surface that names one, and most of those surfaces hold only a session id.
 * {@link useSessionPhase} owns the session → card → services → snapshot walk and
 * answers `idle` for a session whose live state cannot be reached, so a closed
 * or external row gets a quiet dot rather than no dot or a red one.
 *
 * Laws: [L02] the phase enters through `useSyncExternalStore` (inside the hook);
 *       [L06] the pulse is CSS on an engine attribute, never React state;
 *       [L13] motion is the indicator's.
 */

import React from "react";

import { dotDriftFor } from "@/components/tugways/internal/tug-progress-pulsing-dot";
import {
  TugProgressIndicator,
  type TugProgressIndicatorPhaseVisual,
} from "@/components/tugways/tug-progress-indicator";
import { sessionSessionPhaseVisual } from "@/lib/code-session-store/session-phase-visual";
import { useSessionPhase } from "@/lib/code-session-store/use-session-phase";

const PHASE_VISUAL: (key: string) => TugProgressIndicatorPhaseVisual =
  sessionSessionPhaseVisual;

export interface SessionPhaseDotProps {
  /** The session whose liveness this dot reads. */
  sessionId: string;
  /** The dot's box, in px. A caller choice — the row declares its own. */
  size: number;
  /**
   * Whether the dot's period is jittered. On in a LIST of separate sessions,
   * each doing its own work: on one exact period a column of them reads as a
   * single mechanism with several heads, and a few percent of spread pulls
   * them apart over a dozen breaths. Off everywhere the dots belong to one
   * thing and must stay locked.
   * @default false
   */
  drift?: boolean;
}

export function SessionPhaseDot({
  sessionId,
  size,
  drift = false,
}: SessionPhaseDotProps): React.ReactElement {
  const phase = useSessionPhase(sessionId);
  return (
    <TugProgressIndicator
      variant="pulsing-dot"
      size={size}
      phase={phase}
      phaseVisual={PHASE_VISUAL}
      // Keyed on the session so it keeps its rate across a filter, a reorder, a
      // scroll out of view and back — and across a rebind onto another card.
      style={drift ? dotDriftFor(sessionId) : undefined}
      aria-hidden
    />
  );
}
