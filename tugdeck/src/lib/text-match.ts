/**
 * `text-match` — shared text-matching utility for client-side
 * filtering surfaces (the picker, the filter gallery card, any
 * future small-list consumer).
 *
 * Centralizes the matching contract so every filter feels the same:
 * one return shape (`MatchResult`), one default case-folding rule
 * (Unicode default, locale-independent), one offset coordinate
 * system (UTF-16 code units, matching the Rust scorer in
 * `tugrust/crates/tugcast/src/feeds/fuzzy_scorer.rs` and JavaScript's
 * native `String.slice()`).
 *
 * ## Why this exists separately from file completion
 *
 * File completion routes through tugcast's full fuzzy scorer
 * (`fuzzy_scorer.rs`) — server-side, fzf-inspired DP, scored
 * matches with boundary/camel/consecutive bonuses. That is the
 * right shape when the candidate set is a project-scale file tree:
 * thousands of paths, tight scoring matters, the wire round-trip is
 * negligible against the IO it replaces.
 *
 * The picker's recents and the gallery filter card sit at the other
 * extreme: ≤ 50 candidates, every keystroke filters, a wire round-
 * trip per keystroke is wasteful. The right shape there is a tiny
 * client-side matcher with the same return shape so cell renderers
 * can paint highlights identically across surfaces. That's this
 * file.
 *
 * The two implementations CAN drift. Fuzzy parity (when we want
 * fzf-feel for short lists) is a follow-on that adds a `fuzzyMatch`
 * function here mirroring the Rust algorithm. For now we ship the
 * common case — case-insensitive substring — and leave fuzzy as
 * deferred until a consumer earns it.
 *
 * ## Coordinate system
 *
 * `MatchResult.matches` ranges are **UTF-16 code unit offsets**
 * (half-open intervals — `[start, end)`). This matches:
 *  - JavaScript native string indexing (`String.prototype.slice`,
 *    `String.prototype.charAt`, `string[i]`).
 *  - The Rust scorer's offset contract — see
 *    `fuzzy_scorer.rs:14-19`.
 *
 * For ASCII paths (the typical input) UTF-16 offsets equal codepoint
 * indices. For strings containing supplementary-plane characters
 * (emoji, rare CJK extensions), UTF-16 offsets and codepoint indices
 * differ; rendering code that splits the string with `slice()`
 * should still be correct because `slice()` uses the same
 * coordinate.
 *
 * ## Case folding
 *
 * Uses `String.prototype.toLowerCase()` — locale-independent
 * Unicode default case mapping (ASCII A→a, accented Latin É→é). Not
 * `toLocaleLowerCase()` (which depends on the user's locale and
 * would make matching non-deterministic across machines).
 *
 * Edge case: a few characters expand under default case folding
 * (notably ß → ss). When the lowercased forms have different
 * lengths than their originals, the simple `indexOf` we use here
 * computes the match range in the *lowercased* coordinate, which
 * may not align byte-for-byte with the original string. We don't
 * compensate — this is a documented limitation — because the
 * picker's recents and the gallery card are ASCII paths. A future
 * enhancement (a per-char fold-aware walker) lands when a consumer
 * has Unicode-expansion-bearing data.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Result of a successful match.
 *
 * `matches` is a list of half-open ranges `[start, end)` in UTF-16
 * code unit offsets identifying the matched portions of the target.
 * Cell renderers can paint highlights by walking the ranges and
 * splitting the target string at the boundaries.
 *
 * `score` is optional — only present when the matcher provides a
 * ranking signal. The substring matcher does not return a score
 * (every match is a single contiguous span; ranking among matches
 * uses position only — leftmost first, but the matcher itself
 * surfaces match-or-no-match, not "how good"). A future fuzzy
 * matcher will populate `score`.
 */
export interface MatchResult {
  readonly score?: number;
  readonly matches: ReadonlyArray<readonly [start: number, end: number]>;
}

// ---------------------------------------------------------------------------
// Case-insensitive substring
// ---------------------------------------------------------------------------

/**
 * Case-insensitive substring match.
 *
 * Returns a `MatchResult` with a single range covering the matched
 * span if `target` (case-insensitively) contains `query`, or `null`
 * if it does not.
 *
 *  - Empty `query` matches everything with `matches: []`. This
 *    represents "no filter active" — cell renderers see no ranges
 *    and paint no highlights.
 *  - Empty `target` with non-empty `query` returns `null`.
 *  - Multiple occurrences of `query` in `target` produce a single
 *    range at the LEFTMOST occurrence (the first `indexOf` hit).
 *    Highlighting only the first occurrence keeps the visual signal
 *    deterministic — the alternative (every occurrence) is busy and
 *    rarely useful for path-shaped data.
 *
 * The match offsets are UTF-16 code unit indices into the ORIGINAL
 * `target` (not the lowercased intermediate). For ASCII strings the
 * mapping is exact; for strings whose case-folded form has a
 * different length than the original, see the module docstring's
 * note on the `ß → ss` edge case.
 *
 * @example
 * ```ts
 * caseInsensitiveSubstring("tug", "/Users/Ken/projects/tugtool")
 * // → { matches: [[20, 23]] }
 *
 * caseInsensitiveSubstring("TUGTOOL", "/Users/Ken/projects/tugtool")
 * // → { matches: [[20, 27]] }
 *
 * caseInsensitiveSubstring("nope", "/Users/Ken/projects/tugtool")
 * // → null
 *
 * caseInsensitiveSubstring("", "anything")
 * // → { matches: [] }
 * ```
 */
export function caseInsensitiveSubstring(
  query: string,
  target: string,
): MatchResult | null {
  if (query.length === 0) {
    return { matches: [] };
  }
  if (target.length === 0) {
    return null;
  }

  const haystack = target.toLowerCase();
  const needle = query.toLowerCase();
  const idx = haystack.indexOf(needle);
  if (idx < 0) return null;

  // Map the lowercased-coordinate match back to the original coordinate.
  // For ASCII (the dominant case) and any case-folding that preserves
  // string length per character, `idx` is also the original offset and
  // `query.length` is the matched span. The module docstring's edge-
  // case note covers the rare expansion-bearing strings where this
  // approximation breaks; we intentionally don't pay for a per-char
  // walk to handle data the picker / gallery card never see.
  return { matches: [[idx, idx + query.length]] };
}
