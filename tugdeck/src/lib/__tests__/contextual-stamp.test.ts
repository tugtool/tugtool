/**
 * Context-aware stamps — the clock alone within today, and the day
 * named the way a person says it (`Yesterday`, `Monday`, `Aug 4`,
 * `Aug 4, 2025`) on every other day.
 *
 * Assertions are written against the platform's own locale output
 * (`toLocaleDateString` / `toLocaleTimeString`) rather than a hardcoded
 * `"Aug 6, 7:16 PM"`, so the suite says what it means on any machine
 * locale: what's under test is which PARTS a stamp carries, not how the
 * ICU data spells a month or a weekday.
 */

import { describe, expect, it } from "bun:test";
import {
  contextualDayPart,
  formatContextualStamp,
  isSameLocalDay,
} from "@/lib/contextual-stamp";

const at = (
  y: number,
  m: number,
  d: number,
  h = 12,
  min = 0,
  s = 0,
): number => new Date(y, m - 1, d, h, min, s).getTime();

describe("isSameLocalDay", () => {
  it("is the local calendar day, not a 24-hour window", () => {
    const lateLastNight = new Date(at(2026, 8, 6, 23, 50));
    const earlyToday = new Date(at(2026, 8, 7, 0, 5));
    expect(isSameLocalDay(lateLastNight, earlyToday)).toBe(false);
    expect(
      isSameLocalDay(new Date(at(2026, 8, 7, 0, 1)), new Date(at(2026, 8, 7, 23, 59))),
    ).toBe(true);
  });
});

describe("contextualDayPart", () => {
  // 2026-08-07 is a Friday.
  const now = new Date(at(2026, 8, 7, 19));

  it("is absent for today", () => {
    expect(contextualDayPart(new Date(at(2026, 8, 7, 9)), now)).toBeNull();
  });

  it("says Yesterday for the previous calendar day, however recent", () => {
    expect(contextualDayPart(new Date(at(2026, 8, 6, 2)), now)).toBe("Yesterday");
    // 20 minutes old, and still yesterday — the rule is the calendar day.
    expect(
      contextualDayPart(new Date(at(2026, 8, 6, 23, 50)), new Date(at(2026, 8, 7, 0, 10))),
    ).toBe("Yesterday");
  });

  it("names the weekday for the rest of the last week", () => {
    // Six days back is the furthest a weekday stays unambiguous: seven
    // would name today's own weekday.
    for (const day of [5, 4, 3, 2, 1]) {
      const when = new Date(at(2026, 8, day, 19));
      expect(contextualDayPart(when, now)).toBe(
        when.toLocaleDateString(undefined, { weekday: "long" }),
      );
    }
  });

  it("switches to the calendar date at a week out, and adds the year past one", () => {
    const weekOut = new Date(at(2026, 7, 31, 19)); // 7 days back — today's weekday again
    const olderYear = new Date(at(2025, 8, 6, 19));
    expect(contextualDayPart(weekOut, now)).toBe(
      weekOut.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
    expect(contextualDayPart(olderYear, now)).toBe(
      olderYear.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    );
  });

  it("gives a future stamp its date rather than a weekday", () => {
    // Clock skew, or a machine catching up on time: "Sunday" for a
    // stamp two days ahead would read as the Sunday just gone.
    const ahead = new Date(at(2026, 8, 9, 19));
    expect(contextualDayPart(ahead, now)).toBe(
      ahead.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
  });
});

describe("formatContextualStamp", () => {
  const now = at(2026, 8, 7, 19, 30);

  it("shows the clock alone for a stamp from today", () => {
    const when = at(2026, 8, 7, 7, 16, 15);
    expect(formatContextualStamp(when, { now })).toBe(
      new Date(when).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }),
    );
  });

  it("prefixes the day's name once the stamp is from another day", () => {
    // Same clock time on four different days: today's stamp is the
    // bare clock, and every older one is that same clock behind the
    // name its day goes by.
    const clock = formatContextualStamp(at(2026, 8, 7, 7, 16, 15), { now });
    const weekday = (ms: number): string =>
      new Date(ms).toLocaleDateString(undefined, { weekday: "long" });
    const cases: Array<[number, string]> = [
      [at(2026, 8, 6, 7, 16, 15), "Yesterday"],
      [at(2026, 8, 3, 7, 16, 15), weekday(at(2026, 8, 3))],
      [at(2026, 8, 1, 7, 16, 15), weekday(at(2026, 8, 1))],
      [
        at(2026, 7, 31, 7, 16, 15),
        new Date(at(2026, 7, 31)).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
      ],
    ];
    for (const [when, expected] of cases) {
      expect(formatContextualStamp(when, { now })).toBe(`${expected}, ${clock}`);
    }
  });

  it("adds seconds only when asked", () => {
    const when = at(2026, 8, 7, 7, 16, 15);
    expect(formatContextualStamp(when, { now })).toBe(
      formatContextualStamp(when, { now, seconds: false }),
    );
    expect(formatContextualStamp(when, { now, seconds: true }).length).toBeGreaterThan(
      formatContextualStamp(when, { now }).length,
    );
  });

  it("substitutes U+2236 RATIO for the ASCII colon on request", () => {
    const stamp = formatContextualStamp(at(2026, 8, 6, 7, 16, 15), {
      now,
      seconds: true,
      ratioSeparator: true,
    });
    expect(stamp).not.toContain(":");
    expect(stamp).toContain("∶");
  });

  it("returns the empty string for an unrecorded time", () => {
    expect(formatContextualStamp(0, { now })).toBe("");
    expect(formatContextualStamp(Number.NaN, { now })).toBe("");
    expect(formatContextualStamp(Number.POSITIVE_INFINITY, { now })).toBe("");
  });
});
