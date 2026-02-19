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
  private heartbeatTimer: number | null = null;
  private url: string;

  // Reconnection state
  private state: ConnectionStateValue = ConnectionState.DISCONNECTED;
  private retryDelay: number = INITIAL_RETRY_DELAY_MS;
  private retryTimer: number | null = null;
  private countdownTimer: number | null = null;
  private countdownSeconds: number = 0;
  private bannerElement: HTMLElement | null = null;
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
      this.hideDisconnectBanner();
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

    // Show banner with countdown
    this.showDisconnectBanner();

    // Start countdown timer (updates every second)
    this.countdownTimer = window.setInterval(() => {
      this.updateBannerCountdown();
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
    // Clear countdown timer
    if (this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    this.state = ConnectionState.RECONNECTING;
    this.updateBannerText("Reconnecting...");

    console.log("tugdeck: attempting reconnection");
    this.connect();
  }

  /**
   * Show the disconnect banner
   */
  private showDisconnectBanner(): void {
    if (!this.bannerElement) {
      this.bannerElement = document.getElementById("disconnect-banner");
    }

    if (this.bannerElement) {
      this.bannerElement.style.display = "block";
      this.updateBannerText();
    }
  }

  /**
   * Update banner text with current countdown
   */
  private updateBannerText(customText?: string): void {
    if (!this.bannerElement) {
      return;
    }

    if (customText) {
      this.bannerElement.textContent = customText;
      return;
    }

    let text = "Disconnected";

    // Add close reason if available
    if (this.lastCloseReason && this.lastCloseReason.trim() !== "") {
      text += ` (${this.lastCloseReason})`;
    }

    // Add countdown
    text += ` -- reconnecting in ${this.countdownSeconds}s...`;

    this.bannerElement.textContent = text;
  }

  /**
   * Update the countdown display
   */
  private updateBannerCountdown(): void {
    this.countdownSeconds = Math.max(0, this.countdownSeconds - 1);
    this.updateBannerText();

    if (this.countdownSeconds === 0 && this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  /**
   * Hide the disconnect banner
   */
  private hideDisconnectBanner(): void {
    if (this.bannerElement) {
      this.bannerElement.style.display = "none";
    }

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
  sendControlFrame(action: string): void {
    const frame = controlFrame(action);
    this.send(frame.feedId, frame.payload);
  }

  /**
   * Register a callback for when the connection opens
   */
  onOpen(callback: () => void): void {
    this.openCallbacks.push(callback);
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
    if (this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

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
