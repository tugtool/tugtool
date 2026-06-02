/**
 * Unit tests for `compactionNoteText` — the pure derivation of the
 * compaction divider's text from a `compact_boundary` payload.
 */

import { describe, it, expect } from "bun:test";

import { compactionNoteText } from "@/lib/code-session-store/compaction";

describe("compactionNoteText", () => {
  it("includes an approximate token count when preTokens is present", () => {
    expect(compactionNoteText(48_000)).toBe("Session compacted · ~48k tokens");
    expect(compactionNoteText(48_400)).toBe("Session compacted · ~48k tokens");
    expect(compactionNoteText(48_600)).toBe("Session compacted · ~49k tokens");
  });

  it("shows a raw count under 1000 tokens", () => {
    expect(compactionNoteText(820)).toBe("Session compacted · 820 tokens");
  });

  it("falls back to a bare label when preTokens is absent or non-positive", () => {
    expect(compactionNoteText(undefined)).toBe("Session compacted");
    expect(compactionNoteText(0)).toBe("Session compacted");
  });
});
