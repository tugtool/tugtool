// tugcode/src/__tests__/replay-spawn.test.ts
//
// Integration tests for the resume-spawn replay flow:
//   `SessionManager.runReplay()` (session.ts) glued to the JSONL →
//   `OutboundMessage` translator (replay.ts) and the IPC writer.
//
// These tests exercise the wire-level contract Step 3 promises:
//
//   - Replay events flow on IPC stdout *before* live events.
//   - Missing JSONL → bracket pair with `error.kind = "jsonl_missing"`.
//   - Unreadable JSONL → bracket pair with `error.kind = "jsonl_unreadable"`.
//   - Hard-budget timeout → `replay_complete` with
//     `error.kind = "replay_timeout"`.
//   - Claude crash mid-replay → `replay_complete` with
//     `error.kind = "jsonl_unreadable"` and
//     `message = "claude_exited_during_replay"`, then `resume_failed`
//     via the existing lifecycle path.
//   - Encoded-project-dir naming and JSONL path resolution match
//     claude's on-disk layout.
//
// We don't spawn a real claude here — `SessionManager.spawnClaude` is
// stubbed with a controllable `child.exited` promise (consistent with
// the existing watcher tests) and `jsonlReader` is injected so the
// JSONL-on-disk path resolves to fixtures.

import { describe, expect, test } from "bun:test";

import {
  type JsonlReadResult,
  SessionManager,
  encodeProjectDir,
  jsonlPathFor,
} from "../session.ts";
import type {
  OutboundMessage,
  ReplayComplete,
} from "../types.ts";

// ---------------------------------------------------------------------------
// Fixture constructors
// ---------------------------------------------------------------------------

/** A two-turn JSONL fixture: a user → assistant turn plus a second
 * one. Used as the "happy path" baseline. */
function twoTurnJsonl(): string {
  const lines = [
    {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    },
    {
      type: "assistant",
      message: {
        id: "msg_one",
        role: "assistant",
        model: "claude-opus-4-6",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "hi back" }],
      },
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "second prompt" }],
      },
    },
    {
      type: "assistant",
      message: {
        id: "msg_two",
        role: "assistant",
        model: "claude-opus-4-6",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "second reply" }],
      },
    },
  ];
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Capture writeLine output by replacing Bun.write — same pattern the
// session.test.ts file uses. Also stubs process.exit so the
// resume_failed-via-writeLineAndExit path doesn't tear down the
// test runner.
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

interface MockChildHandle {
  child: {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    stdin: { write: () => void; end: () => void; flush: () => void };
    exited: Promise<number>;
    kill: () => void;
  };
  exit: (code: number) => void;
}

/** Build a mock claude child whose lifetime the test controls. */
function mockClaudeChild(opts?: { stderr?: string[] }): MockChildHandle {
  let exitResolve: ((code: number) => void) | null = null;
  const stderrLines = opts?.stderr ?? [];
  const stderr =
    stderrLines.length > 0
      ? new ReadableStream<Uint8Array>({
          start(controller) {
            const enc = new TextEncoder();
            for (const l of stderrLines) {
              controller.enqueue(enc.encode(l + "\n"));
            }
            controller.close();
          },
        })
      : new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        });
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      // Closed immediately — replay does not read claude's stdout in
      // this test; claude is "essentially silent" per D03.
      controller.close();
    },
  });
  const child = {
    stdout,
    stderr,
    stdin: { write: () => {}, end: () => {}, flush: () => {} },
    exited: new Promise<number>((r) => {
      exitResolve = r;
    }),
    kill: () => {},
  };
  return {
    child,
    exit: (code: number) => exitResolve!(code),
  };
}

/** Build a SessionManager primed with mocked claude + injected reader,
 * already initialized so `runReplay()` can be called directly. */
