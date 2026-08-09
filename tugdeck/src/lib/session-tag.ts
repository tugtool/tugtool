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
 * **The suffix grammar, and the one suffix there is.** A collision NEVER
 * produces `azure-heron-2`: the bare `-N` backstop is retired, along with the
 * silent NULL tag it landed on at exhaustion. The only sanctioned suffix is a
 * fork's lineage — `<root>-<Letter><Number>`, where the letter names the rewind
 * point forked from (the first point ever forked from within a lineage is `A`)
 * and the number sequences the forks taken from that point, extending for a
 * fork of a fork: `stocky-pixie-A1-B2`. That grammar is unambiguous against a
 * root callsign precisely because a root is two lowercase words, so any
 * trailing `<Letter><Number>` run is lineage and nothing else can be mistaken
 * for it — which is what lets `parseTagLineage` read the segments off a tag
 * when the structured `tag_lineage` column is absent. The ledger allocates
 * letters and numbers from `tag_lineage_points`, which is append-only for the
 * same reason `minted_tags` is: a reissued letter or number would make two
 * unrelated forks share a callsign. See [D132].
 *
 * Pure logic — no React, no DOM, no store. Unit-testable in isolation. The
 * exact-match `tag → session_id` resolution this header once deferred now lives
 * on `session-tag-store.ts` as `resolveTag`, because it needs the live index
 * rather than a pure function.
 *
 * @module lib/session-tag
 */

import type { SessionRow } from "@/protocol";
import { TAG_ADJECTIVES, TAG_NOUNS } from "@/lib/session-tag-lexicon";

/** Re-roll attempts before giving up and letting the ledger reroll the tag. */
const MINT_REROLL_CAP = 8;

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
