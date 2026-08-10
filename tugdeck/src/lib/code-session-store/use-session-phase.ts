/**
 * use-session-phase.ts — the session-keyed liveness door.
 *
 * Identity is keyed by session and liveness is keyed by card: phase lives on a
 * per-*card* `codeSessionStore`, and the join between the two has to happen
 * somewhere. Doing it once, here, is what lets a surface holding nothing but a
 * session id — a citation chip, a picker row for a session with no card at all —
 * show a live dot.
 *
 * **It returns the flattened phase KEY, not the snapshot.** That is the whole
 * reason the hook is safe on identity surfaces. The snapshot is the entire
 * session state and wakes on every transcript event; a hook handing it back
 * would re-render every chip in the app on every token. A short string means
 * React bails out of the re-render unless the *reading* actually changed, which
 * is what keeps a Changes card with a citation per row affordable.
 *
 * **Doubt reads idle, never danger.** A session whose live state cannot be
 * reached — no bound card, services not yet constructed, a closed or external
 * row — answers `"idle"`. Red is the error channel, and spending it on "we do
 * not know" would make every ordinary closed session look broken. A card that
 * exists and whose transport is genuinely offline still reads danger; that is a
 * real failure rather than doubt.
 *
 * Liveness stays OUT of the identity record: two subscriptions, two keys,
 * meeting in the component that mounts them both.
 *
 * Laws: [L02] every store read enters through `useSyncExternalStore`.
 *
 * @module lib/code-session-store/use-session-phase
 */

import { useSyncExternalStore } from "react";

import {
  cardIdForSession,
  useCardIdForSession,
} from "@/lib/card-session-binding-store";
import { cardServicesStore } from "@/lib/card-services-store";
import { countRunningJobs } from "@/lib/code-session-store/select-jobs";
import {
  sessionSessionPhaseKey,
  type SessionPhaseKey,
} from "@/lib/code-session-store/session-phase-visual";
import type { CodeSessionSnapshot } from "@/lib/code-session-store/types";

/** Stable no-op subscribe for a session with no reachable session store. */
const NOOP_SUBSCRIBE = (): (() => void) => () => {};

/**
 * The five snapshot fields the phase reading is made of — named as a type so the
 * fold below states its whole appetite, and a caller cannot mistake it for
 * something that reads the transcript.
 */
export type SessionPhaseSource = Pick<
  CodeSessionSnapshot,
  "phase" | "transportState" | "interruptInFlight" | "jobs" | "pendingAsk"
>;

/**
 * The pure fold: a session store's snapshot, or `null` for a session whose live
 * state could not be reached, onto one phase key.
 *
 * Separate from the hook so the doubt rule is a unit test rather than a claim —
 * the store walk above it only exists in a running app, but "no snapshot reads
 * idle" is the decision, and it is checkable here.
 */
export function sessionPhaseFromSnapshot(
  snap: SessionPhaseSource | null,
): SessionPhaseKey {
  if (snap === null) return "idle";
  return sessionSessionPhaseKey({
    phase: snap.phase,
    transportState: snap.transportState,
    interruptInFlight: snap.interruptInFlight,
    runningJobCount: countRunningJobs(snap.jobs),
    // A session waiting on an answer reads Awaiting from a list too — that row
    // is how a card the user isn't looking at says it needs them.
    pendingAsk: snap.pendingAsk !== null,
  });
}

/**
 * The phase key for a session **as a snapshot, with no subscription** — the
 * same walk the hook makes, read once.
 *
 * Non-React callers only, and there is one: the editor's atom chip is a Canvas
 * bake, so a pasted session atom's dot is the phase at paste time and cannot be
 * anything else ([P14]). Every component uses {@link useSessionPhase}.
 */
export function sessionPhaseNow(sessionId: string): SessionPhaseKey {
  const cardId = cardIdForSession(sessionId);
  const services = cardId === null ? null : cardServicesStore.getServices(cardId);
  return sessionPhaseFromSnapshot(services?.codeSessionStore?.getSnapshot() ?? null);
}

/**
 * The phase key for a session, live.
 *
 * Always called — hook rules forbid a conditional call — and answers `"idle"`
 * whenever there is nothing to read. See the module header for why that is the
 * honest answer rather than a placeholder.
 */
export function useSessionPhase(sessionId: string): SessionPhaseKey {
  const cardId = useCardIdForSession(sessionId);
  const services = useSyncExternalStore(cardServicesStore.subscribe, () =>
    cardId === null ? null : cardServicesStore.getServices(cardId),
  );
  const store = services?.codeSessionStore ?? null;
  const snap = useSyncExternalStore(
    store?.subscribe ?? NOOP_SUBSCRIBE,
    store !== null ? store.getSnapshot : () => null,
    () => null,
  );
  return sessionPhaseFromSnapshot(snap);
}
