/**
 * Pure-logic tests for the static fragment tokenizer. We assert the
 * *structure* of the per-line runs (which spans get a class, and that
 * distinct tag classes differ) rather than the generated class strings,
 * which are opaque CodeMirror-internal names.
 */

import { test, expect } from "bun:test";
import {
  tokenizeFragment,
  tokenizeFragmentByLangId,
  highlightFragmentToHtml,
} from "../language-registry";

test("tokenizeFragment: keyword + comment land on their lines with distinct classes", async () => {
  const perLine = await tokenizeFragment("const x = 1\n// c", "ts");
  expect(perLine.length).toBe(2);

  // Line 0: a run covering `const` (cols 0..5).
  const kw = perLine[0].find((t) => t.start === 0 && t.end === 5);
  expect(kw).toBeDefined();
  expect(kw!.className.length).toBeGreaterThan(0);

  // Line 1: the comment carries a run with a different class than the keyword.
  expect(perLine[1].length).toBeGreaterThan(0);
  const comment = perLine[1][0];
  expect(comment.className.length).toBeGreaterThan(0);
  expect(comment.className).not.toBe(kw!.className);
});

test("tokenizeFragment: a block comment spanning lines splits per line", async () => {
  const perLine = await tokenizeFragment("/* a\n b */\nx", "ts");
  expect(perLine.length).toBe(3);
  // Both comment lines carry runs (the multi-line node was split).
  expect(perLine[0].length).toBeGreaterThan(0);
  expect(perLine[1].length).toBeGreaterThan(0);
});

test("tokenizeFragment: unknown extension yields per-line empty arrays", async () => {
  const perLine = await tokenizeFragment("anything here\nsecond", "made-up-ext");
  expect(perLine).toEqual([[], []]);
});

test("tokenizeFragmentByLangId: aliases resolve (typescript -> ts)", async () => {
  const perLine = await tokenizeFragmentByLangId("const x = 1", "typescript");
  expect(perLine[0].some((t) => t.start === 0 && t.end === 5)).toBe(true);
});

test("highlightFragmentToHtml: emits class spans and escapes HTML", async () => {
  const html = await highlightFragmentToHtml("const a = '<b>'", "ts");
  expect(html).toContain("<span class=");
  expect(html).toContain("&lt;b&gt;"); // the string literal's angle brackets escaped
  expect(html).not.toContain("<b>"); // never raw markup
});

test("highlightFragmentToHtml: unknown language returns escaped, uncolored text", async () => {
  const html = await highlightFragmentToHtml("a < b && c", "not-a-language");
  expect(html).toBe("a &lt; b &amp;&amp; c");
});
