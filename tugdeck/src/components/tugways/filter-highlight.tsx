/**
 * filter-highlight — paint a list-filter query's matched spans inside a row.
 *
 * One renderer for every filtered list (the session picker, the `/resume`
 * overlay, the Lens sections, the gallery filter card), so a match looks the
 * same wherever it is found. The output is inline fragments — plain strings
 * and `<mark class="tug-filter-mark">` spans — which compose into a
 * `TugListRow`'s `title` / `subtitle` and therefore keep the row's typography,
 * truncation, and selected-state recolor. Nothing here reaches for the
 * `children` escape hatch.
 *
 * **Pass the string you render.** Ranges come from the `text` argument
 * ({@link filterHighlightRanges}), so a caller that truncates or collapses
 * whitespace for display must pass that *display* string — ranges taken from
 * the raw source field would paint at the wrong offsets.
 *
 * An unfiltered row costs nothing: an empty query (or a string no term
 * matches) returns the bare string, so the row's DOM is byte-identical to its
 * unfiltered self.
 *
 * The paint is `--tugx-find-match-bg` — the one find-paint token family
 * ([L17]), shared with transcript find and the Text card's code view, so a
 * theme tunes "a match" in one place.
 *
 * Laws: [L06] appearance via CSS; [L17] one-hop component-tier alias;
 *       [L20] token sovereignty — the mark paints its own background only.
 *
 * @module components/tugways/filter-highlight
 */

import "./tug-filter-field.css";

import React from "react";

import { filterHighlightRanges } from "@/lib/text-match";

/**
 * Render `text` with the spans matched by `query` wrapped in `<mark>`.
 *
 * Returns the bare string when the query is empty or no term matches `text`.
 */
export function renderFilterHighlight(
  text: string,
  query: string,
): React.ReactNode {
  const ranges = filterHighlightRanges(query, text);
  if (ranges.length === 0) return text;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark className="tug-filter-mark" key={`${start}-${end}`}>
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
