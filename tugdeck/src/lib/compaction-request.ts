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
 * argument — a steer on what to emphasize. The prompt asks for a
 * self-contained recap a fresh assistant can continue from, since that
 * recap becomes the entire seed context of the next session.
 */
export function buildSummarizationPrompt(focus?: string): string {
  const base =
    "Please write a concise, self-contained recap of our conversation so " +
    "far — the goals, decisions, key facts, and where we are — so a fresh " +
    "assistant with no other context could continue seamlessly. Write the " +
    "recap as the entire message.";
  const trimmed = focus?.trim() ?? "";
  if (trimmed.length === 0) return base;
  return `${base}\n\nGive particular attention to: ${trimmed}`;
}

/**
 * Frame the captured summary as the seed message for the fresh session.
 * Sent as the new session's first turn; the transcript renders it as the
 * compaction divider (the raw text stays in claude's context, not on
 * screen). The framing tells claude this is established prior context.
 */
export function buildCompactionSeed(summary: string): string {
  return (
    "The earlier conversation was compacted to save context. Here is the " +
    "summary of everything so far — treat it as established context and " +
    "continue seamlessly:\n\n" +
    summary
  );
}
