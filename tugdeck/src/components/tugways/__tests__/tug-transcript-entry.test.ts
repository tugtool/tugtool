/**
 * Pure-logic tests for the transcript entry address formatters
 * ([P04] badge format). `formatTurnMessageAddress` renders the canonical
 * `#t{turn}m{message}` address; `formatSequenceNumber` is the plain
 * `#NNNN` integer stamp still used by row/index surfaces.
 */

import { describe, expect, test } from "bun:test";

import {
  formatSequenceNumber,
  formatTurnMessageAddress,
} from "../tug-transcript-entry";

describe("formatTurnMessageAddress", () => {
  test("pads turn to 4 and message to 2", () => {
    expect(formatTurnMessageAddress(1, 1)).toBe("#t0001m01");
    expect(formatTurnMessageAddress(42, 2)).toBe("#t0042m02");
    expect(formatTurnMessageAddress(9999, 9)).toBe("#t9999m09");
  });

  test("padded-not-capped: grows past the pad width", () => {
    // A turn ≥ 10000 keeps all its digits.
    expect(formatTurnMessageAddress(10000, 1)).toBe("#t10000m01");
    // A message ≥ 100 keeps all its digits (a turn with many inline messages).
    expect(formatTurnMessageAddress(7, 100)).toBe("#t0007m100");
  });

  test("floors fractional inputs", () => {
    expect(formatTurnMessageAddress(3.9, 2.9)).toBe("#t0003m02");
  });

  test("empty string for invalid inputs", () => {
    expect(formatTurnMessageAddress(-1, 1)).toBe("");
    expect(formatTurnMessageAddress(1, -1)).toBe("");
    expect(formatTurnMessageAddress(Number.NaN, 1)).toBe("");
    expect(formatTurnMessageAddress(1, Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("formatSequenceNumber (retained row/index stamp)", () => {
  test("pads to 4, grows naturally past 9999", () => {
    expect(formatSequenceNumber(1)).toBe("#0001");
    expect(formatSequenceNumber(9999)).toBe("#9999");
    expect(formatSequenceNumber(10000)).toBe("#10000");
  });

  test("empty string for invalid inputs", () => {
    expect(formatSequenceNumber(-1)).toBe("");
    expect(formatSequenceNumber(Number.NaN)).toBe("");
  });
});
