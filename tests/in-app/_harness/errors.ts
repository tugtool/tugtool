/**
 * errors.ts — Harness error classes.
 *
 * Mirrors Spec [#s02-error-classes] from `roadmap/tugplan-in-app-bridge.md`.
 * Structured errors let test authors `catch (e) { if (e instanceof
 * TimeoutError) ... }` without string-matching on messages.
 *
 * Error translation rule: the Swift side serializes errors as
 * `{ ok: false, error: { name, message, stack? } }`. The harness's RPC
 * client (see `./rpc.ts`) reads `error.name` and throws the matching
 * class. Unknown names fall back to a plain `Error` with the server's
 * message preserved.
 *
 * Classes here are intentionally minimal — just the fields tests will
 * actually branch on. `name` is a readonly literal so `switch` on
 * `e.name` works for codegen-generated clients that can't use
 * `instanceof` across bundle boundaries.
 */

/**
 * Thrown when the Swift bridge reports that an `evalJS` or
 * `waitForCondition` exceeded its budget. `script` is the original
 * script body if available; `timeoutMs` is the budget that was exceeded.
 */
export class TimeoutError extends Error {
  readonly name = "TimeoutError" as const;
  readonly script: string | undefined;
  readonly timeoutMs: number | undefined;

  constructor(message: string, script?: string, timeoutMs?: number) {
    super(message);
    this.script = script;
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * Thrown when the Tug.app subprocess exits unexpectedly (the Swift
 * bridge closes the socket or the process dies). `exitCode` /
 * `signal` come from the Bun subprocess handle when available.
 */
export class AppCrashedError extends Error {
  readonly name = "AppCrashedError" as const;
  readonly exitCode: number | null | undefined;
  readonly signal: string | null | undefined;

  constructor(
    message: string,
    exitCode?: number | null,
    signal?: string | null,
  ) {
    super(message);
    this.exitCode = exitCode;
    this.signal = signal;
    Object.setPrototypeOf(this, AppCrashedError.prototype);
  }
}

/**
 * Thrown when the `version` handshake reports a major version the
 * harness client does not understand. `expected` is the harness's
 * compiled-in expected version; `actual` is what the Swift/JS side
 * reported over the wire.
 */
export class VersionSkewError extends Error {
  readonly name = "VersionSkewError" as const;
  readonly expected: string;
  readonly actual: string;

  constructor(message: string, expected: string, actual: string) {
    super(message);
    this.expected = expected;
    this.actual = actual;
    Object.setPrototypeOf(this, VersionSkewError.prototype);
  }
}
