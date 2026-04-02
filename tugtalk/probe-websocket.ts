#!/usr/bin/env bun
/**
 * WebSocket probe — launches tugcast as a subprocess, connects via WebSocket,
 * sends a user_message over the CodeInput feed (0x41), collects streamed
 * assistant_text deltas, waits for turn_complete, then tests reconnection.
 *
 * Wire protocol:
 *   [1 byte FeedId][4 bytes big-endian u32 length][N bytes payload]
 *
 * Feed IDs used:
 *   0x40  CodeOutput  — tugcast → client (JSON-lines from tugtalk)
 *   0x41  CodeInput   — client → tugcast (JSON-lines to tugtalk)
 *   0xFF  Heartbeat   — bidirectional keepalive
 *
 * IMPORTANT TIMING NOTE:
 *   The CodeOutput broadcast channel is NOT a replay/history channel.
 *   The probe connects as soon as tugcast's port accepts TCP connections
 *   (polling every 100ms), minimizing the window during which session_init
 *   could be broadcast before we subscribe.
 *
 * Usage: bun run tugtalk/probe-websocket.ts
 */

import { spawn } from "bun";
import { resolve } from "path";
import * as net from "net";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROJECT_DIR = resolve(import.meta.dir, "..");

const TUGCAST_BIN = resolve(PROJECT_DIR, "tugrust/target/debug/tugcast");
const PROBE_PORT = 55266; // use a non-default port to avoid conflicts
const WS_URL = `ws://127.0.0.1:${PROBE_PORT}/ws`;
const TIMEOUT_MS = 120_000;
const USER_MESSAGE = "Say hello in exactly three words.";

// ---------------------------------------------------------------------------
// Wire protocol helpers
// ---------------------------------------------------------------------------

const HEADER_SIZE = 5;

const FeedId = {
  CODE_OUTPUT: 0x40,
  CODE_INPUT: 0x41,
  HEARTBEAT: 0xff,
} as const;

/** Encode a frame into an ArrayBuffer ready for WebSocket send */
function encodeFrame(feedId: number, payload: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(HEADER_SIZE + payload.length);
  const view = new DataView(buf);
  view.setUint8(0, feedId);
  view.setUint32(1, payload.length, false); // big-endian
  new Uint8Array(buf, HEADER_SIZE).set(payload);
  return buf;
}

/** Decode a frame from an ArrayBuffer */
function decodeFrame(data: ArrayBuffer): { feedId: number; payload: Uint8Array } {
  if (data.byteLength < HEADER_SIZE) {
    throw new Error(`frame too short: ${data.byteLength} bytes`);
  }
  const view = new DataView(data);
  const feedId = view.getUint8(0);
  const length = view.getUint32(1, false); // big-endian
  if (data.byteLength < HEADER_SIZE + length) {
    throw new Error(`incomplete frame: need ${HEADER_SIZE + length}, have ${data.byteLength}`);
  }
  const payload = new Uint8Array(data, HEADER_SIZE, length);
  return { feedId, payload };
}

/** Encode a CodeInput frame carrying a JSON message */
function codeInputFrame(msg: object): ArrayBuffer {
  const json = JSON.stringify(msg);
  const payload = new TextEncoder().encode(json);
  return encodeFrame(FeedId.CODE_INPUT, payload);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function ts(): string {
  return `[${((Date.now() - startTime) / 1000).toFixed(2)}s]`;
}

let startTime = Date.now();

function log(msg: string): void {
  console.log(`${ts()} ${msg}`);
}

// ---------------------------------------------------------------------------
// Port availability check
// ---------------------------------------------------------------------------

/** Try to connect to a TCP port; resolve true if successful, false if refused */
function canConnectTcp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(200, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

/** Poll port until it accepts connections, with a deadline */
async function waitForPort(host: string, port: number, deadlineMs: number): Promise<boolean> {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    if (await canConnectTcp(host, port)) return true;
    await Bun.sleep(100);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tugcast lifecycle
// ---------------------------------------------------------------------------

let tugcastProc: ReturnType<typeof spawn> | null = null;

/**
 * Launch tugcast and drain stderr in the background (for logging).
 * Returns after starting the process — use waitForPort to know when it's ready.
 */
function launchTugcast(): void {
  log(`Launching tugcast on port ${PROBE_PORT}...`);
  log(`  binary: ${TUGCAST_BIN}`);
  log(`  dir:    ${PROJECT_DIR}`);

  tugcastProc = spawn({
    cmd: [
      TUGCAST_BIN,
      "--no-auth",
      "--port", String(PROBE_PORT),
      "--dir", PROJECT_DIR,
      "--session", "probe-ws",
    ],
    cwd: PROJECT_DIR,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });

  // Drain stderr in the background for logging purposes
  const decoder = new TextDecoder();
  (async () => {
    for await (const chunk of tugcastProc!.stderr) {
      const text = decoder.decode(chunk, { stream: true });
      for (const line of text.split("\n").filter(Boolean)) {
        log(`  [stderr] ${line}`);
      }
    }
  })();
}

function killTugcast(): void {
  if (tugcastProc) {
    log("Killing tugcast...");
    tugcastProc.kill();
    tugcastProc = null;
  }
}

// ---------------------------------------------------------------------------
// WebSocket connection
// ---------------------------------------------------------------------------

function connectWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    log(`Connecting WebSocket to ${url}...`);
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      log("WebSocket connected.");
      resolve(ws);
    };

    ws.onerror = (e) => {
      reject(new Error(`WebSocket error: ${JSON.stringify(e)}`));
    };
  });
}

