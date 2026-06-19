/**
 * Unit tests for the pure `/compact` helpers — the summarization prompt
 * builder and the fresh-session seed framing.
 */

import { describe, it, expect } from "bun:test";

import {
  buildSummarizationPrompt,
  buildCompactionSeed,
  splitCompactionSeed,
} from "@/lib/compaction-request";

describe("buildSummarizationPrompt", () => {
  it("asks for a thorough, self-contained recap with no focus", () => {
    const p = buildSummarizationPrompt();
    expect(p).toContain("self-contained");
    expect(p).toContain("continue");
    expect(p).not.toContain("particular attention");
  });

  it("appends the focus steer when given", () => {
    const p = buildSummarizationPrompt("the database schema");
    expect(p).toContain("particular attention to: the database schema");
  });

  it("ignores blank/whitespace focus", () => {
    expect(buildSummarizationPrompt("   ")).toBe(buildSummarizationPrompt());
  });
});

describe("buildCompactionSeed", () => {
  it("frames the summary as established prior context", () => {
    const seed = buildCompactionSeed("- chose SQLite\n- binary is tlist");
    expect(seed).toContain("compacted to save context");
    expect(seed).toContain("chose SQLite");
    expect(seed).toContain("binary is tlist");
  });

  it("leads with the comment marker so claude ignores it", () => {
    expect(buildCompactionSeed("recap")).toStartWith("<!-- tug:compact-seed -->");
  });
});

describe("splitCompactionSeed", () => {
  it("round-trips a built seed block back to the raw summary", () => {
    const summary = "# Recap\n\n- chose SQLite\n- binary is `tlist`";
    expect(splitCompactionSeed(buildCompactionSeed(summary))).toBe(summary);
  });

  it("returns null for ordinary user text (no marker)", () => {
    expect(splitCompactionSeed("start the dash")).toBeNull();
    expect(splitCompactionSeed("")).toBeNull();
  });

  it("recovers the body even if the framing is absent after the marker", () => {
    expect(splitCompactionSeed("<!-- tug:compact-seed -->\njust a body")).toBe(
      "just a body",
    );
  });
});
