/**
 * Binary WebSocket frame protocol for tugcast
 *
 * Wire format:
 * - 1 byte: FeedId
 * - 4 bytes: Payload length (big-endian u32)
 * - N bytes: Payload data
 */

/** Feed identifiers for different data streams */
export const FeedId = {
  TERMINAL_OUTPUT: 0x00,
  TERMINAL_INPUT: 0x01,
  TERMINAL_RESIZE: 0x02,
  FILESYSTEM: 0x10,
  GIT: 0x20,
  HEARTBEAT: 0xff,
} as const;

export type FeedIdValue = (typeof FeedId)[keyof typeof FeedId];

/** Frame header size in bytes */
export const HEADER_SIZE = 5;

/** Maximum payload size in bytes (1 MB) */
export const MAX_PAYLOAD_SIZE = 1_048_576;

/** A WebSocket frame containing a feed ID and payload */
export interface Frame {
  feedId: FeedIdValue;
  payload: Uint8Array;
}

/**
 * Encode a frame into wire format bytes
 *
 * Returns an ArrayBuffer ready for WebSocket transmission.
 */
export function encodeFrame(frame: Frame): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_SIZE + frame.payload.length);
  const view = new DataView(buffer);

  // Write feed ID (1 byte)
  view.setUint8(0, frame.feedId);

  // Write payload length (4 bytes, big-endian)
  view.setUint32(1, frame.payload.length, false);

  // Write payload
  new Uint8Array(buffer, HEADER_SIZE).set(frame.payload);

  return buffer;
}

/**
 * Decode a frame from wire format bytes
 *
 * @throws Error if the frame is incomplete or invalid
 */
export function decodeFrame(data: ArrayBuffer): Frame {
  const view = new DataView(data);

  // Check for complete header
  if (data.byteLength < HEADER_SIZE) {
    throw new Error(
      `incomplete frame: need ${HEADER_SIZE} bytes, have ${data.byteLength}`
    );
  }

  // Read feed ID
  const feedId = view.getUint8(0) as FeedIdValue;

  // Read payload length (big-endian)
  const length = view.getUint32(1, false);

  // Check payload size
  if (length > MAX_PAYLOAD_SIZE) {
    throw new Error(`payload too large: ${length} bytes`);
  }

  // Check for complete frame
  if (data.byteLength < HEADER_SIZE + length) {
    throw new Error(
      `incomplete frame: need ${HEADER_SIZE + length} bytes, have ${data.byteLength}`
    );
  }

  // Extract payload (view into original buffer, no copy)
  const payload = new Uint8Array(data, HEADER_SIZE, length);

  return { feedId, payload };
}

/**
 * Create a heartbeat frame (empty payload)
 */
export function heartbeatFrame(): Frame {
  return { feedId: FeedId.HEARTBEAT, payload: new Uint8Array(0) };
}

/**
 * Create a terminal input frame
 */
export function inputFrame(data: Uint8Array): Frame {
  return { feedId: FeedId.TERMINAL_INPUT, payload: data };
}

/**
 * Create a terminal resize frame
 */
export function resizeFrame(cols: number, rows: number): Frame {
  const json = JSON.stringify({ cols, rows });
  return {
    feedId: FeedId.TERMINAL_RESIZE,
    payload: new TextEncoder().encode(json),
  };
}
