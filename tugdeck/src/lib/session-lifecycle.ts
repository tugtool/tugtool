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
import type { ReplayWindow } from "@tugproto/inbound";
import { cardSessionBindingStore } from "./card-session-binding-store";
import { logSessionLifecycle } from "./session-lifecycle-log";
import { mintTag } from "./session-tag";
import { sessionTagStore } from "./session-tag-store";
import { getTugbankClient } from "./tugbank-singleton";
import {
  PERMISSION_MODE_DEFAULT_DOMAIN,
  PERMISSION_MODE_DEFAULT_KEY,
  PERMISSION_MODE_DOMAIN,
  parsePersistedPermissionMode,
  resolveSeedPermissionMode,
} from "./permission-mode";

/**
 * Resolve the permission mode a freshly-spawned session should start in,
 * read synchronously from the tugbank cache at spawn time: the card's own
 * per-card persisted mode if any, else the deck-wide default. `undefined`
 * when neither is set (and when the tugbank client isn't ready yet) — the
 * caller then sends no `permission_mode` and tugcode keeps its own default.
 *
 * Forwarded in the `spawn_session` frame so tugcast passes `--permission-mode`
 * to tugcode and the spawned claude starts in the right mode from its first
 * instant. This is the creation-time counterpart to the post-spawn
 * `permission_mode` frame `usePermissionMode` still sends once the session is
 * alive — the seed frame is then an idempotent confirmation rather than the
 * sole (and race-prone) carrier of the default.
 */
function resolveSpawnPermissionMode(cardId: string): string | undefined {
  const client = getTugbankClient();
  if (client === null) return undefined;
  const persisted = parsePersistedPermissionMode(
    client.get(PERMISSION_MODE_DOMAIN, cardId),
  );
  const globalDefault = parsePersistedPermissionMode(
    client.get(PERMISSION_MODE_DEFAULT_DOMAIN, PERMISSION_MODE_DEFAULT_KEY),
  );
  return resolveSeedPermissionMode(persisted, globalDefault) ?? undefined;
}

/**
 * Resolve the provisional mnemonic tag to send on a spawn, and set it in the
 * tag store optimistically so the Z4B chip shows one instantly "from the drop".
 *
 * - **Resume of an already-tagged row:** reuse the row's tag verbatim (the tag
 *   follows the ledger row; the server preserves it via COALESCE). The tag is
 *   taken from `existingTag` when the caller has the row in hand, else from the
 *   store (seeded from `list_sessions_ok` / card bindings on the resumed id).
 * - **Fresh spawn or legacy tagless resume:** mint a fresh tag, re-rolled
 *   against every tag currently known so the client avoids collisions the
 *   server would otherwise have to suffix.
 *
 * Returns the tag to thread into {@link sendSpawnSession}.
 */
export function provisionSpawnTag(
  tugSessionId: string,
  existingTag?: string | null,
): string {
  const reuse = (existingTag ?? sessionTagStore.getTag(tugSessionId))?.trim() ?? "";
  const tag = reuse.length > 0 ? reuse : mintTag(sessionTagStore.knownTags());
  sessionTagStore.setTag(tugSessionId, tag);
  return tag;
}

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
  tag?: string,
): void {
  const permissionMode = resolveSpawnPermissionMode(cardId);
  const frame = encodeSpawnSession(
    cardId,
    tugSessionId,
    projectDir,
    sessionMode,
    permissionMode,
    tag,
  );
  logSessionLifecycle("spawn.frame_send", {
    card_id: cardId,
    tug_session_id: tugSessionId,
    project_dir: projectDir,
    session_mode: sessionMode,
    permission_mode: permissionMode ?? "",
    tag: tag ?? "",
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
 * Maker > Reload, future card mounts that find their session
 * already Live on the supervisor). Fresh-spawn bindings don't need
 * this — there's no JSONL to replay until claude writes its first turn.
 *
 * Bindings, the binding store, and React state are unchanged; this
 * helper is pure wire emission.
 */
export function sendRequestReplay(
  connection: TugConnection,
  tugSessionId: string,
  window?: ReplayWindow,
): void {
  logSessionLifecycle("request_replay.dispatch", {
    tug_session_id: tugSessionId,
  });
  const frame = encodeRequestReplay(tugSessionId, window);
  connection.send(frame.feedId, frame.payload);
}