async function makePrimedManager(opts: {
  jsonlReader?: (path: string) => Promise<JsonlReadResult>;
  replayTimeoutMs?: number;
  stderr?: string[];
}): Promise<{
  manager: SessionManager;
  claudeHandle: MockChildHandle;
  sessionId: string;
}> {
  const sessionId = crypto.randomUUID();
  const projectDir = `/tmp/replay-spawn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const manager = new SessionManager(
    projectDir,
    sessionId,
    "resume",
    undefined,
    {
      claudeProjectsRoot: "/tmp/replay-spawn-fixtures",
      jsonlReader:
        opts.jsonlReader ??
        (async () => ({ kind: "ok" as const, jsonl: twoTurnJsonl() })),
      replayTimeoutMs: opts.replayTimeoutMs ?? 10_000,
    },
  );
  const claudeHandle = mockClaudeChild({ stderr: opts.stderr });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (manager as any).spawnClaude = () => claudeHandle.child;
  await captureIpc(async () => {
    await manager.initialize();
  });
  return { manager, claudeHandle, sessionId };
}

// ---------------------------------------------------------------------------
// encodeProjectDir + jsonlPathFor
// ---------------------------------------------------------------------------

describe("encodeProjectDir", () => {
  test("absolute path becomes leading-dash dash-joined form", () => {
    expect(encodeProjectDir("/Users/foo")).toBe("-Users-foo");
    expect(encodeProjectDir("/private/tmp/py-calc")).toBe("-private-tmp-py-calc");
    expect(encodeProjectDir("/Users/foo/src/tugtool")).toBe(
      "-Users-foo-src-tugtool",
    );
  });

  test("path with no leading slash is encoded without leading dash", () => {
    // Defensive: production callers always pass an absolute path
    // (cwd, --dir flag, etc.). We don't enforce that contract at the
    // helper boundary; just document the literal behavior.
    expect(encodeProjectDir("relative/path")).toBe("relative-path");
  });
});

describe("jsonlPathFor", () => {
  test("composes <root>/<encoded-dir>/<id>.jsonl", () => {
    const path = jsonlPathFor(
      "/tmp/projects",
      "/Users/foo/work",
      "abc-123",
    );
    expect(path).toBe("/tmp/projects/-Users-foo-work/abc-123.jsonl");
  });
});

// ---------------------------------------------------------------------------
// runReplay — happy path
// ---------------------------------------------------------------------------

describe("runReplay — happy path", () => {
  test("emits replay_started, per-turn events, and replay_complete in order", async () => {
    const { manager } = await makePrimedManager({});
    const { emitted } = await captureIpc(async () => {
      await manager.runReplay();
    });

    const replayFrames = emitted.filter(
      (e) =>
        e.type === "replay_started" ||
        e.type === "replay_complete" ||
        e.type === "user_message_replay" ||
        e.type === "assistant_text" ||
        e.type === "turn_complete",
    );

    // First frame is the bracket open.
    expect(replayFrames[0]?.type).toBe("replay_started");
    // Last frame is the bracket close.
    expect(replayFrames[replayFrames.length - 1]?.type).toBe(
      "replay_complete",
    );

    const complete = replayFrames[replayFrames.length - 1] as ReplayComplete;
    expect(complete.count).toBe(2);
    expect(complete.error).toBeUndefined();
  });

  test("invokes the injected jsonlReader with the resolved path", async () => {
    const seen: string[] = [];
    const sessionId = crypto.randomUUID();
    const projectDir = "/Users/test-user/work";
    const manager = new SessionManager(projectDir, sessionId, "resume", undefined, {
      claudeProjectsRoot: "/fake/projects",
      jsonlReader: async (path) => {
        seen.push(path);
        return { kind: "ok", jsonl: twoTurnJsonl() };
      },
    });
    const handle = mockClaudeChild();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).spawnClaude = () => handle.child;
    await captureIpc(async () => {
      await manager.initialize();
      await manager.runReplay();
    });

    expect(seen).toEqual([
      `/fake/projects/-Users-test-user-work/${sessionId}.jsonl`,
    ]);
  });

  test("uses resumeSessionId for path resolution when set", async () => {
    const seen: string[] = [];
    const tugId = crypto.randomUUID();
    const claudeId = crypto.randomUUID();
    const manager = new SessionManager(
      "/Users/x/repo",
      tugId,
      "resume",
      claudeId,
      {
        claudeProjectsRoot: "/root",
        jsonlReader: async (path) => {
          seen.push(path);
          return { kind: "ok", jsonl: twoTurnJsonl() };
        },
      },
    );
    const handle = mockClaudeChild();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).spawnClaude = () => handle.child;
    await captureIpc(async () => {
      await manager.initialize();
      await manager.runReplay();
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(`/root/-Users-x-repo/${claudeId}.jsonl`);
  });
});

// ---------------------------------------------------------------------------
// runReplay — `new` mode is a no-op
// ---------------------------------------------------------------------------

describe("runReplay — non-resume mode", () => {
  test("returns immediately without emitting any replay events in `new` mode", async () => {
    const sessionId = crypto.randomUUID();
    const projectDir = "/tmp/replay-no-op";
    const manager = new SessionManager(projectDir, sessionId, "new", undefined, {
      jsonlReader: async () => {
        throw new Error("must not be called in new mode");
      },
    });
    const handle = mockClaudeChild();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).spawnClaude = () => handle.child;
    const { emitted } = await captureIpc(async () => {
      await manager.initialize();
      await manager.runReplay();
    });

    const replayFrames = emitted.filter(
      (e) => e.type === "replay_started" || e.type === "replay_complete",
    );
    expect(replayFrames).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runReplay — error branches
// ---------------------------------------------------------------------------

describe("runReplay — missing JSONL", () => {
  test("emits the bracket pair with error.kind = jsonl_missing", async () => {
    const { manager } = await makePrimedManager({
      jsonlReader: async () => ({
        kind: "missing",
        message: "fixture not on disk",
      }),
    });
    const { emitted } = await captureIpc(async () => {
      await manager.runReplay();
    });

    const started = emitted.find((e) => e.type === "replay_started");
    const complete = emitted.find(
      (e) => e.type === "replay_complete",
    ) as ReplayComplete | undefined;

    expect(started).toBeDefined();
    expect(complete).toBeDefined();
    expect(complete?.error?.kind).toBe("jsonl_missing");
    expect(complete?.count).toBe(0);
  });
});

describe("runReplay — unreadable JSONL", () => {
  test("emits the bracket pair with error.kind = jsonl_unreadable", async () => {
    const { manager } = await makePrimedManager({
      jsonlReader: async () => ({
        kind: "unreadable",
        message: "EACCES: permission denied",
      }),
    });
    const { emitted } = await captureIpc(async () => {
      await manager.runReplay();
    });

    const complete = emitted.find(
      (e) => e.type === "replay_complete",
    ) as ReplayComplete | undefined;
    expect(complete?.error?.kind).toBe("jsonl_unreadable");
    expect(complete?.error?.message).toContain("EACCES");
    expect(complete?.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runReplay — hard timeout
// ---------------------------------------------------------------------------

describe("runReplay — hard timeout", () => {
  test("fires replay_complete with replay_timeout when iterator stalls", async () => {
    // A jsonlReader that never resolves before the test's tiny
    // timeout. Because `runReplay` awaits the reader before starting
    // the timer, we instead inject a *complete-but-massive* JSONL
    // that a slow yield would not finish in time. Easier: stall on
    // the iteration step itself by injecting a JSONL of synthetic
    // entries plus a timeout below the iterator's natural pace.
    //
    // Since `translateJsonlSession` runs in batches of 16 and yields
    // via setTimeout(0) between batches, a 5ms timeout combined with
    // batched yields produces a deterministic timeout outcome on a
    // moderately-sized JSONL.
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) {
      lines.push(
        JSON.stringify({
          type: "user",
          message: { role: "user", content: [{ type: "text", text: `prompt ${i}` }] },
        }),
      );
      lines.push(
        JSON.stringify({
          type: "assistant",
          message: {
            id: `msg_${i}`,
            role: "assistant",
            model: "claude-opus-4-6",
            stop_reason: "end_turn",
            content: [{ type: "text", text: `reply ${i}` }],
          },
        }),
      );
    }
    const jsonl = lines.join("\n") + "\n";

    const { manager } = await makePrimedManager({
      jsonlReader: async () => ({ kind: "ok", jsonl }),
      replayTimeoutMs: 1,
    });

    const { emitted } = await captureIpc(async () => {
      await manager.runReplay();
    });

    // The last replay_complete must carry replay_timeout. (The
    // iterator may have emitted a partial replay_complete just
    // before the abort; runReplay's own emit is the canonical
    // terminal frame.)
    const completes = emitted.filter(
      (e) => e.type === "replay_complete",
    ) as ReplayComplete[];
    expect(completes.length).toBeGreaterThanOrEqual(1);
    const terminal = completes[completes.length - 1];
    expect(terminal.error?.kind).toBe("replay_timeout");
  });
});

// ---------------------------------------------------------------------------
// runReplay — claude crash mid-replay
// ---------------------------------------------------------------------------

describe("runReplay — claude crash during replay", () => {
  /** Build a reader that resolves only when the test calls `release()`.
   * Lets the test trigger claude.exit while runReplay is awaiting the
   * reader — the deterministic equivalent of "claude crashed during
   * replay." */
  function gatedReader(jsonl: string): {
    read: (path: string) => Promise<JsonlReadResult>;
    release: () => void;
    started: Promise<void>;
  } {
    let resolveRead: ((r: JsonlReadResult) => void) | null = null;
    let resolveStarted: (() => void) | null = null;
    const startedPromise = new Promise<void>((r) => {
      resolveStarted = r;
    });
    return {
      read: (_path: string) =>
        new Promise<JsonlReadResult>((resolve) => {
          resolveRead = resolve;
          resolveStarted!();
        }),
      release: () => resolveRead!({ kind: "ok", jsonl }),
      started: startedPromise,
    };
  }

  test("emits replay_complete{claude_exited_during_replay} then resume_failed", async () => {
    const gate = gatedReader(twoTurnJsonl());
    const { manager, claudeHandle, sessionId } = await makePrimedManager({
      jsonlReader: gate.read,
    });

    const { emitted } = await captureIpc(async () => {
      const replayPromise = manager.runReplay();
      // Wait until runReplay has begun awaiting the reader, then
      // crash claude. Watcher must skip (replayActive=true), and the
      // crash branch in runReplay must surface the loss.
      await gate.started;
      claudeHandle.exit(1);
      // Let the exit microtask propagate so exitPromise resolves
      // before the reader releases.
      await new Promise((r) => setTimeout(r, 0));
      gate.release();
      await replayPromise;
    });

    const completes = emitted.filter(
      (e) => e.type === "replay_complete",
    ) as ReplayComplete[];
    expect(completes.length).toBeGreaterThanOrEqual(1);
    const crashComplete = completes.find(
      (c) => c.error?.message === "claude_exited_during_replay",
    );
    expect(crashComplete).toBeDefined();
    expect(crashComplete?.error?.kind).toBe("jsonl_unreadable");

    // resume_failed is emitted via the lifecycle path after the
    // replay_complete bracket. Wire order matters: the reducer must
    // leave `replaying` cleanly before the lifecycle event unbinds
    // the card.
    const failed = emitted.find((e) => e.type === "resume_failed");
    expect(failed).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((failed as any).stale_session_id).toBe(sessionId);

    const indexOfCrashComplete = emitted.indexOf(crashComplete!);
    const indexOfFailed = emitted.indexOf(failed!);
    expect(indexOfCrashComplete).toBeLessThan(indexOfFailed);

    // The watcher must NOT have emitted its own resume_failed in
    // parallel — only one should land on the wire.
    const failedAll = emitted.filter((e) => e.type === "resume_failed");
    expect(failedAll).toHaveLength(1);
  });

  test("uses claude stderr classification for the resume_failed reason when present", async () => {
    const gate = gatedReader(twoTurnJsonl());
    const { manager, claudeHandle } = await makePrimedManager({
      jsonlReader: gate.read,
      stderr: ["No conversation found with session ID: deadbeef"],
    });

    const { emitted } = await captureIpc(async () => {
      const replayPromise = manager.runReplay();
      await gate.started;
      // Allow the stderr reader a couple of ticks to drain the stub
      // stream and set claudeStderrClassification before claude
      // "exits."
      await new Promise((r) => setTimeout(r, 5));
      claudeHandle.exit(1);
      await new Promise((r) => setTimeout(r, 0));
      gate.release();
      await replayPromise;
    });

    const failed = emitted.find((e) => e.type === "resume_failed");
    expect(failed).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((failed as any).reason).toContain("No conversation found");
  });
});
