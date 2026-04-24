/**
 * index.ts — In-app test harness entry point.
 *
 * Exports `launchTugApp` (spawn + connect + handshake) and the `App`
 * class (thin wrappers over the RPC client's `call`). Parent plan
 * Step 7 lands the minimum surface; later parent plan steps extend
 * `App` with gesture / reset / seed wrappers.
 *
 * Boot sequence (see `#boot-choreography` in the Swift-bridge tugplan):
 *   1. Generate `TUGAPP_TEST_SOCKET=$TMPDIR/tugapp-test-<uuid>.sock`.
 *   2. Spawn Tug.app via `Bun.spawn` with that env var set.
 *   3. Retry `Bun.connect({ unix: <path> })` on `ECONNREFUSED` until
 *      `connectTimeoutMs` elapses.
 *   4. Issue the `version` RPC; throw `VersionSkewError` on major
 *      mismatch.
 *   5. Return an `App` handle with `evalJS` / `waitForCondition` /
 *      `close` ready for test use.
 *
 * Cleanup: `app.close()` sends SIGTERM, waits up to 5s for exit, then
 * SIGKILL. The socket file is unlinked on close; `process.on("exit")`
 * installs a last-resort synchronous unlink so crashed runs do not
 * leak socket files.
 */

import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  type WriteStream,
} from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { AppCrashedError, VersionSkewError } from "./errors";
import { RpcClient, type RpcTransport } from "./rpc";
import type {
  EvalJsOptions,
  LaunchTugAppOptions,
  WaitForConditionOptions,
} from "./types";
import * as client from "./client";
import type {
  CaretState,
  ClickOptions,
  DeckTraceEvent,
  HarnessCaller,
  ResetOptions,
  SeedDeckStateArgs,
} from "./client";

// Re-export the client-side helpers and matcher for test authors. The
// pattern mirrors the parent plan's Spec [#s03-tug-surface] sketch —
// tests import `{ launchTugApp, toContainOrderedSubset }` from
// `@/_harness` and use `app.<method>` for everything else.
export {
  toContainOrderedSubset,
  registerSubsetMatcher,
  type ExpectedEntry,
  type MatcherResult,
} from "./matchers";
export type {
  CaretState,
  ClickOptions,
  ClientMethodNames,
  DeckTraceEvent,
  HarnessCaller,
  ResetOptions,
  SeedDeckStateArgs,
} from "./client";

/**
 * The harness's compile-time expected surface version. Must match the
 * major of `SURFACE_VERSION` in `tugdeck/src/test-surface.ts`.
 */
export const EXPECTED_SURFACE_VERSION = "1.0.0" as const;

/**
 * Directory (relative to this file) where per-test subprocess logs
 * are captured when `testName` is set. Mirrors parent plan List
 * [#l03-lifecycle-behaviors]: "Tug.app stdout/stderr routes to
 * `tests/in-app/logs/<test>.log`".
 */
const LOGS_DIR = pathResolve(import.meta.dir, "..", "logs");

/**
 * Resolved per-run paths for a Tug.app launch.
 */
interface ResolvedLaunch {
  appPath: string;
  socketPath: string;
  connectTimeoutMs: number;
  connectPollMs: number;
  env: Record<string, string | undefined>;
  logPath: string | null;
  expectedSurfaceVersion: string;
}

/**
 * A live connection to a launched Tug.app. Returned by
 * `launchTugApp`; tests interact with this object only.
 */
export class App {
  readonly version: string;
  readonly socketPath: string;
  /**
   * Absolute path to the log file capturing this subprocess's
   * stdout/stderr, or `null` when `testName` was not provided. Tests
   * print the tail of this file on failure via `app.tailLog()`.
   */
  readonly logPath: string | null;
  private readonly rpc: RpcClient;
  private readonly subprocess: { kill: (signal?: string) => void; exited: Promise<number> };
  private readonly onUnlink: () => void;
  private readonly logStream: WriteStream | null;
  private readonly detachSignals: () => void;
  private closed = false;

