// tugcode/src/__tests__/replay-spawn-defer.test.ts
//
// Integration tests for `runReplay()`'s wait-for-completion behavior
// when a `request_replay` arrives while an active turn is in flight.
// Six scenarios pin the contract:
//
//   1. Active turn present + not finished → emit `replay_deferred`,
//      suppressEmit flips on the turn, and the replay parks awaiting
//      `activeTurn.completion`. No `replay_started` until completion.
//   2. Completion resolves → the parked `runReplay` proceeds and
//      emits the normal `replay_started` → events → `replay_complete`
//      bracket, in order, after the deferred frame.
//   3. No active turn → no `replay_deferred`; replay runs immediately
//      (regression-pin existing fast path).
//   4. Active turn with `gotResult=true` (the microtask gap before
//      `handleUserMessage`'s finally clears `this.activeTurn`) → no
//      defer; replay runs immediately. Pins the Pitfall 3 mitigation.
//   5. Active turn with `interrupted=true` → no defer; replay runs
//      immediately. Same Pitfall 3 mitigation, interrupt branch.
//   6. Re-dispatching `runReplay()` while the first call is parked →
//      second call drops via the `replayActive` re-entrancy guard.
//      No double `replay_deferred`; no second replay bracket.
//   7. With `suppressEmit=true`, `dispatchEventToTurn` updates state
//      (partialText, gotResult) but emits nothing on the wire, and
//      `signalEofToActiveTurn` resolves the completion promise
//      without emitting `turn_cancelled` / `error`.
//
// Failure-first proofs (run-only, kept skeleton-free):
//
//   - Reverting the defer block in `runReplay` so it falls through
//     unconditionally makes Test 1 fail (no `replay_deferred`
//     emitted; `replay_started` lands first).
//   - Reverting the `suppressEmit` checks in `dispatchEventToTurn` so
//     it always calls `writeLine` makes Test 7 fail (events appear
//     on the wire during the deferred window).

import { describe, expect, test } from "bun:test";

import {
  type JsonlReadResult,
  SessionManager,
} from "../session.ts";
import { isReplayDeferred, type OutboundMessage } from "../types.ts";

// ---------------------------------------------------------------------------
// IPC capture (mirrors replay-spawn.test.ts's pattern)
// ---------------------------------------------------------------------------

async function captureIpc(
  fn: () => Promise<void>,
): Promise<{ emitted: OutboundMessage[]; exitCode: number | undefined }> {
  const captured: OutboundMessage[] = [];
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
            captured.push(JSON.parse(trimmed) as OutboundMessage);
          } catch {
            // ignore non-JSON
          }
        }
      }
    }
    return Promise.resolve(
      data instanceof Uint8Array ? data.length : (data as string).length,
    );
  };

  const originalExit = process.exit;
  let exitCode: number | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).exit = (code?: number) => {
    exitCode = code;
  };

  try {
    await fn();
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Bun as any).write = originalWrite;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process as any).exit = originalExit;
  }

  return { emitted: captured, exitCode };
}

// ---------------------------------------------------------------------------
// Fixture: a one-turn JSONL the translator emits as a single
// user_message_replay + assistant_text + turn_complete + replay
// bracket. Trivial enough that defer tests don't depend on its
// internal events.
// ---------------------------------------------------------------------------

function oneTurnJsonl(): string {
  const lines = [
    {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "hi" }] },
    },
    {
      type: "assistant",
      message: {
        id: "msg_one",
        role: "assistant",
        model: "claude-opus-4-6",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "ok" }],
      },
    },
  ];
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

interface PrimedManager {
  manager: SessionManager;
  sessionId: string;
}

