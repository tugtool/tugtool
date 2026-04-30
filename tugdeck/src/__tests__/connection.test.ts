/**
 * `TugConnection` heartbeat-watchdog unit tests.
 *
 * Drives a real `TugConnection` against a stubbed `WebSocket` and a
 * manually controlled clock + interval table. The watchdog reads
 * `Date.now()` and runs on `window.setInterval`, so each test
 *
 *   - sets the simulated wall-clock with `setSystemTime`,
 *   - captures every `setInterval` callback the connection registers,
 *   - advances time in steps that fire those callbacks deterministically,
 *
 * which is enough to assert the watchdog's force-close behavior without
 * sleeping for tens of seconds.
 *
 * Coverage:
 *   - 50 s of total wire silence after handshake → `ws.close()` called.
 *   - A frame at t=30 s defers the force-close: nothing at t=50 s, then
 *     force-close at t=80 s once 45 s have elapsed since the last frame.
 *
 * Mirrors [D02] / `tugcast/src/router.rs:48`.
 */

import { describe, it, expect, beforeEach, afterEach, setSystemTime } from "bun:test";

// `connection.ts` reaches for browser globals (`window.setInterval`,
// `window.setTimeout`, `WebSocket`) directly, so the bun test runtime
// — which does not ship a DOM — needs a minimal alias. Pointing
// `globalThis.window` at `globalThis` lets `window.setInterval` resolve
// to `globalThis.setInterval`; the test's `installFakes` then replaces
// those with captured stubs. Done before importing the SUT so the
// module sees the alias the moment its top-level statements run.
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: unknown }).window = globalThis;
}

import { TugConnection } from "@/connection";
import { encodeFrame, FeedId, FrameFlags } from "@/protocol";

// ---------------------------------------------------------------------------
// FakeWebSocket — a passive stand-in for the browser's WebSocket.
// ---------------------------------------------------------------------------
//
// The real client opens a socket in `connect()` and reacts to events the
// server pushes back. Tests need to drive those events in a controlled
// order, so this mock captures `onopen` / `onmessage` / `onclose`
// without doing any I/O. `close()` increments a counter; we assert on
// it directly rather than chaining the mock back into a synthetic
// onclose dispatch.

class FakeWebSocket {
  static readonly OPEN = 1;

  binaryType: string = "blob";
  readyState: number = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  url: string;
  readonly sent: Array<string | ArrayBufferLike> = [];
  closeCalls: number = 0;

  constructor(url: string) {
    this.url = url;
    lastWs = this;
  }

  send(data: string | ArrayBufferLike): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
  }

  // ── Test helpers ─────────────────────────────────────────────────────────

  fireOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  fireMessage(data: string | ArrayBuffer): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

let lastWs: FakeWebSocket | null = null;

// ---------------------------------------------------------------------------
// Manual interval / timeout table.
// ---------------------------------------------------------------------------
//
// Real `setInterval` would race with the test's assertions, and
// `setSystemTime` does not advance pending timers. Replacing
// `window.setInterval` / `window.setTimeout` with a captured table lets
// the test step time forward and fire the callbacks that fall due, in
// order, against the simulated clock.

interface IntervalEntry {
  id: number;
  cb: () => void;
  intervalMs: number;
  nextFire: number;
}

let intervals: Map<number, IntervalEntry>;
let nextTimerId: number;
let mockNow: number;

let origSetInterval: typeof window.setInterval;
let origClearInterval: typeof window.clearInterval;
let origSetTimeout: typeof window.setTimeout;
let origClearTimeout: typeof window.clearTimeout;
let origWebSocket: typeof globalThis.WebSocket;

const BASE_TIME_MS = 1_700_000_000_000; // an arbitrary deterministic epoch