  constructor(args: {
    rpc: RpcClient;
    version: string;
    socketPath: string;
    subprocess: { kill: (signal?: string) => void; exited: Promise<number> };
    onUnlink: () => void;
    logPath: string | null;
    logStream: WriteStream | null;
    detachSignals: () => void;
  }) {
    this.rpc = args.rpc;
    this.version = args.version;
    this.socketPath = args.socketPath;
    this.subprocess = args.subprocess;
    this.onUnlink = args.onUnlink;
    this.logPath = args.logPath;
    this.logStream = args.logStream;
    this.detachSignals = args.detachSignals;
  }

  /**
   * Evaluate a JS script in Tug.app's WKWebView and return the value.
   * Server-side hard timeout default 5000ms.
   *
   * Throws:
   * - `TimeoutError` — server-side timer fired
   * - `AppCrashedError` — transport closed mid-call
   * - generic `Error` (name preserved) — script threw inside the page
   */
  evalJS<T = unknown>(script: string, opts?: EvalJsOptions): Promise<T> {
    return this.rpc.call<T>({
      method: "evalJS",
      script,
      timeoutMs: opts?.timeoutMs,
    });
  }

  /**
   * Poll a JS expression on the server until it returns truthy, then
   * return that truthy value. Default poll 16ms; default overall
   * timeout 2000ms.
   *
   * Throws `TimeoutError` on budget exceeded. Prefer this over
   * `evalJS` + `setTimeout` — `setTimeout`-based waiting is banned in
   * harness / test code (parent plan [D12]).
   */
  waitForCondition<T = unknown>(
    script: string,
    opts?: WaitForConditionOptions,
  ): Promise<T> {
    return this.rpc.call<T>({
      method: "waitForCondition",
      script,
      timeoutMs: opts?.timeoutMs,
      pollMs: opts?.pollMs,
    });
  }

  // -------------------------------------------------------------------
  // Typed wrappers (parent plan Spec [#s03-tug-surface])
  //
  // Every method below is a thin delegate to `./client.ts`. The
  // wrapper logic — script serialization, `window.__tug` access
  // guards — lives there so the App class stays a readable facade
  // and the wire-format is unit-testable against a mock caller.
  // -------------------------------------------------------------------

  /**
   * Dispatch a full pointerdown → mousedown → pointerup → mouseup →
   * click sequence on the element matched by `selector`. Prefer this
   * over raw DOM clicks — production handlers condition on the whole
   * sequence (see Spec [#s04-event-synthesis]).
   */
  click(selector: string, opts?: ClickOptions): Promise<void> {
    return client.click(this as HarnessCaller, selector, opts);
  }

  /**
   * Type `text` into an `<input>` / `<textarea>` using the
   * native-setter pattern (Spec [#s04-event-synthesis]).
   */
  type(selector: string, text: string): Promise<void> {
    return client.type_(this as HarnessCaller, selector, text);
  }

  /**
   * Direct `.focus()` on the element matched by `selector`. Escape
   * hatch for browser paths where synthesized pointerdown cannot
   * drive default focus ([D09] fidelity limits).
   */
  focusElement(selector: string): Promise<void> {
    return client.focusElement(this as HarnessCaller, selector);
  }

  /**
   * Granular per-axis reset ([D01]). Every axis defaults to false;
   * opt in exactly what a test case needs.
   */
  reset(opts: ResetOptions): Promise<void> {
    return client.reset(this as HarnessCaller, opts);
  }

  /**
   * Replace `DeckState` atomically and optionally merge card-state
   * bags or drive cold-boot focus restore.
   */
  seedDeckState(args: SeedDeckStateArgs): Promise<void> {
    return client.seedDeckState(this as HarnessCaller, args);
  }

  /** Read the deck's current active card (first-responder). */
  getActiveCardId(): Promise<string | null> {
    return client.getActiveCardId(this as HarnessCaller);
  }

