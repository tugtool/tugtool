/**
 * dev-session-restore — re-assert per-card session bindings after a
 * page reload, and track in-flight restore expectations so the tide
 * card body can render a `DevRestoring` placeholder instead of the
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
 *   1. `restoreDevSessions` sends a `list_card_bindings` CONTROL
 *      request and waits for the `list_card_bindings_ok` response.
 *      Each binding is matched against the deck's tide cards by
 *      `card_id`. The match's `turn_count` and `is_alive` decide the
 *      mode:
 *      - `turn_count > 0` OR `is_alive` → `spawn_session(mode=resume)`
 *        with the persisted `session_id`. Two routes into resume:
 *        committed turns on disk (claude reopens the JSONL and
 *        replays history), or a live tugcode subprocess holding
 *        mid-turn state — the in-flight-first-turn case where a
 *        permission / question is pending and no JSONL has been
 *        written yet.
 *      - `turn_count === 0` AND not `is_alive` → `spawn_session(mode=new)`
 *        with a fresh `session_id` but the same `project_dir`. The
 *        card opens to its bound project with a fresh claude session.
 *   2. The expectation is recorded in `tideRestoreRegistry` with a
 *      10-second timeout. `DevCardContent` subscribes to the
 *      registry and renders `DevRestoring` whenever a card has a
 *      pending restore.
 *   3. Happy path — the server acks with `spawn_session_ok`, the
 *      existing action-dispatch handler writes the binding into
 *      `cardSessionBindingStore`, and the registry subscribes to that
 *      store, clears the entry, and `DevCardContent` flips to
 *      `DevCardBody`.
 *   4. Server-error path — tugcast broadcasts `SESSION_STATE: errored`
 *      for the session. The module's `SESSION_STATE` subscriber picks
 *      it up, clears the registry entry, and sets a `resume_failed`
 *      picker notice carrying the `(tug_session_id, project_dir)` so
 *      the picker's Retry button can re-fire.
 *   5. Timeout path — no ack, no error within 10 seconds. Same shape
 *      as the error path but with a `restore_timed_out` notice.
 *   6. User-cancel path — `cancelDevRestore(cardId)` clears the
 *      registry entry and sets a `restore_canceled` notice. Per
 *      design choice: server state is preserved (no `close_session`
 *      fires), so next reload will retry the restore.
 *
 * Resumability: every non-failed binding surfaces in
 * `list_card_bindings_ok` regardless of `turn_count`. Sessions with
 * a JSONL (`turn_count > 0`) or a live subprocess (`is_alive`) take
 * the `mode=resume` path; everything else falls back to
 * `mode=new`-with-same-project_dir so the card still opens to its
 * bound project without dropping the user back to the picker.
 *
 * @module lib/dev-session-restore
 */

import type { DeckManager } from "../deck-manager";
import type { TugConnection } from "../connection";
import { sendSpawnSession } from "./session-lifecycle";
import { logSessionLifecycle } from "./session-lifecycle-log";
import { cardSessionBindingStore } from "./card-session-binding-store";
import { cardServicesStore } from "./card-services-store";
import { pickerNoticeStore } from "./picker-notice-store";
import { subscribeToListCardBindingsOk } from "./dev-session-ledger-events";
import { CONTROL_ACTION_LIST_CARD_BINDINGS, FeedId } from "../protocol";
import type { CardBinding } from "../protocol";

/** Component id for tide cards. Matches `registerDevCard`'s registration. */
const DEV_COMPONENT_ID = "tide";

/**
 * Per-card restore timeout. Long enough to survive a slow subprocess
 * spawn, short enough that a dead server is caught quickly. On
 * timeout the entry is cleared and the picker presents with a
 * `restore_timed_out` notice; the ledger row is preserved so the next
 * reload retries.
 */
const RESTORE_TIMEOUT_MS = 10_000;

