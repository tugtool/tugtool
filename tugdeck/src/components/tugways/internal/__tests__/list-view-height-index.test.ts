/**
 * list-view-height-index — pure-class tests.
 *
 * Pins the `HeightIndex` API: insert / update / delete, total /
 * offset / indexForOffset, plus the documented edge cases (empty,
 * all-measured, all-unmeasured, mixed, defensive-input).
 */

import { describe, expect, test } from "bun:test";

import { HeightIndex } from "../list-view-height-index";

const fixed = (h: number) => () => h;

describe("HeightIndex — basic operations", () => {
  test("set / get / has", () => {
    const idx = new HeightIndex();
    expect(idx.has(0)).toBe(false);
    expect(idx.get(0)).toBeUndefined();
    expect(idx.size).toBe(0);

    idx.set(0, 42);
    expect(idx.has(0)).toBe(true);
    expect(idx.get(0)).toBe(42);
    expect(idx.size).toBe(1);

    // update — same key, new value
    idx.set(0, 99);
    expect(idx.get(0)).toBe(99);
    expect(idx.size).toBe(1);
  });

  test("delete returns boolean and removes the entry", () => {
    const idx = new HeightIndex();
    idx.set(3, 17);
    expect(idx.delete(3)).toBe(true);
    expect(idx.has(3)).toBe(false);
    expect(idx.delete(3)).toBe(false);
  });

  test("clear drops every entry", () => {
    const idx = new HeightIndex();
    idx.set(0, 10);
    idx.set(1, 20);
    idx.set(5, 50);
    expect(idx.size).toBe(3);
    idx.clear();
    expect(idx.size).toBe(0);
    expect(idx.get(0)).toBeUndefined();
  });
});

describe("HeightIndex — defensive inputs", () => {
  test("ignores negative heights", () => {
    const idx = new HeightIndex();
    idx.set(0, -10);
    expect(idx.has(0)).toBe(false);
  });

  test("ignores non-finite heights", () => {
    const idx = new HeightIndex();
    idx.set(0, Number.POSITIVE_INFINITY);
    idx.set(1, Number.NEGATIVE_INFINITY);
    idx.set(2, Number.NaN);
    expect(idx.size).toBe(0);
  });

  test("accepts zero as a valid measured height", () => {
    const idx = new HeightIndex();
    idx.set(0, 0);
    expect(idx.has(0)).toBe(true);
    expect(idx.get(0)).toBe(0);
  });
});

describe("HeightIndex — totalHeight", () => {
  test("empty index ⇒ totalHeight(0) is 0 regardless of estimate", () => {
    const idx = new HeightIndex();
    expect(idx.totalHeight(0, fixed(40))).toBe(0);
  });

  test("all unmeasured ⇒ total = itemCount × estimate", () => {
    const idx = new HeightIndex();
    expect(idx.totalHeight(5, fixed(40))).toBe(200);
  });

  test("all measured ⇒ total = sum of measured", () => {
    const idx = new HeightIndex();
    [10, 20, 30, 40, 50].forEach((h, i) => idx.set(i, h));
    expect(idx.totalHeight(5, fixed(0))).toBe(150);
  });

  test("mixed ⇒ measured wins for known, estimate fills the rest", () => {
    const idx = new HeightIndex();
    idx.set(1, 100); // measured
    idx.set(3, 200); // measured
    // indices 0, 2, 4 fall back to estimate 40
    expect(idx.totalHeight(5, fixed(40))).toBe(40 + 100 + 40 + 200 + 40);
  });

  test("variable estimates per index", () => {
    const idx = new HeightIndex();
    const estimates = [10, 20, 30, 40, 50];
    expect(idx.totalHeight(estimates.length, (i) => estimates[i])).toBe(150);
  });
});

describe("HeightIndex — offsetForIndex", () => {
  test("offset for index 0 is always 0", () => {
    const idx = new HeightIndex();
    idx.set(0, 100);
    expect(idx.offsetForIndex(0, fixed(40))).toBe(0);
  });

  test("offset for last index = total minus that item's height", () => {
    const idx = new HeightIndex();
    [10, 20, 30, 40, 50].forEach((h, i) => idx.set(i, h));
    expect(idx.offsetForIndex(4, fixed(0))).toBe(100); // 10+20+30+40
    expect(idx.offsetForIndex(5, fixed(0))).toBe(150); // total
  });

  test("all unmeasured ⇒ offsets are linear in estimate", () => {
    const idx = new HeightIndex();
    expect(idx.offsetForIndex(3, fixed(40))).toBe(120);
  });

  test("mixed measured + unmeasured", () => {
    const idx = new HeightIndex();
    idx.set(0, 100);
    idx.set(2, 50);
    // [0]=100, [1]=40 (estimate), [2]=50 → offset for 3 is 190
    expect(idx.offsetForIndex(3, fixed(40))).toBe(190);
  });

  test("negative index clamps to 0", () => {
    const idx = new HeightIndex();
    idx.set(0, 100);
    expect(idx.offsetForIndex(-5, fixed(40))).toBe(0);
  });
});

describe("HeightIndex — indexForOffset", () => {
  test("offset 0 ⇒ index 0", () => {
    const idx = new HeightIndex();
    expect(idx.indexForOffset(0, 5, fixed(40))).toBe(0);
  });

  test("offset inside the first cell ⇒ index 0", () => {
    const idx = new HeightIndex();
    expect(idx.indexForOffset(20, 5, fixed(40))).toBe(0);
  });

  test("offset at exact cell boundary ⇒ next index (cell containing boundary pixel)", () => {
    const idx = new HeightIndex();
    // cell 0: [0,40), cell 1: [40,80) — offset 40 lives in cell 1.
    expect(idx.indexForOffset(40, 5, fixed(40))).toBe(1);
  });

  test("offset past the last cell ⇒ clamps to itemCount - 1", () => {
    const idx = new HeightIndex();
    expect(idx.indexForOffset(99999, 5, fixed(40))).toBe(4);
  });

  test("itemCount === 0 ⇒ 0", () => {
    const idx = new HeightIndex();
    expect(idx.indexForOffset(100, 0, fixed(40))).toBe(0);
  });

  test("negative offset ⇒ 0", () => {
    const idx = new HeightIndex();
    expect(idx.indexForOffset(-10, 5, fixed(40))).toBe(0);
  });

  test("variable measured + estimate fallback", () => {
    const idx = new HeightIndex();
    idx.set(0, 100); // [0, 100)
    idx.set(1, 50);  // [100, 150)
    // index 2 unmeasured (estimate 40) → [150, 190)
    // index 3 unmeasured → [190, 230)
    expect(idx.indexForOffset(50, 4, fixed(40))).toBe(0);
    expect(idx.indexForOffset(120, 4, fixed(40))).toBe(1);
    expect(idx.indexForOffset(160, 4, fixed(40))).toBe(2);
    expect(idx.indexForOffset(195, 4, fixed(40))).toBe(3);
  });
});