  /** Read the deck's current focused card id. */
  getFocusedCardId(): Promise<string | null> {
    return client.getFocusedCardId(this as HarnessCaller);
  }

  /** Read the caret / selection snapshot for `cardId`. */
  getCaretState(cardId: string): Promise<CaretState | null> {
    return client.getCaretState(this as HarnessCaller, cardId);
  }

  /** Read a persisted form-control's value by its persist key. */
  getFormControlValue(
    cardId: string,
    persistKey: string,
  ): Promise<string | null> {
    return client.getFormControlValue(this as HarnessCaller, cardId, persistKey);
  }

  /** `true` iff the deck has registered a card-host root for `cardId`. */
  assertHostRootRegistered(cardId: string): Promise<boolean> {
    return client.assertHostRootRegistered(this as HarnessCaller, cardId);
  }

  /** Pull the DeckTrace ring; `since` filters by `seq > that`. */
  getDeckTrace(opts?: { since?: number }): Promise<readonly DeckTraceEvent[]> {
    return client.getDeckTrace(this as HarnessCaller, opts);
  }

  /** Stamp the trace sequence counter; pair with `getDeckTrace({ since })`. */
  markDeckTrace(): Promise<number> {
    return client.markDeckTrace(this as HarnessCaller);
  }

  /** Drop all buffered trace events. Preserves the enable flag. */
  clearDeckTrace(): Promise<void> {
    return client.clearDeckTrace(this as HarnessCaller);
  }

  /** Toggle trace recording on / off. */
  enableDeckTrace(flag: boolean): Promise<void> {
    return client.enableDeckTrace(this as HarnessCaller, flag);
  }

  /**
   * Block until `getFocusedCardId() === cardId`. Wraps
   * `waitForCondition`; default budget 2000ms (override via `opts`).
   * Throws `TimeoutError` on budget exceeded.
   */
  expectFocusedCard(
    cardId: string,
    opts?: WaitForConditionOptions,
  ): Promise<void> {
    return client.expectFocusedCard(this as HarnessCaller, cardId, opts);
  }

  /**
   * Block until `getCaretState(cardId)` deep-equals `expected`
   * (compared via server-side `JSON.stringify`). Wraps
   * `waitForCondition`; throws `TimeoutError` on budget exceeded.
   */
  expectCaret(
    cardId: string,
    expected: CaretState,
    opts?: WaitForConditionOptions,
  ): Promise<void> {
    return client.expectCaret(this as HarnessCaller, cardId, expected, opts);
  }

  /**
   * Return the last `lines` lines of the captured log file. Returns
   * an empty string when log capture is disabled (i.e. `testName`
   * was not provided). Convenience for `catch` blocks:
   *
   *     try { ... } catch (e) {
   *       console.error(await app.tailLog(50));
   *       throw e;
   *     }
   *
   * `lines` defaults to 50, matching List [#l03-lifecycle-behaviors].
   * The file is read synchronously because this is a failure path —
   * we'd rather block the test teardown than lose output to a race.
   */
  tailLog(lines = 50): string {
    if (!this.logPath) return "";
    let content: string;
    try {
      content = readFileSync(this.logPath, "utf8");
    } catch {
      return "";
    }
    const all = content.split("\n");
    // If the file ends with a newline, split yields a trailing "" we
    // want to drop; otherwise the last element is the final partial line.
    const withoutTrailingEmpty =
      all.length > 0 && all[all.length - 1] === ""
        ? all.slice(0, -1)
        : all;
    const tail = withoutTrailingEmpty.slice(-lines);
    return tail.join("\n");
  }

