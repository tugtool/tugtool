/**
 * double-connect.test.ts — "Second connect is refused" regression test
 * for the Swift listener's single-client guarantee.
 *
 * Mechanism: the listener closes its listening FD once the first
 * client is accepted. The bound inode stays at the socket path, but
 * the kernel has no listener to dispatch incoming connects to, so a
 * second `connect()` fails while the path itself remains. See the
 * `TestHarnessListener.handleAccept` comment in
 * `tugapp/Sources/TestHarness/TestHarnessListener.swift` for the
 * rationale.
 *
 * The test therefore asserts three things the app owns — the second
 * connect rejects, the socket path survives it, and the first
 * connection keeps working — rather than the errno, which belongs to
 * Bun (see the design note below).
 *
 * Skipped by default unless `TUGAPP_APP_TEST=1` is set. The test
 * needs a built debug Tug.app binary at the default path (or
 * `TUGAPP_DEBUG_PATH` pointing at one).
 *
 * To run locally:
 *   xcodebuild -scheme Tug -configuration Debug build
 *   TUGAPP_APP_TEST=1 bun test tests/app-test/double-connect.test.ts
 *
 * Design notes:
 * - We can't use `launchTugApp` for the second "client" — it always
 *   spawns a fresh subprocess. Instead we call `Bun.connect` directly
 *   at the same socket path the first `App` is using.
 * - `Bun.connect` surfaces the refusal as a rejected promise, but its
 *   errno for an AF_UNIX connect is unreliable: Bun reports ENOENT (-2)
 *   even while the socket file is present (its TCP path reports
 *   ECONNREFUSED correctly). So we assert the rejection plus the
 *   surviving socket path — the two facts the app actually owns — and
 *   leave Bun's errno spelling alone.
 *
 * @covers tests/app-test/_harness/
 * @covers tugapp/Sources/TestHarness/
 */

import { existsSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { launchTugApp } from "../_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

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

      // The rejection itself IS the single-client guarantee: a second
      // client that got accepted would have resolved here.
      expect(caught).toBeDefined();
      const err = caught as Error;

      // We deliberately do NOT assert the errno. Bun reports a refused
      // AF_UNIX connect as ENOENT (-2) even when the socket file is
      // plainly present — its own TCP path reports ECONNREFUSED (-61)
      // correctly, so this is Bun's mapping, not the kernel's answer.
      // Pinning the errno tested Bun's formatting and broke on it.
      //
      // The mechanism check that actually belongs to Tug is the socket
      // path: `TestHarnessListener.handleAccept` closes the LISTENING fd
      // after the first accept and leaves the bound inode in place (only
      // `close()` unlinks it). So the path must still exist — the second
      // client was refused by a live app, not by a vanished socket.
      const shape = JSON.stringify({
        name: err.name,
        message: err.message,
        code: (err as unknown as { code?: unknown }).code,
        errno: (err as unknown as { errno?: unknown }).errno,
      });
      expect(
        existsSync(app.socketPath)
          ? "socket path present"
          : `socket path is GONE — the refusal was ENOENT for real, not a live-app refusal (${shape})`,
      ).toBe("socket path present");

      // The first connection must still be alive — refusing the
      // second client must not have disturbed the first.
      const two = await app.evalJS<number>("2 + 2");
      expect(two).toBe(4);
    } finally {
      await app.close();
    }
  });
});
