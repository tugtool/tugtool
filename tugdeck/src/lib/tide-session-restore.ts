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
 * Server-side prerequisites are already in place:
 *   - Tugcast persists `{ tug_session_id, project_dir, claude_session_id }`
 *     into tugbank under `dev.tugtool.tide.session-keys`, keyed by
 *     `cardId`, on every successful `spawn_session_ok`.
 *   - `AgentSupervisor::rebind_from_tugbank` re-materializes those
 *     records into the ledger at startup.
 *   - `on_client_disconnect` explicitly does not touch the ledger, so
 *     sessions survive a WS drop.
 *
 * Client-side flow:
 *   1. `restoreTideSessions` walks the deck's tide cards, reads each
 *      one's tugbank record, and — for each record present — fires
 *      `spawn_session(mode=resume)` via `sendSpawnSession`.
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
 * @module lib/tide-session-restore
 */

import type { DeckManager } from "../deck-manager";
import type { TugConnection } from "../connection";
import type { TugbankClient } from "./tugbank-client";
import { sendSpawnSession } from "./session-lifecycle";
import { logSessionLifecycle } from "./session-lifecycle-log";
import { cardSessionBindingStore } from "./card-session-binding-store";
import { pickerNoticeStore } from "./picker-notice-store";
import { FeedId } from "../protocol";

/**
 * Tugbank domain where tugcast writes per-card session records. Mirrors
 * `SESSION_KEYS_DOMAIN` in `tugrust/crates/tugcast/src/feeds/agent_supervisor.rs`.
 */
const SESSION_KEYS_DOMAIN = "dev.tugtool.tide.session-keys";

/** Component id for tide cards. Matches `registerTideCard`'s registration. */
const TIDE_COMPONENT_ID = "tide";

/**
 * Per-card restore timeout. Long enough to survive a slow subprocess
 * spawn, short enough that a dead server is caught quickly. On
 * timeout the entry is cleared and the picker presents with a
 * `restore_timed_out` notice; the tugbank record is preserved so the
 * next reload retries.
 */
const RESTORE_TIMEOUT_MS = 10_000;

/**
 * Shape of the per-card value in `SESSION_KEYS_DOMAIN`. Mirrors the
 * Rust `SessionKeyRecord` struct — `project_dir` is optional in the
 * wire format (`None` for pre-W2 legacy records), but we require it
 * for restore since `spawn_session` takes it as a mandatory argument.
 */
interface PersistedSessionRecord {
  tug_session_id: string;
  project_dir?: string;
  claude_session_id?: string;
}

function isRestoreCandidate(value: unknown): value is PersistedSessionRecord {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.tug_session_id === "string" &&
    obj.tug_session_id.length > 0 &&
    typeof obj.project_dir === "string" &&
    obj.project_dir.length > 0
  );
}

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
  cardSessionBindingStore.subscribe(() => {
    const bindings = cardSessionBindingStore.getSnapshot();
    for (const cardId of Array.from(tideRestoreRegistry.getSnapshot().keys())) {
      if (bindings.has(cardId)) {
        tideRestoreRegistry._clear(cardId);
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
 * Re-assert session bindings for every tide card in the deck that has
 * a persisted tugbank record. Callers should invoke after
 * `tugbankClient.ready()` has resolved and `DeckManager` has loaded
 * the layout — typically right after `initActionDispatch` in
 * `main.tsx`.
 */
export function restoreTideSessions(
  deck: DeckManager,
  tugbank: TugbankClient,
  connection: TugConnection,
): void {
  installRegistrySubscriptions(connection);

  const cards = deck
    .getSnapshot()
    .cards.filter((c) => c.componentId === TIDE_COMPONENT_ID);
  if (cards.length === 0) return;

  let restoredCount = 0;
  for (const card of cards) {
    const record = tugbank.getValue(SESSION_KEYS_DOMAIN, card.id);
    if (!isRestoreCandidate(record)) continue;
    fireRestore(
      card.id,
      record.tug_session_id,
      record.project_dir as string,
      connection,
    );
    restoredCount += 1;
  }

  if (restoredCount > 0) {
    logSessionLifecycle("restore.fired_resume_spawns", {
      card_count: cards.length,
      restore_count: restoredCount,
    });
  }
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
 * frame fires, so next reload will retry the restore from tugbank.
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
