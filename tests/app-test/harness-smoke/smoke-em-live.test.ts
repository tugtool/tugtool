/**
 * smoke-em-live.test.ts — live-mode tugcode smoke (IME / live path). NOT part of the default
 * sweep — gated behind `TUGCODE_LIVE=1` because:
 *
 *   - it spawns a real tugcode process
 *   - which spawns a real Claude Code subprocess
 *   - which makes real Anthropic API calls
 *   - and consumes credits / requires API credentials
 *
 * Run locally with:
 *
 *     TUGCODE_LIVE=1 just test-in-app-fast smoke-em-live.test.ts
 *
 * ## What this file pins
 *
 * The live-mode `startTugcode` path: spawn → protocol_init →
 * user_message → assistant_text + turn_complete on stdout.
 *
 * Unlike stub-mode smoke (`smoke-tugcode-stub.test.ts`), live mode
 * goes through the real claude pipeline,
 * so the response content is non-deterministic. We assert only on
 * the protocol shape:
 *
 *   1. tugcode emits `protocol_ack` and `session_init` after
 *      protocol_init.
 *   2. After a user_message, tugcode emits at least one
 *      `assistant_text` and exactly one `turn_complete`.
 *   3. tugcode survives the full turn without an `error` event.
 *
 * Network / model timeouts: live model latency can spike to
 * 30s+ on the first turn. The polling deadlines reflect that.
 *
 * ## What this file does NOT cover
 *
 * The tugdeck-side observation surface — that path requires
 * tugcast-bypass plumbing, so live
 * tugcode's output isn't visible to tugdeck via
 * `app.getEmCardState`. Asserting through tugdeck is for a later
 * integration pass; this smoke is bare-tugcode-only.
 *
 * ## Gating
 *
 * `describe.skipIf(!SHOULD_RUN || !TUGCODE_LIVE)`. CI and the
 * default `just test-in-app-fast` sweep skip every test (the
 * Justfile doesn't set TUGCODE_LIVE). Tests that explicitly pass
 * a path matching this file run normally; the gate is the env
 * var, not the file path.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp } from "../_harness";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";
const TUGCODE_LIVE = process.env.TUGCODE_LIVE === "1";

/** Poll the log file until `predicate(content)` is truthy or the budget elapses. */
async function pollLog(
  logPath: string,
  predicate: (content: string) => boolean,
  budgetMs: number,
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
      ).setTimeout(() => resolve(), 100),
    );
  }
  try {
    return readFileSync(logPath, "utf8");
  } catch {
    return "";
  }
}

/** Count occurrences of `needle` in `haystack`. Used for protocol-frame counts. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

describe.skipIf(!SHOULD_RUN || !TUGCODE_LIVE)(
  "phase B tugcode-live-mode smoke (gated by TUGCODE_LIVE=1)",
  () => {
    test("end-to-end: protocol_init + user_message → assistant_text + turn_complete", async () => {
      const app = await launchTugApp({ testName: "smoke-em-live" });
      const workdir = mkdtempSync(join(tmpdir(), "tugcode-live-log-"));
      const logPath = join(workdir, "tugcode-live.log");
      // tugcode `--dir <path>` is the project directory claude
      // operates against. Use the harness's own workdir — tugcode
      // doesn't actually read files in this minimal smoke; the
      // dir just satisfies tugcode's spawn contract.
      const projectDir = process.cwd();
      try {
        const result = await app.startTugcode({
          mode: "live",
          dir: projectDir,
          logFilePath: logPath,
        });
        expect(result.pid).toBeGreaterThan(0);

        // protocol_init → expect protocol_ack + session_init.
        // First-token latency on cold-start claude can be ~15s.
        await app.writeTugcodeStdin(
          JSON.stringify({ type: "protocol_init", version: 1 }),
        );
        await pollLog(
          logPath,
          (c) => c.includes('"protocol_ack"') && c.includes('"session_init"'),
          20_000,
        );

        // user_message → expect at least one assistant_text and
        // exactly one turn_complete. Use a deterministic minimal
        // prompt to keep model token output bounded.
        await app.writeTugcodeStdin(
          JSON.stringify({
            type: "user_message",
            text: "Reply with the single word: ack.",
            attachments: [],
          }),
        );
        // Live model end-to-end can be slow; allow 60s.
        const content = await pollLog(
          logPath,
          (c) => c.includes('"turn_complete"'),
          60_000,
        );

        const assistantTextCount = countOccurrences(content, '"type":"assistant_text"');
        const turnCompleteCount = countOccurrences(content, '"type":"turn_complete"');
        const errorCount = countOccurrences(content, '"type":"error"');

        expect(assistantTextCount).toBeGreaterThanOrEqual(1);
        expect(turnCompleteCount).toBe(1);
        // No error frames during a clean turn. If this fires, the
        // log file is dumped via Bun's failure path so the user
        // can see the actual tugcode output.
        expect(errorCount).toBe(0);

        await app.stopTugcode();
      } catch (err) {
        // On failure, surface the log tail so credentials issues
        // / API errors are diagnosable without spelunking through
        // tmp paths.
        let tail = "";
        try {
          tail = readFileSync(logPath, "utf8").split("\n").slice(-50).join("\n");
        } catch {
          // best-effort
        }
        if (tail !== "") {
          process.stderr.write(
            `\n[smoke-em-live] tugcode log tail (last 50 lines):\n${tail}\n`,
          );
        }
        throw err;
      } finally {
        try {
          rmSync(workdir, { recursive: true, force: true });
        } catch {
          // best-effort
        }
        await app.close();
      }
    }, 120_000);
  },
);