/** Collect CodeOutput events until predicate returns true, then resolve */
function collectUntil(
  ws: WebSocket,
  predicate: (msg: { type: string; [k: string]: unknown }) => boolean,
  opts: {
    onMessage?: (msg: { type: string; [k: string]: unknown }) => void;
    onAnyFrame?: (feedId: number, payload: Uint8Array) => void;
    timeoutMs?: number;
  } = {}
): Promise<{ type: string; [k: string]: unknown }[]> {
  return new Promise((resolve, reject) => {
    const collected: { type: string; [k: string]: unknown }[] = [];
    const dec = new TextDecoder();
    let timerHandle: ReturnType<typeof setTimeout> | null = null;

    if (opts.timeoutMs) {
      timerHandle = setTimeout(() => {
        ws.removeEventListener("message", handler);
        reject(new Error(`collectUntil timed out after ${opts.timeoutMs}ms`));
      }, opts.timeoutMs);
    }

    const handler = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;

      let frame: { feedId: number; payload: Uint8Array };
      try {
        frame = decodeFrame(event.data);
      } catch (e) {
        log(`  [decode error] ${e}`);
        return;
      }

      if (opts.onAnyFrame) opts.onAnyFrame(frame.feedId, frame.payload);

      if (frame.feedId === FeedId.HEARTBEAT) {
        return; // heartbeats are not logged here to reduce noise
      }

      if (frame.feedId !== FeedId.CODE_OUTPUT) {
        return; // non-code feeds pass through without calling onMessage
      }

      // CodeOutput payload is a JSON-line from tugtalk
      let msg: { type: string; [k: string]: unknown };
      try {
        msg = JSON.parse(dec.decode(frame.payload));
      } catch {
        log(`  [json parse error] raw: ${dec.decode(frame.payload).slice(0, 200)}`);
        return;
      }

      collected.push(msg);
      if (opts.onMessage) opts.onMessage(msg);

      if (predicate(msg)) {
        if (timerHandle) clearTimeout(timerHandle);
        ws.removeEventListener("message", handler);
        resolve(collected);
      }
    };

    ws.addEventListener("message", handler);
    ws.addEventListener("close", () => {
      if (timerHandle) clearTimeout(timerHandle);
      ws.removeEventListener("message", handler);
      reject(new Error("WebSocket closed before predicate matched"));
    });
  });
}

// ---------------------------------------------------------------------------
// Main probe
// ---------------------------------------------------------------------------

