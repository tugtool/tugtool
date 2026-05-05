// Investigation: live/replay ordering during the replay window.
//
// Question: when `runReplay` is iterating its translator output and
// emitting events for a JSONL that ends with a trailing in-flight
// turn, the drain task is also forwarding live stream events from
// claude for the same in-flight turn. In what order do the two
// streams interleave on the wire? Does the reducer's existing
// accumulation produce the correct final state regardless of order?
//
// Methodology:
//   1. Build a `SessionManager` with a JSONL fixture: N committed
//      turns + a trailing in-flight turn (assistant entry with
//      `stop_reason: null`).
//   2. Inject a mock claude `stdout` stream (controllable from the
//      test).
//   3. Install an `ActiveTurn` directly via `(manager as any)`,
//      simulating the handleUserMessage path having installed it
//      before `request_replay` arrived.
//   4. Drive the scenario:
//        - Concurrently invoke `runReplay()`.
//        - Concurrently feed live stream events into the mock
//          claude stdout (drained into the active turn).
//   5. Capture every `writeLine` call to mocked Bun.stdout.
//   6. Inspect the captured wire trace. Report:
//        - Did replay events and live events arrive interleaved?
//        - In what pattern?
//        - Did both paths use the same msg_id for the trailing
//          turn? (Today: NO — replay uses claude's `message.id`,
//          live uses the tugcode UUID `ActiveTurn` was installed
//          with. This test confirms the divergence.)
//        - Does the reducer produce the right final state when
//          we replay the captured wire into a fresh
//          `CodeSessionStore`?

import { describe, expect, test } from "bun:test";

import {
  type JsonlReadResult,
  SessionManager,
} from "../session.ts";
import type { OutboundMessage } from "../types.ts";

// ---------------------------------------------------------------------------
// Mock stdout (mirrors the helper in replay-spawn-drain.test.ts)
// ---------------------------------------------------------------------------

interface MockClaudeStdout {
  stream: ReadableStream<Uint8Array>;
  feed(obj: unknown): void;
  close(): void;
}

function makeMockClaudeStdout(): MockClaudeStdout {
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controllerRef = c;
    },
  });
  const enc = new TextEncoder();
  return {
    stream,
    feed(obj: unknown): void {
      if (controllerRef === null) {
        throw new Error("MockClaudeStdout: feed() called before stream start");
      }
      controllerRef.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
    },
    close(): void {
      if (controllerRef === null) {
        throw new Error("MockClaudeStdout: close() called before stream start");
      }
      controllerRef.close();
    },
  };
}

// ---------------------------------------------------------------------------
// JSONL fixture for E2: 1 committed turn + 1 trailing in-flight turn.
// The in-flight turn has stop_reason: null in the most recent assistant
// block, which the translator's orphan-synthesis path will react to.
// ---------------------------------------------------------------------------

const COMMITTED_USER_TEXT = "first prompt";
const COMMITTED_REPLY_TEXT = "first reply";
const COMMITTED_MSG_ID = "msg_committed_1";
const INFLIGHT_USER_TEXT = "second prompt";
const INFLIGHT_REPLY_TEXT_FROM_JSONL = "partial reply from JSONL";
const INFLIGHT_CLAUDE_MSG_ID = "msg_inflight_claude_id_2";

function fixtureJsonl(): string {
  const lines = [
    {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: COMMITTED_USER_TEXT }] },
    },
    {
      type: "assistant",
      message: {
        id: COMMITTED_MSG_ID,
        role: "assistant",
        model: "claude-haiku-4-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: COMMITTED_REPLY_TEXT }],
      },
    },
    {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: INFLIGHT_USER_TEXT }] },
    },
    {
      type: "assistant",
      message: {
        id: INFLIGHT_CLAUDE_MSG_ID,
        role: "assistant",
        model: "claude-haiku-4-5",
        // stop_reason: null → translator treats as orphan; either
        // synthesizes turn_complete{interrupted} or skips per the
        // active-turn-handoff hint (today: synthesizes).
        stop_reason: null,
        content: [{ type: "text", text: INFLIGHT_REPLY_TEXT_FROM_JSONL }],
      },
    },
  ];
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Wire capture (mirrors the rig in replay-spawn-drain.test.ts)
// ---------------------------------------------------------------------------

