import { describe, expect, it } from "bun:test";

import { GaugeMeter, RateMeter } from "../activity-meter";

const B = 250;

describe("RateMeter", () => {
  it("accumulates units into the bin for their timestamp", () => {
    const m = new RateMeter(B, 5);
    m.record(10, 0);
    m.record(5, 100); // same bin as t=0
    m.record(20, 250); // next bin
    const s = m.series(250);
    // window of 5 bins ending at bin 1: [.. , bin0=15, bin1=20]
    expect(s[s.length - 1]).toBe(20);
    expect(s[s.length - 2]).toBe(15);
  });

  it("zero-fills idle bins so a stalled stream decays to a flat line", () => {
    const m = new RateMeter(B, 4);
    m.record(40, 0);
    // Advance well past the window with no records.
    const s = m.series(10 * B);
    expect(s.every((v) => v === 0)).toBe(true);
  });

  it("ignores non-positive records", () => {
    const m = new RateMeter(B, 3);
    m.record(0, 0);
    m.record(-5, 0);
    expect(m.series(0).every((v) => v === 0)).toBe(true);
  });

  it("has no held raw value", () => {
    expect(new RateMeter(B, 3).raw()).toBeNull();
  });
});

describe("GaugeMeter", () => {
  it("holds the last value indefinitely — no news is no news", () => {
    const m = new GaugeMeter(4);
    m.record(143, 1_000);
    // Long after the last sample: the emitter only publishes on change,
    // so the held level remains the truth until a new sample moves it.
    const s = m.series(500_000);
    expect(s.every((v) => v === 143)).toBe(true);
    expect(m.raw(500_000)).toBe(143);
  });

  it("falls to zero only when the emitter says so (the final zero frame)", () => {
    const m = new GaugeMeter(4);
    m.record(143, 1_000);
    m.record(0, 60_000);
    expect(m.series(60_000).every((v) => v === 0)).toBe(true);
    expect(m.raw(60_000)).toBe(0);
  });

  it("tracks the newest sample, replacing the prior level", () => {
    const m = new GaugeMeter(4);
    m.record(50, 0);
    m.record(90, 500);
    expect(m.raw(600)).toBe(90);
  });

  it("ignores non-finite samples", () => {
    const m = new GaugeMeter(4);
    m.record(Number.NaN, 0);
    expect(m.raw(0)).toBeNull();
  });
});
