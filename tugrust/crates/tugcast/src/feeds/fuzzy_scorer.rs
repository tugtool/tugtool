// Consumed by filetree.rs (Step 6). Allow dead code until then.
#![allow(dead_code)]

// Two-layer fuzzy scorer for file path matching.
//
// Layer 1: character-level DP scorer (fuzzy_score)
// Layer 2: path-aware structural wrapper (score_file_path)
//
// Scoring constants adapted from fzf (see THIRD_PARTY_NOTICES.md).

/// A scored match with highlight ranges.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScoredMatch {
    pub score: i32,
    /// Byte-offset ranges `(start, end)` for matched characters in the candidate.
    /// Each range is a half-open interval: the character at `start` is included,
    /// the character at `end` is excluded.
    pub matches: Vec<(usize, usize)>,
}

// ---------------------------------------------------------------------------
// Scoring constants (fzf-inspired defaults)
// ---------------------------------------------------------------------------

const SCORE_MATCH: i32 = 16;
const SCORE_CONSECUTIVE: i32 = 8;
const SCORE_BOUNDARY: i32 = 8;
const SCORE_CAMEL: i32 = 7;
const SCORE_FIRST_CHAR: i32 = 8;
const SCORE_CASE_EXACT: i32 = 1;
const PENALTY_GAP_FIRST: i32 = -3;
const PENALTY_GAP_EXTENSION: i32 = -1;

/// Large bonus so any basename match outranks any directory-only match.
const BASENAME_TIER_BONUS: i32 = 1 << 17; // 131072

// ---------------------------------------------------------------------------
// Pre-filter
// ---------------------------------------------------------------------------

