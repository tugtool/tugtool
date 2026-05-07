/**
 * tide-session-restore — re-assert per-card session bindings after a
 * page reload, and track in-flight restore expectations so the tide
 * card body can render a `TideRestoring` placeholder instead of the
 * project picker.
 *
 * Why it matters. `cardSessionBindingStore` is in-memory. On
 * WKWebView reload the deck layout is restored from tugbank but every
 * tide card comes up unbound. Without this module the picker sheet
 * would mount on the active tide card (via the `cardDidActivate`
 * initial-sync) and only dismiss once the `spawn_session_ok` ack
 * arrives — a brief but ugly "half-dismissed sheet" flash.
 *
 * Server-side prerequisites:
 *   - Tugcast's sqlite-backed `SessionLedger` records each session's
 *     `(card_id, project_dir, session_id)` on `session_init` (via
 *     `LedgerSessionsRecorder::record_spawn`). The row's `card_id`
 *     column is preserved across the session's lifecycle (close/fail),
 *     so the binding persists across tugcast restarts.
 *   - `AgentSupervisor::rebind_from_ledger` re-materializes the
 *     in-memory ledger map from sqlite at startup.
 *   - `on_client_disconnect` explicitly does not touch the ledger, so
 *     sessions survive a WS drop.
 *
 * Client-side flow:
 *   1. `restoreTideSessions` sends a `list_card_bindings` CONTROL
 *      request and waits for the `list_card_bindings_ok` response.
 *      Each binding is matched against the deck's tide cards by
 *      `card_id`; for matches it fires `spawn_session(mode=resume)`
 *      via `sendSpawnSession`.
 *   2. The expectation is recorded in `tideRestoreRegistry` with a
 *      10-second timeout. `TideCardContent` subscribes to the
 *      registry and renders `TideRestoring` whenever a card has a
 *      pending restore.
 *   3. Happy path — the server acks with `spawn_session_ok`, the
 *      existing action-dispatch handler writes the binding into
 *      `cardSessionBindingStore`, and the registry subscribes to that
 *      store, clears the entry, and `TideCardContent` flips to
 *      `TideCardBody`.
 *   4. Server-error path — tugcast broadcasts `SESSION_STATE: errored`
 *      for the session. The module's `SESSION_STATE` subscriber picks
 *      it up, clears the registry entry, and sets a `resume_failed`
 *      picker notice carrying the `(tug_session_id, project_dir)` so
 *      the picker's Retry button can re-fire.
 *   5. Timeout path — no ack, no error within 10 seconds. Same shape
 *      as the error path but with a `restore_timed_out` notice.
 *   6. User-cancel path — `cancelTideRestore(cardId)` clears the
 *      registry entry and sets a `restore_canceled` notice. Per
 *      design choice: server state is preserved (no `close_session`
 *      fires), so next reload will retry the restore.
 *
 * Resumability: a binding only appears in `list_card_bindings_ok` if
 * the row had at least one round-trip with claude (`turn_count > 0`).
 * Sessions that emitted `session_init` but never had a real
 * conversation are excluded — they have no JSONL on disk, so resuming
 * them would surface a misleading "Couldn't resume the previous
 * session" banner.
 *
 * @module lib/tide-session-restore
 */

import type { DeckManager } from "../deck-manager";
import type { TugConnection } from "../connection";
import { sendSpawnSession } from "./session-lifecycle";
import { logSessionLifecycle } from "./session-lifecycle-log";
import { cardSessionBindingStore } from "./card-session-binding-store";
import { cardServicesStore } from "./card-services-store";
import { pickerNoticeStore } from "./picker-notice-store";
import { subscribeToListCardBindingsOk } from "./tide-session-ledger-events";
import { CONTROL_ACTION_LIST_CARD_BINDINGS, FeedId } from "../protocol";
import type { CardBinding } from "../protocol";

/** Component id for tide cards. Matches `registerTideCard`'s registration. */
const TIDE_COMPONENT_ID = "tide";

/**
 * Per-card restore timeout. Long enough to survive a slow subprocess
 * spawn, short enough that a dead server is caught quickly. On
 * timeout the entry is cleared and the picker presents with a
 * `restore_timed_out` notice; the ledger row is preserved so the next
 * reload retries.
 */
const RESTORE_TIMEOUT_MS = 10_000;

/** Per-card restore context — enough to drive Retry and Cancel copy. */
export interface RestoreExpectation {
  readonly tugSessionId: string;
  readonly projectDir: string;
}

/**
 * Tracks in-flight restore expectations. Subscribable via
 * `useSyncExternalStore` so `TideCardContent` can render
 * `TideRestoring` reactively.
 */
