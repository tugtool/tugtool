# File Completion Matching Algorithm

**Status:** Proposal  
**Date:** 2026-04-06  
**Prerequisite:** tugplan-live-file-completion (data pipeline must be operational first)

---

## Problem

The current file completion provider uses `String.includes()` — case-insensitive substring matching with no scoring or ranking. When the FILETREE feed delivers thousands of project files, this breaks down:

- `sms` won't match `session-metadata-store.ts` (non-contiguous characters)
- `btn` won't match `ButtonGroup.tsx` (word-boundary initials)
- `model` ranks `src/deep/nested/model.ts` the same as `model.ts` (no basename preference)
- Results appear in filesystem walk order, not relevance order

## Research Summary

### What the editor frameworks do

| Framework | Built-in matching? | Algorithm |
|-----------|-------------------|-----------|
| **ProseMirror** | None — consumer's responsibility | N/A |
| **Lexical** | None — playground uses `includes()` | N/A |
| **CodeMirror 6** | Yes (`FuzzyMatcher`) | Tiered penalties: exact prefix → case-folded prefix → word-boundary initials → substring → fuzzy. No path awareness. |

ProseMirror and Lexical deliberately separate trigger/lifecycle management from matching — exactly the `CompletionProvider` pattern we already have. CodeMirror 6 ships a real scorer but it's designed for code identifiers, not file paths.

### What the file-finding tools do

| Tool | Algorithm | Path awareness? |
|------|-----------|-----------------|
| **VS Code** | Two-layer DP: character scorer (`fuzzyScore`) + structural scorer (`scoreItemFuzzy`) | Yes — scores basename first, falls back to full path. Bit-shifted tier thresholds separate label-prefix, label-match, and path-match results. |
| **fzf** | Smith-Waterman-variant DP (`FuzzyMatchV2`) | Partial — `/` gets a word-boundary bonus (+8), but no explicit basename preference. |
| **Sublime Text** | Greedy scan with backtracking | Yes — filename portion weighted much more heavily than directory components (separate multiplier). Pioneered this pattern. |
| **Telescope.nvim** | Delegates to fzf-native (C port of fzf) | Same as fzf. |

### Key design insight

VS Code and Sublime both use a **two-layer architecture**:

1. **Character scorer** — DP or greedy scan that scores how well the query characters align with the candidate string (consecutive bonuses, word-boundary bonuses, gap penalties, case-match bonuses).
2. **Structural scorer** — wraps the character scorer with file-path knowledge: score the basename first and prefer it; only fall back to full-path matching when the query contains `/` or the basename doesn't match.

This separation is the right design. A single-layer fuzzy scorer (like fzf) treats `model` in `src/models/user/model.ts` the same whether the characters hit the basename or a directory — it gets the right answer sometimes, but by accident rather than by design.

## Recommendation: Single Algorithm, Two Layers

**One algorithm. No voting. Two layers.**

Voting/ensemble approaches add complexity without clear benefit — every tool we studied uses a single scorer. The quality comes from the scoring function's design, not from running multiple strategies and reconciling them.

### Layer 1: Character Scorer

A DP-based fuzzy scorer inspired by fzf's scoring model (which VS Code's is also derived from). Operates on a single string — no path knowledge.

**Scoring factors:**

| Factor | Bonus/Penalty | Rationale |
|--------|--------------|-----------|
| Base match per character | +16 | fzf convention; scales well |
| Consecutive match | +8 per char | Strongly rewards contiguous sequences |
| Word boundary match | +8 | After `-`, `_`, `.`, `/`, space |
| CamelCase transition | +7 | Uppercase after lowercase |
| First character match | +8 | Prefix alignment |
| Exact case match | +1 | Tiebreaker |
| Gap (first) | −3 | Penalize skipped characters |
| Gap (extension) | −1 | Diminishing penalty for longer gaps |

The DP table is `query.length × candidate.length`. Each cell tracks the best score achievable matching `query[0..i]` against `candidate[0..j]`. Backtrack from the bottom-right to recover match positions for highlighting.

For our scale (queries under 30 chars, candidates under 200 chars), this is sub-microsecond per candidate. At 50,000 files it's under 50ms — well within interactive budget.

### Layer 2: Path-Aware Structural Scorer

Wraps the character scorer with file-path semantics. This is where the real UX quality comes from.

