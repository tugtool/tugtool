/**
 * Context-aware wall-clock stamps for rows that carry a time.
 *
 * A stamp is read against the moment the reader is reading it, and it
 * names the day the way a person would say it out loud:
 *
 * | when                    | stamp                    |
 * | ----------------------- | ------------------------ |
 * | today                   | `7∶16 PM`                |
 * | yesterday               | `Yesterday, 7∶16 PM`     |
 * | within the last week    | `Monday, 7∶16 PM`        |
 * | earlier this year       | `Aug 4, 7∶16 PM`         |
 * | another year            | `Aug 4, 2025, 7∶16 PM`   |
 *
 * Within today the date is noise — the clock alone says everything.
 * Past that, the clock alone is a lie by omission: `7∶16 PM` on a row
 * written last week reads as this evening. A weekday carries the near
 * past better than a numeric date does ("Monday" is a day you
 * remember; "Aug 4" is one you have to work out), but it only stays
 * unambiguous for six days, after which the calendar date takes over.
 *
 * "Same day" is the reader's LOCAL calendar day, not a 24-hour window:
 * a row from 11:50 PM last night is `Yesterday` at 12:05 AM, even
 * though it is fifteen minutes old. A stamp from the future (clock
 * skew, a machine catching up on time) gets the calendar date rather
 * than a cheerful "Tomorrow".
 */

export interface ContextualStampOptions {
  /** Include seconds in the clock portion. Default `false`. */
  seconds?: boolean;
  /**
   * Render the hour separator as U+2236 RATIO (`∶`) rather than the
   * ASCII colon. The RATIO glyph is vertically centered between the
   * digits the way clock-display fonts render the time separator —
   * most text fonts paint the ASCII colon anchored to the baseline,
   * which reads as "too low" between numerals. The substitution is
   * portable across fonts (it's a different character, not a
   * `font-feature-settings` toggle that many fonts don't ship), and
   * pairs cleanly with `font-variant-numeric: tabular-nums`.
   *
   * Only an ASCII `:` is substituted — locales that emit a different
   * separator (some European locales use `.`) pass through unchanged.
   */
  ratioSeparator?: boolean;
  /** The reading moment, in epoch ms. Defaults to now. */
  now?: number;
}

const DAY_MS = 86_400_000;

/** Whether two instants fall on the same local calendar day. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Whole local calendar days from `when`'s day to `now`'s day. Positive
 * for the past, negative for the future, `0` for today.
 *
 * Computed between the two days' local midnights, so the answer is a
 * count of date changes rather than of elapsed hours — a DST shift
 * inside the span cannot round it off by one.
 */
function localDayDelta(when: Date, now: Date): number {
  const midnight = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(now) - midnight(when)) / DAY_MS);
}

/**
 * How a stamp names its day when read at `now`, or `null` for today —
 * which needs no name at all.
 *
 * `Yesterday` and the weekday are the near past as a person says it;
 * everything older is the calendar date, carrying its year once that
 * differs from the reading year so a stamp can never be mistaken for a
 * nearer one.
 */
export function contextualDayPart(when: Date, now: Date): string | null {
  const delta = localDayDelta(when, now);
  if (delta === 0) return null;
  if (delta === 1) return "Yesterday";
  if (delta > 1 && delta < 7) {
    return when.toLocaleDateString(undefined, { weekday: "long" });
  }
  return when.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(when.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/**
 * Format an absolute millisecond timestamp for display beside a row:
 * the clock alone within today, the day's name ahead of it otherwise.
 *
 * Returns the empty string for the sentinel `0` and for any
 * non-finite input, so a callsite can pass an unrecorded time
 * unconditionally without fabricating a "Jan 1 1970" stamp.
 */
export function formatContextualStamp(
  ms: number,
  options: ContextualStampOptions = {},
): string {
  if (ms === 0 || !Number.isFinite(ms)) return "";
  const when = new Date(ms);
  if (Number.isNaN(when.getTime())) return "";
  const now = options.now !== undefined ? new Date(options.now) : new Date();
  let clock = when.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(options.seconds === true ? { second: "2-digit" } : {}),
  });
  if (options.ratioSeparator === true) clock = clock.replace(/:/g, "∶");
  const day = contextualDayPart(when, now);
  return day === null ? clock : `${day}, ${clock}`;
}
