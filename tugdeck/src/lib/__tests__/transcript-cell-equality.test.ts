/**
 * Memoization-gate tests for transcript cells —
 * `sameTranscriptRowData` / `transcriptCellPropsEqual` from the
 * transcript data source.
 *
 * The [R02] pin: finalized rows (stable `TurnEntry` references) memo
 * out of re-renders; the in-flight row (fresh `activeTurn` projection
 * per snapshot) and the streaming→finalized flip always re-render;
 * any non-row prop identity change re-renders. Memo hits feed the
 * `memoHits` counter the perf waterfall reports.
 */

import { afterEach, describe, expect, test } from "bun:test";

import {
  sameTranscriptRowData,
  transcriptCellPropsEqual,
  type DevRowDescriptor,
} from "@/lib/dev-transcript-data-source";
import {
  resetRowParseCounters,
  snapshotRowParseCounters,
} from "@/lib/markdown/parse-counters";
import { turnEntry, userMessage } from "@/lib/code-session-store/__tests__/_helpers/messages";

afterEach(() => {
  resetRowParseCounters();
});

function committedRow(turnKey: string): DevRowDescriptor {
  const turn = turnEntry({
    turnKey,
    msgId: `msg-${turnKey}`,
    messages: [userMessage({ turnKey, text: "hi" })],
  });
  return { kind: "assistant", turn, perTurnTokens: 12, turnKey };
}

describe("sameTranscriptRowData", () => {
  test("identical committed row data compares equal", () => {
    const row = committedRow("t1");
    // A second descriptor over the SAME TurnEntry reference — what a
    // fresh snapshot produces for an untouched committed row.
    const again: DevRowDescriptor = { ...row };
    expect(sameTranscriptRowData(row, again)).toBe(true);
  });

  test("the streaming→finalized flip compares unequal (turn appears)", () => {
    const inflight: DevRowDescriptor = {
      kind: "assistant",
      activeTurn: { turnKey: "t1" } as DevRowDescriptor["activeTurn"],
      turnKey: "t1",
    };
    const committed = committedRow("t1");
    expect(sameTranscriptRowData(inflight, committed)).toBe(false);
  });

  test("a fresh activeTurn projection compares unequal (live row stays live)", () => {
    const a: DevRowDescriptor = {
      kind: "assistant",
      activeTurn: { turnKey: "t1" } as DevRowDescriptor["activeTurn"],
      turnKey: "t1",
    };
    const b: DevRowDescriptor = {
      ...a,
      activeTurn: { turnKey: "t1" } as DevRowDescriptor["activeTurn"],
    };
    expect(sameTranscriptRowData(a, b)).toBe(false);
  });

  test("perTurnTokens change compares unequal", () => {
    const row = committedRow("t1");
    expect(
      sameTranscriptRowData(row, { ...row, perTurnTokens: 99 }),
    ).toBe(false);
  });
});

describe("transcriptCellPropsEqual", () => {
  const store = { stable: true };

  test("stable props + equal row data → equal, counted as a memo hit", () => {
    const row = committedRow("t1");
    const prev = { index: 3, id: "t1-assistant", kind: "assistant", store, row };
    const next = { ...prev, row: { ...row } };

    expect(transcriptCellPropsEqual(prev, next)).toBe(true);
    expect(snapshotRowParseCounters().memoHits).toBe(1);
  });

  test("a changed non-row prop re-renders (no memo hit)", () => {
    const row = committedRow("t1");
    const prev = { index: 3, id: "t1-assistant", kind: "assistant", store, row };
    const next = { ...prev, store: { stable: true } };

    expect(transcriptCellPropsEqual(prev, next)).toBe(false);
    expect(snapshotRowParseCounters().memoHits).toBe(0);
  });

  test("changed row data re-renders (no memo hit)", () => {
    const prev = {
      index: 3,
      id: "t1-assistant",
      kind: "assistant",
      store,
      row: committedRow("t1"),
    };
    const next = { ...prev, row: committedRow("t1") };
    // Two committedRow calls mint distinct TurnEntry references —
    // the "this row's data changed" shape.
    expect(transcriptCellPropsEqual(prev, next)).toBe(false);
    expect(snapshotRowParseCounters().memoHits).toBe(0);
  });
});
