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
  test("unnamed + untagged → truncated id value, full id tooltip", () => {
    expect(sessionChipDisplay(null, null, ID)).toEqual({
      value: "abcd1234",
      tooltip: ID,
    });
    // Blank name/tag are treated as unset.
    expect(sessionChipDisplay("   ", "  ", ID).value).toBe("abcd1234");
  });

  test("unnamed but tagged → tag value, tooltip carries tag + id", () => {
    expect(sessionChipDisplay(null, "azure-heron", ID)).toEqual({
      value: "azure-heron",
      tooltip: `azure-heron\n${ID}`,
    });
  });

  test("named → capped name value, tooltip carries full name + id (name beats tag)", () => {
    const out = sessionChipDisplay("My Refactor Session", "azure-heron", ID);
    expect(out.value).toBe("My Refactor Sess…"); // 16 chars + …
    expect(out.tooltip).toBe(`My Refactor Session\n${ID}`);
  });

  test("a short name shows verbatim with name + id tooltip", () => {
    expect(sessionChipDisplay("Bugfix", null, ID)).toEqual({
      value: "Bugfix",
      tooltip: `Bugfix\n${ID}`,
    });
  });
});

describe("sessionRowTitle", () => {
  test("precedence name → tag → prompt-derived fallback", () => {
    expect(sessionRowTitle("Named", "azure-heron", "do the thing")).toBe("Named");
    expect(sessionRowTitle(null, "azure-heron", "do the thing")).toBe("azure-heron");
    expect(sessionRowTitle("  ", "  ", "do the thing")).toBe("do the thing");
    expect(sessionRowTitle(null, null, "do the thing")).toBe("do the thing");
  });
});
