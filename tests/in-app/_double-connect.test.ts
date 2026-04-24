/**
 * _double-connect.test.ts — "Second connect gets ECONNREFUSED"
 * regression test for the Swift listener's single-client guarantee.
 * Covers parent plan step-9 test:
 *
 *   "Double-connect test: second harness client hits ECONNREFUSED."
 *
 * Mechanism: the listener closes its listening FD once the first
 * client is accepted. The bound inode stays at the socket path, but
 * the kernel has no listener to dispatch incoming connects to, so
 * `connect()` returns ECONNREFUSED. See the
 * `TestHarnessListener.handleAccept` comment in
 * `tugapp/Sources/TestHarness/TestHarnessListener.swift` for the
 * rationale.
 *
 * Skipped by default unless `TUGAPP_IN_APP_TEST=1` is set. The test
 * needs a built debug Tug.app binary at the default path (or
 * `TUGAPP_DEBUG_PATH` pointing at one).
 *
 * To run locally:
 *   xcodebuild -scheme Tug -configuration Debug build
 *   TUGAPP_IN_APP_TEST=1 bun test tests/in-app/_double-connect.test.ts
 *
 * Design notes:
 * - We can't use `launchTugApp` for the second "client" — it always
 *   spawns a fresh subprocess. Instead we call `Bun.connect` directly
 *   at the same socket path the first `App` is using.
 * - `Bun.connect` surfaces ECONNREFUSED as a rejected promise with
 *   the errno in the error message. We match on "ECONNREFUSED" or
 *   the numeric errno 61 (macOS) / 111 (Linux) to stay resilient.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

describe.skipIf(!SHOULD_RUN)("in-app: double-connect refused", () => {
  test("second connect to the active harness socket is refused", async () => {
    // This test exercises only the RPC transport, no CGEvent path.
    // Opt out of the Step-3 AX preflight so it doesn't couple to
    // the macOS Accessibility grant state.
    const app = await launchTugApp({ skipAccessibilityPreflight: true });
    try {
      // Sanity: the first connection is usable.
      const one = await app.evalJS<number>("1");
      expect(one).toBe(1);

      // Attempt a bare Bun.connect to the same path. Must reject.
      const connect = (globalThis as unknown as {
        Bun?: { connect: (opts: Record<string, unknown>) => Promise<unknown> };
      }).Bun?.connect;
      if (!connect) {
        throw new Error("Bun.connect unavailable (run via `bun test`)");
      }

      let caught: unknown;
      try {
        await connect({
          unix: app.socketPath,
          // Provide a no-op socket handler set; Bun demands the shape
          // but we won't be using any of them since connect rejects.
          socket: {
            data() {},
            end() {},
            error() {},
            close() {},
          },
        });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeDefined();
      const err = caught as Error;
      // Tolerate a few shapes: Bun may surface the system errno as
      // `code`, as a string fragment in `.message`, or both.
      const codeField = (err as unknown as { code?: unknown }).code;
      const codeStr = typeof codeField === "string" ? codeField : "";
      const errnoField = (err as unknown as { errno?: unknown }).errno;
      const message = typeof err.message === "string" ? err.message : "";
      const looksRefused =
        codeStr === "ECONNREFUSED" ||
        message.includes("ECONNREFUSED") ||
        errnoField === 61 || // macOS
        errnoField === 111; // Linux
      expect(looksRefused).toBe(true);

      // The first connection must still be alive — refusing the
      // second client must not have disturbed the first.
      const two = await app.evalJS<number>("2 + 2");
      expect(two).toBe(4);
    } finally {
      await app.close();
    }
  });
});