class TideRestoreRegistry {
  private entries: Map<string, RestoreExpectation> = new Map();
  private timeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private listeners: Array<() => void> = [];

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  };

  getSnapshot = (): Map<string, RestoreExpectation> => this.entries;

  has = (cardId: string): boolean => this.entries.has(cardId);

  get = (cardId: string): RestoreExpectation | undefined =>
    this.entries.get(cardId);

  /**
   * Record an in-flight restore and arm the timeout. `onTimeout` runs
   * on the `setTimeout` macrotask unless `clear(cardId)` is called
   * first — binding arrival, SESSION_STATE errored, and user cancel
   * all clear the entry before the timer fires.
   */
  _register(
    cardId: string,
    expectation: RestoreExpectation,
    onTimeout: () => void,
  ): void {
    const next = new Map(this.entries);
    next.set(cardId, expectation);
    this.entries = next;
    const handle = setTimeout(onTimeout, RESTORE_TIMEOUT_MS);
    this.timeouts.set(cardId, handle);
    this._emit();
  }

  _clear(cardId: string): void {
    if (!this.entries.has(cardId)) return;
    const next = new Map(this.entries);
    next.delete(cardId);
    this.entries = next;
    const handle = this.timeouts.get(cardId);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.timeouts.delete(cardId);
    }
    this._emit();
  }

  private _emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const tideRestoreRegistry = new TideRestoreRegistry();

// ---------------------------------------------------------------------------
// Subscription wiring — installed once at startup by `restoreTideSessions`.
// ---------------------------------------------------------------------------

let _subscriptionsInstalled = false;

function installRegistrySubscriptions(connection: TugConnection): void {
  if (_subscriptionsInstalled) return;
  _subscriptionsInstalled = true;

  // When a binding arrives for a restoring card, the restore succeeded.
  // Also notify the card's CodeSessionStore that the wire is settled,
  // so its `transportState` can flip from `restoring` back to `online`
  // (per [D04] / [D07]). The lookup runs here rather than inside
  // `cardServicesStore` because `cardServicesStore` is responsible only
  // for owning the per-card services bag — the "the supervisor has
  // re-acked, transport is settled" semantic belongs to this restore
  // module, which already owns the corresponding restore-registry
  // bookkeeping.
  cardSessionBindingStore.subscribe(() => {
    const bindings = cardSessionBindingStore.getSnapshot();
    for (const cardId of Array.from(tideRestoreRegistry.getSnapshot().keys())) {
      if (bindings.has(cardId)) {
        tideRestoreRegistry._clear(cardId);
        const services = cardServicesStore.getServices(cardId);
        services?.codeSessionStore.notifyTransportSettled();
      }
    }
  });

  // When tugcast reports an errored SESSION_STATE for a restoring
  // session, the restore failed.
  connection.onFrame(FeedId.SESSION_STATE, (payload) => {
    const msg = parseSessionStateFrame(payload);
    if (msg === null || msg.state !== "errored") return;
    for (const [cardId, expectation] of Array.from(
      tideRestoreRegistry.getSnapshot(),
    )) {
      if (expectation.tugSessionId !== msg.tugSessionId) continue;
      tideRestoreRegistry._clear(cardId);
      pickerNoticeStore.set(cardId, {
        category: "resume_failed",
        message:
          msg.detail ?? `Could not resume session for "${expectation.projectDir}".`,
        staleTugSessionId: expectation.tugSessionId,
        staleProjectDir: expectation.projectDir,
      });
      logSessionLifecycle("restore.server_rejected", {
        card_id: cardId,
        tug_session_id: expectation.tugSessionId,
        detail: msg.detail ?? null,
      });
      break;
    }
  });
}

// SESSION_STATE payload shape lives in tugcast's `build_session_state_frame`:
// `{ tug_session_id: string, state: "pending"|"spawning"|"live"|"errored"|"closed", detail?: string }`.
interface SessionStateMessage {
  tugSessionId: string;
  state: string;
  detail: string | null;
}

