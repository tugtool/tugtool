/**
 * ref-spec — the `/ref <spec>` number grammar (Spec S04, [P09]).
 *
 * Ref numbers are addresses, not positions: a run numbers its refs in
 * emission order and never renumbers them, so a spec that names a number the
 * run does not have must SKIP it, never shift the rest along to fill the gap.
 */
import { describe, expect, it } from "bun:test";

import { REF_OPEN_CAP, parseRefSpec, resolveRefSpec } from "@/lib/ref-spec";

/** A run holding refs 1..n. */
function upTo(n: number): (k: number) => boolean {
  return (k) => k >= 1 && k <= n;
}

describe("parseRefSpec — single, range, list", () => {
  it("reads a single number", () => {
    expect(parseRefSpec("3").numbers).toEqual([3]);
  });

  it("expands an inclusive range", () => {
    expect(parseRefSpec("3-5").numbers).toEqual([3, 4, 5]);
  });

  it("reads a space-separated list", () => {
    expect(parseRefSpec("3 7 9").numbers).toEqual([3, 7, 9]);
  });

  it("mixes singles, ranges, and commas in one spec", () => {
    expect(parseRefSpec("1,4-6 9").numbers).toEqual([1, 4, 5, 6, 9]);
  });

  it("normalizes a descending range ascending — far likelier a typo", () => {
    expect(parseRefSpec("5-3").numbers).toEqual([3, 4, 5]);
  });

  it("dedupes across overlapping parts, keeping first-named order", () => {
    expect(parseRefSpec("5 3-5 3").numbers).toEqual([5, 3, 4]);
  });

  it("collects a token that is not a number or a range", () => {
    const parsed = parseRefSpec("3 foo 5");
    expect(parsed.numbers).toEqual([3, 5]);
    expect(parsed.invalid).toEqual(["foo"]);
  });
});

describe("resolveRefSpec — against what the run actually has", () => {
  it("reports an out-of-range number and skips it, opening the rest", () => {
    const res = resolveRefSpec("2 99 4", upTo(10));
    expect(res.numbers).toEqual([2, 4]);
    expect(res.outOfRange).toEqual([99]);
  });

  it("resolves nothing, and says so, when every number misses", () => {
    const res = resolveRefSpec("40-42", upTo(10));
    expect(res.numbers).toEqual([]);
    expect(res.outOfRange).toEqual([40, 41, 42]);
    expect(res.capped).toBe(false);
  });

  it("caps the open count and reports the cap", () => {
    const res = resolveRefSpec("1-50", upTo(50));
    expect(res.numbers.length).toBe(REF_OPEN_CAP);
    expect(res.numbers[0]).toBe(1);
    expect(res.capped).toBe(true);
  });

  it("counts only FOUND refs against the cap", () => {
    // Eleven numbers named, but only ten exist — that is exactly the cap, so
    // nothing was dropped and the user should not be told it was.
    const res = resolveRefSpec("1-11", upTo(10));
    expect(res.numbers.length).toBe(10);
    expect(res.capped).toBe(false);
  });
});
