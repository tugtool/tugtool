/**
 * Pub/sub bus for tide session-ledger CONTROL traffic.
 *
 * Tugcast's supervisor broadcasts:
 *   - `session_updated { session_id, fields | removed }` push frames after
 *     each successful ledger write.
 *   - `list_sessions_ok { workspace_key, sessions }` ack frames in response
 *     to a `list_sessions` CONTROL request.
 *   - `forget_session_ok { session_id }` / `forget_session_err { reason }`
 *     ack frames in response to a `forget_session` request.
 *   - `forget_workspace_sessions_ok { workspace_key, count }` /
 *     `forget_workspace_sessions_err { reason }` ack frames.
 *
 * `action-dispatch.ts` decodes those frames and forwards them through this
 * module's `publish*` functions; the `TideSessionLedgerStore` (step 4)
 * subscribes via `subscribeTo*` to populate its cache and resolve pending
 * promises.
 *
 * The bus is process-global. Multiple subscribers are allowed; new
 * subscribers receive subsequent events only — no replay buffer. The store
 * is the single intended subscriber in production; tests register their
 * own listeners.
 */

import type { SessionRow, SessionUpdatedPush } from "../protocol.ts";

type Listener<T> = (payload: T) => void;

function makeBus<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    subscribe(listener: Listener<T>): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(payload: T): void {
      // Snapshot to allow unsubscription during dispatch without skipping
      // siblings. Listeners are expected to be fast and side-effect-free
      // (the store's listener writes to its in-memory cache + emits a tick).
      for (const listener of [...listeners]) {
        listener(payload);
      }
    },
    /** Test-only: remove every subscriber. */
    reset(): void {
      listeners.clear();
    },
  };
}

const sessionUpdatedBus = makeBus<SessionUpdatedPush>();
const listSessionsOkBus = makeBus<{ project_dir: string; sessions: SessionRow[] }>();
const listSessionsErrBus = makeBus<{ project_dir: string; reason: string }>();
const forgetSessionOkBus = makeBus<{ session_id: string }>();
const forgetSessionErrBus = makeBus<{ session_id: string; reason: string }>();
const forgetProjectDirSessionsOkBus = makeBus<{ project_dir: string; count: number }>();
const forgetProjectDirSessionsErrBus = makeBus<{ project_dir: string; reason: string }>();

export const subscribeToSessionUpdated = sessionUpdatedBus.subscribe;
export const publishSessionUpdated = sessionUpdatedBus.publish;

export const subscribeToListSessionsOk = listSessionsOkBus.subscribe;
export const publishListSessionsOk = listSessionsOkBus.publish;

export const subscribeToListSessionsErr = listSessionsErrBus.subscribe;
export const publishListSessionsErr = listSessionsErrBus.publish;

export const subscribeToForgetSessionOk = forgetSessionOkBus.subscribe;
export const publishForgetSessionOk = forgetSessionOkBus.publish;

export const subscribeToForgetSessionErr = forgetSessionErrBus.subscribe;
export const publishForgetSessionErr = forgetSessionErrBus.publish;

export const subscribeToForgetProjectDirSessionsOk = forgetProjectDirSessionsOkBus.subscribe;
export const publishForgetProjectDirSessionsOk = forgetProjectDirSessionsOkBus.publish;

export const subscribeToForgetProjectDirSessionsErr = forgetProjectDirSessionsErrBus.subscribe;
export const publishForgetProjectDirSessionsErr = forgetProjectDirSessionsErrBus.publish;

export function _resetTideSessionLedgerEventsForTest(): void {
  sessionUpdatedBus.reset();
  listSessionsOkBus.reset();
  listSessionsErrBus.reset();
  forgetSessionOkBus.reset();
  forgetSessionErrBus.reset();
  forgetProjectDirSessionsOkBus.reset();
  forgetProjectDirSessionsErrBus.reset();
}