/**
 * Backstop for the startup restore pass: if `list_card_bindings_ok`
 * never lands, settle the pass gate anyway after this long so an
 * unbound tide card is not stranded on the restore placeholder. The
 * `list_card_bindings` query reads the supervisor's in-memory ledger
 * and answers in tens of ms in the healthy case; a response past this
 * window means the server is effectively dead, at which point the
 * card should fall through to the picker.
 */
const RESTORE_PASS_SETTLE_TIMEOUT_MS = 5_000;

/** Per-card restore context — enough to drive Retry and Cancel copy. */
export interface RestoreExpectation {
  readonly tugSessionId: string;
  readonly projectDir: string;
}

/**
 * Tracks in-flight restore expectations. Subscribable via
 * `useSyncExternalStore` so `DevCardContent` can render
 * `DevRestoring` reactively.
 */
class DevRestoreRegistry {
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

export const tideRestoreRegistry = new DevRestoreRegistry();

// ---------------------------------------------------------------------------
// Restore-start clock
// ---------------------------------------------------------------------------

/**
 * Per-card `Date.now()` of when the current restore began — stamped by
 * `fireRestore` the moment `spawn_session(mode=resume)` is sent.
 *
 * The `DevRestoring` placeholder delay-gates its centered panel on
 * this: the panel appears only once the restore has run longer than
 * the budget, so a fast restore shows nothing and a slow one explains
 * itself. The stamp must outlive the `tideRestoreRegistry` entry —
 * that entry clears the instant the binding lands, well before the
 * post-services replay window finishes — and it must survive the
 * `DevRestoring` remount at the `services`-null boundary, so a
 * component-local timer cannot hold it. A module-level map keyed by
 * `cardId` is the one reference both the pre-services and the
 * cold-restore-in-body renders of `DevRestoring` can read.
 *
 * Lifecycle: stamped (and re-stamped) by every `fireRestore`; cleared
 * by `clearRestoreStartedAt` when the card body reveals. Every path
 * that shows `DevRestoring` is preceded by a `fireRestore`, so a
 * missing stamp (`getRestoreStartedAt` → `undefined`) means "treat as
 * just started" — the safe fallback that arms the full budget.
 */
const restoreStartedAt = new Map<string, number>();

/** `Date.now()` of the in-flight restore for `cardId`, if any. */
export function getRestoreStartedAt(cardId: string): number | undefined {
  return restoreStartedAt.get(cardId);
}

/** Drop the restore-start stamp once the card body has revealed. */
export function clearRestoreStartedAt(cardId: string): void {
  restoreStartedAt.delete(cardId);
}

// ---------------------------------------------------------------------------
// Restore-pass gate
// ---------------------------------------------------------------------------

/**
 * Per-app gate: has the startup restore pass settled?
 *
 * `restoreDevSessions` sends `list_card_bindings` and only learns
 * which cards have a session to restore when the response lands. In
 * the window before that, a tide card that mounts unbound has no
 * `tideRestoreRegistry` entry yet — and `DevCardContent` would fall
 * through to the project picker, dropping its `TugSheet` for the
 * round-trip until `fireRestore` flips the card to `DevRestoring`.
 * That is the picker-sheet flash.
 *
 * This gate closes the window. `DevCardContent` holds an unbound
 * card on the restore placeholder until the gate is settled; only
 * then does an unbound card with no restore expectation fall through
 * to the picker — by which point it is genuinely a fresh card, not
 * one mid-restore.
 *
 * One-shot: `false` at boot, `true` once the first `restoreDevSessions`
 * pass resolves, never back. Settled on every exit path of
 * `restoreDevSessions` — the no-dev-cards early-out, the
 * `list_card_bindings_ok` handler, and a timeout backstop for a
 * response that never lands.
 *
 * Exported as a class (not just the `restorePassGate` singleton) so
 * the idempotency invariant — a reconnect re-fire or a timeout racing
 * the response must not re-notify — is unit-testable on a fresh
 * instance.
 */
export class RestorePassGate {
  private settled = false;
  private listeners: Array<() => void> = [];

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  };

  getSnapshot = (): boolean => this.settled;

