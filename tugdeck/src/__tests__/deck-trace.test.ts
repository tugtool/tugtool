/**
 * deck-trace.test.ts — pure-logic unit tests for the ring buffer
 * and public API surface of `deck-trace.ts`.
 *
 * These tests intentionally avoid DOM-level coverage: Step 1 of the
 * in-app-test-harness plan ships the seam only (no wired call
 * sites), and per Design Decision [D10] we do not pretend happy-dom
 * can verify focus / DOM-observer behavior. The event-union shape,
 * the bounded ring's eviction policy, the `since(seq)` slice, the
 * enable-gate, and the `mark()` monotonic counter are all
 * exercisable without touching the DOM.
 *
 * The trace module is a module-level singleton, so every test starts
 * by calling `deckTrace.clear()` and `deckTrace.enable(true)` (or
 * `false` where a test asserts the gate). `clear()` preserves the
 * sequence counter by contract, so assertions that compare seq
 * values compute them relative to `mark()` rather than against
 * absolute constants.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  deckTrace,
  DECK_TRACE_CAPACITY,
  type DeckTraceEvent,
} from "../deck-trace";

/**
 * Record `n` `commit-tick` events with increasing `count`, returning
 * the first and last `seq` assigned. `commit-tick` is the simplest
 * variant — no payload beyond `count` — so it is the natural choice
 * for bulk-append tests.
 */
function recordTicks(n: number, startCount = 0): { firstSeq: number; lastSeq: number } {
  const before = deckTrace.mark();
  for (let i = 0; i < n; i++) {
    deckTrace.record({ kind: "commit-tick", count: startCount + i });
  }
  const after = deckTrace.mark();
  return { firstSeq: before + 1, lastSeq: after };
}

beforeEach(() => {
  deckTrace.clear();
  deckTrace.enable(true);
});

describe("deckTrace ring buffer", () => {
  test("appends events up to capacity; the (capacity + 1)th evicts the oldest", () => {
    recordTicks(DECK_TRACE_CAPACITY);

    const filled = deckTrace.dump();
    expect(filled.length).toBe(DECK_TRACE_CAPACITY);
    // Oldest is the first count we recorded (0).
    expect((filled[0] as Extract<DeckTraceEvent, { kind: "commit-tick" }>).count).toBe(0);
    // Newest is count = capacity - 1.
    expect(
      (filled[filled.length - 1] as Extract<DeckTraceEvent, { kind: "commit-tick" }>).count,
    ).toBe(DECK_TRACE_CAPACITY - 1);

    // One more record should evict the oldest and keep the length pinned
    // at capacity.
    deckTrace.record({ kind: "commit-tick", count: DECK_TRACE_CAPACITY });

    const afterEvict = deckTrace.dump();
    expect(afterEvict.length).toBe(DECK_TRACE_CAPACITY);
    // New oldest is count = 1 (original count = 0 was evicted).
    expect(
      (afterEvict[0] as Extract<DeckTraceEvent, { kind: "commit-tick" }>).count,
    ).toBe(1);
    // New newest is count = capacity.
    expect(
      (afterEvict[afterEvict.length - 1] as Extract<DeckTraceEvent, { kind: "commit-tick" }>)
        .count,
    ).toBe(DECK_TRACE_CAPACITY);
  });

  test("seq counter is monotonic across eviction — `since` returns a strictly forward slice even after wrap", () => {
    // Fill the ring and overrun by 10 entries so several evictions have
    // happened. `since(markBefore)` should still return exactly the
    // events whose seq is greater than the mark, and their seqs must
    // be strictly increasing.
    const markBefore = deckTrace.mark();
    recordTicks(DECK_TRACE_CAPACITY + 10);

    const slice = deckTrace.since(markBefore);
    // Ring can hold at most `DECK_TRACE_CAPACITY` events; the 10 oldest
    // were evicted, leaving `DECK_TRACE_CAPACITY`.
    expect(slice.length).toBe(DECK_TRACE_CAPACITY);

    for (let i = 0; i < slice.length - 1; i++) {
      expect(slice[i]!.seq).toBeLessThan(slice[i + 1]!.seq);
      // Every event is strictly greater than markBefore.
      expect(slice[i]!.seq).toBeGreaterThan(markBefore);
    }
  });
});

