/**
 * `styleMarkdownText` — the one-shot markdown styling filter.
 *
 * Drives the real grammar + the real shared highlight style; the class names
 * are generated, so the assertions are about STRUCTURE (which characters form
 * a run, which runs share a class, where a hanging indent lands) rather than
 * about the generated names themselves.
 */

import { describe, expect, test } from "bun:test";

import { styleMarkdownText } from "@/lib/markdown-text-styling";

/** The line's spans rejoined — must always reproduce the source verbatim. */
function rejoin(spans: readonly { text: string }[]): string {
  return spans.map((s) => s.text).join("");
}

describe("styleMarkdownText", () => {
  test("reproduces the source text verbatim", () => {
    const src = "# Heading\n\n- one **bold** item\n\nplain tail\n";
    const lines = styleMarkdownText(src);
    expect(lines.map((l) => l.text).join("\n")).toBe(src);
    for (const line of lines) {
      if (line.spans.length > 0) expect(rejoin(line.spans)).toBe(line.text);
    }
  });

  test("keeps the raw syntax markers in the text", () => {
    const [heading] = styleMarkdownText("# Heading");
    expect(heading.text).toBe("# Heading");
    expect(rejoin(heading.spans)).toContain("#");
  });

  test("styles a strong run and its markers", () => {
    const [line] = styleMarkdownText("a **bold** b");
    const styled = line.spans.filter((s) => s.className !== "");
    // The `**` markers and the word between them all carry a class; the
    // surrounding prose does not.
    expect(styled.map((s) => s.text)).toEqual(["**", "bold", "**"]);
    expect(line.spans[0].className).toBe("");
  });

  test("styles an inline-code run distinctly from surrounding prose", () => {
    const [line] = styleMarkdownText("see `theft-gate` here");
    const code = line.spans.find((s) => s.text === "theft-gate");
    expect(code).toBeDefined();
    expect(code?.className).not.toBe("");
    expect(code?.className).not.toBe(line.spans[0].className);
  });

  test("hangs a list item under its content", () => {
    const lines = styleMarkdownText("- item one\n1. item two\n   - nested\nplain");
    expect(lines.map((l) => l.indent)).toEqual([2, 3, 5, 0]);
  });

  test("does not mistake a code-block line for a list item", () => {
    const lines = styleMarkdownText("```\n- not a list\n```");
    expect(lines[1].indent).toBe(0);
  });

  test("preserves blank lines as their own entries", () => {
    const lines = styleMarkdownText("a\n\n\nb");
    expect(lines).toHaveLength(4);
    expect(lines[1].text).toBe("");
    expect(lines[1].spans).toEqual([]);
  });

  test("empty input yields one empty line", () => {
    expect(styleMarkdownText("")).toEqual([{ text: "", indent: 0, spans: [] }]);
  });
});
