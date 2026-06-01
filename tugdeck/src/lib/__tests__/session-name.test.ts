/**
 * session-name.test.ts — pure-logic coverage for the `/rename` display helpers
 * ([#step-13d]): chip value/tooltip + chooser row-title selection.
 */

import { describe, expect, test } from "bun:test";
import {
  SESSION_NAME_CAP,
  sessionChipDisplay,
  sessionRowTitle,
  truncateSessionName,
} from "../session-name";

const ID = "abcd1234-5678-90ab-cdef-1234567890ab";

describe("truncateSessionName", () => {
  test("leaves a short name intact, ellipsizes an overflow at the cap", () => {
    expect(truncateSessionName("short")).toBe("short");
    const long = "x".repeat(SESSION_NAME_CAP + 5);
    const out = truncateSessionName(long);
    expect(out).toBe(`${"x".repeat(SESSION_NAME_CAP)}…`);
    expect(out.length).toBe(SESSION_NAME_CAP + 1); // cap chars + the ellipsis
  });

  test("a name exactly at the cap is not ellipsized", () => {
    const exact = "y".repeat(SESSION_NAME_CAP);
    expect(truncateSessionName(exact)).toBe(exact);
  });
});

describe("sessionChipDisplay", () => {
  test("unnamed → truncated id value, full id tooltip", () => {
    expect(sessionChipDisplay(null, ID)).toEqual({
      value: "abcd1234",
      tooltip: ID,
    });
    // A blank name is treated as unnamed.
    expect(sessionChipDisplay("   ", ID).value).toBe("abcd1234");
  });

  test("named → capped name value, tooltip carries full name + id", () => {
    const out = sessionChipDisplay("My Refactor Session", ID);
    expect(out.value).toBe("My Refactor Sess…"); // 16 chars + …
    expect(out.tooltip).toBe(`My Refactor Session\n${ID}`);
  });

  test("a short name shows verbatim with name + id tooltip", () => {
    expect(sessionChipDisplay("Bugfix", ID)).toEqual({
      value: "Bugfix",
      tooltip: `Bugfix\n${ID}`,
    });
  });
});

describe("sessionRowTitle", () => {
  test("prefers the name, falls back to the prompt-derived title", () => {
    expect(sessionRowTitle("Named", "do the thing")).toBe("Named");
    expect(sessionRowTitle(null, "do the thing")).toBe("do the thing");
    expect(sessionRowTitle("  ", "do the thing")).toBe("do the thing");
  });
});