function parseSessionStateFrame(payload: Uint8Array): SessionStateMessage | null {
  try {
    const json = new TextDecoder().decode(payload);
    const raw = JSON.parse(json) as Record<string, unknown>;
    const tugSessionId = raw.tug_session_id;
    const state = raw.state;
    const detail = raw.detail;
    if (typeof tugSessionId !== "string" || typeof state !== "string") {
      return null;
    }
    return {
      tugSessionId,
      state,
      detail: typeof detail === "string" ? detail : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reason a `restoreTideSessions` call is happening. Surfaced on the
 * `restore.fired_resume_spawns` lifecycle log so traces distinguish the
 * one-time startup pass from reconnect-driven re-asserts.
 */
export type RestoreReason = "startup" | "reconnect";

export interface RestoreOptions {
  readonly reason?: RestoreReason;
}

/**
 * Re-assert session bindings for every tide card in the deck that the
 * server's ledger has a binding for. Sends a `list_card_bindings`
 * CONTROL request and dispatches `spawn_session(mode=resume)` per
 * matching deck card on the response. Callers should invoke after
 * `DeckManager` has loaded the layout — typically right after
 * `initActionDispatch` in `main.tsx`.
 *
 * Idempotent across calls. The module-level
 * `installRegistrySubscriptions` guard ensures the binding-arrival and
 * SESSION_STATE subscribers are wired exactly once even when this
 * function runs again on reconnect; `fireRestore` itself clears any
 * stale per-card timer before arming a new one, so a re-fire after a
 * previous restore is well-defined.
 */
export function restoreTideSessions(
  deck: DeckManager,
  connection: TugConnection,
  opts?: RestoreOptions,
): void {
  installRegistrySubscriptions(connection);

  const tideCardIds = new Set(
    deck
      .getSnapshot()
      .cards.filter((c) => c.componentId === TIDE_COMPONENT_ID)
      .map((c) => c.id),
  );
  if (tideCardIds.size === 0) return;

  // Subscribe once for the matching response, then drop the
  // subscription. The bus is process-global, so we filter by the
  // deck's tide cards here.
  const reason = opts?.reason ?? "startup";
  const unsubscribe = subscribeToListCardBindingsOk(({ bindings }) => {
    unsubscribe();
    let restoredCount = 0;
    // Track which cards we've already fired for. Multiple ledger rows
    // can map to the same card_id (sequential sessions on that card);
    // the wire orders rows newest-first by `last_used_at`, so the
    // first match per card_id is the one to resume.
    const fired = new Set<string>();
    for (const binding of bindings) {
      if (!isCardBinding(binding)) continue;
      if (!tideCardIds.has(binding.card_id)) continue;
      if (fired.has(binding.card_id)) continue;
      fired.add(binding.card_id);
      fireRestore(
        binding.card_id,
        binding.session_id,
        binding.project_dir,
        connection,
      );
      restoredCount += 1;
    }
    if (restoredCount > 0) {
      logSessionLifecycle("restore.fired_resume_spawns", {
        card_count: tideCardIds.size,
        restore_count: restoredCount,
        reason,
      });
    }
  });

  // Fire the request. `action-dispatch` decodes the response and
  // publishes onto `listCardBindingsOkBus`, which the subscription
  // above consumes.
  connection.sendControlFrame(CONTROL_ACTION_LIST_CARD_BINDINGS, {});
}

function isCardBinding(value: unknown): value is CardBinding {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.card_id === "string" &&
    obj.card_id.length > 0 &&
    typeof obj.session_id === "string" &&
    obj.session_id.length > 0 &&
    typeof obj.project_dir === "string" &&
    obj.project_dir.length > 0
  );
}

/**
 * Send the `spawn_session(mode=resume)` frame and register the
 * restore expectation. Shared between startup restore and the
 * picker's Retry button.
 */
export function fireRestore(
  cardId: string,
  tugSessionId: string,
  projectDir: string,
  connection: TugConnection,
): void {
  // If a previous restore was in flight (Retry after cancel/timeout),
  // drop the old timer before arming a new one.
  tideRestoreRegistry._clear(cardId);
  sendSpawnSession(connection, cardId, tugSessionId, projectDir, "resume");
  tideRestoreRegistry._register(
    cardId,
    { tugSessionId, projectDir },
    () => {
      // Timeout: no ack, no error — treat as a distinct failure mode.
      if (!tideRestoreRegistry.has(cardId)) return;
      tideRestoreRegistry._clear(cardId);
      pickerNoticeStore.set(cardId, {
        category: "restore_timed_out",
        message: `Restore of "${projectDir}" timed out after 10 seconds.`,
        staleTugSessionId: tugSessionId,
        staleProjectDir: projectDir,
      });
      logSessionLifecycle("restore.timed_out", {
        card_id: cardId,
        tug_session_id: tugSessionId,
        project_dir: projectDir,
        timeout_ms: RESTORE_TIMEOUT_MS,
      });
    },
  );
}

/**
 * User clicked Cancel in `TideRestoring`. Clear the in-flight
 * expectation and drop to the picker with a `restore_canceled`
 * notice. Per design: server state is preserved — no `close_session`
 * frame fires, so next reload will retry the restore from the ledger.
 */
export function cancelTideRestore(cardId: string): void {
  const expectation = tideRestoreRegistry.get(cardId);
  if (expectation === undefined) return;
  tideRestoreRegistry._clear(cardId);
  pickerNoticeStore.set(cardId, {
    category: "restore_canceled",
    message: `Canceled restore of "${expectation.projectDir}".`,
    staleTugSessionId: expectation.tugSessionId,
    staleProjectDir: expectation.projectDir,
  });
  logSessionLifecycle("restore.user_canceled", {
    card_id: cardId,
    tug_session_id: expectation.tugSessionId,
  });
}
