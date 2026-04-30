/**
 * connection-lifecycle.ts — Unified WebSocket connection-lifecycle event pipe.
 *
 * Five lifecycle events, fired by `TugConnection` at well-defined transitions
 * of the WebSocket connection:
 *
 *   1. connectionWillOpen           — TCP connection made, protocol handshake
 *                                     in progress. Subscribers see the wire
 *                                     is *about to be* alive.
 *   2. connectionDidOpen            — handshake complete, wire is alive.
 *                                     Fires on the very first open at app
 *                                     boot AND on every reconnect.
 *   3. connectionDidReconnect       — `connectionDidOpen` that *followed* a
 *                                     prior `connectionDidClose`. Fires only
 *                                     on recovery, never on the initial open.
 *                                     The lifecycle layer maintains the
 *                                     close-then-open gating internally so
 *                                     subscribers never have to.
 *   4. connectionDidClose           — wire dropped (server-initiated close,
 *                                     network error, intentional `close()`).
 *   5. connectionDidEnterReconnecting — backoff timer scheduled after a close,
 *                                     awaiting the next reconnect attempt.
 *
 * `connectionDidOpen` vs `connectionDidReconnect`:
 *   - `connectionDidOpen` is "the wire is alive" — fires on every successful
 *     handshake, including the very first one at app boot. Use this to
 *     trigger startup signals (the WKWebView frontend-ready handshake) that
 *     should also re-fire on reconnect.
 *   - `connectionDidReconnect` is "the wire is alive *again*" — fires only
 *     when an open recovered from a prior close. Use this for re-asserting
 *     bindings, clearing stale caches, or running any work that is invalid
 *     to do on the initial open because there's nothing to recover yet.
 *
 * Why a dedicated lifecycle layer (mirrors `app-lifecycle.ts` /
 * `card-lifecycle.ts`):
 *   - **Named events.** `observeConnectionDidReconnect(...)` reads at the
 *     call site as "do this when the wire recovers." A bag of `onOpen`
 *     callbacks plus a hand-rolled `sawClose` flag does not.
 *   - **Centralized gating.** The "first open is mount, subsequent opens
 *     are reconnects" semantic is computed once, here, and shared. Each
 *     subscriber would otherwise re-derive it (and get it wrong, as a
 *     "first invocation" flag does when registration happens after the
 *     handshake).
 *   - **State query.** `getState()` answers "is the wire alive right now?"
 *     for late subscribers — no chasing of the underlying transport.
 *   - **Singleton lookup.** `getConnectionLifecycle()` lets non-React
 *     consumers find the instance without prop-drilling, exactly as
 *     `getAppLifecycle()` does for app-level events.
 *
 * Timing:
 *   - All five notifications fire SYNCHRONOUSLY in the call stack of the
 *     transport event that triggered them. Subscribers receive the event
 *     the instant it happens. There is no React-style deferral here —
 *     React-integrated subscribers can wrap their callbacks themselves
 *     if they need it.
 *
 * @module lib/connection-lifecycle
 */

/**
 * Module-level toggle for connection-lifecycle trace logs. Defaults to
 * the Vite `import.meta.env.DEV` flag so dev builds print every will/did
 * transition; prod builds are silent. Flip to `true` in source to capture
 * a one-off trace without flipping the build mode.
 */
const LIFECYCLE_LOG: boolean = Boolean(import.meta.env?.DEV);

/**
 * Observable connection state. The lifecycle layer maintains this on
 * every `notify*` call so late subscribers can ask "is the wire alive
 * right now?" without re-deriving from a private flag elsewhere.
 *
 *   - `closed`        — no WebSocket open; not yet connected, or fully
 *                       disconnected with no reconnect scheduled.
 *   - `opening`       — TCP connected, handshake in progress.
 *   - `open`          — handshake complete, frames flowing.
 *   - `reconnecting`  — closed and waiting for the backoff timer to fire.
 */
export type ConnectionState =
  | "closed"
  | "opening"
  | "open"
  | "reconnecting";

/**
 * Observer callback shape. No arguments — the connection is singular and
 * the fact of the event is the payload. Mirrors `AppLifecycleObserver`.
 */
export type ConnectionLifecycleObserver = () => void;

/**
 * The five connection-lifecycle event channels. Used internally to
 * discriminate subscriber sets.
 */
type ConnectionEventName =
  | "connectionWillOpen"
  | "connectionDidOpen"
  | "connectionDidReconnect"
  | "connectionDidClose"
  | "connectionDidEnterReconnecting";

export class ConnectionLifecycle {
  private state: ConnectionState = "closed";

  /**
   * Tracks whether `notifyConnectionDidOpen` has *ever* fired
   * successfully on this lifecycle instance. `connectionDidReconnect`
   * requires a prior successful open — without this gate, a
   * close-before-first-open sequence (e.g., handshake failure on the
   * very first connect attempt followed by a successful retry) would
   * incorrectly mark the *first* successful open as a reconnect.
   */
  private everOpened: boolean = false;

  /**
   * Tracks whether `notifyConnectionDidClose` has fired since the last
   * `notifyConnectionDidOpen`. The next `notifyConnectionDidOpen` fires
   * `connectionDidReconnect` iff this flag AND `everOpened` are both
   * set, then clears it.
   *
   * Initialized `false` so the very first `connectionDidOpen` at app
   * boot does NOT fire `connectionDidReconnect` — the initial open is a
   * mount, not a recovery.
   */
  private sawCloseSinceLastOpen: boolean = false;

