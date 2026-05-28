/**
 * Local pub/sub bus for `session_state_changes` triple transitions.
 *
 * Fired by `CodeSessionStore`'s `maybePersistStateChange` whenever the
 * indicator-tone triple changes — same site as the wire write to the
 * supervisor. Subscribers (the popover's external-store wrapper) read
 * the published rows to append live updates without waiting for a
 * server round-trip.
 *
 * Why a local bus instead of round-tripping every change through the
 * supervisor and back: the persist path is fire-and-forget and the
 * supervisor doesn't broadcast a "row appended" frame; even if it
 * did, the popover would render the latency. The dispatch wrapper
 * already knows the new triple at the moment it writes it — emitting
 * it locally is strictly less work and avoids the round-trip
 * altogether. The persisted row that arrives later via
 * `loadSessionStateChanges` carries the same triple; the popover's
 * external store dedupes overlap on a follow-up reader load.
 *
 * Process-global like `dev-session-ledger-events`. The store is the
 * intended subscriber in production; tests register their own
 * listeners.
 */

import type {
  CodeSessionPhase,
  TransportState,
} from "@/lib/code-session-store/types";

/**
 * One locally-published triple transition. Mirrors
 * `SessionStateChangeRow` from `session-state-changes-reader` — the
 * popover treats both sources interchangeably.
 */
export interface LocalSessionStateChange {
  tugSessionId: string;
  atMs: number;
  phase: CodeSessionPhase;
  transportState: TransportState;
  interruptInFlight: boolean;
}

type Listener = (event: LocalSessionStateChange) => void;

const listeners = new Set<Listener>();

export function publishLocalSessionStateChange(
  event: LocalSessionStateChange,
): void {
  // Snapshot to allow unsubscription during dispatch without skipping
  // siblings. Listeners are expected to be fast and side-effect-free
  // (the store's listener appends to its in-memory cache + emits a
  // tick).
  for (const listener of [...listeners]) {
    listener(event);
  }
}

export function subscribeToLocalSessionStateChange(
  listener: Listener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: remove every subscriber. */
export function _resetLocalSessionStateChangeForTest(): void {
  listeners.clear();
}
