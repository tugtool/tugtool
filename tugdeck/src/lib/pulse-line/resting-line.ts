/**
 * resting-line.ts — what the PULSE's activity level says when the session
 * is not saying anything.
 *
 * A session at rest has two ways of getting there, and they are different
 * readings:
 *
 *  - it finished a turn. The voice's last beat is the bare marker `Done`
 *    ({@link TURN_DONE_MARKER}, written by `tugcode/src/pulse/voice.ts`'s
 *    `onTurnEnd`), which is a good wire marker and a poor thing to read off
 *    a rail — it says the run ended and nothing about when, and it sits
 *    there unchanged for however long the session stays quiet.
 *  - it has never spoken at all. Nothing has happened since it was made.
 *
 * Both become a sentence with a time in it and the same closing word:
 * `Completed at 4:12 PM. Ready.` / `Created at Jun 17, 6:11 AM. Ready.` The
 * time is what turns a stale-looking line into a fact — a row that says
 * `Done` reads the same after five seconds and five hours — and `Ready.`
 * is what the state actually is, said in the same breath.
 *
 * The clock is short for today and carries the date otherwise, because a
 * resumed session may have been created weeks ago and `6:11 AM` alone would
 * be a lie about which morning.
 *
 * @module lib/pulse-line/resting-line
 */

/**
 * The turn-end beat, verbatim as the voice emits it. Recognized here rather
 * than rewritten upstream: the marker is what the ledger, the history
 * popover, and a copied line carry, and only the resting reading changes.
 */
export const TURN_DONE_MARKER = "Done";

/** The word every resting line closes on — the state, not the history. */
const READY = "Ready.";

/**
 * Wall clock for a resting line: `4:12 PM` when the timestamp is on `now`'s
 * calendar day, `Jun 17, 6:11 AM` when it is not. Locale-formatted, so a
 * 24-hour locale gets its own clock.
 */
export function formatRestingClock(atMs: number, now: Date): string {
  const at = new Date(atMs);
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return at.toLocaleString(
    undefined,
    sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  );
}

/**
 * The resting reading for a session whose last beat was the turn-end marker.
 * `atMs` is that beat's own timestamp, so the sentence dates the completion
 * rather than the render.
 */
export function completedRestingLine(atMs: number, now: Date): string {
  return `Completed at ${formatRestingClock(atMs, now)}. ${READY}`;
}

/**
 * The resting reading for a session that has said nothing yet — the state
 * the Lens shows for the whole life of a session nobody has prompted.
 *
 * A null `createdAtMs` is the window before the session ledger answers. The
 * line still reads as the state it is; it just cannot date it yet.
 */
export function createdRestingLine(
  createdAtMs: number | null,
  now: Date,
): string {
  if (createdAtMs === null) return READY;
  return `Created at ${formatRestingClock(createdAtMs, now)}. ${READY}`;
}

/**
 * The activity string a row should show, given the latest beat's text and
 * timestamp (both null when the session has never spoken) and the session's
 * creation time.
 *
 * Every beat but the turn-end marker passes through untouched: the resting
 * reading replaces the two lines that describe an absence, and nothing the
 * voice actually said.
 */
export function restingActivityText(
  latest: { text: string; atMs: number } | null,
  createdAtMs: number | null,
  now: Date,
): string {
  if (latest === null) return createdRestingLine(createdAtMs, now);
  if (latest.text === TURN_DONE_MARKER) {
    return completedRestingLine(latest.atMs, now);
  }
  return latest.text;
}
