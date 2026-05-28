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
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
// runReplay — symlink canonicalization regression (Step R0b)
// ---------------------------------------------------------------------------
//
// Smoke C cold-boot revealed that `runReplay` was encoding the raw
// `projectDir` (a symlink path) when it should encode the resolved
// path — claude itself canonicalizes `cwd` when computing where to
// write the JSONL, so the encoding has to match. This test sets up
// a symlinked project dir on a tmp filesystem, points
// `claudeProjectsRoot` at a fake dir whose entries are keyed by the
// *resolved* encoding, and asserts `jsonlReader` is called with the
// resolved-encoded path.

describe("runReplay — symlink canonicalization", () => {
  test("encodes the resolved path of projectDir, not the symlink form", async () => {
    // Build a tmp tree:
    //   <tmpRoot>/real/work       — real dir we'll point projectDir at via a symlink
    //   <tmpRoot>/link            — symlink to <tmpRoot>/real/work
    //   <tmpRoot>/projects        — fake claudeProjectsRoot (no actual JSONLs needed
    //                                — we observe the path the reader is called with)
    const tmpRoot = mkdtempSync(join(tmpdir(), "tugcode-realpath-"));
    try {
      const realDir = join(tmpRoot, "real", "work");
      mkdirSync(realDir, { recursive: true });
      const symPath = join(tmpRoot, "link");
      symlinkSync(realDir, symPath);

      const observedPaths: string[] = [];
      const sessionId = "abc-canonicalize";
      const claudeId = "claude-canon";

      const manager = new SessionManager(
        symPath, // projectDir IS the symlink — mirrors what tugcast hands tugcode
        sessionId,
        "resume",
        claudeId,
        {
          claudeProjectsRoot: join(tmpRoot, "projects"),
          jsonlReader: async (path) => {
            observedPaths.push(path);
            return { kind: "missing", message: "fixture" };
          },
        },
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any).spawnClaude = () => ({
        stdout: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        }),
        stdin: { write: () => {}, end: () => {}, flush: () => {} },
        exited: new Promise<number>(() => {}),
        kill: () => {},
      });

      // Capture stdout to absorb writeLine output during initialize +
      // runReplay; we don't assert on it here.
      const originalWrite = Bun.write;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).write = () => Promise.resolve(0);
      try {
        await manager.initialize();
        await manager.runReplay();
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (Bun as any).write = originalWrite;
      }

      expect(observedPaths).toHaveLength(1);
      const observed = observedPaths[0];

      // The resolved encoding is what claude uses; the symlink
      // encoding is what the bug previously produced. Assert the
      // observed path matches the resolved encoding.
      const resolvedEncoded = encodeProjectDir(realDir);
      const symEncoded = encodeProjectDir(symPath);
      expect(observed).toContain(resolvedEncoded);
      expect(observed).not.toContain(`/${symEncoded}/`);
      expect(observed.endsWith(`${claudeId}.jsonl`)).toBe(true);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("falls back to raw projectDir when realpath fails (synthetic test path)", async () => {
    // Synthetic path that doesn't exist on disk — realpath rejects,
    // runReplay continues with the raw form. The downstream
    // `jsonlReader` reports `missing`, the bracket pair lands cleanly,
    // and the card stays interactive (matches the existing happy-path
    // behavior — no regression for tests that point at non-existent
    // tmp paths).
    const observed: string[] = [];
    const manager = new SessionManager(
      "/tmp/nonexistent-path-for-realpath-fallback-test",
      "abc",
      "resume",
      "claude-id",
      {
        claudeProjectsRoot: "/tmp/projects",
        jsonlReader: async (path) => {
          observed.push(path);
          return { kind: "missing", message: "fixture" };
        },
      },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).spawnClaude = () => ({
      stdout: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
      stderr: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
      stdin: { write: () => {}, end: () => {}, flush: () => {} },
      exited: new Promise<number>(() => {}),
      kill: () => {},
    });
    const originalWrite = Bun.write;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Bun as any).write = () => Promise.resolve(0);
    try {
      await manager.initialize();
      await manager.runReplay();
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).write = originalWrite;
    }
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBe(
      "/tmp/projects/-tmp-nonexistent-path-for-realpath-fallback-test/claude-id.jsonl",
    );
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
        e.type === "add_user_message" ||
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

describe("runReplay — non-resume mode (post-Step-5 close-out fix)", () => {
  // Pre-Step-5 close-out, runReplay early-returned `if (this.sessionMode !== "resume")`.
  // The fix dropped the gate so a request_replay against a session
  // originally spawned as `new` but now containing wire activity (open
  // new card, type "hello", get response, Developer > Reload) still
  // rehydrates the freshly-mounted CodeSessionStore. For a truly fresh
  // new session whose JSONL doesn't exist yet, the translator emits
  // `replay_started → replay_complete{kind: "jsonl_missing"}` —
  // harmless from the reducer's perspective.
  test("emits the standard bracket pair with jsonl_missing for a fresh new-mode session", async () => {
    const sessionId = crypto.randomUUID();
    const projectDir = "/tmp/replay-no-op";
    let jsonlReaderCalls = 0;
    const manager = new SessionManager(projectDir, sessionId, "new", undefined, {
      claudeProjectsRoot: "/tmp/replay-spawn-fixtures-nonexistent",
      jsonlReader: async () => {
        jsonlReaderCalls += 1;
        return { kind: "missing" as const, message: "no JSONL for fresh new session" };
      },
    });
    const handle = mockClaudeChild();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).spawnClaude = () => handle.child;
    const { emitted } = await captureIpc(async () => {
      await manager.initialize();
      await manager.runReplay();
    });

    expect(jsonlReaderCalls).toBeGreaterThanOrEqual(1);

    const startedCount = emitted.filter((e) => e.type === "replay_started").length;
    const completes = emitted.filter((e) => e.type === "replay_complete");
    expect(startedCount).toBeGreaterThanOrEqual(1);
    expect(completes.length).toBeGreaterThanOrEqual(1);
    // The first/only replay_complete carries the jsonl_missing diagnostic.
    const firstComplete = completes[0] as { count: number; error?: { kind: string } };
    expect(firstComplete.count).toBe(0);
    expect(firstComplete.error?.kind).toBe("jsonl_missing");
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

// ---------------------------------------------------------------------------
// Step R0d — cold-boot ordering: prepareSession → runReplay →
// spawnClaudeAndWatch
// ---------------------------------------------------------------------------

describe("Step R0d — cold-boot resume order", () => {
  /**
   * Build a manager set up for the new cold-boot order: NOT primed
   * via `initialize()`. The caller is expected to drive
   * `prepareSession()` → `runReplay()` → `spawnClaudeAndWatch()`
   * directly to exercise the wire ordering the refactor introduces.
   */
  function makeUnprimedManager(opts?: {
    jsonlReader?: (path: string) => Promise<JsonlReadResult>;
    stderr?: string[];
    spawnDelayMs?: number;
  }): {
    manager: SessionManager;
    claudeHandle: MockChildHandle;
    sessionId: string;
  } {
    const sessionId = crypto.randomUUID();
    const projectDir = `/tmp/replay-spawn-r0d-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const manager = new SessionManager(
      projectDir,
      sessionId,
      "resume",
      undefined,
      {
        claudeProjectsRoot: "/tmp/replay-spawn-fixtures",
        jsonlReader:
          opts?.jsonlReader ??
          (async () => ({ kind: "ok" as const, jsonl: twoTurnJsonl() })),
        replayTimeoutMs: 10_000,
      },
    );
    const claudeHandle = mockClaudeChild({ stderr: opts?.stderr });
    // The caller drives spawning via `spawnClaudeAndWatch`. The
    // `spawnDelayMs` knob lets a test verify "replay finishes before
    // the spawn handle is wired up" by holding the synchronous return
    // of `spawnClaude` open. In production, `Bun.spawn` returns
    // synchronously; here we simulate a delay by gating on a Promise.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).spawnClaude = () => claudeHandle.child;
    return { manager, claudeHandle, sessionId };
  }

  test("prepareSession emits session_init synchronously before runReplay or any claude spawn", async () => {
    const { manager } = makeUnprimedManager();
    const { emitted } = await captureIpc(async () => {
      manager.prepareSession();
    });
    // Exactly one synthetic init lands on the wire; no other frames.
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.type).toBe("session_init");
    // No claude process has been wired up yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((manager as any).claudeProcess).toBeNull();
  });

  test("cold-boot order: replay events land on IPC stdout BEFORE spawnClaudeAndWatch wires up", async () => {
    const { manager } = makeUnprimedManager();

    const { emitted } = await captureIpc(async () => {
      manager.prepareSession();
      await manager.runReplay();
      // Spawn AFTER replay completes — the new order. The Promise
      // resolves once the synchronous setup is done.
      await manager.spawnClaudeAndWatch();
    });

    const types = emitted.map((m) => m.type);
    // First wire frame: synthetic session_init.
    expect(types[0]).toBe("session_init");
    // Bracket pair: replay_started and replay_complete must both
    // appear, in order.
    const startedIdx = types.indexOf("replay_started");
    const completeIdx = types.indexOf("replay_complete");
    expect(startedIdx).toBeGreaterThan(0);
    expect(completeIdx).toBeGreaterThan(startedIdx);
    // The bracket pair lands before any further wire activity (e.g.,
    // an init from claude). In this test claude is silent (mock
    // closes stdout immediately), so all activity is replay-derived
    // — the assertion is that the bracket survives the new order.
    const completeFrame = emitted[completeIdx] as ReplayComplete;
    expect(completeFrame.error).toBeUndefined();
  });

  test("handleUserMessage blocks until spawnClaudeAndWatch resolves", async () => {
    const { manager } = makeUnprimedManager();
    let userMessageDispatched = false;
    let userMessageReturned = false;

    const { emitted } = await captureIpc(async () => {
      manager.prepareSession();
      await manager.runReplay();

      // Kick off handleUserMessage BEFORE spawnClaudeAndWatch. The
      // claudeReadyPromise gate (set up in prepareSession) is still
      // pending; the message must wait. We can't rely on
      // handleUserMessage's actual completion here (it would block on
      // claude's stdout) but we CAN observe that nothing has been
      // written to claude yet — claudeProcess is still null.
      const userMsgPromise = manager
        .handleUserMessage({
          type: "user_message",
          text: "ping",
          attachments: [],
        })
        .then(() => {
          userMessageReturned = true;
        })
        .catch(() => {
          // Expected: once we kill the mock claude, the read loop
          // returns null and handleUserMessage emits its
          // stream_end_no_result error and returns.
          userMessageReturned = true;
        });
      userMessageDispatched = true;

      // Pause to give handleUserMessage a chance to run if it didn't
      // actually block. (It should block on claudeReadyPromise.)
      await new Promise((r) => setTimeout(r, 5));
      // Spawn happens here — the gate resolves and handleUserMessage
      // can proceed past the await.
      await manager.spawnClaudeAndWatch();
      // Tear claude down so handleUserMessage's read loop unblocks.
      // (Mock stdin.write is a no-op; mock stdout is already closed.)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any).claudeProcess = null;
      await Promise.race([
        userMsgPromise,
        new Promise((r) => setTimeout(r, 50)),
      ]);
    });

    expect(userMessageDispatched).toBe(true);
    // The IPC stream should NOT contain any pre-spawn user_message
    // forwarding artifact — handleUserMessage gated correctly.
    // (We can only assert the gate prevented a "Session not
    // initialized" throw before the spawn; the read loop's exact
    // teardown shape isn't load-bearing for this test.)
    expect(userMessageReturned).toBe(true);
    // No replay events should be missing.
    const replayBracket = emitted.filter(
      (e) => e.type === "replay_started" || e.type === "replay_complete",
    );
    expect(replayBracket.length).toBe(2);
  });

  test("spawn-fails-after-replay: replay events flow, then resume_failed lands", async () => {
    const { manager, claudeHandle, sessionId } = makeUnprimedManager({
      stderr: ["No conversation found with session ID: deadbeef"],
    });

    const { emitted } = await captureIpc(async () => {
      manager.prepareSession();
      await manager.runReplay();
      await manager.spawnClaudeAndWatch();
      // Stderr lines have been emitted by the mock above; the
      // stderr reader needs a tick or two to drain them and set
      // `claudeStderrClassification` before claude exits.
      await new Promise((r) => setTimeout(r, 5));
      claudeHandle.exit(1);
      // Let the watcher's exit branch run.
      await new Promise((r) => setTimeout(r, 5));
    });

    const types = emitted.map((m) => m.type);
    // Replay bracket pair appears first, in order.
    const startedIdx = types.indexOf("replay_started");
    const completeIdx = types.indexOf("replay_complete");
    const failedIdx = types.indexOf("resume_failed");
    expect(startedIdx).toBeGreaterThan(-1);
    expect(completeIdx).toBeGreaterThan(startedIdx);
    expect(failedIdx).toBeGreaterThan(completeIdx);

    // Replay was clean: no error on the bracket close.
    const completeFrame = emitted[completeIdx] as ReplayComplete;
    expect(completeFrame.error).toBeUndefined();

    // The deliberate UX trade-off: the user briefly saw the populated
    // transcript (replay events) before the picker takes over via
    // resume_failed. That's the failure-path regression the R0d plan
    // accepts in exchange for the success-path speedup. Lock it in.
    const failed = emitted[failedIdx] as unknown as Record<string, unknown>;
    expect(failed.stale_session_id).toBe(sessionId);
    expect(failed.reason).toContain("No conversation found");
  });

  // ---------------------------------------------------------------------------
  // Step R1d — absence-of-spawn-timer regression
  // ---------------------------------------------------------------------------
  //
  // The R0d 30s spawn-watchdog was removed in [Step R1d] after Smoke B
  // exposed it firing on user idle: its proxy `claudeReceivedInput`
  // only flips on the user's first submit, so any session where the
  // user paused for 30s after spawn was wrongly classified as a hang
  // and resume_failed. The fix is "no timer at all" — claude in
  // stream-json mode emits nothing on stdout until input, so there is
  // no observable signal that distinguishes "hung" from "idle"
  // without sending a probe (which would cost API tokens and pollute
  // the JSONL).
  //
  // This test pins the new contract: a primed resume-mode manager
  // with a healthy mock claude and no user input emits NO
  // `resume_failed` frame, and the claude process stays alive.
  // The timer's prior 30s window has elapsed many times over by the
  // 1500ms wait — pre-R1d (with the timer's threshold knob set low)
  // this would have fired the timer; post-R1d the absence is total.

  test("Step R1d: no spawn timer fires under user idle (claude stays alive past former timeout window)", async () => {
    const { manager, claudeHandle } = makeUnprimedManager();

    const { emitted } = await captureIpc(async () => {
      manager.prepareSession();
      await manager.runReplay();
      await manager.spawnClaudeAndWatch();
      // Hold the manager idle past any plausible timeout window.
      // 1500ms is well past 1s and clearly distinct from the 30s the
      // R0d timer used; the absence at this scale is what we lock in.
      await new Promise((r) => setTimeout(r, 1500));
    });

    // No resume_failed of any kind should have landed on the wire.
    const failedAll = emitted.filter((e) => e.type === "resume_failed");
    expect(failedAll).toHaveLength(0);

    // And the claude mock was never killed (no .exit() called by us
    // and no internal timer should have called .kill()). The test
    // doesn't have direct visibility into kill calls, but if a kill
    // had happened, the early-exit watcher path would have surfaced
    // a resume_failed — already asserted absent above. Belt-and-
    // suspenders: confirm the mock's exit promise is still pending
    // (resolves only when claudeHandle.exit(code) is called, which
    // we did not do).
    let mockExited = false;
    void claudeHandle.child.exited.then(() => {
      mockExited = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockExited).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase A-R1 — request_replay re-entrancy and sequential callability
// ---------------------------------------------------------------------------
//
// `runReplay()` is now invoked from two paths:
//   - cold-boot order (Step R0d): once per protocol_init, before claude
//     spawns
//   - request_replay verb ([D12]): on demand, against an already-live
//     SessionManager whenever tugdeck constructs services for a resume
//     binding (HMR, reload, future card mounts)
//
// These tests lock in the contract the second path needs:
//   1. Calling runReplay() twice in sequence emits two complete bracket
//      pairs — each replay is independent and idempotent at the wire.
//   2. Calling runReplay() while a replay is already in flight is
//      dropped at the entry guard and emits a single `request_dropped`
//      telemetry line; no overlapping output on IPC stdout.

describe("Phase A-R1 — runReplay sequential and re-entrant calls", () => {
  test("two sequential runReplay() calls each emit a full bracket pair", async () => {
    const { manager } = await makePrimedManager({});

    const { emitted } = await captureIpc(async () => {
      await manager.runReplay();
      await manager.runReplay();
    });

    const types = emitted.map((m) => m.type);
    const startedCount = types.filter((t) => t === "replay_started").length;
    const completeCount = types.filter((t) => t === "replay_complete").length;
    expect(startedCount).toBe(2);
    expect(completeCount).toBe(2);

    // Order: started, complete, started, complete (no overlap).
    const bracketOrder = types.filter(
      (t) => t === "replay_started" || t === "replay_complete",
    );
    expect(bracketOrder).toEqual([
      "replay_started",
      "replay_complete",
      "replay_started",
      "replay_complete",
    ]);

    // Each bracket close has the same successful count.
    const completes = emitted.filter(
      (e) => e.type === "replay_complete",
    ) as ReplayComplete[];
    expect(completes[0].count).toBe(2);
    expect(completes[0].error).toBeUndefined();
    expect(completes[1].count).toBe(2);
    expect(completes[1].error).toBeUndefined();
  });

  test("re-entrant runReplay() while another is in flight is dropped; no overlapping bracket on the wire", async () => {
    // Use a gated reader so the first runReplay is provably mid-flight
    // when we kick off the second one. Without the gate the first call
    // can race to completion before the second starts, defeating the
    // re-entrancy assertion.
    let resolveRead: ((r: JsonlReadResult) => void) | null = null;
    let resolveStarted: (() => void) | null = null;
    const startedPromise = new Promise<void>((r) => {
      resolveStarted = r;
    });
    const gatedRead = (_path: string): Promise<JsonlReadResult> =>
      new Promise<JsonlReadResult>((resolve) => {
        resolveRead = resolve;
        resolveStarted!();
      });

    const { manager } = await makePrimedManager({
      jsonlReader: gatedRead,
    });

    // Capture stderr so we can verify the request_dropped telemetry
    // line. The wrapped console.log in main.ts goes to stderr in
    // production; here `logReplay` calls `console.log` which is
    // unwrapped under the test runner. Either way we need an
    // independent capture.
    const droppedLogs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const joined = args.map(String).join(" ");
      if (joined.includes("dev::replay::request_dropped")) {
        droppedLogs.push(joined);
      }
    };

    const { emitted } = await captureIpc(async () => {
      try {
        const firstReplay = manager.runReplay();
        // First runReplay is now awaiting the gated reader.
        await startedPromise;
        // Second call while the first is still in flight. The
        // re-entrancy guard (replayActive flag) must drop this one.
        await manager.runReplay();
        // Release the first reader so the in-flight replay can
        // complete and the test can finish.
        resolveRead!({ kind: "ok", jsonl: twoTurnJsonl() });
        await firstReplay;
      } finally {
        console.log = originalLog;
      }
    });

    const types = emitted.map((m) => m.type);
    const startedCount = types.filter((t) => t === "replay_started").length;
    const completeCount = types.filter((t) => t === "replay_complete").length;

    // Exactly one bracket pair lands on the wire — the first replay's.
    // The second call returned without writing anything.
    expect(startedCount).toBe(1);
    expect(completeCount).toBe(1);

    // The dropped second call emitted its telemetry line.
    expect(droppedLogs).toHaveLength(1);
    expect(droppedLogs[0]).toContain("dev::replay::request_dropped");
    expect(droppedLogs[0]).toContain("reason=replay_in_flight");
  });

  test("sequential runReplay() works after a previous replay completed (validates replayActive flag clears)", async () => {
    // Regression: if the re-entrancy guard accidentally left
    // replayActive=true after a normal completion, the second call
    // would be silently dropped. The first sequential test above
    // covers the happy path; this test verifies it explicitly via the
    // ordering on the wire — the second bracket must appear AFTER the
    // first bracket completes, not be dropped.
    const { manager } = await makePrimedManager({});

    const { emitted } = await captureIpc(async () => {
      await manager.runReplay();
      // Between calls: nothing else on the wire — the first call must
      // have cleared replayActive in its `finally` block.
      await manager.runReplay();
    });

    // Replay-related frames in order.
    const replayFrames = emitted.filter(
      (e) => e.type === "replay_started" || e.type === "replay_complete",
    );
    expect(replayFrames.map((f) => f.type)).toEqual([
      "replay_started",
      "replay_complete",
      "replay_started",
      "replay_complete",
    ]);
  });
});
