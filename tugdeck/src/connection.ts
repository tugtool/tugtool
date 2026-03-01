/**
 * WebSocket connection management for tugcast
 *
 * Handles WebSocket lifecycle, binary frame dispatch, heartbeat,
 * and reconnection with exponential backoff.
 */

import {
  FeedId,
  FeedIdValue,
  Frame,
  decodeFrame,
  encodeFrame,
  controlFrame,
} from "./protocol";

/** Callback for receiving frames from a specific feed */
export type FrameCallback = (payload: Uint8Array) => void;

/** State emitted to DisconnectBanner when connection status changes */
export interface DisconnectState {
  /** true = disconnected/reconnecting, false = connected */
  disconnected: boolean;
  /** Seconds remaining until next reconnect attempt (0 when reconnecting) */
  countdown: number;
  /** Human-readable reason (close reason from server, if any) */
  reason: string | null;
  /** true = actively attempting reconnect, false = waiting for countdown */
  reconnecting: boolean;
}

/** Callback for disconnect state changes */
export type DisconnectStateCallback = (state: DisconnectState) => void;

/** Heartbeat interval in milliseconds (15 seconds) */
const HEARTBEAT_INTERVAL_MS = 15_000;

/** Connection state */
const ConnectionState = {
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  RECONNECTING: "reconnecting",
} as const;

type ConnectionStateValue = (typeof ConnectionState)[keyof typeof ConnectionState];

/** Initial retry delay (2 seconds) */
const INITIAL_RETRY_DELAY_MS = 2000;

/** Maximum retry delay (30 seconds) */
const MAX_RETRY_DELAY_MS = 30000;

/**
 * WebSocket connection for tugcast protocol
 *
 * Manages the WebSocket connection, frame encoding/decoding,
 * dispatches frames to registered callbacks by feed ID,
 * and handles automatic reconnection with exponential backoff.
 */
export class TugConnection {
  private ws: WebSocket | null = null;
  private callbacks: Map<number, FrameCallback[]> = new Map();
  private openCallbacks: Array<() => void> = [];
  private closeCallbacks: Array<() => void> = [];
  private disconnectStateCallbacks: Array<DisconnectStateCallback> = [];
  private heartbeatTimer: number | null = null;
  private url: string;

  // Reconnection state
  private state: ConnectionStateValue = ConnectionState.DISCONNECTED;
  private retryDelay: number = INITIAL_RETRY_DELAY_MS;
  private retryTimer: number | null = null;
  private countdownTimer: number | null = null;
  private countdownSeconds: number = 0;
  private intentionalClose: boolean = false;
  private lastCloseCode: number | null = null;
  private lastCloseReason: string | null = null;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Connect to the WebSocket server
   *
   * Sets up event handlers and starts heartbeat.
   */
  connect(): void {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      console.log("tugdeck: WebSocket connected");
      this.state = ConnectionState.CONNECTED;
      this.retryDelay = INITIAL_RETRY_DELAY_MS;
      this.clearCountdownTimer();
      this.notifyDisconnectState(false);
      this.startHeartbeat();
      for (const cb of this.openCallbacks) {
        cb();
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        try {
          const frame = decodeFrame(event.data);
          this.dispatch(frame.feedId, frame.payload);
        } catch (error) {
          console.error("tugdeck: failed to decode frame:", error);
        }
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      console.log("tugdeck: WebSocket closed", event.code, event.reason);
      this.stopHeartbeat();

      // Store close info for banner display
      this.lastCloseCode = event.code;
      this.lastCloseReason = event.reason || null;

      // Notify close callbacks
      for (const cb of this.closeCallbacks) {
        try { cb(); } catch (e) { console.error("onClose callback error:", e); }
      }

      // Don't reconnect if close was intentional
      if (this.intentionalClose) {
        return;
      }

      // Transition to disconnected and schedule reconnection
      this.state = ConnectionState.DISCONNECTED;
      this.scheduleReconnect();

      // Double the retry delay for next attempt (capped at max)
      this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_DELAY_MS);
    };

