/**
 * tool-result-summary.test.ts — the pure collapsed-header result formatter
 * ([P09]/[#step-11]).
 */

import { describe, expect, test } from "bun:test";
import { formatToolResultSummary } from "../tool-result-summary";

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
