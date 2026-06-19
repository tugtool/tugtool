/**
 * Pure-logic tests for the transcript entry address formatters
 * ([P09] badge format). `formatTurnAddress` renders the durable
 * `#{speaker}{turn}` address with a within-turn `.{sub+1}` suffix and
 * significant digits only; `formatSequenceNumber` is the plain `#NNNN`
 * integer stamp still used by row/index/atom-caption surfaces.
 */

import { describe, expect, test } from "bun:test";

import {
  formatSequenceNumber,
  formatTurnAddress,
} from "../tug-transcript-entry";

describe("formatTurnAddress", () => {
  test("speaker prefix + turn, significant digits (no zero-padding)", () => {
    expect(formatTurnAddress({ speaker: "user", turn: 1 })).toBe("#u1");
    expect(formatTurnAddress({ speaker: "assistant", turn: 17 })).toBe("#a17");
    expect(formatTurnAddress({ speaker: "other", turn: 42 })).toBe("#x42");
    expect(formatTurnAddress({ speaker: "shell", turn: 9999 })).toBe("#s9999");
    expect(formatTurnAddress({ speaker: "assistant", turn: 10000 })).toBe(
      "#a10000",
    );
  });

  test("a normal turn's user and assistant rows share the number, differ by prefix; no suffix at sub 0", () => {
    expect(formatTurnAddress({ speaker: "user", turn: 17 })).toBe("#u17");
    expect(formatTurnAddress({ speaker: "assistant", turn: 17 })).toBe("#a17");
    expect(formatTurnAddress({ speaker: "user", turn: 17, sub: 0 })).toBe("#u17");
  });

  test("merged turn: within-turn ordinal renders as .2, .3 ([P09])", () => {
    expect(formatTurnAddress({ speaker: "user", turn: 17, sub: 1 })).toBe(
      "#u17.2",
    );
    expect(formatTurnAddress({ speaker: "user", turn: 17, sub: 2 })).toBe(
      "#u17.3",
    );
    expect(formatTurnAddress({ speaker: "assistant", turn: 17, sub: 1 })).toBe(
      "#a17.2",
    );
  });

  test("floors fractional turns", () => {
    expect(formatTurnAddress({ speaker: "user", turn: 3.9 })).toBe("#u3");
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
