/**
 * resting-line — unit tests for the two readings a quiet session gets.
 *
 * The clock's exact string is locale- and timezone-dependent, so what is
 * pinned here is the SHAPE: which reading each input produces, that a real
 * beat is never rewritten, and that the same-day clock is shorter than the
 * one that has to name the day.
 */

import { describe, expect, test } from "bun:test";

import {
  completedRestingLine,
  createdRestingLine,
  formatRestingClock,
  restingActivityText,
  TURN_DONE_MARKER,
} from "../resting-line";

const NOW = new Date(2026, 6, 30, 16, 12);
const EARLIER_TODAY = new Date(2026, 6, 30, 9, 3).getTime();
const LAST_MONTH = new Date(2026, 5, 17, 6, 11).getTime();

describe("formatRestingClock", () => {
  test("a time on today's calendar day needs no date", () => {
    const clock = formatRestingClock(EARLIER_TODAY, NOW);
    expect(clock).not.toMatch(/\d{1,2}\D+\d{1,2}\D+\d/);
    expect(clock.length).toBeLessThan(
      formatRestingClock(LAST_MONTH, NOW).length,
    );
  });

  test("a time on another day carries the day, so `6:11 AM` is not a lie", () => {
    // A resumed session may have been created weeks ago; the clock alone
    // would claim it was this morning.
    expect(formatRestingClock(LAST_MONTH, NOW)).not.toBe(
      formatRestingClock(new Date(2026, 6, 30, 6, 11).getTime(), NOW),
    );
  });

  test("the same instant a year apart reads differently", () => {
    const lastYear = new Date(2025, 6, 30, 16, 12).getTime();
    expect(formatRestingClock(lastYear, NOW)).not.toBe(
      formatRestingClock(NOW.getTime(), NOW),
    );
  });
});

describe("the two resting readings", () => {
  test("a finished turn is dated and closes on Ready", () => {
    const line = completedRestingLine(EARLIER_TODAY, NOW);
    expect(line.startsWith("Completed at ")).toBe(true);
    expect(line.endsWith(". Ready.")).toBe(true);
    expect(line).toContain(formatRestingClock(EARLIER_TODAY, NOW));
  });

  test("a session that never spoke is dated from its creation", () => {
    const line = createdRestingLine(LAST_MONTH, NOW);
    expect(line.startsWith("Created at ")).toBe(true);
    expect(line.endsWith(". Ready.")).toBe(true);
    expect(line).toContain(formatRestingClock(LAST_MONTH, NOW));
  });

  test("an unknown creation time still says what the state is", () => {
    // The window before the ledger answers: the row is ready, and honest
    // about not being able to date it.
    expect(createdRestingLine(null, NOW)).toBe("Ready.");
  });
});

describe("restingActivityText — which lines get rewritten", () => {
  test("no beat at all reads as the created line", () => {
    expect(restingActivityText(null, LAST_MONTH, NOW)).toBe(
      createdRestingLine(LAST_MONTH, NOW),
    );
  });

  test("the turn-end marker reads as the completed line, dated by the beat", () => {
    expect(
      restingActivityText(
        { text: TURN_DONE_MARKER, atMs: EARLIER_TODAY },
        LAST_MONTH,
        NOW,
      ),
    ).toBe(completedRestingLine(EARLIER_TODAY, NOW));
  });

  test("the completion is dated by the BEAT, never by the session", () => {
    const byBeat = restingActivityText(
      { text: TURN_DONE_MARKER, atMs: EARLIER_TODAY },
      LAST_MONTH,
      NOW,
    );
    expect(byBeat).not.toContain(formatRestingClock(LAST_MONTH, NOW));
  });

  test("anything the voice actually said passes through untouched", () => {
    for (const text of [
      "Reading src/main.tsx",
      "Stopped",
      "Compacted context (was 142k)",
      "Done deal",
    ]) {
      expect(
        restingActivityText({ text, atMs: EARLIER_TODAY }, LAST_MONTH, NOW),
      ).toBe(text);
    }
  });
});
