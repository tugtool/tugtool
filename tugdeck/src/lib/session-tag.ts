/**
 * session-tag.ts — pure minting + filtering for mnemonic session tags.
 *
 * A tag is an `adjective-noun` pair (e.g. `azure-heron`) drawn from the curated
 * lexicon (`session-tag-lexicon.ts`). The client mints one "from the drop" and
 * re-rolls it against the tags it already knows, so this module only needs to
 * avoid the tags already in hand.
 *
 * **The ledger is the authority, and its answer can differ from ours.** A tag
 * any session ever minted is spent forever (the append-only `minted_tags`
 * arbiter), so the server does not suffix a collision — it rerolls a complete
 * fresh pair. The client adopts that on the `session_updated` / spawn-ack path
 * it already rides, which means a freshly shown callsign may change **once**,
 * seconds after spawn, and is then immutable for the life of the session.
 * Nothing may cache the optimistic tag past that ack.
 *
 * Pure logic — no React, no DOM, no store. Unit-testable in isolation. The
 * exact-match `resolveTag` + a `tag → session_id` reverse map are deferred to
 * the typed-`/resume <tag>` command follow-on that consumes them.
 *
 * @module lib/session-tag
 */

import type { SessionRow } from "@/protocol";
import { TAG_ADJECTIVES, TAG_NOUNS } from "@/lib/session-tag-lexicon";

/** Re-roll attempts before giving up and letting the ledger reroll the tag. */
const MINT_REROLL_CAP = 8;

/** Empty exclusion set for a derivation that needs no re-roll (see below). */
const NO_KNOWN: ReadonlySet<string> = new Set();

/**
 * Deterministic `[0, 1)` PRNG seeded by a string — an FNV-1a hash of `seed`
 * driving a mulberry32 generator. Same seed → same stream, every call.
 */
function seededRng(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A stable `adjective-noun` tag derived deterministically from `seed` (a session
 * id) — the friendly face for a session the ledger has no minted tag for yet
 * (e.g. an external terminal session surfaced in the chooser). Same id → same
 * tag, every render, with no store or persistence; a real minted `row.tag` (when
 * present) always takes precedence at the call site.
 */
export function deriveStableTag(seed: string): string {
  return mintTag(NO_KNOWN, seededRng(seed));
}

/**
 * Mint a fresh `adjective-noun` tag not present in `known`.
 *
 * Picks a random adjective + noun; if the pair is already in `known`, re-rolls
 * up to {@link MINT_REROLL_CAP} times. If every attempt collides (astronomically
 * unlikely against 524k combinations), returns the last candidate — the ledger
 * rerolls it authoritatively. `rng` defaults to `Math.random` and
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
