/**
 * `TugMarkdownText` — read-only markdown-styled text.
 *
 * A block of prose (a commit message body, a note) painted with the same
 * markdown styling the editing surfaces use — heading / strong / emphasis /
 * inline-code tones, and a hanging indent under wrapped list items — with
 * the raw syntax left in place. Read-only: no editor, no gestures, no
 * selection model of its own beyond the browser's.
 *
 * Styling is a synchronous filter ({@link styleMarkdownText}), so the first
 * paint is the styled paint. Text renders verbatim, whitespace preserved.
 *
 * `highlightQuery` paints a list filter's matches over the styled text — the
 * marks nest INSIDE the syntax runs (`renderFilterHighlightSpans`), so a match
 * inside inline code keeps the code tone and wears the highlight. Matching runs
 * per LINE, which is also the only correct grain: a query term cannot span a
 * newline.
 *
 * Laws: [L06] every tone comes from the shared highlight classes and the
 * component's own CSS; nothing here is React state.
 *
 * @module components/tugways/tug-markdown-text
 */

import "./tug-markdown-text.css";

import { useMemo } from "react";
import type React from "react";

import { renderFilterHighlightSpans } from "@/components/tugways/filter-highlight";
import { styleMarkdownText } from "@/lib/markdown-text-styling";

export interface TugMarkdownTextProps {
  /** The markdown to style. Rendered verbatim — nothing is hidden. */
  text: string;
  /**
   * A list filter's live query. Its matches are marked inside the styled runs.
   * Empty / absent ⇒ no marks and DOM identical to the unfiltered render.
   */
  highlightQuery?: string;
  className?: string;
  /** Test hook on the block element. */
  dataSlot?: string;
}

export function TugMarkdownText({
  text,
  highlightQuery = "",
  className,
  dataSlot,
}: TugMarkdownTextProps): React.ReactElement {
  const lines = useMemo(() => styleMarkdownText(text), [text]);
  return (
    <div
      className={
        className !== undefined ? `tug-markdown-text ${className}` : "tug-markdown-text"
      }
      data-slot={dataSlot}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          className="tug-markdown-text-line"
          // The hanging indent: the block indents by the marker width so
          // wrapped lines start there, and the first visual line pulls back
          // by the same amount so the marker itself still reads flush.
          style={
            line.indent > 0
              ? {
                  paddingLeft: `${line.indent}ch`,
                  textIndent: `-${line.indent}ch`,
                }
              : undefined
          }
        >
          {renderFilterHighlightSpans(line.spans, line.text, highlightQuery)}
        </div>
      ))}
    </div>
  );
}
