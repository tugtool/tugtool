/**
 * Tests for the parse-economy counters behind `perf.row_parse`.
 * Pure module state — record / snapshot / reset round-trips, and the
 * per-identity bookkeeping that makes the parse-once invariant
 * falsifiable (`maxParsesPerIdentity === 1` once render-once holds).
 */

import { afterEach, describe, it, expect } from "bun:test";

import {
  parsesForIdentity,
  recordRowCacheHit,
  recordRowMemoHit,
  recordRowParse,
  resetRowParseCounters,
  snapshotRowParseCounters,
} from "@/lib/markdown/parse-counters";

afterEach(() => {
  resetRowParseCounters();
});

describe("parse-counters", () => {
  it("starts zeroed", () => {
    expect(snapshotRowParseCounters()).toEqual({
      parses: 0,
      cacheHits: 0,
      memoHits: 0,
      identities: 0,
      maxParsesPerIdentity: 0,
    });
  });

  it("attributes parses per identity and tracks the max", () => {
    recordRowParse("turn.A.message.m1.text");
    recordRowParse("turn.A.message.m1.text");
    recordRowParse("turn.B.message.m2.text");

    const snap = snapshotRowParseCounters();
    expect(snap.parses).toBe(3);
    expect(snap.identities).toBe(2);
    expect(snap.maxParsesPerIdentity).toBe(2);
    expect(parsesForIdentity("turn.A.message.m1.text")).toBe(2);
    expect(parsesForIdentity("turn.B.message.m2.text")).toBe(1);
    expect(parsesForIdentity("never-parsed")).toBe(0);
  });

  it("counts cache and memo hits independently of parses", () => {
    recordRowParse("turn.A.message.m1.text");
    recordRowCacheHit();
    recordRowCacheHit();
    recordRowMemoHit();

    const snap = snapshotRowParseCounters();
    expect(snap.parses).toBe(1);
    expect(snap.cacheHits).toBe(2);
    expect(snap.memoHits).toBe(1);
  });

  it("reset zeroes everything including identities", () => {
    recordRowParse("turn.A.message.m1.text");
    recordRowCacheHit();
    recordRowMemoHit();
    resetRowParseCounters();

    expect(snapshotRowParseCounters()).toEqual({
      parses: 0,
      cacheHits: 0,
      memoHits: 0,
      identities: 0,
      maxParsesPerIdentity: 0,
    });
    expect(parsesForIdentity("turn.A.message.m1.text")).toBe(0);
  });
});