  /**
   * Dump the full deck trace to `path` as pretty-printed JSON. For
   * use in `catch` blocks that need the trace as a post-mortem
   * artifact — most useful when a test fails before its main
   * assertion can read and pretty-print the trace inline (e.g.
   * `TimeoutError` from `waitForCondition` has nothing to print).
   *
   *     try { ... } catch (e) {
   *       await app.dumpTraceToFile(`tests/in-app/logs/${testName}-trace.json`);
   *       throw e;
   *     }
   *
   * Swallows I/O and RPC errors — this is a failure path, and a
   * secondary error from the dump must not mask the primary
   * assertion failure. Returns the path on success, null on
   * failure. Parent directories are created as needed.
   */
  async dumpTraceToFile(path: string): Promise<string | null> {
    try {
      const trace = await client.getDeckTrace(this as HarnessCaller, {});
      mkdirSync(dirname(pathResolve(path)), { recursive: true });
      writeFileSync(pathResolve(path), JSON.stringify(trace, null, 2));
      return path;
    } catch {
      return null;
    }
  }

  /**
   * SIGTERM the subprocess, wait up to 5s for exit, SIGKILL on
   * timeout. Unlinks the socket file, flushes the log stream, and
   * detaches process-level signal handlers. Idempotent.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.subprocess.kill("SIGTERM");
    } catch {
      // already exited; fall through to unlink
    }
    const exitPromise = this.subprocess.exited.catch(() => 0);
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeoutNative(() => resolve("timeout"), 5000),
    );
    const winner = await Promise.race([exitPromise, timeout]);
    if (winner === "timeout") {
      try {
        this.subprocess.kill("SIGKILL");
      } catch {
        // already dead
      }
      await exitPromise;
    }
    try {
      this.onUnlink();
    } catch {
      // already gone; ignore
    }
    // Close the log stream after the subprocess has exited; its pipe
    // writer will have flushed whatever tail it produced by then.
    try {
      this.logStream?.end();
    } catch {
      // best-effort
    }
    // Detach signal handlers — closing a specific App must not leak
    // SIGINT/SIGTERM listeners past its lifetime.
    try {
      this.detachSignals();
    } catch {
      // best-effort
    }
  }
}

/**
 * Spawn a Tug.app debug build, connect to its test harness socket,
 * handshake on version, return an `App` handle.
 *
 * The `setTimeout` / `setInterval` ban ([D12]) applies to test files
 * and to wrappers we expose over the RPC surface; the harness itself
 * owns timing for subprocess lifecycle (connect backoff, SIGTERM
 * grace window). We use the native scheduler here because there is
 * no truthy-polling primitive available yet.
 */
export async function launchTugApp(
  opts: LaunchTugAppOptions = {},
): Promise<App> {
  const resolved = resolveLaunchOptions(opts);

  // Open the per-test log file BEFORE spawn so the writer is ready
  // when the first subprocess bytes arrive. `null` when testName is
  // unset — stdout/stderr are then piped but not tee'd to disk.
  const logStream = openLogStream(resolved.logPath);

  // Spawn Tug.app. Bun's subprocess API is awaited for `.exited`.
  const subprocess = spawnTugApp(resolved);

  // Pipe subprocess stdout/stderr into the log file. The Bun.spawn
  // configuration asks for "pipe" on both streams so they return
  // `ReadableStream<Uint8Array>`; we drain them asynchronously.
  if (logStream) {
    void pumpToLog(subprocess.stdout, logStream);
    void pumpToLog(subprocess.stderr, logStream);
  }

  // Register a last-resort unlink in case the harness is killed
  // before `app.close()` runs.
  const onExitUnlink = () => {
    try {
      unlinkSync(resolved.socketPath);
    } catch {
      // already gone
    }
  };
  process.on("exit", onExitUnlink);

  // Install SIGINT / SIGTERM / exit handlers so a Ctrl-C at the
  // runner or an unexpected exit cleans up the subprocess instead
  // of leaving it orphaned. Mirrors parent plan List
  // [#l03-lifecycle-behaviors]. `detachSignals` is called by
  // `App.close()` so these handlers do not accumulate across
  // sequential `launchTugApp` calls within one test file.
  const detachSignals = installSignalHandlers(subprocess);

  // Retry Bun.connect until ECONNREFUSED resolves or the window elapses.
  let socket;
  try {
    socket = await connectWithRetry(
      resolved.socketPath,
      resolved.connectTimeoutMs,
      resolved.connectPollMs,
      subprocess,
    );
  } catch (err) {
    detachSignals();
    try {
      logStream?.end();
    } catch {
      // best-effort
    }
    throw err;
  }

  // Bridge Bun.Socket to RpcTransport. `socket.write` accepts strings.
  const transport: RpcTransport = makeSocketTransport(socket, subprocess);
  const rpc = new RpcClient(transport);

  // Handshake: first RPC is always `version`. Mismatch → throw.
  // `expectedSurfaceVersion` override lets the version-skew test
  // deliberately mismatch without requiring a Swift rebuild.
  const expectedVersion =
    resolved.expectedSurfaceVersion ?? EXPECTED_SURFACE_VERSION;
  const serverVersion = await rpc.call<string>({ method: "version" });
  const expectedMajor = expectedVersion.split(".")[0];
  const actualMajor = String(serverVersion).split(".")[0];
  if (expectedMajor !== actualMajor) {
    try {
      subprocess.kill("SIGTERM");
    } catch {
      // already dead
    }
    detachSignals();
    try {
      logStream?.end();
    } catch {
      // best-effort
    }
    throw new VersionSkewError(
      `surface version mismatch: expected=${expectedVersion} actual=${serverVersion}`,
      expectedVersion,
      String(serverVersion),
    );
  }

  // Version handshake answers from a Swift constant — it passes even
  // while the WKWebView is still at about:blank. Wait for tugdeck's
  // main.tsx to execute and attach `window.__tug` before returning,
  // so the first post-launch RPC doesn't race the page load. Wire
  // params are flat; no `params` envelope. On failure we kill the
  // subprocess ourselves — the caller never received an App and
  // therefore has no `close()` path.
  try {
    await rpc.call<boolean>({
      method: "waitForCondition",
      script: "typeof window.__tug !== 'undefined'",
      timeoutMs: resolved.connectTimeoutMs,
    });
  } catch (err) {
    try {
      subprocess.kill("SIGKILL");
    } catch {
      // already dead
    }
    detachSignals();
    try {
      logStream?.end();
    } catch {
      // best-effort
    }
    try {
      onExitUnlink();
    } catch {
      // already gone
    }
    throw err;
  }

  return new App({
    rpc,
    version: String(serverVersion),
    socketPath: resolved.socketPath,
    subprocess,
    onUnlink: onExitUnlink,
    logPath: resolved.logPath,
    logStream,
    detachSignals,
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Narrow, typed shim for the globalThis scheduler. We import this
 * rather than using `setTimeout` directly so a grep for
 * `setTimeout` in `tests/in-app/` only hits `./_harness/*` (harness
 * internals), not test files.
 */
const setTimeoutNative = (
  globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => unknown }
).setTimeout;

function resolveLaunchOptions(opts: LaunchTugAppOptions): ResolvedLaunch {
  // macOS `/tmp` is root-owned; the Swift bridge's parent-dir-owner
  // check ([D06]) rejects sockets there. `os.tmpdir()` returns the
  // user-owned `$TMPDIR` (`/var/folders/.../T/` on macOS).
  const socketPath =
    opts.socketPath ?? `${tmpdir()}/tugapp-test-${randomUUID()}.sock`;
  const appPath = opts.appPath ?? resolveDefaultAppPath();
  const logPath = opts.testName
    ? pathResolve(LOGS_DIR, `${sanitizeTestName(opts.testName)}.log`)
    : null;
  return {
    appPath,
    socketPath,
    connectTimeoutMs: opts.connectTimeoutMs ?? 10000,
    connectPollMs: opts.connectPollMs ?? 100,
    env: {
      ...process.env,
      ...(opts.env ?? {}),
      TUGAPP_TEST_SOCKET: socketPath,
    },
    logPath,
    expectedSurfaceVersion: opts.expectedSurfaceVersion ?? EXPECTED_SURFACE_VERSION,
  };
}

/**
 * Collapse characters that are awkward on a filesystem into `-`. Keeps
 * the log filename predictable — a test named "foo bar / baz" becomes
 * `foo-bar---baz.log`.
 */
function sanitizeTestName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, "-");
}

/**
 * Open a write stream at the given log path (creating the parent dir
 * if missing). `null` in → `null` out, which disables log capture.
 */
function openLogStream(logPath: string | null): WriteStream | null {
  if (!logPath) return null;
  try {
    mkdirSync(dirname(logPath), { recursive: true });
  } catch {
    // Directory already exists, or we can't create it. If creation
    // fails, `createWriteStream` will surface the real error.
  }
  // Truncate on open — each test run gets a fresh log. Callers that
  // want to aggregate across runs should manage their own filename.
  return createWriteStream(logPath, { flags: "w" });
}

/**
 * Drain a Bun-style ReadableStream<Uint8Array> into the log stream.
 * Swallows errors — log capture must not influence test outcomes.
 * Returns when the source stream ends.
 */
async function pumpToLog(
  source: ReadableStream<Uint8Array> | null | undefined,
  sink: WriteStream,
): Promise<void> {
  if (!source) return;
  const reader = source.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) {
        try {
          sink.write(value);
        } catch {
          // drop; we don't want writer backpressure to kill the test
        }
      }
    }
  } catch {
    // source errored; give up cleanly
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // best-effort
    }
  }
}

