import { describe, expect, it } from "bun:test";

import {
  RESTORE_SHEET_GATE_MS,
  restoreSheetRevealDelayMs,
} from "../dev-restore-sheet-gate";

// The reveal-gate decision (redux [P09]): a restore already past the gate
// presents immediately (delay 0); one under the gate arms a timer for the
// remaining time. Pure math — no timers, no DOM.
describe("restoreSheetRevealDelayMs", () => {
  it("returns the full gate when the restore just started", () => {
    expect(restoreSheetRevealDelayMs(0, RESTORE_SHEET_GATE_MS)).toBe(
      RESTORE_SHEET_GATE_MS,
    );
  });

  it("returns the remaining time when under the gate", () => {
    expect(restoreSheetRevealDelayMs(200, 500)).toBe(300);
  });

  it("returns 0 exactly at the gate (present now)", () => {
    expect(restoreSheetRevealDelayMs(500, 500)).toBe(0);
  });

  it("clamps to 0 past the gate (never negative)", () => {
    expect(restoreSheetRevealDelayMs(5000, 500)).toBe(0);
  });

  it("gate is the tightened 0.5 s threshold, not REPLAY_SOFT_BUDGET_MS", () => {
    expect(RESTORE_SHEET_GATE_MS).toBe(500);
  });
});
