// Mid-turn replay regression suite (Smoke D).
//
// Pins the post-fix contract for the mid-turn reload scenario:
// when a user reloads while claude is mid-stream, runReplay snapshots
// the active turn, suppresses live emit during the bracket window,
// threads `liveInflightMsgId` into the JSONL translator (which skips
// the trailing in-flight turn on match), and emits one consolidated
// in-flight block — `user_message_replay` + `assistant_text` (and a
// terminal event when the turn already finished while suppressed) —
// from authoritative `ActiveTurn` state. Live and replay agree on
// claude's `message.id` (canonicalized in the dispatch path) so the
// reducer's existing msg_id dedupe stitches the two halves into one
// TurnEntry.
//
// Test surface:
//   - Build a `SessionManager` with a JSONL fixture (one committed
//     turn + one trailing in-flight turn).
//   - Inject a mock claude stdout so we can capture exactly what
//     tugcode emits on the wire during runReplay.
//   - Install an `ActiveTurn` surrogate to simulate the
//     handleUserMessage path.
//   - Invoke `runReplay()` and assert the wire ordering:
//     replay_started → committed turn → in-flight emission →
//     replay_complete.

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
// Mid-turn replay regression: runReplay snapshots active turn, threads
// liveInflightMsgId into the translator, suppresses live emit during the
// bracket, fills in the in-flight content from ActiveTurn state, then
// closes the bracket.
//
// Investigation tests that documented the pre-fix msg_id divergence
// were removed when Step 4 promoted this file to a permanent regression
// suite. The verdicts they captured live in the plan's [E2] section.
// ---------------------------------------------------------------------------

/**
 * Build an ActiveTurn-shaped surrogate that fully matches the methods
 * dispatchEventToTurn / signalEofToActiveTurn / emitInflightTurnFromActiveTurn
 * call. The class is file-private to session.ts; we shape-mirror it here.
 */
function makeActiveTurnSurrogate(opts: {
  msgId: string;
  userText: string;
  userAttachments?: Array<{ filename: string; content: string; media_type: string }>;
  msgIdCanonicalized?: boolean;
}): {
  msgId: string;
  seq: number;
  userText: string;
  userAttachments: Array<{ filename: string; content: string; media_type: string }>;
  rev: number;
  partialText: string;
  gotResult: boolean;
  interrupted: boolean;
  suppressEmit: boolean;
  msgIdCanonicalized: boolean;
  completion: Promise<void>;
  canonicalizeMsgId(claudeMessageId: string): boolean;
  finish(): void;
} {
  let resolveCompletion: (() => void) | null = null;
  const completion = new Promise<void>((r) => {
    resolveCompletion = r;
  });
  return {
    msgId: opts.msgId,
    seq: 100,
    userText: opts.userText,
    userAttachments: opts.userAttachments ?? [],
    rev: 0,
    partialText: "",
    gotResult: false,
    interrupted: false,
    suppressEmit: false,
    msgIdCanonicalized: opts.msgIdCanonicalized ?? true,
    completion,
    canonicalizeMsgId(claudeMessageId: string): boolean {
      if (this.msgIdCanonicalized) return false;
      this.msgId = claudeMessageId;
      this.msgIdCanonicalized = true;
      return true;
    },
    finish(): void {
      if (resolveCompletion !== null) {
        resolveCompletion();
        resolveCompletion = null;
      }
    },
  };
}

