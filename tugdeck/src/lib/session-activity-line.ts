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
 * `No turns, 8 KB. Ready.` and nothing more, because "no conversation yet" is a
 * fact worth a reader's glance, not an absence. It is spelled `No turns` rather
 * than `0 turns`: the segment is prose, and a leading zero reads as a
 * measurement that came back empty. Only genuinely unknown values
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
import {
  formatRestingStamp,
  TURN_DONE_MARKER,
} from "@/lib/pulse-line/resting-line";

/** The facts the rest line is made of — a `SessionRow`'s, or a fixture's. */
export interface SessionActivityFacts {
  /** The engine's turn count. Always printed; zero reads `No turns`. */
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
  // `No turns`, never `0 turns`: the count is prose here, and a leading zero
  // reads as a measurement that came back empty rather than as a session
  // waiting for its first prompt.
  const count =
    turns === 0 ? "No turns" : `${turns} ${turns === 1 ? "turn" : "turns"}`;
  segments.push(`${count}${size}.`);

  if (turns > 0 && facts.lastUsedAtMs !== null) {
    segments.push(`Last updated: ${formatRestingStamp(facts.lastUsedAtMs)}.`);
  }

  segments.push("Ready.");

  return segments.join(" ");
}

/**
 * A beat worth putting on the activity line, or `null`.
 *
 * There is exactly one line the voice emits that is not news: the bare
 * turn-end marker `Done` ({@link TURN_DONE_MARKER}, written by the voice's
 * `onTurnEnd`). It is a fine wire marker and a poor thing to read off a row —
 * it says a run ended and nothing about when, and it sits there unchanged for
 * however long the session then stays quiet. It is also, precisely, the state
 * the REST SENTENCE describes, which says the same thing with the facts in it
 * and appears nowhere in the gallery as the word `Done`.
 *
 * So the marker is not shown, and the surfaces that show a beat call this on
 * the way in. Recognized here rather than suppressed upstream: the marker is
 * what the ledger, the recent-pulses popover, and a copied line carry, and
 * only this reading changes.
 */
export function sessionActivityBeat<T extends { text: string }>(
  beat: T | null,
): T | null {
  if (beat === null) return null;
  return beat.text.trim() === TURN_DONE_MARKER ? null : beat;
}
