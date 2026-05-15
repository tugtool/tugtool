/**
 * Pure-logic tests for `groupToolCallsByParent` — the [#step-17-5]
 * derivation that rebuilds subagent nesting from the reducer's flat
 * `toolCallMap`.
 *
 * The reducer keeps every tool call (parent `Agent` and subagent
 * children alike) in one flat list, each child tagged with
 * `parentToolUseId`. `groupToolCallsByParent` partitions that list
 * into the top-level calls (rendered as transcript siblings) and a
 * `parentToolUseId → children[]` map (threaded into the dispatch so
 * each `AgentTranscriptBlock` resolves its own children). Its
 * behaviour *is* this function — no DOM needed.
 */

import { describe, expect, test } from "bun:test";

import { groupToolCallsByParent } from "../tide-card-transcript-tool-calls";
import type { ToolCallState } from "@/lib/code-session-store";

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

function call(
  toolUseId: string,
  toolName: string,
  parentToolUseId?: string,
): ToolCallState {
  return {
    toolUseId,
    toolName,
    input: {},
    status: "done",
    result: null,
    structuredResult: null,
    parentToolUseId,
  };
}

// ---------------------------------------------------------------------------
// groupToolCallsByParent
// ---------------------------------------------------------------------------

describe("groupToolCallsByParent", () => {
  test("an empty list yields empty partitions", () => {
    const { topLevel, childrenByParent } = groupToolCallsByParent([]);
    expect(topLevel).toEqual([]);
    expect(childrenByParent.size).toBe(0);
  });

  test("calls with no parent are all top-level", () => {
    const calls = [call("t1", "Bash"), call("t2", "Read"), call("t3", "Edit")];
    const { topLevel, childrenByParent } = groupToolCallsByParent(calls);
    expect(topLevel.map((c) => c.toolUseId)).toEqual(["t1", "t2", "t3"]);
    expect(childrenByParent.size).toBe(0);
  });

  test("an Agent with one nested child — the test-22 shape", () => {
    // The reducer's flat list: the Agent, then the subagent's Grep
    // tagged with the Agent's id.
    const calls = [
      call("agent-1", "Agent"),
      call("grep-1", "Grep", "agent-1"),
    ];
    const { topLevel, childrenByParent } = groupToolCallsByParent(calls);

    // Only the Agent renders at the top level; the Grep nests under it.
    expect(topLevel.map((c) => c.toolUseId)).toEqual(["agent-1"]);
    expect(childrenByParent.get("agent-1")?.map((c) => c.toolUseId)).toEqual([
      "grep-1",
    ]);
    // The child never leaks into the top level.
    expect(topLevel.some((c) => c.toolUseId === "grep-1")).toBe(false);
  });

  test("multi-level nesting (depth 2) falls out of the flat partition", () => {
    // Agent A spawns Agent B; Agent B spawns a Grep. All flat in the
    // reducer; each tagged with its immediate parent.
    const calls = [
      call("agent-A", "Agent"),
      call("agent-B", "Agent", "agent-A"),
      call("grep-1", "Grep", "agent-B"),
    ];
    const { topLevel, childrenByParent } = groupToolCallsByParent(calls);

    expect(topLevel.map((c) => c.toolUseId)).toEqual(["agent-A"]);
    // A's child is B; B's child is the Grep — resolved when B's own
    // AgentTranscriptBlock recurses.
    expect(childrenByParent.get("agent-A")?.map((c) => c.toolUseId)).toEqual([
      "agent-B",
    ]);
    expect(childrenByParent.get("agent-B")?.map((c) => c.toolUseId)).toEqual([
      "grep-1",
    ]);
  });

  test("multiple children under one parent preserve producer order", () => {
    const calls = [
      call("agent-1", "Agent"),
      call("read-1", "Read", "agent-1"),
      call("grep-1", "Grep", "agent-1"),
      call("bash-1", "Bash", "agent-1"),
    ];
    const { topLevel, childrenByParent } = groupToolCallsByParent(calls);
    expect(topLevel.map((c) => c.toolUseId)).toEqual(["agent-1"]);
    expect(childrenByParent.get("agent-1")?.map((c) => c.toolUseId)).toEqual([
      "read-1",
      "grep-1",
      "bash-1",
    ]);
  });

  test("top-level order is preserved alongside nested calls in the flat list", () => {
    // A realistic single turn: a top-level Bash, then an Agent with a
    // child, then a top-level Read.
    const calls = [
      call("bash-1", "Bash"),
      call("agent-1", "Agent"),
      call("grep-1", "Grep", "agent-1"),
      call("read-1", "Read"),
    ];
    const { topLevel, childrenByParent } = groupToolCallsByParent(calls);
    expect(topLevel.map((c) => c.toolUseId)).toEqual([
      "bash-1",
      "agent-1",
      "read-1",
    ]);
    expect(childrenByParent.get("agent-1")?.map((c) => c.toolUseId)).toEqual([
      "grep-1",
    ]);
  });

  test("an orphan child (parent absent) is never promoted to the top level", () => {
    // Defensive: a child whose parent isn't in the list still must not
    // render as a transcript sibling — it sits in `childrenByParent`
    // under its (absent) parent key and is simply not surfaced.
    const calls = [call("grep-1", "Grep", "missing-parent")];
    const { topLevel, childrenByParent } = groupToolCallsByParent(calls);
    expect(topLevel).toEqual([]);
    expect(childrenByParent.get("missing-parent")?.map((c) => c.toolUseId)).toEqual([
      "grep-1",
    ]);
  });
});
