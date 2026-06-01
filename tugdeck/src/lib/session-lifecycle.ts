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
  encodeRequestReplay,
  encodeSpawnSession,
  type SpawnSessionMode,
} from "../protocol";
import { cardSessionBindingStore } from "./card-session-binding-store";
import { logSessionLifecycle } from "./session-lifecycle-log";

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
  logSessionLifecycle("spawn.frame_send", {
    card_id: cardId,
    tug_session_id: tugSessionId,
    project_dir: projectDir,
    session_mode: sessionMode,
  });
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
  logSessionLifecycle("close.frame_send", {
    card_id: cardId,
    tug_session_id: tugSessionId,
  });
  cardSessionBindingStore.clearBinding(cardId);
  const frame = encodeCloseSession(cardId, tugSessionId);
  connection.send(frame.feedId, frame.payload);
}

/**
 * Send a `close_session` CONTROL frame for `(cardId, tugSessionId)` WITHOUT
 * touching the card binding.
 *
 * Used by `/clear` ([#step-13b3]): the card is being rebound to a *fresh*
 * session in the same breath, so the binding must stay put — it flips to the
 * new session on `spawn_session_ok`, and `cardServicesStore` swaps in a fresh
 * store on that flip. Only the old subprocess is torn down here. (Contrast
 * {@link sendCloseSession}, which clears the binding because it means "the
 * card is going away.")
 */
export function sendCloseSessionKeepingBinding(
  connection: TugConnection,
  cardId: string,
  tugSessionId: string,
): void {
  logSessionLifecycle("close.frame_send_keep_binding", {
    card_id: cardId,
    tug_session_id: tugSessionId,
  });
  const frame = encodeCloseSession(cardId, tugSessionId);
  connection.send(frame.feedId, frame.payload);
}

/**
 * Send a `request_replay` CONTROL frame for `tugSessionId` per [D12].
 *
 * Asks the supervisor to forward a `request_replay` verb to the live
 * tugcode subprocess, which re-runs `runReplay()` against the on-disk
 * JSONL and streams the transcript back through CODE_OUTPUT. The
 * fresh `CodeSessionStore` that triggered this dispatch is already
 * subscribed to CODE_OUTPUT before this helper returns, so no race
 * against the inbound replay frames.
 *
 * Used by `cardServicesStore._construct` for resume bindings (HMR,
 * Developer > Reload, future card mounts that find their session
 * already Live on the supervisor). Fresh-spawn bindings don't need
 * this — there's no JSONL to replay until claude writes its first turn.
 *
 * Bindings, the binding store, and React state are unchanged; this
 * helper is pure wire emission.
 */
export function sendRequestReplay(
  connection: TugConnection,
  tugSessionId: string,
): void {
  logSessionLifecycle("request_replay.dispatch", {
    tug_session_id: tugSessionId,
  });
  const frame = encodeRequestReplay(tugSessionId);
  connection.send(frame.feedId, frame.payload);
}
