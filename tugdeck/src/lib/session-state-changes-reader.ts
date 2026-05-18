/**
 * Reader API for the persisted `session_state_changes` ledger.
 *
 * Loads the full triple-transition history for a `tugSessionId` by
 * sending a `list_session_state_changes` CONTROL request and awaiting
 * the matching `list_session_state_changes_ok` (or `_err`) response.
 * Correlation is by `tug_session_id` echoed verbatim from the request.
 *
 * The popover (Step 20.4.9) is the intended consumer; an empty array
 * is a valid result and should render as "no history yet". The plan
 * step's coverage-and-collapses note enumerates the signals this
 * ledger intentionally does NOT capture — callers are expected to
 * surface only what the indicator-tone triple represents.
 *
 * **Laws**: read enters React through `useSyncExternalStore` only.
 * This module exposes the Promise primitive; Step 20.4.9 builds the
 * external-store wrapper on top of it.
 */

import type { TugConnection } from "@/connection";
import {
  encodeListSessionStateChanges,
  type SessionStateChangeWireRow,
} from "@/protocol";
import {
  subscribeToListSessionStateChangesErr,
  subscribeToListSessionStateChangesOk,
} from "@/lib/tide-session-ledger-events";
import type {
  CodeSessionPhase,
  TransportState,
} from "@/lib/code-session-store/types";

/**
 * One row of the persisted state-change history — the decoded shape
 * the popover renders. `atMs` is camelCased from the wire's `at_ms`;
 * `interruptInFlight` is camelCased from `interrupt_in_flight`.
 */
export interface SessionStateChangeRow {
  atMs: number;
  phase: CodeSessionPhase;
  transportState: TransportState;
  interruptInFlight: boolean;
}

export type LoadSessionStateChangesResult =
  | { ok: true; rows: readonly SessionStateChangeRow[] }
  | { ok: false; reason: string };

/**
 * Send a `list_session_state_changes` request and resolve with the
 * decoded rows (or an error result).
 *
 * The promise resolves as soon as either an `ok` or `err` response
 * for the same `tugSessionId` arrives on the CONTROL bus. Concurrent
 * calls for different sessions are independent; concurrent calls for
 * the SAME session all settle to the same result (whichever response
 * arrives first satisfies them all).
 *
 * No explicit timeout — the supervisor responds to every well-formed
 * request, and the bus is process-local. If a caller wants a timeout
 * it can race the returned promise against its own deadline.
 */
export function loadSessionStateChanges(
  conn: TugConnection,
  tugSessionId: string,
): Promise<LoadSessionStateChangesResult> {
  return new Promise<LoadSessionStateChangesResult>((resolve) => {
    let settled = false;
    const settle = (result: LoadSessionStateChangesResult) => {
      if (settled) return;
      settled = true;
      unsubscribeOk();
      unsubscribeErr();
      resolve(result);
    };
    const unsubscribeOk = subscribeToListSessionStateChangesOk((payload) => {
      if (payload.tug_session_id !== tugSessionId) return;
      const rows: SessionStateChangeRow[] = payload.rows.map(
        decodeWireRow,
      );
      settle({ ok: true, rows: Object.freeze(rows) });
    });
    const unsubscribeErr = subscribeToListSessionStateChangesErr((payload) => {
      if (payload.tug_session_id !== tugSessionId) return;
      settle({ ok: false, reason: payload.reason });
    });
    const frame = encodeListSessionStateChanges(tugSessionId);
    conn.send(frame.feedId, frame.payload);
  });
}

function decodeWireRow(wire: SessionStateChangeWireRow): SessionStateChangeRow {
  return {
    atMs: wire.at_ms,
    phase: wire.phase,
    transportState: wire.transport_state,
    interruptInFlight: wire.interrupt_in_flight,
  };
}