```
score_file(query, path):
  basename = path after last "/"
  dirname  = path up to last "/"

  if query contains "/":
    # User is explicitly path-matching — score the full path
    return char_score(query, path)

  # Try basename first
  base_result = char_score(query, basename)
  if base_result:
    # Basename matches get a large tier bonus
    return base_result.score + BASENAME_TIER_BONUS

  # Fall back to full path
  full_result = char_score(query, path)
  if full_result:
    return full_result.score

  return null  # no match
```

**BASENAME_TIER_BONUS** should be large enough that any basename match outranks any directory-only match. VS Code uses bit-shifted constants (1 << 17 vs 1 << 16) to create discrete tiers. We should do the same — a basename match for `mod` on `model.ts` must always beat a directory match for `mod` on `src/modules/config/setup.ts`.

### Match examples with this design

| Query | Candidate | Match type | Behavior |
|-------|-----------|------------|----------|
| `sms` | `session-metadata-store.ts` | Basename, word-boundary initials (`s`ession-`m`etadata-`s`tore) | High score: 3 boundary bonuses |
| `btn` | `ButtonGroup.tsx` | Basename, camelCase (`B`u`t`to`n`) | Moderate score — but would lose to an exact substring match |
| `model` | `model.ts` | Basename, exact prefix | Top score: prefix + consecutive + short length |
| `model` | `src/models/user/model.ts` | Basename, exact prefix | Same basename score as above (dirname ignored unless query has `/`) |
| `model` | `src/models/config.ts` | Full path, substring in dirname | Low score: no basename match, directory-only |
| `src/comp` | `src/components/Button.tsx` | Full path (query contains `/`) | Scored as full path match |

### Tiebreaking

When scores are equal:
1. **Shorter path wins** — `model.ts` over `src/deep/model.ts`
2. **Lexicographic** — stable, predictable ordering

### What this doesn't do (intentionally)

- **Frecency / recency weighting** — requires usage tracking infrastructure we don't have. Worth adding later, but the scorer should accept an optional external boost rather than owning this.
- **Multi-term queries** — VS Code supports `"comp button"` (space-separated). Not needed for trigger-based `@` completion where the query is a single token. Can be added if we later support a Quick Open-style picker.
- **Delta scoring** — re-scoring only changed candidates when the query grows by one character. An optimization for >100k file lists. Our 50k cap makes full re-score fast enough.

## Implementation Shape

Scoring lives in Rust (tugcast), not TypeScript. The file index already lives in tugcast's `BTreeSet<String>` — shipping 50k paths to the browser for client-side scoring is the wrong architecture. Instead, the client sends a query string, tugcast scores and returns the top-N results.

One new Rust module: `tugrust/crates/tugcast/src/feeds/fuzzy_scorer.rs`

Exports:
- `contains_chars(query: &str, candidate: &str) -> bool` — O(n) subsequence pre-filter, eliminates >99% of candidates before DP
- `fuzzy_score(query: &str, candidate: &str) -> Option<ScoredMatch>` — the character-level DP scorer (only called on pre-filter survivors)
- `score_file_path(query: &str, path: &str) -> Option<ScoredMatch>` — the path-aware structural wrapper
- `ScoredMatch { score: i32, matches: Vec<(usize, usize)> }` — score + highlight ranges

Performance budget: pre-filter ~4ms on 50k files, DP scoring on ~100-500 survivors ~1-4ms. Total well under 10ms per query.

The `CompletionProvider` type gains an optional `subscribe` method for async result notification (L22-compliant observer path). `CompletionItem` gains optional `matches` for highlight rendering.

See `tugplan-live-file-completion.md` for full implementation plan.

## Why not use a library?

- **fzf-for-js / fzf-lite:** Wrong language — scoring is in Rust, not TypeScript.
- **nucleo / fuzzy-matcher (Rust crates):** Viable alternatives, but ~250 lines of our own Rust gives us full control over the two-layer design (character scorer + path-aware wrapper) and the scoring constants. No external dependency for a core UX feature.
- **fuse.js:** Bitap-based, designed for short string search. Poor fit for file paths (no boundary bonuses, no path awareness).

The scoring constants are the thing we'll tune. Ship with fzf-inspired defaults, then adjust based on real usage. The algorithm itself won't change.
