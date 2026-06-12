/**
 * Warm-queue tests — cooperative speculative warming of the
 * render-once parse cache.
 *
 * Deterministic via the injectable scheduler (captured callbacks,
 * fired by hand — no real timers) and clock. Pins: LIFO drain order,
 * time-slice chunking with re-arm, cancellation, enqueue dedupe,
 * lazy text reads (the FINAL value warms, not the enqueue-time one),
 * and the priority handoff — an identity the render path already
 * parsed costs the queue a lookup, not a parse.
 */

import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { initSync } from "../../../../crates/tugmark-wasm/pkg/tugmark_wasm.js";

import { ensureParsed, getCachedParse } from "../parse-cache";
import {
  resetRowParseCounters,
  snapshotRowParseCounters,
} from "../parse-counters";
import { WarmQueue } from "../warm-queue";

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const wasmPath = join(
  __dir,
  "../../../../crates/tugmark-wasm/pkg/tugmark_wasm_bg.wasm",
);

beforeAll(() => {
  initSync({ module: readFileSync(wasmPath) });
});

afterEach(() => {
  resetRowParseCounters();
});

/** Captured-callback scheduler: chunks run only when the test fires them. */
function makeScheduler(): { schedule: (cb: () => void) => void; fire: () => boolean } {
  const queue: Array<() => void> = [];
  return {
    schedule: (cb) => queue.push(cb),
    fire: () => {
      const cb = queue.shift();
      if (cb === undefined) return false;
      cb();
      return true;
    },
  };
}

describe("WarmQueue", () => {
  test("drains LIFO and populates the cache", () => {
    const scope = {};
    const sched = makeScheduler();
    const queue = new WarmQueue(scope, { schedule: sched.schedule, now: () => 0 });
    const order: string[] = [];

    queue.enqueue("turn.a.message.m1.text", () => (order.push("a"), "alpha"));
    queue.enqueue("turn.b.message.m1.text", () => (order.push("b"), "beta"));
    queue.enqueue("turn.c.message.m1.text", () => (order.push("c"), "gamma"));

    expect(sched.fire()).toBe(true);
    // Constant clock → one chunk drains everything; newest first.
    expect(order).toEqual(["c", "b", "a"]);
    expect(queue.pending()).toBe(0);
    expect(getCachedParse(scope, "turn.c.message.m1.text", "gamma")).not.toBeNull();
    expect(getCachedParse(scope, "turn.a.message.m1.text", "alpha")).not.toBeNull();
  });

  test("slice expiry splits the drain into chunks and re-arms", () => {
    const scope = {};
    const sched = makeScheduler();
    // Clock jumps past the slice budget on every reading: each chunk
    // processes exactly one entry, then re-arms.
    let t = 0;
    const queue = new WarmQueue(scope, {
      schedule: sched.schedule,
      now: () => (t += 100),
      sliceMs: 8,
    });
    queue.enqueue("turn.a.message.m1.text", () => "one");
    queue.enqueue("turn.b.message.m1.text", () => "two");
    queue.enqueue("turn.c.message.m1.text", () => "three");

    expect(sched.fire()).toBe(true);
    expect(queue.pending()).toBe(2);
    expect(sched.fire()).toBe(true);
    expect(queue.pending()).toBe(1);
    expect(sched.fire()).toBe(true);
    expect(queue.pending()).toBe(0);
    expect(queue.chunkCount()).toBe(3);
    // Drained chunks re-armed only while work remained.
    expect(sched.fire()).toBe(false);
  });

  test("cancel drops pending work and blocks new enqueues", () => {
    const scope = {};
    const sched = makeScheduler();
    const queue = new WarmQueue(scope, { schedule: sched.schedule, now: () => 0 });
    queue.enqueue("turn.a.message.m1.text", () => "alpha");
    queue.cancel();
    queue.enqueue("turn.b.message.m1.text", () => "beta");

    // The armed chunk fires but does nothing.
    sched.fire();
    expect(queue.warmedCount()).toBe(0);
    expect(getCachedParse(scope, "turn.a.message.m1.text", "alpha")).toBeNull();
  });

  test("re-enqueueing a waiting identity is a no-op; the drain reads the latest text", () => {
    const scope = {};
    const sched = makeScheduler();
    const queue = new WarmQueue(scope, { schedule: sched.schedule, now: () => 0 });
    let text = "partial";
    queue.enqueue("turn.a.message.m1.text", () => text);
    queue.enqueue("turn.a.message.m1.text", () => "never-read");
    expect(queue.pending()).toBe(1);

    // The path's value grows before the drain — the FINAL text warms.
    text = "partial plus the rest";
    sched.fire();
    expect(
      getCachedParse(scope, "turn.a.message.m1.text", "partial plus the rest"),
    ).not.toBeNull();
  });

  test("render-path priority: an already-parsed identity costs the queue a lookup, not a parse", () => {
    const scope = {};
    const sched = makeScheduler();
    const queue = new WarmQueue(scope, { schedule: sched.schedule, now: () => 0 });

    queue.enqueue("turn.a.message.m1.text", () => "the content");
    // The render path gets there first (same chokepoint).
    ensureParsed(scope, "turn.a.message.m1.text", "the content");
    resetRowParseCounters();

    sched.fire();
    const snap = snapshotRowParseCounters();
    expect(snap.parses).toBe(0);
    expect(snap.cacheHits).toBe(1);
  });
});
