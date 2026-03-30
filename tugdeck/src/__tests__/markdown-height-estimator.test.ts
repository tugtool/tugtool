/**
 * Unit tests for DefaultTextEstimator and HeightEstimator interface.
 *
 * Covers:
 * - paragraph: height scales with text length (~80 chars/line)
 * - code: accounts for line count and CODE_HEADER_HEIGHT
 * - heading: correct height per level h1-h6; fallback when meta is omitted
 * - blockquote: height scales with text length (~70 chars/line)
 * - list: height scales with item count
 * - table: height accounts for row count plus header
 * - hr: constant HR_HEIGHT
 * - space: 0
 * - unknown type: LINE_HEIGHT * 2 fallback
 */

import { describe, it, expect } from "bun:test";
import {
  DefaultTextEstimator,
  LINE_HEIGHT,
  CODE_LINE_HEIGHT,
  CODE_HEADER_HEIGHT,
  HR_HEIGHT,
  HEADING_HEIGHTS,
} from "../lib/markdown-height-estimator";

const estimator = new DefaultTextEstimator();

// ---------------------------------------------------------------------------
// paragraph

describe("DefaultTextEstimator — paragraph", () => {
  it("returns at least one line height + padding for short text", () => {
    const h = estimator.estimate("paragraph", "Hello world");
    expect(h).toBe(LINE_HEIGHT + 8);
  });

  it("scales with text length (80 chars per line)", () => {
    const text80 = "a".repeat(80);
    const h1 = estimator.estimate("paragraph", text80);
    expect(h1).toBe(LINE_HEIGHT + 8); // 1 line

    const text160 = "a".repeat(160);
    const h2 = estimator.estimate("paragraph", text160);
    expect(h2).toBe(2 * LINE_HEIGHT + 8); // 2 lines

    const text240 = "a".repeat(240);
    const h3 = estimator.estimate("paragraph", text240);
    expect(h3).toBe(3 * LINE_HEIGHT + 8); // 3 lines
  });

  it("returns reasonable height for a typical paragraph (200 chars)", () => {
    const text = "a".repeat(200);
    const h = estimator.estimate("paragraph", text);
    // ceil(200/80) = 3 lines
    expect(h).toBe(3 * LINE_HEIGHT + 8);
    expect(h).toBeGreaterThan(0);
  });

  it("returns single-line height for empty string", () => {
    const h = estimator.estimate("paragraph", "");
    expect(h).toBe(LINE_HEIGHT + 8);
  });
});

// ---------------------------------------------------------------------------
// code

describe("DefaultTextEstimator — code", () => {
  it("returns CODE_HEADER_HEIGHT + 1 line for single-line code", () => {
    const h = estimator.estimate("code", "const x = 1;");
    expect(h).toBe(CODE_HEADER_HEIGHT + CODE_LINE_HEIGHT);
  });

  it("accounts for line count via newlines in raw", () => {
    const raw = "line1\nline2\nline3";
    const h = estimator.estimate("code", raw);
    // 2 newlines => 3 lines
    expect(h).toBe(CODE_HEADER_HEIGHT + 3 * CODE_LINE_HEIGHT);
  });

  it("scales with many lines", () => {
    const tenLines = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
    const h = estimator.estimate("code", tenLines);
    expect(h).toBe(CODE_HEADER_HEIGHT + 10 * CODE_LINE_HEIGHT);
  });

  it("is larger than a comparable paragraph due to CODE_HEADER_HEIGHT", () => {
    const hCode = estimator.estimate("code", "short code");
    const hPara = estimator.estimate("paragraph", "short code");
    expect(hCode).toBeGreaterThan(hPara);
  });
});

// ---------------------------------------------------------------------------
// heading

