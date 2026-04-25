/**
 * _smoke-tugcode-stub.test.ts — end-to-end smoke for the
 * deterministic stub-mode replay path (parent harness plan
 * #step-6 / selection plan Pass 7B). SCRATCH FILE — folded into
 * `_smoke-em.test.ts` at Step 7's commit and deleted there.
 *
 * ## What this file pins
 *
 * The full stub-replay pipeline:
 *
 *   1. Harness ferries an inline transcript through
 *      `app.startTugcode({ mode: "stub", transcript })`.
 *   2. Swift writes the transcript JSON to a temp file under
 *      $TMPDIR and passes `--stub-transcript=<path>` to tugcode.
 *   3. tugcode loads the transcript via `loadTranscript` and
 *      installs `StubReplayEngine`.
 *   4. Harness writes a `protocol_init` line to tugcode's stdin
 *      via `app.writeTugcodeStdin(...)`. Engine emits
 *      `protocol_ack` + `session_init`.
 *   5. Harness writes a `user_message` line. Engine dispatches
 *      turn 0's recorded outputs.
 *   6. Test reads the log file from disk (which captured
 *      tugcode's stdout) and asserts the expected outputs are
 *      present in order.
 *
 * Latency budget: with the path-based transcript handoff and
 * direct stdin write, a single round-trip should land under
 * 100ms. We poll the log file for up to 2 seconds.
 *
 * ## Why log-file read-back instead of an RPC verb
 *
 * The harness already routes tugcode's stdout to a configurable
 * log file via the `logFilePath` opt that landed in 7A. Reading
 * the file from the Bun test runtime is one fs.readFile call —
 * adding a dedicated `readTugcodeOutput` RPC would duplicate
 * what's already on-disk for every other test that captures
 * subprocess logs. Polling the file is simpler than listener
 * plumbing.
 *
 * ## Gating
 *
 * `describe.skipIf(!SHOULD_RUN)`. CI and `bun x tsc --noEmit` runs
 * without `TUGAPP_IN_APP_TEST=1` skip every test.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  launchTugApp,
  TUGCODE_TRANSCRIPT_SCHEMA_VERSION,
  type TugcodeTranscript,
} from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

function makeHelloTranscript(): TugcodeTranscript {
  return {
    schemaVersion: TUGCODE_TRANSCRIPT_SCHEMA_VERSION,
    tugcodeVersion: "0.8.0",
    turns: [
      {
        index: 0,
        description: "say hello",
        outputs: [
          {
            type: "assistant_text",
            msg_id: "m0",
            seq: 0,
            rev: 0,
            text: "Hello from stub replay",
            is_partial: false,
            status: "complete",
            ipc_version: 2,
          },
          {
            type: "turn_complete",
            msg_id: "m0",
            seq: 1,
            result: "success",
            ipc_version: 2,
          },
        ],
      },
    ],
  };
}

/** Poll the log file until `predicate(content)` is truthy or the budget elapses. */
async function pollLog(
  logPath: string,
  predicate: (content: string) => boolean,
  budgetMs = 2000,
): Promise<string> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    let content = "";
    try {
      content = readFileSync(logPath, "utf8");
    } catch {
      // not yet created; treat as empty
    }
    if (predicate(content)) return content;
    await new Promise<void>((resolve) =>
      (
        globalThis as unknown as {
          setTimeout: (fn: () => void, ms: number) => unknown;
        }
      ).setTimeout(() => resolve(), 25),
    );
  }
  // One last read so the assertion error message has the latest contents
  try {
    return readFileSync(logPath, "utf8");
  } catch {
    return "";
  }
}

describe.skipIf(!SHOULD_RUN)("phase B tugcode-stub-replay smoke", () => {
  test("end-to-end: protocol_init + user_message → recorded outputs in stdout log", async () => {
    const app = await launchTugApp({ testName: "smoke-tugcode-stub-e2e" });
    const workdir = mkdtempSync(join(tmpdir(), "tugcode-stub-log-"));
    const logPath = join(workdir, "tugcode-stub.log");
    try {
      const transcript = makeHelloTranscript();
      const result = await app.startTugcode({
        mode: "stub",
        transcript,
        logFilePath: logPath,
      });
      expect(result.pid).toBeGreaterThan(0);

      // protocol_init → expect protocol_ack + session_init in the log
      await app.writeTugcodeStdin(
        JSON.stringify({ type: "protocol_init", version: 1 }),
      );
      await pollLog(
        logPath,
        (c) => c.includes('"protocol_ack"') && c.includes('"session_init"'),
      );

      // user_message turn 0 → expect assistant_text + turn_complete
      await app.writeTugcodeStdin(
        JSON.stringify({
          type: "user_message",
          text: "irrelevant — replay is index-based",
          attachments: [],
        }),
      );
      const content = await pollLog(
        logPath,
        (c) =>
          c.includes("Hello from stub replay") && c.includes('"turn_complete"'),
      );

      expect(content).toContain('"protocol_ack"');
      expect(content).toContain('"session_init"');
      expect(content).toContain("Hello from stub replay");
      expect(content).toContain('"turn_complete"');

      await app.stopTugcode();
    } finally {
      try {
        rmSync(workdir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
      await app.close();
    }
  });

  test("stub mode without transcript fails fast with TugcodeLaunchError", async () => {
    const app = await launchTugApp({ testName: "smoke-tugcode-stub-no-transcript" });
    try {
      let caught: unknown = null;
      try {
        await app.startTugcode({ mode: "stub" });
      } catch (err) {
        caught = err;
      }
      expect((caught as Error)?.name).toBe("TugcodeLaunchError");
      expect((caught as Error)?.message).toContain("transcriptJson");
    } finally {
      await app.close();
    }
  });

  test("malformed transcript produces error event from tugcode", async () => {
    const app = await launchTugApp({ testName: "smoke-tugcode-stub-malformed" });
    const workdir = mkdtempSync(join(tmpdir(), "tugcode-stub-log-"));
    const logPath = join(workdir, "tugcode-stub.log");
    try {
      // Schema-version mismatch — engine refuses to load.
      const bad = {
        schemaVersion: 9999,
        tugcodeVersion: "0.8.0",
        turns: [],
      };
      const result = await app.startTugcode({
        mode: "stub",
        transcript: bad as unknown as TugcodeTranscript,
        logFilePath: logPath,
      });
      expect(result.pid).toBeGreaterThan(0);

      // Wait for tugcode to write its error event to stdout and exit.
      await pollLog(
        logPath,
        (c) =>
          c.includes('"type":"error"') &&
          c.includes("schemaVersion 9999 is not supported"),
      );
      const content = readFileSync(logPath, "utf8");
      expect(content).toContain('"recoverable":false');

      await app.stopTugcode();
    } finally {
      try {
        rmSync(workdir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
      await app.close();
    }
  });
});
