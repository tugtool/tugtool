/**
 * Pure-logic tests for the state-change row formatter. Pins the
 * popover's row-display contract:
 *
 *   - HH:MM:SS.mmm formatting (zero-padded each part)
 *   - phase / transport rendered verbatim
 *   - interrupt collapses to "yes" / "no"
 *   - Output object is frozen
 */

import { describe, it, expect } from "bun:test";

import {
  formatAtMs,
  formatStateChangeRow,
} from "@/lib/code-session-store/state-change-formatter";

/**
 * Tests inject this synthetic `Date` constructor so the local-time
 * formatting is deterministic without timezone wobble.
 */
function syntheticDate(parts: {
  hours: number;
  minutes: number;
  seconds: number;
  ms: number;
}): (ms: number) => Date {
  return () =>
    ({
      getHours: () => parts.hours,
      getMinutes: () => parts.minutes,
      getSeconds: () => parts.seconds,
      getMilliseconds: () => parts.ms,
    }) as Date;
}

describe("formatAtMs", () => {
  it("pads each part to its fixed width", () => {
    const text = formatAtMs(
      0,
      syntheticDate({ hours: 1, minutes: 2, seconds: 3, ms: 4 }),
    );
    expect(text).toBe("01:02:03.004");
  });

  it("renders large values without leading zeros", () => {
    const text = formatAtMs(
      0,
      syntheticDate({ hours: 23, minutes: 59, seconds: 58, ms: 999 }),
    );
    expect(text).toBe("23:59:58.999");
  });

  it("pads three-digit ms across the 10/100 boundaries", () => {
    expect(
      formatAtMs(
        0,
        syntheticDate({ hours: 12, minutes: 0, seconds: 0, ms: 7 }),
      ),
    ).toBe("12:00:00.007");
    expect(
      formatAtMs(
        0,
        syntheticDate({ hours: 12, minutes: 0, seconds: 0, ms: 70 }),
      ),
    ).toBe("12:00:00.070");
    expect(
      formatAtMs(
        0,
        syntheticDate({ hours: 12, minutes: 0, seconds: 0, ms: 700 }),
      ),
    ).toBe("12:00:00.700");
  });
});

describe("formatStateChangeRow", () => {
  it("collapses interruptInFlight=true to yes", () => {
    const formatted = formatStateChangeRow(
      {
        atMs: 0,
        phase: "submitting",
        transportState: "online",
        interruptInFlight: true,
      },
      syntheticDate({ hours: 9, minutes: 0, seconds: 0, ms: 0 }),
    );
    expect(formatted.interrupt).toBe("yes");
  });

  it("collapses interruptInFlight=false to no", () => {
    const formatted = formatStateChangeRow(
      {
        atMs: 0,
        phase: "idle",
        transportState: "online",
        interruptInFlight: false,
      },
      syntheticDate({ hours: 9, minutes: 0, seconds: 0, ms: 0 }),
    );
    expect(formatted.interrupt).toBe("no");
  });

  it("preserves phase + transportState verbatim", () => {
    const formatted = formatStateChangeRow(
      {
        atMs: 0,
        phase: "tool_work",
        transportState: "restoring",
        interruptInFlight: false,
      },
      syntheticDate({ hours: 9, minutes: 0, seconds: 0, ms: 0 }),
    );
    expect(formatted.phase).toBe("tool_work");
    expect(formatted.transportState).toBe("restoring");
  });

  it("packs the timestamp into atText", () => {
    const formatted = formatStateChangeRow(
      {
        atMs: 0,
        phase: "awaiting_approval",
        transportState: "online",
        interruptInFlight: false,
      },
      syntheticDate({ hours: 14, minutes: 30, seconds: 45, ms: 123 }),
    );
    expect(formatted.atText).toBe("14:30:45.123");
  });

  it("returns a frozen object", () => {
    const formatted = formatStateChangeRow(
      {
        atMs: 0,
        phase: "idle",
        transportState: "online",
        interruptInFlight: false,
      },
      syntheticDate({ hours: 0, minutes: 0, seconds: 0, ms: 0 }),
    );
    expect(Object.isFrozen(formatted)).toBe(true);
  });

  it("falls back to a real Date constructor when no injection given", () => {
    // Production-path smoke: don't assert specific local-time values
    // (would couple the test to the host's timezone) — just that the
    // output shape is valid and the timestamp matches the
    // HH:MM:SS.mmm pattern.
    const formatted = formatStateChangeRow({
      atMs: Date.now(),
      phase: "idle",
      transportState: "online",
      interruptInFlight: false,
    });
    expect(formatted.atText).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });
});
