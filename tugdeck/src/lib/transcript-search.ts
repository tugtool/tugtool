/**
 * transcript-search — the pure match engine behind the Dev card's Find
 * route.
 *
 * Given an ordered array of per-row plain-text projections (one string per
 * searchable transcript row, built by `transcript-search-index`) plus a query
 * and options, {@link search} returns the ordered, non-overlapping matches. It
 * is free of React and DOM: counting is a pure function of the projected text,
 * so the authoritative match set is independent of what is currently mounted.
 *
 * Three option axes compose (Case sensitive · Entire word · Grep):
 *
 *   - **grep** — the query is a JavaScript `RegExp` source; otherwise it is
 *     matched as a literal (escaped before compilation).
 *   - **wholeWord** — the compiled source is wrapped `\b(?:…)\b` so a match
 *     must fall on word boundaries.
 *   - **caseSensitive** — toggles the `i` flag.
 *
 * An empty query, or an invalid grep source, yields zero matches (never a
 * throw).
 *
 * @module lib/transcript-search
 */

/** The three composable search-option toggles. */
export interface FindOptions {
  /** Match case exactly (drops the `i` flag). */
  caseSensitive: boolean;
  /** Require word boundaries on both sides (`\b…\b`). */
  wholeWord: boolean;
  /** Treat the query as a `RegExp` source rather than a literal. */
  grep: boolean;
}

/** A single non-overlapping match, located in one projected row. */
export interface FindMatch {
  /** Index into the `rows` array passed to {@link search}. */
  row: number;
  /** Inclusive start offset within `rows[row]`. */
  start: number;
  /** Exclusive end offset within `rows[row]`. */
  end: number;
}

/** A safe upper bound on the total matches a single search returns. */
export const DEFAULT_MATCH_LIMIT = 5000;

const REGEXP_META = /[.*+?^${}()|[\]\\]/g;

/** Escape a literal so it matches verbatim when compiled as a `RegExp`. */
function escapeRegExp(literal: string): string {
  return literal.replace(REGEXP_META, "\\$&");
}

/**
 * Compile a query + options into a global `RegExp`, or `null` when the query
 * is empty or (in grep mode) an invalid pattern. Plain queries are escaped to
 * a literal; grep queries are used verbatim. The result always carries the
 * `g` flag so {@link search} can walk every occurrence.
 */
export function compileQuery(query: string, options: FindOptions): RegExp | null {
  if (query === "") return null;
  const body = options.grep ? query : escapeRegExp(query);
  const source = options.wholeWord ? `\\b(?:${body})\\b` : body;
  const flags = options.caseSensitive ? "g" : "gi";
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

/**
 * Find every non-overlapping match of `query` across `rows`, in flat-row
 * order and left-to-right within each row. Zero-width matches (e.g. a grep
 * source that can match empty) are skipped rather than counted, and advance
 * the cursor so the walk terminates. Stops once `limit` matches are found.
 */
export function search(
  rows: readonly string[],
  query: string,
  options: FindOptions,
  limit: number = DEFAULT_MATCH_LIMIT,
): FindMatch[] {
  const re = compileQuery(query, options);
  if (re === null) return [];
  const matches: FindMatch[] = [];
  for (let row = 0; row < rows.length; row++) {
    const text = rows[row];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        // A zero-width hit is not a navigable match; step past it so the
        // global exec cannot spin in place.
        re.lastIndex = m.index + 1;
        continue;
      }
      matches.push({ row, start: m.index, end: m.index + m[0].length });
      if (matches.length >= limit) return matches;
    }
  }
  return matches;
}