  /**
   * Mark the startup restore pass resolved. Idempotent — the first
   * settle wins; later calls (a reconnect pass, a timeout racing the
   * response) are no-ops.
   */
  _settle(): void {
    if (this.settled) return;
    this.settled = true;
    for (const listener of this.listeners) listener();
  }
}

export const restorePassGate = new RestorePassGate();

// ---------------------------------------------------------------------------
// Subscription wiring — installed once at startup by `restoreDevSessions`.
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
 * Reason a `restoreDevSessions` call is happening. Surfaced on the
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
export function restoreDevSessions(
  deck: DeckManager,
  connection: TugConnection,
  opts?: RestoreOptions,
): void {
  installRegistrySubscriptions(connection);

  const tideCardIds = new Set(
    deck
      .getSnapshot()
      .cards.filter((c) => c.componentId === DEV_COMPONENT_ID)
      .map((c) => c.id),
  );
  if (tideCardIds.size === 0) {
    // No tide cards to restore — the pass is trivially settled.
    restorePassGate._settle();
    return;
  }

  // Backstop: settle the pass gate even if `list_card_bindings_ok`
  // never lands, so an unbound tide card is not stranded on the
  // restore placeholder. Cleared in the response handler below; a
  // late fire is a harmless no-op (`_settle` is idempotent).
  const passSettleTimeout = setTimeout(() => {
    restorePassGate._settle();
  }, RESTORE_PASS_SETTLE_TIMEOUT_MS);

  // Subscribe once for the matching response, then drop the
  // subscription. The bus is process-global, so we filter by the
  // deck's tide cards here.
  const reason = opts?.reason ?? "startup";
  const unsubscribe = subscribeToListCardBindingsOk(({ bindings }) => {
    unsubscribe();
    clearTimeout(passSettleTimeout);
    let resumedCount = 0;
    let freshCount = 0;
    // Track which cards we've already fired for. Multiple ledger rows
    // can map to the same card_id (sequential sessions on that card);
    // the wire orders rows newest-first by `last_used_at`, so the
    // first match per card_id wins.
    const fired = new Set<string>();
    for (const binding of bindings) {
      if (!isCardBinding(binding)) continue;
      if (!tideCardIds.has(binding.card_id)) continue;
      if (fired.has(binding.card_id)) continue;
      fired.add(binding.card_id);
      // Resume when EITHER (a) there is a JSONL on disk (`turn_count > 0`,
      // committed turns to replay) OR (b) the live supervisor still
      // holds a subprocess entry for this session (`is_alive`). Case
      // (b) covers the **in-flight first turn**: the user submitted,
      // claude is mid-response or blocked on a permission/question
      // control_request, but no turn has committed to JSONL yet —
      // resuming hands the card back to the same tugcode subprocess
      // so the in-flight snapshot path delivers the partial assistant
      // text and any pending `control_request_forward`. Without
      // `is_alive` we'd take the fresh-spawn branch below and orphan
      // the live session. The fallback `=== true` keeps the gate
      // conservative when running against a server that doesn't emit
      // the field yet.
      const isAlive = binding.is_alive === true;
      if (binding.turn_count > 0 || isAlive) {
        fireRestore(
          binding.card_id,
          binding.session_id,
          binding.project_dir,
          connection,
        );
        resumedCount += 1;
      } else {
        // Card was bound to a project but no turn ever happened and
        // no live subprocess is holding mid-turn state (Start Fresh
        // + quit). claude has no JSONL, so resume would fail — but
        // the project binding is still meaningful. Fire a fresh
        // spawn with the same project so the card opens straight to
        // its bound state.
        fireFreshSpawn(binding.card_id, binding.project_dir, connection);
        freshCount += 1;
      }
    }
    if (resumedCount > 0 || freshCount > 0) {
      logSessionLifecycle("restore.fired_resume_spawns", {
        card_count: tideCardIds.size,
        restore_count: resumedCount,
        fresh_spawn_count: freshCount,
        reason,
      });
    }
    // The startup restore pass has resolved: every card with a ledger
    // binding now has a `tideRestoreRegistry` entry (or a fresh-spawn
    // in flight). An unbound card with neither is genuinely a fresh
    // card and may fall through to the picker.
    restorePassGate._settle();
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
    obj.project_dir.length > 0 &&
    typeof obj.turn_count === "number"
  );
}

/**
 * Spawn a fresh claude session under an existing card→project
 * binding. Used by `restoreDevSessions` for zero-turn rows: the
 * user's previous session never had any turns (so there's
 * no JSONL to resume), but the card was bound to a project — keep
 * that binding by spawning a new session under the same project.
 *
 * Mints a fresh `tug_session_id`. The supervisor will allocate a new
 * ledger row; the previous zero-turn row remains as a closed-state
 * crumb (eventually swept by age).
 *
 * Registers a `tideRestoreRegistry` hold for the pre-binding window.
 * Without it, `restorePassGate` settles the instant this pass
 * resolves and the still-unbound card falls straight through to the
 * project picker — its `TugSheet` flashing for the `spawn_session`
 * round-trip. The hold keeps the card on the quiet `DevRestoring`
 * backdrop instead. It clears on binding arrival (success), on a
 * `spawn_session_error` via `notifySpawnRejected` (rejection), or on
 * the timeout backstop. A `new`-mode spawn has no JSONL to replay, so
 * the hold spans only the bind round-trip — typically single-digit
 * milliseconds, below the placeholder's panel-reveal budget, so a
 * healthy fresh spawn shows only the quiet backdrop.
 */
function fireFreshSpawn(
  cardId: string,
  projectDir: string,
  connection: TugConnection,
): void {
  const tugSessionId = crypto.randomUUID();
  // Drop any prior in-flight restore timer before arming a new hold.
  tideRestoreRegistry._clear(cardId);
  // Stamp the restore-start clock — the `DevRestoring` placeholder
  // delay-gates its centered panel on this, so a fast fresh spawn
  // shows only the backdrop and a slow one explains itself.
  restoreStartedAt.set(cardId, Date.now());
  sendSpawnSession(connection, cardId, tugSessionId, projectDir, "new");
  tideRestoreRegistry._register(
    cardId,
    { tugSessionId, projectDir },
    () => {
      // Timeout backstop: no `spawn_session_ok`, no rejection. Drop
      // the hold so the card falls through to the picker; the ledger
      // row is preserved server-side, so the next reload retries.
      if (!tideRestoreRegistry.has(cardId)) return;
      tideRestoreRegistry._clear(cardId);
      logSessionLifecycle("restore.fresh_spawn_timed_out", {
        card_id: cardId,
        tug_session_id: tugSessionId,
        project_dir: projectDir,
        timeout_ms: RESTORE_TIMEOUT_MS,
      });
    },
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
  // Stamp the restore-start clock — the `DevRestoring` placeholder
  // delay-gates its panel on this. Re-stamped on a Retry / reconnect
  // re-fire so the budget always runs from the live attempt.
  restoreStartedAt.set(cardId, Date.now());
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
 * User clicked Cancel in `DevRestoring`. Clear the in-flight
 * expectation and drop to the picker with a `restore_canceled`
 * notice. Per design: server state is preserved — no `close_session`
 * frame fires, so next reload will retry the restore from the ledger.
 */
export function cancelDevRestore(cardId: string): void {
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

/**
 * Drop a card's in-flight restore / fresh-spawn hold because tugcast
 * rejected its `spawn_session` outright — a `spawn_session_error`
 * CONTROL frame, e.g. the project directory no longer exists.
 *
 * Clears the `tideRestoreRegistry` entry so `DevCardContent` falls
 * through from the `DevRestoring` placeholder to the project picker,
 * which surfaces the rejection through `tideSpawnErrorStore`'s banner.
 * No picker notice is set — the spawn-error banner is the notice.
 *
 * A no-op when the card has no registry entry: a rejection that races
 * a card the user never had on a restore hold simply does nothing.
 */
export function notifySpawnRejected(cardId: string): void {
  tideRestoreRegistry._clear(cardId);
}
