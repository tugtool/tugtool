/**
 * index.ts — In-app test harness entry point.
 *
 * Exports `launchTugApp` (spawn + connect + handshake) and the `App`
 * class (thin wrappers over the RPC client's `call`). Parent plan
 * Step 7 lands the minimum surface; later parent plan steps extend
 * `App` with gesture / reset / seed wrappers.
 *
 * Boot sequence (see `#boot-choreography` in the Swift-bridge tugplan):
 *   1. Generate `TUGAPP_TEST_SOCKET=/tmp/tugapp-test-<uuid>.sock`.
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

import { unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { AppCrashedError, VersionSkewError } from "./errors";
import { RpcClient, type RpcTransport } from "./rpc";
import type {
  EvalJsOptions,
  LaunchTugAppOptions,
  WaitForConditionOptions,
} from "./types";

/**
 * The harness's compile-time expected surface version. Must match the
 * major of `SURFACE_VERSION` in `tugdeck/src/test-surface.ts`.
 */
export const EXPECTED_SURFACE_VERSION = "1.0.0" as const;

/**
 * Resolved per-run paths for a Tug.app launch.
 */
interface ResolvedLaunch {
  appPath: string;
  socketPath: string;
  connectTimeoutMs: number;
  connectPollMs: number;
  env: Record<string, string | undefined>;
}

/**
 * A live connection to a launched Tug.app. Returned by
 * `launchTugApp`; tests interact with this object only.
 */
export class App {
  readonly version: string;
  readonly socketPath: string;
  private readonly rpc: RpcClient;
  private readonly subprocess: { kill: (signal?: string) => void; exited: Promise<number> };
  private readonly onUnlink: () => void;
  private closed = false;

  constructor(args: {
    rpc: RpcClient;
    version: string;
    socketPath: string;
    subprocess: { kill: (signal?: string) => void; exited: Promise<number> };
    onUnlink: () => void;
  }) {
    this.rpc = args.rpc;
    this.version = args.version;
    this.socketPath = args.socketPath;
    this.subprocess = args.subprocess;
    this.onUnlink = args.onUnlink;
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

  /**
   * SIGTERM the subprocess, wait up to 5s for exit, SIGKILL on
   * timeout. Unlinks the socket file. Idempotent.
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

  // Spawn Tug.app. Bun's subprocess API is awaited for `.exited`.
  const subprocess = spawnTugApp(resolved);

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

  // Retry Bun.connect until ECONNREFUSED resolves or the window elapses.
  const socket = await connectWithRetry(
    resolved.socketPath,
    resolved.connectTimeoutMs,
    resolved.connectPollMs,
    subprocess,
  );

  // Bridge Bun.Socket to RpcTransport. `socket.write` accepts strings.
  const transport: RpcTransport = makeSocketTransport(socket, subprocess);
  const rpc = new RpcClient(transport);

  // Handshake: first RPC is always `version`. Mismatch → throw.
  const serverVersion = await rpc.call<string>({ method: "version" });
  const expectedMajor = EXPECTED_SURFACE_VERSION.split(".")[0];
  const actualMajor = String(serverVersion).split(".")[0];
  if (expectedMajor !== actualMajor) {
    try {
      subprocess.kill("SIGTERM");
    } catch {
      // already dead
    }
    throw new VersionSkewError(
      `surface version mismatch: expected=${EXPECTED_SURFACE_VERSION} actual=${serverVersion}`,
      EXPECTED_SURFACE_VERSION,
      String(serverVersion),
    );
  }

  return new App({
    rpc,
    version: String(serverVersion),
    socketPath: resolved.socketPath,
    subprocess,
    onUnlink: onExitUnlink,
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
  const socketPath = opts.socketPath ?? `/tmp/tugapp-test-${randomUUID()}.sock`;
  const appPath = opts.appPath ?? resolveDefaultAppPath();
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
  return spawnFn({
    cmd: [resolved.appPath],
    env: resolved.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
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
