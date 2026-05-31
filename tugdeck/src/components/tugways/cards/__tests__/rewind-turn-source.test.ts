/**
 * rewind-turn-source.test.ts — `/rewind` turn-picker projection ([#step-7-3]).
 *
 * Pins the pure projection: which turns become rows (targetable = user opener
 * + anchor), the `promptUuid` carriage, ordering, the `(current)` marker, and
 * the empty-state count that gates whether `/rewind` is offered.
 *
 * @module components/tugways/cards/__tests__/rewind-turn-source
 */

import { describe, expect, test } from "bun:test";

import {
  projectRewindTurns,
  canOfferRewind,
  RewindTurnDataSource,
} from "@/components/tugways/cards/rewind-turn-source";
import type { Message, TurnEntry } from "@/lib/code-session-store/types";
import { TURN_ENTRY_TELEMETRY_DEFAULTS } from "@/lib/code-session-store/testing/turn-entry-defaults";

function userTurn(
  turnKey: string,
  promptUuid: string | undefined,
  text: string,
  submitAt: number,
): TurnEntry {
  const opener: Message = {
    kind: "user_message",
    messageKey: `${turnKey}-user`,
    createdAt: submitAt,
    text,
    attachments: [],
    submitAt,
  };
  return {
    turnKey,
    msgId: `m-${turnKey}`,
    ...(promptUuid !== undefined ? { promptUuid } : {}),
    messages: [opener],
    result: "success",
    endedAt: submitAt + 1,
    ...TURN_ENTRY_TELEMETRY_DEFAULTS,
  };
}

function wakeTurn(turnKey: string): TurnEntry {
  // A wake turn opens with assistant content, no user_message.
  const opener: Message = {
    kind: "assistant_text",
    messageKey: `m-${turnKey}-b0`,
    createdAt: 0,
    text: "woke",
  };
  return {
    turnKey,
    msgId: `m-${turnKey}`,
    messages: [opener],
    result: "success",
    endedAt: 0,
    ...TURN_ENTRY_TELEMETRY_DEFAULTS,
  };
}

describe("projectRewindTurns", () => {
  test("excludes the first targetable turn (rewinding to it would empty the session)", () => {
    const rows = projectRewindTurns([
      userTurn("t1", "uuid-1", "first prompt", 100),
      userTurn("t2", "uuid-2", "second prompt", 200),
    ]);
    // Only turn 2 is a valid target — rewinding to it keeps turn 1.
    expect(rows).toEqual([
      { promptUuid: "uuid-2", turnKey: "t2", preview: "second prompt", submitAt: 200, isCurrent: true },
    ]);
  });

  test("preserves conversation order (oldest first), minus the first turn", () => {
    const rows = projectRewindTurns([
      userTurn("t1", "uuid-1", "a", 1),
      userTurn("t2", "uuid-2", "b", 2),
      userTurn("t3", "uuid-3", "c", 3),
    ]);
    expect(rows.map((r) => r.turnKey)).toEqual(["t2", "t3"]);
  });

  test("skips turns with no anchor (older / pre-[#step-7-1] sessions)", () => {
    // t1 anchorless → not targetable; t2/t3 targetable → t2 is the first
    // targetable (excluded), t3 is the valid row.
    const rows = projectRewindTurns([
      userTurn("t1", undefined, "no anchor", 1),
      userTurn("t2", "uuid-2", "has anchor", 2),
      userTurn("t3", "uuid-3", "also anchored", 3),
    ]);
    expect(rows.map((r) => r.promptUuid)).toEqual(["uuid-3"]);
  });

  test("skips wake turns (no user_message opener)", () => {
    const rows = projectRewindTurns([
      userTurn("t1", "uuid-1", "real", 1),
      userTurn("t2", "uuid-2", "real2", 2),
      wakeTurn("w1"),
    ]);
    expect(rows.map((r) => r.turnKey)).toEqual(["t2"]);
  });

  test("marks the last TARGETABLE turn current even when a wake turn trails", () => {
    const rows = projectRewindTurns([
      userTurn("t1", "uuid-1", "a", 1),
      userTurn("t2", "uuid-2", "b", 2),
      wakeTurn("w1"),
    ]);
    expect(rows.find((r) => r.isCurrent)?.turnKey).toBe("t2");
    expect(rows.filter((r) => r.isCurrent).length).toBe(1);
  });

  test("a single targetable turn projects to zero rows", () => {
    expect(projectRewindTurns([userTurn("t1", "uuid-1", "only", 1)])).toEqual([]);
  });

  test("empty transcript → no rows", () => {
    expect(projectRewindTurns([])).toEqual([]);
  });
});

describe("canOfferRewind (empty-state gating)", () => {
  test("false for 0- or 1-turn sessions; true once a valid target exists", () => {
    expect(canOfferRewind([])).toBe(false);
    expect(canOfferRewind([userTurn("t1", "uuid-1", "only", 1)])).toBe(false);
    expect(
      canOfferRewind([
        userTurn("t1", "uuid-1", "a", 1),
        userTurn("t2", "uuid-2", "b", 2),
      ]),
    ).toBe(true);
  });

  test("false when only one turn carries an anchor", () => {
    expect(
      canOfferRewind([
        userTurn("t1", "uuid-1", "a", 1),
        userTurn("t2", undefined, "b", 2),
      ]),
    ).toBe(false);
  });
});

describe("RewindTurnDataSource", () => {
  test("indexes rows by promptUuid and exposes them by index", () => {
    const rows = projectRewindTurns([
      userTurn("t1", "uuid-1", "a", 1),
      userTurn("t2", "uuid-2", "b", 2),
      userTurn("t3", "uuid-3", "c", 3),
    ]);
    const ds = new RewindTurnDataSource(rows);
    expect(ds.numberOfItems()).toBe(2);
    expect(ds.idForIndex(0)).toBe("uuid-2");
    expect(ds.kindForIndex()).toBe("rewind-turn");
    expect(ds.rowAt(1).preview).toBe("c");
  });
});
