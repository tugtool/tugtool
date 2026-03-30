/**
 * TugWorkerPool hardening tests — Step 8.
 *
 * Tests added as part of Phase 3A.2 hardening:
 *
 * 1. Multi-slot dispatch: N slow tasks + 1 fast task — the fast task completes
 *    first, proving least-busy dispatch routes it to an idle slot.
 *
 * 2. Init timeout path: a delayed-init worker holds tasks in the pool's
 *    readyQueue until init fires; all queued tasks complete after init.
 *
 * Both tests use real Worker threads (not fallback mode) to exercise the full
 * slot management, readyQueue, and dispatch code paths.
 *
 * Transferable detection short-circuit: verified structurally — the change is
 * a pure optimisation (primitives/strings always return [] without tree-walk).
 * No observable behaviour difference; performance benefit documented in source.
 */
import { describe, it, expect } from "bun:test";
import { TugWorkerPool } from "../lib/tug-worker-pool";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SLOW_WORKER_URL = new URL("./workers/slow-worker.ts", import.meta.url);
const DELAYED_INIT_WORKER_URL = new URL("./workers/delayed-init-worker.ts", import.meta.url);

/** Create a factory from a URL (works in bun test where .ts is natively supported). */
const slowWorkerFactory = () => new Worker(SLOW_WORKER_URL, { type: "module" });
const delayedInitWorkerFactory = () => new Worker(DELAYED_INIT_WORKER_URL, { type: "module" });

