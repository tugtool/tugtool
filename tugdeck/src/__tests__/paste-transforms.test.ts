/**
 * Tests for paste-transforms — the "paste as quote" and "paste as plain
 * text" clipboard rewrites.
 *
 * Covers:
 * - quoteMarkdown — per-line `> ` prefix, blank-line handling, empty input
 * - stripMarkdown — headings, emphasis, inline/fenced code, links, images,
 *   lists, blockquotes, tables, raw HTML, plain-text passthrough, empty input
 */
import { describe, it, expect } from "bun:test";
import { quoteMarkdown, stripMarkdown } from "../lib/paste-transforms";

describe("quoteMarkdown", () => {
  it("prefixes a single line with '> '", () => {
    expect(quoteMarkdown("hello")).toBe("> hello");
  });

  it("prefixes every line and keeps blank lines as a bare '>'", () => {
    expect(quoteMarkdown("line one\n\nline three")).toBe(
      "> line one\n>\n> line three",
    );
  });

  it("returns empty input unchanged", () => {
    expect(quoteMarkdown("")).toBe("");
  });

  it("preserves Markdown content verbatim inside the quote", () => {
    expect(quoteMarkdown("# Heading\n- item")).toBe("> # Heading\n> - item");
  });
});

describe("stripMarkdown", () => {
  it("drops heading markers", () => {
    expect(stripMarkdown("# Hello World")).toBe("Hello World");
  });

  it("unwraps emphasis, strong, and inline code", () => {
    expect(stripMarkdown("This is **bold**, *italic*, and `code`.")).toBe(
      "This is bold, italic, and code.",
    );
  });

  it("collapses links to their label and images to their alt text", () => {
    expect(stripMarkdown("[a link](https://x.com)")).toBe("a link");
    expect(stripMarkdown("![alt text](img.png)")).toBe("alt text");
  });

  it("strips list markers, keeping one item per line", () => {
    expect(stripMarkdown("- one\n- two")).toBe("one\ntwo");
    expect(stripMarkdown("1. first\n2. second")).toBe("first\nsecond");
  });

  it("unwraps blockquotes", () => {
    expect(stripMarkdown("> quoted text")).toBe("quoted text");
  });

  it("emits fenced code block contents without the fences", () => {
    expect(stripMarkdown("```js\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  it("flattens a table to tab-separated rows", () => {
    const table = "| a | b |\n| - | - |\n| 1 | 2 |";
    expect(stripMarkdown(table)).toBe("a\tb\n1\t2");
  });

  it("removes raw inline HTML tags but keeps their text content", () => {
    expect(stripMarkdown("before <span>x</span> after")).toBe(
      "before x after",
    );
  });

  it("separates blocks with a blank line", () => {
    expect(stripMarkdown("# Title\n\nA paragraph.")).toBe(
      "Title\n\nA paragraph.",
    );
  });

  it("passes plain text through unchanged", () => {
    expect(stripMarkdown("just plain text")).toBe("just plain text");
  });

  it("returns empty input unchanged", () => {
    expect(stripMarkdown("")).toBe("");
  });
});
