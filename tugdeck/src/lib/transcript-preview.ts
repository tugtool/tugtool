/**
 * transcript-preview.ts — cheap plain-text preview of a turn.
 *
 * The always-painted tier of the two-tier transcript render. Every row
 * is mounted with a CHEAP cell — a single block of this preview text —
 * so a fast wheel or a thumb-drag never lands on an empty row: the
 * preview is plain text with no markdown parse, no syntax highlighting,
 * and no per-tool components, so it paints in well under a frame even
 * when the browser has deferred the row's paint. Rows in the visible
 * window upgrade to the rich rendering on top of this; everything else
 * stays cheap.
 *
 * Pure data transform — no React, no DOM. Bounded output (a hard char
 * cap) so the cheap cell is light regardless of how large the turn is.
 *
 * @module lib/transcript-preview
 */

import type { Message } from "@/lib/code-session-store/types";

/**
 * Hard cap on preview length. The cheap cell only needs enough readable
 * text to orient the reader mid-scroll; the rich tier carries the full
 * content. Capping keeps the always-mounted cheap layer light at any
 * turn size.
 */
export const PREVIEW_CHAR_CAP = 400;

/** Separator between a turn's parts in the flattened preview. */
const PART_SEPARATOR = "  ·  ";

/**
 * Input fields, in priority order, whose value is a useful one-line hint
 * for a tool call (the path read, the command run, the pattern matched).
 * Cheap string lookups only — no per-tool schema knowledge.
 */
const TOOL_HINT_FIELDS = [
  "file_path",
  "path",
  "command",
  "pattern",
  "query",
  "url",
  "prompt",
] as const;

/**
 * A short, cheap hint for a tool call: `${toolName} ${firstStringField}`,
 * or just the tool name when no recognized field carries a string.
 */
function toolHint(toolName: string, input: unknown): string {
  if (input !== null && typeof input === "object") {
    const record = input as Record<string, unknown>;
    for (const field of TOOL_HINT_FIELDS) {
      const value = record[field];
      if (typeof value === "string" && value.trim().length > 0) {
        return `${toolName} ${value.trim()}`;
      }
    }
  }
  return toolName;
}

/**
 * Flatten a turn's Message sequence to a cheap, bounded plain-text
 * preview. Prose (`assistant_text`), the user prompt, and system notes
 * contribute their text; top-level tool calls contribute a one-line
 * hint; thinking blocks are omitted (they are not the turn's payload).
 * Subagent (nested) tool calls are skipped — they belong to their
 * parent's preview, not the transcript row. Output is whitespace-
 * collapsed and capped at {@link PREVIEW_CHAR_CAP}.
 */
export function previewTextForMessages(
  messages: ReadonlyArray<Message>,
): string {
  const parts: string[] = [];
  for (const message of messages) {
    switch (message.kind) {
      case "user_message":
      case "assistant_text":
      case "system_note": {
        const text = message.text.trim();
        if (text.length > 0) parts.push(text);
        break;
      }
      case "tool_use": {
        // Top-level calls only; nested subagent calls render inside
        // their parent, not as their own preview line.
        if (message.parentToolUseId === undefined) {
          parts.push(toolHint(message.toolName, message.input));
        }
        break;
      }
      case "assistant_thinking":
        // Omitted from the cheap preview — not the turn's payload.
        break;
    }
    // Early-out once we have more than enough to fill the cap; avoids
    // walking a huge tool-heavy turn just to throw the tail away.
    if (parts.join(PART_SEPARATOR).length >= PREVIEW_CHAR_CAP) break;
  }
  const joined = parts.join(PART_SEPARATOR).replace(/\s+/g, " ").trim();
  return joined.length > PREVIEW_CHAR_CAP
    ? `${joined.slice(0, PREVIEW_CHAR_CAP).trimEnd()}…`
    : joined;
}