function installFakes(): void {
  intervals = new Map();
  nextTimerId = 1;
  mockNow = BASE_TIME_MS;
  setSystemTime(new Date(mockNow));

  origSetInterval = window.setInterval;
  origClearInterval = window.clearInterval;
  origSetTimeout = window.setTimeout;
  origClearTimeout = window.clearTimeout;
  origWebSocket = globalThis.WebSocket;

  // Simulated `setInterval`: capture the callback so the test can fire
  // it at the right simulated timestamp.
  (window as unknown as { setInterval: (cb: () => void, ms: number) => number })
    .setInterval = (cb: () => void, ms: number): number => {
      const id = nextTimerId++;
      intervals.set(id, { id, cb, intervalMs: ms, nextFire: mockNow + ms });
      return id;
    };

  (window as unknown as { clearInterval: (id?: number) => void })
    .clearInterval = (id?: number): void => {
      if (id !== undefined) intervals.delete(id);
    };

  // The connection schedules reconnection via `setTimeout`. The watchdog
  // tests never let `onclose` fire (a forced close in this mock just
  // bumps a counter), so the reconnect path never runs — but stubbing
  // these stops `connect()`'s reconnect machinery from leaking real
  // timers into the test.
  (window as unknown as { setTimeout: (cb: () => void, ms: number) => number })
    .setTimeout = (_cb: () => void, _ms: number): number => 0;
  (window as unknown as { clearTimeout: (id?: number) => void })
    .clearTimeout = (_id?: number): void => {};

  (globalThis as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket =
    FakeWebSocket;
}

function uninstallFakes(): void {
  window.setInterval = origSetInterval;
  window.clearInterval = origClearInterval;
  window.setTimeout = origSetTimeout;
  window.clearTimeout = origClearTimeout;
  (globalThis as unknown as { WebSocket: typeof globalThis.WebSocket })
    .WebSocket = origWebSocket;
  setSystemTime();
  lastWs = null;
}

/**
 * Advance the simulated clock by `deltaMs`, firing every captured
 * interval whose next-fire timestamp lands inside the window. Each
 * fire moves the clock to that timestamp before invoking the callback,
 * so callbacks observe `Date.now()` at their actual scheduled time —
 * not at the destination of the advance.
 */
function advanceTime(deltaMs: number): void {
  const target = mockNow + deltaMs;
  while (true) {
    let next: IntervalEntry | null = null;
    for (const entry of intervals.values()) {
      if (
        entry.nextFire <= target &&
        (next === null || entry.nextFire < next.nextFire)
      ) {
        next = entry;
      }
    }
    if (next === null) break;
    mockNow = next.nextFire;
    setSystemTime(new Date(mockNow));
    next.nextFire = mockNow + next.intervalMs;
    next.cb();
  }
  mockNow = target;
  setSystemTime(new Date(mockNow));
}

/** Drive a `TugConnection` through `connect()` and the handshake. */
function completeHandshake(conn: TugConnection): FakeWebSocket {
  conn.connect();
  const ws = lastWs;
  if (ws === null) throw new Error("WebSocket was not constructed");
  ws.fireOpen();
  ws.fireMessage(JSON.stringify({ protocol: "tugcast", version: 1 }));
  return ws;
}

/** A binary HEARTBEAT frame, encoded the same way the real server would. */
function heartbeatFrame(): ArrayBuffer {
  return encodeFrame({
    feedId: FeedId.HEARTBEAT,
    flags: FrameFlags.DATA,
    payload: new Uint8Array(0),
  });
}

// ---------------------------------------------------------------------------

describe("TugConnection — heartbeat watchdog (Step 2)", () => {
  beforeEach(() => {
    installFakes();
  });

  afterEach(() => {
    uninstallFakes();
  });

  it("force-closes the wire after 45 s of silence post-handshake", () => {
    const conn = new TugConnection("ws://test.invalid/");
    const ws = completeHandshake(conn);

    // No frames after the handshake. The watchdog ticks at 5 s
    // intervals; advancing 50 s fires nine ticks (5/10/15/.../45/50 s).
    // The check at 50 s sees `Date.now() - lastFrameAt = 50_000`, which
    // is the first tick where the threshold is exceeded.
    expect(ws.closeCalls).toBe(0);
    advanceTime(50_000);
    expect(ws.closeCalls).toBe(1);
  });

  it("a single mid-window frame defers the force-close by exactly the gap", () => {
    const conn = new TugConnection("ws://test.invalid/");
    const ws = completeHandshake(conn);

    // t=30 s — server delivers a HEARTBEAT echo. `lastFrameAt` resets.
    advanceTime(30_000);
    expect(ws.closeCalls).toBe(0);
    ws.fireMessage(heartbeatFrame());

    // t=50 s — only 20 s have elapsed since the frame at t=30 s; under
    // the 45 s threshold, no force-close.
    advanceTime(20_000);
    expect(ws.closeCalls).toBe(0);

    // t=80 s — 50 s since the frame at t=30 s; first tick past the
    // threshold trips the watchdog.
    advanceTime(30_000);
    expect(ws.closeCalls).toBe(1);
  });
});