  // One subscription set per event channel. Same pattern as
  // `AppLifecycle` and `CardLifecycle` — separate sets so iteration
  // in `fire` is straightforward and channels don't interleave.
  private readonly subs: Record<
    ConnectionEventName,
    Set<ConnectionLifecycleObserver>
  > = {
    connectionWillOpen: new Set(),
    connectionDidOpen: new Set(),
    connectionDidReconnect: new Set(),
    connectionDidClose: new Set(),
    connectionDidEnterReconnecting: new Set(),
  };

  // ---- State query ----

  /** Current connection state. Updated by every `notify*` call. */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Convenience: `getState() === "open"`. Reads more directly at call
   * sites that just want to gate on aliveness.
   */
  isOpen(): boolean {
    return this.state === "open";
  }

  // ---- Notify entry points (called by TugConnection) ----
  //
  // `TugConnection` invokes these at well-defined points in its WebSocket
  // lifecycle. The lifecycle layer is otherwise stateless transport — it
  // does not own any wire I/O. Mirrors how `action-dispatch.ts` calls
  // `notifyApplication*` on `AppLifecycle`.

  notifyConnectionWillOpen(): void {
    if (LIFECYCLE_LOG) {
      console.log("[ConnectionLifecycle] connectionWillOpen");
    }
    this.state = "opening";
    this.fire("connectionWillOpen");
  }

  notifyConnectionDidOpen(): void {
    if (LIFECYCLE_LOG) {
      console.log("[ConnectionLifecycle] connectionDidOpen");
    }
    // `connectionDidReconnect` fires only when the wire RECOVERED from a
    // prior *successful* open. The `everOpened` gate covers the case
    // where the very first connect attempt closed before completing its
    // handshake (rare — protocol/version mismatch or TCP-level error
    // mid-handshake) and the second attempt succeeds: that second attempt
    // is the first real open of the lifecycle, not a recovery.
    const isReconnect = this.everOpened && this.sawCloseSinceLastOpen;
    this.state = "open";
    this.everOpened = true;
    this.sawCloseSinceLastOpen = false;
    this.fire("connectionDidOpen");
    if (isReconnect) {
      if (LIFECYCLE_LOG) {
        console.log("[ConnectionLifecycle] connectionDidReconnect");
      }
      this.fire("connectionDidReconnect");
    }
  }

  notifyConnectionDidClose(): void {
    if (LIFECYCLE_LOG) {
      console.log("[ConnectionLifecycle] connectionDidClose");
    }
    this.state = "closed";
    this.sawCloseSinceLastOpen = true;
    this.fire("connectionDidClose");
  }

  notifyConnectionDidEnterReconnecting(): void {
    if (LIFECYCLE_LOG) {
      console.log("[ConnectionLifecycle] connectionDidEnterReconnecting");
    }
    this.state = "reconnecting";
    this.fire("connectionDidEnterReconnecting");
  }

  // ---- Observe ----
  //
  // Subscription APIs return an unsubscribe function. No initial-sync —
  // connection lifecycle is strictly transitional. Mount-time subscribers
  // that need current state should call `getState()`.

  observeConnectionWillOpen(cb: ConnectionLifecycleObserver): () => void {
    return this.subscribe("connectionWillOpen", cb);
  }

  observeConnectionDidOpen(cb: ConnectionLifecycleObserver): () => void {
    return this.subscribe("connectionDidOpen", cb);
  }

  observeConnectionDidReconnect(cb: ConnectionLifecycleObserver): () => void {
    return this.subscribe("connectionDidReconnect", cb);
  }

  observeConnectionDidClose(cb: ConnectionLifecycleObserver): () => void {
    return this.subscribe("connectionDidClose", cb);
  }

  observeConnectionDidEnterReconnecting(
    cb: ConnectionLifecycleObserver,
  ): () => void {
    return this.subscribe("connectionDidEnterReconnecting", cb);
  }

  // ---- Internals ----

  private subscribe(
    event: ConnectionEventName,
    cb: ConnectionLifecycleObserver,
  ): () => void {
    const set = this.subs[event];
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  private fire(event: ConnectionEventName): void {
    for (const cb of this.subs[event]) {
      try {
        cb();
      } catch (err) {
        console.error(
          `ConnectionLifecycle ${event} observer threw:`,
          err,
        );
      }
    }
  }
}

// ---- Module-level singleton for cross-provider bootstrapping ----

/**
 * Process-wide `ConnectionLifecycle` instance, registered by `main.tsx`
 * at app bootstrap so non-React subscribers can find the instance
 * without threading a prop or a context. Mirrors `appLifecycleRef` in
 * `app-lifecycle.ts`.
 *
 * Last-registration-wins. Intentionally nullable so tests that don't
 * bootstrap the app see `null`.
 */
let connectionLifecycleRef: ConnectionLifecycle | null = null;

export function registerConnectionLifecycle(
  lifecycle: ConnectionLifecycle | null,
): void {
  connectionLifecycleRef = lifecycle;
}

export function getConnectionLifecycle(): ConnectionLifecycle | null {
  return connectionLifecycleRef;
}
