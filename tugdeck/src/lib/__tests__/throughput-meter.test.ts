import { describe, test, expect } from "bun:test";

import {
  ThroughputMeter,
  THROUGHPUT_BIN_MS,
} from "../throughput-meter";

const B = THROUGHPUT_BIN_MS;

describe("ThroughputMeter", () => {
  test("sums units within a bin and separates adjacent bins", () => {
    const m = new ThroughputMeter(B, 5);
    m.record(10, 1000 * B + 100);
    m.record(5, 1000 * B + 900); // same bin
    m.record(20, 1001 * B + 10); // next bin
    const s = m.series(1001 * B + 500);
    // window of 5 ends at bin 1001: [997,998,999,1000,1001]
    expect(s).toEqual([0, 0, 0, 15, 20]);
  });

  test("idle time decays to a flat line as the window advances", () => {
    const m = new ThroughputMeter(B, 4);
    m.record(40, 2000 * B);
    // 4 bins later the burst has scrolled out of the window.
    expect(m.series(2004 * B)).toEqual([0, 0, 0, 0]);
  });

  test("a gap larger than the window clears everything", () => {
    const m = new ThroughputMeter(B, 3);
    m.record(99, 5000 * B);
    expect(m.series(9999 * B)).toEqual([0, 0, 0]);
  });

  test("non-positive units are ignored", () => {
    const m = new ThroughputMeter(B, 3);
    m.record(0, 1000 * B);
    m.record(-5, 1000 * B);
    m.record(7, 1000 * B);
    expect(m.series(1000 * B)).toEqual([0, 0, 7]);
  });

  test("series before any record is all zeros", () => {
    const m = new ThroughputMeter(B, 3);
    expect(m.series(1234 * B)).toEqual([0, 0, 0]);
  });
});