interface E2Rig {
  manager: SessionManager;
  stdout: MockClaudeStdout;
  emitted: OutboundMessage[];
  flush(): Promise<void>;
  cleanup(): void;
}

function makeE2Rig(): E2Rig {
  const stdout = makeMockClaudeStdout();
  const stderr = new ReadableStream<Uint8Array>({
    start(c) {
      c.close();
    },
  });

  const sessionId = crypto.randomUUID();
  const projectDir = `/tmp/e2-mid-turn-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const manager = new SessionManager(
    projectDir,
    sessionId,
    "resume",
    undefined,
    {
      claudeProjectsRoot: "/tmp/e2-mid-turn-fixtures",
      jsonlReader: async (): Promise<JsonlReadResult> => ({
        kind: "ok" as const,
        jsonl: fixtureJsonl(),
      }),
      replayTimeoutMs: 10_000,
    },
  );

  // Inject mock claude child.
  const mockChild = {
    stdout: stdout.stream,
    stderr,
    stdin: { write: () => {}, end: () => {}, flush: () => {} },
    exited: new Promise<number>(() => {}),
    kill: () => {},
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (manager as any).spawnClaude = () => mockChild;

  const emitted: OutboundMessage[] = [];
  const originalWrite = Bun.write;
  const decoder = new TextDecoder();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Bun as any).write = (dest: unknown, data: unknown) => {
    if (dest === Bun.stdout) {
      let text = "";
      if (typeof data === "string") text = data;
      else if (data instanceof Uint8Array) text = decoder.decode(data);
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          try {
            emitted.push(JSON.parse(trimmed) as OutboundMessage);
          } catch {
            // ignore
          }
        }
      }
    }
    return Promise.resolve(
      data instanceof Uint8Array ? data.length : (data as string).length,
    );
  };

  const originalExit = process.exit;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).exit = (_code?: number) => {};

  return {
    manager,
    stdout,
    emitted,
    async flush() {
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    },
    cleanup() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).write = originalWrite;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process as any).exit = originalExit;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests / observation
// ---------------------------------------------------------------------------

describe("E2 — live/replay ordering during the replay window", () => {
  test("baseline: replay alone (no concurrent live drain) emits the bracket plus orphan synthesis for the trailing turn", async () => {
    const rig = makeE2Rig();
    try {
      rig.manager.prepareSession();
      // Skip claude spawn; we just want to see what runReplay emits
      // for our fixture in isolation. The drain isn't running yet,
      // so no live events compete for the wire.
      await rig.manager.runReplay();
      await rig.flush();

      const types = rig.emitted.map((m) => m.type);
      // We expect: replay_started, then events for the committed
      // turn (user_message_replay + assistant_text + turn_complete),
      // then events for the trailing in-flight turn (user_message_
      // replay + ... + a synthesized turn_complete{error:
      // "interrupted"} per [D08]), then replay_complete.
      expect(types).toContain("replay_started");
      expect(types).toContain("replay_complete");
      expect(types).toContain("user_message_replay");

      // Inspect the ids the translator emitted. We expect ALL events
      // for the trailing turn to use claude's `message.id` from the
      // JSONL (`INFLIGHT_CLAUDE_MSG_ID`).
      const trailingEvents = rig.emitted.filter(
        (m) => "msg_id" in m && m.msg_id === INFLIGHT_CLAUDE_MSG_ID,
      );
      console.log(
        `[E2 baseline] trailing-turn events: ${trailingEvents.length} (should be ≥1)`,
      );
      console.log(
        `[E2 baseline] trailing-turn types: ${JSON.stringify(trailingEvents.map((e) => e.type))}`,
      );
      expect(trailingEvents.length).toBeGreaterThan(0);
    } finally {
      rig.cleanup();
    }
  });

  test("interleaved: ActiveTurn installed; runReplay + drain forwarding both fire for the same in-flight turn", async () => {
    const rig = makeE2Rig();
    try {
      rig.manager.prepareSession();
      await rig.manager.spawnClaudeAndWatch();

      // Install an ActiveTurn manually — this simulates
      // handleUserMessage having received the user_message before
      // request_replay arrived. The activeTurn's msgId is tugcode's
      // UUID (`newMsgId()` mints fresh UUIDs); the JSONL trailing
      // turn's id is `INFLIGHT_CLAUDE_MSG_ID`. The IDs DIVERGE.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ActiveTurnCtor = (await import("../session.ts" as string)) as unknown as {
        // The class is file-private; we reach for it via the
        // running manager's existing surface instead.
      };
      void ActiveTurnCtor; // silence

      // The cleanest way to install an active turn is to call
      // handleUserMessage. But that writes to claude.stdin and
      // awaits completion forever. So we reach in directly:
      // construct an `ActiveTurn`-shaped object by copying the
      // shape from session.ts and assign it.
      let resolveCompletion: (() => void) | null = null;
      const completion = new Promise<void>((r) => {
        resolveCompletion = r;
      });
      const tugcodeUuid = crypto.randomUUID();
      const activeTurnSurrogate = {
        msgId: tugcodeUuid,
        seq: 100,
        rev: 0,
        partialText: "",
        gotResult: false,
        interrupted: false,
        completion,
        finish() {
          if (resolveCompletion !== null) {
            resolveCompletion();
            resolveCompletion = null;
          }
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = activeTurnSurrogate;

      // Concurrently:
      //   - runReplay (reads JSONL fixture; emits replay events).
      //   - Feed live stream events into the drain (claude is
      //     mid-stream for the in-flight turn, with claude's id).
      // The interleaving on the wire is what we want to observe.

      const replayPromise = rig.manager.runReplay();

      // Feed a delta of the in-flight turn's reply.
      rig.stdout.feed({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: " continuing… " },
        },
      });
      await rig.flush();

      // Feed a few more.
      rig.stdout.feed({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "more text" },
        },
      });
      await rig.flush();

      // Wait for runReplay to finish. The drain is still alive but
      // we won't feed it the result event — we just want to see
      // what was on the wire during replay.
      await replayPromise;
      await rig.flush();

      // Resolve the active turn so handleUserMessage's await would
      // unblock (defensive — the surrogate isn't actually being
      // awaited by anyone in the test, but releasing it lets the
      // promise GC).
      activeTurnSurrogate.finish();

      // ---- OBSERVATION ----
      console.log("\n[E2 interleaved] full wire trace:");
      for (const m of rig.emitted) {
        const msgId = "msg_id" in m ? (m as { msg_id?: string }).msg_id : null;
        console.log(`  type=${m.type}${msgId ? ` msg_id=${msgId}` : ""}`);
      }

      const types = rig.emitted.map((m) => m.type);
      expect(types).toContain("replay_started");
      expect(types).toContain("replay_complete");

      // Did replay and live both emit for the in-flight turn? Show
      // the ids each path used. Live events use the tugcode UUID
      // (active turn's msgId); replay events use claude's id from
      // the JSONL fixture.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const replaySideForInflight = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === INFLIGHT_CLAUDE_MSG_ID,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const liveSideForInflight = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === tugcodeUuid,
      );
      console.log(
        `[E2 interleaved] events with claude-id (replay path): ${replaySideForInflight.length}`,
      );
      console.log(
        `[E2 interleaved] events with tugcode-uuid (live path): ${liveSideForInflight.length}`,
      );

      // The msg_id divergence is the load-bearing observation:
      // BOTH paths emitted events for the same logical turn, with
      // DIFFERENT ids. A reducer that keys by msg_id sees TWO
      // turns. This is exactly the bug the design phase has to
      // address.
      if (replaySideForInflight.length > 0 && liveSideForInflight.length > 0) {
        console.log(
          "[E2 interleaved] MSG_ID DIVERGENCE CONFIRMED: live events and replay events for the same in-flight turn use different msg_ids.",
        );
      }
    } finally {
      rig.cleanup();
    }
  });
});
