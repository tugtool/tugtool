/**
 * WebSocket connection management for tugcast
 *
 * Handles WebSocket lifecycle, binary frame dispatch, and heartbeat.
 */

import {
  FeedId,
  FeedIdValue,
  Frame,
  decodeFrame,
  encodeFrame,
} from "./protocol";

/** Callback for receiving frames from a specific feed */
export type FrameCallback = (payload: Uint8Array) => void;

/** Heartbeat interval in milliseconds (15 seconds) */
const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * WebSocket connection for tugcast protocol
 *
 * Manages the WebSocket connection, frame encoding/decoding,
 * and dispatches frames to registered callbacks by feed ID.
 */
export class TugConnection {
  private ws: WebSocket | null = null;
  private callbacks: Map<number, FrameCallback[]> = new Map();
  private openCallbacks: Array<() => void> = [];
  private heartbeatTimer: number | null = null;
  private url: string;

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
    };

    this.ws.onerror = (event: Event) => {
      console.error("tugdeck: WebSocket error", event);
    };
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
    this.stopHeartbeat();
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
