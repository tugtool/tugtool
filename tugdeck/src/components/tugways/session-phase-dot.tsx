/**
 * SessionPhaseDot — a session's liveness, as a leaf subscription.
 *
 * Liveness is not identity, and this component is where that decision becomes
 * structure. The identity record carries no phase field: phase lives on a
 * per-*card* `codeSessionStore` whose snapshot is the whole session state, and
 * a `sessionId`-keyed resolver cannot reach it — nor should it, because a
 * resolver that subscribed to that snapshot would wake every chip, line, row,
 * and masthead in the app on every transcript event.
 *
 * So the dot is its own leaf, keyed by `cardId`, composed INTO a row or a
 * masthead as a child. A reducer wake repaints the dot and nothing else.
 * Identity and liveness are two subscriptions with two keys, and the component
 * that mounts them both is where they meet.
 *
 * A session with no card — a closed or external row in the picker — gets no
 * dot at all, which is the honest rendering rather than an invented state.
 *
 * Laws: [L02] the card's services and its session store both enter through
 *       `useSyncExternalStore`; [L06] the pulse is CSS on an engine attribute,
 *       never React state; [L13] motion is the indicator's.
 */

import React, { useSyncExternalStore } from "react";

import { dotDriftFor } from "@/components/tugways/internal/tug-progress-pulsing-dot";
import {
  TugProgressIndicator,
  type TugProgressIndicatorPhaseVisual,
} from "@/components/tugways/tug-progress-indicator";
import { cardServicesStore } from "@/lib/card-services-store";
import { countRunningJobs } from "@/lib/code-session-store/select-jobs";
import {
  sessionSessionPhaseKey,
  sessionSessionPhaseVisual,
  type SessionPhaseInput,
} from "@/lib/code-session-store/session-phase-visual";

/** Quiet, offline-tinted phase input used until a card's services exist. */
const OFFLINE_PHASE_INPUT: SessionPhaseInput = {
  phase: "idle",
  transportState: "offline",
  interruptInFlight: false,
};

const PHASE_VISUAL: (key: string) => TugProgressIndicatorPhaseVisual =
  sessionSessionPhaseVisual;

/** Stable no-op subscribe for a card whose services aren't constructed yet. */
const NOOP_SUBSCRIBE = (): (() => void) => () => {};

export interface SessionPhaseDotProps {
  /** The card whose session store this dot reads. */
  cardId: string;
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
  cardId,
  size,
  drift = false,
}: SessionPhaseDotProps): React.ReactElement {
  const services = useSyncExternalStore(cardServicesStore.subscribe, () =>
    cardServicesStore.getServices(cardId),
  );
  const store = services?.codeSessionStore ?? null;
  const snap = useSyncExternalStore(
    store?.subscribe ?? NOOP_SUBSCRIBE,
    store !== null ? store.getSnapshot : () => null,
    () => null,
  );
  const input: SessionPhaseInput =
    snap !== null
      ? {
          phase: snap.phase,
          transportState: snap.transportState,
          interruptInFlight: snap.interruptInFlight,
          runningJobCount: countRunningJobs(snap.jobs),
          // A session waiting on an answer reads Awaiting from a list too —
          // that row is how a card the user isn't looking at says it needs
          // them.
          pendingAsk: snap.pendingAsk !== null,
        }
      : OFFLINE_PHASE_INPUT;
  return (
    <TugProgressIndicator
      variant="pulsing-dot"
      size={size}
      phase={sessionSessionPhaseKey(input)}
      phaseVisual={PHASE_VISUAL}
      // Keyed on the card so a session keeps its rate across a filter, a
      // reorder, or a scroll out of view and back.
      style={drift ? dotDriftFor(cardId) : undefined}
      aria-hidden
    />
  );
}
