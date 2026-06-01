/**
 * transcript-export.ts — serialize a dev-card transcript to an exportable
 * document ([#step-13c]).
 *
 * `/export` saves the current session's transcript to a file the user picks
 * via the macOS save panel. The export *content* is built here, client-side,
 * from the committed transcript we already hold (the same `TurnEntry[]` the
 * dev card renders) — the host bridge only owns the save panel + file write.
 *
 * Two formats, mirroring the terminal's export choices:
 *  - **Markdown** — a readable document: each turn as a `## You` prompt above
 *    the assistant's tool calls + prose (reusing {@link turnEntryToMarkdown},
 *    the exact per-row COPY serialization).
 *  - **JSON Lines** — one JSON object per transcript Message, in order: a
 *    faithful, machine-readable journal. Every line is independently
 *    `JSON.parse`-able.
 *
 * Pure data transforms — no React, no DOM, no store dependency.
 *
 * @module lib/transcript-export
 */

import type { TurnEntry } from "@/lib/code-session-store/types";
import { turnEntryToMarkdown } from "@/components/tugways/cards/turn-entry-markdown";

/** The export formats `/export` offers. */
export type ExportFormat = "markdown" | "jsonl";

/** The first `user_message` text in a turn, or `null` if it opens otherwise. */
function turnPrompt(turn: TurnEntry): string | null {
  for (const m of turn.messages) {
    if (m.kind === "user_message") return m.text;
  }
  return null;
}

/**
 * Render the whole transcript as a single markdown document: each turn's user
 * prompt under a `## You` heading, followed by the assistant's tool calls +
 * prose (via {@link turnEntryToMarkdown}) under `## Claude`. Turns with no
 * content on a side simply omit that heading; an empty transcript yields a
 * lone title.
 */
export function transcriptToMarkdown(
  transcript: ReadonlyArray<TurnEntry>,
): string {
  const sections: string[] = ["# Session transcript"];
  for (const turn of transcript) {
    const prompt = turnPrompt(turn);
    if (prompt !== null && prompt.trim().length > 0) {
      sections.push(`## You\n\n${prompt.trim()}`);
    }
    const assistant = turnEntryToMarkdown(turn);
    if (assistant.length > 0) {
      sections.push(`## Claude\n\n${assistant}`);
    }
  }
  return `${sections.join("\n\n")}\n`;
}

/**
 * Render the transcript as JSON Lines: one `JSON.stringify`'d Message per line,
 * in transcript order across every turn. A faithful journal — every Message
 * kind (prompts, prose, thinking, tool calls, system notes) is preserved. The
 * trailing newline keeps the file POSIX-clean. An empty transcript yields `""`.
 */
export function transcriptToJsonl(
  transcript: ReadonlyArray<TurnEntry>,
): string {
  const lines: string[] = [];
  for (const turn of transcript) {
    for (const message of turn.messages) {
      lines.push(JSON.stringify(message));
    }
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/** File extension for a format. */
export function exportExtension(format: ExportFormat): string {
  return format === "markdown" ? "md" : "jsonl";
}

/**
 * Suggested base filename (no extension) for an export. Includes a short slice
 * of the session id when known so multiple exports don't all collide on one
 * default name.
 */
export function exportBaseName(sessionId: string | null): string {
  if (sessionId === null || sessionId === "") return "tug-session";
  return `tug-session-${sessionId.slice(0, 8)}`;
}
