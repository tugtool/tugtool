/**
 * markdown-text-styling.ts — markdown styling as a one-shot filter.
 *
 * `styleMarkdownText(text)` takes a string and returns styled lines: the
 * raw text split at newlines, each line carrying its syntax runs and its
 * hanging-indent width. Pure, synchronous, no editor, no DOM, no promise.
 *
 * Same three ingredients the editor's markdown styling uses, so a commit
 * message reads identically in a composer and in a receipt:
 *
 *  - the `@codemirror/lang-markdown` grammar — imported STATICALLY here.
 *    `Parser.parse()` runs to completion in one call, so styling lands in
 *    the first paint. A lazy chunk would flash unstyled text first, and
 *    the grammar is small enough that deferring it buys nothing.
 *  - {@link tugHighlightStyleInner} — the shared Lezer-tag → `--tug-syntax-*`
 *    map, walked by `highlightTree`. Raw markdown syntax is never removed
 *    or hidden: the `#`, `*`, `` ` `` markers stay in the text and take a
 *    marker tone, exactly as they do in the editor.
 *  - the list hanging indent — a wrapped list item's continuation lines
 *    align under the item content rather than running back under its
 *    marker. In the editor this needs a `ViewPlugin` because CM6 owns the
 *    lines; here it is two CSS properties the renderer states directly.
 *
 * The editor keeps its own `Extension` form
 * (`tug-text-editor/markdown-text-styling.ts`) — a live surface needs
 * incremental reparsing, which this filter deliberately does not do.
 *
 * @module lib/markdown-text-styling
 */

import { markdownLanguage } from "@codemirror/lang-markdown";

import {
  highlightRunsByLine,
  lineStartOffsets,
  tugHighlightStyleInner,
  type FragmentToken,
} from "@/lib/language-registry";

/** One run of characters within a line that share a highlight class. */
export interface MarkdownSpan {
  text: string;
  /** Generated highlight class(es); empty for an unstyled run. */
  className: string;
}

/** One line of styled markdown. */
export interface MarkdownStyledLine {
  /** The line's verbatim text (no trailing newline). */
  text: string;
  /**
   * The hanging indent, in monospace cells: the width of the list marker
   * plus its trailing space, or 0 for a line that starts no list item.
   */
  indent: number;
  /** The line's runs, in order, covering its full text. */
  spans: MarkdownSpan[];
}

/**
 * The list prefix: optional leading indent, a bullet (`-`/`*`/`+`) or an
 * ordered marker (`1.`/`1)`), then the run of spaces before the item's
 * content. Its length is the hanging-indent width.
 */
const LIST_PREFIX = /^(\s*(?:[-*+]|\d+[.)])\s+)/;

/** Cut one line's text into spans at its highlight-run boundaries. */
function spansForLine(text: string, runs: readonly FragmentToken[]): MarkdownSpan[] {
  if (text.length === 0) return [];
  const spans: MarkdownSpan[] = [];
  let at = 0;
  for (const run of runs) {
    const start = Math.max(at, Math.min(run.start, text.length));
    const end = Math.max(start, Math.min(run.end, text.length));
    if (start > at) spans.push({ text: text.slice(at, start), className: "" });
    if (end > start) spans.push({ text: text.slice(start, end), className: run.className });
    at = end;
  }
  if (at < text.length) spans.push({ text: text.slice(at), className: "" });
  return spans;
}

/**
 * Style `text` as markdown. Returns one entry per line of the input, in
 * order; an empty input returns one empty line (the shape a renderer needs
 * to paint a blank row rather than nothing).
 */
export function styleMarkdownText(text: string): MarkdownStyledLine[] {
  const starts = lineStartOffsets(text);
  const lines = text.split("\n");
  const tree = markdownLanguage.parser.parse(text);
  const runs = highlightRunsByLine(tree, text, tugHighlightStyleInner);

  // The hanging indent keys off `ListMark` nodes rather than the regex
  // alone, so a `-` at the head of a line inside a fenced code block is
  // never mistaken for a list marker.
  const indents = new Map<number, number>();
  // `ListMark` nodes arrive in ascending position, so one forward cursor
  // walks every line start exactly once.
  let cursor = 0;
  tree.iterate({
    enter(node) {
      if (node.name !== "ListMark") return;
      while (cursor + 1 < starts.length && starts[cursor + 1] <= node.from) cursor++;
      const match = LIST_PREFIX.exec(lines[cursor] ?? "");
      if (match !== null) indents.set(cursor, match[1].length);
    },
  });

  return lines.map((line, i) => ({
    text: line,
    indent: indents.get(i) ?? 0,
    spans: spansForLine(line, runs[i] ?? []),
  }));
}
