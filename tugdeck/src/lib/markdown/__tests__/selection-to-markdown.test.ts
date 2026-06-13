/**
 * Pure-logic tests for the selection→markdown arithmetic. No DOM — the
 * `Range`→touched-blocks resolution is exercised in the app-test for
 * `range-to-blocks` ([Q02] pure/DOM split).
 */

import { describe, expect, test } from "bun:test";

import {
  sliceBlockRange,
  stitchSelectionMarkdown,
} from "../selection-to-markdown";

const SOURCE = [
  "# Heading", // 0..9
  "", // 10
  "First paragraph.", // 11..27
  "", // 28
  "- item one", // 29..39
  "- item two", // 40..50
].join("\n");

// Offsets into SOURCE for the three blocks above.
const HEADING = { start: 0, end: 9 };
const PARAGRAPH = { start: 11, end: 27 };
const LIST = { start: 29, end: 50 };

describe("sliceBlockRange", () => {
  test("whole single block returns that block's source", () => {
    expect(sliceBlockRange(SOURCE, [PARAGRAPH])).toBe("First paragraph.");
  });

  test("widens a mid-block touch to the whole block (block-level [Q02])", () => {
    // A selection that began mid-paragraph still attributes to the
    // block's full span — the caller passes the block span, not the
    // raw caret offsets.
    expect(sliceBlockRange(SOURCE, [PARAGRAPH])).toBe("First paragraph.");
  });

  test("contiguous run spans from first start to last end, including separators", () => {
    expect(sliceBlockRange(SOURCE, [PARAGRAPH, LIST])).toBe(
      "First paragraph.\n\n- item one\n- item two",
    );
  });

  test("orders by offset, not array order", () => {
    expect(sliceBlockRange(SOURCE, [LIST, HEADING])).toBe(SOURCE);
  });

  test("no spans yields empty string", () => {
    expect(sliceBlockRange(SOURCE, [])).toBe("");
  });

  test("clamps out-of-range offsets instead of throwing", () => {
    expect(sliceBlockRange("abc", [{ start: -5, end: 999 }])).toBe("abc");
  });

  test("degenerate range yields empty string", () => {
    expect(sliceBlockRange(SOURCE, [{ start: 5, end: 5 }])).toBe("");
  });
});

describe("stitchSelectionMarkdown", () => {
  test("prose only — no heading", () => {
    expect(stitchSelectionMarkdown([], ["Hello world."])).toBe("Hello world.");
  });

  test("multiple prose chunks join with a blank line", () => {
    expect(stitchSelectionMarkdown([], ["A.", "B."])).toBe("A.\n\nB.");
  });

  test("tool sections only — no Response heading", () => {
    expect(stitchSelectionMarkdown(["## Tool: Bash\n\nOutput:\n```\nok\n```"], [])).toBe(
      "## Tool: Bash\n\nOutput:\n```\nok\n```",
    );
  });

  test("tools + prose — prose gets the Response heading", () => {
    expect(
      stitchSelectionMarkdown(["## Tool: Bash\n\nOutput:\n```\nok\n```"], ["Done."]),
    ).toBe("## Tool: Bash\n\nOutput:\n```\nok\n```\n\n## Response\n\nDone.");
  });

  test("drops empty fragments", () => {
    expect(stitchSelectionMarkdown(["", "## Tool: X"], ["", "Body."])).toBe(
      "## Tool: X\n\n## Response\n\nBody.",
    );
  });

  test("nothing touched yields empty string", () => {
    expect(stitchSelectionMarkdown([], [])).toBe("");
  });
});
