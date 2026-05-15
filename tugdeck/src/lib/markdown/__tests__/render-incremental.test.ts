/**
 * Pure-logic tests for `render-incremental.ts`.
 *
 * The reconciler splits cleanly into a pure planning function
 * (`planReconcile`) and a DOM-mutating wrapper (`renderIncremental`).
 * Per project policy (pure-logic Bun tests + real-app HMR vetting; no
 * fake-DOM render tests), this suite pins `planReconcile`
 * exhaustively. The DOM-mutating wrapper is HMR-vetted by exercising
 * the streaming markdown surface in the live transcript.
 *
 * Coverage on `planReconcile`:
 *  - Empty / empty → no-op.
 *  - Empty prev / non-empty new → all appends, no stable, no update.
 *  - Non-empty prev / empty new → all removes.
 *  - Identical arrays → all stable.
 *  - Append-only growth (the typical streaming case) → stable prefix
 *    equal to prev's length, then appendCount.
 *  - Trailing-block divergence (the second-most-common case: the
 *    last block's content changed) → stable prefix one short of
 *    min, then a single in-place update.
 *  - Mid-stream block-boundary shift (e.g. a code fence completes,
 *    splitting what was one paragraph into two blocks) → stable
 *    prefix may be shorter than naive position-compare suggests;
 *    everything past the shift is update + append.
 *  - Removal of trailing blocks (rare in streaming, possible if the
 *    consumer rewinds) → stable prefix at common positions, then
 *    removeCount.
 *  - Mixed change + grow → updates over min, appends past prev.
 *  - Plan invariants (sum / non-negativity / mutual exclusivity of
 *    appendCount and removeCount) hold across a fuzz over random
 *    array shapes.
 */

import { describe, expect, it } from "bun:test";

import { planReconcile, type ReconcilePlan } from "../render-incremental";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Concise hash factory — distinct bigints per call without ceremony. */
function h(n: number): bigint {
  return BigInt(n);
}

/** Assert the four invariants every plan must satisfy. */
function assertPlanInvariants(
  plan: ReconcilePlan,
  prevLen: number,
  newLen: number,
): void {
  expect(plan.stableCount).toBeGreaterThanOrEqual(0);
  expect(plan.updateCount).toBeGreaterThanOrEqual(0);
  expect(plan.appendCount).toBeGreaterThanOrEqual(0);
  expect(plan.removeCount).toBeGreaterThanOrEqual(0);
  // Stable + update covers the common positions.
  expect(plan.stableCount + plan.updateCount).toBe(Math.min(prevLen, newLen));
  // Append covers the surplus on the new side.
  expect(plan.appendCount).toBe(Math.max(0, newLen - prevLen));
  // Remove covers the surplus on the prev side.
  expect(plan.removeCount).toBe(Math.max(0, prevLen - newLen));
  // Append and remove are mutually exclusive (you can't both grow
  // and shrink in one render).
  expect(Math.min(plan.appendCount, plan.removeCount)).toBe(0);
}

// ---------------------------------------------------------------------------
// planReconcile — coverage
// ---------------------------------------------------------------------------

describe("planReconcile — empty / boundary cases", () => {
  it("empty prev + empty new → all zeros", () => {
    const plan = planReconcile([], []);
    expect(plan).toEqual({
      stableCount: 0,
      updateCount: 0,
      appendCount: 0,
      removeCount: 0,
    });
    assertPlanInvariants(plan, 0, 0);
  });

  it("empty prev + non-empty new → all appends", () => {
    const plan = planReconcile([], [h(1), h(2), h(3)]);
    expect(plan).toEqual({
      stableCount: 0,
      updateCount: 0,
      appendCount: 3,
      removeCount: 0,
    });
    assertPlanInvariants(plan, 0, 3);
  });

  it("non-empty prev + empty new → all removes", () => {
    const plan = planReconcile([h(1), h(2)], []);
    expect(plan).toEqual({
      stableCount: 0,
      updateCount: 0,
      appendCount: 0,
      removeCount: 2,
    });
    assertPlanInvariants(plan, 2, 0);
  });
});

describe("planReconcile — fully-stable identity", () => {
  it("identical arrays → all stable, no work", () => {
    const arr = [h(10), h(20), h(30)];
    const plan = planReconcile(arr, arr);
    expect(plan).toEqual({
      stableCount: 3,
      updateCount: 0,
      appendCount: 0,
      removeCount: 0,
    });
    assertPlanInvariants(plan, 3, 3);
  });
});

