/**
 * `compaction` — pure presentation helper for the transcript's
 * compaction divider.
 *
 * A `compact_boundary` frame (in practice: claude's auto-compaction at
 * capacity) becomes a `system_note` with `source: "compact"` in the
 * active turn. This derives the divider's text from the frame's
 * pre-compaction token count. The divider deliberately mirrors the
 * *terminal's* compaction indicator — a soft separator — not the raw
 * "This session is being continued…" summary block, which Claude Code's
 * own UI (and tugcode's replay translator) hide.
 */

/** Round a token count to a compact `~Nk tokens` / `N tokens` label. */
function formatTokensApprox(tokens: number): string {
  if (tokens >= 1000) return `~${Math.round(tokens / 1000)}k tokens`;
  return `${tokens} tokens`;
}

/**
 * Divider text for a compaction `system_note`. Includes the
 * pre-compaction context size when claude reported it; a bare
 * "Conversation compacted" otherwise.
 */
export function compactionNoteText(preTokens?: number): string {
  if (typeof preTokens === "number" && preTokens > 0) {
    return `Conversation compacted · ${formatTokensApprox(preTokens)}`;
  }
  return "Conversation compacted";
}
