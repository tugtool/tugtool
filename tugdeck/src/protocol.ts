/**
 * Tugcast Binary Protocol v1
 *
 * Wire format per frame:
 * ```
 * [1 byte FeedId][1 byte flags][4 bytes payload length (BE u32)][payload]
 * ```
 *
 * - FeedId: open u8 namespace — known feeds have named constants,
 *   unknown values pass through without error (opaque routing).
 * - Flags: bit 0 = frame kind (0 = data, 1 = control/meta).
 *   Bits 1–7 are reserved; receivers ignore unknown flags.
 * - Length: big-endian u32, max MAX_PAYLOAD_SIZE.
 */

/** Feed identifiers for different data streams (open u8 namespace) */
export const FeedId = {
  // Terminal
  TERMINAL_OUTPUT: 0x00,
  TERMINAL_INPUT: 0x01,
  TERMINAL_RESIZE: 0x02,
  // Snapshot feeds
  FILESYSTEM: 0x10,
  GIT: 0x20,
  // Stats
  STATS: 0x30,
  STATS_PROCESS_INFO: 0x31,
  STATS_TOKEN_USAGE: 0x32,
  STATS_BUILD_STATUS: 0x33,
  // Code (Claude Code bridge)
  CODE_OUTPUT: 0x40,
  CODE_INPUT: 0x41,
  // Defaults
  DEFAULTS: 0x50,
  // Shell (reserved for Phase T2+)
  SHELL_OUTPUT: 0x60,
  SHELL_INPUT: 0x61,
  // TugFeed (reserved for Phase T3+)
  TUG_FEED: 0x70,
  // Router-internal
  CONTROL: 0xc0,
  HEARTBEAT: 0xff,
} as const;

export type FeedIdValue = (typeof FeedId)[keyof typeof FeedId];

/** Frame flags */
export const FrameFlags = {
  /** Normal data frame */
  DATA: 0x00,
  /** Control/meta frame about this feed */
  CONTROL: 0x01,
} as const;

export type FrameFlagsValue = (typeof FrameFlags)[keyof typeof FrameFlags];

/** Kind bit mask */
const KIND_BIT = 0x01;

/** Frame header size in bytes (1 FeedId + 1 flags + 4 length) */
export const HEADER_SIZE = 6;

/** Maximum payload size in bytes (16 MB) */
export const MAX_PAYLOAD_SIZE = 16 * 1024 * 1024;

/** A WebSocket frame containing a feed ID, flags, and payload */
export interface Frame {
  feedId: FeedIdValue;
  flags: number;
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

  view.setUint8(0, frame.feedId);
  view.setUint8(1, frame.flags);
  view.setUint32(2, frame.payload.length, false);

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

  if (data.byteLength < HEADER_SIZE) {
    throw new Error(
      `incomplete frame: need ${HEADER_SIZE} bytes, have ${data.byteLength}`
    );
  }

  const feedId = view.getUint8(0) as FeedIdValue;
  const flags = view.getUint8(1);
  const length = view.getUint32(2, false);

  if (length > MAX_PAYLOAD_SIZE) {
    throw new Error(`payload too large: ${length} bytes`);
  }

  if (data.byteLength < HEADER_SIZE + length) {
    throw new Error(
      `incomplete frame: need ${HEADER_SIZE + length} bytes, have ${data.byteLength}`
    );
  }

  // View into original buffer, no copy
  const payload = new Uint8Array(data, HEADER_SIZE, length);

  return { feedId, flags, payload };
}

/** Returns true if the flags indicate a control/meta frame */
export function isControlFrame(flags: number): boolean {
  return (flags & KIND_BIT) !== 0;
}

/**
 * Create a heartbeat frame (empty payload)
 */
export function heartbeatFrame(): Frame {
  return { feedId: FeedId.HEARTBEAT, flags: FrameFlags.DATA, payload: new Uint8Array(0) };
}

/**
 * Create a terminal input frame
 */
export function inputFrame(data: Uint8Array): Frame {
  return { feedId: FeedId.TERMINAL_INPUT, flags: FrameFlags.DATA, payload: data };
}

/**
 * Create a terminal resize frame
 */
export function resizeFrame(cols: number, rows: number): Frame {
  const json = JSON.stringify({ cols, rows });
  return {
    feedId: FeedId.TERMINAL_RESIZE,
    flags: FrameFlags.DATA,
    payload: new TextEncoder().encode(json),
  };
}

/**
 * Create a code input frame from a message object
 */
export function encodeCodeInput(msg: object): ArrayBuffer {
  const json = JSON.stringify(msg);
  const payload = new TextEncoder().encode(json);
  const frame: Frame = {
    feedId: FeedId.CODE_INPUT,
    flags: FrameFlags.DATA,
    payload,
  };
  return encodeFrame(frame);
}

/**
 * Create a control frame with a JSON action payload
 */
export function controlFrame(action: string, params?: Record<string, unknown>): Frame {
  const json = JSON.stringify({ action, ...params });
  return {
    feedId: FeedId.CONTROL,
    flags: FrameFlags.DATA,
    payload: new TextEncoder().encode(json),
  };
}