describe("planReconcile — typical streaming shapes", () => {
  it("append-only growth → stable prefix == prev length, then appendCount", () => {
    // The most common case: text grew by one new block at the end.
    // Earlier blocks must hash identically so the reconciler skips
    // them entirely (preserves DOM identity → preserves scroll
    // anchor).
    const prev = [h(1), h(2), h(3)];
    const next = [h(1), h(2), h(3), h(4)];
    const plan = planReconcile(prev, next);
    expect(plan).toEqual({
      stableCount: 3,
      updateCount: 0,
      appendCount: 1,
      removeCount: 0,
    });
    assertPlanInvariants(plan, 3, 4);
  });

  it("trailing-block divergence (only the last block's content changed) → one in-place update", () => {
    // The second-most-common case: chars were appended to the
    // in-progress trailing block (e.g. a paragraph being typed out).
    // Earlier blocks stable; trailing block hash diverged → in-place
    // update, no append.
    const prev = [h(1), h(2), h(3)];
    const next = [h(1), h(2), h(99)];
    const plan = planReconcile(prev, next);
    expect(plan).toEqual({
      stableCount: 2,
      updateCount: 1,
      appendCount: 0,
      removeCount: 0,
    });
    assertPlanInvariants(plan, 3, 3);
  });

  it("trailing-block update + append-one in the same delta", () => {
    // Streaming case: the trailing block completed (its hash settled
    // because a blank line / closing fence / paragraph break landed)
    // AND the next block has started. The transition is: previous
    // trailing block becomes stable, prev's last block becomes the
    // *new* trailing block which hasn't existed before.
    //
    // From the reconciler's POV at the index level: prev had block at
    // index N, new still has a block at index N (with the same hash
    // — it settled), AND new has block at index N+1 (new block).
    const prev = [h(1), h(2), h(3)];
    const next = [h(1), h(2), h(3), h(4)];
    const plan = planReconcile(prev, next);
    expect(plan).toEqual({
      stableCount: 3,
      updateCount: 0,
      appendCount: 1,
      removeCount: 0,
    });
    assertPlanInvariants(plan, 3, 4);
  });
});

describe("planReconcile — boundary-shift shapes", () => {
  it("mid-stream block-boundary shift → stable prefix shorter than position-compare would suggest", () => {
    // Real markdown example: a partial code fence opens at index 1
    // and absorbs what *was* index 2 in the prior render. New
    // ordering shifts. Hashes diverge at the absorption point even
    // though the source bytes happen to overlap.
    const prev = [h(1), h(2), h(3), h(4)];
    const next = [h(1), h(99), h(98)]; // index 1 absorbed index 2; index 3 gone
    const plan = planReconcile(prev, next);
    expect(plan).toEqual({
      stableCount: 1,
      updateCount: 2, // positions 1 and 2 are common (min=3)
      appendCount: 0,
      removeCount: 1, // prev had 4 blocks, new has 3
    });
    assertPlanInvariants(plan, 4, 3);
  });

  it("structurally-different reparse (no common prefix) → updates over min, then appends or removes the difference", () => {
    // Worst case: the new render shares no leading content with the
    // prior. Could happen if the consumer feeds a totally different
    // text (replay from a fresh source). Stable prefix is zero;
    // every common position becomes an in-place update.
    const prev = [h(1), h(2), h(3)];
    const next = [h(10), h(20), h(30), h(40)];
    const plan = planReconcile(prev, next);
    expect(plan).toEqual({
      stableCount: 0,
      updateCount: 3,
      appendCount: 1,
      removeCount: 0,
    });
    assertPlanInvariants(plan, 3, 4);
  });
});

describe("planReconcile — removal cases", () => {
  it("trailing blocks dropped → stable prefix at common, then removeCount", () => {
    const prev = [h(1), h(2), h(3), h(4)];
    const next = [h(1), h(2)];
    const plan = planReconcile(prev, next);
    expect(plan).toEqual({
      stableCount: 2,
      updateCount: 0,
      appendCount: 0,
      removeCount: 2,
    });
    assertPlanInvariants(plan, 4, 2);
  });

  it("trailing-block content changed AND list shrank → update at min, then remove", () => {
    const prev = [h(1), h(2), h(3), h(4)];
    const next = [h(1), h(2), h(99)]; // block 2 changed, block 3 dropped
    const plan = planReconcile(prev, next);
    expect(plan).toEqual({
      stableCount: 2,
      updateCount: 1,
      appendCount: 0,
      removeCount: 1,
    });
    assertPlanInvariants(plan, 4, 3);
  });
});

// ---------------------------------------------------------------------------
// Invariants — fuzz over random shapes
// ---------------------------------------------------------------------------

describe("planReconcile — invariant fuzz", () => {
  it("plan invariants hold for arbitrary array shapes", () => {
    // Deterministic pseudo-random generator so failures reproduce
    // exactly across runs. Mulberry32 — small, in-process, no deps.
    let s = 0x12345678;
    function rand(): number {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function randHashes(maxLen: number): bigint[] {
      const len = Math.floor(rand() * (maxLen + 1));
      const out: bigint[] = new Array(len);
      for (let i = 0; i < len; i += 1) {
        out[i] = BigInt(Math.floor(rand() * 1000));
      }
      return out;
    }

    for (let trial = 0; trial < 200; trial += 1) {
      const prev = randHashes(20);
      const next = randHashes(20);
      const plan = planReconcile(prev, next);
      assertPlanInvariants(plan, prev.length, next.length);
      // The stable count must equal the actual leading-equal run
      // length — verify independently.
      let actualStable = 0;
      const minLen = Math.min(prev.length, next.length);
      while (
        actualStable < minLen &&
        prev[actualStable] === next[actualStable]
      ) {
        actualStable += 1;
      }
      expect(plan.stableCount).toBe(actualStable);
    }
  });
});