describe("runReplay with in-flight turn (mid-turn replay design)", () => {
  test("Smoke D: trailing turn skipped + in-flight emitted from ActiveTurn between committed turn and replay_complete", async () => {
    const rig = makeE2Rig();
    try {
      rig.manager.prepareSession();

      // Install an active turn whose msgId matches the JSONL trailing
      // turn's claude id (per Step 1, ActiveTurn.msgId is canonicalized
      // from claude's message.id; in the integration scenario this
      // happened the moment the first message_start arrived).
      const turn = makeActiveTurnSurrogate({
        msgId: INFLIGHT_CLAUDE_MSG_ID,
        userText: INFLIGHT_USER_TEXT,
      });
      // Simulate the drain having accumulated some partialText pre-replay.
      turn.partialText = "live deltas so far";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = turn;

      await rig.manager.runReplay();
      await rig.flush();

      const types = rig.emitted.map((m) => m.type);
      expect(types).toContain("replay_started");
      expect(types).toContain("replay_complete");
      // Verify ordering: replay_started precedes replay_complete; no
      // replay_started after replay_complete.
      const startedIdx = types.indexOf("replay_started");
      const completeIdx = types.indexOf("replay_complete");
      expect(startedIdx).toBeLessThan(completeIdx);

      // Trailing turn from JSONL is skipped — the only events keyed by
      // the in-flight id are the synthesized ones from ActiveTurn.
      const inflightEvents = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === INFLIGHT_CLAUDE_MSG_ID,
      );
      const inflightTypes = inflightEvents.map((e) => e.type);

      // Expected synthesized block: user_message_replay + assistant_text.
      // No turn_complete (still-live; gotResult=false / interrupted=false).
      expect(inflightTypes).toEqual(["user_message_replay", "assistant_text"]);
      const userReplay = inflightEvents[0] as any;
      expect(userReplay.text).toBe(INFLIGHT_USER_TEXT);
      const assistantText = inflightEvents[1] as any;
      expect(assistantText.text).toBe("live deltas so far");
      expect(assistantText.is_partial).toBe(false);

      // Ordering: in-flight emission lands BETWEEN the last committed
      // turn's events and replay_complete.
      const lastCommittedIdx = rig.emitted.findIndex(
        (m, i) =>
          i > 0 &&
          "msg_id" in m &&
          (m as { msg_id?: string }).msg_id === COMMITTED_MSG_ID &&
          m.type === "turn_complete",
      );
      const inflightFirstIdx = rig.emitted.findIndex(
        (m) =>
          "msg_id" in m &&
          (m as { msg_id?: string }).msg_id === INFLIGHT_CLAUDE_MSG_ID,
      );
      const replayCompleteIdx = rig.emitted.findIndex(
        (m) => m.type === "replay_complete",
      );
      expect(lastCommittedIdx).toBeGreaterThanOrEqual(0);
      expect(inflightFirstIdx).toBeGreaterThan(lastCommittedIdx);
      expect(replayCompleteIdx).toBeGreaterThan(inflightFirstIdx);

      // replay_complete count reflects only the committed turn (the
      // in-flight turn's terminal hasn't fired yet — that's the whole
      // point of "still live").
      const completeFrame = rig.emitted[replayCompleteIdx] as any;
      expect(completeFrame.count).toBe(1);

      // suppressEmit cleared.
      expect(turn.suppressEmit).toBe(false);
    } finally {
      rig.cleanup();
    }
  });

  test("[DM06] mitigation: gotResult latching during the suppressed window emits turn_complete inside the bracket", async () => {
    // Pitfall from [DM06]: claude crashes (or completes) while
    // suppressEmit=true. The drain's signalEofToActiveTurn or
    // dispatchEventToTurn latches gotResult / interrupted but skips
    // its writeLine. Without the terminal-event branches in
    // emitInflightTurnFromActiveTurn, the synthesized block would
    // emit user_message_replay + assistant_text + (nothing) and
    // the reducer's TurnEntry would dangle.
    //
    // Deterministic simulation: hook the surrogate's suppressEmit
    // setter so the moment runReplay flips it true, gotResult flips
    // true too — modeling "claude's result arrived during the
    // bracket window".
    const rig = makeE2Rig();
    try {
      rig.manager.prepareSession();

      const turn = makeActiveTurnSurrogate({
        msgId: INFLIGHT_CLAUDE_MSG_ID,
        userText: INFLIGHT_USER_TEXT,
      });
      turn.partialText = "the complete answer";
      let suppressBacking = false;
      Object.defineProperty(turn, "suppressEmit", {
        configurable: true,
        get(): boolean {
          return suppressBacking;
        },
        set(v: boolean) {
          suppressBacking = v;
          if (v === true) {
            // Mid-bracket: claude's result event landed.
            this.gotResult = true;
          }
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = turn;

      await rig.manager.runReplay();
      await rig.flush();

      const inflightEvents = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === INFLIGHT_CLAUDE_MSG_ID,
      );
      expect(inflightEvents.map((e) => e.type)).toEqual([
        "user_message_replay",
        "assistant_text",
        "turn_complete",
      ]);
      const tc = inflightEvents[2] as any;
      expect(tc.result).toBe("success");
      expect(tc.msg_id).toBe(INFLIGHT_CLAUDE_MSG_ID);

      // turn_complete lands BEFORE replay_complete (inside the bracket).
      const tcIdx = rig.emitted.findIndex(
        (m: any) => m.type === "turn_complete" && m.msg_id === INFLIGHT_CLAUDE_MSG_ID,
      );
      const replayCompleteIdx = rig.emitted.findIndex(
        (m) => m.type === "replay_complete",
      );
      expect(tcIdx).toBeGreaterThanOrEqual(0);
      expect(tcIdx).toBeLessThan(replayCompleteIdx);
    } finally {
      rig.cleanup();
    }
  });

  test("[DM06] mitigation: interrupted latching during the suppressed window emits turn_cancelled inside the bracket", async () => {
    // Symmetric to the gotResult test above: an interrupt landed
    // while suppressEmit=true. The interrupted branch in
    // emitInflightTurnFromActiveTurn synthesizes turn_cancelled.
    const rig = makeE2Rig();
    try {
      rig.manager.prepareSession();

      const turn = makeActiveTurnSurrogate({
        msgId: INFLIGHT_CLAUDE_MSG_ID,
        userText: INFLIGHT_USER_TEXT,
      });
      turn.partialText = "I was halfway through";
      let suppressBacking = false;
      Object.defineProperty(turn, "suppressEmit", {
        configurable: true,
        get(): boolean {
          return suppressBacking;
        },
        set(v: boolean) {
          suppressBacking = v;
          if (v === true) {
            this.interrupted = true;
          }
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = turn;

      await rig.manager.runReplay();
      await rig.flush();

      const inflightEvents = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === INFLIGHT_CLAUDE_MSG_ID,
      );
      expect(inflightEvents.map((e) => e.type)).toEqual([
        "user_message_replay",
        "assistant_text",
        "turn_cancelled",
      ]);
      const tcanc = inflightEvents[2] as any;
      expect(tcanc.partial_result).toBe("I was halfway through");
      expect(tcanc.msg_id).toBe(INFLIGHT_CLAUDE_MSG_ID);
    } finally {
      rig.cleanup();
    }
  });

  test("no active turn: cold-boot replay path preserved; orphan synthesizes for trailing in-flight turn", async () => {
    const rig = makeE2Rig();
    try {
      rig.manager.prepareSession();

      // No activeTurn installed → liveInflightMsgId is undefined →
      // translator's orphan-synthesis fires for the JSONL trailing
      // turn (preserves [D08] / cold-boot interrupted-session
      // contract).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = null;

      await rig.manager.runReplay();
      await rig.flush();

      const inflightEvents = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === INFLIGHT_CLAUDE_MSG_ID,
      );
      const types = inflightEvents.map((e) => e.type);
      // Translator emits the orphan synthesis: user_message_replay +
      // assistant_text + turn_complete{result: "error"}.
      expect(types).toContain("user_message_replay");
      expect(types).toContain("turn_complete");
      const tc = inflightEvents.find((m) => m.type === "turn_complete") as any;
      expect(tc.result).toBe("error");
    } finally {
      rig.cleanup();
    }
  });

  test("active turn already finished (gotResult=true at entry): runReplay does NOT adopt it, orphan synthesis preserved", async () => {
    // Tight-window edge: dispatchEventToTurn just latched gotResult
    // and called turn.finish(), but handleUserMessage's finally hasn't
    // cleared activeTurn yet. runReplay's adoption guard
    // (`!gotResult && !interrupted`) excludes this case, so the
    // translator's normal trailing-turn handling fires (orphan
    // synthesis, since the JSONL still has stop_reason: null).
    const rig = makeE2Rig();
    try {
      rig.manager.prepareSession();

      const turn = makeActiveTurnSurrogate({
        msgId: INFLIGHT_CLAUDE_MSG_ID,
        userText: INFLIGHT_USER_TEXT,
      });
      turn.gotResult = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = turn;

      await rig.manager.runReplay();
      await rig.flush();

      // suppressEmit was never set on this turn (runReplay didn't
      // adopt it).
      expect(turn.suppressEmit).toBe(false);

      // Translator orphan-synthesized the trailing turn from JSONL.
      const inflightEvents = rig.emitted.filter(
        (m): m is OutboundMessage & { msg_id: string } =>
          "msg_id" in m && (m as { msg_id?: string }).msg_id === INFLIGHT_CLAUDE_MSG_ID,
      );
      const tc = inflightEvents.find((m) => m.type === "turn_complete") as any;
      expect(tc).toBeDefined();
      expect(tc.result).toBe("error");
    } finally {
      rig.cleanup();
    }
  });

  test("post-bracket live deltas land normally after suppressEmit clears", async () => {
    // Backstop for the suppressEmit lifecycle: after runReplay's
    // bracket closes (and the finally clears suppressEmit), live
    // deltas dispatched into the same ActiveTurn writeLine normally.
    // Combined with the unit test "text delta with suppress=true: no
    // wire emit" in session.test.ts, this covers the full suppress
    // → unsuppress lifecycle without depending on fragile
    // mid-bracket-feed timing.
    const rig = makeE2Rig();
    try {
      rig.manager.prepareSession();
      await rig.manager.spawnClaudeAndWatch();

      const turn = makeActiveTurnSurrogate({
        msgId: INFLIGHT_CLAUDE_MSG_ID,
        userText: INFLIGHT_USER_TEXT,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rig.manager as any).activeTurn = turn;

      await rig.manager.runReplay();
      await rig.flush();

      // After runReplay, suppressEmit cleared.
      expect(turn.suppressEmit).toBe(false);

      // A post-bracket delta should writeLine as the normal partial
      // assistant_text shape.
      rig.stdout.feed({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "POST_BRACKET_DELTA" },
        },
      });
      await rig.flush();
      const postBracketPartials = rig.emitted.filter(
        (m: any) =>
          m.type === "assistant_text" &&
          m.msg_id === INFLIGHT_CLAUDE_MSG_ID &&
          m.is_partial === true &&
          m.text === "POST_BRACKET_DELTA",
      );
      expect(postBracketPartials).toHaveLength(1);
    } finally {
      rig.cleanup();
    }
  });
});
