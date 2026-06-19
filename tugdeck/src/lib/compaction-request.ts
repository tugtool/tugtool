/**
 * `compaction-request` — pure helpers for the `/compact` flow.
 *
 * `/compact` has no native trigger over the stream-json bridge (no
 * compaction control verb, no SDK method; slash commands aren't
 * dispatched headless). So Tug re-creates compaction: summarize the
 * current session, then continue in a *fresh* session seeded with the
 * summary (spike-verified — a fresh session given only the summary
 * recalls prior facts). This module holds the two pure pieces of that
 * flow; the stateful orchestration lives in the dev card and
 * `dev-session-restore`.
 */

/**
 * Build the summarization prompt sent to the current session before it
 * is compacted. `focus`, when present, is the user's `/compact <focus>`
 * argument — a steer on what to emphasize.
 *
 * The recap becomes the *entire* seed context of the next session, so it
 * is a self-contained handoff a fresh assistant can continue from — the
 * rich form, modeled on the Claude Code TUI's compact summary. It is
 * deliberately thorough (intent, technical concepts, files/code, errors
 * & fixes, current state, next step); the Dev card shows it under a
 * collapsible "Compaction Summary" affordance rather than trimming it.
 */
export function buildSummarizationPrompt(focus?: string): string {
  const base =
    "Please write a detailed, self-contained summary of our conversation " +
    "so far, so a fresh assistant with no other context could continue " +
    "seamlessly. Be thorough — capture, where applicable: the user's " +
    "primary requests and intent; key technical concepts, decisions, and " +
    "constraints; the specific files, identifiers, commands, and code " +
    "changes that matter; errors encountered and how they were resolved; " +
    "the current state of the work; and the next step. Preserve exact " +
    "names and facts over generalities. Write the summary as the entire " +
    "message.";
  const trimmed = focus?.trim() ?? "";
  if (trimmed.length === 0) return base;
  return `${base}\n\nGive particular attention to: ${trimmed}`;
}

/**
 * Marker on the first line of the compaction seed block. An HTML comment
 * so claude ignores it in the prompt, and an exact literal so the client
 * can recognize the block in raw wire `content` on reload and render it
 * as the carry-forward summary instead of raw user text. Kept in lockstep
 * with {@link buildCompactionSeed} / {@link splitCompactionSeed}.
 */
const COMPACTION_SEED_MARKER = "<!-- tug:compact-seed -->";

/** The framing prose between the marker and the raw summary. */
const COMPACTION_SEED_FRAMING =
  "The earlier conversation was compacted to save context. Here is the " +
  "summary of everything so far — treat it as established context and " +
  "continue seamlessly:";

/**
 * Frame the captured summary as the seed *block* — a leading text content
 * block that rides the user's first post-compact message on the wire (it
 * is never its own turn). The marker line lets the reload reconstruction
 * split it back off ({@link splitCompactionSeed}); the framing tells
 * claude this is established prior context.
 */
export function buildCompactionSeed(summary: string): string {
  return `${COMPACTION_SEED_MARKER}\n${COMPACTION_SEED_FRAMING}\n\n${summary}`;
}

/**
 * Recover the raw summary from a seed block produced by
 * {@link buildCompactionSeed}, or `null` if `text` is not a seed block.
 * Strips the marker line and the framing so the recovered summary matches
 * the live `compactionSeed.summary` exactly (live == reload). Pure.
 */
export function splitCompactionSeed(text: string): string | null {
  const prefix = `${COMPACTION_SEED_MARKER}\n`;
  if (!text.startsWith(prefix)) return null;
  const body = text.slice(prefix.length);
  const framed = `${COMPACTION_SEED_FRAMING}\n\n`;
  return body.startsWith(framed) ? body.slice(framed.length) : body;
}