/**
 * Register per-launch SIGINT / SIGTERM / exit listeners that terminate
 * the subprocess if the runner is interrupted or exits unexpectedly.
 * Returns a detach function that removes these listeners — `App.close()`
 * calls it so handler counts do not grow across sequential launches.
 *
 * Contract (per parent plan List [#l03-lifecycle-behaviors]):
 *   - `SIGINT` / `SIGTERM`: kill the subprocess (SIGTERM; SIGKILL if
 *     it refuses to die after a short grace window), unlink the
 *     socket, then re-emit the signal via `process.exit(128 + sig)`.
 *   - `exit`: last-resort synchronous `kill("SIGKILL")` for pathological
 *     exits where the subprocess is still alive.
 */
function installSignalHandlers(subprocess: SpawnedTugApp): () => void {
  const onSignal = (signal: NodeJS.Signals) => {
    // Best-effort terminate; we cannot await here because signal
    // handlers on Node/Bun run synchronously before the default
    // action. The process.on("exit") handler below catches the
    // pathological case where the subprocess is still alive when
    // the runner is on its way out.
    try {
      subprocess.kill("SIGTERM");
    } catch {
      // already dead
    }
    // Use the default exit code convention: 128 + signal number. We
    // don't know the signal number reliably from the name, so fall
    // back to a simple 1/0 exit. Tests treat the runner's exit code
    // as opaque; the subprocess cleanup is what matters.
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  const onExit = () => {
    try {
      subprocess.kill("SIGKILL");
    } catch {
      // already gone
    }
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("exit", onExit);
  return () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("exit", onExit);
  };
}

function resolveDefaultAppPath(): string {
  // Default: the xcodebuild Debug build product. Tests can override
  // via opts.appPath. We do NOT probe the filesystem here — that is
  // the caller's concern; a missing binary surfaces as Bun.spawn ENOENT.
  const fromEnv = process.env.TUGAPP_DEBUG_PATH;
  if (fromEnv) return fromEnv;
  return "/Applications/Tug.app/Contents/MacOS/Tug";
}

interface SpawnedTugApp {
  kill: (signal?: string) => void;
  exited: Promise<number>;
  stdout?: ReadableStream<Uint8Array> | null;
  stderr?: ReadableStream<Uint8Array> | null;
}

function spawnTugApp(resolved: ResolvedLaunch): SpawnedTugApp {
  // Bun.spawn is typed on `Bun.spawn`; we use a narrow cast so this
  // file still compiles under non-Bun `tsc` checks if the types
  // haven't loaded.
  const spawnFn = (globalThis as unknown as {
    Bun?: { spawn: (opts: Record<string, unknown>) => SpawnedTugApp };
  }).Bun?.spawn;
  if (!spawnFn) {
    throw new Error("launchTugApp: Bun.spawn is unavailable (run via `bun test`)");
  }

  // Launch via `/usr/bin/open` (LaunchServices) instead of spawning
  // the Mach-O binary directly.
  //
  // ## Why this detour exists
  //
  // macOS TCC (the Accessibility-permissions daemon) needs the target
  // process to be attached to the user's GUI launchd session so the
  // user-level `tccd` is reachable. A `Bun.spawn` of the bare Mach-O
  // exec inherits bun's session, which doesn't have that attachment —
  // the spawned Tug.app's WebKit helpers log
  // `user tccd unavailable, XPC_ERROR_CONNECTION_INVALID` and every
  // `AXIsProcessTrusted()` returns false regardless of the user grant.
  //
  // `open` goes through LaunchServices, which bootstraps the launched
  // app into the proper GUI session where tccd is reachable — so
  // TCC can actually evaluate the grant against the binary's code
  // signature. Once in that session, `CGEvent.post` works.
  //
  // ## Lifecycle
  //
  // `open -W` blocks until the launched app exits, so the Bun
  // subprocess handle's `.exited` promise resolves exactly when Tug.app
  // quits. `open --stdout` / `--stderr` route the app's output to the
  // per-test log file directly; the harness's `pumpToLog` on the
  // Bun pipes is a no-op in this mode (streams are empty) and is kept
  // only so the caller path doesn't need two branches.
  //
  // ## Kill semantics
  //
  // SIGTERM to the `open -W` wrapper doesn't reliably propagate to the
  // launched app. We instead send the kill signal directly to Tug.app
  // via `pkill -x Tug`; the wrapper exits once the app it was waiting
  // on does. Single-client test loop keeps the `-x` match unambiguous
  // (there's only one Tug process at a time).
  const bundlePath = resolved.appPath.replace(/\/Contents\/MacOS\/[^/]+$/, "");
  const envArgs: string[] = [];
  for (const [k, v] of Object.entries(resolved.env)) {
    if (typeof v !== "string") continue;
    envArgs.push("--env", `${k}=${v}`);
  }
  const logPathForRedirect = resolved.logPath ?? "/dev/null";

  const subprocess = spawnFn({
    cmd: [
      "/usr/bin/open",
      "-n",              // new instance
      "-W",              // wait-apps (blocks until Tug.app quits)
      // NO -g: Tug.app MUST be foreground so CGEvent.post mouse
      // events hit its window. CGEvent events route through
      // windowserver by screen coord → window-on-top; a backgrounded
      // Tug.app sits behind whatever was active (terminal, IDE) and
      // the clicks land on the wrong app.
      "--stdout", logPathForRedirect,
      "--stderr", logPathForRedirect,
      ...envArgs,
      bundlePath,
    ],
    // `open` itself doesn't need the TUGAPP_* env vars (they go to
    // the app via --env); forwarding PATH is enough.
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      USER: process.env.USER ?? "",
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  // Wrap `.kill` so SIGTERM reliably reaches the Tug.app process.
  const originalKill = subprocess.kill.bind(subprocess);
  const wrappedKill = (signal?: string): void => {
    const sig = signal ?? "SIGTERM";
    // `pkill -x Tug` matches the executable name exactly. The
    // harness's test-in-app recipe already pkills Tug between test
    // files, so this is idempotent.
    try {
      const spawnSync = (
        globalThis as unknown as {
          Bun?: {
            spawnSync: (opts: Record<string, unknown>) => { exitCode: number };
          };
        }
      ).Bun?.spawnSync;
      spawnSync?.({
        cmd: ["/usr/bin/pkill", sig === "SIGKILL" ? "-KILL" : "-TERM", "-x", "Tug"],
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
    } catch {
      // ignore — the fallback below still runs
    }
    // Also signal the `open -W` wrapper so its `.exited` resolves
    // promptly on the harness side.
    try {
      originalKill(sig);
    } catch {
      // already dead
    }
  };

  return {
    kill: wrappedKill,
    exited: subprocess.exited,
    stdout: subprocess.stdout,
    stderr: subprocess.stderr,
  };
}

interface BunSocketLike {
  write(data: string | Uint8Array): number;
  end(): void;
  data?: { onData?: (chunk: string) => void; onClose?: (reason: unknown) => void };
}

async function connectWithRetry(
  socketPath: string,
  timeoutMs: number,
  pollMs: number,
  subprocess: SpawnedTugApp,
): Promise<BunSocketLike> {
  const connect = (globalThis as unknown as {
    Bun?: { connect: (opts: Record<string, unknown>) => Promise<BunSocketLike> };
  }).Bun?.connect;
  if (!connect) {
    throw new Error("connectWithRetry: Bun.connect is unavailable");
  }

  const start = Date.now();
  let lastErr: unknown = null;

  // Per-connection state for the socket-transport glue. We install a
  // callback-style handler set here so `makeSocketTransport` can
  // receive pushes before the transport object is constructed.
  const sharedState: { onData?: (chunk: string) => void; onClose?: (reason: unknown) => void } = {};

  while (Date.now() - start < timeoutMs) {
    try {
      const sock = await connect({
        unix: socketPath,
        socket: {
          data(_s: unknown, buf: Buffer | Uint8Array | string) {
            if (!sharedState.onData) return;
            sharedState.onData(
              typeof buf === "string"
                ? buf
                : new TextDecoder().decode(buf as Uint8Array),
            );
          },
          end() {
            sharedState.onClose?.({ exitCode: null, signal: null });
          },
          error(_s: unknown, err: Error) {
            sharedState.onClose?.({ exitCode: null, signal: String(err.message) });
          },
          close() {
            sharedState.onClose?.({ exitCode: null, signal: null });
          },
        },
      });
      (sock as { data?: typeof sharedState }).data = sharedState;
      return sock;
    } catch (err) {
      lastErr = err;
      // Check if the subprocess died early — no point in retrying.
      const raced = await Promise.race([
        subprocess.exited.then((code) => ({ dead: true, code })),
        new Promise<{ dead: false }>((resolve) =>
          setTimeoutNative(() => resolve({ dead: false }), pollMs),
        ),
      ]);
      if (raced.dead) {
        throw new AppCrashedError(
          `Tug.app exited before test harness socket could connect (exitCode=${raced.code})`,
          raced.code,
          null,
        );
      }
    }
  }
  throw new Error(
    `connectWithRetry: exceeded ${timeoutMs}ms waiting for ${socketPath} (lastErr=${String(lastErr)})`,
  );
}

function makeSocketTransport(
  socket: BunSocketLike,
  subprocess: SpawnedTugApp,
): RpcTransport {
  // The shared state established in connectWithRetry carries the
  // data/close callbacks. Reading them here completes the bridge.
  const sharedState = (socket as { data?: { onData?: (chunk: string) => void; onClose?: (reason: unknown) => void } }).data;
  if (!sharedState) {
    throw new Error("makeSocketTransport: socket was connected without sharedState");
  }

  // Also propagate subprocess exit into transport close.
  void subprocess.exited.then((code) => {
    sharedState.onClose?.({ exitCode: code, signal: null });
  });

  return {
    write(data: string): void {
      socket.write(data);
    },
    onData(handler: (chunk: string) => void): void {
      sharedState.onData = handler;
    },
    onClose(handler: (reason: { exitCode?: number | null; signal?: string | null }) => void): void {
      sharedState.onClose = (reason: unknown) => {
        const r = reason as { exitCode?: number | null; signal?: string | null } | undefined;
        handler({ exitCode: r?.exitCode ?? null, signal: r?.signal ?? null });
      };
    },
  };
}