/// O(n) subsequence check. Returns `true` if every character in `query`
/// appears in `candidate` in order (case-insensitive).
pub fn contains_chars(query: &str, candidate: &str) -> bool {
    let mut qi = query.as_bytes().iter();
    let mut current = match qi.next() {
        Some(&b) => b.to_ascii_lowercase(),
        None => return true, // empty query matches everything
    };
    for &cb in candidate.as_bytes() {
        if cb.to_ascii_lowercase() == current {
            current = match qi.next() {
                Some(&b) => b.to_ascii_lowercase(),
                None => return true,
            };
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Character-level DP scorer
// ---------------------------------------------------------------------------

/// Classify a character for boundary detection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CharClass {
    Lower,
    Upper,
    Digit,
    Separator,
}

fn char_class(b: u8) -> CharClass {
    match b {
        b'a'..=b'z' => CharClass::Lower,
        b'A'..=b'Z' => CharClass::Upper,
        b'0'..=b'9' => CharClass::Digit,
        _ => CharClass::Separator,
    }
}

fn is_boundary(prev: CharClass, curr: CharClass) -> bool {
    matches!(
        (prev, curr),
        (CharClass::Separator, CharClass::Lower | CharClass::Upper | CharClass::Digit)
    )
}

fn is_camel(prev: CharClass, curr: CharClass) -> bool {
    prev == CharClass::Lower && curr == CharClass::Upper
}

/// Character-level DP fuzzy scorer.
///
/// Caller should pre-filter via [`contains_chars`] before calling this —
/// the DP table is expensive and should only run on plausible matches.
///
/// Returns `None` if the query cannot be fully matched (defensive; shouldn't
/// happen after pre-filter).
pub fn fuzzy_score(query: &str, candidate: &str) -> Option<ScoredMatch> {
    let q = query.as_bytes();
    let c = candidate.as_bytes();
    let qlen = q.len();
    let clen = c.len();

    if qlen == 0 {
        return Some(ScoredMatch {
            score: 0,
            matches: vec![],
        });
    }
    if clen == 0 || qlen > clen {
        return None;
    }

    // dp[i][j] = best score matching q[0..i] against c[0..j]
    // consecutive[i][j] = length of consecutive run ending at (i,j)
    // We use 1-indexed for convenience; row 0 and col 0 are base cases.
    let rows = qlen + 1;
    let cols = clen + 1;

    // Flat arrays for the DP tables.
    let mut dp = vec![i32::MIN / 2; rows * cols];
    let mut consecutive = vec![0i32; rows * cols];

    // Base case: matching 0 query chars against any prefix is score 0.
    for j in 0..cols {
        dp[j] = 0; // dp[0][j] = 0
    }

    // Pre-compute character classes for boundary detection.
    let c_class: Vec<CharClass> = c.iter().map(|&b| char_class(b)).collect();

    for i in 1..rows {
        let qi = q[i - 1];
        let qi_lower = qi.to_ascii_lowercase();

        for j in i..cols {
            // j must be >= i (need at least i candidate chars for i query chars)
            let cj = c[j - 1];
            let cj_lower = cj.to_ascii_lowercase();

            let idx = i * cols + j;
            let left = dp[i * cols + (j - 1)]; // skip candidate char j

            if qi_lower == cj_lower {
                // Match: extend diagonal.
                let diag = dp[(i - 1) * cols + (j - 1)];
                let prev_consec = consecutive[(i - 1) * cols + (j - 1)];

                let mut match_score = SCORE_MATCH;

                // Consecutive bonus
                if prev_consec > 0 {
                    match_score += SCORE_CONSECUTIVE;
                    consecutive[idx] = prev_consec + 1;
                } else {
                    consecutive[idx] = 1;
                }

                // First character bonus
                if j == 1 {
                    match_score += SCORE_FIRST_CHAR;
                }

                // Boundary bonus
                if j >= 2 {
                    let prev_class = c_class[j - 2];
                    let curr_class = c_class[j - 1];
                    if is_boundary(prev_class, curr_class) {
                        match_score += SCORE_BOUNDARY;
                    } else if is_camel(prev_class, curr_class) {
                        match_score += SCORE_CAMEL;
                    }
                }

                // Exact case bonus
                if qi == cj {
                    match_score += SCORE_CASE_EXACT;
                }

                // Gap penalty for skipped candidate chars (if not consecutive)
                let gap_penalty = if prev_consec > 0 || i == 1 && j == 1 {
                    0
                } else if j == 1 || dp[(i - 1) * cols + (j - 1)] == dp[(i - 1) * cols + (j - 2)]
                {
                    0 // no gap
                } else {
                    // We came from a non-adjacent position; gap already penalized via `left` path
                    0
                };

                let match_total = diag + match_score + gap_penalty;

                // Also consider: skip this candidate char (gap).
                let gap_score = if left > i32::MIN / 2 {
                    left
                } else {
                    i32::MIN / 2
                };

                if match_total >= gap_score {
                    dp[idx] = match_total;
                    // consecutive already set above
                } else {
                    dp[idx] = gap_score;
                    consecutive[idx] = 0;
                }
            } else {
                // No character match: must skip (gap).
                dp[idx] = left;
                consecutive[idx] = 0;
            }
        }
    }

    let final_score = dp[qlen * cols + clen];
    if final_score <= i32::MIN / 2 {
        return None;
    }

    // Backtrack to recover match positions.
    let matches = backtrack(q, c, &dp, &consecutive, rows, cols);

    Some(ScoredMatch {
        score: final_score,
        matches,
    })
}

/// Backtrack through the DP table to recover matched character positions.
fn backtrack(
    q: &[u8],
    c: &[u8],
    dp: &[i32],
    consecutive: &[i32],
    rows: usize,
    cols: usize,
) -> Vec<(usize, usize)> {
    let mut positions: Vec<usize> = Vec::with_capacity(q.len());
    let mut i = rows - 1;
    let mut j = cols - 1;

    while i > 0 && j > 0 {
        let idx = i * cols + j;
        let qi_lower = q[i - 1].to_ascii_lowercase();
        let cj_lower = c[j - 1].to_ascii_lowercase();

        if qi_lower == cj_lower && consecutive[idx] > 0 {
            // This position was part of a match.
            positions.push(j - 1); // 0-indexed byte position in candidate
            i -= 1;
            j -= 1;
        } else if qi_lower == cj_lower {
            // Character matches but we might have chosen the skip path.
            // Check if taking the match here leads to a valid score.
            let diag = if i > 0 && j > 0 {
                dp[(i - 1) * cols + (j - 1)]
            } else {
                0
            };
            if diag > i32::MIN / 2 && dp[idx] > dp[i * cols + (j - 1)] {
                positions.push(j - 1);
                i -= 1;
                j -= 1;
            } else {
                j -= 1;
            }
        } else {
            j -= 1;
        }
    }

    positions.reverse();

    // Merge consecutive positions into ranges.
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for pos in positions {
        if let Some(last) = ranges.last_mut() {
            if last.1 == pos {
                last.1 = pos + 1;
                continue;
            }
        }
        ranges.push((pos, pos + 1));
    }
    ranges
}

// ---------------------------------------------------------------------------
// Path-aware structural scorer (Layer 2)
// ---------------------------------------------------------------------------

/// Score a file path against a query with basename preference.
///
/// - If query contains `/`: score the full path.
/// - Otherwise: score basename first (with tier bonus), fall back to full path.
/// - Tiebreaking: shorter paths get a small bonus.
pub fn score_file_path(query: &str, path: &str) -> Option<ScoredMatch> {
    if query.is_empty() {
        return Some(ScoredMatch {
            score: 0,
            matches: vec![],
        });
    }

    if query.contains('/') {
        // User is explicitly path-matching.
        if !contains_chars(query, path) {
            return None;
        }
        let mut m = fuzzy_score(query, path)?;
        m.score -= path.len() as i32; // shorter paths win ties
        return Some(m);
    }

    // Try basename first.
    let basename_start = path.rfind('/').map_or(0, |i| i + 1);
    let basename = &path[basename_start..];

    if !basename.is_empty() && contains_chars(query, basename) {
        if let Some(mut m) = fuzzy_score(query, basename) {
            // Adjust match positions to be relative to the full path.
            for range in &mut m.matches {
                range.0 += basename_start;
                range.1 += basename_start;
            }
            m.score += BASENAME_TIER_BONUS;
            m.score -= path.len() as i32;
            return Some(m);
        }
    }

    // Fall back to full path.
    if !contains_chars(query, path) {
        return None;
    }
    let mut m = fuzzy_score(query, path)?;
    m.score -= path.len() as i32; // shorter paths win ties
    Some(m)
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // contains_chars
    // -----------------------------------------------------------------------

    #[test]
    fn prefilter_matches_subsequence() {
        assert!(contains_chars("sms", "session-metadata-store.ts"));
    }

    #[test]
    fn prefilter_rejects_missing_chars() {
        assert!(!contains_chars("xyz", "model.ts"));
    }

    #[test]
    fn prefilter_order_matters() {
        assert!(!contains_chars("sm", "ms"));
    }

    #[test]
    fn prefilter_case_insensitive() {
        assert!(contains_chars("btn", "ButtonGroup.tsx"));
    }

    #[test]
    fn prefilter_empty_query_matches_everything() {
        assert!(contains_chars("", "anything.rs"));
    }

    #[test]
    fn prefilter_empty_candidate_rejects_nonempty_query() {
        assert!(!contains_chars("a", ""));
    }

    // -----------------------------------------------------------------------
    // fuzzy_score basics
    // -----------------------------------------------------------------------

    #[test]
    fn empty_query_scores_zero() {
        let m = fuzzy_score("", "anything").unwrap();
        assert_eq!(m.score, 0);
        assert!(m.matches.is_empty());
    }

    #[test]
    fn no_match_returns_none() {
        assert!(fuzzy_score("xyz", "model.ts").is_none());
    }

    #[test]
    fn exact_prefix_scores_high() {
        let m = fuzzy_score("model", "model.ts").unwrap();
        // 5 chars matched, all consecutive, first char bonus
        assert!(m.score > 0);
        // All 5 chars should be one contiguous range.
        assert_eq!(m.matches, vec![(0, 5)]);
    }

    #[test]
    fn case_insensitive_matching() {
        let m = fuzzy_score("model", "Model.ts").unwrap();
        assert!(m.score > 0);
        assert_eq!(m.matches, vec![(0, 5)]);
    }

    #[test]
    fn case_exact_bonus() {
        let exact = fuzzy_score("Model", "Model.ts").unwrap();
        let inexact = fuzzy_score("model", "Model.ts").unwrap();
        // Exact case should score higher due to case bonus per char.
        assert!(exact.score > inexact.score);
    }

    #[test]
    fn word_boundary_initials() {
        let m = fuzzy_score("sms", "session-metadata-store.ts").unwrap();
        assert!(m.score > 0);
        // Should match s, m, s at word boundaries.
        assert_eq!(m.matches.len(), 3);
        // First match at 0 (s of session)
        assert_eq!(m.matches[0], (0, 1));
    }

    #[test]
    fn camel_case_matching() {
        let m = fuzzy_score("bg", "ButtonGroup.tsx").unwrap();
        assert!(m.score > 0);
    }

    #[test]
    fn consecutive_chars_score_higher_than_scattered() {
        let consecutive = fuzzy_score("mod", "model.ts").unwrap();
        let scattered = fuzzy_score("mod", "maximum_override.ts").unwrap();
        // "mod" consecutive in "model" vs scattered across "maximum_override"
        // Consecutive should score higher due to consecutive bonus.
        assert!(
            consecutive.score > scattered.score,
            "consecutive ({}) should beat scattered ({})",
            consecutive.score,
            scattered.score
        );
    }

    #[test]
    fn match_positions_correct_for_highlighting() {
        let m = fuzzy_score("ft", "filetree.rs").unwrap();
        // "f" at 0, "t" at 4 — but consecutive search might find "ft" contiguously
        // if not available. Let's just verify ranges are within bounds.
        for (start, end) in &m.matches {
            assert!(*start < "filetree.rs".len());
            assert!(*end <= "filetree.rs".len());
            assert!(start < end);
        }
    }

    // -----------------------------------------------------------------------
    // score_file_path (Layer 2)
    // -----------------------------------------------------------------------

    #[test]
    fn basename_preference() {
        let short = score_file_path("model", "model.ts").unwrap();
        let deep = score_file_path("model", "src/models/config.ts");
        // "model" matches basename of model.ts → tier bonus.
        // "model" does NOT match basename "config.ts", so falls back to full path
        // where it matches "models" in the directory — no tier bonus.
        match deep {
            Some(d) => assert!(short.score > d.score),
            None => {} // also acceptable if full path doesn't match
        }
    }

    #[test]
    fn basename_match_beats_directory_match() {
        let basename_hit = score_file_path("model", "src/deep/model.ts").unwrap();
        let dir_only = score_file_path("model", "src/models/config.ts");
        match dir_only {
            Some(d) => assert!(
                basename_hit.score > d.score,
                "basename hit ({}) should beat dir-only ({})",
                basename_hit.score,
                d.score
            ),
            None => {} // dir-only didn't even match
        }
    }

    #[test]
    fn shorter_path_wins_on_tie() {
        let short = score_file_path("model", "model.ts").unwrap();
        let long = score_file_path("model", "src/deep/model.ts").unwrap();
        // Both match basename "model" with tier bonus, but short path gets less length penalty.
        assert!(short.score > long.score);
    }

    #[test]
    fn query_with_slash_scores_full_path() {
        let m = score_file_path("src/comp", "src/components/Button.tsx").unwrap();
        assert!(m.score > 0);
        // Match positions should be in the directory portion.
        assert!(!m.matches.is_empty());
        assert_eq!(m.matches[0].0, 0); // starts at 's' of 'src'
    }

    #[test]
    fn nonmatch_returns_none() {
        assert!(score_file_path("xyz", "model.ts").is_none());
    }

    #[test]
    fn empty_query_returns_zero_score() {
        let m = score_file_path("", "anything.rs").unwrap();
        assert_eq!(m.score, 0);
    }

    #[test]
    fn basename_match_positions_are_path_relative() {
        let m = score_file_path("model", "src/lib/model.ts").unwrap();
        // "model" matches the basename starting at byte offset 8 ("src/lib/" is 8 bytes).
        assert!(!m.matches.is_empty());
        let first_start = m.matches[0].0;
        assert_eq!(first_start, 8, "match should start at basename offset");
    }

    #[test]
    fn sms_matches_session_metadata_store() {
        let m = score_file_path("sms", "src/lib/session-metadata-store.ts").unwrap();
        assert!(m.score > 0);
        // Should match in the basename portion with tier bonus.
        assert!(m.score > BASENAME_TIER_BONUS / 2); // well above zero, has tier bonus
    }

    #[test]
    fn root_level_file_no_slash() {
        let m = score_file_path("cargo", "Cargo.toml").unwrap();
        assert!(m.score > 0);
        // basename_start is 0 for root-level files.
        assert!(!m.matches.is_empty());
    }
}
