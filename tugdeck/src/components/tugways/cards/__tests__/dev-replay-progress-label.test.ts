/**
 * Pure-logic coverage for the replay progress strip's derived view —
 * label plus the determinate `{value, max}` pair the
 * `TugProgressIndicator` bar consumes.
 */

import { describe, expect, test } from "bun:test";

import {
  deriveReplayProgress,
  formatReplayProgressValue,
} from "../dev-replay-progress";

describe("deriveReplayProgress", () => {
  test("full metadata: determinate from t=0 with the title in the label", () => {
    expect(
      deriveReplayProgress(0, { title: "Fix resume perf", turnCount: 106 }),
    ).toEqual({ label: "Restoring “Fix resume perf”…", value: 0, max: 106 });
  });

  test("ticks the committed count against the total", () => {
    expect(deriveReplayProgress(42, { title: null, turnCount: 106 })).toEqual({
      label: "Restoring session…",
      value: 42,
      max: 106,
    });
  });

  test("clamps an overshooting count to the advertised total", () => {
    // The ledger total can lag the JSONL (turns committed after the
    // row was written) — never report 108 of 106.
    expect(deriveReplayProgress(108, { title: null, turnCount: 106 })).toEqual({
      label: "Restoring session…",
      value: 106,
      max: 106,
    });
  });

  test("no metadata: indeterminate, count folds into the label", () => {
    expect(deriveReplayProgress(0, undefined)).toEqual({
      label: "Restoring session…",
      value: null,
      max: null,
    });
    expect(deriveReplayProgress(7, undefined)).toEqual({
      label: "Restoring session — 7 turns…",
      value: null,
      max: null,
    });
  });

  test("empty title and zero total fall back cleanly", () => {
    expect(deriveReplayProgress(3, { title: "", turnCount: 0 })).toEqual({
      label: "Restoring session — 3 turns…",
      value: null,
      max: null,
    });
  });
});

describe("formatReplayProgressValue", () => {
  test("reads as a localized turn count", () => {
    expect(formatReplayProgressValue(465, 4904)).toBe(
      `${(465).toLocaleString()} of ${(4904).toLocaleString()} turns`,
    );
  });
});
