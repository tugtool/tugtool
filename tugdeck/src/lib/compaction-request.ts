/**
 * `compaction-request` — legacy fake-compaction replay recognition ([P06]).
 *
 * `/compact` now dispatches natively over the stream-json bridge and compacts
 * in place (same session, same JSONL) — the summarize/respawn/seed fork is
 * gone. But every session compacted the OLD way has `<!-- tug:compact-seed -->`
 * blocks (and possibly canceled `<!-- tug:compact-summarize -->` turns) baked
 * into its JSONL forever, so reload of those transcripts must keep working.
 * This module holds only the pure *recognition* helpers those legacy replays
 * need; the producers that once wrote the markers are deleted.
 */

/**
 * Marker on the first line of the (now-retired) summarization prompt — an HTML
 * comment claude ignored. Retained so the reload path recognizes a *canceled*
 * legacy compaction's throwaway summarization turn (which claude persisted to
 * the discarded session's JSONL) and drops it instead of committing a spurious
 * entry.
 */
const COMPACTION_SUMMARIZE_MARKER = "<!-- tug:compact-summarize -->";

/**
 * True when a replayed user-message text is a legacy summarization prompt — the
 * throwaway recap-request turn that must never commit to the transcript. Pure.
 */
export function isCompactionSummarizeText(text: string): boolean {
  return text.startsWith(COMPACTION_SUMMARIZE_MARKER);
}

/**
 * Marker on the first line of a legacy compaction seed block. An HTML comment
 * so claude ignored it in the prompt, and an exact literal so the client can
 * recognize the block in raw wire `content` on reload and render it as the
 * carry-forward summary instead of raw user text. Kept in lockstep with
 * {@link splitCompactionSeed}.
 */
const COMPACTION_SEED_MARKER = "<!-- tug:compact-seed -->";

/** The framing prose between the marker and the raw summary. */
const COMPACTION_SEED_FRAMING =
  "The earlier conversation was compacted to save context. Here is the " +
  "summary of everything so far — treat it as established context and " +
  "continue seamlessly:";

/**
 * Recover the raw summary from a legacy seed block, or `null` if `text` is not
 * a seed block. Strips the marker line and the framing so the recovered summary
 * matches the live `compactionSeed.summary` exactly (live == reload). Pure.
 */
export function splitCompactionSeed(text: string): string | null {
  const prefix = `${COMPACTION_SEED_MARKER}\n`;
  if (!text.startsWith(prefix)) return null;
  const body = text.slice(prefix.length);
  const framed = `${COMPACTION_SEED_FRAMING}\n\n`;
  return body.startsWith(framed) ? body.slice(framed.length) : body;
}