async function runProbe(): Promise<void> {
  startTime = Date.now();

  // Overall timeout
  const timeoutHandle = setTimeout(() => {
    log("[TIMEOUT] probe exceeded 120s — cleaning up");
    killTugcast();
    process.exit(1);
  }, TIMEOUT_MS);

  // Step 1: launch tugcast and wait for TCP port to accept connections
  log("=== Phase 0: Launch tugcast ===");
  launchTugcast();

  log(`Polling port ${PROBE_PORT} for readiness (up to 10s)...`);
  const portReady = await waitForPort("127.0.0.1", PROBE_PORT, 10_000);
  if (!portReady) {
    log(`FAIL: port ${PROBE_PORT} did not open within 10s`);
    killTugcast();
    clearTimeout(timeoutHandle);
    process.exit(1);
  }
  log(`Port ${PROBE_PORT} is accepting connections.`);

  // Step 2: connect the WebSocket immediately
  // NOTE: tugtalk's session_init is a one-shot broadcast. We must connect
  // here as quickly as possible to subscribe before it fires.
  log("\n=== Phase 1: First WebSocket connection ===");
  let ws1: WebSocket;
  try {
    ws1 = await connectWebSocket(WS_URL);
  } catch (e) {
    log(`FAIL: could not connect WebSocket: ${e}`);
    killTugcast();
    clearTimeout(timeoutHandle);
    process.exit(1);
  }

  // Step 3: wait for session_init from tugtalk (via CodeOutput feed)
  // Allow up to 15s for tugtalk to start and emit session_init.
  // If missed due to race, we proceed anyway and try to send a message.
  let sessionId: string | null = null;
  let sessionInitReceived = false;
  let nonCodeFeedsReceived = 0;

  log("Waiting for session_init (up to 15s)...");
  try {
    await collectUntil(ws1, (msg) => msg.type === "session_init", {
      timeoutMs: 15_000,
      onAnyFrame(feedId, payload) {
        if (feedId !== FeedId.CODE_OUTPUT && feedId !== FeedId.HEARTBEAT) {
          nonCodeFeedsReceived++;
          log(`  [feed 0x${feedId.toString(16).padStart(2, "0")} received — len=${payload.length}]`);
        }
      },
      onMessage(msg) {
        if (msg.type === "session_init") {
          sessionId = (msg.session_id as string) || null;
          sessionInitReceived = true;
          log(`  <<< session_init  session_id=${sessionId?.slice(0, 16)}...`);
        } else if (msg.type === "project_info") {
          log(`  <<< project_info  dir=${msg.project_dir}`);
        } else {
          log(`  <<< ${msg.type}`);
        }
      },
    });
    log(`Session established. session_id=${sessionId?.slice(0, 16)}...`);
  } catch (e) {
    log(`WARN: session_init not received within 15s: ${e}`);
    log(`  This likely means session_init was broadcast before we subscribed.`);
    log(`  Proceeding — will send user_message and see what happens.`);
  }

  // Step 4: send user_message
  log(`\n=== Phase 2: Sending user_message ===`);
  log(`>>> user_message: "${USER_MESSAGE}"`);
  ws1.send(codeInputFrame({ type: "user_message", text: USER_MESSAGE, attachments: [] }));

  // Step 5: collect response until turn_complete (up to 90s)
  log("Collecting response (up to 90s)...");
  let accumulatedText = "";
  let turnCompleteSeen = false;
  let partialCount = 0;

  try {
    await collectUntil(ws1, (msg) => msg.type === "turn_complete", {
      timeoutMs: 90_000,
      onMessage(msg) {
        if (msg.type === "assistant_text") {
          if (msg.is_partial) {
            const delta = (msg.text as string) || "";
            accumulatedText += delta;
            partialCount++;
            if (partialCount % 10 === 1) process.stdout.write(".");
          } else {
            accumulatedText = (msg.text as string) || accumulatedText;
            console.log("");
            log(`  <<< assistant_text [complete, len=${accumulatedText.length}]`);
            log(`      "${accumulatedText.slice(0, 200)}"`);
          }
        } else if (msg.type === "turn_complete") {
          turnCompleteSeen = true;
          console.log("");
          log(`  <<< turn_complete  result=${msg.result}`);
        } else if (msg.type === "cost_update") {
          log(`  <<< cost_update  $${(msg.total_cost_usd as number)?.toFixed(4)} (${msg.num_turns} turns)`);
        } else if (msg.type === "system_metadata") {
          log(`  <<< system_metadata  model=${msg.model}`);
        } else if (msg.type === "session_init") {
          // Got session_init late (after sending message)
          sessionId = (msg.session_id as string) || sessionId;
          sessionInitReceived = true;
          log(`  <<< session_init [late]  session_id=${sessionId?.slice(0, 16)}...`);
        } else if (msg.type === "error") {
          log(`  <<< error  message=${msg.message}  recoverable=${msg.recoverable}`);
        } else {
          log(`  <<< ${msg.type}`);
        }
      },
    });
  } catch (e) {
    log(`FAIL: did not receive turn_complete within 90s: ${e}`);
    ws1.close();
    killTugcast();
    clearTimeout(timeoutHandle);
    process.exit(1);
  }

  // Step 6: reconnection test — disconnect and reconnect
  log(`\n=== Phase 3: Reconnection test ===`);
  log("Closing first WebSocket connection...");
  ws1.close();
  await Bun.sleep(200);

  log("Reconnecting...");
  let ws2: WebSocket;
  try {
    ws2 = await connectWebSocket(WS_URL);
  } catch (e) {
    log(`FAIL: reconnect failed: ${e}`);
    killTugcast();
    clearTimeout(timeoutHandle);
    process.exit(1);
  }

  // After reconnect, listen for any frames for 5 seconds.
  // Expect snapshot feeds (filesystem, git, stats) but NOT session_init
  // (that was a one-shot broadcast — gone).
  let sessionId2: string | null = null;
  let gotAnyFrameAfterReconnect = false;
  let snapshotFeedsSeen: number[] = [];
  log("Listening for frames on reconnected socket (5s)...");

  const dec2 = new TextDecoder();
  const reconnectFrames = await new Promise<{ type: string; [k: string]: unknown }[]>((res) => {
    const msgs: { type: string; [k: string]: unknown }[] = [];

    const handler = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      try {
        const frame = decodeFrame(event.data);
        gotAnyFrameAfterReconnect = true;
        if (frame.feedId === FeedId.HEARTBEAT) {
          log("  [heartbeat]");
          return;
        }
        if (frame.feedId === FeedId.CODE_OUTPUT) {
          try {
            const msg = JSON.parse(dec2.decode(frame.payload)) as { type: string; [k: string]: unknown };
            msgs.push(msg);
            if (msg.type === "session_init") {
              sessionId2 = (msg.session_id as string) || null;
              log(`  <<< session_init  session_id=${sessionId2?.slice(0, 12)}...`);
            } else {
              log(`  <<< ${msg.type}`);
            }
          } catch {
            log(`  <<< CodeOutput [parse error]`);
          }
        } else {
          if (!snapshotFeedsSeen.includes(frame.feedId)) {
            snapshotFeedsSeen.push(frame.feedId);
          }
          log(`  [feed 0x${frame.feedId.toString(16).padStart(2, "0")} — len=${frame.payload.length}]`);
        }
      } catch (e) {
        log(`  [decode error] ${e}`);
      }
    };

    ws2.addEventListener("message", handler);
    setTimeout(() => {
      ws2.removeEventListener("message", handler);
      res(msgs);
    }, 5000);
  });

  ws2.close();

  // ---------------------------------------------------------------------------
  // Results summary
  // ---------------------------------------------------------------------------
  log("\n=== Probe results ===");
  log(`  1. tugcast launched on port ${PROBE_PORT}:        OK`);
  log(`  2. WebSocket connected (first):                OK`);
  log(`  3. session_init received:                      ${sessionInitReceived ? `OK (id=${sessionId?.slice(0, 16)}...)` : "MISSED (race: broadcast before subscribe)"}`);
  log(`  4. Snapshot feeds received (non-code):         ${nonCodeFeedsReceived > 0 ? `OK (${nonCodeFeedsReceived} frames)` : "none"}`);
  log(`  5. user_message sent:                          OK`);
  log(`  6. turn_complete received:                     ${turnCompleteSeen ? "OK" : "FAIL"}`);
  if (accumulatedText) {
    log(`     response: "${accumulatedText.slice(0, 100)}"`);
  }
  log(`  7. WebSocket reconnection:                     OK`);
  log(`  8. Frames after reconnect:                     ${gotAnyFrameAfterReconnect ? `OK (feeds: ${snapshotFeedsSeen.map(f => "0x" + f.toString(16)).join(", ")})` : "none"}`);
  log(`  9. session_init on reconnect:                  ${sessionId2 ? `seen (id=${sessionId2?.slice(0, 16)}...)` : "not seen (expected — one-shot event)"}`);

  const overallPass = turnCompleteSeen;
  if (overallPass) {
    log("\nPASS: end-to-end WebSocket path through tugcast is functional.");
  } else {
    log("\nFAIL: did not complete full turn — check logs above.");
  }

  killTugcast();
  clearTimeout(timeoutHandle);
  process.exit(overallPass ? 0 : 1);
}

runProbe().catch((err) => {
  log(`Unhandled error: ${err}`);
  killTugcast();
  process.exit(1);
});