    this.ws.onerror = (event: Event) => {
      console.error("tugdeck: WebSocket error", event);
      // The close event always follows an error, so reconnection is handled there
    };
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    // Clear any existing retry timer
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    // Calculate countdown seconds
    this.countdownSeconds = Math.ceil(this.retryDelay / 1000);

    // Notify React components of disconnected state
    this.notifyDisconnectState(false);

    // Start countdown timer (updates every second)
    this.countdownTimer = window.setInterval(() => {
      this.tickCountdown();
    }, 1000);

    // Schedule reconnection attempt
    this.retryTimer = window.setTimeout(() => {
      this.reconnect();
    }, this.retryDelay);
  }

  /**
   * Attempt to reconnect
   */
  private reconnect(): void {
    this.clearCountdownTimer();

    this.state = ConnectionState.RECONNECTING;
    this.notifyDisconnectState(true);

    console.log("tugdeck: attempting reconnection");
    this.connect();
  }

  /**
   * Notify disconnect state callbacks with the current state.
   * @param reconnecting true when actively attempting to reconnect
   */
  private notifyDisconnectState(reconnecting: boolean): void {
    const disconnected = this.state !== ConnectionState.CONNECTED;
    const state: DisconnectState = {
      disconnected,
      countdown: this.countdownSeconds,
      reason: this.lastCloseReason && this.lastCloseReason.trim() !== "" ? this.lastCloseReason : null,
      reconnecting,
    };
    for (const cb of this.disconnectStateCallbacks) {
      try { cb(state); } catch (e) { console.error("disconnectStateCallback error:", e); }
    }
  }

  /**
   * Tick the countdown by 1 second and notify listeners.
   */
  private tickCountdown(): void {
    this.countdownSeconds = Math.max(0, this.countdownSeconds - 1);
    this.notifyDisconnectState(false);

    if (this.countdownSeconds === 0 && this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  /**
   * Clear the countdown interval timer.
   */
  private clearCountdownTimer(): void {
    if (this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  /**
   * Send a frame to the server
   */
  send(feedId: FeedIdValue, payload: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const frame: Frame = { feedId, payload };
      this.ws.send(encodeFrame(frame));
    }
  }

  /**
   * Send a control frame with the given action
   */
  sendControlFrame(action: string, params?: Record<string, unknown>): void {
    const frame = controlFrame(action, params);
    this.send(frame.feedId, frame.payload);
  }

  /**
   * Register a callback for when the connection opens
   */
  onOpen(callback: () => void): void {
    this.openCallbacks.push(callback);
  }

  onClose(callback: () => void): () => void {
    this.closeCallbacks.push(callback);
    return () => {
      const idx = this.closeCallbacks.indexOf(callback);
      if (idx >= 0) this.closeCallbacks.splice(idx, 1);
    };
  }

  /**
   * Register a callback for disconnect state changes.
   * Called when the connection disconnects, the countdown ticks, or reconnection is attempted.
   * Returns a cleanup function to unregister.
   */
  onDisconnectState(callback: DisconnectStateCallback): () => void {
    this.disconnectStateCallbacks.push(callback);
    return () => {
      const idx = this.disconnectStateCallbacks.indexOf(callback);
      if (idx >= 0) this.disconnectStateCallbacks.splice(idx, 1);
    };
  }

  /**
   * Register a callback for frames from a specific feed
   *
   * Multiple callbacks can be registered for the same feed ID.
   */
  onFrame(feedId: number, callback: FrameCallback): void {
    if (!this.callbacks.has(feedId)) {
      this.callbacks.set(feedId, []);
    }
    this.callbacks.get(feedId)!.push(callback);
  }

  /**
   * Close the WebSocket connection
   */
  close(): void {
    this.intentionalClose = true;
    this.stopHeartbeat();

    // Clear reconnection timers
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.clearCountdownTimer();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Dispatch a frame to registered callbacks
   */
  private dispatch(feedId: number, payload: Uint8Array): void {
    const cbs = this.callbacks.get(feedId);
    if (cbs) {
      for (const cb of cbs) {
        cb(payload);
      }
    }
  }

  /**
   * Start sending heartbeat frames periodically
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = window.setInterval(() => {
      this.send(FeedId.HEARTBEAT, new Uint8Array(0));
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stop the heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
