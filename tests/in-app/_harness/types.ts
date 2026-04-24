/**
 * types.ts — RPC wire types for the in-app test harness.
 *
 * Mirrors Spec [#s01-rpc-protocol] from `roadmap/tugplan-in-app-bridge.md`.
 * This file is types-only — no tugdeck runtime imports, no side effects.
 * The Swift side implements the same shape informally; drift is caught
 * at handshake via `VersionSkewError`.
 *
 * Framing: newline-delimited JSON (NDJSON). Every request carries a
 * numeric `id`; the response shares it. See `./rpc.ts` for the
 * correlator and framing implementation.
 */

/**
 * Method names the harness can invoke over the bridge. Kept as a
 * string-literal union so callers get type narrowing in `switch`.
 */
export type RpcMethod = "evalJS" | "waitForCondition" | "version";

/**
 * The request shape sent from harness → Swift, NDJSON-framed. Every
 * variant carries `id` (numeric, unique per connection) and a
 * discriminating `method` string.
 */
export type Request =
  | {
      id: number;
      method: "evalJS";
      script: string;
      timeoutMs?: number;
    }
  | {
      id: number;
      method: "waitForCondition";
      script: string;
      timeoutMs?: number;
      pollMs?: number;
    }
  | {
      id: number;
      method: "version";
    };

/**
 * Generic response shape. Discriminated on `ok`. Swift-side script
 * throws and non-serializable return values both serialize into the
 * `ok: false` branch.
 */
export type Response<T> =
  | {
      id: number;
      ok: true;
      value: T;
    }
  | {
      id: number;
      ok: false;
      error: {
        name: string;
        message: string;
        stack?: string;
      };
    };

/**
 * Options for a single `evalJS` call.
 */
export interface EvalJsOptions {
  /** Server-side hard timeout in milliseconds. Default 5000. */
  timeoutMs?: number;
}

/**
 * Options for a single `waitForCondition` call.
 */
export interface WaitForConditionOptions {
  /** Server-side overall timeout in milliseconds. Default 2000. */
  timeoutMs?: number;
  /** Poll interval in milliseconds. Default 16. */
  pollMs?: number;
}

/**
 * Options for `launchTugApp`.
 */
export interface LaunchTugAppOptions {
  /**
   * Absolute path to the Tug.app binary to launch. If unset, the
   * harness resolves a default debug build via `Tug.app/Contents/
   * MacOS/Tug` under `tugapp/` build products.
   */
  appPath?: string;

  /**
   * Socket path the harness will tell Tug.app to listen on. If unset,
   * a per-invocation uuid path under `/tmp/tugapp-test-<uuid>.sock` is
   * generated.
   */
  socketPath?: string;

  /**
   * Maximum wall-clock time to wait for the Unix socket to become
   * connectable, in milliseconds. Default 10000.
   */
  connectTimeoutMs?: number;

  /**
   * Poll interval for connect retries in milliseconds. Default 100.
   */
  connectPollMs?: number;

  /**
   * Additional environment variables to pass to the Tug.app
   * subprocess. Merged on top of the current `process.env`.
   */
  env?: Record<string, string>;

  /**
   * Test name; used for the `logs/<test-name>.log` capture path when
   * stdout/stderr redirection is enabled. Optional. When set, the
   * harness opens `tests/in-app/logs/<testName>.log` and pipes the
   * subprocess's stdout/stderr into it; `app.logPath` is populated so
   * tests can call `app.tailLog()` on failure.
   */
  testName?: string;

  /**
   * Override the harness-expected surface version for the handshake.
   * Defaults to `EXPECTED_SURFACE_VERSION` (the compile-time constant
   * in `_harness/index.ts`). Tests that want to exercise the
   * version-skew code path pass a deliberately-wrong value here; in
   * production test code this is never set.
   */
  expectedSurfaceVersion?: string;
}