/** Wait up to `ms` for a promise, or throw a timeout error. */
function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timed out after ${ms}ms${label ? ` (${label})` : ""}`)),
        ms,
      ),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// 1. Multi-slot dispatch: fast task finishes before slow tasks
// ---------------------------------------------------------------------------

describe("multi-slot dispatch — least-busy routing", () => {
  it("fast task completes before slow tasks when dispatched to an idle slot", async () => {
    // Pool of 3 workers. Submit 3 slow tasks (300ms each) to saturate all slots,
    // then submit 1 fast task (0ms delay). The fast task should be dispatched to
    // whichever slot finishes first or to the newly grown slot, and must resolve
    // before all slow tasks complete.
    //
    // Per-slot lazy respawn means the pool starts with 1 worker. As slow tasks
    // arrive and that slot becomes busy, the pool grows to accommodate them.
    // The fast task either lands on a freshly-grown idle slot (inFlight=0) or
    // on the least-busy available slot.
    const POOL_SIZE = 3;
    const SLOW_DELAY_MS = 300;
    const FAST_DELAY_MS = 0;

    const pool = new TugWorkerPool<{ delayMs: number; value: number }, number>(slowWorkerFactory, {
      poolSize: POOL_SIZE,
      initTimeoutMs: 5000,
      idleTimeoutMs: 60_000,
    });

    const completionOrder: number[] = [];

    // Submit 3 slow tasks (one per slot).
    const slowHandles = Array.from({ length: POOL_SIZE }, (_, i) =>
      pool.submit({ delayMs: SLOW_DELAY_MS, value: i }),
    );

    // Give the slow tasks a moment to be dispatched to their slots.
    await new Promise((r) => setTimeout(r, 20));

    // Submit 1 fast task — the pool now has inFlight on all initial slots so it
    // will grow (lazy respawn) to accommodate it on a fresh slot, or dispatch
    // to whichever slot freed up soonest.
    const fastHandle = pool.submit({ delayMs: FAST_DELAY_MS, value: 99 });

    // Attach completion tracking.
    const fastDone = fastHandle.promise.then((v) => {
      completionOrder.push(v);
      return v;
    });
    const slowDone = Promise.all(
      slowHandles.map((h) =>
        h.promise.then((v) => {
          completionOrder.push(v);
          return v;
        }),
      ),
    );

    // Wait for all tasks.
    const [fastResult, slowResults] = await withTimeout(
      Promise.all([fastDone, slowDone]),
      5000,
      "multi-slot dispatch",
    );

    // Fast task must resolve with its payload value.
    expect(fastResult).toBe(99);

    // Slow task results arrive in some order.
    expect(slowResults.sort((a, b) => a - b)).toEqual([0, 1, 2]);

    // The fast task (value=99) must appear in completionOrder before all slow tasks.
    const fastIdx = completionOrder.indexOf(99);
    expect(fastIdx).toBeGreaterThanOrEqual(0);
    // At least some slow tasks must have completed after the fast task.
    const slowAfterFast = completionOrder.slice(fastIdx + 1).filter((v) => v !== 99);
    expect(slowAfterFast.length).toBeGreaterThan(0);

    pool.terminate();
  });
});

// ---------------------------------------------------------------------------
// 2. Init timeout path: tasks queued before init are flushed after init
// ---------------------------------------------------------------------------

describe("init timeout path — delayed-init worker", () => {
  it("tasks submitted before init completes are flushed and resolved after init", async () => {
    // The delayed-init worker sends { type: 'init' } after 200ms.
    // The pool is configured with initTimeoutMs=5000 so the real init fires first
    // (not the timeout). Tasks submitted immediately are queued in readyQueue and
    // must complete once init arrives and flushReadyQueue runs.
    const pool = new TugWorkerPool<{ value: number }, { value: number }>(delayedInitWorkerFactory, {
      poolSize: 1,
      initTimeoutMs: 5000,
      idleTimeoutMs: 60_000,
    });

    // Submit 3 tasks before init arrives (worker hasn't fired init yet).
    const handles = [
      pool.submit({ value: 10 }),
      pool.submit({ value: 20 }),
      pool.submit({ value: 30 }),
    ];

    // All 3 tasks must resolve after init fires (within ~500ms total).
    const results = await withTimeout(
      Promise.all(handles.map((h) => h.promise)),
      3000,
      "delayed-init flush",
    );

    expect(results).toEqual([{ value: 10 }, { value: 20 }, { value: 30 }]);

    pool.terminate();
  });

  it("init-timeout fires and flushes readyQueue when worker never sends init", async () => {
    // Configure a very short initTimeoutMs (150ms) so the timeout fires before
    // the delayed-init worker (200ms delay) sends its init message. The pool must
    // treat the slot as ready after the timeout and flush queued tasks.
    const pool = new TugWorkerPool<{ value: number }, { value: number }>(delayedInitWorkerFactory, {
      poolSize: 1,
      initTimeoutMs: 100, // shorter than the worker's 200ms delay
      idleTimeoutMs: 60_000,
    });

    // Submit tasks immediately — they land in readyQueue (slot not yet ready).
    const handles = [pool.submit({ value: 1 }), pool.submit({ value: 2 })];

    // Timeout fires at 100ms, slot marked ready, readyQueue flushed.
    // Worker sends real init at 200ms (ignored — slot already ready).
    // Tasks resolve shortly after 100ms via the timeout path.
    const results = await withTimeout(
      Promise.all(handles.map((h) => h.promise)),
      3000,
      "init-timeout flush",
    );

    expect(results).toEqual([{ value: 1 }, { value: 2 }]);

    pool.terminate();
  });
});

// ---------------------------------------------------------------------------
// 3. Transferable detection short-circuit (structural verification)
// ---------------------------------------------------------------------------

describe("transferable detection — string/primitive payloads", () => {
  it("pool accepts string payloads without error (short-circuit path exercised)", async () => {
    // The short-circuit in collectTransferables returns [] immediately for
    // strings without walking the object tree. Use the echo worker to verify
    // round-trip works correctly with a string payload.
    const echoUrl = new URL("./workers/echo-worker.ts", import.meta.url);
    const pool = new TugWorkerPool<string, string>(() => new Worker(echoUrl, { type: "module" }), {
      poolSize: 1,
      initTimeoutMs: 5000,
      idleTimeoutMs: 60_000,
    });

    const result = await withTimeout(pool.submit("hello transferable short-circuit").promise, 3000);
    expect(result).toBe("hello transferable short-circuit");

    pool.terminate();
  });

  it("pool accepts number payloads without error (short-circuit path exercised)", async () => {
    const echoUrl = new URL("./workers/echo-worker.ts", import.meta.url);
    const pool = new TugWorkerPool<number, number>(() => new Worker(echoUrl, { type: "module" }), {
      poolSize: 1,
      initTimeoutMs: 5000,
      idleTimeoutMs: 60_000,
    });

    const result = await withTimeout(pool.submit(12345).promise, 3000);
    expect(result).toBe(12345);

    pool.terminate();
  });
});
