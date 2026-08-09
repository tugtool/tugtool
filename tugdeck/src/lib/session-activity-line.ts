/**
 * session-activity-line.ts — what a session's third line says at rest.
 *
 * The row was a placeholder much of the time it was on screen. These are facts
 * the ledger already holds and a reader actually wants: how much conversation
 * there has been, how big it has grown, when it last moved, and whether it is
 * open for another turn.
 *
 *   `7 turns, 48.2 KB. Last updated: Aug 9, 9:41 AM. Ready.`
 *
 * Every segment drops out when it has no value, so a session the scanner has
 * never seen does not print `0 turns` or an empty size. `Last updated:` is
 * labeled because a bare date-time beside a size and a count is ambiguous about
 * which of the three it dates.
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
  /** The engine's turn count. 0 drops the whole turns segment. */
  turnCount: number;
  /** On-disk JSONL size in bytes. `null` or 0 drops the size segment. */
  fileSize: number | null;
  /** When the session was last used, in ms. `null` drops the stamp. */
  lastUsedAtMs: number | null;
  /**
   * Whether a card is bound to this session.
   *
   * `Ready.` closes the line only when one is. A closed session in the picker
   * is not "ready" for anything — it is a file on disk — so its line ends after
   * the stamp.
   */
  hasCard: boolean;
}

/**
 * The activity line's rest form.
 *
 * The degenerate cases are deliberate, not accidents of the composition: with
 * nothing known and a card bound the line is exactly `Ready.`, and with nothing
 * known and no card it is the empty string. An empty line is honest for a
 * session there is nothing to say about — the description row above it carries
 * the creation stamp that keeps the row from looking hollow.
 */
export function sessionActivityRestLine(facts: SessionActivityFacts): string {
  const segments: string[] = [];

  const turns = facts.turnCount > 0 ? facts.turnCount : 0;
  if (turns > 0) {
    const size =
      facts.fileSize !== null && facts.fileSize > 0
        ? `, ${formatByteSize(facts.fileSize)}`
        : "";
    segments.push(`${turns} ${turns === 1 ? "turn" : "turns"}${size}.`);
  } else if (facts.fileSize !== null && facts.fileSize > 0) {
    // A size with no turns still says something true about the file, and the
    // grammar has to open with a capital rather than a bare `, 8 KB.`
    segments.push(`${formatByteSize(facts.fileSize)}.`);
  }

  // A session never used has nothing to date, so the stamp goes with the count
  // rather than standing alone beside a size.
  if (turns > 0 && facts.lastUsedAtMs !== null) {
    segments.push(`Last updated: ${formatRestingStamp(facts.lastUsedAtMs)}.`);
  }

  if (facts.hasCard) segments.push("Ready.");

  return segments.join(" ");
}
