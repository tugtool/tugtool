/**
 * Integration tests for TugWorkerPool with real Worker threads.
 *
 * These tests spawn actual Worker threads using the echo-worker.ts file.
 * Bun's test runner has native Worker support, so real thread spawning is
 * verified here — not just the fallback path.
 *
 * Covers:
 * - Real Worker spawn: pool creates a worker and receives the init message
 * - Round-trip: submit(payload) → worker echoes it → promise resolves
 * - Concurrent tasks: pool of 2 workers handles multiple simultaneous tasks
 * - terminate(): kills workers cleanly without hanging
 */
import { describe, it, expect } from "bun:test";
import { TugWorkerPool } from "../lib/tug-worker-pool";

// ---------------------------------------------------------------------------
// Worker URL — Bun resolves this at test time from the test file's location.
// ---------------------------------------------------------------------------

const ECHO_WORKER_URL = new URL("./workers/echo-worker.ts", import.meta.url);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait up to `ms` milliseconds for a promise to settle, or throw a timeout error. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// 1. Basic round-trip
// ---------------------------------------------------------------------------

describe("real Worker round-trip", () => {
  it("submits a task and receives the echoed result", async () => {
    const pool = new TugWorkerPool<{ value: number }, { value: number }>(ECHO_WORKER_URL, {
      poolSize: 1,
      initTimeoutMs: 5000,
      idleTimeoutMs: 60_000,
    });

    const result = await withTimeout(pool.submit({ value: 42 }).promise, 5000);
    expect(result).toEqual({ value: 42 });

    pool.terminate();
  });

  it("echoes string payload", async () => {
    const pool = new TugWorkerPool<string, string>(ECHO_WORKER_URL, {
      poolSize: 1,
      initTimeoutMs: 5000,
      idleTimeoutMs: 60_000,
    });

    const result = await withTimeout(pool.submit("hello worker").promise, 5000);
    expect(result).toBe("hello worker");

    pool.terminate();
  });
});

// ---------------------------------------------------------------------------
// 2. Concurrent tasks across 2 workers
// ---------------------------------------------------------------------------

describe("concurrent tasks", () => {
  it("handles multiple tasks simultaneously with a pool of 2 workers", async () => {
    const POOL_SIZE = 2;
    const TASK_COUNT = 6;
    const pool = new TugWorkerPool<number, number>(ECHO_WORKER_URL, {
      poolSize: POOL_SIZE,
      initTimeoutMs: 5000,
      idleTimeoutMs: 60_000,
    });

    const handles = Array.from({ length: TASK_COUNT }, (_, i) => pool.submit(i));
    const results = await withTimeout(
      Promise.all(handles.map((h) => h.promise)),
      5000,
    );

    expect(results.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);

    pool.terminate();
  });
});

// ---------------------------------------------------------------------------
// 3. terminate() cleans up without hanging
// ---------------------------------------------------------------------------

describe("terminate", () => {
  it("terminates the pool cleanly", async () => {
    const pool = new TugWorkerPool<number, number>(ECHO_WORKER_URL, {
      poolSize: 2,
      initTimeoutMs: 5000,
      idleTimeoutMs: 60_000,
    });

    // Submit a task and wait for it so workers are spawned and ready.
    await withTimeout(pool.submit(1).promise, 5000);

    // terminate() should not throw.
    expect(() => pool.terminate()).not.toThrow();
  });
});