describe("DefaultTextEstimator — heading", () => {
  it("returns correct height for h1-h6 via meta.depth", () => {
    for (let level = 1; level <= 6; level++) {
      const h = estimator.estimate("heading", `${"#".repeat(level)} Title`, { depth: level });
      expect(h).toBe(HEADING_HEIGHTS[level]);
    }
  });

  it("decreases (or stays same) as level increases h1 → h6", () => {
    const heights = Array.from({ length: 6 }, (_, i) =>
      estimator.estimate("heading", "Title", { depth: i + 1 })
    );
    for (let i = 0; i < heights.length - 1; i++) {
      expect(heights[i]).toBeGreaterThanOrEqual(heights[i + 1] as number);
    }
  });

  it("falls back to h1 height when meta is omitted", () => {
    const h = estimator.estimate("heading", "# Title");
    expect(h).toBe(HEADING_HEIGHTS[1]);
  });

  it("falls back to h1 height when meta.depth is undefined", () => {
    const h = estimator.estimate("heading", "# Title", {});
    expect(h).toBe(HEADING_HEIGHTS[1]);
  });

  it("clamps out-of-range depth to valid range", () => {
    // depth 0 → clamps to 1
    const h0 = estimator.estimate("heading", "Title", { depth: 0 });
    expect(h0).toBe(HEADING_HEIGHTS[1]);

    // depth 7 → clamps to 6
    const h7 = estimator.estimate("heading", "Title", { depth: 7 });
    expect(h7).toBe(HEADING_HEIGHTS[6]);
  });
});

// ---------------------------------------------------------------------------
// hr

describe("DefaultTextEstimator — hr", () => {
  it("returns HR_HEIGHT", () => {
    expect(estimator.estimate("hr", "---")).toBe(HR_HEIGHT);
    expect(estimator.estimate("hr", "")).toBe(HR_HEIGHT);
  });
});

// ---------------------------------------------------------------------------
// space

describe("DefaultTextEstimator — space", () => {
  it("returns 0", () => {
    expect(estimator.estimate("space", "")).toBe(0);
    expect(estimator.estimate("space", "\n\n")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// blockquote

describe("DefaultTextEstimator — blockquote", () => {
  it("returns at least one line height + padding", () => {
    const h = estimator.estimate("blockquote", "> short");
    expect(h).toBe(LINE_HEIGHT + 16);
  });

  it("scales with text length (~70 chars per line)", () => {
    const text70 = "> " + "a".repeat(68); // 70 chars
    const h1 = estimator.estimate("blockquote", text70);
    expect(h1).toBe(LINE_HEIGHT + 16);

    const text140 = "> " + "a".repeat(138); // 140 chars
    const h2 = estimator.estimate("blockquote", text140);
    expect(h2).toBe(2 * LINE_HEIGHT + 16);
  });
});

// ---------------------------------------------------------------------------
// list

describe("DefaultTextEstimator — list", () => {
  it("uses meta.itemCount when provided", () => {
    const h5 = estimator.estimate("list", "- a\n- b\n- c\n- d\n- e", { itemCount: 5 });
    expect(h5).toBe(5 * (LINE_HEIGHT + 4) + 8);
  });

  it("falls back to newline counting when meta is absent", () => {
    const raw = "- a\n- b\n- c"; // 2 newlines → 3 lines
    const h = estimator.estimate("list", raw);
    // 2 newlines + 1 = 3 items
    expect(h).toBe(3 * (LINE_HEIGHT + 4) + 8);
  });

  it("returns at least one-item height for empty list", () => {
    const h = estimator.estimate("list", "", { itemCount: 0 });
    expect(h).toBe(1 * (LINE_HEIGHT + 4) + 8);
  });
});

// ---------------------------------------------------------------------------
// table

describe("DefaultTextEstimator — table", () => {
  it("uses meta.rowCount when provided", () => {
    const h = estimator.estimate("table", "| a | b |\n|---|---|\n| 1 | 2 |", { rowCount: 1 });
    // rowCount=1 data row + 1 header = 2 rows in formula
    expect(h).toBe((1 + 1) * (LINE_HEIGHT + 8) + 16);
  });

  it("scales with more rows", () => {
    const h3 = estimator.estimate("table", "", { rowCount: 3 });
    expect(h3).toBe((3 + 1) * (LINE_HEIGHT + 8) + 16);
  });

  it("falls back to newline counting when meta is absent", () => {
    // 3 newlines → 3 rows counted
    const raw = "| a |\n|---|\n| 1 |\n| 2 |";
    const h = estimator.estimate("table", raw);
    expect(h).toBe((3 + 1) * (LINE_HEIGHT + 8) + 16);
  });
});

// ---------------------------------------------------------------------------
// unknown / default

describe("DefaultTextEstimator — unknown token type", () => {
  it("returns LINE_HEIGHT * 2 for unknown types", () => {
    expect(estimator.estimate("html", "<div></div>")).toBe(LINE_HEIGHT * 2);
    expect(estimator.estimate("def", "")).toBe(LINE_HEIGHT * 2);
    expect(estimator.estimate("unknown_xyz", "raw")).toBe(LINE_HEIGHT * 2);
  });
});
