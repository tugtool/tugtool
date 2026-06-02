/**
 * Unit tests for the pure `/compact` helpers — the summarization prompt
 * builder and the fresh-session seed framing.
 */

import { describe, it, expect } from "bun:test";

import {
  buildSummarizationPrompt,
  buildCompactionSeed,
} from "@/lib/compaction-request";

describe("buildSummarizationPrompt", () => {
  it("asks for a self-contained recap with no focus", () => {
    const p = buildSummarizationPrompt();
    expect(p).toContain("self-contained recap");
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
});