describe("deckTrace.since(seq)", () => {
  test("returns only events with seq strictly greater than the provided mark", () => {
    recordTicks(3);
    const mid = deckTrace.mark();
    recordTicks(2, 100);

    const after = deckTrace.since(mid);
    expect(after.length).toBe(2);
    for (const e of after) {
      expect(e.seq).toBeGreaterThan(mid);
      expect(e.kind).toBe("commit-tick");
    }

    // Since(before-everything) returns everything.
    const all = deckTrace.since(0);
    expect(all.length).toBe(5);

    // Since(latest mark) returns nothing.
    const latest = deckTrace.mark();
    const tail = deckTrace.since(latest);
    expect(tail.length).toBe(0);
  });

  test("returns a fresh array — mutating the result does not affect the ring", () => {
    recordTicks(3);
    const slice = deckTrace.since(0) as DeckTraceEvent[];
    slice.length = 0;

    expect(deckTrace.dump().length).toBe(3);
  });
});

describe("deckTrace.enable(false) gates recording", () => {
  test("record is a no-op under enable(false); dump returns empty and seq does not advance", () => {
    deckTrace.enable(false);
    const seqBefore = deckTrace.mark();

    deckTrace.record({ kind: "commit-tick", count: 1 });
    deckTrace.record({
      kind: "fr-flip",
      from: null,
      to: "card-a",
      trigger: "test",
    });
    deckTrace.record({
      kind: "save-callback",
      cardId: "card-a",
      source: "manual",
    });

    expect(deckTrace.dump().length).toBe(0);
    expect(deckTrace.mark()).toBe(seqBefore);
  });

  test("toggling enable(false) → enable(true) resumes recording without clearing prior events", () => {
    // Prior events, recorded with enable(true).
    recordTicks(2);
    const afterWarm = deckTrace.dump().length;
    expect(afterWarm).toBe(2);

    // Gate closed — new records are dropped.
    deckTrace.enable(false);
    deckTrace.record({ kind: "commit-tick", count: 99 });
    expect(deckTrace.dump().length).toBe(2);

    // Gate reopened — new records append.
    deckTrace.enable(true);
    deckTrace.record({ kind: "commit-tick", count: 100 });
    const final = deckTrace.dump();
    expect(final.length).toBe(3);
    expect(
      (final[final.length - 1] as Extract<DeckTraceEvent, { kind: "commit-tick" }>).count,
    ).toBe(100);
  });
});

describe("deckTrace.mark()", () => {
  test("returns the current sequence counter and is monotonic", () => {
    const start = deckTrace.mark();
    expect(typeof start).toBe("number");

    recordTicks(1);
    const after1 = deckTrace.mark();
    expect(after1).toBe(start + 1);

    recordTicks(4);
    const after5 = deckTrace.mark();
    expect(after5).toBe(start + 5);
  });

  test("mark() is preserved across clear() — sequence never rewinds", () => {
    recordTicks(3);
    const before = deckTrace.mark();

    deckTrace.clear();
    expect(deckTrace.dump().length).toBe(0);
    expect(deckTrace.mark()).toBe(before);

    // Record after clear — new seq strictly greater than pre-clear mark.
    deckTrace.record({ kind: "commit-tick", count: 0 });
    expect(deckTrace.mark()).toBe(before + 1);
    const dumped = deckTrace.dump();
    expect(dumped[0]!.seq).toBe(before + 1);
  });
});

describe("deckTrace.record stamps caller loc", () => {
  test("loc points at the test file (not deck-trace itself)", () => {
    deckTrace.record({ kind: "commit-tick", count: 0 });
    const events = deckTrace.dump();
    expect(events).toHaveLength(1);
    const loc = events[0]!.loc;
    expect(typeof loc).toBe("string");
    // The caller is this test file. deck-trace.ts frames are skipped
    // by captureCallerLoc, so the first non-internal frame should be
    // deck-trace.test.ts on bun/JSC's stack.
    expect(loc).toMatch(/deck-trace\.test\.ts:\d+:\d+$/);
  });

  test("loc is stamped on every variant, not just commit-tick", () => {
    deckTrace.record({
      kind: "fr-flip",
      from: "a",
      to: "b",
      trigger: "activateCard",
    });
    deckTrace.record({
      kind: "destination-flip",
      cardId: "b",
      from: false,
      to: true,
    });
    deckTrace.record({
      kind: "save-callback",
      cardId: "a",
      source: "manual",
    });
    for (const e of deckTrace.dump()) {
      expect(typeof e.loc).toBe("string");
      // Every event's loc should either be empty (capture failure,
      // tolerated) or reference a .ts / .tsx file and not the trace
      // module itself.
      if (e.loc!.length > 0) {
        expect(e.loc).toMatch(/\.tsx?:\d+:\d+$/);
        expect(e.loc).not.toMatch(/deck-trace\.ts:/);
      }
    }
  });
});
