/**
 * tool-header-meta — unit tests for the pure count formatter that backs
 * {@link ToolHeaderCount}. The badge-rendering primitives are verified
 * visually in the gallery / real app (no fake-DOM tests in this repo);
 * the formatting logic is pinned here.
 */

import { describe, expect, test } from "bun:test";

import { formatCount } from "../tool-header-meta";

describe("formatCount", () => {
  test("pluralizes by default with a trailing s", () => {
    expect(formatCount(0, "file")).toBe("0 files");
    expect(formatCount(2, "file")).toBe("2 files");
    expect(formatCount(100, "match")).toBe("100 matchs"); // default plural is naive
  });

  test("singular at exactly 1", () => {
    expect(formatCount(1, "file")).toBe("1 file");
    expect(formatCount(1, "match", "matches")).toBe("1 match");
  });

  test("honors an explicit plural noun", () => {
    expect(formatCount(3, "match", "matches")).toBe("3 matches");
    expect(formatCount(12, "entry", "entries")).toBe("12 entries");
  });

  test("thousands-groups via toLocaleString", () => {
    // en-US grouping; the test environment's default locale.
    expect(formatCount(1234, "line")).toBe("1,234 lines");
    expect(formatCount(1000000, "file")).toBe("1,000,000 files");
  });

  test("clamps negative / non-finite to 0 and floors fractions", () => {
    expect(formatCount(-5, "file")).toBe("0 files");
    expect(formatCount(Number.NaN, "file")).toBe("0 files");
    expect(formatCount(Number.POSITIVE_INFINITY, "file")).toBe("0 files");
    expect(formatCount(3.9, "line")).toBe("3 lines");
  });
});
