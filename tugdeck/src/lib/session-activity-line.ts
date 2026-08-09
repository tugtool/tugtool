/**
 * session-activity-line.ts — what a session's third line says at rest.
 *
 * The row was a placeholder much of the time it was on screen. These are facts
 * the ledger already holds and a reader actually wants: how much conversation
 * there has been, how big it has grown, when it last moved.
 *
 *   `7 turns, 48.2 KB. Last updated: Aug 9, 9:41 AM. Ready.`
 *
 * The turns segment always prints — a fresh session's line is
 * `0 turns, 8 KB. Ready.` and nothing more, because "no conversation yet" is a
 * fact worth a reader's glance, not an absence. Only genuinely unknown values
 * drop out: an unknown size drops its segment, and the labeled stamp appears
 * only for a session with turns to have been updated by. `Last updated:` is
 * labeled because a bare date-time beside a size and a count is ambiguous
 * about which of the three it dates. `Ready.` always closes the line — the
 * session is on disk and one gesture from another turn wherever the row is
 * read.
 *
 * **During a turn this line is not used at all** — the live beat replaces it,
 * with its own dwell pacing and middle truncation. This is the rest form only.
 *
 * Not `resting-line.ts`, which composes a different sentence (`Completed at …`)
 * for its own callers and stays as it is. This module borrows that module's
 * stamp formatter and the picker's byte formatter rather than re-deriving
 * either: two surfaces spelling one number two ways is the failure the shared
 * formatters exist to prevent.
 *
 * @module lib/session-activity-line
 */

import { formatByteSize } from "@/components/tugways/cards/session-picker-format";
import { formatRestingStamp } from "@/lib/pulse-line/resting-line";

/** The facts the rest line is made of — a `SessionRow`'s, or a fixture's. */
export interface SessionActivityFacts {
  /** The engine's turn count. Always printed, `0 turns` included. */
  turnCount: number;
  /** On-disk JSONL size in bytes. `null` or 0 drops the size segment. */
  fileSize: number | null;
  /** When the session was last used, in ms. `null` drops the stamp. */
  lastUsedAtMs: number | null;
}

/**
 * The activity line's rest form.
 *
 * `<turns> turns, <size>. Last updated: <stamp>. Ready.` — the stamp omitted
 * at zero turns (a session never used has nothing to date), the size omitted
 * when unknown, the turns and the closing `Ready.` always present.
 */
export function sessionActivityRestLine(facts: SessionActivityFacts): string {
  const segments: string[] = [];

  const turns = facts.turnCount > 0 ? facts.turnCount : 0;
  const size =
    facts.fileSize !== null && facts.fileSize > 0
      ? `, ${formatByteSize(facts.fileSize)}`
      : "";
  segments.push(`${turns} ${turns === 1 ? "turn" : "turns"}${size}.`);

  if (turns > 0 && facts.lastUsedAtMs !== null) {
    segments.push(`Last updated: ${formatRestingStamp(facts.lastUsedAtMs)}.`);
  }

  segments.push("Ready.");

  return segments.join(" ");
}
