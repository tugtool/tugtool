/**
 * Pure-logic tests for the transcript entry address formatters
 * ([P04] badge format). `formatTurnAddress` renders the canonical
 * `#{speaker}{turn}` address; `formatSequenceNumber` is the plain
 * `#NNNN` integer stamp still used by row/index surfaces.
 */

import { describe, expect, test } from "bun:test";

import {
  formatSequenceNumber,
  formatTurnAddress,
} from "../tug-transcript-entry";

describe("formatTurnAddress", () => {
  test("speaker prefix + turn padded to 4", () => {
    expect(formatTurnAddress({ speaker: "user", turn: 1 })).toBe("#u0001");
    expect(formatTurnAddress({ speaker: "assistant", turn: 17 })).toBe("#a0017");
    expect(formatTurnAddress({ speaker: "other", turn: 42 })).toBe("#x0042");
    expect(formatTurnAddress({ speaker: "shell", turn: 9999 })).toBe("#s9999");
  });

  test("a turn's user and assistant rows share the number, differ by prefix", () => {
    expect(formatTurnAddress({ speaker: "user", turn: 17 })).toBe("#u0017");
    expect(formatTurnAddress({ speaker: "assistant", turn: 17 })).toBe("#a0017");
  });

  test("padded-not-capped: grows past 9999", () => {
    expect(formatTurnAddress({ speaker: "assistant", turn: 10000 })).toBe(
      "#a10000",
    );
  });

  test("floors fractional turns", () => {
    expect(formatTurnAddress({ speaker: "user", turn: 3.9 })).toBe("#u0003");
  });

  test("empty string for invalid turns", () => {
    expect(formatTurnAddress({ speaker: "user", turn: -1 })).toBe("");
    expect(formatTurnAddress({ speaker: "assistant", turn: Number.NaN })).toBe(
      "",
    );
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
