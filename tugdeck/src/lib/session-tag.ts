/**
 * session-tag.ts — pure minting + filtering for mnemonic session tags.
 *
 * A tag is an `adjective-noun` pair (e.g. `azure-heron`) drawn from the curated
 * lexicon (`session-tag-lexicon.ts`). The client mints one "from the drop" and
 * re-rolls it against the tags it already knows; the ledger's unique index is
 * the atomic backstop that suffixes the rare true collision, so this module only
 * needs to avoid the tags already in hand.
 *
 * Pure logic — no React, no DOM, no store. Unit-testable in isolation. The
 * exact-match `resolveTag` + a `tag → session_id` reverse map are deferred to
 * the typed-`/resume <tag>` command follow-on that consumes them.
 *
 * @module lib/session-tag
 */

import type { SessionRow } from "@/protocol";
import { TAG_ADJECTIVES, TAG_NOUNS } from "@/lib/session-tag-lexicon";

/** Re-roll attempts before giving up and letting the ledger suffix the tag. */
const MINT_REROLL_CAP = 8;

/**
 * Mint a fresh `adjective-noun` tag not present in `known`.
 *
 * Picks a random adjective + noun; if the pair is already in `known`, re-rolls
 * up to {@link MINT_REROLL_CAP} times. If every attempt collides (astronomically
 * unlikely against 524k combinations), returns the last candidate — the ledger's
 * unique index suffixes it authoritatively. `rng` defaults to `Math.random` and
 * is injectable for deterministic tests.
 */
export function mintTag(
  known: ReadonlySet<string>,
  rng: () => number = Math.random,
): string {
  const pick = (pool: readonly string[]): string =>
    pool[Math.floor(rng() * pool.length)];
  let candidate = `${pick(TAG_ADJECTIVES)}-${pick(TAG_NOUNS)}`;
  for (let i = 0; i < MINT_REROLL_CAP && known.has(candidate); i++) {
    candidate = `${pick(TAG_ADJECTIVES)}-${pick(TAG_NOUNS)}`;
  }
  return candidate;
}

/**
 * The `/resume` overlay filter predicate: a case-insensitive substring match of
 * `query` against the row's `tag`, `name`, and `last_user_prompt`. An empty /
 * whitespace query matches every row (the unfiltered list). This is all v1's
 * addressing needs.
 */
export function matchesTagQuery(row: SessionRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  const haystacks = [row.tag, row.name, row.last_user_prompt];
  return haystacks.some(
    (field) => field !== null && field.toLowerCase().includes(needle),
  );
}
