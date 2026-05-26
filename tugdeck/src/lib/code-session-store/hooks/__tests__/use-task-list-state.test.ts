/**
 * Pure-logic tests for `useTaskListState`'s turn-scoping helpers. The
 * hook itself wraps `useSyncExternalStore` + `useMemo` which are
 * React's responsibility; we pin the two pure helpers that decide
 * whether the popover is empty: `selectLatestTurnMessages` and
 * `hasTaskEvent`. Higher-level coverage exercises the end-to-end
 * scoping behavior.
 */

import { describe, expect, test } from "bun:test";

import {
  hasTaskEvent,
  selectLatestTurnMessages,
} from "@/lib/code-session-store/hooks/use-task-list-state";
import type {
  Message,
  ToolUseMessage,
  TurnEntry,
} from "@/lib/code-session-store/types";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function taskUse(
  toolName: string,
  status: "pending" | "done" | "error" = "done",
): ToolUseMessage {
  return {
    kind: "tool_use",
    messageKey: `mk-${toolName}-${status}`,
    createdAt: 0,
    toolUseId: `tu-${toolName}-${status}`,
    toolName,
    input: { subject: "x" },
    status,
    result: null,
    structuredResult: null,
    toolWallMs: null,
  };
}

function userMsg(): Message {
  return {
    kind: "user_message",
    messageKey: "mk-user",
    createdAt: 0,
    text: "hi",
    attachments: [],
    submitAt: 0,
  } as Message;
}

function turn(turnKey: string, messages: ReadonlyArray<Message>): TurnEntry {
  return { turnKey, msgId: turnKey, messages } as unknown as TurnEntry;
}

// ---------------------------------------------------------------------------
// hasTaskEvent
// ---------------------------------------------------------------------------

describe("hasTaskEvent", () => {
  test("returns false for an empty array", () => {
    expect(hasTaskEvent([])).toBe(false);
  });

  test("returns false when no tool_use is a Task* call", () => {
    expect(
      hasTaskEvent([userMsg(), taskUse("Bash"), taskUse("Write")]),
    ).toBe(false);
  });

  test("returns true for any TaskCreate (case-insensitive)", () => {
    expect(hasTaskEvent([taskUse("TaskCreate")])).toBe(true);
    expect(hasTaskEvent([taskUse("taskcreate")])).toBe(true);
    expect(hasTaskEvent([taskUse("TASKCREATE")])).toBe(true);
  });

  test("returns true for any TaskUpdate (case-insensitive)", () => {
    expect(hasTaskEvent([taskUse("TaskUpdate")])).toBe(true);
    expect(hasTaskEvent([taskUse("taskupdate")])).toBe(true);
  });

  test("non-terminal Task* still counts — we want to show the batch as soon as it streams", () => {
    expect(hasTaskEvent([taskUse("TaskCreate", "pending")])).toBe(true);
  });

  test("mixed: any Task* in the array suffices", () => {
    expect(
      hasTaskEvent([userMsg(), taskUse("Bash"), taskUse("TaskCreate")]),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// selectLatestTurnMessages
// ---------------------------------------------------------------------------

describe("selectLatestTurnMessages", () => {
  test("returns null for an empty transcript with no in-flight", () => {
    expect(selectLatestTurnMessages([], null)).toBe(null);
  });

  test("returns in-flight messages when active, even if transcript has turns", () => {
    const inflight: Message[] = [userMsg()];
    const t1 = turn("t1", [taskUse("TaskCreate")]);
    expect(selectLatestTurnMessages([t1], inflight)).toBe(inflight);
  });

  test("returns the most-recent committed turn's messages when no in-flight", () => {
    const t1 = turn("t1", [taskUse("TaskCreate")]);
    const t2 = turn("t2", [userMsg()]);
    expect(selectLatestTurnMessages([t1, t2], null)).toBe(t2.messages);
  });

  test("returns in-flight even if it's an empty array (just-submitted, no messages yet)", () => {
    const empty: Message[] = [];
    const t1 = turn("t1", [taskUse("TaskCreate")]);
    // Just-submitted turn → in-flight messages is empty array (not null).
    // We want to scope to the new turn so the popover clears as soon as
    // the user submits.
    expect(selectLatestTurnMessages([t1], empty)).toBe(empty);
  });
});

// ---------------------------------------------------------------------------
// Composed behavior — the user's scenario
// ---------------------------------------------------------------------------

describe("turn-scoped visibility — the multi-prompt scenario", () => {
  test("calculator turn alone → latest has Task* → popover shows", () => {
    const calcTurn = turn("calc", [
      taskUse("TaskCreate"),
      taskUse("TaskUpdate"),
    ]);
    const latest = selectLatestTurnMessages([calcTurn], null);
    expect(latest).not.toBe(null);
    expect(hasTaskEvent(latest!)).toBe(true);
  });

  test("calculator turn + 'hello' turn → latest is 'hello' → popover empty", () => {
    const calcTurn = turn("calc", [
      taskUse("TaskCreate"),
      taskUse("TaskUpdate"),
    ]);
    const helloTurn = turn("hello", [userMsg()]);
    const latest = selectLatestTurnMessages([calcTurn, helloTurn], null);
    expect(latest).toBe(helloTurn.messages);
    expect(hasTaskEvent(latest!)).toBe(false);
  });

  test("calculator turn + new 'hello' submit in flight → latest is in-flight → popover empty", () => {
    const calcTurn = turn("calc", [
      taskUse("TaskCreate"),
      taskUse("TaskUpdate"),
    ]);
    // The new "hello" turn just opened, no Task* events yet.
    const inflight: Message[] = [userMsg()];
    const latest = selectLatestTurnMessages([calcTurn], inflight);
    expect(latest).toBe(inflight);
    expect(hasTaskEvent(latest!)).toBe(false);
  });

  test("just-submitted turn whose first frame is a new TaskCreate → popover shows", () => {
    const inflight: Message[] = [userMsg(), taskUse("TaskCreate", "pending")];
    const latest = selectLatestTurnMessages([], inflight);
    expect(latest).toBe(inflight);
    expect(hasTaskEvent(latest!)).toBe(true);
  });
});
