/**
 * tool-result-summary.test.ts — the pure collapsed-header result formatter
 * ([P09]/[#step-11]).
 */

import { describe, expect, test } from "bun:test";
import { formatCount, formatToolResultSummary } from "../tool-result-summary";

describe("formatToolResultSummary", () => {
  test("count pluralizes and thousands-groups", () => {
    expect(formatToolResultSummary({ kind: "count", count: 110, noun: "line" })).toBe("110 lines");
    expect(formatToolResultSummary({ kind: "count", count: 1, noun: "line" })).toBe("1 line");
    expect(
      formatToolResultSummary({ kind: "count", count: 13, noun: "match", pluralNoun: "matches" }),
    ).toBe("13 matches");
    expect(formatToolResultSummary({ kind: "count", count: 5388, noun: "file" })).toBe("5,388 files");
  });

  test("diff renders +added −removed, clamped", () => {
    expect(formatToolResultSummary({ kind: "diff", added: 42, removed: 7 })).toBe("+42 −7");
    expect(formatToolResultSummary({ kind: "diff", added: 0, removed: 0 })).toBe("+0 −0");
    expect(formatToolResultSummary({ kind: "diff", added: -3, removed: 2 })).toBe("+0 −2");
  });

  test("exit renders the code", () => {
    expect(formatToolResultSummary({ kind: "exit", code: 0 })).toBe("exit 0");
    expect(formatToolResultSummary({ kind: "exit", code: 1 })).toBe("exit 1");
  });

  test("text passes through", () => {
    expect(formatToolResultSummary({ kind: "text", text: "committed" })).toBe("committed");
    expect(formatToolResultSummary({ kind: "text", text: "2.3 KB" })).toBe("2.3 KB");
  });
});

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
