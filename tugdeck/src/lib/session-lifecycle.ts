/**
 * session-lifecycle — thin wire helpers that pair CONTROL frame sends
 * with `cardSessionBindingStore` mutations.
 *
 * These functions exist so a future session-bootstrap flow (T3.4.c) can
 * call a single helper instead of remembering to clear/set the binding
 * store alongside every frame it sends. For W2 the helpers are
 * standalone — nothing in tugdeck's current production code spawns
 * or closes sessions via the wire yet.
 *
 * **spawn** is asymmetric: sending the frame is easy, but populating
 * the binding store has to wait for the server's `spawn_session_ok`
 * CONTROL ack because only the server knows the canonical
 * `workspace_key` (macOS firmlink handling). The ack handler lives in
 * `action-dispatch.ts::initActionDispatch` — this module only needs
 * a send helper, not a setBinding helper.
 *
 * **close** is symmetric: the binding can be cleared optimistically
 * at send time because the client owns the binding state and the
 * server's close path is best-effort (logs + continues on failure).
 *
 * @module lib/session-lifecycle
 */

import type { TugConnection } from "../connection";
import {
  encodeCloseSession,
  encodeSpawnSession,
  type SpawnSessionMode,
} from "../protocol";
import { cardSessionBindingStore } from "./card-session-binding-store";

/**
 * Send a `spawn_session` CONTROL frame for `(cardId, tugSessionId,
 * projectDir)`.
 *
 * Spawn is asymmetric: the ack (`spawn_session_ok`) is what populates
 * `cardSessionBindingStore`, because only the server knows the
 * canonical `workspace_key` (macOS firmlink handling). Callers send
 * the frame here and wait for the binding to appear via
 * `cardSessionBindingStore.subscribe`.
 */
export function sendSpawnSession(
  connection: TugConnection,
  cardId: string,
  tugSessionId: string,
  projectDir: string,
  sessionMode: SpawnSessionMode = "new",
): void {
  const frame = encodeSpawnSession(
    cardId,
    tugSessionId,
    projectDir,
    sessionMode,
  );
  connection.send(frame.feedId, frame.payload);
}

/**
 * Send a `close_session` CONTROL frame for `(cardId, tugSessionId)` and
 * optimistically clear the card's workspace binding.
 *
 * The clear happens BEFORE the frame is sent: in the unlikely event
 * that the send fails (connection drop), the binding is still cleared,
 * which matches "card is being torn down" semantics. A `clearBinding`
 * on an unknown card id is a no-op, so calling this helper twice for
 * the same card is safe.
 */
export function sendCloseSession(
  connection: TugConnection,
  cardId: string,
  tugSessionId: string,
): void {
  cardSessionBindingStore.clearBinding(cardId);
  const frame = encodeCloseSession(cardId, tugSessionId);
  connection.send(frame.feedId, frame.payload);
}