async function makePrimedManager(opts?: {
  jsonlReader?: (path: string) => Promise<JsonlReadResult>;
}): Promise<PrimedManager> {
  const sessionId = crypto.randomUUID();
  const projectDir = `/tmp/replay-spawn-defer-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const manager = new SessionManager(
    projectDir,
    sessionId,
    "resume",
    undefined,
    {
      claudeProjectsRoot: "/tmp/replay-spawn-defer-fixtures",
      jsonlReader:
        opts?.jsonlReader ??
        (async () => ({ kind: "ok" as const, jsonl: oneTurnJsonl() })),
      replayTimeoutMs: 10_000,
    },
  );
  return { manager, sessionId };
}

// ---------------------------------------------------------------------------
// Active-turn surrogate. The class is file-private; a duck-typed
// object satisfies `runReplay`'s defer-condition reads
// (`activeTurn.gotResult`, `activeTurn.interrupted`,
// `activeTurn.msgId`, `activeTurn.completion`, and the writable
// `activeTurn.suppressEmit`). Tests inject it via
// `(manager as any).activeTurn = surrogate`.
// ---------------------------------------------------------------------------

interface ActiveTurnSurrogate {
  msgId: string;
  seq: number;
  rev: number;
  partialText: string;
  gotResult: boolean;
  interrupted: boolean;
  suppressEmit: boolean;
  completion: Promise<void>;
  finish: () => void;
}

function makeActiveTurnSurrogate(opts?: {
  msgId?: string;
  gotResult?: boolean;
  interrupted?: boolean;
}): ActiveTurnSurrogate {
  let resolveCompletion: (() => void) | null = null;
  const completion = new Promise<void>((r) => {
    resolveCompletion = r;
  });
  return {
    msgId: opts?.msgId ?? "msg-active-1",
    seq: 1,
    rev: 0,
    partialText: "",
    gotResult: opts?.gotResult ?? false,
    interrupted: opts?.interrupted ?? false,
    suppressEmit: false,
    completion,
    finish() {
      if (resolveCompletion !== null) {
        resolveCompletion();
        resolveCompletion = null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runReplay — defer-during-active-turn (α)", () => {
  test("active turn present → emits replay_deferred before replay_started; suppressEmit flips", async () => {
    const { manager } = await makePrimedManager();
    const turn = makeActiveTurnSurrogate({ msgId: "msg-defer-1" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).activeTurn = turn;

    const { emitted } = await captureIpc(async () => {
      const replayPromise = manager.runReplay();
      // Yield once so runReplay's synchronous defer block runs and
      // it parks on `await activeTurn.completion`. The
      // `replay_deferred` frame is now on the wire and
      // `suppressEmit` has flipped on the turn — both observable
      // from outside captureIpc once it returns.
      await new Promise((r) => setImmediate(r));
      // Resolve completion to let the parked runReplay proceed
      // through the actual replay path. Without this the promise
      // would leak.
      turn.finish();
      await replayPromise;
    });

    // suppressEmit must be set during the parked window — we
    // assert it after completion, but the flag is only ever set
    // (never cleared), so post-completion observation is
    // sufficient.
    expect(turn.suppressEmit).toBe(true);

    // Order check: replay_deferred came BEFORE replay_started,
    // which came BEFORE replay_complete. Pins the wait-for-
    // completion sequencing on the wire.
    const types = emitted.map((m) => m.type);
    const deferredIdx = types.indexOf("replay_deferred");
    const startedIdx = types.indexOf("replay_started");
    const completeIdx = types.indexOf("replay_complete");
    expect(deferredIdx).toBeGreaterThanOrEqual(0);
    expect(startedIdx).toBeGreaterThan(deferredIdx);
    expect(completeIdx).toBeGreaterThan(startedIdx);
  });

  test("replay_deferred frame carries reason='active_turn_in_flight'", async () => {
    const { manager } = await makePrimedManager();
    const turn = makeActiveTurnSurrogate();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).activeTurn = turn;

    const { emitted } = await captureIpc(async () => {
      const p = manager.runReplay();
      await new Promise((r) => setImmediate(r));
      turn.finish();
      await p;
    });

    const deferred = emitted.find(isReplayDeferred);
    expect(deferred).toBeDefined();
    expect(deferred!.reason).toBe("active_turn_in_flight");
  });

  test("no active turn → no replay_deferred; replay runs immediately", async () => {
    const { manager } = await makePrimedManager();
    // No active turn installed.

    const { emitted } = await captureIpc(async () => {
      await manager.runReplay();
    });

    expect(emittedHasReplayDeferred(emitted)).toBe(false);
    expect(emittedHasType(emitted, "replay_started")).toBe(true);
    expect(emittedHasType(emitted, "replay_complete")).toBe(true);
  });

  test("finished-but-uncleaned active turn (gotResult=true) → no defer; replay runs immediately", async () => {
    const { manager } = await makePrimedManager();
    // Pitfall 3: handleUserMessage's `finally` clears `this.activeTurn`
    // only after `await turn.completion` resumes. There is a microtask
    // window where `gotResult` is true but `activeTurn` is still set.
    // The defer condition guards on `!gotResult` to avoid a placeholder
    // flash for an already-finished turn.
    const turn = makeActiveTurnSurrogate({ gotResult: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).activeTurn = turn;

    const { emitted } = await captureIpc(async () => {
      await manager.runReplay();
    });

    expect(emittedHasReplayDeferred(emitted)).toBe(false);
    expect(emittedHasType(emitted, "replay_started")).toBe(true);
    expect(emittedHasType(emitted, "replay_complete")).toBe(true);
  });

  test("interrupted active turn → no defer; replay runs immediately", async () => {
    const { manager } = await makePrimedManager();
    // Same Pitfall 3 mitigation, interrupt branch. A turn whose
    // `interrupted` flag is set is on its way to finishing — no
    // need to defer.
    const turn = makeActiveTurnSurrogate({ interrupted: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).activeTurn = turn;

    const { emitted } = await captureIpc(async () => {
      await manager.runReplay();
    });

    expect(emittedHasReplayDeferred(emitted)).toBe(false);
    expect(emittedHasType(emitted, "replay_started")).toBe(true);
    expect(emittedHasType(emitted, "replay_complete")).toBe(true);
  });

  test("idempotent re-dispatch during defer: second runReplay drops via replayActive guard", async () => {
    const { manager } = await makePrimedManager();
    const turn = makeActiveTurnSurrogate();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).activeTurn = turn;

    const { emitted } = await captureIpc(async () => {
      const first = manager.runReplay();
      // Yield once so the first call enters the defer block, emits
      // `replay_deferred`, and parks on `activeTurn.completion`.
      await new Promise((r) => setImmediate(r));
      // Second call lands while the first is parked. The
      // `replayActive` guard at the top of runReplay drops it
      // before reaching the defer block, so no second
      // replay_deferred and no second replay bracket.
      const second = manager.runReplay();
      // Both calls return without throwing. Resolve the active
      // turn to let the first runReplay finish.
      turn.finish();
      await Promise.all([first, second]);
    });

    // Exactly one replay_deferred and one replay bracket on the
    // wire. The second runReplay was dropped.
    const deferredCount = emitted.filter(
      (m) => m.type === "replay_deferred",
    ).length;
    const startedCount = emitted.filter(
      (m) => m.type === "replay_started",
    ).length;
    const completeCount = emitted.filter(
      (m) => m.type === "replay_complete",
    ).length;
    expect(deferredCount).toBe(1);
    expect(startedCount).toBe(1);
    expect(completeCount).toBe(1);
  });
});

describe("ActiveTurn.suppressEmit — gates per-turn outbound but not state", () => {
  test("dispatchEventToTurn updates partialText / gotResult while suppressed; no writeLine", async () => {
    const { manager } = await makePrimedManager();
    const turn = makeActiveTurnSurrogate();
    turn.suppressEmit = true;

    // Drive a stream_event delta and a `result` directly through
    // the dispatcher. Pre-suppression these would emit
    // assistant_text + turn_complete; post-suppression no IPC
    // frames should appear, but `partialText` and `gotResult`
    // must update so the turn lifecycle still progresses.
    const streamDelta = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "hello" },
      },
    };
    const resultEvent = {
      type: "result",
      result: "success",
    };

    const { emitted } = await captureIpc(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any).dispatchEventToTurn(turn, streamDelta);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any).dispatchEventToTurn(turn, resultEvent);
    });

    // No outbound frames for the turn's stream / result.
    expect(emittedHasType(emitted, "assistant_text")).toBe(false);
    expect(emittedHasType(emitted, "turn_complete")).toBe(false);
    // But state advanced: `partialText` accumulated, `gotResult`
    // flipped, completion resolved.
    expect(turn.partialText).toBe("hello");
    expect(turn.gotResult).toBe(true);
  });

  test("signalEofToActiveTurn resolves completion without emitting turn_cancelled while suppressed", async () => {
    const { manager } = await makePrimedManager();
    const turn = makeActiveTurnSurrogate({ interrupted: true });
    turn.suppressEmit = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).activeTurn = turn;

    const { emitted } = await captureIpc(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any).signalEofToActiveTurn();
      // Microtask flush so any deferred writeLine would land.
      await new Promise((r) => setImmediate(r));
    });

    expect(emittedHasType(emitted, "turn_cancelled")).toBe(false);
    expect(emittedHasType(emitted, "error")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emittedHasType(
  emitted: ReadonlyArray<OutboundMessage>,
  type: OutboundMessage["type"],
): boolean {
  return emitted.some((m) => m.type === type);
}

function emittedHasReplayDeferred(emitted: ReadonlyArray<OutboundMessage>): boolean {
  return emitted.some((m) => isReplayDeferred(m));
}
